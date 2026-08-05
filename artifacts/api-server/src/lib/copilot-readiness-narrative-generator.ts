/**
 * copilot-readiness-narrative-generator.ts
 *
 * The three AI-written prose sections of the Copilot Readiness, Safety &
 * Enablement Report (#409) — Copilot Safety & Exposure, Workflow Enablement &
 * Value, and Gate Blockers & Remediation Path.
 *
 * SAME PATTERN AS final-report-narrative-generator.ts, DELIBERATELY
 * ----------------------------------------------------------------
 * Structured real data in, one attributed Anthropic call per section (routed
 * through `withAiDevResponseCache`, #185), a prompt body loaded through
 * `prompt-loader.ts` so Shane can edit it without a deploy, an HTML fragment
 * out, sanitised the same way. Nothing new is invented about how the platform
 * calls Anthropic; this is a fourth call site of an existing shape.
 *
 * THE NEVER-FABRICATE DISCIPLINE, CARRIED FORWARD LITERALLY
 * ---------------------------------------------------------
 * final-report-narrative-generator.ts's own header states the rule this file
 * inherits: never invent a fact the platform does not have, and let thin data
 * produce shorter content rather than a fabricated fallback. Here that is
 * enforced in code, not only in the prompt, because a prompt is a request and
 * this is a guarantee:
 *
 *   • The grounding blocks are built ONLY from real values — a
 *     `WarRoomStat` with a null `value` never reaches the model as a number.
 *     It is listed separately, by its real `monitor_checks` key and the
 *     resolver's own machine reason (`no_data`, `not_in_scan_package`,
 *     `license_gap`, …), under an instruction never to speak to it. That
 *     distinction is the whole of #341 and it survives into the prose.
 *   • A section with ZERO real facts is NOT generated at all. No call is
 *     made, and the section returns `html: null` with a machine-readable
 *     `omittedReason`, which the viewer renders as an honest unavailable
 *     state. There is deliberately no template, no boilerplate paragraph and
 *     no "generic readiness advice" fallback anywhere in this file — a
 *     fabricated fallback is precisely the failure this exists to prevent.
 *   • A section with FEW real facts is generated from those few facts, and
 *     the prompt scales length to the fact count rather than padding to a
 *     word target. `factCount` is passed in so the instruction is grounded in
 *     the real number rather than the model's impression of it.
 *   • One section failing (or being omitted) never suppresses the other two.
 *
 * WHAT THE GROUNDING REALLY IS
 * ----------------------------
 * `buildWarRoomPillarStats(customerId)` — the same function, on the same
 * customer, that `GET /portal/assessment/war-room-pillars` serves to the
 * Reveal and to this report's own pure-data sections. It is called here rather
 * than accepting numbers from the client for two reasons: the prose must cite
 * the same figures the reader can see beside it, and a narrative grounded in
 * request-supplied numbers is a narrative anyone can dictate.
 *
 * The Gate score is `computeCopilotGate(customerId)` — the engine's Copilot
 * pillar (#358/#359), the same number the Reveal's headline and the viewer's
 * gate chip read. The gap to the Gate is arithmetic on that, not a judgement.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { withAiDevResponseCache } from "./ai-dev-response-cache.ts";
import { getPrompt } from "./prompt-loader.ts";
import { logger } from "./logger.ts";
import { computeCopilotGate } from "./copilot-gate.ts";
import {
  COPILOT_BLOCKERS_PROMPT,
  COPILOT_ENABLEMENT_PROMPT,
  COPILOT_SAFETY_PROMPT,
} from "./copilot-readiness-prompts.ts";
import {
  buildWarRoomPillarStats,
  type WarRoomPillarCard,
  type WarRoomPillarKey,
  type WarRoomStat,
} from "./war-room-pillar-stats.ts";

const log = logger.child({ channel: "engine.dashboard" });

/** The three prose sections, in the order the report renders them. */
export const READINESS_NARRATIVE_SECTIONS = ["safety", "enablement", "blockers"] as const;
export type ReadinessNarrativeSectionKey = (typeof READINESS_NARRATIVE_SECTIONS)[number];

/**
 * Why a section carries no prose. Machine-stable, so the viewer can say WHICH
 * kind of nothing it is rather than printing one blanket placeholder — the same
 * distinction `refineStatUnavailability` draws for stats (#341).
 */
export type ReadinessNarrativeOmission =
  | "no_real_data"
  | "generation_failed"
  | "empty_response";

