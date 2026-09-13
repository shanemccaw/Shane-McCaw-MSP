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
const svcLogBytes = new Map();

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
      const svcPrevLog = path.join(LOG_DIR, `${serviceName}.prev.log`);
      appendFileSync(svcLog, text);
      const bytes = (svcLogBytes.get(serviceName) || 0) + Buffer.byteLength(text);
      if (bytes > MAX_LOG_BYTES) {
        rotateFile(svcLog, svcPrevLog);
        svcLogBytes.set(serviceName, 0);
      } else {
        svcLogBytes.set(serviceName, bytes);
      }
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
// Single source of truth: scripts/dev-server/services.json (Git #1782). The same file
// is read by desktop/BuildConsole/Services/DevServicesManager.cs at startup, so a new
// artifact needs exactly one edit — this file's `services` array — to show up both here
// and in BuildConsole's title-bar Services menu.
const servicesConfigPath = path.join(repoRoot, "scripts", "dev-server", "services.json");
const services = JSON.parse(readFileSync(servicesConfigPath, "utf8")).services;

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
    // windowsHide (Git #3846): dev-all.mjs itself is usually launched detached/
    // consoleless (see scripts/dev-server/server-process.mjs and
    // refresh-main-server.mjs), so a real console-subsystem child spawned here
    // with no inherited console gets its OWN new visible window on Windows.
    const child = spawn(cmd, args, { cwd, env, shell: false, windowsHide: true });
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
    // windowsHide (Git #3846): see runStep() above — same consoleless-parent
    // hazard applies to the real, long-running api-server child.
    const child = spawn("node", ["--enable-source-maps", "./dist/index.mjs"], {
      cwd,
      env,
      shell: false,
      windowsHide: true,
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
  // windowsHide (Git #3846): same consoleless-parent hazard — `shell: true`
  // here also spawns a real cmd.exe host, which would otherwise get its own
  // visible console too.
  const child = spawn("pnpm", ["--filter", svc.pkg, "run", "dev"], {
    cwd: repoRoot,
    shell: true,
    env,
    windowsHide: true,
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
  // Git #3085 — explicit per-service local-dev mount base, read from services.json's
  // own `basePath` field (see its $comment). Historically every service got a flat
  // BASE_PATH="/" here regardless of what it actually mounts under in Staging/Production,
  // and portal.tsx's vite.config.ts alone carried an implicit "unset/'/' -> '/portal/'"
  // fallback to compensate. Making the value explicit here means local dev, Staging
  // (.replit-artifact/artifact.toml), and Production (.replit) all state the same
  // BASE_PATH outright instead of one of them relying on a fallback in a single file.
  const env = {
    ...process.env,
    ...fileEnv,
    PORT: String(svc.port),
    BASE_PATH: svc.basePath ?? "/",
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

const USAGE = `Usage: node scripts/dev-all.mjs [flag]

With no flag, starts every configured service from scripts/dev-server/services.json
(killing whatever currently holds each service's port first). This is destructive to
anything already listening on those ports — see the worktree guard below.

Flags:
  --help, -h            Show this usage and exit. Touches no running process.
  --status              Print each service's recorded status as JSON and exit.
  --start, --only, --service <name>   Start only the named service.
  --stop <name>          Stop only the named service.

Env:
  DEV_ALL_ONLY=a,b,c     Start only these services (used by the Build Set coordinator).
  DEV_ALL_FORCE=1        Required to run the default full-stack start from an agent
                         worktree (a cwd under C:\\wt\\...) — see the worktree guard.
`;

const KNOWN_FLAGS = new Set([
  "--help",
  "-h",
  "--status",
  "--start",
  "--only",
  "--service",
  "--stop",
]);

function isKnownArg(arg, index) {
  const bare = arg.split("=")[0];
  if (KNOWN_FLAGS.has(bare)) return true;
  // A bare value following --start/--only/--service/--stop (space-separated form).
  const prev = args[index - 1];
  if (prev && KNOWN_FLAGS.has(prev) && prev !== "--help" && prev !== "-h" && prev !== "--status") {
    return true;
  }
  return false;
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const unrecognized = args.filter((a, i) => !isKnownArg(a, i));
if (unrecognized.length > 0) {
  console.error(`Unrecognized argument(s): ${unrecognized.join(" ")}\n`);
  process.stderr.write(USAGE);
  process.exit(1);
}

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

// Git #3797 worktree guard: dev services are meant to run from the main checkout
// only (CLAUDE.md's "Mandatory worktree isolation" section) — an agent worktree is
// provisioned at C:\wt\<id> (see scripts/dev-server/provision-worktree.mjs) and is
// never the right place to kill live ports and restart the full stack from, since
// the resulting children get rooted in the worktree path instead of the main
// checkout (Git #3647 incident: services ended up serving worktree-rooted code on
// shared ports, others left down with nothing restarting them). Only the default
// full-stack start is gated here — --status/--stop/--start <one service> are not
// destructive to the whole stack and are left alone.
const isAgentWorktree = /[\\/]wt[\\/]/i.test(repoRoot);
if (!singleStart && !singleStop && isAgentWorktree && process.env.DEV_ALL_FORCE !== "1") {
  console.error(
    `Refusing to run the default full-stack start from an agent worktree:\n` +
      `  ${repoRoot}\n\n` +
      `Dev services run from the main checkout (see CLAUDE.md's "Mandatory worktree\n` +
      `isolation" section) — this path kills whatever is on each service's port and\n` +
      `restarts it rooted in this worktree instead, which is exactly the Git #3647\n` +
      `incident. Run dev-all.mjs from the main checkout, or pass --status / --start\n` +
      `<service> / --stop <service> for a non-destructive single-service action.\n` +
      `Set DEV_ALL_FORCE=1 to override if you genuinely mean to do this.\n`
  );
  process.exit(1);
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
