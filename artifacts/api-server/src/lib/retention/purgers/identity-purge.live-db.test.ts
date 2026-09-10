/**
 * THE 7-YEAR PURGE DESTROYS THE PEOPLE TOO, RUN FOR REAL (Git #2984, EPIC #1944 part 7).
 *
 * `./post-termination-purge.live-db.test.ts` proves the purge destroys a due tenant's
 * DATA and only a due tenant's data. It does not touch the thing #2984 is about, because
 * until #2984 the purge did not touch it either: the customer's `users` rows — name,
 * email, password hash, MFA enrolment state, manager linkage — survived a purge that
 * reported success and recorded thousands of rows destroyed.
 *
 * Shane's decision, 2026-09-07: full purge, users included, no cold-storage exception.
 * This asserts that against real rows in a real database, because the three things that
 * can go wrong here are all silent:
 *
 *   1. **A NO ACTION FK aborts the delete.** ~25 columns point at `users(id)` with no
 *      ON DELETE action, and each one fails the whole transaction until it is cleared.
 *      #2984's live `pg_constraint` sweep found FOUR that the shared cascade never
 *      handled — `signup_exchange_tokens`, `print_tokens`, `document_print_tokens` and
 *      `checkout_sessions.account_user_id`. Each is seeded here, on the user being
 *      purged, so the purge genuinely cannot pass without handling them.
 *   2. **Phase order.** The `userId` key space is resolved per module from
 *      `users WHERE tenant_id = ?`. If the identity module ran before a module keyed that
 *      way, that module would resolve an empty user set, delete nothing, and report zero
 *      for rows still sitting in the table. `inbox_message_links` is the probe: the
 *      identity cascade does NOT delete it (its FK is SET NULL, so it never blocks), the
 *      `directory` module does — by user id. It surviving the purge, nulled, would mean
 *      identity ran too early.
 *   3. **Attribution.** The SET NULL set must behave exactly as decided: the row
 *      SURVIVES, its actor does not. Each attribution row here is deliberately attached
 *      to the NEIGHBOUR tenant and merely attributed to the purged user, so "survives
 *      with a null actor" and "was collaterally destroyed" cannot be confused.
 *
 * Skips cleanly with no `DATABASE_URL`. Every row it creates is scratch, tagged with a
 * random suffix, and removed in `afterAll` whether the test passes or fails.
 *
 * Run: pnpm --filter @workspace/api-server vitest run identity-purge.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, mspsTable, tenantsTable, usersTable } from "@workspace/db";
import { __resetTenantDataPurgersForTest, orderedTenantDataPurgers } from "../registry";
import { purgeTerminatedTenant } from "../post-termination";
import { registerAllTenantDataPurgers } from "./index";

const SUFFIX = `vitest-2984-${Math.floor(Math.random() * 1e9)}`;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

let mspId = 0;
/** The customer whose 7-year window has expired. Everything about it must be gone. */
let dueTenantId = 0;
let dueTenantGuid = "";
let dueUserId = 0;
/** The neighbour, six years from due. Nothing of theirs may be touched. */
let otherTenantId = 0;
let otherUserId = 0;
let otherProjectId = 0;
let dueProjectId = 0;
let salesOfferId = 0;
let generatedDocumentId = 0;

const one = async (statement: ReturnType<typeof sql>): Promise<number> => {
  const res = await db.execute<{ n: string }>(statement);
  return Number(res.rows[0]?.n ?? 0);
};

const makeTenant = async (label: string, lapsedAgoMs: number): Promise<{ id: number; guid: string; userId: number }> => {
  const guid = `${SUFFIX}-${label}`;
  const [tenant] = await db
    .insert(tenantsTable)
    .values({
      mspId,
      customerName: `#2984 ${label} ${SUFFIX}`,
      tenantId: guid,
      // Not one of RETENTION_CLOCK_RUNNING_TENANT_STATUSES, and no tenant_subscriptions
      // row, so the billing state the schedule consults reads inactive — the real shape
      // of a terminated customer.
      status: "inactive",
      subscriptionLapsedAt: new Date(Date.now() - lapsedAgoMs),
    })
    .returning({ id: tenantsTable.id });

  const [user] = await db
    .insert(usersTable)
    .values({
      email: `${label}.${SUFFIX}@scratch.invalid`,
      name: `#2984 scratch ${label}`,
      tenantId: tenant!.id,
      mspId,
    })
    .returning({ id: usersTable.id });

  return { id: tenant!.id, guid, userId: user!.id };
};

