/**
 * portal-sops.ts — the SOPs & Runbooks library and its execution record,
 * customer-scoped.
 *
 *   GET /api/portal/sops       — the procedure library, its filter vocabulary
 *                                and the hub's four stat cards
 *   GET /api/portal/sop-runs   — the live execution queue and the audit history
 *
 * ── Why this file exists at all ────────────────────────────────────────────
 * `routes/msp-sops.ts` already reads these two tables, but every route in it is
 * `requireRole("MSPOperator")` and scoped by `resolveMspIdStrict` — it answers
 * "what does this MSP operator maintain, across all their customers". The
 * customer portal asks a different question with a different blast radius:
 * "what applies to MY tenant, and what has been run against MY tenant". Widening
 * the MSP routes to answer both would have meant a role floor low enough for a
 * customer on routes that also expose POST/PATCH, so this is a separate file
 * with separate predicates and no writes.
 *
 * ── Scoping, and why it needs BOTH shapes ──────────────────────────────────
 * These are MSP-era tables (see `lib/portal-customer-scope.ts`), so the JWT's
 * `customerId` is not directly a key on either of them:
 *
 *  • The LIBRARY is `msp_sops`, keyed on `msp_id` only. A customer sees the
 *    procedure library their own MSP maintains — that is what the design's
 *    "Shane McCaw baseline" source chip means. Scoped by the `mspId` resolved
 *    from the caller's own tenant row, never from the JWT's `mspId` claim
 *    directly and never from anything in the request.
 *
 *  • The RUNS are `msp_sop_runs`, keyed on `(msp_id, tenant_id)` where
 *    `tenant_id` is the free-text M365 tenant identifier. BOTH predicates are
 *    applied — `resolveTenantScope` fails closed rather than returning a partial
 *    scope, because `eq(tenantId, '')` would match every other row with a blank
 *    identifier, which is a cross-tenant read created by an empty string.
 *
 * There is no route in this file that reads an id out of a query param, a body
 * or a path segment. The caller's identity is the only thing that selects rows.
 *
 * ── Role floor ─────────────────────────────────────────────────────────────
 * `requireRole("CustomerUser")`. Note this is a HIGHER floor than the sibling
 * portal-v2 pages (`portal-runbooks.ts`, `portal-change-control.ts` and
 * `portal-remediation-tracker.ts` all sit at `requireRole("Assessment")`), so an
 * Assessment-tier account that can see Active Runbooks will get a 403 here. That
 * is deliberate: the SOP library is the MSP's own procedure documentation plus
 * whatever the customer's team has written, which is not prospect-tier content.
 *
 * ── No EXECUTION write, on purpose — but authoring IS allowed ───────────────
 * The design's "Execute this SOP" drawer is a rehearsal — Part 6 built it as a
 * client-side timer and nothing in the portal writes an `msp_sop_runs` row.
 * Starting a real procedure against the tenant without passing the change-control
 * gate is the one thing that gate exists to prevent, so there is deliberately NO
 * customer-facing route here that writes `msp_sop_runs`.
 *
 * `POST /portal/sops` (below) is a different act and is safe: it authors a new
 * procedure DEFINITION — the New menu's "Procedure · Write an SOP or runbook for
 * your team" — not an execution. It is forced `automationType: "manual"` with no
 * step carrying a `graphEndpoint`, so the SOP it writes is non-runnable by
 * construction (`sopRunnable()` stays false and the Execute path the gate guards
 * is never offered on it). It can only add a manual reference the customer's own
 * team wrote; it can never start anything.
 *
 * `POST /portal/sops/:sopId/custom-steps` (below) is a third act, narrower than
 * either: a per-tenant OVERLAY on an EXISTING MSP-authored SOP (#1558), landing
 * in `portal_sop_custom_steps` — never `msp_sops.steps` — so it can never edit
 * the base definition, bump its version, or make it runnable. Same non-execution
 * guarantee as above: an overlay step never carries a `graphEndpoint`.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  db,
  mspSopRunsTable,
  mspSopsTable,
  portalSopCustomStepsTable,
  usersTable,
  type MspSopRunOrigin,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { requireTierFeature, PORTAL_TIER_MODULE_KEYS } from "../lib/portal-tier-features";
import {
  auditResult,
  automatedStepCount,
  durationSeconds,
  evidenceHash,
  formatAuditTimestamp,
  formatDurationSeconds,
  formatLongDate,
  formatUpdated,
  isSameUtcMonth,
  ownerTone,
  personLabel,
  progressPct,
  queueStateFor,
  readSteps,
  relativeSince,
  runModeLabel,
  runStateLabel,
  sopLevel,
  sopRunnable,
  stepEndpoint,
  stepStates,
  stepText,
  whoRunsIt,
  type WireSopSource,
} from "../lib/portal-sops";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

// ── Wire shapes ───────────────────────────────────────────────────────────────
// Deliberately the exact field names the portal's own `SopLibraryItem` /
// `SopMeta` / `SopQueueItem` / `SopAuditItem` interfaces already use, so the
// page's tested derivations keep working against real rows without a translation
// layer in the middle that could quietly disagree with either side.

interface WireOwner {
  readonly init: string;
  readonly name: string;
  readonly tone: string;
  readonly unassigned: boolean;
}

interface WireSopRunSummary {
  readonly when: string;
  readonly who: string;
  readonly outcome: string;
  readonly state: string;
  /** What invoked this run (#1556). The raw enum value — the page owns any label. */
  readonly origin: MspSopRunOrigin;
  /**
   * `msp_sops.version` this run actually followed (#1558), captured at the
   * moment it started. "" for a historical run or one an older writer created
   * before this was tracked — reads as not recorded, never a guess.
   */
  readonly sopVersion: string;
}

