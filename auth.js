import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence, browserSessionPersistence, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, updateProfile, signOut } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const gate = document.getElementById('authGate');
const card = document.getElementById('authCard');
const accountButton = document.getElementById('accountBtn');
const accountMenu = document.getElementById('accountMenu');
const accountMenuName = document.getElementById('accountMenuName');
const accountMenuEmail = document.getElementById('accountMenuEmail');
const state = { config: null, user: null, access: null, mode: 'login', panel: 'auth', appReady: false, accountMenuOpen: false, syncTimer: null, pendingData: null };
let auth = null;
let db = null;

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const firstName = (user) => (user?.displayName || user?.email || 'Minha conta').split(/[\s@]/)[0];

function notify(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._authTimer);
  toast._authTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function hideGate() { gate.classList.add('is-hidden'); }
function showGate() { gate.classList.remove('is-hidden'); }

function setAccountButton() {
  if (!accountButton) return;
  if (state.user) {
    accountButton.textContent = `👤 ${firstName(state.user)}`;
    accountButton.title = 'Abrir minha conta';
  } else {
    accountButton.textContent = 'Entrar';
    accountButton.title = 'Entrar ou criar conta';
  }
}

function note(message, type = '') { return `<div class="auth-note ${type}">${message}</div>`; }

function renderAccountMenu() {
  if (!accountMenu) return;
  const canOpen = Boolean(state.user && state.access?.active && state.accountMenuOpen);
  accountMenu.classList.toggle('hidden', !canOpen);
  if (!canOpen) return;
  if (accountMenuName) accountMenuName.textContent = firstName(state.user);
  if (accountMenuEmail) accountMenuEmail.textContent = state.user.email || '';
}

function render() {
  setAccountButton();
  renderAccountMenu();
  if (!state.appReady) {
    showGate();
    card.className = 'auth-card';
    card.innerHTML = `<div class="auth-logo">CF</div><p class="auth-kicker">CONTROLE FINANCEIRO</p><h2><span class="auth-loader"></span>Carregando acesso seguro</h2><p>Verificando a configuração do serviço.</p>`;
    return;
  }
  if (!state.config?.configured) {
    showGate();
    card.className = 'auth-card';
    card.innerHTML = `<div class="auth-logo">CF</div><p class="auth-kicker">CONFIGURAÇÃO NECESSÁRIA</p><h2>O acesso ainda não foi ativado.</h2><p>O administrador precisa configurar o Firebase e o Mercado Pago na Vercel.</p>${note(`Variáveis pendentes: <strong>${escapeHtml((state.config?.missing || []).join(', '))}</strong>.`, 'error')}`;
    return;
  }
  if (!state.user) {
    showGate();
    renderMesaAuth();
    return;
  }
  if (state.access?.active && state.panel !== 'account') {
    hideGate();
    return;
  }
  showGate();
  if (state.access?.active) renderAccount();
  else renderSubscription();
}

function renderAuth(error = '') {
  const signup = state.mode === 'signup';
  card.className = 'auth-card';
  card.innerHTML = `
    <div class="auth-logo">CF</div>
    <p class="auth-kicker">ACESSO À SUA ÁREA</p>
    <h2>${signup ? 'Crie sua conta' : 'Entre na sua conta'}</h2>
    <p>Seus dados financeiros ficam vinculados ao seu usuário.</p>
    <div class="auth-tabs">
      <button class="auth-tab ${!signup ? 'active' : ''}" data-auth-action="mode-login">Entrar</button>
      <button class="auth-tab ${signup ? 'active' : ''}" data-auth-action="mode-signup">Criar conta</button>
    </div>
    <form class="auth-form" id="authForm" data-mode="${signup ? 'signup' : 'login'}">
      ${signup ? '<div class="auth-field"><label for="authName">Nome</label><input id="authName" name="name" autocomplete="name" required placeholder="Como quer ser chamado?"></div>' : ''}
      <div class="auth-field"><label for="authEmail">E-mail</label><input id="authEmail" name="email" type="email" autocomplete="email" required placeholder="voce@exemplo.com"></div>
      <div class="auth-field"><label for="authPassword">Senha</label><input id="authPassword" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required placeholder="Mínimo de 6 caracteres"></div>
      <button class="auth-button" type="submit">${signup ? 'Criar conta e continuar' : 'Entrar'}</button>
    </form>
    <div class="auth-divider">ou</div>
    <button class="auth-button outline" data-auth-action="google">Continuar com Google</button>
    ${error ? note(escapeHtml(error), 'error') : ''}
    ${note('Ao continuar, você concorda em usar o serviço com uma conta individual. O acesso completo é liberado por pagamento aprovado ou código de acesso.')}
  `;
}

