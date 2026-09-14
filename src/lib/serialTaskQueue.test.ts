import { describe, expect, it } from "vitest";
import { createSerialTaskQueue } from "./serialTaskQueue";

describe("createSerialTaskQueue", () => {
  it("runs tasks in enqueue order", async () => {
    const queue = createSerialTaskQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = queue.enqueue(async () => {
      order.push("first-start");
      await firstGate;
      order.push("first-end");
      return 1;
    });
    const second = queue.enqueue(async () => {
      order.push("second");
      return 2;
    });

    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("continues after a failed task", async () => {
    const queue = createSerialTaskQueue();
    const failed = queue.enqueue(async () => { throw new Error("disk full"); });
    const recovered = queue.enqueue(async () => "saved");

    await expect(failed).rejects.toThrow("disk full");
    await expect(recovered).resolves.toBe("saved");
    await expect(queue.waitForIdle()).resolves.toBeUndefined();
  });

  it("waits for all tasks already in the queue", async () => {
    const queue = createSerialTaskQueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let idle = false;

    void queue.enqueue(async () => gate);
    const waiting = queue.waitForIdle().then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(false);
    release();
    await waiting;
    expect(idle).toBe(true);
  });
});
