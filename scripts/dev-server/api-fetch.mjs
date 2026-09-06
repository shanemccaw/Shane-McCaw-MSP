#!/usr/bin/env node
// scripts/dev-server/api-fetch.mjs
//
// A REAL readiness/liveness signal for a caller hitting the local api-server --
// Git #1855.
//
// #1793's capability survey ran for over an hour against :8080. A concurrent
// build finished mid-survey; the coordinator restarted the api-server; every
// in-flight request failed with a raw `TypeError: fetch failed`, and the first
// survey run recorded 36 of those transport failures as if they were real
// per-cmdlet observations -- a false-negative capability table, discarded and
// re-run. The fix that shipped for that ONE script (`ps-capability-survey.ts`'s
// `ApiServerUnreachableError` / `callCmdletWaitingOutRestarts`) blind-retries any
// connection failure, unable to say whether it's actually mid-restart or
// genuinely down. This module is the general, reusable version any JS/TS caller
// can use: it reads the coordinator's OWN real state (current-cycle.json's
// phase, the restart mutex's owner) instead of guessing, retries only what's
// actually safe to retry, and reports that real state in the error it eventually
// throws so a caller that gives up can say WHY, not just "fetch failed".
//
// Usage (from a plain Node script or -- via tsx, see the .d.mts sibling -- a
// TypeScript one):
//
//   import { fetchResilient, describeRestartState, ApiServerUnreachableError } from
//     "<repo>/scripts/dev-server/api-fetch.mjs";
//   import { loadConfig } from "<repo>/scripts/dev-server/config.mjs";
//
//   const config = loadConfig();
//   const res = await fetchResilient(url, { method: "POST", ... }, { config });
//
// `fetchResilient` retries ONLY a genuine transport failure (connection
// refused/reset, "fetch failed", etc.) -- never an HTTP error response, never a
// client-side deadline (AbortSignal.timeout firing means the server accepted the
// connection and then went quiet, a real hang, not a restart). Exhausting the
// retry budget throws `ApiServerUnreachableError`, carrying the coordinator's own
// state at the last attempt, so the caller can log/report the REAL reason
// instead of writing its own guesswork the way #1793's driver had to.

import { existsSync, readFileSync } from "node:fs";
import { readOwner, isHeld } from "./lock.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ApiServerUnreachableError extends Error {}

function readJson(f) {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The coordinator's own real state, read straight off its state files -- the
 * same ones status.mjs surfaces -- rather than inferred from a failed fetch.
 * `cycleActive: true` with `phase: "restarting"` (or `"merging"`, which precedes
 * it) is real, first-party evidence a drop is a coordinator restart, not the
 * server having crashed independently.
 */
export function describeRestartState(config) {
  const currentCycle = existsSync(config.currentCycleFile) ? readJson(config.currentCycleFile) : null;
  const owner = readOwner(config.lockDir);
  return {
    cycleActive: !!currentCycle,
    phase: currentCycle?.phase ?? null,
    cycleId: currentCycle?.cycleId ?? null,
    lockHeld: isHeld(config),
    lockOwnerPid: owner?.pid ?? null,
  };
}

/**
 * A genuine transport failure -- the socket never connected, or dropped mid-
 * request. Node/undici's fetch surfaces this as `TypeError: fetch failed` with
 * the real errno on `.cause.code`. Deliberately EXCLUDES AbortError/TimeoutError
 * (a client-side deadline firing on a connection that WAS accepted): that's a
 * real hang the caller should see as-is, not something to retry as a restart.
 */
function isTransportError(err) {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError" || err.name === "TimeoutError") return false;
  const cause = err.cause;
  const code = cause && typeof cause === "object" ? cause.code : null;
  return (
    (typeof err.message === "string" && err.message.includes("fetch failed")) ||
    ["ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT", "ENOTFOUND"].includes(code)
  );
}

/**
 * fetch(), retried across a transport failure only, waiting out a coordinator
 * restart instead of surfacing the raw `TypeError: fetch failed` to the caller.
 *
 * @param url          request URL
 * @param fetchOpts    normal fetch() options
 * @param opts.config       loadConfig() result -- required to read real
 *                          coordinator state for the retry decision + error text
 * @param opts.maxAttempts  default 40 (with the default 15s delay, ~10 minutes --
 *                          comfortably above the 510s real-world rebuild window
 *                          #1855 documented)
 * @param opts.retryDelayMs default 15000
 * @param opts.onRetry       ({attempt, maxAttempts, err, state}) => void, e.g. to log
 * @returns the real Response on success
 * @throws  ApiServerUnreachableError after exhausting retries, or the ORIGINAL
 *          error immediately for anything that isn't a transport failure (a real
 *          HTTP error is not thrown here at all -- fetch() only throws on
 *          transport failure/deadline, never on a non-2xx response)
 */
export async function fetchResilient(
  url,
  fetchOpts = {},
  { config, maxAttempts = 40, retryDelayMs = 15_000, onRetry } = {}
) {
  if (!config) throw new Error("fetchResilient requires { config } (scripts/dev-server/config.mjs loadConfig() result)");
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetch(url, fetchOpts);
    } catch (err) {
      if (!isTransportError(err)) throw err;
      lastErr = err;
      const state = describeRestartState(config);
      if (typeof onRetry === "function") onRetry({ attempt, maxAttempts, err, state });
      if (attempt === maxAttempts) break;
      await sleep(retryDelayMs);
    }
  }
  const state = describeRestartState(config);
  const stateDesc = state.cycleActive
    ? `coordinator cycle ${state.cycleId} was in phase "${state.phase}"`
    : state.lockHeld
      ? `coordinator lock is held (pid ${state.lockOwnerPid}) but no cycle phase was recorded`
      : "the coordinator reports no active cycle and no held lock (this looks like a REAL failure, not a restart)";
  throw new ApiServerUnreachableError(
    `${url} stayed unreachable across ${maxAttempts} attempts (~${Math.round((maxAttempts * retryDelayMs) / 60_000)} min). ` +
      `At the last attempt, ${stateDesc}. Refusing to let a caller mistake a dropped-during-restart transport failure for a ` +
      `real per-request result.`,
    { cause: lastErr }
  );
}
