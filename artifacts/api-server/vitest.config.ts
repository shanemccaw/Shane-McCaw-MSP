import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // #2877 — a growing, run-to-run-unstable set of files (10+ across this
    // build's 2 clean full-suite reproductions, up from #2865's original 4)
    // hit the default 5000ms test / 10000ms hook timeout only under the full
    // ~305-file parallel run (never in isolation): transform-time/CPU
    // contention across vitest's default thread pool, not a logic defect.
    // #2865 scoped a per-file vi.setConfig() fix to its 4 named files: with
    // the set continuing to grow and not reproducing the same files run to
    // run, a small global bump is the more maintainable fix going forward.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    include: [
      "src/lib/security-plan-assembly.test.ts",
      "src/lib/security-plan-drift.test.ts",
      "src/lib/security-plan-prose.test.ts",
      "src/lib/repo-source-nul-byte-guard.test.ts",
      "src/lib/drift-collector.test.ts",
      "src/lib/config-change-attribution.live-db.test.ts",
      "src/lib/drift-check-specs.test.ts",
      "src/lib/retainer-hours.test.ts",
      "src/lib/remediation-catalog.test.ts",
      "src/lib/remediation-fix-route.test.ts",
      "src/lib/policy-enactment-route.test.ts",
      "src/lib/remediation-checklist.test.ts",
      "src/lib/remediation-reveal-gate.test.ts",
      "src/lib/remediation-bypass-resolutions.test.ts",
      "src/lib/graph-write-permissions.test.ts",
      "src/lib/dlp-role-group-provisioning.test.ts",
      "src/lib/portal-message-center.test.ts",
      "src/lib/portal-pii-governance.test.ts",
      "src/lib/doc-gate-coverage.test.ts",
      "src/lib/portal-ownership.test.ts",
      "src/lib/msp-ownership-book.test.ts",
      "src/lib/security-plan-cross-tenant.test.ts",
      "src/lib/lead-intent.test.ts",
      "src/lib/free-scan-prospect.test.ts",
      "src/lib/portal-sops.test.ts",
      "src/lib/portal-runbook-cycles.test.ts",
      "src/lib/sse-channels.test.ts",
      "src/lib/portal-deep-links.test.ts",
      "src/lib/sse-hub-firehose.test.ts",
      "src/routes/admin-live-stream.test.ts",
      "src/routes/admin-signal-rules-import.test.ts",
      "src/routes/admin-signal-rules-from-tenant.test.ts",
      "src/routes/admin-signal-rules-orphan-guard.test.ts",
      "src/routes/admin-signal-rules-delete-orphan-group.test.ts",
      "src/routes/admin-signal-rules-for-check-511.test.ts",
      "src/lib/compileReportToHtml.test.ts",
      "src/lib/sow-pricing.test.ts",
      "src/lib/sow-expiry-sweep.test.ts",
      "src/lib/ai-analyzer.test.ts",
      "src/lib/social-media-nodes.test.ts",
      "src/lib/ps-script-gen.test.ts",
      "src/lib/workflow-executor-generate-script.test.ts",
      "src/lib/workflow-executor-core.test.ts",
      "src/lib/workflow-executor-comms.test.ts",
      "src/lib/workflow-executor-content.test.ts",
      "src/lib/workflow-executor-integrations.test.ts",
      "src/lib/telemetry-retention-nodes.test.ts",
      "src/lib/config-snapshot-retention-nodes.test.ts",
      "src/lib/tenant-signals.test.ts",
      "src/lib/tenant-signals-stabilization.test.ts",
      "src/lib/tenant-signals-customer-bridge.test.ts",
      "src/lib/build-tenant-profile.test.ts",
      "src/lib/zoho-batch-drain-dlq-customer-notify-1166.test.ts",
      // #544 — namespaced mergedProfileByCheck + the scoping-pattern matcher
      // that must not re-fuse case-distinct keys the merge kept separate.
      "src/lib/merged-profile-by-check-544.test.ts",
      "src/lib/document-profile-scoping-544.test.ts",
      "src/lib/document-engine-signal-scoping.test.ts",
      "src/lib/document-drift-gate.test.ts",
      "src/lib/drift-engine.test.ts",
      "src/lib/forecasting-engine.test.ts",
      "src/lib/priority-engine.test.ts",
      "src/lib/health-engine.test.ts",
      "src/lib/telemetry-comparison.test.ts",
      "src/lib/copilot-gate.test.ts",
      "src/lib/copilot-readiness-narrative.test.ts",
      "src/lib/security-posture-narrative.test.ts",
      // #292 — the four pillar reports' prose sections, one parameterised suite
      // over all four specs (see the file's own header for why not four files).
      "src/lib/pillar-report-narrative.test.ts",
      "src/lib/narrative-grounding.test.ts",
      "src/lib/pillar-coverage.test.ts",
      "src/lib/pillar-matrix.test.ts",
      "src/lib/crm-engine.test.ts",
      "src/lib/msp-engine.test.ts",
      "src/lib/msp-engine-tenant-id-space.test.ts",
      "src/lib/engine-determinism.test.ts",
      "src/lib/msp.test.ts",
      "src/lib/portal-workflow-engine.test.ts",
      "src/lib/portal-change-control.test.ts",
      "src/lib/portal-change-approvals.test.ts",
      // #1500 — the freeze/blackout calendar's recurrence math and scope
      // matching (weekly/monthly/quarterly/annually cadence, global/tenant/
      // workload scoping) — pure, no database.
      "src/lib/portal-change-freeze.test.ts",
      "src/lib/portal-cab.test.ts",
      "src/lib/portal-cab-store.test.ts",
      // #1499 — Change Control execution record: pure plan-diff / outcome /
      // attestation / rollback-eligibility rules, plus real-DB store lifecycle.
      "src/lib/msp-change-execution.test.ts",
      "src/lib/msp-change-execution-store.test.ts",
      // #1502 — Post-Implementation Review: close codes, verification
      // evidence, and the drift re-scan, against the real local database.
      "src/lib/msp-change-pir-store.test.ts",
      "src/lib/portal-hold-windows.test.ts",
      "src/lib/workflow-node-output-samples.test.ts",
      "src/routes/consent.test.ts",
      "src/routes/msp-portal.test.ts",
      "src/routes/msp-onboarding.test.ts",
      "src/lib/resolve-fulfillment.test.ts",
      // #1171 — an accepted Project Work offer creates the real project row and
      // drives the PROVEN document-engine-sow.ts engine (title-narrowed, never a
      // flat catalog price); non-project offers no-op.
      "src/lib/project-sow-fulfillment.test.ts",
      "src/lib/__tests__/catalog-pricing.test.ts",
      "src/lib/__tests__/msp-subscription.test.ts",
      "src/lib/__tests__/msp-financial-aggregator.test.ts",
      "src/lib/__tests__/msp-financial-aggregator-overlord.test.ts",
      "src/routes/msp-sla-scope-creep.test.ts",
      "src/routes/msp-sla-operator-tasks.live-db.test.ts",
      "src/routes/msp-settings-user-security.live-db.test.ts",
      "src/lib/ai-billing.test.ts",
      "src/lib/ai-billing-cost-broadcast.test.ts",
      "src/routes/admin-ai-billing.test.ts",
      "src/lib/ai-billing-analytics.test.ts",
      "src/lib/ai-cost-anomaly.test.ts",
      "src/lib/ai-cost-capture.test.ts",
      "src/lib/document-engine-cost.test.ts",
      // Streamed narrative call: same document as the non-streaming path, cost
      // still captured post-stream, dry-run/reuse still calling no model at all.
      "src/lib/document-engine-streaming.test.ts",
      // #547 — the real Copilot Gate result reaching the score report's prompt,
      // in both the scored and the honestly-not-evaluated case.
      "src/lib/document-engine-copilot-gate.test.ts",
      // #550 — Secure-first, Invest-last deterministic finding ordering.
      "src/lib/document-engine-secure-first-invest-last-550.test.ts",
      "src/lib/cio-narrative-generator.test.ts",
      "src/lib/use-case-generator.test.ts",
      "src/routes/copilot-assessment-quiz-profile.test.ts",
      "src/routes/copilot-assessment-quiz-catalog.test.ts",
      "src/lib/assessment-tool-usage-signal.test.ts",
      "src/routes/admin-ai-billing-analytics.test.ts",
      "src/lib/ai-lead-attribution.test.ts",
      "src/routes/admin-ai-billing-lead-analytics.test.ts",
      "src/lib/ai-usage-metering.test.ts",
      "src/lib/ai-usage-sink.test.ts",
      "src/tests/doc-pipeline.test.ts",
      "src/tests/msp-reports.test.ts",
      "src/tests/request-context-spine.test.ts",
      "src/tests/log-stream-mirror.test.ts",
      "src/lib/exception-tracker.test.ts",
      "src/tests/workflow-run-correlation.test.ts",
      "src/routes/support-chat.test.ts",
      "src/routes/public-chat.test.ts",
      "src/routes/admin-public-chat.test.ts",
      "src/lib/__tests__/monitor-executor.test.ts",
      "src/lib/__tests__/service-availability.test.ts",
      "src/lib/__tests__/canonical-resource-resolution-2821.test.ts",
      "src/lib/__tests__/mfa-gap-monitor-check-1288.test.ts",
      "src/lib/sensitivity-label-severity-rules-470.test.ts",
      "src/lib/cert-secret-expiration-541.test.ts",
      // #551 — identity:global-admin-count repointed from /directoryRoles
      // (activated ROLES) to the role's real members, plus the resolvePathInData
      // literal-key fix that lets @odata.type work as a mapping sourceField.
      "src/lib/global-admin-count-role-members-551.test.ts",
      // #553 — copilot:data-exposure-risk repointed from count(id) over /sites
      // onto #357's verified per-site broad-sharing fan-out. Drives the DEFECT
      // first so the assertions are known to discriminate, and reads the real
      // mapping/severity_rules out of the shipped migration file.
      "src/lib/copilot-data-exposure-risk-553.test.ts",
      // #551 Phase 3 — appgov:unreviewed-consents and appgov:risky-permission-grants
      // redefined using the real consentType axis (Principal vs. AllPrincipals)
      // instead of the identical bare count() both previously shared.
      "src/lib/unreviewed-consents-risky-grants-551.test.ts",
      // #551 (final phase) — appgov:stale-app-registrations repointed from the
      // hardcoded (and, for /applications, non-existent) signInActivity read
      // to a real countWhere('{{createdDateTime}} olderThanDays N') age check.
      "src/lib/stale-app-registrations-age-based-551.test.ts",
      // #404 — onedrive:departed-user-access repointed from plain
      // accountEnabled == false to the real manager-based OneDrive-exposure
      // signal (countWhere over manager.id == null, plus a 30d age band).
      "src/lib/onedrive-departed-user-access-manager-404.test.ts",
      "src/lib/__tests__/item-detail-collector.test.ts",
      "src/lib/__tests__/graph-consent-revoke.test.ts",
      "src/lib/__tests__/graph-request-capture.test.ts",
      "src/lib/msp-mailer.test.ts",
      "src/routes/msp-custom-domain.test.ts",
      "src/routes/msp-sales-bundles.test.ts",
      "src/routes/msp-diagnostics.test.ts",
      "src/routes/msp-diagnostics-finding-classification.test.ts",
      "src/lib/diagnostics-finding-title.test.ts",
      "src/routes/portal-delivery-kanban.test.ts",
      "src/routes/portal-remediation-tracker-scores.test.ts",
      "src/lib/__tests__/live-monitor-nodes.test.ts",
      "src/routes/msp-sow.test.ts",
      "src/routes/admin-observability.test.ts",
      "src/routes/admin-dlq.test.ts",
      "src/routes/admin-deploy-console.test.ts",
      "src/routes/version.test.ts",
      "src/routes/admin-money.test.ts",
      "src/routes/portal-checkout.test.ts",
      "src/routes/admin-services-catalog.test.ts",
      "src/routes/admin-services-price-cents.test.ts",
      "src/lib/__tests__/node-type-registry.test.ts",
      "src/routes/msp-suspended-banner.test.ts",
      "src/routes/msp-customers-bulk.test.ts",
      "src/middlewares/requireAuth.test.ts",
      "src/lib/productTypeConfig.test.ts",
      "src/lib/msp-entitlement.test.ts",
      "src/routes/admin-engines.test.ts",
      "src/routes/admin-overlord.test.ts",
      "src/routes/portal-customer-offboard.test.ts",
      "src/routes/pcc.test.ts",
      "src/lib/config-pack-graph.test.ts",
      "src/lib/config-pack-orchestrator.test.ts",
      // #1559 — SOPs/Runbooks execution hook: the pure materializer that turns
      // an SOP's automated steps into a graph_write_operation workflow chain.
      "src/lib/sop-workflow-graph.test.ts",
      // #1497 — Change Control as the fail-closed authorization gate on the
      // tenant write path: the pure CR-authorization rule.
      "src/lib/change-control-write-gate.test.ts",
      // #1316 — the real dry-run + purchase-authorized execution behind /buy's
      // pack approve/execute stages (real local pack rows, Graph mocked).
      "src/lib/config-pack-dry-run.test.ts",
      "src/routes/public-purchase-packs.test.ts",
      "src/lib/msp-plan-pricing.test.ts",
      "src/routes/msp-plan-self-service.test.ts",
      "src/routes/msp-billing-webhook.test.ts",
      "src/lib/retainer-pricing.test.ts",
      "src/routes/portal-retainer-billing.test.ts",
      "src/routes/portal-retainer.test.ts",
      "src/lib/dashboard-resolvers.test.ts",
      "src/lib/cost-engine.test.ts",
      "src/lib/license-waste-source.test.ts",
      "src/lib/tenant-workloads.test.ts",
      "src/lib/risk-authority.test.ts",
      "src/lib/license-waste-paid-seats.test.ts",
      "src/lib/license-sku-ledger.test.ts",
      "src/lib/m365-change-resolver.test.ts",
      "src/lib/m365-change-router.test.ts",
      "src/lib/sow-monitoring-addon.test.ts",
      "src/lib/sla-uptime.test.ts",
      "src/routes/public-status-daily-history.test.ts",
      "src/routes/dashboard-data.test.ts",
      "src/routes/dashboard-templates.test.ts",
      "src/routes/dashboard-overrides.test.ts",
      "src/routes/portal-mission-control.test.ts",
      "src/routes/admin-clients.test.ts",
      "src/routes/portal-team.test.ts",
      "src/routes/portal-billing.test.ts",
      "src/routes/portal-messages.test.ts",
      "src/routes/portal-risk-register.test.ts",
      "src/routes/portal-policy-decisions.test.ts",
      "src/routes/msp-policy-decisions.test.ts",
      "src/lib/direct-tenant-provisioning.test.ts",
      "src/routes/msp-settings-portal-links.test.ts",
      "src/routes/portal-customer-search.test.ts",
      "src/routes/msp-alerts.test.ts",
      "src/routes/msp-retention-queue.test.ts",
      "src/routes/msp-executive.test.ts",
      "src/lib/msp-executive-data.test.ts",
      "src/lib/partner-qbr-generator.test.ts",
      "src/routes/msp-customer-timeline.test.ts",
      "src/middlewares/msp-staff-customer-scopes.test.ts",
      "src/lib/engagement-followup-dispatcher.test.ts",
      "src/lib/engagement-followup-cancellation-guard.test.ts",
      "src/lib/sql-statement-splitter.test.ts",
      "src/routes/msp-data-rights.test.ts",
      "src/routes/msp-marketplace-purchase.test.ts",
      "src/routes/portal-engine-history.test.ts",
      "src/routes/portal-customer-engines-assessment-redaction.test.ts",
      "src/routes/portal-dashboard-route-collision.test.ts",
      "src/routes/msp-engine-history.test.ts",
      "src/routes/admin-monitor-check-runs.test.ts",
      "src/routes/admin-monitor-checks-crud.test.ts",
      // The `/monitoring-packages/usage` read behind Simulator Studio's
      // Monitoring Packages screen — including that it is matched before
      // `/:key`, which no isolated handler test can catch.
      "src/routes/admin-monitoring-package-usage.test.ts",
      "src/routes/admin-simulator-assessments.test.ts",
      "src/routes/portal-assessment-debug-trigger-scan.test.ts",
      "src/routes/portal-assessment-debug-reset-session.test.ts",
      "src/lib/monitor-check-trace.test.ts",
      "src/lib/simulator-run-diff.test.ts",
      "src/lib/__tests__/monitor-failure-classifier.test.ts",
      "src/lib/write-action-safety.test.ts",
      "src/routes/admin-write-actions.test.ts",
      "src/routes/admin-document-generator.test.ts",
      "src/lib/active-directory.test.ts",
      "src/routes/admin-active-directory-credential-ops.test.ts",
      "src/routes/mfa-admin-reset.test.ts",
      "src/routes/admin-active-directory-user-actions.test.ts",
      "src/routes/admin-active-directory-delete.test.ts",
      // #1547 — the Policy Engine's declarative object: the standing-policy wire
      // contract and the target-kind vocabulary (pure, no database).
      "src/lib/standing-policies.test.ts",
      // #1551 — write consent decides the enactment shape (the NASA case): the
      // route file's authorization/scoping and the resolved wire response.
      "src/routes/msp-standing-policies.test.ts",
      // #1553 — Policy Engine finding source: the mailbox_attribute compliance
      // comparison logic (pure, no database, no Graph).
      "src/lib/policy-compliance.test.ts",
      // #1549 — Policy Engine continuous-evaluation reconciliation loop: the
      // gate decision (tenant resolution + opt-in), pure, no database.
      "src/lib/policy-engine-evaluator.test.ts",
      // #1552 — VIP classification: the wire contract, the source vocabulary, and
      // the "told always wins, discovery never overwrites" precedence rule (pure).
      "src/lib/vip-classifications.test.ts",
      "src/lib/zoho-foundation.test.ts",
      "src/lib/zoho-crm.test.ts",
      "src/lib/zoho-projects.test.ts",
      "src/lib/zoho-desk.test.ts",
      "src/lib/pillar-summary-stats.test.ts",
      "src/lib/registry-source-key-contract.test.ts",
      "src/lib/pillar-trend.test.ts",
      "src/lib/__tests__/sharepoint-sharing.test.ts",
      "src/lib/__tests__/overshared-items.test.ts",
      "src/lib/__tests__/portal-oversharing-sites.test.ts",
      // #1333 — the Governance area-card grid's card→check mapping and its
      // value/previous-scan-delta/severity derivation (ten confirmed-real cards;
      // External Sharing Drift + the Devices cards stay honest no-data).
      "src/lib/portal-governance-areas.test.ts",
      "src/lib/chat-content-blocks.test.ts",
      "src/lib/shanebot-persona.test.ts",
      "src/lib/shanebot-engine.test.ts",
      "src/lib/finding-rank-weight-414.test.ts",
      "src/lib/health-display-denominator-413.test.ts",
      "src/lib/pillar-denominator-spectrum-413.test.ts",
      "src/lib/security-secure-score-464.test.ts",
      "src/lib/category-pillar-mapping.test.ts",
      "src/routes/admin-signal-rules-category-pillar-469.test.ts",
      "src/lib/remediation-knowledge-base.test.ts",
      "src/routes/public-assessment-rescan-addon.test.ts",
      "src/lib/license-gap-purchase-links.test.ts",
      // #555 — the real per-finding point value: the raw signal_derivation_rules
      // impact column normalized against the SAME theoreticalMax the live score
      // used, and the two prompts that now carry it.
      "src/lib/finding-point-impact-555.test.ts",
      "src/lib/document-engine-point-impact-555.test.ts",
      // #556 — a `stop_reason: "max_tokens"` response is never treated as a
      // finished document (and the shared guard document-engine-sow.ts uses).
      "src/lib/document-engine-max-tokens-556.test.ts",
      // #558 — the shared style guide's identifier-hygiene rule, read out of
      // the shipped migration file and driven through the REAL prompt-loader
      // into every document type's assembled style prefix.
      "src/lib/document-style-identifier-hygiene-558.test.ts",
      // #559 — a document that states the opposite of the scan data it cites is
      // never saved. Replays the real 5-run reproduction (docs/1..5.html at
      // 6339200a) through the gate, and runs the numeric spot-check #559
      // originally proposed to show it passing the bad document.
      "src/lib/document-claim-binding-559.test.ts",
      // #560 — the SOW half of #559: a pricing line that bills a real engine
      // price against the wrong workstream is never saved. Constructs the swap
      // (the failure that leaves the total exactly right) and runs the
      // arithmetic check anyone would reach for first, watching it pass.
      "src/lib/sow-claim-binding-560.test.ts",
      // #559/#560 follow-up — a claim-binding audit that never answers gives up
      // at a bounded deadline and fails OPEN, in both engines' gates. Drives the
      // real never-resolving-promise failure, so a regression hangs the suite
      // rather than passing it quietly.
      "src/lib/document-claim-binding-timeout.test.ts",
      // #567 — a narrative generation whose stream stalls mid-flight FAILS at a
      // bounded wall clock with a specific error, instead of hanging with the
      // document pinned at `generating`. Fails CLOSED, unlike the audit
      // deadline above: there is no fallback narrative to proceed with.
      "src/lib/ai-generation-deadline.test.ts",
      // Run History: the effect strings are measured off real results, never
      // sniffed from the command text (insert...returning is the case that
      // proves it), and a failed write never breaks the run it was logging.
      "src/lib/run-history.test.ts",
      // #730 — the Remediation Tracker's persistent per-step state: the route's
      // step-id list has not drifted from the guide's own catalogue, and
      // `completed_at` is a server fact that un-ticking clears rather than a
      // client-supplied value that outlives the claim it recorded.
      "src/routes/portal-remediation-tracker.test.ts",
      // #733 — the Remediation Tracker's CSV/PDF export catalogue has not
      // drifted from previewRemediationGuide.ts, and the export route serves
      // real stored status/title data for all 28 steps.
      "src/lib/remediation-tracker-catalogue.test.ts",
      "src/routes/portal-remediation-tracker-export.test.ts",
      // #732 — the Remediation Tracker's real re-verification against a
      // rescan: the step→check mapping mirrors remediationLiveGuide.ts's own
      // (guarded against drift) and the verdict rule requires FULL mapped-check
      // coverage to certify `verified` while ANY real adverse finding is
      // enough to certify `drift`, even on partial coverage.
      "src/lib/remediation-tracker-verification.test.ts",
      // #734 — the Remediation Tracker's phase-gated live pricing: a phase's
      // fee stays flat until every one of its steps is resolved AND at least
      // one has been verified by a real rescan; deferred counts toward that
      // readiness gate and shane_handles deliberately does not (see the
      // module's own header for why, straight from the design file's code).
      "src/lib/remediation-tracker-pricing.test.ts",
      // #1542 — the decline-to-risk derivation: KB summary > scan finding >
      // check label > catalogue title fallback chain, never-invented money/
      // score fields, and idempotency on a repeat decline.
      "src/lib/remediation-tracker-risk-decline.test.ts",
      "src/lib/portal-change-rejection.test.ts",
      "src/lib/change-request-risk-discharge.test.ts",
      // #1510 — signature required on scope expansion, never on contraction:
      // the instance-set diff derivation (additions force a fresh signature,
      // subtraction-only/unchanged inherits) and the narrative/score audit
      // diff, including the mixed addition+subtraction case that must still
      // require a signature.
      "src/lib/rbd-scope-diff.test.ts",
      // #1545 — Shadow IT as an accumulating governance risk: which drift
      // verdicts count as "unauthorized" for accumulation into the standing
      // Shadow IT RBD (attributed_unapproved / unattributed, never approved
      // or informational).
      "src/lib/shadow-it-governance.test.ts",
      // #776 (Phase 1 of epic #647): real GET endpoint for
      // tenant_check_item_details — tenantId resolution stays scoped to the
      // caller's own customerId, a requested checkKey with no collection is
      // absent rather than an error, and a batch call returns exactly one
      // (the most recent) row per key.
      "src/routes/portal-tenant-check-items.test.ts",
      "src/lib/__tests__/onedrive-sharing.test.ts",
      // #1260 — the 4 missing Health stale-object-inventory checks: stale/
      // duplicate device records, unassigned Intune profiles, empty security
      // groups, and dormant (no-app-role-assignment) service principals.
      "src/lib/health-object-inventory-checks-1260.test.ts",
      // #1301 — compliance:zero-dlp-policies raw-count -> eq-0 -> critical
      // (mirrors identity:ca-policy-count), read out of the shipped migration
      // and driven through the real applyMapping/classifySeverity/buildFindingTitle.
      "src/lib/__tests__/zero-dlp-policies-check-1301.test.ts",
      // #2762 — 10 new compliance-surface checks closing a real
      // config_resources coverage gap, read out of the shipped migration and
      // driven through the real applyMapping/classifySeverity.
      "src/lib/__tests__/compliance-surface-coverage-2762.test.ts",
      // #2831 — real follow-up to #2762: 10 more compliance-surface checks
      // closing more of the same real config_resources coverage gap, read
      // out of the shipped migration and driven through the real
      // applyMapping/classifySeverity.
      "src/lib/__tests__/compliance-surface-coverage-2831.test.ts",
      // #2763 — 6 new directory-surface checks closing a real config_resources
      // coverage gap, read out of the shipped migration and driven through
      // the real applyMapping/classifySeverity.
      "src/lib/__tests__/directory-surface-coverage-2763.test.ts",
      // #2835 — real follow-up from #2763: 1 new directory-surface check
      // (identity:transitive-role-assignments) closing a real config_resources
      // coverage gap, read out of the shipped migration and driven through
      // the real applyMapping/classifySeverity.
      "src/lib/__tests__/directory-surface-coverage-2835.test.ts",
      // #1310 — the generalized purchase-session account-creation core (paid
      // gate, hash-at-rest codes, count-before-judge attempt budget,
      // verified-address pinning, provision-if-missing, never-overwrite),
      // run against the real local Postgres.
      "src/lib/purchase-account-flow.test.ts",
      // #1307 — the generalized Buy.tsx payment-intent/payment-confirmed pair
      // (monitoring tier × seats, fixed retainer tiers, summed real packs),
      // priced against the REAL local catalog rows with only the Stripe SDK
      // and outbound side effects mocked.
      "src/routes/public-purchase-payment.test.ts",
      // #1314 — the monitoring onboarding scan-kickoff decision (monitoring-only
      // product gate, completed-account tenant resolution, idempotency guard),
      // run against the real local Postgres with the scan trigger injected.
      "src/lib/monitoring-onboarding-scan.test.ts",
      // #1531 — the roadmap<->Message Center join on the roadmap feature ID
      // Message Center posts carry in their own body.
      "src/lib/m365-roadmap-mc-link.test.ts",
      // #1537 — cloud instance as a first-class, filterable dimension on
      // Microsoft Changes (worldwide/gov/all classification).
      "src/lib/m365-cloud-instance.test.ts",
      // #1536 — the prose rollout-schedule advisory date extracted from a
      // Message Center post's own bodyContent.
      "src/lib/m365-message-center-date-quality.test.ts",
      // #1593 — Account Security's password age / failed sign-ins / device
      // compliance signals: real-tenant-shaped honest available/unavailable
      // branches (Entra Premium gap, no-active-Intune gap, consent revoked).
      "src/lib/account-security-graph.test.ts",
      "src/routes/portal-account-security-graph.test.ts",
      // #1871 — the azure-rm ARM transport's reach model: "no Azure RBAC" and
      // "no Azure subscriptions" are the same empty HTTP 200 and must stay
      // distinguishable.
      "src/lib/__tests__/azure-rm.test.ts",
      // #1915 — Azure Lighthouse onboarding template generation: pins the real
      // documented ARM template shape (authorizations, Reader role, subscription
      // vs resource-group scope) and the honest "unconfigured" failure mode.
      "src/lib/__tests__/azure-lighthouse-onboarding.test.ts",
      // #1797 — the configuration snapshot differ's four rules, pure: absence vs
      // unreadability vs deletion (the false-deletion guard), property-level output
      // measured side by side against the existing detectDrift primitive, stable
      // ordering, and the data-driven noise ruleset's matching and precedence.
      "src/lib/config-snapshot-differ.test.ts",
      // #2032 — the differ's cache key includes resourceKeys, so a scoped recompute
      // gets its own stored row instead of colliding with the full-tenant diff.
      "src/lib/config-snapshot-differ.live-db.test.ts",
      // #2115 — classifySnapshotFailure's real-literal branches, keyed off the
      // observed shapes on snapshot rows 8 (#1962) and 10 (#2115): the
      // not_applicable_to_account_type / endpoint_not_found / not_supported_app_only
      // families, plus the LicenseGapError and non-JSON-body wire-evidence capture
      // fixes so a caught failure never records with neither http_status nor
      // error_code.
      "src/lib/config-snapshot-collector.test.ts",
      // #1947 — the freeze-safe retention clock (a 7-year freeze that resumes from
      // exactly the remainder it froze with), the referential delete guard, and the
      // provenance bypass gate. Pure functions and in-memory registries, no database.
      "src/lib/retention/retention-clock.test.ts",
      "src/lib/retention/subscription-gate.test.ts",
      // #2847 — the per-customer billing decision the gate, the retention clock
      // freeze/resume and the 7-year purge all now read: tenants.status AND the real
      // tenant_subscriptions row, with absence of a subscription explicitly NOT
      // meaning cancellation. Pure, no database.
      "src/lib/tenant-billing-state.test.ts",
      // #2847 — the same rule applied by the resolver (one customer, on request) and
      // by the sweep's SQL (every customer, one pass), proved to agree against the real
      // local Postgres. Skips cleanly with no DATABASE_URL.
      "src/lib/tenant-billing-state.live-db.test.ts",
      // #2847 → #2765 seam: a cancelled per-customer subscription really does freeze
      // that customer's retention clocks and start the 7-year window, with tenants.status
      // left untouched throughout (which is the gap #2847 was filed for).
      "src/lib/retention/subscription-freeze.live-db.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/workflow-executor.ts"],
      thresholds: {
        branches: 90,
      },
    },
  },
});
