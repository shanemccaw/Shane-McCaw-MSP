/**
 * free-scan-return-link.test.ts — Git #1359 (Phase 7 of Feature #1352, Free Scan).
 *
 * Locks the narrow scope of the Free Scan return link against the REAL local
 * Postgres, because every guarantee lives in rows: the token is stored only as a
 * hash, the table's CHECK refuses any other purpose, a link stops resolving the
 * moment its account gains an entitlement or leaves the Free role, and a return
 * token is not a value any /setup-password-family table knows about.
 *
 * The HTTP-level replay checks (the token presented to /auth/setup-password,
 * /auth/*-exchange, Bearer on authenticated routes) were run live against a
 * running api-server in the #1359 build session — see build-journal/1359.md.
 *
 * Mailer is mocked so nothing is sent; every row is swept in afterAll.
 */

import { describe, it, expect, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  tenantsTable,
  servicesTable,
  clientServicesTable,
  accountSetupTokensTable,
  passwordResetTokensTable,
  freeScanReturnLinksTable,
  leadStagingTable,
  mspJobQueueTable,
} from "@workspace/db";
import { eq, inArray, like, or, sql } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

const sent: Array<{ to: string; subject: string; html: string }> = [];
vi.mock("./mailer.ts", () => ({
  getEmailTemplateOrFallback: async (_slug: string, _vars: Record<string, string>, subject: string, bodyHtml: string) => ({
    subject,
    bodyHtml,
  }),
  sendEmailOrThrow: async (to: string, subject: string, html: string) => {
    sent.push({ to, subject, html });
  },
}));

const { provisionProspectAccount } = await import("./direct-tenant-provisioning.ts");
const {
  mintFreeScanReturnLink,
  resolveFreeScanReturnLink,
  issueAndEmailFreeScanReturnLink,
  hashFreeScanReturnToken,
} = await import("./free-scan-return-link.ts");

const EMAIL_DOMAIN = "free-scan-return-link-test.invalid";
const createdEmails: string[] = [];
const createdTenantGuids: string[] = [];

async function makeProspect(label: string): Promise<{ userId: number; customerId: number; email: string }> {
  const email = `test-1359-${label}-${randomUUID().slice(0, 8)}@${EMAIL_DOMAIN}`;
  const guid = randomUUID();
  createdEmails.push(email);
  createdTenantGuids.push(guid);
  const p = await provisionProspectAccount({ email, fullName: "Test Prospect", company: `Test 1359 ${label}`, tenantId: guid, role: LEGACY_ROLE.free });
  if (!p || p.customerId == null) throw new Error("provisionProspectAccount did not produce a tenant-linked Prospect");
  return { userId: p.userId, customerId: p.customerId, email };
}

afterAll(async () => {
  if (createdEmails.length > 0) {
    const users = await db.select({ id: usersTable.id }).from(usersTable).where(inArray(usersTable.email, createdEmails));
    const ids = users.map((u) => u.id);
    if (ids.length > 0) {
      await db.delete(clientServicesTable).where(inArray(clientServicesTable.clientUserId, ids));
    }
    await db.delete(usersTable).where(inArray(usersTable.email, createdEmails));
  }
  if (createdTenantGuids.length > 0) {
    await db.delete(tenantsTable).where(inArray(tenantsTable.tenantId, createdTenantGuids));
  }
  await db.delete(leadStagingTable).where(like(leadStagingTable.email, `%${EMAIL_DOMAIN}`));
  await db.delete(mspJobQueueTable).where(sql`${mspJobQueueTable.payload}::text LIKE ${"%" + EMAIL_DOMAIN + "%"}`);
});

