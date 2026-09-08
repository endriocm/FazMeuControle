import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FINANCIAL_SCHEMA_VERSION,
  LOCAL_MIGRATION_BACKUP_SUFFIX,
  createEmptyFinancialDataV2,
  dateInFinancialTimeZone,
  ensureLocalMigrationBackup,
  isFinancialDataV2,
  isRecognizedFinancialData,
  migrateFinancialData,
  toMinorUnits,
} from "../finance-schema.mjs";
import { getMonthSummary } from "../finance-domain.mjs";

const NOW = "2026-08-15T12:00:00.000-03:00";
const financialAppUrl = new URL(
  "../index.html",
  import.meta.url,
);

function legacyData(overrides = {}) {
  return {
    version: "1.3.0",
    settings: {
      startMonth: 7,
      currentMonth: 7,
      year: 2026,
      initialBalanceYear: 2026,
      currency: "BRL",
      initialBalance: 150.25,
    },
    categories: [
      { id: "cat_income", name: "Salário", type: "entrada" },
      { id: "cat_market", name: "Mercado", type: "saida" },
      { id: "cat_housing", name: "Moradia", type: "saida" },
      { id: "cat_other", name: "Outros", type: "ambos" },
    ],
    subcategories: [],
    cards: [{
      id: "card-xp",
      name: "XP",
      defaultTag: "Compras",
      limit: 10_000,
      closingDay: 10,
      dueDay: 20,
    }],
    entries: [{
      id: "salary",
      description: "Salário",
      category: "Salário",
      value: 8_500,
      plannedDate: "2026-08-05",
      receivedDate: "2026-08-05",
      status: "received",
      recurrence: "mensal",
    }],
    expenses: [
      {
        id: "market",
        description: "Zaffari",
        category: "Mercado",
        value: 286.4,
        dueDate: "2026-08-08",
        paymentDate: "2026-08-08",
        status: "paid",
        paymentMethod: "pix",
        recurrence: "única",
      },
      {
        id: "rent",
        description: "Aluguel",
        category: "Moradia",
        value: 3_000,
        dueDate: "2026-08-20",
        paymentDate: "",
        status: "pending",
        paymentMethod: "pix",
        recurrence: "mensal",
      },
    ],
    cardPurchases: [{
      id: "laptop",
      cardId: "card-xp",
      date: "2026-08-11",
      description: "Notebook",
      category: "Outros",
      totalValue: 1_200,
      installments: 12,
      currentInstallment: 1,
      status: "open",
      paidInstallments: [],
      recurrence: "única",
    }],
    invoicePayments: {},
    updatedAt: "",
    ...overrides,
  };
}

test("cria um schema v2 vazio com conta principal sem inventar saldo disponível", () => {
  const data = createEmptyFinancialDataV2({}, { now: NOW });

  assert.equal(data.schemaVersion, FINANCIAL_SCHEMA_VERSION);
  assert.equal(data.version, "2.0.0");
  assert.equal(data.timeZone, "America/Sao_Paulo");
  assert.equal(data.accounts.length, 1);
  assert.equal(data.accounts[0].name, "Conta principal");
  assert.equal(data.accounts[0].includeInCash, false);
  assert.deepEqual(data.movements, []);
  assert.deepEqual(data.cardBills, []);
  assert.deepEqual(data.investments, []);
  assert.equal(data.financialPlan, null);
  assert.ok(isRecognizedFinancialData(data));
});

test("preserva o planejamento financeiro na migração e ao reabrir", () => {
  const financialPlan = {
    schemaVersion: 1,
    status: "completed",
    incomeMinor: 650_000,
    fixedCostMinor: 300_000,
    goals: [{ id: "planning-goal-car", type: "car", targetMinor: 6_000_000 }],
    updatedAt: NOW,
  };
  const migrated = migrateFinancialData(legacyData({ financialPlan }), { now: NOW });
  const reloaded = migrateFinancialData(JSON.parse(JSON.stringify(migrated)), { now: NOW });

  assert.deepEqual(migrated.financialPlan, financialPlan);
  assert.deepEqual(reloaded.financialPlan, financialPlan);
});

test("resolve a data civil no fuso America/Sao_Paulo", () => {
  assert.equal(dateInFinancialTimeZone("2026-08-16T01:30:00.000Z"), "2026-08-15");
  assert.equal(dateInFinancialTimeZone("2026-08-16T03:30:00.000Z"), "2026-08-16");
});

