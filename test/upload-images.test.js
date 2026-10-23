const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { prepareImage, storageUploadError } = require("../services/upload-images");
const { cloudinaryConfiguration } = require("../lib/cloudinary-config");
const { safeErrorDetails } = require("../lib/errors");

test("phone photos are optimized before publishing", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kokoro-image-test-"));
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const photo = await sharp({ create: { width: 6000, height: 4000, channels: 3, background: "red" } }).jpeg().toBuffer();
  await t.test("24 MP JPEG accepted and resized to a web image", async () => {
    const input = path.join(directory, "phone.jpg"); await fs.writeFile(input, photo);
    const output = await prepareImage(input);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, "webp"); assert.equal(metadata.width, 2560);
    assert.ok(metadata.height <= 2560); assert.ok((await fs.stat(output)).size < photo.length);
  });
  await t.test("EXIF orientation is applied before resizing and transparency is retained", async () => {
    const input = path.join(directory, "rotated.jpg");
    await sharp({ create: { width: 120, height: 80, channels: 3, background: "blue" } })
      .withMetadata({ orientation: 6 }).jpeg().toFile(input);
    const rotated = await sharp(await prepareImage(input)).metadata();
    assert.equal(rotated.width, 80); assert.equal(rotated.height, 120); assert.equal(rotated.orientation, undefined);
    const png = path.join(directory, "transparent.png");
    await sharp({ create: { width: 20, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(png);
    assert.equal((await sharp(await prepareImage(png)).metadata()).hasAlpha, true);
  });
  await t.test("corrupt and extreme-resolution images get validation errors rather than storage failures", async () => {
    const fake = path.join(directory, "fake.png"); await fs.writeFile(fake, "<script>alert(1)</script>");
    await assert.rejects(prepareImage(fake), error => error.status === 400 && error.code === "invalid_image");
    const huge = Buffer.from(photo);
    // Alter only JPEG's dimensions to verify the pixel guard without allocating a huge bitmap.
    let offset = 2, found = false;
    while (offset < huge.length - 9) {
      if (huge[offset] !== 0xff) break;
      const marker = huge[offset + 1];
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        huge.writeUInt16BE(10000, offset + 5); huge.writeUInt16BE(10000, offset + 7); found = true; break;
      }
      const length = huge.readUInt16BE(offset + 2);
      offset += length + 2;
    }
    assert.equal(found, true);
    const oversized = path.join(directory, "huge.jpg"); await fs.writeFile(oversized, huge);
    await assert.rejects(prepareImage(oversized), error => error.status === 400 && error.code === "image_dimensions_too_large");
  });
});
test("storage errors expose useful categories without provider messages or credentials", () => {
  for (const [source, code, status] of [
    [{ http_code: 401, message: "Invalid Signature secret-private" }, "upload_auth_failed", 503],
    [{ error: { http_code: 403, message: "private-details" } }, "upload_auth_failed", 503],
    [new Error("Must supply api_secret"), "upload_not_configured", 503],
    [{ http_code: 400, message: "File size too large. Got 1111. Maximum is 999" }, "upload_too_large", 413],
    [{ http_code: 420, message: "rate" }, "upload_service_limit", 503],
    [{ http_code: 400, message: "bad image" }, "upload_rejected", 400],
    [Object.assign(new Error("private-host"), { code: "ETIMEDOUT" }), "upload_failed", 503],
  ]) {
    const result = storageUploadError(source);
    assert.equal(result.code, code); assert.equal(result.status, status);
    assert.equal(result.message, code);
    assert.doesNotMatch(JSON.stringify(safeErrorDetails(result)), /secret-private|private-details|private-host/);
  }
});
test("Cloudinary supports the standard and legacy API secret variable names", () => {
  const modern = cloudinaryConfiguration({ CLOUDINARY_CLOUD_NAME: " test ", CLOUDINARY_API_KEY: " key ", CLOUDINARY_API_SECRET: " secret " });
  assert.deepEqual(modern, { cloud_name: "test", api_key: "key", api_secret: "secret", secure: true });
  assert.equal(cloudinaryConfiguration({ CLOUDINARY_SECRET: "legacy-secret" }).api_secret, "legacy-secret");
});
