const { AppError } = require("./errors");
const TIME_ZONE = "Asia/Tokyo";
const LEAD_MINUTES = 60;
const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});
function tokyoDate(now = new Date()) {
  const parts = Object.fromEntries(dateFormat.formatToParts(now).map(p => [p.type, p.value]));
  return [parts.year, parts.month, parts.day].join("-");
}
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function arrivalInstant(date, time) {
  if (!validDate(date) || typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new AppError(400, "invalid_datetime");
  }
  return new Date(date + "T" + time + ":00+09:00");
}
function bookingCalendar(now = new Date()) {
  const today = tokyoDate(now);
  const tomorrow = new Date(today + "T00:00:00Z");
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return { today, tomorrow: tomorrow.toISOString().slice(0, 10), timeZone: TIME_ZONE };
}
function hasLeadTime(date, time, now = new Date()) {
  return arrivalInstant(date, time).getTime() >= now.getTime() + LEAD_MINUTES * 60000;
}
module.exports = { TIME_ZONE, LEAD_MINUTES, tokyoDate, validDate, arrivalInstant, bookingCalendar, hasLeadTime };
