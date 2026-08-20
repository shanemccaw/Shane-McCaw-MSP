/**
 * portal-v2-runbooks.tsx — Active Runbooks, and the hold-window panel.
 *
 * A direct port of the prototype's `isOperateRunbooks` block
 * (`Customer Portal Shell.dc.html` 5681-5774), its hold-card derivation
 * (7008-7135) and its runbook mapper (16844-16900).
 *
 * ── Container: this page is NARROW, and that is deliberate ─────────────────
 * `max-width:1000px; padding:28px 28px 56px; gap:20` — not Change Control's
 * `1320 / 26px 26px 48px / gap:14`. The README's own table says content runs
 * "1000–1320px depending on page"; this is the 1000 end. Checked against the
 * markup rather than assumed from the neighbouring page.
 *
 * The heading is also a different size from Change Control's: 20px/800 with
 * `line-height:1.3` and NO letter-spacing, against Change Control's 18px/800 at
 * `-.015em`. Two operational pages, two type scales, both verbatim.
 *
 * ── The hold panel only exists when a window is open ───────────────────────
 * The whole block is behind `holdAnyOpen` (proto 5687). A tenant with no hold
 * windows does not get an empty "Hold windows" panel — the section simply is
 * not there, which is why the runbook list is the first thing under the header
 * in that case.
 *
 * ── Four defects fixed, not ported ────────────────────────────────────────
 * The badge, T-minus readout, state and "N days early" figure on every card
 * come from `holds/holdState.ts`, which fixes four real defects in the
 * prototype's own derivation. They are written up in full in api-server's
 * `lib/portal-hold-windows.ts`; the short version is that a clear window could
 * never read `closing`, `early` overstated the days it saved by one, "closes
 * tomorrow" was asserted from an hours threshold rather than a calendar date,
 * and the badge and readout switched at different thresholds.
 *
 * ── The clock is live ─────────────────────────────────────────────────────
 * `useRunbooks` advances a tick every 30s and the cards re-derive from
 * `closesAt`, so a window crosses T-24 on an open tab without a reload — the
 * one thing the README explicitly flags as missing from the prototype.
 */

import { useState } from "react";
import { Check } from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { deriveHoldClock, holdPrimaryLabel } from "@/components/portal-v2/holds/holdState";
import {
  useRunbooks,
  type HoldWindow,
  type Runbook,
} from "@/components/portal-v2/holds/useRunbooks";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

/**
 * FormDrawer's `options` take `{ value, label }` pairs; the prototype writes
 * plain strings. Same string for both, so the form's value IS the label the
 * design specifies.
 */
const opts = (...values: string[]) => values.map((v) => ({ value: v, label: v }));
/** Appends an alpha suffix to a hex value, the way the prototype does inline. */
const A = (hex: string, suffix: string) => `${hex}${suffix}`;

