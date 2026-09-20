use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

// WKWebView can reject large media responses served through Tauri's asset:// scheme.
// A loopback HTTP endpoint gives it normal byte-range semantics without buffering the file.
const MAX_REQUEST_BYTES: usize = 16 * 1024;
const COPY_BUFFER_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy)]
pub struct VideoServerState {
    address: SocketAddr,
    secret: u128,
}

impl VideoServerState {
    pub fn url_for(&self, path: &str) -> Result<String, String> {
        let path = Path::new(path);
        if !path.is_file() {
            return Err("動画ファイルが見つかりません".to_string());
        }

        let encoded_path = hex_encode(path.as_os_str().to_string_lossy().as_bytes());
        Ok(format!(
            "http://{}/video/{:x}/{}",
            self.address, self.secret, encoded_path
        ))
    }
}

#[tauri::command]
pub fn video_stream_url(
    state: tauri::State<'_, VideoServerState>,
    path: String,
) -> Result<String, String> {
    state.url_for(&path)
}

pub fn start() -> io::Result<VideoServerState> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let address = listener.local_addr()?;
    let secret = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        ^ u128::from(std::process::id());

    thread::Builder::new()
        .name("video-file-server".to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        let _ = thread::Builder::new()
                            .name("video-file-request".to_string())
                            .spawn(move || {
                                if let Err(error) = handle_connection(stream, secret) {
                                    log::debug!("video stream request failed: {error}");
                                }
                            });
                    }
                    Err(error) => log::debug!("video stream listener failed: {error}"),
                }
            }
        })?;

    Ok(VideoServerState { address, secret })
}

fn handle_connection(mut stream: TcpStream, secret: u128) -> io::Result<()> {
    let mut request = Vec::with_capacity(1024);
    let mut buffer = [0_u8; 1024];

    loop {
        let bytes_read = stream.read(&mut buffer)?;
        if bytes_read == 0 {
            return Ok(());
        }
        request.extend_from_slice(&buffer[..bytes_read]);

        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if request.len() >= MAX_REQUEST_BYTES {
            write_error(&mut stream, "400 Bad Request")?;
            return Ok(());
        }
    }

    let request = match std::str::from_utf8(&request) {
        Ok(request) => request,
        Err(_) => {
            write_error(&mut stream, "400 Bad Request")?;
            return Ok(());
        }
    };
    let mut lines = request.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default();
    let target = request_parts.next().unwrap_or_default();

    if method != "GET" && method != "HEAD" {
        write_error(&mut stream, "405 Method Not Allowed")?;
        return Ok(());
    }

    let range = lines
        .filter_map(|line| line.split_once(':'))
        .find_map(|(name, value)| {
            name.eq_ignore_ascii_case("range")
                .then(|| value.trim().to_string())
        });

    let Some(path_hex) = target.strip_prefix("/video/") else {
        write_error(&mut stream, "404 Not Found")?;
        return Ok(());
    };
    let Some((secret_hex, path_hex)) = path_hex.split_once('/') else {
        write_error(&mut stream, "404 Not Found")?;
        return Ok(());
    };
    if secret_hex != format!("{secret:x}") {
        write_error(&mut stream, "404 Not Found")?;
        return Ok(());
    }

    let Some(path) = hex_decode(path_hex).and_then(|bytes| String::from_utf8(bytes).ok()) else {
        write_error(&mut stream, "404 Not Found")?;
        return Ok(());
    };

    let path = PathBuf::from(path);
    let mut file = match File::open(&path) {
        Ok(file) => file,
        Err(_) => {
            write_error(&mut stream, "404 Not Found")?;
            return Ok(());
        }
    };
    let length = file.metadata()?.len();
    let content_type = video_content_type(&path);

    let response = match range.as_deref() {
        Some(range) => match parse_range(range, length) {
            Some((start, end)) => ("206 Partial Content", start, end, true),
            None => {
                write_range_error(&mut stream, length)?;
                return Ok(());
            }
        },
        None => ("200 OK", 0, length.saturating_sub(1), false),
    };
    let (status, start, end, is_partial) = response;
    let content_length = if length == 0 { 0 } else { end - start + 1 };

    let mut headers = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {content_length}\r\n\
         Accept-Ranges: bytes\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Expose-Headers: Accept-Ranges, Content-Length, Content-Range\r\n\
         Connection: close\r\n"
    );
    if is_partial {
        headers.push_str(&format!("Content-Range: bytes {start}-{end}/{length}\r\n"));
    }
    headers.push_str("\r\n");
    stream.write_all(headers.as_bytes())?;

    if method == "HEAD" || content_length == 0 {
        return Ok(());
    }

    file.seek(SeekFrom::Start(start))?;
    let mut remaining = content_length;
    let mut buffer = [0_u8; COPY_BUFFER_BYTES];
    while remaining > 0 {
        let bytes_to_read = remaining.min(buffer.len() as u64) as usize;
        let bytes_read = file.read(&mut buffer[..bytes_to_read])?;
        if bytes_read == 0 {
            break;
        }
        stream.write_all(&buffer[..bytes_read])?;
        remaining -= bytes_read as u64;
    }

    Ok(())
}

