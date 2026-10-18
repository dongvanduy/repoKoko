const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
async function database() {
  process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-characters";
  process.env.ADMIN_USER = "testadmin"; process.env.ADMIN_EMAIL = "";
  process.env.SMTP_HOST = ""; process.env.SMTP_USER = ""; process.env.SMTP_PASS = "";
  process.env.WORKER_ENABLED = "false"; process.env.NODE_ENV = "test";
  const repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  process.env.MONGO_URI = repl.getUri("kokoro_test");
  await mongoose.connect(process.env.MONGO_URI);
  const models = ["booking", "Plan", "Config", "SlotInventory", "Job", "RateBucket", "BlogPost"].map(name => require("../../models/" + name));
  await Promise.all(models.map(m => m.init()));
  return { mongoose, close: async () => { await mongoose.disconnect(); await repl.stop(); } };
}
module.exports = { database };