export default function PortalV2RunbooksPage() {
  const {
    payload,
    loaded,
    error,
    now,
    setStepChecked,
    addStep,
    extendHold,
    decideHold,
  } = useRunbooks();

  const runbooks = payload?.runbooks ?? [];
  const holds = payload?.holds ?? [];
  const summary = payload?.summary ?? null;

  // `holdAnyOpen` — proto 5687. Closed windows stay in the record but do not
  // keep the panel on screen.
  const openHolds = holds.filter((h) => h.closedAt === null);
  const holdAnyOpen = openHolds.length > 0;

  return (
    <PortalV2Shell title="Active Runbooks" eyebrow="Operate">
      <div
        style={{
          position: "relative",
          maxWidth: 1000,
          margin: "0 auto",
          padding: "28px 28px 56px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          boxSizing: "border-box",
        }}
        data-testid="pv2-runbooks"
      >
        {/* ── Header — proto 5683-5686 ─────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{ fontSize: "20px", fontWeight: 800, color: "#f8fafc", lineHeight: 1.3 }}
            data-testid="pv2-runbooks-title"
          >
            Active Runbooks
          </span>
          <span style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.5 }}>
            Every runbook in progress across the tenant, in one place — what&rsquo;s done, what&rsquo;s
            left, and how long it&rsquo;s been running.
          </span>
        </div>

        {!loaded && (
          <span style={{ fontSize: "12px", color: "#64748b" }} data-testid="pv2-runbooks-loading">
            Loading your runbooks…
          </span>
        )}
        {loaded && error && (
          <span style={{ fontSize: "12px", color: "#f87171" }} data-testid="pv2-runbooks-error">
            {error}
          </span>
        )}
        {loaded && !error && runbooks.length === 0 && (
          <span
            style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.55, maxWidth: "88ch" }}
            data-testid="pv2-runbooks-empty"
          >
            No runbooks are in progress. A runbook starts when a remediation playbook or an SOP is
            put into execution against your tenant.
          </span>
        )}

        {/* ── Hold windows panel — proto 5687-5734 ─────────────────────── */}
        {holdAnyOpen && summary && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 11,
              padding: "15px 17px",
              border: "1px solid rgba(30,41,59,.9)",
              borderRadius: 12,
              background: "rgba(15,23,42,.35)",
            }}
            data-testid="pv2-holds-panel"
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".18em",
                    textTransform: "uppercase",
                    color: "#64748b",
                  }}
                >
                  Hold windows
                </span>
                <span
                  style={{
                    fontSize: "12.5px",
                    color: "#94a3b8",
                    lineHeight: 1.55,
                    maxWidth: "88ch",
                  }}
                >
                  Steps that wait on time rather than on work. The tenant is scanned while each
                  window runs, so a window can close early when the evidence says waiting adds
                  nothing.
                </span>
              </div>
              <span
                style={{
                  flex: "0 0 auto",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#94a3b8",
                  fontFamily: MONO,
                }}
                data-testid="pv2-holds-summary"
              >
                {summary.text}
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(410px,1fr))",
                gap: 11,
              }}
            >
              {openHolds.map((h) => (
                <HoldCard
                  key={h.id}
                  hold={h}
                  now={now}
                  onExtend={extendHold}
                  onDecide={decideHold}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Runbook cards — proto 5735-5772 ──────────────────────────── */}
        {runbooks.map((rb) => (
          <RunbookCard
            key={rb.id}
            runbook={rb}
            now={now}
            onToggleStep={setStepChecked}
            onAddStep={addStep}
            onDecide={decideHold}
          />
        ))}
      </div>
    </PortalV2Shell>
  );
}

// ── One hold card — proto 5697-5731 ──────────────────────────────────────────

