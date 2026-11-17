import { createAsyncMutex } from "./asyncMutex.js";

export function wrapSyncAdapter(adapter) {
  const mutex = createAsyncMutex();
  const direct = {
    run: adapter.run.bind(adapter),
    get: adapter.get.bind(adapter),
    all: adapter.all.bind(adapter),
    exec: adapter.exec.bind(adapter),
  };

  function transactionContext() {
    return {
      driver: `${adapter.driver}-transaction`,
      run: async (sql, params = []) => direct.run(sql, params),
      get: async (sql, params = []) => direct.get(sql, params),
      all: async (sql, params = []) => direct.all(sql, params),
      exec: async (sql) => direct.exec(sql),
    };
  }

  return {
    driver: adapter.driver,
    remote: false,
    localSync: adapter,
    run: (sql, params = []) => mutex.runExclusive(() => direct.run(sql, params)),
    get: (sql, params = []) => mutex.runExclusive(() => direct.get(sql, params)),
    all: (sql, params = []) => mutex.runExclusive(() => direct.all(sql, params)),
    exec: (sql) => mutex.runExclusive(() => direct.exec(sql)),
    transaction: (fn) => mutex.runExclusive(async () => {
      const savepoint = `sp_${Math.random().toString(36).slice(2)}`;
      direct.exec(`SAVEPOINT ${savepoint}`);
      try {
        const result = await fn(transactionContext());
        direct.exec(`RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        try {
          direct.exec(`ROLLBACK TO ${savepoint}`);
          direct.exec(`RELEASE ${savepoint}`);
        } catch {}
        throw error;
      }
    }),
    checkpoint: () => mutex.runExclusive(() => adapter.checkpoint?.()),
    close: () => mutex.runExclusive(() => adapter.close?.()),
    raw: adapter.raw,
  };
}
