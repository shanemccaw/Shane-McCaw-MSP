Proposed exact layout change for `HeaderHeroBand.tsx`'s hero number block (top-right, `pl-4 border-l border-border` column):

**Data:** add `securityPillarScore: number | null` to `useSecurityOverviewLive()`, sourced from `GET /api/portal/assessment/status` -> `radar.pillars.find(p => p.pillar === 'security')?.score` — the same field `PillarGrid`/`HeroHealthScore` read on `/m365-health`. `null` when the scanned package doesn't cover Security yet (honest "not covered" state, not 0).

**Headline (was "Security Risk Index" / raw `riskIndex.score`, e.g. 206):**
- Label -> `"Security Score"`
- Big number -> `securityPillarScore` (0-100, "higher is better"), color/band via the shared `scoreBand()` / `BAND_TEXT_CLASS` from `useM365HealthLive.ts` (same >=70/>=40 thresholds as every other pillar score in the app) — `—` when null.
- Badge -> recomputed from the same band (`HEALTHY` / `NEEDS ATTENTION` / `AT RISK` / `AWAITING SCAN`), reusing `HeroHealthScore.tsx`'s `BAND_LABEL`/`BAND_ICON` map, instead of the current engine-strip severity badge — so the badge and the headline number are driven by the same metric instead of two different scales.
- Caption -> `"of 100 · higher is better"` (or `"not covered by this scan"` when null), replacing `"lower is better"`.

**Secondary (demoted, not removed):** the existing raw engine score becomes a small line under the headline: `Risk Index {riskIndex.score}` with its existing delta arrow, explicitly labeled `"risk points · higher is worse"` so it's never read as a percentage/pillar score (same disambiguation pattern #1101 used for the Trends chart's identical raw-engine number).

No changes to the Risky Users / Critical Findings / Warnings / Checks Passing row or the timeframe controls.

Proceeding with implementation now — this mirrors the already-proven `HeroHealthScore.tsx` pattern 1:1, so no new visual language is introduced.
