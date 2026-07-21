-- Real customer-facing content for the 21 assessment products (services.id 13-33).
-- Every row currently has deliverables=NULL, inclusions=NULL, and a thin,
-- internal-sounding description ("what we get" instead of "what you get").
-- This backfills description + deliverables (3-4 items each) for all 21 rows,
-- in the voice already approved for Copilot Readiness Snapshot / Security
-- Posture Assessment / Compliance Framework Mapping Audit — SOC 2: lead with
-- what the customer gets and why it matters, not what the assessment
-- technically does.
--
-- id 13-15 are free (honest limited/"snapshot" depth). id 16-33 are paid
-- (full architect-reviewed depth). id 25 (paid Copilot Readiness Assessment)
-- is deliberately NOT a rephrase of id 14 (free Copilot Readiness Snapshot),
-- and is distinct from id 26 (Copilot Data Exposure Assessment — oversharing/
-- permissions exposure, not licensing/adoption readiness). id 27 (paid
-- License & Cost Optimization Assessment) is deliberately written as a real
-- upgrade in depth over id 15 (free License Waste Audit), not a rephrase.
--
-- No FedRAMP/GCC/government-contractor language. No unverifiable compliance
-- claims (an assessment maps gaps against a framework, it does not certify).
--
-- inclusions intentionally left untouched (out of scope for this pass) —
-- AssessmentDetail.tsx only reads inclusions as a fallback when deliverables
-- is empty, and every row below gets real deliverables.
--
-- Idempotent: safe to run more than once, always sets to the same content.

BEGIN;

-- ============================================================
-- FREE (13-15) — honest limited/summary depth, "before you commit" hook
-- ============================================================

-- id 13 — Tenant Governance Snapshot (free)
UPDATE services SET
  description = $$A free, live look at how well-governed your Microsoft 365 tenant actually is — before ungoverned sprawl turns into a security incident or a failed audit.$$,
  deliverables = jsonb_build_array(
    $$Your real governance score, scanned live from your tenant$$,
    $$Where policy, permissions, and sprawl are drifting out of control$$,
    $$The top 3 governance gaps to fix first$$
  )
WHERE id = 13;

-- id 14 — Copilot Readiness Snapshot (free) — approved copy, verbatim
UPDATE services SET
  description = $$Find out if your tenant is actually ready for Copilot — before you pay for licenses that sit unused.$$,
  deliverables = jsonb_build_array(
    $$Your real Copilot Readiness score, scanned live$$,
    $$Licensing eligibility across your current plans$$,
    $$The top 3 blockers standing between you and rollout$$
  )
WHERE id = 14;

-- id 15 — License Waste Audit (free)
UPDATE services SET
  description = $$A free scan of what you're actually paying for versus what's actually being used — before you renew another year of licenses nobody touches.$$,
  deliverables = jsonb_build_array(
    $$Your real license utilization, scanned live across every SKU$$,
    $$Unused and underused licenses, named and counted$$,
    $$A quick-look estimate of what you could be saving$$
  )
WHERE id = 15;

-- ============================================================
-- PAID (16-33) — full architect-reviewed depth
-- ============================================================

-- id 16 — M365 Tenant Health Audit
UPDATE services SET
  description = $$A complete, architect-reviewed health check of your entire Microsoft 365 environment — the ground-truth picture most tenants never get until something breaks.$$,
  deliverables = jsonb_build_array(
    $$A full cross-domain review: identity, security, governance, and licensing in one picture$$,
    $$Every finding ranked by real risk, not generic severity labels$$,
    $$A prioritized roadmap covering the whole tenant, not just one workload$$,
    $$Direct review by a NASA-credentialed architect, not an automated report alone$$
  )
WHERE id = 16;

-- id 17 — Security Posture Assessment — approved copy, verbatim
UPDATE services SET
  description = $$A full security audit of your tenant — not a checklist, a real architect-reviewed picture of where you're actually exposed.$$,
  deliverables = jsonb_build_array(
    $$Complete identity, endpoint, and data security review$$,
    $$Every finding ranked by real risk, not generic severity labels$$,
    $$A remediation roadmap you can actually execute$$,
    $$Direct review by a NASA-credentialed architect, not an automated report alone$$
  )
WHERE id = 17;

-- id 18 — Compliance Framework Mapping Audit — SOC 2 — approved copy, verbatim
UPDATE services SET
  description = $$Know exactly where your tenant stands against SOC 2 — before your auditor tells you, not after.$$,
  deliverables = jsonb_build_array(
    $$Full config mapped against every relevant SOC 2 control$$,
    $$Control-by-control gap report$$,
    $$Remediation guidance scoped to close each gap$$,
    $$A document you can hand straight to your compliance team or auditor$$
  )
