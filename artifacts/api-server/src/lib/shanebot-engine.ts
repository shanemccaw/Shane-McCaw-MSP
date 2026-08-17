/**
 * ShaneBot Engine Core (#1097, epic #360).
 *
 * The single shared module both ShaneBot surfaces call into instead of each
 * independently maintaining its own persona / grounding / context logic:
 *   - public-chat.ts  (ShaneBot Public — unauthenticated marketing site)
 *   - support-chat.ts (ShaneBot Paid   — authenticated portal)
 *
 * Deliberately sized for EXACTLY the two permanent instances that will ever exist
 * (shanebot_public, shanebot_paid). This is NOT a generic bot-builder and there is
 * NO pluggable grounding registry: each groundingSource is one hand-written builder
 * function, not a registered/composable node type. The generic-engine scope lives
 * in #365's history to revisit if a real 3rd bot ever materializes — it is not
 * being built speculatively here.
 *
 * What this module owns:
 *   1. Instance config — code-canonical (persona surface, grounding source, allowed
 *      actions, cost owner). Seeded into the bot_instances table to match, but the
 *      engine reads the CODE definition so a route never hard-depends on the row
 *      being seeded (or on Shane having run the migration yet).
 *   2. Persona resolution — via the shared shanebot-persona.ts module (code, NOT
 *      admin-authorable — see #361). This module does not restate voice.
 *   3. Grounding — the instance's groundingSource builder (live_catalog /
 *      customer_entitlements), each a self-contained function.
 *   4. System-prompt assembly — persona + grounding + the suggested-replies
 *      control-token instruction.
 *   5. action_router — parses model-emitted [ACTION:x] control tokens and gates
 *      each against the emitting instance's allowedActions BEFORE anything fires.
 *      Public ([]) can fire none.
 *   6. Conversation storage (#361) — upsertBotConversation()/getBotConversation-
 *      Transcript(s)() persist a session's structured-block transcript onto the
 *      shared bot_conversations table, replacing the earlier plan to bolt
 *      storage onto each route's own message table independently.
 *
 * What it deliberately does NOT own: each surface's route-specific SAFETY sections
 * — the public personal-topic HARD BOUNDARY (public-chat-guardrail.ts), the
 * remediation-proposal rules and escalation markers (support-chat.ts). Those stay
 * where they live; a shared module that also carried safety rules would be one
 * nobody dares edit. Route-owned business metadata (public-chat's review queue:
 * needsReview, contact capture, escalation reason) also stays on that route's own
 * table — only the transcript itself moved here.
 */

import { and, asc, count, desc, eq, gte, inArray, like } from "drizzle-orm";
import {
  db,
  servicesTable,
  mspsTable,
  tenantsTable,
  mspEventStoreTable,
  mspSowsTable,
  mspSalesBundlesTable,
  mspSalesBundleAssignmentsTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  botInstancesTable,
  botConversationsTable,
  type BotAction,
  type BotAuthMode,
  type BotCostOwner,
  type BotGroundingSource,
  type BotConversationMessage,
} from "@workspace/db";
import { logger } from "./logger.ts";
import { getShaneBotPersona, renderPersonaPrompt, type ShaneBotSurface } from "./shanebot-persona.ts";
import { SUGGESTED_REPLIES_INSTRUCTION } from "./chat-content-blocks.ts";

const log = logger.child({ channel: "engine.shanebot" });

// ── Instance config (code-canonical) ──────────────────────────────────────────
// The two permanent instances. This is the source of truth the migration's seed
// rows mirror — not the other way around.

export type BotSlug = "shanebot_public" | "shanebot_paid";

export interface BotInstanceConfig {
  slug: BotSlug;
  name: string;
  authMode: BotAuthMode;
  groundingSource: BotGroundingSource;
  allowedActions: BotAction[];
  costOwner: BotCostOwner;
  /** Which persona voice this instance renders (shanebot-persona.ts). */
  personaSurface: ShaneBotSurface;
}

