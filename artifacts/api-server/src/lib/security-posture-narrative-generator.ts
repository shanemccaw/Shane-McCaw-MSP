/**
 * security-posture-narrative-generator.ts
 *
 * The three AI-written prose sections of the Microsoft 365 Security Posture &
 * Blast Radius Report (#343) — the Security Posture Summary's opening
 * paragraph, the Data Exposure & Blast Radius section's causal explanation, and
 * the Copilot Readiness Impact section's connection to the Gate score.
 *
 * SAME PATTERN AS copilot-readiness-narrative-generator.ts, DELIBERATELY
 * ---------------------------------------------------------------------
 * Structured real data in, one attributed Anthropic call per section (routed
 * through `withAiDevResponseCache`, #185), a prompt body loaded through
 * `prompt-loader.ts` so Shane can edit it without a deploy, an HTML fragment
 * out, sanitised the same way. Nothing new is invented about how the platform
 * calls Anthropic; this is a fifth call site of an existing shape, and the
 * never-fabricate machinery is IMPORTED from `narrative-grounding.ts` rather
 * than re-implemented, so the guarantee cannot drift between the two reports.
 *
 * WHAT THE GROUNDING REALLY IS
 * ----------------------------
 * `buildPillarSummary(customerId)` — the same function, on the same
 * customer, that `GET /portal/pillars` serves to the Reveal
 * and to this report's own pure-data sections, so the prose and the tables
 * beside it cannot disagree about the same tenant. The Gate is
 * `computeCopilotGate(customerId)` — the engine's Copilot pillar (#358/#359).
 *
 * THE ONE THING THIS ROUTE RESOLVES THAT THE WAR ROOM PAYLOAD DOES NOT
 * --------------------------------------------------------------------
 * Microsoft Secure Score. It is a real registry metric (`security.secureScore`,
 * over the real `security:secure-score` check) with a real resolver branch in
 * `dashboard-resolvers.ts`, and the Security Posture Summary is the one place in
 * the platform that has to show it — but it is NOT one of
 * `PILLAR_STAT_SPECS`' 28 stats, so nothing puts it on the
 * `/portal/pillars` wire.
 *
 * It is resolved HERE rather than added to that spec list, and that is a
 * deliberate call: the spec list is consumed by the War Room security card, by
 * the Reveal's pillar chips, and — through `collectSectionFacts` — by the
 * Copilot Readiness Report's own `safety` narrative, whose scope is
 * governance + security + compliance. Adding a stat there would silently change
 * the prose of a shipped report, which #343 explicitly must not do. So it is
 * resolved through the SAME `getMetric` → `resolveMetric` →
 * `statFromMetricResult` → `refineStatUnavailability` path those stats use —
 * one extra resolution, not a second, laxer source of truth — and travels down
 * this route's own payload.
 *
 * WHAT THIS REPORT DROPS, AND WHY
 * -------------------------------
 * The design's "Security Drift & Violations" section, and the "Security drift"
 * row inside its Summary, are absent. Same reasoning as the Copilot Readiness
 * Report's dropped "Copilot Drift & Violations": drift is a diff against a
 * recorded baseline, and on a first scan there is none — the registry's drift
 * metrics (`drift:ca-policy`, `security.secureScoreDriftCount`, …) are not among
 * the stats this payload resolves, and the design's copy for that section
 * ("6 signals raised over 90 days · none triaged · no baseline to compare
 * against") is its stand-in tenant's, not any real customer's. There is nothing
 * real to put there, so it is absent rather than approximated.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getMetric } from "@workspace/dashboard-registry";
import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { withAiDevResponseCache } from "./ai-dev-response-cache.ts";
import { getPrompt } from "./prompt-loader.ts";
import { logger } from "./logger.ts";
import { computeCopilotGate } from "./copilot-gate.ts";
import { resolveMetric } from "./dashboard-resolvers.ts";
import { fetchScannedCheckKeys } from "./pillar-coverage.ts";
import {
  SECURITY_POSTURE_BLAST_RADIUS_PROMPT,
  SECURITY_POSTURE_COPILOT_IMPACT_PROMPT,
  SECURITY_POSTURE_SUMMARY_PROMPT,
} from "./security-posture-prompts.ts";
import {
  MIN_FACTS_FOR_NARRATIVE,
  collectFactsForPillars,
  renderNarrativePrompt,
  sanitizeNarrativeHtml,
  stripFence,
  withExtraStats,
  type MissingCheck,
  type NarrativeOmission,
  type SectionFacts,
} from "./narrative-grounding.ts";
import {
  buildPillarSummary,
  refineStatUnavailability,
  statFromMetricResult,
  type PillarSummaryKey,
  type PillarStat,
  type PillarStatSpec,
} from "./pillar-summary-stats.ts";

const log = logger.child({ channel: "engine.dashboard" });

/** The three prose sections, in the order the report renders them. */
export const SECURITY_POSTURE_NARRATIVE_SECTIONS = ["summary", "blastRadius", "copilotImpact"] as const;
export type SecurityPostureSectionKey = (typeof SECURITY_POSTURE_NARRATIVE_SECTIONS)[number];

