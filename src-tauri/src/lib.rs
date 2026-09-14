use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, Local, SecondsFormat, Utc};
use rand::{rngs::OsRng, seq::SliceRandom, RngCore};
use reqwest::header::{CONTENT_LENGTH, CONTENT_TYPE};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use url::Url;
use zeroize::Zeroize;

const LOG_LIMIT_BYTES: u64 = 10 * 1024 * 1024;
const LOG_TRIM_TARGET_BYTES: usize = 9 * 1024 * 1024;
const REMOTE_IMAGE_LIMIT_BYTES: usize = 15 * 1024 * 1024;
const OFFICE_EXPORT_LIMIT_BYTES: usize = 128 * 1024 * 1024;
const DATA_KEY_BYTES: usize = 32;
const NONCE_BYTES: usize = 12;
const SALT_BYTES: usize = 16;
const RECOVERY_CODE_LENGTH: usize = 16;
const ENCRYPTED_FORMAT: &str = "encrypted-v1";
const BACKUP_FORMAT: &str = "account-notebook-backup-v3";
const LEGACY_BACKUP_FORMAT: &str = "account-notebook-backup-v2";
const IMAGE_ENCRYPTED_MAGIC: &[u8; 8] = b"ANBIMG1\0";
const SYNC_LOCAL_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveResult {
    data_dir: String,
    updated_at: String,
    data: Value,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuditEvent {
    id: String,
    timestamp: String,
    service_name: String,
    account_label: Option<String>,
    action: String,
    fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedEnvelope {
    format: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyWrap {
    salt: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecurityConfig {
    format_version: u32,
    startup_lock_enabled: bool,
    automatic_key: Option<String>,
    password_wrap: Option<KeyWrap>,
    recovery_wrap: Option<KeyWrap>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecurityStatus {
    startup_lock_enabled: bool,
    unlocked: bool,
    requires_password_change: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UnlockResult {
    unlocked_via_recovery: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnableLockResult {
    recovery_code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageStats {
    last_backup_at: Option<String>,
    data_size_bytes: u64,
    image_size_bytes: u64,
    backup_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupDocument {
    format: String,
    created_at: String,
    security: SecurityConfig,
    #[serde(default)]
    backup_credential_wrap: Option<KeyWrap>,
    #[serde(default)]
    local_only: bool,
    vault: EncryptedEnvelope,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupInfo {
    startup_lock_enabled: bool,
    created_at: String,
    requires_credential: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SyncLocalState {
    format_version: u32,
    device_id: String,
    #[serde(default)]
    last_synced_vault_id: Option<String>,
    last_synced_snapshot_id: Option<String>,
    last_synced_vault_revision: u64,
    last_synced_at: Option<String>,
}

struct SecurityRuntime {
    data_key: Option<[u8; DATA_KEY_BYTES]>,
    unlocked_via_recovery: bool,
}

impl Drop for SecurityRuntime {
    fn drop(&mut self) {
        if let Some(mut key) = self.data_key.take() {
            key.zeroize();
        }
    }
}

struct SecurityState {
    runtime: Mutex<SecurityRuntime>,
    save_gate: Mutex<()>,
}

fn data_directory() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(error_string)?;
    let parent = executable
        .parent()
        .ok_or_else(|| "无法确定程序所在目录".to_string())?;
    let directory = parent.join("data");
    fs::create_dir_all(directory.join("images")).map_err(error_string)?;
    fs::create_dir_all(directory.join("icons")).map_err(error_string)?;
    fs::create_dir_all(directory.join("backups")).map_err(error_string)?;
    fs::create_dir_all(directory.join("exports")).map_err(error_string)?;
    Ok(directory)
}

fn security_path(directory: &Path) -> PathBuf {
    directory.join("security.json")
}

fn sync_local_state_path(directory: &Path) -> PathBuf {
    directory.join("device.json")
}

fn generate_device_id() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    format!(
        "device-{}",
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}

fn read_or_initialize_sync_local_state(directory: &Path) -> Result<SyncLocalState, String> {
    let path = sync_local_state_path(directory);
    if path.exists() {
        let state: SyncLocalState = serde_json::from_slice(&fs::read(path).map_err(error_string)?)
            .map_err(|_| "本机同步配置损坏，无法读取设备编号".to_string())?;
        if state.format_version != SYNC_LOCAL_FORMAT_VERSION || state.device_id.trim().is_empty() {
            return Err("本机同步配置版本或设备编号无效".to_string());
        }
        return Ok(state);
    }

    let state = SyncLocalState {
        format_version: SYNC_LOCAL_FORMAT_VERSION,
        device_id: generate_device_id(),
        last_synced_vault_id: None,
        last_synced_snapshot_id: None,
        last_synced_vault_revision: 0,
        last_synced_at: None,
    };
    let payload = serde_json::to_vec_pretty(&state).map_err(error_string)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(error_string)?;
    file.write_all(&payload).map_err(error_string)?;
    file.sync_all().map_err(error_string)?;
    Ok(state)
}

fn write_sync_local_state(directory: &Path, state: &SyncLocalState) -> Result<(), String> {
    let path = sync_local_state_path(directory);
    let payload = serde_json::to_vec_pretty(state).map_err(error_string)?;
    if path.exists() {
        replace_file_atomically(&path, &payload)
    } else {
        write_new_file_atomically(&path, &payload)
    }
}

fn record_sync_success_in_directory(
    directory: &Path,
    vault_id: &str,
    snapshot_id: &str,
    vault_revision: u64,
) -> Result<SyncLocalState, String> {
    let vault_id = vault_id.trim();
    let snapshot_id = snapshot_id.trim();
    if vault_id.is_empty()
        || snapshot_id.is_empty()
        || vault_id.len() > 256
        || snapshot_id.len() > 256
    {
        return Err("同步成功游标缺少有效编号".to_string());
    }
    let mut state = read_or_initialize_sync_local_state(directory)?;
    if state.last_synced_vault_id.as_deref() == Some(vault_id) {
        if vault_revision < state.last_synced_vault_revision {
            return Err("不能写入回退的同步 revision".to_string());
        }
        if state.last_synced_snapshot_id.as_deref() == Some(snapshot_id)
            && vault_revision != state.last_synced_vault_revision
        {
            return Err("同一快照编号不能对应不同 revision".to_string());
        }
    }
    state.last_synced_vault_id = Some(vault_id.to_string());
    state.last_synced_snapshot_id = Some(snapshot_id.to_string());
    state.last_synced_vault_revision = vault_revision;
    state.last_synced_at = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true));
    write_sync_local_state(directory, &state)?;
    Ok(state)
}

fn initialize_security() -> Result<SecurityState, String> {
    let directory = data_directory()?;
    let path = security_path(&directory);
    let (config, data_key) = if path.exists() {
        let config: SecurityConfig =
            serde_json::from_slice(&fs::read(&path).map_err(error_string)?)
                .map_err(|_| "安全配置损坏，无法确定数据密钥".to_string())?;
        if config.startup_lock_enabled {
            (config, None)
        } else {
            let key = config
                .automatic_key
                .as_deref()
                .ok_or_else(|| "安全配置缺少自动解锁密钥".to_string())
                .and_then(decode_data_key)?;
            (config, Some(key))
        }
    } else {
        let key = random_data_key();
        let config = SecurityConfig {
            format_version: 1,
            startup_lock_enabled: false,
            automatic_key: Some(BASE64.encode(key)),
            password_wrap: None,
            recovery_wrap: None,
        };
        write_security_config(&directory, &config)?;
        (config, Some(key))
    };
    let _ = config;
    Ok(SecurityState {
        runtime: Mutex::new(SecurityRuntime {
            data_key,
            unlocked_via_recovery: false,
        }),
        save_gate: Mutex::new(()),
    })
}

fn read_security_config(directory: &Path) -> Result<SecurityConfig, String> {
    serde_json::from_slice(&fs::read(security_path(directory)).map_err(error_string)?)
        .map_err(|_| "安全配置损坏，无法读取".to_string())
}

fn write_security_config(directory: &Path, config: &SecurityConfig) -> Result<(), String> {
    let payload = serde_json::to_vec_pretty(config).map_err(error_string)?;
    let mut suffix = [0u8; 8];
    OsRng.fill_bytes(&mut suffix);
    let temporary = directory.join(format!(
        "security-{}.tmp",
        suffix
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ));
    let write_result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(error_string)?;
        file.write_all(&payload).map_err(error_string)?;
        file.sync_all().map_err(error_string)?;
        fs::rename(&temporary, security_path(directory)).map_err(error_string)
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

fn random_data_key() -> [u8; DATA_KEY_BYTES] {
    let mut key = [0u8; DATA_KEY_BYTES];
    OsRng.fill_bytes(&mut key);
    key
}

fn decode_data_key(encoded: &str) -> Result<[u8; DATA_KEY_BYTES], String> {
    let bytes = BASE64
        .decode(encoded)
        .map_err(|_| "数据密钥格式无效".to_string())?;
    bytes.try_into().map_err(|_| "数据密钥长度无效".to_string())
}

fn derive_wrapping_key(secret: &str, salt: &[u8]) -> Result<[u8; DATA_KEY_BYTES], String> {
    let params = Params::new(19 * 1024, 2, 1, Some(DATA_KEY_BYTES)).map_err(error_string)?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut output = [0u8; DATA_KEY_BYTES];
    argon2
        .hash_password_into(secret.as_bytes(), salt, &mut output)
        .map_err(error_string)?;
    Ok(output)
}

fn encrypt_bytes(
    key: &[u8; DATA_KEY_BYTES],
    plaintext: &[u8],
) -> Result<EncryptedEnvelope, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(error_string)?;
    let mut nonce_bytes = [0u8; NONCE_BYTES];
    OsRng.fill_bytes(&mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|_| "数据加密失败".to_string())?;
    Ok(EncryptedEnvelope {
        format: ENCRYPTED_FORMAT.to_string(),
        nonce: BASE64.encode(nonce_bytes),
        ciphertext: BASE64.encode(ciphertext),
    })
}

fn decrypt_bytes(
    key: &[u8; DATA_KEY_BYTES],
    envelope: &EncryptedEnvelope,
) -> Result<Vec<u8>, String> {
    if envelope.format != ENCRYPTED_FORMAT {
        return Err("不支持的加密数据格式".to_string());
    }
    let nonce = BASE64
        .decode(&envelope.nonce)
        .map_err(|_| "加密随机数格式无效".to_string())?;
    if nonce.len() != NONCE_BYTES {
        return Err("加密随机数长度无效".to_string());
    }
    let ciphertext = BASE64
        .decode(&envelope.ciphertext)
        .map_err(|_| "加密正文格式无效".to_string())?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(error_string)?;
    cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| "密码、恢复码或数据文件不正确".to_string())
}

fn wrap_data_key(secret: &str, data_key: &[u8; DATA_KEY_BYTES]) -> Result<KeyWrap, String> {
    let mut salt = [0u8; SALT_BYTES];
    OsRng.fill_bytes(&mut salt);
    let mut wrapping_key = derive_wrapping_key(secret, &salt)?;
    let envelope = encrypt_bytes(&wrapping_key, data_key)?;
    wrapping_key.zeroize();
    Ok(KeyWrap {
        salt: BASE64.encode(salt),
        nonce: envelope.nonce,
        ciphertext: envelope.ciphertext,
    })
}

fn unwrap_data_key(secret: &str, wrapped: &KeyWrap) -> Result<[u8; DATA_KEY_BYTES], String> {
    let salt = BASE64
        .decode(&wrapped.salt)
        .map_err(|_| "密钥盐格式无效".to_string())?;
    let mut wrapping_key = derive_wrapping_key(secret, &salt)?;
    let decrypted = decrypt_bytes(
        &wrapping_key,
        &EncryptedEnvelope {
            format: ENCRYPTED_FORMAT.to_string(),
            nonce: wrapped.nonce.clone(),
            ciphertext: wrapped.ciphertext.clone(),
        },
    );
    wrapping_key.zeroize();
    decrypted?
        .try_into()
        .map_err(|_| "数据密钥长度无效".to_string())
}

fn generate_recovery_code() -> String {
    const UPPER: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ";
    const LOWER: &[u8] = b"abcdefghijkmnopqrstuvwxyz";
    const DIGITS: &[u8] = b"23456789";
    const SYMBOLS: &[u8] = b"!@#$%&*+-=?";
    let all = [UPPER, LOWER, DIGITS, SYMBOLS].concat();
    let mut rng = OsRng;
    let mut characters = vec![
        *UPPER.choose(&mut rng).expect("upper alphabet is not empty"),
        *LOWER.choose(&mut rng).expect("lower alphabet is not empty"),
        *DIGITS
            .choose(&mut rng)
            .expect("digit alphabet is not empty"),
        *SYMBOLS
            .choose(&mut rng)
            .expect("symbol alphabet is not empty"),
    ];
    while characters.len() < RECOVERY_CODE_LENGTH {
        characters.push(
            *all.choose(&mut rng)
                .expect("recovery alphabet is not empty"),
        );
    }
    characters.shuffle(&mut rng);
    String::from_utf8(characters).expect("recovery alphabet is ASCII")
}

fn rotate_recovery_wrap(
    mut config: SecurityConfig,
    data_key: &[u8; DATA_KEY_BYTES],
) -> Result<(SecurityConfig, String), String> {
    if !config.startup_lock_enabled {
        return Err("请先启用启动密码".to_string());
    }
    let recovery_code = generate_recovery_code();
    config.recovery_wrap = Some(wrap_data_key(&recovery_code, data_key)?);
    Ok((config, recovery_code))
}

fn directory_size(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }
    let mut total = 0u64;
    for entry in fs::read_dir(path).map_err(error_string)? {
        let entry = entry.map_err(error_string)?;
        let file_type = entry.file_type().map_err(error_string)?;
        if file_type.is_symlink() {
            continue;
        }
        total = total.saturating_add(if file_type.is_dir() {
            directory_size(&entry.path())?
        } else if file_type.is_file() {
            entry.metadata().map_err(error_string)?.len()
        } else {
            0
        });
    }
    Ok(total)
}

fn backup_summary(path: &Path) -> Result<(Option<String>, usize), String> {
    let mut latest = None;
    let mut count = 0usize;
    if !path.exists() {
        return Ok((None, count));
    }
    for entry in fs::read_dir(path).map_err(error_string)? {
        let entry = entry.map_err(error_string)?;
        let file_type = entry.file_type().map_err(error_string)?;
        let is_backup = file_type.is_file()
            && entry
                .path()
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("anb"));
        if !is_backup {
            continue;
        }
        count += 1;
        let modified = entry
            .metadata()
            .map_err(error_string)?
            .modified()
            .map_err(error_string)?;
        if latest.map_or(true, |current| modified > current) {
            latest = Some(modified);
        }
    }
    let timestamp = latest
        .map(|value| DateTime::<Utc>::from(value).to_rfc3339_opts(SecondsFormat::Millis, true));
    Ok((timestamp, count))
}

fn current_data_key(state: &State<'_, SecurityState>) -> Result<[u8; DATA_KEY_BYTES], String> {
    state
        .runtime
        .lock()
        .map_err(|_| "安全状态暂时不可用".to_string())?
        .data_key
        .ok_or_else(|| "数据仍处于锁定状态".to_string())
}

fn open_database(directory: &Path) -> Result<Connection, String> {
    let connection =
        Connection::open(directory.join("account-notebook.sqlite3")).map_err(error_string)?;
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA secure_delete = ON;",
        )
        .map_err(error_string)?;
    let version = connection
        .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
        .map_err(error_string)?;
    match version {
        0 => connection
            .execute_batch(
                "BEGIN;
                 CREATE TABLE IF NOT EXISTS app_state (
                   id INTEGER PRIMARY KEY CHECK (id = 1),
                   schema_version INTEGER NOT NULL,
                   payload TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );
                 PRAGMA user_version = 2;
                 COMMIT;",
            )
            .map_err(error_string)?,
        1 => connection
            .execute_batch(
                "PRAGMA wal_checkpoint(TRUNCATE);
                 VACUUM;
                 PRAGMA user_version = 2;",
            )
            .map_err(error_string)?,
        2 => {}
        unsupported => {
            return Err(format!(
                "数据库版本 {unsupported} 高于当前程序支持的版本，请使用更新版本打开"
            ));
        }
    }
    Ok(connection)
}

fn write_encrypted_payload(
    connection: &Connection,
    data: &Value,
    key: &[u8; DATA_KEY_BYTES],
) -> Result<String, String> {
    let plaintext = serde_json::to_vec(data).map_err(error_string)?;
    let envelope = encrypt_bytes(key, &plaintext)?;
    let payload = serde_json::to_string(&envelope).map_err(error_string)?;
    let updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    connection
        .execute(
            "INSERT INTO app_state (id, schema_version, payload, updated_at)
             VALUES (1, 2, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET
               schema_version = excluded.schema_version,
               payload = excluded.payload,
               updated_at = excluded.updated_at",
            params![payload, updated_at],
        )
        .map_err(error_string)?;
    Ok(updated_at)
}

fn decode_database_payload(
    payload: &str,
    key: &[u8; DATA_KEY_BYTES],
) -> Result<(Value, bool), String> {
    let parsed: Value = serde_json::from_str(payload).map_err(error_string)?;
    if parsed.get("format").and_then(Value::as_str) == Some(ENCRYPTED_FORMAT) {
        let envelope: EncryptedEnvelope = serde_json::from_value(parsed).map_err(error_string)?;
        let plaintext = decrypt_bytes(key, &envelope)?;
        Ok((
            serde_json::from_slice(&plaintext).map_err(error_string)?,
            false,
        ))
    } else {
        Ok((parsed, true))
    }
}

/// Verifies a freshly launched portable directory without changing its vault.
/// This is intentionally exposed only to the native release smoke-test entrypoint.
pub fn verify_first_run() -> Result<(), String> {
    let security = initialize_security()?;
    if security
        .runtime
        .lock()
        .map_err(|_| "安全状态暂时不可用".to_string())?
        .data_key
        .is_none()
    {
        return Err("首次启动验收要求关闭启动密码".to_string());
    }
    let key = security
        .runtime
        .lock()
        .map_err(|_| "安全状态暂时不可用".to_string())?
        .data_key
        .ok_or_else(|| "首次启动验收缺少自动解锁密钥".to_string())?;
    let directory = data_directory()?;
    let connection = open_database(&directory)?;
    let payload = connection
        .query_row("SELECT payload FROM app_state WHERE id = 1", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(error_string)?;
    let (value, was_plaintext) = decode_database_payload(&payload, &key)?;
    if was_plaintext {
        return Err("首次启动数据库 payload 未使用加密格式".to_string());
    }
    if value.get("version").and_then(Value::as_u64).is_none() {
        return Err("首次启动数据缺少有效版本号".to_string());
    }
    for field in ["categories", "tags", "services", "accounts", "recycleBin"] {
        let is_empty_array = value
            .get(field)
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty);
        if !is_empty_array {
            return Err(format!("首次启动数据的 {field} 不为空"));
        }
    }
    if !value.get("settings").is_some_and(Value::is_object)
        || !value.get("sync").is_some_and(Value::is_object)
    {
        return Err("首次启动数据缺少设置或同步元数据".to_string());
    }
    Ok(())
}

#[tauri::command]
fn get_sync_local_state() -> Result<SyncLocalState, String> {
    read_or_initialize_sync_local_state(&data_directory()?)
}

#[tauri::command]
fn record_sync_success(
    vault_id: String,
    snapshot_id: String,
    vault_revision: u64,
) -> Result<SyncLocalState, String> {
    record_sync_success_in_directory(&data_directory()?, &vault_id, &snapshot_id, vault_revision)
}

#[tauri::command]
fn get_security_status(state: State<'_, SecurityState>) -> Result<SecurityStatus, String> {
    let config = read_security_config(&data_directory()?)?;
    let runtime = state
        .runtime
        .lock()
        .map_err(|_| "安全状态暂时不可用".to_string())?;
    Ok(SecurityStatus {
        startup_lock_enabled: config.startup_lock_enabled,
        unlocked: runtime.data_key.is_some(),
        requires_password_change: runtime.unlocked_via_recovery,
    })
}

#[tauri::command]
fn unlock_vault(
    credential: String,
    state: State<'_, SecurityState>,
) -> Result<UnlockResult, String> {
    if credential.is_empty() {
        return Err("请输入启动密码或恢复码".to_string());
    }
    let directory = data_directory()?;
    let config = read_security_config(&directory)?;
    if !config.startup_lock_enabled {
        return Err("当前未启用启动密码".to_string());
    }

    let password_result = config
        .password_wrap
        .as_ref()
        .ok_or_else(|| "安全配置缺少密码密钥".to_string())
        .and_then(|wrapped| unwrap_data_key(&credential, wrapped));
    let (key, via_recovery) = match password_result {
        Ok(key) => (key, false),
        Err(_) => {
            let key = config
                .recovery_wrap
                .as_ref()
                .ok_or_else(|| "安全配置缺少恢复密钥".to_string())
                .and_then(|wrapped| unwrap_data_key(&credential, wrapped))
                .map_err(|_| "启动密码或恢复码不正确".to_string())?;
            (key, true)
        }
    };

    if let Ok(connection) = open_database(&directory) {
        let payload =
            connection.query_row("SELECT payload FROM app_state WHERE id = 1", [], |row| {
                row.get::<_, String>(0)
            });
        if let Ok(payload) = payload {
            decode_database_payload(&payload, &key)
                .map_err(|_| "启动密码或恢复码不正确".to_string())?;
        }
    }

    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "安全状态暂时不可用".to_string())?;
    runtime.data_key = Some(key);
    runtime.unlocked_via_recovery = via_recovery;
    Ok(UnlockResult {
        unlocked_via_recovery: via_recovery,
    })
}

#[tauri::command]
fn enable_startup_lock(
    password: String,
    state: State<'_, SecurityState>,
) -> Result<EnableLockResult, String> {
    if password.chars().count() < 8 {
        return Err("启动密码至少需要 8 个字符".to_string());
    }
    let directory = data_directory()?;
    let data_key = current_data_key(&state)?;
    let recovery_code = generate_recovery_code();
    let config = SecurityConfig {
        format_version: 1,
        startup_lock_enabled: true,
        automatic_key: None,
        password_wrap: Some(wrap_data_key(&password, &data_key)?),
        recovery_wrap: Some(wrap_data_key(&recovery_code, &data_key)?),
    };
    write_security_config(&directory, &config)?;
    Ok(EnableLockResult { recovery_code })
}

#[tauri::command]
fn change_startup_password(
    new_password: String,
    state: State<'_, SecurityState>,
) -> Result<(), String> {
    if new_password.chars().count() < 8 {
        return Err("启动密码至少需要 8 个字符".to_string());
    }
    let directory = data_directory()?;
    let data_key = current_data_key(&state)?;
    let mut config = read_security_config(&directory)?;
    if !config.startup_lock_enabled {
        return Err("请先启用启动密码".to_string());
    }
    config.password_wrap = Some(wrap_data_key(&new_password, &data_key)?);
    write_security_config(&directory, &config)?;
    state
        .runtime
        .lock()
        .map_err(|_| "安全状态暂时不可用".to_string())?
        .unlocked_via_recovery = false;
    Ok(())
}

#[tauri::command]
fn regenerate_recovery_code(state: State<'_, SecurityState>) -> Result<EnableLockResult, String> {
    let directory = data_directory()?;
    let data_key = current_data_key(&state)?;
    let config = read_security_config(&directory)?;
    let (next_config, recovery_code) = rotate_recovery_wrap(config, &data_key)?;
    write_security_config(&directory, &next_config)?;
    Ok(EnableLockResult { recovery_code })
}

#[tauri::command]
fn disable_startup_lock(state: State<'_, SecurityState>) -> Result<(), String> {
    let directory = data_directory()?;
    let data_key = current_data_key(&state)?;
    let config = SecurityConfig {
        format_version: 1,
        startup_lock_enabled: false,
        automatic_key: Some(BASE64.encode(data_key)),
        password_wrap: None,
        recovery_wrap: None,
    };
    write_security_config(&directory, &config)?;
    state
        .runtime
        .lock()
        .map_err(|_| "安全状态暂时不可用".to_string())?
        .unlocked_via_recovery = false;
    Ok(())
}

#[tauri::command]
fn lock_vault(state: State<'_, SecurityState>) -> Result<(), String> {
    let config = read_security_config(&data_directory()?)?;
    if !config.startup_lock_enabled {
        return Err("当前未启用启动密码".to_string());
    }
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "安全状态暂时不可用".to_string())?;
    if let Some(mut key) = runtime.data_key.take() {
        key.zeroize();
    }
    runtime.unlocked_via_recovery = false;
    Ok(())
}

#[tauri::command]
fn load_app_data(state: State<'_, SecurityState>) -> Result<Option<Value>, String> {
    let key = current_data_key(&state)?;
    let directory = data_directory()?;
    let connection = open_database(&directory)?;
    let payload = connection.query_row("SELECT payload FROM app_state WHERE id = 1", [], |row| {
        row.get::<_, String>(0)
    });

    match payload {
        Ok(payload) => {
            let (mut value, was_plaintext) = decode_database_payload(&payload, &key)?;
            if was_plaintext {
                write_encrypted_payload(&connection, &value, &key)?;
                connection
                    .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")
                    .map_err(error_string)?;
            }
            let encrypt_images = image_encryption_enabled(&value);
            hydrate_media(&mut value, &directory, &key, encrypt_images)?;
            Ok(Some(value))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error_string(error)),
    }
}

#[tauri::command]
fn save_app_data(data: Value, state: State<'_, SecurityState>) -> Result<SaveResult, String> {
    let _save_guard = state
        .save_gate
        .lock()
        .map_err(|_| "保存队列暂时不可用".to_string())?;
    let key = current_data_key(&state)?;
    let directory = data_directory()?;
    persist_app_data(data, &directory, &key)
}

fn persist_app_data(
    mut data: Value,
    directory: &Path,
    key: &[u8; DATA_KEY_BYTES],
) -> Result<SaveResult, String> {
    let connection = open_database(&directory)?;
    let encrypt_images = image_encryption_enabled(&data);
    let created_files = materialize_media(&mut data, directory, key, encrypt_images)?;
    let mut persisted_data = data.clone();
    strip_media_data_urls(&mut persisted_data);
    let updated_at = match write_encrypted_payload(&connection, &persisted_data, key) {
        Ok(updated_at) => updated_at,
        Err(error) => {
            remove_media_files(directory, &created_files);
            return Err(error);
        }
    };
    let warnings = cleanup_orphaned_media(&persisted_data, directory)
        .err()
        .map(|error| vec![format!("数据已保存，但旧图片清理失败：{error}")])
        .unwrap_or_default();
    Ok(SaveResult {
        data_dir: directory.to_string_lossy().to_string(),
        updated_at,
        data,
        warnings,
    })
}

#[tauri::command]
fn append_audit(event: AuditEvent) -> Result<(), String> {
    let directory = data_directory()?;
    let path = directory.join("audit.log");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(error_string)?;
    serde_json::to_writer(&mut file, &event).map_err(error_string)?;
    file.write_all(b"\n").map_err(error_string)?;
    file.flush().map_err(error_string)?;
    rotate_log_if_needed(&path)
}

#[tauri::command]
fn read_audit_logs() -> Result<Vec<AuditEvent>, String> {
    let path = data_directory()?.join("audit.log");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let reader = BufReader::new(File::open(path).map_err(error_string)?);
    let mut events = reader
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<AuditEvent>(&line).ok())
        .collect::<Vec<_>>();
    events.reverse();
    events.truncate(500);
    Ok(events)
}

#[tauri::command]
fn open_audit_log() -> Result<String, String> {
    let path = data_directory()?.join("audit.log");
    if !path.exists() {
        File::create(&path).map_err(error_string)?;
    }
    open::that(&path).map_err(error_string)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "网址格式无效".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("只允许打开 http 或 https 网址".to_string());
    }
    open::that(url).map_err(error_string)
}

#[tauri::command]
fn fetch_remote_image(url: String) -> Result<String, String> {
    let parsed = Url::parse(&url).map_err(|_| "图片网址无效".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("只允许加载 http 或 https 图片".to_string());
    }
    let response = reqwest::blocking::Client::builder()
        .user_agent("AccountNotebook/0.1")
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(error_string)?
        .get(parsed)
        .send()
        .map_err(error_string)?
        .error_for_status()
        .map_err(error_string)?;
    let mime = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or("application/octet-stream")
        .to_ascii_lowercase();
    if !allowed_image_mime(&mime) {
        return Err("仅支持 PNG、JPG、WebP、GIF、BMP 和 ICO 图片".to_string());
    }
    if response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|length| length > REMOTE_IMAGE_LIMIT_BYTES as u64)
    {
        return Err("图片超过 15 MB 限制".to_string());
    }
    let mut bytes = Vec::new();
    response
        .take((REMOTE_IMAGE_LIMIT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(error_string)?;
    if bytes.len() > REMOTE_IMAGE_LIMIT_BYTES {
        return Err("图片超过 15 MB 限制".to_string());
    }
    validate_image_signature(&mime, &bytes)?;
    Ok(format!("data:{mime};base64,{}", BASE64.encode(bytes)))
}

fn prepare_backup_security(
    config: &SecurityConfig,
    data_key: &[u8; DATA_KEY_BYTES],
    backup_credential: Option<String>,
    local_only: bool,
) -> Result<(SecurityConfig, Option<KeyWrap>), String> {
    let backup_credential_wrap = if local_only || config.startup_lock_enabled {
        None
    } else {
        let credential = backup_credential
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "未启用启动密码时，导出备份必须设置备份密码".to_string())?;
        if credential.chars().count() < 8 {
            return Err("备份密码至少需要 8 个字符".to_string());
        }
        Some(wrap_data_key(&credential, data_key)?)
    };
    let security = if local_only || backup_credential_wrap.is_some() {
        SecurityConfig {
            format_version: config.format_version,
            startup_lock_enabled: config.startup_lock_enabled,
            automatic_key: None,
            password_wrap: if local_only {
                None
            } else {
                config.password_wrap.clone()
            },
            recovery_wrap: if local_only {
                None
            } else {
                config.recovery_wrap.clone()
            },
        }
    } else {
        config.clone()
    };
    Ok((security, backup_credential_wrap))
}

fn write_backup_file(
    data: &Value,
    filename_prefix: &str,
    state: &State<'_, SecurityState>,
    backup_credential: Option<String>,
    local_only: bool,
) -> Result<String, String> {
    let key = current_data_key(&state)?;
    let directory = data_directory()?;
    let config = read_security_config(&directory)?;
    let (security, backup_credential_wrap) =
        prepare_backup_security(&config, &key, backup_credential, local_only)?;
    let document = BackupDocument {
        format: BACKUP_FORMAT.to_string(),
        created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        security,
        backup_credential_wrap,
        local_only,
        vault: encrypt_bytes(&key, &serde_json::to_vec(&data).map_err(error_string)?)?,
    };
    let filename = format!(
        "{}-{}.anb",
        filename_prefix,
        Local::now().format("%Y%m%d-%H%M%S-%3f")
    );
    let path = directory.join("backups").join(filename);
    fs::write(
        &path,
        serde_json::to_vec_pretty(&document).map_err(error_string)?,
    )
    .map_err(error_string)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn export_backup(
    data: Value,
    credential: Option<String>,
    state: State<'_, SecurityState>,
) -> Result<String, String> {
    write_backup_file(&data, "account-notebook", &state, credential, false)
}

#[tauri::command]
fn create_rollback_backup(data: Value, state: State<'_, SecurityState>) -> Result<String, String> {
    write_backup_file(&data, "rollback-before-import", &state, None, true)
}

fn write_export_bytes(directory: &Path, file_name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    if bytes.is_empty() || bytes.len() > OFFICE_EXPORT_LIMIT_BYTES {
        return Err("导出文件为空或超过 128 MB 限制".to_string());
    }
    let name_path = Path::new(file_name);
    if name_path.file_name().and_then(|value| value.to_str()) != Some(file_name)
        || name_path.components().count() != 1
    {
        return Err("导出文件名无效".to_string());
    }
    let extension = name_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != "xlsx" && extension != "docx" {
        return Err("仅允许写入 xlsx 或 docx 文件".to_string());
    }
    let export_directory = directory.join("exports");
    fs::create_dir_all(&export_directory).map_err(error_string)?;
    let path = export_directory.join(file_name);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "同名导出文件已存在，请稍后重试".to_string()
            } else {
                error_string(error)
            }
        })?;
    file.write_all(bytes).map_err(error_string)?;
    file.sync_all().map_err(error_string)?;
    Ok(path)
}

