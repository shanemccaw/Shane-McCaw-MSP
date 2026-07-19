# Platform Build Log

Append-only log of work sessions. Each session adds exactly one row, in two edits:

1. **At session start** (before any real work): append a row with status `⏳ IN FLIGHT — {step name}`, commit it immediately as its own standalone commit.
2. **At session end** (after the real work is done, tested, and typechecked): update that same row to `✅ DONE — {step name}`, filling in the real commit hash of the work, then commit the update (either folded into the final commit or immediately after it).

If a session dies, crashes, or is abandoned mid-way, its row stays `⏳ IN FLIGHT`, which is itself the record that an attempt was made and didn't finish.

See [CLAUDE.md](CLAUDE.md) for the exact instructions.

| Date | Status | Step | Commit |
|------|--------|------|--------|
| 2026-07-19 | ⏳ IN FLIGHT | Assessment Flow as Visible Workflows — First Login + Document Generation | |
| 2026-07-19 | ✅ DONE | Extend Document Sharing + View Tracking Beyond SOWs | 208af156 |
| 2026-07-19 | ✅ DONE | Interactive SOW Scope Selector | e825be49 |
| 2026-07-19 | ✅ DONE | TEMP DEBUG — Testbed-Only Assessment Scan Trigger Button (temporary debug code, not a permanent feature — awaiting a backlog removal ticket) | 967551d2 |
| 2026-07-19 | ✅ DONE | Assessment Document Generation Trigger — Telemetry + First Login | 639e6ba4 |
| 2026-07-18 | ✅ DONE | policy-engine escalation lifecycle | 0a6c5c38 |
| 2026-07-18 | ✅ DONE | Admin Dashboard Designer (Step 4b) | dfcb9f47 |
| 2026-07-18 | ✅ DONE | #1 Engine Development - policy-rule-suppressions | ab10e2bc |
| 2026-07-18 | ✅ DONE | #1 Engine Development: policy-engine suppression gate | 9c941ef0 |
| 2026-07-18 | ✅ DONE | Customer/MSP Dashboard Editor | 56ec3a77 |
| 2026-07-18 | ✅ DONE | Events tree node | 9d77b61d |
| 2026-07-18 | ✅ DONE | Engines tree node | 9d65f853 |
| 2026-07-18 | ✅ DONE | policy-engine category tagging | aa493fd0 |
| 2026-07-18 | ✅ DONE | #2 Smart Widget State Logic | a1089508 |
| 2026-07-18 | ✅ DONE | Signal Rules UI v1 | eefafc6e |
| 2026-07-18 | ✅ DONE | #4 customer-connect-dropdown-action | dbe72b1b |
| 2026-07-18 | ✅ DONE | #6 Audit Log Metadata Display Formatting | 4b090d38 |
| 2026-07-18 | ✅ DONE | #8 DLQ Help Text and Action Labels | 813a96f1 |
| 2026-07-18 | ✅ DONE | Dashboard Designer Access + Create Button | 2cbce684 |
| 2026-07-18 | ✅ DONE | #6 Portal 404 Redesign + Audit Logging | ffe0f36d |
| 2026-07-18 | ✅ DONE | #B Portal Favicon Fix | fbc3a616 |
| 2026-07-18 | ✅ DONE | Portal Dashboard Designer | 7c5215ba |
| 2026-07-19 | ✅ DONE | Trim Dashboard Extras — Remove Quick Actions/Projects/Services, Move Help Card to Bottom | f20672ee |
| 2026-07-18 | ✅ DONE | Guard Portfolio Risk Route Against resolveMspId Swap | 06dee9bd |
| 2026-07-18 | ✅ DONE | Factory Floor Data Audit | a4841a53 |
| 2026-07-18 | ✅ DONE | sales-offers list + fulfillment-queue mspId path migration | 47679db4 | |
| 2026-07-18 | ✅ DONE | resolve-slug tenant restriction + settings ownership checks + sales-offers dead-route cleanup | ec4d68a3 |
| 2026-07-18 | ✅ DONE | Wire Remediation Offers dashboard metric to sales_offers | 65ab285b |
| 2026-07-18 | ✅ DONE | Portal Foundation Redesign | 5f555414 |
| 2026-07-18 | ✅ DONE | engine-snapshot-customer-resolution-fix | a8cb2558 |
| 2026-07-18 | ✅ DONE | Engine Score Explain Dialog | 60b9f673 |
| 2026-07-18 | ✅ DONE | signal-decay-rate-fractional-migration | 6208028f |
| 2026-07-19 | ✅ DONE | Fix Mission Control Layout Proportions | 7c7a9643 |
| 2026-07-18 | ✅ DONE | Portal Shell Rebuild — CustomerUser | ab0e1f5f |
| 2026-07-18 | ✅ DONE | msp-users-user-id-fk-constraint | 8f24e76d |
| 2026-07-18 | ✅ DONE | stripe-metadata-service-id-casing-fix | 4fcbc9da |
| 2026-07-18 | ✅ DONE | tenant-profile-resolution-consolidation | 16908195 |
| 2026-07-19 | ✅ DONE | Severity-Grouped Findings Boxes With Modal Drill-In | fe7ba9b9 |
| 2026-07-18 | ✅ DONE | api-server-typecheck-fixes | 7d375bfa |
| 2026-07-18 | ✅ DONE | Portal Multi-Template Dashboard Resolve + Tabs (project/assessment excluded, pending projectsTable->mspId/customerId backlog fix) | 40e24e67 |
| 2026-07-18 | ✅ DONE | Mission Control Canvas — CustomerUser | 68dca058 |
| 2026-07-18 | ✅ DONE | Portfolio Risk Tenant-Scoping Audit (read-only; verdict LEAK NOT CONFIRMED) | 43c24840 |
| 2026-07-18 | ✅ DONE | MRR Canonical Source Audit | 8b5109a4 |
| 2026-07-18 | ✅ DONE | Fix Monitoring MRR Date Scoping | b8598440 |
| 2026-07-18 | ✅ DONE | MRR Metric Separation Audit | b9dcb15f |
| 2026-07-18 | ✅ DONE | Fix Global Toast Crash on Structured API Errors | 2c830cef |
| 2026-07-18 | ✅ DONE | fix-fetchActiveTenants-id-space-regression | 4520fe58 |
| 2026-07-18 | ✅ DONE | Merge Customer Home Content Into Mission Control + Flip Landing Route | ca751fe9 |
| 2026-07-19 | ✅ DONE | Wire Client Errors Into Platform Observability | 62945841 |
| 2026-07-19 | ✅ DONE | Move ErrorBoundary Above AuthProvider | 655090ea |
| 2026-07-19 | ✅ DONE | Three.js Integration Spike | a9377160 |
| 2026-07-19 | ✅ DONE | Build Overlord Total and Colony Scoring | c9c2c544 |
| 2026-07-19 | ✅ DONE | Fix Inverted Health Score Display + Hero Polish | 1c594a12 |
| 2026-07-19 | ✅ DONE | Restyle CustomerDashboardExtras to Match Fluent Design System | f9140197 |
| 2026-07-19 | ✅ DONE | Wire Live Colony Data Into 3D Scene | 3acbcb95 |
| 2026-07-19 | ✅ DONE | Add Factory Floor Nav Link and Wire HQ to Overlord Total | 5b223044 |
| 2026-07-19 | ✅ DONE | Merge Health Breakdown Into Hero | f3ed188e |
| 2026-07-19 | ✅ DONE | Auto-Trigger Sales Offer Generation On Diagnostics Completion | 128ba852 |
| 2026-07-19 | ✅ DONE | Add Animated Revenue Belts to HQ | dc72ff38 |
| 2026-07-19 | ✅ DONE | PowerShell Script Download for Requires-Script Findings | e453afb3 |
| 2026-07-19 | ✅ DONE | Move Welcome Header Above Mission Control | c8fdb18b |
| 2026-07-19 | ✅ DONE | Restyle DashboardTabs to Underline Pattern | a92bf210 |
| 2026-07-19 | ✅ DONE | Resource Category Data Audit | a7cf1c55 |
| 2026-07-19 | ✅ DONE | Reject cross-MSP tenant consent conflicts | c6d764de |
| 2026-07-19 | ✅ DONE | Fix Missing Diagnostics Runs List Endpoint + Malformed SSE URL | 16c3aa0a |
| 2026-07-19 | ✅ DONE | Build 5-Way Resource Category Split | 2ebb9b2f |
| 2026-07-19 | ✅ DONE | Assessment RBAC Role — Foundation | bd63fee9 |
| 2026-07-19 | ✅ DONE | Assessment Wizard — Scan Trigger, Progress Flow, First-Login Provisioning | 52e10b2a |
| 2026-07-19 | ✅ DONE | Assessment Results Viewer + OMG Cards | bdd4308d |
| 2026-07-19 | ✅ DONE | Account/Session Basics — Password, Login History, Real Sessions | 948f2bec |
| 2026-07-19 | ✅ DONE | GDPR Export/Deletion — Bridge to Current Customer Schema (export + deletion-request enrichment shipped; admin destructive erasure deferred via stop-and-report) | 69811f66 |
