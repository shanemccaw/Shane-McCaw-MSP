import { useState, useEffect, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { GripVertical } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLocation, useSearch } from "wouter";
import { PayloadField } from "@/pages/workflows/PayloadField";
import type { AncestorGroup } from "@/pages/workflows/ancestorOutputs";

const API = "/api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface BaselineTemplate {
  id: number;
  templateId: string;
  label: string;
  description: string | null;
  category: string;
  endpoint: string;
  method: "POST" | "PATCH" | "PUT";
  bodyTemplate: Record<string, unknown>;
  requiredVariables: string[];
  successCriteria: Record<string, unknown>;
  dependsOn: string[];
  requiresVerificationGate: boolean;
  schemaVersion: number;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  packs?: Array<{
    packKey: string;
    packLabel: string;
    sortOrder: number;
    totalInPack: number;
  }>;
}

interface ConfigPack {
  id: number;
  packKey: string;
  label: string;
  description: string | null;
  categories: string[];
  status: "active" | "archived";
  createdAt: string;
}

interface ConfigPackTemplateLink {
  id: number;
  packId: number;
  templateId: string;
  sortOrder: number;
  dependsOnOverride: string[] | null;
  template?: BaselineTemplate;
}

interface AuditLogEntry {
  id: number;
  action: string;
  templateId: string | null;
  adminId: number | null;
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown> | null;
  createdAt: string;
}

interface TestbedCustomer {
  id: number;
  name: string;
  tenantId: string;
}

interface TestResult {
  success: boolean;
  status: number;
  data: unknown;
  errorType?: string;
  endpoint: string;
  method: string;
  label: string;
  missingVariables?: string[];
}

const EMPTY_TEMPLATE: Partial<BaselineTemplate> = {
  templateId: "", label: "", description: "", category: "",
  endpoint: "", method: "POST", bodyTemplate: {}, requiredVariables: [],
  successCriteria: {}, dependsOn: [], requiresVerificationGate: false,
};

/** Synthesize a single AncestorGroup from a flat variable-name list so PayloadField's
 *  {{token}} picker can be reused here — Baseline Templates has no ancestor-node graph,
 *  just a declared list of required variable names. */
function variablesToAncestorGroups(variables: string[]): AncestorGroup[] {
  if (variables.length === 0) return [];
  return [{
    nodeId: "template-variables",
    nodeName: "Template Variables",
    isStartNode: true,
    outputs: variables.map(v => ({ key: v, label: v })),
  }];
}

// ── Templates section ────────────────────────────────────────────────────────

