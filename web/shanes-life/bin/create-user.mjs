#!/usr/bin/env node
// Create a real account. There is no public sign-up route on purpose (contract pack Section 9 --
// account-gated app, one real user), so accounts are made here.
//
//   npm run create-user -- --email shane@example.com --name "Shane"
//     ...then type the password at the prompt (it is not echoed and never reaches argv,
//        so it stays out of the shell history and out of the process list).
//
// Non-interactive (CI, a scripted first boot) -- read it from an env var, never a flag:
//   SL_PASSWORD='...' npm run create-user -- --email ... --name ... --password-from-env

import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { closePool } from "../src/db.mjs";
import { runMigrations } from "../src/migrate.mjs";
import { createUser, setPassword } from "../src/core/users.mjs";
import { one } from "../src/db.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

function promptHidden(question) {
  return new Promise((resolvePromise) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    // Suppress echo by swallowing what the readline interface would have written.
    const originalWrite = stdout.write.bind(stdout);
    let muted = false;
    rl.question(question, (answer) => {
      muted = false;
      stdout.write = originalWrite;
      stdout.write("\n");
      rl.close();
      resolvePromise(answer);
    });
    muted = true;
    stdout.write = (chunk, ...rest) => {
      if (muted && !String(chunk).includes(question)) return true;
      return originalWrite(chunk, ...rest);
    };
  });
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

  let password;
  if (process.argv.includes("--password-from-env")) {
    password = process.env.SL_PASSWORD;
    if (!password) {
      console.error("--password-from-env was passed but SL_PASSWORD is not set.");
      process.exitCode = 1;
      return;
    }
  } else {
    password = await promptHidden("Password (12+ chars): ");
    const again = await promptHidden("Repeat it: ");
    if (password !== again) {
      console.error("Those did not match.");
      process.exitCode = 1;
      return;
    }
  }

  const existing = await one("SELECT id, email FROM users WHERE lower(email) = lower($1)", [email]);
  if (existing) {
    await setPassword(existing.id, password);
    console.log(`Password reset for existing account ${existing.email} (${existing.id}).`);
    return;
  }

  const user = await createUser({ email, name, password });
  console.log(`Created ${user.email} (${user.id}).`);
}

try {
  await main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
