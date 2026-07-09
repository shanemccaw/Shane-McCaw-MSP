---
name: Email templates DB migration pattern
description: How hardcoded transactional/admin emails were moved to the email_templates DB table, and a seeder-wiring pitfall hit along the way
---

Pattern used to move a hardcoded HTML email (subject + body) into the DB-editable `email_templates` table while keeping a hardcoded fallback:
- Add a row to the `TEMPLATES` array in `seed-email-templates.ts` (slug, recipientType `"client"|"admin"`, subject, bodyHtml with `{{var}}` placeholders, variables list).
- At the call site, replace the raw `sendEmail(...)` with `sendEmailFromTemplate(slug, to, vars, defaultSubject, defaultBodyHtml)` (or `getEmailTemplateOrFallback` + `sendEmailOrThrow` when more control over wrapping is needed), passing the original inline HTML as the fallback so failures/missing rows degrade gracefully.
- For emails with conditional HTML fragments (e.g. a row that only appears if a field is present), pre-render the fragment into a variable whose name ends in `Html` or `Rows` (e.g. `companyRowHtml`, `rowsHtml`) — the mailer's variable substitution skips HTML-escaping for those suffixes so the fragment renders as markup instead of literal text.
- Wrapping a previously-synchronous call site in `void (async () => {...})()` to allow `await`-ing the now-async `brandedEmail()`/template lookup can break TS type-narrowing on properties read from an outer `if (x.prop)` guard (e.g. `Date | undefined` inside the closure) — capture the narrowed value into a local `const` right before the closure to preserve the narrowing.

**Why:** the DB-backed template call sites were fully wired up and typechecked cleanly, but the actual `seedEmailTemplates()` function was never invoked from `index.ts` startup (unlike `seedAiPrompts`/`seedArticles`/`seedSystemWorkflows`, which are). This meant new template rows silently never made it into the DB and every send silently fell through to the hardcoded fallback — no error, no typecheck failure, just permanently "using the old copy."

**How to apply:** whenever adding a new seeder file/function for DB-backed content (email templates, prompts, articles, etc.), grep `index.ts` (or the app's startup file) to confirm the seeder is actually called on boot — do not assume defining the function is sufficient. After seeding, restart the workflow and check startup logs for a "seeded" log line per new slug to confirm it landed in the DB.
