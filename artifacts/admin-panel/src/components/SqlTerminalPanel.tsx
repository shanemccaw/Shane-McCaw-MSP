import React, { useState, useEffect, useRef } from "react";
import { Terminal, Trash2, ShieldAlert, CheckCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LogEntry {
  id: string;
  type: "info" | "success" | "error";
  message: string;
  timestamp: string;
}

export function SqlTerminalPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: "init",
      type: "info",
      message: "Simulator Studio log terminal initialized. Ready for database & telemetry triggers.",
      timestamp: new Date().toLocaleTimeString(),
    }
  ]);
  const [filter, setFilter] = useState<"all" | "error" | "success">("all");
  
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleLogEvent = (e: CustomEvent) => {
      const { type, message } = e.detail;
      const newEntry: LogEntry = {
        id: Math.random().toString(36).substring(7),
        type: type || "info",
        message,
        timestamp: new Date().toLocaleTimeString(),
      };
      setLogs(prev => [...prev, newEntry]);
    };

    window.addEventListener("simulator-log", handleLogEvent as EventListener);
    
    // Also listen for event fired in ModalContext
    const handleEventFired = (e: CustomEvent) => {
      const { eventId } = e.detail;
      const newEntry: LogEntry = {
        id: Math.random().toString(36).substring(7),
        type: "success",
        message: `Fired simulation scenario: ${eventId}`,
        timestamp: new Date().toLocaleTimeString(),
      };
      setLogs(prev => [...prev, newEntry]);
    };
    window.addEventListener("simulator-event-fired", handleEventFired as EventListener);

    return () => {
      window.removeEventListener("simulator-log", handleLogEvent as EventListener);
      window.removeEventListener("simulator-event-fired", handleEventFired as EventListener);
    };
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const filteredLogs = logs.filter(log => {
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
          onClick={() => setLogs([])}
          className="text-slate-500 hover:text-slate-300 transition-colors p-1 hover:bg-slate-900 rounded"
          title="Clear Console Logs"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Terminal Output */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 select-text min-h-0">
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
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
