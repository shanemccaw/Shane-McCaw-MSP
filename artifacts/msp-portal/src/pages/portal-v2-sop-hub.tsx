/**
 * portal-v2-sop-hub.tsx — SOPs & Runbooks, the procedure library (ours and yours).
 *
 * Part 6 of PORTAL_V2_PARALLEL_PLAN.md. A direct port of the prototype's
 * `isSopHub` block (`Customer Portal Shell.dc.html` 1633-1978) and its execution
 * slide-over. The three sub-views — library / execution queue / execution
 * history — are the design's nav sub-items under SOPs & Runbooks (portalV2Nav.ts),
 * each a real URL: `/portal-v2/sops`, `/portal-v2/sops/queue`,
 * `/portal-v2/sops/audit`.
 *
 * ── Wired to real data ─────────────────────────────────────────────────────
 * Part 6 built this page against the design's own fixtures and said a later pass
 * would wire it. This is that pass. Every value on screen now comes from
 * `useSops()` — `GET /api/portal/sops` and `GET /api/portal/sop-runs`
 * (api-server `routes/portal-sops.ts`), both customer-scoped from the JWT — and
 * every computed shape is still a pure, tested derivation (`sopHubModel.ts`),
 * now taking that payload as an argument. Copy is final and reproduced verbatim.
 *
 * LAYOUT IS UNCHANGED. The only additions are the three states a fixture never
 * had and real data always does: loading, failed, and empty. Each is a single
 * line of text in the flow the design already lays out, not a new surface.
 *
 * ── Two design flows that route through the shell, deliberately simplified ──
 * The prototype's "Execute this SOP" buttons run through `gateRun` (the change-
 * request gate) before opening the execution drawer, and its owner avatars open
 * a shared RACI popover. Both are shell systems this part must not build or
 * touch, so here the execute buttons open the drawer directly and the avatars are
 * static (name on hover via `title`). The drawer itself — the design's real
 * execution surface — is built in full, timer and all.
 */

import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { Check, ChevronDown, Search, X } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import {
  changeRequestBodyForSop,
  postChangeRequest,
  type ChangeRequestCreated,
} from "@/components/portal-v2/ccCreateChangeRequest";
import {
  css,
  MONO,
  SOP_EXEC_TYPES,
  SOP_SOURCE_OPTIONS,
  type SopAuditItem,
  type SopHoldCounts,
  type SopOwner,
  type SopQueueItem,
  type SopsPayload,
} from "@/components/portal-v2/sopHubData";
import {
  catChips,
  detailFor,
  execStepsFor,
  filterSops,
  holdBanner,
  indexGroups,
  resolveSelectedId,
  sopBaselineCount,
  sopOursCount,
  sopTotalCount,
  statCards,
  type SopExecMode,
  type SopFilterState,
} from "@/components/portal-v2/sopHubModel";
import { useSops } from "@/components/portal-v2/useSops";

/* ── Small shared bits ──────────────────────────────────────────────────── */

/** A colour + alpha suffix, the way the prototype writes it inline. */
const A = (hex: string, suffix: string) => `${hex}${suffix}`;

function OwnerAvatar({ owner, size }: { owner: SopOwner; size: number }) {
  return (
    <span
      title={owner.name}
      style={css(
        "flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:" +
          size +
          "px;height:" +
          size +
          "px;border-radius:50%;font-size:" +
          (size <= 20 ? "8.5px" : "9.5px") +
          ";font-weight:800;letter-spacing:.02em;color:" +
          (owner.unassigned ? "#f87171" : "#0b1524") +
          ";background:" +
          owner.tone +
          ";border:1px solid " +
          (owner.unassigned ? "rgba(248,113,113,.5)" : "transparent"),
      )}
    >
      {owner.init}
    </span>
  );
}

const auditResultTone = (r: SopAuditItem["result"]) =>
  r === "Success" ? "#34d399" : r === "Partial" ? "#c2a63d" : "#f87171";

/* ── Header — proto 1635-1640 ───────────────────────────────────────────── */

function Header({ baseline, ours }: { baseline: number; ours: number }) {
  return (
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
          style={{ fontSize: "18px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.015em" }}
          data-testid="pv2-sop-title"
        >
          SOPs &amp; Runbooks
        </span>
        <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.55, maxWidth: "84ch" }}>
          Every procedure in one library: {baseline} of ours, {ours} written by your team, including
          DR playbooks and the joiner and leaver runbooks. Every step is readable in full — nothing
          sits behind a Run button.
        </span>
      </div>
    </div>
  );
}

/* ── Hold banner — proto 1642-1648 ──────────────────────────────────────── */

function HoldBanner({
  counts,
  onOpenRunbooks,
}: {
  counts: SopHoldCounts | null;
  onOpenRunbooks: () => void;
}) {
  const b = holdBanner(counts);
  // No open hold windows, no banner. The fixture was a fixed four-window
  // snapshot and could never be absent; real counts usually are.
  if (!b) return null;
  return (
    <div
      data-testid="pv2-sop-hold-banner"
      style={css(
        "display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:11px 14px;border:1px solid " +
          (b.due ? "rgba(96,165,250,.35)" : "rgba(30,41,59,.9)") +
          ";border-radius:10px;background:" +
          (b.due ? "rgba(96,165,250,.07)" : "rgba(15,23,42,.4)"),
      )}
    >
      <span
        style={css(
          "flex:0 0 auto;padding:3px 9px;border-radius:5px;border:1px solid " +
            (b.due ? "rgba(96,165,250,.5)" : "rgba(34,211,238,.45)") +
            ";background:" +
            (b.due ? "rgba(96,165,250,.12)" : "rgba(34,211,238,.1)") +
            ";color:" +
            (b.due ? "#93c5fd" : "#22d3ee") +
            ";font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase",
        )}
      >
        {b.tag}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: "12px",
          color: "#cbd5e1",
          lineHeight: 1.55,
          textWrap: "pretty",
        }}
      >
        {b.text}
      </span>
      <button
        type="button"
        onClick={onOpenRunbooks}
        style={{
          flex: "0 0 auto",
          padding: "7px 12px",
          borderRadius: 6,
          border: "1px solid rgba(0,120,212,.5)",
          background: "rgba(0,120,212,.16)",
          color: "#bfdbfe",
          fontSize: "11px",
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Open active runbooks
      </button>
    </div>
  );
}

