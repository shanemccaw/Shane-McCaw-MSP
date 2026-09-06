import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { useRunbooks, type HoldWindow, type Runbook } from "@/components/holds/useRunbooks";
import {
  PanelCta,
  PanelKVRow,
  PanelNote,
  PanelTextarea,
  SlidePanel,
} from "@/components/shell/SlidePanel";

const HAIRLINE = "rgba(255,255,255,.09)";

const PILLAR_COLOR: Readonly<Record<string, string>> = {
  governance: "#3B82F6",
  security: "#8B5CF6",
  compliance: "#F3F4F6",
  licensing: "#14B8A6",
  adoption: "#F97316",
  health: "#22C55E",
};

const STATUS_TONE: Readonly<Record<string, string>> = {
  "On track": "#34d399",
  Complete: "#60a5fa",
  Holding: "#c2a63d",
  "Decision due": "#f87171",
  "Clear to close early": "#22d3ee",
  Overdue: "#f87171",
};

/** `#rrggbb` + an alpha fraction → `rgba(...)`, so wire-supplied hex tones can reuse the same translucent-border/background look every other tone on this page uses. */
function rgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const [, r, g, b] = m;
  return `rgba(${parseInt(r, 16)},${parseInt(g, 16)},${parseInt(b, 16)},${alpha})`;
}

/**
 * Active Runbooks (#2994, carried forward from #1730/#1488). Design:
 * `Design/portal/design_handoff_full_site/screens/SOPs.dc.html`
 * (`view: "runbooks"`), contract: `docs/runbooks-contract-pack.md`.
 *
 * Every row comes from `GET /api/portal/runbooks` via `useRunbooks` — real,
 * already correct, previously wired to zero pages (contract pack §0). This
 * is that page. Ticking a step, adding a step and the three hold-window
 * decisions are the only writes; nothing here executes against the tenant —
 * a hold decision raises a change request and the gated step runs only
 * after approval (contract pack §1.8).
 */