test("migra entradas, saídas, previstos e cartões usando centavos inteiros", () => {
  const data = migrateFinancialData(legacyData(), { now: NOW });

  assert.ok(isFinancialDataV2(data));
  assert.equal(data.accounts[0].openingBalanceMinor, 15_025);
  assert.equal(data.cards[0].limitMinor, 1_000_000);
  assert.equal("defaultTag" in data.cards[0], false);
  assert.equal(
    data.movements.find((movement) => movement.legacyId === "salary").amountMinor,
    850_000,
  );
  assert.equal(
    data.movements.find((movement) => movement.legacyId === "market").amountMinor,
    28_640,
  );
  assert.equal(
    data.movements.find((movement) => movement.legacyId === "laptop").type,
    "card_purchase",
  );
  assert.equal(
    data.expectedItems.find((item) => item.legacyId === "rent").amountMinor,
    300_000,
  );
  assert.equal(data.recurrenceRules.length, 2);
  assert.ok(data.categoryRules.some((rule) => rule.source === "system" && rule.pattern === "mercado"));
  assert.equal(data.cardBills.length, 12);
  assert.equal(
    data.cardBills.reduce((total, bill) => total + bill.totalMinor, 0),
    120_000,
  );
});

test("a migração é idempotente e não duplica auditoria nem regras", () => {
  const first = migrateFinancialData(legacyData(), { now: NOW });
  const second = migrateFinancialData(first, { now: NOW });

  assert.deepEqual(second, first);
  assert.equal(
    second.auditLog.filter((entry) => entry.id === "audit_schema_v2_migration").length,
    1,
  );
});

test("repara identificadores e valores legados antes da sincronização em nuvem", () => {
  const data = migrateFinancialData(legacyData({
    accounts: [
      { id: "account-duplicate", name: "Conta A" },
      { id: "account-duplicate", name: "Conta B" },
      { name: "Conta sem identificador" },
    ],
    cards: [
      legacyData().cards[0],
      { ...legacyData().cards[0], name: "XP adicional" },
      { name: "Cartão sem identificador", limit: -500, closingDay: 5, dueDay: 12 },
    ],
    categories: [
      { id: "category-duplicate", name: "Salário", type: "entrada" },
      { id: "category-duplicate", name: "Mercado", type: "saida" },
      { name: "Outros", type: "ambos" },
    ],
    auditLog: [
      { id: "audit-duplicate", action: "created" },
      { id: "audit-duplicate", action: "updated" },
      { action: "legacy" },
    ],
    entries: [{
      ...legacyData().entries[0],
      value: -8_500,
    }],
    expenses: [{
      ...legacyData().expenses[0],
      value: -286.4,
    }],
    cardPurchases: [{
      ...legacyData().cardPurchases[0],
      totalValue: -1_200,
    }],
  }), { now: NOW });
  const requiredLists = [
    "accounts",
    "cards",
    "movements",
    "cardBills",
    "expectedItems",
    "recurrenceRules",
    "categoryRules",
    "categories",
    "auditLog",
  ];

  requiredLists.forEach((field) => {
    const ids = data[field].map((item) => item.id);
    assert.ok(ids.every((id) => typeof id === "string" && id.length > 0), field);
    assert.equal(new Set(ids).size, ids.length, field);
  });
  assert.ok(data.movements.every((movement) => (
    Number.isSafeInteger(movement.amountMinor) && movement.amountMinor >= 0
  )));
  assert.ok(data.cards.every((card) => card.limitMinor >= 0));
  assert.deepEqual(migrateFinancialData(data, { now: NOW }), data);
});

test("preserva entrada recorrente e tag de um bloco personalizado ao reabrir", () => {
  const customCategory = {
    id: "cat-remuneracao",
    name: "Remuneração",
    type: "ambos",
    color: "#D4AF37",
    financeBlock: true,
  };
  const first = migrateFinancialData(legacyData({
    categories: [...legacyData().categories, customCategory],
    entries: [{
      id: "remuneracao-mensal",
      description: "Remuneração variável",
      category: "Remuneração",
      categoryId: customCategory.id,
      value: 6_500,
      plannedDate: "2026-11-27",
      receivedDate: "",
      status: "pending",
      recurrence: "mensal",
    }],
    expenses: [],
  }), { now: NOW });
  const reloaded = migrateFinancialData(JSON.parse(JSON.stringify(first)), { now: NOW });
  const expected = reloaded.expectedItems.find((item) => item.legacyId === "remuneracao-mensal");
  const recurrence = reloaded.recurrenceRules.find((item) => item.sourceLegacyId === "remuneracao-mensal");

  assert.equal(reloaded.entries[0].category, "Remuneração");
  assert.equal(reloaded.entries[0].categoryId, customCategory.id);
  assert.equal(reloaded.expenses.length, 0);
  assert.equal(expected.direction, "income");
  assert.equal(expected.categoryId, customCategory.id);
  assert.equal(recurrence.direction, "income");
  assert.equal(reloaded.categories.find((item) => item.id === customCategory.id).financeBlock, true);
});

