import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledgeFinancialData,
  preservePendingFinancialData,
  readPendingFinancialData,
  resolveFinancialHydration,
} from "../finance-persistence.mjs";

const fixture = (overrides = {}) => ({
  cards: [], entries: [], cardPurchases: [], categories: [], settings: {},
  expenses: [{ id: "expense-1", description: "Conta", value: 100 }],
  updatedAt: "2026-09-15T12:00:00.000Z", ...overrides,
});
const edited = () => fixture({
  expenses: [{ id: "expense-1", description: "Conta editada", value: 275.50 }],
  updatedAt: "2026-09-15T12:01:00.000Z",
});
const storageFixture = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test("reabre com descrição e valor editados, mesmo sem aumentar o número de registros", () => {
  const storage = storageFixture();
  preservePendingFinancialData(storage, "conta-a", edited());
  const pendingData = readPendingFinancialData(storage, "conta-a");
  const result = resolveFinancialHydration(fixture(), fixture(), { pendingData });
  assert.deepEqual(result, { payload: edited(), needsSync: true });
});

test("recupera edições da versão antiga após consumir a recuperação inicial", () => {
  const result = resolveFinancialHydration(fixture(), edited(), { allowLocalRecovery: false });
  assert.deepEqual(result, { payload: edited(), needsSync: true });
});

test("mantém exclusões pendentes, inclusive a exclusão do último lançamento", () => {
  const pendingData = edited();
  pendingData.expenses = [];
  const result = resolveFinancialHydration(fixture(), fixture(), { pendingData });
  assert.equal(result.payload.expenses.length, 0);
  assert.equal(result.needsSync, true);
});

test("uma resposta antiga não apaga uma alteração mais recente em envio", () => {
  const storage = storageFixture();
  preservePendingFinancialData(storage, "conta-a", fixture());
  preservePendingFinancialData(storage, "conta-a", edited());
  assert.equal(acknowledgeFinancialData(storage, "conta-a", fixture()), false);
  assert.deepEqual(readPendingFinancialData(storage, "conta-a"), edited());
  assert.equal(acknowledgeFinancialData(storage, "conta-a", edited()), true);
  assert.equal(readPendingFinancialData(storage, "conta-a"), null);
});

test("cada conta preserva sua própria fila e a nuvem atual vence quando não há pendência", () => {
  const storage = storageFixture();
  preservePendingFinancialData(storage, "conta-a", edited());
  assert.equal(readPendingFinancialData(storage, "conta-b"), null);
  assert.deepEqual(resolveFinancialHydration(edited(), fixture()), { payload: edited(), needsSync: false });
});

