import { describe, it, expect } from "vitest";
import { extractCustomerDlqContext } from "./zoho-batch-drain.ts";

describe("extractCustomerDlqContext (Git #1166)", () => {
  it("returns null when payload has no localUserId (system/anonymous-originated job)", () => {
    expect(extractCustomerDlqContext({})).toBeNull();
    expect(extractCustomerDlqContext({ localUserId: "not-a-number" })).toBeNull();
  });

  it("extracts userId + subject for a customer-submitted create-ticket job", () => {
    expect(extractCustomerDlqContext({ localUserId: 42, subject: "Printer is broken" })).toEqual({
      userId: 42,
      subject: "Printer is broken",
    });
  });

  it("falls back to a ticketId-based subject when no subject is present (e.g. a reply job)", () => {
    expect(extractCustomerDlqContext({ localUserId: 7, ticketId: "101" })).toEqual({
      userId: 7,
      subject: "your update to request 101",
    });
  });

  it("falls back to a generic subject when neither subject nor ticketId is present", () => {
    expect(extractCustomerDlqContext({ localUserId: 7 })).toEqual({
      userId: 7,
      subject: "your request",
    });
  });
});
