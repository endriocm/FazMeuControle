import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("APK possui internet para autenticação e sincronização", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android\.permission\.INTERNET/);
});
