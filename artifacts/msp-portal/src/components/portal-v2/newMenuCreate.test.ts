/**
 * newMenuCreate.test.ts — the "New" menu → real-creation mapping.
 *
 * Run with: npx tsx --test src/components/portal-v2/newMenuCreate.test.ts
 *
 * What is worth pinning:
 *  1. Only the four items with a real backend map to a create kind; the three
 *     without one (Freeze window, Ownership row, Webhook endpoint) map to null so
 *     they keep navigating rather than opening a form that could not save.
 *  2. `changeClass` is fixed by WHICH item opened the form, never typed — an
 *     Emergency raised from the Change-request item would misreport which gate it
 *     went through. Emergency/Standard also derive their window from the item.
 *  3. The CR body never carries authority (risk/workload/status/approver) — same
 *     rule the fix-panel/SOP mappers hold, checked here for the New-menu mapper.
 *  4. The SOP body splits the steps textarea one-per-line and drops blanks, and a
 *     customer-authored SOP is a manual definition (the route forces it; the body
 *     just carries manual step titles, never a graphEndpoint).
 *  5. Every FormSpec's field ids ARE the create-body field names, so there is no
 *     silent translation layer between drawer and route.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { changeRequestBodyFromNewMenu } from "./ccCreateChangeRequest";
import { sopBodyFromNewMenu } from "./sopCreate";
import { formSpecForNewCreate, newCreateKindForLabel, type NewCreateDeps } from "./newMenuCreate";

const NOOP_DEPS: NewCreateDeps = { fetchWithAuth: async () => new Response(null, { status: 201 }) };

describe("newCreateKindForLabel", () => {
  it("maps the four backed items to their kinds", () => {
    assert.equal(newCreateKindForLabel("Change request"), "change-request");
    assert.equal(newCreateKindForLabel("Emergency change"), "emergency-change");
    assert.equal(newCreateKindForLabel("Standard change"), "standard-change");
    assert.equal(newCreateKindForLabel("Procedure"), "sop");
  });

  it("returns null for the items with no create backend", () => {
    assert.equal(newCreateKindForLabel("Freeze window"), null);
    assert.equal(newCreateKindForLabel("Ownership row"), null);
    assert.equal(newCreateKindForLabel("Webhook endpoint"), null);
    assert.equal(newCreateKindForLabel("Anything else"), null);
  });
});

describe("changeRequestBodyFromNewMenu", () => {
  const base = {
    title: "Block legacy auth",
    target: "Conditional Access",
    window: "Saturday 02:00",
    impactedUsersCount: "40",
    ticket: "INC-9",
    pre: "before",
    post: "the steps",
  };

  it("a Change request is a Normal change carrying the typed window", () => {
    const body = changeRequestBodyFromNewMenu(base, "change-request");
    assert.equal(body.changeClass, "Normal");
    assert.equal(body.window, "Saturday 02:00");
    assert.equal(body.title, "Block legacy auth");
    assert.equal(body.target, "Conditional Access");
    assert.equal(body.impactedUsersCount, 40);
    assert.equal(body.ticket, "INC-9");
    assert.equal(body.pre, "before");
    assert.equal(body.post, "the steps");
  });

  it("an Emergency change is Emergency and books into the emergency window regardless of any typed window", () => {
    const body = changeRequestBodyFromNewMenu({ ...base, window: "ignored" }, "emergency-change");
    assert.equal(body.changeClass, "Emergency");
    assert.equal(body.window, "Emergency change");
  });

  it("a Standard change is Standard and falls back to the next available window when none is typed", () => {
    const body = changeRequestBodyFromNewMenu({ ...base, window: "" }, "standard-change");
    assert.equal(body.changeClass, "Standard");
    assert.equal(body.window, "Next available window");
  });

  it("never carries authority-bearing fields", () => {
    const body = changeRequestBodyFromNewMenu(base, "change-request") as Record<string, unknown>;
    assert.equal("risk" in body, false);
    assert.equal("workload" in body, false);
    assert.equal("status" in body, false);
    assert.equal("approver" in body, false);
  });

  it("a blank or non-numeric impact count becomes 0, never NaN", () => {
    assert.equal(changeRequestBodyFromNewMenu({ ...base, impactedUsersCount: "" }, "change-request").impactedUsersCount, 0);
    assert.equal(changeRequestBodyFromNewMenu({ ...base, impactedUsersCount: "abc" }, "change-request").impactedUsersCount, 0);
  });

  it("an omitted optional ticket/pre is undefined, not an empty string", () => {
    const body = changeRequestBodyFromNewMenu({ title: "t", target: "x", window: "w", post: "p" }, "change-request");
    assert.equal(body.ticket, undefined);
    assert.equal(body.pre, undefined);
  });
});

describe("sopBodyFromNewMenu", () => {
  it("splits steps one-per-line and drops blank lines", () => {
    const body = sopBodyFromNewMenu({
      title: "Onboard a starter",
      category: "Identity & Access",
      description: "Day-one access",
      estimatedMinutes: "20",
      steps: "Create account\n\n  Assign licence  \nAdd to groups\n",
    });
    assert.deepEqual(
      body.steps.map((s) => s.title),
      ["Create account", "Assign licence", "Add to groups"],
    );
    assert.equal(body.title, "Onboard a starter");
    assert.equal(body.category, "Identity & Access");
    assert.equal(body.estimatedMinutes, 20);
  });

  it("carries no graphEndpoint — a customer-authored SOP is a manual definition", () => {
    const body = sopBodyFromNewMenu({ title: "t", category: "c", description: "d", steps: "one\ntwo" });
    for (const step of body.steps) {
      assert.equal("graphEndpoint" in step, false);
    }
  });

  it("an omitted or invalid estimate is undefined, not NaN", () => {
    assert.equal(sopBodyFromNewMenu({ title: "t", category: "c", description: "d", steps: "one" }).estimatedMinutes, undefined);
    assert.equal(
      sopBodyFromNewMenu({ title: "t", category: "c", description: "d", steps: "one", estimatedMinutes: "x" }).estimatedMinutes,
      undefined,
    );
  });
});

describe("formSpecForNewCreate", () => {
  it("every spec's field ids are the create-body field names (no translation layer)", () => {
    const idsOf = (kind: Parameters<typeof formSpecForNewCreate>[0]) =>
      formSpecForNewCreate(kind, NOOP_DEPS).fields.map((f) => f.id);

    // CR fields are a subset of createSchema's fields.
    const crFields = new Set(["title", "target", "window", "impactedUsersCount", "ticket", "pre", "post"]);
    for (const kind of ["change-request", "emergency-change", "standard-change"] as const) {
      for (const id of idsOf(kind)) assert.ok(crFields.has(id), `${kind} has unexpected field ${id}`);
    }

    const sopFields = new Set(["title", "category", "description", "steps", "estimatedMinutes"]);
    for (const id of idsOf("sop")) assert.ok(sopFields.has(id), `sop has unexpected field ${id}`);
  });

  it("each spec has a non-empty title, submitLabel and done copy", () => {
    for (const kind of ["change-request", "emergency-change", "standard-change", "sop"] as const) {
      const spec = formSpecForNewCreate(kind, NOOP_DEPS);
      assert.ok(spec.title.length > 0);
      assert.ok((spec.submitLabel ?? "").length > 0);
      assert.ok(spec.doneNote.length > 0);
      assert.ok(typeof spec.onSubmit === "function");
    }
  });

  it("the change-request and sop specs both require a title and the terminal payload field", () => {
    const cr = formSpecForNewCreate("change-request", NOOP_DEPS);
    assert.equal(cr.fields.find((f) => f.id === "title")?.required, true);
    assert.equal(cr.fields.find((f) => f.id === "post")?.required, true);

    const sop = formSpecForNewCreate("sop", NOOP_DEPS);
    assert.equal(sop.fields.find((f) => f.id === "title")?.required, true);
    assert.equal(sop.fields.find((f) => f.id === "steps")?.required, true);
  });
});
