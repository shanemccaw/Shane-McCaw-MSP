/**
 * admin-document-generator.ts
 *
 * Document Generator IDE — real, on-demand document generation for any
 * active document_types row, routed to generateDocument()/generateSowDocument()
 * by pipelineCategory, plus the tenant/project pickers and generation history
 * the admin page needs. Dry-run preview stays on the existing
 * GET /api/admin/document-types/:key/preview route (admin-document-types.ts);
 * this file only adds the real (persisting) trigger and read paths.
 *
 * Routes
 * ──────
 * GET  /api/admin/document-generator/tenants                       — tenant picker (msp_customers)
 * GET  /api/admin/document-generator/tenants/:mspCustomerId/projects — project picker for a tenant
 * GET  /api/admin/document-generator/missing-types           — document_generation services with no document_types row
 * POST /api/admin/document-generator/document-types/:key/generate — real generation
 * GET  /api/admin/document-generator/history                — recent generations
 * GET  /api/admin/document-generator/history/:id/html        — view/download stored HTML
 * GET  /api/admin/document-generator/profile-keys           — real, aggregated profile-key registry (Phase 1 of #70)
 * POST /api/admin/document-generator/document-types/:key/suggest-scoping — constrained AI scoping suggestion (Phase 4 of #70)
 * POST /api/admin/document-generator/document-types/suggest-scoping      — same, pre-save (New Document Type modal has no key yet)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, documentTypesTable, insightsGeneratedDocumentsTable, monitorChecksTable, tenantsTable, projectsTable, servicesTable, usersTable, aiUsageEventsTable, SIGNAL_CATEGORY_PREFIXES } from "@workspace/db";
import { eq, desc, and, isNull, inArray, asc, sql } from "drizzle-orm";
import { anthropic, withAiAttribution } from "@workspace/integrations-anthropic-ai";
import { requireAdmin } from "../middlewares/requireAuth";
import { generateDocument } from "../lib/document-engine.ts";
import { generateSowDocument } from "../lib/document-engine-sow.ts";
import { namespacedProfileKey, resolveCustomerUserIds, BRIDGED_KEY_PRODUCER_CHECK, NON_CHECK_PROFILE_NAMESPACE } from "../lib/tenant-signals";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "workflow.doc-pipeline" });
const missingTypesLog = logger.child({ channel: "engine.document-generator" });
const scopingLog = logger.child({ channel: "engine.document-generator" });
const router: IRouter = Router();

// ── Tenant picker ────────────────────────────────────────────────────────────
// Every `msp_customers` row, including ones with no `tenantId` yet — those are
// surfaced with a null `tenantId` rather than filtered out, so the frontend can
// show the same amber "not yet connected" indicator convention used elsewhere
// in this app instead of silently hiding an onboarding-stage tenant.

router.get("/admin/document-generator/tenants", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: tenantsTable.id,
        name: tenantsTable.customerName,
        tenantId: tenantsTable.tenantId,
        domain: tenantsTable.domain,
        status: tenantsTable.status,
      })
      .from(tenantsTable)
      .orderBy(asc(tenantsTable.customerName));
    res.json(rows);
  } catch (err) {
    log.error({ err }, "admin-document-generator: list tenants failed");
    res.status(500).json({ error: "Failed to fetch tenants" });
  }
});

// ── Project picker (tenant-scoped) ──────────────────────────────────────────
// Resolves every linked login for the tenant (resolveCustomerUserIds), then
// returns projects across the whole set, ordered by updatedAt desc — not just
// one arbitrary login's projects.

router.get("/admin/document-generator/tenants/:mspCustomerId/projects", requireAdmin, async (req: Request, res: Response) => {
  const mspCustomerId = parseInt(String(req.params["mspCustomerId"] ?? ""), 10);
  if (isNaN(mspCustomerId)) { res.status(400).json({ error: "Invalid mspCustomerId" }); return; }

  try {
    const userIds = await resolveCustomerUserIds(mspCustomerId);
    if (userIds.length === 0) { res.json([]); return; }

    const rows = await db
      .select({ id: projectsTable.id, title: projectsTable.title, status: projectsTable.status })
      .from(projectsTable)
      .where(inArray(projectsTable.clientUserId, userIds))
      .orderBy(desc(projectsTable.updatedAt));
    res.json(rows);
  } catch (err) {
    log.error({ err, mspCustomerId }, "admin-document-generator: list tenant projects failed");
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// ── Missing document types ───────────────────────────────────────────────────
// Services flagged for document-generation delivery with no matching
// document_types row yet — surfaces registry gaps before they're hit at
// generation time. `slug` is included alongside the id/name/description the
// panel displays so the frontend's Quick Add can derive a key without a
// second round trip.

router.get("/admin/document-generator/missing-types", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: servicesTable.id,
        name: servicesTable.name,
        description: servicesTable.description,
        slug: servicesTable.slug,
      })
      .from(servicesTable)
      .leftJoin(documentTypesTable, eq(documentTypesTable.serviceId, servicesTable.id))
      .where(and(eq(servicesTable.deliveryType, "document_generation"), isNull(documentTypesTable.id)))
      .orderBy(servicesTable.name);
    res.json(rows);
  } catch (err) {
    missingTypesLog.error({ err }, "admin-document-generator: missing-types failed");
    res.status(500).json({ error: "Failed to fetch missing document types" });
  }
});

// ── Profile key registry ─────────────────────────────────────────────────────
// Real, live source of every key a document type's
// `included_profile_key_patterns` can name, in the NAMESPACED
// `<checkKey>.<property>` form document generation matches against
// (Git #544 — see the block comment on `matchesProfilePattern` in
// document-engine.ts). Three real producers, all enumerated from the live
// `monitor_checks` catalogue:
//
//   • `mapping[].targetField`         → `<key>.<targetField>`
//   • `properties[]` raw extraction   → `<key>.<prop>_count` / `_first` / `_values`
//     (`applyMapping` in monitor-executor.ts emits all THREE per entry)
//   • the unconditional item count    → `<key>._itemCount`
//
// The raw-extraction class was missing entirely before #544: 87 of the
// catalogue's 89 colliding names live in it, so the picker and the AI-suggest
// allowlist (which filters against this same list) were both blind to the exact
// surface the scoping work needs to name. Grouped by the checkKey's domain
// prefix — the segment before ":", which is what real check keys use; this
// split was written against "://" and therefore never fired, giving one group
// per CHECK instead of one per domain.
//
// Single query, no N+1.

/**
 * The aggregation itself, split out from the route so the AI-suggest endpoint
 * (Phase 4) can hand Claude the *same* real key list the picker shows, without
 * re-implementing the query or calling this server's own HTTP route.
 */
