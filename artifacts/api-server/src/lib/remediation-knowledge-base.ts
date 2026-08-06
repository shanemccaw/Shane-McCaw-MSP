/**
 * remediation-knowledge-base.ts
 *
 * Git #493 — the Remediation Plan deliverable's per-finding "how do I actually
 * fix this" appendix, and the provenance rule that governs it.
 *
 * THE PROBLEM THIS EXISTS FOR
 * ───────────────────────────
 * The Remediation Plan is a document a paying customer runs PowerShell out of.
 * Every command in it used to come from an LLM (`remediation-detail-generator.ts`)
 * with no verification step against real, current Microsoft cmdlet syntax. An
 * invented parameter name in a document a customer pastes into a production
 * tenant is the kind of error the platform's credibility does not survive.
 *
 * THE RULE
 * ────────
 * For each finding, the human-verified `remediation_knowledge_base` row for its
 * `monitor_checks.key` is the default source of truth and is rendered directly,
 * with NO AI call. Only when there is no published row does the existing AI
 * generator run — and its output carries an unmissable amber
 * "AI-GENERATED GUIDANCE — VERIFY BEFORE RUNNING" banner that verified content
 * never has. The two are never blended and never look alike: a customer can
 * always tell, at a glance, which kind of content they are reading.
 *
 * WHAT IS DELIBERATELY ABSENT
 * ───────────────────────────
 * Nothing here (or anywhere else) WRITES to `remediation_knowledge_base`.
 * Auto-populating it from AI output would defeat the entire point of the table.
 * Rows are authored by hand against real Microsoft documentation, as separate
 * content work.
 *
 * VISUAL CONTRACT
 * ───────────────
 * Every block is fully self-contained inline CSS with BOTH its own background
 * and its own foreground colours. That is load-bearing, not decoration: this
 * HTML lands in `insights_generated_documents.html_content`, which is rendered
 * in the customer's DARK Document Viewer (`.cj-doc-body`, copilot-journey.css)
 * as well as in light admin previews and PDFs. A block that inherited its
 * colours would be legible in one and unreadable — or worse, mis-coloured, so
 * the green/amber distinction collapses — in the other.
 */

import { db, monitorChecksTable, remediationKnowledgeBaseTable, type RemediationKnowledgeBaseRow, type RemediationKbStep } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  generateRemediationDetail,
  type IssueCategory,
  type IssueSeverity,
  type RemediationStep,
} from "./remediation-detail-generator";
import { logger } from "./logger";

// Its own leaf channel, not `engine.document-generator`: the question this
// subsystem exists to make answerable — "was the remediation content in the
// document a customer just ran commands from VERIFIED, or AI-generated?" — is
// an audit question about provenance, and it must be answerable without
// filtering the whole document pipeline's noise out first.
const log = logger.child({ channel: "engine.remediation-kb" });

/**
 * How many findings get an appendix entry. Matches the `slice(0, 15)`
 * document-engine.ts already applies when building the narrative prompt's
 * findings block, so the appendix covers EXACTLY the findings the narrative
 * discusses — never a superset the prose never mentions, never a subset that
 * leaves a discussed finding with no fix instructions.
 */
export const REMEDIATION_APPENDIX_MAX_FINDINGS = 15;

/** How many AI fallback generations run at once. Bounded so a document with many uncovered findings does not fire 15 simultaneous model calls. */
const AI_FALLBACK_CONCURRENCY = 4;

/**
 * The subset of a finding this module needs. Structurally satisfied by
 * `CategorizedFinding` (tenant-signals.ts) — declared locally rather than
 * imported so the renderers stay unit-testable without dragging the tenant
 * profile builder's db imports into the test.
 */
export interface RemediationAppendixFinding {
  text: string;
  /** `monitor_checks.key`, or null for a finding with no check behind it (every script-run finding). */
  checkKey: string | null;
  /** Verbatim matched severity, e.g. "critical" / "warning". Null when unknown. */
  severity: string | null;
  /** Item count the check reported, when it emitted one. */
  itemCount: number | null;
  /** `signal_derivation_rules.pillar` values for the check. Empty = not categorizable. */
  categories: string[];
}

