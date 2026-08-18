## Live audit complete — full field list + per-field recommendation

Queried the live monitor_checks catalog directly for all 7 governance.* sourceKeys used on governance.tsx. Also swept for near-miss/semantic matches (access-package, entitlement, access-review, governance, lifecycle, drift) to check for a real check that should back each phantom key, same method #1103 used.

Key finding: zero checks anywhere in the catalog contain "drift" in their key. "Drift" isn't a computed concept in the monitoring engine at all yet — every *DriftCount field on this page is a phantom by construction, not just these three.

| Field (governance.tsx) | sourceKey | Catalog match? | Recommendation |
|---|---|---|---|
| overdueAccessReviewCount ("Overdue Access Reviews") | governance:overdue-access-reviews | YES — exact match, real check (/identityGovernance/accessReviews/definitions) | Keep — already correctly wired. Not part of the "Not wired" bug. |
| accessReviewDriftCount ("Access Review Drift") | governance:access-review-drift | No exact match. Nearest: governance:access-review-completion (a % completion-rate check, not a drift/count concept) — semantically different valueType and shape. No real "drift" check exists anywhere in the catalog. | Remove. No plausible real check to point at. |
| orphanedAccessPackageCount ("Orphaned Access Packages") | governance:orphaned-access-packages | None. No access-package check of any kind exists in the catalog — Entitlement Management (access packages) isn't monitored at all. | Remove. No established real source. |
| activeEntitlementAssignmentCount ("Entitlement Assignments") | governance:active-entitlement-assignments | None. Same as above — zero entitlement-related checks exist anywhere. | Remove. No established real source. |
| entitlementPolicyDriftCount (tag: ENTITLE) | governance:entitlement-policy-drift | None (entitlement + drift, doubly absent). | Remove. No established real source. |
| workflowDriftCount ("Lifecycle Workflow Drift", tag: LIFECYCLE) | governance:lifecycle-workflow-drift | None — pre-answered by Shane (see comment above): no monitor check, no PowerShell script, no Graph API call anywhere in the codebase. | Remove — already decided. |
| workflowFailureCount ("Lifecycle Failures") | governance:lifecycle-workflow-failures | None — pre-answered by Shane, same as above. | Remove — already decided. |

### Summary
- 1 of 7 fields is fine as-is (overdueAccessReviewCount — real check, keep).
- 6 of 7 are phantom sourceKeys with no matching monitor_checks entry, and none of the 6 has a plausible real check to redirect to (unlike #1103's 6, none of which had a genuine "close but not quite" candidate either — this page's phantoms cluster around two whole unimplemented feature areas: Entitlement Management / access packages, and Identity Governance Lifecycle Workflows, plus the not-yet-computed "drift" concept generally).

All 6 are removal candidates, per Shane's stated preference (no clear path to real data → remove rather than leave an honest-but-confusing "Not wired" state). Proceeding to remove accessReviewDriftCount, orphanedAccessPackageCount, activeEntitlementAssignmentCount, entitlementPolicyDriftCount, workflowDriftCount, and workflowFailureCount from governance.tsx and the registry, keeping overdueAccessReviewCount in place.
