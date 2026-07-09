---
name: Email templates DB migration pattern
description: How hardcoded transactional/admin emails were moved to the email_templates DB table, a seeder-wiring pitfall, and the seeder-vs-admin-edit ownership fix
---

Pattern used to move a hardcoded HTML email (subject + body) into the DB-editable `email_templates` table while keeping a hardcoded fallback:
- Add a row to the `TEMPLATES` array in `seed-email-templates.ts` (slug, recipientType `"client"|"admin"`, subject, bodyHtml with `{{var}}` placeholders, variables list).
- At the call site, replace the raw `sendEmail(...)` with `sendEmailFromTemplate(slug, to, vars, defaultSubject, defaultBodyHtml)` (or `getEmailTemplateOrFallback` + `sendEmailOrThrow` when more control over wrapping is needed), passing the original inline HTML as the fallback so failures/missing rows degrade gracefully.
- For emails with conditional HTML fragments (e.g. a row that only appears if a field is present), pre-render the fragment into a variable whose name ends in `Html` or `Rows` (e.g. `companyRowHtml`, `rowsHtml`) — the mailer's variable substitution skips HTML-escaping for those suffixes so the fragment renders as markup instead of literal text.
- Wrapping a previously-synchronous call site in `void (async () => {...})()` to allow `await`-ing the now-async `brandedEmail()`/template lookup can break TS type-narrowing on properties read from an outer `if (x.prop)` guard (e.g. `Date | undefined` inside the closure) — capture the narrowed value into a local `const` right before the closure to preserve the narrowing.

**Why:** the DB-backed template call sites were fully wired up and typechecked cleanly, but the actual `seedEmailTemplates()` function was never invoked from `index.ts` startup (unlike `seedAiPrompts`/`seedArticles`/`seedSystemWorkflows`, which are). This meant new template rows silently never made it into the DB and every send silently fell through to the hardcoded fallback — no error, no typecheck failure, just permanently "using the old copy."

**How to apply:** whenever adding a new seeder file/function for DB-backed content (email templates, prompts, articles, etc.), grep `index.ts` (or the app's startup file) to confirm the seeder is actually called on boot — do not assume defining the function is sufficient. After seeding, restart the workflow and check startup logs for a "seeded" log line per new slug to confirm it landed in the DB.

## Seeder ownership vs admin edits, and preview parity

A DB-backed content seeder that unconditionally UPDATEs on every restart will silently discard any row an admin has edited through a UI — there is no error, the row just reverts on the next deploy/restart.

**Why:** the seeder can't tell "row still matches code baseline" from "admin intentionally changed this" without an explicit marker.

**How to apply:**
- Add an `is_customized` boolean column. The seeder skips the UPDATE (but still logs) when `is_customized = true`; the admin-facing save endpoint sets it to `true` on every save.
- Backfill existing DB content that predates the flag: on the row's next seed pass, if `is_customized` is still `false` but the stored content no longer matches the code-level baseline (subject/body/variables/etc.), treat it as a pre-existing edit — flip `is_customized = true` and preserve the content rather than overwriting it. Never assume a fresh boolean column defaulting to `false` means "safe to overwrite" for rows that already existed before the column was added.
- If any part of the seeded content is itself a reusable wrapper/layout template (e.g. a `branded-layout` row substituted into every other template at send time), any admin-facing preview UI must fetch and render that real DB row (with a fallback matching the mailer's own hardcoded fallback) instead of a separate hardcoded preview wrapper — otherwise the preview silently drifts from what actually gets sent.
- After a schema column addition, run `pnpm --filter @workspace/db run generate` (or manually create migration + update `schema-hash.txt` + insert into `__drizzle_migrations` if `drizzle-kit generate` crashes on a corrupted snapshot — see `manual-migration-workflow.md`) and confirm `check-drift` passes; a pure `ALTER TABLE IF NOT EXISTS` at startup fixes runtime but not the schema-hash gate.
