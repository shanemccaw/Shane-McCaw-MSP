import { Router, type IRouter, type Request, type Response } from "express";
import { db, quickWinPresentationsTable, insightsGeneratedDocumentsTable, projectsTable, clientServicesTable, servicesTable, workflowTemplatesTable, usersTable, contractTemplatesTable, clientM365ProfilesTable, scriptRunResultsTable } from "@workspace/db";
import { eq, and, desc, asc, inArray, or, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.ts";
import jwt from "jsonwebtoken";
import { getStripeKey } from "../lib/stripe.ts";
import { stripStagedForReviewBanner, stripTierDetectionText, WORKSTREAM_ADJ_MAP, ADJ_SIGNAL_PATTERNS } from "../lib/sow-pricing.ts";
import { computeTenantSignals, getAdjustmentSignalDefinitions, getDisabledSignalKeys, resolveSiblingUserIds, type SignalDerivationRule, type SignalRuleGroup } from "../lib/tenant-signals.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

type SowPhaseObj = { id: string; title: string; description: string; price: number; selected: boolean; weeks?: number; deliveryDate?: string | null };

// Compute a stable fingerprint for the current SOW pricing so clients can
// detect when the scope has changed without comparing full phase arrays.
function computeSowVersion(phases: SowPhaseObj[]): string {
  return phases.map(p => `${p.id}:${p.price}`).join("|");
}

/**
 * Signal-authoritative adjustment sourcing.
 *
 * The client's fired tenant signals (the same evaluation used when the SOW was
 * generated) are the authoritative answer to *which* Price Adjustments belong
 * in the total. This function recomputes those signals from the client's live
 * M365 profile + script-run findings, then matches each fired `adj:*` signal
 * to its priced row in the SOW's stored `sowPricingLines` (line_type
 * "adjustment") via `ADJ_SIGNAL_PATTERNS` — never via HTML scraping or a
 * grand-total-minus-workstreams guess.
 *
 * Returns `success: false` only when the signal computation itself fails
 * (e.g. DB error) — callers should treat that as "signals unavailable" and
 * fall back to a legacy method, clearly logged. A successful computation that
 * yields zero fired adjustment signals is NOT a failure — it correctly means
 * $0 in adjustments.
 */
async function computeSignalDrivenAdjustments(
  clientUserId: number | null | undefined,
  pricingLines: unknown,
): Promise<{
  success: boolean;
  firedAdjKeys: string[];
  adjustmentsTotal: number;
  namedAdjustmentLines: Array<{ title: string; description: string; price: number }>;
}> {
  if (!clientUserId) {
    return { success: false, firedAdjKeys: [], adjustmentsTotal: 0, namedAdjustmentLines: [] };
  }
  try {
    const [profileRow] = await db.select({ profile: clientM365ProfilesTable.profile })
      .from(clientM365ProfilesTable)
      .where(eq(clientM365ProfilesTable.clientId, clientUserId))
      .limit(1);

    const scriptRuns = await db.select({
      parsedFindings: scriptRunResultsTable.parsedFindings,
      profileUpdates: scriptRunResultsTable.profileUpdates,
    })
      .from(scriptRunResultsTable)
      .where(and(eq(scriptRunResultsTable.customerId, clientUserId), eq(scriptRunResultsTable.status, "completed")))
      .orderBy(desc(scriptRunResultsTable.createdAt))
      .limit(50);

    const mergedProfile: Record<string, unknown> = { ...((profileRow?.profile as Record<string, unknown> | null) ?? {}) };
    for (const run of [...scriptRuns].reverse()) Object.assign(mergedProfile, run.profileUpdates ?? {});
    const allFindings = [...new Set(scriptRuns.flatMap(r => r.parsedFindings ?? []))];

    const [signalRulesRes, signalGroupsRes, disabledSignalKeys] = await Promise.all([
      db.execute(sql`SELECT id, signal_key AS "signalKey", group_id AS "groupId", rule_type AS "ruleType", source_key AS "sourceKey", compare_value AS "compareValue", sort_order AS "sortOrder" FROM signal_derivation_rules ORDER BY signal_key, sort_order, id`),
      db.execute(sql`SELECT id, signal_key AS "signalKey", logic, label, sort_order AS "sortOrder", created_at AS "createdAt" FROM signal_rule_groups ORDER BY signal_key, sort_order, id`),
      getDisabledSignalKeys(),
    ]);

    const { firedSignals } = computeTenantSignals(
      mergedProfile,
      allFindings,
      signalRulesRes.rows as unknown as SignalDerivationRule[],
      signalGroupsRes.rows as unknown as SignalRuleGroup[],
      disabledSignalKeys,
    );

    const firedAdjKeys = (await getAdjustmentSignalDefinitions()).map(s => s.key).filter(k => firedSignals.has(k));

    const adjustmentLines = (Array.isArray(pricingLines) ? pricingLines : [])
      .filter((l): l is { title: string; scope?: string; priceUsd: number; notes?: string; line_type?: string } =>
        !!l && typeof l === "object" && (l as { line_type?: string }).line_type === "adjustment");

    const namedAdjustmentLines: Array<{ title: string; description: string; price: number }> = [];
    let adjustmentsTotal = 0;
    for (const key of firedAdjKeys) {
      const entry = ADJ_SIGNAL_PATTERNS[key];
      const match = entry ? adjustmentLines.find(l => entry.pattern.test(l.title)) : undefined;
      if (match) {
        adjustmentsTotal += match.priceUsd;
        namedAdjustmentLines.push({ title: match.title, description: match.scope || match.notes || "", price: match.priceUsd });
      } else {
        log.warn(
          { clientUserId, signalKey: key, label: entry?.label },
          "deriveEffectiveSowData: adjustment signal fired but no matching priced row found in SOW pricing lines — adjustment omitted from total",
        );
      }
    }

    return { success: true, firedAdjKeys, adjustmentsTotal, namedAdjustmentLines };
  } catch (err) {
    log.warn({ err, clientUserId }, "deriveEffectiveSowData: failed to compute signal-driven adjustments — falling back to legacy method");
    return { success: false, firedAdjKeys: [], adjustmentsTotal: 0, namedAdjustmentLines: [] };
  }
}

async function deriveEffectiveSowData(
  pres: {
    documentsIncluded: unknown;
    sowPhases: unknown;
    selectedPhaseIds: unknown;
    totalPrice: unknown;
    projectId?: number | null;
    clientUserId?: number | null;
  },
  storedSelectedIds?: string[],
): Promise<{
  effectiveSowPhases: SowPhaseObj[];
  effectiveSelectedPhaseIds: string[];
  effectiveTotalPrice: number;
  adjustmentsTotal: number;
  namedAdjustmentLines: Array<{ title: string; description: string; price: number }>;
  sowVersion: string;
}> {
  // ── SOW document pricing lines lookup ──────────────────────────────────────
  // Fetched up front because both the AI-generated-phases path (Priority 1) and
  // the SOW-document path (Priority 2) need the stored adjustment line amounts
  // to resolve the signal-driven adjustments total — neither path may skip this.
  const docIds = (pres.documentsIncluded ?? []) as number[];

  const docsWithPricing = docIds.length > 0
    ? await db.select({
        docType: insightsGeneratedDocumentsTable.docType,
        sowPricingLines: insightsGeneratedDocumentsTable.sowPricingLines,
        sowTotalPrice: insightsGeneratedDocumentsTable.sowTotalPrice,
      })
        .from(insightsGeneratedDocumentsTable)
        .where(inArray(insightsGeneratedDocumentsTable.id, docIds))
    : [];

  let sowDoc = docsWithPricing.find(
    d =>
      (d.docType === "consolidated_sow" || d.docType === "sow") &&
      Array.isArray(d.sowPricingLines) &&
      (d.sowPricingLines as unknown[]).length > 0,
  );

  // Secondary lookup: if the included docs contain no SOW with pricing, check the
  // project's most recent approved consolidated_sow / sow. This handles the common
  // case where the SOW was generated after the presentation was created and therefore
  // its doc ID was never added to documentsIncluded.
  if (!sowDoc && pres.projectId) {
    const [projectSow] = await db.select({
      docType: insightsGeneratedDocumentsTable.docType,
      sowPricingLines: insightsGeneratedDocumentsTable.sowPricingLines,
      sowTotalPrice: insightsGeneratedDocumentsTable.sowTotalPrice,
    })
      .from(insightsGeneratedDocumentsTable)
      .where(
        and(
          eq(insightsGeneratedDocumentsTable.projectId, pres.projectId),
          inArray(insightsGeneratedDocumentsTable.docType, ["consolidated_sow", "sow"]),
          inArray(insightsGeneratedDocumentsTable.status, ["approved", "delivered"]),
        )
      )
      .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
      .limit(1);
    if (projectSow && Array.isArray(projectSow.sowPricingLines) && (projectSow.sowPricingLines as unknown[]).length > 0) {
      sowDoc = projectSow;
    }
  }

  // ── Signal-authoritative adjustments ────────────────────────────────────────
  // The client's fired tenant signals decide *which* adjustments count; their
  // dollar amounts still come from the SOW's stored, signal-tagged pricing lines.
  const signalAdjustments = await computeSignalDrivenAdjustments(pres.clientUserId, sowDoc?.sowPricingLines);

  // ── Priority 1: AI-generated phases from save_presentation_phases ────────────
  // When the Building Plan workflow has run, save_presentation_phases writes the
  // AI phases (with pre-distributed prices) into pres.sowPhases.  These are the
  // authoritative source for workstream phases — but adjustments must still be
  // resolved from the client's fired signals rather than hardcoded to zero.
  const aiPhases = (pres.sowPhases ?? []) as SowPhaseObj[];
  const hasAiGeneratedPhases = aiPhases.length > 0 && aiPhases.every(p => typeof p.id === "string" && (p.id as string).startsWith("sow-"));
  if (hasAiGeneratedPhases) {
    const storedIds = ((storedSelectedIds ?? pres.selectedPhaseIds) ?? []) as string[];
    const allAiIds  = aiPhases.map(p => p.id);
    const intersection = storedIds.filter(id => allAiIds.includes(id));
    // Default to all selected when stored IDs don't match (e.g. stale sow-0 pointer)
    const effectiveSelectedPhaseIds = intersection.length > 0 ? intersection : allAiIds;
    const effectiveSowPhases = aiPhases.map(p => ({
      ...p,
      selected: effectiveSelectedPhaseIds.includes(p.id),
    }));
    const selectedTotal = effectiveSowPhases
      .filter(p => p.selected)
      .reduce((s, p) => s + p.price, 0);
    const adjustmentsTotal = signalAdjustments.success ? signalAdjustments.adjustmentsTotal : 0;
    const namedAdjustmentLines = signalAdjustments.success ? signalAdjustments.namedAdjustmentLines : [];
    if (!signalAdjustments.success) {
      log.warn(
        { projectId: pres.projectId },
        "deriveEffectiveSowData: signal-driven adjustments unavailable for AI-generated-phases path — adjustments defaulted to 0",
      );
    }
    return {
      effectiveSowPhases,
      effectiveSelectedPhaseIds,
      effectiveTotalPrice: selectedTotal + adjustmentsTotal,
      adjustmentsTotal,
      namedAdjustmentLines,
      sowVersion: computeSowVersion(effectiveSowPhases),
    };
  }

  // ── Priority 2: SOW document pricing lines ────────────────────────────────────
  if (sowDoc && Array.isArray(sowDoc.sowPricingLines) && sowDoc.sowPricingLines.length > 0) {
    const livelines = sowDoc.sowPricingLines as Array<{ title: string; scope: string; priceUsd: number; notes: string; line_type?: string; weeks?: number; deliveryDate?: string | null }>;

    // Separate workstream lines (customer-toggleable) from adjustment lines (mandatory).
    // Old rows without line_type are treated as workstream for backwards compatibility.
    const workstreamLivelines = livelines.filter(l => l.line_type !== "adjustment");
    const adjustmentLivelines = livelines.filter(l => l.line_type === "adjustment");

    const allPhases: SowPhaseObj[] = workstreamLivelines.map((l, i) => ({
      id: `sow-${i}`,
      title: l.title,
      description: l.scope || l.notes || "",
      price: l.priceUsd,
      selected: true,
      ...(l.weeks !== undefined ? { weeks: l.weeks } : {}),
      ...(l.deliveryDate != null ? { deliveryDate: l.deliveryDate } : {}),
    }));

    const allNewIds = allPhases.map(p => p.id);
    const stored = storedSelectedIds ?? (pres.selectedPhaseIds ?? []) as string[];
    // Intersect stored selections with the live phase IDs; default to all if empty
    const intersection = stored.filter(sid => allNewIds.includes(sid));
    const effectiveSelectedPhaseIds = intersection.length > 0 ? intersection : allNewIds;

    const effectiveSowPhases = allPhases.map(p => ({
      ...p,
      selected: effectiveSelectedPhaseIds.includes(p.id),
    }));

    // Adjustments are mandatory for the selected scope — always applied regardless of
    // which phases are toggled on/off (phase selection only removes workstream rows,
    // never adjustment rows). The client's fired tenant signals are the authoritative
    // source for which adjustments count; only fall back to the legacy
    // workstream-scoped/gap-based method when signal computation itself failed.
    let adjustmentsTotal: number;
    let namedAdjustmentLines: Array<{ title: string; description: string; price: number }>;

    if (signalAdjustments.success) {
      adjustmentsTotal = signalAdjustments.adjustmentsTotal;
      namedAdjustmentLines = signalAdjustments.namedAdjustmentLines;
    } else {
      log.warn(
        { projectId: pres.projectId },
        "deriveEffectiveSowData: signal-driven adjustments unavailable — using legacy workstream-scoped/gap fallback for this (likely pre-signal) SOW",
      );

      // Strip aggregation rows (subtotals, grand totals) that were accidentally stored.
      const realAdjustmentLines = adjustmentLivelines.filter(l => {
        const t = l.title.toLowerCase();
        return !t.includes("subtotal") && !t.includes("grand total") && t !== "total";
      });

      // Apply workstream-scoped ADJUSTMENT MAP — only include adjustments permitted
      // for the workstream types present in this SOW.
      const workstreamTitles = effectiveSowPhases.filter(p => p.selected).map(p => p.title);
      let anyWorkstreamMatched = false;
      const allowedAdjPatterns: RegExp[] = [];
      for (const { ws, allowed } of WORKSTREAM_ADJ_MAP) {
        if (workstreamTitles.some(t => ws.test(t))) {
          allowedAdjPatterns.push(...allowed);
          anyWorkstreamMatched = true;
        }
      }
      const scopedAdjustmentLines = !anyWorkstreamMatched
        ? realAdjustmentLines
        : allowedAdjPatterns.length > 0
          ? realAdjustmentLines.filter(l => allowedAdjPatterns.some(p => p.test(l.title)))
          : [];

      if (scopedAdjustmentLines.length > 0) {
        adjustmentsTotal = scopedAdjustmentLines.reduce((s, l) => s + l.priceUsd, 0);
      } else if (adjustmentLivelines.length > 0) {
        // All tagged lines were aggregation rows or filtered out — treat as 0.
        adjustmentsTotal = 0;
      } else {
        const allPhasesSum = livelines.reduce((s, l) => s + l.priceUsd, 0);
        const sowGrandTotal = sowDoc.sowTotalPrice ? parseFloat(String(sowDoc.sowTotalPrice)) : allPhasesSum;
        adjustmentsTotal = Math.max(0, sowGrandTotal - allPhasesSum);
      }

      namedAdjustmentLines = scopedAdjustmentLines.map(l => ({
        title: l.title,
        description: l.scope || l.notes || "",
        price: l.priceUsd,
      }));
    }

    const selectedPhasesTotal = effectiveSowPhases
      .filter(p => p.selected)
      .reduce((sum, p) => sum + p.price, 0);
    const effectiveTotalPrice = selectedPhasesTotal + adjustmentsTotal;

    return { effectiveSowPhases, effectiveSelectedPhaseIds, effectiveTotalPrice, adjustmentsTotal, namedAdjustmentLines, sowVersion: computeSowVersion(effectiveSowPhases) };
  }

  // No live SOW pricing — fall back to creation-time snapshot.
  // Compute a fresh total from the selected phases (the stored totalPrice may be
  // stale if the presentation was created before the SOW was finalised).
  const fallbackPhases = (pres.sowPhases ?? []) as SowPhaseObj[];
  const storedFallbackIds = ((storedSelectedIds ?? pres.selectedPhaseIds) ?? []) as string[];
  const allFallbackIds = fallbackPhases.map(p => p.id);
  const fallbackIntersection = storedFallbackIds.filter(id => allFallbackIds.includes(id));
  const fallbackSelectedIds = fallbackIntersection.length > 0 ? fallbackIntersection : allFallbackIds;
  const effectiveSowPhases = fallbackPhases.map(p => ({
    ...p,
    selected: fallbackSelectedIds.includes(p.id),
  }));
  const selectedPhasesTotal = effectiveSowPhases.filter(p => p.selected).reduce((s, p) => s + p.price, 0);
  return {
    effectiveSowPhases,
    effectiveSelectedPhaseIds: fallbackSelectedIds,
    effectiveTotalPrice: selectedPhasesTotal,
    adjustmentsTotal: 0,
    // Snapshot fallback has no individual adjustment line detail
    namedAdjustmentLines: [] as Array<{ title: string; description: string; price: number }>,
    sowVersion: computeSowVersion(effectiveSowPhases),
  };
}

/**
 * Scope-aware effective price resolver.
 *
 * `deriveEffectiveSowData` always derives its total from the full/consolidated
 * SOW pricing lines (or AI-generated phases) — it has no concept of a scoped
 * SOW. When a client has reduced scope, the binding price is the *scoped*
 * total (`pres.scopedTotalPrice`), not the consolidated total. Any endpoint
 * that charges, signs, or displays a binding price MUST go through this
 * helper instead of using `deriveEffectiveSowData`'s totals directly, or it
 * will silently charge/sign/display the full-SOW price even when a scope
 * reduction is active — mirroring the same validity checks used by the GET
 * presentation endpoint (sowVersion drift + total-price drift) so a stale
 * scoped SOW is never trusted.
 */
async function resolveScopeAwarePrice(
  pres: {
    scopedPhaseIds: unknown;
    scopedTotalPrice: number | null;
    scopedSowVersion: string | null;
    documentsIncluded: unknown;
    sowPhases: unknown;
    selectedPhaseIds: unknown;
    totalPrice: unknown;
    projectId?: number | null;
  },
): Promise<{ effectiveTotalPrice: number; usedScopedSow: boolean }> {
  const { effectiveSowPhases, adjustmentsTotal, sowVersion, effectiveTotalPrice: fullTotalPrice } =
    await deriveEffectiveSowData(pres);

  const allLivePhaseIds = effectiveSowPhases.map(p => p.id);
  const hasScopeReduction =
    Array.isArray(pres.scopedPhaseIds) &&
    pres.scopedPhaseIds.length > 0 &&
    pres.scopedPhaseIds.length < allLivePhaseIds.length;

  if (!hasScopeReduction) {
    return { effectiveTotalPrice: fullTotalPrice, usedScopedSow: false };
  }

  const storedIds = pres.scopedPhaseIds as string[];
  const primaryMismatch = pres.scopedSowVersion != null && pres.scopedSowVersion !== sowVersion;
  const expectedDollars =
    effectiveSowPhases.filter(p => storedIds.includes(p.id)).reduce((s, p) => s + p.price, 0) + adjustmentsTotal;
  const storedDollars = pres.scopedTotalPrice ? pres.scopedTotalPrice / 100 : null;
  const secondaryMismatch =
    pres.scopedSowVersion == null && storedDollars != null && Math.abs(expectedDollars - storedDollars) > 0.005;

  const scopedSowIsValid = !primaryMismatch && !secondaryMismatch && storedDollars != null;

  if (!scopedSowIsValid) {
    return { effectiveTotalPrice: fullTotalPrice, usedScopedSow: false };
  }

  return { effectiveTotalPrice: storedDollars as number, usedScopedSow: true };
}

router.get("/portal/presentations/latest", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    // #1397: the presentation belongs to the customer account — match across
    // every linked login so a second/recreated login sees it.
    const siblingIds = await resolveSiblingUserIds(userId);
    const [row] = await db
      .select({
        id: quickWinPresentationsTable.id,
        status: quickWinPresentationsTable.status,
        totalPrice: quickWinPresentationsTable.totalPrice,
        createdAt: quickWinPresentationsTable.createdAt,
      })
      .from(quickWinPresentationsTable)
      .where(inArray(quickWinPresentationsTable.clientUserId, siblingIds))
      .orderBy(desc(quickWinPresentationsTable.createdAt))
      .limit(1);

    res.json({ presentation: row ?? null });
  } catch (err) {
    req.log.error(err, "portal: failed to fetch latest presentation");
    res.status(500).json({ error: "Failed to fetch presentation" });
  }
});

