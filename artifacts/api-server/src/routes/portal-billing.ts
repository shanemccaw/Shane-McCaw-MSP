import { Router, type IRouter, type Request, type Response } from "express";
import { db, invoicesTable, projectsTable, usersTable, contractsTable, servicesTable, clientServicesTable } from "@workspace/db";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { sendEmailFromTemplate, getTenantHealthBlockHtml, canSendAutomatedCustomerEmail, retainerResumedEmail } from "../lib/mailer.ts";
import { sendAdminSms } from "../lib/sms.ts";
import { createAuditLog } from "../lib/audit.ts";
import { getStripeKey } from "../lib/stripe.ts";
import { getMspPortalBaseUrl } from "../lib/portal-url.ts";
import { logger } from "../lib/logger.ts";
import path from "path";
import fs from "fs";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("../../data/uploads");

async function getOrCreateStripeCustomer(
  stripe: { customers: { search: (p: { query: string; limit: number }) => Promise<{ data: Array<{ id: string; address?: { line1?: string | null } | null; name?: string | null }> }>; create: (p: Record<string, unknown>) => Promise<{ id: string }>; update: (id: string, p: Record<string, unknown>) => Promise<unknown> } },
  user: { email: string; name: string | null; address: string | null; addressCity: string | null; addressState: string | null; addressZip: string | null },
): Promise<string | undefined> {
  try {
    const hasAddress = !!(user.address || user.addressCity || user.addressState || user.addressZip);
    const addressObj = hasAddress ? {
      line1: user.address ?? undefined,
      city: user.addressCity ?? undefined,
      state: user.addressState ?? undefined,
      postal_code: user.addressZip ?? undefined,
      country: "US",
    } : undefined;

    const existing = await stripe.customers.search({ query: `email:"${user.email}"`, limit: 1 });

    if (existing.data.length > 0) {
      const customer = existing.data[0];
      if (hasAddress && !customer.address?.line1) {
        await stripe.customers.update(customer.id, {
          name: user.name ?? undefined,
          address: addressObj,
        });
      }
      return customer.id;
    }

    const created = await stripe.customers.create({
      email: user.email,
      name: user.name ?? undefined,
      address: addressObj,
    });
    return created.id;
  } catch {
    return undefined;
  }
}

router.get("/portal/invoices", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const invoices = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.clientUserId, userId))
    .orderBy(desc(invoicesTable.createdAt));
  res.json(invoices);
});

// ─── CLIENT: Invoice detail ───────────────────────────────────────────────────
router.get("/portal/invoices/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [invoice] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.clientUserId, userId)));
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

  let project: { id: number; title: string } | null = null;
  if (invoice.projectId) {
    const [p] = await db.select({ id: projectsTable.id, title: projectsTable.title })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, invoice.projectId), eq(projectsTable.clientUserId, userId)));
    project = p ?? null;
  }

  const [clientUser] = await db.select({
    name: usersTable.name,
    company: usersTable.company,
    phone: usersTable.phone,
    address: usersTable.address,
    addressCity: usersTable.addressCity,
    addressState: usersTable.addressState,
    addressZip: usersTable.addressZip,
  }).from(usersTable).where(eq(usersTable.id, invoice.clientUserId));
  const client = clientUser ?? null;

  let contracts: Array<{
    id: number;
    serviceId: number;
    serviceName: string;
    signedAt: Date;
    signerName: string | null;
    contractVersion: string;
    finalPrice: string | null;
    wizardSelections: unknown;
    orderWorkflow: unknown;
  }> = [];

  if (invoice.projectId) {
    const rows = await db.select({
      id: contractsTable.id,
      serviceId: contractsTable.serviceId,
      serviceName: servicesTable.name,
      signedAt: contractsTable.signedAt,
      signerName: contractsTable.signerName,
      contractVersion: contractsTable.contractVersion,
      finalPrice: contractsTable.finalPrice,
      wizardSelections: contractsTable.wizardSelections,
      orderWorkflow: servicesTable.orderWorkflow,
    })
      .from(contractsTable)
      .innerJoin(servicesTable, eq(contractsTable.serviceId, servicesTable.id))
      .where(and(
        eq(contractsTable.projectId, invoice.projectId),
        eq(contractsTable.userId, userId),
      ));
    contracts = rows;
  }

  res.json({ invoice, project, contracts, client });
});