WHERE id = 18;

-- id 19 — Compliance Framework Mapping Audit — NIST CSF
UPDATE services SET
  description = $$Know exactly where your tenant stands against the NIST Cybersecurity Framework — before a regulator, insurer, or customer questionnaire asks and you don't have an answer.$$,
  deliverables = jsonb_build_array(
    $$Full config mapped against NIST CSF's five core functions$$,
    $$Control-by-control gap report, function by function$$,
    $$Remediation guidance scoped to close each gap$$,
    $$A document you can hand straight to your compliance team or auditor$$
  )
WHERE id = 19;

-- id 20 — Compliance Framework Mapping Audit — ISO 27001
UPDATE services SET
  description = $$Know exactly where your tenant stands against ISO 27001 — before a certification body tells you.$$,
  deliverables = jsonb_build_array(
    $$Full config mapped against ISO 27001 Annex A controls$$,
    $$Control-by-control gap report$$,
    $$Remediation guidance scoped to close each gap$$,
    $$A document you can hand straight to your compliance team or certification auditor$$
  )
WHERE id = 20;

-- id 21 — Compliance Framework Mapping Audit — CMMC Level 1-2
UPDATE services SET
  description = $$Know exactly where your tenant stands against CMMC Level 1-2 practices — before a formal assessment does.$$,
  deliverables = jsonb_build_array(
    $$Full config mapped against CMMC Level 1-2 practices$$,
    $$Control-by-control gap report$$,
    $$Remediation guidance scoped to close each gap$$,
    $$A document you can hand straight to your compliance team or assessor$$
  )
WHERE id = 21;

-- id 22 — Data Governance Assessment
UPDATE services SET
  description = $$A real picture of where your sensitive data actually lives, who can reach it, and where retention and labeling policies are silently failing.$$,
  deliverables = jsonb_build_array(
    $$Full review of sensitivity labels, DLP policies, and retention rules as actually configured$$,
    $$Where sensitive data is overexposed or unlabeled, mapped by location$$,
    $$A remediation roadmap ranked by real risk$$,
    $$Direct review by a NASA-credentialed architect, not an automated report alone$$
  )
WHERE id = 22;

-- id 23 — Conditional Access Assessment
UPDATE services SET
  description = $$A real audit of your Conditional Access policies — the difference between what you think is enforced and what's actually protecting your sign-ins.$$,
  deliverables = jsonb_build_array(
    $$Full review of every Conditional Access policy as actually enforced$$,
    $$Coverage gaps: users, apps, and sign-in scenarios with no policy protection$$,
    $$Conflicting or redundant policies flagged and explained$$,
    $$A remediation roadmap ranked by real risk$$
  )
WHERE id = 23;

-- id 24 — Migration Readiness Assessment
UPDATE services SET
  description = $$Know what will actually break before you migrate — not after you've committed to a cutover date.$$,
  deliverables = jsonb_build_array(
    $$Full inventory of what's moving: mailboxes, sites, files, and dependencies$$,
    $$Legacy configurations and blockers that would derail a migration$$,
    $$A realistic sequencing and risk plan for the cutover$$,
    $$A remediation roadmap you can execute before migration day$$
  )
WHERE id = 24;

-- id 25 — Copilot Readiness Assessment (paid — full depth, distinct from the
-- free Snapshot at id 14: this goes past a top-line score into every
-- blocker and a phased rollout plan, not just the top 3)
UPDATE services SET
  description = $$The full architect-reviewed version of Copilot readiness — going past the snapshot's top-line score into exactly what's blocking a safe rollout and what it will take to fix it, licensing to adoption.$$,
  deliverables = jsonb_build_array(
    $$A complete Copilot Readiness review across licensing, data, and governance — not just a top-line score$$,
    $$Every blocker identified and ranked, not just the top 3$$,
    $$A phased rollout plan scoped to your tenant$$,
    $$Direct review by a NASA-credentialed architect, not an automated report alone$$
  )
WHERE id = 25;

-- id 26 — Copilot Data Exposure Assessment (distinct from id 25: this is
-- about what Copilot would surface from existing SharePoint/Teams/OneDrive
-- permissions and oversharing, not licensing/adoption readiness)
UPDATE services SET
  description = $$Before you turn Copilot on, find out exactly what it would surface — the oversharing and permissions risk already hiding in SharePoint, Teams, and OneDrive that Copilot will happily summarize for anyone who asks.$$,
  deliverables = jsonb_build_array(
    $$Full scan of SharePoint, Teams, and OneDrive sharing and permissions as actually configured$$,
    $$Sensitive content Copilot could surface today, mapped by location and exposure type$$,
    $$Overshared sites, files, and broad-access links identified and ranked by risk$$,
    $$A remediation plan to close exposure before rollout, not after an incident$$
  )