/**
 * One step in the procedure as the customer reads it — base (MSP-authored) or
 * their own overlay, in one ordered list. `isCustom` is what lets the page
 * draw the two differently, the same distinction `portal_runbook_steps`
 * already makes for a runbook's own checklist.
 */
interface WireSopStep {
  readonly text: string;
  readonly isCustom: boolean;
}

interface WireSopLibraryItem {
  readonly id: string;
  readonly title: string;
  readonly source: WireSopSource;
  readonly category: string;
  readonly purpose: string;
  readonly forWho: string;
  readonly updated: string;
  readonly author: string;
  readonly reviewCadence: string;
  readonly runnable: boolean;
  readonly finding: string | null;
  readonly steps: readonly WireSopStep[];
  readonly runs: readonly WireSopRunSummary[];
  readonly owner: WireOwner;
}

interface WireSopMeta {
  readonly code: string;
  readonly level: string;
  readonly tags: readonly string[];
  readonly avg: string;
  readonly execs: number;
  readonly auto: Readonly<Record<number, string>>;
}

interface WireSopStats {
  readonly totalCount: number;
  readonly baselineCount: number;
  readonly oursCount: number;
  readonly automatedCount: number;
  readonly totalExecs: number;
  readonly avgExecTime: string;
  readonly execsThisMonth: string;
}

interface WireSopsPayload {
  readonly library: readonly WireSopLibraryItem[];
  readonly meta: Readonly<Record<string, WireSopMeta>>;
  readonly catOptions: readonly string[];
  readonly tagOptions: readonly string[];
  readonly stats: WireSopStats;
}

interface WireQueueStep {
  readonly t: string;
  readonly s: "done" | "now" | "todo";
  readonly by: string;
}

interface WireSopQueueItem {
  readonly code: string;
  readonly title: string;
  readonly mode: string;
  readonly step: string;
  readonly pct: number;
  readonly started: string;
  readonly who: string;
  readonly state: "Running" | "Queued";
  readonly owner: WireOwner;
  readonly cr: string;
  readonly svc: string;
  /** What invoked this run (#1556). The raw enum value — the page owns any label. */
  readonly origin: MspSopRunOrigin;
  /** `msp_sops.version` this run actually followed (#1558). See WireSopRunSummary. */
  readonly sopVersion: string;
  readonly steps: readonly WireQueueStep[];
}

interface WireSopAuditItem {
  readonly when: string;
  readonly code: string;
  readonly action: string;
  readonly actor: string;
  readonly detail: string;
  readonly result: "Success" | "Partial" | "Failure";
  readonly hash: string;
}

interface WireSopRunsPayload {
  readonly queue: readonly WireSopQueueItem[];
  readonly audit: readonly WireSopAuditItem[];
}

// ── Shared loading ────────────────────────────────────────────────────────────

