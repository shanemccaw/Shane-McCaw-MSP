/**
 * ccCreateChangeRequest.ts — the one place the customer portal turns a
 * remediation into a real change request.
 *
 * The handoff's first rule (see `FixPanel.tsx`'s header): "Nothing changes in
 * the tenant without a CR. Every fix, every accepted risk, every executed SOP
 * ... routes through the fix panel → CR step → submit." Two surfaces raise
 * those CRs — the fix panel and the SOP hub's Execute buttons — and until this
 * module existed BOTH only ran a local `setTimeout` animation over a hardcoded
 * `CR-2026-0186` code, calling no endpoint at all. This module is the wiring:
 * both build a body here and POST it through the ONE real route,
 * `POST /api/portal/change-control` (api-server `routes/portal-change-control.ts`).
 *
 * ── Authority is the server's, not ours ─────────────────────────────────────
 * The route recomputes `risk` and `workload` server-side and ignores anything
 * the client sends for them — `risk` decides how many approvals a change needs,
 * so a client that could name its own risk could name its way past the gate
 * (see the route's own header). So this module deliberately sends only what a
 * customer legitimately chose — the finding/procedure, the window, the blast
 * radius it can state — and NEVER a risk, a workload, a status or an approver.
 * `target` is sent because the server derives the workload FROM it; the value
 * itself is descriptive, not authority-bearing.
 *
 * ── Single-step creation ONLY ───────────────────────────────────────────────
 * This raises a CR and stops. The route writes every new CR as
 * `pending_approval` with no approver and no execution, and exposes NO
 * approve/reject/rollback/execute mutation — verified against the route, not
 * assumed. So a raised CR does NOT run against the tenant; it waits for an
 * approval step that is separate, later work (blocked on the multi-tenant
 * Dev→Test→Prod decision). The success copy the two callers show reflects that
 * honestly rather than repeating the prototype's fictional "approved, both
 * signatures in".
 *
 * ── Entitlement (Git #1168) ─────────────────────────────────────────────────
 * CR creation is ALWAYS real and unconditional. Nothing here — and nothing on
 * the route — gates the POST behind the Change Control add-on. What an
 * entitlement changes is only the downstream visibility/approval UI, never
 * whether the record gets created. This module must never grow such a gate.
 */

import type { FixIntent } from "./FixPanel";
import type { FixPlaybook } from "./fixPanelLibrary";

/** The three change classes the route's `changeClass` enum accepts. */
export type CreateChangeClass = "Standard" | "Normal" | "Emergency";

/**
 * Exactly the fields `createSchema` in `routes/portal-change-control.ts`
 * accepts. Nothing authority-bearing is here on purpose — see the header.
 */
export interface CreateChangeRequestInput {
  readonly title: string;
  readonly target: string;
  readonly ticket?: string;
  readonly pre?: string;
  readonly post: string;
  readonly changeClass: CreateChangeClass;
  readonly impactedUsersCount: number;
  readonly window: string;
}

/** The route's 201 body: the code it assigned and the authority it computed. */
export interface ChangeRequestCreated {
  readonly code: string;
  readonly risk: string;
  readonly workload: string;
}

export type CreateChangeRequestResult =
  | { readonly ok: true; readonly created: ChangeRequestCreated }
  | { readonly ok: false; readonly error: string };

/**
 * The emergency window's exact label, from `CR_WINDOWS` in `fixPanelLibrary.ts`.
 * A CR raised into it is an Emergency change — it runs outside a window and is
 * approved retrospectively, which the panel already warns about. Compared by
 * value rather than threaded as a boolean so the single source of the label
 * stays `fixPanelLibrary.ts`.
 */
const EMERGENCY_WINDOW_LABEL = "Emergency change";

/** The window an SOP execution is booked into — the drawer has no window picker. */
export const SOP_EXECUTION_WINDOW = "Next available window";

export function isEmergencyWindow(window: string): boolean {
  return window.trim() === EMERGENCY_WINDOW_LABEL;
}

/**
 * The "Executed by" line the CR step shows, kept here so the value stored in
 * the proposed payload and the value on screen cannot drift. Copy is the
 * prototype's, verbatim (`FixPanel.tsx`'s `intentLabel`).
 */
export function executedByLabel(intent: FixIntent): string {
  return intent === "graph"
    ? "Microsoft Graph, automated by the portal"
    : intent === "manual"
      ? "You, following the runbook by hand"
      : "Shane McCaw Consulting, under your retainer";
}

/**
 * A fix-panel playbook + the customer's chosen window/route → the create body.
 *
 * `target` is the change's plain-language title: the fix panel has no Graph
 * resource path of its own (the playbook is a remediation, not a request the
 * customer typed a target into), and the route's `deriveWorkload` falls back to
 * Identity for anything it cannot classify — its documented, honest default.
 * `impactedUsersCount` is 0 because a finding does not quantify its blast
 * radius; sending a made-up number would be worse, and the route needs the
 * field present (it is not optional).
 */
