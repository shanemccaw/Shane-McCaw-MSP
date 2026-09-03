// scripts/dev-server/service-targeting.mjs
//
// SELECTIVE, SMART SERVICE TARGETING for Build Sets.
//
// Why this exists (Shane's own words): "I don't need all sites running at the
// same time. I hardly use the Admin Center. No need for Marketing to be on when
// I'm only working the Portal... The only thing that has to be on always is the
// API server. If only the Portal code changes, why does API need a rebuild? It
// just needs to be smarter to target its actual need."
//
// Build Sets (buildset.mjs / coordinator.mjs) already defer the restart until a
// whole stack of builds completes, then restart ONCE. This module makes that one
// restart SELECTIVE: instead of tearing down and rebuilding ALL services, it
// looks at the set's COMBINED changed-file paths and rebuilds/starts only the
// services whose real code genuinely changed.
//
//   - API Server is the one always-on service. It is kept running and is NEVER
//     rebuilt just because a front-end changed -- only when API code (or shared
//     code) actually changed. If it somehow isn't running, it is started.
//   - Each front-end (Marketing / Admin / Portal / Website) is (re)built only
//     when its own code -- or shared code it compiles against -- changed. A set
//     that didn't touch a front-end doesn't spin it up (that is the memory win
//     over the old "restart ALL services").
//
// This module is pure and depends only on git.mjs. The coordinator wires the
// resulting plan to the real per-service process control in server-process.mjs.

import { diffNameOnly } from "./git.mjs";

// The one always-on service. Never torn down/rebuilt just because a front-end
// changed; only rebuilt when its own (or shared) code changed.
export const ALWAYS_ON = "api-server";

// Service <-> real code-path mapping. Mirrors the `services` list in
// scripts/dev-all.mjs. `artifact` is the repo-relative directory prefix that
// owns each service's real, shipped code.
export const SERVICES = [
  { name: "api-server", title: "API Server", artifact: "artifacts/api-server/", alwaysOn: true },
  { name: "shane-mccaw-consulting", title: "Marketing", artifact: "artifacts/shane-mccaw-consulting/", alwaysOn: false },
  { name: "admin-panel", title: "Admin", artifact: "artifacts/admin-panel/", alwaysOn: false },
  { name: "portal", title: "Portal", artifact: "artifacts/portal/", alwaysOn: false },
  { name: "msp-website", title: "Website", artifact: "artifacts/msp-website/", alwaysOn: false },
  { name: "msp-console", title: "MSP Console", artifact: "artifacts/msp-console/", alwaysOn: false },
];

export const ALL_SERVICE_NAMES = SERVICES.map((s) => s.name);
export const FRONTENDS = SERVICES.filter((s) => !s.alwaysOn).map((s) => s.name);

function svcByName(name) {
  return SERVICES.find((s) => s.name === name) || null;
}
export function titleFor(name) {
  return svcByName(name)?.title || name;
}

// Shared code that every service compiles against. A change here conservatively
// forces ALL services to rebuild -- we can't cheaply resolve the exact per-package
// consumers of each lib, and running stale code is never acceptable (an extra
// rebuild is). Documented in scripts/dev-server/README.md.
const SHARED_DIR_PREFIXES = ["lib/", "packages/"];
const SHARED_ROOT_FILES = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
]);

// Paths that never affect a running service's compiled code: docs, test
// manifests, design references, logs, and the coordinator/tooling itself. A set
// whose combined diff touches only these triggers NO rebuild/start.
const IGNORE_DIR_PREFIXES = [
  "test-manifests/",
  "docs/",
  "design/",
  "Design/",
  ".logs/",
  ".scratch/",
  "scripts/", // dev-server coordinator + tooling; not shipped service code
  ".github/",
  ".claude/",
  ".vscode/",
];

