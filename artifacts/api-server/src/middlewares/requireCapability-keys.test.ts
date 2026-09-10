/**
 * Every capability key reaching `requireCapability` is a REAL one (#2460, part of #1696).
 *
 * #2460 replaced `requireRole(minimumRole: MspRole)` with
 * `requireCapability(capability: string)` at 631 route gates. That trade is
 * deliberate and it has a cost: `MspRole` was a union type, so a typo at a call
 * site was a compile error, and a bare `string` is not. This test is what buys that
 * back — mechanically, over the real source, rather than by trusting review.
 *
 * It is also #1696's requirement 3 made real: *"The capability catalog must be
 * enumerable. #1698's gating pass has to verify that every route carries a
 * requirement, mechanically. That is only possible if capabilities are a real,
 * listable set rather than strings appearing ad hoc."* Here the listable set is
 * `RBAC_CAPABILITIES`, and the ad-hoc strings are the thing being checked against it.
 *
 * The failure this prevents is not hypothetical and is not loud. A misspelled key
 * fails CLOSED — `requireCapability` reports `unavailable` and answers 503, which is
 * the correct safe behaviour but presents as "the RBAC model is unseeded", not as
 * "this one route has a typo". One route 503-ing among 631 that work is exactly the
 * kind of thing that reaches production.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { RBAC_CAPABILITIES } from "@workspace/db/rbac/capabilities";
import { LADDER_CAPABILITY_KEYS, LEGACY_ROLE_ORDER } from "@workspace/db/rbac/legacy-ladder";

const SRC = fileURLToPath(new URL("..", import.meta.url));

/**
 * The middleware's own definition, and this file. Both mention the call shape in
 * prose and in a type signature; neither is a call site. Excluded by path so the
 * scan never has to reason about which mention is which.
 */
const NOT_CALL_SITES = new Set([
  "middlewares/requireAuth.ts",
  "middlewares/rbac-ladder.ts",
  "middlewares/requireCapability-keys.test.ts",
]);

/** Every .ts file under src/ that could legitimately hold a gate. */
function candidateFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
  };
  walk(SRC);
  return out.filter((f) => !NOT_CALL_SITES.has(rel(f)));
}

function rel(file: string): string {
  return file.slice(SRC.length).replace(/\\/g, "/");
}

/**
 * Source with comments removed.
 *
 * Real gates are code. Comments across this codebase discuss `requireCapability`
 * and the retired `requireRole` at length — scanning them would report prose as a
 * defect, and (worse) a reader fixing the "failure" would edit a comment and think
 * the check was satisfied.
 */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** `requireCapability("<key>")` — the only form the codemod produced, and the only one allowed. */
const LITERAL_CALL = /requireCapability\(\s*"([^"]*)"\s*\)/g;
/** Any call at all, so a non-literal argument can be caught rather than skipped. */
const ANY_CALL = /requireCapability\(\s*([^)]*?)\s*\)/g;

interface Site {
  readonly file: string;
  readonly key: string;
}

const sites: Site[] = [];
const dynamicSites: string[] = [];

for (const file of candidateFiles()) {
  const source = code(file);
  for (const match of source.matchAll(LITERAL_CALL)) {
    sites.push({ file: rel(file), key: match[1]! });
  }
  for (const match of source.matchAll(ANY_CALL)) {
    const arg = match[1]!;
    if (/^"[^"]*"$/.test(arg)) continue;
    // Zero arguments cannot be a real gate — `requireCapability()` does not compile.
    // What this matches is a `describe("requireCapability()")` title inside a string,
    // which the comment-stripper cannot see into and which is not a call.
    if (arg === "") continue;
    // `ladderCapabilityKey(rung)` is the one deliberate non-literal: the shim's own
    // rung → key function, used by the ladder's acceptance test to build a route per
    // rung. Its range is exactly the key set this file already enumerates.
    if (arg.startsWith("ladderCapabilityKey(")) continue;
    dynamicSites.push(`${rel(file)}: requireCapability(${arg})`);
  }
}

const CATALOGUED_MSP_KEYS = new Set(
  RBAC_CAPABILITIES.filter((c) => c.system === "msp").map((c) => c.key),
);

describe("#2460 — requireCapability call sites name catalogued capabilities", () => {
  it("finds the real call sites at all (a zero here would make every assertion vacuous)", () => {
    // Guard against the scan silently matching nothing — a regex that stopped
    // matching would turn this whole file into a test that always passes.
    expect(sites.length).toBeGreaterThan(400);
  });

  it("every key is in the capability catalog", () => {
    const unknown = sites.filter((s) => !CATALOGUED_MSP_KEYS.has(s.key));
    expect(
      unknown.map((s) => `${s.file} -> ${s.key}`),
      "an uncatalogued key fails closed as a 503 that LOOKS like an unseeded model, not like a typo",
    ).toEqual([]);
  });

  it("every key is one the ladder gate can actually decide", () => {
    // `requireCapability` reads the seven platform-scoped `ladder.*` mapping rows and
    // nothing else (see rbac-ladder.ts's header on why an MSP-scoped override of a
    // ladder row must never be honoured). A capability that is catalogued but NOT a
    // ladder rung — `msp:purchases.approve`, say — is real, but this middleware is
    // not what answers it; a route needing one asks the request-scoped capability
    // check instead. Passing one here would 503.
    const ladderKeys = new Set(LEGACY_ROLE_ORDER.map((r) => LADDER_CAPABILITY_KEYS[r]));
    const undecidable = sites.filter((s) => !ladderKeys.has(s.key));
    expect(
      undecidable.map((s) => `${s.file} -> ${s.key}`),
      "requireCapability decides ladder.* keys only",
    ).toEqual([]);
  });

  it("no call site passes a non-literal, so this scan cannot be evaded", () => {
    // A dynamic key would be invisible to the scan above and to #1698's gating pass.
    // Every real gate is a constant requirement; if one ever genuinely needs to vary,
    // that is a design decision to make explicitly, not to discover from a 503.
    expect(dynamicSites).toEqual([]);
  });

  it("covers every ladder rung a route actually gates on, so the catalog is not carrying dead keys unnoticed", () => {
    // Informational-but-asserted: which rungs are genuinely in use. If this set ever
    // shrinks to one, the ladder has stopped being load-bearing and the `ladder.*`
    // capabilities can be retired outright — which is what #1698 will want to know.
    const used = new Set(sites.map((s) => s.key));
    expect(used.size).toBeGreaterThanOrEqual(3);
    for (const key of used) expect(CATALOGUED_MSP_KEYS.has(key)).toBe(true);
  });
});
