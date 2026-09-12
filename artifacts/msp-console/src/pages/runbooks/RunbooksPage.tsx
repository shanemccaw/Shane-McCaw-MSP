/**
 * RunbooksPage — the MSP Console's Runbooks module (#2585, Git #2669's real
 * backend). Mounts into `ScreenSlot`'s `children` for `sel.page === "run"`.
 *
 * Design: `Design/MSP_Console/design_handoff_msp_console/Runbooks.dc.html`
 * (README screen 15). Real data: `GET /api/msp/runbooks`, and the two real
 * writes the backend actually implements — `PUT .../steps/:position` (mark a
 * step complete on a live run) and `POST /api/msp/hold-windows/:holdId/extend`
 * (extend a hold window). `GET .../hold-windows/:holdId/events` backs the
 * History drawer.
 *
 * `msp-runbooks.ts`'s own header, and the design's own `honestNote`
 * (Runbooks.dc.html), independently agree on scope: #1683 (Feature: Runbooks
 * MSP Console) names five operator actions but is explicitly marked NOT
 * ARCHITECTED for the full surface. Authoring a runbook definition, reordering
 * its steps, and recording a run's outcome are deliberately NOT built here —
 * there is no endpoint for any of the three, and inventing one would conflict
 * with #1683's own recorded decision rather than fill a missing column.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Icon, type IconName } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import {
  useExtendHoldWindow,
  useLoadHoldEvents,
  useMspRunbooks,
  useSetRunbookStep,
  RunbooksApiError,
  type HoldWindow,
  type HoldWindowEvent,
  type Runbook,
} from "@/api/runbooks-api";

const CARD_LINE = border.card;
const CARD_BG = "rgba(15,23,42,.6)";

// ── Status → tone (mirrors artifacts/portal/src/pages/runbooks.tsx's STATUS_TONE
// so an operator viewing the same customer sees the same colour vocabulary the
// customer does) ──────────────────────────────────────────────────────────────
const STATUS_TONE: Readonly<Record<string, string>> = {
  "On track": signal.info.strong,
  Complete: signal.ok.strong,
  Holding: signal.warning.strong,
  "Decision due": signal.critical.strong,
  "Clear to close early": "#22d3ee",
  Overdue: signal.critical.strong,
};

const STATUS_ICON: Readonly<Record<string, IconName>> = {
  "On track": "list-checks",
  Complete: "circle-check-big",
  Holding: "pause",
  "Decision due": "pause",
  "Clear to close early": "pause",
  Overdue: "clock-alert",
};

function rgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const [, r, g, b] = m;
  return `rgba(${parseInt(r, 16)},${parseInt(g, 16)},${parseInt(b, 16)},${alpha})`;
}

function cadenceLabel(cycleDays: number, recurring: boolean, cycleNumber: number): string {
  const every =
    !recurring
      ? "One-off"
      : cycleDays === 7
        ? "Every week"
        : cycleDays === 30 || cycleDays === 31
          ? "Every month"
          : cycleDays === 90 || cycleDays === 91
            ? "Every quarter"
            : cycleDays === 182 || cycleDays === 183
              ? "Every six months"
              : cycleDays === 365 || cycleDays === 366
                ? "Every year"
                : `Every ${cycleDays} days`;
  return `${every} · cycle ${cycleNumber}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The runbook's own due line — the hold's real close date when one is gating
 * it, otherwise the cycle's own start + length. */
function dueLabel(rb: Runbook): { text: string; overdue: boolean } {
  if (rb.hold && rb.hold.closedAt === null) {
    return { text: `held until ${formatDate(rb.hold.closesAt)}`, overdue: false };
  }
  if (!rb.startedOn) return { text: "", overdue: false };
  const started = new Date(rb.startedOn);
  const due = new Date(started.getTime() + rb.cycleDays * 86_400_000);
  const overdue = rb.statusLabel === "Overdue";
  return { text: `${overdue ? "was due" : "closes"} ${due.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`, overdue };
}

const DAY_OPTIONS = [1, 3, 7, 14, 30];