function mesaBrand() {
  return `<div class="auth-brand"><div class="auth-brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17 9 11l4 4 8-9"/><path d="M16 6h5v5"/></svg></div><div class="auth-brand-copy"><h1>Faz Meu Controle</h1><p>Seu ambiente financeiro pessoal</p></div></div>`;
}

function mesaStats() {
  return `<div class="auth-mini-panel" aria-label="Recursos da plataforma"><div class="auth-mini-stat"><span>Dados</span><strong>Privados</strong><small>por usuário</small></div><div class="auth-mini-stat"><span>Acesso</span><strong>Seguro</strong><small>Firebase</small></div><div class="auth-mini-stat"><span>Backup</span><strong>Ativo</strong><small>na nuvem</small></div></div>`;
}

function googleMark() {
  return `<span class="auth-google-mark" aria-hidden="true"><svg viewBox="0 0 18 18" focusable="false"><path fill="#4285F4" d="M17.64 9.2045c0-.638-.0573-1.2518-.1636-1.8409H9v3.4818h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2582h2.9082c1.7027-1.5673 2.6836-3.8745 2.6836-6.6155z"/><path fill="#34A853" d="M9 18c2.43 0 4.4673-.8055 5.9564-2.1791l-2.9082-2.2582c-.8055.54-1.8368.8591-3.0482.8591-2.3441 0-4.3282-1.5832-5.0364-3.7091H.9573v2.3327C2.4382 16.0909 5.4818 18 9 18z"/><path fill="#FBBC05" d="M3.9636 10.7127c-.18-.54-.2823-1.1168-.2823-1.7127s.1023-1.1727.2823-1.7127V4.9545H.9573C.3477 6.1691 0 7.5482 0 9s.3477 2.8309.9573 4.0455l3.0063-2.3328z"/><path fill="#EA4335" d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.3459l2.5809-2.5809C13.4636.8918 11.4264 0 9 0 5.4818 0 2.4382 2.0909.9573 4.9545l3.0063 2.3328C4.6718 5.1627 6.6559 3.5795 9 3.5795z"/></svg></span>`;
}

function renderMesaAuth(error = '') {
  const signup = state.mode === 'signup';
  card.className = 'auth-card';
  card.innerHTML = `
    ${mesaBrand()}
    <div><p class="auth-kicker">${signup ? 'NOVO ACESSO' : 'ÁREA DO CLIENTE'}</p><h2>${signup ? 'Crie sua conta' : 'Acesso ao controle financeiro'}</h2><p class="auth-intro">${signup ? 'Cadastre-se para proteger e organizar seus próprios dados.' : 'Entre para abrir seu ambiente financeiro pessoal.'}</p></div>
    ${mesaStats()}
    <form class="auth-form" id="authForm" data-mode="${signup ? 'signup' : 'login'}">
      ${signup ? '<div class="auth-field auth-field--icon"><label for="authName">Nome</label><input id="authName" name="name" autocomplete="name" required placeholder="Como quer ser chamado?"><span class="auth-field-icon" aria-hidden="true">◉</span></div>' : ''}
      <div class="auth-field auth-field--icon"><label for="authEmail">E-mail</label><input id="authEmail" name="email" type="email" autocomplete="email" required placeholder="seuemail@exemplo.com"><span class="auth-field-icon" aria-hidden="true">✉</span></div>
      <div class="auth-field auth-field--icon"><label for="authPassword">Senha</label><input id="authPassword" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required placeholder="${signup ? 'Mínimo de 6 caracteres' : 'Sua senha'}"><span class="auth-field-icon" aria-hidden="true">◈</span></div>
      <label class="auth-remember"><input id="authRemember" name="remember" type="checkbox" checked><span>Manter meu acesso neste dispositivo</span></label>
      <button class="auth-button" type="submit">${signup ? 'Criar conta' : 'Entrar'}</button>
    </form>
    <button class="auth-button outline" data-auth-action="${signup ? 'mode-login' : 'mode-signup'}">${signup ? 'Já tenho uma conta' : 'Criar conta'}</button>
    <div class="auth-divider">ou</div>
    <button class="auth-button outline" data-auth-action="google">${googleMark()} Entrar com Google</button>
    ${error ? note(escapeHtml(error), 'error') : ''}
    <p class="auth-kicker" style="color:rgba(220,244,255,.52)">AMBIENTE SEGURO · DADOS INDIVIDUAIS</p>
  `;
}