export interface BuildRemediationAppendixParams {
  findings: RemediationAppendixFinding[];
  /** `tenants.id` — the customer this document is for. */
  mspCustomerId: number;
  /** The MSP that bills for any AI fallback call. Null = unattributed. */
  mspId: number | null;
  docTypeKey: string;
  /**
   * FALSE on the dry-run/preview path. A preview must make no AI call and
   * report a real `no-ai-call` cost, so uncovered findings render a neutral
   * placeholder saying what WOULD be generated instead of generating it.
   */
  allowAiFallback: boolean;
  /** Attribution passthrough, e.g. "document-engine" / "document-engine:dry-run". */
  triggerSource: string;
}

export interface BuildRemediationAppendixResult {
  /** The appendix HTML, or "" when there was nothing to render. */
  html: string;
  /** Findings rendered from a published knowledge-base row. No AI call was made for these. */
  verifiedCount: number;
  /** Findings rendered from a real AI fallback generation, under the amber banner. */
  aiGeneratedCount: number;
  /** Findings that WOULD have been AI-generated but weren't, because this was a preview. */
  pendingCount: number;
  /** Findings whose AI fallback call threw. Rendered as an explicit "not available" block, never silently dropped. */
  failedCount: number;
  /** Findings dropped by REMEDIATION_APPENDIX_MAX_FINDINGS. Reported so a cap is never silent. */
  truncatedCount: number;
  /** Check keys that had a published knowledge-base row. */
  coveredCheckKeys: string[];
  /** Check keys that did NOT — i.e. the real, current Phase-N content backlog, straight off a live generation. */
  uncoveredCheckKeys: string[];
}

// ── Provenance ────────────────────────────────────────────────────────────────

type Provenance = "verified" | "ai" | "pending" | "failed";

// ── Escaping ──────────────────────────────────────────────────────────────────

/**
 * Every piece of knowledge-base and AI text goes through this before reaching
 * the document. KB rows are hand-authored (so a stray `<` in a PowerShell
 * comparison operator is entirely likely) and AI output is model-authored — in
 * neither case is the text trusted markup.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Shared styling tokens ─────────────────────────────────────────────────────

const FONT = "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const THEME = {
  verified: {
    surface: "#ecfdf5",
    border: "#a7f3d0",
    rail: "#059669",
    bannerBg: "#047857",
    bannerInk: "#ffffff",
    heading: "#064e3b",
    body: "#065f46",
    muted: "#047857",
  },
  ai: {
    surface: "#fffbeb",
    border: "#fcd34d",
    rail: "#b45309",
    bannerBg: "#b45309",
    bannerInk: "#ffffff",
    heading: "#7c2d12",
    body: "#78350f",
    muted: "#92400e",
  },
  neutral: {
    surface: "#f1f5f9",
    border: "#cbd5e1",
    rail: "#64748b",
    bannerBg: "#475569",
    bannerInk: "#ffffff",
    heading: "#0f172a",
    body: "#334155",
    muted: "#475569",
  },
} as const;

type ThemeKey = keyof typeof THEME;

function labelStyle(color: string): string {
  return `margin:18px 0 6px;font:700 10px/1.4 ${FONT};letter-spacing:.16em;text-transform:uppercase;color:${color}`;
}

function bodyStyle(color: string): string {
  return `margin:0;font:400 14px/1.65 ${FONT};color:${color}`;
}

/** A code block. Dark-on-dark-navy in both themes, so it reads identically in the customer's dark viewer and in a light PDF. */
function renderCode(code: string, language: string | undefined, unverified: boolean): string {
  const tag = unverified
    ? `<div style="margin:10px 0 0;font:700 10px/1.4 ${FONT};letter-spacing:.12em;text-transform:uppercase;color:${THEME.ai.muted}">Unverified command &mdash; check the syntax before running</div>`
    : "";
  const lang = language?.trim() ? `<div style="margin:10px 0 0;font:600 10px/1.4 ${FONT};letter-spacing:.12em;text-transform:uppercase;color:#64748b">${escapeHtml(language.trim())}</div>` : "";
  return (
    tag + lang +
    `<pre style="margin:6px 0 0;padding:14px 16px;background:#0f172a;color:#e2e8f0;border-radius:8px;` +
    `font:13px/1.6 ${MONO};white-space:pre-wrap;word-break:break-word;overflow-x:auto">` +
    `<code style="font:inherit;color:inherit;background:none">${escapeHtml(code)}</code></pre>`
  );
}