router.get("/portal/presentations/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const token = String(req.query.token ?? "");

    const [pres] = await db.select().from(quickWinPresentationsTable)
      .where(eq(quickWinPresentationsTable.id, id)).limit(1);
    if (!pres) { res.status(404).json({ error: "Presentation not found" }); return; }

    // Auth: either owner (via JWT) or valid share token
    const authHeader = req.headers.authorization;
    const jwtSecret = process.env.JWT_SECRET;
    let authedUserId: number | null = null;
    if (authHeader && jwtSecret) {
      const tok = authHeader.replace(/^Bearer\s+/i, "");
      try {
        const decoded = jwt.verify(tok, jwtSecret) as { id: number };
        authedUserId = decoded.id;
      } catch { /* no auth */ }
    }

    const isOwner = authedUserId != null && pres.clientUserId === authedUserId;
    const isValidToken = token && pres.shareToken === token;

    if (!isOwner && !isValidToken) {
      res.status(403).json({ error: "Access denied" }); return;
    }

    // Fetch full document HTML (including SOW pricing for live scope sync).
    // Merge snapshot IDs (documentsIncluded) with all delivered docs for this
    // project/customer so documents added after presentation creation appear automatically.
    const snapshotDocIds = new Set((pres.documentsIncluded ?? []) as number[]);

    // Scope: prefer project-level match when projectId is known (avoids leaking
    // documents from unrelated projects of the same customer). Fall back to
    // customer-level match only when the presentation has no projectId.
    const liveCondition = pres.projectId
      ? eq(insightsGeneratedDocumentsTable.projectId,  pres.projectId)
      : pres.clientUserId
        ? eq(insightsGeneratedDocumentsTable.customerId, pres.clientUserId)
        : null;
    const liveDocs = liveCondition
      ? await db.select({ id: insightsGeneratedDocumentsTable.id })
          .from(insightsGeneratedDocumentsTable)
          .where(and(
            inArray(insightsGeneratedDocumentsTable.status, ["approved", "delivered"]),
            liveCondition,
          ))
      : [];

    const mergedDocIds = Array.from(new Set([...snapshotDocIds, ...liveDocs.map(d => d.id)]));

    const docSelectFields = {
      id: insightsGeneratedDocumentsTable.id,
      title: insightsGeneratedDocumentsTable.title,
      category: insightsGeneratedDocumentsTable.category,
      docType: insightsGeneratedDocumentsTable.docType,
      htmlContent: insightsGeneratedDocumentsTable.htmlContent,
      sowPricingLines: insightsGeneratedDocumentsTable.sowPricingLines,
      sowTotalPrice: insightsGeneratedDocumentsTable.sowTotalPrice,
      createdAt: insightsGeneratedDocumentsTable.createdAt,
    };

    let docsRaw = mergedDocIds.length > 0
      ? await db.select(docSelectFields)
          .from(insightsGeneratedDocumentsTable)
          .where(inArray(insightsGeneratedDocumentsTable.id, mergedDocIds))
          .orderBy(asc(insightsGeneratedDocumentsTable.createdAt))
      : [];

    // Fallback: if no docs resolved (stale/non-existent snapshot IDs and no live
    // delivered docs), fetch the latest approved or delivered doc per doc_type for
    // this project so the presentation is never shown completely empty.
    if (docsRaw.length === 0 && pres.projectId) {
      const fallbackRaw = await db.select(docSelectFields)
        .from(insightsGeneratedDocumentsTable)
        .where(and(
          eq(insightsGeneratedDocumentsTable.projectId, pres.projectId),
          inArray(insightsGeneratedDocumentsTable.status, ["approved", "delivered"]),
        ))
        .orderBy(desc(insightsGeneratedDocumentsTable.createdAt));
      // Keep only the newest doc per doc_type, then restore chronological order
      const seenTypes = new Set<string>();
      docsRaw = fallbackRaw
        .filter(d => { if (seenTypes.has(d.docType)) return false; seenTypes.add(d.docType); return true; })
        .reverse();
    }

    const docs = docsRaw.map(d => ({ ...d, htmlContent: stripTierDetectionText(stripStagedForReviewBanner(d.htmlContent)) }));

    // Derive sowPhases from the live SOW document — uses shared helper so GET,
    // PATCH, and checkout all stay consistent.
    const { effectiveSowPhases, effectiveSelectedPhaseIds, effectiveTotalPrice, adjustmentsTotal, namedAdjustmentLines, sowVersion } =
      await deriveEffectiveSowData(pres);

    // Fetch project + client name + service id for template lookup
    const [project] = pres.projectId
      ? await db.select({
          title: projectsTable.title,
          serviceId: clientServicesTable.serviceId,
          workflowName: workflowTemplatesTable.name,
        })
          .from(projectsTable)
          .leftJoin(clientServicesTable, eq(clientServicesTable.projectId, projectsTable.id))
          .leftJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
          .leftJoin(workflowTemplatesTable, eq(workflowTemplatesTable.id, servicesTable.workflowTemplateId))
          .where(eq(projectsTable.id, pres.projectId))
          .limit(1)
      : [null];
    const [clientUser] = pres.clientUserId
      ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, pres.clientUserId)).limit(1)
      : [null];

    // Contract body — use service-linked template if available, fall back to generic
    let contractBody: string | null = null;
    if (project?.serviceId) {
      const [tmpl] = await db.select({ body: contractTemplatesTable.body })
        .from(contractTemplatesTable)
        .where(eq(contractTemplatesTable.serviceId, project.serviceId))
        .limit(1);
      if (tmpl?.body) {
        const selectionsSummary = effectiveSowPhases
          .filter(p => effectiveSelectedPhaseIds.includes(p.id))
          .map(p => `- ${p.title}: $${p.price.toLocaleString()}`)
          .join("\n");
        const signedDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
        contractBody = tmpl.body
          .replace(/\{\{client_name\}\}/g, clientUser?.name ?? "")
          .replace(/\{\{service_name\}\}/g, project.title ?? "M365 Consulting Engagement")
          .replace(/\{\{price\}\}/g, `$${effectiveTotalPrice.toLocaleString()}`)
          .replace(/\{\{date\}\}/g, signedDate)
          .replace(/\{\{selections_summary\}\}/g, selectionsSummary);
      }
    }

    // Auto-sync payment status from Stripe if session exists and not yet paid/signed.
    // Guard: never overwrite a signed presentation — signing is the terminal state
    // and must not be regressed to paid by a replayed or late webhook auto-sync.
    let currentStatus = pres.status;
    if (pres.stripeSessionId && currentStatus !== "paid" && currentStatus !== "signed") {
      try {
        let stripeKey: string | null = null;
        try { stripeKey = getStripeKey(); } catch { /* stripe not configured */ }
        if (stripeKey) {
          const { default: Stripe } = await import("stripe");
          const stripe = new Stripe(stripeKey);
          const session = await stripe.checkout.sessions.retrieve(pres.stripeSessionId);
          if (session.payment_status === "paid") {
            await db.update(quickWinPresentationsTable)
              .set({ status: "paid", updatedAt: new Date() })
              .where(eq(quickWinPresentationsTable.id, id));
            currentStatus = "paid";
          }
        }
      } catch { /* non-fatal — proceed with existing status */ }
    }

    // Restore scoped SOW state if it was persisted and still matches an actual scope reduction
    const allLivePhaseIds = effectiveSowPhases.map(p => p.id);
    const hasScopeReduction =
      Array.isArray(pres.scopedPhaseIds) &&
      pres.scopedPhaseIds.length > 0 &&
      pres.scopedPhaseIds.length < allLivePhaseIds.length;

    // Validate that the stored scoped SOW matches the current live SOW pricing.
    // Two complementary checks are used so that both obvious and subtle drift is caught:
    //
    //   Primary:   sowVersion string comparison — catches any price or phase-list change,
    //              including cases where individual prices offset each other and the total
    //              happens to be the same (e.g. phase A +$500, phase B -$500).
    //
    //   Secondary: total price comparison — provides a safety net for rows that were
    //              persisted before scopedSowVersion was added (legacy rows have null).
    //              Computes expected = sum of live prices for selected phases + adjustmentsTotal,
    //              matching the same formula used in regenerate-scoped-sow.
    let scopedSowIsValid = hasScopeReduction;
    if (hasScopeReduction && Array.isArray(pres.scopedPhaseIds) && pres.scopedPhaseIds.length > 0) {
      const storedIds = pres.scopedPhaseIds as string[];
      const primaryMismatch =
        pres.scopedSowVersion != null &&
        pres.scopedSowVersion !== sowVersion;
      const expectedDollars =
        effectiveSowPhases
          .filter(p => storedIds.includes(p.id))
          .reduce((s, p) => s + p.price, 0) + adjustmentsTotal;
      const storedDollars = pres.scopedTotalPrice ? pres.scopedTotalPrice / 100 : null;
      const secondaryMismatch =
        pres.scopedSowVersion == null &&
        storedDollars != null &&
        Math.abs(expectedDollars - storedDollars) > 0.005;
      if (primaryMismatch || secondaryMismatch) {
        // SOW pricing drifted — wipe the stale scoped SOW so the client must regenerate
        await db.update(quickWinPresentationsTable)
          .set({ scopedSowHtml: null, scopedTotalPrice: null, scopedPhaseIds: null, scopedSowVersion: null, updatedAt: new Date() })
          .where(eq(quickWinPresentationsTable.id, id));
        scopedSowIsValid = false;
        req.log?.info({ presentationId: id, primaryMismatch, secondaryMismatch }, "portal: stale scoped SOW cleared due to pricing drift");
      }
    }

    // Record first-visit timestamp for owner (used to anchor the PAY-TODAY 72-hour window)
    if (isOwner && !pres.firstVisitedAt) {
      await db.update(quickWinPresentationsTable)
        .set({ firstVisitedAt: new Date(), updatedAt: new Date() })
        .where(eq(quickWinPresentationsTable.id, id));
    }

    // phaseGenCompleted is true only when save_presentation_phases actually wrote
    // AI-generated phases to the sow_phases DB column.  The client poll uses this
    // flag — NOT sowPhases.length — so it never navigates away based on the
    // deriveEffectiveSowData fallback phases that are always present.
    const rawSowPhases = (pres.sowPhases ?? []) as unknown[];
    const phaseGenCompleted = Array.isArray(rawSowPhases) && rawSowPhases.length > 0;

    res.json({
      id: pres.id,
      projectId: pres.projectId,
      clientUserId: pres.clientUserId,
      shareToken: pres.shareToken,
      documents: docs,
      sowPhases: effectiveSowPhases,
      selectedPhaseIds: effectiveSelectedPhaseIds,
      totalPrice: effectiveTotalPrice,
      adjustmentsTotal,
      adjustmentLines: namedAdjustmentLines,
      sowVersion,
      signatureData: pres.signatureData,
      signedAt: pres.signedAt,
      signerName: pres.signerName,
      paymentPlan: pres.paymentPlan,
      status: currentStatus,
      projectTitle: pres.projectTitle ?? project?.title ?? null,
      clientName: clientUser?.name ?? null,
      contractBody,
      workflowName: project?.workflowName ?? null,
      scopedSowHtml: scopedSowIsValid ? (pres.scopedSowHtml ?? null) : null,
      scopedTotalPrice: scopedSowIsValid && pres.scopedTotalPrice ? pres.scopedTotalPrice / 100 : null,
      scopedPhaseIds: scopedSowIsValid ? (pres.scopedPhaseIds ?? null) : null,
      discountedTotalCents: pres.discountedTotalCents ?? null,
      phaseGenCompleted,
    });
  } catch (err) {
    log.error({ err }, "portal: failed to get presentation");
    res.status(500).json({ error: "Failed to get presentation" });
  }
});

