/**
 * useChangeControl.ts — the Change Control module's state machine.
 *
 * A faithful port of the design's `Component` state and flow handlers (the logic
 * class at the bottom of `Change Control.dc.html`). The design keeps everything
 * in one `setState`-merging component; this hook does the same with a single
 * state object and a `patch()` updater, and exposes the reusable flow builders
 * (`signForm` / `exceptionForm` / `moveForm`) plus the generic form engine the
 * page's forms all run through.
 *
 * ── The data seam (the REGISTER is live; the rest is not) ──────────────────
 * `GET /api/portal/change-control` (api-server `routes/portal-change-control.ts`,
 * customer-scoped from the JWT) now backs the register, the record and the
 * calendar's change-request markers, through `ccChangeControlWire.ts`. The
 * fixtures in `ccPageData.ts` remain as the fallback — a failed or unscoped
 * fetch renders the design's own five change requests rather than an empty
 * page — and `dataState` says which of the two is on screen, so nothing has to
 * infer it from the row count.
 *
 * What is NOT wired, because it has no table to be wired to: the change
 * CATALOGUE, the freeze windows, the CAB agenda and the notification rules.
 * A grep of `lib/db/src/schema/msp.ts` finds no catalogue, freeze-window,
 * agenda or notification-rule table — only `msp_change_requests` (the register)
 * and the portal's own runbook/hold-window tables, which are a different
 * build's subject and explicitly out of scope here. Those four stay on the
 * design's fixtures and are reported as fixtures rather than dressed up.
 *
 * ── Writes are still UI-only ───────────────────────────────────────────────
 * Every form's onSubmit still returns a client-side patch (a moved window, an
 * added agenda item, an edited notification rule) and a toast — exactly what
 * the prototype does. No approval, no rejection, no rollback and no scheduling
 * is sent anywhere: the route deliberately exposes no such mutation, and
 * building the approval gate is separate, later work.
 *
 * ── The view seam ──────────────────────────────────────────────────────────
 * `viewParam` is the URL segment (`/portal-v2/change-control/<view>`), which the
 * shell's nav sub-items and the deep-linkable policy view drive. It syncs into
 * `state.view`, resetting the record/focus/stat-filter selection the way the
 * prototype's componentDidUpdate does when its `view` prop changes. Internal
 * navigation (opening a record, jumping to the briefing from a decision) moves
 * `state.view` without touching the URL, matching the prototype.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";

import type { AgendaItem, ChangeRequest, FreezeRow, NotifRule } from "./ccPageData";
import { CC_CAB, CC_CAL_EVENTS, CC_CRS, CC_FIXTURE_CUSTOMER_ORG, CC_FREEZE, CC_FREEZES, CC_NOTIF, CC_STAT_SETS, CC_WINDOW_DAY } from "./ccPageData";
import type { WireChangeControlPayload, WireChangeControlStats, WireChangeRequest } from "./ccChangeControlWire";
import { calEventsFor, deriveStatSets, toChangeRequests } from "./ccChangeControlWire";

const CHANGE_CONTROL_URL = "/api/portal/change-control";

/** Which of the two sources the page is currently rendering. */
export type CcDataState = "loading" | "live" | "fixture";

export interface CcDraft {
  title: string;
  desc: string;
  just: string;
  scope: string;
  deps: string;
  priority: string;
  risk: string;
  sec: string;
  comp: string;
}

export type FormKind = "text" | "area" | "pick" | "select" | "toggle";

export interface FormFieldDef {
  readonly k: string;
  readonly label: string;
  readonly kind: FormKind;
  readonly req?: boolean;
  readonly ph?: string;
  readonly hint?: string;
  readonly options?: readonly string[];
  readonly toggleLabel?: string;
}

export interface FormCfg {
  readonly kicker: string;
  readonly title: string;
  readonly intro: string;
  readonly submitLabel: string;
  readonly foot?: string;
  readonly values?: Record<string, unknown>;
  readonly fields: readonly FormFieldDef[];
  readonly onSubmit?: (v: Record<string, unknown>) => Partial<CcState> | void;
  readonly done: string | ((v: Record<string, unknown>) => string);
}

