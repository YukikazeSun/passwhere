import type {
  AccountRecord,
  AppData,
  Id,
  RecycleBinItem,
  RecycledAccountItem,
  RecycledCategoryItem,
  RecycledServiceItem,
  RecycledTagItem,
  SyncEntityType,
  Tag,
} from "../types";

export const RECYCLE_BIN_TYPE_LABEL: Record<SyncEntityType, string> = {
  category: "分类",
  tag: "标签",
  service: "分区",
  account: "账号",
};

export type RestoreRecycleBinResult =
  | { status: "restored"; data: AppData; item: RecycleBinItem }
  | { status: "blocked"; reason: string };

function prependItems(data: AppData, items: RecycleBinItem[]): AppData {
  return items.length ? { ...data, recycleBin: [...items, ...data.recycleBin] } : data;
}

export function recycleCategory(
  data: AppData,
  categoryId: Id,
  itemId: Id,
  deletedAt: string,
): AppData {
  const category = data.categories.find((item) => item.id === categoryId);
  if (!category) return data;
  const childCategoryIds = data.categories
    .filter((item) => item.parentId === categoryId)
    .map((item) => item.id);
  const serviceIds = data.services
    .filter((item) => item.categoryId === categoryId)
    .map((item) => item.id);
  const recycled: RecycledCategoryItem = {
    id: itemId,
    deletedAt,
    type: "category",
    label: category.name,
    category,
    childCategoryIds,
    serviceIds,
  };
  return prependItems({
    ...data,
    categories: data.categories
      .filter((item) => item.id !== categoryId)
      .map((item) => item.parentId === categoryId ? { ...item, parentId: category.parentId } : item),
    services: data.services.map((item) => item.categoryId === categoryId
      ? { ...item, categoryId: category.parentId }
      : item),
  }, [recycled]);
}

export function recycleService(
  data: AppData,
  serviceId: Id,
  itemId: Id,
  deletedAt: string,
): AppData {
  const service = data.services.find((item) => item.id === serviceId);
  if (!service) return data;
  const accounts = data.accounts.filter((account) => account.serviceId === serviceId);
  const recycled: RecycledServiceItem = {
    id: itemId,
    deletedAt,
    type: "service",
    label: service.name,
    service,
    accounts,
  };
  return prependItems({
    ...data,
    services: data.services.filter((item) => item.id !== serviceId),
    accounts: data.accounts.filter((account) => account.serviceId !== serviceId),
  }, [recycled]);
}

export function recycleAccounts(
  data: AppData,
  accounts: AccountRecord[],
  serviceName: string,
  createItemId: () => Id,
  deletedAt: string,
): AppData {
  const recycled: RecycledAccountItem[] = accounts.map((account) => ({
    id: createItemId(),
    deletedAt,
    type: "account",
    label: account.label,
    serviceName,
    account,
  }));
  return prependItems(data, recycled);
}

export function recycleTags(
  data: AppData,
  tags: Tag[],
  createItemId: () => Id,
  deletedAt: string,
): AppData {
  const recycled: RecycledTagItem[] = tags.map((tag) => ({
    id: createItemId(),
    deletedAt,
    type: "tag",
    label: tag.name,
    tag,
    serviceIds: data.services.filter((service) => service.tagIds.includes(tag.id)).map((service) => service.id),
  }));
  return prependItems(data, recycled);
}