/** An owner the page can draw, built from a real person rather than a fixture. */
function toOwner(raw: string, resolvedName: string | undefined): WireOwner {
  const name = personLabel(raw, resolvedName);
  const unassigned = name === "Unassigned";
  const init = unassigned
    ? "—"
    : name
        .split(" ")
        .filter(Boolean)
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
  return {
    init,
    name,
    tone: unassigned ? "rgba(248,113,113,.14)" : ownerTone(name),
    unassigned,
  };
}

/** `jsonb` arrives as unknown; anything that is not a string array reads empty. */
function readStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

/**
 * The caller's own colleagues, by email. This is what separates the design's two
 * source buckets: a procedure last touched by somebody inside the customer's own
 * tenant is theirs ("Written by your team"), and everything else is the MSP's
 * baseline. Derived from a real relationship rather than a flag nobody sets.
 */
async function tenantAuthorEmails(customerId: number): Promise<Set<string>> {
  const rows = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.tenantId, customerId));
  return new Set(rows.map((r) => r.email.trim().toLowerCase()));
}

/** Every user this MSP knows about, so an operator's email can become a name. */
async function displayNamesByEmail(mspId: number): Promise<Map<string, string>> {
  const rows = await db
    .select({ email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.mspId, mspId));
  const out = new Map<string, string>();
  for (const r of rows) {
    const name = (r.name ?? "").trim();
    if (name) out.set(r.email.trim().toLowerCase(), name);
  }
  return out;
}

type SopRow = typeof mspSopsTable.$inferSelect;
type RunRow = typeof mspSopRunsTable.$inferSelect;

/** The library for an MSP, oldest first so the index order is stable. */
function loadSops(mspId: number): Promise<SopRow[]> {
  return db
    .select()
    .from(mspSopsTable)
    .where(eq(mspSopsTable.mspId, mspId))
    .orderBy(asc(mspSopsTable.id));
}

/** This tenant's runs — and ONLY this tenant's. See the header on scoping. */
function loadRuns(mspId: number, tenantId: string): Promise<RunRow[]> {
  return db
    .select()
    .from(mspSopRunsTable)
    .where(and(eq(mspSopRunsTable.mspId, mspId), eq(mspSopRunsTable.tenantId, tenantId)))
    .orderBy(asc(mspSopRunsTable.id));
}

type CustomStepRow = typeof portalSopCustomStepsTable.$inferSelect;

/**
 * This tenant's own custom-step overlay (#1558), grouped by the base SOP it
 * overlays. `customer_id` is a direct predicate (this table was built for the
 * portal, not adapted from the MSP console), unlike `loadSops`/`loadRuns`
 * above which go through `mspId`/`tenantId` — see the file header on why the
 * SOP tables need both shapes.
 */
async function loadCustomStepsBySop(customerId: number): Promise<Map<string, CustomStepRow[]>> {
  const rows = await db
    .select()
    .from(portalSopCustomStepsTable)
    .where(eq(portalSopCustomStepsTable.customerId, customerId))
    .orderBy(asc(portalSopCustomStepsTable.position));
  const out = new Map<string, CustomStepRow[]>();
  for (const r of rows) {
    const list = out.get(r.sopId) ?? [];
    list.push(r);
    out.set(r.sopId, list);
  }
  return out;
}

// ── GET /api/portal/sops ──────────────────────────────────────────────────────

