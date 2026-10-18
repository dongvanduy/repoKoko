const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const multer = require("multer");
const sharp = require("sharp");
const cloudinary = require("cloudinary").v2;
const { adminUploadFileFilter } = require("./admin-csrf");
const { AppError } = require("../lib/errors");
const storage = multer.diskStorage({
  destination(req, file, done) {
    req.uploadDirectoryPromise ||= fs.mkdtemp(path.join(os.tmpdir(), "kokoro-upload-"));
    req.uploadDirectoryPromise.then(dir => done(null, dir), done);
  },
  filename(req, file, done) { done(null, crypto.randomUUID()); },
});
const upload = multer({ storage, fileFilter: adminUploadFileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 10, fields: 40, parts: 50, fieldSize: 100 * 1024, fieldNameSize: 100 },
});
async function removeTemporaryFiles(req) {
  if (!req.uploadDirectoryPromise) return;
  const dir = await req.uploadDirectoryPromise;
  const root = path.resolve(os.tmpdir());
  const resolved = path.resolve(dir);
  if (path.dirname(resolved) !== root || !path.basename(resolved).startsWith("kokoro-upload-")) throw new Error("invalid_upload_directory");
  await fs.rm(resolved, { recursive: true, force: true });
}
function cleanup(req) {
  return req.uploadCleanupPromise ||= removeTemporaryFiles(req);
}
function manageUploads(req, res, next) {
  const clean = () => cleanup(req).catch(() => console.error(JSON.stringify({ event: "upload_cleanup_failed" })));
  res.once("finish", clean); res.once("close", clean);
  next();
}
async function publishUploads(req, res, next) {
  const files = req.file ? [req.file] : req.files || [];
  const published = [];
  try {
    const { fileTypeFromFile } = await import("file-type");
    for (const file of files) {
      const kind = await fileTypeFromFile(file.path);
      if (!kind || !["image/jpeg", "image/png", "image/webp"].includes(kind.mime)) throw new AppError(400, "invalid_image");
      const metadata = await sharp(file.path, { limitInputPixels: 20000000 }).metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages || 1) > 1) throw new AppError(400, "invalid_image");
    }
    for (const file of files) {
      if (req.aborted || res.destroyed) throw new AppError(400, "upload_aborted");
      const result = await cloudinary.uploader.upload(file.path, { folder: "kokoro_shop", resource_type: "image", timeout: 30000 });
      published.push(result.public_id);
      file.path = result.secure_url;
    }
    next();
  } catch (error) {
    await Promise.allSettled(published.map(id => cloudinary.uploader.destroy(id)));
    next(error instanceof AppError ? error : new AppError(503, "upload_failed"));
  } finally { await cleanup(req).catch(() => {}); }
}
module.exports = { upload, manageUploads, publishUploads, cleanup };
