/**
 * purchase-account-flow.test.ts — Git #1310 (Phase 1 of Epic #1309).
 *
 * Integration tests for the generalized inline account-creation core, run
 * against the REAL local Postgres (the same DATABASE_URL the dev api-server
 * uses), because every security property under test here lives in the
 * interplay between the code and the rows it stores: the paid/unexpired
 * session gate, hash-at-rest, resend-supersedes, the count-before-judge
 * attempt budget, verified-address-must-still-match, provision-if-missing,
 * and never-overwrite-an-existing-password.
 *
 * All rows are created under a unique per-run marker and deleted in afterAll;
 * checkout_email_verifications cascades off its session row.
 */

import { describe, it, expect, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "crypto";
import {
  db,
  checkoutSessionsTable,
  checkoutEmailVerificationsTable,
  usersTable,
  leadStagingTable,
  mspJobQueueTable,
  tenantsTable,
} from "@workspace/db";
import { desc, eq, inArray, like, sql } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";
import { resolveProspectRole, provisionProspectAccount } from "./direct-tenant-provisioning.ts";
import {
  resolvePaidPurchaseSession,
  issueVerificationCode,
  checkVerificationCode,
  getVerifiedEmail,
  attachPasswordToAccount,
  resolvePortalHandoffUser,
  resolveProductCategory,
  generateSixDigitCode,
  maskEmail,
  MAX_CODE_ATTEMPTS,
} from "./purchase-account-flow.ts";

const RUN_TAG = randomBytes(4).toString("hex");
const createdSessionIds: string[] = [];
const createdEmails: string[] = [];
const createdTenantIds: number[] = [];

function testEmail(label: string): string {
  const email = `test-1310-${RUN_TAG}-${label}@purchase-flow-test.invalid`;
  createdEmails.push(email);
  return email;
}

async function createSession(overrides: Partial<typeof checkoutSessionsTable.$inferInsert> = {}) {
  const [row] = await db
    .insert(checkoutSessionsTable)
    .values({
      productSlug: "retainer-focus",
      fullName: "Test Buyer 1310",
      email: overrides.email ?? testEmail("buyer"),
      status: "paid",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    })
    .returning({ id: checkoutSessionsTable.id });
  createdSessionIds.push(row.id);
  return row.id;
}

async function resolveOrThrow(sessionId: string) {
  const resolved = await resolvePaidPurchaseSession(sessionId);
  if (!resolved.ok) throw new Error(`expected paid session, got ${resolved.error}`);
  return resolved.session;
}

afterAll(async () => {
  if (createdSessionIds.length > 0) {
    await db.delete(checkoutSessionsTable).where(inArray(checkoutSessionsTable.id, createdSessionIds));
  }
  if (createdEmails.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.email, createdEmails));
  }
  // tenants after users — users.tenant_id references tenants ON DELETE RESTRICT.
  if (createdTenantIds.length > 0) {
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, createdTenantIds));
  }
  // The REAL provisioning path stages a lead + a queued Zoho upsert job for the
  // buyer — right in production, garbage here. Sweep both so no fake lead for a
  // .invalid address ever drains into Zoho CRM.
  await db.delete(leadStagingTable).where(like(leadStagingTable.email, "%purchase-flow-test.invalid"));
  await db
    .delete(mspJobQueueTable)
    .where(sql`${mspJobQueueTable.payload}::text LIKE '%purchase-flow-test.invalid%'`);
});

describe("resolvePaidPurchaseSession — the ordering gate", () => {
  it("rejects a non-UUID outright", async () => {
    const r = await resolvePaidPurchaseSession("not-a-uuid");
    expect(r).toEqual({ ok: false, status: 400, error: "session_invalid" });
  });

  it("rejects a UUID with no session behind it", async () => {
    const r = await resolvePaidPurchaseSession("00000000-0000-4000-8000-000000000000");
    expect(r).toEqual({ ok: false, status: 404, error: "session_expired" });
  });

  it("rejects an expired session even when paid", async () => {
    const id = await createSession({ expiresAt: new Date(Date.now() - 1000) });
    const r = await resolvePaidPurchaseSession(id);
    expect(r).toEqual({ ok: false, status: 404, error: "session_expired" });
  });

  it("rejects an unpaid session — the client's stage machine is not the authority", async () => {
    for (const status of ["pending", "consented"] as const) {
      const id = await createSession({ status });
      const r = await resolvePaidPurchaseSession(id);
      expect(r).toEqual({ ok: false, status: 409, error: "payment_required" });
    }
  });

  it("resolves a paid session of ANY product slug with its provisioning fields", async () => {
    const email = testEmail("resolve");
    const id = await createSession({
      email,
      productSlug: "monitoring-enhanced",
      company: "Contoso Ltd",
      industry: "Manufacturing",
      tenantId: null,
    });
    const r = await resolvePaidPurchaseSession(id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.session).toMatchObject({
        id,
        productSlug: "monitoring-enhanced",
        email,
        fullName: "Test Buyer 1310",
        company: "Contoso Ltd",
        industry: "Manufacturing",
        tenantId: null,
      });
    }
  });
});

