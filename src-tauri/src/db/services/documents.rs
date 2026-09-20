use super::super::services::{
    ensure_article_in_project, ensure_article_revision, ensure_document_revision,
    ensure_project_revision, insert_analysis_run, require_rows_affected,
};
use super::super::{json_text, json_value, validate_id, value_string, DbState};
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub async fn db_update_article_title(
    state: State<'_, DbState>,
    project_id: String,
    article_id: String,
    title: String,
    updated_at: String,
    expected_project_revision: Option<i64>,
    expected_article_revision: Option<i64>,
    expected_document_revision: Option<i64>,
) -> Result<Value, String> {
    update_article_title(
        &state,
        project_id,
        article_id,
        title,
        updated_at,
        expected_project_revision,
        expected_article_revision,
        expected_document_revision,
    )
    .await
}

pub(crate) async fn update_article_title(
    state: &DbState,
    project_id: String,
    article_id: String,
    title: String,
    updated_at: String,
    expected_project_revision: Option<i64>,
    expected_article_revision: Option<i64>,
    expected_document_revision: Option<i64>,
) -> Result<Value, String> {
    validate_id(&project_id, "プロジェクトID")?;
    validate_id(&article_id, "記事ID")?;
    let title = title.trim();
    if title.is_empty() {
        return Err("VALIDATION_ERROR: 記事タイトルを入力してください。".to_string());
    }
    let mut tx =
        state.pool.begin().await.map_err(|error| {
            format!("記事タイトル更新transactionを開始できませんでした: {error}")
        })?;
    let project_revision =
        ensure_project_revision(&mut tx, &project_id, expected_project_revision).await?;
    ensure_article_in_project(&mut tx, &project_id, &article_id).await?;
    let article_revision =
        ensure_article_revision(&mut tx, &article_id, expected_article_revision).await?;
    let document_revision =
        ensure_document_revision(&mut tx, &article_id, expected_document_revision).await?;

    let article_update = sqlx::query(
        "UPDATE articles SET title = ?, updated_at = ?, revision = ?
         WHERE id = ? AND project_id = ? AND revision = ?",
    )
    .bind(title)
    .bind(&updated_at)
    .bind(article_revision + 1)
    .bind(&article_id)
    .bind(&project_id)
    .bind(article_revision)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("記事タイトルを更新できませんでした: {error}"))?;
    require_rows_affected(&article_update, "記事タイトル")?;

    let document_update = sqlx::query(
        "UPDATE documents SET article_json = CASE
           WHEN article_json IS NULL THEN json_object('title', ?)
           ELSE json_set(article_json, '$.title', ?)
         END, revision = ? WHERE article_id = ? AND revision = ?",
    )
    .bind(title)
    .bind(title)
    .bind(document_revision + 1)
    .bind(&article_id)
    .bind(document_revision)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("原稿タイトルを更新できませんでした: {error}"))?;
    require_rows_affected(&document_update, "原稿タイトル")?;

    let project_update = sqlx::query(
        "UPDATE projects SET updated_at = ?, revision = ? WHERE id = ? AND revision = ?",
    )
    .bind(&updated_at)
    .bind(project_revision + 1)
    .bind(&project_id)
    .bind(project_revision)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("プロジェクト更新時刻を更新できませんでした: {error}"))?;
    require_rows_affected(&project_update, "プロジェクト")?;

    tx.commit()
        .await
        .map_err(|error| format!("記事タイトル更新をcommitできませんでした: {error}"))?;
    Ok(json!({
        "projectRevision": project_revision + 1,
        "articleRevision": article_revision + 1,
        "documentRevision": document_revision + 1
    }))
}

#[tauri::command]
pub async fn db_update_article_workflow(
    state: State<'_, DbState>,
    project_id: String,
    article_id: String,
    active_article_id: Option<String>,
    workflow: Value,
    updated_at: String,
    expected_project_revision: Option<i64>,
    expected_article_revision: Option<i64>,
) -> Result<Value, String> {
    update_article_workflow(
        &state,
        project_id,
        article_id,
        active_article_id,
        workflow,
        updated_at,
        expected_project_revision,
        expected_article_revision,
    )
    .await
}

