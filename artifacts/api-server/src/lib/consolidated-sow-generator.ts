import { z } from "zod";
import {
  db,
  scriptRunResultsTable,
  clientHealthHistoryTable,
  clientM365ProfilesTable,
  usersTable,
  insightsGeneratedDocumentsTable,
  engagementProjectsTable,
  quickWinPresentationsTable,
  mspUsersTable,
  mspCustomersTable,
  tenantMonitorProfilesTable,
} from "@workspace/db";
import { eq, ne, desc, and, inArray, isNull, sql } from "drizzle-orm";
import { computeTenantSignals, getProjectSignalDefinitions, getAdjustmentSignalDefinitions, projectMatchesSignals, getDisabledSignalKeys } from "./tenant-signals";
import { detectRuleConflicts } from "./signal-conflict-detector";
import {
  fetchSignalRulesAndGroups,
  getSignalWeights,
  rankFiredSignals,
  sumPriorityScore,
} from "./priority-engine";
import { computeHealthEngine } from "./health-engine";
import { computeDriftEngine } from "./drift-engine";
import { computeForecastingEngine } from "./forecasting-engine";
import { getCrmSignalWeights, filterCrmSignals, sumCrmScore } from "./crm-engine";
import { computeTenantEngineScores } from "./msp-engine";
import { computePricingEngine } from "./engine-registry";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";
const log = logger.child({ channel: "workflow.doc-pipeline" });
// Signal-evaluation input assembly (tenant/monitor resolution) logs on the
// shared engine.signals channel so it lines up with the same work done in
// tenant-signals.ts:buildTenantProfile and the per-engine callers.
const signalsLog = logger.child({ channel: "engine.signals" });
import { getPrompt, getDocumentStylePrefix, getSowPricingFormulaBlock } from "./prompt-loader";
import {
  extractAiHtml,
  parseSowAllPricing,
  patchSowGrandTotal,
  purgeSowAdjustments,
  purgeAdjustmentsByTitle,
  purgeHallucinatedWorkstreams,
  canonicalizeWorkstreamTitles,
  injectMissingWorkstreams,
  detectSowPhaseDrift,
  validateSowPricing,
  nextBusinessMonday,
  assignDeliveryDates,
  ADJ_SIGNAL_PATTERNS,
  SowPricingLineSchema,
  reconcileEngineValues,
  type SowPricingLine,
  type EngineReconciliationValues,
} from "./sow-pricing";
import { resolveWorkstreamKeys, buildWorkstreamContextBlock } from "./workstream-normalizer";
import {
  broadcastPresentationScopeChange,
  broadcastPresentationDocsChange,
} from "./sse-channels";
import { pushSowDebugLog, setSowDebugSignals, startSowDebugRun, finishSowDebugRun } from "./sow-debug-log-buffer";
import { recordAiUsage } from "./ai-billing";

// ⚠️ TEMPORARY TESTING KILL-SWITCH — REMOVE BEFORE PRODUCTION ⚠️
// Disables real AI spend during active testing. Must be removed/re-enabled
// before any real customer reaches this flow. See backlog: [Shane to add ticket].
const AI_KILL_SWITCH_ENABLED = false;

// ── Usage telemetry (fire-and-forget) ─────────────────────────────────────────
// Mirrors omg-card-extractor.ts's trackUsage(): resolves the billing MSP via the
// msp_users bridge (userId → mspId), keyed off clientUserId. Resolved
// independently of the signal-eval block above (whose own mspId lookup only
// runs on the DB-evaluation path, not the signalsOverride path) so billing
// attribution never silently depends on which signal path was taken.
function trackUsage(opts: {
  inputTokens: number;
  outputTokens: number;
  model: string;
  clientUserId: number;
  docId: number;
}): void {
  void (async () => {
    try {
      const [mspUser] = await db
        .select({ mspId: mspUsersTable.mspId })
        .from(mspUsersTable)
        .where(eq(mspUsersTable.userId, opts.clientUserId))
        .limit(1);

      await recordAiUsage({
        mspId: mspUser?.mspId ?? null,
        nodeType: "consolidated_sow_generator",
        feature: `assessment_consolidated_sow:document:${opts.docId}`,
        promptTokens: opts.inputTokens,
        completionTokens: opts.outputTokens,
        costOwner: "msp",
        model: opts.model,
      });
    } catch (err) {
      log.warn({ err, docId: opts.docId }, "consolidated-sow-generator: usage telemetry failed (non-fatal)");
    }
  })();
}

export function computeTenantTier(totalUsers: number | unknown): "Tier01" | "Tier02" | "Tier03" | "Tier04" {
  const n = typeof totalUsers === "number" ? totalUsers : Number(totalUsers);
  if (!Number.isFinite(n) || n <= 0) return "Tier01";
  if (n <= 50)  return "Tier01";
  if (n <= 250) return "Tier02";
  if (n <= 750) return "Tier03";
  return "Tier04";
}

// Fallback used only if the "insights-consulting-sow_pricing_formula" DB prompt
// row is missing or the lookup fails. The live value is editable in the AI
// Prompts admin UI — see getPrompt() call near the prompt assembly below.
export const TIER_02_PRICING_FORMULA_BLOCK_FALLBACK = `You are pricing Microsoft 365 remediation projects for Shane McCaw Consulting. These are NOT assessments — they are project-based engagements where real problems are fixed.

STEP 1 — READ TENANT TIER: use the "Computed Tenant Tier" line from the TENANT FACTS block directly. Do NOT re-derive or override it from any other source (including user counts, company size, or catalogue prices). The tier has already been determined server-side from the live script data.

STEP 2 — BASE CEILINGS (select the row matching the detected tier):
  Workstream        | Tier01   | Tier02   | Tier03   | Tier04
  Governance        | $10,000  | $25,000  | $30,000  | $35,000
  Security          | $10,000  | $28,000  | $35,000  | $42,000
  Copilot           |  $8,000  | $30,000  | $35,000  | $42,000
  Info Architecture | $12,000  | $25,000  | $30,000  | $42,000
  License Optim.    |  $4,000  |  $8,000  | $12,000  | $15,000

  Include only the workstreams relevant to this engagement.
  Workstream Total = sum of all included workstream Base Ceilings.

STEP 3 — ADJUSTMENT MAP (workstream-scoped — STRICTLY ENFORCED):

  Adjustment amounts by tier (ONLY these four adjustment types exist — no others):
  Adjustment             | Tier01  | Tier02   | Tier03   | Tier04
  Tenant Size            | $2,000  |  $5,000  | $10,000  | $15,000
  Governance Complexity  | $5,000  | $15,000  | $25,000  | $35,000
  Security/Compliance    | $5,000  | $10,000  | $20,000  | $25,000
  Copilot Readiness      | $5,000  | $10,000  | $20,000  | $25,000

  ADJUSTMENT MAP — permitted adjustments per workstream (STRICT — only these may appear):
    Governance Remediation  → Governance Complexity (only; always label it exactly "Governance Complexity")
    Security Remediation    → Tenant Size, Security/Compliance
    Data Protection / DLP   → Security/Compliance (only)
    Copilot Readiness       → Copilot Readiness (only)
    Licensing Optimization  → Tenant Size (only)

  PROHIBITED adjustment types — NEVER include in any SOW regardless of workstreams:
    Complexity, Data Sprawl, Timeline — these are not valid adjustment types in this model.

  Rules — strictly enforced:
  1. Only include an adjustment if its workstream is present in this SOW AND findings support it.
  2. Each eligible adjustment appears AT MOST ONCE in the Pricing Adjustments table — never duplicate even when multiple workstreams permit it.
  3. Never add adjustment amounts to individual workstream rows.
  Adjustment Total = sum of all applicable permitted adjustments at the tier-correct dollar amount.

  Criteria for applying each adjustment (only when the relevant workstream is present and findings justify it):
  - Tenant Size (Security, Licensing): apply for Tier03+ tenants (≥ 250 users) where scale materially increases provisioning effort.
  - Governance Complexity (Governance only): apply if governance findings show multiple critical gaps or ≥ 3 remediation domains requiring coordinated remediation.
  - Security/Compliance (Security, DLP): apply if MFA not enforced, Conditional Access = 0, or industry compliance risk identified.
  - Copilot Readiness (Copilot only): apply based on Copilot score and blocker count; use ONLY when the Copilot workstream is in scope.

STEP 4 — TOTALS:
  Engagement Total = Workstream Total + Adjustment Total.

Use the detected tier and arithmetic INTERNALLY ONLY — do NOT render tier names, tier detection notes, step-by-step arithmetic, or formula working notes as visible text in the HTML document. Never leave pricing blank, never say TBD.

Output requirements for the Pricing section:
- Show a per-workstream table with columns: Project/Workstream | Scope | Base Ceiling | Final Price (USD) | Reasoning
  - Each row shows ONLY the workstream's own Base Ceiling and Final Price — NO per-row adjustment breakdown.
  - Final Price for each row = Base Ceiling for that workstream only (adjustments are NOT added per row).
- After the per-workstream table, render a second HTML <table> for the Pricing Adjustments section. This table MUST use proper <table><thead><tbody> elements — NOT divs or CSS classes. CRITICAL for server parsing: the workstream table header MUST contain the exact text "Base Ceiling" and "Final Price (USD)"; the adjustments table header MUST contain "Adjustment Factor" and "Amount (USD)" — these keywords are required for server-side pricing validation. Header row: Adjustment Factor | Amount (USD) | Reasoning. One body row per applicable adjustment. A final body row with title "Adjustments Subtotal" showing the sum.
- End with a Grand Total row after both tables. Show the calculation as plain text: Grand Total = $[workstream subtotal] (workstreams) + $[adjustments subtotal] (adjustments) = $[grand total]. Double-check the arithmetic before outputting.
- Always explain the reasoning for each adjustment applied in the Pricing Adjustments table.
- Never invent new pricing models. Never use TBD.
- Your goal is to produce a firm, defensible, enterprise-grade project price.`;

