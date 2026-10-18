const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { BSON } = require("mongoose").mongo;
async function backupBookings(client, root = path.join(__dirname, "../.cache/booking-backups")) {
  const directory = path.join(root, new Date().toISOString().replace(/[:.]/g, "-") + "-" + crypto.randomUUID());
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const db = client.db(), manifest = { createdAt: new Date().toISOString(), database: db.databaseName, collections: [] };
  for (const [name, filter] of [["bookings", {}], ["slotinventories", {}], ["configs", { key: "booking_inventory_v1" }]]) {
    const filename = name + ".ejsonl", hash = crypto.createHash("sha256");
    const file = await fs.open(path.join(directory, filename), "wx", 0o600);
    let count = 0;
    try {
      for await (const document of db.collection(name).find(filter)) {
        const line = BSON.EJSON.stringify(document, { relaxed: false }) + "\n";
        await file.writeFile(line); hash.update(line); count++;
      }
      await file.sync();
    } finally { await file.close(); }
    manifest.collections.push({ name, filename, count, sha256: hash.digest("hex") });
  }
  await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return { directory, manifest };
}
module.exports = { backupBookings };
