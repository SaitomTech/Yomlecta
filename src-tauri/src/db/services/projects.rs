use super::super::repositories::{
    load_project_from_indexes, load_project_summary, load_revision_snapshot, upsert_asset,
};
use super::super::services::require_rows_affected;
use super::super::{
    id_from, json_text, json_value, optional_string, validate_id, value_string, DbState,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::Row;
use std::path::Path;
use tauri::State;

const MAX_LIST_PAGE_SIZE: i64 = 100;

#[derive(Debug, Deserialize, Serialize)]
struct ListCursor {
    version: u8,
    kind: String,
    query: String,
    status: Option<String>,
    sort_value: String,
    id: String,
}

fn normalize_page_size(page_size: i64) -> Result<i64, String> {
    if !(1..=MAX_LIST_PAGE_SIZE).contains(&page_size) {
        return Err(format!(
            "VALIDATION_ERROR: pageSizeは1〜{MAX_LIST_PAGE_SIZE}の範囲で指定してください。"
        ));
    }
    Ok(page_size)
}

fn normalize_list_query(query: Option<String>) -> String {
    query.unwrap_or_default().trim().to_string()
}

fn encode_list_cursor(cursor: &ListCursor) -> Result<String, String> {
    let bytes = serde_json::to_vec(cursor)
        .map_err(|error| format!("ページトークンを作成できませんでした: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn decode_list_cursor(
    page_token: Option<String>,
    kind: &str,
    query: &str,
    status: Option<&str>,
) -> Result<Option<ListCursor>, String> {
    let Some(token) = page_token.filter(|token| !token.trim().is_empty()) else {
        return Ok(None);
    };
    if token.len() % 2 != 0 {
        return Err("INVALID_ARGUMENT: ページトークンが不正です。".to_string());
    }
    let mut bytes = Vec::with_capacity(token.len() / 2);
    for pair in token.as_bytes().chunks_exact(2) {
        let value = std::str::from_utf8(pair)
            .ok()
            .and_then(|pair| u8::from_str_radix(pair, 16).ok())
            .ok_or_else(|| "INVALID_ARGUMENT: ページトークンが不正です。".to_string())?;
        bytes.push(value);
    }
    let cursor: ListCursor = serde_json::from_slice(&bytes)
        .map_err(|_| "INVALID_ARGUMENT: ページトークンが不正です。".to_string())?;
    if cursor.version != 1
        || cursor.kind != kind
        || cursor.query != query
        || cursor.status.as_deref() != status
        || cursor.sort_value.is_empty()
        || cursor.id.is_empty()
    {
        return Err("INVALID_ARGUMENT: ページトークンが現在の一覧条件と一致しません。".to_string());
    }
    Ok(Some(cursor))
}

fn article_status_sql() -> &'static str {
    "CASE
       WHEN COALESCE(json_extract(a.workflow_json, '$.lastVisitedStep'), 'crop') = 'export'
         OR COALESCE(json_extract(a.workflow_json, '$.maxReachedStep'), 'crop') = 'export'
         THEN 'done'
       WHEN COALESCE(json_extract(a.workflow_json, '$.lastVisitedStep'), 'crop') = 'crop'
         THEN 'not-started'
       ELSE 'working'
     END"
}

fn article_list_cte() -> String {
    format!(
        "WITH article_list AS (
           SELECT a.id, a.project_id, a.title, a.created_at, a.updated_at,
                  p.title AS project_title,
                  COALESCE(json_extract(a.workflow_json, '$.lastVisitedStep'), 'crop') AS last_visited_step,
                  COALESCE(json_extract(a.workflow_json, '$.maxReachedStep'), 'crop') AS max_reached_step,
                  {status_sql} AS status
           FROM articles a
           JOIN projects p ON p.id = a.project_id
         )",
        status_sql = article_status_sql()
    )
}

fn normalize_article_status(status: Option<String>) -> Result<Option<String>, String> {
    let status = status.filter(|status| !status.trim().is_empty());
    if let Some(status) = status.as_deref() {
        if !matches!(status, "not-started" | "working" | "done") {
            return Err("VALIDATION_ERROR: 記事の状態が不正です。".to_string());
        }
    }
    Ok(status)
}

async fn insert_video_row(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    app_data_dir: &Path,
    project_id: &str,
    video: &Value,
) -> Result<(), String> {
    let video_id = value_string(video, "id")?;
    validate_id(video_id, "動画ID")?;
    let title = value_string(video, "title")?;
    let media = video
        .get("media")
        .ok_or_else(|| "動画mediaがありません。".to_string())?;
    let managed_path = value_string(media, "managedRelativePath")?;
    let created_at = value_string(video, "createdAt")?;
    let updated_at = value_string(video, "updatedAt")?;
    let asset_id = id_from("video", video_id);
    upsert_asset(tx, project_id, &asset_id, managed_path, app_data_dir).await?;
    let thumbnail_asset_id = if let Some(path) = media.get("thumbnailPath").and_then(Value::as_str)
    {
        let id = id_from("video-thumbnail", video_id);
        upsert_asset(tx, project_id, &id, path, app_data_dir).await?;
        Some(id)
    } else {
        None
    };
    sqlx::query(
        "INSERT INTO videos (id, project_id, asset_id, thumbnail_asset_id, title, media_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(video_id)
    .bind(project_id)
    .bind(asset_id)
    .bind(thumbnail_asset_id)
    .bind(title)
    .bind(serde_json::to_string(media).map_err(|error| format!("動画mediaをJSON化できませんでした: {error}"))?)
    .bind(created_at)
    .bind(updated_at)
    .execute(&mut **tx)
    .await
    .map_err(|error| format!("動画を作成できませんでした: {error}"))?;
    Ok(())
}

async fn insert_article_row(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    project_id: &str,
    article: &Value,
) -> Result<(), String> {
    let article_id = value_string(article, "id")?;
    validate_id(article_id, "記事ID")?;
    let source_video_id = optional_string(article, "sourceVideoId")
        .ok_or_else(|| "記事の参照元動画がありません。".to_string())?;
    let title = value_string(article, "title")?;
    let created_at = value_string(article, "createdAt")?;
    let updated_at = value_string(article, "updatedAt")?;
    let source_video_project: Option<String> =
        sqlx::query_scalar("SELECT project_id FROM videos WHERE id = ?")
            .bind(&source_video_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|error| format!("記事の参照元動画を確認できませんでした: {error}"))?;
    if source_video_project.as_deref() != Some(project_id) {
        return Err(
            "VALIDATION_ERROR: 記事の参照元動画が同じプロジェクトにありません。".to_string(),
        );
    }
    sqlx::query(
        "INSERT INTO articles (id, project_id, source_video_id, title, source_range_json,
         crop_json, perspective_crop_json, settings_json, workflow_json, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
    )
    .bind(article_id)
    .bind(project_id)
    .bind(source_video_id)
    .bind(title)
    .bind(json_value(article, "sourceRange", json!({ "startMs": 0, "endMs": 1 }))?)
    .bind(json_text(article.get("crop"))?)
    .bind(json_text(article.get("perspectiveCrop"))?)
    .bind(json_value(article, "settings", json!({}))?)
    .bind(json_value(article, "workflow", json!({}))?)
    .bind(created_at)
    .bind(updated_at)
    .execute(&mut **tx)
    .await
    .map_err(|error| format!("記事を作成できませんでした: {error}"))?;
    sqlx::query("INSERT INTO documents (article_id, article_json, revision) VALUES (?, ?, 0)")
        .bind(article_id)
        .bind(json_text(article.get("article"))?)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("記事documentを作成できませんでした: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn db_create_project(
    state: State<'_, DbState>,
    project_id: String,
    title: String,
    version: i64,
    created_at: String,
    updated_at: String,
) -> Result<Value, String> {
    validate_id(&project_id, "プロジェクトID")?;
    if title.trim().is_empty() {
        return Err("プロジェクト名を入力してください。".to_string());
    }
    sqlx::query(
        "INSERT INTO projects (id, title, version, active_article_id, created_at, updated_at, revision)
         VALUES (?, ?, ?, NULL, ?, ?, 0)",
    )
    .bind(&project_id)
    .bind(title.trim())
    .bind(version)
    .bind(created_at)
    .bind(updated_at)
    .execute(&state.pool)
    .await
    .map_err(|error| format!("プロジェクトを作成できませんでした: {error}"))?;
    Ok(json!({ "projectId": project_id, "revision": 0 }))
}

#[tauri::command]
pub async fn db_update_project(
    state: State<'_, DbState>,
    project_id: String,
    title: String,
    active_article_id: Option<String>,
    updated_at: String,
    expected_revision: Option<i64>,
) -> Result<Value, String> {
    validate_id(&project_id, "プロジェクトID")?;
    if title.trim().is_empty() {
        return Err("プロジェクト名を入力してください。".to_string());
    }
    let mut tx =
        state.pool.begin().await.map_err(|error| {
            format!("プロジェクト更新transactionを開始できませんでした: {error}")
        })?;
    let current: i64 = sqlx::query_scalar("SELECT revision FROM projects WHERE id = ?")
        .bind(&project_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| format!("プロジェクトrevisionを読めませんでした: {error}"))?
        .ok_or_else(|| "NOT_FOUND: プロジェクトが見つかりません。".to_string())?;
    if let Some(expected) = expected_revision {
        if expected != current {
            return Err(format!(
                "REVISION_CONFLICT: expected={expected}, actual={current}"
            ));
        }
    }
    if let Some(active_article_id) = active_article_id.as_deref() {
        validate_id(active_article_id, "active article ID")?;
        let belongs_to_project: Option<String> =
            sqlx::query_scalar("SELECT id FROM articles WHERE id = ? AND project_id = ?")
                .bind(active_article_id)
                .bind(&project_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|error| format!("active articleを確認できませんでした: {error}"))?;
        if belongs_to_project.is_none() {
            return Err(
                "VALIDATION_ERROR: active articleが同じプロジェクトにありません。".to_string(),
            );
        }
    }
    let next_revision = current + 1;
    let project_update = sqlx::query(
        "UPDATE projects SET title = ?, active_article_id = ?, updated_at = ?, revision = ?
         WHERE id = ? AND revision = ?",
    )
    .bind(title.trim())
    .bind(active_article_id)
    .bind(updated_at)
    .bind(next_revision)
    .bind(&project_id)
    .bind(current)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("プロジェクトを更新できませんでした: {error}"))?;
    require_rows_affected(&project_update, "プロジェクト")?;
    tx.commit()
        .await
        .map_err(|error| format!("プロジェクト更新をcommitできませんでした: {error}"))?;
    Ok(json!({ "projectId": project_id, "revision": next_revision }))
}

#[tauri::command]
pub async fn db_create_video_and_update_project(
    state: State<'_, DbState>,
    project_id: String,
    video: Value,
    updated_at: String,
    expected_project_revision: Option<i64>,
) -> Result<Value, String> {
    validate_id(&project_id, "プロジェクトID")?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| format!("動画追加transactionを開始できませんでした: {error}"))?;
    let current: i64 = sqlx::query_scalar("SELECT revision FROM projects WHERE id = ?")
        .bind(&project_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| format!("プロジェクトを確認できませんでした: {error}"))?
        .ok_or_else(|| "NOT_FOUND: プロジェクトが見つかりません。".to_string())?;
    if let Some(expected) = expected_project_revision {
        if expected != current {
            return Err(format!(
                "REVISION_CONFLICT: expected={expected}, actual={current}"
            ));
        }
    }
    insert_video_row(&mut tx, &state.app_data_dir, &project_id, &video).await?;
    let next = current + 1;
    let project_update = sqlx::query(
        "UPDATE projects SET updated_at = ?, revision = ? WHERE id = ? AND revision = ?",
    )
    .bind(updated_at)
    .bind(next)
    .bind(&project_id)
    .bind(current)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("プロジェクト更新時刻を更新できませんでした: {error}"))?;
    require_rows_affected(&project_update, "プロジェクト")?;
    tx.commit()
        .await
        .map_err(|error| format!("動画追加をcommitできませんでした: {error}"))?;
    Ok(json!({ "projectRevision": next }))
}

