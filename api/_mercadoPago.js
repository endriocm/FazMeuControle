function token() {
  const value = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!value) {
    const error = new Error('Mercado Pago não configurado.');
    error.statusCode = 503;
    throw error;
  }
  return value;
}

function plan() {
  const amount = Number(process.env.PLAN_AMOUNT || 19.9);
  if (!Number.isFinite(amount) || amount <= 0) {
    const error = new Error('Valor do plano inválido.');
    error.statusCode = 500;
    throw error;
  }
  return { amount, currency: process.env.PLAN_CURRENCY || 'BRL', label: process.env.PLAN_LABEL || 'Acesso ao Controle Financeiro' };
}

async function paymentById(paymentId) {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!response.ok) {
    const error = new Error('Não foi possível confirmar o pagamento no Mercado Pago.');
    error.statusCode = 502;
    throw error;
  }
  return response.json();
}

function assertApprovedPayment(payment, uid) {
  const currentPlan = plan();
  if (payment.status !== 'approved') {
    const error = new Error('O pagamento ainda não foi aprovado.');
    error.statusCode = 409;
    throw error;
  }
  if (payment.external_reference !== uid) {
    const error = new Error('Este pagamento não pertence à conta conectada.');
    error.statusCode = 403;
    throw error;
  }
  if (payment.currency_id !== currentPlan.currency || Number(payment.transaction_amount) < currentPlan.amount) {
    const error = new Error('O pagamento não corresponde ao plano atual.');
    error.statusCode = 409;
    throw error;
  }
  return currentPlan;
}

module.exports = { token, plan, paymentById, assertApprovedPayment };
