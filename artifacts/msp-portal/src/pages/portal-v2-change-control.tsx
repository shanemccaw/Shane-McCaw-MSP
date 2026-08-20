/**
 * portal-v2-change-control.tsx — the Change Control page.
 *
 * A direct port of the prototype's `isChangeControl` block
 * (`Customer Portal Shell.dc.html` 1267-1596) and its logic (14944-15145,
 * renderVals 17109-17195). Read against the markup rather than the README,
 * because on this page the two disagree in three places worth naming.
 *
 * ── Where the README misdescribes this page ────────────────────────────────
 *
 * 1. The README's page inventory calls it "CR list, 4-step CR wizard, JSON
 *    pre/post diff, approve / rollback". The prototype has THREE TABS — Active
 *    CR Register, Maintenance Schedule, and Change History & Rollback Vault —
 *    and the second and third are not mentioned anywhere in the README. They
 *    are roughly half the page.
 *
 * 2. The README says "Forms live in the right drawer, never inline. One
 *    `openForm({...})` primitive drives every form in the portal." The CR
 *    wizard is not that primitive and could not be: it is a bespoke four-step
 *    drawer with its own step rail, its own per-step bodies and a computed risk
 *    readout, none of which the `fields[]` model expresses. It is also a
 *    DIFFERENT WIDTH — `min(680px,94vw)` against the Shell spec's
 *    `min(560px,94vw)` for forms — and sits at z-index 118/119, not the
 *    documented 124/125. The prototype's values are used throughout.
 *
 * 3. The README says "No dead ends. Every button opens a form, gates a CR, or
 *    escalates to ShaneBot." In the prototype's own markup (1513-1524, 1578-
 *    1581, 1428) the Approve, "Reject with a reason", "Roll back from
 *    snapshot", "Change window", "Add a comment", "Snapshot", the vault's
 *    "Roll back" and "Export CR register" buttons carry NO onClick. Only "Ask
 *    ShaneBot to explain the diff" does. They are rendered here exactly as
 *    designed and are inert, which is the honest port; wiring an approve
 *    mutation would invent an authority (see the route header for why there is
 *    no customer capability flag for it). Flagged for Shane rather than
 *    silently filled in or silently dropped.
 *
 * ── Every number comes from the data layer ─────────────────────────────────
 * The prototype's four stat cards derive only the first; the other three are
 * the literals '2', '1' and '14'. CLAUDE.md forbids that, so all four are
 * computed server-side — see `buildStats` in api-server's
 * `routes/portal-change-control.ts`, including the one place a free-text
 * `scheduled_for` column stops a real chronological answer being possible.
 */

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import {
  CC_CLASSES,
  CC_CLASS_COLOUR,
  CC_DEFAULT_FILTERS,
  CC_MONO,
  CC_RISK_COLOUR,
  CC_STATUSES,
  CC_STATUS_COLOUR,
  CC_WORKLOADS,
  deriveVaultRows,
  deriveWindowRows,
  filterChangeRequests,
  type CcFilters,
} from "@/components/portal-v2/ccPageData";
import { useChangeControl, type ChangeRequest } from "@/components/portal-v2/useChangeControl";

type CcTab = "register" | "schedule" | "vault";

/** `hexAlpha`-style suffixes the prototype appends directly onto a hex value. */
const A = (hex: string, suffix: string) => `${hex}${suffix}`;

// ── Small shared pieces, each pinned to its prototype line ────────────────────

/** Section eyebrow — 9.5px/700/.18em (proto 1451, 1533, 1560). */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "9.5px",
        fontWeight: 700,
        letterSpacing: ".18em",
        textTransform: "uppercase",
        color: "#64748b",
      }}
    >
      {children}
    </span>
  );
}

/** Field label — 9.5px/700/.08em (proto 1310). */
function FieldLabel({ children, color = "#64748b" }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      style={{
        fontSize: "9.5px",
        fontWeight: 700,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        color,
      }}
    >
      {children}
    </span>
  );
}

/** Expanded-row meta label — 9.5px/700/.07em (proto 1479). */
function MetaLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "9.5px",
        fontWeight: 700,
        letterSpacing: ".07em",
        textTransform: "uppercase",
        color: "#64748b",
      }}
    >
      {children}
    </span>
  );
}

/** The chip shape used for class, status and window kind — proto 15031. */
function Chip({
  colour,
  dot = false,
  children,
}: {
  colour: string;
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        flex: "0 0 auto",
        display: dot ? "flex" : undefined,
        alignItems: dot ? "center" : undefined,
        gap: dot ? 6 : undefined,
        padding: "2px 8px",
        borderRadius: 4,
        border: `1px solid ${A(colour, "55")}`,
        background: A(colour, "14"),
        fontSize: "9px",
        fontWeight: 700,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        color: colour,
        whiteSpace: "nowrap",
      }}
    >
      {dot && (
        <span
          style={{ width: 5, height: 5, borderRadius: "50%", background: colour, flex: "0 0 5px" }}
        />
      )}
      {children}
    </span>
  );
}

