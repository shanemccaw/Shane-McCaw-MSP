/**
 * metering.ts
 *
 * Structural AI usage metering for the platform's single Anthropic client.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this module, writing an `ai_usage_events` row was a *convention*: each
 * of the ~100 `anthropic.messages.*` call sites had to remember to call
 * `recordAiUsage()` afterwards, and almost none of them did. A call site that
 * forgot produced real spend with no ledger entry and no attribution — the
 * exact failure mode the AI Cost Governance initiative exists to eliminate.
 *
 * This module moves the recording INSIDE the client. `client.ts` exports a
 * metered proxy, not the raw SDK instance, so every `messages.create` /
 * `messages.stream` call anywhere in the monorepo passes through
 * `emitAiUsage()` on its way out. There is no unmetered client to import.
 * Forgetting to record is no longer possible; the only thing a call site can
 * still forget is *attribution*, and an unattributed call is recorded anyway
 * (flagged `attributed: false`) rather than silently vanishing.
 *
 * ATTRIBUTION
 * -----------
 * Attribution travels through an AsyncLocalStorage context rather than through
 * call-site arguments, so wrapping a whole operation attributes every model
 * call it makes — including ones several layers down:
 *
 *   withAiAttribution({ mspId, costOwner: "msp", nodeType: "chat_message" },
 *     () => anthropic.messages.create({ ... }));
 *
 * Nested `withAiAttribution` calls shallow-merge over the enclosing context, so
 * an inner layer can refine `feature` without losing the outer `mspId`.
 *
 * THE SINK
 * --------
 * This package deliberately has no database dependency — it is a shared
 * integration library, and importing `@workspace/db` here would invert the
 * layering. Instead the consuming app registers a sink
 * (`registerAiUsageSink`) that persists the record. In the api-server that sink
 * is backed by `recordAiUsage()` and is installed at server start.
 *
 * Records emitted before a sink is registered are buffered (bounded) and
 * flushed on registration, so calls made during module init are not lost. If a
 * process never registers a sink (a one-off CLI script, a unit test), the
 * records are held in the buffer and reported by `getUnsunkUsageCount()` — they
 * are never written, but they are never silently pretended to be written
 * either.
 *
 * FAILURE ISOLATION
 * -----------------
 * Metering is a passive tap. It never alters the value returned to the caller,
 * never delays it, and never converts a successful call into a failed one — a
 * sink that throws is caught and dropped. A billing hiccup must not break
 * document generation.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type AiCostOwner = "msp" | "platform";

/** Attribution supplied by the caller via `withAiAttribution`. */
export interface AiCallAttribution {
  /** MSP whose balance this call bills against. Null/absent = unattributed. */
  mspId?: number | null;
  /** "msp" debits the MSP's allowance; "platform" is platform-funded. */
  costOwner?: AiCostOwner;
  /** Workflow node type (or pseudo-node type) responsible for the call. */
  nodeType?: string;
  /** Human-readable feature label, e.g. "support_chat". */
  feature?: string;
  /** Workflow run id, when the call happens inside a run. */
  runId?: string;
  /** Customer (tenant) this call was for. Null/absent when not customer-scoped. */
  customerId?: number | null;
  /** Type of artifact this call generates, e.g. "sow", "governance_snapshot". */
  generatedArtifactType?: string;
  /** Human-readable name of the generated artifact, e.g. "SOW - Acme Corp". */
  generatedArtifactName?: string;
  /** Reference to the generated artifact's row (table varies by artifactType). */
  generatedArtifactId?: string;
  /**
   * What triggered this call when it did not originate from a workflow node
   * (nodeType already captures that case), e.g. "simulator-studio:manual-run",
   * "support-chat".
   */
  triggerSource?: string;
}

/** One recorded model call, handed to the sink. */
export interface AiUsageRecord {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costOwner: AiCostOwner;
  mspId: number | null;
  nodeType: string;
  feature: string;
  runId?: string;
  customerId?: number | null;
  generatedArtifactType?: string;
  generatedArtifactName?: string;
  generatedArtifactId?: string;
  triggerSource?: string;
  /**
   * False when the call ran outside any `withAiAttribution` scope. Such calls
   * are still recorded — as platform-owned, so they can never wrongly debit an
   * MSP — but the flag marks them as an attribution gap to be closed rather
   * than a genuine platform-funded call.
   */
  attributed: boolean;
  /**
   * True when the call threw before returning usage. Token counts are 0 and
   * unknown, NOT known-to-be-zero — a failed call may still have been billed
   * upstream. Recorded so a burst of failures is visible rather than invisible.
   */
  failed?: boolean;
  /**
   * True when real token counts could not be read off the response (e.g. a
   * raw streaming response the tap must not consume). Cost derived from this
   * record is a floor, not a total.
   */
  tokensUnknown?: boolean;
}

