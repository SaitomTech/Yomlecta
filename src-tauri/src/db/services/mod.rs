use super::{json_text, json_value, validate_id, value_string};
use serde_json::{json, Value};

pub mod analysis;
pub mod documents;
pub mod projects;

pub(crate) async fn ensure_article_in_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    article_id: &str,
) -> Result<(), String> {
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM articles WHERE id = ?")
        .bind(article_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| format!("記事を確認できませんでした: {error}"))?;
    if exists.is_none() {
        return Err("NOT_FOUND: 記事が見つかりません。".to_string());
    }
    Ok(())
}

pub(crate) async fn ensure_article_in_project(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    project_id: &str,
    article_id: &str,
) -> Result<(), String> {
    let owner: Option<String> = sqlx::query_scalar("SELECT project_id FROM articles WHERE id = ?")
        .bind(article_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| format!("記事の所属を確認できませんでした: {error}"))?;
    if owner.as_deref() != Some(project_id) {
        return Err("NOT_FOUND: 記事が見つかりません。".to_string());
    }
    Ok(())
}

pub(crate) async fn ensure_project_revision(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    project_id: &str,
    expected_revision: Option<i64>,
) -> Result<i64, String> {
    let current: Option<i64> = sqlx::query_scalar("SELECT revision FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| format!("プロジェクトrevisionを読めませんでした: {error}"))?;
    let current = current.ok_or_else(|| "NOT_FOUND: プロジェクトが見つかりません。".to_string())?;
    if let Some(expected) = expected_revision {
        if expected != current {
            return Err(format!(
                "REVISION_CONFLICT: expected={expected}, actual={current}"
            ));
        }
    }
    Ok(current)
}

pub(crate) async fn ensure_document_revision(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    article_id: &str,
    expected_revision: Option<i64>,
) -> Result<i64, String> {
    let current: Option<i64> =
        sqlx::query_scalar("SELECT revision FROM documents WHERE article_id = ?")
            .bind(article_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|error| format!("document revisionを読めませんでした: {error}"))?;
    let current = current.ok_or_else(|| "NOT_FOUND: 原稿が見つかりません。".to_string())?;
    if let Some(expected) = expected_revision {
        if expected != current {
            return Err(format!(
                "REVISION_CONFLICT: expected={expected}, actual={current}"
            ));
        }
    }
    Ok(current)
}

pub(crate) fn require_rows_affected(
    result: &sqlx::sqlite::SqliteQueryResult,
    label: &str,
) -> Result<(), String> {
    if result.rows_affected() != 1 {
        return Err(format!("CONFLICT: {label}を更新できませんでした。"));
    }
    Ok(())
}

pub(crate) async fn ensure_article_revision(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    article_id: &str,
    expected_revision: Option<i64>,
) -> Result<i64, String> {
    let current: i64 = sqlx::query_scalar("SELECT revision FROM articles WHERE id = ?")
        .bind(article_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|error| format!("記事revisionを読めませんでした: {error}"))?;
    if let Some(expected) = expected_revision {
        if expected != current {
            return Err(format!(
                "REVISION_CONFLICT: expected={expected}, actual={current}"
            ));
        }
    }
    Ok(current)
}

pub(crate) async fn insert_analysis_run(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: &str,
    article_id: &str,
    kind: &str,
    result: Option<&Value>,
) -> Result<(), String> {
    validate_run_kind(kind)?;
    let result_json = result
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| format!("解析結果をJSON化できませんでした: {error}"))?;
    sqlx::query(
        "INSERT INTO analysis_runs (id, article_id, kind, result_json, started_at)
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
    )
    .bind(run_id)
    .bind(article_id)
    .bind(kind)
    .bind(result_json)
    .execute(&mut **tx)
    .await
    .map_err(|error| format!("解析runを保存できませんでした: {error}"))?;
    Ok(())
}

pub(crate) fn validate_run_kind(kind: &str) -> Result<(), String> {
    match kind {
        "slide_detection" | "transcription" | "ocr" | "body_generation" | "summary_generation"
        | "chapter_generation" => Ok(()),
        _ => Err(format!("不正な解析種別です: {kind}")),
    }
}

pub(crate) async fn update_article_metadata_in_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    project_id: &str,
    project_title: &str,
    active_article_id: Option<&str>,
    project_updated_at: &str,
    article: &Value,
    expected_project_revision: Option<i64>,
    expected_article_revision: i64,
) -> Result<(i64, i64), String> {
    let project_revision: i64 = sqlx::query_scalar("SELECT revision FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|error| format!("プロジェクトrevisionを読めませんでした: {error}"))?;
    if let Some(expected) = expected_project_revision {
        if expected != project_revision {
            return Err(format!(
                "REVISION_CONFLICT: expected={expected}, actual={project_revision}"
            ));
        }
    }
    let article_id = value_string(article, "id")?;
    sqlx::query("UPDATE articles SET title = ?, source_range_json = ?, crop_json = ?, perspective_crop_json = ?, settings_json = ?, workflow_json = ?, updated_at = ?, revision = ? WHERE id = ? AND project_id = ? AND revision = ?")
        .bind(value_string(article, "title")?)
        .bind(json_value(article, "sourceRange", json!({ "startMs": 0, "endMs": 1 }))?)
        .bind(json_text(article.get("crop"))?)
        .bind(json_text(article.get("perspectiveCrop"))?)
        .bind(json_value(article, "settings", json!({} ))?)
        .bind(json_value(article, "workflow", json!({} ))?)
        .bind(value_string(article, "updatedAt")?)
        .bind(expected_article_revision + 1)
        .bind(article_id)
        .bind(project_id)
        .bind(expected_article_revision)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("記事metadataを更新できませんでした: {error}"))?;
    if active_article_id.is_some() {
        let active = active_article_id.unwrap();
        validate_id(active, "active article ID")?;
        let belongs: Option<String> =
            sqlx::query_scalar("SELECT id FROM articles WHERE id = ? AND project_id = ?")
                .bind(active)
                .bind(project_id)
                .fetch_optional(&mut **tx)
                .await
                .map_err(|error| format!("active articleを確認できませんでした: {error}"))?;
        if belongs.is_none() {
            return Err(
                "VALIDATION_ERROR: active articleが同じプロジェクトにありません。".to_string(),
            );
        }
    }
    sqlx::query("UPDATE projects SET title = ?, active_article_id = ?, updated_at = ?, revision = ? WHERE id = ? AND revision = ?")
        .bind(project_title.trim())
        .bind(active_article_id)
        .bind(project_updated_at)
        .bind(project_revision + 1)
        .bind(project_id)
        .bind(project_revision)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("プロジェクトmetadataを更新できませんでした: {error}"))?;
    Ok((project_revision + 1, expected_article_revision + 1))
}
