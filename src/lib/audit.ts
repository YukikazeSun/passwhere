import type { AccountRecord, ServiceRecord, Tag } from "../types";

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const sameSet = (left: string[], right: string[]) => left.length === right.length && left.every((value) => right.includes(value));

export function describeServiceChanges(previous: ServiceRecord | undefined, next: ServiceRecord) {
  if (!previous) {
    return ["新建分区", next.tagIds.length ? `添加标签 ${next.tagIds.length} 个` : "", next.icon ? "添加图标" : ""].filter(Boolean);
  }
  const fields: string[] = [];
  if (previous.name !== next.name) fields.push("分区名称");
  if (previous.url !== next.url) fields.push("登录网址");
  if (previous.categoryId !== next.categoryId) fields.push("分类");
  const addedTags = next.tagIds.filter((id) => !previous.tagIds.includes(id)).length;
  const removedTags = previous.tagIds.filter((id) => !next.tagIds.includes(id)).length;
  if (addedTags) fields.push(`添加标签 ${addedTags} 个`);
  if (removedTags) fields.push(`移除标签 ${removedTags} 个`);
  if (!sameJson(previous.icon, next.icon)) {
    fields.push(previous.icon && next.icon ? "替换图标" : next.icon ? "添加图标" : "删除图标");
  }
  return fields;
}

export function describeTagCollectionChanges(previous: Tag[], next: Tag[], services: ServiceRecord[]) {
  const previousById = new Map(previous.map((tag) => [tag.id, tag]));
  const nextById = new Map(next.map((tag) => [tag.id, tag]));
  const added = next.filter((tag) => !previousById.has(tag.id)).length;
  const deletedTags = previous.filter((tag) => !nextById.has(tag.id));
  const changed = next.filter((tag) => {
    const before = previousById.get(tag.id);
    return before && (before.name !== tag.name || before.color !== tag.color);
  }).length;
  const removedReferences = services.reduce((total, service) =>
    total + deletedTags.filter((tag) => service.tagIds.includes(tag.id)).length, 0);
  return [
    added ? `新增标签 ${added} 个` : "",
    deletedTags.length ? `删除标签 ${deletedTags.length} 个` : "",
    changed ? `修改标签 ${changed} 个` : "",
    removedReferences ? `解除分区引用 ${removedReferences} 处` : "",
  ].filter(Boolean);
}

export function describeAccountChanges(previous: AccountRecord, next: AccountRecord) {
  const fields: string[] = [];
  if (previous.label !== next.label) fields.push("账号名称");
  if (previous.username !== next.username) fields.push("登录账号");
  if (previous.password !== next.password) {
    fields.push(!previous.password ? "密码已设置" : !next.password ? "密码已清除" : "密码已更新");
    if (next.password && previous.passwordHistory.some((item) => item.password === next.password)) fields.push("已选用历史密码");
    if (previous.password) fields.push(next.passwordHistory.some((item) => item.password === previous.password) ? "旧密码已保留" : "旧密码未保留");
  }
  if (previous.identityCode !== next.identityCode) fields.push("身份识别码");
  if (!sameJson(previous.securityQuestions, next.securityQuestions)) fields.push("密保问题");
  if (!sameJson(previous.customFields, next.customFields)) fields.push("自定义字段");
  if (!sameJson(previous.notes, next.notes)) fields.push("备注");
  if (!sameSet(previous.visibleModules, next.visibleModules)) fields.push("显示内容");
  if (previous.sortOrder !== next.sortOrder) fields.push("账号顺序");

  const previousImages = new Map(previous.images.map((image) => [image.id, image]));
  const nextImages = new Map(next.images.map((image) => [image.id, image]));
  const addedImages = next.images.filter((image) => !previousImages.has(image.id)).length;
  const deletedImages = previous.images.filter((image) => !nextImages.has(image.id)).length;
  const replacedImages = next.images.filter((image) => {
    const before = previousImages.get(image.id);
    return before && !sameJson(before, image);
  }).length;
  if (addedImages) fields.push(`新增图片 ${addedImages} 张`);
  if (deletedImages) fields.push(`删除图片 ${deletedImages} 张`);
  if (replacedImages) fields.push(`替换图片 ${replacedImages} 张`);
  return fields;
}