router.post("/portal/invoices/:id/pay", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [invoice] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.clientUserId, userId)));
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (invoice.status === "paid") { res.status(400).json({ error: "Invoice already paid" }); return; }

  let stripeKey: string;
  try { stripeKey = getStripeKey(); } catch (e) { res.status(503).json({ error: (e as Error).message }); return; }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  const [invoiceUserProfile] = await db.select({
    email: usersTable.email,
    name: usersTable.name,
    address: usersTable.address,
    addressCity: usersTable.addressCity,
    addressState: usersTable.addressState,
    addressZip: usersTable.addressZip,
  }).from(usersTable).where(eq(usersTable.id, userId));

  const invoiceCustomerId = invoiceUserProfile
    ? await getOrCreateStripeCustomer(stripe, invoiceUserProfile)
    : undefined;

  const { returnUrl } = req.body as { returnUrl?: string };
  const baseUrl = returnUrl ?? `${req.protocol}://${req.hostname}`;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    customer: invoiceCustomerId,
    billing_address_collection: "required",
    line_items: [{
      price_data: {
        currency: invoice.currency,
        unit_amount: Math.round(parseFloat(String(invoice.amount)) * 100),
        product_data: { name: `Invoice ${invoice.invoiceNumber}`, description: invoice.description ?? undefined },
      },
      quantity: 1,
    }],
    mode: "payment",
    success_url: `${baseUrl}/portal/billing?payment=success&invoice=${id}`,
    cancel_url: `${baseUrl}/portal/billing?payment=cancelled`,
    metadata: { invoiceId: String(id) },
  });

  await db.update(invoicesTable).set({ stripeSessionId: session.id, updatedAt: new Date() }).where(eq(invoicesTable.id, id));

  res.json({ url: session.url });
});

router.get("/portal/invoices/:id/download", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const isAdmin = req.user!.role === "admin";
  const [invoice] = await db.select().from(invoicesTable)
    .where(isAdmin ? eq(invoicesTable.id, id) : and(eq(invoicesTable.id, id), eq(invoicesTable.clientUserId, userId)));
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (!invoice.pdfFilename) { res.status(404).json({ error: "No PDF available" }); return; }

  const filePath = path.join(UPLOADS_BASE, "invoices", invoice.pdfFilename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found" }); return; }
  res.download(filePath, invoice.pdfFilename);
});

router.get("/portal/billing/stripe-receipts", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  let stripeKey: string;
  try { stripeKey = getStripeKey(); } catch { res.json([]); return; }

  // Find any client service with a Stripe subscription ID for this user
  const rows = await db.select({ stripeSubscriptionId: clientServicesTable.stripeSubscriptionId })
    .from(clientServicesTable)
    .where(
      and(
        eq(clientServicesTable.clientUserId, userId),
        isNotNull(clientServicesTable.stripeSubscriptionId),
      )
    )
    .limit(1);

  if (rows.length === 0 || !rows[0]?.stripeSubscriptionId) {
    res.json([]);
    return;
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);

    // Resolve the Stripe customer ID from the subscription
    const sub = await stripe.subscriptions.retrieve(rows[0].stripeSubscriptionId, {
      expand: ["customer"],
    });

    const customer = sub.customer;
    if (!customer || typeof customer === "string" || customer.deleted) {
      res.json([]);
      return;
    }

    // Fetch all invoices for this customer
    const invoiceList = await stripe.invoices.list({
      customer: customer.id,
      limit: 50,
    });

    const receipts = invoiceList.data.map(inv => ({
      id: inv.id,
      number: inv.number ?? null,
      amount: inv.amount_paid,
      currency: inv.currency,
      status: inv.status ?? "unknown",
      date: inv.created,
      invoicePdf: inv.invoice_pdf ?? null,
    }));

    res.json(receipts);
  } catch (err) {
    req.log.warn({ err }, "stripe-receipts: failed to fetch invoices");
    res.json([]);
  }
});