function renderSteps(steps: Array<{ text: string; code?: string; codeLanguage?: string }>, theme: ThemeKey): string {
  const t = THEME[theme];
  if (steps.length === 0) return "";
  const items = steps
    .map(
      (step) =>
        `<li style="margin:0 0 14px">` +
        `<div style="${bodyStyle(t.body)}">${escapeHtml(step.text)}</div>` +
        (step.code ? renderCode(step.code, step.codeLanguage, theme === "ai") : "") +
        `</li>`,
    )
    .join("");
  return (
    `<div style="${labelStyle(t.muted)}">Steps</div>` +
    `<ol style="margin:0;padding-left:20px;color:${t.body};font:400 14px/1.65 ${FONT}">${items}</ol>`
  );
}

function renderField(label: string, value: string | null | undefined, theme: ThemeKey): string {
  if (!value || !value.trim()) return "";
  const t = THEME[theme];
  return `<div style="${labelStyle(t.muted)}">${escapeHtml(label)}</div><p style="${bodyStyle(t.body)}">${escapeHtml(value.trim())}</p>`;
}

function renderList(label: string, values: string[], theme: ThemeKey): string {
  const items = values.filter((v) => v && v.trim());
  if (items.length === 0) return "";
  const t = THEME[theme];
  return (
    `<div style="${labelStyle(t.muted)}">${escapeHtml(label)}</div>` +
    `<ul style="margin:0;padding-left:20px;color:${t.body};font:400 14px/1.65 ${FONT}">` +
    items.map((v) => `<li style="margin:0 0 6px">${escapeHtml(v.trim())}</li>`).join("") +
    `</ul>`
  );
}

/**
 * The card chrome shared by all four provenance kinds. One shell means the
 * verified and AI branches are structurally identical and differ ONLY in colour
 * and banner text — which is exactly the comparison a customer is being asked to
 * make.
 */
function renderCard(theme: ThemeKey, bannerText: string, subBanner: string | null, heading: string, inner: string): string {
  const t = THEME[theme];
  const sub = subBanner
    ? `<div style="padding:12px 20px;background:${t.border};color:${t.body};font:600 13px/1.55 ${FONT};border-bottom:1px solid ${t.rail}">${subBanner}</div>`
    : "";
  return (
    `<div style="margin:28px 0;border:1px solid ${t.border};border-left:8px solid ${t.rail};border-radius:10px;background:${t.surface};overflow:hidden">` +
    `<div style="padding:11px 20px;background:${t.bannerBg};color:${t.bannerInk};font:800 12px/1.4 ${FONT};letter-spacing:.14em;text-transform:uppercase">${bannerText}</div>` +
    sub +
    `<div style="padding:20px 22px 24px">` +
    `<h3 style="margin:0 0 10px;font:700 17px/1.35 ${FONT};color:${t.heading}">${escapeHtml(heading)}</h3>` +
    inner +
    `</div></div>`
  );
}

// ── Block renderers (pure — unit-tested directly) ─────────────────────────────

