/**
 * portal-v2-risk-register.tsx — the Risk Register.
 *
 * A direct port of the prototype's `isRiskRegister` block
 * ('Customer Portal Shell.dc.html' lines 802-996) and its derivation
 * (15253-15355, transcribed into `riskRegisterModel.ts`).
 *
 * ── What this page argues ──────────────────────────────────────────────────
 * The prototype's own comment above the fixture (15149-15151) states the model:
 * "a risk-based decision record rather than a control catalogue: identify,
 * understand, decide. An accepted risk is devalued in scoring and its alerts
 * are suppressed — but monitoring continues, and a material change reopens it."
 *
 * Every structural choice follows from that, and each is reproduced rather than
 * interpreted:
 *  • Weight is shown as a NEGATIVE ('−9 pts'), because the register's unit is
 *    what a risk COSTS the score, not an abstract rating.
 *  • Two totals sit side by side in the stat row — suppressed by acceptance,
 *    and still counting — so the page cannot claim acceptance is free.
 *  • Every expanded row restates, in its own words and with its own number,
 *    what accepting THAT risk would move. `riskScoreNote` has three branches.
 *  • An accepted risk keeps its full row. It is never removed or greyed out of
 *    existence; it gains a decision block naming who decided, when, and until
 *    when.
 *
 * ── SIX BUTTONS ARE INERT BY DESIGN ────────────────────────────────────────
 * Export register (809), Extend the review date (967), Withdraw acceptance
 * (968), Remediate instead (969), Remediate this risk (976) and Assign an owner
 * (984) carry NO onClick in the prototype. Only the row toggle (873), Ask
 * ShaneBot (935) and Accept this risk (980) are wired.
 *
 * They render exactly as designed and do nothing. No mutation was invented for
 * them, for the same reason the Change Control pass did not invent approve or
 * rollback: withdrawing an acceptance or reassigning a risk owner is an
 * authority, and there is no customer capability flag behind it — the two that
 * exist (`canApprovePurchases`, `canManageTeam`) are spend and roster. Wiring
 * these would be inventing a permission model, not building a page.
 *
 * ── Deep links ─────────────────────────────────────────────────────────────
 * The prototype enters this page from three pillar pages with a pillar
 * preselected and row 0 open (18014-18016). Those become `?pillar=Governance`
 * here, because a shell that switches on `active` has in-memory state where
 * this build has a URL. The seed is re-read whenever the query string changes,
 * not only on mount — see the note on `lastSearch` below for why that is a
 * correctness requirement rather than a nicety.
 */

import { useState } from "react";
import { useSearch } from "wouter";
import { ChevronDown } from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { useAcceptRisk, type AcceptRiskSpec } from "@/components/portal-v2/AcceptRiskPanel";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { type RiskEntry } from "@/components/portal-v2/riskRegisterData";
import {
  RR_DEFAULT_EXPANDED,
  RR_DEFAULT_FILTERS,
  RR_EMPTY_ACCEPTANCE,
  RR_PILLAR_META,
  RR_SELECTS,
  RR_SEV_META,
  RR_STATS,
  RR_STATUS_META,
  RR_SUPPRESSED_LABEL,
  riskAcceptSpec,
  riskAskTopic,
  riskCanAccept,
  riskImpactText,
  riskLikelihoodText,
  riskMatrix,
  riskScoreNote,
  riskWeightText,
  rrExpiring,
  rrFiltered,
  type RiskFilterKey,
  type RiskFilterState,
} from "@/components/portal-v2/riskRegisterModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

/** The row grid — declared once because the header and every row must agree. */
const ROW_GRID =
  "22px minmax(0,2fr) minmax(120px,.8fr) minmax(90px,.6fr) minmax(120px,.8fr) minmax(120px,.8fr) 66px";

const COL_HEAD: React.CSSProperties = {
  fontSize: "9px",
  fontWeight: 700,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "#64748b",
};

const FIELD_LABEL: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "#64748b",
};

/** The three inert action buttons on an acceptance, and the two below it. */
const INERT_BTN: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  fontSize: "11px",
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

