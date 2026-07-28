import { describe, expect, it } from "vitest";
import type { AccountRecord, ServiceRecord, Tag } from "../types";
import { describeAccountChanges, describeServiceChanges, describeTagCollectionChanges } from "./audit";

function account(password: string): AccountRecord {
  return {
    id: "account", serviceId: "service", label: "主账号", username: "user", password,
    identityCode: "identity-secret", notes: [{ id: "note", title: "说明", content: "private-note" }],
    visibleModules: ["password", "images"], sortOrder: 0, securityQuestions: [], customFields: [], images: [],
    passwordHistory: [], createdAt: "", updatedAt: "", revision: 1, modifiedByDeviceId: "device-test",
  };
}

describe("audit descriptions", () => {
  it("describes password and image changes without including sensitive values", () => {
    const previous = account("old-secret");
    previous.passwordHistory = [{ id: "history", password: "reused-secret", changedAt: "" }];
    previous.images = [{ id: "old-image", name: "private-code.png", dataUrl: "private-bytes" }];
    const next = account("reused-secret");
    next.passwordHistory = [{ id: "kept", password: "old-secret", changedAt: "" }];
    next.images = [{ id: "new-image", name: "new-private-code.png", dataUrl: "new-private-bytes" }];

    const text = describeAccountChanges(previous, next).join("、");
    expect(text).toContain("密码已更新");
    expect(text).toContain("已选用历史密码");
    expect(text).toContain("旧密码已保留");
    expect(text).toContain("新增图片 1 张");
    expect(text).toContain("删除图片 1 张");
    for (const sensitive of ["old-secret", "reused-secret", "private-note", "private-code.png", "new-private-bytes"]) {
      expect(text).not.toContain(sensitive);
    }
  });

  it("summarizes tag collection and partition tag changes by count", () => {
    const oldTags: Tag[] = [{ id: "old", name: "旧", color: "#000000", revision: 1, updatedAt: "", modifiedByDeviceId: "device-test" }];
    const newTags: Tag[] = [{ id: "new", name: "新", color: "#ffffff", revision: 1, updatedAt: "", modifiedByDeviceId: "device-test" }];
    const services = [{ id: "service", tagIds: ["old"] }] as ServiceRecord[];
    expect(describeTagCollectionChanges(oldTags, newTags, services)).toEqual([
      "新增标签 1 个", "删除标签 1 个", "解除分区引用 1 处",
    ]);

    const previousService = { id: "service", name: "站点", url: "", categoryId: null, tagIds: ["old"], icon: null } as ServiceRecord;
    const nextService = { ...previousService, tagIds: ["new"] };
    expect(describeServiceChanges(previousService, nextService)).toEqual(["添加标签 1 个", "移除标签 1 个"]);
  });
});
