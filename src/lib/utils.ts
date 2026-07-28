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

export function getCategoryPath(categoryId: Id | null, categories: Category[]) {
  if (!categoryId) return "未分类";
  const index = new Map(categories.map((category) => [category.id, category]));
  const names: string[] = [];
  const visited = new Set<Id>();
  let cursor = index.get(categoryId);

  while (cursor && !visited.has(cursor.id)) {
    names.unshift(cursor.name);
    visited.add(cursor.id);
    cursor = cursor.parentId ? index.get(cursor.parentId) : undefined;
  }

  return names.join(" / ") || "未分类";
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

export function findServiceSearchResults(
  services: ServiceRecord[],
  accounts: AccountRecord[],
  categories: Category[],
  tags: Tag[],
  search: string,
  categoryId: Id | "all",
  selectedTagIds: Set<Id>,
) : ServiceSearchResult[] {
  const keyword = normalizeSearchText(search.trim());
  const tagIndex = new Map(tags.map((tag) => [tag.id, tag.name]));
  const visibleCategoryIds = new Set<Id>();
  if (categoryId !== "all") {
    visibleCategoryIds.add(categoryId);
    let changed = true;
    while (changed) {
      changed = false;
      for (const category of categories) {
        if (category.parentId && visibleCategoryIds.has(category.parentId) && !visibleCategoryIds.has(category.id)) {
          visibleCategoryIds.add(category.id);
          changed = true;
        }
      }
    }
  }
  const accountIndex = new Map<Id, AccountRecord[]>();

  for (const account of accounts) {
    const list = accountIndex.get(account.serviceId) || [];
    list.push(account);
    accountIndex.set(account.serviceId, list);
  }

  const results: ServiceSearchResult[] = [];
  for (const service of services) {
    if (categoryId !== "all" && (!service.categoryId || !visibleCategoryIds.has(service.categoryId))) continue;
    if (selectedTagIds.size > 0 && ![...selectedTagIds].every((id) => service.tagIds.includes(id))) {
      continue;
    }
    if (!keyword) {
      results.push({ service, match: null });
      continue;
    }

    const categoryPath = getCategoryPath(service.categoryId, categories);
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
    const serviceAccounts = [...(accountIndex.get(service.id) || [])].sort((left, right) => left.sortOrder - right.sortOrder);
    for (const account of serviceAccounts) {
      const accountPrefix = `${account.label} · `;
      const accountFields = [
        ["账号名称", account.label],
        ["登录账号", account.username],
        ["身份识别码", account.identityCode],
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
    const matchingTag = service.tagIds.map((id) => tagIndex.get(id) || "").find((name) => normalizeSearchText(name).includes(keyword));
    if (matchingTag) results.push(makeMatch("tag", null, "标签", matchingTag));
  }
  return results;
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