/* ── Stat cards — proto 1649-1657 ───────────────────────────────────────── */

function StatCards({ data }: { data: SopsPayload }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
        gap: 10,
      }}
    >
      {statCards(data).map((s) => (
        <div
          key={s.label}
          style={css(
            "display:flex;flex-direction:column;gap:4px;padding:13px 15px;border-radius:10px;border:1px solid " +
              A(s.c, "30") +
              ";background:linear-gradient(160deg, " +
              A(s.c, "0e") +
              ", rgba(15,23,42,.45))",
          )}
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
  );
}

/* ── Toolbar — proto 1659-1664 ──────────────────────────────────────────── */

const TOOLBAR_BTN =
  "padding:6px 12px;border-radius:6px;border:1px solid rgba(148,163,184,.22);background:transparent;font-size:11px;font-weight:600;color:#94a3b8;cursor:pointer;font-family:inherit;white-space:nowrap";

function Toolbar() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
        borderBottom: "1px solid rgba(30,41,59,.9)",
        paddingBottom: 2,
      }}
    >
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          gap: 7,
          flexWrap: "wrap",
          paddingBottom: 8,
        }}
      >
        <button type="button" data-testid="pv2-sop-refresh-logs" style={css(TOOLBAR_BTN)}>
          Refresh logs
        </button>
        <button type="button" data-testid="pv2-sop-export-index" style={css(TOOLBAR_BTN)}>
          Export master index PDF
        </button>
      </div>
    </div>
  );
}

/* ── Search + filter selects — proto 1666-1682 ──────────────────────────── */

function SearchAndFilters({
  data,
  filters,
  setFilters,
  resultCount,
}: {
  data: SopsPayload;
  filters: SopFilterState;
  setFilters: (patch: Partial<SopFilterState>) => void;
  resultCount: number;
}) {
  const selects: { label: string; value: string; key: keyof SopFilterState; options: { value: string; label: string }[] }[] = [
    {
      label: "Source",
      value: filters.source,
      key: "source",
      options: SOP_SOURCE_OPTIONS.map((o) => ({ value: o.key, label: o.label })),
    },
    {
      label: "Category",
      value: filters.cat,
      key: "cat",
      // Built from the categories this tenant's library actually uses, not the
      // prototype's fixed six — which would offer filters that match nothing.
      options: data.catOptions.map((c) => ({
        value: c,
        label: c === "All" ? "All categories" : c,
      })),
    },
    {
      label: "Execution type",
      value: filters.type,
      key: "type",
      options: SOP_EXEC_TYPES.map((t) => ({ value: t.key, label: t.label })),
    },
    {
      label: "Compliance tag",
      value: filters.tag,
      key: "tag",
      options: data.tagOptions.map((t) => ({ value: t, label: t })),
    },
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div
        style={{
          flex: "1 1 220px",
          maxWidth: 320,
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "#0b1a2e",
          border: "1px solid rgba(148,163,184,.16)",
          borderRadius: 7,
          padding: "7px 11px",
        }}
      >
        <span style={{ display: "flex", color: "#64748b" }}>
          <Search size={15} color="#64748b" />
        </span>
        <input
          value={filters.query}
          onChange={(e) => setFilters({ query: e.target.value })}
          placeholder="Search title, code or category…"
          data-testid="pv2-sop-search"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#e2e8f0",
            fontSize: "12px",
            fontFamily: "inherit",
            minWidth: 0,
          }}
        />
      </div>
      {selects.map((f) => (
        <div
          key={f.label}
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
            value={f.value}
            onChange={(e) => setFilters({ [f.key]: e.target.value } as Partial<SopFilterState>)}
            style={{
              minWidth: 158,
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
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ))}
      <span
        style={{ fontSize: "10.5px", color: "#475569", marginLeft: "auto", paddingBottom: 8 }}
        data-testid="pv2-sop-result-count"
      >
        {resultCount} shown
      </span>
    </div>
  );
}

/* ── Execution queue sub-view — proto 1684-1742 ─────────────────────────── */

function QueueView({
  queue,
  onOpenChangeControl,
}: {
  queue: readonly SopQueueItem[];
  onOpenChangeControl: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="pv2-sop-queue">
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: "9.5px",
            fontWeight: 700,
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: "#64748b",
          }}
        >
          Live execution queue · {queue.length}
        </span>
        <span style={{ fontSize: "10.5px", color: "#475569" }}>
          Executions run one at a time per tenant so two procedures never touch the same object at
          once
        </span>
      </div>
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
      >
        {queue.map((q) => (
          <QueueRow
            key={q.code}
            q={q}
            open={open === q.code}
            onToggle={() => setOpen((c) => (c === q.code ? null : q.code))}
            onOpenChangeControl={onOpenChangeControl}
          />
        ))}
        {queue.length === 0 && (
          <span
            style={{ padding: "16px 16px", fontSize: "11.5px", color: "#64748b", lineHeight: 1.55 }}
            data-testid="pv2-sop-queue-empty"
          >
            Nothing is executing against your tenant right now. A procedure appears here while it is
            running, and moves to the execution history when it finishes.
          </span>
        )}
      </div>
    </div>
  );
}

