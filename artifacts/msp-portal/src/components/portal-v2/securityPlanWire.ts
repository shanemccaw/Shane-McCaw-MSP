/**
 * securityPlanWire.ts — the wire shapes and normalisation behind
 * GET /api/portal/security-plan.
 *
 * Pure functions, no React, so they can be unit-tested directly (the fetching
 * lives in `securityPlanLive.ts`). The endpoint already speaks the page's own
 * shapes (`SecurityPlan` / `SecPlanSection` / `SecPlanRow` / `SecPlanVersion`),
 * so this file is thin — its whole job is the one decision that must not live in
 * a component: whether the payload carries a REAL plan the page can render.
 *
 * ── Git #1439: no more fixture-as-fallback ───────────────────────────────────
 * `securityPlanData.ts` (SECURITY_PLAN / SECURITY_PLAN_OWNER) was previously the
 * FALLBACK a failed read, or a customer with no plan authored yet, silently
 * rendered — a fabricated "Halden Materials" plan presented as if it were this
 * tenant's real one. Shane's live testing caught exactly this ("Security Plan
 * fake data"): the seed migration only seeds `customer_id = 1` (the testbed
 * tenant), so every OTHER real customer hit the `plan: null` branch and saw the
 * fixture. `toSecurityPlan` still returns null for "nothing usable to render",
 * but `securityPlanLive.ts` no longer maps that null to the fixture — it now
 * distinguishes an explicit `plan: null` (this customer genuinely has none
 * authored yet — an honest, expected state) from a malformed non-null payload
 * (an honest error state, logged for investigation) and renders one of two real
 * empty-state messages instead. `SECURITY_PLAN`/`SECURITY_PLAN_OWNER` remain only
 * as design reference / unit-test fixtures — no runtime code path renders them.
 *
 * TRUST THE WIRE NO FURTHER THAN ITS SHAPE: a row whose `state` is not one of the
 * three the page's `SP_STATE_META` indexes would crash the row renderer (`m.color`
 * off undefined), so an unknown state is coerced to `gap`; and a plan with no
 * sections (or no rows) cannot be told apart from a broken read — and the derived
 * header verdict/percentage divide by the requirement count — so both are treated
 * as unusable (`toSecurityPlan` returns null) and surface as the honest error state.
 */

import {
  type SecPlanRow,
  type SecPlanSection,
  type SecPlanState,
  type SecPlanVersion,
  type SecurityPlan,
} from "./securityPlanData";

export interface WireSecPlanRow {
  readonly req?: unknown;
  readonly state?: unknown;
  readonly detail?: unknown;
  readonly to?: unknown;
  readonly toLabel?: unknown;
}

export interface WireSecPlanSection {
  readonly k?: unknown;
  readonly n?: unknown;
  readonly label?: unknown;
  readonly lead?: unknown;
  readonly rows?: readonly WireSecPlanRow[];
}

export interface WireSecPlanVersion {
  readonly v?: unknown;
  readonly when?: unknown;
  readonly who?: unknown;
  readonly what?: unknown;
  readonly cr?: unknown;
}

export interface WireSecurityPlan {
  readonly tenant?: unknown;
  readonly env?: unknown;
  readonly tier?: unknown;
  readonly version?: unknown;
  readonly updated?: unknown;
  readonly approver?: unknown;
  readonly owner?: { readonly initials?: unknown; readonly tone?: unknown };
  readonly sections?: readonly WireSecPlanSection[];
  readonly history?: readonly WireSecPlanVersion[];
}

export interface WireSecurityPlanPayload {
  readonly plan?: WireSecurityPlan | null;
}

/** The signing-owner chip, in `SECURITY_PLAN_OWNER`'s shape. */
export interface SecurityPlanOwner {
  readonly initials: string;
  readonly tone: string;
}

