import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  formatBrazilianPhone,
  normalizeBrazilianPhone,
  RUMOFI_FIREBASE_CONFIG,
} from "../mobile-auth.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("normaliza telefone brasileiro sem misturar o código do país", () => {
  assert.equal(normalizeBrazilianPhone("(51) 99999-1234"), "+5551999991234");
  assert.equal(normalizeBrazilianPhone("+55 51 99999-1234"), "+5551999991234");
  assert.equal(normalizeBrazilianPhone("123"), "");
  assert.equal(formatBrazilianPhone("51999991234"), "(51) 99999-1234");
});

test("autenticação usa apenas o projeto independente do RumoFi", () => {
  const source = read("mobile-auth.mjs");

  assert.equal(RUMOFI_FIREBASE_CONFIG.projectId, "rumofi-69b1e");
  assert.match(source, /doc\(db, "profiles", uid\)/);
  assert.match(source, /doc\(db, "financialData", uid\)/);
  assert.match(source, /browserLocalPersistence/);
  assert.doesNotMatch(source, /cmt|inteligencia-financeira/i);
});

test("cadastro exige o tratamento operacional e mantém marketing opcional", () => {
  const source = read("mobile-auth.mjs");

  assert.match(source, /name="privacyAcknowledged" type="checkbox" required/);
  assert.match(source, /name="marketingEmail" type="checkbox"/);
  assert.match(source, /name="marketingWhatsapp" type="checkbox"/);
  assert.doesNotMatch(source, /name="marketing(?:Email|Whatsapp)" type="checkbox" checked/);
  assert.match(source, /data-auth-action="delete-account"/);
});

test("login Google nativo compartilha a sessão com o Firebase web e exige telefone", () => {
  const source = read("mobile-auth.mjs");
  const capacitorConfig = read("capacitor.config.ts");
  const variables = read("android/variables.gradle");
  const googleServicesPath = path.join(root, "android/app/google-services.json");

  assert.match(source, /Entrar com Google/);
  assert.match(source, /FirebaseAuthentication\.signInWithGoogle\(\)/);
  assert.match(source, /GoogleAuthProvider\.credential\(idToken\)/);
  assert.match(source, /signInWithCredential\(auth,/);
  assert.match(source, /initializeAuth\(firebaseApp, \{ persistence:indexedDBLocalPersistence \}\)/);
  assert.match(source, /data-auth-form="google-profile"/);
  assert.match(source, /if\(!remoteError && hasAuthProvider\(user, "google\.com"\).*normalizeBrazilianPhone/s);
  assert.match(source, /if\(isNative\) await FirebaseAuthentication\.signOut\(\)/);
  assert.match(capacitorConfig, /providers: \["google\.com"\]/);
  assert.match(variables, /rgcfaIncludeGoogle = true/);
  assert.match(variables, /androidxCredentialsVersion = '1\.3\.0'/);
  assert.match(read(".gitignore"), /android\/app\/google-services\.json/);

  if(existsSync(googleServicesPath)) {
    const googleServices = JSON.parse(read("android/app/google-services.json"));
    assert.equal(googleServices.client[0].client_info.android_client_info.package_name, "app.fazmeucontrole.mobile");
    assert.ok(googleServices.client[0].oauth_client.some((client) => client.client_type === 1));
    assert.ok(googleServices.client[0].oauth_client.some((client) => client.client_type === 3));
  }
});

test("autenticação mantém texto legível nos temas claro e escuro", () => {
  const css = read("mobile-auth.css");

  assert.match(css, /html\[data-finance-theme="light"\] \.rumofi-auth-root/);
  assert.match(css, /html\[data-finance-theme="dark"\] \.rumofi-auth-root/);
  assert.match(css, /--rumofi-auth-input-text: #f8fafc/);
  assert.match(css, /--rumofi-auth-input: #0d1119/);
  assert.match(css, /\.rumofi-auth-google[\s\S]*color: #1f1f1f;[\s\S]*background: #ffffff;/);
  assert.match(css, /-webkit-text-fill-color: var\(--rumofi-auth-input-text\)/);
});

test("APK possui internet para autenticação e sincronização", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android\.permission\.INTERNET/);
});
