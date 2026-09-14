import { describe, expect, it, vi } from "vitest";
import { ACTION_BLOCKED, runWithActionGate } from "./useAsyncAction";

describe("runWithActionGate", () => {
  it("blocks a second action until the first one finishes", async () => {
    const gate = { current: false };
    let finish!: (value: string) => void;
    const action = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));

    const first = runWithActionGate(gate, action);
    await expect(runWithActionGate(gate, action)).resolves.toBe(ACTION_BLOCKED);
    expect(action).toHaveBeenCalledTimes(1);

    finish("done");
    await expect(first).resolves.toBe("done");
    expect(gate.current).toBe(false);
  });

  it("releases the gate after an exception", async () => {
    const gate = { current: false };
    await expect(runWithActionGate(gate, async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    expect(gate.current).toBe(false);
  });
});
