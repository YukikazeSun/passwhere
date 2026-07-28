import { describe, expect, it } from "vitest";
import type { EncryptedVaultSnapshot, SyncLocalState } from "./sync";
import { decideEntitySync, planSnapshotSync } from "./sync";

const cursor: SyncLocalState = {
  formatVersion: 1,
  deviceId: "device-local",
  lastSyncedVaultId: "vault-main",
  lastSyncedSnapshotId: "snapshot-base",
  lastSyncedVaultRevision: 4,
  lastSyncedAt: "2026-07-28T00:00:00.000Z",
};

function snapshot(overrides: Partial<EncryptedVaultSnapshot> = {}): EncryptedVaultSnapshot {
  return {
    format: "account-notebook-sync-v2",
    vaultId: "vault-main",
    snapshotId: "snapshot-base",
    parentSnapshotId: null,
    vaultRevision: 4,
    createdAt: "2026-07-28T00:00:00.000Z",
    deviceId: "device-remote",
    encryptedBackup: "encrypted-only",
    ...overrides,
  };
}

describe("planSnapshotSync", () => {
  it("pushes only when the remote still matches the local baseline", () => {
    expect(planSnapshotSync("vault-main", 5, cursor, snapshot())).toEqual({
      action: "push",
      expectedRemoteSnapshotId: "snapshot-base",
    });
  });

  it("pulls a remote change when the local vault is unchanged", () => {
    const remote = snapshot({ snapshotId: "snapshot-remote", parentSnapshotId: "snapshot-base", vaultRevision: 5 });
    expect(planSnapshotSync("vault-main", 4, cursor, remote)).toEqual({ action: "pull", remote });
  });

  it("stops when both local and remote changed", () => {
    const remote = snapshot({ snapshotId: "snapshot-remote", parentSnapshotId: "snapshot-base", vaultRevision: 5 });
    expect(planSnapshotSync("vault-main", 5, cursor, remote)).toMatchObject({ action: "conflict" });
  });

  it("rejects an unrelated vault and revision rollback", () => {
    expect(planSnapshotSync("vault-main", 4, cursor, snapshot({ vaultId: "vault-other" }))).toMatchObject({ action: "conflict" });
    expect(planSnapshotSync("vault-main", 4, cursor, snapshot({ vaultRevision: 3 }))).toMatchObject({ action: "conflict" });
  });

  it("rejects a missing or rewritten remote baseline", () => {
    expect(planSnapshotSync("vault-main", 4, cursor, null)).toMatchObject({ action: "conflict" });
    expect(planSnapshotSync("vault-main", 4, cursor, snapshot({ snapshotId: "snapshot-rewritten" }))).toMatchObject({ action: "conflict" });
  });

  it("does not reuse a cursor from another vault", () => {
    expect(planSnapshotSync("vault-imported", 1, cursor, null)).toMatchObject({ action: "conflict" });
  });
});

describe("decideEntitySync", () => {
  it("selects a single changed side and conservatively flags concurrent edits", () => {
    expect(decideEntitySync(2, { revision: 3, deleted: false }, { revision: 2, deleted: false })).toBe("take-local");
    expect(decideEntitySync(2, { revision: 2, deleted: false }, { revision: 3, deleted: true })).toBe("take-remote");
    expect(decideEntitySync(2, { revision: 3, deleted: false }, { revision: 3, deleted: true })).toBe("conflict");
    expect(decideEntitySync(2, { revision: 3, deleted: false }, { revision: 3, deleted: false })).toBe("conflict");
  });
});