test("preserva a linha de fatura cadastrada ao reabrir", () => {
  const payKey = "2026-08_card-xp";
  const first = migrateFinancialData(legacyData({
    cardPurchases: [],
    invoicePayments: {
      [payKey]: {
        manualEntryEnabled: true,
        manualEntryAmount: 2_122.61,
        manualEntryUpdatedAt: NOW,
      },
    },
  }), { now: NOW });
  const reloaded = migrateFinancialData(JSON.parse(JSON.stringify(first)), { now: NOW });

  assert.equal(reloaded.invoicePayments[payKey].manualEntryEnabled, true);
  assert.equal(reloaded.invoicePayments[payKey].manualEntryAmount, 2_122.61);
  assert.equal(reloaded.cardBills.find((bill) => bill.monthKey === "2026-08").totalMinor, 212_261);
  assert.equal(reloaded.cardBills.find((bill) => bill.monthKey === "2026-08").remainingMinor, 212_261);
});

test("soma fatura cadastrada e compras no saldo projetado do mês", () => {
  const payKey = "2026-08_card-xp";
  const data = migrateFinancialData(legacyData({
    entries: [],
    expenses: [],
    cardPurchases: [{
      id: "purchase-august",
      cardId: "card-xp",
      date: "2026-08-01",
      invoiceDueDate: "2026-08-20",
      description: "Compra do mês",
      category: "Outros",
      totalValue: 100,
      installments: 1,
      currentInstallment: 1,
      status: "open",
    }],
    invoicePayments: {
      [payKey]: {
        manualEntryEnabled: true,
        manualEntryAmount: 200,
        manualEntryUpdatedAt: NOW,
      },
    },
  }), { now: NOW });
  const augustBill = data.cardBills.find((bill) => bill.monthKey === "2026-08");
  const summary = getMonthSummary(data, "2026-08");

  assert.equal(augustBill.totalMinor, 30_000);
  assert.equal(augustBill.remainingMinor, 30_000);
  assert.equal(summary.billsMinor, 30_000);
  assert.equal(summary.projectedFreeMinor, -30_000);
});

test("parcelamento distribui os centavos e preserva exatamente o total", () => {
  const data = migrateFinancialData(legacyData({
    cardPurchases: [{
      id: "three-parts",
      cardId: "card-xp",
      date: "2026-08-01",
      description: "Compra",
      category: "Outros",
      totalValue: 100,
      installments: 3,
      currentInstallment: 1,
      status: "open",
    }],
  }), { now: NOW });
  const values = data.cardBills.map((bill) => bill.totalMinor);

  assert.deepEqual(values, [3_334, 3_333, 3_333]);
  assert.equal(values.reduce((total, value) => total + value, 0), 10_000);
  assert.equal(toMinorUnits(286.4), 28_640);
});

test("backup local da versão legada é criado uma única vez", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  const original = legacyData();
  const storageKey = "faz_meu_controle_v1_user";
  const backupKey = ensureLocalMigrationBackup(storage, storageKey, original);
  const firstBackup = values.get(backupKey);

  ensureLocalMigrationBackup(storage, storageKey, legacyData({ entries: [] }));

  assert.equal(backupKey, `${storageKey}${LOCAL_MIGRATION_BACKUP_SUFFIX}`);
  assert.equal(values.get(backupKey), firstBackup);
  assert.deepEqual(JSON.parse(firstBackup), original);
  assert.equal(
    ensureLocalMigrationBackup(storage, storageKey, migrateFinancialData(original, { now: NOW })),
    null,
  );
});

test("HTML carrega o schema como módulo sem declarações de função duplicadas", async () => {
  const source = await readFile(financialAppUrl, "utf8");
  const names = [...source.matchAll(
    /^\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gmu,
  )].map((match) => match[1]);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);

  assert.match(source, /<script type="module">/u);
  assert.match(source, /from "\.\/finance-schema\.mjs"/u);
  assert.match(source, /ensureLocalMigrationBackup\(localStorage, STORAGE_KEY, parsed\)/u);
  assert.match(source, /data = migrateFinancialData\(data, \{now:data\.updatedAt\}\)/u);
  assert.deepEqual(duplicates, []);
});
