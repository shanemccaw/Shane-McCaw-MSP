/**
 * public-free-scan-remediate.ts — Git #1375 (Phase of Feature #1352, Free Scan).
 *
 *   POST /api/public/free-scan/remediate/read               the whole step's state
 *   POST /api/public/free-scan/remediate/write-consent-url  mint the real consent URL
 *   POST /api/public/free-scan/remediate/decline-write      "Not now — stay read-only"
 *   PUT  /api/public/free-scan/remediate/checklist/:checkKey record a claim on one item
 *
 * Step 5 of 5 — the `{{ writeStage }}` block of the confirmed design
 * `Design/marketing/marketing_handoff/Marketing Checkout.dc.html`, followed by
 * the real findings-driven remediation guide.
 *
 * ── Identity: the same two doors, and no third one ────────────────────────────
 * A Free Scan Prospect holds no password and no JWT (#656's
 * `hasRealEntitlement()` gate — paying for a SOW does NOT create a
 * `client_services` row, so a paid Prospect is still JWT-less at this step).
 * Every route here therefore resolves the acting tenant through
 * `resolveActor` (exported from public-free-scan-sow.ts): the live flow's
 * checkout `sessionId`, or the emailed `fsr_` return token (#1359). The
 * credential travels in the request BODY, never the query string. A caller
 * never supplies a customerId and is never told one.
 *
 * ── Why the remediation guide is served here and not from /api/portal/... ─────
 * VERIFIED, not assumed (#1375 scope item 4): `GET /api/portal/remediation-
 * tracker` and `GET /api/portal/remediation/checklist` are both behind
 * `requireCapability("ladder.free")` — which needs a JWT this caller
 * structurally cannot hold — and the tracker read additionally behind
 * `requireTierFeature(remediationTracking)`. Neither is reachable for a
 * Prospect and neither is loosened here. This route reaches the SAME
 * computation (`resolveRemediationChecklist`) and writes the SAME table
 * (`remediation_tracker_steps`, keyed on the real `customerId`) through the
 * Prospect's own, separately-authenticated door — so the moment they do have a
 * portal login, the authenticated surfaces read back exactly the rows they
 * created here.
 *
 * `RemediationGuideBody.tsx`, named in #1375's body as the component to reuse,
 * no longer exists: `f40438cd` deleted the whole `copilot-journey` UI in the
 * `artifacts/msp-portal` → `artifacts/portal` restructuring, preserved only at
 * tag `portal-archive-2026-08-29` (see `remediationLiveGuide.ts`'s own header).
 * Its live successor is `lib/remediation-checklist.ts` (#1538) — findings-
 * derived, keyed on the finding's own `checkKey`, with #1539's fix routes —
 * which is what this route serves. Filed as a finding.
 *
 * ── The write consent itself is NOT a new mechanism ───────────────────────────
 * The URL is minted with the same `signWriteConsentState` HMAC, the same
 * single-use `consent_invite_tokens` row, the same `"popup"` origin and the
 * same ONE fixed callback (`GET /api/admin/write-consent/callback`) that
 * `/api/public/flow/write-consent-url` and the admin route already use. That
 * callback is untouched: it still requires Microsoft to actually issue a
 * write-app token for the tenant (#4197) before it stamps
 * `tenants.consent.writeBack`, and it still refuses when the consenting
 * Microsoft tenant is not this customer's own. Nothing here weakens any of it.
 *
 * What this route adds on top is a NARROWER gate than any existing caller has:
 * the Prospect's engagement must be signed AND `paid`, and the phases they
 * bought must genuinely require at least one Graph write permission
 * (`lib/free-scan-write-scopes.ts`). A Prospect who bought a scope with nothing
 * executable in it is never shown the consent screen at all.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  db,
  freeScanEngagementsTable,
  tenantsTable,
  consentInviteTokensTable,
  remediationTrackerStepsTable,
  REMEDIATION_TRACKER_STEP_STATUS,
  type FreeScanEngagement,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

import { getHostBase, signWriteConsentState } from "./consent.ts";
import { credentialSchema, resolveActor } from "./public-free-scan-sow.ts";
import { loadOrCreateEngagement, selectionFromRow, type FreeScanActor } from "../lib/free-scan-engagement.ts";
import { resolveFreeScanWriteScopes, type FreeScanWriteScopeResult } from "../lib/free-scan-write-scopes.ts";
import { isKnownCheckKey } from "../lib/remediation-checklist.ts";
import { buildAdminConsentUrl } from "../lib/graph.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "auth" });

const router: IRouter = Router();

const isDev = process.env.NODE_ENV !== "production";

/**
 * The page polls `/read` while the consent popup is open on Microsoft's own
 * domain — the same poll shape `/public/flow/consent-status` serves the
 * assessment flow — so this limit is the poll's ceiling, not a form's.
 */
const remediateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 1000 : 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and try again." },
});

function noStore(_req: Request, res: Response, next: () => void): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
}

/**
 * The real, AUTHORITATIVE write grant for a customer — `tenants.consent
 * .writeBack.status`, exactly as every other gate in the platform reads it
 * (`resolveTenantWriteCeiling`, `graph.ts`'s `WriteConsentRequiredError`, the
 * orchestrator's `customer_write_consent_missing`). The engagement row's own
 * `writeConsentDecision` is never substituted for it.
 */
async function resolveTenantForWrite(
  customerId: number,
): Promise<{ tenantGuid: string | null; readGranted: boolean; writeStatus: string | null; writeConsentedAt: string | null } | null> {
  const [row] = await db
    .select({ tenantId: tenantsTable.tenantId, consent: tenantsTable.consent })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);
  if (!row) return null;
  return {
    tenantGuid: row.tenantId?.trim() || null,
    readGranted: row.consent?.graph?.status === "granted",
    writeStatus: row.consent?.writeBack?.status ?? null,
    writeConsentedAt: row.consent?.writeBack?.consentedAt ?? null,
  };
}

/**
 * Which screen the Prospect is on. Derived from real state on every read, never
 * stored as a UI step:
 *
 *   `not_paid`      — the Review step is not finished; the Remediate step has
 *                     nothing to offer yet and never mints a consent URL.
 *   `write_consent` — paid, and the real `writeBack` grant is absent. This is
 *                     the design's `{{ writeStage }}`.
 *   `guide`         — the grant landed, or the Prospect declined. Both go to the
 *                     same findings-driven guide; only the fix routes differ,
 *                     and that difference is #1539's, computed from the same
 *                     `writeBack` key rather than from anything recorded here.
 */
type RemediateStage = "not_paid" | "write_consent" | "guide";

function resolveStage(row: FreeScanEngagement, writeStatus: string | null): RemediateStage {
  if (row.status !== "paid") return "not_paid";
  if (writeStatus === "granted") return "guide";
  if (row.writeConsentDecision === "declined") return "guide";
  return "write_consent";
}

// ── POST /api/public/free-scan/remediate/read ─────────────────────────────────
// Everything the step renders, in one payload: the stage, the derived scopes,
// the real consent state, and — once past the gate — the real findings-driven
// guide. Also the poll target while the consent popup is open.

