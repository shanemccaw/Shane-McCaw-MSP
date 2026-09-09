import type { ReactNode } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { comingSoonHref } from "@/components/shell/moduleNav";
import { useOverviewDashboard } from "@/components/overview/useOverviewDashboard";
import { useOverviewTimeline } from "@/components/overview/useOverviewTimeline";
import {
  RED,
  AMB,
  GRN,
  BLU,
  NEUTRAL,
  VIO,
  TIMELINE_STATUS_COLOR,
  formatDay,
  formatTime,
  formatReportPeriod,
} from "@/components/overview/overviewDisplay";

const HAIRLINE = "rgba(255,255,255,.09)";
const CARD_BG = "rgba(255,255,255,.02)";

function Panel({ children, accent }: { children: ReactNode; accent?: string }) {
  return (
    <div
      className="flex min-w-0 flex-col gap-[11px] rounded-[14px] p-[14px] pb-4"
      style={{ border: `1px solid ${accent ?? HAIRLINE}`, background: CARD_BG }}
    >
      {children}
    </div>
  );
}

function PanelLabel({ children, color = "#94a3b8", trailing }: { children: ReactNode; color?: string; trailing?: ReactNode }) {
  return (
    <div className="flex items-center gap-[10px]">
      <span className="text-[9.5px] font-bold" style={{ color, letterSpacing: ".14em" }}>
        {children}
      </span>
      {trailing !== undefined ? <span className="ml-auto text-[10.5px] font-semibold text-[#64748b]">{trailing}</span> : null}
    </div>
  );
}

/**
 * Customer Home / Overview (#2921) — wired to the two real endpoints traced
 * in `docs/portal/customer-home-and-timeline-contract-pack.md`:
 *
 *   GET /api/portal/dashboard            (useOverviewDashboard)
 *   GET /api/portal/customer/timeline    (useOverviewTimeline)
 *
 * Adapted from `Design/portal/design_handoff_full_site/screens/Overview.dc.html`
 * (README: "recreate designs... using this codebase's existing... patterns,
 * not ship the HTML files as-is"). One deliberate shape departure from that
 * reference: its top calendar/gantt strip plots four marker lanes (Scans,
 * Findings, Microsoft Changes, Policy Reviews) and two bar lanes (Change
 * Windows, Projects) using illustrative, hand-authored dates in the design
 * tool's own mock script — not real API data. Of those six lanes, only Scans
 * and Findings (both folded into the real "Happened" feed below) and Projects
 * (real `startDate`/`endDate`, but rendered here as a plain progress bar
 * rather than a plotted gantt bar) have real per-item dated data behind them
 * today. Microsoft Changes, Change Windows and Policy Reviews only have real
 * *aggregate weekly counts* (`overviewCounts`, #2922) — #2922 deliberately
 * scoped that build to counts, not itemized schedules — so this page reads
 * those forward-looking counts honestly in "Coming Up" / "Portal Counts"
 * rather than inventing dated rows the API can't back. The calendar strip
 * itself is not rebuilt this pass; see build-journal/2921.md.
 */
