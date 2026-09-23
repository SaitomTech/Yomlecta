use futures_util::future::{AbortHandle, Abortable};
use keyring::{Entry, Error as KeyringError};
use reqwest::{header::HeaderMap, multipart, Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::Manager;

const KEYCHAIN_SERVICE: &str = "com.saitomtech.yomlecta.openai";
const KEYCHAIN_ACCOUNT: &str = "default";
const OPENAI_MODEL: &str = "gpt-6-luna";
const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const OPENAI_TRANSCRIPTIONS_URL: &str = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_TRANSCRIPTION_MODEL: &str = "gpt-transcribe";
const MAX_PROMPT_BYTES: usize = 2 * 1024 * 1024;
const MAX_OCR_IMAGE_DATA_BYTES: usize = 20 * 1024 * 1024;
const MAX_TRANSCRIPTION_AUDIO_BYTES: u64 = 25_000_000;
const MAX_TRANSCRIPTION_RETRIES: usize = 3;

static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();
static ACTIVE_REQUESTS: OnceLock<Mutex<HashMap<String, AbortHandle>>> = OnceLock::new();
static API_KEY_CACHE: OnceLock<Mutex<ApiKeyCache>> = OnceLock::new();

enum ApiKeyCache {
    Unknown,
    Missing,
    Present(String),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiCredentialStatus {
    configured: bool,
    last_four: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiArticleRequest {
    instructions: String,
    input: String,
    max_output_tokens: u32,
    client_request_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiUsage {
    input_tokens: u64,
    output_tokens: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiArticleResponse {
    body: String,
    request_id: Option<String>,
    usage: Option<OpenAiUsage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiTranscriptionRequest {
    audio_path: String,
    languages: Option<Vec<String>>,
    prompt: Option<String>,
    keywords: Option<Vec<String>>,
    client_request_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiTranscriptionResponse {
    text: String,
    language: Option<String>,
    duration_seconds: Option<f64>,
    request_id: Option<String>,
    segments: Vec<OpenAiTranscriptionSegment>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiTranscriptionSegment {
    start_seconds: f64,
    end_seconds: f64,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiOcrRequest {
    instructions: String,
    image_data: String,
    client_request_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiOcrResponse {
    text: String,
    request_id: Option<String>,
    usage: Option<OpenAiUsage>,
}

#[derive(Deserialize)]
struct ApiErrorEnvelope {
    error: Option<ApiError>,
}

#[derive(Deserialize)]
struct ApiError {
    message: Option<String>,
}

#[derive(Deserialize)]
struct ResponsesApiResponse {
    output_text: Option<String>,
    #[serde(default)]
    output: Vec<ResponseOutputItem>,
    usage: Option<ResponsesUsage>,
}

#[derive(Deserialize)]
struct ResponseOutputItem {
    #[serde(default)]
    content: Vec<ResponseContentItem>,
}

#[derive(Deserialize)]
struct ResponseContentItem {
    text: Option<String>,
}

#[derive(Deserialize)]
struct ResponsesUsage {
    input_tokens: u64,
    output_tokens: u64,
}

#[derive(Deserialize)]
struct TranscriptionsApiResponse {
    text: String,
    language: Option<String>,
    duration: Option<f64>,
    #[serde(default)]
    segments: Vec<TranscriptionApiSegment>,
}

#[derive(Deserialize)]
struct TranscriptionApiSegment {
    start: f64,
    end: f64,
    text: String,
}

fn keychain_entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|error| format!("macOS Keychainを利用できません: {error}"))
}

fn http_client() -> Result<&'static Client, String> {
    if let Some(client) = HTTP_CLIENT.get() {
        return Ok(client);
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(180))
        .user_agent("Yomlecta/0.1")
        .build()
        .map_err(|error| format!("OpenAI APIクライアントを準備できません: {error}"))?;
    let _ = HTTP_CLIENT.set(client);
    HTTP_CLIENT
        .get()
        .ok_or_else(|| "OpenAI APIクライアントを準備できません".to_string())
}

fn active_requests() -> &'static Mutex<HashMap<String, AbortHandle>> {
    ACTIVE_REQUESTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn api_key_cache() -> &'static Mutex<ApiKeyCache> {
    API_KEY_CACHE.get_or_init(|| Mutex::new(ApiKeyCache::Unknown))
}

fn load_api_key_from_cache_or_keychain() -> Result<Option<String>, String> {
    // Keep the lock while reading Keychain so simultaneous UI status requests do not
    // trigger multiple macOS authorization dialogs.
    let mut cache = api_key_cache()
        .lock()
        .map_err(|_| "OpenAI APIキーのキャッシュを読み取れません".to_string())?;

    match &*cache {
        ApiKeyCache::Present(api_key) => return Ok(Some(api_key.clone())),
        ApiKeyCache::Missing => return Ok(None),
        ApiKeyCache::Unknown => {}
    }

    match keychain_entry()?.get_password() {
        Ok(api_key) => {
            *cache = ApiKeyCache::Present(api_key.clone());
            Ok(Some(api_key))
        }
        Err(KeyringError::NoEntry) => {
            *cache = ApiKeyCache::Missing;
            Ok(None)
        }
        Err(error) => Err(format!(
            "macOS KeychainからOpenAI APIキーを読み取れません: {error}"
        )),
    }
}

async fn load_api_key() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(load_api_key_from_cache_or_keychain)
        .await
        .map_err(|error| format!("APIキー読み取り処理が終了しました: {error}"))?
}

async fn stored_api_key() -> Result<String, String> {
    load_api_key()
        .await?
        .ok_or_else(|| "OpenAI APIキーが設定されていません".to_string())
}

fn validate_api_key_format(api_key: &str) -> Result<String, String> {
    let api_key = api_key.trim();
    if api_key.len() < 20 || api_key.chars().any(char::is_whitespace) {
        return Err("OpenAI APIキーの形式を確認してください".to_string());
    }
    Ok(api_key.to_string())
}

async fn api_error(response: reqwest::Response) -> String {
    let status = response.status();
    let request_id = response_request_id(response.headers());
    let detail = response
        .json::<ApiErrorEnvelope>()
        .await
        .ok()
        .and_then(|result| result.error)
        .and_then(|error| error.message)
        .map(|message| message.chars().take(800).collect::<String>());
    let detail_suffix = detail.map(|value| format!(": {value}")).unwrap_or_default();
    let request_id_suffix = request_id
        .map(|value| format!(" (request ID: {value})"))
        .unwrap_or_default();

    match status {
        StatusCode::UNAUTHORIZED => {
            format!("OpenAI APIキーが無効です{detail_suffix}{request_id_suffix}")
        }
        StatusCode::FORBIDDEN => {
            format!(
                "このAPIキーには選択したOpenAIモデルを利用する権限がありません{detail_suffix}{request_id_suffix}"
            )
        }
        StatusCode::TOO_MANY_REQUESTS => format!(
            "OpenAI APIのレート制限または利用上限に達しました{detail_suffix}{request_id_suffix}"
        ),
        _ => format!(
            "OpenAI APIの応答に失敗しました (HTTP {status}){detail_suffix}{request_id_suffix}"
        ),
    }
}

fn model_url(model: &str) -> Result<String, String> {
    match model {
        OPENAI_MODEL | OPENAI_TRANSCRIPTION_MODEL => {
            Ok(format!("https://api.openai.com/v1/models/{model}"))
        }
        _ => Err("接続確認に対応していないOpenAIモデルです".to_string()),
    }
}

async fn verify_api_key(api_key: &str, model: &str) -> Result<(), String> {
    let response = http_client()?
        .get(model_url(model)?)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|error| format!("OpenAI APIへ接続できません: {error}"))?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(api_error(response).await)
    }
}

fn validate_client_request_id(client_request_id: &str) -> Result<(), String> {
    if client_request_id.is_empty()
        || client_request_id.len() > 128
        || !client_request_id.is_ascii()
    {
        return Err("OpenAI APIリクエストIDが不正です".to_string());
    }
    Ok(())
}

fn validate_app_local_audio_path(
    app: &tauri::AppHandle,
    audio_path: &str,
) -> Result<PathBuf, String> {
    let app_local_data = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("アプリデータディレクトリの取得に失敗しました: {error}"))?
        .canonicalize()
        .map_err(|error| format!("アプリデータディレクトリを確認できません: {error}"))?;
    let audio_path = Path::new(audio_path)
        .canonicalize()
        .map_err(|error| format!("OpenAI送信用音声を確認できません: {error}"))?;
    if !audio_path.starts_with(&app_local_data) {
        return Err("アプリデータディレクトリ外の音声は送信できません".to_string());
    }
    if audio_path.extension().and_then(|value| value.to_str()) != Some("m4a") {
        return Err("OpenAI送信用音声の形式が不正です".to_string());
    }
    let file_size = audio_path
        .metadata()
        .map_err(|error| format!("OpenAI送信用音声のサイズを確認できません: {error}"))?
        .len();
    if file_size == 0 || file_size > MAX_TRANSCRIPTION_AUDIO_BYTES {
        return Err("OpenAI送信用音声のサイズが上限を超えています".to_string());
    }
    Ok(audio_path)
}

fn validate_ocr_image_data(image_data: &str, instructions: &str) -> Result<(), String> {
    const JPEG_DATA_URL_PREFIX: &str = "data:image/jpeg;base64,";

    if !image_data.starts_with(JPEG_DATA_URL_PREFIX)
        || image_data.len() <= JPEG_DATA_URL_PREFIX.len()
    {
        return Err("OpenAI OCRへ送信する画像形式が不正です".to_string());
    }
    if image_data.len() > MAX_OCR_IMAGE_DATA_BYTES {
        return Err("OpenAI OCRへ送信する画像のサイズが上限を超えています".to_string());
    }
    if instructions.is_empty() || instructions.len() > MAX_PROMPT_BYTES {
        return Err("OpenAI OCRの指示文が大きすぎます".to_string());
    }
    Ok(())
}

fn response_request_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

fn retry_delay(response: &reqwest::Response, retry_index: usize) -> Duration {
    response
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(Duration::from_secs)
        .unwrap_or_else(|| Duration::from_secs(2_u64.saturating_pow((retry_index + 1) as u32)))
}

#[tauri::command]
pub async fn get_openai_api_key_status() -> Result<OpenAiCredentialStatus, String> {
    match load_api_key().await? {
        Some(api_key) => Ok(OpenAiCredentialStatus {
            configured: true,
            last_four: Some(
                api_key
                    .chars()
                    .rev()
                    .take(4)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect(),
            ),
        }),
        None => Ok(OpenAiCredentialStatus {
            configured: false,
            last_four: None,
        }),
    }
}

#[tauri::command]
pub async fn validate_and_save_openai_api_key(
    api_key: String,
    model: String,
) -> Result<OpenAiCredentialStatus, String> {
    let api_key = validate_api_key_format(&api_key)?;
    verify_api_key(&api_key, &model).await?;
    let last_four = api_key
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect();

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        keychain_entry()?
            .set_password(&api_key)
            .map_err(|error| format!("OpenAI APIキーをmacOS Keychainへ保存できません: {error}"))?;
        *api_key_cache()
            .lock()
            .map_err(|_| "OpenAI APIキーのキャッシュを更新できません".to_string())? =
            ApiKeyCache::Present(api_key);
        Ok(())
    })
    .await
    .map_err(|error| format!("APIキー保存処理が終了しました: {error}"))??;

    Ok(OpenAiCredentialStatus {
        configured: true,
        last_four: Some(last_four),
    })
}

