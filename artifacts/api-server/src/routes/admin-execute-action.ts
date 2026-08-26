/**
 * admin-execute-action.ts
 *
 * POST /api/admin/remediation/execute-action — execute ONE micro-remediation
 * (a sellable `services.category='micro_remediation'` product, resolved to its
 * real `baseline_action_templates` executable through the one canonical wiring
 * in lib/remediation-catalog.ts) against ONE customer's REAL connected
 * Microsoft tenant. Epic #1319 Phase 4 (Git #1323) — the MCP server's
 * `execute_action` tool is the intended caller.
 *
 * NO isTestbed gate — deliberately. Per Shane's explicit direction on #1319,
 * MCP write tools operate against real production tenants from day one,
 * unlike the testbed-only surfaces (admin-write-actions, msp-launch-control,
 * the config-pack orchestrator's v1 guard). What still stands, unchanged:
 *   - graphWriteForTenant's real production write gates — the customer's MSP
 *     must have write-back enabled AND the tenant must hold granted write
 *     consent, or the write is refused (surfaced as 409 with the gate name);
 *   - the MCP side's mandatory write-ahead audit (Git #1325) — the tool never
 *     runs without a durably persisted msp_audit_logs attempt row;
 *   - the server-side confirmed:true requirement below.
 *
 * Posture mirrors admin-write-actions' preview→confirm→execute contract, in
 * one route: anything other than confirmed:true returns a PREVIEW — the
 * byte-for-byte resolved request via resolveBaselineTemplateRequest(), the
 * same single substitution implementation execution uses — and never touches
 * Graph. confirmed:true executes through the one production engine,
 * runBaselineTemplateAgainstTenant() (source:"execute_action"), which records
 * every run in baseline_action_template_audit_log.
 *
 * A config_pack product is refused here: that is a full pack run
 * (POST /admin/config-packs/:packKey/run — the execute_write_pack tool), not
 * a single action. The catalog's own `unwired` products are refused with
 * their declared honest reason.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { baselineActionTemplatesTable, servicesTable, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { resolveServiceExecutable } from "../lib/remediation-catalog";
import {
  resolveBaselineTemplateRequest,
  runBaselineTemplateAgainstTenant,
} from "../lib/workflow-executor";
import { evaluateSuccessCriteria } from "../lib/write-action-safety";
import {
  WriteBackCustomerNotFoundError,
  WriteBackNotEnabledError,
  WriteConsentRequiredError,
} from "../lib/graph";

// Same channel as the config-pack orchestrator — this is the remediation
// engine's single-action surface, not an admin CRUD screen.
const log = logger.child({ channel: "engine.config-pack" });

const router: IRouter = Router();

/** The sellable micro-remediation slugs, for honest "did you mean" errors. */
async function listMicroRemediationSlugs(): Promise<string[]> {
  const rows = await db
    .select({ slug: servicesTable.slug })
    .from(servicesTable)
    .where(eq(servicesTable.category, "micro_remediation"))
    .orderBy(servicesTable.slug);
  return rows.map((r) => r.slug).filter((s): s is string => Boolean(s));
}

/** Map a Graph write-gate refusal to an honest, specific 409 — same mapping as
 *  admin-write-actions. These are the REAL production gates that stay armed
 *  precisely because this route has no testbed gate. */
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

