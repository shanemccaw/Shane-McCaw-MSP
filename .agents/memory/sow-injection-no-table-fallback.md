---
name: SOW workstream-table injection must handle "no table at all"
description: injectMissingWorkstreams-style repair helpers that only patch rows into an existing table silently no-op when the AI drops the table entirely — must synthesize a fresh table as a fallback, or the caller's hard-fail path retries forever on a deterministic failure.
---

When a generation pipeline parses an AI-produced HTML/table structure and then
"heals" missing required rows by finding the matching table and inserting rows
into it, always handle the case where **no matching table exists at all** (not
just "table exists but rows missing"). If the repair step silently returns the
input unchanged when no table is found, and the caller then re-validates and
throws a hard error, the failure is deterministic — the AI response shape that
caused it will likely recur on every retry with the same or similar output,
producing an infinite retry loop if there's a retry system wired to
`sow.generation_stalled`-style stall detection.

**Why:** In `consolidated-sow-generator.ts` + `sow-pricing.ts`, the workstream
pricing table is detected only by header text containing "final price" /
"base ceiling" / "fixed price". When the AI omitted the whole pricing table
(regardless of exact cause), `injectMissingWorkstreams()` found no table to
inject rows into and returned the HTML unchanged, so the post-injection
re-parse still showed all catalog phases "missing" and the generator threw
`SOW generation failed: signal/phase drift could not be reconciled`. This
looked identical to a genuine hallucination bug from the logs, but the real
gap was the "no table found" branch having no fallback.

**How to apply:** When building this kind of catalog-driven repair/injection
helper, always add a synthesize-from-scratch branch alongside the "insert into
existing table" branch, using the same table-header keywords the parser looks
for so re-validation succeeds. Insert the synthesized block near a relevant
heading if one exists, else after the last existing table, else at the end of
the document — don't require a pre-existing anchor to exist.

**Second, sneakier variant of the same bug class:** even the "insert into
existing table" branch can silently fail the same way if the injected `<tr>`
has fewer `<td>` cells than the real table's column count. The parser finds
the price column by header-derived index (e.g. column 3 of a 5-column
`Project/Workstream | Scope | Base Ceiling | Final Price (USD) | Reasoning`
table); a hardcoded 3-cell synthetic row puts the price at `cells[2]` while
the re-parser reads `cells[3]`, which is `undefined` — so the injected row is
silently dropped on re-parse and the caller sees the exact same "still
missing" failure as if injection never ran. Always derive the synthetic row's
cell count/positions from the real header, not from an assumed fixed layout.
Root cause of the original AI mismatch in this case: the AI used the generic
category names from the pricing-formula instructions (e.g. "Security
Remediation") as row titles instead of the exact signal-catalogue project
titles (e.g. "Security & Compliance Hardening for Microsoft 365") it was told
to copy verbatim — a prompt-following drift, not a parsing bug, but it only
surfaced because the injection repair path was itself broken.
