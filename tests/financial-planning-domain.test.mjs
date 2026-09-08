import assert from "node:assert/strict";
import test from "node:test";
import {
  createFinancialPlanningGoal,
  effectiveAnnualReturnPct,
  effectiveRealAnnualReturnPct,
  financialPlanAllocationTotal,
  inflatePlanningMinor,
  normalizeFinancialPlan,
  rebalanceFinancialPlanAllocation,
  simulateFinancialPlan,
  suggestFinancialPlanAllocation,
  validateFinancialPlan,
} from "../financial-planning-domain.mjs";

function buildPlan({
  incomeMinor = 1_000_000,
  fixedCostMinor = 300_000,
  debtMinor = 0,
  debtRatePct = 0,
  reserveMinor = 1_800_000,
  reserveMonths = 6,
  goals = [],
  leisurePct = 10,
  debtPct = 0,
  reservePct = 0,
  goalPcts = {},
  monthlyReturnPct = 0,
  annualInflationPct = 0,
  withdrawalRatePct = 4,
} = {}) {
  return normalizeFinancialPlan({
    status: "completed",
    currentStep: 9,
    incomeMinor,
    fixedCostMinor,
    debt: { balanceMinor: debtMinor, monthlyRatePct: debtRatePct },
    reserve: { currentMinor: reserveMinor, targetMonths: reserveMonths },
    goals,
    allocation: { leisurePct, debtPct, reservePct, goalPcts },
    assumptions: { monthlyReturnPct, annualInflationPct, withdrawalRatePct },
  });
}

test("sugestão distribui exatamente 100% e mantém o custo de vida travado", () => {
  const car = createFinancialPlanningGoal("car");
  const property = createFinancialPlanningGoal("property");
  const suggested = suggestFinancialPlanAllocation(buildPlan({
    incomeMinor: 650_000,
    fixedCostMinor: 300_000,
    debtMinor: 1_000_000,
    reserveMinor: 0,
    goals: [car, property],
  }));

  assert.equal(financialPlanAllocationTotal(suggested), 100);
  assert.equal(validateFinancialPlan(suggested).valid, true);
  assert.equal(suggested.allocation.debtPct > 0, true);
  assert.equal(suggested.allocation.reservePct > 0, true);
});

test("mudança de renda redistribui os percentuais existentes sem alterar as prioridades", () => {
  const car = createFinancialPlanningGoal("car", { targetMinor: 6_000_000 });
  const original = buildPlan({
    incomeMinor: 1_000_000,
    fixedCostMinor: 100_000,
    goals: [car],
    leisurePct: 10,
    goalPcts: { [car.id]: 80 },
  });
  const adjusted = rebalanceFinancialPlanAllocation({ ...original, incomeMinor: 2_000_000 });

  assert.equal(financialPlanAllocationTotal(adjusted), 100);
  assert.equal(adjusted.allocation.leisurePct, 10.56);
  assert.equal(adjusted.allocation.goalPcts[car.id], 84.44);
  assert.equal(
    Math.round((adjusted.allocation.goalPcts[car.id] / adjusted.allocation.leisurePct) * 100) / 100,
    8,
  );
});

test("dívida de R$ 10 mil com R$ 1 mil por mês termina em dez meses enquanto a reserva rende", () => {
  const property = createFinancialPlanningGoal("property", { targetMinor: 100_000_000 });
  const plan = buildPlan({
    incomeMinor: 500_000,
    fixedCostMinor: 200_000,
    debtMinor: 1_000_000,
    reserveMinor: 0,
    goals: [property],
    leisurePct: 10,
    debtPct: 20,
    reservePct: 10,
    goalPcts: { [property.id]: 20 },
    monthlyReturnPct: 1,
    annualInflationPct: 5,
  });
  const result = simulateFinancialPlan(plan);
  const debtPhase = result.phases[0];

  assert.equal(result.valid, true);
  assert.equal(debtPhase.focusId, "debt");
  assert.equal(debtPhase.durationMonths, 10);
  assert.equal(debtPhase.focus.contributedMinor, 1_000_000);
  assert.equal(debtPhase.buckets.find((bucket) => bucket.id === "reserve").finalMinor > 500_000, true);
});

