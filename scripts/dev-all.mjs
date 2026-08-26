#!/usr/bin/env node
// Starts api-server + frontend artifacts locally, each on its own port,
// with support for starting/stopping individual services and per-service log streaming.
// Place this file at: <repo-root>/scripts/dev-all.mjs
// Run from repo root with: node scripts/dev-all.mjs

import { spawn, execSync } from "node:child_process";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const envPath = path.join(repoRoot, ".env.local");

// --- File-based server logging ---------------------------------------------
const LOG_DIR =
  process.env.DEV_ALL_LOG_DIR || path.join(repoRoot, ".logs", "dev-all");
const LOG_FILE = path.join(LOG_DIR, "dev-all.log");
const PREV_LOG_FILE = path.join(LOG_DIR, "dev-all.prev.log");
const MAX_LOG_BYTES = Number(process.env.DEV_ALL_LOG_MAX_BYTES || 15 * 1024 * 1024);

mkdirSync(LOG_DIR, { recursive: true });

function rotateFile(filePath, prevFilePath) {
  try {
    if (existsSync(filePath)) {
      try {
        rmSync(prevFilePath, { force: true });
      } catch {}
      renameSync(filePath, prevFilePath);
    }
  } catch {}
}

rotateFile(LOG_FILE, PREV_LOG_FILE);
let logBytes = 0;

function writeLog(text, serviceName = null) {
  try {
    appendFileSync(LOG_FILE, text);
    logBytes += Buffer.byteLength(text);
    if (logBytes > MAX_LOG_BYTES) {
      rotateFile(LOG_FILE, PREV_LOG_FILE);
      logBytes = 0;
    }
    if (serviceName) {
      const svcLog = path.join(LOG_DIR, `${serviceName}.log`);
      appendFileSync(svcLog, text);
    }
  } catch {
    /* logging must never crash the server launcher */
  }
}

function tee(stream, chunk, serviceName = null) {
  const str = typeof chunk === "string" ? chunk : String(chunk);
  stream.write(str);
  writeLog(str, serviceName);
}

function logInfo(msg, serviceName = null) {
  const line = msg.endsWith("\n") ? msg : msg + "\n";
  process.stdout.write(line);
  writeLog(line, serviceName);
}

function logErr(msg, serviceName = null) {
  const line = msg.endsWith("\n") ? msg : msg + "\n";
  process.stderr.write(line);
  writeLog(line, serviceName);
}

writeLog(
  `\n===== dev-all start ${new Date().toISOString()} pid=${process.pid} cwd=${repoRoot} =====\n`
);

// --- Load .env.local into a plain object ---
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    console.error(`Missing ${filePath}. Create it first.`);
    process.exit(1);
  }
  const vars = {};
  const lines = readFileSync(filePath, "utf8").split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

const fileEnv = loadEnvFile(envPath);

// --- Defined Services ---
const services = [
  { name: "api-server", pkg: "@workspace/api-server", port: 8080, title: "API Server" },
  { name: "shane-mccaw-consulting", pkg: "@workspace/shane-mccaw-consulting", port: 5173, title: "Marketing" },
  { name: "admin-panel", pkg: "@workspace/admin-panel", port: 5174, title: "Admin" },
  { name: "msp-portal", pkg: "@workspace/msp-portal", port: 5175, title: "Portal" },
  { name: "msp-website", pkg: "@workspace/msp-website", port: 5176, title: "Website" },
];

function recordServiceMeta(svc, pid, status = "running") {
  try {
    const metaPath = path.join(LOG_DIR, `${svc.name}.meta.json`);
    writeFileSync(
      metaPath,
      JSON.stringify(
        {
          name: svc.name,
          title: svc.title,
          port: svc.port,
          pkg: svc.pkg,
          pid,
          status,
          updatedAt: Date.now(),
          logFile: path.join(LOG_DIR, `${svc.name}.log`),
        },
        null,
        2
      )
    );
  } catch {}
}

const runningChildren = new Map();
let shuttingDown = false;

