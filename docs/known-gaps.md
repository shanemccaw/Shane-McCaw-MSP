# Known Gaps & v1 Deferrals

This document records explicit deferrals from the v1 build. Each item is intentionally out of scope, not accidentally missed. Future engineers should treat this list as the starting point for v2 scoping, not a bug backlog.

---

## Explicit v1 Deferrals

### Multi-Currency Support

**Status:** USD-only for v1.

All Stripe charges, coupon discounts, SOW pricing lines, and invoice totals are denominated in USD. The data model does not include a `currency` column. Adding multi-currency would require schema migrations, Stripe multi-currency configuration, a display-layer currency formatter, and (potentially) exchange-rate handling.

**When to revisit:** When the first non-USD-billed client is onboarded.

---

### Public Developer API (Beyond Outbound Webhooks)

**Status:** Deferred.

The platform can deliver outbound webhooks to third-party systems via the workflow `send_webhook` node. There is no public, versioned, documented REST API for external developers to read or write platform data programmatically.

**When to revisit:** When a client or integration partner requests programmatic access to their data.

---

### Public Platform Status / Uptime Page

**Status:** Deferred.

There is no external status page (e.g., status.shanemccawconsulting.com) showing real-time system health to clients or MSPs. Internal health is observable via `GET /api/health` and the Admin Panel live monitor. The live monitor alert rules are the foundation for a future status page.

**When to revisit:** When MSP clients request a public SLA dashboard.

---

### Bulk-Import Path for MSP Onboarding

**Status:** Deferred.

MSP customers are onboarded one at a time via the MSP Portal or the Admin Panel. There is no CSV/JSON bulk import for onboarding dozens of customers at once, and no import wizard for migrating an MSP's existing customer list from another RMM or PSA tool.

**When to revisit:** When an MSP with a large existing customer base is onboarded.

---

### Guided "What To Do First" Checklist After New MSP Account Activation

**Status:** Deferred.

After an MSP account is activated, operators are dropped into the MSP Portal dashboard without guided onboarding steps. There is no interactive checklist ("Connect your Azure tenant → Add your first customer → Configure your SLA template → …") to reduce time-to-value for a new MSP.

**When to revisit:** When MSP self-serve onboarding becomes a priority (currently all MSP onboarding is assisted by Shane).

---

### Load / Chaos Testing

**Status:** Deferred. Flagged as a known gap, not invented.

No load tests, stress tests, or chaos engineering runs have been performed. The platform has not been tested under sustained high concurrency (e.g., many simultaneous Stripe webhooks, concurrent SOW generations, or large DLQ replay bursts). The Anthropic streaming approach for long-running AI generation mitigates some timeout risk, but no throughput baseline exists.

**When to revisit:** Before any marketing campaign expected to drive significant traffic spikes, or before signing MSP contracts with uptime SLAs.

---

### SOC 2 Audit / Certification

**Status:** Deferred. Out of scope entirely for v1.

The platform implements several SOC 2-relevant controls (audit logging, JWT auth, credential rotation procedures, RBAC), but no formal SOC 2 Type I or Type II audit has been conducted. A compliance program would require engaging a third-party auditor, implementing additional controls (e.g., formal access review, change management process, employee background checks), and maintaining evidence over time.

**When to revisit:** When enterprise clients or MSPs require SOC 2 attestation as a procurement condition.

---

### AI Differentiators — Phase 3

**Status:** Planned as a future task (not an oversight).

Phase 3 AI features — including advanced tenant benchmarking, predictive churn scoring, and AI-generated executive briefings — are explicitly queued as a downstream task ("AI Differentiators (Phase 3 — Deferred)"). They depend on the signal infrastructure and engine registry built in v1.

---

## Known Operational Gaps (Non-Deferral)

These are gaps the team is aware of and should address in near-term follow-up tasks, not formal v1 deferrals:

| Gap | Risk | Planned Fix |
|---|---|---|
| No automated tests for bot-protection on auth endpoints | A regression could expose brute-force surface | Planned follow-up task |
| Forgot-password endpoint not yet rate-limited | Abusable for email enumeration | Planned follow-up task |
| No automated test for react-markdown import path | Article pages may silently 404 on package changes | Planned follow-up task |
| Static calendar placeholder on `/book` when Graph not configured | Poor UX — shows empty slot list | Planned follow-up task |
| No OG images for Home, About, Pricing, Resources | Weak social sharing preview | Planned follow-up task |
| Sitemap not updated automatically on article publish | New articles invisible to search engines until redeploy | Planned follow-up task |
| Kanban cards not draggable between columns on Dashboard 2 | Admin workflow friction | Planned follow-up task |
| Calendar shows Oct 2023 placeholder instead of current month | Confusing for clients viewing the booking page | Planned follow-up task |
| New DDL migrations not applied to prod automatically | Risk of deploy without migration | Planned follow-up task |

---

## Accessibility

**Baseline target:** WCAG 2.1 AA.

v1 was built with WCAG 2.1 AA as the stated target. No formal accessibility audit has been performed. Manual spot-checks have been done on primary flows. A formal audit (axe-core, manual keyboard navigation, screen-reader testing) is recommended before the platform is used as a public-facing product for enterprise clients.
