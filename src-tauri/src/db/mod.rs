use serde_json::Value;
use sqlx::SqlitePool;
use std::path::{Component, Path, PathBuf};

#[derive(Clone)]
pub struct DbState {
    pub pool: SqlitePool,
    pub app_data_dir: PathBuf,
}

mod assets;
mod connection;
mod repositories;
pub mod services;

#[cfg(test)]
mod tests;

pub use connection::initialize;

pub(crate) fn value_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("保存対象の{key}がありません。"))
}

pub(crate) fn optional_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

pub(crate) fn validate_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
    {
        return Err(format!("不正な{label}です。"));
    }
    Ok(())
}

pub(crate) fn validate_asset_path(value: &str) -> Result<(), String> {
    if value.trim().is_empty()
        || value.contains('\0')
        || Path::new(value)
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        || value.split(['/', '\\']).any(|component| component == "..")
    {
        return Err("不正なassetパスです。".to_string());
    }
    Ok(())
}

pub(crate) fn json_value(value: &Value, key: &str, default: Value) -> Result<String, String> {
    required_json_text(value.get(key), default)
}

pub(crate) fn value_i64(value: &Value, key: &str, default: i64) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or(default)
}

pub(crate) fn json_text(value: Option<&Value>) -> Result<Option<String>, String> {
    value
        .map(|value| {
            serde_json::to_string(value)
                .map_err(|error| format!("JSONを保存できませんでした: {error}"))
        })
        .transpose()
}

pub(crate) fn required_json_text(value: Option<&Value>, default: Value) -> Result<String, String> {
    serde_json::to_string(value.unwrap_or(&default))
        .map_err(|error| format!("JSONを保存できませんでした: {error}"))
}

pub(crate) fn id_from(prefix: &str, source: &str) -> String {
    format!("derived-{prefix}-{source}")
}
