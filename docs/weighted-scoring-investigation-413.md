# Why weighted scoring produces artificially favourable results (Git #413)

**Investigation only. No fix applied, no weight changed, no rule touched.**

Test tenant: `c4c814d4-3afe-441e-9145-62461d0a4fd3`.
Confirmed real findings used throughout: **0 Conditional Access policies**, **14 Global Administrators**.

---

## The answer in one paragraph

The weights are not the problem. The score is
`100 − (rawScore / theoreticalMax) × 100`, and the two sides of that fraction are
measured over **different populations**: the numerator can only ever contain signals fed by
the checks this tenant was actually scanned with (7 or 29 of them), while the denominator is
built across the **entire ~122-check `monitor_checks` catalog**. That asymmetry puts a hard
floor under the score that no weighting can lower. A tenant scanned with
`core:security-baseline` cannot score below **76/100** even if *every single check it ran is
broken*; on `assess:copilot-readiness` the floor is **95/100**. Shane's flattening and the 300
outlier were both attempts to move a number whose range had already been clamped somewhere
above "bad".

---

## The formula, and where each side comes from

`computePillarDisplayScore` / `computeOverallDisplayScore`
([health-display.ts:73](../artifacts/api-server/src/lib/health-display.ts#L73)):

```
displayScore = 100 − (rawScore / theoreticalMax) × 100      clamped to [0,100]

rawScore       = Σ, over the signals that FIRED for this tenant,
                    that signal's MAX configured impact for the pillar
theoreticalMax = Σ, over every EVALUABLE signal,
                    that signal's MAX configured impact for the pillar
```

* **Numerator** — `computeHealthEngine` + `computeSecurityEngine` sum impacts over
  `firedSignals`. A signal can only fire if `evaluateRule` finds its `sourceKey` in the
  tenant's merged profile, which only a check that **actually ran for this tenant** can put
  there.
* **Denominator** — `fetchEvaluableSignalKeys`
  ([pillar-coverage.ts:290](../artifacts/api-server/src/lib/pillar-coverage.ts#L290)) resolves
  "evaluable" as *"some real check **anywhere in the catalog** can produce this rule's
  sourceKey"*. Its own docstring says so: `evaluated across the ENTIRE monitor_checks catalog
  (NOT scoped to any single package)`.

That is the whole defect. The denominator's guard was designed to solve a real and different
problem — a test rule with an extreme weight that never fires still moving a pillar toward
100%, which the file header documents as live-reproduced — and it does solve that one. It just
draws the boundary at "the catalog" rather than "what this tenant was measured on".

---

## Finding 1 — the denominator counts checks the tenant never ran

| population | size | source |
|---|---|---|
| active `monitor_checks` catalog | **122** | [pillar-coverage.test.ts:12](../artifacts/api-server/src/lib/pillar-coverage.test.ts#L12); `core:enhanced-monitoring` is defined as *every active row* |
| `core:security-baseline` | **29** | `2026-07-21-repopulate-monitoring-package-checks.sql` |
| `assess:copilot-readiness` | **7** | `admin-simulator-assessments.test.ts:62-68` (fixture recorded as matching live data) |

Reconstructed by driving the **real** exported functions (see *Method* below), with genuinely
varied weights taken from this repo's own previously-authored scheme:

```
A. Only the two confirmed findings fire (0 CA policies, 14 Global Admins)
   LIVE path   (denominator = 122-check catalog)   security= 96   OVERALL= 99
   package-scoped denominator (29 checks)          security= 94   OVERALL= 96

B. WORST CASE — every scanned check broken
   core:security-baseline, 29 signals fired
   LIVE path                                       security= 35   OVERALL= 76
   package-scoped                                  security=  0   OVERALL=  0

   assess:copilot-readiness, 7 signals fired
   LIVE path                                       copilot = 61   OVERALL= 95
   package-scoped                                  copilot =  0   OVERALL=  0
```

**A tenant with zero Conditional Access policies and fourteen Global Administrators scores 99
out of 100.** And the floor is structural, not a weighting accident: with uniform weights the
formula degenerates exactly to a count ratio, and `100 − 29/122 × 100 = 76` reproduces the
measured floor to the point.

`getPillarCoverage` ([pillar-coverage.ts:414](../artifacts/api-server/src/lib/pillar-coverage.ts#L414))
already passes the **package-scoped** `coveredSignalKeys` as its denominator, and bottoms out
at 0 as it should. So the platform contains two callers of one formula using two different
denominators, and the customer-facing one (War Room / telemetry radar / Copilot Reveal, via
`buildPillarViews`) is the diluted one.

## Finding 2 — unscanned pillars report a perfect 100

In scenario A above, five of seven pillars — governance, adoption, copilot, architecture,
licensing — return **100**. Not `null`, not "no data": 100.

The mechanism: catalog-wide, those pillars *do* have evaluable signals, so `theoreticalMax > 0`
and the null guard doesn't trip; but none of the tenant's 29 scanned checks feeds them, so
`rawScore = 0`. `100 − 0/max × 100 = 100`.

This is precisely the contradiction
[war-room-pillar-stats.ts](../artifacts/api-server/src/lib/war-room-pillar-stats.ts) documents
from the other side. That module went to real lengths to stop a stat claiming
`no_data` ("ran and found nothing") when the truth was `not_in_scan_package` ("never ran") —
and its header says the honest empty cards *"[end] up contradicting the real score beside it"*.
The score is the half that is wrong. A card that correctly says "this check was never in your
scan" sits underneath a dial reading 100.

The same effect inflates the overall a second time: `computeOverallDisplayScore` sums both
sides across all seven pillars, so in scenario B the three untouched pillars contribute their
full weight mass to the denominator and nothing to the numerator, dragging OVERALL from the
security pillar's real 35 up to 76.

## Finding 3 — signal firing is binary, so severity magnitude is invisible

`evaluateRule` ([tenant-signals.ts:1076](../artifacts/api-server/src/lib/tenant-signals.ts#L1076))
returns a boolean. A signal contributes its full configured weight or nothing.

`14 Global Administrators` scores **identically** to 5. `0 Conditional Access policies` scores
identically to a tenant with one weak policy. The scoring layer cannot distinguish "marginally
off baseline" from "catastrophically broken", which is a second, independent reason a tenant
Shane knows is broken reads as healthy. Note the severity band *is* computed and stored —
`tenant_monitor_profiles.severity_matched`, and since #408 the matched rule's label too — so
the magnitude information exists upstream and is discarded at exactly this step.

## Finding 4 — the score is more sensitive to rule authoring than to tenant health

Same tenant, same findings, same code; only where the weight mass happens to sit across the
catalog was changed:

```
uniform weight across the catalog              security= 73   OVERALL= 94
3x heavier on checks the tenant NEVER RAN      security= 84   OVERALL= 97
3x heavier on the checks it DID run            security= 65   OVERALL= 87
```

Authoring a heavy rule for a check that no tenant runs makes **every** tenant look healthier.
This is the documented exploit generalised: the evaluable-key guard blocks the *unproducible*
case but not the far more common *not-in-this-tenant's-package* case.

## Finding 5 — what the two manual interventions actually did

```
(12 signals fired)
genuinely varied weights (60/45/30/20 + spillover)  gove=100 comp= 92 ... secu= 66  OVERALL= 92
all impacts flattened to 1                          gove= 92 comp= 92 ... secu= 92  OVERALL= 92
flattened + 300 on a FIRING signal                  every pillar = 27             OVERALL= 27
flattened + 300 on a SILENT signal                  every pillar = 98             OVERALL= 98
```

* **Flattening to 1** did not change the overall at all — it changed *which* number the
  overall is. It collapsed all seven pillars onto one value and, on this reconstruction, made
  the genuinely broken security pillar look **better** (66 → 92) by removing the only
  differentiation the corpus had.
* **The 300 outlier** is a single lever with more authority than the other ~91 rows combined:
  on a firing signal it drags every pillar to 27; on a silent one it lifts every pillar to 98.
  Which direction it points depends entirely on whether that one signal happens to fire.

Both behave exactly as symptom relief on a clamped range would. Neither is a weighting error to
be corrected by picking better numbers.

---

## Method, and what it does and does not prove

The reconstruction ran the **real** exported functions — `computeHealthEngine`,
`computeSecurityEngine`, `getSignalHealthImpacts`, `computePillarDisplayScore`,
`computeOverallDisplayScore`, `buildProducibleProfileKeys`, `ruleIsFedByPackage` — composed
exactly as `calculateArchitectureHealthScore` composes them. Nothing reimplements the formula.
Six scenarios, all passing, driven from a scratch vitest harness that was **not committed**
(the tracked `vitest.config.ts` was left untouched; a concurrent session has it dirty).

Every input is sourced from the repo, not invented:

| input | source |
|---|---|
| 29 `core:security-baseline` check keys | `2026-07-21-repopulate-monitoring-package-checks.sql:65-98`, verbatim |
| 7 `assess:copilot-readiness` check keys | `admin-simulator-assessments.test.ts:62-68`, verbatim |
| catalog size 122 | `pillar-coverage.test.ts:12` |
| weighting scheme (dominant 60/45/30/20 by worst severity rank + 1–2 spillover, domain→pillar map) | `2026-07-23-close-signal-coverage-gaps.sql:478-516` — this platform's **own** previously-authored scheme |
| CA-policy signal shape (`profile_key_eq conditionalAccessPolicyCount == 0`) | `seed-signal-rules.ts:53-56`, plus the real bridged producer in `BRIDGED_KEY_PRODUCER_CHECK` |

**Two things it had to model, and could not read:**

1. **The real impact values now in the DB.** Deliberately so — Shane has confirmed every
   current value is untrustworthy. The reconstruction therefore uses the repo's own prior
   scheme, and every headline result is *also* reported in a weight-independent form (Finding 1's
   count-ratio identity), so the conclusions do not rest on the modelled weights.
2. **Which of the tenant's checks actually fired.** This is why the headline is a *bound*
   ("every scanned check broken") plus a full sweep, rather than a point estimate — neither
   needs the tenant's per-check results.

**Not verified against live data.** There is no `DATABASE_URL` or Graph connectivity in a
Claude Code session (CLAUDE.md). `lib/db/migrations/manual/2026-08-05-weighted-scoring-investigation-413.sql`
is read-only and captures exactly the two modelled quantities from live data, so the numbers
above can be confirmed or corrected. Its Q4-vs-Q7 pair is the headline: the ratio between the
denominator's basis and the numerator's basis, before any weight is considered.

**Shortcut for the denominator half:** the Simulator Studio **Pillar Matrix**
(`GET /api/admin/signal-rules/pillar-matrix`, backed by
[pillar-matrix.ts](../artifacts/api-server/src/lib/pillar-matrix.ts)) already computes
`theoreticalMax` per pillar with the identical formula, with a `signalEvaluable` flag per row.
Those numbers are authoritative and need no SQL.

---

## Open question for Q9

`2026-08-05-weighted-scoring-investigation-413.sql` Q9 asks which rules can even *read* the two
confirmed findings. If it returns nothing for `conditionalAccessPolicyCount`, then the
platform's two worst confirmed findings contribute **zero** to the score — a simpler and more
serious failure than dilution, and one that would have to be settled before any reweighting is
worth doing.