export const BOT_INSTANCES: Record<BotSlug, BotInstanceConfig> = {
  shanebot_public: {
    slug: "shanebot_public",
    name: "ShaneBot Public",
    authMode: "public",
    groundingSource: "live_catalog",
    allowedActions: [],
    costOwner: "platform",
    personaSurface: "public",
  },
  shanebot_paid: {
    slug: "shanebot_paid",
    name: "ShaneBot Paid",
    authMode: "portal_authenticated",
    groundingSource: "customer_entitlements",
    allowedActions: ["regenerate_document", "rerun_scan"],
    costOwner: "msp",
    personaSurface: "portal",
  },
};

/** Resolve an instance's code-canonical config by slug. */
export function resolveInstance(slug: BotSlug): BotInstanceConfig {
  return BOT_INSTANCES[slug];
}

// ── Persona resolution ────────────────────────────────────────────────────────

/** The persona VOICE section of a system prompt for this instance. */
export function resolvePersonaPrompt(instance: BotInstanceConfig): string {
  return renderPersonaPrompt(getShaneBotPersona(instance.personaSurface));
}

// ── Grounding ─────────────────────────────────────────────────────────────────

export interface BotGrounding {
  /** One line describing who the model is talking to, for the prompt. */
  identity: string;
  /** The grounded data block the model must answer strictly from. */
  summary: string;
}

/** Context the customer_entitlements builder needs. Ignored by live_catalog. */
export interface CustomerEntitlementsContext {
  customerId: number | null;
  mspId: number | null;
  isCustomerUser: boolean;
}

/**
 * Call the instance's groundingSource builder. Dispatch is a plain switch, NOT a
 * registry — the two arms below are the only two that will ever exist.
 */
export async function buildGrounding(
  instance: BotInstanceConfig,
  ctx?: CustomerEntitlementsContext,
): Promise<BotGrounding> {
  switch (instance.groundingSource) {
    case "live_catalog":
      return buildLiveCatalogGrounding();
    case "customer_entitlements":
      return buildCustomerEntitlementsGrounding(
        ctx ?? { customerId: null, mspId: null, isCustomerUser: false },
      );
    default: {
      // Exhaustiveness guard: a new groundingSource enum value added without a
      // matching builder lands here loudly rather than silently grounding on
      // nothing (that silent-drift class is exactly what #1097 exists to prevent).
      const unhandled: never = instance.groundingSource;
      log.error({ instance: instance.slug, groundingSource: unhandled }, "shanebot-engine: no grounding builder for source");
      return { identity: "user", summary: "Grounding data is temporarily unavailable." };
    }
  }
}

// ── live_catalog builder (ShaneBot Public) ────────────────────────────────────
// A compact, real snapshot of the public services catalog, cached in-process so a
// busy public endpoint doesn't re-query per turn. Grounding is pragmatic, not a
// full RAG system — real names, taglines, categories, and pricing are enough for
// honest answers.
//
// SOURCE-OF-TRUTH NOTE (#1097 root cause, resolved #364): #1085 (Stale Content
// Audit) closed 2026-08-17 with zero comments, no linked PR/commit, and no new
// schema field — its sub-issues (#1080/#1086/#1090/#1091) did route-restoration
// and copy-drift auditing, but never established the canonical "actually
// reachable on the router" field #1097 anticipated. So there is no field to
// swap to. `services.visibility === "public"` alone is NOT enough: it's true for
// rows whose only real page is `/msp` (category `platform_subscription` —
// Free/Growth/Pro tiers — and `msp_onboarding`), which isn't a registered route
// yet (`App.tsx` — deferred to open #1088), plus a handful of authenticated-
// portal-only rows (e.g. `category` null "remediation" line items that only
// ever surface inside a customer's msp-portal journey, and `Launch Control`,
// an msp-portal add-on with no marketing page at all).
//
// Fix: gate on visibility AND an explicit allowlist of `category` values that
// are confirmed (by reading `App.tsx`'s registered <Route> list) to have a live
// public marketing page today. This is deliberately fail-closed — a category
// not in the list is excluded until someone adds it here with a route to point
// at, rather than fail-open on a denylist that has to guess every bad case.
// `category` is an existing classification column already used elsewhere for
// page-routing purposes — this is not a second parallel "visibility" flag, it's
// the same flag plus the one additional fact (which page a category renders on)
// that was actually missing. If #1085's promised field is ever built for real,
// swap the `inArray` filter below for it and delete LIVE_MARKETING_CATEGORIES.
const LIVE_MARKETING_CATEGORIES = [
  "assessment", // /assessments + /assessments/:slug
  "project", // /projects + /projects/:slug
  "retainer", // /platform/retainer + /retainers/architect-*
  "monitoring", // /monitoring
  "config_pack", // /platform/quick-start
] as const;