function QueueRow({
  q,
  open,
  onToggle,
  onOpenChangeControl,
}: {
  q: SopQueueItem;
  open: boolean;
  onToggle: () => void;
  onOpenChangeControl: () => void;
}) {
  const c = q.state === "Running" ? "#60a5fa" : "#c2a63d";
  // The run's real operator, resolved server-side — not a category string mapped
  // onto one of nine fixture people.
  const owner = q.owner;
  const crIsChange = /^CR-/.test(q.cr);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        borderBottom: "1px solid rgba(30,41,59,.85)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        data-testid={`pv2-sop-queue-${q.code}`}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 9,
          padding: "14px 16px",
          border: "none",
          background: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
          width: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            width: "100%",
          }}
        >
          <div
            style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <span
                style={{
                  display: "flex",
                  transform: `rotate(${open ? 0 : -90}deg)`,
                  transition: "transform 180ms",
                }}
              >
                <ChevronDown size={12} color={c} />
              </span>
              <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#64748b", fontFamily: MONO }}>
                {q.code}
              </span>
              <span
                style={css(
                  "flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:3px 9px;border-radius:5px;border:1px solid " +
                    A(c, "55") +
                    ";background:" +
                    A(c, "14") +
                    ";font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:" +
                    c +
                    ";white-space:nowrap",
                )}
              >
                <span
                  style={{ width: 5, height: 5, borderRadius: "50%", background: c, flex: "0 0 5px" }}
                />
                {q.state}
              </span>
              <span style={{ fontSize: "10px", fontWeight: 600, color: "#94a3b8" }}>{q.mode}</span>
            </div>
            <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.4 }}>
              {q.title}
            </span>
            <span style={{ fontSize: "11px", color: "#94a3b8" }}>{q.step}</span>
            <span style={{ fontSize: "10.5px", color: "#64748b" }}>
              {q.started} · {q.who}
            </span>
          </div>
          <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 9 }}>
            <OwnerAvatar owner={owner} size={22} />
            <span
              style={{ fontSize: "13px", fontWeight: 800, color: "#e2e8f0", fontFamily: MONO }}
            >
              {q.pct}%
            </span>
          </div>
        </div>
        <div
          style={{
            height: 7,
            width: "100%",
            borderRadius: 4,
            background: "rgba(148,163,184,.14)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              borderRadius: 4,
              width: `${q.pct}%`,
              background: "linear-gradient(90deg,#0078D4,#00B4D8)",
            }}
          />
        </div>
      </button>
      {open && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "2px 16px 16px 38px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            {crIsChange && (
              <button
                type="button"
                onClick={onOpenChangeControl}
                style={{
                  padding: "3px 9px",
                  borderRadius: 5,
                  border: "1px solid rgba(96,165,250,.45)",
                  background: "rgba(96,165,250,.12)",
                  color: "#93c5fd",
                  fontSize: "9.5px",
                  fontWeight: 800,
                  cursor: "pointer",
                  fontFamily: MONO,
                }}
              >
                {q.cr}
              </button>
            )}
            <span style={{ fontSize: "10px", color: "#64748b" }}>
              {q.svc} · answers to {owner.name}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {q.steps.map((st, si) => {
              const sc = st.s === "done" ? "#34d399" : st.s === "now" ? "#60a5fa" : "#475569";
              return (
                <div key={si} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span
                    style={css(
                      "flex:0 0 18px;width:18px;height:18px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:800;font-family:" +
                        MONO +
                        ";color:" +
                        (st.s === "todo" ? "#64748b" : "#04121f") +
                        ";background:" +
                        (st.s === "todo" ? "transparent" : sc) +
                        ";border:1px solid " +
                        (st.s === "todo" ? "rgba(148,163,184,.3)" : sc),
                    )}
                  >
                    {st.s === "done" ? "✓" : String(si + 1)}
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: "11.5px",
                        fontWeight: st.s === "now" ? 700 : 600,
                        color: st.s === "todo" ? "#64748b" : "#e2e8f0",
                        lineHeight: 1.45,
                      }}
                    >
                      {st.t}
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        color: st.s === "now" ? "#93c5fd" : "#475569",
                        lineHeight: 1.4,
                      }}
                    >
                      {st.by}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              style={{
                padding: "6px 12px",
                borderRadius: 7,
                border: "1px solid rgba(148,163,184,.22)",
                background: "transparent",
                fontSize: "11px",
                fontWeight: 600,
                color: "#94a3b8",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Watch it run
            </button>
            <button
              type="button"
              style={{
                padding: "6px 12px",
                borderRadius: 7,
                border: "1px solid rgba(248,113,113,.35)",
                background: "transparent",
                fontSize: "11px",
                fontWeight: 600,
                color: "#f87171",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Stop
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Audit sub-view — proto 1744-1774 ───────────────────────────────────── */

const AUDIT_COLS = "minmax(140px,.9fr) minmax(96px,.6fr) minmax(0,1.6fr) minmax(110px,.7fr) 72px 84px";

function AuditView({ audit }: { audit: readonly SopAuditItem[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="pv2-sop-audit">
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: "9.5px",
            fontWeight: 700,
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: "#64748b",
          }}
        >
          Audit history &amp; verification logs
        </span>
        <span style={{ fontSize: "10.5px", color: "#475569" }}>
          Every entry is hashed and exportable — this is the evidence an auditor asks for
        </span>
      </div>
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
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: AUDIT_COLS,
            gap: 12,
            padding: "9px 16px",
            borderBottom: "1px solid rgba(30,41,59,.9)",
            background: "rgba(148,163,184,.04)",
          }}
        >
          {["Timestamp", "SOP", "Action and detail", "Actor"].map((h) => (
            <span
              key={h}
              style={{
                fontSize: "9px",
                fontWeight: 700,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              {h}
            </span>
          ))}
          {["Result", "Hash"].map((h) => (
            <span
              key={h}
              style={{
                fontSize: "9px",
                fontWeight: 700,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: "#64748b",
                textAlign: "right",
              }}
            >
              {h}
            </span>
          ))}
        </div>
        {audit.map((a, i) => {
          const tone = auditResultTone(a.result);
          return (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: AUDIT_COLS,
                gap: 12,
                padding: "10px 16px",
                borderBottom: "1px solid rgba(30,41,59,.8)",
                alignItems: "start",
              }}
            >
              <span style={{ fontSize: "10.5px", color: "#94a3b8", fontFamily: MONO }}>{a.when}</span>
              <span
                style={{ fontSize: "10.5px", fontWeight: 700, color: "#cbd5e1", fontFamily: MONO }}
              >
                {a.code}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span
                  style={{ fontSize: "11.5px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.4 }}
                >
                  {a.action}
                </span>
                <span
                  style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.45, textWrap: "pretty" }}
                >
                  {a.detail}
                </span>
              </div>
              <span style={{ fontSize: "10.5px", color: "#94a3b8", lineHeight: 1.4 }}>{a.actor}</span>
              <span style={{ display: "flex", justifyContent: "flex-end" }}>
                <span
                  style={css(
                    "flex:0 0 auto;padding:2px 7px;border-radius:4px;border:1px solid " +
                      A(tone, "44") +
                      ";background:" +
                      A(tone, "12") +
                      ";font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:" +
                      tone +
                      ";white-space:nowrap",
                  )}
                >
                  {a.result}
                </span>
              </span>
              <span
                style={{
                  fontSize: "10px",
                  color: "#475569",
                  textAlign: "right",
                  fontFamily: MONO,
                }}
              >
                {a.hash}
              </span>
            </div>
          );
        })}
        {audit.length === 0 && (
          <span
            style={{ padding: "16px 16px", fontSize: "11.5px", color: "#64748b", lineHeight: 1.55 }}
            data-testid="pv2-sop-audit-empty"
          >
            No entries yet. This log fills as procedures are published to your library and executed
            against your tenant.
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Library sub-view — proto 1776-1926 ─────────────────────────────────── */

function LibraryView({
  data,
  filters,
  setFilters,
  selId,
  onSelect,
  onExecute,
}: {
  data: SopsPayload;
  filters: SopFilterState;
  setFilters: (patch: Partial<SopFilterState>) => void;
  selId: string | null;
  onSelect: (id: string) => void;
  onExecute: (id: string, mode: SopExecMode) => void;
}) {
  const filtered = filterSops(data, filters);
  const groups = indexGroups(data, filtered);
  const chips = catChips(data, filters.cat);

  return (
    <div
      className="pv2-gov-grid"
      style={{ gridTemplateColumns: "minmax(280px,1fr) minmax(0,1.9fr)" }}
      data-testid="pv2-sop-library"
    >
      {/* Left column (280px) — the index. proto second child, order:-1. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <span
            style={{
              fontSize: "9.5px",
              fontWeight: 700,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            Library
          </span>
          <span style={{ fontSize: "10.5px", color: "#475569" }}>
            {filtered.length} of {sopTotalCount(data)}
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilters({ cat: chip.key })}
              style={css(
                "display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:" +
                  (chip.on ? "800" : "600") +
                  ";border:1px solid " +
                  (chip.on ? "rgba(96,165,250,.55)" : "rgba(148,163,184,.16)") +
                  ";background:" +
                  (chip.on ? "rgba(96,165,250,.12)" : "transparent") +
                  ";color:" +
                  (chip.on ? "#bfdbfe" : "#94a3b8") +
                  ";white-space:nowrap",
              )}
            >
              {chip.label}
              <span
                style={{ fontSize: "9px", fontWeight: 700, color: chip.on ? "#93c5fd" : "#475569" }}
              >
                {chip.n}
              </span>
            </button>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 0,
            border: "1px solid rgba(30,41,59,.75)",
            borderRadius: 12,
            background: "rgba(2,6,23,.35)",
            overflow: "hidden",
            maxHeight: "min(640px,72vh)",
            overflowY: "auto",
          }}
        >
          {groups.map((g) => (
            <div key={g.label} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              <div
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  padding: "7px 13px",
                  background: "#0a1220",
                  borderBottom: "1px solid rgba(30,41,59,.7)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: "8.5px",
                    fontWeight: 800,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "#64748b",
                  }}
                >
                  {g.label}
                </span>
                <span style={{ fontSize: "9.5px", color: "#475569", fontFamily: MONO }}>{g.n}</span>
              </div>
              {g.items.map((s) => {
                const isSel = s.id === selId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSelect(s.id)}
                    data-testid={`pv2-sop-index-${s.id}`}
                    style={css(
                      "display:flex;flex-direction:column;gap:5px;text-align:left;padding:10px 13px;border:none;border-left:2px solid " +
                        (isSel ? s.sourceColor : "transparent") +
                        ";border-bottom:1px solid rgba(30,41,59,.55);background:" +
                        (isSel ? "rgba(96,165,250,.09)" : "transparent") +
                        ";cursor:pointer;font-family:inherit;width:100%;min-width:0",
                    )}
                  >
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: isSel ? 700 : 600,
                        color: isSel ? "#f1f5f9" : "#a9b6c8",
                        lineHeight: 1.4,
                      }}
                    >
                      {s.title}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <span
                        style={css(
                          "flex:0 0 auto;padding:1px 6px;border-radius:4px;border:1px solid " +
                            A(s.sourceColor, "33") +
                            ";background:" +
                            A(s.sourceColor, "0d") +
                            ";font-size:8.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:" +
                            A(s.sourceColor, "cc") +
                            ";white-space:nowrap",
                        )}
                      >
                        {s.sourceLabel}
                      </span>
                      {s.runnable && (
                        <span
                          style={{
                            fontSize: "8.5px",
                            fontWeight: 800,
                            letterSpacing: ".05em",
                            textTransform: "uppercase",
                            color: "#34d399",
                          }}
                        >
                          Runnable
                        </span>
                      )}
                      <OwnerAvatar owner={s.owner} size={16} />
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: "9px",
                          color: "#3f4c5f",
                          fontFamily: MONO,
                        }}
                      >
                        {s.code}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <span
              style={{ padding: "16px 14px", fontSize: "11.5px", color: "#64748b", lineHeight: 1.55 }}
            >
              Nothing matches. Try the thing you are trying to do rather than the title.
            </span>
          )}
        </div>
        <span style={{ fontSize: "10.5px", color: "#475569", lineHeight: 1.5, padding: "0 2px" }}>
          Baseline procedures are ours to maintain. Procedures your team wrote are yours — we read
          them, follow them, and never edit them.
        </span>
      </div>

      {/* Right column (1.9fr) — the detail panel. proto first child. */}
      <DetailPanel data={data} selId={selId} onExecute={onExecute} />
    </div>
  );
}

function DetailPanel({
  data,
  selId,
  onExecute,
}: {
  data: SopsPayload;
  selId: string | null;
  onExecute: (id: string, mode: SopExecMode) => void;
}) {
  const d = detailFor(data, selId);
  // An empty library has no procedure to detail. The left column already says
  // so; this side simply has nothing to draw rather than a hollow frame.
  if (!d) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
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
      >
        {/* Header block */}
        <div
          style={{
            padding: "15px 18px",
            borderBottom: "1px solid rgba(30,41,59,.9)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span
              style={css(
                "flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:3px 9px;border-radius:5px;border:1px solid " +
                  A(d.sourceColor, "55") +
                  ";background:" +
                  A(d.sourceColor, "14") +
                  ";font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:" +
                  d.sourceColor +
                  ";white-space:nowrap",
              )}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: d.sourceColor,
                  flex: "0 0 5px",
                }}
              />
              {d.sourceLabel}
            </span>
            <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#cbd5e1", fontFamily: MONO }}>
              {d.code}
            </span>
            <span style={{ fontSize: "10.5px", color: "#64748b" }}>
              {d.category} · {d.stepCount} · {d.level}
            </span>
            {d.isRunnable && (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: "1px solid rgba(52,211,153,.4)",
                  background: "rgba(52,211,153,.1)",
                  fontSize: "9px",
                  fontWeight: 700,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "#34d399",
                  whiteSpace: "nowrap",
                }}
              >
                Executable
              </span>
            )}
            {d.isReference && (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: "1px solid rgba(148,163,184,.28)",
                  background: "rgba(148,163,184,.07)",
                  fontSize: "9px",
                  fontWeight: 700,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "#94a3b8",
                  whiteSpace: "nowrap",
                }}
              >
                Reference
              </span>
            )}
          </div>
          <span
            style={{
              fontSize: "16px",
              fontWeight: 800,
              color: "#f8fafc",
              lineHeight: 1.35,
              letterSpacing: "-.015em",
            }}
            data-testid="pv2-sop-detail-title"
          >
            {d.title}
          </span>
          <span style={{ fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.6, textWrap: "pretty" }}>
            {d.purpose}
          </span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
              gap: "8px 18px",
              paddingTop: 4,
            }}
          >
            <MetaField label="Who runs it" value={d.forWho} />
            <MetaField label="Maintained by" value={`${d.author} · ${d.updated}`} />
            <MetaField label="Review" value={d.reviewCadence} />
            {d.hasFinding && <MetaField label="Attached to" value={d.finding} mono />}
          </div>
        </div>

        {/* The procedure, in full */}
        <div style={{ padding: "15px 18px", display: "flex", flexDirection: "column", gap: 9 }}>
          <span
            style={{
              fontSize: "9.5px",
              fontWeight: 700,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            The procedure, in full
          </span>
          {d.steps.map((s) => (
            <div
              key={s.n}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "9px 0",
                borderBottom: "1px solid rgba(30,41,59,.75)",
              }}
            >
              <span
                style={{
                  flex: "0 0 22px",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#475569",
                  fontFamily: MONO,
                  paddingTop: 1,
                }}
              >
                {s.n}
              </span>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <KindChip isGraph={s.isGraph} label={s.kindLabel} />
                </div>
                <span
                  style={{ fontSize: "12.5px", color: "#e2e8f0", lineHeight: 1.6, textWrap: "pretty" }}
                >
                  {s.text}
                </span>
                {s.hasEndpoint && (
                  <span
                    style={{
                      fontSize: "10.5px",
                      color: "#60a5fa",
                      wordBreak: "break-all",
                      fontFamily: MONO,
                    }}
                  >
                    {s.endpoint}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Runnable actions + run history */}
        {d.isRunnable && (
          <div style={{ padding: "0 18px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => onExecute(d.id, "all")}
                data-testid="pv2-sop-execute"
                style={{
                  padding: "8px 14px",
                  borderRadius: 7,
                  fontSize: "12px",
                  fontWeight: 700,
                  border: "1px solid #0078D4",
                  background: "#0078D4",
                  color: "#fff",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                Execute this SOP
              </button>
              {d.hasAutoSteps && (
                <button
                  type="button"
                  onClick={() => onExecute(d.id, "auto")}
                  data-testid="pv2-sop-execute-auto"
                  style={{
                    padding: "8px 14px",
                    borderRadius: 7,
                    fontSize: "12px",
                    fontWeight: 700,
                    border: "1px solid rgba(52,211,153,.5)",
                    background: "rgba(52,211,153,.12)",
                    color: "#34d399",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  Execute automated steps only
                </button>
              )}
              <button
                type="button"
                style={{
                  padding: "8px 14px",
                  borderRadius: 7,
                  fontSize: "12px",
                  fontWeight: 600,
                  border: "1px solid rgba(148,163,184,.24)",
                  background: "transparent",
                  color: "#94a3b8",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                Dry run
              </button>
              <span style={{ fontSize: "10.5px", color: "#475569" }}>
                Avg {d.avg} · {d.execs}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".16em",
                  textTransform: "uppercase",
                  color: "#64748b",
                }}
              >
                Run history for your tenant
              </span>
              {d.hasRuns &&
                d.runs.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "10px 12px",
                      border: "1px solid rgba(30,41,59,.9)",
                      borderRadius: 9,
                      background: "#0b1524",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span
                          style={{ fontSize: "11.5px", fontWeight: 700, color: "#e2e8f0", fontFamily: MONO }}
                        >
                          {r.when}
                        </span>
                        <span
                          style={css(
                            "flex:0 0 auto;padding:2px 7px;border-radius:4px;border:1px solid " +
                              A(r.tone, "59") +
                              ";background:" +
                              A(r.tone, "14") +
                              ";font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:" +
                              r.tone +
                              ";white-space:nowrap",
                          )}
                        >
                          {r.state}
                        </span>
                      </div>
                      <span style={{ fontSize: "10.5px", color: "#64748b" }}>{r.who}</span>
                      <span
                        style={{ fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.5, textWrap: "pretty" }}
                      >
                        {r.outcome}
                      </span>
                    </div>
                  </div>
                ))}
              {d.neverRun && (
                <span style={{ fontSize: "11.5px", color: "#64748b", lineHeight: 1.55 }}>
                  Never run for your tenant. The procedure is documented and ready — nothing has been
                  executed against your data.
                </span>
              )}
            </div>
          </div>
        )}

        {/* Customer procedure note */}
        {d.isOurs && (
          <div style={{ padding: "0 18px 16px", display: "flex", flexDirection: "column", gap: 9 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "12px 14px",
                border: "1px solid rgba(34,211,238,.28)",
                borderLeft: "2px solid #22d3ee",
                borderRadius: 9,
                background: "rgba(34,211,238,.05)",
              }}
            >
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".09em",
                  textTransform: "uppercase",
                  color: "#22d3ee",
                }}
              >
                Your procedure, your call
              </span>
              <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.6, textWrap: "pretty" }}>
                This is documentation you wrote, so it is reference rather than executable — we read
                it and follow it, and we do not edit or run it. If you want a step in here automated,
                ask and we will build a runnable version alongside it rather than changing yours.
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { t: "Edit this procedure", primary: true },
                { t: "Duplicate", primary: false },
                { t: "Ask us to make it runnable", primary: false },
                { t: "Export as PDF", primary: false },
              ].map((b) => (
                <button
                  key={b.t}
                  type="button"
                  style={css(
                    "padding:7px 13px;border-radius:7px;font-size:11.5px;font-weight:" +
                      (b.primary ? "700" : "600") +
                      ";border:1px solid " +
                      (b.primary ? "rgba(34,211,238,.45)" : "rgba(148,163,184,.24)") +
                      ";background:" +
                      (b.primary ? "rgba(34,211,238,.1)" : "transparent") +
                      ";color:" +
                      (b.primary ? "#22d3ee" : "#94a3b8") +
                      ";cursor:pointer;font-family:inherit",
                  )}
                >
                  {b.t}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetaField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span
        style={{
          fontSize: "9.5px",
          fontWeight: 700,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "#64748b",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "11.5px",
          color: "#e2e8f0",
          lineHeight: 1.45,
          fontFamily: mono ? MONO : "inherit",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function KindChip({ isGraph, label }: { isGraph: boolean; label: string }) {
  return (
    <span
      style={css(
        "flex:0 0 auto;padding:1px 6px;border-radius:4px;border:1px solid " +
          (isGraph ? "rgba(96,165,250,.4)" : "rgba(148,163,184,.25)") +
          ";background:" +
          (isGraph ? "rgba(96,165,250,.1)" : "rgba(148,163,184,.06)") +
          ";font-size:8.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:" +
          (isGraph ? "#60a5fa" : "#94a3b8") +
          ";white-space:nowrap",
      )}
    >
      {label}
    </span>
  );
}

/* ── Execution drawer — proto 1929-1978 ─────────────────────────────────── */

interface ExecState {
  open: boolean;
  id: string | null;
  mode: SopExecMode;
  /**
   * idle → the drawer is showing the procedure, waiting for Start.
   * raising → the POST is open. raised → a real CR came back. error → it failed.
   * There is no "running" step animation anymore: raising a change request is
   * the real action, and the procedure does not execute until that CR is
   * approved (single-step creation only — see ccCreateChangeRequest.ts).
   */
  phase: "idle" | "raising" | "raised" | "error";
  cr: ChangeRequestCreated | null;
  error: string | null;
}

function ExecDrawer({
  data,
  exec,
  onStart,
  onClose,
}: {
  data: SopsPayload;
  exec: ExecState;
  onStart: () => void;
  onClose: () => void;
}) {
  if (!exec.open || !exec.id) return null;
  const steps = execStepsFor(data, exec.id, exec.mode);
  const d = detailFor(data, exec.id);
  if (!d) return null;
  // The bar tracks the raise action (the one thing that actually happens),
  // NOT step execution — the steps below stay un-ticked because nothing has run
  // against the tenant. 100% means the change request was raised, and the
  // footer says plainly that it is pending approval.
  const pct = exec.phase === "raised" ? 100 : 0;
  const modeLabel =
    exec.mode === "auto" ? "Automated steps only" : "Full execution · automated and manual";

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(2,6,23,.6)" }}
      />
      <div
        data-testid="pv2-sop-exec-drawer"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 151,
          width: "min(460px,94vw)",
          background: "#0b1524",
          borderLeft: "1px solid rgba(0,120,212,.45)",
          boxShadow: "-30px 0 60px rgba(2,6,23,.55)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid rgba(30,41,59,.9)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span
              style={{
                fontSize: "9.5px",
                fontWeight: 700,
                letterSpacing: ".18em",
                textTransform: "uppercase",
                color: "#60a5fa",
              }}
            >
              Execution · {d.code}
            </span>
            <button
              type="button"
              onClick={onClose}
              data-testid="pv2-sop-exec-close"
              style={{ background: "none", border: "none", padding: 2, cursor: "pointer" }}
            >
              <span style={{ display: "flex" }}>
                <X size={16} color="#94a3b8" />
              </span>
            </button>
          </div>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.4 }}>
            {d.title}
          </span>
          <span style={{ fontSize: "11px", color: "#94a3b8" }}>
            {modeLabel} · {steps.length} steps in scope
          </span>
          <div
            style={{
              height: 7,
              borderRadius: 4,
              background: "rgba(148,163,184,.14)",
              overflow: "hidden",
              marginTop: 2,
            }}
          >
            <div
              style={{
                height: "100%",
                borderRadius: 4,
                width: `${pct}%`,
                background: "linear-gradient(90deg,#0078D4,#00B4D8)",
                transition: "width 500ms",
              }}
            />
          </div>
          <span style={{ fontSize: "10.5px", color: "#64748b", fontFamily: MONO }}>
            {pct}% complete
          </span>
        </div>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {steps.map((s) => {
            // Nothing executes in this scope — a raised CR is pending approval —
            // so every step renders as in-scope, none ticked done.
            const stepDone = false;
            const current = false;
            const c = stepDone ? "#34d399" : current ? "#60a5fa" : "#475569";
            return (
              <div key={s.n} style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
                <span
                  style={{
                    flex: "0 0 18px",
                    width: 18,
                    height: 18,
                    borderRadius: 5,
                    border: `1px solid ${A(c, "88")}`,
                    background: stepDone
                      ? "rgba(52,211,153,.16)"
                      : current
                        ? "rgba(96,165,250,.14)"
                        : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: 1,
                  }}
                >
                  {stepDone && <Check size={12} color="#34d399" />}
                </span>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <KindChip isGraph={s.isGraph} label={s.kindLabel} />
                  </div>
                  <span
                    style={{
                      fontSize: "12px",
                      color: stepDone ? "#94a3b8" : current ? "#f1f5f9" : "#64748b",
                      lineHeight: 1.55,
                    }}
                  >
                    {s.text}
                  </span>
                  {s.hasEndpoint && (
                    <span
                      style={{
                        fontSize: "10px",
                        color: "#60a5fa",
                        wordBreak: "break-all",
                        fontFamily: MONO,
                      }}
                    >
                      {s.endpoint}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid rgba(30,41,59,.9)",
            display: "flex",
            flexDirection: "column",
            gap: 9,
          }}
        >
          {(exec.phase === "idle" || exec.phase === "error") && (
            <>
              {exec.phase === "error" && exec.error && (
                <span
                  style={{ fontSize: "11px", color: "#f87171", lineHeight: 1.5 }}
                  data-testid="pv2-sop-exec-error"
                >
                  {exec.error}
                </span>
              )}
              <button
                type="button"
                onClick={onStart}
                data-testid="pv2-sop-exec-start"
                style={{
                  padding: "10px 16px",
                  borderRadius: 8,
                  fontSize: "12.5px",
                  fontWeight: 700,
                  border: "1px solid #0078D4",
                  background: "#0078D4",
                  color: "#fff",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Start execution
              </button>
              <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.5 }}>
                This raises a change request for the procedure. It goes on your change register
                pending approval — nothing runs against your tenant until it is approved.
              </span>
            </>
          )}
          {exec.phase === "raising" && (
            <>
              <span
                style={{ fontSize: "12px", fontWeight: 700, color: "#60a5fa" }}
                data-testid="pv2-sop-exec-raising"
              >
                Raising the change request…
              </span>
              <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.5 }}>
                Its risk and workload are being assessed for you.
              </span>
            </>
          )}
          {exec.phase === "raised" && exec.cr && (
            <>
              <span
                style={{ fontSize: "12px", fontWeight: 700, color: "#34d399" }}
                data-testid="pv2-sop-exec-raised"
              >
                {exec.cr.code} · raised, pending approval
              </span>
              <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.5 }}>
                It is on your change register now. This procedure runs once the change request is
                approved — nothing has run against your tenant yet.
              </span>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: "9px 15px",
                  borderRadius: 8,
                  fontSize: "12px",
                  fontWeight: 600,
                  border: "1px solid rgba(30,41,59,.9)",
                  background: "transparent",
                  color: "#e2e8f0",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

/** The sub-view a URL segment selects; anything else is the library. */
const SUB_VIEWS = new Set(["queue", "audit"]);

export default function PortalV2SopHubPage() {
  const [, params] = useRoute("/portal-v2/sops/:view");
  const raw = params?.view;
  const view = raw && SUB_VIEWS.has(raw) ? raw : "library";
  const [, navigate] = useLocation();

  const [filters, setFiltersState] = useState<SopFilterState>({
    source: "all",
    cat: "All",
    type: "all",
    tag: "All tags",
    query: "",
  });
  const setFilters = (patch: Partial<SopFilterState>) =>
    setFiltersState((f) => ({ ...f, ...patch }));

  const { sops, runs, holds, loaded, error } = useSops();
  const { fetchWithAuth } = useAuth();

  const [requestedSel, setRequestedSel] = useState<string | null>(null);
  const filtered = filterSops(sops, filters);
  const selId = resolveSelectedId(sops, filtered, requestedSel);

  const [exec, setExec] = useState<ExecState>({
    open: false,
    id: null,
    mode: "all",
    phase: "idle",
    cr: null,
    error: null,
  });

  const startExec = (id: string, mode: SopExecMode) => {
    setExec({ open: true, id, mode, phase: "idle", cr: null, error: null });
  };
  const closeExec = () => {
    setExec((e) => ({ ...e, open: false, phase: "idle", cr: null, error: null }));
  };

  // Replaces the prototype's fake tick loop. Executing an SOP raises a REAL
  // change request through the one customer-scoped route — the handoff's rule
  // is that every executed SOP routes through a CR. Single-step creation only:
  // the CR lands `pending_approval`, and the procedure runs once it is approved
  // (that approval/execution step is separate, later work — see
  // ccCreateChangeRequest.ts).
  const runExec = async () => {
    if (!exec.id || exec.phase === "raising") return;
    const d = detailFor(sops, exec.id);
    if (!d) return;
    const steps = execStepsFor(sops, exec.id, exec.mode);
    setExec((e) => ({ ...e, phase: "raising", error: null }));
    const body = changeRequestBodyForSop({
      code: d.code,
      title: d.title,
      category: d.category,
      mode: exec.mode,
      steps: steps.map((s) => ({ text: s.text, endpoint: s.endpoint, isGraph: s.isGraph })),
    });
    const result = await postChangeRequest(fetchWithAuth, body);
    if (result.ok) {
      setExec((e) => ({ ...e, phase: "raised", cr: result.created }));
    } else {
      setExec((e) => ({ ...e, phase: "error", error: result.error }));
    }
  };

  return (
    <PortalV2Shell eyebrow="Reference" title="SOPs & Runbooks">
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
        data-testid="pv2-sop-hub"
      >
        <Header baseline={sopBaselineCount(sops)} ours={sopOursCount(sops)} />
        <HoldBanner counts={holds} onOpenRunbooks={() => navigate("/portal-v2/runbooks")} />
        <StatCards data={sops} />
        <Toolbar />
        <SearchAndFilters
          data={sops}
          filters={filters}
          setFilters={setFilters}
          resultCount={filtered.length}
        />

        {!loaded && (
          <span style={{ fontSize: "12px", color: "#64748b" }} data-testid="pv2-sop-loading">
            Loading your procedure library…
          </span>
        )}
        {loaded && error && (
          <span style={{ fontSize: "12px", color: "#f87171" }} data-testid="pv2-sop-error">
            {error}
          </span>
        )}
        {loaded && !error && sops.library.length === 0 && (
          <span
            style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.55, maxWidth: "88ch" }}
            data-testid="pv2-sop-empty"
          >
            No procedures are published to your library yet. Baseline procedures appear here as we
            publish them, alongside anything your own team writes.
          </span>
        )}

        {loaded && !error && view === "queue" && (
          <QueueView
            queue={runs.queue}
            onOpenChangeControl={() => navigate("/portal-v2/change-control/register")}
          />
        )}
        {loaded && !error && view === "audit" && <AuditView audit={runs.audit} />}
        {loaded && !error && sops.library.length > 0 && view === "library" && (
          <LibraryView
            data={sops}
            filters={filters}
            setFilters={setFilters}
            selId={selId}
            onSelect={setRequestedSel}
            onExecute={startExec}
          />
        )}
      </div>

      <ExecDrawer data={sops} exec={exec} onStart={runExec} onClose={closeExec} />
    </PortalV2Shell>
  );
}
