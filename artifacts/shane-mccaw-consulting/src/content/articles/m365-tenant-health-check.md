---
slug: m365-tenant-health-check
category: M365 Best Practices
title: "The M365 Tenant Health Check: What We Look For at NASA Scale"
summary: "After years of managing Microsoft 365 for one of the world's most security-sensitive organizations, I've developed a systematic audit methodology. This is what we check — and why each item matters."
date: May 22, 2025
---

Managing Microsoft 365 at NASA means operating under constraints most organizations never encounter: strict federal compliance requirements, national security considerations, a user base of scientists and engineers with specialized workflows, and zero tolerance for data exposure. Over the years, I've developed a systematic health check methodology that I now apply to every M365 consulting engagement.

Here's what a thorough M365 tenant health check covers — and why each area matters.

## Identity and Access Management

Everything starts with identity. A compromised account in a poorly-governed tenant can cascade into a catastrophic breach. We look at MFA enrollment rates (the target is 100% — no exceptions), Conditional Access policy coverage, privileged identity management for admin accounts, and sign-in risk policies.

- MFA enrollment: Is it enforced via Conditional Access (not just 'enabled' in legacy per-user settings)?
- Admin accounts: Do global admins have separate cloud-only admin accounts?
- Privileged Identity Management: Are admin roles just-in-time rather than permanently assigned?
- Guest accounts: Are there stale guests with broad access? When were they last reviewed?
- Break-glass accounts: Are emergency access accounts configured, monitored, and tested?

## Exchange Online and Email Security

Email remains the primary attack vector for most organizations. A healthy Exchange Online configuration has defense-in-depth: DMARC, DKIM, and SPF properly configured to prevent spoofing; Defender for Office 365 anti-phishing, anti-malware, and Safe Links policies active; and mailbox audit logging enabled.

> One finding I see in nearly every audit: organizations that have SPF and DKIM configured but no DMARC enforcement policy. DMARC without a 'reject' or 'quarantine' policy is not protecting you from spoofing.

## SharePoint and OneDrive Sharing Policies

SharePoint's default sharing settings are far too permissive for most organizations. We audit tenant-level and site-level sharing policies, check for anonymous sharing links (a significant risk that's often overlooked), review external sharing domains, and verify that site access request workflows route to the right owners.

## Teams Governance

Teams sprawl is real. In tenants that have been running Teams for several years without governance, we routinely find hundreds of Teams that have no owners, are completely inactive, and contain files that no one has looked at in years — but that are still accessible to members who left the organization.

- Active Teams with no owners: high risk, needs immediate remediation
- Teams not active in 90+ days: candidate for archival
- External users in Teams: are all of them still valid partners?
- Teams creation policy: who can create Teams and is there an approval workflow?
- Private channel governance: are private channels being used appropriately?

## Compliance and Data Governance

This is often where the most significant gaps appear. We check retention policy coverage (is every critical workload covered?), eDiscovery readiness, sensitivity labeling deployment and enforcement, DLP policy coverage, and audit log retention. Most organizations have some policies in place but have gaps in coverage they aren't aware of.

## Licensing and Cost Optimization

The final piece is license hygiene. In large tenants, license waste is significant. Unassigned licenses, users assigned to licenses above what their role requires, and redundant third-party tools that M365 already provides natively — these are all common findings. A thorough license audit typically identifies meaningful cost savings.

If you'd like a systematic health check of your M365 tenant, my M365 Tenant Audit is a fixed-price engagement that delivers a complete findings report with a prioritized remediation roadmap. Get in touch to discuss whether it's the right fit for your organization.