const CATALOG_TTL_MS = 5 * 60_000;
let catalogCache: { summary: string; expires: number } | null = null;

/** Public-visitor identity line — voice-neutral; the persona carries the tone. */
const PUBLIC_VISITOR_IDENTITY = "a visitor on the Shane McCaw Consulting public site who has not bought anything yet";

function formatPrice(priceCents: number | null, billingType: string | null): string {
  if (priceCents == null || priceCents <= 0) return "pricing varies";
  const dollars = Math.round(priceCents / 100).toLocaleString("en-US");
  const suffix =
    billingType === "subscription" || billingType === "recurring" || billingType === "monthly"
      ? "/mo"
      : "";
  return `$${dollars}${suffix}`;
}

// Degraded-mode grounding if the catalog query fails — the high-level shape of the
// practice, so the assistant stays honest and useful rather than blank. No specific
// prices are invented here (the model is told pricing "varies" and to say so).
const FALLBACK_CATALOG_SUMMARY = [
  "• Assessments — a review of your Microsoft 365 tenant's security, configuration, and health, delivered as a written findings report.",
  "• Monitoring — ongoing, continuous monitoring of your M365 tenant against best-practice baselines (recurring).",
  "• Quick-Start Packs — fixed-scope, fixed-price packages that stand up a specific M365 capability quickly.",
  "• Projects — larger scoped engagements (migrations, governance rollouts, Power Platform, SharePoint).",
  "• Retainer — an ongoing advisory/architecture relationship for continued support.",
  "(Live pricing is temporarily unavailable — tell the visitor pricing varies and offer to take their request so it can be reviewed.)",
].join("\n");

