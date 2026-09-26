use super::super::repositories::upsert_asset;
use super::super::services::{
    ensure_article_in_transaction, ensure_article_revision, insert_analysis_run,
    update_article_metadata_in_transaction,
};
use super::super::{id_from, json_text, json_value, validate_id, value_i64, value_string, DbState};
use serde_json::{json, Value};
use sqlx::Row;
use std::collections::HashSet;
use tauri::State;

#[tauri::command]
pub async fn db_commit_slide_detection(
    state: State<'_, DbState>,
    article_id: String,
    run_id: String,
    result: Value,
    slides: Value,
    article: Value,
    project_title: String,
    active_article_id: Option<String>,
    project_updated_at: String,
    expected_project_revision: Option<i64>,
    expected_revision: Option<i64>,
) -> Result<Value, String> {
    validate_id(&article_id, "記事ID")?;
    validate_id(&run_id, "解析run ID")?;
    let slides = slides
        .as_array()
        .ok_or_else(|| "スライド結果が配列ではありません。".to_string())?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| format!("スライド検出commitを開始できませんでした: {error}"))?;
    ensure_article_in_transaction(&mut tx, &article_id).await?;
    let current_article_revision =
        ensure_article_revision(&mut tx, &article_id, expected_revision).await?;
    let project_id: String = sqlx::query_scalar("SELECT project_id FROM articles WHERE id = ?")
        .bind(&article_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| format!("記事のプロジェクトを読めませんでした: {error}"))?;
    let old_slide_asset_ids: Vec<String> = sqlx::query_scalar(
        "SELECT image_asset_id FROM slides WHERE article_id = ? AND image_asset_id IS NOT NULL",
    )
    .bind(&article_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|error| format!("旧スライドassetを確認できませんでした: {error}"))?;
    sqlx::query("DELETE FROM slide_ocr_selections WHERE slide_id IN (SELECT id FROM slides WHERE article_id = ?)")
        .bind(&article_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("OCR採用結果を初期化できませんでした: {error}"))?;
    sqlx::query("DELETE FROM slides WHERE article_id = ?")
        .bind(&article_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("以前のスライドを置き換えられませんでした: {error}"))?;
    insert_analysis_run(
        &mut tx,
        &run_id,
        &article_id,
        "slide_detection",
        Some(&result),
    )
    .await?;
    for asset_id in old_slide_asset_ids {
        sqlx::query("DELETE FROM assets WHERE id = ? AND project_id = ?")
            .bind(&asset_id)
            .bind(&project_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("旧スライドassetを削除できませんでした: {error}"))?;
    }
    for (position, slide) in slides.iter().enumerate() {
        let slide_id = value_string(slide, "id")?;
        let image_asset_id = if let Some(path) = slide
            .get("image")
            .and_then(|image| image.get("representativeFramePath"))
            .and_then(Value::as_str)
        {
            let asset_id = id_from("slide-image", &format!("{article_id}-{slide_id}"));
            upsert_asset(&mut tx, &project_id, &asset_id, path, &state.app_data_dir).await?;
            Some(asset_id)
        } else {
            None
        };
        sqlx::query(
            "INSERT INTO slides (id, article_id, run_id, position, start_ms, end_ms, detection_json, image_asset_id, transcript_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(slide_id)
        .bind(&article_id)
        .bind(&run_id)
        .bind(position as i64)
        .bind(value_i64(slide, "startMs", 0))
        .bind(value_i64(slide, "endMs", 0))
        .bind(json_value(slide, "detection", json!({}))?)
        .bind(image_asset_id)
        .bind(json_text(slide.get("transcript"))?)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("スライドを保存できませんでした: {error}"))?;
    }
    sqlx::query(
        "INSERT INTO article_material_selections (article_id, slide_run_id, transcription_run_id)
         VALUES (?, ?, (SELECT transcription_run_id FROM article_material_selections WHERE article_id = ?))
         ON CONFLICT(article_id) DO UPDATE SET slide_run_id = excluded.slide_run_id",
    )
    .bind(&article_id)
    .bind(&run_id)
    .bind(&article_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("採用スライドrunを更新できませんでした: {error}"))?;
    let revisions = sqlx::query(
        "SELECT id, revision FROM slides WHERE article_id = ? ORDER BY position",
    )
    .bind(&article_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|error| format!("スライドrevisionを読めませんでした: {error}"))?
    .into_iter()
    .map(|row| {
        Ok(json!({
            "id": row.try_get::<String, _>("id").map_err(|error| error.to_string())?,
            "revision": row.try_get::<i64, _>("revision").map_err(|error| error.to_string())?
        }))
    })
    .collect::<Result<Vec<_>, String>>()?;
    let (project_revision, article_revision) = update_article_metadata_in_transaction(
        &mut tx,
        &project_id,
        &project_title,
        active_article_id.as_deref(),
        &project_updated_at,
        &article,
        expected_project_revision,
        current_article_revision,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|error| format!("スライド検出commitに失敗しました: {error}"))?;
    Ok(
        json!({ "projectRevision": project_revision, "articleRevision": article_revision, "slideRevisions": revisions }),
    )
}

