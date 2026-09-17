import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Plus, ChevronRight } from "lucide-react";

import { useRunbooks, type HoldWindow, type HoldWindowEvent, type Runbook, type RunbookRunSummary } from "@/components/holds/useRunbooks";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const HAIRLINE = "rgba(255,255,255,.09)";

const PILLAR_COLOR: Readonly<Record<string, string>> = {
  governance: "#3B82F6",
  security: "#8B5CF6",
  compliance: "#F3F4F6",
  licensing: "#14B8A6",
  adoption: "#F97316",
  health: "#22C55E",
};

const HISTORY_TONE: Readonly<Record<string, { readonly ink: string; readonly bd: string; readonly label: string }>> = {
  complete: { ink: "#34d399", bd: "rgba(52,211,153,.3)", label: "Complete" },
  abandoned: { ink: "#94a3b8", bd: "rgba(148,163,184,.25)", label: "Abandoned" },
  active: { ink: "#60a5fa", bd: "rgba(96,165,250,.3)", label: "Active" },
};

/** `#rrggbb` + an alpha fraction → `rgba(...)`, so wire-supplied hex tones can reuse the same translucent-border/background look every other tone on this page uses. */
function rgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const [, r, g, b] = m;
  return `rgba(${parseInt(r, 16)},${parseInt(g, 16)},${parseInt(b, 16)},${alpha})`;
}

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

type Modal =
  | { readonly kind: "gated"; readonly runbook: Runbook }
  | { readonly kind: "addStep"; readonly runbook: Runbook }
  | { readonly kind: "extend"; readonly hold: HoldWindow }
  | { readonly kind: "prepareCr"; readonly hold: HoldWindow }
  | { readonly kind: "primary"; readonly hold: HoldWindow };

/**
 * Runbooks — its own standalone page (#4006, Shane's 2026-09-14 reversal of the
 * joint #1488/#1493 "fold into SOPs" decision). Design:
 * `Design/portal/design_handoff_full_site/screens/Runbooks.dc.html`, contract:
 * `docs/portal/runbooks-contract-pack.md`.
 *
 * Every row comes from `GET /api/portal/runbooks` via `useRunbooks` (#1557
 * shape: current-cycle steps + past-cycle run history). Ticking a step, adding
 * a step and the three hold-window decisions are the only writes; nothing here
 * executes against the tenant — a hold decision raises a change request and the
 * gated step runs only after approval.
 *
 * `SOPs.dc.html` still renders its own "Active Runbooks" sub-view — this page
 * and that view read the same tables, but this is the one live page reachable
 * from the Shell nav (`moduleNav.ts`); the SOPs sub-view has not been wired
 * separately. Not a duplicate implementation: one real page, one design source.
 */
