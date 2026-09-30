use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::mpsc,
    time::Duration,
};

use tauri::{webview::PageLoadEvent, Manager, WebviewUrl, WebviewWindowBuilder};

const PDF_EXPORT_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Clone, serde::Deserialize)]
struct PdfOutlineEntry {
    marker: String,
    title: String,
}

#[cfg(target_os = "macos")]
mod print_completion {
    use std::sync::{mpsc::Sender, Mutex};

    use objc2::{define_class, msg_send, AnyThread, DefinedClass};
    use objc2_app_kit::NSPrintOperation;
    use objc2_foundation::{NSObject, NSObjectProtocol};

    #[derive(Default)]
    pub struct PrintOperationDelegateIvars {
        sender: Mutex<Option<Sender<bool>>>,
    }

    define_class!(
        // SAFETY:
        // - NSObject has no subclassing requirements.
        // - The delegate only stores a thread-safe channel sender.
        #[unsafe(super = NSObject)]
        #[thread_kind = AnyThread]
        #[ivars = PrintOperationDelegateIvars]
        pub struct PrintOperationDelegate;

        // SAFETY: NSObjectProtocol has no safety requirements.
        unsafe impl NSObjectProtocol for PrintOperationDelegate {}

        impl PrintOperationDelegate {
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn print_operation_did_run(
                &self,
                _operation: &NSPrintOperation,
                success: bool,
                _context_info: *mut std::ffi::c_void,
            ) {
                let sender = self
                    .ivars()
                    .sender
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .take();
                if let Some(sender) = sender {
                    let _ = sender.send(success);
                }
            }
        }
    );

    impl PrintOperationDelegate {
        pub fn new(sender: Sender<bool>) -> objc2::rc::Retained<Self> {
            let this = Self::alloc().set_ivars(PrintOperationDelegateIvars {
                sender: Mutex::new(Some(sender)),
            });
            // SAFETY: NSObject's `init` is the designated initializer for this subclass.
            unsafe { msg_send![super(this), init] }
        }
    }
}

#[cfg(target_os = "macos")]
type PrintCompletionHandle = objc2::rc::Retained<print_completion::PrintOperationDelegate>;
#[cfg(not(target_os = "macos"))]
type PrintCompletionHandle = ();

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
    let draft_path = pdf_path.with_extension("draft.pdf");
    let partial_path = pdf_path.with_extension("pdf.part");
    let outlined_path = pdf_path.with_extension("outlined.pdf");
    let _ = std::fs::remove_file(&draft_path);
    let _ = std::fs::remove_file(&partial_path);
    let _ = std::fs::remove_file(&outlined_path);

    let source_html = std::fs::read_to_string(&html_path)
        .map_err(|error| format!("記事HTMLを読み込めませんでした: {error}"))?;
    let outline_entries = parse_pdf_outline(&source_html)?;
    let chapter_count = outline_entries.len();
    let generation_result = async {
        if chapter_count > 0 {
            export_pdf_pass(&app, "article-pdf-export-draft", &html_path, &draft_path).await?;
            let page_numbers = chapter_page_numbers(&draft_path, chapter_count).await?;
            let updated_html = set_toc_page_numbers(&source_html, &page_numbers)?;
            std::fs::write(&html_path, updated_html)
                .map_err(|error| format!("PDF目次のページ番号を書き込めませんでした: {error}"))?;
            let _ = std::fs::remove_file(&draft_path);
        }

        export_pdf_pass(&app, "article-pdf-export-final", &html_path, &partial_path).await?;
        if chapter_count > 0 {
            let final_page_numbers = chapter_page_numbers(&partial_path, chapter_count).await?;
            write_pdf_outline(
                &partial_path,
                &outlined_path,
                &outline_entries,
                &final_page_numbers,
            )
            .await?;
            validate_pdf(&outlined_path)?;
        }
        Ok(())
    }
    .await;
    let result = generation_result.and_then(|()| {
        let generated_path = if chapter_count > 0 {
            &outlined_path
        } else {
            &partial_path
        };
        std::fs::rename(generated_path, &pdf_path)
            .map_err(|error| format!("PDFファイルを保存できませんでした: {error}"))
    });
    for temporary_path in [&draft_path, &partial_path, &outlined_path] {
        let _ = std::fs::remove_file(temporary_path);
    }
    result
}

