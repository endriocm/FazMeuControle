const { db, getBody, requireUser, makeCode, codeId, isAdministrator, sendError } = require('./_firebaseAdmin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  try {
    const user = await requireUser(req);
    if (!await isAdministrator(user.uid)) {
      const error = new Error('Esta conta não tem permissão para gerar códigos.');
      error.statusCode = 403;
      throw error;
    }
    const days = Math.max(1, Math.min(3650, Number(getBody(req).days) || 30));
    let code = makeCode();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const ref = db().collection('accessCodes').doc(codeId(code));
      if (!(await ref.get()).exists) {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        await ref.set({ active: true, createdBy: user.uid, createdAt: now, expiresAt, accessExpiresAt: expiresAt });
        return res.status(201).json({ code, expiresAt: expiresAt.toISOString() });
      }
      code = makeCode();
    }
    const error = new Error('Não foi possível gerar um código exclusivo.');
    error.statusCode = 503;
    throw error;
  } catch (error) { return sendError(res, error); }
};
