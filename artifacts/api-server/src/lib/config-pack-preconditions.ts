/**
 * config-pack-preconditions.ts
 *
 * Git #4513 — tenant preconditions a Config Pack must satisfy BEFORE any write
 * fires. Two rules, evaluated in this order:
 *
 *   1. License. Every template step whose `write_action_catalog` row(s) record
 *      `required_license_skus` must be covered by the tenant's live, Enabled
 *      `/subscribedSkus` set — the same membership check Launch Control's
 *      proactive gate (#3947, msp-launch-control.ts) applies per action. A pack
 *      is all-or-nothing here: one unlicensed step refuses the whole run, so a
 *      run can never get part-way through and then 403 on a license gap. A
 *      failed SKU read fails CLOSED (unknown is not "licensed").
 *
 *   2. Security Defaults. A step that turns Security Defaults off
 *      (`PATCH /policies/identitySecurityDefaultsEnforcementPolicy` with
 *      anything other than `isEnabled: true`) removes the tenant's baseline MFA
 *      and legacy-auth block. It is only allowed when the SAME pack also creates
 *      a Conditional Access policy that genuinely replaces it on THIS tenant:
 *        - `POST /identity/conditionalAccess/policies`,
 *        - resolved `state` exactly `"enabled"` (report-only is not enforcement),
 *        - requires MFA, for All users, on All applications, for all client app
 *          types (which is what also shuts out legacy-auth clients),
 *        - with a recorded license requirement the tenant actually holds.
 *      Otherwise the pack is refused — Security Defaults is never switched off in
 *      the hope that a later step lands. This holds under every enforcement model
 *      #4518 may choose: if a pack's CA policy is deliberately report-only, its
 *      Security Defaults step simply never runs.
 *
 * Pure: the caller (prepareConfigPackRun) loads the step rows and the tenant SKU
 * set once, so this module is unit-testable without db or Graph.
 */

import { interp } from "./interp.ts";
import {
  describeRequiredLicense,
  tenantHasRequiredLicense,
  type TenantLicenseSkuResult,
} from "./license-gate.ts";
import { ConfigPackError } from "./config-pack-graph.ts";

/** One template step of a pack, with what the precondition rules need. */
export interface PackPreconditionStep {
  templateId: string;
  method: string;
  endpoint: string;
  bodyTemplate: Record<string, unknown>;
  /** Every non-empty `required_license_skus` list recorded for this template
   *  across its catalog rows. Each list must be satisfied (ANY one SKU of it). */
  requiredLicenseSkuLists: string[][];
}

const SECURITY_DEFAULTS_PATH = "/policies/identitysecuritydefaultsenforcementpolicy";
const CA_POLICIES_PATH = "/identity/conditionalaccess/policies";

/** Endpoint path, lowercased, without query string, trailing slash, or a
 *  leading Graph version segment. */
function normalizedPath(endpoint: string, payload: Record<string, unknown>): string {
  const resolved = interp(endpoint, payload) ?? endpoint;
  return resolved
    .split("?")[0]!
    .toLowerCase()
    .replace(/^https:\/\/graph\.microsoft\.com/, "")
    .replace(/^\/(v1\.0|beta)(?=\/)/, "")
    .replace(/\/+$/, "");
}

/** The body the engine would send — same JSON-string substitution
 *  resolveBaselineTemplateRequest uses. Null when it does not parse. */
