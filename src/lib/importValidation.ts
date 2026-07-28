import type { AppData, PreparedImport, StoredImage, SyncEntityType } from "../types";
import { CURRENT_DATA_VERSION, normalizeAppData } from "./dataModel";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function requireRecordArray(root: Record<string, unknown>, key: keyof AppData, label: string) {
  const value = root[key];
  if (!Array.isArray(value) || value.some((item) => !isObject(item))) {
    throw new Error(`${label}清单格式不正确`);
  }
  return value as Record<string, unknown>[];
}

function validateIds(records: Record<string, unknown>[], label: string) {
  const ids = records.map((item) => typeof item.id === "string" ? item.id.trim() : "");
  if (ids.some((id) => !id)) throw new Error(`${label}中存在缺少编号的记录`);
  if (new Set(ids).size !== ids.length) throw new Error(`${label}中存在重复编号`);
}

function validateVersionedRecords(records: Record<string, unknown>[], label: string) {
  for (const record of records) {
    if (!Number.isSafeInteger(record.revision) || Number(record.revision) < 1) {
      throw new Error(`${label}中存在无效 revision`);
    }
    if (typeof record.updatedAt !== "string" || !record.updatedAt.trim()
      || typeof record.modifiedByDeviceId !== "string" || !record.modifiedByDeviceId.trim()) {
      throw new Error(`${label}中存在不完整的版本信息`);
    }
  }
}

function validateVersionFiveSync(
  root: Record<string, unknown>,
  recordGroups: Array<[SyncEntityType, Record<string, unknown>[]]>,
) {
  const sync = root.sync;
  if (!isObject(sync)) throw new Error("版本 5 备份缺少同步元数据");
  if (typeof sync.vaultId !== "string" || !sync.vaultId.trim()) throw new Error("同步 vault 编号无效");
  if (!Number.isSafeInteger(sync.revision) || Number(sync.revision) < 0) throw new Error("同步 revision 无效");
  if (!Number.isSafeInteger(sync.settingsRevision) || Number(sync.settingsRevision) < 0) {
    throw new Error("设置 revision 无效");
  }
  if (Number(sync.settingsRevision) > Number(sync.revision)) throw new Error("设置 revision 超过 vault revision");
  if (typeof sync.settingsUpdatedAt !== "string" || !sync.settingsUpdatedAt.trim()
    || typeof sync.settingsModifiedByDeviceId !== "string" || !sync.settingsModifiedByDeviceId.trim()) {
    throw new Error("设置版本信息不完整");
  }
  if (!Array.isArray(sync.tombstones) || sync.tombstones.some((item) => !isObject(item))) {
    throw new Error("删除墓碑清单格式不正确");
  }

  const entityTypes = new Set<SyncEntityType>(["category", "tag", "service", "account"]);
  if (recordGroups.some(([, records]) => records.some((record) => Number(record.revision) > Number(sync.revision)))) {
    throw new Error("记录 revision 超过 vault revision");
  }
  const liveKeys = new Set(recordGroups.flatMap(([type, records]) => records.map((record) => `${type}:${record.id}`)));
  const tombstoneKeys = new Set<string>();
  for (const item of sync.tombstones as Record<string, unknown>[]) {
    const entityType = item.entityType as SyncEntityType;
    const entityId = typeof item.entityId === "string" ? item.entityId.trim() : "";
    const key = `${entityType}:${entityId}`;
    if (!entityTypes.has(entityType) || !entityId
      || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1
      || typeof item.deletedAt !== "string" || !item.deletedAt.trim()
      || typeof item.modifiedByDeviceId !== "string" || !item.modifiedByDeviceId.trim()) {
      throw new Error("删除墓碑中存在无效记录");
    }
    if (Number(item.revision) > Number(sync.revision)) throw new Error("删除墓碑 revision 超过 vault revision");
    if (tombstoneKeys.has(key)) throw new Error("删除墓碑中存在重复实体");
    if (liveKeys.has(key)) throw new Error("同一实体不能同时存在于记录和删除墓碑中");
    tombstoneKeys.add(key);
  }
}

