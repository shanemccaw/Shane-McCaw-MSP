/**
 * MSP Console design tokens — taken verbatim from the Shane McCaw MSP Design
 * System (`Design/MSP_Console/design_handoff_msp_console/README.md`, "Design
 * tokens"). The console renders its chrome with these exact hex/rgba values
 * inline, the same way the `.dc.html` reference does, because the design is
 * locked high-fidelity: "Reproduce them. Every hex value and pixel measurement
 * below is taken directly from the source."
 *
 * This is a token vocabulary, not fabricated content — no data lives here.
 */

/** Surfaces — depth comes from these four plus borders, never shadows. */
export const surface = {
  canvas: "#020617",
  header: "#0A2540",
  sidebar: "#061527",
  breadcrumb: "#050f1e",
  card: "rgba(15, 23, 42, .6)",
  popover: "#0f172a",
} as const;

/** Text ramp, page-title-strongest to faintest-label. */
export const text = {
  title: "#f8fafc",
  strong: "#f1f5f9",
  body: "#e2e8f0",
  secondary: "#cbd5e1",
  muted: "#94a3b8",
  label: "#64748b",
  faint: "#475569",
} as const;

/** Semantic signal colours — strong / text / tint / border quartets. */
export const signal = {
  critical: { strong: "#f87171", text: "#fca5a5", tint: "rgba(248,113,113,.12)", border: "rgba(248,113,113,.35)" },
  warning: { strong: "#fbbf24", text: "#fcd34d", tint: "rgba(251,191,36,.10)", border: "rgba(251,191,36,.28)" },
  ok: { strong: "#34d399", text: "#6ee7b7", tint: "rgba(52,211,153,.10)", border: "rgba(52,211,153,.30)" },
  info: { strong: "#60a5fa", text: "#93c5fd", tint: "rgba(96,165,250,.10)", border: "rgba(96,165,250,.30)" },
  brandSub: "#7dd3fc",
  notice: { strong: "#a78bfa", tint: "rgba(167,139,250,.08)", border: "rgba(167,139,250,.24)" },
  neutral: { strong: "#94a3b8", tint: "rgba(148,163,184,.06)", border: "rgba(148,163,184,.18)" },
} as const;

/** Action blue — primary buttons and selected tree rows. */
export const action = {
  base: "#2563eb",
  hover: "#3b82f6",
  glow: "0 8px 24px rgba(37,99,235,.28)",
  selectedRow: "rgba(37,99,235,.22)",
  selectedRowSoft: "rgba(37,99,235,.16)",
  selectedRoot: "rgba(37,99,235,.2)",
} as const;

/** Borders — hairline, translucent. */
export const border = {
  card: "rgba(148,163,184,.16)",
  soft: "rgba(148,163,184,.12)",
  faint: "rgba(148,163,184,.08)",
  header: "rgba(148,163,184,.16)",
  sidebar: "rgba(148,163,184,.14)",
  hover: "rgba(96,165,250,.4)",
} as const;

export const shadow = {
  popover: "0 24px 48px rgba(2,6,23,.6)",
  palette: "0 32px 64px rgba(2,6,23,.7)",
} as const;

/** The four tenant status-dot colours (README "Tree sidebar"). */
export const statusDot = {
  healthy: "#34d399",
  warnings: "#fbbf24",
  critical: "#f87171",
  neverScanned: "#64748b",
} as const;

export type StatusDotKind = keyof typeof statusDot;