#[tauri::command]
pub async fn db_create_project_bundle(
    state: State<'_, DbState>,
    project: Value,
    video: Value,
    article: Value,
) -> Result<Value, String> {
    create_project_bundle(&state, project, video, article).await
}

pub(crate) async fn create_project_bundle(
    state: &DbState,
    project: Value,
    video: Value,
    article: Value,
) -> Result<Value, String> {
    let project_id = value_string(&project, "id")?;
    validate_id(project_id, "プロジェクトID")?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| format!("取り込みtransactionを開始できませんでした: {error}"))?;
    sqlx::query("INSERT INTO projects (id, title, version, active_article_id, created_at, updated_at, revision) VALUES (?, ?, ?, NULL, ?, ?, 0)")
        .bind(project_id)
        .bind(value_string(&project, "title")?.trim())
        .bind(project.get("version").and_then(Value::as_i64).unwrap_or(0))
        .bind(value_string(&project, "createdAt")?)
        .bind(value_string(&project, "updatedAt")?)
        .execute(&mut *tx).await
        .map_err(|error| format!("プロジェクトを作成できませんでした: {error}"))?;
    if value_string(&article, "id")? != value_string(&project, "activeArticleId")? {
        return Err("VALIDATION_ERROR: active articleが取り込み対象と一致しません。".to_string());
    }
    let video_id = value_string(&video, "id")?;
    validate_id(video_id, "動画ID")?;
    insert_video_row(&mut tx, &state.app_data_dir, project_id, &video).await?;
    insert_article_row(&mut tx, project_id, &article).await?;
    let active_article_update =
        sqlx::query("UPDATE projects SET active_article_id = ? WHERE id = ? AND revision = 0")
            .bind(value_string(&article, "id")?)
            .bind(project_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("active articleを設定できませんでした: {error}"))?;
    require_rows_affected(&active_article_update, "active article")?;
    tx.commit()
        .await
        .map_err(|error| format!("取り込みをcommitできませんでした: {error}"))?;
    Ok(json!({ "projectRevision": 0, "articleRevision": 0, "documentRevision": 0 }))
}

