/**
 * DevSeedPanel
 *
 * A dev-only panel that injects synthetic M365 tenant script run results
 * into the database for testing dashboards, score rings, and trend charts.
 *
 * Only rendered when import.meta.env.DEV is true — compiled away in production.
 */

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface ClientOption {
  id: number;
  name: string | null;
  email: string;
  company: string | null;
}

interface SeedResult {
  runResultId: number;
  type: string;
  label: string;
  clientId: number | null;
  customerName: string | null;
  scriptName: string;
  findings: string[];
  scoreImpact: Record<string, number>;
}

const SEED_TYPES = [
  { type: "good",    label: "Good Tenant",    color: "text-green-400",  border: "border-green-500/30 hover:border-green-500/60 hover:bg-green-500/8",  dot: "bg-green-400" },
  { type: "warning", label: "Warning Tenant", color: "text-amber-400",  border: "border-amber-500/30 hover:border-amber-500/60 hover:bg-amber-500/8",  dot: "bg-amber-400" },
  { type: "bad",     label: "Bad Tenant",     color: "text-red-400",    border: "border-red-500/30 hover:border-red-500/60 hover:bg-red-500/8",         dot: "bg-red-400"   },
  { type: "random",  label: "AI Random",      color: "text-purple-400", border: "border-purple-500/30 hover:border-purple-500/60 hover:bg-purple-500/8", dot: "bg-purple-400" },
] as const;

interface Props {
  onSeeded?: () => void;
}

export default function DevSeedPanel({ onSeeded }: Props) {
  if (!import.meta.env.DEV) return null;

  const { fetchWithAuth } = useAuth();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [seeding, setSeeding] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SeedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/clients/enriched");
        if (res.ok) {
          const data = await res.json() as Array<{ id: number; name?: string; email?: string; company?: string }>;
          setClients(data.map(c => ({ id: c.id, name: c.name ?? null, email: c.email ?? "", company: c.company ?? null })));
        }
      } catch {
        // non-fatal — client list just won't populate
      } finally {
        setLoadingClients(false);
      }
    })();
  }, [fetchWithAuth]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filteredClients = clients.filter(c => {
    const q = searchTerm.toLowerCase();
    return (
      (c.name ?? "").toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.company ?? "").toLowerCase().includes(q)
    );
  });

  const selectedClient = clients.find(c => c.id === selectedClientId) ?? null;

  const handleSeed = async (type: string) => {
    setSeeding(type);
    setError(null);
    setLastResult(null);
    try {
      const res = await fetchWithAuth("/api/admin/dev/seed-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, clientId: selectedClientId ?? undefined }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = await res.json() as SeedResult;
      setLastResult(data);
      onSeeded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Seed failed");
    } finally {
      setSeeding(null);
    }
  };

  return (
    <div className="border border-dashed border-purple-500/40 rounded-xl bg-purple-500/4 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse flex-shrink-0" />
        <p className="text-xs font-bold uppercase tracking-wider text-purple-400">Dev Tools · Seed Script Results</p>
        <span className="ml-auto text-[10px] text-muted-foreground/60 bg-card border border-accent px-2 py-0.5 rounded font-mono">DEV ONLY</span>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Inject a synthetic M365 tenant result without connecting to Azure. The result runs through the real AI analyzer and updates the selected client's health dashboard immediately.
      </p>

      {/* Client picker */}
      <div ref={dropdownRef} className="relative">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Assign to client</p>
        <button
          type="button"
          onClick={() => setShowDropdown(v => !v)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-card border border-border rounded-lg text-xs text-left hover:border-purple-500/40 transition-colors"
        >
          <span className={selectedClient ? "text-foreground" : "text-muted-foreground/60"}>
            {selectedClient
              ? `${selectedClient.name ?? selectedClient.email}${selectedClient.company ? ` · ${selectedClient.company}` : ""}`
              : "No client / standalone"
            }
          </span>
          <svg className={`w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0 transition-transform ${showDropdown ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showDropdown && (
          <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-lg shadow-xl overflow-hidden">
            <div className="p-2 border-b border-accent">
              <input
                autoFocus
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search clients…"
                className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground placeholder-muted-foreground/60 focus:outline-none focus:border-purple-500/50"
              />
            </div>
            <div className="max-h-48 overflow-y-auto">
              <button
                type="button"
                onClick={() => { setSelectedClientId(null); setSearchTerm(""); setShowDropdown(false); }}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors ${!selectedClientId ? "text-purple-400 font-semibold" : "text-muted-foreground"}`}
              >
                No client / standalone
              </button>
              {loadingClients && (
                <p className="px-3 py-2 text-xs text-muted-foreground/60">Loading…</p>
              )}
              {!loadingClients && filteredClients.length === 0 && searchTerm && (
                <p className="px-3 py-2 text-xs text-muted-foreground/60">No clients match "{searchTerm}"</p>
              )}
              {filteredClients.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setSelectedClientId(c.id); setSearchTerm(""); setShowDropdown(false); }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors ${selectedClientId === c.id ? "text-purple-400 font-semibold" : "text-foreground"}`}
                >
                  <span className="block truncate">{c.name ?? c.email}</span>
                  {c.company && <span className="block text-[10px] text-muted-foreground truncate">{c.company}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Seed buttons */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Inject result</p>
        <div className="grid grid-cols-2 gap-2">
          {SEED_TYPES.map(({ type, label, color, border, dot }) => {
            const isLoading = seeding === type;
            const isDisabled = seeding !== null;
            return (
              <button
                key={type}
                type="button"
                disabled={isDisabled}
                onClick={() => void handleSeed(type)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${color} ${border}`}
              >
                {isLoading ? (
                  <svg className="w-3.5 h-3.5 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                ) : (
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                )}
                {isLoading ? "Seeding…" : label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 bg-red-500/8 border border-red-500/25 rounded-lg">
          <svg className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[11px] text-red-400 leading-relaxed">{error}</p>
        </div>
      )}

      {/* Success log */}
      {lastResult && (
        <div className="space-y-2 px-3 py-3 bg-card border border-border rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-xs font-semibold text-green-400">Seeded — Run #{lastResult.runResultId}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">{lastResult.scriptName}</p>
          {lastResult.customerName && (
            <p className="text-[11px] text-muted-foreground">Client: <span className="text-foreground">{lastResult.customerName}</span></p>
          )}
          {Object.keys(lastResult.scoreImpact).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {Object.entries(lastResult.scoreImpact).map(([k, v]) => (
                <span
                  key={k}
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${v > 0 ? "text-green-400 border-green-500/30 bg-green-500/8" : v < 0 ? "text-red-400 border-red-500/30 bg-red-500/8" : "text-muted-foreground/60 border-border"}`}
                >
                  {k.replace(/([A-Z])/g, " $1").trim()} {v > 0 ? "+" : ""}{v}
                </span>
              ))}
            </div>
          )}
          {lastResult.findings.length > 0 && (
            <p className="text-[10px] text-muted-foreground/60 italic">{lastResult.findings.length} AI finding{lastResult.findings.length !== 1 ? "s" : ""} generated</p>
          )}
        </div>
      )}
    </div>
  );
}
