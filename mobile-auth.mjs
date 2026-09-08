import { initializeApp } from "firebase/app";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import {
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

export const RUMOFI_FIREBASE_CONFIG = Object.freeze({
  apiKey: "AIzaSyAXBNY-V0NOl0D1GqPwRdkRWMsH2x0SIzc",
  authDomain: "rumofi-69b1e.firebaseapp.com",
  projectId: "rumofi-69b1e",
  storageBucket: "rumofi-69b1e.firebasestorage.app",
  messagingSenderId: "1029093351080",
  appId: "1:1029093351080:web:6bb6998a88aad59656ec9d",
});

export const RUMOFI_PRIVACY_NOTICE_VERSION = "2026-09-04-v1";

const LOGIN_TIMEOUT_MS = 12_000;
const CLOUD_SAVE_DELAY_MS = 550;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeEmail(value = "") {
  return String(value).trim().toLowerCase();
}

export function normalizeBrazilianPhone(value = "") {
  const digits = String(value).replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if(digits.length < 10 || digits.length > 11) return "";
  return `+55${digits}`;
}

export function formatBrazilianPhone(value = "") {
  const digits = String(value).replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "").slice(0, 11);
  if(digits.length <= 2) return digits;
  if(digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if(digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function withTimeout(promise, timeoutMs = LOGIN_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("network-timeout")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function authErrorMessage(error) {
  const code = String(error?.code || error?.message || "");
  if(code.includes("operation-not-allowed") || code.includes("configuration-not-found") || code.includes("CONFIGURATION_NOT_FOUND")) {
    return "Este tipo de acesso ainda não foi ativado no Firebase do RumoFi.";
  }
  if(code.includes("account-exists-with-different-credential")) return "Este e-mail já usa outra forma de acesso. Entre com sua senha e tente novamente.";
  if(code.includes("credential-already-in-use")) return "Esta conta Google já está vinculada a outro acesso.";
  if(code.includes("google-id-token-missing")) return "O Google não devolveu uma credencial válida. Tente novamente.";
  if(code.includes("canceled") || code.includes("cancelled") || code.includes("popup-closed")) return "O acesso com Google foi cancelado.";
  if(code.includes("email-already-in-use")) return "Este e-mail já possui uma conta. Entre com sua senha.";
  if(code.includes("weak-password")) return "Crie uma senha com pelo menos 6 caracteres.";
  if(code.includes("invalid-email")) return "Informe um e-mail válido.";
  if(code.includes("too-many-requests")) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  if(code.includes("network-request-failed") || code.includes("network-timeout") || code.includes("unavailable")) {
    return "Não foi possível conectar agora. Confira a internet e tente novamente.";
  }
  if(code.includes("requires-recent-login")) return "Por segurança, saia, entre novamente e repita esta ação.";
  if(code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "E-mail ou senha incorretos.";
  }
  return "Não foi possível concluir. Tente novamente.";
}

function privacyNoticeMarkup() {
  return `
    <details class="rumofi-privacy-notice">
      <summary>Como seus dados serão usados</summary>
      <div>
        <p><strong>Dados da conta:</strong> nome, e-mail e telefone identificam seu acesso e permitem suporte.</p>
        <p><strong>Dados financeiros:</strong> lançamentos, cartões e planejamento ficam vinculados à sua conta para sincronizar seus dispositivos.</p>
        <p><strong>Marketing:</strong> mensagens por e-mail ou WhatsApp só serão enviadas nas opções que você autorizar. A autorização é opcional e pode ser retirada em “Minha conta”.</p>
        <p>Você pode corrigir seus dados, sair e excluir definitivamente sua conta pelo próprio aplicativo.</p>
      </div>
    </details>`;
}

function accountInitial(name = "") {
  const first = String(name).trim().charAt(0);
  return first ? first.toUpperCase() : "R";
}

function hasAuthProvider(user, providerId) {
  return Boolean(user?.providerData?.some((provider) => provider?.providerId === providerId));
}

function googleIconMarkup() {
  return `<svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
    <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.715v2.258h2.909c1.702-1.567 2.684-3.875 2.684-6.614Z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.181l-2.909-2.258c-.806.54-1.835.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z"/>
    <path fill="#FBBC05" d="M3.963 10.706A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.167.281-1.706V4.962H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.038l3.007-2.332Z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.464.892 11.427 0 9 0A9 9 0 0 0 .956 4.962l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58Z"/>
  </svg>`;
}

export async function initializeRumoFiAuth({
  root,
  appShell,
  accountButton,
  onUserReady,
  onSignedOut,
  onAccountDeleted,
  onCloudStatus,
}) {
  if(!root || !appShell) throw new Error("Estrutura de autenticação ausente.");

  const firebaseApp = initializeApp(RUMOFI_FIREBASE_CONFIG);
  const isNative = Capacitor.isNativePlatform();
  let auth;
  if(isNative) {
    try {
      auth = initializeAuth(firebaseApp, { persistence:indexedDBLocalPersistence });
    } catch(error) {
      if(!String(error?.code || error?.message || "").includes("already-initialized")) throw error;
      auth = getAuth(firebaseApp);
    }
  } else {
    auth = getAuth(firebaseApp);
  }
  const db = getFirestore(firebaseApp);
  auth.languageCode = "pt-BR";

  let currentProfile = null;
  let currentUser = null;
  let saveTimer = null;
  let pendingPayload = null;
  let cloudWrite = null;
  let currentView = "loading";

  const profileRef = (uid) => doc(db, "profiles", uid);
  const financeRef = (uid) => doc(db, "financialData", uid);

  function setBodyLocked(locked) {
    document.body.classList.toggle("rumofi-auth-open", locked);
  }

  function setCloudStatus(status, message) {
    onCloudStatus?.({ status, message });
  }

  function setFeedback(message = "", type = "error") {
    const node = root.querySelector("[data-auth-feedback]");
    if(!node) return;
    node.textContent = message;
    node.dataset.type = type;
    node.hidden = !message;
  }

  function setBusy(busy) {
    root.setAttribute("aria-busy", String(Boolean(busy)));
    root.querySelectorAll("button, input").forEach((element) => {
      if(element.matches("[data-auth-close]") && !busy) return;
      element.disabled = Boolean(busy);
    });
  }

  function showLoading(message = "Preparando seu acesso…") {
    currentView = "loading";
    appShell.hidden = true;
    root.hidden = false;
    setBodyLocked(true);
    root.innerHTML = `
      <main class="rumofi-auth-screen" aria-live="polite">
        <section class="rumofi-auth-card rumofi-auth-loading-card">
          <div class="rumofi-auth-logo" aria-hidden="true">R</div>
          <p class="rumofi-auth-kicker">RumoFi</p>
          <h1>${escapeHtml(message)}</h1>
          <span class="rumofi-auth-spinner" aria-hidden="true"></span>
        </section>
      </main>`;
  }

  function showLogin(prefillEmail = "") {
    currentView = "login";
    appShell.hidden = true;
    root.hidden = false;
    setBodyLocked(true);
    root.innerHTML = `
      <main class="rumofi-auth-screen">
        <section class="rumofi-auth-card">
          <header class="rumofi-auth-brand">
            <div class="rumofi-auth-logo" aria-hidden="true">R</div>
            <div><p>RumoFi</p><span>Seu controle financeiro, em todos os dispositivos.</span></div>
          </header>
          <div class="rumofi-auth-heading">
            <p class="rumofi-auth-kicker">Bem-vindo</p>
            <h1>Entre na sua conta</h1>
            <p>Seus dados ficam separados dos demais usuários e sincronizados após cada salvamento.</p>
          </div>
          <form class="rumofi-auth-form" data-auth-form="login" novalidate>
            <button class="rumofi-auth-google" type="button" data-auth-action="google-signin">${googleIconMarkup()}<span>Entrar com Google</span></button>
            <div class="rumofi-auth-divider rumofi-auth-divider-inline"><span>ou use seu e-mail</span></div>
            <label>E-mail<input name="email" type="email" inputmode="email" autocomplete="email" value="${escapeHtml(prefillEmail)}" required></label>
            <label>Senha<input name="password" type="password" autocomplete="current-password" minlength="6" required></label>
            <p class="rumofi-auth-device-note">Você continuará conectado neste dispositivo.</p>
            <p class="rumofi-auth-feedback" data-auth-feedback role="alert" hidden></p>
            <button class="rumofi-auth-primary" type="submit">Entrar</button>
            <button class="rumofi-auth-link" type="button" data-auth-action="forgot-password">Esqueci minha senha</button>
          </form>
          <div class="rumofi-auth-divider"><span>Primeiro acesso?</span></div>
          <button class="rumofi-auth-secondary" type="button" data-auth-action="show-signup">Criar minha conta</button>
        </section>
      </main>`;
    requestAnimationFrame(() => root.querySelector('input[name="email"]')?.focus());
  }

  function showSignup(prefillEmail = "") {
    currentView = "signup";
    appShell.hidden = true;
    root.hidden = false;
    setBodyLocked(true);
    root.innerHTML = `
      <main class="rumofi-auth-screen">
        <section class="rumofi-auth-card">
          <header class="rumofi-auth-brand">
            <div class="rumofi-auth-logo" aria-hidden="true">R</div>
            <div><p>RumoFi</p><span>Uma conta pessoal para o seu dinheiro.</span></div>
          </header>
          <div class="rumofi-auth-heading">
            <p class="rumofi-auth-kicker">Cadastro</p>
            <h1>Crie sua conta</h1>
            <p>Nome, e-mail e telefone serão usados para identificar seu acesso e oferecer suporte.</p>
          </div>
          <form class="rumofi-auth-form" data-auth-form="signup" novalidate>
            <button class="rumofi-auth-google" type="button" data-auth-action="google-signin">${googleIconMarkup()}<span>Criar conta com Google</span></button>
            <div class="rumofi-auth-divider rumofi-auth-divider-inline"><span>ou cadastre com e-mail</span></div>
            <label>Nome completo<input name="name" type="text" autocomplete="name" minlength="2" maxlength="100" required></label>
            <label>E-mail<input name="email" type="email" inputmode="email" autocomplete="email" value="${escapeHtml(prefillEmail)}" required></label>
            <label>Telefone com DDD<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(11) 99999-9999" maxlength="16" required></label>
            <label>Senha<input name="password" type="password" autocomplete="new-password" minlength="6" required><small>Mínimo de 6 caracteres.</small></label>
            ${privacyNoticeMarkup()}
            <label class="rumofi-auth-check required"><input name="privacyAcknowledged" type="checkbox" required><span>Li o aviso acima e estou ciente dos tratamentos necessários para criar e operar minha conta.</span></label>
            <fieldset class="rumofi-auth-consents">
              <legend>Comunicações opcionais</legend>
              <label class="rumofi-auth-check"><input name="marketingEmail" type="checkbox"><span>Quero receber novidades e ofertas por e-mail.</span></label>
              <label class="rumofi-auth-check"><input name="marketingWhatsapp" type="checkbox"><span>Quero receber novidades e ofertas por WhatsApp/SMS.</span></label>
            </fieldset>
            <p class="rumofi-auth-feedback" data-auth-feedback role="alert" hidden></p>
            <button class="rumofi-auth-primary" type="submit">Criar conta</button>
            <button class="rumofi-auth-link" type="button" data-auth-action="show-login">Já tenho uma conta</button>
          </form>
        </section>
      </main>`;
    requestAnimationFrame(() => root.querySelector('input[name="name"]')?.focus());
  }

  function showGoogleProfileCompletion() {
    if(!currentUser) return;
    currentView = "google-profile";
    appShell.hidden = true;
    root.hidden = false;
    setBodyLocked(true);
    const name = currentProfile?.displayName || currentUser.displayName || "";
    root.innerHTML = `
      <main class="rumofi-auth-screen">
        <section class="rumofi-auth-card">
          <header class="rumofi-auth-brand">
            <div class="rumofi-auth-logo" aria-hidden="true">R</div>
            <div><p>RumoFi</p><span>Sua conta Google foi conectada com segurança.</span></div>
          </header>
          <div class="rumofi-auth-heading">
            <p class="rumofi-auth-kicker">Último passo</p>
            <h1>Complete seu perfil</h1>
            <p>Confirme seu nome e informe o telefone para identificar sua conta e permitir suporte.</p>
          </div>
          <form class="rumofi-auth-form" data-auth-form="google-profile" novalidate>
            <label>Nome completo<input name="name" type="text" autocomplete="name" value="${escapeHtml(name)}" minlength="2" maxlength="100" required></label>
            <label>E-mail Google<input type="email" value="${escapeHtml(currentUser.email || "")}" readonly></label>
            <label>Telefone com DDD<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(11) 99999-9999" maxlength="16" required></label>
            ${privacyNoticeMarkup()}
            <label class="rumofi-auth-check required"><input name="privacyAcknowledged" type="checkbox" required><span>Li o aviso acima e estou ciente dos tratamentos necessários para criar e operar minha conta.</span></label>
            <fieldset class="rumofi-auth-consents">
              <legend>Comunicações opcionais</legend>
              <label class="rumofi-auth-check"><input name="marketingEmail" type="checkbox"><span>Quero receber novidades e ofertas por e-mail.</span></label>
              <label class="rumofi-auth-check"><input name="marketingWhatsapp" type="checkbox"><span>Quero receber novidades e ofertas por WhatsApp/SMS.</span></label>
            </fieldset>
            <p class="rumofi-auth-feedback" data-auth-feedback role="alert" hidden></p>
            <button class="rumofi-auth-primary" type="submit">Salvar e entrar</button>
            <button class="rumofi-auth-link" type="button" data-auth-action="cancel-google-profile">Usar outra conta</button>
          </form>
        </section>
      </main>`;
    requestAnimationFrame(() => root.querySelector('input[name="phone"]')?.focus());
  }

  function showProfile() {
    if(!currentUser) return;
    currentView = "profile";
    const name = currentProfile?.displayName || currentUser.displayName || "";
    const phone = formatBrazilianPhone(currentProfile?.phoneNumber || "");
    const marketingEmail = Boolean(currentProfile?.marketingEmail ?? currentProfile?.consents?.marketingEmail);
    const marketingWhatsapp = Boolean(currentProfile?.marketingWhatsapp ?? currentProfile?.consents?.marketingWhatsapp);
    const hasPassword = hasAuthProvider(currentUser, "password");
    const hasGoogle = hasAuthProvider(currentUser, "google.com");
    root.hidden = false;
    setBodyLocked(true);
    root.innerHTML = `
      <div class="rumofi-account-backdrop">
        <section class="rumofi-account-sheet" role="dialog" aria-modal="true" aria-labelledby="rumofiAccountTitle">
          <header>
            <div><p class="rumofi-auth-kicker">Sua conta</p><h1 id="rumofiAccountTitle">Dados pessoais</h1></div>
            <button class="rumofi-account-close" type="button" data-auth-action="close-profile" aria-label="Fechar">×</button>
          </header>
          <form class="rumofi-auth-form" data-auth-form="profile" novalidate>
            <label>Nome completo<input name="name" type="text" autocomplete="name" value="${escapeHtml(name)}" minlength="2" maxlength="100" required></label>
            <label>E-mail<input type="email" value="${escapeHtml(currentUser.email || "")}" readonly></label>
            <label>Telefone com DDD<input name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${escapeHtml(phone)}" maxlength="16" required></label>
            <fieldset class="rumofi-auth-consents">
              <legend>Comunicações opcionais</legend>
              <label class="rumofi-auth-check"><input name="marketingEmail" type="checkbox" ${marketingEmail ? "checked" : ""}><span>Novidades e ofertas por e-mail.</span></label>
              <label class="rumofi-auth-check"><input name="marketingWhatsapp" type="checkbox" ${marketingWhatsapp ? "checked" : ""}><span>Novidades e ofertas por WhatsApp/SMS.</span></label>
            </fieldset>
            ${privacyNoticeMarkup()}
            <p class="rumofi-auth-feedback" data-auth-feedback role="alert" hidden></p>
            <button class="rumofi-auth-primary" type="submit">Salvar meus dados</button>
          </form>
          <div class="rumofi-account-actions">
            ${hasPassword ? '<button type="button" data-auth-action="send-reset">Alterar minha senha</button>' : ""}
            ${hasGoogle ? '<span class="rumofi-account-provider">Google conectado</span>' : ""}
            ${currentUser.emailVerified ? '<span class="rumofi-account-verified">E-mail verificado</span>' : '<button type="button" data-auth-action="verify-email">Verificar meu e-mail</button>'}
            <button type="button" data-auth-action="logout">Sair da conta</button>
          </div>
          <details class="rumofi-danger-zone">
            <summary>Excluir minha conta</summary>
            <p>Esta ação apaga definitivamente seu perfil e todos os dados financeiros sincronizados.</p>
            ${hasPassword
              ? '<label>Confirme sua senha<input name="deletePassword" type="password" autocomplete="current-password" minlength="6"></label>'
              : '<p class="rumofi-danger-confirmation">Você confirmará a exclusão escolhendo novamente sua conta Google.</p>'}
            <button type="button" data-auth-action="delete-account">Excluir conta e dados</button>
          </details>
        </section>
      </div>`;
  }

  function updateAccountButton() {
    if(!accountButton) return;
    if(!currentUser) {
      accountButton.hidden = true;
      return;
    }
    const name = currentProfile?.displayName || currentUser.displayName || currentUser.email || "Minha conta";
    const firstName = name.includes("@") ? "Minha conta" : name.trim().split(/\s+/)[0];
    accountButton.hidden = false;
    accountButton.innerHTML = `<span class="rumofi-account-avatar" aria-hidden="true">${escapeHtml(accountInitial(name))}</span><span><strong>${escapeHtml(firstName)}</strong><small>Minha conta</small></span>`;
  }

  async function readRemoteUserData(user) {
    const [profileSnapshot, financeSnapshot] = await withTimeout(Promise.all([
      getDoc(profileRef(user.uid)),
      getDoc(financeRef(user.uid)),
    ]));
    return {
      profile: profileSnapshot.exists() ? profileSnapshot.data() : null,
      financialData: financeSnapshot.exists() ? financeSnapshot.data()?.payload || financeSnapshot.data()?.data || null : null,
      remoteClientUpdatedAt: financeSnapshot.exists() ? financeSnapshot.data()?.clientUpdatedAt || "" : "",
    };
  }

  async function persistProfile(user, values, { isSignup = false } = {}) {
    const name = String(values.name || "").trim().replace(/\s+/g, " ");
    const phoneNumber = normalizeBrazilianPhone(values.phone || "");
    if(name.length < 2) throw new Error("invalid-name");
    if(!phoneNumber) throw new Error("invalid-phone");

    const marketingEmail = Boolean(values.marketingEmail);
    const marketingWhatsapp = Boolean(values.marketingWhatsapp);
    const profileData = {
      uid: user.uid,
      displayName: name,
      email: normalizeEmail(user.email || values.email),
      phoneNumber,
      marketingEmail,
      marketingWhatsapp,
      consents: {
        marketingEmail,
        marketingWhatsapp,
        version: RUMOFI_PRIVACY_NOTICE_VERSION,
        updatedAt: serverTimestamp(),
      },
      source: "rumofi_android",
      updatedAt: serverTimestamp(),
    };
    if(isSignup) {
      profileData.createdAt = serverTimestamp();
      profileData.privacyNoticeVersion = RUMOFI_PRIVACY_NOTICE_VERSION;
      profileData.privacyNoticeAcknowledgedAt = serverTimestamp();
    }
    await Promise.all([
      updateProfile(user, { displayName: name }),
      setDoc(profileRef(user.uid), profileData, { merge: true }),
    ]);
    currentProfile = { ...(currentProfile || {}), ...profileData, displayName:name, phoneNumber, marketingEmail, marketingWhatsapp };
    updateAccountButton();
  }

  async function writeFinancialData(snapshot, uid) {
    await setDoc(financeRef(uid), {
      schemaVersion: Number(snapshot?.schemaVersion || 2),
      payload: snapshot,
      clientUpdatedAt: String(snapshot?.updatedAt || new Date().toISOString()),
      source: "rumofi_android",
      updatedAt: serverTimestamp(),
    });
  }

  async function flushFinancialSave() {
    if(cloudWrite) return cloudWrite;
    if(!pendingPayload || !currentUser) return;
    const uid = currentUser.uid;
    cloudWrite = (async () => {
      while(pendingPayload && currentUser?.uid === uid) {
        const snapshot = pendingPayload;
        pendingPayload = null;
        setCloudStatus("syncing", "Sincronizando com sua conta…");
        try {
          await writeFinancialData(snapshot, uid);
          setCloudStatus("synced", "Dados sincronizados");
        } catch(error) {
          console.warn("Falha ao sincronizar dados do RumoFi:", error);
          if(currentUser?.uid === uid && !pendingPayload) pendingPayload = snapshot;
          setCloudStatus("pending", "Salvo no aparelho; sincronização pendente");
          break;
        }
      }
    })().finally(() => { cloudWrite = null; });
    return cloudWrite;
  }

  function queueFinancialSave(payload, { immediate = false } = {}) {
    if(!currentUser || !payload) return;
    pendingPayload = cloneJson(payload);
    clearTimeout(saveTimer);
    setCloudStatus("syncing", "Sincronizando com sua conta…");
    if(immediate) void flushFinancialSave();
    else saveTimer = setTimeout(() => void flushFinancialSave(), CLOUD_SAVE_DELAY_MS);
  }

  async function activateUser(user) {
    currentUser = user;
    showLoading("Sincronizando seus dados…");
    let remote = { profile:null, financialData:null, remoteClientUpdatedAt:"" };
    let remoteError = null;
    try {
      remote = await readRemoteUserData(user);
    } catch(error) {
      remoteError = error;
      console.warn("RumoFi iniciou com os dados locais:", error);
    }
    currentProfile = remote.profile || {
      displayName:user.displayName || "",
      email:user.email || "",
      phoneNumber:"",
    };
    if(!remoteError && hasAuthProvider(user, "google.com") && !normalizeBrazilianPhone(currentProfile.phoneNumber || "")) {
      showGoogleProfileCompletion();
      return;
    }
    // O conteúdo já pode ser calculado enquanto a tela de sincronização o cobre.
    // Assim, gráficos recebem dimensões reais antes de a tela principal aparecer.
    appShell.hidden = false;
    const result = await onUserReady?.({
      user,
      profile:currentProfile,
      remoteData:remote.financialData,
      remoteClientUpdatedAt:remote.remoteClientUpdatedAt,
      remoteError,
    });
    root.hidden = true;
    setBodyLocked(false);
    updateAccountButton();
    if(remoteError) setCloudStatus("pending", "Modo local; sincronização pendente");
    else setCloudStatus("synced", "Dados sincronizados");
    if(result?.shouldUpload && result?.financialData) queueFinancialSave(result.financialData, { immediate:true });
  }

  async function handleLogin(form) {
    const fields = new FormData(form);
    const email = normalizeEmail(fields.get("email"));
    const password = String(fields.get("password") || "");
    if(!email || password.length < 6) {
      setFeedback("Informe seu e-mail e uma senha válida.");
      return;
    }
    setBusy(true);
    setFeedback("");
    try {
      const credential = await withTimeout(signInWithEmailAndPassword(auth, email, password));
      await activateUser(credential.user);
    } catch(error) {
      setBusy(false);
      setFeedback(authErrorMessage(error));
    }
  }

  async function signInWithGoogleAccount() {
    if(isNative) {
      const nativeResult = await FirebaseAuthentication.signInWithGoogle();
      const idToken = nativeResult?.credential?.idToken;
      if(!idToken) throw new Error("google-id-token-missing");
      return signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    }
    return signInWithPopup(auth, new GoogleAuthProvider());
  }

  async function handleGoogleSignIn() {
    setBusy(true);
    setFeedback("");
    try {
      const credential = await signInWithGoogleAccount();
      await activateUser(credential.user);
    } catch(error) {
      if(isNative) FirebaseAuthentication.signOut().catch(() => {});
      setBusy(false);
      setFeedback(authErrorMessage(error));
    }
  }

  async function handleSignup(form) {
    const fields = new FormData(form);
    const name = String(fields.get("name") || "").trim();
    const email = normalizeEmail(fields.get("email"));
    const phone = String(fields.get("phone") || "");
    const password = String(fields.get("password") || "");
    if(name.length < 2) { setFeedback("Informe seu nome completo."); return; }
    if(!email.includes("@")) { setFeedback("Informe um e-mail válido."); return; }
    if(!normalizeBrazilianPhone(phone)) { setFeedback("Informe um telefone válido com DDD."); return; }
    if(password.length < 6) { setFeedback("Crie uma senha com pelo menos 6 caracteres."); return; }
    if(!fields.get("privacyAcknowledged")) { setFeedback("Leia o aviso e confirme para criar sua conta."); return; }

    setBusy(true);
    setFeedback("");
    try {
      const credential = await withTimeout(createUserWithEmailAndPassword(auth, email, password));
      await persistProfile(credential.user, {
        name,
        email,
        phone,
        marketingEmail:fields.get("marketingEmail") === "on",
        marketingWhatsapp:fields.get("marketingWhatsapp") === "on",
      }, { isSignup:true });
      sendEmailVerification(credential.user).catch(() => {});
      await activateUser(credential.user);
    } catch(error) {
      setBusy(false);
      setFeedback(authErrorMessage(error));
    }
  }

  async function handleProfileSave(form) {
    const fields = new FormData(form);
    setBusy(true);
    setFeedback("");
    try {
      await persistProfile(currentUser, {
        name:fields.get("name"),
        phone:fields.get("phone"),
        marketingEmail:fields.get("marketingEmail") === "on",
        marketingWhatsapp:fields.get("marketingWhatsapp") === "on",
      });
      setBusy(false);
      setFeedback("Dados atualizados.", "success");
    } catch(error) {
      setBusy(false);
      const message = String(error?.message).includes("invalid-phone")
        ? "Informe um telefone válido com DDD."
        : String(error?.message).includes("invalid-name")
          ? "Informe seu nome completo."
          : authErrorMessage(error);
      setFeedback(message);
    }
  }

  async function handleGoogleProfileSave(form) {
    const fields = new FormData(form);
    if(!fields.get("privacyAcknowledged")) {
      setFeedback("Leia o aviso e confirme para concluir seu cadastro.");
      return;
    }
    setBusy(true);
    setFeedback("");
    try {
      await persistProfile(currentUser, {
        name:fields.get("name"),
        phone:fields.get("phone"),
        marketingEmail:fields.get("marketingEmail") === "on",
        marketingWhatsapp:fields.get("marketingWhatsapp") === "on",
      }, { isSignup:true });
      await activateUser(currentUser);
    } catch(error) {
      setBusy(false);
      const message = String(error?.message).includes("invalid-phone")
        ? "Informe um telefone válido com DDD."
        : String(error?.message).includes("invalid-name")
          ? "Informe seu nome completo."
          : authErrorMessage(error);
      setFeedback(message);
    }
  }

  async function requestPasswordReset(email) {
    if(!email) { setFeedback("Informe seu e-mail primeiro."); return; }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, normalizeEmail(email));
      setBusy(false);
      setFeedback("Enviamos as instruções de senha para o e-mail informado.", "success");
    } catch(error) {
      setBusy(false);
      setFeedback(authErrorMessage(error));
    }
  }

  async function handleLogout() {
    setBusy(true);
    clearTimeout(saveTimer);
    await Promise.race([flushFinancialSave(), new Promise(resolve => setTimeout(resolve, 3500))]).catch(() => {});
    if(isNative) await FirebaseAuthentication.signOut().catch(() => {});
    await signOut(auth).catch(() => {});
    currentUser = null;
    currentProfile = null;
    pendingPayload = null;
    accountButton && (accountButton.hidden = true);
    onSignedOut?.();
    showLogin();
  }

  async function handleDeleteAccount() {
    if(!currentUser?.email) return;
    const hasPassword = hasAuthProvider(currentUser, "password");
    const hasGoogle = hasAuthProvider(currentUser, "google.com");
    const password = String(root.querySelector('input[name="deletePassword"]')?.value || "");
    if(hasPassword && password.length < 6) {
      setFeedback("Digite sua senha atual para confirmar a exclusão.");
      root.querySelector('input[name="deletePassword"]')?.focus();
      return;
    }
    const confirmed = window.confirm("Excluir definitivamente sua conta e todos os dados financeiros? Esta ação não pode ser desfeita.");
    if(!confirmed) return;
    setBusy(true);
    const deletedUser = currentUser;
    try {
      if(hasPassword) {
        await reauthenticateWithCredential(currentUser, EmailAuthProvider.credential(currentUser.email, password));
      } else if(hasGoogle) {
        if(isNative) {
          const nativeResult = await FirebaseAuthentication.signInWithGoogle();
          const idToken = nativeResult?.credential?.idToken;
          if(!idToken) throw new Error("google-id-token-missing");
          await reauthenticateWithCredential(currentUser, GoogleAuthProvider.credential(idToken));
        } else {
          await reauthenticateWithPopup(currentUser, new GoogleAuthProvider());
        }
      }
      clearTimeout(saveTimer);
      pendingPayload = null;
      await Promise.all([
        deleteDoc(financeRef(currentUser.uid)),
        deleteDoc(profileRef(currentUser.uid)),
      ]);
      await deleteUser(currentUser);
      if(isNative) await FirebaseAuthentication.signOut().catch(() => {});
      currentUser = null;
      currentProfile = null;
      onAccountDeleted?.(deletedUser);
      showLogin();
    } catch(error) {
      setBusy(false);
      setFeedback(authErrorMessage(error));
    }
  }

  root.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-auth-form]");
    if(!form) return;
    event.preventDefault();
    if(form.dataset.authForm === "login") void handleLogin(form);
    if(form.dataset.authForm === "signup") void handleSignup(form);
    if(form.dataset.authForm === "profile") void handleProfileSave(form);
    if(form.dataset.authForm === "google-profile") void handleGoogleProfileSave(form);
  });

  root.addEventListener("input", (event) => {
    if(event.target?.name === "phone") event.target.value = formatBrazilianPhone(event.target.value);
  });

  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-auth-action]");
    if(!button) return;
    const action = button.dataset.authAction;
    if(action === "show-signup") showSignup(root.querySelector('input[name="email"]')?.value || "");
    if(action === "show-login") showLogin(root.querySelector('input[name="email"]')?.value || "");
    if(action === "forgot-password") void requestPasswordReset(root.querySelector('input[name="email"]')?.value || "");
    if(action === "google-signin") void handleGoogleSignIn();
    if(action === "cancel-google-profile") void handleLogout();
    if(action === "close-profile") { root.hidden = true; setBodyLocked(false); }
    if(action === "logout") void handleLogout();
    if(action === "send-reset") void requestPasswordReset(currentUser?.email || "");
    if(action === "verify-email" && currentUser) {
      setBusy(true);
      sendEmailVerification(currentUser)
        .then(() => { setBusy(false); setFeedback("E-mail de verificação enviado.", "success"); })
        .catch((error) => { setBusy(false); setFeedback(authErrorMessage(error)); });
    }
    if(action === "delete-account") void handleDeleteAccount();
  });

  accountButton?.addEventListener("click", showProfile);
  window.addEventListener("online", () => {
    if(pendingPayload) void flushFinancialSave();
  });

  showLoading();
  if(!isNative) {
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch(error) {
      console.warn("Persistência de login indisponível:", error);
    }
  }

  const initialUser = await new Promise((resolve) => {
    let unsubscribe = () => {};
    unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    }, () => resolve(null));
  });
  if(initialUser) await activateUser(initialUser);
  else {
    onSignedOut?.();
    showLogin();
  }

  return {
    get currentUser() { return currentUser; },
    get currentProfile() { return currentProfile; },
    queueFinancialSave,
    flushFinancialSave,
    openAccount:showProfile,
  };
}