export interface ReadinessNarrativeSection {
  readonly key: ReadinessNarrativeSectionKey;
  readonly heading: string;
  /** A semantic HTML fragment, or null when nothing real could ground it. */
  readonly html: string | null;
  readonly omittedReason: ReadinessNarrativeOmission | null;
  /** How many real facts grounded it — the honest measure of its depth. */
  readonly factCount: number;
  /**
   * The real `monitor_checks` keys this section wanted and did not get, with
   * the resolver's own reason. Surfaced so a thin section can say what is
   * missing instead of reading as a thin tenant.
   */
  readonly missingChecks: readonly { readonly checkKey: string; readonly reason: string }[];
}

export interface ReadinessNarrativeResult {
  readonly sections: readonly ReadinessNarrativeSection[];
  /** The real Gate score / threshold / verdict this narrative was grounded in. */
  readonly gate: { readonly score: number | null; readonly threshold: number; readonly status: string | null };
  /** Real curated check count across every package this customer has been scanned with. */
  readonly scannedCheckCount: number;
  readonly scannedPackageKeys: readonly string[];
  readonly generatedAt: string;
}

export interface ReadinessNarrativeAttribution {
  readonly mspId: number | null;
  readonly customerId: number | null;
  readonly triggerSource: string;
}

/* ------------------------------------------------------------------ *
 * Fact extraction — real values only
 * ------------------------------------------------------------------ */

/**
 * Which pillars ground which section. Not a new grouping: these are the same
 * `WAR_ROOM_PILLAR_KEYS` the payload already carries, selected by what each
 * section is actually about. `blockers` reads every pillar because the Gate is
 * the whole-tenant verdict.
 */
const SECTION_PILLARS: Record<ReadinessNarrativeSectionKey, readonly WarRoomPillarKey[]> = {
  safety: ["governance", "security", "compliance"],
  enablement: ["adoption", "licensing"],
  blockers: ["governance", "licensing", "adoption", "compliance", "health", "security", "copilot"],
};

const SECTION_HEADINGS: Record<ReadinessNarrativeSectionKey, string> = {
  safety: "Copilot Safety & Exposure",
  enablement: "Workflow Enablement & Value",
  blockers: "Gate Blockers & Remediation Path",
};

const SECTION_PROMPT_KEYS: Record<ReadinessNarrativeSectionKey, string> = {
  safety: "assessment-copilot-safety-exposure",
  enablement: "assessment-copilot-workflow-enablement",
  blockers: "assessment-copilot-gate-blockers",
};

/** A stat the model may cite: it has a real, finite number behind it. */
function isRealStat(stat: WarRoomStat): boolean {
  return typeof stat.value === "number" && Number.isFinite(stat.value);
}

/**
 * Render one real stat value. Deliberately no rounding, bucketing or
 * "approximately" — the number the reader sees in the table beside this prose
 * is the number the model is given.
 */
function formatStatValue(stat: WarRoomStat): string {
  const value = stat.value as number;
  if (stat.unit === "percent") return `${value}%`;
  if (stat.unit === "currency") return `$${value.toLocaleString("en-US")}`;
  return value.toLocaleString("en-US");
}

interface SectionFacts {
  readonly factCount: number;
  readonly pillarBlock: string;
  readonly statBlock: string;
  readonly findingBlock: string;
  readonly missingBlock: string;
  readonly missingChecks: readonly { readonly checkKey: string; readonly reason: string }[];
}

/**
 * Everything real this section has, and nothing it does not.
 *
 * A "fact" is one of three things, all of which the platform genuinely holds:
 * a pillar with a real display score, a stat with a real value, or a real
 * `msp_diagnostic_findings` row. Nothing else counts — in particular an
 * unavailable stat counts toward `missingChecks`, never toward `factCount`, so
 * a tenant whose checks all failed to collect cannot reach the fact floor on
 * the strength of its own gaps.
 */
