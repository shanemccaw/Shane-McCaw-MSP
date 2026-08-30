/**
 * narrative-grounding.ts — the never-fabricate machinery every live-rendered
 * report's prose sections are built on (#409, extracted in #343).
 *
 * WHY THIS EXISTS
 * ---------------
 * `copilot-readiness-narrative-generator.ts` established the pattern: structured
 * real data in, one attributed Anthropic call per section, an HTML fragment out,
 * and a hard guarantee — enforced in code rather than only in the prompt — that
 * the model is never HANDED a number the platform does not hold. #343 ports a
 * second report onto that pattern (Security Posture & Blast Radius), and a
 * second copy of the guarantee is a second place for it to rot. So the parts
 * that are genuinely about the guarantee, not about a particular report, live
 * here and are imported by both.
 *
 * WHAT IS SHARED AND WHAT IS NOT
 * ------------------------------
 * Shared: what counts as a real fact, how a real value is rendered for the
 * model, how the missing checks are named, the Gate block, the fact floor, and
 * the HTML sanitising. All pure, all testable without a database.
 *
 * NOT shared: which pillars ground which section, the prompt bodies, the section
 * headings, and the shape of each report's own wire payload. Those are what
 * makes each report the report it is, and folding them in here would produce one
 * module that has to know about every document.
 *
 * THE RULE, RESTATED SO IT CANNOT BE LOST IN THE EXTRACTION
 * ---------------------------------------------------------
 *   • A `PillarStat` with a null `value` NEVER reaches the model as a number.
 *     It is listed separately, by its real `monitor_checks` key and the
 *     resolver's own machine reason (`no_data`, `not_in_scan_package`,
 *     `license_gap`, …), under an instruction never to speak to it. That
 *     distinction is the whole of #341 and it survives into the prose.
 *   • An unavailable stat counts toward `missingChecks`, never toward
 *     `factCount`, so a tenant whose checks all failed to collect cannot reach
 *     the fact floor on the strength of its own gaps.
 *   • A section below the floor is not generated at all — no call, no template,
 *     no boilerplate paragraph, no "generic advice" fallback anywhere.
 */

import type { PillarSummaryCard, PillarSummaryKey, PillarStat } from "./pillar-summary-stats.ts";

/**
 * Why a section carries no prose. Machine-stable, so a viewer can say WHICH
 * kind of nothing it is rather than printing one blanket placeholder — the same
 * distinction `refineStatUnavailability` draws for stats (#341).
 */
export type NarrativeOmission = "no_real_data" | "generation_failed" | "empty_response";

/**
 * One check a section wanted and did not get, with the resolver's own machine
 * reason.
 *
 * `licenseFeature` rides along ONLY when the reason is `license_gap`, carrying
 * the real add-on name the tenant's own scan reported (`PillarStat
 * .licenseFeature`). #451 renders those under their own Upgrade Opportunity
 * category rather than in the generic "could not measure" list, and naming the
 * tier from the tenant's own response is what keeps that copy factual instead of
 * a per-check guess.
 */
export interface MissingCheck {
  readonly checkKey: string;
  readonly reason: string;
  readonly licenseFeature?: string;
}

/** Everything real a section has, rendered into the blocks its prompt takes. */
export interface SectionFacts {
  readonly factCount: number;
  readonly pillarBlock: string;
  readonly statBlock: string;
  readonly findingBlock: string;
  readonly missingBlock: string;
  readonly missingChecks: readonly MissingCheck[];
}

/** A stat the model may cite: it has a real, finite number behind it. */
export function isRealStat(stat: PillarStat): boolean {
  return typeof stat.value === "number" && Number.isFinite(stat.value);
}

/**
 * Render one real stat value. Deliberately no rounding, bucketing or
 * "approximately" — the number the reader sees in the table beside this prose
 * is the number the model is given.
 */
export function formatStatValue(stat: PillarStat): string {
  const value = stat.value as number;
  if (stat.unit === "percent") return `${value}%`;
  if (stat.unit === "currency") return `$${value.toLocaleString("en-US")}`;
  return value.toLocaleString("en-US");
}

/**
 * What a block says when it has nothing.
 *
 * Named constants, not inline literals, for one reason that matters: the block
 * these sit in is handed to a model, and "leave the token blank" is how a model
 * ends up filling the gap from its own priors. They are also the exact strings
 * `withExtraStats` tests for when deciding whether it is appending to real lines
 * or replacing a placeholder — a comparison a reworded literal would silently
 * break.
 */
const NO_PILLARS = "No pillar in scope for this section carries a score.";
const NO_STATS =
  "No measured figure in scope for this section has a value. Do not cite any number here.";
const NO_FINDINGS =
  "No critical or warning finding was recorded for the pillars in scope. Do not describe any finding.";
const NO_MISSING = "None — every check in scope for this section reported.";

function missingLines(missing: readonly MissingCheck[]): string {
  return missing.map((m) => `- ${m.checkKey} (${m.reason})`).join("\n");
}

/**
 * Everything real the given pillars hold, and nothing they do not.
 *
 * A "fact" is one of three things, all of which the platform genuinely holds:
 * a pillar with a real display score, a stat with a real value, or a real
 * `msp_diagnostic_findings` row. Nothing else counts — see the header for why
 * an unavailable stat is deliberately not one of them.
 */
