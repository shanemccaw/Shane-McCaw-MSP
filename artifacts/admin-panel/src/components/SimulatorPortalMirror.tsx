import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, ExternalLink, Loader2, MonitorSmartphone } from "lucide-react";

interface Testbed {
  id: number;
  name: string;
  domain?: string;
}

const PORTAL_URL_STORAGE_KEY = "simulator-portal-mirror-base-url";

export function SimulatorPortalMirror(props?: {
  customerId?: string;
  simDate?: string;
}) {
  const { fetchWithAuth } = useAuth();
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [selectedTestbedId, setSelectedTestbedId] = useState<number | "">("");
  const [portalBaseUrl, setPortalBaseUrl] = useState(
    () => localStorage.getItem(PORTAL_URL_STORAGE_KEY) ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);

  useEffect(() => {
    fetchWithAuth("/api/admin/testbeds")
      .then(r => r.json())
      .then(d => setTestbeds(d.testbeds ?? []))
      .catch(() => toast.error("Failed to load testbeds"));
  }, [fetchWithAuth]);

  useEffect(() => {
    localStorage.setItem(PORTAL_URL_STORAGE_KEY, portalBaseUrl);
  }, [portalBaseUrl]);

  const loadMirror = async () => {
    if (selectedTestbedId === "") {
      toast.error("Select a testbed customer first");
      return;
    }
    if (!portalBaseUrl.trim()) {
      toast.error("Enter the msp-portal base URL first — admin-panel and msp-portal are separate deployments and this isn't auto-detectable.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/simulator/testbeds/${selectedTestbedId}/portal-mirror-token`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to issue portal mirror token");
      const base = portalBaseUrl.replace(/\/$/, "");
      setIframeSrc(`${base}/?impersonation_token=${encodeURIComponent(data.token)}`);
      setIframeKey(k => k + 1);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to load portal mirror");
      setIframeSrc(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-hidden">
      <div className="shrink-0 border-b border-slate-900 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
          <MonitorSmartphone className="w-3.5 h-3.5 text-indigo-400" />
          Customer Portal Mirror
        </div>
        <select
          value={selectedTestbedId}
          onChange={e => setSelectedTestbedId(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-full bg-slate-900 border border-slate-800 rounded-md px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
        >
          <option value="">-- Testbed Customer --</option>
          {testbeds.map(tb => (
            <option key={tb.id} value={tb.id}>{tb.name}</option>
          ))}
        </select>
        <Input
          value={portalBaseUrl}
          onChange={e => setPortalBaseUrl(e.target.value)}
          placeholder="https://your-msp-portal-deployment.example"
          className="h-7 bg-slate-900 border-slate-800 text-slate-200 text-[10px] font-mono"
        />
        <div className="flex gap-1.5">
          <Button size="sm" onClick={loadMirror} disabled={loading} className="h-7 flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px]">
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : null}
            Load Mirror
          </Button>
          {iframeSrc && (
            <Button size="sm" variant="outline" onClick={() => setIframeKey(k => k + 1)} className="h-7 px-2 border-slate-700 bg-slate-800 hover:bg-slate-700" title="Refresh (re-render current token — for a live re-read, click Load Mirror again to issue a fresh token)">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          )}
          {iframeSrc && (
            <Button size="sm" variant="outline" onClick={() => window.open(iframeSrc, "_blank")} className="h-7 px-2 border-slate-700 bg-slate-800 hover:bg-slate-700" title="Open in new tab">
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        <p className="text-[9px] text-slate-600 leading-tight">
          Uses the same single-use impersonation token flow as the existing "view as customer" feature.
          The token expires after 30 minutes or first navigation — click Load Mirror again for a fresh session.
        </p>
      </div>

      <div className="flex-1 min-h-0 bg-slate-900">
        {iframeSrc ? (
          <iframe
            key={iframeKey}
            src={iframeSrc}
            title="Customer Portal Mirror"
            className="w-full h-full border-0"
          />
        ) : (
          <div className="h-full flex items-center justify-center p-6 text-center text-xs text-slate-600">
            Select a testbed customer, confirm the portal base URL, and click Load Mirror to embed
            the real customer-facing portal here.
          </div>
        )}
      </div>
    </div>
  );
}
