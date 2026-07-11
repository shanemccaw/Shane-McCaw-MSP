import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useJsonImportExport } from "@/hooks/useJsonImportExport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MonitorCheck {
  id: number;
  checkId: string;
  key: string;
  label: string;
  description: string | null;
  endpoint: string;
  method: string;
  properties: string[];
  mapping: Array<{ sourceField: string; targetField: string; transform?: string }>;
  severityRules: Array<{ expression: string; severity: string; label?: string }>;
  outputSchema?: Record<string, unknown> | null;
  engines: string[];
  frequency: "hourly" | "daily" | "live";
  requiresCustomerScript: boolean;
  schemaVersion: number;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

const EMPTY_CHECK: Partial<MonitorCheck> = {
  key: "",
  label: "",
  description: "",
  endpoint: "",
  method: "GET",
  properties: [],
  mapping: [],
  severityRules: [],
  engines: [],
  frequency: "daily",
  requiresCustomerScript: false,
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  warning: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  ok: "bg-green-500/20 text-green-400 border-green-500/30",
  info: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const MONITOR_CHECK_TEMPLATE = {
  key: "category:check-name",
  label: "Human-readable check name",
  description: "Brief description of what this check verifies",
  endpoint: "/users?$select=id,displayName,mfaRegistered",
  method: "GET",
  frequency: "daily",
  properties: ["id", "displayName", "mfaRegistered"],
  engines: ["health", "monitoring"],
  requiresCustomerScript: false,
  mapping: [{ sourceField: "mfaRegistered", targetField: "mfaEnabledCount", transform: "count" }],
  severityRules: [{ expression: "mfaEnabledCount == 0", severity: "critical", label: "No MFA users" }],
  outputSchema: { type: "object", required: ["mfaEnabledCount"] },
};

export default function MonitorChecksPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const { exportJson, downloadTemplate, importJson } = useJsonImportExport();
  const [checks, setChecks] = useState<MonitorCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editingCheck, setEditingCheck] = useState<Partial<MonitorCheck> | null>(null);
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const loadChecks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/monitor-checks");
      const data = await res.json() as { checks: MonitorCheck[] };
      setChecks(data.checks ?? []);
    } catch {
      toast({ title: "Error", description: "Failed to load monitor checks", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => { void loadChecks(); }, [loadChecks]);

  const handleImport = () => {
    importJson(async (records) => {
      const first = records[0] as Record<string, unknown> | undefined;
      if (first && "__parseError" in (first ?? {})) {
        toast({ title: "Import failed", description: String(first.__parseError), variant: "destructive" });
        return;
      }
      let created = 0, updated = 0, failed = 0;
      const existingKeys = new Set(checks.map(c => c.key));
      for (const raw of records) {
        const rec = raw as Record<string, unknown>;
        try {
          const isEdit = existingKeys.has(String(rec.key));
          const url = isEdit ? `/api/admin/monitor-checks/${String(rec.key)}` : "/api/admin/monitor-checks";
          const method = isEdit ? "PATCH" : "POST";
          // Strip status — imported records always default to active
          const { status: _status, ...importBody } = rec as Record<string, unknown> & { status?: string };
          const res = await fetchWithAuth(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(importBody) });
          if (!res.ok) { failed++; continue; }
          isEdit ? updated++ : created++;
        } catch { failed++; }
      }
      const parts = [];
      if (created) parts.push(`${created} created`);
      if (updated) parts.push(`${updated} updated`);
      if (failed) parts.push(`${failed} failed`);
      toast({
        title: `Imported ${created + updated} checks`,
        description: parts.join(", "),
        variant: failed > 0 ? "destructive" : "default",
      });
      void loadChecks();
    });
  };

  const openCreate = () => { setEditingCheck({ ...EMPTY_CHECK }); setShowDialog(true); };
  const openEdit = (c: MonitorCheck) => { setEditingCheck({ ...c }); setShowDialog(true); };

  const handleSave = async () => {
    if (!editingCheck) return;
    setSaving(true);
    try {
      const isEdit = Boolean(editingCheck.id);
      const url = isEdit
        ? `/api/admin/monitor-checks/${editingCheck.key}`
        : "/api/admin/monitor-checks";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetchWithAuth(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(editingCheck) });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Save failed");
      }
      toast({ title: isEdit ? "Check updated" : "Check created" });
      setShowDialog(false);
      void loadChecks();
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (c: MonitorCheck) => {
    if (!confirm(`Archive "${c.label}"? It will be soft-deprecated and grandfathered in existing packages.`)) return;
    try {
      const res = await fetchWithAuth(`/api/admin/monitor-checks/${c.key}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Archive failed");
      toast({ title: "Check archived" });
      void loadChecks();
    } catch {
      toast({ title: "Error", description: "Failed to archive check", variant: "destructive" });
    }
  };

  const filtered = checks.filter(c => {
    if (!showArchived && c.status === "archived") return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return c.key.toLowerCase().includes(q) || c.label.toLowerCase().includes(q) || c.endpoint.toLowerCase().includes(q);
  });

  const updateField = <K extends keyof MonitorCheck>(key: K, value: MonitorCheck[K]) => {
    setEditingCheck(prev => prev ? { ...prev, [key]: value } : prev);
  };

  const parseJsonArrayField = (raw: string): string[] => {
    try { return JSON.parse(raw) as string[]; } catch { return raw.split(",").map(s => s.trim()).filter(Boolean); }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Monitor Checks</h2>
          <p className="text-sm text-gray-400 mt-1">Platform-authored Graph API checks — never MSP-authored</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadTemplate("monitor-checks-template.json", MONITOR_CHECK_TEMPLATE)}
            className="border-[#30363D] text-gray-300 hover:text-white hover:border-gray-400 text-xs"
          >
            Template
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleImport}
            className="border-[#30363D] text-gray-300 hover:text-white hover:border-gray-400 text-xs"
          >
            Import JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportJson("monitor-checks.json", checks)}
            className="border-[#30363D] text-gray-300 hover:text-white hover:border-gray-400 text-xs"
          >
            Export JSON
          </Button>
          <Button onClick={openCreate} className="bg-[#0078D4] hover:bg-[#006cbf] text-white">
            + New Check
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Input
          placeholder="Search by key, label, endpoint…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm bg-[#161B22] border-[#30363D] text-white"
        />
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          Show archived
        </label>
        <span className="text-sm text-gray-500">{filtered.length} checks</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              {search ? "No checks match your search" : "No monitor checks yet — create the first one"}
            </div>
          )}
          {filtered.map(check => (
            <div key={check.key} className="bg-[#161B22] border border-[#30363D] rounded-lg p-4 hover:border-[#0078D4]/50 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm text-[#0078D4]">{check.key}</span>
                    <Badge variant="outline" className={check.status === "active" ? "border-green-500/30 text-green-400" : "border-gray-500/30 text-gray-400"}>
                      {check.status}
                    </Badge>
                    <Badge variant="outline" className="border-blue-500/30 text-blue-400 text-xs">
                      {check.frequency}
                    </Badge>
                    {check.requiresCustomerScript && (
                      <Badge variant="outline" className="border-purple-500/30 text-purple-400 text-xs">
                        requires script
                      </Badge>
                    )}
                    <span className="text-xs text-gray-500">v{check.schemaVersion}</span>
                  </div>
                  <div className="mt-1 text-sm text-white font-medium">{check.label}</div>
                  {check.description && <div className="text-xs text-gray-400 mt-0.5">{check.description}</div>}
                  <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                    <span className="font-mono bg-[#0D1117] px-2 py-0.5 rounded">{check.method}</span>
                    <span className="font-mono text-[#0078D4] truncate max-w-xs">{check.endpoint}</span>
                  </div>
                  {check.severityRules.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {check.severityRules.slice(0, 3).map((r, i) => (
                        <span key={i} className={`text-xs px-2 py-0.5 rounded border ${SEVERITY_COLORS[r.severity] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30"}`}>
                          {r.severity}
                        </span>
                      ))}
                      {check.severityRules.length > 3 && <span className="text-xs text-gray-500">+{check.severityRules.length - 3} more</span>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(check)} className="text-gray-400 hover:text-white h-8">
                    Edit
                  </Button>
                  {check.status === "active" && (
                    <Button size="sm" variant="ghost" onClick={() => handleArchive(check)} className="text-red-400 hover:text-red-300 h-8">
                      Archive
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-[#161B22] border-[#30363D] text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCheck?.id ? "Edit Monitor Check" : "New Monitor Check"}</DialogTitle>
          </DialogHeader>
          {editingCheck && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-gray-400 text-xs">Key *</Label>
                  <Input
                    value={editingCheck.key ?? ""}
                    onChange={e => updateField("key", e.target.value)}
                    placeholder="entra:mfa-enforcement"
                    disabled={Boolean(editingCheck.id)}
                    className="bg-[#0D1117] border-[#30363D] text-white mt-1 font-mono text-sm"
                  />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">Label *</Label>
                  <Input
                    value={editingCheck.label ?? ""}
                    onChange={e => updateField("label", e.target.value)}
                    placeholder="MFA Enforcement Check"
                    className="bg-[#0D1117] border-[#30363D] text-white mt-1"
                  />
                </div>
              </div>

              <div>
                <Label className="text-gray-400 text-xs">Description</Label>
                <Input
                  value={editingCheck.description ?? ""}
                  onChange={e => updateField("description", e.target.value)}
                  placeholder="Brief description of what this check verifies"
                  className="bg-[#0D1117] border-[#30363D] text-white mt-1"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <Label className="text-gray-400 text-xs">Graph API Endpoint *</Label>
                  <Input
                    value={editingCheck.endpoint ?? ""}
                    onChange={e => updateField("endpoint", e.target.value)}
                    placeholder="/users?$select=id,displayName,mfaRegistered"
                    className="bg-[#0D1117] border-[#30363D] text-white mt-1 font-mono text-sm"
                  />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">Method</Label>
                  <Select value={editingCheck.method ?? "GET"} onValueChange={v => updateField("method", v)}>
                    <SelectTrigger className="bg-[#0D1117] border-[#30363D] text-white mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#161B22] border-[#30363D]">
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-gray-400 text-xs">Frequency</Label>
                  <Select value={editingCheck.frequency ?? "daily"} onValueChange={v => updateField("frequency", v as MonitorCheck["frequency"])}>
                    <SelectTrigger className="bg-[#0D1117] border-[#30363D] text-white mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#161B22] border-[#30363D]">
                      <SelectItem value="hourly">Hourly</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="live">Live</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end pb-0.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Switch
                      checked={editingCheck.requiresCustomerScript ?? false}
                      onCheckedChange={v => updateField("requiresCustomerScript", v)}
                    />
                    <span className="text-sm text-gray-300">Requires customer script</span>
                  </label>
                </div>
              </div>

              <div>
                <Label className="text-gray-400 text-xs">Properties to extract (comma-separated or JSON array)</Label>
                <Input
                  value={Array.isArray(editingCheck.properties) ? editingCheck.properties.join(", ") : ""}
                  onChange={e => updateField("properties", parseJsonArrayField(e.target.value))}
                  placeholder="id, displayName, mfaRegistered"
                  className="bg-[#0D1117] border-[#30363D] text-white mt-1 font-mono text-sm"
                />
              </div>

              <div>
                <Label className="text-gray-400 text-xs">Engines to recompute (comma-separated)</Label>
                <Input
                  value={Array.isArray(editingCheck.engines) ? editingCheck.engines.join(", ") : ""}
                  onChange={e => updateField("engines", parseJsonArrayField(e.target.value))}
                  placeholder="health, monitoring"
                  className="bg-[#0D1117] border-[#30363D] text-white mt-1 font-mono text-sm"
                />
              </div>

              <div>
                <Label className="text-gray-400 text-xs">
                  Mapping rules (JSON array of {"{"}sourceField, targetField, transform{"}"})
                </Label>
                <Textarea
                  value={JSON.stringify(editingCheck.mapping ?? [], null, 2)}
                  onChange={e => { try { updateField("mapping", JSON.parse(e.target.value)); } catch { /* ignore */ } }}
                  rows={4}
                  className="bg-[#0D1117] border-[#30363D] text-white mt-1 font-mono text-xs"
                  placeholder='[{"sourceField":"mfaRegistered","targetField":"mfaEnabledCount","transform":"count"}]'
                />
              </div>

              <div>
                <Label className="text-gray-400 text-xs">
                  Severity rules (JSON array of {"{"}expression, severity, label?{"}"})
                </Label>
                <Textarea
                  value={JSON.stringify(editingCheck.severityRules ?? [], null, 2)}
                  onChange={e => { try { updateField("severityRules", JSON.parse(e.target.value)); } catch { /* ignore */ } }}
                  rows={4}
                  className="bg-[#0D1117] border-[#30363D] text-white mt-1 font-mono text-xs"
                  placeholder='[{"expression":"mfaEnabledCount == 0","severity":"critical","label":"No MFA users"}]'
                />
                <p className="text-xs text-gray-500 mt-1">
                  Grammar: path op literal, &&/||, contains, length&gt;/&lt;/==/&gt;=/{`<=`} — no eval
                </p>
              </div>

              <div>
                <Label className="text-gray-400 text-xs">Output schema (JSON Schema — optional, enables deterministic validation)</Label>
                <Textarea
                  value={editingCheck.outputSchema ? JSON.stringify(editingCheck.outputSchema, null, 2) : ""}
                  onChange={e => {
                    if (!e.target.value.trim()) { updateField("outputSchema", undefined); return; }
                    try { updateField("outputSchema", JSON.parse(e.target.value)); } catch { /* ignore */ }
                  }}
                  rows={3}
                  className="bg-[#0D1117] border-[#30363D] text-white mt-1 font-mono text-xs"
                  placeholder='{"type":"object","required":["mfaEnabledCount"]}'
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDialog(false)} className="text-gray-400">Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-[#0078D4] hover:bg-[#006cbf] text-white">
              {saving ? "Saving…" : "Save Check"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
