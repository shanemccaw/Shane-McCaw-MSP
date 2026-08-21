/**
 * secEvidenceModel.ts — resolution and tone helpers for the evidence drill-downs.
 *
 * The three pages share one URL space (`/portal-v2/security/<slug>`) and one
 * template, so the load-bearing derivation is: a slug resolves to the right
 * page, and the tone/source maps stay in one place. `evidenceKey` in the
 * prototype (18580) is `EVIDENCE_PAGES[active] ? active : null`; here the active
 * key is reconstructed from the URL slug as `security-<slug>`.
 */

import {
  EV_SRC_META,
  EV_TONE_C,
  EVIDENCE_PAGES,
  type EvidencePage,
  type EvSrc,
  type EvTone,
} from "./secEvidenceData";

/** Resolve a URL slug (`oauth`, `legacy-auth`, `email`) to its evidence page. */
export function evidencePageFor(slug: string | undefined): EvidencePage | null {
  if (!slug) return null;
  return EVIDENCE_PAGES[`security-${slug}`] ?? null;
}

export function evTone(tone: EvTone): string {
  return EV_TONE_C[tone];
}

export function evSrc(src: EvSrc): { label: string; c: string } {
  return EV_SRC_META[src];
}

/** `ev.topRisksCount` (18603). */
export function evTopRisksCount(page: EvidencePage): number {
  return page.topRisks.length;
}