export function collectFactsForPillars(
  pillars: readonly PillarSummaryKey[],
  cards: readonly PillarSummaryCard[],
): SectionFacts {
  const wanted = new Set<string>(pillars);
  const relevant = cards.filter((c) => wanted.has(c.pillar));

  const pillarLines: string[] = [];
  const statLines: string[] = [];
  const findingLines: string[] = [];
  const missing: MissingCheck[] = [];
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
        missing.push({
          checkKey: stat.checkKey,
          reason: stat.unavailableReason ?? "no_data",
          // Only ever the stat's own value — never inferred from the check key.
          ...(stat.licenseFeature ? { licenseFeature: stat.licenseFeature } : {}),
        });
      }
    }

    for (const finding of card.findings) {
      findingLines.push(`- [${finding.severity}] ${card.pillar} · ${finding.checkKey}: ${finding.title}`);
      factCount += 1;
    }
  }

  return {
    factCount,
    pillarBlock: pillarLines.length ? pillarLines.join("\n") : NO_PILLARS,
    statBlock: statLines.length ? statLines.join("\n") : NO_STATS,
    findingBlock: findingLines.length ? findingLines.join("\n") : NO_FINDINGS,
    missingBlock: missing.length ? missingLines(missing) : NO_MISSING,
    missingChecks: missing,
  };
}

/**
 * Fold extra real stats — ones the War Room payload does not carry, resolved by
 * a report's own generator — into a section's facts.
 *
 * Applies exactly the same rule as `collectFactsForPillars`: a real value adds a
 * fact and a line, an unavailable one adds a named missing check and nothing
 * else. It exists so a report that needs a figure outside the 28 War Room stats
 * cannot quietly acquire a second, laxer path to the model.
 *
 * `qualifier` is the label the stat lines are prefixed with, standing in for the
 * pillar name the card-derived lines carry.
 */
export function withExtraStats(
  facts: SectionFacts,
  qualifier: string,
  stats: readonly PillarStat[],
): SectionFacts {
  if (stats.length === 0) return facts;

  const statLines: string[] = [];
  const missing: MissingCheck[] = [];
  let added = 0;

  for (const stat of stats) {
    if (isRealStat(stat)) {
      statLines.push(`- ${qualifier} · ${stat.label}: ${formatStatValue(stat)}`);
      added += 1;
    } else if (stat.checkKey) {
      missing.push({
        checkKey: stat.checkKey,
        reason: stat.unavailableReason ?? "no_data",
        ...(stat.licenseFeature ? { licenseFeature: stat.licenseFeature } : {}),
      });
    }
  }

  if (added === 0 && missing.length === 0) return facts;

  const allMissing = [...facts.missingChecks, ...missing];
  // The placeholder is REPLACED, never appended to: "no measured figure has a
  // value" sitting above two real values is a contradiction handed straight to
  // the model.
  const statBlock = !statLines.length
    ? facts.statBlock
    : facts.statBlock === NO_STATS
      ? statLines.join("\n")
      : `${facts.statBlock}\n${statLines.join("\n")}`;

  return {
    factCount: facts.factCount + added,
    pillarBlock: facts.pillarBlock,
    statBlock,
    findingBlock: facts.findingBlock,
    missingBlock: allMissing.length ? missingLines(allMissing) : facts.missingBlock,
    missingChecks: allMissing,
  };
}

/**
 * The real Copilot Gate, stated for the model in terms it cannot round off.
 *
 * A null score is not a zero and not a fail: it means no evaluable rule fed the
 * tenant's Copilot pillar, so there is no readiness figure and no verdict, and
 * the model is told so outright.
 */
export function gateBlock(gate: {
  score: number | null;
  threshold: number;
  status: string | null;
}): string {
  if (gate.score === null) {
    return `NO SCORE. No evaluable rule fed this tenant's Copilot pillar, so there is no readiness figure and no verdict. The Gate threshold is ${gate.threshold}. Do not state a score, a gap or a Go/No-Go verdict.`;
  }
  const gap = gate.threshold - gate.score;
  const verdict = gate.status === "go" ? "cleared" : "not cleared";
  return gap > 0
    ? `Score ${gate.score}/100 against a Gate of ${gate.threshold} — ${verdict}. The gap is exactly ${gap} points. Never quote a different gap.`
    : `Score ${gate.score}/100 against a Gate of ${gate.threshold} — ${verdict}. The tenant is at or above the Gate; there is no gap to close.`;
}

/**
 * The floor below which a section is not generated at all.
 *
 * ONE real fact. Not zero — a section built from literally nothing would be the
 * model writing from its own priors, which is the fabrication this exists to
 * prevent — and not higher, because a tenant with one real finding deserves one
 * honest sentence about it rather than a blanket "unavailable" that hides a real
 * result. The three-facts-is-thin case is handled by the prompt's own length
 * rule, not by suppression.
 */
export const MIN_FACTS_FOR_NARRATIVE = 1;

/** Same defence-in-depth as every sibling call site: this HTML is injected into a live page. */
export function sanitizeNarrativeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(iframe|object|embed|link|meta)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "");
}

export function stripFence(text: string): string {
  return text.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

/**
 * Fill a prompt template from a section's real facts.
 *
 * Every token a shared prompt body can carry, filled in one place, so a report
 * cannot forget one and ship `{{missingBlock}}` verbatim to the model.
 */
export function renderNarrativePrompt(
  template: string,
  values: {
    readonly tenantName: string;
    readonly facts: SectionFacts;
    readonly gate?: { score: number | null; threshold: number; status: string | null };
  },
): string {
  return template
    .replace(/\{\{tenantName\}\}/g, values.tenantName)
    .replace(/\{\{pillarBlock\}\}/g, values.facts.pillarBlock)
    .replace(/\{\{statBlock\}\}/g, values.facts.statBlock)
    .replace(/\{\{findingBlock\}\}/g, values.facts.findingBlock)
    .replace(/\{\{missingBlock\}\}/g, values.facts.missingBlock)
    .replace(/\{\{gateBlock\}\}/g, values.gate ? gateBlock(values.gate) : "")
    .replace(/\{\{factCount\}\}/g, String(values.facts.factCount));
}
