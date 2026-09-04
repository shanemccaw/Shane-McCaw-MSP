import type { ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { MODULE_NAV_ITEMS, comingSoonHref } from "./moduleNav";

/**
 * The sidebar module nav (README "Layout" §4 / "Sidebar module list").
 * `footerSlot` is where the Tenant Status card mounts (#1824) — out of
 * scope for #1819 itself (see build-journal/1819.md), but the sidebar
 * reserves the `margin-top: auto` slot the design puts it in so that build
 * can drop the card in without re-touching this component's layout.
 */
export function SidebarNav({ footerSlot }: { footerSlot?: ReactNode }) {
  const [location] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const activeModuleFeature =
    location === "/coming-soon" && params.get("group") === "module" ? params.get("feature") : null;

  return (
    <div
      className="flex flex-none flex-col border-r"
      style={{ width: 232, borderColor: "rgba(255,255,255,.10)", padding: "14px 10px 12px" }}
    >
      <div className="mb-[10px] flex min-h-0 flex-col gap-px overflow-y-auto overflow-x-hidden">
        {MODULE_NAV_ITEMS.map((item) => {
          const active =
            item.builtPath != null ? location === item.builtPath : activeModuleFeature === item.label;
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.builtPath ?? comingSoonHref(item.label, "module")}
              data-testid={`sidebar-nav-${item.key}`}
              className="flex items-center gap-[10px] rounded-md px-[10px] py-[5.5px] transition-colors hover:bg-white/[.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078D4]"
              style={{ background: active ? "rgba(255,255,255,.06)" : "transparent" }}
            >
              <Icon size={15} strokeWidth={1.75} color={active ? "#f8fafc" : "#94a3b8"} />
              <span
                className="text-[13px]"
                style={{ color: active ? "#f8fafc" : "#94a3b8", fontWeight: active ? 600 : 400 }}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
      {footerSlot ? <div className="mt-auto">{footerSlot}</div> : null}
    </div>
  );
}
