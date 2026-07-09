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
