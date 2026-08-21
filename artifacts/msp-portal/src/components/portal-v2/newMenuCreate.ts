/**
 * newMenuCreate.ts — turns the shell "New" menu's items into real creation.
 *
 * The New menu (shell/shellMenus.ts) used to only NAVIGATE to a module. The items
 * that have a real backend now open the portal's ONE form primitive
 * (`useFormDrawer()` / `openForm()` from FormDrawer.tsx) and, on submit, POST
 * through the real route — no new drawer mechanism, no fake animation, no
 * fabricated reference code (the trap #1013/the CR-2026-0186 removal already
 * cleaned out of FixPanel/SOP Execute).
 *
 * Four items are wired here because four have a real create endpoint today:
 *   • Change request / Emergency change / Standard change → POST /portal/change-control
 *     (via ccCreateChangeRequest.ts — changeClass fixed by which item opened it).
 *   • Procedure (SOP) → POST /portal/sops (via sopCreate.ts — a manual, non-runnable
 *     definition).
 *
 * The other three New-menu items (Freeze window, Ownership row, Webhook endpoint)
 * have NO create backend — portal-ownership.ts and portal-sops.ts' hold-window
 * siblings are read/extend-only, and there is no portal webhooks route at all — so
 * they are deliberately left to navigate to their module rather than opening a
 * form that could not save. `NEW_CREATE_KIND_FOR` returns null for them.
 */

import type { FormSpec } from "./FormDrawer";
import {
  changeRequestBodyFromNewMenu,
  postChangeRequest,
  type NewMenuChangeKind,
} from "./ccCreateChangeRequest";
import { postSop, sopBodyFromNewMenu } from "./sopCreate";

export type NewCreateKind = NewMenuChangeKind | "sop";

type FetchWithAuth = (
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: { silent?: boolean },
) => Promise<Response>;

export interface NewCreateDeps {
  readonly fetchWithAuth: FetchWithAuth;
  /** Called with the failure message when a real POST comes back non-2xx. */
  readonly onError?: (message: string) => void;
}

/**
 * Map a New-menu item's label to the create kind it raises, or null when the item
 * has no real create backend (see the header). Keyed on the design's own verbatim
 * labels (shellMenus.ts), so a copy change there is the single source.
 */
export function newCreateKindForLabel(label: string): NewCreateKind | null {
  switch (label) {
    case "Change request":
      return "change-request";
    case "Emergency change":
      return "emergency-change";
    case "Standard change":
      return "standard-change";
    case "Procedure":
      return "sop";
    default:
      // Freeze window, Ownership row, Webhook endpoint — no create backend.
      return null;
  }
}

/**
 * Fire the real POST for a submitted form. Returns a discriminated result the
 * caller can log; the FormDrawer itself flips to its (static) done panel the
 * moment onSubmit is invoked, matching the design's optimistic form primitive, so
 * a failure is surfaced through `deps.onError` rather than by holding the panel.
 */
