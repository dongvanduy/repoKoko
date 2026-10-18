const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const time = require("../lib/time");
const { validateConfig } = require("../lib/config");
const { contact, jsonForHtml } = require("../lib/validation");
const { renderBookingMail } = require("../services/mail");
test("Tokyo arrival is independent of process timezone", () => {
  for (const TZ of ["Asia/Ho_Chi_Minh", "Asia/Tokyo", "UTC", "America/Los_Angeles"]) {
    const result = spawnSync(process.execPath, ["-e", "console.log(require('./lib/time').arrivalInstant('2026-10-19','08:00').toISOString())"], { cwd: require("node:path").resolve(__dirname, ".."), env: { ...process.env, TZ }, encoding: "utf8" });
    assert.equal(result.status, 0); assert.equal(result.stdout.trim(), "2026-10-18T23:00:00.000Z");
  }
});
test("Tokyo calendar, month/year/leap boundaries and exact lead-time", () => {
  assert.deepEqual(time.bookingCalendar(new Date("2026-12-31T14:59:00Z")), { today: "2026-12-31", tomorrow: "2027-01-01", timeZone: "Asia/Tokyo" });
  assert.equal(time.tokyoDate(new Date("2026-12-31T15:00:00Z")), "2027-01-01");
  assert.equal(time.bookingCalendar(new Date("2028-02-28T00:00:00Z")).tomorrow, "2028-02-29");
  assert.equal(time.validDate("2026-02-30"), false); assert.equal(time.validDate("2028-02-29"), true);
  assert.throws(() => time.arrivalInstant("2026-10-19", "25:99"));
  assert.equal(time.hasLeadTime("2026-10-19", "08:00", new Date("2026-10-18T22:00:00Z")), true);
  assert.equal(time.hasLeadTime("2026-10-19", "08:00", new Date("2026-10-18T22:00:00.001Z")), false);
});
test("startup fails closed and contact rejects object/array/header injections", () => {
  assert.throws(() => validateConfig({}), /Missing configuration/);
  assert.throws(() => validateConfig({ ADMIN_USER:"admin", ADMIN_PASSWORD_HASH:"clear", SESSION_SECRET:"x", MONGO_URI:"test" }));
  for (const email of [{ $ne: "" }, ["a@b.c"], "x@x.com\r\nBcc:bad@x.com", "a@x.com,b@x.com"]) assert.throws(() => contact({ fullname:"Test", email, phone:"0901234567" }));
});
test("email and embedded JSON escape customer text while preserving JST", () => {
  const mail = renderBookingMail({ fullname:'<img src=x onerror=alert(1)>', shopName:"Shop", bookingCode:"TEST", date:"2026-10-19", time:"08:00", totalPrice:3000, guests:[{planName:"<script>bad</script>",price:3000}] }, "confirmation", "vi");
  assert.match(mail.html, /&lt;img/); assert.doesNotMatch(mail.html, /<script>/);
  assert.match(mail.text, /2026-10-19 08:00/); assert.match(mail.text, /JST, UTC\+9/);
  assert.ok(!jsonForHtml({ value:"</script><script>" }).includes("<"));
});
