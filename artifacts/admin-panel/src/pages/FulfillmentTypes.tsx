import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Pencil, Trash2, Loader2, RefreshCw, Zap, Play,
  CheckCircle2, XCircle, RotateCcw,
} from "lucide-react";

const FIRED_WHEN_OPTIONS = ["purchase", "signal", "manual"] as const;
type FiredWhen = (typeof FIRED_WHEN_OPTIONS)[number];

interface FulfillmentType {
  key: string;
  label: string;
  description: string | null;
  firedWhen: FiredWhen[];
  recurring: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const BLANK: Omit<FulfillmentType, "createdAt" | "updatedAt"> = {
  key: "",
  label: "",
  description: "",
  firedWhen: [],
  recurring: false,
  isActive: true,
};

const PRESET_TYPES: Omit<FulfillmentType, "createdAt" | "updatedAt">[] = [
  { key: "assessment", label: "Assessment", description: "One-time M365 health/readiness assessment", firedWhen: ["purchase", "signal"], recurring: false, isActive: true },
  { key: "bundle_subscription", label: "Bundle Subscription", description: "Recurring bundle of services billed monthly", firedWhen: ["purchase"], recurring: true, isActive: true },
  { key: "retainer", label: "Retainer", description: "Monthly retainer engagement", firedWhen: ["purchase"], recurring: true, isActive: true },
  { key: "msp_monthly_subscription", label: "MSP Monthly Subscription", description: "Managed service provider monthly subscription", firedWhen: ["purchase"], recurring: true, isActive: true },
];

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

export default function FulfillmentTypes() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [rows, setRows] = useState<FulfillmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FulfillmentType | null>(null);
  const [form, setForm] = useState({ ...BLANK });

