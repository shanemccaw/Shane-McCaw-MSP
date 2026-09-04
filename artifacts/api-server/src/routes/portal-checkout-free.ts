import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicesTable, usersTable, contractsTable, invoicesTable, projectsTable, clientServicesTable, workflowStepsTable, workflowTemplateStepsTable, workflowTemplateStepTasksTable, kanbanTasksTable, documentsTable, deviceTokensTable, messagesTable } from "@workspace/db";
import { eq, and, inArray, isNull, asc, count } from "drizzle-orm";
import { isServiceFree, resolveServicePriceCents, resolveTypeAttributesMonthlyPriceCents } from "../lib/catalog-pricing.ts";
import { ensureLeadForClient } from "../lib/crm-pipeline.ts";
import { uploadInvoiceToSharePoint } from "../lib/invoice-sharepoint.ts";
import { getPortalBaseUrl, getMspPortalBaseUrl, buildAccountSetupUrl } from "../lib/portal-url.ts";
import { sendEmailFromTemplate, getTenantHealthBlockHtml, adminPurchaseAlertEmail } from "../lib/mailer.ts";
import { sendAdminSms } from "../lib/sms.ts";
import { sendWebPushToAdmins } from "../lib/web-push.ts";
import { createNotificationForAllAdmins } from "../lib/notification-center.ts";
import { sendPushNotifications } from "../lib/push.ts";
import { fireWorkflowsForEvent } from "../lib/workflow-executor.ts";
import { verifyCaptchaToken } from "../lib/captcha.ts";
import { ensureClientSetupToken } from "../lib/client-setup-token.ts";
import { resolveTemplateTaskMetadata } from "../lib/template-task-metadata.ts";
import { seedDefaultWorkflowSteps } from "../lib/default-workflow-steps.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

