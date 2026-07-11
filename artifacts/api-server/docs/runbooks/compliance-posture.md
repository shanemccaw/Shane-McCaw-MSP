# Compliance Posture Statement

**Last reviewed:** 2026-07-11
**Status:** v1 — production

---

## 1. Current State

Shane McCaw Consulting LLC operates the platform as a **self-attested, security-conscious SaaS product**. No third-party compliance certification is held at v1.

---

## 2. SOC 2 Roadmap

| Phase | Target | Timeframe |
|-------|--------|-----------|
| Phase 1 (current) | Internal controls documented; backup/DR runbooks in place; audit logging live; incident response process defined | v1 — complete |
| Phase 2 | SOC 2 Type I readiness assessment with a licensed auditor (e.g. Drata, Vanta, or direct CPA firm) | 12–18 months post-launch |
| Phase 3 | SOC 2 Type II certification (12-month observation period required) | 24–36 months post-launch |

> **Sales conversation note:** When a prospect's security questionnaire asks about SOC 2, the honest answer is: *"We are building toward SOC 2 Type I as a Phase 2 goal. Our controls are documented and available for review under NDA — backup policy, access controls, audit logging, and incident response are all in place. Type I certification is targeted within 12–18 months."*

---

## 3. Data Residency

- **Hosting region:** United States (Replit infrastructure, US data centers)
- **Database:** US-region PostgreSQL (Replit managed)
- **Object storage:** US-region (Replit managed)
- **Email delivery:** Resend (US-headquartered, data processed in US)
- **Payment processing:** Stripe (US-headquartered, PCI-DSS Level 1 certified)
- **Azure Key Vault:** Customer-configured; operators must use `eastus` or `westus2` to maintain US-only residency

No customer data is intentionally transferred to non-US infrastructure under the current architecture.

---

## 4. Security Controls in Place (v1)

| Control | Status |
|---------|--------|
| Authentication — password hashing (bcrypt, cost 12) | ✅ Live |
| Multi-factor authentication (TOTP, SMS, Passkey) | ✅ Live |
| JWT access tokens (15-min TTL) + 7-day refresh tokens | ✅ Live |
| RBAC (PlatformAdmin → MSPAdmin → MSPOperator → CustomerUser) | ✅ Live |
| Audit logging (all mutating actions) | ✅ Live |
| Secrets management (Replit Secrets; never in code) | ✅ Live |
| Customer App Registration secrets in Azure Key Vault | ✅ Live |
| TLS in transit (Replit proxy, mTLS to services) | ✅ Live |
| Database encryption at rest (AES-256, Replit managed) | ✅ Live |
| Stripe webhook signature verification | ✅ Live |
| Bot protection on public auth endpoints | ✅ Live |
| Backup / DR policy documented | ✅ Live (see backup-dr.md) |
| Data subject rights (export + deletion request) | ✅ Live (see data-subject-rights.md) |

---

## 5. Known v1 Gaps (Planned for Phase 2+)

| Gap | Rationale / Mitigation |
|-----|------------------------|
| SOC 2 Type I certification | Targeted Phase 2; controls exist but unaudited |
| Penetration test (annual) | Deferred; mitigated by SAST scan in CI |
| Dependency vulnerability SLA | `pnpm audit` run on demand; automated weekly scan deferred to Phase 2 |
| Load / chaos testing | Deferred; mitigated by Replit platform autoscaling |
| Public status page | Deferred; use Replit status for now |
| Multi-currency support | USD only in v1 |
| Bulk-import MSP onboarding | Manual onboarding in v1 |
| Public developer API (beyond outbound webhooks) | Deferred to Phase 3 |
| Automated instant self-service account deletion | Deletion requests processed within 30 days (see data-subject-rights.md) |

---

## 6. Accessibility Baseline

- **Target:** WCAG 2.1 AA
- **Current status:** Best-effort; not formally audited at v1
- **Phase 2 action:** Automated axe-core scan in CI + manual screen-reader review

---

## 7. Related Runbooks

- `backup-dr.md` — database backup policy, RTO/RPO, restore procedure
- `data-subject-rights.md` — customer data export and deletion request process