/**
 * `?pillar=` stands in for the prototype's `goRiskGov`/`goRiskSec`/`goRiskCmp`,
 * which set `rrPillar` and open row 0. An unrecognised value is ignored rather
 * than filtering the register down to nothing.
 */
function seedFrom(search: string): RiskFilterState {
  const wanted = new URLSearchParams(search).get("pillar");
  const valid = RR_SELECTS.find((s) => s.key === "pillar")!.options;
  return wanted && valid.includes(wanted)
    ? { ...RR_DEFAULT_FILTERS, pillar: wanted }
    : RR_DEFAULT_FILTERS;
}

export default function PortalV2RiskRegisterPage() {
  const search = useSearch();

  const [filters, setFilters] = useState<RiskFilterState>(() => seedFrom(search));
  // An INDEX into the filtered list, not a risk id — see the model's header.
  const [expanded, setExpanded] = useState<number | null>(RR_DEFAULT_EXPANDED);

  /**
   * Re-seed when, and only when, the QUERY STRING ITSELF changes.
   *
   * This is not belt-and-braces; without it the page is genuinely wrong, and
   * the manifest caught it. A `goto` reloads the app and remounts, so a deep
   * link seeds correctly — but the sidebar's own nav row is a wouter `<Link>`,
   * which changes the path CLIENT-SIDE without remounting. Arriving at the
   * register from the Health page (`?pillar=Security`) and then clicking
   * "Risk Register" in the sidebar left the Security filter applied while the
   * URL carried no `?pillar=` at all: the same URL rendered two different pages
   * depending on how you got there, which makes the deep link non-idempotent.
   *
   * The prototype cannot arbitrate this — it has no URLs, and its nav sets
   * `active` without touching `rrPillar`, so its filter does persist. But
   * `?pillar=` is this build's carrier for `goRisk*`, and having introduced it,
   * a URL with no pillar has to mean no pillar filter.
   *
   * Comparing against the last-seen search rather than running on every render
   * is what keeps this from fighting the user's own use of the selects: those
   * change `filters` without touching the URL, so this branch does not fire.
   * `rrExpanded` resets to 0 alongside, exactly as goRiskGov/Sec/Cmp do.
   */
  const [lastSearch, setLastSearch] = useState(search);
  if (search !== lastSearch) {
    setLastSearch(search);
    setFilters(seedFrom(search));
    setExpanded(RR_DEFAULT_EXPANDED);
  }

  const { openForm, formElement } = useFormDrawer();

  const askShaneBot = (topic: string) =>
    openForm({
      kicker: "Ask ShaneBot",
      title: "Ask about this risk",
      intro: topic,
      submitLabel: "Send to ShaneBot",
      fields: [
        {
          id: "question",
          label: "Your question",
          kind: "textarea",
          wide: true,
          placeholder: "What would you like to know about this risk?",
        },
      ],
      doneTitle: "Sent",
      doneNote:
        "ShaneBot has the risk and your tenant context. The reply appears in your chat panel.",
    });

  /**
   * Confirming an acceptance opens the record-keeping form rather than mutating
   * anything: the panel captures the DECISION, and an acceptance is only real
   * once it carries an owner, a rationale and a review date.
   */
  const { openAcceptRisk, acceptRiskElement } = useAcceptRisk({
    onConfirm: (spec: AcceptRiskSpec) =>
      openForm({
        kicker: "Risk-based decision",
        title: "Record this acceptance",
        intro: spec.title,
        submitLabel: "Record the decision",
        fields: [
          { id: "owner", label: "Accepting owner", placeholder: "Name and role" },
          { id: "until", label: "Review by", placeholder: "e.g. 1 March 2027" },
          {
            id: "why",
            label: "Rationale",
            kind: "textarea",
            wide: true,
            placeholder: "Why this risk is being accepted rather than fixed.",
          },
          {
            id: "compensating",
            label: "Compensating controls relied on",
            kind: "textarea",
            wide: true,
            placeholder: "What reduces this risk in the meantime.",
          },
        ],
        doneNote:
          "Recorded. The risk stays on the register as an accepted decision, its points are suppressed, and monitoring continues.",
      }),
    onAskShaneBot: askShaneBot,
  });

  const rows = rrFiltered(filters);
  const expiring = rrExpiring();

  const setFilter = (key: RiskFilterKey, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    // The prototype leaves `rrExpanded` alone when a filter changes, so the same
    // ORDINAL stays open on a different risk. Reproduced deliberately — see the
    // model's header note 3.
  };

  return (
    <PortalV2Shell eyebrow="Operate" title="Risk Register">
      <div
        style={{
          position: "relative",
          maxWidth: 1320,
          margin: "0 auto",
          padding: "26px 26px 48px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxSizing: "border-box",
        }}
      >
        {/* ── Header — proto 804-810 ──────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            paddingBottom: 13,
            borderBottom: "1px solid rgba(30,41,59,.9)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <span
              style={{
                fontSize: "18px",
                fontWeight: 800,
                color: "#f8fafc",
                letterSpacing: "-.015em",
              }}
              data-testid="pv2-rr-heading"
            >
              Risk Register
            </span>
            <span
              style={{
                fontSize: "12.5px",
                color: "#94a3b8",
                lineHeight: 1.55,
                maxWidth: "86ch",
              }}
            >
              Every risk we have identified in your tenant, what it would actually mean, and what
              you have decided about it. Accepting a risk is a real decision recorded with an owner
              and a review date — not a way to make a finding disappear.
            </span>
          </div>
          {/* INERT — no onClick in the prototype (809). */}
          <button
            data-testid="pv2-rr-export"
            style={{
              flex: "0 0 auto",
              whiteSpace: "nowrap",
              padding: "8px 14px",
              borderRadius: 7,
              fontSize: "12px",
              fontWeight: 600,
              border: "1px solid rgba(148,163,184,.24)",
              background: "transparent",
              color: "#94a3b8",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Export register
          </button>
        </div>

        {/* ── Stat cards — proto 812-820 ──────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
            gap: 10,
          }}
          data-testid="pv2-rr-stats"
        >
          {RR_STATS.map((s) => (
            <div
              key={s.label}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "13px 15px",
                borderRadius: 10,
                border: `1px solid ${s.c}30`,
                background: `linear-gradient(160deg, ${s.c}0e, rgba(15,23,42,.45))`,
              }}
            >
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".11em",
                  textTransform: "uppercase",
                  color: "#64748b",
                  lineHeight: 1.3,
                }}
              >
                {s.label}
              </span>
              <span
                style={{
                  fontSize: "20px",
                  fontWeight: 800,
                  letterSpacing: "-.02em",
                  color: "#f8fafc",
                  fontFamily: MONO,
                }}
              >
                {s.value}
              </span>
              <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.35 }}>{s.sub}</span>
            </div>
          ))}
        </div>

        {/* ── The acceptance explainer — proto 822-827. This paragraph is the
            page's whole thesis, and its number is computed, not stated. ── */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "13px 16px",
            border: "1px solid rgba(167,139,250,.28)",
            borderLeft: "2px solid #a78bfa",
            borderRadius: 11,
            background: "rgba(167,139,250,.05)",
          }}
          data-testid="pv2-rr-explainer"
        >
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                fontSize: "9.5px",
                fontWeight: 700,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: "#a78bfa",
              }}
            >
              How acceptance affects scoring and monitoring
            </span>
            <span
              style={{
                fontSize: "12px",
                color: "#e2e8f0",
                lineHeight: 1.6,
                textWrap: "pretty",
              }}
            >
              An accepted risk stops costing you score — {RR_SUPPRESSED_LABEL} are currently
              suppressed across your pillars — and its alerts are muted so it does not keep arriving
              as news. What does not stop is the checking: every scan still evaluates it, and if the
              underlying facts move materially, or the acceptance passes its review date, the points
              come back and the alerting resumes. That is the difference between accepting a risk
              and ignoring one.
            </span>
          </div>
        </div>

        {/* ── Acceptances needing attention — proto 829-844 ───────────── */}
        {expiring.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid rgba(251,146,60,.26)",
              borderRadius: 11,
              background: "rgba(251,146,60,.04)",
              overflow: "hidden",
            }}
            data-testid="pv2-rr-expiring"
          >
            <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(251,146,60,.14)" }}>
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".16em",
                  textTransform: "uppercase",
                  color: "#fb923c",
                }}
              >
                Acceptances needing attention · {expiring.length}
              </span>
            </div>
            {expiring.map((e) => (
              <div
                key={e.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 14px",
                  borderBottom: "1px solid rgba(251,146,60,.1)",
                }}
                data-testid={`pv2-rr-expiring-${e.id}`}
              >
                <span
                  style={{
                    fontSize: "10.5px",
                    fontWeight: 700,
                    color: "#cbd5e1",
                    fontFamily: MONO,
                  }}
                >
                  {e.id}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: "11.5px",
                    color: "#e2e8f0",
                    lineHeight: 1.45,
                  }}
                >
                  {e.title}
                </span>
                <span style={{ fontSize: "10.5px", color: "#64748b", whiteSpace: "nowrap" }}>
                  {e.owner}
                </span>
                <span style={{ fontSize: "10.5px", color: "#94a3b8", whiteSpace: "nowrap" }}>
                  {e.when}
                </span>
                <span
                  style={{
                    flex: "0 0 auto",
                    padding: "2px 7px",
                    borderRadius: 4,
                    border: `1px solid ${
                      e.tone === "Expired" ? "rgba(251,146,60,.45)" : "rgba(148,163,184,.3)"
                    }`,
                    background:
                      e.tone === "Expired" ? "rgba(251,146,60,.1)" : "rgba(148,163,184,.07)",
                    fontSize: "9px",
                    fontWeight: 700,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    color: e.tone === "Expired" ? "#fb923c" : "#94a3b8",
                    whiteSpace: "nowrap",
                  }}
                >
                  {e.tone}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Filters — proto 846-858 ─────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
          {RR_SELECTS.map((f) => (
            <div
              key={f.key}
              style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}
            >
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 700,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "#475569",
                }}
              >
                {f.label}
              </span>
              <select
                value={filters[f.key]}
                onChange={(e) => setFilter(f.key, e.target.value)}
                aria-label={f.label}
                data-testid={`pv2-rr-filter-${f.key}`}
                style={{
                  minWidth: 150,
                  padding: "7px 10px",
                  borderRadius: 7,
                  border: "1px solid rgba(30,41,59,.9)",
                  background: "#0b1a2e",
                  color: "#e2e8f0",
                  fontSize: "11.5px",
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <span
            style={{ fontSize: "10.5px", color: "#475569", paddingBottom: 8, marginLeft: "auto" }}
            data-testid="pv2-rr-count"
          >
            {rows.length} risks shown
          </span>
        </div>

        {/* ── The register — proto 860-994 ────────────────────────────── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 0,
            border: "1px solid rgba(30,41,59,.9)",
            borderRadius: 12,
            background: "rgba(15,23,42,.35)",
            overflow: "hidden",
          }}
          data-testid="pv2-rr-table"
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: ROW_GRID,
              gap: 12,
              padding: "9px 16px",
              borderBottom: "1px solid rgba(30,41,59,.9)",
              background: "rgba(148,163,184,.04)",
            }}
          >
            <span />
            <span style={COL_HEAD}>Risk</span>
            <span style={COL_HEAD}>Pillar</span>
            <span style={COL_HEAD}>Severity</span>
            <span style={COL_HEAD}>Status</span>
            <span style={COL_HEAD}>Owner · review</span>
            <span style={{ ...COL_HEAD, textAlign: "right" }}>Score</span>
          </div>

          {rows.map((r, i) => (
            <RiskRow
              key={r.id}
              r={r}
              expanded={expanded === i}
              onToggle={() => setExpanded(expanded === i ? null : i)}
              onAsk={() => askShaneBot(riskAskTopic(r))}
              onAccept={() => openAcceptRisk(riskAcceptSpec(r))}
            />
          ))}
        </div>
      </div>

      {acceptRiskElement}
      {formElement}
    </PortalV2Shell>
  );
}

function RiskRow({
  r,
  expanded,
  onToggle,
  onAsk,
  onAccept,
}: {
  r: RiskEntry;
  expanded: boolean;
  onToggle: () => void;
  onAsk: () => void;
  onAccept: () => void;
}) {
  const sevC = RR_SEV_META[r.inherent];
  const resC = RR_SEV_META[r.residual];
  const stC = RR_STATUS_META[r.status];
  const pC = RR_PILLAR_META[r.pillar];
  const isAccepted = r.status === "Accepted";
  const acceptance = r.accepted ?? RR_EMPTY_ACCEPTANCE;

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        borderTop: "1px solid rgba(30,41,59,.85)",
        // The prototype writes both backgrounds, so expanded WINS over accepted
        // when a row is both — the later declaration in its style string.
        background: expanded
          ? "rgba(96,165,250,.03)"
          : isAccepted
            ? "rgba(167,139,250,.03)"
            : undefined,
      }}
      data-testid={`pv2-rr-row-${r.id}`}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 2,
          background: `${stC}99`,
        }}
      />
      <button
        onClick={onToggle}
        data-testid={`pv2-rr-toggle-${r.id}`}
        style={{
          display: "grid",
          gridTemplateColumns: ROW_GRID,
          gap: 12,
          alignItems: "start",
          padding: "11px 16px",
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
            display: "flex",
            marginTop: 2,
            transform: `rotate(${expanded ? 180 : -90}deg)`,
            transition: "transform 180ms",
          }}
        >
          <ChevronDown size={13} color="#64748b" />
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span
            style={{ fontSize: "10px", fontWeight: 700, color: "#64748b", fontFamily: MONO }}
          >
            {r.id}
          </span>
          <span
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: "#e2e8f0",
              lineHeight: 1.4,
              textWrap: "pretty",
            }}
          >
            {r.title}
          </span>
        </div>
        <span style={{ display: "flex" }}>
          <span
            style={{
              flex: "0 0 auto",
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "2px 8px",
              borderRadius: 4,
              border: `1px solid ${pC}44`,
              background: `${pC}12`,
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: pC,
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{ width: 5, height: 5, borderRadius: "50%", background: pC, flex: "0 0 5px" }}
            />
            {r.pillar}
          </span>
        </span>
        {/* Both severities, always. The filter only sees the first of them. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
          <span
            style={{
              flex: "0 0 auto",
              padding: "2px 8px",
              borderRadius: 4,
              border: `1px solid ${sevC}55`,
              background: `${sevC}14`,
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: sevC,
              whiteSpace: "nowrap",
            }}
          >
            {r.inherent}
          </span>
          <span style={{ fontSize: "11px", fontWeight: 700, color: resC, fontFamily: MONO }}>
            → {r.residual}
          </span>
        </div>
        <span style={{ display: "flex" }}>
          <span
            style={{
              flex: "0 0 auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 8px",
              borderRadius: 4,
              border: `1px solid ${stC}55`,
              background: `${stC}14`,
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: stC,
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{ width: 5, height: 5, borderRadius: "50%", background: stC, flex: "0 0 5px" }}
            />
            {r.status}
          </span>
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: "11px", color: "#e2e8f0", lineHeight: 1.4 }}>{r.owner}</span>
          <span style={{ fontSize: "10px", color: "#64748b" }}>{r.review}</span>
        </div>
        <span
          style={{
            fontSize: "11.5px",
            fontWeight: 700,
            color: "#94a3b8",
            textAlign: "right",
            fontFamily: MONO,
          }}
        >
          {riskWeightText(r)}
        </span>
      </button>

      {expanded && (
        <div
          style={{
            padding: "0 16px 16px 40px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
          data-testid={`pv2-rr-open-${r.id}`}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1.9fr) minmax(150px,.7fr)",
              gap: 16,
              alignItems: "start",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={FIELD_LABEL}>What it is</span>
                <span
                  style={{
                    fontSize: "12px",
                    color: "#e2e8f0",
                    lineHeight: 1.6,
                    textWrap: "pretty",
                  }}
                >
                  {r.what}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={FIELD_LABEL}>What it would mean</span>
                <span
                  style={{
                    fontSize: "12px",
                    color: "#cbd5e1",
                    lineHeight: 1.6,
                    textWrap: "pretty",
                  }}
                >
                  {r.outcome}
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
                  gap: "8px 18px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={FIELD_LABEL}>Evidence</span>
                  <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5 }}>
                    {r.evidence}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={FIELD_LABEL}>Controls already in place</span>
                  {r.controls.map((c) => (
                    <span
                      key={c}
                      style={{ fontSize: "11px", color: "#cbd5e1", lineHeight: 1.5 }}
                    >
                      · {c}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={FIELD_LABEL}>Current plan</span>
                <span
                  style={{
                    fontSize: "11.5px",
                    color: "#cbd5e1",
                    lineHeight: 1.55,
                    textWrap: "pretty",
                  }}
                >
                  {r.plan}
                </span>
              </div>
            </div>

            {/* The 5x5 grid. Impact rises UP it, likelihood across. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <span style={FIELD_LABEL}>Likelihood × impact</span>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5,1fr)",
                  gap: 3,
                  maxWidth: 140,
                }}
                data-testid={`pv2-rr-matrix-${r.id}`}
              >
                {riskMatrix(r.likelihood, r.impact).map((m, k) => (
                  <span
                    key={k}
                    style={{
                      width: "100%",
                      aspectRatio: "1",
                      borderRadius: 3,
                      background: m.here ? m.c : `${m.c}1a`,
                      border: `1px solid ${m.here ? m.c : "transparent"}`,
                      boxShadow: m.here ? "0 0 0 2px rgba(226,232,240,.25)" : "none",
                    }}
                  />
                ))}
              </div>
              <span style={{ fontSize: "10.5px", color: "#94a3b8", lineHeight: 1.45 }}>
                {riskLikelihoodText(r)} · {riskImpactText(r)}
              </span>
              <span style={{ fontSize: "10px", color: "#475569", lineHeight: 1.45 }}>
                Impact rises up the grid, likelihood across it.
              </span>
            </div>
          </div>

          {/* The row's own restatement of what its weight costs — proto 932-936. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 5,
              padding: "11px 13px",
              border: "1px solid rgba(148,163,184,.2)",
              borderRadius: 9,
              background: "rgba(15,23,42,.5)",
            }}
          >
            <span style={FIELD_LABEL}>Effect on scoring and monitoring</span>
            <span
              style={{
                fontSize: "11.5px",
                color: "#e2e8f0",
                lineHeight: 1.6,
                textWrap: "pretty",
              }}
              data-testid={`pv2-rr-scorenote-${r.id}`}
            >
              {riskScoreNote(r)}
            </span>
            <button
              onClick={onAsk}
              data-testid={`pv2-rr-ask-${r.id}`}
              style={{
                alignSelf: "flex-start",
                background: "none",
                border: "none",
                padding: 0,
                fontSize: "11px",
                color: "#22d3ee",
                cursor: "pointer",
                fontFamily: "inherit",
                textDecoration: "underline",
                textDecorationColor: "rgba(34,211,238,.4)",
                textUnderlineOffset: 3,
              }}
            >
              Ask ShaneBot whether accepting this is defensible
            </button>
          </div>

          {/* ── The decision on record — proto 938-972 ──────────────── */}
          {isAccepted && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "13px 14px",
                border: "1px solid rgba(167,139,250,.3)",
                borderLeft: "2px solid #a78bfa",
                borderRadius: 10,
                background: "rgba(167,139,250,.05)",
              }}
              data-testid={`pv2-rr-decision-${r.id}`}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "#a78bfa",
                  }}
                >
                  Risk-based decision on record
                </span>
                <span style={{ fontSize: "10px", color: "#64748b", fontFamily: MONO }}>
                  {acceptance.register}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={FIELD_LABEL}>Rationale</span>
                <span
                  style={{
                    fontSize: "11.5px",
                    color: "#e2e8f0",
                    lineHeight: 1.6,
                    textWrap: "pretty",
                  }}
                >
                  {acceptance.why}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={FIELD_LABEL}>Compensating controls relied on</span>
                <span
                  style={{
                    fontSize: "11.5px",
                    color: "#cbd5e1",
                    lineHeight: 1.6,
                    textWrap: "pretty",
                  }}
                >
                  {acceptance.compensating}
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
                  gap: 8,
                  paddingTop: 8,
                  borderTop: "1px solid rgba(167,139,250,.16)",
                }}
              >
                {[
                  { label: "Accepted by", value: acceptance.by, mono: false },
                  { label: "On", value: acceptance.on, mono: true },
                  { label: "Review by", value: acceptance.until, mono: true },
                ].map((f) => (
                  <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ ...FIELD_LABEL, letterSpacing: ".07em" }}>{f.label}</span>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "#e2e8f0",
                        ...(f.mono ? { fontFamily: MONO } : null),
                      }}
                    >
                      {f.value}
                    </span>
                  </div>
                ))}
              </div>
              {/* All three INERT — proto 967-969 carry no onClick. */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>
                <button
                  data-testid={`pv2-rr-extend-${r.id}`}
                  style={{
                    ...INERT_BTN,
                    border: "1px solid rgba(148,163,184,.24)",
                    background: "transparent",
                    color: "#94a3b8",
                  }}
                >
                  Extend the review date
                </button>
                <button
                  data-testid={`pv2-rr-withdraw-${r.id}`}
                  style={{
                    ...INERT_BTN,
                    border: "1px solid rgba(248,113,113,.35)",
                    background: "transparent",
                    color: "#f87171",
                  }}
                >
                  Withdraw acceptance
                </button>
                <button
                  style={{
                    ...INERT_BTN,
                    border: "1px solid rgba(0,120,212,.4)",
                    background: "rgba(0,120,212,.1)",
                    fontWeight: 700,
                    color: "#60a5fa",
                  }}
                >
                  Remediate instead
                </button>
              </div>
            </div>
          )}

          {/* ── The three decisions available — proto 974-989 ───────── */}
          {riskCanAccept(r) && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))",
                gap: 8,
              }}
              data-testid={`pv2-rr-actions-${r.id}`}
            >
              {/* INERT — proto 976. */}
              <ActionCard
                title="Remediate this risk"
                titleColour="#60a5fa"
                sub="Opens the fix path on its pillar page"
                border="rgba(0,120,212,.4)"
                background="linear-gradient(160deg, rgba(0,120,212,.1), rgba(15,23,42,.3))"
              />
              <ActionCard
                title="Accept this risk"
                titleColour="#a78bfa"
                sub="Owner, rationale, compensating controls, review date"
                border="rgba(167,139,250,.4)"
                background="rgba(167,139,250,.07)"
                onClick={onAccept}
                testId={`pv2-rr-accept-${r.id}`}
              />
              {/* INERT — proto 984. */}
              <ActionCard
                title="Assign an owner"
                titleColour="#e2e8f0"
                sub="Required before a review date can be set"
                border="rgba(148,163,184,.22)"
                background="rgba(148,163,184,.04)"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionCard({
  title,
  titleColour,
  sub,
  border,
  background,
  onClick,
  testId,
}: {
  title: string;
  titleColour: string;
  sub: string;
  border: string;
  background: string;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
        textAlign: "left",
        padding: "11px 13px",
        borderRadius: 9,
        border: `1px solid ${border}`,
        background,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <span style={{ fontSize: "12px", fontWeight: 700, color: titleColour }}>{title}</span>
      <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>{sub}</span>
    </button>
  );
}
