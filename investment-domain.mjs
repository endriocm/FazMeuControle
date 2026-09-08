const INVESTMENT_EVENT_TYPES = new Set(["contribution", "withdrawal", "valuation"]);
const INVESTMENT_CURRENCY_FORMATTER = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

export function parseInvestmentCurrencyInput(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : 0;
  }
  const source = text(value).replace(/\s/gu, "").replace(/[^\d,.-]/gu, "");
  if (!source) return 0;
  const commaIndex = source.lastIndexOf(",");
  let normalized = source;
  if (commaIndex >= 0) {
    const integerPart = source.slice(0, commaIndex).replace(/[.,]/gu, "");
    const decimalPart = source.slice(commaIndex + 1).replace(/[.,]/gu, "");
    normalized = decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
  } else {
    const dotParts = source.split(".");
    if (dotParts.length > 2 || (dotParts.length === 2 && dotParts[1].length === 3)) {
      normalized = dotParts.join("");
    }
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100) / 100) : 0;
}

export function formatInvestmentCurrencyInput(value) {
  return INVESTMENT_CURRENCY_FORMATTER.format(parseInvestmentCurrencyInput(value));
}

export function formatInvestmentCurrencyEditValue(value) {
  return parseInvestmentCurrencyInput(value).toFixed(2).replace(".", ",");
}

function safeMinor(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return 0;
  return Math.min(1_000, Math.max(-99, rate));
}

function dateOnly(value) {
  const match = text(value).match(/^\d{4}-\d{2}-\d{2}/u);
  return match ? match[0] : "";
}

function sortEvents(events) {
  return events
    .map((event, index) => ({ ...event, _index: index }))
    .sort((left, right) => left.date.localeCompare(right.date) || left._index - right._index)
    .map(({ _index, ...event }) => event);
}

function normalizeInvestmentEvent(event, index, positionId, fallbackDate) {
  const source = record(event);
  const type = INVESTMENT_EVENT_TYPES.has(source.type) ? source.type : "valuation";
  const normalized = {
    ...source,
    id: text(source.id) || `${positionId}_event_${index + 1}`,
    type,
    date: dateOnly(source.date) || fallbackDate,
    amountMinor: type === "valuation" ? 0 : safeMinor(source.amountMinor),
    note: text(source.note),
  };
  if (Number.isSafeInteger(source.balanceMinor) && source.balanceMinor >= 0) {
    normalized.balanceMinor = source.balanceMinor;
  } else {
    delete normalized.balanceMinor;
  }
  return normalized;
}

export function normalizeInvestmentPosition(position, index = 0) {
  const source = record(position);
  const id = text(source.id) || `investment_${index + 1}`;
  const startedAt = dateOnly(source.startedAt);
  const events = sortEvents(
    list(source.events)
      .map((event, eventIndex) => normalizeInvestmentEvent(event, eventIndex, id, startedAt))
      .filter((event) => event.date),
  );
  return {
    ...source,
    id,
    name: text(source.name) || `Título ${index + 1}`,
    type: text(source.type) || "Outro",
    issuer: text(source.issuer),
    indexer: text(source.indexer) || "Não informado",
    annualRate: safeRate(source.annualRate),
    liquidity: text(source.liquidity),
    risk: text(source.risk) || "Não informado",
    maturityDate: dateOnly(source.maturityDate),
    startedAt: startedAt || events[0]?.date || "",
    notes: text(source.notes),
    investedMinor: safeMinor(source.investedMinor),
    currentMinor: safeMinor(source.currentMinor),
    events,
  };
}

function positionEventsWithFallback(position) {
  if (position.events.length) return position.events;
  if (!position.startedAt || (!position.investedMinor && !position.currentMinor)) return [];
  return [{
    id: `${position.id}_opening`,
    type: "contribution",
    date: position.startedAt,
    amountMinor: position.investedMinor,
    balanceMinor: position.currentMinor || position.investedMinor,
    note: "Saldo inicial",
  }];
}