router.get(
  "/portal/sops",
  requireRole("CustomerUser"),
  // #1168: authoring (POST below) stays unconditional; only this READ checks
  // the tier bundles SOPs & Runbooks.
  requireTierFeature(PORTAL_TIER_MODULE_KEYS.sopsRunbooks),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const scope = await resolveTenantScope(customerId);
      if (scope === null) {
        res.status(403).json({ error: "No tenant scope for this account" });
        return;
      }

      const now = new Date();
      const [sopRows, runRows, ourEmails, names, customStepsBySop] = await Promise.all([
        loadSops(scope.mspId),
        loadRuns(scope.mspId, scope.tenantId),
        tenantAuthorEmails(customerId),
        displayNamesByEmail(scope.mspId),
        loadCustomStepsBySop(customerId),
      ]);

      // Runs grouped by the SOP they ran, so the per-procedure history and the
      // execution count are one pass rather than one query per row.
      const runsBySop = new Map<string, RunRow[]>();
      for (const r of runRows) {
        const list = runsBySop.get(r.sopId) ?? [];
        list.push(r);
        runsBySop.set(r.sopId, list);
      }

      const library: WireSopLibraryItem[] = [];
      const meta: Record<string, WireSopMeta> = {};

      for (const row of sopRows) {
        const steps = readSteps(row.steps);
        const stepCount = steps.length;
        const author = row.lastUpdatedBy.trim();
        const source: WireSopSource = ourEmails.has(author.toLowerCase()) ? "ours" : "baseline";
        const sopRuns = runsBySop.get(row.sopId) ?? [];

        // Newest run first — the design's detail panel reads top-down as a
        // history, and the rows come back in insertion order.
        const runsNewestFirst = [...sopRuns].reverse();

        library.push({
          id: row.sopId,
          title: row.title,
          source,
          category: row.category,
          purpose: row.description,
          forWho: whoRunsIt(row.automationType, stepCount),
          updated: formatUpdated(row.lastUpdatedAt, row.version),
          author: personLabel(author, names.get(author.toLowerCase())),
          // Not stored on `msp_sops`, and not guessable from `version_status`.
          // See the honest-mapping rule in lib/portal-sops.ts.
          reviewCadence: "Not recorded",
          runnable: sopRunnable(steps),
          finding: null,
          // The base definition's own steps, followed by this tenant's overlay
          // (#1558) — one ordered list, `isCustom` marking which is which.
          // `runnable`/`meta[id].auto` above are deliberately computed from the
          // BASE `steps` only: a customer's own note can never make a procedure
          // executable, matching how POST /portal/sops forces a customer-authored
          // SOP non-runnable by construction (see the file header).
          steps: [
            ...steps.map((s) => ({ text: stepText(s), isCustom: false })),
            ...(customStepsBySop.get(row.sopId) ?? []).map((c) => ({
              text: c.description.trim() ? `${c.title} — ${c.description}` : c.title,
              isCustom: true,
            })),
          ],
          runs: runsNewestFirst.map((r) => ({
            when: formatLongDate(r.startedAt),
            who: personLabel(r.operator, names.get(r.operator.trim().toLowerCase())),
            outcome:
              r.targetEntity.trim() !== ""
                ? `${r.passedStepsCount} of ${r.totalSteps} steps against ${r.targetEntity}.`
                : `${r.passedStepsCount} of ${r.totalSteps} steps completed.`,
            state: runStateLabel(r.status, r.passedStepsCount, r.totalSteps),
            origin: r.origin,
            sopVersion: r.sopVersion,
          })),
          owner: toOwner(author, names.get(author.toLowerCase())),
        });

        // Real durations where the tenant has completed runs; the stored
        // estimate, labelled as an estimate, where it does not.
        const durations = sopRuns
          .map((r) => durationSeconds(r.startedAt, r.completedAt))
          .filter((d): d is number => d !== null);
        const avg =
          durations.length > 0
            ? formatDurationSeconds(durations.reduce((a, b) => a + b, 0) / durations.length)
            : `${row.estimatedMinutes}m estimated`;

        const auto: Record<number, string> = {};
        steps.forEach((s, i) => {
          const endpoint = stepEndpoint(s);
          if (endpoint) auto[i] = endpoint;
        });

        meta[row.sopId] = {
          code: row.code,
          level: sopLevel(row.automationType, stepCount),
          // Compliance tags are what the design's "Compliance tag" filter means;
          // workload tags are a different axis and are not merged into it.
          tags: readStringArray(row.complianceTags),
          avg,
          execs: sopRuns.length,
          auto,
        };
      }

      // The filter vocabularies come from what the tenant actually has. The
      // design's fixed lists were the prototype's own sample values and would
      // offer categories and tags that match nothing here.
      const catOptions = ["All", ...dedupeInOrder(sopRows.map((r) => r.category))];
      const tagOptions = [
        "All tags",
        ...dedupeInOrder(sopRows.flatMap((r) => readStringArray(r.complianceTags))),
      ];

      const automatedCount = sopRows.filter(
        (r) => automatedStepCount(readSteps(r.steps)) > 0,
      ).length;
      const allDurations = runRows
        .map((r) => durationSeconds(r.startedAt, r.completedAt))
        .filter((d): d is number => d !== null);

      const stats: WireSopStats = {
        totalCount: sopRows.length,
        baselineCount: library.filter((s) => s.source === "baseline").length,
        oursCount: library.filter((s) => s.source === "ours").length,
        automatedCount,
        totalExecs: runRows.length,
        avgExecTime:
          allDurations.length > 0
            ? formatDurationSeconds(allDurations.reduce((a, b) => a + b, 0) / allDurations.length)
            : "—",
        execsThisMonth: String(runRows.filter((r) => isSameUtcMonth(r.startedAt, now)).length),
      };

      const payload: WireSopsPayload = { library, meta, catOptions, tagOptions, stats };
      res.json(payload);
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/sops failed");
      res.status(500).json({ error: "Failed to load SOPs" });
    }
  },
);

