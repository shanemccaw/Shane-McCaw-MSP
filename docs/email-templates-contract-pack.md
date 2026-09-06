# Email Templates — real contract pack for Design's visual refresh

**Issue:** #3051, part of #1485 (EPIC: Portal). READ-ONLY session; no code changed
producing this pack — a full line-by-line audit against the real, current
`artifacts/api-server/src/lib/seed-email-templates.ts`, the real admin editor
(`artifacts/admin-panel/src/pages/EmailTemplates.tsx` + its route,
`artifacts/api-server/src/routes/admin-email-templates.ts`), and every real call
site that actually sends each template — confirmed via grep against the current
worktree, not assumed from the slug/name.

**Real path correction from the issue body:** the issue names the seed file as
`lib/seed-email-templates.ts`. Its real current path is
`artifacts/api-server/src/lib/seed-email-templates.ts` — noted here so a future
reader searching the literal path in the issue body doesn't come up empty.

## 0. The "31 templates" count does not match current reality — read this first

The issue title and body both say **31 real templates**. As of this session:

- `TEMPLATES` array in `seed-email-templates.ts` defines **24** entries (confirmed by
  grep — `slug:` appears 31 times in the file total, but 7 of those are code
  plumbing: the `TemplateDefinition` interface field and six `tpl.slug` /
  `emailTemplatesTable.slug` references inside `seedEmailTemplates()`, not template
  rows).
- The live local `email_templates` DB table has **27** rows — `SELECT count(*) FROM
  email_templates;` on the local dev Postgres, 2026-09-06. The 3 rows beyond the 24
  seeded ones (`kanban-document-exhausted`, `kanban-script-exhausted`,
  `manual-script-escalation`) are **not seeded by this file at all** — authored
  out-of-band, with **zero** code references anywhere in `artifacts/api-server/src`.
- None of this is new: **#976** (closed 2026-08-13) ran the identical audit against
  commit `555278b4` and reported the same 24-seeded/27-total split, the same 3 orphan
  rows, and the same dead `purchase-confirmation` DB row documented in §7 below. This
  session independently re-confirmed every one of #976's findings still holds against
  current `HEAD`, and additionally found one gap #976's audit did not cover: a live
  send call site (`consent-invite`, §7) with no `email_templates` row backing it at
  all — not present in #976's per-slug list because it isn't a DB row to enumerate.
