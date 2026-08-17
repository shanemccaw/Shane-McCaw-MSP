/**
 * Active Directory — shared canvas primitives.
 *
 * The visual vocabulary (section → tiles/rows, chip, arm-then-confirm button)
 * is lifted from `Design/adminv2/Admin Shell.dc.html`'s own AD canvas
 * (`adSection`/`adTile`/`adListRow`/`adChip`, `adColStyle`'s block) — the same
 * language the shell's own `Peek` uses for facts and armed actions, just
 * rendered inline in the doc column instead of an overlay, since this is a
 * screen opened "properly" rather than a quick peek.
 */

import { useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { ACCENT, ACCENT_TEXT, FONT, LINE, PRIMARY_OVERLAY, SURFACE, TEXT } from "../../theme";

// ── Section ────────────────────────────────────────────────────────────────

export function AdSection({
  title,
  note,
  actions,
  children,
}: {
  title: string;
  note?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <span
          style={{
            flex: "none",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: ".07em",
            textTransform: "uppercase",
            color: TEXT.groupLabel,
          }}
        >
          {title}
        </span>
        <div style={{ flex: 1, minWidth: 4, height: 1, background: LINE.quiet }} />
        {actions && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{actions}</div>}
      </div>
      {note && (
        <span style={{ fontSize: 11.5, lineHeight: 1.5, color: TEXT.caption, textWrap: "pretty" } as CSSProperties}>
          {note}
        </span>
      )}
      {children}
    </div>
  );
}

// ── Tiles ──────────────────────────────────────────────────────────────────

export function AdTileGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 9 }}>
      {children}
    </div>
  );
}

