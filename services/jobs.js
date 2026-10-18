const crypto = require("node:crypto");
const Job = require("../models/Job");
const Booking = require("../models/booking");
const { ACTIVE } = require("./bookings");
const { tokyoDate, arrivalInstant } = require("../lib/time");
const { sendEmailJob } = require("./mail");
const { translateJob } = require("./translations");
const MAX_ATTEMPTS = 5;
const LEASE_MS = 120000;
async function scheduleReminders(now = new Date()) {
  const today = tokyoDate(now);
  if (now < arrivalInstant(today, "07:00")) return;
  const cursor = Booking.find({ date: today, archivedAt: null, status: { $in: ACTIVE }, startsAt: { $gt: now } }).select("_id").lean().cursor();
  for await (const booking of cursor) {
    for (const audience of process.env.ADMIN_EMAIL ? ["customer", "admin"] : ["customer"]) {
      const key = "reminder:" + today + ":" + audience + ":" + booking._id;
      try {
        await Job.updateOne({ key }, { $setOnInsert: { type: "email", payload: { bookingId: String(booking._id), kind: "reminder", audience }, status: "pending", availableAt: now } }, { upsert: true });
      } catch (e) { if (e.code !== 11000) throw e; }
    }
  }
}
async function runOnce(handlers = { email: sendEmailJob, translation: translateJob }, now = new Date()) {
  await Job.updateMany({ status: "running", lockedUntil: { $lte: now }, attempts: { $gte: MAX_ATTEMPTS } }, { $set: { status: "failed", lastError: "lease_exhausted" }, $unset: { lockToken: 1, lockedUntil: 1 } });
  const token = crypto.randomUUID();
  const job = await Job.findOneAndUpdate({
    attempts: { $lt: MAX_ATTEMPTS }, availableAt: { $lte: now },
    $or: [{ status: "pending" }, { status: "running", lockedUntil: { $lte: now } }],
  }, { $set: { status: "running", lockedUntil: new Date(now.getTime() + LEASE_MS), lockToken: token }, $inc: { attempts: 1 } },
  { sort: { availableAt: 1, createdAt: 1 }, returnDocument: "after" }).lean();
  if (!job) return false;
  const filter = { _id: job._id, status: "running", lockToken: token };
  const heartbeat = setInterval(() => {
    Job.updateOne(filter, { $set: { lockedUntil: new Date(Date.now() + LEASE_MS) } }).catch(() => {});
  }, LEASE_MS / 3);
  heartbeat.unref();
  try {
    if (!handlers[job.type]) throw new Error("unsupported_job");
    await handlers[job.type](job.payload, job);
    await Job.updateOne(filter, { $set: { status: "done", finishedAt: new Date() }, $unset: { lockToken: 1, lockedUntil: 1, lastError: 1 } });
  } catch (error) {
    const code = ["mail_not_configured", "mail_recipient_missing", "translation_timeout", "EAUTH", "ECONNECTION", "ETIMEDOUT"].includes(error.code) ? error.code : "job_failed";
    await Job.updateOne(filter, { $set: {
      status: job.attempts >= MAX_ATTEMPTS ? "failed" : "pending", lastError: code,
      availableAt: new Date(Date.now() + 60000 * 2 ** (job.attempts - 1)),
    }, $unset: { lockToken: 1, lockedUntil: 1 } });
    console.error(JSON.stringify({ event: "job_failed", jobId: String(job._id), type: job.type, code }));
  } finally { clearInterval(heartbeat); }
  return true;
}
function startWorker() {
  let stopped = false; let timer; let lastReminders = 0; let current;
  async function tick() {
    if (stopped) return;
    try {
      if (Date.now() - lastReminders > 60000) { await scheduleReminders(); lastReminders = Date.now(); }
      for (let i = 0; i < 10 && !stopped; i++) if (!await runOnce()) break;
    } catch { console.error(JSON.stringify({ event: "worker_unavailable" })); }
    if (!stopped) { timer = setTimeout(() => { current = tick(); }, 1000); timer.unref(); }
  }
  current = tick();
  return async () => { stopped = true; clearTimeout(timer); await current; };
}
module.exports = { runOnce, scheduleReminders, startWorker };
