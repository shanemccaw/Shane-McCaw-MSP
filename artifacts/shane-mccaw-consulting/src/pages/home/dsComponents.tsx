import { type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from "react";

/** Small local ports of the Shane McCaw MSP design-system components used by
 * the Copilot Readiness Marketing Site mockup — scoped to this page only. */

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive" | "link";
type ButtonSize = "default" | "sm" | "lg" | "icon";

interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  as?: "button" | "a";
  className?: string;
  children?: ReactNode;
}

const BTN_SIZE: Record<ButtonSize, React.CSSProperties> = {
  default: { minHeight: "2.25rem", padding: ".5rem 1rem", fontSize: ".875rem" },
  sm: { minHeight: "2rem", padding: "0 .75rem", fontSize: ".75rem" },
  lg: { minHeight: "2.5rem", padding: "0 2rem", fontSize: ".875rem" },
  icon: { height: "2.25rem", width: "2.25rem", padding: 0 },
};

const BTN_VARIANT: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: "#2563eb", color: "#fff", borderColor: "#2563eb", boxShadow: "0 8px 24px -6px rgba(37,99,235,.4)" },
  secondary: { background: "#1e293b", color: "#e2e8f0", borderColor: "#1e293b" },
  outline: { background: "transparent", borderColor: "rgba(148,163,184,.4)", color: "inherit" },
  ghost: { background: "transparent", borderColor: "transparent", color: "inherit" },
  destructive: { background: "#ef4444", color: "#fff", borderColor: "#ef4444" },
  link: { background: "transparent", borderColor: "transparent", color: "#60a5fa", paddingLeft: 0, paddingRight: 0 },
};

export function Button({
  variant = "primary",
  size = "default",
  as = "button",
  className = "",
  style,
  children,
  ...props
}: ButtonProps & ButtonHTMLAttributes<HTMLButtonElement> & AnchorHTMLAttributes<HTMLAnchorElement> & { style?: React.CSSProperties }) {
  const Comp = as as any;
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: ".5rem",
    whiteSpace: "nowrap",
    fontFamily: "inherit",
    fontWeight: 500,
    borderRadius: ".75rem",
    cursor: props.disabled ? "not-allowed" : "pointer",
    opacity: props.disabled ? 0.5 : 1,
    transition: "background-color .15s,box-shadow .15s,transform .15s",
    border: "1px solid transparent",
    userSelect: "none",
    textDecoration: "none",
  };
  return (
    <Comp className={className} style={{ ...base, ...BTN_SIZE[size], ...BTN_VARIANT[variant], ...style }} {...props}>
      {children}
    </Comp>
  );
}

export function Eyebrow({
  pill = true,
  className = "",
  children,
}: {
  pill?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: ".5rem",
    fontSize: ".75rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: ".1em",
    lineHeight: 1,
  };
  const style: React.CSSProperties = pill
    ? {
        ...base,
        padding: ".4rem .875rem",
        borderRadius: "9999px",
        background: "rgba(37,99,235,.1)",
        border: "1px solid rgba(37,99,235,.2)",
        color: "#3b82f6",
      }
    : { ...base, color: "#60a5fa" };
  return (
    <span className={className} style={style}>
      {children}
    </span>
  );
}

export function Logo({
  size = "md",
  tagline = "M365 Governance",
  onDark = false,
}: {
  size?: "sm" | "md" | "lg";
  tagline?: string;
  onDark?: boolean;
}) {
  const S = { sm: { tile: 32, radius: 9, mark: 14, name: 15 }, md: { tile: 40, radius: 12, mark: 17, name: 18 }, lg: { tile: 56, radius: 16, mark: 24, name: 26 } }[size];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: ".75rem", textDecoration: "none" }}>
      <span
        style={{
          width: S.tile,
          height: S.tile,
          borderRadius: S.radius,
          background: "linear-gradient(135deg,#0078D4,#00B4D8)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 800,
          letterSpacing: "-1px",
          boxShadow: "0 4px 12px -4px rgba(0,120,212,.5)",
          flexShrink: 0,
          fontSize: S.mark,
        }}
      >
        SM
      </span>
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
        <span style={{ fontWeight: 700, letterSpacing: "-.01em", fontSize: S.name, color: onDark ? "#fff" : "#0A2540" }}>
          Shane McCaw
        </span>
        {tagline && (
          <span
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              fontWeight: 600,
              letterSpacing: ".12em",
              color: onDark ? "rgba(255,255,255,.6)" : "#64748b",
            }}
          >
            {tagline}
          </span>
        )}
      </span>
    </span>
  );
}