export async function submitNewCreate(
  kind: NewCreateKind,
  values: Record<string, string>,
  deps: NewCreateDeps,
): Promise<{ ok: boolean; error?: string }> {
  if (kind === "sop") {
    const result = await postSop(deps.fetchWithAuth, sopBodyFromNewMenu(values));
    if (!result.ok) deps.onError?.(result.error);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }
  const result = await postChangeRequest(deps.fetchWithAuth, changeRequestBodyFromNewMenu(values, kind));
  if (!result.ok) deps.onError?.(result.error);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/* ── The four FormSpecs ─────────────────────────────────────────────────────
 * Field ids are exactly the create-body field names the mappers read
 * (title/target/window/impactedUsersCount/ticket/pre/post for a CR; title/
 * category/description/steps/estimatedMinutes for an SOP), so there is no
 * translation layer between what the drawer collects and what the route gets.
 */

function changeRequestSpec(onSubmit: FormSpec["onSubmit"]): FormSpec {
  return {
    kicker: "New change request",
    title: "Raise a change request",
    intro:
      "Nine fields to get it on the register. Impact, rollback and test can be filled in after — but it cannot be approved until they are, and nothing runs against your tenant until it is approved and the window opens.",
    submitLabel: "Add to the register",
    fields: [
      { id: "title", label: "Title", required: true, placeholder: "e.g. Block legacy authentication for all mailboxes", wide: true },
      { id: "target", label: "What it changes", required: true, placeholder: "The workload, resource or group", hint: "The register classifies the change and its risk from this." },
      { id: "window", label: "Change window", required: true, placeholder: "e.g. Saturday 02:00–04:00" },
      { id: "impactedUsersCount", label: "Users affected", inputType: "number", required: true, placeholder: "0", hint: "Your best estimate of the blast radius." },
      { id: "ticket", label: "Ticket reference", required: false, placeholder: "Optional PSA / ticket id" },
      { id: "pre", label: "State before the change", kind: "textarea", required: false, wide: true, placeholder: "What the tenant looks like now, so the rollback is exact." },
      { id: "post", label: "What the change does", kind: "textarea", required: true, wide: true, placeholder: "The steps, and what success looks like." },
    ],
    graphNote: "INSERT msp_change_requests · status pending_approval · risk computed server-side",
    doneTitle: "Change request raised",
    doneNote:
      "It is on the change register as pending approval. Nothing executes against your tenant until it is approved and the window opens.",
    onSubmit,
  };
}

function emergencyChangeSpec(onSubmit: FormSpec["onSubmit"]): FormSpec {
  return {
    kicker: "Emergency change",
    title: "Raise an emergency change",
    intro:
      "For something already broken. Four fields now, the full record inside 24 hours, and a retrospective approval before the clock runs out. Using this path when nothing is broken is the fastest way to lose it.",
    submitLabel: "Raise it now · start the 24-hour clock",
    fields: [
      { id: "title", label: "Title", required: true, placeholder: "What is broken and what you are changing", wide: true },
      { id: "target", label: "What it changes", required: true, placeholder: "The workload, resource or group" },
      { id: "impactedUsersCount", label: "Users affected", inputType: "number", required: true, placeholder: "0" },
      { id: "post", label: "What the change does", kind: "textarea", required: true, wide: true, placeholder: "The steps you are taking now." },
    ],
    graphNote: "INSERT msp_change_requests · changeClass Emergency · status pending_approval",
    doneTitle: "Emergency change raised",
    doneNote:
      "It is on the register as pending approval and the 24-hour documentation clock has started. The pre-change state is captured the moment you raise it, so the rollback is exact rather than remembered.",
    onSubmit,
  };
}

function standardChangeSpec(onSubmit: FormSpec["onSubmit"]): FormSpec {
  return {
    kicker: "Standard change · pre-approved",
    title: "Log a standard change",
    intro:
      "A pre-approved change from the catalogue. No peer review and no approval step — but it still lands on the register and in the audit log.",
    submitLabel: "Add to the register",
    fields: [
      { id: "title", label: "Title", required: true, placeholder: "The catalogue change you are running", wide: true },
      { id: "target", label: "What it changes", required: true, placeholder: "The workload, resource or group" },
      { id: "window", label: "Change window", required: false, placeholder: "Next available window" },
      { id: "post", label: "What the change does", kind: "textarea", required: true, wide: true, placeholder: "The catalogue steps." },
    ],
    graphNote: "INSERT msp_change_requests · changeClass Standard · status pending_approval",
    doneTitle: "Standard change logged",
    doneNote:
      "It is on the register and in the audit log. A pre-approved change carries its own impact and rollback from the catalogue.",
    onSubmit,
  };
}

function sopSpec(onSubmit: FormSpec["onSubmit"]): FormSpec {
  return {
    kicker: "New procedure",
    title: "Write an SOP",
    intro:
      "A procedure your team can follow by hand. It goes into your library under “Written by your team” as your own reference — it will not run against your tenant.",
    submitLabel: "Save to the library",
    fields: [
      { id: "title", label: "Title", required: true, placeholder: "e.g. Onboard a new starter", wide: true },
      { id: "category", label: "Category", required: true, placeholder: "e.g. Incident Response, Identity & Access, Mail Flow" },
      { id: "estimatedMinutes", label: "Estimated minutes", inputType: "number", required: false, placeholder: "Optional" },
      { id: "description", label: "What this procedure is for", kind: "textarea", required: true, wide: true, placeholder: "When your team should run it, and what it achieves." },
      { id: "steps", label: "Steps", kind: "textarea", required: true, wide: true, placeholder: "One step per line.", hint: "Written as a manual runbook. Automated (Graph) steps are added by your MSP, not here." },
    ],
    graphNote: "INSERT msp_sops · automation manual · non-runnable",
    doneTitle: "Procedure saved",
    doneNote:
      "It is in your SOP library under “Written by your team”. It is a manual reference and does not run against your tenant — a runnable SOP is authored by your MSP.",
    onSubmit,
  };
}

/** Build the FormSpec for a create kind, with its onSubmit wired to the real POST. */
export function formSpecForNewCreate(kind: NewCreateKind, deps: NewCreateDeps): FormSpec {
  const onSubmit: FormSpec["onSubmit"] = (values) => {
    void submitNewCreate(kind, values, deps);
  };
  switch (kind) {
    case "change-request":
      return changeRequestSpec(onSubmit);
    case "emergency-change":
      return emergencyChangeSpec(onSubmit);
    case "standard-change":
      return standardChangeSpec(onSubmit);
    case "sop":
      return sopSpec(onSubmit);
  }
}
