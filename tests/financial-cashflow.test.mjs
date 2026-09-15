import assert from "node:assert/strict";
import test from "node:test";
import { getMonthSummary, getYearSummary } from "../finance-domain.mjs";
import { migrateFinancialData } from "../finance-schema.mjs";

const NOW = "2026-09-15T12:00:00.000Z";
function fixture(payment = {}) {
  return migrateFinancialData({
    settings: {}, categories: [], subcategories: [],
    cards: [{ id: "card-test", name: "Cartão de teste", closingDay: 5, dueDay: 15 }],
    entries: [
      { id: "income", value: 1000, plannedDate: "2026-09-01", receivedDate: "2026-09-01", status: "received" },
      { id: "expected", value: 500, plannedDate: "2026-09-30", status: "pending" },
    ],
    expenses: [{ id: "expense", value: 200, dueDate: "2026-09-05", paymentDate: "2026-09-05", status: "paid" }],
    cardPurchases: [],
    invoicePayments: {
      "2026-09_card-test": { manualEntryEnabled: true, manualEntryAmount: 300, ...payment },
    },
  }, { now: NOW });
}

test("pagar uma fatura reduz a dívida, mantém a saída e não aumenta o saldo projetado", () => {
  const open = fixture();
  const partial = fixture({ status: "partial", paidAmount: 120, paymentDate: "2026-09-10" });
  const paid = fixture({ status: "paid", paidAmount: 300, paymentDate: "2026-09-15" });
  for (const data of [open, partial, paid]) {
    assert.equal(getMonthSummary(data, "2026-09").projectedFreeMinor, 100_000);
  }
  assert.equal(getMonthSummary(open, "2026-09").billsMinor, 30_000);
  assert.equal(getMonthSummary(partial, "2026-09").billsMinor, 18_000);
  assert.equal(getMonthSummary(paid, "2026-09").billsMinor, 0);
  assert.equal(getYearSummary(open, 2026).realizedBalanceMinor, 80_000);
  assert.equal(getYearSummary(partial, 2026).realizedBalanceMinor, 68_000);
  assert.equal(getYearSummary(paid, 2026).realizedBalanceMinor, 50_000);
  assert.equal(getYearSummary(paid, 2026).cardBillPaidMinor, 30_000);
});

test("desmarcar o pagamento restaura a dívida e desfaz a saída realizada", () => {
  const paid = fixture({ status: "paid", paidAmount: 300, paymentDate: "2026-09-15" });
  paid.invoicePayments["2026-09_card-test"] = { manualEntryEnabled: true, manualEntryAmount: 300 };
  const reset = migrateFinancialData(paid, { now: NOW });
  assert.equal(getYearSummary(reset, 2026).realizedBalanceMinor, 80_000);
  assert.equal(getMonthSummary(reset, "2026-09").billsMinor, 30_000);
  assert.equal(getMonthSummary(reset, "2026-09").projectedFreeMinor, 100_000);
});

test("saldo anual soma meses pela data de recebimento e pagamento e exclui pendências", () => {
  const data = fixture({ status: "paid", paidAmount: 300, paymentDate: "2027-01-10" });
  data.movements.push(
    { id: "earlier-income", type: "income", amountMinor: 25_000, occurredAt: "2026-02-01", status: "confirmed" },
    { id: "previous-year", type: "income", amountMinor: 900_000, occurredAt: "2025-12-01", status: "confirmed" },
    { id: "future-expected", type: "income", amountMinor: 900_000, occurredAt: "2026-12-01", status: "pending" },
  );
  assert.equal(getYearSummary(data, 2026).receivedMinor, 125_000);
  assert.equal(getYearSummary(data, 2026).realizedBalanceMinor, 105_000);
  assert.equal(getYearSummary(data, 2027).realizedBalanceMinor, -30_000);
  assert.equal(getMonthSummary(data, "2027-01").paidMinor, 30_000);
});

test("compra e estorno no cartão não duplicam o recebimento nem o pagamento da fatura", () => {
  const data = fixture({ status: "paid", paidAmount: 300, paymentDate: "2026-09-15" });
  data.cardPurchases = [
    { id: "purchase", cardId: "card-test", date: "2026-09-01", invoiceDueDate: "2026-09-15", totalValue: 100, installments: 1 },
    { id: "refund", cardId: "card-test", date: "2026-09-02", invoiceDueDate: "2026-09-15", totalValue: 20, installments: 1, transactionType: "refund" },
  ];
  const migrated = migrateFinancialData(data, { now: NOW });
  const month = getMonthSummary(migrated, "2026-09");
  assert.equal(month.cardBillPaidMinor, 38_000);
  assert.equal(month.refundsMinor, 0);
  assert.equal(month.realizedBalanceMinor, 42_000);
  assert.equal(getYearSummary(migrated, 2026).realizedBalanceMinor, 42_000);
});

test("estorno em conta entra no saldo, sem incluir transferências ou investimentos", () => {
  const data = fixture();
  data.movements.push(
    { id: "refund", type: "refund", amountMinor: 10_000, occurredAt: "2026-09-15", status: "confirmed" },
    { id: "transfer", type: "transfer", amountMinor: 80_000, occurredAt: "2026-09-15", status: "confirmed" },
    { id: "investment", type: "investment", amountMinor: 90_000, occurredAt: "2026-09-15", status: "confirmed" },
  );
  assert.equal(getYearSummary(data, 2026).realizedBalanceMinor, 90_000);
});
