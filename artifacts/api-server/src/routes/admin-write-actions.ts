/**
 * admin-write-actions.ts
 *
 * Simulator Studio — "Write Actions" surface. A TESTBED-ONLY testing tool for the
 * real write-action catalog (baseline_action_templates), extending the read-only
 * "M365 Endpoints" phases to tenant-MUTATING actions. Every write here genuinely
 * changes a live testbed tenant's state, so the safety posture is the point, not
 * polish:
 *
 *   - TESTBED-ONLY, enforced SERVER-SIDE. Every mutating/preview route rejects a
 *     non-isTestbed customerId with 403 — the frontend not offering one is never
 *     the gate (assertTestbedCustomer below). This mirrors the existing
 *     admin-baseline-templates "/test" route and msp-launch-control's own
 *     isTestbed guard — the SAME is_testbed flag, not a new one.
 *
 *   - REUSE, NOT REIMPLEMENT. Execution goes through the one production engine,
 *     runBaselineTemplateAgainstTenant() in workflow-executor.ts (the same
 *     function Launch Control, the workflow node, and the admin Testing tab use),
 *     tagged source:"simulator". The confirmation preview uses that engine's own
 *     resolveBaselineTemplateRequest() so the operator confirms byte-for-byte what
 *     will execute. Request construction is never rebuilt here.
 *
 *   - EXPLICIT CONFIRMATION, server-backed. /execute requires confirmed:true in
 *     the body — a UI that forgot the confirm step is refused server-side, not
 *     just visually.
 *
 *   - HISTORY reuses the existing production audit log
 *     (baseline_action_template_audit_log) that runBaselineTemplateAgainstTenant
 *     already writes on every run — no parallel simulator table.
 *
 * Routes (all requireAdmin):
 *   GET  /api/admin/write-actions                         (tree: executable templates + catalog safety)
 *   GET  /api/admin/write-actions/testbed-customers       (eligible testbed targets)
 *   POST /api/admin/write-actions/:templateId/preview     (resolve the REAL request; no write)
 *   POST /api/admin/write-actions/:templateId/execute     (REAL write; confirmed:true required)
 *   GET  /api/admin/write-actions/:templateId/runs        (execution history from the audit log)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  baselineActionTemplatesTable,
  baselineActionTemplateAuditLogTable,
  writeActionCatalogTable,
  tenantsTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAdmin, requireAdminOrIngestToken } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import {
  resolveBaselineTemplateRequest,
  runBaselineTemplateAgainstTenant,
} from "../lib/workflow-executor";
import {
  evaluateSuccessCriteria,
  resolveDependsOnState,
  type DependsOnState,
} from "../lib/write-action-safety";
import {
  WriteBackCustomerNotFoundError,
  WriteBackNotEnabledError,
  WriteConsentRequiredError,
} from "../lib/graph";

const log = logger.child({ channel: "admin.clients" });

const router: IRouter = Router();

// ── Testbed gate — the load-bearing server-side restriction ─────────────────────

interface TestbedCustomer {
  id: number;
  name: string | null;
  tenantId: string;
}

type TestbedRejection = { ok: false; status: number; error: string };
type TestbedResolution = { ok: true; customer: TestbedCustomer } | TestbedRejection;

/**
 * Resolve a customerId to a connected TESTBED customer, or return a typed
 * rejection. This is the single choke point every write/preview route funnels
 * through — a non-testbed customer can never reach an execution or even a
 * request-resolution preview, regardless of what the UI sends.
 */
