// Preserve the original account defaults for installations that only set CLOUDINARY_SECRET.
function cloudinaryConfiguration(env = process.env) {
  return {
    cloud_name: env.CLOUDINARY_CLOUD_NAME?.trim() || "dgpfqmncu",
    api_key: env.CLOUDINARY_API_KEY?.trim() || "324438863362332",
    api_secret: (env.CLOUDINARY_API_SECRET || env.CLOUDINARY_SECRET || "").trim(),
    secure: true,
  };
}
module.exports = { cloudinaryConfiguration };
