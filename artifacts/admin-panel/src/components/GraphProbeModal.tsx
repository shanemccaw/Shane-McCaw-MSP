import React, { useState } from "react";
import Editor from "@monaco-editor/react";
import { 
  Globe, Shield, Play, X, Check, Loader2, AlertCircle, 
  Clock, Server, ShieldCheck, Copy, CheckSquare, Square
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminFetch } from "@/lib/useAdminFetch";

interface GraphProbeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ENDPOINT_PRESETS = [
  { url: "/api/admin/observability/service-health", label: "Service Health Metrics" },
  { url: "/api/admin/observability/event-bus", label: "Event Bus Live stats" },
  { url: "/api/admin/observability/alert-events", label: "Alert Configuration & Events" },
  { url: "/api/msp/audit", label: "MSP Audit Log Telemetry" },
];

const SCOPE_OPTIONS = [
  { id: "read:msp", label: "read:msp", desc: "Read MSP profiles, configs and limits" },
  { id: "write:msp", label: "write:msp", desc: "Write/update MSP records" },
  { id: "read:users", label: "read:users", desc: "View administrative user lists" },
  { id: "write:users", label: "write:users", desc: "Create or suspend users" },
  { id: "admin:all", label: "admin:all", desc: "Root access override" }
];

export function GraphProbeModal({ isOpen, onClose }: GraphProbeModalProps) {
  const { adminFetch } = useAdminFetch();
  const [endpointUrl, setEndpointUrl] = useState(ENDPOINT_PRESETS[0].url);
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["read:msp", "read:users"]);
  
  // Loading & Secondary Result Modal State
  const [isTesting, setIsTesting] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [copied, setCopied] = useState(false);
  
  // Result Data
  const [probeResult, setProbeResult] = useState<{
    status: number;
    statusText: string;
    duration: number;
    sizeBytes: number;
    headers: Record<string, string>;
    body: string;
  } | null>(null);

  if (!isOpen) return null;

  const toggleScope = (scopeId: string) => {
    setSelectedScopes(prev => 
      prev.includes(scopeId) ? prev.filter(s => s !== scopeId) : [...prev, scopeId]
    );
  };

  /**
   * Real GET probe against the actual gateway, through the same authenticated
   * `adminFetch` the rest of the admin panel uses (see `useAdminFetch`). No
   * fabricated status/headers/latency — every field below comes off the real
   * `Response` (Git #3560). Every preset in `ENDPOINT_PRESETS` is a read-only
   * GET route (verified against `admin-observability.ts` / `msp-audit-log.ts`);
   * a write/mutating preset must never be added here without the same review.
   * The scope checkboxes are illustrative only — this dev tool has no way to
   * downscope the real admin session's own token, so the response always
   * reflects that session's actual authorization, not the boxes checked above.
   */
  const handleTestProbe = async () => {
    setIsTesting(true);
    const start = performance.now();

    try {
      const res = await adminFetch(endpointUrl, { method: "GET" });
      const duration = Math.round(performance.now() - start);
      const bodyText = await res.text();

      let bodyString = bodyText;
      try {
        bodyString = JSON.stringify(JSON.parse(bodyText), null, 2);
      } catch {
        // Not JSON (or empty body) — show the raw text as-is.
      }

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });

      setProbeResult({
        status: res.status,
        statusText: res.statusText,
        duration,
        sizeBytes: new Blob([bodyText]).size,
        headers,
        body: bodyString
      });
    } catch (err) {
      const duration = Math.round(performance.now() - start);
      const message = err instanceof Error ? err.message : String(err);
      const bodyString = JSON.stringify(
        { error: "NetworkError", message },
        null,
        2
      );

      setProbeResult({
        status: 0,
        statusText: "Network Error",
        duration,
        sizeBytes: new Blob([bodyString]).size,
        headers: {},
        body: bodyString
      });
    } finally {
      setIsTesting(false);
      setShowResultModal(true);
    }
  };

  const handleCopyBody = () => {
    if (!probeResult) return;
    navigator.clipboard.writeText(probeResult.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      {/* Outer Main Dialog */}
      <div className="w-full max-w-lg bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden text-foreground">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-card/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-purple-500/10 border border-purple-500/20 rounded-lg">
              <Globe className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">API Graph Probe</h2>
              <p className="text-[11px] text-muted-foreground">Test REST & GraphQL gateway scopes and connectivity.</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 hover:bg-border rounded-lg transition-colors text-muted-foreground hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 space-y-4 flex-1">
          {/* Endpoint Url Input */}
          <div className="space-y-1.5">
            <Label htmlFor="endpoint" className="text-xs text-muted-foreground">Target Endpoint URL</Label>
            <div className="flex gap-2">
              <Input
                id="endpoint"
                placeholder="/api/v1/resource"
                value={endpointUrl}
                onChange={e => setEndpointUrl(e.target.value)}
                className="h-9 text-xs bg-background border-border text-white flex-1"
              />
            </div>
            {/* Presets */}
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {ENDPOINT_PRESETS.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => setEndpointUrl(p.url)}
                  className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                    endpointUrl === p.url 
                      ? "bg-purple-500/10 text-purple-400 border-purple-500/30 font-semibold" 
                      : "bg-card text-muted-foreground border-border hover:bg-accent"
                  }`}
                  title={p.label}
                >
                  {p.url.split("/").pop()}
                </button>
              ))}
            </div>
          </div>

          {/* Scope Selectors */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Shield className="w-3.5 h-3.5 text-purple-400" /> Authorized Scopes (Security Token)
            </Label>
            
            <div className="bg-card/50 border border-border rounded-lg p-2.5 space-y-2 max-h-48 overflow-y-auto">
              {SCOPE_OPTIONS.map(opt => {
                const isChecked = selectedScopes.includes(opt.id);
                return (
                  <div 
                    key={opt.id}
                    onClick={() => toggleScope(opt.id)}
                    className="flex items-start gap-2.5 p-1.5 hover:bg-accent/60 rounded cursor-pointer transition-colors"
                  >
                    <div className="mt-0.5 text-purple-400 shrink-0">
                      {isChecked ? <CheckSquare className="w-4 h-4 fill-purple-500/10" /> : <Square className="w-4 h-4" />}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white leading-none">{opt.label}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{opt.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border bg-card/40 flex justify-end gap-2.5">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onClose} 
            className="h-8 text-xs border-border hover:bg-accent"
          >
            Cancel
          </Button>
          <Button 
            onClick={handleTestProbe} 
            disabled={isTesting}
            className="h-8 text-xs bg-purple-600 hover:bg-purple-700 w-24"
          >
            {isTesting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Test...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 mr-1.5 text-purple-200" /> Run Test
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Embedded Secondary Result-Viewing Modal */}
      {showResultModal && probeResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
          <div className="w-full max-w-2xl h-[70vh] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden text-foreground animate-in fade-in zoom-in-95 duration-150">
            {/* Embedded Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/80 shrink-0">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-purple-400" />
                <h3 className="text-xs font-semibold">Probe Telemetry Response</h3>
              </div>
              <button 
                onClick={() => setShowResultModal(false)}
                className="p-1 hover:bg-border rounded transition-colors text-muted-foreground hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Embedded Body */}
            <div className="flex-1 flex flex-col min-h-0">
              {/* Status Banner */}
              <div className={`px-5 py-2.5 border-b border-border flex items-center justify-between text-xs shrink-0 ${
                probeResult.status === 200 ? "bg-emerald-500/5 text-emerald-400" : "bg-red-500/5 text-red-400"
              }`}>
                <div className="flex items-center gap-1.5">
                  {probeResult.status === 200 ? <ShieldCheck className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  <span className="font-semibold">{probeResult.status} {probeResult.statusText}</span>
                </div>
                <div className="flex items-center gap-4 text-muted-foreground text-[11px]">
                  <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {probeResult.duration}ms</span>
                  <span>Size: {(probeResult.sizeBytes / 1024).toFixed(2)} KB</span>
                </div>
              </div>

              {/* Grid content */}
              <div className="flex-1 flex flex-col min-h-0">
                {/* Headers Display */}
                <div className="px-5 py-3 border-b border-border bg-card/10 shrink-0">
                  <h4 className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-2">Response Headers</h4>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[10px] text-muted-foreground">
                    {Object.entries(probeResult.headers).map(([k, v]) => (
                      <div key={k} className="flex justify-between border-b border-border/40 pb-0.5">
                        <span className="text-purple-400">{k}</span>
                        <span className="truncate max-w-[160px] text-white" title={v}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Body Monaco Editor */}
                <div className="flex-1 relative bg-[#1e1e1e] min-h-0">
                  <div className="absolute top-2.5 right-4 z-10">
                    <Button 
                      onClick={handleCopyBody}
                      variant="outline" 
                      size="sm" 
                      className="h-6 text-[10px] border-border hover:bg-accent px-2 text-muted-foreground hover:text-white"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-400 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <Editor
                    height="100%"
                    defaultLanguage="json"
                    theme="vs-dark"
                    value={probeResult.body}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      fontSize: 11,
                      fontFamily: "Fira Code, Monaco, Courier New, monospace",
                      scrollbar: { vertical: "auto", horizontal: "auto" },
                      automaticLayout: true
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Embedded Footer */}
            <div className="px-5 py-3 border-t border-border bg-card/80 flex justify-end shrink-0">
              <Button 
                onClick={() => setShowResultModal(false)}
                size="sm"
                className="h-7 text-xs bg-purple-600 hover:bg-purple-700"
              >
                Close Response
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
