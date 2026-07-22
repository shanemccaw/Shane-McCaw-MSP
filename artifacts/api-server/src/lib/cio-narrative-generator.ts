/**
 * cio-narrative-generator.ts
 *
 * Generates the CIO-facing narrative that renders inside the Assessment
 * Wizard's "generating" step, in the same "senior Microsoft 365 Architect"
 * voice document-generator.ts already uses for real consulting documents —
 * narrating THIS run's real, already-classified findings (license-gap vs
 * genuine error, per the License-Gap Classification work) as a causal story
 * instead of a flat list, with real industry_benchmark_reference peer
 * comparisons only where a real benchmark row exists for that pillar.
 *
 * Fired once per completed diagnostics run (diagnostics-runner.ts, fire-and-
 * forget, non-blocking) as soon as the scan itself finishes — well before
 * documents finish generating — so the gap between "scan done" and
 * "documents done" becomes the narrative's value-delivery moment instead of
 * dead wait time. Result is persisted onto msp_diagnostic_runs so the
 * wizard's existing status poll (GET /api/portal/assessment/status) picks it
 * up with no new client-side mechanism.
 *
 * Deliberate non-goals — real, confirmed gaps, not fabricated:
 *   - No size-scaled "average cost of a breach" figure exists anywhere in
 *     this codebase (only a flat, doc-type-keyed marketing constant in the
 *     CRM app's BREACH_COST_CARD) — this narrative never cites a breach-cost
 *     dollar figure.
 *   - No finding→remediation-action mapping exists (baseline_action_templates
 *     has no check_key column, and the closest analogue —
 *     write_action_catalog.templateId — is itself still unpopulated) — this
 *     narrative never renders a "fix this now" action link.
 */