fn parse_range(value: &str, length: u64) -> Option<(u64, u64)> {
    if length == 0 {
        return None;
    }
    let range = value.strip_prefix("bytes=")?.trim();
    if range.contains(',') {
        return None;
    }
    let (start, end) = range.split_once('-')?;

    if start.is_empty() {
        let suffix_length = end.parse::<u64>().ok()?;
        if suffix_length == 0 {
            return None;
        }
        let start = length.saturating_sub(suffix_length);
        return Some((start, length - 1));
    }

    let start = start.parse::<u64>().ok()?;
    if start >= length {
        return None;
    }
    let end = end
        .parse::<u64>()
        .ok()
        .map_or(length - 1, |end| end.min(length - 1));
    (start <= end).then_some((start, end))
}

fn video_content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("mp4") => "video/mp4",
        Some(extension) if extension.eq_ignore_ascii_case("m4v") => "video/mp4",
        Some(extension) if extension.eq_ignore_ascii_case("mov") => "video/quicktime",
        Some(extension) if extension.eq_ignore_ascii_case("mkv") => "video/x-matroska",
        Some(extension) if extension.eq_ignore_ascii_case("webm") => "video/webm",
        _ => "application/octet-stream",
    }
}

fn write_error(stream: &mut TcpStream, status: &str) -> io::Result<()> {
    let body = status.as_bytes();
    stream.write_all(
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .as_bytes(),
    )?;
    stream.write_all(body)
}

fn write_range_error(stream: &mut TcpStream, length: u64) -> io::Result<()> {
    stream.write_all(
        format!(
            "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{length}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        )
        .as_bytes(),
    )
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push_str(&format!("{byte:02x}"));
    }
    encoded
}

fn hex_decode(value: &str) -> Option<Vec<u8>> {
    if value.is_empty() || !value.len().is_multiple_of(2) {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn serves_a_requested_byte_range() {
        let path =
            std::env::temp_dir().join(format!("yomlecta-video-server-{}.mp4", std::process::id()));
        fs::write(&path, b"0123456789").expect("create test video");

        let state = start().expect("start video server");
        let url = state
            .url_for(path.to_str().expect("test path is valid UTF-8"))
            .unwrap();
        let server_url = url.strip_prefix("http://").unwrap();
        let (address, request_path) = server_url.split_once('/').unwrap();
        let mut stream = TcpStream::connect(address).expect("connect to video server");
        write!(
            stream,
            "GET /{request_path} HTTP/1.1\r\nHost: {address}\r\nRange: bytes=2-5\r\n\r\n"
        )
        .expect("send range request");

        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .expect("read range response");
        let response = String::from_utf8_lossy(&response);
        assert!(response.starts_with("HTTP/1.1 206 Partial Content\r\n"));
        assert!(response.ends_with("\r\n\r\n2345"));

        fs::remove_file(path).expect("remove test video");
    }
}
