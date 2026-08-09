/**
 * Active Directory — Properties (the screen's `right` panel).
 *
 * `right: { render: () => ReactNode }` gets no `ctx` argument (SHELL.md /
 * `registry/types.ts`'s `PanelSpec`) — a panel derives what it needs from
 * `useShell()` itself, the same way `ActiveScreen` does in AdminV2.tsx. This
 * reads purely from `adNameCache`, never an independent fetch: the cache is
 * already populated the instant the Explorer tree loads (every name/status
 * this panel shows comes straight out of the one `/tree` response), so
 * Properties updates the moment you click a row — before the canvas's own
 * detail fetch even resolves — instead of doubling the network cost of every
 * record open for a duplicate read of the same detail the canvas already
 * shows in full.
 */

import { TEXT } from "../../theme";
import { useShell } from "../../shell/ShellContext";
import { getAdCachedRecord, type AdCacheKind } from "./adNameCache";

const KIND_LABEL: Record<AdCacheKind, string> = {
  msp: "MSP",
  customer: "Tenant",
  user: "User",
  group: "RBAC group",
  ou: "Organizational unit",
};

const AD_KINDS = new Set<string>(["msp", "customer", "user", "group", "ou"]);

export function AdProperties() {
  const shell = useShell();
  const activeDoc = shell.state.docs.find((d) => d.id === shell.state.activeDocId);

  if (!activeDoc || activeDoc.kind === "screen" || !AD_KINDS.has(activeDoc.kind)) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: TEXT.caption, textWrap: "pretty" } as React.CSSProperties}>
        Select a record in the Explorer to see it here.
      </div>
    );
  }

  const kind = activeDoc.kind as AdCacheKind;
  const record = getAdCachedRecord(kind, activeDoc.recordId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: TEXT.metaAlt }}>
          {KIND_LABEL[kind]}
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: TEXT.primary, textWrap: "pretty" } as React.CSSProperties}>
          {record?.title ?? activeDoc.label}
        </span>
        {record?.sub && <span style={{ fontSize: 11.5, color: TEXT.caption }}>{record.sub}</span>}
      </div>

      {record?.tag && (
        <div>
          <span
            style={{
              display: "inline-block",
              padding: "2px 9px",
              borderRadius: 10,
              fontSize: 10.5,
              border: "1px solid #3b3b3b",
              color:
                record.tagTone === "good" ? "#92d8ae" : record.tagTone === "bad" ? "#eda3a3" : "#f2ca63",
            }}
          >
            {record.tag}
          </span>
        </div>
      )}

      <span style={{ fontSize: 11, color: TEXT.faint, textWrap: "pretty" } as React.CSSProperties}>
        Full detail, related records and write actions are in the open tab.
      </span>
    </div>
  );
}
