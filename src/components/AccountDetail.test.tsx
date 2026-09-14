import { describe, expect, it } from "vitest";
import { createAccountViewKey } from "./AccountDetail";

describe("createAccountViewKey", () => {
  it("changes when the selected account or its persisted version changes", () => {
    const first = createAccountViewKey("service-a", {
      id: "account-a",
      revision: 1,
      updatedAt: "2026-07-31T08:00:00.000Z",
    });
    const otherAccount = createAccountViewKey("service-a", {
      id: "account-b",
      revision: 1,
      updatedAt: "2026-07-31T08:00:00.000Z",
    });
    const updatedAccount = createAccountViewKey("service-a", {
      id: "account-a",
      revision: 2,
      updatedAt: "2026-07-31T08:01:00.000Z",
    });

    expect(first).not.toBe(otherAccount);
    expect(first).not.toBe(updatedAccount);
  });

  it("returns a stable empty-account key", () => {
    expect(createAccountViewKey("service-a", undefined)).toBe("service-a:none");
  });
});
