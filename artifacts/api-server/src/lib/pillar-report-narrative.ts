/**
 * pillar-report-narrative.ts — the generation loop every live-rendered pillar
 * report's prose sections run through (#292).
 *
 * WHY THIS EXISTS
 * ---------------
 * `copilot-readiness-narrative-generator.ts` (#409) established the shape:
 * structured real data in, one attributed Anthropic call per section (routed
 * through `withAiDevResponseCache`, #185), a prompt body loaded through
 * `prompt-loader.ts` so Shane can edit it without a deploy, an HTML fragment
 * out, sanitised. `security-posture-narrative-generator.ts` (#343) reproduced it
 * for a second report, extracting the never-fabricate machinery into
 * `narrative-grounding.ts` on the way.
 *
 * What #343 did NOT extract is the loop around it — the fact floor, the cache
 * key, the per-section error isolation, the logging. #292 adds four more reports
 * on the same pattern, and six copies of "a section that throws is omitted with
 * a machine reason rather than substituted with prose" is six places for the
 * guarantee to rot. So the loop lives here, and each report's own generator is
 * left holding only what makes it that report: which pillars ground which
 * section, its headings, its prompt keys and its prompt bodies.
 *
 * The two EXISTING generators are deliberately not repointed at this. Both are
 * shipped, both have their own suites asserting their exact behaviour, and the
 * Security Posture one additionally resolves a metric of its own (Secure Score)
 * that no other report needs. Refactoring working, tested, shipped code is not
 * what this issue is for; if a seventh report arrives, fold them in then.
 *
 * WHAT THE GROUNDING REALLY IS
 * ----------------------------
 * `buildPillarSummary(customerId)` — the same function, on the same
 * customer, that `GET /portal/pillars` serves to the Reveal
 * and to each report's own pure-data sections, so the prose and the tables beside
 * it cannot disagree about the same tenant. The Gate is
 * `computeCopilotGate(customerId)` — the engine's Copilot pillar (#358/#359).
 *
 * NONE OF THE FOUR REPORTS RESOLVES A METRIC OF ITS OWN, deliberately. Every
 * figure they show is already one of `PILLAR_STAT_SPECS`' stats and
 * therefore already on the wire — unlike Secure Score, which is a real registry
 * metric that no spec carries. So there is no second, laxer path from a value to
 * a sentence anywhere in this file, and `withExtraStats` is not used.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { withAiDevResponseCache } from "./ai-dev-response-cache.ts";
import { getPrompt } from "./prompt-loader.ts";
import { logger } from "./logger.ts";
import { computeCopilotGate } from "./copilot-gate.ts";
import {
  MIN_FACTS_FOR_NARRATIVE,
  collectFactsForPillars,
  renderNarrativePrompt,
  sanitizeNarrativeHtml,
  stripFence,
  type MissingCheck,
  type NarrativeOmission,
  type SectionFacts,
} from "./narrative-grounding.ts";
import { buildPillarSummary, type PillarSummaryKey } from "./pillar-summary-stats.ts";

const log = logger.child({ channel: "engine.dashboard" });

/** How many output tokens one prose section may take. Matches its siblings. */
const MAX_SECTION_TOKENS = 1200;

export type PillarReportOmission = NarrativeOmission;

export interface PillarReportNarrativeSection {
  readonly key: string;
  readonly heading: string;
  /** A semantic HTML fragment, or null when nothing real could ground it. */
  readonly html: string | null;
  readonly omittedReason: PillarReportOmission | null;
  /** How many real facts grounded it — the honest measure of its depth. */
  readonly factCount: number;
  /**
   * The real `monitor_checks` keys this section wanted and did not get, with the
   * resolver's own reason. Surfaced so a thin section can say what is missing
   * instead of reading as a thin tenant — and so the client's Upgrade
   * Opportunity sweep can find a licence gap the prose could not speak to.
   */
  readonly missingChecks: readonly MissingCheck[];
}

