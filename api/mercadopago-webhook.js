const { db, getBody, sendError } = require('./_firebaseAdmin');
const { paymentById, subscriptionById } = require('./_mercadoPago');
const { grantPayment, grantSubscription } = require('./confirm-payment');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).json({ received: true });
  try {
    const body = getBody(req);
    const type = body.type || req.query.type || req.query.topic;
    const resourceId = body.data?.id || req.query['data.id'] || req.query.id;
    if (!type || !resourceId) return res.status(200).json({ received: true });
    if (type === 'payment') {
      const payment = await paymentById(resourceId);
      const uid = String(payment.external_reference || payment.metadata?.firebase_uid || '');
      if (!uid || payment.status !== 'approved') return res.status(200).json({ received: true });
      await grantPayment(uid, payment);
      return res.status(200).json({ received: true });
    }
    if (['preapproval', 'subscription_preapproval'].includes(type)) {
      const subscription = await subscriptionById(resourceId);
      const uid = String(subscription.external_reference || '');
      if (!uid) return res.status(200).json({ received: true });
      if (subscription.status === 'authorized') {
        await grantSubscription(uid, subscription);
      } else if (['cancelled', 'paused'].includes(subscription.status)) {
        await db().collection('entitlements').doc(uid).set({
          active: false,
          source: 'mercado_pago_subscription',
          subscriptionId: String(subscription.id),
          subscriptionStatus: subscription.status,
          updatedAt: new Date()
        }, { merge: true });
      }
    }
    return res.status(200).json({ received: true });
  } catch (error) {
    // O Mercado Pago repetirá a notificação quando houver falha transitória.
    return sendError(res, error);
  }
};