/** A finding covered by a published knowledge-base row. Rendered verbatim; no model was involved. */
export function renderVerifiedRemediationBlock(heading: string, row: RemediationKnowledgeBaseRow): string {
  const t = THEME.verified;
  const verifiedOn = row.lastVerifiedAt instanceof Date
    ? row.lastVerifiedAt.toISOString().slice(0, 10)
    : String(row.lastVerifiedAt).slice(0, 10);

  const sources = (row.sourceUrls ?? []).filter((u) => u && u.trim());
  const sourceBlock = sources.length
    ? `<div style="${labelStyle(t.muted)}">Verified against these Microsoft sources</div>` +
      `<ul style="margin:0;padding-left:20px;color:${t.body};font:400 13px/1.6 ${FONT}">` +
      sources
        .map((u) => `<li style="margin:0 0 4px"><a href="${escapeHtml(u.trim())}" style="color:#047857;text-decoration:underline;word-break:break-all">${escapeHtml(u.trim())}</a></li>`)
        .join("") +
      `</ul>`
    : "";

  const adminPath = row.adminCenterUrl?.trim() && row.adminCenterPath?.trim()
    ? `<div style="${labelStyle(t.muted)}">Admin center path</div>` +
      `<p style="${bodyStyle(t.body)}"><a href="${escapeHtml(row.adminCenterUrl.trim())}" style="color:#047857;text-decoration:underline">${escapeHtml(row.adminCenterPath.trim())}</a></p>`
    : renderField("Admin center path", row.adminCenterPath, "verified");

  const inner =
    `<p style="${bodyStyle(t.body)}">${escapeHtml(row.summary)}</p>` +
    renderList("Before you start", row.prerequisites ?? [], "verified") +
    adminPath +
    renderSteps(row.remediationSteps ?? [], "verified") +
    renderField("Expected outcome", row.expectedOutcome, "verified") +
    renderField("How to validate", row.validationStep, "verified") +
    (row.validationCommand?.trim() ? renderCode(row.validationCommand.trim(), "powershell", false) : "") +
    sourceBlock +
    `<div style="margin-top:20px;padding-top:14px;border-top:1px solid ${t.border};font:600 12px/1.5 ${FONT};color:${t.muted}">` +
    `Last verified ${escapeHtml(verifiedOn)} by ${escapeHtml(row.verifiedBy)}` +
    (row.verifiedAgainst?.trim() ? ` &middot; ${escapeHtml(row.verifiedAgainst.trim())}` : "") +
    `</div>`;

  return renderCard(
    "verified",
    "&#10003;&nbsp; Verified remediation &mdash; reviewed against Microsoft documentation",
    null,
    heading,
    inner,
  );
}

/**
 * A finding with no published knowledge-base row, filled by the existing AI
 * generator. The banner, the sub-banner, the amber surface and the per-command
 * "Unverified command" tags are all deliberate and all required: the brief was
 * a distinction a customer cannot miss, not a caption at the bottom.
 */
export function renderAiFallbackRemediationBlock(
  heading: string,
  detail: string,
  steps: RemediationStep[],
): string {
  const t = THEME.ai;
  const inner =
    `<p style="${bodyStyle(t.body)}">${escapeHtml(detail)}</p>` +
    renderSteps(steps, "ai") +
    `<div style="margin-top:20px;padding-top:14px;border-top:1px solid ${t.border};font:600 12px/1.5 ${FONT};color:${t.muted}">` +
    `No verified knowledge-base entry exists for this finding yet. Nobody has reviewed the text above.` +
    `</div>`;

  return renderCard(
    "ai",
    "&#9888;&nbsp; AI-generated guidance &mdash; verify before running",
    "Written by an AI model, <strong>not</strong> reviewed by a human and <strong>not</strong> checked against Microsoft&rsquo;s current documentation. " +
      "Treat every command below as a draft: confirm the syntax on Microsoft Learn and test it outside production before running it against this tenant.",
    heading,
    inner,
  );
}

/** Preview-only placeholder: says what WOULD be generated, without making the call that would cost money and break the dry run's `no-ai-call` cost claim. */
export function renderPendingRemediationBlock(heading: string, checkKey: string | null): string {
  const t = THEME.neutral;
  const inner =
    `<p style="${bodyStyle(t.body)}">This finding has no verified knowledge-base entry` +
    (checkKey ? ` for <code style="font:13px ${MONO}">${escapeHtml(checkKey)}</code>` : "") +
    `. When this document is generated for real, AI-generated guidance will be produced for it and rendered under the ` +
    `&ldquo;AI-generated guidance &mdash; verify before running&rdquo; banner. No model call was made for this preview.</p>`;
  return renderCard("neutral", "Preview &mdash; not yet generated", null, heading, inner);
}