export function summarizeInvestmentPosition(position, index = 0) {
  const normalized = normalizeInvestmentPosition(position, index);
  const events = positionEventsWithFallback(normalized);
  let contributedMinor = 0;
  let withdrawnMinor = 0;
  let currentMinor = normalized.currentMinor;
  let lastUpdatedAt = normalized.startedAt;

  events.forEach((event) => {
    if (event.type === "contribution") contributedMinor += event.amountMinor;
    if (event.type === "withdrawal") withdrawnMinor += event.amountMinor;
    if (Number.isSafeInteger(event.balanceMinor)) currentMinor = event.balanceMinor;
    if (event.date >= lastUpdatedAt) lastUpdatedAt = event.date;
  });

  if (!contributedMinor && normalized.investedMinor) contributedMinor = normalized.investedMinor;
  const netContributedMinor = contributedMinor - withdrawnMinor;
  const gainMinor = currentMinor + withdrawnMinor - contributedMinor;
  const returnPercent = contributedMinor > 0
    ? (gainMinor / contributedMinor) * 100
    : null;

  return {
    ...normalized,
    events,
    contributedMinor,
    withdrawnMinor,
    netContributedMinor,
    currentMinor,
    gainMinor,
    returnPercent,
    lastUpdatedAt,
  };
}

