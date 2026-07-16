import React, { useState } from "react";
import Editor from "@monaco-editor/react";
import { 
  Globe, Shield, Play, X, Check, Loader2, AlertCircle, 
  Clock, Server, ShieldCheck, Copy, CheckSquare, Square
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface GraphProbeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ENDPOINT_PRESETS = [
  { url: "/api/admin/observability/service-health", label: "Service Health Metrics" },
  { url: "/api/admin/observability/event-bus", label: "Event Bus Live stats" },
  { url: "/api/admin/observability/alert-events", label: "Alert Configuration & Events" },
  { url: "/api/msp/audit-logs", label: "MSP Audit Log Telemetry" },
];

const SCOPE_OPTIONS = [
  { id: "read:msp", label: "read:msp", desc: "Read MSP profiles, configs and limits" },
  { id: "write:msp", label: "write:msp", desc: "Write/update MSP records" },
  { id: "read:users", label: "read:users", desc: "View administrative user lists" },
  { id: "write:users", label: "write:users", desc: "Create or suspend users" },
  { id: "admin:all", label: "admin:all", desc: "Root access override" }
];

export function GraphProbeModal({ isOpen, onClose }: GraphProbeModalProps) {
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

  const handleTestProbe = () => {
    setIsTesting(true);
    
    // Simulate API request timing
    setTimeout(() => {
      const hasAdmin = selectedScopes.includes("admin:all") || selectedScopes.includes("read:msp");
      
      const success = hasAdmin && endpointUrl.startsWith("/api/admin");
      const status = success ? 200 : (hasAdmin ? 404 : 403);
      const statusText = status === 200 ? "OK" : status === 403 ? "Forbidden (Missing Scopes)" : "Not Found";
      
      let bodyData = {};
      if (status === 200) {
        if (endpointUrl.includes("service-health")) {
          bodyData = {
            healthy: true,
            uptime: "14d 6h 22m",
            jobQueue: { pending: 0, running: 1, completed: 852, failed: 0 },
            services: { database: "CONNECTED", cache: "CONNECTED", mailer: "ACTIVE" }
          };
        } else if (endpointUrl.includes("event-bus")) {
          bodyData = {
            busStatus: "ACTIVE",
            activeListeners: 24,
            throughput24h: 42104,
            droppedEvents: 0
          };
        } else {
          bodyData = {
            scopes_verified: selectedScopes,
            authorized: true,
            timestamp: new Date().toISOString(),
            payload: { message: "Telemetry probe request returned with valid context." }
          };
        }
      } else {
        bodyData = {
          error: status === 403 ? "AccessDenied" : "ResourceNotFound",
          message: status === 403 ? "The security context lacks required credentials." : "Endpoint not registered on target server.",
          required_scopes: ["admin:all", "read:msp"],
          provided_scopes: selectedScopes
        };
      }

      const bodyString = JSON.stringify(bodyData, null, 2);

      setProbeResult({
        status,
        statusText,
        duration: Math.round(100 + Math.random() * 250),
        sizeBytes: new Blob([bodyString]).size,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-powered-by": "Express/Shane-McCaw-MSP",
          "cache-control": "no-store, no-cache",
          "x-request-id": Math.random().toString(36).substring(2, 15)
        },
        body: bodyString
      });

      setIsTesting(false);
      setShowResultModal(true);
    }, 1200);
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
      <div className="w-full max-w-lg bg-[#0D1117] border border-[#30363D] rounded-xl shadow-2xl flex flex-col overflow-hidden text-[#E6EDF3]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363D] bg-[#161B22]/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-purple-500/10 border border-purple-500/20 rounded-lg">
              <Globe className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">API Graph Probe</h2>
              <p className="text-[11px] text-[#7D8590]">Test REST & GraphQL gateway scopes and connectivity.</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 hover:bg-[#30363D] rounded-lg transition-colors text-[#7D8590] hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 space-y-4 flex-1">
          {/* Endpoint Url Input */}
          <div className="space-y-1.5">
            <Label htmlFor="endpoint" className="text-xs text-[#7D8590]">Target Endpoint URL</Label>
            <div className="flex gap-2">
              <Input
                id="endpoint"
                placeholder="/api/v1/resource"
                value={endpointUrl}
                onChange={e => setEndpointUrl(e.target.value)}
                className="h-9 text-xs bg-[#0D1117] border-[#30363D] text-white flex-1"
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
                      : "bg-[#161B22] text-[#8B949E] border-[#30363D] hover:bg-[#21262D]"
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
            <Label className="text-xs text-[#7D8590] flex items-center gap-1">
              <Shield className="w-3.5 h-3.5 text-purple-400" /> Authorized Scopes (Security Token)
            </Label>
            
            <div className="bg-[#161B22]/50 border border-[#30363D] rounded-lg p-2.5 space-y-2 max-h-48 overflow-y-auto">
              {SCOPE_OPTIONS.map(opt => {
                const isChecked = selectedScopes.includes(opt.id);
                return (
                  <div 
                    key={opt.id}
                    onClick={() => toggleScope(opt.id)}
                    className="flex items-start gap-2.5 p-1.5 hover:bg-[#21262D]/60 rounded cursor-pointer transition-colors"
                  >
                    <div className="mt-0.5 text-purple-400 shrink-0">
                      {isChecked ? <CheckSquare className="w-4 h-4 fill-purple-500/10" /> : <Square className="w-4 h-4" />}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white leading-none">{opt.label}</p>
                      <p className="text-[10px] text-[#7D8590] mt-0.5">{opt.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#30363D] bg-[#161B22]/40 flex justify-end gap-2.5">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onClose} 
            className="h-8 text-xs border-[#30363D] hover:bg-[#21262D]"
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
          <div className="w-full max-w-2xl h-[70vh] bg-[#0D1117] border border-[#30363D] rounded-xl shadow-2xl flex flex-col overflow-hidden text-[#E6EDF3] animate-in fade-in zoom-in-95 duration-150">
            {/* Embedded Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#30363D] bg-[#161B22]/80 shrink-0">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-purple-400" />
                <h3 className="text-xs font-semibold">Probe Telemetry Response</h3>
              </div>
              <button 
                onClick={() => setShowResultModal(false)}
                className="p-1 hover:bg-[#30363D] rounded transition-colors text-[#7D8590] hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Embedded Body */}
            <div className="flex-1 flex flex-col min-h-0">
              {/* Status Banner */}
              <div className={`px-5 py-2.5 border-b border-[#30363D] flex items-center justify-between text-xs shrink-0 ${
                probeResult.status === 200 ? "bg-emerald-500/5 text-emerald-400" : "bg-red-500/5 text-red-400"
              }`}>
                <div className="flex items-center gap-1.5">
                  {probeResult.status === 200 ? <ShieldCheck className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  <span className="font-semibold">{probeResult.status} {probeResult.statusText}</span>
                </div>
                <div className="flex items-center gap-4 text-[#7D8590] text-[11px]">
                  <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {probeResult.duration}ms</span>
                  <span>Size: {(probeResult.sizeBytes / 1024).toFixed(2)} KB</span>
                </div>
              </div>

              {/* Grid content */}
              <div className="flex-1 flex flex-col min-h-0">
                {/* Headers Display */}
                <div className="px-5 py-3 border-b border-[#30363D] bg-[#161B22]/10 shrink-0">
                  <h4 className="text-[10px] uppercase font-bold tracking-wider text-[#7D8590] mb-2">Response Headers</h4>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[10px] text-[#8B949E]">
                    {Object.entries(probeResult.headers).map(([k, v]) => (
                      <div key={k} className="flex justify-between border-b border-[#30363D]/40 pb-0.5">
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
                      className="h-6 text-[10px] border-[#30363D] hover:bg-[#21262D] px-2 text-[#7D8590] hover:text-white"
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
            <div className="px-5 py-3 border-t border-[#30363D] bg-[#161B22]/80 flex justify-end shrink-0">
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
