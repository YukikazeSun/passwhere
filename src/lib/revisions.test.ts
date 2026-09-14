import { describe, expect, it } from "vitest";
import type { AccountRecord, Category, ServiceRecord } from "../types";
import { createEmptyAppData } from "./dataModel";
import { prepareLocalMutation } from "./revisions";

const deviceId = "device-test";
const firstTime = "2026-07-28T08:00:00.000Z";
const secondTime = "2026-07-28T09:00:00.000Z";

function category(name = "工作"): Category {
  return {
    id: "category-work",
    name,
    parentId: null,
    color: "#123456",
    sortOrder: 0,
    revision: 0,
    updatedAt: "",
    modifiedByDeviceId: "",
  };
}

describe("prepareLocalMutation", () => {
  it("stamps additions and changes without advancing on a no-op save", () => {
    const empty = createEmptyAppData(deviceId, firstTime);
    const added = prepareLocalMutation(empty, { ...empty, categories: [category()] }, deviceId, firstTime);
    expect(added.sync.revision).toBe(1);
    expect(added.categories[0]).toMatchObject({ revision: 1, updatedAt: firstTime, modifiedByDeviceId: deviceId });

    const unchanged = prepareLocalMutation(added, structuredClone(added), deviceId, secondTime);
    expect(unchanged.sync.revision).toBe(1);
    expect(unchanged.categories[0].updatedAt).toBe(firstTime);

    const renamed = prepareLocalMutation(unchanged, {
      ...unchanged,
      categories: [{ ...unchanged.categories[0], name: "项目" }],
    }, deviceId, secondTime);
    expect(renamed.sync.revision).toBe(2);
    expect(renamed.categories[0]).toMatchObject({ revision: 2, updatedAt: secondTime });
  });

  it("creates minimal deletion tombstones and removes them if an id is recreated", () => {
    const empty = createEmptyAppData(deviceId, firstTime);
    const added = prepareLocalMutation(empty, { ...empty, categories: [category("敏感分类名")] }, deviceId, firstTime);
    const deleted = prepareLocalMutation(added, { ...added, categories: [] }, deviceId, secondTime);

    expect(deleted.sync.tombstones).toEqual([{
      entityType: "category",
      entityId: "category-work",
      revision: 2,
      deletedAt: secondTime,
      modifiedByDeviceId: deviceId,
    }]);
    expect(JSON.stringify(deleted.sync.tombstones)).not.toContain("敏感分类名");

    const recreated = prepareLocalMutation(deleted, { ...deleted, categories: [category("重新创建")] }, deviceId, secondTime);
    expect(recreated.sync.tombstones).toEqual([]);
    expect(recreated.categories[0].revision).toBe(3);
  });

  it("tracks cascading service and account deletions independently", () => {
    const empty = createEmptyAppData(deviceId, firstTime);
    const service: ServiceRecord = {
      id: "service", name: "站点", url: "", categoryId: null, tagIds: [], icon: null,
      createdAt: firstTime, sortOrder: 0, revision: 0, updatedAt: "", modifiedByDeviceId: "",
    };
    const account: AccountRecord = {
      id: "account", serviceId: service.id, label: "主账号", username: "secret-user", password: "secret-password",
      identityCode: "", notes: [], visibleModules: [], sortOrder: 0, securityQuestions: [], customFields: [],
      images: [], passwordHistory: [], createdAt: firstTime, revision: 0, updatedAt: "", modifiedByDeviceId: "",
    };
    const added = prepareLocalMutation(empty, { ...empty, services: [service], accounts: [account] }, deviceId, firstTime);
    const deleted = prepareLocalMutation(added, { ...added, services: [], accounts: [] }, deviceId, secondTime);

    expect(deleted.sync.tombstones.map((item) => item.entityType)).toEqual(["account", "service"]);
    expect(JSON.stringify(deleted.sync.tombstones)).not.toContain("secret");
  });

  it("versions settings as part of the shared vault state", () => {
    const empty = createEmptyAppData(deviceId, firstTime);
    const changed = prepareLocalMutation(empty, {
      ...empty,
      settings: { ...empty.settings, encryptImages: true },
    }, deviceId, secondTime);
    expect(changed.sync).toMatchObject({
      revision: 1,
      settingsRevision: 1,
      settingsUpdatedAt: secondTime,
      settingsModifiedByDeviceId: deviceId,
    });
  });

  it("detects deletions in a large record set without changing tombstone semantics", () => {
    const empty = createEmptyAppData(deviceId, firstTime);
    const categories = Array.from({ length: 5_000 }, (_, index) => ({
      ...category(`Category ${index}`),
      id: `category-${index}`,
      sortOrder: index,
    }));
    const added = prepareLocalMutation(empty, { ...empty, categories }, deviceId, firstTime);
    const removedIds = new Set(["category-3", "category-1337", "category-4999"]);
    const kept = added.categories.filter((item) => !removedIds.has(item.id));

    const deleted = prepareLocalMutation(
      added,
      { ...added, categories: kept },
      deviceId,
      secondTime,
    );

    expect(deleted.categories).toHaveLength(4_997);
    expect(deleted.sync.tombstones.map((item) => item.entityId)).toEqual([
      "category-1337",
      "category-3",
      "category-4999",
    ]);
    expect(deleted.sync.tombstones.every((item) => item.revision === 2)).toBe(true);
  });
});
