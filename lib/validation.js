const { AppError } = require("./errors");
function text(value, name, max, required = true) {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    if (!required && value == null) return "";
    throw new AppError(400, "invalid_" + name);
  }
  const result = value.trim();
  if (required && !result) throw new AppError(400, "invalid_" + name);
  return result;
}
function integer(value, name, min, max) {
  if (!["string", "number"].includes(typeof value) || !/^\d+$/.test(String(value))) throw new AppError(400, "invalid_" + name);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new AppError(400, "invalid_" + name);
  return n;
}
function contact(body) {
  const fullname = text(body.fullname, "fullname", 120);
  const email = text(body.email, "email", 254);
  const phone = text(body.phone, "phone", 40);
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email) || /[\r\n]/.test(fullname + phone) || !/^[+()\d .-]{6,40}$/.test(phone)) {
    throw new AppError(400, "invalid_contact");
  }
  return { fullname, email, phone };
}
function safeImageUrl(value) {
  if (typeof value !== "string") return "";
  if (/^\/img\/[a-zA-Z0-9_./-]+$/.test(value) && !value.includes("..")) return value;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function jsonForHtml(value) { return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")); }
module.exports = { text, integer, contact, escapeHtml, jsonForHtml, safeImageUrl };
