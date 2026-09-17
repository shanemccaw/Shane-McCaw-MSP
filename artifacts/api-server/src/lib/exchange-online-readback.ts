/**
 * exchange-online-readback.ts — #4429
 *
 * Read-back verification for `exchange-online://` write templates.
 *
 * The #3948 transport's success signal is "the cmdlet did not throw" — honest
 * about what it observed, but not proof the setting landed. #4429 is the live
 * counterexample: `Set-Mailbox -MaxSendSize "0B"` against the testbed tenant
 * returned container 200 (audit 70) while `Get-Mailbox` still showed the 35 MB
 * org default at +3 and +20 minutes. EXO emits a WARNING, not an error, when a
 * Set-* cmdlet completes without changing anything, and warnings never fail a
 * cmdlet. For a compromise-response action ("cut this mailbox off") a
 * success-without-effect is worse than a failure.
 *
 * So a template can opt into a read-back through its own
 * `success_criteria.readBack`:
 *
 *   {
 *     "expectStatus": 200,
 *     "readBack": {
 *       "cmdletKey": "get-mailbox-send-restrictions",
 *       "params":    { "Identity": "Identity" },
 *       "expect":    { "MaxSendSizeBytes": 0 }
 *     }
 *   }
 *
 * - `cmdletKey` names a READ entry in services/ps-execution/cmdlet-catalog.ps1
 *   (the container's allowlist stays the security boundary; an unknown key is a
 *   container 400, which this module reports as an unverified FAILURE).
 * - `params` maps the read cmdlet's parameter name → the key in the write's
 *   resolved body whose value to pass. Values therefore only ever come from the
 *   same resolved body the write sent — never free text in the spec.
 * - `expect` is property → expected value, compared against EVERY item the read
 *   returns (an Identity-scoped read returns one; zero items is unverified).
 *
 * Convergence mirrors #2981's discipline: the end state must be corroborated
 * by a real read inside a bounded budget, otherwise the step FAILS. Unlike
 * the Entra case, a single matching read is accepted — the Exchange directory
 * does not serve a matching value for a setting that was never written, so the
 * hazard here is lag in the "not yet" direction, which retries absorb. The honest
 * limitation: EXO replication slower than the whole budget reports failure for a
 * write that may land later. That is the right side to err on for this class of
 * action, and every opted-in write is idempotent — re-running converges.
 *
 * Deliberately free of db / ps-execution-client imports so it is unit-testable
 * with injected fakes (same posture as mfa-reregistration.ts).
 */

export interface ExchangeOnlineReadBackSpec {
  cmdletKey: string;
  params: Record<string, string>;
  expect: Record<string, string | number | boolean | null>;
}

export interface ReadBackPolicy {
  /** Delay before each read, in order. Its length is the read cap. */
  delaysMs: number[];
  /** Wall-clock budget across the whole loop; no read starts once exceeded. */
  budgetMs: number;
}

/**
 * First read after 5s, then backing off. Total scheduled wait 95s — inside a
 * synchronous admin/test request, and past the ~minute EXO typically takes to
 * reflect a Set-Mailbox change on Get-Mailbox (#3948's quota/archive writes
 * read back within minutes; nothing faster was measured).
 */
export const DEFAULT_READBACK_POLICY: ReadBackPolicy = {
  delaysMs: [5_000, 10_000, 20_000, 30_000, 30_000],
  budgetMs: 150_000,
};

const CMDLET_KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Pull a read-back spec out of a template's stored success_criteria.
 * - `{ ok: true, spec: null }` — the template did not opt in.
 * - `{ ok: false }` — it opted in with a malformed spec. The caller must fail
 *   the execution closed BEFORE firing the write: a template that asked to be
 *   verified must never silently run unverified because its spec had a typo.
 */
export function parseReadBackSpec(
  successCriteria: unknown,
): { ok: true; spec: ExchangeOnlineReadBackSpec | null } | { ok: false; error: string } {
  if (!successCriteria || typeof successCriteria !== "object" || Array.isArray(successCriteria)) {
    return { ok: true, spec: null };
  }
  const raw = (successCriteria as Record<string, unknown>).readBack;
  if (raw === undefined || raw === null) return { ok: true, spec: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "success_criteria.readBack must be an object" };
  }
  const rb = raw as Record<string, unknown>;

  if (typeof rb.cmdletKey !== "string" || !CMDLET_KEY_RE.test(rb.cmdletKey)) {
    return { ok: false, error: "success_criteria.readBack.cmdletKey must be a kebab-case ps-execution catalog key" };
  }

  if (!rb.params || typeof rb.params !== "object" || Array.isArray(rb.params)) {
    return { ok: false, error: "success_criteria.readBack.params must be an object of readParam → body key" };
  }
  const params: Record<string, string> = {};
  for (const [readParam, bodyKey] of Object.entries(rb.params as Record<string, unknown>)) {
    if (typeof bodyKey !== "string" || !bodyKey) {
      return { ok: false, error: `success_criteria.readBack.params.${readParam} must name a body key` };
    }
    params[readParam] = bodyKey;
  }

  if (!rb.expect || typeof rb.expect !== "object" || Array.isArray(rb.expect)) {
    return { ok: false, error: "success_criteria.readBack.expect must be an object of property → expected value" };
  }
  const expectEntries = Object.entries(rb.expect as Record<string, unknown>);
  if (expectEntries.length === 0) {
    return { ok: false, error: "success_criteria.readBack.expect must assert at least one property" };
  }
  const expect: Record<string, string | number | boolean | null> = {};
  for (const [prop, value] of expectEntries) {
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      return { ok: false, error: `success_criteria.readBack.expect.${prop} must be a scalar` };
    }
    expect[prop] = value as string | number | boolean | null;
  }

  return { ok: true, spec: { cmdletKey: rb.cmdletKey, params, expect } };
}

