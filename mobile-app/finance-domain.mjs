const ACTIVE_EXPECTED_STATUSES = new Set(["expected", "due"]);
const CONFIRMED_MOVEMENT_STATUSES = new Set(["confirmed", "partial", "in_bill"]);
export const MAX_RECURRING_PROJECTION_MONTHS = 24;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function captureUndoState(data, state = {}) {
  return { data: clone(record(data)), state: clone(record(state)) };
}

export function restoreUndoState(snapshot) {
  return {
    data: clone(record(snapshot?.data)),
    state: clone(record(snapshot?.state)),
  };
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function hasFinancialUserContent(value) {
  const data = record(value);
  const contentLists = [
    "entries",
    "expenses",
    "cardPurchases",
    "movements",
    "expectedItems",
    "recurrenceRules",
    "cards",
    "cardBills",
    "investments",
  ];
  if (contentLists.some((field) => list(data[field]).length > 0)) return true;
  if (Object.keys(record(data.invoicePayments)).length > 0) return true;
  if (list(data.categories).some((category) => category?.financeBlock === true)) return true;
  const financialPlan = record(data.financialPlan);
  if (
    Number(financialPlan.incomeMinor || 0) > 0
    || Number(financialPlan.fixedCostMinor || 0) > 0
    || list(financialPlan.goals).length > 0
  ) return true;
  const settings = record(data.settings);
  return Number(settings.initialBalance || 0) !== 0
    || settings.financeStarterBlockDeleted === true;
}

const FINANCIAL_RECOVERY_COLLECTIONS = [
  "accounts",
  "cards",
  "categories",
  "subcategories",
  "entries",
  "expenses",
  "cardPurchases",
  "investments",
  "auditLog",
];

export function financialPrimaryRecordCount(value) {
  const data = record(value);
  const primaryCount = ["cards", "entries", "expenses", "cardPurchases", "investments"]
    .reduce((total, field) => total + list(data[field]).length, 0)
    + Object.keys(record(data.invoicePayments)).length
    + list(data.categories).filter((category) => category?.financeBlock === true).length;
  const normalizedCount = ["movements", "expectedItems", "cardBills"]
    .reduce((total, field) => total + list(data[field]).length, 0);
  const financialPlan = record(data.financialPlan);
  const planningCount = Number(financialPlan.incomeMinor || 0) > 0
    || Number(financialPlan.fixedCostMinor || 0) > 0
    || list(financialPlan.goals).length > 0
    ? 1
    : 0;
  return Math.max(primaryCount, normalizedCount) + planningCount;
}

function selectFinancialRecoveryPlan(remoteValue, localValue) {
  const remotePlan = record(remoteValue);
  const localPlan = record(localValue);
  const remoteHasContent = Number(remotePlan.incomeMinor || 0) > 0 || list(remotePlan.goals).length > 0;
  const localHasContent = Number(localPlan.incomeMinor || 0) > 0 || list(localPlan.goals).length > 0;
  if (!remoteHasContent) return localHasContent ? clone(localPlan) : null;
  if (!localHasContent) return clone(remotePlan);
  const remoteUpdatedAt = Date.parse(text(remotePlan.updatedAt)) || 0;
  const localUpdatedAt = Date.parse(text(localPlan.updatedAt)) || 0;
  return clone(localUpdatedAt > remoteUpdatedAt ? localPlan : remotePlan);
}

function financialRecoveryRecordKey(field, item, index) {
  const source = record(item);
  if (field === "categories") {
    return `category:${normalizeFinancialText(source.type)}:${normalizeFinancialText(source.name)}`;
  }
  if (field === "subcategories") {
    return `subcategory:${normalizeFinancialText(source.category)}:${normalizeFinancialText(source.name || source.subcategory)}`;
  }
  const id = text(source.id);
  return id ? `id:${id}` : `${field}:${index}:${JSON.stringify(source)}`;
}

export function mergeFinancialRecoveryData(remoteValue, localValue, options = {}) {
  const remoteData = record(remoteValue);
  const localData = record(localValue);
  const merged = {
    ...clone(localData),
    ...clone(remoteData),
    settings: { ...clone(record(localData.settings)), ...clone(record(remoteData.settings)) },
    invoicePayments: {
      ...clone(record(localData.invoicePayments)),
      ...clone(record(remoteData.invoicePayments)),
    },
    financialPlan: selectFinancialRecoveryPlan(remoteData.financialPlan, localData.financialPlan),
    updatedAt: text(options.now) || new Date().toISOString(),
  };
  for (const field of FINANCIAL_RECOVERY_COLLECTIONS) {
    const remoteRows = clone(list(remoteData[field]));
    const localRows = clone(list(localData[field]));
    const seen = new Set(remoteRows.map((item, index) => (
      financialRecoveryRecordKey(field, item, index)
    )));
    merged[field] = [...remoteRows];
    localRows.forEach((item, index) => {
      const key = financialRecoveryRecordKey(field, item, index);
      if (seen.has(key)) return;
      seen.add(key);
      merged[field].push(item);
    });
  }
  return merged;
}

function text(value) {
  return String(value ?? "").trim();
}

function monthKeyParts(value) {
  const match = text(value).match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}

function monthOrdinal(value) {
  const parts = monthKeyParts(value);
  return parts ? (parts.year * 12) + parts.month - 1 : null;
}

function monthKeyFromOrdinal(value) {
  const ordinal = Math.trunc(Number(value));
  if (!Number.isFinite(ordinal)) return "";
  const year = Math.floor(ordinal / 12);
  const month = ordinal - (year * 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function projectionVisibleMonthCount(value) {
  const requested = Math.trunc(Number(value));
  return Math.min(
    MAX_RECURRING_PROJECTION_MONTHS,
    Math.max(1, Number.isFinite(requested) ? requested : MAX_RECURRING_PROJECTION_MONTHS),
  );
}

export function getProjectionEndMonthKey(
  startMonthKey,
  visibleMonths = MAX_RECURRING_PROJECTION_MONTHS,
) {
  const start = monthOrdinal(startMonthKey);
  if (start === null) return "";
  return monthKeyFromOrdinal(start + projectionVisibleMonthCount(visibleMonths) - 1);
}

export function capProjectionMonthKey(
  startMonthKey,
  targetMonthKey,
  visibleMonths = MAX_RECURRING_PROJECTION_MONTHS,
) {
  const target = monthOrdinal(targetMonthKey);
  const end = monthOrdinal(getProjectionEndMonthKey(startMonthKey, visibleMonths));
  if (target === null || end === null) return text(targetMonthKey);
  return monthKeyFromOrdinal(Math.min(target, end));
}

export function normalizeFinancialText(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function minor(value) {
  return Number.isSafeInteger(value) ? value : 0;
}

function dateOnly(value) {
  return text(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || "";
}

function monthOf(value) {
  return dateOnly(value).slice(0, 7);
}

function dateParts(value) {
  const match = dateOnly(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match
    ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
    : null;
}

function utcDay(value) {
  const parts = dateParts(value);
  return parts ? Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000 : null;
}

function daysBetween(left, right) {
  const leftDay = utcDay(left);
  const rightDay = utcDay(right);
  return leftDay === null || rightDay === null ? Number.POSITIVE_INFINITY : Math.abs(leftDay - rightDay);
}

function dateFromYearMonthDay(year, month, day) {
  let resolvedYear = Number(year);
  let resolvedMonth = Number(month);
  while (resolvedMonth > 12) {
    resolvedMonth -= 12;
    resolvedYear += 1;
  }
  while (resolvedMonth < 1) {
    resolvedMonth += 12;
    resolvedYear -= 1;
  }
  const lastDay = new Date(Date.UTC(resolvedYear, resolvedMonth, 0)).getUTCDate();
  const resolvedDay = Math.min(Math.max(Number(day) || 1, 1), lastDay);
  return `${resolvedYear}-${String(resolvedMonth).padStart(2, "0")}-${String(resolvedDay).padStart(2, "0")}`;
}

function addMonths(value, offset) {
  const parts = dateParts(value);
  if (!parts) return "";
  return dateFromYearMonthDay(parts.year, parts.month + Number(offset || 0), parts.day);
}

function recurrenceFrequency(value) {
  const normalized = normalizeFinancialText(value);
  if (["weekly", "semanal"].includes(normalized)) return { kind: "days", step: 7 };
  if (["biweekly", "fortnightly", "quinzenal"].includes(normalized)) return { kind: "days", step: 15 };
  if (["monthly", "mensal"].includes(normalized)) return { kind: "months", step: 1 };
  if (["bimonthly", "bimestral"].includes(normalized)) return { kind: "months", step: 2 };
  if (["quarterly", "trimestral"].includes(normalized)) return { kind: "months", step: 3 };
  if (["semiannual", "semestral"].includes(normalized)) return { kind: "months", step: 6 };
  if (["annual", "yearly", "anual"].includes(normalized)) return { kind: "months", step: 12 };
  return null;
}

function recurrenceOccurrencesInMonth(rule, targetMonthKey) {
  const start = dateParts(rule?.startsAt);
  const target = dateParts(`${targetMonthKey}-01`);
  const frequency = recurrenceFrequency(rule?.frequency);
  if (!start || !target || !frequency) return 0;
  const distance = ((target.year - start.year) * 12) + (target.month - start.month);
  if (distance < 0 || distance >= MAX_RECURRING_PROJECTION_MONTHS) return 0;

  if (frequency.kind === "months") {
    return distance % frequency.step === 0 ? 1 : 0;
  }

  const startDay = utcDay(rule.startsAt);
  const monthStart = utcDay(`${targetMonthKey}-01`);
  const nextMonthStart = utcDay(dateFromYearMonthDay(target.year, target.month + 1, 1));
  const monthEnd = nextMonthStart === null ? null : nextMonthStart - 1;
  if (startDay === null || monthStart === null || monthEnd === null || startDay > monthEnd) return 0;
  const firstOffset = Math.max(0, Math.ceil((monthStart - startDay) / frequency.step));
  const firstOccurrence = startDay + (firstOffset * frequency.step);
  return firstOccurrence > monthEnd
    ? 0
    : Math.floor((monthEnd - firstOccurrence) / frequency.step) + 1;
}

function legacyOccurrenceCount(data, rule, targetMonthKey, direction) {
  const sourceLegacyId = text(rule?.sourceLegacyId);
  if (!sourceLegacyId) return 0;
  const movementCount = list(data.movements)
    .filter((movement) => movement.legacyId === sourceLegacyId)
    .filter((movement) => transactionDirection(movement) === direction)
    .filter((movement) => monthOf(movement.occurredAt) === targetMonthKey)
    .length;
  const expectedCount = list(data.expectedItems)
    .filter((item) => item.legacyId === sourceLegacyId)
    .filter((item) => item.direction === direction)
    .filter((item) => monthOf(item.dueDate) === targetMonthKey)
    .length;
  return movementCount + expectedCount;
}

function recurringAmountMinor(data, targetMonthKey, direction) {
  return list(data.recurrenceRules)
    .filter((rule) => (rule.status || "active") === "active" && rule.direction === direction)
    .reduce((total, rule) => {
      const occurrences = recurrenceOccurrencesInMonth(rule, targetMonthKey);
      const alreadyRepresented = legacyOccurrenceCount(data, rule, targetMonthKey, direction);
      const projectedOccurrences = Math.max(0, occurrences - alreadyRepresented);
      return total + (projectedOccurrences * minor(rule.amountMinor));
    }, 0);
}

function categoryName(data, categoryId) {
  return list(data.categories).find((category) => category.id === categoryId)?.name || "Outros";
}

function transactionDirection(transaction) {
  return transaction.type === "income" || transaction.type === "refund"
    ? "income"
    : "expense";
}

function isConfirmedMovement(movement) {
  return CONFIRMED_MOVEMENT_STATUSES.has(movement.status || "confirmed");
}

function isOpenExpected(item) {
  return ACTIVE_EXPECTED_STATUSES.has(item.status || "expected")
    && !item.matchedMovementId;
}

function isBillOpen(bill) {
  return !["paid", "cancelled"].includes(bill.status)
    && minor(bill.remainingMinor) > 0;
}

export function assignCardPurchaseToBill(card, purchaseDate) {
  const purchase = dateParts(purchaseDate);
  if (!purchase) return null;
  const closingDay = Math.min(31, Math.max(1, Number(card?.closingDay) || 1));
  const dueDay = Math.min(31, Math.max(1, Number(card?.dueDay) || 1));
  const invoiceOffset = purchase.day > closingDay ? 1 : 0;
  const invoiceDate = dateFromYearMonthDay(
    purchase.year,
    purchase.month + invoiceOffset,
    closingDay,
  );
  const invoice = dateParts(invoiceDate);
  const dueMonthOffset = dueDay <= closingDay ? 1 : 0;
  const dueDate = dateFromYearMonthDay(
    invoice.year,
    invoice.month + dueMonthOffset,
    dueDay,
  );
  return {
    monthKey: monthOf(dueDate),
    closingDate: invoiceDate,
    dueDate,
  };
}

export function buildInstallmentSchedule(
  totalMinor,
  installmentCount,
  firstDueDate,
  currentInstallment = 1,
) {
  const total = Math.max(0, minor(totalMinor));
  const count = Math.max(1, Math.trunc(Number(installmentCount) || 1));
  const current = Math.min(count, Math.max(1, Math.trunc(Number(currentInstallment) || 1)));
  const base = Math.floor(total / count);
  const remainder = total - (base * count);
  return Array.from({ length: count - current + 1 }, (_, index) => {
    const number = current + index;
    const amountMinor = base + (number <= remainder ? 1 : 0);
    const dueDate = addMonths(firstDueDate, index);
    return {
      number,
      total: count,
      amountMinor,
      dueDate,
      monthKey: monthOf(dueDate),
    };
  });
}

export function getCardBill(data, cardId, targetMonthKey) {
  const storedBill = list(data.cardBills).find(
    (bill) => bill.cardId === cardId && bill.monthKey === targetMonthKey,
  );
  if (storedBill?.closedSnapshot) {
    return {
      ...clone(storedBill.closedSnapshot),
      id: storedBill.id,
      cardId,
      monthKey: targetMonthKey,
      status: storedBill.status,
      paidMinor: minor(storedBill.paidMinor),
      remainingMinor: minor(storedBill.remainingMinor),
      snapshot: true,
    };
  }
  if (storedBill) return { ...clone(storedBill), snapshot: false };

  const installments = list(data.movements)
    .filter((movement) => movement.cardId === cardId && movement.type === "card_purchase")
    .flatMap((movement) => list(movement.installmentPlan?.schedule)
      .filter((installment) => installment.monthKey === targetMonthKey)
      .map((installment) => ({ movementId: movement.id, ...installment })));
  if (!installments.length) return null;
  const totalMinor = installments.reduce((total, item) => total + minor(item.amountMinor), 0);
  return {
    id: `bill_${cardId}_${targetMonthKey}`,
    cardId,
    monthKey: targetMonthKey,
    totalMinor,
    paidMinor: 0,
    remainingMinor: totalMinor,
    status: "open",
    installmentRefs: installments,
    snapshot: false,
  };
}

export function getSpendingByCategory(data, targetMonthKey) {
  const totals = new Map();
  const add = (categoryId, amount) => {
    const key = categoryId || "category_other";
    totals.set(key, (totals.get(key) || 0) + amount);
  };

  list(data.movements).forEach((movement) => {
    if (!isConfirmedMovement(movement)) return;
    if (movement.type === "cash_expense" && monthOf(movement.occurredAt) === targetMonthKey) {
      add(movement.categoryId, minor(movement.amountMinor));
      return;
    }
    if (movement.type === "card_purchase") {
      const schedule = list(movement.installmentPlan?.schedule);
      if (schedule.length) {
        schedule
          .filter((installment) => installment.monthKey === targetMonthKey)
          .forEach((installment) => add(movement.categoryId, minor(installment.amountMinor)));
      } else if (monthOf(movement.occurredAt) === targetMonthKey) {
        add(movement.categoryId, minor(movement.amountMinor));
      }
      return;
    }
    if (movement.type === "refund" && monthOf(movement.occurredAt) === targetMonthKey) {
      add(movement.categoryId, -minor(movement.amountMinor));
    }
  });

  const totalMinor = [...totals.values()].reduce((total, value) => total + Math.max(0, value), 0);
  return [...totals.entries()]
    .map(([categoryId, amountMinor]) => ({
      categoryId,
      categoryName: categoryName(data, categoryId),
      amountMinor,
      share: totalMinor > 0 ? Math.max(0, amountMinor) / totalMinor : 0,
    }))
    .filter((item) => item.amountMinor !== 0)
    .sort((left, right) => right.amountMinor - left.amountMinor);
}

export function getMonthSummary(data, targetMonthKey) {
  try {
    const movements = list(data.movements).filter(isConfirmedMovement);
    const receivedMinor = movements
      .filter((movement) => movement.type === "income" && monthOf(movement.occurredAt) === targetMonthKey)
      .reduce((total, movement) => total + minor(movement.amountMinor), 0);
    const refundsMinor = movements
      .filter((movement) => movement.type === "refund" && monthOf(movement.occurredAt) === targetMonthKey)
      .reduce((total, movement) => total + minor(movement.amountMinor), 0);
    const paidMinor = movements
      .filter((movement) => movement.type === "cash_expense" && monthOf(movement.occurredAt) === targetMonthKey)
      .reduce((total, movement) => total + minor(movement.amountMinor), 0);
    const explicitExpectedIncomeMinor = list(data.expectedItems)
      .filter((item) => isOpenExpected(item)
        && item.direction === "income"
        && monthOf(item.dueDate) === targetMonthKey)
      .reduce((total, item) => total + minor(item.amountMinor), 0);
    const explicitExpectedExpenseMinor = list(data.expectedItems)
      .filter((item) => isOpenExpected(item)
        && item.direction === "expense"
        && monthOf(item.dueDate) === targetMonthKey
        && !item.billId)
      .reduce((total, item) => total + minor(item.amountMinor), 0);
    const recurringIncomeMinor = recurringAmountMinor(data, targetMonthKey, "income");
    const recurringExpenseMinor = recurringAmountMinor(data, targetMonthKey, "expense");
    const expectedIncomeMinor = explicitExpectedIncomeMinor + recurringIncomeMinor;
    const expectedExpenseMinor = explicitExpectedExpenseMinor + recurringExpenseMinor;
    const billsMinor = list(data.cardBills)
      .filter((bill) => isBillOpen(bill) && bill.monthKey === targetMonthKey)
      .reduce((total, bill) => total + minor(bill.remainingMinor), 0);
    const committedMinor = expectedExpenseMinor + billsMinor;
    const projectedFreeMinor = receivedMinor
      + refundsMinor
      - paidMinor
      + expectedIncomeMinor
      - committedMinor;
    return {
      monthKey: targetMonthKey,
      receivedMinor,
      refundsMinor,
      paidMinor,
      expectedIncomeMinor,
      expectedExpenseMinor,
      recurringIncomeMinor,
      recurringExpenseMinor,
      billsMinor,
      committedMinor,
      projectedFreeMinor,
      spendingByCategory: getSpendingByCategory(data, targetMonthKey),
      complete: true,
      error: null,
    };
  } catch (error) {
    return {
      monthKey: targetMonthKey,
      receivedMinor: 0,
      refundsMinor: 0,
      paidMinor: 0,
      expectedIncomeMinor: 0,
      expectedExpenseMinor: 0,
      billsMinor: 0,
      committedMinor: 0,
      projectedFreeMinor: 0,
      spendingByCategory: [],
      complete: false,
      error: text(error?.message) || "Falha ao calcular o mês.",
    };
  }
}

export function getProjectedFree(data, targetMonthKey) {
  return getMonthSummary(data, targetMonthKey).projectedFreeMinor;
}

function tokenSimilarity(left, right) {
  const leftTokens = new Set(normalizeFinancialText(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeFinancialText(right).split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

export function matchTransactionToExpected(transaction, expectedItems, options = {}) {
  const direction = transaction.direction || transactionDirection(transaction);
  const transactionDate = transaction.occurredAt || transaction.date;
  const candidates = list(expectedItems)
    .filter((item) => isOpenExpected(item) && item.direction === direction)
    .map((item) => {
      const amount = minor(transaction.amountMinor);
      const expectedAmount = minor(item.amountMinor);
      const amountDifference = Math.abs(amount - expectedAmount);
      const amountTolerance = Math.max(100, Math.round(expectedAmount * 0.01));
      if (amountDifference > amountTolerance) return null;
      const dayDifference = daysBetween(transactionDate, item.dueDate);
      if (dayDifference > 7) return null;
      const amountScore = amountDifference === 0
        ? 0.5
        : 0.4 * (1 - (amountDifference / amountTolerance));
      const dateScore = dayDifference === 0 ? 0.25 : dayDifference <= 3 ? 0.2 : 0.1;
      const descriptionScore = tokenSimilarity(transaction.description, item.description) * 0.15;
      const categoryScore = transaction.categoryId
        && item.categoryId
        && transaction.categoryId === item.categoryId
        ? 0.1
        : 0;
      return {
        item,
        confidence: Math.round((amountScore + dateScore + descriptionScore + categoryScore) * 100) / 100,
        amountDifference,
        dayDifference,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.confidence - left.confidence);
  const best = candidates[0] || null;
  const runnerUp = candidates[1] || null;
  const minimumConfidence = options.minimumConfidence ?? 0.8;
  const minimumGap = options.minimumGap ?? 0.1;
  const uniqueEnough = best && (!runnerUp || best.confidence - runnerUp.confidence >= minimumGap);
  return {
    candidate: best && best.confidence >= minimumConfidence && uniqueEnough ? best.item : null,
    confidence: best?.confidence || 0,
    alternatives: candidates.map((candidate) => ({
      id: candidate.item.id,
      confidence: candidate.confidence,
    })),
    requiresConfirmation: Boolean(best && best.confidence >= minimumConfidence && uniqueEnough),
  };
}

export function reconcileExpectedItem(data, expectedItemId, movementId, occurredAt) {
  const next = clone(record(data));
  const expected = list(next.expectedItems).find((item) => item.id === expectedItemId);
  const movement = list(next.movements).find((item) => item.id === movementId);
  if (!expected || !movement) return next;
  expected.status = "matched";
  expected.matchedMovementId = movementId;
  expected.matchedAt = occurredAt || movement.occurredAt;
  movement.expectedItemId = expectedItemId;
  return next;
}

export function detectPossibleDuplicate(transaction, movements) {
  const normalizedDescription = normalizeFinancialText(transaction.description);
  const candidates = list(movements)
    .filter((movement) => movement.type === transaction.type)
    .filter((movement) => minor(movement.amountMinor) === minor(transaction.amountMinor))
    .map((movement) => {
      const sameDescription = normalizeFinancialText(movement.description) === normalizedDescription;
      const dayDifference = daysBetween(
        movement.occurredAt,
        transaction.occurredAt || transaction.date,
      );
      return {
        movement,
        sameDescription,
        dayDifference,
        confidence: sameDescription && dayDifference === 0
          ? 1
          : sameDescription && dayDifference <= 1
            ? 0.9
            : dayDifference === 0
              ? 0.75
              : 0,
      };
    })
    .filter((candidate) => candidate.confidence >= 0.75)
    .sort((left, right) => right.confidence - left.confidence);
  return {
    duplicate: candidates[0]?.confidence >= 0.9 ? candidates[0].movement : null,
    confidence: candidates[0]?.confidence || 0,
    candidates: candidates.map((candidate) => candidate.movement.id),
  };
}

function ruleMatches(rule, description) {
  const normalized = normalizeFinancialText(description);
  const terms = normalizeFinancialText(rule.pattern || rule.merchant || "")
    .split(" ")
    .filter((term) => term.length >= 2);
  return terms.length > 0 && terms.every((term) => normalized.includes(term));
}

export function suggestCategory({
  description,
  categoryRules = [],
  movements = [],
  categories = [],
}) {
  const activeRules = list(categoryRules).filter((rule) => rule.active !== false);
  const learnedRule = activeRules
    .filter((rule) => rule.learned === true || rule.source === "learned")
    .filter((rule) => ruleMatches(rule, description))
    .sort((left, right) => Number(right.priority || 100) - Number(left.priority || 100))[0];
  if (learnedRule?.categoryId) {
    return {
      categoryId: learnedRule.categoryId,
      confidence: 1,
      source: "learned_rule",
      ruleId: learnedRule.id,
    };
  }

  const merchantKey = normalizeFinancialText(description);
  const history = list(movements)
    .filter((movement) => movement.categoryId)
    .filter((movement) => normalizeFinancialText(movement.description) === merchantKey);
  if (history.length) {
    const counts = new Map();
    history.forEach((movement) => {
      counts.set(movement.categoryId, (counts.get(movement.categoryId) || 0) + 1);
    });
    const [categoryId, count] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
    return {
      categoryId,
      confidence: Math.min(0.95, 0.7 + (count * 0.05)),
      source: "merchant_history",
      ruleId: null,
    };
  }

  const systemRule = activeRules
    .filter((rule) => rule.source === "system" || rule.learned !== true)
    .filter((rule) => ruleMatches(rule, description))
    .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0))[0];
  if (systemRule?.categoryId) {
    return {
      categoryId: systemRule.categoryId,
      confidence: 0.65,
      source: "system_rule",
      ruleId: systemRule.id,
    };
  }

  const fallback = list(categories).find(
    (category) => normalizeFinancialText(category.name) === "outros",
  );
  return {
    categoryId: fallback?.id || categories[0]?.id || null,
    confidence: 0.2,
    source: "fallback",
    ruleId: null,
  };
}

export function detectRecurringPattern(movements) {
  const groups = new Map();
  list(movements)
    .filter((movement) => movement.occurredAt && movement.description)
    .forEach((movement) => {
      const key = `${movement.type}:${normalizeFinancialText(movement.description)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(movement);
    });
  const patterns = [];
  groups.forEach((items, key) => {
    const sorted = items
      .slice()
      .sort((left, right) => text(left.occurredAt).localeCompare(text(right.occurredAt)))
      .slice(-4);
    if (sorted.length < 3) return;
    const amounts = sorted.map((item) => minor(item.amountMinor));
    const average = amounts.reduce((total, amount) => total + amount, 0) / amounts.length;
    const amountVariation = average
      ? (Math.max(...amounts) - Math.min(...amounts)) / average
      : 0;
    const days = sorted.map((item) => dateParts(item.occurredAt)?.day || 0);
    const dayVariation = Math.max(...days) - Math.min(...days);
    const monthIndexes = sorted.map((item) => {
      const parts = dateParts(item.occurredAt);
      return parts ? (parts.year * 12) + parts.month : 0;
    });
    const intervals = monthIndexes.slice(1).map((month, index) => month - monthIndexes[index]);
    if (amountVariation <= 0.05 && dayVariation <= 5 && intervals.every((value) => value === 1)) {
      patterns.push({
        key,
        type: sorted.at(-1).type,
        description: sorted.at(-1).description,
        categoryId: sorted.at(-1).categoryId || null,
        frequency: "monthly",
        amountMinor: Math.round(average),
        evidence: sorted.map((item) => item.id),
        confidence: Math.min(1, 0.8 + ((sorted.length - 3) * 0.1)),
        requiresConfirmation: true,
      });
    }
  });
  return patterns;
}

export function getUpcomingCommitments(data, fromDate, limit = 5) {
  const expected = list(data.expectedItems)
    .filter((item) => isOpenExpected(item) && item.direction === "expense")
    .map((item) => ({
      id: item.id,
      kind: "expected",
      description: item.description,
      dueDate: item.dueDate,
      amountMinor: minor(item.amountMinor),
      status: item.status,
    }));
  const bills = list(data.cardBills)
    .filter(isBillOpen)
    .map((bill) => ({
      id: bill.id,
      kind: "card_bill",
      description: `Fatura ${data.cards?.find((card) => card.id === bill.cardId)?.name || "do cartão"}`,
      dueDate: bill.dueDate,
      amountMinor: minor(bill.remainingMinor),
      status: bill.status,
    }));
  return [...expected, ...bills]
    .filter((item) => !fromDate || item.dueDate >= fromDate)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
    .slice(0, Math.max(0, Number(limit) || 5));
}

export function getMonthChanges(data, targetMonthKey) {
  const [year, month] = targetMonthKey.split("-").map(Number);
  const previousKey = month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, "0")}`;
  const current = getMonthSummary(data, targetMonthKey);
  const previous = getMonthSummary(data, previousKey);
  const changes = [
    {
      id: "projected_free",
      title: "Livre projetado",
      currentMinor: current.projectedFreeMinor,
      previousMinor: previous.projectedFreeMinor,
    },
    {
      id: "spending",
      title: "Gastos pagos",
      currentMinor: current.paidMinor,
      previousMinor: previous.paidMinor,
    },
    {
      id: "committed",
      title: "Compromissos restantes",
      currentMinor: current.committedMinor,
      previousMinor: previous.committedMinor,
    },
  ].map((change) => ({
    ...change,
    differenceMinor: change.currentMinor - change.previousMinor,
    direction: change.currentMinor === change.previousMinor
      ? "stable"
      : change.currentMinor > change.previousMinor
        ? "up"
        : "down",
  }));
  return changes
    .sort((left, right) => Math.abs(right.differenceMinor) - Math.abs(left.differenceMinor))
    .slice(0, 3);
}

export function buildNarrativeReport(data, targetMonthKey) {
  const summary = getMonthSummary(data, targetMonthKey);
  const changes = getMonthChanges(data, targetMonthKey);
  const categories = getSpendingByCategory(data, targetMonthKey).slice(0, 5);
  const monthKeys = [0, -1, -2].map((offset) => monthOf(addMonths(`${targetMonthKey}-01`, offset)));
  const consumptionFor = (monthKey) => getSpendingByCategory(data, monthKey)
    .reduce((total, item) => total + Math.max(0, minor(item.amountMinor)), 0);
  const consumptionMinor = consumptionFor(targetMonthKey);
  const previousConsumptionMinor = consumptionFor(monthKeys[1]);
  const movingAverage3MonthsMinor = Math.round(
    monthKeys.reduce((total, monthKey) => total + consumptionFor(monthKey), 0) / monthKeys.length,
  );
  return {
    monthKey: targetMonthKey,
    summary,
    changes,
    categories,
    comparison: {
      previousMonthKey: monthKeys[1],
      consumptionMinor,
      previousConsumptionMinor,
      differenceMinor: consumptionMinor - previousConsumptionMinor,
      movingAverage3MonthsMinor,
    },
    headline: summary.projectedFreeMinor >= 0
      ? "O mês mantém espaço livre projetado."
      : "Os compromissos superam o valor livre projetado.",
    complete: summary.complete,
  };
}
