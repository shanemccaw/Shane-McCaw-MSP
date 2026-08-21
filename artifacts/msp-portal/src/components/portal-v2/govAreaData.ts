/**
 * govAreaData.ts — the Governance "generic area" drill-downs.
 *
 * Transcribed VERBATIM from the prototype's three governance area shapes in
 * `Customer Portal Shell.dc.html`:
 *   • `govListPageData`      (18939) — Shape A, an affected-object list + fix
 *   • `govDriftPageData`     (18961) — Shape C, a drift timeline
 *   • `govInventoryPageData` (18973) — Shape D, an inventory / reporting page
 *
 * These are the SMALLER governance drill-downs. The rich, GOV_PAGES-driven
 * drill-down (`isGovDetailV2`, e.g. External Sharing Drift) lives in
 * `govPages.ts` / `portal-v2-gov-detail.tsx` and is Part 2's; this file is only
 * the three simpler templates and is NOT that file.
 *
 * ── This is design content, not tenant data ─────────────────────────────────
 * Every string and number below is the prototype's fictional Halden Materials
 * tenant. The fixture lives here — one module — so the later wiring pass can swap
 * it for a real customer-scoped read.
 *
 * ── Which tile reaches which shape ───────────────────────────────────────────
 * In the prototype the governance area tiles route on their `active` key:
 * `governance-orphaned-teams` / `governance-team-owners` render the LIST shape,
 * `governance-device-inventory` / `governance-device-lifecycle` render the
 * INVENTORY shape, and `governance-sharing-drift-legacy` renders the DRIFT
 * shape. The drift key carries no tile in the prototype's own dashboard (the
 * live drift tile points at the rich GOV_PAGES page instead), so it is reachable
 * by direct URL only — it is built here because the design section exists.
 */

/** A row on the LIST shape (`d.items[]`, 18940-18941). */
export interface GovListItem {
  name: string;
  context: string;
  /** "open" | "accepted" — the prototype only ships "open" rows. */
  status: string;
  acceptedTerm?: string;
  acceptedOn?: string;
}

export interface GovListPage {
  title: string;
  why: string;
  items: GovListItem[];
}

export interface GovDriftEvent {
  title: string;
  change: string;
  when: string;
  scan: string;
}

export interface GovDriftPage {
  title: string;
  why: string;
  events: GovDriftEvent[];
}

export interface GovInventoryStat {
  label: string;
  value: string;
}

export interface GovInventoryRow {
  name: string;
  context: string;
  flag: boolean;
}

export interface GovInventoryPage {
  title: string;
  why: string;
  stats: GovInventoryStat[];
  rows: GovInventoryRow[];
}

/**
 * `govListPageData` (18939). The prototype builds each `items` array with
 * `Array.from`; the same generator is kept here rather than expanding it, so the
 * fixture reads identically to the design.
 */
export const GOV_LIST_PAGES: Readonly<Record<string, GovListPage>> = {
  "governance-orphaned-teams": {
    title: "5 Teams have no active members",
    why: "These Teams still hold file storage, connectors, and permissions with no one left to manage them.",
    items: Array.from({ length: 5 }, (_, i) => ({
      name: `Retired Project Team ${i + 1}`,
      context: "0 active members · last activity 6+ months ago",
      status: "open",
    })),
  },
  "governance-team-owners": {
    title: "6 Teams need an owner",
    why: "Without an owner, no one is notified about new member requests or reviews of continued access.",
    items: Array.from({ length: 6 }, (_, i) => ({
      name: `Team ${i + 1}`,
      context: "12 members · no owner assigned",
      status: "open",
    })),
  },
};

/** `govDriftPageData` (18961). */
export const GOV_DRIFT_PAGES: Readonly<Record<string, GovDriftPage>> = {
  "governance-sharing-drift-legacy": {
    title: "External Sharing Drift",
    why: "New external shares detected since your previous scans — visibility, not a fix queue.",
    events: [
      { title: "Client Deliverables (SharePoint)", change: "External link created", when: "3 days ago", scan: "scan 14" },
      { title: "Q3 Sales Enablement", change: "External link created", when: "9 days ago", scan: "scan 13" },
      { title: "Vendor Onboarding Packet", change: 'Sharing scope widened to "Anyone"', when: "15 days ago", scan: "scan 12" },
    ],
  },
};

/** `govInventoryPageData` (18973). */
export const GOV_INVENTORY_PAGES: Readonly<Record<string, GovInventoryPage>> = {
  "governance-device-inventory": {
    title: "Device Inventory Governance",
    why: "212 devices are enrolled and tracked. This is a health confirmation, not a fix queue — flags below are the exceptions.",
    stats: [
      { label: "Total tracked", value: "212" },
      { label: "Compliant", value: "198" },
      { label: "Flagged", value: "14" },
    ],
    rows: [
      { name: "DEVICE-1042", context: "Windows 11 · compliant", flag: false },
      { name: "DEVICE-1103", context: "Not checked in for 46 days", flag: true },
      { name: "DEVICE-1188", context: "Unmanaged — never enrolled in Intune", flag: true },
    ],
  },
  "governance-device-lifecycle": {
    title: "Device Lifecycle Governance",
    why: "17 devices are past your defined retirement age (4 years). Not urgent individually, but worth a refresh plan.",
    stats: [
      { label: "Past retirement age", value: "17" },
      { label: "Avg. age", value: "3.1y" },
      { label: "Oldest", value: "6.4y" },
    ],
    rows: [
      { name: "DEVICE-0812", context: "Purchased Feb 2020 · 6.4 years old", flag: true },
      { name: "DEVICE-0930", context: "Purchased Aug 2020 · 6.0 years old", flag: true },
      { name: "DEVICE-1015", context: "Purchased Jan 2021 · 5.6 years old", flag: true },
    ],
  },
};
