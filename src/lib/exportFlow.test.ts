import { describe, expect, it, vi } from "vitest";
import { exportWithAudit } from "./exportFlow";

describe("exportWithAudit", () => {
  it("returns the written file result when the audit succeeds", async () => {
    const audit = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(exportWithAudit(async () => "export.xlsx", audit)).resolves.toEqual({
      result: "export.xlsx",
    });
    expect(audit).toHaveBeenCalledOnce();
  });

  it("keeps a successful file result when audit logging fails", async () => {
    const auditError = new Error("audit unavailable");
    const audit = vi.fn<() => Promise<void>>().mockRejectedValue(auditError);

    await expect(exportWithAudit(async () => "export.docx", audit)).resolves.toEqual({
      result: "export.docx",
      auditError,
    });
  });

  it("propagates the primary write failure and does not attempt auditing", async () => {
    const writeError = new Error("disk full");
    const write = vi.fn<() => Promise<string>>().mockRejectedValue(writeError);
    const audit = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(exportWithAudit(write, audit)).rejects.toBe(writeError);
    expect(audit).not.toHaveBeenCalled();
  });
});
