import { z } from "zod";
import { apiFetch } from "../api-client.ts";
import type { ToolDef } from "./registry.ts";

/**
 * get_risk_register — the operator's Risk-Based Decisions (the risk register).
 *
 * Wrapping decision: the issue named `portal-risk-register.ts`, but those GET
 * routes are `requireRole("CustomerUser")` scoped by the JWT `customerId` — the
 * operator (PlatformAdmin, no customerId) gets 403 there. The MSP-operator
 * surface `msp-rbd.ts` (GET /msp/rbd, requireRole MSPOperator, scoped by
 * resolveMspIdStrict) reads the SAME msp_risk_decisions table and IS reachable
 * as the operator, answering the cross-customer register question. That is
 * wrapped here. Optionally filter by status and/or a single tenant.
 */

// `expired` was removed on #1507 — an acceptance is a signed fact and does not
// expire; what lapses is the review clock. This mirrors the canonical
// `RISK_ACCEPTANCE_STATUSES` (lib/db/src/schema/msp.ts) — kept as a local copy
// rather than an `@workspace/db` import because mcp-server doesn't otherwise
// depend on that package and this is a read-only filter, not a write path
// (Git #2697). If a future change adds that dependency for another reason,
// switch this to the real import instead.
const RBD_STATUSES = ["active", "pending_signature", "revoked"] as const;

const inputSchema = {
  status: z.enum(RBD_STATUSES).optional().describe("Narrow to a single decision status."),
  tenantId: z.string().optional().describe("Narrow to a single M365 tenant id."),
  limit: z.number().int().positive().max(500).optional().describe("Max decisions to return (default 200)."),
};

interface RiskDecision {
  id: number;
  rbdId?: string;
  tenantId?: string;
  tenantName?: string;
  title?: string;
  controlViolated?: string;
  framework?: string;
  rawRiskLevel?: string;
  residualRiskLevel?: string;
  liabilityValueUsd?: number;
  status?: string;
  checkKey?: string | null;
  expirationDate?: string;
  [k: string]: unknown;
}

export const getRiskRegisterTool: ToolDef = {
  name: "get_risk_register",
  description:
    "The operator's risk register — the Risk-Based Decisions across their customers (GET /msp/rbd): accepted risks, " +
    "their raw/residual risk levels, framework/control, liability value and signature status. Optionally filter by " +
    "status (active, pending_signature, expired, revoked) and/or tenantId.",
  inputSchema,
  handler: async (args) => {
    const status = args.status as string | undefined;
    const tenantId = typeof args.tenantId === "string" ? args.tenantId.trim() : "";
    const limit = typeof args.limit === "number" ? args.limit : 200;

    const rows = await apiFetch<RiskDecision[]>("/msp/rbd");
    const all = Array.isArray(rows) ? rows : [];
    let list = all;
    if (status) list = list.filter((r) => r.status === status);
    if (tenantId) list = list.filter((r) => r.tenantId === tenantId);

    const byStatus: Record<string, number> = {};
    for (const r of all) {
      if (r.status) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    }

    return {
      count: list.length,
      totalDecisions: all.length,
      byStatus,
      filters: { status: status ?? null, tenantId: tenantId || null },
      decisions: list.slice(0, limit).map((r) => ({
        id: r.id,
        rbdId: r.rbdId,
        title: r.title,
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        controlViolated: r.controlViolated,
        framework: r.framework,
        rawRiskLevel: r.rawRiskLevel,
        residualRiskLevel: r.residualRiskLevel,
        liabilityValueUsd: r.liabilityValueUsd,
        status: r.status,
        checkKey: r.checkKey ?? null,
        expirationDate: r.expirationDate,
      })),
    };
  },
};
