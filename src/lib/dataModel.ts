import type {
  AccountDisplayModule,
  AccountNote,
  AccountRecord,
  AppData,
  Category,
  RecycleBinItem,
  ServiceRecord,
  SyncEntityType,
  Tag,
} from "../types";

export const CURRENT_DATA_VERSION = 6;

const LEGACY_DEVICE_ID = "device-legacy-migration";

function createPersistentId(prefix: string) {
  const randomId = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
}

const positiveRevision = (value: unknown, fallback: number) =>
  Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback;

const recordRevision = (value: unknown, fallback = 1) =>
  Number.isInteger(value) && Number(value) >= 1 ? Number(value) : fallback;

const nonEmptyString = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value : fallback;

function recordVersion(value: Record<string, unknown>, deviceId: string, timestamp: string) {
  return {
    revision: recordRevision(value.revision),
    updatedAt: nonEmptyString(value.updatedAt, timestamp),
    modifiedByDeviceId: nonEmptyString(value.modifiedByDeviceId, deviceId),
  };
}

export function createEmptyAppData(deviceId = LEGACY_DEVICE_ID, timestamp = new Date().toISOString()): AppData {
  return {
    version: CURRENT_DATA_VERSION,
    settings: { passwordTemplate: "", encryptImages: false },
    sync: {
      vaultId: createPersistentId("vault"),
      revision: 0,
      settingsRevision: 0,
      settingsUpdatedAt: timestamp,
      settingsModifiedByDeviceId: deviceId,
      tombstones: [],
    },
    categories: [],
    tags: [],
    services: [],
    accounts: [],
    recycleBin: [],
  };
}

