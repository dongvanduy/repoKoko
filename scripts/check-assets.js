const fs = require("node:fs");
const path = require("node:path");
const directory = path.join(__dirname, "../public/assets");
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  for (const name of ["logo-320.webp", "logo-640.webp", "favicon.png", "site.css", "booking-slots.js", "booking-total.js", "site.js", "lucide.min.js", "swiper-bundle.min.js", "swiper-bundle.min.css"]) {
    if (!manifest[name] || !fs.existsSync(path.join(directory, manifest[name]))) throw new Error("missing");
  }
} catch {
  console.error("Assets are missing. Run npm ci (including devDependencies), then npm run build before starting.");
  process.exitCode = 1;
}