async fn export_pdf_pass(
    app: &tauri::AppHandle,
    window_label: &'static str,
    html_path: &Path,
    output_path: &Path,
) -> Result<(), String> {
    let html_url = tauri::Url::from_file_path(html_path)
        .map_err(|_| "記事HTMLのURLを作成できませんでした。".to_string())?;
    let (completion_sender, completion_receiver) = mpsc::channel::<bool>();
    let (delegate_sender, delegate_receiver) =
        mpsc::channel::<Result<PrintCompletionHandle, String>>();
    let page_output_path = output_path.to_path_buf();
    let window = WebviewWindowBuilder::new(app, window_label, WebviewUrl::External(html_url))
        .title("PDF Export")
        .inner_size(794.0, 1123.0)
        .decorations(false)
        .skip_taskbar(true)
        .visible(false)
        .on_page_load(move |webview_window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }

            #[cfg(target_os = "macos")]
            let native_window = match webview_window.ns_window() {
                Ok(window) => window as usize,
                Err(error) => {
                    let _ = delegate_sender.send(Err(format!(
                        "PDF生成用ウィンドウを取得できませんでした: {error}"
                    )));
                    return;
                }
            };
            #[cfg(not(target_os = "macos"))]
            let native_window = 0usize;
            let delegate_sender = delegate_sender.clone();
            let start_failure_sender = delegate_sender.clone();
            let completion_sender = completion_sender.clone();
            let output_path = page_output_path.clone();
            if let Err(error) = webview_window.with_webview(move |native_webview| {
                #[cfg(target_os = "macos")]
                let delegate = print_completion::PrintOperationDelegate::new(completion_sender);
                #[cfg(not(target_os = "macos"))]
                let delegate = ();

                let result = export_with_native_webview(
                    native_webview,
                    native_window,
                    &output_path,
                    &delegate,
                );
                match result {
                    Ok(()) => {
                        let _ = delegate_sender.send(Ok(delegate));
                    }
                    Err(error) => {
                        let _ = delegate_sender.send(Err(error));
                    }
                }
            }) {
                let _ = start_failure_sender
                    .send(Err(format!("PDF出力を開始できませんでした: {error}")));
            }
        })
        .build()
        .map_err(|error| format!("PDF生成用WebViewを作成できませんでした: {error}"))?;

    let delegate_result = tauri::async_runtime::spawn_blocking(move || {
        delegate_receiver.recv_timeout(PDF_EXPORT_TIMEOUT)
    })
    .await;
    let delegate = match delegate_result {
        Err(error) => {
            let _ = window.close();
            return Err(format!("PDF生成スレッドが終了しました: {error}"));
        }
        Ok(Err(_)) => {
            let _ = window.close();
            return Err("PDFの印刷処理を開始できませんでした。".to_string());
        }
        Ok(Ok(Err(error))) => {
            let _ = window.close();
            return Err(error);
        }
        Ok(Ok(Ok(delegate))) => delegate,
    };

    let completion_result = tauri::async_runtime::spawn_blocking(move || {
        completion_receiver.recv_timeout(PDF_EXPORT_TIMEOUT)
    })
    .await;
    let _ = window.close();
    let success = match completion_result {
        Err(error) => return Err(format!("PDF生成スレッドが終了しました: {error}")),
        Ok(Err(_)) => return Err("PDF生成がタイムアウトしました。".to_string()),
        Ok(Ok(success)) => success,
    };
    drop(delegate);
    if !success {
        let _ = std::fs::remove_file(output_path);
        return Err("WebKitがPDFを書き出せませんでした。".to_string());
    }
    validate_pdf(output_path)
}

fn chapter_marker(index: usize) -> String {
    format!("YOMLECTACHAPTER{index:04}")
}

