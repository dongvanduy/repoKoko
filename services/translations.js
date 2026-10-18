const translate = require("google-translate-api-x");
const Plan = require("../models/Plan");
const BlogPost = require("../models/BlogPost");
const languages = { vi: "vi", en: "en", jp: "ja", zh: "zh-CN" };
const initialText = (value, locale = "vi") => ({ [locale]: value || "" });
async function translateText(value, sourceLocale, translator = translate) {
  const result = { [sourceLocale]: value };
  for (const [locale, language] of Object.entries(languages)) {
    if (locale === sourceLocale) continue;
    let timer;
    try {
      const response = await Promise.race([
        translator(value, { from: languages[sourceLocale], to: language, requestOptions: { signal: AbortSignal.timeout(20000) } }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("translation_timeout"), { code: "translation_timeout" })), 20000); }),
      ]);
      if (!response?.text) throw new Error("empty_translation");
      result[locale] = response.text;
    } finally { clearTimeout(timer); }
  }
  return result;
}
async function localizeTree(value, locale, translator) {
  if (Array.isArray(value)) { const result = []; for (const item of value) result.push(await localizeTree(item, locale, translator)); return result; }
  if (value && typeof value === "object") {
    if (typeof value[locale] === "string") return value[locale] ? translateText(value[locale], locale, translator) : value;
    const result = {};
    for (const [key, child] of Object.entries(value)) result[key] = await localizeTree(child, locale, translator);
    return result;
  }
  return value;
}
async function translateJob(payload, job, translator) {
  const Model = payload.model === "Plan" ? Plan : payload.model === "BlogPost" ? BlogPost : null;
  if (!Model) throw new Error("invalid_translation_model");
  const current = await Model.findOne({ _id: payload.id, translationVersion: payload.version }).lean();
  if (!current) return;
  const translated = await localizeTree(payload.source, payload.locale, translator);
  await Model.updateOne({ _id: payload.id, translationVersion: payload.version }, { $set: translated }, { runValidators: true });
}
module.exports = { initialText, translateText, localizeTree, translateJob };
