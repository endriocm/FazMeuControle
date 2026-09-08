import assert from "node:assert/strict";
import test from "node:test";
import {
  assignCardPurchaseToBill,
  buildInstallmentSchedule,
  buildNarrativeReport,
  capProjectionMonthKey,
  captureUndoState,
  detectPossibleDuplicate,
  detectRecurringPattern,
  financialPrimaryRecordCount,
  getCardBill,
  getMonthChanges,
  getMonthSummary,
  getProjectionEndMonthKey,
  hasFinancialUserContent,
  MAX_RECURRING_PROJECTION_MONTHS,
  getProjectedFree,
  getSpendingByCategory,
  getUpcomingCommitments,
  matchTransactionToExpected,
  mergeFinancialRecoveryData,
  reconcileExpectedItem,
  restoreUndoState,
  suggestCategory,
} from "../finance-domain.mjs";

test("recuperação combina registros locais exclusivos sem substituir a versão remota", () => {
  const remote = {
    settings: { currentMonth: 7, year: 2026 },
    cards: [{ id: "card-remote", name: "Cartão remoto" }],
    entries: [{ id: "shared", description: "Versão da nuvem" }],
    expenses: [{ id: "remote-expense", description: "Despesa remota" }],
    cardPurchases: [],
    investments: [],
    categories: [{ id: "category-other", name: "Outros", type: "ambos" }],
    subcategories: [],
    accounts: [],
    auditLog: [],
    invoicePayments: { remote_invoice: { status: "open" } },
    financialPlan: { schemaVersion: 1, incomeMinor: 500_000, goals: [], updatedAt: "2026-08-27T12:00:00.000Z" },
  };
  const local = {
    settings: { currentMonth: 6, year: 2025 },
    cards: [
      { id: "card-remote", name: "Versão local antiga" },
      { id: "card-local", name: "Cartão recuperado" },
    ],
    entries: [
      { id: "shared", description: "Versão local antiga" },
      { id: "local-entry", description: "Entrada recuperada" },
    ],
    expenses: [],
    cardPurchases: [{ id: "local-purchase", description: "Compra recuperada" }],
    investments: [],
    categories: [{ id: "category-other-local", name: "Outros", type: "ambos" }],
    subcategories: [],
    accounts: [],
    auditLog: [],
    invoicePayments: { local_invoice: { status: "open" } },
    financialPlan: { schemaVersion: 1, incomeMinor: 650_000, goals: [], updatedAt: "2026-08-28T11:00:00.000Z" },
  };
  const merged = mergeFinancialRecoveryData(remote, local, {
    now: "2026-08-28T12:00:00.000Z",
  });

  assert.equal(financialPrimaryRecordCount(local) > financialPrimaryRecordCount(remote), true);
  assert.equal(merged.entries.find((item) => item.id === "shared").description, "Versão da nuvem");
  assert.ok(merged.entries.some((item) => item.id === "local-entry"));
  assert.ok(merged.cards.some((item) => item.id === "card-local"));
  assert.ok(merged.cardPurchases.some((item) => item.id === "local-purchase"));
  assert.deepEqual(Object.keys(merged.invoicePayments).sort(), ["local_invoice", "remote_invoice"]);
  assert.deepEqual(merged.settings, remote.settings);
  assert.equal(merged.financialPlan.incomeMinor, 650_000);
  assert.equal(merged.updatedAt, "2026-08-28T12:00:00.000Z");
});