async function assertTestbedCustomer(customerId: unknown): Promise<TestbedResolution> {
  if (typeof customerId !== "number" || !Number.isInteger(customerId) || customerId <= 0) {
    return { ok: false, status: 400, error: "customerId (a testbed customer) is required" };
  }

  const [customer] = await db
    .select({
      id: tenantsTable.id,
      name: tenantsTable.customerName,
      tenantId: tenantsTable.tenantId,
      isTestbed: tenantsTable.isTestbed,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);

  if (!customer) {
    return { ok: false, status: 404, error: "Customer not found" };
  }
  if (!customer.isTestbed) {
    // Server-side refusal — NEVER weakened. A write-capable testing surface that
    // could fire against a real paying customer's live tenant is not acceptable.
    return {
      ok: false,
      status: 403,
      error:
        "Write Actions are only permitted against a customer flagged isTestbed — this is a REAL tenant-mutating write, never point it at a live customer tenant",
    };
  }
  if (!customer.tenantId) {
    return { ok: false, status: 400, error: "Selected testbed customer has no connected tenant" };
  }

  return { ok: true, customer: { id: customer.id, name: customer.name, tenantId: customer.tenantId } };
}

/** Map a Graph write-gate error thrown by the executor to an honest, specific message. */
function describeWriteGateError(err: unknown): { status: number; error: string; gate: string } | null {
  if (err instanceof WriteBackCustomerNotFoundError) {
    return { status: 409, gate: "write_back_customer_not_found", error: err.message };
  }
  if (err instanceof WriteBackNotEnabledError) {
    return { status: 409, gate: "write_back_not_enabled", error: err.message };
  }
  if (err instanceof WriteConsentRequiredError) {
    return { status: 409, gate: "write_consent_not_granted", error: err.message };
  }
  return null;
}

// ── Tree: executable write-action templates + their catalog safety metadata ─────

router.get("/admin/write-actions", requireAdmin, async (_req: Request, res: Response) => {
  try {
    // Driven by baseline_action_templates — the real EXECUTABLE universe — LEFT
    // JOINed to write_action_catalog on template_id for the customer-facing safety
    // metadata (safeOrGated / minBundledTier / snapshotNotes / blockedReason /
    // requiredPermission / domain / surface). The catalog link (template_id) is
    // still unpopulated for most rows, so catalogLinked flags where it is (and is
    // not) established — showing only linked templates would be an empty tree.
    const rows = await db
      .select({
        templateId: baselineActionTemplatesTable.templateId,
        label: baselineActionTemplatesTable.label,
        description: baselineActionTemplatesTable.description,
        category: baselineActionTemplatesTable.category,
        endpoint: baselineActionTemplatesTable.endpoint,
        method: baselineActionTemplatesTable.method,
        requiredVariables: baselineActionTemplatesTable.requiredVariables,
        dependsOn: baselineActionTemplatesTable.dependsOn,
        requiresVerificationGate: baselineActionTemplatesTable.requiresVerificationGate,
        reversible: baselineActionTemplatesTable.reversible,
        reverseTemplateId: baselineActionTemplatesTable.reverseTemplateId,
        status: baselineActionTemplatesTable.status,
        // Catalog side (nullable — LEFT JOIN, mostly unlinked as of this writing):
        catalogDomain: writeActionCatalogTable.domain,
        catalogSurface: writeActionCatalogTable.surface,
        catalogRequiredPermission: writeActionCatalogTable.requiredPermission,
        catalogSafeOrGated: writeActionCatalogTable.safeOrGated,
        catalogMinBundledTier: writeActionCatalogTable.minBundledTier,
        catalogSnapshotNotes: writeActionCatalogTable.snapshotNotes,
        catalogStatus: writeActionCatalogTable.status,
        catalogBlockedReason: writeActionCatalogTable.blockedReason,
      })
      .from(baselineActionTemplatesTable)
      .leftJoin(
        writeActionCatalogTable,
        eq(writeActionCatalogTable.templateId, baselineActionTemplatesTable.templateId),
      )
      .orderBy(baselineActionTemplatesTable.category, baselineActionTemplatesTable.templateId);

    // Label map for resolving reverseTemplateId -> its human label (rollback info).
    const labelById = new Map(rows.map(r => [r.templateId, r.label]));

    const templates = rows.map(r => ({
      templateId: r.templateId,
      label: r.label,
      description: r.description,
      category: r.category,
      endpoint: r.endpoint,
      method: r.method,
      requiredVariables: r.requiredVariables ?? [],
      dependsOn: r.dependsOn ?? [],
      requiresVerificationGate: r.requiresVerificationGate,
      reversible: r.reversible,
      reverseTemplateId: r.reverseTemplateId,
      reverseTemplateLabel: r.reverseTemplateId ? labelById.get(r.reverseTemplateId) ?? null : null,
      status: r.status,
      catalogLinked: r.catalogDomain !== null,
      catalog: r.catalogDomain === null
        ? null
        : {
            domain: r.catalogDomain,
            surface: r.catalogSurface,
            requiredPermission: r.catalogRequiredPermission,
            safeOrGated: r.catalogSafeOrGated,
            minBundledTier: r.catalogMinBundledTier,
            snapshotNotes: r.catalogSnapshotNotes,
            status: r.catalogStatus,
            blockedReason: r.catalogBlockedReason,
          },
    }));

    res.json({ templates });
  } catch (err) {
    log.error({ err }, "admin-write-actions: list failed");
    res.status(500).json({ error: "Failed to list write-action templates" });
  }
});

// Testbed-only customer picker (identical criteria to the baseline Testing tab).
router.get("/admin/write-actions/testbed-customers", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const customers = await db
      .select({ id: tenantsTable.id, name: tenantsTable.customerName, tenantId: tenantsTable.tenantId })
      .from(tenantsTable)
      .where(and(eq(tenantsTable.isTestbed, true), eq(tenantsTable.status, "active")))
      .orderBy(tenantsTable.customerName);
    res.json({ customers: customers.filter(c => Boolean(c.tenantId)) });
  } catch (err) {
    log.error({ err }, "admin-write-actions: list testbed customers failed");
    res.status(500).json({ error: "Failed to list testbed customers" });
  }
});

