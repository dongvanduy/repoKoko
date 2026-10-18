const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const sharp = require("sharp");
const root = path.resolve(__dirname, ".."), out = path.join(root, "public/assets");
fs.mkdirSync(out, { recursive: true });
const manifest = {};
function publish(name, bytes) {
  const ext = path.extname(name), base = name.slice(0, -ext.length);
  const filename = base + "." + crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 12) + ext;
  fs.writeFileSync(path.join(out, filename), bytes); manifest[name] = filename;
}
async function build() {
  const css = path.join(out, "build.css");
  execFileSync(process.execPath, [require.resolve("tailwindcss/lib/cli.js"), "-i", "public/css/input.css", "-o", css, "--minify"], { cwd: root, stdio: "inherit" });
  publish("site.css", fs.readFileSync(css)); fs.unlinkSync(css);
  for (const name of fs.readdirSync(path.join(root, "public/js"))) if (name.endsWith(".js")) publish(name, fs.readFileSync(path.join(root, "public/js", name)));
  for (const [name, source] of [
    ["lucide.min.js", "node_modules/lucide/dist/umd/lucide.min.js"],
    ["swiper-bundle.min.js", "node_modules/swiper/swiper-bundle.min.js"],
    ["swiper-bundle.min.css", "node_modules/swiper/swiper-bundle.min.css"],
  ]) publish(name, fs.readFileSync(path.join(root, source)));
  for (const width of [320, 640]) {
    publish("logo-" + width + ".webp", await sharp(path.join(root, "public/img/common/logo.svg")).resize({ width }).webp({ quality: 85 }).toBuffer());
  }
  publish("favicon.png", await sharp(path.join(root, "public/img/common/logo.svg")).resize({ width: 64 }).png().toBuffer());
  for (const name of fs.readdirSync(path.join(root, "public/img/gallery")).filter(x => x.endsWith(".jpg"))) {
    for (const width of [400, 800]) {
      const buffer = await sharp(path.join(root, "public/img/gallery", name)).resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      publish("gallery-" + path.basename(name, ".jpg") + "-" + width + ".webp", buffer);
    }
  }
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("Built " + Object.keys(manifest).length + " versioned assets.");
}
build().catch(e => { console.error(e.message); process.exitCode = 1; });
