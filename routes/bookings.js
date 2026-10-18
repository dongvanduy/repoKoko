const Booking = require("../models/booking");
const booking = require("../services/bookings");
const { requireCsrf, csrfToken, rateLimit } = require("../middleware/security");
const { bookingCalendar, validDate } = require("../lib/time");
const { text, integer } = require("../lib/validation");
const { AppError } = require("../lib/errors");
const { errorMessage } = require("../lib/messages");
const { shops, options } = require("../data");
const saveSession = req => new Promise((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
function selectedFields(body) {
  return Object.entries(body).filter(([key]) => key.startsWith("plan_")).map(([key, qty]) => ({
    id: key.slice(5), qty: integer(qty, "quantity", 0, booking.MAX_GUESTS),
  })).filter(p => p.qty > 0);
}
function formValues(body = {}) {
  return Object.fromEntries(["fullname", "email", "phone", "date", "time"].map(key => [key, typeof body[key] === "string" ? body[key].slice(0, 254) : ""]));
}
function registerBookingRoutes(app, { getVisiblePlans }) {
  app.get("/plan/:id", async (req, res) => {
    const plan = await booking.findPlan(req.params.id);
    const priced = await booking.priceLines([{ id: String(plan._id), qty: 1 }], req.getLocale());
    const quote = booking.issueQuote(priced, booking.ownerKey(req.sessionID), "quick");
    res.set("Cache-Control", "no-store").render("detail", {
      plan, pageTitle: booking.localized(plan.title, req.getLocale()), quote,
      selectedShopId: shops[0].id, calendar: bookingCalendar(), csrfToken: csrfToken(req),
    });
  });
  app.get("/booking-step1", async (req, res) => {
    res.set("Cache-Control", "no-store").render("booking_step1", {
      plans: await getVisiblePlans(), csrfToken: csrfToken(req), pageTitle: res.__("titles.booking_step1"),
    });
  });
  app.post("/booking-step2", requireCsrf, async (req, res) => {
    const priced = await booking.priceLines(selectedFields(req.body), req.getLocale());
    const quote = booking.issueQuote(priced, booking.ownerKey(req.sessionID));
    res.set("Cache-Control", "no-store").render("booking_step2", {
      selectedPlans: priced.lines, totalQuantity: priced.totalQuantity, totalPrice: priced.totalPrice,
      shop: shops[0], quote, csrfToken: csrfToken(req), calendar: bookingCalendar(), pageTitle: res.__("titles.booking_step2"),
    });
  });
  app.get("/api/available-slots", rateLimit("slots", 120, 60000), async (req, res) => {
    res.set("Cache-Control", "no-store").json(await booking.availableSlots(req.query.date, req.query.shopId, req.query.totalQuantity));
  });
  function review(req, res, priced, signedQuote, status = 200, code = "", body = req.body, mode = "multi") {
    const shop = booking.shopFor(body.shopId);
    return res.status(status).set("Cache-Control", "no-store").render("booking_step3", {
      plansData: priced.lines, shop, bookingInfo: { date: validDate(body.date) ? body.date : bookingCalendar().tomorrow, time: typeof body.time === "string" ? body.time : "", totalQuantity: priced.totalQuantity },
      options, baseTotal: priced.totalPrice, quote: signedQuote, csrfToken: csrfToken(req), calendar: bookingCalendar(),
      values: formValues(body), selectedOptions: body, error: code ? errorMessage(code, req.getLocale()) : "",
      action: mode === "quick" ? "/booking" : "/booking-finish", pageTitle: res.__("titles.booking_step3"),
    });
  }
  app.post("/booking-step3", requireCsrf, async (req, res) => {
    const quote = booking.readQuote(req.body.quote, booking.ownerKey(req.sessionID));
    if (quote.mode !== "multi") throw new AppError(400, "invalid_quote");
    const priced = await booking.priceLines(quote.lines, req.getLocale());
    const slots = await booking.availableSlots(req.body.date, req.body.shopId, priced.totalQuantity);
    const slot = slots.find(s => s.time === req.body.time);
    if (!slot) throw new AppError(400, "invalid_slot");
    const changed = priced.lines.some(p => quote.lines.find(q => q.id === p.id)?.price !== p.price);
    const code = changed ? "price_changed" : !slot.isAvailable ? (slot.reason === "full" ? "slot_full" : slot.reason) : "";
    review(req, res, priced, booking.issueQuote(priced, quote.owner, "multi", quote.key), code ? 409 : 200, code);
  });
  const save = async (req, res, next) => {
    try {
      const owner = booking.ownerKey(req.sessionID);
      const result = await booking.createBooking({ body: req.body, owner, language: req.getLocale() });
      await saveSession(req);
      res.redirect(303, "/booking-success/" + encodeURIComponent(result.bookingCode));
    } catch (error) {
      if (error instanceof AppError && [400, 409, 503].includes(error.status)) {
        try {
          const quote = booking.readQuote(req.body.quote, booking.ownerKey(req.sessionID));
          const lines = quote.lines.map(p => ({ id: p.id, qty: quote.mode === "quick" ? integer(req.body.quantity, "quantity", 1, booking.MAX_GUESTS) : p.qty }));
          const priced = await booking.priceLines(lines, req.getLocale());
          // A failed submission may display a new quote; the customer must explicitly submit it again.
          return review(req, res, priced, booking.issueQuote(priced, quote.owner, quote.mode, quote.key), error.status, error.code, req.body, quote.mode);
        } catch { /* Fall through to a safe, localized error page. */ }
      }
      next(error);
    }
  };
  app.post("/booking", requireCsrf, rateLimit("booking", 10, 600000), save);
  app.post("/booking-finish", requireCsrf, rateLimit("booking", 10, 600000), save);
  app.get("/booking-success/:code", async (req, res) => {
    const code = text(req.params.code, "code", 64);
    const result = await Booking.findOne({ bookingCode: code, owner: booking.ownerKey(req.sessionID) }).lean();
    if (!result) throw new AppError(404, "not_found");
    res.set("Cache-Control", "no-store").render("success", { info: result });
  });
}
module.exports = { registerBookingRoutes, selectedFields };
