import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { assertPurchaseOwner } from '../functions/billing-domain.mjs';
test('compra Google Play só libera a conta RumoFi vinculada no checkout', () => {
  const purchase = {externalAccountIdentifiers:{obfuscatedExternalAccountId:crypto.createHash('sha256').update('owner').digest('hex')}};
  assert.doesNotThrow(() => assertPurchaseOwner(purchase, 'owner'));
  assert.throws(() => assertPurchaseOwner(purchase, 'other'), {status:403});
  assert.throws(() => assertPurchaseOwner({}, 'owner'), {status:403});
});
