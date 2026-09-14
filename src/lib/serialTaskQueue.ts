export interface SerialTaskQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  waitForIdle(): Promise<void>;
}

export function createSerialTaskQueue(): SerialTaskQueue {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue<T>(task: () => Promise<T>) {
      const result = tail.then(task, task);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
    waitForIdle() {
      return tail;
    },
  };
}
