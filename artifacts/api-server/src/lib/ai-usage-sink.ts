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

import type { AiUsageRecord } from "@workspace/integrations-anthropic-ai";
import { registerAiUsageSink } from "@workspace/integrations-anthropic-ai";
import { recordAiUsage } from "./ai-billing";
import { logger } from "./logger";

const log = logger.child({ channel: "engine.ai-cost-governance" });

let installed = false;

/** Convert one metered record into a persisted usage event. */
export function handleAiUsageRecord(record: AiUsageRecord): void {
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

  // Fire-and-forget: recordAiUsage swallows and logs its own failures, so a
  // ledger problem can never propagate back into the model call path.
  void recordAiUsage({
    mspId: record.mspId,
    nodeType: record.nodeType,
    feature: record.feature,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
    totalTokens: record.totalTokens,
    costOwner: record.costOwner,
    runId: record.runId,
    model: record.model,
  });
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