function financialFixture() {
  const cardSchedule = buildInstallmentSchedule(120_000, 12, "2026-08-20");
  return {
    schemaVersion: 2,
    categories: [
      { id: "cat-income", name: "Salário" },
      { id: "cat-market", name: "Mercado" },
      { id: "cat-housing", name: "Moradia" },
      { id: "cat-other", name: "Outros" },
    ],
    cards: [{ id: "card-xp", name: "XP", closingDay: 10, dueDay: 20 }],
    movements: [
      {
        id: "income",
        type: "income",
        amountMinor: 850_000,
        description: "Salário",
        categoryId: "cat-income",
        occurredAt: "2026-08-05",
        status: "confirmed",
      },
      {
        id: "market",
        type: "cash_expense",
        amountMinor: 28_640,
        description: "Zaffari",
        categoryId: "cat-market",
        occurredAt: "2026-08-08",
        status: "confirmed",
      },
      {
        id: "card-purchase",
        type: "card_purchase",
        amountMinor: 120_000,
        description: "Notebook",
        categoryId: "cat-market",
        cardId: "card-xp",
        occurredAt: "2026-08-11",
        status: "in_bill",
        installmentPlan: { count: 12, current: 1, schedule: cardSchedule },
      },
      {
        id: "bill-payment",
        type: "card_bill_payment",
        amountMinor: 10_000,
        description: "Pagamento da fatura XP",
        cardId: "card-xp",
        occurredAt: "2026-08-20",
        status: "confirmed",
      },
      {
        id: "transfer",
        type: "transfer",
        amountMinor: 50_000,
        description: "Transferência entre contas",
        occurredAt: "2026-08-09",
        status: "confirmed",
      },
      {
        id: "investment",
        type: "investment",
        amountMinor: 100_000,
        description: "Investimento",
        occurredAt: "2026-08-10",
        status: "confirmed",
      },
      {
        id: "refund",
        type: "refund",
        amountMinor: 5_000,
        description: "Estorno Zaffari",
        categoryId: "cat-market",
        occurredAt: "2026-08-12",
        status: "confirmed",
      },
    ],
    cardBills: [{
      id: "bill-card-xp-2026-08",
      cardId: "card-xp",
      monthKey: "2026-08",
      dueDate: "2026-08-20",
      totalMinor: 10_000,
      paidMinor: 0,
      remainingMinor: 10_000,
      status: "payable",
    }],
    expectedItems: [
      {
        id: "expected-rent",
        legacyId: "rent",
        direction: "expense",
        amountMinor: 300_000,
        description: "Aluguel",
        categoryId: "cat-housing",
        dueDate: "2026-08-20",
        status: "expected",
      },
      {
        id: "expected-extra",
        direction: "income",
        amountMinor: 100_000,
        description: "Freelance",
        categoryId: "cat-income",
        dueDate: "2026-08-25",
        status: "expected",
      },
    ],
  };
}

test("atribui compra à fatura respeitando o fechamento e o vencimento", () => {
  const card = { closingDay: 10, dueDay: 20 };

  assert.deepEqual(assignCardPurchaseToBill(card, "2026-08-10"), {
    monthKey: "2026-08",
    closingDate: "2026-08-10",
    dueDate: "2026-08-20",
  });
  assert.deepEqual(assignCardPurchaseToBill(card, "2026-08-11"), {
    monthKey: "2026-09",
    closingDate: "2026-09-10",
    dueDate: "2026-09-20",
  });
  assert.equal(
    assignCardPurchaseToBill({ closingDay: 25, dueDay: 5 }, "2026-08-20").dueDate,
    "2026-09-05",
  );
});

test("parcelamento distribui centavos deterministicamente e preserva o total", () => {
  const schedule = buildInstallmentSchedule(10_000, 3, "2026-08-20");

  assert.deepEqual(schedule.map((item) => item.amountMinor), [3_334, 3_333, 3_333]);
  assert.deepEqual(schedule.map((item) => item.monthKey), ["2026-08", "2026-09", "2026-10"]);
  assert.equal(schedule.reduce((total, item) => total + item.amountMinor, 0), 10_000);
});

test("resumo calcula livre projetado sem duplicar fatura, transferência ou investimento", () => {
  const data = financialFixture();
  const summary = getMonthSummary(data, "2026-08");

  assert.equal(summary.receivedMinor, 850_000);
  assert.equal(summary.paidMinor, 28_640);
  assert.equal(summary.expectedExpenseMinor, 300_000);
  assert.equal(summary.billsMinor, 10_000);
  assert.equal(summary.committedMinor, 310_000);
  assert.equal(summary.projectedFreeMinor, 616_360);
  assert.equal(getProjectedFree(data, "2026-08"), 616_360);
  assert.equal(summary.complete, true);
});

test("projeta salário mensal por até 24 meses sem duplicar a primeira ocorrência", () => {
  const data = financialFixture();
  data.recurrenceRules = [{
    id: "salary-monthly",
    sourceLegacyId: "salary-entry",
    direction: "income",
    frequency: "mensal",
    amountMinor: 850_000,
    startsAt: "2026-08-05",
    status: "active",
  }];
  data.movements[0].legacyId = "salary-entry";

  const firstMonth = getMonthSummary(data, "2026-08");
  const nextMonth = getMonthSummary(data, "2026-09");
  const lastVisibleMonth = getMonthSummary(data, "2028-07");
  const outsideVisibleWindow = getMonthSummary(data, "2028-08");

  assert.equal(MAX_RECURRING_PROJECTION_MONTHS, 24);
  assert.equal(firstMonth.receivedMinor, 850_000);
  assert.equal(firstMonth.recurringIncomeMinor, 0);
  assert.equal(nextMonth.expectedIncomeMinor, 850_000);
  assert.equal(nextMonth.recurringIncomeMinor, 850_000);
  assert.equal(nextMonth.projectedFreeMinor, 850_000);
  assert.equal(lastVisibleMonth.recurringIncomeMinor, 850_000);
  assert.equal(outsideVisibleWindow.recurringIncomeMinor, 0);
});

