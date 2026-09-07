#!/usr/bin/env node
// Mint a single-use enrolment link for a real account, so a new device can register a passkey.
//
//   npm run enroll-passkey -- --email shane@example.com --label "iPhone"
//
// This is the out-of-band control that makes passkey-only enrolment safe. It has to be run at a
// real terminal with a real DATABASE_URL, which is exactly the property a browser-reachable
// "register a new passkey" route would not have: in a passkey-only app such a route is a
// password-reset email with extra steps, so there isn't one.
//
// An already-signed-in session can add another passkey from Settings without a token -- that
// path is authorised by the session it is already holding.

import { closePool } from "../src/db.mjs";
import { runMigrations } from "../src/migrate.mjs";
import { findUserByEmail, listUsers } from "../src/core/users.mjs";
import { listCredentials, mintEnrollment, ENROLLMENT_TTL_MINUTES } from "../src/core/credentials.mjs";
import { config } from "../src/config.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

async function main() {
  await runMigrations({ log: () => {} });

  const email = arg("email");
  if (!email) {
    const users = await listUsers();
    console.error('Usage: npm run enroll-passkey -- --email you@example.com --label "iPhone"');
    if (users.length) {
      console.error("");
      console.error("Real accounts on this database:");
      for (const u of users) console.error(`  ${u.email}${u.is_active ? "" : "  (deactivated)"}`);
    } else {
      console.error("");
      console.error("There are no accounts yet. Create one with `npm run create-user` first.");
    }
    process.exitCode = 1;
    return;
  }

  const user = await findUserByEmail(email);
  if (!user) {
    console.error(`No account for ${email}. Create it with \`npm run create-user\` first.`);
    process.exitCode = 1;
    return;
  }

  const existing = await listCredentials(user.id);
  const label = arg("label") || (existing.length === 0 ? "First passkey" : `Passkey ${existing.length + 1}`);
  const enrollment = await mintEnrollment(user.id, label);

  console.log(`${user.email} currently has ${existing.length} passkey${existing.length === 1 ? "" : "s"}.`);
  for (const c of existing) {
    console.log(`  - ${c.label}${c.last_used_at ? ` (last used ${new Date(c.last_used_at).toISOString()})` : " (never used)"}`);
  }
  console.log("");
  console.log(`Open this once, on the device that should hold "${label}":`);
  console.log("");
  console.log(`  ${config.publicOrigin}/#enroll=${enrollment.token}`);
  console.log("");
  console.log(`It works once and expires in ${ENROLLMENT_TTL_MINUTES} minutes.`);
}

try {
  await main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
