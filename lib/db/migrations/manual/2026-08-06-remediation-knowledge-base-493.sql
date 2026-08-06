-- Git #493 — Remediation Knowledge Base: schema + rendering infrastructure.
--
-- Manual migration — review and run by hand (do NOT run drizzle-kit push /
-- push --force; see CLAUDE.md).
--
-- WHAT THIS IS
-- ────────────
-- `remediation_knowledge_base` holds HUMAN-VERIFIED remediation content, one row
-- per `monitor_checks.key`. The Remediation Plan deliverable is a document a
-- paying customer runs PowerShell out of; until now every command in it came
-- from an LLM with no verification against real, current Microsoft cmdlet
-- syntax. This table is the DEFAULT source of truth for that document, and
-- `remediation-detail-generator.ts` (the existing AI path) becomes an
-- explicitly-labelled fallback for checks not yet covered here.
--
-- WHAT THIS IS NOT
-- ────────────────
-- This migration deliberately seeds NO content rows. Phase 1's 25 verified
-- entries are a separate, ongoing content task (tracked in #493, explicitly out
-- of scope for the build). Nothing in the codebase writes to this table —
-- auto-populating it from AI output would defeat the entire point of it. One
-- clearly-marked EXAMPLE row is inserted at the bottom with
-- status = 'draft' (i.e. NOT treated as verified, NOT rendered to any customer)
-- purely so the rendering path has something real to be exercised against; it
-- is safe to delete at any time.

-- ── 1. The knowledge base table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "remediation_knowledge_base" (
  "id"                 serial PRIMARY KEY,
  -- One row per check. RESTRICT (not CASCADE) matches monitoring_package_checks'
  -- existing FK to this same column, and is doubly right here: hand-verified
  -- content must never vanish silently because a check row was deleted.
  "check_key"          text NOT NULL UNIQUE
                         REFERENCES "monitor_checks"("key") ON DELETE RESTRICT,
  -- NULL = the renderer falls back to monitor_checks.label for the heading.
  "title"              text,
  -- Plain-English "what this means and why it matters". Verified counterpart of
  -- the AI shape's `detail` field.
  "summary"            text NOT NULL,
  -- string[] — roles, licences, PowerShell modules that must already be in place.
  "prerequisites"      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Admin Center UI navigation path, e.g.
  -- 'Microsoft 365 admin center -> Settings -> Org settings -> Security & privacy'.
  "admin_center_path"  text,
  "admin_center_url"   text,
  -- [{ text, code?, codeLanguage? }] — shape-identical to the AI generator's own
  -- validated output (RemediationResultSchema.steps), so ONE renderer serves both
  -- the verified and the fallback branch and they cannot drift on layout. That
  -- matters: the whole credibility argument rests on the two branches being
  -- visually comparable and differing ONLY in their provenance banner.
  "remediation_steps"  jsonb NOT NULL DEFAULT '[]'::jsonb,
  "expected_outcome"   text NOT NULL,
  "validation_step"    text NOT NULL,
  "validation_command" text,
  -- string[] of Microsoft documentation URLs. These are what make "verified" a
  -- checkable claim rather than an assertion.
  "source_urls"        jsonb NOT NULL DEFAULT '[]'::jsonb,
  "verified_against"   text,
  "last_verified_at"   timestamptz NOT NULL,
  "verified_by"        text NOT NULL,
  -- Only 'published' rows count as verified. A half-written 'draft' row falls
  -- through to the AI fallback (and is labelled as AI-generated) rather than
  -- being rendered under a green banner it has not earned.
  "status"             text NOT NULL DEFAULT 'draft'
                         CHECK ("status" IN ('draft', 'published')),
  -- Internal only — never rendered into a customer document.
  "notes"              text,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now()
);

-- The lookup the document path actually issues is
-- `WHERE check_key = ANY(...) AND status = 'published'`; check_key is already
-- covered by its UNIQUE constraint, so only status needs its own index.
CREATE INDEX IF NOT EXISTS "remediation_knowledge_base_status_idx"
  ON "remediation_knowledge_base" ("status");

-- ── 2. document_types gate ────────────────────────────────────────────────────
-- Which document types get the per-finding Remediation Detail appendix. A
-- column rather than a hardcoded `docTypeKey === 'remediation_plan'` literal in
-- document-engine.ts, because everything else that engine branches on (sections,
-- prompt, finding scoping, pipeline category) already comes from this registry —
-- and because enabling the appendix for security_hardening_plan later should be
-- a row edit, not a deploy.

