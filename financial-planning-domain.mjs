export const FINANCIAL_PLANNING_SCHEMA_VERSION = 1;
export const FINANCIAL_PLANNING_MAX_MONTHS = 1_200;

export const FINANCIAL_PLANNING_GOALS = Object.freeze([
  { type: "property", name: "Imóvel", defaultTargetMinor: 100_000_000, defaultImpactMinor: 0, weight: 3 },
  { type: "car", name: "Carro", defaultTargetMinor: 6_000_000, defaultImpactMinor: 80_000, weight: 2 },
  { type: "investments", name: "Investimentos", defaultTargetMinor: 50_000_000, defaultImpactMinor: 0, weight: 3 },
  { type: "technology", name: "Tecnologia", defaultTargetMinor: 1_500_000, defaultImpactMinor: 0, weight: 1 },
  { type: "travel", name: "Viagem", defaultTargetMinor: 2_000_000, defaultImpactMinor: 0, weight: 1 },
  { type: "education", name: "Educação", defaultTargetMinor: 3_000_000, defaultImpactMinor: 0, weight: 2 },
]);

export const DEFAULT_FINANCIAL_PLANNING_ASSUMPTIONS = Object.freeze({
  monthlyReturnPct: 1,
  annualInflationPct: 5,
  withdrawalRatePct: 4,
});

const GOAL_BY_TYPE = new Map(FINANCIAL_PLANNING_GOALS.map((goal) => [goal.type, goal]));

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function minor(value) {
  const number = finite(value, 0);
  if (!Number.isSafeInteger(Math.round(number))) return 0;
  return Math.max(0, Math.round(number));
}

function roundPct(value) {
  return Math.round(Math.max(0, finite(value, 0)) * 100) / 100;
}

function normalizedRate(value, maximum = 100) {
  return Math.round(clamp(finite(value, 0), 0, maximum) * 10_000) / 10_000;
}

function goalDefinition(type) {
  return GOAL_BY_TYPE.get(text(type)) || null;
}

