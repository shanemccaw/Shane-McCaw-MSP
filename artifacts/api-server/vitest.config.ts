import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/lib/doc-gate-coverage.test.ts",
      "src/lib/lead-intent.test.ts",
      "src/lib/sse-channels.test.ts",
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
      "src/lib/tenant-signals.test.ts",
      "src/lib/tenant-signals-stabilization.test.ts",
      "src/lib/tenant-signals-customer-bridge.test.ts",
      "src/lib/build-tenant-profile.test.ts",
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
      "src/lib/workflow-node-output-samples.test.ts",
      "src/routes/consent.test.ts",
      "src/routes/msp-portal.test.ts",
      "src/routes/msp-onboarding.test.ts",
      "src/lib/resolve-fulfillment.test.ts",
      "src/lib/__tests__/catalog-pricing.test.ts",
      "src/lib/__tests__/msp-subscription.test.ts",
      "src/lib/__tests__/msp-financial-aggregator.test.ts",
      "src/lib/__tests__/msp-financial-aggregator-overlord.test.ts",
      "src/routes/msp-sla-scope-creep.test.ts",
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
      "src/lib/__tests__/monitor-executor.test.ts",
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
      "src/lib/msp-plan-pricing.test.ts",
      "src/routes/msp-plan-self-service.test.ts",
      "src/routes/msp-billing-webhook.test.ts",
      "src/lib/retainer-pricing.test.ts",
      "src/routes/portal-retainer-billing.test.ts",
      "src/lib/dashboard-resolvers.test.ts",
      "src/lib/cost-engine.test.ts",
      "src/lib/license-waste-source.test.ts",
      "src/lib/license-waste-paid-seats.test.ts",
      "src/lib/sow-monitoring-addon.test.ts",
      "src/lib/sla-uptime.test.ts",
      "src/routes/dashboard-data.test.ts",
      "src/routes/dashboard-templates.test.ts",
      "src/routes/dashboard-overrides.test.ts",
      "src/routes/portal-mission-control.test.ts",
      "src/routes/admin-clients.test.ts",
      "src/routes/portal-team.test.ts",
      "src/routes/portal-billing.test.ts",
      "src/routes/portal-messages.test.ts",
      "src/lib/direct-tenant-provisioning.test.ts",
      "src/routes/msp-settings-portal-links.test.ts",
      "src/routes/portal-customer-search.test.ts",
      "src/routes/msp-alerts.test.ts",
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
      "src/lib/zoho-foundation.test.ts",
      "src/lib/zoho-crm.test.ts",
      "src/lib/zoho-projects.test.ts",
      "src/lib/zoho-desk.test.ts",
      "src/lib/war-room-pillar-stats.test.ts",
      "src/lib/registry-source-key-contract.test.ts",
      "src/lib/pillar-trend.test.ts",
      "src/lib/__tests__/sharepoint-sharing.test.ts",
      "src/lib/chat-content-blocks.test.ts",
      "src/lib/shanebot-persona.test.ts",
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