#[tauri::command]
pub async fn db_commit_transcription(
    state: State<'_, DbState>,
    article_id: String,
    run_id: String,
    transcription: Value,
    slides: Value,
    article: Value,
    project_title: String,
    active_article_id: Option<String>,
    project_updated_at: String,
    expected_project_revision: Option<i64>,
    expected_revision: Option<i64>,
) -> Result<Value, String> {
    validate_id(&article_id, "記事ID")?;
    validate_id(&run_id, "解析run ID")?;
    if transcription
        .get("segments")
        .and_then(Value::as_array)
        .is_none()
    {
        return Err("文字起こしsegmentsがありません。".to_string());
    }
    let slides = slides
        .as_array()
        .ok_or_else(|| "スライド結果が配列ではありません。".to_string())?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| format!("文字起こしcommitを開始できませんでした: {error}"))?;
    ensure_article_in_transaction(&mut tx, &article_id).await?;
    let current_article_revision =
        ensure_article_revision(&mut tx, &article_id, expected_revision).await?;
    insert_analysis_run(
        &mut tx,
        &run_id,
        &article_id,
        "transcription",
        Some(&transcription),
    )
    .await?;
    for slide in slides {
        let slide_id = value_string(slide, "id")?;
        let affected =
            sqlx::query("UPDATE slides SET transcript_json = ?, revision = revision + 1 WHERE id = ? AND article_id = ?")
                .bind(json_text(slide.get("transcript"))?)
                .bind(slide_id)
                .bind(&article_id)
                .execute(&mut *tx)
                .await
                .map_err(|error| format!("スライドへの発話割当を保存できませんでした: {error}"))?;
        if affected.rows_affected() == 0 {
            return Err(format!("NOT_FOUND: スライドが見つかりません: {slide_id}"));
        }
    }
    sqlx::query(
        "INSERT INTO article_material_selections (article_id, slide_run_id, transcription_run_id)
         VALUES (?, (SELECT slide_run_id FROM article_material_selections WHERE article_id = ?), ?)
         ON CONFLICT(article_id) DO UPDATE SET transcription_run_id = excluded.transcription_run_id",
    )
    .bind(&article_id)
    .bind(&article_id)
    .bind(&run_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("採用文字起こしrunを更新できませんでした: {error}"))?;
    let revisions = sqlx::query(
        "SELECT id, revision FROM slides WHERE article_id = ? ORDER BY position",
    )
    .bind(&article_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|error| format!("スライドrevisionを読めませんでした: {error}"))?
    .into_iter()
    .map(|row| {
        Ok(json!({
            "id": row.try_get::<String, _>("id").map_err(|error| error.to_string())?,
            "revision": row.try_get::<i64, _>("revision").map_err(|error| error.to_string())?
        }))
    })
    .collect::<Result<Vec<_>, String>>()?;
    let project_id: String = sqlx::query_scalar("SELECT project_id FROM articles WHERE id = ?")
        .bind(&article_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| format!("記事のプロジェクトを読めませんでした: {error}"))?;
    let (project_revision, article_revision) = update_article_metadata_in_transaction(
        &mut tx,
        &project_id,
        &project_title,
        active_article_id.as_deref(),
        &project_updated_at,
        &article,
        expected_project_revision,
        current_article_revision,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|error| format!("文字起こしcommitに失敗しました: {error}"))?;
    Ok(
        json!({ "projectRevision": project_revision, "articleRevision": article_revision, "slideRevisions": revisions }),
    )
}