router.post("/public/free-scan/remediate/read", remediateLimiter, noStore, async (req: Request, res: Response) => {
  const parsed = credentialSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "credential_required" });
    return;
  }

  const actor = await resolveActor(parsed.data, res);
  if (!actor) return;

  try {
    const row = await loadOrCreateEngagement(actor);
    const tenant = await resolveTenantForWrite(actor.customerId);
    const writeStatus = tenant?.writeStatus ?? null;
    const stage = resolveStage(row, writeStatus);

    const selection = selectionFromRow(row);

    // One resolution for the whole screen: the scope card AND the guide come
    // off the same read of the same findings, so the two can never disagree
    // about what this tenant's open items are.
    const live = await resolveFreeScanWriteScopes(actor.customerId, selection.phaseSlugs);

    // The CARD is served from the snapshot once a decision has been recorded —
    // what the Prospect was actually asked to approve, not what a later scan
    // would ask for. Before a decision, the live derivation is the truth.
    const decided = row.writeConsentDecision === "granted" || row.writeConsentDecision === "declined";
    const snapshot = decided ? (row.writeConsentScopes as FreeScanWriteScopeResult | null) : null;
    const scopeResult = snapshot ?? live;

    res.json({
      stage,
      sowReference: row.sowReference,
      paymentPlan: row.paymentPlan,
      phaseSlugs: selection.phaseSlugs,
      // The money the done screen states, read back off the engagement's own
      // captured figures — never recomputed here, so a catalog price edit after
      // payment cannot restate what was actually charged.
      chargedCents: row.chargedCents ?? 0,
      agreedServicesCents: row.agreedServicesCents ?? 0,
      runId: live.runId,
      boughtPhases: live.boughtPhases,
      scopes: scopeResult.scopes,
      phasesWithoutWrite: scopeResult.phasesWithoutWrite,
      grantedBeyondScope: scopeResult.grantedBeyondScope,
      writeConsent: {
        // The real grant, straight off tenants.consent.writeBack.
        status: writeStatus,
        consentedAt: tenant?.writeConsentedAt ?? null,
        // What happened at THIS step — including a decline, which never reaches
        // Microsoft and so has no other home.
        decision: row.writeConsentDecision,
        decidedAt: row.writeConsentDecidedAt ? row.writeConsentDecidedAt.toISOString() : null,
        // False when MT_APP_WRITE_CLIENT_ID is unset: the button must not be
        // offered at all rather than 503 after a click.
        available: !!process.env.MT_APP_WRITE_CLIENT_ID && !!tenant?.readGranted,
      },
      // The guide only travels once the gate is behind them — a Prospect still
      // on the consent screen has no use for it, and shipping their findings
      // list to an undecided screen is more than that screen needs.
      guide: stage === "guide" ? live.guide : null,
    });
  } catch (err) {
    log.error({ err, customerId: actor.customerId }, "free-scan remediate: read failed");
    res.status(500).json({ error: "remediate_read_failed" });
  }
});

// ── POST /api/public/free-scan/remediate/write-consent-url ────────────────────
// Mint the real admin-consent URL for the WRITE App Registration. Same
// mechanism as /public/flow/write-consent-url and the admin route; the callback
// and every check inside it are untouched.