ALTER TABLE "document_types"
  ADD COLUMN IF NOT EXISTS "remediation_detail_appendix" boolean NOT NULL DEFAULT false;

UPDATE "document_types"
   SET "remediation_detail_appendix" = true,
       "updated_at" = now()
 WHERE "key" = 'remediation_plan'
   AND "remediation_detail_appendix" = false;

-- ── 3. One EXAMPLE row (status = 'draft' — deliberately NOT verified) ─────────
--
-- Present so the rendering path can be exercised against a real row shape, and
-- so the intended content depth for a Phase 1 entry is legible to whoever writes
-- the real 25. It is 'draft', which means the document path IGNORES it and falls
-- through to the AI fallback — it will never reach a customer as verified
-- content. Delete it whenever you like.
--
-- The insert is guarded on the check actually existing, so this migration does
-- not fail on an environment whose monitor_checks catalogue differs.

INSERT INTO "remediation_knowledge_base" (
  "check_key", "title", "summary", "prerequisites",
  "admin_center_path", "admin_center_url",
  "remediation_steps", "expected_outcome", "validation_step", "validation_command",
  "source_urls", "verified_against", "last_verified_at", "verified_by", "status", "notes"
)
SELECT
  'identity:global-admin-count',
  'Reduce standing Global Administrator assignments',
  $s$Microsoft recommends fewer than five permanent Global Administrators. Every standing Global Administrator is a full-tenant compromise if that one account is phished, so the count is a direct measure of blast radius. The fix is not simply deleting accounts: it is moving day-to-day work onto least-privileged roles and making the remaining Global Administrator access eligible (activated on demand) rather than permanent.$s$,
  $p$["Global Administrator (or Privileged Role Administrator) to change role assignments", "Microsoft Graph PowerShell SDK installed: Install-Module Microsoft.Graph -Scope CurrentUser", "At least two cloud-only break-glass accounts already in place before removing any admin"]$p$::jsonb,
  'Microsoft Entra admin center -> Identity -> Roles & admins -> Global Administrator',
  'https://entra.microsoft.com/#view/Microsoft_AAD_IAM/RolesManagementMenuBlade',
  $st$[
    {
      "text": "List the current Global Administrator assignments before changing anything, so you have a record of what was in place.",
      "code": "Connect-MgGraph -Scopes 'RoleManagement.Read.Directory','Directory.Read.All'\n$role = Get-MgDirectoryRole -Filter \"displayName eq 'Global Administrator'\"\nGet-MgDirectoryRoleMember -DirectoryRoleId $role.Id | ForEach-Object { Get-MgDirectoryObject -DirectoryObjectId $_.Id }",
      "codeLanguage": "powershell"
    },
    {
      "text": "For each holder that does not genuinely need tenant-wide control, identify the least-privileged built-in role that covers their actual work (for example Exchange Administrator, User Administrator, Security Reader) and assign that instead."
    },
    {
      "text": "Remove the Global Administrator assignment only once the replacement role is assigned and confirmed working. Never remove your own last working admin path.",
      "code": "Remove-MgDirectoryRoleMemberByRef -DirectoryRoleId $role.Id -DirectoryObjectId '<UserObjectId>'",
      "codeLanguage": "powershell"
    },
    {
      "text": "Leave two cloud-only break-glass accounts excluded from Conditional Access, and make every remaining human Global Administrator eligible rather than permanent via Privileged Identity Management (requires Microsoft Entra ID P2)."
    }
  ]$st$::jsonb,
  'Fewer than five accounts hold Global Administrator, two of which are documented cloud-only break-glass accounts; every other administrator holds a scoped, least-privileged role, and any remaining human Global Administrator access is PIM-eligible rather than permanent.',
  'Re-run the Global Administrator member list and confirm the count, then confirm each remaining holder is expected and documented.',
  $vc$(Get-MgDirectoryRoleMember -DirectoryRoleId (Get-MgDirectoryRole -Filter "displayName eq 'Global Administrator'").Id).Count$vc$,
  $u$["https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/best-practices", "https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access"]$u$::jsonb,
  'EXAMPLE ROW — not verified against anything. Written to demonstrate the shape only.',
  now(),
  'EXAMPLE ROW — replace with a real reviewer name',
  'draft',
  'Git #493 example/shape row. status = draft, so the document path ignores it and falls through to the AI fallback. Safe to delete. Phase 1''s 25 real entries are separate content work.'
WHERE EXISTS (SELECT 1 FROM "monitor_checks" WHERE "key" = 'identity:global-admin-count')
ON CONFLICT ("check_key") DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-06-remediation-knowledge-base-493.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
