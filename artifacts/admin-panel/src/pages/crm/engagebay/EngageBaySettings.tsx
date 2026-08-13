// EngageBay Settings page (#109).
//
// Wraps the already-built POST /engagebay/connect + GET /engagebay/status
// (#104): API key paste field, connection status badge, connectedAt /
// lastErrorMessage display. No sync toggles — per the #109 audit, "auto-fire
// on Zoho lead created" style automation belongs in a real Workflow Engine
// definition, not a hidden checkbox here.

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface ConnectionStatus {
  status: "connected" | "disconnected" | "error";
  connectedAt?: string | null;
  lastErrorMessage?: string | null;
}

const STATUS_STYLES: Record<ConnectionStatus["status"], string> = {
  connected: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  disconnected: "bg-muted text-muted-foreground border-border",
  error: "bg-red-500/10 text-red-400 border-red-500/30",
};

export default function EngageBaySettingsPage() {
  const { fetchWithAuth } = useAuth();
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadStatus() {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/engagebay/status");
      if (res.ok) {
        const data = await res.json() as { connection: ConnectionStatus };
        setConnection(data.connection);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect() {
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    setConnecting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetchWithAuth("/api/engagebay/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((body as { error?: string }).error ?? "Failed to connect to EngageBay");
        return;
      }
      setApiKey("");
      setSuccess("Connected to EngageBay.");
      await loadStatus();
    } catch {
      setError("Failed to connect to EngageBay");
    } finally {
      setConnecting(false);
    }
  }

  const status = connection?.status ?? "disconnected";

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground">EngageBay Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Single-tenant EngageBay connection. Pasting a new key validates it live and replaces the stored one.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">Connection status</span>
          {loading ? (
            <span className="text-xs text-muted-foreground">Loading…</span>
          ) : (
            <span className={`inline-block px-2.5 py-1 rounded-full text-xs border ${STATUS_STYLES[status]}`}>
              {status}
            </span>
          )}
        </div>

        {!loading && connection?.connectedAt && (
          <div className="text-xs text-muted-foreground">
            Connected at: {new Date(connection.connectedAt).toLocaleString()}
          </div>
        )}
        {!loading && connection?.lastErrorMessage && (
          <div className="text-xs text-red-400">
            Last error: {connection.lastErrorMessage}
          </div>
        )}

        <div className="pt-2 border-t border-border space-y-2">
          <label className="text-xs font-semibold text-muted-foreground">EngageBay API key</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste API key"
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground"
            />
            <button
              onClick={handleConnect}
              disabled={connecting || !apiKey.trim()}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40"
            >
              {connecting ? "Connecting…" : "Connect"}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">{error}</div>
        )}
        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg px-4 py-3 text-sm">{success}</div>
        )}
      </div>
    </div>
  );
}