- **Net: 24 code-seeded + 3 orphan-DB-only = 27 total DB rows, not 31.** This pack
  documents the real 24 code-defined templates in full (§§2-6), the 3 orphan DB-only
  rows (§8), and the 1 live-but-rowless slug (§7's `consent-invite` finding), for a
  combined 28 real slugs touching this system in some way. There is no 29th, 30th or
  31st real template anywhere in the current codebase or DB.

## 1. The shell — `branded-layout`

Slug: `branded-layout`. `recipientType: "admin"` in the schema (irrelevant here — this
is the one wrapper every other template's content renders inside, not itself sent
standalone). Subject: `""` (never sent with a subject of its own).

- **Variables:** `body` — "Raw inner HTML body content to render inside the branded
  header/footer wrapper. Do not remove this placeholder."
  (`seed-email-templates.ts:490-492`)
- **Real current bodyHtml:** `seed-email-templates.ts:493-527`. Full HTML document
  (`<!DOCTYPE html>`…`</html>`) — navy header (`#0A2540`) reading "Shane McCaw
  Consulting" / "Lead Microsoft 365 Architect", a 600px white content card holding
  `{{body}}`, and a light-grey footer (`#f1f5f9`) with `shanemccaw.com` and the
  consent line "You're receiving this because you have an account or made a purchase
  with us." Every inline link/button in every inner template uses `#0078D4`
  ("Electric Blue" per the AI-generate brand rules at
  `admin-email-templates.ts:274`).
- **Real trigger:** read by `brandedEmail(bodyHtml)` (`mailer.ts:97-113`), the single
  wrap point `sendEmailOrThrow` calls unless `opts.skipWrapper` is set
  (`mailer.ts:197`). If the DB lookup fails, `mailer.ts:47-95`
  (`hardcodedBrandedLayout`) is the fallback — a byte-for-byte hardcoded copy of the
  same markup, kept in sync manually (no automated check that the two match).
- **Send volume:** n/a — never sent as a standalone email; wraps essentially every
  other send in this pack.

## 2. Reusable snippet — `tenant-health-block`

Slug: `tenant-health-block`. `recipientType: "client"`. Subject: `""` (never sent
standalone — embedded into other client-facing templates via `{{tenantHealthBlockHtml}}`).

- **Variables:** 10 fields — `tenantScore`, `tenantScoreBand`, `complianceScore`,
  `securityScore`, `governanceScore`, `adoptionScore`, `copilotScore`,
  `tenantHealthIsZero`, `tenantHealthIsLow`, `tenantHealthIsHigh`
  (`seed-email-templates.ts:590-599`).
- **Real current bodyHtml:** `seed-email-templates.ts:605-609` — deliberately
  minimal per the comment directly above it (`seed-email-templates.ts:601-604`): one
  table row showing `{{tenantScore}} / 100`. The comment states final visual design
  is explicitly out of scope for the change that introduced it and should be built
  out from the Admin Panel — **this is a genuine, acknowledged half-finished visual,
  a real candidate for Design's refresh**, not a placeholder to preserve as-is.
- **Real trigger:** `getTenantHealthBlockHtml(clientUserId)` (`mailer.ts:936-968`) —
  queries `clientHealthHistoryTable` for the caller's latest per-category scores,
  computes the 10 vars, then calls `getEmailTemplateOrFallback("tenant-health-block",
  ...)` and returns the rendered HTML (or `""` on no client/no history/any error —
  never throws). Called from every client-facing send site below that has a
  `tenantHealthBlockHtml` variable (purchase-confirmation's *intended* DB path,
  onboarding-confirmation, closure-request, status-report-reply, admin-thread-reply,
  retainer-resumed, client-message-notification, discovery-call-confirmation).
- **Send volume:** not independently trackable — embedded inline, no separate
  `email_events` row.

## 3. Purchase / onboarding flow

| Slug | recipientType | Subject |
|---|---|---|
| `purchase-confirmation` | client | `Payment confirmed — {{serviceName}}` |
| `onboarding-confirmation` | client | `Your project workspace is ready — {{serviceName}}` |
| `account-setup` | client | `Set up your Shane McCaw Consulting portal` |
| `admin-purchase-alert` | admin | `New purchase: {{serviceName}} — {{clientName}}` |

### `purchase-confirmation` — ⚠️ dead DB row, do not assume editing it does anything

- **Variables:** `clientName`, `serviceName`, `amountDollars`, `portalLink`,
  `tenantHealthBlockHtml` (`seed-email-templates.ts:23-29`).
- **Real current bodyHtml:** `seed-email-templates.ts:30-42` — summary table (Service
  / Amount paid), "Shane will be in touch within 1–2 business days" copy, a
  `View your portal →` button, the tenant-health block, then a sign-off.
- **Real trigger — confirmed dead, not assumed:** all three real payment-confirmation
  send sites bypass this DB row entirely and call the hardcoded
  `purchaseConfirmationEmail()` builder (`mailer.ts:486-511`) directly through
  `sendEmail()`, never through `sendEmailFromTemplate`/`getEmailTemplateOrFallback`:
  `portal-checkout-direct.ts:396-406`, `public-assessment-payment.ts:864-873`,
  `public-purchase-payment.ts:658-667`. **Admin-Panel or Design edits to the
  `purchase-confirmation` row in `email_templates` have zero effect on any real
  purchase-confirmation email that goes out.** This is not a new finding — #976
  documented the identical drift on 2026-08-13 against `555278b4` and it still holds
  against current `HEAD`. If Design refreshes this template's visual content, the
  real HTML that needs the same refresh lives in `mailer.ts:486-511`
  (`purchaseConfirmationEmail`), not the DB row.
- **Send volume (local dev signal only — see §9 for methodology and caveats):** 11
  `email_events` rows matching `Payment confirmed — %` in local dev history
  (2026-07-21 through 2026-09-05), all via the hardcoded path above; **0** rows show
  any signal of the DB-templated path ever firing.

### `onboarding-confirmation`

- **Variables:** `clientName`, `serviceName`, `amountDollars`, `projectUrl`,
  `tenantHealthBlockHtml` (`seed-email-templates.ts:49-55`).
- **Real current bodyHtml:** `seed-email-templates.ts:56-71` — numbered "what happens
  next" list, summary table, `View your project workspace →` button, tenant-health
  block.
- **Real trigger:** `sendEmailFromTemplate("onboarding-confirmation", ...)` —
  `portal-checkout-free.ts:280-284` (the $0/free-checkout onboarding path).
- **Send volume:** 0 local-dev `email_events` rows matched (free-checkout path not
  exercised in local test history).

### `account-setup`

- **Variables:** `setupLink`, `clientName` (`seed-email-templates.ts:78-81`).
- **Real current bodyHtml:** `seed-email-templates.ts:82-89` — "Set up my portal →"
  button, 72-hour expiry notice.
- **Real trigger — 6 real call sites**, all `sendEmailFromTemplate("account-setup",
  ...)`: `auth.ts:753-756`, `admin-clients.ts:915-918`,
  `admin-active-directory.ts:1601-1604`, `msp-team.ts:297-300`,
  `portal-team.ts:147-150`, `portal-checkout-free.ts:271-274` — every path that
  provisions a new portal user (self-signup, admin-added client, AD-synced client,
  MSP team invite, portal team invite, free-checkout signup).
- **Send volume:** 10 local-dev `email_events` rows (exact-subject match on `Set up
  your Shane McCaw Consulting portal`) — the single highest-volume real send in this
  pack's local-dev signal, consistent with it firing from 6 independent trigger
  points.

### `admin-purchase-alert`

- **Variables:** `clientName`, `clientEmail`, `serviceName`, `amountDollars`,
  `purchaseType`, `portalLink` (`seed-email-templates.ts:326-333`).
- **Real current bodyHtml:** `seed-email-templates.ts:334-346` — summary table
  (Client / Email / Service / Amount), "Please activate the service..." instruction,
  `View in dashboard →` button.
- **Real trigger:** `sendEmailFromTemplate("admin-purchase-alert", ...)` —
  `portal-checkout-free.ts:320-323` (free-checkout purchase alert to Shane).
- **Send volume:** 11 local-dev `email_events` rows matched (`New purchase: %`).

### Also in this module, but not a real, currently-editable template

- **`consent-invite`** — see §7. Live call site, sends a consent-request email on
  every admin-added client, but has **no** `email_templates` row at all.
- **`welcome-email`** — nominally purchase/onboarding-shaped by name, but see §8 —
  no static route sends it.

## 4. Account security

| Slug | recipientType | Subject |
|---|---|---|
| `password-reset` | client | `Reset your Shane McCaw Consulting portal password` |
| `mfa-reset` | client | `Your two-factor authentication has been reset` |

### `password-reset`

- **Variables:** `resetLink` (`seed-email-templates.ts:96-98`).
- **Real current bodyHtml:** `seed-email-templates.ts:99-106` — "Reset my password →"
  button, 1-hour expiry notice.
- **Real trigger — 5 real call sites**, all `sendEmailFromTemplate("password-reset",
  ...)`: `auth.ts:773-776`, `admin-active-directory.ts:1587-1590`,
  `msp-settings.ts:846-849`, `msp-team.ts:473-476`, `portal-team.ts:508-511`.
- **Send volume:** 1 local-dev `email_events` row (exact-subject match).

### `mfa-reset`

- **Variables:** `clientName`, `methodsList`, `loginLink`, `securityLink`
  (`seed-email-templates.ts:468-473`).
- **Real current bodyHtml:** `seed-email-templates.ts:474-483` — lists the cleared
  MFA method(s), "Sign in to your portal →" button, a security-settings link, and a
  "contact us immediately" notice if the change was unexpected.
- **Real trigger — 5 real call sites**, all `sendEmailFromTemplate("mfa-reset", ...)`:
  `admin-clients.ts:1298-1301`, `mfa.ts:268-271`, `msp-settings.ts:925-928`,
  `msp-team.ts:577-580`, `portal-team.ts:610-613`.
- **Send volume:** 0 local-dev `email_events` rows matched (exact-subject match on
  `Your two-factor authentication has been reset` — no local-dev triggers of this
  path in the captured window despite 5 wired call sites).

## 5. Messaging / threads

| Slug | recipientType | Subject |
|---|---|---|
| `status-report-reply` | client | `Shane replied to your question on {{reportTitle}}` |
| `client-thread-reply` | admin | `{{clientName}} replied on {{reportTitle}}` |
| `admin-thread-reply` | client | `Shane replied on {{reportTitle}}` |
| `client-message-notification` | client | `New message from Shane McCaw Consulting` |
| `admin-message-notification` | admin | `New client message from {{clientName}}` |

### `status-report-reply`

- **Variables:** `clientName`, `reportTitle`, `adminReply`, `projectUrl`,
  `tenantHealthBlockHtml` (`seed-email-templates.ts:172-177`).
- **Real current bodyHtml:** `seed-email-templates.ts:178-186` — blockquote of
  Shane's reply, `View your project →` button, tenant-health block.
- **Real trigger:** `sendEmailFromTemplate("status-report-reply", ...)` —
  `admin-status-reports.ts:65-68`.
- **Send volume:** 0 local-dev `email_events` rows matched.

### `client-thread-reply` — ⚠️ no wired send path at all

- **Variables:** `clientName`, `reportTitle`, `replyContent`, `adminPanelUrl`
  (`seed-email-templates.ts:193-198`).
- **Real current bodyHtml:** `seed-email-templates.ts:199-206` — blockquote of the
  client's reply, `View in admin panel →` button.
- **Real trigger:** none. The hardcoded builder `clientThreadReplyEmail()`
  (`mailer.ts:651-670`) exists but is **never called** anywhere in
  `artifacts/api-server/src` (confirmed by grep — the only two references to the
  slug in the whole codebase are its own seed definition and the `SAMPLE_VARS` entry
  used solely by the Admin Panel's "send test email" preview,
  `admin-email-templates.ts:63-68`). Only `admin-thread-reply` (the client-facing
  counterpart, §5 above) actually fires on status-report threads. Same conclusion as
  #976's `⚠️ No real trigger path found` bucket, still true against current `HEAD`.
- **Send volume:** 0 — cannot fire.

### `admin-thread-reply`

- **Variables:** `clientName`, `reportTitle`, `replyContent`, `projectUrl`,
  `tenantHealthBlockHtml` (`seed-email-templates.ts:213-219`).
- **Real current bodyHtml:** `seed-email-templates.ts:220-228` — blockquote of
  Shane's reply, `View your project →` button, tenant-health block.
- **Real trigger:** `sendEmailFromTemplate("admin-thread-reply", ...)` —
  `admin-status-reports.ts:139-142`.
- **Send volume:** 0 local-dev `email_events` rows matched.

### `client-message-notification`

- **Variables:** `clientName`, `messageBody`, `portalLink`, `tenantHealthBlockHtml`
  (`seed-email-templates.ts:371-376`).
- **Real current bodyHtml:** `seed-email-templates.ts:377-383` — blockquote of the
  message, `View in your portal →` button, tenant-health block.
- **Real trigger:** `sendEmailFromTemplate("client-message-notification", ...)` —
  `portal-messages.ts:98-101`.
- **Send volume:** 0 local-dev `email_events` rows matched.

### `admin-message-notification`

- **Variables:** `clientName`, `messageBody` (`seed-email-templates.ts:390-393`).
- **Real current bodyHtml:** `seed-email-templates.ts:394-399` — blockquote of the
  client's message.
- **Real trigger:** `sendEmailFromTemplate("admin-message-notification", ...)` —
  `portal-messages.ts:140-143`.
- **Send volume:** 0 local-dev `email_events` rows matched.

## 6. Marketing leads (quiz / discovery-call / service overview / contact)

| Slug | recipientType | Subject |
|---|---|---|
| `contact-inquiry-notification` | admin | `New contact inquiry from {{name}} — {{company}}` |
| `service-overview-lead-notification` | admin | `New service overview request from {{name}} — {{company}}` |
| `service-overview-email` | client | `Your {{serviceName}} overview — Shane McCaw Consulting` |
| `quiz-lead-notification` | admin | `New quiz lead — {{name}} scored {{totalScore}}/50` |
| `quiz-report-email` | client | `Your {{reportName}} Report` |
| `discovery-call-confirmation` | client | `Discovery Call Confirmed — {{slotLabel}}` |
| `admin-discovery-call-notification` | admin | `New Booking: {{name}} — {{slotLabel}}` |

### `contact-inquiry-notification`

- **Variables:** `name`, `email`, `company`, `companySize`, `serviceArea`, `message`,
  `howFound` (`seed-email-templates.ts:113-121`).
- **Real current bodyHtml:** `seed-email-templates.ts:122-137` — full lead-details
  table, message blockquote, `Reply to {{name}} →` mailto button.
- **Real trigger:** `getEmailTemplateOrFallback("contact-inquiry-notification", ...)`
  → `sendEmailOrThrow` — `leads.ts:162-184` (the `contact_form` lead-source branch).
- **Send volume:** 1 local-dev `email_events` row matched.

### `service-overview-lead-notification`

- **Variables:** `name`, `email`, `company`, `serviceName`
  (`seed-email-templates.ts:261-265`).
- **Real current bodyHtml:** `seed-email-templates.ts:266-277` — lead-details table,
  `Reply to {{name}} →` mailto button.
- **Real trigger:** `sendEmailFromTemplate("service-overview-lead-notification",
  ...)` — `leads.ts:152-158`.
- **Send volume:** 0 local-dev `email_events` rows matched.

### `service-overview-email`

- **Variables:** `firstName`, `serviceName`, `bookingLink`
  (`seed-email-templates.ts:353-357`).
- **Real current bodyHtml:** `seed-email-templates.ts:358-364` — "Shane personally
  reviews every request... within one business day" copy, `Book a Free Discovery
  Call →` button.
- **Real trigger:** `getEmailTemplateOrFallback("service-overview-email", ...)` —
  `leads.ts:135-146` (with a conditional PDF attachment path that re-wraps via
  `brandedEmail()` explicitly since `sendEmailWithAttachment` does not auto-wrap).
- **Send volume:** 0 local-dev `email_events` rows matched.

### `quiz-lead-notification`

- **Variables:** `name`, `email`, `company`, `totalScore`, `tier`,
  `recommendedService`, `whatThisMeans`, `whyThisFits`, `roiProjection`,
  `categoryScoresRows`, `resultsUrl` (`seed-email-templates.ts:285-296`).
- **Real current bodyHtml:** `seed-email-templates.ts:297-319` — full lead-details
  table with a dynamic category-scores row block, three AI-generated narrative
  sections (What This Means / Why This Fits / ROI Projection), a results-link,
  `Reply to {{name}} →` button.
- **Real trigger:** `sendEmailFromTemplate("quiz-lead-notification", ...)` —
  `quiz.ts:638-656` (the Copilot Readiness quiz's admin-notification send; this
  specific route's own `defaultSubject` arg differs cosmetically from the DB row's
  seeded subject, but the DB row's real subject wins whenever the row exists, which
  it does).
- **Send volume:** 1 local-dev `email_events` row matched. (Note: a *different*,
  unrelated "Home quiz" lead flow — 4 local-dev rows matched `New Home quiz lead:
  %` — sends via its own `homeQuizLeadNotificationEmail()` builder
  (`mailer.ts:791-822`, called from `quiz.ts:780`) straight through `sendEmail()`,
  bypassing the DB template layer entirely; it is a separate quiz product from the
  one `quiz-lead-notification`/`quiz-report-email` serve, not part of this pack's 24,
  and not itself a `email_templates` row.)

### `quiz-report-email`

- **Variables:** `firstName`, `reportName`, `totalScore`, `tier`,
  `recommendedService`, `whatThisMeans`, `whyThisFits`, `roiProjection`,
  `categoryScoresRows`, `resultsUrl` (`seed-email-templates.ts:407-417`).
- **Real current bodyHtml:** `seed-email-templates.ts:418-437` — the lead-facing
  mirror of `quiz-lead-notification`'s content (summary table, three narrative
  sections), plus a `Book a Strategy Call →` button the admin notification doesn't
  have.
- **Real trigger — 2 real call sites**, both `getEmailTemplateOrFallback` +
  `sendEmailWithAttachment` (PDF report attached): the initial-submission path
  (`quiz.ts:685-693`, PDF generated fresh) and the results-resend path
  (`quiz.ts:888-899`, PDF regenerated from the stored lead record).
- **Send volume:** 0 local-dev `email_events` rows matched (subject pattern `Your %
  Report` — no local-dev sends of either quiz-report path captured in the window;
  this is a `sendEmailWithAttachment` path, and attachment sends are not the ones
  instrumented into `email_events` — see §9).

### `discovery-call-confirmation`

- **Variables:** `name`, `slotLabel`, `companyRowHtml`, `joinButtonHtml`,
  `calendarNoticeHtml`, `tenantHealthBlockHtml` (`seed-email-templates.ts:535-541`).
- **Real current bodyHtml:** `seed-email-templates.ts:542-556` — booking summary
  table (date/time, 30 min, Microsoft Teams, optional company row), an optional
  Join-Teams-Meeting button, an optional calendar-invite notice, tenant-health block.
- **Real trigger:** `sendEmailFromTemplate("discovery-call-confirmation", ...)` —
  `booking.ts:268-271` (`tenantHealthBlockHtml` is hardcoded to `""` at this call
  site — new leads booking a call have no client record yet, so the block is never
  populated here even though the template supports it).
- **Send volume:** 0 local-dev `email_events` rows matched.

### `admin-discovery-call-notification`

- **Variables:** `name`, `email`, `slotLabel`, `companyRowHtml`, `topicHtml`
  (`seed-email-templates.ts:563-569`).
- **Real current bodyHtml:** `seed-email-templates.ts:570-582` — booking-details
  table, topic/agenda blockquote.
- **Real trigger:** `sendEmailFromTemplate("admin-discovery-call-notification",
  ...)` — `booking.ts:292-295`.
- **Send volume:** 0 local-dev `email_events` rows matched.

## 7. Admin alerts

### `script-run-failed`

- **recipientType:** admin. **Subject:** `Script run failed — {{clientLabel}}`.
- **Variables:** `clientLabel`, `moduleFilename`, `packageTitle`, `lastStatus`,
  `runId` (`seed-email-templates.ts:617-622`).
- **Real current bodyHtml:** `seed-email-templates.ts:623-628` — a plain 3-line
  notice (failed module/package, job status, run ID) with no button and no branded
  table styling — visibly less polished than the rest of this pack, a real candidate
  for the visual refresh.
- **Real trigger:** `sendEmailFromTemplate("script-run-failed", ...)` —
  `client-script-sequence.ts:468-471`.
- **Send volume:** 0 local-dev `email_events` rows matched.

### Also fires alerts through this module, but not via the DB template layer

- **`appRegExpiryAlertEmail()`** (`mailer.ts:855-884`) is a separate hardcoded
  admin-alert builder (app-registration credential expiry warnings), called from
  `admin-clients.ts:725` through `brandedEmail()` directly — no `email_templates`
  row backs it at all, same shape of gap as `consent-invite` below. Out of scope for
  this pack's 24/27 count (it was never a DB row to begin with, and #976's audit
  didn't cover it either), noted here only because a Design pass over "admin alert"
  emails should know it exists.

## 8. ⚠️ Real finding — `consent-invite`: live send, no `email_templates` row

`admin-clients.ts:872-879` — every time an admin adds a client directly (not via a
purchase flow), this fires:

```
sendEmailFromTemplate(
  "consent-invite",
  normalizedEmail,
  { clientName, consentLink },
  "Connect your Microsoft 365 to get started with Shane McCaw Consulting",
  `<p>Hi ...</p>...<a ...>Connect Microsoft 365 →</a>...`,   // hardcoded inline in the route
)
```

`consent-invite` is **not** one of the 24 seeded slugs and **not** one of the 27 live
DB rows (confirmed by the same `SELECT slug FROM email_templates` query used
throughout this pack). Every real send of this email therefore always falls through
`getEmailTemplateOrFallback`'s `catch`/no-row branch (`mailer.ts:913-922`) to the
hardcoded default subject/body written inline in the route itself. It still gets
wrapped in `branded-layout` (the wrap happens unconditionally in `sendEmailOrThrow`
unless `skipWrapper` is set — this call doesn't set it), so visually it looks
consistent with the rest of the system, but:

- It is **invisible to the Admin Panel editor** — `GET /admin/email-templates`
  can't list a row that doesn't exist, so Shane has no way to see or edit this
  email's copy from the UI at all.
- It is **out of reach for Design's refresh via the normal PUT-import path** — the
  issue's own stated follow-up ("PUT `/admin/email-templates/:slug` already accepts
  a body update... a small script/agent task that reads each finished template and
  PUTs it") cannot touch this email, because there is no row for it to PUT into.
- This is a genuinely new gap, not a re-surfacing of #976 — #976's audit enumerated
  the 27 *existing* DB rows and traced each one's send path; it had no way to also
  catch a live call site referencing a slug that was never a row, since that
  requires grepping every `sendEmailFromTemplate`/`getEmailTemplateOrFallback` call
  site (this session's method) rather than starting from the DB table (#976's
  method). Both methods are legitimate; they simply catch different classes of gap.

Filed as its own issue per the standing "file every finding" rule — see the DONE
bookend for the number.

## 9. The 3 orphan DB-only rows — confirmed still true, not re-litigated

`kanban-document-exhausted`, `kanban-script-exhausted`, `manual-script-escalation`
exist as live `email_templates` rows (`is_customized: false` on all 3, confirmed via
the local DB query in the diagnostic below) but have **zero** references anywhere in
`artifacts/api-server/src` outside the diagnostic SQL file itself, and are **not**
seeded by `seed-email-templates.ts` — a reseed would not recreate them if dropped.
Identical conclusion to #976 (2026-08-13, commit `555278b4`), independently
re-confirmed against current `HEAD` in this session via the same grep. Read-only
confirmation query already exists and needs no new work:
`lib/db/migrations/manual/archive/diagnostics/2026-08-13-email-template-audit-976.sql`.
Not re-filing — #976's own comment already handed Shane the to-do ("wire them to a
workflow `send_email` node, or remove them"); this pack just confirms the state is
unchanged three weeks later.

## 10. Real send-volume methodology (§§3-7) and its real limits

`email_events` (`mailer.ts:204-210`, written on every successful `sender()` call
inside `sendEmailOrThrow`) is the only table logging real sends — but it stores
`eventType`, `recipient`, `subject` (the real, already-interpolated subject text) and
a JSON `metadata`, **not a template slug column**. There is therefore no exact,
direct per-slug count. The counts cited above are a best-effort read-only signal:
match each template's known static subject fragment (exact string for a fixed
subject, `LIKE` prefix/suffix for a subject containing `{{variables}}`) against
`email_events.subject` and count matches — real query, real rows, methodology stated
plainly so it can be checked or repeated.

**Real, stated limits on this signal, so it isn't over-read:**

- **Local dev DB only.** This is the local PostgreSQL 18 instance
  (`DATABASE_URL` in `.env.local`), not production or Replit/Staging. Total volume in
  the entire captured window (2026-07-21 through 2026-09-05, ~6 weeks) is **54**
  `sent` events — clearly local/test traffic, not a customer-facing production
  signal. Treat every count in §§3-7 as "how often this path was exercised in local
  dev testing," never as real customer send volume.
- **`sendEmailWithAttachment` sends are not instrumented into `email_events` at all**
  (`mailer.ts:239-256`, `262-280` — no `db.insert(emailEventsTable...)` call in
  either function, unlike `sendEmailOrThrow`). `quiz-report-email` and the
  PDF-attachment branch of `service-overview-email` both send this way, so their
  local-dev `0` counts above reflect an instrumentation gap, not necessarily zero
  real local sends.
- Subject-pattern matching can only be as precise as the subjects are distinct;
  every pattern used above was checked against the real captured subjects for false
  positives before being reported (e.g. `quiz-report-email`'s broad `Your % Report`
  pattern matched 0 real rows, so no collision risk surfaced in practice, but a
  future new template with a similarly-shaped subject could start colliding with it
  — this is a heuristic, not a schema-level guarantee).

## 11. Admin editor structure (confirmed against the real UI)

`artifacts/admin-panel/src/pages/EmailTemplates.tsx` — flat list, no module grouping
in the UI itself. The only real filter is `recipientType` (`FilterType = "all" |
"client" | "admin"`, `EmailTemplates.tsx:352,481`) — the module groupings used in
§§3-7 above (purchase/onboarding, account security, messaging, marketing leads,
admin alerts) are this pack's own organization for Design's benefit, not something
the product UI currently expresses. The route file's `SAMPLE_VARS` map
(`admin-email-templates.ts:27-138`) supplies realistic preview/test-send values for
17 of the 24 seeded slugs; the 7 missing entries (`account-setup`, `mfa-reset`,
`branded-layout`, `discovery-call-confirmation`, `admin-discovery-call-notification`,
`tenant-health-block`, `script-run-failed`) fall back to `{}` at
`admin-email-templates.ts:226`, so a "send test email" for any of those 7 renders
with raw, unsubstituted `{{variableName}}` placeholders still in the copy.

## 12. Real import path, once Design produces new HTML (per the issue — not built here)

`PUT /admin/email-templates/:slug` (`admin-email-templates.ts:173-205`) already
accepts `{ subject?, bodyHtml? }` and sets `isCustomized: true` on write — this is
the real, already-existing endpoint a future import script/agent PUTs finished
Design HTML into, one request per slug, exactly as the issue describes. Not built in
this session, per the issue's own scope ("Not building that yet — this issue is the
pack only"). Two things worth knowing in advance of that follow-up:

- `isCustomized: true` means `seedEmailTemplates()` will never again overwrite that
  row from the code baseline (`seed-email-templates.ts:663-666`) — once Design's
  content is PUT in, it's permanent from the seeder's point of view, by design.
- The import script cannot do anything about `purchase-confirmation` (§3) or
  `consent-invite` (§8) — PUTting new HTML into `purchase-confirmation` still won't
  reach a real send until `public-assessment-payment.ts` /
  `public-purchase-payment.ts` / `portal-checkout-direct.ts` are switched over to
  `sendEmailFromTemplate`, and there's no row at all yet to PUT into for
  `consent-invite`. Both are Shane's call, per #976's own to-do list and this pack's
  §8 finding — not something either this pack or the future import step should
  decide unilaterally.
