const { db, getBody, requireUser, sendError } = require('./_firebaseAdmin');
const { paymentById, assertApprovedPayment } = require('./_mercadoPago');

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  try {
    const user = await requireUser(req);
    const paymentId = String(getBody(req).paymentId || '');
    if (!paymentId) return res.status(400).json({ error: 'Identificador de pagamento ausente.' });
    const payment = await paymentById(paymentId);
    await grantPayment(user.uid, payment);
    return res.status(200).json({ access: { active: true, source: 'mercado_pago', expiresAt: null, isAdmin: false } });
  } catch (error) { return sendError(res, error); }
};

module.exports.grantPayment = grantPayment;
