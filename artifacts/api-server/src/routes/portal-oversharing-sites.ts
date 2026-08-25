/**
 * portal-oversharing-sites.ts — the Overshared SharePoint drill-down's
 * "Affected Sites" list (#1286), and the site-fix runbooks it opens.
 *
 *   GET  /api/portal/oversharing/sites
 *   POST /api/portal/oversharing/runbooks/:sopKind
 *
 * Kept separate from `portal-oversharing-items.ts` (the bulk page's flat
 * per-grant reader) because this reads the SAME `overshared_items` rows but
 * answers a different question — grouped by site, with named admins/guests
 * resolved off the `user`/`guest` grant rows #1286 landed. See
 * `lib/portal-oversharing-sites.ts` for the grouping/naming rules.
 *
 * ── Runbook state rides the EXISTING SOP/Runbook subsystem ───────────────────
 * Per #1286's own scoping ("defer to the SOP/Runbook subsystem... don't build
 * a new table") and #1262's original recommendation, a site-fix runbook's
 * checklist state is NOT a new table. It is a `portal_runbooks` +
 * `portal_runbook_steps` row — the same tables and the same
 * `PUT /portal/runbooks/:runbookId/steps/:position` toggle route
 * `portal-runbooks.ts` already built and already tests. The three catalogue
 * keys below are GLOBAL per customer, not per-site — matching the drill-down
 * page's own documented design (`portal-v2-gov-oversharing.tsx`'s header:
 * "the runbook open/checked state is per-KIND and global... not per-site").
 * `POST /portal/oversharing/runbooks/:sopKind` seeds the row (and its steps)
 * exactly once per customer, idempotently, then returns it; toggling a step
 * afterward is the existing generic route — no new toggle endpoint here.
 *
 * ── Role floor ─────────────────────────────────────────────────────────────
 * `Assessment` — same floor as the sibling `portal-oversharing-items.ts` and
 * `portal-runbooks.ts`.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  oversharedItemsTable,
  portalRunbooksTable,
  portalRunbookStepsTable,
} from "@workspace/db";
import { and, asc, desc, eq } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { buildOversharingSites, type OversharedSiteGrantRow } from "../lib/portal-oversharing-sites";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

const DEFAULT_CHECK_KEY = "compliance:eeeu-site-sharing";

// ── GET /portal/oversharing/sites ─────────────────────────────────────────────

router.get(
  "/portal/oversharing/sites",
  requireRole("Assessment"),
  async (req: Request, res: Response) => {
    try {
      const customerId = resolveCustomerId(req);
      if (customerId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
        return;
      }

      const tenantScope = await resolveTenantScope(customerId);
      if (!tenantScope) {
        res.json({ sites: [], runId: null });
        return;
      }

      const checkKey =
        typeof req.query.checkKey === "string" && req.query.checkKey.trim() ? req.query.checkKey.trim() : DEFAULT_CHECK_KEY;

      const [latest] = await db
        .select({ runId: oversharedItemsTable.runId })
        .from(oversharedItemsTable)
        .where(and(eq(oversharedItemsTable.tenantId, tenantScope.tenantId), eq(oversharedItemsTable.checkKey, checkKey)))
        .orderBy(desc(oversharedItemsTable.collectedAt), desc(oversharedItemsTable.id))
        .limit(1);

      if (!latest?.runId) {
        res.json({ sites: [], runId: null });
        return;
      }

      const rows = await db
        .select()
        .from(oversharedItemsTable)
        .where(
          and(
            eq(oversharedItemsTable.tenantId, tenantScope.tenantId),
            eq(oversharedItemsTable.checkKey, checkKey),
            eq(oversharedItemsTable.runId, latest.runId),
            eq(oversharedItemsTable.scope, "site"),
          ),
        )
        .orderBy(asc(oversharedItemsTable.id));

      const grantRows: OversharedSiteGrantRow[] = rows.map((r) => ({
        siteId: r.siteId,
        siteName: r.siteName,
        siteUrl: r.siteUrl,
        siteVisibility: r.siteVisibility,
        isPersonalSite: r.isPersonalSite,
        grantKind: r.grantKind,
        principalLabel: r.principalLabel,
        principalUpn: r.principalUpn,
        roles: r.roles,
        remediationState: r.remediationState,
      }));

      res.json({ sites: buildOversharingSites(grantRows), runId: latest.runId });
    } catch (err: unknown) {
      log.error({ err }, "GET /portal/oversharing/sites failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// ── The site-fix runbook catalogue ────────────────────────────────────────────
// Same real copy as the portal's own `govOversharingData.ts` (CONVERT_TO_PRIVATE_STEPS
// / REDUCE_ADMINS_STEPS / MANAGE_GUESTS_STEPS) — "Copy is final" applies here too,
// so these strings must stay byte-identical to that file if either ever changes.

const SOP_KINDS = ["convert", "reduceAdmins", "manageGuests"] as const;
type SopKind = (typeof SOP_KINDS)[number];

function isSopKind(v: string): v is SopKind {
  return (SOP_KINDS as readonly string[]).includes(v);
}

const RUNBOOK_CATALOGUE: Record<SopKind, { runbookKey: string; title: string; context: string; steps: readonly string[] }> = {
  convert: {
    runbookKey: "oversharing-convert-to-private",
    title: "Convert to Private",
    context: "Governance · Overshared SharePoint",
    steps: [
      "Notify all site admins that this site is scheduled for conversion to Private",
      "Enable Restricted Content Discoverability (RCD) immediately — blocks this site from SharePoint search and Copilot results while the process runs",
      "Allow admins to submit a business justification to keep the site public (e.g. community practice, training, all-hands)",
      "If no admin responds within 30 days, convert the site to Private automatically",
    ],
  },
  reduceAdmins: {
    runbookKey: "oversharing-reduce-admins",
    title: "Reduce Site Admins to 2",
    context: "Governance · Overshared SharePoint",
    steps: [
      "Communicate to all current site admins that admin access will be reduced to 2",
      "Allow time for admins to remove themselves voluntarily",
      "Send a reminder to admins who haven’t acted",
      "Admin action: remove all but the 2 admins selected to remain",
    ],
  },
  manageGuests: {
    runbookKey: "oversharing-manage-guests",
    title: "Manage Guest Access",
    context: "Governance · Overshared SharePoint",
    steps: [
      "Email all site admins: do you know this guest and are they still needed?",
      "Wait for admin response",
      "If needed — file a Risk-Based Decision (RBD) to formally accept and document why",
      "If not needed — admin removes the guest, or removal proceeds automatically",
    ],
  },
};

/** The synthesised "Verify — run a targeted scan..." row every runbook ends on (RunbookSteps.tsx). */
const VERIFY_STEP_TEXT = "Verify — run a targeted scan to confirm this fix took";