test("encerra a navegação no 24º mês contando o mês inicial", () => {
  assert.equal(getProjectionEndMonthKey("2026-09"), "2028-08");
  assert.equal(capProjectionMonthKey("2026-09", "2028-08"), "2028-08");
  assert.equal(capProjectionMonthKey("2026-09", "2028-09"), "2028-08");
  assert.equal(capProjectionMonthKey("2026-09", "2026-08"), "2026-08");
});

test("não deixa um estado vazio de outro dispositivo vencer dados financeiros", () => {
  assert.equal(hasFinancialUserContent({
    settings: { initialBalance: 0, financeStarterBlockDeleted: false },
    categories: [],
    entries: [],
    expenses: [],
    cardPurchases: [],
    invoicePayments: {},
    investments: [],
  }), false);
  assert.equal(hasFinancialUserContent({ entries: [{ id: "salary" }] }), true);
  assert.equal(hasFinancialUserContent({ cards: [{ id: "card" }] }), true);
  assert.equal(hasFinancialUserContent({ investments: [{ id: "cdb" }] }), true);
  assert.equal(hasFinancialUserContent({ categories: [{ id: "rent", financeBlock: true }] }), true);
  assert.equal(hasFinancialUserContent({ financialPlan: { incomeMinor: 650_000, goals: [] } }), true);
  assert.equal(financialPrimaryRecordCount({ financialPlan: { incomeMinor: 650_000 } }), 1);
});

test("pagamento da fatura não duplica consumo e reembolso reduz a categoria", () => {
  const spending = getSpendingByCategory(financialFixture(), "2026-08");
  const market = spending.find((item) => item.categoryId === "cat-market");

  assert.equal(market.amountMinor, 33_640);
  assert.equal(spending.some((item) => item.categoryName.includes("fatura")), false);
});

test("conciliação só sugere candidato único com confiança mínima", () => {
  const data = financialFixture();
  const transaction = {
    type: "cash_expense",
    amountMinor: 300_000,
    description: "Pagamento aluguel",
    categoryId: "cat-housing",
    occurredAt: "2026-08-20",
  };
  const match = matchTransactionToExpected(transaction, data.expectedItems);

  assert.equal(match.candidate.id, "expected-rent");
  assert.ok(match.confidence >= 0.8);
  assert.equal(match.requiresConfirmation, true);

  const ambiguous = matchTransactionToExpected(transaction, [
    data.expectedItems[0],
    { ...data.expectedItems[0], id: "expected-rent-copy" },
  ]);
  assert.equal(ambiguous.candidate, null);
});

test("conciliação relaciona previsto e realizado sem criar outro movimento", () => {
  const data = financialFixture();
  data.movements.push({
    id: "rent-payment",
    type: "cash_expense",
    amountMinor: 300_000,
    description: "Aluguel",
    occurredAt: "2026-08-20",
    status: "confirmed",
  });
  const reconciled = reconcileExpectedItem(
    data,
    "expected-rent",
    "rent-payment",
    "2026-08-20",
  );

  assert.equal(reconciled.movements.length, data.movements.length);
  assert.equal(reconciled.expectedItems[0].status, "matched");
  assert.equal(reconciled.expectedItems[0].matchedMovementId, "rent-payment");
  assert.equal(reconciled.movements.at(-1).expectedItemId, "expected-rent");
});

test("detecta possível duplicidade por valor, data, tipo e descrição", () => {
  const data = financialFixture();
  const result = detectPossibleDuplicate({
    type: "cash_expense",
    amountMinor: 28_640,
    description: "Zaffari",
    occurredAt: "2026-08-08",
  }, data.movements);

  assert.equal(result.duplicate.id, "market");
  assert.equal(result.confidence, 1);
});

