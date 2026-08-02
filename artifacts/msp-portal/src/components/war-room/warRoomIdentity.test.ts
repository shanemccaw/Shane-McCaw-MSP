import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePreludeCustomerName } from "./warRoomIdentity.ts";

test("displays the real tenant's company name when the portal dashboard returns one", () => {
  assert.equal(resolvePreludeCustomerName("Acme IT Solutions"), "Acme IT Solutions");
  assert.equal(resolvePreludeCustomerName("Contoso Global"), "Contoso Global");
});

test("never falls back to the Northline Health demo org name", () => {
  for (const input of [null, undefined, "", "   "]) {
    const resolved = resolvePreludeCustomerName(input);
    assert.notEqual(resolved, "Northline Health");
  }
});

test("falls back to a generic label, not a fictional org, when no real name is available yet", () => {
  assert.equal(resolvePreludeCustomerName(null), "Your organization");
  assert.equal(resolvePreludeCustomerName(undefined), "Your organization");
  assert.equal(resolvePreludeCustomerName(""), "Your organization");
});