async function buildLiveCatalogGrounding(): Promise<BotGrounding> {
  const now = Date.now();
  if (catalogCache && catalogCache.expires > now) {
    return { identity: PUBLIC_VISITOR_IDENTITY, summary: catalogCache.summary };
  }

  try {
    const rows = await db
      .select({
        name: servicesTable.name,
        tagline: servicesTable.tagline,
        description: servicesTable.description,
        category: servicesTable.category,
        serviceType: servicesTable.serviceType,
        billingType: servicesTable.billingType,
        priceCents: servicesTable.priceCents,
        isFreeOffering: servicesTable.isFreeOffering,
      })
      .from(servicesTable)
      // See SOURCE-OF-TRUTH NOTE above — visibility alone drifts (e.g. MSP tiers,
      // whose only page isn't routed yet); the category allowlist closes that gap.
      .where(
        and(
          eq(servicesTable.visibility, "public"),
          inArray(servicesTable.category, LIVE_MARKETING_CATEGORIES),
        ),
      )
      .orderBy(asc(servicesTable.sortOrder), asc(servicesTable.createdAt))
      .limit(60);

    if (rows.length === 0) {
      catalogCache = { summary: FALLBACK_CATALOG_SUMMARY, expires: now + CATALOG_TTL_MS };
      return { identity: PUBLIC_VISITOR_IDENTITY, summary: FALLBACK_CATALOG_SUMMARY };
    }

    const lines = rows.map((s) => {
      const price = s.isFreeOffering ? "free" : formatPrice(s.priceCents, s.billingType);
      const blurb = (s.tagline ?? s.description ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
      const cat = s.category ?? s.serviceType ?? "service";
      return `• ${s.name} [${cat}] — ${price}${blurb ? ` — ${blurb}` : ""}`;
    });

    const summary = lines.join("\n");
    catalogCache = { summary, expires: now + CATALOG_TTL_MS };
    return { identity: PUBLIC_VISITOR_IDENTITY, summary };
  } catch (err) {
    log.error({ err }, "shanebot-engine: failed to build live_catalog grounding; using fallback");
    return { identity: PUBLIC_VISITOR_IDENTITY, summary: FALLBACK_CATALOG_SUMMARY };
  }
}

// ── customer_entitlements builder (ShaneBot Paid) ─────────────────────────────
// The authenticated customer's own real platform data — what they pay for and what
// their tenant looks like right now. Branches the same way the portal support chat
// always has: a CustomerUser is grounded in their own tenant; MSP staff in their
// MSP's book of customers + recent signals.

function relativeDate(d: Date): string {
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays} days ago`;
  return d.toISOString().slice(0, 10);
}

async function buildCustomerEntitlementsGrounding(
  ctx: CustomerEntitlementsContext,
): Promise<BotGrounding> {
  if (ctx.isCustomerUser && ctx.customerId) {
    return buildCustomerContext(ctx.customerId, ctx.mspId);
  }
  if (ctx.mspId) {
    return buildMspContext(ctx.mspId);
  }
  // Non-admin user with no resolvable MSP context (e.g. a malformed/legacy account).
  return { identity: "platform user", summary: "Platform data temporarily unavailable." };
}

async function buildMspContext(mspId: number): Promise<BotGrounding> {
  const since7d = new Date(Date.now() - 7 * 86_400_000);

  const [mspRow, customerStats, signalRows] = await Promise.all([
    db.select({ name: mspsTable.name, status: mspsTable.status, slug: mspsTable.slug })
      .from(mspsTable).where(eq(mspsTable.id, mspId)).limit(1),

    db.select({ status: tenantsTable.status, n: count() })
      .from(tenantsTable)
      .where(eq(tenantsTable.mspId, mspId))
      .groupBy(tenantsTable.status),

    db.select({
      eventType: mspEventStoreTable.eventType,
      payload: mspEventStoreTable.payload,
      occurredAt: mspEventStoreTable.occurredAt,
    })
      .from(mspEventStoreTable)
      .where(
        and(
          eq(mspEventStoreTable.mspId, mspId),
          like(mspEventStoreTable.eventType, "signal.%"),
          gte(mspEventStoreTable.occurredAt, since7d),
        ),
      )
      .orderBy(desc(mspEventStoreTable.occurredAt))
      .limit(10),
  ]);

  const msp = mspRow[0];
  if (!msp) return { identity: "MSP user", summary: "No MSP data found." };

  const customerSummary = customerStats.map((r) => `${r.n} ${r.status}`).join(", ") || "no customers yet";

  const recentSignals = signalRows.length === 0
    ? "No signals fired in the last 7 days."
    : signalRows.map((s) => {
        const label = s.eventType.replace("signal.", "");
        const ts = relativeDate(new Date(s.occurredAt));
        const p = s.payload as Record<string, unknown> | null;
        const customer = p?.customerName ?? p?.customerId ?? "unknown customer";
        return `• ${label} — ${customer} (${ts})`;
      }).join("\n");

  return {
    identity: `MSP operator for ${msp.name}`,
    summary: `MSP: ${msp.name} (slug: ${msp.slug}, status: ${msp.status})\nCustomer breakdown: ${customerSummary}\n\nRecent signals (last 7 days):\n${recentSignals}`,
  };
}

// Every child query below is scoped by BOTH customerId (tenants.id — the
// primary tenant boundary) AND, when resolvable, mspId as defense-in-depth —
// the same double-scoping pattern msp-sow.ts/msp-sales-bundles.ts already use.
// A customerId uniquely identifies one tenant, so this can never leak another
// customer's purchases, entitlements, or scan data into the prompt.

function formatPurchases(rows: Array<{
  title: string;
  status: string;
  amountCents: number;
  signedAt: Date | null;
  chargeConfirmedAt: Date | null;
}>): string {
  if (rows.length === 0) return "No purchases yet.";
  return rows.map((r) => {
    const amount = `$${Math.round(r.amountCents / 100).toLocaleString("en-US")}`;
    const dateLabel = r.chargeConfirmedAt
      ? `paid ${relativeDate(new Date(r.chargeConfirmedAt))}`
      : r.signedAt
        ? `signed ${relativeDate(new Date(r.signedAt))}`
        : "not yet signed";
    return `• ${r.title} — ${r.status} (${amount}, ${dateLabel})`;
  }).join("\n");
}

function formatEntitlements(rows: Array<{
  name: string;
  status: string;
  activatedAt: Date | null;
  trialExpiresAt: Date | null;
}>): string {
  if (rows.length === 0) return "No active subscriptions or monitoring bundles.";
  return rows.map((r) => {
    const activated = r.activatedAt ? `activated ${relativeDate(new Date(r.activatedAt))}` : "not yet activated";
    const trial = r.trialExpiresAt ? `, trial expires ${relativeDate(new Date(r.trialExpiresAt))}` : "";
    return `• ${r.name} — ${r.status} (${activated}${trial})`;
  }).join("\n");
}

function formatScanStatus(
  latestRun: { packageKey: string; status: string; startedAt: Date | null } | undefined,
  lastCompleted: { completedAt: Date | null; checksTotal: number; checksOk: number; checksError: number } | undefined,
  findings: Array<{ severity: string; title: string }>,
): string {
  if (!latestRun) return "No scans have been run yet.";
  const lines = [
    `Latest scan: ${latestRun.packageKey} — ${latestRun.status}${latestRun.startedAt ? ` (started ${relativeDate(new Date(latestRun.startedAt))})` : ""}`,
  ];
  if (lastCompleted) {
    lines.push(
      `Last completed scan: ${lastCompleted.completedAt ? relativeDate(new Date(lastCompleted.completedAt)) : "unknown date"} — ${lastCompleted.checksOk}/${lastCompleted.checksTotal} checks OK, ${lastCompleted.checksError} error(s)`,
    );
    lines.push(
      findings.length === 0
        ? "No open critical/warning findings."
        : `Open findings:\n${findings.map((f) => `  • [${f.severity}] ${f.title}`).join("\n")}`,
    );
  } else {
    lines.push("No completed scan yet.");
  }
  return lines.join("\n");
}

async function buildCustomerContext(customerId: number, mspId: number | null): Promise<BotGrounding> {
  const since30d = new Date(Date.now() - 30 * 86_400_000);

  const sowConditions = [eq(mspSowsTable.customerId, customerId)];
  const bundleConditions = [eq(mspSalesBundleAssignmentsTable.customerId, customerId)];
  const runConditions = [eq(mspDiagnosticRunsTable.customerId, customerId)];
  if (mspId) {
    sowConditions.push(eq(mspSowsTable.mspId, mspId));
    bundleConditions.push(eq(mspSalesBundleAssignmentsTable.mspId, mspId));
    runConditions.push(eq(mspDiagnosticRunsTable.mspId, mspId));
  }

  const [customerRow, signalRows, sowRows, bundleRows, latestRunRows, lastCompletedRows] = await Promise.all([
    db.select({
      name: tenantsTable.customerName,
      domain: tenantsTable.domain,
      status: tenantsTable.status,
      tenantId: tenantsTable.tenantId,
    })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, customerId))
      .limit(1),

    mspId
      ? db.select({
          eventType: mspEventStoreTable.eventType,
          occurredAt: mspEventStoreTable.occurredAt,
        })
          .from(mspEventStoreTable)
          .where(
            and(
              eq(mspEventStoreTable.mspId, mspId),
              eq(mspEventStoreTable.customerId, customerId),
              like(mspEventStoreTable.eventType, "signal.%"),
              gte(mspEventStoreTable.occurredAt, since30d),
            ),
          )
          .orderBy(desc(mspEventStoreTable.occurredAt))
          .limit(5)
      : Promise.resolve([]),

    // What the customer has actually purchased — signed/paid/pending SOWs.
    db.select({
      title: mspSowsTable.title,
      status: mspSowsTable.status,
      amountCents: mspSowsTable.amountCents,
      signedAt: mspSowsTable.signedAt,
      chargeConfirmedAt: mspSowsTable.chargeConfirmedAt,
    })
      .from(mspSowsTable)
      .where(and(...sowConditions))
      .orderBy(desc(mspSowsTable.createdAt))
      .limit(10),

    // Subscription/billing status — active monitoring-bundle assignments.
    db.select({
      name: mspSalesBundlesTable.name,
      status: mspSalesBundleAssignmentsTable.status,
      activatedAt: mspSalesBundleAssignmentsTable.activatedAt,
      trialExpiresAt: mspSalesBundleAssignmentsTable.trialExpiresAt,
    })
      .from(mspSalesBundleAssignmentsTable)
      .innerJoin(mspSalesBundlesTable, eq(mspSalesBundlesTable.bundleId, mspSalesBundleAssignmentsTable.bundleId))
      .where(and(...bundleConditions))
      .orderBy(desc(mspSalesBundleAssignmentsTable.assignedAt))
      .limit(10),

    // Scan/monitoring state — the most recent run regardless of status.
    db.select({
      runId: mspDiagnosticRunsTable.runId,
      packageKey: mspDiagnosticRunsTable.packageKey,
      status: mspDiagnosticRunsTable.status,
      startedAt: mspDiagnosticRunsTable.startedAt,
    })
      .from(mspDiagnosticRunsTable)
      .where(and(...runConditions))
      .orderBy(desc(mspDiagnosticRunsTable.createdAt))
      .limit(1),

    // The most recent run that actually finished, for a checks/findings summary.
    db.select({
      runId: mspDiagnosticRunsTable.runId,
      completedAt: mspDiagnosticRunsTable.completedAt,
      checksTotal: mspDiagnosticRunsTable.checksTotal,
      checksOk: mspDiagnosticRunsTable.checksOk,
      checksError: mspDiagnosticRunsTable.checksError,
    })
      .from(mspDiagnosticRunsTable)
      .where(and(...runConditions, inArray(mspDiagnosticRunsTable.status, ["completed", "partial"])))
      .orderBy(desc(mspDiagnosticRunsTable.createdAt))
      .limit(1),
  ]);

  const customer = customerRow[0];
  if (!customer) return { identity: "customer user", summary: "No customer data found." };

  const lastCompleted = lastCompletedRows[0];
  const findingRows = lastCompleted
    ? await db.select({
        severity: mspDiagnosticFindingsTable.severity,
        title: mspDiagnosticFindingsTable.title,
      })
        .from(mspDiagnosticFindingsTable)
        .where(
          and(
            eq(mspDiagnosticFindingsTable.runId, lastCompleted.runId),
            inArray(mspDiagnosticFindingsTable.severity, ["critical", "warning"]),
          ),
        )
        .orderBy(desc(mspDiagnosticFindingsTable.createdAt))
        .limit(10)
    : [];

  const signalSummary = signalRows.length === 0
    ? "No signals fired in the last 30 days."
    : signalRows.map((s) => `• ${s.eventType.replace("signal.", "")} (${relativeDate(new Date(s.occurredAt))})`).join("\n");

  return {
    identity: `customer user for ${customer.name}`,
    summary: `Customer: ${customer.name} (domain: ${customer.domain ?? "n/a"}, status: ${customer.status})
Tenant ID: ${customer.tenantId ?? "not set"}

Purchases:
${formatPurchases(sowRows)}

Subscriptions / monitoring bundles:
${formatEntitlements(bundleRows)}

Scan / monitoring status:
${formatScanStatus(latestRunRows[0], lastCompleted, findingRows)}

Recent signals (last 30 days):
${signalSummary}`,
  };
}

// ── Conversation storage (#361) ───────────────────────────────────────────────
// The shared transcript store both surfaces now target, replacing the earlier
// plan to bolt structured storage onto each route's own message table
// independently (public-chat.ts's public_chat_conversations, and whatever
// support-chat.ts would otherwise have needed to grow). Route-owned business
// metadata (public-chat's review queue: needsReview, contact capture, etc.)
// stays exactly where it lives — this only carries the transcript itself, in
// the same content-block shape (chat-content-blocks.ts) both routes already
// produce.

const instanceDbIdCache = new Map<BotSlug, number>();

/**
 * Resolve an instance's real bot_instances.id, for the bot_conversations FK.
 * Cached in-process — the two rows are static once seeded. Throws (rather than
 * silently no-op-ing) when the row isn't there yet, e.g. #1097's manual
 * migration hasn't been run — callers already wrap conversation persistence in
 * their own try/catch (a storage failure must never break the reply).
 */
async function resolveInstanceDbId(slug: BotSlug): Promise<number> {
  const cached = instanceDbIdCache.get(slug);
  if (cached != null) return cached;

  const [row] = await db
    .select({ id: botInstancesTable.id })
    .from(botInstancesTable)
    .where(eq(botInstancesTable.slug, slug))
    .limit(1);
  if (!row) {
    throw new Error(
      `shanebot-engine: no bot_instances row for slug "${slug}" — has #1097's manual migration been run?`,
    );
  }
  instanceDbIdCache.set(slug, row.id);
  return row.id;
}

