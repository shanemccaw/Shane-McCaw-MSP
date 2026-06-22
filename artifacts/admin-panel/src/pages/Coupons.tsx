import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Pencil, Trash2, Loader2, Tag, ToggleLeft, ToggleRight, X } from "lucide-react";

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

  const load = async () => {
    try {
      const res = await fetchWithAuth("/api/admin/coupons");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCoupons(await res.json() as Coupon[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
          <h1 className="text-2xl font-bold text-[#0A2540]">Coupons</h1>
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
        <div className="bg-white border border-border rounded-2xl p-5 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-[#0A2540] text-sm flex items-center gap-2">
              <Tag className="w-4 h-4 text-[#0078D4]" />
              {editingId ? "Edit Coupon" : "Create Coupon"}
            </h2>
            <button onClick={closeForm} className="text-muted-foreground hover:text-[#0A2540]">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">Code <span className="text-red-500">*</span></label>
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
              <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">Discount type <span className="text-red-500">*</span></label>
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
              <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">
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
              <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">Max uses</label>
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
              <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">Expiry date</label>
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
                    : <ToggleLeft className="w-8 h-8 text-gray-300" />
                  }
                </button>
                <span className="text-xs font-semibold text-[#0A2540]">
                  {form.active ? "Active" : "Inactive"}
                </span>
              </label>
            </div>
          </div>

          {formError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-4">{formError}</p>
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
            <button onClick={closeForm} className="text-sm text-muted-foreground hover:text-[#0A2540] px-3 py-2">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-border rounded-2xl overflow-hidden">
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
            <p className="font-semibold text-[#0A2540] mb-1">No coupons yet</p>
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
                <tr className="bg-[#F7F9FC] border-b border-border text-left">
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

                  return (
                    <tr key={coupon.id} className="hover:bg-[#F7F9FC]/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-[#0A2540] text-sm tracking-wide">
                          {coupon.code}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                          coupon.discountType === "percentage"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-emerald-100 text-emerald-700"
                        }`}>
                          {formatDiscount(coupon)}
                          <span className="text-[10px] font-normal opacity-70">
                            {coupon.discountType === "percentage" ? "off" : "off"}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#0A2540] font-mono text-xs">
                        {formatUses(coupon)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => void handleToggleActive(coupon)}
                          title={coupon.active ? "Click to deactivate" : "Click to activate"}
                          className="focus:outline-none"
                        >
                          {effectivelyInactive ? (
                            <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full font-medium">
                              {expired ? "Expired" : exhausted ? "Exhausted" : "Inactive"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full font-medium">
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
                            className="p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
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
