/**
 * tenant-write-preconditions.live-verify.ts — Git #4528
 *
 * LIVE proof that execute_action and SOP runs now refuse, before any write, a
 * step the real testbed tenant is not licensed for — the #4513 preconditions
 * that previously gated only Config Packs. Talks to the real local Postgres and
 * the real tenant's /subscribedSkus (a READ). Opt-in:
 *
 *   npx vitest run --config vitest.live-verify.config.ts src/lib/tenant-write-preconditions.live-verify.ts
 *
 * Requires .env.local loaded. Target: the testbed customer (tenants.is_testbed),
 * which on 2026-09-17 held ENTERPRISEPACK but no Entra ID P1.
 *
 * Safety: every write-capable call below is made only after the harness has
 * confirmed, from the live SKU read, that the tenant lacks Entra ID P1 — so the
 * precondition under test is the thing that stops it. If the tenant ever gains
 * P1, the write-capable cases are skipped rather than allowed to write to what
 * is also Shane's production M365 tenant (Git #1913).
 *
 * Git #4522/#4607 — the two `microrem.enforce-ca-policy` / SOP-SEED-IAM-03 cases
 * below are refused by rule 0 (CA enforcement) regardless of the tenant's
 * license, because `caEnforcementMode` is never passed as "immediate" by
 * execute_action or an SOP run (monitor-first is the only reachable mode here) —
 * so those two are NOT gated on `lacksP1`; they are safe on any tenant state.
 * The license rule itself is proven in isolation by the `action.create-named-location`
 * case, which is gated on `lacksP1` since it is the one case that actually depends
 * on the tenant's real license state.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../middlewares/requireAuth.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdminOrIngestToken:
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { db, baselineActionTemplatesTable, tenantsTable, wfDefinitionsTable, wfVersionsTable, wfRunsTable, wfRunNodeOutputsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import executeActionRouter from "../routes/admin-execute-action.ts";
import baselineTemplatesRouter from "../routes/admin-baseline-templates.ts";
import writeActionsRouter from "../routes/admin-write-actions.ts";
import { getProvisionedServicePlanNamesForTenant } from "./license-gate.ts";
import { runSopForCustomer } from "./sop-execution.ts";
import { fireWorkflowForDefinition } from "./workflow-executor.ts";
import {
  loadRequiredLicenseSkuListsByTemplate,
  resolveTenantWritePreconditionRefusal,
} from "./tenant-write-preconditions.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function auditRowCount(templateId: string): Promise<number> {
  const res = await db.execute(
    sql`select count(*) as n from baseline_action_template_audit_log where template_id = ${templateId}`,
  );
  return Number((res.rows[0] as { n: string | number }).n);
}

const P1 = ["AAD_PREMIUM", "AAD_PREMIUM_P2"];

let customer: { id: number; mspId: number | null; tenantId: string };
let lacksP1 = false;

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const res = await db.execute(query);
  return Number((res.rows[0] as { n: string | number }).n);
}

beforeAll(async () => {
  const [row] = await db
    .select({ id: tenantsTable.id, mspId: tenantsTable.mspId, tenantId: tenantsTable.tenantId })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.isTestbed, true), eq(tenantsTable.customerName, "McCawSoft")))
    .limit(1);
  if (!row?.tenantId) throw new Error("testbed customer McCawSoft not found");
  customer = { id: row.id, mspId: row.mspId, tenantId: row.tenantId };
  // #4535 — the gate reads provisioned service plans, so this must too.
  const plans = await getProvisionedServicePlanNamesForTenant(customer.tenantId);
  expect(plans.error).toBeNull();
  lacksP1 = !P1.some((s) => plans.servicePlanNames.has(s));
});

describe("execute_action (#4528)", () => {
  const app = express().use(express.json()).use("/api", executeActionRouter);
  const body = () => ({
    serviceSlug: "remediate-enable-ca-policy",
    customerId: customer.id,
    variables: { policyId: "00000000-0000-0000-0000-000000000000" },
  });

  it("preview reports ca_enforcement_requires_promotion and not ready — #4522's rule 0 refuses this write before rule 1 even reads the tenant's license", async () => {
    const res = await request(app).post("/api/admin/remediation/execute-action").send(body());
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("preview");
    expect(res.body.ready).toBe(false);
    expect(res.body.precondition?.code).toBe("ca_enforcement_requires_promotion");
  });

  it("confirmed:true is refused 422 before any write — no audit row is recorded", async () => {
    const before = await count(
      sql`select count(*) as n from baseline_action_template_audit_log where template_id = 'microrem.enforce-ca-policy'`,
    );
    const res = await request(app)
      .post("/api/admin/remediation/execute-action")
      .send({ ...body(), confirmed: true });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("ca_enforcement_requires_promotion");
    const after = await count(
      sql`select count(*) as n from baseline_action_template_audit_log where template_id = 'microrem.enforce-ca-policy'`,
    );
    expect(after).toBe(before);
  });

  it("a template with no CA-policy-state write in play is still refused license_required on the unlicensed testbed tenant (#4607 — proves the license rule survives #4522's rule 0)", async () => {
    if (!lacksP1) return void console.warn("tenant holds Entra ID P1 — license case not applicable");
    const templateId = "action.create-named-location";
    const [t] = await db
      .select()
      .from(baselineActionTemplatesTable)
      .where(eq(baselineActionTemplatesTable.templateId, templateId))
      .limit(1);
    expect(t).toBeTruthy();
    const lists = await loadRequiredLicenseSkuListsByTemplate([templateId]);
    const refusal = await resolveTenantWritePreconditionRefusal({
      packKey: templateId,
      subject: `Action '${templateId}'`,
      steps: [
        {
          templateId,
          method: t!.method,
          endpoint: t!.endpoint,
          bodyTemplate: (t!.bodyTemplate ?? {}) as Record<string, unknown>,
          requiredLicenseSkuLists: lists.get(templateId) ?? [],
        },
      ],
      tenantId: customer.tenantId,
      payload: { customerId: customer.id, cidrRange: "203.0.113.0/24", locationName: "live-verify #4607 named location" },
    });
    expect(refusal?.code).toBe("license_required");
    expect(refusal?.details?.requiredLicenseSkus).toEqual(expect.arrayContaining(["AAD_PREMIUM"]));
  });

  it("a lone Security Defaults disable is refused on the live tenant (no enforcing replacement)", async () => {
    const templateId = "quickstart-v1.disable-security-defaults";
    const [t] = await db
      .select()
      .from(baselineActionTemplatesTable)
      .where(eq(baselineActionTemplatesTable.templateId, templateId))
      .limit(1);
    expect(t).toBeTruthy();
    const lists = await loadRequiredLicenseSkuListsByTemplate([templateId]);
    const refusal = await resolveTenantWritePreconditionRefusal({
      packKey: templateId,
      subject: `Action '${templateId}'`,
      steps: [
        {
          templateId,
          method: t!.method,
          endpoint: t!.endpoint,
          bodyTemplate: (t!.bodyTemplate ?? {}) as Record<string, unknown>,
          requiredLicenseSkuLists: lists.get(templateId) ?? [],
        },
      ],
      tenantId: customer.tenantId,
      payload: { customerId: customer.id },
    });
    expect(refusal?.code).toBe("security_defaults_replacement_not_enforcing");
  });
});

describe("SOP run (#4528)", () => {
  it("SOP-SEED-IAM-03 (creates a CA policy) is refused ca_enforcement_requires_promotion before any claim, persist or fire", async () => {
    const runsBefore = await count(sql`select count(*) as n from msp_sop_runs where tenant_id = ${customer.tenantId}`);
    const wfBefore = await count(sql`select count(*) as n from wf_runs where trigger_ref = 'live-verify:4528'`);
    await expect(
      runSopForCustomer({
        mspId: customer.mspId!,
        sopId: "SOP-SEED-IAM-03",
        customerId: customer.id,
        targetEntity: "00000000-0000-0000-0000-000000000000",
        operator: "live-verify #4528",
        triggeredBy: "live-verify:4528",
      }),
    ).rejects.toMatchObject({ code: "ca_enforcement_requires_promotion" });
    expect(await count(sql`select count(*) as n from msp_sop_runs where tenant_id = ${customer.tenantId}`)).toBe(runsBefore);
    expect(await count(sql`select count(*) as n from wf_runs where trigger_ref = 'live-verify:4528'`)).toBe(wfBefore);
  });
});

// ── Git #4545 — the 4 call sites that skipped this evaluation entirely ─────────
const DISABLE_SD_TEMPLATE_ID = "quickstart-v1.disable-security-defaults";

describe("admin-baseline-templates test-run (#4545)", () => {
  const app = express().use(express.json()).use("/api", baselineTemplatesRouter);

  it("a lone Security Defaults disable is refused before any write — no audit row recorded", async () => {
    const before = await auditRowCount(DISABLE_SD_TEMPLATE_ID);
    const res = await request(app)
      .post(`/api/admin/baseline-templates/${DISABLE_SD_TEMPLATE_ID}/test`)
      .send({ customerId: customer.id });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("security_defaults_replacement_not_enforcing");
    expect(await auditRowCount(DISABLE_SD_TEMPLATE_ID)).toBe(before);
  });
});

describe("admin-write-actions simulator execute (#4545)", () => {
  const app = express().use(express.json()).use("/api", writeActionsRouter);

  it("a lone Security Defaults disable is refused before any write — no audit row recorded", async () => {
    const before = await auditRowCount(DISABLE_SD_TEMPLATE_ID);
    const res = await request(app)
      .post(`/api/admin/write-actions/${DISABLE_SD_TEMPLATE_ID}/execute`)
      .send({ customerId: customer.id, confirmed: true });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("security_defaults_replacement_not_enforcing");
    expect(await auditRowCount(DISABLE_SD_TEMPLATE_ID)).toBe(before);
  });
});

describe("execute_baseline_template workflow node (#4545)", () => {
  let definitionId = 0;
  let versionId = 0;
  let runId = 0;

  afterAll(async () => {
    if (runId) {
      await db.delete(wfRunNodeOutputsTable).where(eq(wfRunNodeOutputsTable.runId, runId)).catch(() => {});
      await db.execute(sql`DELETE FROM wf_run_node_logs WHERE run_id = ${runId}`).catch(() => {});
      await db.delete(wfRunsTable).where(eq(wfRunsTable.id, runId)).catch(() => {});
    }
    if (definitionId) {
      await db.delete(wfVersionsTable).where(eq(wfVersionsTable.definitionId, definitionId)).catch(() => {});
      await db.delete(wfDefinitionsTable).where(eq(wfDefinitionsTable.id, definitionId)).catch(() => {});
    }
  });

  it("a lone Security Defaults disable is refused before any write — no audit row recorded", async () => {
    const before = await auditRowCount(DISABLE_SD_TEMPLATE_ID);

    const graph = {
      nodes: [
        { id: "start", type: "start", position: { x: 0, y: 0 }, data: { label: "Start" } },
        {
          id: "ebt",
          type: "execute_baseline_template",
          position: { x: 200, y: 0 },
          data: { label: "Disable Security Defaults", templateId: DISABLE_SD_TEMPLATE_ID, customerId: String(customer.id) },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "ebt" }],
    };

    const [def] = await db.insert(wfDefinitionsTable).values({
      name: "#4545 live verify", description: "temporary — removed by the test",
    }).returning({ id: wfDefinitionsTable.id });
    definitionId = def.id;

    const [ver] = await db.insert(wfVersionsTable).values({
      definitionId, versionNumber: 1, status: "published", graph: graph as never,
    }).returning({ id: wfVersionsTable.id });
    versionId = ver.id;

    const fired = await fireWorkflowForDefinition(definitionId, "manual", "live-verify:4545", { customerId: customer.id }, { versionId });
    expect(fired).not.toBeNull();
    runId = fired!;

    let status = "";
    for (let i = 0; i < 60 && status !== "failed" && status !== "completed"; i += 1) {
      await sleep(250);
      const [row] = await db.select({ status: wfRunsTable.status }).from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
      status = row?.status ?? "";
      if (status === "cancelled") break;
    }
    expect(status).toBe("failed");

    const [nodeOutput] = await db
      .select({ output: wfRunNodeOutputsTable.output })
      .from(wfRunNodeOutputsTable)
      .where(and(eq(wfRunNodeOutputsTable.runId, runId), eq(wfRunNodeOutputsTable.nodeId, "ebt")))
      .limit(1);
    expect((nodeOutput?.output as Record<string, unknown> | undefined)?.errorType).toBe("security_defaults_replacement_not_enforcing");
    expect(await auditRowCount(DISABLE_SD_TEMPLATE_ID)).toBe(before);
  });
});
