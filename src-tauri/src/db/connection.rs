use super::assets::{inspect_asset, resolve_asset_path};
use super::{validate_asset_path, DbState};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Executor, Row, SqlitePool,
};
use std::{fs, time::Duration};
use tauri::{AppHandle, Manager};

pub async fn initialize(app: &AppHandle) -> Result<DbState, String> {
    let app_data = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("アプリデータディレクトリを取得できませんでした: {error}"))?;
    let root = app_data.join("library");
    fs::create_dir_all(&root)
        .map_err(|error| format!("DBディレクトリを作成できませんでした: {error}"))?;
    let database_url = root.join("library.sqlite");
    let options = SqliteConnectOptions::new()
        .filename(&database_url)
        .create_if_missing(true)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| format!("SQLiteへ接続できませんでした: {error}"))?;

    pool.execute("PRAGMA journal_mode = WAL")
        .await
        .map_err(|error| format!("SQLiteのWALを有効化できませんでした: {error}"))?;
    pool.execute("PRAGMA synchronous = FULL")
        .await
        .map_err(|error| format!("SQLiteの耐久性設定を適用できませんでした: {error}"))?;
    pool.execute("PRAGMA foreign_keys = ON")
        .await
        .map_err(|error| format!("SQLiteの外部キーを有効化できませんでした: {error}"))?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|error| format!("SQLite migrationに失敗しました: {error}"))?;
    reconcile_missing_assets(&pool, &app_data).await?;

    Ok(DbState {
        pool,
        app_data_dir: app_data,
    })
}

async fn reconcile_missing_assets(
    pool: &SqlitePool,
    app_data_dir: &std::path::Path,
) -> Result<(), String> {
    let rows = sqlx::query("SELECT id, project_id, relative_path, byte_size FROM assets")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("assetの整合性を確認できませんでした: {error}"))?;
    for row in rows {
        let id: String = row.try_get("id").map_err(|error| error.to_string())?;
        let project_id: String = row
            .try_get("project_id")
            .map_err(|error| error.to_string())?;
        let relative_path: String = row
            .try_get("relative_path")
            .map_err(|error| error.to_string())?;
        validate_asset_path(&relative_path)?;
        let stored_size: i64 = row
            .try_get("byte_size")
            .map_err(|error| error.to_string())?;
        let absolute_path = resolve_asset_path(app_data_dir, &project_id, &relative_path);
        if absolute_path.is_file() {
            let current_size = i64::try_from(
                fs::metadata(&absolute_path)
                    .map_err(|error| format!("assetのメタデータを確認できませんでした: {error}"))?
                    .len(),
            )
            .map_err(|_| format!("assetのサイズが大きすぎます: {}", absolute_path.display()))?;
            if stored_size == current_size {
                sqlx::query("UPDATE assets SET missing_at = NULL WHERE id = ?")
                    .bind(id)
                    .execute(pool)
                    .await
                    .map_err(|error| format!("asset状態を更新できませんでした: {error}"))?;
                continue;
            }
        }
        let metadata = inspect_asset(app_data_dir, &project_id, &relative_path)?;
        sqlx::query(
            "UPDATE assets SET byte_size = ?, sha256 = NULL, missing_at = CASE
             WHEN ? = 1 THEN COALESCE(missing_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ELSE NULL END WHERE id = ?",
        )
        .bind(metadata.byte_size)
        .bind(if metadata.missing_at.is_some() {
            1_i64
        } else {
            0_i64
        })
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| format!("asset状態を更新できませんでした: {error}"))?;
    }
    Ok(())
}