export default function OverviewPage() {
  const dashboard = useOverviewDashboard();
  const timeline = useOverviewTimeline();

  const d = dashboard.data;
  const showError = dashboard.error && !d && dashboard.loaded;
  const showLoading = dashboard.loading && !d;

  const hasSnapshots = d ? d.results.summary.compositeScore !== null : false;
  const isOnboarding = d?.telemetryStatus === "in_progress";
  const isUnpaidTier = d ? Object.values(d.results.pillars).some((p) => p.findingsCount !== undefined) : false;
  // #3344 — Design's own `no_tenant_scope` state: resolveTenantScope(customerId)
  // came back null server-side, so the six tenantScope-scoped overviewCounts
  // fields read as a real 0 rather than an absence of anything due.
  const noTenantScope = d ? !d.tenantScopeResolved : false;

  let stateLine = "MONITORED";
  let stateColor = GRN;
  if (isOnboarding) {
    stateLine = "COLLECTING";
    stateColor = AMB;
  } else if (!hasSnapshots) {
    stateLine = "NEVER SCANNED";
    stateColor = AMB;
  } else if (noTenantScope) {
    stateLine = "SCOPE UNRESOLVED";
    stateColor = AMB;
  } else if (isUnpaidTier) {
    stateLine = "TEXT WITHHELD";
    stateColor = AMB;
  }

  const tenantSub = isOnboarding
    ? "First collection running"
    : d?.results.generatedAt
      ? `Last scan ${formatDay(d.results.generatedAt)} ${formatTime(d.results.generatedAt)}`
      : "";

  const priorityItems = d?.results.summary.priorityItems ?? [];
  const needRows: { tag: string; accent: string; meta: string; title: string; ink: string; action: string; href: string; alt: string; altHref: string }[] = [];
  for (const item of priorityItems) {
    needRows.push({
      tag: item.severity.toUpperCase(),
      accent: item.severity === "critical" ? RED : AMB,
      meta: item.checkKey,
      title: item.title ?? "Finding withheld on your tier",
      ink: item.title ? "#f8fafc" : "#94a3b8",
      action: "Raise change request",
      href: "/change-control",
      alt: "Remediation",
      altHref: "/remediation-tracking",
    });
  }
  if (d && d.overviewCounts.raciPendingAcceptance > 0) {
    needRows.push({
      tag: "ACCEPT OR DECLINE",
      accent: VIO,
      meta: `${d.overviewCounts.raciPendingAcceptance} RACI role${d.overviewCounts.raciPendingAcceptance === 1 ? "" : "s"}`,
      title: "You have been named to Ownership/RACI roles awaiting your acceptance",
      ink: "#f8fafc",
      action: "Accept or decline",
      href: "/ownership",
      alt: "Who owns what",
      altHref: "/ownership",
    });
  }
  if (d && d.overviewCounts.rbdWaiting > 0) {
    needRows.push({
      tag: "SIGNATURE",
      accent: AMB,
      meta: `${d.overviewCounts.rbdWaiting} risk decision${d.overviewCounts.rbdWaiting === 1 ? "" : "s"}`,
      title: "Risk acceptances waiting for your signature",
      ink: "#f8fafc",
      action: "Review and sign",
      href: comingSoonHref("Risk Register", "module"),
      alt: "Risk register",
      altHref: comingSoonHref("Risk Register", "module"),
    });
  }
  if (d && d.overviewCounts.remediationInProgress > 0) {
    needRows.push({
      tag: "OUTSTANDING",
      accent: AMB,
      meta: `${d.overviewCounts.remediationInProgress} step${d.overviewCounts.remediationInProgress === 1 ? "" : "s"}`,
      title: "Remediation steps neither verified nor accepted",
      ink: "#f8fafc",
      action: "Open tracker",
      href: "/remediation-tracking",
      alt: "Policy decisions",
      altHref: comingSoonHref("Policy Decisions", "module"),
    });
  }

  const comingRows = d
    ? [
        { count: d.overviewCounts.microsoftChangesThisWeek, label: "Microsoft changes this week", href: comingSoonHref("Microsoft Changes", "module"), color: BLU },
        { count: d.overviewCounts.changeScheduleThisWeek, label: "Change windows this week", href: "/change-control", color: "#00B4D8" },
        { count: d.overviewCounts.policiesExpiringSoon, label: "Policies due for review", href: comingSoonHref("Policy Decisions", "module"), color: AMB },
      ].filter((r) => r.count > 0)
    : [];

  const portalCounts = d
    ? [
        { value: d.overviewCounts.raciPendingAcceptance, label: "RACI roles awaiting you", href: "/ownership", ink: VIO },
        { value: d.overviewCounts.rbdWaiting, label: "Risk decisions waiting", href: comingSoonHref("Risk Register", "module"), ink: AMB },
        { value: d.overviewCounts.rbdActive, label: "Risk acceptances active", href: comingSoonHref("Risk Register", "module"), ink: NEUTRAL },
        { value: d.overviewCounts.microsoftChangesThisWeek, label: "MS changes this week", href: comingSoonHref("Microsoft Changes", "module"), ink: BLU },
        { value: d.overviewCounts.changeScheduleThisWeek, label: "Change windows this week", href: "/change-control", ink: BLU },
        { value: d.overviewCounts.remediationInProgress, label: "Remediation outstanding", href: "/remediation-tracking", ink: RED },
        { value: d.overviewCounts.policiesExpiringSoon, label: "Policies due for review", href: comingSoonHref("Policy Decisions", "module"), ink: AMB },
      ]
    : [];

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 px-[26px] py-5" style={{ color: "#cbd5e1" }}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-[14px]">
        <span className="text-[21px] font-extrabold text-[#f8fafc]" style={{ letterSpacing: "-.02em" }}>
          {d?.customerName ?? "Your account"}
        </span>
        {d ? (
          <div
            className="flex items-center gap-[7px] rounded-full px-[11px] py-1"
            style={{ border: `1px solid ${stateColor}66`, background: `${stateColor}14` }}
          >
            <span className="size-[6px] rounded-full" style={{ background: stateColor }} />
            <span className="text-[10.5px] font-bold" style={{ color: stateColor, letterSpacing: ".05em" }}>
              {stateLine}
            </span>
          </div>
        ) : null}
        <span className="text-[11.5px] text-[#64748b]">{tenantSub}</span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <a
            href={comingSoonHref("Portal Alerts", "module")}
            className="flex items-center gap-[7px] rounded-lg px-[10px] py-[5px] transition-colors hover:border-[#0078D480]"
            style={{ border: "1px solid rgba(255,255,255,.1)" }}
            data-testid="overview-notifications-chip"
          >
            <span className="text-[13px] font-extrabold text-[#f8fafc]">{d?.unreadNotifications ?? 0}</span>
            <span className="text-[11px] text-[#94a3b8]">notifications</span>
          </a>
          <a
            href="/support"
            className="flex items-center gap-[7px] rounded-lg px-[10px] py-[5px] transition-colors hover:border-[#0078D480]"
            style={{ border: "1px solid rgba(255,255,255,.1)" }}
            data-testid="overview-messages-chip"
          >
            <span className="text-[13px] font-extrabold text-[#f8fafc]">{d?.unreadMessages ?? 0}</span>
            <span className="text-[11px] text-[#94a3b8]">messages</span>
          </a>
        </div>
      </div>

      {showLoading ? (
        <div className="flex flex-1 items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-[#64748b]" />
        </div>
      ) : showError ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-[11px] px-4 py-[13px]"
          style={{ border: "1px solid rgba(248,113,113,.4)", background: "rgba(248,113,113,.07)" }}
        >
          <AlertCircle size={15} color={RED} className="flex-none" />
          <span className="text-[12.5px] font-semibold text-[#f8fafc]">Unable to load dashboard data.</span>
          <button
            type="button"
            onClick={dashboard.refetch}
            className="ml-auto rounded-md px-3 py-[6px] text-[11px] font-bold text-[#f8fafc] transition-colors hover:bg-white/[.06]"
            style={{ border: "1px solid rgba(255,255,255,.16)" }}
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Needs You / Coming Up / Happened */}
          <div className="grid gap-[14px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(316px, 1fr))" }}>
            <Panel accent="rgba(248,113,113,.22)">
              <PanelLabel color="#fca5a5" trailing={needRows.length ? `${needRows.length} open` : "clear"}>
                NEEDS YOU
              </PanelLabel>
              {needRows.length === 0 ? (
                <span className="text-xs text-[#94a3b8]">
                  {!hasSnapshots ? "No scan has run and no register carries an item for you." : "Nothing waiting on you."}
                </span>
              ) : (
                <div className="flex flex-col gap-2">
                  {needRows.map((n, i) => (
                    <div
                      key={i}
                      className="flex flex-col gap-[7px] rounded-[9px] p-[10px]"
                      style={{ border: "1px solid rgba(255,255,255,.07)", borderLeft: `2px solid ${n.accent}`, background: CARD_BG }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[8.5px] font-extrabold" style={{ color: n.accent, letterSpacing: ".1em" }}>
                          {n.tag}
                        </span>
                        <span className="ml-auto truncate text-[9.5px] text-[#475569]" style={{ fontFamily: "Menlo, monospace" }}>
                          {n.meta}
                        </span>
                      </div>
                      <span className="text-[12.5px] font-semibold leading-[1.4]" style={{ color: n.ink }}>
                        {n.title}
                      </span>
                      <div className="flex flex-wrap items-center gap-[7px]">
                        <a
                          href={n.href}
                          className="rounded-md px-[10px] py-[5px] text-[10.5px] font-bold text-[#f8fafc] transition-colors hover:bg-white/[.06]"
                          style={{ border: "1px solid rgba(255,255,255,.15)" }}
                        >
                          {n.action}
                        </a>
                        <a href={n.altHref} className="px-[2px] py-[5px] text-[10.5px] font-semibold text-[#60a5fa] hover:text-[#93c5fd]">
                          {n.alt}
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel>
              <PanelLabel trailing={comingRows.length ? `next ${comingRows.length}` : undefined}>COMING UP</PanelLabel>
              {comingRows.length === 0 ? (
                <span className="text-xs text-[#94a3b8]">
                  {noTenantScope ? "No resolvable tenant identifier to schedule against." : "Nothing scheduled."}
                </span>
              ) : (
                <div className="flex flex-col">
                  {comingRows.map((c, i) => (
                    <a
                      key={i}
                      href={c.href}
                      className="flex items-center gap-[10px] py-[9px] transition-colors hover:bg-white/[.025]"
                      style={{ borderBottom: i < comingRows.length - 1 ? "1px solid rgba(255,255,255,.05)" : undefined }}
                    >
                      <span className="size-[5px] flex-none rounded-full" style={{ background: c.color }} />
                      <span className="min-w-0 flex-1 text-xs font-semibold leading-[1.4] text-[#e2e8f0]">{c.label}</span>
                      <span className="flex-none text-[13px] font-extrabold" style={{ color: c.color, fontVariantNumeric: "tabular-nums" }}>
                        {c.count}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </Panel>

            <Panel>
              <PanelLabel trailing={timeline.events.length ? `${timeline.events.length} event${timeline.events.length === 1 ? "" : "s"}` : undefined}>
                HAPPENED
              </PanelLabel>
              {timeline.loading && timeline.events.length === 0 ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="size-4 animate-spin text-[#64748b]" />
                </div>
              ) : timeline.events.length === 0 ? (
                <span className="text-xs text-[#94a3b8]">No events across any of the five sources.</span>
              ) : (
                <div className="flex flex-col">
                  {timeline.events.map((v, i) => (
                    <div
                      key={v.id}
                      className="flex gap-[11px] py-[9px]"
                      style={{ borderBottom: i < timeline.events.length - 1 ? "1px solid rgba(255,255,255,.05)" : undefined }}
                    >
                      <div className="flex w-14 flex-none flex-col gap-px">
                        <span className="text-[11px] font-bold text-[#e2e8f0]">{formatDay(v.timestamp)}</span>
                        <span className="text-[9.5px] text-[#64748b]">{formatTime(v.timestamp)}</span>
                      </div>
                      <span className="mt-[5px] size-[5px] flex-none rounded-full" style={{ background: TIMELINE_STATUS_COLOR[v.status] }} />
                      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                        <span className="text-xs font-semibold leading-[1.4] text-[#e2e8f0]">{v.title}</span>
                        {v.description ? <span className="text-[10.5px] leading-[1.5] text-[#64748b]">{v.description}</span> : null}
                      </div>
                    </div>
                  ))}
                  {timeline.hasMore ? (
                    <button
                      type="button"
                      onClick={timeline.loadMore}
                      disabled={timeline.loadingMore}
                      className="mt-[11px] self-start rounded-md px-[11px] py-[6px] text-[10.5px] font-bold text-[#f8fafc] transition-colors hover:bg-white/[.06] disabled:opacity-60"
                      style={{ border: "1px solid rgba(255,255,255,.14)" }}
                    >
                      {timeline.loadingMore ? "Loading…" : "Older"}
                    </button>
                  ) : null}
                </div>
              )}
            </Panel>
          </div>

          {/* Work In Flight / Portal Counts / Reports */}
          <div className="grid gap-[14px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <Panel>
              <PanelLabel>WORK IN FLIGHT</PanelLabel>
              {!d || d.projects.length === 0 ? (
                <span className="text-xs text-[#94a3b8]">No active project.</span>
              ) : (
                <div className="flex flex-col gap-[11px]">
                  {d.projects.map((p) => {
                    const stepLabel = p.currentTask ? `${p.currentTask.stepNumber}/${p.currentTask.totalSteps}` : "—";
                    const subLabel = p.currentTask ? p.currentTask.title : p.phase ?? "No task in progress";
                    return (
                      <div key={p.id} className="flex flex-col gap-[6px]">
                        <div className="flex items-baseline gap-[9px]">
                          <span className="min-w-0 flex-1 text-xs font-semibold leading-[1.4] text-[#e2e8f0]">{p.title}</span>
                          <span className="flex-none text-[10.5px] font-bold text-[#7dd3fc]" style={{ fontFamily: "Menlo, monospace" }}>
                            {stepLabel}
                          </span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.07)" }}>
                          <div className="h-1 rounded-full" style={{ width: `${p.progress}%`, background: "#0078D4" }} />
                        </div>
                        <span className="text-[10.5px] text-[#94a3b8]">{subLabel}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            <Panel>
              <PanelLabel>PORTAL COUNTS</PanelLabel>
              {!d ? null : (
                <>
                  <div className="grid gap-x-[14px] gap-y-[11px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(94px, 1fr))" }}>
                    {portalCounts.map((c, i) => (
                      <a key={i} href={c.href} className="flex flex-col gap-[2px]">
                        <span className="text-[19px] font-extrabold leading-none" style={{ color: c.value === 0 ? "#475569" : c.ink, letterSpacing: "-.02em" }}>
                          {c.value}
                        </span>
                        <span className="text-[10.5px] leading-[1.35] text-[#94a3b8]">{c.label}</span>
                      </a>
                    ))}
                  </div>
                  {noTenantScope ? (
                    <span className="text-[10.5px]" style={{ color: AMB }}>
                      Tenant identifier unresolvable — six counts are a real 0. RACI roles are scoped to your account, not the tenant, so that one still reads.
                    </span>
                  ) : null}
                </>
              )}
            </Panel>

            <Panel>
              <PanelLabel>REPORTS</PanelLabel>
              {!d || d.reports.length === 0 ? (
                <span className="text-xs text-[#94a3b8]">No reports yet.</span>
              ) : (
                <div className="flex flex-col">
                  {d.reports.map((r, i) => (
                    <div
                      key={r.id}
                      className="flex items-baseline gap-[10px] py-2"
                      style={{ borderBottom: i < d.reports.length - 1 ? "1px solid rgba(255,255,255,.05)" : undefined }}
                    >
                      <span className="min-w-0 flex-1 text-xs text-[#e2e8f0]">{r.title}</span>
                      <span className="flex-none text-[10.5px] text-[#64748b]" style={{ fontFamily: "Menlo, monospace" }}>
                        {formatReportPeriod(r.reportDate ?? r.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