/**
 * Fetch the dependsOn chain state for a template against a customer — which
 * declared dependencies exist and which have a recorded successful run for this
 * customer. Best-effort (the executor does not enforce dependsOn); powers the
 * standalone-run warning.
 */
async function loadDependsOnState(dependsOn: string[], customerId: number): Promise<DependsOnState> {
  if (dependsOn.length === 0) {
    return resolveDependsOnState([], new Map(), new Set());
  }

  const depTemplates = await db
    .select({ templateId: baselineActionTemplatesTable.templateId, label: baselineActionTemplatesTable.label })
    .from(baselineActionTemplatesTable)
    .where(inArray(baselineActionTemplatesTable.templateId, dependsOn));
  const labelById = new Map(depTemplates.map(t => [t.templateId, t.label]));

  // Successful executions (action = "executed") of any dependency, then filtered
  // to this customer via the afterSnapshot.customerId captured at run time.
  const priorRuns = await db
    .select({
      templateId: baselineActionTemplateAuditLogTable.templateId,
      afterSnapshot: baselineActionTemplateAuditLogTable.afterSnapshot,
    })
    .from(baselineActionTemplateAuditLogTable)
    .where(
      and(
        inArray(baselineActionTemplateAuditLogTable.templateId, dependsOn),
        eq(baselineActionTemplateAuditLogTable.action, "executed"),
      ),
    );

  const succeeded = new Set<string>();
  for (const run of priorRuns) {
    if (!run.templateId) continue;
    const snap = (run.afterSnapshot ?? {}) as Record<string, unknown>;
    if (snap["customerId"] === customerId && snap["success"] === true) {
      succeeded.add(run.templateId);
    }
  }

  return resolveDependsOnState(dependsOn, labelById, succeeded);
}

// ── Archived templates are not runnable (Git #2937) ─────────────────────────────
//
// `status` on baseline_action_templates is the schema's first-class retirement
// switch ("Archived (not hard-deleted) templates are grandfathered into any
// config pack that already references them"). Before #2937 nothing enforced it
// on this route: an archived row still previewed and still executed by
// templateId, which made archiving purely decorative. #2937 archived
// action.submit-file-detonation precisely because its stored endpoint
// (POST /security/alerts_v2) is not an operation Microsoft Graph exposes, so
// letting it execute would send a request that cannot succeed.
function describeArchivedTemplate(templateId: string, status: string): string {
  return (
    `Write-action template '${templateId}' is ${status}, not active — archived templates are not runnable. ` +
    "See the template's description for why it was retired."
  );
}

// ── Preview: resolve the REAL request without executing anything ─────────────────