/** An AI fallback that threw. Stated plainly rather than dropped, so the appendix never quietly omits a finding the narrative discusses. */
export function renderFailedRemediationBlock(heading: string): string {
  const t = THEME.neutral;
  const inner =
    `<p style="${bodyStyle(t.body)}">Step-by-step guidance could not be produced for this finding, and there is no verified ` +
    `knowledge-base entry to fall back on. The finding itself is real and is described in the body of this report &mdash; ` +
    `only the generated walkthrough is missing.</p>`;
  return renderCard("neutral", "Guidance not available", null, heading, inner);
}

// ── Header / legend ───────────────────────────────────────────────────────────

function renderAppendixHeader(verified: number, ai: number, pending: number, failed: number): string {
  const total = verified + ai + pending + failed;
  const unverified = ai + pending + failed;
  const counts = total === 0
    ? ""
    : `<p style="margin:12px 0 0;font:600 13px/1.6 ${FONT};color:#334155">` +
      `${verified} of ${total} ${total === 1 ? "finding" : "findings"} below ${verified === 1 ? "has" : "have"} verified remediation content. ` +
      (unverified > 0
        ? `The remaining ${unverified} ${unverified === 1 ? "is" : "are"} marked in amber and ${unverified === 1 ? "has" : "have"} not been reviewed by a human.`
        : `None of it is AI-generated.`) +
      `</p>`;

  return (
    `<h2 style="margin:44px 0 0;font:700 21px/1.35 ${FONT};color:#0f172a">Remediation Detail &mdash; Step by Step</h2>` +
    `<div style="margin:14px 0 0;padding:18px 20px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px">` +
    `<p style="margin:0;font:400 14px/1.65 ${FONT};color:#334155">` +
    `<strong style="color:#0f172a">Read the colour before you read the commands.</strong> Every block below is one of two kinds, and they are never mixed:</p>` +
    `<ul style="margin:12px 0 0;padding-left:0;list-style:none">` +
    `<li style="margin:0 0 10px;padding-left:14px;border-left:8px solid ${THEME.verified.rail};font:400 14px/1.6 ${FONT};color:#334155">` +
    `<strong style="color:#064e3b">Green &mdash; verified.</strong> Written and checked by a person against current Microsoft documentation. Each block carries the reviewer&rsquo;s name, the date it was last verified, and the sources it was verified against.</li>` +
    `<li style="margin:0;padding-left:14px;border-left:8px solid ${THEME.ai.rail};font:400 14px/1.6 ${FONT};color:#334155">` +
    `<strong style="color:#7c2d12">Amber &mdash; AI-generated.</strong> Produced by a model, not reviewed by anyone. Confirm the syntax and test outside production before running any of it.</li>` +
    `</ul>${counts}</div>`
  );
}

// ── Data access ───────────────────────────────────────────────────────────────

/**
 * Published knowledge-base rows for the given check keys, keyed by check key.
 * ONE query for the whole document, never one per finding.
 *
 * `status = 'published'` is applied here rather than at the call site on
 * purpose: a `draft` row is content someone started and has not signed off, and
 * rendering it under a green "verified" banner would be exactly the false claim
 * this whole subsystem exists to prevent. Drafts fall through to the labelled AI
 * fallback like any other uncovered check.
 */
export async function fetchPublishedKnowledgeBaseRows(checkKeys: string[]): Promise<Map<string, RemediationKnowledgeBaseRow>> {
  const byKey = new Map<string, RemediationKnowledgeBaseRow>();
  const unique = [...new Set(checkKeys.filter((k): k is string => !!k))];
  if (unique.length === 0) return byKey;

  const rows = await db
    .select()
    .from(remediationKnowledgeBaseTable)
    .where(and(inArray(remediationKnowledgeBaseTable.checkKey, unique), eq(remediationKnowledgeBaseTable.status, "published")));

  for (const row of rows) byKey.set(row.checkKey, row);
  return byKey;
}

/** `monitor_checks.label` for the given keys — the real human-readable name of the check, used as each block's heading. */
async function fetchCheckLabels(checkKeys: string[]): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  const unique = [...new Set(checkKeys.filter((k): k is string => !!k))];
  if (unique.length === 0) return byKey;

  const rows = await db
    .select({ key: monitorChecksTable.key, label: monitorChecksTable.label })
    .from(monitorChecksTable)
    .where(inArray(monitorChecksTable.key, unique));

  for (const row of rows) byKey.set(row.key, row.label);
  return byKey;
}

