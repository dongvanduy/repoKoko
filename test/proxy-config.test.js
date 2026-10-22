const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { trustedProxies, validateConfig } = require("../lib/config");

test("production trusts only local Nginx, ignoring remote spoofed proxy headers", () => {
  const app = express(); app.set("trust proxy", trustedProxies({ NODE_ENV: "production", TRUST_PROXY: "" }));
  const trust = app.get("trust proxy fn");
  for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(trust(ip), true);
  for (const ip of ["127.0.0.2", "198.51.100.1", "10.0.0.1", "192.168.1.1"]) assert.equal(trust(ip), false);
  function request(remoteAddress, headers) {
    const req = Object.create(express.request);
    Object.assign(req, { app, headers, connection: { remoteAddress } });
    return req;
  }
  assert.equal(request("127.0.0.1", { "x-forwarded-proto": "https" }).secure, true);
  assert.equal(request("198.51.100.1", { "x-forwarded-proto": "https" }).secure, false);
  assert.equal(request("127.0.0.1", {}).secure, false);
  assert.equal(request("127.0.0.1", { "x-forwarded-for": "198.51.100.1, 203.0.113.5" }).ip, "203.0.113.5");
  assert.equal(trustedProxies({ NODE_ENV: "development" }), false);
  assert.equal(trustedProxies({ NODE_ENV: "production", TRUST_PROXY: "false" }), false);
});
test("explicit proxy overrides validate IPs and CIDRs, rejecting broad boolean/hop settings", () => {
  const env = { MONGO_URI: "mongodb://example.invalid/test", SESSION_SECRET: "x".repeat(40),
    ADMIN_USER: "admin", ADMIN_PASSWORD_HASH: "$argon2id$test" };
  assert.deepEqual(trustedProxies({ TRUST_PROXY: " 10.0.0.2/32, ::1/128 " }), ["10.0.0.2/32", "::1/128"]);
  for (const value of ["true", "1", " 2 ", "10.0.0.1/33", "::1/129", "localhost", ",", "10.0.0.1/32/0"]) {
    assert.throws(() => validateConfig({ ...env, TRUST_PROXY: value }), /TRUST_PROXY/);
  }
  assert.doesNotThrow(() => validateConfig({ ...env, TRUST_PROXY: "false" }));
});
