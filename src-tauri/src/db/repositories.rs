use super::assets::inspect_asset;
use super::validate_asset_path;
use serde_json::{json, Map, Value};
use sqlx::{Row, SqlitePool};
use std::path::Path;

const OCR_ID_FOR_SLIDE_SQL: &str = "COALESCE(
    (SELECT ocr_result_id FROM slide_ocr_selections WHERE slide_id = {slide_id}),
    (SELECT id FROM ocr_results WHERE slide_id = {slide_id} ORDER BY created_at DESC, id DESC LIMIT 1)
)";
const JS_TRIM_CHARACTERS: &str =
    "\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}\u{00A0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}";

pub(crate) async fn upsert_asset(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    project_id: &str,
    asset_id: &str,
    relative_path: &str,
    asset_root: &Path,
) -> Result<(), String> {
    validate_asset_path(relative_path)?;
    let file_metadata = inspect_asset(asset_root, project_id, relative_path)?;
    sqlx::query(
        "INSERT INTO assets (id, project_id, relative_path, byte_size, sha256, missing_at)
         VALUES (?, ?, ?, ?, NULL, CASE WHEN ? = 1 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END)
         ON CONFLICT(id) DO UPDATE SET relative_path = excluded.relative_path,
           byte_size = excluded.byte_size, sha256 = NULL,
           missing_at = excluded.missing_at",
    )
    .bind(asset_id)
    .bind(project_id)
    .bind(relative_path)
    .bind(file_metadata.byte_size)
    .bind(if file_metadata.missing_at.is_some() { 1_i64 } else { 0_i64 })
    .execute(&mut **tx)
    .await
    .map_err(|error| format!("assetを登録できませんでした: {error}"))?;
    Ok(())
}

