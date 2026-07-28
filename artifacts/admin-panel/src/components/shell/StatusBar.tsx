import { type ReactNode } from "react";
import { Bell, Volume2, VolumeX, SquareTerminal, Mail } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useVersionInfo, formatRunningSince } from "@/hooks/useVersionInfo";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { AiCostSegments } from "@/hooks/useAiCostSegments";

// Persistent bottom status bar — the one place visual boldness is spent.
// Segmented LED-style dots per live signal; cyan means "live right now".

export interface CampaignBadge {
  id: number;
  name: string;
  slug: string;
  liveCount: number;
}

interface StatusBarProps {
  workspaceLabel: string | null;
  sectionLabel: string | null;
  liveVisitors: number | null;
  campaignBadges: CampaignBadge[];
  unreadEmailCount: number;
  unreadNotifCount: number;
  onBellClick: () => void;
  soundMuted: boolean;
  onToggleMute: () => void;
  consoleOpen: boolean;
  onToggleConsole: () => void;
  /**
   * Live platform-wide AI spend for the Today/Month segments. Threaded down
   * from GlobalIDEShell (via useAiCostSegments) rather than fetched here, the
   * same way liveVisitors/campaignBadges are — StatusBar stays presentational.
   * Omitted entirely in contexts that don't wire it up.
   */
  aiCost?: AiCostSegments;
  rightExtra?: ReactNode;
}

/**
 * Format integer cents as "$X.XX".
 *
 * ai_usage_events.cost_cents is an INTEGER column, so a single call's cost is
 * never finer-grained than one cent — the segments show two decimals rather
 * than implying a sub-cent precision the ledger does not actually carry.
 */
function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTransactionTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Best available human label for what a usage event actually produced. */
function describeTransaction(t: AiCostSegments["recent"][number]): string {
  return t.generatedArtifactName ?? t.generatedArtifactType ?? t.feature ?? t.nodeType ?? "AI call";
}

