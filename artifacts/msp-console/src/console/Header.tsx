import { useRef } from "react";
import { toast } from "sonner";
import { Icon } from "./icons";
import { useOutsideClose } from "./hooks";
import { border, shadow, signal, surface, text } from "./tokens";
import type { MspAlert } from "@/api/console-api";
import { formatScan } from "./treeModel";

const SEV_STYLE: Record<MspAlert["severity"], { icon: "shield-alert" | "triangle-alert" | "info"; color: string; tint: string; line: string }> = {
  critical: { icon: "shield-alert", color: signal.critical.text, tint: signal.critical.tint, line: "rgba(248,113,113,.3)" },
  warning: { icon: "triangle-alert", color: signal.warning.text, tint: signal.warning.tint, line: "rgba(251,191,36,.3)" },
  info: { icon: "info", color: signal.info.text, tint: signal.info.tint, line: "rgba(96,165,250,.3)" },
};

export interface HeaderProps {
  contextPath: string;
  onOpenPalette: () => void;
  breakGlassCount: number;
  onBreakGlass: () => void;
  alerts: MspAlert[];
  hasUnread: boolean;
  notifsOpen: boolean;
  onToggleNotifs: () => void;
  userOpen: boolean;
  onToggleUser: () => void;
  userName: string;
  userInitials: string;
  roleLabel: string;
  onNavigateSettings: () => void;
  onLogout: () => void;
}

export function Header(props: HeaderProps) {
  const notifsRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  useOutsideClose(notifsRef, props.notifsOpen, props.onToggleNotifs);
  useOutsideClose(userRef, props.userOpen, props.onToggleUser);

  return (
    <header
      style={{
        display: "flex", alignItems: "center", gap: 16, height: 56, flex: "0 0 56px",
        padding: "0 16px", background: surface.header,
        borderBottom: `1px solid ${border.header}`, position: "relative", zIndex: 40,
      }}
    >
      {/* Logo lockup */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: "linear-gradient(135deg,#0078D4,#00B4D8)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, fontSize: 11, color: "#fff",
        }}>SM</div>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: "-.01em", color: "#fff" }}>Shane McCaw</span>
          <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".14em", color: signal.brandSub }}>MSP CONSOLE</span>
        </div>
      </div>

      <div style={{ width: 1, height: 24, background: "rgba(148,163,184,.2)" }} />

      <span style={{ fontSize: 12, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {props.contextPath}
      </span>

      <div style={{ flex: 1 }} />

      {/* Command-palette search button */}
      <button
        onClick={props.onOpenPalette}
        style={{
          display: "flex", alignItems: "center", gap: 9, width: 260, height: 34, padding: "0 11px",
          borderRadius: 8, border: `1px solid rgba(148,163,184,.18)`, background: "rgba(2,6,23,.5)",
          color: text.label, fontSize: 12.5, cursor: "pointer", transition: "border-color .15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = border.hover)}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(148,163,184,.18)")}
      >
        <Icon name="search" size={14} />
        <span style={{ flex: 1, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Search the directory
        </span>
        <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 4, border: "1px solid rgba(148,163,184,.25)", color: text.muted }}>⌘K</span>
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {/* Break-glass pill — only when credentials are pending */}
        {props.breakGlassCount > 0 && (
          <button
            title="Pending break-glass credentials across your book"
            onClick={props.onBreakGlass}
            style={{
              display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px",
              borderRadius: 999, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint,
              color: signal.critical.text, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
              whiteSpace: "nowrap", marginRight: 6,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(248,113,113,.2)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = signal.critical.tint)}
          >
            <Icon name="key-round" size={13} />
            {props.breakGlassCount} break-glass pending
          </button>
        )}

        {/* Notifications */}
        <div style={{ position: "relative" }} ref={notifsRef}>
          <GhostButton onClick={props.onToggleNotifs} title="Signal feed">
            <Icon name="bell" size={16} />
            {props.hasUnread && (
              <span style={{ position: "absolute", top: 6, right: 7, width: 6, height: 6, borderRadius: "50%", background: signal.critical.strong, border: `2px solid ${surface.header}` }} />
            )}
          </GhostButton>
          {props.notifsOpen && (
            <div style={popoverStyle(340)}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: `1px solid ${border.sidebar}` }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: text.label }}>SIGNAL FEED</span>
                <span style={{ fontSize: 11, color: signal.info.strong, cursor: "pointer" }} onClick={() => toast("Marking read isn't wired up in the shell yet.")}>Mark all read</span>
              </div>
              {props.alerts.length === 0 ? (
                <div style={{ padding: "20px 14px", fontSize: 12.5, color: text.label, textWrap: "pretty" }}>
                  Nothing needs your attention across the book right now.
                </div>
              ) : (
                props.alerts.map((a) => {
                  const s = SEV_STYLE[a.severity];
                  return (
                    <div key={a.id} style={{ display: "flex", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${border.faint}` }}>
                      <span style={{ width: 26, height: 26, flex: "0 0 26px", borderRadius: 8, background: s.tint, border: `1px solid ${s.line}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Icon name={s.icon} size={13} color={s.color} />
                      </span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: text.body, textWrap: "pretty" }}>{a.title}</span>
                        <span style={{ fontSize: 11, color: text.label }}>
                          {(a.customerName ?? "MSP-wide")} · {formatScan(a.occurredAt)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* User menu */}
        <div style={{ position: "relative" }} ref={userRef}>
          <button
            onClick={props.onToggleUser}
            style={{
              display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 7px 0 5px",
              borderRadius: 8, border: "1px solid transparent", background: "transparent",
              color: text.secondary, cursor: "pointer", transition: "background-color .15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(148,163,184,.12)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ width: 25, height: 25, borderRadius: "50%", background: "rgba(96,165,250,.18)", border: "1px solid rgba(96,165,250,.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: signal.info.text }}>
              {props.userInitials}
            </span>
            <Icon name="chevron-down" size={13} />
          </button>
          {props.userOpen && (
            <div style={{ ...popoverStyle(250), padding: 8 }}>
              <div style={{ padding: "8px 10px 10px", borderBottom: `1px solid ${border.sidebar}`, marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: text.strong }}>{props.userName}</div>
                <div style={{ fontSize: 11, color: text.label }}>{props.roleLabel}</div>
              </div>
              <MenuItem icon="user" label="My profile" onClick={() => toast("Profile isn't available from the console yet.")} />
              <MenuItem icon="settings" label="MSP settings" onClick={props.onNavigateSettings} />
              <MenuItem icon="life-buoy" label="Support" onClick={() => toast("Support isn't wired up in the shell yet.")} />
              <MenuItem icon="log-out" label="Sign out" onClick={props.onLogout} />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function popoverStyle(width: number): React.CSSProperties {
  return {
    position: "absolute", top: 42, right: 0, width,
    background: surface.popover, border: "1px solid rgba(148,163,184,.2)", borderRadius: 12,
    boxShadow: shadow.popover, animation: "smcFade .14s ease-out", overflow: "hidden", zIndex: 50,
  };
}

function GhostButton({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 34, height: 34, borderRadius: 8, border: "1px solid transparent", background: "transparent",
        color: text.secondary, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative", transition: "background-color .15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(148,163,184,.12)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}

function MenuItem({ icon, label, onClick }: { icon: "user" | "settings" | "life-buoy" | "log-out"; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", width: "100%", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 8,
        border: "1px solid transparent", background: "transparent", color: text.secondary, fontSize: 13,
        cursor: "pointer", textAlign: "left",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(148,163,184,.1)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon name={icon} size={14} color={text.label} />
      {label}
    </button>
  );
}
