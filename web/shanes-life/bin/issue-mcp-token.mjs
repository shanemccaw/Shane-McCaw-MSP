#!/usr/bin/env node
// Mint an MCP token from the command line. The app's Settings screen does the same thing;
// this exists for the first one, before there is a browser session to do it from.
//
//   npm run issue-mcp-token -- --email shane@example.com --label "Claude Code"

import { closePool, one } from "../src/db.mjs";
import { config } from "../src/config.mjs";
import { runMigrations } from "../src/migrate.mjs";
import { issueMcpToken } from "../src/core/mcp-tokens.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

try {
  const email = arg("email");
  const label = arg("label") || "cli";
  if (!email) {
    console.error('Usage: npm run issue-mcp-token -- --email you@example.com --label "Claude Code"');
    process.exitCode = 1;
  } else {
    await runMigrations({ log: () => {} });
    const user = await one("SELECT id, email FROM users WHERE lower(email) = lower($1)", [email]);
    if (!user) {
      console.error(`No account for ${email}. Run: npm run create-user -- --email ${email} --name "..."`);
      process.exitCode = 1;
    } else {
      const issued = await issueMcpToken(user.id, label);
      console.log("");
      console.log(`Token for ${user.email}, labelled "${issued.label}".`);
      console.log("It is shown once. It cannot be recovered -- mint another if it is lost.");
      console.log("");
      console.log(`  token:    ${issued.token}`);
      console.log(`  endpoint: ${config.publicOrigin}/mcp`);
      console.log(`  url form: ${config.publicOrigin}/mcp/t/${issued.token}`);
      console.log("");
      console.log("Claude Code:");
      console.log(`  claude mcp add --transport http shanes-life ${config.publicOrigin}/mcp \\`);
      console.log(`    --header "Authorization: Bearer ${issued.token}"`);
      console.log("");
    }
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
