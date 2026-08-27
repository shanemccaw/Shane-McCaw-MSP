/**
 * cmpAreaModel.ts — resolves a Compliance cluster-area slug to its card + finding.
 *
 * The Compliance pillar page renders 14 cluster area cards (`CMP_AREA_LINKS`),
 * each linking to `/portal-v2/compliance/<area>` where `<area>` is the card key
 * with its `compliance-` prefix stripped. Before Git #1388 only three explicit
 * compliance sub-routes existed (open-gaps / decisions / obligations) — none of
 * which is an area-card destination — so every one of the 14 area cards was a
 * true 404. Governance solves the identical shape with a single
 * `/portal-v2/governance/:area` wildcard route feeding one data-driven detail
 * page (`govPageFor`); this is the Compliance equivalent of that resolver.
 *
 * ── Why there is no bespoke per-area content, by design ──────────────────────
 * In the prototype these cards were never separate pages. A card's `navGo`
 * (shell 13969) EXPANDED a finding inline on the dashboard when the card carried
 * a `finding` index, and did nothing at all when it didn't. The React port moved
 * the inline Open Gaps section to its own drill-down, which is why the cards
 * became links. So the honest destination for a finding-backed card is that
 * finding's detail (design-final copy already in `cmpDrilldownData`), and for the
 * rest it is an honest pointer into the compliance registers — not 11 invented
 * content blocks, which the "copy is final, never fabricate" rule forbids.
 *
 * The `finding` index on each `CmpAreaLink` is a positional index into the six
 * `CMP_FINDINGS` (CMP-01..CMP-06). Both `cmpDashboardData` and `cmpDrilldownData`
 * transcribe those findings verbatim from the same prototype array in the same
 * order, so the index resolves against `cmpDrilldownData`'s copy — the one the
 * Open gaps drill-down itself renders.
 */

import { CMP_AREA_LINKS, type CmpAreaLink } from "./cmpDashboardData";
import { CMP_FINDINGS, type CmpFinding } from "./cmpDrilldownData";

export interface CmpAreaResolved {
  readonly link: CmpAreaLink;
  /** The finding this card drills into, or null for the inert (no-finding) cards. */
  readonly finding: CmpFinding | null;
}

/**
 * Resolve a `/portal-v2/compliance/:area` slug to its area card + optional
 * finding. Returns null for an unknown slug so the page can render NotFound,
 * exactly as `govPageFor` does for Governance.
 */
export function cmpAreaFor(slug: string | undefined): CmpAreaResolved | null {
  if (!slug) return null;
  const key = `compliance-${slug}`;
  const link = CMP_AREA_LINKS.find((a) => a.key === key);
  if (!link) return null;
  const finding = link.finding != null ? CMP_FINDINGS[link.finding] ?? null : null;
  return { link, finding };
}