function restoreCategory(data: AppData, item: RecycledCategoryItem): RestoreRecycleBinResult {
  if (data.categories.some((category) => category.id === item.category.id)) {
    return { status: "blocked", reason: "已有相同编号的分类，无法覆盖恢复" };
  }
  const categoryIds = new Set(data.categories.map((category) => category.id));
  const parentId = item.category.parentId && categoryIds.has(item.category.parentId)
    ? item.category.parentId
    : null;
  const childIds = new Set(item.childCategoryIds);
  const serviceIds = new Set(item.serviceIds);
  return {
    status: "restored",
    item,
    data: {
      ...data,
      categories: [
        ...data.categories.map((category) => childIds.has(category.id) && category.parentId === parentId
          ? { ...category, parentId: item.category.id }
          : category),
        { ...item.category, parentId },
      ],
      services: data.services.map((service) => serviceIds.has(service.id) && service.categoryId === parentId
        ? { ...service, categoryId: item.category.id }
        : service),
      recycleBin: data.recycleBin.filter((entry) => entry.id !== item.id),
    },
  };
}

function restoreTag(data: AppData, item: RecycledTagItem): RestoreRecycleBinResult {
  if (data.tags.some((tag) => tag.id === item.tag.id)) {
    return { status: "blocked", reason: "已有相同编号的标签，无法覆盖恢复" };
  }
  const serviceIds = new Set(item.serviceIds);
  return {
    status: "restored",
    item,
    data: {
      ...data,
      tags: [...data.tags, item.tag],
      services: data.services.map((service) => serviceIds.has(service.id) && !service.tagIds.includes(item.tag.id)
        ? { ...service, tagIds: [...service.tagIds, item.tag.id] }
        : service),
      recycleBin: data.recycleBin.filter((entry) => entry.id !== item.id),
    },
  };
}

function restoreService(data: AppData, item: RecycledServiceItem): RestoreRecycleBinResult {
  if (data.services.some((service) => service.id === item.service.id)) {
    return { status: "blocked", reason: "已有相同编号的分区，无法覆盖恢复" };
  }
  const accountIds = new Set(data.accounts.map((account) => account.id));
  if (item.accounts.some((account) => accountIds.has(account.id))) {
    return { status: "blocked", reason: "分区中的账号编号已被占用，无法完整恢复" };
  }
  const categoryIds = new Set(data.categories.map((category) => category.id));
  const tagIds = new Set(data.tags.map((tag) => tag.id));
  const service = {
    ...item.service,
    categoryId: item.service.categoryId && categoryIds.has(item.service.categoryId)
      ? item.service.categoryId
      : null,
    tagIds: item.service.tagIds.filter((id) => tagIds.has(id)),
  };
  return {
    status: "restored",
    item,
    data: {
      ...data,
      services: [...data.services, service],
      accounts: [...data.accounts, ...item.accounts],
      recycleBin: data.recycleBin.filter((entry) => entry.id !== item.id),
    },
  };
}

function restoreAccount(data: AppData, item: RecycledAccountItem): RestoreRecycleBinResult {
  if (!data.services.some((service) => service.id === item.account.serviceId)) {
    return { status: "blocked", reason: "所属分区不存在，请先恢复该分区" };
  }
  if (data.accounts.some((account) => account.id === item.account.id)) {
    return { status: "blocked", reason: "已有相同编号的账号，无法覆盖恢复" };
  }
  return {
    status: "restored",
    item,
    data: {
      ...data,
      accounts: [...data.accounts, item.account],
      recycleBin: data.recycleBin.filter((entry) => entry.id !== item.id),
    },
  };
}

export function restoreRecycleBinItem(data: AppData, itemId: Id): RestoreRecycleBinResult {
  const item = data.recycleBin.find((entry) => entry.id === itemId);
  if (!item) return { status: "blocked", reason: "回收站条目已经不存在" };
  if (item.type === "category") return restoreCategory(data, item);
  if (item.type === "tag") return restoreTag(data, item);
  if (item.type === "service") return restoreService(data, item);
  return restoreAccount(data, item);
}

export function permanentlyDeleteRecycleBinItem(data: AppData, itemId: Id): AppData {
  return { ...data, recycleBin: data.recycleBin.filter((item) => item.id !== itemId) };
}

export function emptyRecycleBin(data: AppData): AppData {
  return data.recycleBin.length ? { ...data, recycleBin: [] } : data;
}
