import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, customerBillingCreditsTable: {}, tenantSubscriptionsTable: {} }));

import { discountCouponId, stripeCouponAmount, validateCreditDiscount } from "./testimonial-credit.ts";

describe("validateCreditDiscount (Git #4032)", () => {
  it("accepts a fixed dollar amount and a percentage within 0–100", () => {
    expect(validateCreditDiscount("fixed", 50)).toEqual({ ok: true, discountType: "fixed", discountValue: 50 });
    expect(validateCreditDiscount("percentage", "12.5")).toEqual({ ok: true, discountType: "percentage", discountValue: 12.5 });
  });

  it("rejects the same inputs admin-coupons.ts rejects", () => {
    expect(validateCreditDiscount("bogus", 10).ok).toBe(false);
    expect(validateCreditDiscount("fixed", 0).ok).toBe(false);
    expect(validateCreditDiscount("fixed", -5).ok).toBe(false);
    expect(validateCreditDiscount("fixed", "").ok).toBe(false);
    expect(validateCreditDiscount("fixed", undefined).ok).toBe(false);
    expect(validateCreditDiscount("percentage", 101).ok).toBe(false);
  });

  it("rejects more precision than numeric(10,2) stores", () => {
    expect(validateCreditDiscount("fixed", 10.005).ok).toBe(false);
  });
});

describe("stripeCouponAmount", () => {
  it("converts fixed dollars to cents and passes percentages through", () => {
    expect(stripeCouponAmount("fixed", 49.99, "usd")).toEqual({ amount_off: 4999, currency: "usd" });
    expect(stripeCouponAmount("percentage", 10, "usd")).toEqual({ percent_off: 10 });
  });
});

describe("discountCouponId", () => {
  it("reads source.coupon (current API) and coupon (older API), string or expanded", () => {
    expect(discountCouponId({ id: "di_1", source: { coupon: "co_new" } })).toBe("co_new");
    expect(discountCouponId({ id: "di_2", source: { coupon: { id: "co_obj" } } })).toBe("co_obj");
    expect(discountCouponId({ id: "di_3", coupon: { id: "co_old" } })).toBe("co_old");
    expect(discountCouponId("di_unexpanded")).toBeNull();
    expect(discountCouponId(null)).toBeNull();
  });
});
