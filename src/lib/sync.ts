/**
 * Providers only exchange encrypted snapshots. Plain AppData stays behind the
 * desktop/mobile vault boundary.
 */
export interface EncryptedVaultSnapshot {
  format: "account-notebook-sync-v2";
  vaultId: string;
  snapshotId: string;
  parentSnapshotId: string | null;
  vaultRevision: number;
  createdAt: string;
  deviceId: string;
  encryptedBackup: string;
}

export interface SyncLocalState {
  formatVersion: 1;
  deviceId: string;
  lastSyncedVaultId: string | null;
  lastSyncedSnapshotId: string | null;
  lastSyncedVaultRevision: number;
  lastSyncedAt: string | null;
}

export interface SyncStatus {
  state: "disabled" | "idle" | "syncing" | "conflict" | "error";
  lastSyncedAt: string | null;
  message?: string;
}

export interface SyncProvider {
  getStatus(): Promise<SyncStatus>;
  pull(): Promise<EncryptedVaultSnapshot | null>;
  push(snapshot: EncryptedVaultSnapshot, expectedRemoteSnapshotId: string | null): Promise<void>;
}

export type SyncPlan =
  | { action: "none"; reason: "up-to-date" }
  | { action: "pull"; remote: EncryptedVaultSnapshot }
  | { action: "push"; expectedRemoteSnapshotId: string | null }
  | { action: "conflict"; reason: string; remote?: EncryptedVaultSnapshot };

function invalidSnapshotReason(snapshot: EncryptedVaultSnapshot) {
  if (snapshot.format !== "account-notebook-sync-v2") return "远端快照格式不受支持";
  if (!snapshot.vaultId.trim() || !snapshot.snapshotId.trim() || !snapshot.deviceId.trim()) {
    return "远端快照缺少必要编号";
  }
  if (!Number.isSafeInteger(snapshot.vaultRevision) || snapshot.vaultRevision < 0) {
    return "远端快照 revision 无效";
  }
  if (snapshot.parentSnapshotId === snapshot.snapshotId) return "远端快照不能指向自身";
  if (!snapshot.encryptedBackup.trim()) return "远端快照缺少加密备份";
  return null;
}

export function planSnapshotSync(
  vaultId: string,
  localVaultRevision: number,
  cursor: SyncLocalState,
  remote: EncryptedVaultSnapshot | null,
): SyncPlan {
  const hasBaseline = cursor.lastSyncedSnapshotId !== null;
  if (hasBaseline && cursor.lastSyncedVaultId !== vaultId) {
    return { action: "conflict", reason: "本机同步基线属于另一个 vault", ...(remote ? { remote } : {}) };
  }
  if (!hasBaseline && (cursor.lastSyncedVaultId !== null || cursor.lastSyncedVaultRevision !== 0)) {
    return { action: "conflict", reason: "本机同步游标不完整", ...(remote ? { remote } : {}) };
  }
  if (!remote) {
    return hasBaseline
      ? { action: "conflict", reason: "远端同步基线已不存在" }
      : { action: "push", expectedRemoteSnapshotId: null };
  }
  const invalidReason = invalidSnapshotReason(remote);
  if (invalidReason) return { action: "conflict", reason: invalidReason, remote };
  if (remote.vaultId !== vaultId) {
    return { action: "conflict", reason: "远端快照属于另一个 vault", remote };
  }
  if (!hasBaseline) {
    return localVaultRevision === 0
      ? { action: "pull", remote }
      : { action: "conflict", reason: "本地与远端没有共同同步基线", remote };
  }
  if (localVaultRevision < cursor.lastSyncedVaultRevision
    || remote.vaultRevision < cursor.lastSyncedVaultRevision) {
    return { action: "conflict", reason: "检测到同步 revision 回退", remote };
  }
  if (remote.snapshotId === cursor.lastSyncedSnapshotId) {
    if (remote.vaultRevision !== cursor.lastSyncedVaultRevision) {
      return { action: "conflict", reason: "远端快照编号与 revision 不一致", remote };
    }
    return localVaultRevision === cursor.lastSyncedVaultRevision
      ? { action: "none", reason: "up-to-date" }
      : { action: "push", expectedRemoteSnapshotId: remote.snapshotId };
  }
  if (remote.vaultRevision === cursor.lastSyncedVaultRevision) {
    return { action: "conflict", reason: "远端快照编号变化但 revision 未前进", remote };
  }
  return localVaultRevision === cursor.lastSyncedVaultRevision
    ? { action: "pull", remote }
    : { action: "conflict", reason: "本地和远端都已从共同基线发生修改", remote };
}

export interface EntityVersionState {
  revision: number;
  deleted: boolean;
}

export type EntitySyncDecision = "unchanged" | "take-local" | "take-remote" | "conflict";

export function decideEntitySync(
  baseRevision: number,
  local: EntityVersionState,
  remote: EntityVersionState,
): EntitySyncDecision {
  if (local.revision < baseRevision || remote.revision < baseRevision) return "conflict";
  if (local.revision === baseRevision
    && remote.revision === baseRevision
    && local.deleted === remote.deleted) return "unchanged";
  const localChanged = local.revision > baseRevision;
  const remoteChanged = remote.revision > baseRevision;
  if (localChanged && !remoteChanged) return "take-local";
  if (!localChanged && remoteChanged) return "take-remote";
  return "conflict";
}

export class DisabledSyncProvider implements SyncProvider {
  async getStatus(): Promise<SyncStatus> {
    return { state: "disabled", lastSyncedAt: null };
  }

  async pull(): Promise<EncryptedVaultSnapshot | null> {
    return null;
  }

  async push(): Promise<void> {
    throw new Error("尚未配置同步服务");
  }
}
