function validateConfig(env = process.env) {
  const missing = ["MONGO_URI", "SESSION_SECRET", "ADMIN_USER", "ADMIN_PASSWORD_HASH"].filter(key => !env[key]?.trim());
  if (missing.length) throw new Error("Missing configuration: " + missing.join(", "));
  if (env.SESSION_SECRET.length < 32 || !env.ADMIN_PASSWORD_HASH.startsWith("$argon2id$")) throw new Error("Use a session secret of at least 32 characters and an Argon2id password hash.");
  if (env.TRUST_PROXY && /^(true|\d+)$/i.test(env.TRUST_PROXY)) throw new Error("TRUST_PROXY must be an explicit IP/CIDR list.");
  let site;
  if (env.SITE_URL) {
    try { site = new URL(env.SITE_URL); } catch {}
    if (!site || /\s/.test(env.SITE_URL) || site.username || site.password || site.search || site.hash || site.pathname !== "/" || !["http:", "https:"].includes(site.protocol)) {
      throw new Error("SITE_URL must be a valid site origin with no spaces or shell commands.");
    }
  }
  if (env.NODE_ENV === "production" && site?.protocol !== "https:") throw new Error("Production requires an HTTPS SITE_URL.");
}
module.exports = { validateConfig };