#[tauri::command]
fn write_export_file(file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    let path = write_export_bytes(&data_directory()?, &file_name, &bytes)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_storage_stats() -> Result<StorageStats, String> {
    let directory = data_directory()?;
    let (last_backup_at, backup_count) = backup_summary(&directory.join("backups"))?;
    Ok(StorageStats {
        last_backup_at,
        data_size_bytes: directory_size(&directory)?,
        image_size_bytes: directory_size(&directory.join("images"))?,
        backup_count,
    })
}

fn parse_backup(backup_text: &str) -> Result<BackupDocument, String> {
    let document: BackupDocument =
        serde_json::from_str(backup_text).map_err(|_| "备份文件格式无效".to_string())?;
    if document.format != BACKUP_FORMAT && document.format != LEGACY_BACKUP_FORMAT {
        return Err("不支持的备份文件版本".to_string());
    }
    Ok(document)
}

#[tauri::command]
fn inspect_backup(backup_text: String) -> Result<BackupInfo, String> {
    let document = parse_backup(&backup_text)?;
    Ok(BackupInfo {
        startup_lock_enabled: document.security.startup_lock_enabled,
        created_at: document.created_at,
        requires_credential: !document.local_only
            && (document.security.startup_lock_enabled
                || document.backup_credential_wrap.is_some()),
    })
}

#[tauri::command]
fn decrypt_backup(
    backup_text: String,
    credential: Option<String>,
    state: State<'_, SecurityState>,
) -> Result<Value, String> {
    let document = parse_backup(&backup_text)?;
    let key = if document.local_only {
        current_data_key(&state)?
    } else if document.security.startup_lock_enabled {
        let credential = credential
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "该备份受启动密码保护，请输入创建备份时使用的启动密码或恢复码".to_string()
            })?;
        document
            .security
            .password_wrap
            .as_ref()
            .and_then(|wrapped| unwrap_data_key(&credential, wrapped).ok())
            .or_else(|| {
                document
                    .security
                    .recovery_wrap
                    .as_ref()
                    .and_then(|wrapped| unwrap_data_key(&credential, wrapped).ok())
            })
            .ok_or_else(|| "备份密码或恢复码不正确".to_string())?
    } else if let Some(wrapped) = document.backup_credential_wrap.as_ref() {
        let credential = credential
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "该导出备份需要输入备份密码".to_string())?;
        unwrap_data_key(&credential, wrapped).map_err(|_| "备份密码不正确".to_string())?
    } else {
        document
            .security
            .automatic_key
            .as_deref()
            .ok_or_else(|| "备份缺少自动解锁密钥".to_string())
            .and_then(decode_data_key)?
    };
    let plaintext = decrypt_bytes(&key, &document.vault)?;
    serde_json::from_slice(&plaintext).map_err(|_| "备份数据内容损坏".to_string())
}

