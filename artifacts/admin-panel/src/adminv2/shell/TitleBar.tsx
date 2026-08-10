/**
 * Title bar — 36px, the app's outermost identity strip.
 *
 * Left: mark, product name, quick-access buttons. Right: staged-changes pill,
 * the tenant scope, and the user. The tenant control sits here rather than in
 * the ribbon because everything on screen is scoped to it — it is a property of
 * the whole window, not of any one tab.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { ACCENT, FONT, LINE, METRICS, SHADOW, SURFACE, TEXT, WASH, Z } from "../theme";

export interface QuickAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
}

export interface TenantOption {
  id: string;
  label: string;
  /** Right-hand grey text, e.g. "142 seats". */
  hint?: string;
  /** Dot colour — health, not decoration. */
  color?: string;
}

export interface TitleBarProps {
  productName: string;
  /** Two-letter mark in the top-left tile. */
  mark: string;
  quickActions?: QuickAction[];
  /** "3 staged" etc. Only rendered when there is something staged. */
  staged?: { label: string; color?: string } | null;
  tenants?: TenantOption[];
  activeTenantId?: string;
  onSelectTenant?: (id: string) => void;
  /** Initials in the avatar. */
  userInitials?: string;
}

const barStyle: CSSProperties = {
  flex: "none",
  height: METRICS.titleBar,
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "0 10px",
  background: SURFACE.chrome,
  borderBottom: `1px solid ${LINE.base}`,
};

import { useSyncExternalStore } from "react";
import {
  getSnapshot, subscribe, createChat, selectIssue, selectEpic,
} from "../screens/build-tracker/buildTrackerStore";
import { getShellApi } from "./ShellContext";

function InProgressWorkItem({
  title, id, type, githubNumber,
}: { title: string; id: number; type: "epic" | "issue"; githubNumber?: number | null }) {
  const [chatInput, setChatInput] = useState("");
  const [linked, setLinked] = useState(false);

  async function handleLink() {
    if (!chatInput.trim()) return;
    const cid = chatInput.trim();
    await createChat(cid, cid, type === "issue" ? id : null, type === "epic" ? id : null);
    setChatInput("");
    setLinked(true);
    setTimeout(() => setLinked(false), 2000);
  }

  function handleNavigate() {
    if (type === "issue") {
      selectIssue(id);
      getShellApi()?.openDoc({ kind: "issue", id: String(id), screenId: "build-tracker" });
    } else {
      selectEpic(id);
      getShellApi()?.openDoc({ kind: "epic", id: String(id), screenId: "build-tracker" });
    }
  }

  return (
    <div style={{
      padding: 10, borderRadius: 6, background: SURFACE.well,
      border: `1px solid ${LINE.control}`, display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          onClick={handleNavigate}
          style={{
            background: "transparent", border: 0, padding: 0, cursor: "pointer",
            textAlign: "left", display: "flex", alignItems: "center", gap: 6,
          }}
        >
          <span style={{
            fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em",
            padding: "1px 5px", borderRadius: 3,
            background: type === "issue" ? `${ACCENT.info}20` : `${ACCENT.amber}20`,
            color: type === "issue" ? ACCENT.info : ACCENT.amber,
          }}>
            {type}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: TEXT.bright, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
            {githubNumber ? `#${githubNumber} ` : ""}{title}
          </span>
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          placeholder="Paste Claude chat URL or ID..."
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleLink(); }}
          style={{
            flex: 1, padding: "4px 8px", borderRadius: 4,
            background: SURFACE.card, border: `1px solid ${LINE.quiet}`,
            color: TEXT.primary, fontFamily: FONT.sans, fontSize: 11, outline: "none",
          }}
        />
        <button
          onClick={() => void handleLink()}
          disabled={!chatInput.trim()}
          style={{
            padding: "4px 8px", borderRadius: 4, border: 0,
            background: linked ? ACCENT.green : ACCENT.info,
            color: SURFACE.well, fontSize: 11, fontWeight: 700, cursor: !chatInput.trim() ? "default" : "pointer",
            fontFamily: FONT.sans, opacity: !chatInput.trim() ? 0.5 : 1, display: "flex", alignItems: "center", gap: 4,
          }}
        >
          {linked ? "✓ Linked!" : "Link Chat"}
        </button>
      </div>
    </div>
  );
}