export type SecurityPostureOmission = NarrativeOmission;

export interface SecurityPostureNarrativeSection {
  readonly key: SecurityPostureSectionKey;
  readonly heading: string;
  /** A semantic HTML fragment, or null when nothing real could ground it. */
  readonly html: string | null;
  readonly omittedReason: SecurityPostureOmission | null;
  /** How many real facts grounded it — the honest measure of its depth. */
  readonly factCount: number;
  /**
   * The real `monitor_checks` keys this section wanted and did not get, with
   * the resolver's own reason. Surfaced so a thin section can say what is
   * missing instead of reading as a thin tenant.
   */
  readonly missingChecks: readonly MissingCheck[];
}

/**
 * One extra stat this route resolves for the report's structural rows, in the
 * SAME shape `/portal/pillars` sends its own — so the client can run it
 * through the exact helpers (`isRealStat`, `formatStat`, `buildRows`) it already
 * uses for every other row, instead of a parallel set that could classify an
 * unavailable value differently.
 */
export interface SecurityPostureExtraStat {
  readonly id: string;
  readonly label: string;
  readonly unit: "count" | "percent" | "currency";
  readonly value: number | null;
  readonly unavailableReason?: string;
  readonly licenseFeature?: string;
  readonly checkKey: string | null;
}

export interface SecurityPostureNarrativeResult {
  readonly sections: readonly SecurityPostureNarrativeSection[];
  /** Real security figures the War Room payload does not carry — see the header. */
  readonly stats: readonly SecurityPostureExtraStat[];
  /** The real Gate score / threshold / verdict this narrative was grounded in. */
  readonly gate: { readonly score: number | null; readonly threshold: number; readonly status: string | null };
  /** Real curated check count across every package this customer has been scanned with. */
  readonly scannedCheckCount: number;
  readonly scannedPackageKeys: readonly string[];
  readonly generatedAt: string;
}

export interface SecurityPostureAttribution {
  readonly mspId: number | null;
  readonly customerId: number | null;
  readonly triggerSource: string;
}

/* ------------------------------------------------------------------ *
 * Fact extraction — real values only
 * ------------------------------------------------------------------ */

/**
 * Which pillars ground which section. Not a new grouping: these are the same
 * `PILLAR_SUMMARY_KEYS` the payload already carries, selected by what each
 * section is actually about.
 *
 * `blastRadius` reads governance and compliance alongside security because the
 * blast-radius figure genuinely lives across all three — `security.blastRadius`
 * and `governance.exposure` are the SAME metric (`copilot.overshareExposureCount`)
 * shown on two cards, and the site counts that give it scale are governance's.
 */
const SECTION_PILLARS: Record<SecurityPostureSectionKey, readonly PillarSummaryKey[]> = {
  summary: ["security"],
  blastRadius: ["security", "governance", "compliance"],
  copilotImpact: ["security", "copilot"],
};

const SECTION_HEADINGS: Record<SecurityPostureSectionKey, string> = {
  summary: "Security Posture Summary",
  blastRadius: "Data Exposure & Blast Radius",
  copilotImpact: "Copilot Readiness Impact",
};

