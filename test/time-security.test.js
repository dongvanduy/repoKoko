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
test("Tokyo calendar, month/year/leap boundaries and same-day booking", () => {
  assert.deepEqual(time.bookingCalendar(new Date("2026-12-31T14:59:00Z")), { today: "2026-12-31", tomorrow: "2027-01-01", timeZone: "Asia/Tokyo" });
  assert.equal(time.tokyoDate(new Date("2026-12-31T15:00:00Z")), "2027-01-01");
  assert.equal(time.bookingCalendar(new Date("2028-02-28T00:00:00Z")).tomorrow, "2028-02-29");
  assert.equal(time.validDate("2026-02-30"), false); assert.equal(time.validDate("2028-02-29"), true);
  assert.throws(() => time.arrivalInstant("2026-10-19", "25:99"));
  const afternoon = new Date("2026-10-19T15:00:00+09:00");
  assert.equal(time.isBookableDate("2026-10-19", afternoon), true);
  assert.equal(time.isBookableDate("2026-10-18", afternoon), false);
  assert.equal(time.isBookableDate("2026-02-30", afternoon), false);
  assert.equal(time.isBookableDate("2026-12-31", new Date("2026-12-31T14:59:59Z")), true);
  assert.equal(time.isBookableDate("2026-12-31", new Date("2026-12-31T15:00:00Z")), false);
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

test("configuration rejects shell commands pasted into SITE_URL",()=>{
  const env={MONGO_URI:"mongodb://example.invalid/test",SESSION_SECRET:"x".repeat(40),ADMIN_USER:"admin",ADMIN_PASSWORD_HASH:"$argon2id$test",NODE_ENV:"production"};
  assert.doesNotThrow(()=>validateConfig({...env,SITE_URL:"https://kokorokimono.com"}));
  assert.throws(()=>validateConfig({...env,SITE_URL:"https://kokorokimono.com BOOKING_WRITES_ENABLED=true NODE_ENV=production pm2 restart kokoro --update-env"}),/SITE_URL/);
});
test("error diagnostics expose codes without customer values or connection secrets",()=>{
  const {safeErrorDetails,normalizeUploadError}=require("../lib/errors");
  const internal=Object.assign(new Error("mongodb://user:secret@host/customer-email"),{name:"MongoServerError",code:11000});
  const details=JSON.stringify(safeErrorDetails(Object.assign(new Error("private"),{cause:internal})));
  assert.match(details,/11000/);assert.doesNotMatch(details,/secret|customer-email|mongodb/);
  const upload=normalizeUploadError(Object.assign(new Error("private file name"),{name:"MulterError",code:"LIMIT_FILE_SIZE"}));
  assert.equal(upload.status,413);assert.equal(upload.code,"upload_too_large");
});