#[tauri::command]
pub async fn test_openai_connection(model: String) -> Result<(), String> {
    let api_key = stored_api_key().await?;
    verify_api_key(&api_key, &model).await
}

#[tauri::command]
pub async fn delete_openai_api_key() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let entry = keychain_entry()?;
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => {
                *api_key_cache()
                    .lock()
                    .map_err(|_| "OpenAI APIキーのキャッシュを更新できません".to_string())? =
                    ApiKeyCache::Missing;
                Ok(())
            }
            Err(error) => Err(format!(
                "OpenAI APIキーをmacOS Keychainから削除できません: {error}"
            )),
        }
    })
    .await
    .map_err(|error| format!("APIキー削除処理が終了しました: {error}"))?
}

#[tauri::command]
pub fn cancel_openai_request(client_request_id: String) -> Result<bool, String> {
    let handle = active_requests()
        .lock()
        .map_err(|_| "OpenAI APIリクエストの停止状態を取得できません".to_string())?
        .remove(&client_request_id);
    if let Some(handle) = handle {
        handle.abort();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn generate_openai_article(
    request: OpenAiArticleRequest,
) -> Result<OpenAiArticleResponse, String> {
    if request.instructions.len() + request.input.len() > MAX_PROMPT_BYTES {
        return Err("OpenAIへ送信する本文生成データが大きすぎます".to_string());
    }
    validate_client_request_id(&request.client_request_id)?;

    let api_key = stored_api_key().await?;
    let body = json!({
        "model": OPENAI_MODEL,
        "reasoning": { "effort": "none" },
        "store": false,
        "instructions": request.instructions,
        "input": request.input,
        "max_output_tokens": request.max_output_tokens.clamp(1, 8192),
        "text": { "format": { "type": "text" }, "verbosity": "medium" }
    });

    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    active_requests()
        .lock()
        .map_err(|_| "OpenAI APIリクエストを開始できません".to_string())?
        .insert(request.client_request_id.clone(), abort_handle);

    let response = Abortable::new(
        http_client()?
            .post(OPENAI_RESPONSES_URL)
            .bearer_auth(api_key)
            .header("X-Client-Request-Id", &request.client_request_id)
            .json(&body)
            .send(),
        abort_registration,
    )
    .await;

    active_requests()
        .lock()
        .map_err(|_| "OpenAI APIリクエストの終了処理に失敗しました".to_string())?
        .remove(&request.client_request_id);

    let response = response
        .map_err(|_| "OpenAI APIリクエストを停止しました".to_string())?
        .map_err(|error| format!("OpenAI APIへ接続できません: {error}"))?;
    if !response.status().is_success() {
        return Err(api_error(response).await);
    }

    let request_id = response_request_id(response.headers());
    let result = response
        .json::<ResponsesApiResponse>()
        .await
        .map_err(|error| format!("OpenAI APIの応答を読み取れません: {error}"))?;
    let body = result
        .output_text
        .or_else(|| {
            let text = result
                .output
                .iter()
                .flat_map(|item| item.content.iter())
                .filter_map(|content| content.text.as_deref())
                .collect::<String>();
            (!text.trim().is_empty()).then_some(text)
        })
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "OpenAI APIの本文応答が空でした".to_string())?;

    Ok(OpenAiArticleResponse {
        body,
        request_id,
        usage: result.usage.map(|usage| OpenAiUsage {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
        }),
    })
}

#[tauri::command]
pub async fn recognize_openai_image(
    request: OpenAiOcrRequest,
) -> Result<OpenAiOcrResponse, String> {
    validate_client_request_id(&request.client_request_id)?;
    validate_ocr_image_data(&request.image_data, &request.instructions)?;

    let api_key = stored_api_key().await?;
    let body = json!({
        "model": OPENAI_MODEL,
        "store": false,
        "instructions": request.instructions,
        "input": [{
            "role": "user",
            "content": [{
                "type": "input_image",
                "image_url": request.image_data,
                "detail": "original"
            }]
        }],
        "max_output_tokens": 8192,
        "text": { "format": { "type": "text" }, "verbosity": "low" }
    });

    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    active_requests()
        .lock()
        .map_err(|_| "OpenAI APIリクエストを開始できません".to_string())?
        .insert(request.client_request_id.clone(), abort_handle);

    let response = Abortable::new(
        http_client()?
            .post(OPENAI_RESPONSES_URL)
            .bearer_auth(api_key)
            .header("X-Client-Request-Id", &request.client_request_id)
            .json(&body)
            .send(),
        abort_registration,
    )
    .await;

    active_requests()
        .lock()
        .map_err(|_| "OpenAI APIリクエストの終了処理に失敗しました".to_string())?
        .remove(&request.client_request_id);

    let response = response
        .map_err(|_| "OpenAI APIリクエストを停止しました".to_string())?
        .map_err(|error| format!("OpenAI APIへ接続できません: {error}"))?;
    if !response.status().is_success() {
        return Err(api_error(response).await);
    }

    let request_id = response_request_id(response.headers());
    let result = response
        .json::<ResponsesApiResponse>()
        .await
        .map_err(|error| format!("OpenAI OCRの応答を読み取れません: {error}"))?;
    let text = result
        .output_text
        .or_else(|| {
            let text = result
                .output
                .iter()
                .flat_map(|item| item.content.iter())
                .filter_map(|content| content.text.as_deref())
                .collect::<String>();
            (!text.trim().is_empty()).then_some(text)
        })
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "OpenAI OCRの応答が空でした".to_string())?;

    Ok(OpenAiOcrResponse {
        text,
        request_id,
        usage: result.usage.map(|usage| OpenAiUsage {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
        }),
    })
}