describe("Free Scan return link (Git #1359)", () => {
  it("mints an fsr_ token, stores only its sha256, and resolves to that Prospect's own customer", async () => {
    const p = await makeProspect("happy");
    const minted = await mintFreeScanReturnLink(p.userId);
    expect(minted).not.toBeNull();
    expect(minted!.token).toMatch(/^fsr_[A-Za-z0-9_-]{43}$/);

    const rows = await db.select().from(freeScanReturnLinksTable).where(eq(freeScanReturnLinksTable.userId, p.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashFreeScanReturnToken(minted!.token));
    expect(rows[0].tokenHash).not.toContain(minted!.token.slice(4));
    expect(rows[0].customerId).toBe(p.customerId);
    expect(rows[0].purpose).toBe("free_scan_results");

    const r = await resolveFreeScanReturnLink(minted!.token);
    expect(r).toEqual({ ok: true, userId: p.userId, customerId: p.customerId });

    const [after] = await db.select().from(freeScanReturnLinksTable).where(eq(freeScanReturnLinksTable.id, rows[0].id));
    expect(after.useCount).toBe(1);
  });

  it("is never written into, or findable in, the /setup-password or reset-password token tables", async () => {
    const p = await makeProspect("isolation");
    const minted = await mintFreeScanReturnLink(p.userId);
    const setup = await db
      .select({ id: accountSetupTokensTable.id })
      .from(accountSetupTokensTable)
      .where(or(eq(accountSetupTokensTable.userId, p.userId), eq(accountSetupTokensTable.token, minted!.token)));
    expect(setup).toEqual([]);
    const reset = await db
      .select({ id: passwordResetTokensTable.id })
      .from(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.token, minted!.token));
    expect(reset).toEqual([]);
  });

  it("refuses to resolve anything that is not fsr_-shaped — a setup-token-shaped hex string or a JWT", async () => {
    expect(await resolveFreeScanReturnLink("a".repeat(64))).toEqual({ ok: false, reason: "invalid" });
    expect(await resolveFreeScanReturnLink("eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.sig")).toEqual({ ok: false, reason: "invalid" });
    expect(await resolveFreeScanReturnLink(`fsr_${"A".repeat(43)}`)).toEqual({ ok: false, reason: "invalid" });
    expect(await resolveFreeScanReturnLink(undefined)).toEqual({ ok: false, reason: "invalid" });
  });

  it("the purpose CHECK rejects any other purpose at the database", async () => {
    const p = await makeProspect("purpose");
    await expect(
      db.insert(freeScanReturnLinksTable).values({
        tokenHash: `test-1359-${randomUUID()}`,
        purpose: "account_setup",
        userId: p.userId,
        customerId: p.customerId,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow();
  });

  it("minting a new link revokes the previous one", async () => {
    const p = await makeProspect("revoke");
    const first = await mintFreeScanReturnLink(p.userId);
    const second = await mintFreeScanReturnLink(p.userId);
    expect(await resolveFreeScanReturnLink(first!.token)).toEqual({ ok: false, reason: "expired" });
    expect((await resolveFreeScanReturnLink(second!.token)).ok).toBe(true);
  });

  it("an expired link does not resolve", async () => {
    const p = await makeProspect("expired");
    const minted = await mintFreeScanReturnLink(p.userId);
    await db
      .update(freeScanReturnLinksTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(freeScanReturnLinksTable.tokenHash, hashFreeScanReturnToken(minted!.token)));
    expect(await resolveFreeScanReturnLink(minted!.token)).toEqual({ ok: false, reason: "expired" });
  });

  it("stops resolving the moment the account gains a real entitlement (converted accounts use real login)", async () => {
    const p = await makeProspect("entitled");
    const minted = await mintFreeScanReturnLink(p.userId);
    expect((await resolveFreeScanReturnLink(minted!.token)).ok).toBe(true);

    const [svc] = await db.select({ id: servicesTable.id }).from(servicesTable).limit(1);
    await db.insert(clientServicesTable).values({ clientUserId: p.userId, serviceId: svc.id });
    expect(await resolveFreeScanReturnLink(minted!.token)).toEqual({ ok: false, reason: "not_applicable" });
  });

  it("stops resolving when the account is no longer Free-role", async () => {
    const p = await makeProspect("promoted");
    const minted = await mintFreeScanReturnLink(p.userId);
    await db.update(usersTable).set({ mspRole: LEGACY_ROLE.customer }).where(eq(usersTable.id, p.userId));
    expect(await resolveFreeScanReturnLink(minted!.token)).toEqual({ ok: false, reason: "not_applicable" });
    // and nothing new can be minted for it either
    expect(await mintFreeScanReturnLink(p.userId)).toBeNull();
  });

  it("issueAndEmailFreeScanReturnLink mails a /scan/results#t= link to the Prospect's own address only", async () => {
    const p = await makeProspect("email");
    sent.length = 0;
    expect(await issueAndEmailFreeScanReturnLink(p.userId)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(p.email);
    const m = sent[0].html.match(/\/scan\/results#t=(fsr_[A-Za-z0-9_-]{43})/);
    expect(m).not.toBeNull();
    expect((await resolveFreeScanReturnLink(decodeURIComponent(m![1]))).ok).toBe(true);
  });
});
