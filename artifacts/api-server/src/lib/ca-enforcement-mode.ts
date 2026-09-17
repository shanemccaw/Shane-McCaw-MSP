/**
 * ca-enforcement-mode.ts
 *
 * Git #4522 — Shane's decision on #4518: Conditional Access policies are created
 * report-only (monitor-first) unless a run EXPLICITLY asks otherwise, and a
 * report-only policy is promoted to enforced only after its real sign-in impact
 * has been reviewed (ca-policy-promotion.ts).
 *
 * Two pieces live here, both pure:
 *
 *   1. The run-time choice. A Config Pack run carries `caEnforcementMode`:
 *        - "monitor-first" (the default, and what an omitted value means) — every
 *          CA create template resolves `{{caPolicyState}}` to
 *          `enabledForReportingButNotEnforced`;
 *        - "immediate" — the deliberate override: the same templates resolve to
 *          `enabled`. It is a named parameter on the run request, stamped onto the
 *          run payload (and so onto wf_runs.payload) and audited, never a variable
 *          a caller can slip in through `variables`.
 *
 *   2. The classification every gate shares: does a resolved Graph write leave a
 *      Conditional Access policy ENFORCING? A create with `state: "enabled"`, or a
 *      PATCH of an existing policy to `state: "enabled"`. Such a write is refused
 *      unless it comes from a verified promotion or an explicit "immediate" pack
 *      run — see tenant-write-preconditions (typed refusal before anything is
 *      authorized) and runBaselineTemplateAgainstTenant (the executor backstop that
 *      also covers Launch Control and the admin write-action routes).
 */

export const CA_ENFORCEMENT_MODES = ["monitor-first", "immediate"] as const;
export type CaEnforcementMode = (typeof CA_ENFORCEMENT_MODES)[number];
export const DEFAULT_CA_ENFORCEMENT_MODE: CaEnforcementMode = "monitor-first";

export const CA_STATE_REPORT_ONLY = "enabledForReportingButNotEnforced";
export const CA_STATE_ENABLED = "enabled";

/** Payload keys the orchestrator owns. Never accepted from caller `variables`. */
export const CA_ENFORCEMENT_PAYLOAD_KEYS = ["caEnforcementMode", "caPolicyState"] as const;

/** `undefined` → the default; anything that is not a known mode → null (reject). */
export function parseCaEnforcementMode(value: unknown): CaEnforcementMode | null {
  if (value === undefined || value === null || value === "") return DEFAULT_CA_ENFORCEMENT_MODE;
  return (CA_ENFORCEMENT_MODES as readonly unknown[]).includes(value) ? (value as CaEnforcementMode) : null;
}

/** The state a CA create template resolves to under `mode`. */
export function caPolicyStateForMode(mode: CaEnforcementMode): string {
  return mode === "immediate" ? CA_STATE_ENABLED : CA_STATE_REPORT_ONLY;
}

/**
 * The payload a template resolves against when the caller did not choose a mode:
 * `{{caPolicyState}}` falls back to report-only rather than interp's "" (which
 * would send an invalid `state` to Graph). A caller-provided value is left alone —
 * whether it is ALLOWED to be "enabled" is the enforcement gate's job, not this one.
 */
export function withCaPolicyStateDefault(payload: Record<string, unknown>): Record<string, unknown> {
  const current = payload["caPolicyState"];
  if (typeof current === "string" && current.trim() !== "") return payload;
  return { ...payload, caPolicyState: CA_STATE_REPORT_ONLY };
}

const CA_POLICIES_PATH = "/identity/conditionalaccess/policies";

function normalizePath(endpoint: string): string {
  return endpoint
    .trim()
    .split("?")[0]!
    .toLowerCase()
    .replace(/^https:\/\/graph\.microsoft\.com/, "")
    .replace(/^\/(v1\.0|beta)(?=\/)/, "")
    .replace(/\/+$/, "");
}

export type CaEnforcementWriteKind = "create_enforced" | "enable_existing";

/**
 * Whether a RESOLVED write (placeholders already substituted) leaves a Conditional
 * Access policy enforcing, and how. Null for every other write — including a
 * report-only create, a disable, or a PATCH that does not touch `state`.
 */
export function classifyCaEnforcementWrite(write: {
  method: string;
  endpoint: string;
  body: unknown;
}): CaEnforcementWriteKind | null {
  const body = write.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  if ((body as Record<string, unknown>)["state"] !== CA_STATE_ENABLED) return null;
  const method = write.method.trim().toUpperCase();
  const path = normalizePath(write.endpoint);
  if (method === "POST" && path === CA_POLICIES_PATH) return "create_enforced";
  if ((method === "PATCH" || method === "PUT") && path.startsWith(`${CA_POLICIES_PATH}/`)) {
    const rest = path.slice(CA_POLICIES_PATH.length + 1);
    if (rest.length > 0 && !rest.includes("/")) return "enable_existing";
  }
  return null;
}

/**
 * The in-process authorization a caller hands runBaselineTemplateAgainstTenant for
 * a write classifyCaEnforcementWrite flags. Never read from a request body or a
 * run payload a client could shape — only constructed by the promotion workflow
 * (after its impact review) and by the workflow node for a pack run whose payload
 * the orchestrator stamped "immediate".
 */
export type CaEnforcementAuthorization =
  | { kind: "verified_promotion"; promotionId: number }
  | { kind: "config_pack_immediate"; packKey: string };

/** Customer-safe explanation for a refused enforcement write. */
export function caEnforcementRefusalMessage(kind: CaEnforcementWriteKind): string {
  return kind === "create_enforced"
    ? "Conditional Access policies are created report-only by default. Creating one already enforced needs an explicit " +
        "\"immediate\" enforcement mode on a Config Pack run."
    : "Turning a report-only Conditional Access policy on requires the promotion workflow, which reviews the policy's real " +
        "sign-in impact before it is enforced. Nothing was written.";
}
