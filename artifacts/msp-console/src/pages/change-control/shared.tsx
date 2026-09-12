/**
 * Shared UI primitives for the Change Control module's seven tabs — the
 * design's tone palette, badge/button shells, the confirmation drawer, and
 * the five list data-states (README "Data states": Ready, Loading, Empty,
 * 403, 404). One copy so all seven tabs render these identically, per the
 * dispatch's "reproduce ... consistently" instruction.
 */
import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/console/icons";
import { text } from "@/console/tokens";
import { ApiError } from "./api";

// ── Tone palette — verbatim from `Change Control.dc.html`'s `tone()` ────────

export type Tone = "green" | "amber" | "red" | "blue" | "violet" | "slate";

const TONES: Record<Tone, readonly [string, string, string]> = {
  green: ["#34d399", "rgba(52,211,153,.1)", "rgba(52,211,153,.26)"],
  amber: ["#fbbf24", "rgba(251,191,36,.1)", "rgba(251,191,36,.26)"],
  red: ["#f87171", "rgba(248,113,113,.1)", "rgba(248,113,113,.26)"],
  blue: ["#60a5fa", "rgba(96,165,250,.1)", "rgba(96,165,250,.26)"],
  violet: ["#a78bfa", "rgba(167,139,250,.1)", "rgba(167,139,250,.26)"],
  slate: ["#94a3b8", "rgba(148,163,184,.08)", "rgba(148,163,184,.2)"],
};

export function toneColors(tone: Tone): { color: string; tint: string; line: string } {
  const [color, tint, line] = TONES[tone];
  return { color, tint, line };
}

export const RISK_COLOR: Record<string, string> = { critical: "#fca5a5", high: "#fcd34d", medium: "#93c5fd", low: "#94a3b8" };
export const STATUS_TONE: Record<string, Tone> = {
  pending_approval: "amber", scheduled: "blue", in_progress: "violet",
  completed: "green", rolled_back: "slate", rejected: "red",
};
export const STATUS_LABEL: Record<string, string> = {
  pending_approval: "pending approval", scheduled: "scheduled", in_progress: "in progress",
  completed: "completed", rolled_back: "rolled back", rejected: "rejected",
};
export const CLASS_TONE: Record<string, Tone> = { standard: "blue", normal: "slate", emergency: "red" };

// ── Badge ─────────────────────────────────────────────────────────────────

export function Badge({ label, tone }: { label: string; tone: Tone }) {
  const { color, tint, line } = toneColors(tone);
  return (
    <span style={{
      display: "inline-flex", padding: "3px 10px", borderRadius: 999,
      background: tint, border: `1px solid ${line}`, fontSize: 11, fontWeight: 600,
      color, whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

// ── Buttons ───────────────────────────────────────────────────────────────

type ButtonTone = "primary" | "danger" | "ghost";

export function Button({
  label, icon, onClick, tone = "ghost", disabled, title, type = "button",
}: {
  label: string; icon?: IconName; onClick?: () => void; tone?: ButtonTone;
  disabled?: boolean; title?: string; type?: "button" | "submit";
}) {
  const styles: Record<ButtonTone, { line: string; bg: string; fg: string }> = {
    primary: { line: "#2563eb", bg: "#2563eb", fg: "#fff" },
    danger: { line: "rgba(248,113,113,.3)", bg: "rgba(248,113,113,.1)", fg: "#fca5a5" },
    ghost: { line: "rgba(148,163,184,.22)", bg: "transparent", fg: "#cbd5e1" },
  };
  const s = styles[tone];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px",
        borderRadius: 7, border: `1px solid ${disabled ? "rgba(148,163,184,.2)" : s.line}`,
        background: disabled ? "transparent" : s.bg, color: disabled ? "#64748b" : s.fg,
        fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap",
      }}
    >
      {icon && <Icon name={icon} size={13} />}
      {label}
    </button>
  );
}

/**
 * Arm-then-confirm, in place — one click arms, a second (within the same
 * render) commits; clicking anything else disarms (README "Armed destructive
 * actions" #1, and matches `AdArmedButton` in the admin panel's own AD kit).
 * For lightweight, quickly-reversible actions.
 */
export function ArmedButton({
  label, armedLabel, onConfirm, tone = "danger", title,
}: {
  label: string; armedLabel?: string; onConfirm: () => void; tone?: ButtonTone; title?: string;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <Button
      label={armed ? armedLabel ?? `${label} — press again` : label}
      tone={armed ? "danger" : tone}
      title={title ?? (armed ? "Press again to confirm." : undefined)}
      onClick={() => {
        if (!armed) { setArmed(true); return; }
        setArmed(false);
        onConfirm();
      }}
    />
  );
}

// ── Confirmation drawer (README "Drawers" / "Armed destructive actions" #2) ─

export function Drawer({
  open, onClose, eyebrow, title, children, width = 460,
}: {
  open: boolean; onClose: () => void; eyebrow?: string; title: string; children: ReactNode; width?: number;
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)",
        zIndex: 90, display: "flex", justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: `min(${width}px, 94%)`, height: "100%", background: "#0b1728",
          borderLeft: "1px solid rgba(148,163,184,.2)", padding: 20, display: "flex",
          flexDirection: "column", gap: 15, overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            {eyebrow && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "#93c5fd" }}>{eyebrow}</span>}
            <span style={{ fontSize: 17, fontWeight: 700, color: "#f8fafc", letterSpacing: "-.01em" }}>{title}</span>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "1px solid transparent",
              background: "transparent", color: "#94a3b8", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Data states (README "Data states": Ready, Loading, Empty, 403, 404) ─────

