#!/usr/bin/env node
// Retroactively mint (or regenerate) account-recovery codes for a real, already-existing account
// (Git #3246) -- the "retroactively for the existing account" half of the issue's resolution.
// New accounts get this automatically at first passkey enrolment (see
// src/routes/api.mjs's /api/auth/enroll/verify); this script exists for the account that already
// has a passkey and predates that.
//
//   npm run generate-recovery-codes -- --email shanemccaw@gmail.com
//
// Real terminal, real DATABASE_URL -- same posture as bin/enroll-passkey.mjs. Prints the codes
// once; they are never logged or stored anywhere in plaintext. Also emails them via Microsoft
// Graph when SL_GRAPH_* is configured (src/core/mailer.mjs) -- if it is not, that is reported
// honestly rather than silently skipped.

import { closePool } from "../src/db.mjs";
import { runMigrations } from "../src/migrate.mjs";
import { findUserByEmail, listUsers } from "../src/core/users.mjs";
import { generateRecoveryCodes, CODE_COUNT } from "../src/core/recovery-codes.mjs";
import { mailerConfigured } from "../src/core/mailer.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

async function main() {
  await runMigrations({ log: () => {} });

  const email = arg("email");
  if (!email) {
    const users = await listUsers();
    console.error("Usage: npm run generate-recovery-codes -- --email you@example.com");
    if (users.length) {
      console.error("");
      console.error("Real accounts on this database:");
      for (const u of users) console.error(`  ${u.email}${u.is_active ? "" : "  (deactivated)"}`);
    }
    process.exitCode = 1;
    return;
  }

  const user = await findUserByEmail(email);
  if (!user) {
    console.error(`No account for ${email}.`);
    process.exitCode = 1;
    return;
  }

  const generated = await generateRecoveryCodes(user.id, user.email);

  console.log(`Minted ${CODE_COUNT} recovery codes for ${user.email}. Any previous set no longer works.`);
  console.log("");
  for (const code of generated.codes) console.log(`  ${code}`);
  console.log("");
  if (generated.emailSent) {
    console.log(`Also emailed to ${user.email}.`);
  } else if (!mailerConfigured()) {
    console.log(
      "Not emailed: SL_GRAPH_TENANT_ID / SL_GRAPH_CLIENT_ID / SL_GRAPH_CLIENT_SECRET / " +
        "SL_GRAPH_SENDER_USER_ID are not all set. Write these down somewhere durable now --" +
        " this is the only time they are shown.",
    );
  } else {
    console.log(`Not emailed -- Graph mail send failed: ${generated.emailError}`);
  }
}

try {
  await main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
