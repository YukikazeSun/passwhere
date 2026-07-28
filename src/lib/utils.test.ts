import { describe, expect, it } from "vitest";
import type { AccountRecord, Category, ServiceRecord } from "../types";
import { filterServices, findServiceSearchResults, formatByteSize } from "./utils";

const categories: Category[] = [
  { id: "work", name: "工作", parentId: null, color: "#000000", sortOrder: 0, revision: 1, updatedAt: "", modifiedByDeviceId: "device-test" },
  { id: "design", name: "设计", parentId: "work", color: "#000000", sortOrder: 1, revision: 1, updatedAt: "", modifiedByDeviceId: "device-test" },
];

const services: ServiceRecord[] = [
  { id: "figma", name: "Figma", url: "", categoryId: "design", tagIds: [], icon: null, createdAt: "", updatedAt: "", sortOrder: 0, revision: 1, modifiedByDeviceId: "device-test" },
  { id: "steam", name: "Steam", url: "", categoryId: null, tagIds: [], icon: null, createdAt: "", updatedAt: "", sortOrder: 1, revision: 1, modifiedByDeviceId: "device-test" },
];

const accounts: AccountRecord[] = [
  { id: "a1", serviceId: "figma", label: "团队", username: "designer", password: "hidden-secret", identityCode: "", notes: [{ id: "n1", title: "续费提醒", content: "年度订阅" }], visibleModules: ["username", "password", "identity", "security", "custom", "notes", "images"], sortOrder: 0, securityQuestions: [], customFields: [], images: [], passwordHistory: [], createdAt: "", updatedAt: "", revision: 1, modifiedByDeviceId: "device-test" },
];

describe("filterServices", () => {
  it("includes descendants when a parent category is selected", () => {
    expect(filterServices(services, accounts, categories, [], "", "work", new Set()).map((item) => item.id)).toEqual(["figma"]);
  });

  it("searches account fields as part of its parent service", () => {
    expect(filterServices(services, accounts, categories, [], "年度订阅", "all", new Set()).map((item) => item.id)).toEqual(["figma"]);
  });

  it("distinguishes service, account and note matches", () => {
    const serviceMatch = findServiceSearchResults(services, accounts, categories, [], "Figma", "all", new Set())[0];
    const accountMatch = findServiceSearchResults(services, accounts, categories, [], "designer", "all", new Set())[0];
    const noteMatch = findServiceSearchResults(services, accounts, categories, [], "年度订阅", "all", new Set())[0];

    expect(serviceMatch.match).toMatchObject({ kind: "service", accountId: null, label: "分区名称" });
    expect(accountMatch.match).toMatchObject({ kind: "account", accountId: "a1", label: "登录账号" });
    expect(noteMatch.match).toMatchObject({ kind: "note", accountId: "a1", label: "备注" });
  });

  it("returns the matching account for direct navigation without searching passwords", () => {
    expect(findServiceSearchResults(services, accounts, categories, [], "designer", "all", new Set())[0].match?.accountId).toBe("a1");
    expect(findServiceSearchResults(services, accounts, categories, [], "hidden-secret", "all", new Set())).toEqual([]);
  });
});

describe("formatByteSize", () => {
  it("uses compact binary units", () => {
    expect(formatByteSize(0)).toBe("0 B");
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(1536)).toBe("1.5 KB");
    expect(formatByteSize(12 * 1024 * 1024)).toBe("12 MB");
  });
});
