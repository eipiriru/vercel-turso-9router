import { describe, it, expect, beforeEach, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@libsql/client", () => ({
  createClient: createClientMock,
}));

const { createTursoLibsqlAdapter } = await import("@/lib/db/adapters/tursoLibsqlAdapter.js");

function makeTransaction(overrides = {}) {
  return {
    execute: vi.fn().mockResolvedValue({ rows: [], rowsAffected: 0 }),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    ...overrides,
  };
}

function makeClient(tx) {
  return {
    batch: vi.fn().mockResolvedValue([]),
    transaction: vi.fn().mockResolvedValue(tx),
    execute: vi.fn(),
    close: vi.fn(),
  };
}

async function createAdapter(tx) {
  const client = makeClient(tx);
  createClientMock.mockReturnValue(client);
  return createTursoLibsqlAdapter("libsql://test-db", "test-token");
}

describe("Turso transaction lifecycle", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("commits successfully when tx.close() returns undefined", async () => {
    const tx = makeTransaction();
    const adapter = await createAdapter(tx);

    await expect(adapter.transaction(async () => "result")).resolves.toBe("result");

    expect(tx.commit).toHaveBeenCalledOnce();
    expect(tx.rollback).not.toHaveBeenCalled();
    expect(tx.close).toHaveBeenCalledOnce();
  });

  it("rolls back when callback fails", async () => {
    const callbackError = new Error("callback failed");
    const tx = makeTransaction();
    const adapter = await createAdapter(tx);

    await expect(adapter.transaction(async () => { throw callbackError; })).rejects.toBe(callbackError);

    expect(tx.rollback).toHaveBeenCalledOnce();
    expect(tx.commit).not.toHaveBeenCalled();
    expect(tx.close).toHaveBeenCalledOnce();
  });

  it("propagates commit failure and attempts rollback", async () => {
    const commitError = new Error("commit failed");
    const tx = makeTransaction({ commit: vi.fn().mockRejectedValue(commitError) });
    const adapter = await createAdapter(tx);

    await expect(adapter.transaction(async () => undefined)).rejects.toBe(commitError);

    expect(tx.commit).toHaveBeenCalledOnce();
    expect(tx.rollback).toHaveBeenCalledOnce();
    expect(tx.close).toHaveBeenCalledOnce();
  });

  it("preserves callback error when rollback and close cleanup fail", async () => {
    const callbackError = new Error("callback failed");
    const tx = makeTransaction({
      rollback: vi.fn().mockRejectedValue(new Error("rollback failed")),
      close: vi.fn(() => { throw new Error("close failed"); }),
    });
    const adapter = await createAdapter(tx);

    await expect(adapter.transaction(async () => { throw callbackError; })).rejects.toBe(callbackError);

    expect(tx.rollback).toHaveBeenCalledOnce();
    expect(tx.close).toHaveBeenCalledOnce();
  });
});
