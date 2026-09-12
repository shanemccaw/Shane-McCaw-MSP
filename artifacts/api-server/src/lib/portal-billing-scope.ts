import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import type { AuthUser } from "../middlewares/requireAuth.ts";

/**
 * Row-visibility scope for a portal billing / retainer-billing handler gated by
 * `requireCustomerCapability("billing.view" | "billing.manage")` (#3648, part of
 * #1696).
 *
 * The capability gate decides WHO may ask (#3465, narrowed by #3629 to Customer
 * Admin, Billing and MSP staff) — this decides WHICH `client_user_id`s a handler may
 * return or act on. Every route in portal-billing.ts / portal-retainer-billing.ts
 * used to scope by the caller's own `req.user.id` regardless of the gate, so a
 * Customer Admin or Billing holder saw an empty ledger unless a bill happened to be
 * addressed to them (#3648's finding). Shane's resolution on #3648: a caller who
 * holds the capability sees every row belonging to their own tenant, not just their
 * own.
 *
 * Neither `invoices` nor `client_services` carries a tenant id of its own — only
 * `client_user_id`, a `users.id` FK — so "the tenant's rows" means every user id
 * under the caller's tenant (`users.tenant_id`, the same idiom portal-team.ts's
 * roster read already uses), used with `inArray` in place of the old single-user
 * `eq`.
 *
 * Falls back to the caller's own id alone when `customerId` is absent — an MSP-staff
 * caller (also allowed through by #3629's mapping) has no customer tenant to widen
 * against, so this preserves the only behavior that ever made sense for them rather
 * than returning nothing, or every tenant's rows.
 */
export async function billingScopeUserIds(user: Pick<AuthUser, "id" | "customerId">): Promise<number[]> {
  if (user.customerId == null) return [user.id];
  const rows = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.tenantId, user.customerId));
  return rows.map((r) => r.id);
}
