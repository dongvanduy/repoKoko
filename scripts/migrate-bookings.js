require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const { migrateBookings } = require("../services/migration");
(async () => {
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  const report = await migrateBookings({ apply: process.argv.includes("--apply") });
  console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error(e.report ? JSON.stringify(e.report) : "Migration failed; verify database access and pause all writers before --apply."); process.exitCode = 1; })
.finally(() => mongoose.disconnect());
