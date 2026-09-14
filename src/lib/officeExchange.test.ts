import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import JSZip from "jszip";
import type { AppData } from "../types";
import { normalizeAppData } from "./dataModel";
import { exportExcel, exportWord, importExcel } from "./officeExchange";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlJ8AAAAASUVORK5CYII=";
const widePng = "data:image/png;base64,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";
const tallPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAAOECAIAAACUz5uIAAAHWklEQVR42u3ZwQmAIACGUQ3ncB6bw8ZqD+exSdqgg0FRvneNLj98KBh7LQF4z2ICECGIEBAhiBAQIYgQECGIEHhWuv6c92YjuOnYVichuI4CIgQRAiIEEQIihPCld8Iw9O4Bcxp7V3cSgusoiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQRGgCECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIIgRECCIERAgiBEQIIgRECCIERAgiBEQIIgRECCIERAgiBEQIIgRECCIERAgiBEQIIgRECCIERAgiBEQIIgRECCIERAgiBEQIIgRECCIERAgiBEQIIgRECCIERAgiBEQIIgRECCIERAgiBEQIIgRECCIERAgiBEQIIgRECCIERAgiBEQIIgRECCIERAgiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRgghNACIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBGCCAERgggBEYIIARGCCAERgggBEYIIARGCCAERgggBEYIIARGCCAERgggBEYIIARGCCAERgggBEYIIARGCCAERgggBEYIIARGCCAERgggBEYIIARGCCAERgggBEYIIARGCCAERgggBEYIIARGCCAERgggBEYIIARGCCAERgggBEYIIQYSACEGEgAhBhIAIQYSACEGEgAhBhIAIQYSACEGEgAhBhIAIQYSACEGEgAhBhIAIQYSACEGEgAhBhIAIQYSACEGEgAhBhIAIQYSACEGEgAhBhIAIQYSACEGEgAhBhIAIQYSACEGEgAhBhIAIQYSACEGEgAhBhIAIQYSACEGEgAhBhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQhChCUCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCQIQgQkCEIEJAhCBCECEgQhAhIEIQISBCECEgQhAhIEIQISBCECEgQhAhIEIQISBCECEgQhAhIEIQISBCECEgQhAhIEIQISBCECEgQhAhIEIQISBCECEgQhAhIEIQISBCECEgQhAhIEIQISBCECEgQhAhIEIQISBCECEgQhAhIEIQISBCECEgQhAhIEIQISBCECEgQhAhIEIQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAgiNAGIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQRAiIEEQIiBBECIgQfieN/Zb3ZjtwEoIIARGCCAERgggBEcJXxV6LFcBJCCIERAgiBEQIIgRECCIERAjzOAH2TBGWm2+3WgAAAABJRU5ErkJggg==";

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
      securityPhone: "13800138000",
      securityEmail: "security@example.com",
      visibleModules: ["password", "securityPhone", "securityEmail", "notes", "images"],
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

function visualRegressionData(): AppData {
  const source = completeData();
  const longCode = "ACCESS-" + "A9x!".repeat(80);
  const longNote = "这是一段用于检查 Word 自动换行和跨页行为的长备注。".repeat(24);
  const services = Array.from({ length: 2 }, (_, serviceIndex) => ({
    ...source.services[0],
    id: `service-${serviceIndex + 1}`,
    name: `视觉回归分区 ${serviceIndex + 1} · 超长名称用于检查标题换行与分页边界`,
    sortOrder: serviceIndex,
  }));
  const accounts = services.flatMap((service, serviceIndex) => Array.from({ length: 4 }, (_, accountIndex) => ({
    ...source.accounts[0],
    id: `account-${serviceIndex + 1}-${accountIndex + 1}`,
    serviceId: service.id,
    label: `账号 ${accountIndex + 1} · ${"很长的分页检查名称".repeat(4)}`,
    username: `very.long.account.${accountIndex + 1}.${"segment.".repeat(12)}@example.com`,
    password: `P@ss-${"Ab9!".repeat(36)}`,
    identityCode: longCode,
    sortOrder: accountIndex,
    notes: Array.from({ length: 3 }, (_, noteIndex) => ({
      id: `note-${serviceIndex}-${accountIndex}-${noteIndex}`,
      title: `备注 ${noteIndex + 1}`,
      content: longNote,
    })),
    images: accountIndex === 0 ? [
      { id: `wide-${serviceIndex}`, name: "横向安全码.png", dataUrl: widePng },
      { id: `tall-${serviceIndex}`, name: "纵向门禁码.png", dataUrl: tallPng },
    ] : [],
  })));
  return normalizeAppData({ ...source, services, accounts });
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
      securityPhone: "13800138000",
      securityEmail: "security@example.com",
      visibleModules: ["password", "securityPhone", "securityEmail", "notes", "images"],
    });
    expect(prepared.data.accounts[0].images[0].dataUrl).toBe(png);
    expect(prepared.data.accounts[0].passwordHistory[0].password).toBe("Old!123");
    expect(prepared.data.accounts[0].securityQuestions[0].answer).toBe("答案");
  }, 15_000);

  it("creates a Word OOXML package containing the account content", async () => {
    const bytes = await exportWord(completeData());
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    expect(bytes.byteLength).toBeGreaterThan(10_000);
  });

  it("creates the deterministic Word visual-regression fixture", async () => {
    const bytes = await exportWord(visualRegressionData());
    expect(bytes.byteLength).toBeGreaterThan(12_000);

    const archive = await JSZip.loadAsync(bytes);
    const documentXml = await archive.file("word/document.xml")?.async("text");
    expect(documentXml).toBeTruthy();
    expect(documentXml?.match(/<w:cantSplit\/?/g)?.length).toBeGreaterThanOrEqual(20);
    expect(documentXml?.match(/<w:tblInd\b/g)?.length).toBeGreaterThanOrEqual(20);

    const imageRatios = Array.from(documentXml?.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/?/g) || [])
      .map((match) => Number(match[1]) / Number(match[2]));
    expect(imageRatios.some((ratio) => ratio > 3.9 && ratio < 4.1)).toBe(true);
    expect(imageRatios.some((ratio) => ratio > 0.32 && ratio < 0.34)).toBe(true);

    const outputPath = process.env.WORD_QA_OUTPUT;
    if (outputPath) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, bytes);
    }
  });
});
