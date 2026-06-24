const { db, getBody, sendError } = require('./_firebaseAdmin');
const { paymentById, assertApprovedPayment } = require('./_mercadoPago');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).json({ received: true });
  try {
    const body = getBody(req);
    const type = body.type || req.query.type || req.query.topic;
    const paymentId = body.data?.id || req.query['data.id'] || req.query.id;
    if (type !== 'payment' || !paymentId) return res.status(200).json({ received: true });
    const payment = await paymentById(paymentId);
    const uid = payment.external_reference;
    if (!uid || payment.status !== 'approved') return res.status(200).json({ received: true });
    const currentPlan = assertApprovedPayment(payment, uid);
    await db().collection('entitlements').doc(uid).set({
      active: true,
      source: 'mercado_pago',
      paymentId: String(payment.id),
      plan: currentPlan.label,
      updatedAt: new Date(),
      paidAt: payment.date_approved ? new Date(payment.date_approved) : new Date()
    }, { merge: true });
    return res.status(200).json({ received: true });
  } catch (error) {
    // O Mercado Pago repetirá a notificação quando houver falha transitória.
    return sendError(res, error);
  }
};
