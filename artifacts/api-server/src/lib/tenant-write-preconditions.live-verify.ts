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
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";

vi.mock("../middlewares/requireAuth.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { db, baselineActionTemplatesTable, tenantsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import executeActionRouter from "../routes/admin-execute-action.ts";
import { getSubscribedSkuPartNumbersForTenant } from "./license-gate.ts";
import { runSopForCustomer } from "./sop-execution.ts";
import {
  loadRequiredLicenseSkuListsByTemplate,
  resolveTenantWritePreconditionRefusal,
} from "./tenant-write-preconditions.ts";

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
  const skus = await getSubscribedSkuPartNumbersForTenant(customer.tenantId);
  expect(skus.error).toBeNull();
  lacksP1 = !P1.some((s) => skus.skuPartNumbers.has(s));
});

describe("execute_action (#4528)", () => {
  const app = express().use(express.json()).use("/api", executeActionRouter);
  const body = () => ({
    serviceSlug: "remediate-enable-ca-policy",
    customerId: customer.id,
    variables: { policyId: "00000000-0000-0000-0000-000000000000" },
  });

  it("preview reports license_required and not ready on the unlicensed testbed tenant", async () => {
    if (!lacksP1) return void console.warn("tenant holds Entra ID P1 — license case not applicable");
    const res = await request(app).post("/api/admin/remediation/execute-action").send(body());
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("preview");
    expect(res.body.ready).toBe(false);
    expect(res.body.precondition?.code).toBe("license_required");
  });

  it("confirmed:true is refused 409 before any write — no audit row is recorded", async () => {
    if (!lacksP1) return void console.warn("tenant holds Entra ID P1 — skipped so nothing writes");
    const before = await count(
      sql`select count(*) as n from baseline_action_template_audit_log where template_id = 'microrem.enforce-ca-policy'`,
    );
    const res = await request(app)
      .post("/api/admin/remediation/execute-action")
      .send({ ...body(), confirmed: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("license_required");
    expect(res.body.requiredLicenseSkus).toEqual(expect.arrayContaining(["AAD_PREMIUM"]));
    const after = await count(
      sql`select count(*) as n from baseline_action_template_audit_log where template_id = 'microrem.enforce-ca-policy'`,
    );
    expect(after).toBe(before);
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
  it("SOP-SEED-IAM-03 (creates a CA policy) is refused license_required before any claim, persist or fire", async () => {
    if (!lacksP1) return void console.warn("tenant holds Entra ID P1 — skipped so nothing writes");
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
    ).rejects.toMatchObject({ code: "license_required" });
    expect(await count(sql`select count(*) as n from msp_sop_runs where tenant_id = ${customer.tenantId}`)).toBe(runsBefore);
    expect(await count(sql`select count(*) as n from wf_runs where trigger_ref = 'live-verify:4528'`)).toBe(wfBefore);
  });
});
