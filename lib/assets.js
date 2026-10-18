const fs = require("node:fs");
const path = require("node:path");
const assetDirectory = path.join(__dirname, "../public/assets");
const requiredAssets = ["logo-320.webp", "logo-640.webp", "favicon.png", "site.css", "booking-slots.js", "booking-total.js", "site.js", "lucide.min.js", "swiper-bundle.min.js", "swiper-bundle.min.css"];
function assertAssetsBuilt(directory = assetDirectory) {
  try {
    const built = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
    for (const name of requiredAssets) {
      const filename = built[name];
      if (typeof filename !== "string" || path.basename(filename) !== filename || !fs.statSync(path.join(directory, filename)).isFile()) throw new Error("missing_asset");
    }
    if (directory === assetDirectory) manifest = built;
    return built;
  } catch {
    const error = new Error("Assets are missing or incomplete. Run npm ci --include=dev, then npm run build before restarting the server.");
    error.code = "ASSETS_NOT_BUILT";
    throw error;
  }
}
let manifest = {};
try { manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/assets/manifest.json"), "utf8")); } catch {}
function asset(name) { return "/assets/" + (manifest[name] || name); }
function responsiveImage(src, width = 800) {
  if (typeof src !== "string") return "";
  if (src.startsWith("https://res.cloudinary.com/")) return src.replace("/image/upload/", "/image/upload/f_auto,q_auto,c_limit,w_" + width + "/");
  const base = src.match(/^\/img\/gallery\/(\d+)\.jpg$/)?.[1];
  return base && manifest["gallery-" + base + "-" + width + ".webp"] ? asset("gallery-" + base + "-" + width + ".webp") : src;
}
module.exports = { asset, responsiveImage, assertAssetsBuilt };
