import { describe, expect, it } from "vitest";
import type { AppData } from "../types";
import { normalizeAppData } from "./dataModel";
import { exportExcel, exportWord, importExcel } from "./officeExchange";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlJ8AAAAASUVORK5CYII=";

function completeData(): AppData {
  return normalizeAppData({
    version: 4,
    settings: { passwordTemplate: "Fixed!2026{网站名称}", encryptImages: true },
    categories: [{ id: "category-work", name: "工作", parentId: null, color: "#287d72", sortOrder: 0 }],
    tags: [{ id: "tag-important", name: "重要", color: "#b8473f" }],
    services: [{
      id: "service-site",
      name: "示例网站",
      url: "https://example.com/login",
      categoryId: "category-work",
      tagIds: ["tag-important"],
      icon: { id: "icon-site", name: "site.png", dataUrl: png },
      createdAt: "2026-07-28T01:00:00.000Z",
      updatedAt: "2026-07-28T02:00:00.000Z",
      sortOrder: 0,
    }],
    accounts: [{
      id: "account-main",
      serviceId: "service-site",
      label: "主账号",
      username: "owner@example.com",
      password: "Current!123",
      identityCode: "IDENTITY-LONG-CODE",
      visibleModules: ["password", "notes", "images"],
      sortOrder: 0,
      securityQuestions: [{ id: "question-1", question: "问题？", answer: "答案" }],
      customFields: [{ id: "field-1", label: "许可证", value: "LICENSE-001", multiline: false, copyable: true }],
      notes: [{ id: "note-1", title: "备注", content: "包含链接 https://example.com" }],
      images: [{ id: "image-1", name: "security-code.png", dataUrl: png, sourceUrl: "https://example.com/code.png" }],
      passwordHistory: [{ id: "history-1", password: "Old!123", changedAt: "2026-06-28T01:00:00.000Z" }],
      createdAt: "2026-07-28T01:00:00.000Z",
      updatedAt: "2026-07-28T02:00:00.000Z",
    }],
  });
}

describe("Office data exchange", () => {
  it("round-trips the standard Excel template without changing image bytes", async () => {
    const source = completeData();
    const bytes = await exportExcel(source);
    const prepared = await importExcel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "roundtrip.xlsx");

    expect(prepared.sourceType).toBe("excel");
    expect(prepared.counts).toEqual({ categories: 1, tags: 1, services: 1, accounts: 1, images: 2 });
    expect(prepared.data.settings).toEqual(source.settings);
    expect(prepared.data.sync.vaultId).not.toBe(source.sync.vaultId);
    expect(prepared.data.sync.tombstones).toEqual([]);
    expect(prepared.data.services[0]).toMatchObject({ name: "示例网站", tagIds: ["tag-important"] });
    expect(prepared.data.services[0].icon?.dataUrl).toBe(png);
    expect(prepared.data.accounts[0]).toMatchObject({
      username: "owner@example.com",
      password: "Current!123",
      visibleModules: ["password", "notes", "images"],
    });
    expect(prepared.data.accounts[0].images[0].dataUrl).toBe(png);
    expect(prepared.data.accounts[0].passwordHistory[0].password).toBe("Old!123");
    expect(prepared.data.accounts[0].securityQuestions[0].answer).toBe("答案");
  });

  it("creates a Word OOXML package containing the account content", async () => {
    const bytes = await exportWord(completeData());
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    expect(bytes.byteLength).toBeGreaterThan(10_000);
  });
});
