export { anthropic } from "./client";
export { batchProcess, batchProcessWithSSE, isRateLimitError, type BatchOptions } from "./batch";
export {
  withAiAttribution,
  withAiUsageCapture,
  totalCapturedCostCents,
  getAiAttribution,
  registerAiUsageSink,
  emitAiUsage,
  getUnsunkUsageCount,
  getDroppedUsageCount,
  resetAiUsageBuffer,
  meterAnthropicClient,
  type AiCallAttribution,
  type AiUsageRecord,
  type AiUsageSink,
  type AiUsagePersistResult,
  type AiCallCost,
  type AiCallCostStatus,
  type AiCostOwner,
} from "./metering";
