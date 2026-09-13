import type { ReactNode } from "react";
import { surface, text, border, shadow, signal } from "@/console/tokens";

/**
 * The branded card every one of the five real screens renders inside —
 * Authentication.dc.html's "the card the user actually sees" — reproduced
 * with the console's own design tokens (Design/MSP_Console README: same
 * design system, same locked hex values) rather than the prototype's inline
 * hex literals. This mounts standalone, outside AuthGate/ConsoleShell — the
 * pre-login surface has no shell to sit inside (README, "Where they sit in
 * the tree": "Authentication is deliberately not [in the tree] — it is the
 * pre-login surface").
 */
export function AuthLayout({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: surface.canvas,
        color: text.body,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ width: "min(420px, 100%)", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: "linear-gradient(135deg,#0078D4,#00B4D8)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 800, color: "#fff", letterSpacing: "-.02em",
            }}
          >
            SM
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: text.strong }}>Shane McCaw Consulting</span>
            <span style={{ fontSize: 10.5, color: text.label }}>{caption}</span>
          </div>
        </div>

        <div
          style={{
            border: `1px solid ${border.card}`,
            borderRadius: 14,
            background: surface.card,
            boxShadow: shadow.popover,
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>{children}</span>;
}

export function TextField(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        height: 36, padding: "0 11px", borderRadius: 6,
        border: "1px solid rgba(148,163,184,.22)", background: "rgba(2,6,23,.6)",
        color: text.strong, fontSize: 13, fontFamily: "inherit", outline: "none", minWidth: 0,
        ...props.style,
      }}
    />
  );
}

export function PrimaryButton({
  children, disabled, onClick, type = "button",
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        height: 38, borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb",
        color: "#fff", fontSize: 13, fontWeight: 600, cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit", opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children, onClick, disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        height: 32, padding: "0 12px", borderRadius: 6,
        border: "1px solid rgba(148,163,184,.2)", background: "rgba(148,163,184,.06)",
        color: text.secondary, fontSize: 12, fontWeight: 600, cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit", opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

export type MessageTone = "critical" | "warning" | "ok" | "info";

export function InlineMessage({ tone, code, text: body }: { tone: MessageTone; code?: string; text: string }) {
  const t = signal[tone];
  return (
    <div
      style={{
        border: `1px solid ${t.border}`, borderRadius: 8, background: t.tint,
        padding: "11px 12px", display: "flex", flexDirection: "column", gap: 4,
      }}
    >
      {code && <span style={{ fontSize: 11.5, fontWeight: 700, color: t.strong }}>{code}</span>}
      <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{body}</span>
    </div>
  );
}
