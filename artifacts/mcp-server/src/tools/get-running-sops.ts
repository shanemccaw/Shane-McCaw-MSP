import { z } from "zod";
import { apiFetch } from "../api-client.ts";
import type { ToolDef } from "./registry.ts";

/**
 * get_running_sops — the operator's SOP library and its live execution record.
 *
 * Wrapping decision: the issue named `portal-sops.ts`, but every route there is
 * `requireRole("CustomerUser")` and reads the tenant off the JWT's `customerId`
 * claim — which the operator (PlatformAdmin, no customerId) does not carry, so
 * those routes answer 403 for this server. The MSP-operator siblings
 * (`msp-sops.ts`: GET /msp/sops + GET /msp/sop-runs, scoped by resolveMspIdStrict)
 * read the SAME msp_sops / msp_sop_runs tables and ARE reachable as the operator,
 * answering the cross-customer "what SOPs exist and what is running" question this
 * tool is for. That is what is wrapped here.
 *
 * "Running" = a run in the "In Progress" state (msp_sop_runs.status). status="all"
 * returns every run; status="running" (default) narrows to in-progress ones.
 */

const inputSchema = {
  status: z
    .enum(["running", "all"])
    .optional()
    .describe('"running" (default) returns only in-progress runs; "all" returns every recorded run.'),
  limit: z.number().int().positive().max(500).optional().describe("Max SOP templates and runs to return (default 100)."),
};

interface SopRow { id: number; sopId?: string; code?: string; title?: string; category?: string; automationType?: string; versionStatus?: string; lastUpdatedBy?: string; lastUpdatedAt?: string; [k: string]: unknown }
interface SopRunRow { id: number; sopId?: string; sopTitle?: string; status?: string; operator?: string; targetEntity?: string; startedAt?: string; completedAt?: string | null; totalSteps?: number; passedStepsCount?: number; currentStepIndex?: number; [k: string]: unknown }

export const getRunningSopsTool: ToolDef = {
  name: "get_running_sops",
  description:
    "The operator's SOP/runbook library (GET /msp/sops) and its execution record (GET /msp/sop-runs) across all the " +
    "operator's customers. Defaults to surfacing runs currently In Progress (status=running); pass status=all for the " +
    "full run history. Returns the SOP templates, the runs, and a summary (total SOPs, total runs, runs in progress).",
  inputSchema,
  handler: async (args) => {
    const status = (args.status as string) === "all" ? "all" : "running";
    const limit = typeof args.limit === "number" ? args.limit : 100;

    const [sops, runs] = await Promise.all([
      apiFetch<SopRow[]>("/msp/sops"),
      apiFetch<SopRunRow[]>("/msp/sop-runs"),
    ]);

    const allSops = Array.isArray(sops) ? sops : [];
    const allRuns = Array.isArray(runs) ? runs : [];
    const inProgress = allRuns.filter((r) => r.status === "In Progress");
    const shownRuns = status === "running" ? inProgress : allRuns;

    return {
      status,
      summary: {
        totalSops: allSops.length,
        totalRuns: allRuns.length,
        runsInProgress: inProgress.length,
      },
      sops: allSops.slice(0, limit).map((s) => ({
        id: s.id,
        sopId: s.sopId,
        code: s.code,
        title: s.title,
        category: s.category,
        automationType: s.automationType,
        versionStatus: s.versionStatus,
        lastUpdatedBy: s.lastUpdatedBy,
        lastUpdatedAt: s.lastUpdatedAt,
      })),
      runs: shownRuns.slice(0, limit).map((r) => ({
        id: r.id,
        sopId: r.sopId,
        sopTitle: r.sopTitle,
        status: r.status,
        operator: r.operator,
        targetEntity: r.targetEntity,
        startedAt: r.startedAt,
        completedAt: r.completedAt ?? null,
        progress: r.totalSteps ? `${r.passedStepsCount ?? 0}/${r.totalSteps}` : null,
      })),
    };
  },
};