fn parse_pdf_outline(html: &str) -> Result<Vec<PdfOutlineEntry>, String> {
    const SCRIPT_START: &str = "<script id=\"pdf-outline-data\" type=\"application/json\">";
    let content_start = html
        .find(SCRIPT_START)
        .map(|position| position + SCRIPT_START.len())
        .ok_or_else(|| "PDF目次データがありません。記事を再書き出してください。".to_string())?;
    let content_end = html[content_start..]
        .find("</script>")
        .map(|position| content_start + position)
        .ok_or_else(|| "PDF目次データを読み取れませんでした。".to_string())?;
    let entries: Vec<PdfOutlineEntry> = serde_json::from_str(&html[content_start..content_end])
        .map_err(|error| format!("PDF目次データが壊れています: {error}"))?;
    if entries
        .iter()
        .enumerate()
        .any(|(index, entry)| entry.marker != chapter_marker(index + 1))
    {
        return Err("PDF目次データの章番号が連続していません。".to_string());
    }
    Ok(entries)
}

fn set_toc_page_numbers(html: &str, page_numbers: &[usize]) -> Result<String, String> {
    let mut updated = html.to_string();
    for (index, page_number) in page_numbers.iter().enumerate() {
        let marker = chapter_marker(index + 1);
        let target = format!("data-target=\"{marker}\">");
        let content_start = updated
            .find(&target)
            .map(|position| position + target.len())
            .ok_or_else(|| format!("PDF目次に章{}の参照先がありません。", index + 1))?;
        let content_end = updated[content_start..]
            .find("</span>")
            .map(|position| content_start + position)
            .ok_or_else(|| format!("PDF目次の章{}のページ欄が壊れています。", index + 1))?;
        updated.replace_range(content_start..content_end, &page_number.to_string());
    }
    Ok(updated)
}

async fn chapter_page_numbers(path: &Path, chapter_count: usize) -> Result<Vec<usize>, String> {
    let path = path.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || extract_chapter_page_numbers(&path, chapter_count))
        .await
        .map_err(|error| format!("PDF目次を読み取れませんでした: {error}"))?
}

async fn write_pdf_outline(
    pdf_path: &Path,
    output_path: &Path,
    entries: &[PdfOutlineEntry],
    page_numbers: &[usize],
) -> Result<(), String> {
    let pdf_path = pdf_path.to_path_buf();
    let output_path = output_path.to_path_buf();
    let entries = entries.to_vec();
    let page_numbers = page_numbers.to_vec();
    tauri::async_runtime::spawn_blocking(move || {
        write_pdf_outline_sync(&pdf_path, &output_path, &entries, &page_numbers)
    })
    .await
    .map_err(|error| format!("PDFの目次を設定できませんでした: {error}"))?
}

#[cfg(target_os = "macos")]
fn extract_chapter_page_numbers(path: &Path, chapter_count: usize) -> Result<Vec<usize>, String> {
    use objc2::{
        msg_send, rc::autoreleasepool, rc::Retained, runtime::AnyClass, runtime::AnyObject,
    };
    use objc2_foundation::{NSString, NSURL};
    use std::ffi::{c_char, c_void};

    unsafe extern "C" {
        fn dlopen(filename: *const c_char, flags: i32) -> *mut c_void;
    }

    autoreleasepool(|_| {
        let framework_path = c"/System/Library/Frameworks/PDFKit.framework/PDFKit";
        let framework = unsafe { dlopen(framework_path.as_ptr(), 1) };
        if framework.is_null() {
            return Err("PDFKitのPDF読み取り機能を利用できません。".to_string());
        }

        let path_string = NSString::from_str(&path.to_string_lossy());
        let url = NSURL::fileURLWithPath(&path_string);
        let document_class = AnyClass::get(c"PDFDocument")
            .ok_or_else(|| "PDFKitのPDF読み取り機能を利用できません。".to_string())?;
        let allocated: *mut AnyObject = unsafe { msg_send![document_class, alloc] };
        let document_ptr: *mut AnyObject = unsafe { msg_send![allocated, initWithURL: &*url] };
        let document = unsafe { Retained::from_raw(document_ptr) }
            .ok_or_else(|| "生成したPDFを読み取れませんでした。".to_string())?;
        let page_count: usize = unsafe { msg_send![&*document, pageCount] };
        let mut pages = vec![0; chapter_count];

        for page_index in 0..page_count {
            let page: *mut AnyObject = unsafe { msg_send![&*document, pageAtIndex: page_index] };
            if page.is_null() {
                continue;
            }
            let page_text: *mut NSString = unsafe { msg_send![page, string] };
            if page_text.is_null() {
                continue;
            }
            let page_text = unsafe { &*page_text }.to_string();
            for (chapter_index, page_number) in pages.iter_mut().enumerate() {
                if *page_number == 0 && page_text.contains(&chapter_marker(chapter_index + 1)) {
                    *page_number = page_index + 1;
                }
            }
        }

        if pages.contains(&0) {
            return Err(
                "PDF内で章の位置を特定できず、目次ページ番号を付けられませんでした。".to_string(),
            );
        }
        Ok(pages)
    })
}

