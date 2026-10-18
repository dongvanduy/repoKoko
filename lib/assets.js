const fs = require("node:fs");
const path = require("node:path");
let manifest = {};
try { manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/assets/manifest.json"), "utf8")); } catch {}
function asset(name) { return "/assets/" + (manifest[name] || name); }
function responsiveImage(src, width = 800) {
  if (typeof src !== "string") return "";
  if (src.startsWith("https://res.cloudinary.com/")) return src.replace("/image/upload/", "/image/upload/f_auto,q_auto,c_limit,w_" + width + "/");
  const base = src.match(/^\/img\/gallery\/(\d+)\.jpg$/)?.[1];
  return base && manifest["gallery-" + base + "-" + width + ".webp"] ? asset("gallery-" + base + "-" + width + ".webp") : src;
}
module.exports = { asset, responsiveImage };