#[tauri::command]
pub async fn db_commit_ocr_batch(
    state: State<'_, DbState>,
    article_id: String,
    items: Value,
    article: Value,
    project_title: String,
    active_article_id: Option<String>,
    project_updated_at: String,
    expected_project_revision: Option<i64>,
    expected_article_revision: Option<i64>,
) -> Result<Value, String> {
    validate_id(&article_id, "記事ID")?;
    let items = items
        .as_array()
        .ok_or_else(|| "OCR結果が配列ではありません。".to_string())?;
    if items.is_empty() {
        return Err("OCR結果が空です。".to_string());
    }
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| format!("OCR batch commitを開始できませんでした: {error}"))?;
    ensure_article_in_transaction(&mut tx, &article_id).await?;
    let article_revision =
        ensure_article_revision(&mut tx, &article_id, expected_article_revision).await?;
    let project_id: String = sqlx::query_scalar("SELECT project_id FROM articles WHERE id = ?")
        .bind(&article_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| format!("記事のプロジェクトを読めませんでした: {error}"))?;
    let mut seen = HashSet::new();
    let mut revisions = Vec::with_capacity(items.len());
    for item in items {
        let slide_id = value_string(item, "slideId")?;
        if !seen.insert(slide_id) {
            return Err(format!(
                "VALIDATION_ERROR: スライドが重複しています: {slide_id}"
            ));
        }
        let run_id = value_string(item, "runId")?;
        let ocr_result_id = value_string(item, "ocrResultId")?;
        validate_id(&slide_id, "スライドID")?;
        validate_id(&run_id, "解析run ID")?;
        validate_id(&ocr_result_id, "OCR結果ID")?;
        let ocr = item.get("ocr").cloned().unwrap_or_else(|| json!({}));
        let slide_revision: i64 =
            sqlx::query_scalar("SELECT revision FROM slides WHERE id = ? AND article_id = ?")
                .bind(&slide_id)
                .bind(&article_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|error| format!("OCR対象スライドを確認できませんでした: {error}"))?
                .ok_or_else(|| format!("NOT_FOUND: OCR対象スライドが見つかりません: {slide_id}"))?;
        if let Some(expected) = item.get("expectedSlideRevision").and_then(Value::as_i64) {
            if expected != slide_revision {
                return Err(format!(
                    "REVISION_CONFLICT: expected={expected}, actual={slide_revision}"
                ));
            }
        }
        insert_analysis_run(&mut tx, &run_id, &article_id, "ocr", Some(&ocr)).await?;
        sqlx::query(
            "INSERT INTO ocr_results (id, article_id, slide_id, raw_text, edited_text, metadata_json, created_at)
             VALUES (?, ?, ?, ?, NULL, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        )
        .bind(&ocr_result_id)
        .bind(&article_id)
        .bind(&slide_id)
        .bind(ocr.get("rawText").and_then(Value::as_str).unwrap_or_default())
        .bind(serde_json::to_string(&ocr).map_err(|error| error.to_string())?)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("OCR結果を保存できませんでした: {error}"))?;
        sqlx::query(
            "INSERT INTO slide_ocr_selections (slide_id, ocr_result_id) VALUES (?, ?)
             ON CONFLICT(slide_id) DO UPDATE SET ocr_result_id = excluded.ocr_result_id",
        )
        .bind(&slide_id)
        .bind(&ocr_result_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("採用OCR結果を更新できませんでした: {error}"))?;
        let transcript = item.get("transcript").filter(|value| !value.is_null());
        sqlx::query(
            "UPDATE slides SET transcript_json = ?, revision = ? WHERE id = ? AND article_id = ?",
        )
        .bind(json_text(transcript)?)
        .bind(slide_revision + 1)
        .bind(&slide_id)
        .bind(&article_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("OCR後の本文を更新できませんでした: {error}"))?;
        revisions.push(json!({
            "id": slide_id,
            "revision": slide_revision + 1,
            "ocrRevision": 0
        }));
    }
    let (project_revision, article_revision) = update_article_metadata_in_transaction(
        &mut tx,
        &project_id,
        &project_title,
        active_article_id.as_deref(),
        &project_updated_at,
        &article,
        expected_project_revision,
        article_revision,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|error| format!("OCR batch commitに失敗しました: {error}"))?;
    Ok(json!({
        "projectRevision": project_revision,
        "articleRevision": article_revision,
        "slideRevisions": revisions
    }))
}

