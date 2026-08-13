/**
 * PlanManagement — Platform admin view for tier capability rules and Stripe price migration.
 */

import { useState, useEffect, useCallback } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Zap,
} from "lucide-react";

interface Tier {
  id: number;
  name: string;
  slug: string;
  priceCents: number;
  stripePriceId: string | null;
  tenantAllowance: number;
  subscriberCount: number;
  isActive: boolean;
}

interface CapabilityRule {
  id: number;
  serviceId: number;
  capabilityKey: string;
  enabled: boolean;
  updatedAt: string;
  serviceName: string | null;
}

interface Migration {
  mspId: number;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  status: string;
  mspName: string;
  mspSlug: string;
}

interface MigrationResponse {
  currentPriceId: string | null;
  totalSubscribers: number;
  pendingMigration: number;
  subscribers: Migration[];
}

export default function PlanManagementPage() {
  const { adminFetch } = useAdminFetch();
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [caps, setCaps] = useState<CapabilityRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
  const [migrations, setMigrations] = useState<MigrationResponse | null>(null);
  const [loadingMigrations, setLoadingMigrations] = useState(false);
  const [newPriceForm, setNewPriceForm] = useState({ priceCents: "", nickname: "" });
  // Full services row for the selected tier (annualPriceCents lives on the
  // services table and is read/saved via the admin services API).
  const [tierService, setTierService] = useState<Record<string, unknown> | null>(null);
  const [annualPriceInput, setAnnualPriceInput] = useState("");
  const [savingAnnual, setSavingAnnual] = useState(false);
  const [showNewPrice, setShowNewPrice] = useState(false);
  const [creatingPrice, setCreatingPrice] = useState(false);
  const [migratingId, setMigratingId] = useState<number | null>(null);
  const [togglingCap, setTogglingCap] = useState<string | null>(null);
  const [newCapForm, setNewCapForm] = useState({ capabilityKey: "", serviceId: "" });
  const [showNewCap, setShowNewCap] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tiersRes, capsRes] = await Promise.all([
        adminFetch("/api/admin/plan-management/tiers"),
        adminFetch("/api/admin/plan-capabilities"),
      ]);
      if (tiersRes.ok) setTiers((await tiersRes.json()) as Tier[]);
      if (capsRes.ok) setCaps((await capsRes.json()) as CapabilityRule[]);
    } finally {
      setLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => { void loadData(); }, [loadData]);

  async function loadMigrations(tierId: number) {
    setLoadingMigrations(true);
    try {
      const res = await adminFetch(`/api/admin/plan-management/tiers/${tierId}/migrations`);
      if (res.ok) setMigrations((await res.json()) as MigrationResponse);
    } finally {
      setLoadingMigrations(false);
    }
  }

  /** Default yearly price: monthly × 10 (2 months free), in cents. */
  function defaultAnnualCents(service: Record<string, unknown>): number | null {
    const monthly = parseFloat(String(service.price ?? ""));
    if (isNaN(monthly) || monthly <= 0) return null;
    return Math.round(monthly * 10 * 100);
  }

  async function loadTierService(tierId: number) {
    setTierService(null);
    setAnnualPriceInput("");
    const res = await adminFetch(`/api/admin/services/${tierId}`);
    if (!res.ok) return;
    const service = (await res.json()) as Record<string, unknown>;
    setTierService(service);
    // Default-populate 10× monthly when no annual price is set yet; Shane can override.
    const current = service.annualPriceCents != null ? Number(service.annualPriceCents) : defaultAnnualCents(service);
    setAnnualPriceInput(current != null ? String(current) : "");
  }

  async function handleSelectTier(tier: Tier) {
    setSelectedTier(tier);
    setMigrations(null);
    await Promise.all([loadMigrations(tier.id), loadTierService(tier.id)]);
  }

  async function handleSaveAnnualPrice() {
    if (!selectedTier || !tierService) return;
    const cents = parseInt(annualPriceInput, 10);
    if (isNaN(cents) || cents < 100) { toast.error("Annual price must be at least 100 cents"); return; }
    setSavingAnnual(true);
    try {
      const res = await adminFetch(`/api/admin/services/${selectedTier.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...tierService, annualPriceCents: cents }),
      });
      if (res.ok) {
        setTierService((s) => (s ? { ...s, annualPriceCents: cents } : s));
        toast.success(`Annual price saved ($${(cents / 100).toFixed(2)}/yr)`);
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Failed to save annual price");
      }
    } finally {
      setSavingAnnual(false);
    }
  }

  async function handleNewPrice(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTier) return;
    const cents = parseInt(newPriceForm.priceCents, 10);
    if (isNaN(cents) || cents < 100) { toast.error("Price must be at least $1.00"); return; }
    setCreatingPrice(true);
    try {
      const res = await adminFetch(`/api/admin/plan-management/tiers/${selectedTier.id}/new-price`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceCents: cents, nickname: newPriceForm.nickname || undefined }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; newPriceId: string };
        toast.success(`New price created (${data.newPriceId.slice(0, 12)}…). Existing subscribers retained on old price.`);
        setShowNewPrice(false);
        setNewPriceForm({ priceCents: "", nickname: "" });
        await Promise.all([loadData(), loadMigrations(selectedTier.id)]);
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Failed to create price");
      }
    } finally {
      setCreatingPrice(false);
    }
  }

  async function handleMigrateSubscriber(mspId: number) {
    if (!selectedTier) return;
    if (!confirm("Migrate this subscriber to the current price? Stripe will create a proration.")) return;
    setMigratingId(mspId);
    try {
      const res = await adminFetch(`/api/admin/plan-management/tiers/${selectedTier.id}/migrate-subscriber`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mspId }),
      });
      if (res.ok) {
        toast.success("Subscriber migrated to new price");
        await loadMigrations(selectedTier.id);
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Migration failed");
      }
    } finally {
      setMigratingId(null);
    }
  }

  async function handleToggleCap(serviceId: number, capabilityKey: string, enabled: boolean) {
    const key = `${serviceId}:${capabilityKey}`;
    setTogglingCap(key);
    try {
      const res = await adminFetch(`/api/admin/plan-capabilities/${serviceId}/${capabilityKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        setCaps((c) => c.map((cap) =>
          cap.serviceId === serviceId && cap.capabilityKey === capabilityKey
            ? { ...cap, enabled }
            : cap
        ));
        toast.success(`Capability ${enabled ? "enabled" : "disabled"}`);
      } else {
        toast.error("Toggle failed");
      }
    } finally {
      setTogglingCap(null);
    }
  }

  async function handleAddCap(e: React.FormEvent) {
    e.preventDefault();
    const svcId = parseInt(newCapForm.serviceId, 10);
    if (isNaN(svcId) || !newCapForm.capabilityKey) { toast.error("Both fields are required"); return; }
    const res = await adminFetch(`/api/admin/plan-capabilities/${svcId}/${newCapForm.capabilityKey}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    if (res.ok) {
      toast.success("Rule added");
      setShowNewCap(false);
      setNewCapForm({ capabilityKey: "", serviceId: "" });
      await loadData();
    } else {
      const err = (await res.json()) as { error?: string };
      toast.error(err.error ?? "Failed to add rule");
    }
  }

  const tierCaps = selectedTier ? caps.filter((c) => c.serviceId === selectedTier.id) : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings2 className="size-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Plan Management</h2>
            <p className="text-sm text-muted-foreground">
              Manage tier capabilities and Stripe price migrations. Price changes are never retroactive.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="size-8" onClick={() => void loadData()}>
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-[280px_1fr] gap-6">
          {/* Tier list */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">Tiers</p>
            {tiers.length === 0 && (
              <p className="text-sm text-muted-foreground px-1">No MSP subscription tiers found.</p>
            )}
            {tiers.map((tier) => (
              <div
                key={tier.id}
                className={`rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                  selectedTier?.id === tier.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                }`}
                onClick={() => void handleSelectTier(tier)}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{tier.name}</p>
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">
                    ${(tier.priceCents / 100).toFixed(0)}/mo
                  </span>
                  <Badge variant="outline" className="text-[10px]">{tier.subscriberCount} subscribers</Badge>
                  {!tier.isActive && <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
                </div>
              </div>
            ))}
          </div>

          {/* Tier detail */}
          {selectedTier ? (
            <div className="space-y-6">
              {/* Capability rules */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Zap className="size-4 text-muted-foreground" />
                        Capability Rules — {selectedTier.name}
                      </CardTitle>
                      <CardDescription className="text-xs mt-1">
                        Missing rule = capability available. Set to false to gate on this tier.
                      </CardDescription>
                    </div>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowNewCap(true)}>
                      <Plus className="size-3.5" />
                      Add Rule
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {tierCaps.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No rules configured — all capabilities available on this tier.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {tierCaps.map((cap) => {
                        const toggleKey = `${cap.serviceId}:${cap.capabilityKey}`;
                        return (
                          <div key={toggleKey} className="flex items-center justify-between px-3 py-2 rounded-lg border border-border">
                            <div>
                              <code className="text-xs font-mono">{cap.capabilityKey}</code>
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                Updated {new Date(cap.updatedAt).toLocaleDateString()}
                              </p>
                            </div>
                            <Switch
                              checked={cap.enabled}
                              disabled={togglingCap === toggleKey}
                              onCheckedChange={(v) => void handleToggleCap(cap.serviceId, cap.capabilityKey, v)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Price migration */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <CreditCard className="size-4 text-muted-foreground" />
                        Stripe Pricing
                      </CardTitle>
                      <CardDescription className="text-xs mt-1">
                        Current price: {selectedTier.stripePriceId
                          ? <code className="font-mono text-[11px]">{selectedTier.stripePriceId}</code>
                          : "None set"}
                      </CardDescription>
                    </div>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowNewPrice(true)}>
                      <Plus className="size-3.5" />
                      New Price
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Annual price — powers the yearly option in MSP self-service plan change */}
                  <div className="mb-4 pb-4 border-b border-border space-y-1.5">
                    <Label htmlFor="annual-price-cents" className="text-xs">Annual Price (cents)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="annual-price-cents"
                        type="number"
                        min={100}
                        value={annualPriceInput}
                        onChange={(e) => setAnnualPriceInput(e.target.value)}
                        placeholder={tierService ? String(defaultAnnualCents(tierService) ?? "") : ""}
                        disabled={!tierService}
                        className="h-8 text-sm max-w-[180px]"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savingAnnual || !tierService}
                        onClick={() => void handleSaveAnnualPrice()}
                        className="gap-1.5"
                      >
                        {savingAnnual ? <Loader2 className="size-3 animate-spin" /> : null}
                        Save
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {annualPriceInput && !isNaN(parseInt(annualPriceInput))
                        ? `= $${(parseInt(annualPriceInput) / 100).toFixed(2)}/year. `
                        : ""}
                      Default is 10× monthly (2 months free). Used by MSP self-service yearly billing.
                    </p>
                  </div>

                  {loadingMigrations ? (
                    <Skeleton className="h-16 w-full" />
                  ) : migrations ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-4 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Total subscribers</p>
                          <p className="font-medium">{migrations.totalSubscribers}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Pending migration</p>
                          <p className={`font-medium ${migrations.pendingMigration > 0 ? "text-amber-600" : "text-green-600"}`}>
                            {migrations.pendingMigration}
                          </p>
                        </div>
                      </div>

                      {migrations.pendingMigration > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 text-xs text-amber-600">
                            <AlertTriangle className="size-3.5" />
                            These subscribers are still on the old price. Migrate individually with prorations.
                          </div>
                          {migrations.subscribers.map((sub) => (
                            <div key={sub.mspId} className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2">
                              <div>
                                <p className="text-sm font-medium">{sub.mspName}</p>
                                <code className="text-[11px] text-muted-foreground">{sub.stripePriceId}</code>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5 text-xs"
                                disabled={migratingId === sub.mspId}
                                onClick={() => void handleMigrateSubscriber(sub.mspId)}
                              >
                                {migratingId === sub.mspId
                                  ? <Loader2 className="size-3 animate-spin" />
                                  : <ChevronDown className="size-3" />}
                                Migrate
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      {migrations.pendingMigration === 0 && migrations.totalSubscribers > 0 && (
                        <p className="text-xs text-green-600">All subscribers are on the current price.</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No subscription data.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="pt-12 pb-12 text-center text-sm text-muted-foreground">
                Select a tier to manage capabilities and pricing
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* New Price Dialog */}
      <Dialog open={showNewPrice} onOpenChange={setShowNewPrice}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Create New Price — {selectedTier?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleNewPrice(e)} className="space-y-4">
            <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              Existing subscribers will keep their current price until you migrate them individually.
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-price-cents" className="text-xs">New Price (cents) *</Label>
              <Input
                id="new-price-cents"
                type="number"
                min={100}
                value={newPriceForm.priceCents}
                onChange={(e) => setNewPriceForm((f) => ({ ...f, priceCents: e.target.value }))}
                placeholder="4900 = $49/mo"
                required
                className="h-8 text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                {newPriceForm.priceCents && !isNaN(parseInt(newPriceForm.priceCents))
                  ? `= $${(parseInt(newPriceForm.priceCents) / 100).toFixed(2)}/month`
                  : "Enter amount in cents"}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-price-nick" className="text-xs">Nickname (optional)</Label>
              <Input
                id="new-price-nick"
                value={newPriceForm.nickname}
                onChange={(e) => setNewPriceForm((f) => ({ ...f, nickname: e.target.value }))}
                placeholder="July 2026 pricing"
                className="h-8 text-sm"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewPrice(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={creatingPrice} className="gap-1.5">
                {creatingPrice ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Create Price
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* New Cap Rule Dialog */}
      <Dialog open={showNewCap} onOpenChange={setShowNewCap}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Add Capability Rule</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleAddCap(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cap-svc" className="text-xs">Tier (Service ID) *</Label>
              <Input
                id="cap-svc"
                type="number"
                value={newCapForm.serviceId}
                onChange={(e) => setNewCapForm((f) => ({ ...f, serviceId: e.target.value }))}
                placeholder={selectedTier ? String(selectedTier.id) : "Service ID"}
                required
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cap-key" className="text-xs">Capability Key *</Label>
              <Input
                id="cap-key"
                value={newCapForm.capabilityKey}
                onChange={(e) => setNewCapForm((f) => ({ ...f, capabilityKey: e.target.value.toLowerCase().replace(/\s+/g, "_") }))}
                placeholder="advanced_signals"
                required
                className="h-8 text-sm font-mono"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewCap(false)}>Cancel</Button>
              <Button type="submit" size="sm" className="gap-1.5">
                <Plus className="size-3.5" />
                Add Rule
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
