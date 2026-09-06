import type { ReactNode } from "react";
import { X } from "lucide-react";

/**
 * SlidePanel — the shared "right-slide detail panel" the README calls out as
 * one design used across the shell for every contextual detail (README
 * "Shared UI patterns"). `ScanLogPanel.tsx` implements this same shape for
 * scan detail; this is the generic version for any page that needs it — the
 * SOPs and Runbooks pages (#2994) are the first two callers outside the shell
 * itself.
 *
 * Desktop: a fixed-width panel sliding from the right edge. Below a narrow
 * viewport it becomes a bottom sheet — same breakpoint and CSS shape as
 * `ScanLogPanel`.
 */
export function SlidePanel({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  narrow = false,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly narrow?: boolean;
}) {
  if (!open) return null;

  return (
    <>
      <div
        className="absolute inset-0 z-20"
        style={{ background: "rgba(2,6,23,.35)" }}
        onClick={onClose}
        data-testid="slide-panel-overlay"
      />
      <div
        className="absolute z-30 flex flex-col"
        style={{
          top: narrow ? "auto" : 0,
          right: 0,
          left: narrow ? 0 : "auto",
          bottom: narrow ? 0 : "auto",
          width: narrow ? "auto" : 368,
          height: narrow ? "auto" : "100%",
          maxHeight: narrow ? "84%" : "100%",
          borderRadius: narrow ? "16px 16px 0 0" : 0,
          borderLeft: narrow ? undefined : "1px solid rgba(255,255,255,.10)",
          borderTop: narrow ? "1px solid rgba(255,255,255,.10)" : undefined,
          background: "#0b1120",
          boxShadow: "-18px 0 48px rgba(0,0,0,.5)",
          minHeight: 0,
        }}
        data-testid="slide-panel"
      >
        <div
          className="flex flex-none items-center gap-[10px]"
          style={{ padding: "16px 18px 14px", borderBottom: "1px solid rgba(255,255,255,.08)" }}
        >
          <div className="flex min-w-0 flex-col gap-[2px]">
            <span className="text-[14px] font-semibold" style={{ color: "#f8fafc" }}>
              {title}
            </span>
            {subtitle ? (
              <span className="text-[11.5px]" style={{ color: "#64748b" }}>
                {subtitle}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid="slide-panel-close"
            className="ml-auto flex size-[30px] items-center justify-center rounded-md hover:bg-white/[.06]"
          >
            <X size={15} color="#64748b" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto" style={{ padding: "16px 18px 20px" }}>
          {children}
        </div>

        {footer ? (
          <div
            className="flex flex-none flex-col gap-2"
            style={{ padding: "12px 18px 16px", borderTop: "1px solid rgba(255,255,255,.08)" }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </>
  );
}

/** A numbered/checked step row — used by both the SOPs detail panel and queue-run detail. */
export function PanelStepRow({
  n,
  label,
  detail,
  done,
}: {
  readonly n: string;
  readonly label: string;
  readonly detail: string;
  readonly done?: boolean;
}) {
  return (
    <div className="flex items-start gap-[11px]">
      <span
        className="flex size-5 flex-none items-center justify-center rounded-full text-[10.5px] font-bold"
        style={{
          border: `1px solid ${done ? "rgba(52,211,153,.45)" : "rgba(255,255,255,.14)"}`,
          background: done ? "rgba(52,211,153,.12)" : "transparent",
          color: done ? "#34d399" : "#94a3b8",
        }}
      >
        {done ? "✓" : n}
      </span>
      <div className="flex min-w-0 flex-col gap-[2px]">
        <span className="text-[12.5px] font-semibold" style={{ color: "#e2e8f0" }}>
          {label}
        </span>
        <span className="text-[11.5px] leading-[1.45]" style={{ color: "#64748b" }}>
          {detail}
        </span>
      </div>
    </div>
  );
}

/** A key/value row with the green-dot bullet the design uses for "recorded fact" rows. */
export function PanelKVRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div
      className="flex items-center gap-[10px]"
      style={{ padding: "11px 0", borderBottom: "1px solid rgba(255,255,255,.06)" }}
    >
      <span className="size-[6px] flex-none rounded-full" style={{ background: "#34d399" }} />
      <div className="flex min-w-0 flex-col gap-[1px]">
        <span className="text-[12px] font-semibold" style={{ color: "#e2e8f0" }}>
          {label}
        </span>
        <span className="text-[11px]" style={{ color: "#64748b" }}>
          {value}
        </span>
      </div>
    </div>
  );
}

export function PanelNote({ children }: { readonly children: ReactNode }) {
  return (
    <span className="text-[11.5px] leading-[1.5]" style={{ color: "#64748b" }}>
      {children}
    </span>
  );
}

/** The panel's own primary-action button, styled the same across every caller. */
export function PanelCta({
  label,
  onClick,
  disabled,
  variant = "primary",
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly variant?: "primary" | "outline";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md text-center text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      style={
        variant === "primary"
          ? { background: "#0078D4", color: "#fff", padding: "11px 0" }
          : {
              background: "transparent",
              color: "#e2e8f0",
              border: "1px solid rgba(255,255,255,.14)",
              padding: "10px 0",
            }
      }
    >
      {label}
    </button>
  );
}

/** A single-line text field, styled to match the design's field boxes. */
export function PanelInput({
  label,
  hint,
  value,
  onChange,
  maxLength,
  autoFocus,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly maxLength?: number;
  readonly autoFocus?: boolean;
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      <span className="text-[11px] font-semibold" style={{ color: "#94a3b8" }}>
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        autoFocus={autoFocus}
        placeholder={hint}
        className="rounded-md text-[13px] outline-none"
        style={{
          border: "1px solid rgba(255,255,255,.10)",
          background: "rgba(255,255,255,.03)",
          padding: "11px 12px",
          color: "#e2e8f0",
        }}
      />
    </div>
  );
}

/** A multi-line text field, same visual family as `PanelInput`. */
export function PanelTextarea({
  label,
  hint,
  value,
  onChange,
  maxLength,
  rows = 3,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly maxLength?: number;
  readonly rows?: number;
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      <span className="text-[11px] font-semibold" style={{ color: "#94a3b8" }}>
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        rows={rows}
        placeholder={hint}
        className="resize-none rounded-md text-[13px] outline-none"
        style={{
          border: "1px solid rgba(255,255,255,.10)",
          background: "rgba(255,255,255,.03)",
          padding: "11px 12px",
          color: "#e2e8f0",
        }}
      />
    </div>
  );
}
