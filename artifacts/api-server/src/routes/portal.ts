import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectsTable, clientServicesTable, servicesTable, workflowStepsTable, kanbanTasksTable, documentsTable, reportsTable, invoicesTable, messagesTable, notificationsTable, projectUpdatesTable, usersTable, contractsTable, passwordResetTokensTable, workflowTemplateStepsTable, workflowTemplateStepTasksTable, contractTemplatesTable, impersonationTokensTable, statusReportsTable, deviceTokensTable, projectClosuresTable, auditLogsTable, instructionSetsTable, checklistsTable, artifactSetsTable, deliverableSetsTable, emailsTable, emailDomainRulesTable, clientM365ProfilesTable, couponsTable, clientAppRegistrationsTable, accountSetupTokensTable, mfaEnrollmentsTable, mfaChallengesTable, webauthnCredentialsTable, webauthnChallengesTable, clientHealthHistoryTable, quizLeadsTable, scriptRunResultsTable, powershellScriptsTable, clientScoresTable, clientAutomationRunsTable, scriptPackagesTable, scriptModulesTable } from "@workspace/db";
import { eq, and, desc, asc, count, sql, inArray, gte, isNotNull, isNull, or, lt } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";
import jwt from "jsonwebtoken";
import { sendEmail, sendEmailFromTemplate, getEmailTemplateOrFallback, purchaseConfirmationEmail, onboardingConfirmationEmail, adminPurchaseAlertEmail, closureRequestEmail, statusReportReplyEmail, clientThreadReplyEmail, adminThreadReplyEmail, retainerResumedEmail, appRegExpiryAlertEmail, brandedEmail, PORTAL_URL } from "../lib/mailer";
import { sendAdminSms } from "../lib/sms";
import { sendPushNotifications } from "../lib/push";
import { createAuditLog } from "../lib/audit";
import { getStripeKey } from "../lib/stripe";
import { listDriveItems, graphCredentialsPresent, createProjectFolder, uploadFileToClientContracts, getDriveItemDownloadUrl } from "../lib/graph";
import { setSecretValue, getSecretValue, getSecretMetadata } from "../lib/azure-keyvault";
import { testClientCredentials } from "../lib/azure-credentials";
import { runClientScriptSequence } from "../lib/client-script-sequence";
import { uploadInvoiceToSharePoint } from "../lib/invoice-sharepoint";
import { getPortalBaseUrl } from "../lib/portal-url";
import { generateM365ProfilePdf } from "../lib/m365-profile-pdf";
import { generateManualScriptPackage } from "../lib/manual-script-package";
import { logger } from "../lib/logger";
import multer from "multer";
import path from "path";
import fs from "fs";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { Readable } from "stream";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Upsert a client account keyed by email. Returns the user id. */
async function ensureClientAccount(email: string, name?: string): Promise<{ id: number }> {
  const normalizedEmail = email.toLowerCase().trim();
  // Atomic upsert — if the email already exists the ON CONFLICT clause returns
  // the existing row without modifying anything, making this race-safe under
  // concurrent Stripe webhook + success-page double-firing.
  const [upserted] = await db
    .insert(usersTable)
    .values({ email: normalizedEmail, role: "client", name: name?.trim() || undefined })
    .onConflictDoUpdate({
      target: usersTable.email,
      set: { email: sql`EXCLUDED.email` }, // no-op — forces RETURNING to yield the existing row
    })
    .returning({ id: usersTable.id });
  return { id: upserted.id };
}

/**
 * Atomically finds or creates an account-setup token for a freshly-provisioned client.
 *
 * Uses a PostgreSQL advisory lock (namespace 0xACCT=43083, key=userId) scoped to the
 * surrounding transaction so that concurrent webhook + success-page calls for the same
 * user are serialized at the DB level — producing exactly one valid token and ensuring
 * the setup email is sent only once.
 *
 * Returns { token, isNew } where isNew=true means this invocation created the token
 * (i.e. the caller owns responsibility for sending the account-setup email).
 */
async function ensureClientSetupToken(userId: number): Promise<{ token: string; isNew: boolean }> {
  return db.transaction(async (tx) => {
    // Advisory lock: namespace 43083 (0xACCT) + userId.
    // Two concurrent calls with the same userId block here until the first commits.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(43083, ${userId})`);

    const now = new Date();
    const [existing] = await tx
      .select({ token: accountSetupTokensTable.token })
      .from(accountSetupTokensTable)
      .where(
        and(
          eq(accountSetupTokensTable.userId, userId),
          gte(accountSetupTokensTable.expiresAt, now),
          isNull(accountSetupTokensTable.usedAt),
        ),
      )
      .limit(1);

    if (existing) return { token: existing.token, isNew: false };

    // Purge stale (expired or already-used) tokens before creating a fresh one
    // to prevent unbounded accumulation from repeated purchases.
    await tx.delete(accountSetupTokensTable)
      .where(
        and(
          eq(accountSetupTokensTable.userId, userId),
          or(
            lt(accountSetupTokensTable.expiresAt, now),
            isNotNull(accountSetupTokensTable.usedAt),
          ),
        ),
      );

    const { randomBytes } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    await tx.insert(accountSetupTokensTable).values({ userId, token, expiresAt });
    return { token, isNew: true };
  });
}

/**
 * Returns the number of messages that Shane has not yet read.
 * Used to set the iOS app icon badge count in outgoing push payloads so that
 * consecutive background pushes show 2, 3, … rather than always 1.
 */
/** Resolve FK-linked asset library content for a set of template tasks.
 *  Returns an array of taskMetadata objects ready to be inserted into kanbanTasksTable.
 */
async function resolveTemplateTaskMetadata(
  templateTasks: Array<{
    instructionSetId?: number | null;
    checklistId?: number | null;
    artifactsId?: number | null;
    deliverablesId?: number | null;
    instructions?: unknown;
    checklist?: unknown;
    artifactsProduced?: unknown;
    clientDeliverables?: unknown;
    runbookId?: string | null;
  }>
): Promise<Array<{
  instructions: string[];
  checklist: Array<{ id: string; label: string }>;
  artifactsProduced: string[];
  clientDeliverables: string[];
  checklistState: Record<string, never>;
  uploadedArtifacts: never[];
  linkedRunbook: { scriptId: string; azureRunbookName: string; scriptTitle: string } | null;
}>> {
  const linkedInstrIds = [...new Set(templateTasks.map(t => t.instructionSetId).filter((id): id is number => id !== null && id !== undefined))];
  const linkedClIds = [...new Set(templateTasks.map(t => t.checklistId).filter((id): id is number => id !== null && id !== undefined))];
  const linkedArtIds = [...new Set(templateTasks.map(t => t.artifactsId).filter((id): id is number => id !== null && id !== undefined))];
  const linkedDelIds = [...new Set(templateTasks.map(t => t.deliverablesId).filter((id): id is number => id !== null && id !== undefined))];
  const linkedRunbookIds = [...new Set(templateTasks.map(t => t.runbookId).filter((id): id is string => !!id))];

  const [instrRows, clRows, artRows, delRows, runbookRows] = await Promise.all([
    linkedInstrIds.length > 0 ? db.select().from(instructionSetsTable).where(inArray(instructionSetsTable.id, linkedInstrIds)) : Promise.resolve([]),
    linkedClIds.length > 0 ? db.select().from(checklistsTable).where(inArray(checklistsTable.id, linkedClIds)) : Promise.resolve([]),
    linkedArtIds.length > 0 ? db.select().from(artifactSetsTable).where(inArray(artifactSetsTable.id, linkedArtIds)) : Promise.resolve([]),
    linkedDelIds.length > 0 ? db.select().from(deliverableSetsTable).where(inArray(deliverableSetsTable.id, linkedDelIds)) : Promise.resolve([]),
    linkedRunbookIds.length > 0
      ? db.select({ id: powershellScriptsTable.id, title: powershellScriptsTable.title, azureRunbookName: powershellScriptsTable.azureRunbookName })
          .from(powershellScriptsTable).where(inArray(powershellScriptsTable.azureRunbookName, linkedRunbookIds))
      : Promise.resolve([]),
  ]);

  const instrMap = new Map(instrRows.map(r => [r.id, r.instructions as string[]]));
  const clMap = new Map(clRows.map(r => [r.id, r.items as Array<{ id: string; label: string }>]));
  const artMap = new Map(artRows.map(r => [r.id, r.artifacts as string[]]));
  const delMap = new Map(delRows.map(r => [r.id, r.deliverables as string[]]));
  // runbookId column now stores the Azure runbook name (text), so key the map by azureRunbookName
  const runbookMap = new Map(runbookRows.map(r => [r.azureRunbookName, r]));

  return templateTasks.map(t => {
    const runbook = t.runbookId ? runbookMap.get(t.runbookId) : undefined;
    return {
      instructions: t.instructionSetId ? (instrMap.get(t.instructionSetId) ?? (t.instructions as string[] | null) ?? []) : ((t.instructions as string[] | null) ?? []),
      checklist: t.checklistId ? (clMap.get(t.checklistId) ?? (t.checklist as Array<{ id: string; label: string }> | null) ?? []) : ((t.checklist as Array<{ id: string; label: string }> | null) ?? []),
      artifactsProduced: t.artifactsId ? (artMap.get(t.artifactsId) ?? (t.artifactsProduced as string[] | null) ?? []) : ((t.artifactsProduced as string[] | null) ?? []),
      clientDeliverables: t.deliverablesId ? (delMap.get(t.deliverablesId) ?? (t.clientDeliverables as string[] | null) ?? []) : ((t.clientDeliverables as string[] | null) ?? []),
      checklistState: {} as Record<string, never>,
      uploadedArtifacts: [] as never[],
      linkedRunbook: runbook && runbook.azureRunbookName
        ? { scriptId: runbook.id, azureRunbookName: runbook.azureRunbookName, scriptTitle: runbook.title }
        : null,
    };
  });
}

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

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("../../data/uploads");

const docStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOADS_BASE, "documents");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const reportStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOADS_BASE, "reports");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const invoiceStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOADS_BASE, "invoices");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const uploadDoc = multer({ storage: docStorage, limits: { fileSize: 50 * 1024 * 1024 } });
const uploadReport = multer({ storage: reportStorage, limits: { fileSize: 100 * 1024 * 1024 } });
const uploadInvoice = multer({ storage: invoiceStorage, limits: { fileSize: 20 * 1024 * 1024 } });

/**
 * Resolves a Stripe Customer ID for the given user, creating one if needed.
 * When the user has a saved address, it is applied to the customer so that
 * Stripe Checkout pre-fills the billing address form.
 */
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

// ─── CLIENT: Profile ─────────────────────────────────────────────────────────
router.get("/portal/profile", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [profile] = await db.select({
    name: usersTable.name,
    email: usersTable.email,
    company: usersTable.company,
    phone: usersTable.phone,
    address: usersTable.address,
    addressCity: usersTable.addressCity,
    addressState: usersTable.addressState,
    addressZip: usersTable.addressZip,
  }).from(usersTable).where(eq(usersTable.id, userId));
  if (!profile) { res.status(404).json({ error: "User not found" }); return; }
  res.json(profile);
});

router.patch("/portal/profile", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { name, company, phone, address, addressCity, addressState, addressZip } = req.body as {
    name?: string; company?: string; phone?: string; address?: string;
    addressCity?: string; addressState?: string; addressZip?: string;
  };

  const updates: Partial<{
    name: string | null; company: string | null; phone: string | null; address: string | null;
    addressCity: string | null; addressState: string | null; addressZip: string | null;
  }> = {};
  if (name !== undefined) updates.name = name.trim() || null;
  if (company !== undefined) updates.company = company.trim() || null;
  if (phone !== undefined) updates.phone = phone.trim() || null;
  if (address !== undefined) updates.address = address.trim() || null;
  if (addressCity !== undefined) updates.addressCity = addressCity.trim() || null;
  if (addressState !== undefined) updates.addressState = addressState.trim() || null;
  if (addressZip !== undefined) updates.addressZip = addressZip.trim() || null;

  if (Object.keys(updates).length === 0) {
    res.json({ ok: true });
    return;
  }

  await db.update(usersTable).set(updates).where(eq(usersTable.id, userId));
  res.json({ ok: true });
});

// ─── CLIENT: M365 Profile (self-service) ─────────────────────────────────────
router.get("/portal/m365-profile", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [row] = await db.select().from(clientM365ProfilesTable).where(eq(clientM365ProfilesTable.clientId, userId));
  res.json(row ? row.profile : {});
});

// ── M365 score computation (mirrors frontend boolScore logic) ─────────────────
function m365BoolScore(fields: (boolean | undefined)[]): number {
  if (fields.length === 0) return 0;
  return Math.round((fields.filter(f => f === true).length / fields.length) * 100);
}

type M365ScoreCategory = "security" | "compliance" | "copilot" | "governance" | "productivity";

function computeM365Scores(profile: Record<string, unknown>): Record<M365ScoreCategory, number> {
  const v = profile as {
    mfaEnforced?: boolean; conditionalAccessEnabled?: boolean; intuneEnabled?: boolean;
    hasAADP1orP2?: boolean; hasDefender?: boolean; hasDLP?: boolean; usesComplianceCenter?: boolean;
    sensitivityLabelsConfigured?: boolean; hasRetentionPolicies?: boolean; hasInsiderRisk?: boolean;
    hasCopilotLicenses?: boolean; activeUserPercent?: string; allUsersLicensed?: boolean;
  };
  const pct = parseInt(v.activeUserPercent ?? "0", 10);
  return {
    security: m365BoolScore([v.mfaEnforced, v.conditionalAccessEnabled, v.intuneEnabled, v.hasAADP1orP2, v.hasDefender, v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured, v.hasRetentionPolicies]),
    compliance: m365BoolScore([v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured, v.hasRetentionPolicies, v.hasInsiderRisk]),
    copilot: m365BoolScore([v.hasCopilotLicenses, v.mfaEnforced, v.sensitivityLabelsConfigured, v.hasDLP, v.hasRetentionPolicies]),
    governance: m365BoolScore([v.hasRetentionPolicies, v.sensitivityLabelsConfigured, v.usesComplianceCenter, v.conditionalAccessEnabled]),
    productivity: Math.min((isNaN(pct) ? 60 : pct) + (v.allUsersLicensed ? 10 : 0), 100),
  };
}

router.put("/portal/m365-profile", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const profile = req.body as Record<string, unknown>;
  await db.insert(clientM365ProfilesTable)
    .values({ clientId: userId, profile })
    .onConflictDoUpdate({ target: clientM365ProfilesTable.clientId, set: { profile, updatedAt: new Date() } });

  // Compute scores and save snapshot if anything changed
  try {
    const scores = computeM365Scores(profile);
    // Fetch most recent snapshot per category (last 10 rows covers all 5 categories twice over)
    const recentRows = await db
      .select({ category: clientHealthHistoryTable.category, score: clientHealthHistoryTable.score })
      .from(clientHealthHistoryTable)
      .where(eq(clientHealthHistoryTable.clientId, userId))
      .orderBy(desc(clientHealthHistoryTable.recordedAt))
      .limit(10);
    // Build map: category → most recent score
    const latestByCategory: Partial<Record<M365ScoreCategory, number>> = {};
    for (const row of recentRows) {
      const cat = row.category as M365ScoreCategory;
      if (!(cat in latestByCategory)) latestByCategory[cat] = row.score;
    }
    const hasChanged = (Object.entries(scores) as [M365ScoreCategory, number][])
      .some(([cat, score]) => latestByCategory[cat] !== score);
    if (hasChanged) {
      const now = new Date();
      await db.insert(clientHealthHistoryTable).values(
        (Object.entries(scores) as [M365ScoreCategory, number][]).map(([category, score]) => ({
          clientId: userId,
          category,
          score,
          recordedAt: now,
        }))
      );
    }
  } catch (err) {
    req.log.warn({ err }, "m365-profile: failed to save health snapshot (non-fatal)");
  }

  res.json({ ok: true });
});

// ── Portal: quiz results for the current client ───────────────────────────────
router.get("/portal/quiz-results", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.json([]); return; }

  const rows = await db
    .select({
      id: quizLeadsTable.id,
      quizType: quizLeadsTable.quizType,
      totalScore: quizLeadsTable.totalScore,
      tier: quizLeadsTable.tier,
      categoryScores: quizLeadsTable.categoryScores,
      createdAt: quizLeadsTable.createdAt,
    })
    .from(quizLeadsTable)
    .where(eq(quizLeadsTable.email, user.email))
    .orderBy(desc(quizLeadsTable.createdAt));

  res.json(rows);
});

// ── M365 scorecard history — first vs latest per category ─────────────────────
router.get("/portal/m365-scorecard-history", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const rows = await db
    .select({ category: clientHealthHistoryTable.category, score: clientHealthHistoryTable.score, recordedAt: clientHealthHistoryTable.recordedAt })
    .from(clientHealthHistoryTable)
    .where(eq(clientHealthHistoryTable.clientId, userId))
    .orderBy(asc(clientHealthHistoryTable.recordedAt));

  if (rows.length === 0) {
    res.json({ hasData: false });
    return;
  }

  const CATS: M365ScoreCategory[] = ["security", "compliance", "copilot", "governance", "productivity"];
  const first: Partial<Record<M365ScoreCategory, number>> = {};
  const latest: Partial<Record<M365ScoreCategory, number>> = {};
  let firstDate: Date | null = null;
  let latestDate: Date | null = null;

  for (const cat of CATS) {
    const catRows = rows.filter(r => r.category === cat);
    if (catRows.length === 0) continue;
    first[cat] = catRows[0].score;
    latest[cat] = catRows[catRows.length - 1].score;
    if (!firstDate || catRows[0].recordedAt < firstDate) firstDate = catRows[0].recordedAt;
    if (!latestDate || catRows[catRows.length - 1].recordedAt > latestDate) latestDate = catRows[catRows.length - 1].recordedAt;
  }

  res.json({ hasData: true, firstDate: firstDate?.toISOString(), latestDate: latestDate?.toISOString(), first, latest });
});

router.get("/portal/health/summary", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const ALL_CATEGORY_LABELS: Record<string, string> = {
    security: "Security Posture",
    compliance: "Compliance Coverage",
    copilot: "Copilot Readiness",
    governance: "Governance Maturity",
    productivity: "Adoption Score",
    identity: "Identity Protection",
    collaboration: "Collaboration Score",
    data: "Data Governance",
  };

  const rows = await db
    .select({ category: clientHealthHistoryTable.category, score: clientHealthHistoryTable.score, recordedAt: clientHealthHistoryTable.recordedAt })
    .from(clientHealthHistoryTable)
    .where(eq(clientHealthHistoryTable.clientId, userId))
    .orderBy(asc(clientHealthHistoryTable.recordedAt));

  if (rows.length === 0) {
    res.json({ hasData: false });
    return;
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Discover all categories actually present in the data (handles all 8 schema categories)
  const allCats = [...new Set(rows.map(r => r.category))].sort();

  const categories = allCats.map(cat => {
    const catRows = rows.filter(r => r.category === cat);
    const first = catRows[0].score;
    const latest = catRows[catRows.length - 1].score;
    const recentRows = catRows.filter(r => r.recordedAt >= thirtyDaysAgo);
    const hasAlert = recentRows.length >= 2 &&
      Math.abs(recentRows[recentRows.length - 1].score - recentRows[0].score) >= 10;
    return { key: cat, label: ALL_CATEGORY_LABELS[cat] ?? cat, firstScore: first, latestScore: latest, delta: latest - first, hasAlert };
  });

  const overallFirst = categories.length > 0
    ? Math.round(categories.reduce((s, c) => s + c.firstScore, 0) / categories.length)
    : 0;
  const overallLatest = categories.length > 0
    ? Math.round(categories.reduce((s, c) => s + c.latestScore, 0) / categories.length)
    : 0;

  // Time-series: group all rows by day and average across all present categories
  const dayMap = new Map<string, number[]>();
  for (const row of rows) {
    const day = row.recordedAt.toISOString().slice(0, 10);
    if (!dayMap.has(day)) dayMap.set(day, []);
    dayMap.get(day)!.push(row.score);
  }
  const timeSeries = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, scores]) => ({
      date,
      score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    }));

  const lastUpdated = rows[rows.length - 1].recordedAt.toISOString();

  res.json({
    hasData: true,
    overallFirst,
    overallLatest,
    overallDelta: overallLatest - overallFirst,
    lastUpdated,
    timeSeries,
    categories,
  });
});

// ─── CLIENT: App Registration (Azure automation credentials) ─────────────────
router.get("/portal/app-registration", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [row] = await db.select().from(clientAppRegistrationsTable)
    .where(eq(clientAppRegistrationsTable.clientUserId, userId));
  if (!row) { res.json(null); return; }
  res.json({
    status: row.status,
    tenantId: row.tenantId,
    azureClientId: row.azureClientId,
    submittedAt: row.submittedAt,
    verifiedAt: row.verifiedAt,
    connectionTestedAt: row.connectionTestedAt,
  });
});

router.put("/portal/app-registration", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { tenantId, azureClientId, clientSecret } = req.body as {
    tenantId?: string;
    azureClientId?: string;
    clientSecret?: string;
  };

  if (!tenantId?.trim() || !azureClientId?.trim() || !clientSecret?.trim()) {
    res.status(400).json({ error: "tenantId, azureClientId, and clientSecret are required" });
    return;
  }

  // ── Step 1: Live credential test BEFORE storing anything ──────────────────
  const testResult = await testClientCredentials(
    tenantId.trim(),
    azureClientId.trim(),
    clientSecret.trim(),
  );

  if (!testResult.ok) {
    req.log.warn({ userId, tenantId: tenantId.trim(), azureClientId: azureClientId.trim() }, "portal/app-registration: credential test failed");
    res.status(422).json({ error: testResult.reason });
    return;
  }

  // ── Step 2: Credentials valid — store in Key Vault ────────────────────────
  const kvSecretName = `client-${userId}-app-secret`;

  try {
    await setSecretValue(kvSecretName, clientSecret.trim());
  } catch (err) {
    req.log.error({ err }, "portal/app-registration: failed to store secret in Key Vault");
    res.status(503).json({ error: "Could not store credentials in Azure Key Vault. Please verify Key Vault is configured and try again." });
    return;
  }

  // ── Step 3: Upsert record as verified immediately ─────────────────────────
  const now = new Date();
  await db.insert(clientAppRegistrationsTable)
    .values({
      clientUserId: userId,
      tenantId: tenantId.trim(),
      azureClientId: azureClientId.trim(),
      keyVaultSecretName: kvSecretName,
      status: "verified",
      submittedAt: now,
      verifiedAt: now,
      connectionTestedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: clientAppRegistrationsTable.clientUserId,
      set: {
        tenantId: tenantId.trim(),
        azureClientId: azureClientId.trim(),
        keyVaultSecretName: kvSecretName,
        status: "verified",
        submittedAt: now,
        verifiedAt: now,
        connectionTestedAt: now,
        updatedAt: now,
      },
    });

  res.json({
    status: "verified",
    tenantId: tenantId.trim(),
    azureClientId: azureClientId.trim(),
    submittedAt: now,
    verifiedAt: now,
    connectionTestedAt: now,
  });

  // ── Step 4: Fire-and-forget sequential script run ─────────────────────────
  // Insert a run record first so the progress endpoint has something to show
  // before the sequence starts.
  db.insert(clientAutomationRunsTable)
    .values({ clientUserId: userId, status: "pending" })
    .returning({ id: clientAutomationRunsTable.id })
    .then(([run]) => {
      if (!run) return;
      runClientScriptSequence(userId, run.id).catch(err => {
        req.log.error({ err, userId, runId: run.id }, "portal/app-registration: script sequence error");
      });
    })
    .catch(err => {
      req.log.error({ err, userId }, "portal/app-registration: failed to insert automation run record");
    });
});

// ─── Client: Automation progress ──────────────────────────────────────────────
router.get("/portal/automation-progress", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [run] = await db.select()
    .from(clientAutomationRunsTable)
    .where(eq(clientAutomationRunsTable.clientUserId, userId))
    .orderBy(desc(clientAutomationRunsTable.triggeredAt))
    .limit(1);

  if (!run) { res.json({ status: "idle" }); return; }

  // Resolve current package/module names for richer UI display
  let currentPackageName: string | null = null;
  let currentModuleName: string | null = null;
  if (run.currentPackageId) {
    const [pkg] = await db.select({ title: scriptPackagesTable.title })
      .from(scriptPackagesTable)
      .where(eq(scriptPackagesTable.id, run.currentPackageId));
    currentPackageName = pkg?.title ?? null;
  }
  if (run.currentModuleId) {
    const [mod] = await db.select({ filename: scriptModulesTable.filename })
      .from(scriptModulesTable)
      .where(eq(scriptModulesTable.id, run.currentModuleId));
    currentModuleName = mod?.filename ?? null;
  }

  res.json({
    id: run.id,
    status: run.status,
    modulesCompleted: run.modulesCompleted,
    modulesTotal: run.modulesTotal,
    lastLogSnippet: run.lastLogSnippet,
    errorMessage: run.errorMessage,
    triggeredAt: run.triggeredAt,
    finishedAt: run.finishedAt,
    currentPackageName,
    currentModuleName,
  });
});

// ─── Onboarding wizard status ─────────────────────────────────────────────────
router.get("/portal/onboarding/wizard-status", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const [user] = await db.select({ onboardingWizardCompletedAt: usersTable.onboardingWizardCompletedAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (user.onboardingWizardCompletedAt !== null) {
    res.json({ needsOnboarding: false });
    return;
  }

  // Check for any existing M365 profile data — if present, treat as already onboarded
  const [profile] = await db.select({ id: clientM365ProfilesTable.clientId })
    .from(clientM365ProfilesTable)
    .where(eq(clientM365ProfilesTable.clientId, userId));

  res.json({ needsOnboarding: !profile });
});

// ─── Onboarding wizard complete ───────────────────────────────────────────────
router.post("/portal/onboarding/complete", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const now = new Date();

  await db.update(usersTable)
    .set({ onboardingWizardCompletedAt: now })
    .where(eq(usersTable.id, userId));

  res.json({ completedAt: now.toISOString() });
});

// ─── Onboarding wizard reset ──────────────────────────────────────────────────
router.post("/portal/onboarding/wizard-reset", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  await db.update(usersTable)
    .set({ onboardingWizardCompletedAt: null })
    .where(eq(usersTable.id, userId));

  res.json({ reset: true });
});

// ─── ADMIN: Mark client App Registration as verified ─────────────────────────
router.patch("/admin/clients/:id/app-registration", requireAdmin, async (req: Request, res: Response) => {
  const clientId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid client ID" }); return; }

  const { status } = req.body as { status?: string };
  if (status !== "verified" && status !== "submitted" && status !== "pending") {
    res.status(400).json({ error: "status must be pending, submitted, or verified" });
    return;
  }

  const now = new Date();
  const [existing] = await db.select().from(clientAppRegistrationsTable)
    .where(eq(clientAppRegistrationsTable.clientUserId, clientId));

  if (!existing) { res.status(404).json({ error: "No App Registration found for this client" }); return; }

  // Fetch client name for audit log label
  const [clientUser] = await db.select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.id, clientId)).limit(1);
  const clientLabel = clientUser?.name ?? clientUser?.email ?? String(clientId);

  // When marking as verified, test the credentials against Azure first
  if (status === "verified") {
    let testResult: { ok: true } | { ok: false; reason: string };
    try {
      const clientSecret = await getSecretValue(existing.keyVaultSecretName);
      testResult = await testClientCredentials(existing.tenantId, existing.azureClientId, clientSecret);
    } catch (err) {
      req.log.warn({ err, clientId }, "app-registration verify: failed to retrieve secret from Key Vault");
      res.status(503).json({ error: "Could not retrieve credentials from Key Vault. Check Key Vault access and try again." });
      return;
    }
    if (!testResult.ok) {
      req.log.warn({ clientId, reason: testResult.reason }, "app-registration verify: Azure credential test failed");
      void createAuditLog({
        actorUserId: req.user!.id,
        actorName: req.user!.name ?? req.user!.email,
        actorRole: "admin",
        actionType: "credential_verification_failed",
        entityType: "app_registration",
        entityId: clientId,
        entityLabel: clientLabel,
        clientId,
        metadata: {
          tenantId: existing.tenantId,
          azureClientId: existing.azureClientId,
          outcome: "failed",
          errorMessage: testResult.reason.slice(0, 500),
        },
      });
      res.status(400).json({ error: testResult.reason });
      return;
    }
  }

  const updates: Partial<typeof clientAppRegistrationsTable.$inferInsert> = {
    status: status as "pending" | "submitted" | "verified",
    updatedAt: now,
  };
  if (status === "verified") { updates.verifiedAt = now; updates.connectionTestedAt = now; }
  if (status !== "verified") updates.verifiedAt = null;

  await db.update(clientAppRegistrationsTable)
    .set(updates)
    .where(eq(clientAppRegistrationsTable.clientUserId, clientId));

  // After a successful verification, read the Key Vault secret expiry
  // and send Shane an email alert if it expires within 30 days.
  if (status === "verified") {
    void createAuditLog({
      actorUserId: req.user!.id,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: "admin",
      actionType: "credential_verification_passed",
      entityType: "app_registration",
      entityId: clientId,
      entityLabel: clientLabel,
      clientId,
      metadata: {
        tenantId: existing.tenantId,
        azureClientId: existing.azureClientId,
        outcome: "passed",
        verifiedAt: now.toISOString(),
      },
    });

    try {
      const meta = await getSecretMetadata(existing.keyVaultSecretName);
      if (meta.expiresOn) {
        const daysLeft = Math.ceil((meta.expiresOn.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        const EMAIL_ALERT_THRESHOLD_DAYS = 30;
        if (daysLeft <= EMAIL_ALERT_THRESHOLD_DAYS) {
          const adminEmail = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
          if (adminEmail) {
            const adminPanelOrigin = process.env.REPLIT_DOMAINS
              ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
              : "http://localhost:80";
            const adminPanelUrl = `${adminPanelOrigin}/admin-panel/crm/clients/${clientId}`;
            void sendEmail(
              adminEmail,
              daysLeft <= 0
                ? `⚠️ App Registration secret EXPIRED — ${clientLabel}`
                : `⚠️ App Registration secret expiring in ${daysLeft} day${daysLeft !== 1 ? "s" : ""} — ${clientLabel}`,
              brandedEmail(appRegExpiryAlertEmail({
                clientName: clientUser?.name ?? "",
                clientEmail: clientUser?.email ?? "",
                tenantId: existing.tenantId,
                azureClientId: existing.azureClientId,
                expiresOn: meta.expiresOn,
                daysLeft,
                adminPanelUrl,
              })),
            );
            req.log.info({ clientId, daysLeft }, "app-registration: sent expiry alert email to admin");
          }
        }
      }
    } catch (err) {
      req.log.warn({ err, clientId }, "app-registration: could not read secret metadata for expiry check");
    }
  }

  res.json({ ok: true, status });
});

// ─── ADMIN: Get client App Registration status ────────────────────────────────
router.get("/admin/clients/:id/app-registration", requireAdmin, async (req: Request, res: Response) => {
  const clientId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid client ID" }); return; }

  const [row] = await db.select().from(clientAppRegistrationsTable)
    .where(eq(clientAppRegistrationsTable.clientUserId, clientId));

  if (!row) { res.json(null); return; }

  // Best-effort: read secret expiry from Key Vault metadata.
  // Fails gracefully (expiresOn: null) if Azure is not configured or the secret is gone.
  let expiresOn: string | null = null;
  try {
    const meta = await getSecretMetadata(row.keyVaultSecretName);
    expiresOn = meta.expiresOn ? meta.expiresOn.toISOString() : null;
  } catch (err) {
    req.log.warn({ err, clientId }, "app-registration GET: could not read secret metadata");
  }

  res.json({
    status: row.status,
    tenantId: row.tenantId,
    azureClientId: row.azureClientId,
    keyVaultSecretName: row.keyVaultSecretName,
    submittedAt: row.submittedAt,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresOn,
  });
});

// ─── CLIENT: Dashboard summary ───────────────────────────────────────────────
router.get("/portal/dashboard", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const projects = await db.select().from(projectsTable)
    .where(and(eq(projectsTable.clientUserId, userId), eq(projectsTable.status, "active")))
    .orderBy(desc(projectsTable.updatedAt)).limit(5);

  const clientServices = await db.select({
    cs: clientServicesTable,
    service: servicesTable,
  }).from(clientServicesTable)
    .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
    .where(and(eq(clientServicesTable.clientUserId, userId), eq(clientServicesTable.status, "active")))
    .orderBy(desc(clientServicesTable.purchasedAt)).limit(6);

  const invoices = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.clientUserId, userId))
    .orderBy(desc(invoicesTable.createdAt)).limit(5);

  const reports = await db.select().from(reportsTable)
    .where(eq(reportsTable.clientUserId, userId))
    .orderBy(desc(reportsTable.createdAt)).limit(3);

  const [{ unread }] = await db.select({ unread: count() }).from(notificationsTable)
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, false)));

  const [{ unreadMessages }] = await db.select({ unreadMessages: count() }).from(messagesTable)
    .where(and(eq(messagesTable.clientUserId, userId), eq(messagesTable.readByClient, false)));

  res.json({ projects, clientServices, invoices, reports, unreadNotifications: unread, unreadMessages });
});

// ─── CLIENT: Projects ────────────────────────────────────────────────────────
router.get("/portal/projects", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const projects = await db.select().from(projectsTable)
    .where(eq(projectsTable.clientUserId, userId))
    .orderBy(desc(projectsTable.createdAt));

  if (projects.length === 0) { res.json([]); return; }

  const projectIds = projects.map(p => p.id);
  const allSteps = await db.select().from(workflowStepsTable)
    .where(inArray(workflowStepsTable.projectId, projectIds))
    .orderBy(asc(workflowStepsTable.order));

  const stepsByProject = new Map<number, typeof allSteps>();
  for (const s of allSteps) {
    if (!stepsByProject.has(s.projectId!)) stepsByProject.set(s.projectId!, []);
    stepsByProject.get(s.projectId!)!.push(s);
  }

  const enriched = projects.map(p => {
    const steps = stepsByProject.get(p.id) ?? [];
    const currentStep = steps.find(s => s.status === "in_progress") ?? steps.find(s => s.status === "pending") ?? steps[steps.length - 1];
    const currentStepIndex = currentStep ? steps.indexOf(currentStep) : steps.length - 1;
    const completedSteps = steps.filter(s => s.status === "completed").length;
    const computedProgress = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : p.progress;
    return {
      ...p,
      progress: computedProgress,
      stepCount: steps.length,
      currentStepIndex,
      currentStepTitle: currentStep?.title ?? null,
      steps: steps.map(s => ({ id: s.id, title: s.title, status: s.status, order: s.order })),
    };
  });

  res.json(enriched);
});

router.post("/portal/projects/:id/signoff", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const [project] = await db
    .select({ id: projectsTable.id, status: projectsTable.status, signedOffAt: projectsTable.signedOffAt, clientUserId: projectsTable.clientUserId })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, id), eq(projectsTable.clientUserId, userId)));

  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (project.status !== "completed") { res.status(400).json({ error: "Project is not completed" }); return; }
  if (project.signedOffAt) { res.status(400).json({ error: "Project has already been signed off" }); return; }

  const [updated] = await db
    .update(projectsTable)
    .set({ signedOffAt: new Date(), signedOffBy: userId })
    .where(eq(projectsTable.id, id))
    .returning();

  res.json(updated);
});

