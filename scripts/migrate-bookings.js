require("dotenv").config({ quiet: true });
const path = require("node:path");
const mongoose = require("mongoose");
const { migrateBookings } = require("../services/migration");
(async () => {
  const apply = process.argv.includes("--apply");
  if (apply && process.env.BOOKING_WRITES_ENABLED !== "false") throw new Error("writers_not_paused");
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  const report = await migrateBookings({ apply: false });
  if (apply) {
    if (report.blockers.length) throw Object.assign(new Error("legacy_review_required"), { report });
    const backup = await require("../services/booking-backup").backupBookings(mongoose.connection.getClient());
    console.log("Backup saved: " + path.relative(process.cwd(), backup.directory));
    console.log(JSON.stringify(await migrateBookings({ apply: true }), null, 2));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
})().catch(e => {
  console.error(e.report ? JSON.stringify(e.report) : "Migration failed; verify database access, backup disk space and pause all writers before --apply.");
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
