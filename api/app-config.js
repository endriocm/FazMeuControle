module.exports = (req, res) => {
  const required = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_APP_ID'];
  const missing = required.filter((name) => !process.env[name]);
  res.setHeader('Cache-Control', 'no-store');
  if (missing.length) return res.status(200).json({ configured: false, missing });
  const amount = Number(process.env.PLAN_AMOUNT || 19.9);
  const currency = process.env.PLAN_CURRENCY || 'BRL';
  const formatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount);
  return res.status(200).json({
    configured: true,
    firebase: {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
      appId: process.env.FIREBASE_APP_ID
    },
    plan: { amount, currency, formatted, label: process.env.PLAN_LABEL || 'Acesso ao Controle Financeiro' }
  });
};