// ─── CLIENT: Subscriptions ────────────────────────────────────────────────────
router.get("/portal/billing/subscriptions", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const rows = await db.select({
    cs: clientServicesTable,
    svc: servicesTable,
  })
    .from(clientServicesTable)
    .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
    .where(
      and(
        eq(clientServicesTable.clientUserId, userId),
        eq(servicesTable.billingType, "recurring_monthly"),
      )
    )
    .orderBy(desc(clientServicesTable.purchasedAt));

  let stripeKey: string | null = null;
  try { stripeKey = getStripeKey(); } catch { /* Stripe not configured for this environment */ }

  const results = await Promise.all(rows.map(async ({ cs, svc }) => {
    let stripeData: {
      status: string;
      cancelAtPeriodEnd: boolean;
      cancelAt: number | null;
      billingCycleAnchor: number | null;
      currentPeriodEnd: number | null;
      amount: number | null;
      currency: string | null;
    } | null = null;

    if (cs.stripeSubscriptionId && stripeKey) {
      try {
        const { default: Stripe } = await import("stripe");
        const stripe = new Stripe(stripeKey);
        const sub = await stripe.subscriptions.retrieve(cs.stripeSubscriptionId);
        const item = sub.items.data[0];
        stripeData = {
          status: sub.status,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          cancelAt: sub.cancel_at ?? null,
          billingCycleAnchor: sub.billing_cycle_anchor ?? null,
          currentPeriodEnd: item?.current_period_end ?? null,
          amount: item?.price?.unit_amount ?? null,
          currency: item?.price?.currency ?? null,
        };
      } catch {
        // Stripe unreachable — return record without live data
      }
    }

    return {
      id: cs.id,
      serviceId: svc.id,
      serviceName: svc.name,
      serviceSlug: svc.slug,
      status: cs.status,
      startDate: cs.startDate,
      purchasedAt: cs.purchasedAt,
      stripeSubscriptionId: cs.stripeSubscriptionId,
      stripe: stripeData,
    };
  }));

  res.json(results);
});

router.post("/portal/billing/subscriptions/:id/cancel", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [cs] = await db.select().from(clientServicesTable)
    .where(and(eq(clientServicesTable.id, id), eq(clientServicesTable.clientUserId, userId)));
  if (!cs) { res.status(404).json({ error: "Subscription not found" }); return; }
  if (!cs.stripeSubscriptionId) {
    res.status(400).json({ error: "No Stripe subscription linked to this service. Please contact support." });
    return;
  }

  let stripeKey: string;
  try { stripeKey = getStripeKey(); } catch (e) { res.status(503).json({ error: (e as Error).message }); return; }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  const sub = await stripe.subscriptions.update(cs.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  req.log.info({ clientServiceId: cs.id, subscriptionId: cs.stripeSubscriptionId }, "subscription: cancel_at_period_end set");

  void createAuditLog({
    actorUserId: userId,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: "retainer_cancelled",
    entityType: "service",
    entityId: cs.id,
    entityLabel: String(cs.serviceId),
    clientId: userId,
  });

  const [cancelledSvc] = await db.select({ name: servicesTable.name }).from(servicesTable).where(eq(servicesTable.id, cs.serviceId)).limit(1);
  const cancelledServiceName = cancelledSvc?.name ?? "their service";
  const cancelAtDate = sub.cancel_at
    ? new Date(sub.cancel_at * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "end of current billing period";

  void sendAdminSms(
    `Retainer cancelled: ${req.user!.name ?? req.user!.email} has cancelled their ${cancelledServiceName} retainer. Access ends: ${cancelAtDate}.`
  );

  res.json({
    ok: true,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    cancelAt: sub.cancel_at ?? null,
    billingCycleAnchor: sub.billing_cycle_anchor ?? null,
  });
});

// ─── CLIENT: Resume a cancel-at-period-end subscription ──────────────────────
router.post("/portal/billing/subscriptions/:id/resume", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [cs] = await db.select().from(clientServicesTable)
    .where(and(eq(clientServicesTable.id, id), eq(clientServicesTable.clientUserId, userId)));
  if (!cs) { res.status(404).json({ error: "Subscription not found" }); return; }
  if (!cs.stripeSubscriptionId) {
    res.status(400).json({ error: "No Stripe subscription linked to this service. Please contact support." });
    return;
  }

  let stripeKey: string;
  try { stripeKey = getStripeKey(); } catch (e) { res.status(503).json({ error: (e as Error).message }); return; }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  const sub = await stripe.subscriptions.update(cs.stripeSubscriptionId, {
    cancel_at_period_end: false,
  });

  req.log.info({ clientServiceId: cs.id, subscriptionId: cs.stripeSubscriptionId }, "subscription: cancel_at_period_end cleared (resumed)");

  void createAuditLog({
    actorUserId: userId,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: "retainer_resumed",
    entityType: "service",
    entityId: cs.id,
    entityLabel: String(cs.serviceId),
    clientId: userId,
  });

  const nextPeriodEnd = sub.items.data[0]?.current_period_end ?? null;
  const nextBillingDate = nextPeriodEnd
    ? new Date(nextPeriodEnd * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "your next billing cycle";

  const [svc] = await db.select({ name: servicesTable.name }).from(servicesTable).where(eq(servicesTable.id, cs.serviceId)).limit(1);
  const serviceName = svc?.name ?? "your service";

  void sendAdminSms(
    `Retainer resumed: ${req.user!.name ?? req.user!.email} has un-cancelled their ${serviceName} retainer. Next billing: ${nextBillingDate}.`
  );

  if (req.user!.mspId != null && await canSendAutomatedCustomerEmail(req.user!.mspId)) {
    void sendEmailFromTemplate(
      "retainer-resumed",
      req.user!.email,
      { clientName: req.user!.name ?? "", serviceName, nextBillingDate, portalLink: getMspPortalBaseUrl(), tenantHealthBlockHtml: await getTenantHealthBlockHtml(req.user!.id) },
      `Your ${serviceName} retainer is back on`,
      retainerResumedEmail({ clientName: req.user!.name ?? "", serviceName, nextBillingDate }),
    );
  }

  res.json({
    ok: true,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    cancelAt: sub.cancel_at ?? null,
    currentPeriodEnd: nextPeriodEnd,
  });
});

// ─── CLIENT: Billing portal (manage payment method) ──────────────────────────
router.post("/portal/billing/customer-portal", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  let stripeKey: string;
  try { stripeKey = getStripeKey(); } catch (e) { res.status(503).json({ error: (e as Error).message }); return; }

  // Find any active Stripe subscription for this client to resolve the customer
  const [cs] = await db.select().from(clientServicesTable)
    .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
    .where(
      and(
        eq(clientServicesTable.clientUserId, userId),
        eq(servicesTable.billingType, "recurring_monthly"),
        isNotNull(clientServicesTable.stripeSubscriptionId),
      )
    )
    .orderBy(desc(clientServicesTable.purchasedAt))
    .limit(1);

  if (!cs || !cs.client_services.stripeSubscriptionId) {
    res.status(404).json({ error: "No active subscription found." });
    return;
  }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  const sub = await stripe.subscriptions.retrieve(cs.client_services.stripeSubscriptionId, {
    expand: ["customer"],
  });

  const customer = sub.customer;
  if (!customer || typeof customer === "string" || customer.deleted) {
    res.status(404).json({ error: "Stripe customer not found." });
    return;
  }

  const baseUrl = req.headers.origin ?? `${req.protocol}://${req.hostname}`;
  const session = await stripe.billingPortal.sessions.create({
    customer: customer.id,
    return_url: `${baseUrl}/crm/portal/billing`,
  });

  req.log.info({ userId, customerId: customer.id }, "billing-portal: session created");
  res.json({ url: session.url });
});

