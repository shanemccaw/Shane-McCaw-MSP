Shipped exactly as proposed above.

**Changes** (`artifacts/msp-portal/src/components/security-overview/`):
- `useSecurityOverviewLive.ts` now also fetches `GET /api/portal/assessment/status` (same call `/m365-health` already makes) and derives `securityPillarScore = status.radar.pillars.find(p => p.pillar === 'security')?.score ?? null`.
- `HeaderHeroBand.tsx`'s headline (was "Security Risk Index" / raw engine score, e.g. 206) now shows `securityPillarScore` — a real 0-100 metric, band-colored/badged via the shared `scoreBand()`/`BAND_TEXT_CLASS` helpers from `useM365HealthLive.ts` (same treatment as `/m365-health`'s `HeroHealthScore`). The raw engine score survives as a demoted, explicitly-labeled secondary line: "Risk Index {score} · risk points · higher is worse" — never deleted, just no longer the headline.
- `security-overview.tsx` wires the new prop through.

`tsc --noEmit` (msp-portal): 1 pre-existing error in an untouched file, 0 in touched files.

**Test coverage**: added `test-manifests/security-overview/hero-pillar-score.json`, registered in `_regression-suite.json`. Ran it live via `shaneapp://runTest` after an SSH pull + restart deployed the fix to the dev server: **11/11 passed**.

One honest wrinkle worth flagging: the shared testbed tenant's live `/api/portal/assessment/status` currently returns an honestly-empty `radar.pillars` (its 5 most recent diagnostic runs are all `status='partial'`, none `'completed'`, and no scan is active right now — a pre-existing property of this tenant's run history, unrelated to this fix). So the live run exercised the headline's honest em-dash state rather than a real number — documented in the manifest's own notes, with the exact live values confirmed via `shaneapp://executeSql` against `tenant_pillar_snapshots`/`msp_diagnostic_runs`. The wiring and layout are verified correct in both states.

Also: mid-session, a stale-base push briefly reverted #1113's DONE bookend row back to IN FLIGHT (this repo saw very high concurrent-session traffic tonight). Caught it immediately and restored it via an isolated worktree + a targeted single-line fix (`62f1ce8e`) — noted here for the record, not something that needs any action from you.