function renderSubscription(message = '') {
  const price = state.config?.plan?.formatted || 'R$ 19,90';
  card.className = 'auth-card has-close';
  card.innerHTML = `
    <button class="auth-close" data-auth-action="logout" title="Sair">×</button>
    <div class="auth-logo">CF</div>
    <p class="auth-kicker">OLÁ, ${escapeHtml(firstName(state.user)).toUpperCase()}</p>
    <h2>Libere seu controle financeiro.</h2>
    <p>Seu cadastro está pronto. Escolha a assinatura mensal pelo Mercado Pago ou use um código de acesso válido.</p>
    <div class="access-summary">
      <div class="access-row"><strong>Conta</strong><span>${escapeHtml(state.user.email || '')}</span></div>
      <div class="access-row"><strong>Status</strong><span>Assinatura ou código necessário</span></div>
    </div>
    <div class="auth-actions">
      <button class="auth-button gold" data-auth-action="checkout">Assinar mensalmente — ${escapeHtml(price)}</button>
      <button class="auth-button outline" data-auth-action="show-code">Tenho um código de acesso</button>
    </div>
    <form class="auth-form" id="redeemForm" hidden>
      <div class="auth-field"><label for="accessCode">Código de acesso</label><input id="accessCode" name="code" autocomplete="one-time-code" required placeholder="Ex.: CF-ABCD-EFGH"></div>
      <button class="auth-button" type="submit">Validar código</button>
    </form>
    ${message ? note(escapeHtml(message), message.startsWith('Acesso liberado') ? 'success' : 'error') : ''}
    ${note('A assinatura é processada pelo Mercado Pago. A liberação é automática após a confirmação.')}
  `;
}

function renderAccount(message = '') {
  const source = state.access?.source === 'access_code'
    ? 'Código de acesso'
    : state.access?.source === 'free_email'
      ? 'E-mail liberado'
    : state.access?.source === 'firebase'
      ? 'Login Firebase'
      : 'Mercado Pago';
  const expires = state.access?.expiresAt ? new Date(state.access.expiresAt).toLocaleDateString('pt-BR') : 'Sem vencimento definido';
  card.className = 'auth-card has-close';
  card.innerHTML = `
    <button class="auth-close" data-auth-action="close-account" title="Fechar">×</button>
    <div class="auth-logo">CF</div>
    <p class="auth-kicker">MINHA CONTA</p>
    <h2>Olá, ${escapeHtml(firstName(state.user))}</h2>
    <p>Seu acesso está ativo e seus lançamentos são sincronizados com sua conta.</p>
    <div class="access-summary">
      <div class="access-row"><strong>Status</strong><span class="access-badge">Acesso ativo</span></div>
      <div class="access-row"><strong>Origem</strong><span>${escapeHtml(source)}</span></div>
      <div class="access-row"><strong>Validade</strong><span>${escapeHtml(expires)}</span></div>
    </div>
    ${state.access?.isAdmin ? `<div class="auth-code"><h3>Gerar código de acesso</h3><p>Crie um código para liberar o serviço a outro usuário. Esta ação é restrita a administradores.</p><form class="auth-form" id="generateCodeForm"><div class="auth-field"><label for="codeDays">Validade em dias</label><input id="codeDays" name="days" type="number" min="1" max="3650" value="30" required></div><button class="auth-button outline" type="submit">Gerar código</button></form>${state.generatedCode ? `<div class="auth-code-output">${escapeHtml(state.generatedCode)}</div>` : ''}</div>` : ''}
    ${message ? note(escapeHtml(message), 'success') : ''}
    <div class="auth-actions"><button class="auth-button outline" data-auth-action="logout">Sair da conta</button></div>
  `;
}