function HoldCard({
  hold,
  now,
  onExtend,
  onDecide,
}: {
  hold: HoldWindow;
  now: Date;
  onExtend: (holdId: number, days: number, reason: string) => Promise<boolean>;
  onDecide: (
    holdId: number,
    decision: "close-early" | "release" | "prepare-cr",
    body?: { note?: string; route?: string; window?: string },
  ) => Promise<{ changeRequestCode: string } | null>;
}) {
  const { openForm, formElement } = useFormDrawer();

  // Re-derived from `closesAt` on every tick, so the card crosses T-24 without a
  // reload. The server's own derivation is authoritative for what it does; this
  // is the display between fetches.
  const clock = deriveHoldClock(
    { closesAt: hold.closesAt, scanVerdict: hold.scanVerdict, closedAt: hold.closedAt },
    now,
  );
  const tone = clock.tone;
  const isRunning = clock.state === "running";

  const extendForm = () =>
    openForm({
      kicker: `${hold.pillar} · hold window`,
      title: "Extend this window",
      intro:
        "Extending is recorded with a reason, so a window that keeps moving is visible rather than quietly permanent.",
      submitLabel: "Extend",
      fields: [
        { id: "by", label: "Extend by", kind: "select", options: opts("3 days", "7 days", "14 days"), value: "3 days" },
        {
          id: "reason",
          label: "Reason",
          kind: "textarea",
          wide: true,
          placeholder: "What has to be true before this window closes?",
        },
        { id: "owner", label: "Who is doing that work", placeholder: "Name", required: false },
      ],
      doneNote:
        "Extended. The new close date is on the runbook and you are alerted 24 hours before it.",
      onSubmit: async (values) => {
        const days = Number.parseInt(String(values.by ?? "3"), 10) || 3;
        await onExtend(hold.id, days, String(values.reason ?? "").trim() || "No reason given");
      },
    });

  const primaryForm = () => {
    if (clock.state === "due") {
      return openForm({
        kicker: `${hold.pillar} · hold window`,
        title: "The window has closed — release the gated step",
        intro:
          "The observation period is complete. Releasing the step raises a change request with the full window record attached: what was observed each day, and what the last scan found.",
        submitLabel: "Raise the change request",
        fields: [
          {
            id: "route",
            label: "What to do with the gated step",
            kind: "select",
            options: opts("Release it — proceed as written", "Release it, but exclude what the scan flagged", "Do not release — extend the window"),
            value: "Release it, but exclude what the scan flagged",
          },
          {
            id: "window",
            label: "Change window",
            kind: "select",
            options: opts("Tonight, 19:00–20:00 UTC", "Tomorrow, 19:00–20:00 UTC", "Next scheduled window"),
            value: "Tonight, 19:00–20:00 UTC",
          },
          { id: "note", label: "Note for the record", kind: "textarea", wide: true, required: false },
        ],
        doneNote:
          "Raised. A snapshot is taken before the step runs, and the window record is filed against the change request.",
        onSubmit: async (values) => {
          await onDecide(hold.id, "release", {
            route: String(values.route ?? ""),
            window: String(values.window ?? ""),
            note: String(values.note ?? ""),
          });
        },
      });
    }
    if (clock.state === "early") {
      return openForm({
        kicker: `${hold.pillar} · hold window`,
        title: "Close this window early",
        intro:
          "Closing a hold window early is a change to an approved runbook, so it raises a change request with the scan evidence attached — the reason the wait is no longer needed is part of the record.",
        submitLabel: "Raise the change request",
        fields: [
          {
            id: "evidence",
            label: "Evidence attached",
            kind: "select",
            options: opts("The 5 days of clear scan results", "Clear scan results plus owner confirmations"),
            value: "The 5 days of clear scan results",
          },
          {
            id: "when",
            label: "Execute the gated step",
            kind: "select",
            options: opts("At the next change window tonight", "Immediately on approval"),
            value: "At the next change window tonight",
          },
          {
            id: "why",
            label: "Why the wait is no longer needed",
            kind: "textarea",
            wide: true,
            placeholder: "Pre-filled from the scan — edit if you want to add context.",
            required: false,
          },
        ],
        doneNote:
          "Raised. The window stays open until the change request is approved, then the gated step unlocks.",
        onSubmit: async (values) => {
          await onDecide(hold.id, "close-early", {
            route: String(values.evidence ?? ""),
            window: String(values.when ?? ""),
            note: String(values.why ?? ""),
          });
        },
      });
    }
    return openForm({
      kicker: `${hold.pillar} · hold window`,
      title: "Prepare the change request now",
      intro:
        "The change request is drafted while the window runs and submitted the moment it closes, so the decision does not wait on paperwork.",
      submitLabel: "Draft it",
      fields: [
        {
          id: "auto",
          label: "When the window closes",
          kind: "select",
          options: opts("Submit automatically if the scan is clear", "Hold for my approval either way"),
          value: "Hold for my approval either way",
        },
        {
          id: "window",
          label: "Preferred change window",
          kind: "select",
          options: opts("First window after close", "Next weekend window"),
          value: "First window after close",
        },
      ],
      doneNote: "Drafted. It appears in Change Control as a draft and is linked to this window.",
      onSubmit: async (values) => {
        await onDecide(hold.id, "prepare-cr", { window: String(values.window ?? "") });
      },
    });
  };

  const secondaryLabel =
    clock.state === "due"
      ? "Extend instead"
      : clock.state === "early"
        ? `Let it run to ${formatCloseShort(hold.closesAt)}`
        : "Extend the window";

  return (
    <>
      <div
        data-testid={`pv2-hold-${hold.holdKey}`}
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "14px 16px 14px 18px",
          border: `1px solid ${isRunning ? "rgba(30,41,59,.9)" : A(tone, "4d")}`,
          borderRadius: 11,
          background: isRunning
            ? "rgba(8,17,32,.5)"
            : `linear-gradient(160deg,${A(tone, "12")},rgba(8,17,32,.6) 55%)`,
          overflow: "hidden",
        }}
      >
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 2,
            background: A(tone, isRunning ? "66" : "cc"),
          }}
        />

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
            <span
              data-testid={`pv2-hold-badge-${hold.holdKey}`}
              style={{
                alignSelf: "flex-start",
                padding: "3px 8px",
                borderRadius: 5,
                border: `1px solid ${A(tone, "55")}`,
                background: A(tone, "14"),
                color: tone,
                fontSize: "9px",
                fontWeight: 700,
                letterSpacing: ".12em",
                textTransform: "uppercase",
              }}
            >
              {clock.badge}
            </span>
            <span
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: "#f1f5f9",
                lineHeight: 1.4,
                textWrap: "pretty",
              }}
            >
              {hold.title}
            </span>
            <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.45 }}>{hold.gates}</span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              alignItems: "flex-end",
              flex: "0 0 auto",
            }}
          >
            <span
              data-testid={`pv2-hold-tminus-${hold.holdKey}`}
              style={{ fontSize: "17px", fontWeight: 800, color: tone, lineHeight: 1.1, fontFamily: MONO }}
            >
              {clock.tMinus}
            </span>
            <span style={{ fontSize: "9.5px", color: "#475569", fontFamily: MONO }}>
              {formatWindowLabel(hold.startedAt, hold.closesAt)}
            </span>
          </div>
        </div>

        {/* Day-tick track — proto 5711-5715. */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 2 }}>
          {hold.ticks.map((t, i) => (
            <span
              key={i}
              style={{
                flex: 1,
                minWidth: 0,
                height: 7,
                borderRadius: 2,
                background:
                  t === "done"
                    ? A(tone, "cc")
                    : t === "partial"
                      ? A(tone, "77")
                      : "rgba(148,163,184,.13)",
              }}
            />
          ))}
        </div>

        {/* Scan verdict block — proto 5716-5720. */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "10px 12px",
            borderRadius: 9,
            border: "1px solid rgba(30,41,59,.9)",
            background: "rgba(8,17,32,.6)",
          }}
        >
          <span
            data-testid={`pv2-hold-scan-${hold.holdKey}`}
            style={{
              fontSize: "9.5px",
              fontWeight: 700,
              letterSpacing: ".13em",
              textTransform: "uppercase",
              color: hold.scanTone,
            }}
          >
            {hold.scanLabel}
          </span>
          <span style={{ fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.55, textWrap: "pretty" }}>
            {hold.scanLine}
          </span>
          <span style={{ fontSize: "9.5px", color: "#475569", fontFamily: MONO }}>
            {hold.scanProvenance}
          </span>
        </div>

        <span
          style={{
            position: "relative",
            fontSize: "11.5px",
            color: "#64748b",
            lineHeight: 1.55,
            textWrap: "pretty",
          }}
        >
          {hold.why}
        </span>

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 7,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={primaryForm}
            data-testid={`pv2-hold-primary-${hold.holdKey}`}
            style={{
              padding: "7px 12px",
              borderRadius: 6,
              border: `1px solid ${A(tone, "80")}`,
              background: A(tone, "22"),
              color: "#f1f5f9",
              fontSize: "11px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {holdPrimaryLabel({ closesAt: hold.closesAt, scanVerdict: hold.scanVerdict }, now)}
          </button>
          <button
            type="button"
            onClick={extendForm}
            data-testid={`pv2-hold-secondary-${hold.holdKey}`}
            style={{
              padding: "7px 12px",
              borderRadius: 6,
              border: "1px solid rgba(148,163,184,.22)",
              background: "transparent",
              color: "#94a3b8",
              fontSize: "11px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {secondaryLabel}
          </button>
          {/* Phase 7a wires ShaneBot for real; the affordance is the design's. */}
          <button
            type="button"
            style={{
              background: "none",
              border: "none",
              padding: 0,
              marginLeft: 4,
              fontSize: "11px",
              color: "#22d3ee",
              cursor: "pointer",
              fontFamily: "inherit",
              textDecoration: "underline",
            }}
          >
            Ask ShaneBot
          </button>
        </div>
      </div>
      {formElement}
    </>
  );
}

// ── One runbook card — proto 5735-5772 ───────────────────────────────────────

function RunbookCard({
  runbook: rb,
  now,
  onToggleStep,
  onAddStep,
  onDecide,
}: {
  runbook: Runbook;
  now: Date;
  onToggleStep: (runbookId: number, position: number, checked: boolean) => Promise<boolean>;
  onAddStep: (runbookId: number, text: string) => Promise<boolean>;
  onDecide: (
    holdId: number,
    decision: "close-early" | "release" | "prepare-cr",
    body?: { note?: string; route?: string; window?: string },
  ) => Promise<{ changeRequestCode: string } | null>;
}) {
  const [newStepText, setNewStepText] = useState("");
  const [busy, setBusy] = useState(false);

  const hold = rb.hold && rb.hold.closedAt === null ? rb.hold : null;
  const clock = hold
    ? deriveHoldClock({ closesAt: hold.closesAt, scanVerdict: hold.scanVerdict }, now)
    : null;

  // Status colour follows the design's precedence (proto 16867): complete, then
  // the hold's own tone, then overdue, then on track.
  const statusColor =
    rb.statusLabel === "Complete"
      ? "#34d399"
      : clock
        ? clock.tone
        : rb.statusLabel === "Overdue"
          ? "#f87171"
          : "#c2a63d";

  return (
    <div
      data-testid={`pv2-runbook-${rb.runbookKey}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        border: "1px solid rgba(30,41,59,.9)",
        borderRadius: 12,
        background: "rgba(15,23,42,.35)",
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "#f1f5f9" }}>{rb.title}</span>
          <span style={{ fontSize: "11.5px", color: "#64748b" }}>{rb.context}</span>
        </div>
        <span
          data-testid={`pv2-runbook-status-${rb.runbookKey}`}
          style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            color: statusColor,
            padding: "2px 7px",
            border: `1px solid ${A(statusColor, "55")}`,
            borderRadius: 4,
          }}
        >
          {rb.statusLabel}
        </span>
      </div>

      {/* Progress — proto 5744-5751. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div
          style={{
            height: 5,
            borderRadius: 3,
            background: "rgba(148,163,184,.12)",
            overflow: "hidden",
          }}
        >
          <div
            style={{ height: "100%", borderRadius: 3, width: `${rb.pct}%`, background: statusColor }}
          />
        </div>
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
        >
          <span style={{ fontSize: "11px", color: "#94a3b8", fontFamily: MONO }}>
            {rb.checkedSteps} / {rb.totalSteps} steps
          </span>
          <span style={{ fontSize: "11px", color: "#64748b" }}>
            Day {rb.daysElapsed} of {rb.cycleDays} · {rb.daysLeft} days left
          </span>
        </div>
      </div>

      {/* Hold band — proto 5752-5759. */}
      {hold && clock && (
        <div
          data-testid={`pv2-runbook-holdband-${rb.runbookKey}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            flexWrap: "wrap",
            padding: "9px 12px",
            borderRadius: 9,
            border: `1px solid ${A(clock.tone, "3d")}`,
            background: A(clock.tone, "0f"),
          }}
        >
          <span
            style={{
              flex: "0 0 auto",
              padding: "3px 8px",
              borderRadius: 5,
              border: `1px solid ${A(clock.tone, "55")}`,
              background: A(clock.tone, "14"),
              color: clock.tone,
              fontSize: "11px",
              fontWeight: 800,
              fontFamily: MONO,
            }}
          >
            {clock.tMinus}
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: "11.5px",
              color: "#cbd5e1",
              lineHeight: 1.5,
              textWrap: "pretty",
            }}
          >
            {hold.title} — {hold.scanLabel.replace("Scan says: ", "scan says ")}.
          </span>
          <button
            type="button"
            onClick={() => {
              // The band's button jumps to the same decision the card offers.
              const el = document.querySelector<HTMLElement>(
                `[data-testid='pv2-hold-primary-${hold.holdKey}']`,
              );
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
              el?.focus();
            }}
            style={{
              flex: "0 0 auto",
              padding: "6px 11px",
              borderRadius: 6,
              border: `1px solid ${A(clock.tone, "66")}`,
              background: A(clock.tone, "1f"),
              color: "#e2e8f0",
              fontSize: "10.5px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {clock.state === "due" ? "Decide" : clock.state === "early" ? "Close early" : "Review window"}
          </button>
        </div>
      )}

      {/* Steps — proto 5760-5769. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          paddingTop: 6,
          borderTop: "1px solid rgba(30,41,59,.7)",
        }}
      >
        {rb.steps.map((st) => (
          <div
            key={st.position}
            onClick={() => void onToggleStep(rb.id, st.position, !st.checked)}
            data-testid={`pv2-step-${rb.runbookKey}-${st.position}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "4px 2px",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                flex: "0 0 18px",
                width: 18,
                height: 18,
                borderRadius: 4,
                // Custom steps tick teal; catalogue steps tick blue. The
                // prototype draws the same distinction (proto 16880).
                border: `1px solid ${st.checked ? (st.isCustom ? "#22d3ee" : "#60a5fa") : "rgba(148,163,184,.35)"}`,
                background: st.checked
                  ? st.isCustom
                    ? "rgba(34,211,238,.15)"
                    : "rgba(96,165,250,.15)"
                  : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {st.checked && <Check size={12} color={st.isCustom ? "#22d3ee" : "#60a5fa"} />}
            </span>
            <span
              style={{
                fontSize: "12.5px",
                color: st.checked ? "#64748b" : "#cbd5e1",
                lineHeight: 1.5,
                textDecoration: st.checked ? "line-through" : "none",
              }}
            >
              {st.text}
            </span>
          </div>
        ))}
      </div>

      {/* Add a step — proto 5770-5773. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 6 }}>
        <input
          value={newStepText}
          onChange={(e) => setNewStepText(e.target.value)}
          placeholder="Add a step or sub-step…"
          data-testid={`pv2-newstep-${rb.runbookKey}`}
          style={{
            flex: 1,
            background: "#0b1a2e",
            border: "1px solid rgba(30,41,59,.9)",
            borderRadius: 6,
            padding: "7px 10px",
            color: "#e2e8f0",
            fontSize: "12px",
            fontFamily: "inherit",
            outline: "none",
            minWidth: 0,
          }}
        />
        <button
          type="button"
          disabled={busy || !newStepText.trim()}
          data-testid={`pv2-addstep-${rb.runbookKey}`}
          onClick={async () => {
            const text = newStepText.trim();
            if (!text) return;
            setBusy(true);
            const ok = await onAddStep(rb.id, text);
            if (ok) setNewStepText("");
            setBusy(false);
          }}
          style={{
            padding: "7px 13px",
            borderRadius: 6,
            fontSize: "11.5px",
            fontWeight: 700,
            border: "1px solid rgba(30,41,59,.9)",
            background: "transparent",
            color: newStepText.trim() ? "#60a5fa" : "#475569",
            cursor: newStepText.trim() ? "pointer" : "default",
            fontFamily: "inherit",
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ── Formatting helpers, matching the prototype's `holdFmt` (proto 7043) ──────

/** "13 Aug 10:00" — the prototype's own UTC format. */
function holdFmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    d.getUTCMonth()
  ];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  return `${d.getUTCDate()} ${mo} ${hh}:00`;
}

function formatWindowLabel(startedAt: string, closesAt: string): string {
  return `${holdFmt(startedAt)} → ${holdFmt(closesAt)}`;
}

/** "27 Aug" — the prototype's `holdFmt(endMs).split(' ').slice(0,2).join(' ')`. */
function formatCloseShort(closesAt: string): string {
  return holdFmt(closesAt).split(" ").slice(0, 2).join(" ");
}
