import type {
  AccountDisplayModule,
  AccountNote,
  AccountRecord,
  AppData,
  Category,
  ServiceRecord,
  SyncEntityType,
  Tag,
} from "../types";

export const CURRENT_DATA_VERSION = 5;

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
  };
}

export const ALL_ACCOUNT_MODULES: AccountDisplayModule[] = [
  "username",
  "password",
  "identity",
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

export function normalizeAppData(input: unknown, deviceId = LEGACY_DEVICE_ID): AppData {
  if (!isObject(input)) throw new Error("文件结构不正确");
  const timestamp = new Date().toISOString();
  const syncInput = isObject(input.sync) ? input.sync : {};
  const migrationDeviceId = nonEmptyString(syncInput.settingsModifiedByDeviceId, deviceId);
  const categories = asArray<Partial<Category>>(input.categories).map((category, index) => ({
    ...category,
    id: String(category.id ?? `category-${index}`),
    name: String(category.name ?? "未命名分类"),
    parentId: typeof category.parentId === "string" ? category.parentId : null,
    color: typeof category.color === "string" ? category.color : "#3f6f8f",
    sortOrder: typeof category.sortOrder === "number" ? category.sortOrder : index,
    ...recordVersion(category as Record<string, unknown>, migrationDeviceId, timestamp),
  })) as Category[];
  const tags = asArray<Partial<Tag>>(input.tags).map((tag, index) => ({
    ...tag,
    id: String(tag.id ?? `tag-${index}`),
    name: String(tag.name ?? "未命名标签"),
    color: typeof tag.color === "string" ? tag.color : "#6b7280",
    ...recordVersion(tag as Record<string, unknown>, migrationDeviceId, timestamp),
  })) as Tag[];
  const services = asArray<Partial<ServiceRecord>>(input.services).map((service, index) => ({
    ...service,
    id: String(service.id ?? `service-${index}`),
    name: String(service.name ?? "未命名分区"),
    url: String(service.url ?? ""),
    categoryId: typeof service.categoryId === "string" ? service.categoryId : null,
    tagIds: asArray<string>(service.tagIds),
    icon: service.icon ?? null,
    createdAt: String(service.createdAt ?? new Date().toISOString()),
    sortOrder: typeof service.sortOrder === "number" ? service.sortOrder : index,
    ...recordVersion(service as Record<string, unknown>, migrationDeviceId, timestamp),
  })) as ServiceRecord[];
  const accounts = asArray<Partial<AccountRecord> & { notes?: unknown }>(input.accounts).map((account, index) => {
    const id = String(account.id ?? `account-${index}`);
    return {
      ...account,
      id,
      serviceId: String(account.serviceId ?? ""),
      label: String(account.label ?? "未命名账号"),
      username: String(account.username ?? ""),
      password: String(account.password ?? ""),
      identityCode: String(account.identityCode ?? ""),
      notes: normalizeNotes(account.notes, id),
      visibleModules: normalizeModules(account.visibleModules),
      sortOrder: typeof account.sortOrder === "number" ? account.sortOrder : index,
      securityQuestions: asArray(account.securityQuestions),
      customFields: asArray(account.customFields),
      images: asArray(account.images),
      passwordHistory: asArray(account.passwordHistory).slice(0, 3),
      createdAt: String(account.createdAt ?? new Date().toISOString()),
      ...recordVersion(account as Record<string, unknown>, migrationDeviceId, timestamp),
    } as AccountRecord;
  });

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
