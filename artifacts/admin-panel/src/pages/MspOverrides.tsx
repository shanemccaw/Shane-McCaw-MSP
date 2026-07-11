/**
 * MspOverrides — PlatformAdmin page for per-MSP ad hoc feature flag overrides.
 */

import { useState, useEffect, useCallback } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, RefreshCw, Shield, Trash2 } from "lucide-react";

interface Msp {
  id: number;
  name: string;
  slug: string;
}

interface Override {
  id: number;
  mspId: number;
  featureFlags: Record<string, boolean>;
  tenantAllowanceOverride: number | null;
  aiCreditAllowanceOverride: number | null;
  reason: string;
  expiresAt: string | null;
  createdAt: string;
}

const COMMON_FLAGS = [
  "advanced_signals",
  "custom_workflows",
  "sla_scope_creep_custom_rules",
  "white_label_branding",
  "exchange_online",
  "unlimited_tenants",
];

export default function MspOverridesPage() {
  const { adminFetch } = useAdminFetch();
  const [msps, setMsps] = useState<Msp[]>([]);
  const [selectedMsp, setSelectedMsp] = useState<Msp | null>(null);
  const [override, setOverride] = useState<Override | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<{
    featureFlags: Record<string, boolean>;
    tenantAllowanceOverride: string;
    aiCreditAllowanceOverride: string;
    reason: string;
    expiresAt: string;
    customFlagKey: string;
  }>({
    featureFlags: {},
    tenantAllowanceOverride: "",
    aiCreditAllowanceOverride: "",
    reason: "",
    expiresAt: "",
    customFlagKey: "",
  });

  const loadMsps = useCallback(async () => {
    const res = await adminFetch("/api/admin/msps?limit=100");
    if (res.ok) {
      const data = (await res.json()) as { msps: Msp[] };
      setMsps(data.msps);
    }
  }, [adminFetch]);

  useEffect(() => { void loadMsps(); }, [loadMsps]);

  async function loadOverride(msp: Msp) {
    setSelectedMsp(msp);
    setOverride(null);
    setLoading(true);
    try {
      const res = await adminFetch(`/api/admin/msps/${msp.id}/overrides`);
      if (res.ok) {
        const data = (await res.json()) as Override | null;
        setOverride(data);
        if (data) {
          setForm({
            featureFlags: data.featureFlags,
            tenantAllowanceOverride: data.tenantAllowanceOverride ? String(data.tenantAllowanceOverride) : "",
            aiCreditAllowanceOverride: data.aiCreditAllowanceOverride ? String(data.aiCreditAllowanceOverride) : "",
            reason: data.reason,
            expiresAt: data.expiresAt ? new Date(data.expiresAt).toISOString().slice(0, 10) : "",
            customFlagKey: "",
          });
        } else {
          setForm({ featureFlags: {}, tenantAllowanceOverride: "", aiCreditAllowanceOverride: "", reason: "", expiresAt: "", customFlagKey: "" });
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMsp) return;
    if (!form.reason.trim()) { toast.error("Reason is required"); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        featureFlags: form.featureFlags,
        reason: form.reason,
      };
      if (form.tenantAllowanceOverride) body.tenantAllowanceOverride = parseInt(form.tenantAllowanceOverride, 10);
      if (form.aiCreditAllowanceOverride) body.aiCreditAllowanceOverride = parseInt(form.aiCreditAllowanceOverride, 10);
      if (form.expiresAt) body.expiresAt = new Date(form.expiresAt).toISOString();

      const res = await adminFetch(`/api/admin/msps/${selectedMsp.id}/overrides`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success("Overrides saved");
        await loadOverride(selectedMsp);
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedMsp || !override) return;
    if (!confirm("Remove all overrides for this MSP? They will fall back to plan defaults.")) return;
    setDeleting(true);
    try {
      const res = await adminFetch(`/api/admin/msps/${selectedMsp.id}/overrides`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Overrides removed");
        setOverride(null);
        setForm({ featureFlags: {}, tenantAllowanceOverride: "", aiCreditAllowanceOverride: "", reason: "", expiresAt: "", customFlagKey: "" });
      } else {
        toast.error("Delete failed");
      }
    } finally {
      setDeleting(false);
    }
  }

  function toggleFlag(key: string, value: boolean) {
    setForm((f) => ({ ...f, featureFlags: { ...f.featureFlags, [key]: value } }));
  }

  function addCustomFlag() {
    if (!form.customFlagKey.trim()) return;
    toggleFlag(form.customFlagKey.trim(), true);
    setForm((f) => ({ ...f, customFlagKey: "" }));
  }

  const allFlagKeys = [...new Set([...COMMON_FLAGS, ...Object.keys(form.featureFlags)])];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="size-5 text-primary" />
        <div>
          <h2 className="text-lg font-semibold">MSP Overrides</h2>
          <p className="text-sm text-muted-foreground">
            Grant ad hoc feature flags or custom allowances to individual MSPs outside their plan.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
        <AlertTriangle className="size-3.5 shrink-0" />
        Overrides bypass plan tier gating. Use sparingly and always provide a documented reason.
      </div>

      <div className="grid grid-cols-[240px_1fr] gap-6">
        {/* MSP list */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1 mb-2">Select MSP</p>
          {msps.map((msp) => (
            <button
              key={msp.id}
              className={`w-full text-left rounded-lg px-3 py-2.5 text-sm transition-colors ${
                selectedMsp?.id === msp.id
                  ? "bg-primary/10 text-primary font-medium"
                  : "hover:bg-muted/40 text-muted-foreground"
              }`}
              onClick={() => void loadOverride(msp)}
            >
              <span className="truncate block">{msp.name}</span>
              <span className="font-mono text-[10px] opacity-60">{msp.slug}</span>
            </button>
          ))}
        </div>

        {/* Override editor */}
        {selectedMsp ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                {selectedMsp.name} Overrides
                {override && <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">Active Override</Badge>}
              </CardTitle>
              <CardDescription className="text-xs">
                Changes take effect immediately. Expires automatically if an expiry date is set.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : (
                <form onSubmit={(e) => void handleSave(e)} className="space-y-5">
                  {/* Feature flags */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium">Feature Flags</p>
                    <div className="space-y-2">
                      {allFlagKeys.map((key) => (
                        <div key={key} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                          <code className="text-xs font-mono">{key}</code>
                          <Switch
                            checked={form.featureFlags[key] === true}
                            onCheckedChange={(v) => toggleFlag(key, v)}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        value={form.customFlagKey}
                        onChange={(e) => setForm((f) => ({ ...f, customFlagKey: e.target.value }))}
                        placeholder="custom_feature_key"
                        className="h-7 text-xs font-mono"
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomFlag(); } }}
                      />
                      <Button type="button" size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={addCustomFlag}>
                        <Plus className="size-3" /> Add
                      </Button>
                    </div>
                  </div>

                  {/* Allowance overrides */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tenant Allowance Override</Label>
                      <Input
                        type="number"
                        min={1}
                        value={form.tenantAllowanceOverride}
                        onChange={(e) => setForm((f) => ({ ...f, tenantAllowanceOverride: e.target.value }))}
                        placeholder="Leave blank for plan default"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">AI Credit Override</Label>
                      <Input
                        type="number"
                        min={1}
                        value={form.aiCreditAllowanceOverride}
                        onChange={(e) => setForm((f) => ({ ...f, aiCreditAllowanceOverride: e.target.value }))}
                        placeholder="Leave blank for plan default"
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>

                  {/* Expiry */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Expires (optional)</Label>
                    <Input
                      type="date"
                      value={form.expiresAt}
                      onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                      min={new Date().toISOString().slice(0, 10)}
                      className="h-8 text-sm w-48"
                    />
                  </div>

                  {/* Reason */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Reason (required) *</Label>
                    <Textarea
                      value={form.reason}
                      onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                      placeholder="Pilot program, trial extension, support escalation…"
                      required
                      minLength={5}
                      maxLength={500}
                      rows={3}
                      className="text-sm resize-none"
                    />
                  </div>

                  <div className="flex items-center gap-2 justify-end pt-2 border-t border-border">
                    {override && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="gap-1.5 text-destructive"
                        disabled={deleting}
                        onClick={() => void handleDelete()}
                      >
                        {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                        Remove Override
                      </Button>
                    )}
                    <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
                      {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Shield className="size-3.5" />}
                      Save Override
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-12 pb-12 text-center text-sm text-muted-foreground">
              Select an MSP to view or create an override
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
