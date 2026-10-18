const mongoose = require("mongoose");
const Booking = require("../models/booking");
const Slot = require("../models/SlotInventory");
const Config = require("../models/Config");
const { timeSlots, shops } = require("../data");
const { arrivalInstant, tokyoDate } = require("../lib/time");
const { occupies, guestCount } = require("./bookings");
async function migrateBookings({ apply = false, now = new Date() } = {}) {
  const report = { scanned: 0, valid: 0, issues: [], blockers: [], slots: 0 };
  const inventory = new Map(), updates = [];
  for await (const b of Booking.find().lean().cursor()) {
    report.scanned++;
    let startsAt;
    try { startsAt = arrivalInstant(b.date, b.time); }
    catch { report.issues.push({ id: String(b._id), reason: "invalid_datetime" }); if (occupies(b)) report.blockers.push(String(b._id)); continue; }
    const quantity = guestCount(b);
    if (!Number.isSafeInteger(quantity) || quantity < 1) { report.issues.push({ id: String(b._id), reason: "invalid_guest_count" }); if (occupies(b)) report.blockers.push(String(b._id)); continue; }
    updates.push({ updateOne: { filter: { _id: b._id }, update: { $set: { timeZone: "Asia/Tokyo", startsAt, guestCount: quantity } } } });
    report.valid++;
    if (occupies(b) && b.date >= tokyoDate(now)) {
      const slot = timeSlots.find(s => s.time === b.time), shop = shops.find(s => String(s.id) === String(b.shopId));
      if (!slot || !shop) { report.issues.push({ id: String(b._id), reason: "unconfigured_slot_or_shop" }); report.blockers.push(String(b._id)); continue; }
      const key = String(b.shopId) + ":" + b.date + ":" + b.time;
      const row = inventory.get(key) || { shopId: String(b.shopId), date: b.date, time: b.time, capacity: slot.maxGuests, reserved: 0 };
      row.reserved += quantity; inventory.set(key, row);
    }
  }
  report.slots = inventory.size;
  for (const [key, row] of inventory) if (row.reserved > row.capacity) report.issues.push({ slot: key, reason: "existing_over_capacity", reserved: row.reserved });
  if (apply) {
    if (process.env.BOOKING_WRITES_ENABLED !== "false") throw new Error("Stop all booking writers and set BOOKING_WRITES_ENABLED=false before applying.");
    if (report.blockers.length) throw Object.assign(new Error("Active legacy bookings need review. No migration applied."), { report });
    await Config.updateOne({ key: "booking_inventory_v1" }, { $set: { value: { ready: false } } }, { upsert: true });
    await Slot.init();
    // Writes are paused operationally. Keeping the marker false makes interruption safe to rerun.
    for (let i = 0; i < updates.length; i += 100) await Booking.bulkWrite(updates.slice(i, i + 100));
    await Slot.deleteMany({});
    if (inventory.size) await Slot.insertMany([...inventory.values()]);
    await Config.updateOne({ key: "booking_inventory_v1" }, { $set: { value: { ready: true, migratedAt: new Date(), scanned: report.scanned } } });
  }
  return report;
}
module.exports = { migrateBookings };
