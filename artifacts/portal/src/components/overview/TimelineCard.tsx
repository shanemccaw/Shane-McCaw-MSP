import { useMemo, useState } from "react";
import { useOverviewTimelineMatrix, TIMELINE_WINDOWS, type TimelineWindow } from "./useOverviewTimelineMatrix";
import type { EnrichedProjectWire } from "./types";
import { RED, AMB, GRN, BLU, TEAL } from "./overviewDisplay";

const DAY_MS = 86400000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PROJECT_BLUE = "#0078D4";

function fmt(d: Date): string {
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}

interface MarkerPoint {
  id: string;
  date: Date;
  color: string;
  title: string;
  kind: string;
  when: string;
  href?: string;
}

interface BarItem {
  id: string;
  start: Date;
  end: Date;
  label: string;
  title: string;
  href?: string;
}

/**
 * Real Matrix/List timeline card (#4129), reading `GET
 * /api/portal/customer/timeline/matrix`. Ported from Overview.dc.html's
 * `renderVals()`, with two deliberate simplifications versus that reference:
 * no mouse-tracked hover popover (native `title` tooltips instead) and no
 * collision-clustering / stacked-label layout for overlapping markers/bars
 * (each renders at its own position). Both are visual polish on top of a
 * working, correctly-positioned timeline, not core to what #4129 asked for —
 * real dated Microsoft Changes / Change Windows / Policy Reviews markers
 * where none existed before.
 */
