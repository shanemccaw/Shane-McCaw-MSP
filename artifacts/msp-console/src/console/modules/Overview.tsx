/**
 * Overview — the tenant's default landing page (Git #3822, README screen 3).
 * Mounts into the shell's `ScreenSlot` at `/tenants/:id/overview`
 * (`Design/MSP_Console/design_handoff_msp_console/MSP Console.dc.html`, the
 * `isOverview` branch of the logic class — that class is the specification
 * for the tile/section/note shapes below).
 *
 * A real cross-domain roll-up, not a frame grid: four count tiles, four
 * grouped row lists, and a "How this roll-up is assembled" note block. Every
 * number comes from a real, already-wired endpoint this Epic's other Features
 * built — this module adds no new backend, it aggregates eight of them:
 * Change Control, Risk Register, Break Glass, Team, Runbooks, Scope & SLA,
 * SOPs, Documents, Data Rights and Webhooks. Three customer-scoped SLA/scope-
 * creep reads (`useSlaTimersForCustomer`, `useSlaBreachesForCustomer`,
 * `useScopeCreepDetectionsForCustomer`, added to `scope-sla-api.ts` by this
 * same change) are the one new wiring this page needed — the routes
 * themselves (`msp-sla.ts`, `msp-scope-creep.ts`) already existed and already
 * accepted `?customerId=`.
 *
 * The note block's eight entries are load-bearing documentation, not filler
 * (README screen 3 / the design's own `ovNotes`): the risk register arrives
 * whole and is filtered client-side; SLA timers/detections cap at 200 rows
 * and breaches at 100, so a very noisy tenant's count is a floor, not a
 * total; SOP runs are filtered out of the MSP-wide history; documents is the
 * one records row that is a real scoped read; data-rights activity needs
 * MSPAdmin and is status-less; webhooks distinguishes operator-disabled from
 * owner-switched-off; break-glass counts unclaimed credentials, nothing more.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMemo } from "react";
import { Icon, type IconName } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import type { DirectoryCustomer } from "@/api/console-api";
import type { Selection } from "@/console/nav";
import { useChangeRequests, filterByTenant, tenantKeyOf } from "@/pages/change-control/api";
import { useRbdList } from "@/api/rbd-api";
import { useMspCustomerBreakGlass } from "@/api/break-glass-api";
import { useTeamRoster } from "@/api/team-api";
import { useMspRunbooks } from "@/api/runbooks-api";
import {
  useSlaTimersForCustomer, useSlaBreachesForCustomer, useScopeCreepDetectionsForCustomer,
} from "@/api/scope-sla-api";
import { useRemediationCatalogue } from "@/api/remediation-api";
import { useSopRuns } from "@/api/sops-api";
import { useDocumentsHub } from "@/api/documents-api";
import { useDataRightsActivity, DataRightsApiError } from "@/api/data-rights-api";
import { useCustomerWebhooks } from "@/api/webhooks-api";

type ToneKind = "green" | "amber" | "red" | "blue" | "slate";

const TONE: Record<ToneKind, { color: string; tint: string; line: string }> = {
  green: { color: signal.ok.text, tint: signal.ok.tint, line: signal.ok.border },
  amber: { color: signal.warning.text, tint: signal.warning.tint, line: signal.warning.border },
  red: { color: signal.critical.text, tint: signal.critical.tint, line: signal.critical.border },
  blue: { color: signal.info.text, tint: signal.info.tint, line: signal.info.border },
  slate: { color: text.muted, tint: signal.neutral.tint, line: signal.neutral.border },
};

interface Tile {
  key: string;
  icon: IconName;
  value: string;
  label: string;
  tone: ToneKind;
  go: () => void;
}

interface Row {
  key: string;
  label: string;
  value: string;
  meta: string;
  tone: ToneKind | null;
  go: () => void;
}

interface Section {
  key: string;
  title: string;
  note: string;
  rows: Row[];
}

/** The note block's eight entries — copy is final, straight from the design's `ovNotes`. */
const NOTES: { icon: IconName; color: string; tint: string; line: string; title: string; body: string; wire: string }[] = [
  {
    icon: "file-json", color: "#60a5fa", tint: "rgba(96,165,250,.08)", line: "rgba(96,165,250,.24)",
    title: "The risk register arrives whole, then gets filtered here",
    body: "The list route takes no query params and returns every risk decision for the MSP as raw table rows with no derived fields, so both risk rows above filter it client-side on the raw tenantId text column. The only statuses are pending_signature, active and revoked — expired was removed from the vocabulary.",
    wire: "GET /api/msp/rbd",
  },
  {
    icon: "book-open", color: "#a78bfa", tint: "rgba(167,139,250,.08)", line: "rgba(167,139,250,.24)",
    title: "Both runbook rows come out of one request",
    body: "The operator read returns runbooks, hold windows and a summary together for one customer. Cycles are active, complete or abandoned; a hold counts as open until it is closed. No cross-book read exists, so the same roll-up for every tenant is one call each.",
    wire: "GET /api/msp/runbooks?customerId=",
  },
  {
    icon: "gauge", color: "#fbbf24", tint: "rgba(251,191,36,.08)", line: "rgba(251,191,36,.24)",
    title: "The SLA and scope counts are capped reads, so they are floors",
    body: "Timers, breaches and detections each accept a customerId filter — three scoped reads, not a filter of the whole book. Timers and detections cap at 200 rows and breaches at 100, so a very noisy tenant's count is the cap, not the total.",
    wire: "GET /msp/sla/timers · /msp/sla/breaches · /msp/scope-creep/detections",
  },
  {
    icon: "list-checks", color: "#60a5fa", tint: "rgba(96,165,250,.08)", line: "rgba(96,165,250,.24)",
    title: "SOP runs are filtered out of the MSP-wide history",
    body: "The run history has no customer filter, so this row narrows the whole MSP's runs by tenant. A hybrid run whose automated steps all finish while manual steps are still open settles to Blocked, not Completed — that is the state worth opening.",
    wire: "GET /api/msp/sop-runs",
  },
  {
    icon: "folder", color: "#94a3b8", tint: "rgba(148,163,184,.06)", line: "rgba(148,163,184,.18)",
    title: "Documents is the one records row that is a real scoped read",
    body: "The hub list takes customerId alongside docType, category, status and paging, so this count is the tenant's own rather than a client-side slice.",
    wire: "GET /api/msp/documents-hub?customerId=",
  },
  {
    icon: "shield-x", color: "#f87171", tint: "rgba(248,113,113,.08)", line: "rgba(248,113,113,.24)",
    title: "Data-rights activity needs MSPAdmin and only sees the newest rows",
    body: "An MSPOperator who can read every other row on this page gets a 403 on this one. The feed takes only a limit (200 maximum, no paging, no customer or action filter) and the underlying audit rows carry no status at all, so this is a client-side count of recent activity and can never say how many are outstanding.",
    wire: "GET /api/msp/data-rights?limit=",
  },
  {
    icon: "webhook", color: "#a78bfa", tint: "rgba(167,139,250,.08)", line: "rgba(167,139,250,.24)",
    title: "Disabled by an operator is a different fact from switched off",
    body: "Who disabled it, when and why are recorded only while an MSP operator holds the endpoint disabled; the owner touching the active flag in either direction clears all three. There is no cross-customer list, so this row is one request per tenant.",
    wire: "GET /api/msp/customers/:customerId/webhooks",
  },
  {
    icon: "key-round", color: "#fbbf24", tint: "rgba(251,191,36,.08)", line: "rgba(251,191,36,.24)",
    title: "Break-glass counts unclaimed credentials, nothing more",
    body: "Pending delivery is the same filter the cross-tenant list applies server-side. The credential itself never reaches this console on any route, so the tile can only ever say that one is waiting.",
    wire: "GET /msp/break-glass",
  },
];

function formatShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function Overview({ customer, navigate }: { customer: DirectoryCustomer; navigate: (sel: Selection) => void }) {
  const tenant = customer.id;
  const tenantKey = tenantKeyOf(customer);

  const crQuery = useChangeRequests();
  const rbdQuery = useRbdList();
  const bgQuery = useMspCustomerBreakGlass(tenant);
  const rosterQuery = useTeamRoster(tenant);
  const runbooksQuery = useMspRunbooks(tenant);
  const timersQuery = useSlaTimersForCustomer(tenant);
  const breachesQuery = useSlaBreachesForCustomer(tenant);
  const detectionsQuery = useScopeCreepDetectionsForCustomer(tenant);
  const remediationQuery = useRemediationCatalogue(tenant);
  const sopRunsQuery = useSopRuns();
  const hubQuery = useDocumentsHub(tenant);
  const dataRightsQuery = useDataRightsActivity();
  const webhooksQuery = useCustomerWebhooks(tenant);

  const loading = crQuery.isLoading || rbdQuery.isLoading || bgQuery.isLoading || rosterQuery.isLoading
    || runbooksQuery.isLoading || timersQuery.isLoading || breachesQuery.isLoading || detectionsQuery.isLoading
    || remediationQuery.isLoading || sopRunsQuery.isLoading || hubQuery.isLoading || webhooksQuery.isLoading;

  const { tiles, sections } = useMemo(() => {
    const crs = filterByTenant(crQuery.data ?? [], tenantKey);
    const rbdsT = tenantKey ? (rbdQuery.data ?? []).filter((r) => r.tenantId === tenantKey) : [];
    const bgs = bgQuery.data?.secrets ?? [];
    const roster = rosterQuery.data ?? [];
    const runbooksPayload = runbooksQuery.data;
    const runsT = runbooksPayload?.runbooks ?? [];
    const holdsT = (runbooksPayload?.holds ?? []).filter((h) => h.closedAt === null);
    const timersT = timersQuery.data?.timers ?? [];
    const breachesT = (breachesQuery.data?.breaches ?? []).filter((b) => b.resolvedAt === null);
    const detT = detectionsQuery.data?.detections ?? [];
    const remSteps = remediationQuery.data?.steps ?? [];
    const outstandingRem = remSteps.filter((s) => s.terminalState === "outstanding");
    const sopRunsT = tenantKey ? (sopRunsQuery.data ?? []).filter((r) => r.tenantId === tenantKey) : [];
    const hubT = hubQuery.data?.documents ?? [];
    const dr403 = dataRightsQuery.isError && dataRightsQuery.error instanceof DataRightsApiError && dataRightsQuery.error.status === 403;
    const drT = dr403 ? [] : (dataRightsQuery.data?.requests ?? []).filter((a) => a.customerId === tenant);
    const whT = webhooksQuery.data?.webhooks ?? [];

    const critCrs = crs.filter((c) => c.riskLevel === "critical" && c.status !== "completed" && c.status !== "rolled_back");
    const pendingCrs = crs.filter((c) => c.status === "pending_approval");
    const inFlightCrs = crs.filter((c) => c.status === "scheduled" || c.status === "in_progress");
    const lockedUsers = roster.filter((u) => u.isLockedOut || !u.isActive);
    const noMfa = roster.filter((u) => u.mfaStatus === "Disabled");
    const pendingBg = bgs.filter((b) => b.status === "pending_delivery");
    const unsignedRbds = rbdsT.filter((r) => r.status === "pending_signature");
    const sopBlocked = sopRunsT.filter((x) => x.status === "Blocked").length;
    const whMspDisabled = whT.filter((w) => !w.isActive && w.disabledByMspUserId != null).length;
    const whOwnerOff = whT.filter((w) => !w.isActive && w.disabledByMspUserId == null).length;
    const activeCycles = runsT.filter((r) => r.currentRunId != null).length;
    const warningTimers = timersT.filter((t) => t.status === "warning").length;

    const go = (page: string) => () => navigate({ kind: "page", tenant, page });

    const tiles: Tile[] = [
      { key: "crit", icon: "shield-x", value: String(breachesT.length + critCrs.length), label: "Critical and breached — needs action today", tone: breachesT.length + critCrs.length ? "red" : "slate", go: go("cc.register") },
      { key: "decision", icon: "stamp", value: String(pendingCrs.length + unsignedRbds.length), label: "Awaiting a decision or signature", tone: pendingCrs.length + unsignedRbds.length ? "amber" : "slate", go: go("cc.register") },
      { key: "bg", icon: "key-round", value: String(pendingBg.length), label: "Break-glass credentials unclaimed", tone: pendingBg.length ? "amber" : "slate", go: go("bg") },
      { key: "locked", icon: "user-x", value: String(lockedUsers.length + noMfa.length), label: "Accounts locked, suspended or without MFA", tone: lockedUsers.length + noMfa.length ? "amber" : "slate", go: go("team") },
    ];

    const sections: Section[] = [
      {
        key: "needs-you", title: "NEEDS YOU", note: "Nothing moves until someone decides",
        rows: [
          { key: "cr-pending", label: "Change requests pending approval", value: pendingCrs.length ? String(pendingCrs.length) : "none", meta: pendingCrs.length ? `${pendingCrs[0].id} · ${pendingCrs[0].title}` : "approval ledger clear", tone: pendingCrs.length ? "amber" : "green", go: go("cc.register") },
          { key: "rbd-unsigned", label: "Risk decisions awaiting the customer's signature", value: unsignedRbds.length ? String(unsignedRbds.length) : "none", meta: unsignedRbds.length ? `${unsignedRbds[0].registerRef ?? unsignedRbds[0].rbdId} · ${unsignedRbds[0].title}` : "every decision signed", tone: unsignedRbds.length ? "amber" : "green", go: go("risk") },
          { key: "bg-pending", label: "Break-glass verification links live", value: pendingBg.length ? String(pendingBg.length) : "none", meta: pendingBg.length ? `secret #${pendingBg[0].pendingSecretId} · pending since ${formatShort(pendingBg[0].createdAt)}` : "no credential waiting", tone: pendingBg.length ? "amber" : "green", go: go("bg") },
          { key: "holds", label: "Hold windows running down", value: holdsT.length ? String(holdsT.length) : "none", meta: holdsT.length ? holdsT[0].title : "nothing waiting on the customer", tone: holdsT.length ? "amber" : "green", go: go("run") },
        ],
      },
      {
        key: "signal-posture", title: "SIGNAL AND POSTURE", note: "What the engines see right now",
        rows: [
          { key: "breaches", label: "Unresolved SLA breaches", value: breachesT.length ? String(breachesT.length) : "none", meta: breachesT.length ? `${breachesT[0].phase} on ${breachesT[0].ticketRef ?? breachesT[0].breachId}` : "inside every commitment", tone: breachesT.length ? "red" : "green", go: go("signals") },
          { key: "timers", label: "SLA timers running", value: String(timersT.length), meta: `${warningTimers} past the warning threshold`, tone: warningTimers ? "amber" : "blue", go: go("signals") },
          { key: "scope", label: "Scope creep detections open", value: detT.length ? String(detT.length) : "none", meta: detT.length ? (detT[0].ref ?? detT[0].detectionId) : "scope matches the agreement", tone: detT.length ? "amber" : "green", go: go("signals") },
          { key: "rem", label: "Remediation steps outstanding", value: remSteps.length ? String(outstandingRem.length) : "none", meta: remSteps.length ? `of ${remSteps.length} tracked steps` : "tracker not started for this tenant", tone: remSteps.length === 0 ? "slate" : outstandingRem.length > 3 ? "amber" : "blue", go: go("rem") },
        ],
      },
      {
        key: "work-in-flight", title: "WORK IN FLIGHT", note: "Already authorized, already moving",
        rows: [
          { key: "cr-inflight", label: "Change requests scheduled or in progress", value: inFlightCrs.length ? String(inFlightCrs.length) : "none", meta: inFlightCrs.length ? `${inFlightCrs[0].id} · ${formatShort(inFlightCrs[0].scheduledFor)}` : "nothing booked", tone: "blue", go: go("cc.register") },
          { key: "sop-runs", label: "SOP runs against this tenant", value: sopRunsT.length ? String(sopRunsT.length) : "none", meta: sopRunsT.length ? `${sopBlocked ? `${sopBlocked} blocked on a manual step · ` : ""}${sopRunsT[0].runId} · ${sopRunsT[0].status}` : "no procedure running", tone: sopBlocked ? "amber" : "blue", go: () => navigate({ kind: "msp", page: "sops" }) },
          { key: "runbook-cycles", label: "Runbook cycles active", value: String(activeCycles), meta: runsT.length ? `${runsT[0].title} · ${runsT[0].checkedSteps} of ${runsT[0].totalSteps} steps` : "no runbook assigned", tone: "blue", go: go("run") },
          { key: "lc", label: "Launch Control", value: "not wired", meta: "no catalog action is wired to a template yet", tone: "slate", go: go("lc") },
        ],
      },
      {
        key: "commercial", title: "COMMERCIAL AND RECORDS", note: "The paper trail behind all of it",
        rows: [
          { key: "docs", label: "Generated documents", value: String(hubT.length), meta: hubT.length ? hubT[0].title : "nothing generated yet", tone: "slate", go: go("hub") },
          { key: "rbds", label: "Risk decisions on record", value: String(rbdsT.length), meta: `${rbdsT.filter((r) => r.status === "active").length} active · ${rbdsT.filter((r) => r.status === "revoked").length} revoked`, tone: "slate", go: go("risk") },
          { key: "dr", label: "Data-rights activity", value: dr403 ? "—" : String(drT.length), meta: dr403 ? "requires MSPAdmin (403)" : drT.length ? drT[0].actionType.replace(/_/g, " ") : "no export or deletion request", tone: "slate", go: go("dr") },
          { key: "wh", label: "Outbound webhooks", value: String(whT.length), meta: whT.length ? `${whMspDisabled} disabled by an operator${whOwnerOff ? ` · ${whOwnerOff} switched off by the owner` : ""}` : "no endpoint registered", tone: whMspDisabled ? "amber" : "slate", go: go("wh") },
        ],
      },
    ];

    return { tiles, sections };
  }, [
    crQuery.data, rbdQuery.data, bgQuery.data, rosterQuery.data, runbooksQuery.data,
    timersQuery.data, breachesQuery.data, detectionsQuery.data, remediationQuery.data,
    sopRunsQuery.data, hubQuery.data, dataRightsQuery.data, dataRightsQuery.isError, dataRightsQuery.error,
    webhooksQuery.data, tenant, tenantKey, navigate,
  ]);

  if (loading) {
    return <div style={{ fontSize: 11.5, color: text.muted }}>Loading everything open across this tenant…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        {tiles.map((k) => {
          const tone = TONE[k.tone];
          return (
            <button
              key={k.key}
              onClick={k.go}
              style={{ border: `1px solid ${tone.line}`, borderRadius: 12, background: tone.tint, padding: 15, display: "flex", flexDirection: "column", gap: 8, cursor: "pointer", textAlign: "left" }}
            >
              <span style={{ width: 26, height: 26, borderRadius: 8, background: "rgba(2,6,23,.35)", border: `1px solid ${tone.line}`, color: tone.color, padding: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={k.icon} size={14} />
              </span>
              <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", color: text.title }}>{k.value}</span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{k.label}</span>
            </button>
          );
        })}
      </div>

      {sections.map((sec) => (
        <div key={sec.key} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: text.label }}>{sec.title}</span>
            <span style={{ fontSize: 11.5, color: text.faint }}>{sec.note}</span>
          </div>
          <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflow: "hidden" }}>
            {sec.rows.map((r) => {
              const tone = r.tone ? TONE[r.tone] : null;
              return (
                <div
                  key={r.key}
                  onClick={r.go}
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderBottom: `1px solid ${border.faint}`, cursor: "pointer", flexWrap: "wrap" }}
                >
                  <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 180 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{r.label}</span>
                    <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>{r.meta}</span>
                  </span>
                  <span style={{
                    display: "inline-flex", alignItems: "center", padding: "4px 11px", borderRadius: 999,
                    background: tone?.tint ?? "transparent", border: `1px solid ${tone?.line ?? "transparent"}`,
                    fontSize: 12, fontWeight: 600, color: tone?.color ?? text.secondary, whiteSpace: "nowrap",
                  }}>
                    {r.value}
                  </span>
                  <Icon name="chevron-right" size={15} color={text.faint} />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>HOW THIS ROLL-UP IS ASSEMBLED</span>
        {NOTES.map((n) => (
          <div key={n.wire} style={{ display: "flex", gap: 10, padding: "11px 13px", borderRadius: 10, border: `1px solid ${n.line}`, background: n.tint }}>
            <Icon name={n.icon} size={15} color={n.color} style={{ marginTop: 2 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: text.body, textWrap: "pretty" }}>{n.title}</span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{n.body}</span>
              <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.faint, wordBreak: "break-all" }}>{n.wire}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