async function request(path, options = {}) {
  if (!state.user) throw new Error('Faça login para continuar.');
  const token = await state.user.getIdToken();
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível concluir a solicitação.');
  return payload;
}

async function refreshAccess() {
  if (!state.user) return;
  try {
    state.access = await request('/api/access-status');
    if (state.access.active) {
      window.financeSetStorageScope?.(state.user.uid);
      await restoreCloudData();
    }
  } catch (error) {
    state.access = { active: false, error: error.message };
  }
  render();
}

async function restoreCloudData() {
  if (!db || !state.user) return;
  try {
    const snapshot = await getDoc(doc(db, 'financialData', state.user.uid));
    const payload = snapshot.data()?.payload;
    if (payload) window.financeReplaceData?.(payload);
  } catch (error) {
    console.warn('Não foi possível restaurar os dados financeiros:', error);
    notify('Não foi possível carregar a cópia sincronizada.');
  }
}

function syncData(payload) {
  if (!state.user || !state.access?.active || !db || !payload) return;
  state.pendingData = payload;
  clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(async () => {
    try {
      await setDoc(doc(db, 'financialData', state.user.uid), { payload: state.pendingData, updatedAt: serverTimestamp() }, { merge: true });
    } catch (error) {
      console.warn('Falha ao sincronizar dados:', error);
      notify('Os dados ficaram salvos neste navegador; a sincronização será tentada novamente.');
    }
  }, 800);
}

async function signInGoogle() {
  try {
    const remember = document.getElementById('authRemember')?.checked !== false;
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    const messages = {
      'auth/operation-not-allowed': 'O login com Google ainda não está ativado no Firebase.',
      'auth/unauthorized-domain': 'Este domínio ainda não está autorizado no Firebase Authentication.',
      'auth/popup-blocked': 'A janela do Google foi bloqueada. Permita pop-ups e tente novamente.',
      'auth/popup-closed-by-user': 'A janela do Google foi fechada antes de concluir o login.',
      'auth/cancelled-popup-request': 'Já existe uma tentativa de login com Google em andamento.',
      'auth/network-request-failed': 'Falha de conexão. Verifique a internet e tente novamente.'
    };
    renderMesaAuth(messages[error.code] || 'Não foi possível entrar com Google.');
  }
}