export async function fetchProfileKeyGroups(): Promise<{ domain: string; keys: string[] }[]> {
  const rows = await db
    .select({ key: monitorChecksTable.key, mapping: monitorChecksTable.mapping, properties: monitorChecksTable.properties })
    .from(monitorChecksTable)
    .where(eq(monitorChecksTable.status, "active"));

  const domains = new Map<string, Set<string>>();
  const keysFor = (domain: string): Set<string> => {
    let keys = domains.get(domain);
    if (!keys) {
      keys = new Set<string>();
      domains.set(domain, keys);
    }
    return keys;
  };

  const activeCheckKeys = new Set<string>();
  for (const row of rows) {
    activeCheckKeys.add(row.key);
    const keys = keysFor(row.key.split(":")[0] ?? row.key);
    for (const m of row.mapping) keys.add(namespacedProfileKey(row.key, m.targetField));
    for (const prop of row.properties ?? []) {
      if (!prop) continue;
      for (const suffix of ["_count", "_first", "_values"]) keys.add(namespacedProfileKey(row.key, `${prop}${suffix}`));
    }
    // `_itemCount` is stamped on every check by executeMonitorCheck, so the
    // namespaced form is always real. (The flat `<key>__itemCount` remains the
    // threshold-rule contract; it is not a document-scoping key.)
    keys.add(namespacedProfileKey(row.key, "_itemCount"));
  }

  // The check-key-less bucket: keys `bridgeLegacyProfileKeys` derives, offered
  // only when their single real producer check is active, so the picker can
  // never present a key this tenant catalogue cannot produce.
  for (const [bridgedKey, producerCheck] of Object.entries(BRIDGED_KEY_PRODUCER_CHECK)) {
    if (activeCheckKeys.has(producerCheck)) {
      keysFor(NON_CHECK_PROFILE_NAMESPACE).add(namespacedProfileKey(NON_CHECK_PROFILE_NAMESPACE, bridgedKey));
    }
  }

  return Array.from(domains.entries())
    .map(([domain, keys]) => ({ domain, keys: Array.from(keys).sort() }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

router.get("/admin/document-generator/profile-keys", requireAdmin, async (_req: Request, res: Response) => {
  try {
    res.json(await fetchProfileKeyGroups());
  } catch (err) {
    log.error({ err }, "admin-document-generator: profile-keys failed");
    res.status(500).json({ error: "Failed to fetch profile keys" });
  }
});

// ── Generate (real, persisting) ─────────────────────────────────────────────
//
// Takes `mspCustomerId` directly now that the tenant picker (Phase 9) gives the
// UI a real customer id to supply — the interim `resolveCustomerIdForPortalUser()`
// translation this route used to do at the boundary is gone.

router.post("/admin/document-generator/document-types/:key/generate", requireAdmin, async (req: Request, res: Response) => {
  const key = String(req.params["key"] ?? "");
  const mspCustomerId = parseInt(String(req.body?.mspCustomerId ?? ""), 10);
  const projectId = parseInt(String(req.body?.projectId ?? "0"), 10);
  // Drift gate override. Defaults to false, so a plain "Generate" click reuses
  // an existing document when nothing about the tenant's data has moved instead
  // of paying for an identical AI call. Strict `=== true` so a body carrying the
  // string "false" (or any other truthy-but-not-true value) can't accidentally
  // buy an AI call.
  const forceRegenerate = req.body?.forceRegenerate === true;
  // Opt-in SSE relay of the model's output as it is written (see the streaming
  // block below). Strict `=== true`, matching `forceRegenerate` above.
  //
  // Deliberately opt-in rather than switching this endpoint to SSE wholesale:
  // SimulatorDocumentCanvas.tsx calls the same route and reads a plain JSON
  // body, so an unconditional switch would silently break it. Both shapes
  // return the same fields and run the same generation.
  const wantsStream = req.body?.stream === true;

  if (isNaN(mspCustomerId)) {
    res.status(400).json({ error: "mspCustomerId is required and must be a number" });
    return;
  }

  try {
    const [docTypeRow] = await db
      .select({ pipelineCategory: documentTypesTable.pipelineCategory, isActive: documentTypesTable.isActive, label: documentTypesTable.label })
      .from(documentTypesTable)
      .where(eq(documentTypesTable.key, key))
      .limit(1);

    if (!docTypeRow) { res.status(404).json({ error: `Unknown document type "${key}"` }); return; }
    if (!docTypeRow.isActive) { res.status(400).json({ error: `Document type "${key}" is not active` }); return; }

    log.info({ key, mspCustomerId, projectId, forceRegenerate, stream: wantsStream, actor: req.user?.email }, "admin-document-generator: generate requested");

    // ── Streaming mode ───────────────────────────────────────────────────────
    // Same generation, same result fields — only the delivery differs. Headers
    // are flushed only after the validation above has passed, so a bad request
    // still gets a real status code and a JSON error rather than a 200 stream
    // whose first frame is an error.
    if (wantsStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const sendSSE = (event: Record<string, unknown>): void => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      sendSSE({ type: "phase", label: "Assembling prompt from tenant data…", pct: 5 });

      let streamedChars = 0;
      // Progress ramp, same shape as admin-ps-scripts.ts's: a generated
      // document has no known length, so the bar is driven off output-so-far
      // against a typical size and capped below 100 — it must never claim to be
      // finished before the `done` frame actually says so.
      const EXPECTED_CHARS = 24_000;
      let lastEmittedPct = 20;
      // The engine's own relay tap. Only `generateDocument` takes it; the SOW
      // pipeline below has its own multi-call shape and is out of scope here,
      // so it streams phases but no text.
      const onTextDelta = (text: string): void => {
        if (streamedChars === 0) {
          sendSSE({ type: "phase", label: "Claude is writing the document…", pct: 20 });
        }
        streamedChars += text.length;
        sendSSE({ type: "delta", text });
        const pct = Math.min(90, Math.round(20 + (streamedChars / EXPECTED_CHARS) * 70));
        // Throttled: one frame per 3 points, not one per token.
        if (pct >= lastEmittedPct + 3) {
          lastEmittedPct = pct;
          sendSSE({ type: "progress", pct });
        }
      };

      try {
        const streamed = docTypeRow.pipelineCategory === "pipeline_output"
          ? await generateSowDocument({ mspCustomerId, projectId: isNaN(projectId) ? 0 : projectId, docTypeKey: key, forceRegenerate })
          : await generateDocument({ mspCustomerId, projectId: isNaN(projectId) ? 0 : projectId, docTypeKey: key, forceRegenerate, onTextDelta });

        log.info(
          { key, mspCustomerId, documentId: streamed.documentId, costCents: streamed.costCents, costStatus: streamed.costStatus, streamedChars },
          "admin-document-generator: generate completed (streamed)",
        );
        // `htmlContent` is the authority, always — it is built from the model's
        // final message and carries the remediation appendix (#493), which is
        // appended after generation and therefore never appears in the deltas.
        // A client that rendered only the accumulated deltas would be showing a
        // document that is missing its appendix.
        sendSSE({
          type: "done",
          payload: {
            documentId: streamed.documentId,
            htmlContent: streamed.htmlContent,
            docTypeKey: key,
            costCents: streamed.costCents,
            costStatus: streamed.costStatus,
          },
        });
      } catch (err) {
        log.error({ err, key, mspCustomerId }, "admin-document-generator: generate failed (streamed)");
        sendSSE({ type: "error", message: err instanceof Error ? err.message : "Generation failed" });
      }
      res.end();
      return;
    }

    const result = docTypeRow.pipelineCategory === "pipeline_output"
      ? await generateSowDocument({ mspCustomerId, projectId: isNaN(projectId) ? 0 : projectId, docTypeKey: key, forceRegenerate })
      : await generateDocument({ mspCustomerId, projectId: isNaN(projectId) ? 0 : projectId, docTypeKey: key, forceRegenerate });

    log.info(
      { key, mspCustomerId, documentId: result.documentId, costCents: result.costCents, costStatus: result.costStatus },
      "admin-document-generator: generate completed",
    );
    // costCents/costStatus are additive (#53): the engine reports what its own
    // ai_usage_events row recorded, so the IDE can show what a generation spent
    // without a second query — and `costStatus` keeps a reused/preview `0`
    // distinguishable from a cost we could not read back.
    res.json({
      documentId: result.documentId,
      htmlContent: result.htmlContent,
      docTypeKey: key,
      costCents: result.costCents,
      costStatus: result.costStatus,
    });
  } catch (err) {
    log.error({ err, key, mspCustomerId }, "admin-document-generator: generate failed");
    // Once the SSE headers are out, a status code can no longer be set — trying
    // would throw over the top of the real error and lose it.
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: "error", message: err instanceof Error ? err.message : "Generation failed" })}\n\n`);
      res.end();
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Generation failed" });
  }
});

// ── History ──────────────────────────────────────────────────────────────────

router.get("/admin/document-generator/history", requireAdmin, async (req: Request, res: Response) => {
  const docType = req.query["docType"] ? String(req.query["docType"]) : undefined;
  const rawLimit = parseInt(String(req.query["limit"] ?? "50"), 10);
  const limit = isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 200);

  try {
    const conditions = docType ? [eq(insightsGeneratedDocumentsTable.docType, docType)] : [];
    const rows = await db
      .select({
        id: insightsGeneratedDocumentsTable.id,
        docType: insightsGeneratedDocumentsTable.docType,
        category: insightsGeneratedDocumentsTable.category,
        title: insightsGeneratedDocumentsTable.title,
        status: insightsGeneratedDocumentsTable.status,
        errorMessage: insightsGeneratedDocumentsTable.errorMessage,
        createdAt: insightsGeneratedDocumentsTable.createdAt,
        customerId: insightsGeneratedDocumentsTable.customerId,
        customerName: usersTable.name,
        customerCompany: usersTable.company,
        projectId: insightsGeneratedDocumentsTable.projectId,
        projectTitle: projectsTable.title,
        docTypeLabel: documentTypesTable.label,
        // Null when no ai_usage_events row matches — a document generated
        // before #50 added these columns, or one whose usage recording
        // failed, reads as "unknown" (#53), never a fabricated $0.00.
        costCents: aiUsageEventsTable.costCents,
      })
      .from(insightsGeneratedDocumentsTable)
      .leftJoin(usersTable, eq(insightsGeneratedDocumentsTable.customerId, usersTable.id))
      .leftJoin(projectsTable, eq(insightsGeneratedDocumentsTable.projectId, projectsTable.id))
      .leftJoin(documentTypesTable, eq(insightsGeneratedDocumentsTable.docType, documentTypesTable.key))
      .leftJoin(
        aiUsageEventsTable,
        and(
          eq(aiUsageEventsTable.generatedArtifactType, insightsGeneratedDocumentsTable.docType),
          sql`${aiUsageEventsTable.generatedArtifactId} = ${insightsGeneratedDocumentsTable.id}::text`,
        ),
      )
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
      .limit(limit);
    res.json(rows);
  } catch (err) {
    log.error({ err }, "admin-document-generator: history failed");
    res.status(500).json({ error: "Failed to fetch generation history" });
  }
});

router.get("/admin/document-generator/history/:id/html", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [doc] = await db
      .select({ title: insightsGeneratedDocumentsTable.title, htmlContent: insightsGeneratedDocumentsTable.htmlContent })
      .from(insightsGeneratedDocumentsTable)
      .where(eq(insightsGeneratedDocumentsTable.id, id))
      .limit(1);
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(doc.htmlContent);
  } catch (err) {
    log.error({ err, id }, "admin-document-generator: html view failed");
    res.status(500).json({ error: "Failed to load document" });
  }
});

// ── Constrained AI scoping suggestion (Phase 4 of #70) ──────────────────────
//
// Suggests `includedProfileKeyPatterns` / `includedSignalCategories` / `sections`
// for a document type. Two things make this safe to put in front of an admin:
//
//  1. The model is only ever shown REAL values — the same profile-key groups the
//     Phase 1 registry route returns (via `fetchProfileKeyGroups()`, reused, not
//     re-implemented) and the real `SIGNAL_CATEGORY_PREFIXES` enum.
//  2. Everything that comes back is filtered against those same real sets before
//     it is returned. The prompt wording is a hint; step 2 is the actual
//     mechanism. A hallucinated key is dropped silently — that is normal model
//     behaviour, not an error condition, so it never surfaces as a failure. The
//     requested-vs-kept counts go to the log instead, so a suspiciously low keep
//     rate is visible without having to reproduce the call.
//
// This endpoint writes NOTHING. It returns a suggestion payload for the admin to
// review, edit and explicitly Save through the existing document-types routes.

/** Free-form sections have no real-list to validate against, so they get a cap. */
const MAX_SUGGESTED_SECTIONS = 8;

/** Model tier already used for the other admin authoring aids (admin-marketing.ts). */
const SUGGEST_MODEL = "claude-haiku-4-5";

interface SuggestedSection { heading: string; guidance: string }

/** Pull the first balanced JSON object out of a model reply (fences, prose, etc). */
function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

function suggestedSections(value: unknown): SuggestedSection[] {
  if (!Array.isArray(value)) return [];
  const out: SuggestedSection[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const heading = typeof (entry as { heading?: unknown }).heading === "string" ? (entry as { heading: string }).heading.trim() : "";
    const guidance = typeof (entry as { guidance?: unknown }).guidance === "string" ? (entry as { guidance: string }).guidance.trim() : "";
    if (!heading || !guidance) continue;
    out.push({ heading, guidance });
  }
  return out;
}

router.post(
  [
    "/admin/document-generator/document-types/:key/suggest-scoping",
    // Pre-save case: the New Document Type modal has no key yet, so the same
    // handler runs off label/category/serviceId in the body alone.
    "/admin/document-generator/document-types/suggest-scoping",
  ],
  requireAdmin,
  async (req: Request, res: Response) => {
    const key = String(req.params["key"] ?? "").trim();

    let label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
    let category = req.body?.category === "report" || req.body?.category === "consulting" ? req.body.category : "";
    const bodyServiceId = Number.parseInt(String(req.body?.serviceId ?? ""), 10);
    let serviceId: number | null = Number.isNaN(bodyServiceId) ? null : bodyServiceId;

    try {
      if (key) {
        // Saved type: the stored row is the source of truth for anything the
        // caller did not explicitly override.
        const [docTypeRow] = await db
          .select({ label: documentTypesTable.label, category: documentTypesTable.category, serviceId: documentTypesTable.serviceId })
          .from(documentTypesTable)
          .where(eq(documentTypesTable.key, key))
          .limit(1);
        if (!docTypeRow) { res.status(404).json({ error: "Document type not found" }); return; }
        if (!label) label = docTypeRow.label;
        if (!category) category = docTypeRow.category;
        if (serviceId === null) serviceId = docTypeRow.serviceId;
      }

      if (!label || !category) {
        res.status(400).json({ error: "label and category (\"report\" or \"consulting\") are required" });
        return;
      }

      // ── Step 1: the real constraint sets ──────────────────────────────────
      const groups = await fetchProfileKeyGroups();
      const realProfileKeys = new Set(groups.flatMap((g) => g.keys));
      const realCategories = new Set<string>(SIGNAL_CATEGORY_PREFIXES);

      let serviceContext = "";
      if (serviceId !== null) {
        const [service] = await db
          .select({ name: servicesTable.name, description: servicesTable.description })
          .from(servicesTable)
          .where(eq(servicesTable.id, serviceId))
          .limit(1);
        if (service) {
          serviceContext = `\nLinked service: ${service.name}\nService description: ${service.description ?? "(none)"}\n`;
        }
      }

      // ── Step 2: one constrained model call ────────────────────────────────
      const keyCatalog = groups.map((g) => `${g.domain}:\n${g.keys.map((k) => `  - ${k}`).join("\n")}`).join("\n\n");
      const prompt = [
        `You are helping an MSP platform admin scope a generated document type.`,
        ``,
        `Document type label: ${label}`,
        `Category: ${category}`,
        serviceContext,
        `Below are the ONLY valid profile key patterns, grouped by data domain. You must copy values character-for-character from this list. Do not invent, abbreviate, pluralise, or combine keys.`,
        ``,
        keyCatalog,
        ``,
        `Below are the ONLY valid signal categories:`,
        SIGNAL_CATEGORY_PREFIXES.map((c) => `  - ${c}`).join("\n"),
        ``,
        `Select the subset of profile key patterns and signal categories that are genuinely relevant to a "${label}" document, and propose 3-6 document sections.`,
        `A tight, relevant selection is far better than a broad one.`,
        ``,
        `Respond with ONLY a JSON object, no prose and no markdown fences:`,
        `{"profileKeyPatterns":["..."],"signalCategories":["..."],"sections":[{"heading":"...","guidance":"..."}]}`,
        ``,
        `profileKeyPatterns and signalCategories MUST contain only values that appear verbatim in the lists above. Anything else will be discarded.`,
        `sections is free-form: heading is a short title, guidance is one or two sentences telling the document generator what belongs in that section.`,
      ].join("\n");

      // Cost attribution (#48): this is a platform-funded authoring aid, not a
      // customer deliverable, so costOwner is "platform" and there is no
      // customerId/mspId to attach — it is not tenant-scoped.
      const message = await withAiAttribution(
        {
          costOwner: "platform",
          feature: "document_scoping_suggest",
          generatedArtifactType: "scoping_suggestion",
          generatedArtifactName: label,
          ...(key ? { generatedArtifactId: key } : {}),
          triggerSource: "admin-document-generator:suggest-scoping",
        },
        () =>
          anthropic.messages.create({
            model: SUGGEST_MODEL,
            max_tokens: 2000,
            messages: [{ role: "user", content: prompt }],
          }),
      );

      const textBlock = message.content.find((b) => b.type === "text");
      const parsed = textBlock?.type === "text" ? extractJsonObject(textBlock.text) : null;
      if (!parsed || typeof parsed !== "object") {
        scopingLog.warn({ key: key || null, label }, "suggest-scoping: model returned an unreadable response");
        res.status(502).json({ error: "AI returned an unreadable response — please try again" });
        return;
      }

      // ── Step 3: hard server-side validation ───────────────────────────────
      const rawPatterns = stringArray((parsed as { profileKeyPatterns?: unknown }).profileKeyPatterns);
      const rawCategories = stringArray((parsed as { signalCategories?: unknown }).signalCategories);
      const rawSections = suggestedSections((parsed as { sections?: unknown }).sections);

      const profileKeyPatterns = Array.from(new Set(rawPatterns.filter((p) => realProfileKeys.has(p))));
      const signalCategories = Array.from(new Set(rawCategories.filter((c) => realCategories.has(c))));
      const sections = rawSections.slice(0, MAX_SUGGESTED_SECTIONS);

      scopingLog.info(
        {
          key: key || null,
          label,
          category,
          serviceId,
          profileKeys: { requested: rawPatterns.length, kept: profileKeyPatterns.length, available: realProfileKeys.size },
          signalCategories: { requested: rawCategories.length, kept: signalCategories.length },
          sections: { requested: rawSections.length, kept: sections.length },
        },
        "suggest-scoping: validated AI suggestion against real registries",
      );

      res.json({
        profileKeyPatterns,
        signalCategories,
        sections,
        meta: {
          profileKeyPatterns: { requested: rawPatterns.length, kept: profileKeyPatterns.length },
          signalCategories: { requested: rawCategories.length, kept: signalCategories.length },
          sections: { requested: rawSections.length, kept: sections.length },
        },
      });
    } catch (err) {
      scopingLog.error({ err, key: key || null }, "admin-document-generator: suggest-scoping failed");
      res.status(500).json({ error: "Failed to generate scoping suggestion" });
    }
  },
);

export default router;