/** Upsert a session's full transcript into bot_conversations, keyed by sessionId. */
export async function upsertBotConversation(opts: {
  slug: BotSlug;
  sessionId: string;
  transcript: BotConversationMessage[];
}): Promise<void> {
  const instanceId = await resolveInstanceDbId(opts.slug);
  const messageCount = opts.transcript.length;
  await db
    .insert(botConversationsTable)
    .values({
      instanceId,
      sessionId: opts.sessionId,
      transcript: opts.transcript,
      messageCount,
    })
    .onConflictDoUpdate({
      target: botConversationsTable.sessionId,
      set: { transcript: opts.transcript, messageCount, updatedAt: new Date() },
    });
}

/**
 * Read a session's transcript back out of bot_conversations, if it has one.
 * Read paths (the admin queue) degrade to "no transcript" rather than throw —
 * e.g. #1097's migration not run yet must not 500 the whole review queue, only
 * leave it showing metadata with no preview/transcript.
 */
export async function getBotConversationTranscript(sessionId: string): Promise<BotConversationMessage[] | null> {
  try {
    const [row] = await db
      .select({ transcript: botConversationsTable.transcript })
      .from(botConversationsTable)
      .where(eq(botConversationsTable.sessionId, sessionId))
      .limit(1);
    return row?.transcript ?? null;
  } catch (err) {
    log.error({ err, sessionId }, "shanebot-engine: failed to read bot_conversations transcript");
    return null;
  }
}

