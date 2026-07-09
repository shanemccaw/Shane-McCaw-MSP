---
name: SOW pricing formula duplication across routes
description: A hardcoded prompt fragment referenced from one file was actually copy-pasted into multiple route handlers; migrating it to a DB-editable prompt requires finding and wiring every copy, not just the "canonical" one.
---

When asked to move a hardcoded prompt block into the DB-backed AI Prompts library, don't assume the constant is defined once. Grep the whole `src/` tree for the constant name — generation routes often have separate "preview"/"payload-preview" or dry-run endpoints that keep their own duplicated copy of the same prompt text for convenience.

**Why:** In the Consolidated SOW generator, `TIER_02_PRICING_FORMULA_BLOCK` existed as an exported constant in `consolidated-sow-generator.ts`, but `admin-insights.ts` had an independent, textually-identical copy defined locally and used in 5 separate places across two different route handlers (a "generate" handler and a "payload-preview" handler). Migrating only the generator's copy would have left the preview/dry-run endpoints silently out of sync with admin edits.

**How to apply:** Before wiring a `getPrompt()`/DB-lookup call, grep for the exact constant/text across the whole workspace package, not just the file mentioned in the request. Replace every hardcoded occurrence with a call to the shared loader helper, keeping the original text only as the `fallback` argument.
