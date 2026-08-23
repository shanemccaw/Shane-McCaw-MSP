#!/usr/bin/env node
// Explicit build progress reporting helper.
// Used by agents to report real progress milestones directly to BuildConsole.
//
// Usage:
//   node scripts/report-progress.mjs <buildId> <step> <total> "<step description>"
//
// Examples:
//   node scripts/report-progress.mjs 12 1 3 "Phase 1: Investigation & Research"
//   node scripts/report-progress.mjs 12 2 3 "Phase 2: Core Implementation"
//   node scripts/report-progress.mjs 12 3 3 "Phase 3: Verification & Test Suite"

import net from "node:net";
import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
if (args.length < 3) {
  console.log("Usage: node scripts/report-progress.mjs <buildId> <step> <total> [label]");
  process.exit(0);
}

const buildId = parseInt(args[0], 10);
const step = parseInt(args[1], 10);
const total = parseInt(args[2], 10);
const label = args.slice(3).join(" ") || `Step ${step}/${total}`;

if (isNaN(buildId) || isNaN(step) || isNaN(total)) {
  console.error("Invalid arguments. buildId, step, and total must be numbers.");
  process.exit(1);
}

const uri = `shaneapp://reportProgress?buildId=${buildId}&step=${step}&total=${total}&label=${encodeURIComponent(label)}&src=agent-cli`;

// Also persist local progress snapshot file for durable diagnostic record
try {
  const progressDir = path.join(repoRoot, ".logs", "dev-all", "progress");
  fs.mkdirSync(progressDir, { recursive: true });
  fs.writeFileSync(
    path.join(progressDir, `${buildId}.json`),
    JSON.stringify({ buildId, step, total, label, reportedAt: new Date().toISOString() }, null, 2)
  );
} catch {}

// Attempt direct Windows Named Pipe delivery (fastest & non-blocking)
const PIPE_NAME = "\\\\.\\pipe\\shaneapp-protocol";

function tryNamedPipe() {
  return new Promise((resolve) => {
    const client = net.connect(PIPE_NAME, () => {
      client.write(uri + "\n");
      client.end();
      resolve(true);
    });

    client.on("error", () => {
      resolve(false);
    });

    setTimeout(() => {
      client.destroy();
      resolve(false);
    }, 800);
  });
}

const pipeDelivered = await tryNamedPipe();
if (pipeDelivered) {
  console.log(`[reportProgress] Reported step ${step}/${total} for build #${buildId}: "${label}"`);
  process.exit(0);
}

// Fallback: spawn OS protocol handler
if (process.platform === "win32") {
  exec(`start "" "${uri}"`, (err) => {
    if (err) {
      console.log(`[reportProgress] Recorded step ${step}/${total} locally (BuildConsole not listening on pipe).`);
    } else {
      console.log(`[reportProgress] Dispatched step ${step}/${total} via protocol.`);
    }
  });
} else {
  console.log(`[reportProgress] Recorded step ${step}/${total} for build #${buildId}.`);
}
