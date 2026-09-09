/**
 * Live-Postgres test for #2999: a gated customer's reinstatement request raises ONE real
 * Zoho Desk ticket, on the platform's own Desk, and does not become a second way for that
 * request to be marked resolved.
 *
 * Live rather than mocked for the same reason `msp-cascade.live-db.test.ts` is: the whole
 * claim being made is about rows. That a real `msp_job_queue` job is written, addressed
 * to `ZOHO_DEFAULT_MSP_ID` rather than the customer's own (delinquent) MSP, carrying a
 * description a responder can act on without opening the portal — and that the request
 * row genuinely carries the ticket back, so the notification is not "fired once and
 * stored nowhere". A mocked `db` would assert that the code calls the functions it calls.
 *
 * Nothing here talks to Zoho. `enqueueEscalationTicket()` is a local INSERT into
 * `msp_job_queue`; the ticket itself is created later by the batch drain, which does not
 * run in a test process. `recordReinstatementTicketCreated()` is called directly to stand
 * in for that drain's write-back, which is exactly the contract `handleCreateTicketJob()`
 * invokes it under.
 *
 * Skips cleanly with no `DATABASE_URL`. Scratch MSP + tenant + user + jobs only, all
 * removed in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run reinstatement-ticket.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  mspJobQueueTable,
  mspsTable,
  retentionReinstatementRequestsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { ZOHO_DEFAULT_MSP_ID } from "../zoho-client.ts";
import {
  readOpenReinstatementRequest,
  resolveOpenReinstatementRequests,
  submitReinstatementRequest,
} from "./reinstatement.ts";
import { recordReinstatementTicketCreated } from "./reinstatement-ticket.ts";

const SUFFIX = `vitest-2999-${Math.floor(Math.random() * 1e9)}`;
const REQUESTER_EMAIL = `reinstatement-${SUFFIX}@example.invalid`;
const CUSTOMER_NAME = `Reinstatement Co ${SUFFIX}`;

describe.skipIf(!process.env.DATABASE_URL)("#2999 — a reinstatement request raises one real Desk ticket", () => {
  let mspId = 0;
  let mspName = "";
  let tenantId = 0;
  let userId = 0;
  /** A second customer under the same MSP, used for the no-contact-email case. */
  let anonTenantId = 0;

  beforeAll(async () => {
    mspName = `Delinquent MSP ${SUFFIX}`;
    const [msp] = await db
      .insert(mspsTable)
      .values({ name: mspName, slug: `delinquent-${SUFFIX}`, status: "active" })
      .returning({ id: mspsTable.id });
    mspId = msp!.id;

    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: CUSTOMER_NAME, tenantId: `tenant-${SUFFIX}` })
      .returning({ id: tenantsTable.id });
    tenantId = tenant!.id;

    const [anon] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `Anon Co ${SUFFIX}`, tenantId: `tenant-anon-${SUFFIX}` })
      .returning({ id: tenantsTable.id });
    anonTenantId = anon!.id;

    const [user] = await db
      .insert(usersTable)
      .values({ email: REQUESTER_EMAIL, name: `Requester ${SUFFIX}`, tenantId })
      .returning({ id: usersTable.id });
    userId = user!.id;
  });

  afterAll(async () => {
    const tenants = [tenantId, anonTenantId].filter(Boolean);
    if (tenants.length) {
      // The queued tickets are the point of this test, so they are also its litter.
      // `msp_job_queue.customer_id` carries no FK, so nothing removes them implicitly.
      await db.delete(mspJobQueueTable).where(inArray(mspJobQueueTable.customerId, tenants));
      await db
        .delete(retentionReinstatementRequestsTable)
        .where(inArray(retentionReinstatementRequestsTable.tenantId, tenants));
    }
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    if (tenants.length) await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenants));
    if (mspId) await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
    // This hook used to carry an explicit 60s override, because the `DELETE FROM users`
    // above cost ~1.4s warm / ~5.4s cold and blew the config's global 20s hookTimeout:
    // the foreign-key columns referencing `users` carried no index, so every delete
    // sequentially scanned every referencing table to enforce them (#3099). Those indexes
    // now exist (`lib/db/migrations/manual/2026-09-09-index-users-fk-columns-3099.sql`),
    // a single `DELETE FROM users` measures ~12-15ms warm / ~220ms in a fresh backend, and
    // the override is gone — this hook runs under the ordinary global timeout again.
  });

  /** Every queued Desk-ticket job raised for one customer. */
  async function ticketJobsFor(customerId: number) {
    return db
      .select()
      .from(mspJobQueueTable)
      .where(eq(mspJobQueueTable.customerId, customerId));
  }

  it("files the request AND queues exactly one zoho_desk_create_ticket job for it", async () => {
    const lapsedAt = new Date("2026-09-01T00:00:00Z");
    const result = await submitReinstatementRequest({
      tenantId,
      requestedByUserId: userId,
      note: "Our MSP stopped paying. Please let us back in.",
      lapseSource: "msp_subscription",
      lapseWasMspCascade: true,
      lapsedAt,
    });
    expect(result.outcome).toBe("created");

    const jobs = await ticketJobsFor(tenantId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.jobType).toBe("zoho_desk_create_ticket");

    // The request row carries the job — the notification is recorded, not just fired.
    const open = await readOpenReinstatementRequest(tenantId);
    expect(open!.ticketJobId).toBe(jobs[0]!.jobId);
    expect(open!.ticketEnqueuedAt).not.toBeNull();
    expect(open!.ticketError).toBeNull();
    // Queued is not created: no ticket identifiers until the drain confirms one.
    expect(open!.ticketZohoId).toBeNull();
    expect(open!.ticketCreatedAt).toBeNull();
  });

  it("addresses the ticket to the PLATFORM's Desk, not the delinquent MSP's", async () => {
    const [job] = await ticketJobsFor(tenantId);
    // The whole point of #2999's answer to its own objection against option 3: in a
    // cascade the customer's MSP is the party that stopped paying, so routing the ticket
    // to them is a message into a void.
    expect(job!.mspId).toBe(ZOHO_DEFAULT_MSP_ID);
    expect(job!.mspId).not.toBe(mspId);
    // Still attributable to the real customer who asked.
    expect(job!.customerId).toBe(tenantId);
  });

  it("carries enough context to act on without opening the portal", async () => {
    const [job] = await ticketJobsFor(tenantId);
    const payload = job!.payload as Record<string, unknown>;
    const subject = String(payload.subject);
    const description = String(payload.description);

    expect(subject).toContain(CUSTOMER_NAME);
    // Customer identity, MSP identity, the real cause, and the timestamps.
    expect(description).toContain(CUSTOMER_NAME);
    expect(description).toContain(`tenant #${tenantId}`);
    expect(description).toContain(mspName);
    expect(description).toContain(`msp #${mspId}`);
    expect(description).toContain("MSP cascade:    yes");
    expect(description).toContain("2026-09-01T00:00:00.000Z"); // when they lapsed
    expect(description).toContain("Requested at:");
    // The customer's own words, verbatim — never summarised or substituted.
    expect(description).toContain("Our MSP stopped paying. Please let us back in.");
    // And the instruction that keeps resolution to one mechanism.
    expect(description).toContain("Do not");
    expect(description).toContain("portal_reopened");

    // A real Desk contact — the person who asked, so the ticket is a thread with them.
    expect(payload.contactEmail).toBe(REQUESTER_EMAIL);
  });

  it("asking twice does not raise a second ticket", async () => {
    const second = await submitReinstatementRequest({
      tenantId,
      requestedByUserId: userId,
      note: "Following up.",
      lapseSource: "msp_subscription",
      lapseWasMspCascade: true,
      lapsedAt: new Date("2026-09-01T00:00:00Z"),
    });
    expect(second.outcome).toBe("already_open");
    expect(await ticketJobsFor(tenantId)).toHaveLength(1);
  });

  it("the drain's write-back records the real ticket and touches nothing else", async () => {
    const before = await readOpenReinstatementRequest(tenantId);

    await recordReinstatementTicketCreated(before!.id, {
      zohoId: "9876543210",
      ticketNumber: "1043",
      webUrl: "https://desk.zoho.com/agent/t/1043",
    });

    const after = await readOpenReinstatementRequest(tenantId);
    expect(after!.ticketZohoId).toBe("9876543210");
    expect(after!.ticketNumber).toBe("1043");
    expect(after!.ticketUrl).toBe("https://desk.zoho.com/agent/t/1043");
    expect(after!.ticketCreatedAt).not.toBeNull();

    // #2999 point 3 — the ticket is a notification surface, not a second source of truth.
    // A confirmed ticket does NOT resolve the request; the customer is still locked out.
    expect(after!.status).toBe("open");
    expect(after!.resolution).toBeNull();
    expect(after!.resolvedAt).toBeNull();
  });

  it("resolveOpenReinstatementRequests() is still the one thing that resolves it", async () => {
    const closed = await resolveOpenReinstatementRequests(tenantId);
    expect(closed).toBe(1);
    expect(await readOpenReinstatementRequest(tenantId)).toBeNull();

    const [row] = await db
      .select()
      .from(retentionReinstatementRequestsTable)
      .where(eq(retentionReinstatementRequestsTable.tenantId, tenantId));
    expect(row!.status).toBe("resolved");
    expect(row!.resolution).toBe("portal_reopened");
    // Resolution does not erase the ticket that was raised — the record stays whole.
    expect(row!.ticketNumber).toBe("1043");
    expect(row!.ticketJobId).not.toBeNull();
  });

  it("with no resolvable contact email it records WHY, and queues nothing", async () => {
    // A request with no `requested_by_user_id` has no Desk contact. Zoho would reject the
    // job at drain time and retry it into the DLQ, where nobody is looking — so the
    // reason is put on the row instead, where the next reader of the request will see it.
    const result = await submitReinstatementRequest({
      tenantId: anonTenantId,
      requestedByUserId: null,
      note: null,
      lapseSource: "msp_subscription",
      lapseWasMspCascade: true,
      lapsedAt: new Date("2026-09-01T00:00:00Z"),
    });
    expect(result.outcome).toBe("created");

    expect(await ticketJobsFor(anonTenantId)).toHaveLength(0);

    const open = await readOpenReinstatementRequest(anonTenantId);
    expect(open!.ticketJobId).toBeNull();
    expect(open!.ticketError).toContain("no resolvable contact email");
    // The request itself is still recorded in full — the notification failing must never
    // cost the customer their record of having asked.
    expect(open!.status).toBe("open");
    expect(open!.lapseWasMspCascade).toBe(true);
  });
});