export interface FormState {
  readonly cfg: FormCfg;
  readonly vals: Record<string, unknown>;
}

export interface CcState {
  view: string;
  lastList: string;
  openCode: string | null;
  sec: string;
  focusCode: string | null;
  statFilter: string | null;
  query: string;
  fRisk: string;
  fState: string;
  fWork: string;
  freezeException: boolean;
  freezeOpen: boolean;
  calMonth: number;
  calDay: string | null;
  catQ: string;
  catCat: string;
  catOpen: string | null;
  intakeOpen: boolean;
  intakeMode: string;
  draft: CcDraft;
  form: FormState | null;
  toast: string;
  freezesOv: FreezeRow[] | null;
  agendaOv: AgendaItem[] | null;
  notifOv: NotifRule[] | null;
  movedOv: Record<string, string> | null;
}

const INITIAL_DRAFT: CcDraft = {
  title: "",
  desc: "",
  just: "",
  scope: "",
  deps: "",
  priority: "Normal",
  risk: "Medium",
  sec: "",
  comp: "",
};

function initialState(view: string): CcState {
  return {
    view,
    lastList: "briefing",
    openCode: null,
    sec: "request",
    focusCode: null,
    statFilter: null,
    query: "",
    fRisk: "All risk",
    fState: "All states",
    fWork: "All workloads",
    freezeException: false,
    freezeOpen: false,
    calMonth: 0,
    calDay: null,
    catQ: "",
    catCat: "All",
    catOpen: null,
    intakeOpen: false,
    intakeMode: "normal",
    draft: INITIAL_DRAFT,
    form: null,
    toast: "",
    freezesOv: null,
    agendaOv: null,
    notifOv: null,
    movedOv: null,
  };
}

export interface CcController {
  readonly s: CcState;
  readonly role: "approver";
  readonly patch: (p: Partial<CcState>) => void;
  readonly t: (msg: string) => void;
  readonly clearToast: () => void;
  readonly setDraft: (k: keyof CcDraft, v: string) => void;
  readonly openForm: (cfg: FormCfg) => void;
  readonly setFV: (k: string, v: unknown) => void;
  readonly submitForm: () => void;
  readonly closeForm: () => void;
  readonly signForm: (code: string, window: string) => void;
  readonly exceptionForm: (code: string) => void;
  readonly moveForm: (code: string) => void;
  /**
   * Separation of duties: is the current logged-in account the one that RAISED
   * this change? Resolved against real identity (the JWT's email/name), never a
   * tenant-name string match — the account that submits a change can never be
   * the account that signs it off. See the implementation for the live vs.
   * fixture-fallback split.
   */
  readonly isSubmitter: (cr: ChangeRequest) => boolean;
  readonly freezes: () => FreezeRow[];
  readonly agenda: () => AgendaItem[];
  readonly notif: () => NotifRule[];
  /**
   * The register's change requests: the tenant's real ones once loaded, the
   * design's fixtures until then or if the read fails. Same accessor idiom as
   * `freezes`/`agenda`/`notif` above, so a view does not need to know which.
   */
  readonly crs: () => readonly ChangeRequest[];
  /** Stat-card filter sets, derived from live rows or the design's literal map. */
  readonly statSets: () => Record<string, readonly string[]>;
  /** Freeze-calendar day markers, including live change-request windows. */
  readonly calEvents: () => Record<string, ReadonlyArray<{ label: string; tone: string }>>;
  /** The server-computed stat totals (open/awaiting/next-window/emergency/snapshots), or null on fixtures. */
  readonly wireStats: () => WireChangeControlStats | null;
  readonly dataState: CcDataState;
}