router.get("/portal/projects/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const isAdmin = req.user!.role === "admin";
  const [project] = await db.select().from(projectsTable)
    .where(isAdmin ? eq(projectsTable.id, id) : and(eq(projectsTable.id, id), eq(projectsTable.clientUserId, userId)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const steps = await db.select().from(workflowStepsTable)
    .where(eq(workflowStepsTable.projectId, id))
    .orderBy(asc(workflowStepsTable.order));

  const tasks = await db.select().from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.projectId, id))
    .orderBy(asc(kanbanTasksTable.order));

  // For steps that haven't had kanban tasks seeded yet, return their template tasks as a preview
  const seededStepIds = new Set(tasks.map(t => t.workflowStepId).filter(Boolean));
  const unseededSteps = steps.filter(s => s.workflowTemplateStepId && !seededStepIds.has(s.id));
  let previewTasks: Array<{ stepId: number; title: string; groupName: string | null; description: string | null }> = [];
  if (unseededSteps.length > 0) {
    const templateStepIds = unseededSteps.map(s => s.workflowTemplateStepId!);
    const tmplTasks = await db.select().from(workflowTemplateStepTasksTable)
      .where(inArray(workflowTemplateStepTasksTable.workflowTemplateStepId, templateStepIds))
      .orderBy(asc(workflowTemplateStepTasksTable.order));
    // Map each template task back to the project step ID
    const templateStepToProjectStep = new Map(unseededSteps.map(s => [s.workflowTemplateStepId!, s.id]));
    previewTasks = tmplTasks
      .filter(t => templateStepToProjectStep.has(t.workflowTemplateStepId))
      .map(t => ({
        stepId: templateStepToProjectStep.get(t.workflowTemplateStepId)!,
        title: t.title,
        groupName: t.groupName ?? null,
        description: t.description ?? null,
      }));
  }

  const documents = await db.select().from(documentsTable)
    .where(eq(documentsTable.projectId, id))
    .orderBy(desc(documentsTable.createdAt));

  const updates = await db.select().from(projectUpdatesTable)
    .where(eq(projectUpdatesTable.projectId, id))
    .orderBy(desc(projectUpdatesTable.createdAt));

  // Status reports for this project (sent only, visible to client)
  const effectiveUserId = isAdmin ? (project.clientUserId ?? userId) : userId;
  const statusReports = await db.select().from(statusReportsTable)
    .where(and(
      eq(statusReportsTable.projectId, id),
      eq(statusReportsTable.clientUserId, effectiveUserId),
      eq(statusReportsTable.reportStatus, "sent"),
    ))
    .orderBy(desc(statusReportsTable.sentAt));

  // First unacknowledged report = pending banner (pending OR has_questions — only "accepted" clears it)
  const pendingStatusReport = statusReports.find(r => r.clientStatus === "pending" || r.clientStatus === "has_questions") ?? null;

  // Contracts for this project (with SharePoint URLs, local path, and service names)
  const contracts = await db.select({
    id: contractsTable.id,
    signedAt: contractsTable.signedAt,
    signerName: contractsTable.signerName,
    pdfFilename: contractsTable.pdfFilename,
    sharepointFileUrl: contractsTable.sharepointFileUrl,
    sharepointFileId: contractsTable.sharepointFileId,
    localFilePath: contractsTable.localFilePath,
    serviceName: servicesTable.name,
  }).from(contractsTable)
    .innerJoin(servicesTable, eq(contractsTable.serviceId, servicesTable.id))
    .where(eq(contractsTable.projectId, id))
    .orderBy(desc(contractsTable.signedAt));

  const contract = contracts[0] ?? null;

  // Fetch coupon info — sum all discount amounts across project invoices sharing
  // the same coupon code, ordered by earliest invoice for determinism.
  const [projectInvoiceCoupon] = await db
    .select({ couponCode: invoicesTable.couponCode, discountAmount: invoicesTable.discountAmount })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.projectId, id), isNotNull(invoicesTable.couponCode)))
    .orderBy(invoicesTable.createdAt)
    .limit(1);
  const appliedCoupon = projectInvoiceCoupon?.couponCode
    ? { couponCode: projectInvoiceCoupon.couponCode, discountAmount: projectInvoiceCoupon.discountAmount ?? null }
    : null;

  res.json({ project, steps, tasks, previewTasks, documents, updates, statusReports, pendingStatusReport: pendingStatusReport ?? null, contract, contracts, appliedCoupon });
});

// ─── CLIENT: Project Recent Activity ─────────────────────────────────────────
router.get("/portal/projects/:id/audit-logs", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const isAdmin = req.user!.role === "admin";
  const [project] = await db.select().from(projectsTable)
    .where(isAdmin ? eq(projectsTable.id, id) : and(eq(projectsTable.id, id), eq(projectsTable.clientUserId, userId)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "10"), 10)));

  const conditions = [eq(auditLogsTable.projectId, id)];
  if (!isAdmin) {
    conditions.push(eq(auditLogsTable.clientId, userId));
  }

  const entries = await db.select().from(auditLogsTable)
    .where(and(...conditions))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limit);

  res.json({ entries });
});

// ─── CLIENT: Proxy a SharePoint drive item for inline viewing ─────────────────
// GET /api/portal/projects/:id/sharepoint-file/:itemId
// ?metaOnly=true  → returns { downloadUrl, mimeType, name } JSON (for Office Online embeds)
// (default)       → fetches the pre-signed download URL and streams the bytes back
router.get("/portal/projects/:id/sharepoint-file/:itemId", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const projectId = parseInt(String(req.params.id ?? ""), 10);
  const itemId = String(req.params.itemId ?? "");
  if (isNaN(projectId) || !itemId) { res.status(400).json({ error: "Invalid parameters" }); return; }

  const isAdmin = req.user!.role === "admin";
  const [project] = await db.select().from(projectsTable)
    .where(isAdmin ? eq(projectsTable.id, projectId) : and(eq(projectsTable.id, projectId), eq(projectsTable.clientUserId, userId)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const clientUserId = project.clientUserId;
  if (!clientUserId) { res.status(404).json({ error: "Project has no client" }); return; }

  const [clientUser] = await db.select({ sharepointSiteId: usersTable.sharepointSiteId })
    .from(usersTable).where(eq(usersTable.id, clientUserId));

  if (!clientUser?.sharepointSiteId) {
    res.status(404).json({ error: "No SharePoint site linked to this client" });
    return;
  }

  if (!graphCredentialsPresent()) {
    res.status(503).json({ error: "Microsoft Graph is not configured on this server." });
    return;
  }

  const item = await getDriveItemDownloadUrl(clientUser.sharepointSiteId, itemId);
  if (!item) {
    res.status(502).json({ error: "Could not fetch file from SharePoint. Check Graph permissions." });
    return;
  }

  if (req.query.metaOnly === "true") {
    res.json({ downloadUrl: item.downloadUrl, mimeType: item.mimeType, name: item.name });
    return;
  }

  // Proxy the file bytes so the client never needs SharePoint credentials
  const fileRes = await fetch(item.downloadUrl).catch((err: unknown) => {
    req.log.error({ err }, "Failed to fetch file from SharePoint download URL");
    return null;
  });
  if (!fileRes) {
    res.status(502).json({ error: "Failed to fetch file from SharePoint" });
    return;
  }
  if (!fileRes.ok) {
    res.status(502).json({ error: "SharePoint returned an error fetching the file" });
    return;
  }

  const contentType = item.mimeType ?? fileRes.headers.get("content-type") ?? "application/octet-stream";
  const contentLength = fileRes.headers.get("content-length");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(item.name)}`);
  if (contentLength) res.setHeader("Content-Length", contentLength);

  // Stream the response body to avoid buffering large files in memory
  if (fileRes.body) {
    const nodeReadable = Readable.fromWeb(fileRes.body as Parameters<typeof Readable.fromWeb>[0]);
    nodeReadable.on("error", (err) => req.log.error({ err }, "Error streaming SharePoint file to client"));
    nodeReadable.pipe(res);
  } else {
    res.status(502).json({ error: "No response body from SharePoint" });
  }
});

// ─── CLIENT: SharePoint Documents for a project ───────────────────────────────
router.get("/portal/projects/:id/sharepoint-documents", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const isAdmin = req.user!.role === "admin";
  const [project] = await db.select().from(projectsTable)
    .where(isAdmin ? eq(projectsTable.id, id) : and(eq(projectsTable.id, id), eq(projectsTable.clientUserId, userId)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  // Look up the customer's SharePoint site ID (on the users table per Task #418)
  const clientUserId = project.clientUserId;
  if (!clientUserId) { res.json({ items: [], noSite: false }); return; }

  const [clientUser] = await db.select({
    sharepointSiteId: usersTable.sharepointSiteId,
  }).from(usersTable).where(eq(usersTable.id, clientUserId));

  if (!clientUser?.sharepointSiteId) {
    res.json({ items: [], noSite: true });
    return;
  }

  if (!graphCredentialsPresent()) {
    req.log.warn("SharePoint documents requested but Graph credentials are not configured");
    res.status(503).json({ error: "Microsoft Graph is not configured on this server." });
    return;
  }

  try {
    const folderPath = project.title;
    const raw = await listDriveItems(clientUser.sharepointSiteId, folderPath);
    const items = raw
      .filter(item => item.type === "file")
      .map(item => ({
        id: item.id,
        name: item.name,
        webUrl: item.webUrl,
        mimeType: item.mimeType ?? null,
        size: item.size ?? null,
        lastModifiedDateTime: item.lastModified ?? null,
      }));
    res.json({ items, noSite: false });
  } catch (err) {
    req.log.error({ err }, "listDriveItems failed for portal sharepoint-documents");
    res.status(502).json({ error: "Failed to fetch files from SharePoint. Please try again later." });
  }
});

// ─── CLIENT: Project Audit PDF ───────────────────────────────────────────────
router.get("/portal/projects/:id/audit-pdf", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const isAdmin = req.user!.role === "admin";
  const [project] = await db.select().from(projectsTable)
    .where(isAdmin ? eq(projectsTable.id, id) : and(eq(projectsTable.id, id), eq(projectsTable.clientUserId, userId)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const steps = await db.select().from(workflowStepsTable)
    .where(eq(workflowStepsTable.projectId, id))
    .orderBy(asc(workflowStepsTable.order));

  const tasks = await db.select().from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.projectId, id))
    .orderBy(asc(kanbanTasksTable.order));

  const updates = await db.select().from(projectUpdatesTable)
    .where(eq(projectUpdatesTable.projectId, id))
    .orderBy(desc(projectUpdatesTable.createdAt));

  // Sent status reports for this project
  const sentReports = await db.select().from(statusReportsTable)
    .where(and(eq(statusReportsTable.projectId, id), eq(statusReportsTable.reportStatus, "sent")))
    .orderBy(desc(statusReportsTable.reportDate));

  // Documents with uploader names
  const docs = await db.select({
    id: documentsTable.id,
    name: documentsTable.name,
    sizeBytes: documentsTable.sizeBytes,
    createdAt: documentsTable.createdAt,
    uploaderName: usersTable.name,
  }).from(documentsTable)
    .leftJoin(usersTable, eq(documentsTable.uploadedBy, usersTable.id))
    .where(eq(documentsTable.projectId, id))
    .orderBy(asc(documentsTable.createdAt));

  // ── Build PDF ──────────────────────────────────────────────────────────────
  const pdfDoc = await PDFDocument.create();
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const margin = 55;
  const pageW = 595;
  const navy  = rgb(0.039, 0.145, 0.251);  // #0A2540
  const blue  = rgb(0,     0.471, 0.831);  // #0078D4
  const teal  = rgb(0,     0.706, 0.847);  // #00B4D8
  const grey  = rgb(0.45,  0.45,  0.45);
  const white = rgb(1, 1, 1);
  const green = rgb(0.086, 0.627, 0.220);  // success green
  const red   = rgb(0.753, 0.110, 0.157);

  let page = pdfDoc.addPage([pageW, 842]);
  let y = 800;

  const newPage = () => {
    page = pdfDoc.addPage([pageW, 842]);
    y = 800;
    // running header on continuation pages
    page.drawRectangle({ x: 0, y: 820, width: pageW, height: 22, color: navy });
    page.drawText("Shane McCaw Consulting  —  Project Audit Report", {
      x: margin, y: 826, font: bold, size: 9, color: white,
    });
  };

  const text = (str: string, x: number, yy: number, opts: { font?: typeof bold; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    page.drawText(str, { x, y: yy, font: opts.font ?? regular, size: opts.size ?? 10, color: opts.color ?? navy });
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < 60) newPage();
  };

  // Wrap text to width, return lines
  const wrap = (str: string, maxChars: number): string[] => {
    const words = str.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (candidate.length > maxChars) { if (line) lines.push(line); line = w; }
      else line = candidate;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  };

  // ── Page 1 header bar ──────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: 820, width: pageW, height: 22, color: navy });
  text("Shane McCaw Consulting  —  Project Audit Report", margin, 826, { font: bold, size: 9, color: white });

  // ── Title block ────────────────────────────────────────────────────────────
  y = 775;
  text("Project Audit Report", margin, y, { font: bold, size: 20, color: navy });
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1.5, color: blue });
  y -= 18;

  const year = new Date().getFullYear();
  const refNum = `SMC-${year}-${String(project.id).padStart(3, "0")}`;
  const statusLabel: Record<string, string> = { active: "In Progress", on_hold: "On Hold", completed: "Completed", cancelled: "Cancelled" };
  const generatedOn = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const completedSteps = steps.filter(s => s.status === "completed").length;
  const overallPct = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : project.progress;

  const meta: [string, string][] = [
    ["Project:", project.title],
    ["Reference:", refNum],
    ["Status:", statusLabel[project.status] ?? project.status],
    ["Overall Progress:", `${overallPct}% complete (${completedSteps} of ${steps.length} phases)`],
    ["Generated:", generatedOn],
  ];
  if (project.startDate) meta.push(["Start Date:", new Date(project.startDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })]);
  if (project.endDate)   meta.push(["Target Date:", new Date(project.endDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })]);

  for (const [label, value] of meta) {
    text(label, margin, y, { font: bold, size: 10, color: grey });
    text(value,  margin + 110, y, { size: 10 });
    y -= 16;
  }
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  y -= 18;

  // ── Progress bar ────────────────────────────────────────────────────────────
  ensureSpace(30);
  text("Overall Completion", margin, y, { font: bold, size: 10, color: navy });
  y -= 14;
  const barW = pageW - margin * 2;
  page.drawRectangle({ x: margin, y, width: barW, height: 8, color: rgb(0.92, 0.93, 0.95) });
  const fillW = Math.round(barW * overallPct / 100);
  if (fillW > 0) page.drawRectangle({ x: margin, y, width: fillW, height: 8, color: blue });
  text(`${overallPct}%`, margin + barW + 6, y, { size: 9, color: grey });
  y -= 22;

  // ── Phase breakdown ─────────────────────────────────────────────────────────
  ensureSpace(24);
  text("Phase Breakdown", margin, y, { font: bold, size: 13, color: navy });
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: teal });
  y -= 16;

  const stepColor = (status: string) => {
    if (status === "completed") return green;
    if (status === "in_progress") return blue;
    if (status === "blocked") return red;
    return grey;
  };
  const stepLabel = (status: string) => {
    const m: Record<string, string> = { completed: "Completed", in_progress: "In Progress", pending: "Pending", blocked: "Blocked" };
    return m[status] ?? status;
  };

  for (const step of steps) {
    ensureSpace(52);

    // Step row background
    const rowBg = step.status === "in_progress" ? rgb(0.94, 0.97, 1) : rgb(0.98, 0.98, 0.99);
    page.drawRectangle({ x: margin - 4, y: y - 2, width: barW + 8, height: 16, color: rowBg });

    // Step number + title
    const stepNum = `${step.order ?? steps.indexOf(step) + 1}.`;
    text(stepNum, margin, y, { font: bold, size: 9.5, color: grey });
    text(step.title, margin + 18, y, { font: bold, size: 9.5, color: navy });

    // Status badge aligned right
    const statusStr = stepLabel(step.status);
    text(statusStr, pageW - margin - 70, y, { size: 9, color: stepColor(step.status) });
    y -= 16;

    // Completion date
    if (step.completedAt) {
      const dateStr = new Date(step.completedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      text(`Completed: ${dateStr}`, margin + 18, y, { size: 8.5, color: grey });
      y -= 13;
    }

    // Notes
    if (step.notes && step.notes.trim()) {
      const noteLines = wrap(step.notes.trim(), 88);
      for (const line of noteLines) {
        ensureSpace(14);
        text(line, margin + 18, y, { size: 8.5, color: grey });
        y -= 12;
      }
    }

    // Description (short, if available)
    if (step.description && step.description.trim()) {
      const descLines = wrap(step.description.trim(), 88);
      for (const line of descLines.slice(0, 2)) {
        ensureSpace(14);
        text(line, margin + 18, y, { size: 8, color: rgb(0.55, 0.55, 0.55) });
        y -= 11;
      }
    }

    y -= 6;
  }

  // ── Task Summary ────────────────────────────────────────────────────────────
  if (tasks.length > 0) {
    ensureSpace(50);
    y -= 4;
    text("Task Summary", margin, y, { font: bold, size: 13, color: navy });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: teal });
    y -= 18;

    // ── Overall stats row ────────────────────────────────────────────────────
    const taskTotals = {
      backlog:             tasks.filter(t => t.column === "backlog").length,
      in_progress:         tasks.filter(t => t.column === "in_progress").length,
      waiting_on_customer: tasks.filter(t => t.column === "waiting_on_customer").length,
      completed:           tasks.filter(t => t.column === "completed").length,
    };

    const statsLabels: [string, number, ReturnType<typeof rgb>][] = [
      ["Backlog",         taskTotals.backlog,             grey],
      ["In Progress",     taskTotals.in_progress,         blue],
      ["Waiting on You",  taskTotals.waiting_on_customer, rgb(0.761, 0.490, 0)],
      ["Completed",       taskTotals.completed,           green],
    ];
    const colW = Math.floor(barW / statsLabels.length);
    let sx = margin;
    for (const [label, count, color] of statsLabels) {
      // Card background
      page.drawRectangle({ x: sx, y: y - 28, width: colW - 6, height: 40, color: rgb(0.96, 0.97, 0.99) });
      text(String(count), sx + 10, y - 2, { font: bold, size: 16, color });
      text(label,         sx + 10, y - 18, { size: 8, color: grey });
      sx += colW;
    }
    y -= 44;

    // Total task count
    text(`${tasks.length} total task${tasks.length !== 1 ? "s" : ""}`, margin, y, { size: 8.5, color: grey });
    y -= 18;

    // ── Full card listing grouped by column ──────────────────────────────────
    const kanbanColumns: Array<{ key: string; label: string; color: ReturnType<typeof rgb> }> = [
      { key: "backlog",             label: "Backlog",             color: grey },
      { key: "in_progress",         label: "In Progress",         color: blue },
      { key: "waiting_on_customer", label: "Waiting on Customer", color: rgb(0.761, 0.490, 0) },
      { key: "completed",           label: "Completed",           color: green },
    ];
    const priorityLabel: Record<string, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
    const priorityColor: Record<string, ReturnType<typeof rgb>> = {
      low: grey, medium: blue, high: rgb(0.8, 0.4, 0), urgent: red,
    };

    for (const col of kanbanColumns) {
      const colTasks = tasks.filter(t => t.column === col.key);
      if (colTasks.length === 0) continue;

      ensureSpace(30);
      page.drawRectangle({ x: margin - 4, y: y - 3, width: barW + 8, height: 18, color: rgb(0.95, 0.96, 0.98) });
      text(col.label, margin + 4, y, { font: bold, size: 9.5, color: col.color });
      text(`${colTasks.length} card${colTasks.length !== 1 ? "s" : ""}`, pageW - margin - 50, y, { size: 8.5, color: grey });
      y -= 22;

      for (const task of colTasks) {
        ensureSpace(22);
        const colSymbol = col.key === "completed" ? "[x]" : col.key === "in_progress" ? "[>]" : col.key === "waiting_on_customer" ? "[?]" : "[ ]";
        text(colSymbol, margin + 8, y, { size: 8, color: col.color });
        const titleLines = wrap(task.title, 74);
        text(titleLines[0] ?? task.title, margin + 24, y, { font: bold, size: 8.5, color: navy });

        // Priority + due date aligned right
        const pri = task.priority ?? "medium";
        const metaParts: string[] = [];
        if (pri !== "medium") metaParts.push(priorityLabel[pri] ?? pri);
        if (task.dueDate) metaParts.push(`Due ${new Date(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
        if (metaParts.length > 0) {
          text(metaParts.join("  ·  "), pageW - margin - 100, y, { size: 7.5, color: priorityColor[pri] ?? grey });
        }
        y -= 12;

        // Description
        if (task.description && task.description.trim()) {
          const dLines = wrap(task.description.trim(), 80);
          for (const line of dLines) {
            ensureSpace(12);
            text(line, margin + 24, y, { size: 7.5, color: rgb(0.5, 0.5, 0.5) });
            y -= 11;
          }
        }

        // Waiting reason
        if (task.waitingReason) {
          ensureSpace(11);
          text(`Waiting: ${task.waitingReason}`, margin + 24, y, { size: 7.5, color: rgb(0.761, 0.490, 0) });
          y -= 10;
        }

        // Completion notes
        if (task.completionNotes) {
          const nLines = wrap(task.completionNotes, 80);
          for (const line of nLines) {
            ensureSpace(11);
            text(line, margin + 24, y, { size: 7.5, color: rgb(0.45, 0.45, 0.45) });
            y -= 10;
          }
        }

        y -= 4;
      }
      y -= 4;
    }

    y -= 4;
  }

  // ── Consultant Updates ──────────────────────────────────────────────────────
  if (updates.length > 0) {
    ensureSpace(40);
    y -= 4;
    text("Consultant Updates", margin, y, { font: bold, size: 13, color: navy });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: teal });
    y -= 16;

    for (const upd of updates.slice(0, 10)) {
      ensureSpace(30);
      const dateStr = new Date(upd.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      const typeLabel = upd.type === "milestone" ? "Milestone" : upd.type === "file" ? "Document" : "Update";
      text(`${dateStr}  ·  ${typeLabel}`, margin, y, { font: bold, size: 8.5, color: blue });
      y -= 13;

      const lines = wrap(upd.content, 92);
      for (const line of lines.slice(0, 4)) {
        ensureSpace(13);
        text(line, margin + 4, y, { size: 9, color: navy });
        y -= 12;
      }
      y -= 6;
    }
  }

  // ── Status Reports ──────────────────────────────────────────────────────────
  if (sentReports.length > 0) {
    ensureSpace(40);
    y -= 4;
    text("Status Reports", margin, y, { font: bold, size: 13, color: navy });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: teal });
    y -= 16;

    const periodLabels: Record<string, string> = { weekly: "Weekly", monthly: "Monthly", executive_summary: "Executive Summary", other: "Other" };

    for (const sr of sentReports) {
      ensureSpace(40);

      // Report header
      const periodStr = periodLabels[sr.period] ?? sr.period;
      const rdStr = sr.reportDate ? new Date(sr.reportDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "";
      text(`${periodStr}${rdStr ? `  —  ${rdStr}` : ""}`, margin, y, { font: bold, size: 10, color: navy });
      y -= 13;
      text(sr.title, margin, y, { size: 9, color: grey });
      y -= 18;

      // Executive summary
      if (sr.executiveSummary) {
        ensureSpace(20);
        text("Executive Summary", margin, y, { font: bold, size: 8.5, color: blue });
        y -= 12;
        const esLines = wrap(sr.executiveSummary, 90);
        for (const line of esLines) {
          ensureSpace(12);
          text(line, margin + 4, y, { size: 8.5, color: navy });
          y -= 11;
        }
        y -= 4;
      }

      // Completed activities
      type SRActivity = { title: string; description: string };
      const activities = (sr.completedActivities ?? []) as SRActivity[];
      if (activities.length > 0) {
        ensureSpace(20);
        text("Completed Activities", margin, y, { font: bold, size: 8.5, color: blue });
        y -= 12;
        for (const act of activities) {
          ensureSpace(12);
          text(`• ${act.title}`, margin + 4, y, { size: 8.5, color: navy });
          y -= 11;
          if (act.description) {
            const aLines = wrap(act.description, 85);
            for (const line of aLines) {
              ensureSpace(11);
              text(`  ${line}`, margin + 10, y, { size: 7.5, color: grey });
              y -= 10;
            }
          }
        }
        y -= 4;
      }

      // Key outcomes
      if (sr.keyOutcomes) {
        ensureSpace(20);
        text("Key Outcomes", margin, y, { font: bold, size: 8.5, color: blue });
        y -= 12;
        const koLines = wrap(sr.keyOutcomes, 90);
        for (const line of koLines) {
          ensureSpace(11);
          text(line, margin + 4, y, { size: 8.5, color: navy });
          y -= 11;
        }
        y -= 4;
      }

      // Next steps
      type SRNextStep = { label: string; title: string; description: string };
      const srNextSteps = (sr.nextSteps ?? []) as SRNextStep[];
      if (srNextSteps.length > 0) {
        ensureSpace(20);
        text("Next Steps", margin, y, { font: bold, size: 8.5, color: blue });
        y -= 12;
        for (const ns of srNextSteps) {
          ensureSpace(12);
          text(`• ${ns.title || ns.label}`, margin + 4, y, { size: 8.5, color: navy });
          y -= 11;
        }
        y -= 4;
      }

      // Client question + admin reply
      if (sr.clientQuestion) {
        ensureSpace(20);
        text("Client Question:", margin + 4, y, { font: bold, size: 8, color: rgb(0.5, 0.3, 0) });
        y -= 11;
        const qLines = wrap(sr.clientQuestion, 86);
        for (const line of qLines) {
          ensureSpace(11);
          text(line, margin + 10, y, { size: 8, color: navy });
          y -= 10;
        }
        if (sr.adminReply) {
          y -= 2;
          text("Response:", margin + 4, y, { font: bold, size: 8, color: blue });
          y -= 11;
          const rLines = wrap(sr.adminReply, 86);
          for (const line of rLines) {
            ensureSpace(11);
            text(line, margin + 10, y, { size: 8, color: navy });
            y -= 10;
          }
        }
        y -= 4;
      }

      // Divider between reports
      y -= 6;
      ensureSpace(4);
      page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.3, color: rgb(0.88, 0.88, 0.88) });
      y -= 12;
    }
  }

  // ── Documents ───────────────────────────────────────────────────────────────
  {
    ensureSpace(40);
    y -= 4;
    text("Project Documents", margin, y, { font: bold, size: 13, color: navy });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: teal });
    y -= 16;

    if (docs.length === 0) {
      text("No documents uploaded", margin, y, { size: 9, color: grey });
      y -= 16;
    } else {
      const fmtSize = (bytes: number | null) => {
        if (!bytes) return "";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      };
      for (const doc of docs) {
        ensureSpace(16);
        const docDate = new Date(doc.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
        const sizeStr = fmtSize(doc.sizeBytes);
        const uploaderStr = doc.uploaderName ?? "Unknown";
        const docMeta = [sizeStr, uploaderStr, docDate].filter(Boolean).join("  ·  ");
        text(`• ${doc.name}`, margin, y, { font: bold, size: 8.5, color: navy });
        text(docMeta, pageW - margin - 170, y, { size: 8, color: grey });
        y -= 14;
      }
    }
  }

  // ── Footer on last page ─────────────────────────────────────────────────────
  ensureSpace(30);
  y = 45;
  page.drawLine({ start: { x: margin, y: y + 12 }, end: { x: pageW - margin, y: y + 12 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  text("Shane McCaw Consulting LLC  —  Confidential", margin, y, { size: 8, color: grey });
  text(`Generated ${generatedOn}`, pageW - margin - 100, y, { size: 8, color: grey });

  // ── Return PDF ─────────────────────────────────────────────────────────────
  const pdfBytes = await pdfDoc.save();
  const filename = `audit-${refNum}.pdf`;
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": String(pdfBytes.length),
  });
  res.end(Buffer.from(pdfBytes));
});

// ─── CLIENT: Services ────────────────────────────────────────────────────────
router.get("/portal/services", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const services = await db.select({
    cs: clientServicesTable,
    service: servicesTable,
  }).from(clientServicesTable)
    .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
    .where(eq(clientServicesTable.clientUserId, userId))
    .orderBy(desc(clientServicesTable.purchasedAt));

  const result = await Promise.all(services.map(async ({ cs, service }) => {
    const steps = await db.select().from(workflowStepsTable)
      .where(eq(workflowStepsTable.clientServiceId, cs.id))
      .orderBy(asc(workflowStepsTable.order));
    return { ...cs, service, steps };
  }));

  res.json(result);
});

// ─── CLIENT: Service checkout ─────────────────────────────────────────────────
router.post("/portal/services/checkout", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { name, priceInCents, description, category, returnUrl } = req.body as {
    name?: string;
    priceInCents?: number;
    description?: string;
    category?: string;
    returnUrl?: string;
  };

  if (!name || !priceInCents) {
    res.status(400).json({ error: "name and priceInCents are required" });
    return;
  }

  let stripeKey: string;
  try { stripeKey = getStripeKey(); } catch (e) { res.status(503).json({ error: (e as Error).message }); return; }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  const [userProfile] = await db.select({
    email: usersTable.email,
    name: usersTable.name,
    address: usersTable.address,
    addressCity: usersTable.addressCity,
    addressState: usersTable.addressState,
    addressZip: usersTable.addressZip,
  }).from(usersTable).where(eq(usersTable.id, userId));

  const customerId = userProfile
    ? await getOrCreateStripeCustomer(stripe, userProfile)
    : undefined;

  const baseUrl = returnUrl ?? `${req.protocol}://${req.hostname}`;
  const encodedName = encodeURIComponent(name);

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    customer: customerId,
    billing_address_collection: "required",
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: {
          name,
          description: description ?? undefined,
        },
        unit_amount: priceInCents,
      },
      quantity: 1,
    }],
    mode: "payment",
    success_url: `${baseUrl}/portal/services?purchase=success&service=${encodedName}`,
    cancel_url: `${baseUrl}/portal/services?purchase=cancelled`,
    metadata: {
      type: "service_purchase",
      userId: String(userId),
      serviceName: name,
      serviceCategory: category ?? "",
      servicePriceInCents: String(priceInCents),
    },
  });

  res.json({ url: session.url });
});

// ─── CLIENT: Reports ─────────────────────────────────────────────────────────
router.get("/portal/reports", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const reports = await db.select().from(reportsTable)
    .where(eq(reportsTable.clientUserId, userId))
    .orderBy(desc(reportsTable.createdAt));
  res.json(reports);
});

router.get("/portal/reports/:id/download", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const isAdmin = req.user!.role === "admin";
  const [report] = await db.select().from(reportsTable)
    .where(isAdmin ? eq(reportsTable.id, id) : and(eq(reportsTable.id, id), eq(reportsTable.clientUserId, userId)));
  if (!report) { res.status(404).json({ error: "Report not found" }); return; }

  const filePath = path.join(UPLOADS_BASE, "reports", report.filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found" }); return; }
  res.download(filePath, report.filename);
});

// ─── CLIENT: Documents ───────────────────────────────────────────────────────
router.get("/portal/documents/:id/download", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

  const isAdmin = req.user!.role === "admin";
  if (!isAdmin) {
    const [project] = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, doc.projectId), eq(projectsTable.clientUserId, userId)));
    if (!project) { res.status(403).json({ error: "Access denied" }); return; }
  }

  const filePath = path.join(UPLOADS_BASE, "documents", doc.filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found" }); return; }
  res.download(filePath, doc.name);
});

// ─── CLIENT: Document Upload ─────────────────────────────────────────────────
router.post("/portal/projects/:projectId/documents", requireAuth, uploadDoc.single("file"), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const isAdmin = req.user!.role === "admin";
  const projectId = parseInt(String(req.params.projectId ?? ""), 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  if (!isAdmin) {
    const [project] = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.clientUserId, userId)));
    if (!project) { res.status(403).json({ error: "Access denied" }); return; }
  }

  if (!req.file) { res.status(400).json({ error: "File is required" }); return; }

  const { name } = req.body as { name?: string };
  const [doc] = await db.insert(documentsTable).values({
    projectId,
    name: name?.trim() || req.file.originalname,
    filename: req.file.filename,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    uploadedBy: userId,
  }).returning();
  res.status(201).json(doc);
});

// ─── Helper: recompute and persist project progress from kanban completion ────
async function syncProjectProgress(projectId: number): Promise<void> {
  const [result] = await db
    .select({
      total: count(),
      completed: count(sql`case when ${kanbanTasksTable.column} = 'completed' then 1 end`),
    })
    .from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.projectId, projectId));
  const total = result?.total ?? 0;
  const completed = Number(result?.completed ?? 0);
  const progress = total === 0 ? 0 : Math.round((completed / total) * 100);
  await db.update(projectsTable).set({ progress }).where(eq(projectsTable.id, projectId));
}

// ─── CLIENT: Kanban Tasks (client can move cards on their own project boards) ─
router.patch("/portal/kanban-tasks/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const isAdmin = req.user!.role === "admin";
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [task] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  if (!isAdmin) {
    // Clients may only update tasks that belong to their own projects
    const [project] = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, task.projectId), eq(projectsTable.clientUserId, userId)));
    if (!project) { res.status(403).json({ error: "Access denied" }); return; }
  }

  const { column } = req.body as { column?: string };
  const updates: Partial<typeof kanbanTasksTable.$inferInsert & { updatedAt: Date }> = { updatedAt: new Date() };
  if (column !== undefined) updates.column = column as "backlog" | "in_progress" | "waiting_on_customer" | "completed";

  const [updated] = await db.update(kanbanTasksTable).set(updates).where(eq(kanbanTasksTable.id, id)).returning();
  if (updated?.projectId) await syncProjectProgress(updated.projectId);

  if (column !== undefined && updated) {
    const actor = req.user!;
    void createAuditLog({
      actorUserId: actor.id,
      actorName: actor.name ?? actor.email,
      actorRole: actor.role as "admin" | "client",
      actionType: column === "completed" ? "kanban_task_closed" : "kanban_task_moved",
      entityType: "kanban_task",
      entityId: updated.id,
      entityLabel: updated.title,
      projectId: updated.projectId,
      clientId: actor.role === "client" ? actor.id : null,
      metadata: { from: task.column, to: column },
    });
  }

  res.json(updated);
});

// ─── CLIENT: Invoices ────────────────────────────────────────────────────────
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

