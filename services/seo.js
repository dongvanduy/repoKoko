const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
let prepared = {};
try { prepared = JSON.parse(fs.readFileSync(path.join(__dirname, "../locales/seo-prepared.json"), "utf8")); } catch { /* English source remains available. */ }
const sourceHash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function localizeSeoObject(key, locale, value) {
  const entry = prepared[key];
  return entry?.hash === sourceHash(value) && entry.locales?.[locale] ? entry.locales[locale] : value;
}
module.exports = { localizeSeoObject, sourceHash };
