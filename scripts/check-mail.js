const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
async function main() {
  if (process.env.WORKER_ENABLED === "false") throw Object.assign(new Error(), { code: "worker_disabled" });
  const to = process.env.ADMIN_EMAIL?.trim();
  if (!to) throw Object.assign(new Error(), { code: "mail_recipient_missing" });
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(to)) throw Object.assign(new Error(), { code: "mail_recipient_invalid" });
  const transport = require("../services/mail").createTransport();
  try { await transport.verify(); } finally { transport.close(); }
  console.log("Mail checks OK: admin recipient configured, worker enabled, SMTP connection and authentication verified.");
  console.log("No email was sent. SMTP verification does not confirm inbox delivery. PM2 must use the same environment.");
}
main().catch(error => {
  const codes = ["worker_disabled", "mail_recipient_missing", "mail_recipient_invalid", "mail_not_configured", "EAUTH", "ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ETLS"];
  console.error("Mail check failed: " + (codes.includes(error.code) ? error.code : "smtp_unavailable") + ". Check configuration; no email was sent.");
  process.exitCode = 1;
});