#[tauri::command]
pub async fn db_create_articles(
    state: State<'_, DbState>,
    project_id: String,
    articles: Value,
    updated_at: String,
    expected_project_revision: Option<i64>,
) -> Result<Value, String> {
    validate_id(&project_id, "プロジェクトID")?;
    let articles = articles
        .as_array()
        .ok_or_else(|| "記事配列がありません。".to_string())?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| format!("記事作成transactionを開始できませんでした: {error}"))?;
    let current: i64 = sqlx::query_scalar("SELECT revision FROM projects WHERE id = ?")
        .bind(&project_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| format!("プロジェクトを確認できませんでした: {error}"))?
        .ok_or_else(|| "NOT_FOUND: プロジェクトが見つかりません。".to_string())?;
    if let Some(expected) = expected_project_revision {
        if expected != current {
            return Err(format!(
                "REVISION_CONFLICT: expected={expected}, actual={current}"
            ));
        }
    }
    for article in articles {
        insert_article_row(&mut tx, &project_id, article).await?;
    }
    let next = current + 1;
    let project_update = sqlx::query(
        "UPDATE projects SET updated_at = ?, revision = ? WHERE id = ? AND revision = ?",
    )
    .bind(updated_at)
    .bind(next)
    .bind(&project_id)
    .bind(current)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("プロジェクト更新時刻を更新できませんでした: {error}"))?;
    require_rows_affected(&project_update, "プロジェクト")?;
    tx.commit()
        .await
        .map_err(|error| format!("記事作成をcommitできませんでした: {error}"))?;
    Ok(json!({ "projectRevision": next }))
}

