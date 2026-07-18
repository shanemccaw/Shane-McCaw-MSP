import { useState, useEffect, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useJsonImportExport } from "@/hooks/useJsonImportExport";
import { ImportJsonDialog } from "@/components/ImportJsonDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight } from "lucide-react";

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

type GroupBy = "prefix" | "engines" | "frequency" | "severity";

function getGroupsForCheck(check: MonitorCheck, groupBy: GroupBy): string[] {
  switch (groupBy) {
    case "prefix": {
      const idx = check.key.indexOf(":");
      return [idx === -1 ? "other" : check.key.slice(0, idx)];
    }
    case "engines":
      return check.engines.length > 0 ? check.engines : ["none"];
    case "frequency":
      return [check.frequency];
    case "severity": {
      const severities = [...new Set(check.severityRules.map(r => r.severity))];
      return severities.length > 0 ? severities : ["none"];
    }
  }
}

function buildGroups(checks: MonitorCheck[], groupBy: GroupBy): Array<{ name: string; checks: MonitorCheck[] }> {
  const map = new Map<string, MonitorCheck[]>();
  for (const check of checks) {
    const groups = getGroupsForCheck(check, groupBy);
    for (const g of groups) {
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(check);
    }
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, items]) => ({ name, checks: items }));
}

const FREQ_BADGE: Record<string, string> = {
  hourly: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  daily: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  live: "bg-green-500/20 text-green-300 border-green-500/30",
};