test("objetivo paralelo para exatamente na meta e libera o aporte no mesmo mês", () => {
  const property = createFinancialPlanningGoal("property", {
    targetMinor: 20_000_000,
    priority: 0,
  });
  const car = createFinancialPlanningGoal("car", {
    targetMinor: 200_000,
    impactMonthlyMinor: 0,
    priority: 1,
  });
  const plan = buildPlan({
    goals: [property, car],
    goalPcts: { [property.id]: 40, [car.id]: 20 },
  });
  const result = simulateFinancialPlan(plan);
  const propertyPhase = result.phases[0];
  const completion = propertyPhase.parallelCompletions.find((event) => event.id === car.id);

  assert.ok(completion);
  assert.equal(completion.month, 1);
  assert.equal(completion.targetMinor, car.targetMinor);
  assert.equal(completion.releasedMonthlyMinor, 200_000);
  assert.equal(
    propertyPhase.endAllocation.find((row) => row.id === property.id).amountMinor,
    600_000,
  );
});

test("meta alcançada apenas pelo rendimento também informa o aporte mensal liberado", () => {
  const car = createFinancialPlanningGoal("car", {
    currentMinor: 199_000,
    targetMinor: 200_000,
  });
  const result = simulateFinancialPlan(buildPlan({
    goals: [car],
    goalPcts: { [car.id]: 60 },
    monthlyReturnPct: 1,
  }));
  const completion = result.events.find((event) => event.type === "goal-completed");

  assert.equal(completion.month, 1);
  assert.equal(completion.releasedMonthlyMinor, 600_000);
});

test("aquisição com impacto mensal insere reforço da reserva antes do próximo objetivo", () => {
  const car = createFinancialPlanningGoal("car", {
    targetMinor: 600_000,
    impactMonthlyMinor: 100_000,
    priority: 0,
  });
  const property = createFinancialPlanningGoal("property", {
    targetMinor: 5_000_000,
    priority: 1,
  });
  const result = simulateFinancialPlan(buildPlan({
    goals: [car, property],
    goalPcts: { [car.id]: 30, [property.id]: 30 },
  }));
  const focusIds = result.phases.map((phase) => phase.focusId);

  assert.deepEqual(focusIds.slice(0, 4), [car.id, "reserve", property.id, "retirement"]);
  assert.match(result.phases[1].title, /Reforçar reserva/u);
  assert.equal(result.final.fixedCostMinor, 400_000);
  assert.equal(result.final.reserveTargetMinor, 2_400_000);
});

test("meta do objetivo é corrigida pela inflação até o mês da conclusão", () => {
  const travel = createFinancialPlanningGoal("travel", { targetMinor: 1_000_000 });
  const result = simulateFinancialPlan(buildPlan({
    goals: [travel],
    goalPcts: { [travel.id]: 60 },
    annualInflationPct: 5,
  }));
  const completion = result.events.find((event) => event.id === travel.id);

  assert.ok(completion.month > 0);
  assert.equal(completion.targetMinor > travel.targetMinor, true);
  assert.equal(
    completion.targetMinor,
    inflatePlanningMinor(travel.targetMinor, 5, completion.month),
  );
});