describe.skipIf(!process.env.DATABASE_URL)("#2984 — the post-termination purge destroys the customer's user accounts", () => {
  beforeAll(async () => {
    const [msp] = await db
      .insert(mspsTable)
      .values({ name: `#2984 purge MSP ${SUFFIX}`, slug: SUFFIX })
      .returning({ id: mspsTable.id });
    mspId = msp!.id;

    const due = await makeTenant("due", 8 * YEAR_MS);
    dueTenantId = due.id;
    dueTenantGuid = due.guid;
    dueUserId = due.userId;

    const other = await makeTenant("other", 1 * YEAR_MS);
    otherTenantId = other.id;
    otherUserId = other.userId;

    // ── The purged user's own rows, across every FK shape that matters ──────

    // A project, and a child keyed to that project rather than to the user, so the
    // second-order deletes are exercised too.
    const projectRows = await db.execute<{ id: number }>(sql`
      INSERT INTO projects (title, client_user_id) VALUES (${`#2984 due project ${SUFFIX}`}, ${dueUserId})
      RETURNING id
    `);
    dueProjectId = Number(projectRows.rows[0]!.id);
    await db.execute(sql`
      INSERT INTO status_reports (title, project_id, client_user_id)
      VALUES (${`#2984 status ${SUFFIX}`}, ${dueProjectId}, ${dueUserId})
    `);

    // Classic NO ACTION dependents the cascade has always handled.
    await db.execute(sql`
      INSERT INTO invoices (client_user_id, invoice_number, amount)
      VALUES (${dueUserId}, ${`INV-${SUFFIX}`}, ${1234})
    `);
    await db.execute(sql`
      INSERT INTO messages (client_user_id, sender_user_id, body)
      VALUES (${dueUserId}, ${dueUserId}, ${`#2984 message ${SUFFIX}`})
    `);
    await db.execute(sql`
      INSERT INTO notifications (user_id, title) VALUES (${dueUserId}, ${`#2984 notification ${SUFFIX}`})
    `);
    await db.execute(sql`
      INSERT INTO live_document_shares (token, customer_id, variant)
      VALUES (${`share-${SUFFIX}`}, ${dueUserId}, ${"review"})
    `);

    // ── The four NO ACTION edges #2984 found missing. Before this build, ANY ONE of
    //    these rows made the users DELETE throw and rolled the whole purge back. ──
    await db.execute(sql`
      INSERT INTO signup_exchange_tokens (token, user_id, expires_at)
      VALUES (${`sx-${SUFFIX}`}, ${dueUserId}, now() + interval '1 day')
    `);
    // A real generated document owned by this user, and a print token pointing at it.
    // `print_tokens.document_id` → `insights_generated_documents(id)` is `ON DELETE
    // CASCADE` (Git #3106; was NO ACTION when #2984 found it — that made this pair the
    // probe for a second ordering constraint the `documents` module had to honour, or
    // the whole purge aborted long before the identity phase was even reached).
    const docRows = await db.execute<{ id: number }>(sql`
      INSERT INTO insights_generated_documents (title, msp_customer_id, customer_id)
      VALUES (${`#2984 doc ${SUFFIX}`}, ${dueTenantId}, ${dueUserId})
      RETURNING id
    `);
    generatedDocumentId = Number(docRows.rows[0]!.id);
    await db.execute(sql`
      INSERT INTO print_tokens (token, user_id, document_id, expires_at)
      VALUES (${`pt-${SUFFIX}`}, ${dueUserId}, ${generatedDocumentId}, now() + interval '1 day')
    `);
    await db.execute(sql`
      INSERT INTO document_print_tokens (token, user_id, doc_type, expires_at)
      VALUES (${`dpt-${SUFFIX}`}, ${dueUserId}, ${"sow"}, now() + interval '1 day')
    `);
    // tenant_id deliberately NULL: only `account_user_id` can reach this row, so the
    // commercial module's tenantGuid-keyed target cannot mask a missing identity delete.
    await db.execute(sql`
      INSERT INTO checkout_sessions
        (id, product_slug, full_name, email, status, expires_at, seats,
         sow_selected_phase_service_ids, sow_addon_selections, sow_selected_phase_titles,
         sow_phase_breakdown, account_user_id)
      VALUES (gen_random_uuid(), ${`slug-${SUFFIX}`}, ${`#2984 ${SUFFIX}`}, ${`co.${SUFFIX}@scratch.invalid`},
              ${"pending"}, now() + interval '1 day', ${1},
              '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, ${dueUserId})
    `);

    // The phase-order probe. Purged by the `directory` module in the `userId` key space,
    // and NOT by the identity cascade — so it can only be gone if identity ran last.
    await db.execute(sql`
      INSERT INTO inbox_message_links (graph_message_id, customer_id)
      VALUES (${`graph-${SUFFIX}`}, ${dueUserId})
    `);

    // ── Attribution rows: attached to the NEIGHBOUR, merely attributed to the purged
    //    user. They must survive with a null actor — not be destroyed. ──
    await db.execute(sql`
      INSERT INTO audit_logs (actor_name, actor_role, action_type, entity_type, actor_user_id, entity_label)
      VALUES (${`#2984 actor ${SUFFIX}`}, ${"client"}, ${"test.2984"}, ${"user"}, ${dueUserId}, ${SUFFIX})
    `);

    const offerRows = await db.execute<{ id: number }>(sql`
      INSERT INTO sales_offers (title, customer_id, msp_id) VALUES (${`#2984 offer ${SUFFIX}`}, ${otherTenantId}, ${mspId})
      RETURNING id
    `);
    salesOfferId = Number(offerRows.rows[0]!.id);
    await db.execute(sql`
      INSERT INTO sales_offer_events (offer_id, event_name, actor_user_id)
      VALUES (${salesOfferId}, ${`event.${SUFFIX}`}, ${dueUserId})
    `);

    const otherProjectRows = await db.execute<{ id: number }>(sql`
      INSERT INTO projects (title, client_user_id) VALUES (${`#2984 other project ${SUFFIX}`}, ${otherUserId})
      RETURNING id
    `);
    otherProjectId = Number(otherProjectRows.rows[0]!.id);
    await db.execute(sql`
      INSERT INTO project_closures (project_id, signer_user_id) VALUES (${otherProjectId}, ${dueUserId})
    `);

    // The one attribution the DATABASE will not blank — its FK is NO ACTION where every
    // sibling is SET NULL, so the cascade nulls it in code. Keyed to the NEIGHBOUR tenant,
    // so deleting the row instead of blanking it would destroy another customer's settings.
    await db.execute(sql`
      INSERT INTO customer_alert_settings (customer_id, updated_by_user_id)
      VALUES (${otherTenantId}, ${dueUserId})
    `);
  });

  afterAll(async () => {
    // Scratch only, and unconditional: a failed assertion must not leave rows behind.
    await db.execute(sql`DELETE FROM audit_logs WHERE entity_label = ${SUFFIX}`);
    if (salesOfferId) {
      await db.execute(sql`DELETE FROM sales_offer_events WHERE offer_id = ${salesOfferId}`);
      await db.execute(sql`DELETE FROM sales_offers WHERE id = ${salesOfferId}`);
    }
    for (const projectId of [dueProjectId, otherProjectId].filter(Boolean)) {
      await db.execute(sql`DELETE FROM project_closures WHERE project_id = ${projectId}`);
      await db.execute(sql`DELETE FROM status_reports WHERE project_id = ${projectId}`);
      await db.execute(sql`DELETE FROM projects WHERE id = ${projectId}`);
    }
    for (const userId of [dueUserId, otherUserId].filter(Boolean)) {
      await db.execute(sql`DELETE FROM print_tokens WHERE user_id = ${userId}`);
      await db.execute(sql`DELETE FROM insights_generated_documents WHERE customer_id = ${userId}`);
      await db.execute(sql`DELETE FROM inbox_message_links WHERE customer_id = ${userId}`);
      await db.execute(sql`DELETE FROM checkout_sessions WHERE account_user_id = ${userId}`);
      await db.execute(sql`DELETE FROM document_print_tokens WHERE user_id = ${userId}`);
      await db.execute(sql`DELETE FROM signup_exchange_tokens WHERE user_id = ${userId}`);
      await db.execute(sql`DELETE FROM live_document_shares WHERE customer_id = ${userId}`);
      await db.execute(sql`DELETE FROM notifications WHERE user_id = ${userId}`);
      await db.execute(sql`DELETE FROM messages WHERE client_user_id = ${userId} OR sender_user_id = ${userId}`);
      await db.execute(sql`DELETE FROM invoices WHERE client_user_id = ${userId}`);
      await db.execute(sql`DELETE FROM status_reports WHERE client_user_id = ${userId}`);
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
    for (const tenantId of [dueTenantId, otherTenantId].filter(Boolean)) {
      await db.execute(sql`DELETE FROM customer_alert_settings WHERE customer_id = ${tenantId}`);
      await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
    }
    if (mspId) await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  it("runs the identity purger LAST, after every data module", () => {
    __resetTenantDataPurgersForTest();
    registerAllTenantDataPurgers();

    const ordered = orderedTenantDataPurgers();
    expect(ordered.length).toBeGreaterThan(1);
    expect(ordered.at(-1)?.key, "identity destroys the users rows every userId-keyed target reads").toBe("identity");
    // Not merely last by array position — the phase is what enforces it.
    expect(ordered.find((p) => p.key === "identity")?.phase).toBe("identity");
    expect(ordered.filter((p) => (p.phase ?? "data") === "identity")).toHaveLength(1);
  });

  it("destroys the due tenant's user accounts, and every row that used to block them", async () => {
    __resetTenantDataPurgersForTest();
    registerAllTenantDataPurgers();

    const result = await purgeTerminatedTenant(dueTenantId);
    expect(result.outcome, `purge failed: ${result.error ?? ""}`).toBe("purged");
    expect(result.destroyed["identity"], "one account under this tenant").toBe(1);

    expect(await one(sql`SELECT count(*) AS n FROM users WHERE tenant_id = ${dueTenantId}`)).toBe(0);
    expect(await one(sql`SELECT count(*) AS n FROM users WHERE id = ${dueUserId}`)).toBe(0);

    // Every NO ACTION dependent, including the four #2984 found missing — any one of them
    // still present would mean the users DELETE could not have run at all.
    expect(await one(sql`SELECT count(*) AS n FROM invoices WHERE invoice_number = ${`INV-${SUFFIX}`}`)).toBe(0);
    expect(await one(sql`SELECT count(*) AS n FROM messages WHERE body = ${`#2984 message ${SUFFIX}`}`)).toBe(0);
    expect(await one(sql`SELECT count(*) AS n FROM notifications WHERE title = ${`#2984 notification ${SUFFIX}`}`)).toBe(0);
    expect(await one(sql`SELECT count(*) AS n FROM live_document_shares WHERE token = ${`share-${SUFFIX}`}`)).toBe(0);
    expect(await one(sql`SELECT count(*) AS n FROM signup_exchange_tokens WHERE token = ${`sx-${SUFFIX}`}`)).toBe(0);
    expect(await one(sql`SELECT count(*) AS n FROM print_tokens WHERE token = ${`pt-${SUFFIX}`}`)).toBe(0);
    expect(await one(sql`SELECT count(*) AS n FROM document_print_tokens WHERE token = ${`dpt-${SUFFIX}`}`)).toBe(0);
    expect(await one(sql`SELECT count(*) AS n FROM checkout_sessions WHERE account_user_id = ${dueUserId}`)).toBe(0);

    // The generated document the print token pointed at — the second ordering constraint.
    expect(await one(sql`SELECT count(*) AS n FROM insights_generated_documents WHERE id = ${generatedDocumentId}`)).toBe(0);

    // The project and its project-keyed child.
    expect(await one(sql`SELECT count(*) AS n FROM projects WHERE id = ${dueProjectId}`)).toBe(0);
    expect(await one(sql`SELECT count(*) AS n FROM status_reports WHERE title = ${`#2984 status ${SUFFIX}`}`)).toBe(0);
  });

  it("purged the user-keyed data rows too — proof the identity module ran last", async () => {
    // `inbox_message_links` is deleted by the `directory` module in the userId key space
    // and is NOT touched by the identity cascade. Had identity run first, the accounts
    // would be gone, that module would have resolved an empty user set, and this row
    // would still be here with a null customer_id — a purge reporting success over rows
    // it never destroyed, with the tenant stamped and never swept again.
    expect(await one(sql`SELECT count(*) AS n FROM inbox_message_links WHERE graph_message_id = ${`graph-${SUFFIX}`}`)).toBe(0);
  });

  it("keeps the audit trail and blanks its actor — the row survives, the person does not", async () => {
    // #1944 part 2 guarantees the permanent account of what happened. #2984's reading of
    // "full purge, users included" is that the account survives and the ATTRIBUTION does
    // not: an audit trail still naming a deleted person would be retaining that identity
    // under another column name.
    const auditRows = await db.execute<{ n: string; nulled: string }>(sql`
      SELECT count(*) AS n, count(*) FILTER (WHERE actor_user_id IS NULL) AS nulled
      FROM audit_logs WHERE entity_label = ${SUFFIX}
    `);
    expect(Number(auditRows.rows[0]?.n)).toBe(1);
    expect(Number(auditRows.rows[0]?.nulled), "the row survives, its actor is blanked").toBe(1);

    const offerEvents = await db.execute<{ n: string; nulled: string }>(sql`
      SELECT count(*) AS n, count(*) FILTER (WHERE actor_user_id IS NULL) AS nulled
      FROM sales_offer_events WHERE offer_id = ${salesOfferId}
    `);
    expect(Number(offerEvents.rows[0]?.n)).toBe(1);
    expect(Number(offerEvents.rows[0]?.nulled)).toBe(1);

    const closures = await db.execute<{ n: string; nulled: string }>(sql`
      SELECT count(*) AS n, count(*) FILTER (WHERE signer_user_id IS NULL) AS nulled
      FROM project_closures WHERE project_id = ${otherProjectId}
    `);
    expect(Number(closures.rows[0]?.n)).toBe(1);
    expect(Number(closures.rows[0]?.nulled)).toBe(1);

    // The one the DATABASE will not blank: a NO ACTION FK on a nullable attribution
    // column, on a row belonging to ANOTHER tenant. Deleting it would have destroyed a
    // live customer's alert configuration because of who last edited it.
    const alertSettings = await db.execute<{ n: string; nulled: string }>(sql`
      SELECT count(*) AS n, count(*) FILTER (WHERE updated_by_user_id IS NULL) AS nulled
      FROM customer_alert_settings WHERE customer_id = ${otherTenantId}
    `);
    expect(Number(alertSettings.rows[0]?.n), "the neighbour's settings row must survive").toBe(1);
    expect(Number(alertSettings.rows[0]?.nulled)).toBe(1);
  });

  it("leaves the neighbour tenant's own account and data completely untouched", async () => {
    expect(await one(sql`SELECT count(*) AS n FROM users WHERE id = ${otherUserId}`)).toBe(1);
    expect(await one(sql`SELECT count(*) AS n FROM users WHERE tenant_id = ${otherTenantId}`)).toBe(1);
    expect(await one(sql`SELECT count(*) AS n FROM projects WHERE id = ${otherProjectId}`)).toBe(1);

    const [row] = await db
      .select({ purgedAt: tenantsTable.postTerminationPurgedAt })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, otherTenantId));
    expect(row?.purgedAt).toBeNull();
  });

  it("stamped the due tenant, and left its tenants row in place", async () => {
    // The tenant ROW survives by design — record_deletions.tenant_id is ON DELETE
    // RESTRICT so the deletion ledger outlives the records it describes (#1944 part 2).
    const [row] = await db
      .select({ purgedAt: tenantsTable.postTerminationPurgedAt, guid: tenantsTable.tenantId })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, dueTenantId));
    expect(row?.purgedAt).toBeInstanceOf(Date);
    expect(row?.guid).toBe(dueTenantGuid);
  });
});