router.post("/admin/remediation/execute-action", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      serviceSlug?: unknown;
      customerId?: unknown;
      variables?: Record<string, string>;
      confirmed?: unknown;
    };

    const serviceSlug = typeof body.serviceSlug === "string" ? body.serviceSlug.trim() : "";
    if (!serviceSlug) {
      return void res.status(400).json({
        error: "serviceSlug (a micro-remediation catalog slug, e.g. 'remediate-revoke-sessions') is required",
        microRemediationSlugs: await listMicroRemediationSlugs(),
      });
    }

    const [service] = await db
      .select({
        id: servicesTable.id,
        name: servicesTable.name,
        slug: servicesTable.slug,
        category: servicesTable.category,
        typeAttributes: servicesTable.typeAttributes,
      })
      .from(servicesTable)
      .where(eq(servicesTable.slug, serviceSlug))
      .limit(1);
    if (!service) {
      return void res.status(404).json({
        error: `No catalog service with slug '${serviceSlug}'`,
        microRemediationSlugs: await listMicroRemediationSlugs(),
      });
    }

    // The one canonical product→executable resolution (Git #1172) — never a
    // second mapping. Everything that is not a micro_remediation is refused.
    const exec = resolveServiceExecutable({
      slug: service.slug,
      category: service.category,
      typeAttributes: service.typeAttributes,
    });
    if (exec.kind === "config_pack") {
      return void res.status(400).json({
        error:
          `'${serviceSlug}' is a config_pack product (pack '${exec.packKey}') — a full pack run, not a single ` +
          "micro-remediation. Use POST /admin/config-packs/:packKey/run (the execute_write_pack tool) instead.",
      });
    }
    if (exec.kind === "unwired") {
      return void res.status(409).json({
        error: `'${serviceSlug}' has no executable yet: ${exec.reason}`,
      });
    }
    if (exec.kind !== "micro_remediation") {
      return void res.status(400).json({
        error: `'${serviceSlug}' (category '${service.category}') is not a micro-remediation product`,
        microRemediationSlugs: await listMicroRemediationSlugs(),
      });
    }

    const customerId = body.customerId;
    if (typeof customerId !== "number" || !Number.isInteger(customerId) || customerId <= 0) {
      return void res.status(400).json({
        error: "customerId (tenants.id of the target customer) is required and must be a positive integer",
      });
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
      return void res.status(404).json({ error: `Customer ${customerId} not found` });
    }
    if (!customer.tenantId) {
      return void res.status(400).json({
        error: `Customer ${customerId} has no connected tenant (tenant_id is empty) — nothing to execute against`,
      });
    }

    const [template] = await db
      .select()
      .from(baselineActionTemplatesTable)
      .where(eq(baselineActionTemplatesTable.templateId, exec.templateId))
      .limit(1);
    if (!template) {
      // The catalog declares this executable but the template row is absent —
      // an honest wiring fault, never silently "resolved" to something else.
      return void res.status(409).json({
        error: `Catalog resolves '${serviceSlug}' to template '${exec.templateId}', but no such baseline_action_template exists`,
      });
    }

    // Same derivable context the config-pack orchestrator supplies, then the
    // caller's variables; customerId always wins last (it keys the audit row
    // and the write gates — never caller-overridable).
    const payload: Record<string, unknown> = {
      tenantName: customer.name,
      organizationId: customer.tenantId,
      currentDateTime: new Date().toISOString(),
      ...(body.variables ?? {}),
      customerId: customer.id,
    };

    // The microrem.* family declares success_criteria as {expectStatus:N};
    // launch-control templates use {statusCode:N}. evaluateSuccessCriteria
    // reads statusCode, so normalize — comparison data, never the authority
    // on success (that stays graphWriteForTenant's [200,201,204] class).
    const rawCriteria = (template.successCriteria ?? {}) as Record<string, unknown>;
    const normalizedCriteria: Record<string, unknown> = {
      ...rawCriteria,
      statusCode: rawCriteria["statusCode"] ?? rawCriteria["expectStatus"],
    };

    const serviceInfo = { slug: serviceSlug, name: service.name, templateId: exec.templateId };
    const tenantInfo = { customerId: customer.id, name: customer.name, isTestbed: customer.isTestbed };

    if (body.confirmed !== true) {
      // PREVIEW — the exact request a confirmed call will send (the same
      // single substitution implementation execution uses). No Graph call.
      const resolved = await resolveBaselineTemplateRequest(exec.templateId, payload);
      log.info(
        { serviceSlug, templateId: exec.templateId, customerId: customer.id, missingVariables: resolved.missingVariables },
        "execute-action: preview resolved (no write performed)",
      );
      return void res.json({
        mode: "preview",
        service: serviceInfo,
        tenant: tenantInfo,
        resolvedRequest: {
          endpoint: resolved.endpoint,
          rawEndpoint: resolved.rawEndpoint,
          method: resolved.method,
          body: resolved.body,
          rawBodyTemplate: resolved.rawBodyTemplate,
          requiredVariables: resolved.requiredVariables,
          missingVariables: resolved.missingVariables,
        },
        ready: resolved.missingVariables.length === 0,
        safety: {
          reversible: template.reversible,
          reverseTemplateId: template.reverseTemplateId,
          requiresVerificationGate: template.requiresVerificationGate,
          successCriteria: rawCriteria,
        },
        confirmationRequired:
          "This was a preview only. Re-send the same request with confirmed:true to execute this exact resolved request against the customer's LIVE tenant.",
      });
    }

    // EXECUTE — the one production engine; source tags the
    // baseline_action_template_audit_log row this run writes.
    let result;
    try {
      result = await runBaselineTemplateAgainstTenant(
        exec.templateId,
        customer.tenantId,
        customer.id,
        payload,
        "execute_action",
      );
    } catch (execErr) {
      const gateErr = describeWriteGateError(execErr);
      if (gateErr) {
        log.warn(
          { serviceSlug, templateId: exec.templateId, customerId: customer.id, gate: gateErr.gate },
          "execute-action: refused by a production write gate",
        );
        return void res.status(gateErr.status).json({ error: gateErr.error, gate: gateErr.gate });
      }
      throw execErr;
    }

    const successCriteria = evaluateSuccessCriteria(normalizedCriteria, result.status);

    log.info(
      {
        serviceSlug,
        templateId: exec.templateId,
        customerId: customer.id,
        success: result.success,
        status: result.status,
        auditLogId: result.auditLogId,
      },
      "execute-action: real write executed against the customer's live tenant",
    );

    return void res.json({
      mode: "executed",
      service: serviceInfo,
      tenant: tenantInfo,
      result,
      successCriteria,
    });
  } catch (err) {
    log.error({ err }, "execute-action: failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to execute action" });
  }
});

export default router;
