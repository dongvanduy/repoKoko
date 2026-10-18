const argon2 = require("argon2");
const { text } = require("../lib/validation");
const { AppError } = require("../lib/errors");
const { csrfToken, requireCsrf, consumeRate, releaseRate } = require("../middleware/security");
const { errorMessage } = require("../lib/messages");
function registerAuthRoutes(app) {
  app.get("/login", (req, res) => res.set("Cache-Control", "no-store").render("login", { error: null, csrfToken: csrfToken(req) }));
  app.post("/login", requireCsrf, async (req, res) => {
    const username = text(req.body.username, "username", 100);
    const password = req.body.password;
    if (typeof password !== "string" || !password || password.length > 512) throw new AppError(400, "invalid_password");
    if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD_HASH) throw new AppError(503, "service_unavailable");
    await consumeRate("login:ip:" + req.ip, 50, 900000);
    const accountAttempt = await consumeRate("login:account:" + req.ip + ":" + username.toLowerCase(), 5, 900000);
    const validPassword = await argon2.verify(process.env.ADMIN_PASSWORD_HASH, password);
    if (username !== process.env.ADMIN_USER || !validPassword) {
      return res.status(401).set("Cache-Control", "no-store").render("login", { error: errorMessage("generic", req.getLocale()), csrfToken: csrfToken(req) });
    }
    await releaseRate(accountAttempt);
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.isAdmin = true;
    await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    res.redirect(303, "/admin");
  });
  app.post("/logout", requireCsrf, async (req, res) => {
    await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    res.clearCookie("kokoro.sid", { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    res.redirect(303, "/login");
  });
}
module.exports = { registerAuthRoutes };
