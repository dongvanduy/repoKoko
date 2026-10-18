const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assertAssetsBuilt } = require("../lib/assets");

test("incomplete deployment fails with an actionable asset error", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kokoro-assets-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => assertAssetsBuilt(directory), error => error.code === "ASSETS_NOT_BUILT" && /npm run build/.test(error.message));
  fs.writeFileSync(path.join(directory, "manifest.json"), '{"site.css":"missing.css"}');
  assert.throws(() => assertAssetsBuilt(directory), error => error.code === "ASSETS_NOT_BUILT");
});

test("EJS helpers are available before request middleware runs", async () => {
  process.env.NODE_ENV = "test";
  const { app } = require("../server");
  assert.equal(typeof app.locals.asset, "function");
  assert.equal(typeof app.locals.responsiveImage, "function");
  assert.equal(typeof app.locals.jsonLd, "function");
  // app.render bypasses request middleware, as an early error/render path can.
  const html = await new Promise((resolve, reject) => app.render("error", {
    message: "Temporary failure", locale: "en", ui: require("../lib/messages").messages("en")
  }, (error, html) => error ? reject(error) : resolve(html)));
  assert.match(html, /\/assets\/site\.[a-f0-9]+\.css/);
  assert.doesNotMatch(html, /cdn\.tailwindcss/);
});
