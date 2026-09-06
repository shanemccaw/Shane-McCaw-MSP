#!/usr/bin/env node
// scripts/dev-server/check-pnpmfile-checksum.mjs
//
// Git #2064 — preventative guard against the exact class of bug that caused
// #2060: commit `734b8f515` (#1986) added `.pnpmfile.cjs` but committed
// `pnpm-lock.yaml` WITHOUT the `pnpmfileChecksum` pnpm records for a present
// pnpmfile. With no checksum committed, every pnpm invocation in the shared
// main checkout re-injected one, leaving `pnpm-lock.yaml` perpetually dirty
// and blocking BuildConsole's self-deploy (deploy-shanesbuild.cmd's
// `git status --porcelain` gate). Fixed once in `8be99371b` — this script
// stops it from silently recurring the next time `.pnpmfile.cjs` is edited
// without re-committing the updated checksum.
//
// Pure local file arithmetic — no `pnpm install`, no network, no metered
// cost (see CLAUDE.md "pnpm install is not a remedy" / #1987). Reproduces
// pnpm 11.13.0's own checksum algorithm: sha256-base64 of the sha256 digest
// of the LF-normalized pnpmfile contents.
//
// Usage:
//   node scripts/dev-server/check-pnpmfile-checksum.mjs             # scan repo root
//   node scripts/dev-server/check-pnpmfile-checksum.mjs --root <p>  # scan a different checkout (tests)
//   node scripts/dev-server/check-pnpmfile-checksum.mjs --json      # machine-readable report
//
// Exit codes:
//   0 = no .pnpmfile.cjs present, or present and checksum matches
//   1 = .pnpmfile.cjs present but pnpm-lock.yaml's pnpmfileChecksum is
//       missing or does not match the recomputed value (drift — the same
//       failure mode as #2060)
//   2 = could not scan at all (e.g. pnpm-lock.yaml missing)

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function computeExpectedChecksum(pnpmfileContents) {
  const lfNormalized = pnpmfileContents.replace(/\r\n/g, "\n");
  const digest = createHash("sha256").update(Buffer.from(lfNormalized, "utf8")).digest("base64");
  return `sha256-${digest}`;
}

function findCommittedChecksum(lockfileContents) {
  // Top-level `pnpmfileChecksum: sha256-...` line in pnpm-lock.yaml.
  const match = lockfileContents.match(/^pnpmfileChecksum:\s*(\S+)\s*$/m);
  return match ? match[1] : null;
}

export function checkPnpmfileChecksum(root) {
  const pnpmfilePath = path.join(root, ".pnpmfile.cjs");
  const lockfilePath = path.join(root, "pnpm-lock.yaml");

  if (!existsSync(pnpmfilePath)) {
    return { ok: true, status: "no-pnpmfile", root };
  }

  if (!existsSync(lockfilePath)) {
    return {
      ok: false,
      status: "no-lockfile",
      root,
      error: `.pnpmfile.cjs exists at ${pnpmfilePath} but pnpm-lock.yaml is missing at ${lockfilePath}`,
    };
  }

  const pnpmfileContents = readFileSync(pnpmfilePath, "utf8");
  const lockfileContents = readFileSync(lockfilePath, "utf8");

  const expected = computeExpectedChecksum(pnpmfileContents);
  const committed = findCommittedChecksum(lockfileContents);

  if (committed === null) {
    return {
      ok: false,
      status: "missing",
      root,
      expected,
      committed,
      error:
        "pnpm-lock.yaml has no pnpmfileChecksum line, but .pnpmfile.cjs is present. " +
        "This is the exact drift that caused Git #2060 — every pnpm invocation will " +
        `re-inject the checksum and re-dirty the checkout. Add "pnpmfileChecksum: ${expected}" ` +
        "to pnpm-lock.yaml and commit it.",
    };
  }

  if (committed !== expected) {
    return {
      ok: false,
      status: "mismatch",
      root,
      expected,
      committed,
      error:
        `pnpm-lock.yaml's committed pnpmfileChecksum (${committed}) does not match the checksum ` +
        `recomputed from the current .pnpmfile.cjs (${expected}). .pnpmfile.cjs was edited without ` +
        "re-committing the updated checksum — the same drift class as Git #2060. Update the " +
        `pnpmfileChecksum line in pnpm-lock.yaml to "${expected}" and commit it.`,
    };
  }

  return { ok: true, status: "match", root, expected, committed };
}

function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes("--json");
  const rootIdx = args.indexOf("--root");
  const root = rootIdx !== -1 && args[rootIdx + 1]
    ? path.resolve(args[rootIdx + 1])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  let result;
  try {
    result = checkPnpmfileChecksum(root);
  } catch (err) {
    if (jsonOut) {
      console.log(JSON.stringify({ ok: false, status: "scan-error", error: String(err && err.message || err) }, null, 2));
    } else {
      console.error(`[check-pnpmfile-checksum] could not scan: ${err && err.message || err}`);
    }
    process.exit(2);
  }

  if (jsonOut) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.status === "no-pnpmfile") {
    console.log("[check-pnpmfile-checksum] no .pnpmfile.cjs present — nothing to check.");
  } else if (result.ok) {
    console.log(`[check-pnpmfile-checksum] OK — pnpmfileChecksum matches (${result.committed}).`);
  } else {
    console.error(`[check-pnpmfile-checksum] DRIFT DETECTED (${result.status}):`);
    console.error(result.error);
  }

  process.exit(result.ok ? 0 : result.status === "scan-error" ? 2 : 1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