WHERE id = 26;

-- id 27 — License & Cost Optimization Assessment (paid — explicitly a real
-- upgrade in depth over the free License Waste Audit at id 15, not a
-- rephrase: full utilization analysis, right-sizing, and renewal modeling)
UPDATE services SET
  description = $$The full cost-optimization pass the free snapshot only points at — real utilization data turned into a licensing plan that actually saves money, not just a list of what's unused.$$,
  deliverables = jsonb_build_array(
    $$Complete license utilization analysis across every SKU and user, not a quick-look estimate$$,
    $$A right-sized licensing plan mapped to actual usage patterns$$,
    $$Cost projections and savings modeled against your real renewal terms$$,
    $$A negotiation-ready summary you can take into your next renewal$$
  )
WHERE id = 27;

-- id 28 — Adoption & Change Management Maturity Assessment
UPDATE services SET
  description = $$A real read on whether your organization is actually using what you've already paid for — and what's standing in the way of adoption sticking.$$,
  deliverables = jsonb_build_array(
    $$Adoption maturity scored across usage data, training, and change readiness$$,
    $$Where rollout stalled and why, by team or workload$$,
    $$A practical adoption and enablement plan, not generic best practices$$,
    $$A remediation roadmap ranked by real impact$$
  )
WHERE id = 28;

-- id 29 — SharePoint Assessment
UPDATE services SET
  description = $$A real architect-level review of your SharePoint environment — permissions sprawl, information architecture, and the sharing risk most admins can't see from the admin center.$$,
  deliverables = jsonb_build_array(
    $$Full review of site permissions, sharing links, and external access as actually configured$$,
    $$Information architecture and sprawl issues mapped site by site$$,
    $$Every finding ranked by real risk, not generic severity labels$$,
    $$A remediation roadmap you can actually execute$$
  )
WHERE id = 29;

-- id 30 — Teams Assessment
UPDATE services SET
  description = $$A real audit of your Teams environment — sprawl, guest access, and governance gaps that pile up quietly until they're a security or compliance problem.$$,
  deliverables = jsonb_build_array(
    $$Full review of team and channel sprawl, ownership, and lifecycle policies$$,
    $$Guest access and external sharing risk mapped across your tenant$$,
    $$Every finding ranked by real risk, not generic severity labels$$,
    $$A remediation roadmap you can actually execute$$
  )
WHERE id = 30;

-- id 31 — Exchange Online Assessment
UPDATE services SET
  description = $$A real audit of your Exchange Online environment — mail flow, authentication, and the misconfigurations that let phishing and spoofing get through.$$,
  deliverables = jsonb_build_array(
    $$Full review of mail flow rules, connectors, and authentication (SPF/DKIM/DMARC) as actually configured$$,
    $$Anti-phishing and anti-malware policy gaps identified$$,
    $$Every finding ranked by real risk, not generic severity labels$$,
    $$A remediation roadmap you can actually execute$$
  )
WHERE id = 31;

-- id 32 — Entra ID / Identity Assessment
UPDATE services SET
  description = $$A real audit of your identity foundation — the layer everything else in Microsoft 365 depends on, and the one attackers target first.$$,
  deliverables = jsonb_build_array(
    $$Full review of identity configuration: MFA coverage, privileged roles, and authentication methods as actually enforced$$,
    $$Privileged access and stale or orphaned account risk mapped$$,
    $$Every finding ranked by real risk, not generic severity labels$$,
    $$A remediation roadmap you can actually execute$$
  )
WHERE id = 32;

-- id 33 — Intune / Device Management Assessment
UPDATE services SET
  description = $$A real audit of how your devices are actually managed — compliance policies, enrollment gaps, and the endpoints quietly falling outside your security baseline.$$,
  deliverables = jsonb_build_array(
    $$Full review of compliance policies, configuration profiles, and enrollment coverage as actually deployed$$,
    $$Unmanaged, non-compliant, and out-of-policy devices identified$$,
    $$Every finding ranked by real risk, not generic severity labels$$,
    $$A remediation roadmap you can actually execute$$
  )
WHERE id = 33;

COMMIT;

-- Verification: confirm all 21 rows now have a description and deliverables.
-- SELECT id, name, description, deliverables FROM services WHERE id BETWEEN 13 AND 33 ORDER BY id;
-- SELECT id, name FROM services WHERE id BETWEEN 13 AND 33 AND (description IS NULL OR deliverables IS NULL); -- expect 0 rows