#[tauri::command]
fn reveal_data_directory() -> Result<String, String> {
    let directory = data_directory()?;
    open::that(&directory).map_err(error_string)?;
    Ok(directory.to_string_lossy().to_string())
}

fn image_encryption_enabled(data: &Value) -> bool {
    data.get("settings")
        .and_then(|settings| settings.get("encryptImages"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn materialize_media(
    data: &mut Value,
    directory: &Path,
    key: &[u8; DATA_KEY_BYTES],
    encrypt_images: bool,
) -> Result<Vec<PathBuf>, String> {
    let mut created_files = Vec::new();
    let result = (|| -> Result<(), String> {
        if let Some(services) = data.get_mut("services").and_then(Value::as_array_mut) {
            for service in services {
                materialize_service_media(
                    service,
                    directory,
                    key,
                    encrypt_images,
                    &mut created_files,
                )?;
            }
        }
        if let Some(accounts) = data.get_mut("accounts").and_then(Value::as_array_mut) {
            for account in accounts {
                materialize_account_media(
                    account,
                    directory,
                    key,
                    encrypt_images,
                    &mut created_files,
                )?;
            }
        }
        if let Some(items) = data.get_mut("recycleBin").and_then(Value::as_array_mut) {
            for item in items {
                match item.get("type").and_then(Value::as_str).unwrap_or("") {
                    "service" => {
                        if let Some(service) = item.get_mut("service") {
                            materialize_service_media(
                                service,
                                directory,
                                key,
                                encrypt_images,
                                &mut created_files,
                            )?;
                        }
                        if let Some(accounts) =
                            item.get_mut("accounts").and_then(Value::as_array_mut)
                        {
                            for account in accounts {
                                materialize_account_media(
                                    account,
                                    directory,
                                    key,
                                    encrypt_images,
                                    &mut created_files,
                                )?;
                            }
                        }
                    }
                    "account" => {
                        if let Some(account) = item.get_mut("account") {
                            materialize_account_media(
                                account,
                                directory,
                                key,
                                encrypt_images,
                                &mut created_files,
                            )?;
                        }
                    }
                    _ => {}
                }
            }
        }
        Ok(())
    })();
    if let Err(error) = result {
        remove_media_files(directory, &created_files);
        return Err(error);
    }
    Ok(created_files)
}

fn materialize_service_media(
    service: &mut Value,
    directory: &Path,
    key: &[u8; DATA_KEY_BYTES],
    encrypt_images: bool,
    created_files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    if let Some(icon) = service.get_mut("icon") {
        if let Some(path) = materialize_image(icon, directory, "icons", key, encrypt_images)? {
            created_files.push(path);
        }
    }
    Ok(())
}

fn materialize_account_media(
    account: &mut Value,
    directory: &Path,
    key: &[u8; DATA_KEY_BYTES],
    encrypt_images: bool,
    created_files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    if let Some(images) = account.get_mut("images").and_then(Value::as_array_mut) {
        for image in images {
            if let Some(path) = materialize_image(image, directory, "images", key, encrypt_images)?
            {
                created_files.push(path);
            }
        }
    }
    Ok(())
}

fn strip_media_data_urls(data: &mut Value) {
    if let Some(services) = data.get_mut("services").and_then(Value::as_array_mut) {
        for service in services {
            strip_service_media_data_urls(service);
        }
    }
    if let Some(accounts) = data.get_mut("accounts").and_then(Value::as_array_mut) {
        for account in accounts {
            strip_account_media_data_urls(account);
        }
    }
    if let Some(items) = data.get_mut("recycleBin").and_then(Value::as_array_mut) {
        for item in items {
            match item.get("type").and_then(Value::as_str).unwrap_or("") {
                "service" => {
                    if let Some(service) = item.get_mut("service") {
                        strip_service_media_data_urls(service);
                    }
                    if let Some(accounts) = item.get_mut("accounts").and_then(Value::as_array_mut) {
                        for account in accounts {
                            strip_account_media_data_urls(account);
                        }
                    }
                }
                "account" => {
                    if let Some(account) = item.get_mut("account") {
                        strip_account_media_data_urls(account);
                    }
                }
                _ => {}
            }
        }
    }
}

fn strip_service_media_data_urls(service: &mut Value) {
    if let Some(icon) = service.get_mut("icon").and_then(Value::as_object_mut) {
        icon.insert("dataUrl".to_string(), Value::String(String::new()));
    }
}

fn strip_account_media_data_urls(account: &mut Value) {
    if let Some(images) = account.get_mut("images").and_then(Value::as_array_mut) {
        for image in images {
            if let Some(object) = image.as_object_mut() {
                object.insert("dataUrl".to_string(), Value::String(String::new()));
            }
        }
    }
}

fn referenced_media_paths(data: &Value) -> HashSet<PathBuf> {
    let mut paths = HashSet::new();
    if let Some(services) = data.get("services").and_then(Value::as_array) {
        for service in services {
            collect_service_media_paths(service, &mut paths);
        }
    }
    if let Some(accounts) = data.get("accounts").and_then(Value::as_array) {
        for account in accounts {
            collect_account_media_paths(account, &mut paths);
        }
    }
    if let Some(items) = data.get("recycleBin").and_then(Value::as_array) {
        for item in items {
            match item.get("type").and_then(Value::as_str).unwrap_or("") {
                "service" => {
                    if let Some(service) = item.get("service") {
                        collect_service_media_paths(service, &mut paths);
                    }
                    if let Some(accounts) = item.get("accounts").and_then(Value::as_array) {
                        for account in accounts {
                            collect_account_media_paths(account, &mut paths);
                        }
                    }
                }
                "account" => {
                    if let Some(account) = item.get("account") {
                        collect_account_media_paths(account, &mut paths);
                    }
                }
                _ => {}
            }
        }
    }
    paths
}

fn collect_service_media_paths(service: &Value, paths: &mut HashSet<PathBuf>) {
    if let Some(path) = service
        .get("icon")
        .and_then(|icon| icon.get("storedPath"))
        .and_then(Value::as_str)
        .and_then(|value| safe_media_path(value, "icons"))
    {
        paths.insert(path);
    }
}

fn collect_account_media_paths(account: &Value, paths: &mut HashSet<PathBuf>) {
    if let Some(images) = account.get("images").and_then(Value::as_array) {
        for image in images {
            if let Some(path) = image
                .get("storedPath")
                .and_then(Value::as_str)
                .and_then(|value| safe_media_path(value, "images"))
            {
                paths.insert(path);
            }
        }
    }
}

fn remove_media_files(directory: &Path, paths: &[PathBuf]) {
    for path in paths {
        let _ = fs::remove_file(directory.join(path));
    }
}

fn cleanup_orphaned_media(data: &Value, directory: &Path) -> Result<(), String> {
    let referenced = referenced_media_paths(data);
    for subdirectory in ["images", "icons"] {
        let media_directory = directory.join(subdirectory);
        for entry in fs::read_dir(&media_directory).map_err(error_string)? {
            let entry = entry.map_err(error_string)?;
            let file_type = entry.file_type().map_err(error_string)?;
            if file_type.is_symlink() || !file_type.is_file() {
                continue;
            }
            let relative = PathBuf::from(subdirectory).join(entry.file_name());
            if !referenced.contains(&relative) {
                fs::remove_file(entry.path()).map_err(error_string)?;
            }
        }
    }
    Ok(())
}

fn materialize_image(
    image: &mut Value,
    directory: &Path,
    subdirectory: &str,
    key: &[u8; DATA_KEY_BYTES],
    encrypt_images: bool,
) -> Result<Option<PathBuf>, String> {
    if image.is_null() {
        return Ok(None);
    }
    let Some(object) = image.as_object_mut() else {
        return Ok(None);
    };
    let existing_relative = object
        .get("storedPath")
        .and_then(Value::as_str)
        .and_then(|value| safe_media_path(value, subdirectory));
    let data_url = object
        .get("dataUrl")
        .and_then(Value::as_str)
        .filter(|value| value.starts_with("data:"))
        .map(str::to_string);

    let relative = if let Some(data_url) = data_url {
        let (mime, bytes) = decode_data_url(&data_url)?;
        let id = object
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("image")
            .replace(
                |character: char| {
                    !character.is_ascii_alphanumeric() && character != '-' && character != '_'
                },
                "_",
            );
        let extension = extension_for_mime(&mime);
        let matching_existing = existing_relative
            .filter(|path| path.extension().and_then(|value| value.to_str()) == Some(extension));
        let (path, created) = match matching_existing {
            Some(path) if directory.join(&path).exists() => {
                let absolute = directory.join(&path);
                let (stored_bytes, was_encrypted) = read_media_plaintext(&absolute, key, &mime)?;
                if stored_bytes == bytes && was_encrypted == encrypt_images {
                    (path, false)
                } else {
                    let path = unique_media_path(directory, subdirectory, &id, extension);
                    let payload = encode_media_payload(key, &bytes, encrypt_images)?;
                    write_new_file_atomically(&directory.join(&path), &payload)?;
                    (path, true)
                }
            }
            _ => {
                let path = unique_media_path(directory, subdirectory, &id, extension);
                let payload = encode_media_payload(key, &bytes, encrypt_images)?;
                write_new_file_atomically(&directory.join(&path), &payload)?;
                (path, true)
            }
        };
        (path, created)
    } else if let Some(path) = existing_relative.filter(|path| directory.join(path).exists()) {
        let absolute = directory.join(&path);
        let mime = mime_for_path(&absolute);
        let (bytes, was_encrypted) = read_media_plaintext(&absolute, key, mime)?;
        if was_encrypted != encrypt_images {
            let id = object
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("image")
                .replace(
                    |character: char| {
                        !character.is_ascii_alphanumeric() && character != '-' && character != '_'
                    },
                    "_",
                );
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("png");
            let next_path = unique_media_path(directory, subdirectory, &id, extension);
            let payload = encode_media_payload(key, &bytes, encrypt_images)?;
            write_new_file_atomically(&directory.join(&next_path), &payload)?;
            (next_path, true)
        } else {
            (path, false)
        }
    } else {
        return Ok(None);
    };

    if let Some(object) = image.as_object_mut() {
        object.insert(
            "storedPath".to_string(),
            Value::String(relative.0.to_string_lossy().replace('\\', "/")),
        );
    }
    Ok(relative.1.then_some(relative.0))
}

fn hydrate_media(
    data: &mut Value,
    directory: &Path,
    key: &[u8; DATA_KEY_BYTES],
    encrypt_images: bool,
) -> Result<(), String> {
    if let Some(services) = data.get_mut("services").and_then(Value::as_array_mut) {
        for service in services {
            hydrate_service_media(service, directory, key, encrypt_images)?;
        }
    }
    if let Some(accounts) = data.get_mut("accounts").and_then(Value::as_array_mut) {
        for account in accounts {
            hydrate_account_media(account, directory, key, encrypt_images)?;
        }
    }
    if let Some(items) = data.get_mut("recycleBin").and_then(Value::as_array_mut) {
        for item in items {
            match item.get("type").and_then(Value::as_str).unwrap_or("") {
                "service" => {
                    if let Some(service) = item.get_mut("service") {
                        hydrate_service_media(service, directory, key, encrypt_images)?;
                    }
                    if let Some(accounts) = item.get_mut("accounts").and_then(Value::as_array_mut) {
                        for account in accounts {
                            hydrate_account_media(account, directory, key, encrypt_images)?;
                        }
                    }
                }
                "account" => {
                    if let Some(account) = item.get_mut("account") {
                        hydrate_account_media(account, directory, key, encrypt_images)?;
                    }
                }
                _ => {}
            }
        }
    }
    Ok(())
}

fn hydrate_service_media(
    service: &mut Value,
    directory: &Path,
    key: &[u8; DATA_KEY_BYTES],
    encrypt_images: bool,
) -> Result<(), String> {
    if let Some(icon) = service.get_mut("icon") {
        hydrate_image(icon, directory, "icons", key, encrypt_images)?;
    }
    Ok(())
}

fn hydrate_account_media(
    account: &mut Value,
    directory: &Path,
    key: &[u8; DATA_KEY_BYTES],
    encrypt_images: bool,
) -> Result<(), String> {
    if let Some(images) = account.get_mut("images").and_then(Value::as_array_mut) {
        for image in images {
            hydrate_image(image, directory, "images", key, encrypt_images)?;
        }
    }
    Ok(())
}

fn hydrate_image(
    image: &mut Value,
    directory: &Path,
    subdirectory: &str,
    key: &[u8; DATA_KEY_BYTES],
    encrypt_images: bool,
) -> Result<(), String> {
    let Some(object) = image.as_object_mut() else {
        return Ok(());
    };
    let Some(relative) = object.get("storedPath").and_then(Value::as_str) else {
        return Ok(());
    };
    let relative =
        safe_media_path(relative, subdirectory).ok_or_else(|| "图片存储路径无效".to_string())?;
    let path = directory.join(relative);
    if !path.exists() {
        return Ok(());
    }
    let mime = mime_for_path(&path);
    if !allowed_image_mime(mime) {
        return Err("存储图片格式不受支持".to_string());
    }
    let (bytes, was_encrypted) = read_media_plaintext(&path, key, mime)?;
    if was_encrypted != encrypt_images {
        let payload = encode_media_payload(key, &bytes, encrypt_images)?;
        replace_file_atomically(&path, &payload)?;
    }
    object.insert(
        "dataUrl".to_string(),
        Value::String(format!("data:{mime};base64,{}", BASE64.encode(bytes))),
    );
    Ok(())
}

fn encrypt_media_bytes(key: &[u8; DATA_KEY_BYTES], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(error_string)?;
    let mut nonce = [0u8; NONCE_BYTES];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| "图片加密失败".to_string())?;
    let mut payload =
        Vec::with_capacity(IMAGE_ENCRYPTED_MAGIC.len() + nonce.len() + ciphertext.len());
    payload.extend_from_slice(IMAGE_ENCRYPTED_MAGIC);
    payload.extend_from_slice(&nonce);
    payload.extend_from_slice(&ciphertext);
    Ok(payload)
}

fn decrypt_media_bytes(key: &[u8; DATA_KEY_BYTES], payload: &[u8]) -> Result<Vec<u8>, String> {
    let header_bytes = IMAGE_ENCRYPTED_MAGIC.len() + NONCE_BYTES;
    if payload.len() < header_bytes + 16 || !payload.starts_with(IMAGE_ENCRYPTED_MAGIC) {
        return Err("图片加密容器损坏".to_string());
    }
    let nonce = &payload[IMAGE_ENCRYPTED_MAGIC.len()..header_bytes];
    let cipher = Aes256Gcm::new_from_slice(key).map_err(error_string)?;
    cipher
        .decrypt(Nonce::from_slice(nonce), &payload[header_bytes..])
        .map_err(|_| "图片密文损坏或数据密钥不匹配".to_string())
}

fn encode_media_payload(
    key: &[u8; DATA_KEY_BYTES],
    plaintext: &[u8],
    encrypt_images: bool,
) -> Result<Vec<u8>, String> {
    if encrypt_images {
        encrypt_media_bytes(key, plaintext)
    } else {
        Ok(plaintext.to_vec())
    }
}

fn read_media_plaintext(
    path: &Path,
    key: &[u8; DATA_KEY_BYTES],
    mime: &str,
) -> Result<(Vec<u8>, bool), String> {
    let stored = fs::read(path).map_err(error_string)?;
    let encrypted = stored.starts_with(IMAGE_ENCRYPTED_MAGIC);
    let plaintext = if encrypted {
        decrypt_media_bytes(key, &stored)?
    } else {
        stored
    };
    validate_image_signature(mime, &plaintext)?;
    Ok((plaintext, encrypted))
}

fn temporary_sibling_path(target: &Path, marker: &str) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "无法确定图片存储目录".to_string())?;
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "图片文件名无效".to_string())?;
    loop {
        let mut suffix = [0u8; 8];
        OsRng.fill_bytes(&mut suffix);
        let suffix = suffix
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let candidate = parent.join(format!(".{name}.{marker}-{suffix}.tmp"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
}

fn write_temporary_file(target: &Path, payload: &[u8]) -> Result<PathBuf, String> {
    let temporary = temporary_sibling_path(target, "new")?;
    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(error_string)?;
        file.write_all(payload).map_err(error_string)?;
        file.sync_all().map_err(error_string)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map(|_| temporary)
}

fn write_new_file_atomically(target: &Path, payload: &[u8]) -> Result<(), String> {
    let temporary = write_temporary_file(target, payload)?;
    let result = fs::rename(&temporary, target).map_err(error_string);
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(windows)]
fn replace_file_atomically(target: &Path, payload: &[u8]) -> Result<(), String> {
    use std::{os::windows::ffi::OsStrExt, ptr};

    #[link(name = "Kernel32")]
    extern "system" {
        fn ReplaceFileW(
            replaced_file_name: *const u16,
            replacement_file_name: *const u16,
            backup_file_name: *const u16,
            replace_flags: u32,
            exclude: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void,
        ) -> i32;
    }

    let temporary = write_temporary_file(target, payload)?;
    let target_wide = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let temporary_wide = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        ReplaceFileW(
            target_wide.as_ptr(),
            temporary_wide.as_ptr(),
            ptr::null(),
            0,
            ptr::null_mut(),
            ptr::null_mut(),
        )
    };
    if replaced == 0 {
        let error = std::io::Error::last_os_error();
        let _ = fs::remove_file(&temporary);
        return Err(format!("文件原子替换失败，原文件保持不变：{error}"));
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file_atomically(target: &Path, payload: &[u8]) -> Result<(), String> {
    let temporary = write_temporary_file(target, payload)?;
    let result = fs::rename(&temporary, target).map_err(error_string);
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn safe_media_path(value: &str, subdirectory: &str) -> Option<PathBuf> {
    let path = PathBuf::from(value);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
        || !path.starts_with(Path::new(subdirectory))
    {
        return None;
    }
    Some(path)
}

fn unique_media_path(directory: &Path, subdirectory: &str, id: &str, extension: &str) -> PathBuf {
    loop {
        let mut suffix = [0u8; 8];
        OsRng.fill_bytes(&mut suffix);
        let suffix = suffix
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let relative = PathBuf::from(subdirectory).join(format!("{id}-{suffix}.{extension}"));
        if !directory.join(&relative).exists() {
            return relative;
        }
    }
}

fn decode_data_url(data_url: &str) -> Result<(String, Vec<u8>), String> {
    let (metadata, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "图片数据格式无效".to_string())?;
    if !metadata.ends_with(";base64") {
        return Err("只支持 base64 图片数据".to_string());
    }
    let mime = metadata
        .strip_prefix("data:")
        .and_then(|value| value.strip_suffix(";base64"))
        .unwrap_or("application/octet-stream")
        .to_ascii_lowercase();
    if !allowed_image_mime(&mime) {
        return Err("仅支持 PNG、JPG、WebP、GIF、BMP 和 ICO 图片".to_string());
    }
    let bytes = BASE64.decode(encoded).map_err(error_string)?;
    if bytes.len() > REMOTE_IMAGE_LIMIT_BYTES {
        return Err("图片超过 15 MB 限制".to_string());
    }
    validate_image_signature(&mime, &bytes)?;
    Ok((mime, bytes))
}

fn validate_image_signature(mime: &str, bytes: &[u8]) -> Result<(), String> {
    let valid = match mime {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/webp" => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/bmp" => bytes.starts_with(b"BM"),
        "image/x-icon" | "image/vnd.microsoft.icon" => bytes.starts_with(&[0, 0, 1, 0]),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err("图片内容损坏、格式不匹配或加密标记无效".to_string())
    }
}

fn allowed_image_mime(mime: &str) -> bool {
    matches!(
        mime,
        "image/png"
            | "image/jpeg"
            | "image/webp"
            | "image/gif"
            | "image/bmp"
            | "image/x-icon"
            | "image/vnd.microsoft.icon"
    )
}

fn extension_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico",
        _ => "png",
    }
}

fn mime_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "image/png",
    }
}