/** First-seen order, deduped — the same ordering rule the page's `catList` uses. */
function dedupeInOrder(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const trimmed = v.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

// ── GET /api/portal/sop-runs ──────────────────────────────────────────────────

router.get(
  "/portal/sop-runs",
  requireRole("CustomerUser"),
  requireTierFeature(PORTAL_TIER_MODULE_KEYS.sopsRunbooks),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const scope = await resolveTenantScope(customerId);
      if (scope === null) {
        res.status(403).json({ error: "No tenant scope for this account" });
        return;
      }

      const now = new Date();
      const [sopRows, runRows, names] = await Promise.all([
        loadSops(scope.mspId),
        loadRuns(scope.mspId, scope.tenantId),
        displayNamesByEmail(scope.mspId),
      ]);

      const sopById = new Map(sopRows.map((s) => [s.sopId, s]));

      // ── The live queue ────────────────────────────────────────────────────
      const queue: WireSopQueueItem[] = [];
      for (const r of runRows) {
        const state = queueStateFor(r.status);
        if (state === null) continue;

        const sop = sopById.get(r.sopId);
        const steps = readSteps(sop?.steps);
        const workloads = readStringArray(sop?.workloadTags);
        const operatorName = personLabel(r.operator, names.get(r.operator.trim().toLowerCase()));
        const states = stepStates(steps.length, r.currentStepIndex, r.passedStepsCount);
        const currentTitle = (steps[r.currentStepIndex]?.title ?? "").trim();

        queue.push({
          code: sop?.code ?? r.sopId,
          title: r.sopTitle,
          mode: runModeLabel(r.totalSteps, steps.length),
          step:
            state === "Queued"
              ? `Queued · ${r.totalSteps} step${r.totalSteps === 1 ? "" : "s"} in scope`
              : `Step ${r.currentStepIndex + 1} of ${r.totalSteps}` +
                (currentTitle ? ` · ${currentTitle}` : ""),
          pct: progressPct(r.passedStepsCount, r.totalSteps),
          started: relativeSince(r.startedAt, now, state === "Queued" ? "Queued" : "Started"),
          who: operatorName,
          state,
          owner: toOwner(r.operator, names.get(r.operator.trim().toLowerCase())),
          // The design labels this column CR. `psa_ticket_id` is the reference
          // the run actually carries, so it is shown as-is rather than being
          // re-badged as a change request it may not be — the row's own
          // `/^CR-/` test then decides whether it renders as a CR link.
          cr: r.psaTicketId.trim() || "Not recorded",
          svc: workloads[0] ?? "—",
          origin: r.origin,
          sopVersion: r.sopVersion,
          steps: steps.map((s, i) => ({
            t: (s.title ?? "").trim() || stepText(s),
            s: states[i] ?? "todo",
            by:
              states[i] === "done"
                ? stepEndpoint(s)
                  ? "Automated"
                  : operatorName
                : states[i] === "now"
                  ? `${r.passedStepsCount} of ${r.totalSteps} steps passed`
                  : "",
          })),
        });
      }

      // ── The audit history ─────────────────────────────────────────────────
      // Two real event sources, merged newest-first: what has been RUN against
      // this tenant, and what the MSP has PUBLISHED into its library. The second
      // is why this view has content for a tenant that has never run anything —
      // a published procedure is a real, dated, attributable event.
      // Each entry carries the instant it happened alongside the formatted
      // string the page shows, so the newest-first sort keys off the real
      // timestamp rather than trying to parse "19 Aug 2026 · 09:14:22" back.
      const audit: (WireSopAuditItem & { readonly at: number })[] = [];
      const instantOf = (iso: string): number => {
        const t = new Date(iso).getTime();
        return Number.isNaN(t) ? 0 : t;
      };

      for (const r of runRows) {
        const sop = sopById.get(r.sopId);
        const code = sop?.code ?? r.sopId;
        const actor = personLabel(r.operator, names.get(r.operator.trim().toLowerCase()));

        audit.push({
          at: instantOf(r.startedAt),
          when: formatAuditTimestamp(r.startedAt),
          code,
          action: "Execution started",
          actor,
          detail:
            `${runModeLabel(r.totalSteps, readSteps(sop?.steps).length)} · ` +
            `${r.totalSteps} step${r.totalSteps === 1 ? "" : "s"} in scope` +
            (r.targetEntity.trim() ? ` against ${r.targetEntity.trim()}` : ""),
          result: "Success",
          hash: evidenceHash(r.runId, r.sopId, r.startedAt, "started"),
        });

        if (r.completedAt) {
          audit.push({
            at: instantOf(r.completedAt),
            when: formatAuditTimestamp(r.completedAt),
            code,
            action: r.status.trim().toLowerCase() === "failed" ? "Execution failed" : "Execution completed",
            actor,
            detail:
              `${r.passedStepsCount} of ${r.totalSteps} steps passed` +
              (r.psaTicketId.trim() ? ` · recorded against ${r.psaTicketId.trim()}` : ""),
            result: auditResult(r.status, r.passedStepsCount, r.totalSteps),
            hash: evidenceHash(r.runId, r.sopId, r.completedAt, r.status),
          });
        }
      }

      for (const s of sopRows) {
        const author = s.lastUpdatedBy.trim();
        audit.push({
          at: instantOf(`${s.lastUpdatedAt}T00:00:00Z`),
          when: formatAuditTimestamp(`${s.lastUpdatedAt}T00:00:00Z`),
          code: s.code,
          action: "Version published",
          actor: personLabel(author, names.get(author.toLowerCase())),
          detail: `${s.version} · ${s.versionStatus} · ${readSteps(s.steps).length} steps`,
          result: "Success",
          hash: evidenceHash(s.sopId, s.version, s.lastUpdatedAt, s.versionStatus),
        });
      }

      audit.sort((a, b) => b.at - a.at);

      const payload: WireSopRunsPayload = {
        queue,
        // `at` is the sort key, not something the page draws — dropped here so
        // the wire shape stays exactly the portal's own `SopAuditItem`.
        audit: audit.map(({ at: _at, ...entry }) => entry),
      };
      res.json(payload);
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/sop-runs failed");
      res.status(500).json({ error: "Failed to load SOP runs" });
    }
  },
);