pub(crate) async fn update_article_workflow(
    state: &DbState,
    project_id: String,
    article_id: String,
    active_article_id: Option<String>,
    workflow: Value,
    updated_at: String,
    expected_project_revision: Option<i64>,
    expected_article_revision: Option<i64>,
) -> Result<Value, String> {
    validate_id(&project_id, "プロジェクトID")?;
    validate_id(&article_id, "記事ID")?;
    if !workflow.is_object() {
        return Err("VALIDATION_ERROR: workflowはオブジェクトで指定してください。".to_string());
    }
    if updated_at.trim().is_empty() {
        return Err("VALIDATION_ERROR: 更新日時を指定してください。".to_string());
    }
    let workflow_json = serde_json::to_string(&workflow)
        .map_err(|error| format!("workflowをJSON化できませんでした: {error}"))?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| format!("workflow更新transactionを開始できませんでした: {error}"))?;
    let project_revision =
        ensure_project_revision(&mut tx, &project_id, expected_project_revision).await?;
    ensure_article_in_project(&mut tx, &project_id, &article_id).await?;
    if let Some(active_id) = active_article_id.as_deref() {
        validate_id(active_id, "active article ID")?;
        ensure_article_in_project(&mut tx, &project_id, active_id).await?;
    }
    let article_revision =
        ensure_article_revision(&mut tx, &article_id, expected_article_revision).await?;
    let article_update = sqlx::query(
        "UPDATE articles SET workflow_json = ?, updated_at = ?, revision = ?
         WHERE id = ? AND project_id = ? AND revision = ?",
    )
    .bind(workflow_json)
    .bind(&updated_at)
    .bind(article_revision + 1)
    .bind(&article_id)
    .bind(&project_id)
    .bind(article_revision)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("workflowを更新できませんでした: {error}"))?;
    require_rows_affected(&article_update, "workflow")?;
    let project_update = sqlx::query(
        "UPDATE projects SET active_article_id = ?, updated_at = ?, revision = ?
         WHERE id = ? AND revision = ?",
    )
    .bind(active_article_id)
    .bind(&updated_at)
    .bind(project_revision + 1)
    .bind(&project_id)
    .bind(project_revision)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("プロジェクト更新時刻を更新できませんでした: {error}"))?;
    require_rows_affected(&project_update, "プロジェクト")?;
    tx.commit()
        .await
        .map_err(|error| format!("workflow更新をcommitできませんでした: {error}"))?;
    Ok(json!({
        "projectRevision": project_revision + 1,
        "articleRevision": article_revision + 1
    }))
}

#[tauri::command]
pub async fn db_update_document_and_article(
    state: State<'_, DbState>,
    project_id: String,
    project_updated_at: String,
    article: Value,
    article_data: Option<Value>,
    run_id: Option<String>,
    run_kind: Option<String>,
    expected_project_revision: Option<i64>,
    expected_article_revision: Option<i64>,
    expected_document_revision: Option<i64>,
) -> Result<Value, String> {
    update_document_and_article(
        &state,
        project_id,
        project_updated_at,
        article,
        article_data,
        run_id,
        run_kind,
        expected_project_revision,
        expected_article_revision,
        expected_document_revision,
    )
    .await
}

pub(crate) async fn update_document_and_article(
    state: &DbState,
    project_id: String,
    project_updated_at: String,
    article: Value,
    article_data: Option<Value>,
    run_id: Option<String>,
    run_kind: Option<String>,
    expected_project_revision: Option<i64>,
    expected_article_revision: Option<i64>,
    expected_document_revision: Option<i64>,
) -> Result<Value, String> {
    validate_id(&project_id, "プロジェクトID")?;
    let article_id = value_string(&article, "id")?;
    validate_id(article_id, "記事ID")?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|error| format!("原稿と記事更新transactionを開始できませんでした: {error}"))?;
    let project_revision =
        ensure_project_revision(&mut tx, &project_id, expected_project_revision).await?;
    ensure_article_in_project(&mut tx, &project_id, article_id).await?;
    let article_revision =
        ensure_article_revision(&mut tx, article_id, expected_article_revision).await?;
    let document_revision =
        ensure_document_revision(&mut tx, article_id, expected_document_revision).await?;
    let article_json = article_data
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| format!("原稿をJSON化できませんでした: {error}"))?;
    let document_update = sqlx::query(
        "UPDATE documents SET article_json = ?, revision = ? WHERE article_id = ? AND revision = ?",
    )
    .bind(article_json)
    .bind(document_revision + 1)
    .bind(article_id)
    .bind(document_revision)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("原稿を更新できませんでした: {error}"))?;
    require_rows_affected(&document_update, "原稿")?;
    match (run_id.as_deref(), run_kind.as_deref()) {
        (Some(run_id), Some(run_kind)) => {
            validate_id(run_id, "解析run ID")?;
            insert_analysis_run(&mut tx, run_id, article_id, run_kind, article_data.as_ref())
                .await?;
        }
        (None, None) => {}
        _ => {
            return Err("VALIDATION_ERROR: 解析runのIDと種別は同時に指定してください。".to_string())
        }
    }
    let article_update = sqlx::query("UPDATE articles SET title = ?, source_range_json = ?, crop_json = ?, perspective_crop_json = ?, settings_json = ?, workflow_json = ?, updated_at = ?, revision = ? WHERE id = ? AND revision = ?")
        .bind(value_string(&article, "title")?).bind(json_value(&article, "sourceRange", serde_json::json!({ "startMs": 0, "endMs": 1 }))?).bind(json_text(article.get("crop"))?).bind(json_text(article.get("perspectiveCrop"))?).bind(json_value(&article, "settings", serde_json::json!({}))?).bind(json_value(&article, "workflow", serde_json::json!({}))?).bind(value_string(&article, "updatedAt")?).bind(article_revision + 1).bind(article_id).bind(article_revision).execute(&mut *tx).await
        .map_err(|error| format!("記事を更新できませんでした: {error}"))?;
    require_rows_affected(&article_update, "記事")?;
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
        .map_err(|error| format!("原稿と記事更新をcommitできませんでした: {error}"))?;
    Ok(
        json!({ "projectRevision": project_revision + 1, "articleRevision": article_revision + 1, "documentRevision": document_revision + 1 }),
    )
}