// ─── CLIENT: Contract detail ──────────────────────────────────────────────────
router.get("/portal/contracts/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [row] = await db.select({
    id: contractsTable.id,
    userId: contractsTable.userId,
    serviceId: contractsTable.serviceId,
    serviceName: servicesTable.name,
    orderWorkflow: servicesTable.orderWorkflow,
    signedAt: contractsTable.signedAt,
    signatureData: contractsTable.signatureData,
    signerName: contractsTable.signerName,
    contractVersion: contractsTable.contractVersion,
    projectId: contractsTable.projectId,
    pdfFilename: contractsTable.pdfFilename,
    finalPrice: contractsTable.finalPrice,
    wizardSelections: contractsTable.wizardSelections,
    agreementBody: contractsTable.agreementBody,
    createdAt: contractsTable.createdAt,
  })
    .from(contractsTable)
    .innerJoin(servicesTable, eq(contractsTable.serviceId, servicesTable.id))
    .where(and(eq(contractsTable.id, id), eq(contractsTable.userId, userId)));

  if (!row) { res.status(404).json({ error: "Contract not found" }); return; }

  // Look up coupon/discount info from the linked invoice (joined via projectId)
  let couponCode: string | null = null;
  let discountAmount: string | null = null;
  if (row.projectId) {
    const [inv] = await db
      .select({ couponCode: invoicesTable.couponCode, discountAmount: invoicesTable.discountAmount })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.clientUserId, userId), eq(invoicesTable.projectId, row.projectId)))
      .orderBy(desc(invoicesTable.createdAt))
      .limit(1);
    couponCode = inv?.couponCode ?? null;
    discountAmount = inv?.discountAmount ? String(inv.discountAmount) : null;
  }

  // Use the snapshotted agreement body stored at signing time.
  // For older contracts where it was not snapshotted, fall back to the live template.
  // If neither exists, use the standard Shane McCaw Consulting service agreement text.
  let agreementBody: string | null = row.agreementBody ?? null;
  if (agreementBody === null) {
    const [template] = await db.select({ body: contractTemplatesTable.body })
      .from(contractTemplatesTable)
      .where(eq(contractTemplatesTable.serviceId, row.serviceId));
    agreementBody = template?.body ?? null;
  }
  if (agreementBody === null) {
    agreementBody = `SHANE McCAW CONSULTING — STANDARD SERVICE AGREEMENT

1. SCOPE OF SERVICES
Shane McCaw Consulting ("Consultant") agrees to provide the Microsoft 365 and related technology consulting services described in the applicable service order or statement of work accepted by the Client. Services are performed remotely unless otherwise agreed in writing.

2. PAYMENT TERMS
Fees are due as specified in the service order. Fixed-price engagements are billed in full upon acceptance. Retainer arrangements are billed monthly in advance. All invoices are payable within 15 days of issuance. Overdue balances accrue interest at 1.5% per month.

3. INTELLECTUAL PROPERTY
Work product created specifically for Client under a paid engagement becomes Client's property upon receipt of full payment. Pre-existing tools, templates, methodologies, and know-how developed independently by Consultant remain Consultant's property. Consultant retains the right to describe the nature of services performed for portfolio and reference purposes.

4. CONFIDENTIALITY
Each party agrees to keep confidential all non-public information of the other party that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information and circumstances of disclosure. This obligation survives termination for three (3) years.

5. LIMITATION OF LIABILITY
Consultant's total liability for any claim arising out of or relating to this agreement shall not exceed the fees paid by Client in the three (3) months preceding the claim. In no event shall either party be liable for indirect, incidental, special, or consequential damages, even if advised of the possibility of such damages.

6. TERM AND TERMINATION
Either party may terminate ongoing services with 14 days' written notice. Client remains responsible for fees earned through the termination date. Fixed-price project engagements may only be terminated for material breach that remains uncured for 10 business days after written notice.

7. INDEPENDENT CONTRACTOR
Consultant is an independent contractor. Nothing in this agreement creates an employment, partnership, or joint-venture relationship between the parties.

8. GOVERNING LAW
This agreement is governed by the laws of the State of Virginia, without regard to conflict-of-law principles. Any dispute not resolved by good-faith negotiation shall be submitted to binding arbitration in Fairfax County, Virginia under the AAA Commercial Arbitration Rules.

9. ENTIRE AGREEMENT
This agreement, together with any applicable service order, constitutes the entire agreement between the parties regarding its subject matter and supersedes all prior discussions and representations.`;
  }

  res.json({ ...row, agreementBody, couponCode, discountAmount });
});

router.get("/portal/contracts/:id/download", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [contract] = await db.select().from(contractsTable)
    .where(and(eq(contractsTable.id, id), eq(contractsTable.userId, userId)));
  if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }
  if (!contract.pdfFilename) { res.status(404).json({ error: "No PDF available" }); return; }

  const filePath = path.join(UPLOADS_BASE, "contracts", contract.pdfFilename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found" }); return; }
  res.download(filePath, contract.pdfFilename);
});

// ─── CLIENT: Stripe subscription receipts ────────────────────────────────────
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

  void sendEmailFromTemplate(
    "retainer-resumed",
    req.user!.email,
    { clientName: req.user!.name ?? "", serviceName, nextBillingDate, portalLink: PORTAL_URL },
    `Your ${serviceName} retainer is back on`,
    retainerResumedEmail({ clientName: req.user!.name ?? "", serviceName, nextBillingDate }),
  );

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

  const baseUrl = (req.body as { returnUrl?: string }).returnUrl ?? req.headers.origin ?? `${req.protocol}://${req.hostname}`;

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
    success_url: `${baseUrl}/crm/portal/billing?payment=success`,
    cancel_url: `${baseUrl}/crm/portal/billing?payment=cancelled`,
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

// ─── Contract PDF generator ───────────────────────────────────────────────────
interface ContractPdfOptions {
  contractId: number;
  signerName: string;
  serviceName: string;
  servicePrice: string;
  billingType?: "one_time" | "recurring_monthly";
  serviceDeliverables: string;
  serviceTurnaround: string;
  signedAt: Date;
  signatureDataUrl?: string;
  contractTemplateBody?: string; // When provided, replaces hardcoded sections with admin-authored content
  selectionsSummary?: string;    // Plain-text wizard selection summary, injected after price row
  appendBody?: string;           // Extra clauses appended after template/standard sections (before signature)
}

async function generateContractPdf(opts: ContractPdfOptions): Promise<{ filename: string; buffer: Buffer; localFilePath: string }> {
  const {
    contractId, signerName, serviceName, servicePrice,
    billingType = "one_time", serviceDeliverables, serviceTurnaround,
    signedAt, signatureDataUrl, contractTemplateBody, selectionsSummary, appendBody,
  } = opts;

  const pdfDoc = await PDFDocument.create();
  const boldFont  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regFont   = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const PAGE_W    = 595;
  const PAGE_H    = 842;
  const MARGIN    = 60;
  const CONTENT_W = PAGE_W - MARGIN * 2; // 475
  const MIN_Y     = 80;

  const navy    = rgb(0.039, 0.145, 0.251);  // #0A2540
  const blue    = rgb(0,     0.471, 0.831);  // #0078D4
  const greyClr = rgb(0.420, 0.443, 0.502);  // #6B7280
  const darkTxt = rgb(0.216, 0.255, 0.318);  // #374151
  const borderC = rgb(0.886, 0.910, 0.945);  // #e2e8f0
  const offWht  = rgb(0.969, 0.976, 0.988);  // #F7F9FC
  const white   = rgb(1,     1,     1);
  const whtDim  = rgb(0.82,  0.86,  0.91);

  // ── Page management ─────────────────────────────────────────────────────────
  function newBodyPage() {
    const p = pdfDoc.addPage([PAGE_W, PAGE_H]);
    p.drawRectangle({ x: 0, y: PAGE_H - 22, width: PAGE_W, height: 22, color: navy });
    p.drawText("Shane McCaw Consulting LLC  —  Service Agreement", {
      x: MARGIN, y: PAGE_H - 16, font: boldFont, size: 8, color: whtDim,
    });
    return p;
  }

  // ── Text helpers ─────────────────────────────────────────────────────────────
  // Rough Helvetica char-width estimate: size * 0.55 per char
  function wrapText(str: string, maxW: number, sz: number): string[] {
    const charsPerLine = Math.floor(maxW / (sz * 0.55));
    const words = str.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w;
      if (cand.length > charsPerLine) { if (cur) lines.push(cur); cur = w; }
      else { cur = cand; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // Draw Electric Blue uppercase heading + light rule underneath; returns next y
  function drawSectionHeading(page: ReturnType<typeof newBodyPage>, label: string, x: number, pageY: number): number {
    page.drawText(label.toUpperCase(), { x, y: pageY, font: boldFont, size: 8.5, color: blue });
    const ruleY = pageY - 5;
    page.drawLine({ start: { x, y: ruleY }, end: { x: x + CONTENT_W, y: ruleY }, thickness: 1, color: borderC });
    return ruleY - 10;
  }

  // ── Cursor state (mutated by ensureSpace) ────────────────────────────────────
  let currentPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H; // set properly after drawing the header block

  function ensureSpace(needed: number) {
    if (y - needed < MIN_Y) {
      currentPage = newBodyPage();
      y = PAGE_H - 40;
    }
  }

  // ── PAGE 1: DEEP NAVY HEADER BLOCK ──────────────────────────────────────────
  const HEADER_H = 100;
  const HEADER_Y = PAGE_H - HEADER_H; // top of content-area (bottom of block)
  currentPage.drawRectangle({ x: 0, y: HEADER_Y, width: PAGE_W, height: HEADER_H, color: navy });

  // "SERVICE AGREEMENT" label
  currentPage.drawText("SERVICE AGREEMENT", {
    x: MARGIN, y: HEADER_Y + HEADER_H - 22,
    font: boldFont, size: 7.5, color: rgb(0.5, 0.63, 0.75),
  });

  // Company name
  currentPage.drawText("Shane McCaw Consulting LLC", {
    x: MARGIN, y: HEADER_Y + HEADER_H - 40,
    font: boldFont, size: 14, color: white,
  });

  // Metadata row: DATE / PROVIDER / CLIENT
  const signedDate = signedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const metaY = HEADER_Y + HEADER_H - 63;
  const metaPairs: [string, string, number][] = [
    ["DATE",     signedDate,                       MARGIN],
    ["PROVIDER", "Shane McCaw Consulting LLC",     MARGIN + 145],
    ["CLIENT",   signerName,                       MARGIN + 330],
  ];
  for (const [lbl, val, mx] of metaPairs) {
    currentPage.drawText(lbl, { x: mx, y: metaY,      font: boldFont, size: 6.5, color: rgb(0.45, 0.58, 0.70) });
    const vLines = wrapText(val, 130, 8);
    vLines.forEach((ln, i) => {
      currentPage.drawText(ln, { x: mx, y: metaY - 11 - i * 10, font: regFont, size: 8, color: whtDim });
    });
  }

  y = HEADER_Y - 20; // gap below the header block

  // ── SERVICES TABLE ───────────────────────────────────────────────────────────
  const COL1_W = 290; // Service & Deliverables
  const COL2_W = 105; // Price
  const COL3_W = CONTENT_W - COL1_W - COL2_W; // Type (~80)
  const ROW_PAD = 8;
  const THEAD_H = 26;

  // Measure data-row height
  const delivLines = wrapText(serviceDeliverables, COL1_W - 16, 8.5);
  const selLines = selectionsSummary
    ? selectionsSummary.split("\n").filter(l => l.trim() && !l.trim().toLowerCase().startsWith("customisation"))
    : [];
  const dataRowH = Math.max(
    ROW_PAD * 2 + 12 + delivLines.length * 11 + (selLines.length > 0 ? 4 + selLines.length * 11 : 0),
    30,
  );
  const tableH = THEAD_H + dataRowH;

  ensureSpace(tableH + 24);

  const tableTop    = y;
  const tableBottom = tableTop - tableH;
  const TABLE_X     = MARGIN;

  // Outer border
  currentPage.drawRectangle({
    x: TABLE_X, y: tableBottom, width: CONTENT_W, height: tableH,
    borderColor: borderC, borderWidth: 1, color: white,
  });

  // Header row background
  currentPage.drawRectangle({
    x: TABLE_X, y: tableTop - THEAD_H, width: CONTENT_W, height: THEAD_H, color: offWht,
  });
  // Header row bottom border
  currentPage.drawLine({
    start: { x: TABLE_X, y: tableTop - THEAD_H },
    end:   { x: TABLE_X + CONTENT_W, y: tableTop - THEAD_H },
    thickness: 1, color: borderC,
  });

  // Column separator lines (full table height)
  for (const cx of [TABLE_X + COL1_W, TABLE_X + COL1_W + COL2_W]) {
    currentPage.drawLine({
      start: { x: cx, y: tableBottom },
      end:   { x: cx, y: tableTop },
      thickness: 0.5, color: borderC,
    });
  }

  // Column header labels
  const thY = tableTop - THEAD_H + (THEAD_H - 7) / 2 + 1;
  currentPage.drawText("SERVICE & DELIVERABLES", { x: TABLE_X + 10, y: thY, font: boldFont, size: 7, color: greyClr });

  const priceHdr = "PRICE";
  const priceHdrW = boldFont.widthOfTextAtSize(priceHdr, 7);
  currentPage.drawText(priceHdr, {
    x: TABLE_X + COL1_W + COL2_W - 10 - priceHdrW, y: thY, font: boldFont, size: 7, color: greyClr,
  });

  const typeHdr = "TYPE";
  const typeHdrW = boldFont.widthOfTextAtSize(typeHdr, 7);
  currentPage.drawText(typeHdr, {
    x: TABLE_X + COL1_W + COL2_W + COL3_W - 10 - typeHdrW, y: thY, font: boldFont, size: 7, color: greyClr,
  });

  // Data row content
  let rowY = tableTop - THEAD_H - ROW_PAD;

  // Service name (bold navy)
  currentPage.drawText(serviceName, { x: TABLE_X + 10, y: rowY, font: boldFont, size: 9, color: navy });
  rowY -= 13;

  // Deliverables (grey, smaller)
  for (const dln of delivLines) {
    currentPage.drawText(dln, { x: TABLE_X + 10, y: rowY, font: regFont, size: 8, color: greyClr });
    rowY -= 11;
  }

  // Wizard selections sub-list
  if (selLines.length > 0) {
    rowY -= 3;
    for (const sln of selLines) {
      currentPage.drawText(sln, { x: TABLE_X + 18, y: rowY, font: regFont, size: 7.5, color: greyClr });
      rowY -= 11;
    }
  }

  // Price (right-aligned in col 2, bold blue)
  const priceDisplay = billingType === "recurring_monthly" ? `${servicePrice}/month` : servicePrice;
  const priceW = boldFont.widthOfTextAtSize(priceDisplay, 9);
  currentPage.drawText(priceDisplay, {
    x: TABLE_X + COL1_W + COL2_W - 10 - priceW,
    y: tableTop - THEAD_H - ROW_PAD,
    font: boldFont, size: 9, color: blue,
  });

  // Type (right-aligned in col 3, grey)
  const typeDisplay = billingType === "recurring_monthly" ? "monthly" : "one-time";
  const typeW = regFont.widthOfTextAtSize(typeDisplay, 8);
  currentPage.drawText(typeDisplay, {
    x: TABLE_X + COL1_W + COL2_W + COL3_W - 10 - typeW,
    y: tableTop - THEAD_H - ROW_PAD,
    font: regFont, size: 8, color: greyClr,
  });

  y = tableBottom - 18;

  // ── CONTRACT SECTIONS ────────────────────────────────────────────────────────
  const isRecurring = billingType === "recurring_monthly";

  if (contractTemplateBody) {
    // Admin-authored contract body (variable substitution already applied by caller)
    for (const rawLine of contractTemplateBody.split("\n")) {
      const trimmed = rawLine.trimEnd();
      if (trimmed.startsWith("# ")) {
        ensureSpace(32);
        y = drawSectionHeading(currentPage, trimmed.slice(2), MARGIN, y);
      } else if (trimmed.startsWith("## ")) {
        ensureSpace(22);
        currentPage.drawText(trimmed.slice(3), { x: MARGIN, y, font: boldFont, size: 10, color: navy });
        y -= 16;
      } else if (trimmed === "") {
        y -= 6;
      } else {
        for (const wl of wrapText(trimmed, CONTENT_W - 10, 9.5)) {
          ensureSpace(14);
          currentPage.drawText(wl, { x: MARGIN + 4, y, font: regFont, size: 9.5, color: darkTxt });
          y -= 13;
        }
      }
    }
  } else {
    const sections: [string, string][] = [
      ["1. Services",
        "Consultant agrees to deliver the above-listed service to Client per the deliverables and terms specified in the table above."],
      ["2. Fees & Payment",
        isRecurring
          ? "Monthly retainer services are billed at the stated monthly rate, payable in advance on a recurring monthly basis. Either party may cancel a monthly subscription with 30 days written notice. Cancellation takes effect at the end of the current billing period. Monthly retainer fees for the current period are non-refundable on cancellation."
          : "The fixed fee for this engagement is payable in full at checkout before work commences. No additional charges will be incurred for the standard deliverables listed above. No refunds will be issued for one-time services once work has commenced."],
      ["3. Scope",
        "This agreement covers only the deliverables specified above. Any additional work beyond this scope must be agreed in writing and may be subject to additional fees."],
      ["4. Delivery",
        isRecurring
          ? "For monthly retainers, Consultant will perform the described ongoing services throughout each billing period."
          : `Consultant will deliver the agreed outputs within the stated turnaround period (${serviceTurnaround}) after receipt of payment and any required access or information from Client. Work will not commence until both payment is confirmed and all necessary access has been granted.`],
      ["5. Revisions (One-Time Services)",
        "One round of revisions is included within the scope of each one-time service. Additional revisions are available at Consultant's standard hourly rate."],
      ["6. Confidentiality",
        "Each party agrees to keep the other party's confidential information confidential and not to disclose it to any third party without prior written consent. This obligation survives termination of this agreement."],
      ["7. Intellectual Property",
        "Upon receipt of full payment (or, for ongoing retainers, upon payment for the relevant billing period), all deliverables produced by Consultant for Client become the sole property of Client."],
      ["8. Limitation of Liability",
        "Consultant's total liability under this agreement shall not exceed the total fees paid in the 12 months prior to any claim. Consultant is not liable for any indirect, incidental, or consequential damages."],
      ["9. Independent Contractor",
        "Consultant is an independent contractor and not an employee of Client. Nothing in this agreement shall create any partnership, joint venture, agency, franchise, or employment relationship between the parties."],
      ["10. Governing Law",
        "This agreement is governed by the laws of the State of Virginia, United States. Any disputes shall be resolved in the courts of Virginia."],
      ["11. Entire Agreement",
        "This document constitutes the entire agreement between the parties with respect to this engagement and supersedes all prior discussions and representations. Amendments must be made in writing."],
    ];

    for (const [heading, body] of sections) {
      ensureSpace(42);
      y = drawSectionHeading(currentPage, heading, MARGIN, y);
      for (const wl of wrapText(body, CONTENT_W - 10, 9.5)) {
        ensureSpace(14);
        currentPage.drawText(wl, { x: MARGIN + 4, y, font: regFont, size: 9.5, color: darkTxt });
        y -= 13;
      }
      y -= 10;
    }
  }

  // ── APPEND BODY (extra clauses, e.g. testimonial obligation) ─────────────────
  if (appendBody) {
    y -= 10;
    for (const rawLine of appendBody.split("\n")) {
      const trimmed = rawLine.trimEnd();
      if (trimmed.startsWith("# ")) {
        ensureSpace(32);
        y = drawSectionHeading(currentPage, trimmed.slice(2), MARGIN, y);
      } else if (trimmed.startsWith("## ")) {
        ensureSpace(22);
        currentPage.drawText(trimmed.slice(3), { x: MARGIN, y, font: boldFont, size: 10, color: navy });
        y -= 16;
      } else if (trimmed === "---") {
        ensureSpace(14);
        currentPage.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_W, y }, thickness: 0.75, color: borderC });
        y -= 10;
      } else if (trimmed === "") {
        y -= 6;
      } else if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
        ensureSpace(22);
        currentPage.drawText(trimmed.slice(2, -2), { x: MARGIN, y, font: boldFont, size: 10, color: navy });
        y -= 16;
      } else {
        for (const wl of wrapText(trimmed, CONTENT_W - 10, 9.5)) {
          ensureSpace(14);
          currentPage.drawText(wl, { x: MARGIN + 4, y, font: regFont, size: 9.5, color: darkTxt });
          y -= 13;
        }
      }
    }
  }

  // ── SIGNATURE PAGE ───────────────────────────────────────────────────────────
  const sigPage = newBodyPage();
  let sy = PAGE_H - 56;

  sigPage.drawText("Electronic Signature", { x: MARGIN, y: sy, font: boldFont, size: 16, color: navy });
  sy -= 6;
  sigPage.drawLine({ start: { x: MARGIN, y: sy }, end: { x: MARGIN + CONTENT_W, y: sy }, thickness: 1.5, color: blue });
  sy -= 22;

  sigPage.drawText(
    "By signing below, the Client confirms they have read, understood, and agreed to the Service Agreement.",
    { x: MARGIN, y: sy, font: regFont, size: 10, color: greyClr },
  );
  sy -= 30;

  if (signatureDataUrl && signatureDataUrl.startsWith("data:image/png;base64,")) {
    try {
      const base64Data = signatureDataUrl.replace("data:image/png;base64,", "");
      const sigBytes   = Buffer.from(base64Data, "base64");
      const sigImg     = await pdfDoc.embedPng(sigBytes);
      const imgW       = 240;
      const imgH       = Math.round((sigImg.height / sigImg.width) * imgW);
      sigPage.drawImage(sigImg, { x: MARGIN, y: sy - imgH, width: imgW, height: imgH });
      sy -= imgH + 8;
    } catch {
      sigPage.drawRectangle({ x: MARGIN, y: sy - 60, width: 240, height: 60, color: offWht, borderColor: borderC, borderWidth: 1 });
      sigPage.drawText("[Signature image could not be rendered]", { x: MARGIN + 10, y: sy - 38, font: regFont, size: 9, color: greyClr });
      sy -= 70;
    }
  } else {
    sigPage.drawRectangle({ x: MARGIN, y: sy - 60, width: 240, height: 60, color: offWht, borderColor: borderC, borderWidth: 1 });
    sigPage.drawText("[Electronic signature on file]", { x: MARGIN + 10, y: sy - 38, font: regFont, size: 9, color: greyClr });
    sy -= 70;
  }

  sigPage.drawLine({ start: { x: MARGIN, y: sy }, end: { x: MARGIN + 260, y: sy }, thickness: 0.75, color: navy });
  sy -= 12;
  sigPage.drawText(`${signerName}  (Client)`, { x: MARGIN, y: sy, font: regFont, size: 10, color: navy });
  sy -= 14;
  sigPage.drawText(`Signed electronically on ${signedDate}`, { x: MARGIN, y: sy, font: regFont, size: 9, color: greyClr });
  sy -= 10;
  sigPage.drawText(`Contract ref: ${contractId}`, { x: MARGIN, y: sy, font: regFont, size: 8, color: greyClr });
  sy -= 40;

  sigPage.drawText("For Shane McCaw Consulting LLC:", { x: MARGIN, y: sy, font: regFont, size: 10, color: navy });
  sy -= 14;
  sigPage.drawText("Shane McCaw", { x: MARGIN, y: sy, font: boldFont, size: 10, color: navy });
  sy -= 14;
  sigPage.drawText("Lead Microsoft 365 Architect & Consultant", { x: MARGIN, y: sy, font: regFont, size: 9, color: greyClr });

  // Footer
  sigPage.drawText(
    "This document was generated electronically and is legally binding. Shane McCaw Consulting LLC  |  info@shanemccaw.com",
    { x: MARGIN, y: 30, font: regFont, size: 7.5, color: greyClr },
  );

  // ── Save to disk ─────────────────────────────────────────────────────────────
  const pdfBytes = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);
  const invoicesDir = path.join(UPLOADS_BASE, "invoices");
  fs.mkdirSync(invoicesDir, { recursive: true });
  const filename = `contract-${contractId}-${Date.now()}.pdf`;
  const localFilePath = path.join(invoicesDir, filename);
  fs.writeFileSync(localFilePath, pdfBuffer);
  return { filename, buffer: pdfBuffer, localFilePath };
}

// ─── Onboarding provisioning helper ──────────────────────────────────────────
// Extracted from the webhook so control flow is clean (no break/return fights).
// Idempotent: checks for an existing invoice by stripeSessionId before acting.
// Supports both legacy single serviceId and new comma-separated serviceIds format.
async function provisionOnboardingProject(
  req: Request,
  session: import("stripe").Stripe.Checkout.Session,
  stripeSubscriptionId?: string | null,
  userIdOverride?: number,
): Promise<void> {
  const { userId, serviceId, serviceIds: serviceIdsStr, contractId, contractIds: contractIdsStr, servicePrices: servicePricesStr } = session.metadata ?? {};
  const uid = userIdOverride ?? parseInt(userId ?? "", 10);

  // Support both legacy (serviceId) and new (serviceIds) metadata formats
  const sids = serviceIdsStr
    ? serviceIdsStr.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    : serviceId
      ? [parseInt(serviceId, 10)].filter(n => !isNaN(n))
      : [];
  const cids = contractIdsStr
    ? contractIdsStr.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    : contractId
      ? [parseInt(contractId, 10)].filter(n => !isNaN(n))
      : [];

  // Parse per-service prices stored in checkout session metadata
  const servicePricesList: number[] = servicePricesStr
    ? servicePricesStr.split(",").map(p => parseFloat(p.trim())).filter(n => !isNaN(n))
    : [];
  // Fallback: distribute session.amount_total equally when no per-service prices available
  const sessionTotalCents = session.amount_total;

  // Legacy single-value fallback for backwards compat
  const sid = sids[0] ?? NaN;
  const cid = cids[0] ?? NaN;

  if (isNaN(uid) || sids.length === 0) {
    req.log.error({ userId, serviceIds: serviceIdsStr ?? serviceId }, "provisionOnboardingProject: invalid metadata ids");
    return;
  }

  // ── Idempotency: skip if already processed ────────────────────────────────
  const [existingInvoice] = await db
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .where(eq(invoicesTable.stripeSessionId, session.id));
  if (existingInvoice) {
    req.log.info({ sessionId: session.id }, "onboarding_purchase: already processed, skipping");
    return;
  }

  // Fetch all services for this session (ordered by sids)
  const fetchedServices = sids.length > 0
    ? await db.select().from(servicesTable)
        .where(sql`${servicesTable.id} = ANY(ARRAY[${sql.join(sids.map(id => sql`${id}`), sql`, `)}]::int[])`)
    : [];
  const serviceMap = new Map(fetchedServices.map(s => [s.id, s]));

  const [buyer] = await db.select().from(usersTable).where(eq(usersTable.id, uid));
  if (fetchedServices.length === 0 || !buyer) {
    req.log.error({ sids, uid }, "provisionOnboardingProject: services or buyer not found");
    return;
  }

  // Ordered service list matching sids order
  const orderedServices = sids.map(id => serviceMap.get(id)).filter(Boolean) as typeof fetchedServices;
  const serviceNames = orderedServices.map(s => s.name);
  // Original (pre-discount) amount: prefer per-service prices from session metadata, fall back to DB prices
  const originalAmountDollars = servicePricesList.length > 0
    ? servicePricesList.reduce((sum, p) => sum + p, 0).toFixed(2)
    : orderedServices.reduce((sum, s) => sum + (s.price ? parseFloat(String(s.price)) : 0), 0).toFixed(2);
  // Final (post-discount) amount: what Stripe actually charged
  const finalAmountDollars = sessionTotalCents != null
    ? (sessionTotalCents / 100).toFixed(2)
    : originalAmountDollars;
  // Keep totalAmountDollars pointing at the final paid amount (used for invoices etc.)
  const totalAmountDollars = finalAmountDollars;

  // Parse optional start date from checkout metadata; default to now
  const rawStart = session.metadata?.startDate;
  const parsedStart = rawStart ? new Date(rawStart) : new Date();
  const startDate = isNaN(parsedStart.getTime()) ? new Date() : parsedStart;

  // ── Create one project workspace covering all services in this session ─────
  const projectTitle = serviceNames.join(" + ");
  const [project] = await db.insert(projectsTable).values({
    title: projectTitle,
    description: orderedServices.length === 1
      ? (orderedServices[0].description ?? null)
      : `Engagement covering: ${serviceNames.join(", ")}`,
    status: "active",
    phase: "Kickoff",
    progress: 0,
    clientUserId: uid,
    startDate,
  }).returning();

  // ── Auto-create SharePoint folder for this project ────────────────────────
  if (buyer.sharepointSiteId) {
    try {
      const folderUrl = await createProjectFolder(buyer.sharepointSiteId, projectTitle);
      if (folderUrl) {
        await db.update(projectsTable)
          .set({ sharepointFolderUrl: folderUrl })
          .where(eq(projectsTable.id, project.id));
        project.sharepointFolderUrl = folderUrl;
        req.log.info({ projectId: project.id, folderUrl }, "SharePoint project folder created");
      }
    } catch (err) {
      req.log.warn({ err, projectId: project.id }, "SharePoint folder creation failed (non-fatal)");
    }
  }

  // ── Look up workflow template steps for the primary service directly ──────
  const primaryService = orderedServices[0];
  const resolvedWorkflowTemplateId = primaryService?.workflowTemplateId ?? null;

  // Workflow template steps (each step owns its task templates)
  let workflowTemplateSteps: Array<{ id: number; title: string; description: string | null; order: number }> = [];
  if (resolvedWorkflowTemplateId) {
    workflowTemplateSteps = await db
      .select()
      .from(workflowTemplateStepsTable)
      .where(eq(workflowTemplateStepsTable.workflowTemplateId, resolvedWorkflowTemplateId))
      .orderBy(asc(workflowTemplateStepsTable.order));
  }

  // ── Loop over every service: assign clientService, link contract, create invoice ──
  for (let i = 0; i < orderedServices.length; i++) {
    const svc = orderedServices[i];
    const cid = cids[i] ?? NaN;
    // Prefer per-service price from session metadata; fall back to session total ÷ services, then DB price
    const metaPrice = servicePricesList[i];
    const svcAmount = metaPrice != null && !isNaN(metaPrice)
      ? metaPrice.toFixed(2)
      : sessionTotalCents != null
        ? (sessionTotalCents / 100 / orderedServices.length).toFixed(2)
        : svc.price ? parseFloat(String(svc.price)).toFixed(2) : "0.00";

    // Assign service to client
    const [newCs] = await db.insert(clientServicesTable).values({
      clientUserId: uid,
      serviceId: svc.id,
      projectId: project.id,
      status: "active",
      progress: 0,
      startDate,
      stripeSubscriptionId: svc.billingType === "recurring_monthly" ? (stripeSubscriptionId ?? null) : null,
    }).returning();

    // ── Seed workflow steps for this client service ────────────────────────
    if (i === 0 && workflowTemplateSteps.length > 0) {
      // New: steps come from workflow template; first step auto-starts in_progress
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

      // Seed kanban tasks for the first step only
      const firstStep = createdSteps[0];
      if (firstStep?.workflowTemplateStepId) {
        const step1Tasks = await db
          .select()
          .from(workflowTemplateStepTasksTable)
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

    // Link contract → project and attach pre-generated PDF as document
    if (!isNaN(cid)) {
      const contractRecord = await db.select().from(contractsTable)
        .where(eq(contractsTable.id, cid))
        .then(r => r[0]);

      await db.update(contractsTable)
        .set({ projectId: project.id, stripeSessionId: session.id })
        .where(eq(contractsTable.id, cid));

      const pdfFilename = contractRecord?.pdfFilename;
      if (pdfFilename) {
        await db.insert(documentsTable).values({
          projectId: project.id,
          name: `Signed Service Agreement — ${svc.name}`,
          filename: pdfFilename,
          mimeType: "application/pdf",
          uploadedBy: uid,
        });
      }
    }

    // Create paid invoice for this service.
    // Only the first invoice gets stripeSessionId (idempotency guard reads it).
    const onbCouponCode = session.metadata?.couponCode ?? null;
    const onbTotalDiscount = onbCouponCode
      ? Math.max(0, parseFloat(originalAmountDollars) - parseFloat(finalAmountDollars))
      : 0;
    const onbInvoiceDiscount = onbTotalDiscount > 0 && parseFloat(originalAmountDollars) > 0
      ? (onbTotalDiscount * (parseFloat(svcAmount) / parseFloat(originalAmountDollars))).toFixed(2)
      : null;
    const [onbInvoice] = await db.insert(invoicesTable).values({
      clientUserId: uid,
      projectId: project.id,
      invoiceNumber: `ONB-${Date.now()}-${i}`,
      description: `${svc.name} — self-service purchase${svc.billingType === "recurring_monthly" ? " (month 1)" : ""}`,
      amount: svcAmount,
      currency: "usd",
      status: "paid",
      paidAt: new Date(),
      stripeSessionId: i === 0 ? session.id : null,
      couponCode: onbCouponCode,
      discountAmount: onbInvoiceDiscount,
    }).returning({ id: invoicesTable.id });
    void uploadInvoiceToSharePoint(onbInvoice.id);
  }

  // ── Notify admins ─────────────────────────────────────────────────────────
  const admins = await db.select().from(usersTable).where(eq(usersTable.role, "admin"));
  for (const admin of admins) {
    await db.insert(notificationsTable).values({
      userId: admin.id,
      title: `New onboarding purchase: ${serviceNames.join(", ")}`,
      body: `${buyer.name ?? buyer.email} purchased ${serviceNames.length > 1 ? serviceNames.join(" + ") : `"${serviceNames[0]}"`} ($${totalAmountDollars}). Project #${project.id} auto-created.`,
      type: "general",
      linkPath: `/dashboard`,
    });
  }

  // ── Notify client ─────────────────────────────────────────────────────────
  await db.insert(notificationsTable).values({
    userId: uid,
    title: `Your project is ready: ${serviceNames.join(", ")}`,
    body: `Payment confirmed. Your project workspace has been created. Shane will be in touch within 1 business day to schedule your kickoff call.`,
    type: "project_update",
    linkPath: `/portal/projects/${project.id}`,
  });

  // ── Welcome message thread ────────────────────────────────────────────────
  const [adminUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.role, "admin"))
    .limit(1);
  if (adminUser) {
    const serviceLabel = serviceNames.length === 1
      ? serviceNames[0]
      : serviceNames.join(" + ");
    await db.insert(messagesTable).values({
      clientUserId: uid,
      senderUserId: adminUser.id,
      body: `Welcome! 👋\n\nPayment confirmed for: ${serviceLabel}. Your project workspace is ready. I'll be in touch within 1 business day to schedule your kickoff call and confirm any access requirements.\n\nIf you have any questions in the meantime, feel free to message me here.\n\n— Shane`,
      readByClient: false,
      readByAdmin: true,
    });
  }

  // ── SharePoint site provisioning (fire-and-forget, non-blocking) ─────────
  void import("./admin-sharepoint").then(({ provisionClientSite }) => {
    provisionClientSite(uid, buyer.name ?? buyer.company ?? buyer.email, req.log).catch((err: unknown) => {
      req.log.warn({ err }, "SharePoint site provisioning failed (non-blocking)");
    });
  }).catch((err: unknown) => {
    req.log.warn({ err }, "Failed to import admin-sharepoint for provisioning (non-blocking)");
  });

  // ── Confirmation email to client (fire-and-forget) ────────────────────────
  const primaryServiceName = serviceNames.join(", ");
  if (buyer.email) {
    const couponCode = session.metadata?.couponCode || undefined;
    const hasDiscount = !!(couponCode && originalAmountDollars !== finalAmountDollars);
    const discountAmountDollars = hasDiscount
      ? (parseFloat(originalAmountDollars) - parseFloat(finalAmountDollars)).toFixed(2)
      : undefined;
    sendEmailFromTemplate(
      "onboarding-confirmation",
      buyer.email,
      {
        clientName: buyer.name ?? "",
        serviceName: primaryServiceName,
        amountDollars: totalAmountDollars,
        projectUrl: `${PORTAL_URL}/projects/${project.id}`,
        ...(hasDiscount ? { couponCode, originalAmountDollars, discountAmountDollars } : {}),
      },
      `Your ${primaryServiceName} project is ready — next steps inside`,
      onboardingConfirmationEmail({
        clientName: buyer.name ?? "",
        serviceName: primaryServiceName,
        amountDollars: totalAmountDollars,
        projectId: project.id,
        couponCode,
        originalAmountDollars: hasDiscount ? originalAmountDollars : undefined,
        discountAmountDollars,
      }),
    ).catch(() => null);
  }

  // ── Admin notification email (fire-and-forget) ─────────────────────────────
  const adminEmailAddr = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
  if (adminEmailAddr) {
    sendEmailFromTemplate(
      "admin-purchase-alert",
      adminEmailAddr,
      {
        clientName: buyer.name ?? "",
        clientEmail: buyer.email,
        serviceName: primaryServiceName,
        amountDollars: totalAmountDollars,
        purchaseType: "Onboarding purchase",
        portalLink: `${PORTAL_URL}/projects/${project.id}`,
      },
      `New onboarding purchase: ${primaryServiceName} — $${totalAmountDollars}`,
      adminPurchaseAlertEmail({ clientName: buyer.name ?? "", clientEmail: buyer.email, serviceName: primaryServiceName, amountDollars: totalAmountDollars, type: "onboarding_purchase", projectId: project.id }),
    ).catch(() => null);
  }
}

// ─── Default workflow step templates (mirrors Dashboard2 mock labels) ────────
// Slug matching is substring-based so "m365-health-check" hits the m365 bucket,
// "security-audit" hits security, "cloud-migration" hits migration, etc.
function getDefaultSteps(slug: string): Array<{ title: string; description: string }> {
  const s = slug.toLowerCase();

  if (s.includes("m365") || s.includes("microsoft-365") || s.includes("microsoft365") || s.includes("health-check")) {
    return [
      { title: "Access", description: "Client provisions required read-only admin access or tenant data exports." },
      { title: "Schedule", description: "Kickoff call scheduled to confirm scope, timeline, and key contacts." },
      { title: "Execute", description: "Shane runs automated and manual checks across the M365 environment." },
      { title: "Review", description: "Initial findings reviewed internally; data validated for accuracy." },
      { title: "Assessments", description: "Deep-dive assessments run against flagged areas identified during execution." },
      { title: "Report", description: "Health Check Report drafted with prioritised findings and remediation roadmap." },
      { title: "Debrief", description: "60-minute debrief call to walk through report findings and answer questions." },
      { title: "End", description: "Final report delivered. Engagement closed and next steps agreed." },
    ];
  }

  if (s.includes("security") || s.includes("audit")) {
    return [
      { title: "Intake", description: "Intake call to confirm scope, tenant access requirements, and risk appetite." },
      { title: "Scope", description: "Scope document agreed and signed off; access credentials provisioned." },
      { title: "Scan", description: "Automated and manual security scans run across the M365 tenant." },
      { title: "Analyze", description: "Findings categorised by severity (Critical / High / Medium / Low) with NIST alignment." },
      { title: "Validate", description: "Results validated and false positives filtered before drafting the report." },
      { title: "Findings", description: "Draft audit findings report shared with the client for review and corrections." },
      { title: "Strategy", description: "Remediation strategy and prioritised action plan agreed with the client." },
      { title: "Close", description: "Final audit report delivered with optional 60-minute debrief call." },
    ];
  }

  if (s.includes("migration") || s.includes("cloud") || s.includes("azure")) {
    return [
      { title: "Discovery", description: "Current environment inventory, dependencies, and constraints documented." },
      { title: "Assessment", description: "Workloads assessed for cloud readiness; risk and effort estimated." },
      { title: "Pilot", description: "Low-risk workload migrated as a proof-of-concept to validate approach." },
      { title: "Planning", description: "Full migration plan finalised — wave schedule, rollback steps, comms plan." },
      { title: "Migration", description: "Workloads migrated in agreed waves with continuous monitoring." },
      { title: "Testing", description: "Post-migration testing: functionality, performance, and security validation." },
      { title: "Go-Live", description: "Cutover to production; legacy environment decommissioned on confirmation." },
      { title: "Support", description: "Hypercare support window — issues resolved and knowledge transferred." },
    ];
  }

  if (s.includes("copilot")) {
    return [
      { title: "Intake", description: "Intake call to understand team roles, workflows, and key productivity pain points." },
      { title: "Scope", description: "Use-case shortlist agreed; licensing and data governance posture reviewed." },
      { title: "Discovery", description: "Client provides sample tasks and documents for prompt discovery." },
      { title: "Prompts", description: "Prompts written, tested, and refined across Word, Excel, Teams, Outlook, and Loop." },
      { title: "Validation", description: "Prompts validated with real client workflows and edge cases resolved." },
      { title: "Delivery", description: "Prompt library built as a SharePoint page or Word document and delivered." },
      { title: "Training", description: "Short video walkthrough recorded and prompt-maintenance guidance shared." },
      { title: "Close", description: "Engagement closed; 30-day follow-up window opens for questions." },
    ];
  }

  if (s.includes("sharepoint")) {
    return [
      { title: "Discovery", description: "60-minute discovery call to capture requirements, stakeholders, and success criteria." },
      { title: "Requirements", description: "Structured workshop to capture navigation, content types, audience, and governance rules." },
      { title: "Design", description: "Information architecture, site map, and global navigation design produced." },
      { title: "Review", description: "IA and wireframes reviewed with the client; feedback incorporated." },
      { title: "Build", description: "SharePoint sites and pages built to approved designs in the client tenant." },
      { title: "Testing", description: "User acceptance testing with key stakeholders; issues resolved." },
      { title: "Launch", description: "Intranet launched to the organisation with communications support." },
      { title: "Handover", description: "Full blueprint document and owner training delivered; engagement closed." },
    ];
  }

  if (s.includes("power")) {
    return [
      { title: "Discovery", description: "30-minute call to identify the highest-value process to automate." },
      { title: "Scope", description: "Process mapped end-to-end; automation boundaries and triggers agreed." },
      { title: "Design", description: "Solution design document produced and approved before build begins." },
      { title: "Build", description: "Power Automate flow (or app) built and unit-tested by Shane." },
      { title: "Test", description: "Flow tested in a staging environment with realistic data." },
      { title: "Refine", description: "Client feedback incorporated; edge cases and error handling added." },
      { title: "Deploy", description: "Solution deployed to production and smoke-tested end-to-end." },
      { title: "Handover", description: "Live walkthrough, documentation, and 30-day support window activated." },
    ];
  }

  // Generic fallback
  return [
    { title: "Kickoff", description: "Initial call to align on scope, deliverables, and timeline." },
    { title: "Discovery", description: "Information gathering, requirements review, and access provisioning." },
    { title: "Planning", description: "Detailed work plan produced and agreed with the client." },
    { title: "Execution", description: "Core engagement work carried out according to the agreed plan." },
    { title: "Review", description: "Draft outputs shared with the client for review and feedback." },
    { title: "Delivery", description: "Final deliverables produced and shared with the client." },
    { title: "Sign-off", description: "Client confirms acceptance of all deliverables." },
    { title: "Close", description: "Engagement closed; next steps and any follow-on work agreed." },
  ];
}

/**
 * Seed default workflow steps for a newly activated client service.
 * Idempotent: skips insertion if steps already exist for this clientServiceId.
 */
async function seedDefaultWorkflowSteps(
  clientServiceId: number,
  projectId: number | null,
  serviceSlug: string,
): Promise<void> {
  // Check if steps already exist for this client service
  const existing = await db
    .select({ id: workflowStepsTable.id })
    .from(workflowStepsTable)
    .where(eq(workflowStepsTable.clientServiceId, clientServiceId))
    .limit(1);

  if (existing.length > 0) return; // already seeded

  const steps = getDefaultSteps(serviceSlug);
  await db.insert(workflowStepsTable).values(
    steps.map((s, i) => ({
      clientServiceId,
      projectId: projectId ?? null,
      title: s.title,
      description: s.description,
      status: "pending" as const,
      order: i + 1,
    }))
  );
}

// ── Stripe webhook handler ───────────────────────────────────────────────────
// RUNBOOK: Stripe Dashboard webhook endpoints ↔ Replit Secrets
//
//  Endpoint URL                                    | Signing secret (Replit Secret)
//  ------------------------------------------------+--------------------------------
//  https://<your>.replit.dev/api/portal/stripe/webhook  | STRIPE_WEBHOOK_SECRET
//  https://shanemccaw.com/api/portal/stripe/webhook     | STRIPE_WEBHOOK_SECRET_PROD
//
//  To verify or auto-repair these registrations after a redeploy, run:
//    pnpm --filter @workspace/scripts run sync-webhooks          # check only
//    pnpm --filter @workspace/scripts run sync-webhooks -- --fix # check + auto-create
//
//  The script reads REPLIT_DOMAINS (set automatically by Replit in production)
//  and the appropriate Stripe key (STRIPE_SECRET_KEY in dev, STRIPE_SECRET_KEY_PROD
//  in production), then compares against registered Stripe endpoints.
//
//  Stripe keys by environment:
//   STRIPE_SECRET_KEY      — dev (sk_test_…), used in the Replit editor workspace
//                            (REPLIT_DOMAINS absent, or all domains end in .replit.dev)
//   STRIPE_SECRET_KEY_PROD — prod (sk_live_…), used in real deployments
//                            (REPLIT_DOMAINS present with at least one non-.replit.dev domain)
//
//  If you change the webhook path or add a new domain, re-run the script.
//
// NOTE: app.ts registers express.raw() for this path before express.json(), so req.body is a raw Buffer here.
// Supports two signing secrets simultaneously:
//   STRIPE_WEBHOOK_SECRET     — dev endpoint (*.replit.dev)
//   STRIPE_WEBHOOK_SECRET_PROD — prod endpoint (shanemccaw.com)
// The handler tries each configured secret and accepts the event if any one verifies.
router.post("/portal/stripe/webhook", async (req: Request, res: Response) => {
  // Pre-verification trace: confirms the request reached Express regardless of
  // signature validity. Logging stripe-signature presence (not the value itself).
  req.log.info({
    method: req.method,
    path: req.path,
    hasStripeSignature: !!req.headers["stripe-signature"],
    contentLength: req.headers["content-length"] ?? null,
  }, "stripe webhook: request received");

  let stripeKey: string;
  try { stripeKey = getStripeKey(); } catch (e) { res.status(503).send((e as Error).message); return; }

  const secrets = [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_WEBHOOK_SECRET_PROD,
  ].filter(Boolean) as string[];

  if (secrets.length === 0) {
    res.status(503).send("Stripe webhook not configured. Set STRIPE_WEBHOOK_SECRET or STRIPE_WEBHOOK_SECRET_PROD.");
    return;
  }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  let event: import("stripe").Stripe.Event | null = null;
  const sig = req.headers["stripe-signature"] as string;
  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, secret);
      break;
    } catch {
      // try next secret
    }
  }

  if (!event) {
    res.status(400).send("Webhook signature verification failed");
    return;
  }

  // ── Acknowledge immediately so Stripe doesn't retry on slow provisioning ──
  res.json({ received: true });

  // ── Process event asynchronously (after response is flushed) ─────────────
  setImmediate(() => {
    void processStripeEvent(req, event).catch((err: unknown) => {
      req.log.error({ err, eventType: event.type }, "processStripeEvent: unhandled error");
    });
  });
});