router.post("/admin/write-actions/:templateId/preview", requireAdmin, async (req: Request, res: Response) => {
  try {
    const templateId = req.params.templateId as string;
    const body = req.body as { customerId?: number; variables?: Record<string, string> };

    // Testbed gate FIRST — a non-testbed customer never even resolves a request.
    const gate = await assertTestbedCustomer(body.customerId);
    if (!gate.ok) return void res.status(gate.status).json({ error: gate.error });

    const [template] = await db
      .select()
      .from(baselineActionTemplatesTable)
      .where(eq(baselineActionTemplatesTable.templateId, templateId))
      .limit(1);
    if (!template) return void res.status(404).json({ error: "Write-action template not found" });
    if (template.status !== "active") {
      return void res.status(409).json({
        error: describeArchivedTemplate(templateId, template.status),
        gate: "template_archived",
      });
    }

    // The SAME resolution the executor performs — the operator confirms exactly
    // what will be sent. customerId is injected into the payload the same way the
    // admin Testing route does, so path/body variables referencing it resolve.
    const payload: Record<string, unknown> = { ...(body.variables ?? {}), customerId: gate.customer.id };
    const resolved = await resolveBaselineTemplateRequest(templateId, payload);

    const dependsOnState = await loadDependsOnState(template.dependsOn ?? [], gate.customer.id);

    // Reverse (rollback) target detail — an operator must see whether a real
    // rollback path exists BEFORE running, not discover its absence after.
    let reverse: { templateId: string; label: string | null; endpoint: string | null; method: string | null } | null = null;
    if (template.reversible && template.reverseTemplateId) {
      const [rev] = await db
        .select({ templateId: baselineActionTemplatesTable.templateId, label: baselineActionTemplatesTable.label, endpoint: baselineActionTemplatesTable.endpoint, method: baselineActionTemplatesTable.method })
        .from(baselineActionTemplatesTable)
        .where(eq(baselineActionTemplatesTable.templateId, template.reverseTemplateId))
        .limit(1);
      reverse = rev
        ? { templateId: rev.templateId, label: rev.label, endpoint: rev.endpoint, method: rev.method }
        : { templateId: template.reverseTemplateId, label: null, endpoint: null, method: null };
    }

    const [catalog] = await db
      .select({
        domain: writeActionCatalogTable.domain,
        surface: writeActionCatalogTable.surface,
        requiredPermission: writeActionCatalogTable.requiredPermission,
        safeOrGated: writeActionCatalogTable.safeOrGated,
        minBundledTier: writeActionCatalogTable.minBundledTier,
        snapshotNotes: writeActionCatalogTable.snapshotNotes,
        status: writeActionCatalogTable.status,
        blockedReason: writeActionCatalogTable.blockedReason,
      })
      .from(writeActionCatalogTable)
      .where(eq(writeActionCatalogTable.templateId, templateId))
      .limit(1);

    res.json({
      // The ACTUAL request that /execute will send — endpoint + method + body
      // after substitution — this is what the confirmation dialog shows.
      resolvedRequest: {
        endpoint: resolved.endpoint,
        rawEndpoint: resolved.rawEndpoint,
        method: resolved.method,
        body: resolved.body,
        rawBodyTemplate: resolved.rawBodyTemplate,
        requiredVariables: resolved.requiredVariables,
        missingVariables: resolved.missingVariables,
      },
      /** true only when every requiredVariable resolved — /execute would otherwise 400 before any Graph call. */
      ready: resolved.missingVariables.length === 0,
      safety: {
        reversible: template.reversible,
        reverse,
        requiresVerificationGate: template.requiresVerificationGate,
        successCriteria: template.successCriteria ?? {},
        dependsOn: dependsOnState,
        catalogLinked: Boolean(catalog),
        catalog: catalog ?? null,
      },
      tenant: { customerId: gate.customer.id, name: gate.customer.name },
    });
  } catch (err) {
    log.error({ err }, "admin-write-actions: preview failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to resolve write-action preview" });
  }
});

// ── Execute: REAL tenant-mutating write, confirmed:true required ─────────────────

