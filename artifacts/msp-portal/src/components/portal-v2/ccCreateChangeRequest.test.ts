/**
 * ccCreateChangeRequest.test.ts — the fix-panel / SOP-hub → CR create mapping.
 *
 * Run with: npx tsx --test src/components/portal-v2/ccCreateChangeRequest.test.ts
 *
 * Two things are worth pinning here, because both are load-bearing for
 * correctness and safety rather than cosmetics:
 *
 *  1. The bodies NEVER carry authority. `risk`, `workload`, `status` and an
 *     approver are the route's to compute/set — a client that could send its
 *     own risk could name its way past the approval gate (see the route header).
 *     Several assertions below check those keys are absent from the built body.
 *  2. The Emergency window is the ONE thing that flips `changeClass`, and it is
 *     matched by the exact label `fixPanelLibrary.ts` uses. If that label drifts
 *     out of sync, an emergency change silently files as Normal — so it is
 *     pinned to a literal here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FixPlaybook } from "./fixPanelLibrary";
import {
  changeRequestBodyForPlaybook,
  changeRequestBodyForSop,
  executedByLabel,
  isEmergencyWindow,
  postChangeRequest,
  SOP_EXECUTION_WINDOW,
  type CreateChangeRequestInput,
} from "./ccCreateChangeRequest";

const PLAYBOOK: FixPlaybook = {
  key: "gov-anon-links",
  title: "Expire the anonymous sharing links",
  pillarColor: "#3B82F6",
  description: "Anonymous links never expire.",
  canAutomate: true,
  sopRef: "SOP-GOV-04 · External sharing link hygiene",
  riskText: "Links in circulation stop at the expiry.",
  rewardText: "Open-ended access becomes time-bound.",
  manualSteps: [{ text: "Open the SharePoint admin centre." }, { text: "Set expiry to 30 days." }],
  graphSteps: ["Authenticating with Microsoft Graph", "Applying the 30-day expiry"],
  resultSummary: "Anonymous link expiry set to 30 days.",
};

const NORMAL_WINDOW = "Thu 27 Aug · 07:00–09:00";

/** No authority-bearing key may ever appear on a create body. */
function assertNoAuthorityFields(body: CreateChangeRequestInput): void {
  for (const forbidden of ["risk", "workload", "status", "approvedBy", "riskLevel"]) {
    assert.equal(forbidden in body, false, `create body must not carry '${forbidden}'`);
  }
}

describe("changeRequestBodyForPlaybook", () => {
  it("carries the finding's title and window, a zero blast radius, and no authority", () => {
    const body = changeRequestBodyForPlaybook(PLAYBOOK, { window: NORMAL_WINDOW, intent: "graph" });
    assert.equal(body.title, PLAYBOOK.title);
    assert.equal(body.target, PLAYBOOK.title);
    assert.equal(body.window, NORMAL_WINDOW);
    assert.equal(body.impactedUsersCount, 0);
    assert.equal(body.changeClass, "Normal");
    assertNoAuthorityFields(body);
  });

  it("flips changeClass to Emergency ONLY for the emergency window label", () => {
    const emergency = changeRequestBodyForPlaybook(PLAYBOOK, {
      window: "Emergency change",
      intent: "graph",
    });
    assert.equal(emergency.changeClass, "Emergency");
    const normal = changeRequestBodyForPlaybook(PLAYBOOK, { window: NORMAL_WINDOW, intent: "graph" });
    assert.equal(normal.changeClass, "Normal");
  });

  it("puts the graph steps in the proposed payload for the graph route", () => {
    const body = changeRequestBodyForPlaybook(PLAYBOOK, { window: NORMAL_WINDOW, intent: "graph" });
    const post = JSON.parse(body.post) as { change: string; runbook: string; executedBy: string; steps: string[]; outcome: string };
    assert.equal(post.change, PLAYBOOK.title);
    assert.equal(post.runbook, PLAYBOOK.sopRef);
    assert.equal(post.executedBy, "Microsoft Graph, automated by the portal");
    assert.deepEqual(post.steps, PLAYBOOK.graphSteps);
    assert.equal(post.outcome, PLAYBOOK.resultSummary);
  });

  it("puts the MANUAL steps in the payload for the manual route", () => {
    const body = changeRequestBodyForPlaybook(PLAYBOOK, { window: NORMAL_WINDOW, intent: "manual" });
    const post = JSON.parse(body.post) as { executedBy: string; steps: string[] };
    assert.equal(post.executedBy, "You, following the runbook by hand");
    assert.deepEqual(post.steps, ["Open the SharePoint admin centre.", "Set expiry to 30 days."]);
  });
});