export default function MonitorChecksPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const { exportJson, downloadTemplate, openImportDialog, importDialogOpen, closeImportDialog } = useJsonImportExport();
  const [checks, setChecks] = useState<MonitorCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingCheck, setEditingCheck] = useState<Partial<MonitorCheck> | null>(null);
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("prefix");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

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

  const handleImportConfirm = async (records: unknown[]) => {
    let created = 0, updated = 0, failed = 0;
    const existingKeys = new Set(checks.map(c => c.key));
    for (const raw of records) {
      const rec = raw as Record<string, unknown>;
      try {
        const isEdit = existingKeys.has(String(rec.key));
        const url = isEdit ? `/api/admin/monitor-checks/${String(rec.key)}` : "/api/admin/monitor-checks";
        const method = isEdit ? "PATCH" : "POST";
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
  };

  const openCreate = () => {
    setEditingCheck({ ...EMPTY_CHECK });
    setSelectedKey(null);
  };

  const openEdit = (c: MonitorCheck) => {
    setEditingCheck({ ...c });
    setSelectedKey(c.key);
  };

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
      const savedKey = editingCheck.key ?? null;
      await loadChecks();
      setSelectedKey(savedKey);
      if (savedKey) {
        setChecks(prev => {
          const found = prev.find(c => c.key === savedKey);
          if (found) setEditingCheck({ ...found });
          return prev;
        });
      }
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
      setEditingCheck(null);
      setSelectedKey(null);
      void loadChecks();
    } catch {
      toast({ title: "Error", description: "Failed to archive check", variant: "destructive" });
    }
  };

  const filtered = useMemo(() => checks.filter(c => {
    if (!showArchived && c.status === "archived") return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return c.key.toLowerCase().includes(q) || c.label.toLowerCase().includes(q) || c.endpoint.toLowerCase().includes(q);
  }), [checks, showArchived, search]);

  const groups = useMemo(() => buildGroups(filtered, groupBy), [filtered, groupBy]);

  const toggleGroup = (name: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const updateField = <K extends keyof MonitorCheck>(key: K, value: MonitorCheck[K]) => {
    setEditingCheck(prev => prev ? { ...prev, [key]: value } : prev);
  };

  const parseJsonArrayField = (raw: string): string[] => {
    try { return JSON.parse(raw) as string[]; } catch { return raw.split(",").map(s => s.trim()).filter(Boolean); }
  };

  const isNewCheck = editingCheck !== null && !editingCheck.id;

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-[260px] min-w-[200px] flex flex-col border-r border-border bg-background overflow-hidden">
        <div className="p-3 border-b border-border space-y-2 shrink-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Monitor Checks</span>
            <span className="text-xs text-gray-500">{filtered.length}</span>
          </div>
          <Input
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-7 text-xs bg-card border-border text-white placeholder:text-gray-600"
          />
          <Select value={groupBy} onValueChange={v => setGroupBy(v as GroupBy)}>
            <SelectTrigger className="h-7 text-xs bg-card border-border text-gray-300">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-border text-white">
              <SelectItem value="prefix" className="text-xs">Group: Key prefix</SelectItem>
              <SelectItem value="engines" className="text-xs">Group: Engines</SelectItem>
              <SelectItem value="frequency" className="text-xs">Group: Frequency</SelectItem>
              <SelectItem value="severity" className="text-xs">Group: Severity</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 cursor-pointer">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} className="scale-75" />
            <span className="text-xs text-gray-400">Show archived</span>
          </label>
          <div className="flex flex-col gap-1">
            <Button
              size="sm"
              onClick={openCreate}
              className="h-7 text-xs bg-primary hover:bg-[#006cbf] text-white w-full"
            >
              + New Check
            </Button>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => openImportDialog()}
                className="h-6 text-xs border-border text-gray-400 hover:text-white flex-1 px-1"
              >
                Import
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => exportJson("monitor-checks.json", checks)}
                className="h-6 text-xs border-border text-gray-400 hover:text-white flex-1 px-1"
              >
                Export
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadTemplate("monitor-checks-template.json", MONITOR_CHECK_TEMPLATE)}
                className="h-6 text-xs border-border text-gray-400 hover:text-white flex-1 px-1"
              >
                Tmpl
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-600 px-3">
              {search ? "No checks match" : "No checks yet"}
            </div>
          ) : (
            groups.map(group => {
              const isCollapsed = collapsedGroups.has(group.name);
              return (
                <div key={group.name}>
                  <button
                    onClick={() => toggleGroup(group.name)}
                    className="w-full flex items-center gap-1 px-3 py-1.5 text-left hover:bg-card transition-colors group"
                  >
                    {isCollapsed
                      ? <ChevronRight className="w-3 h-3 text-gray-500 shrink-0" />
                      : <ChevronDown className="w-3 h-3 text-gray-500 shrink-0" />
                    }
                    <span className="text-xs font-medium text-gray-300 capitalize flex-1 truncate">{group.name}</span>
                    <span className="text-xs text-gray-600 bg-border rounded px-1">{group.checks.length}</span>
                  </button>
                  {!isCollapsed && group.checks.map(check => {
                    const isSelected = selectedKey === check.key && !isNewCheck;
                    const isArchived = check.status === "archived";
                    return (
                      <button
                        key={check.key}
                        onClick={() => openEdit(check)}
                        className={`w-full flex items-center gap-2 pl-6 pr-3 py-1.5 text-left transition-colors border-l-2 ${
                          isSelected
                            ? "bg-primary/10 border-l-primary"
                            : "border-l-transparent hover:bg-card"
                        }`}
                      >
                        <span className={`font-mono text-xs flex-1 truncate ${isArchived ? "text-gray-600 italic" : "text-gray-300"}`}>
                          {check.key}
                        </span>
                        <span className={`text-[10px] px-1 py-0.5 rounded border shrink-0 ${FREQ_BADGE[check.frequency] ?? "border-gray-500/30 text-gray-400"}`}>
                          {check.frequency[0]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden bg-card">
        {editingCheck === null ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 px-8">
            <div className="text-4xl text-gray-700">⬡</div>
            <p className="text-gray-500 text-sm">Select a check to edit</p>
            <p className="text-gray-600 text-xs">or click <strong className="text-gray-500">+ New Check</strong> to create one</p>
          </div>
        ) : (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="shrink-0 px-6 py-4 border-b border-border flex items-center gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  {editingCheck.id ? (
                    <span className="font-mono text-primary">{editingCheck.key}</span>
                  ) : (
                    "New Monitor Check"
                  )}
                </h2>
                {editingCheck.id && editingCheck.label && (
                  <p className="text-xs text-gray-400 mt-0.5">{editingCheck.label}</p>
                )}
              </div>
              {editingCheck.status === "archived" && (
                <Badge variant="outline" className="border-gray-500/30 text-gray-400 text-xs ml-auto">archived</Badge>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-gray-400 text-xs">Key *</Label>
                  <Input
                    value={editingCheck.key ?? ""}
                    onChange={e => updateField("key", e.target.value)}
                    placeholder="entra:mfa-enforcement"
                    disabled={Boolean(editingCheck.id)}
                    className="bg-background border-border text-white mt-1 font-mono text-sm"
                  />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">Label *</Label>
                  <Input
                    value={editingCheck.label ?? ""}
                    onChange={e => updateField("label", e.target.value)}
                    placeholder="MFA Enforcement Check"
                    className="bg-background border-border text-white mt-1"
                  />
                </div>
              </div>

              <div>
                <Label className="text-gray-400 text-xs">Description</Label>
                <Input
                  value={editingCheck.description ?? ""}
                  onChange={e => updateField("description", e.target.value)}
                  placeholder="Brief description of what this check verifies"
                  className="bg-background border-border text-white mt-1"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <Label className="text-gray-400 text-xs">Graph API Endpoint *</Label>
                  <Input
                    value={editingCheck.endpoint ?? ""}
                    onChange={e => updateField("endpoint", e.target.value)}
                    placeholder="/users?$select=id,displayName,mfaRegistered"
                    className="bg-background border-border text-white mt-1 font-mono text-sm"
                  />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">Method</Label>
                  <Select value={editingCheck.method ?? "GET"} onValueChange={v => updateField("method", v)}>
                    <SelectTrigger className="bg-background border-border text-white mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
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
                    <SelectTrigger className="bg-background border-border text-white mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
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
                  className="bg-background border-border text-white mt-1 font-mono text-sm"
                />
              </div>

              <div>
                <Label className="text-gray-400 text-xs">Engines to recompute (comma-separated)</Label>
                <Input
                  value={Array.isArray(editingCheck.engines) ? editingCheck.engines.join(", ") : ""}
                  onChange={e => updateField("engines", parseJsonArrayField(e.target.value))}
                  placeholder="health, monitoring"
                  className="bg-background border-border text-white mt-1 font-mono text-sm"
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
                  className="bg-background border-border text-white mt-1 font-mono text-xs"
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
                  className="bg-background border-border text-white mt-1 font-mono text-xs"
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
                  className="bg-background border-border text-white mt-1 font-mono text-xs"
                  placeholder='{"type":"object","required":["mfaEnabledCount"]}'
                />
              </div>
            </div>

            <div className="shrink-0 px-6 py-4 border-t border-border flex items-center justify-between gap-3">
              <div>
                {editingCheck.id && editingCheck.status === "active" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleArchive(editingCheck as MonitorCheck)}
                    className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
                  >
                    Archive
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setEditingCheck(null); setSelectedKey(null); }}
                  className="text-gray-400 hover:text-white"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-primary hover:bg-[#006cbf] text-white"
                >
                  {saving ? "Saving…" : "Save Check"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ImportJsonDialog
        open={importDialogOpen}
        onClose={closeImportDialog}
        onConfirm={handleImportConfirm}
      />
    </div>
  );
}
