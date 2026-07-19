/**
 * dashboard-executive-summary.ts
 *
 * "AI Executive Summary" tile for the customer_default monitoring dashboard —
 * a short, plain-language headline + 3-5 bullet takeaways generated from the
 * customer's currently-resolved dashboard metrics.
 *
 * Follows the same AI-call conventions established by omg-card-extractor.ts:
 * the shared `anthropic` client, a DB-editable prompt via getPrompt() with a
 * hard-coded fallback, robust JSON extraction (extractJson), zod validation,
 * and fire-and-forget usage/cost telemetry via recordAiUsage.
 *
 * CACHING — once per day, not speculative:
 *   Regenerating on every dashboard load would mean an AI call per page view,
 *   per customer, indefinitely — real, unbounded cost for a tile that doesn't
 *   need to be second-by-second fresh (the underlying monitor data itself only
 *   refreshes on its own scan cadence). Generation runs at most once per
 *   CACHE_TTL_HOURS per customer; every request within that window reads the
 *   cached row. `force: true` (wired to a manual "Regenerate" button) bypasses
 *   the cache for an on-demand refresh, same pattern as a cache-busting query
 *   param — it does not change the passive per-load behavior.
 */

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, dashboardExecutiveSummariesTable, dashboardTemplatesTable } from "@workspace/db";
import { getMetric } from "@workspace/dashboard-registry";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { resolveMetric, type ResolveContext, type MetricResultOk } from "./dashboard-resolvers.ts";
import { logger } from "./logger";
import { getPrompt } from "./prompt-loader";
import { recordAiUsage } from "./ai-billing";

const log = logger.child({ channel: "engine.dashboard" });

const SUMMARY_MODEL = "claude-haiku-4-5";
const SUMMARY_MAX_TOKENS = 800;
const CACHE_TTL_HOURS = 24;
const MAX_METRICS_IN_PROMPT = 40;

// ── Shape ───────────────────────────────────────────────────────────────────

export const ExecutiveSummaryBulletSchema = z.object({
  severity: z.enum(["red", "amber", "green"]),
  text: z.string().min(1).max(240),
});

const ExecutiveSummarySchema = z.object({
  headline: z.string().min(1).max(160),
  bullets: z.array(ExecutiveSummaryBulletSchema).min(1).max(5),
});

export interface ExecutiveSummaryResult {
  headline: string;
  bullets: z.infer<typeof ExecutiveSummaryBulletSchema>[];
  generatedAt: string | null;
  stale: boolean;
}

const SUMMARY_PROMPT_KEY = "dashboard-executive-summary";

const SUMMARY_PROMPT_FALLBACK = `You are a Microsoft 365 managed services advisor writing a short executive summary for a client's live monitoring dashboard. The audience is a busy business owner or IT decision-maker, not a technician.

CURRENT METRICS (label: value — only real, currently-resolved data; never invent a metric not listed here):
{{metrics}}

Produce ONE headline (a single plain-language sentence capturing overall posture) and 3-5 bullet takeaways. Each bullet:
- severity: "red" (urgent risk needing attention), "amber" (notable but not urgent), or "green" (healthy/strength — include at most one or two).
- text: one short sentence, plain business language, grounded ONLY in the metrics listed above. Reference actual numbers where useful.

RULES:
- Base everything ONLY on the metrics provided. Do not invent numbers or findings not present above.
- Lead with the most important/urgent items first.
- Return ONLY a JSON object, no markdown fences, no preamble. Shape:
{ "headline": "Your environment is mostly healthy with a few gaps to close.", "bullets": [ { "severity": "red", "text": "12 devices are non-compliant and need remediation." } ] }`;

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const objStart = text.indexOf("{");
  if (objStart === -1) return text.trim();
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = objStart; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return text.slice(objStart, i + 1); }
  }
  return text.slice(objStart).trim();
}

/** Compact "label: value" line for a resolved ok metric, for the prompt. */
function formatMetricLine(label: string, result: MetricResultOk): string | null {
  if (result.shape === "scalar") {
    const value = result.data.value;
    if (value == null) return null;
    const pct = typeof result.data.percentage === "number" ? ` (${result.data.percentage}%)` : "";
    return `${label}: ${value}${pct}`;
  }
  if (result.shape === "trend") {
    const series = result.data.series as { t: string; value: number }[] | undefined;
    if (!series || series.length === 0) return null;
    const latest = series[series.length - 1]!.value;
    const first = series[0]!.value;
    const direction = latest > first ? "up" : latest < first ? "down" : "flat";
    return `${label}: ${latest} (trend ${direction} over the period, was ${first})`;
  }
  if (result.shape === "distribution") {
    const buckets = result.data.buckets as { label: string; value: number }[] | undefined;
    if (!buckets || buckets.length === 0) return null;
    return `${label}: ${buckets.map((b) => `${b.label}=${b.value}`).join(", ")}`;
  }
  return null;
}

