const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
require("../services/login-readiness").checkLoginReadiness()
  .then(() => console.log("Login readiness OK: /login returns 200, session cookie and CSRF token are present. No credentials submitted."))
  .catch(error => {
    console.error(/^LOGIN_/.test(error.code || "") ? error.message : "Login readiness check failed.");
    process.exitCode = 1;
  });
