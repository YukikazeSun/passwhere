import { describe, expect, it } from "vitest";
import { prepareImportData } from "./importValidation";
import { normalizeAppData } from "./dataModel";

const metadata = { fileName: "backup.json", sourceType: "json" as const, createdAt: "2026-07-27T00:00:00.000Z" };

function validData() {
  return {
    version: 1,
    categories: [{ id: "category-work", name: "工作", parentId: null, color: "#123456" }],
    tags: [{ id: "tag-important", name: "重要", color: "#a64b45" }],
    services: [{ id: "service-site", name: "网站", url: "", categoryId: "category-work", tagIds: ["tag-important"], icon: { id: "icon", name: "icon.png", dataUrl: "data:image/png;base64,AA==" }, createdAt: "", updatedAt: "" }],
    accounts: [{ id: "account-main", serviceId: "service-site", label: "主账号", username: "", password: "", identityCode: "", notes: [], securityQuestions: [], customFields: [], images: [{ id: "image", name: "code.png", dataUrl: "data:image/png;base64,AA==" }], passwordHistory: [], createdAt: "", updatedAt: "" }],
  };
}

describe("prepareImportData", () => {
  it("validates references, migrates data and builds preview counts", () => {
    const prepared = prepareImportData(validData(), metadata);
    expect(prepared.sourceVersion).toBe(1);
    expect(prepared.data.version).toBe(5);
    expect(prepared.data.settings.passwordTemplate).toBe("");
    expect(prepared.data.settings.encryptImages).toBe(false);
    expect(prepared.counts).toEqual({ categories: 1, tags: 1, services: 1, accounts: 1, images: 2 });
  });

  it("keeps password template settings in a complete backup", () => {
    const input = { ...validData(), version: 3, settings: { passwordTemplate: "Fixed!2026{网站名称}", encryptImages: true } };
    const prepared = prepareImportData(input, metadata);
    expect(prepared.data.settings.passwordTemplate).toBe("Fixed!2026{网站名称}");
    expect(prepared.data.settings.encryptImages).toBe(true);
  });

  it("keeps shared sync metadata in a version 5 complete backup", () => {
    const input = normalizeAppData(validData());
    input.sync.vaultId = "vault-backup";
    input.sync.revision = 5;
    input.sync.tombstones = [{
      entityType: "account",
      entityId: "deleted-account",
      revision: 3,
      deletedAt: "2026-07-28T02:00:00.000Z",
      modifiedByDeviceId: "device-remote",
    }];
    const prepared = prepareImportData(input, metadata);
    expect(prepared.data.sync.vaultId).toBe("vault-backup");
    expect(prepared.data.sync.revision).toBe(5);
    expect(prepared.data.sync.tombstones).toEqual(input.sync.tombstones);
  });

  it("rejects a version 5 backup with missing or contradictory sync metadata", () => {
    const missingSync = normalizeAppData(validData());
    delete (missingSync as unknown as Record<string, unknown>).sync;
    expect(() => prepareImportData(missingSync, metadata)).toThrow("缺少同步元数据");

    const collision = normalizeAppData(validData());
    collision.sync.tombstones = [{
      entityType: "account",
      entityId: collision.accounts[0].id,
      revision: 1,
      deletedAt: "2026-07-28T02:00:00.000Z",
      modifiedByDeviceId: "device-remote",
    }];
    expect(() => prepareImportData(collision, metadata)).toThrow("同时存在于记录和删除墓碑");
  });

  it("rejects incomplete roots instead of normalizing them to empty data", () => {
    expect(() => prepareImportData({ version: 2, tags: [] }, metadata)).toThrow("分类清单格式不正确");
  });

  it("rejects unsupported future versions", () => {
    expect(() => prepareImportData({ ...validData(), version: 99 }, metadata)).toThrow("高于当前支持的版本");
  });

  it("rejects broken account references", () => {
    const input = validData();
    input.accounts[0].serviceId = "missing";
    expect(() => prepareImportData(input, metadata)).toThrow("引用了不存在的分区");
  });

  it("rejects duplicate identifiers", () => {
    const input = validData();
    input.tags.push({ ...input.tags[0] });
    expect(() => prepareImportData(input, metadata)).toThrow("标签中存在重复编号");
  });

  it("does not trust machine-specific stored paths from imported files", () => {
    const input = validData();
    input.accounts[0].images[0] = { ...input.accounts[0].images[0], storedPath: "../../outside.png" } as typeof input.accounts[0]["images"][number];
    const prepared = prepareImportData(input, metadata);
    expect(prepared.data.accounts[0].images[0].storedPath).toBeUndefined();
  });

  it("rejects image references that do not contain portable image data", () => {
    const input = validData();
    input.accounts[0].images[0] = { id: "image", name: "code.png", dataUrl: "", storedPath: "images/code.png" } as typeof input.accounts[0]["images"][number];
    expect(() => prepareImportData(input, metadata)).toThrow("缺少可移植的图片数据");
  });
});
