/**
 * config-pack-dry-run.ts
 *
 * The REAL dry-run behind the Buy flow's approve stage (Git #1316): for every
 * write a purchased Config Pack will perform, resolve the exact request the
 * engine would send (resolveBaselineTemplateRequest — the SAME single
 * substitution implementation execution uses, so preview and execution can
 * never drift) and read the ACTUAL current tenant state for it via
 * graphFetchForTenant (the read app; write consent is checked by the route,
 * but no dry-run ever needs the write app). Replaces the marketing site's
 * authored before/after fixture (buyCheckout.ts DRY_ACTIONS) with live data.
 *
 * Secrets: the initial payload carries the generated break-glass password (and
 * a pack's variables may carry other credential material). EVERY payload value
 * whose key matches /password|secret/i is replaced with a redaction sentinel
 * BEFORE any interpolation, so no resolved endpoint/body returned by a dry-run
 * can ever contain a real secret. The real password is generated fresh at
 * execution time by runConfigPackForCustomer — the dry-run's copy is never it.
 */

import { db } from "@workspace/db";
import { baselineActionTemplatesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { graphFetchForTenant } from "./graph";
import { resolveBaselineTemplateRequest } from "./workflow-executor";
import { prepareConfigPackRun } from "./config-pack-orchestrator";
import { logger } from "./logger";

const log = logger.child({ channel: "engine.config-pack" });

export const DRY_RUN_REDACTED = "••••••••••••";

const SECRET_KEY_RE = /password|secret/i;

export type DryRunChangeKind = "create" | "update" | "delete" | "check";

export interface ConfigPackDryRunAction {
  templateId: string | null;
  checkKey: string | null;
  label: string;
  description: string | null;
  category: string | null;
  method: string | null;
  /** Endpoint AFTER variable substitution (secrets redacted). Mid-run values
   *  appear as their literal {{placeholder}} — produced during the run. */
  endpoint: string | null;
  /** The exact body the engine will send (secrets redacted). */
  plannedWrite: Record<string, unknown> | null;
  changeKind: DryRunChangeKind;
  /** REAL current tenant state for the fields this write sets (update writes
   *  with a fully-resolved endpoint only — creations have nothing to read). */
  currentState: {
    fetched: boolean;
    /** Current live values of the top-level fields plannedWrite sets. */
    values?: Record<string, unknown>;
    /** HTTP status when the read was attempted and refused. */
    status?: number;
    note?: string;
  };
  /** True when every field the write sets already holds the planned value —
   *  the live analogue of the fixture's mayBeSatisfied. Null when unknowable
   *  (creations, unreadable endpoints). */
  alreadySatisfied: boolean | null;
  reversible: boolean;
  /** The pack's single tenant-admin verification gate pauses the run right
   *  after this step. */
  gatedHere: boolean;
  /** Required variables resolved only mid-run (from earlier step outputs). */
  dependsOnRunOutputs: string[];
  /** Required variables with NO source at all — this step cannot execute
   *  without operator input. */
  missingVariables: string[];
}

export interface ConfigPackDryRun {
  packKey: string;
  label: string;
  gated: boolean;
  /** True when the pack's every required variable has a source (derived,
   *  generated, or produced mid-run) — i.e. execution would not be refused by
   *  the orchestrator's missing-variables guard. */
  executable: boolean;
  missingOperatorVariables: string[];
  actions: ConfigPackDryRunAction[];
  readAt: string;
}

function methodToChangeKind(method: string): DryRunChangeKind {
  if (method === "POST") return "create";
  if (method === "DELETE") return "delete";
  return "update";
}

/** Planned-vs-current comparison: every top-level field the write sets must
 *  already hold the planned value (objects compared as subsets, recursively —
 *  Graph GETs return far more fields than a PATCH sets). */
function plannedSubsetEquals(planned: unknown, current: unknown): boolean {
  if (planned !== null && typeof planned === "object" && !Array.isArray(planned)) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return false;
    return Object.entries(planned as Record<string, unknown>).every(([k, v]) =>
      plannedSubsetEquals(v, (current as Record<string, unknown>)[k]),
    );
  }
  if (Array.isArray(planned)) {
    return JSON.stringify(planned) === JSON.stringify(current);
  }
  return planned === current;
}

/**
 * Build the real dry-run for one pack against one customer's connected tenant.
 * Throws ConfigPackError (pack_not_found / customer_not_connected / …) exactly
 * like prepareConfigPackRun — the route maps those per pack.
 */
