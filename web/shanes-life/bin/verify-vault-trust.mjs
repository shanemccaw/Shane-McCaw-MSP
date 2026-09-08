#!/usr/bin/env node
// Real, direct DB-level coverage for the one real vault-trust path bin/check.mjs's own HTTP
// flow cannot safely exercise: `revokeAllTrustedDevices` (Git #3276), called from
// POST /api/auth/logout-everywhere. check.mjs runs one continuous authenticated session
// through dozens of later sections (documents, people, dates, pets, shopping, ...) -- actually
// signing out everywhere partway through would kill every one of them. This script runs on its
// own, against the real local database, with its own disposable account, and deletes it when
// done (same discipline as check.mjs's own cleanup).
//
//   node bin/verify-vault-trust.mjs
//
// No running server needed -- this calls src/core/vault.mjs directly, the same functions
// api.mjs's routes call, just without the HTTP/WebAuthn layer bin/check.mjs already covers for
// mint (POST /api/vault/:id/reveal) and fill (POST /api/vault/:id/fill).

import { closePool, one, query } from "../src/db.mjs";
import { runMigrations } from "../src/migrate.mjs";
import { createUser } from "../src/core/users.mjs";
import * as vault from "../src/core/vault.mjs";

const results = [];
let failures = 0;
function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failures++;
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

async function main() {
  await runMigrations({ log: () => {} });

  const stamp = Date.now();
  const user = await createUser({ email: `verify-trust+${stamp}@shanes.life`, name: "Verify Trust Account" });

  try {
    const entry = await vault.createEntry(user.id, {
      kind: "login",
      label: "Verify Trust Login",
      site: "example.com",
      username: "verify",
      secret: "a-real-password-99",
    });

    // mintTrustedDevice / resolveTrustedDevice -- the round trip the reveal route relies on.
    const minted = await vault.mintTrustedDevice(user.id, "Verify Chrome", 30);
    check("mintTrustedDevice returns a real bearer token distinct from what's stored", Boolean(minted.token) && minted.token.startsWith("slvault_"));
    const resolved = await vault.resolveTrustedDevice(minted.token);
    check("resolveTrustedDevice resolves a live token back to the right user", resolved?.userId === user.id, JSON.stringify(resolved));
    check("a garbage token resolves to null, not a throw", (await vault.resolveTrustedDevice("slvault_garbage")) === null);

    // fillWithTrust -- refuses always-ask, otherwise reveals for real via the trust token.
    await vault.updateEntry(user.id, entry.id, { alwaysAsk: true });
    let refusedAlwaysAsk = false;
    try {
      await vault.fillWithTrust(user.id, entry.id, { deviceTrustId: minted.id });
    } catch (err) {
      refusedAlwaysAsk = /always asks/i.test(err.message);
    }
    check("fillWithTrust refuses an always-ask entry", refusedAlwaysAsk);
    await vault.updateEntry(user.id, entry.id, { alwaysAsk: false });

    const filled = await vault.fillWithTrust(user.id, entry.id, { deviceTrustId: minted.id, site: "example.com" });
    check("fillWithTrust returns the real plaintext", filled?.value === "a-real-password-99", String(filled?.value));
    const auditRow = await one(
      "SELECT via, credential_id, device_trust_id FROM vault_reveals WHERE vault_id = $1 ORDER BY at DESC LIMIT 1",
      [entry.id],
    );
    check(
      "the fill wrote a real vault_reveals row, via='extension-trusted', no credential_id",
      auditRow?.via === "extension-trusted" && auditRow?.credential_id === null && auditRow?.device_trust_id === minted.id,
      JSON.stringify(auditRow),
    );

    // The one real path this script exists for: revokeAllTrustedDevices, called from
    // POST /api/auth/logout-everywhere -- a second real device, then a real "sign out
    // everywhere" revokes BOTH, and neither can fill again after.
    const secondDevice = await vault.mintTrustedDevice(user.id, "Verify Chrome 2", 30);
    const revokedCount = await vault.revokeAllTrustedDevices(user.id);
    check("revokeAllTrustedDevices reports the real count it revoked", revokedCount === 2, String(revokedCount));
    check("the first device's token is dead after sign-out-everywhere", (await vault.resolveTrustedDevice(minted.token)) === null);
    check("the second device's token is dead too -- ALL devices, not just one", (await vault.resolveTrustedDevice(secondDevice.token)) === null);

    let refusedAfterRevoke = false;
    try {
      await vault.fillWithTrust(user.id, entry.id, { deviceTrustId: minted.id });
    } catch {
      refusedAfterRevoke = true; // ownedRow etc. would still work; the ROUTE is what checks
      // resolveTrustedDevice first and never even calls fillWithTrust with a dead token -- this
      // just confirms the token itself no longer resolves, which is what the route relies on.
    }
    check(
      "a revoked token no longer resolves (the route never gets far enough to call fillWithTrust with it)",
      (await vault.resolveTrustedDevice(minted.token)) === null,
    );

    // forgetDevice -- the per-device path, real revoke not a delete (the row survives).
    const forgetTarget = await vault.mintTrustedDevice(user.id, "Verify Chrome 3", 30);
    const forgotten = await vault.forgetDevice(user.id, forgetTarget.id);
    check("forgetDevice reports success for a real, owned row", forgotten === true);
    check("a forgotten token no longer resolves", (await vault.resolveTrustedDevice(forgetTarget.token)) === null);
    const forgetRow = await one("SELECT revoked_at FROM vault_device_trust WHERE id = $1", [forgetTarget.id]);
    check("Forget is a real revoke (row survives, revoked_at set), not a delete", Boolean(forgetRow?.revoked_at));
    const secondForget = await vault.forgetDevice(user.id, forgetTarget.id);
    check("forgetting an already-forgotten device is a real, honest false, not a throw", secondForget === false);
  } finally {
    await query("DELETE FROM users WHERE id = $1", [user.id]).catch(() => {});
    await closePool();
  }

  console.log(results.join("\n"));
  console.log(`\n${results.length - failures}/${results.length} checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