export function changeRequestBodyForPlaybook(
  playbook: FixPlaybook,
  opts: { window: string; intent: FixIntent },
): CreateChangeRequestInput {
  const emergency = isEmergencyWindow(opts.window);
  const steps = opts.intent === "manual" ? playbook.manualSteps.map((s) => s.text) : playbook.graphSteps;
  const post = JSON.stringify(
    {
      change: playbook.title,
      runbook: playbook.sopRef,
      executedBy: executedByLabel(opts.intent),
      steps,
      outcome: playbook.resultSummary,
    },
    null,
    2,
  );
  return {
    title: playbook.title,
    target: playbook.title,
    post,
    changeClass: emergency ? "Emergency" : "Normal",
    impactedUsersCount: 0,
    window: opts.window,
  };
}

/** The minimum an SOP has to describe itself as a change. */
export interface SopExecutionInput {
  readonly code: string;
  readonly title: string;
  readonly category: string;
  readonly mode: "all" | "auto";
  readonly steps: ReadonlyArray<{ readonly text: string; readonly endpoint?: string; readonly isGraph?: boolean }>;
}

/**
 * A selected SOP + the chosen execution mode → the create body.
 *
 * `target` prefers the first step that carries a real Graph endpoint (so the
 * route classifies the workload from a genuine resource path where one exists),
 * and otherwise names the procedure — never blank, which the route rejects.
 * `changeClass` is Normal: an SOP run books into the next window like any normal
 * change, and the drawer offers no emergency route.
 */
export function changeRequestBodyForSop(sop: SopExecutionInput): CreateChangeRequestInput {
  const endpointStep = sop.steps.find((s) => (s.endpoint ?? "").trim().length > 0);
  const target = endpointStep?.endpoint?.trim() || `${sop.code} · ${sop.title}`;
  const post = JSON.stringify(
    {
      procedure: sop.code,
      title: sop.title,
      mode: sop.mode === "auto" ? "Automated steps only" : "Full execution",
      steps: sop.steps.map((s) => s.text),
    },
    null,
    2,
  );
  return {
    title: sop.title,
    target,
    post,
    changeClass: "Normal",
    impactedUsersCount: 0,
    window: SOP_EXECUTION_WINDOW,
  };
}

/**
 * The New menu's three change-control creators (Change request / Emergency change
 * / Standard change) → the create body. Unlike the playbook/SOP builders these
 * start from what the customer TYPED into the shared FormDrawer, so this maps the
 * drawer's field values straight onto `createSchema`'s fields and nothing else.
 *
 * `changeClass` is fixed by which menu item opened the form, never typed — an
 * Emergency raised from the "Change request" item would be a lie about which gate
 * it went through. The window is likewise item-derived where the item has no
 * window field: Emergency runs outside a window (the retrospective-approval path
 * the panel warns about), Standard books into the next available window from the
 * pre-approved catalogue.
 */
export type NewMenuChangeKind = "change-request" | "emergency-change" | "standard-change";

export function changeRequestBodyFromNewMenu(
  values: Record<string, string>,
  kind: NewMenuChangeKind,
): CreateChangeRequestInput {
  const changeClass: CreateChangeClass =
    kind === "emergency-change" ? "Emergency" : kind === "standard-change" ? "Standard" : "Normal";

  // The window is only typed on a Normal change; the other two are item-derived.
  const typedWindow = (values.window ?? "").trim();
  const window =
    kind === "emergency-change"
      ? EMERGENCY_WINDOW_LABEL
      : kind === "standard-change"
        ? typedWindow || SOP_EXECUTION_WINDOW
        : typedWindow;

  const impacted = Number.parseInt((values.impactedUsersCount ?? "").trim(), 10);

  return {
    title: (values.title ?? "").trim(),
    target: (values.target ?? "").trim(),
    ticket: (values.ticket ?? "").trim() || undefined,
    pre: (values.pre ?? "").trim() || undefined,
    post: (values.post ?? "").trim(),
    changeClass,
    impactedUsersCount: Number.isFinite(impacted) && impacted >= 0 ? impacted : 0,
    window,
  };
}

type FetchWithAuth = (
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: { silent?: boolean },
) => Promise<Response>;

const CHANGE_CONTROL_URL = "/api/portal/change-control";

/**
 * POST a create body through the real route and return a discriminated result.
 *
 * Uses `{ silent: true }` so `fetchWithAuth`'s global error toast does not fire:
 * both callers render the failure inline in their own slide-over, which is far
 * better feedback for a raise-a-change flow than a toast that outlives the
 * panel. The route answers 201 on success; anything else carries an `error`
 * string this surfaces verbatim.
 */
export async function postChangeRequest(
  fetchWithAuth: FetchWithAuth,
  input: CreateChangeRequestInput,
): Promise<CreateChangeRequestResult> {
  try {
    const res = await fetchWithAuth(
      CHANGE_CONTROL_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      { silent: true },
    );
    if (res.status === 201) {
      const created = (await res.json()) as ChangeRequestCreated;
      return { ok: true, created };
    }
    let error = `The change request could not be raised (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body && typeof body.error === "string" && body.error.trim()) error = body.error;
    } catch {
      /* non-JSON body — keep the status-coded message */
    }
    return { ok: false, error };
  } catch {
    return {
      ok: false,
      error: "The change request could not be raised. Check your connection and try again.",
    };
  }
}
