const crypto = require("node:crypto");
const helmet = require("helmet");
const RateBucket = require("../models/RateBucket");
const { AppError } = require("../lib/errors");
function csrfToken(req) { return req.session.csrfToken ||= crypto.randomBytes(32).toString("hex"); }
function requireCsrf(req, res, next) {
  const expected = req.session?.csrfToken;
  const received = req.body?.csrfToken;
  if (typeof expected !== "string" || typeof received !== "string" || !/^[a-f0-9]{64}$/.test(received) || received.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))) return next(new AppError(403, "invalid_request"));
  next();
}
async function consumeRate(key, limit, windowMs) {
  const now = Date.now(); const bucket = Math.floor(now / windowMs);
  const id = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(key + ":" + bucket).digest("hex");
  let result;
  try {
    result = await RateBucket.findOneAndUpdate({ _id: id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 1) * windowMs) } }, { upsert: true, returnDocument: "after" }).lean();
  } catch (error) {
    if (error.code !== 11000) throw new AppError(503, "service_unavailable");
    result = await RateBucket.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { returnDocument: "after" }).lean();
  }
  if (!result || result.count > limit) throw new AppError(429, "rate_limited");
  return id;
}
async function releaseRate(id) {
  await RateBucket.updateOne({ _id: id, count: { $gt: 0 } }, { $inc: { count: -1 } });
}
function rateLimit(prefix, limit, windowMs) {
  return async (req, res, next) => {
    try { await consumeRate(prefix + ":" + req.ip, limit, windowMs); next(); } catch (e) { if (e.status === 429) res.set("Retry-After", String(Math.ceil(windowMs / 1000))); next(e); }
  };
}
function headers() {
  return [
    (req, res, next) => { res.locals.cspNonce = crypto.randomBytes(18).toString("base64"); next(); },
    helmet({
      contentSecurityPolicy: {
        reportOnly: process.env.CSP_REPORT_ONLY === "true",
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", (req, res) => "'nonce-" + res.locals.cspNonce + "'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          imgSrc: ["'self'", "data:", "https:"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          frameSrc: ["https://www.google.com", "https://maps.google.com"],
          connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
          upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
        },
      },
      strictTransportSecurity: process.env.NODE_ENV === "production" ? { maxAge: 31536000 } : false,
      crossOriginEmbedderPolicy: false,
    }),
  ];
}
module.exports = { csrfToken, requireCsrf, consumeRate, releaseRate, rateLimit, headers };
