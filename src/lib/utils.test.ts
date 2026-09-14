import { describe, expect, it } from "vitest";
import type { AccountRecord, Category, ServiceRecord, Tag } from "../types";
import {
  createServiceSearchIndex,
  filterServices,
  findIndexedServiceSearchResults,
  findServiceSearchResults,
  formatByteSize,
} from "./utils";

const categories: Category[] = [
  { id: "work", name: "工作", parentId: null, color: "#000000", sortOrder: 0, revision: 1, updatedAt: "", modifiedByDeviceId: "device-test" },
  { id: "design", name: "设计", parentId: "work", color: "#000000", sortOrder: 1, revision: 1, updatedAt: "", modifiedByDeviceId: "device-test" },
];

const services: ServiceRecord[] = [
  { id: "figma", name: "Figma", url: "", categoryId: "design", tagIds: [], icon: null, createdAt: "", updatedAt: "", sortOrder: 0, revision: 1, modifiedByDeviceId: "device-test" },
  { id: "steam", name: "Steam", url: "", categoryId: null, tagIds: [], icon: null, createdAt: "", updatedAt: "", sortOrder: 1, revision: 1, modifiedByDeviceId: "device-test" },
];

const accounts: AccountRecord[] = [
  { id: "a1", serviceId: "figma", label: "团队", username: "designer", password: "hidden-secret", identityCode: "", securityPhone: "13800138000", securityEmail: "security@example.com", notes: [{ id: "n1", title: "续费提醒", content: "年度订阅" }], visibleModules: ["username", "password", "identity", "securityPhone", "securityEmail", "security", "custom", "notes", "images"], sortOrder: 0, securityQuestions: [], customFields: [], images: [], passwordHistory: [], createdAt: "", updatedAt: "", revision: 1, modifiedByDeviceId: "device-test" },
];

const tags: Tag[] = [
  { id: "creative", name: "创意工具", color: "#000000", revision: 1, updatedAt: "", modifiedByDeviceId: "device-test" },
];

describe("filterServices", () => {
  it("includes descendants when a parent category is selected", () => {
    expect(filterServices(services, accounts, categories, [], "", "work", new Set()).map((item) => item.id)).toEqual(["figma"]);
  });

  it("searches account fields as part of its parent service", () => {
    expect(filterServices(services, accounts, categories, [], "年度订阅", "all", new Set()).map((item) => item.id)).toEqual(["figma"]);
    expect(filterServices(services, accounts, categories, [], "security@example.com", "all", new Set()).map((item) => item.id)).toEqual(["figma"]);
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

  it("reuses an index while preserving account order and descendant filtering", () => {
    const indexedAccounts = [
      { ...accounts[0], id: "late", label: "后命中", username: "shared-login", sortOrder: 10 },
      { ...accounts[0], id: "early", label: "先命中", username: "shared-login", sortOrder: 1 },
    ];
    const index = createServiceSearchIndex(indexedAccounts, categories, tags);
    const result = findIndexedServiceSearchResults(services, index, "shared-login", "work", new Set());

    expect(result).toHaveLength(1);
    expect(result[0].service.id).toBe("figma");
    expect(result[0].match).toMatchObject({ kind: "account", accountId: "early" });
  });

  it("preserves indexed category and tag match details", () => {
    const taggedServices = [{ ...services[0], tagIds: ["creative"] }];
    const index = createServiceSearchIndex(accounts, categories, tags);

    expect(findIndexedServiceSearchResults(taggedServices, index, "工作", "all", new Set())[0].match)
      .toMatchObject({ kind: "category", label: "分类", preview: "工作 / 设计" });
    expect(findIndexedServiceSearchResults(taggedServices, index, "创意", "all", new Set())[0].match)
      .toMatchObject({ kind: "tag", label: "标签", preview: "创意工具" });
  });
});

describe("indexed search at local vault scale", () => {
  it("keeps broad and deep searches responsive with 2,000 services and 6,000 accounts", () => {
    const largeCategories: Category[] = Array.from({ length: 100 }, (_, index) => ({
      id: `category-${index}`,
      name: `Category ${index}`,
      parentId: index > 0 && index % 10 !== 0 ? `category-${index - 1}` : null,
      color: "#123456",
      sortOrder: index,
      revision: 1,
      updatedAt: "",
      modifiedByDeviceId: "device-test",
    }));
    const largeTags: Tag[] = Array.from({ length: 100 }, (_, index) => ({
      id: `tag-${index}`,
      name: `Tag ${index}`,
      color: "#654321",
      revision: 1,
      updatedAt: "",
      modifiedByDeviceId: "device-test",
    }));
    const largeServices: ServiceRecord[] = Array.from({ length: 2_000 }, (_, index) => ({
      id: `service-${index}`,
      name: `Service ${index}`,
      url: `https://example.com/${index}`,
      categoryId: `category-${index % 100}`,
      tagIds: [`tag-${index % 100}`],
      icon: null,
      createdAt: "",
      sortOrder: index,
      revision: 1,
      updatedAt: "",
      modifiedByDeviceId: "device-test",
    }));
    const largeAccounts: AccountRecord[] = Array.from({ length: 6_000 }, (_, index) => ({
      id: `account-${index}`,
      serviceId: `service-${Math.floor(index / 3)}`,
      label: `Account ${index}`,
      username: `user-${index}@example.com`,
      password: `private-${index}`,
      identityCode: `identity-${index}`,
      notes: [{
        id: `note-${index}`,
        title: `Note ${index}`,
        content: index === 5_999 ? "deep-search-sentinel" : `Routine note ${index}`,
      }],
      visibleModules: ["username", "password", "identity", "notes"],
      sortOrder: index % 3,
      securityQuestions: [],
      customFields: [{ id: `field-${index}`, label: "License", value: `value-${index}`, multiline: false, copyable: true }],
      images: [],
      passwordHistory: [],
      createdAt: "",
      revision: 1,
      updatedAt: "",
      modifiedByDeviceId: "device-test",
    }));

    const startedAt = performance.now();
    const index = createServiceSearchIndex(largeAccounts, largeCategories, largeTags);
    const emptyResults = findIndexedServiceSearchResults(largeServices, index, "", "all", new Set());
    const serviceResults = findIndexedServiceSearchResults(largeServices, index, "Service 1999", "all", new Set());
    const noteResults = findIndexedServiceSearchResults(largeServices, index, "deep-search-sentinel", "all", new Set());
    const filteredResults = findIndexedServiceSearchResults(largeServices, index, "", "category-90", new Set(["tag-99"]));
    const duration = performance.now() - startedAt;

    expect(emptyResults).toHaveLength(2_000);
    expect(serviceResults[0].service.id).toBe("service-1999");
    expect(noteResults[0].match).toMatchObject({ kind: "note", accountId: "account-5999" });
    expect(filteredResults).toHaveLength(20);
    expect(filteredResults.at(-1)?.service.id).toBe("service-1999");
    expect(duration).toBeLessThan(2_000);
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