function TemplatesSection({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<BaselineTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<BaselineTemplate> | null>(null);
  const [saving, setSaving] = useState(false);
  const [detailTab, setDetailTab] = useState<"details" | "testing">("details");
  const [bodyTemplateText, setBodyTemplateText] = useState("{}");
  const [successCriteriaText, setSuccessCriteriaText] = useState("{}");

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${API}/admin/baseline-templates`);
      const data = await res.json() as { templates: BaselineTemplate[] };
      setTemplates(data.templates ?? []);
    } catch {
      toast({ title: "Error", description: "Failed to load baseline templates", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  const openCreate = () => {
    setEditing({ ...EMPTY_TEMPLATE });
    setBodyTemplateText("{}");
    setSuccessCriteriaText("{}");
    setSelectedId(null);
    setDetailTab("details");
  };

  const openEdit = (t: BaselineTemplate) => {
    setEditing({ ...t });
    setBodyTemplateText(JSON.stringify(t.bodyTemplate ?? {}, null, 2));
    setSuccessCriteriaText(JSON.stringify(t.successCriteria ?? {}, null, 2));
    setSelectedId(t.templateId);
    setDetailTab("details");
  };

  const handleSave = async () => {
    if (!editing) return;
    let bodyTemplate: Record<string, unknown>;
    let successCriteria: Record<string, unknown>;
    try { bodyTemplate = JSON.parse(bodyTemplateText); } catch { toast({ title: "Invalid JSON", description: "Body template must be valid JSON", variant: "destructive" }); return; }
    try { successCriteria = JSON.parse(successCriteriaText); } catch { toast({ title: "Invalid JSON", description: "Success criteria must be valid JSON", variant: "destructive" }); return; }

    setSaving(true);
    try {
      const isEdit = Boolean(editing.id);
      const url = isEdit ? `${API}/admin/baseline-templates/${editing.templateId}` : `${API}/admin/baseline-templates`;
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetchWithAuth(url, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editing, bodyTemplate, successCriteria }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Save failed");
      }
      toast({ title: isEdit ? "Template updated" : "Template created" });
      const savedId = editing.templateId ?? null;
      await loadTemplates();
      setSelectedId(savedId);
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (t: BaselineTemplate) => {
    if (!confirm(`Archive "${t.label}"? It will be grandfathered into any config pack that already references it.`)) return;
    try {
      const res = await fetchWithAuth(`${API}/admin/baseline-templates/${t.templateId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Archive failed");
      toast({ title: "Template archived" });
      setEditing(null);
      setSelectedId(null);
      void loadTemplates();
    } catch {
      toast({ title: "Error", description: "Failed to archive template", variant: "destructive" });
    }
  };

  const filtered = useMemo(() => templates.filter(t => {
    if (!showArchived && t.status === "archived") return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return t.templateId.toLowerCase().includes(q) || t.label.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
  }), [templates, showArchived, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, BaselineTemplate[]>();
    for (const t of filtered) {
      if (!map.has(t.category)) map.set(t.category, []);
      map.get(t.category)!.push(t);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const updateField = <K extends keyof BaselineTemplate>(key: K, value: BaselineTemplate[K]) => {
    setEditing(prev => prev ? { ...prev, [key]: value } : prev);
  };

  const requiredVars = editing?.requiredVariables ?? [];
  const ancestorOutputs = variablesToAncestorGroups(requiredVars);
  const isNew = editing !== null && !editing.id;

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-[280px] min-w-[220px] flex flex-col border-r border-border bg-background overflow-hidden">
        <div className="p-3 border-b border-border space-y-2 shrink-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Baseline Templates</span>
            <span className="text-xs text-gray-500">{filtered.length}</span>
          </div>
          <Input
            placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
            className="h-7 text-xs bg-card border-border text-white placeholder:text-gray-600"
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} className="scale-75" />
            <span className="text-xs text-gray-400">Show archived</span>
          </label>
          <Button size="sm" onClick={openCreate} className="h-7 text-xs bg-primary hover:bg-[#006cbf] text-white w-full">
            + New Template
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
          ) : grouped.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-600 px-3">{search ? "No templates match" : "No templates yet"}</div>
          ) : grouped.map(([category, items]) => (
            <div key={category}>
              <div className="px-3 py-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-wider">{category}</div>
              {items.map(t => {
                const isSelected = selectedId === t.templateId && !isNew;
                const isArchived = t.status === "archived";
                const packs = t.packs ?? [];
                return (
                  <button
                    key={t.templateId}
                    onClick={() => openEdit(t)}
                    className={`w-full flex flex-col gap-1 pl-4 pr-3 py-1.5 text-left transition-colors border-l-2 ${
                      isSelected ? "bg-primary/10 border-l-primary" : "border-l-transparent hover:bg-card"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-xs flex-1 truncate ${isArchived ? "text-gray-600 italic" : "text-gray-300"}`}>{t.templateId}</span>
                      {t.requiresVerificationGate && <span className="text-[9px] text-amber-400 shrink-0" title="Requires verification gate">🔒</span>}
                    </div>
                    {packs.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {packs.map(p => (
                          <span key={p.packKey} className="inline-block px-1.5 py-0.5 rounded text-[9px] bg-primary/20 text-[#2E9EFF] border border-primary/30 whitespace-nowrap">
                            {p.packKey} · step {p.sortOrder + 1} of {p.totalInPack}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden bg-card">
        {editing === null ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 px-8">
            <div className="text-4xl text-gray-700">⬡</div>
            <p className="text-gray-500 text-sm">Select a template to edit</p>
            <p className="text-gray-600 text-xs">or click <strong className="text-gray-500">+ New Template</strong> to create one</p>
          </div>
        ) : (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="shrink-0 px-6 py-4 border-b border-border flex items-center gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  {editing.id ? <span className="font-mono text-primary">{editing.templateId}</span> : "New Baseline Template"}
                </h2>
                {editing.id && editing.label && <p className="text-xs text-gray-400 mt-0.5">{editing.label}</p>}
              </div>
              {editing.status === "archived" && <Badge variant="outline" className="border-gray-500/30 text-gray-400 text-xs ml-auto">archived</Badge>}
            </div>

            {editing.id && (
              <div className="shrink-0 flex border-b border-border">
                <button onClick={() => setDetailTab("details")}
                  className={`px-4 py-2 text-xs font-medium transition-colors ${detailTab === "details" ? "text-primary border-b-2 border-primary" : "text-gray-400 hover:text-white"}`}>
                  Details
                </button>
                <button onClick={() => setDetailTab("testing")}
                  className={`px-4 py-2 text-xs font-medium transition-colors ${detailTab === "testing" ? "text-primary border-b-2 border-primary" : "text-gray-400 hover:text-white"}`}>
                  Testing
                </button>
              </div>
            )}

            {detailTab === "details" || !editing.id ? (
              <>
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-gray-400 text-xs">Template ID *</Label>
                      <Input value={editing.templateId ?? ""} onChange={e => updateField("templateId", e.target.value)}
                        placeholder="entra:enforce-mfa" disabled={Boolean(editing.id)}
                        className="bg-background border-border text-white mt-1 font-mono text-sm" />
                    </div>
                    <div>
                      <Label className="text-gray-400 text-xs">Label *</Label>
                      <Input value={editing.label ?? ""} onChange={e => updateField("label", e.target.value)}
                        placeholder="Enforce MFA for all users" className="bg-background border-border text-white mt-1" />
                    </div>
                  </div>

                  <div>
                    <Label className="text-gray-400 text-xs">Description</Label>
                    <Input value={editing.description ?? ""} onChange={e => updateField("description", e.target.value)}
                      placeholder="What this baseline action configures" className="bg-background border-border text-white mt-1" />
                  </div>

                  <div>
                    <Label className="text-gray-400 text-xs">Category *</Label>
                    <Input value={editing.category ?? ""} onChange={e => updateField("category", e.target.value)}
                      placeholder="identity" className="bg-background border-border text-white mt-1 font-mono text-sm" />
                  </div>

                  <div>
                    <Label className="text-gray-400 text-xs">Required variables (comma-separated)</Label>
                    <Input
                      value={requiredVars.join(", ")}
                      onChange={e => updateField("requiredVariables", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                      placeholder="customerId, adminUpn" className="bg-background border-border text-white mt-1 font-mono text-sm" />
                    <p className="text-[10px] text-gray-500 mt-1">Declared here so they appear in the {"{{"} variables {"}}"} picker below.</p>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <PayloadField
                        label="Graph API Endpoint *"
                        value={editing.endpoint ?? ""}
                        onChange={v => updateField("endpoint", v)}
                        placeholder="/users/{{adminUpn}}"
                        ancestorOutputs={ancestorOutputs}
                        hint="The Microsoft Graph endpoint this template writes to. Supports {{variable}} placeholders resolved from requiredVariables at execution time."
                      />
                    </div>
                    <div>
                      <Label className="text-gray-400 text-xs">Method</Label>
                      <Select value={editing.method ?? "POST"} onValueChange={v => updateField("method", v as BaselineTemplate["method"])}>
                        <SelectTrigger className="bg-background border-border text-white mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="POST">POST</SelectItem>
                          <SelectItem value="PATCH">PATCH</SelectItem>
                          <SelectItem value="PUT">PUT</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <PayloadField
                    label="Body template (JSON)"
                    value={bodyTemplateText}
                    onChange={setBodyTemplateText}
                    multiline
                    ancestorOutputs={ancestorOutputs}
                    placeholder='{"accountEnabled": true, "userPrincipalName": "{{adminUpn}}"}'
                    hint="JSON body sent to the Graph endpoint. {{variable}} placeholders are resolved against the values supplied at execution time."
                  />

                  <div>
                    <Label className="text-gray-400 text-xs">Success criteria (JSON — optional)</Label>
                    <Textarea value={successCriteriaText} onChange={e => setSuccessCriteriaText(e.target.value)} rows={3}
                      className="bg-background border-border text-white mt-1 font-mono text-xs" placeholder='{"expectStatus": 204}' />
                  </div>

                  <div>
                    <Label className="text-gray-400 text-xs">Depends on (other template IDs, comma-separated)</Label>
                    <Input
                      value={(editing.dependsOn ?? []).join(", ")}
                      onChange={e => updateField("dependsOn", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                      placeholder="entra:create-admin-account" className="bg-background border-border text-white mt-1 font-mono text-sm" />
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <Switch checked={editing.requiresVerificationGate ?? false} onCheckedChange={v => updateField("requiresVerificationGate", v)} />
                    <span className="text-sm text-gray-300">Requires verification gate before execution</span>
                  </label>
                </div>

                <div className="shrink-0 px-6 py-4 border-t border-border flex items-center justify-between gap-3">
                  <div>
                    {editing.id && editing.status === "active" && (
                      <Button variant="ghost" size="sm" onClick={() => handleArchive(editing as BaselineTemplate)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-400/10">Archive</Button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(null); setSelectedId(null); }} className="text-gray-400 hover:text-white">Cancel</Button>
                    <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-[#006cbf] text-white">
                      {saving ? "Saving…" : "Save Template"}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <TestingTab template={editing as BaselineTemplate} fetchWithAuth={fetchWithAuth} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TestingTab({ template, fetchWithAuth }: { template: BaselineTemplate; fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const { toast } = useToast();
  const [customers, setCustomers] = useState<TestbedCustomer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [customerId, setCustomerId] = useState<string>("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  useEffect(() => {
    setLoadingCustomers(true);
    fetchWithAuth(`${API}/admin/baseline-templates/testbed-customers`)
      .then(r => r.json())
      .then((d: { customers: TestbedCustomer[] }) => setCustomers(d.customers ?? []))
      .catch(() => toast({ title: "Error", description: "Failed to load testbed customers", variant: "destructive" }))
      .finally(() => setLoadingCustomers(false));
  }, [fetchWithAuth, toast]);

  useEffect(() => {
    setResult(null);
    setVariables(Object.fromEntries(template.requiredVariables.map(v => [v, ""])));
  }, [template.templateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const runTest = async () => {
    if (!customerId) { toast({ title: "Select a test tenant first", variant: "destructive" }); return; }
    setRunning(true);
    setResult(null);
    try {
      const res = await fetchWithAuth(`${API}/admin/baseline-templates/${template.templateId}/test`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: Number(customerId), variables }),
      });
      const data = await res.json() as { result?: TestResult; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Test failed");
      setResult(data.result ?? null);
      toast({ title: data.result?.success ? "Test succeeded" : "Test returned an error", variant: data.result?.success ? "default" : "destructive" });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Test failed", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <p className="text-xs font-bold text-amber-400 uppercase tracking-wide">⚠ Runs for real against a connected test tenant — not a dry run</p>
        <p className="text-xs text-amber-300/80 mt-1">This makes an actual {template.method} request to {template.endpoint || "the configured endpoint"} against the selected tenant. Only testbed-flagged customers are selectable.</p>
      </div>

      <div>
        <Label className="text-gray-400 text-xs">Test tenant (testbed customers only)</Label>
        {loadingCustomers ? (
          <div className="text-xs text-gray-500 mt-2">Loading testbed customers…</div>
        ) : customers.length === 0 ? (
          <div className="text-xs text-gray-500 mt-2">No testbed customers configured. Flag a customer as testbed to enable real-execution testing.</div>
        ) : (
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger className="bg-background border-border text-white mt-1"><SelectValue placeholder="Select a testbed customer…" /></SelectTrigger>
            <SelectContent className="bg-card border-border">
              {customers.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {template.requiredVariables.length > 0 && (
        <div className="space-y-2">
          <Label className="text-gray-400 text-xs">Variable values</Label>
          {template.requiredVariables.map(v => (
            <div key={v} className="flex items-center gap-2">
              <span className="font-mono text-xs text-[#2E9EFF] w-40 shrink-0 truncate">{`{{${v}}}`}</span>
              <Input value={variables[v] ?? ""} onChange={e => setVariables(prev => ({ ...prev, [v]: e.target.value }))}
                className="bg-background border-border text-white text-xs font-mono" />
            </div>
          ))}
        </div>
      )}

      <Button onClick={runTest} disabled={running || !customerId} className="bg-amber-600 hover:bg-amber-700 text-white">
        {running ? "Running…" : "Run Test (real execution)"}
      </Button>

      {result && (
        <div className={`rounded-lg border px-4 py-3 space-y-2 ${result.success ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={result.success ? "border-emerald-500/30 text-emerald-400" : "border-red-500/30 text-red-400"}>
              {result.success ? "success" : "failed"}
            </Badge>
            <span className="text-xs text-gray-400">status {result.status}{result.errorType ? ` · ${result.errorType}` : ""}</span>
          </div>
          {result.missingVariables && result.missingVariables.length > 0 && (
            <p className="text-xs text-red-400">Missing variables: {result.missingVariables.join(", ")}</p>
          )}
          <pre className="text-[10px] text-gray-300 font-mono bg-background rounded p-2 overflow-x-auto max-h-48">{JSON.stringify(result.data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

// ── Config Packs section ─────────────────────────────────────────────────────

interface SortableTemplateLinkProps {
  link: ConfigPackTemplateLink;
  allLinks: ConfigPackTemplateLink[];
  onToggleDepends: (templateId: string, dependsOnId: string) => void;
  onRemove: (templateId: string) => void;
}

function SortableTemplateLink({ link, allLinks, onToggleDepends, onRemove }: SortableTemplateLinkProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: link.templateId });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const others = allLinks.filter(l => l.templateId !== link.templateId);
  const dependsOn = link.dependsOnOverride ?? link.template?.dependsOn ?? [];

  return (
    <div ref={setNodeRef} style={style} className="border-b border-accent bg-background">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div {...attributes} {...listeners} className="flex-shrink-0 text-muted-foreground/60 cursor-grab active:cursor-grabbing">
          <GripVertical className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-mono text-xs text-primary">{link.templateId}</span>
          {link.template && <span className="text-xs text-gray-300 ml-2">{link.template.label}</span>}
        </div>
        <button type="button" onClick={() => onRemove(link.templateId)} className="text-xs text-red-400 hover:text-red-300 shrink-0">Remove</button>
      </div>
      {others.length > 0 && (
        <div className="px-3 pb-2 pl-9">
          <p className="text-[10px] text-gray-500 mb-1">Depends on (within this pack):</p>
          <div className="flex flex-wrap gap-1.5">
            {others.map(o => (
              <button key={o.templateId} type="button" onClick={() => onToggleDepends(link.templateId, o.templateId)}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                  dependsOn.includes(o.templateId)
                    ? "border-primary/40 bg-primary/15 text-[#2E9EFF]"
                    : "border-border text-gray-500 hover:text-gray-300"
                }`}>
                {o.templateId}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigPacksSection({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const { toast } = useToast();
  const [packs, setPacks] = useState<ConfigPack[]>([]);
  const [allTemplates, setAllTemplates] = useState<BaselineTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editingPack, setEditingPack] = useState<Partial<ConfigPack> | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedPackKey, setSelectedPackKey] = useState<string | null>(null);
  const [packLinks, setPackLinks] = useState<ConfigPackTemplateLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [addTemplateId, setAddTemplateId] = useState<string>("");

  const loadPacks = useCallback(async () => {
    setLoading(true);
    try {
      const [packRes, tplRes] = await Promise.all([
        fetchWithAuth(`${API}/admin/config-packs`),
        fetchWithAuth(`${API}/admin/baseline-templates`),
      ]);
      const packData = await packRes.json() as { packs: ConfigPack[] };
      const tplData = await tplRes.json() as { templates: BaselineTemplate[] };
      setPacks(packData.packs ?? []);
      setAllTemplates(tplData.templates ?? []);
    } catch {
      toast({ title: "Error", description: "Failed to load config packs", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => { void loadPacks(); }, [loadPacks]);

  const loadLinks = useCallback(async (packKey: string) => {
    setLoadingLinks(true);
    try {
      const res = await fetchWithAuth(`${API}/admin/config-packs/${packKey}`);
      const data = await res.json() as { templates: ConfigPackTemplateLink[] };
      setPackLinks((data.templates ?? []).sort((a, b) => a.sortOrder - b.sortOrder));
    } catch {
      toast({ title: "Error", description: "Failed to load pack templates", variant: "destructive" });
    } finally {
      setLoadingLinks(false);
    }
  }, [fetchWithAuth, toast]);

  const selectPack = (packKey: string) => {
    setSelectedPackKey(packKey);
    void loadLinks(packKey);
  };

  const persistOrder = async (nextLinks: ConfigPackTemplateLink[]) => {
    if (!selectedPackKey) return;
    try {
      const res = await fetchWithAuth(`${API}/admin/config-packs/${selectedPackKey}/templates/order`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templates: nextLinks.map((l, i) => ({ templateId: l.templateId, sortOrder: i, dependsOnOverride: l.dependsOnOverride })),
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
    } catch {
      toast({ title: "Error", description: "Failed to save template order", variant: "destructive" });
      if (selectedPackKey) void loadLinks(selectedPackKey);
    }
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = packLinks.findIndex(l => l.templateId === active.id);
    const newIdx = packLinks.findIndex(l => l.templateId === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const next = arrayMove(packLinks, oldIdx, newIdx).map((l, i) => ({ ...l, sortOrder: i }));
    setPackLinks(next);
    void persistOrder(next);
  }

  const handleToggleDepends = (templateId: string, dependsOnId: string) => {
    const next = packLinks.map(l => {
      if (l.templateId !== templateId) return l;
      const current = l.dependsOnOverride ?? l.template?.dependsOn ?? [];
      const nextDeps = current.includes(dependsOnId) ? current.filter(d => d !== dependsOnId) : [...current, dependsOnId];
      return { ...l, dependsOnOverride: nextDeps };
    });
    setPackLinks(next);
    void persistOrder(next);
  };

  const handleRemoveTemplate = (templateId: string) => {
    const next = packLinks.filter(l => l.templateId !== templateId).map((l, i) => ({ ...l, sortOrder: i }));
    setPackLinks(next);
    void persistOrder(next);
  };

  const handleAddTemplate = () => {
    if (!addTemplateId) return;
    const template = allTemplates.find(t => t.templateId === addTemplateId);
    const next = [...packLinks, { id: -Date.now(), packId: 0, templateId: addTemplateId, sortOrder: packLinks.length, dependsOnOverride: null, template }];
    setPackLinks(next);
    setAddTemplateId("");
    void persistOrder(next);
  };

  const openCreate = () => { setEditingPack({ packKey: "", label: "", description: "", categories: [] }); setShowDialog(true); };
  const openEditPack = (p: ConfigPack) => { setEditingPack({ ...p }); setShowDialog(true); };

  const handleSavePack = async () => {
    if (!editingPack) return;
    setSaving(true);
    try {
      const isEdit = Boolean(editingPack.id);
      const url = isEdit ? `${API}/admin/config-packs/${editingPack.packKey}` : `${API}/admin/config-packs`;
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetchWithAuth(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(editingPack) });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Save failed");
      }
      toast({ title: isEdit ? "Pack updated" : "Pack created" });
      setShowDialog(false);
      void loadPacks();
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleArchivePack = async (p: ConfigPack) => {
    if (!confirm(`Archive pack "${p.label}"?`)) return;
    try {
      await fetchWithAuth(`${API}/admin/config-packs/${p.packKey}`, { method: "DELETE" });
      toast({ title: "Pack archived" });
      if (selectedPackKey === p.packKey) setSelectedPackKey(null);
      void loadPacks();
    } catch {
      toast({ title: "Error", description: "Failed to archive pack", variant: "destructive" });
    }
  };

  const filtered = packs.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.packKey.toLowerCase().includes(q) || p.label.toLowerCase().includes(q);
  });

  const availableToAdd = allTemplates.filter(t => t.status === "active" && !packLinks.some(l => l.templateId === t.templateId));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Config Packs</h2>
          <p className="text-sm text-gray-400 mt-1">Ordered groups of Baseline Action Templates, with per-pack dependency overrides</p>
        </div>
        <Button onClick={openCreate} className="bg-primary hover:bg-[#006cbf] text-white">+ New Pack</Button>
      </div>

      <Input placeholder="Search packs…" value={search} onChange={e => setSearch(e.target.value)}
        className="max-w-sm bg-card border-border text-white" />

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-3">
          {filtered.length === 0 && <div className="text-center py-12 text-gray-500">No config packs yet — create the first one</div>}
          {filtered.map(pack => (
            <div key={pack.packKey} className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm text-primary">{pack.packKey}</span>
                    <Badge variant="outline" className={pack.status === "active" ? "border-green-500/30 text-green-400" : "border-gray-500/30 text-gray-400"}>{pack.status}</Badge>
                  </div>
                  <div className="mt-1 text-sm text-white font-medium">{pack.label}</div>
                  {pack.description && <div className="text-xs text-gray-400 mt-0.5">{pack.description}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => selectPack(pack.packKey)} className="text-gray-400 hover:text-white h-8 text-xs">
                    {selectedPackKey === pack.packKey ? "▲ Templates" : "▼ Templates"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openEditPack(pack)} className="text-gray-400 hover:text-white h-8">Edit</Button>
                  {pack.status === "active" && (
                    <Button size="sm" variant="ghost" onClick={() => handleArchivePack(pack)} className="text-red-400 hover:text-red-300 h-8">Archive</Button>
                  )}
                </div>
              </div>

              {selectedPackKey === pack.packKey && (
                <div className="border-t border-border bg-background">
                  {loadingLinks ? (
                    <div className="p-4 text-sm text-gray-500">Loading…</div>
                  ) : (
                    <>
                      {packLinks.length === 0 ? (
                        <p className="text-sm text-gray-500 px-4 py-3">No templates in this pack yet.</p>
                      ) : (
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                          <SortableContext items={packLinks.map(l => l.templateId)} strategy={verticalListSortingStrategy}>
                            {packLinks.map(link => (
                              <SortableTemplateLink key={link.templateId} link={link} allLinks={packLinks}
                                onToggleDepends={handleToggleDepends} onRemove={handleRemoveTemplate} />
                            ))}
                          </SortableContext>
                        </DndContext>
                      )}
                      <div className="p-3 flex items-center gap-2 border-t border-accent">
                        <Select value={addTemplateId} onValueChange={setAddTemplateId}>
                          <SelectTrigger className="bg-card border-border text-white text-xs h-8 flex-1">
                            <SelectValue placeholder="Add a template…" />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border">
                            {availableToAdd.map(t => <SelectItem key={t.templateId} value={t.templateId}>{t.templateId} — {t.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button size="sm" onClick={handleAddTemplate} disabled={!addTemplateId} className="bg-primary hover:bg-[#006cbf] text-white h-8 text-xs">Add</Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-card border-border text-white max-w-lg">
          <DialogHeader><DialogTitle>{editingPack?.id ? "Edit Pack" : "New Config Pack"}</DialogTitle></DialogHeader>
          {editingPack && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-gray-400 text-xs">Pack Key *</Label>
                  <Input value={editingPack.packKey ?? ""} onChange={e => setEditingPack(p => p ? { ...p, packKey: e.target.value } : p)}
                    placeholder="m365-security-baseline" disabled={Boolean(editingPack.id)} className="bg-background border-border text-white mt-1 font-mono text-sm" />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">Label *</Label>
                  <Input value={editingPack.label ?? ""} onChange={e => setEditingPack(p => p ? { ...p, label: e.target.value } : p)}
                    placeholder="M365 Security Baseline" className="bg-background border-border text-white mt-1" />
                </div>
              </div>
              <div>
                <Label className="text-gray-400 text-xs">Description</Label>
                <Textarea value={editingPack.description ?? ""} onChange={e => setEditingPack(p => p ? { ...p, description: e.target.value } : p)}
                  rows={2} className="bg-background border-border text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-400 text-xs">Categories (comma-separated)</Label>
                <Input value={(editingPack.categories ?? []).join(", ")}
                  onChange={e => setEditingPack(p => p ? { ...p, categories: e.target.value.split(",").map(s => s.trim()).filter(Boolean) } : p)}
                  placeholder="identity, compliance" className="bg-background border-border text-white mt-1 font-mono text-sm" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDialog(false)} className="text-gray-400">Cancel</Button>
            <Button onClick={handleSavePack} disabled={saving} className="bg-primary hover:bg-[#006cbf] text-white">{saving ? "Saving…" : "Save Pack"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Audit Log section ────────────────────────────────────────────────────────

function AuditLogSection({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const { toast } = useToast();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    setLoading(true);
    fetchWithAuth(`${API}/admin/baseline-templates/audit-log?limit=200`)
      .then(r => r.json())
      .then((d: { logs: AuditLogEntry[] }) => setLogs(d.logs ?? []))
      .catch(() => toast({ title: "Error", description: "Failed to load audit log", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [fetchWithAuth, toast]);

  const toggle = (id: number) => setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const actionColor = (action: string) => {
    if (action === "create") return "border-green-500/30 text-green-400";
    if (action === "archive") return "border-gray-500/30 text-gray-400";
    if (action === "executed") return "border-emerald-500/30 text-emerald-400";
    if (action === "failed") return "border-red-500/30 text-red-400";
    return "border-blue-500/30 text-blue-400";
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-white">Baseline Template Audit Log</h2>
        <p className="text-sm text-gray-400 mt-1">Every create/update/archive and every real Testing/execution attempt</p>
      </div>
      {loading ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No audit log entries yet</div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden divide-y divide-accent">
          {logs.map(log => (
            <div key={log.id} className="bg-card">
              <button onClick={() => toggle(log.id)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-accent">
                <Badge variant="outline" className={actionColor(log.action)}>{log.action}</Badge>
                <span className="font-mono text-xs text-primary">{log.templateId ?? "—"}</span>
                <span className="text-xs text-gray-500">admin #{log.adminId ?? "system"}</span>
                <span className="text-xs text-gray-600 ml-auto shrink-0">{new Date(log.createdAt).toLocaleString()}</span>
              </button>
              {expanded.has(log.id) && (
                <div className="px-4 pb-3 grid grid-cols-2 gap-3">
                  {log.beforeSnapshot && (
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase mb-1">Before</p>
                      <pre className="text-[10px] text-gray-300 font-mono bg-background rounded p-2 overflow-x-auto max-h-40">{JSON.stringify(log.beforeSnapshot, null, 2)}</pre>
                    </div>
                  )}
                  {log.afterSnapshot && (
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase mb-1">After</p>
                      <pre className="text-[10px] text-gray-300 font-mono bg-background rounded p-2 overflow-x-auto max-h-40">{JSON.stringify(log.afterSnapshot, null, 2)}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section routing (URL-driven; chrome is provided by the global IDE shell) ──

const RENDERABLE_SECTIONS = ["templates", "config-packs", "audit-log"] as const;
const VALID_TABS = new Set<string>(RENDERABLE_SECTIONS);
const BT_PATH = "/delivery/baseline-templates";

function getTabFromSearch(): string {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("tab") ?? "";
  return VALID_TABS.has(raw) ? raw : "templates";
}

export default function BaselineTemplatesPage() {
  const { fetchWithAuth } = useAuth();
  const [location] = useLocation();
  const search = useSearch();

  const [activeTab, setActiveTab] = useState<string>(() => getTabFromSearch());

  // Sections stay mounted once visited so their state persists (shown/hidden
  // with CSS), matching the old IDEShell tab behavior.
  const [mounted, setMounted] = useState<Set<string>>(() => new Set([getTabFromSearch()]));

  // Sync with the URL (?tab=) — Explorer-tree clicks, deep links, and browser
  // back/forward. Only while this page owns the location: the component stays
  // mounted in a hidden shell tab while other routes are active.
  useEffect(() => {
    if (location !== BT_PATH) return;
    const tab = getTabFromSearch();
    setActiveTab(tab);
    setMounted(prev => (prev.has(tab) ? prev : new Set([...prev, tab])));
  }, [location, search]);

  return (
    <div className="h-full overflow-hidden relative">
      {RENDERABLE_SECTIONS.map(sectionId => {
        if (!mounted.has(sectionId)) return null;
        const isVisible = activeTab === sectionId;
        return (
          <div key={sectionId} className="absolute inset-0 overflow-hidden" style={{ display: isVisible ? undefined : "none" }}>
            {sectionId === "templates" && <TemplatesSection fetchWithAuth={fetchWithAuth} />}
            {sectionId === "config-packs" && <div className="h-full overflow-y-auto"><ConfigPacksSection fetchWithAuth={fetchWithAuth} /></div>}
            {sectionId === "audit-log" && <div className="h-full overflow-y-auto"><AuditLogSection fetchWithAuth={fetchWithAuth} /></div>}
          </div>
        );
      })}
    </div>
  );
}
