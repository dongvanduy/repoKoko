const { test } = require("node:test");
const assert = require("node:assert/strict");
const { database } = require("./helpers/database");
const { sendEmailJob } = require("../services/mail");
const { runOnce } = require("../services/jobs");
const service = require("../services/bookings");
const Booking = require("../models/booking"), Plan = require("../models/Plan"), Job = require("../models/Job"), Config = require("../models/Config");

test("booking email reaches the configured admin through the worker", async t => {
  const db = await database(); t.after(db.close);
  const plan = await Plan.create({ title: { en: "Test plan" }, price: 3000, isVisible: true });
  await Config.create({ key: "booking_inventory_v1", value: { ready: true } });
  const priced = await service.priceLines([{ id: String(plan._id), qty: 1 }], "en");
  const sent = [];
  const smtp = { sendMail: async mail => { sent.push(mail); return { accepted: [mail.to.address], rejected: [] }; } };
  const handlers = { email: (payload, job) => sendEmailJob(payload, job, smtp) };
  const make = async (owner, mode = "multi") => service.createBooking({
    owner, language: "en",
    body: { quote: service.issueQuote(priced, owner, mode), quantity: "1", shopId: "1",
      date: require("../lib/time").bookingCalendar().tomorrow, time: "09:00",
      fullname: "<img src=x onerror=alert(1)>", email: "customer@example.invalid", phone: "0901234567" },
  });
  await t.test("both flows send separate admin and customer messages without duplicating jobs", async () => {
    process.env.ADMIN_EMAIL = " admin@example.invalid ";
    for (const mode of ["quick", "multi"]) {
      const booking = await make(mode, mode);
      assert.equal(await Job.countDocuments({ "payload.bookingId": String(booking._id) }), 2);
      await runOnce(handlers); await runOnce(handlers);
      const admin = sent.find(mail => mail.to.address === "admin@example.invalid" && mail.subject.includes(booking.bookingCode));
      assert.ok(admin);
      assert.match(admin.subject, /Có đặt lịch mới/);
      assert.match(admin.text, /09:00.*JST, UTC\+9/);
      assert.match(admin.text, /customer@example.invalid/); assert.match(admin.text, /0901234567/);
      assert.match(admin.html, /&lt;img/); assert.doesNotMatch(admin.html, /<img/);
      assert.equal(admin.replyTo.address, booking.email);
      const customer = sent.filter(mail => mail.to.address === booking.email);
      assert.ok(customer.every(mail => !mail.replyTo && !mail.subject.includes("Có đặt lịch mới")));
      assert.equal(await Job.countDocuments({ "payload.bookingId": String(booking._id), status: "done" }), 2);
    }
  });
  await t.test("missing admin configuration retains a retryable job while customer mail still sends", async () => {
    process.env.ADMIN_EMAIL = "";
    const booking = await make("missing-recipient");
    const filter = { "payload.bookingId": String(booking._id), "payload.audience": "admin" };
    assert.equal(await Job.countDocuments(filter), 1);
    await runOnce(handlers); await runOnce(handlers);
    const pending = await Job.findOne(filter).lean();
    assert.equal(pending.status, "pending"); assert.equal(pending.lastError, "mail_recipient_missing");
    assert.equal(await Job.countDocuments({ "payload.bookingId": String(booking._id), "payload.audience": "customer", status: "done" }), 1);
    process.env.ADMIN_EMAIL = "admin@example.invalid";
    await Job.updateOne(filter, { $set: { availableAt: new Date(0) } });
    await runOnce(handlers);
    assert.equal((await Job.findOne(filter)).status, "done");
    assert.equal(sent.filter(mail => mail.subject.includes(booking.bookingCode)).length, 1);
  });
  await t.test("SMTP rejection never marks the admin mail done and retries stop after five attempts", async () => {
    const booking = await make("smtp-rejected");
    const filter = { "payload.bookingId": String(booking._id), "payload.audience": "admin" };
    const rejected = { email: async (payload, job) => sendEmailJob(payload, job, {
      sendMail: async mail => payload.audience === "admin"
        ? { accepted: [], rejected: [mail.to.address] } : { accepted: [mail.to.address], rejected: [] },
    }) };
    for (let i = 0; i < 6; i++) {
      await Job.updateOne(filter, { $set: { availableAt: new Date(0) } });
      await runOnce(rejected);
    }
    const failed = await Job.findOne(filter).lean();
    assert.equal(failed.status, "failed"); assert.equal(failed.attempts, 5); assert.equal(failed.lastError, "mail_not_accepted");
    assert.equal(await Job.countDocuments({ "payload.bookingId": String(booking._id), "payload.audience": "customer", status: "done" }), 1);
  });
  await t.test("invalid admin recipients are rejected before contacting SMTP", async () => {
    const booking = await Booking.findOne().lean();
    process.env.ADMIN_EMAIL = "admin@example.invalid\r\nBcc: other@example.invalid";
    const count = sent.length;
    await assert.rejects(sendEmailJob({ bookingId: String(booking._id), kind: "confirmation", audience: "admin" }, { _id: "test" }, smtp), error => error.code === "mail_recipient_invalid");
    assert.equal(sent.length, count);
  });
});
