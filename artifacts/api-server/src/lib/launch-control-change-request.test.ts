/**
 * launch-control-change-request.test.ts — Git #3541, against the REAL local
 * database. Every row is created under a unique per-run marker (`VERIFY_TAG`)
 * and deleted in `afterAll`, the same discipline
 * `msp-change-execution-store.test.ts` already follows.
 *
 * Proves the real fix: a Launch Control execute call now raises a real,
 * pre-approved `standard` CR with one real inherited approval, and recording
 * its outcome via `write_action` (not `human_action`) confirms and closes it
 * in the SAME call — no separate attestation step, and the exact
 * `changeRequestId` a `human-action` 404 (#3541's own finding) had nothing to
 * reference.
 */

import { describe, it, expect, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { db, crExecutionsTable, crApprovalsTable, mspChangeRequestsTable } from "@workspace/db";
import {
  raiseChangeRequestForLaunchControlExecution,
  recordLaunchControlExecutionOutcome,
} from "./launch-control-change-request.ts";

const MSP_ID = 1;
const VERIFY_TAG = `verify-3541-${Date.now()}`;
const TENANT_ID = VERIFY_TAG;

const createdCrIds: number[] = [];

afterAll(async () => {
  if (createdCrIds.length > 0) {
    await db.delete(crExecutionsTable).where(inArray(crExecutionsTable.changeRequestId, createdCrIds));
    await db.delete(crApprovalsTable).where(inArray(crApprovalsTable.changeRequestId, createdCrIds));
    await db.delete(mspChangeRequestsTable).where(inArray(mspChangeRequestsTable.id, createdCrIds));
  }
});

describe("launch-control-change-request — raising the CR a Launch Control execute stands behind", () => {
  it("raises a pre-approved standard CR with one real inherited approval row, category mapped from domain", async () => {
    const cr = await raiseChangeRequestForLaunchControlExecution({
      mspId: MSP_ID,
      tenantId: TENANT_ID,
      tenantName: "VERIFY Tenant (#3541)",
      primaryDomain: "verify-3541.example.test",
      catalogRow: { domain: "Conditional Access", actionName: "Create CA policy", surface: "Entra ID", safeOrGated: "gated" },
      templateId: "quickstart-v1.create-ca-baseline-policy",
      proposedPayload: { customerId: 999, policyName: "Block legacy auth" },
      requestedBy: "operator@example.test",
      reverseTemplateId: null,
    });
    createdCrIds.push(cr.id);

    expect(cr.id).toBeGreaterThan(0);
    expect(cr.code).toMatch(/^CR-\d{4}-\d+$/);

    const [row] = await db.select().from(mspChangeRequestsTable).where(eq(mspChangeRequestsTable.id, cr.id)).limit(1);
    expect(row).toBeTruthy();
    expect(row!.changeClass).toBe("standard");
    expect(row!.riskLevel).toBe("high"); // "gated" -> high
    expect(row!.category).toBe("ConditionalAccess"); // domain mapping
    expect(row!.implementer).toBe("msp");
    expect(row!.status).toBe("pending_approval");
    expect(row!.proposedPayload).toEqual({ customerId: 999, policyName: "Block legacy auth" });

    // Standard change class => 0 required approval stages => one real,
    // already-`approved` inherited row, per materializeApprovalsForChange.
    const approvals = await db.select().from(crApprovalsTable).where(eq(crApprovalsTable.changeRequestId, cr.id));
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.decision).toBe("approved");
    expect(approvals[0]!.approverRole).toBe("catalog_inherited");
  });

  it("maps a 'safe' action to low risk and an unmapped domain to the Identity fallback category", async () => {
    const cr = await raiseChangeRequestForLaunchControlExecution({
      mspId: MSP_ID,
      tenantId: TENANT_ID,
      tenantName: "VERIFY Tenant (#3541)",
      primaryDomain: "verify-3541.example.test",
      catalogRow: { domain: "Auth/MFA", actionName: "Revoke all sign-in sessions", surface: "Entra ID", safeOrGated: "safe" },
      templateId: "microrem.revoke-sign-in-sessions",
      proposedPayload: { customerId: 999, userId: "u-1" },
      requestedBy: "operator@example.test",
      reverseTemplateId: "microrem.revoke-sign-in-sessions",
    });
    createdCrIds.push(cr.id);

    const [row] = await db.select().from(mspChangeRequestsTable).where(eq(mspChangeRequestsTable.id, cr.id)).limit(1);
    expect(row!.riskLevel).toBe("low");
    expect(row!.category).toBe("Identity"); // "Auth/MFA" has no direct mapping -> fallback
    expect(row!.rollbackScriptSnippet).toContain("microrem.revoke-sign-in-sessions");
  });

  it("records a successful execution as a code-confirmed write_action and closes the CR to completed", async () => {
    const cr = await raiseChangeRequestForLaunchControlExecution({
      mspId: MSP_ID,
      tenantId: TENANT_ID,
      tenantName: "VERIFY Tenant (#3541)",
      primaryDomain: "verify-3541.example.test",
      catalogRow: { domain: "Groups", actionName: "Add/remove member", surface: "Entra ID", safeOrGated: "safe" },
      templateId: "action.add-group-member",
      proposedPayload: { customerId: 999, groupId: "g-1", memberId: "m-1" },
      requestedBy: "operator@example.test",
      reverseTemplateId: null,
    });
    createdCrIds.push(cr.id);

    await recordLaunchControlExecutionOutcome({ changeRequestId: cr.id, mspId: MSP_ID, tenantId: TENANT_ID, success: true });

    const [exec] = await db.select().from(crExecutionsTable).where(eq(crExecutionsTable.changeRequestId, cr.id)).limit(1);
    expect(exec).toBeTruthy();
    expect(exec!.executorKind).toBe("write_action");
    expect(exec!.outcome).toBe("succeeded");
    expect(exec!.crRef).toBe(cr.code);
    expect(exec!.writtenBackAt).not.toBeNull();
    expect(exec!.attestedAt).toBeNull(); // never a human_action — no attestation involved

    const [row] = await db.select().from(mspChangeRequestsTable).where(eq(mspChangeRequestsTable.id, cr.id)).limit(1);
    expect(row!.status).toBe("completed");
    expect(row!.executedAt).not.toBeNull();
  });

  it("leaves the CR pending_approval (not completed) when the write fails, and records no crRef", async () => {
    const cr = await raiseChangeRequestForLaunchControlExecution({
      mspId: MSP_ID,
      tenantId: TENANT_ID,
      tenantName: "VERIFY Tenant (#3541)",
      primaryDomain: "verify-3541.example.test",
      catalogRow: { domain: "Licensing", actionName: "Direct assign license", surface: "Entra ID", safeOrGated: "safe" },
      templateId: "action.assign-single-license",
      proposedPayload: { customerId: 999, skuId: "sku-1" },
      requestedBy: "operator@example.test",
      reverseTemplateId: null,
    });
    createdCrIds.push(cr.id);

    await recordLaunchControlExecutionOutcome({ changeRequestId: cr.id, mspId: MSP_ID, tenantId: TENANT_ID, success: false });

    const [exec] = await db.select().from(crExecutionsTable).where(eq(crExecutionsTable.changeRequestId, cr.id)).limit(1);
    expect(exec!.outcome).toBe("failed");
    expect(exec!.crRef).toBeNull();

    const [row] = await db.select().from(mspChangeRequestsTable).where(eq(mspChangeRequestsTable.id, cr.id)).limit(1);
    expect(row!.status).toBe("pending_approval");
    expect(row!.executedAt).toBeNull();
  });
});