#[cfg(not(target_os = "macos"))]
fn extract_chapter_page_numbers(_path: &Path, _chapter_count: usize) -> Result<Vec<usize>, String> {
    Err("PDFの目次ページ番号取得はmacOSでのみ利用できます。".to_string())
}

#[cfg(target_os = "macos")]
fn write_pdf_outline_sync(
    pdf_path: &Path,
    output_path: &Path,
    entries: &[PdfOutlineEntry],
    page_numbers: &[usize],
) -> Result<(), String> {
    use objc2::{
        msg_send, rc::autoreleasepool, rc::Retained, runtime::AnyClass, runtime::AnyObject,
    };
    use objc2_foundation::{NSPoint, NSString, NSURL};
    use std::ffi::{c_char, c_void};

    unsafe extern "C" {
        fn dlopen(filename: *const c_char, flags: i32) -> *mut c_void;
    }

    autoreleasepool(|_| {
        let framework_path = c"/System/Library/Frameworks/PDFKit.framework/PDFKit";
        let framework = unsafe { dlopen(framework_path.as_ptr(), 1) };
        if framework.is_null() {
            return Err("PDFKitの目次機能を利用できません。".to_string());
        }
        if entries.len() != page_numbers.len() {
            return Err("PDF目次とページ番号の数が一致しません。".to_string());
        }

        let source_path = NSString::from_str(&pdf_path.to_string_lossy());
        let source_url = NSURL::fileURLWithPath(&source_path);
        let document_class = AnyClass::get(c"PDFDocument")
            .ok_or_else(|| "PDFKitのPDF読み取り機能を利用できません。".to_string())?;
        let source_alloc: *mut AnyObject = unsafe { msg_send![document_class, alloc] };
        let source_ptr: *mut AnyObject =
            unsafe { msg_send![source_alloc, initWithURL: &*source_url] };
        let source_document = unsafe { Retained::from_raw(source_ptr) }
            .ok_or_else(|| "生成したPDFを読み取れませんでした。".to_string())?;
        let page_count: usize = unsafe { msg_send![&*source_document, pageCount] };

        // PDFKit doesn't serialize a newly assigned outline root when modifying
        // a PDFDocument loaded from an existing PDF. Rebuild the document from
        // its pages so the outline is part of the document's own object graph.
        let document_alloc: *mut AnyObject = unsafe { msg_send![document_class, alloc] };
        let document_ptr: *mut AnyObject = unsafe { msg_send![document_alloc, init] };
        let document = unsafe { Retained::from_raw(document_ptr) }
            .ok_or_else(|| "PDFKitの出力文書を作成できませんでした。".to_string())?;
        let source_attributes: *mut AnyObject =
            unsafe { msg_send![&*source_document, documentAttributes] };
        if !source_attributes.is_null() {
            let _: () =
                unsafe { msg_send![&*document, setDocumentAttributes: &*source_attributes] };
        }

        let outline_class = AnyClass::get(c"PDFOutline")
            .ok_or_else(|| "PDFKitの目次項目を作成できません。".to_string())?;
        let root_alloc: *mut AnyObject = unsafe { msg_send![outline_class, alloc] };
        let root_ptr: *mut AnyObject = unsafe { msg_send![root_alloc, init] };
        let root = unsafe { Retained::from_raw(root_ptr) }
            .ok_or_else(|| "PDF目次のルートを作成できません。".to_string())?;
        let _: () = unsafe { msg_send![&*document, setOutlineRoot: &*root] };

        for page_index in 0..page_count {
            let page: *mut AnyObject =
                unsafe { msg_send![&*source_document, pageAtIndex: page_index] };
            if page.is_null() {
                return Err(format!("PDFのページを取得できません: {}", page_index + 1));
            }
            let _: () = unsafe { msg_send![&*document, insertPage: &*page, atIndex: page_index] };
        }

        let destination_class = AnyClass::get(c"PDFDestination")
            .ok_or_else(|| "PDFKitの移動先を作成できません。".to_string())?;

        for (index, (entry, page_number)) in entries.iter().zip(page_numbers).enumerate() {
            if *page_number == 0 || *page_number > page_count {
                return Err(format!("PDF目次のページ番号が範囲外です: {page_number}"));
            }
            let page: *mut AnyObject =
                unsafe { msg_send![&*document, pageAtIndex: page_number - 1] };
            if page.is_null() {
                return Err(format!(
                    "PDF目次の移動先ページを取得できません: {page_number}"
                ));
            }
            let destination_alloc: *mut AnyObject = unsafe { msg_send![destination_class, alloc] };
            let destination_ptr: *mut AnyObject = unsafe {
                msg_send![destination_alloc, initWithPage: page, atPoint: NSPoint::new(0.0, 841.89)]
            };
            let destination = unsafe { Retained::from_raw(destination_ptr) }
                .ok_or_else(|| format!("PDF目次の移動先を作成できません: {page_number}"))?;

            let item_alloc: *mut AnyObject = unsafe { msg_send![outline_class, alloc] };
            let item_ptr: *mut AnyObject = unsafe { msg_send![item_alloc, init] };
            let item = unsafe { Retained::from_raw(item_ptr) }
                .ok_or_else(|| "PDF目次の項目を作成できません。".to_string())?;
            let label = NSString::from_str(&entry.title);
            let _: () = unsafe { msg_send![&*item, setLabel: &*label] };
            let _: () = unsafe { msg_send![&*item, setDestination: &*destination] };
            let _: () = unsafe { msg_send![&*root, insertChild: &*item, atIndex: index] };
        }

        let output_path = NSString::from_str(&output_path.to_string_lossy());
        let output_url = NSURL::fileURLWithPath(&output_path);
        let written: bool = unsafe { msg_send![&*document, writeToURL: &*output_url] };
        if !written {
            return Err("PDFに目次を保存できませんでした。".to_string());
        }

        let output_alloc: *mut AnyObject = unsafe { msg_send![document_class, alloc] };
        let output_ptr: *mut AnyObject =
            unsafe { msg_send![output_alloc, initWithURL: &*output_url] };
        let output_document = unsafe { Retained::from_raw(output_ptr) }
            .ok_or_else(|| "目次を書き込んだPDFを再度読み取れませんでした。".to_string())?;
        let saved_root: *mut AnyObject = unsafe { msg_send![&*output_document, outlineRoot] };
        if saved_root.is_null() {
            return Err("PDFに目次を保存できませんでした。".to_string());
        }
        let saved_outline_count: usize = unsafe { msg_send![saved_root, numberOfChildren] };
        if saved_outline_count != entries.len() {
            return Err("PDFに目次の全項目を保存できませんでした。".to_string());
        }
        for (index, (entry, page_number)) in entries.iter().zip(page_numbers).enumerate() {
            let saved_item: *mut AnyObject = unsafe { msg_send![saved_root, childAtIndex: index] };
            if saved_item.is_null() {
                return Err("PDFに目次の全項目を保存できませんでした。".to_string());
            }
            let saved_label: *mut NSString = unsafe { msg_send![saved_item, label] };
            if saved_label.is_null() || unsafe { &*saved_label }.to_string() != entry.title {
                return Err("PDFの目次項目を正しく保存できませんでした。".to_string());
            }
            let saved_destination: *mut AnyObject = unsafe { msg_send![saved_item, destination] };
            if saved_destination.is_null() {
                return Err("PDFの目次の移動先を保存できませんでした。".to_string());
            }
            let saved_page: *mut AnyObject = unsafe { msg_send![saved_destination, page] };
            if saved_page.is_null() {
                return Err("PDFの目次の移動先を保存できませんでした。".to_string());
            }
            let saved_page_index: usize =
                unsafe { msg_send![&*output_document, indexForPage: &*saved_page] };
            if saved_page_index != page_number - 1 {
                return Err("PDFの目次の移動先ページを正しく保存できませんでした。".to_string());
            }
        }
        Ok(())
    })
}

