import { describe, expect, it } from "vitest";
import type { PasswordHistoryItem } from "../types";
import { updatePasswordHistory } from "./passwordHistory";

const item = (id: string, password: string): PasswordHistoryItem => ({
  id,
  password,
  changedAt: "2026-01-01T00:00:00.000Z",
});
describe("updatePasswordHistory", () => {
  it("keeps at most three distinct historical passwords", () => {
    const result = updatePasswordHistory(
      "current",
      "next",
      [item("a", "one"), item("b", "two"), item("c", "three")],
      true,
      "2026-07-23T00:00:00.000Z",
    );

    expect(result.map((entry) => entry.password)).toEqual(["current", "one", "two"]);
  });

  it("removes a historical password when it becomes current again", () => {
    const result = updatePasswordHistory(
      "current",
      "old",
      [item("a", "old"), item("b", "older")],
      true,
    );

    expect(result.map((entry) => entry.password)).toEqual(["current", "older"]);
  });

  it("does not retain the current password when declined", () => {
    const history = [item("a", "old")];
    expect(updatePasswordHistory("current", "next", history, false)).toEqual(history);
  });
});
