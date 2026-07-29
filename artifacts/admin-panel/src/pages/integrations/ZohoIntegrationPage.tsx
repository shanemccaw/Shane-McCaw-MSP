// Admin Panel Zoho Connection UI (#134). Routed at /system/integrations-zoho
// via SystemWorkspace's case-dispatch, registered under workspaceNav's new
// "Integrations" section — the pattern any future integration's own settings
// page (e.g. QuickBooks, HubSpot) should follow.
//
// Reads GET /api/zoho/auth/status (Foundation, #82) and never renders token
// values — the route already excludes them. Connect/Reconnect both go through
// GET /api/zoho/auth/start, asking for JSON so the button can navigate the
// browser itself (the route redirects a plain browser GET too, but that path
// can't carry the Bearer token requireAdmin needs).

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Plug, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

interface ZohoConnection {
  status: string;
  zohoOrgId: string | null;
  connectedAt: string | null;
  lastRefreshedAt: string | null;
  lastErrorMessage: string | null;
  accessTokenExpiresAt: string | null;
}

interface ZohoStatusResponse {
  credentialsConfigured: boolean;
  connection: ZohoConnection | { status: "disconnected" };
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function ZohoIntegrationPage() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<ZohoStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/zoho/auth/status");
      if (!res.ok) throw new Error(`Failed to load Zoho connection status (${res.status})`);
      const body = (await res.json()) as ZohoStatusResponse;
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Zoho connection status");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/zoho/auth/start", { headers: { Accept: "application/json" } });
      const body = (await res.json().catch(() => ({}))) as { authUrl?: string; error?: string };
      if (!res.ok || !body.authUrl) throw new Error(body.error ?? "Failed to start Zoho OAuth flow");
      window.location.href = body.authUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Zoho OAuth flow");
      setConnecting(false);
    }
  }, [fetchWithAuth]);

  const connection = data?.connection;
  const isConnected = !!connection && connection.status === "connected";
  const hasError = !!connection && connection.status === "error";
  const identifiers = isConnected && "zohoOrgId" in connection
    ? [{ label: "Zoho Org ID", value: connection.zohoOrgId }].filter(i => i.value)
    : [];

  return (
    <div className="p-4 sm:p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Zoho</h1>
        <p className="text-sm text-muted-foreground mt-1">Connection to the Zoho Suite (CRM, Projects, Books).</p>
      </div>

      {error && (
        <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <Plug className="w-4.5 h-4.5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Zoho Connection</h3>
                <p className="text-xs text-muted-foreground">OAuth connection used by CRM, Projects, and Books sync</p>
              </div>
            </div>
            {isConnected ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
                <CheckCircle2 className="w-3 h-3" />
                Connected
              </span>
            ) : hasError ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                <AlertTriangle className="w-3 h-3" />
                Error
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-muted/30 text-muted-foreground border border-border">
                <XCircle className="w-3 h-3" />
                Disconnected
              </span>
            )}
          </div>

          <div className="px-5 py-4 space-y-4">
            {!data?.credentialsConfigured && (
              <p className="text-sm text-amber-400">
                Zoho OAuth credentials are not configured for this environment (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REDIRECT_URI in Replit Secrets).
              </p>
            )}

            {hasError && "lastErrorMessage" in (connection ?? {}) && (connection as ZohoConnection).lastErrorMessage && (
              <p className="text-sm text-red-400">{(connection as ZohoConnection).lastErrorMessage}</p>
            )}

            {isConnected && "connectedAt" in connection && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Connected</p>
                  <p className="text-foreground">{formatTimestamp(connection.connectedAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last Refreshed</p>
                  <p className="text-foreground">{formatTimestamp(connection.lastRefreshedAt)}</p>
                </div>
                {identifiers.map(id => (
                  <div key={id.label}>
                    <p className="text-xs text-muted-foreground">{id.label}</p>
                    <p className="text-foreground font-mono text-xs">{id.value}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={() => void handleConnect()}
                disabled={connecting || !data?.credentialsConfigured}
                className="bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {connecting ? "Redirecting…" : isConnected || hasError ? "Reconnect" : "Connect to Zoho"}
              </button>
              <button
                onClick={() => void loadStatus()}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