// ── POST /api/portal/sops ───────────────────────────────────────────────────
//
// Author a new procedure into the library — the New menu's "Procedure". This is
// deliberately narrow (see the header): a manual, non-runnable DEFINITION,
// never an execution. Every authority-bearing value is server-assigned; the
// body carries only what a customer legitimately wrote. (The other write in
// this file, POST /portal/sops/:sopId/custom-steps below, is narrower still —
// it can only graft a step onto an EXISTING MSP-authored SOP, never touch the
// base definition itself.)
const authorStepSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
});

const authorSopSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2_000),
  category: z.string().trim().min(1).max(120),
  estimatedMinutes: z.number().int().min(0).max(100_000).optional(),
  steps: z.array(authorStepSchema).min(1).max(60),
});

router.post(
  "/portal/sops",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const parsed = authorSopSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    try {
      const scope = await resolveTenantScope(customerId);
      if (scope === null) {
        res.status(403).json({ error: "No tenant scope for this account" });
        return;
      }

      const author = req.user?.email ?? "unknown";
      const today = new Date().toISOString().slice(0, 10);
      const uid = randomUUID();
      const sopId = `SOP-CUST-${uid}`;
      const code = `CUST-${uid.slice(0, 4).toUpperCase()}`;

      // Forced manual, no graphEndpoint on any step: sopRunnable() stays false, so
      // the change-control-gated Execute path is never offered on a customer-authored
      // SOP. See the header.
      const steps = parsed.data.steps.map((s, i) => ({
        stepNumber: i + 1,
        title: s.title,
        description: s.description ?? "",
        type: "manual" as const,
        status: "pending" as const,
      }));

      const [inserted] = await db
        .insert(mspSopsTable)
        .values({
          mspId: scope.mspId,
          sopId,
          code,
          title: parsed.data.title,
          description: parsed.data.description,
          category: parsed.data.category,
          version: "v1.0",
          automationType: "manual",
          estimatedMinutes: parsed.data.estimatedMinutes ?? 0,
          complianceTags: [],
          workloadTags: [],
          steps,
          // The caller's own email — this is what puts the SOP in the design's
          // "Written by your team" source bucket rather than the MSP baseline.
          lastUpdatedBy: author,
          lastUpdatedAt: today,
          versionStatus: "Published / Active",
        })
        .returning({ id: mspSopsTable.id });

      log.info(
        { customerId, mspId: scope.mspId, sopId, steps: steps.length },
        "SOP authored from the customer portal",
      );

      res.status(201).json({ id: inserted.id, sopId, code });
    } catch (err) {
      log.error({ err, customerId }, "POST /portal/sops failed");
      res.status(500).json({ error: "Failed to save the SOP" });
    }
  },
);

