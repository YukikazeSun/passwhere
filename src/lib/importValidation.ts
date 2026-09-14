import type { AppData, PreparedImport, StoredImage, SyncEntityType } from "../types";
import { CURRENT_DATA_VERSION, normalizeAppData } from "./dataModel";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

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

function requireStringFields(record: Record<string, unknown>, fields: string[], label: string) {
  if (fields.some((field) => typeof record[field] !== "string")) {
    throw new Error(`${label}包含类型不正确的文字字段`);
  }
}

function validateNestedRecords(
  account: Record<string, unknown>,
  key: string,
  label: string,
  validate: (record: Record<string, unknown>, itemLabel: string) => void,
) {
  const value = account[key];
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => !isObject(item))) {
    throw new Error(`${label}清单格式不正确`);
  }
  validateIds(value as Record<string, unknown>[], label);
  value.forEach((record, index) => validate(record as Record<string, unknown>, `${label}第 ${index + 1} 项`));
}

function validateAccountDetails(accounts: Record<string, unknown>[]) {
  for (const account of accounts) {
    const accountLabel = typeof account.label === "string" && account.label.trim() ? account.label : "未命名账号";
    validateNestedRecords(account, "securityQuestions", `账号“${accountLabel}”的密保问题`, (record, label) => {
      requireStringFields(record, ["id", "question", "answer"], label);
    });
    validateNestedRecords(account, "customFields", `账号“${accountLabel}”的自定义字段`, (record, label) => {
      requireStringFields(record, ["id", "label", "value"], label);
      if (typeof record.multiline !== "boolean" || typeof record.copyable !== "boolean") {
        throw new Error(`${label}包含类型不正确的显示选项`);
      }
    });
    validateNestedRecords(account, "passwordHistory", `账号“${accountLabel}”的历史密码`, (record, label) => {
      requireStringFields(record, ["id", "password", "changedAt"], label);
    });
    if (account.notes !== undefined && typeof account.notes !== "string") {
      validateNestedRecords(account, "notes", `账号“${accountLabel}”的备注`, (record, label) => {
        requireStringFields(record, ["id", "title", "content"], label);
      });
    }
    if (account.visibleModules !== undefined && (!Array.isArray(account.visibleModules)
      || account.visibleModules.some((module) => typeof module !== "string"))) {
      throw new Error(`账号“${accountLabel}”的显示模块格式不正确`);
    }
    if ((account.securityPhone !== undefined && typeof account.securityPhone !== "string")
      || (account.securityEmail !== undefined && typeof account.securityEmail !== "string")) {
      throw new Error(`账号“${accountLabel}”的密保联系方式格式不正确`);
    }
  }
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

function requireNestedRecord(root: Record<string, unknown>, key: string, label: string) {
  const value = root[key];
  if (!isObject(value)) throw new Error(`${label}格式不正确`);
  return value;
}

function validateStringIdList(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label}格式不正确`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label}中存在重复编号`);
}

