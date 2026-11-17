import { AsyncLocalStorage } from "node:async_hooks";

export function createAsyncMutex() {
  const owner = new AsyncLocalStorage();
  let tail = Promise.resolve();
  let depth = 0;

  return {
    runExclusive(task) {
      if (owner.getStore() === true) {
        depth += 1;
        return Promise.resolve().then(task).finally(() => {
          depth -= 1;
        });
      }

      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const prev = tail;
      tail = gate;
      return prev.then(() => owner.run(true, async () => {
        depth = 1;
        try {
          return await task();
        } finally {
          depth = 0;
          release();
        }
      }));
    },
  };
}