export function RunbooksPage({ customerId }: { customerId: number }) {
  const query = useMspRunbooks(customerId);
  const setStep = useSetRunbookStep(customerId);
  const extendHold = useExtendHoldWindow(customerId);
  const loadHoldEvents = useLoadHoldEvents(customerId);

  const [tab, setTab] = useState<"runbooks" | "holds">("runbooks");
  const [selId, setSelId] = useState<number | null>(null);
  const [extendId, setExtendId] = useState<number | null>(null);
  const [exDays, setExDays] = useState(7);
  const [exReason, setExReason] = useState("");
  const [eventsId, setEventsId] = useState<number | null>(null);
  const [events, setEvents] = useState<readonly HoldWindowEvent[] | null | "loading">(null);

  if (query.isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {["60%", "42%"].map((w, i) => (
          <div key={i} style={{ height: 84, borderRadius: 12, border: `1px solid ${CARD_LINE}`, background: CARD_BG, padding: 15 }}>
            <div style={{ height: 12, width: w, borderRadius: 6, background: "rgba(148,163,184,.14)" }} />
          </div>
        ))}
      </div>
    );
  }

  if (query.isError) {
    const status = query.error instanceof RunbooksApiError ? query.error.status : null;
    if (status === 403) {
      return (
        <StatePanel
          icon="shield-alert"
          tone={signal.critical}
          title="Not in this MSP's book"
          body="This customer is not owned by your MSP, so its runbooks can't be shown here. That's the same ownership check every MSP-scoped route in this console runs."
          wire="customerBelongsToMsp(customerId, mspId) · 403"
        />
      );
    }
    if (status === 404) {
      return (
        <StatePanel
          icon="triangle-alert"
          tone={signal.warning}
          title="Not found"
          body="This customer's runbooks could not be located."
          wire="GET /api/msp/runbooks · 404"
        />
      );
    }
    return (
      <StatePanel
        icon="triangle-alert"
        tone={signal.warning}
        title="Runbooks could not be loaded"
        body="The request to load this customer's runbooks failed. Try again shortly."
        wire={`GET /api/msp/runbooks · ${status ?? "error"}`}
      />
    );
  }

  const payload = query.data;
  if (!payload) return null;

  const { runbooks } = payload;
  const withHold = runbooks.filter((r) => r.hold && r.hold.closedAt === null);
  const overdue = runbooks.filter((r) => r.statusLabel === "Overdue").length;
  const sel = selId !== null ? (runbooks.find((r) => r.id === selId) ?? null) : null;
  const exRb = extendId !== null ? (runbooks.find((r) => r.id === extendId) ?? null) : null;
  const evRb = eventsId !== null ? (runbooks.find((r) => r.id === eventsId) ?? null) : null;

  const toggleStep = (runbookId: number, position: number, checked: boolean) => {
    setStep.mutate(
      { runbookId, position, checked },
      { onError: () => toast.error("Could not update that step. Try again.") },
    );
  };

  const openEvents = async (holdId: number) => {
    setEventsId(holdId);
    setEvents("loading");
    const rows = await loadHoldEvents(holdId);
    setEvents(rows);
  };

  const submitExtend = () => {
    if (!exRb?.hold || !exReason.trim()) return;
    extendHold.mutate(
      { holdId: exRb.hold.id, days: exDays, reason: exReason.trim() },
      {
        onSuccess: () => {
          toast.success(`Extended by ${exDays} days`);
          setExtendId(null);
          setExReason("");
        },
        onError: () => toast.error("Could not extend that window. Try again."),
      },
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {/* Tabs + summary */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {(
          [
            { id: "runbooks" as const, label: "Runbooks", count: runbooks.length },
            { id: "holds" as const, label: "Waiting on", count: withHold.length },
          ]
        ).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 7,
                border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.sidebar}`,
                background: active ? "rgba(37,99,235,.18)" : "transparent",
                color: active ? "#bfdbfe" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {t.label}
              <span style={{ fontSize: 10.5, color: active ? "#60a5fa" : text.faint }}>{t.count}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: overdue > 0 ? "#fcd34d" : "#6ee7b7", whiteSpace: "nowrap" }}>
          {overdue > 0 ? `${overdue} ${overdue === 1 ? "runbook is" : "runbooks are"} overdue` : "Every cycle is inside its window"}
        </span>
      </div>

      {tab === "runbooks" && (
        runbooks.length === 0 ? (
          <EmptyPanel
            icon="book-open"
            title="No runbooks yet"
            body="This tenant has no runbooks recorded. Runbooks start from a site fix or a recurring review, not from this console."
          />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(330px,1fr))", gap: 12 }}>
            {runbooks.map((rb) => {
              const tone = STATUS_TONE[rb.statusLabel] ?? text.muted;
              const icon = STATUS_ICON[rb.statusLabel] ?? "list-checks";
              const due = dueLabel(rb);
              return (
                <div
                  key={rb.id}
                  onClick={() => setSelId(rb.id)}
                  style={{
                    border: `1px solid ${rb.statusLabel === "Overdue" ? "rgba(248,113,113,.24)" : CARD_LINE}`,
                    borderRadius: 12, background: CARD_BG, padding: 15, display: "flex", flexDirection: "column", gap: 12,
                    minWidth: 0, cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, background: rgba(tone, 0.12), border: `1px solid ${rgba(tone, 0.28)}`, color: tone, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name={icon} size={14} color={tone} />
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{rb.title}</span>
                      <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>{cadenceLabel(rb.cycleDays, rb.recurring, rb.cycleNumber)}</span>
                    </span>
                    <span style={{ display: "inline-flex", padding: "3px 9px", borderRadius: 999, background: rgba(tone, 0.12), border: `1px solid ${rgba(tone, 0.28)}`, fontSize: 11, fontWeight: 600, color: tone, whiteSpace: "nowrap" }}>
                      {rb.statusLabel}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.02em", color: text.title }}>{rb.checkedSteps} of {rb.totalSteps}</span>
                      <span style={{ fontSize: 11.5, color: text.label }}>steps done this cycle</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 999, background: "rgba(148,163,184,.14)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${rb.pct}%`, background: tone }} />
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", paddingTop: 10, borderTop: `1px solid ${border.faint}` }}>
                    <span style={{ fontSize: 11.5, color: due.overdue ? "#fca5a5" : text.muted, whiteSpace: "nowrap" }}>{due.text}</span>
                    <div style={{ flex: 1 }} />
                    {rb.hold && rb.hold.closedAt === null && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 999, background: "rgba(251,191,36,.1)", border: "1px solid rgba(251,191,36,.26)", fontSize: 11, fontWeight: 600, color: "#fbbf24", whiteSpace: "nowrap" }}>
                        <Icon name="pause" size={11} color="#fbbf24" />until {formatDate(rb.hold.closesAt)}
                      </span>
                    )}
                    <span style={{ fontSize: 11.5, color: text.label, whiteSpace: "nowrap" }}>{rb.runHistory.length + 1} cycles</span>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {tab === "holds" && (
        withHold.length === 0 ? (
          <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: CARD_BG, padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
            <span style={{ width: 42, height: 42, borderRadius: 13, background: signal.ok.tint, border: `1px solid ${signal.ok.border}`, color: signal.ok.strong, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="pause" size={20} color={signal.ok.strong} />
            </span>
            <span style={{ fontSize: 15.5, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>Nothing is waiting</span>
            <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 420, textWrap: "pretty" }}>
              A hold window opens when a runbook step needs a settling period before the next one can start. None of this tenant's runbooks are paused.
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {withHold.map((rb) => {
              const hold = rb.hold as HoldWindow;
              return (
                <div key={rb.id} style={{ border: "1px solid rgba(251,191,36,.2)", borderRadius: 12, background: CARD_BG, padding: 15, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 11, flexWrap: "wrap" }}>
                    <span style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, background: "rgba(251,191,36,.1)", border: "1px solid rgba(251,191,36,.26)", color: "#fbbf24", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name="pause" size={14} color="#fbbf24" />
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", minWidth: 180, flex: 1 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{hold.title}</span>
                      <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>{rb.title} · {cadenceLabel(rb.cycleDays, rb.recurring, rb.cycleNumber)}</span>
                    </span>
                    <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 999, background: "rgba(251,191,36,.1)", border: "1px solid rgba(251,191,36,.26)", fontSize: 11, fontWeight: 600, color: "#fbbf24", whiteSpace: "nowrap" }}>
                      waiting
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
                    <Fact label="OPENED" value={formatDate(hold.startedAt)} color={text.muted} />
                    <Fact label="ORIGINAL WAIT" value={`${hold.waitDays} days`} color={text.secondary} />
                    <Fact label="EXTENDED BY" value={hold.extendedDays > 0 ? `${hold.extendedDays} days` : "not extended"} color={hold.extendedDays > 0 ? "#fcd34d" : text.label} />
                    <Fact label="CLOSES" value={formatDate(hold.closesAt)} color={text.body} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", paddingTop: 11, borderTop: `1px solid ${border.faint}` }}>
                    <button
                      onClick={() => { setExtendId(rb.id); setExDays(7); setExReason(""); }}
                      style={{ display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 7, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      <Icon name="calendar-plus" size={13} color="#fff" />Extend the wait
                    </button>
                    <button
                      onClick={() => void openEvents(hold.id)}
                      style={{ display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 7, border: `1px solid ${border.sidebar}`, background: "transparent", color: text.secondary, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      <Icon name="history" size={13} color={text.secondary} />History
                    </button>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty", minWidth: 140 }}>
                      Closing early, releasing the hold or turning it into a change is the customer's own call.
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Detail drawer — steps + history */}
      {sel && (
        <Drawer onClose={() => setSelId(null)}>
          <DrawerHeader
            eyebrow={`CYCLE ${sel.cycleNumber} · ${sel.statusLabel.toUpperCase()}`}
            title={sel.title}
            body={sel.context}
            onClose={() => setSelId(null)}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: text.strong }}>{sel.checkedSteps} of {sel.totalSteps} steps done</span>
              <span style={{ fontSize: 11.5, color: dueLabel(sel).overdue ? "#fca5a5" : text.muted }}>{dueLabel(sel).text}</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: text.label }}>{sel.startedOn ? `opened ${formatDate(sel.startedOn)}` : ""}</span>
            </div>
            <div style={{ height: 5, borderRadius: 999, background: "rgba(148,163,184,.14)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${sel.pct}%`, background: STATUS_TONE[sel.statusLabel] ?? text.muted }} />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>THIS CYCLE&apos;S STEPS</span>
            {sel.steps.map((st) => {
              const gated = sel.hold?.closedAt === null && sel.hold?.gatesStepPosition === st.position;
              return (
                <div
                  key={st.position}
                  onClick={() => toggleStep(sel.id, st.position, !st.checked)}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 11, padding: "11px 12px", borderRadius: 10,
                    border: `1px solid ${st.checked ? "rgba(52,211,153,.2)" : border.sidebar}`,
                    background: st.checked ? "rgba(52,211,153,.06)" : "rgba(2,6,23,.4)",
                    minWidth: 0, cursor: "pointer",
                  }}
                >
                  <Icon name={st.checked ? "square-check-big" : "square"} size={18} color={st.checked ? signal.ok.strong : text.faint} style={{ marginTop: 1, flex: "0 0 18px" }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: st.checked ? text.muted : text.strong, textWrap: "pretty", textDecoration: st.checked ? "line-through" : "none" }}>{st.text}</span>
                    <span style={{ fontSize: 11, color: text.faint }}>
                      {st.checked ? `Ticked ${st.checkedAt ? formatDate(st.checkedAt) : "just now"}` : "Not done yet"}
                      {st.isCustom ? " · added on the tenant's own runbook" : ""}
                    </span>
                  </div>
                  {gated && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 999, background: "rgba(251,191,36,.1)", border: "1px solid rgba(251,191,36,.26)", fontSize: 10.5, fontWeight: 600, color: "#fbbf24", whiteSpace: "nowrap", flex: "0 0 auto" }}>
                      <Icon name="pause" size={11} color="#fbbf24" />held
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
            Ticking the last step closes this cycle and opens the next one automatically. Step wording and order are set when the runbook is written, not from here.
          </span>

          {sel.runHistory.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 13, borderTop: `1px solid ${border.faint}` }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>EARLIER CYCLES</span>
              {sel.runHistory.map((c) => {
                const abandoned = c.status === "abandoned";
                const complete = c.status === "complete";
                const icon: IconName = abandoned ? "circle-minus" : complete ? "circle-check-big" : "list-checks";
                const color = abandoned ? text.muted : complete ? signal.ok.strong : signal.info.strong;
                const outcome = complete && c.completedAt ? `completed ${formatDate(c.completedAt)}` : abandoned ? "abandoned" : c.status;
                return (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 9, border: `1px solid ${border.faint}`, background: "rgba(2,6,23,.4)", minWidth: 0 }}>
                    <Icon name={icon} size={14} color={color} style={{ flex: "0 0 14px" }} />
                    <span style={{ fontSize: 12, color: text.secondary, flex: 1, minWidth: 0, textWrap: "pretty" }}>
                      Cycle {c.cycleNumber} · {formatDate(c.startedOn)} · {c.checkedSteps} of {c.totalSteps} steps
                    </span>
                    <span style={{ fontSize: 11.5, color, whiteSpace: "nowrap" }}>{outcome}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Drawer>
      )}

      {/* Extend drawer */}
      {exRb?.hold && (
        <Drawer onClose={() => setExtendId(null)}>
          <DrawerHeader eyebrow="EXTEND THE WAIT" title={exRb.hold.title} body={`Currently closes ${formatDate(exRb.hold.closesAt)}${exRb.hold.extendedDays > 0 ? `, already extended by ${exRb.hold.extendedDays} days` : ""}`} onClose={() => setExtendId(null)} />
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>How many more days</span>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setExDays(d)}
                  style={{
                    height: 32, padding: "0 13px", borderRadius: 8,
                    border: `1px solid ${exDays === d ? "rgba(96,165,250,.32)" : border.sidebar}`,
                    background: exDays === d ? "rgba(37,99,235,.18)" : "transparent",
                    color: exDays === d ? "#bfdbfe" : text.muted, fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  {d === 1 ? "1 day" : `${d} days`}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 11, color: text.label }}>
              Anything from one day to ninety. New deadline would be {formatDate(exRb.hold.closesAt)} plus {exDays} days.
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>Why it needs longer</span>
            <input
              value={exReason}
              onChange={(e) => setExReason(e.target.value)}
              placeholder="Recorded on the customer's audit trail"
              style={{ height: 36, padding: "0 11px", borderRadius: 8, border: `1px solid ${border.sidebar}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 13, outline: "none" }}
            />
            <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>Required. Both reminder alerts reset and fire again against the new deadline.</span>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.faint}` }}>
            <button
              onClick={submitExtend}
              disabled={!exReason.trim() || extendHold.isPending}
              title={exReason.trim() ? "" : "A reason is required"}
              style={{
                flex: 1, height: 38, borderRadius: 8,
                border: `1px solid ${exReason.trim() ? "#2563eb" : border.sidebar}`,
                background: exReason.trim() ? "#2563eb" : "transparent",
                color: exReason.trim() ? "#fff" : text.label, fontSize: 13, fontWeight: 600,
                cursor: exReason.trim() ? "pointer" : "not-allowed", opacity: exReason.trim() ? 1 : 0.6,
              }}
            >
              {extendHold.isPending ? "Extending…" : `Extend by ${exDays} days`}
            </button>
            <button onClick={() => setExtendId(null)} style={{ height: 38, padding: "0 15px", borderRadius: 8, border: `1px solid ${border.sidebar}`, background: "transparent", color: text.secondary, fontSize: 13, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </Drawer>
      )}

      {/* Events drawer */}
      {evRb?.hold && (
        <Drawer onClose={() => setEventsId(null)}>
          <DrawerHeader eyebrow="HISTORY" title={evRb.hold.title} onClose={() => setEventsId(null)} />
          {events === "loading" ? (
            <span style={{ fontSize: 12, color: text.label }}>Loading…</span>
          ) : events === null ? (
            <span style={{ fontSize: 12, color: text.label }}>Could not load this window&apos;s history.</span>
          ) : events.length === 0 ? (
            <span style={{ fontSize: 12, color: text.label }}>No decisions recorded against this window yet.</span>
          ) : (
            events.map((e, i) => <EventRow key={i} event={e} />)
          )}
          <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
            An entry does not record whether it was us or the customer who acted. Both write the same row.
          </span>
        </Drawer>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 2 }}>
        <Icon name="info" size={13} color={text.faint} />
        <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
          Ticking a step and extending a wait are the two things this console can do to a live runbook, and both run against the
          real MSP endpoints above. Writing a runbook, reordering its steps and recording a cycle outcome are not built —
          #1683 marks the operator surface for those NOT ARCHITECTED.
        </span>
      </div>
    </div>
  );
}

function EventRow({ event }: { event: HoldWindowEvent }) {
  const KIND: Record<string, { icon: IconName; color: string; label: string }> = {
    extended: { icon: "calendar-plus", color: "#fbbf24", label: "Wait extended" },
    opened: { icon: "play", color: "#60a5fa", label: "Wait started" },
    closed_early: { icon: "fast-forward", color: "#a78bfa", label: "Closed early by the customer" },
    released: { icon: "circle-check-big", color: "#34d399", label: "Released by the customer" },
    cr_prepared: { icon: "git-pull-request", color: "#a78bfa", label: "Turned into a change request" },
  };
  const k = KIND[event.kind] ?? KIND.opened;
  const title = `${k.label}${event.daysDelta ? ` · ${event.daysDelta} days` : ""}`;
  return (
    <div style={{ display: "flex", gap: 11, minWidth: 0 }}>
      <span style={{ width: 26, height: 26, borderRadius: 8, background: rgba(k.color, 0.1), border: `1px solid ${rgba(k.color, 0.26)}`, color: k.color, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
        <Icon name={k.icon} size={13} color={k.color} />
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 11, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{title}</span>
        {event.reason && <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{event.reason}</span>}
        <span style={{ fontSize: 11, color: text.faint }}>{formatDate(event.createdAt)}</span>
        {event.changeRequestCode && <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: "#93c5fd" }}>{event.changeRequestCode}</span>}
      </div>
    </div>
  );
}

function Fact({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{label}</span>
      <span style={{ fontSize: 12.5, color, textWrap: "pretty" }}>{value}</span>
    </div>
  );
}

function Drawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(520px,95%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.sidebar}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}
      >
        {children}
      </div>
    </div>
  );
}

function DrawerHeader({ eyebrow, title, body, onClose }: { eyebrow: string; title: string; body?: string; onClose: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "#93c5fd" }}>{eyebrow}</span>
        <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>{title}</span>
        {body && <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>{body}</span>}
      </div>
      <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="x" size={14} color={text.muted} />
      </button>
    </div>
  );
}

function EmptyPanel({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <div style={{ border: `1px dashed ${border.hover}`, borderRadius: 12, background: CARD_BG, padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
      <span style={{ width: 42, height: 42, borderRadius: 13, background: signal.info.tint, border: `1px solid ${signal.info.border}`, color: signal.info.text, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={20} color={signal.info.text} />
      </span>
      <span style={{ fontSize: 15.5, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>{title}</span>
      <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 420, textWrap: "pretty" }}>{body}</span>
    </div>
  );
}

function StatePanel({
  icon, tone, title, body, wire,
}: {
  icon: IconName;
  tone: { strong: string; text: string; tint: string; border: string };
  title: string;
  body: string;
  wire: string;
}) {
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 22, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 13, background: tone.tint, border: `1px solid ${tone.border}` }}>
        <Icon name={icon} size={20} color={tone.text} />
      </span>
      <span style={{ fontSize: 16, fontWeight: 700, color: text.title }}>{title}</span>
      <span style={{ fontSize: 13, color: text.muted, textWrap: "pretty", lineHeight: 1.5 }}>{body}</span>
      <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.faint, wordBreak: "break-all" }}>{wire}</span>
    </div>
  );
}
