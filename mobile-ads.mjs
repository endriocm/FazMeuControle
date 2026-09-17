import { Capacitor, registerPlugin } from '@capacitor/core';
import { bannerOptions, createAdsController } from './ads-access.mjs';

export function initializeRumoFiAds() {
  if (Capacitor.getPlatform() !== 'android') return { setAccess() {} };
  const privacyButton = document.getElementById('rumofiAdsPrivacy');
  const controller = createAdsController({
    async loadAdapter() {
      const { AdMob, BannerAdPluginEvents } = await import('@capacitor-community/admob');
      const { isDebug } = await registerPlugin('RumoFiAdsConfig').getConfig();
      return {
        initialize: () => AdMob.initialize({ initializeForTesting: isDebug }),
        requestConsentInfo: () => AdMob.requestConsentInfo(),
        showConsentForm: () => AdMob.showConsentForm(),
        showPrivacyOptionsForm: async () => {
          await AdMob.showPrivacyOptionsForm();
          return AdMob.requestConsentInfo();
        },
        showBanner: () => AdMob.showBanner(bannerOptions(isDebug)),
        hideBanner: () => AdMob.hideBanner(),
        resumeBanner: () => AdMob.resumeBanner(),
        removeBanner: () => AdMob.removeBanner(),
        listenHeight: fn => AdMob.addListener(BannerAdPluginEvents.SizeChanged, size => fn(Math.max(0, Number(size.height) || 0))),
        listenFailure: fn => AdMob.addListener(BannerAdPluginEvents.FailedToLoad, fn),
      };
    },
    onHeight: height => document.documentElement.style.setProperty('--rumofi-ad-height', `${height}px`),
    onPrivacy: required => { privacyButton.hidden = !required; },
    onError: () => console.warn('Anúncio indisponível. O RumoFi continua funcionando.'),
  });
  const overlays = ['rumofiAuthRoot', 'modal', 'drawerBackdrop', 'financialPlanningModal', 'subscriptionModal']
    .map(id => document.getElementById(id)).filter(Boolean);
  const menus = [...document.querySelectorAll('.finance-utility-menu')];
  const update = () => void controller.setBlocked(document.hidden
    || overlays.some(el => !el.hidden && !el.classList.contains('hidden'))
    || menus.some(el => el.open));
  const observer = new MutationObserver(update);
  for (const element of [...overlays, ...menus]) {
    observer.observe(element, { attributes: true, attributeFilter: ['hidden', 'class', 'open'] });
  }
  document.addEventListener('visibilitychange', update);
  privacyButton.addEventListener('click', () => void controller.openPrivacy());
  update();
  return controller;
}
