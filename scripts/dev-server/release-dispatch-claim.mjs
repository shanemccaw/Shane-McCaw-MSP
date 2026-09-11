#!/usr/bin/env node
// scripts/dev-server/release-dispatch-claim.mjs
//
// Git #3509 — releases a bt_dispatch_claims row once its BUILD: comment has actually
// been posted (or the ask was abandoned), so it can't linger and block a legitimate
// future dispatch attempt for the same issue. Idempotent: releasing an already-gone
// claim is a no-op, exit 0. Pairs with claim-dispatch.mjs.
//
// Usage: node scripts/dev-server/release-dispatch-claim.mjs <issueNumber>

// Git #3651 — BUILD_DATABASE_URL (BuildConsole's own database), same as claim-dispatch.mjs.
import { connectBuildDatabase } from "../config-state/db.mjs";

// Git #3579 — repo-scoped, same reasoning as claim-dispatch.mjs.
const REPO_OWNER = "shanemccaw";
const REPO_NAME = "Shane-McCaw-MSP";

async function main() {
  const issueNumber = Number(process.argv[2]);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    console.error("Usage: node scripts/dev-server/release-dispatch-claim.mjs <issueNumber>");
    process.exit(2);
    return;
  }
  const client = await connectBuildDatabase();
  try {
    const res = await client.query(
      "DELETE FROM bt_dispatch_claims WHERE repo_owner = $1 AND repo_name = $2 AND github_number = $3",
      [REPO_OWNER, REPO_NAME, issueNumber]
    );
    console.log(res.rowCount > 0 ? `Released dispatch claim on #${issueNumber}.` : `#${issueNumber} had no dispatch claim to release.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`release-dispatch-claim failed: ${err.message}`);
  process.exit(2);
});