const CONSOLIDATED_SOW_FALLBACK = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience. Generate a comprehensive, client-ready Consolidated Statement of Work in HTML format.

Client: {{clientName}}
Deliverable title: {{title}}
Date: {{date}}
ENGAGEMENT START DATE: {{engagementStart}} (the first Monday that is at least one full week after the document generation date — use this as the baseline for all phase delivery date calculations)

EXISTING DOCUMENTS GENERATED FOR THIS CLIENT (synthesize all findings, recommendations, and remediation items from these into the SOW):
{{existingDocs}}

ENGAGEMENT PROJECT PRICING CATALOGUE — SIGNAL-AUTHORITATIVE, DETERMINISTIC (READ CAREFULLY):
This list has ALREADY been filtered by the tenant signal engine. Each project below is included ONLY because its triggering signal(s) fired for this tenant. This is not a suggestion — it is the complete and exact set of phases this SOW MUST contain.

RULES (non-negotiable):
1. You MUST create EXACTLY ONE phase / workstream row per project listed below — using its EXACT title, verbatim. Do not rename, merge, split, or paraphrase a title.
2. You MUST NOT add any phase, workstream, or project that is not listed below, no matter what the tenant telemetry or documents suggest. If a document mentions a gap whose project isn't listed here, that signal did not fire — do not invent a phase for it.
3. You MUST NOT omit any project listed below, even if telemetry doesn't specifically call it out — the catalogue below is the complete, deterministic scope. Price it from its base ceiling if telemetry is silent.
4. For each phase, explicitly cite its "Triggering signal(s)" (shown below) in the "Why This Phase Is Required" / Reasoning text — e.g. "This phase is required because the hasGovernanceGaps signal fired for this tenant."
5. adj:* signals (shown separately below in the SIGNAL-GATED PRICING ADJUSTMENTS block, when present) NEVER create a phase — they only ever adjust price. Never turn an adj:* signal into its own workstream row.

{{engagementProjects}}

TENANT TELEMETRY (live M365 health profile flags, scores, and script findings — use this data to scope the work accurately and to justify pricing decisions):
{{tenantTelemetry}}

