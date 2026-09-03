import assert from "node:assert/strict";
import test from "node:test";
import { buildInvestmentHistory, buildWeightedMarketBasket, compareFixedIncomeScenarios, formatInvestmentCurrencyEditValue, formatInvestmentCurrencyInput, parseInvestmentCurrencyInput, projectInvestmentScenario, summarizeInvestmentPortfolio, summarizeInvestmentPosition } from "../investment-domain.mjs";

function positionFixture(overrides = {}) {
  return { id:"investment_cdb", name:"CDB Banco Exemplo", type:"CDB/RDB", startedAt:"2026-01-10", events:[{ id:"event_opening", type:"contribution", date:"2026-01-10", amountMinor:1_000_000, balanceMinor:1_000_000 }], ...overrides };
}

test("formata e interpreta valores monetários no padrão brasileiro", () => {
  assert.equal(formatInvestmentCurrencyInput(100000), "100.000,00");
  assert.equal(formatInvestmentCurrencyEditValue(100000), "100000,00");
  assert.equal(parseInvestmentCurrencyInput("R$ 100.000,00"), 100000);
  assert.equal(parseInvestmentCurrencyInput("250000"), 250000);
  assert.equal(parseInvestmentCurrencyInput("1.234,56"), 1234.56);
  assert.equal(parseInvestmentCurrencyInput("1234.56"), 1234.56);
  assert.equal(parseInvestmentCurrencyInput("2.500"), 2500);
  assert.equal(parseInvestmentCurrencyInput("-100"), 0);
});

test("aceita uma taxa personalizada para cada título de renda fixa", () => {
  const comparison = compareFixedIncomeScenarios({
    initialMinor:1_000_000,
    monthlyMinor:0,
    months:12,
    cdiAnnualRate:12,
    ipcaAnnualRate:4,
    scenarioRates:{
      "cdb-cdi":110,
      "lci-cdi":95,
      "tesouro-ipca":6.5,
      "cri-ipca":9,
      "tesouro-prefixado":13,
      "cri-prefixado":14,
    },
  });
  const cdb = comparison.scenarios.find((scenario) => scenario.id === "cdb-cdi");
  const lci = comparison.scenarios.find((scenario) => scenario.id === "lci-cdi");
  const criIpca = comparison.scenarios.find((scenario) => scenario.id === "cri-ipca");
  const criPrefixado = comparison.scenarios.find((scenario) => scenario.id === "cri-prefixado");
  assert.equal(cdb.rateValue, 110);
  assert.equal(cdb.annualRate, 13.2);
  assert.equal(lci.rateValue, 95);
  assert.equal(criIpca.annualRate, 13.36);
  assert.equal(criPrefixado.annualRate, 14);
});

test("consolida uma cesta ponderada e compara o patrimônio total", () => {
  const basket = buildWeightedMarketBasket({ entries:[
    {
      symbol:"BOVA11",
      weight:60,
      series:{ values:[0,10,20], simulation:{ finalValue:14_000, totalContributed:10_000 } },
    },
    {
      symbol:"IVVB11",
      weight:40,
      series:{ values:[0,5,10], simulation:{ finalValue:12_000, totalContributed:10_000 } },
    },
  ] });
  assert.equal(basket.valid, true);
  assert.deepEqual(basket.series.values, [0,8,16]);
  assert.equal(basket.series.simulation.finalValue, 13_200);
  assert.equal(basket.series.simulation.totalContributed, 10_000);
  assert.equal(basket.series.simulation.gain, 3_200);
  assert.equal(basket.series.simulation.gainPercent, 32);

  const incomplete = buildWeightedMarketBasket({ entries:[
    { symbol:"BOVA11", weight:40, series:{ values:[0,10], simulation:{ finalValue:11_000, totalContributed:10_000 } } },
  ] });
  assert.equal(incomplete.valid, false);
  assert.equal(incomplete.allocationTotal, 40);
});

test("explica o resultado de um título a partir de aportes, resgates e saldo", () => {
  const summary = summarizeInvestmentPosition(positionFixture({ events:[
    { id:"event_1", type:"contribution", date:"2026-01-10", amountMinor:1_000_000, balanceMinor:1_000_000 },
    { id:"event_2", type:"contribution", date:"2026-03-10", amountMinor:200_000, balanceMinor:1_330_000 },
    { id:"event_3", type:"withdrawal", date:"2026-05-10", amountMinor:100_000, balanceMinor:1_250_000 },
  ] }));
  assert.equal(summary.contributedMinor, 1_200_000);
  assert.equal(summary.withdrawnMinor, 100_000);
  assert.equal(summary.netContributedMinor, 1_100_000);
  assert.equal(summary.currentMinor, 1_250_000);
  assert.equal(summary.gainMinor, 150_000);
  assert.equal(summary.returnPercent, 12.5);
});