/**
 * What the sink reports back about the row it actually persisted.
 *
 * This is the ONLY channel by which a caller can learn what its model call
 * cost, and it deliberately carries the figure the ledger wrote rather than
 * anything recomputed downstream — a second cost calculation could disagree
 * with what the MSP was charged.
 *
 * A sink that returns nothing (the pre-existing `void` shape) is not treated as
 * "free": the cost is reported as unknown.
 */
export interface AiUsagePersistResult {
  /** `ai_usage_events.costCents` as written for this call. */
  costCents: number;
  /** `ai_usage_events.eventId` of that row, when the insert returned one. */
  eventId?: string | null;
}

export type AiUsageSink = (
  record: AiUsageRecord,
) => void | AiUsagePersistResult | Promise<AiUsagePersistResult | void>;

/** How a captured call's cost came to be known — or not. */
export type AiCallCostStatus =
  /** A row was written and reported its cost. `costCents` is that figure. */
  | "recorded"
  /** The call happened but recording failed or reported nothing back. Cost unknown. */
  | "recording-failed"
  /** No sink ever consumed the record (unregistered sink, buffer overflow, timeout). */
  | "unrecorded";

/** The cost outcome of exactly one metered model call. */
export interface AiCallCost {
  /**
   * Cents the ledger recorded for this call, or `null` when that is genuinely
   * not knowable. `null` means unknown — never assume zero.
   */
  costCents: number | null;
  eventId: string | null;
  status: AiCallCostStatus;
  /** The call itself threw; any cost is a floor, not a total. */
  failed: boolean;
  /** Token counts could not be read off the response. */
  tokensUnknown: boolean;
}

/** One in-flight metered call awaiting its persisted cost. */
interface CostSlot {
  promise: Promise<AiCallCost>;
  settle: (cost: AiCallCost) => void;
}

interface UsageCollector {
  slots: CostSlot[];
}

/** Fallback labels for calls made with no attribution context. */
const UNATTRIBUTED_NODE_TYPE = "unattributed";
const UNATTRIBUTED_FEATURE = "unattributed:anthropic";

/** Bounded buffer so a sink-less process cannot grow memory without limit. */
const MAX_BUFFERED_RECORDS = 500;

const attributionStore = new AsyncLocalStorage<AiCallAttribution>();
const collectorStore = new AsyncLocalStorage<UsageCollector>();

/** How long `withAiUsageCapture` waits for the sink before reporting unknown. */
const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;

let usageSink: AiUsageSink | null = null;
let buffered: Array<{ record: AiUsageRecord; slot: CostSlot | null }> = [];
let droppedBufferedCount = 0;

/**
 * Install the persistence sink. Flushes anything buffered before installation.
 * Calling this again replaces the sink (used by tests).
 */
export function registerAiUsageSink(sink: AiUsageSink | null): void {
  usageSink = sink;
  if (!sink) return;
  const flush = buffered;
  buffered = [];
  for (const entry of flush) deliver(entry.record, sink, entry.slot);
}

/** Records emitted with no sink installed, still held in the buffer. */
export function getUnsunkUsageCount(): number {
  return buffered.length;
}

/** Records discarded because the buffer was full before a sink was installed. */
export function getDroppedUsageCount(): number {
  return droppedBufferedCount;
}

/** Test helper — clears buffered state without touching the installed sink. */
export function resetAiUsageBuffer(): void {
  buffered = [];
  droppedBufferedCount = 0;
}

/** The attribution in scope for the current async context, if any. */
export function getAiAttribution(): AiCallAttribution | undefined {
  return attributionStore.getStore();
}

/**
 * Run `fn` with `attribution` in scope. Every Anthropic call made inside — at
 * any depth, across awaits — is attributed to it. Shallow-merges over any
 * enclosing attribution so inner scopes can refine without discarding.
 */
export function withAiAttribution<T>(attribution: AiCallAttribution, fn: () => T): T {
  const parent = attributionStore.getStore();
  return attributionStore.run({ ...parent, ...attribution }, fn);
}

function costOf(
  record: AiUsageRecord,
  status: AiCallCostStatus,
  persisted?: AiUsagePersistResult | void,
): AiCallCost {
  return {
    costCents: status === "recorded" && persisted ? persisted.costCents : null,
    eventId: persisted?.eventId ?? null,
    status,
    failed: record.failed === true,
    tokensUnknown: record.tokensUnknown === true,
  };
}