#[tauri::command]
pub async fn db_update_article_content(
    state: State<'_, DbState>,
    project_id: String,
    project_updated_at: String,
    article: Value,
    slides: Value,
    expected_slide_revisions: Value,
    expected_project_revision: Option<i64>,
    expected_article_revision: Option<i64>,
    expected_document_revision: Option<i64>,
) -> Result<Value, String> {
    validate_id(&project_id, "プロジェクトID")?;
    let slide_values = slides
        .as_array()
        .ok_or_else(|| "スライド配列がありません。".to_string())?;
    let revision_map = expected_slide_revisions.as_object();
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| format!("記事本文更新transactionを開始できませんでした: {error}"))?;
    let project_revision: i64 = sqlx::query_scalar("SELECT revision FROM projects WHERE id = ?")
        .bind(&project_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| format!("プロジェクトrevisionを読めませんでした: {error}"))?;
    if let Some(expected) = expected_project_revision {
        if expected != project_revision {
            return Err(format!(
                "REVISION_CONFLICT: expected={expected}, actual={project_revision}"
            ));
        }
    }
    let article_id = value_string(&article, "id")?;
    let owner: Option<String> = sqlx::query_scalar("SELECT project_id FROM articles WHERE id = ?")
        .bind(article_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| format!("記事の所属を確認できませんでした: {error}"))?;
    if owner.as_deref() != Some(project_id.as_str()) {
        return Err("NOT_FOUND: 記事が見つかりません。".to_string());
    }
    let article_revision: i64 = sqlx::query_scalar("SELECT revision FROM articles WHERE id = ?")
        .bind(article_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| format!("記事revisionを読めませんでした: {error}"))?;
    if let Some(expected) = expected_article_revision {
        if expected != article_revision {
            return Err(format!(
                "REVISION_CONFLICT: expected={expected}, actual={article_revision}"
            ));
        }
    }
    let document_revision: i64 =
        sqlx::query_scalar("SELECT revision FROM documents WHERE article_id = ?")
            .bind(article_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|error| format!("document revisionを読めませんでした: {error}"))?;
    if let Some(expected) = expected_document_revision {
        if expected != document_revision {
            return Err(format!(
                "REVISION_CONFLICT: expected={expected}, actual={document_revision}"
            ));
        }
    }
    let mut slide_revisions = Vec::with_capacity(slide_values.len());
    for slide in slide_values {
        let slide_id = value_string(slide, "id")?;
        let current: i64 =
            sqlx::query_scalar("SELECT revision FROM slides WHERE id = ? AND article_id = ?")
                .bind(slide_id)
                .bind(article_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|error| format!("スライドrevisionを読めませんでした: {error}"))?
                .ok_or_else(|| format!("NOT_FOUND: スライドが見つかりません: {slide_id}"))?;
        if let Some(expected) = revision_map
            .and_then(|map| map.get(slide_id))
            .and_then(Value::as_i64)
        {
            if expected != current {
                return Err(format!(
                    "REVISION_CONFLICT: expected={expected}, actual={current}"
                ));
            }
        }
        sqlx::query("UPDATE slides SET transcript_json = ?, revision = ? WHERE id = ? AND article_id = ? AND revision = ?")
            .bind(json_text(slide.get("transcript"))?).bind(current + 1).bind(slide_id).bind(article_id).bind(current).execute(&mut *tx).await
            .map_err(|error| format!("スライド本文を更新できませんでした: {error}"))?;
        slide_revisions.push(json!({ "id": slide_id, "revision": current + 1 }));
    }
    sqlx::query("UPDATE articles SET title = ?, source_range_json = ?, crop_json = ?, perspective_crop_json = ?, settings_json = ?, workflow_json = ?, updated_at = ?, revision = ? WHERE id = ? AND revision = ?")
        .bind(value_string(&article, "title")?).bind(json_value(&article, "sourceRange", json!({ "startMs": 0, "endMs": 1 }))?).bind(json_text(article.get("crop"))?).bind(json_text(article.get("perspectiveCrop"))?).bind(json_value(&article, "settings", json!({}))?).bind(json_value(&article, "workflow", json!({}))?).bind(value_string(&article, "updatedAt")?).bind(article_revision + 1).bind(article_id).bind(article_revision).execute(&mut *tx).await
        .map_err(|error| format!("記事を更新できませんでした: {error}"))?;
    sqlx::query(
        "UPDATE documents SET article_json = ?, revision = ? WHERE article_id = ? AND revision = ?",
    )
    .bind(json_text(article.get("article"))?)
    .bind(document_revision + 1)
    .bind(article_id)
    .bind(document_revision)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("記事documentを更新できませんでした: {error}"))?;
    let project_update = sqlx::query(
        "UPDATE projects SET updated_at = ?, revision = ? WHERE id = ? AND revision = ?",
    )
    .bind(&project_updated_at)
    .bind(project_revision + 1)
    .bind(&project_id)
    .bind(project_revision)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("プロジェクトを更新できませんでした: {error}"))?;
    require_rows_affected(&project_update, "プロジェクト")?;
    tx.commit()
        .await
        .map_err(|error| format!("記事本文更新をcommitできませんでした: {error}"))?;
    Ok(
        json!({ "projectRevision": project_revision + 1, "articleRevision": article_revision + 1, "documentRevision": document_revision + 1, "slideRevisions": slide_revisions }),
    )
}