#[tauri::command]
pub async fn db_commit_slide_content_batch(
    state: State<'_, DbState>,
    article_id: String,
    items: Value,
    article: Value,
    project_title: String,
    active_article_id: Option<String>,
    project_updated_at: String,
    expected_project_revision: Option<i64>,
    expected_article_revision: Option<i64>,
) -> Result<Value, String> {
    validate_id(&article_id, "記事ID")?;
    let items = items
        .as_array()
        .ok_or_else(|| "本文生成結果が配列ではありません。".to_string())?;
    if items.is_empty() {
        return Err("本文生成結果が空です。".to_string());
    }
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| format!("本文生成batch commitを開始できませんでした: {error}"))?;
    ensure_article_in_transaction(&mut tx, &article_id).await?;
    let article_revision =
        ensure_article_revision(&mut tx, &article_id, expected_article_revision).await?;
    let project_id: String = sqlx::query_scalar("SELECT project_id FROM articles WHERE id = ?")
        .bind(&article_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| format!("記事のプロジェクトを読めませんでした: {error}"))?;
    let mut seen = HashSet::new();
    let mut revisions = Vec::with_capacity(items.len());
    for item in items {
        let slide_id = value_string(item, "slideId")?;
        if !seen.insert(slide_id) {
            return Err(format!(
                "VALIDATION_ERROR: スライドが重複しています: {slide_id}"
            ));
        }
        let run_id = value_string(item, "runId")?;
        validate_id(&slide_id, "スライドID")?;
        validate_id(&run_id, "解析run ID")?;
        let result = item.get("result").cloned().unwrap_or_else(|| json!({}));
        let transcript = item
            .get("transcript")
            .ok_or_else(|| "本文生成結果のtranscriptがありません。".to_string())?;
        let slide_revision: i64 =
            sqlx::query_scalar("SELECT revision FROM slides WHERE id = ? AND article_id = ?")
                .bind(&slide_id)
                .bind(&article_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|error| format!("本文生成対象スライドを確認できませんでした: {error}"))?
                .ok_or_else(|| {
                    format!("NOT_FOUND: 本文生成対象スライドが見つかりません: {slide_id}")
                })?;
        if let Some(expected) = item.get("expectedSlideRevision").and_then(Value::as_i64) {
            if expected != slide_revision {
                return Err(format!(
                    "REVISION_CONFLICT: expected={expected}, actual={slide_revision}"
                ));
            }
        }
        insert_analysis_run(
            &mut tx,
            &run_id,
            &article_id,
            "body_generation",
            Some(&result),
        )
        .await?;
        sqlx::query(
            "UPDATE slides SET transcript_json = ?, revision = ? WHERE id = ? AND article_id = ?",
        )
        .bind(serde_json::to_string(transcript).map_err(|error| error.to_string())?)
        .bind(slide_revision + 1)
        .bind(&slide_id)
        .bind(&article_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("本文を保存できませんでした: {error}"))?;
        revisions.push(json!({ "id": slide_id, "revision": slide_revision + 1 }));
    }
    let (project_revision, article_revision) = update_article_metadata_in_transaction(
        &mut tx,
        &project_id,
        &project_title,
        active_article_id.as_deref(),
        &project_updated_at,
        &article,
        expected_project_revision,
        article_revision,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|error| format!("本文生成batch commitに失敗しました: {error}"))?;
    Ok(json!({
        "projectRevision": project_revision,
        "articleRevision": article_revision,
        "slideRevisions": revisions
    }))
}

