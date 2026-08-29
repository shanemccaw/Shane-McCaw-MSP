/**
 * settingsChangeControlWire.ts — the wire shapes behind
 * GET /api/portal/settings/change-control, the real backend for the Settings
 * page's "Change control policy" section (Git #1592).
 *
 * Pure functions, no React — the fetching lives in
 * `settingsChangeControlLive.ts`. There is no `Design/portal/` export for
 * Settings yet, so nothing in `artifacts/portal/src/pages` consumes this file
 * today; it exists so wiring the page is a straight import once that design
 * lands, instead of a second pass through this endpoint's shape. The retired
 * `portal-v2-settings.tsx` / `settingsData.ts` (see
 * `portal-archive-2026-08-29`) is the closest reference for what a future page
 * would do with these fields — `CcPolicy` / `CcNotifRule` below match its field
 * names on purpose.
 */

export type CcApproverBand = "normal" | "emergency";

export interface CcPolicy {
  readonly on: boolean;
  readonly gated: Record<string, boolean>;
  readonly approvals: number;
  readonly separate: boolean;
  readonly freeze: boolean;
  readonly emergency: boolean;
  readonly approvers: { readonly normal: readonly string[]; readonly emergency: readonly string[] };
}

export interface CcNotifRule {
  readonly event: string;
  readonly channel: string;
  readonly to: string;
  readonly lead: string;
  readonly on: boolean;
}

export interface CcPerson {
  readonly id: string;
  readonly name: string;
  readonly role: string;
}

export interface WireChangeControlSettings {
  readonly policy?: unknown;
  readonly notifications?: unknown;
  readonly people?: unknown;
}

const DEFAULT_POLICY: CcPolicy = {
  on: false,
  gated: {},
  approvals: 1,
  separate: true,
  freeze: false,
  emergency: false,
  approvers: { normal: [], emergency: [] },
};

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function strArray(v: unknown): readonly string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function toPolicy(raw: unknown): CcPolicy {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const gatedRaw = p.gated && typeof p.gated === "object" ? (p.gated as Record<string, unknown>) : {};
  const gated: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(gatedRaw)) gated[k] = v === true;
  const approversRaw = p.approvers && typeof p.approvers === "object" ? (p.approvers as Record<string, unknown>) : {};
  return {
    on: bool(p.on, DEFAULT_POLICY.on),
    gated,
    approvals: typeof p.approvals === "number" && Number.isFinite(p.approvals) ? p.approvals : DEFAULT_POLICY.approvals,
    separate: bool(p.separate, DEFAULT_POLICY.separate),
    freeze: bool(p.freeze, DEFAULT_POLICY.freeze),
    emergency: bool(p.emergency, DEFAULT_POLICY.emergency),
    approvers: {
      normal: strArray(approversRaw.normal),
      emergency: strArray(approversRaw.emergency),
    },
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function toNotifRules(raw: unknown): readonly CcNotifRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((n) => {
    const row = n && typeof n === "object" ? (n as Record<string, unknown>) : {};
    return { event: str(row.event), channel: str(row.channel), to: str(row.to), lead: str(row.lead), on: bool(row.on, true) };
  });
}

export function toPeople(raw: unknown): readonly CcPerson[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      const row = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
      return { id: str(row.id), name: str(row.name), role: str(row.role) };
    })
    .filter((p) => p.id !== "");
}