export function summarizeInvestmentPortfolio(positions) {
  const positionSummaries = list(positions).map(summarizeInvestmentPosition);
  const totals = positionSummaries.reduce((summary, position) => ({
    contributedMinor: summary.contributedMinor + position.contributedMinor,
    withdrawnMinor: summary.withdrawnMinor + position.withdrawnMinor,
    netContributedMinor: summary.netContributedMinor + position.netContributedMinor,
    currentMinor: summary.currentMinor + position.currentMinor,
    gainMinor: summary.gainMinor + position.gainMinor,
  }), {
    contributedMinor: 0,
    withdrawnMinor: 0,
    netContributedMinor: 0,
    currentMinor: 0,
    gainMinor: 0,
  });
  return {
    ...totals,
    returnPercent: totals.contributedMinor > 0
      ? (totals.gainMinor / totals.contributedMinor) * 100
      : null,
    positions: positionSummaries,
    lastUpdatedAt: positionSummaries
      .map((position) => position.lastUpdatedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || "",
  };
}

export function buildInvestmentHistory(positions) {
  const normalized = list(positions).map(summarizeInvestmentPosition);
  const dates = [...new Set(normalized.flatMap((position) => position.events.map((event) => event.date)))]
    .filter(Boolean)
    .sort();

  return dates.map((date) => {
    const point = normalized.reduce((total, position) => {
      const events = position.events.filter((event) => event.date <= date);
      if (!events.length) return total;
      let balanceMinor = 0;
      events.forEach((event) => {
        if (event.type === "contribution") total.contributedMinor += event.amountMinor;
        if (event.type === "withdrawal") total.withdrawnMinor += event.amountMinor;
        if (Number.isSafeInteger(event.balanceMinor)) balanceMinor = event.balanceMinor;
      });
      total.currentMinor += balanceMinor;
      return total;
    }, { date, contributedMinor: 0, withdrawnMinor: 0, currentMinor: 0 });
    point.netContributedMinor = point.contributedMinor - point.withdrawnMinor;
    point.gainMinor = point.currentMinor + point.withdrawnMinor - point.contributedMinor;
    point.returnPercent = point.contributedMinor > 0
      ? (point.gainMinor / point.contributedMinor) * 100
      : null;
    return point;
  });
}

function projectBalance(initialMinor, monthlyMinor, months, annualRate) {
  const monthlyRate = Math.pow(1 + (annualRate / 100), 1 / 12) - 1;
  let balanceMinor = initialMinor;
  const points = [{ month: 0, balanceMinor, contributedMinor: initialMinor }];
  for (let month = 1; month <= months; month += 1) {
    balanceMinor = Math.round(balanceMinor * (1 + monthlyRate)) + monthlyMinor;
    points.push({ month, balanceMinor, contributedMinor: initialMinor + (monthlyMinor * month) });
  }
  return { balanceMinor, monthlyRate, points };
}

export function projectInvestmentScenario(input = {}) {
  const source = record(input);
  const initialMinor = safeMinor(source.initialMinor);
  const monthlyMinor = safeMinor(source.monthlyMinor);
  const months = Math.min(600, Math.max(1, Math.trunc(Number(source.months) || 1)));
  const annualRate = safeRate(source.annualRate);
  const benchmarkAnnualRate = safeRate(source.benchmarkAnnualRate);
  const projection = projectBalance(initialMinor, monthlyMinor, months, annualRate);
  const benchmark = projectBalance(initialMinor, monthlyMinor, months, benchmarkAnnualRate);
  const contributedMinor = initialMinor + (monthlyMinor * months);
  const gainMinor = projection.balanceMinor - contributedMinor;
  return {
    initialMinor,
    monthlyMinor,
    months,
    annualRate,
    benchmarkAnnualRate,
    monthlyRate: projection.monthlyRate,
    contributedMinor,
    projectedMinor: projection.balanceMinor,
    gainMinor,
    returnPercent: contributedMinor > 0 ? (gainMinor / contributedMinor) * 100 : 0,
    benchmarkProjectedMinor: benchmark.balanceMinor,
    benchmarkDifferenceMinor: projection.balanceMinor - benchmark.balanceMinor,
    points: projection.points.map((point, index) => ({ ...point, benchmarkMinor: benchmark.points[index].balanceMinor })),
  };
}

const FIXED_INCOME_SCENARIOS = [
  { id:"cdb-cdi", name:"CDB pós-fixado", shortName:"CDB", portfolioType:"CDB/RDB", indexer:"CDI", rateKind:"cdi", rateValue:100, incomeTaxExempt:false },
  { id:"lci-cdi", name:"LCI/LCA pós-fixada", shortName:"LCI/LCA", portfolioType:"LCI/LCA", indexer:"CDI", rateKind:"cdi", rateValue:80, incomeTaxExempt:true },
  { id:"tesouro-ipca", name:"Tesouro IPCA+", shortName:"Tesouro IPCA+", portfolioType:"Tesouro Direto", indexer:"IPCA + taxa", rateKind:"ipca", rateValue:7, incomeTaxExempt:false },
  { id:"cri-ipca", name:"CRI/CRA IPCA+", shortName:"CRI/CRA IPCA+", portfolioType:"CRI/CRA", indexer:"IPCA + taxa", rateKind:"ipca", rateValue:8, incomeTaxExempt:true },
  { id:"tesouro-prefixado", name:"Tesouro prefixado", shortName:"Tesouro pré", portfolioType:"Tesouro Direto", indexer:"Prefixado", rateKind:"fixed", rateValue:10, incomeTaxExempt:false },
  { id:"cri-prefixado", name:"CRI/CRA prefixado", shortName:"CRI/CRA pré", portfolioType:"CRI/CRA", indexer:"Prefixado", rateKind:"fixed", rateValue:10, incomeTaxExempt:true },
];

function rounded(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function incomeTaxRateForMonths(months) {
  if (months >= 24) return 15;
  if (months >= 12) return 17.5;
  if (months >= 6) return 20;
  return 22.5;
}

function fixedIncomeAnnualRate(scenario, cdiAnnualRate, ipcaAnnualRate) {
  let annualRate = scenario.rateValue;
  if (scenario.rateKind === "cdi") annualRate = cdiAnnualRate * (scenario.rateValue / 100);
  if (scenario.rateKind === "ipca") {
    annualRate = (((1 + (ipcaAnnualRate / 100)) * (1 + (scenario.rateValue / 100))) - 1) * 100;
  }
  return Math.round(annualRate * 10_000) / 10_000;
}

function fixedIncomeRateLabel(scenario) {
  if (scenario.rateKind === "cdi") return `${scenario.rateValue}% do CDI`;
  if (scenario.rateKind === "ipca") return `IPCA + ${scenario.rateValue}% a.a.`;
  return `${scenario.rateValue}% a.a.`;
}

function netBalanceAtPoint(point, incomeTaxExempt) {
  if (incomeTaxExempt) return point.balanceMinor;
  const gainMinor = Math.max(0, point.balanceMinor - point.contributedMinor);
  const taxMinor = Math.round(gainMinor * (incomeTaxRateForMonths(point.month) / 100));
  return point.balanceMinor - taxMinor;
}

export function compareFixedIncomeScenarios(input = {}) {
  const source = record(input);
  const initialMinor = safeMinor(source.initialMinor);
  const monthlyMinor = safeMinor(source.monthlyMinor);
  const months = Math.min(600, Math.max(1, Math.trunc(Number(source.months) || 1)));
  const cdiAnnualRate = safeRate(source.cdiAnnualRate);
  const ipcaAnnualRate = safeRate(source.ipcaAnnualRate);
  const scenarioRates = record(source.scenarioRates);

  const scenarios = FIXED_INCOME_SCENARIOS.map((defaultScenario) => {
    const scenario = {
      ...defaultScenario,
      rateValue:Object.hasOwn(scenarioRates, defaultScenario.id)
        ? safeRate(scenarioRates[defaultScenario.id])
        : defaultScenario.rateValue,
    };
    const annualRate = fixedIncomeAnnualRate(scenario, cdiAnnualRate, ipcaAnnualRate);
    const projection = projectInvestmentScenario({ initialMinor, monthlyMinor, months, annualRate, benchmarkAnnualRate:cdiAnnualRate });
    const incomeTaxRate = scenario.incomeTaxExempt ? 0 : incomeTaxRateForMonths(months);
    const taxMinor = Math.round(Math.max(0, projection.gainMinor) * (incomeTaxRate / 100));
    const netProjectedMinor = projection.projectedMinor - taxMinor;
    const netGainMinor = netProjectedMinor - projection.contributedMinor;
    return {
      ...scenario,
      annualRate,
      rateLabel:fixedIncomeRateLabel(scenario),
      incomeTaxRate,
      taxLabel:scenario.incomeTaxExempt ? "Isento de IR" : `IR regressivo de ${incomeTaxRate}%`,
      contributedMinor:projection.contributedMinor,
      grossProjectedMinor:projection.projectedMinor,
      taxMinor,
      netProjectedMinor,
      netGainMinor,
      netReturnPercent:projection.contributedMinor > 0 ? (netGainMinor / projection.contributedMinor) * 100 : 0,
      points:projection.points.map((point) => {
        const netBalanceMinor = netBalanceAtPoint(point, scenario.incomeTaxExempt);
        return {
          ...point,
          netBalanceMinor,
          netReturnPercent:point.contributedMinor > 0
            ? ((netBalanceMinor - point.contributedMinor) / point.contributedMinor) * 100
            : 0,
        };
      }),
    };
  });
  const bestScenario = [...scenarios].sort((left, right) => right.netProjectedMinor - left.netProjectedMinor)[0] || null;
  return { initialMinor, monthlyMinor, months, cdiAnnualRate, ipcaAnnualRate, scenarios, bestScenario };
}

export function buildWeightedMarketBasket(input = {}) {
  const source = record(input);
  const entries = list(source.entries).map((entry) => {
    const item = record(entry);
    const weight = Math.min(100, Math.max(0, Number(item.weight) || 0));
    const hasSeries = item.series && typeof item.series === "object" && !Array.isArray(item.series);
    return {
      series:hasSeries ? item.series : null,
      symbol:text(item.symbol),
      weight,
    };
  });
  const allocationTotal = rounded(entries.reduce((total, entry) => total + entry.weight, 0));
  const activeEntries = entries.filter((entry) => entry.weight > 0);
  const missingSymbols = activeEntries
    .filter((entry) => !entry.series || !Array.isArray(entry.series.values))
    .map((entry) => entry.symbol)
    .filter(Boolean);
  if (!activeEntries.length || Math.abs(allocationTotal - 100) > 0.05 || missingSymbols.length) {
    return { allocationTotal, missingSymbols, series:null, valid:false };
  }

  const pointCount = activeEntries[0].series.values.length;
  const incompatibleSeries = activeEntries.some((entry) => (
    entry.series.values.length !== pointCount
    || !entry.series.simulation
  ));
  if (incompatibleSeries) {
    return { allocationTotal, missingSymbols:activeEntries.map((entry) => entry.symbol).filter(Boolean), series:null, valid:false };
  }

  const values = Array.from({ length:pointCount }, (_, index) => {
    const points = activeEntries.map((entry) => Number(entry.series.values[index]));
    if (points.some((value) => !Number.isFinite(value))) return null;
    return rounded(activeEntries.reduce((total, entry, entryIndex) => (
      total + (points[entryIndex] * (entry.weight / allocationTotal))
    ), 0), 4);
  });
  const weightedSimulationValue = (key) => rounded(activeEntries.reduce((total, entry) => (
    total + ((Number(entry.series.simulation[key]) || 0) * (entry.weight / allocationTotal))
  ), 0));
  const finalValue = weightedSimulationValue("finalValue");
  const totalContributed = weightedSimulationValue("totalContributed");
  const gain = rounded(finalValue - totalContributed);
  const returnPercent = [...values].reverse().find((value) => Number.isFinite(value)) ?? 0;
  return {
    allocationTotal,
    missingSymbols:[],
    valid:true,
    series:{
      currency:"BRL",
      id:"MARKET_BASKET",
      kind:"basket",
      lastPrice:null,
      name:"Minha cesta",
      returnPercent,
      simulation:{
        finalValue,
        gain,
        gainPercent:totalContributed > 0 ? rounded((gain / totalContributed) * 100) : 0,
        totalContributed,
      },
      symbol:"CESTA",
      values,
    },
  };
}
