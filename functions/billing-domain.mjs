import crypto from 'node:crypto';

export function assertPurchaseOwner(purchase, uid) {
  const expected = crypto.createHash('sha256').update(String(uid)).digest('hex');
  const received = purchase?.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  if (!uid || received !== expected) {
    throw Object.assign(new Error('Esta compra pertence a outra conta RumoFi. Entre na conta usada para assinar.'), { status:403 });
  }
}
