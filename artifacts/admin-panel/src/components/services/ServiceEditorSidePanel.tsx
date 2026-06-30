import type { ServiceRow } from "@/hooks/useServices";
import VisibilityBadge from "./VisibilityBadge";

function priceDisplay(s: Partial<ServiceRow>): string {
  const fmt = (v: string | null | undefined) => {
    if (!v) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };
  const base = fmt(s.basePrice);
  const max = fmt(s.maxPrice);
  if (base && max) return `${base}–${max}`;
  if (base) return base;
  const single = fmt(s.price);
  return single ?? "Contact for pricing";
}

interface Props {
  form: Partial<ServiceRow>;
  isNew?: boolean;
  isDirty: boolean;
}

export default function ServiceEditorSidePanel({ form, isNew, isDirty }: Props) {
  return (
    <aside className="w-64 flex-shrink-0 border-l border-[#30363D] bg-[#161B22] p-4 space-y-4 overflow-y-auto">
      {/* Status */}
      <div>
        <p className="text-[10px] font-bold text-[#7D8590] uppercase tracking-wider mb-2">Status</p>
        <div className="space-y-2">
          {isDirty && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
              Unsaved changes
            </div>
          )}
          {isNew && (
            <div className="flex items-center gap-2 text-xs text-[#58A6FF] bg-[#0078D4]/10 border border-[#0078D4]/20 rounded-lg px-2.5 py-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#58A6FF] flex-shrink-0" />
              New service
            </div>
          )}
        </div>
      </div>

      {/* Details */}
      <div>
        <p className="text-[10px] font-bold text-[#7D8590] uppercase tracking-wider mb-2">Details</p>
        <div className="space-y-2">
          {form.visibility && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#7D8590]">Visibility</span>
              <VisibilityBadge visibility={form.visibility} size="xs" />
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#7D8590]">Billing</span>
            <span className="text-xs text-[#E6EDF3] font-medium">
              {form.billingType === "recurring_monthly" ? "Monthly" : "One-time"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#7D8590]">Price</span>
            <span className="text-xs text-[#0078D4] font-semibold">{priceDisplay(form)}</span>
          </div>
          {form.category && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#7D8590]">Category</span>
              <span className="text-xs text-[#E6EDF3] truncate max-w-[120px]" title={form.category}>{form.category}</span>
            </div>
          )}
          {form.slug && (
            <div>
              <span className="text-xs text-[#7D8590]">Slug</span>
              <p className="text-xs font-mono text-[#484F58] truncate mt-0.5">{form.slug}</p>
            </div>
          )}
          {form.badge && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#7D8590]">Badge</span>
              <span className="text-xs bg-[#0078D4]/10 text-[#0078D4] px-1.5 py-0.5 rounded font-medium">{form.badge}</span>
            </div>
          )}
        </div>
      </div>

      {/* Deliverables count */}
      {(form.deliverables ?? []).length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-[#7D8590] uppercase tracking-wider mb-2">Deliverables</p>
          <p className="text-xs text-[#7D8590]">{(form.deliverables ?? []).length} item{(form.deliverables ?? []).length !== 1 ? "s" : ""}</p>
        </div>
      )}

      {/* Inclusions count */}
      {(form.inclusions ?? []).length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-[#7D8590] uppercase tracking-wider mb-2">Inclusions</p>
          <p className="text-xs text-[#7D8590]">{(form.inclusions ?? []).length} item{(form.inclusions ?? []).length !== 1 ? "s" : ""}</p>
        </div>
      )}

      {/* PDF status */}
      {form.overviewPdfKey && (
        <div>
          <p className="text-[10px] font-bold text-[#7D8590] uppercase tracking-wider mb-1">Overview PDF</p>
          <p className="text-xs text-emerald-400 flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Generated
          </p>
          {form.overviewPdfGeneratedAt && (
            <p className="text-[10px] text-[#484F58] mt-0.5">
              {new Date(form.overviewPdfGeneratedAt).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