async function getAdminUnreadMessageCount(): Promise<number> {
  try {
    const [row] = await db
      .select({ n: count() })
      .from(messagesTable)
      .where(eq(messagesTable.readByAdmin, false));
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

type FreeOnboardingResult =
  | { ok: true; sentSetupEmail: boolean; alreadyProvisioned: boolean; projectId?: number }
  | { ok: false; status: number; error: string };

/**
 * Shared $0 onboarding provisioning — the free-path equivalent of a successful
 * paid Stripe checkout (processStripeEvent): resolves/creates the client account,
 * links pre-signed guest contracts, creates the project + client_services (with
 * workflow-step / kanban seeding), writes $0 invoices, and sends the account-setup
 * or onboarding-confirmation email via Graph/Exchange. Idempotent via a
 * deterministic FREE-ONB invoice number.
 *
 * Shared by POST /portal/onboarding/claim-free (CRM onboarding) and
 * POST /portal/checkout/free (public marketing site). Callers own request
 * parsing, captcha/auth gating, and HTTP translation of the returned result.
 */
async function provisionFreeOnboarding(opts: {
  authedUserId: number | null;
  guestEmail: string | null;
  contractIds: number[];
  serviceIds: number[];
  log: Request["log"];
}): Promise<FreeOnboardingResult> {
    const { authedUserId, contractIds, serviceIds, log: reqLog } = opts;
    if (serviceIds.length === 0) return { ok: false, status: 400, error: "No service IDs provided" };

    // Fetch and validate services — server-side price guard.
    const fetchedServices = await db.select().from(servicesTable)
      .where(inArray(servicesTable.id, serviceIds));
    if (fetchedServices.length === 0) return { ok: false, status: 400, error: "Services not found" };
    const serviceMap = new Map(fetchedServices.map(s => [s.id, s]));
    const orderedServices = serviceIds.map(id => serviceMap.get(id)).filter(Boolean) as typeof fetchedServices;
    // Server-side price guard — the free path must NEVER provision a paid
    // service. This resolves price through EVERY pricing representation via
    // isServiceFree: the canonical `priceCents`, the legacy price/basePrice
    // columns, AND the type_attributes pricing model (pricePerUserMonth /
    // flatMonthlySurcharge / flatMonthlyPrice). Both live Stripe-bypass bugs
    // were a blind spot here: first a modern-priced assessment whose price
    // lived only in priceCents, then a monitoring tier whose price lives ONLY
    // in typeAttributes.pricePerUserMonth (the admin monitoring-tier editor
    // writes no flat price at all) — the legacy+priceCents check read $0 and
    // let a real Enhanced Monitoring subscription provision for free. A
    // service is free-eligible only when isServiceFree() is true (explicit
    // isFreeOffering flag, or zero price across every pricing field of every
    // model). This is a second, independent enforcement point behind the
    // frontend's isFree routing and holds even if that routing is ever wrong
    // again.
    const paidService = orderedServices.find(s => !isServiceFree(s));
    if (paidService) {
      reqLog.warn(
        {
          serviceId: paidService.id,
          priceCents: resolveServicePriceCents(paidService),
          typeAttributesMonthlyPriceCents: resolveTypeAttributesMonthlyPriceCents(paidService),
        },
        "free-checkout: rejected paid service reaching the free-checkout path",
      );
      return { ok: false, status: 400, error: "This order has a non-zero price — use the standard checkout" };
    }
    // Resolve user: authenticated session or guest email.
    //
    // Consent-first (#95/#103): a guest email can only RESOLVE the account
    // provisionProspectAccount already created at M365-consent time — it can
    // never create one. Every real order (assessments included) goes through
    // consent before this function runs, and the consent callback already
    // assigned the correct role (Assessment vs CustomerUser, from the ordered
    // product's serviceType) and tenant scope. A guest email with NO account
    // therefore means something upstream skipped the consent flow: that used
    // to fall through to a bare, unscoped users row (no tenant, no msp link —
    // the exact non-functional-account failure mode, and now also a
    // users_role_scope_check violation), so it fails loudly instead.
    let resolvedUserId: number;
    if (authedUserId) {
      resolvedUserId = authedUserId;
    } else {
      const guestEmail = opts.guestEmail?.trim();
      if (!guestEmail) return { ok: false, status: 401, error: "Please provide your email address to complete registration." };
      const [guestAccount] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, guestEmail.toLowerCase()))
        .limit(1);
      if (!guestAccount) {
        reqLog.error(
          { guestEmail },
          "free-checkout: guest order for an email with NO consent-provisioned account — the consent-first flow was skipped upstream; refusing to create an unscoped account",
        );
        return {
          ok: false,
          status: 409,
          error: "Your Microsoft 365 connection hasn't been set up yet. Please complete the connection step first so your order can be linked to your organization.",
        };
      }
      resolvedUserId = guestAccount.id;
      // Link any pre-signed guest contracts to the resolved account
      if (contractIds.length > 0) {
        await db.update(contractsTable)
          .set({ userId: resolvedUserId })
          .where(and(inArray(contractsTable.id, contractIds), isNull(contractsTable.userId)));
      }
    }

    const [buyer] = await db.select().from(usersTable).where(eq(usersTable.id, resolvedUserId)).limit(1);
    if (!buyer) return { ok: false, status: 404, error: "Account not found" };

    // Idempotency: deterministic invoice number — retry-safe
    const freeInvoiceNumber = `FREE-ONB-${resolvedUserId}-${[...serviceIds].sort().join("-")}`;
    const [existingInvoice] = await db.select({ id: invoicesTable.id }).from(invoicesTable)
      .where(eq(invoicesTable.invoiceNumber, freeInvoiceNumber)).limit(1);
    if (existingInvoice) return { ok: true, sentSetupEmail: false, alreadyProvisioned: true };

    void ensureLeadForClient(resolvedUserId, buyer.email, buyer.name ?? undefined, buyer.company ?? undefined);

    const serviceNames = orderedServices.map(s => s.name);
    const projectTitle = serviceNames.join(" + ");

    // Create project — typed as quick_win so the portal wizard gate is NOT
    // bypassed. Clients who claim a free quick win must still complete the
    // onboarding wizard before the main portal is unlocked.
    const [project] = await db.insert(projectsTable).values({
      title: projectTitle,
      description: orderedServices.length === 1
        ? (orderedServices[0].description ?? null)
        : `Engagement covering: ${serviceNames.join(", ")}`,
      status: "active",
      phase: "Kickoff",
      progress: 0,
      projectType: "quick_win",
      clientUserId: resolvedUserId,
      startDate: new Date(),
    }).returning();

    // Resolve workflow template for the primary service
    const primaryService = orderedServices[0];
    const resolvedWorkflowTemplateId = primaryService?.workflowTemplateId ?? null;
    let workflowTemplateSteps: Array<{ id: number; title: string; description: string | null; order: number }> = [];
    if (resolvedWorkflowTemplateId) {
      workflowTemplateSteps = await db.select().from(workflowTemplateStepsTable)
        .where(eq(workflowTemplateStepsTable.workflowTemplateId, resolvedWorkflowTemplateId))
        .orderBy(asc(workflowTemplateStepsTable.order));
    }

    for (let i = 0; i < orderedServices.length; i++) {
      const svc = orderedServices[i];
      const cid = contractIds[i] ?? NaN;

      const [newCs] = await db.insert(clientServicesTable).values({
        clientUserId: resolvedUserId,
        serviceId: svc.id,
        projectId: project.id,
        status: "active",
        progress: 0,
        startDate: new Date(),
      }).returning();

      // Seed workflow steps
      if (i === 0 && workflowTemplateSteps.length > 0) {
        const createdSteps = await db.insert(workflowStepsTable).values(
          workflowTemplateSteps.map((s, idx) => ({
            clientServiceId: newCs.id,
            projectId: project.id,
            title: s.title,
            description: s.description ?? "",
            status: idx === 0 ? ("in_progress" as const) : ("pending" as const),
            order: idx + 1,
            workflowTemplateStepId: s.id,
          }))
        ).returning();
        const firstStep = createdSteps[0];
        if (firstStep?.workflowTemplateStepId) {
          const step1Tasks = await db.select().from(workflowTemplateStepTasksTable)
            .where(eq(workflowTemplateStepTasksTable.workflowTemplateStepId, firstStep.workflowTemplateStepId))
            .orderBy(asc(workflowTemplateStepTasksTable.order));
          if (step1Tasks.length > 0) {
            const resolvedMetadata = await resolveTemplateTaskMetadata(step1Tasks);
            await db.insert(kanbanTasksTable).values(
              step1Tasks.map((t, idx) => ({
                projectId: project.id,
                workflowStepId: firstStep.id,
                groupName: t.groupName ?? null,
                title: t.title,
                description: t.description ?? null,
                column: (t.isCustomerTask ? "waiting_on_customer" : "backlog") as "backlog" | "waiting_on_customer",
                order: idx,
                taskType: t.taskType ?? null,
                taskMetadata: resolvedMetadata[idx],
              }))
            );
          }
        }
      } else {
        await seedDefaultWorkflowSteps(newCs.id, project.id, svc.slug ?? "");
      }

      // Link contract → project and attach PDF document
      if (!isNaN(cid)) {
        const contractRecord = await db.select().from(contractsTable)
          .where(eq(contractsTable.id, cid)).then(r => r[0]);
        await db.update(contractsTable)
          .set({ projectId: project.id })
          .where(eq(contractsTable.id, cid));
        const pdfFilename = contractRecord?.pdfFilename;
        if (pdfFilename) {
          await db.insert(documentsTable).values({
            projectId: project.id,
            name: `Signed Service Agreement — ${svc.name}`,
            filename: pdfFilename,
            mimeType: "application/pdf",
            uploadedBy: resolvedUserId,
          });
        }
      }

      // Create $0 invoice (first one gets the deterministic idempotency key)
      const [onbInvoice] = await db.insert(invoicesTable).values({
        clientUserId: resolvedUserId,
        projectId: project.id,
        invoiceNumber: i === 0 ? freeInvoiceNumber : `FREE-ONB-${resolvedUserId}-${svc.id}-${Date.now()}`,
        description: `${svc.name} — complimentary engagement`,
        amount: 0, // integer cents (Git #1610) — complimentary, $0.00
        currency: "usd",
        status: "paid",
        paidAt: new Date(),
      }).returning({ id: invoicesTable.id });
      void uploadInvoiceToSharePoint(onbInvoice.id);
    }

    // Setup email for new accounts / confirmation for returning clients
    const baseUrl = getPortalBaseUrl();
    let sentSetupEmail = false;
    const hasPassword = !!(buyer.passwordHash);
    if (!hasPassword && buyer.email) {
      const { token: activeToken, isNew: tokenIsNew } = await ensureClientSetupToken(resolvedUserId);
      sentSetupEmail = tokenIsNew;
      if (tokenIsNew) {
        const setupUrl = buildAccountSetupUrl(activeToken);
        void sendEmailFromTemplate(
          "account-setup",
          buyer.email,
          { setupLink: setupUrl, clientName: buyer.name ?? buyer.email },
          "Set up your Shane McCaw Consulting portal",
          `<p>Hi ${buyer.name ?? ""},</p><p>Your project workspace is ready. Click the link below to set your portal password:</p><p><a href="${setupUrl}" style="color:#0078D4;">Set my password →</a></p><p>This link expires in 72 hours.</p><p>— Shane McCaw</p>`,
        ).catch((e) => reqLog.warn({ err: e, userId: resolvedUserId, template: "account-setup" }, "claim-free: account-setup email failed (non-fatal)"));
      }
    } else if (hasPassword && buyer.email) {
      void sendEmailFromTemplate(
        "onboarding-confirmation",
        buyer.email,
        { clientName: buyer.name ?? buyer.email, serviceName: serviceNames.join(", "), amountDollars: "0", projectUrl: baseUrl, tenantHealthBlockHtml: await getTenantHealthBlockHtml(buyer.id) },
        "Your project workspace is ready — Shane McCaw Consulting",
        `<p>Hi ${buyer.name ?? ""},</p><p>Your <strong>${serviceNames.join(", ")}</strong> project workspace is ready. Log in to your portal to track progress.</p><p><a href="${baseUrl}" style="color:#0078D4;">View your portal →</a></p><p>— Shane McCaw</p>`,
      ).catch((e) => reqLog.warn({ err: e, userId: resolvedUserId, template: "onboarding-confirmation" }, "claim-free: onboarding-confirmation email failed (non-fatal)"));
    }

    // Admin alerts (all non-fatal)
    try {
      sendAdminSms(
        `New zero-price onboarding: ${buyer.name ?? buyer.email} — ${projectTitle} — $0`,
      ).catch(() => null);

      await createNotificationForAllAdmins({
        title: `New zero-price onboarding: ${buyer.name ?? buyer.email}`,
        body: `${projectTitle} — $0.00. Project #${project.id} auto-created.`,
        category: "onboarding",
        linkPath: `/dashboard`,
      });
      void sendWebPushToAdmins({
        title: `New zero-price onboarding: ${buyer.name ?? buyer.email}`,
        body: `${projectTitle} — $0.00`,
        linkPath: `/dashboard`,
        playSound: true,
      });
      const deviceRows = await db.select({ token: deviceTokensTable.token }).from(deviceTokensTable);
      const tokens = deviceRows.map(r => r.token);
      const badge = await getAdminUnreadMessageCount() + 1;
      sendPushNotifications(
        tokens,
        "New Zero-Price Onboarding",
        `${buyer.name ?? buyer.email} — ${projectTitle}`,
        { screen: "orders" },
        undefined,
        badge,
      ).catch(() => null);
      const adminEmailAddr = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
      if (adminEmailAddr) {
        sendEmailFromTemplate(
          "admin-purchase-alert",
          adminEmailAddr,
          {
            clientName: buyer.name ?? "",
            clientEmail: buyer.email,
            serviceName: projectTitle,
            amountDollars: "0.00",
            purchaseType: "Zero-price onboarding",
            portalLink: `${getMspPortalBaseUrl()}/projects/${project.id}`,
          },
          `New zero-price onboarding: ${projectTitle}`,
          adminPurchaseAlertEmail({
            clientName: buyer.name ?? "",
            clientEmail: buyer.email,
            serviceName: projectTitle,
            amountDollars: "0.00",
            type: "onboarding_purchase",
            projectId: project.id,
          }),
        ).catch(() => null);
      }
    } catch (notifyErr) {
      reqLog.warn({ err: notifyErr }, "onboarding claim-free: post-provision notification failed (non-fatal)");
    }

    void fireWorkflowsForEvent("onboarding.free_claimed", {
      clientId: resolvedUserId,
      clientEmail: buyer.email,
      clientName: buyer.name ?? "",
      projectId: project.id,
      projectTitle,
      serviceIds,
    });

    return { ok: true, sentSetupEmail, alreadyProvisioned: false, projectId: project.id };
}

