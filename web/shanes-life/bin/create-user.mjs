#!/usr/bin/env node
// Create a real account. There is no public sign-up route on purpose (contract Section 9 --
// account-gated app, one real user), so accounts are made here.
//
//   npm run create-user -- --email shane@example.com --name "Shane"
//
// There is no password prompt, because there is no password: the app is passkey-only (design
// handoff, "Auth and sharing"). This prints a single-use enrolment link instead. Open it on the
// device that should hold the passkey, approve with Face ID, and that device is signed in.
//
// The link expires (30 minutes) and works once. To add a second device later, or if the link
// expires before it is used, mint another with `npm run enroll-passkey`.

import { closePool, one } from "../src/db.mjs";
import { runMigrations } from "../src/migrate.mjs";
import { createUser } from "../src/core/users.mjs";
import { mintEnrollment, ENROLLMENT_TTL_MINUTES } from "../src/core/credentials.mjs";
import { config } from "../src/config.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

async function main() {
  const email = arg("email");
  const name = arg("name") || email;
  if (!email) {
    console.error('Usage: npm run create-user -- --email you@example.com --name "Your Name"');
    process.exitCode = 1;
    return;
  }

  await runMigrations({ log: () => {} });

  let user = await one("SELECT id, email, name FROM users WHERE lower(email) = lower($1)", [email]);
  if (user) {
    console.log(`${user.email} already exists (${user.id}). Minting a fresh enrolment link for it.`);
  } else {
    user = await createUser({ email, name });
    console.log(`Created ${user.email} (${user.id}).`);
  }

  const enrollment = await mintEnrollment(user.id, arg("label") || "First passkey");
  console.log("");
  console.log("Open this once, on the device that should hold the passkey:");
  console.log("");
  console.log(`  ${config.publicOrigin}/#enroll=${enrollment.token}`);
  console.log("");
  console.log(`It works once and expires in ${ENROLLMENT_TTL_MINUTES} minutes. The token is in the`);
  console.log("URL fragment, so it is never sent to the server in a request line and never lands");
  console.log("in an access log. It is shown here and nowhere else.");
}

try {
  await main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
