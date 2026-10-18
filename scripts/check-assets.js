try {
  require("../lib/assets").assertAssetsBuilt();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
