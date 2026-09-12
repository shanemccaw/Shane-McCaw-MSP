/**
 * portal-billing-scope.test.ts (#3648, part of #1696)
 *
 * Direct unit coverage of `billingScopeUserIds`, the helper that decided the fix for
 * #3648: a portal billing/retainer-billing handler gated by
 * `requireCustomerCapability("billing.view" | "billing.manage")` used to scope its
 * query to the caller's own `req.user.id` regardless of the capability just checked,
 * so a Customer Admin or Billing holder without a bill of their own saw an empty
 * ledger. This proves the two branches directly, without the surrounding route noise:
 *
 *  - a caller with a `customerId` (a real customer-tenant user) resolves to every
 *    user id `users.tenant_id` reports for that tenant — not just their own;
 *  - a caller with no `customerId` (the MSP-staff shape) falls back to their own id
 *    alone, with no database read at all.
 */
import { describe, it, expect, vi } from "vitest";

const mockWhereResult = vi.fn();

vi.mock("@workspace/db", () => {
  const chain: any = {
    from: () => chain,
    where: (...args: unknown[]) => mockWhereResult(...args),
  };
  return {
    db: { select: vi.fn(() => chain) },
    usersTable: { id: "id", tenantId: "tenant_id" },
  };
});

import { db, usersTable } from "@workspace/db";
import { billingScopeUserIds } from "./portal-billing-scope.ts";

describe("billingScopeUserIds", () => {
  it("resolves every user id under the caller's tenant when customerId is present", async () => {
    mockWhereResult.mockResolvedValue([{ id: 5 }, { id: 9 }, { id: 21 }]);

    const ids = await billingScopeUserIds({ id: 5, customerId: 42 });

    expect(ids).toEqual([5, 9, 21]);
    expect(db.select).toHaveBeenCalledWith({ id: usersTable.id });
  });

  it("falls back to the caller's own id alone, with no DB read, when customerId is absent", async () => {
    const selectSpy = db.select as unknown as ReturnType<typeof vi.fn>;
    selectSpy.mockClear();

    const ids = await billingScopeUserIds({ id: 7, customerId: undefined });

    expect(ids).toEqual([7]);
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it("falls back to the caller's own id alone when customerId is null", async () => {
    const selectSpy = db.select as unknown as ReturnType<typeof vi.fn>;
    selectSpy.mockClear();

    const ids = await billingScopeUserIds({ id: 11, customerId: null as unknown as undefined });

    expect(ids).toEqual([11]);
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it("returns an empty scope (not the caller's own id) if the tenant lookup somehow finds nobody", async () => {
    // Defensive case: a caller's own row should always be among the tenant's users,
    // but if the DB ever disagrees, the scope must not silently widen to "everyone" —
    // inArray(column, []) resolves to no rows, never every row.
    mockWhereResult.mockResolvedValue([]);

    const ids = await billingScopeUserIds({ id: 5, customerId: 42 });

    expect(ids).toEqual([]);
  });
});