// POST /portal/checkout/free — public marketing-site free ($0) checkout.
//
// The marketing Checkout page (shane-mccaw-consulting/src/pages/Checkout.tsx)
// branches free ($0) items away from Stripe and POSTs here after signing the
// contract via /portal/onboarding/contract. This is the free-path twin of
// /portal/checkout/create-session (paid). Bot-protected with the same Turnstile
// verification used by the authenticated offer checkout; no Stripe interaction.
router.post("/portal/checkout/free", async (req: Request, res: Response) => {
  try {
    const body = req.body as { contractIds?: unknown; serviceIds?: unknown; guestEmail?: string; captchaToken?: string };

    // CAPTCHA gate — reuses lib/captcha verifyCaptchaToken, which transparently
    // bypasses when TURNSTILE_SECRET_KEY is unset (dev/preview) and enforces
    // against Cloudflare when configured. Do not weaken.
    const captchaToken = typeof body.captchaToken === "string" ? body.captchaToken : "";
    if (!captchaToken) { res.status(400).json({ error: "CAPTCHA verification is required to complete registration." }); return; }
    const captchaRes = await verifyCaptchaToken(captchaToken);
    if (!captchaRes.success) { res.status(403).json({ error: "CAPTCHA verification failed. Please refresh the page and try again." }); return; }

    const contractIds = (Array.isArray(body.contractIds) ? body.contractIds : []).map(Number).filter(n => !isNaN(n));
    const serviceIds = (Array.isArray(body.serviceIds) ? body.serviceIds : []).map(Number).filter(n => !isNaN(n));

    const result = await provisionFreeOnboarding({
      authedUserId: req.user?.id ?? null,
      guestEmail: body.guestEmail ?? null,
      contractIds,
      serviceIds,
      log: req.log,
    });
    if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
    res.json({ ok: true, sentSetupEmail: result.sentSetupEmail });
  } catch (err) {
    req.log.error({ err }, "portal: failed to process free checkout");
    res.status(500).json({ error: "We couldn't complete your free registration. Please try again in a moment." });
  }
});

export default router;