export default function RunbooksPage() {
  const { payload, loaded, error, setStepChecked, addStep, extendHold, decideHold, loadHoldEvents } = useRunbooks();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [events, setEvents] = useState<readonly HoldWindowEvent[] | null>(null);
  const [eventsFor, setEventsFor] = useState<number | null>(null);

  const runbooks = payload?.runbooks ?? [];
  const selected = useMemo(
    () => runbooks.find((r) => r.id === selectedId) ?? runbooks[0] ?? null,
    [runbooks, selectedId],
  );

  useEffect(() => {
    const holdId = selected?.hold?.id ?? null;
    if (holdId === null) {
      setEvents(null);
      setEventsFor(null);
      return;
    }
    if (eventsFor === holdId) return;
    let active = true;
    void loadHoldEvents(holdId).then((result) => {
      if (active) {
        setEvents(result);
        setEventsFor(holdId);
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.hold?.id]);

  if (!loaded) {
    return (
      <div className="flex flex-col gap-[16px]" style={{ padding: "24px 30px 48px" }}>
        <Header />
        <div className="flex flex-col gap-[10px]">
          {["34%", "26%"].map((w, i) => (
            <div
              key={i}
              className="flex flex-col gap-[9px] rounded-[14px] border"
              style={{ borderColor: "rgba(255,255,255,.07)", background: "rgba(255,255,255,.02)", padding: 16 }}
            >
              <div className="h-[10px] rounded-full" style={{ width: w, background: "rgba(255,255,255,.07)" }} />
              <div className="h-[9px] w-[70%] rounded-full" style={{ background: "rgba(255,255,255,.05)" }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="flex flex-col gap-[16px]" style={{ padding: "24px 30px 48px" }}>
        <Header />
        <div
          className="flex gap-[10px] rounded-[12px] border border-dashed"
          style={{ borderColor: "rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)", padding: "14px 16px" }}
        >
          <div className="flex flex-col gap-[4px]">
            <span className="text-[13px] font-semibold" style={{ color: "#f8fafc" }}>
              Your runbooks could not be read
            </span>
            <span className="max-w-[620px] text-[12px] leading-[1.55]" style={{ color: "#94a3b8" }}>
              A failed read, not an empty list. Your cycles and hold windows are unchanged.
            </span>
          </div>
        </div>
      </div>
    );
  }

  const openHoldsCount = payload.holds.filter((h) => h.closedAt === null).length;

  return (
    <div className="relative flex min-h-0 flex-1" data-testid="runbooks-page">
      <div className="flex flex-1 flex-col gap-[16px] overflow-y-auto" style={{ padding: "24px 30px 48px", minWidth: 0 }}>
        <Header />

        {runbooks.length === 0 ? (
          <div
            className="flex flex-col gap-[8px] rounded-[14px] border"
            style={{ borderColor: "rgba(255,255,255,.09)", background: "rgba(255,255,255,.02)", padding: "20px 22px" }}
          >
            <span className="text-[13.5px] font-semibold" style={{ color: "#f8fafc" }}>
              No runbooks yet
            </span>
            <span className="max-w-[660px] text-[12px] leading-[1.6]" style={{ color: "#94a3b8" }}>
              This is a real, successful read: no runbook, no cycle and no hold window exists for your
              organisation. Runbooks are created when a review is started against your tenant — the Overshared
              SharePoint drill-down creates one per procedure kind the first time you open it.
            </span>
            <span className="text-[11px]" style={{ color: "#475569" }}>
              No hold windows
            </span>
          </div>
        ) : (
          <>
            {openHoldsCount > 0 ? (
              <div
                className="flex flex-wrap items-center gap-[12px] rounded-[12px] border"
                style={{ borderColor: "rgba(96,165,250,.3)", background: "rgba(96,165,250,.03)", padding: "11px 16px" }}
              >
                <span className="text-[10px] font-bold" style={{ letterSpacing: ".08em", color: "#60a5fa" }}>
                  {payload.summary.due ? `${payload.summary.due} DECISION DUE` : `${payload.summary.early} CAN CLOSE EARLY`}
                </span>
                <span className="min-w-[200px] flex-1 text-[12px] leading-[1.5]" style={{ color: "#cbd5e1" }}>
                  {payload.summary.text}
                </span>
              </div>
            ) : null}

            <div className="grid gap-[16px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
              <div className="flex flex-col gap-[8px]">
                {runbooks.map((rb) => (
                  <RunbookListCard key={rb.id} runbook={rb} selected={rb.id === selected?.id} onSelect={() => setSelectedId(rb.id)} />
                ))}
              </div>

              {selected ? (
                <div className="flex flex-col gap-[14px]">
                  <RunbookDetail
                    runbook={selected}
                    onToggleStep={setStepChecked}
                    onGated={() => setModal({ kind: "gated", runbook: selected })}
                    onAddStep={() => setModal({ kind: "addStep", runbook: selected })}
                    onExtend={(hold) => setModal({ kind: "extend", hold })}
                    onPrepareCr={(hold) => setModal({ kind: "prepareCr", hold })}
                    onPrimary={(hold) => setModal({ kind: "primary", hold })}
                    events={events}
                  />
                  <PastCyclesPanel history={selected.runHistory} />
                </div>
              ) : null}
            </div>
          </>
        )}

      </div>

      {modal?.kind === "gated" ? (
        <ConfirmModal
          title="This step waits on the hold window"
          body="It cannot be ticked while the window is open. Close the window early or release it below — either raises a change request and the step runs after approval."
          note="Nothing executes on click."
          cta="Understood"
          onConfirm={() => setModal(null)}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal?.kind === "addStep" ? (
        <AddStepModal runbook={modal.runbook} onClose={() => setModal(null)} onSave={addStep} />
      ) : null}

      {modal?.kind === "extend" ? (
        <ExtendHoldModal hold={modal.hold} onClose={() => setModal(null)} onExtend={extendHold} />
      ) : null}

      {modal?.kind === "prepareCr" ? (
        <ConfirmModal
          title="Prepare a change request"
          body="Raises a change request for the gated step now, with its approval ledger, without closing the window. The window keeps counting down."
          note="Returns the CR code once raised."
          cta="Prepare CR"
          onConfirm={async () => {
            const result = await decideHold(modal.hold.id, "prepare-cr");
            if (result) {
              toast.success(`Raised ${result.changeRequestCode}`);
              setModal(null);
            }
            return !!result;
          }}
          errorText="Could not prepare the change request. Try again."
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal?.kind === "primary" ? (
        <PrimaryDecisionModal hold={modal.hold} onClose={() => setModal(null)} onDecide={decideHold} />
      ) : null}
    </div>
  );
}

function Header() {
  return (
    <div className="flex flex-wrap items-center gap-[12px]">
      <span className="text-[20px] font-bold" style={{ color: "#f8fafc", letterSpacing: "-.01em" }}>
        Runbooks
      </span>
      <span
        title="Recurring procedures your organisation runs on a cycle, step by step. A hold window is a step that waits on elapsed time rather than on work; closing one early or releasing it raises a change request — nothing executes from here."
        className="flex size-[17px] cursor-help items-center justify-center rounded-full text-[10px] font-bold"
        style={{ border: "1px solid rgba(148,163,184,.35)", color: "#64748b" }}
      >
        i
      </span>
      <Link href="/sops" className="ml-auto flex items-center gap-[2px] text-[12px] font-semibold no-underline" style={{ color: "#60a5fa" }}>
        Procedure library <ChevronRight size={13} />
      </Link>
    </div>
  );
}

function RunbookListCard({
  runbook,
  selected,
  onSelect,
}: {
  readonly runbook: Runbook;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const pillarColor = PILLAR_COLOR[runbook.pillar] ?? "#60a5fa";
  const statusTone = runbook.hold ? runbook.hold.tone : runbook.statusLabel === "Complete" ? "#34d399" : "#60a5fa";

  return (
    <div
      onClick={onSelect}
      data-testid={`runbook-list-${runbook.id}`}
      className="flex cursor-pointer flex-col gap-[7px] rounded-[12px] border"
      style={{
        borderColor: selected ? "rgba(0,120,212,.5)" : HAIRLINE,
        background: selected ? "rgba(0,120,212,.06)" : "rgba(255,255,255,.015)",
        padding: "12px 14px",
      }}
    >
      <div className="flex flex-wrap items-center gap-[8px]">
        <span
          className="rounded-full text-[9.5px] font-bold"
          style={{ color: pillarColor, border: `1px solid ${rgba(pillarColor, 0.4)}`, letterSpacing: ".08em", padding: "2px 8px" }}
        >
          {runbook.pillar.toUpperCase()}
        </span>
        <span
          className="rounded-full text-[10px] font-semibold"
          style={{ color: statusTone, border: `1px solid ${rgba(statusTone, 0.4)}`, padding: "2px 9px" }}
        >
          {runbook.statusLabel}
        </span>
        <span className="ml-auto text-[10.5px]" style={{ color: "#64748b" }}>
          Day {runbook.daysElapsed} of {runbook.cycleDays}
          {runbook.recurring ? ` · cycle ${runbook.cycleNumber}` : ""}
        </span>
      </div>
      <span className="text-[12.5px] font-semibold leading-[1.4]" style={{ color: "#e2e8f0" }}>
        {runbook.title}
      </span>
      <div className="flex items-center gap-[10px]">
        <div className="h-[4px] flex-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.06)" }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${runbook.pct}%`, background: runbook.statusLabel === "Complete" ? "#34d399" : "#0078D4" }}
          />
        </div>
        <span className="flex-none whitespace-nowrap text-[10.5px]" style={{ color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>
          {runbook.checkedSteps}/{runbook.totalSteps}
        </span>
      </div>
    </div>
  );
}

function RunbookDetail({
  runbook,
  onToggleStep,
  onGated,
  onAddStep,
  onExtend,
  onPrepareCr,
  onPrimary,
  events,
}: {
  readonly runbook: Runbook;
  readonly onToggleStep: (runbookId: number, position: number, checked: boolean) => Promise<boolean>;
  readonly onGated: () => void;
  readonly onAddStep: () => void;
  readonly onExtend: (hold: HoldWindow) => void;
  readonly onPrepareCr: (hold: HoldWindow) => void;
  readonly onPrimary: (hold: HoldWindow) => void;
  readonly events: readonly HoldWindowEvent[] | null;
}) {
  const hold = runbook.hold;
  const daysLeftLine = `${Math.max(0, runbook.cycleDays - runbook.daysElapsed)} days left`;
  const spawnNote = runbook.recurring
    ? ` and starts cycle ${runbook.cycleNumber + 1} with the same steps, unticked`
    : "; this runbook does not recur";

  return (
    <>
      <div
        className="flex flex-col gap-[11px] rounded-[14px] border"
        style={{ borderColor: "rgba(255,255,255,.09)", background: "rgba(255,255,255,.02)", padding: "15px 20px 14px" }}
      >
        <div className="flex flex-col gap-[3px]">
          <div className="flex flex-wrap items-center gap-[8px]">
            <span className="text-[14px] font-bold" style={{ color: "#f8fafc", letterSpacing: "-.01em" }}>
              {runbook.title}
            </span>
            <span
              className="rounded-full text-[10px] font-semibold"
              style={{ color: "#94a3b8", background: "rgba(148,163,184,.08)", border: "1px solid rgba(148,163,184,.22)", padding: "2px 8px" }}
            >
              {runbook.recurring ? `Recurring · every ${runbook.cycleDays} days` : "One cycle only"}
            </span>
          </div>
          <span className="text-[11.5px] leading-[1.5]" style={{ color: "#94a3b8" }}>
            {runbook.context}
          </span>
          <span className="text-[10.5px]" style={{ color: "#64748b" }}>
            Cycle {runbook.cycleNumber} · started {runbook.startedOn ? shortDate(runbook.startedOn) : "—"} · day{" "}
            {runbook.daysElapsed} of {runbook.cycleDays} · {daysLeftLine}
          </span>
        </div>

        <div className="flex flex-col" style={{ borderTop: "1px solid rgba(255,255,255,.07)" }}>
          {runbook.steps.map((s) => {
            const gated = hold?.gatesStepPosition === s.position && !s.checked;
            const meta = s.checked
              ? `ticked ${s.checkedAt ? shortDate(s.checkedAt) : ""}`.trim()
              : gated
                ? "waits on the hold window"
                : s.isCustom
                  ? "your step"
                  : "not yet";
            return (
              <div
                key={s.position}
                className="flex items-start gap-[11px]"
                style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.05)" }}
              >
                <button
                  type="button"
                  onClick={() => (gated ? onGated() : void onToggleStep(runbook.id, s.position, !s.checked))}
                  data-testid={`runbook-${runbook.id}-step-${s.position}`}
                  className="mt-[2px] flex size-[15px] flex-none items-center justify-center rounded text-[9px] font-bold text-white"
                  style={{
                    border: `1px solid ${s.checked ? "#0078D4" : "rgba(255,255,255,.22)"}`,
                    background: s.checked ? "#0078D4" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  {s.checked ? "✓" : ""}
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span
                    className="text-[12.5px] leading-[1.45]"
                    style={{ color: s.checked ? "#94a3b8" : "#e2e8f0", textDecoration: s.checked ? "line-through" : "none" }}
                  >
                    {s.position}. {s.text}
                  </span>
                  <span className="text-[10.5px]" style={{ color: "#64748b" }}>
                    {meta}
                  </span>
                </div>
                {gated ? (
                  <span
                    className="flex-none whitespace-nowrap rounded-full text-[10px] font-semibold"
                    style={{ color: hold ? hold.tone : "#c2a63d", border: `1px solid ${rgba(hold ? hold.tone : "#c2a63d", 0.4)}`, padding: "2px 8px" }}
                  >
                    Waits on the hold below
                  </span>
                ) : null}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-[10px] pt-[10px]">
            <span className="max-w-[420px] text-[11px] leading-[1.5]" style={{ color: "#475569" }}>
              Your own steps carry into the next cycle. Ticking the last open step completes the cycle{spawnNote}.
            </span>
            <button
              type="button"
              onClick={onAddStep}
              data-testid={`runbook-${runbook.id}-add-step`}
              className="ml-auto flex items-center gap-[6px] whitespace-nowrap rounded-[6px] text-[11.5px] font-semibold hover:bg-white/[.05]"
              style={{ color: "#cbd5e1", border: "1px solid rgba(255,255,255,.14)", padding: "6px 11px" }}
            >
              <Plus size={12} /> Add a step
            </button>
          </div>
        </div>
      </div>

      {hold ? (
        <HoldPanel hold={hold} events={events} onExtend={() => onExtend(hold)} onPrepareCr={() => onPrepareCr(hold)} onPrimary={() => onPrimary(hold)} />
      ) : null}
    </>
  );
}

function HoldPanel({
  hold,
  events,
  onExtend,
  onPrepareCr,
  onPrimary,
}: {
  readonly hold: HoldWindow;
  readonly events: readonly HoldWindowEvent[] | null;
  readonly onExtend: () => void;
  readonly onPrepareCr: () => void;
  readonly onPrimary: () => void;
}) {
  const extendedLine = hold.extendedDays ? `+${hold.extendedDays} days, beside the agreed wait` : "None";

  return (
    <div
      className="flex flex-col gap-[11px] rounded-[14px] border"
      style={{ borderColor: rgba(hold.tone, 0.35), background: rgba(hold.tone, 0.04), padding: "15px 20px 14px" }}
      data-testid={`hold-${hold.id}`}
    >
      <div className="flex flex-wrap items-center gap-[10px]">
        <span className="text-[10px] font-bold" style={{ letterSpacing: ".08em", color: hold.tone }}>
          {hold.badge}
        </span>
        <span className="text-[11px]" style={{ color: "#94a3b8", fontFamily: "ui-monospace, Menlo, monospace" }}>
          {hold.tMinus}
        </span>
        <span className="ml-auto text-[10.5px]" style={{ color: "#64748b" }}>
          {hold.gates}
        </span>
      </div>
      <span className="text-[13px] font-semibold" style={{ color: "#f8fafc" }}>
        {hold.title}
      </span>
      <span className="text-[11.5px] leading-[1.55]" style={{ color: "#94a3b8" }}>
        {hold.why}
      </span>
      <div className="flex gap-[3px]">
        {hold.ticks.map((t, i) => (
          <span
            key={i}
            className="h-[6px] flex-1 rounded-[2px]"
            style={{ background: t === "done" ? "#34d399" : t === "partial" ? "rgba(52,211,153,.4)" : "rgba(255,255,255,.08)" }}
          />
        ))}
      </div>
      <div className="grid gap-[10px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <Fact label="AGREED WAIT" value={`${hold.waitDays} days`} />
        <Fact label="EXTENDED" value={extendedLine} />
        <Fact label="CLOSES" value={shortDate(hold.closesAt)} />
      </div>
      <div className="flex flex-col gap-[2px]" style={{ borderTop: "1px solid rgba(255,255,255,.07)", paddingTop: 10 }}>
        <span className="text-[12px]" style={{ color: hold.scanTone }}>
          {hold.scanLabel} — {hold.scanLine}
        </span>
        <span className="text-[10.5px]" style={{ color: "#64748b" }}>
          {hold.scanProvenance}
        </span>
      </div>
      <div
        className="flex flex-wrap items-center gap-[8px]"
        style={{ borderTop: "1px solid rgba(255,255,255,.07)", paddingTop: 11 }}
      >
        <span className="min-w-[200px] flex-1 text-[11px] leading-[1.5]" style={{ color: "#475569" }}>
          Every decision raises a change request with its approval ledger; the gated step runs after approval, never on
          click.
        </span>
        <button
          type="button"
          onClick={onExtend}
          className="whitespace-nowrap rounded-[6px] text-[11.5px] font-semibold hover:bg-white/[.05]"
          style={{ color: "#cbd5e1", border: "1px solid rgba(255,255,255,.14)", padding: "6px 11px" }}
        >
          Extend
        </button>
        <button
          type="button"
          onClick={onPrepareCr}
          className="whitespace-nowrap rounded-[6px] text-[11.5px] font-semibold hover:bg-white/[.05]"
          style={{ color: "#cbd5e1", border: "1px solid rgba(255,255,255,.14)", padding: "6px 11px" }}
        >
          Prepare CR
        </button>
        <button
          type="button"
          onClick={onPrimary}
          className="whitespace-nowrap rounded-[6px] text-[11.5px] font-semibold text-white"
          style={{ background: hold.tone, padding: "6px 12px" }}
        >
          {hold.primaryAction.label}
        </button>
      </div>
      {events && events.length > 0 ? (
        <div className="flex flex-col gap-[5px]" style={{ borderTop: "1px solid rgba(255,255,255,.07)", paddingTop: 10 }}>
          <span className="text-[9px] font-bold" style={{ letterSpacing: ".09em", color: "#475569" }}>
            WHAT HAS HAPPENED TO THIS WINDOW
          </span>
          {events.map((ev, i) => (
            <div key={i} className="flex items-baseline gap-[10px]">
              <span className="w-[64px] flex-none text-[10.5px]" style={{ color: "#64748b" }}>
                {shortDate(ev.createdAt)}
              </span>
              <span className="flex-1 text-[11.5px] leading-[1.5]" style={{ color: "#cbd5e1" }}>
                {eventText(ev)}
              </span>
              {ev.changeRequestCode ? (
                <span className="flex-none text-[10.5px]" style={{ color: "#60a5fa", fontFamily: "ui-monospace, Menlo, monospace" }}>
                  {ev.changeRequestCode}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function eventText(ev: HoldWindowEvent): string {
  switch (ev.kind) {
    case "extended":
      return `Extended by ${ev.daysDelta ?? 0} days${ev.reason ? ` — "${ev.reason}"` : ""}`;
    case "closed_early":
      return `Closed early${ev.reason ? ` — "${ev.reason}"` : ""}`;
    case "released":
      return `Released${ev.reason ? ` — "${ev.reason}"` : ""}`;
    case "cr_prepared":
      return `Change request prepared${ev.reason ? ` — "${ev.reason}"` : ""}`;
    default:
      return ev.kind;
  }
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-[9px] font-bold" style={{ letterSpacing: ".09em", color: "#475569" }}>
        {label}
      </span>
      <span className="text-[12px]" style={{ color: "#e2e8f0" }}>
        {value}
      </span>
    </div>
  );
}

function PastCyclesPanel({ history }: { readonly history: readonly RunbookRunSummary[] }) {
  return (
    <div
      className="flex flex-col rounded-[14px] border"
      style={{ borderColor: "rgba(255,255,255,.09)", background: "rgba(255,255,255,.02)", padding: "6px 20px 12px" }}
    >
      <div className="flex items-center gap-[10px]" style={{ padding: "12px 0 6px" }}>
        <span className="text-[13px] font-semibold" style={{ color: "#f8fafc" }}>
          Past cycles
        </span>
        <span className="text-[11px]" style={{ color: "#64748b" }}>
          {history.length ? `${history.length} finished · newest first · ticks frozen` : "none yet"}
        </span>
      </div>
      {history.length === 0 ? (
        <span
          className="block text-[11.5px] leading-[1.55]"
          style={{ color: "#94a3b8", borderTop: "1px solid rgba(255,255,255,.06)", padding: "12px 0 4px" }}
        >
          This is the first cycle. Each finished cycle keeps its own ticks permanently and appears here.
        </span>
      ) : (
        history.map((h) => {
          const tone = HISTORY_TONE[h.status] ?? HISTORY_TONE.active;
          return (
            <div
              key={h.id}
              className="flex items-center gap-[12px]"
              style={{ padding: "9px 0", borderTop: "1px solid rgba(255,255,255,.06)" }}
            >
              <span className="w-[66px] flex-none text-[12px]" style={{ color: "#e2e8f0" }}>
                Cycle {h.cycleNumber}
              </span>
              <span className="flex-1 text-[11px]" style={{ color: "#94a3b8" }}>
                {shortDate(h.startedOn)} → {h.completedAt ? shortDate(h.completedAt) : "—"}
              </span>
              <span className="text-[11px]" style={{ color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>
                {h.checkedSteps}/{h.totalSteps}
              </span>
              <span
                className="flex-none rounded-full text-[10px] font-semibold"
                style={{ color: tone.ink, border: `1px solid ${tone.bd}`, padding: "2px 8px" }}
              >
                {tone.label}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

function ConfirmModal({
  title,
  body,
  note,
  cta,
  errorText,
  onConfirm,
  onClose,
}: {
  readonly title: string;
  readonly body: string;
  readonly note: string;
  readonly cta: string;
  readonly errorText?: string;
  readonly onConfirm: () => void | Promise<boolean | void>;
  readonly onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = async () => {
    if (submitting) return;
    setSubmitting(true);
    setFailed(false);
    const result = await onConfirm();
    setSubmitting(false);
    if (result === false) setFailed(true);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-[12.5px] leading-[1.6]" style={{ color: "#94a3b8" }}>
          {body}
        </p>
        <p className="text-[11.5px] leading-[1.55]" style={{ color: "#c2a63d" }}>
          {note}
        </p>
        {failed ? <p className="text-[12px]" style={{ color: "#f87171" }}>{errorText}</p> : null}
        <DialogFooter>
          <Button onClick={() => void run()} disabled={submitting}>
            {submitting ? "Working…" : cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddStepModal({
  runbook,
  onClose,
  onSave,
}: {
  readonly runbook: Runbook;
  readonly onClose: () => void;
  readonly onSave: (runbookId: number, text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const submit = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    const ok = await onSave(runbook.id, text.trim());
    setSaving(false);
    if (ok) {
      toast.success("Step added");
      onClose();
    } else {
      setSaveError("Could not add that step. Try again.");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="runbooks-add-step-dialog">
        <DialogHeader>
          <DialogTitle>Add a step to &ldquo;{runbook.title}&rdquo;</DialogTitle>
        </DialogHeader>
        <p className="text-[12.5px] leading-[1.6]" style={{ color: "#94a3b8" }}>
          Saved as your own step on the current cycle and carried into every future cycle once this one completes.
        </p>
        <div className="flex flex-col gap-[6px]">
          <span className="text-[11px] font-semibold" style={{ color: "#94a3b8" }}>
            Step
          </span>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="e.g. Post the summary to the governance channel"
          />
        </div>
        <p className="text-[11.5px]" style={{ color: "#c2a63d" }}>
          1 to 500 characters · up to 200 steps per cycle.
        </p>
        {saveError ? <p className="text-[12px]" style={{ color: "#f87171" }}>{saveError}</p> : null}
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!text.trim() || saving}>
            {saving ? "Adding…" : "Add step"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExtendHoldModal({
  hold,
  onClose,
  onExtend,
}: {
  readonly hold: HoldWindow;
  readonly onClose: () => void;
  readonly onExtend: (holdId: number, days: number, reason: string) => Promise<boolean>;
}) {
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const parsedDays = Number(days);
  const valid = Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 90 && reason.trim().length > 0;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setSaveError(null);
    const ok = await onExtend(hold.id, parsedDays, reason.trim());
    setSaving(false);
    if (ok) {
      toast.success(`Extended by ${parsedDays} day${parsedDays === 1 ? "" : "s"}`);
      onClose();
    } else {
      setSaveError("Could not extend that window. Try again.");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="runbooks-extend-hold-dialog">
        <DialogHeader>
          <DialogTitle>Extend the hold window</DialogTitle>
        </DialogHeader>
        <p className="text-[12.5px] leading-[1.6]" style={{ color: "#94a3b8" }}>
          Adds days beside the agreed wait — the agreed figure itself is never rewritten. The T-24h and T-0
          reminders reset so they fire again against the new close.
        </p>
        <div className="flex flex-col gap-[6px]">
          <span className="text-[11px] font-semibold" style={{ color: "#94a3b8" }}>
            Days (1–90)
          </span>
          <Input type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
        </div>
        <div className="flex flex-col gap-[6px]">
          <span className="text-[11px] font-semibold" style={{ color: "#94a3b8" }}>
            Reason · required
          </span>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Why more time is needed"
          />
        </div>
        <p className="text-[11.5px]" style={{ color: "#c2a63d" }}>
          1 to 90 days · a reason is required and kept on the window's record.
        </p>
        {saveError ? <p className="text-[12px]" style={{ color: "#f87171" }}>{saveError}</p> : null}
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!valid || saving}>
            {saving ? "Extending…" : "Extend"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PrimaryDecisionModal({
  hold,
  onClose,
  onDecide,
}: {
  readonly hold: HoldWindow;
  readonly onClose: () => void;
  readonly onDecide: (
    holdId: number,
    decision: "close-early" | "release" | "prepare-cr",
    body?: { note?: string },
  ) => Promise<{ changeRequestCode: string } | null>;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const kind = hold.primaryAction.kind;
  const decision: "close-early" | "release" = kind === "close_early" ? "close-early" : "release";
  const title = kind === "close_early" ? "Close early" : "Release the gated step";
  const body =
    kind === "close_early"
      ? "The window will be closed and a change request raised with its approval ledger materialised. The gated step runs after that approval, not now."
      : "The window will be closed and a change request raised with its approval ledger materialised. The gated step runs after approval, not now.";
  const note2 =
    kind === "close_early"
      ? "Closing early is only accepted while the scan verdict is clear; the server checks that itself."
      : "The agreed wait is never rewritten; extensions accumulate beside it.";

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const result = await onDecide(hold.id, decision, { note: note.trim() || undefined });
    setSubmitting(false);
    if (result) {
      toast.success(`Raised ${result.changeRequestCode}`);
      onClose();
    } else {
      setSubmitError("Could not record that decision. Try again.");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="runbooks-primary-decision-dialog">
        <DialogHeader>
          <DialogTitle>{title} — &ldquo;{hold.title}&rdquo;</DialogTitle>
        </DialogHeader>
        <p className="text-[12.5px] leading-[1.6]" style={{ color: "#94a3b8" }}>
          {body}
        </p>
        <div className="flex flex-col gap-[6px]">
          <span className="text-[11px] font-semibold" style={{ color: "#94a3b8" }}>
            Note (optional)
          </span>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} />
        </div>
        <p className="text-[11.5px]" style={{ color: "#c2a63d" }}>
          {note2}
        </p>
        {submitError ? <p className="text-[12px]" style={{ color: "#f87171" }}>{submitError}</p> : null}
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? "Working…" : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
