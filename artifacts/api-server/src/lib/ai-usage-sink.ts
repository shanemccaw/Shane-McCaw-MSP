/**
 * ai-usage-sink.ts
 *
 * Connects the metered Anthropic client (`@workspace/integrations-anthropic-ai`)
 * to this app's persistence layer.
 *
 * The integration package emits an `AiUsageRecord` for every model call but has
 * no database dependency of its own — it is a shared library, and importing
 * `@workspace/db` there would invert the layering. This module supplies the
 * missing half: a sink that turns each record into an `ai_usage_events` row
 * (and, for MSP-owned usage, a `ai_balance_ledger` consumption debit) via the
 * existing `recordAiUsage()`.
 *
 * `installAiUsageSink()` is called once from the server entry point. Records
 * emitted before that point are buffered by the metering module and flushed on
 * registration, so calls made during module initialisation are not lost.
 *
 * Attribution gaps are surfaced, not swallowed: a record with
 * `attributed: false` came from a call site that never wrapped itself in
 * `withAiAttribution()`. It is still written (as platform-owned, so it can
 * never wrongly debit an MSP) and logged at warn level so the remaining call
 * sites can be found and fixed rather than quietly paid for.
 */

import type { AiUsagePersistResult, AiUsageRecord } from "@workspace/integrations-anthropic-ai";
import { registerAiUsageSink } from "@workspace/integrations-anthropic-ai";
import { recordAiUsage } from "./ai-billing";
import { logger } from "./logger";
import { getRequestContext } from "./request-context";

const log = logger.child({ channel: "engine.ai-cost-governance" });

let installed = false;

/**
 * Convert one metered record into a persisted usage event.
 *
 * Returns the persisted `costCents` (and event id) so a capture scope — see
 * `withAiUsageCapture` — can hand a caller the ledger's own figure for its
 * call. `undefined` means recording failed: the cost is unknown, not zero.
 */
export function handleAiUsageRecord(record: AiUsageRecord): Promise<AiUsagePersistResult | void> {
  if (!record.attributed) {
    log.warn(
      {
        model: record.model,
        nodeType: record.nodeType,
        feature: record.feature,
        totalTokens: record.totalTokens,
      },
      "ai-cost-governance: unattributed Anthropic call — recorded as platform-owned; wrap the call site in withAiAttribution()",
    );
  }

  if (record.failed || record.tokensUnknown) {
    log.warn(
      {
        model: record.model,
        nodeType: record.nodeType,
        feature: record.feature,
        failed: record.failed === true,
      },
      "ai-cost-governance: Anthropic call recorded without usable token counts — cost for this row is a floor, not a total",
    );
  }

  // Correlation id rides request-context.ts's per-request/per-run traceId
  // rather than call-site attribution, so every call in the same HTTP request
  // or workflow run shares one value without each site having to know it.
  const correlationId = getRequestContext()?.traceId;

  // recordAiUsage swallows and logs its own failures and never rejects, so a
  // ledger problem still cannot propagate back into the model call path.
  // Returning (rather than voiding) its promise is what lets a capture scope
  // read back the cost the ledger actually recorded.
  return recordAiUsage({
    mspId: record.mspId,
    customerId: record.customerId ?? null,
    nodeType: record.nodeType,
    feature: record.feature,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
    totalTokens: record.totalTokens,
    costOwner: record.costOwner,
    runId: record.runId,
    model: record.model,
    generatedArtifactType: record.generatedArtifactType,
    generatedArtifactName: record.generatedArtifactName,
    generatedArtifactId: record.generatedArtifactId,
    triggerSource: record.triggerSource,
    correlationId,
  }).then((recorded) => (recorded ? { costCents: recorded.costCents, eventId: recorded.eventId } : undefined));
}

/**
 * Install the persistence sink. Idempotent — a second call is a no-op, so
 * importing this from more than one entry point is safe.
 */
export function installAiUsageSink(): void {
  if (installed) return;
  installed = true;
  registerAiUsageSink(handleAiUsageRecord);
  log.info({}, "ai-cost-governance: AI usage sink installed — every Anthropic call now writes an ai_usage_events row");
}
