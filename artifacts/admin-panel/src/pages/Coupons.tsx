import React, { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Pencil, Trash2, Loader2, Tag, ToggleLeft, ToggleRight, X, ChevronDown, ChevronRight, History } from "lucide-react";

interface Coupon {
  id: number;
  code: string;
  discountType: "fixed" | "percentage";
  discountValue: string;
  maxUses: number | null;
  usesCount: number;
  active: boolean;
  expiresAt: string | null;
  createdAt: string;
}

interface Redemption {
  id: number;
  checkoutSessionId: string;
  purchaseAmount: string | null;
  discountAmount: string | null;
  redeemedAt: string;
  userId: number | null;
  userName: string | null;
  userEmail: string | null;
}

interface CouponForm {
  code: string;
  discountType: "fixed" | "percentage";
  discountValue: string;
  maxUses: string;
  active: boolean;
  expiresAt: string;
}

const EMPTY_FORM: CouponForm = {
  code: "",
  discountType: "fixed",
  discountValue: "",
  maxUses: "",
  active: true,
  expiresAt: "",
};

function formatDiscount(coupon: Coupon) {
  const v = parseFloat(coupon.discountValue);
  return coupon.discountType === "percentage"
    ? `${v}%`
    : `$${v.toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

function formatUses(coupon: Coupon) {
  if (coupon.maxUses == null) return `${coupon.usesCount} / ∞`;
  return `${coupon.usesCount} / ${coupon.maxUses}`;
}

function formatExpiry(expiresAt: string | null) {
  if (!expiresAt) return "—";
  const d = new Date(expiresAt);
  const now = new Date();
  const expired = d < now;
  const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return expired ? `${formatted} (expired)` : formatted;
}

function formatMoney(val: string | null) {
  if (val == null) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(val: string) {
  return new Date(val).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export default function CouponsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CouponForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [formError, setFormError] = useState("");

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [redemptions, setRedemptions] = useState<Record<number, Redemption[]>>({});
  const [loadingRedemptions, setLoadingRedemptions] = useState<number | null>(null);

  const load = async () => {
    try {
      const res = await fetchWithAuth("/api/admin/coupons");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCoupons(await res.json() as Coupon[]);
    } catch {
      toast({ title: "Failed to load coupons", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleRedemptions = async (coupon: Coupon) => {
    if (expandedId === coupon.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(coupon.id);
    if (redemptions[coupon.id]) return;
    setLoadingRedemptions(coupon.id);
    try {
      const res = await fetchWithAuth(`/api/admin/coupons/${coupon.id}/redemptions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as Redemption[];
      setRedemptions(prev => ({ ...prev, [coupon.id]: data }));
    } catch {
      toast({ title: "Failed to load redemptions", variant: "destructive" });
      setExpandedId(null);
    } finally {
      setLoadingRedemptions(null);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setShowForm(true);
  };

  const openEdit = (coupon: Coupon) => {
    setEditingId(coupon.id);
    setForm({
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      maxUses: coupon.maxUses != null ? String(coupon.maxUses) : "",
      active: coupon.active,
      expiresAt: coupon.expiresAt ? coupon.expiresAt.slice(0, 10) : "",
    });
    setFormError("");
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormError("");
  };

  const handleSave = async () => {
    setFormError("");
    if (!form.code.trim()) { setFormError("Code is required"); return; }
    const dv = parseFloat(form.discountValue);
    if (isNaN(dv) || dv <= 0) { setFormError("Discount value must be a positive number"); return; }
    if (form.discountType === "percentage" && dv > 100) { setFormError("Percentage discount cannot exceed 100"); return; }

    setSaving(true);
    try {
      const body = {
        code: form.code.trim(),
        discountType: form.discountType,
        discountValue: dv,
        maxUses: form.maxUses.trim() ? parseInt(form.maxUses, 10) : null,
        active: form.active,
        expiresAt: form.expiresAt || null,
      };
      const res = editingId
        ? await fetchWithAuth(`/api/admin/coupons/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetchWithAuth("/api/admin/coupons", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setFormError(err.error ?? "Failed to save coupon");
        return;
      }
      toast({ title: editingId ? "Coupon updated" : "Coupon created" });
      closeForm();
      void load();
    } catch {
      setFormError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (coupon: Coupon) => {
    if (!confirm(`Delete coupon "${coupon.code}"? This cannot be undone.`)) return;
    setDeletingId(coupon.id);
    try {
      const res = await fetchWithAuth(`/api/admin/coupons/${coupon.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to delete coupon", variant: "destructive" });
        return;
      }
      toast({ title: `Coupon "${coupon.code}" deleted` });
      void load();
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleActive = async (coupon: Coupon) => {
    try {
      const res = await fetchWithAuth(`/api/admin/coupons/${coupon.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !coupon.active }),
      });
      if (!res.ok) {
        toast({ title: "Failed to update coupon", variant: "destructive" });
        return;
      }
      setCoupons(prev => prev.map(c => c.id === coupon.id ? { ...c, active: !c.active } : c));
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#E6EDF3]">Coupons</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Create and manage promo codes for checkout discounts</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#005A9E] transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Coupon
        </button>
      </div>

      {showForm && (
        <div className="bg-[#161B22] border border-border rounded-2xl p-5 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-[#E6EDF3] text-sm flex items-center gap-2">
              <Tag className="w-4 h-4 text-[#0078D4]" />
              {editingId ? "Edit Coupon" : "Create Coupon"}
            </h2>
            <button onClick={closeForm} className="text-muted-foreground hover:text-[#E6EDF3]">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1.5">Code <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="SAVE20"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4] uppercase"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Clients enter this code at checkout (case-insensitive)</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1.5">Discount type <span className="text-red-500">*</span></label>
              <div className="flex gap-2">
                {(["fixed", "percentage"] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setForm(f => ({ ...f, discountType: t }))}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                      form.discountType === t
                        ? "bg-[#0078D4] text-white border-[#0078D4]"
                        : "border-border text-muted-foreground hover:border-[#0078D4] hover:text-[#0078D4]"
                    }`}
                  >
                    {t === "fixed" ? "$ Fixed amount" : "% Percentage"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1.5">
                Discount value <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  {form.discountType === "fixed" ? "$" : "%"}
                </span>
                <input
                  type="number"
                  min="0"
                  max={form.discountType === "percentage" ? 100 : undefined}
                  step="0.01"
                  value={form.discountValue}
                  onChange={e => setForm(f => ({ ...f, discountValue: e.target.value }))}
                  placeholder={form.discountType === "fixed" ? "50" : "10"}
                  className="w-full border border-border rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1.5">Max uses</label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.maxUses}
                onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))}
                placeholder="Leave blank for unlimited"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Leave blank for unlimited uses</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1.5">Expiry date</label>
              <input
                type="date"
                value={form.expiresAt}
                onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
              />
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, active: !f.active }))}
                  className="focus:outline-none"
                >
                  {form.active
                    ? <ToggleRight className="w-8 h-8 text-[#0078D4]" />
                    : <ToggleLeft className="w-8 h-8 text-[#484F58]" />
                  }
                </button>
                <span className="text-xs font-semibold text-[#E6EDF3]">
                  {form.active ? "Active" : "Inactive"}
                </span>
              </label>
            </div>
          </div>

          {formError && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mt-4">{formError}</p>
          )}

          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-border">
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#005A9E] disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {saving ? "Saving…" : editingId ? "Update Coupon" : "Create Coupon"}
            </button>
            <button onClick={closeForm} className="text-sm text-muted-foreground hover:text-[#E6EDF3] px-3 py-2">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-[#161B22] border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading coupons…
          </div>
        ) : coupons.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="w-12 h-12 rounded-full bg-[#0078D4]/10 flex items-center justify-center mb-3">
              <Tag className="w-6 h-6 text-[#0078D4]" />
            </div>
            <p className="font-semibold text-[#E6EDF3] mb-1">No coupons yet</p>
            <p className="text-sm text-muted-foreground mb-4">Create your first promo code to offer discounts at checkout.</p>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#005A9E] transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create coupon
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#1C2128] border-b border-border text-left">
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider w-6"></th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Code</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Discount</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Uses</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Expires</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {coupons.map(coupon => {
                  const expired = coupon.expiresAt ? new Date(coupon.expiresAt) < new Date() : false;
                  const exhausted = coupon.maxUses != null && coupon.usesCount >= coupon.maxUses;
                  const effectivelyInactive = !coupon.active || expired || exhausted;
                  const isExpanded = expandedId === coupon.id;
                  const isLoadingThis = loadingRedemptions === coupon.id;
                  const couponRedemptions = redemptions[coupon.id];

                  return (
                    <React.Fragment key={coupon.id}>
                      <tr className={`transition-colors ${isExpanded ? "bg-[#1C2128]/70" : "hover:bg-[#1C2128]/50"}`}>
                        <td className="px-3 py-3">
                          <button
                            onClick={() => void toggleRedemptions(coupon)}
                            title={isExpanded ? "Hide redemption history" : "View redemption history"}
                            className="p-1 text-muted-foreground hover:text-[#0078D4] rounded transition-colors"
                            disabled={isLoadingThis}
                          >
                            {isLoadingThis
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : isExpanded
                                ? <ChevronDown className="w-3.5 h-3.5" />
                                : <ChevronRight className="w-3.5 h-3.5" />
                            }
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-[#E6EDF3] text-sm tracking-wide">
                            {coupon.code}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                            coupon.discountType === "percentage"
                              ? "bg-purple-500/15 text-purple-400"
                              : "bg-emerald-500/15 text-emerald-400"
                          }`}>
                            {formatDiscount(coupon)}
                            <span className="text-[10px] font-normal opacity-70">off</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[#E6EDF3] font-mono text-xs">
                          {formatUses(coupon)}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => void handleToggleActive(coupon)}
                            title={coupon.active ? "Click to deactivate" : "Click to activate"}
                            className="focus:outline-none"
                          >
                            {effectivelyInactive ? (
                              <span className="inline-flex items-center gap-1 text-xs bg-[#30363D]/50 text-[#7D8590] px-2.5 py-1 rounded-full font-medium">
                                {expired ? "Expired" : exhausted ? "Exhausted" : "Inactive"}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs bg-emerald-500/15 text-emerald-400 px-2.5 py-1 rounded-full font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                                Active
                              </span>
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatExpiry(coupon.expiresAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openEdit(coupon)}
                              className="p-1.5 text-muted-foreground hover:text-[#0078D4] hover:bg-[#0078D4]/10 rounded-lg transition-colors"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => void handleDelete(coupon)}
                              disabled={deletingId === coupon.id}
                              className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                              title="Delete"
                            >
                              {deletingId === coupon.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Trash2 className="w-3.5 h-3.5" />
                              }
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr key={`${coupon.id}-redemptions`}>
                          <td colSpan={7} className="bg-[#1C2128] border-b border-border px-0 py-0">
                            <div className="px-6 py-4">
                              <div className="flex items-center gap-2 mb-3">
                                <History className="w-3.5 h-3.5 text-[#0078D4]" />
                                <span className="text-xs font-bold text-[#E6EDF3] uppercase tracking-wider">
                                  Redemption History — {coupon.code}
                                </span>
                              </div>

                              {!couponRedemptions ? (
                                <div className="flex items-center gap-2 py-4 text-muted-foreground text-xs">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  Loading…
                                </div>
                              ) : couponRedemptions.length === 0 ? (
                                <p className="text-xs text-muted-foreground py-3">
                                  No redemptions yet — this coupon hasn't been used at checkout.
                                </p>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-left border-b border-border/60">
                                      <th className="pb-2 pr-4 font-semibold text-muted-foreground">Client</th>
                                      <th className="pb-2 pr-4 font-semibold text-muted-foreground">Paid</th>
                                      <th className="pb-2 pr-4 font-semibold text-muted-foreground">Saved</th>
                                      <th className="pb-2 pr-4 font-semibold text-muted-foreground">Date</th>
                                      <th className="pb-2 font-semibold text-muted-foreground">Session</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border/40">
                                    {couponRedemptions.map(r => (
                                      <tr key={r.id} className="text-[#E6EDF3]">
                                        <td className="py-2 pr-4">
                                          {r.userName || r.userEmail ? (
                                            <div>
                                              {r.userName && <span className="font-medium">{r.userName}</span>}
                                              {r.userEmail && (
                                                <span className={`block text-muted-foreground ${r.userName ? "text-[10px]" : ""}`}>
                                                  {r.userEmail}
                                                </span>
                                              )}
                                            </div>
                                          ) : (
                                            <span className="text-muted-foreground italic">Guest / unknown</span>
                                          )}
                                        </td>
                                        <td className="py-2 pr-4 font-mono font-medium">
                                          {formatMoney(r.purchaseAmount)}
                                        </td>
                                        <td className="py-2 pr-4">
                                          {r.discountAmount != null ? (
                                            <span className="text-emerald-400 font-mono font-medium">
                                              -{formatMoney(r.discountAmount)}
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground">—</span>
                                          )}
                                        </td>
                                        <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">
                                          {formatDate(r.redeemedAt)}
                                        </td>
                                        <td className="py-2">
                                          <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[120px] block" title={r.checkoutSessionId}>
                                            {r.checkoutSessionId.slice(0, 20)}…
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