/**
 * The inert action buttons the prototype renders without an onClick — see the
 * header. They are real, focusable buttons carrying the design's exact styling;
 * `disabled` is deliberately NOT set, because that would change how they look
 * and the design's values are the spec.
 */
function ActionButton({
  border,
  background,
  colour,
  weight,
  onClick,
  testId,
  children,
}: {
  border: string;
  background: string;
  colour: string;
  weight: 600 | 700;
  onClick?: () => void;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      style={{
        marginTop: 10,
        padding: "7px 13px",
        borderRadius: 7,
        border,
        background,
        fontSize: "11.5px",
        fontWeight: weight,
        color: colour,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

export default function PortalV2ChangeControlPage() {
  const { payload, loaded, error, submit } = useChangeControl();

  const [tab, setTab] = useState<CcTab>("register");
  const [filters, setFilters] = useState<CcFilters>(CC_DEFAULT_FILTERS);
  /** `ccExpanded: 0` — the prototype opens the first row by default (proto 6494). */
  const [expanded, setExpanded] = useState<number | null>(0);
  const [wizardOpen, setWizardOpen] = useState(false);

  const requests = payload?.requests ?? [];
  const stats = payload?.stats ?? null;

  const filtered = useMemo(() => filterChangeRequests(requests, filters), [requests, filters]);
  const windowRows = useMemo(() => deriveWindowRows(requests), [requests]);
  const vaultRows = useMemo(
    () => deriveVaultRows(requests, stats?.snapshotRetentionDays ?? 90),
    [requests, stats],
  );

  const statCards = stats
    ? [
        {
          label: "Open change requests",
          value: String(stats.open),
          sub: `${stats.awaitingApproval} awaiting approval`,
          colour: "#60a5fa",
          testId: "pv2-cc-stat-open",
        },
        {
          label: "In the next window",
          value: String(stats.nextWindowCount),
          sub: stats.nextWindowLabel,
          colour: "#22d3ee",
          testId: "pv2-cc-stat-window",
        },
        {
          label: "Emergency changes",
          value: String(stats.emergencyCount),
          sub: `Last ${stats.emergencyLookbackDays} days · retrospectively approved`,
          colour: "#f87171",
          testId: "pv2-cc-stat-emergency",
        },
        {
          label: "Rollback snapshots held",
          value: String(stats.snapshotsHeld),
          sub: `Pre-change state, ${stats.snapshotRetentionDays}-day retention`,
          colour: "#a78bfa",
          testId: "pv2-cc-stat-snapshots",
        },
      ]
    : [];

  return (
    <PortalV2Shell title="Change Control" eyebrow="Operate">
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
        data-testid="pv2-change-control"
      >
        {/* ── Header — proto 1269-1275 ─────────────────────────────────── */}
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
              data-testid="pv2-cc-title"
            >
              Change Control
            </span>
            <span
              style={{
                fontSize: "12.5px",
                color: "#94a3b8",
                lineHeight: 1.55,
                maxWidth: "86ch",
              }}
            >
              Every tenant change with a request, an approval, a window and a snapshot to roll back
              to. Classified the ITIL way — standard, normal, emergency — so a routine change is not
              treated like a risky one and a risky one cannot slip through as routine.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            data-testid="pv2-cc-new"
            style={{
              flex: "0 0 auto",
              whiteSpace: "nowrap",
              padding: "8px 14px",
              borderRadius: 7,
              fontSize: "12px",
              fontWeight: 700,
              border: "1px solid var(--brand-blue,#0078D4)",
              background: "var(--brand-blue,#0078D4)",
              color: "#fff",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            New change request
          </button>
        </div>

        {/* ── Stat cards — proto 1277-1286 ─────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
            gap: 10,
          }}
        >
          {statCards.map((s) => (
            <div
              key={s.label}
              data-testid={s.testId}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "13px 15px",
                borderRadius: 10,
                border: `1px solid ${A(s.colour, "30")}`,
                background: `linear-gradient(160deg, ${A(s.colour, "0e")}, rgba(15,23,42,.45))`,
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
                  fontFamily: CC_MONO,
                }}
              >
                {s.value}
              </span>
              <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.35 }}>{s.sub}</span>
            </div>
          ))}
        </div>

        {/* ── Tabs — proto 1420-1431 ───────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            borderBottom: "1px solid rgba(30,41,59,.9)",
          }}
        >
          {(
            [
              ["register", "Active CR Register"],
              ["schedule", "Maintenance Schedule"],
              ["vault", "Change History & Rollback Vault"],
            ] as const
          ).map(([key, label]) => {
            const on = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                data-testid={`pv2-cc-tab-${key}`}
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px 8px 0 0",
                  border: `1px solid ${on ? "rgba(0,120,212,.45)" : "transparent"}`,
                  borderBottom: on ? "1px solid #0b1524" : "1px solid rgba(30,41,59,.9)",
                  background: on ? "rgba(0,120,212,.08)" : "transparent",
                  fontSize: "12px",
                  fontWeight: on ? 700 : 600,
                  color: on ? "#60a5fa" : "#64748b",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                  marginBottom: -1,
                }}
              >
                {label}
              </button>
            );
          })}
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: 7,
              flexWrap: "wrap",
              paddingBottom: 8,
            }}
          >
            {/* Inert in the prototype — see the header. */}
            <button
              type="button"
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid rgba(148,163,184,.22)",
                background: "transparent",
                fontSize: "11px",
                fontWeight: 600,
                color: "#94a3b8",
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              Export CR register
            </button>
          </div>
        </div>

        {/* ── Search + selects — proto 1433-1449 ───────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div
            style={{
              flex: "1 1 200px",
              maxWidth: 300,
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
              <Search size={15} />
            </span>
            <input
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
              placeholder="Search CR, title, target or ticket…"
              data-testid="pv2-cc-search"
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

          {(
            [
              ["Change class", "changeClass", CC_CLASSES, "All classes"],
              ["Status", "status", CC_STATUSES, "All statuses"],
              ["Workload", "workload", CC_WORKLOADS, "All workloads"],
            ] as const
          ).map(([label, key, options, allLabel]) => (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 700,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "#475569",
                }}
              >
                {label}
              </span>
              <select
                value={filters[key]}
                onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
                data-testid={`pv2-cc-filter-${key}`}
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
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o === "All" ? allLabel : o}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <span
            style={{
              fontSize: "10.5px",
              color: "#475569",
              marginLeft: "auto",
              paddingBottom: 8,
            }}
            data-testid="pv2-cc-count"
          >
            {filtered.length} shown
          </span>
        </div>

        {/* ── Loading / error / unscoped states ────────────────────────── */}
        {!loaded && (
          <span style={{ fontSize: "12px", color: "#64748b" }} data-testid="pv2-cc-loading">
            Loading the change control register…
          </span>
        )}
        {loaded && error && (
          <span style={{ fontSize: "12px", color: "#f87171" }} data-testid="pv2-cc-error">
            {error}
          </span>
        )}
        {loaded && !error && payload && !payload.scoped && (
          <span
            style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.55, maxWidth: "86ch" }}
            data-testid="pv2-cc-unscoped"
          >
            This account is not yet connected to a Microsoft 365 tenant, so there is no change
            register to show. Connect the tenant and every change raised against it appears here.
          </span>
        )}

        {/* ── Tab: Active CR Register — proto 1451-1531 ────────────────── */}
        {tab === "register" && loaded && !error && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <SectionLabel>Active CR register · {filtered.length}</SectionLabel>
              <span style={{ fontSize: "10.5px", color: "#475569" }}>
                Expand any request to see the exact JSON diff an approver reviews
              </span>
            </div>

            {filtered.length === 0 ? (
              <span
                style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.55 }}
                data-testid="pv2-cc-empty"
              >
                No change requests match these filters.
              </span>
            ) : (
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
                data-testid="pv2-cc-register"
              >
                {filtered.map((c, i) => (
                  <ChangeRequestRow
                    key={c.code}
                    request={c}
                    isExpanded={expanded === i}
                    onToggle={() => setExpanded((cur) => (cur === i ? null : i))}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Maintenance Schedule — proto 1533-1557 ──────────────── */}
        {tab === "schedule" && loaded && !error && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <SectionLabel>Maintenance schedule</SectionLabel>
              <span style={{ fontSize: "10.5px", color: "#475569" }}>
                From your change policy — SOP-OPS-001
              </span>
            </div>
            {windowRows.length === 0 ? (
              <span
                style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.55, maxWidth: "86ch" }}
                data-testid="pv2-cc-schedule-empty"
              >
                Nothing is booked into a maintenance window right now. Windows come from your change
                policy: Tuesday to Thursday, 09:00–16:00, with an early slot for authentication
                changes and a month-end blackout.
              </span>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
                  gap: 10,
                }}
                data-testid="pv2-cc-schedule"
              >
                {windowRows.map((w) => (
                  <div
                    key={w.when}
                    style={{
                      display: "flex",
                      gap: 11,
                      padding: "14px 15px",
                      border: "1px solid rgba(30,41,59,.9)",
                      borderRadius: 11,
                      background: "rgba(15,23,42,.4)",
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        flex: "0 0 3px",
                        width: 3,
                        borderRadius: 2,
                        background: w.tone,
                        alignSelf: "stretch",
                      }}
                    />
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0" }}>
                          {w.when}
                        </span>
                        <Chip colour={w.tone}>{w.kind}</Chip>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {w.items.map((item) => (
                          <span
                            key={item}
                            style={{ fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.5 }}
                          >
                            · {item}
                          </span>
                        ))}
                      </div>
                      <span
                        style={{
                          fontSize: "10.5px",
                          color: "#64748b",
                          lineHeight: 1.5,
                          textWrap: "pretty",
                        }}
                      >
                        {w.note}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Rollback Vault — proto 1559-1586 ────────────────────── */}
        {tab === "vault" && loaded && !error && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <SectionLabel>Change history &amp; rollback vault</SectionLabel>
              <span style={{ fontSize: "10.5px", color: "#475569" }}>
                Pre-change state is captured at execution and held for{" "}
                {stats?.snapshotRetentionDays ?? 90} days
              </span>
            </div>
            {vaultRows.length === 0 ? (
              <span
                style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.55 }}
                data-testid="pv2-cc-vault-empty"
              >
                No change has executed against this tenant yet, so the vault holds no snapshots.
              </span>
            ) : (
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
                data-testid="pv2-cc-vault"
              >
                {vaultRows.map((v) => (
                  <div
                    key={v.code}
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "minmax(0,1.6fr) minmax(150px,.9fr) minmax(140px,.9fr) 120px",
                      gap: 12,
                      padding: "12px 16px",
                      borderBottom: "1px solid rgba(30,41,59,.8)",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "10.5px",
                            fontWeight: 700,
                            color: "#cbd5e1",
                            fontFamily: CC_MONO,
                          }}
                        >
                          {v.code}
                        </span>
                        {v.isRolledBack && (
                          <span
                            style={{
                              padding: "2px 7px",
                              borderRadius: 4,
                              border: "1px solid rgba(248,113,113,.4)",
                              background: "rgba(248,113,113,.1)",
                              fontSize: "9px",
                              fontWeight: 700,
                              letterSpacing: ".06em",
                              textTransform: "uppercase",
                              color: "#f87171",
                            }}
                          >
                            Rolled back
                          </span>
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "#e2e8f0",
                          lineHeight: 1.4,
                        }}
                      >
                        {v.title}
                      </span>
                      <span style={{ fontSize: "10.5px", color: "#64748b" }}>{v.verified}</span>
                    </div>
                    <div
                      style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}
                    >
                      <span style={{ fontSize: "11px", color: "#94a3b8" }}>{v.when}</span>
                      <span style={{ fontSize: "10.5px", color: "#64748b" }}>{v.by}</span>
                    </div>
                    <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.45 }}>
                      {v.expires}
                    </span>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                      {/* Both inert in the prototype — see the header. */}
                      <button
                        type="button"
                        style={{
                          padding: "5px 10px",
                          borderRadius: 6,
                          border: "1px solid rgba(148,163,184,.22)",
                          background: "transparent",
                          fontSize: "10.5px",
                          fontWeight: 600,
                          color: "#94a3b8",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Snapshot
                      </button>
                      <button
                        type="button"
                        style={{
                          padding: "5px 10px",
                          borderRadius: 6,
                          border: "1px solid rgba(194,166,61,.4)",
                          background: "rgba(194,166,61,.08)",
                          fontSize: "10.5px",
                          fontWeight: 700,
                          color: "#c2a63d",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Roll back
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {wizardOpen && (
        <CrWizard
          onClose={() => setWizardOpen(false)}
          onSubmit={async (draft) => {
            const result = await submit(draft);
            if (result) {
              setWizardOpen(false);
              setTab("register");
              setFilters((f) => ({ ...f, status: "All" }));
              setExpanded(0);
            }
            return result;
          }}
        />
      )}
    </PortalV2Shell>
  );
}

// ── One register row — proto 1455-1529 ───────────────────────────────────────

function ChangeRequestRow({
  request: c,
  isExpanded,
  onToggle,
}: {
  request: ChangeRequest;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const clsC = CC_CLASS_COLOUR[c.changeClass] ?? "#94a3b8";
  const stC = CC_STATUS_COLOUR[c.status] ?? "#94a3b8";
  // `ccRiskMeta[c.risk] || '#94a3b8'` — a stored Critical falls through to
  // slate exactly as it does in the prototype (proto 15021).
  const rkC = CC_RISK_COLOUR[c.risk] ?? "#94a3b8";

  return (
    <div
      data-testid={`pv2-cc-row-${c.code}`}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        borderTop: "1px solid rgba(30,41,59,.85)",
        background: isExpanded ? "rgba(96,165,250,.03)" : undefined,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 2,
          background: A(stC, "88"),
        }}
      />
      <button
        type="button"
        onClick={onToggle}
        data-testid={`pv2-cc-toggle-${c.code}`}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "12px 16px",
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
            transform: `rotate(${isExpanded ? 180 : -90}deg)`,
            transition: "transform 180ms",
          }}
        >
          <ChevronDown size={13} color="#64748b" />
        </span>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: "10.5px",
                fontWeight: 700,
                color: "#cbd5e1",
                fontFamily: CC_MONO,
              }}
            >
              {c.code}
            </span>
            <Chip colour={clsC}>{c.changeClass}</Chip>
            <Chip colour={stC} dot>
              {c.status}
            </Chip>
            <span style={{ fontSize: "10px", color: "#64748b" }}>{c.workload}</span>
          </div>
          <span
            style={{
              fontSize: "12.5px",
              fontWeight: 700,
              color: "#e2e8f0",
              lineHeight: 1.4,
              textWrap: "pretty",
            }}
          >
            {c.title}
          </span>
          <span
            style={{
              fontSize: "10.5px",
              color: "#64748b",
              wordBreak: "break-all",
              fontFamily: CC_MONO,
            }}
          >
            {c.target}
          </span>
        </div>
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 2,
          }}
        >
          <span
            style={{ fontSize: "11px", fontWeight: 700, color: rkC, fontFamily: CC_MONO }}
          >
            {c.risk} risk
          </span>
          <span style={{ fontSize: "10px", color: "#64748b" }}>{c.ticket}</span>
        </div>
      </button>

      {isExpanded && (
        <div
          style={{
            padding: "0 16px 16px 40px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
          data-testid={`pv2-cc-detail-${c.code}`}
        >
          <span
            style={{
              fontSize: "12px",
              color: "#cbd5e1",
              lineHeight: 1.6,
              textWrap: "pretty",
            }}
          >
            {c.rationale}
          </span>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
              gap: "8px 18px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <MetaLabel>Requested by</MetaLabel>
              <span style={{ fontSize: "11.5px", color: "#e2e8f0" }}>{c.requester}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <MetaLabel>Window</MetaLabel>
              <span style={{ fontSize: "11.5px", color: "#e2e8f0" }}>{c.window}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <MetaLabel>Blast radius</MetaLabel>
              <span style={{ fontSize: "11.5px", color: "#e2e8f0" }}>
                {c.impactedUsersCount.toLocaleString("en-US")} accounts in scope
              </span>
            </div>
            {/*
              The prototype's fourth cell is "Raised from" — its `linked` field
              ("Governance · External Sharing Drift"), which ties a change
              request back to the finding that produced it. `msp_change_requests`
              has NO column for it, so the cell is omitted rather than filled
              with something invented. A real gap, flagged: this is the link the
              CR gate's whole "every fix routes through a CR" story depends on.
            */}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <FieldLabel>Pre-change state</FieldLabel>
              <pre
                style={{
                  margin: 0,
                  padding: "11px 12px",
                  border: "1px solid rgba(30,41,59,.9)",
                  borderRadius: 8,
                  background: "#0b1524",
                  fontSize: "10.5px",
                  lineHeight: 1.6,
                  color: "#94a3b8",
                  fontFamily: CC_MONO,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {c.pre}
              </pre>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <FieldLabel color="#34d399">Proposed target state</FieldLabel>
              <pre
                style={{
                  margin: 0,
                  padding: "11px 12px",
                  border: "1px solid rgba(52,211,153,.25)",
                  borderRadius: 8,
                  background: "#0b1524",
                  fontSize: "10.5px",
                  lineHeight: 1.6,
                  color: "#e2e8f0",
                  fontFamily: CC_MONO,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {c.post}
              </pre>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <FieldLabel>Approvals</FieldLabel>
            {c.approvals.map((a) => (
              <span key={a} style={{ fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.5 }}>
                · {a}
              </span>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              paddingTop: 4,
              borderTop: "1px solid rgba(30,41,59,.8)",
            }}
          >
            {c.canApprove && (
              <>
                <ActionButton
                  border="1px solid rgba(52,211,153,.5)"
                  background="rgba(52,211,153,.12)"
                  colour="#34d399"
                  weight={700}
                >
                  Approve
                </ActionButton>
                <ActionButton
                  border="1px solid rgba(248,113,113,.4)"
                  background="transparent"
                  colour="#f87171"
                  weight={600}
                >
                  Reject with a reason
                </ActionButton>
              </>
            )}
            {c.canRollback && (
              <ActionButton
                border="1px solid rgba(194,166,61,.45)"
                background="rgba(194,166,61,.1)"
                colour="#c2a63d"
                weight={700}
              >
                Roll back from snapshot
              </ActionButton>
            )}
            <ActionButton
              border="1px solid rgba(0,180,216,.45)"
              background="rgba(0,180,216,.1)"
              colour="#22d3ee"
              weight={700}
            >
              Ask ShaneBot to explain the diff
            </ActionButton>
            <ActionButton
              border="1px solid rgba(148,163,184,.24)"
              background="transparent"
              colour="#94a3b8"
              weight={600}
            >
              Change window
            </ActionButton>
            <ActionButton
              border="1px solid rgba(148,163,184,.24)"
              background="transparent"
              colour="#94a3b8"
              weight={600}
            >
              Add a comment
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}

// ── The four-step wizard — proto 1287-1417 ───────────────────────────────────

interface WizardDraft {
  title: string;
  target: string;
  ticket: string;
  pre: string;
  post: string;
  changeClass: "Standard" | "Normal" | "Emergency";
  accounts: string;
  window: string;
}

/** `ccDraft` initial state — proto 6498. */
const EMPTY_DRAFT: WizardDraft = {
  title: "",
  target: "",
  ticket: "",
  pre: "",
  post: "",
  changeClass: "Normal",
  accounts: "",
  window: "",
};

/**
 * `ccWindowPickRows` — proto 15137. These four labels are the design's own
 * example slots. They are page COPY (a picker's options), not tenant numbers,
 * and the README's "copy is final" applies; the schema models no maintenance
 * window to source them from, which is the same gap `deriveWindowRows` names.
 */
const WINDOW_OPTIONS = [
  "Tue 25 Aug · 09:00–11:00",
  "Thu 27 Aug · 07:00–09:00",
  "Tue 8 Sep · 09:00–11:00",
  "Outside a window — emergency",
] as const;

/**
 * `ccRiskComputed` — proto 15107. Mirrored on the client purely so the wizard's
 * step-3 readout can show the risk before submitting. The SERVER recomputes it
 * and the server's answer is what is stored; this copy has no authority. See
 * `computeRiskLevel` in api-server's `lib/portal-change-control.ts`.
 */
function previewRisk(draft: WizardDraft): "Low" | "Medium" | "High" {
  const acc = parseInt(draft.accounts || "0", 10) || 0;
  if (draft.changeClass === "Emergency") return "High";
  if (acc > 500 || /conditionalAccess|TransportConfig|RestrictiveRetention/i.test(draft.target)) {
    return "High";
  }
  if (acc > 50) return "Medium";
  return "Low";
}

/** `ccRiskWhy` — proto 17153-17157. */
const RISK_WHY: Record<string, string> = {
  High: "High: the change either touches authentication, mail transport or immutable retention, or affects more than 500 accounts. Two approvals and a booked window are required.",
  Medium:
    "Medium: affects between 50 and 500 accounts with a reversible target. Two approvals, standard window.",
  Low: "Low: narrow scope and a reversible target. Eligible for the pre-approved standard path.",
};

function CrWizard({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (draft: {
    title: string;
    target: string;
    ticket: string;
    pre: string;
    post: string;
    changeClass: "Standard" | "Normal" | "Emergency";
    impactedUsersCount: number;
    window: string;
  }) => Promise<{ code: string } | null>;
}) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<WizardDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);

  const patch = (p: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...p }));
  const risk = previewRisk(draft);
  /** `ccSubmitReady` — proto 15144. */
  const ready = Boolean(
    draft.title.trim() && draft.target.trim() && draft.post.trim() && draft.window,
  );

  const inputStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid rgba(30,41,59,.9)",
    background: "#0b1a2e",
    color: "#e2e8f0",
    fontSize: "13px",
    fontFamily: "inherit",
    minWidth: 0,
  };
  const monoInputStyle: React.CSSProperties = {
    ...inputStyle,
    fontSize: "12.5px",
    fontFamily: CC_MONO,
  };

  return (
    <>
      {/* Overlay z-118 — proto 1288. NOT the Shell spec's z-124. */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 118,
          background: "rgba(2,6,23,.55)",
          backdropFilter: "blur(2px)",
        }}
      />
      {/* Panel z-119, min(680px,94vw) — proto 1291. */}
      <div
        data-testid="pv2-cc-wizard"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 119,
          width: "min(680px,94vw)",
          display: "flex",
          flexDirection: "column",
          gap: 0,
          borderLeft: "1px solid rgba(0,120,212,.4)",
          background: "#0b1524",
          boxShadow: "-24px 0 60px rgba(2,6,23,.6)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "15px 20px",
            borderBottom: "1px solid rgba(0,120,212,.2)",
            display: "flex",
            flexDirection: "column",
            gap: 11,
            flex: "0 0 auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".16em",
                  textTransform: "uppercase",
                  color: "#60a5fa",
                }}
              >
                New change request
              </span>
              <span style={{ fontSize: "11.5px", color: "#64748b", lineHeight: 1.45 }}>
                Four steps. Nothing is submitted until the last one.
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                flex: "0 0 auto",
                width: 26,
                height: 26,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                border: "1px solid rgba(148,163,184,.22)",
                background: "transparent",
                color: "#94a3b8",
                fontSize: "14px",
                lineHeight: 1,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              ×
            </button>
          </div>

          {/* Step rail — proto 1300-1307. */}
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {(
              [
                [1, "Target"],
                [2, "Payload JSON"],
                [3, "Risk score"],
                [4, "Schedule"],
              ] as const
            ).map(([n, label]) => (
              <button
                key={n}
                type="button"
                onClick={() => setStep(n)}
                data-testid={`pv2-cc-wizard-step-${n}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: `1px solid ${step === n ? "rgba(0,120,212,.5)" : "rgba(30,41,59,.9)"}`,
                  background: step === n ? "rgba(0,120,212,.09)" : "transparent",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                <span
                  style={{
                    flex: "0 0 20px",
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "10px",
                    fontWeight: 800,
                    fontFamily: CC_MONO,
                    border: `1px solid ${step >= n ? "rgba(0,120,212,.6)" : "rgba(148,163,184,.3)"}`,
                    background: step > n ? "rgba(0,120,212,.25)" : "transparent",
                    color: step >= n ? "#60a5fa" : "#64748b",
                  }}
                >
                  {n}
                </span>
                <span
                  style={{
                    fontSize: "11.5px",
                    fontWeight: step === n ? 700 : 600,
                    color: step === n ? "#e2e8f0" : "#64748b",
                  }}
                >
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "16px 20px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* Step 1 — proto 1310-1327 */}
          {step === 1 && (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
                  gap: 14,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <FieldLabel>CR title</FieldLabel>
                  <input
                    value={draft.title}
                    onChange={(e) => patch({ title: e.target.value })}
                    placeholder="e.g. Disable IMAP on the scanner mailbox"
                    data-testid="pv2-cc-wizard-title"
                    style={inputStyle}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <FieldLabel>Ticket ID</FieldLabel>
                  <input
                    value={draft.ticket}
                    onChange={(e) => patch({ ticket: e.target.value })}
                    placeholder="INC-0000 or CHG-0000"
                    data-testid="pv2-cc-wizard-ticket"
                    style={monoInputStyle}
                  />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <FieldLabel>Target Graph endpoint or PowerShell command</FieldLabel>
                <input
                  value={draft.target}
                  onChange={(e) => patch({ target: e.target.value })}
                  placeholder="PATCH /v1.0/identity/conditionalAccess/policies/{id}  ·  or  ·  Exchange Online · Set-CASMailbox"
                  data-testid="pv2-cc-wizard-target"
                  style={{ ...monoInputStyle, fontSize: "12px" }}
                />
                <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.5 }}>
                  The workload is derived from the target, and the workload decides which approvers
                  are required.
                </span>
              </div>
            </>
          )}

          {/* Step 2 — proto 1329-1341 */}
          {step === 2 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
                gap: 14,
              }}
            >
              <div
                style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}
              >
                <FieldLabel>Pre-change state · snapshot JSON</FieldLabel>
                <textarea
                  value={draft.pre}
                  onChange={(e) => patch({ pre: e.target.value })}
                  placeholder={'{ "setting": "current value" }'}
                  data-testid="pv2-cc-wizard-pre"
                  style={{
                    minHeight: 170,
                    padding: "11px 12px",
                    borderRadius: 8,
                    border: "1px solid rgba(30,41,59,.9)",
                    background: "#0b1524",
                    color: "#cbd5e1",
                    fontSize: "11.5px",
                    lineHeight: 1.6,
                    fontFamily: CC_MONO,
                    resize: "vertical",
                  }}
                />
                <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.5 }}>
                  A pre-change snapshot is captured automatically at execution, not from the JSON you
                  paste here — the field below is for review, and the snapshot is what the rollback
                  vault uses.
                </span>
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}
              >
                <FieldLabel color="#34d399">Proposed target state · payload JSON</FieldLabel>
                <textarea
                  value={draft.post}
                  onChange={(e) => patch({ post: e.target.value })}
                  placeholder={'{ "setting": "proposed value" }'}
                  data-testid="pv2-cc-wizard-post"
                  style={{
                    minHeight: 170,
                    padding: "11px 12px",
                    borderRadius: 8,
                    border: "1px solid rgba(52,211,153,.28)",
                    background: "#0b1524",
                    color: "#e2e8f0",
                    fontSize: "11.5px",
                    lineHeight: 1.6,
                    fontFamily: CC_MONO,
                    resize: "vertical",
                  }}
                />
                <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.5 }}>
                  This is what gets sent. Approvers see this diff, not a description of it.
                </span>
              </div>
            </div>
          )}

          {/* Step 3 — proto 1343-1372 */}
          {step === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <FieldLabel>ITIL change class</FieldLabel>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
                    gap: 9,
                  }}
                >
                  {(
                    [
                      ["Standard", "Pre-approved, low risk, known outcome"],
                      ["Normal", "Two approvals, booked into a window"],
                      ["Emergency", "Immediate, retrospective approval within 24 hours"],
                    ] as const
                  ).map(([cls, desc]) => {
                    const on = draft.changeClass === cls;
                    const colour = CC_CLASS_COLOUR[cls];
                    return (
                      <button
                        key={cls}
                        type="button"
                        onClick={() => patch({ changeClass: cls })}
                        data-testid={`pv2-cc-wizard-class-${cls}`}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                          textAlign: "left",
                          padding: "11px 13px",
                          borderRadius: 9,
                          border: `1px solid ${on ? A(colour, "88") : "rgba(30,41,59,.9)"}`,
                          background: on ? A(colour, "14") : "rgba(15,23,42,.4)",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{
                            fontSize: "12.5px",
                            fontWeight: 800,
                            color: on ? colour : "#e2e8f0",
                          }}
                        >
                          {cls}
                        </span>
                        <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5 }}>
                          {desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <FieldLabel>Affected account count</FieldLabel>
                  <input
                    value={draft.accounts}
                    onChange={(e) => patch({ accounts: e.target.value })}
                    placeholder="e.g. 1240"
                    data-testid="pv2-cc-wizard-accounts"
                    style={monoInputStyle}
                  />
                  <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.5 }}>
                    Count the accounts a failure would affect, not the ones the change is aimed at.
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 5,
                    padding: "12px 14px",
                    border: "1px solid rgba(30,41,59,.9)",
                    borderRadius: 9,
                    background: "#0b1524",
                  }}
                >
                  <FieldLabel>Calculated risk level</FieldLabel>
                  <span
                    style={{
                      fontSize: "20px",
                      fontWeight: 800,
                      color: CC_RISK_COLOUR[risk],
                      fontFamily: CC_MONO,
                    }}
                    data-testid="pv2-cc-wizard-risk"
                  >
                    {risk}
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "#94a3b8",
                      lineHeight: 1.55,
                      textWrap: "pretty",
                    }}
                  >
                    {RISK_WHY[risk]}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Step 4 — proto 1374-1400 */}
          {step === 4 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <FieldLabel>Implementation window</FieldLabel>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {WINDOW_OPTIONS.map((w) => {
                    const on = draft.window === w;
                    return (
                      <button
                        key={w}
                        type="button"
                        onClick={() => patch({ window: w })}
                        data-testid={`pv2-cc-wizard-window-${w.slice(0, 3)}`}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 6,
                          fontSize: "11px",
                          fontWeight: on ? 700 : 600,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          border: `1px solid ${on ? "rgba(34,211,238,.55)" : "rgba(30,41,59,.9)"}`,
                          background: on ? "rgba(34,211,238,.1)" : "transparent",
                          color: on ? "#22d3ee" : "#64748b",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {w}
                      </button>
                    );
                  })}
                </div>
                <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.5 }}>
                  Windows come from your change policy: Tuesday to Thursday, 09:00–16:00, with an
                  early slot for authentication changes and a month-end blackout.
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))",
                  gap: 10,
                  padding: "13px 14px",
                  border: "1px solid rgba(0,120,212,.28)",
                  borderRadius: 10,
                  background: "rgba(0,120,212,.05)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <MetaLabel>Title</MetaLabel>
                  <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.45 }}>
                    {draft.title}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <MetaLabel>Class and risk</MetaLabel>
                  <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.45 }}>
                    {draft.changeClass} · {risk}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <MetaLabel>Window</MetaLabel>
                  <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.45 }}>
                    {draft.window || "No window chosen yet"}
                  </span>
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}
                >
                  <MetaLabel>Target</MetaLabel>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "#e2e8f0",
                      lineHeight: 1.45,
                      wordBreak: "break-all",
                      fontFamily: CC_MONO,
                    }}
                  >
                    {draft.target}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Footer — proto 1402-1415 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              flexWrap: "wrap",
              paddingTop: 8,
              borderTop: "1px solid rgba(30,41,59,.85)",
            }}
          >
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(1, s - 1))}
                style={{
                  marginTop: 10,
                  padding: "9px 15px",
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
                Back
              </button>
            )}
            {step < 4 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(4, s + 1))}
                data-testid="pv2-cc-wizard-next"
                style={{
                  marginTop: 10,
                  padding: "9px 15px",
                  borderRadius: 7,
                  fontSize: "12px",
                  fontWeight: 700,
                  border: "1px solid var(--brand-blue,#0078D4)",
                  background: "var(--brand-blue,#0078D4)",
                  color: "#fff",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Continue
              </button>
            )}
            {step === 4 && (
              <button
                type="button"
                disabled={!ready || busy}
                data-testid="pv2-cc-wizard-submit"
                onClick={async () => {
                  if (!ready || busy) return;
                  setBusy(true);
                  await onSubmit({
                    title: draft.title.trim(),
                    target: draft.target.trim(),
                    ticket: draft.ticket.trim(),
                    pre: draft.pre,
                    post: draft.post.trim(),
                    changeClass: draft.changeClass,
                    impactedUsersCount: parseInt(draft.accounts || "0", 10) || 0,
                    window: draft.window,
                  });
                  setBusy(false);
                }}
                style={{
                  marginTop: 10,
                  padding: "9px 16px",
                  borderRadius: 7,
                  fontSize: "12.5px",
                  fontWeight: 700,
                  cursor: ready && !busy ? "pointer" : "default",
                  fontFamily: "inherit",
                  border: `1px solid ${ready ? "var(--brand-blue,#0078D4)" : "rgba(30,41,59,.9)"}`,
                  background: ready ? "var(--brand-blue,#0078D4)" : "transparent",
                  color: ready ? "#fff" : "#475569",
                }}
              >
                {busy ? "Submitting…" : "Submit for approval"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                marginTop: 10,
                padding: "9px 15px",
                borderRadius: 7,
                fontSize: "12px",
                fontWeight: 600,
                border: "none",
                background: "transparent",
                color: "#64748b",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
            <span style={{ marginTop: 10, fontSize: "10.5px", color: "#475569" }}>
              Submitted requests sit in Pending approval — nothing executes until the approvals are
              in and the window opens.
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
