const { db, requireUser, isAdministrator, toIso, sendError } = require('./_firebaseAdmin');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });
  try {
    const user = await requireUser(req);
    const [entitlement, admin] = await Promise.all([
      db().collection('entitlements').doc(user.uid).get(),
      isAdministrator(user.uid)
    ]);
    const value = entitlement.exists ? entitlement.data() : {};
    const expiresAt = toIso(value.expiresAt);
    const active = value.active === true && (!expiresAt || new Date(expiresAt).getTime() > Date.now());
    return res.status(200).json({ active, source: value.source || null, expiresAt, isAdmin: admin });
  } catch (error) { return sendError(res, error); }
};