describe("changeRequestBodyForSop", () => {
  const STEPS = [
    { text: "Look up the user", endpoint: "", isGraph: false },
    { text: "Revoke sessions", endpoint: "POST /v1.0/users/{id}/revokeSignInSessions", isGraph: true },
  ];

  it("names the procedure, books the next window, and stays Normal with no authority", () => {
    const body = changeRequestBodyForSop({
      code: "SOP-IDN-01",
      title: "Revoke a user's sessions",
      category: "Identity",
      mode: "all",
      steps: STEPS,
    });
    assert.equal(body.title, "Revoke a user's sessions");
    assert.equal(body.window, SOP_EXECUTION_WINDOW);
    assert.equal(body.changeClass, "Normal");
    assert.equal(body.impactedUsersCount, 0);
    assertNoAuthorityFields(body);
  });

  it("prefers a real Graph endpoint as the target so the route can classify the workload", () => {
    const body = changeRequestBodyForSop({
      code: "SOP-IDN-01",
      title: "Revoke a user's sessions",
      category: "Identity",
      mode: "all",
      steps: STEPS,
    });
    assert.equal(body.target, "POST /v1.0/users/{id}/revokeSignInSessions");
  });

  it("falls back to code · title when no step carries an endpoint", () => {
    const body = changeRequestBodyForSop({
      code: "SOP-DOC-09",
      title: "Quarterly access review",
      category: "Governance",
      mode: "all",
      steps: [{ text: "Read the report", endpoint: "", isGraph: false }],
    });
    assert.equal(body.target, "SOP-DOC-09 · Quarterly access review");
  });

  it("records the execution mode in the proposed payload", () => {
    const auto = changeRequestBodyForSop({ code: "S", title: "T", category: "C", mode: "auto", steps: STEPS });
    const all = changeRequestBodyForSop({ code: "S", title: "T", category: "C", mode: "all", steps: STEPS });
    assert.equal((JSON.parse(auto.post) as { mode: string }).mode, "Automated steps only");
    assert.equal((JSON.parse(all.post) as { mode: string }).mode, "Full execution");
  });
});

describe("small helpers", () => {
  it("isEmergencyWindow matches only the exact label, trimmed", () => {
    assert.equal(isEmergencyWindow("Emergency change"), true);
    assert.equal(isEmergencyWindow("  Emergency change  "), true);
    assert.equal(isEmergencyWindow("Thu 27 Aug · 07:00–09:00"), false);
  });

  it("executedByLabel maps all three routes", () => {
    assert.equal(executedByLabel("graph"), "Microsoft Graph, automated by the portal");
    assert.equal(executedByLabel("manual"), "You, following the runbook by hand");
    assert.equal(executedByLabel("shane"), "Shane McCaw Consulting, under your retainer");
  });
});

describe("postChangeRequest", () => {
  const body = changeRequestBodyForPlaybook(PLAYBOOK, { window: NORMAL_WINDOW, intent: "graph" });

  it("returns ok + the created CR on a 201, and sends the body verbatim to the route", async () => {
    let seenUrl: unknown = null;
    let seenBody: unknown = null;
    const fetchWithAuth = async (url: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = url;
      seenBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ code: "CR-2026-141", risk: "High", workload: "Conditional Access" }), {
        status: 201,
      });
    };
    const result = await postChangeRequest(fetchWithAuth, body);
    assert.equal(seenUrl, "/api/portal/change-control");
    assert.deepEqual(seenBody, body);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.created.code, "CR-2026-141");
      assert.equal(result.created.risk, "High");
    }
  });

  it("surfaces the route's error string on a non-201", async () => {
    const fetchWithAuth = async () =>
      new Response(JSON.stringify({ error: "This account has no connected Microsoft 365 tenant" }), {
        status: 409,
      });
    const result = await postChangeRequest(fetchWithAuth, body);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "This account has no connected Microsoft 365 tenant");
  });

  it("fails closed with a readable message when the request throws", async () => {
    const fetchWithAuth = async () => {
      throw new Error("network down");
    };
    const result = await postChangeRequest(fetchWithAuth, body);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /could not be raised/);
  });
});
