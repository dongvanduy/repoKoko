function failure(code, message) { return Object.assign(new Error(message), { code }); }
async function checkLoginReadiness({ siteUrl = process.env.SITE_URL, fetcher = fetch } = {}) {
  let url;
  try { url = new URL("/login", siteUrl); } catch { throw failure("LOGIN_URL_INVALID", "Set a valid SITE_URL before checking login."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw failure("LOGIN_URL_INVALID", "Set a valid SITE_URL before checking login.");
  let response;
  try {
    response = await fetcher(url, { redirect: "manual", headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(10000) });
  } catch { throw failure("LOGIN_UNREACHABLE", "Login check failed: the site could not be reached."); }
  const html = await response.text();
  if (response.status !== 200) throw failure("LOGIN_HTTP_ERROR", "Login check failed: GET /login did not return 200.");
  const cookie = response.headers.getSetCookie().find(value => value.startsWith("kokoro.sid="));
  if (!cookie) throw failure("LOGIN_COOKIE_MISSING", "Login check failed: no session cookie. Check TRUST_PROXY and Nginx X-Forwarded-Proto.");
  if (!/;\s*HttpOnly/i.test(cookie) || !/;\s*SameSite=Lax/i.test(cookie) ||
      ((url.protocol === "https:" || process.env.NODE_ENV === "production") && !/;\s*Secure/i.test(cookie))) {
    throw failure("LOGIN_COOKIE_FLAGS", "Login check failed: session cookie security flags are missing.");
  }
  if (!/name=["']csrfToken["']\s+value=["'][a-f0-9]{64}["']/.test(html)) throw failure("LOGIN_CSRF_MISSING", "Login check failed: the form has no CSRF token.");
  if (!/\bno-store\b/i.test(response.headers.get("cache-control") || "")) throw failure("LOGIN_CACHE_ENABLED", "Login check failed: the login page must not be cached.");
  return { ready: true };
}
module.exports = { checkLoginReadiness };