// ── Admin: manual Stripe session replay ──────────────────────────────────────
// POST /api/admin/stripe/replay-session  { sessionId: "cs_…" }
// Fetches the Checkout Session from Stripe, constructs a synthetic
// checkout.session.completed event, and runs it through processStripeEvent.
// Idempotent: if the invoice already exists, returns status "already_processed".
router.post("/admin/stripe/replay-session", requireAdmin, async (req: Request, res: Response) => {
  const { sessionId } = req.body as { sessionId?: string };
  if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
    res.status(400).json({ error: "sessionId is required (e.g. cs_test_…)" });
    return;
  }

  let stripeKey: string;
  try { stripeKey = getStripeKey(); } catch (e) { res.status(503).json({ error: (e as Error).message }); return; }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  let session: import("stripe").Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId.trim());
  } catch (e) {
    res.status(404).json({ error: `Stripe session not found: ${(e as Error).message}` });
    return;
  }

  if (session.payment_status !== "paid") {
    res.status(422).json({
      error: `Session payment_status is "${session.payment_status}" — only "paid" sessions can be replayed`,
    });
    return;
  }

  // Check whether this session has already been processed
  const [preExisting] = await db
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .where(eq(invoicesTable.stripeSessionId, sessionId.trim()))
    .limit(1);

  if (preExisting) {
    req.log.info({ sessionId, invoiceId: preExisting.id }, "admin replay-session: already processed — skipping");
    res.json({ status: "already_processed", sessionId, invoiceId: preExisting.id });
    return;
  }

  // Construct a minimal synthetic Stripe event so processStripeEvent can handle it
  const syntheticEvent = {
    id: `replay_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    livemode: session.livemode,
    created: Math.floor(Date.now() / 1000),
    api_version: "2024-06-20",
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: { object: session },
  } as unknown as import("stripe").Stripe.Event;

  try {
    await processStripeEvent(req, syntheticEvent);
  } catch (e) {
    req.log.error({ err: e, sessionId }, "admin replay-session: processStripeEvent threw");
    res.status(500).json({ error: `Processing failed: ${e instanceof Error ? e.message : String(e)}` });
    return;
  }

  const [created] = await db
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .where(eq(invoicesTable.stripeSessionId, sessionId.trim()))
    .limit(1);

  req.log.info({ sessionId, invoiceId: created?.id }, "admin replay-session: completed");
  res.json({ status: "created", sessionId, invoiceId: created?.id ?? null });
});

async function processStripeEvent(req: Request, event: import("stripe").Stripe.Event): Promise<void> {
  // Top-level guard: any unhandled error inside this function is logged with full
  // context (event type, session ID, message, stack) before being re-thrown so
  // that the caller's .catch() also has visibility.
  const _sessionObj = event.type === "checkout.session.completed"
    ? (event.data.object as import("stripe").Stripe.Checkout.Session)
    : null;
  try {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as import("stripe").Stripe.Checkout.Session;

    // Invoice payment
    const invoiceId = session.metadata?.invoiceId;
    if (invoiceId && session.payment_status === "paid") {
      const parsedInvoiceId = parseInt(invoiceId, 10);
      const [paidInvoice] = await db.update(invoicesTable)
        .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
        .where(eq(invoicesTable.id, parsedInvoiceId))
        .returning();
      if (paidInvoice) {
        void createAuditLog({
          actorUserId: paidInvoice.clientUserId ?? undefined,
          actorName: session.customer_details?.name ?? session.customer_email ?? "Client",
          actorRole: "client",
          actionType: "invoice_paid",
          entityType: "invoice",
          entityId: parsedInvoiceId,
          entityLabel: paidInvoice.description ?? `Invoice #${parsedInvoiceId}`,
          clientId: paidInvoice.clientUserId ?? undefined,
          projectId: paidInvoice.projectId ?? undefined,
          metadata: { amountDollars: paidInvoice.amount, stripeSessionId: session.id },
        });
      }
    }

    // Service purchase — notify admin, create invoice record
    if (session.metadata?.type === "service_purchase" && session.payment_status === "paid") {
      const { userId, serviceName, serviceCategory, servicePriceInCents } = session.metadata;
      const uid = parseInt(userId, 10);
      const amountDollars = (parseInt(servicePriceInCents, 10) / 100).toFixed(2);

      // Create a paid invoice so it shows in billing history
      const svcCouponCode = session.metadata?.couponCode ?? null;
      const svcFinalAmount = session.amount_total != null ? session.amount_total / 100 : parseFloat(amountDollars);
      const svcDiscountAmount = svcCouponCode && svcFinalAmount < parseFloat(amountDollars)
        ? (parseFloat(amountDollars) - svcFinalAmount).toFixed(2)
        : null;
      const [newInvoice] = await db.insert(invoicesTable).values({
        clientUserId: uid,
        invoiceNumber: `SVC-${Date.now()}`,
        description: `${serviceName} — purchased via portal`,
        amount: amountDollars,
        currency: "usd",
        status: "paid",
        paidAt: new Date(),
        stripeSessionId: session.id,
        couponCode: svcCouponCode,
        discountAmount: svcDiscountAmount,
      }).returning({ id: invoicesTable.id });
      void uploadInvoiceToSharePoint(newInvoice.id);

      // Notify the admin user(s)
      const admins = await db.select().from(usersTable).where(eq(usersTable.role, "admin"));
      const [buyer] = await db.select().from(usersTable).where(eq(usersTable.id, uid));
      for (const admin of admins) {
        await db.insert(notificationsTable).values({
          userId: admin.id,
          title: `New service purchase: ${serviceName}`,
          body: `${buyer?.email ?? "A client"} purchased "${serviceName}" ($${amountDollars}). Please activate the service in their portal.`,
          type: "general",
          linkPath: "/portal/services",
        });
      }

      // Send branded confirmation email to buyer (fire-and-forget)
      if (buyer?.email) {
        const couponCode = session.metadata?.couponCode || undefined;
        const finalAmountDollars = session.amount_total != null
          ? (session.amount_total / 100).toFixed(2)
          : amountDollars;
        const hasDiscount = !!(couponCode && finalAmountDollars !== amountDollars);
        const discountAmountDollars = hasDiscount
          ? (parseFloat(amountDollars) - parseFloat(finalAmountDollars)).toFixed(2)
          : undefined;
        sendEmailFromTemplate(
          "purchase-confirmation",
          buyer.email,
          {
            clientName: buyer.name ?? "",
            serviceName,
            amountDollars: finalAmountDollars,
            portalLink: PORTAL_URL,
            ...(hasDiscount ? { couponCode, originalAmountDollars: amountDollars, discountAmountDollars } : {}),
          },
          `Your purchase of "${serviceName}" is confirmed`,
          purchaseConfirmationEmail({
            clientName: buyer.name ?? "",
            serviceName,
            amountDollars: finalAmountDollars,
            couponCode,
            originalAmountDollars: hasDiscount ? amountDollars : undefined,
            discountAmountDollars,
          }),
        ).catch((e) => req.log.warn({ err: e, sessionId: session.id, template: "purchase-confirmation" }, "processStripeEvent: buyer confirmation email failed (non-fatal)"));
      }

      // Send admin notification email (fire-and-forget)
      const adminEmail = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
      if (adminEmail) {
        sendEmailFromTemplate(
          "admin-purchase-alert",
          adminEmail,
          {
            clientName: buyer?.name ?? "",
            clientEmail: buyer?.email ?? "",
            serviceName,
            amountDollars,
            purchaseType: "Service purchase",
            portalLink: PORTAL_URL,
          },
          `New purchase: ${serviceName} — $${amountDollars}`,
          adminPurchaseAlertEmail({ clientName: buyer?.name ?? "", clientEmail: buyer?.email ?? "", serviceName, amountDollars, type: "service_purchase" }),
        ).catch((e) => req.log.warn({ err: e, sessionId: session.id, template: "admin-purchase-alert" }, "processStripeEvent: admin purchase alert email failed (non-fatal)"));
      }

      // Audit log
      void createAuditLog({
        actorUserId: uid,
        actorName: buyer?.name ?? buyer?.email ?? "Client",
        actorRole: "client",
        actionType: "service_purchased",
        entityType: "service",
        entityId: session.metadata?.serviceId ?? null,
        entityLabel: serviceName,
        clientId: uid,
        metadata: { amount: amountDollars, category: serviceCategory },
      });

      // SMS alert to Shane
      sendAdminSms(
        `New order: ${buyer?.name ?? buyer?.email ?? "A client"} — ${serviceName} — $${amountDollars}`,
      ).catch((e) => req.log.warn({ err: e, sessionId: session.id }, "processStripeEvent: SMS alert failed (non-fatal)"));

      // Push notification to Shane's devices
      db.select({ token: deviceTokensTable.token }).from(deviceTokensTable)
        .then(async (rows) => {
          const tokens = rows.map((r) => r.token);
          // Unread messages + 1 for this new order gives an accurate cumulative badge
          const badge = await getAdminUnreadMessageCount() + 1;
          return sendPushNotifications(
            tokens,
            "New Order",
            `${buyer?.name ?? buyer?.email ?? "Client"} — ${serviceName} — $${amountDollars}`,
            { screen: "order", id: String(newInvoice?.id ?? "") },
            undefined,
            badge,
          );
        })
        .catch((e) => req.log.warn({ err: e, sessionId: session.id }, "processStripeEvent: push notification failed (non-fatal)"));
    }

    // Increment coupon uses atomically and idempotently.
    // We INSERT a redemption record keyed by checkout_session_id. If Stripe retries the
    // same webhook event, the UNIQUE constraint fires and rowCount=0 — we skip the increment.
    if (session.payment_status === "paid" && session.metadata?.couponCode) {
      const couponCodeUsed = session.metadata.couponCode;
      const sessionId = session.id;
      const redemptionUserId = session.metadata?.userId
        ? (parseInt(session.metadata.userId, 10) || null)
        : null;
      const redemptionPurchaseAmount = session.amount_total != null
        ? String(session.amount_total / 100)
        : null;
      const redemptionDiscountAmount = (session.total_details as { amount_discount?: number } | null)?.amount_discount != null
        ? String((session.total_details as { amount_discount: number }).amount_discount / 100)
        : null;
      try {
        const insertResult = await db.execute(
          sql`INSERT INTO coupon_redemptions (coupon_code, checkout_session_id, coupon_id, user_id, purchase_amount, discount_amount)
              VALUES (
                ${couponCodeUsed},
                ${sessionId},
                (SELECT id FROM coupons WHERE code = ${couponCodeUsed}),
                ${redemptionUserId},
                ${redemptionPurchaseAmount},
                ${redemptionDiscountAmount}
              )
              ON CONFLICT (checkout_session_id) DO NOTHING`,
        );
        // Only increment if this is the first time we're processing this session
        if ((insertResult as { rowCount?: number }).rowCount ?? 0 > 0) {
          await db.update(couponsTable)
            .set({
              usesCount: sql`${couponsTable.usesCount} + 1`,
              active: sql`CASE WHEN ${couponsTable.maxUses} IS NOT NULL AND ${couponsTable.usesCount} + 1 >= ${couponsTable.maxUses} THEN false ELSE ${couponsTable.active} END`,
            })
            .where(eq(couponsTable.code, couponCodeUsed));
        }
      } catch (err) {
        req.log.warn({ err, couponCode: couponCodeUsed, sessionId }, "processStripeEvent: failed to increment coupon uses");
      }
    }

    // Onboarding purchase — auto-provision project + workflow steps
    if (session.metadata?.type === "onboarding_purchase" && session.payment_status === "paid") {
      const subId = typeof session.subscription === "string"
        ? session.subscription
        : (session.subscription as { id?: string } | null)?.id ?? null;

      // Resolve the buyer: user sessions carry metadata.userId; guests are identified
      // by metadata.guestEmail (or the Stripe customer_details email).
      let webhookUserIdOverride: number | null = null;
      const webhookMetaUserId = session.metadata?.userId;
      if (webhookMetaUserId) {
        webhookUserIdOverride = parseInt(webhookMetaUserId, 10) || null;
      } else {
        const guestEmailMeta =
          session.metadata?.guestEmail ??
          (session.customer_details as { email?: string } | null)?.email ??
          null;
        if (guestEmailMeta) {
          const acct = await ensureClientAccount(guestEmailMeta);
          webhookUserIdOverride = acct.id;
          // Link any pre-payment guest contracts to the new account
          await db.update(contractsTable)
            .set({ userId: webhookUserIdOverride })
            .where(and(eq(contractsTable.guestEmail, guestEmailMeta), isNull(contractsTable.userId)));
        }
      }

      await provisionOnboardingProject(req, session, subId, webhookUserIdOverride ?? undefined);

      // SMS alert to Shane — look up buyer + services after provisioning
      try {
        const uid = webhookUserIdOverride ?? parseInt(session.metadata?.userId ?? "", 10);
        const [buyer] = isNaN(uid) ? [] : await db.select().from(usersTable).where(eq(usersTable.id, uid));
        const sidsStr = session.metadata?.serviceIds ?? session.metadata?.serviceId ?? "";
        const sids = sidsStr.split(",").map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));
        let serviceLabel = "Onboarding";
        if (sids.length > 0) {
          const svcs = await db.select({ name: servicesTable.name }).from(servicesTable)
            .where(inArray(servicesTable.id, sids));
          if (svcs.length > 0) serviceLabel = svcs.map(s => s.name).join(", ");
        }
        const totalDollars = session.amount_total ? (session.amount_total / 100).toFixed(2) : "—";
        sendAdminSms(
          `New order: ${buyer?.name ?? buyer?.email ?? "A client"} — ${serviceLabel} — $${totalDollars}`,
        ).catch((e) => req.log.warn({ err: e, sessionId: session.id }, "processStripeEvent: onboarding SMS alert failed (non-fatal)"));

        // Push notification to Shane's devices — look up the invoice ID created during provisioning
        const buyerLabel = buyer?.name ?? buyer?.email ?? "A client";
        db.select({ token: deviceTokensTable.token }).from(deviceTokensTable)
          .then(async (rows) => {
            const tokens = rows.map((r) => r.token);
            // Find the first invoice for this session so the push can deep-link to it
            const [firstInv] = await db
              .select({ id: invoicesTable.id })
              .from(invoicesTable)
              .where(eq(invoicesTable.stripeSessionId, session.id))
              .limit(1);
            const pushData: Record<string, string> = firstInv?.id
              ? { screen: "order", id: String(firstInv.id) }
              : { screen: "orders" };
            // Unread messages + 1 for this new order gives an accurate cumulative badge
            const badge = await getAdminUnreadMessageCount() + 1;
            return sendPushNotifications(
              tokens,
              "New Order",
              `${buyerLabel} — ${serviceLabel} — $${totalDollars}`,
              pushData,
              undefined,
              badge,
            );
          })
          .catch((e) => req.log.warn({ err: e, sessionId: session.id }, "processStripeEvent: onboarding push notification failed (non-fatal)"));

        // Client welcome emails — sent once per session using idempotency checks.
        if (buyer?.email) {
          const clientBaseUrl = getPortalBaseUrl();

          if (!buyer.passwordHash) {
            // Atomic: advisory-locked transaction finds an existing valid token or
            // creates one — concurrent webhook + success-page calls produce exactly one.
            const { token: setupToken, isNew: tokenIsNew } = await ensureClientSetupToken(buyer.id);
            if (tokenIsNew) {
              const setupUrl = `${clientBaseUrl}/portal/onboarding/success?setup_token=${setupToken}`;
              void sendEmailFromTemplate(
                "account-setup",
                buyer.email,
                { setupLink: setupUrl, clientName: buyer.name ?? buyer.email },
                "Set up your Shane McCaw Consulting portal",
                `<p>Hi ${buyer.name ?? ""},</p><p>Your project workspace is ready. Click the link below to set your portal password:</p><p><a href="${setupUrl}" style="color:#0078D4;">Set my password →</a></p><p>This link expires in 72 hours.</p><p>— Shane McCaw</p>`,
              ).catch((e) => req.log.warn({ err: e, sessionId: session.id, template: "account-setup" }, "processStripeEvent: account-setup email failed (non-fatal)"));
            }
          } else {
            // Returning client — send "project is ready" email.
            // The success-page provision endpoint guards against sending this a second time
            // (it checks whether the invoice existed before its own provisioning call).
            void sendEmailFromTemplate(
              "onboarding-confirmation",
              buyer.email,
              {
                clientName: buyer.name ?? buyer.email,
                serviceName: serviceLabel,
                amountDollars: session.amount_total ? String(Math.round(session.amount_total / 100)) : "0",
                projectUrl: clientBaseUrl,
              },
              "Your project workspace is ready — Shane McCaw Consulting",
              `<p>Hi ${buyer.name ?? ""},</p><p>Your <strong>${serviceLabel}</strong> project workspace is ready. Log in to your portal to track progress.</p><p><a href="${clientBaseUrl}" style="color:#0078D4;">View your portal →</a></p><p>— Shane McCaw</p>`,
            ).catch((e) => req.log.warn({ err: e, sessionId: session.id, template: "onboarding-confirmation" }, "processStripeEvent: onboarding-confirmation email failed (non-fatal)"));
          }
        }
      } catch (notifyErr) {
        // SMS/push/email failure must never break provisioning, but log it
        req.log.warn({ err: notifyErr, sessionId: session.id, eventType: event.type }, "processStripeEvent: post-provision notification failed (non-fatal)");
      }
    }
  }
  } catch (err) {
    req.log.error(
      {
        err,
        eventType: event.type,
        sessionId: _sessionObj?.id ?? null,
        errorMessage: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      "processStripeEvent: unhandled error — provisioning may be incomplete",
    );
    throw err;
  }
}

// ─── CLIENT: Messages ────────────────────────────────────────────────────────
router.get("/portal/messages", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const isAdmin = req.user!.role === "admin";

  if (isAdmin) {
    const clientId = parseInt(String(req.query.clientId ?? ""), 10);
    if (isNaN(clientId)) { res.status(400).json({ error: "clientId required for admin" }); return; }
    const [clientUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, clientId)).limit(1);
    if (!clientUser) { res.status(404).json({ error: "Client not found" }); return; }
    const messages = await db.select().from(messagesTable)
      .where(eq(messagesTable.clientUserId, clientId))
      .orderBy(asc(messagesTable.createdAt));
    await db.update(messagesTable).set({ readByAdmin: true }).where(and(eq(messagesTable.clientUserId, clientId), eq(messagesTable.readByAdmin, false)));
    res.json(messages);
  } else {
    const messages = await db.select().from(messagesTable)
      .where(eq(messagesTable.clientUserId, userId))
      .orderBy(asc(messagesTable.createdAt));
    await db.update(messagesTable).set({ readByClient: true }).where(and(eq(messagesTable.clientUserId, userId), eq(messagesTable.readByClient, false)));
    res.json(messages);
  }
});

router.post("/portal/messages", requireAuth, async (req: Request, res: Response) => {
  const senderId = req.user!.id;
  const isAdmin = req.user!.role === "admin";
  const { body, clientId } = req.body as { body?: string; clientId?: number };

  if (!body?.trim()) { res.status(400).json({ error: "body is required" }); return; }

  const clientUserId = isAdmin ? Number(clientId) : senderId;
  if (!clientUserId || isNaN(clientUserId)) { res.status(400).json({ error: "clientId required" }); return; }

  const [msg] = await db.insert(messagesTable).values({
    clientUserId,
    senderUserId: senderId,
    body: body.trim(),
    readByAdmin: isAdmin,
    readByClient: !isAdmin,
  }).returning();

  // When admin replies, mark all unread client messages in this conversation as read
  if (isAdmin) {
    await db.update(messagesTable)
      .set({ readByAdmin: true })
      .where(and(eq(messagesTable.clientUserId, clientUserId), eq(messagesTable.readByAdmin, false)));
  }

  // Create in-app notification + email for the other party
  if (isAdmin) {
    await db.insert(notificationsTable).values({
      userId: clientUserId,
      title: "New message from Shane",
      body: body.trim().slice(0, 100),
      type: "message",
      linkPath: "/portal/messages",
    });
    // Email the client
    const [clientUser] = await db.select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable).where(eq(usersTable.id, clientUserId)).limit(1);
    if (clientUser) {
      void sendEmailFromTemplate(
        "client-message-notification",
        clientUser.email,
        {
          clientName: clientUser.name ?? "",
          messageBody: body.trim(),
          portalLink: "https://shanemccaw.consulting/crm/portal/messages",
        },
        "New message from Shane McCaw Consulting",
        `
        <p>Hello ${clientUser.name ?? ""},</p>
        <p>You have a new message from Shane McCaw Consulting:</p>
        <blockquote style="border-left:3px solid #0078D4;padding:8px 12px;color:#333;margin:12px 0;">${body.trim()}</blockquote>
        <p><a href="https://shanemccaw.consulting/crm/portal/messages" style="color:#0078D4;font-weight:bold;">View in your portal →</a></p>
        `,
      );
    }
  } else {
    const [adminUser] = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(eq(usersTable.role, "admin")).limit(1);
    if (adminUser) {
      await db.insert(notificationsTable).values({
        userId: adminUser.id,
        title: "New client message",
        body: body.trim().slice(0, 100),
        type: "message",
        linkPath: `/dashboard/messages?clientId=${senderId}`,
      });
      // Email the admin
      const [clientUser] = await db.select({ name: usersTable.name, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, senderId)).limit(1);
      const senderLabel = clientUser?.name ?? clientUser?.email ?? "a client";
      void sendEmailFromTemplate(
        "admin-message-notification",
        adminUser.email,
        {
          clientName: clientUser?.name ?? clientUser?.email ?? "A client",
          messageBody: body.trim(),
        },
        `New client message from ${senderLabel}`,
        `
        <p>Hello Shane,</p>
        <p>${clientUser?.name ?? "A client"} sent a new message:</p>
        <blockquote style="border-left:3px solid #0078D4;padding:8px 12px;color:#333;margin:12px 0;">${body.trim()}</blockquote>
        `,
      );
      // Push notification to Shane's devices
      const clientName = clientUser?.name ?? clientUser?.email ?? "A client";
      db.select({ token: deviceTokensTable.token }).from(deviceTokensTable)
        .then(async (rows) => {
          const tokens = rows.map((r) => r.token);
          // The new message is already in the DB (readByAdmin = false), so the count
          // naturally includes it — this gives an accurate cumulative unread badge.
          const badge = await getAdminUnreadMessageCount();
          return sendPushNotifications(
            tokens,
            "New Client Message",
            `${clientName}: ${body.trim().slice(0, 80)}`,
            { screen: "conversation", clientId: String(senderId) },
            "MESSAGE",
            badge,
          );
        })
        .catch(() => null);
    }
  }

  res.status(201).json(msg);
});

// ─── CLIENT: Notifications ───────────────────────────────────────────────────
router.get("/portal/notifications", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const notifications = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  res.json(notifications);
});

router.patch("/portal/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.update(notificationsTable).set({ read: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
  res.json({ ok: true });
});

router.post("/portal/notifications/read-all", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await db.update(notificationsTable).set({ read: true })
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, false)));
  res.json({ ok: true });
});

// ─── ADMIN: Clients ──────────────────────────────────────────────────────────
router.get("/admin/clients", requireAdmin, async (_req: Request, res: Response) => {
  const clients = await db.select().from(usersTable)
    .where(eq(usersTable.role, "client"))
    .orderBy(desc(usersTable.createdAt));
  res.json(clients.map(c => ({ ...c, passwordHash: undefined })));
});

router.get("/admin/clients/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [client] = await db.select().from(usersTable)
    .where(and(eq(usersTable.id, id), eq(usersTable.role, "client")));
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  res.json({ ...client, passwordHash: undefined });
});

router.post("/admin/clients", requireAdmin, async (req: Request, res: Response) => {
  const { email, name, company, phone } = req.body as { email?: string; name?: string; company?: string; phone?: string };
  if (!email) { res.status(400).json({ error: "email is required" }); return; }

  const normalizedEmail = email.toLowerCase().trim();

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.email, normalizedEmail)).limit(1);
  if (existing) { res.status(409).json({ error: "An account with this email already exists" }); return; }

  const [client] = await db.insert(usersTable).values({
    email: normalizedEmail,
    passwordHash: null,
    role: "client",
    name: name ?? null,
    company: company ?? null,
    phone: phone ?? null,
  }).returning();

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "client_created",
    entityType: "user",
    entityId: client.id,
    entityLabel: client.name ?? client.email,
  });

  // Generate a setup token and send the portal invite email
  try {
    const { token: setupToken } = await ensureClientSetupToken(client.id);
    const baseUrl = getPortalBaseUrl();
    const setupUrl = `${baseUrl}/portal/onboarding/success?setup_token=${setupToken}`;
    void sendEmailFromTemplate(
      "account-setup",
      client.email,
      { setupLink: setupUrl, clientName: client.name ?? client.email },
      "You've been invited to Shane McCaw Consulting — set up your portal",
      `<p>Hi ${client.name ?? ""},</p><p>Shane McCaw has set up a client portal for you. Click the link below to create your password and access your workspace:</p><p style="margin:24px 0;"><a href="${setupUrl}" style="display:inline-block;background:#0078D4;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Set up my portal →</a></p><p style="color:#888;font-size:13px;">This link expires in 72 hours. If it expires, you can request a new one from the login page.</p><p>— Shane McCaw</p>`,
    ).catch(() => null);
  } catch (err) {
    req.log.warn({ err, clientId: client.id }, "Failed to send invite email after client creation");
  }

  res.status(201).json({ ...client, passwordHash: undefined });
});

