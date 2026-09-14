import type { AppData, AuditEvent, BackupInfo, SaveResult, SecurityStatus, StorageStats, UnlockResult } from "../types";
import { createEmptyAppData, CURRENT_DATA_VERSION, normalizeAppData } from "./dataModel";
import type { SyncLocalState } from "./sync";

let browserData: AppData | null = null;
let browserLogs: AuditEvent[] = [];
let browserRollbackData: AppData | null = null;
let browserLastBackupAt: string | null = null;
let browserBackupCount = 0;
let browserPassword = "";
let browserRecoveryCode = "";
let browserSecurity: SecurityStatus = { startupLockEnabled: false, unlocked: true, requiresPasswordChange: false };
let browserSyncLocalState: SyncLocalState | null = null;

const isTauri = () => "__TAURI_INTERNALS__" in window;

async function invokeTauri<T>(command: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function getSyncLocalState(): Promise<SyncLocalState> {
  if (isTauri()) return invokeTauri<SyncLocalState>("get_sync_local_state");
  browserSyncLocalState ??= {
    formatVersion: 1,
    deviceId: `device-browser-${crypto.randomUUID()}`,
    lastSyncedVaultId: null,
    lastSyncedSnapshotId: null,
    lastSyncedVaultRevision: 0,
    lastSyncedAt: null,
  };
  return { ...browserSyncLocalState };
}

export async function recordSyncSuccess(vaultId: string, snapshotId: string, vaultRevision: number) {
  if (isTauri()) {
    return invokeTauri<SyncLocalState>("record_sync_success", { vaultId, snapshotId, vaultRevision });
  }
  const current = await getSyncLocalState();
  browserSyncLocalState = {
    ...current,
    lastSyncedVaultId: vaultId,
    lastSyncedSnapshotId: snapshotId,
    lastSyncedVaultRevision: vaultRevision,
    lastSyncedAt: new Date().toISOString(),
  };
  return { ...browserSyncLocalState };
}

export async function loadAppData(deviceId: string) {
  if (isTauri()) {
    const data = await invokeTauri<AppData | null>("load_app_data");
    if (data) {
      const normalized = normalizeAppData(data, deviceId);
      if (data.version !== CURRENT_DATA_VERSION) await saveAppData(normalized);
      return normalized;
    }
    const initial = createEmptyAppData(deviceId);
    await saveAppData(initial);
    return initial;
  }

  browserData ??= createEmptyAppData(deviceId);
  return normalizeAppData(structuredClone(browserData), deviceId);
}

export async function saveAppData(data: AppData): Promise<SaveResult> {
  if (isTauri()) {
    return invokeTauri<SaveResult>("save_app_data", { data });
  }
  browserData = structuredClone(data);
  return {
    dataDir: "浏览器演示存储",
    updatedAt: new Date().toISOString(),
    data: structuredClone(browserData),
    warnings: [],
  };
}

export async function appendAudit(event: AuditEvent) {
  if (isTauri()) {
    await invokeTauri("append_audit", { event });
    return;
  }
  browserLogs = [...browserLogs, event].slice(-500);
}

export async function readAuditLogs() {
  if (isTauri()) return invokeTauri<AuditEvent[]>("read_audit_logs");
  return [...browserLogs].reverse();
}

export async function openAuditLog() {
  if (isTauri()) return invokeTauri<string>("open_audit_log");
  const logs = JSON.stringify(browserLogs, null, 2);
  downloadBlob(new Blob([logs], { type: "application/json" }), "account-notebook-audit.json");
  return "已下载浏览器演示日志";
}

export async function openExternal(url: string) {
  if (isTauri()) return invokeTauri<void>("open_external", { url });
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function fetchRemoteImage(url: string) {
  if (isTauri()) return invokeTauri<string>("fetch_remote_image", { url });
  return url;
}

export async function exportBackup(data: AppData, credential?: string) {
  if (isTauri()) return invokeTauri<string>("export_backup", { data, credential: credential || null });
  throw new Error("加密备份仅在桌面程序中可用");
}

export async function createRollbackBackup(data: AppData) {
  if (isTauri()) return invokeTauri<string>("create_rollback_backup", { data });
  browserRollbackData = structuredClone(data);
  browserLastBackupAt = new Date().toISOString();
  browserBackupCount += 1;
  return "浏览器演示回滚快照（仅当前会话）";
}

export async function saveOfficeExport(fileName: string, bytes: Uint8Array) {
  if (isTauri()) {
    return invokeTauri<string>("write_export_file", { fileName, bytes: Array.from(bytes) });
  }
  const mime = fileName.toLowerCase().endsWith(".xlsx")
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  downloadBlob(new Blob([bytes as BlobPart], { type: mime }), fileName);
  return `浏览器下载：${fileName}`;
}

export async function getSecurityStatus(): Promise<SecurityStatus> {
  if (isTauri()) return invokeTauri<SecurityStatus>("get_security_status");
  return { ...browserSecurity };
}

export async function unlockVault(credential: string) {
  if (isTauri()) return invokeTauri<UnlockResult>("unlock_vault", { credential });
  const unlockedViaRecovery = credential === browserRecoveryCode;
  if (!browserSecurity.startupLockEnabled || (credential !== browserPassword && !unlockedViaRecovery)) {
    throw new Error("启动密码或恢复码不正确");
  }
  browserSecurity = { ...browserSecurity, unlocked: true, requiresPasswordChange: unlockedViaRecovery };
  return { unlockedViaRecovery };
}

export async function enableStartupLock(password: string) {
  if (isTauri()) return invokeTauri<{ recoveryCode: string }>("enable_startup_lock", { password });
  if (password.length < 8) throw new Error("启动密码至少需要 8 个字符");
  browserPassword = password;
  browserRecoveryCode = generateBrowserRecoveryCode();
  browserSecurity = { startupLockEnabled: true, unlocked: true, requiresPasswordChange: false };
  return { recoveryCode: browserRecoveryCode };
}

export async function changeStartupPassword(newPassword: string) {
  if (isTauri()) return invokeTauri<void>("change_startup_password", { newPassword });
  if (newPassword.length < 8) throw new Error("启动密码至少需要 8 个字符");
  if (!browserSecurity.startupLockEnabled) throw new Error("请先启用启动密码");
  browserPassword = newPassword;
  browserSecurity = { ...browserSecurity, requiresPasswordChange: false };
}

export async function regenerateRecoveryCode() {
  if (isTauri()) return invokeTauri<{ recoveryCode: string }>("regenerate_recovery_code");
  if (!browserSecurity.startupLockEnabled) throw new Error("请先启用启动密码");
  browserRecoveryCode = generateBrowserRecoveryCode();
  return { recoveryCode: browserRecoveryCode };
}

export async function disableStartupLock() {
  if (isTauri()) return invokeTauri<void>("disable_startup_lock");
  browserPassword = "";
  browserRecoveryCode = "";
  browserSecurity = { startupLockEnabled: false, unlocked: true, requiresPasswordChange: false };
}

export async function lockVault() {
  if (isTauri()) return invokeTauri<void>("lock_vault");
  if (!browserSecurity.startupLockEnabled) throw new Error("当前未启用启动密码");
  browserSecurity = { ...browserSecurity, unlocked: false, requiresPasswordChange: false };
}

export async function getStorageStats(): Promise<StorageStats> {
  if (isTauri()) return invokeTauri<StorageStats>("get_storage_stats");
  const current = browserData || createEmptyAppData();
  const images = current.accounts.flatMap((account) => account.images);
  return {
    lastBackupAt: browserLastBackupAt,
    dataSizeBytes: new Blob([JSON.stringify(current)]).size,
    imageSizeBytes: images.reduce((total, image) => total + new Blob([image.dataUrl || ""]).size, 0),
    backupCount: browserBackupCount,
  };
}

export async function inspectBackup(backupText: string) {
  if (isTauri()) return invokeTauri<BackupInfo>("inspect_backup", { backupText });
  throw new Error("加密备份仅在桌面程序中可用");
}

export async function decryptBackup(backupText: string, credential?: string) {
  if (isTauri()) {
    return invokeTauri<unknown>("decrypt_backup", { backupText, credential: credential || null });
  }
  throw new Error("加密备份仅在桌面程序中可用");
}

export async function revealDataDirectory() {
  if (isTauri()) return invokeTauri<string>("reveal_data_directory");
  return "浏览器演示仅使用当前页面内存；桌面版数据保存在可执行文件旁的 data 目录。";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Let the browser start the download before releasing the object URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function generateBrowserRecoveryCode() {
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*+-=?"];
  const all = groups.join("");
  const randomIndex = (length: number) => crypto.getRandomValues(new Uint32Array(1))[0] % length;
  const characters = groups.map((group) => group[randomIndex(group.length)]);
  while (characters.length < 16) characters.push(all[randomIndex(all.length)]);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1);
    [characters[index], characters[target]] = [characters[target], characters[index]];
  }
  return characters.join("");
}

export const MAX_IMAGE_FILE_BYTES = 15 * 1024 * 1024;

const IMAGE_MIME_PATTERN = /^(image\/(png|jpeg|webp|gif|bmp|x-icon|vnd\.microsoft\.icon))$/i;

function imageMimeFromFile(file: File) {
  if (IMAGE_MIME_PATTERN.test(file.type)) return file.type.toLowerCase();
  const filename = file.name.toLowerCase();
  if (filename.endsWith(".ico")) return "image/x-icon";
  if (filename.endsWith(".png")) return "image/png";
  if (/\.jpe?g$/i.test(filename)) return "image/jpeg";
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".gif")) return "image/gif";
  if (filename.endsWith(".bmp")) return "image/bmp";
  return null;
}

