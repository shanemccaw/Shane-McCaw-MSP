import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// MAJOR/MINOR are manual — bump these deliberately, never automatically.
const MAJOR = 1;
const MINOR = 0;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const build = execFileSync("git", ["rev-list", "--count", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();

const hash = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();

const version = `${MAJOR}.${MINOR}.${build}`;

const payload = {
  major: MAJOR,
  minor: MINOR,
  build: Number(build),
  hash,
  version,
  display: `${version} (${hash})`,
};

const targets = [
  "artifacts/msp-portal/src/generated/version.json",
  "artifacts/admin-panel/src/generated/version.json",
  "artifacts/shane-mccaw-consulting/src/generated/version.json",
  "artifacts/api-server/src/generated/version.json",
];

for (const relTarget of targets) {
  const absTarget = path.resolve(repoRoot, relTarget);
  mkdirSync(path.dirname(absTarget), { recursive: true });
  writeFileSync(absTarget, JSON.stringify(payload, null, 2) + "\n");
}

console.log(`[generate-version] stamped ${payload.display} into ${targets.length} apps`);
