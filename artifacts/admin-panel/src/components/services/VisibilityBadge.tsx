interface Props {
  visibility: "public" | "private" | "landing_page_only";
  size?: "sm" | "xs";
}

const VISIBILITY_CONFIG = {
  public: { label: "Public", className: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" },
  private: { label: "Private", className: "bg-[#30363D] text-[#7D8590] border border-[#30363D]" },
  landing_page_only: { label: "LP Only", className: "bg-amber-500/15 text-amber-400 border border-amber-500/20" },
} as const;

export default function VisibilityBadge({ visibility, size = "sm" }: Props) {
  const cfg = VISIBILITY_CONFIG[visibility] ?? VISIBILITY_CONFIG.private;
  const sizeClass = size === "xs" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5";
  return (
    <span className={`inline-flex items-center rounded font-semibold uppercase tracking-wide ${sizeClass} ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}