router.get("/portal/presentations/:id/sow-document", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).send("Invalid ID"); return; }

    const token = String(req.query.token ?? "");
    const authHeader = req.headers.authorization;
    const jwtSecret = process.env.JWT_SECRET;
    let authedUserId: number | null = null;
    if (authHeader && jwtSecret) {
      const tok = authHeader.replace(/^Bearer\s+/i, "");
      try { authedUserId = (jwt.verify(tok, jwtSecret) as { id: number }).id; } catch { /* no auth */ }
    }

    const [pres] = await db.select().from(quickWinPresentationsTable)
      .where(eq(quickWinPresentationsTable.id, id)).limit(1);
    if (!pres) { res.status(404).send("Presentation not found"); return; }

    const isOwner = authedUserId != null && pres.clientUserId === authedUserId;
    const isAdmin = authedUserId != null
      ? await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, authedUserId)).limit(1).then(rows => rows[0]?.role === "admin")
      : false;
    const isValidToken = token && pres.shareToken === token;
    if (!isOwner && !isAdmin && !isValidToken) { res.status(403).send("Access denied"); return; }

    // Find the scoped SOW document for this presentation
    let htmlContent: string | null = null;
    let docTitle = "Scope of Work";

    if (pres.projectId || pres.clientUserId) {
      const [scopedDoc] = await db
        .select({ id: insightsGeneratedDocumentsTable.id, htmlContent: insightsGeneratedDocumentsTable.htmlContent, title: insightsGeneratedDocumentsTable.title })
        .from(insightsGeneratedDocumentsTable)
        .where(
          and(
            eq(insightsGeneratedDocumentsTable.docType, "scoped_sow"),
            pres.projectId
              ? eq(insightsGeneratedDocumentsTable.projectId, pres.projectId)
              : eq(insightsGeneratedDocumentsTable.customerId, pres.clientUserId!),
          ),
        )
        .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
        .limit(1);

      if (scopedDoc) {
        htmlContent = scopedDoc.htmlContent;
        docTitle = scopedDoc.title;
      } else if (pres.clientUserId) {
        // Fall back to consolidated_sow / sow
        const [anySow] = await db
          .select({ htmlContent: insightsGeneratedDocumentsTable.htmlContent, title: insightsGeneratedDocumentsTable.title })
          .from(insightsGeneratedDocumentsTable)
          .where(
            and(
              eq(insightsGeneratedDocumentsTable.customerId, pres.clientUserId),
              or(
                eq(insightsGeneratedDocumentsTable.docType, "sow"),
                eq(insightsGeneratedDocumentsTable.docType, "consolidated_sow"),
              ),
            ),
          )
          .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
          .limit(1);
        if (anySow) {
          htmlContent = anySow.htmlContent;
          docTitle = anySow.title;
        }
      }
    }

    // Fall back to the scoped SOW HTML stored directly on the presentation
    if (!htmlContent && pres.scopedSowHtml) {
      htmlContent = pres.scopedSowHtml;
    }

    if (!htmlContent) {
      res.status(404).send("<p>Scope of Work document not available.</p>");
      return;
    }

    // Serve as a standalone HTML page so it opens cleanly in a new tab
    const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${docTitle.replace(/</g, "&lt;")} — Shane McCaw Consulting</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 40px auto; padding: 0 24px; color: #0A2540; line-height: 1.6; }
  h1,h2,h3 { color: #0A2540; } a { color: #0078D4; }
  @media print { body { margin: 0; padding: 16px; } }
</style>
</head>
<body>${htmlContent}</body>
</html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(page);
  } catch (err) {
    log.error({ err }, "portal: failed to serve sow-document");
    res.status(500).send("Failed to load document");
  }
});