export function AdTile({
  label,
  value,
  hint,
  accent,
  copyValue,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
  copyValue?: string;
}) {
  const [copied, setCopied] = useState(false);
  const textToCopy = copyValue ?? value;
  return (
    <div
      style={{
        minWidth: 0,
        padding: "10px 12px",
        borderRadius: 7,
        border: `1px solid ${LINE.base}`,
        background: SURFACE.card,
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 10.5,
            letterSpacing: ".05em",
            textTransform: "uppercase",
            color: TEXT.label,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </span>
        <button
          onClick={async (e) => {
            e.stopPropagation();
            await navigator.clipboard.writeText(textToCopy);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          title={copied ? "Copied" : "Copy"}
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            border: 0,
            background: "transparent",
            color: copied ? ACCENT_TEXT.green : TEXT.dim,
            cursor: "pointer",
            padding: 0,
          }}
        >
          {copied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={1.8} />}
        </button>
      </div>
      <span
        style={{
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: "-.01em",
          color: accent ?? TEXT.primary,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </span>
      {hint && <span style={{ fontSize: 11, color: TEXT.label }}>{hint}</span>}
    </div>
  );
}

// ── List rows ──────────────────────────────────────────────────────────────

export function AdListRowGroup({ children }: { children: ReactNode }) {
  return (
    <div style={{ border: `1px solid ${LINE.base}`, borderRadius: 8, background: SURFACE.card, overflow: "hidden" }}>
      {children}
    </div>
  );
}

export function AdListRow({
  label,
  detail,
  meta,
  metaAccent,
  dot,
  labelAccent,
  onClick,
  onContextMenu,
  actions,
}: {
  label: string;
  detail?: string;
  meta?: string;
  metaAccent?: string;
  dot?: string;
  labelAccent?: string;
  onClick?: () => void;
  onContextMenu?: (event: ReactMouseEvent) => void;
  actions?: ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={onClick ? "av2-row" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "9px 12px",
        borderBottom: `1px solid ${LINE.subtle}`,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {dot && <span style={{ flex: "none", width: 7, height: 7, borderRadius: "50%", background: dot }} />}
      <div style={{ flex: "1 1 210px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span
          style={{
            fontSize: 12.5,
            color: labelAccent ?? TEXT.strong,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </span>
        {detail && (
          <span
            style={{ fontSize: 11.5, lineHeight: 1.45, color: TEXT.label, textWrap: "pretty" } as CSSProperties}
          >
            {detail}
          </span>
        )}
      </div>
      {meta && (
        <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11.5, color: metaAccent ?? TEXT.label }}>
          {meta}
        </span>
      )}
      {actions && (
        <div style={{ flex: "none", display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}

export function AdEmptyRow({ label }: { label: string }) {
  return (
    <div style={{ padding: "12px 12px", fontSize: 11.5, color: TEXT.faint, fontStyle: "italic" }}>{label}</div>
  );
}

// ── Chips ──────────────────────────────────────────────────────────────────

export type AdTone = "good" | "warn" | "bad" | "neutral";

const TONE_COLOR: Record<AdTone, string> = {
  good: ACCENT_TEXT.green,
  warn: ACCENT.amber,
  bad: ACCENT_TEXT.danger,
  neutral: TEXT.dim,
};
const TONE_BORDER: Record<AdTone, string> = {
  good: "rgba(108,203,150,.35)",
  warn: "rgba(233,185,73,.4)",
  bad: "rgba(229,122,122,.4)",
  neutral: LINE.control,
};

export function AdChip({ label, tone = "neutral" }: { label: string; tone?: AdTone }) {
  return (
    <span
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "2px 9px",
        borderRadius: 10,
        fontSize: 10.5,
        border: `1px solid ${TONE_BORDER[tone]}`,
        color: TONE_COLOR[tone],
      }}
    >
      {label}
    </span>
  );
}

// ── Buttons ────────────────────────────────────────────────────────────────

export type AdButtonTone = "primary" | "default" | "danger";

const BTN_BASE: CSSProperties = {
  flex: "none",
  whiteSpace: "nowrap",
  padding: "5px 11px",
  borderRadius: 5,
  fontFamily: FONT.sans,
  fontSize: 11.5,
  cursor: "pointer",
};

export function AdButton({
  label,
  tone = "default",
  onClick,
  disabled,
  title,
}: {
  label: string;
  tone?: AdButtonTone;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const style: CSSProperties =
    tone === "primary"
      ? { ...BTN_BASE, border: 0, background: PRIMARY_OVERLAY, color: "#fff", fontWeight: 600 }
      : tone === "danger"
        ? { ...BTN_BASE, border: `1px solid rgba(229,122,122,.35)`, background: "transparent", color: ACCENT_TEXT.danger }
        : { ...BTN_BASE, border: `1px solid ${LINE.control}`, background: "transparent", color: TEXT.quiet };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ ...style, opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" }}
    >
      {label}
    </button>
  );
}

/**
 * Arm-then-confirm in place — no second dialog, matching `Peek`'s
 * `ActionButton` exactly (SHELL.md: "the user does not want to be taken away
 * from what they were doing for a one-off"). Local state here since these
 * rows render inline in the doc column, not inside the shell's `Peek`
 * overlay.
 */
export function AdArmedButton({
  label,
  armedLabel,
  tone = "danger",
  onConfirm,
  title,
}: {
  label: string;
  armedLabel?: string;
  tone?: AdButtonTone;
  onConfirm: () => void;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <AdButton
      label={armed ? armedLabel ?? `${label} — press again` : label}
      tone={tone}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
      title={title ?? (armed ? "Press again to do it. There is no undo." : "You will get one more press to change your mind.")}
    />
  );
}

// ── Outcome banner ─────────────────────────────────────────────────────────

export function AdOutcome({
  tone,
  message,
  onDismiss,
}: {
  tone: "ok" | "error";
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        borderBottom: `1px solid ${LINE.base}`,
        background: tone === "ok" ? "rgba(127,174,145,.08)" : "rgba(229,122,122,.1)",
      }}
    >
      <span
        style={{
          flex: "none",
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: tone === "ok" ? ACCENT_TEXT.green : ACCENT_TEXT.danger,
        }}
      />
      <span style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.5, color: TEXT.strong }}>{message}</span>
      <button
        onClick={onDismiss}
        title="Dismiss"
        style={{
          flex: "none",
          border: 0,
          background: "transparent",
          color: TEXT.dim,
          cursor: "pointer",
          fontSize: 13,
          lineHeight: 1,
          padding: 2,
        }}
      >
        ×
      </button>
    </div>
  );
}

// ── Canvas chrome ──────────────────────────────────────────────────────────

export function AdCanvasHeader({
  icon: Icon,
  name,
  kindLabel,
  chips,
  actions,
}: {
  icon: (props: { size?: number; strokeWidth?: number }) => ReactNode;
  name: string;
  kindLabel: string;
  chips?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "10px 16px",
        borderBottom: `1px solid ${LINE.base}`,
        background: SURFACE.chrome,
      }}
    >
      <span style={{ flex: "none", display: "flex", color: TEXT.dim }}>
        <Icon size={16} strokeWidth={1.8} />
      </span>
      <span
        style={{
          flex: "0 1 auto",
          minWidth: 70,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "-.01em",
          color: TEXT.primary,
        }}
      >
        {name}
      </span>
      <span
        style={{
          flex: "none",
          whiteSpace: "nowrap",
          padding: "1px 7px",
          borderRadius: 9,
          border: `1px solid ${LINE.control}`,
          fontSize: 10.5,
          color: TEXT.dim,
        }}
      >
        {kindLabel}
      </span>
      {chips}
      <div style={{ flex: 1, minWidth: 4 }} />
      {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}

export function AdCanvasBody({ children }: { children: ReactNode }) {
  return (
    <div
      data-noscrollbar="true"
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        padding: "16px 18px 26px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      {children}
    </div>
  );
}

export function AdCanvasColumn({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: SURFACE.app,
      }}
    >
      {children}
    </div>
  );
}

export function AdLoading() {
  return <div style={{ padding: 24, fontSize: 12.5, color: TEXT.caption }}>Loading…</div>;
}

export function AdLoadError({ message }: { message: string }) {
  return (
    <div style={{ padding: 24, fontSize: 12.5, color: ACCENT_TEXT.danger, textWrap: "pretty" } as CSSProperties}>
      {message}
    </div>
  );
}
