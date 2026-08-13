---
slug: m365-migration-checklist
category: Digital Transformation
title: "Microsoft 365 Migration Checklist: 30 Things to Do Before You Move"
summary: "M365 migrations fail when teams skip the discovery and planning phase. This checklist covers every critical item — from license mapping to identity readiness — that you should verify before migrating a single mailbox."
date: March 27, 2025
---

In my experience overseeing M365 migrations for large organizations, the failures almost always trace back to one cause: insufficient discovery and planning. Teams move too fast to get to the 'exciting' parts — the cutover, the new features, the clean new environment — and skip the hard, unglamorous work of understanding the current state.

This checklist covers the 30 critical items I verify before any M365 migration begins. Use it as a pre-migration gate — don't proceed until every item is addressed.

## Identity Readiness (Items 1–7)

- 1. Directory is clean: no stale accounts, service accounts documented, guest accounts reviewed
- 2. UPN suffix matches the primary SMTP domain users will use in M365
- 3. Azure AD Connect (or Entra Connect) is scoped, tested, and validated in staging
- 4. MFA rollout plan is complete before first user migrations begin
- 5. Conditional Access baseline policies are configured in the target tenant
- 6. Privileged Identity Management is configured for admin roles
- 7. Break-glass emergency access accounts are created and documented

## Licensing (Items 8–12)

- 8. License requirements are mapped by user role, not assumed to be one-size-fits-all
- 9. License count includes a buffer for the overlap period during migration
- 10. Licensing for hybrid coexistence features (Exchange hybrid, Teams interop) is confirmed
- 11. Any third-party tools with M365 dependencies have compatible licensing
- 12. License assignment strategy is defined — direct assignment, group-based, or via automation

## Exchange Online Readiness (Items 13–17)

> Email is the migration item users feel most immediately. Problems here generate the most support tickets and erode confidence in the entire project. Get it right.

- 13. DNS records (MX, SPF, DKIM, DMARC) are planned, tested, and staged for cutover
- 14. Mailbox size distribution is understood — large mailboxes need migration priority planning
- 15. Shared mailboxes, room mailboxes, and equipment mailboxes are inventoried
- 16. Shared calendar and resource booking workflows are documented
- 17. Mail flow rules and connectors in the source environment are inventoried for re-creation

## SharePoint and OneDrive (Items 18–22)

- 18. Content inventory is complete: sites, document libraries, list items, and estimated data volume
- 19. Customizations (classic web parts, InfoPath forms, custom workflows) are documented and have a modernization plan
- 20. External sharing and permissions are audited before migration (don't migrate broken permissions)
- 21. OneDrive sync client version is confirmed compatible with the target tenant
- 22. Large file exclusions are configured in the migration tool — files over the M365 size limit will fail

## Teams and Collaboration (Items 23–26)

- 23. Teams creation policy is defined before users get access — governance later is harder
- 24. Guest access policy is configured based on your security requirements
- 25. Phone System / Direct Routing dependencies are identified if voice is in scope
- 26. Third-party integrations (connectors, bots, apps) are inventoried and validated for M365 compatibility

## Governance and Compliance (Items 27–30)

- 27. Retention policies are designed for the target environment before any content moves
- 28. eDiscovery holds in the source environment are documented and preserved
- 29. Audit log settings are configured in the target tenant before migration begins
- 30. Data residency requirements are confirmed and the correct M365 geography is provisioned

Thirty items is a lot — but each one represents a category of migration failure I've seen happen. The organizations that move fast and skip this checklist often end up spending more time on remediation than they saved on planning.

If you're planning an M365 migration and want an experienced architect to validate your readiness before you move, a migration readiness assessment is the right first step. Get in touch to discuss your timeline and current state.
