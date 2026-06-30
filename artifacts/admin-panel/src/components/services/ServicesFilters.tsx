import VisibilityBadge from "./VisibilityBadge";

export interface FilterState {
  search: string;
  category: string;
  visibility: "" | "public" | "private" | "landing_page_only";
  priceType: "" | "free" | "paid";
}

interface Props {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  categories: string[];
}

export default function ServicesFilters({ filters, onChange, categories }: Props) {
  function set<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <aside className="w-52 flex-shrink-0 border-r border-[#30363D] bg-[#161B22] flex flex-col overflow-y-auto">
      <div className="p-4 border-b border-[#30363D]">
        <p className="text-xs font-bold text-[#7D8590] uppercase tracking-wider mb-3">Filters</p>

        {/* Search */}
        <div className="mb-4">
          <label className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide mb-1 block">Search</label>
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#484F58]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={filters.search}
              onChange={e => set("search", e.target.value)}
              placeholder="Name, slug…"
              className="w-full border border-[#30363D] rounded-lg pl-8 pr-3 py-1.5 text-xs bg-[#0D1117] text-[#E6EDF3] placeholder-[#484F58] focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
            />
          </div>
        </div>

        {/* Category */}
        <div className="mb-4">
          <label className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide mb-1 block">Category</label>
          <select
            value={filters.category}
            onChange={e => set("category", e.target.value)}
            className="w-full border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
          >
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Visibility */}
        <div className="mb-4">
          <label className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide mb-2 block">Visibility</label>
          <div className="space-y-1.5">
            {(["", "public", "private", "landing_page_only"] as const).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => set("visibility", v)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${filters.visibility === v ? "bg-[#0078D4]/15 ring-1 ring-[#0078D4]/40" : "hover:bg-[#1C2128]"}`}
              >
                {v === "" ? (
                  <span className="text-xs text-[#7D8590]">All</span>
                ) : (
                  <VisibilityBadge visibility={v} size="xs" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Price Type */}
        <div>
          <label className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide mb-2 block">Price</label>
          <div className="space-y-1">
            {([
              { v: "" as const, label: "All" },
              { v: "free" as const, label: "Free / Contact" },
              { v: "paid" as const, label: "Paid" },
            ]).map(({ v, label }) => (
              <button
                key={v}
                type="button"
                onClick={() => set("priceType", v)}
                className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors ${filters.priceType === v ? "bg-[#0078D4]/15 text-[#58A6FF] ring-1 ring-[#0078D4]/40" : "text-[#7D8590] hover:bg-[#1C2128] hover:text-[#E6EDF3]"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(filters.category || filters.visibility || filters.priceType || filters.search) && (
        <div className="p-4">
          <button
            type="button"
            onClick={() => onChange({ search: "", category: "", visibility: "", priceType: "" })}
            className="w-full text-xs text-[#7D8590] hover:text-[#E6EDF3] border border-[#30363D] rounded-lg py-1.5 transition-colors"
          >
            Clear all filters
          </button>
        </div>
      )}
    </aside>
  );
}