#[tauri::command]
pub async fn transcribe_openai_audio(
    app: tauri::AppHandle,
    request: OpenAiTranscriptionRequest,
) -> Result<OpenAiTranscriptionResponse, String> {
    validate_client_request_id(&request.client_request_id)?;
    if request.languages.as_ref().is_some_and(|languages| {
        languages.is_empty()
            || languages
                .iter()
                .any(|language| !matches!(language.as_str(), "ja" | "en"))
    }) {
        return Err("OpenAI文字起こしの言語設定が不正です".to_string());
    }

    let audio_path = validate_app_local_audio_path(&app, &request.audio_path)?;
    let api_key = stored_api_key().await?;

    let client = http_client()?;
    let mut retry_index = 0;
    let response = loop {
        let audio_part = multipart::Part::file(&audio_path)
            .await
            .map_err(|error| format!("OpenAI送信用音声を開けません: {error}"))?
            .file_name("lecture-chunk.m4a")
            .mime_str("audio/mp4")
            .map_err(|error| format!("OpenAI送信用音声の形式を設定できません: {error}"))?;
        let mut form = multipart::Form::new()
            .text("model", OPENAI_TRANSCRIPTION_MODEL)
            .text("response_format", "json")
            .part("file", audio_part);
        if let Some(languages) = request.languages.as_ref() {
            for language in languages {
                form = form.text("languages[]", language.to_string());
            }
        }
        if let Some(prompt) = request
            .prompt
            .as_deref()
            .filter(|prompt| !prompt.trim().is_empty())
        {
            form = form.text("prompt", prompt.to_string());
        }
        if let Some(keywords) = request.keywords.as_ref() {
            for keyword in keywords {
                let keyword = keyword.trim();
                if !keyword.is_empty() {
                    form = form.text("keywords[]", keyword.to_string());
                }
            }
        }

        let (abort_handle, abort_registration) = AbortHandle::new_pair();
        active_requests()
            .lock()
            .map_err(|_| "OpenAI APIリクエストを開始できません".to_string())?
            .insert(request.client_request_id.clone(), abort_handle);

        let response = Abortable::new(
            client
                .post(OPENAI_TRANSCRIPTIONS_URL)
                .bearer_auth(&api_key)
                .header("X-Client-Request-Id", &request.client_request_id)
                .timeout(Duration::from_secs(600))
                .multipart(form)
                .send(),
            abort_registration,
        )
        .await;

        active_requests()
            .lock()
            .map_err(|_| "OpenAI APIリクエストの終了処理に失敗しました".to_string())?
            .remove(&request.client_request_id);

        let response = response
            .map_err(|_| "OpenAI APIリクエストを停止しました".to_string())?
            .map_err(|error| format!("OpenAI APIへ接続できません: {error}"))?;
        if matches!(
            response.status(),
            StatusCode::TOO_MANY_REQUESTS | StatusCode::SERVICE_UNAVAILABLE
        ) && retry_index < MAX_TRANSCRIPTION_RETRIES
        {
            let delay = retry_delay(&response, retry_index);
            retry_index += 1;
            tokio::time::sleep(delay).await;
            continue;
        }
        break response;
    };

    if !response.status().is_success() {
        return Err(api_error(response).await);
    }

    let request_id = response_request_id(response.headers());
    let result = response
        .json::<TranscriptionsApiResponse>()
        .await
        .map_err(|error| format!("OpenAI文字起こしの応答を読み取れません: {error}"))?;
    let text = result.text.trim().to_string();

    Ok(OpenAiTranscriptionResponse {
        text,
        language: result.language,
        duration_seconds: result.duration,
        request_id,
        segments: result
            .segments
            .into_iter()
            .filter(|segment| {
                segment.start.is_finite()
                    && segment.end.is_finite()
                    && segment.end >= segment.start
                    && !segment.text.trim().is_empty()
            })
            .map(|segment| OpenAiTranscriptionSegment {
                start_seconds: segment.start,
                end_seconds: segment.end,
                text: segment.text,
            })
            .collect(),
    })
}