/**
 * Build the read cmdlet's params from the write's resolved body. Fails when a
 * mapped body key is absent/empty — reading back "whatever Get-Mailbox returns
 * with no Identity" would compare against the wrong object entirely.
 */
export function buildReadBackParams(
  spec: ExchangeOnlineReadBackSpec,
  body: Record<string, unknown>,
): { ok: true; params: Record<string, unknown> } | { ok: false; error: string } {
  const params: Record<string, unknown> = {};
  for (const [readParam, bodyKey] of Object.entries(spec.params)) {
    const value = body[bodyKey];
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
      return { ok: false, error: `read-back param '${readParam}' maps to body key '${bodyKey}', which has no value` };
    }
    params[readParam] = value;
  }
  return { ok: true, params };
}

function valuesMatch(actual: unknown, expected: string | number | boolean | null): boolean {
  if (expected === null) return actual === null || actual === undefined;
  if (typeof expected === "number") {
    const n = typeof actual === "number" ? actual : typeof actual === "string" && actual.trim() !== "" ? Number(actual) : NaN;
    return Number.isFinite(n) && n === expected;
  }
  if (typeof expected === "boolean") {
    if (typeof actual === "boolean") return actual === expected;
    return typeof actual === "string" && actual.toLowerCase() === String(expected);
  }
  return typeof actual === "string" && actual.toLowerCase() === expected.toLowerCase();
}

export interface ReadBackMismatch {
  property: string;
  expected: string | number | boolean | null;
  actual: unknown;
}

/** Compare every returned item against `expect`. Zero items never matches. */
export function evaluateReadBack(
  items: unknown[],
  expect: ExchangeOnlineReadBackSpec["expect"],
): { matched: boolean; mismatches: ReadBackMismatch[] } {
  if (items.length === 0) {
    return { matched: false, mismatches: [{ property: "<items>", expected: "at least one item", actual: 0 }] };
  }
  const mismatches: ReadBackMismatch[] = [];
  for (const item of items) {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    for (const [property, expected] of Object.entries(expect)) {
      const actual = record[property];
      if (!valuesMatch(actual, expected)) mismatches.push({ property, expected, actual: actual ?? null });
    }
  }
  return { matched: mismatches.length === 0, mismatches };
}

export interface ReadBackDeps {
  read: (cmdletKey: string, params: Record<string, unknown>) => Promise<unknown[]>;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface ReadBackOutcome {
  verified: boolean;
  reads: number;
  waitedMs: number;
  /** Mismatches seen on the LAST successful read (empty when verified). */
  lastMismatches: ReadBackMismatch[];
  lastReadError?: string;
  /** Set when verified=false. */
  unverifiedReason?: "not_applied" | "read_failed" | "budget_exhausted";
}

/**
 * Read until `expect` matches or the policy runs out. A read error is retried
 * like a mismatch (a transient container/session hiccup is not evidence either
 * way); the reason recorded is whichever class the LAST read ended in.
 */
export async function runReadBackConvergence(
  spec: ExchangeOnlineReadBackSpec,
  params: Record<string, unknown>,
  deps: ReadBackDeps,
  policy: ReadBackPolicy = DEFAULT_READBACK_POLICY,
): Promise<ReadBackOutcome> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  let reads = 0;
  let waitedMs = 0;
  let lastMismatches: ReadBackMismatch[] = [];
  let lastReadError: string | undefined;
  let lastWasError = false;

  for (const delay of policy.delaysMs) {
    if (now() - started + delay > policy.budgetMs) {
      return {
        verified: false, reads, waitedMs, lastMismatches, lastReadError,
        unverifiedReason: reads === 0 ? "budget_exhausted" : lastWasError ? "read_failed" : "not_applied",
      };
    }
    await deps.sleep(delay);
    waitedMs += delay;
    reads++;
    let items: unknown[];
    try {
      items = await deps.read(spec.cmdletKey, params);
    } catch (err) {
      lastReadError = err instanceof Error ? err.message : String(err);
      lastWasError = true;
      continue;
    }
    lastWasError = false;
    const evaluation = evaluateReadBack(items, spec.expect);
    if (evaluation.matched) {
      return { verified: true, reads, waitedMs, lastMismatches: [], lastReadError };
    }
    lastMismatches = evaluation.mismatches;
  }

  return {
    verified: false, reads, waitedMs, lastMismatches, lastReadError,
    unverifiedReason: reads === 0 ? "budget_exhausted" : lastWasError ? "read_failed" : "not_applied",
  };
}
