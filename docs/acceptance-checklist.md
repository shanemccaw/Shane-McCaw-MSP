# Acceptance Checklist — Shane McCaw Consulting Platform v1

This checklist consolidates the "done looks like" criteria from every task in the initial build. Each item should be manually verified (or confirmed as a known v1 deferral) before going live.

**Accessibility target: WCAG 2.1 AA** — stated explicitly rather than left implicit. All interactive elements must meet this baseline.

---

## 1. Public Marketing Website (`/`)

- [ ] All 15 routes render without JS errors: `/`, `/about`, `/services`, `/services/microsoft-365`, `/services/copilot-ai`, `/services/sharepoint`, `/services/power-platform`, `/services/governance`, `/services/cloud-migration`, `/quick-wins`, `/pricing`, `/resources`, `/contact`, `/book`, `/admin`
- [ ] Header is transparent on `/` and solid Deep Navy on all other pages
- [ ] Contact form validates with Zod/react-hook-form and shows a success toast
- [ ] OG images are set for Home, About, Pricing, and Resources pages _(may be planned follow-up)_
- [ ] Article pages load without react-markdown errors _(may be planned follow-up)_
- [ ] Sitemap reflects all published articles _(may be planned follow-up)_
- [ ] Share buttons appear above article content _(may be planned follow-up)_

---

## 2. Lead Generation & Quiz

- [ ] Pain-point quiz completes end-to-end and submits a lead record
- [ ] Quiz results show a tailored service recommendation
- [ ] Lead record appears in Admin Panel → Leads
- [ ] Quiz PDF can be generated and downloaded

---

## 3. Booking Calendar (`/book`)

- [ ] If MS Graph credentials are absent, the page shows a clear placeholder (no crash)
- [ ] If Graph credentials are present: slots are fetched from Exchange Online, a slot can be selected, and a booking confirmation is sent
- [ ] `GRAPH_CLIENT_ID` service principal has `Calendars.Read` and `Calendars.ReadWrite` Application permissions admin-consented in Azure AD _(operator setup required)_

---

## 4. Stripe Checkout & Payments

- [ ] Clients can purchase a micro-offer / quick-win package via Stripe Checkout
- [ ] `stripe.payment_intent.succeeded` webhook fires and updates `client_services` status
- [ ] SMS alert sent to Shane's phone on payment completion (if Twilio secrets present)
- [ ] Stripe webhook endpoint is registered for both dev (`*.replit.dev`) and prod domains
- [ ] `STRIPE_SECRET_KEY_PROD` is a live key, not a test key, in the deployed environment
- [ ] PAY-TODAY discount offer appears with countdown timer on the payment step (if coupon configured)
- [ ] Discounted amount shown matches amount charged (no rounding discrepancy)

---

## 5. Client Portal / CRM (`/crm`)

- [ ] Clients can register and log in
- [ ] Forgot-password flow works (rate-limited)
- [ ] Client sees their active services, SOW, contract, and activity feed
- [ ] Agreement step is locked until payment is confirmed (status `paid` or `signed`)
- [ ] SSE live updates work during SOW generation (progress bar visible)
- [ ] Client can download SOW as PDF
- [ ] Welcome email sent on new client account creation _(may be planned follow-up)_
- [ ] Guest onboarding: guest provides name+email before contract signing
- [ ] Client can view their project Kanban stage (read-only)

---

## 6. Admin Panel (`/admin-panel`)

- [ ] Password-protected; sessions are sessionStorage-scoped (no persistent cookie)
- [ ] Admin can create, edit, and delete articles (Markdown) — changes visible immediately in dev; after redeploy in production
- [ ] Admin can manage leads, clients, services, fulfillment types, and coupons
- [ ] Admin can view all workflow runs and their step results
- [ ] Admin can view and replay DLQ items
- [ ] Admin can view Kanban board and manually advance/force-complete cards
- [ ] Admin can create and publish workflow definitions
- [ ] Admin can edit AI prompts via the Prompts panel
- [ ] Admin can view and trigger intelligence engine analyses (7 engines visible in Engine Registry)
- [ ] Admin can view audit logs
- [ ] SEO Rankings panel: manual keyword entry works; "Sync Search Console" shows a clear error if secrets are absent
- [ ] Social post workflow nodes (`post_linkedin`, `post_twitter`, `post_facebook`) are configured or gracefully disabled when secrets are absent
- [ ] Browser push notifications: bell works normally even without VAPID secrets; OS-level pushes work when VAPID secrets are present

---

## 7. MSP Portal (`/portal`)

- [ ] MSP operators can log in (15-min JWT + 7-day refresh token)
- [ ] MSP role-based access control (RBAC) enforced: `ROLE_ORDER` hierarchy respected
- [ ] MSP can view their customers and customer detail pages
- [ ] MSP can view customer SOW, documents, diagnostics, SLA, and scope
- [ ] MSP can view and trigger workflow runs for their customers
- [ ] MSP can view operator tasks and their statuses
- [ ] MSP can view DLQ items scoped to their tenant
- [ ] MSP can view reports and events
- [ ] MSP can configure sales bundles and offers
- [ ] Custom domain routing works for MSP tenants (`msp-custom-domain.ts`)
- [ ] MSP onboarding flow completes end-to-end
- [ ] MSP plan management: feature gating enforced (`requirePlanFeature`)

