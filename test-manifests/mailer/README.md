# Email template branding audit — Git #976 (Epic #803)

**Question (Shane, #976):** For each of the 27 real `email_templates` slugs, does the
actual send code pull the DB row and wrap it in `branded-layout`'s `{{body}}`
substitution before sending — or does some path send raw/unwrapped content, or
still call an old hardcoded `mailer.ts` function instead of the table (so what
goes out ≠ what's sitting in the table)?

Traced statically against commit `555278b430cff19719adbc38e715f32676540b5a`.
Read-only trigger-path confirmation only — **no live DB queries** (per #976 /
CLAUDE.md). A read-only diagnostic SELECT for Shane lives at
`lib/db/migrations/manual/archive/diagnostics/2026-08-13-email-template-audit-976.sql`.

## How the send paths work (the model behind every verdict)

- `sendEmailFromTemplate(slug, …)` → `getEmailTemplateOrFallback` (reads the DB
  row by slug) → `sendEmail(to, subject, body, { templateName: slug })`. `sendEmail`
  wraps in `branded-layout` (no `skipWrapper`). **DB-used + wrapped, always.**
- `getEmailTemplateOrFallback(slug, …)` returns the DB row's `{subject, bodyHtml}`;
  wrapping then depends on how the caller sends it:
  - `sendEmail`/`sendEmailOrThrow`/`sendEmailForMsp*` → auto-wrapped.
  - `sendEmailWithAttachment*` → **does NOT auto-wrap**; the two attachment call
    sites compensate with an explicit `await brandedEmail(bodyHtml)` first.
- Workflow **`send_email` node** (`workflow-executor.ts`, `actionType === "send_email"`)
  with a `templateSlug` → `getEmailTemplateOrFallback` → `sendEmailOrThrow` /
  `sendEmailForMspOrThrow`. **DB-used + wrapped** when a workflow references the slug.
- `brandedEmail(bodyHtml)` reads the `branded-layout` DB row and does
  `row.bodyHtml.replace("{{body}}", bodyHtml)` (hardcoded wrapper only as DB-miss fallback).
- The hardcoded `xxxEmail()` builders in `mailer.ts` are, in almost every case,
  passed as the **fallback (default body) argument** to the two functions above —
  i.e. the DB row is preferred and the constant is only used if the row is missing.
  Passing one as a fallback is **not** "the old hardcoded path." The one real
  exception is `purchase-confirmation` (below).

## Verdict breakdown

| # | Slug | Verdict | Real send path |
|---|------|---------|----------------|
| 1 | account-setup | ✅ DB-used + wrapped | `sendEmailFromTemplate` ×5 (auth.ts:731, admin-clients.ts:915, admin-active-directory.ts:1272, portal-checkout-free.ts:270, portal-team.ts:97) |
| 2 | admin-discovery-call-notification | ✅ DB-used + wrapped | `sendEmailFromTemplate` (booking.ts:292) |
| 3 | admin-message-notification | ✅ DB-used + wrapped | `sendEmailFromTemplate` (portal-messages.ts:125) |
| 4 | admin-purchase-alert | ✅ DB-used + wrapped | `sendEmailFromTemplate` (portal-checkout-free.ts:325) |
| 5 | admin-thread-reply | ✅ DB-used + wrapped | `sendEmailFromTemplate` (admin-status-reports.ts:127) |
| 6 | client-message-notification | ✅ DB-used + wrapped | `sendEmailFromTemplate` (portal-messages.ts:88) |
| 7 | closure-request | ✅ DB-used + wrapped | `sendEmailFromTemplate` (admin-projects.ts:1014) |
| 8 | contact-inquiry-notification | ✅ DB-used + wrapped | `getEmailTemplateOrFallback` + `sendEmailOrThrow` (leads.ts:162/184) |
| 9 | discovery-call-confirmation | ✅ DB-used + wrapped | `sendEmailFromTemplate` (booking.ts:268) |
| 10 | mfa-reset | ✅ DB-used + wrapped | `sendEmailFromTemplate` ×4 (mfa.ts:265, admin-clients.ts:1298, msp-settings.ts:898, portal-team.ts:474) |
| 11 | onboarding-confirmation | ✅ DB-used + wrapped | `sendEmailFromTemplate` (portal-checkout-free.ts:279) |
| 12 | password-reset | ✅ DB-used + wrapped | `sendEmailFromTemplate` ×4 (auth.ts:751, admin-active-directory.ts:1258, msp-settings.ts:821, portal-team.ts:372) |
| 13 | quiz-lead-notification | ✅ DB-used + wrapped | `sendEmailFromTemplate` (quiz.ts:642) |
| 14 | quiz-report-email | ✅ DB-used + wrapped | `getEmailTemplateOrFallback` + `await brandedEmail` → `sendEmailWithAttachment(OrThrow)` (quiz.ts:706 submit, quiz.ts:909 resend) |
| 15 | retainer-resumed | ✅ DB-used + wrapped | `sendEmailFromTemplate` (portal-billing.ts:436) |
| 16 | script-run-failed | ✅ DB-used + wrapped | `sendEmailFromTemplate` (client-script-sequence.ts:468) |
| 17 | service-overview-email | ✅ DB-used + wrapped | `getEmailTemplateOrFallback` + `await brandedEmail` (attachment) / `sendEmail` (leads.ts:135/143/145) |
| 18 | service-overview-lead-notification | ✅ DB-used + wrapped | `sendEmailFromTemplate` (leads.ts:152) |
| 19 | status-report-reply | ✅ DB-used + wrapped | `sendEmailFromTemplate` (admin-status-reports.ts:55) |
| 20 | welcome-email | ✅ DB-used + wrapped (⚠ workflow-only) | Only the workflow `send_email` node (`templateSlug: "welcome-email"`); **no static route**. Mechanism reads DB + wraps; live firing depends on a DB workflow config. |
| 21 | **purchase-confirmation** | ❌ **still calling old hardcoded function** | `public-assessment-payment.ts:865` → `sendEmail(order.email, "Payment confirmed — …", purchaseConfirmationEmail({…}), { templateName: "purchase-confirmation-home-flow" })`. Uses the **hardcoded** `purchaseConfirmationEmail()`; the `purchase-confirmation` DB row is **never read** by any path. Still branded (sendEmail wraps), but Admin-Panel edits to the row do nothing. |
| 22 | **client-thread-reply** | ⚠ **no real trigger path** | DB row + hardcoded `clientThreadReplyEmail()` exist, but the function is never called and no `sendEmailFromTemplate`/`getEmailTemplateOrFallback`/workflow reference sends this slug. Only `admin-thread-reply` fires on status-report threads. Orphaned. |
| 23 | **kanban-script-exhausted** | ⚠ **no real trigger path** | DB row exists (part of Shane's 27) but **zero** code references anywhere — not seeded by `seed-email-templates.ts`, no send site, not in the Admin `SAMPLE_VARS`. |
| 24 | **kanban-document-exhausted** | ⚠ **no real trigger path** | Same as #23 — zero code references. |
| 25 | **manual-script-escalation** | ⚠ **no real trigger path** | Same as #23 — zero code references. |
| 26 | branded-layout | ➖ wrapper (exempt) | The wrapper itself. `brandedEmail()` reads this row and substitutes `{{body}}`; every wrapped send + the Admin preview go through it. Correct. |
| 27 | tenant-health-block | ➖ snippet (exempt) | Reusable fragment. `getTenantHealthBlockHtml()` reads this row and embeds it into client templates' `{{tenantHealthBlockHtml}}` var. Correct. |

**Totals:** 20 DB-used-and-correctly-wrapped · 1 hardcoded-function · 4 no-trigger-path · 2 wrapper/snippet exempt · **0 DB-used-but-NOT-wrapped**.

## Things for Shane to decide (audit only — #976 does not fix these)

1. **`purchase-confirmation` drift.** The home-flow payment confirmation sends the
   hardcoded `purchaseConfirmationEmail()` body, so the DB row is dead copy. Either
   switch `public-assessment-payment.ts` to `sendEmailFromTemplate("purchase-confirmation", …)`
   (customer-facing behaviour change — your call), or delete the misleading DB row.
2. **4 orphan rows** (`client-thread-reply`, `kanban-script-exhausted`,
   `kanban-document-exhausted`, `manual-script-escalation`). No wired send. The 3
   `kanban`/`manual` slugs aren't even seeded by `seed-email-templates.ts` (only 24
   of the 27 are) — a fresh reseed would not recreate them, so they were authored
   out-of-band (older migration or the Admin Panel). Decide: wire them to a workflow
   `send_email` node, or remove them.
3. **`welcome-email`** only fires from a workflow `send_email` node. Confirm a live
   workflow actually references it, or it's effectively unsent.

Run `2026-08-13-email-template-audit-976.sql` (read-only) to confirm the 27 rows,
their `is_customized` flags, and the presence of the 4 orphan slugs.

## Manifest

`email-template-branding-audit.json` (registered in `_regression-suite.json`):
- **apiTests** assert DB truth + the wrapping contract via #892 `containsAny`/`containsNone`
  (`branded-layout` retains `{{body}}`; body rows are inner-HTML-only; the snippet
  isn't the wrapper; orphan rows exist).
- **uiSteps** drive the Admin Panel Email Templates preview (`/content/email-templates`),
  which renders each real DB row wrapped in the real `branded-layout` — screenshot-gated
  per #975 (always-on capture per #977). Each step's `name` carries its verdict so
  #975's review narration surfaces the classification to Shane.
- Requires `{{TEST_ADMIN_EMAIL}}`/`{{TEST_ADMIN_PASSWORD}}` (PlatformAdmin) in the
  BuildConsole #953 Test Environment Variables store. Not executed in this session
  (no BuildConsole/DB/mail access here) — the run is Shane's.