pub(crate) async fn load_project_from_indexes(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<Value, String> {
    let project = sqlx::query(
        "SELECT id, title, version, active_article_id, created_at, updated_at FROM projects WHERE id = ?",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("プロジェクトを読めませんでした: {error}"))?
    .ok_or_else(|| "プロジェクトが見つかりません。".to_string())?;

    let video_rows = sqlx::query(
        "SELECT v.id, v.title, v.media_json, v.created_at, v.updated_at, a.relative_path,
                ta.relative_path AS thumbnail_path
         FROM videos v JOIN assets a ON a.id = v.asset_id
         LEFT JOIN assets ta ON ta.id = v.thumbnail_asset_id
         WHERE v.project_id = ? ORDER BY v.created_at, v.id",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("動画を読めませんでした: {error}"))?;
    let mut videos = Vec::new();
    let mut media_by_video = std::collections::HashMap::new();
    for row in video_rows {
        let id: String = row.try_get("id").map_err(|error| error.to_string())?;
        let mut media = match serde_json::from_str::<Value>(
            &row.try_get::<String, _>("media_json")
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("動画media JSONが壊れています: {error}"))?
        {
            Value::Object(map) => map,
            _ => Map::new(),
        };
        media.insert("ownership".to_string(), json!("managed"));
        media.insert(
            "managedRelativePath".to_string(),
            json!(row
                .try_get::<String, _>("relative_path")
                .map_err(|error| error.to_string())?),
        );
        if let Some(path) = row
            .try_get::<Option<String>, _>("thumbnail_path")
            .map_err(|error| error.to_string())?
        {
            media.insert("thumbnailPath".to_string(), json!(path));
        }
        let media_value = Value::Object(media);
        media_by_video.insert(id.clone(), media_value.clone());
        videos.push(json!({
            "id": id,
            "title": row.try_get::<String, _>("title").map_err(|error| error.to_string())?,
            "media": media_value,
            "createdAt": row.try_get::<String, _>("created_at").map_err(|error| error.to_string())?,
            "updatedAt": row.try_get::<String, _>("updated_at").map_err(|error| error.to_string())?
        }));
    }

    let article_rows = sqlx::query(
        "SELECT id, source_video_id, title, source_range_json, crop_json, perspective_crop_json,
                settings_json, workflow_json, created_at, updated_at
         FROM articles WHERE project_id = ? ORDER BY created_at, id",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("記事を読めませんでした: {error}"))?;
    let mut articles = Vec::new();
    for row in article_rows {
        let article_id: String = row.try_get("id").map_err(|error| error.to_string())?;
        let source_video_id: String = row
            .try_get::<Option<String>, _>("source_video_id")
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("記事{article_id}の参照元動画がありません。"))?;
        let mut input_media = media_by_video
            .get(&source_video_id)
            .cloned()
            .ok_or_else(|| format!("記事{article_id}の参照元動画がありません。"))?;
        if let Some(media) = input_media.as_object_mut() {
            media.insert("preparedFromVideoId".to_string(), json!(source_video_id));
            media.insert("preparation".to_string(), json!("reference"));
            media.insert(
                "preparedAt".to_string(),
                json!(row
                    .try_get::<String, _>("created_at")
                    .map_err(|error| error.to_string())?),
            );
        }
        let source_range: Value = serde_json::from_str(
            &row.try_get::<String, _>("source_range_json")
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("記事範囲JSONが壊れています: {error}"))?;
        let settings: Value = serde_json::from_str(
            &row.try_get::<String, _>("settings_json")
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("記事設定JSONが壊れています: {error}"))?;
        let workflow: Value = serde_json::from_str(
            &row.try_get::<String, _>("workflow_json")
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("記事workflow JSONが壊れています: {error}"))?;

        let detection_raw = sqlx::query_scalar::<_, Option<String>>(
            "SELECT r.result_json FROM analysis_runs r
             LEFT JOIN article_material_selections m ON m.slide_run_id = r.id
             WHERE r.article_id = ? AND r.kind = 'slide_detection'
               AND (m.article_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM article_material_selections WHERE article_id = ?))
             ORDER BY CASE WHEN m.article_id IS NOT NULL THEN 0 ELSE 1 END, r.started_at DESC LIMIT 1",
        )
        .bind(&article_id)
        .bind(&article_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("スライド検出結果を読めませんでした: {error}"))?
        .flatten();
        let slide_detection = detection_raw
            .map(|raw| serde_json::from_str::<Value>(&raw))
            .transpose()
            .map_err(|error| format!("スライド検出結果JSONが壊れています: {error}"))?;
        let transcription_raw = sqlx::query_scalar::<_, Option<String>>(
            "SELECT r.result_json FROM analysis_runs r
             LEFT JOIN article_material_selections m ON m.transcription_run_id = r.id
             WHERE r.article_id = ? AND r.kind = 'transcription'
               AND (m.article_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM article_material_selections WHERE article_id = ?))
             ORDER BY CASE WHEN m.article_id IS NOT NULL THEN 0 ELSE 1 END, r.started_at DESC LIMIT 1",
        )
        .bind(&article_id)
        .bind(&article_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("文字起こし結果を読めませんでした: {error}"))?
        .flatten();
        let transcription = transcription_raw
            .map(|raw| serde_json::from_str::<Value>(&raw))
            .transpose()
            .map_err(|error| format!("文字起こし結果JSONが壊れています: {error}"))?;

        let slide_rows = sqlx::query(
            "SELECT s.id, s.position, s.start_ms, s.end_ms, s.detection_json, s.transcript_json, s.revision,
                    a.relative_path AS image_path
             FROM slides s LEFT JOIN assets a ON a.id = s.image_asset_id
             WHERE s.article_id = ? AND s.run_id = COALESCE(
               (SELECT slide_run_id FROM article_material_selections WHERE article_id = ?), s.run_id)
             ORDER BY s.position",
        )
        .bind(&article_id)
        .bind(&article_id)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("スライドを読めませんでした: {error}"))?;
        let mut slides = Vec::new();
        for row in slide_rows {
            let slide_id: String = row.try_get("id").map_err(|error| error.to_string())?;
            let detection: Value = serde_json::from_str(
                &row.try_get::<String, _>("detection_json")
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| format!("スライド検出情報JSONが壊れています: {error}"))?;
            let mut slide = json!({
                "id": slide_id,
                "index": row.try_get::<i64, _>("position").map_err(|error| error.to_string())?,
                "startMs": row.try_get::<i64, _>("start_ms").map_err(|error| error.to_string())?,
                "endMs": row.try_get::<i64, _>("end_ms").map_err(|error| error.to_string())?,
                "detection": detection,
                "image": {}
            });
            if let Some(path) = row
                .try_get::<Option<String>, _>("image_path")
                .map_err(|error| error.to_string())?
            {
                slide["image"] = json!({ "representativeFramePath": path });
            }
            if let Some(raw) = row
                .try_get::<Option<String>, _>("transcript_json")
                .map_err(|error| error.to_string())?
            {
                if raw != "null" {
                    slide["transcript"] = serde_json::from_str(&raw)
                        .map_err(|error| format!("スライド本文JSONが壊れています: {error}"))?;
                }
            }
            let ocr_query = format!(
                "SELECT COALESCE(edited_text, raw_text) AS effective_text, metadata_json
                 FROM ocr_results
                 WHERE id = {} AND slide_id = ?",
                OCR_ID_FOR_SLIDE_SQL.replace("{slide_id}", "?")
            );
            if let Some(ocr_row) = sqlx::query(&ocr_query)
                .bind(&slide_id)
                .bind(&slide_id)
                .bind(&slide_id)
                .fetch_optional(pool)
                .await
                .map_err(|error| format!("OCR結果を読めませんでした: {error}"))?
            {
                let metadata: String = ocr_row
                    .try_get("metadata_json")
                    .map_err(|error| error.to_string())?;
                let mut ocr = match serde_json::from_str::<Value>(&metadata)
                    .map_err(|error| error.to_string())?
                {
                    Value::Object(map) => map,
                    _ => Map::new(),
                };
                let effective_text: String = ocr_row
                    .try_get("effective_text")
                    .map_err(|error| error.to_string())?;
                ocr.insert("rawText".to_string(), json!(effective_text));
                slide["ocr"] = Value::Object(ocr);
            }
            slides.push(slide);
        }
        let article_data_raw = sqlx::query_scalar::<_, Option<String>>(
            "SELECT article_json FROM documents WHERE article_id = ? LIMIT 1",
        )
        .bind(&article_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("原稿を読めませんでした: {error}"))?
        .flatten();
        let article_data = article_data_raw
            .map(|raw| serde_json::from_str::<Value>(&raw))
            .transpose()
            .map_err(|error| format!("原稿JSONが壊れています: {error}"))?;
        let mut article = json!({
            "id": article_id,
            "title": row.try_get::<String, _>("title").map_err(|error| error.to_string())?,
            "sourceVideoId": source_video_id,
            "inputMedia": input_media,
            "sourceRange": source_range,
            "settings": settings,
            "slides": slides,
            "workflow": workflow,
            "createdAt": row.try_get::<String, _>("created_at").map_err(|error| error.to_string())?,
            "updatedAt": row.try_get::<String, _>("updated_at").map_err(|error| error.to_string())?
        });
        for (column, key) in [
            ("crop_json", "crop"),
            ("perspective_crop_json", "perspectiveCrop"),
        ] {
            if let Some(raw) = row
                .try_get::<Option<String>, _>(column)
                .map_err(|error| error.to_string())?
            {
                article[key] = serde_json::from_str(&raw)
                    .map_err(|error| format!("記事設定JSONが壊れています: {error}"))?;
            }
        }
        if let Some(value) = slide_detection {
            article["slideDetection"] = value;
        }
        if let Some(value) = transcription {
            article["transcription"] = value;
        }
        if let Some(value) = article_data {
            article["article"] = value;
        }
        articles.push(article);
    }
    let mut project_value = json!({
        "version": project.try_get::<i64, _>("version").map_err(|error| error.to_string())?,
        "id": project.try_get::<String, _>("id").map_err(|error| error.to_string())?,
        "title": project.try_get::<String, _>("title").map_err(|error| error.to_string())?,
        "videos": videos,
        "articles": articles,
        "createdAt": project.try_get::<String, _>("created_at").map_err(|error| error.to_string())?,
        "updatedAt": project.try_get::<String, _>("updated_at").map_err(|error| error.to_string())?
    });
    if let Some(active) = project
        .try_get::<Option<String>, _>("active_article_id")
        .map_err(|error| error.to_string())?
    {
        project_value["activeArticleId"] = json!(active);
    }
    Ok(project_value)
}