function SkeletonRows() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          height: 46, borderRadius: 10, border: "1px solid rgba(148,163,184,.14)",
          background: "rgba(148,163,184,.06)", animation: "smcPulse 1.4s ease-in-out infinite",
        }} />
      ))}
      <style>{"@keyframes smcPulse{0%,100%{opacity:.55}50%{opacity:1}}"}</style>
    </div>
  );
}

export function EmptyState({ icon = "inbox", title, note }: { icon?: IconName; title: string; note: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "34px 20px", textAlign: "center" }}>
      <span style={{
        width: 44, height: 44, borderRadius: 13, background: "rgba(96,165,250,.1)",
        border: "1px solid rgba(96,165,250,.22)", display: "flex", alignItems: "center", justifyContent: "center", color: "#93c5fd",
      }}>
        <Icon name={icon} size={20} />
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: text.strong }}>{title}</span>
      <span style={{ fontSize: 12, color: text.muted, maxWidth: 420 }}>{note}</span>
    </div>
  );
}

function AdvisoryPanel({ status, message, route }: { status: number; message: string; route: string }) {
  const label = status === 403 ? "SCOPE" : "NOT FOUND";
  return (
    <div style={{
      display: "flex", gap: 10, padding: "14px 16px", borderRadius: 12,
      border: "1px solid rgba(251,191,36,.24)", background: "rgba(251,191,36,.06)",
    }}>
      <Icon name="triangle-alert" size={15} color="#fbbf24" style={{ flex: "0 0 15px", marginTop: 2 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", color: "#fbbf24" }}>{label}</span>
        <span style={{ fontSize: 12.5, color: "#cbd5e1" }}>{message}</span>
        <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.faint }}>{route}</span>
      </div>
    </div>
  );
}

/**
 * Wraps a `useQuery` result with the five designed list states. `route` is
 * the endpoint being read — shown on 403/404 (README: "these matter...
 * scope resolves from the session's MSP claim rather than a route
 * parameter").
 */
export function DataState<T>({
  isLoading, error, isEmpty, route, emptyTitle, emptyNote, children,
}: {
  isLoading: boolean;
  error: Error | null;
  isEmpty: boolean;
  route: string;
  emptyTitle: string;
  emptyNote: string;
  children: ReactNode;
}) {
  if (isLoading) return <SkeletonRows />;
  if (error) {
    const status = error instanceof ApiError ? error.status : 500;
    if (status === 403) {
      return <AdvisoryPanel status={403} message="This scope resolves from the session's own MSP claim, not a route parameter — a PlatformAdmin session without an MSP context cannot see it." route={route} />;
    }
    if (status === 404) {
      return <AdvisoryPanel status={404} message="Not found." route={route} />;
    }
    return <AdvisoryPanel status={status} message={error.message} route={route} />;
  }
  if (isEmpty) return <EmptyState title={emptyTitle} note={emptyNote} />;
  return <>{children}</>;
}

// ── Small layout helpers ─────────────────────────────────────────────────────

export function Fact({ label, value, color = "#cbd5e1", mono = false }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: "#475569" }}>{label}</span>
      <span style={{ fontSize: 12.5, color, fontFamily: mono ? "Menlo, monospace" : "inherit", textWrap: "pretty" }}>{value}</span>
    </div>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <div style={{
      border: "1px solid rgba(148,163,184,.16)", borderRadius: 12, background: "rgba(15,23,42,.6)",
      padding: 15, display: "flex", flexDirection: "column", gap: 12, minWidth: 0,
    }}>
      {children}
    </div>
  );
}

export function TabBar({
  tabs, active, onSelect,
}: {
  tabs: { id: string; label: string; count: number }[]; active: string; onSelect: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            style={{
              display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 7,
              border: `1px solid ${on ? "rgba(96,165,250,.3)" : "rgba(148,163,184,.18)"}`,
              background: on ? "rgba(37,99,235,.18)" : "transparent",
              color: on ? "#bfdbfe" : "#94a3b8", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            {t.label}
            <span style={{ fontSize: 10.5, color: on ? "#60a5fa" : "#475569" }}>{t.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export function HonestNote({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 2 }}>
      <Icon name="info" size={13} color="#475569" style={{ flex: "0 0 13px" }} />
      <span style={{ fontSize: 11, color: "#475569", textWrap: "pretty" }}>{children}</span>
    </div>
  );
}
