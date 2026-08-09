/**
 * Live Scan body — the Run tab's screen.
 *
 * Two real feeds, not one invented dashboard:
 *
 * 1. A live tail of the `engine.monitor` channel (every `monitor-executor.ts`
 *    log line, across every tenant, the instant it is logged — see
 *    `log-stream-writer.ts`'s "Phase 3a real-time tap"). `useLiveStream`
 *    already exists for this (the old admin panel's Log Stream tab uses it)
 *    and handles reconnect/backoff itself.
 * 2. A snapshot of the most recent `tenant_monitor_profiles` rows across every
 *    tenant (`GET /api/admin/monitor-checks/profiles`), which is what answers
 *    "what did the last scan actually find" once the live tail has scrolled
 *    past it.
 *
 * No new backend was written for this screen — both endpoints already existed
 * and neither had an adminv2 consumer yet.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { useLiveStream, type LiveStreamFrame } from "@/hooks/useLiveStream";
import { ACCENT, FONT, LINE, SURFACE, TEXT } from "../../theme";
import { useShell } from "../../shell/ShellContext";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import {
  extractHighlightFields,
  markForRow,
  relativeTime,
  setLastProfiles,
  toneForRow,
  type ScanProfileRow,
} from "./liveScanData";

const MONITOR_CHANNEL = "engine.monitor";

type LevelTone = { tag: string; color: string };

const LEVEL_TONE: Record<string, LevelTone> = {
  trace: { tag: "TRC", color: TEXT.faint },
  debug: { tag: "DBG", color: TEXT.dim },
  info: { tag: "INF", color: ACCENT.info },
  warn: { tag: "WRN", color: ACCENT.amber },
  error: { tag: "ERR", color: ACCENT.danger },
  fatal: { tag: "FTL", color: ACCENT.danger },
};

interface FeedLine {
  id: string;
  at: number;
  time: string;
  level: string;
  text: string;
}

function fmtTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour12: false });
}

function frameToLine(frame: LiveStreamFrame): FeedLine | null {
  const data = frame.data;
  if (data.type !== "log") return null;
  const meta = data.meta && typeof data.meta === "object" ? (data.meta as Record<string, unknown>) : null;
  return {
    id: frame.id,
    at: frame.receivedAt,
    time: fmtTime(frame.receivedAt),
    level: String(data.level ?? "info"),
    text: `${String(data.message ?? "")}${extractHighlightFields(meta)}`,
  };
}

export function LiveScanBody() {
  const { adminFetch } = useAdminFetch();
  const { openPeek } = useShell();
  const { frames, connected } = useLiveStream(MONITOR_CHANNEL);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  const [profiles, setProfiles] = useState<ScanProfileRow[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState<string | null>(null);

  const [clearedAt, setClearedAt] = useState(0);
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true);
    setProfilesError(null);
    try {
      const res = await adminFetch("/api/admin/monitor-checks/profiles?limit=100");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load recent results");
      const rows: ScanProfileRow[] = Array.isArray(data.profiles) ? data.profiles : [];
      setProfiles(rows);
      setLastProfiles(rows);
    } catch (err) {
      setProfilesError(err instanceof Error ? err.message : String(err));
    } finally {
      setProfilesLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const lines = useMemo(() => {
    return frames
      .map(frameToLine)
      .filter((l): l is FeedLine => l !== null && l.at > clearedAt)
      .reverse();
  }, [frames, clearedAt]);

  const stats = useMemo(() => {
    let warn = 0;
    let error = 0;
    for (const line of lines) {
      if (line.level === "warn") warn++;
      else if (line.level === "error" || line.level === "fatal") error++;
    }
    return { total: lines.length, warn, error };
  }, [lines]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    pinnedRef.current = atBottom;
    setPinned(atBottom);
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <div style={{ flex: "none", padding: "20px 20px 14px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: TEXT.bright }}>Live Scan</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              color: connected ? ACCENT.greenBright : TEXT.meta,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: connected ? ACCENT.greenBright : TEXT.faint,
              }}
            />
            {connected ? "Live" : "Reconnecting…"}
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: TEXT.meta, marginTop: 4, lineHeight: 1.5, maxWidth: 640 }}>
          Every <code style={{ fontFamily: FONT.mono }}>engine.monitor</code> log line, the instant a check
          executes against any tenant — no simulation, this is the real executor. The table below is the
          most recent completed result per check, across every tenant.
        </div>
      </div>

      <div style={{ position: "relative", flex: "1 1 55%", minHeight: 0, display: "flex", flexDirection: "column", borderTop: `1px solid ${LINE.group}` }}>
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 14,
            height: 30,
            padding: "0 20px",
            borderBottom: `1px solid ${LINE.subtle}`,
            background: SURFACE.chrome,
          }}
        >
          <StatChip label="lines" value={stats.total} color={TEXT.quiet} />
          <StatChip label="warnings" value={stats.warn} color={ACCENT.amber} />
          <StatChip label="errors" value={stats.error} color={ACCENT.danger} />
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => setClearedAt(Date.now())} style={toolbarButtonStyle} title="Clear feed">
            <Trash2 size={12} />
            Clear
          </button>
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "6px 20px",
            fontFamily: FONT.mono,
            fontSize: 11,
            lineHeight: 1.7,
          }}
        >
          {lines.length === 0 ? (
            <div style={{ padding: "10px 0", color: TEXT.meta, fontStyle: "italic" }}>
              {connected ? "Waiting for a check to run…" : "Connecting…"}
            </div>
          ) : (
            lines.map((line) => {
              const tone = LEVEL_TONE[line.level] ?? LEVEL_TONE.info!;
              return (
                <div key={line.id} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ flex: "none", color: TEXT.faintest }}>{line.time}</span>
                  <span style={{ flex: "none", width: 24, fontWeight: 700, color: tone.color }}>{tone.tag}</span>
                  <span style={{ minWidth: 0, flex: 1, whiteSpace: "pre-wrap", wordBreak: "break-word", color: TEXT.body }}>
                    {line.text}
                  </span>
                </div>
              );
            })
          )}
        </div>
        {!pinned && lines.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const el = scrollRef.current;
              if (!el) return;
              el.scrollTop = el.scrollHeight;
              pinnedRef.current = true;
              setPinned(true);
            }}
            style={{
              position: "absolute",
              right: 32,
              bottom: 12,
              padding: "5px 12px",
              borderRadius: 999,
              border: `1px solid ${LINE.control}`,
              background: SURFACE.overlay,
              color: TEXT.primary,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            ↓ Jump to latest
          </button>
        )}
      </div>

      <div style={{ flex: "1 1 45%", minHeight: 0, display: "flex", flexDirection: "column", borderTop: `1px solid ${LINE.group}` }}>
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 30,
            padding: "0 20px",
            borderBottom: `1px solid ${LINE.subtle}`,
            background: SURFACE.chrome,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: TEXT.groupLabel }}>
            Recent results
          </span>
          <span style={{ fontSize: 11, color: TEXT.faintest }}>{profiles.length}</span>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => void loadProfiles()} style={toolbarButtonStyle} title="Refresh">
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {profilesError ? (
            <div style={{ padding: 20, fontSize: 12, color: ACCENT.danger }}>{profilesError}</div>
          ) : profilesLoading && profiles.length === 0 ? (
            <div style={{ padding: 20, fontSize: 12, color: TEXT.meta }}>Loading…</div>
          ) : profiles.length === 0 ? (
            <div style={{ padding: 20, fontSize: 12, color: TEXT.meta, fontStyle: "italic" }}>No results yet.</div>
          ) : (
            profiles.map((row) => {
              const tone = toneForRow(row.status, row.severityMatched);
              const rowLabel = row.clientCompany !== "Unknown Company" ? row.clientCompany : row.clientName;
              return (
                <div
                  key={row.id}
                  className="av2-row"
                  onClick={() => openPeek("tenant", row.tenantId)}
                  onContextMenu={(event) =>
                    openMenu(
                      event,
                      [
                        { label: "Open tenant", onSelect: () => openPeek("tenant", row.tenantId) },
                        { label: "Copy tenant ID", onSelect: () => void navigator.clipboard?.writeText(row.tenantId) },
                        { label: "Copy check key", onSelect: () => void navigator.clipboard?.writeText(row.checkKey) },
                        { label: "Copy company", onSelect: () => void navigator.clipboard?.writeText(rowLabel) },
                      ],
                      `Actions for ${rowLabel}`,
                    )
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 20px",
                    borderBottom: `1px solid ${LINE.subtle}`,
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      flex: "none",
                      minWidth: 64,
                      textAlign: "center",
                      padding: "2px 6px",
                      borderRadius: 5,
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: ".05em",
                      background: `${tone}1e`,
                      color: tone,
                    }}
                  >
                    {markForRow(row.status, row.severityMatched)}
                  </span>
                  <div style={{ flex: "0 0 200px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: TEXT.strong }}>
                    {row.clientCompany !== "Unknown Company" ? row.clientCompany : row.clientName}
                  </div>
                  <div style={{ flex: "0 0 200px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontFamily: FONT.mono, color: TEXT.quiet }}>
                    {row.checkKey}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, color: TEXT.meta }}>
                    {row.severityLabel ?? row.errorMessage ?? ""}
                  </div>
                  <div style={{ flex: "none", fontSize: 11, fontFamily: FONT.mono, color: TEXT.faintest }}>
                    {relativeTime(row.collectedAt)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span style={{ display: "flex", alignItems: "baseline", gap: 4, fontSize: 11 }}>
      <span style={{ fontFamily: FONT.mono, fontWeight: 700, color }}>{value}</span>
      <span style={{ color: TEXT.faint }}>{label}</span>
    </span>
  );
}

const toolbarButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  height: 22,
  padding: "0 8px",
  borderRadius: 5,
  border: `1px solid ${LINE.control}`,
  background: "transparent",
  color: TEXT.quiet,
  fontSize: 11,
  cursor: "pointer",
  fontFamily: "inherit",
};