export interface PillarReportNarrativeResult {
  readonly sections: readonly PillarReportNarrativeSection[];
  /** The real Gate score / threshold / verdict this narrative was grounded in. */
  readonly gate: { readonly score: number | null; readonly threshold: number; readonly status: string | null };
  /** Real curated check count across every package this customer has been scanned with. */
  readonly scannedCheckCount: number;
  readonly scannedPackageKeys: readonly string[];
  /** The real `monitor_checks.key` values behind `scannedCheckCount` (#575). */
  readonly scannedCheckKeys: readonly string[];
  readonly generatedAt: string;
}

export interface PillarReportAttribution {
  readonly mspId: number | null;
  readonly customerId: number | null;
  readonly triggerSource: string;
}

/**
 * One prose section, declared by the report that owns it.
 *
 * `pillars` is the grounding scope — which of `PILLAR_SUMMARY_KEYS`' cards this
 * section may reason from. It is deliberately per-section rather than
 * per-report: a Copilot Readiness Impact section needs the copilot card that its
 * report's own Summary must not see, and a section handed a figure it does not
 * own is a section that will eventually quote it.
 */
export interface PillarReportSectionSpec {
  readonly key: string;
  readonly heading: string;
  readonly pillars: readonly PillarSummaryKey[];
  /** The `ai_prompts` key a DB row would override this section's body under. */
  readonly promptKey: string;
  /** The canonical body, from the report's own leaf prompts module. */
  readonly promptBody: string;
  /**
   * True when this section's prompt carries `{{gateBlock}}`. Only the Copilot
   * Readiness Impact sections do; passing the Gate to a section whose body has
   * no token for it would silently do nothing, and passing it to one that does
   * have the token but should not reason from it would be worse.
   */
  readonly withGate?: boolean;
}

/**
 * Everything one report needs the engine to know about it.
 *
 * `feature` becomes the AI metering feature name and the dev-cache namespace, so
 * two reports' sections can never collide in either — see `ai-metering choke
 * point` for why the feature string is the unit costs are attributed under.
 */
export interface PillarReportSpec {
  /** e.g. "governance_posture" — lowercase, underscored, per report. */
  readonly feature: string;
  /** For log lines. e.g. "governance-posture-narrative". */
  readonly logName: string;
  readonly sections: readonly PillarReportSectionSpec[];
}

