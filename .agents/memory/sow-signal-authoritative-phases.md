---
name: SOW signal-authoritative phase generation
description: How SOW phase/workstream generation was made deterministic against fired tenant signals, and where the client checklist gets its data from.
---

## Client checklist source of truth

The client-facing SOW checklist reads a stored pricing-lines snapshot computed once at generation time, not a live re-parse of HTML at request time. This means enforcing phase/signal determinism at generation time is sufficient to make the client checklist deterministic — no separate client-side enforcement path needed.

**Why:** avoids two divergent code paths (generation-time parse vs request-time parse) that could disagree on phase set.

## Determinism must be hard-enforced, not just logged

Logging drift (missing/hallucinated phases) without acting on it is NOT sufficient — a fired signal must *always* produce its phase in the persisted document, with zero AI discretion. The enforcement pipeline order that achieves this:
1. Purge hallucinated phases (rows with no matching fired-signal catalogue project) out of the HTML.
2. Canonicalize any reworded-but-matching title to the exact catalogue title (closes the gap where tolerant substring matching would otherwise let an AI paraphrase reach the client instead of the canonical signal-catalogue title).
3. Inject a synthetic row for any catalogue project still missing after purge — this is the hard guarantee. Only if the workstream table itself can't be located (malformed AI output) should generation fail loudly (throw) rather than persist an incomplete SOW.
4. Re-run the drift check as a final assertion; if it isn't clean after steps 1–3, that's unrecoverable and must throw, not log-and-continue.

**Why:** a review rejected an earlier log-only version specifically because "logs but still persists" leaves the client-visible SOW non-deterministic in practice.

**How to apply:** any new AI-generated document type where "must always include X when signal Y fires" needs the same purge → canonicalize → inject → hard-fail-if-still-broken pipeline, not just a validation log.

## adj:* signals vs phase-triggering signals

Only non-`adj:*` signal keys may spawn a phase/workstream row. `adj:*` signals only ever adjust price/scope on an existing phase and must never become their own row. Currently this is asserted in the prompt only for the AI's initial draft, but is fully guaranteed for the *persisted* output by the purge/inject pipeline scoping which titles are treated as workstreams vs adjustments.

## Verifying without a live tenant

Dev DB can be empty of real customer/SOW rows. To verify the pipeline, query the real engagement-projects catalogue table for actual catalogue titles/price ranges/triggering-signal keys, then feed a synthetic AI-HTML sample (with a hallucinated phase, a reworded title, and a missing phase) through the full purge → canonicalize → inject → drift-check pipeline directly via a Node one-liner importing the pricing module. This is a valid substitute for "verify against a real tenant" when no seeded customer exists.
