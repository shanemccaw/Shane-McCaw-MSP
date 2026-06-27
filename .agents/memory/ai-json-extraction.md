---
name: AI JSON extraction from Claude responses
description: Claude Haiku often adds preamble prose before JSON, breaking simple start-anchored fence-strip regexes; use extractJson() instead.
---

## The rule

Never use a `^`-anchored regex to strip markdown fences from Claude responses. Claude Haiku frequently emits preamble text (e.g. "Here are the campaign assets:\n\n```json") before the actual JSON block, which means the fence is not at position 0 and `JSON.parse` receives the raw prose instead of valid JSON.

**Why:** Observed in production — `POST /api/admin/marketing/campaigns/preview-assets` consistently returned "AI returned an unreadable response" because `stripFences` used `/^```(?:json)?\s*/i` which requires the fence to be at the very start of the string.

**How to apply:** All AI route JSON parsing in this project goes through `parseAiJson()` in `admin-marketing.ts`, which now calls `extractJson()`. The `extractJson` function:
1. Looks for a ` ```json ... ``` ` or ` ``` ... ``` ` fence **anywhere** in the text (not anchored to `^`)
2. Falls back to finding the first `{` or `[` and walking matching brackets to extract the JSON object/array — handles responses with prose and no fences at all

If adding new AI routes in other route files, copy the `extractJson` pattern rather than writing a new `^`-anchored regex.
