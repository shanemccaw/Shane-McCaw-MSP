import Anthropic from "@anthropic-ai/sdk";
import { meterAnthropicClient } from "./metering";

if (!process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL) {
  throw new Error(
    "AI_INTEGRATIONS_ANTHROPIC_BASE_URL must be set. Did you forget to provision the Anthropic AI integration?",
  );
}

if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
  throw new Error(
    "AI_INTEGRATIONS_ANTHROPIC_API_KEY must be set. Did you forget to provision the Anthropic AI integration?",
  );
}

const rawAnthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

/**
 * The platform's Anthropic client — metered.
 *
 * This is deliberately the ONLY exported client. Every `messages.create` /
 * `messages.stream` call made through it emits an AI usage record (see
 * `metering.ts`), so it is not possible to call the model from this codebase
 * without a corresponding usage event. The raw, unmetered instance is not
 * exported: do not add an export for it.
 *
 * Attribute a call by wrapping it in `withAiAttribution({ mspId, costOwner,
 * nodeType, feature })` — unwrapped calls are still recorded, but as
 * platform-owned and flagged `attributed: false`.
 */
export const anthropic = meterAnthropicClient(rawAnthropic);