export function planningGoalId(type) {
  return `planning-goal-${text(type).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function createFinancialPlanningGoal(type, seed = {}) {
  const definition = goalDefinition(type);
  if (!definition) return null;
  const source = record(seed);
  return {
    id: text(source.id) || planningGoalId(definition.type),
    type: definition.type,
    name: definition.name,
    currentMinor: minor(source.currentMinor),
    targetMinor: minor(source.targetMinor) || definition.defaultTargetMinor,
    impactMonthlyMinor: definition.type === "car" || definition.type === "property"
      ? minor(source.impactMonthlyMinor ?? definition.defaultImpactMinor)
      : 0,
    priority: Math.max(0, Math.trunc(finite(source.priority, 0))),
  };
}

export function normalizeFinancialPlan(value = {}, options = {}) {
  const source = record(value);
  const assumptions = record(source.assumptions);
  const seenTypes = new Set();
  const seenIds = new Set();
  const goals = list(source.goals)
    .map((goal, index) => createFinancialPlanningGoal(goal?.type, {
      ...record(goal),
      priority: goal?.priority ?? index,
    }))
    .filter((goal) => {
      if (!goal || seenTypes.has(goal.type)) return false;
      seenTypes.add(goal.type);
      let id = goal.id;
      let suffix = 2;
      while (seenIds.has(id)) {
        id = `${goal.id}-${suffix}`;
        suffix += 1;
      }
      goal.id = id;
      seenIds.add(id);
      return true;
    })
    .sort((left, right) => left.priority - right.priority)
    .map((goal, index) => ({ ...goal, priority: index }));
  const allocation = record(source.allocation);
  const goalPcts = record(allocation.goalPcts);
  const updatedAt = text(options.updatedAt ?? source.updatedAt);
  const createdAt = text(source.createdAt) || updatedAt;
  return {
    schemaVersion: FINANCIAL_PLANNING_SCHEMA_VERSION,
    status: source.status === "completed" ? "completed" : "draft",
    currentStep: clamp(Math.trunc(finite(source.currentStep, 0)), 0, 9),
    incomeMinor: minor(source.incomeMinor),
    fixedCostMinor: minor(source.fixedCostMinor),
    debt: {
      balanceMinor: minor(source.debt?.balanceMinor),
      monthlyRatePct: normalizedRate(source.debt?.monthlyRatePct, 100),
    },
    reserve: {
      currentMinor: minor(source.reserve?.currentMinor),
      targetMonths: clamp(Math.trunc(finite(source.reserve?.targetMonths, 12)), 6, 24),
    },
    goals,
    allocation: {
      leisurePct: roundPct(allocation.leisurePct),
      debtPct: roundPct(allocation.debtPct),
      reservePct: roundPct(allocation.reservePct),
      goalPcts: Object.fromEntries(goals.map((goal) => [goal.id, roundPct(goalPcts[goal.id])])),
    },
    assumptions: {
      monthlyReturnPct: normalizedRate(
        assumptions.monthlyReturnPct ?? DEFAULT_FINANCIAL_PLANNING_ASSUMPTIONS.monthlyReturnPct,
        20,
      ),
      annualInflationPct: normalizedRate(
        assumptions.annualInflationPct ?? DEFAULT_FINANCIAL_PLANNING_ASSUMPTIONS.annualInflationPct,
        100,
      ),
      withdrawalRatePct: clamp(
        normalizedRate(
          assumptions.withdrawalRatePct ?? DEFAULT_FINANCIAL_PLANNING_ASSUMPTIONS.withdrawalRatePct,
          20,
        ),
        0.1,
        20,
      ),
    },
    createdAt,
    updatedAt,
  };
}

export function createEmptyFinancialPlan(options = {}) {
  return normalizeFinancialPlan({
    status: "draft",
    currentStep: 0,
    incomeMinor: 0,
    fixedCostMinor: 0,
    debt: { balanceMinor: 0, monthlyRatePct: 0 },
    reserve: { currentMinor: 0, targetMonths: 12 },
    goals: [],
    allocation: { leisurePct: 10, debtPct: 0, reservePct: 0, goalPcts: {} },
    assumptions: DEFAULT_FINANCIAL_PLANNING_ASSUMPTIONS,
  }, options);
}

export function financialPlanFixedPct(value) {
  const plan = normalizeFinancialPlan(value);
  if (plan.incomeMinor <= 0) return 0;
  return roundPct((plan.fixedCostMinor / plan.incomeMinor) * 100);
}

export function financialPlanAllocationTotal(value) {
  const plan = normalizeFinancialPlan(value);
  return roundPct(
    financialPlanFixedPct(plan)
      + plan.allocation.leisurePct
      + plan.allocation.debtPct
      + plan.allocation.reservePct
      + Object.values(plan.allocation.goalPcts).reduce((total, pct) => total + finite(pct, 0), 0),
  );
}

function distributePct(total, weightedItems) {
  const rows = weightedItems.filter((item) => item.weight > 0);
  if (!rows.length || total <= 0) return Object.fromEntries(weightedItems.map((item) => [item.id, 0]));
  const weightTotal = rows.reduce((sum, item) => sum + item.weight, 0) || 1;
  const result = Object.fromEntries(weightedItems.map((item) => [item.id, 0]));
  let assigned = 0;
  rows.forEach((item, index) => {
    const amount = index === rows.length - 1
      ? roundPct(total - assigned)
      : roundPct(total * (item.weight / weightTotal));
    result[item.id] = amount;
    assigned = roundPct(assigned + amount);
  });
  return result;
}

export function suggestFinancialPlanAllocation(value) {
  const plan = normalizeFinancialPlan(value);
  const fixedPct = financialPlanFixedPct(plan);
  let available = Math.max(0, roundPct(100 - fixedPct));
  const leisurePct = Math.min(10, Math.max(0, roundPct(available * 0.18)));
  available = roundPct(available - leisurePct);
  const hasDebt = plan.debt.balanceMinor > 0;
  const reserveTargetMinor = plan.fixedCostMinor * plan.reserve.targetMonths;
  const needsReserve = plan.reserve.currentMinor < reserveTargetMinor;
  let debtPct = 0;
  let reservePct = 0;
  if (hasDebt) {
    debtPct = Math.min(30, Math.max(15, roundPct(available * 0.5)));
    debtPct = Math.min(debtPct, available);
    available = roundPct(available - debtPct);
  }
  if (needsReserve) {
    reservePct = Math.min(hasDebt ? 10 : 25, Math.max(5, roundPct(available * (hasDebt ? 0.25 : 0.45))));
    reservePct = Math.min(reservePct, available);
    available = roundPct(available - reservePct);
  }
  const weightedGoals = plan.goals.map((goal) => ({
    id: goal.id,
    weight: goalDefinition(goal.type)?.weight || 1,
  }));
  const goalPcts = distributePct(available, weightedGoals);
  if (!weightedGoals.length && available > 0) {
    if (needsReserve) reservePct = roundPct(reservePct + available);
    else if (hasDebt) debtPct = roundPct(debtPct + available);
  }
  return normalizeFinancialPlan({
    ...plan,
    allocation: { leisurePct, debtPct, reservePct, goalPcts },
  });
}

export function rebalanceFinancialPlanAllocation(value) {
  const plan = normalizeFinancialPlan(value);
  if (plan.incomeMinor <= 0 || plan.fixedCostMinor >= plan.incomeMinor) return plan;
  const availablePct = roundPct(100 - financialPlanFixedPct(plan));
  const weightedItems = [
    { id: "leisure", weight: plan.allocation.leisurePct },
    { id: "debt", weight: plan.allocation.debtPct },
    { id: "reserve", weight: plan.allocation.reservePct },
    ...plan.goals.map((goal) => ({
      id: goal.id,
      weight: plan.allocation.goalPcts[goal.id] || 0,
    })),
  ];
  const hasExistingDistribution = weightedItems.some((item) => item.weight > 0);
  if (!hasExistingDistribution) return suggestFinancialPlanAllocation(plan);
  const distributed = distributePct(availablePct, weightedItems);
  return normalizeFinancialPlan({
    ...plan,
    allocation: {
      leisurePct: distributed.leisure,
      debtPct: distributed.debt,
      reservePct: distributed.reserve,
      goalPcts: Object.fromEntries(plan.goals.map((goal) => [goal.id, distributed[goal.id] || 0])),
    },
  });
}

export function validateFinancialPlan(value) {
  const plan = normalizeFinancialPlan(value);
  const errors = [];
  if (plan.incomeMinor <= 0) errors.push({ field: "incomeMinor", message: "Informe sua renda líquida mensal." });
  if (plan.fixedCostMinor <= 0) errors.push({ field: "fixedCostMinor", message: "Informe seu custo de vida mensal." });
  if (plan.incomeMinor > 0 && plan.fixedCostMinor >= plan.incomeMinor) {
    errors.push({ field: "fixedCostMinor", message: "O custo de vida precisa ser menor que a renda." });
  }
  if (!plan.goals.length) errors.push({ field: "goals", message: "Selecione pelo menos um objetivo." });
  plan.goals.forEach((goal) => {
    if (goal.targetMinor <= 0) errors.push({ field: goal.id, message: `Informe a meta de ${goal.name}.` });
  });
  const totalPct = financialPlanAllocationTotal(plan);
  if (totalPct > 100.01) errors.push({ field: "allocation", message: "A distribuição ultrapassa 100% da renda." });
  if (totalPct < 99.99) errors.push({ field: "allocation", message: "Distribua 100% da renda antes de gerar o plano." });
  const activePct = plan.allocation.debtPct
    + plan.allocation.reservePct
    + Object.values(plan.allocation.goalPcts).reduce((sum, pct) => sum + pct, 0);
  if (activePct <= 0) errors.push({ field: "allocation", message: "Reserve parte da renda para o planejamento." });
  return { valid: errors.length === 0, errors, plan, totalPct };
}

export function effectiveAnnualReturnPct(monthlyReturnPct) {
  const monthly = normalizedRate(monthlyReturnPct, 20) / 100;
  return (Math.pow(1 + monthly, 12) - 1) * 100;
}

export function effectiveRealAnnualReturnPct(monthlyReturnPct, annualInflationPct) {
  const nominalReturn = effectiveAnnualReturnPct(monthlyReturnPct) / 100;
  const inflation = normalizedRate(annualInflationPct, 100) / 100;
  return (((1 + nominalReturn) / (1 + inflation)) - 1) * 100;
}

export function inflatePlanningMinor(valueMinor, annualInflationPct, months) {
  const value = minor(valueMinor);
  const inflation = normalizedRate(annualInflationPct, 100) / 100;
  return Math.max(0, Math.round(value * Math.pow(1 + inflation, Math.max(0, finite(months, 0)) / 12)));
}

function growMinor(valueMinor, monthlyRate) {
  const value = minor(valueMinor);
  const earningsMinor = Math.max(0, Math.round(value * Math.max(0, monthlyRate)));
  return { valueMinor: value + earningsMinor, earningsMinor };
}

function goalTargetMinor(plan, goal, month) {
  return inflatePlanningMinor(goal.targetMinor, plan.assumptions.annualInflationPct, month);
}

function retirementLivingTodayMinor(plan) {
  return plan.fixedCostMinor + plan.goals
    .filter((goal) => goal.type === "car" || goal.type === "property")
    .reduce((sum, goal) => sum + goal.impactMonthlyMinor, 0);
}

function retirementTargetMinor(plan, month) {
  const livingMinor = inflatePlanningMinor(
    retirementLivingTodayMinor(plan),
    plan.assumptions.annualInflationPct,
    month,
  );
  const withdrawalRate = plan.assumptions.withdrawalRatePct / 100;
  return withdrawalRate > 0 ? Math.round((livingMinor * 12) / withdrawalRate) : Number.POSITIVE_INFINITY;
}

function snapshotState(state) {
  return {
    debt: state.debtMinor,
    reserve: state.reserve.balanceMinor,
    retirement: state.retirement.balanceMinor,
    ...Object.fromEntries(state.goals.map((goal) => [goal.id, goal.balanceMinor])),
  };
}

function emptyAmounts(state) {
  return Object.fromEntries(["debt", "reserve", "retirement", ...state.goals.map((goal) => goal.id)]
    .map((id) => [id, 0]));
}

function labelForId(state, id) {
  if (id === "fixed") return "Custo de vida";
  if (id === "leisure") return "Vida e lazer";
  if (id === "debt") return "Quitação de dívidas";
  if (id === "reserve") return "Reserva de emergência";
  if (id === "retirement") return "Aposentadoria";
  return state.goals.find((goal) => goal.id === id)?.name || "Objetivo";
}

function reserveTargetMinor(plan, state) {
  return state.fixedCostMinor * plan.reserve.targetMonths;
}

function activeGoals(state) {
  return state.goals.filter((goal) => !goal.completed).sort((left, right) => left.priority - right.priority);
}

function focusForState(plan, state, month) {
  if (state.debtMinor > 0) return { id: "debt", name: "Quitação de dívidas", kind: "debt" };
  if (state.reserve.balanceMinor < reserveTargetMinor(plan, state)) {
    const reinforcement = state.fixedCostMinor > plan.fixedCostMinor || state.reserve.completedOnce;
    return {
      id: "reserve",
      name: reinforcement ? "Reforçar reserva de emergência" : "Completar reserva de emergência",
      kind: "reserve",
    };
  }
  const goal = activeGoals(state)[0];
  if (goal) return { id: goal.id, name: goal.name, kind: "goal" };
  return {
    id: "retirement",
    name: "Aposentadoria / Independência Financeira",
    kind: "retirement",
    targetMinor: retirementTargetMinor(plan, month),
  };
}

function isEligibleId(plan, state, id, month) {
  if (id === "debt") return state.debtMinor > 0;
  if (id === "reserve") return state.reserve.balanceMinor < reserveTargetMinor(plan, state);
  if (id === "retirement") return state.debtMinor <= 0
    && state.reserve.balanceMinor >= reserveTargetMinor(plan, state)
    && activeGoals(state).length === 0
    && state.retirement.balanceMinor < retirementTargetMinor(plan, month);
  return state.goals.some((goal) => goal.id === id && !goal.completed);
}

function ensureRetirementShare(plan, state, month) {
  if (!isEligibleId(plan, state, "retirement", month)) return;
  if ((state.shares.retirement || 0) > 0) return;
  const unused = Object.entries(state.shares)
    .filter(([id]) => !isEligibleId(plan, state, id, month))
    .reduce((sum, [, share]) => sum + Math.max(0, finite(share, 0)), 0);
  state.shares.retirement = Math.max(1, unused);
}

function redistributeShare(plan, state, completedId, month) {
  const releasedPct = Math.max(0, finite(state.shares[completedId], 0));
  delete state.shares[completedId];
  let recipient = "";
  if (state.debtMinor > 0 && completedId !== "debt") recipient = "debt";
  else if (state.reserve.balanceMinor < reserveTargetMinor(plan, state) && completedId !== "reserve") recipient = "reserve";
  else recipient = activeGoals(state)[0]?.id || "retirement";
  if (recipient && recipient !== completedId) {
    state.shares[recipient] = Math.max(0, finite(state.shares[recipient], 0)) + releasedPct;
  }
  ensureRetirementShare(plan, state, month);
  return { releasedPct, recipient };
}

function reconcileShares(plan, state, month) {
  Object.keys(state.shares).forEach((id) => {
    if (!isEligibleId(plan, state, id, month)) delete state.shares[id];
  });
  if (state.debtMinor > 0 && (state.shares.debt || 0) <= 0) state.shares.debt = 1;
  if (state.reserve.balanceMinor < reserveTargetMinor(plan, state) && (state.shares.reserve || 0) <= 0) {
    const donor = activeGoals(state).sort((left, right) => (state.shares[right.id] || 0) - (state.shares[left.id] || 0))[0];
    const transferred = donor ? Math.max(1, Math.min(10, (state.shares[donor.id] || 0) / 2)) : 1;
    if (donor) state.shares[donor.id] = Math.max(0, (state.shares[donor.id] || 0) - transferred);
    state.shares.reserve = transferred;
  }
  ensureRetirementShare(plan, state, month);
}

function currentAllocation(plan, state, month) {
  reconcileShares(plan, state, month);
  const incomeMinor = plan.incomeMinor;
  const fixedMinor = Math.min(incomeMinor, state.fixedCostMinor);
  const leisureRequestedMinor = Math.round(incomeMinor * plan.allocation.leisurePct / 100);
  const leisureMinor = Math.min(Math.max(0, incomeMinor - fixedMinor), leisureRequestedMinor);
  const availableMinor = Math.max(0, incomeMinor - fixedMinor - leisureMinor);
  const eligible = Object.entries(state.shares)
    .filter(([id, share]) => share > 0 && isEligibleId(plan, state, id, month));
  const shareTotal = eligible.reduce((sum, [, share]) => sum + share, 0);
  const amounts = {};
  let assignedMinor = 0;
  eligible.forEach(([id, share], index) => {
    const amountMinor = index === eligible.length - 1
      ? availableMinor - assignedMinor
      : Math.floor(availableMinor * (share / (shareTotal || 1)));
    amounts[id] = Math.max(0, amountMinor);
    assignedMinor += Math.max(0, amountMinor);
  });
  const rows = [
    { id: "fixed", name: "Custo de vida", amountMinor: fixedMinor },
    { id: "leisure", name: "Vida e lazer", amountMinor: leisureMinor },
    ...eligible.map(([id]) => ({ id, name: labelForId(state, id), amountMinor: amounts[id] || 0 })),
  ].map((row) => ({
    ...row,
    pct: incomeMinor > 0 ? (row.amountMinor / incomeMinor) * 100 : 0,
  }));
  return { amounts, rows, fixedMinor, leisureMinor, availableMinor };
}

function releasedMonthlyAmount(plan, state, completedId, month) {
  const releasedShare = Math.max(0, finite(state.shares[completedId], 0));
  if (releasedShare <= 0) return 0;
  const fixedMinor = Math.min(plan.incomeMinor, state.fixedCostMinor);
  const leisureMinor = Math.min(
    Math.max(0, plan.incomeMinor - fixedMinor),
    Math.round(plan.incomeMinor * plan.allocation.leisurePct / 100),
  );
  const availableMinor = Math.max(0, plan.incomeMinor - fixedMinor - leisureMinor);
  const eligible = Object.entries(state.shares).filter(([id, share]) => (
    share > 0 && (id === completedId || isEligibleId(plan, state, id, month))
  ));
  const shareTotal = eligible.reduce((sum, [, share]) => sum + share, 0) || 1;
  let assignedMinor = 0;
  let releasedMinor = 0;
  eligible.forEach(([id, share], index) => {
    const amountMinor = index === eligible.length - 1
      ? availableMinor - assignedMinor
      : Math.floor(availableMinor * (share / shareTotal));
    assignedMinor += Math.max(0, amountMinor);
    if (id === completedId) releasedMinor = Math.max(0, amountMinor);
  });
  return releasedMinor;
}

function completeReserve(plan, state, month, events, releasedMonthlyMinor = 0) {
  if (state.reserve.balanceMinor < reserveTargetMinor(plan, state)) return false;
  if (!("reserve" in state.shares)) return false;
  const monthlyAmount = releasedMonthlyMinor || releasedMonthlyAmount(plan, state, "reserve", month);
  state.reserve.completedOnce = true;
  const targetMinor = reserveTargetMinor(plan, state);
  const { releasedPct, recipient } = redistributeShare(plan, state, "reserve", month);
  events.push({
    type: "reserve-completed",
    id: "reserve",
    name: "Reserva de emergência",
    month,
    targetMinor,
    releasedPct,
    releasedMonthlyMinor: monthlyAmount,
    recipientId: recipient,
  });
  return true;
}

function completeGoal(plan, state, goal, month, events, releasedMonthlyMinor = 0) {
  if (goal.completed) return false;
  const targetMinor = goalTargetMinor(plan, goal, month);
  if (goal.balanceMinor < targetMinor) return false;
  const monthlyAmount = releasedMonthlyMinor || releasedMonthlyAmount(plan, state, goal.id, month);
  goal.balanceMinor = targetMinor;
  goal.completed = true;
  goal.completedMonth = month;
  goal.targetAtCompletionMinor = targetMinor;
  let impactMinor = 0;
  if (goal.impactMonthlyMinor > 0) {
    impactMinor = inflatePlanningMinor(goal.impactMonthlyMinor, plan.assumptions.annualInflationPct, month);
    state.fixedCostMinor += impactMinor;
    goal.impactAppliedMinor = impactMinor;
  }
  if (goal.type === "investments") {
    state.retirement.balanceMinor += targetMinor;
    state.retirement.contributedMinor += Math.min(targetMinor, goal.contributedMinor);
    goal.transferredToRetirement = true;
  }
  const { releasedPct, recipient } = redistributeShare(plan, state, goal.id, month);
  events.push({
    type: "goal-completed",
    id: goal.id,
    name: goal.name,
    month,
    targetMinor,
    releasedPct,
    releasedMonthlyMinor: monthlyAmount,
    recipientId: recipient,
    impactMinor,
  });
  return true;
}

function completeDebt(plan, state, month, events, releasedMonthlyMinor = 0) {
  if (state.debtMinor > 0 || !("debt" in state.shares)) return false;
  const monthlyAmount = releasedMonthlyMinor || releasedMonthlyAmount(plan, state, "debt", month);
  const { releasedPct, recipient } = redistributeShare(plan, state, "debt", month);
  events.push({
    type: "debt-completed",
    id: "debt",
    name: "Quitação de dívidas",
    month,
    releasedPct,
    releasedMonthlyMinor: monthlyAmount,
    recipientId: recipient,
  });
  return true;
}

function completeRetirement(plan, state, month, events, releasedMonthlyMinor = 0) {
  if (
    state.debtMinor > 0
    || state.reserve.balanceMinor < reserveTargetMinor(plan, state)
    || activeGoals(state).length > 0
  ) return false;
  const targetMinor = retirementTargetMinor(plan, month);
  if (state.retirement.balanceMinor < targetMinor || state.retirement.completed) return false;
  state.retirement.balanceMinor = targetMinor;
  state.retirement.completed = true;
  events.push({
    type: "retirement-completed",
    id: "retirement",
    name: "Aposentadoria / Independência Financeira",
    month,
    targetMinor,
    releasedMonthlyMinor,
  });
  return true;
}

function processAlreadyReached(plan, state, month, events) {
  let changed = true;
  let guard = 0;
  while (changed && guard < 20) {
    changed = false;
    guard += 1;
    if (state.debtMinor <= 0) changed = completeDebt(plan, state, month, events) || changed;
    changed = completeReserve(plan, state, month, events) || changed;
    activeGoals(state).forEach((goal) => {
      changed = completeGoal(plan, state, goal, month, events) || changed;
    });
    changed = completeRetirement(plan, state, month, events) || changed;
  }
}

function buildSimulationState(plan) {
  return {
    month: 0,
    debtMinor: plan.debt.balanceMinor,
    debtPaidMinor: 0,
    debtInterestMinor: 0,
    fixedCostMinor: plan.fixedCostMinor,
    reserve: {
      balanceMinor: plan.reserve.currentMinor,
      contributedMinor: plan.reserve.currentMinor,
      earningsMinor: 0,
      completedOnce: false,
    },
    goals: plan.goals.map((goal) => ({
      ...clone(goal),
      balanceMinor: goal.currentMinor,
      contributedMinor: goal.currentMinor,
      earningsMinor: 0,
      completed: false,
      completedMonth: null,
      targetAtCompletionMinor: null,
      impactAppliedMinor: 0,
      transferredToRetirement: false,
    })),
    retirement: {
      balanceMinor: 0,
      contributedMinor: 0,
      earningsMinor: 0,
      completed: false,
    },
    shares: {
      debt: plan.allocation.debtPct,
      reserve: plan.allocation.reservePct,
      ...clone(plan.allocation.goalPcts),
    },
  };
}

function applyGrowth(plan, state, earnings) {
  const rate = plan.assumptions.monthlyReturnPct / 100;
  const reserveGrowth = growMinor(state.reserve.balanceMinor, rate);
  state.reserve.balanceMinor = reserveGrowth.valueMinor;
  state.reserve.earningsMinor += reserveGrowth.earningsMinor;
  earnings.reserve += reserveGrowth.earningsMinor;
  state.goals.filter((goal) => !goal.completed).forEach((goal) => {
    const growth = growMinor(goal.balanceMinor, rate);
    goal.balanceMinor = growth.valueMinor;
    goal.earningsMinor += growth.earningsMinor;
    earnings[goal.id] += growth.earningsMinor;
  });
  const retirementGrowth = growMinor(state.retirement.balanceMinor, rate);
  state.retirement.balanceMinor = retirementGrowth.valueMinor;
  state.retirement.earningsMinor += retirementGrowth.earningsMinor;
  earnings.retirement += retirementGrowth.earningsMinor;
  const debtInterestMinor = Math.max(0, Math.round(state.debtMinor * (plan.debt.monthlyRatePct / 100)));
  state.debtMinor += debtInterestMinor;
  state.debtInterestMinor += debtInterestMinor;
  earnings.debt += debtInterestMinor;
}

function applyContribution(plan, state, id, budgetMinor, month, events, contributions) {
  const budget = Math.max(0, Math.round(budgetMinor));
  if (budget <= 0 || !isEligibleId(plan, state, id, month)) return budget;
  if (id === "debt") {
    const applied = Math.min(budget, state.debtMinor);
    state.debtMinor -= applied;
    state.debtPaidMinor += applied;
    contributions.debt += applied;
    if (state.debtMinor <= 0) completeDebt(plan, state, month, events, budget);
    return budget - applied;
  }
  if (id === "reserve") {
    const needed = Math.max(0, reserveTargetMinor(plan, state) - state.reserve.balanceMinor);
    const applied = Math.min(budget, needed);
    state.reserve.balanceMinor += applied;
    state.reserve.contributedMinor += applied;
    contributions.reserve += applied;
    if (state.reserve.balanceMinor >= reserveTargetMinor(plan, state)) {
      completeReserve(plan, state, month, events, budget);
    }
    return budget - applied;
  }
  if (id === "retirement") {
    const targetMinor = retirementTargetMinor(plan, month);
    const needed = Math.max(0, targetMinor - state.retirement.balanceMinor);
    const applied = Math.min(budget, needed);
    state.retirement.balanceMinor += applied;
    state.retirement.contributedMinor += applied;
    contributions.retirement += applied;
    completeRetirement(plan, state, month, events, budget);
    return budget - applied;
  }
  const goal = state.goals.find((item) => item.id === id && !item.completed);
  if (!goal) return budget;
  const targetMinor = goalTargetMinor(plan, goal, month);
  const needed = Math.max(0, targetMinor - goal.balanceMinor);
  const applied = Math.min(budget, needed);
  goal.balanceMinor += applied;
  goal.contributedMinor += applied;
  contributions[goal.id] += applied;
  if (goal.balanceMinor >= targetMinor) completeGoal(plan, state, goal, month, events, budget);
  return budget - applied;
}

function redistributeUnusedMoney(plan, state, month, poolMinor, events, contributions) {
  let pool = Math.max(0, Math.round(poolMinor));
  let guard = 0;
  while (pool > 0 && guard < 20) {
    guard += 1;
    reconcileShares(plan, state, month);
    const recipients = Object.entries(state.shares)
      .filter(([id, share]) => share > 0 && isEligibleId(plan, state, id, month));
    if (!recipients.length) break;
    const totalShare = recipients.reduce((sum, [, share]) => sum + share, 0) || 1;
    let nextPool = 0;
    let assigned = 0;
    recipients.forEach(([id, share], index) => {
      const budget = index === recipients.length - 1
        ? pool - assigned
        : Math.floor(pool * (share / totalShare));
      assigned += budget;
      nextPool += applyContribution(plan, state, id, budget, month, events, contributions);
    });
    if (nextPool >= pool) break;
    pool = nextPool;
  }
  return pool;
}

function simulateMonth(plan, state) {
  const month = state.month + 1;
  const focus = focusForState(plan, state, state.month);
  const startBalances = snapshotState(state);
  const startFixedCostMinor = state.fixedCostMinor;
  const contributions = emptyAmounts(state);
  const earnings = emptyAmounts(state);
  const events = [];
  applyGrowth(plan, state, earnings);
  processAlreadyReached(plan, state, month, events);
  const allocation = currentAllocation(plan, state, month);
  let unusedMinor = 0;
  Object.entries(allocation.amounts).forEach(([id, amountMinor]) => {
    unusedMinor += applyContribution(plan, state, id, amountMinor, month, events, contributions);
  });
  unusedMinor = redistributeUnusedMoney(
    plan,
    state,
    month,
    unusedMinor,
    events,
    contributions,
  );
  processAlreadyReached(plan, state, month, events);
  state.month = month;
  return {
    month,
    focus,
    startBalances,
    endBalances: snapshotState(state),
    contributions,
    earnings,
    events,
    allocation: allocation.rows,
    endAllocation: currentAllocation(plan, state, month).rows,
    startFixedCostMinor,
    endFixedCostMinor: state.fixedCostMinor,
    reserveTargetMinor: reserveTargetMinor(plan, state),
    retirementTargetMinor: retirementTargetMinor(plan, month),
    unusedMinor,
  };
}

function phaseTitle(focus) {
  if (focus.id === "debt") return "Quitar dívidas";
  if (focus.id === "reserve") return focus.name;
  if (focus.id === "retirement") return "Aposentadoria / Independência Financeira";
  return `Objetivo: ${focus.name}`;
}

function phaseMetricForId(state, records, id) {
  const first = records[0];
  const last = records.at(-1);
  const initialMinor = first.startBalances[id] || 0;
  const finalMinor = last.endBalances[id] || 0;
  const contributedMinor = records.reduce((sum, record) => sum + (record.contributions[id] || 0), 0);
  const recordedEarningsMinor = records.reduce((sum, record) => sum + (record.earnings[id] || 0), 0);
  const earningsMinor = id === "debt"
    ? recordedEarningsMinor
    : Math.max(0, finalMinor - initialMinor - contributedMinor);
  return {
    id,
    name: labelForId(state, id),
    initialMinor,
    contributedMinor,
    earningsMinor,
    finalMinor,
  };
}

function buildPhases(plan, state, records, completed) {
  const groups = [];
  records.forEach((record) => {
    const previous = groups.at(-1);
    if (!previous || previous.focus.id !== record.focus.id) {
      groups.push({ focus: record.focus, records: [record] });
    } else {
      previous.records.push(record);
    }
  });
  return groups.map((group, index) => {
    const first = group.records[0];
    const last = group.records.at(-1);
    const events = group.records.flatMap((record) => record.events);
    const ids = new Set([
      group.focus.id,
      ...first.allocation.map((row) => row.id),
      ...events.map((event) => event.id),
    ]);
    ids.delete("fixed");
    ids.delete("leisure");
    const focusCompleted = events.some((event) => event.id === group.focus.id)
      || (group.focus.id === "retirement" && completed);
    const isLastIncomplete = index === groups.length - 1 && !focusCompleted;
    const endAllocation = [...group.records]
      .reverse()
      .map((record) => record.endAllocation)
      .find((rows) => rows.some((row) => row.id === group.focus.id))
      || last.endAllocation;
    return {
      id: `planning-phase-${index + 1}`,
      index,
      title: phaseTitle(group.focus),
      focusId: group.focus.id,
      focusName: group.focus.name,
      focusKind: group.focus.kind,
      durationMonths: isLastIncomplete ? Number.POSITIVE_INFINITY : group.records.length,
      elapsedStart: first.month - 1,
      elapsedEnd: last.month,
      allocation: clone(first.allocation),
      endAllocation: clone(endAllocation),
      initialFixedCostMinor: first.startFixedCostMinor,
      finalFixedCostMinor: last.endFixedCostMinor,
      reserveTargetMinor: last.reserveTargetMinor,
      events: clone(events),
      parallelCompletions: clone(events.filter((event) => (
        event.type === "goal-completed" && event.id !== group.focus.id
      ))),
      focus: phaseMetricForId(state, group.records, group.focus.id),
      buckets: [...ids].map((id) => phaseMetricForId(state, group.records, id)),
      complete: focusCompleted,
      interrupted: !focusCompleted && !isLastIncomplete,
    };
  });
}

function zeroMonthRetirementRecord(plan, state) {
  const targetMinor = retirementTargetMinor(plan, 0);
  const focus = focusForState(plan, state, 0);
  const balances = snapshotState(state);
  return {
    month: 0,
    focus,
    startBalances: balances,
    endBalances: balances,
    contributions: emptyAmounts(state),
    earnings: emptyAmounts(state),
    events: [{
      type: "retirement-completed",
      id: "retirement",
      name: focus.name,
      month: 0,
      targetMinor,
      releasedMonthlyMinor: 0,
    }],
    allocation: currentAllocation(plan, state, 0).rows,
    endAllocation: currentAllocation(plan, state, 0).rows,
    startFixedCostMinor: state.fixedCostMinor,
    endFixedCostMinor: state.fixedCostMinor,
    reserveTargetMinor: reserveTargetMinor(plan, state),
    retirementTargetMinor: targetMinor,
    unusedMinor: 0,
  };
}

export function simulateFinancialPlan(value, options = {}) {
  const validation = validateFinancialPlan(value);
  const plan = validation.plan;
  if (!validation.valid) {
    return {
      valid: false,
      feasible: false,
      errors: validation.errors,
      plan,
      phases: [],
      totalPlanMonths: Number.POSITIVE_INFINITY,
    };
  }
  const maxMonths = clamp(
    Math.trunc(finite(options.maxMonths, FINANCIAL_PLANNING_MAX_MONTHS)),
    1,
    FINANCIAL_PLANNING_MAX_MONTHS,
  );
  const state = buildSimulationState(plan);
  const initialEvents = [];
  processAlreadyReached(plan, state, 0, initialEvents);
  const records = [];
  if (state.retirement.completed) records.push(zeroMonthRetirementRecord(plan, state));
  while (!state.retirement.completed && state.month < maxMonths) {
    records.push(simulateMonth(plan, state));
  }
  if (initialEvents.length && records.length) records[0].events.unshift(...initialEvents);
  const feasible = state.retirement.completed;
  const phases = buildPhases(plan, state, records, feasible);
  const retirementPhase = [...phases].reverse().find((phase) => phase.focusId === "retirement");
  const retirementInitialMinor = retirementPhase?.focus.initialMinor || 0;
  const retirementContributedMinor = retirementPhase?.focus.contributedMinor || 0;
  const retirementFinalMinor = state.retirement.balanceMinor;
  const retirementEarningsMinor = Math.max(
    0,
    retirementFinalMinor - retirementInitialMinor - retirementContributedMinor,
  );
  const totalPlanMonths = feasible ? state.month : Number.POSITIVE_INFINITY;
  const currentLivingCostMinor = plan.fixedCostMinor;
  const livingTodayMinor = retirementLivingTodayMinor(plan);
  const permanentImpactTodayMinor = Math.max(0, livingTodayMinor - currentLivingCostMinor);
  const livingFutureMinor = feasible
    ? inflatePlanningMinor(livingTodayMinor, plan.assumptions.annualInflationPct, totalPlanMonths)
    : Number.POSITIVE_INFINITY;
  const targetMinor = feasible
    ? retirementTargetMinor(plan, totalPlanMonths)
    : Number.POSITIVE_INFINITY;
  const nominalAnnualReturnPct = effectiveAnnualReturnPct(plan.assumptions.monthlyReturnPct);
  const realAnnualReturnPct = effectiveRealAnnualReturnPct(
    plan.assumptions.monthlyReturnPct,
    plan.assumptions.annualInflationPct,
  );
  const nominalAnnualReturn = nominalAnnualReturnPct / 100;
  const annualInflation = plan.assumptions.annualInflationPct / 100;
  const annualWithdrawal = plan.assumptions.withdrawalRatePct / 100;
  const realGrowthAfterWithdrawalPct = (
    ((1 + nominalAnnualReturn - annualWithdrawal) / (1 + annualInflation)) - 1
  ) * 100;
  const sustainableMonthlyIncomeMinor = feasible
    ? Math.round(targetMinor * (plan.assumptions.withdrawalRatePct / 100) / 12)
    : Number.POSITIVE_INFINITY;
  const expectedMonthlyReturnMinor = feasible
    ? Math.round(targetMinor * (plan.assumptions.monthlyReturnPct / 100))
    : Number.POSITIVE_INFINITY;
  const monthlyReinvestedMinor = feasible
    ? Math.max(0, expectedMonthlyReturnMinor - sustainableMonthlyIncomeMinor)
    : Number.POSITIVE_INFINITY;
  const livingNextYearMinor = feasible
    ? inflatePlanningMinor(livingFutureMinor, plan.assumptions.annualInflationPct, 12)
    : Number.POSITIVE_INFINITY;
  const purchasingPowerProtected = feasible
    && monthlyReinvestedMinor > 0
    && realGrowthAfterWithdrawalPct > 0;
  return {
    valid: true,
    feasible,
    errors: [],
    plan,
    phases,
    events: records.flatMap((record) => record.events),
    totalPlanMonths,
    completedMonth: feasible ? state.month : null,
    retirement: {
      monthlyContributionMinor: retirementPhase?.allocation.find((row) => row.id === "retirement")?.amountMinor || 0,
      durationMonths: retirementPhase?.durationMonths ?? Number.POSITIVE_INFINITY,
      currentLivingCostMinor,
      permanentImpactTodayMinor,
      livingTodayMinor,
      livingFutureMinor,
      livingNextYearMinor,
      targetMinor,
      initialMinor: retirementInitialMinor,
      contributedMinor: retirementContributedMinor,
      earningsMinor: retirementEarningsMinor,
      finalMinor: retirementFinalMinor,
      accumulatedMinor: retirementInitialMinor + retirementContributedMinor + retirementEarningsMinor,
      withdrawalRatePct: plan.assumptions.withdrawalRatePct,
      nominalAnnualReturnPct,
      realAnnualReturnPct,
      realGrowthAfterWithdrawalPct,
      sustainableMonthlyIncomeMinor,
      expectedMonthlyReturnMinor,
      monthlyReinvestedMinor,
      purchasingPowerProtected,
    },
    final: {
      debtMinor: state.debtMinor,
      reserveMinor: state.reserve.balanceMinor,
      reserveTargetMinor: reserveTargetMinor(plan, state),
      fixedCostMinor: state.fixedCostMinor,
      goals: state.goals.map((goal) => ({
        id: goal.id,
        name: goal.name,
        type: goal.type,
        completed: goal.completed,
        completedMonth: goal.completedMonth,
        targetAtCompletionMinor: goal.targetAtCompletionMinor,
        transferredToRetirement: goal.transferredToRetirement,
      })),
    },
  };
}