async function persist(opts: {
  customerId: number;
  mspId: number;
  headline: string;
  bullets: z.infer<typeof ExecutiveSummaryBulletSchema>[];
  model: string;
}): Promise<Date> {
  const generatedAt = new Date();
  const [existing] = await db
    .select({ id: dashboardExecutiveSummariesTable.id })
    .from(dashboardExecutiveSummariesTable)
    .where(eq(dashboardExecutiveSummariesTable.customerId, opts.customerId))
    .limit(1);

  if (existing) {
    await db
      .update(dashboardExecutiveSummariesTable)
      .set({ headline: opts.headline, bullets: opts.bullets, model: opts.model, generatedAt, updatedAt: generatedAt })
      .where(eq(dashboardExecutiveSummariesTable.id, existing.id));
  } else {
    await db.insert(dashboardExecutiveSummariesTable).values({
      customerId: opts.customerId,
      mspId: opts.mspId,
      headline: opts.headline,
      bullets: opts.bullets,
      model: opts.model,
      generatedAt,
    });
  }
  return generatedAt;
}

/**
 * Returns the cached executive summary for a customer, generating a fresh one
 * if there's no cached row, the cached row is older than CACHE_TTL_HOURS, or
 * `force` is set (manual refresh). Best-effort: on any AI/parse failure this
 * returns a `not_available`-flavored empty result rather than throwing — the
 * dashboard itself must always render regardless of this tile's state.
 */
export async function getOrGenerateExecutiveSummary(
  customerId: number,
  mspId: number,
  opts: { force?: boolean } = {},
): Promise<ExecutiveSummaryResult | null> {
  const [cached] = await db
    .select()
    .from(dashboardExecutiveSummariesTable)
    .where(eq(dashboardExecutiveSummariesTable.customerId, customerId))
    .limit(1);

  const cacheAgeMs = cached?.generatedAt ? Date.now() - new Date(cached.generatedAt).getTime() : Infinity;
  const isFresh = cacheAgeMs < CACHE_TTL_HOURS * 60 * 60 * 1000;

  if (cached && cached.generatedAt && isFresh && !opts.force) {
    return {
      headline: cached.headline,
      bullets: cached.bullets,
      generatedAt: cached.generatedAt.toISOString(),
      stale: false,
    };
  }

  const [template] = await db
    .select()
    .from(dashboardTemplatesTable)
    .where(
      and(
        eq(dashboardTemplatesTable.mspId, mspId),
        eq(dashboardTemplatesTable.templateType, "customer_default"),
        eq(dashboardTemplatesTable.isDefault, true),
      ),
    )
    .limit(1);

  if (!template || template.canvasLayout.length === 0) {
    // Nothing to summarize yet — return the stale cached copy if one exists,
    // otherwise there's genuinely nothing to show.
    if (cached && cached.generatedAt) {
      return { headline: cached.headline, bullets: cached.bullets, generatedAt: cached.generatedAt.toISOString(), stale: true };
    }
    return null;
  }

  const ctx: ResolveContext = { mspId, customerId };
  const metricKeys = [...new Set(template.canvasLayout.map((w) => w.metricKey))].slice(0, MAX_METRICS_IN_PROMPT);

  const lines: string[] = [];
  await Promise.all(
    metricKeys.map(async (key) => {
      const def = getMetric(key);
      if (!def) return;
      try {
        const result = await resolveMetric(def, ctx);
        if (result.status === "ok") {
          const line = formatMetricLine(def.label, result);
          if (line) lines.push(line);
        }
      } catch (err) {
        log.warn({ err, metricKey: key }, "dashboard-executive-summary: metric resolve failed, skipping");
      }
    }),
  );

  if (lines.length === 0) {
    if (cached && cached.generatedAt) {
      return { headline: cached.headline, bullets: cached.bullets, generatedAt: cached.generatedAt.toISOString(), stale: true };
    }
    return null;
  }

  const template_ = await getPrompt(SUMMARY_PROMPT_KEY, SUMMARY_PROMPT_FALLBACK);
  const prompt = template_.replace(/\{\{metrics\}\}/g, lines.join("\n"));

  try {
    const message = await anthropic.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: SUMMARY_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = message.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
    const parsed: unknown = JSON.parse(extractJson(raw));
    const validated = ExecutiveSummarySchema.safeParse(parsed);

    if (!validated.success) {
      log.warn(
        { customerId, issues: validated.error.issues.map((i) => i.message) },
        "dashboard-executive-summary: AI response failed schema validation",
      );
      if (cached && cached.generatedAt) {
        return { headline: cached.headline, bullets: cached.bullets, generatedAt: cached.generatedAt.toISOString(), stale: true };
      }
      return null;
    }

    void recordAiUsage({
      mspId,
      nodeType: "dashboard_executive_summary",
      feature: `dashboard_executive_summary:customer:${customerId}`,
      promptTokens: message.usage?.input_tokens ?? 0,
      completionTokens: message.usage?.output_tokens ?? 0,
      costOwner: "msp",
      model: message.model || SUMMARY_MODEL,
    });

    const generatedAt = await persist({
      customerId,
      mspId,
      headline: validated.data.headline,
      bullets: validated.data.bullets,
      model: message.model || SUMMARY_MODEL,
    });

    log.info({ customerId, bulletCount: validated.data.bullets.length }, "dashboard-executive-summary: generated and cached");

    return { headline: validated.data.headline, bullets: validated.data.bullets, generatedAt: generatedAt.toISOString(), stale: false };
  } catch (err) {
    log.error({ err, customerId }, "dashboard-executive-summary: generation failed");
    if (cached && cached.generatedAt) {
      return { headline: cached.headline, bullets: cached.bullets, generatedAt: cached.generatedAt.toISOString(), stale: true };
    }
    return null;
  }
}