interface WireOversharingRunbookStep {
  readonly position: number;
  readonly text: string;
  readonly checked: boolean;
}

interface WireOversharingRunbook {
  readonly id: number;
  readonly sopKind: SopKind;
  readonly steps: readonly WireOversharingRunbookStep[];
}

async function loadRunbookWire(runbookId: number, sopKind: SopKind): Promise<WireOversharingRunbook> {
  const stepRows = await db
    .select()
    .from(portalRunbookStepsTable)
    .where(eq(portalRunbookStepsTable.runbookId, runbookId))
    .orderBy(asc(portalRunbookStepsTable.position));

  return {
    id: runbookId,
    sopKind,
    steps: stepRows.map((s) => ({ position: s.position, text: s.text, checked: s.checked })),
  };
}

// ── POST /portal/oversharing/runbooks/:sopKind — ensure + fetch ──────────────

router.post(
  "/portal/oversharing/runbooks/:sopKind",
  requireRole("Assessment"),
  async (req: Request, res: Response) => {
    try {
      const customerId = resolveCustomerId(req);
      if (customerId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
        return;
      }

      const sopKindRaw = String(req.params.sopKind ?? "");
      if (!isSopKind(sopKindRaw)) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Unknown runbook kind");
        return;
      }
      const sopKind = sopKindRaw;
      const catalogue = RUNBOOK_CATALOGUE[sopKind];

      const [existing] = await db
        .select({ id: portalRunbooksTable.id })
        .from(portalRunbooksTable)
        .where(and(eq(portalRunbooksTable.customerId, customerId), eq(portalRunbooksTable.runbookKey, catalogue.runbookKey)))
        .limit(1);

      if (existing) {
        res.json(await loadRunbookWire(existing.id, sopKind));
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      const [inserted] = await db
        .insert(portalRunbooksTable)
        .values({
          customerId,
          runbookKey: catalogue.runbookKey,
          title: catalogue.title,
          context: catalogue.context,
          pillar: "governance",
          startedOn: today,
          // No day-progress UI reads this runbook (RunbookSteps.tsx renders a
          // plain checklist, not "Day X of Y") — a nominal value satisfies the
          // NOT NULL column without implying a real cycle deadline.
          cycleDays: 30,
          status: "active",
        })
        .returning({ id: portalRunbooksTable.id });

      const stepRows = catalogue.steps.map((text, i) => ({
        runbookId: inserted.id,
        position: i + 1,
        text,
        checked: false,
        isCustom: false,
      }));
      stepRows.push({
        runbookId: inserted.id,
        position: catalogue.steps.length + 1,
        text: VERIFY_STEP_TEXT,
        checked: false,
        isCustom: false,
      });
      await db.insert(portalRunbookStepsTable).values(stepRows);

      log.info({ customerId, sopKind, runbookId: inserted.id }, "oversharing site-fix runbook created");
      res.status(201).json(await loadRunbookWire(inserted.id, sopKind));
    } catch (err: unknown) {
      log.error({ err }, "POST /portal/oversharing/runbooks failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
