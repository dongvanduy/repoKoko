const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
try {
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && (minor < 13 || (minor === 13 && patch < 1)))) throw new Error("Use Node.js >= 22.13.1.");
  require("../lib/config").validateConfig();
  require("../lib/assets").assertAssetsBuilt();
  console.log("Application files, built assets and required configuration are ready. Database/proxy connectivity was not checked.");
  console.log("Restart the Node process from this release directory to load the updated JavaScript.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
