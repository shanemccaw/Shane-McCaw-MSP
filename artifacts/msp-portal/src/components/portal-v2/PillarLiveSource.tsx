/**
 * PillarLiveSource.tsx — the hidden "live vs fixture" source marker every
 * portal-v2 pillar DRILL-DOWN page renders (Git #1204).
 *
 * The ten drill-down pages (gov-detail, gov-area, gov-oversharing[-all],
 * security-mfa/ca/evidence, compliance-gaps/decisions/obligations) each read the
 * SAME live `war-room-pillars` payload their parent pillar page does, through the
 * SAME `useLivePillarHero` seam — there is no second fetching or scoring path.
 * What that payload genuinely carries is finding-level and aggregate: the pillar
 * score, its replayed trend, and its critical/warning finding counts. The rich
 * PER-OBJECT rows these pages list (individual overshared SharePoint sites,
 * MFA-partial users, Conditional-Access policy rows, the obligation register, the
 * accepted-risk cards) have no per-item server producer, so those rows stay on
 * their design fixture, documented as real backend gaps — exactly as the parent
 * pillar heroes kept their ledgers and heat-maps fixture (#1200/#1201).
 *
 * This marker is the same visually-clipped (not `display:none`) source indicator
 * the parent Governance page's `pv2-gov-source` uses and the Security Plan page's
 * `pv2-sp-source` established: the text stays in the DOM so a test can read
 * `el.innerText` and prove "live" (the engine returned a real score for this
 * pillar and the page is reading it) vs "fixture", but it takes no visual space,
 * so the design is recreated byte-for-byte on screen.
 */

import { PV2_SOURCE_CLIP, type LivePillarHero } from "./useLivePillarHero";

export function PillarLiveSource({
  testId,
  live,
}: {
  /** The page's own `pv2-<slug>-source` id — one per drill-down page. */
  testId: string;
  live: Pick<LivePillarHero, "dataState">;
}) {
  return (
    <span data-testid={testId} style={PV2_SOURCE_CLIP}>
      {live.dataState}
    </span>
  );
}
