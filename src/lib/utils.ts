import type { AccountRecord, Category, Id, ServiceRecord, Tag } from "../types";

export type ServiceSearchMatchKind = "service" | "account" | "note" | "category" | "tag";

export interface ServiceSearchMatch {
  kind: ServiceSearchMatchKind;
  accountId: Id | null;
  label: string;
  preview: string;
}

export interface ServiceSearchResult {
  service: ServiceRecord;
  match: ServiceSearchMatch | null;
}

export interface ServiceSearchIndex {
  accountsByServiceId: ReadonlyMap<Id, readonly AccountRecord[]>;
  categoryPathById: ReadonlyMap<Id, string>;
  childCategoryIdsByParentId: ReadonlyMap<Id, readonly Id[]>;
  tagNameById: ReadonlyMap<Id, string>;
}

export const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

export const nowIso = () => new Date().toISOString();

export const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));

export function formatByteSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  const digits = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export const getInitials = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const latin = trimmed.match(/[A-Za-z0-9]/g)?.slice(0, 2).join("");
  return (latin || trimmed.slice(0, 1)).toUpperCase();
};

function getCategoryPathFromIndex(categoryId: Id | null, categoryById: ReadonlyMap<Id, Category>) {
  if (!categoryId) return "未分类";
  const names: string[] = [];
  const visited = new Set<Id>();
  let cursor = categoryById.get(categoryId);

  while (cursor && !visited.has(cursor.id)) {
    names.unshift(cursor.name);
    visited.add(cursor.id);
    cursor = cursor.parentId ? categoryById.get(cursor.parentId) : undefined;
  }

  return names.join(" / ") || "未分类";
}

export function getCategoryPath(categoryId: Id | null, categories: Category[]) {
  return getCategoryPathFromIndex(categoryId, new Map(categories.map((category) => [category.id, category])));
}

export function createCategoryPathIndex(categories: Category[]) {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  return new Map(categories.map((category) => [
    category.id,
    getCategoryPathFromIndex(category.id, categoryById),
  ]));
}

const normalizeSearchText = (value: string) => value.toLocaleLowerCase("zh-CN");

function createSearchPreview(value: string, keyword: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= 48) return compact;
  const index = normalizeSearchText(compact).indexOf(keyword);
  const start = Math.max(0, Math.min(index - 14, compact.length - 44));
  const excerpt = compact.slice(start, start + 44);
  return `${start > 0 ? "…" : ""}${excerpt}${start + 44 < compact.length ? "…" : ""}`;
}

export function createServiceSearchIndex(
  accounts: AccountRecord[],
  categories: Category[],
  tags: Tag[],
): ServiceSearchIndex {
  const accountsByServiceId = new Map<Id, AccountRecord[]>();
  for (const account of accounts) {
    const list = accountsByServiceId.get(account.serviceId);
    if (list) list.push(account);
    else accountsByServiceId.set(account.serviceId, [account]);
  }
  for (const serviceAccounts of accountsByServiceId.values()) {
    serviceAccounts.sort((left, right) => left.sortOrder - right.sortOrder);
  }

  const categoryPathById = createCategoryPathIndex(categories);
  const childCategoryIdsByParentId = new Map<Id, Id[]>();
  for (const category of categories) {
    if (!category.parentId) continue;
    const children = childCategoryIdsByParentId.get(category.parentId);
    if (children) children.push(category.id);
    else childCategoryIdsByParentId.set(category.parentId, [category.id]);
  }

  return {
    accountsByServiceId,
    categoryPathById,
    childCategoryIdsByParentId,
    tagNameById: new Map(tags.map((tag) => [tag.id, tag.name])),
  };
}

function getVisibleCategoryIds(categoryId: Id | "all", index: ServiceSearchIndex) {
  const visibleCategoryIds = new Set<Id>();
  if (categoryId === "all") return visibleCategoryIds;

  const pending = [categoryId];
  while (pending.length > 0) {
    const currentId = pending.pop()!;
    if (visibleCategoryIds.has(currentId)) continue;
    visibleCategoryIds.add(currentId);
    pending.push(...(index.childCategoryIdsByParentId.get(currentId) || []));
  }
  return visibleCategoryIds;
}