// ─── CLIENT: Re-subscribe (new checkout for a canceled subscription) ──────────
router.post("/portal/billing/subscriptions/:id/resubscribe", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [row] = await db.select({ cs: clientServicesTable, svc: servicesTable })
    .from(clientServicesTable)
    .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
    .where(and(eq(clientServicesTable.id, id), eq(clientServicesTable.clientUserId, userId)));

  if (!row) { res.status(404).json({ error: "Subscription not found" }); return; }

  if (!row.svc.price) {
    res.status(400).json({ error: "Service has no price configured. Please contact support." });
    return;
  }

  let stripeKey: string;
  try { stripeKey = getStripeKey(); } catch (e) { res.status(503).json({ error: (e as Error).message }); return; }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  const [resubUserProfile] = await db.select({
    email: usersTable.email,
    name: usersTable.name,
    address: usersTable.address,
    addressCity: usersTable.addressCity,
    addressState: usersTable.addressState,
    addressZip: usersTable.addressZip,
  }).from(usersTable).where(eq(usersTable.id, userId));

  const resubCustomerId = resubUserProfile
    ? await getOrCreateStripeCustomer(stripe, resubUserProfile)
    : undefined;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    customer: resubCustomerId,
    billing_address_collection: "required",
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: { name: row.svc.name, description: row.svc.description ?? undefined },
        unit_amount: Math.round(parseFloat(String(row.svc.price)) * 100),
        recurring: { interval: "month" as const },
      },
      quantity: 1,
    }],
    mode: "subscription",
    success_url: `${getMspPortalBaseUrl()}/billing?payment=success`,
    cancel_url: `${getMspPortalBaseUrl()}/billing?payment=cancelled`,
    metadata: {
      type: "onboarding_purchase",
      userId: String(userId),
      serviceIds: String(row.svc.id),
      contractIds: "",
      serviceName: row.svc.name,
      startDate: new Date().toISOString(),
      servicePrices: parseFloat(String(row.svc.price)).toFixed(2),
    },
  });

  req.log.info({ userId, clientServiceId: id, serviceId: row.svc.id }, "resubscribe: checkout session created");
  res.json({ url: session.url });
});

export default router;