pub(crate) async fn load_project_summary(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<Value, String> {
    let project = sqlx::query(
        "SELECT id, title, version, active_article_id, created_at, updated_at FROM projects WHERE id = ?",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("プロジェクト一覧を読めませんでした: {error}"))?
    .ok_or_else(|| "プロジェクトが見つかりません。".to_string())?;

    let video = sqlx::query(
        "SELECT v.media_json, a.relative_path, ta.relative_path AS thumbnail_path
         FROM videos v JOIN assets a ON a.id = v.asset_id
         LEFT JOIN assets ta ON ta.id = v.thumbnail_asset_id
         WHERE v.project_id = ? ORDER BY v.created_at, v.id LIMIT 1",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("プロジェクト動画を読めませんでした: {error}"))?;
    let video_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM videos WHERE project_id = ?")
        .bind(project_id)
        .fetch_one(pool)
        .await
        .map_err(|error| format!("動画件数を読めませんでした: {error}"))?;
    let article_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM articles WHERE project_id = ?")
            .bind(project_id)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("記事件数を読めませんでした: {error}"))?;

    let article = sqlx::query(
        "SELECT a.id, a.title, a.crop_json, a.workflow_json,
                EXISTS(SELECT 1 FROM analysis_runs r WHERE r.article_id = a.id AND r.kind = 'slide_detection') AS has_detection
         FROM articles a
         WHERE a.project_id = ? AND a.id = COALESCE(
           (SELECT active_article_id FROM projects WHERE id = ?),
           (SELECT id FROM articles WHERE project_id = ? ORDER BY created_at, id LIMIT 1)
         ) LIMIT 1",
    )
    .bind(project_id)
    .bind(project_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("一覧記事を読めませんでした: {error}"))?;

    let mut source_name = "動画未追加".to_string();
    let mut source_path = String::new();
    let mut extension = "mp4".to_string();
    let mut duration_ms = 0_i64;
    let mut thumbnail_path: Option<String> = None;
    if let Some(video) = video {
        let media_json: String = video
            .try_get("media_json")
            .map_err(|error| error.to_string())?;
        source_name = sqlx::query_scalar::<_, Option<String>>("SELECT json_extract(?, '$.name')")
            .bind(&media_json)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("動画名を読めませんでした: {error}"))?
            .unwrap_or(source_name);
        source_path = sqlx::query_scalar::<_, Option<String>>("SELECT json_extract(?, '$.path')")
            .bind(&media_json)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("動画パスを読めませんでした: {error}"))?
            .unwrap_or_default();
        extension =
            sqlx::query_scalar::<_, Option<String>>("SELECT json_extract(?, '$.extension')")
                .bind(&media_json)
                .fetch_one(pool)
                .await
                .map_err(|error| format!("動画拡張子を読めませんでした: {error}"))?
                .unwrap_or(extension);
        duration_ms =
            sqlx::query_scalar::<_, Option<i64>>("SELECT json_extract(?, '$.metadata.durationMs')")
                .bind(&media_json)
                .fetch_one(pool)
                .await
                .map_err(|error| format!("動画時間を読めませんでした: {error}"))?
                .unwrap_or_default();
        thumbnail_path = video
            .try_get::<Option<String>, _>("thumbnail_path")
            .map_err(|error| error.to_string())?;
    }

    let mut summary = json!({
        "projectVersion": project.try_get::<i64, _>("version").map_err(|error| error.to_string())?,
        "id": project.try_get::<String, _>("id").map_err(|error| error.to_string())?,
        "title": project.try_get::<String, _>("title").map_err(|error| error.to_string())?,
        "sourceName": source_name,
        "sourcePath": source_path,
        "extension": extension,
        "durationMs": duration_ms,
        "videoCount": video_count,
        "articleCount": article_count,
        "slideCount": 0,
        "ocrCompleted": 0,
        "articleCompleted": 0,
        "articleTarget": 0,
        "resumeStep": "detect-slides",
        "createdAt": project.try_get::<String, _>("created_at").map_err(|error| error.to_string())?,
        "updatedAt": project.try_get::<String, _>("updated_at").map_err(|error| error.to_string())?,
        "lastOpenedAt": project.try_get::<String, _>("updated_at").map_err(|error| error.to_string())?,
        "health": "ready"
    });

    if let Some(article) = article {
        let article_id: String = article.try_get("id").map_err(|error| error.to_string())?;
        let workflow_json: String = article
            .try_get("workflow_json")
            .map_err(|error| error.to_string())?;
        let last_opened =
            sqlx::query_scalar::<_, Option<String>>("SELECT json_extract(?, '$.lastOpenedAt')")
                .bind(&workflow_json)
                .fetch_one(pool)
                .await
                .map_err(|error| format!("記事の最終表示時刻を読めませんでした: {error}"))?;
        let last_visited =
            sqlx::query_scalar::<_, Option<String>>("SELECT json_extract(?, '$.lastVisitedStep')")
                .bind(&workflow_json)
                .fetch_one(pool)
                .await
                .map_err(|error| format!("記事のworkflowを読めませんでした: {error}"))?;
        let crop_json: Option<String> = article
            .try_get("crop_json")
            .map_err(|error| error.to_string())?;
        let ocr_id_expression = OCR_ID_FOR_SLIDE_SQL.replace("{slide_id}", "s.id");
        let stats_query = format!(
            "SELECT COUNT(s.id) AS slide_count,
                    SUM(CASE WHEN s.image_asset_id IS NULL THEN 1 ELSE 0 END) AS missing_images,
                    SUM(CASE WHEN TRIM(COALESCE(o.edited_text, o.raw_text, ''), ?) <> '' THEN 1 ELSE 0 END) AS ocr_completed,
                    SUM(CASE WHEN TRIM(COALESCE(json_extract(s.transcript_json, '$.raw'), ''), ?) <> '' THEN 1 ELSE 0 END) AS article_target,
                    SUM(CASE WHEN TRIM(COALESCE(json_extract(s.transcript_json, '$.articleBody'), ''), ?) <> '' THEN 1 ELSE 0 END) AS article_completed
             FROM slides s
             LEFT JOIN ocr_results o ON o.id = {ocr_id_expression} AND o.slide_id = s.id
             WHERE s.article_id = ? AND s.run_id = COALESCE(
               (SELECT slide_run_id FROM article_material_selections WHERE article_id = ?), s.run_id)"
        );
        let stats = sqlx::query(&stats_query)
            .bind(JS_TRIM_CHARACTERS)
            .bind(JS_TRIM_CHARACTERS)
            .bind(JS_TRIM_CHARACTERS)
            .bind(&article_id)
            .bind(&article_id)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("記事進捗を読めませんでした: {error}"))?;
        let slide_count: i64 = stats
            .try_get("slide_count")
            .map_err(|error| error.to_string())?;
        let missing_images: i64 = stats
            .try_get::<Option<i64>, _>("missing_images")
            .map_err(|error| error.to_string())?
            .unwrap_or_default();
        let ocr_completed: i64 = stats
            .try_get::<Option<i64>, _>("ocr_completed")
            .map_err(|error| error.to_string())?
            .unwrap_or_default();
        let article_target: i64 = stats
            .try_get::<Option<i64>, _>("article_target")
            .map_err(|error| error.to_string())?
            .unwrap_or_default();
        let article_completed: i64 = stats
            .try_get::<Option<i64>, _>("article_completed")
            .map_err(|error| error.to_string())?
            .unwrap_or_default();
        if thumbnail_path.is_none() {
            thumbnail_path = sqlx::query_scalar(
                "SELECT a.relative_path FROM slides s JOIN assets a ON a.id = s.image_asset_id WHERE s.article_id = ? ORDER BY s.position LIMIT 1",
            )
            .bind(&article_id)
            .fetch_optional(pool)
            .await
            .map_err(|error| format!("代表画像を読めませんでした: {error}"))?;
        }
        let has_detection: bool = article
            .try_get::<i64, _>("has_detection")
            .map_err(|error| error.to_string())?
            != 0;
        let resume_step = if last_visited.as_deref() == Some("crop") || crop_json.is_none() {
            "crop"
        } else if !has_detection || slide_count == 0 || missing_images > 0 {
            "detect-slides"
        } else if last_visited.as_deref() == Some("export") {
            "export"
        } else if last_visited.as_deref() == Some("article-review") {
            "article-review"
        } else {
            "generate-notes"
        };
        summary["slideCount"] = json!(slide_count);
        summary["ocrCompleted"] = json!(ocr_completed);
        summary["articleTarget"] = json!(article_target);
        summary["articleCompleted"] = json!(article_completed);
        summary["resumeStep"] = json!(resume_step);
        if let Some(last_opened) = last_opened {
            summary["lastOpenedAt"] = json!(last_opened);
        }
    }
    if let Some(thumbnail_path) = thumbnail_path {
        summary["thumbnailPath"] = json!(thumbnail_path);
    }
    Ok(json!({ "kind": "project", "summary": summary }))
}