test("regra aprendida vence histórico e regra do sistema", () => {
  const suggestion = suggestCategory({
    description: "Zaffari Bourbon",
    categories: financialFixture().categories,
    movements: [{ description: "Zaffari Bourbon", categoryId: "cat-other" }],
    categoryRules: [
      {
        id: "system-market",
        pattern: "zaffari",
        categoryId: "cat-market",
        source: "system",
        priority: 50,
      },
      {
        id: "learned-housing",
        pattern: "zaffari bourbon",
        categoryId: "cat-housing",
        source: "learned",
        learned: true,
        priority: 100,
      },
    ],
  });

  assert.equal(suggestion.categoryId, "cat-housing");
  assert.equal(suggestion.source, "learned_rule");
  assert.equal(suggestion.confidence, 1);
});

test("detecta recorrência mensal somente após três evidências compatíveis", () => {
  const base = [
    { id: "one", type: "cash_expense", description: "Internet", amountMinor: 9_990, occurredAt: "2026-06-10" },
    { id: "two", type: "cash_expense", description: "Internet", amountMinor: 9_990, occurredAt: "2026-07-11" },
    { id: "three", type: "cash_expense", description: "Internet", amountMinor: 10_000, occurredAt: "2026-08-10" },
  ];

  assert.deepEqual(detectRecurringPattern(base.slice(0, 2)), []);
  const [pattern] = detectRecurringPattern(base);
  assert.equal(pattern.frequency, "monthly");
  assert.equal(pattern.requiresConfirmation, true);
  assert.equal(pattern.evidence.length, 3);
});

test("fatura fechada usa snapshot e não é recalculada com nova configuração", () => {
  const data = financialFixture();
  data.cardBills[0] = {
    ...data.cardBills[0],
    status: "paid",
    paidMinor: 9_500,
    remainingMinor: 0,
    closedSnapshot: {
      dueDate: "2026-08-20",
      totalMinor: 9_500,
      installmentRefs: [{ movementId: "old", amountMinor: 9_500 }],
    },
  };
  data.cards[0].closingDay = 2;
  data.cards[0].dueDay = 3;
  const bill = getCardBill(data, "card-xp", "2026-08");

  assert.equal(bill.snapshot, true);
  assert.equal(bill.totalMinor, 9_500);
  assert.equal(bill.dueDate, "2026-08-20");
});

test("próximos compromissos, mudanças e relatório tratam mês vazio com segurança", () => {
  const data = financialFixture();
  const commitments = getUpcomingCommitments(data, "2026-08-15", 3);

  assert.deepEqual(commitments.map((item) => item.id), [
    "expected-rent",
    "bill-card-xp-2026-08",
  ]);
  assert.equal(getMonthChanges(data, "2026-08").length, 3);

  const report = buildNarrativeReport({
    categories: [],
    cards: [],
    movements: [],
    cardBills: [],
    expectedItems: [],
  }, "2026-08");
  assert.equal(report.complete, true);
  assert.equal(report.summary.projectedFreeMinor, 0);
  assert.deepEqual(report.categories, []);
  assert.equal(report.comparison.previousMonthKey, "2026-07");
  assert.equal(report.comparison.movingAverage3MonthsMinor, 0);
});

test("relatorio compara consumo com o mes anterior e media movel de tres meses", () => {
  const data = financialFixture();
  data.movements.push(
    { id: "june", type: "cash_expense", amountMinor: 9_000, categoryId: "cat-market", description: "Junho", occurredAt: "2026-06-10", status: "confirmed" },
    { id: "july", type: "cash_expense", amountMinor: 12_000, categoryId: "cat-market", description: "Julho", occurredAt: "2026-07-10", status: "confirmed" },
  );

  const report = buildNarrativeReport(data, "2026-08");

  assert.equal(report.comparison.previousConsumptionMinor, 12_000);
  assert.equal(report.comparison.consumptionMinor, 33_640);
  assert.equal(report.comparison.differenceMinor, 21_640);
  assert.equal(report.comparison.movingAverage3MonthsMinor, 18_213);
});

test("restaura o estado anterior por desfazer sem compartilhar referencias", () => {
  const original = financialFixture();
  const snapshot = captureUndoState(original, { tab: "movements" });
  original.movements.push({ id: "new-movement" });
  original.categories[0].name = "Alterada";

  const restored = restoreUndoState(snapshot);

  assert.equal(restored.data.movements.some((item) => item.id === "new-movement"), false);
  assert.notEqual(restored.data.categories[0].name, "Alterada");
  assert.equal(restored.state.tab, "movements");
  restored.data.movements.pop();
  assert.notDeepEqual(restored.data.movements, snapshot.data.movements);
});
