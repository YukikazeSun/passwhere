import { describe, expect, it } from "vitest";
import type { AccountRecord, Category, ServiceRecord, Tag } from "../types";
import { createEmptyAppData } from "./dataModel";
import { prepareLocalMutation } from "./revisions";
import {
  emptyRecycleBin,
  permanentlyDeleteRecycleBinItem,
  recycleAccounts,
  recycleCategory,
  recycleService,
  recycleTags,
  restoreRecycleBinItem,
} from "./recycleBin";

const createdAt = "2026-07-30T08:00:00.000Z";
const deletedAt = "2026-07-30T09:00:00.000Z";
const restoredAt = "2026-07-30T10:00:00.000Z";
const version = { revision: 1, updatedAt: createdAt, modifiedByDeviceId: "device-a" };

const category = (id: string, parentId: string | null = null): Category => ({
  id,
  name: id,
  parentId,
  color: "#336699",
  sortOrder: 0,
  ...version,
});

const tag = (id: string): Tag => ({ id, name: id, color: "#663399", ...version });

const service = (id: string, categoryId: string | null = null, tagIds: string[] = []): ServiceRecord => ({
  id,
  name: id,
  url: "https://example.com",
  categoryId,
  tagIds,
  icon: null,
  createdAt,
  sortOrder: 0,
  ...version,
});

const account = (id: string, serviceId: string): AccountRecord => ({
  id,
  serviceId,
  label: id,
  username: "user",
  password: "secret",
  identityCode: "",
  notes: [],
  visibleModules: ["username", "password"],
  sortOrder: 0,
  securityQuestions: [],
  customFields: [],
  images: [],
  passwordHistory: [],
  createdAt,
  ...version,
});

describe("recycle bin", () => {
  it("restores a service and all accounts while continuing tombstone revisions", () => {
    const initial = {
      ...createEmptyAppData("device-a", createdAt),
      categories: [category("category-a")],
      tags: [tag("tag-a")],
      services: [service("service-a", "category-a", ["tag-a"])],
      accounts: [account("account-a", "service-a"), account("account-b", "service-a")],
    };
    const deletedDraft = recycleService(initial, "service-a", "trash-service", deletedAt);
    const deleted = prepareLocalMutation(initial, deletedDraft, "device-a", deletedAt);

    expect(deleted.services).toEqual([]);
    expect(deleted.accounts).toEqual([]);
    expect(deleted.recycleBin[0]).toMatchObject({ type: "service", label: "service-a" });
    expect(deleted.sync.tombstones.map((item) => `${item.entityType}:${item.entityId}`)).toEqual([
      "account:account-a",
      "account:account-b",
      "service:service-a",
    ]);

    const restoredDraft = restoreRecycleBinItem(deleted, "trash-service");
    expect(restoredDraft.status).toBe("restored");
    if (restoredDraft.status !== "restored") return;
    const restored = prepareLocalMutation(deleted, restoredDraft.data, "device-a", restoredAt);
    expect(restored.services[0]).toMatchObject({ id: "service-a", revision: 3 });
    expect(restored.accounts.map((item) => [item.id, item.revision])).toEqual([
      ["account-a", 3],
      ["account-b", 3],
    ]);
    expect(restored.sync.tombstones).toEqual([]);
    expect(restored.recycleBin).toEqual([]);
  });

  it("restores category links only when they were not moved elsewhere afterwards", () => {
    const initial = {
      ...createEmptyAppData("device-a", createdAt),
      categories: [category("root"), category("deleted", "root"), category("child", "deleted"), category("other")],
      services: [service("service-a", "deleted"), service("service-b", "deleted")],
    };
    const deleted = recycleCategory(initial, "deleted", "trash-category", deletedAt);
    const changedAfterDelete = {
      ...deleted,
      categories: deleted.categories.map((item) => item.id === "child" ? { ...item, parentId: "other" } : item),
      services: deleted.services.map((item) => item.id === "service-b" ? { ...item, categoryId: "other" } : item),
    };
    const result = restoreRecycleBinItem(changedAfterDelete, "trash-category");
    expect(result.status).toBe("restored");
    if (result.status !== "restored") return;
    expect(result.data.categories.find((item) => item.id === "deleted")?.parentId).toBe("root");
    expect(result.data.categories.find((item) => item.id === "child")?.parentId).toBe("other");
    expect(result.data.services.find((item) => item.id === "service-a")?.categoryId).toBe("deleted");
    expect(result.data.services.find((item) => item.id === "service-b")?.categoryId).toBe("other");
  });

  it("restores deleted tags and their surviving service references", () => {
    const initial = {
      ...createEmptyAppData("device-a", createdAt),
      tags: [tag("tag-a")],
      services: [service("service-a", null, ["tag-a"])],
    };
    let nextId = 0;
    const recycled = recycleTags(initial, initial.tags, () => `trash-${++nextId}`, deletedAt);
    const removed = {
      ...recycled,
      tags: [],
      services: recycled.services.map((item) => ({ ...item, tagIds: [] })),
    };
    const result = restoreRecycleBinItem(removed, "trash-1");
    expect(result.status).toBe("restored");
    if (result.status !== "restored") return;
    expect(result.data.tags.map((item) => item.id)).toEqual(["tag-a"]);
    expect(result.data.services[0].tagIds).toEqual(["tag-a"]);
  });

  it("blocks account restore until its parent service exists", () => {
    const initial = {
      ...createEmptyAppData("device-a", createdAt),
      accounts: [account("account-a", "service-a")],
    };
    const recycled = recycleAccounts(initial, initial.accounts, "Service A", () => "trash-account", deletedAt);
    const removed = { ...recycled, accounts: [] };
    expect(restoreRecycleBinItem(removed, "trash-account")).toEqual({
      status: "blocked",
      reason: "所属分区不存在，请先恢复该分区",
    });
  });

  it("permanently deletes individual items or empties the recycle bin", () => {
    const initial = {
      ...createEmptyAppData("device-a", createdAt),
      services: [service("service-a"), service("service-b")],
    };
    const first = recycleService(initial, "service-a", "trash-a", deletedAt);
    const second = recycleService(first, "service-b", "trash-b", deletedAt);
    expect(permanentlyDeleteRecycleBinItem(second, "trash-a").recycleBin.map((item) => item.id)).toEqual(["trash-b"]);
    expect(emptyRecycleBin(second).recycleBin).toEqual([]);
  });
});