INSTRUCTIONS:
- Output ONLY valid HTML (no markdown, no code fences)
- Use inline CSS — professional white background, #0078D4 (Azure Blue) accent, Inter/system-font typography
- Structure: Executive Summary → Scope of Work → Deliverables (table) → Project Pricing (two-part: workstream table + adjustments summary) → Timeline (phased, with real calendar delivery dates per phase) → Acceptance Criteria
- Do NOT include a Resource Requirements section — Shane McCaw is the sole consultant on this engagement
- Do NOT include a Payment Terms section — payment is managed separately through the client portal
- Do NOT include a Signature Block — document execution is handled through the portal
- MANDATORY PRICING RULE: Every single project listed in the ENGAGEMENT PROJECT PRICING CATALOGUE above MUST appear as its own row in the per-workstream pricing table — including Licensing Optimization and any Copilot-related project. Never omit a catalogue project. If telemetry does not mention a project specifically, price it using the computed tenant tier and its base ceiling.
- The Pricing section MUST contain two parts: (1) a per-workstream table with columns: Project/Workstream | Scope | Base Ceiling | Duration (Weeks) | Delivery Date | Final Price (USD) | Reasoning — populated from the engagement projects catalogue and the telemetry above; (2) a "Pricing Adjustments" summary section below it that lists ONLY the adjustments permitted for the workstreams present in this SOW (per the ADJUSTMENT MAP in the TIER 02 PRICING FORMULA appended below), each appearing once, followed by a Grand Total row — do NOT list adjustments that are not permitted for the workstreams present
- For the Duration (Weeks) column: assign a realistic integer number of weeks to each workstream phase based on the scope of work (e.g. 2–16 weeks). Format as "N weeks" (e.g. "4 weeks")
- For the Delivery Date column: compute dates cumulatively starting from the ENGAGEMENT START DATE. Phase 1 delivery = ENGAGEMENT START DATE + Phase 1 weeks. Phase 2 delivery = Phase 1 delivery date + Phase 2 weeks. Continue this pattern for all subsequent phases. Format as "Mon DD, YYYY" (e.g. "Aug 4, 2026"). These MUST be real calendar dates, not relative estimates
- You MUST output a single fixed price per project/workstream (no ranges, no TBD, no "depends"); shared adjustments must NOT be added to individual workstream rows
- You MUST calculate pricing using the telemetry and pricing rules provided; each workstream row shows only its Base Ceiling and Final Price; only the adjustments permitted for the workstreams present (per the ADJUSTMENT MAP) are listed in the "Pricing Adjustments" summary section below the workstream table, each appearing once and never on individual rows
- The Grand Total MUST equal the arithmetic sum of all workstream Final Prices plus all adjustment amounts. Show the arithmetic explicitly in the Grand Total cell: "Grand Total = $[workstream subtotal] (workstreams) + $[adjustments subtotal] (adjustments) = $[total]". Verify the addition before writing the number.
- Synthesise all findings and remediation themes across the provided documents into a coherent, unified scope
- Each major section as <h2> with a horizontal rule separator
- In the Acceptance Criteria section, render EACH criterion on its own line as a block element: <div style="margin:6px 0">&#9744; [criterion text]</div> — never put multiple criteria inline on one line or separate them with commas or semicolons
- Professional consulting tone as Shane McCaw, first person where appropriate
- Total length: 2000-3500 words`;

export async function syncPresentationDocIds(
  projectId: number,
  newDocId: number,
  newDocType: string,
): Promise<void> {
  try {
    const drafts = await db
      .select({ id: quickWinPresentationsTable.id, documentsIncluded: quickWinPresentationsTable.documentsIncluded })
      .from(quickWinPresentationsTable)
      .where(and(
        eq(quickWinPresentationsTable.projectId, projectId),
        eq(quickWinPresentationsTable.status, "draft"),
      ));

    for (const draft of drafts) {
      const existing = (draft.documentsIncluded ?? []) as number[];
      const sameTypeDocs = existing.length > 0
        ? await db
            .select({ id: insightsGeneratedDocumentsTable.id })
            .from(insightsGeneratedDocumentsTable)
            .where(and(
              inArray(insightsGeneratedDocumentsTable.id, existing),
              eq(insightsGeneratedDocumentsTable.docType, newDocType),
            ))
        : [];
      const sameTypeIds = new Set(sameTypeDocs.map(d => d.id));
      const filtered = existing.filter(id => !sameTypeIds.has(id));
      if (!filtered.includes(newDocId)) filtered.push(newDocId);
      await db.update(quickWinPresentationsTable)
        .set({ documentsIncluded: filtered, updatedAt: new Date() })
        .where(eq(quickWinPresentationsTable.id, draft.id));
    }
  } catch (err) {
    log.warn({ err, projectId, newDocId }, "syncPresentationDocIds: failed (non-fatal)");
  }
}

export async function broadcastSowChangeForProject(projectId: number): Promise<void> {
  try {
    const presentations = await db
      .select({ id: quickWinPresentationsTable.id })
      .from(quickWinPresentationsTable)
      .where(eq(quickWinPresentationsTable.projectId, projectId));
    const ts = String(Date.now());
    for (const p of presentations) {
      broadcastPresentationScopeChange(p.id, ts);
    }
  } catch (err) {
    log.warn({ err, projectId }, "broadcastSowChangeForProject: failed");
  }
}

export async function broadcastDocsChangeForProject(projectId: number): Promise<void> {
  try {
    const presentations = await db
      .select({ id: quickWinPresentationsTable.id })
      .from(quickWinPresentationsTable)
      .where(eq(quickWinPresentationsTable.projectId, projectId));
    for (const p of presentations) {
      broadcastPresentationDocsChange(p.id);
    }
  } catch (err) {
    log.warn({ err, projectId }, "broadcastDocsChangeForProject: failed");
  }
}

export interface GenerateConsolidatedSowParams {
  clientUserId: number;
  projectId: number | null;
  title: string;
  runId?: string;
  /** Called synchronously after the "generating" DB row is inserted, before AI runs.
   *  Use this to send the docId to an HTTP client before the slow AI step. */
  onRowCreated?: (docId: number) => void;
  /** Pre-computed fired signal keys from an upstream get_tenant_signals workflow node.
   *  When provided, the internal computeTenantSignals DB evaluation is skipped entirely
   *  and these signals are used directly to gate engagement project inclusion. */
  signalsOverride?: Set<string>;
  /** Substitutes for the DB-stored consolidated_sow prompt body — used by the Test Draft flow. */
  promptOverride?: string;
  /** Substitutes for the DB-stored sow_pricing_formula prompt body — used by the Test Draft flow
   *  when testing the "insights-consulting-sow_pricing_formula" prompt specifically. */
  pricingFormulaOverride?: string;
  /** When true, skips all persistence (no "generating" row, no final update, no prior-doc deletion,
   *  no presentation sync) and just returns the generated HTML. */
  testMode?: boolean;
  /**
   * Customer scope selection (Assessment interactive SOW). When provided (non-null),
   * the signal-gated project list is further narrowed to ONLY these workstream titles —
   * everything downstream (prompt catalogue, hallucination purge, missing-phase
   * injection, phase-drift guard) uses the narrowed list, so the regenerated document
   * is a real, full-quality SOW for the selected subset (adjustments re-gate automatically
   * against the workstreams that remain present). Titles must be a subset of the
   * signal-gated catalogue; unknown titles are ignored. Null/undefined = full scope (default).
   */
  selectedWorkstreamTitles?: string[] | null;
  /**
   * How to supersede the prior completed SOW on success.
   *  - "delete" (default): hard-delete the single prior completed row (legacy behavior,
   *    used by the admin/workflow generation paths).
   *  - "archive": set every other completed consolidated_sow row for this
   *    customer+project to status "archived" instead of deleting, so prior scope
   *    versions (incl. the original full-scope document) are preserved and can be
   *    re-activated for free by the Assessment scope selector without a new AI call.
   */
  supersedeMode?: "delete" | "archive";
}

export interface GenerateConsolidatedSowResult {
  docId: number;
  clientName: string;
  sowTotal: number;
  /** Only populated when called with testMode — the generated HTML, never persisted. */
  htmlContent?: string;
  /** Echoes params.runId when provided — used by the Admin Panel SOW Debug page to
   *  correlate this result with the captured log/signal buffer (see sow-debug-log-buffer.ts). */
  correlationId?: string;
}

export async function generateConsolidatedSowDocument(
  params: GenerateConsolidatedSowParams,
): Promise<GenerateConsolidatedSowResult> {
  const { clientUserId, projectId, title, runId, signalsOverride, promptOverride, pricingFormulaOverride, testMode = false, selectedWorkstreamTitles = null, supersedeMode = "delete" } = params;
  const logCtx = { clientUserId, projectId, title, runId };
  const correlationId = runId;
  if (correlationId) startSowDebugRun(correlationId, clientUserId, projectId);

  const [existingDocs, engagementProjects, customerRow, m365ProfileRow, scriptRuns, scoresRow] = await Promise.all([
    db.select({
      id:       insightsGeneratedDocumentsTable.id,
      title:    insightsGeneratedDocumentsTable.title,
      docType:  insightsGeneratedDocumentsTable.docType,
      category: insightsGeneratedDocumentsTable.category,
      htmlContent: insightsGeneratedDocumentsTable.htmlContent,
    })
    .from(insightsGeneratedDocumentsTable)
    .where(and(
      eq(insightsGeneratedDocumentsTable.customerId, clientUserId),
      // Exclude existing SOW docs — they're what we're regenerating
    ))
    .orderBy(desc(insightsGeneratedDocumentsTable.createdAt)),

    db.execute(sql`
      SELECT title, price_range AS "priceRange", description, sow_items AS "sowItems",
             triggered_by AS "triggeredBy", meaning
      FROM engagement_projects WHERE is_visible = true ORDER BY sort_order
    `),

    db.select({ name: usersTable.name, company: usersTable.company })
      .from(usersTable).where(eq(usersTable.id, clientUserId)).limit(1),

    db.select({ profile: clientM365ProfilesTable.profile })
      .from(clientM365ProfilesTable)
      .where(eq(clientM365ProfilesTable.clientId, clientUserId))
      .limit(1),

    db.select({
      scriptName:      scriptRunResultsTable.scriptName,
      parsedFindings:  scriptRunResultsTable.parsedFindings,
      recommendations: scriptRunResultsTable.recommendations,
      profileUpdates:  scriptRunResultsTable.profileUpdates,
      scoreImpact:     scriptRunResultsTable.scoreImpact,
      createdAt:       scriptRunResultsTable.createdAt,
    })
    .from(scriptRunResultsTable)
    .where(and(
      eq(scriptRunResultsTable.customerId, clientUserId),
      eq(scriptRunResultsTable.status, "completed"),
    ))
    .orderBy(desc(scriptRunResultsTable.createdAt))
    .limit(50),

    db.select({
      category: clientHealthHistoryTable.category,
      score:    clientHealthHistoryTable.score,
    })
    .from(clientHealthHistoryTable)
    .where(eq(clientHealthHistoryTable.clientId, clientUserId))
    .orderBy(desc(clientHealthHistoryTable.recordedAt))
    .limit(50),
  ]);

  type EngagementProjectRow = {
    title: string;
    priceRange: string;
    description: string | null;
    sowItems: string[] | null;
    triggeredBy: string[];
    meaning: string | null;
  };

  const allEngagementProjects = (engagementProjects as unknown as { rows: EngagementProjectRow[] }).rows;

  const clientName = customerRow[0]?.company ?? customerRow[0]?.name ?? "Client";

  const docsBlock = existingDocs.length > 0
    ? existingDocs.map((d, i) => {
        const excerpt = d.htmlContent
          .replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 600);
        return `[Document ${i + 1}] ${d.title} (${d.docType})\n${excerpt}`;
      }).join("\n\n---\n\n")
    : "No prior documents found for this client — generate from scratch using best practices.";

  // ── Signal-based project filtering ──────────────────────────────────────────
  const mergedSowProfileForSignals: Record<string, unknown> = {};
  type RunRow = { scriptName: string | null; parsedFindings: string[] | null; recommendations: string[] | null; profileUpdates: Record<string, unknown> | null };
  const typedRunsForSignals = scriptRuns as RunRow[];
  for (const run of [...typedRunsForSignals].reverse()) {
    Object.assign(mergedSowProfileForSignals, run.profileUpdates ?? {});
  }
  const allFindingsForSignals = [...new Set(typedRunsForSignals.flatMap(r => r.parsedFindings ?? []))];

  // Insert the "generating" row and notify caller BEFORE signal eval and AI generation.
  // This ensures the row always exists so it can be marked "failed" if anything goes wrong.
  // In testMode we skip persistence entirely — nothing should reach insights_generated_documents.
  let docId = -1;
  if (!testMode) {
    const [genSowRowEarly] = await db.insert(insightsGeneratedDocumentsTable).values({
      customerId: clientUserId,
      projectId:  projectId ?? null,
      category:   "consulting",
      docType:    "consolidated_sow",
      title,
      htmlContent: "",
      status:     "generating",
      pdfUrl:     null,
    }).returning({ id: insightsGeneratedDocumentsTable.id });
    docId = genSowRowEarly!.id;

    // Notify caller synchronously so HTTP routes can send the docId before the slow AI step.
    params.onRowCreated?.(docId);
  }

  log.info(
    { ...logCtx, docId, engagementProjectCount: allEngagementProjects.length },
    "consolidated-sow-generator: starting signal evaluation",
  );
  pushSowDebugLog(correlationId, "info", "Starting signal evaluation", { docId, engagementProjectCount: allEngagementProjects.length });

  let signalFilteredProjects = allEngagementProjects;
  let signalFilterMeta: { clean: boolean; conflictCount: number; conflicts?: Array<{ ruleIds: number[]; description: string }> } = { clean: true, conflictCount: 0 };
  // Adjustment signal keys that fired for this tenant — populated inside the try block.
  // When non-empty, used to inject a hard constraint into the SOW prompt and to gate
  // the validate/purge pass.  Stays empty if no adj:* rules are configured in the DB.
  let firedAdjSignalKeys = new Set<string>();
  let hasAdjSignalRules = false;
  if (signalsOverride != null) {
    const knownSignalKeys = new Set((await getProjectSignalDefinitions()).map(s => s.key));
    // Determine whether adj rules are *configured* (not just fired) via a cheap DB existence check.
    // This matches the DB-evaluation path which sets hasAdjSignalRules = typedSignalRules.some(r => r.signalKey.startsWith("adj:")).
    const adjRuleCheck = await db.execute(sql`SELECT 1 FROM signal_derivation_rules WHERE signal_key LIKE 'adj:%' LIMIT 1`);
    hasAdjSignalRules = adjRuleCheck.rows.length > 0;
    // Disabled signals must never fire, even if a caller supplied a pre-computed override
    // that includes them (e.g. a stale workflow payload) — filter them out here too.
    const disabledOverrideRows = await db.execute(sql`
      SELECT signal_key AS "signalKey" FROM signal_enabled_state WHERE enabled = false
    `);
    const disabledOverrideKeys = new Set(
      (disabledOverrideRows.rows as Array<{ signalKey: string }>).map(r => r.signalKey),
    );
    const effectiveOverride = new Set(
      [...signalsOverride].filter(key => !disabledOverrideKeys.has(key)),
    );
    if (hasAdjSignalRules) {
      for (const key of effectiveOverride) {
        if (key.startsWith("adj:")) firedAdjSignalKeys.add(key);
      }
    }
    signalFilteredProjects = allEngagementProjects.filter(p => {
      const triggers = Array.isArray(p.triggeredBy) ? p.triggeredBy as string[] : [];
      const { included, reason } = projectMatchesSignals(
        { title: p.title, triggeredBy: triggers },
        knownSignalKeys,
        effectiveOverride,
      );
      if (!included && reason) {
        log.debug({ ...logCtx, projectTitle: p.title, reason },
          "consolidated-sow-generator: project excluded by signal gate (pre-computed override)");
      }
      return included;
    });
    log.info({ ...logCtx, docId, signalCount: signalsOverride.size },
      "consolidated-sow-generator: using pre-computed signals override — skipped DB signal evaluation");
    pushSowDebugLog(correlationId, "info", "Using pre-computed signals override — skipped DB signal evaluation", { signalCount: signalsOverride.size });
    setSowDebugSignals(correlationId, {
      firedSignals: [...effectiveOverride],
      firedAdjSignalKeys: [...firedAdjSignalKeys],
      includedProjectTitles: signalFilteredProjects.map(p => p.title),
      excludedProjectTitles: allEngagementProjects.filter(p => !signalFilteredProjects.includes(p)).map(p => p.title),
      signalFilterMeta,
      usedOverride: true,
    });
  } else {
  try {
    const signalRules = await db.execute(sql`
      SELECT id, signal_key AS "signalKey", group_id AS "groupId", rule_type AS "ruleType",
             source_key AS "sourceKey", compare_value AS "compareValue", description,
             sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM signal_derivation_rules ORDER BY signal_key, sort_order, id
    `);
    const signalGroups = await db.execute(sql`
      SELECT id, signal_key AS "signalKey", logic, label, sort_order AS "sortOrder", created_at AS "createdAt"
      FROM signal_rule_groups ORDER BY signal_key, sort_order, id
    `);
    const disabledSignalRows = await db.execute(sql`
      SELECT signal_key AS "signalKey" FROM signal_enabled_state WHERE enabled = false
    `);
    const disabledSignalKeys = new Set(
      (disabledSignalRows.rows as Array<{ signalKey: string }>).map(r => r.signalKey),
    );

    // ── Conflict detection ───────────────────────────────────────────────────
    type RuleRow = Parameters<typeof computeTenantSignals>[2][number];
    const typedSignalRules = signalRules.rows as unknown as RuleRow[];
    const conflicts = detectRuleConflicts(typedSignalRules);
    if (conflicts.length > 0) {
      signalFilterMeta = { clean: false, conflictCount: conflicts.length, conflicts };
      for (const conflict of conflicts) {
        log.warn(
          { ...logCtx, ruleIds: conflict.ruleIds, conflictDescription: conflict.description },
          "consolidated-sow-generator: signal rule conflict detected — project list may be incorrect",
        );
      }
    }

    // Always evaluate signals — empty rules means no signals fire, which is the correct
    // deterministic baseline. Projects with signal-key triggers require a matching fired
    // signal to be included; the legacy guard allows old plan-name strings through.
    // clientUserId is a portal user id (usersTable.id) throughout this file, so
    // the customer/msp/tenant it belongs to are resolved through the msp_users
    // bridge (userId → customer), NOT by treating the id as an msp_customers.id.
    // We pull tenantId here too so monitor-derived threshold signals can fire —
    // without the tenant_monitor_profiles merge below, every "threshold" rule
    // (orphaned Teams, Copilot oversharing, Secure Score drift, disabled
    // accounts, licensing/SharePoint oversharing) silently evaluates to 0.
    const [slaCustomerRow] = await db
      .select({ customerId: mspCustomersTable.id, mspId: mspCustomersTable.mspId, tenantId: mspCustomersTable.tenantId })
      .from(mspUsersTable)
      .innerJoin(mspCustomersTable, eq(mspUsersTable.customerId, mspCustomersTable.id))
      .where(eq(mspUsersTable.userId, clientUserId))
      .limit(1);
    const slaResolvedCustomerId = slaCustomerRow?.customerId ?? null;
    const slaResolvedMspId = slaCustomerRow?.mspId ?? null;
    const slaResolvedTenantId = slaCustomerRow?.tenantId ?? null;

    // Merge monitor-derived item counts into the signal-evaluation profile,
    // exactly as tenant-signals.ts:buildTenantProfile does for the engines, so
    // threshold-type signals have their `<checkKey>__itemCount` inputs. Keyed by
    // the resolved tenantId; a null tenant means no monitor data can contribute.
    if (slaResolvedTenantId) {
      const monitorRows = await db.selectDistinctOn([tenantMonitorProfilesTable.checkKey], {
        checkKey: tenantMonitorProfilesTable.checkKey,
        extractedProperties: tenantMonitorProfilesTable.extractedProperties,
      })
        .from(tenantMonitorProfilesTable)
        .where(eq(tenantMonitorProfilesTable.tenantId, slaResolvedTenantId))
        .orderBy(tenantMonitorProfilesTable.checkKey, desc(tenantMonitorProfilesTable.collectedAt));

      for (const row of monitorRows) {
        const props = (row.extractedProperties as Record<string, unknown> | null) ?? {};
        mergedSowProfileForSignals[`${row.checkKey}__itemCount`] = props["_itemCount"] ?? 0;
      }
      signalsLog.info(
        { ...logCtx, tenantId: slaResolvedTenantId, monitorCheckKeys: monitorRows.length },
        "consolidated-sow-generator: merged tenant_monitor_profiles into SOW signal profile",
      );
    } else {
      signalsLog.warn(
        { ...logCtx, customerId: slaResolvedCustomerId },
        "consolidated-sow-generator: no tenantId resolved for client — monitor-derived threshold signals cannot fire in this SOW",
      );
    }

    const { firedSignals } = computeTenantSignals(
      mergedSowProfileForSignals,
      allFindingsForSignals,
      typedSignalRules,
      signalGroups.rows as unknown as Parameters<typeof computeTenantSignals>[3],
      disabledSignalKeys,
      slaResolvedCustomerId != null && slaResolvedMspId != null ? { customerId: slaResolvedCustomerId, mspId: slaResolvedMspId } : undefined,
    );

    // Extract adj:* keys — these drive pricing adjustment gating, not project inclusion.
    hasAdjSignalRules = typedSignalRules.some(r => r.signalKey.startsWith("adj:"));
    if (hasAdjSignalRules) {
      for (const key of firedSignals) {
        if (key.startsWith("adj:")) firedAdjSignalKeys.add(key);
      }
      log.info(
        { ...logCtx, firedAdjSignalKeys: [...firedAdjSignalKeys] },
        "consolidated-sow-generator: adjustment signal evaluation complete",
      );
    }

    const knownSignalKeys = new Set((await getProjectSignalDefinitions()).map(s => s.key));

    signalFilteredProjects = allEngagementProjects.filter(p => {
      const triggers = Array.isArray(p.triggeredBy) ? p.triggeredBy as string[] : [];
      const legacyTriggers = triggers.filter(t => !knownSignalKeys.has(t));
      if (legacyTriggers.length > 0) {
        log.warn(
          { ...logCtx, projectTitle: p.title, legacyTriggers, allTriggers: triggers },
          "consolidated-sow-generator: [DEPRECATION] project has non-signal triggeredBy string(s) — " +
          "migrate all entries to canonical signal keys (e.g. hasGovernanceGaps, hasSecurityGaps). " +
          "Unrecognized entries are ignored; if ALL entries are unrecognized the project is excluded. " +
          "Update triggeredBy via the Admin Panel → Engagement Projects or run seed-engagement-project-triggers.",
        );
      }
      const { included, reason } = projectMatchesSignals(
        { title: p.title, triggeredBy: triggers },
        knownSignalKeys,
        firedSignals,
      );
      if (!included && reason) {
        log.debug({ ...logCtx, projectTitle: p.title, reason },
          "consolidated-sow-generator: project excluded by signal gate");
      }
      return included;
    });

    const excludedTitles = allEngagementProjects
      .filter(p => !signalFilteredProjects.includes(p))
      .map(p => p.title);
    if (excludedTitles.length > 0) {
      log.info({ ...logCtx, excludedTitles, firedSignals: [...firedSignals] },
        "consolidated-sow-generator: signal filter excluded projects");
    }
    pushSowDebugLog(correlationId, "info", "DB signal evaluation complete", {
      firedSignalCount: firedSignals.size,
      includedProjectCount: signalFilteredProjects.length,
      excludedProjectCount: excludedTitles.length,
    });
    setSowDebugSignals(correlationId, {
      firedSignals: [...firedSignals],
      firedAdjSignalKeys: [...firedAdjSignalKeys],
      includedProjectTitles: signalFilteredProjects.map(p => p.title),
      excludedProjectTitles: excludedTitles,
      signalFilterMeta,
      usedOverride: false,
    });
  } catch (signalErr) {
    pushSowDebugLog(correlationId, "error", "Signal evaluation failed — aborting SOW generation", {
      error: signalErr instanceof Error ? signalErr.message : String(signalErr),
    });
    log.error({ ...logCtx, docId, signalErr }, "consolidated-sow-generator: signal evaluation failed — aborting SOW generation");
    if (!testMode) {
      await db.update(insightsGeneratedDocumentsTable)
        .set({ status: "failed", errorMessage: ("Signal evaluation failed: " + (signalErr instanceof Error ? signalErr.message : String(signalErr))).slice(0, 500), updatedAt: new Date() })
        .where(eq(insightsGeneratedDocumentsTable.id, docId))
        .catch(dbErr => log.warn({ dbErr, docId }, "consolidated-sow-generator: failed to mark row as failed after signal eval error"));
    }
    throw new Error("SOW generation failed: could not evaluate tenant signals — please retry");
  }
  } // end else (signalsOverride == null)

  // ── Customer scope narrowing (Assessment interactive SOW) ───────────────────
  // When the customer has toggled off one or more workstream phases, narrow the
  // signal-gated catalogue to ONLY their selected titles. This is the single,
  // authoritative injection point: every downstream enforcement step below
  // (prompt catalogue, hallucination purge, canonical-title enforcement,
  // missing-phase injection, phase-drift guard) reads signalFilteredProjects, so
  // the regenerated document is a real, full-quality SOW for exactly the selected
  // subset. Adjustments re-gate automatically — purgeSowAdjustments strips any
  // adjustment whose governing workstream is no longer present.
  if (selectedWorkstreamTitles != null) {
    const wanted = new Set(selectedWorkstreamTitles);
    const beforeCount = signalFilteredProjects.length;
    const narrowed = signalFilteredProjects.filter(p => wanted.has(p.title));
    // Only apply if at least one requested title matched — an empty result would
    // produce a phase-less SOW and fail the drift guard. Callers validate the
    // selection is a non-empty subset before invoking; this is a belt-and-suspenders
    // guard so a fully-mismatched selection falls back to full scope rather than aborting.
    if (narrowed.length > 0) {
      signalFilteredProjects = narrowed;
      log.info(
        { ...logCtx, docId, requestedCount: wanted.size, narrowedFrom: beforeCount, narrowedTo: narrowed.length,
          selectedTitles: narrowed.map(p => p.title) },
        "consolidated-sow-generator: narrowed to customer-selected workstream scope",
      );
      pushSowDebugLog(correlationId, "info", "Narrowed to customer-selected workstream scope", {
        requestedCount: wanted.size, narrowedTo: narrowed.length,
      });
    } else {
      log.warn(
        { ...logCtx, docId, requestedTitles: [...wanted], catalogTitles: signalFilteredProjects.map(p => p.title) },
        "consolidated-sow-generator: customer scope selection matched no catalogue workstreams — falling back to full scope",
      );
    }
  }

  // ── Engine pre-computation ──────────────────────────────────────────────────
  // Compute every intelligence engine's output BEFORE building the Claude prompt
  // so the AI receives fully pre-computed numbers and never derives pricing,
  // priority, health, drift, forecasting, CRM, or MSP scores itself. Each engine
  // is a pure sum/sort over `computeTenantSignals()` output (see engine-registry.ts) —
  // this block only gathers their outputs, it does not reimplement any scoring.
  //
  // This step is REQUIRED, not best-effort: unlike the signal-eval block above
  // (which already fails generation loudly on error), engine pre-computation
  // failures also abort generation rather than silently falling back to an
  // AI-estimated score. Without these numbers, Claude has no way to comply
  // with the "never calculate these yourself" instruction below, and a
  // document generated without them cannot be trusted for client delivery.
  let engineOutputsBlock: string;
  let engineValues: EngineReconciliationValues;
  try {
    const [{ rules: engineRules, groups: engineGroups }, engineDisabledSignalKeys, priorityWeights, crmWeights] = await Promise.all([
      fetchSignalRulesAndGroups(),
      getDisabledSignalKeys(),
      getSignalWeights(),
      getCrmSignalWeights(),
    ]);

    const pricingEngineOutput = computePricingEngine(
      mergedSowProfileForSignals, allFindingsForSignals, engineRules, engineGroups, engineDisabledSignalKeys,
    );
    const finalPrice = pricingEngineOutput.score.totalPricingValueContribution;
    const pricingBreakdown = pricingEngineOutput.breakdown;

    const { firedSignals: engineFiredSignals } = computeTenantSignals(
      mergedSowProfileForSignals, allFindingsForSignals, engineRules, engineGroups, engineDisabledSignalKeys,
    );
    const engineFiredSignalKeys = [...engineFiredSignals];
    const rankedSignals = rankFiredSignals(engineFiredSignalKeys, priorityWeights);
    const { score: priorityScore } = sumPriorityScore(rankedSignals);

    const healthEngineOutput = computeHealthEngine(
      mergedSowProfileForSignals, allFindingsForSignals, engineRules, engineGroups, engineDisabledSignalKeys,
    );
    const architectureHealthScore = healthEngineOutput.score;

    const driftEngineOutput = computeDriftEngine(
      mergedSowProfileForSignals, allFindingsForSignals, engineRules, engineGroups, engineDisabledSignalKeys,
    );
    const driftScore = driftEngineOutput.score;

    const forecastingEngineOutput = computeForecastingEngine(
      mergedSowProfileForSignals, allFindingsForSignals, engineRules, engineGroups, engineDisabledSignalKeys,
    );
    const forecastScore = forecastingEngineOutput.score;

    const crmBreakdown = filterCrmSignals(engineFiredSignalKeys, crmWeights);
    const crmScoreBreakdown = sumCrmScore(crmBreakdown);
    const crmScore = crmScoreBreakdown.total;

    const tenantEngineScores = computeTenantEngineScores(
      clientUserId, null, mergedSowProfileForSignals, allFindingsForSignals, engineRules, engineGroups, engineDisabledSignalKeys,
    );
    const mspPortfolioScore = tenantEngineScores.combinedScore;

    engineValues = { finalPrice, priorityScore, architectureHealthScore, driftScore, forecastScore, crmScore, mspPortfolioScore, pricingBreakdown };

    log.info(
      { ...logCtx, docId, ...engineValues },
      "consolidated-sow-generator: engine pre-computation complete",
    );

    engineOutputsBlock = [
      "PRE-COMPUTED ENGINE VALUES — HARD CONSTRAINT (supersedes any other instruction in this prompt that asks you to calculate a score or pricing-signal value):",
      "The values below were computed server-side by deterministic scoring engines BEFORE this prompt was built. They are the tenant's ACTUAL priority, health, drift, forecasting, CRM, and pricing-signal scores.",
      "Do NOT calculate, estimate, re-derive, or override priorityScore, architectureHealthScore, driftScore, forecastScore, crmScore, mspPortfolioScore, finalPrice, or pricingBreakdown yourself — wherever the document references any of these specific metrics, reproduce the exact value given below, verbatim.",
      "This does NOT change how you select each workstream's Final Price: that price must still be a single fixed dollar figure chosen from within the workstream's Base Ceiling range in the engagement projects catalogue, informed by the tenant facts and pricing formula below. finalPrice/pricingBreakdown are additional deterministic pricing-signal inputs to weigh when deciding where in that range to land — they are not a replacement grand total, and the grand total is independently recomputed and corrected server-side after generation regardless of what you output.",
      "",
      `finalPrice (pricing-signal value contribution — NOT the SOW grand total): $${finalPrice.toLocaleString()}`,
      `pricingBreakdown: ${JSON.stringify(pricingBreakdown)}`,
      `priorityScore: ${priorityScore}`,
      `rankedSignals: ${JSON.stringify(rankedSignals)}`,
      `architectureHealthScore: ${architectureHealthScore}`,
      `driftScore: ${driftScore}`,
      `forecastScore: ${forecastScore}`,
      `crmScore: ${crmScore}`,
      `mspPortfolioScore: ${mspPortfolioScore}`,
    ].join("\n");
  } catch (engineErr) {
    log.error(
      { ...logCtx, docId, engineErr },
      "consolidated-sow-generator: engine pre-computation failed — aborting generation rather than proceeding without pre-computed engine values",
    );
    if (docId) {
      await db.update(insightsGeneratedDocumentsTable)
        .set({ status: "failed", errorMessage: ("Engine pre-computation failed: " + (engineErr instanceof Error ? engineErr.message : String(engineErr))).slice(0, 500), updatedAt: new Date() })
        .where(eq(insightsGeneratedDocumentsTable.id, docId))
        .catch(dbErr => log.warn({ dbErr, docId }, "consolidated-sow-generator: failed to mark row as failed after engine pre-computation error"));
    }
    throw new Error("SOW generation failed: could not compute intelligence engine values — please retry");
  }

  const projectsBlock = signalFilteredProjects.length > 0
    ? signalFilteredProjects.map(p => {
        const triggers = (Array.isArray(p.triggeredBy) ? p.triggeredBy : []) as string[];
        const signalCite = triggers.length > 0 ? `\n  Triggering signal(s): ${triggers.join(", ")}` : "";
        return `• ${p.title} — ${p.priceRange}${signalCite}${p.meaning ? `\n  ${p.meaning}` : ""}${p.description ? `\n  ${p.description}` : ""}${(p.sowItems as string[] | null)?.length ? `\n  Deliverables: ${(p.sowItems as string[]).join(", ")}` : ""}`;
      }).join("\n\n")
    : "No engagement project pricing configured.";

  const rawProjectTitles = signalFilteredProjects.map(p => p.title);
  const { resolvedKeys, unresolvedTitles } = resolveWorkstreamKeys(rawProjectTitles);
  const workstreamContextBlock = buildWorkstreamContextBlock(rawProjectTitles, resolvedKeys, unresolvedTitles);

  // Tenant telemetry
  const telemetryLines: string[] = [];
  const profile = (m365ProfileRow[0]?.profile ?? null) as Record<string, unknown> | null;
  if (profile && Object.keys(profile).length > 0) {
    telemetryLines.push("M365 HEALTH PROFILE FLAGS:");
    for (const [k, v] of Object.entries(profile)) {
      telemetryLines.push(`  ${k}: ${String(v)}`);
    }
  }

  type ScoreRow = { category: string; score: number };
  const latestByCategory: Record<string, number> = {};
  for (const row of scoresRow as ScoreRow[]) {
    if (!(row.category in latestByCategory)) latestByCategory[row.category] = row.score;
  }
  if (Object.keys(latestByCategory).length > 0) {
    telemetryLines.push("\nHEALTH SCORES:");
    const CATEGORY_LABELS: Record<string, string> = {
      security: "Security Posture", compliance: "Compliance Coverage",
      copilot: "Copilot Readiness", governance: "Governance Maturity", productivity: "Adoption Score",
    };
    for (const [cat, score] of Object.entries(latestByCategory)) {
      telemetryLines.push(`  ${CATEGORY_LABELS[cat] ?? cat}: ${score}/100`);
    }
  }

  const typedRuns = scriptRuns as RunRow[];
  const allFindings = [...new Set(typedRuns.flatMap(r => r.parsedFindings ?? []))].slice(0, 40);
  const allRecs     = [...new Set(typedRuns.flatMap(r => r.recommendations ?? []))].slice(0, 30);
  if (allFindings.length > 0) {
    telemetryLines.push(`\nSCRIPT FINDINGS (${typedRuns.length} completed run${typedRuns.length === 1 ? "" : "s"}):`);
    for (const f of allFindings) telemetryLines.push(`  • ${f}`);
  }
  if (allRecs.length > 0) {
    telemetryLines.push("\nRECOMMENDATIONS FROM SCRIPTS:");
    for (const r of allRecs) telemetryLines.push(`  • ${r}`);
  }

  const mergedSowProfile: Record<string, unknown> = {};
  for (const run of [...typedRuns].reverse()) {
    Object.assign(mergedSowProfile, run.profileUpdates ?? {});
  }
  if (Object.keys(mergedSowProfile).length > 0) {
    telemetryLines.push("\nCONFIGURATION TELEMETRY (from script runs):");
    for (const [k, v] of Object.entries(mergedSowProfile)) {
      telemetryLines.push(`  ${k}: ${String(v)}`);
    }
  }

  const tenantTelemetryBlock = telemetryLines.length > 0
    ? telemetryLines.join("\n")
    : "No tenant telemetry collected yet — generate this SOW after running assessment scripts.";

  const sp = mergedSowProfile;
  const computedTier = computeTenantTier(sp.totalUserCount);
  const sowTenantFacts = [
    `Computed Tenant Tier:        ${computedTier}  ← server-derived from Total Users in Tenant (${sp.totalUserCount ?? "unknown"}); use this tier for all pricing — do NOT override`,
    `Total Users in Tenant:       ${sp.totalUserCount ?? "unknown"}`,
    `Licensed Users:              ${sp.licensedUserCount ?? "unknown"}`,
    `Unlicensed Users:            ${typeof sp.totalUserCount === "number" && typeof sp.licensedUserCount === "number" ? sp.totalUserCount - sp.licensedUserCount : "unknown"}`,
    `Active User Percent:         ${sp.activeUserPercent ?? "unknown"}%`,
    `SharePoint Sites:            ${sp.sharepointSiteCount ?? "unknown"}`,
    `Microsoft 365 Groups:        ${sp.m365GroupCount ?? "unknown"}`,
    `Teams Count:                 ${sp.teamCount ?? sp.teamsCount ?? "unknown"}`,
    `Public Teams:                ${sp.teamsPublicCount ?? "unknown"}`,
    `Guest Users:                 ${sp.guestUserCount ?? "unknown"}`,
    `External Sharing Enabled:    ${sp.externalSharingEnabled ?? "unknown"}`,
    `External Shares Found:       ${sp.externalUserSharesFound ?? "unknown"}`,
    `DLP Policies:                ${sp.dlpPoliciesCount ?? (sp.hasDLP === false ? 0 : "unknown")}`,
    `Sensitivity Labels:          ${sp.sensitivityLabelsConfigured === false ? "None configured" : (sp.sensitivityLabelsConfigured ?? "unknown")}`,
    `Retention Policies:          ${sp.hasRetentionPolicies === false ? "None" : (sp.hasRetentionPolicies ?? "unknown")}`,
    `Conditional Access Policies: ${sp.conditionalAccessPolicyCount ?? sp.conditionalAccessPoliciesCount ?? (sp.conditionalAccessEnabled === false ? 0 : "unknown")}`,
    `Copilot Licenses:            ${sp.copilotLicenseCount ?? (sp.hasCopilotLicenses === false ? 0 : "unknown")}`,
    `Copilot Readiness Score:     ${sp.copilotReadinessScore ?? "unknown"}/100`,
    `Intune Enabled:              ${sp.intuneEnabled ?? "unknown"}`,
    `MFA Enforced:                ${sp.mfaEnforced ?? "unknown"}`,
  ].join("\n");

  const copilotLicenseCountRaw = sp.copilotLicenseCount ?? (sp.hasCopilotLicenses === false ? 0 : -1);
  const hasZeroCopilotLicenses = Number(copilotLicenseCountRaw) === 0;
  // If Copilot is explicitly in the engagement project scope, keep it in the SOW regardless
  // of current license count — add a procurement callout instead of excluding it.
  const copilotInScope = resolvedKeys.includes("Copilot Readiness");
  const copilotExcluded = hasZeroCopilotLicenses && !copilotInScope;
  const consolidatedSowForcedExclude: string[] = copilotExcluded ? ["Copilot Readiness"] : [];
  const sowTenantFactsWithExclusions = sowTenantFacts + (
    copilotExcluded
      ? "\n⛔ WORKSTREAM EXCLUSION — Copilot / Copilot Deployment / AI Readiness: EXCLUDED." +
        " This client has 0 Copilot licenses and Copilot is not in the engagement project scope." +
        " Do NOT include any Copilot-related workstream in the per-workstream pricing table." +
        " Do NOT include 'Copilot Readiness' in the Pricing Adjustments table." +
        " Mention Copilot only as a future-state recommendation in the narrative — never as a billable workstream."
      : hasZeroCopilotLicenses && copilotInScope
        ? "\n⚠️ COPILOT LICENSE PROCUREMENT REQUIRED — This client currently has 0 Copilot for Microsoft 365" +
          " licenses. However, Copilot for Microsoft 365 Deployment IS in scope for this engagement." +
          " You MUST include the Copilot workstream in the per-workstream pricing table." +
          " In the Scope of Work section AND within the Copilot phase deliverables, include a prominent" +
          " callout box or NOTE paragraph stating exactly:" +
          ' "NOTE: Microsoft 365 Copilot licenses must be procured by the client at their own expense' +
          " prior to the commencement of the Copilot Deployment phase. License procurement is not included" +
          " in this Statement of Work. Shane McCaw Consulting will advise on licensing requirements and" +
          ' optimal SKU selection but will not purchase or manage licenses on behalf of the client."'
        : ""
  );

  const engagementStart = nextBusinessMonday(new Date());
  const engagementStartLabel = engagementStart.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const rawTemplate = promptOverride ?? await getPrompt(
    "insights-consulting-consolidated_sow",
    CONSOLIDATED_SOW_FALLBACK,
    ["{{scores}}", "{{findings}}", "{{typeLabel}}", "{{sectionHints}}"],
  );
  const pricingFormulaBlock = pricingFormulaOverride ?? await getSowPricingFormulaBlock(TIER_02_PRICING_FORMULA_BLOCK_FALLBACK);
  // ── Adjustment signal constraint block ────────────────────────────────────────
  // When adj:* rules are configured, inject a hard constraint that overrides the
  // ADJUSTMENT MAP's workstream-scoped logic with telemetry-derived results.
  let adjConstraintBlock = "";
  if (hasAdjSignalRules) {
    const allAdjSignals = await getAdjustmentSignalDefinitions();
    const activeAdj = allAdjSignals.filter(s => firedAdjSignalKeys.has(s.key));
    const inactiveAdj = allAdjSignals.filter(s => !firedAdjSignalKeys.has(s.key));
    const activeList = activeAdj.length > 0
      ? activeAdj.map(s => `  • ${s.label}`).join("\n")
      : "  (none — tenant telemetry did not trigger any adjustment)";
    const inactiveList = inactiveAdj.length > 0
      ? inactiveAdj.map(s => `  • ${s.label} — NOT triggered, do NOT include`).join("\n")
      : "  (none)";
    adjConstraintBlock = [
      "SIGNAL-GATED PRICING ADJUSTMENTS — HARD CONSTRAINT (supersedes the ADJUSTMENT MAP above):",
      "The signal engine evaluated this tenant's real telemetry and determined EXACTLY which adjustments apply.",
      "You MUST follow this list precisely — do NOT override it, add to it, or remove from it based on your own analysis.",
      "",
      "ACTIVE — include these adjustment rows in the Pricing Adjustments table:",
      activeList,
      "",
      "INACTIVE — do NOT include these rows under any circumstances:",
      inactiveList,
    ].join("\n");
  }

  const prompt = rawTemplate
    .replace(/\{\{clientName\}\}/g, clientName)
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{date\}\}/g, new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }))
    .replace(/\{\{engagementStart\}\}/g, engagementStartLabel)
    .replace(/\{\{existingDocs\}\}/g, docsBlock)
    .replace(/\{\{engagementProjects\}\}/g, projectsBlock)
    .replace(/\{\{tenantTelemetry\}\}/g, tenantTelemetryBlock)
    + `\n\n${workstreamContextBlock}\n\nCRITICAL — TENANT FACTS (use ONLY these exact numbers for all pricing adjustments; do NOT invent, estimate, or extrapolate any values not listed here):\n${sowTenantFactsWithExclusions}\n\nTIER 02 PRICING FORMULA (shared adjustments are calculated ONCE and shown in the summary section — never on individual rows):\n${pricingFormulaBlock}`
    + (adjConstraintBlock ? `\n\n${adjConstraintBlock}` : "")
    + (engineOutputsBlock ? `\n\n${engineOutputsBlock}` : "");

  // Find prior completed doc to replace on success
  let priorSowId: number | null = null;
  if (clientUserId && projectId) {
    const prior = await db.select({ id: insightsGeneratedDocumentsTable.id })
      .from(insightsGeneratedDocumentsTable)
      .where(and(
        eq(insightsGeneratedDocumentsTable.customerId, clientUserId),
        eq(insightsGeneratedDocumentsTable.projectId, projectId),
        eq(insightsGeneratedDocumentsTable.docType, "consolidated_sow"),
        inArray(insightsGeneratedDocumentsTable.status, ["draft", "approved", "delivered", "archived"]),
      ))
      .limit(1);
    priorSowId = prior[0]?.id ?? null;
  }

  log.info({ ...logCtx, docId }, "consolidated-sow-generator: starting AI generation");

  try {
  if (AI_KILL_SWITCH_ENABLED) {
    throw new Error("AI generation disabled by testing kill-switch (consolidated-sow-generator.ts)");
  }
  const docStylePrefix = await getDocumentStylePrefix();
  const stream = anthropic.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 32000,
    messages: [{ role: "user", content: docStylePrefix + prompt }],
  });
  const aiResponse = await stream.finalMessage();
  if (aiResponse.stop_reason === "max_tokens") {
    log.warn({ ...logCtx, docId }, "consolidated-sow-generator: output hit max_tokens — document may be truncated");
  }

  trackUsage({
    inputTokens: aiResponse.usage?.input_tokens ?? 0,
    outputTokens: aiResponse.usage?.output_tokens ?? 0,
    model: aiResponse.model || "claude-opus-4-8",
    clientUserId,
    docId,
  });

  const rawHtmlContent = extractAiHtml(aiResponse);
  const { workstreamLines: rawWs, adjustmentLines: rawAdj } = parseSowAllPricing(rawHtmlContent);

  // ── Signal-authoritative phase purge ────────────────────────────────────────
  // signalFilteredProjects is the deterministic, signal-gated project list used
  // to build the prompt. Any workstream row the AI produced that does not map to
  // one of these titles is a hallucinated phase — its triggering signal either
  // never fired or doesn't exist — and must never reach the client.
  const catalogTitles = signalFilteredProjects.map(p => p.title);
  const { html: htmlNoHallucinated, removedTitles: removedHallucinatedTitles } = purgeHallucinatedWorkstreams(
    rawHtmlContent, rawWs, catalogTitles,
  );
  if (removedHallucinatedTitles.length > 0) {
    log.error(
      { ...logCtx, docId, removedHallucinatedTitles, catalogTitles },
      "consolidated-sow-generator: SIGNAL/PHASE DRIFT — purged AI-hallucinated workstream phase(s) not backed by any fired signal",
    );
  }

  const { html: purgedHtml, removedTitles } = purgeSowAdjustments(
    htmlNoHallucinated, rawAdj, rawWs.map(l => l.title), consolidatedSowForcedExclude,
    hasAdjSignalRules ? firedAdjSignalKeys : undefined,
  );
  if (removedTitles.length > 0) {
    log.warn({ ...logCtx, docId, removedTitles }, "consolidated-sow-generator: purged non-permitted adjustments");
  }

  const { html: purgedHtmlTitle, removedTitles: removedByTitle } = purgeAdjustmentsByTitle(
    purgedHtml, rawWs.map(l => l.title),
  );
  if (removedByTitle.length > 0) {
    log.warn({ ...logCtx, docId, removedTitles: removedByTitle }, "consolidated-sow-generator: title-purge removed additional adjustments");
  }
  const anyPurged = removedTitles.length > 0 || removedByTitle.length > 0 || removedHallucinatedTitles.length > 0;

  const { workstreamLines: wsAfterPurge } = anyPurged
    ? parseSowAllPricing(purgedHtmlTitle)
    : { workstreamLines: rawWs };

  // ── Canonical title enforcement ─────────────────────────────────────────────
  // Rewrite any AI-reworded workstream title to the EXACT catalogue title so
  // the persisted sowPricingLines — and therefore the client-facing phase
  // checklist — never shows an AI paraphrase, only the deterministic
  // signal-catalogue title.
  const { html: canonicalizedHtml, renamedTitles } = canonicalizeWorkstreamTitles(
    purgedHtmlTitle, wsAfterPurge, catalogTitles,
  );
  if (renamedTitles.length > 0) {
    log.warn({ ...logCtx, docId, renamedTitles }, "consolidated-sow-generator: canonicalized reworded workstream title(s) to match signal catalogue");
  }

  // ── HARD ENFORCEMENT — inject any fired-signal phase the AI omitted ────────
  // detectSowPhaseDrift() alone can only observe and log a missing phase; it
  // cannot guarantee that every fired boolean signal deterministically
  // produces its mapped phase. injectMissingWorkstreams() closes that gap by
  // synthesizing the missing row(s) directly into the persisted HTML, so no
  // AI discretion over inclusion ever reaches the client.
  const catalogProjectsForInjection = signalFilteredProjects.map(p => ({ title: p.title, priceRange: p.priceRange }));
  const { html: htmlWithInjected, injected } = injectMissingWorkstreams(
    canonicalizedHtml, wsAfterPurge, catalogProjectsForInjection,
  );
  if (injected.length > 0) {
    log.error(
      { ...logCtx, docId, injectedTitles: injected.map(l => l.title) },
      "consolidated-sow-generator: SIGNAL/PHASE DRIFT — AI omitted fired-signal phase(s); injected deterministic row(s) so they still reach the client",
    );
  }

  // ── Engine-value reconciliation ──────────────────────────────────────────────
  // The prompt tells Claude to reproduce the pre-computed engine values
  // (finalPrice, priorityScore, architectureHealthScore, driftScore,
  // forecastScore, crmScore, mspPortfolioScore) verbatim wherever it references
  // them — but that instruction alone has no enforcement. Scan the generated
  // HTML for any place the AI actually wrote one of these metrics out and
  // overwrite it with the deterministic engine value if it drifted.
  const { html: reconciledHtml, corrections: engineValueCorrections } = reconcileEngineValues(
    htmlWithInjected, engineValues,
  );
  if (engineValueCorrections.length > 0) {
    log.warn(
      { ...logCtx, docId, engineValueCorrections },
      "consolidated-sow-generator: ENGINE VALUE DRIFT — AI misreported a pre-computed engine value; corrected in place",
    );
  }

  const purgedHtmlFinal = reconciledHtml;
  const { workstreamLines, adjustmentLines, computedTotal } = parseSowAllPricing(purgedHtmlFinal);

  // Runtime drift guard — this MUST be a no-op after canonicalization +
  // injection above. If it still reports drift, the workstream table could
  // not be located/repaired (e.g. a malformed AI response with no table at
  // all) — fail generation loudly rather than silently persist an incomplete
  // or non-deterministic SOW to the client.
  const phaseDrift = detectSowPhaseDrift(workstreamLines, catalogTitles);
  if (!phaseDrift.ok) {
    log.error(
      { ...logCtx, docId, missingPhases: phaseDrift.missingPhases, hallucinatedPhases: phaseDrift.hallucinatedPhases },
      "consolidated-sow-generator: SIGNAL/PHASE DRIFT — unrecoverable after canonicalization + injection; failing generation",
    );
    throw new Error(
      `SOW generation failed: signal/phase drift could not be reconciled — missing: [${phaseDrift.missingPhases.join(", ")}], hallucinated: [${phaseDrift.hallucinatedPhases.join(", ")}]`,
    );
  }

  const sowValidation = validateSowPricing(
    workstreamLines, adjustmentLines, purgedHtmlFinal,
    hasAdjSignalRules ? firedAdjSignalKeys : undefined,
  );
  if (!sowValidation.ok) {
    log.warn({ ...logCtx, docId, issues: sowValidation.issues }, "consolidated-sow-generator: pricing validation warnings");
  }

  // ── Engine-value audit trail ────────────────────────────────────────────────
  // engineValues is always populated at this point — the try/catch above aborts
  // generation entirely (throws before the AI is even called) if engine
  // pre-computation fails, so a document can never reach persistence without
  // its pre-computed intelligence-engine numbers. Log them alongside the final
  // docId here so every generated SOW has a queryable, permanent record of the
  // exact deterministic values Claude was given — enabling after-the-fact
  // audit of whether a document's content is consistent with them.
  log.info(
    { ...logCtx, docId, ...engineValues, sowGrandTotal: computedTotal },
    "consolidated-sow-generator: engine-value audit trail — values supplied to AI for this document",
  );

  const htmlContent = computedTotal > 0 ? patchSowGrandTotal(purgedHtmlFinal, computedTotal) : purgedHtmlFinal;
  const sowLines: SowPricingLine[] = [
    ...assignDeliveryDates(
      workstreamLines.map(l => ({ ...l, line_type: "workstream" as const })),
      engagementStart,
    ),
    ...adjustmentLines.map(l => ({ ...l, line_type: "adjustment" as const })),
  ];
  const sowTotal = computedTotal;

  const sowLinesValidation = z.array(SowPricingLineSchema).safeParse(sowLines);
  if (!sowLinesValidation.success) {
    log.warn({ ...logCtx, docId, issues: sowLinesValidation.error.issues }, "consolidated-sow-generator: sowPricingLines schema warning — persisting anyway");
  }

  if (testMode) {
    log.info({ ...logCtx, sowTotal }, "consolidated-sow-generator: test-draft generation complete (no persistence)");
    pushSowDebugLog(correlationId, "info", "Test-draft generation complete (no persistence)", { sowTotal });
    finishSowDebugRun(correlationId, "success");
    return { docId: -1, clientName, sowTotal, htmlContent, correlationId };
  }

  await db.update(insightsGeneratedDocumentsTable)
    .set({
      htmlContent,
      status:      "approved",
      approvedAt:  new Date(),
      pdfUrl:      null,
      sowPricingLines: sowLines.length > 0 ? sowLines : null,
      sowTotalPrice:   sowTotal > 0 ? String(sowTotal) : null,
      signalFilterMeta,
      updatedAt:   new Date(),
    })
    .where(eq(insightsGeneratedDocumentsTable.id, docId));

  if (supersedeMode === "archive") {
    // Preserve prior scope versions (incl. the original full-scope document) so the
    // Assessment scope selector can re-activate them for free. Archive every other
    // completed consolidated_sow row for this customer+project — exactly one row
    // (this newly-approved docId) stays "approved"/active; the rest become "archived"
    // (superseded, hidden by the reader filters, but still retrievable by exact match).
    await db.update(insightsGeneratedDocumentsTable)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(
        eq(insightsGeneratedDocumentsTable.customerId, clientUserId),
        projectId != null
          ? eq(insightsGeneratedDocumentsTable.projectId, projectId)
          : isNull(insightsGeneratedDocumentsTable.projectId),
        eq(insightsGeneratedDocumentsTable.docType, "consolidated_sow"),
        ne(insightsGeneratedDocumentsTable.id, docId),
        inArray(insightsGeneratedDocumentsTable.status, ["draft", "approved", "delivered"]),
      ));
  } else if (priorSowId !== null) {
    await db.delete(insightsGeneratedDocumentsTable)
      .where(eq(insightsGeneratedDocumentsTable.id, priorSowId));
  }

  const pdfUrl = `/api/admin/insights/documents/${docId}/download`;
  await db.update(insightsGeneratedDocumentsTable)
    .set({ pdfUrl })
    .where(eq(insightsGeneratedDocumentsTable.id, docId));

  if (projectId) {
    void syncPresentationDocIds(projectId, docId, "consolidated_sow");
  }

  log.info({ ...logCtx, docId, sowTotal }, "consolidated-sow-generator: completed successfully");
  pushSowDebugLog(correlationId, "info", "Completed successfully", { docId, sowTotal });
  finishSowDebugRun(correlationId, "success");
  return { docId, clientName, sowTotal, correlationId };
  } catch (err) {
    log.error({ ...logCtx, docId, err }, "consolidated-sow-generator: AI generation failed");
    pushSowDebugLog(correlationId, "error", "AI generation failed", { error: err instanceof Error ? err.message : String(err) });
    finishSowDebugRun(correlationId, "failed", err instanceof Error ? err.message : String(err));
    if (!testMode) {
      await db.update(insightsGeneratedDocumentsTable)
        .set({ status: "failed", errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500), updatedAt: new Date() })
        .where(eq(insightsGeneratedDocumentsTable.id, docId))
        .catch(dbErr => log.warn({ dbErr, docId }, "consolidated-sow-generator: failed to mark row as failed"));
    }
    throw err;
  }
}
