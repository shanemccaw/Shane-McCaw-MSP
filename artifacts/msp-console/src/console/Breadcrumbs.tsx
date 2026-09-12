import { Icon } from "./icons";
import { border, surface, text } from "./tokens";
import type { Crumb } from "./treeModel";

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <div
      className="smc-scroll"
      style={{
        flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8, padding: "10px 20px",
        borderBottom: `1px solid ${border.soft}`, background: surface.breadcrumb, overflowX: "auto",
      }}
    >
      {crumbs.map((c) => (
        <span
          key={c.key}
          onClick={c.onClick}
          style={{
            display: "flex", alignItems: "center", gap: 8, fontSize: 12,
            color: c.isLast ? text.strong : text.muted, fontWeight: c.isLast ? 600 : 500,
            cursor: c.onClick ? "pointer" : "default", whiteSpace: "nowrap",
          }}
        >
          <Icon name={c.sep} size={12} color={text.faint} />
          {c.label}
        </span>
      ))}
    </div>
  );
}