pub(crate) async fn load_revision_snapshot(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<Value, String> {
    let article_rows =
        sqlx::query("SELECT id, revision FROM articles WHERE project_id = ? ORDER BY id")
            .bind(project_id)
            .fetch_all(pool)
            .await
            .map_err(|error| format!("記事revisionを読めませんでした: {error}"))?;
    let document_rows = sqlx::query(
        "SELECT d.article_id, d.revision FROM documents d
         JOIN articles a ON a.id = d.article_id WHERE a.project_id = ? ORDER BY d.article_id",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("document revisionを読めませんでした: {error}"))?;
    let slide_rows = sqlx::query(
        "SELECT s.id, s.revision FROM slides s
         JOIN articles a ON a.id = s.article_id WHERE a.project_id = ? ORDER BY s.id",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("スライドrevisionを読めませんでした: {error}"))?;
    let ocr_rows = sqlx::query(
        "SELECT s.id AS id,
                COALESCE(selected.revision, latest.revision) AS revision
         FROM slides s
         JOIN articles a ON a.id = s.article_id
         LEFT JOIN ocr_results selected ON selected.id = (
           SELECT ocr_result_id FROM slide_ocr_selections WHERE slide_id = s.id
         )
         LEFT JOIN ocr_results latest ON latest.id = (
           SELECT id FROM ocr_results WHERE slide_id = s.id ORDER BY created_at DESC, id DESC LIMIT 1
         )
         WHERE a.project_id = ? AND COALESCE(selected.revision, latest.revision) IS NOT NULL
         ORDER BY s.id",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("OCR revisionを読めませんでした: {error}"))?;

    let values = |rows: Vec<sqlx::sqlite::SqliteRow>, id_key: &str| -> Result<Value, String> {
        let mut map = Map::new();
        for row in rows {
            let id: String = row
                .try_get(id_key)
                .map_err(|error| format!("revision IDを読めませんでした: {error}"))?;
            let revision: i64 = row
                .try_get("revision")
                .map_err(|error| format!("revision値を読めませんでした: {error}"))?;
            map.insert(id, json!(revision));
        }
        Ok(Value::Object(map))
    };

    Ok(json!({
        "articleRevisions": values(article_rows, "id")?,
        "documentRevisions": values(document_rows, "article_id")?,
        "slideRevisions": values(slide_rows, "id")?,
        "ocrRevisions": values(ocr_rows, "id")?
    }))
}
