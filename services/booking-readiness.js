function unavailable(code, message) {
  return Object.assign(new Error(message), { code });
}
async function checkBookingReadiness({ client, env = process.env }) {
  if (env.BOOKING_WRITES_ENABLED === "false") {
    throw unavailable("BOOKING_PAUSED", "Bookings are paused: set BOOKING_WRITES_ENABLED=true in the PM2 application environment.");
  }
  const db = client.db();
  const hello = await db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") {
    throw unavailable("TRANSACTIONS_UNSUPPORTED", "MongoDB transactions require a replica set.");
  }
  const marker = await db.collection("configs").findOne(
    { key: "booking_inventory_v1" }, { projection: { _id: 0, "value.ready": 1 }, maxTimeMS: 5000 });
  if (marker?.value?.ready !== true) {
    throw unavailable("INVENTORY_NOT_INITIALIZED", "Booking inventory is not ready. Stop booking writers, back up the data, then run the booking migration before enabling bookings.");
  }
  return { ready: true, transactionsSupported: true, inventoryReady: true };
}
module.exports = { checkBookingReadiness };