describe("issueVerificationCode — hash at rest, resend supersedes", () => {
  it("stores only the bcrypt hash, never the six digits", async () => {
    const session = await resolveOrThrow(await createSession());
    const { code, expiresAt } = await issueVerificationCode(session);

    expect(code).toMatch(/^\d{6}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const [row] = await db
      .select()
      .from(checkoutEmailVerificationsTable)
      .where(eq(checkoutEmailVerificationsTable.sessionId, session.id));
    expect(row.codeHash).not.toContain(code);
    expect(await bcrypt.compare(code, row.codeHash)).toBe(true);
    expect(row.attempts).toBe(0);
    expect(row.verifiedAt).toBeNull();
  });

  it("a resend destroys the previous unverified code — only the newest is live", async () => {
    const session = await resolveOrThrow(await createSession());
    const first = await issueVerificationCode(session);
    const second = await issueVerificationCode(session);

    const rows = await db
      .select()
      .from(checkoutEmailVerificationsTable)
      .where(eq(checkoutEmailVerificationsTable.sessionId, session.id));
    expect(rows).toHaveLength(1);

    if (first.code !== second.code) {
      const stale = await checkVerificationCode(session.id, first.code);
      expect(stale.outcome).toBe("code_incorrect");
    }
    const fresh = await checkVerificationCode(session.id, second.code);
    expect(fresh.outcome).toBe("verified");
  });

  it("a resend leaves an already-verified row alone, so proof survives", async () => {
    const session = await resolveOrThrow(await createSession());
    const { code } = await issueVerificationCode(session);
    expect((await checkVerificationCode(session.id, code)).outcome).toBe("verified");

    await issueVerificationCode(session);

    const rows = await db
      .select()
      .from(checkoutEmailVerificationsTable)
      .where(eq(checkoutEmailVerificationsTable.sessionId, session.id));
    expect(rows).toHaveLength(2);
    expect(await getVerifiedEmail(session)).toBe(session.email.toLowerCase());
  });
});

describe("checkVerificationCode — the attempt budget", () => {
  it("no code issued yet", async () => {
    const session = await resolveOrThrow(await createSession());
    expect((await checkVerificationCode(session.id, "123456")).outcome).toBe("no_code_issued");
  });

  it("a wrong guess burns budget; the right code still verifies within it", async () => {
    const session = await resolveOrThrow(await createSession());
    const { code } = await issueVerificationCode(session);
    const wrong = code === "000000" ? "000001" : "000000";

    const miss = await checkVerificationCode(session.id, wrong);
    expect(miss).toEqual({ outcome: "code_incorrect", attemptsRemaining: MAX_CODE_ATTEMPTS - 1 });

    const hit = await checkVerificationCode(session.id, code);
    expect(hit).toEqual({ outcome: "verified", attempts: 2 });
  });

  it("exhausting the budget locks the code out — even for the RIGHT digits afterwards", async () => {
    const session = await resolveOrThrow(await createSession());
    const { code } = await issueVerificationCode(session);
    const wrong = code === "000000" ? "000001" : "000000";

    for (let i = 1; i <= MAX_CODE_ATTEMPTS; i++) {
      const r = await checkVerificationCode(session.id, wrong);
      expect(r).toEqual({ outcome: "code_incorrect", attemptsRemaining: MAX_CODE_ATTEMPTS - i });
    }
    expect((await checkVerificationCode(session.id, code)).outcome).toBe("too_many_attempts");
  });

  it("attempts are counted BEFORE the guess is judged", async () => {
    const session = await resolveOrThrow(await createSession());
    const { code } = await issueVerificationCode(session);
    const wrong = code === "000000" ? "000001" : "000000";
    await checkVerificationCode(session.id, wrong);

    const [row] = await db
      .select({ attempts: checkoutEmailVerificationsTable.attempts })
      .from(checkoutEmailVerificationsTable)
      .where(eq(checkoutEmailVerificationsTable.sessionId, session.id))
      .orderBy(desc(checkoutEmailVerificationsTable.id))
      .limit(1);
    expect(row.attempts).toBe(1);
  });

  it("an expired code is dead regardless of budget", async () => {
    const session = await resolveOrThrow(await createSession());
    const { code } = await issueVerificationCode(session);
    await db
      .update(checkoutEmailVerificationsTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(checkoutEmailVerificationsTable.sessionId, session.id));
    expect((await checkVerificationCode(session.id, code)).outcome).toBe("code_expired");
  });

  it("replaying against an already-verified code is a no-op, not a failure", async () => {
    const session = await resolveOrThrow(await createSession());
    const { code } = await issueVerificationCode(session);
    await checkVerificationCode(session.id, code);
    expect((await checkVerificationCode(session.id, code)).outcome).toBe("already_verified");
  });
});

describe("getVerifiedEmail — proof is pinned to the session's own address", () => {
  it("null before any verification", async () => {
    const session = await resolveOrThrow(await createSession());
    expect(await getVerifiedEmail(session)).toBeNull();
    await issueVerificationCode(session);
    expect(await getVerifiedEmail(session)).toBeNull();
  });

  it("REFUSES when the session's email changed after the code was proven", async () => {
    const session = await resolveOrThrow(await createSession());
    const { code } = await issueVerificationCode(session);
    await checkVerificationCode(session.id, code);
    expect(await getVerifiedEmail(session)).toBe(session.email.toLowerCase());

    const hijacked = testEmail("hijack");
    await db
      .update(checkoutSessionsTable)
      .set({ email: hijacked })
      .where(eq(checkoutSessionsTable.id, session.id));
    const reread = await resolveOrThrow(session.id);
    expect(await getVerifiedEmail(reread)).toBeNull();
  });
});

describe("attachPasswordToAccount", () => {
  it("refuses without a verified mailbox", async () => {
    const session = await resolveOrThrow(await createSession());
    const r = await attachPasswordToAccount(session, "correct horse battery", { provisionIfMissing: true });
    expect(r).toEqual({ outcome: "email_not_verified" });
  });

  it("assessment semantics: a missing account is a defect, not a provisioning trigger", async () => {
    const session = await resolveOrThrow(await createSession());
    const { code } = await issueVerificationCode(session);
    await checkVerificationCode(session.id, code);

    const r = await attachPasswordToAccount(session, "correct horse battery", { provisionIfMissing: false });
    expect(r).toEqual({ outcome: "account_missing" });
  });

  it("purchase semantics: provisions the missing account, attaches bcrypt(12), and never overwrites it after", async () => {
    const email = testEmail("provision");
    const session = await resolveOrThrow(await createSession({ email }));
    const { code } = await issueVerificationCode(session);
    await checkVerificationCode(session.id, code);

    const first = await attachPasswordToAccount(session, "correct horse battery", { provisionIfMissing: true });
    expect(first.outcome).toBe("ok");
    if (first.outcome !== "ok") return;
    expect(first.provisioned).toBe(true);

    const [user] = await db
      .select({ id: usersTable.id, role: usersTable.role, passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(eq(usersTable.email, email));
    expect(user.id).toBe(first.userId);
    expect(user.role).toBe("client");
    expect(user.passwordHash).toBeTruthy();
    expect(await bcrypt.compare("correct horse battery", user.passwordHash!)).toBe(true);

    // A checkout session is not a credential-recovery door.
    const second = await attachPasswordToAccount(session, "a different password", { provisionIfMissing: true });
    expect(second).toEqual({ outcome: "already_set", userId: user.id });
    const [after] = await db
      .select({ passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(eq(usersTable.id, user.id));
    expect(after.passwordHash).toBe(user.passwordHash);
  });

  it("attaches to an EXISTING password-less account without provisioning a second one", async () => {
    const email = testEmail("existing");
    // #3971's users_role_scope_check requires a tenant for the default "Free"
    // role — only the `*Pending` rungs (RetainerPending per #3971,
    // MonitoringPending/PackPending per #4372) are exempt, so this tenant-less
    // pre-existing-Prospect fixture needs it explicit (#3972).
    await db.insert(usersTable).values({ email, role: "client", name: "Pre-Existing Prospect", mspRole: LEGACY_ROLE.retainerPending });

    const session = await resolveOrThrow(await createSession({ email }));
    const { code } = await issueVerificationCode(session);
    await checkVerificationCode(session.id, code);

    const r = await attachPasswordToAccount(session, "correct horse battery", { provisionIfMissing: true });
    expect(r.outcome).toBe("ok");
    if (r.outcome !== "ok") return;
    expect(r.provisioned).toBe(false);

    const rows = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
    expect(rows).toHaveLength(1);
  });
});

// ── Git #3972 — real-product-type role assignment ──────────────────────────────

describe("resolveProspectRole — #3972, the real-product-type -> role mapping", () => {
  it("retainer with no tenant (skipped consent) is RetainerPending", () => {
    expect(resolveProspectRole("retainer", false)).toBe(LEGACY_ROLE.retainerPending);
  });

  it("retainer with a tenant is RetainerConsented", () => {
    expect(resolveProspectRole("retainer", true)).toBe(LEGACY_ROLE.retainerConsented);
  });

  it("monitoring/pack (always tenant-scoped) stays Customer, unaffected", () => {
    expect(resolveProspectRole("monitoring", true)).toBe(LEGACY_ROLE.customer);
    expect(resolveProspectRole("config_pack", true)).toBe(LEGACY_ROLE.customer);
  });

  it("an unrecognized/uncatalogued category with a tenant defaults to Customer, same as today", () => {
    expect(resolveProspectRole(null, true)).toBe(LEGACY_ROLE.customer);
  });

  // #4373 — no tenant is the product's OWN `*Pending` rung, each of which
  // users_role_scope_check permits tenant-less (#3971 Retainer, #4372
  // Monitoring/Pack); an unrecognised category falls back to RetainerPending,
  // the only tenant-less path such a product can legitimately arrive by.
  it("no tenant is the product's own *Pending rung — MonitoringPending / PackPending / RetainerPending (#4373)", () => {
    expect(resolveProspectRole("monitoring", false)).toBe(LEGACY_ROLE.monitoringPending);
    expect(resolveProspectRole("config_pack", false)).toBe(LEGACY_ROLE.packPending);
    expect(resolveProspectRole("retainer", false)).toBe(LEGACY_ROLE.retainerPending);
  });

  it("no tenant with an unrecognised/uncatalogued category falls back to RetainerPending, never a tenant-scoped role (#3950)", () => {
    expect(resolveProspectRole(null, false)).toBe(LEGACY_ROLE.retainerPending);
    expect(resolveProspectRole("project", false)).toBe(LEGACY_ROLE.retainerPending);
  });
});

describe("attachPasswordToAccount — real product type decides the provisioned role (#3972)", () => {
  it("a real retainer purchase with a consented tenant provisions RetainerConsented, not Customer", async () => {
    const email = testEmail("retainer-consented");
    const tenantGuid = randomUUID();
    const session = await resolveOrThrow(
      await createSession({ email, productSlug: "architect-essentials-retainer", tenantId: tenantGuid }),
    );
    const { code } = await issueVerificationCode(session);
    await checkVerificationCode(session.id, code);

    const r = await attachPasswordToAccount(session, "correct horse battery", { provisionIfMissing: true });
    expect(r.outcome).toBe("ok");

    const [user] = await db
      .select({ mspRole: usersTable.mspRole, tenantId: usersTable.tenantId })
      .from(usersTable)
      .where(eq(usersTable.email, email));
    expect(user.mspRole).toBe(LEGACY_ROLE.retainerConsented);
    expect(user.tenantId).not.toBeNull();

    const [tenantRow] = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.tenantId, tenantGuid));
    if (tenantRow) createdTenantIds.push(tenantRow.id);
  });

  it("a real monitoring purchase with a tenant still provisions Customer — provably unaffected by #3972", async () => {
    const email = testEmail("monitoring-unaffected");
    const tenantGuid = randomUUID();
    const session = await resolveOrThrow(
      await createSession({ email, productSlug: "monitoring-foundation-smb", tenantId: tenantGuid }),
    );
    const { code } = await issueVerificationCode(session);
    await checkVerificationCode(session.id, code);

    const r = await attachPasswordToAccount(session, "correct horse battery", { provisionIfMissing: true });
    expect(r.outcome).toBe("ok");

    const [user] = await db.select({ mspRole: usersTable.mspRole }).from(usersTable).where(eq(usersTable.email, email));
    expect(user.mspRole).toBe(LEGACY_ROLE.customer);

    const [tenantRow] = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.tenantId, tenantGuid));
    if (tenantRow) createdTenantIds.push(tenantRow.id);
  });

  it("a retainer purchase with a skipped (null) tenant provisions RetainerPending", async () => {
    const email = testEmail("retainer-no-consent");
    const session = await resolveOrThrow(
      await createSession({ email, productSlug: "architect-essentials-retainer", tenantId: null }),
    );
    const { code } = await issueVerificationCode(session);
    await checkVerificationCode(session.id, code);

    const r = await attachPasswordToAccount(session, "correct horse battery", { provisionIfMissing: true });
    expect(r.outcome).toBe("ok");

    const [user] = await db
      .select({ mspRole: usersTable.mspRole, tenantId: usersTable.tenantId })
      .from(usersTable)
      .where(eq(usersTable.email, email));
    expect(user.mspRole).toBe(LEGACY_ROLE.retainerPending);
    expect(user.tenantId).toBeNull();
  });
});

// ── Git #1313 (Epic #1309 Phase 4) — the portal-handoff gate ──────────────────

describe("portal handoff — only the account this session created is ever mintable", () => {
  /** Run the full happy-path account creation for a fresh session; returns the re-resolved session + userId. */
  async function completeAccountCreation(email: string) {
    const session = await resolveOrThrow(await createSession({ email }));
    const { code } = await issueVerificationCode(session);
    await checkVerificationCode(session.id, code);
    const attached = await attachPasswordToAccount(session, "correct horse battery", { provisionIfMissing: true });
    if (attached.outcome !== "ok") throw new Error(`expected ok, got ${attached.outcome}`);
    return { session: await resolveOrThrow(session.id), userId: attached.userId };
  }

  it("attachPasswordToAccount's ok outcome records account_user_id on the session", async () => {
    const { session, userId } = await completeAccountCreation(testEmail("handoff-record"));
    expect(session.accountUserId).toBe(userId);
  });

  it("already_set records NOTHING — a pre-existing account never becomes handoff-eligible", async () => {
    const email = testEmail("handoff-preexisting");
    await completeAccountCreation(email);

    // A second purchase session for the same (now password-carrying) account.
    const second = await resolveOrThrow(await createSession({ email }));
    const { code } = await issueVerificationCode(second);
    await checkVerificationCode(second.id, code);
    const r = await attachPasswordToAccount(second, "a different password", { provisionIfMissing: true });
    expect(r.outcome).toBe("already_set");

    const reread = await resolveOrThrow(second.id);
    expect(reread.accountUserId).toBeNull();
    expect(await resolvePortalHandoffUser(reread)).toEqual({ outcome: "account_not_completed" });
  });

  it("refuses before the account stage has completed", async () => {
    const session = await resolveOrThrow(await createSession());
    expect(await resolvePortalHandoffUser(session)).toEqual({ outcome: "account_not_completed" });
  });

  it("resolves the session's own completed account", async () => {
    const { session, userId } = await completeAccountCreation(testEmail("handoff-ok"));
    expect(await resolvePortalHandoffUser(session)).toEqual({ outcome: "ok", userId });
  });

  it("REFUSES when the session's email changed after the account completed", async () => {
    const { session } = await completeAccountCreation(testEmail("handoff-hijack"));
    await db
      .update(checkoutSessionsTable)
      .set({ email: testEmail("handoff-hijack-new") })
      .where(eq(checkoutSessionsTable.id, session.id));
    const reread = await resolveOrThrow(session.id);
    expect(await resolvePortalHandoffUser(reread)).toEqual({ outcome: "email_not_verified" });
  });

  it("REFUSES when the account's own email no longer matches the verified address", async () => {
    const { session, userId } = await completeAccountCreation(testEmail("handoff-drift"));
    await db
      .update(usersTable)
      .set({ email: testEmail("handoff-drift-moved") })
      .where(eq(usersTable.id, userId));
    expect(await resolvePortalHandoffUser(session)).toEqual({ outcome: "email_mismatch" });
  });

  it("REFUSES an account whose password has been cleared since", async () => {
    const { session, userId } = await completeAccountCreation(testEmail("handoff-nopw"));
    await db.update(usersTable).set({ passwordHash: null }).where(eq(usersTable.id, userId));
    expect(await resolvePortalHandoffUser(session)).toEqual({ outcome: "password_not_set" });
  });
});

describe("resolveProductCategory — Git #1315, the portal-handoff landing hint", () => {
  it("resolves a real retainer catalog row to its category", async () => {
    expect(await resolveProductCategory("architect-essentials-retainer")).toBe("retainer");
  });

  it("returns null for a slug with no catalog row, rather than throwing", async () => {
    expect(await resolveProductCategory(`no-such-product-${RUN_TAG}`)).toBeNull();
  });
});

describe("primitives", () => {
  it("generateSixDigitCode is always exactly six digits", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateSixDigitCode()).toMatch(/^\d{6}$/);
    }
  });

  it("maskEmail keeps the shape recognisable without being harvestable", () => {
    expect(maskEmail("shane@company.com")).toBe("s***e@company.com");
    expect(maskEmail("ab@x.io")).toBe("a***@x.io");
    expect(maskEmail("a-very-long-local-part@x.io")).toBe("a******t@x.io");
    expect(maskEmail("not-an-email")).toBe("not-an-email");
  });
});