const STATES = new Set<SecPlanState>(["met", "partial", "gap"]);

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A wire state coerced to a `SecPlanState`. Unknown → `gap` (loud, never crashes). */
export function toSecPlanState(value: unknown): SecPlanState {
  return typeof value === "string" && STATES.has(value as SecPlanState)
    ? (value as SecPlanState)
    : "gap";
}

function toRow(raw: WireSecPlanRow): SecPlanRow {
  return {
    req: str(raw.req),
    state: toSecPlanState(raw.state),
    detail: str(raw.detail),
    to: str(raw.to),
    toLabel: str(raw.toLabel),
  };
}

function toSection(raw: WireSecPlanSection): SecPlanSection {
  return {
    k: str(raw.k),
    n: str(raw.n),
    label: str(raw.label),
    lead: str(raw.lead),
    rows: (raw.rows ?? []).map(toRow),
  };
}

function toVersion(raw: WireSecPlanVersion): SecPlanVersion {
  return {
    v: str(raw.v),
    when: str(raw.when),
    who: str(raw.who),
    what: str(raw.what),
    cr: str(raw.cr),
  };
}

export interface NormalisedSecurityPlan {
  readonly plan: SecurityPlan;
  readonly owner: SecurityPlanOwner;
}

/**
 * True only when the payload itself explicitly says this customer has no plan
 * authored yet (`{ plan: null }`, exactly what `portal-security-plan.ts` sends
 * for that case) — distinct from a malformed/unusable non-null plan, which the
 * caller treats as an error instead. Checked BEFORE `toSecurityPlan`, which
 * collapses both cases to `null`, because the page needs to tell them apart:
 * "no plan yet" is an honest, expected, common state; a malformed payload is a
 * real bug worth logging.
 */
export function isExplicitlyNoPlan(payload: WireSecurityPlanPayload | null): boolean {
  return !!payload && "plan" in payload && payload.plan === null;
}

/**
 * A payload as the page's plan + owner, or null when it carries nothing usable
 * to render (no sections, or every section empty of rows — either would make
 * the derived header verdict/percentage a divide-by-zero, and cannot be told
 * apart from a broken read). The caller decides what a null result MEANS —
 * genuinely no plan authored (`isExplicitlyNoPlan`) vs a malformed payload —
 * and picks the matching honest empty state; neither renders the design fixture.
 */
export function toSecurityPlan(payload: WireSecurityPlanPayload | null): NormalisedSecurityPlan | null {
  const wire = payload?.plan;
  if (!wire || typeof wire !== "object") return null;

  const sections = (wire.sections ?? []).map(toSection).filter((s) => s.k !== "");
  if (!sections.length) return null;
  // The derivations divide by the total requirement count — a plan with sections
  // but no rows would be a divide-by-zero, so it is treated as malformed too.
  if (!sections.some((s) => s.rows.length > 0)) return null;

  // Git #1439: every header/owner field is `NOT NULL` on `portal_security_plans`
  // (see the migration), so a genuinely authored row always carries all six.
  // A blank one here means the payload is malformed, not that the fixture's
  // "Halden Materials" / "DW" should quietly stand in for this tenant's own
  // plan — that's the exact bug Shane's live testing caught. Treat it as
  // unusable (null) rather than filling in the design fixture's own values.
  const tenant = str(wire.tenant);
  const env = str(wire.env);
  const tier = str(wire.tier);
  const version = str(wire.version);
  const updated = str(wire.updated);
  const approver = str(wire.approver);
  const ownerInitials = str(wire.owner?.initials);
  const ownerTone = str(wire.owner?.tone);
  if (!tenant || !env || !tier || !version || !updated || !approver || !ownerInitials || !ownerTone) {
    return null;
  }

  const owner: SecurityPlanOwner = { initials: ownerInitials, tone: ownerTone };
  const plan: SecurityPlan = {
    tenant,
    env,
    tier,
    version,
    updated,
    approver,
    sections,
    history: (wire.history ?? []).map(toVersion),
  };

  return { plan, owner };
}