// ─── Resend portal invite ─────────────────────────────────────────────────────
router.post("/admin/clients/:id/resend-invite", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid client ID" }); return; }

    const [client] = await db.select().from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "client"))).limit(1);
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    // Force a fresh token: delete any existing tokens (expired, used, or still valid)
    // so the resent link is always a brand-new 72-hour window.
    await db.delete(accountSetupTokensTable).where(eq(accountSetupTokensTable.userId, id));

    const { randomBytes } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    await db.insert(accountSetupTokensTable).values({ userId: id, token, expiresAt });

    const baseUrl = getPortalBaseUrl();
    const setupUrl = `${baseUrl}/portal/onboarding/success?setup_token=${token}`;

    await sendEmailFromTemplate(
      "account-setup",
      client.email,
      { setupLink: setupUrl, clientName: client.name ?? client.email },
      "Your Shane McCaw Consulting portal invite (resent)",
      `<p>Hi ${client.name ?? ""},</p><p>Here is a new link to set up your portal password:</p><p style="margin:24px 0;"><a href="${setupUrl}" style="display:inline-block;background:#0078D4;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Set up my portal →</a></p><p style="color:#888;font-size:13px;">This link expires in 72 hours.</p><p>— Shane McCaw</p>`,
    );

    void createAuditLog({
      actorUserId: req.user!.id,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: "admin",
      actionType: "client_invite_resent",
      entityType: "user",
      entityId: client.id,
      entityLabel: client.name ?? client.email,
    });

    res.json({ ok: true });
  } catch (err) {
    req.log.error(err, "Failed to resend client invite");
    res.status(500).json({ error: "Failed to resend invite" });
  }
});

router.patch("/admin/clients/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { name, company, phone, email } = req.body as { name?: string; company?: string; phone?: string; email?: string };
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (company !== undefined) updates.company = company;
  if (phone !== undefined) updates.phone = phone;
  if (email !== undefined) updates.email = email.toLowerCase().trim();

  const [updated] = await db.update(usersTable).set(updates).where(and(eq(usersTable.id, id), eq(usersTable.role, "client"))).returning();
  if (!updated) { res.status(404).json({ error: "Client not found" }); return; }
  res.json({ ...updated, passwordHash: undefined });
});

router.get("/admin/clients/:id/delete-preview", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [client] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "client"))).limit(1);
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const [
      projectRows,
      invoiceRows,
      contractRows,
      messageRows,
      serviceRows,
      reportRows,
      statusReportRows,
    ] = await Promise.all([
      db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.clientUserId, id)),
      db.select({ id: invoicesTable.id, status: invoicesTable.status }).from(invoicesTable).where(eq(invoicesTable.clientUserId, id)),
      db.select({ id: contractsTable.id }).from(contractsTable).where(eq(contractsTable.userId, id)),
      db.select({ id: messagesTable.id }).from(messagesTable).where(eq(messagesTable.clientUserId, id)),
      db.select({ id: clientServicesTable.id, stripeSubscriptionId: clientServicesTable.stripeSubscriptionId })
        .from(clientServicesTable).where(eq(clientServicesTable.clientUserId, id)),
      db.select({ id: reportsTable.id }).from(reportsTable).where(eq(reportsTable.clientUserId, id)),
      db.select({ id: statusReportsTable.id }).from(statusReportsTable).where(eq(statusReportsTable.clientUserId, id)),
    ]);

    const unpaidInvoices = invoiceRows.filter(inv => inv.status === "due" || inv.status === "overdue").length;
    const hasActiveStripeSubscription = serviceRows.some(s => s.stripeSubscriptionId != null);

    res.json({
      projects: projectRows.length,
      invoices: invoiceRows.length,
      unpaidInvoices,
      contracts: contractRows.length,
      messages: messageRows.length,
      services: serviceRows.length,
      reports: reportRows.length,
      statusReports: statusReportRows.length,
      hasActiveStripeSubscription,
    });
  } catch (err) {
    req.log.error(err, "Failed to fetch client delete preview");
    res.status(500).json({ error: "Failed to fetch delete preview" });
  }
});

router.delete("/admin/clients/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [client] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "client"))).limit(1);
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const clientProjectRows = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(eq(projectsTable.clientUserId, id));
    const projectIds = clientProjectRows.map(p => p.id);

    const clientSvcRows = await db.select({ id: clientServicesTable.id }).from(clientServicesTable)
      .where(eq(clientServicesTable.clientUserId, id));
    const clientSvcIds = clientSvcRows.map(s => s.id);

    if (projectIds.length > 0) {
      await db.delete(kanbanTasksTable).where(inArray(kanbanTasksTable.projectId, projectIds));
      await db.delete(projectUpdatesTable).where(inArray(projectUpdatesTable.projectId, projectIds));
      await db.delete(documentsTable).where(inArray(documentsTable.projectId, projectIds));
      await db.delete(workflowStepsTable).where(inArray(workflowStepsTable.projectId, projectIds));
    }
    if (clientSvcIds.length > 0) {
      await db.delete(workflowStepsTable).where(inArray(workflowStepsTable.clientServiceId, clientSvcIds));
    }
    await db.delete(statusReportsTable).where(eq(statusReportsTable.clientUserId, id));
    await db.delete(clientServicesTable).where(eq(clientServicesTable.clientUserId, id));
    await db.delete(contractsTable).where(eq(contractsTable.userId, id));
    await db.delete(reportsTable).where(eq(reportsTable.clientUserId, id));
    await db.delete(invoicesTable).where(eq(invoicesTable.clientUserId, id));
    await db.delete(messagesTable).where(eq(messagesTable.clientUserId, id));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, id));
    await db.delete(impersonationTokensTable).where(eq(impersonationTokensTable.clientUserId, id));
    await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, id));
    await db.update(emailsTable).set({ linkedUserId: null }).where(eq(emailsTable.linkedUserId, id));
    await db.delete(emailDomainRulesTable).where(eq(emailDomainRulesTable.linkedUserId, id));
    if (projectIds.length > 0) {
      await db.delete(projectsTable).where(inArray(projectsTable.id, projectIds));
    }
    await db.delete(usersTable).where(eq(usersTable.id, id));

    res.status(204).end();
  } catch (err) {
    req.log.error(err, "Failed to delete client");
    res.status(500).json({ error: "Failed to delete client" });
  }
});

// ─── ADMIN: M365 Environment Profile ─────────────────────────────────────────
router.get("/admin/clients/:id/m365-profile", requireAdmin, async (req: Request, res: Response) => {
  const clientId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid client ID" }); return; }
  const [row] = await db.select().from(clientM365ProfilesTable).where(eq(clientM365ProfilesTable.clientId, clientId));
  res.json({ profile: row?.profile ?? null, updatedAt: row?.updatedAt ?? null });
});

router.put("/admin/clients/:id/m365-profile", requireAdmin, async (req: Request, res: Response) => {
  const clientId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid client ID" }); return; }
  const { profile } = req.body as { profile: Record<string, unknown> };
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    res.status(400).json({ error: "profile must be a plain object" }); return;
  }
  await db.insert(clientM365ProfilesTable)
    .values({ clientId, profile })
    .onConflictDoUpdate({ target: clientM365ProfilesTable.clientId, set: { profile, updatedAt: new Date() } });

  // Compute health scores and save snapshot (same logic as portal PUT)
  try {
    const scores = computeM365Scores(profile);
    const recentRows = await db
      .select({ category: clientHealthHistoryTable.category, score: clientHealthHistoryTable.score })
      .from(clientHealthHistoryTable)
      .where(eq(clientHealthHistoryTable.clientId, clientId))
      .orderBy(desc(clientHealthHistoryTable.recordedAt))
      .limit(10);
    const latestByCategory: Partial<Record<M365ScoreCategory, number>> = {};
    for (const row of recentRows) {
      const cat = row.category as M365ScoreCategory;
      if (!(cat in latestByCategory)) latestByCategory[cat] = row.score;
    }
    const hasChanged = (Object.entries(scores) as [M365ScoreCategory, number][])
      .some(([cat, score]) => latestByCategory[cat] !== score);
    if (hasChanged) {
      const now = new Date();
      await db.insert(clientHealthHistoryTable).values(
        (Object.entries(scores) as [M365ScoreCategory, number][]).map(([category, score]) => ({
          clientId,
          category,
          score,
          recordedAt: now,
        }))
      );
    }
  } catch (err) {
    req.log.warn({ err }, "admin m365-profile: failed to save health snapshot (non-fatal)");
  }

  res.json({ ok: true });
});

// ─── ADMIN: M365 Profile — PDF export ────────────────────────────────────────
router.get("/admin/clients/:id/m365-profile/pdf", requireAdmin, async (req: Request, res: Response) => {
  const clientId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid client ID" }); return; }

  const [profileRow] = await db
    .select({ profile: clientM365ProfilesTable.profile })
    .from(clientM365ProfilesTable)
    .where(eq(clientM365ProfilesTable.clientId, clientId));

  if (!profileRow) { res.status(404).json({ error: "No M365 profile found for this client" }); return; }

  const [clientRow] = await db
    .select({ name: usersTable.name, email: usersTable.email, company: usersTable.company })
    .from(usersTable)
    .where(eq(usersTable.id, clientId));

  try {
    const pdfBuffer = await generateM365ProfilePdf({
      clientName: clientRow?.name ?? null,
      clientEmail: clientRow?.email ?? "",
      clientCompany: clientRow?.company ?? null,
      generatedAt: new Date(),
      profile: profileRow.profile as Record<string, unknown>,
    });

    const safeName = (clientRow?.company ?? clientRow?.name ?? `client-${clientId}`)
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="m365-assessment-${safeName}.pdf"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.send(pdfBuffer);
  } catch (err) {
    req.log.error(err, "Failed to generate M365 profile PDF");
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// ─── ADMIN: M365 Intelligence (all profiles) ─────────────────────────────────
router.get("/admin/m365-profiles", requireAdmin, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        clientId: clientM365ProfilesTable.clientId,
        profile: clientM365ProfilesTable.profile,
        updatedAt: clientM365ProfilesTable.updatedAt,
        clientName: usersTable.name,
        clientEmail: usersTable.email,
        clientCompany: usersTable.company,
      })
      .from(clientM365ProfilesTable)
      .innerJoin(usersTable, eq(clientM365ProfilesTable.clientId, usersTable.id));
    res.json({ profiles: rows });
  } catch (err) {
    req.log.error(err, "Failed to fetch M365 profiles");
    res.status(500).json({ error: "Failed to fetch profiles" });
  }
});

// ─── ADMIN: Impersonation ────────────────────────────────────────────────────
router.post("/admin/impersonate/:userId", requireAdmin, async (req: Request, res: Response) => {
  const userId = parseInt(String(req.params.userId ?? ""), 10);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const [client] = await db.select().from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.role, "client")))
    .limit(1);
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }

  const adminId = req.user!.id;
  const { randomBytes } = await import("crypto");
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await db.insert(impersonationTokensTable).values({
    token,
    clientUserId: client.id,
    adminUserId: adminId,
    expiresAt,
  });

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "admin_impersonated",
    entityType: "user",
    entityId: client.id,
    entityLabel: client.name ?? client.email,
  });

  res.json({ token, client: { id: client.id, email: client.email, name: client.name } });
});

// ─── ADMIN: Projects ─────────────────────────────────────────────────────────
router.get("/admin/projects", requireAdmin, async (_req: Request, res: Response) => {
  const projects = await db.select().from(projectsTable).orderBy(desc(projectsTable.createdAt));
  res.json(projects);
});

router.get("/admin/projects/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(project);
});

// ─── ADMIN: Get signed contracts for a project ────────────────────────────────
router.get("/admin/projects/:id/contracts", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const contracts = await db.select({
    id: contractsTable.id,
    signedAt: contractsTable.signedAt,
    signerName: contractsTable.signerName,
    pdfFilename: contractsTable.pdfFilename,
    sharepointFileUrl: contractsTable.sharepointFileUrl,
    sharepointFileId: contractsTable.sharepointFileId,
    localFilePath: contractsTable.localFilePath,
    serviceName: servicesTable.name,
    userId: contractsTable.userId,
  }).from(contractsTable)
    .innerJoin(servicesTable, eq(contractsTable.serviceId, servicesTable.id))
    .where(eq(contractsTable.projectId, id))
    .orderBy(desc(contractsTable.signedAt));

  res.json({ contracts });
});

// ─── CLIENT: Download a signed contract PDF (local fallback) ─────────────────
router.get("/portal/contracts/:id/pdf", requireAuth, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const userId = req.user!.id;

  const [contract] = await db.select({
    id: contractsTable.id,
    userId: contractsTable.userId,
    localFilePath: contractsTable.localFilePath,
    pdfFilename: contractsTable.pdfFilename,
  }).from(contractsTable).where(eq(contractsTable.id, id));

  if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }
  if (contract.userId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!contract.localFilePath || !fs.existsSync(contract.localFilePath)) {
    res.status(404).json({ error: "PDF file not available" }); return;
  }

  const filename = contract.pdfFilename ?? path.basename(contract.localFilePath);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  fs.createReadStream(contract.localFilePath).pipe(res);
});

// ─── ADMIN: Download a signed contract PDF (local fallback) ──────────────────
router.get("/admin/contracts/:id/pdf", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [contract] = await db.select({
    id: contractsTable.id,
    localFilePath: contractsTable.localFilePath,
    pdfFilename: contractsTable.pdfFilename,
  }).from(contractsTable).where(eq(contractsTable.id, id));

  if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }
  if (!contract.localFilePath || !fs.existsSync(contract.localFilePath)) {
    res.status(404).json({ error: "PDF file not available" }); return;
  }

  const filename = contract.pdfFilename ?? path.basename(contract.localFilePath);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  fs.createReadStream(contract.localFilePath).pipe(res);
});

router.post("/admin/projects", requireAdmin, async (req: Request, res: Response) => {
  const { title, description, status, phase, progress, clientUserId, startDate, endDate, projectType, workflowTemplateId } = req.body as {
    title?: string; description?: string; status?: string; phase?: string; progress?: number; clientUserId?: number; startDate?: string; endDate?: string; projectType?: string; workflowTemplateId?: number;
  };
  if (!title) { res.status(400).json({ error: "title is required" }); return; }

  const validStatuses = ["active", "on_hold", "completed"];
  const [project] = await db.insert(projectsTable).values({
    title,
    description: description ?? null,
    status: (validStatuses.includes(status ?? "") ? status : "active") as "active" | "on_hold" | "completed",
    phase: phase ?? null,
    progress: progress ?? 0,
    clientUserId: clientUserId ?? null,
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    projectType: (projectType === "retainer" ? "retainer" : "project") as "project" | "retainer",
  }).returning();

  // ── Provision workflow steps + kanban tasks from template (if selected) ───
  if (workflowTemplateId) {
    try {
      const templateSteps = await db
        .select()
        .from(workflowTemplateStepsTable)
        .where(eq(workflowTemplateStepsTable.workflowTemplateId, workflowTemplateId))
        .orderBy(asc(workflowTemplateStepsTable.order));

      if (templateSteps.length > 0) {
        const createdSteps = await db.insert(workflowStepsTable).values(
          templateSteps.map((s, idx) => ({
            projectId: project.id,
            title: s.title,
            description: s.description ?? "",
            status: (idx === 0 ? "in_progress" : "pending") as "in_progress" | "pending",
            order: idx + 1,
            workflowTemplateStepId: s.id,
          }))
        ).returning();

        // Seed kanban tasks for the first step only
        const firstStep = createdSteps[0];
        if (firstStep?.workflowTemplateStepId) {
          const step1Tasks = await db
            .select()
            .from(workflowTemplateStepTasksTable)
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
      }
    } catch (err) {
      req.log.warn({ err, projectId: project.id }, "Workflow template provisioning failed (non-fatal)");
    }
  }

  // ── Auto-create SharePoint folder if client has a site ───────────────────
  if (clientUserId) {
    try {
      const [clientUser] = await db.select({ sharepointSiteId: usersTable.sharepointSiteId })
        .from(usersTable).where(eq(usersTable.id, clientUserId));
      if (clientUser?.sharepointSiteId) {
        const folderUrl = await createProjectFolder(clientUser.sharepointSiteId, title);
        if (folderUrl) {
          await db.update(projectsTable)
            .set({ sharepointFolderUrl: folderUrl })
            .where(eq(projectsTable.id, project.id));
          project.sharepointFolderUrl = folderUrl;
          req.log.info({ projectId: project.id, folderUrl }, "SharePoint project folder created");
        }
      }
    } catch (err) {
      req.log.warn({ err, projectId: project.id }, "SharePoint folder auto-create failed (non-fatal)");
    }
  }

  // Notify client
  if (clientUserId) {
    await db.insert(notificationsTable).values({
      userId: clientUserId,
      title: `New project started: ${title}`,
      body: description?.slice(0, 100) ?? null,
      type: "project_update",
      linkPath: `/portal/projects/${project.id}`,
    });
  }

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "project_created",
    entityType: "project",
    entityId: project.id,
    entityLabel: project.title,
    clientId: clientUserId ?? null,
    projectId: project.id,
  });

  res.status(201).json(project);
});

// ── Manually create SharePoint folder for an existing project ─────────────
router.post("/admin/projects/:id/sharepoint-folder", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (project.sharepointFolderUrl) {
    res.status(409).json({ error: "SharePoint folder already exists", sharepointFolderUrl: project.sharepointFolderUrl });
    return;
  }
  if (!project.clientUserId) {
    res.status(400).json({ error: "Project has no assigned client" }); return;
  }

  const [clientUser] = await db.select({ sharepointSiteId: usersTable.sharepointSiteId })
    .from(usersTable).where(eq(usersTable.id, project.clientUserId));
  if (!clientUser?.sharepointSiteId) {
    res.status(400).json({ error: "Client has no SharePoint site configured" }); return;
  }

  const folderUrl = await createProjectFolder(clientUser.sharepointSiteId, project.title);
  if (!folderUrl) {
    res.status(502).json({ error: "Failed to create SharePoint folder. Check Graph API credentials." });
    return;
  }

  await db.update(projectsTable)
    .set({ sharepointFolderUrl: folderUrl })
    .where(eq(projectsTable.id, id));

  req.log.info({ projectId: id, folderUrl }, "SharePoint project folder created manually");
  res.json({ sharepointFolderUrl: folderUrl });
});

router.patch("/admin/projects/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { title, description, status, phase, progress, clientUserId, startDate, endDate, projectType } = req.body as {
    title?: string; description?: string; status?: string; phase?: string; progress?: number; clientUserId?: number | null; startDate?: string; endDate?: string; projectType?: string;
  };

  const updates: Partial<typeof projectsTable.$inferInsert & { updatedAt: Date }> = { updatedAt: new Date() };
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (status !== undefined) updates.status = status as "active" | "on_hold" | "completed";
  if (phase !== undefined) updates.phase = phase;
  if (progress !== undefined) updates.progress = progress;
  if (clientUserId !== undefined) updates.clientUserId = clientUserId;
  if (startDate !== undefined) updates.startDate = startDate ? new Date(startDate) : null;
  if (endDate !== undefined) updates.endDate = endDate ? new Date(endDate) : null;
  if (projectType !== undefined) updates.projectType = (projectType === "retainer" ? "retainer" : "project") as "project" | "retainer";

  const [updated] = await db.update(projectsTable).set(updates).where(eq(projectsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(updated);
});

router.delete("/admin/projects/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [project] = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(eq(projectsTable.id, id)).limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    await db.delete(kanbanTasksTable).where(eq(kanbanTasksTable.projectId, id));
    await db.delete(workflowStepsTable).where(eq(workflowStepsTable.projectId, id));
    await db.delete(documentsTable).where(eq(documentsTable.projectId, id));
    await db.delete(projectUpdatesTable).where(eq(projectUpdatesTable.projectId, id));

    await db.update(clientServicesTable).set({ projectId: null }).where(eq(clientServicesTable.projectId, id));
    await db.update(contractsTable).set({ projectId: null }).where(eq(contractsTable.projectId, id));
    await db.update(invoicesTable).set({ projectId: null }).where(eq(invoicesTable.projectId, id));
    await db.update(reportsTable).set({ projectId: null }).where(eq(reportsTable.projectId, id));

    await db.delete(projectsTable).where(eq(projectsTable.id, id));

    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Failed to delete project" });
  }
});

// ─── ADMIN: Workflow Steps ───────────────────────────────────────────────────
router.get("/admin/workflow-steps", requireAdmin, async (req: Request, res: Response) => {
  const projectId = req.query.projectId ? parseInt(String(req.query.projectId), 10) : null;
  const clientServiceId = req.query.clientServiceId ? parseInt(String(req.query.clientServiceId), 10) : null;
  let q = db.select().from(workflowStepsTable).$dynamic();
  if (projectId && !isNaN(projectId)) q = q.where(eq(workflowStepsTable.projectId, projectId));
  else if (clientServiceId && !isNaN(clientServiceId)) q = q.where(eq(workflowStepsTable.clientServiceId, clientServiceId));
  const steps = await q.orderBy(asc(workflowStepsTable.order));
  res.json(steps);
});

router.delete("/admin/workflow-steps/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(workflowStepsTable).where(eq(workflowStepsTable.id, id));
  res.json({ deleted: id });
});

router.post("/admin/workflow-steps/bulk", requireAdmin, async (req: Request, res: Response) => {
  const { projectId, steps } = req.body as {
    projectId?: number;
    steps?: Array<{ title?: string; description?: string; status?: string; dueDate?: string | null; notes?: string }>;
  };
  if (!projectId || isNaN(projectId)) { res.status(400).json({ error: "projectId is required" }); return; }
  if (!Array.isArray(steps) || steps.length === 0) { res.status(400).json({ error: "steps must be a non-empty array" }); return; }

  const invalid = steps.findIndex(s => !s.title?.trim());
  if (invalid !== -1) { res.status(400).json({ error: `Step at index ${invalid} is missing a title` }); return; }

  const existing = await db.select({ order: workflowStepsTable.order })
    .from(workflowStepsTable)
    .where(eq(workflowStepsTable.projectId, projectId))
    .orderBy(desc(workflowStepsTable.order))
    .limit(1);
  const maxOrder = existing[0]?.order ?? -1;

  const validStatuses = ["pending", "in_progress", "completed", "blocked"];
  const rows = steps.map((s, i) => ({
    projectId,
    title: s.title!.trim(),
    description: s.description?.trim() ?? null,
    status: (validStatuses.includes(s.status ?? "") ? s.status : "pending") as "pending" | "in_progress" | "completed" | "blocked",
    order: maxOrder + 1 + i,
    dueDate: s.dueDate ? new Date(s.dueDate) : null,
    notes: s.notes?.trim() ?? null,
  }));

  const created = await db.insert(workflowStepsTable).values(rows).returning();
  res.status(201).json(created);
});

router.post("/admin/workflow-steps", requireAdmin, async (req: Request, res: Response) => {
  const { projectId, clientServiceId, title, description, order, status, dueDate } = req.body as {
    projectId?: number; clientServiceId?: number; title?: string; description?: string; order?: number; status?: string; dueDate?: string | null;
  };
  if (!title) { res.status(400).json({ error: "title is required" }); return; }

  const [step] = await db.insert(workflowStepsTable).values({
    projectId: projectId ?? null,
    clientServiceId: clientServiceId ?? null,
    title,
    description: description ?? null,
    order: order ?? 0,
    status: (status as "pending" | "in_progress" | "completed" | "blocked") ?? "pending",
    dueDate: dueDate ? new Date(dueDate) : null,
  }).returning();
  res.status(201).json(step);
});

router.patch("/admin/workflow-steps/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { status, notes, title, description, dueDate } = req.body as { status?: string; notes?: string; title?: string; description?: string; dueDate?: string | null };
  const updates: Partial<typeof workflowStepsTable.$inferInsert> = {};
  if (status !== undefined) {
    updates.status = status as "pending" | "in_progress" | "completed" | "blocked";
    if (status === "completed") updates.completedAt = new Date();
  }
  if (notes !== undefined) updates.notes = notes;
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;

  const [existing] = await db.select().from(workflowStepsTable).where(eq(workflowStepsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Step not found" }); return; }

  const [updated] = await db.update(workflowStepsTable).set(updates).where(eq(workflowStepsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Step not found" }); return; }

  if (status !== undefined) {
    void createAuditLog({
      actorUserId: req.user!.id,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: "admin",
      actionType: "workflow_step_changed",
      entityType: "workflow_step",
      entityId: updated.id,
      entityLabel: updated.title,
      projectId: updated.projectId ?? undefined,
      metadata: { from: existing.status, to: updated.status },
    });
  }

  // When a phase is moved to in_progress, auto-populate its template tasks into the Kanban backlog
  if (status === "in_progress" && updated.workflowTemplateStepId && updated.projectId) {
    const [existingCount] = await db
      .select({ n: count() })
      .from(kanbanTasksTable)
      .where(eq(kanbanTasksTable.workflowStepId, updated.id));

    if ((Number(existingCount?.n) ?? 0) === 0) {
      const templateTasks = await db
        .select()
        .from(workflowTemplateStepTasksTable)
        .where(eq(workflowTemplateStepTasksTable.workflowTemplateStepId, updated.workflowTemplateStepId))
        .orderBy(asc(workflowTemplateStepTasksTable.order));

      if (templateTasks.length > 0) {
        const resolvedMetadata = await resolveTemplateTaskMetadata(templateTasks);
        await db.insert(kanbanTasksTable).values(
          templateTasks.map((t, idx) => ({
            projectId: updated.projectId!,
            workflowStepId: updated.id,
            groupName: t.groupName ?? null,
            title: t.title,
            description: t.description ?? null,
            column: (t.isCustomerTask ? "waiting_on_customer" : "backlog") as "backlog" | "waiting_on_customer",
            order: idx,
            taskType: t.taskType ?? null,
            taskMetadata: resolvedMetadata[idx],
          }))
        );
        await syncProjectProgress(updated.projectId);
        req.log.info({ stepId: updated.id, projectId: updated.projectId, taskCount: templateTasks.length }, "Seeded kanban tasks for phase moved to in_progress");
      }
    }
  }

  res.json(updated);
});

// ─── ADMIN: Kanban Tasks ─────────────────────────────────────────────────────
router.get("/admin/kanban-tasks", requireAdmin, async (req: Request, res: Response) => {
  const projectId = req.query.projectId ? parseInt(String(req.query.projectId), 10) : null;
  if (!projectId || isNaN(projectId)) { res.status(400).json({ error: "projectId query param required" }); return; }
  const tasks = await db.select().from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.projectId, projectId))
    .orderBy(asc(kanbanTasksTable.order));

  const reportIds = tasks.map(t => t.statusReportId).filter((id): id is number => id !== null);
  const reports = reportIds.length > 0
    ? await db.select({
        id: statusReportsTable.id,
        clientQuestion: statusReportsTable.clientQuestion,
        adminReply: statusReportsTable.adminReply,
        replyThread: statusReportsTable.replyThread,
      }).from(statusReportsTable).where(inArray(statusReportsTable.id, reportIds))
    : [];
  const reportMap = new Map(reports.map(r => [r.id, r]));

  res.json(tasks.map(t => ({
    ...t,
    statusReportQuestion: t.statusReportId ? (reportMap.get(t.statusReportId)?.clientQuestion ?? null) : null,
    statusReportAdminReply: t.statusReportId ? (reportMap.get(t.statusReportId)?.adminReply ?? null) : null,
    statusReportReplyThread: t.statusReportId ? (reportMap.get(t.statusReportId)?.replyThread ?? []) : [],
  })));
});

router.post("/admin/kanban-tasks", requireAdmin, async (req: Request, res: Response) => {
  const { projectId, title, description, column, order, assignedTo, dueDate, priority, taskType, taskMetadata } = req.body as {
    projectId?: number; title?: string; description?: string; column?: string; order?: number; assignedTo?: string; dueDate?: string; priority?: string;
    taskType?: string; taskMetadata?: Record<string, unknown>;
  };
  if (!projectId || !title) { res.status(400).json({ error: "projectId and title are required" }); return; }

  const [task] = await db.insert(kanbanTasksTable).values({
    projectId,
    title,
    description: description ?? null,
    column: (column as "backlog" | "in_progress" | "waiting_on_customer" | "completed") ?? "backlog",
    order: order ?? 0,
    assignedTo: assignedTo ?? null,
    dueDate: dueDate ? new Date(dueDate) : null,
    priority: priority ?? "medium",
    taskType: taskType ?? null,
    taskMetadata: taskMetadata ?? null,
  }).returning();
  await syncProjectProgress(projectId);

  const [createdTaskProject] = await db.select({ clientUserId: projectsTable.clientUserId })
    .from(projectsTable).where(eq(projectsTable.id, projectId));

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "kanban_task_created",
    entityType: "kanban_task",
    entityId: task.id,
    entityLabel: task.title,
    projectId: task.projectId,
    clientId: createdTaskProject?.clientUserId ?? undefined,
  });

  res.status(201).json(task);
});

router.patch("/admin/kanban-tasks/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { column, title, description, order, assignedTo, dueDate, waitingReason, completionStatus, completionNotes, priority, taskType, taskMetadata } = req.body as {
    column?: string; title?: string; description?: string; order?: number; assignedTo?: string; dueDate?: string;
    waitingReason?: string | null; completionStatus?: string | null; completionNotes?: string | null; priority?: string | null;
    taskType?: string | null; taskMetadata?: Record<string, unknown> | null;
  };

  const [existingTask] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, id));
  if (!existingTask) { res.status(404).json({ error: "Task not found" }); return; }

  const updates: Partial<typeof kanbanTasksTable.$inferInsert & { updatedAt: Date }> = { updatedAt: new Date() };
  if (column !== undefined) updates.column = column as "backlog" | "in_progress" | "waiting_on_customer" | "completed";
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (order !== undefined) updates.order = order;
  if (assignedTo !== undefined) updates.assignedTo = assignedTo;
  if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;
  if (waitingReason !== undefined) updates.waitingReason = waitingReason ?? null;
  if (completionStatus !== undefined) updates.completionStatus = completionStatus ?? null;
  if (completionNotes !== undefined) updates.completionNotes = completionNotes ?? null;
  if (priority !== undefined) updates.priority = priority ?? "medium";
  if (taskType !== undefined) updates.taskType = taskType ?? null;
  if (taskMetadata !== undefined) updates.taskMetadata = taskMetadata ?? null;

  const [updated] = await db.update(kanbanTasksTable).set(updates).where(eq(kanbanTasksTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Task not found" }); return; }

  const [taskProject] = updated.projectId
    ? await db.select({ clientUserId: projectsTable.clientUserId }).from(projectsTable).where(eq(projectsTable.id, updated.projectId))
    : [];

  // Auto-progression: when a task is completed, check if its workflow step is done
  if (updates.column === "completed" && updated.workflowStepId) {
    const allStepTasks = await db.select().from(kanbanTasksTable)
      .where(eq(kanbanTasksTable.workflowStepId, updated.workflowStepId));
    const allDone = allStepTasks.length > 0 && allStepTasks.every(t => t.column === "completed");
    if (allDone) {
      const [completedStep] = await db.update(workflowStepsTable)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(workflowStepsTable.id, updated.workflowStepId))
        .returning();

      if (completedStep?.projectId) {
        const allProjectSteps = await db.select().from(workflowStepsTable)
          .where(eq(workflowStepsTable.projectId, completedStep.projectId))
          .orderBy(asc(workflowStepsTable.order));
        const currentIdx = allProjectSteps.findIndex(s => s.id === updated.workflowStepId);
        const nextStep = allProjectSteps[currentIdx + 1];

        if (nextStep && nextStep.status !== "completed") {
          const [activatedStep] = await db.update(workflowStepsTable)
            .set({ status: "in_progress" })
            .where(eq(workflowStepsTable.id, nextStep.id))
            .returning();

          if (activatedStep?.workflowTemplateStepId && activatedStep.projectId) {
            const templateTasks = await db.select().from(workflowTemplateStepTasksTable)
              .where(eq(workflowTemplateStepTasksTable.workflowTemplateStepId, activatedStep.workflowTemplateStepId))
              .orderBy(asc(workflowTemplateStepTasksTable.order));
            if (templateTasks.length > 0) {
              const resolvedMetadata = await resolveTemplateTaskMetadata(templateTasks);
              await db.insert(kanbanTasksTable).values(
                templateTasks.map((t, idx) => ({
                  projectId: activatedStep.projectId!,
                  workflowStepId: activatedStep.id,
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

        }
      }
    }
  }

  await syncProjectProgress(updated.projectId);

  const auditBase = {
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin" as const,
    entityType: "kanban_task",
    entityId: updated.id,
    entityLabel: updated.title,
    projectId: updated.projectId ?? undefined,
    clientId: taskProject?.clientUserId ?? undefined,
  };

  if (column !== undefined) {
    void createAuditLog({
      ...auditBase,
      actionType: column === "completed" ? "kanban_task_closed" : "kanban_task_moved",
      metadata: { from: existingTask.column, to: column, notes: completionNotes ?? null },
    });
  } else if (dueDate !== undefined) {
    void createAuditLog({
      ...auditBase,
      actionType: "kanban_task_due_date_set",
      metadata: { from: existingTask.dueDate ?? null, to: dueDate ?? null },
    });
  } else if (title !== undefined || description !== undefined || priority !== undefined) {
    void createAuditLog({
      ...auditBase,
      actionType: "kanban_task_updated",
      metadata: { changedFields: Object.keys(req.body as object).filter(k => ["title","description","priority"].includes(k)) },
    });
  }

  res.json(updated);
});

// ─── ADMIN: Kanban Task Checklist — AI Completion Schema ─────────────────────
router.post("/admin/kanban-tasks/:id/checklist/:itemId/completion-schema", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  const itemId = String(req.params.itemId ?? "");
  if (isNaN(id)) { res.status(400).json({ error: "Invalid task ID" }); return; }
  if (!itemId) { res.status(400).json({ error: "Invalid item ID" }); return; }

  const [task] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  const meta = (task.taskMetadata ?? {}) as Record<string, unknown>;
  const checklist = (meta.checklist ?? []) as Array<{ id: string; label: string }>;
  const checklistItem = checklist.find(c => c.id === itemId);
  if (!checklistItem) { res.status(404).json({ error: "Checklist item not found" }); return; }

  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    const systemPrompt = `You are a project knowledge-capture assistant. When an engineer completes a checklist item, your job is to generate a small set of targeted questions to capture meaningful closure details. Return ONLY a valid JSON array (no markdown, no commentary) of field definitions with this exact shape:
[{"id":"snake_case_id","label":"Human readable label","type":"text"|"textarea"|"date"|"list"|"url","placeholder":"optional hint text","required":true|false,"hint":"optional extra guidance"}]
Rules:
- Return 2 to 5 fields maximum.
- Choose the field type that best fits the expected answer: url for links, date for dates, list for multiple items (attendees, files, etc.), textarea for free-form notes, text for short single values.
- Make the questions specific to the checklist item label and card context — do not ask generic questions.
- Do not ask for information already captured in the card title or description.`;

    const userMsg = `Card title: ${task.title}
${task.description ? `Card description: ${task.description}` : ""}
Checklist item just completed: ${checklistItem.label}

Generate the closure questions JSON array:`;

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
    });

    const block = msg.content[0];
    if (block.type !== "text") {
      res.json({ fields: [] });
      return;
    }

    const text = block.text.trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) { res.json({ fields: [] }); return; }

    const fields = JSON.parse(match[0]) as Array<{
      id: string; label: string; type: string;
      placeholder?: string; required?: boolean; hint?: string;
    }>;
    res.json({ fields: fields.slice(0, 5) });
  } catch (err) {
    req.log.warn({ err }, "AI completion-schema generation failed — returning empty fields");
    res.json({ fields: [] });
  }
});