---

## 8. AI / Intelligence Engines

- [ ] SOW generation produces a complete, well-structured HTML document for a test client
- [ ] SOW pricing adjustments reflect fired tenant signals (e.g., `hasSecurityGaps`)
- [ ] Disabled signals are skipped in all compute paths (admin evaluate, SOW generation, dry-run)
- [ ] AI document generation handles Anthropic streaming for long outputs (no 10-min timeout crash)
- [ ] All 11 engines return results without errors: `priority`, `pricing`, `health`, `drift`, `forecasting`, `crm`, `msp`, `sla`, `scope_creep`, `monitoring`, `sales_offer`
- [ ] Each engine's `runForPayload` (test mode) returns a result without touching live customer data
- [ ] AI prompt edits in the Admin Panel take effect on next generation (no code deploy required)
- [ ] The MSP Portfolio Engine (`msp`) aggregates health + drift + priority scores across all customers into a portfolio-level risk roll-up
- [ ] The SLA Engine detects SLA timer warnings and breaches and surfaces them in the MSP portal customer detail view
- [ ] The Scope Creep Engine raises violations when deliverable / timeline drift is detected; escalation recommendations appear in the Admin Panel
- [ ] The Monitoring Engine runs platform-authored monitor checks against a test customer tenant via Graph API and writes `tenant_monitor_profile` rows
- [ ] The Sales Offer Engine returns ranked offer candidates for a customer with a populated profile; disabled signals are excluded from offer scoring

---

## 9. Azure / M365 Integration

- [ ] Script Runner executes a PowerShell runbook against a test client tenant
- [ ] Key Vault credential reads succeed (connectivity check passes in Admin Panel → Diagnostics)
- [ ] SharePoint site is provisioned for a new client service (if `SHAREPOINT_OWNER_UPN` is set, Shane is added as owner)
- [ ] MS Graph email sending works (at least one template email sent successfully)
- [ ] `GRAPH_CLIENT_ID` service principal has required permissions in Azure AD _(operator setup required)_

---

## 10. Notifications & Communications

- [ ] Email templates are seeded in the DB on server startup (`seed-email-templates.ts` called from `index.ts`)
- [ ] Welcome email template renders correctly
- [ ] Order alert SMS delivered to Shane's phone on test purchase
- [ ] Browser push notification appears as OS notification when VAPID keys are present
- [ ] All notification paths fail gracefully (log warning, no crash) when secrets are absent

---

## 11. Observability & Operations

- [ ] `/api/health` returns `200` when the server is healthy
- [ ] `/api/admin/db-status` confirms DB connectivity and migration state
- [ ] Live monitor checks are seeded and running
- [ ] DLQ is visible and replayable in the Admin Panel
- [ ] Audit log captures credential rotations, signal toggles, and admin actions
- [ ] Kanban stuck-queue reconciler corrects false failures within 15 minutes

---

## 12. Tenant Signals

- [ ] Admin can toggle any signal on/off in Admin Panel → Tenant Signals
- [ ] Disabled badge appears next to disabled signals
- [ ] Disabled signals are not evaluated in any compute path
- [ ] Toggling a signal does not retroactively affect already-generated SOW documents
- [ ] `signal_enabled_state` table exists in the DB (migration applied)

---

## 13. Deployment & CI

- [ ] `pnpm run typecheck` passes across all packages with zero errors
- [ ] `pnpm --filter @workspace/api-server run test` passes
- [ ] `pnpm --filter @workspace/scripts run migrate-prod` runs without error on the production DB
- [ ] `pnpm --filter @workspace/scripts run sync-webhooks` reports correct webhook endpoints
- [ ] `pnpm --filter @workspace/scripts run check-migration-drift` reports no drift

---

## 14. Security Baseline

- [ ] Admin endpoints require `Authorization: Bearer <ADMIN_PASSWORD>`
- [ ] MSP endpoints require valid JWT (`15-min access + 7-day refresh`)
- [ ] Client portal endpoints enforce ownership checks (client can only see their own data)
- [ ] Forgot-password endpoint is rate-limited _(may be planned follow-up)_
- [ ] Bot-protection on auth endpoints covered by automated tests _(may be planned follow-up)_
- [ ] No secrets committed to the codebase (all in Replit Secrets)
- [ ] WCAG 2.1 AA accessibility baseline met on all primary user-facing flows

---

## v1 Deferrals (Explicitly Out of Scope)

See `docs/known-gaps.md` for the full list. Summary:

- Multi-currency support (USD-only for v1)
- Public developer API beyond outbound webhooks
- Public platform status / uptime page
- Bulk-import path for MSP onboarding
- Guided "what to do first" checklist after new MSP account activation
- Load / chaos testing
- SOC 2 audit / certification
- AI Differentiators (Phase 3 — planned future task)