/**
 * Batch-read transcripts for a page of sessions (the admin queue's list view) —
 * one query rather than one per row. Same degrade-to-empty behavior as the
 * single-session read above.
 */
export async function getBotConversationTranscripts(
  sessionIds: string[],
): Promise<Map<string, BotConversationMessage[]>> {
  const map = new Map<string, BotConversationMessage[]>();
  if (sessionIds.length === 0) return map;

  try {
    const rows = await db
      .select({ sessionId: botConversationsTable.sessionId, transcript: botConversationsTable.transcript })
      .from(botConversationsTable)
      .where(inArray(botConversationsTable.sessionId, sessionIds))
      .limit(sessionIds.length);
    for (const row of rows) map.set(row.sessionId, row.transcript);
  } catch (err) {
    log.error({ err }, "shanebot-engine: failed to batch-read bot_conversations transcripts");
  }
  return map;
}

// ── System-prompt assembly ────────────────────────────────────────────────────

/**
 * Stitch the shared skeleton of a system prompt: the persona voice, an identity
 * line, a route-supplied `body` (its grounding contract + grounded data + any
 * capability rules), and the shared suggested-replies control-token instruction.
 *
 * Route-specific SAFETY sections are passed in via `body` by the caller — this
 * function neither owns nor reorders them. Used by the paid surface; the public
 * surface keeps its own safety-ordered assembly (the personal-topic HARD BOUNDARY
 * must stay tightly positioned) and calls into the engine for grounding instead.
 */