/// Updates an article's source settings and invalidates all downstream material
/// in one transaction.  Keeping this boundary in Rust prevents the UI from
/// observing a new crop with old analysis output (or the reverse).
#[tauri::command]
pub async fn db_update_article_source(
    state: State<'_, DbState>,
    project_id: String,
    article_id: String,
    source_range: Value,
    crop: Option<Value>,
    perspective_crop: Option<Value>,
    workflow: Value,
    updated_at: String,
    expected_project_revision: Option<i64>,
    expected_article_revision: Option<i64>,
    expected_document_revision: Option<i64>,
) -> Result<Value, String> {
    validate_id(&project_id, "プロジェクトID")?;
    validate_id(&article_id, "記事ID")?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| format!("記事入力更新transactionを開始できませんでした: {error}"))?;

    let owner: Option<String> = sqlx::query_scalar("SELECT project_id FROM articles WHERE id = ?")
        .bind(&article_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| format!("記事の所属を確認できませんでした: {error}"))?;
    if owner.as_deref() != Some(project_id.as_str()) {
        return Err("NOT_FOUND: 記事が見つかりません。".to_string());
    }

    let project_revision: i64 = sqlx::query_scalar("SELECT revision FROM projects WHERE id = ?")
        .bind(&project_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| format!("プロジェクトrevisionを読めませんでした: {error}"))?;
    if let Some(expected) = expected_project_revision {
        if expected != project_revision {
            return Err(format!(
                "REVISION_CONFLICT: expected={expected}, actual={project_revision}"
            ));
        }
    }
    let article_revision: i64 = sqlx::query_scalar("SELECT revision FROM articles WHERE id = ?")
        .bind(&article_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| format!("記事revisionを読めませんでした: {error}"))?;
    if let Some(expected) = expected_article_revision {
        if expected != article_revision {
            return Err(format!(
                "REVISION_CONFLICT: expected={expected}, actual={article_revision}"
            ));
        }
    }
    let document_revision: i64 =
        sqlx::query_scalar("SELECT revision FROM documents WHERE article_id = ?")
            .bind(&article_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|error| format!("document revisionを読めませんでした: {error}"))?;
    if let Some(expected) = expected_document_revision {
        if expected != document_revision {
            return Err(format!(
                "REVISION_CONFLICT: expected={expected}, actual={document_revision}"
            ));
        }
    }

    let old_slide_asset_ids: Vec<String> = sqlx::query_scalar(
        "SELECT image_asset_id FROM slides WHERE article_id = ? AND image_asset_id IS NOT NULL",
    )
    .bind(&article_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|error| format!("旧スライドassetを確認できませんでした: {error}"))?;
    let old_slide_ids: Vec<String> =
        sqlx::query_scalar("SELECT id FROM slides WHERE article_id = ?")
            .bind(&article_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(|error| format!("旧スライドIDを確認できませんでした: {error}"))?;
    sqlx::query("DELETE FROM slide_ocr_selections WHERE slide_id IN (SELECT id FROM slides WHERE article_id = ?)")
        .bind(&article_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("OCR採用結果を初期化できませんでした: {error}"))?;
    sqlx::query("DELETE FROM slides WHERE article_id = ?")
        .bind(&article_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("スライド解析結果を初期化できませんでした: {error}"))?;
    for asset_id in old_slide_asset_ids {
        sqlx::query("DELETE FROM assets WHERE id = ? AND project_id = ?")
            .bind(asset_id)
            .bind(&project_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("旧スライドassetを削除できませんでした: {error}"))?;
    }
    sqlx::query("UPDATE article_material_selections SET slide_run_id = NULL, transcription_run_id = NULL WHERE article_id = ?")
        .bind(&article_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("採用解析結果を初期化できませんでした: {error}"))?;

    let next_article_revision = article_revision + 1;
    sqlx::query(
        "UPDATE articles SET source_range_json = ?, crop_json = ?, perspective_crop_json = ?, workflow_json = ?, updated_at = ?, revision = ? WHERE id = ? AND revision = ?",
    )
    .bind(serde_json::to_string(&source_range).map_err(|error| format!("範囲をJSON化できませんでした: {error}"))?)
    .bind(crop.map(|value| serde_json::to_string(&value)).transpose().map_err(|error| format!("cropをJSON化できませんでした: {error}"))?)
    .bind(perspective_crop.map(|value| serde_json::to_string(&value)).transpose().map_err(|error| format!("台形補正をJSON化できませんでした: {error}"))?)
    .bind(serde_json::to_string(&workflow).map_err(|error| format!("workflowをJSON化できませんでした: {error}"))?)
    .bind(&updated_at)
    .bind(next_article_revision)
    .bind(&article_id)
    .bind(article_revision)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("記事入力を更新できませんでした: {error}"))?;

    let next_document_revision = document_revision + 1;
    sqlx::query("UPDATE documents SET article_json = NULL, revision = ? WHERE article_id = ? AND revision = ?")
        .bind(next_document_revision)
        .bind(&article_id)
        .bind(document_revision)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("記事documentを初期化できませんでした: {error}"))?;
    let next_project_revision = project_revision + 1;
    let project_update = sqlx::query(
        "UPDATE projects SET updated_at = ?, revision = ? WHERE id = ? AND revision = ?",
    )
    .bind(&updated_at)
    .bind(next_project_revision)
    .bind(&project_id)
    .bind(project_revision)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("プロジェクト更新時刻を更新できませんでした: {error}"))?;
    require_rows_affected(&project_update, "プロジェクト")?;
    tx.commit()
        .await
        .map_err(|error| format!("記事入力更新をcommitできませんでした: {error}"))?;
    Ok(json!({
        "projectRevision": next_project_revision,
        "articleRevision": next_article_revision,
        "documentRevision": next_document_revision,
        "removedSlideIds": old_slide_ids
    }))
}