// ── Git #4373 — per-product promote-on-consent, against the REAL constraint ────
//
// The mocked swap tests live in direct-tenant-provisioning.test.ts; this is the
// live-Postgres proof that a tenant-less `*Pending` row (admitted by #4372's
// users_role_scope_check) becomes its own product's `*Consented` rung, with the
// tenant linked, in the single UPDATE the consent callback path drives through
// provisionProspectAccount -> ensureClientMspUser. Because the constraint also
// REQUIRES a tenant for every `*Consented` rung, a swap that did not land in
// the same statement as the tenant link would be refused by Postgres itself.
describe("provisionProspectAccount — a pre-consent *Pending account consents (#4373, live DB)", () => {
  it.each([
    ["monitoring", LEGACY_ROLE.monitoringPending, LEGACY_ROLE.monitoringConsented],
    ["config_pack", LEGACY_ROLE.packPending, LEGACY_ROLE.packConsented],
    ["retainer", LEGACY_ROLE.retainerPending, LEGACY_ROLE.retainerConsented],
  ] as const)("%s: %s -> %s in one atomic update when a tenant is first linked", async (category, pending, consented) => {
    const email = testEmail(`consent-${category}`);
    const tenantGuid = randomUUID();

    // The account exists before any tenant does — exactly #4374's door shape.
    await db.insert(usersTable).values({ email, role: "client", name: "Pre-Consent Prospect", mspRole: pending });

    // Consent lands: the callback path provisions against the now-real GUID,
    // with the caller's product-type default as desiredRole. The swap must be
    // keyed on the row's existing rung, so the desiredRole here is deliberately
    // whatever resolveProspectRole would say for a tenant-present arrival.
    const result = await provisionProspectAccount({
      email,
      fullName: "Pre-Consent Prospect",
      tenantId: tenantGuid,
      role: resolveProspectRole(category, true),
    });
    expect(result).not.toBeNull();
    expect(result?.customerId).not.toBeNull();

    const [user] = await db
      .select({ mspRole: usersTable.mspRole, tenantId: usersTable.tenantId, mspId: usersTable.mspId })
      .from(usersTable)
      .where(eq(usersTable.email, email));
    expect(user.mspRole).toBe(consented);
    expect(user.tenantId).toBe(result?.customerId);
    expect(user.mspId).not.toBeNull();

    // Idempotent: a second consent pass re-points nothing and re-swaps nothing.
    const again = await provisionProspectAccount({
      email,
      fullName: "Pre-Consent Prospect",
      tenantId: tenantGuid,
      role: resolveProspectRole(category, true),
    });
    expect(again?.customerId).toBe(result?.customerId);
    const [after] = await db
      .select({ mspRole: usersTable.mspRole, tenantId: usersTable.tenantId })
      .from(usersTable)
      .where(eq(usersTable.email, email));
    expect(after).toEqual({ mspRole: consented, tenantId: result?.customerId });

    const [tenantRow] = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.tenantId, tenantGuid));
    if (tenantRow) createdTenantIds.push(tenantRow.id);
  });
});
