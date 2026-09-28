const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const express = require("express");
const multer = require("multer");
const { requireAdminCsrf, adminUploadFileFilter } = require("../middleware/admin-csrf");

const token = "a".repeat(64);

test("admin CSRF handles real multipart and regular form requests", async (t) => {
  const app = express();
  let storedFiles = 0;
  let savedRequests = 0;
  const memoryStorage = multer.memoryStorage();
  const upload = multer({
    fileFilter: adminUploadFileFilter,
    storage: {
      _handleFile(req, file, callback) {
        storedFiles += 1;
        memoryStorage._handleFile(req, file, callback);
      },
      _removeFile: memoryStorage._removeFile.bind(memoryStorage),
    },
  });
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.session = req.get("x-test-no-session") ? undefined : { adminCsrfToken: token };
    next();
  });
  const save = (req, res) => {
    savedRequests += 1;
    res.json({ title: req.body.title, files: req.file ? 1 : (req.files || []).length });
  };

  // Use the production route middleware lists, without starting the database,
  // scheduler, translations, or Cloudinary.
  const source = readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const routes = [
    ["/admin/plan/save", "photos", 2],
    ["/admin/blog/save", "thumbnail_file", 1],
    ["/admin/config/save", "hero_photos", 2],
  ];
  for (const [route] of routes) {
    const start = source.indexOf('  "' + route + '",');
    assert.ok(start >= 0);
    const middlewareStart = source.indexOf("\n", start) + 1;
    const middlewareEnd = source.indexOf("  async (req, res)", middlewareStart);
    assert.ok(middlewareEnd > middlewareStart);
    const middleware = new Function("requireLogin", "upload", "requireAdminCsrf",
      "return [" + source.slice(middlewareStart, middlewareEnd) + "];"
    )((req, res, next) => next(), upload, requireAdminCsrf);
    app.post(route, ...middleware, save);
  }
  app.post("/regular", requireAdminCsrf, save);
  app.use((error, req, res, next) => res.status(error.status || 500).send(error.code || error.message));

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const base = "http://127.0.0.1:" + server.address().port;

  function form(field, { csrf = token, files = 1, lateToken = false, duplicate = false } = {}) {
    const body = new FormData();
    if (csrf !== null && !lateToken) body.append("csrfToken", csrf);
    if (duplicate) body.append("csrfToken", token);
    body.append("title", "Test plan");
    for (let i = 0; i < files; i++) {
      body.append(field, new Blob(["test image"], { type: "image/png" }), "test.png");
    }
    if (lateToken) body.append("csrfToken", csrf);
    return body;
  }

  for (const [route, field, files] of routes) {
    await t.test(route + " accepts valid token with images", async () => {
      const response = await fetch(base + route, { method: "POST", body: form(field, { files }) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { title: "Test plan", files });
    });
    await t.test(route + " accepts valid token without a new image", async () => {
      const response = await fetch(base + route, { method: "POST", body: form(field, { files: 0 }) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).files, 0);
    });
  }

  const rejected = [
    ["missing token", { csrf: null }],
    ["wrong token", { csrf: "b".repeat(64) }],
    ["short token", { csrf: "bad" }],
    ["empty token", { csrf: "" }],
    ["duplicate token", { duplicate: true }],
    ["token after file", { lateToken: true }],
    ["no token and no file", { csrf: null, files: 0 }],
  ];
  for (const [label, options] of rejected) {
    await t.test(label + " is rejected before storage or save", async () => {
      const before = { storedFiles, savedRequests };
      const response = await fetch(base + "/admin/plan/save", {
        method: "POST", body: form("photos", options),
      });
      assert.equal(response.status, 403);
      await response.text();
      assert.deepEqual({ storedFiles, savedRequests }, before);
    });
  }

  await t.test("missing session is rejected before storage", async () => {
    const before = { storedFiles, savedRequests };
    const response = await fetch(base + "/admin/plan/save", {
      method: "POST", headers: { "x-test-no-session": "1" }, body: form("photos"),
    });
    assert.equal(response.status, 403);
    await response.text();
    assert.deepEqual({ storedFiles, savedRequests }, before);
  });

  await t.test("undefined body returns 403 instead of throwing", async () => {
    const response = await fetch(base + "/regular", { method: "POST" });
    assert.equal(response.status, 403);
    assert.equal(await response.text(), "Yêu cầu không hợp lệ.");
  });
  await t.test("regular URL-encoded forms still work", async () => {
    const response = await fetch(base + "/regular", {
      method: "POST", body: new URLSearchParams({ csrfToken: token, title: "Test plan" }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).title, "Test plan");
  });
});
