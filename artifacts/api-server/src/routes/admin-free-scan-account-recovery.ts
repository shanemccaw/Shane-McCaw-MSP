/**
 * admin-free-scan-account-recovery.ts — Git #4483 (Feature #1352, Free Scan).
 *
 * The operator half of lost-authenticator recovery for the scoped Free Scan
 * engagement account. A Prospect who has proven their mailbox AND their current
 * password lodges a request (routes/public-free-scan-account-recovery.ts); it
 * stays inert until a platform admin, having checked the person's identity
 * through a channel that is not the request itself, approves it here. Only then
 * may a replacement factor be enrolled — and only within the approval window.
 *
 *   GET  /api/admin/free-scan/account-recovery                    every request on file, pending first
 *   POST /api/admin/free-scan/account-recovery/:accountId/approve { note }
 *   POST /api/admin/free-scan/account-recovery/:accountId/deny    { note }
 *
 * The note is required: it is the record of how identity was checked.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireCapability } from "../middlewares/requireAuth.ts";
import { decideMfaReset, listMfaResetRequests, MFA_RESET_APPROVAL_TTL_MS } from "../lib/free-scan-account-recovery.ts";
import { getEmailTemplateOrFallback, sendEmailOrThrow } from "../lib/mailer.ts";
import { auditPrivilegedRead, createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "auth" });

const router: IRouter = Router();

const platformAdmin = requireCapability("ladder.platform-admin");

router.get("/admin/free-scan/account-recovery", platformAdmin, async (req: Request, res: Response) => {
  try {
    const requests = await listMfaResetRequests();
    await auditPrivilegedRead({
      actorUserId: req.user!.id,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: req.user!.role,
      actionType: "free_scan_account_recovery_queue_read",
      entityType: "free_scan_account",
      metadata: { rows: requests.length },
    });
    res.json({ requests });
  } catch (err) {
    log.error({ err }, "free-scan account recovery: queue read failed");
    res.status(500).json({ error: "recovery_queue_failed" });
  }
});

const decisionSchema = z.object({ note: z.string().trim().min(10).max(2000) });

function siteLink(): string {
  const base = (process.env.SITE_URL ?? "").replace(/\/$/, "");
  return base ? `<a href="${base}/scan/account">${base}/scan/account</a>` : "your engagement page";
}

for (const decision of ["approve", "deny"] as const) {
  router.post(`/admin/free-scan/account-recovery/:accountId/${decision}`, platformAdmin, async (req: Request, res: Response) => {
    const accountId = Number.parseInt(String(req.params["accountId"]), 10);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      res.status(400).json({ error: "account_id_invalid" });
      return;
    }
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "note_required" });
      return;
    }

    try {
      const result = await decideMfaReset(accountId, decision, req.user!.id, parsed.data.note);
      if (!result.ok) {
        res.status(result.reason === "not_found" ? 404 : 409).json({ error: result.reason });
        return;
      }
      const { account, engagement } = result;

      await createAuditLog({
        actorUserId: req.user!.id,
        actorName: req.user!.name ?? req.user!.email,
        actorRole: req.user!.role,
        actionType: decision === "approve" ? "free_scan_account_mfa_reset_approved" : "free_scan_account_mfa_reset_denied",
        entityType: "free_scan_account",
        entityId: String(account.id),
        tenantId: engagement.customerId,
        metadata: {
          engagementId: engagement.id,
          sowReference: engagement.sowReference,
          note: parsed.data.note,
          approvalExpiresAt: account.mfaResetApprovalExpiresAt,
        },
      });
      log.info({ accountId, decision, operatorId: req.user!.id }, "free-scan account recovery: second-factor reset decided");

      const hours = Math.round(MFA_RESET_APPROVAL_TTL_MS / 3600000);
      const slug = decision === "approve" ? "free-scan-account-mfa-reset-approved" : "free-scan-account-mfa-reset-denied";
      const subject = decision === "approve" ? "You can now set up a new second factor" : "Your request to replace your second factor";
      const body =
        decision === "approve"
          ? `
    <p>Hi there,</p>
    <p>Your request to replace the second factor on your engagement account (${engagement.sowReference}) is approved.</p>
    <p>Within the next ${hours} hours, go to ${siteLink()}, choose <strong>Lost your authenticator?</strong>, confirm the code we email you and your password, and set up the new one.</p>
    <p style="margin-top:24px;color:#64748b;font-size:13px;">If you didn't ask for this, reply to this email straight away.</p>
    <p style="margin-top:24px;">— Shane McCaw Consulting</p>
  `
          : `
    <p>Hi there,</p>
    <p>We couldn't approve the request to replace the second factor on your engagement account (${engagement.sowReference}). Your existing second factor still works.</p>
    <p>Reply to this email if you still need help getting back in.</p>
    <p style="margin-top:24px;">— Shane McCaw Consulting</p>
  `;
      try {
        const rendered = await getEmailTemplateOrFallback(slug, { sowReference: engagement.sowReference, hours: String(hours) }, subject, body);
        await sendEmailOrThrow(account.email, rendered.subject, rendered.bodyHtml, { templateName: slug });
      } catch (err) {
        // The decision stands; say so, so the operator can tell the Prospect directly.
        log.error({ err, accountId }, "free-scan account recovery: decision email could not be delivered");
        res.json({ ok: true, state: decision === "approve" ? "approved" : "denied", emailSent: false });
        return;
      }

      res.json({ ok: true, state: decision === "approve" ? "approved" : "denied", emailSent: true });
    } catch (err) {
      log.error({ err, accountId, decision }, "free-scan account recovery: decision failed");
      res.status(500).json({ error: "recovery_decision_failed" });
    }
  });
}

export default router;