import { db, mspDiagnosticRunsTable, mspCustomersTable, industryBenchmarkReferenceTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";
import { getPrompt } from "./prompt-loader";
import { calculateArchitectureHealthScore } from "./health-engine";
import { computeDisplayHealth } from "./health-display";
import { fetchSignalRulesAndGroups } from "./priority-engine";
import { latestCheckProps, extractGroupByCountCounts } from "./dashboard-resolvers";
import { computeSkuCostBreakdown, centsToDollars } from "./cost-engine";

const log = logger.child({ channel: "workflow.doc-pipeline" });

export interface CioNarrativeFinding {
  checkKey: string;
  checkLabel: string;
  severity: "ok" | "info" | "warning" | "critical";
  title: string;
  description: string | null;
  checkStatus: string | null;
}

export interface GenerateCioNarrativeParams {
  runId: string;
  customerId: number;
  tenantId: string | null;
  findings: CioNarrativeFinding[];
}

const NARRATIVE_PROMPT_FALLBACK = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience, personally walking this client's CIO through today's assessment — in person, not writing a report. You lead with what matters and why it matters; the numbers back up what you're saying, they don't replace it.

Client: {{clientName}}

REAL FINDINGS FROM TODAY'S SCAN (already correctly classified — "license_gap" items are NOT security problems, they mean the tenant lacks a Microsoft 365 add-on and that check simply could not run; only genuine warning/critical items are real issues):
{{findingsBlock}}

REAL PEER-BENCHMARK DATA (only the pillars listed here have a real benchmark on file — never claim or imply a peer comparison for any pillar not listed):
{{benchmarkBlock}}

REAL LICENSE-WASTE DOLLAR FIGURES (if this says "No data", omit all cost/dollar framing entirely — never estimate or invent a number):
{{costBlock}}

INSTRUCTIONS:
- Output ONLY a semantic HTML fragment — h3/h4 headings, p, strong, em, ul/li only. NO <html>, <head>, <body>, <style>, <script>, inline CSS, or markdown code fences. This must be ready to inject directly into an already-styled page.
- Open with a short, direct headline (h3) — the single most important thing this CIO needs to hear today — then explain it underneath in your own voice.
- Where two or more genuine findings are causally related, connect them into one sequenced story ("here's how this actually plays out") rather than listing them separately — e.g. legacy auth left enabled compounds a missing MFA gap into a real path to account takeover. Only build a chain the real findings genuinely support — never invent a connection between unrelated findings.
- Use "companies your size typically..." peer-comparison framing ONLY for a pillar present in the REAL PEER-BENCHMARK DATA block above. Never state or imply an industry comparison for any other pillar.
- If REAL LICENSE-WASTE DOLLAR FIGURES has real data, work that real monthly/annual figure into the narrative naturally, tied to the specific waste it comes from. If it says "No data", never mention cost or dollar figures anywhere.
- Never recommend a specific "click here to fix" action for any finding — no reliable finding-to-remediation-action mapping exists in this platform yet, so implying a one-click fix would be misleading. General next-step advice in prose is fine; a specific actionable button/link claim is not.
- If there are no genuine (non-license-gap) findings at all, say so plainly and warmly — that's good news, don't manufacture urgency.
- Total length: 200-450 words. Write as Shane, first person, direct and human — not a corporate report voice.
- CRITICAL: output the HTML fragment and then STOP. No commentary before or after.`;

function findingsToBlock(findings: CioNarrativeFinding[]): string {
  const real = findings.filter((f) => f.checkStatus !== "license_gap" && f.severity !== "ok");
  const licenseGaps = findings.filter((f) => f.checkStatus === "license_gap");
  const lines: string[] = [];

  if (real.length === 0) {
    lines.push("No genuine findings — every evaluable check passed.");
  } else {
    for (const f of real.slice(0, 25)) {
      lines.push(`[${f.severity}] ${f.checkLabel} — ${f.title}${f.description ? `: ${f.description}` : ""}`);
    }
  }

  if (licenseGaps.length > 0) {
    const features = [...new Set(licenseGaps.map((f) => f.title.replace(/^Not checked — requires /, "")))];
    lines.push(`\n${licenseGaps.length} check(s) could not run — license gap only, NOT a finding: ${features.join(", ")}.`);
  }

  return lines.join("\n");
}

async function buildBenchmarkBlock(customerId: number): Promise<string> {
  try {
    const [output, { rules, groups }, benchmarks] = await Promise.all([
      calculateArchitectureHealthScore(customerId),
      fetchSignalRulesAndGroups(),
      db.select().from(industryBenchmarkReferenceTable),
    ]);
    const displayPillars = computeDisplayHealth(output, rules, groups);
    const benchmarkMap = new Map(benchmarks.map((b) => [b.pillar, b]));

    const lines: string[] = [];
    for (const { pillar, displayScore } of displayPillars) {
      const ref = benchmarkMap.get(pillar);
      if (ref?.industryAvgPct == null || displayScore == null) continue; // real data only — no fabricated pillars
      lines.push(
        `${pillar}: this tenant scores ${displayScore}/100; industry average is ${ref.industryAvgPct}/100${
          ref.msExcellencePct != null ? `, Microsoft excellence benchmark ${ref.msExcellencePct}/100` : ""
        } (source: ${ref.source ?? "internal benchmark"}).`,
      );
    }
    return lines.length > 0 ? lines.join("\n") : "No real benchmark data available for any scored pillar — do not include any peer comparison.";
  } catch (err) {
    log.warn({ err, customerId }, "cio-narrative-generator: benchmark lookup failed, omitting");
    return "No real benchmark data available — do not include any peer comparison.";
  }
}

async function buildCostBlock(tenantId: string | null): Promise<string> {
  if (!tenantId) return "No data.";
  try {
    const props = await latestCheckProps(tenantId, "cost:license-waste-estimate");
    if (!props) return "No data.";
    const counts = extractGroupByCountCounts(props);
    if (!counts) return "No data.";
    const breakdown = await computeSkuCostBreakdown(counts);
    if (breakdown.totalMonthlyCents <= 0) return "No data.";
    return `Real license waste, priced against current list prices: $${centsToDollars(breakdown.totalMonthlyCents).toLocaleString()}/month ($${centsToDollars(breakdown.totalAnnualCents).toLocaleString()}/year).`;
  } catch (err) {
    log.warn({ err, tenantId }, "cio-narrative-generator: cost breakdown failed, omitting");
    return "No data.";
  }
}

/** Strip any script/style/embed tags and inline event handlers the model might emit despite instructions — defense in depth, this HTML is injected directly into the wizard. */
function sanitizeNarrativeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(iframe|object|embed|link|meta)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "");
}

function stripFence(text: string): string {
  return text.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

/**
 * Fire-and-forget from diagnostics-runner.ts once a run reaches "completed".
 * Idempotent — a run whose narrative already started/finished (any status
 * past "not_started") is skipped, never silently regenerated.
 */
export async function generateCioNarrative(params: GenerateCioNarrativeParams): Promise<void> {
  const { runId, customerId, tenantId, findings } = params;

  const [existing] = await db
    .select({ status: mspDiagnosticRunsTable.cioNarrativeStatus })
    .from(mspDiagnosticRunsTable)
    .where(eq(mspDiagnosticRunsTable.runId, runId))
    .limit(1);
  if (!existing || existing.status !== "not_started") return;

  await db
    .update(mspDiagnosticRunsTable)
    .set({ cioNarrativeStatus: "generating", updatedAt: new Date() })
    .where(eq(mspDiagnosticRunsTable.runId, runId));

  try {
    const [customerRow] = await db
      .select({ name: mspCustomersTable.name })
      .from(mspCustomersTable)
      .where(eq(mspCustomersTable.id, customerId))
      .limit(1);
    const clientName = customerRow?.name ?? "your organization";

    const [findingsBlock, benchmarkBlock, costBlock] = await Promise.all([
      Promise.resolve(findingsToBlock(findings)),
      buildBenchmarkBlock(customerId),
      buildCostBlock(tenantId),
    ]);

    const rawTemplate = await getPrompt("assessment-cio-narrative", NARRATIVE_PROMPT_FALLBACK);
    const prompt = rawTemplate
      .replace(/\{\{clientName\}\}/g, clientName)
      .replace(/\{\{findingsBlock\}\}/g, findingsBlock)
      .replace(/\{\{benchmarkBlock\}\}/g, benchmarkBlock)
      .replace(/\{\{costBlock\}\}/g, costBlock);

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    if (aiResponse.stop_reason === "max_tokens") {
      log.warn({ runId, customerId }, "cio-narrative-generator: output hit max_tokens — narrative may be truncated");
    }

    const rawText = (aiResponse.content[0] as { text?: string } | undefined)?.text ?? "";
    const html = sanitizeNarrativeHtml(stripFence(rawText));

    await db
      .update(mspDiagnosticRunsTable)
      .set({
        cioNarrativeStatus: "ready",
        cioNarrativeHtml: html,
        cioNarrativeGeneratedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(mspDiagnosticRunsTable.runId, runId));

    log.info({ runId, customerId, findingsCount: findings.length }, "cio-narrative-generator: narrative generated");
  } catch (err) {
    log.error({ err, runId, customerId }, "cio-narrative-generator: generation failed");
    await db
      .update(mspDiagnosticRunsTable)
      .set({ cioNarrativeStatus: "failed", updatedAt: new Date() })
      .where(eq(mspDiagnosticRunsTable.runId, runId));
  }
}