  const [resolveModal, setResolveModal] = useState(false);
  const [resolveKey, setResolveKey] = useState("");
  const [resolvePayload, setResolvePayload] = useState("{}");
  const [resolving, setResolving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<FulfillmentType | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/fulfillment-types");
      const data = await res.json() as FulfillmentType[];
      setRows(data);
    } catch {
      toast({ title: "Failed to load fulfillment types", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => { void load(); }, [load]);

  function openCreate(preset?: Omit<FulfillmentType, "createdAt" | "updatedAt">) {
    setEditing(null);
    setForm(preset ? { ...preset } : { ...BLANK });
    setShowForm(true);
  }

  function openEdit(row: FulfillmentType) {
    setEditing(row);
    setForm({
      key: row.key,
      label: row.label,
      description: row.description ?? "",
      firedWhen: row.firedWhen,
      recurring: row.recurring,
      isActive: row.isActive,
    });
    setShowForm(true);
  }

  function toggleFiredWhen(v: FiredWhen) {
    setForm((f) => ({
      ...f,
      firedWhen: f.firedWhen.includes(v)
        ? f.firedWhen.filter((x) => x !== v)
        : [...f.firedWhen, v],
    }));
  }

  async function save() {
    if (!form.key.trim() || !form.label.trim()) {
      toast({ title: "Key and Label are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const url = editing
        ? `/api/admin/fulfillment-types/${encodeURIComponent(editing.key)}`
        : "/api/admin/fulfillment-types";
      const method = editing ? "PUT" : "POST";
      const body = editing
        ? { label: form.label, description: form.description, firedWhen: form.firedWhen, recurring: form.recurring, isActive: form.isActive }
        : form;

      const res = await fetchWithAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Save failed");
      }
      toast({ title: editing ? "Fulfillment type updated" : "Fulfillment type created" });
      setShowForm(false);
      setEditing(null);
      void load();
    } catch (err: unknown) {
      const e = err as Error;
      toast({ title: e.message ?? "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(
        `/api/admin/fulfillment-types/${encodeURIComponent(deleteTarget.key)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Delete failed");
      toast({ title: `Deleted "${deleteTarget.label}"` });
      setDeleteTarget(null);
      void load();
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  async function manualResolve() {
    if (!resolveKey) {
      toast({ title: "Select a fulfillment type key", variant: "destructive" });
      return;
    }
    let parsedPayload: Record<string, unknown> = {};
    try {
      parsedPayload = JSON.parse(resolvePayload) as Record<string, unknown>;
    } catch {
      toast({ title: "Payload must be valid JSON", variant: "destructive" });
      return;
    }
    setResolving(true);
    try {
      const res = await fetchWithAuth("/api/admin/fulfillment-types/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fulfillmentTypeKey: resolveKey, payload: parsedPayload }),
      });
      const result = await res.json() as { status: string; eventName?: string };
      if (result.status === "emitted") {
        toast({ title: `Event emitted: ${result.eventName}` });
      } else if (result.status === "duplicate") {
        toast({ title: "Idempotency hit — already emitted (duplicate)", variant: "default" });
      } else {
        toast({ title: `Status: ${result.status}`, variant: "destructive" });
      }
      setResolveModal(false);
      setResolveKey("");
      setResolvePayload("{}");
    } catch {
      toast({ title: "Resolve failed", variant: "destructive" });
    } finally {
      setResolving(false);
    }
  }

  const noneExist = !loading && rows.length === 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#E6EDF3]">Fulfillment Types</h1>
          <p className="text-sm text-[#8B949E] mt-1">
            Registry of lifecycle kinds — each maps to a{" "}
            <code className="text-xs bg-[#21262D] px-1 py-0.5 rounded">fulfillment.&lt;key&gt;</code>{" "}
            workflow event trigger.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setResolveModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-[#21262D] border border-[#30363D] text-[#E6EDF3] hover:bg-[#30363D] transition-colors"
          >
            <Play className="w-3.5 h-3.5" /> Test Resolve
          </button>
          <button
            onClick={() => void load()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-[#21262D] border border-[#30363D] text-[#E6EDF3] hover:bg-[#30363D] transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => openCreate()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-[#0078D4] text-white hover:bg-[#106EBE] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Type
          </button>
        </div>
      </div>

      {/* Seed presets banner when table is empty */}
      {noneExist && (
        <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-4 space-y-3">
          <p className="text-sm text-[#8B949E]">
            No fulfillment types yet. Seed the four standard types to get started:
          </p>
          <div className="flex flex-wrap gap-2">
            {PRESET_TYPES.map((p) => (
              <button
                key={p.key}
                onClick={() => openCreate(p)}
                className="text-xs px-3 py-1.5 rounded border border-[#30363D] bg-[#21262D] text-[#E6EDF3] hover:bg-[#30363D] transition-colors"
              >
                + {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[#8B949E]" />
        </div>
      ) : rows.length > 0 ? (
        <div className="bg-[#161B22] border border-[#30363D] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#30363D] text-[#8B949E] text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3 font-medium">Key / Label</th>
                <th className="text-left px-4 py-3 font-medium">Fired When</th>
                <th className="text-left px-4 py-3 font-medium">Billing</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.key}
                  className={`border-b border-[#21262D] ${i % 2 === 0 ? "" : "bg-[#0D1117]/40"}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-mono text-[#0078D4] text-xs">{row.key}</div>
                    <div className="text-[#E6EDF3] font-medium mt-0.5">{row.label}</div>
                    {row.description && (
                      <div className="text-[#8B949E] text-xs mt-0.5 line-clamp-1">{row.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {row.firedWhen.length === 0 ? (
                        <span className="text-[#6E7681] text-xs italic">none</span>
                      ) : (
                        row.firedWhen.map((w) => (
                          <Badge
                            key={w}
                            label={w}
                            color={
                              w === "purchase"
                                ? "bg-[#1F4E79] text-[#60CDFF]"
                                : w === "signal"
                                ? "bg-[#1B4332] text-[#56D364]"
                                : "bg-[#3D1F3D] text-[#BC8CFF]"
                            }
                          />
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {row.recurring ? (
                      <Badge label="Recurring" color="bg-[#2D1F4E] text-[#9A7FE8]" />
                    ) : (
                      <Badge label="One-time" color="bg-[#21262D] text-[#8B949E]" />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.isActive ? (
                      <span className="flex items-center gap-1 text-[#56D364] text-xs">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[#8B949E] text-xs">
                        <XCircle className="w-3.5 h-3.5" /> Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => { setResolveKey(row.key); setResolveModal(true); }}
                        title="Test resolve"
                        className="p-1.5 rounded hover:bg-[#21262D] text-[#8B949E] hover:text-[#E6EDF3] transition-colors"
                      >
                        <Zap className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => openEdit(row)}
                        title="Edit"
                        className="p-1.5 rounded hover:bg-[#21262D] text-[#8B949E] hover:text-[#E6EDF3] transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(row)}
                        title="Delete"
                        className="p-1.5 rounded hover:bg-[#21262D] text-[#F85149] hover:text-[#FF7B72] transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Event convention hint */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-4 text-sm text-[#8B949E] space-y-1.5">
        <div className="flex items-center gap-2 text-[#E6EDF3] font-medium text-xs uppercase tracking-wide mb-2">
          <Zap className="w-3.5 h-3.5 text-[#0078D4]" /> Workflow Event Convention
        </div>
        <p>
          Each fulfillment type emits a{" "}
          <code className="text-xs bg-[#21262D] px-1 py-0.5 rounded text-[#60CDFF]">
            fulfillment.&lt;key&gt;
          </code>{" "}
          event on the canonical workflow event bus.
        </p>
        <p>
          To handle a type, open{" "}
          <strong className="text-[#E6EDF3]">Workflows → New Definition</strong>, set the
          trigger type to <em>Event</em>, and enter the event name — for example{" "}
          <code className="text-xs bg-[#21262D] px-1 py-0.5 rounded text-[#60CDFF]">
            fulfillment.assessment
          </code>. The workflow receives the full fulfillment payload as its start payload.
        </p>
        <p>
          Idempotency is guaranteed: the same Stripe session ID or signal-fire key never
          emits twice, even if the webhook retries.
        </p>
      </div>

      {/* Create / Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#161B22] border border-[#30363D] rounded-lg w-full max-w-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold text-[#E6EDF3]">
              {editing ? "Edit Fulfillment Type" : "New Fulfillment Type"}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#8B949E] mb-1">
                  Key <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  disabled={!!editing}
                  value={form.key}
                  onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") }))}
                  placeholder="e.g. assessment"
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#6E7681] disabled:opacity-50 font-mono"
                />
                <p className="text-xs text-[#6E7681] mt-1">Lowercase letters, digits, underscores. Becomes <code>fulfillment.{form.key || "…"}</code></p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#8B949E] mb-1">
                  Label <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="Human-readable name"
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#6E7681]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#8B949E] mb-1">Description</label>
                <textarea
                  value={form.description ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#6E7681] resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#8B949E] mb-2">Fired When</label>
                <div className="flex gap-3">
                  {FIRED_WHEN_OPTIONS.map((opt) => (
                    <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.firedWhen.includes(opt)}
                        onChange={() => toggleFiredWhen(opt)}
                        className="accent-[#0078D4]"
                      />
                      <span className="text-sm text-[#E6EDF3] capitalize">{opt}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.recurring}
                    onChange={(e) => setForm((f) => ({ ...f, recurring: e.target.checked }))}
                    className="accent-[#0078D4]"
                  />
                  <span className="text-sm text-[#E6EDF3]">Recurring billing</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                    className="accent-[#0078D4]"
                  />
                  <span className="text-sm text-[#E6EDF3]">Active</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { setShowForm(false); setEditing(null); }}
                className="px-4 py-2 rounded text-sm bg-[#21262D] text-[#E6EDF3] hover:bg-[#30363D] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void save()}
                disabled={saving}
                className="px-4 py-2 rounded text-sm bg-[#0078D4] text-white hover:bg-[#106EBE] disabled:opacity-60 transition-colors flex items-center gap-1.5"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {editing ? "Save Changes" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Test Resolve Modal */}
      {resolveModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#161B22] border border-[#30363D] rounded-lg w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-semibold text-[#E6EDF3] flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#0078D4]" /> Test Resolve Fulfillment
            </h2>
            <p className="text-sm text-[#8B949E]">
              Manually trigger <code className="text-xs bg-[#21262D] px-1 rounded text-[#60CDFF]">resolve_fulfillment</code> with a fresh idempotency key.
              Any subscribed workflow definitions will fire.
            </p>

            <div>
              <label className="block text-xs font-medium text-[#8B949E] mb-1">Fulfillment Type</label>
              <select
                value={resolveKey}
                onChange={(e) => setResolveKey(e.target.value)}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded px-3 py-2 text-sm text-[#E6EDF3]"
              >
                <option value="">— select —</option>
                {rows.filter((r) => r.isActive).map((r) => (
                  <option key={r.key} value={r.key}>{r.label} ({r.key})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8B949E] mb-1">Payload (JSON)</label>
              <textarea
                value={resolvePayload}
                onChange={(e) => setResolvePayload(e.target.value)}
                rows={4}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded px-3 py-2 text-xs text-[#E6EDF3] font-mono resize-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => { setResolveModal(false); setResolveKey(""); setResolvePayload("{}"); }}
                className="px-4 py-2 rounded text-sm bg-[#21262D] text-[#E6EDF3] hover:bg-[#30363D] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void manualResolve()}
                disabled={resolving || !resolveKey}
                className="px-4 py-2 rounded text-sm bg-[#0078D4] text-white hover:bg-[#106EBE] disabled:opacity-60 transition-colors flex items-center gap-1.5"
              >
                {resolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Fire Event
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#161B22] border border-[#30363D] rounded-lg w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold text-[#E6EDF3]">Delete Fulfillment Type</h2>
            <p className="text-sm text-[#8B949E]">
              Are you sure you want to delete <strong className="text-[#E6EDF3]">{deleteTarget.label}</strong>?
              Any services referencing key <code className="text-xs bg-[#21262D] px-1 rounded">{deleteTarget.key}</code> will
              lose their fulfillment type link. This action is not reversible.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded text-sm bg-[#21262D] text-[#E6EDF3] hover:bg-[#30363D] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void doDelete()}
                disabled={deleting}
                className="px-4 py-2 rounded text-sm bg-[#F85149] text-white hover:bg-[#DA3633] disabled:opacity-60 transition-colors flex items-center gap-1.5"
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