router.post("/public/free-scan/remediate/write-consent-url", remediateLimiter, noStore, async (req: Request, res: Response) => {
  // Credential shape first, deployment config second: a request with no
  // credential is a bad request whether or not the write app happens to be
  // configured, and answering 503 to it would report an outage that is not one.
  const parsed = credentialSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "credential_required" });
    return;
  }

  if (!process.env.MT_APP_WRITE_CLIENT_ID) {
    res.status(503).json({ error: "write_app_not_configured" });
    return;
  }

  const actor = await resolveActor(parsed.data, res);
  if (!actor) return;

  const row = await loadOrCreateEngagement(actor);

  // GATE 1 — this step exists only after a signed, paid engagement. Checked
  // BEFORE any token is minted, so an unpaid engagement never creates a
  // consent_invite_tokens row the fixed callback could later accept.
  if (row.status !== "paid") {
    log.warn({ customerId: actor.customerId, engagementId: row.id, status: row.status }, "free-scan remediate: write-consent REFUSED — engagement is not paid");
    res.status(409).json({ error: "payment_required" });
    return;
  }

  // GATE 2 — the read grant must already be in place and belong to a real
  // tenant row. Fails closed exactly like `resolveConsentedTenant`.
  const tenant = await resolveTenantForWrite(actor.customerId);
  if (!tenant || !tenant.tenantGuid || !tenant.readGranted) {
    res.status(409).json({ error: "read_consent_required" });
    return;
  }

  // GATE 3 — the bought phases must genuinely need a Graph write permission.
  // A Prospect whose scope has nothing executable in it is never sent to
  // Microsoft's consent screen for a grant that would do nothing.
  const scopeResult = await resolveFreeScanWriteScopes(actor.customerId, selectionFromRow(row).phaseSlugs);
  if (scopeResult.scopes.length === 0) {
    log.warn(
      { customerId: actor.customerId, engagementId: row.id, phasesWithoutWrite: scopeResult.phasesWithoutWrite },
      "free-scan remediate: write-consent REFUSED — the bought phases require no requestable Graph write permission",
    );
    res.status(409).json({ error: "no_write_scope_required", phasesWithoutWrite: scopeResult.phasesWithoutWrite });
    return;
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  await db.insert(consentInviteTokensTable).values({
    token,
    tenantId: tenant.tenantGuid,
    customerId: actor.customerId,
    clientUserId: null,
    expiresAt,
  });

  const consentUrl = buildAdminConsentUrl(
    tenant.tenantGuid,
    // "popup" — the Prospect's page stays put and polls /read, the same origin
    // the other public write-consent mint uses (#474).
    signWriteConsentState(actor.customerId, token, "popup"),
    `${getHostBase(req)}/api/admin/write-consent/callback`,
    process.env.MT_APP_WRITE_CLIENT_ID,
  );

  // Record that the Prospect was sent to the screen, with the exact scope list
  // they were shown. `requested` never claims a grant — only the
  // Microsoft-verified callback writes the real one.
  const now = new Date();
  await db
    .update(freeScanEngagementsTable)
    .set({
      writeConsentDecision: "requested",
      writeConsentDecidedAt: now,
      writeConsentScopes: scopeResult,
      updatedAt: now,
    })
    .where(eq(freeScanEngagementsTable.id, row.id));

  await createAuditLog({
    actorUserId: null,
    actorName: "public:free-scan-remediate",
    actorRole: "client",
    actionType: "write_consent_invite_created",
    entityType: "tenant_write_consent",
    tenantId: actor.customerId,
    metadata: {
      tenantHint: tenant.tenantGuid,
      customerId: actor.customerId,
      expiresAt,
      engagementId: row.id,
      sowReference: row.sowReference,
      requestedScopes: scopeResult.scopes.map((s) => s.permission),
    },
  });

  log.info(
    { customerId: actor.customerId, engagementId: row.id, scopeCount: scopeResult.scopes.length },
    "free-scan remediate: write-consent URL minted",
  );

  res.json({
    consentUrl,
    expiresAt,
    scopes: scopeResult.scopes,
    grantedBeyondScope: scopeResult.grantedBeyondScope,
  });
});

// ── POST /api/public/free-scan/remediate/decline-write ────────────────────────
// "Not now — stay read-only". A real, recorded decision, not a UI state: it is
// what makes a Prospect who declined distinguishable from one who has not yet
// looked at the screen, and it is the only place a decline is recorded at all
// (a decline never reaches Microsoft, so `tenants.consent.writeBack` stays
// untouched — which is correct: declining here must not overwrite a grant the
// tenant may already hold from another flow).

router.post("/public/free-scan/remediate/decline-write", remediateLimiter, noStore, async (req: Request, res: Response) => {
  const parsed = credentialSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "credential_required" });
    return;
  }

  const actor = await resolveActor(parsed.data, res);
  if (!actor) return;

  const row = await loadOrCreateEngagement(actor);
  if (row.status !== "paid") {
    res.status(409).json({ error: "payment_required" });
    return;
  }

  const scopeResult = await resolveFreeScanWriteScopes(actor.customerId, selectionFromRow(row).phaseSlugs);
  const now = new Date();
  await db
    .update(freeScanEngagementsTable)
    .set({
      writeConsentDecision: "declined",
      writeConsentDecidedAt: now,
      writeConsentScopes: scopeResult,
      updatedAt: now,
    })
    .where(eq(freeScanEngagementsTable.id, row.id));

  await createAuditLog({
    actorUserId: null,
    actorName: "public:free-scan-remediate",
    actorRole: "client",
    actionType: "free_scan_write_consent_declined",
    entityType: "free_scan_engagement",
    entityId: String(row.id),
    tenantId: actor.customerId,
    metadata: {
      sowReference: row.sowReference,
      declinedScopes: scopeResult.scopes.map((s) => s.permission),
    },
  });

  log.info({ customerId: actor.customerId, engagementId: row.id }, "free-scan remediate: write access declined — staying read-only");

  res.json({ ok: true, decision: "declined", decidedAt: now.toISOString() });
});

