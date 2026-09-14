import type {
  AppData,
  DeletionTombstone,
  RecordVersion,
  SyncEntityType,
} from "../types";

type VersionedRecord = RecordVersion & { id: string };

const entityKey = (entityType: SyncEntityType, entityId: string) => `${entityType}:${entityId}`;

function recordContent(record: VersionedRecord) {
  const { revision: _revision, updatedAt: _updatedAt, modifiedByDeviceId: _deviceId, ...content } = record;
  return content;
}

function recordsEqual(left: VersionedRecord, right: VersionedRecord) {
  return JSON.stringify(recordContent(left)) === JSON.stringify(recordContent(right));
}

function stampRecords<T extends VersionedRecord>(
  entityType: SyncEntityType,
  previous: T[],
  next: T[],
  previousTombstones: DeletionTombstone[],
  deviceId: string,
  timestamp: string,
) {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const deletedRevisionById = new Map(
    previousTombstones
      .filter((item) => item.entityType === entityType)
      .map((item) => [item.entityId, item.revision]),
  );
  let changed = false;
  const addedIds = new Set<string>();
  const records = next.map((item) => {
    const existing = previousById.get(item.id);
    if (!existing) {
      changed = true;
      addedIds.add(item.id);
      return {
        ...item,
        revision: (deletedRevisionById.get(item.id) ?? 0) + 1,
        updatedAt: timestamp,
        modifiedByDeviceId: deviceId,
      };
    }
    if (!recordsEqual(existing, item)) {
      changed = true;
      return {
        ...item,
        revision: existing.revision + 1,
        updatedAt: timestamp,
        modifiedByDeviceId: deviceId,
      };
    }
    return {
      ...item,
      revision: existing.revision,
      updatedAt: existing.updatedAt,
      modifiedByDeviceId: existing.modifiedByDeviceId,
    };
  });
  const nextIds = new Set(next.map((item) => item.id));
  const deleted = previous.filter((item) => !nextIds.has(item.id));
  if (deleted.length) changed = true;
  const tombstones: DeletionTombstone[] = deleted.map((item) => ({
    entityType,
    entityId: item.id,
    revision: item.revision + 1,
    deletedAt: timestamp,
    modifiedByDeviceId: deviceId,
  }));
  return { records, tombstones, changed, addedIds };
}

export function prepareLocalMutation(
  previous: AppData,
  next: AppData,
  deviceId: string,
  timestamp = new Date().toISOString(),
): AppData {
  if (!deviceId.trim()) throw new Error("本机设备编号不可用");

  const previousTombstones = previous.sync.tombstones;
  const categories = stampRecords("category", previous.categories, next.categories, previousTombstones, deviceId, timestamp);
  const tags = stampRecords("tag", previous.tags, next.tags, previousTombstones, deviceId, timestamp);
  const services = stampRecords("service", previous.services, next.services, previousTombstones, deviceId, timestamp);
  const accounts = stampRecords("account", previous.accounts, next.accounts, previousTombstones, deviceId, timestamp);
  const settingsChanged = JSON.stringify(previous.settings) !== JSON.stringify(next.settings);

  const replacements = new Map<string, DeletionTombstone>();
  for (const tombstone of [
    ...previous.sync.tombstones,
    ...categories.tombstones,
    ...tags.tombstones,
    ...services.tombstones,
    ...accounts.tombstones,
  ]) {
    const key = entityKey(tombstone.entityType, tombstone.entityId);
    const existing = replacements.get(key);
    if (!existing || tombstone.revision >= existing.revision) replacements.set(key, tombstone);
  }
  for (const [entityType, addedIds] of [
    ["category", categories.addedIds],
    ["tag", tags.addedIds],
    ["service", services.addedIds],
    ["account", accounts.addedIds],
  ] as const) {
    for (const id of addedIds) replacements.delete(entityKey(entityType, id));
  }

  const changed = settingsChanged
    || categories.changed
    || tags.changed
    || services.changed
    || accounts.changed;
  return {
    ...next,
    categories: categories.records,
    tags: tags.records,
    services: services.records,
    accounts: accounts.records,
    sync: {
      ...previous.sync,
      revision: changed ? previous.sync.revision + 1 : previous.sync.revision,
      settingsRevision: settingsChanged
        ? previous.sync.settingsRevision + 1
        : previous.sync.settingsRevision,
      settingsUpdatedAt: settingsChanged ? timestamp : previous.sync.settingsUpdatedAt,
      settingsModifiedByDeviceId: settingsChanged
        ? deviceId
        : previous.sync.settingsModifiedByDeviceId,
      tombstones: [...replacements.values()].sort((left, right) =>
        entityKey(left.entityType, left.entityId).localeCompare(entityKey(right.entityType, right.entityId))),
    },
  };
}