export function assembleSystemPrompt(opts: {
  instance: BotInstanceConfig;
  identity: string;
  body: string;
}): string {
  return `${resolvePersonaPrompt(opts.instance)}

You are talking to a ${opts.identity}.

${opts.body}

${SUGGESTED_REPLIES_INSTRUCTION}`;
}

// ── action_router ─────────────────────────────────────────────────────────────
// The model requests an action by emitting a control token on its own line:
//   [ACTION:regenerate_document]   [ACTION:rerun_scan]
// The router parses these, then gates EACH against the emitting instance's
// allowedActions before anything can fire. A public instance ([]) authorizes none;
// a hallucinated/unknown action name authorizes as false. The actual action
// handlers (regenerate a document, rerun a scan) are a later build — this router is
// the authorization gate they plug into, so an unauthorized token can never reach
// a handler. Same "propose, never silently act" spirit as support-chat's existing
// remediation-proposal marker: parsing + gating here does not itself run anything.

const ACTION_TOKEN_RE_GLOBAL = /\[ACTION:\s*([a-z_]+)\s*\]/gi;

export interface RoutedAction {
  /** The action name the model requested (lowercased). */
  action: string;
  /** True only if this instance's allowedActions permits it. */
  authorized: boolean;
}

/** Every distinct action the model asked for, in first-seen order. */
export function parseRequestedActions(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(ACTION_TOKEN_RE_GLOBAL.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text ?? "")) !== null) {
    const action = m[1].toLowerCase();
    if (!seen.has(action)) {
      seen.add(action);
      out.push(action);
    }
  }
  return out;
}

/** Gate parsed action requests against the instance's allowedActions. */
export function routeActions(instance: BotInstanceConfig, requested: string[]): RoutedAction[] {
  const allowed = new Set<string>(instance.allowedActions);
  return requested.map((action) => {
    const authorized = allowed.has(action);
    if (!authorized) {
      log.warn(
        { instance: instance.slug, action, allowedActions: instance.allowedActions },
        "shanebot-engine: action request denied — not in this instance's allowedActions",
      );
    }
    return { action, authorized };
  });
}

/** Parse + gate in one call. */
export function routeRequestedActions(instance: BotInstanceConfig, text: string): RoutedAction[] {
  return routeActions(instance, parseRequestedActions(text));
}

/** Remove every [ACTION:x] token from a reply before the user sees it. */
export function stripActionTokens(text: string): string {
  return (text ?? "").replace(new RegExp(ACTION_TOKEN_RE_GLOBAL.source, "gi"), "").trim();
}
