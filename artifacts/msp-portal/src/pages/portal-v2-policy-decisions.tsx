/**
 * portal-v2-policy-decisions.tsx — Operate → Policy Decisions.
 *
 * A direct port of the prototype's `isPolicyDecisions` block
 * ('Customer Portal Shell.dc.html' 4578-4657) and its derivation
 * (`pdStates`/`pdFilterNote`/`pdRows`, 20247-20328), transcribed into
 * policyDecisionsModel.ts.
 *
 * ── What this page argues ──────────────────────────────────────────────────
 * The standfirst is the thesis, verbatim: "An undocumented gap is a finding on
 * every scan and every audit; a documented one is a position, with a name
 * against it, a compensating control, and a date it gets looked at again. This
 * page is where those dates are kept honest." So the four counters are STATES,
 * not categories, and the sharpest of them is `expired` — a decision past its
 * review date "reads as neglect rather than a decision" (GOV-A4's own `check`).
 *
 * ── UI-only ────────────────────────────────────────────────────────────────
 * The fixture is design content (policyDecisionsData.ts, shared with the
 * Overview lane). The counter filter is local UI state. The four forms — record,
 * sign off, renew, withdraw — open the shared FormDrawer and record nothing;
 * their done-note is the design's own toast text, so the page says exactly what
 * the action would do without inventing a mutation there is no capability for.
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { PortalV2Shell, SIDEBAR_WASH } from "@/components/portal-v2/PortalV2Shell";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { PD_KB_INFO, type PolicyDecision, type PolicyDecisionState } from "@/components/portal-v2/policyDecisionsData";
import {
  pdActions,
  pdFilterNote,
  pdMetaFields,
  pdRowBadge,
  pdStateCards,
  pdVisible,
} from "@/components/portal-v2/policyDecisionsModel";
import { usePolicyDecisions } from "@/components/portal-v2/riskRegisterLive";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

const opts = (...values: string[]) => values.map((v) => ({ value: v, label: v }));

/**
 * The knowledge-base info dot — prototype `kbInfo` (7776-7789), the same
 * treatment the Licensing and Health pages use. The full article lives in the
 * knowledge-base overlay (a later part), so the click is inert here and the
 * hover card is the reproduced surface.
 */
function PdInfoDot() {
  const [hover, setHover] = useState(false);
  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid="pv2-pd-info"
      style={{
        position: "relative",
        flex: "0 0 15px",
        width: 15,
        height: 15,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: `1px solid ${hover ? "rgba(96,165,250,.8)" : "rgba(148,163,184,.35)"}`,
        background: hover ? "rgba(96,165,250,.18)" : "transparent",
        color: hover ? "#93c5fd" : "#64748b",
        fontSize: "9.5px",
        fontWeight: 800,
        fontStyle: "normal",
        letterSpacing: 0,
        cursor: "pointer",
        fontFamily: MONO,
      }}
    >
      i
      {hover && (
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: 22,
            transform: "translateX(-50%)",
            zIndex: 140,
            width: 260,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "10px 12px",
            borderRadius: 9,
            border: "1px solid rgba(96,165,250,.35)",
            background: "#0b1524",
            boxShadow: "0 14px 34px rgba(2,6,23,.6)",
            textAlign: "left",
            pointerEvents: "none",
          }}
        >
          <span style={{ fontSize: "11.5px", fontWeight: 800, color: "#f8fafc", lineHeight: 1.35 }}>
            {PD_KB_INFO.title}
          </span>
          <span style={{ fontSize: "10.5px", color: "#94a3b8", lineHeight: 1.5 }}>
            {PD_KB_INFO.summary}
          </span>
          <span style={{ fontSize: "9.5px", fontWeight: 700, color: "#60a5fa" }}>Click to read it</span>
        </span>
      )}
    </span>
  );
}

