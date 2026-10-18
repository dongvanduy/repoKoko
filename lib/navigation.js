// Only redirect to local paths. Referer is optional and must never be coerced from undefined.
function localPath(url, origin) {
  if (url.origin !== origin || url.username || url.password) return null;
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return null; }
  if (!pathname.startsWith("/") || pathname.startsWith("//") || /[\\\\\u0000-\u001f\u007f]/.test(pathname) ||
      /^\/change-lang(?:\/|$)/i.test(pathname)) return null;
  url.searchParams.delete("lang");
  return url.pathname + url.search + url.hash;
}
function languageReturnPath(returnTo, referrer, siteUrl) {
  const base = new URL(siteUrl);
  if (typeof returnTo === "string" && returnTo.startsWith("/") && !returnTo.startsWith("//") &&
      !/[\\\\\u0000-\u001f\u007f]/.test(returnTo)) {
    try {
      const target = localPath(new URL(returnTo, base), base.origin);
      if (target) return target;
    } catch {}
  }
  if (typeof referrer === "string" && referrer.trim() && !/[\\\\\u0000-\u001f\u007f]/.test(referrer)) {
    try {
      const target = localPath(new URL(referrer), base.origin);
      if (target) return target;
    } catch {}
  }
  return "/";
}
module.exports = { languageReturnPath };