#[tauri::command]
pub async fn db_delete_article(
    state: State<'_, DbState>,
    project_id: String,
    article_id: String,
) -> Result<(), String> {
    validate_id(&project_id, "プロジェクトID")?;
    validate_id(&article_id, "記事ID")?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| format!("記事削除transactionを開始できませんでした: {error}"))?;
    let owner: Option<String> = sqlx::query_scalar("SELECT project_id FROM articles WHERE id = ?")
        .bind(&article_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| format!("記事の所属を確認できませんでした: {error}"))?;
    if owner.as_deref() != Some(project_id.as_str()) {
        return Err("NOT_FOUND: 記事が見つかりません。".to_string());
    }
    sqlx::query("DELETE FROM slide_ocr_selections WHERE slide_id IN (SELECT id FROM slides WHERE article_id = ?)")
        .bind(&article_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("記事のOCR採用結果を削除できませんでした: {error}"))?;
    sqlx::query("DELETE FROM articles WHERE id = ?")
        .bind(&article_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("記事を削除できませんでした: {error}"))?;
    sqlx::query("DELETE FROM assets WHERE project_id = ? AND (relative_path LIKE ? OR relative_path LIKE ?)")
        .bind(&project_id)
        .bind(format!("articles/{article_id}/%"))
        .bind(format!("%/articles/{article_id}/%"))
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("記事assetを削除できませんでした: {error}"))?;
    sqlx::query("UPDATE projects SET active_article_id = CASE WHEN active_article_id = ? THEN (SELECT id FROM articles WHERE project_id = ? ORDER BY created_at, id LIMIT 1) ELSE active_article_id END, revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
        .bind(&article_id)
        .bind(&project_id)
        .bind(&project_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("プロジェクト状態を更新できませんでした: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("記事削除をcommitできませんでした: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn db_delete_video(
    state: State<'_, DbState>,
    project_id: String,
    video_id: String,
) -> Result<(), String> {
    validate_id(&project_id, "プロジェクトID")?;
    validate_id(&video_id, "動画ID")?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| format!("動画削除transactionを開始できませんでした: {error}"))?;
    let owner: Option<String> = sqlx::query_scalar("SELECT project_id FROM videos WHERE id = ?")
        .bind(&video_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| format!("動画の所属を確認できませんでした: {error}"))?;
    if owner.as_deref() != Some(project_id.as_str()) {
        return Err("NOT_FOUND: 動画が見つかりません。".to_string());
    }
    let article_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM articles WHERE project_id = ? AND source_video_id = ?",
    )
    .bind(&project_id)
    .bind(&video_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| format!("動画の参照記事を確認できませんでした: {error}"))?;
    if article_count > 0 {
        return Err(
            "CONFLICT: 記事が参照している動画は削除できません。先に記事を削除してください。"
                .to_string(),
        );
    }
    let asset_ids = sqlx::query("SELECT asset_id, thumbnail_asset_id FROM videos WHERE id = ?")
        .bind(&video_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| format!("動画assetを確認できませんでした: {error}"))?;
    let asset_id: String = asset_ids
        .try_get("asset_id")
        .map_err(|error| error.to_string())?;
    let thumbnail_asset_id: Option<String> = asset_ids
        .try_get("thumbnail_asset_id")
        .map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM videos WHERE id = ?")
        .bind(&video_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("動画を削除できませんでした: {error}"))?;
    sqlx::query("DELETE FROM assets WHERE project_id = ? AND id = ?")
        .bind(&project_id)
        .bind(&asset_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("動画assetを削除できませんでした: {error}"))?;
    if let Some(thumbnail_asset_id) = thumbnail_asset_id {
        sqlx::query("DELETE FROM assets WHERE project_id = ? AND id = ?")
            .bind(&project_id)
            .bind(thumbnail_asset_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("動画サムネイルassetを削除できませんでした: {error}"))?;
    }
    sqlx::query("DELETE FROM assets WHERE project_id = ? AND (relative_path LIKE ? OR relative_path LIKE ?)")
        .bind(&project_id)
        .bind(format!("videos/{video_id}/%"))
        .bind(format!("%/videos/{video_id}/%"))
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("動画assetを削除できませんでした: {error}"))?;
    sqlx::query(
        "UPDATE projects SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    )
    .bind(&project_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("プロジェクト状態を更新できませんでした: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("動画削除をcommitできませんでした: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn db_load_project(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<Value, String> {
    validate_id(&project_id, "プロジェクトID")?;
    let project = load_project_from_indexes(&state.pool, &project_id).await?;
    let revision: i64 = sqlx::query_scalar("SELECT revision FROM projects WHERE id = ?")
        .bind(&project_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|error| format!("プロジェクトrevisionを読めませんでした: {error}"))?;
    let revision_snapshot = load_revision_snapshot(&state.pool, &project_id).await?;
    Ok(json!({
        "project": project,
        "revision": revision,
        "articleRevisions": revision_snapshot["articleRevisions"].clone(),
        "documentRevisions": revision_snapshot["documentRevisions"].clone(),
        "slideRevisions": revision_snapshot["slideRevisions"].clone(),
        "ocrRevisions": revision_snapshot["ocrRevisions"].clone()
    }))
}

#[tauri::command]
pub async fn db_list_projects(
    state: State<'_, DbState>,
    page_size: i64,
    page_token: Option<String>,
    query: Option<String>,
) -> Result<Value, String> {
    list_projects_page(&state, page_size, page_token, query).await
}

async fn list_projects_page(
    state: &DbState,
    page_size: i64,
    page_token: Option<String>,
    query: Option<String>,
) -> Result<Value, String> {
    let page_size = normalize_page_size(page_size)?;
    let query = normalize_list_query(query);
    let cursor = decode_list_cursor(page_token, "projects", &query, None)?;

    let project_list_cte = "WITH project_list AS (
       SELECT p.id, p.title,
              COALESCE(
                (SELECT json_extract(a.workflow_json, '$.lastOpenedAt')
                 FROM articles a
                 WHERE a.project_id = p.id AND a.id = COALESCE(
                   p.active_article_id,
                   (SELECT id FROM articles WHERE project_id = p.id ORDER BY created_at, id LIMIT 1)
                 )
                 LIMIT 1),
                p.updated_at
              ) AS last_opened_at
       FROM projects p
     )";
    let filter_clause = if query.is_empty() {
        String::new()
    } else {
        " WHERE instr(lower(title), lower(?)) > 0".to_string()
    };
    let count_sql = format!("{project_list_cte} SELECT COUNT(*) FROM project_list{filter_clause}");
    let mut count_query = sqlx::query_scalar::<_, i64>(&count_sql);
    if !query.is_empty() {
        count_query = count_query.bind(&query);
    }
    let total = count_query
        .fetch_one(&state.pool)
        .await
        .map_err(|error| format!("プロジェクト件数を読めませんでした: {error}"))?;

    let cursor_clause = if cursor.is_some() {
        if filter_clause.is_empty() {
            " WHERE (last_opened_at < ? OR (last_opened_at = ? AND id > ?))"
        } else {
            " AND (last_opened_at < ? OR (last_opened_at = ? AND id > ?))"
        }
    } else {
        ""
    };
    let sql = format!(
        "{project_list_cte}
         SELECT id, last_opened_at FROM project_list{filter_clause}{cursor_clause}
         ORDER BY last_opened_at DESC, id ASC LIMIT ?"
    );
    let mut list_query = sqlx::query(&sql);
    if !query.is_empty() {
        list_query = list_query.bind(&query);
    }
    if let Some(cursor) = cursor.as_ref() {
        list_query = list_query
            .bind(&cursor.sort_value)
            .bind(&cursor.sort_value)
            .bind(&cursor.id);
    }
    let rows = list_query
        .bind(page_size + 1)
        .fetch_all(&state.pool)
        .await
        .map_err(|error| format!("プロジェクト一覧を読めませんでした: {error}"))?;
    let has_next_page = rows.len() > page_size as usize;
    let rows = rows
        .into_iter()
        .take(page_size as usize)
        .collect::<Vec<_>>();

    let mut projects = Vec::with_capacity(rows.len());
    for row in &rows {
        let id: String = row
            .try_get("id")
            .map_err(|error| format!("プロジェクトIDを読めませんでした: {error}"))?;
        match load_project_summary(&state.pool, &id).await {
            Ok(summary) => projects.push(summary),
            Err(error) => projects.push(json!({
                "kind": "invalid",
                "id": id,
                "error": error
            })),
        }
    }
    let next_page_token = if has_next_page {
        if let Some(row) = rows.last() {
            let sort_value: String = row
                .try_get("last_opened_at")
                .map_err(|error| format!("プロジェクト最終閲覧日時を読めませんでした: {error}"))?;
            let id: String = row
                .try_get("id")
                .map_err(|error| format!("プロジェクトIDを読めませんでした: {error}"))?;
            Some(encode_list_cursor(&ListCursor {
                version: 1,
                kind: "projects".to_string(),
                query: query.clone(),
                status: None,
                sort_value,
                id,
            })?)
        } else {
            None
        }
    } else {
        None
    };
    Ok(json!({
        "items": projects,
        "pageInfo": {
            "pageSize": page_size,
            "total": total,
            "hasNextPage": has_next_page
        },
        "nextPageToken": next_page_token
    }))
}

#[tauri::command]
pub async fn db_list_articles(
    state: State<'_, DbState>,
    page_size: i64,
    page_token: Option<String>,
    query: Option<String>,
    status: Option<String>,
) -> Result<Value, String> {
    list_articles_page(&state, page_size, page_token, query, status).await
}

async fn list_articles_page(
    state: &DbState,
    page_size: i64,
    page_token: Option<String>,
    query: Option<String>,
    status: Option<String>,
) -> Result<Value, String> {
    let page_size = normalize_page_size(page_size)?;
    let query = normalize_list_query(query);
    let status = normalize_article_status(status)?;
    let cursor = decode_list_cursor(page_token, "articles", &query, status.as_deref())?;
    let cte = article_list_cte();

    let mut conditions = Vec::new();
    let mut filter_params = Vec::new();
    if !query.is_empty() {
        conditions.push(
            "(instr(lower(title), lower(?)) > 0 OR instr(lower(project_title), lower(?)) > 0)"
                .to_string(),
        );
        filter_params.push(query.clone());
        filter_params.push(query.clone());
    }
    if let Some(status) = status.as_ref() {
        conditions.push("status = ?".to_string());
        filter_params.push(status.clone());
    }
    let filter_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conditions.join(" AND "))
    };
    let count_sql = format!("{cte} SELECT COUNT(*) FROM article_list{filter_clause}");
    let mut count_query = sqlx::query_scalar::<_, i64>(&count_sql);
    for parameter in &filter_params {
        count_query = count_query.bind(parameter);
    }
    let total = count_query
        .fetch_one(&state.pool)
        .await
        .map_err(|error| format!("記事件数を読めませんでした: {error}"))?;

    let cursor_clause = if cursor.is_some() {
        if filter_clause.is_empty() {
            " WHERE (created_at < ? OR (created_at = ? AND id < ?))"
        } else {
            " AND (created_at < ? OR (created_at = ? AND id < ?))"
        }
    } else {
        ""
    };
    let list_sql = format!(
        "{cte}
         SELECT id, project_id, title, project_title, created_at, updated_at,
                last_visited_step, max_reached_step, status
         FROM article_list{filter_clause}{cursor_clause}
         ORDER BY created_at DESC, id DESC LIMIT ?"
    );
    let mut list_query = sqlx::query(&list_sql);
    for parameter in &filter_params {
        list_query = list_query.bind(parameter);
    }
    if let Some(cursor) = cursor.as_ref() {
        list_query = list_query
            .bind(&cursor.sort_value)
            .bind(&cursor.sort_value)
            .bind(&cursor.id);
    }
    let rows = list_query
        .bind(page_size + 1)
        .fetch_all(&state.pool)
        .await
        .map_err(|error| format!("記事一覧を読めませんでした: {error}"))?;
    let has_next_page = rows.len() > page_size as usize;
    let rows = rows
        .into_iter()
        .take(page_size as usize)
        .collect::<Vec<_>>();

    let items = rows
        .iter()
        .map(|row| {
            Ok(json!({
                "articleId": row.try_get::<String, _>("id").map_err(|error| error.to_string())?,
                "projectId": row.try_get::<String, _>("project_id").map_err(|error| error.to_string())?,
                "title": row.try_get::<String, _>("title").map_err(|error| error.to_string())?,
                "projectTitle": row.try_get::<String, _>("project_title").map_err(|error| error.to_string())?,
                "createdAt": row.try_get::<String, _>("created_at").map_err(|error| error.to_string())?,
                "updatedAt": row.try_get::<String, _>("updated_at").map_err(|error| error.to_string())?,
                "lastVisitedStep": row.try_get::<String, _>("last_visited_step").map_err(|error| error.to_string())?,
                "maxReachedStep": row.try_get::<String, _>("max_reached_step").map_err(|error| error.to_string())?,
                "status": row.try_get::<String, _>("status").map_err(|error| error.to_string())?
            }))
        })
        .collect::<Result<Vec<_>, String>>()?;

    let next_page_token = if has_next_page {
        if let Some(row) = rows.last() {
            let sort_value: String = row
                .try_get("created_at")
                .map_err(|error| format!("記事作成日時を読めませんでした: {error}"))?;
            let id: String = row
                .try_get("id")
                .map_err(|error| format!("記事IDを読めませんでした: {error}"))?;
            Some(encode_list_cursor(&ListCursor {
                version: 1,
                kind: "articles".to_string(),
                query: query.clone(),
                status: status.clone(),
                sort_value,
                id,
            })?)
        } else {
            None
        }
    } else {
        None
    };
    Ok(json!({
        "items": items,
        "pageInfo": {
            "pageSize": page_size,
            "total": total,
            "hasNextPage": has_next_page
        },
        "nextPageToken": next_page_token
    }))
}

#[tauri::command]
pub async fn db_delete_project(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<(), String> {
    validate_id(&project_id, "プロジェクトID")?;
    let mut tx =
        state.pool.begin().await.map_err(|error| {
            format!("プロジェクト削除transactionを開始できませんでした: {error}")
        })?;
    sqlx::query("DELETE FROM slide_ocr_selections WHERE slide_id IN (SELECT s.id FROM slides s JOIN articles a ON a.id = s.article_id WHERE a.project_id = ?)")
        .bind(&project_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("プロジェクトOCR採用結果を削除できませんでした: {error}"))?;
    sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(project_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("プロジェクトを削除できませんでした: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("プロジェクト削除をcommitできませんでした: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn db_check_storage_reference(
    state: State<'_, DbState>,
    reference_type: String,
    project_id: String,
    asset_id: Option<String>,
) -> Result<Value, String> {
    validate_id(&project_id, "プロジェクトID")?;
    let referenced = match reference_type.as_str() {
        "project" => {
            sqlx::query_scalar::<_, Option<String>>("SELECT id FROM projects WHERE id = ?")
                .bind(&project_id)
                .fetch_one(&state.pool)
                .await
                .map_err(|error| format!("プロジェクト参照を確認できませんでした: {error}"))?
                .is_some()
        }
        "article" | "video" => {
            let asset_id = asset_id.ok_or_else(|| "asset IDがありません。".to_string())?;
            validate_id(&asset_id, "asset ID")?;
            let table = if reference_type == "article" {
                "articles"
            } else {
                "videos"
            };
            let query = format!("SELECT id FROM {table} WHERE id = ? AND project_id = ?");
            sqlx::query_scalar::<_, Option<String>>(&query)
                .bind(asset_id)
                .bind(&project_id)
                .fetch_one(&state.pool)
                .await
                .map_err(|error| format!("asset参照を確認できませんでした: {error}"))?
                .is_some()
        }
        _ => return Err("VALIDATION_ERROR: 不正な参照種別です。".to_string()),
    };
    Ok(json!({ "referenced": referenced }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;
    use std::path::PathBuf;

    async fn test_state() -> DbState {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create in-memory database");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("apply migrations");
        DbState {
            pool,
            app_data_dir: PathBuf::from("/tmp/yomlecta-list-test"),
        }
    }

    async fn insert_article(state: &DbState, id: &str, created_at: &str, title: &str) {
        sqlx::query(
            "INSERT INTO projects (id, title, version, created_at, updated_at)
             VALUES ('project', 'Project', 1, 'created', 'updated')
             ON CONFLICT(id) DO NOTHING",
        )
        .execute(&state.pool)
        .await
        .expect("insert project");
        sqlx::query(
            "INSERT INTO articles (id, project_id, title, source_range_json, settings_json, workflow_json, created_at, updated_at)
             VALUES (?, 'project', ?, '{}', '{}', ?, ?, ?)",
        )
        .bind(id)
        .bind(title)
        .bind(
            serde_json::to_string(&json!({
                "lastVisitedStep": "crop",
                "maxReachedStep": "crop"
            }))
            .expect("serialize workflow"),
        )
        .bind(created_at)
        .bind(created_at)
        .execute(&state.pool)
        .await
        .expect("insert article");
    }

    #[test]
    fn article_cursor_returns_stable_pages_and_validates_filters() {
        tauri::async_runtime::block_on(async {
            let state = test_state().await;
            insert_article(&state, "article-1", "2026-09-01", "Old").await;
            insert_article(&state, "article-2", "2026-09-02", "Middle").await;
            insert_article(&state, "article-3", "2026-09-03", "Newest").await;

            let first = list_articles_page(&state, 2, None, None, None)
                .await
                .expect("read first article page");
            assert_eq!(first["items"].as_array().expect("items").len(), 2);
            assert_eq!(first["items"][0]["articleId"], "article-3");
            assert_eq!(first["items"][1]["articleId"], "article-2");
            assert_eq!(first["pageInfo"]["total"], 3);
            assert_eq!(first["pageInfo"]["hasNextPage"], true);

            let token = first["nextPageToken"]
                .as_str()
                .expect("next page token")
                .to_string();
            let second = list_articles_page(&state, 2, Some(token.clone()), None, None)
                .await
                .expect("read second article page");
            assert_eq!(second["items"].as_array().expect("items").len(), 1);
            assert_eq!(second["items"][0]["articleId"], "article-1");
            assert_eq!(second["nextPageToken"], Value::Null);

            let mismatch =
                list_articles_page(&state, 2, Some(token), Some("different".to_string()), None)
                    .await
                    .expect_err("reject token for a different query");
            assert!(mismatch.contains("ページトークン"));

            let filtered =
                list_articles_page(&state, 2, None, None, Some("not-started".to_string()))
                    .await
                    .expect("filter article status");
            assert_eq!(filtered["pageInfo"]["total"], 3);
            assert_eq!(filtered["items"][0]["status"], "not-started");
        });
    }

    #[test]
    fn project_cursor_returns_summaries_in_last_opened_order() {
        tauri::async_runtime::block_on(async {
            let state = test_state().await;
            for (id, updated_at) in [
                ("project-1", "2026-09-01"),
                ("project-2", "2026-09-02"),
                ("project-3", "2026-09-03"),
            ] {
                sqlx::query(
                    "INSERT INTO projects (id, title, version, created_at, updated_at)
                     VALUES (?, ?, 1, ?, ?)",
                )
                .bind(id)
                .bind(id)
                .bind(updated_at)
                .bind(updated_at)
                .execute(&state.pool)
                .await
                .expect("insert project");
            }

            let first = list_projects_page(&state, 2, None, None)
                .await
                .expect("read first project page");
            assert_eq!(first["items"].as_array().expect("items").len(), 2);
            assert_eq!(first["items"][0]["summary"]["id"], "project-3");
            assert_eq!(first["items"][1]["summary"]["id"], "project-2");
            assert_eq!(first["pageInfo"]["total"], 3);

            let second = list_projects_page(
                &state,
                2,
                Some(
                    first["nextPageToken"]
                        .as_str()
                        .expect("next page token")
                        .to_string(),
                ),
                None,
            )
            .await
            .expect("read second project page");
            assert_eq!(second["items"].as_array().expect("items").len(), 1);
            assert_eq!(second["items"][0]["summary"]["id"], "project-1");
        });
    }
}