router.post("/portal/presentations/:id/sign", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    const userId = req.user!.id;
    const { signatureData, signerName } = req.body as { signatureData: string; signerName: string };

    if (!signatureData || !signerName) {
      res.status(400).json({ error: "signatureData and signerName are required" }); return;
    }

    // #1397: allow any login of the customer account to sign the account's
    // presentation (the exact recreated-login case — the presentation's own
    // clientUserId may be a prior login). signerName is still captured.
    const siblingIds = await resolveSiblingUserIds(userId);
    const [pres] = await db.select().from(quickWinPresentationsTable)
      .where(and(eq(quickWinPresentationsTable.id, id), inArray(quickWinPresentationsTable.clientUserId, siblingIds)))
      .limit(1);
    if (!pres) { res.status(404).json({ error: "Presentation not found" }); return; }

    // Derive the effective price at signing time — this is the binding amount.
    // If a scoped SOW was generated and matches the current selection, it's
    // the scoped price; otherwise it's the full SOW total.
    const { effectiveTotalPrice: effectivePrice } = await resolveScopeAwarePrice(pres);

    // New flow: Agreement is signed BEFORE Stripe payment.
    // The checkout step (which follows contract signing) handles the payment gate.
    // Signing is allowed when status is "active" (normal) or "signed" (re-sign idempotency).

    const signedAt = new Date();
    await db.update(quickWinPresentationsTable)
      .set({
        signatureData,
        signerName,
        signedAt,
        status: "signed",
        updatedAt: signedAt,
      })
      .where(eq(quickWinPresentationsTable.id, id));

    // Note: agreement_signed workflow event is emitted from the Stripe webhook
    // handler (checkout.session.completed / presentation_checkout), not here.
    // Emitting at signing time is premature — the payment method is not yet
    // confirmed, which would cause create_phased_invoices to fail to bind a
    // default PM to the Stripe customer.

    res.json({
      ok: true,
      signedAt: signedAt.toISOString(),
      effectivePrice,
      scopedPhaseIds: pres.scopedPhaseIds ?? null,
    });
  } catch (err) {
    log.error({ err }, "portal: failed to sign presentation");
    res.status(500).json({ error: "Failed to sign" });
  }
});

export default router;