export async function buildConfigPackDryRun(
  packKey: string,
  customerId: number,
): Promise<ConfigPackDryRun> {
  const ctx = await prepareConfigPackRun({ packKey, customerId });

  // Redact secrets, then stand in literal placeholders for every mid-run key
  // so a resolved endpoint/body shows "{{breakGlassGroupId}}" (honest: the
  // value is produced during the run) instead of an empty string.
  const dryPayload: Record<string, unknown> = { ...ctx.payload };
  for (const key of Object.keys(dryPayload)) {
    if (SECRET_KEY_RE.test(key)) dryPayload[key] = DRY_RUN_REDACTED;
  }
  for (const key of ctx.midRunProvided) {
    if (dryPayload[key] === undefined || dryPayload[key] === "") {
      dryPayload[key] = `{{${key}}}`;
    }
  }

  const templateIds = ctx.ordered.map((t) => t.templateId).filter((id): id is string => !!id);
  const templateMeta = templateIds.length
    ? await db
        .select({
          templateId: baselineActionTemplatesTable.templateId,
          description: baselineActionTemplatesTable.description,
          reversible: baselineActionTemplatesTable.reversible,
        })
        .from(baselineActionTemplatesTable)
        .where(inArray(baselineActionTemplatesTable.templateId, templateIds))
    : [];
  const metaById = new Map(templateMeta.map((m) => [m.templateId, m]));

  const actions: ConfigPackDryRunAction[] = [];

  for (const t of ctx.ordered) {
    if (!t.templateId) {
      // A checkKey-only step runs a monitor check (a read), not a Graph write.
      actions.push({
        templateId: null,
        checkKey: t.checkKey,
        label: t.label ?? `Monitor check: ${t.checkKey}`,
        description: null,
        category: null,
        method: null,
        endpoint: null,
        plannedWrite: null,
        changeKind: "check",
        currentState: { fetched: false, note: "read-only monitor check — no write to preview" },
        alreadySatisfied: null,
        reversible: true,
        gatedHere: false,
        dependsOnRunOutputs: [],
        missingVariables: [],
      });
      continue;
    }

    const resolved = await resolveBaselineTemplateRequest(t.templateId, dryPayload);
    const meta = metaById.get(t.templateId);
    const changeKind = methodToChangeKind(resolved.method);
    const dependsOnRunOutputs = resolved.requiredVariables.filter((v) => ctx.midRunProvided.has(v));
    const endpointFullyResolved = !resolved.endpoint.includes("{{");

    let currentState: ConfigPackDryRunAction["currentState"];
    let alreadySatisfied: boolean | null = null;

    if (changeKind === "update" && resolved.missingVariables.length === 0 && endpointFullyResolved) {
      try {
        const res = await graphFetchForTenant(ctx.customer.tenantId, resolved.endpoint);
        if (res.ok) {
          const body = (await res.json()) as Record<string, unknown>;
          const values: Record<string, unknown> = {};
          for (const key of Object.keys(resolved.body)) {
            values[key] = body[key] ?? null;
          }
          currentState = { fetched: true, values };
          alreadySatisfied = Object.entries(resolved.body).every(([k, v]) =>
            plannedSubsetEquals(v, body[k]),
          );
        } else {
          currentState = { fetched: false, status: res.status, note: "the tenant refused this read" };
        }
      } catch (err) {
        log.warn({ err, packKey, templateId: t.templateId }, "config-pack-dry-run: current-state read threw");
        currentState = { fetched: false, note: "the current value could not be read" };
      }
    } else if (changeKind === "create") {
      currentState = { fetched: false, note: "creates a new resource — nothing exists to read" };
    } else if (changeKind === "delete") {
      currentState = { fetched: false, note: "removes an existing resource" };
    } else {
      currentState = { fetched: false, note: "the target is only known once earlier steps have run" };
    }

    actions.push({
      templateId: t.templateId,
      checkKey: t.checkKey,
      label: resolved.label,
      description: meta?.description ?? null,
      category: resolved.category,
      method: resolved.method,
      endpoint: resolved.endpoint,
      plannedWrite: resolved.body,
      changeKind,
      currentState,
      alreadySatisfied,
      reversible: meta?.reversible ?? false,
      gatedHere: t.templateId === ctx.gatedTemplateId,
      dependsOnRunOutputs,
      missingVariables: resolved.missingVariables,
    });
  }

  log.info(
    {
      packKey,
      customerId,
      actionCount: actions.length,
      executable: ctx.missingVariables.length === 0,
      missingOperatorVariables: ctx.missingVariables,
    },
    "config-pack-dry-run: built real dry-run from live tenant state",
  );

  return {
    packKey,
    label: ctx.pack.label,
    gated: ctx.gatedTemplateId !== null,
    executable: ctx.missingVariables.length === 0,
    missingOperatorVariables: ctx.missingVariables,
    actions,
    readAt: new Date().toISOString(),
  };
}
