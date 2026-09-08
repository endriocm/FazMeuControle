import crypto from "node:crypto";

import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { google } from "googleapis";

if(!getApps().length) initializeApp();

const db = getFirestore(getApp());
const PACKAGE_NAME = process.env.RUMOFI_PLAY_PACKAGE_NAME || "app.fazmeucontrole.mobile";
const PRODUCT_ID = process.env.RUMOFI_PLAY_PRODUCT_ID || "rumofi_premium";
const BASE_PLAN_ID = process.env.RUMOFI_PLAY_BASE_PLAN_ID || "monthly";
const ACTIVE_STATES = new Set([
  "SUBSCRIPTION_STATE_ACTIVE",
  "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
  "SUBSCRIPTION_STATE_CANCELED",
]);

let publisherPromise = null;

async function getPublisher() {
  publisherPromise ||= (async () => {
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    });
    const client = await auth.getClient();
    return google.androidpublisher({ version: "v3", auth: client });
  })();
  return publisherPromise;
}

function hashPurchaseToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function jsonError(res, status, message) {
  res.status(status).json({ active:false, message });
}

function parseBearerToken(req) {
  const header = String(req.get("authorization") || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function verifyFirebaseUser(req) {
  const token = parseBearerToken(req);
  if(!token) throw Object.assign(new Error("Autenticação RumoFi necessária."), { status:401 });
  return getAuth().verifyIdToken(token);
}

function normalizePurchaseInput(body) {
  const purchaseToken = String(body?.purchaseToken || "").trim();
  const productId = String(body?.productId || PRODUCT_ID).trim();
  if(!purchaseToken || purchaseToken.length > 4096) throw Object.assign(new Error("Token de compra inválido."), { status:400 });
  if(productId !== PRODUCT_ID) throw Object.assign(new Error("Produto de assinatura não reconhecido."), { status:400 });
  return { purchaseToken, productId };
}

async function validateAndStoreSubscription({ uid, purchaseToken, productId = PRODUCT_ID }) {
  const publisher = await getPublisher();
  const result = await publisher.purchases.subscriptionsv2.get({
    packageName: PACKAGE_NAME,
    token: purchaseToken,
  });
  const purchase = result.data || {};
  const lineItem = (purchase.lineItems || []).find(item => item.productId === productId);
  const basePlanId = String(lineItem?.offerDetails?.basePlanId || "");
  const expiresAt = String(lineItem?.expiryTime || "");
  const expiresTimestamp = Date.parse(expiresAt);
  const subscriptionState = String(purchase.subscriptionState || "UNKNOWN");
  const active = ACTIVE_STATES.has(subscriptionState)
    && basePlanId === BASE_PLAN_ID
    && Number.isFinite(expiresTimestamp)
    && expiresTimestamp > Date.now();

  // Uma compra válida precisa ser reconhecida em até três dias para não ser
  // reembolsada pela Google Play. O Admin SDK usa a conta de serviço da função.
  if(lineItem && basePlanId === BASE_PLAN_ID
    && !subscriptionState.includes("PENDING")
    && purchase.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED") {
    await publisher.purchases.subscriptions.acknowledge({
      packageName: PACKAGE_NAME,
      subscriptionId: productId,
      token: purchaseToken,
      requestBody: {},
    });
  }

  const entitlement = {
    active,
    productId,
    basePlanId,
    packageName: PACKAGE_NAME,
    subscriptionState,
    expiresAt: Number.isFinite(expiresTimestamp) ? Timestamp.fromMillis(expiresTimestamp) : null,
    purchaseTokenHash: hashPurchaseToken(purchaseToken),
    updatedAt: FieldValue.serverTimestamp(),
    source: "google_play",
  };
  await db.doc(`entitlements/${uid}`).set(entitlement, { merge:true });

  return {
    active,
    productId,
    basePlanId,
    subscriptionState: entitlement.subscriptionState,
    expiresAt: Number.isFinite(expiresTimestamp) ? new Date(expiresTimestamp).toISOString() : null,
  };
}

export const validateGooglePlaySubscription = onRequest({ cors:true }, async (req, res) => {
  if(req.method !== "POST") return jsonError(res, 405, "Método não permitido.");
  try {
    const decoded = await verifyFirebaseUser(req);
    const { purchaseToken, productId } = normalizePurchaseInput(req.body);
    const response = await validateAndStoreSubscription({ uid:decoded.uid, purchaseToken, productId });
    return res.status(response.active ? 200 : 403).json(response);
  } catch(error) {
    console.error("Falha ao validar assinatura Google Play:", error);
    return jsonError(res, Number(error?.status) || 500, error?.status ? error.message : "Não foi possível validar a assinatura.");
  }
});

export const googlePlayRtdn = onMessagePublished("rumofi-google-play-rtdn", async event => {
  const encoded = event.data?.message?.data;
  if(!encoded) return;
  let notification;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    notification = payload.subscriptionNotification;
  } catch(error) {
    console.error("RTDN da Google Play inválida:", error);
    return;
  }
  const purchaseToken = String(notification?.purchaseToken || "");
  const productId = String(notification?.subscriptionId || "");
  if(!purchaseToken || productId !== PRODUCT_ID) return;
  const snapshot = await db.collection("entitlements")
    .where("purchaseTokenHash", "==", hashPurchaseToken(purchaseToken))
    .limit(1)
    .get();
  if(snapshot.empty) return;
  await validateAndStoreSubscription({
    uid:snapshot.docs[0].id,
    purchaseToken,
    productId,
  });
});