// ── Mapping the platform's own vocabulary onto the AI generator's ─────────────

/**
 * `severity_rules.severity` is free text and 100% DB-resident (there is no
 * code-side enum to switch on), while the generator's input type is a fixed
 * three-value `IssueSeverity`. This maps the values the live corpus actually
 * uses and defaults the rest to "Medium" — an unknown severity is not evidence
 * of a low-severity finding.
 */
export function toIssueSeverity(severity: string | null): IssueSeverity {
  switch ((severity ?? "").trim().toLowerCase()) {
    case "critical":
    case "high":
    case "severe":
      return "High";
    case "low":
    case "info":
    case "informational":
      return "Low";
    default:
      return "Medium";
  }
}

/**
 * `IssueCategory` is the Copilot Assessment quiz surface's own three-value
 * vocabulary (blocker / sensitivity / friction), not the monitoring pillars
 * (`signal_derivation_rules.pillar`). Only two of the pillars have an honest
 * counterpart, and they get it; everything else is "blocker", which on a
 * Remediation Plan is the accurate statement "this is something to fix".
 *
 * "sensitivity" is deliberately never derived: no monitoring pillar means
 * "data sensitivity exposure" specifically, so choosing it would be a guess
 * dressed as a classification. This value is only a prompt hint, and the block
 * it shapes is labelled unverified regardless.
 */
export function toIssueCategory(categories: string[]): IssueCategory {
  const lowered = categories.map((c) => c.trim().toLowerCase());
  if (lowered.includes("copilot") || lowered.includes("adoption")) return "friction";
  return "blocker";
}

/** The heading for a finding's block: the check's real label plus its real item count, falling back to the finding string itself. */
function headingFor(finding: RemediationAppendixFinding, checkLabels: Map<string, string>): string {
  const label = finding.checkKey ? checkLabels.get(finding.checkKey) : undefined;
  if (!label) return finding.text;
  return finding.itemCount != null
    ? `${label} (${finding.itemCount} item${finding.itemCount === 1 ? "" : "s"} flagged)`
    : label;
}

// ── Bounded-concurrency map ───────────────────────────────────────────────────

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── The appendix builder ──────────────────────────────────────────────────────

/**
 * Builds the per-finding Remediation Detail appendix.
 *
 * Order of resolution, per finding:
 *   1. Published `remediation_knowledge_base` row for its check key → rendered
 *      verbatim, green, NO model call.
 *   2. No row, `allowAiFallback` → one real `generateRemediationDetail()` call,
 *      rendered amber under the unverified banner.
 *   3. No row, preview → neutral placeholder, no model call.
 *   4. The fallback threw → neutral "not available" block. Never silently
 *      dropped: the narrative discusses this finding, so the appendix says
 *      plainly that its walkthrough is missing.
 *
 * Never throws. A failure here must not lose an otherwise-complete document.
 */