#[tauri::command]
pub async fn db_update_slide_results(
    state: State<'_, DbState>,
    article_id: String,
    slide_id: String,
    transcript: Option<Value>,
    ocr_text: Option<String>,
    article: Value,
    project_title: String,
    active_article_id: Option<String>,
    project_updated_at: String,
    expected_project_revision: Option<i64>,
    expected_article_revision: Option<i64>,
    expected_slide_revision: Option<i64>,
    expected_ocr_revision: Option<i64>,
) -> Result<Value, String> {
    validate_id(&article_id, "記事ID")?;
    validate_id(&slide_id, "スライドID")?;
    let mut tx =
        state.pool.begin().await.map_err(|error| {
            format!("スライド結果更新transactionを開始できませんでした: {error}")
        })?;
    ensure_article_in_transaction(&mut tx, &article_id).await?;
    let slide_revision: i64 =
        sqlx::query_scalar("SELECT revision FROM slides WHERE id = ? AND article_id = ?")
            .bind(&slide_id)
            .bind(&article_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|error| format!("スライドrevisionを読めませんでした: {error}"))?
            .ok_or_else(|| "NOT_FOUND: スライドが見つかりません。".to_string())?;
    if let Some(expected) = expected_slide_revision {
        if expected != slide_revision {
            return Err(format!(
                "REVISION_CONFLICT: expected={expected}, actual={slide_revision}"
            ));
        }
    }
    let selected = sqlx::query("SELECT o.id, o.revision FROM ocr_results o WHERE o.id = (SELECT ocr_result_id FROM slide_ocr_selections WHERE slide_id = ?) AND o.article_id = ? AND o.slide_id = ?")
        .bind(&slide_id).bind(&article_id).bind(&slide_id).fetch_optional(&mut *tx).await
        .map_err(|error| format!("OCR結果を確認できませんでした: {error}"))?;
    let mut next_ocr_revision = None;
    if let Some(ocr_text) = ocr_text {
        let selected =
            selected.ok_or_else(|| "NOT_FOUND: OCR結果が見つかりません。".to_string())?;
        let ocr_id: String = selected.try_get("id").map_err(|error| error.to_string())?;
        let revision: i64 = selected
            .try_get("revision")
            .map_err(|error| error.to_string())?;
        if let Some(expected) = expected_ocr_revision {
            if expected != revision {
                return Err(format!(
                    "REVISION_CONFLICT: expected={expected}, actual={revision}"
                ));
            }
        }
        sqlx::query(
            "UPDATE ocr_results SET edited_text = ?, revision = ? WHERE id = ? AND revision = ?",
        )
        .bind(ocr_text)
        .bind(revision + 1)
        .bind(&ocr_id)
        .bind(revision)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("OCR補正を更新できませんでした: {error}"))?;
        next_ocr_revision = Some(json!({ "ocrId": ocr_id, "revision": revision + 1 }));
    }
    let next_slide_revision = if transcript.is_some() {
        slide_revision + 1
    } else {
        slide_revision
    };
    if let Some(transcript) = transcript {
        sqlx::query("UPDATE slides SET transcript_json = ?, revision = ? WHERE id = ? AND article_id = ? AND revision = ?")
            .bind(serde_json::to_string(&transcript).map_err(|error| format!("transcriptをJSON化できませんでした: {error}"))?)
            .bind(next_slide_revision).bind(&slide_id).bind(&article_id).bind(slide_revision).execute(&mut *tx).await
            .map_err(|error| format!("スライド本文を更新できませんでした: {error}"))?;
    }
    let project_id: String = sqlx::query_scalar("SELECT project_id FROM articles WHERE id = ?")
        .bind(&article_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| format!("記事のプロジェクトを読めませんでした: {error}"))?;
    let article_revision =
        ensure_article_revision(&mut tx, &article_id, expected_article_revision).await?;
    let (project_revision, next_article_revision) = update_article_metadata_in_transaction(
        &mut tx,
        &project_id,
        &project_title,
        active_article_id.as_deref(),
        &project_updated_at,
        &article,
        expected_project_revision,
        article_revision,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|error| format!("スライド結果更新をcommitできませんでした: {error}"))?;
    Ok(
        json!({ "projectRevision": project_revision, "articleRevision": next_article_revision, "slideId": slide_id, "slideRevision": next_slide_revision, "ocr": next_ocr_revision }),
    )
}
