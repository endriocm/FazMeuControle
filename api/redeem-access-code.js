const { db, getBody, requireUser, codeId, normalizeCode, toIso, sendError } = require('./_firebaseAdmin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  try {
    const user = await requireUser(req);
    const code = normalizeCode(getBody(req).code);
    if (code.length < 8) return res.status(400).json({ error: 'Informe um código de acesso válido.' });
    const access = await db().runTransaction(async (transaction) => {
      const ref = db().collection('accessCodes').doc(codeId(code));
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        const error = new Error('Código inválido ou já utilizado.');
        error.statusCode = 404;
        throw error;
      }
      const value = snapshot.data();
      const expiresAt = toIso(value.expiresAt);
      if (value.redeemedBy || value.active !== true || (expiresAt && new Date(expiresAt).getTime() <= Date.now())) {
        const error = new Error('Código expirado, inválido ou já utilizado.');
        error.statusCode = 409;
        throw error;
      }
      transaction.update(ref, { active: false, redeemedBy: user.uid, redeemedAt: new Date() });
      transaction.set(db().collection('entitlements').doc(user.uid), { active: true, source: 'access_code', codeId: ref.id, expiresAt: value.accessExpiresAt || null, updatedAt: new Date() }, { merge: true });
      return { active: true, source: 'access_code', expiresAt: toIso(value.accessExpiresAt), isAdmin: false };
    });
    return res.status(200).json({ access });
  } catch (error) { return sendError(res, error); }
};