// ─── ADMIN: Kanban Task Checklist Toggle ──────────────────────────────────────
router.patch("/admin/kanban-tasks/:id/checklist/:itemId", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  const itemId = String(req.params.itemId ?? "");
  if (isNaN(id)) { res.status(400).json({ error: "Invalid task ID" }); return; }
  if (!itemId) { res.status(400).json({ error: "Invalid item ID" }); return; }

  const { checked, closureData } = req.body as { checked?: boolean; closureData?: { schema: unknown; answers: unknown } };
  if (typeof checked !== "boolean") { res.status(400).json({ error: "checked (boolean) is required" }); return; }

  const [existingTask] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, id));
  if (!existingTask) { res.status(404).json({ error: "Task not found" }); return; }

  const currentMeta = (existingTask.taskMetadata ?? {}) as Record<string, unknown>;
  const currentState = (currentMeta.checklistState ?? {}) as Record<string, boolean>;
  const currentItemData = (currentMeta.checklistItemData ?? {}) as Record<string, unknown>;

  const updatedMeta: Record<string, unknown> = {
    ...currentMeta,
    checklistState: {
      ...currentState,
      [itemId]: checked,
    },
  };

  if (closureData) {
    updatedMeta.checklistItemData = {
      ...currentItemData,
      [itemId]: {
        schema: closureData.schema,
        answers: closureData.answers,
        capturedAt: new Date().toISOString(),
      },
    };
  }

  const [updated] = await db
    .update(kanbanTasksTable)
    .set({ taskMetadata: updatedMeta, updatedAt: new Date() })
    .where(eq(kanbanTasksTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Task not found" }); return; }
  res.json({ taskMetadata: updated.taskMetadata });
});

router.delete("/admin/kanban-tasks/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [existing] = await db.select({ projectId: kanbanTasksTable.projectId }).from(kanbanTasksTable).where(eq(kanbanTasksTable.id, id));
  await db.delete(kanbanTasksTable).where(eq(kanbanTasksTable.id, id));
  if (existing?.projectId) await syncProjectProgress(existing.projectId);
  res.json({ deleted: id });
});

// ─── ADMIN: Documents ────────────────────────────────────────────────────────
router.get("/admin/documents", requireAdmin, async (_req: Request, res: Response) => {
  const docs = await db.select().from(documentsTable).orderBy(desc(documentsTable.createdAt));
  res.json(docs);
});

router.post("/admin/documents", requireAdmin, uploadDoc.single("file"), async (req: Request, res: Response) => {
  const { projectId, name } = req.body as { projectId?: string; name?: string };
  if (!req.file || !projectId) { res.status(400).json({ error: "file and projectId are required" }); return; }

  const [doc] = await db.insert(documentsTable).values({
    projectId: parseInt(projectId, 10),
    name: name ?? req.file.originalname,
    filename: req.file.filename,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    uploadedBy: req.user!.id,
  }).returning();

  // Notify client
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, parseInt(projectId, 10)));
  if (project?.clientUserId) {
    await db.insert(notificationsTable).values({
      userId: project.clientUserId,
      title: "New document uploaded",
      body: name ?? req.file.originalname,
      type: "document",
      linkPath: `/portal/projects/${projectId}`,
    });
  }

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "document_uploaded",
    entityType: "document",
    entityId: doc.id,
    entityLabel: doc.name,
    projectId: doc.projectId ?? undefined,
    clientId: project?.clientUserId ?? undefined,
    metadata: { filename: doc.filename, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes },
  });

  res.status(201).json(doc);
});

router.delete("/admin/documents/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }

  const filePath = path.join(UPLOADS_BASE, "documents", doc.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await db.delete(documentsTable).where(eq(documentsTable.id, id));
  res.json({ deleted: id });
});

// ─── ADMIN: Reports ──────────────────────────────────────────────────────────
router.get("/admin/reports", requireAdmin, async (_req: Request, res: Response) => {
  const reports = await db.select().from(reportsTable).orderBy(desc(reportsTable.createdAt));
  res.json(reports);
});

router.post("/admin/reports", requireAdmin, uploadReport.single("file"), async (req: Request, res: Response) => {
  const { clientUserId, projectId, title, period, reportDate } = req.body as {
    clientUserId?: string; projectId?: string; title?: string; period?: string; reportDate?: string;
  };
  if (!req.file || !clientUserId || !title) { res.status(400).json({ error: "file, clientUserId, and title are required" }); return; }

  const validPeriods = ["weekly", "monthly", "executive_summary", "other"];
  const [report] = await db.insert(reportsTable).values({
    clientUserId: parseInt(clientUserId, 10),
    projectId: projectId ? parseInt(projectId, 10) : null,
    title,
    period: (validPeriods.includes(period ?? "") ? period : "other") as "weekly" | "monthly" | "executive_summary" | "other",
    filename: req.file.filename,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    reportDate: reportDate ? new Date(reportDate) : null,
  }).returning();

  await db.insert(notificationsTable).values({
    userId: parseInt(clientUserId, 10),
    title: `New report available: ${title}`,
    body: null,
    type: "general",
    linkPath: "/portal/reports",
  });

  res.status(201).json(report);
});

router.delete("/admin/reports/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }

  const filePath = path.join(UPLOADS_BASE, "reports", report.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await db.delete(reportsTable).where(eq(reportsTable.id, id));
  res.json({ deleted: id });
});

// ─── CLIENT: Status Reports (published only) ─────────────────────────────────
router.get("/portal/status-reports", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const reports = await db.select().from(statusReportsTable)
    .where(and(eq(statusReportsTable.clientUserId, userId), eq(statusReportsTable.reportStatus, "sent")))
    .orderBy(desc(statusReportsTable.sentAt));
  res.json(reports);
});

router.get("/portal/status-reports/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [report] = await db.select().from(statusReportsTable)
    .where(and(eq(statusReportsTable.id, id), eq(statusReportsTable.clientUserId, userId), eq(statusReportsTable.reportStatus, "sent")));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }
  res.json(report);
});

router.patch("/portal/status-reports/:id/acknowledge", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { status, question } = req.body as { status?: string; question?: string };
  if (status !== "accepted" && status !== "has_questions") {
    res.status(400).json({ error: "status must be 'accepted' or 'has_questions'" });
    return;
  }
  if (status === "has_questions" && !question?.trim()) {
    res.status(400).json({ error: "question is required when status is 'has_questions'" });
    return;
  }

  const [report] = await db.select().from(statusReportsTable)
    .where(and(
      eq(statusReportsTable.id, id),
      eq(statusReportsTable.clientUserId, userId),
      eq(statusReportsTable.reportStatus, "sent"),
    ));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }

  // Guard: only allow transition from pending (prevents duplicate kanban tasks on re-submission)
  if (report.clientStatus !== "pending") {
    res.status(409).json({ error: "Report has already been acknowledged" });
    return;
  }

  // Atomically update the report and (if has_questions) insert the kanban task
  const updated = await db.transaction(async (tx) => {
    const [updatedReport] = await tx.update(statusReportsTable)
      .set({
        clientStatus: status as "accepted" | "has_questions",
        clientQuestion: status === "has_questions" ? (question ?? null) : null,
        updatedAt: new Date(),
      })
      .where(eq(statusReportsTable.id, id))
      .returning();

    if (status === "has_questions" && report.projectId && question?.trim()) {
      const existingTasks = await tx.select({ order: kanbanTasksTable.order })
        .from(kanbanTasksTable)
        .where(and(eq(kanbanTasksTable.projectId, report.projectId), eq(kanbanTasksTable.column, "backlog")))
        .orderBy(desc(kanbanTasksTable.order))
        .limit(1);
      const nextOrder = (existingTasks[0]?.order ?? 0) + 1;
      await tx.insert(kanbanTasksTable).values({
        projectId: report.projectId,
        title: `Client question: ${report.title}`,
        description: question.trim(),
        column: "backlog",
        order: nextOrder,
        statusReportId: id,
      });
    }

    return updatedReport;
  });

  res.json(updated);
});

// ─── PORTAL: Resolve Status Report (after reading Shane's reply) ─────────────

router.post("/portal/status-reports/:id/resolve", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [report] = await db.select().from(statusReportsTable)
    .where(and(
      eq(statusReportsTable.id, id),
      eq(statusReportsTable.clientUserId, userId),
      eq(statusReportsTable.reportStatus, "sent"),
    ));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }

  if (report.clientStatus !== "has_questions") {
    res.status(409).json({ error: "Report is not in has_questions state" });
    return;
  }
  if (!report.adminReply) {
    res.status(409).json({ error: "Cannot resolve: consultant has not replied yet" });
    return;
  }

  const [updated] = await db.update(statusReportsTable)
    .set({ clientStatus: "accepted", updatedAt: new Date() })
    .where(eq(statusReportsTable.id, id))
    .returning();

  void createAuditLog({
    actorUserId: userId,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: "status_report_resolved",
    entityType: "status_report",
    entityId: id,
    entityLabel: report.title,
    projectId: report.projectId ?? undefined,
    clientId: userId,
  });

  res.json(updated);
});

// ─── PORTAL: Client follow-up reply to a thread ──────────────────────────────

router.post("/portal/status-reports/:id/thread", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { content } = req.body as { content?: string };
  if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }

  const [report] = await db.select().from(statusReportsTable)
    .where(and(
      eq(statusReportsTable.id, id),
      eq(statusReportsTable.clientUserId, userId),
      eq(statusReportsTable.reportStatus, "sent"),
    ));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }
  if (report.clientStatus !== "has_questions") {
    res.status(409).json({ error: "Report is not awaiting questions" }); return;
  }
  if (!report.adminReply) {
    res.status(409).json({ error: "Cannot follow up until the consultant has replied" }); return;
  }

  const newMessage = { sender: "client" as const, content: content.trim(), timestamp: new Date().toISOString() };
  const updatedThread = [...(report.replyThread ?? []), newMessage];

  const [updated] = await db.update(statusReportsTable)
    .set({ replyThread: updatedThread, updatedAt: new Date() })
    .where(eq(statusReportsTable.id, id))
    .returning();

  // Notify Shane by email (fire-and-forget)
  const adminEmailAddr = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
  if (adminEmailAddr) {
    const [client] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
    void sendEmailFromTemplate(
      "client-thread-reply",
      adminEmailAddr,
      {
        clientName: client?.name ?? "",
        reportTitle: report.title,
        replyContent: content.trim(),
        adminPanelUrl: report.projectId
          ? `https://shanemccaw.consulting/admin-panel/crm/projects/${report.projectId}`
          : `https://shanemccaw.consulting/admin-panel/crm/status-reports`,
      },
      `Client follow-up on status report: ${report.title}`,
      clientThreadReplyEmail({ clientName: client?.name ?? "", reportTitle: report.title, replyContent: content.trim(), projectId: report.projectId }),
    );
  }

  void createAuditLog({
    actorUserId: userId,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: "status_report_question",
    entityType: "status_report",
    entityId: report.id,
    entityLabel: report.title,
    clientId: userId,
    projectId: report.projectId ?? null,
  });

  res.json(updated);
});

// ─── ADMIN: Status Report Reply ──────────────────────────────────────────────

router.post("/admin/status-reports/:id/reply", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { reply } = req.body as { reply?: string };
  if (!reply?.trim()) { res.status(400).json({ error: "reply is required" }); return; }

  const [report] = await db.select().from(statusReportsTable).where(eq(statusReportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }

  if (report.clientStatus !== "has_questions") {
    res.status(409).json({ error: "This report has no pending client question" });
    return;
  }

  if (report.adminReply) {
    res.status(409).json({ error: "A reply has already been sent for this report" });
    return;
  }

  const [updated] = await db.update(statusReportsTable)
    .set({ adminReply: reply.trim(), updatedAt: new Date() })
    .where(eq(statusReportsTable.id, id))
    .returning();

  if (report.clientUserId) {
    const linkPath = report.projectId
      ? `/portal/projects/${report.projectId}`
      : "/portal/projects";
    await db.insert(notificationsTable).values({
      userId: report.clientUserId,
      title: `Reply to your question on: ${report.title}`,
      body: "Shane has replied to your question on a status report. View it in your portal.",
      type: "project_update",
      linkPath,
    });

    const [client] = await db.select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, report.clientUserId));
    if (client?.email) {
      await sendEmailFromTemplate(
        "status-report-reply",
        client.email,
        {
          clientName: client.name ?? "",
          reportTitle: report.title,
          adminReply: reply.trim(),
          projectUrl: report.projectId ? `${PORTAL_URL}/projects/${report.projectId}` : PORTAL_URL,
        },
        `Reply to your question on: ${report.title}`,
        statusReportReplyEmail({ clientName: client.name ?? "", reportTitle: report.title, adminReply: reply.trim(), projectId: report.projectId }),
      );
    }
  }

  if (report.clientUserId) {
    void createAuditLog({
      actorUserId: req.user!.id,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: "admin",
      actionType: "status_report_reply",
      entityType: "status_report",
      entityId: report.id,
      entityLabel: report.title,
      clientId: report.clientUserId,
      projectId: report.projectId ?? null,
    });
  }

  res.json(updated);
});

// ─── ADMIN: Thread reply to client follow-up ─────────────────────────────────

router.post("/admin/status-reports/:id/thread", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { content } = req.body as { content?: string };
  if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }

  const [report] = await db.select().from(statusReportsTable).where(eq(statusReportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }
  if (report.clientStatus !== "has_questions") {
    res.status(409).json({ error: "This report has no active client question" }); return;
  }

  const newMessage = { sender: "admin" as const, content: content.trim(), timestamp: new Date().toISOString() };
  const updatedThread = [...(report.replyThread ?? []), newMessage];

  const [updated] = await db.update(statusReportsTable)
    .set({ replyThread: updatedThread, updatedAt: new Date() })
    .where(eq(statusReportsTable.id, id))
    .returning();

  // Notify client via in-app notification + email (fire-and-forget)
  if (report.clientUserId) {
    const linkPath = report.projectId
      ? `/portal/projects/${report.projectId}`
      : "/portal/projects";
    void db.insert(notificationsTable).values({
      userId: report.clientUserId,
      title: `New reply on: ${report.title}`,
      body: "Shane has replied to your follow-up message on a status report.",
      type: "project_update",
      linkPath,
    });
    const [client] = await db.select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, report.clientUserId));
    if (client?.email) {
      void sendEmailFromTemplate(
        "admin-thread-reply",
        client.email,
        {
          clientName: client.name ?? "",
          reportTitle: report.title,
          replyContent: content.trim(),
          projectUrl: report.projectId ? `${PORTAL_URL}/projects/${report.projectId}` : PORTAL_URL,
        },
        `Reply to your follow-up on: ${report.title}`,
        adminThreadReplyEmail({ clientName: client.name ?? "", reportTitle: report.title, replyContent: content.trim(), projectId: report.projectId }),
      );
    }
  }

  res.json(updated);
});

// ─── ADMIN: Status Reports ───────────────────────────────────────────────────

router.get("/admin/status-reports", requireAdmin, async (_req: Request, res: Response) => {
  const reports = await db.select().from(statusReportsTable).orderBy(desc(statusReportsTable.updatedAt));
  res.json(reports);
});

router.post("/admin/status-reports", requireAdmin, async (req: Request, res: Response) => {
  const { projectId, clientUserId, title, period, executiveSummary, completedActivities, keyOutcomes, nextSteps, reportDate } = req.body as {
    projectId?: number; clientUserId?: number; title?: string; period?: string;
    executiveSummary?: string; completedActivities?: Array<{ title: string; description: string }>;
    keyOutcomes?: string; nextSteps?: Array<{ label: string; title: string; description: string }>;
    reportDate?: string;
  };
  if (!title) { res.status(400).json({ error: "title is required" }); return; }
  const validPeriods = ["weekly", "monthly", "executive_summary", "other"];
  const [report] = await db.insert(statusReportsTable).values({
    projectId: projectId ?? null,
    clientUserId: clientUserId ?? null,
    title,
    period: (validPeriods.includes(period ?? "") ? period : "monthly") as "weekly" | "monthly" | "executive_summary" | "other",
    reportStatus: "draft",
    executiveSummary: executiveSummary ?? null,
    completedActivities: completedActivities ?? [],
    keyOutcomes: keyOutcomes ?? null,
    nextSteps: nextSteps ?? [],
    reportDate: reportDate ? new Date(reportDate) : null,
  }).returning();
  res.status(201).json(report);
});

router.patch("/admin/status-reports/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { title, period, executiveSummary, completedActivities, keyOutcomes, nextSteps, reportDate } = req.body as {
    title?: string; period?: string; executiveSummary?: string;
    completedActivities?: Array<{ title: string; description: string }>;
    keyOutcomes?: string; nextSteps?: Array<{ label: string; title: string; description: string }>;
    reportDate?: string;
  };

  const updates: Partial<typeof statusReportsTable.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
  if (title !== undefined) updates.title = title;
  if (period !== undefined) updates.period = period as "weekly" | "monthly" | "executive_summary" | "other";
  if (executiveSummary !== undefined) updates.executiveSummary = executiveSummary;
  if (completedActivities !== undefined) updates.completedActivities = completedActivities;
  if (keyOutcomes !== undefined) updates.keyOutcomes = keyOutcomes;
  if (nextSteps !== undefined) updates.nextSteps = nextSteps;
  if (reportDate !== undefined) updates.reportDate = reportDate ? new Date(reportDate) : null;

  const [updated] = await db.update(statusReportsTable).set(updates).where(eq(statusReportsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.post("/admin/status-reports/:id/send", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [report] = await db.select().from(statusReportsTable).where(eq(statusReportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }

  const [updated] = await db.update(statusReportsTable)
    .set({ reportStatus: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(eq(statusReportsTable.id, id))
    .returning();

  if (report.clientUserId) {
    await db.insert(notificationsTable).values({
      userId: report.clientUserId,
      title: `New status report: ${report.title}`,
      body: "Your consultant has sent you a project status report. View it in your portal.",
      type: "project_update",
      linkPath: "/portal/projects",
    });
  }

  if (report.clientUserId) {
    void createAuditLog({
      actorUserId: req.user!.id,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: "admin",
      actionType: "status_report_published",
      entityType: "status_report",
      entityId: report.id,
      entityLabel: report.title,
      clientId: report.clientUserId,
      projectId: report.projectId ?? null,
      metadata: { period: report.period ?? null },
    });
  }

  res.json(updated);
});

router.delete("/admin/status-reports/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(statusReportsTable).where(eq(statusReportsTable.id, id));
  res.json({ deleted: id });
});

type NextStepWithKanban = { label: string; title: string; description: string; kanbanTaskId?: number | null };

router.post("/admin/status-reports/:id/next-steps/:index/push-to-kanban", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  const index = parseInt(String(req.params.index ?? ""), 10);
  if (isNaN(id) || isNaN(index)) { res.status(400).json({ error: "Invalid params" }); return; }

  const [report] = await db.select().from(statusReportsTable).where(eq(statusReportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }
  if (!report.projectId) { res.status(400).json({ error: "Assign a project to this report before pushing to Kanban" }); return; }

  const steps = (report.nextSteps ?? []) as NextStepWithKanban[];
  if (index < 0 || index >= steps.length) { res.status(400).json({ error: "Index out of range" }); return; }

  const step = steps[index];
  if (step.kanbanTaskId) {
    res.json({ report, kanbanTaskId: step.kanbanTaskId });
    return;
  }

  const descParts = [step.label ? `[${step.label}]` : null, step.description || null].filter(Boolean);
  const desc = descParts.length > 0 ? descParts.join(" ") : null;
  const [task] = await db.insert(kanbanTasksTable).values({
    projectId: report.projectId,
    title: step.title || "Untitled step",
    description: desc,
    column: "backlog",
    priority: "medium",
  }).returning();

  const updatedSteps = steps.map((s, i) => i === index ? { ...s, kanbanTaskId: task.id } : s);
  const [updatedReport] = await db.update(statusReportsTable)
    .set({ nextSteps: updatedSteps, updatedAt: new Date() })
    .where(eq(statusReportsTable.id, id))
    .returning();

  res.json({ report: updatedReport, kanbanTaskId: task.id });
});

router.post("/admin/status-reports/:id/push-all-to-kanban", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [report] = await db.select().from(statusReportsTable).where(eq(statusReportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }
  if (!report.projectId) { res.status(400).json({ error: "Assign a project to this report before pushing to Kanban" }); return; }

  const steps = (report.nextSteps ?? []) as NextStepWithKanban[];
  const updatedSteps = [...steps];
  let pushed = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.kanbanTaskId) continue;
    const descParts = [step.label ? `[${step.label}]` : null, step.description || null].filter(Boolean);
    const desc = descParts.length > 0 ? descParts.join(" ") : null;
    const [task] = await db.insert(kanbanTasksTable).values({
      projectId: report.projectId,
      title: step.title || "Untitled step",
      description: desc,
      column: "backlog",
      priority: "medium",
    }).returning();
    updatedSteps[i] = { ...step, kanbanTaskId: task.id };
    pushed++;
  }

  const [updatedReport] = await db.update(statusReportsTable)
    .set({ nextSteps: updatedSteps, updatedAt: new Date() })
    .where(eq(statusReportsTable.id, id))
    .returning();

  res.json({ report: updatedReport, pushed });
});

// Returns auto-populated data for a given project to pre-fill a new status report
router.get("/admin/projects/:id/report-autofill", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const sinceParam = typeof req.query.since === "string" ? req.query.since : null;
  const sinceDate = sinceParam ? new Date(sinceParam) : null;

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const [client] = project.clientUserId
    ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, company: usersTable.company })
        .from(usersTable).where(eq(usersTable.id, project.clientUserId))
    : [null];

  // Find the most recent status report date + period for this project (to return to the frontend)
  const [lastReport] = await db
    .select({ reportDate: statusReportsTable.reportDate, sentAt: statusReportsTable.sentAt, createdAt: statusReportsTable.createdAt, period: statusReportsTable.period })
    .from(statusReportsTable)
    .where(eq(statusReportsTable.projectId, id))
    .orderBy(desc(statusReportsTable.createdAt))
    .limit(1);

  const lastReportDate = lastReport
    ? (lastReport.reportDate ?? lastReport.sentAt ?? lastReport.createdAt).toISOString()
    : null;

  const lastReportPeriod = lastReport?.period ?? null;

  const steps = await db.select().from(workflowStepsTable)
    .where(eq(workflowStepsTable.projectId, id))
    .orderBy(asc(workflowStepsTable.order));

  const tasksWhere = sinceDate
    ? and(eq(kanbanTasksTable.projectId, id), gte(kanbanTasksTable.updatedAt, sinceDate))
    : eq(kanbanTasksTable.projectId, id);

  const tasks = await db.select().from(kanbanTasksTable)
    .where(tasksWhere)
    .orderBy(asc(kanbanTasksTable.order));

  const completedTasks = tasks
    .filter(t => t.column === "completed")
    .map(t => ({
      title: t.title,
      description: t.description ?? "",
      completionStatus: t.completionStatus ?? null,
      completionNotes: t.completionNotes ?? null,
    }));

  // For steps, filter by completedAt when sinceDate is provided
  const allCompletedSteps = steps.filter(s => s.status === "completed");
  const filteredCompletedSteps = sinceDate
    ? allCompletedSteps.filter(s => s.completedAt && s.completedAt >= sinceDate)
    : allCompletedSteps;

  const completedSteps = filteredCompletedSteps.map(s => ({ title: s.title, description: s.description ?? "" }));

  const pendingSteps = steps
    .filter(s => s.status === "pending" || s.status === "in_progress")
    .map(s => ({ label: s.status === "in_progress" ? "In Progress" : "Upcoming", title: s.title, description: s.description ?? "" }));

  const blockedCount = steps.filter(s => s.status === "blocked").length;
  const completedStepsCount = allCompletedSteps.length;

  res.json({
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      progress: completedStepsCount > 0 && steps.length > 0
        ? Math.round((completedStepsCount / steps.length) * 100)
        : project.progress,
      description: project.description,
      endDate: project.endDate,
    },
    client,
    completedTasks,
    completedSteps,
    pendingSteps,
    blockedCount,
    totalSteps: steps.length,
    completedStepsCount,
    lastReportDate,
    lastReportPeriod,
    sinceDate: sinceDate ? sinceDate.toISOString() : null,
  });
});

// ─── ADMIN: Invoices ─────────────────────────────────────────────────────────
router.get("/admin/invoices", requireAdmin, async (req: Request, res: Response) => {
  const { type, status, sortBy = "createdAt", sortDir = "desc" } = req.query as {
    type?: string; status?: string; sortBy?: string; sortDir?: string;
  };

  const conditions: ReturnType<typeof eq>[] = [];
  if (type && type !== "all") conditions.push(eq(invoicesTable.invoiceType, type as "instant" | "retainer"));
  if (status && status !== "all") conditions.push(eq(invoicesTable.status, status as "draft" | "due" | "paid" | "overdue"));

  const sortColumnMap = {
    createdAt: invoicesTable.createdAt,
    amount: invoicesTable.amount,
    dueDate: invoicesTable.dueDate,
    status: invoicesTable.status,
    invoiceNumber: invoicesTable.invoiceNumber,
  } as const;
  const sortColumn = sortColumnMap[sortBy as keyof typeof sortColumnMap] ?? invoicesTable.createdAt;
  const orderFn = sortDir === "asc" ? asc(sortColumn) : desc(sortColumn);

  const rows = await db.select({
    id: invoicesTable.id,
    clientUserId: invoicesTable.clientUserId,
    projectId: invoicesTable.projectId,
    invoiceNumber: invoicesTable.invoiceNumber,
    description: invoicesTable.description,
    amount: invoicesTable.amount,
    currency: invoicesTable.currency,
    status: invoicesTable.status,
    dueDate: invoicesTable.dueDate,
    paidAt: invoicesTable.paidAt,
    pdfFilename: invoicesTable.pdfFilename,
    stripeSessionId: invoicesTable.stripeSessionId,
    sharepointFileUrl: invoicesTable.sharepointFileUrl,
    couponCode: invoicesTable.couponCode,
    discountAmount: invoicesTable.discountAmount,
    invoiceType: invoicesTable.invoiceType,
    stripeInvoiceId: invoicesTable.stripeInvoiceId,
    billingCycleStart: invoicesTable.billingCycleStart,
    billingCycleEnd: invoicesTable.billingCycleEnd,
    stripeSubscriptionId: invoicesTable.stripeSubscriptionId,
    createdAt: invoicesTable.createdAt,
    updatedAt: invoicesTable.updatedAt,
    clientName: usersTable.name,
    clientEmail: usersTable.email,
    clientCompany: usersTable.company,
  })
  .from(invoicesTable)
  .leftJoin(usersTable, eq(invoicesTable.clientUserId, usersTable.id))
  .where(conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions))
  .orderBy(orderFn);

  res.json(rows);
});

router.post("/admin/invoices", requireAdmin, uploadInvoice.single("pdf"), async (req: Request, res: Response) => {
  const { clientUserId, projectId, invoiceNumber, description, amount, currency, dueDate } = req.body as {
    clientUserId?: string; projectId?: string; invoiceNumber?: string; description?: string; amount?: string; currency?: string; dueDate?: string;
  };
  if (!clientUserId || !invoiceNumber || !amount) { res.status(400).json({ error: "clientUserId, invoiceNumber, and amount are required" }); return; }

  const [invoice] = await db.insert(invoicesTable).values({
    clientUserId: parseInt(clientUserId, 10),
    projectId: projectId ? parseInt(projectId, 10) : null,
    invoiceNumber,
    description: description ?? null,
    amount,
    currency: currency ?? "usd",
    status: "due",
    dueDate: dueDate ? new Date(dueDate) : null,
    pdfFilename: req.file?.filename ?? null,
  }).returning();
  void uploadInvoiceToSharePoint(invoice.id);

  await db.insert(notificationsTable).values({
    userId: parseInt(clientUserId, 10),
    title: `New invoice: ${invoiceNumber}`,
    body: `Amount: $${amount}`,
    type: "invoice",
    linkPath: "/portal/billing",
  });

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "invoice_created",
    entityType: "invoice",
    entityId: invoice.id,
    entityLabel: invoice.invoiceNumber,
    clientId: invoice.clientUserId,
    metadata: { amount: invoice.amount },
  });

  res.status(201).json(invoice);
});

router.patch("/admin/invoices/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { status, dueDate } = req.body as { status?: string; dueDate?: string };
  const updates: Partial<typeof invoicesTable.$inferInsert & { updatedAt: Date }> = { updatedAt: new Date() };
  if (status !== undefined) {
    updates.status = status as "draft" | "due" | "paid" | "overdue";
    if (status === "paid") updates.paidAt = new Date();
  }
  if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;

  const [updated] = await db.update(invoicesTable).set(updates).where(eq(invoicesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  if (status) {
    void createAuditLog({
      actorUserId: req.user!.id,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: "admin",
      actionType: "invoice_status_changed",
      entityType: "invoice",
      entityId: updated.id,
      entityLabel: updated.invoiceNumber,
      clientId: updated.clientUserId,
      metadata: { status },
    });
  }

  res.json(updated);
});

router.delete("/admin/invoices/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [deleted] = await db.delete(invoicesTable).where(eq(invoicesTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Invoice not found" }); return; }

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "invoice_deleted",
    entityType: "invoice",
    entityId: deleted.id,
    entityLabel: deleted.invoiceNumber,
    clientId: deleted.clientUserId,
    metadata: { stripeInvoiceId: deleted.stripeInvoiceId ?? null },
  });

  res.status(204).end();
});

// ─── ADMIN: Services ─────────────────────────────────────────────────────────
router.get("/admin/services", requireAdmin, async (_req: Request, res: Response) => {
  const services = await db.select().from(servicesTable).orderBy(asc(servicesTable.name));
  res.json(services);
});

router.post("/admin/services", requireAdmin, async (req: Request, res: Response) => {
  const { name, description, category, deliverables, price, basePrice, maxPrice, durationDays } = req.body as {
    name?: string; description?: string; category?: string; deliverables?: string;
    price?: string; basePrice?: string; maxPrice?: string; durationDays?: number;
  };
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  const [service] = await db.insert(servicesTable).values({
    name, description: description ?? null, category: category ?? null,
    deliverables: deliverables ? deliverables.split(",").map(s => s.trim()) : null,
    price: price ?? null,
    basePrice: basePrice ?? null, maxPrice: maxPrice ?? null,
    durationDays: durationDays ?? null,
  }).returning();
  res.status(201).json(service);
});

router.patch("/admin/services/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { name, description, category, deliverables, price, basePrice, maxPrice, durationDays } = req.body as {
    name?: string; description?: string; category?: string; deliverables?: string;
    price?: string; basePrice?: string; maxPrice?: string; durationDays?: number;
  };
  const updates: Partial<typeof servicesTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (category !== undefined) updates.category = category;
  if (deliverables !== undefined) updates.deliverables = deliverables.split(",").map(s => s.trim());
  if (price !== undefined) updates.price = price;
  if (basePrice !== undefined) updates.basePrice = basePrice;
  if (maxPrice !== undefined) updates.maxPrice = maxPrice;
  if (durationDays !== undefined) updates.durationDays = durationDays;
  const [updated] = await db.update(servicesTable).set(updates).where(eq(servicesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ─── ADMIN: Get/set order workflow for a service ──────────────────────────────
router.get("/admin/services/:id/workflow", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [service] = await db.select({ orderWorkflow: servicesTable.orderWorkflow })
    .from(servicesTable).where(eq(servicesTable.id, id));
  if (!service) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ workflow: service.orderWorkflow ?? [] });
});

router.put("/admin/services/:id/workflow", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { workflow } = req.body as { workflow: unknown };
  if (!Array.isArray(workflow)) { res.status(400).json({ error: "workflow must be a non-empty array of steps" }); return; }

  // Validate each step and its options
  const stepIds = new Set<string>();
  for (let si = 0; si < workflow.length; si++) {
    const step = workflow[si] as Record<string, unknown>;
    if (typeof step !== "object" || step === null) {
      res.status(400).json({ error: `step[${si}] must be an object` }); return;
    }
    if (typeof step.id !== "string" || step.id.trim() === "") {
      res.status(400).json({ error: `step[${si}].id must be a non-empty string` }); return;
    }
    if (stepIds.has(step.id)) {
      res.status(400).json({ error: `duplicate step id "${step.id}"` }); return;
    }
    stepIds.add(step.id);
    if (typeof step.title !== "string" || step.title.trim() === "") {
      res.status(400).json({ error: `step[${si}].title must be a non-empty string` }); return;
    }
    if (!Array.isArray(step.options) || step.options.length === 0) {
      res.status(400).json({ error: `step[${si}].options must be a non-empty array` }); return;
    }
    const optionIds = new Set<string>();
    for (let oi = 0; oi < step.options.length; oi++) {
      const opt = step.options[oi] as Record<string, unknown>;
      if (typeof opt !== "object" || opt === null) {
        res.status(400).json({ error: `step[${si}].options[${oi}] must be an object` }); return;
      }
      if (typeof opt.id !== "string" || opt.id.trim() === "") {
        res.status(400).json({ error: `step[${si}].options[${oi}].id must be a non-empty string` }); return;
      }
      if (optionIds.has(opt.id)) {
        res.status(400).json({ error: `step[${si}] has duplicate option id "${opt.id}"` }); return;
      }
      optionIds.add(opt.id);
      if (typeof opt.label !== "string" || opt.label.trim() === "") {
        res.status(400).json({ error: `step[${si}].options[${oi}].label must be a non-empty string` }); return;
      }
      if (typeof opt.priceAdjustment !== "number" || !isFinite(opt.priceAdjustment)) {
        res.status(400).json({ error: `step[${si}].options[${oi}].priceAdjustment must be a finite number` }); return;
      }
    }
  }

  const [updated] = await db.update(servicesTable)
    .set({ orderWorkflow: workflow as never })
    .where(eq(servicesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ workflow: updated.orderWorkflow ?? [] });
});

