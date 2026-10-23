const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");
// Upload files are temporary; cached descriptors must not keep them open after processing.
sharp.cache({ files: 0 });
const { AppError } = require("../lib/errors");
const MAX_INPUT_PIXELS = 64000000;
async function prepareImage(filePath) {
  const { fileTypeFromFile } = await import("file-type");
  const kind = await fileTypeFromFile(filePath);
  if (!kind || !["image/jpeg", "image/png", "image/webp"].includes(kind.mime)) throw new AppError(400, "invalid_image");
  try {
    const metadata = await sharp(filePath, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages || 1) > 1) throw new AppError(400, "invalid_image");
    const preparedPath = path.join(path.dirname(filePath), crypto.randomUUID() + ".webp");
    await sharp(filePath, { limitInputPixels: MAX_INPUT_PIXELS }).autoOrient()
      .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88 }).timeout({ seconds: 30 }).toFile(preparedPath);
    return preparedPath;
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = /pixel limit/i.test(error.message || "") ? "image_dimensions_too_large"
      : error.code || /timeout/i.test(error.message || "") ? "upload_processing_failed" : "invalid_image";
    throw Object.assign(new AppError(code === "upload_processing_failed" ? 503 : 400, code), { cause: error });
  }
}
function storageUploadError(error) {
  if (error instanceof AppError) return error;
  const source = error?.error || error || {};
  const status = source.http_code;
  const message = typeof source.message === "string" ? source.message : "";
  let code = "upload_failed", httpStatus = 503;
  if (/must supply (api_key|api_secret|cloud_name)/i.test(message)) code = "upload_not_configured";
  else if ([401, 403].includes(status) || /invalid (signature|api[_ ]?key|cloud[_ ]?name)|unknown api[_ ]?key|cloud name is disabled/i.test(message)) code = "upload_auth_failed";
  else if (status === 413 || /file size too large|maximum file size|exceeds.*(bytes|size limit)/i.test(message)) { code = "upload_too_large"; httpStatus = 413; }
  else if ([420, 429].includes(status) || /quota|usage limit/i.test(message)) code = "upload_service_limit";
  else if (status === 400) { code = "upload_rejected"; httpStatus = 400; }
  return Object.assign(new AppError(httpStatus, code), { cause: error });
}
module.exports = { prepareImage, storageUploadError, MAX_INPUT_PIXELS };