router.post("/admin/write-actions/:templateId/execute", requireAdminOrIngestToken(), async (req: Request, res: Response) => {
  try {
    const templateId = req.params.templateId as string;
    const body = req.body as { customerId?: number; variables?: Record<string, string>; confirmed?: boolean };

    // Explicit confirmation is a server-side requirement, not just a UI step —
    // a client that never showed the resolved request cannot execute.
    if (body.confirmed !== true) {
      return void res.status(400).json({
        error: "confirmed:true is required — the resolved request must be reviewed and confirmed before a real write",
      });
    }

    // Testbed gate — enforced here regardless of anything the UI did or didn't do.
    const gate = await assertTestbedCustomer(body.customerId);
    if (!gate.ok) return void res.status(gate.status).json({ error: gate.error });

    const [template] = await db
      .select()
      .from(baselineActionTemplatesTable)
      .where(eq(baselineActionTemplatesTable.templateId, templateId))
      .limit(1);
    if (!template) return void res.status(404).json({ error: "Write-action template not found" });
    if (template.status !== "active") {
      return void res.status(409).json({
        error: describeArchivedTemplate(templateId, template.status),
        gate: "template_archived",
      });
    }

    // The one production execution engine — never a parallel implementation.
    // source:"simulator" tags the audit-log row so history can distinguish it.
    const payload: Record<string, unknown> = { ...(body.variables ?? {}), customerId: gate.customer.id };
    let result;
    try {
      result = await runBaselineTemplateAgainstTenant(templateId, gate.customer.tenantId, gate.customer.id, payload, "simulator");
    } catch (execErr) {
      const gateErr = describeWriteGateError(execErr);
      if (gateErr) {
        log.warn({ templateId, customerId: gate.customer.id, gate: gateErr.gate }, "admin-write-actions: execute blocked by a write gate");
        return void res.status(gateErr.status).json({ error: gateErr.error, gate: gateErr.gate });
      }
      throw execErr;
    }

    const successCriteria = evaluateSuccessCriteria(template.successCriteria ?? {}, result.status);

    log.info(
      { templateId, customerId: gate.customer.id, tenantId: gate.customer.tenantId, success: result.success, status: result.status },
      "admin-write-actions: write execution completed",
    );

    res.json({
      result,
      successCriteria,
      tenant: { customerId: gate.customer.id, name: gate.customer.name },
    });
  } catch (err) {
    log.error({ err }, "admin-write-actions: execute failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to execute write action" });
  }
});

// ── History: executions of this template, from the production audit log ──────────

router.get("/admin/write-actions/:templateId/runs", requireAdmin, async (req: Request, res: Response) => {
  try {
    const templateId = req.params.templateId as string;
    const query = req.query as Record<string, string>;
    const limit = Math.min(Number(query.limit ?? "25") || 25, 100);
    const customerFilter = query.customerId ? Number(query.customerId) : undefined;

    const rows = await db
      .select()
      .from(baselineActionTemplateAuditLogTable)
      .where(
        and(
          eq(baselineActionTemplateAuditLogTable.templateId, templateId),
          inArray(baselineActionTemplateAuditLogTable.action, ["executed", "failed"]),
        ),
      )
      .orderBy(desc(baselineActionTemplateAuditLogTable.createdAt))
      .limit(customerFilter ? 200 : limit);

    const runs = rows
      .map(r => {
        const snap = (r.afterSnapshot ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          action: r.action,
          createdAt: r.createdAt,
          success: snap["success"] === true,
          status: typeof snap["status"] === "number" ? (snap["status"] as number) : null,
          errorType: (snap["errorType"] as string | null) ?? null,
          endpoint: (snap["endpoint"] as string | null) ?? null,
          method: (snap["method"] as string | null) ?? null,
          customerId: typeof snap["customerId"] === "number" ? (snap["customerId"] as number) : null,
          source: (snap["source"] as string | null) ?? null,
          requestVariables: r.requestVariables ?? {},
        };
      })
      .filter(run => (customerFilter ? run.customerId === customerFilter : true))
      .slice(0, limit);

    res.json({ runs });
  } catch (err) {
    log.error({ err }, "admin-write-actions: run history failed");
    res.status(500).json({ error: "Failed to load write-action run history" });
  }
});

export default router;
