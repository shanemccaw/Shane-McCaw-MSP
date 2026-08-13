-- Diagnostic (read-only) — Git #976 email template branding audit.
-- Pure SELECT: no DDL/DML, no self-marking INSERT (diagnostics are exempt per CLAUDE.md).
-- Purpose: let Shane confirm from live data what the static code trace found —
--   (a) the full set of email_templates rows and their is_customized flags,
--   (b) that the 4 orphaned slugs really are DB rows with no wired send path,
--   (c) which slugs are NOT seeded by seed-email-templates.ts (created out-of-band).

-- 1) Every row, newest edits first. Watch is_customized: true = edited via Admin Panel
--    (the seeder will preserve it and never overwrite from the code baseline).
SELECT
  slug,
  name,
  recipient_type,
  is_customized,
  length(body_html) AS body_len,
  (position('{{body}}' in body_html) > 0) AS has_body_placeholder,   -- only branded-layout should be true
  updated_at
FROM email_templates
ORDER BY updated_at DESC;

-- 2) Total count — #976 states 27. Confirm.
SELECT count(*) AS total_template_rows FROM email_templates;

-- 3) The 4 orphan rows the audit found with no wired send path.
--    Expect all 4 present (kanban-* / manual-script-escalation are also NOT
--    seeded by seed-email-templates.ts — i.e. authored out-of-band).
SELECT slug, name, is_customized, updated_at
FROM email_templates
WHERE slug IN (
  'client-thread-reply',
  'kanban-script-exhausted',
  'kanban-document-exhausted',
  'manual-script-escalation'
)
ORDER BY slug;

-- 4) The 24 slugs seed-email-templates.ts DOES seed. Any DB slug NOT in this list
--    was created out-of-band (older migration or Admin Panel authoring). Expect the
--    3 kanban/manual slugs to surface here as "in DB but not code-seeded".
SELECT slug
FROM email_templates
WHERE slug NOT IN (
  'purchase-confirmation','onboarding-confirmation','account-setup','password-reset',
  'contact-inquiry-notification','closure-request','status-report-reply','client-thread-reply',
  'admin-thread-reply','retainer-resumed','service-overview-lead-notification','quiz-lead-notification',
  'admin-purchase-alert','service-overview-email','client-message-notification','admin-message-notification',
  'quiz-report-email','welcome-email','mfa-reset','branded-layout','discovery-call-confirmation',
  'admin-discovery-call-notification','tenant-health-block','script-run-failed'
)
ORDER BY slug;
