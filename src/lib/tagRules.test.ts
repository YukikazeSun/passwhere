import { describe, expect, it } from "vitest";
import type { AccountRecord, ServiceRecord, Tag } from "../types";
import { countTagAccountUsage, countTagUsage, validateTags } from "./tagRules";

const tag = (id: string, name: string): Tag => ({
  id, name, color: "#287d72", revision: 1, updatedAt: "", modifiedByDeviceId: "device-test",
});

describe("tag rules", () => {
  it("trims names and rejects blank values", () => {
    const result = validateTags([tag("one", "  工作  "), tag("two", "   ")]);
    expect(result.normalized[0].name).toBe("工作");
    expect(result.errors.two).toBe("标签名称不能为空");
  });

  it("rejects duplicate names without case sensitivity", () => {
    const result = validateTags([tag("one", "Steam"), tag("two", " steam ")]);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual({ one: "标签名称不能重复", two: "标签名称不能重复" });
  });

  it("counts each partition once per tag", () => {
    const services = [
      { id: "one", tagIds: ["work", "work"] },
      { id: "two", tagIds: ["work", "game"] },
    ] as ServiceRecord[];
    expect(countTagUsage(services)).toEqual({ work: 2, game: 1 });
  });

  it("counts accounts rather than partitions for sidebar tag totals", () => {
    const services = [
      { id: "one", tagIds: ["work", "work"] },
      { id: "two", tagIds: ["work", "game"] },
      { id: "empty", tagIds: ["game"] },
    ] as ServiceRecord[];
    const accounts = [
      { id: "a1", serviceId: "one" },
      { id: "a2", serviceId: "one" },
      { id: "a3", serviceId: "two" },
    ] as AccountRecord[];

    expect(countTagAccountUsage(services, accounts)).toEqual({ work: 3, game: 1 });
  });
});
