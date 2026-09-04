import {
  FINANCIAL_PLANNING_GOALS,
  createEmptyFinancialPlan,
  createFinancialPlanningGoal,
  effectiveAnnualReturnPct,
  financialPlanAllocationTotal,
  financialPlanFixedPct,
  normalizeFinancialPlan,
  rebalanceFinancialPlanAllocation,
  simulateFinancialPlan,
  suggestFinancialPlanAllocation,
  validateFinancialPlan,
} from "./financial-planning-domain.mjs?v=20260904-1";

const STEP_LABELS = [
  "Início",
  "Renda",
  "Custo de vida",
  "Dívidas",
  "Reserva atual",
  "Meta da reserva",
  "Objetivos",
  "Detalhes das metas",
  "Distribuição",
  "Seu plano",
];

const COLORS = Object.freeze({
  fixed: "#4b5563",
  leisure: "#d4af37",
  debt: "#ef6f61",
  reserve: "#4299e1",
  property: "#2563eb",
  car: "#8b5cf6",
  investments: "#22c55e",
  technology: "#64748b",
  travel: "#f97316",
  education: "#0f766e",
  retirement: "#16a34a",
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}

function formatMoney(minor, options = {}) {
  const value = Number.isFinite(Number(minor)) ? Math.round(Number(minor)) / 100 : 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: options.keepCents || !Number.isInteger(value) ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMoneyInputValue(minor, { editing = false } = {}) {
  const value = Number.isFinite(Number(minor)) ? Math.round(Number(minor)) / 100 : 0;
  if (editing && value === 0) return "";
  return new Intl.NumberFormat("pt-BR", {
    useGrouping: !editing,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function parseMoney(value) {
  const cleaned = String(value ?? "")
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .replace(/[^0-9,.-]/g, "");
  if (!cleaned) return 0;
  let normalized = cleaned;
  if (cleaned.includes(",")) normalized = cleaned.replace(/\./g, "").replace(",", ".");
  else if ((cleaned.match(/\./g) || []).length > 1) normalized = cleaned.replace(/\./g, "");
  else if (/\.\d{3}$/.test(cleaned)) normalized = cleaned.replace(".", "");
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
}

function moneyInput(name, valueMinor, options = {}) {
  return `<input class="financial-planning-input" type="text" inputmode="decimal" autocomplete="off" data-plan-money data-plan-field="${escapeHtml(name)}" value="${escapeHtml(formatMoneyInputValue(valueMinor))}" ${options.required ? "required" : ""} aria-label="${escapeHtml(options.label || name)}" />`;
}

function pct(value) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(Number(value) || 0)}%`;
}

function formatDuration(months) {
  if (!Number.isFinite(months)) return "Sem prazo viável com a distribuição atual";
  const total = Math.max(0, Math.round(months));
  if (total === 0) return "Concluído no início do plano";
  const years = Math.floor(total / 12);
  const rest = total % 12;
  if (!years) return `${rest} ${rest === 1 ? "mês" : "meses"}`;
  if (!rest) return `${years} ${years === 1 ? "ano" : "anos"}`;
  return `${years} ${years === 1 ? "ano" : "anos"} e ${rest} ${rest === 1 ? "mês" : "meses"}`;
}

function goalColor(goal) {
  return COLORS[goal?.type] || COLORS.technology;
}

function allocationColor(id, plan) {
  if (COLORS[id]) return COLORS[id];
  return goalColor(plan.goals.find((goal) => goal.id === id));
}

function goalIcon(type) {
  return ({
    property: "⌂",
    car: "◇",
    investments: "↗",
    technology: "⌘",
    travel: "✦",
    education: "◎",
  })[type] || "●";
}

function fieldValue(plan, field) {
  if (field === "incomeMinor") return plan.incomeMinor;
  if (field === "fixedCostMinor") return plan.fixedCostMinor;
  if (field === "debt.balanceMinor") return plan.debt.balanceMinor;
  if (field === "reserve.currentMinor") return plan.reserve.currentMinor;
  return 0;
}

function setNestedField(plan, field, value) {
  const next = clone(plan);
  if (field === "incomeMinor" || field === "fixedCostMinor") next[field] = value;
  if (field === "debt.balanceMinor") next.debt.balanceMinor = value;
  if (field === "reserve.currentMinor") next.reserve.currentMinor = value;
  return normalizeFinancialPlan(next);
}

function phaseCompletionEvent(phase) {
  return phase.events.find((event) => event.id === phase.focusId) || null;
}

function phaseStatus(phase) {
  if (phase.complete) return "Concluída";
  if (phase.interrupted) return "Reorganizada";
  return "Em projeção";
}

function resultMonthLabel(month) {
  return month === 1 ? "1º mês" : `${month}º mês`;
}

function phaseElapsedMonths(phase) {
  return Math.max(1, Math.round((Number(phase?.elapsedEnd) || 0) - (Number(phase?.elapsedStart) || 0)));
}

function liveAnnouncement(root, message) {
  const target = root.querySelector("[data-plan-live]");
  if (target) target.textContent = message;
}

export function createFinancialPlanningModule({ root, readPlan, savePlan, notify } = {}) {
  if (!(root instanceof HTMLElement)) throw new Error("Raiz do Planejamento Financeiro não encontrada.");
  const getStoredPlan = typeof readPlan === "function" ? readPlan : () => null;
  const persistPlan = typeof savePlan === "function" ? savePlan : () => {};
  const showFeedback = typeof notify === "function" ? notify : () => {};
  let plan = createEmptyFinancialPlan();
  let step = 0;
  let goalIndex = 0;
  let phaseIndex = 0;
  let hasDebt = false;
  let allocationInitialized = false;
  let allocationRebalanced = false;
  let message = "";
  let lastTrigger = null;

  function isOpen() {
    return !root.hidden;
  }

  function progressValue() {
    if (step === 7 && plan.goals.length > 1) {
      return Math.min(88, 70 + ((goalIndex + 1) / plan.goals.length) * 10);
    }
    return Math.round((step / 9) * 100);
  }

  function shell(content, options = {}) {
    const isEditing = false;

    let dots = "";
    const visibleSteps = 8;
    const normalized = step >= 1 && step <= 8 ? step : step === 9 ? 8 : 0;
    for(let i=1; i<=visibleSteps; i++){
      const classes = ["financial-planning-progress-dot"];
      if (i < normalized) classes.push("done");
      if (i === normalized) classes.push("active");
      dots += `<span class="${classes.join(" ")}"></span>`;
    }

    return `
      <div class="shell financial-planning-dialog" role="dialog" aria-modal="true" aria-labelledby="fpd-title" tabindex="-1">
        <section class="app${step === 9 ? " is-result" : ""}">
          <header class="financial-planning-topbar">
            <div class="brand" id="fpd-title">Planejamento <span>Financeiro</span></div>
            <div style="display:flex;align-items:center;gap:12px">
              <div class="step-label" style="font-size:9px;letter-spacing:.06em;text-transform:uppercase">${step > 0 ? STEP_LABELS[step] || "" : ""}</div>
              <div class="financial-planning-progress">${dots}</div>
            </div>
            <button class="financial-planning-close" style="position:absolute; right:15px; top:15px; background:transparent; border:none; font-size:1.5rem; cursor:pointer" type="button" data-plan-action="close" aria-label="Fechar planejamento">×</button>
          </header>
          <main class="content">
            ${message ? `<div class="financial-planning-alert" role="alert" style="color:var(--red);margin-bottom:15px;text-align:center">${escapeHtml(message)}</div>` : ""}
            ${content}
          </main>
          ${options.footer === false ? "" : renderFooter()}
        </section>
        <span class="financial-planning-sr-only" aria-live="polite" data-plan-live></span>
      </div>`;
  }

  function renderFooter() {
    if (step === 0 || step === 9) return "";
    return `
      <footer class="footer">
        <button class="back" type="button" data-plan-action="back" ${step === 0 ? "disabled" : ""}>← Voltar</button>
        <div class="step-label">Etapa ${step} de 8</div>
      </footer>`;
  }

  function renderIntro() {
    const hasStored = Boolean(getStoredPlan()?.incomeMinor);
    return shell(`
      <section class="screen active" data-step="0">
        <div class="text-center" style="margin-bottom: 40px;">
          <div style="display:inline-flex; width: 64px; height: 64px; border-radius: 50%; background: var(--gold-soft); align-items: center; justify-content: center; box-shadow: 0 0 20px rgba(79, 124, 255, 0.2); animation: fadeIn 0.8s ease;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
        </div>
        <div class="kicker text-center">Iniciando</div>
        <h1 class="text-center">Vamos iniciar seu planejamento?</h1>

        <div style="margin: 40px 0; position: relative;">
          <div style="position: absolute; left: 15px; top: 20px; bottom: 20px; width: 2px; background: var(--line); z-index: 0;"></div>

          <div style="display: flex; gap: 20px; align-items: flex-start; margin-bottom: 25px; position: relative; z-index: 1;">
            <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--card); border: 2px solid var(--gold); color: var(--gold); display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.8rem; flex-shrink: 0;">01</div>
            <div>
              <strong style="display: block; font-size: 1.1rem; margin-bottom: 4px;">Entenda sua prioridade</strong>
              <span style="color: var(--muted); font-size: 0.9rem;">Organize a ordem de execução das suas metas.</span>
            </div>
          </div>

          <div style="display: flex; gap: 20px; align-items: flex-start; margin-bottom: 25px; position: relative; z-index: 1;">
            <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--card); border: 2px solid var(--gold); color: var(--gold); display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.8rem; flex-shrink: 0;">02</div>
            <div>
              <strong style="display: block; font-size: 1.1rem; margin-bottom: 4px;">Saiba quanto aportar</strong>
              <span style="color: var(--muted); font-size: 0.9rem;">Defina valores realistas mensalmente.</span>
            </div>
          </div>

          <div style="display: flex; gap: 20px; align-items: flex-start; position: relative; z-index: 1;">
            <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--card); border: 2px solid var(--gold); color: var(--gold); display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.8rem; flex-shrink: 0;">03</div>
            <div>
              <strong style="display: block; font-size: 1.1rem; margin-bottom: 4px;">Veja quando concluirá</strong>
              <span style="color: var(--muted); font-size: 0.9rem;">Saiba as datas exatas das suas conquistas.</span>
            </div>
          </div>
        </div>
        <div class="actions" style="justify-content:center; margin-top: 40px; display:flex; flex-direction:column; gap:12px; align-items:center;">
          <button class="financial-planning-button primary" type="button" data-plan-action="next" style="width: 100%; max-width: 300px;">Construir meu futuro</button>
          ${hasStored ? `<button class="financial-planning-button secondary" type="button" data-plan-action="open-result" style="width: 100%; max-width: 300px;">Abrir rascunho salvo</button>` : ""}
          <button type="button" data-plan-action="close" style="background: transparent; color: var(--muted); border: none; font-size: 0.9rem; margin-top: 8px; cursor: pointer;">← Voltar ao controle de gastos</button>
        </div>
      </section>
    `, { footer: false });
  }

  function question(kicker, title, description, body, actionLabel="Continuar") {
    const isAllocation = step === 8;
    const nextAction = isAllocation ? "generate" : "next";

    return `
      <section class="screen active" data-step="${step}">
        <div class="kicker" style="text-align: center;">${kicker}</div>
        <h2 style="text-align: center;">${title}</h2>
        <p class="lead" style="text-align: center;">${description}</p>

        ${body}

        <div class="actions" style="margin-top:40px;display:flex;justify-content:center">
          <button class="financial-planning-button primary" type="button" data-plan-action="${nextAction}">${actionLabel}</button>
        </div>
      </section>`;
  }

  function renderIncome() {
    return shell(question(
      "Etapa 1 de 8",
      "Qual sua renda líquida mensal?",
      "Use o valor médio que realmente fica disponível na sua conta.",
      `<div class="money-input-wrapper">
        <span class="money-prefix">R$</span>
        ${moneyInput("incomeMinor", plan.incomeMinor, { label: "Renda líquida mensal", required: true })}
      </div>`
    ));
  }

  function renderFixedCost() {
    const pct = plan.incomeMinor > 0 ? ((plan.fixedCostMinor / plan.incomeMinor) * 100).toFixed(2) : 0;
    const pctVisual = Math.min(100, Math.max(0, pct));
    const showFeedback = plan.fixedCostMinor > 0 && plan.incomeMinor > 0;

    return shell(question(
      "Etapa 2 de 8",
      "Quanto custa sua vida fixa hoje?",
      "Moradia, alimentação, transporte e despesas essenciais recorrentes.",
      `<div class="money-input-wrapper">
        <span class="money-prefix">R$</span>
        ${moneyInput("fixedCostMinor", plan.fixedCostMinor, { label: "Custo de vida fixo mensal", required: true })}
      </div>
      ${showFeedback ? `
        <div style="margin-top: 20px; animation: fadeIn 0.3s ease;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <strong style="color: var(--c-fixed);">${pct}% da sua renda</strong>
            <span style="color: var(--muted); font-size: 0.9rem;">Comprometido</span>
          </div>
          <div class="visual-bar-container">
            <div class="visual-bar-fill" style="width: ${pctVisual}%; background: var(--c-fixed);"></div>
          </div>
        </div>
      ` : ''}
      `
    ));
  }

  function renderDebt() {
    return shell(question(
      "Etapa 3 de 8",
      "Quanto você deve hoje?",
      "Se não tiver dívidas, não se preocupe.",
      `
      <div class="choice-row" style="margin-top: 30px;">
        <div class="choice-card ${hasDebt ? "selected" : ""}" data-plan-action="set-debt" data-value="yes" style="--node-color: var(--c-debt); --node-soft: var(--red-soft);">
          <div style="font-size: 2rem; margin-bottom: 10px;">📉</div>
          <strong style="font-size: 1.1rem; ${hasDebt ? 'color: var(--c-debt)' : ''}">Sim, possuo dívida</strong>
        </div>
        <div class="choice-card ${!hasDebt ? "selected" : ""}" data-plan-action="set-debt" data-value="no" style="--node-color: var(--c-investments); --node-soft: var(--green-soft);">
          <div style="font-size: 2rem; margin-bottom: 10px;">✨</div>
          <strong style="font-size: 1.1rem; ${!hasDebt ? 'color: var(--c-investments)' : ''}">Não possuo</strong>
        </div>
      </div>

      ${hasDebt ? `<div style="display:grid;grid-template-columns:1fr;gap:20px;margin-top:30px;animation: fadeIn 0.4s ease;">
        <div>
          <label style="display:block;margin-bottom:10px;font-weight:bold;color:var(--muted);">Saldo total da dívida</label>
          <div class="money-input-wrapper">
            <span class="money-prefix">R$</span>
            ${moneyInput("debt.balanceMinor", plan.debt.balanceMinor, { label: "Saldo total da dívida", required: true })}
          </div>
        </div>
        <div>
          <label style="display:block;margin-bottom:10px;font-weight:bold;color:var(--muted);">Juros da dívida (% a.m.)</label>
          <div class="money-input-wrapper">
            <input type="number" inputmode="decimal" min="0" max="100" step="0.01" data-plan-field="debt.monthlyRatePct" value="${plan.debt.monthlyRatePct}">
            <span style="color:var(--muted);font-size:1.5rem">%</span>
          </div>
        </div>
      </div>` : `<div style="color:var(--c-investments);text-align:center;margin-top:30px;font-weight:600;background:var(--green-soft);padding:20px;border-radius:16px;animation: fadeIn 0.4s ease;">Ótimo! Seu dinheiro livre poderá trabalhar diretamente para a reserva e seus objetivos.</div>`}`
    ));
  }

  function renderReserveCurrent() {
    return shell(question(
      "Etapa 4 de 8",
      "Quanto você já tem de reserva?",
      "Se ainda não tem nada separado para emergências, informe zero.",
      `<div class="money-input-wrapper" style="margin-top:30px;">
        <span class="money-prefix">R$</span>
        ${moneyInput("reserve.currentMinor", plan.reserve.currentMinor, { label: "Reserva de emergência atual" })}
      </div>`
    ));
  }

  function renderReserveTarget() {
    const target = plan.fixedCostMinor * plan.reserve.targetMonths;
    const is6 = plan.reserve.targetMonths === 6;
    const is12 = plan.reserve.targetMonths === 12;
    const is24 = plan.reserve.targetMonths === 24;

    return shell(question(
      "Etapa 5 de 8",
      "Por quanto tempo sua reserva deve proteger você?",
      "Recomendamos que você proteja seu custo de vida por pelo menos 1 ano.",
      `
      <div class="choice-row" style="margin-top: 30px;">
        <div class="choice-card ${is6 ? "selected" : ""}" data-plan-action="set-reserve-target" data-value="6" style="--node-color: var(--c-reserve);">
          <span style="color: var(--muted); font-size: 0.8rem; font-weight: bold; text-transform: uppercase;">Mínimo</span>
          <strong style="font-size: 1.8rem; margin: 10px 0; ${is6 ? 'color: var(--c-reserve)' : ''}">6</strong>
          <span style="font-size: 0.9rem; color: var(--muted);">meses</span>
        </div>
        <div class="choice-card ${is12 ? "selected" : ""}" data-plan-action="set-reserve-target" data-value="12" style="--node-color: var(--c-reserve);">
          <span style="color: var(--gold); font-size: 0.8rem; font-weight: bold; text-transform: uppercase;">Recomendado</span>
          <strong style="font-size: 1.8rem; margin: 10px 0; ${is12 ? 'color: var(--c-reserve)' : ''}">12</strong>
          <span style="font-size: 0.9rem; color: var(--muted);">meses</span>
        </div>
        <div class="choice-card ${is24 ? "selected" : ""}" data-plan-action="set-reserve-target" data-value="24" style="--node-color: var(--c-reserve);">
          <span style="color: var(--c-investments); font-size: 0.8rem; font-weight: bold; text-transform: uppercase;">Ideal</span>
          <strong style="font-size: 1.8rem; margin: 10px 0; ${is24 ? 'color: var(--c-reserve)' : ''}">24</strong>
          <span style="font-size: 0.9rem; color: var(--muted);">meses</span>
        </div>
      </div>

      <div style="text-align:center;margin-top:40px;">
        <span style="color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.1em;font-size:0.8rem;">Sua Meta</span>
        <div style="font-size: 2.5rem; font-weight: 800; color: var(--c-reserve); margin-top: 5px;">${formatMoney(target)}</div>
      </div>
      `
    ));
  }

  function renderGoalSelection() {
    return shell(question(
      "Etapa 6 de 8",
      "O que você quer construir?",
      "Selecione todos os objetivos que fazem parte do seu plano.",
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-top:30px;">
        ${FINANCIAL_PLANNING_GOALS.map((g) => {
          const selected = plan.goals.some((x) => x.name === g.name);
          const color = g.name === 'Imóvel' ? 'var(--c-property)' : g.name === 'Carro' ? 'var(--c-car)' : g.name === 'Viagem' ? 'var(--c-travel)' : g.name === 'Educação' ? 'var(--c-education)' : g.name === 'Tecnologia' ? 'var(--c-tech)' : 'var(--c-investments)';
          const icon = g.name === 'Imóvel' ? '🏠' : g.name === 'Carro' ? '🚗' : g.name === 'Viagem' ? '✈️' : g.name === 'Educação' ? '🎓' : g.name === 'Tecnologia' ? '💻' : '🎯';

          return `<button class="choice-card ${selected ? "selected" : ""}" type="button" data-plan-action="toggle-goal" data-value="${g.name}" style="--node-color: ${color}; text-align: left; padding: 15px; border-width: 2px;">
            <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 8px;">
              <div style="font-size: 1.5rem;">${icon}</div>
              <strong style="font-size: 1.1rem; ${selected ? `color: ${color}` : ''}">${g.name}</strong>
            </div>
            <span style="font-size:0.85rem; color: var(--muted); line-height: 1.4;">${g.description}</span>
          </button>`;
        }).join("")}
      </div>
      <div style="margin-top:30px;text-align:center;font-size:0.9rem;color:var(--muted); font-weight: 600;">
        <strong id="goalCount" style="color:var(--text)">${plan.goals.length}</strong> selecionados
      </div>`,
      plan.goals.length > 0 ? "Continuar" : "Pular objetivos"
    ));
  }

  function renderGoalDetails() {
    const goal = plan.goals[goalIndex];
    if (!goal) return renderAllocation();

    const isPurchase = goal.name === "Imóvel" || goal.name === "Carro";
    const color = goal.name === 'Imóvel' ? 'var(--c-property)' : goal.name === 'Carro' ? 'var(--c-car)' : goal.name === 'Viagem' ? 'var(--c-travel)' : goal.name === 'Educação' ? 'var(--c-education)' : goal.name === 'Tecnologia' ? 'var(--c-tech)' : 'var(--c-investments)';
    const icon = goal.name === 'Imóvel' ? '🏠' : goal.name === 'Carro' ? '🚗' : goal.name === 'Viagem' ? '✈️' : goal.name === 'Educação' ? '🎓' : goal.name === 'Tecnologia' ? '💻' : '🎯';

    const pct = goal.targetMinor > 0 ? ((goal.currentMinor / goal.targetMinor) * 100) : 0;
    const pctVisual = Math.min(100, Math.max(0, pct));
    const left = Math.max(0, goal.targetMinor - goal.currentMinor);

    return shell(question(
      "Etapa 7 de 8",
      `Detalhes do Objetivo`,
      `Prioridade ${goalIndex + 1} de ${plan.goals.length}. Informe o que já tem e o valor desejado.`,
      `
      <div style="background: var(--card); border: 2px solid ${color}; border-radius: 20px; padding: 25px; margin-top: 30px; position: relative; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.05);">

        <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 25px;">
          <div style="width: 48px; height: 48px; border-radius: 12px; background: var(--soft); display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">${icon}</div>
          <div>
            <h3 style="margin: 0; color: ${color};">${goal.name}</h3>
            <span style="font-size: 0.9rem; color: var(--muted); font-weight: 600;">${pctVisual.toFixed(1)}% concluído</span>
          </div>
        </div>

        <div class="visual-bar-container" style="background: var(--line);">
          <div class="visual-bar-fill" style="width: ${pctVisual}%; background: ${color};"></div>
        </div>

        <div style="display: flex; justify-content: space-between; margin-bottom: 30px; margin-top: 10px;">
          <strong style="color: var(--text);">Falta ${formatMoney(left)}</strong>
          <span style="color: var(--muted); font-size: 0.85rem;">Meta ${formatMoney(goal.targetMinor)}</span>
        </div>

        <div style="display:grid;grid-template-columns:1fr;gap:20px;">
          <div>
            <label style="display:block;margin-bottom:8px;font-weight:bold;color:var(--muted);font-size:0.85rem">Valor que já possui</label>
            <div class="money-input-wrapper" style="padding: 12px 15px; font-size: 1.5rem;">
              <span class="money-prefix">R$</span><input class="financial-planning-input" type="text" inputmode="decimal" autocomplete="off" data-plan-money data-plan-goal-id="${escapeHtml(goal.id)}" data-plan-goal-field="currentMinor" value="${escapeHtml(formatMoneyInputValue(goal.currentMinor))}" aria-label="Valor atual de ${escapeHtml(goal.name)}">
            </div>
          </div>
          <div>
            <label style="display:block;margin-bottom:8px;font-weight:bold;color:var(--muted);font-size:0.85rem">Valor total da meta</label>
            <div class="money-input-wrapper" style="padding: 12px 15px; font-size: 1.5rem; border-color: ${color};">
              <span class="money-prefix">R$</span><input class="financial-planning-input" type="text" inputmode="decimal" autocomplete="off" data-plan-money data-plan-goal-id="${escapeHtml(goal.id)}" data-plan-goal-field="targetMinor" value="${escapeHtml(formatMoneyInputValue(goal.targetMinor))}" required aria-label="Meta de ${escapeHtml(goal.name)}">
            </div>
          </div>
          ${isPurchase ? `<div>
            <label style="display:block;margin-bottom:8px;font-weight:bold;color:var(--muted);font-size:0.85rem">Impacto mensal após aquisição</label>
            <div class="money-input-wrapper" style="padding: 12px 15px; font-size: 1.5rem; background: var(--soft);">
              <span class="money-prefix">R$</span><input class="financial-planning-input" type="text" inputmode="decimal" autocomplete="off" data-plan-money data-plan-goal-id="${escapeHtml(goal.id)}" data-plan-goal-field="impactMonthlyMinor" value="${escapeHtml(formatMoneyInputValue(goal.impactMonthlyMinor))}" aria-label="Impacto mensal de ${escapeHtml(goal.name)}">
            </div>
          </div>` : ""}
        </div>
      </div>`,
      goalIndex === plan.goals.length - 1 ? "Ir para distribuição" : "Próximo objetivo"
    ));
  }

  function renderAllocationBar(rows) {
    let html = "";
    for (const row of rows) {
      if (row.pct > 0) {
        html += `<div style="width:${row.pct}%;background:${row.color}; height:100%; transition: width 0.3s ease;"></div>`;
      }
    }
    return `<div style="display:flex;width:100%;height:32px;border-radius:12px;background:var(--line);overflow:hidden;margin:30px 0;box-shadow:inset 0 2px 5px rgba(0,0,0,0.05);">${html}</div>`;
  }

  function renderAllocationBreakdown(rows) {
    const visibleRows = rows.filter((row) => Number(row.pct) > 0 || Number(row.amountMinor) > 0);
    if (!visibleRows.length) return "";
    return `
      <section class="financial-planning-allocation-breakdown" aria-label="Distribuição da renda nesta fase">
        <h4>Distribuição da renda nesta fase</h4>
        <div class="financial-planning-allocation-breakdown-list">
          ${visibleRows.map((row) => `
            <div class="financial-planning-allocation-breakdown-item" style="--allocation-color:${row.color}">
              <span class="financial-planning-allocation-breakdown-name"><i aria-hidden="true"></i>${escapeHtml(row.name)}</span>
              <strong>${pct(row.pct)}</strong>
              <small>${formatMoney(row.amountMinor)}/mês</small>
            </div>
          `).join("")}
        </div>
      </section>`;
  }

  function renderAllocation() {
    const total = financialPlanAllocationTotal(plan);
    const remaining = Math.max(0, 100 - total);
    const valid = validateFinancialPlan(plan).valid && Math.abs(total - 100) < 0.01;
    const colorMap = {
      fixed: "var(--c-fixed)",
      debt: "var(--c-debt)",
      reserve: "var(--c-reserve)",
      leisure: "var(--c-leisure)",
    };
    const rows = [
      { key: "fixed", id: "fixed", name: "Custo de vida", pct: financialPlanFixedPct(plan), color: colorMap.fixed, locked: true },
      ...(hasDebt && plan.debt.balanceMinor > 0 ? [{ key: "debt", id: "debt", name: "Dívidas", pct: plan.allocation.debtPct, color: colorMap.debt }] : []),
      { key: "reserve", id: "reserve", name: "Reserva", pct: plan.allocation.reservePct, color: colorMap.reserve },
      ...plan.goals.map((goal) => ({ key: `goal:${goal.id}`, id: goal.id, name: goal.name, pct: plan.allocation.goalPcts[goal.id] || 0, color: goalColor(goal) })),
      { key: "leisure", id: "leisure", name: "Vida e lazer", pct: plan.allocation.leisurePct, color: colorMap.leisure },
    ];

    return shell(question(
      "Etapa 8 de 8",
      "Sua renda foi organizada",
      `Defina quanto vai para cada lugar. O total deve ser 100%. ${valid ? '<span style="color:var(--c-investments);font-weight:bold">Pronto!</span>' : `Faltam <strong style="color:var(--c-debt)">${remaining.toFixed(2).replace(".00", "")}%</strong>`}`,
      `
      ${allocationRebalanced ? `<div class="financial-planning-rebalance-note"><strong>Percentuais atualizados</strong><span>A nova renda e o custo de vida foram considerados, mantendo a proporção das prioridades que você já havia definido.</span></div>` : ""}
      ${renderAllocationBar(rows)}
      <div style="display:grid;gap:15px">
        ${rows.map((row) => {
          const money = Math.round(plan.incomeMinor * (row.pct / 100));

          return `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:15px 20px;background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:0 2px 10px rgba(0,0,0,0.02);">
              <div style="display:flex;align-items:center;gap:10px;flex:1;">
                <div style="width:12px;height:12px;border-radius:50%;background:${row.color};"></div>
                <div>
                  <strong style="display:block;font-size:1rem;color:var(--text);">${row.name}</strong>
                  <span style="font-size:0.85rem;color:var(--muted);">${formatMoney(money)}/mês</span>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:15px;flex:1;justify-content:flex-end;">
                ${row.locked
                  ? `<strong class="financial-planning-allocation-percent" style="color:var(--muted)">${pct(row.pct)}</strong>`
                  : `<input type="range" min="0" max="100" step="0.25" data-plan-allocation="${escapeHtml(row.key)}" value="${row.pct}" style="accent-color:${row.color};flex:1;max-width:150px;">
                     <strong class="financial-planning-allocation-percent" style="color:${row.color}">${pct(row.pct)}</strong>`
                }
              </div>
            </div>`;
        }).join("")}
      </div>
      ${remaining > 0.01 ? `<button class="financial-planning-button secondary" type="button" data-plan-action="allocation-auto" style="width:100%;margin-top:15px">Distribuir os ${pct(remaining)} restantes automaticamente</button>` : ""}
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:24px;padding:18px;background:var(--soft);border-radius:16px">
        <label><span style="display:block;color:var(--muted);font-size:.78rem;font-weight:700;margin-bottom:6px">Rentabilidade mensal</span><span class="financial-planning-percent-field"><input class="financial-planning-input" type="number" min="0" max="20" step="0.01" data-plan-field="assumptions.monthlyReturnPct" value="${plan.assumptions.monthlyReturnPct}"><b aria-hidden="true">%</b></span></label>
        <label><span style="display:block;color:var(--muted);font-size:.78rem;font-weight:700;margin-bottom:6px">Inflação anual</span><span class="financial-planning-percent-field"><input class="financial-planning-input" type="number" min="0" max="100" step="0.01" data-plan-field="assumptions.annualInflationPct" value="${plan.assumptions.annualInflationPct}"><b aria-hidden="true">%</b></span></label>
        <label><span style="display:block;color:var(--muted);font-size:.78rem;font-weight:700;margin-bottom:6px">Taxa de retirada anual</span><span class="financial-planning-percent-field"><input class="financial-planning-input" type="number" min="0.1" max="20" step="0.01" data-plan-field="assumptions.withdrawalRatePct" value="${plan.assumptions.withdrawalRatePct}"><b aria-hidden="true">%</b></span></label>
      </div>
      <p style="color:var(--muted);font-size:.78rem;line-height:1.5;margin:12px 0 0">Equivale a aproximadamente ${pct(effectiveAnnualReturnPct(plan.assumptions.monthlyReturnPct))} ao ano. São premissas de projeção, não garantia de retorno.</p>
      `,
      valid ? "Gerar meu planejamento" : "Ajuste para 100% para continuar"
    ));
  }

  function renderEvent(event, phase) {
    const recipient = phase.buckets.find((bucket) => bucket.id === event.recipientId)?.name
      || (event.recipientId === "retirement" ? "aposentadoria" : "próxima prioridade");
    if (event.type === "debt-completed") {
      return `<div class="financial-planning-event is-success"><b>Próximo passo</b><p>Com a dívida quitada, ${formatMoney(event.releasedMonthlyMinor)}/mês passam a trabalhar para ${escapeHtml(recipient)}.</p></div>`;
    }
    if (event.type === "goal-completed") {
      return `<div class="financial-planning-event is-success"><b>✓ ${escapeHtml(event.name)} concluído no ${resultMonthLabel(event.month)}</b><p>${formatMoney(event.releasedMonthlyMinor)}/mês foram liberados e redirecionados para ${escapeHtml(recipient)}.</p>${event.impactMinor > 0 ? `<small>O custo de vida aumentou em ${formatMoney(event.impactMinor)}/mês e a reserva foi recalculada.</small>` : ""}</div>`;
    }
    if (event.type === "reserve-completed") {
      return `<div class="financial-planning-event is-success"><b>✓ Reserva protegida</b><p>${formatMoney(event.releasedMonthlyMinor)}/mês seguem para ${escapeHtml(recipient)}.</p></div>`;
    }
    return "";
  }

  function renderStageSummary(phase, phaseColor) {
    const isDebt = phase.focusId === "debt";
    const earnings = Number(phase.focus.earningsMinor) || 0;
    const contributed = Number(phase.focus.contributedMinor) || 0;
    const averageMonthly = Math.round(contributed / phaseElapsedMonths(phase));
    const terms = isDebt
      ? [
          { operator: "", label: "Dívida inicial", value: formatMoney(phase.focus.initialMinor) },
          { operator: "+", label: "Juros cobrados", value: formatMoney(earnings), tone: earnings > 0 ? "is-interest" : "" },
          { operator: "−", label: "Total pago", value: formatMoney(contributed), note: `${formatMoney(averageMonthly)}/mês em média` },
          { operator: "=", label: "Saldo final", value: formatMoney(phase.focus.finalMinor), note: phase.focus.finalMinor <= 0 ? "Dívida quitada" : "Ainda devido", tone: phase.focus.finalMinor <= 0 ? "is-complete" : "is-interest" },
        ]
      : [
          { operator: "", label: "Valor inicial", value: formatMoney(phase.focus.initialMinor), note: "O que já estava acumulado" },
          { operator: "+", label: "Total guardado", value: formatMoney(contributed), note: `${formatMoney(averageMonthly)}/mês em média` },
          { operator: "+", label: "Rendimentos", value: formatMoney(earnings), note: "Gerados pelos juros", tone: "is-yield" },
          { operator: "=", label: "Total acumulado", value: formatMoney(phase.focus.finalMinor), note: "Inicial + guardado + rendimentos", tone: "is-final" },
        ];
    const explanation = isDebt
      ? `Você pagou em média ${formatMoney(averageMonthly)} por mês durante esta etapa.`
      : contributed > 0
        ? `Do seu bolso, você guardou em média ${formatMoney(averageMonthly)} por mês. Os rendimentos foram somados ao saldo e encurtaram o caminho até a meta.`
        : "O valor inicial continuou rendendo e avançou em direção à meta sem novos aportes nesta etapa.";
    return `
      <section class="financial-planning-stage-summary" style="--stage-color:${phaseColor}">
        <header>
          <h4>${isDebt ? "Como a dívida foi quitada" : "De onde veio o total"}</h4>
          <p>${escapeHtml(explanation)}</p>
        </header>
        <div class="financial-planning-value-equation" aria-label="${isDebt ? "Dívida inicial mais juros menos pagamentos igual ao saldo final" : "Valor inicial mais total guardado mais rendimentos igual ao total acumulado"}">
          ${terms.map((term) => `
            ${term.operator ? `<b class="financial-planning-equation-operator" aria-hidden="true">${term.operator}</b>` : ""}
            <div class="financial-planning-equation-term ${term.tone || ""}">
              <span>${term.label}</span>
              <strong>${term.value}</strong>
              <small>${term.note || ""}</small>
            </div>
          `).join("")}
        </div>
      </section>`;
  }

  function renderParallelAccumulation(phase, parallel, phaseDuration) {
    if (!parallel.length) return "";
    const isDebt = phase.focusId === "debt";
    return `
      <section class="financial-planning-accumulation">
        <header>
          <h4>${isDebt ? "Ao quitar a dívida, você terá acumulado" : "Ao final desta etapa, você terá acumulado"}</h4>
          <p>${isDebt
            ? `Sua reserva e seus objetivos continuam crescendo durante esse período de ${escapeHtml(phaseDuration)}.`
            : `Veja quanto as outras prioridades terão acumulado ao fim desse período de ${escapeHtml(phaseDuration)}.`}</p>
        </header>
        <div class="financial-planning-accumulation-grid">
          ${parallel.map((bucket) => {
            const earnings = Number(bucket.earningsMinor) || 0;
            const averageMonthly = Math.round((Number(bucket.contributedMinor) || 0) / phaseElapsedMonths(phase));
            const monthlyCopy = averageMonthly > 0
              ? `Você guardou <strong>${formatMoney(averageMonthly)}/mês</strong> em média`
              : "Sem novos aportes nesta etapa; o saldo cresceu com os rendimentos";
            return `
              <article class="financial-planning-accumulation-card" style="--bucket-color:${allocationColor(bucket.id, plan)}">
                <div class="financial-planning-accumulation-name"><i aria-hidden="true"></i><strong>${escapeHtml(bucket.name)}</strong></div>
                <p class="financial-planning-accumulation-monthly">${monthlyCopy}</p>
                <div class="financial-planning-accumulation-equation">
                  <div><span>Valor inicial</span><b>${formatMoney(bucket.initialMinor)}</b></div>
                  <div><span><i aria-hidden="true">+</i> Total guardado</span><b>${formatMoney(bucket.contributedMinor)}</b></div>
                  <div class="is-yield"><span><i aria-hidden="true">+</i> Rendimentos</span><b>${formatMoney(earnings)}</b></div>
                  <div class="is-total"><span><i aria-hidden="true">=</i> Total acumulado</span><b>${formatMoney(bucket.finalMinor)}</b></div>
                </div>
              </article>`;
          }).join("")}
        </div>
      </section>`;
  }

  function renderPhase(phase, simulation) {
    const completion = phaseCompletionEvent(phase);
    const duration = phase.interrupted ? `${formatDuration(phase.elapsedEnd - phase.elapsedStart)} nesta etapa` : formatDuration(phase.durationMonths);
    const focusTarget = completion?.targetMinor || (phase.focusId === "reserve" ? phase.reserveTargetMinor : 0);
    const phaseRows = phase.allocation.filter((row) => row.amountMinor > 0);
    return `
      <article class="financial-planning-phase-card">
        <header>
          <div><span>Fase ${phase.index + 1} · ${phaseStatus(phase)}</span><h4>${escapeHtml(phase.title)}</h4></div>
          <div class="financial-planning-phase-time"><small>Prazo desta fase</small><strong>${escapeHtml(duration)}</strong></div>
        </header>
        ${renderAllocationBar(phaseRows.map((row) => ({ ...row, value: row.pct })))}
        <div class="financial-planning-phase-allocation">${phaseRows.map((row) => `<span style="--row-color:${allocationColor(row.id, plan)}"><i></i>${escapeHtml(row.name)} <b>${pct(row.pct)}</b><small>${formatMoney(row.amountMinor)}/mês</small></span>`).join("")}</div>
        <section class="financial-planning-focus">
          <div class="financial-planning-focus-head"><div><span>Prioridade atual</span><h5>${escapeHtml(phase.focusName)}</h5></div>${phase.focusKind === "goal" ? `<button class="financial-planning-link" type="button" data-plan-action="edit-goal" data-goal-id="${phase.focusId}">Editar meta</button>` : ""}</div>
          ${focusTarget > 0 ? `<div class="financial-planning-target-progress"><span style="width:${Math.min(100, (phase.focus.finalMinor / focusTarget) * 100)}%"></span></div>` : ""}
          <div class="financial-planning-metrics">
            <div><span>Saldo inicial</span><strong>${formatMoney(phase.focus.initialMinor)}</strong></div>
            <div><span>Aportes</span><strong>${formatMoney(phase.focus.contributedMinor)}</strong></div>
            <div><span>Rendimentos</span><strong>${formatMoney(phase.focus.earningsMinor)}</strong></div>
            <div><span>Saldo ao final</span><strong>${formatMoney(phase.focus.finalMinor)}</strong></div>
          </div>
        </section>
        ${phase.buckets.filter((bucket) => ![phase.focusId, "debt"].includes(bucket.id) && (bucket.finalMinor > 0 || bucket.contributedMinor > 0)).length ? `<section class="financial-planning-parallel"><h5>Evoluindo em paralelo</h5><div>${phase.buckets.filter((bucket) => ![phase.focusId, "debt"].includes(bucket.id) && (bucket.finalMinor > 0 || bucket.contributedMinor > 0)).map((bucket) => `<article><span>${escapeHtml(bucket.name)}</span><strong>${formatMoney(bucket.finalMinor)}</strong><small>Aportes ${formatMoney(bucket.contributedMinor)} · Rendimentos ${formatMoney(bucket.earningsMinor)}</small></article>`).join("")}</div></section>` : ""}
        ${phase.events.length ? `<section class="financial-planning-events">${phase.events.map((event) => renderEvent(event, phase)).join("")}</section>` : ""}
      </article>
      ${phase.focusId === "retirement" ? renderRetirement(simulation) : ""}`;
  }

  function renderRetirement(simulation) {
    const retirement = simulation.retirement;
    return `<section class="financial-planning-retirement">
      <div><span>Etapa final</span><h4>Aposentadoria / Independência Financeira</h4><p>Depois dos objetivos, todo percentual livre passa a construir sua renda futura.</p></div>
      <div class="financial-planning-retirement-grid">
        <article><span>Aporte mensal inicial</span><strong>${formatMoney(retirement.monthlyContributionMinor)}</strong></article>
        <article><span>Prazo da aposentadoria</span><strong>${escapeHtml(formatDuration(retirement.durationMonths))}</strong></article>
        <article><span>Custo de vida projetado</span><strong>${formatMoney(retirement.livingFutureMinor)}</strong></article>
        <article><span>Patrimônio necessário</span><strong>${formatMoney(retirement.targetMinor)}</strong></article>
        <article><span>Capital inicial</span><strong>${formatMoney(retirement.initialMinor)}</strong></article>
        <article><span>Total aportado nesta etapa</span><strong>${formatMoney(retirement.contributedMinor)}</strong></article>
        <article><span>Produzido pelos rendimentos</span><strong>${formatMoney(retirement.earningsMinor)}</strong></article>
      </div>
    </section>`;
  }

  function renderRetirementDestination(simulation, allocationHtml) {
    const retirement = simulation.retirement;
    if (!simulation.feasible) {
      return `<article class="phase-card financial-planning-retirement-destination is-infeasible">
        <header class="financial-planning-retirement-hero">
          <span class="kicker">Destino final</span>
          <h3>O patrimônio ainda não tem prazo viável</h3>
          <p>Com a distribuição atual, o custo de vida corrigido pela inflação cresce mais rápido do que o capital destinado à independência financeira.</p>
        </header>
        ${allocationHtml}
        <div class="financial-planning-retirement-status is-warning">
          Aumente o aporte, reduza o custo projetado ou revise as premissas para gerar uma meta alcançável.
        </div>
      </article>`;
    }

    const impactDetail = retirement.permanentImpactTodayMinor > 0
      ? `${formatMoney(retirement.currentLivingCostMinor)} atuais + ${formatMoney(retirement.permanentImpactTodayMinor)} de impactos futuros`
      : "Custo mensal informado no planejamento";
    const retirementAverageContributionMinor = Math.round(
      retirement.contributedMinor / Math.max(1, Number(retirement.durationMonths) || 1),
    );
    const protectionCopy = retirement.purchasingPowerProtected
      ? `Depois de descontar a inflação e a retirada, resta uma margem real projetada de ${pct(retirement.realGrowthAfterWithdrawalPct)} ao ano.`
      : "Com estas premissas, o retorno real não supera a retirada. Revise rentabilidade, inflação ou taxa de retirada.";

    return `<article class="phase-card financial-planning-retirement-destination">
      <header class="financial-planning-retirement-hero">
        <span class="kicker">Destino final · Independência financeira</span>
        <h3>Quanto você precisa acumular</h3>
        <strong class="financial-planning-retirement-target">${formatMoney(retirement.targetMinor)}</strong>
        <p>A meta cobre o custo de vida futuro sem tratar todo o rendimento mensal como dinheiro disponível. A parte não retirada permanece investida; a margem abaixo mostra se as premissas superam a inflação e a retirada.</p>
      </header>

      <section class="financial-planning-retirement-flow" aria-label="Evolução do custo de vida até a independência financeira">
        <div>
          <span>Custo-base em valores de hoje</span>
          <strong>${formatMoney(retirement.livingTodayMinor)}/mês</strong>
          <small>${escapeHtml(impactDetail)}</small>
        </div>
        <i aria-hidden="true">→</i>
        <div>
          <span>Custo corrigido na independência</span>
          <strong>${formatMoney(retirement.livingFutureMinor)}/mês</strong>
          <small>Atualizado por ${pct(plan.assumptions.annualInflationPct)} a.a. durante ${escapeHtml(formatDuration(simulation.totalPlanMonths))}</small>
        </div>
        <i aria-hidden="true">→</i>
        <div class="is-highlighted">
          <span>Renda mensal sustentável</span>
          <strong>${formatMoney(retirement.sustainableMonthlyIncomeMinor)}/mês</strong>
          <small>Primeira renda mensal projetada; depois, ela acompanha a inflação</small>
        </div>
      </section>

      <div class="financial-planning-retirement-formula">
        <span>Como a meta foi calculada</span>
        <strong>${formatMoney(retirement.livingFutureMinor)}/mês × 12 ÷ ${pct(retirement.withdrawalRatePct)} a.a. = ${formatMoney(retirement.targetMinor)}</strong>
        <small>A taxa de retirada limita quanto sai do patrimônio; ela não usa todo o retorno nominal como renda.</small>
      </div>

      ${allocationHtml}

      <section class="financial-planning-retirement-section">
        <header><span>Formação do patrimônio</span><h4>De onde veio o total acumulado</h4></header>
        <div class="financial-planning-value-equation" style="--stage-color:var(--c-retirement)" aria-label="Capital inicial mais total guardado mais rendimentos igual ao total acumulado">
          <div class="financial-planning-equation-term"><span>Valor inicial</span><strong>${formatMoney(retirement.initialMinor)}</strong><small>Já acumulado ao iniciar esta etapa</small></div>
          <b class="financial-planning-equation-operator" aria-hidden="true">+</b>
          <div class="financial-planning-equation-term"><span>Total guardado</span><strong>${formatMoney(retirement.contributedMinor)}</strong><small>${formatMoney(retirementAverageContributionMinor)}/mês em média</small></div>
          <b class="financial-planning-equation-operator" aria-hidden="true">+</b>
          <div class="financial-planning-equation-term is-yield"><span>Rendimentos</span><strong>${formatMoney(retirement.earningsMinor)}</strong><small>Produzidos pelos juros</small></div>
          <b class="financial-planning-equation-operator" aria-hidden="true">=</b>
          <div class="financial-planning-equation-term is-final"><span>Total acumulado</span><strong>${formatMoney(retirement.accumulatedMinor)}</strong><small>Inicial + guardado + rendimentos</small></div>
        </div>
      </section>

      <section class="financial-planning-retirement-section financial-planning-retirement-protection">
        <header><span>Proteção do poder de compra</span><h4>Quanto rende, quanto vira renda e quanto permanece investido</h4></header>
        <div class="financial-planning-retirement-breakdown">
          <div><span>Rendimento bruto projetado</span><strong>${formatMoney(retirement.expectedMonthlyReturnMinor)}/mês</strong><small>${pct(plan.assumptions.monthlyReturnPct)} a.m. · ${pct(retirement.nominalAnnualReturnPct)} a.a. efetivos</small></div>
          <div><span>Renda para o custo de vida</span><strong>${formatMoney(retirement.sustainableMonthlyIncomeMinor)}/mês</strong><small>Retirada anual de ${pct(retirement.withdrawalRatePct)}</small></div>
          <div class="is-yield"><span>Reinvestimento projetado</span><strong>${formatMoney(retirement.monthlyReinvestedMinor)}/mês</strong><small>Diferença entre retorno bruto e renda retirada</small></div>
          <div><span>Renda no ano seguinte</span><strong>${formatMoney(retirement.livingNextYearMinor)}/mês</strong><small>Após mais um ano de inflação</small></div>
        </div>
        <div class="financial-planning-retirement-status ${retirement.purchasingPowerProtected ? "is-positive" : "is-warning"}">
          <strong>${retirement.purchasingPowerProtected ? "Poder de compra protegido na projeção" : "Atenção às premissas"}</strong>
          <span>${escapeHtml(protectionCopy)}</span>
        </div>
      </section>

      <p class="financial-planning-retirement-disclaimer">Projeção matemática antes de impostos, taxas e oscilações. Rentabilidade, inflação e retirada são premissas de planejamento, não garantia de retorno ou duração do patrimônio.</p>
    </article>`;
  }

  function renderResults() {
    const simulation = simulateFinancialPlan(plan);
    if (!simulation.valid || !simulation.phases.length) {
      return shell(`
        <section class="screen active final-screen" data-step="9">
          <h2>Seu planejamento não pôde ser gerado.</h2>
          <p>${escapeHtml(simulation.errors?.[0]?.message || "Verifique os valores informados nas etapas anteriores.")}</p>
          <div class="actions">
            <button class="financial-planning-button secondary" type="button" data-plan-action="edit-allocation">Revisar distribuição</button>
          </div>
        </section>`, { footer: false });
    }

    phaseIndex = Math.max(0, Math.min(phaseIndex, simulation.phases.length - 1));
    const phase = simulation.phases[phaseIndex] || simulation.phases[0];
    const totalLabel = formatDuration(simulation.totalPlanMonths);
    const isRetirement = phase.focusId === "retirement";
    const phaseGoal = plan.goals.find((goal) => goal.id === phase.focusId);
    const phaseColor = phase.focusId === "debt"
      ? "var(--c-debt)"
      : phase.focusId === "reserve"
        ? "var(--c-reserve)"
        : isRetirement
          ? "var(--c-retirement)"
          : goalColor(phaseGoal);
    const phaseDuration = phase.interrupted
      ? `${formatDuration(phase.elapsedEnd - phase.elapsedStart)} nesta etapa`
      : formatDuration(phase.durationMonths);
    const isDebtPhase = phase.focusId === "debt";
    const phaseDeadlineLabel = isDebtPhase
      ? (phase.complete ? "Dívida quitada em" : "Tempo projetado para quitar")
      : "Prazo desta etapa";

    let timelineHtml = '<div class="timeline-container"><div class="timeline-line"></div>';
    simulation.phases.forEach((p, idx) => {
      const isPast = idx < phaseIndex;
      const isActive = idx === phaseIndex;
      const isRet = p.focusId === "retirement";
      const goal = plan.goals.find((item) => item.id === p.focusId);
      const icon = p.focusId === "reserve" ? "🛡️" : p.focusId === "debt" ? "📉" : isRet ? "🌴" : "🎯";
      const color = p.focusId === "reserve" ? "var(--c-reserve)" : p.focusId === "debt" ? "var(--c-debt)" : isRet ? "var(--c-retirement)" : goalColor(goal);
      let classes = "timeline-node";
      if (isPast) classes += " done";
      if (isActive) classes += " active";
      timelineHtml += `<button type="button" class="${classes}" data-plan-action="goto-phase" data-value="${idx}" aria-current="${isActive ? "step" : "false"}" style="--node-color:${color};--node-soft:${color}33">
        <span class="timeline-label" style="font-size:.75rem;text-transform:uppercase">${escapeHtml(isRet ? "Independência" : p.focusName || p.title)}</span>
        <div class="timeline-circle">${isPast ? '✓' : icon}</div>
        <span class="timeline-label">${escapeHtml(formatDuration(p.durationMonths))}</span>
      </button>`;
    });
    timelineHtml += "</div>";

    const parallel = phase.buckets.filter((bucket) => ![phase.focusId, "debt"].includes(bucket.id) && (bucket.finalMinor > 0 || bucket.contributedMinor > 0));
    const eventHtml = phase.events.map((event) => renderEvent(event, phase)).join("");
    const phaseAllocationRows = phase.allocation.map((row) => ({
      ...row,
      color: allocationColor(row.id, plan),
    }));
    const phaseAllocationHtml = phaseAllocationRows.length
      ? `${renderAllocationBar(phaseAllocationRows)}${renderAllocationBreakdown(phaseAllocationRows)}`
      : "";

    return shell(`
      <section class="screen active final-screen" data-step="9" style="width:100%; display: flex; flex-direction: column; align-items: center; padding-top: 20px;">

        <div style="text-align: center; margin-bottom: 50px;">
          <div class="kicker">Seu Plano Financeiro</div>
          <h2>${simulation.feasible ? "Seu roteiro até a independência financeira" : "Seu plano precisa de mais capacidade mensal"}</h2>
          <p class="lead" style="margin-bottom:0">Tempo total do plano: <strong>${escapeHtml(totalLabel)}</strong>.</p>
        </div>

        <div style="width: 100%; max-width: 900px;">
          ${timelineHtml}
        </div>

        <div style="width: 100%; max-width: 900px; margin-top: 20px;">
          ${isRetirement ? renderRetirementDestination(simulation, phaseAllocationHtml) : `
            <div class="phase-card" style="border-top: 4px solid ${phaseColor};">
              <div class="financial-planning-phase-heading">
                <div>
                  <span style="color: var(--muted); font-weight: bold; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em;">FASE ${phaseIndex + 1}</span>
                  <h3 style="font-size: 2rem; margin: 5px 0 0 0;">${escapeHtml(phase.title)}</h3>
                </div>
                <div class="financial-planning-phase-deadline ${isDebtPhase ? "is-debt" : ""}" style="--deadline-color:${phaseColor}">
                  <span>${phaseDeadlineLabel}</span>
                  <strong>${escapeHtml(phaseDuration)}</strong>
                  <small>${escapeHtml(phaseStatus(phase))}</small>
                </div>
              </div>

              ${phaseAllocationHtml}
              ${renderStageSummary(phase, phaseColor)}
              ${renderParallelAccumulation(phase, parallel, phaseDuration)}
              ${eventHtml ? `<section class="financial-planning-next-step" style="--next-color:${phaseColor}">${eventHtml}</section>` : ""}
            </div>
          `}
        </div>

        <div class="actions" style="display:flex;gap:15px;justify-content:center;margin-top:40px">
          <button class="financial-planning-button secondary" type="button" data-plan-action="prev-phase" ${phaseIndex === 0 ? "disabled" : ""}>← Etapa anterior</button>
          ${phaseIndex < simulation.phases.length - 1 ? `
            <button class="financial-planning-button primary" type="button" data-plan-action="next-phase">Próxima etapa →</button>
          ` : ""}
        </div>
        <div class="actions" style="display:flex;gap:10px;justify-content:center;margin-top:20px">
          <button class="financial-planning-button secondary" type="button" data-plan-action="edit-base">Editar renda</button>
          <button class="financial-planning-button secondary" type="button" data-plan-action="edit-goals">Editar metas</button>
          <button class="financial-planning-button secondary" type="button" data-plan-action="edit-allocation">Editar distribuição</button>
          <button class="financial-planning-button secondary" type="button" data-plan-action="restart" style="color:var(--c-debt)">Reiniciar planejamento</button>
          <button class="financial-planning-button primary" type="button" data-plan-action="close">Concluir e fechar</button>
        </div>
        <p style="color:var(--muted);font-size:.75rem;text-align:center;margin-top:20px">Rentabilidade de ${pct(plan.assumptions.monthlyReturnPct)} a.m., inflação de ${pct(plan.assumptions.annualInflationPct)} a.a. e retirada de ${pct(plan.assumptions.withdrawalRatePct)} a.a. são premissas, não garantias.</p>
      </section>`, { footer: false });
  }

  function render() {
    message = message || "";
    const content = [
      renderIntro,
      renderIncome,
      renderFixedCost,
      renderDebt,
      renderReserveCurrent,
      renderReserveTarget,
      renderGoalSelection,
      renderGoalDetails,
      renderAllocation,
      renderResults,
    ][step]?.() || renderIntro();
    root.innerHTML = content;
    root.dataset.step = String(step);
  }

  function setMessage(value) {
    message = value;
    render();
    requestAnimationFrame(() => root.querySelector("[role=alert]")?.focus?.());
  }

  function validateStep() {
    if (step === 1 && plan.incomeMinor <= 0) return "Informe uma renda líquida mensal maior que zero.";
    if (step === 2 && plan.fixedCostMinor <= 0) return "Informe seu custo de vida mensal.";
    if (step === 2 && plan.fixedCostMinor >= plan.incomeMinor) return "O custo de vida precisa ser menor que a renda para o plano avançar.";
    if (step === 3 && hasDebt && plan.debt.balanceMinor <= 0) return "Informe o saldo total da dívida ou marque que não possui dívida.";
    if (step === 6 && !plan.goals.length) return "Selecione pelo menos um objetivo financeiro.";
    if (step === 7 && (plan.goals[goalIndex]?.targetMinor || 0) <= 0) return "Informe um valor desejado maior que zero.";
    return "";
  }

  function prepareAllocation() {
    if (allocationInitialized) return;
    plan = suggestFinancialPlanAllocation(plan);
    allocationInitialized = true;
  }

  function persistProgress() {
    const now = new Date().toISOString();
    plan = normalizeFinancialPlan({
      ...plan,
      status: "draft",
      currentStep: step,
      createdAt: plan.createdAt || now,
      updatedAt: now,
    });
    persistPlan(clone(plan));
  }

  function rebalanceBaseAllocation() {
    if (!allocationInitialized || plan.incomeMinor <= 0 || plan.fixedCostMinor >= plan.incomeMinor) return;
    const before = JSON.stringify(plan.allocation);
    const adjusted = rebalanceFinancialPlanAllocation(plan);
    if (JSON.stringify(adjusted.allocation) === before) return;
    plan = adjusted;
    allocationRebalanced = true;
    liveAnnouncement(root, "Percentuais redistribuídos para a nova renda e o novo custo de vida.");
  }

  function next() {
    if (step === 1 || step === 2) rebalanceBaseAllocation();
    const error = validateStep();
    if (error) return setMessage(error);
    message = "";
    if (step === 7 && goalIndex < plan.goals.length - 1) goalIndex += 1;
    else if (step < 8) step += 1;
    if (step === 7) goalIndex = Math.max(0, Math.min(goalIndex, plan.goals.length - 1));
    if (step === 8) prepareAllocation();
    persistProgress();
    render();
    focusDialog();
  }

  function back() {
    message = "";
    if (step === 7 && goalIndex > 0) goalIndex -= 1;
    else if (step > 0) step -= 1;
    persistProgress();
    render();
    focusDialog();
  }

  function persist(status, feedback) {
    const now = new Date().toISOString();
    plan = normalizeFinancialPlan({
      ...plan,
      status,
      currentStep: step,
      createdAt: plan.createdAt || now,
      updatedAt: now,
    });
    persistPlan(clone(plan));
    showFeedback(feedback);
  }

  function saveDraft() {
    persist("draft", "Rascunho do planejamento salvo na sua conta");
    liveAnnouncement(root, "Rascunho salvo.");
  }

  function generate() {
    const validation = validateFinancialPlan(plan);
    if (!validation.valid) return setMessage(validation.errors[0]?.message || "Revise os dados do plano.");
    plan = validation.plan;
    step = 9;
    phaseIndex = 0;
    message = "";
    persist("completed", "Planejamento recalculado e salvo na sua conta");
    render();
    focusDialog();
  }

  function updateAllocation(key, rawValue) {
    const value = Math.max(0, Math.min(100, Number(rawValue) || 0));
    const previous = key === "leisure"
      ? plan.allocation.leisurePct
      : key === "debt"
        ? plan.allocation.debtPct
        : key === "reserve"
          ? plan.allocation.reservePct
          : plan.allocation.goalPcts[key.replace("goal:", "")] || 0;
    const capacity = Math.max(0, 100 - financialPlanAllocationTotal(plan) + previous);
    const nextValue = Math.min(value, capacity);
    const next = clone(plan);
    if (key === "leisure") next.allocation.leisurePct = nextValue;
    else if (key === "debt") next.allocation.debtPct = nextValue;
    else if (key === "reserve") next.allocation.reservePct = nextValue;
    else next.allocation.goalPcts[key.replace("goal:", "")] = nextValue;
    plan = normalizeFinancialPlan(next);
  }

  function distributeRemaining() {
    const remaining = Math.max(0, 100 - financialPlanAllocationTotal(plan));
    if (remaining <= 0.01) return;
    const next = clone(plan);
    const firstGoal = next.goals[0];
    if (firstGoal) next.allocation.goalPcts[firstGoal.id] = (next.allocation.goalPcts[firstGoal.id] || 0) + remaining;
    else if (hasDebt) next.allocation.debtPct += remaining;
    else next.allocation.reservePct += remaining;
    plan = normalizeFinancialPlan(next);
  }

  function toggleGoal(type) {
    const next = clone(plan);
    const index = next.goals.findIndex((goal) => goal.type === type);
    if (index >= 0) next.goals.splice(index, 1);
    else {
      const goal = createFinancialPlanningGoal(type, { priority: next.goals.length });
      if (goal) next.goals.push(goal);
    }
    next.goals = next.goals.map((goal, priority) => ({ ...goal, priority }));
    plan = normalizeFinancialPlan(next);
    allocationInitialized = false;
  }

  function moveGoal(direction) {
    const target = goalIndex + direction;
    if (target < 0 || target >= plan.goals.length) return;
    const next = clone(plan);
    [next.goals[goalIndex], next.goals[target]] = [next.goals[target], next.goals[goalIndex]];
    next.goals = next.goals.map((goal, priority) => ({ ...goal, priority }));
    plan = normalizeFinancialPlan(next);
    goalIndex = target;
    allocationInitialized = false;
  }

  function updateStandardField(target) {
    const field = target.dataset.planField;
    if (!field) return;
    if (target.hasAttribute("data-plan-money")) {
      plan = setNestedField(plan, field, parseMoney(target.value));
      return;
    }
    const value = Number(target.value) || 0;
    const next = clone(plan);
    if (field === "debt.monthlyRatePct") next.debt.monthlyRatePct = value;
    if (field === "reserve.targetMonths") next.reserve.targetMonths = value;
    if (field === "assumptions.monthlyReturnPct") next.assumptions.monthlyReturnPct = value;
    if (field === "assumptions.annualInflationPct") next.assumptions.annualInflationPct = value;
    if (field === "assumptions.withdrawalRatePct") next.assumptions.withdrawalRatePct = value;
    plan = normalizeFinancialPlan(next);
  }

  function updateGoalField(target) {
    const id = target.dataset.planGoalId;
    const field = target.dataset.planGoalField;
    if (!id || !field) return;
    const next = clone(plan);
    const goal = next.goals.find((item) => item.id === id);
    if (!goal) return;
    goal[field] = target.hasAttribute("data-plan-money") ? parseMoney(target.value) : Number(target.value) || 0;
    plan = normalizeFinancialPlan(next);
    allocationInitialized = false;
  }

  function moneyValueForTarget(target) {
    const goal = plan.goals.find((item) => item.id === target.dataset.planGoalId);
    return goal ? goal[target.dataset.planGoalField] : fieldValue(plan, target.dataset.planField);
  }

  function focusDialog() {
    requestAnimationFrame(() => {
      const dialog = root.querySelector(".financial-planning-dialog");
      if (!dialog) return;
      dialog.scrollTop = 0;
      dialog.focus({ preventScroll: true });
    });
  }

  function open(trigger = document.activeElement) {
    lastTrigger = trigger instanceof HTMLElement ? trigger : null;
    const stored = getStoredPlan();
    plan = stored ? normalizeFinancialPlan(stored) : createEmptyFinancialPlan();
    hasDebt = plan.debt.balanceMinor > 0;
    allocationInitialized = financialPlanAllocationTotal(plan) > financialPlanFixedPct(plan) + 0.01;
    allocationRebalanced = false;
    step = stored?.status === "completed" ? 9 : Math.max(0, Math.min(8, plan.currentStep || 0));
    goalIndex = 0;
    phaseIndex = 0;
    message = "";
    root.hidden = false;
    document.body.classList.add("financial-planning-open");
    render();
    focusDialog();
  }

  function close() {
    root.hidden = true;
    root.innerHTML = "";
    document.body.classList.remove("financial-planning-open");
    lastTrigger?.focus?.();
  }

  function trapFocus(event) {
    const dialog = root.querySelector(".financial-planning-dialog");
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-plan-action]");
    if (!button) return;
    const action = button.dataset.planAction;
    if (action === "close") return close();
    if (action === "restart") {
      plan = createEmptyFinancialPlan();
      step = 0;
      goalIndex = 0;
      phaseIndex = 0;
      hasDebt = false;
      allocationInitialized = false;
      allocationRebalanced = false;
      message = "";
      persistProgress();
      render();
      return focusDialog();
    }
    if (action === "next") return next();
    if (action === "back") return back();
    if (action === "save-draft") return saveDraft();
    if (action === "set-debt") {
      hasDebt = button.dataset.value === "yes";
      if (!hasDebt) plan = normalizeFinancialPlan({ ...plan, debt: { balanceMinor: 0, monthlyRatePct: 0 } });
      message = "";
      return render();
    }
    if (action === "set-reserve-target") {
      plan = normalizeFinancialPlan({ ...plan, reserve: { ...plan.reserve, targetMonths: Number(button.dataset.value) || 12 } });
      message = "";
      return render();
    }
    if (action === "reserve-preset") {
      plan = normalizeFinancialPlan({ ...plan, reserve: { ...plan.reserve, targetMonths: Number(button.dataset.months) || 12 } });
      return render();
    }
    if (action === "toggle-goal") {
      const gType = button.dataset.goalType || button.dataset.value;
      const match = FINANCIAL_PLANNING_GOALS.find(g => g.name === gType || g.type === gType);
      if (match) toggleGoal(match.type);
      message = "";
      return render();
    }
    if (action === "goto-phase") {
      phaseIndex = Number(button.dataset.value) || 0;
      return render();
    }
    if (action === "prev-phase") {
      phaseIndex = Math.max(0, phaseIndex - 1);
      return render();
    }
    if (action === "next-phase") {
      phaseIndex += 1;
      return render();
    }
    if (action === "goal-up") { moveGoal(-1); return render(); }
    if (action === "goal-down") { moveGoal(1); return render(); }
    if (action === "allocation-auto") { distributeRemaining(); return render(); }
    if (action === "generate") return generate();
    if (action === "open-result") { step = 9; message = ""; render(); return focusDialog(); }
    if (action === "select-phase") { phaseIndex = Number(button.dataset.phaseIndex) || 0; render(); return focusDialog(); }
    if (action === "edit-base") { step = 1; message = ""; allocationRebalanced = false; render(); return focusDialog(); }
    if (action === "edit-goals") { step = 6; message = ""; render(); return focusDialog(); }
    if (action === "edit-allocation") { step = 8; message = ""; allocationInitialized = true; render(); return focusDialog(); }
    if (action === "edit-goal") {
      const index = plan.goals.findIndex((goal) => goal.id === button.dataset.goalId);
      goalIndex = Math.max(0, index);
      step = 7;
      message = "";
      render();
      return focusDialog();
    }
  });

  root.addEventListener("input", (event) => {
    const target = event.target;
    if (target.matches("[data-plan-allocation]")) {
      updateAllocation(target.dataset.planAllocation, target.value);
      return;
    }
    if (target.matches('[data-plan-field="reserve.targetMonths"]')) {
      updateStandardField(target);
      const output = root.querySelector("[data-plan-reserve-output]");
      if (output) output.textContent = `${plan.reserve.targetMonths} meses`;
      return;
    }
    if (target.matches("[data-plan-goal-field]")) updateGoalField(target);
    else if (target.matches("[data-plan-field]")) updateStandardField(target);
  });

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches("[data-plan-allocation]")) {
      updateAllocation(target.dataset.planAllocation, target.value);
      render();
      return;
    }
    if (target.matches("[data-plan-goal-field]")) updateGoalField(target);
    else if (target.matches("[data-plan-field]")) updateStandardField(target);
  });

  root.addEventListener("focusin", (event) => {
    if (!event.target.matches("[data-plan-money]")) return;
    event.target.value = formatMoneyInputValue(moneyValueForTarget(event.target), { editing: true });
    requestAnimationFrame(() => event.target.select());
  });

  root.addEventListener("focusout", (event) => {
    if (!event.target.matches("[data-plan-money]")) return;
    if (event.target.matches("[data-plan-goal-field]")) updateGoalField(event.target);
    else {
      updateStandardField(event.target);
      if (["incomeMinor", "fixedCostMinor"].includes(event.target.dataset.planField)) {
        rebalanceBaseAllocation();
      }
    }
    event.target.value = formatMoneyInputValue(moneyValueForTarget(event.target));
  });

  document.addEventListener("keydown", (event) => {
    if (!isOpen()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") trapFocus(event);
  });

  return { open, close, isOpen };
}
