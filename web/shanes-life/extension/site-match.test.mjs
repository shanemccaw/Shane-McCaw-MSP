// Real, node-runnable assertions for the one piece of the extension that is plain, portable
// logic and doesn't need a real browser -- the "real matching logic" #3243 flagged as an open
// question (see lib/site-match.mjs's own header for the reasoning). Everything else in this
// extension (WebAuthn, content-script DOM access, chrome.* APIs) genuinely needs a real
// browser, which this session has no way to drive -- see README.md's "What is NOT verified"
// section for the honest boundary.
//
// Run: node extension/site-match.test.mjs

import assert from "node:assert/strict";
import { matchesSite, normaliseHost, findMatches } from "./lib/site-match.mjs";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

check("normaliseHost strips scheme, www, path, and lower-cases", () => {
  assert.equal(normaliseHost("https://Www.Chase.com/login"), "chase.com");
  assert.equal(normaliseHost("chase.com"), "chase.com");
  assert.equal(normaliseHost(""), "");
  assert.equal(normaliseHost(null), "");
});

check("matchesSite: bare domain matches its own hostname", () => {
  assert.equal(matchesSite("chase.com", "chase.com"), true);
});

check("matchesSite: bare domain matches a subdomain of itself", () => {
  assert.equal(matchesSite("chase.com", "secure.chase.com"), true);
});

check("matchesSite: a short service name matches the real hostname", () => {
  assert.equal(matchesSite("Chase", "www.chase.com"), true);
});

check("matchesSite: unrelated sites do not match", () => {
  assert.equal(matchesSite("chase.com", "amazon.com"), false);
  assert.equal(matchesSite("Netflix", "hulu.com"), false);
});

check("matchesSite: a too-short fragment never matches (floor, not a real service name)", () => {
  assert.equal(matchesSite("co", "chase.com"), false);
});

check("matchesSite: empty inputs never match", () => {
  assert.equal(matchesSite("", "chase.com"), false);
  assert.equal(matchesSite("chase.com", ""), false);
});

check("findMatches: only login-kind entries are offered, checked against site AND label", () => {
  const entries = [
    { id: "1", kind: "login", site: "chase.com", label: "Chase Checking", username: "shane" },
    { id: "2", kind: "login", site: "", label: "American Express", username: "shane" },
    { id: "3", kind: "bill_reference", site: "chase.com", label: "Chase mortgage account #" },
    { id: "4", kind: "login", site: "amazon.com", label: "Amazon", username: "shane" },
  ];
  assert.deepEqual(
    findMatches(entries, "chase.com").map((e) => e.id),
    ["1"],
  );
  assert.deepEqual(
    findMatches(entries, "americanexpress.com").map((e) => e.id),
    ["2"],
  );
  assert.deepEqual(findMatches(entries, "hulu.com"), []);
});

console.log(`\n${passed}/${passed} passed`);
