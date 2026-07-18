import { Bell, Volume2, VolumeX, SquareTerminal, Mail } from "lucide-react";
import { Link } from "wouter";

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
}: StatusBarProps) {
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