/** LED dot: cyan = live-now, amber = campaign, idle = muted. */
function Led({ tone, pulse, glowKey }: { tone: "live" | "warning" | "idle"; pulse?: boolean; glowKey?: number | string }) {
  const color =
    tone === "live" ? "bg-live" :
    tone === "warning" ? "bg-warning" :
    "bg-border";
  return (
    <span
      key={glowKey}
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${color} ${pulse ? "led-pulse" : ""} ${tone === "live" && glowKey !== undefined ? "led-glow" : ""}`}
    />
  );
}

/**
 * One AI-spend segment ("Today" / "Month"): LED dot + count-pop total, a
 * transient "▲ $x.xx" delta chip, a hover popover of the last 10 transactions,
 * and click-through to the AI Billing page pre-filtered to this range.
 *
 * Deliberately built from the SAME Led + count-pop pieces the liveVisitors
 * segment uses — the delta chip is the only new visual, and it borrows the
 * existing .sale-flash-exit fade rather than introducing another animation.
 */
function AiCostSegment({
  label,
  range,
  cents,
  aiCost,
  onNavigate,
}: {
  label: string;
  range: "today" | "month";
  cents: number;
  aiCost: AiCostSegments;
  onNavigate: (path: string) => void;
}) {
  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onMouseEnter={aiCost.loadRecent}
          onFocus={aiCost.loadRecent}
          onClick={() => onNavigate(`/system/ai-billing?range=${range}`)}
          title={`Platform-wide AI spend — ${label.toLowerCase()}. Click for the full ledger.`}
          className="flex items-center gap-1.5 px-2 h-full shrink-0 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Led
            tone={aiCost.deltaVisible ? "live" : "idle"}
            glowKey={aiCost.deltaVisible ? aiCost.deltaCents : undefined}
          />
          <span className="uppercase tracking-wider text-[10px]">{label}</span>
          <span key={cents} className="count-pop tabular-nums">
            {formatCents(cents)}
          </span>
          {aiCost.deltaVisible && (
            <span
              className={`tabular-nums text-live ${aiCost.deltaExiting ? "sale-flash-exit" : "count-pop"}`}
            >
              ▲ {formatCents(aiCost.deltaCents)}
            </span>
          )}
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-80 p-0 font-mono text-[11px]">
        <div className="px-3 py-2 border-b border-border">
          <p className="font-semibold text-foreground">Last 10 AI transactions</p>
          <p className="text-[10px] text-muted-foreground">Platform-wide, newest first</p>
        </div>
        {aiCost.recentLoading && aiCost.recent.length === 0 ? (
          <p className="px-3 py-3 text-muted-foreground">Loading…</p>
        ) : aiCost.recent.length === 0 ? (
          <p className="px-3 py-3 text-muted-foreground">No AI usage recorded yet.</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto divide-y divide-border/60">
            {aiCost.recent.map((t, i) => (
              <li key={t.eventId ?? i} className="px-3 py-1.5 flex items-start gap-2">
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {formatTransactionTime(t.occurredAt)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-foreground">{describeTransaction(t)}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {t.mspName ?? "Platform"}
                    {t.customerName ? ` › ${t.customerName}` : ""}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-foreground">
                  {formatCents(t.costCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

export default function StatusBar({
  workspaceLabel,
  sectionLabel,
  liveVisitors,
  campaignBadges,
  unreadEmailCount,
  unreadNotifCount,
  onBellClick,
  soundMuted,
  onToggleMute,
  consoleOpen,
  onToggleConsole,
  aiCost,
  rightExtra,
}: StatusBarProps) {
  const versionInfo = useVersionInfo();
  const [, navigate] = useLocation();
  return (
    <footer className="h-6 shrink-0 flex items-center bg-card border-t border-border px-2 gap-0 font-mono text-[11px] text-muted-foreground select-none overflow-x-auto whitespace-nowrap">
      {/* Location segment */}
      <div className="flex items-center gap-1.5 px-2 h-full shrink-0">
        <span className="text-primary font-medium">{workspaceLabel ?? "Admin"}</span>
        {sectionLabel && (
          <>
            <span className="text-muted-foreground/50">›</span>
            <span className="text-foreground/80">{sectionLabel}</span>
          </>
        )}
      </div>

      <span className="w-px h-3.5 bg-border shrink-0" />

      {/* Live visitors — Telemetry Cyan is reserved for exactly this */}
      {liveVisitors !== null && (
        <>
          <div
            className="flex items-center gap-1.5 px-2 h-full shrink-0"
            title="Live visitors on the public site"
          >
            <Led
              tone={liveVisitors > 0 ? "live" : "idle"}
              pulse={liveVisitors > 0}
              glowKey={liveVisitors > 0 ? liveVisitors : undefined}
            />
            <span key={liveVisitors} className={`count-pop tabular-nums ${liveVisitors > 0 ? "text-live" : ""}`}>
              {liveVisitors}
            </span>
            <span className="uppercase tracking-wider text-[10px]">live</span>
          </div>
          <span className="w-px h-3.5 bg-border shrink-0" />
        </>
      )}

      {/* Campaign badges */}
      {campaignBadges.map(c => (
        <div
          key={c.id}
          className="flex items-center gap-1.5 px-2 h-full shrink-0 cursor-default"
          title={`Landing page: /landing-pages/${c.slug}`}
        >
          <Led tone="warning" pulse />
          <span className="text-warning">{c.name}</span>
          {c.liveCount > 0 && (
            <span key={c.liveCount} className="count-pop tabular-nums text-warning">
              {c.liveCount}
            </span>
          )}
        </div>
      ))}
      {campaignBadges.length > 0 && <span className="w-px h-3.5 bg-border shrink-0" />}

      {/* AI spend — seeded from /admin/ai-billing/summary, moved by ai-cost SSE
          frames. A null total means the seed fetch never landed, so the segment
          is hidden rather than showing a $0.00 that isn't known to be true. */}
      {aiCost != null && aiCost.todayCents != null && (
        <>
          <AiCostSegment
            label="Today"
            range="today"
            cents={aiCost.todayCents}
            aiCost={aiCost}
            onNavigate={navigate}
          />
          <span className="w-px h-3.5 bg-border shrink-0" />
        </>
      )}
      {aiCost != null && aiCost.monthCents != null && (
        <>
          <AiCostSegment
            label="Month"
            range="month"
            cents={aiCost.monthCents}
            aiCost={aiCost}
            onNavigate={navigate}
          />
          <span className="w-px h-3.5 bg-border shrink-0" />
        </>
      )}

      <div className="flex-1 min-w-4" />

      {/* Unread email (System inbox) */}
      {unreadEmailCount > 0 && (
        <Link
          href="/system/inbox"
          className="flex items-center gap-1.5 px-2 h-full shrink-0 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          title={`${unreadEmailCount} unread email${unreadEmailCount === 1 ? "" : "s"}`}
        >
          <Mail className="w-3 h-3" />
          <span className="tabular-nums text-warning">{unreadEmailCount > 99 ? "99+" : unreadEmailCount}</span>
        </Link>
      )}

      {/* Purchase sound mute toggle */}
      <button
        onClick={onToggleMute}
        title={soundMuted ? "Unmute purchase alerts" : "Mute purchase alerts"}
        className="flex items-center px-2 h-full shrink-0 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {soundMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
      </button>

      {/* Notification bell */}
      <button
        onClick={onBellClick}
        title="Notifications"
        className="relative flex items-center px-2 h-full shrink-0 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <Bell className="w-3.5 h-3.5" />
        {unreadNotifCount > 0 && (
          <span className="absolute top-0 right-0.5 min-w-[14px] h-3.5 bg-destructive text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
            {unreadNotifCount > 99 ? "99+" : unreadNotifCount}
          </span>
        )}
      </button>

      {rightExtra}

      {/* Build version pill — internal/admin surface, deliberately noticeable */}
      <span
        title={`commit ${versionInfo.hash}${
          formatRunningSince(versionInfo.startedAt) ? ` — ${formatRunningSince(versionInfo.startedAt)}` : ""
        }`}
        className="flex items-center px-2 h-full shrink-0 text-[10px] font-bold uppercase tracking-wider text-primary-foreground"
      >
        <span className="bg-primary rounded-full px-2 py-0.5">v{versionInfo.display}</span>
      </span>

      {/* Console toggle */}
      <button
        onClick={onToggleConsole}
        title={consoleOpen ? "Hide console (Ctrl+`)" : "Show console (Ctrl+`)"}
        className={`flex items-center gap-1 px-2 h-full shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
          consoleOpen ? "text-primary" : "hover:text-foreground"
        }`}
      >
        <SquareTerminal className="w-3.5 h-3.5" />
        <span className="uppercase tracking-wider text-[10px]">Console</span>
      </button>
    </footer>
  );
}
