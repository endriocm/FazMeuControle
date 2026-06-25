const { db, getBody, requireUser, sendError } = require('./_firebaseAdmin');
const { paymentById, subscriptionById, assertApprovedPayment, assertSubscriptionOwner } = require('./_mercadoPago');

async function grantPayment(uid, payment) {
  const currentPlan = assertApprovedPayment(payment, uid);
  await db().collection('entitlements').doc(uid).set({
    active: true,
    source: 'mercado_pago',
    paymentId: String(payment.id),
    plan: currentPlan.label,
    updatedAt: new Date(),
    paidAt: payment.date_approved ? new Date(payment.date_approved) : new Date()
  }, { merge: true });
}

async function grantSubscription(uid, subscription) {
  const currentPlan = assertSubscriptionOwner(subscription, uid);
  if (subscription.status !== 'authorized') {
    const error = new Error('A assinatura ainda não foi autorizada no Mercado Pago.');
    error.statusCode = 409;
    throw error;
  }
  await db().collection('entitlements').doc(uid).set({
    active: true,
    source: 'mercado_pago_subscription',
    subscriptionId: String(subscription.id),
    plan: currentPlan.label,
    subscriptionStatus: subscription.status,
    updatedAt: new Date(),
    subscribedAt: subscription.date_created ? new Date(subscription.date_created) : new Date(),
    nextPaymentDate: subscription.next_payment_date ? new Date(subscription.next_payment_date) : null
  }, { merge: true });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  try {
    const user = await requireUser(req);
    const body = getBody(req);
    const paymentId = String(body.paymentId || '');
    const preapprovalId = String(body.preapprovalId || body.preapproval_id || '');
    if (preapprovalId) {
      const subscription = await subscriptionById(preapprovalId);
      await grantSubscription(user.uid, subscription);
      return res.status(200).json({ access: { active: true, source: 'mercado_pago_subscription', expiresAt: null, isAdmin: false } });
    }
    if (!paymentId) return res.status(400).json({ error: 'Identificador de pagamento ausente.' });
    const payment = await paymentById(paymentId);
    await grantPayment(user.uid, payment);
    return res.status(200).json({ access: { active: true, source: 'mercado_pago', expiresAt: null, isAdmin: false } });
  } catch (error) { return sendError(res, error); }
};

module.exports.grantPayment = grantPayment;
module.exports.grantSubscription = grantSubscription;