function validateRecycleBin(root: Record<string, unknown>) {
  const items = requireRecordArray(root, "recycleBin", "回收站");
  validateIds(items, "回收站");
  const entityTypes = new Set<SyncEntityType>(["category", "tag", "service", "account"]);
  for (const item of items) {
    if (!entityTypes.has(item.type as SyncEntityType)
      || typeof item.label !== "string" || !item.label.trim()
      || typeof item.deletedAt !== "string" || !item.deletedAt.trim()) {
      throw new Error("回收站中存在不完整的条目");
    }
    if (item.type === "category") {
      const category = requireNestedRecord(item, "category", "回收站分类快照");
      validateIds([category], "回收站分类快照");
      validateVersionedRecords([category], "回收站分类快照");
      validateStringIdList(item.childCategoryIds, "回收站子分类引用");
      validateStringIdList(item.serviceIds, "回收站分区引用");
    } else if (item.type === "tag") {
      const tag = requireNestedRecord(item, "tag", "回收站标签快照");
      validateIds([tag], "回收站标签快照");
      validateVersionedRecords([tag], "回收站标签快照");
      validateStringIdList(item.serviceIds, "回收站标签引用");
    } else if (item.type === "service") {
      const service = requireNestedRecord(item, "service", "回收站分区快照");
      validateIds([service], "回收站分区快照");
      validateVersionedRecords([service], "回收站分区快照");
      if (!Array.isArray(item.accounts) || item.accounts.some((account) => !isObject(account))) {
        throw new Error("回收站账号快照清单格式不正确");
      }
      const accounts = item.accounts as Record<string, unknown>[];
      validateIds(accounts, "回收站账号快照");
      validateAccountDetails(accounts);
      validateVersionedRecords(accounts, "回收站账号快照");
    } else {
      if (typeof item.serviceName !== "string" || !item.serviceName.trim()) {
        throw new Error("回收站账号缺少所属分区名称");
      }
      const account = requireNestedRecord(item, "account", "回收站账号快照");
      validateIds([account], "回收站账号快照");
      validateAccountDetails([account]);
      validateVersionedRecords([account], "回收站账号快照");
    }
  }
}

function validateReferences(data: AppData) {
  const categoryIds = new Set(data.categories.map((item) => item.id));
  const categoryById = new Map(data.categories.map((item) => [item.id, item]));
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
      parentId = categoryById.get(parentId)?.parentId || null;
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
  validatePortableImageData(dataUrl, label);
  return {
    id,
    name,
    dataUrl,
    sourceUrl: typeof value.sourceUrl === "string" ? value.sourceUrl : undefined,
  };
}

function validatePortableImageData(dataUrl: string, label: string) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/s.exec(dataUrl);
  if (!match) throw new Error(`${label}的数据格式无效`);
  const mime = match[1].toLowerCase();
  if (!IMAGE_MIME_TYPES.has(mime)) throw new Error(`${label}的图片格式不受支持`);
  let decoded: string;
  try {
    decoded = atob(match[2]);
  } catch {
    throw new Error(`${label}的 Base64 数据损坏`);
  }
  if (decoded.length > MAX_IMAGE_BYTES) throw new Error(`${label}超过 15 MB 限制`);
  const startsWith = (...bytes: number[]) => bytes.every((byte, index) => decoded.charCodeAt(index) === byte);
  const ascii = (start: number, value: string) => [...value].every((character, index) => decoded[start + index] === character);
  const valid = mime === "image/png" ? startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    : mime === "image/jpeg" ? startsWith(0xff, 0xd8, 0xff)
      : mime === "image/webp" ? ascii(0, "RIFF") && ascii(8, "WEBP")
        : mime === "image/gif" ? ascii(0, "GIF87a") || ascii(0, "GIF89a")
          : mime === "image/bmp" ? ascii(0, "BM")
            : startsWith(0, 0, 1, 0);
  if (!valid) throw new Error(`${label}的内容损坏或与格式不匹配`);
}

function sanitizeImportedMedia(data: AppData): AppData {
  const sanitizeService = (service: AppData["services"][number]) => ({
    ...service,
    icon: service.icon ? sanitizePortableImage(service.icon, `分区“${service.name}”的图标`) : null,
  });
  const sanitizeAccount = (account: AppData["accounts"][number]) => ({
    ...account,
    images: account.images.map((image, index) => sanitizePortableImage(image, `账号“${account.label}”的第 ${index + 1} 张图片`)),
  });
  return {
    ...data,
    services: data.services.map(sanitizeService),
    accounts: data.accounts.map(sanitizeAccount),
    recycleBin: data.recycleBin.map((item) => item.type === "service"
      ? { ...item, service: sanitizeService(item.service), accounts: item.accounts.map(sanitizeAccount) }
      : item.type === "account"
        ? { ...item, account: sanitizeAccount(item.account) }
        : item),
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
  validateAccountDetails(accounts);
  if (Number(sourceVersion) >= 5 && metadata.sourceType !== "excel") {
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
    if (Number(sourceVersion) >= 6) validateRecycleBin(input);
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
