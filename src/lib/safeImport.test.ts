import { describe, expect, it, vi } from "vitest";
import { createEmptyAppData } from "./dataModel";
import { replaceDataWithRollback, SafeImportError } from "./safeImport";

describe("replaceDataWithRollback", () => {
  it("does not start saving when rollback creation fails", async () => {
    const save = vi.fn();
    await expect(replaceDataWithRollback(createEmptyAppData(), createEmptyAppData(), {
      createRollback: async () => { throw new Error("disk full"); },
      save,
    })).rejects.toMatchObject({ stage: "backup" });
    expect(save).not.toHaveBeenCalled();
  });

  it("returns the rollback path after backup and save both succeed", async () => {
    const outcome = await replaceDataWithRollback(createEmptyAppData(), createEmptyAppData(), {
      createRollback: async () => "backups/rollback.anb",
      save: async () => "saved-data",
    });
    expect(outcome).toEqual({ rollbackPath: "backups/rollback.anb", result: "saved-data" });
  });

  it("preserves the rollback path when the atomic save fails", async () => {
    const promise = replaceDataWithRollback(createEmptyAppData(), createEmptyAppData(), {
      createRollback: async () => "backups/rollback.anb",
      save: async () => { throw new Error("database busy"); },
    });
    await expect(promise).rejects.toEqual(expect.objectContaining<Partial<SafeImportError>>({
      stage: "save",
      rollbackPath: "backups/rollback.anb",
    }));
  });
});