async function generateSection(
  spec: PillarReportSpec,
  section: PillarReportSectionSpec,
  facts: SectionFacts,
  context: {
    readonly tenantName: string;
    readonly gate: { score: number | null; threshold: number; status: string | null };
    readonly attribution: PillarReportAttribution;
  },
): Promise<PillarReportNarrativeSection> {
  const base = {
    key: section.key,
    heading: section.heading,
    factCount: facts.factCount,
    missingChecks: facts.missingChecks,
  };

  // The hard floor. No call, no template, no fallback prose — the viewer renders
  // an honest unavailable state from `omittedReason`.
  if (facts.factCount < MIN_FACTS_FOR_NARRATIVE) {
    log.info(
      { customerId: context.attribution.customerId, section: section.key, missing: facts.missingChecks.length },
      `${spec.logName}: section has no real facts — omitted rather than generated`,
    );
    return { ...base, html: null, omittedReason: "no_real_data" };
  }

  const rawTemplate = await getPrompt(section.promptKey, section.promptBody);
  const prompt = renderNarrativePrompt(rawTemplate, {
    tenantName: context.tenantName,
    facts,
    ...(section.withGate ? { gate: context.gate } : {}),
  });

  try {
    const aiResponse = await withAiDevResponseCache(
      {
        feature: `${spec.feature}_narrative_${section.key}`,
        // The real grounding, not the rendered prompt: a prompt-body edit in the
        // admin UI must not silently serve a cached response written from the
        // previous wording, and the same tenant facts must hit the same row.
        requestContext: {
          section: section.key,
          tenantName: context.tenantName,
          gate: context.gate,
          pillarBlock: facts.pillarBlock,
          statBlock: facts.statBlock,
          findingBlock: facts.findingBlock,
          promptBody: rawTemplate,
        },
      },
      {
        mspId: context.attribution.mspId,
        costOwner: "msp",
        nodeType: `${spec.feature}_narrative`,
        feature: `${spec.feature}_narrative_${section.key}`,
        customerId: context.attribution.customerId,
        triggerSource: context.attribution.triggerSource,
      },
      () =>
        anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: MAX_SECTION_TOKENS,
          messages: [{ role: "user", content: prompt }],
        }),
    );

    if (aiResponse.stop_reason === "max_tokens") {
      log.warn(
        { customerId: context.attribution.customerId, section: section.key },
        `${spec.logName}: output hit max_tokens — section may be truncated`,
      );
    }

    const block = aiResponse.content.find((b) => b.type === "text");
    const rawText = block && block.type === "text" ? block.text : "";
    const html = sanitizeNarrativeHtml(stripFence(rawText));

    if (!html) {
      log.warn(
        { customerId: context.attribution.customerId, section: section.key },
        `${spec.logName}: model returned an empty section`,
      );
      return { ...base, html: null, omittedReason: "empty_response" };
    }

    return { ...base, html, omittedReason: null };
  } catch (err) {
    // One section failing must not cost the reader the others, and must not be
    // papered over with written-in-advance prose.
    log.warn(
      { err, customerId: context.attribution.customerId, section: section.key },
      `${spec.logName}: section generation failed — omitted rather than substituted`,
    );
    return { ...base, html: null, omittedReason: "generation_failed" };
  }
}

/**
 * Generate every prose section of one pillar report for one real customer.
 *
 * Never throws for a thin or empty tenant: that is a real state with a real,
 * honest rendering. It throws only if the underlying real data cannot be read at
 * all, which the route surfaces as an error rather than an empty report.
 */
export async function generatePillarReportNarrative(
  spec: PillarReportSpec,
  params: {
    readonly customerId: number;
    readonly tenantName: string;
    readonly attribution: PillarReportAttribution;
  },
): Promise<PillarReportNarrativeResult> {
  const [payload, gate, tenantRow] = await Promise.all([
    buildPillarSummary(params.customerId),
    computeCopilotGate(params.customerId),
    db
      .select({ mspId: tenantsTable.mspId })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, params.customerId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const gateView = { score: gate.score, threshold: gate.threshold, status: gate.status };

  // `mspId` is read for attribution only — no metric here is resolved on the
  // side, so unlike the Security Posture generator there is no `ResolveContext`
  // for it to satisfy. It falls back to the caller's own resolution.
  const attribution: PillarReportAttribution = {
    ...params.attribution,
    mspId: params.attribution.mspId ?? tenantRow?.mspId ?? null,
  };

  const sections = await Promise.all(
    spec.sections.map((section) =>
      generateSection(spec, section, collectFactsForPillars(section.pillars, payload.pillars), {
        tenantName: params.tenantName,
        gate: gateView,
        attribution,
      }),
    ),
  );

  log.info(
    {
      customerId: params.customerId,
      generated: sections.filter((s) => s.html !== null).length,
      omitted: sections.filter((s) => s.html === null).map((s) => `${s.key}:${s.omittedReason}`),
    },
    `${spec.logName}: sections resolved`,
  );

  return {
    sections,
    gate: gateView,
    scannedCheckCount: payload.scannedCheckCount,
    scannedPackageKeys: payload.scannedPackageKeys,
    scannedCheckKeys: payload.scannedCheckKeys,
    generatedAt: payload.generatedAt,
  };
}

/** Exported for tests — the section specs are each report's grounding contract. */
export const __testables = { generateSection, MAX_SECTION_TOKENS };