function resolvedBody(step: PackPreconditionStep, payload: Record<string, unknown>): Record<string, unknown> | null {
  try {
    const out = JSON.parse(interp(JSON.stringify(step.bodyTemplate ?? {}), payload) ?? "{}");
    return out !== null && typeof out === "object" && !Array.isArray(out) ? (out as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function licenseSatisfied(step: PackPreconditionStep, tenantSkus: TenantLicenseSkuResult | null): boolean {
  if (step.requiredLicenseSkuLists.length === 0) return true;
  if (!tenantSkus || tenantSkus.error) return false;
  return step.requiredLicenseSkuLists.every((skus) => tenantHasRequiredLicense(skus, tenantSkus.skuPartNumbers));
}

/** True when the step would leave Security Defaults anything but enabled.
 *  An unresolvable or non-boolean `isEnabled` counts as disabling. */
export function isSecurityDefaultsDisableStep(
  step: PackPreconditionStep,
  payload: Record<string, unknown>,
): boolean {
  return securityDefaultsWriteEffect(step, payload) === "disable";
}

/** What a step does to Security Defaults: "enable" only for a resolved
 *  `isEnabled: true`, "disable" for any other write to the policy, null when the
 *  step does not write it. */
export function securityDefaultsWriteEffect(
  step: Pick<PackPreconditionStep, "method" | "endpoint" | "bodyTemplate">,
  payload: Record<string, unknown>,
): "enable" | "disable" | null {
  const method = step.method.toUpperCase();
  if (method !== "PATCH" && method !== "PUT") return null;
  if (normalizedPath(step.endpoint, payload) !== SECURITY_DEFAULTS_PATH) return null;
  const body = resolvedBody(step as PackPreconditionStep, payload);
  return body && body.isEnabled === true ? "enable" : "disable";
}

/** True when the step creates a Conditional Access policy (any state). */
export function isConditionalAccessPolicyCreate(
  step: Pick<PackPreconditionStep, "method" | "endpoint">,
  payload: Record<string, unknown>,
): boolean {
  return step.method.toUpperCase() === "POST" && normalizedPath(step.endpoint, payload) === CA_POLICIES_PATH;
}

/** Why a step is not an enforcing Security Defaults replacement, or null when it is one. */
export function enforcingReplacementGap(
  step: PackPreconditionStep,
  payload: Record<string, unknown>,
): string | null {
  if (step.method.toUpperCase() !== "POST" || normalizedPath(step.endpoint, payload) !== CA_POLICIES_PATH) {
    return "not a Conditional Access policy creation";
  }
  const body = resolvedBody(step, payload);
  if (!body) return "policy body does not resolve";
  const shapeGap = enforcingPolicyShapeGap(body);
  if (shapeGap) return shapeGap;
  if (step.requiredLicenseSkuLists.length === 0) {
    return "no license requirement is recorded for this policy, so it cannot be confirmed to apply on this tenant";
  }
  return null;
}

/**
 * Why a Conditional Access policy object is not an enforcing Security Defaults
 * replacement, or null when it is one. Shape only — state "enabled", requires MFA,
 * All users, All applications, all client app types. #4529 applies this to the
 * policy Graph actually returned, where a license check is moot: Graph accepted it.
 */
export function enforcingPolicyShapeGap(body: Record<string, unknown>): string | null {
  if (body.state !== "enabled") {
    return `policy state is '${typeof body.state === "string" ? body.state : String(body.state)}', not 'enabled'`;
  }
  const grant = (body.grantControls ?? {}) as Record<string, unknown>;
  if (!stringList(grant.builtInControls).includes("mfa")) return "policy does not require MFA";
  const conditions = (body.conditions ?? {}) as Record<string, unknown>;
  const users = (conditions.users ?? {}) as Record<string, unknown>;
  if (!stringList(users.includeUsers).includes("All")) return "policy does not include All users";
  const apps = (conditions.applications ?? {}) as Record<string, unknown>;
  if (!stringList(apps.includeApplications).includes("All")) return "policy does not include All applications";
  const clientAppTypes = stringList(conditions.clientAppTypes);
  if (clientAppTypes.length > 0 && !clientAppTypes.includes("all")) {
    return "policy does not cover all client app types (legacy authentication would stay open)";
  }
  return null;
}

/**
 * The first precondition the pack fails on this tenant, as the typed refusal the
 * run path throws — or null when every precondition holds. `tenantSkus` is null
 * only when no step carries a license requirement (nothing was read).
 */
export function evaluateConfigPackPreconditions(opts: {
  packKey: string;
  steps: PackPreconditionStep[];
  payload: Record<string, unknown>;
  tenantSkus: TenantLicenseSkuResult | null;
}): ConfigPackError | null {
  const { packKey, steps, payload, tenantSkus } = opts;

  // ── 1. License ──
  const unlicensed = steps.filter((s) => !licenseSatisfied(s, tenantSkus));
  if (unlicensed.length > 0) {
    const requiredLicenses = [
      ...new Set(unlicensed.flatMap((s) => s.requiredLicenseSkuLists.map((skus) => describeRequiredLicense(skus)))),
    ];
    const skuReadError = tenantSkus?.error ?? null;
    const reason = skuReadError
      ? `the tenant's licenses could not be read (${skuReadError}), so the requirement cannot be confirmed`
      : "the tenant does not currently hold that license";
    return new ConfigPackError(
      "license_required",
      `Pack '${packKey}' cannot run on this tenant: ${unlicensed.map((s) => s.templateId).join(", ")} — ` +
        `${requiredLicenses.join("; ")}, and ${reason}. Nothing was written.`,
      {
        unlicensedTemplateIds: unlicensed.map((s) => s.templateId),
        requiredLicenses,
        requiredLicenseSkus: [...new Set(unlicensed.flatMap((s) => s.requiredLicenseSkuLists.flat()))],
        skuReadError,
      },
    );
  }

  // ── 2. Security Defaults only with an enforcing, licensed replacement ──
  const disableSteps = steps.filter((s) => isSecurityDefaultsDisableStep(s, payload));
  if (disableSteps.length > 0) {
    const candidates = steps
      .filter((s) => s.method.toUpperCase() === "POST" && normalizedPath(s.endpoint, payload) === CA_POLICIES_PATH)
      .map((s) => ({ templateId: s.templateId, gap: enforcingReplacementGap(s, payload) }));
    if (!candidates.some((c) => c.gap === null)) {
      const why = candidates.length === 0
        ? "the pack creates no Conditional Access policy"
        : candidates.map((c) => `${c.templateId}: ${c.gap}`).join("; ");
      return new ConfigPackError(
        "security_defaults_replacement_not_enforcing",
        `Pack '${packKey}' would turn off Security Defaults (${disableSteps.map((s) => s.templateId).join(", ")}) ` +
          `without an enforcing Conditional Access replacement — ${why}. ` +
          "Security Defaults is left on and nothing was written.",
        {
          securityDefaultsTemplateIds: disableSteps.map((s) => s.templateId),
          conditionalAccessCandidates: candidates,
        },
      );
    }
  }

  return null;
}