async function handleAuthForm(form) {
  const values = new FormData(form);
  const email = String(values.get('email') || '').trim();
  const password = String(values.get('password') || '');
  try {
    const remember = values.get('remember') === 'on';
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    if (form.dataset.mode === 'signup') {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      const name = String(values.get('name') || '').trim();
      if (name) await updateProfile(credential.user, { displayName: name });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    const messages = {
      'auth/email-already-in-use': 'Este e-mail já possui uma conta. Use Entrar ou escolha outro e-mail.',
      'auth/invalid-credential': 'E-mail ou senha inválidos.',
      'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
      'auth/invalid-email': 'Informe um e-mail válido.',
      'auth/operation-not-allowed': 'O login por e-mail e senha ainda não está ativado no Firebase.',
      'auth/user-disabled': 'Esta conta foi desativada no Firebase.',
      'auth/too-many-requests': 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.',
      'auth/network-request-failed': 'Falha de conexão. Verifique a internet e tente novamente.'
    };
    renderMesaAuth(messages[error.code] || 'Não foi possível autenticar. Tente novamente.');
  }
}

async function beginCheckout() {
  try {
    const payload = await request('/api/create-checkout', { method: 'POST', body: '{}' });
    if (!payload.checkoutUrl) throw new Error('O link de pagamento não foi criado.');
    window.location.assign(payload.checkoutUrl);
  } catch (error) {
    renderSubscription(error.message);
  }
}

async function redeemCode(form) {
  try {
    const code = String(new FormData(form).get('code') || '').trim();
    const result = await request('/api/redeem-access-code', { method: 'POST', body: JSON.stringify({ code }) });
    state.access = result.access;
    window.financeSetStorageScope?.(state.user.uid);
    await restoreCloudData();
    renderSubscription('Acesso liberado. Abrindo seu controle financeiro...');
    setTimeout(render, 850);
  } catch (error) {
    renderSubscription(error.message);
    document.getElementById('redeemForm')?.removeAttribute('hidden');
  }
}

async function generateCode(form) {
  try {
    const days = Number(new FormData(form).get('days') || 30);
    const result = await request('/api/create-access-code', { method: 'POST', body: JSON.stringify({ days }) });
    state.generatedCode = result.code;
    renderAccount('Código gerado. Guarde-o antes de fechar esta tela.');
  } catch (error) {
    renderAccount(error.message);
  }
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-auth-action]');
  if (button) {
    const action = button.dataset.authAction;
    if (action === 'mode-login') { state.mode = 'login'; renderMesaAuth(); }
    if (action === 'mode-signup') { state.mode = 'signup'; renderMesaAuth(); }
    if (action === 'google') await signInGoogle();
    if (action === 'checkout') await beginCheckout();
    if (action === 'show-code') document.getElementById('redeemForm')?.removeAttribute('hidden');
    if (action === 'open-account') { state.accountMenuOpen = false; state.panel = 'account'; render(); }
    if (action === 'logout') { state.accountMenuOpen = false; await signOut(auth); state.panel = 'auth'; state.generatedCode = ''; }
    if (action === 'close-account') { state.panel = 'app'; render(); }
    return;
  }
  if (state.accountMenuOpen && !event.target.closest('#accountMenuWrap')) {
    state.accountMenuOpen = false;
    renderAccountMenu();
  }
});

document.addEventListener('submit', async (event) => {
  if (event.target.id === 'authForm') { event.preventDefault(); await handleAuthForm(event.target); }
  if (event.target.id === 'redeemForm') { event.preventDefault(); await redeemCode(event.target); }
  if (event.target.id === 'generateCodeForm') { event.preventDefault(); await generateCode(event.target); }
});

accountButton?.addEventListener('click', () => {
  if (!state.user || !state.access?.active) {
    state.panel = 'auth';
    render();
    return;
  }
  state.accountMenuOpen = !state.accountMenuOpen;
  renderAccountMenu();
});

async function boot() {
  try {
    const response = await fetch('/api/app-config');
    state.config = await response.json();
    state.appReady = true;
    if (!state.config.configured) { render(); return; }
    const app = initializeApp(state.config.firebase);
    auth = getAuth(app);
    db = getFirestore(app);
    await setPersistence(auth, browserLocalPersistence);
    window.financeAuth = { syncData };
    onAuthStateChanged(auth, async (user) => {
      state.user = user;
      state.access = null;
      state.generatedCode = '';
      if (!user) {
        window.financeSetStorageScope?.('');
        state.accountMenuOpen = false;
        render();
        return;
      }
      try {
        await setDoc(doc(db, 'profiles', user.uid), { email: user.email || '', displayName: user.displayName || '', updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
      } catch (error) {
        console.warn('Não foi possível atualizar o perfil do usuário:', error);
        notify('Login feito, mas o perfil não foi sincronizado no Firestore.');
      }
      const params = new URLSearchParams(window.location.search);
      const paymentId = params.get('payment_id');
      const preapprovalId = params.get('preapproval_id');
      if (state.config?.billing?.enabled && (paymentId || preapprovalId)) {
        try {
          await request('/api/confirm-payment', { method: 'POST', body: JSON.stringify({ paymentId, preapprovalId }) });
          window.history.replaceState({}, document.title, window.location.pathname);
          notify('Assinatura confirmada. Seu acesso foi liberado.');
        } catch (error) {
          console.warn('Assinatura ainda não confirmada:', error);
        }
      }
      await refreshAccess();
    });
    render();
  } catch (error) {
    state.config = { configured: false, missing: ['configuração do Firebase'] };
    state.appReady = true;
    console.error('Falha ao iniciar autenticação:', error);
    render();
  }
}

boot();