export const ALL_ACCOUNT_MODULES: AccountDisplayModule[] = [
  "username",
  "password",
  "identity",
  "securityPhone",
  "securityEmail",
  "security",
  "custom",
  "notes",
  "images",
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asArray = <T>(value: unknown) => (Array.isArray(value) ? value as T[] : []);

function normalizeNotes(value: unknown, accountId: string): AccountNote[] {
  if (typeof value === "string") {
    return value.trim()
      ? [{ id: `note-${accountId}-legacy`, title: "账号备注", content: value }]
      : [];
  }
  return asArray<Partial<AccountNote>>(value).map((note, index) => ({
    id: typeof note.id === "string" ? note.id : `note-${accountId}-${index}`,
    title: typeof note.title === "string" ? note.title : "备注",
    content: typeof note.content === "string" ? note.content : "",
  }));
}

function normalizeModules(value: unknown): AccountDisplayModule[] {
  if (!Array.isArray(value)) return [...ALL_ACCOUNT_MODULES];
  const requested = new Set(value.filter((item): item is AccountDisplayModule =>
    typeof item === "string" && ALL_ACCOUNT_MODULES.includes(item as AccountDisplayModule)));
  return ALL_ACCOUNT_MODULES.filter((item) => requested.has(item));
}

function normalizeCategoryRecord(value: Partial<Category>, index: number, deviceId: string, timestamp: string): Category {
  return {
    ...value,
    id: String(value.id ?? `category-${index}`),
    name: String(value.name ?? "未命名分类"),
    parentId: typeof value.parentId === "string" ? value.parentId : null,
    color: typeof value.color === "string" ? value.color : "#3f6f8f",
    sortOrder: typeof value.sortOrder === "number" ? value.sortOrder : index,
    ...recordVersion(value as Record<string, unknown>, deviceId, timestamp),
  };
}

function normalizeTagRecord(value: Partial<Tag>, index: number, deviceId: string, timestamp: string): Tag {
  return {
    ...value,
    id: String(value.id ?? `tag-${index}`),
    name: String(value.name ?? "未命名标签"),
    color: typeof value.color === "string" ? value.color : "#6b7280",
    ...recordVersion(value as Record<string, unknown>, deviceId, timestamp),
  };
}

function normalizeServiceRecord(value: Partial<ServiceRecord>, index: number, deviceId: string, timestamp: string): ServiceRecord {
  return {
    ...value,
    id: String(value.id ?? `service-${index}`),
    name: String(value.name ?? "未命名分区"),
    url: String(value.url ?? ""),
    categoryId: typeof value.categoryId === "string" ? value.categoryId : null,
    tagIds: asArray<string>(value.tagIds),
    icon: value.icon ?? null,
    createdAt: String(value.createdAt ?? timestamp),
    sortOrder: typeof value.sortOrder === "number" ? value.sortOrder : index,
    ...recordVersion(value as Record<string, unknown>, deviceId, timestamp),
  };
}

function normalizeAccountRecord(
  value: Partial<AccountRecord> & { notes?: unknown },
  index: number,
  deviceId: string,
  timestamp: string,
): AccountRecord {
  const id = String(value.id ?? `account-${index}`);
  return {
    ...value,
    id,
    serviceId: String(value.serviceId ?? ""),
    label: String(value.label ?? "未命名账号"),
    username: String(value.username ?? ""),
    password: String(value.password ?? ""),
    identityCode: String(value.identityCode ?? ""),
    securityPhone: String(value.securityPhone ?? ""),
    securityEmail: String(value.securityEmail ?? ""),
    notes: normalizeNotes(value.notes, id),
    visibleModules: normalizeModules(value.visibleModules),
    sortOrder: typeof value.sortOrder === "number" ? value.sortOrder : index,
    securityQuestions: asArray(value.securityQuestions),
    customFields: asArray(value.customFields),
    images: asArray(value.images),
    passwordHistory: asArray(value.passwordHistory).slice(0, 3),
    createdAt: String(value.createdAt ?? timestamp),
    ...recordVersion(value as Record<string, unknown>, deviceId, timestamp),
  } as AccountRecord;
}

function normalizeRecycleBin(value: unknown, deviceId: string, timestamp: string): RecycleBinItem[] {
  return asArray<Record<string, unknown>>(value).flatMap<RecycleBinItem>((item, index) => {
    const id = nonEmptyString(item.id, `trash-${index}`);
    const deletedAt = nonEmptyString(item.deletedAt, timestamp);
    const label = nonEmptyString(item.label, "未命名条目");
    if (item.type === "category" && isObject(item.category)) {
      const category = normalizeCategoryRecord(item.category, index, deviceId, timestamp);
      return [{
        id,
        deletedAt,
        label,
        type: "category" as const,
        category,
        childCategoryIds: asArray<string>(item.childCategoryIds),
        serviceIds: asArray<string>(item.serviceIds),
      }];
    }
    if (item.type === "tag" && isObject(item.tag)) {
      return [{
        id,
        deletedAt,
        label,
        type: "tag" as const,
        tag: normalizeTagRecord(item.tag, index, deviceId, timestamp),
        serviceIds: asArray<string>(item.serviceIds),
      }];
    }
    if (item.type === "service" && isObject(item.service)) {
      return [{
        id,
        deletedAt,
        label,
        type: "service" as const,
        service: normalizeServiceRecord(item.service, index, deviceId, timestamp),
        accounts: asArray<Partial<AccountRecord> & { notes?: unknown }>(item.accounts)
          .map((account, accountIndex) => normalizeAccountRecord(account, accountIndex, deviceId, timestamp)),
      }];
    }
    if (item.type === "account" && isObject(item.account)) {
      return [{
        id,
        deletedAt,
        label,
        type: "account" as const,
        serviceName: nonEmptyString(item.serviceName, "未知分区"),
        account: normalizeAccountRecord(item.account, index, deviceId, timestamp),
      }];
    }
    return [];
  });
}

export function normalizeAppData(input: unknown, deviceId = LEGACY_DEVICE_ID): AppData {
  if (!isObject(input)) throw new Error("文件结构不正确");
  const timestamp = new Date().toISOString();
  const syncInput = isObject(input.sync) ? input.sync : {};
  const migrationDeviceId = nonEmptyString(syncInput.settingsModifiedByDeviceId, deviceId);
  const categories = asArray<Partial<Category>>(input.categories)
    .map((category, index) => normalizeCategoryRecord(category, index, migrationDeviceId, timestamp));
  const tags = asArray<Partial<Tag>>(input.tags)
    .map((tag, index) => normalizeTagRecord(tag, index, migrationDeviceId, timestamp));
  const services = asArray<Partial<ServiceRecord>>(input.services)
    .map((service, index) => normalizeServiceRecord(service, index, migrationDeviceId, timestamp));
  const accounts = asArray<Partial<AccountRecord> & { notes?: unknown }>(input.accounts)
    .map((account, index) => normalizeAccountRecord(account, index, migrationDeviceId, timestamp));
  const recycleBin = normalizeRecycleBin(input.recycleBin, migrationDeviceId, timestamp);

  if (!Array.isArray(input.tags)) throw new Error("文件结构不正确");
  const entityTypes = new Set<SyncEntityType>(["category", "tag", "service", "account"]);
  const tombstones = asArray<Record<string, unknown>>(syncInput.tombstones)
    .filter((item) => entityTypes.has(item.entityType as SyncEntityType) && typeof item.entityId === "string")
    .map((item) => ({
      entityType: item.entityType as SyncEntityType,
      entityId: String(item.entityId),
      revision: recordRevision(item.revision),
      deletedAt: nonEmptyString(item.deletedAt, timestamp),
      modifiedByDeviceId: nonEmptyString(item.modifiedByDeviceId, migrationDeviceId),
    }));
  const maxEntityRevision = Math.max(
    0,
    ...categories.map((item) => item.revision),
    ...tags.map((item) => item.revision),
    ...services.map((item) => item.revision),
    ...accounts.map((item) => item.revision),
    ...tombstones.map((item) => item.revision),
  );
  const settingsRevision = positiveRevision(syncInput.settingsRevision, isObject(input.settings) ? 1 : 0);
  return {
    version: CURRENT_DATA_VERSION,
    settings: {
      passwordTemplate: isObject(input.settings) && typeof input.settings.passwordTemplate === "string"
        ? input.settings.passwordTemplate
        : "",
      encryptImages: isObject(input.settings) && input.settings.encryptImages === true,
    },
    sync: {
      vaultId: nonEmptyString(syncInput.vaultId, createPersistentId("vault")),
      revision: Math.max(positiveRevision(syncInput.revision, maxEntityRevision), maxEntityRevision, settingsRevision),
      settingsRevision,
      settingsUpdatedAt: nonEmptyString(syncInput.settingsUpdatedAt, timestamp),
      settingsModifiedByDeviceId: migrationDeviceId,
      tombstones,
    },
    categories: sortByOrder(categories),
    tags,
    services: sortByOrder(services),
    accounts: sortByOrder(accounts),
    recycleBin: recycleBin.sort((left, right) => right.deletedAt.localeCompare(left.deletedAt)),
  };
}

export function sortByOrder<T extends { sortOrder: number }>(items: T[]) {
  return [...items].sort((left, right) => left.sortOrder - right.sortOrder);
}

export function withSortOrder<T>(items: T[]): Array<T & { sortOrder: number }> {
  return items.map((item, index) => ({ ...item, sortOrder: index }));
}

export function moveItem<T>(items: T[], sourceIndex: number, targetIndex: number) {
  if (sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0) return items;
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}
