import React, { useState, useEffect, useRef, useMemo } from "react";
import { Terminal, Trash2, ShieldAlert, CheckCircle, Info, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSimulatorActivity } from "@/contexts/SimulatorActivityContext";
import { useLiveStream } from "@/hooks/useLiveStream";

interface LogEntry {
  id: string;
  type: "info" | "success" | "error";
  message: string;
  timestamp: string;
  at: number;
}

/** level from a bridged log-stream frame -> the terminal's 3-state display type. */
function levelToType(level: unknown): LogEntry["type"] {
  return level === "error" || level === "warn" ? "error" : "info";
}

/** Render any live-stream frame (log-bridge, event-bridge, or a raw sse-channels
 *  broadcast) as one terminal line. The firehose taps ALL hub traffic, not just
 *  logger calls, so this has to degrade gracefully for shapes it doesn't know. */
function frameToLogEntry(id: string, receivedAt: number, data: Record<string, unknown>): LogEntry {
  const channel = typeof data.channel === "string" ? `[${data.channel}] ` : "";
  const timestamp = new Date(receivedAt).toLocaleTimeString();

  if (data.type === "log") {
    return {
      id, at: receivedAt, timestamp,
      type: levelToType(data.level),
      message: `${channel}${String(data.message ?? "")}`,
    };
  }
  if (data.type === "event") {
    return {
      id, at: receivedAt, timestamp, type: "info",
      message: `${channel}event: ${String(data.eventType ?? "unknown")}`,
    };
  }
  const { type, channel: _c, scope: _s, ...rest } = data;
  return {
    id, at: receivedAt, timestamp, type: "info",
    message: `${channel}${String(type ?? "event")} ${JSON.stringify(rest)}`,
  };
}

export function SqlTerminalPanel() {
  const { logs, clearLogs } = useSimulatorActivity();
  const { frames, connected } = useLiveStream("*");
  const [filter, setFilter] = useState<"all" | "error" | "success">("all");

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Merge the local (immediate UI-action) log stream with the live firehose,
  // newest first, using each entry's real epoch — not insertion order — so the
  // two independently-arriving sources interleave correctly.
  const mergedLogs = useMemo(() => {
    const liveEntries = frames.map((f) => frameToLogEntry(f.id, f.receivedAt, f.data));
    return [...logs, ...liveEntries].sort((a, b) => b.at - a.at);
  }, [logs, frames]);

  // Newest-first list: the freshest entry renders at the top, so reveal it by
  // scrolling to the top (the old bottom-anchor made sense for oldest-first).
  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [mergedLogs]);

  const filteredLogs = mergedLogs.filter(log => {
    if (filter === "all") return true;
    return log.type === filter;
  });

  const getLogStyle = (type: string) => {
    switch (type) {
      case "success": return "text-emerald-400";
      case "error": return "text-rose-400 font-bold";
      default: return "text-cyan-400";
    }
  };

  const getLogIcon = (type: string) => {
    switch (type) {
      case "success": return <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
      case "error": return <ShieldAlert className="w-3.5 h-3.5 text-rose-500 shrink-0" />;
      default: return <Info className="w-3.5 h-3.5 text-cyan-500 shrink-0" />;
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 font-mono text-[11px] min-h-0 select-text">
      {/* Header Tabs */}
      <div className="flex-shrink-0 flex items-center justify-between border-b border-slate-900 bg-slate-950/80 px-4 h-9 select-none">
        <div className="flex items-center gap-4">
          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-slate-400" /> Log Console
          </span>
          <span
            className={`flex items-center gap-1 text-[9px] font-bold uppercase tracking-tight px-1.5 py-0.5 rounded border ${
              connected
                ? "text-emerald-400 bg-emerald-950/40 border-emerald-800"
                : "text-slate-500 bg-slate-900 border-slate-800"
            }`}
            title={connected ? "Live firehose connected (?channel=*)" : "Live firehose disconnected — reconnecting"}
          >
            <Radio className={`w-2.5 h-2.5 ${connected ? "animate-pulse" : ""}`} />
            {connected ? "LIVE" : "OFFLINE"}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilter("all")}
              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                filter === "all" ? "bg-slate-900 text-slate-200 border border-slate-800" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter("success")}
              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                filter === "success" ? "bg-slate-900 text-emerald-400 border border-slate-800" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Success
            </button>
            <button
              onClick={() => setFilter("error")}
              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                filter === "error" ? "bg-slate-900 text-rose-400 border border-slate-800" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Errors
            </button>
          </div>
        </div>

        <button
          onClick={clearLogs}
          className="text-slate-500 hover:text-slate-300 transition-colors p-1 hover:bg-slate-900 rounded"
          title="Clear Console Logs"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Terminal Output */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-2 select-text min-h-0">
        {filteredLogs.length === 0 ? (
          <div className="text-slate-700 italic text-center py-6 select-none">
            No entries found matching filters.
          </div>
        ) : (
          filteredLogs.map(log => (
            <div key={log.id} className="flex items-start gap-2.5 leading-relaxed hover:bg-slate-900/20 py-0.5 px-1 rounded transition-colors">
              <span className="text-slate-600 select-none shrink-0 font-semibold text-[10px]">{log.timestamp}</span>
              {getLogIcon(log.type)}
              <span className={`flex-1 break-all ${getLogStyle(log.type)}`}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