function collectSectionFacts(
  key: ReadinessNarrativeSectionKey,
  cards: readonly WarRoomPillarCard[],
): SectionFacts {
  const wanted = new Set<string>(SECTION_PILLARS[key]);
  const relevant = cards.filter((c) => wanted.has(c.pillar));

  const pillarLines: string[] = [];
  const statLines: string[] = [];
  const findingLines: string[] = [];
  const missing: { checkKey: string; reason: string }[] = [];
  let factCount = 0;

  for (const card of relevant) {
    if (typeof card.score === "number") {
      pillarLines.push(
        `- ${card.pillar}: score ${card.score}/100 (higher is healthier), ${card.findingCounts.critical} critical and ${card.findingCounts.warning} warning findings`,
      );
      factCount += 1;
    } else {
      pillarLines.push(
        `- ${card.pillar}: NO SCORE — no evaluable rule fed this pillar, so nothing may be claimed about it either way`,
      );
    }

    for (const stat of card.stats) {
      if (isRealStat(stat)) {
        statLines.push(`- ${card.pillar} · ${stat.label}: ${formatStatValue(stat)}`);
        factCount += 1;
      } else if (stat.checkKey) {
        missing.push({ checkKey: stat.checkKey, reason: stat.unavailableReason ?? "no_data" });
      }
    }

    for (const finding of card.findings) {
      findingLines.push(`- [${finding.severity}] ${card.pillar} · ${finding.checkKey}: ${finding.title}`);
      factCount += 1;
    }
  }

  return {
    factCount,
    pillarBlock: pillarLines.length ? pillarLines.join("\n") : "No pillar in scope for this section carries a score.",
    statBlock: statLines.length
      ? statLines.join("\n")
      : "No measured figure in scope for this section has a value. Do not cite any number here.",
    findingBlock: findingLines.length
      ? findingLines.join("\n")
      : "No critical or warning finding was recorded for the pillars in scope. Do not describe any finding.",
    missingBlock: missing.length
      ? missing.map((m) => `- ${m.checkKey} (${m.reason})`).join("\n")
      : "None — every check in scope for this section reported.",
    missingChecks: missing,
  };
}

/* ------------------------------------------------------------------ *
 * Prompt fallbacks
 *
 * The canonical bodies live in `copilot-readiness-prompts.ts` — a leaf module
 * `prompt-loader.ts` also reads, so the fallback here and the seed in the AI
 * Prompts admin UI are ONE string rather than two copies free to drift (the
 * exact trap #270 recorded). A DB row of the same key still wins over both.
 * ------------------------------------------------------------------ */

const PROMPT_FALLBACKS: Record<ReadinessNarrativeSectionKey, string> = {
  safety: COPILOT_SAFETY_PROMPT,
  enablement: COPILOT_ENABLEMENT_PROMPT,
  blockers: COPILOT_BLOCKERS_PROMPT,
};

/* ------------------------------------------------------------------ *
 * Sanitising — mirrors final-report-narrative-generator.ts exactly
 * ------------------------------------------------------------------ */

/** Same defence-in-depth as the sibling call sites: this HTML is injected into a live page. */
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
 * The floor below which a section is not generated at all.
 *
 * ONE real fact. Not zero — a section built from literally nothing would be the
 * model writing from its own priors, which is the fabrication this file exists
 * to prevent — and not higher, because a tenant with one real finding deserves
 * one honest sentence about it rather than a blanket "unavailable" that hides a
 * real result. The three-facts-is-thin case is handled by the prompt's own
 * length rule, not by suppression.
 */
export const MIN_FACTS_FOR_NARRATIVE = 1;

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

function gateBlock(gate: { score: number | null; threshold: number; status: string | null }): string {
  if (gate.score === null) {
    return `NO SCORE. No evaluable rule fed this tenant's Copilot pillar, so there is no readiness figure and no verdict. The Gate threshold is ${gate.threshold}. Do not state a score, a gap or a Go/No-Go verdict.`;
  }
  const gap = gate.threshold - gate.score;
  const verdict = gate.status === "go" ? "cleared" : "not cleared";
  return gap > 0
    ? `Score ${gate.score}/100 against a Gate of ${gate.threshold} — ${verdict}. The gap is exactly ${gap} points. Never quote a different gap.`
    : `Score ${gate.score}/100 against a Gate of ${gate.threshold} — ${verdict}. The tenant is at or above the Gate; there is no gap to close.`;
}

