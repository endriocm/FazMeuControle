// O documento só pode ser gravado pelo servidor que valida a Google Play.
export function subscriptionAccess(data, { fromCache = false, now = Date.now() } = {}) {
  const expiresAt = typeof data?.expiresAt?.toMillis === 'function'
    ? data.expiresAt.toMillis()
    : typeof data?.expiresAt?.seconds === 'number'
      ? data.expiresAt.seconds * 1000
      : Date.parse(data?.expiresAt || '');
  if (data?.active === true && Number.isFinite(expiresAt) && expiresAt > now) {
    return { status: 'premium', expiresAt };
  }
  // Cache vazio ou vencido não prova que a pessoa deixou de ser assinante.
  return { status: fromCache ? 'loading' : 'free', expiresAt: null };
}

export const ANDROID_BANNER_ID = 'ca-app-pub-5960094893354416/5367067192';
export const ANDROID_TEST_BANNER_ID = 'ca-app-pub-3940256099942544/6300978111';
export function bannerOptions(isDebug) {
  return {
    adId: isDebug ? ANDROID_TEST_BANNER_ID : ANDROID_BANNER_ID,
    isTesting: Boolean(isDebug),
    npa: true,
    adSize: 'ADAPTIVE_BANNER',
    position: 'BOTTOM_CENTER',
  };
}

export function createAdsController({ loadAdapter, onHeight = () => {}, onPrivacy = () => {}, onError = () => {} }) {
  let access = { uid: null, status: 'loading' };
  let blocked = true;
  let adapter;
  let ready = false;
  let listening = false;
  let privacyOpen = false;
  let consent;
  let bannerUid = null;
  let visible = false;
  let revision = 0;
  let running = null;
  let failureUid = null;
  const eligible = () => Boolean(access.uid && access.status === 'free');
  const canShow = () => eligible() && !blocked && !privacyOpen;
  const sameUser = uid => canShow() && access.uid === uid;

  async function remove() {
    if (bannerUid) await adapter.removeBanner();
    bannerUid = null;
    visible = false;
    onHeight(0);
  }

  async function reconcile() {
    if (!eligible() || (bannerUid && bannerUid !== access.uid)) await remove();
    if (!canShow()) {
      if (visible) { await adapter.hideBanner(); visible = false; }
      onHeight(0);
      return;
    }
    const uid = access.uid;
    if (failureUid === uid) return;
    adapter ||= await loadAdapter();
    if (!sameUser(uid)) return;
    if (!ready) {
      if (!listening) {
        await adapter.listenHeight(height => onHeight(canShow() && bannerUid === access.uid ? height : 0));
        await adapter.listenFailure(() => { onHeight(0); });
        listening = true;
      }
      consent = await adapter.requestConsentInfo();
      if (!sameUser(uid)) return;
      if (consent.status === 'REQUIRED' && consent.isConsentFormAvailable) {
        consent = await adapter.showConsentForm();
      }
      onPrivacy(consent.privacyOptionsRequirementStatus === 'REQUIRED');
      if (!sameUser(uid)) return;
      if (!consent.canRequestAds) { failureUid = uid; return; }
      await adapter.initialize();
      ready = true;
    }
    if (!sameUser(uid) || !consent?.canRequestAds) return;
    if (!bannerUid) {
      bannerUid = uid;
      visible = true;
      await adapter.showBanner();
    } else if (!visible) {
      visible = true;
      await adapter.resumeBanner();
    }
    // Uma assinatura ou troca de conta pode chegar durante a chamada nativa.
    if (!eligible() || access.uid !== uid) await remove();
    else if (blocked) { await adapter.hideBanner(); visible = false; onHeight(0); }
  }

  function schedule() {
    revision++;
    if (!canShow()) onHeight(0);
    if (!running) {
      running = (async () => {
        let seen;
        do {
          seen = revision;
          try { await reconcile(); }
          catch (error) {
            failureUid = access.uid;
            try { await remove(); } catch { onHeight(0); }
            onError(error);
          }
        } while (seen !== revision);
      })().finally(() => { running = null; });
    }
    return running;
  }

  return {
    setAccess(next) {
      if (access.uid === next.uid && access.status === next.status) return running || Promise.resolve();
      if (access.uid !== next.uid) failureUid = null;
      access = next;
      return schedule();
    },
    setBlocked(value) {
      if (blocked === value) return running || Promise.resolve();
      blocked = value;
      return schedule();
    },
    async openPrivacy() {
      if (!adapter || !consent || privacyOpen) return;
      privacyOpen = true;
      await running;
      try {
        await remove();
        consent = await adapter.showPrivacyOptionsForm();
        onPrivacy(consent.privacyOptionsRequirementStatus === 'REQUIRED');
        failureUid = null;
      } catch (error) { consent = null; onError(error); }
      finally { privacyOpen = false; }
      return schedule();
    },
  };
}
