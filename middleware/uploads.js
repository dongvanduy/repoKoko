const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const multer = require("multer");
const { prepareImage, storageUploadError } = require("../services/upload-images");
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
  // File bytes are unrestricted here; keep multipart counts and text-field limits.
  limits: { files: 10, fields: 40, parts: 50, fieldSize: 100 * 1024, fieldNameSize: 100 },
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
    const preparedFiles = [];
    for (const file of files) {
      if (req.aborted || res.destroyed) throw new AppError(400, "upload_aborted");
      preparedFiles.push({ file, path: await prepareImage(file.path) });
    }
    for (const prepared of preparedFiles) {
      const file = prepared.file;
      if (req.aborted || res.destroyed) throw new AppError(400, "upload_aborted");
      const result = await cloudinary.uploader.upload(prepared.path, { folder: "kokoro_shop", resource_type: "image", timeout: 120000 });
      published.push(result.public_id);
      file.path = result.secure_url;
    }
    next();
  } catch (error) {
    await Promise.allSettled(published.map(id => cloudinary.uploader.destroy(id)));
    next(storageUploadError(error));
  } finally { await cleanup(req).catch(() => {}); }
}
module.exports = { upload, manageUploads, publishUploads, cleanup };
