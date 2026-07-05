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
} from "@workspace/db";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { computeTenantSignals, TENANT_SIGNALS, ADJUSTMENT_SIGNALS, projectMatchesSignals } from "./tenant-signals";
import { detectRuleConflicts } from "./signal-conflict-detector";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";
import { getPrompt, getDocumentStylePrefix } from "./prompt-loader";
import {
  extractAiHtml,
  parseSowAllPricing,
  patchSowGrandTotal,
  purgeSowAdjustments,
  purgeAdjustmentsByTitle,
  validateSowPricing,
  nextBusinessMonday,
  assignDeliveryDates,
  ADJ_SIGNAL_PATTERNS,
  SowPricingLineSchema,
  type SowPricingLine,
} from "./sow-pricing";
import { resolveWorkstreamKeys, buildWorkstreamContextBlock } from "./workstream-normalizer";
import {
  broadcastPresentationScopeChange,
  broadcastPresentationDocsChange,
} from "./sse-broadcast";

export function computeTenantTier(totalUsers: number | unknown): "Tier01" | "Tier02" | "Tier03" | "Tier04" {
  const n = typeof totalUsers === "number" ? totalUsers : Number(totalUsers);
  if (!Number.isFinite(n) || n <= 0) return "Tier01";
  if (n <= 50)  return "Tier01";
  if (n <= 250) return "Tier02";
  if (n <= 750) return "Tier03";
  return "Tier04";
}