export default function PortalV2PolicyDecisionsPage() {
  /** `pdFilter` — which state the list is filtered to, or null for all four. */
  const [filter, setFilter] = useState<PolicyDecisionState | null>(null);
  /** `pdOpen` — which decision is expanded, keyed by id. */
  const [open, setOpen] = useState<string | null>(null);

  const { openForm, formElement } = useFormDrawer();

  // The REAL policy decisions for this customer, from
  // /api/portal/policy-decisions. The model functions already took the register
  // as a parameter with the fixture as their default, so wiring is a matter of
  // passing the live rows in — nothing below this line changed shape.
  const { decisions, loading, error } = usePolicyDecisions();

  const cards = pdStateCards(filter, decisions);
  const rows = pdVisible(filter, decisions);
  const note = pdFilterNote(filter);

  const toggleFilter = (state: PolicyDecisionState) =>
    setFilter((f) => (f === state ? null : state));

  /** Prototype `pdNewGo` (20316-20329). */
  const recordDecision = () =>
    openForm({
      kicker: "Policy decisions",
      title: "Record a new policy decision",
      intro:
        "Use this where you have decided to live with a gap. An undocumented gap is a finding; a documented one is a position.",
      submitLabel: "Record it",
      fields: [
        { id: "gap", label: "The gap" },
        { id: "obligation", label: "Obligation it touches" },
        { id: "owner", label: "Accountable name" },
        { id: "rationale", label: "Why this is the right position", kind: "textarea", wide: true },
        { id: "control", label: "Compensating control", kind: "textarea", wide: true },
        { id: "review", label: "Review in", kind: "select", options: opts("3 months", "6 months", "12 months"), value: "12 months" },
      ],
      doneNote: "Decision recorded against the obligation, awaiting sign-off.",
    });

  /** Prototype `signGo` (20296-20306). */
  const signOff = (d: PolicyDecision) =>
    openForm({
      kicker: `Policy decision · ${d.id}`,
      title: "Sign this decision off",
      intro: "Signing accepts the gap on the record, with your name against it.",
      submitLabel: "Sign it off",
      fields: [
        { id: "owner", label: "Accountable name", value: d.owner },
        { id: "review", label: "Review in", kind: "select", options: opts("3 months", "6 months", "12 months"), value: "6 months" },
        { id: "control", label: "Compensating control", kind: "textarea", wide: true, value: d.compensating },
      ],
      doneNote: `${d.id} signed off. It now appears on the compliance record as a decision, not a gap.`,
    });

  /** Prototype `renewGo` (20285-20295). */
  const renew = (d: PolicyDecision) =>
    openForm({
      kicker: `Policy decision · ${d.id}`,
      title: "Renew this decision",
      intro:
        "Renewing restates the position for another period. The compensating control has to still be true.",
      submitLabel: "Renew it",
      fields: [
        { id: "period", label: "Renew for", kind: "select", options: opts("6 months", "12 months", "24 months"), value: "12 months" },
        { id: "control", label: "Compensating control — still true?", kind: "select", options: opts("Yes, verified", "Yes, but weakened", "No longer in place"), value: "Yes, verified" },
        { id: "note", label: "What changed since it was signed", kind: "textarea", wide: true },
      ],
      doneNote: `Decision ${d.id} renewed. The risk register and the obligation both updated.`,
    });

  /** Prototype `withdrawGo` (20307-20313). */
  const withdraw = (d: PolicyDecision) =>
    openForm({
      kicker: `Policy decision · ${d.id}`,
      title: "Withdraw and fix instead",
      intro:
        "Withdrawing puts the gap back on the open list and raises the change request to close it.",
      submitLabel: "Withdraw it",
      fields: [{ id: "why", label: "Why the position no longer holds", kind: "textarea", wide: true }],
      doneNote: `${d.id} withdrawn. The gap is back on the open list and a change request is drafted.`,
    });

  return (
    <PortalV2Shell eyebrow="Operate" title="Policy Decisions">
      <div style={{ minHeight: "100%", background: SIDEBAR_WASH }}>
        <div
          style={{
            maxWidth: 1180,
            margin: "0 auto",
            padding: "26px 28px 60px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {/* ── Header — proto 4581-4587 ─────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <span
                data-testid="pv2-pd-heading"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  fontSize: "22px",
                  fontWeight: 800,
                  color: "#f8fafc",
                  letterSpacing: "-.02em",
                }}
              >
                Policy Decisions <PdInfoDot />
              </span>
              <span
                data-testid="pv2-pd-sub"
                style={{
                  fontSize: "13px",
                  color: "#94a3b8",
                  lineHeight: 1.6,
                  maxWidth: "82ch",
                  textWrap: "pretty",
                }}
              >
                Gaps you have decided to live with. An undocumented gap is a finding on every scan and
                every audit; a documented one is a position, with a name against it, a compensating
                control, and a date it gets looked at again. This page is where those dates are kept
                honest.
              </span>
            </div>
            <button
              onClick={recordDecision}
              data-testid="pv2-pd-new"
              style={{
                flex: "0 0 auto",
                padding: "9px 15px",
                borderRadius: 7,
                border: "1px solid #0078D4",
                background: "#0078D4",
                color: "#fff",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              Record a decision
            </button>
          </div>

          {/*
            Live-read state. Not in the prototype, and deliberately added: these
            counters now count the customer's REAL decisions, so four zeroes has
            two very different causes — no decisions recorded, and a read that
            failed. Saying nothing would assert the first while the second held.
          */}
          {(loading || error) && (
            <div
              data-testid="pv2-pd-status"
              style={{
                marginBottom: 10,
                padding: "9px 12px",
                borderRadius: 8,
                fontSize: "12px",
                border: `1px solid ${error ? "rgba(248,113,113,.4)" : "rgba(148,163,184,.25)"}`,
                background: error ? "rgba(248,113,113,.08)" : "transparent",
                color: error ? "#f87171" : "#94a3b8",
              }}
            >
              {error
                ? "Your policy decisions could not be loaded, so this page is not showing your current positions."
                : "Loading your policy decisions…"}
            </div>
          )}

          {/* ── State counters — proto 4589-4597. Each is a filter. ──────── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
              gap: 10,
            }}
            data-testid="pv2-pd-states"
          >
            {cards.map((c) => (
              <button
                key={c.key}
                onClick={() => toggleFilter(c.key)}
                data-testid={`pv2-pd-state-${c.key}`}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: "12px 14px",
                  borderRadius: 11,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                  border: `1px solid ${c.tone}${c.active ? "99" : "33"}`,
                  background: `linear-gradient(160deg,${c.tone}${c.active ? "22" : "10"},rgba(15,23,42,.5))`,
                }}
              >
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".11em",
                    textTransform: "uppercase",
                    color: c.tone,
                  }}
                >
                  {c.label}
                </span>
                <span
                  style={{
                    fontSize: "22px",
                    fontWeight: 800,
                    letterSpacing: "-.02em",
                    color: "#f8fafc",
                    fontFamily: MONO,
                  }}
                >
                  {c.value}
                </span>
                <span style={{ fontSize: "10px", color: "#64748b", lineHeight: 1.35 }}>{c.sub}</span>
              </button>
            ))}
          </div>
          <span data-testid="pv2-pd-filter-note" style={{ fontSize: "10.5px", color: "#64748b" }}>
            {note}
          </span>

          {/* ── The decisions — proto 4600-4654 ──────────────────────────── */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid rgba(30,41,59,.9)",
              borderRadius: 12,
              background: "rgba(15,23,42,.4)",
              overflow: "hidden",
            }}
            data-testid="pv2-pd-rows"
          >
            {rows.map((d) => (
              <PolicyRow
                key={d.id}
                d={d}
                open={open === d.id}
                onToggle={() => setOpen((o) => (o === d.id ? null : d.id))}
                onSign={() => signOff(d)}
                onRenew={() => renew(d)}
                onWithdraw={() => withdraw(d)}
              />
            ))}
          </div>
        </div>
      </div>

      {formElement}
    </PortalV2Shell>
  );
}

function PolicyRow({
  d,
  open,
  onToggle,
  onSign,
  onRenew,
  onWithdraw,
}: {
  d: PolicyDecision;
  open: boolean;
  onToggle: () => void;
  onSign: () => void;
  onRenew: () => void;
  onWithdraw: () => void;
}) {
  const badge = pdRowBadge(d.state);
  const { canSign, canRenew } = pdActions(d.state);

  return (
    <div
      data-testid={`pv2-pd-row-${d.id}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        borderLeft: `2px solid ${badge.tone}`,
        borderTop: "1px solid rgba(30,41,59,.8)",
        background: open ? "rgba(148,163,184,.04)" : "transparent",
      }}
    >
      <button
        onClick={onToggle}
        data-testid={`pv2-pd-toggle-${d.id}`}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "14px 18px",
          border: "none",
          background: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
          width: "100%",
        }}
      >
        <span
          style={{
            flex: "0 0 auto",
            display: "flex",
            marginTop: 3,
            transform: `rotate(${open ? 180 : -90}deg)`,
            transition: "transform 180ms",
          }}
        >
          <ChevronDown size={13} color="#64748b" />
        </span>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: "10.5px",
                fontWeight: 700,
                color: "#64748b",
                letterSpacing: ".06em",
                fontFamily: MONO,
              }}
            >
              {d.id}
            </span>
            <span
              style={{
                flex: "0 0 auto",
                padding: "3px 9px",
                borderRadius: 5,
                border: `1px solid ${badge.tone}55`,
                background: `${badge.tone}14`,
                fontSize: "9.5px",
                fontWeight: 700,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: badge.tone,
                whiteSpace: "nowrap",
              }}
            >
              {badge.label}
            </span>
            <span style={{ fontSize: "10px", color: "#475569" }}>{d.pillar}</span>
          </div>
          <span
            style={{
              fontSize: "13.5px",
              fontWeight: 700,
              color: "#f1f5f9",
              lineHeight: 1.4,
              textWrap: "pretty",
            }}
          >
            {d.title}
          </span>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "#cbd5e1",
              fontFamily: MONO,
            }}
          >
            {d.obligation}
          </span>
        </div>
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 1,
            textAlign: "right",
          }}
        >
          <span
            style={{
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: ".09em",
              textTransform: "uppercase",
              color: "#475569",
            }}
          >
            Next review
          </span>
          <span
            style={{
              fontSize: "11.5px",
              fontWeight: 700,
              color: "#cbd5e1",
              fontFamily: MONO,
            }}
          >
            {d.review}
          </span>
        </div>
      </button>

      {open && (
        <div
          data-testid={`pv2-pd-open-${d.id}`}
          style={{
            padding: "0 18px 18px 44px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* meta2 — proto 4621-4628 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
              gap: 10,
              padding: "12px 14px",
              border: "1px solid rgba(30,41,59,.9)",
              borderRadius: 9,
              background: "rgba(2,6,23,.4)",
            }}
          >
            {pdMetaFields(d).map((m) => (
              <div
                key={m.k}
                style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}
              >
                <span
                  style={{
                    fontSize: "9px",
                    fontWeight: 700,
                    letterSpacing: ".09em",
                    textTransform: "uppercase",
                    color: "#64748b",
                  }}
                >
                  {m.k}
                </span>
                <span
                  style={{
                    fontSize: "11.5px",
                    fontWeight: 600,
                    color: "#e2e8f0",
                    fontFamily: MONO,
                  }}
                >
                  {m.v}
                </span>
              </div>
            ))}
          </div>

          {/* Why this is the position — proto 4629-4632 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span
              style={{
                fontSize: "9.5px",
                fontWeight: 700,
                letterSpacing: ".09em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              Why this is the position
            </span>
            <span
              style={{ fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.65, textWrap: "pretty" }}
            >
              {d.rationale}
            </span>
          </div>

          {/* Compensating control — proto 4633-4636 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span
              style={{
                fontSize: "9.5px",
                fontWeight: 700,
                letterSpacing: ".09em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              Compensating control
            </span>
            <span
              style={{ fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.65, textWrap: "pretty" }}
            >
              {d.compensating}
            </span>
          </div>

          {/* Where it stands today — proto 4637-4640 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 3,
              padding: "11px 13px",
              borderRadius: 9,
              border: "1px solid rgba(148,163,184,.18)",
              background: "rgba(148,163,184,.05)",
            }}
          >
            <span
              style={{
                fontSize: "9.5px",
                fontWeight: 700,
                letterSpacing: ".09em",
                textTransform: "uppercase",
                color: "#94a3b8",
              }}
            >
              Where it stands today
            </span>
            <span style={{ fontSize: "12px", color: "#e2e8f0", lineHeight: 1.6, textWrap: "pretty" }}>
              {d.check}
            </span>
          </div>

          {/* Actions — proto 4641-4649 */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {canSign && (
              <button
                onClick={onSign}
                data-testid={`pv2-pd-sign-${d.id}`}
                style={{
                  padding: "8px 13px",
                  borderRadius: 7,
                  border: "1px solid #0078D4",
                  background: "#0078D4",
                  color: "#fff",
                  fontSize: "11.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Sign it off
              </button>
            )}
            {canRenew && (
              <button
                onClick={onRenew}
                data-testid={`pv2-pd-renew-${d.id}`}
                style={{
                  padding: "8px 13px",
                  borderRadius: 7,
                  border: "1px solid rgba(52,211,153,.45)",
                  background: "rgba(52,211,153,.1)",
                  color: "#34d399",
                  fontSize: "11.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Renew it
              </button>
            )}
            <button
              onClick={onWithdraw}
              data-testid={`pv2-pd-withdraw-${d.id}`}
              style={{
                padding: "8px 13px",
                borderRadius: 7,
                border: "1px solid rgba(148,163,184,.24)",
                background: "transparent",
                color: "#94a3b8",
                fontSize: "11.5px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Withdraw and fix instead
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
