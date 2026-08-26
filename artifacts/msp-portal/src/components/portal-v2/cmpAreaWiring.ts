/**
 * cmpAreaWiring.ts — the REAL-data backing for the Compliance pillar's
 * `CMP_AREA_LINKS` cluster cards (Git #1338).
 *
 * ── What this corrects ───────────────────────────────────────────────────────
 * `cmpDashboardData.ts`'s header used to call all 13 area cards a "GENUINE GAP"
 * — pure fixture with no real producer. A live-database audit (#1338) found that
 * is stale: most of the cards DO map to a real, active `monitor_checks` row
 * that is assigned to `core:premier`, so their real state can be surfaced. This
 * module is the one place that records, per card, which real check(s) back it
 * (or that nothing does), keeping `cmpDashboardData.ts` as the untouched design
 * fixture — the same fixture/live split the Obligations drill-down uses
 * (`cmpDashboardData` fixture vs `complianceObligationsLive` real).
 *
 * ── What is real here, and what is deliberately NOT ──────────────────────────
 * The war-room-pillars payload the portal already trusts is FINDING-level and
 * aggregate: for each `monitor_checks.key` it can tell us whether the tenant has
 * an OPEN finding right now and at what severity — it does NOT carry a
 * per-sub-area numeric magnitude (there is no "12 mailboxes uncovered" /
 * "3,412 documents" producer anywhere server-side, exactly as the Governance and
 * Security cluster grids document). So this wiring makes each backed card's
 * STATUS real (Gap open / Partially covered / Documented and covered, derived
 * from the real finding severity for its check) while the numeric figure on the
 * card stays the design's illustrative magnitude. A card whose check has no
 * open finding for a scanned tenant resolves to "Documented and covered" — the
 * same absence-of-finding == healthy semantics the hero's open-gap count already
 * uses.
 *
 * ── The honest no-data cards (verified zero backing, #1338) ──────────────────
 * Five card concepts have NO producing check anywhere in `monitor_checks`
 * (verified by exhaustive key/label search this session): Disposition Review,
 * Preservation Lock, Records Declaration, Subject Requests (DSR), and Audit
 * Coverage (workloads ingesting). A sixth — "Stale Legal Holds" — was
 * INVESTIGATED rather than assumed: the only hold-related check,
 * `exchange:litigation-hold-coverage`, reads mailbox `LitigationHoldEnabled`
 * only (`Identity`/`LitigationHoldEnabled` -> `countTruthy`) and has no
 * Case-Hold-Policy / matter-status awareness, so it backs the "Litigation Hold"
 * card (mailboxes on hold) but NOT "Stale Legal Holds" (holds from CLOSED
 * matters). Those six resolve `nodata` and render an honest "—", never a
 * fabricated number.
 */

import type { CmpAreaStatus } from "./cmpDashboardData";
import type { PortalV2Finding, PortalV2PillarView } from "./portalV2Model";

/** How one area card is (or is not) backed by real monitor checks. */
export type CmpAreaBacking =
  | {
      /** One or more real, active `monitor_checks.key`s produce this card's state. */
      readonly kind: "live";
      readonly checkKeys: readonly string[];
    }
  | {
      /** No producing check exists anywhere — show honest "—", never a number. */
      readonly kind: "nodata";
      readonly reason: string;
    };

/**
 * Per-card backing, keyed by `CmpAreaLink.key`. Every one of the 14 cards is
 * classified — a card missing from this map is a bug (asserted in the test), not
 * a silent fixture fallthrough.
 *
 * The check-key choices mirror the #1338 issue's live-verified mapping; each key
 * here is a real, active row in `monitor_checks` assigned to `core:premier`
 * (`compliance:audit-log-retention` becomes a Premier member in the same #1338
 * change — see the manual migration).
 */
