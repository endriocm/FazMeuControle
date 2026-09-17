import test from 'node:test';
import assert from 'node:assert/strict';
import { financialBlockCount, canCreateFinancialBlock, canChangeFinancialData } from '../plan-access.mjs';
const empty = { categories: [], entries: [], expenses: [], cards: [] };
const one = { ...empty, categories: [{ id:'c', name:'Meu controle', type:'ambos', financeBlock:true }] };
test('gratuito cria um bloco misto com lançamentos de entrada e saída em meses diferentes', () => {
  assert.equal(canCreateFinancialBlock(empty, 'free'), true);
  assert.equal(canChangeFinancialData(empty, one, 'free'), true);
  assert.equal(canCreateFinancialBlock(one, 'free'), false);
  const filled = {...one, entries:[{category:'Meu controle', plannedDate:'2026-09-01'}], expenses:[{category:'Meu controle', dueDate:'2026-10-01'}]};
  assert.equal(financialBlockCount(filled), 1);
  assert.equal(canChangeFinancialData(one, filled, 'free'), true);
});
test('cartão e blocos implícitos também contam; filtros e mês não liberam blocos extras', () => {
  const other = {...one, cards:[{id:'card'}]};
  assert.equal(financialBlockCount(other), 2);
  assert.equal(canChangeFinancialData(one, other, 'free'), false);
  assert.equal(canChangeFinancialData(one, {...one, expenses:[{category:'Outra'}]}, 'free'), false);
  assert.equal(financialBlockCount({...empty, cards:[{id:'card'}], expenses:[{cardId:'card', category:'Mercado'}]}), 1);
});
test('Premium cria vários blocos e usuário com plano desconhecido aguarda validação', () => {
  const many = {...one, cards:[{id:'card1'}, {id:'card2'}]};
  assert.equal(canCreateFinancialBlock(many, 'premium'), true);
  assert.equal(canChangeFinancialData(empty, many, 'premium'), true);
  assert.equal(canCreateFinancialBlock(empty, 'loading'), false);
  assert.equal(canChangeFinancialData(empty, one, 'loading'), false);
});
test('fim da assinatura preserva edição e exclusão dos blocos existentes, mas impede ampliar', () => {
  const many = {...one, cards:[{id:'card1'}, {id:'card2'}]};
  assert.equal(canChangeFinancialData(many, {...many, cards:[{id:'card1', name:'Editado'}, {id:'card2'}]}, 'free'), true);
  assert.equal(canChangeFinancialData(many, one, 'free'), true);
  assert.equal(canChangeFinancialData(many, {...many, cards:[...many.cards, {id:'card3'}]}, 'free'), false);
});