test("Investimentos vira capital inicial da aposentadoria e a meta usa retirada de 4%", () => {
  const investments = createFinancialPlanningGoal("investments", { targetMinor: 1_000_000 });
  const result = simulateFinancialPlan(buildPlan({
    goals: [investments],
    goalPcts: { [investments.id]: 60 },
    monthlyReturnPct: 1,
    annualInflationPct: 5,
  }));
  const investmentEvent = result.events.find((event) => event.id === investments.id);

  assert.equal(result.feasible, true);
  assert.equal(result.retirement.initialMinor >= investmentEvent.targetMinor, true);
  assert.equal(
    result.retirement.targetMinor,
    Math.round((result.retirement.livingFutureMinor * 12) / 0.04),
  );
  assert.equal(Math.round(effectiveAnnualReturnPct(1) * 100) / 100, 12.68);
  assert.equal(Math.round(effectiveRealAnnualReturnPct(1, 5) * 100) / 100, 7.32);
  assert.equal(
    result.retirement.accumulatedMinor,
    result.retirement.initialMinor + result.retirement.contributedMinor + result.retirement.earningsMinor,
  );
  assert.equal(result.retirement.accumulatedMinor, result.retirement.finalMinor);
});

test("custo atual de R$ 5 mil exige mais de R$ 500 mil e preserva margem para inflação", () => {
  const investments = createFinancialPlanningGoal("investments", { targetMinor: 100 });
  const result = simulateFinancialPlan(buildPlan({
    incomeMinor: 2_000_000,
    fixedCostMinor: 500_000,
    reserveMinor: 3_000_000,
    goals: [investments],
    leisurePct: 10,
    goalPcts: { [investments.id]: 65 },
    monthlyReturnPct: 1,
    annualInflationPct: 5,
  }));

  assert.equal(result.feasible, true);
  assert.equal(result.retirement.currentLivingCostMinor, 500_000);
  assert.equal(result.retirement.targetMinor > 50_000_000, true);
  assert.equal(
    Math.abs(result.retirement.sustainableMonthlyIncomeMinor - result.retirement.livingFutureMinor) <= 1,
    true,
  );
  assert.equal(
    result.retirement.monthlyReinvestedMinor,
    result.retirement.expectedMonthlyReturnMinor - result.retirement.sustainableMonthlyIncomeMinor,
  );
  assert.equal(result.retirement.monthlyReinvestedMinor > 0, true);
  assert.equal(result.retirement.livingNextYearMinor > result.retirement.livingFutureMinor, true);
  assert.equal(Math.round(result.retirement.realGrowthAfterWithdrawalPct * 100) / 100, 3.51);
  assert.equal(result.retirement.realGrowthAfterWithdrawalPct > 0, true);
  assert.equal(result.retirement.purchasingPowerProtected, true);
});

test("plano sem capacidade real informa ausência de prazo em vez de inventar conclusão", () => {
  const property = createFinancialPlanningGoal("property", { targetMinor: 1_000_000_000_000 });
  const result = simulateFinancialPlan(buildPlan({
    incomeMinor: 100_000,
    fixedCostMinor: 50_000,
    debtMinor: 1_000_000,
    debtRatePct: 10,
    reserveMinor: 300_000,
    goals: [property],
    leisurePct: 10,
    debtPct: 1,
    goalPcts: { [property.id]: 39 },
  }), { maxMonths: 120 });

  assert.equal(result.valid, true);
  assert.equal(result.feasible, false);
  assert.equal(result.totalPlanMonths, Number.POSITIVE_INFINITY);
  assert.equal(result.phases.at(-1).durationMonths, Number.POSITIVE_INFINITY);
});

test("cada saldo acumulado fecha como valor inicial mais aportes e rendimentos", () => {
  const car = createFinancialPlanningGoal("car", { targetMinor: 6_000_000 });
  const property = createFinancialPlanningGoal("property", { targetMinor: 20_000_000 });
  const result = simulateFinancialPlan(buildPlan({
    goals: [car, property],
    leisurePct: 10,
    goalPcts: { [car.id]: 35, [property.id]: 25 },
    monthlyReturnPct: 1,
  }));

  result.phases.forEach((phase) => {
    phase.buckets.filter((bucket) => bucket.id !== "debt").forEach((bucket) => {
      assert.equal(
        bucket.finalMinor,
        bucket.initialMinor + bucket.contributedMinor + bucket.earningsMinor,
        `${phase.title}: ${bucket.name}`,
      );
    });
  });
});