// ─── ADMIN: Assign service to client ─────────────────────────────────────────
router.post("/admin/client-services", requireAdmin, async (req: Request, res: Response) => {
  const { clientUserId, serviceId, projectId, startDate, nextMilestone, nextMilestoneDate } = req.body as {
    clientUserId?: number; serviceId?: number; projectId?: number; startDate?: string; nextMilestone?: string; nextMilestoneDate?: string;
  };
  if (!clientUserId || !serviceId) { res.status(400).json({ error: "clientUserId and serviceId are required" }); return; }

  const [cs] = await db.insert(clientServicesTable).values({
    clientUserId, serviceId, projectId: projectId ?? null,
    startDate: startDate ? new Date(startDate) : null,
    nextMilestone: nextMilestone ?? null,
    nextMilestoneDate: nextMilestoneDate ? new Date(nextMilestoneDate) : null,
  }).returning();

  const [service] = await db.select().from(servicesTable).where(eq(servicesTable.id, serviceId));
  if (service) {
    await db.insert(notificationsTable).values({
      userId: clientUserId,
      title: `Service activated: ${service.name}`,
      body: null, type: "general", linkPath: "/portal/services",
    });

    // Auto-generate project from the service's directly linked workflow template (if any)
    const resolvedWorkflowTemplateId = service.workflowTemplateId ?? null;
    let templateWorkflowSteps: Array<{ id: number; title: string; description: string | null; order: number }> = [];
    if (resolvedWorkflowTemplateId) {
      templateWorkflowSteps = await db
        .select()
        .from(workflowTemplateStepsTable)
        .where(eq(workflowTemplateStepsTable.workflowTemplateId, resolvedWorkflowTemplateId))
        .orderBy(asc(workflowTemplateStepsTable.order));
    }

    let resolvedProjectId: number | null = projectId ?? null;
    let templateStepsSeeded = false;

    if (templateWorkflowSteps.length > 0) {
      const [autoProject] = await db.insert(projectsTable).values({
        title: service.name,
        description: service.description ?? `Auto-generated from service: ${service.name}`,
        status: "active",
        clientUserId,
        progress: 0,
        startDate: new Date(),
      }).returning();

      resolvedProjectId = autoProject.id;

      // Link the client service to this project
      await db.update(clientServicesTable)
        .set({ projectId: autoProject.id })
        .where(eq(clientServicesTable.id, cs.id));

      // Seed workflow steps from the workflow template; first step auto-starts
      const createdSteps = await db.insert(workflowStepsTable).values(
        templateWorkflowSteps.map((s, idx) => ({
          clientServiceId: cs.id,
          projectId: autoProject.id,
          title: s.title,
          description: s.description ?? "",
          status: idx === 0 ? ("in_progress" as const) : ("pending" as const),
          order: idx + 1,
          workflowTemplateStepId: s.id,
        }))
      ).returning();

      // Seed kanban tasks for the first step from workflow_template_step_tasks (via workflowTemplateStepId)
      const firstCreatedStep = createdSteps[0];
      if (firstCreatedStep?.workflowTemplateStepId) {
        const step1Tasks = await db
          .select()
          .from(workflowTemplateStepTasksTable)
          .where(eq(workflowTemplateStepTasksTable.workflowTemplateStepId, firstCreatedStep.workflowTemplateStepId))
          .orderBy(asc(workflowTemplateStepTasksTable.order));
        if (step1Tasks.length > 0) {
          const resolvedMetadata = await resolveTemplateTaskMetadata(step1Tasks);
          await db.insert(kanbanTasksTable).values(
            step1Tasks.map((t, idx) => ({
              projectId: autoProject.id,
              workflowStepId: firstCreatedStep.id,
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

      templateStepsSeeded = true;

      // Notify client about the new project
      await db.insert(notificationsTable).values({
        userId: clientUserId,
        title: `Your project is ready: ${autoProject.title}`,
        body: null,
        type: "project_update",
        linkPath: `/portal/projects/${autoProject.id}`,
      });
    }

    // If no template steps were seeded, fall back to default slug-based steps
    // so the Dashboard tracker always has live data rather than showing mock content.
    if (!templateStepsSeeded) {
      await seedDefaultWorkflowSteps(cs.id, resolvedProjectId, service.slug ?? "");
    }
  }

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "service_activated",
    entityType: "service",
    entityId: cs.id,
    entityLabel: service?.name ?? String(serviceId),
    clientId: clientUserId,
  });

  res.status(201).json(cs);
});

// ─── ADMIN: Project updates ──────────────────────────────────────────────────
router.post("/admin/project-updates", requireAdmin, async (req: Request, res: Response) => {
  const { projectId, content, type } = req.body as { projectId?: number; content?: string; type?: string };
  if (!projectId || !content) { res.status(400).json({ error: "projectId and content are required" }); return; }

  const [update] = await db.insert(projectUpdatesTable).values({
    projectId,
    content,
    authorUserId: req.user!.id,
    type: (type as "update" | "milestone" | "message" | "file") ?? "update",
  }).returning();

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (project?.clientUserId) {
    await db.insert(notificationsTable).values({
      userId: project.clientUserId,
      title: "Project update from Shane",
      body: content.slice(0, 100),
      type: "project_update",
      linkPath: `/portal/projects/${projectId}`,
    });
  }

  res.status(201).json(update);
});

// ─── ONBOARDING: List public micro-offers ────────────────────────────────────
router.get("/portal/onboarding/services", async (_req: Request, res: Response) => {
  const services = await db.select().from(servicesTable)
    .where(and(
      eq(servicesTable.isPublic, true),
      inArray(servicesTable.serviceType, ["micro_offer", "retainer"]),
    ))
    .orderBy(asc(servicesTable.name));
  res.json(services);
});

// ─── ONBOARDING: Sign a contract (supports multi-service) ────────────────────
router.post("/portal/onboarding/contract", async (req: Request, res: Response) => {
  // Optional auth: use bearer JWT if present; otherwise treat as guest and require guestEmail in body
  let resolvedUserId: number | null = null;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret) {
      try {
        const payload = jwt.verify(authHeader.slice(7), jwtSecret) as { id: number };
        resolvedUserId = payload.id;
      } catch { /* invalid token — fall through to guest */ }
    }
  }

  let resolvedGuestEmail: string | null = null;
  if (resolvedUserId === null) {
    const { guestEmail } = req.body as { guestEmail?: string };
    if (!guestEmail?.trim()) {
      res.status(401).json({ error: "Please provide your email address to continue." });
      return;
    }
    resolvedGuestEmail = guestEmail.trim().toLowerCase();
  }

  const userId = resolvedUserId; // null for guests; contracts.userId is nullable
  const {
    serviceId, serviceIds: rawServiceIds, signatureData, signerName, wizardSelections, couponCode: bodyCouponCode,
    guestName, guestCompany, guestPhone, guestAddress, guestCity, guestState, guestZip,
  } = req.body as {
    serviceId?: number; serviceIds?: number[]; signatureData?: string; signerName?: string;
    wizardSelections?: Record<string, { stepId: string; stepTitle?: string; optionId: string; optionLabel?: string; priceAdjustment?: number }[]>;
    couponCode?: string;
    guestName?: string; guestCompany?: string; guestPhone?: string;
    guestAddress?: string; guestCity?: string; guestState?: string; guestZip?: string;
  };

  // Support both single serviceId (legacy) and serviceIds array (multi-service)
  const resolvedServiceIds: number[] = rawServiceIds?.length
    ? rawServiceIds
    : serviceId
      ? [serviceId]
      : [];

  if (resolvedServiceIds.length === 0 || !signerName?.trim()) {
    res.status(400).json({ error: "serviceId(s) and signerName are required" });
    return;
  }

  if (!signatureData || signatureData.trim().length < 100) {
    res.status(400).json({ error: "A drawn signature is required to sign the agreement" });
    return;
  }
  if (!signatureData.startsWith("data:image/")) {
    res.status(400).json({ error: "Invalid signature format" });
    return;
  }

  const fetchedSvcs = await db.select().from(servicesTable)
    .where(sql`${servicesTable.id} = ANY(ARRAY[${sql.join(resolvedServiceIds.map(id => sql`${id}`), sql`, `)}]::int[])`);
  if (fetchedSvcs.length !== resolvedServiceIds.length) {
    res.status(404).json({ error: "One or more services not found" });
    return;
  }
  // Preserve exact input order so contractIds[i] always pairs with serviceIds[i]
  const svcMap = new Map(fetchedSvcs.map(s => [s.id, s]));
  const services = resolvedServiceIds.map(id => svcMap.get(id)!);

  const ipAddress = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? null;
  const userAgent = req.headers["user-agent"] ?? null;

  const createdContracts: typeof contractsTable.$inferSelect[] = [];

  for (const svc of services) {
    // Fetch admin-authored contract template for this service (if any)
    const [contractTemplate] = await db
      .select()
      .from(contractTemplatesTable)
      .where(eq(contractTemplatesTable.serviceId, svc.id))
      .limit(1);

    // Substitute template variables into the body
    // ── Compute server-side wizard price for this service ───────────────
    let computedFinalPrice: number | null = null;
    const svcSelections = wizardSelections?.[String(svc.id)] ?? [];

    const rawWorkflow = svc.orderWorkflow as Array<unknown> | null;
    const hasWorkflow = Array.isArray(rawWorkflow) && rawWorkflow.length > 0 && svc.basePrice;

    if (hasWorkflow) {
      // Service has a wizard — selections are REQUIRED and strictly validated
      const workflow = rawWorkflow as Array<{ id: string; title: string; options: Array<{ id: string; label: string; priceAdjustment: number }> }>;

      // (1) Exactly one selection per step required — no missing, no duplicates
      const coveredStepIds = new Set<string>();
      for (const sel of svcSelections) {
        if (coveredStepIds.has(sel.stepId)) {
          res.status(400).json({ error: `Duplicate selection for step "${sel.stepId}" in service ${svc.id}` });
          return;
        }
        coveredStepIds.add(sel.stepId);
      }
      for (const wfStep of workflow) {
        if (!coveredStepIds.has(wfStep.id)) {
          res.status(400).json({ error: `Missing selection for required step "${wfStep.id}" (${wfStep.title}) in service ${svc.id}` });
          return;
        }
      }

      // (2) All step/option IDs must exist in the stored workflow
      let total = parseFloat(String(svc.basePrice));
      for (const sel of svcSelections) {
        const wStep = workflow.find(s => s.id === sel.stepId);
        if (!wStep) {
          res.status(400).json({ error: `Unknown step id "${sel.stepId}" for service ${svc.id}` });
          return;
        }
        const wOpt = wStep.options.find(o => o.id === sel.optionId);
        if (!wOpt) {
          res.status(400).json({ error: `Unknown option id "${sel.optionId}" for step "${sel.stepId}" in service ${svc.id}` });
          return;
        }
        total += wOpt.priceAdjustment;
      }

      // (3) Clamp to maxPrice ceiling if set
      if (svc.maxPrice) {
        const max = parseFloat(String(svc.maxPrice));
        total = Math.min(total, max);
      }
      computedFinalPrice = Math.round(total * 100) / 100;
    }

    const signedDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const effectivePriceStr = computedFinalPrice != null
      ? `$${computedFinalPrice.toLocaleString("en-US")}`
      : svc.price ? `$${parseFloat(String(svc.price)).toLocaleString("en-US")}` : "—";

    // Build a plain-text summary of wizard selections for the contract body/PDF
    let selectionsSummary = "";
    if (svcSelections.length > 0 && hasWorkflow) {
      const wf = rawWorkflow as Array<{ id: string; title: string; options: Array<{ id: string; label: string; priceAdjustment: number }> }>;
      const lines = svcSelections.map(sel => {
        const wStep = wf.find(s => s.id === sel.stepId);
        const wOpt = wStep?.options.find(o => o.id === sel.optionId);
        if (!wStep || !wOpt) return null;
        const adj = wOpt.priceAdjustment !== 0
          ? ` (${wOpt.priceAdjustment > 0 ? "+" : ""}$${wOpt.priceAdjustment.toLocaleString("en-US")})`
          : "";
        return `• ${wStep.title}: ${wOpt.label}${adj}`;
      }).filter(Boolean);
      if (lines.length > 0) {
        selectionsSummary = "Customisation selections:\n" + lines.join("\n");
      }
    }

    let templateBody = contractTemplate?.body?.trim()
      ? contractTemplate.body
          .replace(/\{\{client_name\}\}/g, signerName.trim())
          .replace(/\{\{service_name\}\}/g, svc.name)
          .replace(/\{\{price\}\}/g, effectivePriceStr)
          .replace(/\{\{date\}\}/g, signedDate)
          .replace(/\{\{selections_summary\}\}/g, selectionsSummary)
      : undefined;

    // ── Testimonial obligation clause (TESTIMONIAL coupon) ────────────────
    // The coupon code is passed from the frontend at signing time (before checkout).
    // Checkout also authoritatively re-checks and updates agreementBody if needed.
    const TESTIMONIAL_MARKER = "Testimonial & Case Study Obligation";
    const TESTIMONIAL_CLAUSE = `\n\n---\n\n**Testimonial & Case Study Obligation**\n\nThe discounted rate applied to this engagement was granted in exchange for the Client's agreement to provide a written testimonial or short case study within 5 days of project completion. The testimonial or case study will describe the Client's experience working with Shane McCaw Consulting and may be used by Shane McCaw Consulting for marketing purposes. Failure to deliver the testimonial or case study within the stated period does not retroactively alter the agreed service price, but the discount benefit will not be available on future engagements until the obligation is fulfilled.`;
    let pdfAppendBody: string | undefined;

    if (bodyCouponCode?.trim()) {
      const [appliedCouponRow] = await db
        .select({ requiresTestimonial: couponsTable.requiresTestimonial })
        .from(couponsTable)
        .where(eq(couponsTable.code, bodyCouponCode.trim().toUpperCase()))
        .limit(1);
      if (appliedCouponRow?.requiresTestimonial) {
        if (templateBody) {
          // Append clause to admin-authored template (both DB record and PDF use it)
          templateBody = templateBody + TESTIMONIAL_CLAUSE;
        } else {
          // No admin template: standard PDF sections render via the normal path.
          // The testimonial clause is appended separately via appendBody so the
          // standard legal sections are preserved in the generated PDF.
          pdfAppendBody = TESTIMONIAL_CLAUSE.trimStart();
        }
      }
    }

    const [contract] = await db.insert(contractsTable).values({
      userId: resolvedUserId,
      guestEmail: resolvedGuestEmail,
      serviceId: svc.id,
      signatureData,
      signerName: signerName.trim(),
      ipAddress,
      userAgent,
      contractVersion: contractTemplate?.version ?? "v1",
      finalPrice: computedFinalPrice != null ? String(computedFinalPrice) : null,
      wizardSelections: svcSelections.length > 0 ? svcSelections as never : null,
      // When no template exists but a testimonial clause applies, store the clause
      // in agreementBody so there is a DB record; the PDF renders it via appendBody.
      agreementBody: templateBody ?? (pdfAppendBody ?? null),
    }).returning();

    // ── Generate signed PDF immediately at signing time ──────────────────
    try {
      const { filename: pdfFilename, buffer: pdfBuffer, localFilePath } = await generateContractPdf({
        contractId: contract.id,
        signerName: signerName.trim(),
        serviceName: svc.name,
        servicePrice: effectivePriceStr,
        billingType: svc.billingType as "one_time" | "recurring_monthly",
        serviceDeliverables: Array.isArray(svc.deliverables) && svc.deliverables.length > 0
          ? svc.deliverables.join(", ")
          : "as described on the service page",
        serviceTurnaround: svc.turnaround ?? "see service details",
        signedAt: contract.signedAt ?? new Date(),
        signatureDataUrl: signatureData,
        contractTemplateBody: templateBody,
        selectionsSummary: selectionsSummary || undefined,
        appendBody: pdfAppendBody,
      });

      // ── Upload to SharePoint Contracts folder ──────────────────────────
      let sharepointFileUrl: string | null = null;
      let sharepointFileId: string | null = null;

      const [clientUser] = resolvedUserId !== null
        ? await db.select({ sharepointSiteId: usersTable.sharepointSiteId })
            .from(usersTable).where(eq(usersTable.id, resolvedUserId))
        : [null];

      if (!clientUser?.sharepointSiteId) {
        req.log.warn({ contractId: contract.id }, "contract signing: client has no SharePoint site — PDF saved locally only");
      } else if (!graphCredentialsPresent()) {
        req.log.warn({ contractId: contract.id }, "contract signing: Graph credentials missing — PDF saved locally only");
      } else {
        const spResult = await uploadFileToClientContracts(clientUser.sharepointSiteId, pdfFilename, pdfBuffer);
        if (spResult) {
          sharepointFileUrl = spResult.webUrl;
          sharepointFileId = spResult.fileId;
          req.log.info({ contractId: contract.id, sharepointFileUrl }, "contract PDF uploaded to SharePoint");
        } else {
          req.log.warn({ contractId: contract.id }, "contract signing: SharePoint upload failed — PDF saved locally only");
        }
      }

      await db.update(contractsTable)
        .set({ pdfFilename, sharepointFileUrl, sharepointFileId, localFilePath })
        .where(eq(contractsTable.id, contract.id));
      createdContracts.push({ ...contract, pdfFilename, sharepointFileUrl, sharepointFileId, localFilePath });
    } catch (pdfErr) {
      req.log.error({ err: pdfErr }, "contract signing: PDF generation failed (non-fatal)");
      createdContracts.push(contract);
    }
  }

  // Audit the signing
  void createAuditLog({
    actorUserId: resolvedUserId ?? undefined,
    actorName: req.user?.name ?? req.user?.email ?? resolvedGuestEmail ?? "Guest",
    actorRole: "client",
    actionType: "contract_signed",
    entityType: "contract",
    entityId: createdContracts.map(c => c.id).join(","),
    entityLabel: services.map(s => s.name).join(", "),
    clientId: resolvedUserId ?? undefined,
    metadata: { signerName, serviceCount: createdContracts.length },
  });

  // ── Save guest profile fields (company, address, phone) at signing time ──────
  // The full account (with password) is created after Stripe payment, but we
  // pre-create the row here so the address is available from first login.
  if (resolvedUserId === null && resolvedGuestEmail) {
    try {
      const { id: guestUserId } = await ensureClientAccount(resolvedGuestEmail, guestName ?? signerName);
      // Only write fields that are not already populated to avoid clobbering existing data
      const [existing] = await db
        .select({ company: usersTable.company, phone: usersTable.phone, address: usersTable.address })
        .from(usersTable).where(eq(usersTable.id, guestUserId));
      const profilePatch: Record<string, string | null> = {};
      if (!existing?.company && guestCompany?.trim()) profilePatch.company = guestCompany.trim();
      if (!existing?.phone && guestPhone?.trim()) profilePatch.phone = guestPhone.trim();
      if (!existing?.address && guestAddress?.trim()) profilePatch.address = guestAddress.trim();
      if (guestCity?.trim()) profilePatch.addressCity = guestCity.trim();
      if (guestState?.trim()) profilePatch.addressState = guestState.trim();
      if (guestZip?.trim()) profilePatch.addressZip = guestZip.trim();
      if (Object.keys(profilePatch).length > 0) {
        await db.update(usersTable).set(profilePatch).where(eq(usersTable.id, guestUserId));
      }
    } catch (err) {
      req.log.warn({ err }, "contract signing: failed to pre-save guest profile fields (non-fatal)");
    }
  }

  // Return both legacy single-contract and new multi-contract formats
  if (createdContracts.length === 1) {
    res.status(201).json({ ...createdContracts[0], contractIds: [createdContracts[0].id] });
  } else {
    res.status(201).json({ contractIds: createdContracts.map(c => c.id), contracts: createdContracts });
  }
});

// ─── ONBOARDING: Get a contract ───────────────────────────────────────────────
router.get("/portal/onboarding/contract/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const isAdmin = req.user!.role === "admin";
  const [contract] = await db.select().from(contractsTable)
    .where(isAdmin ? eq(contractsTable.id, id) : and(eq(contractsTable.id, id), eq(contractsTable.userId, userId)));
  if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }
  res.json(contract);
});

// ─── ONBOARDING: Check Stripe session (success page polling) ─────────────────
// Public endpoint — the Stripe session_id is a cryptographically random secret
// that serves as the authentication token. For logged-in users, ownership is also
// verified against req.user when present.
router.get("/portal/onboarding/session/:sessionId", async (req: Request, res: Response) => {
  let stripeKey: string;
  try { stripeKey = getStripeKey(); } catch (e) { res.status(503).json({ error: (e as Error).message }); return; }
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);
  try {
    const session = await stripe.checkout.sessions.retrieve(String(req.params.sessionId));
    // For logged-in users with userId-type sessions, optionally verify ownership
    if (session.metadata?.userId && req.user) {
      if (session.metadata.userId !== String(req.user.id)) {
        res.status(403).json({ error: "Session not found or access denied" });
        return;
      }
    }
    // For subscription sessions, retrieve next billing date from the subscription
    let nextBillingDate: number | null = null;
    if (session.mode === "subscription" && session.subscription) {
      try {
        const sub = await stripe.subscriptions.retrieve(String(session.subscription));
        nextBillingDate = sub.billing_cycle_anchor ?? null;
      } catch {
        // non-fatal — success page renders without it
      }
    }
    res.json({ status: session.payment_status, metadata: session.metadata, mode: session.mode, nextBillingDate });
  } catch {
    res.status(404).json({ error: "Session not found" });
  }
});

// ─── ONBOARDING: Provision project after successful payment ──────────────────
// Public endpoint — payment_status === "paid" is the security gate.
// For user sessions: metadata.userId identifies the buyer.
// For guest sessions: metadata.guestEmail / customer_details.email are used to
//   create/find the client account. The session_id is a Stripe-generated
//   cryptographically random string that is impractical to guess.
// Safe to call multiple times — provisionOnboardingProject is idempotent.
router.post("/portal/onboarding/provision/:sessionId", async (req: Request, res: Response) => {
  let stripeKey: string;
  try { stripeKey = getStripeKey(); } catch (e) { res.status(503).json({ error: (e as Error).message }); return; }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  let session: import("stripe").Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(String(req.params.sessionId), {
      expand: ["customer_details"],
    });
  } catch {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.metadata?.type !== "onboarding_purchase") {
    res.status(400).json({ error: "Not an onboarding session" });
    return;
  }

  if (session.payment_status !== "paid") {
    res.status(402).json({ error: "Payment not yet confirmed" });
    return;
  }

  // Resolve the user account for this session.
  // User sessions carry metadata.userId; guest sessions use the Stripe customer email.
  let resolvedUserId: number | null = null;
  if (session.metadata?.userId) {
    resolvedUserId = parseInt(session.metadata.userId, 10) || null;
  }
  if (resolvedUserId === null) {
    const customerEmail =
      (session.customer_details as { email?: string } | null)?.email ??
      session.metadata?.guestEmail ??
      null;
    if (!customerEmail) {
      res.status(400).json({ error: "Cannot determine customer email for account provisioning" });
      return;
    }
    const acct = await ensureClientAccount(customerEmail);
    resolvedUserId = acct.id;
    // Link any pre-payment guest contracts to the newly created account
    await db.update(contractsTable)
      .set({ userId: resolvedUserId })
      .where(and(eq(contractsTable.guestEmail, customerEmail), isNull(contractsTable.userId)));
  }

  try {
    const subId = typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription as { id?: string } | null)?.id ?? null;

    // Check before provisioning so we know if the webhook already ran.
    // If an invoice already exists for this session the webhook beat us here
    // and has already sent any client emails — we skip to avoid duplicates.
    const [preExistingInvoice] = await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(eq(invoicesTable.stripeSessionId, session.id))
      .limit(1);
    const webhookAlreadyRan = !!preExistingInvoice;

    await provisionOnboardingProject(req, session, subId, resolvedUserId);
    req.log.info({ sessionId: session.id, userId: resolvedUserId }, "onboarding provision: triggered from success page");

    // If the user has no password yet, generate a setup token and deliver it via email.
    // We do NOT return the token in the JSON response (which is a public endpoint keyed
    // only by session_id) — the email ensures only the account owner can use it.
    const [provUser] = await db
      .select({ passwordHash: usersTable.passwordHash, email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, resolvedUserId))
      .limit(1);
    const hasPassword = !!(provUser?.passwordHash);
    let sentSetupEmail = false;
    const baseUrl = getPortalBaseUrl();
    if (!hasPassword && provUser?.email) {
      // Atomic: advisory-locked transaction finds an existing valid token or
      // creates one — concurrent webhook + success-page calls produce exactly one.
      // isNew=true means this call created the token and owns the email send.
      const { token: activeToken, isNew: tokenIsNew } = await ensureClientSetupToken(resolvedUserId);
      sentSetupEmail = tokenIsNew;
      if (tokenIsNew) {
        // Send setup link via email — token never leaves the server in the API response.
        const setupUrl = `${baseUrl}/portal/onboarding/success?setup_token=${activeToken}`;
        void sendEmailFromTemplate(
          "account-setup",
          provUser.email,
          { setupLink: setupUrl, clientName: provUser.name ?? provUser.email },
          "Set up your Shane McCaw Consulting portal",
          `<p>Hi ${provUser.name ?? ""},</p><p>Your project workspace is ready. Click the link below to set your portal password:</p><p><a href="${setupUrl}" style="color:#0078D4;">Set my password →</a></p><p>This link expires in 72 hours.</p><p>— Shane McCaw</p>`,
        ).catch(() => null);
      }
    } else if (hasPassword && provUser?.email && !webhookAlreadyRan) {
      // Returning client — send a "project is ready" email with portal login link.
      // Skip if webhook already ran (it will have sent the email in its own path).
      const sidsStr = session.metadata?.serviceIds ?? session.metadata?.serviceId ?? "";
      const sids = sidsStr.split(",").map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));
      let serviceName = "your service";
      if (sids.length > 0) {
        const svcs = await db.select({ name: servicesTable.name }).from(servicesTable)
          .where(inArray(servicesTable.id, sids));
        if (svcs.length > 0) serviceName = svcs.map(s => s.name).join(", ");
      }
      const amountDollars = session.amount_total ? String(Math.round(session.amount_total / 100)) : "0";
      void sendEmailFromTemplate(
        "onboarding-confirmation",
        provUser.email,
        {
          clientName: provUser.name ?? provUser.email,
          serviceName,
          amountDollars,
          projectUrl: baseUrl,
        },
        "Your project workspace is ready — Shane McCaw Consulting",
        `<p>Hi ${provUser.name ?? ""},</p><p>Your <strong>${serviceName}</strong> project workspace is ready. Log in to your portal to track progress.</p><p><a href="${baseUrl}" style="color:#0078D4;">View your portal →</a></p><p>— Shane McCaw</p>`,
      ).catch(() => null);
    }

    res.json({ ok: true, hasPassword, sentSetupEmail });
  } catch (err) {
    req.log.error({ err }, "onboarding provision: failed");
    res.status(500).json({ error: "Provisioning failed" });
  }
});

// ─── Shared coupon helper ─────────────────────────────────────────────────────
async function lookupAndValidateCoupon(
  code: string,
  cartTotal: number,
): Promise<{ ok: true; coupon: typeof couponsTable.$inferSelect; discountAmount: number } | { ok: false; error: string }> {
  if (cartTotal <= 0) return { ok: false, error: "Coupon codes cannot be applied to a free cart" };
  const upper = code.trim().toUpperCase();
  const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, upper));
  if (!coupon) return { ok: false, error: "Coupon code not found" };
  if (!coupon.active) return { ok: false, error: "This coupon is inactive" };
  if (coupon.expiresAt && coupon.expiresAt < new Date()) return { ok: false, error: "This coupon has expired" };
  if (coupon.maxUses != null && coupon.usesCount >= coupon.maxUses) return { ok: false, error: "This coupon has reached its usage limit" };

  const value = parseFloat(String(coupon.discountValue));
  let discountAmount: number;
  if (coupon.discountType === "percentage") {
    discountAmount = Math.round((cartTotal * value / 100) * 100) / 100;
  } else {
    discountAmount = Math.min(value, cartTotal);
  }
  return { ok: true, coupon, discountAmount };
}

// ─── PUBLIC: Coupon Availability Check (no auth, no cart total) ──────────────
// Returns { available: true } if the coupon exists, is active, not expired,
// and has not reached its usage limit. Used to conditionally show promo banners.
router.get("/portal/coupons/available/:code", async (req: Request, res: Response) => {
  const code = String(req.params.code ?? "").trim().toUpperCase();
  if (!code) { res.status(400).json({ error: "code is required" }); return; }
  const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, code));
  if (!coupon || !coupon.active) { res.json({ available: false }); return; }
  if (coupon.expiresAt && coupon.expiresAt < new Date()) { res.json({ available: false }); return; }
  if (coupon.maxUses != null && coupon.usesCount >= coupon.maxUses) { res.json({ available: false }); return; }
  res.json({ available: true });
});

// ─── CLIENT: Coupon Validate ─────────────────────────────────────────────────
// No auth required — coupon codes are not sensitive; guests need this while reviewing their cart
router.post("/portal/coupons/validate", async (req: Request, res: Response) => {
  const { code, cartTotal } = req.body as { code?: string; cartTotal?: number };
  if (!code?.trim()) { res.status(400).json({ error: "code is required" }); return; }
  if (cartTotal == null || isNaN(Number(cartTotal)) || Number(cartTotal) < 0) {
    res.status(400).json({ error: "cartTotal is required" });
    return;
  }
  if (Number(cartTotal) === 0) {
    res.status(422).json({ error: "Coupon codes cannot be applied when your cart total is $0" });
    return;
  }

  const result = await lookupAndValidateCoupon(code, Number(cartTotal));
  if (!result.ok) {
    res.status(422).json({ error: result.error });
    return;
  }
  res.json({
    code: result.coupon.code,
    discountType: result.coupon.discountType,
    discountValue: result.coupon.discountValue,
    discountAmount: result.discountAmount,
    discountedTotal: Math.max(0, Number(cartTotal) - result.discountAmount),
  });
});

// ─────────────────────────────────────────────────────────────────────────────

router.post("/portal/checkout/create-session", async (req: Request, res: Response) => {
  // Optional auth — logged-in users pass JWT; guests pass guestEmail in body
  let resolvedUserId: number | null = null;
  let resolvedGuestEmail: string | null = null;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret) {
      try {
        const payload = jwt.verify(authHeader.slice(7), jwtSecret) as { id: number };
        resolvedUserId = payload.id;
      } catch { /* fall through to guest */ }
    }
  }
  if (!resolvedUserId && req.user) resolvedUserId = req.user.id;

  const {
    serviceId, serviceIds: rawServiceIds,
    contractId, contractIds: rawContractIds,
    returnUrl, startDate, couponCode,
    guestEmail: bodyGuestEmail,
  } = req.body as {
    serviceId?: number; serviceIds?: number[];
    contractId?: number; contractIds?: number[];
    returnUrl?: string; startDate?: string;
    couponCode?: string;
    guestEmail?: string;
  };

  if (!resolvedUserId) {
    if (!bodyGuestEmail?.trim()) {
      res.status(401).json({ error: "Authentication required or provide guestEmail" });
      return;
    }
    resolvedGuestEmail = bodyGuestEmail.trim().toLowerCase();
  }

  // Support legacy single-service and new multi-service formats
  const resolvedServiceIds: number[] = rawServiceIds?.length ? rawServiceIds : serviceId ? [serviceId] : [];
  const resolvedContractIds: number[] = rawContractIds?.length ? rawContractIds : contractId ? [contractId] : [];

  if (resolvedServiceIds.length === 0 || resolvedContractIds.length === 0) {
    res.status(400).json({ error: "serviceIds and contractIds are required" });
    return;
  }
  if (resolvedServiceIds.length !== resolvedContractIds.length) {
    res.status(400).json({ error: "serviceIds and contractIds must have the same length" });
    return;
  }

  // ── Security: verify all contracts belong to this user/guest and match services ──
  // Also capture finalPrice from each contract (server-computed wizard price)
  const contractFinalPrices = new Map<number, number | null>();
  for (let i = 0; i < resolvedContractIds.length; i++) {
    const contractCondition = resolvedUserId !== null
      ? and(eq(contractsTable.id, resolvedContractIds[i]), eq(contractsTable.userId, resolvedUserId))
      : and(eq(contractsTable.id, resolvedContractIds[i]), eq(contractsTable.guestEmail, resolvedGuestEmail!));
    const [contract] = await db.select().from(contractsTable).where(contractCondition);
    if (!contract) {
      res.status(403).json({ error: "Contract not found or does not belong to this account" });
      return;
    }
    if (contract.serviceId !== resolvedServiceIds[i]) {
      res.status(403).json({ error: "Contract service mismatch" });
      return;
    }
    contractFinalPrices.set(
      resolvedServiceIds[i],
      contract.finalPrice != null ? parseFloat(String(contract.finalPrice)) : null,
    );
  }

  // Fetch all services
  const services = await db.select().from(servicesTable)
    .where(sql`${servicesTable.id} = ANY(ARRAY[${sql.join(resolvedServiceIds.map(id => sql`${id}`), sql`, `)}]::int[])`);

  const missingPrices = services.filter(s => !s.price && contractFinalPrices.get(s.id) == null);
  if (missingPrices.length > 0) {
    res.status(400).json({ error: `Service "${missingPrices[0].name}" has no price configured` });
    return;
  }
  if (services.length !== resolvedServiceIds.length) {
    res.status(404).json({ error: "One or more services not found" });
    return;
  }

  let stripeKey: string;
  try { stripeKey = getStripeKey(); } catch (e) { res.status(503).json({ error: (e as Error).message }); return; }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  let sessionCustomerId: string | undefined;
  if (resolvedUserId !== null) {
    const [sessionUserProfile] = await db.select({
      email: usersTable.email,
      name: usersTable.name,
      address: usersTable.address,
      addressCity: usersTable.addressCity,
      addressState: usersTable.addressState,
      addressZip: usersTable.addressZip,
    }).from(usersTable).where(eq(usersTable.id, resolvedUserId));
    if (sessionUserProfile) {
      sessionCustomerId = await getOrCreateStripeCustomer(stripe, sessionUserProfile);
    }
  }

  const baseUrl = returnUrl ?? `${req.protocol}://${req.hostname}`;

  // Map serviceId → contractId for lookup
  const serviceToContract = new Map<number, number>();
  for (let i = 0; i < resolvedServiceIds.length; i++) {
    serviceToContract.set(resolvedServiceIds[i], resolvedContractIds[i]);
  }

  // Group by billing type (preserve original ordering)
  const oneTimeServices = services.filter(s => s.billingType === "one_time");
  const recurringServices = services.filter(s => s.billingType === "recurring_monthly");

  let oneTimeUrl: string | null = null;
  let subscriptionUrl: string | null = null;
  const startDateStr = startDate ?? new Date().toISOString();

  // ── Coupon: server-side re-validation ─────────────────────────────────────
  // Build raw price map (before discount) for all services
  const rawPriceCents = new Map<number, number>();
  for (const s of services) {
    rawPriceCents.set(s.id, Math.round((contractFinalPrices.get(s.id) ?? parseFloat(String(s.price!))) * 100));
  }
  const totalCartCents = [...rawPriceCents.values()].reduce((a, b) => a + b, 0);

  // Per-service discounted price in cents
  const discountedPriceCents = new Map<number, number>(rawPriceCents);
  let validatedCouponCode: string | null = null;

  if (couponCode?.trim() && totalCartCents > 0) {
    const couponResult = await lookupAndValidateCoupon(couponCode, totalCartCents / 100);
    if (!couponResult.ok) {
      res.status(422).json({ error: `Coupon error: ${couponResult.error}` });
      return;
    }
    validatedCouponCode = couponResult.coupon.code;
    const discountCents = Math.round(couponResult.discountAmount * 100);
    // Distribute the discount proportionally across all services
    let remaining = discountCents;
    const svcIds = [...rawPriceCents.keys()];
    for (let i = 0; i < svcIds.length; i++) {
      const id = svcIds[i];
      const raw = rawPriceCents.get(id)!;
      const isLast = i === svcIds.length - 1;
      const share = isLast
        ? remaining
        : Math.round(discountCents * raw / totalCartCents);
      discountedPriceCents.set(id, Math.max(0, raw - share));
      remaining -= share;
    }

    // ── Authoritative testimonial clause enforcement ────────────────────────
    // If the server-validated coupon requires a testimonial, ensure every
    // associated contract's agreementBody contains the obligation clause,
    // regardless of whether the client passed the coupon code at signing time.
    if (couponResult.coupon.requiresTestimonial) {
      const TESTIMONIAL_MARKER = "Testimonial & Case Study Obligation";
      const TESTIMONIAL_CLAUSE = `\n\n---\n\n**Testimonial & Case Study Obligation**\n\nThe discounted rate applied to this engagement was granted in exchange for the Client's agreement to provide a written testimonial or short case study within 5 days of project completion. The testimonial or case study will describe the Client's experience working with Shane McCaw Consulting and may be used by Shane McCaw Consulting for marketing purposes. Failure to deliver the testimonial or case study within the stated period does not retroactively alter the agreed service price, but the discount benefit will not be available on future engagements until the obligation is fulfilled.`;
      for (const contractId of resolvedContractIds) {
        const [existingContract] = await db
          .select({ id: contractsTable.id, agreementBody: contractsTable.agreementBody })
          .from(contractsTable)
          .where(eq(contractsTable.id, contractId));
        if (existingContract && !existingContract.agreementBody?.includes(TESTIMONIAL_MARKER)) {
          const updatedBody = existingContract.agreementBody
            ? existingContract.agreementBody + TESTIMONIAL_CLAUSE
            : TESTIMONIAL_CLAUSE.trimStart();
          await db.update(contractsTable)
            .set({ agreementBody: updatedBody })
            .where(eq(contractsTable.id, contractId));
        }
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  try {
    // ── One-time Checkout Session (payment mode) ───────────────────────────
    if (oneTimeServices.length > 0) {
      const otContractIds = oneTimeServices.map(s => serviceToContract.get(s.id)!);
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        customer: sessionCustomerId,
        ...(resolvedGuestEmail && !sessionCustomerId ? { customer_email: resolvedGuestEmail } : {}),
        billing_address_collection: "required",
        line_items: oneTimeServices.map(s => ({
          price_data: {
            currency: "usd",
            product_data: { name: s.name, description: s.description ?? undefined },
            unit_amount: discountedPriceCents.get(s.id)!,
          },
          quantity: 1,
        })),
        mode: "payment",
        automatic_tax: { enabled: true },
        success_url: `${baseUrl}/portal/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/portal/onboarding/contract?serviceIds=${oneTimeServices.map(s => s.id).join(",")}&cancelled=1`,
        metadata: {
          type: "onboarding_purchase",
          ...(resolvedUserId !== null
            ? { userId: String(resolvedUserId) }
            : { guestEmail: resolvedGuestEmail! }),
          serviceIds: oneTimeServices.map(s => s.id).join(","),
          contractIds: otContractIds.join(","),
          serviceName: oneTimeServices.map(s => s.name).join(", "),
          startDate: startDateStr,
          servicePrices: oneTimeServices.map(s => (contractFinalPrices.get(s.id) ?? parseFloat(String(s.price ?? 0))).toFixed(2)).join(","),
          ...(validatedCouponCode ? { couponCode: validatedCouponCode } : {}),
        },
      });
      oneTimeUrl = session.url;
    }

    // ── Subscription Checkout Session (subscription mode) ──────────────────
    if (recurringServices.length > 0) {
      const recContractIds = recurringServices.map(s => serviceToContract.get(s.id)!);
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        customer: sessionCustomerId,
        ...(resolvedGuestEmail && !sessionCustomerId ? { customer_email: resolvedGuestEmail } : {}),
        billing_address_collection: "required",
        line_items: recurringServices.map(s => ({
          price_data: {
            currency: "usd",
            product_data: { name: s.name, description: s.description ?? undefined },
            unit_amount: discountedPriceCents.get(s.id)!,
            recurring: { interval: "month" as const },
          },
          quantity: 1,
        })),
        mode: "subscription",
        success_url: `${baseUrl}/portal/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/portal/onboarding/contract?serviceIds=${recurringServices.map(s => s.id).join(",")}&cancelled=1`,
        metadata: {
          type: "onboarding_purchase",
          ...(resolvedUserId !== null
            ? { userId: String(resolvedUserId) }
            : { guestEmail: resolvedGuestEmail! }),
          serviceIds: recurringServices.map(s => s.id).join(","),
          contractIds: recContractIds.join(","),
          serviceName: recurringServices.map(s => s.name).join(", "),
          startDate: startDateStr,
          servicePrices: recurringServices.map(s => (contractFinalPrices.get(s.id) ?? parseFloat(String(s.price ?? 0))).toFixed(2)).join(","),
          // Only attach couponCode to this session if there is no one-time session.
          // In mixed carts the one-time session already carries the couponCode, so the
          // webhook only increments usesCount once (idempotency is also backed by
          // coupon_redemptions.checkout_session_id UNIQUE).
          ...(validatedCouponCode && oneTimeServices.length === 0 ? { couponCode: validatedCouponCode } : {}),
        },
      });
      subscriptionUrl = session.url;
    }
  } catch (stripeErr) {
    const msg = stripeErr instanceof Error ? stripeErr.message : "Stripe error";
    req.log.error({ err: stripeErr }, "checkout: Stripe session creation failed");
    res.status(502).json({ error: `Payment provider error: ${msg}` });
    return;
  }

  // Primary URL is one-time first (if mixed cart, subscription comes after)
  const primaryUrl = oneTimeUrl ?? subscriptionUrl;
  const secondaryUrl = oneTimeUrl && subscriptionUrl ? subscriptionUrl : null;

  res.json({ url: primaryUrl, oneTimeUrl, subscriptionUrl, secondaryUrl });
});

