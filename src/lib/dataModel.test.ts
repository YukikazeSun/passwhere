import { describe, expect, it } from "vitest";
import { ALL_ACCOUNT_MODULES, createEmptyAppData, CURRENT_DATA_VERSION, moveItem, normalizeAppData } from "./dataModel";

describe("normalizeAppData", () => {
  it("creates a clean first-run data set for packaged builds", () => {
    const data = createEmptyAppData("device-test", "2026-07-28T00:00:00.000Z");
    expect(data).toMatchObject({
      version: CURRENT_DATA_VERSION,
      settings: { passwordTemplate: "", encryptImages: false },
      sync: {
        revision: 0,
        settingsRevision: 0,
        settingsUpdatedAt: "2026-07-28T00:00:00.000Z",
        settingsModifiedByDeviceId: "device-test",
        tombstones: [],
      },
      categories: [],
      tags: [],
      services: [],
      accounts: [],
      recycleBin: [],
    });
    expect(data.sync.vaultId).toMatch(/^vault-/);
  });

  it("migrates legacy notes and creates stable ordering", () => {
    const data = normalizeAppData({
      version: 1,
      categories: [{ id: "c", name: "工作", parentId: null, color: "#000" }],
      tags: [],
      services: [{ id: "s", name: "站点", url: "", categoryId: null, tagIds: [], icon: null, createdAt: "", updatedAt: "" }],
      accounts: [{ id: "a", serviceId: "s", label: "门禁", username: "", password: "1234", identityCode: "", notes: "一楼", securityQuestions: [], customFields: [], images: [], passwordHistory: [], createdAt: "", updatedAt: "" }],
    });
    expect(data.version).toBe(CURRENT_DATA_VERSION);
    expect(data.settings).toEqual({ passwordTemplate: "", encryptImages: false });
    expect(data.accounts[0].notes[0].content).toBe("一楼");
    expect(data.accounts[0]).toMatchObject({ securityPhone: "", securityEmail: "" });
    expect(data.accounts[0].visibleModules).toEqual(ALL_ACCOUNT_MODULES);
    expect(data.services[0].sortOrder).toBe(0);
    expect(data.services[0]).toMatchObject({ revision: 1, modifiedByDeviceId: "device-legacy-migration" });
    expect(data.sync.revision).toBe(1);
  });

  it("keeps password template settings while normalizing version 2 data", () => {
    const data = normalizeAppData({
      version: 2,
      settings: { passwordTemplate: "Fixed!2026{网站名称}" },
      categories: [],
      tags: [],
      services: [],
      accounts: [],
    });
    expect(data.version).toBe(CURRENT_DATA_VERSION);
    expect(data.settings.passwordTemplate).toBe("Fixed!2026{网站名称}");
    expect(data.settings.encryptImages).toBe(false);
  });

  it("keeps the optional image encryption setting in version 3 data", () => {
    const data = normalizeAppData({
      version: 3,
      settings: { passwordTemplate: "", encryptImages: true },
      categories: [],
      tags: [],
      services: [],
      accounts: [],
    });
    expect(data.version).toBe(CURRENT_DATA_VERSION);
    expect(data.settings.encryptImages).toBe(true);
  });

  it("preserves version 5 vault metadata and deletion tombstones", () => {
    const data = normalizeAppData({
      version: 5,
      settings: { passwordTemplate: "", encryptImages: false },
      sync: {
        vaultId: "vault-stable",
        revision: 7,
        settingsRevision: 2,
        settingsUpdatedAt: "2026-07-28T01:00:00.000Z",
        settingsModifiedByDeviceId: "device-a",
        tombstones: [{ entityType: "account", entityId: "deleted-account", revision: 4, deletedAt: "2026-07-28T02:00:00.000Z", modifiedByDeviceId: "device-b" }],
      },
      categories: [], tags: [], services: [], accounts: [],
    });
    expect(data.sync).toEqual({
      vaultId: "vault-stable",
      revision: 7,
      settingsRevision: 2,
      settingsUpdatedAt: "2026-07-28T01:00:00.000Z",
      settingsModifiedByDeviceId: "device-a",
      tombstones: [{ entityType: "account", entityId: "deleted-account", revision: 4, deletedAt: "2026-07-28T02:00:00.000Z", modifiedByDeviceId: "device-b" }],
    });
    expect(data.recycleBin).toEqual([]);
  });

  it("normalizes version 6 recycle bin snapshots", () => {
    const data = normalizeAppData({
      version: 6,
      settings: { passwordTemplate: "", encryptImages: false },
      categories: [], tags: [], services: [], accounts: [],
      recycleBin: [{
        id: "trash-account",
        type: "account",
        label: "门禁",
        deletedAt: "2026-07-30T02:00:00.000Z",
        serviceName: "办公室",
        account: {
          id: "account-door",
          serviceId: "service-office",
          label: "门禁",
          username: "",
          password: "1234",
          identityCode: "",
          notes: [],
          visibleModules: ["password"],
          sortOrder: 0,
          securityQuestions: [],
          customFields: [],
          images: [],
          passwordHistory: [],
          createdAt: "2026-07-30T01:00:00.000Z",
          revision: 2,
          updatedAt: "2026-07-30T01:00:00.000Z",
          modifiedByDeviceId: "device-a",
        },
      }],
    });
    expect(data.recycleBin).toHaveLength(1);
    expect(data.recycleBin[0]).toMatchObject({ id: "trash-account", type: "account", serviceName: "办公室" });
  });

  it("moves an item without mutating the source", () => {
    const source = ["a", "b", "c"];
    expect(moveItem(source, 0, 2)).toEqual(["b", "c", "a"]);
    expect(source).toEqual(["a", "b", "c"]);
  });
});