function InProgressWorkPillDropdown() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const inProgressEpics = state.epics.filter((e) => e.status === "in_progress");
  const inProgressIssues = state.issues.filter((i) => i.status === "in_progress");
  const totalCount = inProgressEpics.length + inProgressIssues.length;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (totalCount === 0) return null;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block", marginLeft: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 5, padding: "3px 9px",
          borderRadius: 12, border: `1px solid ${ACCENT.amber}50`,
          background: `${ACCENT.amber}22`, color: ACCENT.amber,
          fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: FONT.sans,
        }}
        title="View in-progress work and paste Claude chat links"
      >
        <span style={{ fontSize: 12 }}>🔥</span> {totalCount} In Progress
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, width: 340,
          background: SURFACE.card, border: `1px solid ${LINE.quiet}`,
          borderRadius: 8, boxShadow: SHADOW.popover, zIndex: Z.dropdown,
          padding: 12, display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${LINE.quiet}`, paddingBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: ACCENT.amber }}>
              In Progress Active Work ({totalCount})
            </span>
            <span style={{ fontSize: 10, color: TEXT.dim }}>Paste chat link to assign</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 380, overflowY: "auto" }}>
            {inProgressEpics.map((e) => (
              <InProgressWorkItem key={`epic-${e.id}`} id={e.id} title={e.title} type="epic" githubNumber={e.githubNumber} />
            ))}
            {inProgressIssues.map((i) => (
              <InProgressWorkItem key={`issue-${i.id}`} id={i.id} title={i.title} type="issue" githubNumber={i.githubNumber} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const quickBtnStyle: CSSProperties = {
  width: 26,
  height: 24,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: 0,
  borderRadius: 4,
  color: "rgba(255,255,255,.72)",
  cursor: "pointer",
  transition: "background 150ms, color 150ms",
};

export function TitleBar({
  productName,
  mark,
  quickActions = [],
  staged,
  tenants = [],
  activeTenantId,
  onSelectTenant,
  userInitials = "SM",
}: TitleBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocumentPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onDocumentPointerDown);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown);
  }, [menuOpen]);

  const activeTenant = tenants.find((t) => t.id === activeTenantId) ?? tenants[0];

  return (
    <div style={barStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: 5,
            background: `linear-gradient(135deg, ${TEXT.quiet}, ${TEXT.softer})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: "-.02em",
            color: "#fff",
          }}
        >
          {mark}
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", color: TEXT.primary }}>
          {productName}
        </span>
      </div>

      {quickActions.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flex: "none",
            paddingLeft: 8,
            marginLeft: 2,
            borderLeft: `1px solid ${LINE.group}`,
          }}
        >
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                className="av2-ghost"
                title={action.label}
                aria-label={action.label}
                disabled={action.disabled}
                onClick={action.onSelect}
                style={quickBtnStyle}
              >
                <Icon size={14} strokeWidth={1.9} />
              </button>
            );
          })}
          <InProgressWorkPillDropdown />
        </div>
      )}

      <div style={{ flex: 1 }} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: "none",
          fontSize: 11.5,
          color: "rgba(255,255,255,.58)",
        }}
      >
        {staged && (
          <span
            style={{
              whiteSpace: "nowrap",
              padding: "2px 8px",
              borderRadius: 9,
              border: `1px solid ${LINE.strong}`,
              fontSize: 11,
              color: staged.color ?? ACCENT.amber,
            }}
          >
            {staged.label}
          </span>
        )}

        {activeTenant && (
          <div ref={menuRef} style={{ position: "relative", flex: "none" }}>
            <button
              onClick={() => setMenuOpen((open) => !open)}
              title="Everything on screen is scoped to this tenant"
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              className="av2-ghost"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                height: 22,
                padding: "0 8px",
                background: SURFACE.well,
                border: `1px solid ${LINE.control}`,
                borderRadius: 4,
                color: TEXT.soft,
                fontFamily: FONT.sans,
                fontSize: 11.5,
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: activeTenant.color ?? ACCENT.green,
                  flex: "none",
                }}
              />
              <span
                style={{
                  maxWidth: 150,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {activeTenant.label}
              </span>
              <ChevronDown />
            </button>

            {menuOpen && (
              <div
                role="listbox"
                className="av2-overlay-in"
                style={{
                  position: "absolute",
                  top: 26,
                  right: 0,
                  minWidth: 230,
                  padding: 4,
                  background: SURFACE.well,
                  border: `1px solid ${LINE.strong}`,
                  borderRadius: 6,
                  boxShadow: SHADOW.popover,
                  zIndex: Z.palette,
                }}
              >
                {tenants.map((tenant) => {
                  const on = tenant.id === activeTenant.id;
                  return (
                    <div
                      key={tenant.id}
                      role="option"
                      aria-selected={on}
                      className="av2-row"
                      onClick={() => {
                        onSelectTenant?.(tenant.id);
                        setMenuOpen(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 9px",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: 12,
                        color: on ? TEXT.primary : TEXT.quiet,
                        background: on ? WASH.hoverSoft : "transparent",
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: tenant.color ?? ACCENT.green,
                          flex: "none",
                        }}
                      />
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {tenant.label}
                      </span>
                      {tenant.hint && (
                        <span style={{ flex: "none", fontSize: 10.5, color: TEXT.meta }}>
                          {tenant.hint}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div style={{ width: 1, height: 16, background: LINE.control }} />
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: LINE.control,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            fontWeight: 700,
            color: "#fff",
          }}
        >
          {userInitials}
        </div>
      </div>
    </div>
  );
}

function ChevronDown() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={11}
      height={11}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "none", opacity: 0.7 }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
