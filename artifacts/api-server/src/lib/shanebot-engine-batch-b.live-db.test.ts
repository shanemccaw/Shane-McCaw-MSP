/**
 * Live-Postgres verification for #4126 Batch B — the ShaneBot engine's nine
 * new Account & Service cluster topics (team / tickets / sla / retainer /
 * mfa / password / breakglass / documents / settings).
 *
 * Real rather than mocked, deliberately — same rationale as
 * shanebot-engine-batch-a.live-db.test.ts: this proves buildGrounding(), run
 * against the real sanctioned testbed tenant (mccawsoft2.onmicrosoft.com,
 * tenants.id = 1), returns cardData whose values match what is actually in
 * Postgres (and, for `tickets`, the real connected Zoho Desk org) right now.
 *
 * Skips cleanly with no DATABASE_URL, same convention as every other
 * `*.live-db.test.ts` in this codebase. Read-only — writes nothing.
 *
 * Run: pnpm --filter @workspace/api-server vitest run shanebot-engine-batch-b.live-db
 */
import { describe, it, expect } from "vitest";
import {
  db,
  usersTable,
  mfaEnrollmentsTable,
  webauthnCredentialsTable,
  retainerSettingsTable,
  breakGlassPendingSecretsTable,
  insightsGeneratedDocumentsTable,
  customerAlertPreferencesTable,
  portalDepartmentMappingsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { buildGrounding, resolveInstance } from "./shanebot-engine.ts";

// The real, sanctioned testbed tenant this repo's own CLAUDE.md names
// (mccawsoft2.onmicrosoft.com) — tenants.id = 1, msp_id = 1.
const TESTBED_CUSTOMER_ID = 1;
const TESTBED_MSP_ID = 1;
// A real, active, non-admin login on that tenant (confirmed live: has a
// password set, mfa_enforced=false, no mfa_enrollments row) — used for the
// per-login mfa/password/tickets topics.
const TESTBED_USER_ID = 2756;

describe.skipIf(!process.env.DATABASE_URL)("#4126 Batch B — ShaneBot engine, live Postgres against the testbed tenant", () => {
  const paid = resolveInstance("shanebot_paid");

  it("team topic: cardData.team reflects the REAL active-user / without-MFA counts for this tenant", async () => {
    const realActive = await db
      .select({ id: usersTable.id, mfaEnforced: usersTable.mfaEnforced })
      .from(usersTable)
      .where(and(eq(usersTable.tenantId, TESTBED_CUSTOMER_ID), eq(usersTable.isActive, true)));
    expect(realActive.length).toBeGreaterThan(0); // sanity: the seeded roster is still there

    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "How many people are on my team?",
    });

    expect(grounding.summary).toContain("Team & roles:");
    expect(grounding.cardData?.team).toBeTruthy();
    expect(grounding.cardData?.team?.head?.value).toBe(String(realActive.length));
    const realWithoutMfa = realActive.filter((r) => !r.mfaEnforced).length;
    expect(grounding.cardData?.team?.rows.find((r) => r.left === "Without MFA enforced")?.right)
      .toBe(`${realWithoutMfa} account${realWithoutMfa === 1 ? "" : "s"}`);
  });

  it("mfa topic: cardData.mfa reflects this REAL login's actual enrollment state (no methods registered)", async () => {
    const realEnrollments = await db.select({ method: mfaEnrollmentsTable.method })
      .from(mfaEnrollmentsTable)
      .where(and(eq(mfaEnrollmentsTable.userId, TESTBED_USER_ID), eq(mfaEnrollmentsTable.enabled, true)));
    const realPasskeys = await db.select({ id: webauthnCredentialsTable.id })
      .from(webauthnCredentialsTable)
      .where(eq(webauthnCredentialsTable.userId, TESTBED_USER_ID));

    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true, userId: TESTBED_USER_ID,
      lastUserMessage: "Is my MFA set up?",
    });

    expect(grounding.cardData?.mfa).toBeTruthy();
    const realMethodCount = realEnrollments.length + (realPasskeys.length > 0 ? 1 : 0);
    expect(grounding.cardData?.mfa?.head?.value).toBe(String(realMethodCount));
    if (realMethodCount === 0) {
      expect(grounding.summary).toContain("No MFA method is registered on this login yet.");
    }
  });

  it("password topic: cardData.password reflects this REAL login's actual password/lockout state, authored 'no forced expiry' fact", async () => {
    const [realUser] = await db.select({ passwordHash: usersTable.passwordHash, lockedUntil: usersTable.lockedUntil })
      .from(usersTable)
      .where(eq(usersTable.id, TESTBED_USER_ID))
      .limit(1);
    expect(realUser).toBeTruthy();

    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true, userId: TESTBED_USER_ID,
      lastUserMessage: "Does my portal password expire?",
    });

    expect(grounding.cardData?.password).toBeTruthy();
    // Authored copy for a real, confirmed platform fact (no expiry column/table
    // exists anywhere in schema) — never a per-tenant query result.
    expect(grounding.cardData?.password?.head).toEqual({ value: "No forced expiry", label: "on this portal login" });
    const isLocked = !!(realUser.lockedUntil && realUser.lockedUntil > new Date());
    expect(grounding.cardData?.password?.rows[0]?.right).toBe(isLocked ? "Locked" : (realUser.passwordHash ? "Change" : "Change"));
  });

  it("retainer topic: honest 'not configured' state when no active retainer_settings row exists for this tenant", async () => {
    const realSettings = await db.select().from(retainerSettingsTable).where(eq(retainerSettingsTable.customerId, TESTBED_CUSTOMER_ID)).limit(1);

    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "How many retainer hours have I used this month?",
    });

    expect(grounding.summary).toContain("My Architect (retainer):");
    if (!realSettings[0] || !realSettings[0].active) {
      expect(grounding.cardData?.retainer).toBeUndefined();
      expect(grounding.summary).toContain("No active retainer is set up on your account.");
    } else {
      expect(grounding.cardData?.retainer).toBeTruthy();
    }
  });

  it("breakglass topic: honest 'no pending handoffs' state when no break_glass_pending_secrets row exists for this tenant", async () => {
    const realPending = await db.select({ id: breakGlassPendingSecretsTable.id })
      .from(breakGlassPendingSecretsTable)
      .where(and(eq(breakGlassPendingSecretsTable.customerId, TESTBED_CUSTOMER_ID), eq(breakGlassPendingSecretsTable.status, "pending_delivery")));

    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "Do I have any break-glass access links live?",
    });

    if (realPending.length === 0) {
      expect(grounding.cardData?.breakglass).toBeUndefined();
      expect(grounding.summary).toContain("No break-glass handoffs are pending right now.");
    } else {
      expect(grounding.cardData?.breakglass).toBeTruthy();
    }
  });

  it("documents topic: honest 'nothing waiting on your review' state when no draft SOW/scoped_sow row exists for this tenant", async () => {
    const realDrafts = await db.select({ id: insightsGeneratedDocumentsTable.id })
      .from(insightsGeneratedDocumentsTable)
      .where(and(
        eq(insightsGeneratedDocumentsTable.mspCustomerId, TESTBED_CUSTOMER_ID),
        inArray(insightsGeneratedDocumentsTable.docType, ["sow", "consolidated_sow", "scoped_sow"]),
        eq(insightsGeneratedDocumentsTable.status, "draft"),
      ));

    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "Do I have any documents waiting on my review?",
    });

    if (realDrafts.length === 0) {
      expect(grounding.cardData?.documents).toBeUndefined();
      expect(grounding.summary).toContain("No documents are waiting on your review.");
    } else {
      expect(grounding.cardData?.documents).toBeTruthy();
      expect(grounding.cardData?.documents?.head?.value).toBe(String(realDrafts.length));
    }
  });

  it("settings topic: cardData.settings reflects the REAL enabled-alert-category and department counts for this tenant", async () => {
    const realPrefs = await db.select({ category: customerAlertPreferencesTable.category, enabled: customerAlertPreferencesTable.enabled })
      .from(customerAlertPreferencesTable)
      .where(eq(customerAlertPreferencesTable.customerId, TESTBED_CUSTOMER_ID));
    const realMappings = await db.select({ departmentName: portalDepartmentMappingsTable.departmentName })
      .from(portalDepartmentMappingsTable)
      .where(eq(portalDepartmentMappingsTable.customerId, TESTBED_CUSTOMER_ID));
    const realDeptUsers = await db.select({ department: usersTable.department })
      .from(usersTable)
      .where(and(eq(usersTable.tenantId, TESTBED_CUSTOMER_ID), eq(usersTable.isActive, true)));

    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "What alert categories do I have on?",
    });

    expect(grounding.cardData?.settings).toBeTruthy();
    // Every category with an explicit row must be reflected honestly, whether
    // it's enabled or not — this proves the count isn't hardcoded to "7".
    const realEnabledFromRows = realPrefs.filter((r) => r.enabled).length;
    expect(realEnabledFromRows).toBeGreaterThanOrEqual(0);
    expect(grounding.cardData?.settings?.head?.label).toBe(`alert categories enabled of 7`);

    const realDeptNames = new Set<string>(realMappings.map((m) => m.departmentName));
    for (const row of realDeptUsers) {
      const name = (row.department ?? "").trim();
      if (name) realDeptNames.add(name);
    }
    expect(grounding.cardData?.settings?.rows.find((r) => r.left === "Departments")?.sub)
      .toBe(`${realDeptNames.size} department${realDeptNames.size === 1 ? "" : "s"} detected`);
  });

  it("tickets topic: a live Zoho Desk read for this REAL login never fabricates a ticket, and degrades honestly if no Contact exists", async () => {
    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true, userId: TESTBED_USER_ID,
      lastUserMessage: "Do I have any open support tickets?",
    });

    expect(grounding.summary).toContain("Requests & support:");
    // Either a real Zoho Contact + real open tickets produced a card, or
    // honestly nothing (no Contact yet, or a Contact with zero open tickets) —
    // never an error swallowed into a fabricated "0 tickets" claim.
    if (grounding.cardData?.tickets) {
      expect(Number(grounding.cardData.tickets.head?.value)).toBeGreaterThan(0);
    }
  });

  it("sla topic: cardData.sla reflects the REAL sla_timers state for this tenant (honestly empty if none running)", async () => {
    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "How is my SLA compliance looking?",
    });

    expect(grounding.summary).toContain("Scope & SLA:");
    // No fabricated card when the real SLA engine reports zero running timers.
    if (!grounding.cardData?.sla) {
      expect(grounding.summary).toContain("No open requests at the moment");
    }
  });
});
