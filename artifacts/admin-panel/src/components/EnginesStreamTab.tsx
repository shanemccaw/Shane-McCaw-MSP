import React, { useEffect, useState } from "react";
import { Radio, Cpu } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLiveStream } from "@/hooks/useLiveStream";

export function EnginesStreamTab() {
  const { fetchWithAuth } = useAuth();
  const [channels, setChannels] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const { frames, connected } = useLiveStream(selected || null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/live-stream/channels");
        const data = await res.json();
        if (!cancelled && Array.isArray(data.channels)) setChannels(data.channels);
      } catch {
        // channel picker just stays empty; the tab remains usable once retried
      }
    })();
    return () => { cancelled = true; };
    // fetchWithAuth is stable (memoized in AuthContext) — run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-full flex flex-col font-mono text-[11px] text-teal-400">
      <div className="flex-shrink-0 flex items-center gap-3 px-2.5 py-1.5 border-b border-slate-900/80">
        <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Engine Channel:</span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="bg-slate-900 border border-slate-800 text-teal-300 text-[10px] rounded px-1.5 py-0.5 outline-none focus:border-teal-500 font-bold"
        >
          <option value="">— select an engine —</option>
          {channels.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {selected && (
          <span
            className={`flex items-center gap-1 text-[9px] font-bold uppercase tracking-tight px-1.5 py-0.5 rounded border ml-auto ${
              connected
                ? "text-emerald-400 bg-emerald-950/40 border-emerald-800"
                : "text-slate-500 bg-slate-900 border-slate-800"
            }`}
          >
            <Radio className={`w-2.5 h-2.5 ${connected ? "animate-pulse" : ""}`} />
            {connected ? "LIVE" : "OFFLINE"}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 scrollbar-thin scrollbar-thumb-slate-900">
        {!selected ? (
          <div className="text-slate-600 italic flex items-center gap-2 py-4">
            <Cpu className="w-3.5 h-3.5" /> select an engine to view its output
          </div>
        ) : frames.length === 0 ? (
          <div>{`[${selected}] Awaiting activity...`}</div>
        ) : (
          frames.map((f) => {
            const { type, channel: _c, scope, ...rest } = f.data;
            return (
              <div key={f.id} className="mb-1.5 pb-1.5 border-b border-slate-900/60 last:border-0">
                <span className="text-slate-500">{new Date(f.receivedAt).toLocaleTimeString()}</span>{" "}
                <span className="text-teal-300 font-bold">{String(type ?? "event")}</span>{" "}
                {scope != null && <span className="text-slate-600">scope={String(scope)}</span>}
                <div className="text-slate-400 break-all">{JSON.stringify(rest)}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