#[cfg(not(target_os = "macos"))]
fn write_pdf_outline_sync(
    _pdf_path: &Path,
    _output_path: &Path,
    _entries: &[PdfOutlineEntry],
    _page_numbers: &[usize],
) -> Result<(), String> {
    Err("PDFの目次設定はmacOSでのみ利用できます。".to_string())
}

#[cfg(target_os = "macos")]
fn export_with_native_webview(
    native_webview: tauri::webview::PlatformWebview,
    native_window: usize,
    output_path: &Path,
    delegate: &PrintCompletionHandle,
) -> Result<(), String> {
    use objc2::{runtime::AnyObject, sel, ClassType};
    use objc2_app_kit::{
        NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob, NSPrintingPaginationMode, NSWindow,
    };
    use objc2_foundation::{NSSize, NSString, NSURL};
    use objc2_web_kit::WKWebView;

    let webview = unsafe { &*native_webview.inner().cast::<WKWebView>() };
    // WebKit omits CSS backgrounds from printed output by default.
    unsafe {
        webview
            .configuration()
            .preferences()
            .setShouldPrintBackgrounds(true)
    };
    let window = unsafe { &*(native_window as *mut NSWindow) };
    let print_info = NSPrintInfo::new();
    print_info.setPaperSize(NSSize::new(595.28, 841.89));
    print_info.setTopMargin(48.0);
    print_info.setBottomMargin(50.0);
    print_info.setLeftMargin(48.0);
    print_info.setRightMargin(48.0);
    print_info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
    print_info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
    print_info.setHorizontallyCentered(true);
    print_info.setVerticallyCentered(false);
    // SAFETY: These keys and values are documented AppKit constants.
    print_info.setJobDisposition(unsafe { NSPrintSaveJob });
    let output_path = NSString::from_str(&output_path.to_string_lossy());
    let output_url = NSURL::fileURLWithPath(&output_path);
    let attributes = unsafe { print_info.dictionary() };
    attributes.insert(unsafe { NSPrintJobSavingURL }, &*output_url);

    let operation = unsafe { webview.printOperationWithPrintInfo(&print_info) };
    operation.setShowsPrintPanel(false);
    operation.setShowsProgressPanel(false);
    operation.setCanSpawnSeparateThread(true);
    let delegate: &AnyObject = delegate.as_super().as_super();
    // NSPrintOperation runs the actual pagination on its own thread and calls the
    // retained delegate when the finished PDF has been written.
    unsafe {
        operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
            window,
            Some(delegate),
            Some(sel!(printOperationDidRun:success:contextInfo:)),
            std::ptr::null_mut(),
        )
    };
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn export_with_native_webview(
    _native_webview: tauri::webview::PlatformWebview,
    _native_window: usize,
    _output_path: &Path,
    _delegate: &PrintCompletionHandle,
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