function deliver(record: AiUsageRecord, sink: AiUsageSink, slot: CostSlot | null = null): void {
  let returned: void | AiUsagePersistResult | Promise<AiUsagePersistResult | void>;
  try {
    returned = sink(record);
  } catch {
    // A failing sink must never surface to the caller of the model — but the
    // cost is then unknown, not zero.
    slot?.settle(costOf(record, "recording-failed"));
    return;
  }
  if (returned && typeof (returned as Promise<unknown>).then === "function") {
    void (returned as Promise<AiUsagePersistResult | void>).then(
      (persisted) => slot?.settle(persisted ? costOf(record, "recorded", persisted) : costOf(record, "recording-failed")),
      () => slot?.settle(costOf(record, "recording-failed")),
    );
    return;
  }
  const persisted = returned as AiUsagePersistResult | void;
  slot?.settle(persisted ? costOf(record, "recorded", persisted) : costOf(record, "recording-failed"));
}

/**
 * Record one model call. Called by the metered client; exported so a caller
 * using the SDK through a path this module does not wrap (e.g. the batch API)
 * can still meter explicitly.
 */
export function emitAiUsage(record: AiUsageRecord, slot: CostSlot | null = null): void {
  if (usageSink) {
    deliver(record, usageSink, slot);
    return;
  }
  if (buffered.length >= MAX_BUFFERED_RECORDS) {
    droppedBufferedCount += 1;
    slot?.settle(costOf(record, "unrecorded"));
    return;
  }
  buffered.push({ record, slot });
}

/**
 * Register an in-flight call with the enclosing capture scope, if any.
 *
 * Called SYNCHRONOUSLY at model-call time — before the response is awaited —
 * so `withAiUsageCapture` knows a call is pending regardless of when the usage
 * record is later emitted. Doing this at emit time instead would race: the
 * caller's `await` can resume before the metering tap's derived promise runs.
 */
function beginCapturedCall(): CostSlot | null {
  const collector = collectorStore.getStore();
  if (!collector) return null;
  let settle: (cost: AiCallCost) => void = () => {};
  let done = false;
  const promise = new Promise<AiCallCost>((resolve) => {
    settle = (cost) => {
      if (done) return;
      done = true;
      resolve(cost);
    };
  });
  const slot: CostSlot = { promise, settle };
  collector.slots.push(slot);
  return slot;
}

/**
 * Run `fn` with `attribution` in scope (exactly as `withAiAttribution`) and
 * additionally report what each Anthropic call made inside it actually cost,
 * as recorded by the sink.
 *
 * The costs come from the persisted `ai_usage_events` rows — they are not
 * recomputed here, so a caller can never report a figure that disagrees with
 * what was billed.
 *
 * Because recording is asynchronous and deliberately non-fatal, this waits a
 * bounded time for the sink to settle. Calls that have not settled by then are
 * reported as `unrecorded` with a `null` cost — unknown, never zero.
 */
export async function withAiUsageCapture<T>(
  attribution: AiCallAttribution,
  fn: () => Promise<T>,
  opts?: { settleTimeoutMs?: number },
): Promise<{ result: T; costs: AiCallCost[] }> {
  const collector: UsageCollector = { slots: [] };
  const result = await withAiAttribution(attribution, () => collectorStore.run(collector, fn));

  if (collector.slots.length === 0) return { result, costs: [] };

  const timeoutMs = opts?.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;
  const costs = await Promise.all(
    collector.slots.map((slot) =>
      Promise.race([
        slot.promise,
        new Promise<AiCallCost>((resolve) => {
          const timer = setTimeout(
            () =>
              resolve({
                costCents: null,
                eventId: null,
                status: "unrecorded",
                failed: false,
                tokensUnknown: false,
              }),
            timeoutMs,
          );
          // Never hold the process open just to wait on a billing figure.
          (timer as { unref?: () => void }).unref?.();
        }),
      ]),
    ),
  );
  return { result, costs };
}

/**
 * Total the captured costs into a single figure.
 *
 * Returns `null` — unknown — if ANY call in the scope failed to report its
 * cost. A partial sum presented as a total would understate real spend, which
 * is the same class of dishonesty as reporting zero.
 */
export function totalCapturedCostCents(costs: AiCallCost[]): number | null {
  if (costs.length === 0) return null;
  let total = 0;
  for (const cost of costs) {
    if (cost.costCents == null) return null;
    total += cost.costCents;
  }
  return total;
}

/** Shape of the pieces of the SDK client this module touches. */
interface MessagesLike {
  create: (...args: never[]) => unknown;
  stream: (...args: never[]) => unknown;
}
interface AnthropicLike {
  messages: MessagesLike;
}

interface UsageLike {
  input_tokens?: number;
  output_tokens?: number;
}

