const { db, getBody, requireUser, sendError } = require('./_firebaseAdmin');
const { token, plan } = require('./_mercadoPago');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  try {
    const user = await requireUser(req);
    const origin = String(process.env.APP_URL || '').replace(/\/$/, '');
    if (!origin) {
      const error = new Error('APP_URL não foi configurada na Vercel.');
      error.statusCode = 503;
      throw error;
    }
    const currentPlan = plan();
    const request = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ title: currentPlan.label, quantity: 1, currency_id: currentPlan.currency, unit_price: currentPlan.amount }],
        external_reference: user.uid,
        metadata: { firebase_uid: user.uid },
        payer: { email: user.email || undefined },
        back_urls: { success: origin, pending: origin, failure: origin },
        auto_return: 'approved',
        notification_url: `${origin}/api/mercadopago-webhook`
      })
    });
    const payload = await request.json();
    if (!request.ok || !payload.init_point) {
      console.error('Mercado Pago preference error:', payload);
      const error = new Error('O Mercado Pago não conseguiu iniciar o checkout.');
      error.statusCode = 502;
      throw error;
    }
    await db().collection('checkoutAttempts').doc(payload.id).set({ uid: user.uid, createdAt: new Date(), status: 'created' });
    return res.status(200).json({ checkoutUrl: payload.init_point });
  } catch (error) { return sendError(res, error); }
};
