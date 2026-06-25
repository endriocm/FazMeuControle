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
    if (!user.email) {
      const error = new Error('A conta precisa ter e-mail para criar a assinatura no Mercado Pago.');
      error.statusCode = 400;
      throw error;
    }
    const request = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: currentPlan.label,
        external_reference: user.uid,
        payer_email: user.email,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: currentPlan.amount,
          currency_id: currentPlan.currency
        },
        back_url: origin,
        status: 'pending'
      })
    });
    const payload = await request.json();
    if (!request.ok || !payload.init_point) {
      console.error('Mercado Pago subscription error:', payload);
      const error = new Error('O Mercado Pago não conseguiu iniciar a assinatura.');
      error.statusCode = 502;
      throw error;
    }
    await db().collection('checkoutAttempts').doc(payload.id).set({
      uid: user.uid,
      createdAt: new Date(),
      status: payload.status || 'created',
      type: 'subscription'
    });
    return res.status(200).json({ checkoutUrl: payload.init_point });
  } catch (error) { return sendError(res, error); }
};
