import { createClient } from "@libsql/client";
import { PORTABLE_PRAGMA_SQL } from "../schema.js";

function args(params = []) {
  return Array.isArray(params) ? params : [];
}

function statement(sql, params = []) {
  return { sql, args: args(params) };
}

function rowResult(result) {
  return result.rows?.[0];
}

export function validateTursoConfig(url, authToken) {
  if (!url && !authToken) return false;
  if (!url || !authToken) {
    throw new Error("[DB] KUMO_DB_TURSO_DATABASE_URL and KUMO_DB_TURSO_AUTH_TOKEN must be set together");
  }
  let parsed;
  try { parsed = new URL(url); } catch {
    throw new Error("[DB] KUMO_DB_TURSO_DATABASE_URL is invalid");
  }
  if (!['https:', 'libsql:'].includes(parsed.protocol)) {
    throw new Error("[DB] KUMO_DB_TURSO_DATABASE_URL must use https: or libsql:");
  }
  if (typeof authToken !== "string" || authToken.trim() === "") {
    throw new Error("[DB] KUMO_DB_TURSO_AUTH_TOKEN is invalid");
  }
  return true;
}

export async function createTursoLibsqlAdapter(url, authToken) {
  validateTursoConfig(url, authToken);
  const client = createClient({ url, authToken });
  await client.batch(
    PORTABLE_PRAGMA_SQL.map((sql) => statement(sql)),
    "write",
  );

  return {
    driver: "turso-libsql",
    remote: true,
    async run(sql, params = []) {
      const result = await client.execute(statement(sql, params));
      return { changes: Number(result.rowsAffected ?? 0), lastInsertRowid: result.lastInsertRowid ?? 0 };
    },
    async get(sql, params = []) {
      return rowResult(await client.execute(statement(sql, params)));
    },
    async all(sql, params = []) {
      return (await client.execute(statement(sql, params))).rows;
    },
    async exec(sql) {
      await client.execute({ sql, args: [] });
    },
    async batch(statements, mode = "write") {
      return client.batch(statements.map((s) => typeof s === "string" ? statement(s) : s), mode);
    },
    async transaction(fn) {
      const tx = await client.transaction("write");
      let committed = false;
      const adapter = {
        driver: "turso-libsql-transaction",
        run: async (sql, params = []) => {
          const result = await tx.execute(statement(sql, params));
          return { changes: Number(result.rowsAffected ?? 0), lastInsertRowid: result.lastInsertRowid ?? 0 };
        },
        get: async (sql, params = []) => rowResult(await tx.execute(statement(sql, params))),
        all: async (sql, params = []) => (await tx.execute(statement(sql, params))).rows,
        exec: async (sql) => { await tx.execute({ sql, args: [] }); },
      };
      try {
        const result = await fn(adapter);
        await tx.commit();
        committed = true;
        return result;
      } catch (error) {
        if (!committed) await tx.rollback().catch(() => {});
        throw error;
      } finally {
        try {
          await tx.close();
        } catch {
          // Cleanup must not mask callback, commit, or rollback errors.
        }
      }
    },
    async close() {
      client.close();
    },
    raw: client,
  };
}
