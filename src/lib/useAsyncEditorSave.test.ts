import { describe, expect, it, vi } from "vitest";
import { runWithSaveGate } from "./useAsyncEditorSave";

describe("runWithSaveGate", () => {
  it("blocks a duplicate attempt until the active save finishes", async () => {
    const gate = { current: false };
    let finish!: (result: "saved") => void;
    const save = vi.fn(() => new Promise<"saved">((resolve) => { finish = resolve; }));

    const first = runWithSaveGate(gate, save);
    const duplicate = await runWithSaveGate(gate, save);

    expect(gate.current).toBe(true);
    expect(duplicate).toBe("blocked");
    expect(save).toHaveBeenCalledTimes(1);

    finish("saved");
    await expect(first).resolves.toBe("saved");
    expect(gate.current).toBe(false);
  });

  it("releases the gate when saving throws", async () => {
    const gate = { current: false };
    await expect(runWithSaveGate(gate, async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
    expect(gate.current).toBe(false);
  });
});