const SECTION_PROMPT_KEYS: Record<SecurityPostureSectionKey, string> = {
  summary: "assessment-security-posture-summary",
  blastRadius: "assessment-security-posture-blast-radius",
  copilotImpact: "assessment-security-posture-copilot-impact",
};

/**
 * The canonical prompt bodies. Loaded from `security-posture-prompts.ts` — a
 * leaf module `prompt-loader.ts` also reads, so the fallback here and the seed
 * in the AI Prompts admin UI are ONE string rather than two copies free to
 * drift (the exact trap #270 recorded). A DB row of the same key still wins.
 */
const PROMPT_FALLBACKS: Record<SecurityPostureSectionKey, string> = {
  summary: SECURITY_POSTURE_SUMMARY_PROMPT,
  blastRadius: SECURITY_POSTURE_BLAST_RADIUS_PROMPT,
  copilotImpact: SECURITY_POSTURE_COPILOT_IMPACT_PROMPT,
};

/* ------------------------------------------------------------------ *
 * Secure Score — the one metric resolved here rather than upstream
 * ------------------------------------------------------------------ */

/**
 * The extra metrics this route resolves, as `PillarStatSpec`s so they go
 * through `statFromMetricResult` unchanged.
 *
 * `replaces` is a required field on that spec and means "the fictional
 * `HERO_PHASE` stat this replaces" — these replace nothing, because they were
 * never on a War Room card. Said outright rather than left blank so a reader of
 * the wire payload is not left wondering which card they came off.
 */
const EXTRA_STAT_SPECS: readonly PillarStatSpec[] = [
  {
    id: "security.secureScore",
    label: "Microsoft Secure Score",
    unit: "percent",
    source: { kind: "metric", metricKey: "security.secureScore" },
    replaces: "(not a War Room card stat — resolved for the Security Posture report only)",
  },
];

/**
 * Resolve the extra stats for one customer.
 *
 * Never throws: a resolver failure or an unknown metric key becomes a stat with
 * a null value and the resolver's own machine reason, exactly as it would on the
 * War Room path — the report then renders it as a named gap rather than losing
 * the row silently.
 */
async function resolveExtraStats(
  customerId: number,
  mspId: number,
  scannedCheckKeys: ReadonlySet<string> | null,
): Promise<PillarStat[]> {
  const ctx = { customerId, mspId };
  return Promise.all(
    EXTRA_STAT_SPECS.map(async (spec) => {
      const metricKey = spec.source.kind === "metric" ? spec.source.metricKey : spec.id;
      const def = getMetric(metricKey);
      if (!def) {
        // A spec naming a metric the registry doesn't have is a wiring bug, not
        // a tenant with no data — say so loudly rather than rendering a blank.
        log.error({ metricKey }, "security-posture-narrative: spec references an unknown registry metric");
        return refineStatUnavailability(statFromMetricResult(spec, metricKey, null), scannedCheckKeys);
      }
      const result = await resolveMetric(def, ctx).catch((err: unknown) => {
        log.warn({ err, metricKey }, "security-posture-narrative: metric resolution threw");
        return null;
      });
      return refineStatUnavailability(statFromMetricResult(spec, def.sourceKey, result), scannedCheckKeys);
    }),
  );
}

