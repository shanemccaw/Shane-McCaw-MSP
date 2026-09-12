/**
 * Ownership — MSP Console module page (Git #2594, Feature #1686). Mounts into
 * the shell's `ScreenSlot` at `/tenants/:id/raci` (per-tenant, nav id `raci`
 * under the Governance group — `console/nav.ts`), wiring the real backend
 * from #1491 (Portal, closed completed) plus the MSP-side additions this
 * issue adds — see `@/api/ownership-api`'s header for the full route list
 * and the honest, real departures from the design's fixture-driven mock
 * (`Design/MSP_Console/design_handoff_msp_console/Ownership.dc.html`, README
 * screen 37).
 *
 * Real architecture this build does NOT re-decide, all closed completed:
 *   #1518 — the acceptance gate is universal, symmetric, cross-boundary.
 *   #1523 — governance artifacts get RACI rows too, not just M365 objects
 *           (this build reads whatever `sources`/`objects` the backend
 *           actually serves — it does not hardcode an M365-only list).
 *   #1524 — delegations stay customer-side only. No delegation affordance,
 *           read or write, appears anywhere in this file.
 *
 * Three tabs, matching the design's own logic class:
 *   "What we hold"    — every cell an MSP-side person holds, across the book
 *                        (`GET /msp/ownership/mine`).
 *   "Across the book"  — per-customer coverage, zero-count customers included.
 *   "This customer"    — the CURRENT route's tenant's full matrix, cell
 *                        drawer, missing-owner list, assign/accept/decline/
 *                        chase actions. (The design's own "One customer" tab
 *                        carries an internal tenant switcher; this app's real
 *                        navigation model is "every selection has a real URL"
 *                        — see `@/api/ownership-api`'s header.)
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon, type IconName } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import type { DirectoryCustomer } from "@/api/console-api";
import {
  OwnershipApiError,
  useAcceptMspOwnership,
  useAssignMspOwnership,
  useChaseMspOwnership,
  useDeclineMspOwnership,
  useOwnershipEvents,
  useOwnershipMatrix,
  useOwnershipMine,
  type OwnObjectType,
  type OwnRoleKey,
  type WireOwnPerson,
} from "@/api/ownership-api";
import { buildMatrixRows, findMissingOwners, groupByType, type MatrixCellHolder, type MatrixRow } from "@/lib/ownership-matrix";

type Tab = "mine" | "coverage" | "matrix";
type MineFilter = "all" | "pending" | "accepted" | "declined";
type ToneKind = "green" | "amber" | "red" | "blue" | "violet" | "slate";

const TONE: Record<ToneKind, { color: string; tint: string; line: string }> = {
  green: { color: signal.ok.text, tint: signal.ok.tint, line: signal.ok.border },
  amber: { color: signal.warning.text, tint: signal.warning.tint, line: signal.warning.border },
  red: { color: signal.critical.text, tint: signal.critical.tint, line: signal.critical.border },
  blue: { color: signal.info.text, tint: signal.info.tint, line: signal.info.border },
  violet: { color: "#c4b5fd", tint: signal.notice.tint, line: signal.notice.border },
  slate: { color: text.muted, tint: signal.neutral.tint, line: signal.neutral.border },
};

const ROLE_LABEL: Record<OwnRoleKey, string> = { r: "RESPONSIBLE", a: "ACCOUNTABLE", c: "CONSULTED", i: "INFORMED" };
const ROLE_TONE: Record<OwnRoleKey, ToneKind> = { r: "blue", a: "violet", c: "slate", i: "slate" };
const KIND_LABEL: Record<OwnObjectType, string> = {
  workload: "Workload", service: "Service", change: "Change notice", cr: "Change request",
  freeze: "Freeze window", control: "Control", incident: "Incident", announce: "Announcement",
};
const GROUP_LABEL: Record<OwnObjectType, string> = {
  workload: "Workloads", service: "Services", change: "Change notices", cr: "Change requests",
  freeze: "Freeze windows", control: "Controls", incident: "Incidents", announce: "Announcements",
};

function acceptanceTone(acceptance: string): [ToneKind, string, IconName] {
  if (acceptance === "accepted") return ["green", "accepted", "circle-check-big"];
  if (acceptance === "pending") return ["amber", "waiting on them", "clock"];
  if (acceptance === "declined") return ["red", "declined", "circle-x"];
  return ["slate", "in effect", "circle-dot"];
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

function Pill({ label, tone: t }: { label: string; tone: { color: string; tint: string; line: string } }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 999, background: t.tint, border: `1px solid ${t.line}`, fontSize: 10.5, fontWeight: 600, color: t.color, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function TabChip({ label, count, active, onClick }: { label: string; count?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 7,
        border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
        background: active ? "rgba(37,99,235,.18)" : "transparent",
        color: active ? "#bfdbfe" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {label}
      {count !== undefined && <span style={{ fontSize: 10.5, color: active ? signal.info.strong : text.faint }}>{count}</span>}
    </button>
  );
}

function ErrorPanel({ err, wire }: { err: unknown; wire: string }) {
  const status = err instanceof OwnershipApiError ? err.status : null;
  const message = err instanceof Error ? err.message : "The request failed.";
  return (
    <div style={{ border: `1px solid ${status === 403 ? signal.critical.border : signal.warning.border}`, borderRadius: 12, background: surface.card, padding: 22, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
      <Icon name={status === 403 ? "shield-alert" : "triangle-alert"} size={20} color={status === 403 ? signal.critical.strong : signal.warning.strong} />
      <span style={{ fontSize: 15, fontWeight: 700, color: text.title }}>{status === 403 ? "Not authorized" : "Could not load"}</span>
      <span style={{ fontSize: 12.5, color: text.muted }}>{message}</span>
      <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.faint }}>{wire}</span>
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: "44px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
      <span style={{ width: 40, height: 40, borderRadius: 12, background: signal.info.tint, border: `1px solid ${signal.info.border}`, color: signal.info.strong, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={19} />
      </span>
      <span style={{ fontSize: 15, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>{title}</span>
      <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 420, textWrap: "pretty" }}>{body}</span>
    </div>
  );
}

interface SelectedCell {
  objectId: string;
  objectName: string;
  sub: string;
  roleKey: OwnRoleKey;
}

export function Ownership({
  customerId,
  customerName,
  customers,
  onOpenTenant,
}: {
  customerId: number;
  customerName: string;
  customers: DirectoryCustomer[];
  onOpenTenant: (customerId: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("mine");
  const [mineFilter, setMineFilter] = useState<MineFilter>("all");
  const [cell, setCell] = useState<SelectedCell | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [proposePick, setProposePick] = useState<string | null>(null);
  const [gapsOnly, setGapsOnly] = useState(false);

  const mineQuery = useOwnershipMine();
  const matrixQuery = useOwnershipMatrix(customerId);
  const assign = useAssignMspOwnership(customerId);
  const accept = useAcceptMspOwnership(customerId);
  const decline = useDeclineMspOwnership(customerId);
  const chase = useChaseMspOwnership(customerId);

  const holdings = mineQuery.data?.holdings ?? [];
  const byCustomer = mineQuery.data?.byCustomer ?? [];
  const mspPersonCount = mineQuery.data?.mspPersonCount ?? 0;

  const filteredHoldings = holdings.filter((h) => (mineFilter === "all" ? true : mineFilter === "pending" ? h.acceptance === "pending" : mineFilter === "declined" ? h.acceptance === "declined" : h.acceptance === "accepted"));

  const payload = matrixQuery.data;
  const matrixRows = useMemo(() => (payload ? buildMatrixRows(payload) : []), [payload]);
  const grouped = useMemo(() => groupByType(matrixRows), [matrixRows]);
  const missingOwners = useMemo(() => findMissingOwners(matrixRows), [matrixRows]);
  const deadSources = payload?.sources.filter((s) => !s.live) ?? [];

  const closeCell = () => { setCell(null); setDeclineOpen(false); setDeclineReason(""); setProposePick(null); };

  const openCell = (objectId: string, objectName: string, sub: string, roleKey: OwnRoleKey) => {
    setDeclineOpen(false); setDeclineReason(""); setProposePick(null);
    setCell({ objectId, objectName, sub, roleKey });
  };

  const cellRow = cell ? matrixRows.find((r) => r.object.id === cell.objectId) : undefined;
  const cellHolders: readonly MatrixCellHolder[] = cell && cellRow ? cellRow.cells[cell.roleKey] : [];
  const isMsp = (personId: string) => payload?.people.find((p) => p.id === personId)?.side === "MSP";
  const personName = (personId: string) => payload?.people.find((p) => p.id === personId)?.name ?? personId;
  const mspStaff: readonly WireOwnPerson[] = payload?.people.filter((p) => p.side === "MSP") ?? [];

  const eventsQuery = useOwnershipEvents(cell ? customerId : null, cell ? { objectId: cell.objectId, roleKey: cell.roleKey } : null);

  const tabs: { id: Tab; label: string; count: string }[] = [
    { id: "mine", label: "What we hold", count: String(holdings.length) },
    { id: "coverage", label: "Across the book", count: String(byCustomer.length) },
    { id: "matrix", label: "This customer", count: "" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {tabs.map((t) => <TabChip key={t.id} label={t.label} count={t.count || undefined} active={tab === t.id} onClick={() => setTab(t.id)} />)}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: text.muted, whiteSpace: "nowrap" }}>{mspPersonCount} of your staff · {byCustomer.length} customers in scope</span>
      </div>

      {tab === "mine" && (
        <MineTab
          holdings={filteredHoldings}
          total={holdings}
          mineFilter={mineFilter}
          onFilter={setMineFilter}
          loading={mineQuery.isLoading}
          error={mineQuery.error}
          onOpenTenant={onOpenTenant}
        />
      )}

      {tab === "coverage" && (
        <CoverageTab byCustomer={byCustomer} loading={mineQuery.isLoading} error={mineQuery.error} onOpenTenant={onOpenTenant} />
      )}

      {tab === "matrix" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {matrixQuery.error ? (
            <ErrorPanel err={matrixQuery.error} wire={`GET /api/msp/ownership/${customerId}`} />
          ) : matrixQuery.isLoading || !payload ? (
            <div style={{ fontSize: 11.5, color: text.muted }}>Loading {customerName}'s matrix…</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                <Pill
                  label={payload.gateMode === "strict" ? "Placements need accepting here" : "Placements take effect immediately here"}
                  tone={TONE[payload.gateMode === "strict" ? "violet" : "slate"]}
                />
                {missingOwners.length > 0 && (
                  <button
                    onClick={() => setGapsOnly((v) => !v)}
                    style={{ height: 28, padding: "0 10px", borderRadius: 7, border: `1px solid ${gapsOnly ? "rgba(251,191,36,.4)" : border.card}`, background: gapsOnly ? signal.warning.tint : "transparent", color: gapsOnly ? signal.warning.text : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    {missingOwners.length} missing an owner{gapsOnly ? " · showing only these" : ""}
                  </button>
                )}
              </div>

              {!payload.tenantScoped && (
                <div style={{ display: "flex", gap: 10, padding: "13px 14px", borderRadius: 11, border: `1px solid ${signal.warning.border}`, background: signal.warning.tint }}>
                  <Icon name="unplug" size={15} color={signal.warning.strong} style={{ flex: "0 0 15px", marginTop: 2 }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: text.title, textWrap: "pretty" }}>Workloads, change notices and change requests are missing because this tenant can't be resolved</span>
                    <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>Services, freeze windows and the roster below are unaffected and real.</span>
                  </div>
                </div>
              )}

              {matrixRows.length === 0 ? (
                <EmptyState icon="users-round" title="Nothing on this matrix yet" body="This tenant has no services, workloads, change requests, notices or freeze windows on file right now." />
              ) : (
                Array.from(grouped.entries()).map(([type, rows]) => {
                  const visibleRows = gapsOnly ? rows.filter((r) => r.cells.r.length === 0 || r.cells.a.length === 0) : rows;
                  if (visibleRows.length === 0) return null;
                  return (
                    <div key={type} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>{GROUP_LABEL[type]}</span>
                      <MatrixTable rows={visibleRows} onOpenCell={openCell} personName={personName} />
                    </div>
                  );
                })
              )}

              {deadSources.length > 0 && (
                <div style={{ border: `1px dashed ${border.card}`, borderRadius: 11, background: "rgba(2,6,23,.35)", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                  {deadSources.map((s) => (
                    <div key={s.type} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <Icon name="circle-slash" size={14} color={text.label} style={{ flex: "0 0 14px", marginTop: 2 }} />
                      <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>{KIND_LABEL[s.type]}: {s.note}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>WHO CAN BE PLACED</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {payload.people.map((p) => {
                    const t = TONE[p.side === "MSP" ? "blue" : "slate"];
                    return (
                      <div key={p.id} style={{ display: "flex", gap: 9, alignItems: "center", padding: "9px 11px", borderRadius: 10, border: `1px solid ${t.line}`, background: "rgba(2,6,23,.4)", minWidth: 0 }}>
                        <span style={{ width: 24, height: 24, flex: "0 0 24px", borderRadius: 8, background: t.tint, border: `1px solid ${t.line}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, color: t.color }}>{initials(p.name)}</span>
                        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                          <span style={{ fontSize: 12, color: text.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                          <span style={{ fontSize: 10.5, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.role} · {p.side === "MSP" ? "your team" : p.side}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
                  Everyone here is a real named person — this customer's own active users plus your staff. There is no "the MSP" placeholder, and nothing places your team anywhere by default.
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {cell && (
        <CellDrawer
          cell={cell}
          holders={cellHolders}
          isMsp={isMsp}
          personName={personName}
          mspStaff={mspStaff}
          gateMode={payload?.gateMode ?? "loose"}
          proposePick={proposePick}
          onPropose={setProposePick}
          declineOpen={declineOpen}
          declineReason={declineReason}
          onDeclineReason={setDeclineReason}
          onOpenDecline={() => setDeclineOpen(true)}
          onCancelDecline={() => { setDeclineOpen(false); setDeclineReason(""); }}
          onClose={closeCell}
          onAssign={(ownerPersonId) => assign.mutate({ objectId: cell.objectId, roleKey: cell.roleKey, ownerPersonId }, {
            onSuccess: () => setProposePick(null),
            onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to place that person."),
          })}
          onAccept={(ownerPersonId) => accept.mutate({ objectId: cell.objectId, roleKey: cell.roleKey, ownerPersonId }, {
            onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to accept."),
          })}
          onDecline={(ownerPersonId) => decline.mutate(
            { objectId: cell.objectId, roleKey: cell.roleKey, ownerPersonId, reason: declineReason },
            { onSuccess: () => { setDeclineOpen(false); setDeclineReason(""); }, onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to decline.") },
          )}
          onChase={(ownerPersonId) => chase.mutate({ objectId: cell.objectId, roleKey: cell.roleKey, ownerPersonId }, {
            onSuccess: () => toast.success("Nudged them again."),
            onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to chase."),
          })}
          assignPending={assign.isPending}
          acceptPending={accept.isPending}
          declinePending={decline.isPending}
          chasePending={chase.isPending}
          events={eventsQuery.data?.events ?? []}
          eventsLoading={eventsQuery.isLoading}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 2 }}>
        <Icon name="info" size={13} color={text.faint} />
        <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
          Consulted and Informed are never filled in for you — nothing anywhere records who was consulted on
          anything, and guessing would invent an agreement nobody made. A decline escalates to whoever did the
          placing and stops there; there is no reporting line in the platform to climb.
        </span>
      </div>
    </div>
  );
}

// ── "What we hold" tab ────────────────────────────────────────────────────

function MineTab({
  holdings, total, mineFilter, onFilter, loading, error, onOpenTenant,
}: {
  holdings: readonly import("@/api/ownership-api").WireMspOwnHolding[];
  total: readonly import("@/api/ownership-api").WireMspOwnHolding[];
  mineFilter: MineFilter;
  onFilter: (f: MineFilter) => void;
  loading: boolean;
  error: unknown;
  onOpenTenant: (id: number) => void;
}) {
  if (error) return <ErrorPanel err={error} wire="GET /api/msp/ownership/mine" />;

  const tiles = [
    { label: "CELLS WE HOLD", value: String(total.length), note: "Across every customer you can see", color: text.title },
    { label: "WAITING ON US", value: String(total.filter((h) => h.acceptance === "pending").length), note: "Placed and not yet answered — chase them from a customer's own matrix", color: signal.warning.text },
    { label: "WE DECLINED", value: String(total.filter((h) => h.acceptance === "declined").length), note: "Still on the record, with the reason attached", color: signal.critical.text },
  ];
  const filters: { id: MineFilter; label: string }[] = [
    { id: "all", label: "Everything" }, { id: "pending", label: "Waiting on us" },
    { id: "accepted", label: "Accepted" }, { id: "declined", label: "Declined" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        {tiles.map((c) => (
          <div key={c.label} style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 15, display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.label }}>{c.label}</span>
            <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", color: c.color }}>{c.value}</span>
            <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{c.note}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => onFilter(f.id)}
            style={{ height: 28, padding: "0 10px", borderRadius: 7, border: `1px solid ${mineFilter === f.id ? "rgba(96,165,250,.3)" : border.card}`, background: mineFilter === f.id ? "rgba(37,99,235,.18)" : "transparent", color: mineFilter === f.id ? "#bfdbfe" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ fontSize: 11.5, color: text.muted }}>Loading what your team holds…</div>
      ) : holdings.length === 0 ? (
        <EmptyState
          icon="user-round-search"
          title={total.length === 0 ? "Nobody has placed you anywhere" : "Nothing matches that filter"}
          body={total.length === 0
            ? "Your team holds nothing across the whole book. That is the real state, not a screen that failed to load — nothing places your staff anywhere until someone does it by hand."
            : "You hold cells elsewhere in the book; none of them is in that state right now."}
        />
      ) : (
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflowX: "auto" }}>
          <div style={{ minWidth: 1000 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 2fr 1fr .7fr 1.3fr 1.3fr", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.soft}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
              <span>CUSTOMER</span><span>WHAT WE HOLD</span><span>KIND</span><span>ROLE</span><span>WHO HOLDS IT</span><span>STATE</span>
            </div>
            {holdings.map((h) => {
              const [toneKind, label, icon] = acceptanceTone(h.acceptance);
              const t = TONE[toneKind], rt = TONE[ROLE_TONE[h.roleKey]];
              return (
                <div
                  key={`${h.customerId}:${h.objectId}:${h.roleKey}`}
                  onClick={() => onOpenTenant(h.customerId)}
                  style={{ display: "grid", gridTemplateColumns: "1.4fr 2fr 1fr .7fr 1.3fr 1.3fr", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${border.faint}`, cursor: "pointer" }}
                >
                  <span style={{ fontSize: 12.5, color: text.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.customerName}</span>
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, color: text.strong, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.objectName}</span>
                    <span style={{ fontSize: 11, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.sub}</span>
                  </span>
                  <span style={{ fontSize: 11.5, color: text.muted, whiteSpace: "nowrap" }}>{KIND_LABEL[h.objectType]}</span>
                  <span style={{ display: "inline-flex", justifySelf: "start", width: 24, height: 24, borderRadius: 7, background: rt.tint, border: `1px solid ${rt.line}`, fontSize: 11.5, fontWeight: 800, color: rt.color, textTransform: "uppercase", alignItems: "center", justifyContent: "center" }}>{h.roleKey}</span>
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontSize: 12, color: text.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.holderPersonName}</span>
                    <span style={{ fontSize: 11, color: h.order === 0 ? text.label : text.muted }}>{h.order === 0 ? "primary" : "second in the cell"}</span>
                  </span>
                  <Pill label={label} tone={t} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── "Across the book" tab ────────────────────────────────────────────────

function CoverageTab({
  byCustomer, loading, error, onOpenTenant,
}: {
  byCustomer: readonly import("@/api/ownership-api").WireMspOwnCustomerCoverage[];
  loading: boolean;
  error: unknown;
  onOpenTenant: (id: number) => void;
}) {
  if (error) return <ErrorPanel err={error} wire="GET /api/msp/ownership/mine" />;
  if (loading) return <div style={{ fontSize: 11.5, color: text.muted }}>Loading coverage…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflowX: "auto" }}>
        <div style={{ minWidth: 700 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2.4fr 1.2fr", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.soft}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
            <span>CUSTOMER</span><span style={{ textAlign: "right" }}>WE HOLD</span><span>WHAT THAT MEANS</span><span />
          </div>
          {byCustomer.map((c) => (
            <div key={c.customerId} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2.4fr 1.2fr", gap: 12, alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${border.faint}` }}>
              <span style={{ fontSize: 12.5, color: text.strong, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.customerName}</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: c.count === 0 ? text.label : text.title, textAlign: "right" }}>{c.count}</span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
                {c.count === 0
                  ? "Nothing of yours is named anywhere in their matrix. That is real information, not a gap in the list."
                  : `${c.count} ${c.count === 1 ? "cell names" : "cells name"} your staff.`}
              </span>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => onOpenTenant(c.customerId)}
                  style={{ display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 7, border: "1px solid rgba(96,165,250,.3)", background: "rgba(37,99,235,.14)", color: "#bfdbfe", fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  <Icon name="user-round-plus" size={12} />
                  Open matrix
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
        Every customer in your book is listed, including the ones where you hold nothing. A customer missing from
        this list is out of your scope entirely, not a customer with no ownership.
      </span>
    </div>
  );
}

// ── Matrix table (one customer) ──────────────────────────────────────────

function MatrixTable({
  rows, onOpenCell, personName,
}: {
  rows: MatrixRow[];
  onOpenCell: (objectId: string, objectName: string, sub: string, roleKey: OwnRoleKey) => void;
  personName: (id: string) => string;
}) {
  const roles: OwnRoleKey[] = ["r", "a", "c", "i"];
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflowX: "auto" }}>
      <div style={{ minWidth: 860 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2.4fr 1fr 1fr 1fr 1fr", gap: 12, padding: "10px 16px", borderBottom: `1px solid ${border.soft}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
          <span>OBJECT</span><span>RESPONSIBLE</span><span>ACCOUNTABLE</span><span>CONSULTED</span><span>INFORMED</span>
        </div>
        {rows.map((row) => (
          <div key={row.object.id} style={{ display: "grid", gridTemplateColumns: "2.4fr 1fr 1fr 1fr 1fr", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${border.faint}` }}>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 12.5, color: text.strong, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.object.name}</span>
              <span style={{ fontSize: 11, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.object.sub}</span>
            </span>
            {roles.map((role) => {
              const holders = row.cells[role];
              const primary = holders[0];
              const gapMissing = (role === "r" || role === "a") && holders.length === 0;
              return (
                <button
                  key={role}
                  onClick={() => onOpenCell(row.object.id, row.object.name, row.object.sub, role)}
                  style={{
                    display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start", padding: "6px 9px", borderRadius: 8, minWidth: 0, textAlign: "left", cursor: "pointer",
                    border: `1px solid ${primary ? TONE[acceptanceTone(primary.acceptance)[0]].line : gapMissing ? signal.warning.border : border.faint}`,
                    background: primary ? "rgba(2,6,23,.4)" : "transparent",
                  }}
                >
                  <span style={{ fontSize: 11.5, color: primary ? text.body : text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                    {primary ? personName(primary.personId) : "nobody"}
                    {holders.length > 1 ? ` +${holders.length - 1}` : ""}
                  </span>
                  <span style={{ fontSize: 10, color: primary ? TONE[acceptanceTone(primary.acceptance)[0]].color : gapMissing ? signal.warning.text : text.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                    {primary ? (primary.isBaseSeed ? "from the request itself" : acceptanceTone(primary.acceptance)[1]) : role === "c" || role === "i" ? "never guessed" : "a gap"}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Cell drawer ───────────────────────────────────────────────────────────

function CellDrawer({
  cell, holders, isMsp, personName, mspStaff, gateMode, proposePick, onPropose,
  declineOpen, declineReason, onDeclineReason, onOpenDecline, onCancelDecline, onClose,
  onAssign, onAccept, onDecline, onChase,
  assignPending, acceptPending, declinePending, chasePending,
  events, eventsLoading,
}: {
  cell: SelectedCell;
  holders: readonly MatrixCellHolder[];
  isMsp: (personId: string) => boolean | undefined;
  personName: (id: string) => string;
  mspStaff: readonly WireOwnPerson[];
  gateMode: "strict" | "loose";
  proposePick: string | null;
  onPropose: (id: string | null) => void;
  declineOpen: boolean;
  declineReason: string;
  onDeclineReason: (v: string) => void;
  onOpenDecline: () => void;
  onCancelDecline: () => void;
  onClose: () => void;
  onAssign: (ownerPersonId: string) => void;
  onAccept: (ownerPersonId: string) => void;
  onDecline: (ownerPersonId: string) => void;
  onChase: (ownerPersonId: string) => void;
  assignPending: boolean;
  acceptPending: boolean;
  declinePending: boolean;
  chasePending: boolean;
  events: import("@/api/ownership-api").WireOwnEvent[];
  eventsLoading: boolean;
}) {
  const roleTone = TONE[ROLE_TONE[cell.roleKey]];
  const canPropose = cell.roleKey === "r" || cell.roleKey === "a";
  const canSubmitDecline = declineReason.trim().length > 0;
  const [decliningFor, setDecliningFor] = useState<string | null>(null);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(520px,95%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: roleTone.color }}>{ROLE_LABEL[cell.roleKey]}</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>{cell.objectName}</span>
            <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{cell.sub}</span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        {holders.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>WHO HOLDS THIS</span>
              <span style={{ fontSize: 11, color: text.label }}>{holders[0]!.isBaseSeed ? "This one arrived with the request — it was not placed on this page" : "One cell can hold several people at once"}</span>
            </div>
            {holders.map((h) => {
              const [toneKind, label] = acceptanceTone(h.acceptance);
              const t = TONE[toneKind];
              const ours = !!isMsp(h.personId);
              const decliningThis = declineOpen && decliningFor === h.personId;
              return (
                <div key={h.personId} style={{ border: `1px solid ${border.faint}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                    <span style={{ width: 26, height: 26, flex: "0 0 26px", borderRadius: 8, background: t.tint, border: `1px solid ${t.line}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, color: t.color }}>{initials(personName(h.personId))}</span>
                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{personName(h.personId)}</span>
                      <span style={{ fontSize: 11, color: text.label }}>{ours ? "your team" : "customer side"} · {h.order === 0 ? "primary" : "second in the cell"}</span>
                    </span>
                    <Pill label={label} tone={t} />
                  </div>
                  <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
                    {h.isBaseSeed
                      ? "Came from the change request itself — whoever raised it is Responsible, whoever signed it is Accountable. Nothing on this page put them there."
                      : (h.setBy ? `Placed by ${h.setBy}` : "Placed here") + ". Every placement records the same reason: changed on the ownership page."}
                  </span>
                  {h.acceptance === "declined" && <span style={{ fontSize: 11.5, color: signal.critical.text, textWrap: "pretty" }}>Declined — {h.declineReason || "no reason recorded"}</span>}
                  {h.acceptance === "accepted" && <span style={{ fontSize: 11.5, color: signal.ok.text }}>Accepted, and the acceptance is theirs, not the assigner's.</span>}

                  {decliningThis ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>Why are you declining?</span>
                      <input
                        value={declineReason}
                        onChange={(e) => onDeclineReason(e.target.value)}
                        placeholder="Required — this is the durable record"
                        style={{ height: 34, padding: "0 10px", borderRadius: 8, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12.5, outline: "none" }}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => onDecline(h.personId)}
                          disabled={!canSubmitDecline || declinePending}
                          title={canSubmitDecline ? "" : "A reason is required"}
                          style={{ height: 32, padding: "0 12px", borderRadius: 8, border: `1px solid ${canSubmitDecline ? "rgba(248,113,113,.35)" : border.card}`, background: canSubmitDecline ? "rgba(248,113,113,.14)" : "transparent", color: canSubmitDecline ? signal.critical.text : text.faint, fontSize: 12, fontWeight: 600, cursor: canSubmitDecline ? "pointer" : "not-allowed" }}
                        >
                          Decline
                        </button>
                        <button onClick={() => { onCancelDecline(); setDecliningFor(null); }} style={{ height: 32, padding: "0 12px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 12, cursor: "pointer" }}>Cancel</button>
                      </div>
                      <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>A reason is required on your side and optional on theirs.</span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                      {h.acceptance === "pending" && ours && (
                        <>
                          <button onClick={() => onAccept(h.personId)} disabled={acceptPending} style={{ display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 7, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
                            <Icon name="check" size={12} />Accept
                          </button>
                          <button onClick={() => { setDecliningFor(h.personId); onOpenDecline(); }} style={{ display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 7, border: "1px solid rgba(248,113,113,.3)", background: "rgba(248,113,113,.1)", color: "#fca5a5", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
                            <Icon name="x" size={12} />Decline
                          </button>
                        </>
                      )}
                      {h.acceptance === "pending" && (
                        <button onClick={() => onChase(h.personId)} disabled={chasePending} title="Resends the pending-acceptance notice — writes nothing to this cell's record" style={{ display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 7, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 11.5, fontWeight: 600, cursor: chasePending ? "wait" : "pointer" }}>
                            <Icon name="bell" size={12} />Chase
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>
              Order is for reading only. Everyone in this cell carries the same authority regardless of where they
              sit — nothing hands off on a timeout, and nothing activates a second holder when the first goes quiet.
            </span>
          </div>
        ) : (
          <div style={{ border: `1px dashed ${border.card}`, borderRadius: 11, background: "rgba(2,6,23,.4)", padding: "24px 18px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
            <span style={{ width: 34, height: 34, borderRadius: 11, background: signal.neutral.tint, border: `1px solid ${border.card}`, color: text.muted, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="user-round-x" size={17} />
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>Nobody has ever been placed here</span>
            <span style={{ fontSize: 11.5, color: text.muted, maxWidth: 340, textWrap: "pretty" }}>
              {cell.roleKey === "c" || cell.roleKey === "i"
                ? "Consulted and Informed are never filled in for you. Nothing anywhere records who was consulted on anything, and guessing would invent an agreement nobody made."
                : "This is the normal state of almost every cell. Only a change request arrives with anyone in it — everything else stays empty until someone is placed by hand."}
            </span>
          </div>
        )}

        {canPropose && (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>PUT ONE OF YOUR TEAM FORWARD</span>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {mspStaff.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onPropose(p.id)}
                  style={{ height: 30, padding: "0 11px", borderRadius: 7, border: `1px solid ${proposePick === p.id ? "rgba(96,165,250,.32)" : border.card}`, background: proposePick === p.id ? "rgba(37,99,235,.18)" : "transparent", color: proposePick === p.id ? "#bfdbfe" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <button
              onClick={() => proposePick && onAssign(proposePick)}
              disabled={!proposePick || assignPending}
              title={proposePick ? "" : "Pick one of your staff"}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 36, borderRadius: 8, border: `1px solid ${proposePick ? "#2563eb" : border.card}`, background: proposePick ? "#2563eb" : "transparent", color: proposePick ? "#fff" : text.faint, fontSize: 12.5, fontWeight: 600, cursor: proposePick ? "pointer" : "not-allowed" }}
            >
              <Icon name="user-round-plus" size={13} />
              {proposePick ? `Put ${personName(proposePick)} forward` : "Pick someone first"}
            </button>
            <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
              You can only ever place your own staff from here. Placing one of the customer's own people is their
              side of the page, not yours — and you cannot place another MSP's staff at all.
            </span>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>EVERYTHING THAT HAPPENED HERE</span>
          {eventsLoading ? (
            <span style={{ fontSize: 11.5, color: text.muted }}>Loading history…</span>
          ) : events.length === 0 ? (
            <span style={{ fontSize: 12, color: text.label }}>Nothing has ever happened in this cell.</span>
          ) : (
            events.map((e, idx) => (
              <div key={idx} style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0 }}>
                <Icon name={eventIcon(e.eventType)} size={13} color={eventColor(e.eventType)} style={{ flex: "0 0 13px", marginTop: 3 }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{eventText(e, personName)}</span>
                  <span style={{ fontSize: 10.5, color: text.faint }}>{e.at}</span>
                </div>
              </div>
            ))
          )}
          <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
            This history is written once and never edited. Re-placing someone overwrites who holds the cell today,
            but the line above it survives.
          </span>
        </div>
      </div>
    </div>
  );
}

function eventIcon(eventType: string): IconName {
  switch (eventType) {
    case "accepted": return "circle-check-big";
    case "declined": return "circle-x";
    case "cleared": return "circle-dot";
    default: return "user-round-plus";
  }
}

function eventColor(eventType: string): string {
  switch (eventType) {
    case "accepted": return signal.ok.strong;
    case "declined": return signal.critical.strong;
    case "cleared": return text.faint;
    default: return signal.info.strong;
  }
}

function eventText(e: import("@/api/ownership-api").WireOwnEvent, personName: (id: string) => string): string {
  const who = e.ownerPersonId ? personName(e.ownerPersonId) : "someone";
  switch (e.eventType) {
    case "assigned": return `${who} placed by ${e.actor || "someone"}`;
    case "reassigned": return `${who} re-placed by ${e.actor || "someone"}`;
    case "accepted": return `${who} accepted`;
    case "declined": return `${who} declined${e.reason ? ` — ${e.reason}` : ""}`;
    case "cleared": return `Cleared to a gap by ${e.actor || "someone"}`;
    default: return `${who} — ${e.eventType}`;
  }
}