export default function RunbooksPage() {
  const { payload, loaded, error, now, setStepChecked, addStep, decideHold } = useRunbooks();

  type Panel =
    | { readonly kind: "addStep"; readonly runbook: Runbook }
    | { readonly kind: "hold"; readonly hold: HoldWindow };
  const [panel, setPanel] = useState<Panel | null>(null);

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
        <EmptyPanel title="Could not load" body={error ?? "Your runbooks could not be loaded."} />
      </div>
    );
  }

  const openHolds = payload.holds.filter((h) => h.closedAt === null);

  return (
    <div className="relative flex min-h-0 flex-1" data-testid="runbooks-page">
      <div
        className="flex flex-1 flex-col gap-[16px] overflow-y-auto"
        style={{ padding: "24px 30px 48px", minWidth: 0 }}
      >
        <Header />

        {payload.runbooks.length === 0 ? (
          <EmptyPanel
            title="No active runbooks"
            body="Runbooks start from a site fix or a recurring review — not from this page."
          />
        ) : (
          <div className="flex flex-col gap-[14px]">
            {payload.runbooks.map((rb) => (
              <RunbookCard
                key={rb.id}
                runbook={rb}
                now={now}
                onToggleStep={setStepChecked}
                onAddStep={() => setPanel({ kind: "addStep", runbook: rb })}
                onOpenHold={(hold) => setPanel({ kind: "hold", hold })}
              />
            ))}
          </div>
        )}

        {openHolds.length > 0 ? (
          <div className="flex flex-col gap-[10px]">
            <div className="flex items-baseline gap-[10px]">
              <span className="text-[13.5px] font-semibold" style={{ color: "#f8fafc" }}>
                Hold windows
              </span>
              <span className="text-[11px]" style={{ color: "#64748b" }}>
                {payload.summary.text}
              </span>
            </div>
            {openHolds.map((h) => (
              <HoldCard key={h.id} hold={h} now={now} onOpen={() => setPanel({ kind: "hold", hold: h })} />
            ))}
          </div>
        ) : null}

        <span className="max-w-[760px] text-[10.5px] leading-[1.5]" style={{ color: "#475569" }}>
          Each cycle keeps its own ticks now, so a new cycle starts clean without erasing what the last one
          recorded. Releasing a hold raises a change request; nothing executes from this page.
        </span>
      </div>

      {panel?.kind === "addStep" ? (
        <AddStepPanel runbook={panel.runbook} onClose={() => setPanel(null)} onSave={addStep} />
      ) : null}
      {panel?.kind === "hold" ? (
        <HoldDetailPanel hold={panel.hold} now={now} onClose={() => setPanel(null)} onDecide={decideHold} />
      ) : null}
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-[12px]">
      <span className="text-[20px] font-bold" style={{ color: "#f8fafc", letterSpacing: "-.01em" }}>
        Active runbooks
      </span>
      <span
        title="Recurring review cycles with step checklists. Holds gate a step on elapsed time."
        className="flex size-[17px] items-center justify-center rounded-full text-[10px] font-bold"
        style={{ border: "1px solid rgba(148,163,184,.35)", color: "#64748b" }}
      >
        i
      </span>
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="flex flex-col items-center gap-[5px] rounded-[12px] border border-dashed text-center"
      style={{ borderColor: "rgba(148,163,184,.25)", padding: 26 }}
    >
      <span className="text-[12.5px] font-semibold" style={{ color: "#cbd5e1" }}>
        {title}
      </span>
      <span className="max-w-[520px] text-[11.5px] leading-[1.55]" style={{ color: "#64748b" }}>
        {body}
      </span>
    </div>
  );
}

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function RunbookCard({
  runbook,
  now,
  onToggleStep,
  onAddStep,
  onOpenHold,
}: {
  readonly runbook: Runbook;
  readonly now: Date;
  readonly onToggleStep: (runbookId: number, position: number, checked: boolean) => Promise<boolean>;
  readonly onAddStep: () => void;
  readonly onOpenHold: (hold: HoldWindow) => void;
}) {
  const pillarColor = PILLAR_COLOR[runbook.pillar] ?? "#60a5fa";
  const statusTone = STATUS_TONE[runbook.statusLabel] ?? "#94a3b8";
  const hold = runbook.hold;
  void now; // holds re-derive on the shared 30s tick upstream; the card itself has nothing time-based of its own.

  return (
    <div
      className="rounded-[14px] border"
      style={{ borderColor: HAIRLINE, background: "rgba(255,255,255,.02)", padding: "15px 18px 14px" }}
      data-testid={`runbook-${runbook.id}`}
    >
      <div className="flex flex-wrap items-center gap-[9px]">
        <span className="text-[13px] font-semibold" style={{ color: "#f8fafc" }}>
          {runbook.title}
        </span>
        <span
          className="rounded-full text-[9.5px] font-bold"
          style={{ color: pillarColor, border: `1px solid ${rgba(pillarColor, 0.4)}`, letterSpacing: ".08em", padding: "2px 8px" }}
        >
          {titleCase(runbook.pillar)}
        </span>
        <span
          className="rounded-full text-[10px] font-semibold"
          style={{ color: statusTone, border: `1px solid ${rgba(statusTone, 0.4)}`, padding: "2px 9px" }}
        >
          {runbook.statusLabel}
        </span>
        <span className="ml-auto text-[11px]" style={{ color: "#64748b" }}>
          Day {runbook.daysElapsed} of {runbook.cycleDays}
        </span>
      </div>

      <div className="mt-[10px] flex items-center gap-[10px]">
        <div className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.08)" }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${runbook.pct}%`, background: "linear-gradient(90deg,#0078D4,#00B4D8)" }}
          />
        </div>
        <span className="flex-none text-[11px]" style={{ color: "#94a3b8" }}>
          {runbook.checkedSteps} of {runbook.totalSteps} steps
        </span>
      </div>

      <div className="mt-[6px] flex flex-col">
        {runbook.steps.map((s) => {
          const gated = hold?.gatesStepPosition === s.position;
          return (
            <div
              key={s.position}
              className="flex items-center gap-[10px]"
              style={{ padding: "7.5px 0", borderTop: "1px solid rgba(255,255,255,.05)" }}
            >
              <button
                type="button"
                onClick={() => void onToggleStep(runbook.id, s.position, !s.checked)}
                data-testid={`runbook-${runbook.id}-step-${s.position}`}
                className="flex size-4 flex-none items-center justify-center rounded text-[10px] font-bold text-white"
                style={{
                  border: `1px solid ${s.checked ? "#0078D4" : "rgba(255,255,255,.18)"}`,
                  background: s.checked ? "#0078D4" : "transparent",
                }}
              >
                {s.checked ? "✓" : ""}
              </button>
              <span className="min-w-0 text-[12px]" style={{ color: s.checked ? "#64748b" : "#cbd5e1" }}>
                {s.text}
              </span>
              {s.isCustom ? (
                <span
                  className="flex-none rounded-full text-[8.5px] font-bold"
                  style={{ color: "#94a3b8", border: "1px solid rgba(148,163,184,.3)", letterSpacing: ".08em", padding: "1.5px 6px" }}
                >
                  YOURS
                </span>
              ) : null}
              {gated ? (
                <span
                  title={hold?.title ?? ""}
                  className="flex-none cursor-help rounded-full text-[8.5px] font-bold"
                  style={{ color: "#c2a63d", border: "1px solid rgba(194,166,61,.4)", letterSpacing: ".08em", padding: "1.5px 6px" }}
                >
                  HELD
                </span>
              ) : null}
            </div>
          );
        })}
        <div
          onClick={onAddStep}
          data-testid={`runbook-${runbook.id}-add-step`}
          className="flex cursor-pointer items-center gap-[8px] hover:opacity-80"
          style={{ padding: "8px 0 2px", borderTop: "1px solid rgba(255,255,255,.05)" }}
        >
          <Plus size={12} color="#64748b" />
          <span className="text-[11.5px] font-semibold" style={{ color: "#94a3b8" }}>
            Add step
          </span>
        </div>
      </div>

      {hold ? (
        <div
          onClick={() => onOpenHold(hold)}
          className="mt-[11px] flex cursor-pointer items-center gap-[9px] rounded-[9px] border hover:opacity-90"
          style={{ borderColor: rgba(hold.tone, 0.4), background: rgba(hold.tone, 0.06), padding: "8px 12px" }}
        >
          <span
            className="flex-none rounded-full text-[9.5px] font-bold"
            style={{ color: hold.tone, border: `1px solid ${rgba(hold.tone, 0.4)}`, letterSpacing: ".08em", padding: "2px 8px" }}
          >
            {hold.badge}
          </span>
          <span className="min-w-0 text-[11.5px]" style={{ color: "#cbd5e1" }}>
            {hold.title}
          </span>
          <span
            className="ml-auto flex-none text-[11px] font-bold"
            style={{ color: hold.tone, fontVariantNumeric: "tabular-nums" }}
          >
            {hold.tMinus}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function HoldCard({ hold, now, onOpen }: { readonly hold: HoldWindow; readonly now: Date; readonly onOpen: () => void }) {
  void now;
  const waitLine = `${hold.waitDays}d wait${hold.extendedDays ? ` · +${hold.extendedDays}d extended` : ""}`;
  return (
    <div
      onClick={onOpen}
      data-testid={`hold-${hold.id}`}
      className="cursor-pointer rounded-[14px] border hover:border-white/[.16]"
      style={{ borderColor: HAIRLINE, background: "rgba(255,255,255,.02)", padding: "13px 18px 13px" }}
    >
      <div className="flex flex-wrap items-center gap-[9px]">
        <span
          className="flex-none rounded-full text-[9.5px] font-bold"
          style={{ color: hold.tone, border: `1px solid ${rgba(hold.tone, 0.4)}`, background: rgba(hold.tone, 0.06), letterSpacing: ".08em", padding: "2px 9px" }}
        >
          {hold.badge}
        </span>
        <span className="min-w-0 text-[12.5px] font-semibold" style={{ color: "#e2e8f0" }}>
          {hold.title}
        </span>
        <span className="ml-auto flex-none text-[12px] font-bold" style={{ color: hold.tone, fontVariantNumeric: "tabular-nums" }}>
          {hold.tMinus}
        </span>
      </div>
      <span className="mt-[5px] block text-[11px]" style={{ color: "#64748b" }}>
        {hold.gates}
      </span>
      <div className="mt-[9px] flex flex-wrap items-center gap-[10px]">
        <div className="flex flex-none gap-[2.5px]">
          {hold.ticks.map((t, i) => (
            <span
              key={i}
              className="h-[12px] w-[7px] rounded-[2px]"
              style={{ background: t === "done" ? hold.tone : t === "partial" ? rgba(hold.tone, 0.5) : "rgba(255,255,255,.10)" }}
            />
          ))}
        </div>
        <span className="text-[11px]" style={{ color: "#94a3b8" }}>
          {waitLine}
        </span>
        <span className="text-[11px]" style={{ color: hold.scanTone }}>
          {hold.scanLine}
        </span>
        <span
          className="ml-auto flex-none rounded-md text-[11.5px] font-semibold hover:bg-white/[.04]"
          style={{ color: hold.tone, border: `1px solid ${rgba(hold.tone, 0.4)}`, padding: "5px 13px" }}
        >
          {hold.primaryAction.label}
        </span>
      </div>
      <span className="mt-[7px] block text-[10px]" style={{ color: "#475569" }}>
        {hold.scanProvenance}
      </span>
    </div>
  );
}

function AddStepPanel({
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
    <SlidePanel
      open
      onClose={onClose}
      title="Add a step"
      subtitle={runbook.title}
      footer={
        <>
          <PanelCta label={saving ? "Adding…" : "Add step"} onClick={() => void submit()} disabled={!text.trim() || saving} />
          <span className="text-center text-[10.5px]" style={{ color: "#475569" }}>
            Saved as your own step and kept when the cycle resets.
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-[6px]">
        <span className="text-[11px] font-semibold" style={{ color: "#94a3b8" }}>
          Step
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="1 to 500 characters"
          className="resize-none rounded-md text-[13px] outline-none"
          style={{ border: "1px solid rgba(255,255,255,.10)", background: "rgba(255,255,255,.03)", padding: "11px 12px", color: "#e2e8f0" }}
        />
      </div>
      {saveError ? <PanelNote>{saveError}</PanelNote> : null}
    </SlidePanel>
  );
}

function HoldDetailPanel({
  hold,
  now,
  onClose,
  onDecide,
}: {
  readonly hold: HoldWindow;
  readonly now: Date;
  readonly onClose: () => void;
  readonly onDecide: (
    holdId: number,
    decision: "close-early" | "release" | "prepare-cr",
    body?: { note?: string },
  ) => Promise<{ changeRequestCode: string } | null>;
}) {
  void now;
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const run = async (label: string, decision: "close-early" | "release" | "prepare-cr") => {
    if (submitting) return;
    setSubmitting(label);
    setSubmitError(null);
    const result = await onDecide(hold.id, decision, { note: note.trim() || undefined });
    setSubmitting(null);
    if (result) {
      toast.success(`Raised ${result.changeRequestCode}`);
      onClose();
    } else {
      setSubmitError("Could not record that decision. Try again.");
    }
  };

  const kind = hold.primaryAction.kind;
  const actionNote =
    kind === "close_early"
      ? "Close early raises a change request and closes the window — the gated step still runs only after approval."
      : kind === "prepare_cr"
        ? "Preparing the change request now does not close the window — the wait continues, and the paperwork is ready when it does."
        : "Releasing raises a change request — the gated step runs after approval, not on click. The agreed wait is never rewritten; extensions accumulate beside it.";

  return (
    <SlidePanel
      open
      onClose={onClose}
      title={hold.title}
      subtitle={`${hold.badge} · ${hold.tMinus}`}
      footer={
        <>
          {kind === "close_early" ? (
            <PanelCta
              label={submitting === "close" ? "Closing…" : "Close early"}
              onClick={() => void run("close", "close-early")}
              disabled={!!submitting}
            />
          ) : kind === "prepare_cr" ? (
            <PanelCta
              label={submitting === "prepare" ? "Preparing…" : "Prepare the change request"}
              onClick={() => void run("prepare", "prepare-cr")}
              disabled={!!submitting}
            />
          ) : (
            <>
              <PanelCta
                label={submitting === "release" ? "Releasing…" : "Release the gated step"}
                onClick={() => void run("release", "release")}
                disabled={!!submitting}
              />
              <PanelCta
                variant="outline"
                label={submitting === "prepare" ? "Preparing…" : "Prepare the change request instead"}
                onClick={() => void run("prepare", "prepare-cr")}
                disabled={!!submitting}
              />
            </>
          )}
          {submitError ? <PanelNote>{submitError}</PanelNote> : null}
        </>
      }
    >
      <div className="flex flex-col rounded-[10px] border" style={{ borderColor: HAIRLINE, padding: "4px 14px 10px" }}>
        <PanelKVRow label="Agreed wait" value={`${hold.waitDays} days`} />
        <PanelKVRow label="Extended" value={hold.extendedDays ? `+${hold.extendedDays} days` : "None"} />
        <PanelKVRow label="Scan verdict" value={hold.scanLabel} />
        <PanelKVRow label="Gated step" value={hold.gates} />
      </div>
      <PanelTextarea label="Note (optional)" hint="Up to 2,000 characters" value={note} onChange={setNote} maxLength={2000} />
      <PanelNote>{actionNote}</PanelNote>
    </SlidePanel>
  );
}
