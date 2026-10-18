require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const Plan = require("../models/Plan");
const { plans } = require("../data");
const dicts = Object.fromEntries(["vi","en","jp","zh"].map(lang => [lang, require("../locales/" + lang + ".json")]));
function localize(key) { return Object.fromEntries(Object.entries(dicts).map(([lang, dict]) => [lang, key.split(".").reduce((obj, part) => obj?.[part], dict) || key])); }
(async () => {
  if (!process.argv.includes("--apply")) { console.log("Use --apply to initialize plans only when the collection is empty."); return; }
  await mongoose.connect(process.env.MONGO_URI);
  if (await Plan.countDocuments()) throw new Error("Plans already exist; seed does not overwrite them.");
  await Plan.insertMany(plans.map(p => ({ ...p, legacyId: p.id, image: p.image || p.img, title: localize(p.title), desc: localize(p.desc), isVisible: true })));
  console.log("Initialized catalog. Run the booking migration separately before accepting bookings.");
})().catch(() => { console.error("Seed failed or catalog already exists."); process.exitCode = 1; }).finally(() => mongoose.disconnect());