export const CMP_AREA_BACKING: Readonly<Record<string, CmpAreaBacking>> = {
  // ── Data Lifecycle ────────────────────────────────────────────────────────
  "compliance-retention-coverage": {
    kind: "live",
    checkKeys: ["governance:retention-policy-coverage"],
  },
  "compliance-retention-labels": {
    kind: "live",
    checkKeys: ["governance:retention-label-adoption"],
  },
  "compliance-disposition": {
    kind: "nodata",
    reason:
      "No disposition-review check exists — Purview Records Management disposition (items past their retention period) is not collected by any monitor check.",
  },
  "compliance-preservation-lock": {
    kind: "nodata",
    reason:
      "No preservation-lock check exists — retention policy RestrictiveRetention / Preservation Lock state is not collected by any monitor check.",
  },

  // ── Information Protection ────────────────────────────────────────────────
  "compliance-sensitivity-labels": {
    kind: "live",
    checkKeys: [
      "governance:sensitivity-label-adoption",
      "compliance:missing-labels",
      "compliance:label-errors",
    ],
  },
  "compliance-autolabel": {
    kind: "live",
    checkKeys: ["governance:auto-labeling-coverage"],
  },
  "compliance-dlp": {
    kind: "live",
    checkKeys: [
      "compliance:weak-dlp-policies",
      "compliance:zero-dlp-policies",
      "compliance:dlp-incidents",
    ],
  },

  // ── Audit & Evidence ──────────────────────────────────────────────────────
  "compliance-audit-retention": {
    kind: "live",
    checkKeys: ["compliance:audit-log-retention"],
  },
  "compliance-audit-coverage": {
    kind: "nodata",
    reason:
      "No audit-coverage check exists — 'workloads not ingesting into the unified audit log' is not collected by any monitor check (the only audit check, compliance:audit-log-retention, measures retention DAYS, not per-workload ingestion).",
  },
  "compliance-admin-trail": {
    kind: "live",
    checkKeys: ["compliance:audit-log-retention"],
  },

  // ── Legal Hold & Records ──────────────────────────────────────────────────
  "compliance-holds": {
    kind: "nodata",
    reason:
      "No stale-legal-hold check exists — exchange:litigation-hold-coverage reads mailbox LitigationHoldEnabled only (no Case-Hold-Policy / matter-status awareness), so 'holds from closed matters' has no producing check.",
  },
  "compliance-litigation-hold": {
    kind: "live",
    checkKeys: ["exchange:litigation-hold-coverage"],
  },
  "compliance-records": {
    kind: "nodata",
    reason:
      "No records-declaration check exists — 'labels marked as records' is not collected by any monitor check.",
  },
  "compliance-dsr": {
    kind: "nodata",
    reason:
      "No subject-request (DSR) check exists — open Purview data-subject requests are not collected by any monitor check.",
  },
};

/**
 * Worst open-finding severity per `checkKey`, flattened across EVERY pillar's
 * findings — a card's backing check can live in a different pillar than
 * Compliance (e.g. `governance:auto-labeling-coverage`'s finding is grouped
 * under Governance by `signal_derivation_rules.pillar`), so a compliance-only
 * scan of findings would miss it. Critical outranks warning.
 */
export function buildCmpFindingSeverityMap(
  pillars: readonly PortalV2PillarView[],
): ReadonlyMap<string, "critical" | "warning"> {
  const map = new Map<string, "critical" | "warning">();
  for (const pillar of pillars) {
    for (const f of pillar.findings as readonly PortalV2Finding[]) {
      if (!f.checkKey) continue;
      const existing = map.get(f.checkKey);
      // critical always wins; warning only fills an empty slot.
      if (f.severity === "critical" || existing === undefined) {
        map.set(f.checkKey, f.severity);
      }
    }
  }
  return map;
}

/** The resolution of one area card against the live payload. */
export interface CmpAreaResolution {
  readonly key: string;
  /**
   * "live"    — a real finding-derived status is on screen (a scan has landed);
   * "fixture" — backed by a real check, but no completed scan yet, so the design
   *             status/number is the honest fallback;
   * "nodata"  — no producing check exists at all; render "—", never a number.
   */
  readonly dataState: "live" | "fixture" | "nodata";
  /** The real status for a live card; null for fixture/nodata (caller keeps design status). */
  readonly liveStatus: CmpAreaStatus | null;
  /** Honest reason a real value can't be shown — only set for nodata. */
  readonly reason: string | null;
  /** False for nodata (render "—"); true otherwise (render the design magnitude). */
  readonly showValue: boolean;
}

/**
 * Resolve one area card against the real finding-severity map. Pure and total.
 *
 * Live status derivation for a backed card:
 *   • any backing check has a CRITICAL open finding → "red"  (Gap open)
 *   • else any has a WARNING open finding           → "yellow" (Partially covered)
 *   • else (no open finding for any backing check)  → "green" (Documented and covered)
 * ...but only once `loaded` is true; before the first completed scan there is no
 * honest basis to flip the design status, so it stays "fixture".
 */
export function resolveCmpArea(
  key: string,
  sevMap: ReadonlyMap<string, "critical" | "warning">,
  loaded: boolean,
): CmpAreaResolution {
  const backing = CMP_AREA_BACKING[key];
  if (!backing || backing.kind === "nodata") {
    return {
      key,
      dataState: "nodata",
      liveStatus: null,
      reason: backing?.kind === "nodata" ? backing.reason : "No backing classification for this card.",
      showValue: false,
    };
  }

  if (!loaded) {
    return { key, dataState: "fixture", liveStatus: null, reason: null, showValue: true };
  }

  let worst: "critical" | "warning" | null = null;
  for (const ck of backing.checkKeys) {
    const sev = sevMap.get(ck);
    if (sev === "critical") {
      worst = "critical";
      break;
    }
    if (sev === "warning") worst = "warning";
  }

  const liveStatus: CmpAreaStatus = worst === "critical" ? "red" : worst === "warning" ? "yellow" : "green";
  return { key, dataState: "live", liveStatus, reason: null, showValue: true };
}
