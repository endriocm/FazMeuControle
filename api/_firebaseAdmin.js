const admin = require('firebase-admin');
const { createHash, randomBytes } = require('crypto');

function getFirebase() {
  if (admin.apps.length) return admin;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase Admin não configurado.');
  }
  admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
  return admin;
}

function db() { return getFirebase().firestore(); }

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function bearerToken(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

async function requireUser(req) {
  const token = bearerToken(req);
  if (!token) {
    const error = new Error('Autenticação obrigatória.');
    error.statusCode = 401;
    throw error;
  }
  try {
    return await getFirebase().auth().verifyIdToken(token);
  } catch {
    const error = new Error('Sessão inválida ou expirada.');
    error.statusCode = 401;
    throw error;
  }
}

function normalizeCode(value = '') { return String(value).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function codeId(value) { return createHash('sha256').update(normalizeCode(value)).digest('hex'); }
function makeCode() {
  const value = randomBytes(6).toString('hex').toUpperCase();
  return `CF-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}
function toIso(value) { return value?.toDate ? value.toDate().toISOString() : value ? new Date(value).toISOString() : null; }

async function isAdministrator(uid) {
  const snapshot = await db().collection('administrators').doc(uid).get();
  return snapshot.exists && snapshot.data()?.active === true;
}

function sendError(res, error) {
  const status = error.statusCode || 500;
  console.error(error);
  return res.status(status).json({ error: status === 500 ? 'Erro interno do serviço.' : error.message });
}

module.exports = { admin, db, getBody, requireUser, normalizeCode, codeId, makeCode, toIso, isAdministrator, sendError };