function readUsage(value: unknown): UsageLike | null {
  if (!value || typeof value !== "object") return null;
  const usage = (value as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  return usage as UsageLike;
}

function modelOf(params: unknown, response: unknown): string {
  const fromResponse =
    response && typeof response === "object"
      ? (response as { model?: unknown }).model
      : undefined;
  if (typeof fromResponse === "string" && fromResponse) return fromResponse;
  const fromParams =
    params && typeof params === "object" ? (params as { model?: unknown }).model : undefined;
  return typeof fromParams === "string" && fromParams ? fromParams : "unknown";
}

function baseRecord(
  attribution: AiCallAttribution | undefined,
  params: unknown,
  response: unknown,
): AiUsageRecord {
  const attributed = attribution != null && attribution.mspId != null;
  return {
    model: modelOf(params, response),
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    // An unattributed call defaults to platform-owned so it can never debit the
    // wrong MSP's balance. The `attributed` flag is what marks it as a gap.
    costOwner: attributed ? attribution!.costOwner ?? "msp" : "platform",
    mspId: attributed ? attribution!.mspId! : null,
    nodeType: attribution?.nodeType ?? UNATTRIBUTED_NODE_TYPE,
    feature: attribution?.feature ?? UNATTRIBUTED_FEATURE,
    ...(attribution?.runId ? { runId: attribution.runId } : {}),
    ...(attribution?.customerId != null ? { customerId: attribution.customerId } : {}),
    ...(attribution?.generatedArtifactType ? { generatedArtifactType: attribution.generatedArtifactType } : {}),
    ...(attribution?.generatedArtifactName ? { generatedArtifactName: attribution.generatedArtifactName } : {}),
    ...(attribution?.generatedArtifactId ? { generatedArtifactId: attribution.generatedArtifactId } : {}),
    ...(attribution?.triggerSource ? { triggerSource: attribution.triggerSource } : {}),
    attributed,
  };
}

function emitFromResponse(
  attribution: AiCallAttribution | undefined,
  params: unknown,
  response: unknown,
  slot: CostSlot | null = null,
): void {
  const record = baseRecord(attribution, params, response);
  const usage = readUsage(response);
  if (usage) {
    record.promptTokens = usage.input_tokens ?? 0;
    record.completionTokens = usage.output_tokens ?? 0;
    record.totalTokens = record.promptTokens + record.completionTokens;
  } else {
    // No `usage` block to read — most likely a raw streaming response, which
    // the tap must not consume. Report honestly rather than as a zero-cost call.
    record.tokensUnknown = true;
  }
  emitAiUsage(record, slot);
}

function emitFailure(
  attribution: AiCallAttribution | undefined,
  params: unknown,
  slot: CostSlot | null = null,
): void {
  const record = baseRecord(attribution, params, null);
  record.failed = true;
  record.tokensUnknown = true;
  emitAiUsage(record, slot);
}

/**
 * Wrap an Anthropic SDK client so every `messages.create` / `messages.stream`
 * call emits a usage record.
 *
 * The tap is passive: `create` returns the SDK's original `APIPromise`
 * untouched (so `.withResponse()` and friends keep working) with metering
 * hung off a derived promise, and `stream` returns the original `MessageStream`
 * with non-consuming `finalMessage` / `error` listeners attached.
 */
export function meterAnthropicClient<T extends AnthropicLike>(client: T): T {
  const rawMessages = client.messages;

  const meteredCreate = (...args: never[]): unknown => {
    const attribution = getAiAttribution();
    // Registered here, synchronously, so an enclosing capture scope knows this
    // call is pending before the caller can await past it.
    const slot = beginCapturedCall();
    const params = args[0];
    const result = rawMessages.create.apply(rawMessages, args);
    // Derived promise — the caller still receives `result` itself, and our
    // rejection handler keeps this branch from becoming an unhandled rejection.
    void Promise.resolve(result as unknown).then(
      (value) => emitFromResponse(attribution, params, value, slot),
      () => emitFailure(attribution, params, slot),
    );
    return result;
  };

  const meteredStream = (...args: never[]): unknown => {
    const attribution = getAiAttribution();
    const slot = beginCapturedCall();
    const params = args[0];
    const stream = rawMessages.stream.apply(rawMessages, args);
    const emitter = stream as {
      on?: (event: string, listener: (arg: unknown) => void) => unknown;
    };
    if (typeof emitter.on === "function") {
      // `on` observes without consuming, so the caller's own iteration of the
      // stream is unaffected. An 'error' listener also prevents the emitter
      // from treating a stream error as an unhandled 'error' event.
      emitter.on("finalMessage", (message) =>
        emitFromResponse(attribution, params, message, slot),
      );
      emitter.on("error", () => emitFailure(attribution, params, slot));
    } else {
      emitFromResponse(attribution, params, null, slot);
    }
    return stream;
  };

  const messagesProxy = new Proxy(rawMessages, {
    get(target, prop) {
      if (prop === "create") return meteredCreate;
      if (prop === "stream") return meteredStream;
      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      // Bind to the real target, never to the proxy — the SDK's classes use
      // private (#) fields, and a proxy receiver fails their brand checks.
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });

  return new Proxy(client, {
    get(target, prop) {
      if (prop === "messages") return messagesProxy;
      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as T;
}
