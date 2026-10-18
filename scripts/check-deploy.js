const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
async function main() {
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && (minor < 13 || (minor === 13 && patch < 1)))) throw new Error("Use Node.js >= 22.13.1.");
  require("../lib/config").validateConfig();
  require("../lib/assets").assertAssetsBuilt();
  if (process.argv.includes("--booking")) {
    const { MongoClient } = require("mongoose").mongo;
    const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
    try {
      await client.connect();
      await require("../services/booking-readiness").checkBookingReadiness({ client });
      console.log("Booking readiness OK: writes enabled, replica set available, inventory initialized.");
    } catch (error) {
      if (["BOOKING_PAUSED", "TRANSACTIONS_UNSUPPORTED", "INVENTORY_NOT_INITIALIZED"].includes(error.code)) throw error;
      throw new Error("Booking readiness check failed: verify MongoDB connectivity and read permissions.");
    } finally { await client.close(); }
  } else {
    console.log("Application files, built assets and required configuration are ready. Use --booking to check MongoDB and booking inventory.");
  }
  console.log("Restart the Node process from this release directory to load the updated JavaScript.");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