/** The wire shape, dropping the two fields only the War Room card uses. */
function toExtraStat(stat: PillarStat): SecurityPostureExtraStat {
  return {
    id: stat.id,
    label: stat.label,
    unit: stat.unit,
    value: stat.value,
    ...(stat.unavailableReason ? { unavailableReason: stat.unavailableReason } : {}),
    ...(stat.licenseFeature ? { licenseFeature: stat.licenseFeature } : {}),
    checkKey: stat.checkKey,
  };
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

async function generateSection(
  key: SecurityPostureSectionKey,
  facts: SectionFacts,
  context: {
    readonly tenantName: string;
    readonly gate: { score: number | null; threshold: number; status: string | null };
    readonly attribution: SecurityPostureAttribution;
  },
): Promise<SecurityPostureNarrativeSection> {
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
      "security-posture-narrative: section has no real facts — omitted rather than generated",
    );
    return { ...base, html: null, omittedReason: "no_real_data" };
  }

  const rawTemplate = await getPrompt(SECTION_PROMPT_KEYS[key], PROMPT_FALLBACKS[key]);
  const prompt = renderNarrativePrompt(rawTemplate, {
    tenantName: context.tenantName,
    facts,
    gate: context.gate,
  });

  try {
    const aiResponse = await withAiDevResponseCache(
      {
        feature: `security_posture_narrative_${key}`,
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
        nodeType: "security_posture_narrative",
        feature: `security_posture_narrative_${key}`,
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
        "security-posture-narrative: output hit max_tokens — section may be truncated",
      );
    }

    const block = aiResponse.content.find((b) => b.type === "text");
    const rawText = block && block.type === "text" ? block.text : "";
    const html = sanitizeNarrativeHtml(stripFence(rawText));

    if (!html) {
      log.warn(
        { customerId: context.attribution.customerId, section: key },
        "security-posture-narrative: model returned an empty section",
      );
      return { ...base, html: null, omittedReason: "empty_response" };
    }

    return { ...base, html, omittedReason: null };
  } catch (err) {
    // One section failing must not cost the reader the other two, and must not
    // be papered over with written-in-advance prose.
    log.warn(
      { err, customerId: context.attribution.customerId, section: key },
      "security-posture-narrative: section generation failed — omitted rather than substituted",
    );
    return { ...base, html: null, omittedReason: "generation_failed" };
  }
}

/**
 * Generate all three prose sections, plus the extra structural stats, for one
 * real customer.
 *
 * Never throws for a thin or empty tenant: that is a real state with a real,
 * honest rendering. It throws only if the underlying real data cannot be read at
 * all, which the route surfaces as an error rather than an empty report.
 */
export async function generateSecurityPostureNarrative(params: {
  readonly customerId: number;
  readonly tenantName: string;
  readonly attribution: SecurityPostureAttribution;
}): Promise<SecurityPostureNarrativeResult> {
  const [payload, gate, tenantRow, scanned] = await Promise.all([
    buildPillarSummary(params.customerId),
    computeCopilotGate(params.customerId),
    db
      .select({ mspId: tenantsTable.mspId })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, params.customerId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    // The same set the War Room stats are refined against, so a Secure Score
    // that was never scanned says `not_in_scan_package` rather than the
    // ambiguous `no_data` — the distinction #341 exists to draw.
    fetchScannedCheckKeys(params.customerId),
  ]);

  const gateView = { score: gate.score, threshold: gate.threshold, status: gate.status };

  // `mspId` satisfies `ResolveContext` only; every metric here is
  // `scope: "customer"`, so it never drives a value.
  const extras = await resolveExtraStats(params.customerId, tenantRow?.mspId ?? 0, scanned.checkKeys);

  const sections = await Promise.all(
    SECURITY_POSTURE_NARRATIVE_SECTIONS.map((key) => {
      const facts = collectFactsForPillars(SECTION_PILLARS[key], payload.pillars);
      // Secure Score grounds the Summary, which is the section that states what
      // the posture IS. It is folded in through the SAME never-fabricate rule
      // the card stats go through — a real value is a fact and a line, an
      // unavailable one is a named missing check and nothing else.
      const grounded = key === "summary" ? withExtraStats(facts, "security", extras) : facts;
      return generateSection(key, grounded, {
        tenantName: params.tenantName,
        gate: gateView,
        attribution: params.attribution,
      });
    }),
  );

  log.info(
    {
      customerId: params.customerId,
      generated: sections.filter((s) => s.html !== null).length,
      omitted: sections.filter((s) => s.html === null).map((s) => `${s.key}:${s.omittedReason}`),
    },
    "security-posture-narrative: sections resolved",
  );

  return {
    sections,
    stats: extras.map(toExtraStat),
    gate: gateView,
    scannedCheckCount: payload.scannedCheckCount,
    scannedPackageKeys: payload.scannedPackageKeys,
    generatedAt: payload.generatedAt,
  };
}

/** Exported for tests — the fact extraction is the never-fabricate guarantee. */
export const __testables = { EXTRA_STAT_SPECS, SECTION_PILLARS, resolveExtraStats, toExtraStat };
