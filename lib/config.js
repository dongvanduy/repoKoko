const LOOPBACK_PROXIES = ["127.0.0.1/32", "::1/128"];
function trustedProxies(env = process.env) {
  const value = env.TRUST_PROXY?.trim();
  if (!value) return env.NODE_ENV === "production" ? [...LOOPBACK_PROXIES] : false;
  if (value === "false") return false;
  if (/^(true|\d+)$/i.test(value)) throw new Error("TRUST_PROXY must be an explicit IP/CIDR list.");
  const addresses = value.split(",").map(address => address.trim());
  const { isIP } = require("node:net");
  if (addresses.some(address => {
    const [ip, prefix, extra] = address.split("/");
    const version = isIP(ip);
    return !version || extra !== undefined || (prefix !== undefined &&
      (!/^\d+$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)));
  })) throw new Error("TRUST_PROXY must be an explicit IP/CIDR list or false.");
  return addresses;
}
function validateConfig(env = process.env) {
  const missing = ["MONGO_URI", "SESSION_SECRET", "ADMIN_USER", "ADMIN_PASSWORD_HASH"].filter(key => !env[key]?.trim());
  if (missing.length) throw new Error("Missing configuration: " + missing.join(", "));
  if (env.SESSION_SECRET.length < 32 || !env.ADMIN_PASSWORD_HASH.startsWith("$argon2id$")) throw new Error("Use a session secret of at least 32 characters and an Argon2id password hash.");
  trustedProxies(env);
  let site;
  if (env.SITE_URL) {
    try { site = new URL(env.SITE_URL); } catch {}
    if (!site || /\s/.test(env.SITE_URL) || site.username || site.password || site.search || site.hash || site.pathname !== "/" || !["http:", "https:"].includes(site.protocol)) {
      throw new Error("SITE_URL must be a valid site origin with no spaces or shell commands.");
    }
  }
  if (env.NODE_ENV === "production" && site?.protocol !== "https:") throw new Error("Production requires an HTTPS SITE_URL.");
}
module.exports = { validateConfig, trustedProxies };
