const crypto = require("node:crypto");

const invalidRequestMessage = "Yêu cầu không hợp lệ.";

function hasValidAdminCsrf(req) {
  const expected = req.session?.adminCsrfToken;
  const received = req.body?.csrfToken;
  if (typeof expected !== "string" || typeof received !== "string") return false;
  if (!expected || !received.trim()) return false;

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received.trim());
  return (
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

function requireAdminCsrf(req, res, next) {
  if (!hasValidAdminCsrf(req)) return res.status(403).send(invalidRequestMessage);
  next();
}

function adminUploadFileFilter(req, file, callback) {
  // Admin forms put the CSRF field before file fields. Check before storage
  // sends files to Cloudinary, and again after parsing for file-free requests.
  if (!hasValidAdminCsrf(req)) {
    const error = new Error(invalidRequestMessage);
    error.code = "EBADCSRFTOKEN";
    error.status = 403;
    return callback(error);
  }
  callback(null, true);
}

module.exports = { requireAdminCsrf, adminUploadFileFilter };