// ── POST /api/portal/sops/:sopId/custom-steps ───────────────────────────────
//
// Add ONE step to this tenant's own overlay on an MSP-authored SOP (#1558).
// Never touches `msp_sops.steps` — the base definition is somebody else's
// authored, versioned artifact. Direct precedent:
// `POST /portal/runbooks/:runbookId/steps` (portal-runbooks.ts) does the same
// thing for a runbook's own checklist, `isCustom: true`. This is that pattern
// for the SOP library, landing in `portal_sop_custom_steps` instead of
// `portal_runbook_steps` because the two are different objects overlaying
// different kinds of base row (see the schema section header).
const MAX_CUSTOM_STEPS_PER_SOP = 60;

const addCustomStepSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
});

router.post(
  "/portal/sops/:sopId/custom-steps",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const sopId = String(req.params.sopId ?? "").trim();
    if (!sopId) {
      res.status(400).json({ error: "Invalid SOP" });
      return;
    }

    const parsed = addCustomStepSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    try {
      const scope = await resolveTenantScope(customerId);
      if (scope === null) {
        res.status(403).json({ error: "No tenant scope for this account" });
        return;
      }

      // The base definition has to actually exist for this MSP — an overlay on
      // nothing is meaningless, and this is also where `basedOnVersion` comes
      // from (the version-ambiguity half of #1558 this table exists to keep
      // honest). A 404 here reads the same as "this SOP is not in your
      // library", not a hint about other tenants' data.
      const [sop] = await db
        .select({ version: mspSopsTable.version })
        .from(mspSopsTable)
        .where(and(eq(mspSopsTable.mspId, scope.mspId), eq(mspSopsTable.sopId, sopId)))
        .limit(1);
      if (!sop) {
        res.status(404).json({ error: "SOP not found" });
        return;
      }

      const [{ maxPosition, stepCount }] = await db
        .select({
          maxPosition: sql<number>`coalesce(max(${portalSopCustomStepsTable.position}), 0)`,
          stepCount: sql<number>`count(*)`,
        })
        .from(portalSopCustomStepsTable)
        .where(
          and(
            eq(portalSopCustomStepsTable.customerId, customerId),
            eq(portalSopCustomStepsTable.sopId, sopId),
          ),
        );

      if (Number(stepCount) >= MAX_CUSTOM_STEPS_PER_SOP) {
        res.status(409).json({ error: "This procedure already has the maximum number of custom steps" });
        return;
      }

      const position = Number(maxPosition) + 1;
      const author = req.user?.email ?? "unknown";

      await db.insert(portalSopCustomStepsTable).values({
        customerId,
        sopId,
        position,
        title: parsed.data.title,
        description: parsed.data.description ?? "",
        basedOnVersion: sop.version,
        addedBy: author,
      });

      log.info(
        { customerId, sopId, position, basedOnVersion: sop.version },
        "custom SOP step added",
      );
      res.status(201).json({ position, title: parsed.data.title, basedOnVersion: sop.version });
    } catch (err) {
      log.error({ err, customerId, sopId }, "POST /portal/sops/:sopId/custom-steps failed");
      res.status(500).json({ error: "Failed to add the step" });
    }
  },
);

export default router;
