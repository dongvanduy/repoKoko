const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
const cloudinary = require("cloudinary").v2;
const { cloudinaryConfiguration } = require("../lib/cloudinary-config");
const { storageUploadError } = require("../services/upload-images");
async function main() {
  const configuration = cloudinaryConfiguration();
  if (!configuration.api_secret) throw storageUploadError(new Error("Must supply api_secret"));
  cloudinary.config(configuration);
  await cloudinary.api.ping({ timeout: 10000 });
  console.log("Cloudinary check OK: connection and authentication verified. No image was uploaded.");
  console.log("This checks the shell/.env configuration. Restart PM2 after changing credentials.");
}
main().catch(error => {
  const safe = storageUploadError(error);
  console.error("Cloudinary check failed: " + safe.code + ". No image was uploaded; credentials are not printed.");
  process.exitCode = 1;
});
