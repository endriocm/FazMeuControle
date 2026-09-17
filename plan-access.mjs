const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
export function financialBlockCount(data = {}) {
  const custom = (data.categories || []).filter(category => category.financeBlock === true);
  const supports = (category, direction) => ['ambos', direction].includes(category.type || 'saida');
  const covered = (name, direction) => custom.some(category => supports(category, direction) && normalized(category.name) === normalized(name));
  const keys = new Set(custom.map(category => `custom:${category.id || normalized(category.name)}`));
  for (const card of data.cards || []) keys.add(`card:${card.id}`);
  for (const entry of data.entries || []) if (!covered(entry.category, 'entrada')) keys.add('entries');
  for (const expense of data.expenses || []) {
    if (!expense.cardId && !covered(expense.category || 'Despesas', 'saida')) keys.add(`expense:${normalized(expense.category || 'Despesas')}`);
  }
  return keys.size;
}
export function canCreateFinancialBlock(data, status) {
  return status === 'premium' || (status === 'free' && financialBlockCount(data) === 0);
}
export function canChangeFinancialData(before, after, status) {
  if (status === 'premium') return true;
  const previous = financialBlockCount(before);
  const next = financialBlockCount(after);
  // Dados existentes continuam acessíveis após o fim da assinatura.
  return next <= previous || (status === 'free' && next <= 1);
}
