import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const productFiles = [
  "index.html",
  "finance-domain.mjs",
  "finance-schema.mjs",
  "financial-planning-domain.mjs",
  "financial-planning-ui.mjs",
  "financial-planning.css",
  "investment-domain.mjs",
  "mobile-shell.css",
  "manifest.webmanifest",
  "capacitor.config.ts",
  "package.json",
];

test("usa identidade e armazenamento independentes", () => {
  const source = productFiles.map(read).join("\n");
  const oldBrand = ["c", "m", "t"].join("");
  const oldDomain = ["c", "m", "t", "inteligencia"].join("");

  assert.doesNotMatch(source, new RegExp(`\\b${oldBrand}\\b`, "i"));
  assert.doesNotMatch(source, new RegExp(oldDomain, "i"));
  assert.doesNotMatch(source, /pwr_controle|finance:data-changed|window\.parent|window\.finance|postMessage/i);
  assert.match(read("index.html"), /const STORAGE_KEY_BASE = "faz_meu_controle_v1"/);
  assert.match(read("index.html"), /FAZ-MEU-CONTROLE-MEMORIA/);
  assert.match(read("capacitor.config.ts"), /app\.fazmeucontrole\.mobile/);
});

test("inicia sem registros demonstrativos ou dados pessoais", () => {
  const index = read("index.html");

  assert.doesNotMatch(index, /const INITIAL_DATA\s*=/);
  assert.match(index, /cards:\[\], entries:\[\], expenses:\[\], cardPurchases:\[\]/);
  assert.match(index, /investments:\[\], financialPlan:null/);
});

test("mantém os módulos centrais do controle financeiro", () => {
  const index = read("index.html");
  const domain = read("finance-domain.mjs");

  assert.match(index, /data-action="add-card"/);
  assert.match(index, /Adicionar fatura/);
  assert.match(index, /open-financial-planning/);
  assert.match(index, /add-card-purchase/);
  assert.match(domain, /MAX_RECURRING_PROJECTION_MONTHS = 24/);
});

test("empacota gráficos e Excel sem depender de CDN", () => {
  const index = read("index.html");

  assert.doesNotMatch(index, /cdn\.jsdelivr\.net/i);
  assert.match(index, /\/vendor\/chart-4\.5\.1\.umd\.min\.js/);
  assert.match(index, /\/vendor\/exceljs-4\.4\.0\.min\.js/);
  assert.doesNotMatch(index, /fonts\.googleapis\.com|http2\.mlstatic\.com/i);
  assert.match(index, /\.\/banks\/mercadopago\.svg/);
});