export function findIndexedServiceSearchResults(
  services: ServiceRecord[],
  index: ServiceSearchIndex,
  search: string,
  categoryId: Id | "all",
  selectedTagIds: Set<Id>,
) : ServiceSearchResult[] {
  const keyword = normalizeSearchText(search.trim());
  const visibleCategoryIds = getVisibleCategoryIds(categoryId, index);
  const requiredTagIds = [...selectedTagIds];

  const results: ServiceSearchResult[] = [];
  for (const service of services) {
    if (categoryId !== "all" && (!service.categoryId || !visibleCategoryIds.has(service.categoryId))) continue;
    if (requiredTagIds.length > 0 && !requiredTagIds.every((id) => service.tagIds.includes(id))) {
      continue;
    }
    if (!keyword) {
      results.push({ service, match: null });
      continue;
    }

    const categoryPath = service.categoryId ? index.categoryPathById.get(service.categoryId) || "未分类" : "未分类";
    const makeMatch = (kind: ServiceSearchMatchKind, accountId: Id | null, label: string, value: string, prefix = ""): ServiceSearchResult => ({
      service,
      match: {
        kind,
        accountId,
        label,
        preview: `${prefix}${createSearchPreview(value, keyword)}`,
      },
    });
    if (normalizeSearchText(service.name).includes(keyword)) {
      results.push(makeMatch("service", null, "分区名称", service.name));
      continue;
    }
    if (normalizeSearchText(service.url).includes(keyword)) {
      results.push(makeMatch("service", null, "登录网址", service.url));
      continue;
    }

    let accountResult: ServiceSearchResult | null = null;
    const serviceAccounts = index.accountsByServiceId.get(service.id) || [];
    for (const account of serviceAccounts) {
      const accountPrefix = `${account.label} · `;
      const accountFields = [
        ["账号名称", account.label],
        ["登录账号", account.username],
        ["身份识别码", account.identityCode],
        ["密保手机", account.securityPhone || ""],
        ["密保邮箱", account.securityEmail || ""],
      ] as const;
      const directMatch = accountFields.find(([, value]) => normalizeSearchText(value).includes(keyword));
      if (directMatch) {
        accountResult = makeMatch("account", account.id, directMatch[0], directMatch[1], accountPrefix);
        break;
      }
      const note = account.notes.find((item) => normalizeSearchText(`${item.title}\n${item.content}`).includes(keyword));
      if (note) {
        const noteValue = normalizeSearchText(note.title).includes(keyword) ? note.title : note.content;
        accountResult = makeMatch("note", account.id, "备注", noteValue, `${account.label} · ${note.title || "备注"}：`);
        break;
      }
      const customField = account.customFields.find((field) => normalizeSearchText(`${field.label}\n${field.value}`).includes(keyword));
      if (customField) {
        const fieldValue = normalizeSearchText(customField.label).includes(keyword) ? customField.label : customField.value;
        accountResult = makeMatch("account", account.id, "自定义字段", fieldValue, accountPrefix);
        break;
      }
      const securityQuestion = account.securityQuestions.find((item) => normalizeSearchText(`${item.question}\n${item.answer}`).includes(keyword));
      if (securityQuestion) {
        const fieldValue = normalizeSearchText(securityQuestion.question).includes(keyword) ? securityQuestion.question : securityQuestion.answer;
        accountResult = makeMatch("account", account.id, "密保信息", fieldValue, accountPrefix);
        break;
      }
    }
    if (accountResult) {
      results.push(accountResult);
      continue;
    }
    if (normalizeSearchText(categoryPath).includes(keyword)) {
      results.push(makeMatch("category", null, "分类", categoryPath));
      continue;
    }
    const matchingTag = service.tagIds.map((id) => index.tagNameById.get(id) || "").find((name) => normalizeSearchText(name).includes(keyword));
    if (matchingTag) results.push(makeMatch("tag", null, "标签", matchingTag));
  }
  return results;
}

export function findServiceSearchResults(
  services: ServiceRecord[],
  accounts: AccountRecord[],
  categories: Category[],
  tags: Tag[],
  search: string,
  categoryId: Id | "all",
  selectedTagIds: Set<Id>,
) : ServiceSearchResult[] {
  return findIndexedServiceSearchResults(
    services,
    createServiceSearchIndex(accounts, categories, tags),
    search,
    categoryId,
    selectedTagIds,
  );
}

export function filterServices(
  services: ServiceRecord[],
  accounts: AccountRecord[],
  categories: Category[],
  tags: Tag[],
  search: string,
  categoryId: Id | "all",
  selectedTagIds: Set<Id>,
) {
  return findServiceSearchResults(services, accounts, categories, tags, search, categoryId, selectedTagIds)
    .map((result) => result.service);
}

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

export function splitLinks(value: string) {
  return value.split(URL_PATTERN).map((part) => ({
    text: part,
    isUrl: /^https?:\/\//.test(part),
  }));
}

export function validateExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