function norm(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/**
 * Classify a list of changed, repo-relative file paths into the services they
 * affect.
 *
 * @returns {{
 *   changedServices: Set<string>, // specific services whose code changed
 *   shared: boolean,              // a shared-code change was seen (affects ALL)
 *   byService: Map<string,string[]>, // per-service the files that triggered it
 *   sharedFiles: string[],        // files classified as shared
 *   ignoredFiles: string[],       // files that trigger nothing (docs/tests/tooling)
 * }}
 * When `shared` is true, `changedServices` is the full service set.
 */
export function classifyChangedFiles(files) {
  const byService = new Map();
  const sharedFiles = [];
  const ignoredFiles = [];
  const add = (svc, f) => {
    if (!byService.has(svc)) byService.set(svc, []);
    byService.get(svc).push(f);
  };

  for (const raw of files || []) {
    const f = norm(raw);
    if (!f) continue;

    // 1) Most specific: a service's own artifact directory.
    const svc = SERVICES.find((s) => f.startsWith(s.artifact));
    if (svc) {
      add(svc.name, f);
      continue;
    }

    // 2) Shared code consumed by every service.
    const isShared =
      SHARED_DIR_PREFIXES.some((p) => f.startsWith(p)) ||
      (!f.includes("/") && SHARED_ROOT_FILES.has(f));
    if (isShared) {
      sharedFiles.push(f);
      continue;
    }

    // 3) Explicitly non-service (docs/tests/tooling), and 4) anything else
    //    unmatched -> ignored, but kept visible so an unclassified path can be
    //    promoted to a real rule later if it ever matters.
    ignoredFiles.push(f);
  }

  const shared = sharedFiles.length > 0;
  const changedServices = new Set(shared ? ALL_SERVICE_NAMES : byService.keys());
  return { changedServices, shared, byService, sharedFiles, ignoredFiles };
}

/**
 * Decide, per service, what the set's single restart should do.
 *
 * @param opts.changedServices Set<string> services whose code changed
 * @param opts.shared          boolean shared-code change (=> all services changed)
 * @param opts.running         Set<string> services currently running
 * @param opts.stopUnneeded    boolean stop running-but-unrelated FRONT-ENDS
 *                             (never API). Off by default so a set never yanks a
 *                             front-end Shane is actively using; opt in via
 *                             DEV_SET_STOP_UNNEEDED=1.
 * @param opts.byService       Map<string,string[]> trigger files per service
 * @param opts.sharedFiles     string[] shared trigger files
 *
 * Actions: 'rebuild' (stop+build+start), 'start' (bring up, no prior stop),
 * 'stop' (tear down), 'keep' (leave exactly as-is).
 */
export function planServiceTargeting({
  changedServices,
  shared = false,
  running = new Set(),
  stopUnneeded = false,
  byService = new Map(),
  sharedFiles = [],
} = {}) {
  const changed = shared ? new Set(ALL_SERVICE_NAMES) : new Set(changedServices);
  const isRunning = (n) => running.has(n);
  const triggersFor = (n) => {
    const own = byService.get(n) || [];
    const list = own.slice();
    if (shared) list.push(...sharedFiles.map((f) => `shared:${f}`));
    return list;
  };

  const actions = [];
  for (const s of SERVICES) {
    const n = s.name;
    const runningNow = isRunning(n);
    const triggers = triggersFor(n);
    let action;
    let reason;

    if (s.alwaysOn) {
      // API server: always-on. Rebuild only if its own/shared code changed.
      if (changed.has(n)) {
        action = "rebuild";
        reason = `API code changed (${triggers.join(", ") || "shared"})`;
      } else if (!runningNow) {
        action = "start";
        reason = "always-on API server was not running -> start it (no rebuild trigger)";
      } else {
        action = "keep";
        reason = "API code unchanged -> left running, NOT rebuilt";
      }
    } else {
      // Front-end: (re)build only when its own/shared code changed.
      if (changed.has(n)) {
        action = "rebuild";
        reason = `${s.title} code changed (${triggers.join(", ") || "shared"})`;
      } else if (runningNow && stopUnneeded) {
        action = "stop";
        reason = "not needed for this set's tests + DEV_SET_STOP_UNNEEDED=1 -> stop";
      } else {
        action = "keep";
        reason = runningNow
          ? "unchanged -> left running as-is (not rebuilt)"
          : "unchanged -> not needed by this set, not started";
      }
    }
    actions.push({ service: n, title: s.title, action, running: runningNow, triggers, reason });
  }

  const pick = (act) => actions.filter((a) => a.action === act).map((a) => a.service);
  const toRebuild = pick("rebuild");
  const toStart = pick("start");
  const toStop = pick("stop");
  const neededRunning = actions
    .filter((a) => a.action === "rebuild" || a.action === "start" || (a.action === "keep" && a.running))
    .map((a) => a.service);
  const noop = toRebuild.length === 0 && toStart.length === 0 && toStop.length === 0;

  return { actions, toRebuild, toStart, toStop, neededRunning, shared, noop };
}

/**
 * Compute the COMBINED changed-file footprint of a whole build set: the union of
 * each merged member's own changes, measured against the set's recorded base (the
 * server HEAD before the first member merged). A per-member three-dot diff
 * (base...memberCommit = the member's changes since it forked from base) keeps the
 * footprint precise even if unrelated ungrouped cycles advanced the server HEAD
 * between members.
 *
 * @returns {{ files: string[], base: string|null, resolvedFrom: 'set-base'|'base-ref'|'none', memberCount: number }}
 */
export function collectSetChangedFiles(W, set, { baseRef } = {}) {
  const ADVANCING = new Set(["merged", "already-live"]);
  const members = Object.values(set?.members || {}).filter(
    (m) => ADVANCING.has(m.status) && m.commit
  );
  let base = set?.baseHead || null;
  let resolvedFrom = base ? "set-base" : "none";
  if (!base && baseRef) {
    base = baseRef;
    resolvedFrom = "base-ref";
  }
  const files = new Set();
  if (base) {
    for (const m of members) {
      for (const f of diffNameOnly(W, base, m.commit, { threeDot: true })) files.add(f);
    }
  }
  return { files: [...files], base, resolvedFrom, memberCount: members.length };
}

/** Concise, human-readable one-liner describing a plan (for console/log tails). */
export function describePlan(plan, setName) {
  const parts = [];
  if (plan.toRebuild.length) parts.push(`rebuild [${plan.toRebuild.map(titleFor).join(", ")}]`);
  if (plan.toStart.length) parts.push(`start [${plan.toStart.map(titleFor).join(", ")}]`);
  if (plan.toStop.length) parts.push(`stop [${plan.toStop.map(titleFor).join(", ")}]`);
  const keeps = plan.actions.filter((a) => a.action === "keep").map((a) => a.title);
  if (keeps.length) parts.push(`keep [${keeps.join(", ")}]`);
  return `${setName ? `[set ${setName}] ` : ""}${parts.join("; ") || "no-op (nothing to do)"}`;
}