// ── PUT /api/public/free-scan/remediate/checklist/:checkKey ───────────────────
// The Prospect's own claim about ONE guide item. Writes the exact same
// `remediation_tracker_steps` row, with the same vocabulary, the same
// verification-reset-on-write rule and the same checkKey address space that
// `portal-remediation-checklist.ts` (#1538) established — so the claim is
// already there, under the same customerId, the first time they open the
// authenticated Portal.

const putItemSchema = credentialSchema.and(
  z.object({ status: z.enum(REMEDIATION_TRACKER_STEP_STATUS) }),
);

router.put("/public/free-scan/remediate/checklist/:checkKey", remediateLimiter, noStore, async (req: Request, res: Response) => {
  const parsed = putItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }

  const actor = await resolveActor(parsed.data, res);
  if (!actor) return;

  const row = await loadOrCreateEngagement(actor);
  if (row.status !== "paid") {
    res.status(409).json({ error: "payment_required" });
    return;
  }

  const checkKey = String(req.params.checkKey ?? "");
  if (!(await isKnownCheckKey(checkKey))) {
    res.status(400).json({ error: "Unknown check key" });
    return;
  }

  const { status } = parsed.data;

  // #2827's rule, unchanged and unweakened: `accepted_risk` is ONLY ever set
  // alongside a real SIGNED `msp_risk_decisions` row. The Prospect has no
  // authenticated identity to sign one with, so this door cannot offer the
  // decline-to-risk flow at all — it rejects rather than fabricating the
  // unsigned "accepted" state both portal routes already guard against.
  if (status === "accepted_risk") {
    res.status(400).json({ error: "accepted_risk cannot be set from the Free Scan flow — it needs a signed risk decision in the Portal" });
    return;
  }

  const now = new Date();
  const completedAt = status === "completed" ? now : null;

  try {
    await db
      .insert(remediationTrackerStepsTable)
      .values({
        customerId: actor.customerId,
        stepId: checkKey,
        status,
        completedAt,
        // No user row to attribute this to — the Prospect is passwordless by
        // design. Null is the honest value, not a stand-in id.
        updatedByUserId: null,
        verificationState: "unverified",
        verifiedAt: null,
        verifiedByRunId: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [remediationTrackerStepsTable.customerId, remediationTrackerStepsTable.stepId],
        set: {
          status,
          completedAt,
          updatedByUserId: null,
          verificationState: "unverified",
          verifiedAt: null,
          verifiedByRunId: null,
          updatedAt: now,
        },
      });

    log.info({ customerId: actor.customerId, checkKey, status }, "free-scan remediate: checklist item claim recorded");

    res.json({
      item: {
        checkKey,
        status,
        completedAt: completedAt?.toISOString() ?? null,
        updatedAt: now.toISOString(),
        verificationState: "unverified",
        verifiedAt: null,
      },
    });
  } catch (err) {
    log.error({ err, customerId: actor.customerId, checkKey, status }, "free-scan remediate: checklist write failed");
    res.status(500).json({ error: "checklist_write_failed" });
  }
});

export default router;

/** Exported for tests — the stage derivation is the screen's whole control flow. */
export { resolveStage, type RemediateStage, type FreeScanActor };
