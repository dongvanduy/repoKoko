const fs = require("node:fs");
const crypto = require("node:crypto");
const argon2 = require("argon2");
const dotenv = require("dotenv");
async function main() {
  const source = fs.readFileSync(".env", "utf8");
  const env = dotenv.parse(source);
  if (!env.ADMIN_PASSWORD_HASH && !env.ADMIN_PASS) throw new Error("Set ADMIN_PASS in the local .env before migration.");
  const hash = env.ADMIN_PASSWORD_HASH || await argon2.hash(env.ADMIN_PASS, { type: argon2.argon2id });
  if (env.ADMIN_PASS && !await argon2.verify(hash, env.ADMIN_PASS)) throw new Error("Existing hash does not match ADMIN_PASS; no changes made.");
  if (!process.argv.includes("--write")) { console.log("Configuration can be migrated. Run npm run admin:hash -- --write to store the hash and remove ADMIN_PASS."); return; }
  let next = source.replace(/^ADMIN_PASS=.*\r?\n?/gm, "").replace(/^ADMIN_PASSWORD_HASH=.*\r?\n?/gm, "");
  next += "\nADMIN_PASSWORD_HASH='" + hash + "'\n";
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    next = next.replace(/^SESSION_SECRET=.*\r?\n?/gm, "") + "SESSION_SECRET=" + crypto.randomBytes(48).toString("hex") + "\n";
  }
  fs.writeFileSync(".env", next);
  console.log("Stored Argon2id hash; removed plaintext password. Secret values were not printed.");
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
