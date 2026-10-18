class AppError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function safeErrorDetails(error) {
  let source = error;
  for (let i = 0; i < 3 && source?.cause; i++) source = source.cause;
  const details = {};
  if (typeof source?.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(source.name)) details.causeName = source.name;
  const code = source?.code;
  if (typeof code === "number" || (typeof code === "string" && /^[A-Z_0-9]{1,64}$/.test(code))) details.causeCode = code;
  if (source instanceof AppError) details.causeCode = source.code;
  if (typeof source?.http_code === "number") details.upstreamStatus = source.http_code;
  if (source?.message === "Cannot call `create()` with a session and multiple documents unless `ordered: true` is set") details.causeCode = "TRANSACTION_BATCH_REQUIRES_ORDERED";
  return details;
}
function normalizeUploadError(error) {
  if (error.name !== "MulterError") return error;
  const tooLarge = ["LIMIT_FILE_SIZE", "LIMIT_FIELD_VALUE"].includes(error.code);
  const code = error.code === "LIMIT_FILE_SIZE" ? "upload_too_large" : error.code === "LIMIT_FIELD_VALUE" ? "input_too_large" : "upload_limit";
  return Object.assign(new AppError(tooLarge ? 413 : 400, code), { cause: error });
}
module.exports = { AppError, safeErrorDetails, normalizeUploadError };
