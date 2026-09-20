use std::{
    fs,
    path::{Path, PathBuf},
};

pub(crate) struct AssetFileMetadata {
    pub byte_size: i64,
    pub missing_at: Option<String>,
}

pub(crate) fn resolve_asset_path(
    app_data_dir: &Path,
    project_id: &str,
    relative_path: &str,
) -> PathBuf {
    let path = Path::new(relative_path);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        app_data_dir.join("projects").join(project_id).join(path)
    }
}

pub(crate) fn inspect_asset(
    app_data_dir: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<AssetFileMetadata, String> {
    let path = resolve_asset_path(app_data_dir, project_id, relative_path);
    let metadata = match fs::metadata(&path) {
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) => {
            return Err(format!(
                "assetが通常ファイルではありません: {}",
                path.display()
            ))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(AssetFileMetadata {
                byte_size: 0,
                missing_at: Some("now".to_string()),
            })
        }
        Err(error) => {
            return Err(format!(
                "assetのメタデータを読めませんでした ({}): {error}",
                path.display()
            ))
        }
    };
    let byte_size = i64::try_from(metadata.len())
        .map_err(|_| format!("assetのサイズが大きすぎます: {}", path.display()))?;
    Ok(AssetFileMetadata {
        byte_size,
        missing_at: None,
    })
}
