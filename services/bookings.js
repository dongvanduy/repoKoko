const crypto = require("node:crypto");
const mongoose = require("mongoose");
const Booking = require("../models/booking");
const Plan = require("../models/Plan");
const Config = require("../models/Config");
const Slot = require("../models/SlotInventory");
const Job = require("../models/Job");
const { shops, options, timeSlots } = require("../data");
const { AppError, safeErrorDetails } = require("../lib/errors");
const { text, integer, contact } = require("../lib/validation");
const { TIME_ZONE, validDate, arrivalInstant, isBookableDate, tokyoDate } = require("../lib/time");
const ACTIVE = ["Mới", "Đã đặt (Chờ đến)", "Đã xác nhận", "Đã đến"];
const STATUSES = ["Mới", "Đã xác nhận", "Đã đến", "Hoàn tất", "Đã hủy"];
const MAX_GUESTS = Math.max(...timeSlots.map(s => s.maxGuests));
const ownerKey = sessionId => crypto.createHmac("sha256", process.env.SESSION_SECRET).update(sessionId).digest("hex");
const localized = (value, lang) => typeof value === "string" ? value : value?.[lang] || value?.en || value?.vi || "";
const guestCount = booking => booking.guestCount ?? (booking.guests?.length || 1);
const occupies = booking => !booking.archivedAt && ACTIVE.includes(booking.status);
function shopFor(id) {
  const value = text(String(typeof id === "number" ? id : (typeof id === "string" ? id : "")), "shop", 32);
  const shop = shops.find(s => String(s.id) === value);
  if (!shop) throw new AppError(400, "invalid_shop");
  return shop;
}
async function assertWritable() {
  if (process.env.BOOKING_WRITES_ENABLED === "false") throw new AppError(503, "booking_unavailable");
  const marker = await Config.findOne({ key: "booking_inventory_v1" }).lean();
  if (marker?.value?.ready !== true) throw new AppError(503, "booking_unavailable");
}
async function findPlan(id, session = null) {
  const value = text(String(typeof id === "number" ? id : (typeof id === "string" ? id : "")), "plan", 64);
  const filter = mongoose.isObjectIdOrHexString(value) ? { _id: value } : /^\d+$/.test(value) ? { legacyId: Number(value) } : null;
  if (!filter) throw new AppError(400, "invalid_plan");
  const plan = await Plan.findOne({ ...filter, isVisible: true }).session(session).lean();
  if (!plan || !Number.isSafeInteger(plan.price) || plan.price < 0) throw new AppError(400, "invalid_plan");
  return plan;
}
async function priceLines(lines, lang, session = null) {
  if (!Array.isArray(lines) || !lines.length || lines.length > MAX_GUESTS) throw new AppError(400, "invalid_plans");
  const seen = new Set(); let totalQuantity = 0;
  const result = [];
  for (const line of lines) {
    const qty = integer(line.qty, "quantity", 1, MAX_GUESTS);
    totalQuantity += qty;
    if (totalQuantity > MAX_GUESTS) throw new AppError(400, "invalid_quantity");
    const plan = await findPlan(line.id, session);
    const id = String(plan._id);
    if (seen.has(id)) throw new AppError(400, "invalid_plans");
    seen.add(id);
    result.push({ id, qty, price: plan.price, title: localized(plan.title, lang), image: plan.image, subTotal: plan.price * qty });
  }
  return { lines: result, totalQuantity, totalPrice: result.reduce((sum, p) => sum + p.subTotal, 0) };
}
function issueQuote(priced, owner, mode = "multi", key = crypto.randomUUID()) {
  const payload = {
    owner, mode, key, issuedAt: Date.now(),
    lines: priced.lines.map(p => ({ id: p.id, qty: p.qty, price: p.price })),
    optionPrices: Object.fromEntries(options.map(o => [o.id, o.price])),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return encoded + "." + crypto.createHmac("sha256", process.env.SESSION_SECRET).update(encoded).digest("base64url");
}
function readQuote(value, owner) {
  const token = text(value, "quote", 16000);
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new AppError(400, "invalid_quote");
  const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw new AppError(400, "invalid_quote");
  let quote;
  try { quote = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw new AppError(400, "invalid_quote"); }
  if (quote.owner !== owner || !Array.isArray(quote.lines)) throw new AppError(400, "invalid_quote");
  return quote;
}
function normalizeOptions(body, lines) {
  const selected = {};
  for (const line of lines) {
    for (let i = 1; i <= line.qty; i++) {
      const key = "options_" + line.id + "_" + i;
      const raw = body[key] ?? [];
      const ids = Array.isArray(raw) ? raw : [raw];
      if (ids.length > options.length || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !options.some(o => o.id === id))) throw new AppError(400, "invalid_options");
      selected[key] = [...ids].sort();
    }
  }
  for (const key of Object.keys(body)) if (key.startsWith("options_") && !(key in selected)) throw new AppError(400, "invalid_options");
  return selected;
}
function requestData(body, quote) {
  const shop = shopFor(body.shopId);
  const date = text(body.date, "date", 10); const time = text(body.time, "time", 5);
  arrivalInstant(date, time);
  const lines = quote.lines.map(p => ({ id: p.id, qty: quote.mode === "quick" ? integer(body.quantity, "quantity", 1, MAX_GUESTS) : p.qty }));
  return { shop, date, time, lines, ...contact(body), selected: normalizeOptions(body, lines) };
}
function fingerprint(data) { return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex"); }
async function availableSlots(date, shopId, quantity, now = new Date()) {
  if (!validDate(date)) throw new AppError(400, "invalid_datetime");
  const shop = shopFor(shopId); const qty = integer(quantity, "quantity", 1, MAX_GUESTS);
  await assertWritable();
  const inventory = await Slot.find({ shopId: String(shop.id), date }).lean();
  return timeSlots.map(slot => {
    const used = inventory.find(row => row.time === slot.time)?.reserved || 0;
    const remaining = Math.max(0, slot.maxGuests - used);
    const reason = !isBookableDate(date, now) ? "past_date" : remaining < qty ? "full" : null;
    return { time: slot.time, remaining, isFull: remaining < qty, isAvailable: reason === null, reason };
  });
}
async function changeCapacity(booking, delta, session) {
  if (!delta || booking.date < tokyoDate()) return;
  const slot = timeSlots.find(s => s.time === booking.time);
  if (!slot || !validDate(booking.date)) throw new AppError(409, "legacy_booking_review");
  const filter = { shopId: String(booking.shopId), date: booking.date, time: booking.time };
  // The unique index serializes first creation of an empty slot. Duplicate-key races retry the whole transaction.
  await Slot.updateOne(filter, { $setOnInsert: { capacity: slot.maxGuests, reserved: 0 } }, { upsert: true, session });
  const condition = delta > 0 ? { reserved: { $lte: slot.maxGuests - delta } } : { reserved: { $gte: -delta } };
  const changed = await Slot.updateOne({ ...filter, ...condition }, { $inc: { reserved: delta } }, { session });
  if (changed.modifiedCount !== 1) throw new AppError(409, delta > 0 ? "slot_full" : "inventory_mismatch");
}
async function transaction(work) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await mongoose.connection.transaction(work); }
    catch (error) {
      if (error.code === 11000 && attempt < 4) continue;
      if (error instanceof AppError) throw error;
      console.error(JSON.stringify({ event: "booking_transaction_failed", ...safeErrorDetails(error) }));
      const wrapped = new AppError(503, "booking_unavailable"); wrapped.cause = error; throw wrapped;
    }
  }
}
async function createBooking({ body, owner, language, now }) {
  const quote = readQuote(body.quote, owner);
  const data = requestData(body, quote);
  const requestHash = fingerprint(data);
  const repeated = await Booking.findOne({ requestKey: quote.key, owner }).select("+requestHash").lean();
  if (repeated) {
    if (repeated.requestHash !== requestHash) throw new AppError(409, "request_changed");
    return repeated;
  }
  if (Date.now() - quote.issuedAt > 24 * 3600000) throw new AppError(409, "quote_expired");
  await assertWritable();
  return transaction(async session => {
    const existing = await Booking.findOne({ requestKey: quote.key, owner }).select("+requestHash").session(session);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new AppError(409, "request_changed");
      return existing;
    }
    const slot = timeSlots.find(s => s.time === data.time);
    if (!slot) throw new AppError(400, "invalid_slot");
    if (!isBookableDate(data.date, now || new Date())) throw new AppError(409, "past_date");
    const priced = await priceLines(data.lines, language, session);
    if (priced.lines.some(p => quote.lines.find(q => q.id === p.id)?.price !== p.price) ||
        options.some(o => o.price !== quote.optionPrices[o.id])) {
      const error = new AppError(409, "price_changed"); error.priced = priced; error.quote = quote; throw error;
    }
    const guests = [];
    for (const p of priced.lines) {
      for (let i = 1; i <= p.qty; i++) {
        const selected = data.selected["options_" + p.id + "_" + i].map(id => options.find(o => o.id === id));
        guests.push({ planId: p.id, planName: p.title, price: p.price + selected.reduce((sum, o) => sum + o.price, 0),
          guestIndex: guests.length + 1, selectedOptions: selected.map(o => o.name) });
      }
    }
    const booking = new Booking({
      fullname: data.fullname, email: data.email, phone: data.phone, shopId: String(data.shop.id), shopName: data.shop.name,
      date: data.date, time: data.time, timeZone: TIME_ZONE, startsAt: arrivalInstant(data.date, data.time),
      guestCount: guests.length, guests, totalPrice: guests.reduce((sum, g) => sum + g.price, 0),
      planName: priced.lines.map(p => p.title).join(", "), bookingCode: "KK-" + tokyoDate(now || new Date()).replaceAll("-", "") + "-" + crypto.randomBytes(6).toString("hex").toUpperCase(),
      status: "Mới", statusHistory: [{ to: "Mới", note: "Đơn được tạo từ website.", changedBy: "Website" }],
      language, owner, requestKey: quote.key, requestHash,
    });
    if (!isBookableDate(data.date, now || new Date())) throw new AppError(409, "past_date");
    await changeCapacity(booking, guests.length, session);
    await booking.save({ session });
    const jobs = [{ key: "confirmation:customer:" + booking._id, type: "email", payload: { bookingId: String(booking._id), kind: "confirmation", audience: "customer" } }];
    jobs.push({ key: "confirmation:admin:" + booking._id, type: "email", payload: { bookingId: String(booking._id), kind: "confirmation", audience: "admin" } });
    await Job.create(jobs, { session, ordered: true });
    return booking;
  });
}
async function updateBooking(id, change) {
  if (!mongoose.isObjectIdOrHexString(id)) throw new AppError(400, "invalid_booking");
  await assertWritable();
  return transaction(async session => {
    const booking = await Booking.findById(id).session(session);
    if (!booking) throw new AppError(404, "booking_not_found");
    const before = occupies(booking) ? guestCount(booking) : 0;
    if (change.status != null) {
      if (!STATUSES.includes(change.status)) throw new AppError(400, "invalid_status");
      if (booking.status !== change.status) booking.statusHistory.push({ from: booking.status, to: change.status, note: change.note || "", changedBy: "Admin" });
      booking.status = change.status;
      booking.cancelledAt = change.status === "Đã hủy" ? new Date() : undefined;
    }
    if (change.archive != null) {
      booking.archivedAt = change.archive ? new Date() : undefined;
      booking.notes.push({ content: change.archive ? "Đơn được lưu trữ khỏi danh sách vận hành." : "Đơn được khôi phục vào danh sách vận hành.", createdBy: "Admin" });
    }
    const after = occupies(booking) ? guestCount(booking) : 0;
    await changeCapacity(booking, after - before, session);
    await booking.save({ session });
    return booking;
  });
}
module.exports = { ACTIVE, STATUSES, MAX_GUESTS, localized, ownerKey, guestCount, occupies, shopFor, findPlan,
  priceLines, issueQuote, readQuote, availableSlots, createBooking, updateBooking, assertWritable, changeCapacity };
