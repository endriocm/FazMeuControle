export const FINANCIAL_SCHEMA_VERSION = 2;
export const FINANCIAL_DATA_VERSION = "2.0.0";
export const FINANCIAL_TIME_ZONE = "America/Sao_Paulo";
export const LOCAL_MIGRATION_BACKUP_SUFFIX = "__backup_schema_v1";

const MOVEMENT_TYPES = new Set([
  "income",
  "cash_expense",
  "card_purchase",
  "card_bill_payment",
  "transfer",
  "investment",
  "refund",
  "adjustment",
]);

const SYSTEM_CATEGORY_RULES = [
  ["mercado", "Mercado"],
  ["supermercado", "Mercado"],
  ["ifood", "Alimentação"],
  ["restaurante", "Alimentação"],
  ["farmacia", "Farmácia"],
  ["uber", "Transporte"],
  ["posto", "Combustível"],
  ["aluguel", "Aluguel/Financiamento"],
  ["condominio", "Condomínio"],
  ["internet", "Internet"],
  ["energia", "Luz"],
  ["salario", "Salário"],
];

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function dateOnly(value, fallback = "") {
  const match = text(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : fallback;
}

export function dateInFinancialTimeZone(value = new Date()) {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FINANCIAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function monthKey(value) {
  return dateOnly(value).slice(0, 7);
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
  const match = dateOnly(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return dateFromYearMonthDay(
    Number(match[1]),
    Number(match[2]) + Number(offset || 0),
    Number(match[3]),
  );
}

function safeId(value, fallback) {
  return text(value) || fallback;
}

function uniqueId(base, seen) {
  let candidate = safeId(base, "item");
  let suffix = 2;
  while (seen.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  seen.add(candidate);
  return candidate;
}

function normalizeEntityIds(value, prefix) {
  const seen = new Set();
  return list(value).map((item, index) => {
    const normalized = { ...record(item) };
    const base = safeId(normalized.id, `${prefix}_${index + 1}`);
    return {
      ...normalized,
      id: uniqueId(base, seen),
    };
  });
}

export function toMinorUnits(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round((numeric + Number.EPSILON) * 100);
}

export function fromMinorUnits(value) {
  return Number.isSafeInteger(value) ? value / 100 : 0;
}

export function isFinancialDataV2(value) {
  return record(value).schemaVersion === FINANCIAL_SCHEMA_VERSION;
}

export function isRecognizedFinancialData(value) {
  const data = record(value);
  if (isFinancialDataV2(data)) {
    return [
      "accounts",
      "cards",
      "movements",
      "cardBills",
      "expectedItems",
      "recurrenceRules",
      "categoryRules",
      "categories",
      "auditLog",
    ].every((field) => Array.isArray(data[field]));
  }
  return ["cards", "entries", "expenses"].every((field) => Array.isArray(data[field]));
}

function categoryIdFor(data, categoryName) {
  const normalized = normalizeText(categoryName);
  return list(data.categories).find((category) => normalizeText(category.name) === normalized)?.id
    || list(data.categories).find((category) => normalizeText(category.name) === "outros")?.id
    || null;
}

function categoryIdForItem(data, item) {
  const explicitId = text(item?.categoryId);
  if (explicitId && list(data.categories).some((category) => category.id === explicitId)) {
    return explicitId;
  }
  return categoryIdFor(data, item?.category);
}

function movementTypeForExpense(expense) {
  const category = normalizeText(expense.category);
  if (category.includes("transfer")) return "transfer";
  if (category.includes("invest")) return "investment";
  if (expense.cardId || normalizeText(expense.paymentMethod).includes("cartao")) {
    return "card_purchase";
  }
  return "cash_expense";
}

function normalizeCard(card, index, accountId) {
  const normalizedCard = { ...record(card) };
  delete normalizedCard.defaultTag;
  return {
    ...normalizedCard,
    id: safeId(card?.id, `card_${index + 1}`),
    name: text(card?.name) || `Cartão ${index + 1}`,
    accountId: card?.accountId || accountId || null,
    last4: text(card?.last4).replace(/\D/g, "").slice(-4),
    limitMinor: Math.max(0, Number.isSafeInteger(card?.limitMinor)
      ? card.limitMinor
      : toMinorUnits(card?.limit)),
    closingDay: Math.min(31, Math.max(1, Number(card?.closingDay) || 1)),
    dueDay: Math.min(31, Math.max(1, Number(card?.dueDay) || 1)),
    status: card?.status === "inactive" ? "inactive" : "active",
  };
}

function buildAccounts(data) {
  const existing = normalizeEntityIds(
    list(data.accounts).filter((account) => Object.keys(record(account)).length > 0),
    "account",
  );
  if (existing.length) {
    return existing.map((account, index) => ({
      ...record(account),
      id: safeId(account.id, `account_${index + 1}`),
      name: text(account.name) || `Conta ${index + 1}`,
      currency: text(account.currency) || text(data.settings?.currency) || "BRL",
      openingBalanceMinor: Number.isSafeInteger(account.openingBalanceMinor)
        ? account.openingBalanceMinor
        : toMinorUnits(account.openingBalance),
      includeInCash: account.includeInCash === true,
      isDefault: account.isDefault === true || (index === 0 && !existing.some((item) => item.isDefault)),
    }));
  }
  const year = Number(data.settings?.initialBalanceYear || data.settings?.year || new Date().getFullYear());
  const month = Math.min(12, Math.max(1, Number(data.settings?.startMonth || 0) + 1));
  return [{
    id: "account_main",
    name: "Conta principal",
    type: "checking",
    currency: text(data.settings?.currency) || "BRL",
    openingBalanceMinor: toMinorUnits(data.settings?.initialBalance),
    openingBalanceDate: dateFromYearMonthDay(year, month, 1),
    includeInCash: false,
    isDefault: true,
  }];
}

function buildInstallments(purchase, card) {
  const installments = Math.max(1, Number(purchase.installments) || 1);
  const currentInstallment = Math.min(
    installments,
    Math.max(1, Number(purchase.currentInstallment) || 1),
  );
  const purchaseDate = dateOnly(purchase.date, dateOnly(purchase.invoiceDueDate));
  const closingDay = Math.min(31, Math.max(1, Number(card?.closingDay) || 1));
  const dueDay = Math.min(31, Math.max(1, Number(card?.dueDay) || 1));
  const purchaseParts = purchaseDate.split("-").map(Number);
  const firstDueDate = dateOnly(purchase.invoiceDueDate) || (() => {
    if (purchaseParts.length !== 3) return purchaseDate;
    const invoiceOffset = purchaseParts[2] > closingDay ? 1 : 0;
    const dueOffset = dueDay <= closingDay ? 1 : 0;
    return dateFromYearMonthDay(
      purchaseParts[0],
      purchaseParts[1] + invoiceOffset + dueOffset,
      dueDay,
    );
  })();
  const totalMinor = Math.abs(toMinorUnits(purchase.totalValue));
  const explicitInstallmentMinor = Math.abs(toMinorUnits(purchase.installmentValue));
  const scheduledCount = installments - currentInstallment + 1;

  if (purchase.importedInvoiceMonth) {
    const importedDueDate = dateOnly(purchase.invoiceDueDate)
      || `${purchase.importedInvoiceMonth}-${String(dueDay).padStart(2, "0")}`;
    return [{
      number: currentInstallment,
      total: installments,
      amountMinor: explicitInstallmentMinor || totalMinor,
      dueDate: importedDueDate,
      monthKey: purchase.importedInvoiceMonth,
    }];
  }

  const installmentTotalMinor = totalMinor
    || (explicitInstallmentMinor * installments);
  const baseMinor = Math.floor(installmentTotalMinor / installments);
  const remainder = installmentTotalMinor - (baseMinor * installments);
  return Array.from({ length: scheduledCount }, (_, index) => {
    const installmentNumber = currentInstallment + index;
    const amountMinor = baseMinor + (installmentNumber <= remainder ? 1 : 0);
    const dueDate = addMonths(firstDueDate, index);
    return {
      number: installmentNumber,
      total: installments,
      amountMinor,
      dueDate,
      monthKey: monthKey(dueDate),
    };
  });
}

function buildNormalizedCollections(data, options) {
  const today = dateOnly(options.today) || dateInFinancialTimeZone(options.now || new Date());
  const movements = [];
  const expectedItems = [];
  const recurrenceRules = [];
  const movementIds = new Set();
  const expectedIds = new Set();
  const recurrenceIds = new Set();
  const defaultAccountId = data.accounts.find((account) => account.isDefault)?.id
    || data.accounts[0]?.id
    || null;

  list(data.entries).forEach((entry, index) => {
    const legacyId = safeId(entry.id, `entry_${index + 1}`);
    const amountMinor = Math.abs(toMinorUnits(entry.value));
    const plannedDate = dateOnly(entry.plannedDate, today);
    const receivedDate = dateOnly(entry.receivedDate);
    const categoryId = categoryIdForItem(data, entry);
    if (entry.status === "received" || receivedDate) {
      movements.push({
        id: uniqueId(`movement_entry_${legacyId}`, movementIds),
        legacyId,
        type: "income",
        amountMinor,
        accountId: entry.accountId || defaultAccountId,
        categoryId,
        description: text(entry.description) || "Entrada",
        status: "confirmed",
        occurredAt: receivedDate || plannedDate,
        source: text(entry.source) || "legacy_entry",
        notes: text(entry.notes),
      });
    } else {
      expectedItems.push({
        id: uniqueId(`expected_entry_${legacyId}`, expectedIds),
        legacyId,
        direction: "income",
        amountMinor,
        accountId: entry.accountId || defaultAccountId,
        categoryId,
        description: text(entry.description) || "Entrada esperada",
        dueDate: plannedDate,
        status: plannedDate < today ? "due" : "expected",
        source: "legacy_entry",
      });
    }
    if (text(entry.recurrence) && entry.recurrence !== "única") {
      recurrenceRules.push({
        id: uniqueId(`recurrence_entry_${legacyId}`, recurrenceIds),
        sourceLegacyId: legacyId,
        direction: "income",
        frequency: entry.recurrence,
        amountMinor,
        description: text(entry.description),
        categoryId,
        startsAt: plannedDate,
        status: "active",
        confirmedByUser: true,
      });
    }
  });

  list(data.expenses).forEach((expense, index) => {
    const legacyId = safeId(expense.id, `expense_${index + 1}`);
    const amountMinor = Math.abs(toMinorUnits(expense.value));
    const dueDate = dateOnly(expense.dueDate, today);
    const paymentDate = dateOnly(expense.paymentDate);
    const purchaseDate = dateOnly(expense.purchaseDate, dueDate);
    const categoryId = categoryIdForItem(data, expense);
    const type = movementTypeForExpense(expense);
    const isActual = type === "card_purchase"
      || expense.status === "paid"
      || expense.status === "partial"
      || paymentDate;
    if (isActual) {
      movements.push({
        id: uniqueId(`movement_expense_${legacyId}`, movementIds),
        legacyId,
        type,
        amountMinor,
        accountId: expense.accountId || defaultAccountId,
        cardId: expense.cardId || null,
        categoryId,
        description: text(expense.description) || "Gasto",
        status: type === "card_purchase"
          ? "in_bill"
          : (expense.status === "partial" ? "partial" : "confirmed"),
        occurredAt: type === "card_purchase" ? purchaseDate : (paymentDate || dueDate),
        dueDate,
        source: text(expense.source) || "legacy_expense",
        notes: text(expense.notes),
      });
    } else {
      expectedItems.push({
        id: uniqueId(`expected_expense_${legacyId}`, expectedIds),
        legacyId,
        direction: "expense",
        amountMinor,
        accountId: expense.accountId || defaultAccountId,
        categoryId,
        description: text(expense.description) || "Gasto esperado",
        dueDate,
        status: dueDate < today ? "due" : "expected",
        source: "legacy_expense",
      });
    }
    if (text(expense.recurrence) && expense.recurrence !== "única") {
      recurrenceRules.push({
        id: uniqueId(`recurrence_expense_${legacyId}`, recurrenceIds),
        sourceLegacyId: legacyId,
        direction: "expense",
        frequency: expense.recurrence,
        amountMinor,
        description: text(expense.description),
        categoryId,
        startsAt: dueDate,
        status: "active",
        confirmedByUser: true,
      });
    }
  });

  const billGroups = new Map();
  list(data.cardPurchases).forEach((purchase, index) => {
    const legacyId = safeId(purchase.id, `purchase_${index + 1}`);
    const card = data.cards.find((item) => item.id === purchase.cardId);
    const schedule = buildInstallments(purchase, card);
    const amountMinor = Math.abs(toMinorUnits(purchase.totalValue));
    movements.push({
      id: uniqueId(`movement_purchase_${legacyId}`, movementIds),
      legacyId,
      type: normalizeText(purchase.transactionType).match(/credit|refund|estorno/)
        ? "refund"
        : "card_purchase",
      amountMinor,
      cardId: purchase.cardId || null,
      accountId: card?.accountId || defaultAccountId,
      categoryId: categoryIdForItem(data, purchase),
      description: text(purchase.description) || "Compra no cartão",
      status: purchase.status === "paid" ? "confirmed" : "in_bill",
      occurredAt: dateOnly(purchase.date, today),
      source: text(purchase.importedSource) || "legacy_card_purchase",
      installmentPlan: {
        count: Math.max(1, Number(purchase.installments) || 1),
        current: Math.max(1, Number(purchase.currentInstallment) || 1),
        schedule,
      },
      notes: text(purchase.notes),
    });
    schedule.forEach((installment) => {
      if (!installment.monthKey || !purchase.cardId) return;
      const key = `${purchase.cardId}:${installment.monthKey}`;
      if (!billGroups.has(key)) {
        const dueDay = Math.min(31, Math.max(1, Number(card?.dueDay) || 1));
        const [year, month] = installment.monthKey.split("-").map(Number);
        billGroups.set(key, {
          cardId: purchase.cardId,
          monthKey: installment.monthKey,
          dueDate: dateOnly(installment.dueDate) || dateFromYearMonthDay(year, month, dueDay),
          totalMinor: 0,
          installmentRefs: [],
        });
      }
      const bill = billGroups.get(key);
      const sign = normalizeText(purchase.transactionType).match(/credit|refund|estorno/) ? -1 : 1;
      bill.totalMinor += installment.amountMinor * sign;
      bill.installmentRefs.push({
        movementId: `movement_purchase_${legacyId}`,
        number: installment.number,
        amountMinor: installment.amountMinor * sign,
      });
    });
  });

  Object.entries(record(data.invoicePayments)).forEach(([key, payment]) => {
    const match = key.match(/^(\d{4}-\d{2})_(.+)$/);
    if (!match) return;
    const [, invoiceMonth, cardId] = match;
    const card = data.cards.find((item) => item.id === cardId);
    const billKey = `${cardId}:${invoiceMonth}`;
    const manualAmount = payment.manualEntryEnabled === true
      ? payment.manualEntryAmount
      : (payment.overrideEnabled === true ? payment.overrideAmount : 0);
    const manualMinor = Math.max(0, toMinorUnits(manualAmount));
    if (!billGroups.has(billKey)) {
      const [year, month] = invoiceMonth.split("-").map(Number);
      billGroups.set(billKey, {
        cardId,
        monthKey: invoiceMonth,
        dueDate: dateFromYearMonthDay(year, month, card?.dueDay || 1),
        totalMinor: 0,
        installmentRefs: [],
      });
    }
    const bill = billGroups.get(billKey);
    if (manualMinor > 0) {
      bill.totalMinor += manualMinor;
      bill.installmentRefs.push({
        movementId: `manual_invoice_${cardId}_${invoiceMonth}`,
        number: 1,
        amountMinor: manualMinor,
        source: "manual_invoice",
      });
    }
    const paidMinor = payment.status === "paid"
      ? Math.max(0, bill.totalMinor)
      : Math.abs(toMinorUnits(payment.paidAmount));
    if (paidMinor > 0) {
      movements.push({
        id: uniqueId(`movement_bill_payment_${key}`, movementIds),
        type: "card_bill_payment",
        amountMinor: paidMinor,
        cardId,
        accountId: payment.accountId || card?.accountId || defaultAccountId,
        description: `Pagamento da fatura ${text(card?.name) || cardId}`,
        status: "confirmed",
        occurredAt: dateOnly(payment.paymentDate, bill.dueDate),
        source: "legacy_invoice_payment",
        billId: `bill_${cardId}_${invoiceMonth}`,
      });
    }
  });

  const cardBills = [...billGroups.values()].map((bill) => {
    const payment = record(data.invoicePayments)[`${bill.monthKey}_${bill.cardId}`] || {};
    const totalMinor = Math.max(0, bill.totalMinor);
    const paidMinor = payment.status === "paid"
      ? totalMinor
      : Math.min(totalMinor, Math.abs(toMinorUnits(payment.paidAmount)));
    const remainingMinor = Math.max(0, totalMinor - paidMinor);
    let status = "open";
    if (remainingMinor === 0 && (payment.status === "paid" || totalMinor > 0)) status = "paid";
    else if (bill.dueDate < today) status = "overdue";
    else if (monthKey(today) >= bill.monthKey) status = "payable";
    return {
      id: `bill_${bill.cardId}_${bill.monthKey}`,
      cardId: bill.cardId,
      monthKey: bill.monthKey,
      dueDate: bill.dueDate,
      totalMinor,
      paidMinor,
      remainingMinor,
      status,
      installmentRefs: bill.installmentRefs,
      closedSnapshot: payment.closedSnapshot || null,
    };
  });

  return { movements, expectedItems, recurrenceRules, cardBills };
}

function buildCategoryRules(data) {
  const seen = new Set();
  return [
    ...list(data.categoryRules),
    ...list(data.subcategories).map((rule, index) => ({
      id: safeId(rule.id, `category_rule_${index + 1}`),
      categoryId: categoryIdFor(data, rule.category),
      subcategory: text(rule.name || rule.subcategory),
      matchType: "keywords",
      pattern: text(rule.descriptionFilter || rule.filter || rule.keywords),
      priority: 60,
      source: "legacy_subcategory",
      learned: false,
      active: true,
    })),
    ...SYSTEM_CATEGORY_RULES.map(([pattern, categoryName], index) => ({
      id: `category_rule_system_${index + 1}`,
      categoryId: categoryIdFor(data, categoryName),
      matchType: "keywords",
      pattern,
      priority: 40,
      source: "system",
      learned: false,
      active: true,
    })),
  ].filter((rule, index) => {
    rule.id = safeId(rule.id, `category_rule_${index + 1}`);
    if (seen.has(rule.id)) return false;
    seen.add(rule.id);
    return true;
  });
}

function ensureLegacyProjection(data) {
  if (!isFinancialDataV2(data)) return data;
  const projected = { ...data };
  projected.entries = list(projected.entries);
  projected.expenses = list(projected.expenses);
  projected.cardPurchases = list(projected.cardPurchases);
  projected.invoicePayments = record(projected.invoicePayments);
  projected.subcategories = list(projected.subcategories);

  if (!projected.entries.length) {
    projected.entries = [
      ...list(projected.movements)
        .filter((movement) => movement.type === "income")
        .map((movement) => ({
          id: movement.legacyId || movement.id,
          description: movement.description,
          category: projected.categories.find((item) => item.id === movement.categoryId)?.name || "Outros",
          value: fromMinorUnits(movement.amountMinor),
          plannedDate: movement.occurredAt,
          receivedDate: movement.occurredAt,
          status: "received",
          recurrence: "única",
          notes: movement.notes || "",
        })),
      ...list(projected.expectedItems)
        .filter((item) => item.direction === "income")
        .map((item) => ({
          id: item.legacyId || item.id,
          description: item.description,
          category: projected.categories.find((category) => category.id === item.categoryId)?.name || "Outros",
          value: fromMinorUnits(item.amountMinor),
          plannedDate: item.dueDate,
          receivedDate: "",
          status: "pending",
          recurrence: "única",
          notes: "",
        })),
    ];
  }

  return projected;
}

export function migrateFinancialData(input, options = {}) {
  const source = ensureLegacyProjection(clone(record(input)));
  source.settings = record(source.settings);
  source.categories = normalizeEntityIds(source.categories, "category");
  source.subcategories = list(source.subcategories);
  source.entries = list(source.entries);
  source.expenses = list(source.expenses);
  source.cardPurchases = list(source.cardPurchases);
  source.invoicePayments = record(source.invoicePayments);
  source.investments = list(source.investments);
  source.auditLog = normalizeEntityIds(source.auditLog, "audit");
  source.accounts = buildAccounts(source);
  const defaultAccountId = source.accounts.find((account) => account.isDefault)?.id
    || source.accounts[0]?.id
    || null;
  source.cards = normalizeEntityIds(
    list(source.cards).map((card, index) => normalizeCard(card, index, defaultAccountId)),
    "card",
  );
  const normalized = buildNormalizedCollections(source, options);
  const migratedAt = text(options.now) || source.updatedAt || new Date().toISOString();
  const migrationAuditId = "audit_schema_v2_migration";
  if (!source.auditLog.some((entry) => entry.id === migrationAuditId)) {
    source.auditLog.push({
      id: migrationAuditId,
      action: "schema_migrated",
      sourceSchemaVersion: isFinancialDataV2(input) ? 2 : 1,
      targetSchemaVersion: FINANCIAL_SCHEMA_VERSION,
      occurredAt: migratedAt,
      source: "client_migration",
    });
  }
  return {
    ...source,
    schemaVersion: FINANCIAL_SCHEMA_VERSION,
    version: FINANCIAL_DATA_VERSION,
    timeZone: text(source.timeZone) || FINANCIAL_TIME_ZONE,
    accounts: source.accounts,
    cards: source.cards,
    movements: normalized.movements.filter((movement) => MOVEMENT_TYPES.has(movement.type)),
    cardBills: normalized.cardBills,
    expectedItems: normalized.expectedItems,
    recurrenceRules: normalized.recurrenceRules,
    categoryRules: buildCategoryRules(source),
    categories: source.categories,
    financialPlan: Object.keys(record(source.financialPlan)).length
      ? clone(record(source.financialPlan))
      : null,
    auditLog: source.auditLog,
    compatibility: {
      legacyProjectionVersion: "1.3.0",
      synchronizedAt: migratedAt,
    },
  };
}

export function createEmptyFinancialDataV2(seed = {}, options = {}) {
  return migrateFinancialData({
    settings: {},
    categories: [],
    subcategories: [],
    accounts: [],
    cards: [],
    entries: [],
    expenses: [],
    cardPurchases: [],
    invoicePayments: {},
    investments: [],
    financialPlan: null,
    auditLog: [],
    updatedAt: "",
    ...clone(seed),
  }, options);
}

export function ensureLocalMigrationBackup(storage, storageKey, originalData) {
  if (!storage || !storageKey || isFinancialDataV2(originalData)) return null;
  const backupKey = `${storageKey}${LOCAL_MIGRATION_BACKUP_SUFFIX}`;
  if (storage.getItem(backupKey) === null) {
    storage.setItem(backupKey, JSON.stringify(originalData));
  }
  return backupKey;
}
