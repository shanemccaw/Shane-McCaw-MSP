#!/usr/bin/env node
// scripts/dev-server/claim-dispatch.mjs
//
// Git #3509 — the one real source of truth any dispatch flow claims BEFORE writing and
// posting a `BUILD:` comment on a GitHub issue, so two independent flows can never both
// post one for the same issue at once. This is the same bt_dispatch_claims table
// BuildConsole's own Dispatch box / Git Board hover popover claim through
// (BuildQueuePostgresClient.TryClaimDispatchAsync) — a chat working CLAUDE.md's Build
// Queue Method directly (outside BuildConsole's UI entirely) uses this script to claim
// through the exact same table, so there is genuinely one source of truth regardless of
// which side initiates the dispatch.
//
// Real collision this closes: a MyArchitect-set dispatch and a BatterUpClearOut-set
// dispatch each independently found #3493 had no BUILD: comment yet, and each posted
// one — six minutes apart (comment ids IC_kwDOTWTvIM8AAAABTpR3ag,
// IC_kwDOTWTvIM8AAAABTpVG3g). Neither flow had any way to know the other had also just
// decided to dispatch the same issue.
//
// Usage:
//   node scripts/dev-server/claim-dispatch.mjs <issueNumber> [--by <label>] [--ttl-minutes <n>]
//
// Exit code 0 -> claim acquired. Safe to write and post the BUILD: comment now. Release
//                it afterward with release-dispatch-claim.mjs (or let it expire).
// Exit code 1 -> already claimed by another flow (who/when/expires printed). Do NOT post
//                a duplicate BUILD: comment — re-check the issue's real comments first,
//                or wait for the existing claim to expire if it's genuinely stale.
// Exit code 2 -> bad usage / DB error.

import { connect } from "../config-state/db.mjs";

// Git #3579 — bt_dispatch_claims' PK is now (repo_owner, repo_name, github_number), so a
// bare github_number is no longer a sound uniqueness boundary once a second real repo's
// issue numbers coexist locally. Defaulted to this repo (the only one this script talks
// to today) so behavior here is completely unaffected until a real repo registry exists.
const REPO_OWNER = "shanemccaw";
const REPO_NAME = "Shane-McCaw-MSP";

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--by") a.by = argv[++i];
    else if (t === "--ttl-minutes") a.ttlMinutes = Number(argv[++i]);
    else a._.push(t);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const issueNumber = Number(args._[0]);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    console.error("Usage: node scripts/dev-server/claim-dispatch.mjs <issueNumber> [--by <label>] [--ttl-minutes <n>]");
    process.exit(2);
    return;
  }
  const claimedBy = args.by || `chat:${process.env.USERNAME || process.env.USER || "unknown"}`;
  const ttlMinutes = Number.isFinite(args.ttlMinutes) && args.ttlMinutes > 0 ? args.ttlMinutes : 20;

  const client = await connect();
  try {
    // A claim past its own TTL is abandoned — purge it before attempting a fresh one, so
    // a forgotten ask can never hold an issue's dispatch hostage forever.
    await client.query(
      "DELETE FROM bt_dispatch_claims WHERE repo_owner = $1 AND repo_name = $2 AND github_number = $3 AND expires_at <= now()",
      [REPO_OWNER, REPO_NAME, issueNumber]
    );

    const insert = await client.query(
      `INSERT INTO bt_dispatch_claims (repo_owner, repo_name, github_number, claimed_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)
       ON CONFLICT (repo_owner, repo_name, github_number) DO NOTHING
       RETURNING claimed_at, expires_at`,
      [REPO_OWNER, REPO_NAME, issueNumber, claimedBy, ttlMinutes]
    );

    if (insert.rowCount > 0) {
      console.log(
        `Claimed dispatch of #${issueNumber} as "${claimedBy}" (expires ${insert.rows[0].expires_at.toISOString()}). ` +
        `Safe to write and post the BUILD: comment now.`
      );
      process.exit(0);
      return;
    }

    const existing = await client.query(
      "SELECT claimed_by, claimed_at, expires_at FROM bt_dispatch_claims WHERE repo_owner = $1 AND repo_name = $2 AND github_number = $3",
      [REPO_OWNER, REPO_NAME, issueNumber]
    );
    const row = existing.rows[0];
    if (row) {
      console.error(
        `#${issueNumber} is already being dispatched — claimed by "${row.claimed_by}" at ${row.claimed_at.toISOString()}, ` +
        `expires ${row.expires_at.toISOString()}. Do NOT post a duplicate BUILD: comment. Re-check the issue's real ` +
        `comments first; if that claim is genuinely stale, wait for it to expire rather than overriding it.`
      );
    } else {
      console.error(`#${issueNumber} claim attempt lost a race and the winning claim already cleared — retry.`);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`claim-dispatch failed: ${err.message}`);
  process.exit(2);
});
