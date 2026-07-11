import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Play, Eye, Gauge, FlaskConical, Settings, Download, Upload, FileJson } from "lucide-react";
import LiveMonitorPanel from "@/pages/LiveMonitorPanel";

export interface EngineDefLite {
  key: string;
  label: string;
  description: string;
  categoryPrefix: string;
  tenantScoped: boolean;
}

interface DashboardResult {
  portfolio: boolean;
  output?: unknown;
  results?: Array<{ client: { id: number; name: string; email: string; company?: string | null }; output: unknown; error: string | null }>;
}

interface TestRunResult {
  mode: "tenant" | "payload";
  tenantId?: number;
  output: unknown;
  error?: string;
}

interface ConfigRow {
  id: number;
  signalKey: string;
  category?: string;
  [key: string]: unknown;
}

/**
 * EnginePanel — a reusable Dashboard/Testing/Preview/Configuration UX for any
 * of the 7 intelligence engines. This mirrors the Tenant Signal Engine's
 * admin page, parameterized by `engineKey` so no engine duplicates this UI.
 */
export default function EnginePanel({ engineKey }: { engineKey: string }) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [def, setDef] = useState<EngineDefLite | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResult | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [config, setConfig] = useState<{ rules: ConfigRow[]; groups: ConfigRow[] } | null>(null);
  const [configLoading, setConfigLoading] = useState(false);

  const [testTenantId, setTestTenantId] = useState("");
  const [testPayload, setTestPayload] = useState('{\n  "profileUpdates": {},\n  "parsedFindings": []\n}');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<TestRunResult | null>(null);
  const [previewResult, setPreviewResult] = useState<unknown | null>(null);
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [importing, setImporting] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importJsonText, setImportJsonText] = useState("");

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/engines/${engineKey}/dashboard`);
      if (!res.ok) throw new Error("Failed to load dashboard");
      setDashboard(await res.json());
    } catch (err) {
      toast({ title: "Dashboard load failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setDashboardLoading(false);
    }
  }, [engineKey, fetchWithAuth, toast]);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/engines/${engineKey}/configuration`);
      if (!res.ok) throw new Error("Failed to load configuration");
      setConfig(await res.json());
    } catch (err) {
      toast({ title: "Configuration load failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setConfigLoading(false);
    }
  }, [engineKey, fetchWithAuth, toast]);

  const loadLogs = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/admin/engines/${engineKey}/logs`);
      if (!res.ok) return;
      const data = await res.json();
      setLogs(data.logs ?? []);
    } catch {
      // logs are best-effort; ignore
    }
  }, [engineKey, fetchWithAuth]);

  useEffect(() => {
    void loadDashboard();
    void loadConfig();
    void loadLogs();
  }, [loadDashboard, loadConfig, loadLogs]);

  useEffect(() => {
    let cancelled = false;
    fetchWithAuth("/api/admin/engines")
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        const found = (d.engines as EngineDefLite[]).find(e => e.key === engineKey);
        setDef(found ?? null);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [engineKey, fetchWithAuth]);

  const buildBody = (): Record<string, unknown> => {
    if (testTenantId.trim()) return { tenantId: Number(testTenantId), debug: true };
    try {
      const payload = JSON.parse(testPayload || "{}");
      return { payload, debug: true };
    } catch {
      throw new Error("Sample payload must be valid JSON");
    }
  };

  const runTest = async () => {
    setTestRunning(true);
    setTestResult(null);
    try {
      const body = buildBody();
      const res = await fetchWithAuth(`/api/admin/engines/${engineKey}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test run failed");
      setTestResult(data);
      void loadLogs();
    } catch (err) {
      toast({ title: "Test failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setTestRunning(false);
    }
  };

  const runPreview = async () => {
    setTestRunning(true);
    setPreviewResult(null);
    try {
      const body = buildBody();
      const res = await fetchWithAuth(`/api/admin/engines/${engineKey}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setPreviewResult(data);
    } catch (err) {
      toast({ title: "Preview failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setTestRunning(false);
    }
  };

  const downloadJson = (data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    try {
      const res = await fetchWithAuth(`/api/admin/engines/${engineKey}/export`);
      if (!res.ok) throw new Error("Export failed");
      const data = await res.json();
      downloadJson(data, `${engineKey}-engine-export.json`);
      toast({ title: "Export ready", description: `Downloaded ${engineKey}-engine-export.json` });
    } catch (err) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await fetchWithAuth(`/api/admin/engines/${engineKey}/import-template`);
      if (!res.ok) throw new Error("Failed to load template");
      const data = await res.json();
      downloadJson(data, `${engineKey}-engine-import-template.json`);
    } catch (err) {
      toast({ title: "Template download failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const handleImportFromPaste = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(importJsonText);
    } catch {
      toast({ title: "Invalid JSON", description: "The pasted text is not valid JSON.", variant: "destructive" });
      return;
    }
    setShowImportDialog(false);
    setImportJsonText("");
    setImporting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/engines/${engineKey}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Import failed");
      toast({ title: "Import complete", description: `Imported ${(data as { imported?: number }).imported ?? 0} rule(s) across ${(data as { groupsImported?: number }).groupsImported ?? 0} group(s).` });
      void loadConfig();
    } catch (err) {
      toast({ title: "Import failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{def?.label ?? engineKey}</h1>
        <p className="text-sm text-muted-foreground">{def?.description}</p>
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard"><Gauge className="w-3.5 h-3.5 mr-1.5" />Dashboard</TabsTrigger>
          <TabsTrigger value="testing"><FlaskConical className="w-3.5 h-3.5 mr-1.5" />Testing</TabsTrigger>
          <TabsTrigger value="preview"><Eye className="w-3.5 h-3.5 mr-1.5" />Preview</TabsTrigger>
          <TabsTrigger value="configuration"><Settings className="w-3.5 h-3.5 mr-1.5" />Configuration</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-3 mt-4">
          {dashboardLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
          ) : dashboard?.portfolio ? (
            <Card>
              <CardHeader><CardTitle className="text-sm">Portfolio output</CardTitle></CardHeader>
              <CardContent><pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-96">{JSON.stringify(dashboard.output, null, 2)}</pre></CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {(dashboard?.results ?? []).map(r => (
                <Card key={r.client.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span>{r.client.company || r.client.name || r.client.email}</span>
                      {r.error ? <Badge variant="destructive">Error</Badge> : null}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {r.error ? (
                      <p className="text-xs text-destructive">{r.error}</p>
                    ) : (
                      <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-48">{JSON.stringify(r.output, null, 2)}</pre>
                    )}
                  </CardContent>
                </Card>
              ))}
              {(dashboard?.results ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No recent clients found.</p> : null}
            </div>
          )}
          {/* Subscription Health panel — rendered for the Live Monitor (monitoring) engine */}
          {engineKey === "monitoring" ? (
            <div className="mt-4 border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">Activity API Subscription Health</p>
              <LiveMonitorPanel />
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="testing" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Run a test</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Tenant ID (real client)</label>
                  <input
                    className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background"
                    placeholder="e.g. 42"
                    value={testTenantId}
                    onChange={e => setTestTenantId(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Sample payload (used when Tenant ID is blank)</label>
                  <textarea
                    className="w-full mt-1 px-3 py-2 text-xs font-mono border rounded-md bg-background h-24"
                    value={testPayload}
                    onChange={e => setTestPayload(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={runTest} disabled={testRunning}>
                  {testRunning ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
                  Run test
                </Button>
                <Button size="sm" variant="outline" onClick={runPreview} disabled={testRunning}>
                  <Eye className="w-3.5 h-3.5 mr-1.5" />
                  Run preview
                </Button>
              </div>
              {testResult ? (
                <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-80">{JSON.stringify(testResult, null, 2)}</pre>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Recent test runs</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {logs.length === 0 ? <p className="text-sm text-muted-foreground">No test runs yet.</p> : null}
              {logs.map(l => (
                <div key={String(l.id)} className="text-xs border rounded p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{String(l.mode)}{l.tenantId != null ? ` · tenant #${l.tenantId}` : ""}</span>
                    <span className="text-muted-foreground">{new Date(String(l.createdAt)).toLocaleString()}</span>
                  </div>
                  {l.error ? <p className="text-destructive mt-1">{String(l.error)}</p> : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preview" className="space-y-3 mt-4">
          {previewResult ? (
            <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-[32rem]">{JSON.stringify(previewResult, null, 2)}</pre>
          ) : (
            <p className="text-sm text-muted-foreground">Run a preview from the Testing tab to see workflow output vars, SOW pricing impact, and MSP roll-up effects for the fired signals.</p>
          )}
        </TabsContent>

        <TabsContent value="configuration" className="space-y-3 mt-4">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={handleExport}>
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Export JSON
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setImportJsonText(""); setShowImportDialog(true); }} disabled={importing}>
              {importing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
              Import JSON
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDownloadTemplate}>
              <FileJson className="w-3.5 h-3.5 mr-1.5" />
              Download import template
            </Button>
          </div>
          {configLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
          ) : (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Rule groups ({config?.groups.length ?? 0})</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(config?.groups ?? []).map(g => (
                    <div key={g.id} className="text-xs border rounded p-2 flex items-center justify-between">
                      <span>{g.signalKey}</span>
                      <Badge variant="outline">{String(g.category ?? "")}</Badge>
                    </div>
                  ))}
                  {(config?.groups ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No rule groups tagged for this engine yet.</p> : null}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Rules ({config?.rules.length ?? 0})</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(config?.rules ?? []).map(r => (
                    <div key={r.id} className="text-xs border rounded p-2 flex items-center justify-between">
                      <span>{r.signalKey}</span>
                      <Badge variant="outline">{String(r.category ?? "")}</Badge>
                    </div>
                  ))}
                  {(config?.rules ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No rules tagged for this engine yet.</p> : null}
                </CardContent>
              </Card>
              <p className="text-xs text-muted-foreground">
                To edit rule/group weights and thresholds, use the Tenant Signals page — it manages the underlying
                rows shared by all engines. Tag a rule's category as <code>{`${def?.categoryPrefix ?? ""}:...`}</code> to
                surface it here.
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showImportDialog} onOpenChange={(open) => { if (!open) setShowImportDialog(false); }}>
        <DialogContent className="bg-[#161B22] border-[#30363D] text-white max-w-xl">
          <DialogHeader>
            <DialogTitle>Import JSON</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-400">
              Paste the JSON export below. This will <strong>replace</strong> all current {def?.label ?? engineKey} rules and groups — a backup snapshot is taken automatically.
            </p>
            <Textarea
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              placeholder="Paste JSON here…"
              rows={14}
              className="bg-[#0D1117] border-[#30363D] text-white font-mono text-xs resize-none"
              spellCheck={false}
            />
            {importJsonText.trim() && (() => {
              try { JSON.parse(importJsonText); return <p className="text-sm font-medium text-green-400">✓ Valid JSON</p>; }
              catch (e) { return <p className="text-sm font-medium text-red-400">{e instanceof Error ? e.message : "Invalid JSON"}</p>; }
            })()}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowImportDialog(false)} className="text-gray-400">
              Cancel
            </Button>
            <Button
              onClick={() => void handleImportFromPaste()}
              disabled={!importJsonText.trim() || (() => { try { JSON.parse(importJsonText); return false; } catch { return true; } })()}
              className="bg-[#0078D4] hover:bg-[#006cbf] text-white disabled:opacity-50"
            >
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