export async function buildRemediationAppendix(params: BuildRemediationAppendixParams): Promise<BuildRemediationAppendixResult> {
  const { findings, mspCustomerId, mspId, docTypeKey, allowAiFallback, triggerSource } = params;

  const empty: BuildRemediationAppendixResult = {
    html: "", verifiedCount: 0, aiGeneratedCount: 0, pendingCount: 0, failedCount: 0,
    truncatedCount: 0, coveredCheckKeys: [], uncoveredCheckKeys: [],
  };
  if (findings.length === 0) return empty;

  const truncatedCount = Math.max(0, findings.length - REMEDIATION_APPENDIX_MAX_FINDINGS);
  const scoped = findings.slice(0, REMEDIATION_APPENDIX_MAX_FINDINGS);
  if (truncatedCount > 0) {
    // Never a silent cap: a document that covers 15 of 40 findings must say so
    // in the logs, or "covered everything" is what it reads as.
    log.warn(
      { mspCustomerId, docTypeKey, findingsTotal: findings.length, findingsRendered: scoped.length, truncatedCount },
      "remediation-kb: appendix capped — findings beyond the cap have no remediation block",
    );
  }

  const checkKeys = scoped.map((f) => f.checkKey).filter((k): k is string => !!k);
  const [kbRows, checkLabels] = await Promise.all([
    fetchPublishedKnowledgeBaseRows(checkKeys),
    fetchCheckLabels(checkKeys),
  ]);

  const coveredCheckKeys: string[] = [];
  const uncoveredCheckKeys: string[] = [];

  const blocks = await mapWithConcurrency(scoped, AI_FALLBACK_CONCURRENCY, async (finding): Promise<{ html: string; provenance: Provenance }> => {
    const heading = headingFor(finding, checkLabels);
    const row = finding.checkKey ? kbRows.get(finding.checkKey) : undefined;

    if (row) {
      if (finding.checkKey) coveredCheckKeys.push(finding.checkKey);
      return { html: renderVerifiedRemediationBlock(heading, row), provenance: "verified" };
    }

    if (finding.checkKey) uncoveredCheckKeys.push(finding.checkKey);

    if (!allowAiFallback) {
      return { html: renderPendingRemediationBlock(heading, finding.checkKey), provenance: "pending" };
    }

    try {
      const result = await generateRemediationDetail(
        {
          label: heading,
          category: toIssueCategory(finding.categories),
          severity: toIssueSeverity(finding.severity),
        },
        undefined,
        { mspId, customerId: mspCustomerId, triggerSource },
      );
      return { html: renderAiFallbackRemediationBlock(heading, result.detail, result.steps), provenance: "ai" };
    } catch (err) {
      log.warn(
        { err, mspCustomerId, docTypeKey, checkKey: finding.checkKey },
        "remediation-kb: AI fallback generation failed — finding rendered as 'guidance not available'",
      );
      return { html: renderFailedRemediationBlock(heading), provenance: "failed" };
    }
  });

  const verifiedCount = blocks.filter((b) => b.provenance === "verified").length;
  const aiGeneratedCount = blocks.filter((b) => b.provenance === "ai").length;
  const pendingCount = blocks.filter((b) => b.provenance === "pending").length;
  const failedCount = blocks.filter((b) => b.provenance === "failed").length;

  const html =
    `<section data-remediation-appendix="1" style="margin-top:8px">` +
    renderAppendixHeader(verifiedCount, aiGeneratedCount, pendingCount, failedCount) +
    blocks.map((b) => b.html).join("") +
    `</section>`;

  log.info(
    {
      mspCustomerId, docTypeKey, allowAiFallback,
      findingsRendered: blocks.length, verifiedCount, aiGeneratedCount, pendingCount, failedCount, truncatedCount,
      uncoveredCheckKeys,
    },
    "remediation-kb: remediation detail appendix built",
  );

  return {
    html, verifiedCount, aiGeneratedCount, pendingCount, failedCount, truncatedCount,
    coveredCheckKeys, uncoveredCheckKeys,
  };
}

/**
 * Appended to the narrative prompt for any document type with the appendix
 * enabled.
 *
 * This is the other half of the fix, and it is not cosmetic: labelling the
 * appendix's AI content solves nothing if the model then writes its own
 * unlabelled, unverified PowerShell into the body of the same document. The
 * narrative's job is prioritisation, sequencing, impact and timeline; the
 * commands live in the appendix, where their provenance is stated.
 */
export const REMEDIATION_APPENDIX_PROMPT_SUFFIX = `

REMEDIATION DETAIL APPENDIX — READ THIS BEFORE WRITING:
A separate, per-finding step-by-step remediation appendix is appended to this document AFTER your output. Where a human-verified knowledge-base entry exists for a finding, that appendix renders it verbatim; where one does not, it renders AI-generated guidance under an explicit "verify before running" warning. Provenance is stated per finding there, and it cannot be stated for anything you write here.

Therefore, in YOUR narrative:
- Do NOT write PowerShell, Microsoft Graph, Azure CLI, or any other runnable commands. Point the reader to the "Remediation Detail — Step by Step" appendix instead.
- Do NOT write numbered click-path instructions for the Microsoft admin centers.
- DO write the prioritisation, sequencing, business impact, effort/timeline, risk and success-metric analysis — that is what this narrative is for, and the appendix does not cover any of it.`;

export type { RemediationKbStep };