export function TimelineCard({ projects }: { projects: readonly EnrichedProjectWire[] }) {
  const [winKey, setWinKey] = useState<string>("5w");
  const [tView, setTView] = useState<"matrix" | "list">("matrix");
  const win: TimelineWindow = TIMELINE_WINDOWS.find((w) => w.key === winKey) ?? TIMELINE_WINDOWS[1]!;
  const { data, loading } = useOverviewTimelineMatrix(win);

  const now = useMemo(() => new Date(), []);
  const start = useMemo(() => new Date(now.getTime() - win.back * DAY_MS), [now, win.back]);
  const end = useMemo(() => new Date(now.getTime() + win.fwd * DAY_MS), [now, win.fwd]);
  const span = end.getTime() - start.getTime();
  const pct = (d: Date) => Math.max(0, Math.min(100, ((d.getTime() - start.getTime()) / span) * 100));

  const ticks = useMemo(() => {
    const out: { left: number; label: string; isNow: boolean }[] = [];
    for (let t = -win.back; t <= win.fwd; t += win.step) {
      const d = new Date(now.getTime() + t * DAY_MS);
      out.push({ left: pct(d), label: fmt(d), isNow: t === 0 });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, now, start, span]);

  const scanPoints: MarkerPoint[] = (data?.scans ?? []).map((s) => ({
    id: s.id,
    date: new Date(s.timestamp),
    color: s.status === "success" ? GRN : AMB,
    title: s.title,
    kind: "SCAN",
    when: fmt(new Date(s.timestamp)),
    href: "/remediation-tracking",
  }));
  const findingPoints: MarkerPoint[] = (data?.findings ?? []).map((f) => ({
    id: f.id,
    date: new Date(f.timestamp),
    color: f.status === "error" ? RED : AMB,
    title: f.title,
    kind: "FINDING",
    when: fmt(new Date(f.timestamp)),
    href: "/remediation-tracking",
  }));
  const msPoints: MarkerPoint[] = (data?.microsoftChanges ?? []).map((m) => ({
    id: m.id,
    date: new Date(m.timestamp),
    color: BLU,
    title: m.title,
    kind: "MICROSOFT 365",
    when: `${fmt(new Date(m.timestamp))} · ${m.workload}`,
    href: "/microsoft-changes",
  }));
  const policyPoints: MarkerPoint[] = (data?.policyReviews ?? []).map((p) => ({
    id: p.id,
    date: new Date(p.reviewDueAt),
    color: p.status === "error" ? RED : p.status === "warning" ? AMB : "#94a3b8",
    title: p.title,
    kind: "POLICY REVIEW",
    when: `${fmt(new Date(p.reviewDueAt))} · review ${p.status === "error" ? "overdue" : p.status === "warning" ? "due" : "on track"}`,
    href: "/policy-decisions",
  }));

  const markerLanes = [
    { label: "Scans", color: GRN, items: scanPoints },
    { label: "Findings", color: RED, items: findingPoints },
    { label: "Microsoft changes", color: BLU, items: msPoints },
    { label: "Policy reviews", color: AMB, items: policyPoints },
  ];

  const ccBars: BarItem[] = (data?.changeWindows ?? [])
    .filter((c) => c.scheduledEnd !== null)
    .map((c) => ({
      id: c.id,
      start: new Date(c.scheduledStart),
      end: new Date(c.scheduledEnd as string),
      label: c.title,
      title: `${c.code} · ${c.title}`,
      href: "/change-control",
    }));
  const projBars: BarItem[] = projects
    .filter((p) => p.startDate && p.endDate)
    .map((p) => ({
      id: `project:${p.id}`,
      start: new Date(p.startDate as string),
      end: new Date(p.endDate as string),
      label: p.title,
      title: p.title,
    }));

  const barLanes = [
    { label: "Change windows", color: TEAL, bars: ccBars },
    { label: "Projects", color: PROJECT_BLUE, bars: projBars },
  ];

  const listRows = [...scanPoints, ...findingPoints, ...msPoints, ...policyPoints]
    .filter((r) => r.date >= start && r.date <= end)
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  const legend = [
    { color: GRN, label: "Scan" },
    { color: RED, label: "Critical" },
    { color: AMB, label: "Warning / due" },
    { color: BLU, label: "Microsoft" },
    { color: TEAL, label: "Change window" },
    { color: PROJECT_BLUE, label: "Project" },
  ];

  return (
    <div
      data-testid="overview-timeline-card"
      className="flex flex-col gap-[10px] rounded-[14px] p-[14px] px-[18px] pb-4"
      style={{ border: "1px solid rgba(255,255,255,.09)", background: "rgba(255,255,255,.02)" }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[9.5px] font-bold text-[#94a3b8]" style={{ letterSpacing: ".14em" }}>
          TIMELINE
        </span>
        <div className="flex items-center gap-[3px] rounded-lg p-[3px]" style={{ border: "1px solid rgba(255,255,255,.09)" }}>
          {(["matrix", "list"] as const).map((key) => (
            <span
              key={key}
              data-testid={`overview-timeline-view-${key}`}
              onClick={() => setTView(key)}
              className="cursor-pointer rounded-md px-[9px] py-1 text-[10px] font-bold"
              style={{
                letterSpacing: ".03em",
                background: tView === key ? "rgba(0,120,212,.24)" : "transparent",
                color: tView === key ? "#f8fafc" : "#94a3b8",
              }}
            >
              {key === "matrix" ? "Matrix" : "List"}
            </span>
          ))}
        </div>
        <span className="text-[11px] text-[#64748b]">
          {fmt(start)} → {fmt(end)}
        </span>
        <div className="ml-auto flex items-center gap-[3px] rounded-lg p-[3px]" style={{ border: "1px solid rgba(255,255,255,.09)" }}>
          {TIMELINE_WINDOWS.map((w) => (
            <span
              key={w.key}
              onClick={() => setWinKey(w.key)}
              className="cursor-pointer rounded-md px-[9px] py-1 text-[10px] font-bold"
              style={{
                letterSpacing: ".03em",
                background: w.key === winKey ? "rgba(0,120,212,.24)" : "transparent",
                color: w.key === winKey ? "#f8fafc" : "#64748b",
              }}
            >
              {w.label}
            </span>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-8">
          <span className="text-xs text-[#64748b]">Loading timeline…</span>
        </div>
      ) : tView === "matrix" ? (
        <div className="flex flex-col gap-0">
          <div className="flex items-center pb-[2px]">
            <span className="w-32 flex-none" />
            <div className="relative h-[15px] min-w-0 flex-1">
              {ticks.map((t, i) => (
                <span
                  key={i}
                  className="absolute top-0 whitespace-nowrap text-[9.5px] font-semibold"
                  style={{ left: `${t.left}%`, transform: "translateX(-50%)", letterSpacing: ".04em", color: t.isNow ? "#7dd3fc" : "#475569" }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          {markerLanes.map((lane) => (
            <div key={lane.label} className="flex items-stretch gap-0">
              <div className="flex w-32 flex-none items-center gap-[7px] pr-3">
                <span className="size-[5px] flex-none rounded-full" style={{ background: lane.color }} />
                <span className="min-w-0 text-[11px] font-semibold text-[#cbd5e1]">{lane.label}</span>
              </div>
              <div className="relative h-[34px] min-w-0 flex-1" style={{ borderTop: "1px solid rgba(255,255,255,.05)" }}>
                <span className="absolute bottom-0 top-0 w-px" style={{ left: `${pct(now)}%`, background: "rgba(0,180,216,.55)" }} />
                {lane.items.map((m) => (
                  <a
                    key={m.id}
                    href={m.href}
                    title={`${m.kind} — ${m.title} (${m.when})`}
                    className="absolute top-[12px] size-[9px] rounded-full"
                    style={{ left: `${pct(m.date)}%`, transform: "translateX(-50%)", background: m.color }}
                  />
                ))}
              </div>
            </div>
          ))}

          {barLanes.map((lane) => (
            <div key={lane.label} className="flex items-stretch gap-0">
              <div className="flex w-32 flex-none items-center gap-[7px] pr-3">
                <span className="size-[5px] flex-none rounded-full" style={{ background: lane.color }} />
                <span className="min-w-0 text-[11px] font-semibold text-[#cbd5e1]">{lane.label}</span>
              </div>
              <div className="relative min-w-0 flex-1" style={{ height: `${Math.max(34, lane.bars.length * 26 + 6)}px`, borderTop: "1px solid rgba(255,255,255,.05)" }}>
                <span className="absolute bottom-0 top-0 w-px" style={{ left: `${pct(now)}%`, background: "rgba(0,180,216,.55)" }} />
                {lane.bars.map((b, i) => {
                  const l = pct(b.start);
                  const w = Math.max(0.7, pct(b.end) - l);
                  return (
                    <a
                      key={b.id}
                      href={b.href}
                      title={b.title}
                      className="absolute flex items-center overflow-hidden rounded-[5px] px-2 text-[10px] font-bold text-[#f8fafc]"
                      style={{
                        left: `${l}%`,
                        width: `${w}%`,
                        top: `${7 + i * 26}px`,
                        height: "20px",
                        background: lane.color === TEAL ? "rgba(0,180,216,.24)" : "rgba(0,120,212,.16)",
                        border: `1px solid ${lane.color === TEAL ? "rgba(0,180,216,.55)" : "rgba(0,120,212,.45)"}`,
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {b.label}
                    </a>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-[14px] pt-[10px]" style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
            {legend.map((l) => (
              <div key={l.label} className="flex items-center gap-[6px]">
                <span className="size-[7px] rounded-sm" style={{ background: l.color }} />
                <span className="text-[10px] text-[#64748b]">{l.label}</span>
              </div>
            ))}
            <span className="ml-auto text-[10px] text-[#475569]" style={{ fontFamily: "Menlo, monospace" }}>
              diagnostic runs · findings · message center · policy decisions
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-0">
          {listRows.length === 0 ? (
            <span className="py-[14px] text-xs text-[#64748b]">Nothing in this window.</span>
          ) : (
            listRows.map((e) => (
              <a
                key={e.id}
                href={e.href}
                className="flex items-baseline gap-[11px] py-[9px] transition-colors hover:bg-white/[.025]"
                style={{ borderBottom: "1px solid rgba(255,255,255,.05)" }}
              >
                <span className="w-[52px] flex-none text-[11px] font-bold text-[#94a3b8]">{fmt(e.date)}</span>
                <span className="size-[7px] flex-none rounded-sm" style={{ background: e.color }} />
                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="text-[12.5px] font-semibold leading-[1.4] text-[#e2e8f0]">{e.title}</span>
                  <span className="text-[10.5px] text-[#64748b]">
                    {e.kind} · {e.when}
                  </span>
                </div>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
}
