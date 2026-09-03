/**
 * live-document-shares.ts — Git #1044 (Epic #660, Phase 2), "Share a link".
 *
 * A second, separate token mechanism from documentPrintTokensTable (#1043):
 * that one is single-use and minutes-lived, and exists only to authenticate a
 * headless print tab as the real logged-in user. This one is long-lived,
 * multi-view and revocable, and hands the live document set to someone who
 * has NO portal login at all — the customer's own internal reviewer or
 * purchasing team. quick_win_result_shares (the platform's older share-link
 * table, used by dashboard-export.ts/portal-documents.ts) is DEPRECATED for
 * this feature and is not touched or reused here — confirmed with Shane in
 * #660's own build-plan comment, after two false starts drifting back into
 * that system.
 *
 * Two routes:
 *   POST /portal/live-documents/share   (requireAuth) — mint a token for the
 *     caller's OWN document set, in one of two variants.
 *   GET  /public/live-document-shares/:token   (no auth) — resolve that
 *     token straight to the live document set. This is genuinely public: the
 *     token itself is the only credential, the same trust model
 *     quick_win_result_shares' `/public/documents/:shareToken` and msp-sow's
 *     `/public/sows/:shareToken` already ship in this codebase.
 *
 * WHAT "review" VS "purchasing" ACTUALLY GATES
 * ---------------------------------------------
 * Both variants return the same 7 live pillar reports (scores, stats,
 * findings, AI-written narrative — reusing `buildPillarSummary()` and
 * the same 7 narrative generators `portal-assessment.ts`'s own narrative
 * routes call). "purchasing" additionally returns the SOW's real priced
 * scope: `runSalesOfferEngineForTenant()` + the same monitoring/retainer
 * add-on resolvers `GET /portal/assessment/recommended-offers` used to
 * call (that route was retired with the SOW/checkout flow — #1674, #1753 —
 * this shares logic with it, not the route itself), assembled into the SAME
 * response shape that route used to return. This is a deliberate, minimal
 * duplication of that former route's ~15-line JSON assembly (not its
 * pricing) — the alternative was extracting/refactoring a shipped, live
 * authenticated endpoint this session cannot run against real data to
 * verify, for a two-line risk/reward that isn't worth it. The actual pricing
 * authority, `runSalesOfferEngineForTenant()`, is called directly, unchanged
 * — "do not rebuild SOW pricing logic" per this issue's own text. The
 * frontend's own `journeyScopeFromOffers()` (sowLiveScope.ts, already
 * shipped, already used by `LiveStatementOfWorkBench`) is what turns this
 * response into priced phases/totals — this route does not compute a dollar
 * total itself.
 *
 * WHY LIVE ON EVERY REQUEST, NOT A SNAPSHOT
 * ------------------------------------------
 * Every surface this feature touches — #660, #1043, this issue's own text —
 * calls this the "live document set" / "live SOW rendering" throughout, not
 * a point-in-time export. A snapshot would also need its own storage beyond
 * this issue's explicit 6-column schema (id/token/customerId/variant/
 * createdAt/revokedAt has no content column to snapshot into). So this
 * computes live, same as the authenticated viewer does.
 *
 * The one real cost of "live": the 7 narrative sections are real, metered
 * Anthropic calls with NO persistent cache anywhere in this codebase today
 * (confirmed: `ai-dev-response-cache.ts` is hard-gated to dev/test only,
 * see its own header). An authenticated staff member re-opening a report
 * already re-triggers this same cost — accepted product behaviour. A public
 * link is reachable by anyone who has it, though, including a bot re-hitting
 * it in a loop, which is a materially different exposure. Mitigated with a
 * short in-process TTL cache (`shareContentCache` below) keyed on the token
 * — cheap, no schema change, no new table, and the data still counts as
 * "live" (it re-generates once the TTL lapses) while absorbing the obvious
 * repeat-refresh case. Not a substitute for a real persistent cache if this
 * link is ever advertised more widely than "one customer forwards it to one
 * reviewer" — flagged here rather than silently built past.
 *
 * NO EXPIRY (per this issue's own schema — `revokedAt` only, no
 * `expiresAt`): a share link is handed to someone specifically so they can
 * come back to it, and a purchasing approval can take weeks. `revokedAt` is
 * the real, deliberate control the customer has over it; nothing here sets
 * it automatically. See the Drizzle table's own comment
 * (lib/db/src/schema/index.ts) for the same reasoning.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, liveDocumentSharesTable, usersTable, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { resolveMspSlugForUser } from "../lib/resolve-msp-id.ts";
import { getMspPortalBaseUrl } from "../lib/portal-url.ts";
import { buildPillarSummary } from "../lib/pillar-summary-stats.ts";
import { generateCopilotReadinessNarrative } from "../lib/copilot-readiness-narrative-generator.ts";
import { generateSecurityPostureNarrative } from "../lib/security-posture-narrative-generator.ts";
import { generateGovernancePostureNarrative } from "../lib/governance-posture-narrative-generator.ts";
import { generateComplianceAlignmentNarrative } from "../lib/compliance-alignment-narrative-generator.ts";
import { generateLicensingAlignmentNarrative } from "../lib/licensing-alignment-narrative-generator.ts";
import { generateOperationalHealthNarrative } from "../lib/operational-health-narrative-generator.ts";
import { generateAdoptionNarrative } from "../lib/adoption-narrative-generator.ts";
import { runSalesOfferEngineForTenant } from "../lib/sales-offer-engine.ts";
import { fetchSignalRulesAndGroups } from "../lib/priority-engine.ts";
import { resolveTenantMonitoringAddon, resolveArchitectRetainerAddon } from "../lib/sow-monitoring-addon.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

// Same cross-app-duplication convention live-document-pdf.ts's
// LIVE_DOCUMENT_TITLES and portal-documents.ts's LIVE_RENDERED_DOC_TYPES
// already use — journeyTokens.ts's JOURNEY_LIVE_DOCUMENTS is msp-portal-side
// and not reachable from api-server. Order matches that registry's own
// document-set order.
const LIVE_DOCUMENT_SHARE_REPORTS: ReadonlyArray<{
  readonly docType: string;
  readonly title: string;
  readonly generate: (params: {
    customerId: number;
    tenantName: string;
    attribution: { mspId: number | null; customerId: number | null; triggerSource: string };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) => Promise<any>;
}> = [
  { docType: "copilot_readiness", title: "Copilot Readiness, Safety & Enablement Report", generate: generateCopilotReadinessNarrative },
  { docType: "security_posture_report", title: "Microsoft 365 Security Posture & Blast Radius Report", generate: generateSecurityPostureNarrative },
  { docType: "governance_maturity_report", title: "Microsoft 365 Governance Posture Report", generate: generateGovernancePostureNarrative },
  { docType: "compliance_alignment_report", title: "Microsoft 365 Compliance & Regulatory Alignment Report", generate: generateComplianceAlignmentNarrative },
  { docType: "license_optimization_report", title: "Copilot Licensing Alignment Report", generate: generateLicensingAlignmentNarrative },
  { docType: "adoption_report", title: "Copilot Adoption & Workflow Readiness Report", generate: generateAdoptionNarrative },
  { docType: "operational_health_report", title: "Microsoft 365 Operational Health & Service Integrity Report", generate: generateOperationalHealthNarrative },
];

// ── POST /portal/live-documents/share ─────────────────────────────────────
//
// Mints a token for the CALLER'S OWN document set. `customerId` on the
// stored row is `req.user!.id` (a users.id) — the logged-in CustomerUser
// sharing their own results, matching this issue's own schema spec. This is
// the same identity documentPrintTokensTable.userId/printTokensTable.userId
// already key on, just named per the spec here.
router.post("/portal/live-documents/share", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { variant } = req.body as { variant?: string };
    if (variant !== "review" && variant !== "purchasing") {
      res.status(400).json({ error: "variant must be \"review\" or \"purchasing\"" });
      return;
    }

    const slug = await resolveMspSlugForUser(userId);
    if (!slug) {
      log.error({ userId }, "live document share: could not resolve MSP slug for user");
      res.status(500).json({ error: "Could not resolve your account to mint a share link" });
      return;
    }

    const token = randomBytes(32).toString("hex");
    await db.insert(liveDocumentSharesTable).values({ token, customerId: userId, variant });

    const shareUrl = `${getMspPortalBaseUrl()}/shared-live-documents/${token}`;
    res.json({ shareUrl, token, variant, mspSlug: slug });
  } catch (err) {
    req.log.error({ err }, "POST /portal/live-documents/share failed");
    res.status(500).json({ error: "Failed to mint share link" });
  }
});

// ── In-process short-TTL cache for the metered/compute-heavy parts of the
// public read (narratives, offers) — see the file header's "WHY LIVE ON
// EVERY REQUEST" section for why this exists and what it deliberately does
// not solve. Keyed on the share token; process-local (no cross-instance
// sharing), which is fine for its purpose — worst case under a multi-instance
// deploy is more cache misses, never a correctness problem, since every
// value here is itself a live, re-derivable read.
const SHARE_CONTENT_CACHE_TTL_MS = 5 * 60 * 1000;
const shareContentCache = new Map<string, { expiresAt: number; value: unknown }>();

async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = shareContentCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await compute();
  shareContentCache.set(key, { expiresAt: Date.now() + SHARE_CONTENT_CACHE_TTL_MS, value });
  return value;
}

// ── GET /public/live-document-shares/:token ───────────────────────────────
//
// No auth — the token itself is the credential, same trust model as
// `/public/documents/:shareToken` (portal-documents.ts) and
// `/public/sows/:shareToken` (msp-sow.ts).
router.get("/public/live-document-shares/:token", async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token ?? "");
    if (!token) {
      res.status(400).json({ error: "Missing token" });
      return;
    }

    const [share] = await db
      .select()
      .from(liveDocumentSharesTable)
      .where(eq(liveDocumentSharesTable.token, token))
      .limit(1);

    if (!share) {
      res.status(404).json({ error: "This link doesn't exist or has been removed" });
      return;
    }
    if (share.revokedAt) {
      res.status(410).json({ error: "This link has been revoked" });
      return;
    }

    const [userRow] = await db
      .select({ tenantId: usersTable.tenantId })
      .from(usersTable)
      .where(eq(usersTable.id, share.customerId))
      .limit(1);
    if (!userRow?.tenantId) {
      log.error({ token, shareCustomerId: share.customerId }, "live document share: owning user has no tenant");
      res.status(500).json({ error: "Could not resolve this share link's account" });
      return;
    }

    const [tenantRow] = await db
      .select({ mspId: tenantsTable.mspId, tenantGuid: tenantsTable.tenantId, customerName: tenantsTable.customerName })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, userRow.tenantId))
      .limit(1);
    if (!tenantRow) {
      log.error({ token, tenantsId: userRow.tenantId }, "live document share: no tenant row for user's tenantId");
      res.status(500).json({ error: "Could not resolve this share link's account" });
      return;
    }

    const tenantsId = userRow.tenantId; // tenants.id — every compute function below calls this "customerId"
    const tenantName = tenantRow.customerName?.trim() || "this tenant";
    const attribution = { mspId: tenantRow.mspId, customerId: tenantsId, triggerSource: "live-document-share" };

    const [pillarStats, reports] = await Promise.all([
      buildPillarSummary(tenantsId),
      cached(`${token}:narratives`, () =>
        Promise.all(
          LIVE_DOCUMENT_SHARE_REPORTS.map(async (r) => {
            try {
              const narrative = await r.generate({ customerId: tenantsId, tenantName, attribution });
              return { docType: r.docType, title: r.title, sections: narrative.sections };
            } catch (err) {
              log.error({ err, token, docType: r.docType }, "live document share: narrative generation failed");
              return { docType: r.docType, title: r.title, sections: [] };
            }
          }),
        ),
      ),
    ]);

    const pillars = pillarStats.pillars.map((p) => ({
      pillar: p.pillar,
      score: p.score,
      evaluation: p.evaluation,
      stats: p.stats,
      findings: p.findings,
      findingCounts: p.findingCounts,
    }));

    if (share.variant === "review") {
      res.json({ variant: "review", companyName: tenantRow.customerName ?? null, pillars, reports });
      return;
    }

    // purchasing — additionally the SOW's real priced scope. Mirrors GET
    // /portal/assessment/recommended-offers' own response assembly exactly
    // (portal-assessment.ts) so the frontend's existing
    // journeyScopeFromOffers() reads it identically — see file header.
    const offers = await cached(`${token}:offers`, async () => {
      const [engineOutput, { rules }, monitoringAddon, retainerAddon] = await Promise.all([
        runSalesOfferEngineForTenant(tenantsId, tenantRow.mspId),
        fetchSignalRulesAndGroups(tenantRow.mspId),
        resolveTenantMonitoringAddon(tenantRow.tenantGuid),
        resolveArchitectRetainerAddon(tenantRow.tenantGuid),
      ]);

      const pillarsBySignal = new Map<string, string>();
      for (const rule of rules) {
        if (rule.pillar) pillarsBySignal.set(rule.signalKey, rule.pillar);
      }

      return {
        offers: engineOutput.candidates.map((c) => ({
          serviceId: c.serviceId,
          serviceName: c.serviceName,
          title: c.title,
          rationale: c.rationale,
          priceCents: c.adjustedPriceCents,
          pillars: [...new Set(c.firedSignalKeys.map((k) => pillarsBySignal.get(k)).filter(Boolean))],
          link: "/customer-offers",
          stage: c.stage,
          durationWeeks: c.durationWeeks,
        })),
        addons: [monitoringAddon, retainerAddon].filter((a) => a !== null),
      };
    });

    res.json({ variant: "purchasing", companyName: tenantRow.customerName ?? null, pillars, reports, offers });
  } catch (err) {
    req.log.error({ err }, "GET /public/live-document-shares/:token failed");
    res.status(500).json({ error: "Failed to load this shared document set" });
  }
});

export default router;
