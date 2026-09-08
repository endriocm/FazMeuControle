import { Capacitor } from "@capacitor/core";

const env = typeof import.meta.env === "object" && import.meta.env ? import.meta.env : {};

export const RUMOFI_SUBSCRIPTION_CONFIG = Object.freeze({
  productId: String(env.VITE_RUMOFI_SUBSCRIPTION_PRODUCT_ID || "rumofi_premium"),
  basePlanId: String(env.VITE_RUMOFI_SUBSCRIPTION_BASE_PLAN_ID || "monthly"),
  verificationEndpoint: String(env.VITE_RUMOFI_BILLING_ENDPOINT || "").trim(),
});

let nativePurchasesPromise = null;

async function getNativePurchases() {
  if(!Capacitor.isNativePlatform()) return null;
  nativePurchasesPromise ||= import("@capgo/native-purchases");
  return nativePurchasesPromise;
}

async function buildObfuscatedAccountId(uid) {
  const value = String(uid || "");
  if(!value) return "";
  if(globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(value);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 64);
  }
  return value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 64);
}

function setText(node, message) {
  if(node) node.textContent = message;
}

export function createRumoFiSubscriptionController({ modal, getUser, notify } = {}) {
  const refs = {
    status: modal?.querySelector("[data-subscription-status]"),
    product: modal?.querySelector("[data-subscription-product]"),
    buy: modal?.querySelector("[data-subscription-buy]"),
    restore: modal?.querySelector("[data-subscription-restore]"),
    manage: modal?.querySelector("[data-subscription-manage]"),
  };
  let currentUser = null;
  let currentProduct = null;
  let busy = false;

  function setStatus(message, type = "") {
    setText(refs.status, message);
    if(refs.status) refs.status.dataset.type = type;
  }

  function setBusy(next) {
    busy = Boolean(next);
    [refs.buy, refs.restore, refs.manage].forEach(button => {
      if(button) button.disabled = busy;
    });
  }

  function close() {
    if(modal) modal.hidden = true;
  }

  function open() {
    if(!modal) return;
    modal.hidden = false;
    void refresh();
  }

  function renderProduct(product) {
    currentProduct = product || null;
    if(!product) {
      setText(refs.product, "Plano mensal RumoFi");
      return;
    }
    const price = product.priceString || "Preço exibido pela Google Play";
    setText(refs.product, `${product.title || "Plano mensal RumoFi"} · ${price}`);
  }

  async function verifyTransaction(transaction) {
    const endpoint = RUMOFI_SUBSCRIPTION_CONFIG.verificationEndpoint;
    if(!endpoint) throw new Error("A validação segura da assinatura ainda não foi configurada.");
    const user = currentUser || getUser?.();
    if(!user?.getIdToken || !transaction?.purchaseToken) throw new Error("Não foi possível identificar a compra e a conta RumoFi.");
    const idToken = await user.getIdToken();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        productId: transaction.productIdentifier || RUMOFI_SUBSCRIPTION_CONFIG.productId,
        purchaseToken: transaction.purchaseToken,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if(!response.ok || payload.active !== true) {
      throw new Error(payload.message || "A compra ainda não foi confirmada pela Google Play.");
    }
    return payload;
  }

  async function refresh() {
    if(!modal || busy) return;
    const user = currentUser || getUser?.();
    if(!user) {
      setStatus("Entre na sua conta RumoFi para consultar a assinatura.");
      return;
    }
    if(!Capacitor.isNativePlatform()) {
      setStatus("A assinatura é concluída dentro do aplicativo Android pela Google Play.");
      renderProduct(null);
      return;
    }
    if(!RUMOFI_SUBSCRIPTION_CONFIG.verificationEndpoint) {
      setStatus("Assinatura preparada. Falta configurar a validação segura no servidor antes de vender.", "pending");
      renderProduct(null);
      return;
    }
    setBusy(true);
    try {
      const plugin = await getNativePurchases();
      const support = await plugin.NativePurchases.isBillingSupported();
      if(!support.isBillingSupported) throw new Error("A Google Play não está disponível neste dispositivo.");
      const { products } = await plugin.NativePurchases.getProducts({
        productIdentifiers: [RUMOFI_SUBSCRIPTION_CONFIG.productId],
        productType: plugin.PURCHASE_TYPE.SUBS,
      });
      const product = products?.find(item => item.planIdentifier === RUMOFI_SUBSCRIPTION_CONFIG.productId
        || item.identifier === RUMOFI_SUBSCRIPTION_CONFIG.basePlanId
        || item.planIdentifier === RUMOFI_SUBSCRIPTION_CONFIG.basePlanId) || products?.[0];
      renderProduct(product);
      const purchases = await plugin.NativePurchases.getPurchases({ productType: plugin.PURCHASE_TYPE.SUBS });
      const current = (purchases.purchases || []).find(item => item.productIdentifier === RUMOFI_SUBSCRIPTION_CONFIG.productId);
      if(current?.purchaseToken) {
        const entitlement = await verifyTransaction(current);
        setStatus(`Assinatura ativa até ${new Date(entitlement.expiresAt).toLocaleDateString("pt-BR")}.`, "success");
      } else {
        setStatus(product ? "Plano disponível para assinatura." : "Crie o produto da assinatura na Google Play Console.");
      }
    } catch(error) {
      console.warn("Não foi possível consultar a assinatura RumoFi:", error);
      setStatus(error?.message || "Não foi possível consultar a assinatura.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function purchase() {
    if(busy) return;
    if(!RUMOFI_SUBSCRIPTION_CONFIG.verificationEndpoint) {
      setStatus("A validação segura ainda precisa ser configurada no servidor.", "pending");
      return;
    }
    const user = currentUser || getUser?.();
    if(!user) {
      setStatus("Entre na sua conta RumoFi antes de assinar.", "error");
      return;
    }
    setBusy(true);
    try {
      const plugin = await getNativePurchases();
      if(!plugin) throw new Error("A assinatura está disponível no aplicativo Android.");
      const accountId = await buildObfuscatedAccountId(user.uid);
      const transaction = await plugin.NativePurchases.purchaseProduct({
        productIdentifier: RUMOFI_SUBSCRIPTION_CONFIG.productId,
        planIdentifier: RUMOFI_SUBSCRIPTION_CONFIG.basePlanId,
        offerToken: currentProduct?.offerToken,
        productType: plugin.PURCHASE_TYPE.SUBS,
        appAccountToken: accountId,
        autoAcknowledgePurchases: false,
      });
      const entitlement = await verifyTransaction(transaction);
      if(transaction.purchaseToken) await plugin.NativePurchases.acknowledgePurchase({ purchaseToken:transaction.purchaseToken });
      setStatus(`Assinatura ativa até ${new Date(entitlement.expiresAt).toLocaleDateString("pt-BR")}.`, "success");
      notify?.("Assinatura RumoFi ativada.");
    } catch(error) {
      console.warn("Falha ao assinar o RumoFi:", error);
      setStatus(error?.message || "Não foi possível concluir a assinatura.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if(busy) return;
    if(!RUMOFI_SUBSCRIPTION_CONFIG.verificationEndpoint) {
      setStatus("A validação segura ainda precisa ser configurada no servidor.", "pending");
      return;
    }
    setBusy(true);
    try {
      const plugin = await getNativePurchases();
      if(!plugin) throw new Error("A restauração está disponível no aplicativo Android.");
      await plugin.NativePurchases.restorePurchases();
      setBusy(false);
      await refresh();
    } catch(error) {
      setStatus(error?.message || "Não foi possível restaurar a assinatura.", "error");
      setBusy(false);
    }
  }

  async function manage() {
    try {
      const plugin = await getNativePurchases();
      if(!plugin) throw new Error("O gerenciamento está disponível no aplicativo Android.");
      await plugin.NativePurchases.manageSubscriptions();
    } catch(error) {
      notify?.(error?.message || "Não foi possível abrir o gerenciamento da Google Play.");
    }
  }

  refs.buy?.addEventListener("click", () => void purchase());
  refs.restore?.addEventListener("click", () => void restore());
  refs.manage?.addEventListener("click", () => void manage());
  modal?.querySelectorAll("[data-subscription-close]").forEach(button => button.addEventListener("click", close));

  return {
    close,
    open,
    refresh,
    setUser(nextUser) {
      currentUser = nextUser || null;
      if(currentUser && !modal?.hidden) void refresh();
    },
  };
}
