/**
 * HeaderMenus.tsx — the change-control badge, the account-menu body and the
 * New-menu body, drawn to the prototype markup (Customer Portal Shell.dc.html:
 * account menu 340-349, New menu 225-242) and derivations (account 19242-19255,
 * cc badge 19292-19296, New 19302-19325).
 *
 * The menu OPEN state and the header anchors live in the shell; these render the
 * bodies. Copy and icon names are the prototype's verbatim (`shellMenus.ts`),
 * `iconSvg` names mapped 1:1 to lucide-react. Several targets — Billing,
 * Webhooks, Alert preferences, Account security (Part 12) and Procedure /
 * SOPs & Runbooks (Part 6) — are owned by later parts and resolve when they
 * land; the change-control entries deep-link into the Change Control module,
 * which exists. See `shellMenus.ts` for why the full set is built now.
 */

import { CC_POLICY, ccBadge } from "./shellData";
import { ACCOUNT_MENU, NEW_MENU } from "./shellMenus";
import { newCreateKindForLabel, type NewCreateKind } from "@/components/portal-v2/newMenuCreate";

/* ── Change-control header badge ─────────────────────────────────────────── */

export function ChangeControlBadge({ onNavigate }: { onNavigate: (href: string) => void }) {
  const badge = ccBadge(CC_POLICY);
  return (
    <button
      onClick={() => onNavigate(badge.href)}
      title={badge.title}
      data-testid="pv2-cc-badge"
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 11px",
        borderRadius: 999,
        cursor: "pointer",
        fontFamily: "inherit",
        border: `1px solid ${badge.borderTone}`,
        background: badge.fillTone,
        color: badge.tone,
        fontSize: "11px",
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: badge.tone }} />
      {badge.label}
    </button>
  );
}

/* ── Account menu body ───────────────────────────────────────────────────── */

export function AccountMenuContent({
  onNavigate,
  onSignOut,
}: {
  onNavigate: (href: string) => void;
  onSignOut: () => void;
}) {
  return (
    <>
      {ACCOUNT_MENU.map((m, i) => {
        const Icon = m.icon;
        const last = i === ACCOUNT_MENU.length - 1;
        return (
          <button
            key={m.key}
            onClick={() => (m.signOut ? onSignOut() : m.href && onNavigate(m.href))}
            data-testid={`pv2-account-${m.key}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 10px",
              borderRadius: 6,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "12.5px",
              fontWeight: 600,
              color: m.danger ? "#f87171" : "#e2e8f0",
              textAlign: "left",
              width: "100%",
              ...(last
                ? { marginTop: 4, paddingTop: 10, borderTop: "1px solid rgba(30,41,59,.9)", borderRadius: "0 0 6px 6px" }
                : null),
            }}
          >
            <span style={{ flex: "0 0 auto", display: "flex" }}>
              <Icon size={14} color={m.danger ? "#f87171" : "#94a3b8"} />
            </span>
            <span style={{ flex: 1, textAlign: "left" }}>{m.label}</span>
          </button>
        );
      })}
    </>
  );
}

/* ── New menu body ───────────────────────────────────────────────────────── */

export function NewMenuContent({
  onNavigate,
  onCreate,
}: {
  onNavigate: (href: string) => void;
  /** Opens the real create form for items that have a backend; see newMenuCreate.ts. */
  onCreate: (kind: NewCreateKind) => void;
}) {
  return (
    <>
      {NEW_MENU.map((g, gi) => (
        <div
          key={g.label}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 0,
            padding: 8,
            borderBottom: gi < NEW_MENU.length - 1 ? "1px solid rgba(30,41,59,.7)" : "none",
          }}
        >
          <span style={{ padding: "5px 8px 6px", fontSize: "8.5px", fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "#475569" }}>
            {g.label}
          </span>
          {g.items.map((n) => {
            const createKind = newCreateKindForLabel(n.label);
            // A per-item testid (the label slugged) so a manifest can click one
            // specific item; the shared `pv2-new-item` is kept as a class-like
            // marker for any assertion that wants "any New item".
            const slug = n.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            return (
            <button
              key={n.label}
              onClick={() => (createKind ? onCreate(createKind) : onNavigate(n.href))}
              data-testid={`pv2-new-item-${slug}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "9px 8px",
                border: "none",
                borderRadius: 7,
                background: "transparent",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
                width: "100%",
              }}
            >
              <span style={{ flex: "0 0 7px", width: 7, height: 7, marginTop: 5, borderRadius: "50%", background: n.tone }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.35 }}>{n.label}</span>
                <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.4 }}>{n.sub}</span>
              </div>
            </button>
            );
          })}
        </div>
      ))}
    </>
  );
}