function hasImageSignature(mime: string, bytes: Uint8Array) {
  const startsWith = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  switch (mime) {
    case "image/png": return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg": return startsWith(0xff, 0xd8, 0xff);
    case "image/webp": return startsWith(0x52, 0x49, 0x46, 0x46) && bytes.length >= 12 && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    case "image/gif": return String.fromCharCode(...bytes.slice(0, 6)) === "GIF87a" || String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a";
    case "image/bmp": return startsWith(0x42, 0x4d);
    case "image/x-icon":
    case "image/vnd.microsoft.icon": return startsWith(0x00, 0x00, 0x01, 0x00);
    default: return false;
  }
}

const IMAGE_SIGNATURE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/x-icon",
] as const;

function detectImageMime(bytes: Uint8Array) {
  return IMAGE_SIGNATURE_MIMES.find((mime) => hasImageSignature(mime, bytes)) || null;
}

export async function validateImageFile(file: File) {
  const displayName = file.name || "粘贴图片";
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error(`图片“${displayName}”超过 15 MB 限制`);
  }
  const declaredMime = imageMimeFromFile(file);
  if (!declaredMime) throw new Error(`“${displayName}”不是支持的图片格式`);
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const detectedMime = detectImageMime(header);
  if (!detectedMime) {
    throw new Error(`图片“${displayName}”的内容与格式不匹配`);
  }
  return detectedMime;
}

export async function readFileAsDataUrl(file: File) {
  const imageMime = await validateImageFile(file);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.replace(/^data:[^;,]*;/, `data:${imageMime};`));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function isImageFile(file: File) {
  return imageMimeFromFile(file) !== null;
}
