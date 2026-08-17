/**
 * shanebot-engine.test.ts
 *
 * Unit tests for the ShaneBot Engine Core (#1097): the code-canonical instance
 * config, persona/prompt assembly, and — most importantly — the action_router that
 * gates every model-emitted action against the emitting instance's allowedActions
 * BEFORE anything can fire. A public instance ([]) must authorize nothing.
 */

import { describe, it, expect, vi } from "vitest";

// The engine only needs @workspace/db at runtime for its grounding builders (db +
// the tables they query). Mock it so importing the engine never touches a real
// Postgres connection; these tests exercise the pure, DB-free surface.
vi.mock("@workspace/db", () => ({
  db: {},
  servicesTable: {},
  mspsTable: {},
  tenantsTable: {},
  mspEventStoreTable: {},
}));

vi.mock("./logger.ts", () => ({
  logger: {
    error: vi.fn(), warn: vi.fn(), info: vi.fn(),
    child: vi.fn(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })),
  },
}));

import {
  BOT_INSTANCES,
  resolveInstance,
  resolvePersonaPrompt,
  assembleSystemPrompt,
  parseRequestedActions,
  routeActions,
  routeRequestedActions,
  stripActionTokens,
} from "./shanebot-engine.ts";

describe("BOT_INSTANCES — the two permanent instances", () => {
  it("ShaneBot Public: unauthenticated, live_catalog, NO allowed actions, platform cost", () => {
    const pub = resolveInstance("shanebot_public");
    expect(pub.authMode).toBe("public");
    expect(pub.groundingSource).toBe("live_catalog");
    expect(pub.allowedActions).toEqual([]);
    expect(pub.costOwner).toBe("platform");
    expect(pub.personaSurface).toBe("public");
  });

  it("ShaneBot Paid: portal-authenticated, customer_entitlements, both actions, msp cost", () => {
    const paid = resolveInstance("shanebot_paid");
    expect(paid.authMode).toBe("portal_authenticated");
    expect(paid.groundingSource).toBe("customer_entitlements");
    expect(paid.allowedActions).toEqual(["regenerate_document", "rerun_scan"]);
    expect(paid.costOwner).toBe("msp");
    expect(paid.personaSurface).toBe("portal");
  });

  it("has exactly the two permanent instances, no more", () => {
    expect(Object.keys(BOT_INSTANCES).sort()).toEqual(["shanebot_paid", "shanebot_public"]);
  });
});

describe("action_router: parseRequestedActions", () => {
  it("parses a single [ACTION:x] token", () => {
    expect(parseRequestedActions("Done.\n[ACTION:rerun_scan]")).toEqual(["rerun_scan"]);
  });

  it("parses multiple, lowercases, and de-dupes in first-seen order", () => {
    const text = "[ACTION:Regenerate_Document] then [ACTION:rerun_scan] and again [ACTION:regenerate_document]";
    expect(parseRequestedActions(text)).toEqual(["regenerate_document", "rerun_scan"]);
  });

  it("returns [] when there is no token, and never throws on empty/undefined", () => {
    expect(parseRequestedActions("just a normal reply")).toEqual([]);
    expect(parseRequestedActions("")).toEqual([]);
    // @ts-expect-error — defensively tolerant of a non-string at runtime.
    expect(parseRequestedActions(undefined)).toEqual([]);
  });
});

describe("action_router: routeActions — allowedActions gate", () => {
  const paid = resolveInstance("shanebot_paid");
  const pub = resolveInstance("shanebot_public");

  it("authorizes actions in the paid instance's allowedActions", () => {
    expect(routeActions(paid, ["regenerate_document", "rerun_scan"])).toEqual([
      { action: "regenerate_document", authorized: true },
      { action: "rerun_scan", authorized: true },
    ]);
  });

  it("denies an unknown/hallucinated action even on the paid instance", () => {
    expect(routeActions(paid, ["delete_tenant"])).toEqual([
      { action: "delete_tenant", authorized: false },
    ]);
  });

  it("PUBLIC instance ([] allowedActions) authorizes NOTHING", () => {
    expect(routeActions(pub, ["regenerate_document", "rerun_scan"])).toEqual([
      { action: "regenerate_document", authorized: false },
      { action: "rerun_scan", authorized: false },
    ]);
  });
});

describe("action_router: routeRequestedActions (parse + gate) and stripActionTokens", () => {
  it("parses tokens from model text and gates them for the instance", () => {
    const paid = resolveInstance("shanebot_paid");
    const text = "I'll rerun it.\n[ACTION:rerun_scan] [ACTION:delete_everything]";
    expect(routeRequestedActions(paid, text)).toEqual([
      { action: "rerun_scan", authorized: true },
      { action: "delete_everything", authorized: false },
    ]);
  });

  it("strips every [ACTION:x] token from the visible reply", () => {
    const stripped = stripActionTokens("Regenerating now. [ACTION:regenerate_document]");
    expect(stripped).toBe("Regenerating now.");
    expect(stripped).not.toMatch(/ACTION/);
  });
});

describe("prompt assembly", () => {
  it("resolvePersonaPrompt renders the instance's persona voice", () => {
    const prompt = resolvePersonaPrompt(resolveInstance("shanebot_public"));
    expect(prompt).toContain("ShaneBot");
    expect(prompt).toContain("WHO YOU ARE");
  });

  it("assembleSystemPrompt stitches persona + identity + body + the suggested-replies instruction", () => {
    const prompt = assembleSystemPrompt({
      instance: resolveInstance("shanebot_paid"),
      identity: "customer user for Acme",
      body: "=== PLATFORM DATA ===\nnone\n=== END ===",
    });
    expect(prompt).toContain("ShaneBot"); // persona voice
    expect(prompt).toContain("You are talking to a customer user for Acme.");
    expect(prompt).toContain("=== PLATFORM DATA ===");
    expect(prompt).toContain("SUGGESTED REPLIES"); // shared control-token instruction
  });
});