function validateReferences(data: AppData) {
  const categoryIds = new Set(data.categories.map((item) => item.id));
  const tagIds = new Set(data.tags.map((item) => item.id));
  const serviceIds = new Set(data.services.map((item) => item.id));

  for (const category of data.categories) {
    if (category.parentId && (!categoryIds.has(category.parentId) || category.parentId === category.id)) {
      throw new Error(`分类“${category.name}”的上级分类无效`);
    }
  }
  for (const category of data.categories) {
    const visited = new Set<string>([category.id]);
    let parentId = category.parentId;
    while (parentId) {
      if (visited.has(parentId)) throw new Error(`分类“${category.name}”存在循环层级`);
      visited.add(parentId);
      parentId = data.categories.find((item) => item.id === parentId)?.parentId || null;
    }
  }
  for (const service of data.services) {
    if (service.categoryId && !categoryIds.has(service.categoryId)) {
      throw new Error(`分区“${service.name}”引用了不存在的分类`);
    }
    if (service.tagIds.some((id) => !tagIds.has(id))) {
      throw new Error(`分区“${service.name}”引用了不存在的标签`);
    }
  }
  for (const account of data.accounts) {
    if (!serviceIds.has(account.serviceId)) {
      throw new Error(`账号“${account.label}”引用了不存在的分区`);
    }
  }
}

function sanitizePortableImage(value: unknown, label: string): StoredImage {
  if (!isObject(value)) throw new Error(`${label}格式不正确`);
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const dataUrl = typeof value.dataUrl === "string" ? value.dataUrl : "";
  if (!id || !name || !dataUrl) throw new Error(`${label}缺少可移植的图片数据`);
  return {
    id,
    name,
    dataUrl,
    sourceUrl: typeof value.sourceUrl === "string" ? value.sourceUrl : undefined,
  };
}

function sanitizeImportedMedia(data: AppData): AppData {
  return {
    ...data,
    services: data.services.map((service) => ({
      ...service,
      icon: service.icon ? sanitizePortableImage(service.icon, `分区“${service.name}”的图标`) : null,
    })),
    accounts: data.accounts.map((account) => ({
      ...account,
      images: account.images.map((image, index) => sanitizePortableImage(image, `账号“${account.label}”的第 ${index + 1} 张图片`)),
    })),
  };
}

export function prepareImportData(input: unknown, metadata: Pick<PreparedImport, "fileName" | "sourceType" | "createdAt">): PreparedImport {
  if (!isObject(input)) throw new Error("备份数据不是有效对象");
  const sourceVersion = input.version;
  if (!Number.isInteger(sourceVersion) || Number(sourceVersion) < 1) {
    throw new Error("备份缺少有效的数据版本");
  }
  if (Number(sourceVersion) > CURRENT_DATA_VERSION) {
    throw new Error(`备份数据版本 ${sourceVersion} 高于当前支持的版本 ${CURRENT_DATA_VERSION}`);
  }

  const categories = requireRecordArray(input, "categories", "分类");
  const tags = requireRecordArray(input, "tags", "标签");
  const services = requireRecordArray(input, "services", "分区");
  const accounts = requireRecordArray(input, "accounts", "账号");
  validateIds(categories, "分类");
  validateIds(tags, "标签");
  validateIds(services, "分区");
  validateIds(accounts, "账号");
  if (Number(sourceVersion) === CURRENT_DATA_VERSION && metadata.sourceType !== "excel") {
    validateVersionedRecords(categories, "分类");
    validateVersionedRecords(tags, "标签");
    validateVersionedRecords(services, "分区");
    validateVersionedRecords(accounts, "账号");
    validateVersionFiveSync(input, [
      ["category", categories],
      ["tag", tags],
      ["service", services],
      ["account", accounts],
    ]);
  }

  const data = sanitizeImportedMedia(normalizeAppData(input));
  validateReferences(data);
  const images = data.services.filter((service) => service.icon).length
    + data.accounts.reduce((total, account) => total + account.images.length, 0);

  return {
    ...metadata,
    sourceVersion: Number(sourceVersion),
    data,
    counts: {
      categories: data.categories.length,
      tags: data.tags.length,
      services: data.services.length,
      accounts: data.accounts.length,
      images,
    },
  };
}