test("consolida a carteira sem misturar capital aplicado com rendimento", () => {
  const portfolio = summarizeInvestmentPortfolio([
    positionFixture({ events:[{ id:"a", type:"contribution", date:"2026-01-10", amountMinor:1_000_000, balanceMinor:1_100_000 }] }),
    positionFixture({ id:"investment_tesouro", events:[{ id:"b", type:"contribution", date:"2026-02-10", amountMinor:500_000, balanceMinor:475_000 }] }),
  ]);
  assert.equal(portfolio.contributedMinor, 1_500_000);
  assert.equal(portfolio.currentMinor, 1_575_000);
  assert.equal(portfolio.gainMinor, 75_000);
  assert.equal(portfolio.returnPercent, 5);
});

test("monta a linha do tempo consolidada e permite isolar um título", () => {
  const first = positionFixture({ events:[
    { id:"a1", type:"contribution", date:"2026-01-10", amountMinor:1_000_000, balanceMinor:1_000_000 },
    { id:"a2", type:"valuation", date:"2026-03-10", amountMinor:0, balanceMinor:1_080_000 },
  ] });
  const second = positionFixture({ id:"investment_lci", events:[{ id:"b1", type:"contribution", date:"2026-02-10", amountMinor:500_000, balanceMinor:500_000 }] });
  const consolidated = buildInvestmentHistory([first, second]);
  assert.deepEqual(consolidated.map(point => point.date), ["2026-01-10","2026-02-10","2026-03-10"]);
  assert.equal(consolidated.at(-1).currentMinor, 1_580_000);
  assert.equal(consolidated.at(-1).gainMinor, 80_000);
  assert.equal(buildInvestmentHistory([first]).at(-1).returnPercent, 8);
});

test("simula juros compostos e aportes mensais sem prometer rentabilidade", () => {
  const noYield = projectInvestmentScenario({ initialMinor:1_000_000, monthlyMinor:50_000, months:12, annualRate:0, benchmarkAnnualRate:0 });
  assert.equal(noYield.contributedMinor, 1_600_000);
  assert.equal(noYield.projectedMinor, 1_600_000);
  const compounded = projectInvestmentScenario({ initialMinor:1_000_000, monthlyMinor:0, months:12, annualRate:12, benchmarkAnnualRate:10 });
  assert.ok(Math.abs(compounded.projectedMinor - 1_120_000) <= 2);
  assert.ok(compounded.benchmarkDifferenceMinor > 0);
  assert.equal(compounded.points.length, 13);
});

test("compara automaticamente os seis títulos da planilha pelo valor líquido", () => {
  const comparison = compareFixedIncomeScenarios({ initialMinor:10_000_000, monthlyMinor:50_000, months:180, cdiAnnualRate:14.65, ipcaAnnualRate:5 });
  assert.equal(comparison.scenarios.length, 6);
  assert.equal(comparison.bestScenario.id, "cdb-cdi");
  const cdb = comparison.scenarios.find((scenario) => scenario.id === "cdb-cdi");
  const lci = comparison.scenarios.find((scenario) => scenario.id === "lci-cdi");
  const criIpca = comparison.scenarios.find((scenario) => scenario.id === "cri-ipca");
  assert.ok(Math.abs(cdb.netProjectedMinor - 94_047_838) <= 200);
  assert.ok(Math.abs(lci.netProjectedMinor - 75_739_456) <= 200);
  assert.equal(cdb.incomeTaxRate, 15);
  assert.equal(lci.incomeTaxRate, 0);
  assert.equal(lci.netProjectedMinor, lci.grossProjectedMinor);
  assert.equal(criIpca.annualRate, 13.4);
  assert.equal(cdb.points[0].netReturnPercent, 0);
  assert.ok(Math.abs(cdb.points.at(-1).netReturnPercent - cdb.netReturnPercent) < 0.000001);
});

test("aplica o IR regressivo simplificado somente aos títulos tributáveis", () => {
  const comparison = compareFixedIncomeScenarios({ initialMinor:1_000_000, monthlyMinor:0, months:12, cdiAnnualRate:12, ipcaAnnualRate:4 });
  const cdb = comparison.scenarios.find((scenario) => scenario.id === "cdb-cdi");
  const lci = comparison.scenarios.find((scenario) => scenario.id === "lci-cdi");
  assert.equal(cdb.incomeTaxRate, 17.5);
  assert.ok(cdb.taxMinor > 0);
  assert.equal(lci.taxMinor, 0);
  assert.equal(cdb.points.length, 13);
  assert.ok(cdb.points.at(-1).netBalanceMinor < cdb.points.at(-1).balanceMinor);
  assert.ok(cdb.points.at(-1).netReturnPercent
    < ((cdb.points.at(-1).balanceMinor - cdb.points.at(-1).contributedMinor)
      / cdb.points.at(-1).contributedMinor) * 100);
});
