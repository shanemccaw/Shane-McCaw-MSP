/**
 * Tests for the pure mapping layer behind `GET /api/msp/ownership/mine`
 * (Ownership / RACI: Cross-customer MSP view, #1521).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, expect } from "vitest";
import { resolveHoldingsForCustomer, type RawMspAssignmentRow } from "./msp-ownership-book.ts";
import type { WireOwnObject } from "./portal-ownership.ts";

const OBJECTS: WireOwnObject[] = [
  {
    type: "cr",
    id: "CR-0007",
    name: "Enable Conditional Access",
    sub: "Approved",
    r: "u42",
    a: "u1",
    c: "",
    i: "",
    link: "CR →",
  },
  {
    type: "freeze",
    id: "quarter-close",
    name: "Quarter close",
    sub: "billing, deploys",
    r: "",
    a: "",
    c: "",
    i: "",
    link: "Freeze →",
  },
];

describe("resolveHoldingsForCustomer()", () => {
  it("resolves a matched assignment to the real object it names", () => {
    const rows: RawMspAssignmentRow[] = [
      { objectId: "CR-0007", roleKey: "a", ownerPersonId: "u1", acceptance: "accepted", orderRank: 0 },
    ];
    const holdings = resolveHoldingsForCustomer(9, "Halden Materials", OBJECTS, rows);
    expect(holdings).toEqual([
      {
        customerId: 9,
        customerName: "Halden Materials",
        objectType: "cr",
        objectId: "CR-0007",
        objectName: "Enable Conditional Access",
        sub: "Approved",
        link: "CR →",
        roleKey: "a",
        holderPersonId: "u1",
        acceptance: "accepted",
        order: 0,
        declineReason: "",
      },
    ]);
  });

  it("skips a roleKey that is not one of r/a/c/i rather than fabricating a cell", () => {
    const rows: RawMspAssignmentRow[] = [
      { objectId: "CR-0007", roleKey: "owner", ownerPersonId: "u1", acceptance: "", orderRank: 0 },
    ];
    expect(resolveHoldingsForCustomer(9, "Halden Materials", OBJECTS, rows)).toEqual([]);
  });

  it("skips an assignment naming an object no longer in the live object list, rather than inventing a name", () => {
    const rows: RawMspAssignmentRow[] = [
      { objectId: "CR-9999", roleKey: "a", ownerPersonId: "u1", acceptance: "pending", orderRank: 0 },
    ];
    expect(resolveHoldingsForCustomer(9, "Halden Materials", OBJECTS, rows)).toEqual([]);
  });

  it("defaults a null acceptance/orderRank to their real empty values, not undefined", () => {
    const rows: RawMspAssignmentRow[] = [
      { objectId: "quarter-close", roleKey: "c", ownerPersonId: "u1", acceptance: null, orderRank: null },
    ];
    const [holding] = resolveHoldingsForCustomer(9, "Halden Materials", OBJECTS, rows);
    expect(holding?.acceptance).toBe("");
    expect(holding?.order).toBe(0);
  });

  it("resolves multiple holders of the same cell independently, preserving each one's own order", () => {
    const rows: RawMspAssignmentRow[] = [
      { objectId: "CR-0007", roleKey: "a", ownerPersonId: "u1", acceptance: "accepted", orderRank: 0 },
      { objectId: "CR-0007", roleKey: "a", ownerPersonId: "u2", acceptance: "pending", orderRank: 1 },
    ];
    const holdings = resolveHoldingsForCustomer(9, "Halden Materials", OBJECTS, rows);
    expect(holdings.map((h) => [h.holderPersonId, h.order])).toEqual([
      ["u1", 0],
      ["u2", 1],
    ]);
  });
});
