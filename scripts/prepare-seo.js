const fs = require("node:fs");
const path = require("node:path");
const translate = require("google-translate-api-x");
const { sourceHash } = require("../services/seo");
const { landingPage, photoshootPage, rentalPlans, blogPosts } = require("../seo-content");
const skip = new Set(["slug","path","date","thumbnail","heroImage","image","url"]);
const filename = path.join(__dirname, "../locales/seo-prepared.json");
const targets = { vi: "vi", jp: "ja", zh: "zh-CN" };
async function translateTree(value, lang) {
  const copy = structuredClone(value), leaves = [];
  function walk(node, key = "", parent, property) {
    if (typeof node === "string") {
      if (node.trim() && !skip.has(key)) leaves.push({ parent, property, value: node });
    } else if (Array.isArray(node)) node.forEach((v, i) => walk(v, key, node, i));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, k, node, k);
  }
  walk(copy);
  // Small batches reduce HTTP calls; abort the underlying request on timeout.
  for (let i = 0; i < leaves.length;) {
    const batch = []; let size = 0;
    while (i < leaves.length && batch.length < 20 && (size + leaves[i].value.length < 4000 || !batch.length)) {
      size += leaves[i].value.length; batch.push(leaves[i++]);
    }
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await translate(batch.map(item => item.value), {
      from: "en", to: targets[lang], rejectOnPartialFail: true,
      requestOptions: { signal: AbortSignal.timeout(20000) },
        });
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
      }
    }
    if (!Array.isArray(result) || result.length !== batch.length || result.some(r => !r?.text)) throw new Error("incomplete_translation");
    batch.forEach((item, j) => { item.parent[item.property] = result[j].text; });
  }
  return copy;
}
(async () => {
  let prepared = {}; try { prepared = JSON.parse(fs.readFileSync(filename, "utf8")); } catch {}
  const sources = { landingPage, photoshootPage, rentalPlans, ...Object.fromEntries(blogPosts.map(p => ["blog-post:" + p.slug, p])) };
  for (const [key, value] of Object.entries(sources)) {
    if (prepared[key]?.hash !== sourceHash(value)) prepared[key] = { hash: sourceHash(value), locales: { en: value } };
    for (const lang of Object.keys(targets)) {
      if (prepared[key].locales[lang]) continue;
      if (process.argv.includes("--fallback-only")) continue;
      prepared[key].locales[lang] = await translateTree(value, lang);
      fs.writeFileSync(filename, JSON.stringify(prepared, null, 2) + "\n");
      console.log("Prepared " + key + " [" + lang + "]");
    }
  }
  fs.writeFileSync(filename, JSON.stringify(prepared, null, 2) + "\n");
})().catch(error => { console.error("Translation status: " + (error.name || "Error") + " / " + (error.code || error.message?.slice(0, 120) || "unknown"));
console.error("Translation unavailable; completed entries are preserved and visitors use the English source."); process.exitCode = 1; });
