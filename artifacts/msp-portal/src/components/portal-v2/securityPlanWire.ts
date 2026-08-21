/**
 * securityPlanWire.ts — the wire shapes and normalisation behind
 * GET /api/portal/security-plan.
 *
 * Pure functions, no React, so they can be unit-tested directly (the fetching
 * lives in `securityPlanLive.ts`). The endpoint already speaks the page's own
 * shapes (`SecurityPlan` / `SecPlanSection` / `SecPlanRow` / `SecPlanVersion`),
 * so this file is thin — its whole job is the one decision that must not live in
 * a component: WHICH SOURCE the page renders.
 *
 * `securityPlanData.ts` (SECURITY_PLAN / SECURITY_PLAN_OWNER) is the DESIGN
 * fixture and becomes the FALLBACK: a failed read, or a customer with no plan
 * authored yet, renders the design's own plan (which explains what the page is
 * for) rather than an empty masthead. `toSecurityPlan` returns null in exactly
 * those cases, and the hook maps null → fixture.
 *
 * TRUST THE WIRE NO FURTHER THAN ITS SHAPE: a row whose `state` is not one of the
 * three the page's `SP_STATE_META` indexes would crash the row renderer (`m.color`
 * off undefined), so an unknown state is coerced to `gap`; and a plan with no
 * sections (or no rows) cannot be told apart from a broken read — and the derived
 * header verdict/percentage divide by the requirement count — so both fall back.
 */

import {
  SECURITY_PLAN,
  SECURITY_PLAN_OWNER,
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
 * A payload as the page's plan + owner, or null when it carries nothing to
 * render. Null — not an empty plan — because the caller's decision is which
 * SOURCE to show, and "the read succeeded but there is no plan / no sections"
 * belongs to the fixture branch: a plan with no sections cannot be told apart
 * from one that failed to load, and the derived header verdict/percentage divide
 * by the requirement count, which an empty plan makes a divide-by-zero.
 */
export function toSecurityPlan(payload: WireSecurityPlanPayload | null): NormalisedSecurityPlan | null {
  const wire = payload?.plan;
  if (!wire || typeof wire !== "object") return null;

  const sections = (wire.sections ?? []).map(toSection).filter((s) => s.k !== "");
  if (!sections.length) return null;
  // The derivations divide by the total requirement count — a plan with sections
  // but no rows would be a divide-by-zero, so it is treated as the fixture too.
  if (!sections.some((s) => s.rows.length > 0)) return null;

  const owner: SecurityPlanOwner = {
    initials: str(wire.owner?.initials) || SECURITY_PLAN_OWNER.initials,
    tone: str(wire.owner?.tone) || SECURITY_PLAN_OWNER.tone,
  };

  const plan: SecurityPlan = {
    tenant: str(wire.tenant) || SECURITY_PLAN.tenant,
    env: str(wire.env) || SECURITY_PLAN.env,
    tier: str(wire.tier) || SECURITY_PLAN.tier,
    version: str(wire.version) || SECURITY_PLAN.version,
    updated: str(wire.updated) || SECURITY_PLAN.updated,
    approver: str(wire.approver) || SECURITY_PLAN.approver,
    sections,
    history: (wire.history ?? []).map(toVersion),
  };

  return { plan, owner };
}
