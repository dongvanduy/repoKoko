const { test } = require("node:test");
const assert = require("node:assert/strict");
const { languageReturnPath } = require("../lib/navigation");
const site = "https://kokorokimono.com";

test("missing or invalid Referer returns home, never /undefined", () => {
  for (const referrer of [undefined, null, "", "undefined", "not-a-url", [], {}]) {
    assert.equal(languageReturnPath(undefined, referrer, site), "/");
  }
});

test("language switching preserves a local page and removes the old language query", () => {
  assert.equal(languageReturnPath("/blog/kyoto?lang=vi&page=2#photos", undefined, site), "/blog/kyoto?page=2#photos");
  assert.equal(languageReturnPath(undefined, site + "/?lang=vi&utm_source=test", site), "/?utm_source=test");
  assert.equal(languageReturnPath("/plan/123?lang=jp", site + "/blog", site), "/plan/123");
  assert.equal(languageReturnPath(undefined, site, site), "/");
});

test("redirects reject external URLs, unsafe paths and language-switch loops", () => {
  for (const value of ["https://evil.invalid", "//evil.invalid", "/%2f%2fevil.invalid", "/%5cevil.invalid", "/%0d%0aLocation:evil",
    "/change-lang/en", "/CHANGE-LANG/vi", "/change-lang%2fen", "/%E0%A4", ["//evil.invalid"], { value: "/" }]) {
    assert.equal(languageReturnPath(value, undefined, site), "/", String(value));
  }
  for (const referrer of ["https://evil.invalid/path", site + "//evil.invalid", site + "/change-lang/en", "https://user@kokorokimono.com/plan/123"]) {
    assert.equal(languageReturnPath(undefined, referrer, site), "/", referrer);
  }
});
