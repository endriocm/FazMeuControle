const { db, requireUser, isAdministrator, toIso, sendError } = require('./_firebaseAdmin');

function freeAccessEmails() {
  return String(process.env.FREE_ACCESS_EMAILS || '')
    .split(/[,\n;]/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });
  try {
    const user = await requireUser(req);
    const userEmail = String(user.email || '').trim().toLowerCase();
    const [entitlement, admin] = await Promise.all([
      db().collection('entitlements').doc(user.uid).get(),
      isAdministrator(user.uid)
    ]);
    if (userEmail && freeAccessEmails().includes(userEmail)) {
      return res.status(200).json({ active: true, source: 'free_email', expiresAt: null, isAdmin: admin });
    }
    const value = entitlement.exists ? entitlement.data() : {};
    const expiresAt = toIso(value.expiresAt);
    const requiresExpiry = ['mercado_pago', 'mercado_pago_subscription'].includes(value.source);
    const active = value.active === true && (
      requiresExpiry
        ? Boolean(expiresAt) && new Date(expiresAt).getTime() > Date.now()
        : (!expiresAt || new Date(expiresAt).getTime() > Date.now())
    );
    return res.status(200).json({ active, source: value.source || null, expiresAt, isAdmin: admin });
  } catch (error) { return sendError(res, error); }
};
