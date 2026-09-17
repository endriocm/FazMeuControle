import test from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionAccess, bannerOptions, ANDROID_TEST_BANNER_ID, ANDROID_BANNER_ID, createAdsController } from '../ads-access.mjs';

test('assinatura vigente remove anúncios inclusive após cancelamento; cache ausente não libera anúncios', () => {
  const valid = { active: true, expiresAt: { seconds: 200 }, subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' };
  assert.equal(subscriptionAccess(valid, { now: 100_000 }).status, 'premium');
  assert.equal(subscriptionAccess(valid, { now: 100_000, fromCache: true }).status, 'premium');
  assert.equal(subscriptionAccess(valid, { now: 200_000 }).status, 'free');
  assert.equal(subscriptionAccess(valid, { now: 200_000, fromCache: true }).status, 'loading');
  assert.equal(subscriptionAccess(undefined, { fromCache: true }).status, 'loading');
  assert.equal(subscriptionAccess(undefined).status, 'free');
  assert.equal(subscriptionAccess({ active: false, expiresAt: { seconds: 200 } }, { now: 100_000 }).status, 'free');
});

test('compilação debug sempre usa o banner de teste', () => {
  assert.equal(bannerOptions(true).adId, ANDROID_TEST_BANNER_ID);
  assert.equal(bannerOptions(true).isTesting, true);
  assert.equal(bannerOptions(false).adId, ANDROID_BANNER_ID);
  assert.equal(bannerOptions(false).isTesting, false);
});

const free = { uid: 'a', status: 'free' };
const premium = { uid: 'a', status: 'premium' };
const consent = { status: 'NOT_REQUIRED', canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' };
function fixture(overrides = {}) {
  const calls = [];
  const heights = [];
  const adapter = Object.fromEntries(['initialize', 'hideBanner', 'resumeBanner', 'removeBanner', 'listenFailure']
    .map(name => [name, async () => { calls.push(name); }]));
  Object.assign(adapter, {
    listenHeight: async fn => { adapter.size = fn; },
    requestConsentInfo: async () => { calls.push('consent'); return consent; },
    showBanner: async () => { calls.push('show'); adapter.size(50); },
    showConsentForm: async () => consent,
    showPrivacyOptionsForm: async () => consent,
  }, overrides);
  const controller = createAdsController({
    loadAdapter: async () => { calls.push('load'); return adapter; },
    onHeight: height => heights.push(height),
  });
  return { controller, calls, heights };
}

test('deslogado, assinatura desconhecida e Premium não carregam SDK', async () => {
  const { controller, calls } = fixture();
  await controller.setBlocked(false);
  await controller.setAccess({ uid: 'a', status: 'loading' });
  await controller.setAccess(premium);
  assert.deepEqual(calls, []);
});

test('gratuito exibe; formulário oculta; fechar restaura; assinatura destrói banner', async () => {
  const { controller, calls, heights } = fixture();
  await controller.setAccess(free);
  assert.deepEqual(calls, []);
  await controller.setBlocked(false);
  assert.equal(calls.filter(x => x === 'show').length, 1);
  assert.equal(heights.at(-1), 50);
  await controller.setBlocked(true);
  assert.equal(calls.at(-1), 'hideBanner');
  assert.equal(heights.at(-1), 0);
  await controller.setBlocked(false);
  assert.equal(calls.at(-1), 'resumeBanner');
  await controller.setAccess(premium);
  assert.equal(calls.at(-1), 'removeBanner');
  assert.equal(heights.at(-1), 0);
});

test('assinatura recebida enquanto consulta consentimento impede pedido de anúncio', async () => {
  const gate = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const { controller, calls } = fixture({ requestConsentInfo: () => { entered.resolve(); return gate.promise; } });
  await controller.setBlocked(false);
  const pending = controller.setAccess(free);
  await entered.promise;
  controller.setAccess(premium);
  gate.resolve(consent);
  await pending;
  assert.ok(!calls.includes('show'));
  assert.ok(!calls.includes('initialize'));
});

test('logout durante exibição nativa remove o banner que terminou de carregar', async () => {
  const gate = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const { controller, calls } = fixture({ showBanner: () => { entered.resolve(); return gate.promise; } });
  await controller.setBlocked(false);
  const pending = controller.setAccess(free);
  await entered.promise;
  controller.setAccess({ uid: null, status: 'loading' });
  gate.resolve();
  await pending;
  assert.equal(calls.at(-1), 'removeBanner');
});

test('troca de conta não reutiliza o banner da conta anterior', async () => {
  const { controller, calls } = fixture();
  await controller.setBlocked(false);
  await controller.setAccess(free);
  await controller.setAccess({ uid: 'b', status: 'free' });
  assert.deepEqual(calls.slice(-2), ['removeBanner', 'show']);
});

test('consentimento indisponível mantém o financeiro sem publicidade', async () => {
  const { controller, calls } = fixture({ requestConsentInfo: async () => ({ ...consent, canRequestAds: false }) });
  await controller.setBlocked(false);
  await controller.setAccess(free);
  assert.ok(!calls.includes('initialize'));
  assert.ok(!calls.includes('show'));
});

test('erro de SDK não propaga para o app nem repete pedidos em cada formulário', async () => {
  const { controller, calls } = fixture({ initialize: async () => { throw new Error('offline'); } });
  await controller.setBlocked(false);
  await controller.setAccess(free);
  await controller.setBlocked(true);
  await controller.setBlocked(false);
  assert.equal(calls.filter(x => x === 'load').length, 1);
  assert.ok(!calls.includes('show'));
});

test('alteração de privacidade que impede anúncios destrói banner e não o restaura', async () => {
  const { controller, calls } = fixture({ showPrivacyOptionsForm: async () => ({ ...consent, canRequestAds: false }) });
  await controller.setBlocked(false);
  await controller.setAccess(free);
  await controller.openPrivacy();
  assert.equal(calls.at(-1), 'removeBanner');
});
