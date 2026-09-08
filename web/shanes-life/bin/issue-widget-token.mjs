#!/usr/bin/env node
// Mint a /widget token from the command line -- the real thing Shane needs to hand a third-party
// iOS "Widget Web" app its own URL. The Settings screen's "Home Screen widget" section does the
// same thing; this exists for setting up the widget the first time, before the app is even
// installed to click through it.
//
//   npm run issue-widget-token -- --email shane@example.com --label "Home Screen"

import { closePool, one } from "../src/db.mjs";
import { config } from "../src/config.mjs";
import { runMigrations } from "../src/migrate.mjs";
import { issueWidgetToken } from "../src/core/widget-tokens.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

try {
  const email = arg("email");
  const label = arg("label") || "widget";
  if (!email) {
    console.error('Usage: npm run issue-widget-token -- --email you@example.com --label "Home Screen"');
    process.exitCode = 1;
  } else {
    await runMigrations({ log: () => {} });
    const user = await one("SELECT id, email FROM users WHERE lower(email) = lower($1)", [email]);
    if (!user) {
      console.error(`No account for ${email}. Run: npm run create-user -- --email ${email} --name "..."`);
      process.exitCode = 1;
    } else {
      const issued = await issueWidgetToken(user.id, label);
      console.log("");
      console.log(`Widget token for ${user.email}, labelled "${issued.label}".`);
      console.log("It is shown once. It cannot be recovered -- mint another if it is lost.");
      console.log("");
      console.log(`  url: ${config.publicOrigin}/widget/t/${issued.token}`);
      console.log("");
      console.log("Paste that URL into a Widget Web-style app (e.g. Widget Web 26) as the widget's page.");
      console.log("");
    }
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
