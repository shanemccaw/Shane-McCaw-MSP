import { describe, it, expect } from "vitest";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";
import {
  CUSTOMER_SERVICE_TYPES,
  PRE_PAYMENT_SERVICE_TYPES,
  resolveCatalogScope,
} from "./marketplace-catalog-scope";
import type { AuthUser } from "../middlewares/requireAuth";

/**
 * #3590 — the marketplace/search catalog scope comes from
 * `customer:marketplace.browse-full`, not from comparing the caller's role string.
 *
 * The capability rows are the vitest-wide fixture (src/test-setup/rbac-capability-rows.ts),
 * whose mapping is derived from `LEGACY_CAPABILITY_RULES` — so these tests prove the route
 * helper and the transcribed rule agree. That the REAL seeded row agrees with the rule is
 * `pnpm --filter @workspace/db run check-rbac-parity`, against live Postgres.
 */

type Principal = Pick<AuthUser, "id" | "role" | "mspRole" | "mspId" | "customerId">;

const principal = (overrides: Partial<Principal>): Principal => ({
  id: 1,
  role: "client",
  mspRole: undefined,
  mspId: undefined,
  customerId: 7,
  ...overrides,
});

const FULL = { kind: "full", serviceTypes: CUSTOMER_SERVICE_TYPES };
const NARROW = { kind: "pre-payment", serviceTypes: PRE_PAYMENT_SERVICE_TYPES };

describe("resolveCatalogScope (#3590)", () => {
  it("gives the pre-payment Free tier the narrow catalog", async () => {
    expect(await resolveCatalogScope(principal({ mspRole: LEGACY_ROLE.free }))).toEqual(NARROW);
  });

  it("gives a paying Customer the full catalog", async () => {
    expect(await resolveCatalogScope(principal({ mspRole: LEGACY_ROLE.customer }))).toEqual(FULL);
  });

  it("gives every rung above Customer the full catalog, as the old `!== Assessment` branch did", async () => {
    for (const mspRole of [LEGACY_ROLE.serviceAccount, LEGACY_ROLE.mspOperator, LEGACY_ROLE.mspAdmin, LEGACY_ROLE.platformAdmin]) {
      expect(await resolveCatalogScope(principal({ mspRole, customerId: undefined, mspId: 3 }))).toEqual(FULL);
    }
  });

  it("carries the legacy role='admin' promotion", async () => {
    expect(await resolveCatalogScope(principal({ role: "admin", mspRole: LEGACY_ROLE.free }))).toEqual(FULL);
  });

  it("reads a token signed before the rename as the rung it became", async () => {
    expect(await resolveCatalogScope(principal({ mspRole: "Assessment" as never }))).toEqual(NARROW);
    expect(await resolveCatalogScope(principal({ mspRole: "CustomerUser" as never }))).toEqual(FULL);
  });

  it("fails closed for a principal holding no recognised rung — the old string compare handed it the full catalog", async () => {
    expect(await resolveCatalogScope(principal({ mspRole: undefined }))).toEqual(NARROW);
    expect(await resolveCatalogScope(principal({ mspRole: "NotARole" as never }))).toEqual(NARROW);
  });
});