export function useChangeControl(opts: { viewParam?: string } = {}): CcController {
  const initialView = opts.viewParam || "briefing";
  const [s, setS] = useState<CcState>(() => initialState(initialView));

  const patch = useCallback((p: Partial<CcState>) => {
    setS((prev) => ({ ...prev, ...p }));
  }, []);

  // View seam: sync the URL segment into state.view, resetting the record/focus
  // selection the way the prototype's componentDidUpdate does.
  const prevViewParam = useRef<string | undefined>(opts.viewParam);
  useEffect(() => {
    const vp = opts.viewParam || "briefing";
    if (vp !== prevViewParam.current) {
      prevViewParam.current = opts.viewParam;
      setS((prev) =>
        prev.view === vp ? prev : { ...prev, view: vp, openCode: null, statFilter: null, focusCode: null },
      );
    }
  }, [opts.viewParam]);

  // ── The register read ──────────────────────────────────────────────────────
  // `fetchWithAuth` is rebuilt on every silent token refresh, so it is held in
  // a ref rather than a dependency array — the same rule every polling hook in
  // this codebase follows (BUILD_PLAN §5.4). This read is one-shot rather than
  // polled: a change request moves when a human moves it, not on a clock.
  const { fetchWithAuth, user } = useAuth();
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;

  // The real, logged-in identity — the two claims a submitter can be recorded
  // under. `portal-change-control.ts` writes `requestedBy = req.user.email` on
  // every CR raised from the portal, so email is the primary key for "did I
  // raise this?"; name is a secondary match for older/MSP-raised rows that
  // stored a display name instead of an address.
  const viewerEmail = (user?.email ?? "").trim().toLowerCase();
  const viewerName = (user?.name ?? "").trim().toLowerCase();

  const [wire, setWire] = useState<WireChangeControlPayload | null>(null);
  const [dataState, setDataState] = useState<CcDataState>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchRef.current(CHANGE_CONTROL_URL);
        if (!res.ok) throw new Error(`change-control read failed: ${res.status}`);
        const payload = (await res.json()) as WireChangeControlPayload;
        if (cancelled) return;
        // A tenant whose M365 identifier does not resolve (the route's
        // fail-closed path, `scoped: false`) cannot be attributed any real
        // rows — that is not the tenant's own answer, so the design's fixtures
        // stay on screen and `dataState` reports "fixture" so nothing claims
        // otherwise. But a SCOPED tenant with zero rows is a real, honest
        // answer — "this tenant genuinely has no change requests" — and gets
        // treated as live with an empty set rather than papered over with the
        // design's worked example.
        if (!payload || !Array.isArray(payload.requests) || !payload.scoped) {
          setWire(null);
          setDataState("fixture");
          return;
        }
        setWire(payload);
        setDataState("live");
      } catch {
        if (!cancelled) {
          setWire(null);
          setDataState("fixture");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const liveCrs = useRef<{ key: readonly WireChangeRequest[]; value: ChangeRequest[] } | null>(null);
  const crs = useCallback((): readonly ChangeRequest[] => {
    if (!wire) return CC_CRS;
    if (liveCrs.current?.key !== wire.requests) {
      liveCrs.current = { key: wire.requests, value: toChangeRequests(wire) };
    }
    return liveCrs.current.value;
  }, [wire]);

  const statSets = useCallback((): Record<string, readonly string[]> => {
    return wire ? deriveStatSets(crs()) : CC_STAT_SETS;
  }, [wire, crs]);

  const calEvents = useCallback((): Record<string, ReadonlyArray<{ label: string; tone: string }>> => {
    if (!wire) return CC_CAL_EVENTS;
    // The design's own markers stay: they carry the Microsoft-change and freeze
    // annotations the register knows nothing about. Live change-request windows
    // are merged in on top, per day.
    const live = calEventsFor(crs(), wire.requests);
    const merged: Record<string, Array<{ label: string; tone: string }>> = {};
    for (const [k, v] of Object.entries(CC_CAL_EVENTS)) merged[k] = [...v];
    for (const [k, v] of Object.entries(live)) merged[k] = [...(merged[k] || []), ...v];
    return merged;
  }, [wire, crs]);

  const wireStats = useCallback((): WireChangeControlStats | null => wire?.stats ?? null, [wire]);

  const t = useCallback((msg: string) => setS((prev) => ({ ...prev, toast: msg })), []);
  const clearToast = useCallback(() => setS((prev) => ({ ...prev, toast: "" })), []);

  const setDraft = useCallback((k: keyof CcDraft, v: string) => {
    setS((prev) => ({ ...prev, draft: { ...prev.draft, [k]: v } }));
  }, []);

  const openForm = useCallback((cfg: FormCfg) => {
    setS((prev) => ({ ...prev, form: { cfg, vals: { ...(cfg.values || {}) } } }));
  }, []);

  const setFV = useCallback((k: string, v: unknown) => {
    setS((prev) => (prev.form ? { ...prev, form: { cfg: prev.form.cfg, vals: { ...prev.form.vals, [k]: v } } } : prev));
  }, []);

  const closeForm = useCallback(() => setS((prev) => ({ ...prev, form: null })), []);

  const submitForm = useCallback(() => {
    setS((prev) => {
      const f = prev.form;
      if (!f) return prev;
      const extra = (f.cfg.onSubmit && f.cfg.onSubmit(f.vals)) || {};
      const done = typeof f.cfg.done === "function" ? f.cfg.done(f.vals) : f.cfg.done || "Saved.";
      return { ...prev, form: null, toast: done, ...extra };
    });
  }, []);

  // ── Reusable flow builders (proto signForm / exceptionForm / moveForm) ──────

  const signForm = useCallback(
    (code: string, window: string) => {
      openForm({
        kicker: "Approval · " + code,
        title: "Sign and schedule " + code,
        intro:
          "Your signature is what schedules it. It records the account, the time, and the exact payload you approved — an edit after this point invalidates it.",
        submitLabel: "Sign and schedule",
        foot: "Separation of duties: the submitter cannot sign, and the record refuses an attempt.",
        values: { agree: false, window, note: "" },
        fields: [
          { k: "agree", label: "Signature", kind: "toggle", req: true, toggleLabel: "I approve this change, its rollback plan and its window" },
          { k: "window", label: "Window", kind: "text", req: true, hint: "Change it here if you want it run at a different time." },
          { k: "note", label: "Condition or note", kind: "area", req: false, ph: "Optional. e.g. Go ahead only if the Finance export dry run passes at 21:00." },
        ],
        done: (v) =>
          code +
          " signed and scheduled for " +
          String(v.window) +
          "." +
          (String(v.note || "").trim() ? " Your condition is on the record and the engineer sees it before they start." : ""),
      });
    },
    [openForm],
  );

  const exceptionForm = useCallback(
    (code: string) => {
      openForm({
        kicker: "Freeze exception",
        title: "Grant an exception for " + code,
        intro:
          "An exception is a narrow hole in the freeze, for one change, with an expiry. It is the freeze owner's call and it is logged as such.",
        submitLabel: "Grant the exception",
        foot: "Emergency changes are already exempt. This is for a planned change you have decided cannot wait.",
        values: { authority: false, reason: "", expiry: "The change window only" },
        fields: [
          { k: "authority", label: "Authority", kind: "toggle", req: true, toggleLabel: "I am the freeze owner, or acting with their written authority" },
          { k: "reason", label: "Why this cannot wait", kind: "area", req: true, ph: "e.g. Microsoft enforces legacy auth off on 1 October. Waiting until 1 September leaves no room for a rollback and a retry." },
          { k: "expiry", label: "Exception expires", kind: "pick", options: ["The change window only", "End of the freeze", "24 hours"], req: true },
        ],
        onSubmit: () => ({ freezeException: true }),
        done: (v) =>
          "Exception granted for " +
          code +
          ", valid for " +
          String(v.expiry).toLowerCase() +
          ". Your name, your reason and the expiry are on the record.",
      });
    },
    [openForm],
  );

  const moveForm = useCallback(
    (code: string) => {
      openForm({
        kicker: "Reschedule",
        title: "Move " + code + " out of the freeze",
        intro:
          "Pick a window outside the freeze. The original window and the reason for moving stay on the record, so the delay is explained rather than mysterious.",
        submitLabel: "Move the window",
        values: { window: "Tue 1 September · 21:00–23:00", reason: "Inside the ERP go-live freeze" },
        fields: [
          { k: "window", label: "New window", kind: "pick", options: ["Tue 1 September · 21:00–23:00", "Wed 2 September · 21:00–23:00", "Tue 8 September · 21:00–23:00"], req: true, hint: "All three sit inside your Tue–Thu policy and outside the freeze." },
          { k: "reason", label: "Reason for the move", kind: "area", req: true },
        ],
        onSubmit: (v) => ({ movedOv: { ...(s.movedOv || {}), [code]: String(v.window) } }),
        done: (v) => code + " moved to " + String(v.window) + ". The freeze collision is cleared and the original window is still on the record.",
      });
    },
    [openForm, s.movedOv],
  );

  const freezes = useCallback(() => s.freezesOv || (CC_FREEZES as FreezeRow[]), [s.freezesOv]);
  const agenda = useCallback(() => s.agendaOv || (CC_CAB.agenda as AgendaItem[]), [s.agendaOv]);
  const notif = useCallback(() => s.notifOv || (CC_NOTIF as NotifRule[]), [s.notifOv]);

  const isSubmitter = useCallback(
    (cr: ChangeRequest): boolean =>
      viewerIsSubmitter(cr, { dataState, viewerEmail, viewerName }),
    [dataState, viewerEmail, viewerName],
  );

  return {
    s,
    role: "approver",
    patch,
    t,
    clearToast,
    setDraft,
    openForm,
    setFV,
    submitForm,
    closeForm,
    signForm,
    exceptionForm,
    moveForm,
    isSubmitter,
    freezes,
    agenda,
    notif,
    crs,
    statSets,
    calEvents,
    wireStats,
    dataState,
  };
}

/**
 * Separation of duties, as a pure predicate so it can be unit-tested away from
 * the hook and React. Answers "did the current viewer raise this change?" —
 * the account that submits a change can never be the account that approves it.
 *
 * LIVE data resolves this from real identity. `portal-change-control.ts` writes
 * `requestedBy = req.user.email` on every CR raised from the portal, and
 * `ccChangeControlWire` maps that straight onto `submitter.name`, so a live
 * change is the viewer's own exactly when its recorded submitter matches the
 * viewer's email (primary) or name (secondary, for older/MSP-raised rows that
 * stored a display name). An unattributable submitter yields `false` — the
 * safe default, and the page exposes no real approve mutation regardless.
 *
 * FIXTURE fallback reproduces the design worked-example's demo: the prototype
 * casts the viewer as the customer's IT Director and blocks approval on the one
 * change the customer's own side raised. That turns on the example's own
 * customer org (`CC_FIXTURE_CUSTOMER_ORG`), read from the fixtures — never a
 * tenant-name literal in live logic.
 */
export function viewerIsSubmitter(
  cr: { approvals: { submitter: { name: string; org: string } } },
  ctx: { dataState: CcDataState; viewerEmail: string; viewerName: string },
): boolean {
  if (ctx.dataState === "live") {
    const submitter = (cr.approvals.submitter.name ?? "").trim().toLowerCase();
    if (!submitter) return false;
    return (
      (ctx.viewerEmail !== "" && submitter === ctx.viewerEmail) ||
      (ctx.viewerName !== "" && submitter === ctx.viewerName)
    );
  }
  return cr.approvals.submitter.org.indexOf(CC_FIXTURE_CUSTOMER_ORG) >= 0;
}

/** proto inFreeze against live state (freeze always active in this UI-only build). */
export function stateInFreeze(code: string, movedOv: Record<string, string> | null): boolean {
  if ((movedOv || {})[code]) return false;
  const d = CC_WINDOW_DAY[code];
  return !!d && d >= CC_FREEZE.from && d <= CC_FREEZE.to;
}
