const nodemailer = require("nodemailer");
const Booking = require("../models/booking");
const { escapeHtml: h } = require("../lib/validation");
const { messages } = require("../lib/messages");
const { ACTIVE } = require("./bookings");
let transport;
function createTransport() {
  if (transport) return transport;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) throw Object.assign(new Error("mail_not_configured"), { code: "mail_not_configured" });
  transport = nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT), secure: /^(true|1|yes)$/i.test(process.env.SMTP_SECURE || ""),
    auth: { user: SMTP_USER, pass: SMTP_PASS }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  return transport;
}
function renderBookingMail(booking, kind, lang, audience = "customer") {
  const admin = audience === "admin";
  const t = messages(admin ? "vi" : lang);
  const subject = admin
    ? "[Kokoro] " + (kind === "reminder" ? "Lịch hẹn hôm nay" : "Có đặt lịch mới") + " — " + booking.bookingCode
    : kind === "reminder" ? t.reminder : t.confirmation;
  const rows = [
    [t.bookingCode, booking.bookingCode], [t.shop, booking.shopName],
    [t.arrive, booking.date + " " + booking.time + " — " + t.timezone],
    [t.guests, booking.guestCount || booking.guests?.length || 1],
    [t.total, "JPY " + Number(booking.totalPrice || 0).toLocaleString("ja-JP")],
  ];
  if (admin) rows.push(["Khách hàng", booking.fullname], ["Email", booking.email], ["Số điện thoại", booking.phone]);
  const greeting = admin ? "Thông báo dành cho quản trị cửa hàng." : t.hello + " " + booking.fullname;
  const text = [subject, greeting, ...rows.map(([k,v]) => k + ": " + v),
    ...(booking.guests || []).map(g => g.planName + " — JPY " + g.price)].join("\n");
  const html = "<div><h2>" + h(subject) + "</h2><p>" + h(greeting) + "</p>" +
    rows.map(([k,v]) => "<p><strong>" + h(k) + ":</strong> " + h(v) + "</p>").join("") +
    "<ul>" + (booking.guests || []).map(g => "<li>" + h(g.planName) + " — JPY " + h(g.price) + "</li>").join("") + "</ul></div>";
  return { subject, text, html };
}
async function sendEmailJob(payload, job, suppliedTransport) {
  const booking = await Booking.findById(payload.bookingId).lean();
  if (!booking) return;
  if (payload.kind === "reminder" && (booking.archivedAt || !ACTIVE.includes(booking.status) || !booking.startsAt || new Date(booking.startsAt) <= new Date())) return;
  const to = (payload.audience === "admin" ? process.env.ADMIN_EMAIL : booking.email)?.trim();
  if (!to) throw Object.assign(new Error("mail_recipient_missing"), { code: "mail_recipient_missing" });
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(to)) throw Object.assign(new Error("mail_recipient_invalid"), { code: "mail_recipient_invalid" });
  const lang = payload.audience === "admin" ? "vi" : booking.language;
  const content = renderBookingMail(booking, payload.kind, lang, payload.audience);
  const sender = process.env.MAIL_FROM || process.env.SMTP_USER;
  if (!sender && !suppliedTransport) throw Object.assign(new Error("mail_not_configured"), { code: "mail_not_configured" });
  const info = await (suppliedTransport || createTransport()).sendMail({
    from: { name: "Kokoro Booking", address: sender || "test@example.invalid" }, to: { address: to },
    messageId: "<" + job._id + "@kokoro.booking>", ...content,
    ...(payload.audience === "admin" ? { replyTo: { name: booking.fullname, address: booking.email } } : {}),
    disableFileAccess: true, disableUrlAccess: true,
  });
  const accepted = info?.accepted || [];
  if (info?.rejected?.length || !accepted.some(address => (typeof address === "string" ? address : address.address)?.toLowerCase() === to.toLowerCase())) {
    throw Object.assign(new Error("mail_not_accepted"), { code: "mail_not_accepted" });
  }
  console.log(JSON.stringify({ event: "email_accepted", jobId: String(job._id), audience: payload.audience, kind: payload.kind }));
}
module.exports = { renderBookingMail, sendEmailJob, createTransport };
