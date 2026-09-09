/**
 * settingsChangeControlWire.ts — the wire shapes behind
 * GET /api/portal/settings/change-control, the real backend for the "Your
 * change policy" section on the Change Control page (Git #1592, wired by
 * #1717 as part of `Design/portal/design_handoff_full_site/screens/Change
 * Control.dc.html`).
 *
 * Pure functions, no React — the fetching lives in
 * `settingsChangeControlLive.ts`, consumed by
 * `components/change-control/PolicySection.tsx`. The retired
 * `portal-v2-settings.tsx` / `settingsData.ts` (see
 * `portal-archive-2026-08-29`) is the closest reference for what a future
 * standalone Settings page would do with these fields — `CcPolicy` /
 * `CcNotifRule` below match its field names on purpose.
 */

export interface CcPolicy {
  readonly on: boolean;
  readonly gated: Record<string, boolean>;
  readonly approvals: number;
  readonly separate: boolean;
  /** Enforced by #1500's freeze windows on the CR write path; the settings
   *  page only persists it. */
  readonly freeze: boolean;
  readonly emergency: boolean;
  /** #1717 — enforced by the standard-catalog execute path's #3044 gate; the
   *  settings page only persists it, same as `freeze` above. */
  readonly maintenanceWindows: boolean;
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
  readonly eligibleApprovers?: unknown;
}

const DEFAULT_POLICY: CcPolicy = {
  on: false,
  gated: {},
  approvals: 1,
  separate: true,
  freeze: false,
  emergency: false,
  maintenanceWindows: false,
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
  return {
    on: bool(p.on, DEFAULT_POLICY.on),
    gated,
    approvals: typeof p.approvals === "number" && Number.isFinite(p.approvals) ? p.approvals : DEFAULT_POLICY.approvals,
    separate: bool(p.separate, DEFAULT_POLICY.separate),
    freeze: bool(p.freeze, DEFAULT_POLICY.freeze),
    emergency: bool(p.emergency, DEFAULT_POLICY.emergency),
    maintenanceWindows: bool(p.maintenanceWindows, DEFAULT_POLICY.maintenanceWindows),
  };
}

/** The wire person ids of this tenant's users eligible to approve — derived
 *  server-side from `users.can_approve_changes` (#1759), a subset of `people`. */
export function toEligibleApprovers(raw: unknown): readonly string[] {
  return strArray(raw);
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