function runStep(cmd, args, cwd, env, tag, svcName) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, shell: false });
    child.stdout?.on("data", (d) => tee(process.stdout, `${tag} ${d}`, svcName));
    child.stderr?.on("data", (d) => tee(process.stderr, `${tag} ${d}`, svcName));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${tag} step failed (exit ${code}): ${cmd} ${args.join(" ")}`));
    });
    child.on("error", reject);
  });
}

async function startApiServer(svc, env) {
  const tag = `[${svc.name}:${svc.port}]`;
  const cwd = path.join(repoRoot, "artifacts", "api-server");
  try {
    logInfo(`${tag} killing stale port holder...`, svc.name);
    await runStep("node", ["../../scripts/kill-port.mjs"], cwd, env, tag, svc.name);
    logInfo(`${tag} building...`, svc.name);
    await runStep("node", ["./build.mjs"], cwd, env, tag, svc.name);
    logInfo(`${tag} starting...`, svc.name);
    const child = spawn("node", ["--enable-source-maps", "./dist/index.mjs"], {
      cwd,
      env,
      shell: false,
    });
    runningChildren.set(svc.name, child);
    recordServiceMeta(svc, child.pid, "running");
    child.stdout?.on("data", (d) => tee(process.stdout, `${tag} ${d}`, svc.name));
    child.stderr?.on("data", (d) => tee(process.stderr, `${tag} ${d}`, svc.name));
    child.on("exit", (code) => {
      recordServiceMeta(svc, null, "stopped");
      if (!shuttingDown) logInfo(`${tag} exited with code ${code}`, svc.name);
    });
    return child;
  } catch (err) {
    logErr(`${tag} ${err.message}`, svc.name);
  }
}

function startViteApp(svc, env) {
  const tag = `[${svc.name}:${svc.port}]`;
  const child = spawn("pnpm", ["--filter", svc.pkg, "run", "dev"], {
    cwd: repoRoot,
    shell: true,
    env,
  });
  runningChildren.set(svc.name, child);
  recordServiceMeta(svc, child.pid, "running");
  child.stdout?.on("data", (d) => tee(process.stdout, `${tag} ${d}`, svc.name));
  child.stderr?.on("data", (d) => tee(process.stderr, `${tag} ${d}`, svc.name));
  child.on("exit", (code) => {
    recordServiceMeta(svc, null, "stopped");
    if (!shuttingDown) logInfo(`${tag} exited with code ${code}`, svc.name);
  });
  logInfo(`${tag} starting...`, svc.name);
  return child;
}

function startService(svc) {
  const env = {
    ...process.env,
    ...fileEnv,
    PORT: String(svc.port),
    BASE_PATH: "/",
    NODE_ENV: "development",
  };
  if (svc.name === "api-server") {
    return startApiServer(svc, env);
  } else {
    return startViteApp(svc, env);
  }
}

// --- CLI Commands & Flags ---
const args = process.argv.slice(2);

function getArgValue(flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  const prefix = `${flag}=`;
  const match = args.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

if (args.includes("--status")) {
  const statusList = services.map((svc) => {
    const metaPath = path.join(LOG_DIR, `${svc.name}.meta.json`);
    let meta = { name: svc.name, port: svc.port, status: "stopped", pid: null };
    if (existsSync(metaPath)) {
      try {
        meta = JSON.parse(readFileSync(metaPath, "utf8"));
      } catch {}
    }
    return meta;
  });
  console.log(JSON.stringify(statusList, null, 2));
  process.exit(0);
}

const singleStart = getArgValue("--start") || getArgValue("--only") || getArgValue("--service");
const singleStop = getArgValue("--stop");

if (singleStop) {
  const target = services.find((s) => s.name === singleStop || s.name.includes(singleStop));
  if (!target) {
    console.error(`Service not found: ${singleStop}`);
    process.exit(1);
  }
  const metaPath = path.join(LOG_DIR, `${target.name}.meta.json`);
  logInfo(`Stopping service ${target.name} (port ${target.port})...`, target.name);
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      if (meta.pid) {
        try {
          if (process.platform === "win32") {
            execSync(`taskkill /F /T /PID ${meta.pid}`);
          } else {
            process.kill(meta.pid, "SIGTERM");
          }
        } catch {}
      }
    } catch {}
  }
  recordServiceMeta(target, null, "stopped");
  logInfo(`Service ${target.name} stopped.`, target.name);
  process.exit(0);
}

if (singleStart) {
  const target = services.find((s) => s.name === singleStart || s.name.includes(singleStart));
  if (!target) {
    console.error(`Service not found: ${singleStart}`);
    process.exit(1);
  }
  startService(target);
} else {
  // Selective service targeting: the dev-server coordinator sets DEV_ALL_ONLY to a
  // comma-separated service list when a completed Build Set should (re)start only
  // the services whose code genuinely changed (plus any still-needed running
  // ones + the always-on API server). Unset => start ALL services, unchanged.
  const onlyEnv = (process.env.DEV_ALL_ONLY || "").trim();
  const onlySet = onlyEnv
    ? new Set(onlyEnv.split(",").map((s) => s.trim()).filter(Boolean))
    : null;
  const toStart = onlySet ? services.filter((s) => onlySet.has(s.name)) : services;
  if (onlySet) {
    logInfo(`DEV_ALL_ONLY set -> starting only: ${toStart.map((s) => s.name).join(", ") || "(none)"}`);
  }
  for (const svc of toStart) {
    startService(svc);
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logInfo("\nStopping all services...");
  for (const [name, child] of runningChildren.entries()) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /T /PID ${child.pid}`);
      } else {
        child.kill("SIGTERM");
      }
    } catch {}
    const svc = services.find((s) => s.name === name);
    if (svc) recordServiceMeta(svc, null, "stopped");
  }
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