async function generateSection(
  key: ReadinessNarrativeSectionKey,
  facts: SectionFacts,
  context: {
    readonly tenantName: string;
    readonly gate: { score: number | null; threshold: number; status: string | null };
    readonly attribution: ReadinessNarrativeAttribution;
  },
): Promise<ReadinessNarrativeSection> {
  const base = {
    key,
    heading: SECTION_HEADINGS[key],
    factCount: facts.factCount,
    missingChecks: facts.missingChecks,
  };

  // The hard floor. No call, no template, no fallback prose — the viewer
  // renders an honest unavailable state from `omittedReason`.
  if (facts.factCount < MIN_FACTS_FOR_NARRATIVE) {
    log.info(
      { customerId: context.attribution.customerId, section: key, missing: facts.missingChecks.length },
      "copilot-readiness-narrative: section has no real facts — omitted rather than generated",
    );
    return { ...base, html: null, omittedReason: "no_real_data" };
  }

  const rawTemplate = await getPrompt(SECTION_PROMPT_KEYS[key], PROMPT_FALLBACKS[key]);
  const prompt = rawTemplate
    .replace(/\{\{tenantName\}\}/g, context.tenantName)
    .replace(/\{\{pillarBlock\}\}/g, facts.pillarBlock)
    .replace(/\{\{statBlock\}\}/g, facts.statBlock)
    .replace(/\{\{findingBlock\}\}/g, facts.findingBlock)
    .replace(/\{\{missingBlock\}\}/g, facts.missingBlock)
    .replace(/\{\{gateBlock\}\}/g, gateBlock(context.gate))
    .replace(/\{\{factCount\}\}/g, String(facts.factCount));

  try {
    const aiResponse = await withAiDevResponseCache(
      {
        feature: `copilot_readiness_narrative_${key}`,
        // The real grounding, not the rendered prompt: a prompt-body edit in the
        // admin UI must not silently serve a cached response written from the
        // previous wording, and the same tenant facts must hit the same row.
        requestContext: {
          section: key,
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
        nodeType: "copilot_readiness_narrative",
        feature: `copilot_readiness_narrative_${key}`,
        customerId: context.attribution.customerId,
        triggerSource: context.attribution.triggerSource,
      },
      () =>
        anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1200,
          messages: [{ role: "user", content: prompt }],
        }),
    );

    if (aiResponse.stop_reason === "max_tokens") {
      log.warn(
        { customerId: context.attribution.customerId, section: key },
        "copilot-readiness-narrative: output hit max_tokens — section may be truncated",
      );
    }

    const block = aiResponse.content.find((b) => b.type === "text");
    const rawText = block && block.type === "text" ? block.text : "";
    const html = sanitizeNarrativeHtml(stripFence(rawText));

    if (!html) {
      log.warn(
        { customerId: context.attribution.customerId, section: key },
        "copilot-readiness-narrative: model returned an empty section",
      );
      return { ...base, html: null, omittedReason: "empty_response" };
    }

    return { ...base, html, omittedReason: null };
  } catch (err) {
    // One section failing must not cost the reader the other two, and must not
    // be papered over with written-in-advance prose.
    log.warn(
      { err, customerId: context.attribution.customerId, section: key },
      "copilot-readiness-narrative: section generation failed — omitted rather than substituted",
    );
    return { ...base, html: null, omittedReason: "generation_failed" };
  }
}

/**
 * Generate all three prose sections for one real customer.
 *
 * Grounded in `buildWarRoomPillarStats(customerId)` and `computeCopilotGate(customerId)`
 * — the same two computations the Reveal and this report's own pure-data
 * sections read, so the prose and the tables beside it cannot disagree about
 * the same tenant.
 *
 * Never throws for a thin or empty tenant: that is a real state with a real,
 * honest rendering. It throws only if the underlying real data cannot be read
 * at all, which the route surfaces as an error rather than an empty report.
 */
export async function generateCopilotReadinessNarrative(params: {
  readonly customerId: number;
  readonly tenantName: string;
  readonly attribution: ReadinessNarrativeAttribution;
}): Promise<ReadinessNarrativeResult> {
  const [payload, gate] = await Promise.all([
    buildWarRoomPillarStats(params.customerId),
    computeCopilotGate(params.customerId),
  ]);

  const gateView = { score: gate.score, threshold: gate.threshold, status: gate.status };

  const sections = await Promise.all(
    READINESS_NARRATIVE_SECTIONS.map((key) =>
      generateSection(key, collectSectionFacts(key, payload.pillars), {
        tenantName: params.tenantName,
        gate: gateView,
        attribution: params.attribution,
      }),
    ),
  );

  log.info(
    {
      customerId: params.customerId,
      generated: sections.filter((s) => s.html !== null).length,
      omitted: sections.filter((s) => s.html === null).map((s) => `${s.key}:${s.omittedReason}`),
    },
    "copilot-readiness-narrative: sections resolved",
  );

  return {
    sections,
    gate: gateView,
    scannedCheckCount: payload.scannedCheckCount,
    scannedPackageKeys: payload.scannedPackageKeys,
    generatedAt: payload.generatedAt,
  };
}

/** Exported for tests — the fact extraction is the never-fabricate guarantee. */
export const __testables = { collectSectionFacts, formatStatValue, gateBlock, isRealStat };