fn rotate_log_if_needed(path: &Path) -> Result<(), String> {
    if fs::metadata(path).map_err(error_string)?.len() <= LOG_LIMIT_BYTES {
        return Ok(());
    }
    let content = fs::read_to_string(path).map_err(error_string)?;
    let mut kept = Vec::new();
    let mut kept_bytes = 0usize;
    for line in content.lines().rev() {
        let line_bytes = line.len() + 1;
        if kept_bytes + line_bytes > LOG_TRIM_TARGET_BYTES {
            break;
        }
        kept.push(line);
        kept_bytes += line_bytes;
    }
    kept.reverse();
    replace_file_atomically(path, format!("{}\n", kept.join("\n")).as_bytes())
}

fn error_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory(label: &str) -> PathBuf {
        let mut suffix = [0u8; 8];
        OsRng.fill_bytes(&mut suffix);
        std::env::temp_dir().join(format!(
            "account-notebook-{label}-{}",
            suffix
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        ))
    }

    #[test]
    fn large_text_vault_persists_and_round_trips() {
        let test_directory = test_directory("large-vault-test");
        fs::create_dir_all(test_directory.join("images")).unwrap();
        fs::create_dir_all(test_directory.join("icons")).unwrap();
        let key = random_data_key();
        let services = (0..2_000)
            .map(|index| {
                serde_json::json!({
                    "id": format!("service-{index}"),
                    "name": format!("Service {index}"),
                    "url": format!("https://example.com/{index}"),
                    "categoryId": null,
                    "tagIds": [],
                    "icon": null,
                    "sortOrder": index
                })
            })
            .collect::<Vec<_>>();
        let accounts = (0..6_000)
            .map(|index| {
                serde_json::json!({
                    "id": format!("account-{index}"),
                    "serviceId": format!("service-{}", index / 3),
                    "label": format!("Account {index}"),
                    "username": format!("user-{index}@example.com"),
                    "password": format!("Password-{index}!"),
                    "identityCode": format!("Identity-{index}"),
                    "notes": [{
                        "id": format!("note-{index}"),
                        "title": "Note",
                        "content": format!("Long local note {index}")
                    }],
                    "customFields": [{
                        "id": format!("field-{index}"),
                        "label": "License",
                        "value": format!("Value-{index}"),
                        "multiline": false,
                        "copyable": true
                    }],
                    "securityQuestions": [],
                    "images": [],
                    "passwordHistory": [],
                    "sortOrder": index % 3
                })
            })
            .collect::<Vec<_>>();
        let data = serde_json::json!({
            "version": 5,
            "settings": { "encryptImages": false },
            "services": services,
            "accounts": accounts
        });

        let result = persist_app_data(data, &test_directory, &key).unwrap();
        assert!(result.warnings.is_empty());
        let connection = open_database(&test_directory).unwrap();
        let payload = connection
            .query_row("SELECT payload FROM app_state WHERE id = 1", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap();
        let (stored, was_plaintext) = decode_database_payload(&payload, &key).unwrap();
        assert!(!was_plaintext);
        assert_eq!(stored["services"].as_array().unwrap().len(), 2_000);
        assert_eq!(stored["accounts"].as_array().unwrap().len(), 6_000);
        assert_eq!(
            stored["accounts"][5_999]["notes"][0]["content"],
            "Long local note 5999"
        );
        assert!(!payload.contains("Password-5999!"));
        drop(connection);
        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn oversized_audit_log_keeps_the_latest_complete_lines() {
        let test_directory = test_directory("audit-rotation-test");
        fs::create_dir_all(&test_directory).unwrap();
        let path = test_directory.join("audit.log");
        let padding = "x".repeat(4_096);
        let mut content = String::new();
        for index in 0..2_600 {
            content.push_str(&format!("event-{index:04}-{padding}\n"));
        }
        fs::write(&path, content).unwrap();
        assert!(fs::metadata(&path).unwrap().len() > LOG_LIMIT_BYTES);

        rotate_log_if_needed(&path).unwrap();

        let rotated = fs::read_to_string(&path).unwrap();
        assert!(fs::metadata(&path).unwrap().len() <= LOG_TRIM_TARGET_BYTES as u64);
        assert!(!rotated.contains("event-0000-"));
        assert!(rotated.contains("event-2599-"));
        assert!(rotated.ends_with('\n'));
        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn encrypted_envelope_round_trips_and_rejects_wrong_key() {
        let key = random_data_key();
        let wrong_key = random_data_key();
        let envelope = encrypt_bytes(&key, b"secret-value").unwrap();
        assert_eq!(decrypt_bytes(&key, &envelope).unwrap(), b"secret-value");
        assert!(decrypt_bytes(&wrong_key, &envelope).is_err());
        assert!(!envelope.ciphertext.contains("secret-value"));
    }

    #[test]
    fn wrapped_key_requires_the_correct_secret() {
        let key = random_data_key();
        let wrapped = wrap_data_key("correct horse battery staple", &key).unwrap();
        assert_eq!(
            unwrap_data_key("correct horse battery staple", &wrapped).unwrap(),
            key
        );
        assert!(unwrap_data_key("wrong password", &wrapped).is_err());
    }

    #[test]
    fn portable_backup_without_startup_lock_uses_a_separate_credential_wrap() {
        let key = random_data_key();
        let config = SecurityConfig {
            format_version: 1,
            startup_lock_enabled: false,
            automatic_key: Some(BASE64.encode(key)),
            password_wrap: None,
            recovery_wrap: None,
        };

        let (security, backup_wrap) =
            prepare_backup_security(&config, &key, Some("portable-backup".to_string()), false)
                .unwrap();

        assert!(security.automatic_key.is_none());
        assert!(backup_wrap.is_some());
        assert_eq!(
            unwrap_data_key("portable-backup", backup_wrap.as_ref().unwrap()).unwrap(),
            key
        );
        assert!(unwrap_data_key("wrong-password", backup_wrap.as_ref().unwrap()).is_err());
    }

    #[test]
    fn local_rollback_backup_does_not_embed_any_unlock_secret() {
        let key = random_data_key();
        let config = SecurityConfig {
            format_version: 1,
            startup_lock_enabled: false,
            automatic_key: Some(BASE64.encode(key)),
            password_wrap: None,
            recovery_wrap: None,
        };

        let (security, backup_wrap) = prepare_backup_security(&config, &key, None, true).unwrap();

        assert!(security.automatic_key.is_none());
        assert!(security.password_wrap.is_none());
        assert!(security.recovery_wrap.is_none());
        assert!(backup_wrap.is_none());
    }

    #[test]
    fn portable_backup_requires_a_password_when_startup_lock_is_disabled() {
        let key = random_data_key();
        let config = SecurityConfig {
            format_version: 1,
            startup_lock_enabled: false,
            automatic_key: Some(BASE64.encode(key)),
            password_wrap: None,
            recovery_wrap: None,
        };

        assert!(prepare_backup_security(&config, &key, None, false).is_err());
        assert!(prepare_backup_security(&config, &key, Some("short".to_string()), false).is_err());
    }

    #[test]
    fn recovery_code_has_all_required_character_classes() {
        let code = generate_recovery_code();
        assert_eq!(code.len(), RECOVERY_CODE_LENGTH);
        assert!(code.chars().any(|character| character.is_ascii_uppercase()));
        assert!(code.chars().any(|character| character.is_ascii_lowercase()));
        assert!(code.chars().any(|character| character.is_ascii_digit()));
        assert!(code
            .chars()
            .any(|character| !character.is_ascii_alphanumeric()));
    }

    #[test]
    fn rotating_recovery_code_invalidates_the_previous_code() {
        let key = random_data_key();
        let old_recovery_code = "OldRecovery1!Aa2";
        let config = SecurityConfig {
            format_version: 1,
            startup_lock_enabled: true,
            automatic_key: None,
            password_wrap: Some(wrap_data_key("desktop-password", &key).unwrap()),
            recovery_wrap: Some(wrap_data_key(old_recovery_code, &key).unwrap()),
        };

        let (rotated, new_recovery_code) = rotate_recovery_wrap(config, &key).unwrap();
        let recovery_wrap = rotated.recovery_wrap.as_ref().unwrap();

        assert_ne!(new_recovery_code, old_recovery_code);
        assert_eq!(
            unwrap_data_key(&new_recovery_code, recovery_wrap).unwrap(),
            key
        );
        assert!(unwrap_data_key(old_recovery_code, recovery_wrap).is_err());
        assert_eq!(
            unwrap_data_key("desktop-password", rotated.password_wrap.as_ref().unwrap()).unwrap(),
            key
        );
    }

    #[test]
    fn security_config_updates_replace_the_previous_file() {
        let mut suffix = [0u8; 8];
        OsRng.fill_bytes(&mut suffix);
        let test_directory = std::env::temp_dir().join(format!(
            "account-notebook-security-test-{}",
            suffix
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        ));
        fs::create_dir_all(&test_directory).unwrap();
        let key = random_data_key();
        let initial = SecurityConfig {
            format_version: 1,
            startup_lock_enabled: false,
            automatic_key: Some(BASE64.encode(key)),
            password_wrap: None,
            recovery_wrap: None,
        };
        write_security_config(&test_directory, &initial).unwrap();
        let updated = SecurityConfig {
            format_version: 1,
            startup_lock_enabled: true,
            automatic_key: None,
            password_wrap: Some(wrap_data_key("desktop-password", &key).unwrap()),
            recovery_wrap: Some(wrap_data_key("NewRecovery1!Aa2", &key).unwrap()),
        };
        write_security_config(&test_directory, &updated).unwrap();

        let stored = read_security_config(&test_directory).unwrap();
        assert!(stored.startup_lock_enabled);
        assert!(stored.automatic_key.is_none());
        assert!(stored.password_wrap.is_some());
        assert!(stored.recovery_wrap.is_some());

        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn storage_summary_counts_backup_files_and_image_bytes() {
        let mut suffix = [0u8; 8];
        OsRng.fill_bytes(&mut suffix);
        let test_directory = std::env::temp_dir().join(format!(
            "account-notebook-storage-test-{}",
            suffix
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        ));
        fs::create_dir_all(test_directory.join("images")).unwrap();
        fs::create_dir_all(test_directory.join("backups")).unwrap();
        fs::write(test_directory.join("account-notebook.sqlite3"), b"database").unwrap();
        fs::write(
            test_directory.join("images").join("code.png"),
            b"image-bytes",
        )
        .unwrap();
        fs::write(test_directory.join("backups").join("backup.anb"), b"backup").unwrap();
        fs::write(test_directory.join("backups").join("readme.txt"), b"note").unwrap();

        let (last_backup_at, backup_count) =
            backup_summary(&test_directory.join("backups")).unwrap();
        assert_eq!(backup_count, 1);
        assert!(last_backup_at.is_some());
        assert_eq!(
            directory_size(&test_directory.join("images")).unwrap(),
            b"image-bytes".len() as u64
        );
        assert!(directory_size(&test_directory).unwrap() >= 25);

        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn encrypted_backup_can_be_opened_by_password_or_recovery_code() {
        let key = random_data_key();
        let recovery_code = generate_recovery_code();
        let password_wrap = wrap_data_key("desktop-password", &key).unwrap();
        let recovery_wrap = wrap_data_key(&recovery_code, &key).unwrap();
        let vault = encrypt_bytes(&key, br#"{"version":2,"accounts":[]}"#).unwrap();

        for unlocked_key in [
            unwrap_data_key("desktop-password", &password_wrap).unwrap(),
            unwrap_data_key(&recovery_code, &recovery_wrap).unwrap(),
        ] {
            assert_eq!(
                decrypt_bytes(&unlocked_key, &vault).unwrap(),
                br#"{"version":2,"accounts":[]}"#
            );
        }
        assert!(unwrap_data_key("not-the-password", &password_wrap).is_err());
    }

    #[test]
    fn media_paths_cannot_escape_their_owned_directory() {
        assert_eq!(
            safe_media_path("images/code.png", "images"),
            Some(PathBuf::from("images/code.png"))
        );
        assert!(safe_media_path("../outside.png", "images").is_none());
        assert!(safe_media_path("icons/code.png", "images").is_none());
    }

    #[test]
    fn local_sync_identity_is_stable_and_contains_no_vault_secret() {
        let test_directory = test_directory("sync-identity-test");
        fs::create_dir_all(&test_directory).unwrap();

        let first = read_or_initialize_sync_local_state(&test_directory).unwrap();
        let second = read_or_initialize_sync_local_state(&test_directory).unwrap();
        let stored = fs::read_to_string(sync_local_state_path(&test_directory)).unwrap();

        assert_eq!(first, second);
        assert!(first.device_id.starts_with("device-"));
        assert_eq!(first.device_id.len(), 39);
        assert_eq!(first.last_synced_vault_id, None);
        assert_eq!(first.last_synced_snapshot_id, None);
        assert!(!stored.contains("automaticKey"));
        assert!(!stored.contains("password"));
        assert!(!stored.contains("recovery"));
        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn sync_success_cursor_is_persisted_and_rejects_revision_rollback() {
        let test_directory = test_directory("sync-cursor-test");
        fs::create_dir_all(&test_directory).unwrap();

        let saved =
            record_sync_success_in_directory(&test_directory, "vault-main", "snapshot-7", 7)
                .unwrap();
        let reloaded = read_or_initialize_sync_local_state(&test_directory).unwrap();

        assert_eq!(saved, reloaded);
        assert_eq!(reloaded.last_synced_vault_id.as_deref(), Some("vault-main"));
        assert_eq!(
            reloaded.last_synced_snapshot_id.as_deref(),
            Some("snapshot-7")
        );
        assert_eq!(reloaded.last_synced_vault_revision, 7);
        assert!(
            record_sync_success_in_directory(&test_directory, "vault-main", "snapshot-6", 6,)
                .is_err()
        );
        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn encrypted_media_round_trips_and_rejects_wrong_or_tampered_data() {
        let key = random_data_key();
        let wrong_key = random_data_key();
        let plaintext = b"\x89PNG\r\n\x1a\nprivate-image";
        let encrypted = encrypt_media_bytes(&key, plaintext).unwrap();

        assert!(encrypted.starts_with(IMAGE_ENCRYPTED_MAGIC));
        assert!(!encrypted
            .windows(plaintext.len())
            .any(|value| value == plaintext));
        assert_eq!(decrypt_media_bytes(&key, &encrypted).unwrap(), plaintext);
        assert!(decrypt_media_bytes(&wrong_key, &encrypted).is_err());

        let mut tampered = encrypted;
        *tampered.last_mut().unwrap() ^= 0x01;
        assert!(decrypt_media_bytes(&key, &tampered).is_err());
    }

    #[test]
    fn encryption_toggle_preserves_paths_and_supported_image_bytes() {
        let test_directory = test_directory("media-formats-test");
        fs::create_dir_all(test_directory.join("images")).unwrap();
        let key = random_data_key();
        let formats: [(&str, &str, &[u8]); 6] = [
            ("sample.png", "image/png", b"\x89PNG\r\n\x1a\ncontent"),
            ("sample.jpg", "image/jpeg", b"\xff\xd8\xff\xe0content"),
            (
                "sample.webp",
                "image/webp",
                b"RIFF\x07\x00\x00\x00WEBPcontent",
            ),
            ("sample.gif", "image/gif", b"GIF89acontent"),
            ("sample.bmp", "image/bmp", b"BMcontent"),
            ("sample.ico", "image/x-icon", b"\x00\x00\x01\x00content"),
        ];

        for (index, (name, mime, bytes)) in formats.iter().enumerate() {
            let relative = PathBuf::from("images").join(name);
            let absolute = test_directory.join(&relative);
            fs::write(&absolute, bytes).unwrap();
            let mut image = serde_json::json!({
                "id": format!("image-{index}"),
                "name": name,
                "dataUrl": "",
                "storedPath": relative.to_string_lossy().replace('\\', "/")
            });

            hydrate_image(&mut image, &test_directory, "images", &key, true).unwrap();
            assert!(fs::read(&absolute)
                .unwrap()
                .starts_with(IMAGE_ENCRYPTED_MAGIC));
            assert_eq!(
                decode_data_url(image["dataUrl"].as_str().unwrap()).unwrap(),
                ((*mime).to_string(), bytes.to_vec())
            );

            hydrate_image(&mut image, &test_directory, "images", &key, false).unwrap();
            assert_eq!(fs::read(&absolute).unwrap(), *bytes);
            assert_eq!(
                image["storedPath"].as_str().unwrap(),
                relative.to_string_lossy().replace('\\', "/")
            );
        }

        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn unchanged_media_reuses_its_existing_file() {
        let test_directory = test_directory("media-reuse-test");
        fs::create_dir_all(test_directory.join("images")).unwrap();
        let key = random_data_key();
        let bytes = b"\x89PNG\r\n\x1a\nsame";
        let relative = PathBuf::from("images/shared.png");
        fs::write(test_directory.join(&relative), bytes).unwrap();
        let mut image = serde_json::json!({
            "id": "shared",
            "name": "shared.png",
            "dataUrl": format!("data:image/png;base64,{}", BASE64.encode(bytes)),
            "storedPath": "images/shared.png"
        });

        materialize_image(&mut image, &test_directory, "images", &key, false).unwrap();
        assert_eq!(image["storedPath"].as_str().unwrap(), "images/shared.png");
        assert_eq!(
            fs::read_dir(test_directory.join("images")).unwrap().count(),
            1
        );
        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn newly_materialized_media_reuses_the_returned_path_on_later_saves() {
        let test_directory = test_directory("media-returned-path-test");
        fs::create_dir_all(test_directory.join("images")).unwrap();
        let key = random_data_key();
        let bytes = b"\x89PNG\r\n\x1a\nnew";
        let mut image = serde_json::json!({
            "id": "new-image",
            "name": "new.png",
            "dataUrl": format!("data:image/png;base64,{}", BASE64.encode(bytes))
        });

        let first = materialize_image(&mut image, &test_directory, "images", &key, false).unwrap();
        assert!(first.is_some());
        assert!(image["storedPath"].as_str().is_some());
        assert!(!image["dataUrl"].as_str().unwrap().is_empty());

        let second = materialize_image(&mut image, &test_directory, "images", &key, false).unwrap();
        assert!(second.is_none());
        assert_eq!(
            fs::read_dir(test_directory.join("images")).unwrap().count(),
            1
        );
        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn failed_media_batch_removes_files_created_before_the_failure() {
        let test_directory = test_directory("media-batch-rollback-test");
        fs::create_dir_all(test_directory.join("images")).unwrap();
        fs::create_dir_all(test_directory.join("icons")).unwrap();
        let key = random_data_key();
        let mut data = serde_json::json!({
            "services": [],
            "accounts": [{
                "images": [
                    {
                        "id": "valid",
                        "name": "valid.png",
                        "dataUrl": format!("data:image/png;base64,{}", BASE64.encode(b"\x89PNG\r\n\x1a\nvalid"))
                    },
                    {
                        "id": "invalid",
                        "name": "invalid.png",
                        "dataUrl": "data:image/png;base64,bm90LWEtcG5n"
                    }
                ]
            }]
        });

        assert!(materialize_media(&mut data, &test_directory, &key, false).is_err());
        assert_eq!(
            fs::read_dir(test_directory.join("images")).unwrap().count(),
            0
        );
        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn database_write_failure_preserves_previous_payload_and_removes_new_media() {
        let test_directory = test_directory("database-write-rollback-test");
        fs::create_dir_all(test_directory.join("images")).unwrap();
        fs::create_dir_all(test_directory.join("icons")).unwrap();
        let key = random_data_key();
        let original = serde_json::json!({
            "settings": { "encryptImages": false },
            "services": [],
            "accounts": [],
            "marker": "original"
        });
        persist_app_data(original.clone(), &test_directory, &key).unwrap();

        let connection = open_database(&test_directory).unwrap();
        connection
            .execute_batch(
                "CREATE TRIGGER fail_app_state_update
                 BEFORE UPDATE OF payload ON app_state
                 BEGIN
                   SELECT RAISE(FAIL, 'forced database write failure');
                 END;",
            )
            .unwrap();
        drop(connection);

        let changed = serde_json::json!({
            "settings": { "encryptImages": false },
            "services": [],
            "accounts": [{
                "images": [{
                    "id": "new-image",
                    "name": "new.png",
                    "dataUrl": format!("data:image/png;base64,{}", BASE64.encode(b"\x89PNG\r\n\x1a\nnew"))
                }]
            }],
            "marker": "changed"
        });

        assert!(persist_app_data(changed, &test_directory, &key).is_err());
        assert_eq!(
            fs::read_dir(test_directory.join("images")).unwrap().count(),
            0
        );

        let connection = open_database(&test_directory).unwrap();
        let payload = connection
            .query_row("SELECT payload FROM app_state WHERE id = 1", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap();
        let (stored, was_plaintext) = decode_database_payload(&payload, &key).unwrap();
        assert!(!was_plaintext);
        assert_eq!(stored["marker"], "original");
        drop(connection);
        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn orphan_cleanup_keeps_only_referenced_media() {
        let test_directory = test_directory("media-cleanup-test");
        fs::create_dir_all(test_directory.join("images")).unwrap();
        fs::create_dir_all(test_directory.join("icons")).unwrap();
        fs::write(test_directory.join("images/kept.png"), b"kept").unwrap();
        fs::write(test_directory.join("images/orphan.png"), b"orphan").unwrap();
        fs::write(test_directory.join("icons/orphan.ico"), b"orphan").unwrap();
        let data = serde_json::json!({
            "services": [],
            "accounts": [{ "images": [{ "storedPath": "images/kept.png" }] }]
        });

        cleanup_orphaned_media(&data, &test_directory).unwrap();
        assert!(test_directory.join("images/kept.png").exists());
        assert!(!test_directory.join("images/orphan.png").exists());
        assert!(!test_directory.join("icons/orphan.ico").exists());
        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn recycle_bin_media_survives_save_and_is_removed_after_permanent_delete() {
        let test_directory = test_directory("recycle-media-test");
        fs::create_dir_all(test_directory.join("images")).unwrap();
        fs::create_dir_all(test_directory.join("icons")).unwrap();
        let key = random_data_key();
        let png = |id: &str| {
            let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
            bytes.extend_from_slice(id.as_bytes());
            serde_json::json!({
                "id": id,
                "name": format!("{id}.png"),
                "dataUrl": format!("data:image/png;base64,{}", BASE64.encode(bytes))
            })
        };
        let data = serde_json::json!({
            "settings": { "encryptImages": true },
            "services": [],
            "accounts": [],
            "recycleBin": [
                {
                    "id": "trash-service",
                    "type": "service",
                    "service": { "icon": png("trash-icon") },
                    "accounts": [{ "images": [png("trash-service-image")] }]
                },
                {
                    "id": "trash-account",
                    "type": "account",
                    "account": { "images": [png("trash-account-image")] }
                }
            ]
        });

        persist_app_data(data, &test_directory, &key).unwrap();
        assert_eq!(
            fs::read_dir(test_directory.join("icons")).unwrap().count(),
            1
        );
        assert_eq!(
            fs::read_dir(test_directory.join("images")).unwrap().count(),
            2
        );

        let connection = open_database(&test_directory).unwrap();
        let payload = connection
            .query_row("SELECT payload FROM app_state WHERE id = 1", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap();
        let (mut stored, _) = decode_database_payload(&payload, &key).unwrap();
        assert_eq!(stored["recycleBin"][0]["service"]["icon"]["dataUrl"], "");
        assert_eq!(
            stored["recycleBin"][1]["account"]["images"][0]["dataUrl"],
            ""
        );
        hydrate_media(&mut stored, &test_directory, &key, true).unwrap();
        assert!(stored["recycleBin"][0]["service"]["icon"]["dataUrl"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        drop(connection);

        stored["recycleBin"] = serde_json::json!([]);
        persist_app_data(stored, &test_directory, &key).unwrap();
        assert_eq!(
            fs::read_dir(test_directory.join("icons")).unwrap().count(),
            0
        );
        assert_eq!(
            fs::read_dir(test_directory.join("images")).unwrap().count(),
            0
        );
        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    #[cfg(windows)]
    fn orphan_cleanup_failure_is_reported_without_rolling_back_saved_data() {
        use std::os::windows::fs::OpenOptionsExt;

        let test_directory = test_directory("orphan-cleanup-warning-test");
        fs::create_dir_all(test_directory.join("images")).unwrap();
        fs::create_dir_all(test_directory.join("icons")).unwrap();
        let orphan = test_directory.join("images/locked-orphan.png");
        fs::write(&orphan, b"orphan").unwrap();
        let lock = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&orphan)
            .unwrap();
        let key = random_data_key();
        let data = serde_json::json!({
            "settings": { "encryptImages": false },
            "services": [],
            "accounts": [],
            "marker": "saved"
        });

        let result = persist_app_data(data, &test_directory, &key).unwrap();

        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("旧图片清理失败"));
        let connection = open_database(&test_directory).unwrap();
        let payload = connection
            .query_row("SELECT payload FROM app_state WHERE id = 1", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap();
        let (stored, _) = decode_database_payload(&payload, &key).unwrap();
        assert_eq!(stored["marker"], "saved");
        drop(connection);
        drop(lock);
        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    #[cfg(windows)]
    fn interrupted_image_migration_is_resumable_without_data_loss() {
        use std::os::windows::fs::OpenOptionsExt;

        let test_directory = test_directory("image-migration-resume-test");
        fs::create_dir_all(test_directory.join("images")).unwrap();
        fs::create_dir_all(test_directory.join("icons")).unwrap();
        let first_bytes = b"\x89PNG\r\n\x1a\nfirst";
        let second_bytes = b"\x89PNG\r\n\x1a\nsecond";
        let first = test_directory.join("images/first.png");
        let second = test_directory.join("images/second.png");
        fs::write(&first, first_bytes).unwrap();
        fs::write(&second, second_bytes).unwrap();
        let lock = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&second)
            .unwrap();
        let key = random_data_key();
        let mut data = serde_json::json!({
            "services": [],
            "accounts": [{
                "images": [
                    { "id": "first", "name": "first.png", "dataUrl": "", "storedPath": "images/first.png" },
                    { "id": "second", "name": "second.png", "dataUrl": "", "storedPath": "images/second.png" }
                ]
            }]
        });

        assert!(hydrate_media(&mut data, &test_directory, &key, true).is_err());
        assert!(fs::read(&first).unwrap().starts_with(IMAGE_ENCRYPTED_MAGIC));
        drop(lock);
        assert_eq!(fs::read(&second).unwrap(), second_bytes);

        hydrate_media(&mut data, &test_directory, &key, true).unwrap();
        assert_eq!(
            decrypt_media_bytes(&key, &fs::read(&first).unwrap()).unwrap(),
            first_bytes
        );
        assert_eq!(
            decrypt_media_bytes(&key, &fs::read(&second).unwrap()).unwrap(),
            second_bytes
        );
        assert!(!data["accounts"][0]["images"][0]["dataUrl"]
            .as_str()
            .unwrap()
            .is_empty());
        assert!(!data["accounts"][0]["images"][1]["dataUrl"]
            .as_str()
            .unwrap()
            .is_empty());
        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    #[cfg(windows)]
    fn failed_atomic_replacement_preserves_the_original_file() {
        use std::os::windows::fs::OpenOptionsExt;

        let test_directory = test_directory("atomic-media-test");
        fs::create_dir_all(&test_directory).unwrap();
        let target = test_directory.join("image.png");
        fs::write(&target, b"original").unwrap();
        let lock = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&target)
            .unwrap();

        let result = replace_file_atomically(&target, b"replacement");

        assert!(result.is_err());
        drop(lock);
        assert_eq!(fs::read(&target).unwrap(), b"original");
        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn office_exports_are_limited_to_the_owned_export_directory() {
        let mut suffix = [0u8; 8];
        OsRng.fill_bytes(&mut suffix);
        let test_directory = std::env::temp_dir().join(format!(
            "account-notebook-export-test-{}",
            suffix
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        ));
        let path = write_export_bytes(&test_directory, "accounts.xlsx", b"xlsx-bytes").unwrap();
        assert_eq!(path, test_directory.join("exports").join("accounts.xlsx"));
        assert_eq!(fs::read(path).unwrap(), b"xlsx-bytes");
        assert!(write_export_bytes(&test_directory, "../outside.xlsx", b"bad").is_err());
        assert!(write_export_bytes(&test_directory, "accounts.txt", b"bad").is_err());
        assert!(write_export_bytes(&test_directory, "empty.docx", b"").is_err());
        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn changed_media_is_written_without_overwriting_the_previous_file() {
        let test_directory = test_directory("media-change-test");
        fs::create_dir_all(test_directory.join("images")).unwrap();
        let key = random_data_key();
        let original_relative = PathBuf::from("images/shared.png");
        let original = b"\x89PNG\r\n\x1a\noriginal";
        let changed = b"\x89PNG\r\n\x1a\nchanged";
        fs::write(test_directory.join(&original_relative), original).unwrap();
        let mut image = serde_json::json!({
            "id": "shared",
            "name": "shared.png",
            "dataUrl": format!("data:image/png;base64,{}", BASE64.encode(changed)),
            "storedPath": "images/shared.png"
        });

        materialize_image(&mut image, &test_directory, "images", &key, true).unwrap();
        let new_relative = PathBuf::from(image["storedPath"].as_str().unwrap());
        assert_ne!(new_relative, original_relative);
        assert_eq!(
            fs::read(test_directory.join(&original_relative)).unwrap(),
            original
        );
        let encrypted = fs::read(test_directory.join(new_relative)).unwrap();
        assert_eq!(decrypt_media_bytes(&key, &encrypted).unwrap(), changed);
        fs::remove_dir_all(test_directory).unwrap();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let security = initialize_security().expect("failed to initialize vault security");
    tauri::Builder::default()
        .manage(security)
        .invoke_handler(tauri::generate_handler![
            get_sync_local_state,
            record_sync_success,
            get_security_status,
            unlock_vault,
            enable_startup_lock,
            change_startup_password,
            regenerate_recovery_code,
            disable_startup_lock,
            lock_vault,
            load_app_data,
            save_app_data,
            append_audit,
            read_audit_logs,
            open_audit_log,
            open_external,
            fetch_remote_image,
            export_backup,
            create_rollback_backup,
            write_export_file,
            get_storage_stats,
            inspect_backup,
            decrypt_backup,
            reveal_data_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running account notebook");
}
