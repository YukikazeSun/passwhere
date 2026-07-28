import type { Id, ServiceRecord, Tag } from "../types";

export interface TagValidationResult {
  valid: boolean;
  normalized: Tag[];
  errors: Record<Id, string>;
}

export function validateTags(tags: Tag[]): TagValidationResult {
  const normalized = tags.map((tag) => ({ ...tag, name: tag.name.trim() }));
  const errors: Record<Id, string> = {};
  const nameOwners = new Map<string, Id[]>();

  for (const tag of normalized) {
    if (!tag.name) {
      errors[tag.id] = "标签名称不能为空";
      continue;
    }
    const key = tag.name.toLocaleLowerCase("zh-CN");
    nameOwners.set(key, [...(nameOwners.get(key) || []), tag.id]);
  }
  for (const ids of nameOwners.values()) {
    if (ids.length > 1) ids.forEach((id) => { errors[id] = "标签名称不能重复"; });
  }
  return { valid: Object.keys(errors).length === 0, normalized, errors };
}

export function countTagUsage(services: ServiceRecord[]) {
  const counts: Record<Id, number> = {};
  for (const service of services) {
    for (const tagId of new Set(service.tagIds)) {
      counts[tagId] = (counts[tagId] || 0) + 1;
    }
  }
  return counts;
}
