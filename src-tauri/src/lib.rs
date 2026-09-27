use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{BufReader, Read},
    path::{Component, Path, PathBuf},
};
use tauri::Manager;

mod db;
mod openai;
mod video_server;

#[tauri::command]
async fn sha256_app_local_file(
    app: tauri::AppHandle,
    relative_path: String,
) -> Result<String, String> {
    let relative_path = Path::new(&relative_path);
    let is_unsafe_path = relative_path.is_absolute()
        || relative_path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        });

    if is_unsafe_path {
        return Err("アプリデータディレクトリ外のパスは検証できません".to_string());
    }

    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("アプリデータディレクトリの取得に失敗しました: {error}"))?
        .join(relative_path);

    tauri::async_runtime::spawn_blocking(move || sha256_file(path))
        .await
        .map_err(|error| format!("SHA-256検証スレッドが終了しました: {error}"))?
}

fn sha256_file(path: PathBuf) -> Result<String, String> {
    let file = File::open(&path).map_err(|error| {
        format!(
            "SHA-256検証用ファイルを開けませんでした ({}): {error}",
            path.display()
        )
    })?;
    let mut reader = BufReader::with_capacity(8 * 1024 * 1024, file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 8 * 1024 * 1024];

    loop {
        let bytes_read = reader
            .read(&mut buffer)
            .map_err(|error| format!("SHA-256検証中の読み込みに失敗しました: {error}"))?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

#[tauri::command]
fn get_ffmpeg_path() -> Result<String, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("アプリ実行ファイルの場所を取得できませんでした: {error}"))?;
    let directory = executable
        .parent()
        .ok_or_else(|| "アプリ実行ファイルの親ディレクトリを取得できませんでした".to_string())?;
    let path = directory.join("ffmpeg");

    if !path.is_file() {
        return Err(format!("同梱FFmpegが見つかりません: {}", path.display()));
    }

    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let database = tauri::async_runtime::block_on(db::initialize(app.handle()))
                .map_err(std::io::Error::other)?;
            app.manage(database);
            app.manage(video_server::start()?);
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sha256_app_local_file,
            get_ffmpeg_path,
            db::services::projects::db_create_project,
            db::services::projects::db_update_project,
            db::services::projects::db_create_video_and_update_project,
            db::services::projects::db_create_project_bundle,
            db::services::projects::db_create_articles,
            db::services::projects::db_update_article_content,
            db::services::projects::db_update_article_source,
            db::services::projects::db_delete_article,
            db::services::projects::db_delete_video,
            db::services::analysis::db_commit_slide_detection,
            db::services::analysis::db_commit_transcription,
            db::services::analysis::db_commit_ocr_batch,
            db::services::analysis::db_commit_slide_content_batch,
            db::services::analysis::db_update_slide_results,
            db::services::documents::db_update_article_title,
            db::services::documents::db_update_article_workflow,
            db::services::documents::db_update_document_and_article,
            db::services::projects::db_load_project,
            db::services::projects::db_list_projects,
            db::services::projects::db_list_articles,
            db::services::projects::db_delete_project,
            db::services::projects::db_check_storage_reference,
            video_server::video_stream_url,
            openai::get_openai_api_key_status,
            openai::validate_and_save_openai_api_key,
            openai::test_openai_connection,
            openai::delete_openai_api_key,
            openai::generate_openai_article,
            openai::recognize_openai_image,
            openai::transcribe_openai_audio,
            openai::cancel_openai_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