// ─── ADMIN: Contracts ─────────────────────────────────────────────────────────
router.get("/admin/contracts", requireAdmin, async (_req: Request, res: Response) => {
  const contracts = await db
    .select({
      id: contractsTable.id,
      serviceId: contractsTable.serviceId,
      userId: contractsTable.userId,
      signerName: contractsTable.signerName,
      signedAt: contractsTable.signedAt,
      contractVersion: contractsTable.contractVersion,
      projectId: contractsTable.projectId,
      stripeSessionId: contractsTable.stripeSessionId,
      serviceName: servicesTable.name,
      serviceSlug: servicesTable.slug,
      clientEmail: usersTable.email,
      clientCompany: usersTable.company,
    })
    .from(contractsTable)
    .leftJoin(servicesTable, eq(contractsTable.serviceId, servicesTable.id))
    .leftJoin(usersTable, eq(contractsTable.userId, usersTable.id))
    .orderBy(desc(contractsTable.signedAt));
  res.json(contracts);
});

// ─── ADMIN: Delete a contract ─────────────────────────────────────────────────
router.delete("/admin/contracts/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid contract ID" }); return; }

  const [existing] = await db.select({ id: contractsTable.id }).from(contractsTable).where(eq(contractsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Contract not found" }); return; }

  await db.delete(contractsTable).where(eq(contractsTable.id, id));
  res.status(204).end();
});

// ─── ADMIN: Purchases (onboarding invoices only) ──────────────────────────────
router.get("/admin/purchases", requireAdmin, async (_req: Request, res: Response) => {
  const purchases = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      description: invoicesTable.description,
      amount: invoicesTable.amount,
      currency: invoicesTable.currency,
      status: invoicesTable.status,
      paidAt: invoicesTable.paidAt,
      stripeSessionId: invoicesTable.stripeSessionId,
      createdAt: invoicesTable.createdAt,
      clientEmail: usersTable.email,
      clientName: usersTable.name,
      clientCompany: usersTable.company,
    })
    .from(invoicesTable)
    .leftJoin(usersTable, eq(invoicesTable.clientUserId, usersTable.id))
    .where(sql`${invoicesTable.invoiceNumber} like 'ONB-%' OR ${invoicesTable.invoiceNumber} like 'SVC-%'`)
    .orderBy(desc(invoicesTable.createdAt));
  res.json(purchases);
});

// ─── ADMIN: Purchase detail ────────────────────────────────────────────────
router.get("/admin/purchases/:id", requireAdmin, async (req: Request, res: Response) => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Fetch the base invoice row first (no contract join yet)
  const invoiceRows = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      description: invoicesTable.description,
      amount: invoicesTable.amount,
      currency: invoicesTable.currency,
      status: invoicesTable.status,
      paidAt: invoicesTable.paidAt,
      stripeSessionId: invoicesTable.stripeSessionId,
      couponCode: invoicesTable.couponCode,
      discountAmount: invoicesTable.discountAmount,
      createdAt: invoicesTable.createdAt,
      clientId: usersTable.id,
      clientName: usersTable.name,
      clientEmail: usersTable.email,
      clientCompany: usersTable.company,
      projectId: projectsTable.id,
      projectName: projectsTable.title,
    })
    .from(invoicesTable)
    .leftJoin(usersTable, eq(invoicesTable.clientUserId, usersTable.id))
    .leftJoin(projectsTable, eq(invoicesTable.projectId, projectsTable.id))
    .where(eq(invoicesTable.id, id))
    .limit(1);

  if (invoiceRows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  const inv = invoiceRows[0];


  // Fetch ALL contracts linked to this purchase (multi-service cart support).
  // Strategy: prefer stripeSessionId match (set on all contracts during fulfillment).
  // Fallback to projectId match for non-first invoices whose stripeSessionId is null.
  type ContractRow = {
    contractId: number;
    serviceName: string | null;
    wizardSelections: unknown;
    orderWorkflow: unknown;
  };
  let contracts: ContractRow[] = [];
  if (inv.stripeSessionId) {
    contracts = await db
      .select({
        contractId: contractsTable.id,
        serviceName: servicesTable.name,
        wizardSelections: contractsTable.wizardSelections,
        orderWorkflow: servicesTable.orderWorkflow,
      })
      .from(contractsTable)
      .leftJoin(servicesTable, eq(contractsTable.serviceId, servicesTable.id))
      .where(eq(contractsTable.stripeSessionId, inv.stripeSessionId));
  } else if (inv.projectId) {
    // Non-first invoice in a multi-service cart — contracts were updated with
    // projectId at fulfillment time even though the invoice has no sessionId.
    contracts = await db
      .select({
        contractId: contractsTable.id,
        serviceName: servicesTable.name,
        wizardSelections: contractsTable.wizardSelections,
        orderWorkflow: servicesTable.orderWorkflow,
      })
      .from(contractsTable)
      .leftJoin(servicesTable, eq(contractsTable.serviceId, servicesTable.id))
      .where(
        and(
          eq(contractsTable.projectId, inv.projectId),
          eq(contractsTable.userId, inv.clientId ?? -1)
        )
      );
  }

  res.json({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    description: inv.description,
    amount: inv.amount,
    currency: inv.currency,
    status: inv.status,
    paidAt: inv.paidAt,
    stripeSessionId: inv.stripeSessionId,
    couponCode: inv.couponCode ?? null,
    discountAmount: inv.discountAmount ?? null,
    createdAt: inv.createdAt,
    client: {
      id: inv.clientId,
      name: inv.clientName,
      email: inv.clientEmail,
      company: inv.clientCompany,
    },
    project: inv.projectId ? { id: inv.projectId, name: inv.projectName } : null,
    contracts: contracts.map(c => ({
      contractId: c.contractId,
      serviceName: c.serviceName,
      wizardSelections: c.wizardSelections ?? null,
      orderWorkflow: c.orderWorkflow ?? null,
    })),
  });
});

// ─── ADMIN: Delete purchase ────────────────────────────────────────────────
router.delete("/admin/purchases/:id", requireAdmin, async (req: Request, res: Response) => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const force = req.query.force === "true";

  const [inv] = await db
    .select({ id: invoicesTable.id, stripeSessionId: invoicesTable.stripeSessionId, projectId: invoicesTable.projectId })
    .from(invoicesTable)
    .where(eq(invoicesTable.id, id))
    .limit(1);

  if (!inv) { res.status(404).json({ error: "Purchase not found" }); return; }

  // ── Blocker check ──────────────────────────────────────────────────────────
  if (inv.projectId && !force) {
    const [project] = await db
      .select({ id: projectsTable.id, title: projectsTable.title, status: projectsTable.status })
      .from(projectsTable)
      .where(eq(projectsTable.id, inv.projectId))
      .limit(1);

    if (project) {
      const [{ taskCount }] = await db
        .select({ taskCount: sql<number>`cast(count(*) as int)` })
        .from(kanbanTasksTable)
        .where(eq(kanbanTasksTable.projectId, inv.projectId));

      const [{ docCount }] = await db
        .select({ docCount: sql<number>`cast(count(*) as int)` })
        .from(documentsTable)
        .where(eq(documentsTable.projectId, inv.projectId));

      const [{ stepCount }] = await db
        .select({ stepCount: sql<number>`cast(count(*) as int)` })
        .from(workflowStepsTable)
        .where(eq(workflowStepsTable.projectId, inv.projectId));

      const [{ reportCount }] = await db
        .select({ reportCount: sql<number>`cast(count(*) as int)` })
        .from(statusReportsTable)
        .where(eq(statusReportsTable.projectId, inv.projectId));

      const hasBlockers = (taskCount > 0) || (docCount > 0) || (stepCount > 0) || (reportCount > 0) || project.status === "active";

      if (hasBlockers) {
        res.status(409).json({
          error: "blocked",
          blockers: {
            project: { id: project.id, title: project.title, status: project.status },
            kanbanTasks: taskCount,
            documents: docCount,
            workflowSteps: stepCount,
            statusReports: reportCount,
          },
        });
        return;
      }
    }
  }

  // ── Cascade delete (force path cleans up the project first) ────────────────
  await db.transaction(async (tx) => {
    if (inv.projectId && force) {
      const [project] = await tx
        .select({ id: projectsTable.id })
        .from(projectsTable)
        .where(eq(projectsTable.id, inv.projectId))
        .limit(1);

      if (project) {
        await tx.delete(kanbanTasksTable).where(eq(kanbanTasksTable.projectId, inv.projectId));
        await tx.delete(workflowStepsTable).where(eq(workflowStepsTable.projectId, inv.projectId));
        await tx.delete(documentsTable).where(eq(documentsTable.projectId, inv.projectId));
        await tx.delete(projectUpdatesTable).where(eq(projectUpdatesTable.projectId, inv.projectId));
        await tx.update(reportsTable).set({ projectId: null }).where(eq(reportsTable.projectId, inv.projectId));
        await tx.update(statusReportsTable).set({ projectId: null }).where(eq(statusReportsTable.projectId, inv.projectId));
        // Nullify projectId on this invoice so FK allows project deletion
        await tx.update(invoicesTable).set({ projectId: null }).where(eq(invoicesTable.projectId, inv.projectId));
        await tx.delete(projectsTable).where(eq(projectsTable.id, inv.projectId));
      }
    }

    // Delete linked contracts (matched by stripeSessionId or projectId)
    if (inv.stripeSessionId) {
      await tx.delete(contractsTable).where(eq(contractsTable.stripeSessionId, inv.stripeSessionId));
    }
    if (inv.projectId) {
      await tx.delete(contractsTable).where(eq(contractsTable.projectId, inv.projectId));
      await tx.delete(clientServicesTable).where(eq(clientServicesTable.projectId, inv.projectId));
    }

    await tx.delete(invoicesTable).where(eq(invoicesTable.id, id));
  });

  res.status(204).end();
});

// ─── PUBLIC: Testimonials ────────────────────────────────────────────────────
router.get("/public/testimonials", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: projectClosuresTable.id,
      feedback: projectClosuresTable.feedback,
      signedAt: projectClosuresTable.signedAt,
      projectType: projectsTable.projectType,
      clientName: usersTable.name,
    })
    .from(projectClosuresTable)
    .innerJoin(projectsTable, eq(projectClosuresTable.projectId, projectsTable.id))
    .leftJoin(usersTable, eq(projectClosuresTable.signerUserId, usersTable.id))
    .where(
      and(
        eq(projectClosuresTable.permissionGranted, true),
        sql`${projectClosuresTable.signedAt} IS NOT NULL`,
        sql`${projectClosuresTable.feedback} IS NOT NULL AND trim(${projectClosuresTable.feedback}) <> ''`,
      )
    )
    .orderBy(desc(projectClosuresTable.signedAt));

  const out = rows.map(r => ({
    id: r.id,
    feedback: r.feedback,
    signedAt: r.signedAt,
    projectType: r.projectType,
    clientFirstName: r.clientName ? r.clientName.trim().split(/\s+/)[0] : null,
  }));
  res.json(out);
});

// ─── ADMIN: Request closure sign-off for a project ───────────────────────────
router.post("/admin/projects/:id/closure-request", requireAdmin, async (req: Request, res: Response) => {
  const projectId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (project.status !== "completed") {
    res.status(422).json({ error: "Closure can only be requested for completed projects" });
    return;
  }

  const existing = await db.select().from(projectClosuresTable).where(eq(projectClosuresTable.projectId, projectId));
  if (existing.length > 0) {
    res.status(409).json({ error: "Closure already requested for this project", closure: existing[0] });
    return;
  }

  const [closure] = await db.insert(projectClosuresTable).values({ projectId }).returning();

  // Send email to client if project has a clientUserId
  if (project.clientUserId) {
    const [client] = await db.select().from(usersTable).where(eq(usersTable.id, project.clientUserId));
    if (client) {
      await sendEmailFromTemplate(
        "closure-request",
        client.email,
        { clientName: client.name ?? "", projectTitle: project.title, projectUrl: `${PORTAL_URL}/projects/${projectId}` },
        `Project Sign-Off: ${project.title}`,
        closureRequestEmail({ clientName: client.name ?? "", projectTitle: project.title, projectId }),
      );
    }
  }

  res.json(closure);
});

// ─── ADMIN: Get closure for a project ────────────────────────────────────────
router.get("/admin/projects/:id/closure", requireAdmin, async (req: Request, res: Response) => {
  const projectId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const [closure] = await db.select().from(projectClosuresTable).where(eq(projectClosuresTable.projectId, projectId));
  if (!closure) { res.status(404).json({ error: "No closure record found" }); return; }
  res.json(closure);
});

// ─── ADMIN: List all approved (signed + permissionGranted) closures ──────────
router.get("/admin/closures/approved", requireAdmin, async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: projectClosuresTable.id,
      projectId: projectClosuresTable.projectId,
      projectTitle: projectsTable.title,
      projectType: projectsTable.projectType,
      feedback: projectClosuresTable.feedback,
      permissionGranted: projectClosuresTable.permissionGranted,
      signedAt: projectClosuresTable.signedAt,
      requestedAt: projectClosuresTable.requestedAt,
      clientName: usersTable.name,
      clientEmail: usersTable.email,
    })
    .from(projectClosuresTable)
    .innerJoin(projectsTable, eq(projectClosuresTable.projectId, projectsTable.id))
    .leftJoin(usersTable, eq(projectClosuresTable.signerUserId, usersTable.id))
    .where(
      and(
        sql`${projectClosuresTable.signedAt} IS NOT NULL`,
        eq(projectClosuresTable.permissionGranted, true),
      )
    )
    .orderBy(desc(projectClosuresTable.signedAt));
  res.json(rows);
});

// ─── PUBLIC: Testimonials alias ──────────────────────────────────────────────
router.get("/testimonials", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: projectClosuresTable.id,
      feedback: projectClosuresTable.feedback,
      signedAt: projectClosuresTable.signedAt,
      projectType: projectsTable.projectType,
      clientName: usersTable.name,
    })
    .from(projectClosuresTable)
    .innerJoin(projectsTable, eq(projectClosuresTable.projectId, projectsTable.id))
    .leftJoin(usersTable, eq(projectClosuresTable.signerUserId, usersTable.id))
    .where(
      and(
        eq(projectClosuresTable.permissionGranted, true),
        sql`${projectClosuresTable.signedAt} IS NOT NULL`,
        sql`${projectClosuresTable.feedback} IS NOT NULL AND trim(${projectClosuresTable.feedback}) <> ''`,
      )
    )
    .orderBy(desc(projectClosuresTable.signedAt));

  const out = rows.map(r => ({
    id: r.id,
    feedback: r.feedback,
    signedAt: r.signedAt,
    projectType: r.projectType,
    clientFirstName: r.clientName ? r.clientName.trim().split(/\s+/)[0] : null,
  }));
  res.json(out);
});

// ─── ADMIN: List ALL signed closures (for admin testimonials page) ───────────
router.get("/admin/closures/signed", requireAdmin, async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: projectClosuresTable.id,
      projectId: projectClosuresTable.projectId,
      projectTitle: projectsTable.title,
      projectType: projectsTable.projectType,
      feedback: projectClosuresTable.feedback,
      permissionGranted: projectClosuresTable.permissionGranted,
      signedAt: projectClosuresTable.signedAt,
      requestedAt: projectClosuresTable.requestedAt,
      clientName: usersTable.name,
      clientEmail: usersTable.email,
    })
    .from(projectClosuresTable)
    .innerJoin(projectsTable, eq(projectClosuresTable.projectId, projectsTable.id))
    .leftJoin(usersTable, eq(projectClosuresTable.signerUserId, usersTable.id))
    .where(sql`${projectClosuresTable.signedAt} IS NOT NULL`)
    .orderBy(desc(projectClosuresTable.signedAt));
  res.json(rows);
});

// ─── PORTAL: Get closure for client's project ────────────────────────────────
router.get("/portal/projects/:id/closure", requireAuth, async (req: Request, res: Response) => {
  const projectId = parseInt(String(req.params.id ?? ""), 10);
  const userId = req.user!.id;
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  // Verify the project belongs to this user
  const [project] = await db.select().from(projectsTable).where(
    and(eq(projectsTable.id, projectId), eq(projectsTable.clientUserId, userId))
  );
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const [closure] = await db.select().from(projectClosuresTable).where(eq(projectClosuresTable.projectId, projectId));
  if (!closure) { res.status(404).json({ error: "No closure record" }); return; }
  res.json(closure);
});

// ─── PORTAL: Sign closure ─────────────────────────────────────────────────────
router.post("/portal/projects/:id/closure/sign", requireAuth, async (req: Request, res: Response) => {
  const projectId = parseInt(String(req.params.id ?? ""), 10);
  const userId = req.user!.id;
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const [project] = await db.select().from(projectsTable).where(
    and(eq(projectsTable.id, projectId), eq(projectsTable.clientUserId, userId))
  );
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const [existing] = await db.select().from(projectClosuresTable).where(eq(projectClosuresTable.projectId, projectId));
  if (!existing) { res.status(404).json({ error: "Closure not requested yet" }); return; }
  if (existing.signedAt) { res.status(409).json({ error: "Project has already been signed off", closure: existing }); return; }

  const { feedback, permissionGranted, signatureDataUrl } = req.body as {
    feedback?: string;
    permissionGranted?: boolean;
    signatureDataUrl?: string;
  };

  const trimmedFeedback = feedback?.trim() ?? "";
  if (!trimmedFeedback) {
    res.status(422).json({ error: "Feedback is required" });
    return;
  }
  if (!signatureDataUrl || !signatureDataUrl.startsWith("data:image/")) {
    res.status(422).json({ error: "A valid signature is required" });
    return;
  }

  const [updated] = await db.update(projectClosuresTable)
    .set({
      feedback: trimmedFeedback,
      permissionGranted: permissionGranted === true,
      signatureDataUrl,
      signedAt: new Date(),
      signerUserId: userId,
    })
    .where(eq(projectClosuresTable.id, existing.id))
    .returning();

  res.json(updated);
});

// ─── ADMIN: MFA Status & Reset ───────────────────────────────────────────────

const MFA_METHOD_LABELS: Record<string, string> = {
  totp: "Authenticator App (TOTP)",
  sms: "SMS",
};

router.get("/admin/clients/:id/mfa-status", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid client ID" }); return; }

    const [client] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "client")))
      .limit(1);
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const enrollments = await db
      .select({ method: mfaEnrollmentsTable.method })
      .from(mfaEnrollmentsTable)
      .where(and(eq(mfaEnrollmentsTable.userId, id), eq(mfaEnrollmentsTable.enabled, true)));

    const passkeyCount = await db
      .select({ id: webauthnCredentialsTable.id })
      .from(webauthnCredentialsTable)
      .where(eq(webauthnCredentialsTable.userId, id));

    const methods = enrollments.map(e => e.method);
    if (passkeyCount.length > 0) methods.push("passkey");

    res.json({ methods });
  } catch (err) {
    req.log.error(err, "Failed to fetch client MFA status");
    res.status(500).json({ error: "Failed to fetch MFA status" });
  }
});

router.post("/admin/clients/:id/mfa-reset", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid client ID" }); return; }

    const [client] = await db
      .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "client")))
      .limit(1);
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const enrollments = await db
      .select({ method: mfaEnrollmentsTable.method })
      .from(mfaEnrollmentsTable)
      .where(eq(mfaEnrollmentsTable.userId, id));

    const passkeyRows = await db
      .select({ id: webauthnCredentialsTable.id })
      .from(webauthnCredentialsTable)
      .where(eq(webauthnCredentialsTable.userId, id));

    const clearedMethods: string[] = enrollments.map(e => e.method);
    if (passkeyRows.length > 0) clearedMethods.push("passkey");

    await db.delete(mfaEnrollmentsTable).where(eq(mfaEnrollmentsTable.userId, id));
    await db.delete(mfaChallengesTable).where(eq(mfaChallengesTable.userId, id));
    await db.delete(webauthnCredentialsTable).where(eq(webauthnCredentialsTable.userId, id));
    await db.delete(webauthnChallengesTable).where(eq(webauthnChallengesTable.userId, id));

    const methodsList = clearedMethods
      .map(m => MFA_METHOD_LABELS[m] ?? m)
      .join(", ") || "None";

    await sendEmailFromTemplate(
      "mfa-reset",
      client.email,
      {
        clientName: client.name ?? client.email,
        methodsList,
        loginLink: PORTAL_URL,
        securityLink: `${PORTAL_URL}/security`,
      },
      "Your two-factor authentication has been reset",
      `<p>Hi ${client.name ?? client.email},</p><p>Your MFA has been reset. Please sign in and set up a new authentication method.</p><p><a href="${PORTAL_URL}">Sign in to your portal</a></p>`,
    );

    req.log.info({ clientId: id, clearedMethods }, "Admin reset client MFA");
    res.json({ ok: true, clearedMethods });
  } catch (err) {
    req.log.error(err, "Failed to reset client MFA");
    res.status(500).json({ error: "Failed to reset MFA" });
  }
});

// ─── CLIENT: Manual Scripts ───────────────────────────────────────────────────

/**
 * GET /api/portal/projects/:projectId/manual-scripts
 * Returns all manual script run results for a project that are awaiting_upload or completed.
 * Also includes script metadata (name, description, manualRequirements).
 */
router.get("/portal/projects/:projectId/manual-scripts", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const projectId = parseInt(String(req.params.projectId));
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid projectId" }); return; }

  try {
    // Verify project belongs to this client
    const [project] = await db
      .select({ id: projectsTable.id, clientUserId: projectsTable.clientUserId })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.clientUserId, userId)))
      .limit(1);

    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    // Find the service linked to this project
    const [clientService] = await db
      .select({ serviceId: clientServicesTable.serviceId })
      .from(clientServicesTable)
      .where(and(eq(clientServicesTable.projectId, projectId), eq(clientServicesTable.clientUserId, userId)))
      .limit(1);

    if (!clientService) { res.json([]); return; }

    // Fetch manual script run results for this package + customer
    const rows = await db
      .select({
        runResultId: scriptRunResultsTable.id,
        scriptId: scriptRunResultsTable.scriptId,
        status: scriptRunResultsTable.status,
        createdAt: scriptRunResultsTable.createdAt,
        uploadedAt: scriptRunResultsTable.uploadedAt,
        parsedFindings: scriptRunResultsTable.parsedFindings,
        recommendations: scriptRunResultsTable.recommendations,
        scriptName: powershellScriptsTable.title,
        description: powershellScriptsTable.description,
        psScriptBody: powershellScriptsTable.scriptBody,
      })
      .from(scriptRunResultsTable)
      .leftJoin(powershellScriptsTable, eq(scriptRunResultsTable.libraryScriptId, powershellScriptsTable.id))
      .where(
        and(
          eq(scriptRunResultsTable.customerId, userId),
          eq(scriptRunResultsTable.packageId, clientService.serviceId),
          eq(scriptRunResultsTable.executionSource, "manual"),
        ),
      )
      .orderBy(desc(scriptRunResultsTable.createdAt));

    // Filter to only awaiting_upload or completed
    const filtered = rows.filter(r => r.status === "awaiting_upload" || r.status === "completed");

    // Look up the client's display name for the package generation context
    const [clientUser] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    const domains = process.env.REPLIT_DOMAINS;
    const uploadBaseUrl = domains
      ? `https://${domains.split(",")[0]?.trim()}`
      : process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "http://localhost:8080";

    // Augment each row with the package-generated instructions and filename
    const enriched = filtered.map(row => {
      const pkg = generateManualScriptPackage({
        scriptId: row.scriptId ?? 0,
        scriptName: row.scriptName ?? "Script",
        description: row.description ?? null,
        manualRequirements: [],
        psScriptBody: row.psScriptBody ?? null,
        runResultId: row.runResultId,
        customerDisplayName: clientUser?.name ?? undefined,
        uploadBaseUrl,
      });
      return {
        runResultId: row.runResultId,
        scriptId: row.scriptId,
        status: row.status,
        createdAt: row.createdAt,
        uploadedAt: row.uploadedAt,
        scriptName: row.scriptName ?? null,
        description: row.description ?? null,
        manualRequirements: [] as string[],
        outputSchema: null as null,
        filename: pkg.filename,
        instructions: pkg.instructions,
        findings: Array.isArray(row.parsedFindings) ? row.parsedFindings as string[] : [],
        recommendations: Array.isArray(row.recommendations) ? row.recommendations as string[] : [],
      };
    });

    res.json(enriched);
  } catch (err) {
    logger.error({ err, projectId, userId }, "portal: failed to list manual scripts");
    res.status(500).json({ error: "Failed to load manual scripts" });
  }
});

/**
 * GET /api/portal/projects/:projectId/manual-scripts/:runResultId/download
 * Generates and returns the .ps1 script file for a manual script run.
 */
router.get("/portal/projects/:projectId/manual-scripts/:runResultId/download", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const projectId = parseInt(String(req.params.projectId));
  const runResultId = parseInt(String(req.params.runResultId));
  if (isNaN(projectId) || isNaN(runResultId)) { res.status(400).json({ error: "Invalid parameters" }); return; }

  try {
    // Verify project ownership
    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.clientUserId, userId)))
      .limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    // Fetch the run result and verify it belongs to this client
    const [runResult] = await db
      .select({
        id: scriptRunResultsTable.id,
        scriptId: scriptRunResultsTable.scriptId,
        libraryScriptId: scriptRunResultsTable.libraryScriptId,
        customerId: scriptRunResultsTable.customerId,
        status: scriptRunResultsTable.status,
      })
      .from(scriptRunResultsTable)
      .where(and(eq(scriptRunResultsTable.id, runResultId), eq(scriptRunResultsTable.customerId, userId)))
      .limit(1);
    if (!runResult) { res.status(404).json({ error: "Script run not found" }); return; }

    // Prefer libraryScriptId (new runs) over legacy scriptId (old runs)
    const scriptLookupId = runResult.libraryScriptId ?? (runResult.scriptId != null ? runResult.scriptId.toString() : null);
    const [script] = scriptLookupId
      ? await db
          .select()
          .from(powershellScriptsTable)
          .where(eq(powershellScriptsTable.id, scriptLookupId))
          .limit(1)
      : [];

    const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);

    const domains = process.env.REPLIT_DOMAINS;
    const uploadBaseUrl = domains
      ? `https://${domains.split(",")[0]?.trim()}`
      : process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "http://localhost:8080";

    const pkg = generateManualScriptPackage({
      scriptId: runResult.scriptId ?? 0,
      scriptName: script?.title ?? "Script",
      description: script?.description ?? null,
      manualRequirements: [],
      psScriptBody: script?.scriptBody ?? null,
      runResultId,
      customerDisplayName: user?.name ?? undefined,
      uploadBaseUrl,
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${pkg.filename}"`);
    res.send(pkg.psContent);
  } catch (err) {
    logger.error({ err, runResultId }, "portal: failed to download manual script");
    res.status(500).json({ error: "Failed to generate script download" });
  }
});

/**
 * POST /api/portal/manual-scripts/:scriptRunId/upload
 * Accepts parsed JSON results from the client for a manual script run.
 * Body: { jsonData: Record<string, unknown> }
 * Validates and stores results, then triggers AI analysis and score updates.
 */
router.post("/portal/manual-scripts/:scriptRunId/upload", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const scriptRunId = parseInt(String(req.params.scriptRunId));
  if (isNaN(scriptRunId)) { res.status(400).json({ error: "Invalid scriptRunId" }); return; }

  const { jsonData } = req.body as { jsonData?: unknown };

  if (!jsonData || typeof jsonData !== "object" || Array.isArray(jsonData)) {
    res.status(400).json({ error: "Request body must include a valid JSON object in the 'jsonData' field" });
    return;
  }

  const data = jsonData as Record<string, unknown>;

  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "Uploaded JSON must not be empty" });
    return;
  }

  if (!("data" in data)) {
    res.status(400).json({ error: "Uploaded JSON must contain a 'data' key with the collected output" });
    return;
  }

  try {
    // Ownership check — ensure the run result belongs to this authenticated client.
    const [runRow] = await db
      .select({
        id: scriptRunResultsTable.id,
      })
      .from(scriptRunResultsTable)
      .where(and(eq(scriptRunResultsTable.id, scriptRunId), eq(scriptRunResultsTable.customerId, userId)))
      .limit(1);
    if (!runRow) { res.status(404).json({ error: "Script run not found" }); return; }

    // Schema validation was removed with catalog; accept any valid JSON object.

    const [user] = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    const uploadedBy = user?.name ?? user?.email ?? String(userId);

    const { processManualScriptUpload, UploadError } = await import("../lib/manual-script-upload");
    const result = await processManualScriptUpload(scriptRunId, data, uploadedBy);

    logger.info({ scriptRunId, userId }, "portal: manual script upload processed");
    res.json({
      runResultId: result.runResultId,
      status: result.status,
      findings: result.findings,
      recommendations: result.recommendations,
    });
  } catch (err) {
    const { UploadError } = await import("../lib/manual-script-upload");
    if (err instanceof UploadError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    logger.error({ err, scriptRunId }, "portal: manual script upload failed");
    res.status(500).json({ error: "Failed to process uploaded results" });
  }
});

// ─── ADMIN: Admin messages (all clients) ────────────────────────────────────
router.get("/admin/messages/clients", requireAdmin, async (_req: Request, res: Response) => {
  const clients = await db.select({
    id: usersTable.id,
    email: usersTable.email,
    name: usersTable.name,
    company: usersTable.company,
    unread: sql<number>`(SELECT count(*) FROM messages WHERE client_user_id = ${usersTable.id} AND read_by_admin = false)`.mapWith(Number),
    lastMessage: sql<string>`(SELECT created_at FROM messages WHERE client_user_id = ${usersTable.id} ORDER BY created_at DESC LIMIT 1)`,
  }).from(usersTable).where(eq(usersTable.role, "client")).orderBy(desc(usersTable.createdAt));
  res.json(clients);
});

export default router;
