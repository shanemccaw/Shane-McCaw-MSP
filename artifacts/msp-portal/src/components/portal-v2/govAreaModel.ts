/**
 * govAreaModel.ts — the pure derivations behind the Governance area drill-downs.
 *
 * Mirrors the prototype's per-shape row builders (`govListPage` 18944-18958,
 * `govInventoryPage` 18995-19005). Kept separate from the data and the page so
 * the URL-slug → shape resolution and the row view-models are unit-testable
 * without a DOM.
 */

import {
  GOV_DRIFT_PAGES,
  GOV_INVENTORY_PAGES,
  GOV_LIST_PAGES,
  type GovDriftPage,
  type GovInventoryPage,
  type GovListPage,
} from "./govAreaData";

/** A LIST-shape row, derived from `d.items[]` (18946-18956). */
export interface GovListRow {
  name: string;
  context: string;
  accepted: boolean;
  showActions: boolean;
  acceptedMeta: string;
}

/** An INVENTORY-shape row, derived from `d.rows[]` (18999-19003). */
export interface GovInventoryRowVM {
  name: string;
  context: string;
  flagged: boolean;
  flagLabel: string;
}

export type GovAreaResolved =
  | { kind: "list"; page: GovListPage; rows: GovListRow[] }
  | { kind: "drift"; page: GovDriftPage }
  | { kind: "inventory"; page: GovInventoryPage; rows: GovInventoryRowVM[] };

/** `d.items.map(...)` — 18946. */
export function govListRows(page: GovListPage): GovListRow[] {
  return page.items.map((it) => {
    const accepted = it.status === "accepted";
    return {
      name: it.name,
      context: it.context,
      accepted,
      showActions: !accepted,
      // `${acceptedTerm || ''} ${acceptedOn ? '· ' + acceptedOn : ''}`.trim() (18953)
      acceptedMeta: accepted
        ? `${it.acceptedTerm || ""} ${it.acceptedOn ? "· " + it.acceptedOn : ""}`.trim()
        : "",
    };
  });
}

/** `d.rows.map(...)` — 18999. */
export function govInventoryRows(page: GovInventoryPage): GovInventoryRowVM[] {
  return page.rows.map((r) => ({
    name: r.name,
    context: r.context,
    flagged: r.flag,
    flagLabel: r.flag ? "Flagged" : "",
  }));
}

/**
 * Resolve a URL slug (`orphaned-teams`, `device-inventory`, …) to its shape and
 * derived rows. The prototype keys these off `active === 'governance-<slug>'`
 * across three separate `govXxxPageData` maps (`govListKey` 18943 etc.); this
 * folds that into one lookup. Returns null for an unknown slug so the page can
 * render NotFound.
 */
export function govAreaFor(slug: string | undefined): GovAreaResolved | null {
  if (!slug) return null;
  const key = `governance-${slug}`;
  const list = GOV_LIST_PAGES[key];
  if (list) return { kind: "list", page: list, rows: govListRows(list) };
  const drift = GOV_DRIFT_PAGES[key];
  if (drift) return { kind: "drift", page: drift };
  const inv = GOV_INVENTORY_PAGES[key];
  if (inv) return { kind: "inventory", page: inv, rows: govInventoryRows(inv) };
  return null;
}
