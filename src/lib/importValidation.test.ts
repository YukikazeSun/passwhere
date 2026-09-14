import { describe, expect, it } from "vitest";
import { prepareImportData } from "./importValidation";
import { CURRENT_DATA_VERSION, normalizeAppData } from "./dataModel";

const metadata = { fileName: "backup.json", sourceType: "json" as const, createdAt: "2026-07-27T00:00:00.000Z" };
const png = "data:image/png;base64,iVBORw0KGgo=";

function validData() {
  return {
    version: 1,
    categories: [{ id: "category-work", name: "工作", parentId: null as string | null, color: "#123456" }],
    tags: [{ id: "tag-important", name: "重要", color: "#a64b45" }],
    services: [{ id: "service-site", name: "网站", url: "", categoryId: "category-work" as string | null, tagIds: ["tag-important"], icon: { id: "icon", name: "icon.png", dataUrl: png }, createdAt: "", updatedAt: "" }],
    accounts: [{ id: "account-main", serviceId: "service-site", label: "主账号", username: "", password: "", identityCode: "", notes: [], securityQuestions: [], customFields: [], images: [{ id: "image", name: "code.png", dataUrl: png }], passwordHistory: [], createdAt: "", updatedAt: "" }],
  };
}

describe("prepareImportData", () => {
  it("validates references, migrates data and builds preview counts", () => {
    const prepared = prepareImportData(validData(), metadata);
    expect(prepared.sourceVersion).toBe(1);
    expect(prepared.data.version).toBe(CURRENT_DATA_VERSION);
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

  it("validates and sanitizes version 6 recycle bin media", () => {
    const input = normalizeAppData(validData());
    const recycledAccount = {
      ...input.accounts[0],
      id: "account-deleted",
      images: [{ id: "trash-image", name: "trash.png", dataUrl: png, storedPath: "images/local-only.png" }],
    };
    input.recycleBin = [{
      id: "trash-account",
      type: "account",
      label: recycledAccount.label,
      serviceName: input.services[0].name,
      deletedAt: "2026-07-30T02:00:00.000Z",
      account: recycledAccount,
    }];
    const prepared = prepareImportData(input, metadata);
    const item = prepared.data.recycleBin[0];
    expect(item.type).toBe("account");
    if (item.type !== "account") return;
    expect(item.account.images[0].dataUrl).toBe(png);
    expect(item.account.images[0].storedPath).toBeUndefined();
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

  it("rejects malformed nested account records before preview", () => {
    const input = validData();
    input.accounts[0].securityQuestions = [null] as never;
    expect(() => prepareImportData(input, metadata)).toThrow("密保问题清单格式不正确");
  });

  it("rejects non-text security contact fields", () => {
    const input = validData();
    (input.accounts[0] as unknown as Record<string, unknown>).securityPhone = 13800138000;
    expect(() => prepareImportData(input, metadata)).toThrow("密保联系方式格式不正确");
  });

  it("rejects duplicate nested identifiers", () => {
    const input = validData();
    input.accounts[0].customFields = [
      { id: "field", label: "A", value: "1", multiline: false, copyable: true },
      { id: "field", label: "B", value: "2", multiline: false, copyable: true },
    ] as never;
    expect(() => prepareImportData(input, metadata)).toThrow("自定义字段中存在重复编号");
  });

  it("rejects portable images whose bytes do not match the declared type", () => {
    const input = validData();
    input.accounts[0].images[0].dataUrl = "data:image/png;base64,bm90LWEtcG5n";
    expect(() => prepareImportData(input, metadata)).toThrow("内容损坏或与格式不匹配");
  });
});

describe("prepareImportData large hierarchies", () => {
  it("validates a large category hierarchy and still detects cycles", () => {
    const input = validData();
    input.categories = Array.from({ length: 2_000 }, (_, index) => ({
      id: `category-${index}`,
      name: `Category ${index}`,
      parentId: index === 0 ? null : `category-${index - 1}`,
      color: "#123456",
    }));
    input.services[0].categoryId = "category-1999";

    const prepared = prepareImportData(input, metadata);
    expect(prepared.data.categories).toHaveLength(2_000);
    expect(prepared.data.services[0].categoryId).toBe("category-1999");

    input.categories[0].parentId = "category-1999";
    expect(() => prepareImportData(input, metadata)).toThrow();
  });
});
