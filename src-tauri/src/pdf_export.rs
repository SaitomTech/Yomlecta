use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::mpsc,
    time::Duration,
};

use tauri::{webview::PageLoadEvent, Manager, WebviewUrl, WebviewWindowBuilder};

const EXPORT_WINDOW_LABEL: &str = "article-pdf-export";
const PDF_EXPORT_TIMEOUT: Duration = Duration::from_secs(90);

#[tauri::command]
pub async fn export_article_pdf(
    app: tauri::AppHandle,
    html_path: String,
    pdf_path: String,
) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("アプリデータディレクトリを取得できませんでした: {error}"))?;
    let app_data_dir = app_data_dir
        .canonicalize()
        .map_err(|error| format!("アプリデータディレクトリを解決できませんでした: {error}"))?;
    let html_path = PathBuf::from(html_path)
        .canonicalize()
        .map_err(|error| format!("記事HTMLを開けませんでした: {error}"))?;
    let pdf_path = PathBuf::from(pdf_path);
    let pdf_filename = pdf_path
        .file_name()
        .ok_or_else(|| "PDFファイル名を取得できませんでした。".to_string())?;
    if pdf_path
        .extension()
        .and_then(|extension| extension.to_str())
        != Some("pdf")
    {
        return Err("PDF出力先の拡張子が正しくありません。".to_string());
    }
    let pdf_parent = pdf_path
        .parent()
        .ok_or_else(|| "PDFの保存先フォルダを取得できませんでした。".to_string())?
        .canonicalize()
        .map_err(|error| format!("PDFの保存先フォルダを開けませんでした: {error}"))?;
    let pdf_path = pdf_parent.join(pdf_filename);
    if !html_path.starts_with(&app_data_dir) || !pdf_parent.starts_with(&app_data_dir) {
        return Err("PDF出力先がアプリデータディレクトリ外です。".to_string());
    }
    let partial_path = pdf_path.with_extension("pdf.part");
    let _ = std::fs::remove_file(&partial_path);
    let html_url = tauri::Url::from_file_path(&html_path)
        .map_err(|_| "記事HTMLのURLを作成できませんでした。".to_string())?;

    let (sender, receiver) = mpsc::channel::<Result<Vec<u8>, String>>();
    let window =
        WebviewWindowBuilder::new(&app, EXPORT_WINDOW_LABEL, WebviewUrl::External(html_url))
            .title("PDF Export")
            .inner_size(794.0, 1123.0)
            .decorations(false)
            .skip_taskbar(true)
            .visible(false)
            .on_page_load(move |webview_window, payload| {
                if payload.event() != PageLoadEvent::Finished {
                    return;
                }

                let callback_sender = sender.clone();
                if let Err(error) = webview_window.with_webview(move |native_webview| {
                    if let Err(error) =
                        export_with_native_webview(native_webview, callback_sender.clone())
                    {
                        let _ = callback_sender.send(Err(error));
                    }
                }) {
                    let _ = sender.send(Err(format!("PDF出力を開始できませんでした: {error}")));
                }
            })
            .build()
            .map_err(|error| format!("PDF生成用WebViewを作成できませんでした: {error}"))?;

    let receive_result =
        tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(PDF_EXPORT_TIMEOUT))
            .await;
    let _ = window.close();
    let pdf_data = receive_result
        .map_err(|error| format!("PDF生成スレッドが終了しました: {error}"))?
        .map_err(|_| "PDF生成がタイムアウトしました。".to_string())?;
    let pdf_data = match pdf_data {
        Ok(data) => data,
        Err(error) => {
            let _ = std::fs::remove_file(&partial_path);
            return Err(error);
        }
    };
    std::fs::write(&partial_path, pdf_data)
        .map_err(|error| format!("PDFデータを保存できませんでした: {error}"))?;

    if let Err(error) = validate_pdf(&partial_path) {
        let _ = std::fs::remove_file(&partial_path);
        return Err(error);
    }
    std::fs::rename(&partial_path, &pdf_path)
        .map_err(|error| format!("PDFファイルを保存できませんでした: {error}"))
}

#[cfg(target_os = "macos")]
fn export_with_native_webview(
    native_webview: tauri::webview::PlatformWebview,
    sender: mpsc::Sender<Result<Vec<u8>, String>>,
) -> Result<(), String> {
    use block2::RcBlock;
    use objc2_foundation::{NSData, NSError};
    use objc2_web_kit::WKWebView;

    let webview = unsafe { &*native_webview.inner().cast::<WKWebView>() };
    let completion = RcBlock::new(move |data: *mut NSData, _error: *mut NSError| {
        let result = if data.is_null() {
            Err("WebKitがPDFを書き出せませんでした。".to_string())
        } else {
            // NSData remains valid for the duration of this completion callback.
            Ok(unsafe { &*data }.to_vec())
        };
        let _ = sender.send(result);
    });

    // WKWebView completes this asynchronously, leaving the app event loop available.
    unsafe { webview.createPDFWithConfiguration_completionHandler(None, &completion) };
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn export_with_native_webview(
    _native_webview: tauri::webview::PlatformWebview,
    _sender: mpsc::Sender<Result<Vec<u8>, String>>,
) -> Result<(), String> {
    Err("PDF書き出しはmacOSでのみ利用できます。".to_string())
}

fn validate_pdf(path: &Path) -> Result<(), String> {
    let mut file =
        std::fs::File::open(path).map_err(|error| format!("生成PDFを開けませんでした: {error}"))?;
    let file_size = file
        .metadata()
        .map_err(|error| format!("生成PDFの情報を取得できませんでした: {error}"))?
        .len();
    let mut signature = [0; 5];
    if file_size <= 8 || file.read_exact(&mut signature).is_err() || &signature != b"%PDF-" {
        return Err("生成されたPDFファイルが空か、形式が正しくありません。".to_string());
    }
    Ok(())
}