export const TIER_02_PRICING_FORMULA_BLOCK = `You are pricing Microsoft 365 remediation projects for Shane McCaw Consulting. These are NOT assessments — they are project-based engagements where real problems are fixed.

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

ENGAGEMENT PROJECT PRICING CATALOGUE (MANDATORY — every project listed below IS the defined scope for this engagement. You MUST include EVERY project in the pricing table. Do not omit any project, even if tenant telemetry does not specifically call it out — the catalogue defines the full agreed scope):
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
    logger.warn({ err, projectId, newDocId }, "syncPresentationDocIds: failed (non-fatal)");
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
    logger.warn({ err, projectId }, "broadcastSowChangeForProject: failed");
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
    logger.warn({ err, projectId }, "broadcastDocsChangeForProject: failed");
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
}

export interface GenerateConsolidatedSowResult {
  docId: number;
  clientName: string;
  sowTotal: number;
}

export async function generateConsolidatedSowDocument(
  params: GenerateConsolidatedSowParams,
): Promise<GenerateConsolidatedSowResult> {
  const { clientUserId, projectId, title, runId } = params;
  const logCtx = { clientUserId, projectId, title, runId };

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

  let signalFilteredProjects = allEngagementProjects;
  let signalFilterMeta: { clean: boolean; conflictCount: number; conflicts?: Array<{ ruleIds: number[]; description: string }> } = { clean: true, conflictCount: 0 };
  // Adjustment signal keys that fired for this tenant — populated inside the try block.
  // When non-empty, used to inject a hard constraint into the SOW prompt and to gate
  // the validate/purge pass.  Stays empty if no adj:* rules are configured in the DB.
  let firedAdjSignalKeys = new Set<string>();
  let hasAdjSignalRules = false;
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

    // ── Conflict detection ───────────────────────────────────────────────────
    type RuleRow = Parameters<typeof computeTenantSignals>[2][number];
    const typedSignalRules = signalRules.rows as unknown as RuleRow[];
    const conflicts = detectRuleConflicts(typedSignalRules);
    if (conflicts.length > 0) {
      signalFilterMeta = { clean: false, conflictCount: conflicts.length, conflicts };
      for (const conflict of conflicts) {
        logger.warn(
          { ...logCtx, ruleIds: conflict.ruleIds, conflictDescription: conflict.description },
          "consolidated-sow-generator: signal rule conflict detected — project list may be incorrect",
        );
      }
    }

    // Always evaluate signals — empty rules means no signals fire, which is the correct
    // deterministic baseline. Projects with signal-key triggers require a matching fired
    // signal to be included; the legacy guard allows old plan-name strings through.
    const { firedSignals } = computeTenantSignals(
      mergedSowProfileForSignals,
      allFindingsForSignals,
      typedSignalRules,
      signalGroups.rows as unknown as Parameters<typeof computeTenantSignals>[3],
    );

    // Extract adj:* keys — these drive pricing adjustment gating, not project inclusion.
    hasAdjSignalRules = typedSignalRules.some(r => r.signalKey.startsWith("adj:"));
    if (hasAdjSignalRules) {
      for (const key of firedSignals) {
        if (key.startsWith("adj:")) firedAdjSignalKeys.add(key);
      }
      logger.info(
        { ...logCtx, firedAdjSignalKeys: [...firedAdjSignalKeys] },
        "consolidated-sow-generator: adjustment signal evaluation complete",
      );
    }

    const knownSignalKeys = new Set(TENANT_SIGNALS.map(s => s.key));

    signalFilteredProjects = allEngagementProjects.filter(p => {
      const triggers = Array.isArray(p.triggeredBy) ? p.triggeredBy as string[] : [];
      const legacyTriggers = triggers.filter(t => !knownSignalKeys.has(t));
      if (legacyTriggers.length > 0) {
        logger.warn(
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
        logger.debug({ ...logCtx, projectTitle: p.title, reason },
          "consolidated-sow-generator: project excluded by signal gate");
      }
      return included;
    });

    const excludedTitles = allEngagementProjects
      .filter(p => !signalFilteredProjects.includes(p))
      .map(p => p.title);
    if (excludedTitles.length > 0) {
      logger.info({ ...logCtx, excludedTitles, firedSignals: [...firedSignals] },
        "consolidated-sow-generator: signal filter excluded projects");
    }
  } catch (signalErr) {
    logger.warn({ ...logCtx, signalErr }, "consolidated-sow-generator: signal evaluation failed — using all projects");
  }

  const projectsBlock = signalFilteredProjects.length > 0
    ? signalFilteredProjects.map(p =>
        `• ${p.title} — ${p.priceRange}${p.meaning ? `\n  ${p.meaning}` : ""}${p.description ? `\n  ${p.description}` : ""}${(p.sowItems as string[] | null)?.length ? `\n  Deliverables: ${(p.sowItems as string[]).join(", ")}` : ""}`
      ).join("\n\n")
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

  const rawTemplate = await getPrompt(
    "insights-consulting-consolidated_sow",
    CONSOLIDATED_SOW_FALLBACK,
    ["{{scores}}", "{{findings}}", "{{typeLabel}}", "{{sectionHints}}"],
  );
  // ── Adjustment signal constraint block ────────────────────────────────────────
  // When adj:* rules are configured, inject a hard constraint that overrides the
  // ADJUSTMENT MAP's workstream-scoped logic with telemetry-derived results.
  let adjConstraintBlock = "";
  if (hasAdjSignalRules) {
    const allAdjSignals = ADJUSTMENT_SIGNALS;
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
    + `\n\n${workstreamContextBlock}\n\nCRITICAL — TENANT FACTS (use ONLY these exact numbers for all pricing adjustments; do NOT invent, estimate, or extrapolate any values not listed here):\n${sowTenantFactsWithExclusions}\n\nTIER 02 PRICING FORMULA (shared adjustments are calculated ONCE and shown in the summary section — never on individual rows):\n${TIER_02_PRICING_FORMULA_BLOCK}`
    + (adjConstraintBlock ? `\n\n${adjConstraintBlock}` : "");

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

  const [genSowRow] = await db.insert(insightsGeneratedDocumentsTable).values({
    customerId: clientUserId,
    projectId:  projectId ?? null,
    category:   "consulting",
    docType:    "consolidated_sow",
    title,
    htmlContent: "",
    status:     "generating",
    pdfUrl:     null,
  }).returning({ id: insightsGeneratedDocumentsTable.id });
  const docId = genSowRow!.id;

  // Notify caller synchronously so HTTP routes can send the docId before the slow AI step.
  params.onRowCreated?.(docId);

  logger.info({ ...logCtx, docId }, "consolidated-sow-generator: starting AI generation");

  try {
  const docStylePrefix = await getDocumentStylePrefix();
  const stream = anthropic.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 32000,
    messages: [{ role: "user", content: docStylePrefix + prompt }],
  });
  const aiResponse = await stream.finalMessage();
  if (aiResponse.stop_reason === "max_tokens") {
    logger.warn({ ...logCtx, docId }, "consolidated-sow-generator: output hit max_tokens — document may be truncated");
  }

  const rawHtmlContent = extractAiHtml(aiResponse);
  const { workstreamLines: rawWs, adjustmentLines: rawAdj } = parseSowAllPricing(rawHtmlContent);

  const { html: purgedHtml, removedTitles } = purgeSowAdjustments(
    rawHtmlContent, rawAdj, rawWs.map(l => l.title), consolidatedSowForcedExclude,
    hasAdjSignalRules ? firedAdjSignalKeys : undefined,
  );
  if (removedTitles.length > 0) {
    logger.warn({ ...logCtx, docId, removedTitles }, "consolidated-sow-generator: purged non-permitted adjustments");
  }

  const { html: purgedHtmlFinal, removedTitles: removedByTitle } = purgeAdjustmentsByTitle(
    purgedHtml, rawWs.map(l => l.title),
  );
  if (removedByTitle.length > 0) {
    logger.warn({ ...logCtx, docId, removedTitles: removedByTitle }, "consolidated-sow-generator: title-purge removed additional adjustments");
  }
  const anyPurged = removedTitles.length > 0 || removedByTitle.length > 0;

  const { workstreamLines, adjustmentLines, computedTotal } = anyPurged
    ? parseSowAllPricing(purgedHtmlFinal)
    : {
        workstreamLines: rawWs,
        adjustmentLines: rawAdj,
        computedTotal: rawWs.reduce((s, l) => s + l.priceUsd, 0) + rawAdj.reduce((s, l) => s + l.priceUsd, 0),
      };

  const sowValidation = validateSowPricing(
    workstreamLines, adjustmentLines, purgedHtmlFinal,
    hasAdjSignalRules ? firedAdjSignalKeys : undefined,
  );
  if (!sowValidation.ok) {
    logger.warn({ ...logCtx, docId, issues: sowValidation.issues }, "consolidated-sow-generator: pricing validation warnings");
  }

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
    logger.warn({ ...logCtx, docId, issues: sowLinesValidation.error.issues }, "consolidated-sow-generator: sowPricingLines schema warning — persisting anyway");
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

  if (priorSowId !== null) {
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

  logger.info({ ...logCtx, docId, sowTotal }, "consolidated-sow-generator: completed successfully");
  return { docId, clientName, sowTotal };
  } catch (err) {
    logger.error({ ...logCtx, docId, err }, "consolidated-sow-generator: AI generation failed");
    await db.update(insightsGeneratedDocumentsTable)
      .set({ status: "failed", errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500), updatedAt: new Date() })
      .where(eq(insightsGeneratedDocumentsTable.id, docId))
      .catch(dbErr => logger.warn({ dbErr, docId }, "consolidated-sow-generator: failed to mark row as failed"));
    throw err;
  }
}
