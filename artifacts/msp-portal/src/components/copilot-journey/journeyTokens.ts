/**
 * journeyTokens.ts — the fixed colour, type and motion vocabulary for the
 * Copilot Readiness journey (Reveal → Documents → SOW → Checkout).
 *
 * WHY LITERALS AND NOT CSS CUSTOM PROPERTIES
 * ------------------------------------------
 * The `Design/_ds` export ships a `tokens/colors.css` that declares the *same*
 * token names this app already declares (`--background`, `--primary`, `--accent`,
 * `--destructive`, …) but with the navy/Electric-Blue marketing values, on bare
 * `:root`. Importing it would land those at equal specificity and later source
 * order and silently repaint the entire portal navy — and it omits every
 * `--status-*` token this app's components actually consume. So `_ds` is treated
 * as reference documentation, not an importable stylesheet, and the values it
 * resolves to are recorded here as literals instead.
 *
 * The second reason is that these four screens are full-bleed and theme-fixed by
 * design: the Reveal, the SOW and the Checkout are dark on `#020617`; the
 * Document Viewer is light on `#F7F9FC`. Reading ambient `hsl(var(--card-border))`
 * would make each screen flip with the user's portal light/dark toggle, which is
 * exactly what the handoff does not want — the Document Viewer is *deliberately*
 * light against a navy sidebar whichever way the portal is set.
 *
 * This mirrors the precedent already set by the War Room port, which scopes its
 * page-level rules onto `.wr-root` and writes its palette inline.
 */

/* ------------------------------------------------------------------ *
 * Brand core — the values `Design/_ds/tokens/colors.css` resolves to.
 * ------------------------------------------------------------------ */
export const BRAND = {
  navy: "#0A2540",
  blue: "#0078D4",
  blueStrong: "#005A9E",
  teal: "#00B4D8",
  offWhite: "#F7F9FC",
  white: "#FFFFFF",
  /** slate-950 — the dark canvas Screens 1, 3 and 4 sit on. */
  canvas: "#020617",
} as const;

/**
 * The delta treatment. Every projected/after value in the journey uses this
 * gradient, and every delta figure uses `teal` — never a severity colour, because
 * an improvement is not a severity.
 */
export const DELTA_GRADIENT = `linear-gradient(90deg,${BRAND.blue},${BRAND.teal})`;

/* ------------------------------------------------------------------ *
 * Pillar identity colours — FIXED. Never severity-driven.
 *
 * These say *what a finding is*. A Compliance score of 29 is red and a
 * Compliance score of 90 is green; Compliance's own `#F3F4F6` plays no part in
 * that. Keeping the two axes separate is the whole colour language of the
 * handoff, and it is why `severityColor()` below takes a score and not a pillar.
 *
 * The keys match `WAR_ROOM_PILLAR_KEYS` (minus `copilot`, which is the centre of
 * the composition rather than one of the six satellites), so a payload from
 * `GET /api/portal/assessment/war-room-pillars` indexes straight into this map.
 * ------------------------------------------------------------------ */
export const PILLAR_KEYS = [
  "governance",
  "security",
  "compliance",
  "licensing",
  "adoption",
  "health",
] as const;

export type PillarKey = (typeof PILLAR_KEYS)[number];

export interface PillarIdentity {
  readonly key: PillarKey;
  readonly label: string;
  /** Identity colour — eyebrows, swatches, wedge fills, sparkline stroke. */
  readonly primary: string;
  /** Lighter partner, used where the primary would not hold on a light surface. */
  readonly accent: string;
}

export const PILLARS: Readonly<Record<PillarKey, PillarIdentity>> = {
  governance: { key: "governance", label: "Governance", primary: "#3B82F6", accent: "#60A5FA" },
  security: { key: "security", label: "Security", primary: "#8B5CF6", accent: "#A78BFA" },
  compliance: { key: "compliance", label: "Compliance", primary: "#F3F4F6", accent: "#D1D5DB" },
  licensing: { key: "licensing", label: "Licensing", primary: "#14B8A6", accent: "#2DD4BF" },
  adoption: { key: "adoption", label: "Adoption", primary: "#F97316", accent: "#FB923C" },
  health: { key: "health", label: "Health", primary: "#22C55E", accent: "#4ADE80" },
};

/** Ordered identity list — the satellite order, clockwise from 12 o'clock. */
export const PILLAR_ORDER: readonly PillarIdentity[] = PILLAR_KEYS.map((k) => PILLARS[k]);

/**
 * The Copilot identity mark at the centre. A constant blue → violet → cyan →
 * white spectrum: it never changes with the score, because identity is constant
 * and severity is what tells the truth.
 */
export const COPILOT_ORB_CONIC =
  "conic-gradient(from 0deg,#3B82F6,#8B5CF6,#22D3EE,#F3F4F6,#8B5CF6,#3B82F6)";

/* ------------------------------------------------------------------ *
 * Severity — UNIVERSAL. Never pillar-driven.
 * ------------------------------------------------------------------ */
export type Severity = "critical" | "attention" | "healthy";

export const SEVERITY_ON_DARK: Readonly<Record<Severity, string>> = {
  critical: "#f87171",
  attention: "#fbbf24",
  healthy: "#34d399",
};

export const SEVERITY_ON_LIGHT: Readonly<Record<Severity, string>> = {
  critical: "#dc2626",
  attention: "#d97706",
  healthy: "#15803d",
};

export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  critical: "Critical",
  attention: "Attention required",
  healthy: "Healthy",
};

/**
 * Score → severity band. The thresholds are the summary rail's own
 * (`green >= 60`, `amber >= 50`, red below), applied everywhere so a pillar
 * scoring 57 is amber on the Reveal, amber in the report and amber in the SOW
 * rather than three different colours for one number.
 *
 * `null` (a pillar with no evaluable rule feeding it) is deliberately NOT mapped
 * onto a severity — callers must render an unavailable state instead, never
 * a red 0.
 */
export function severityForScore(score: number): Severity {
  if (score >= 60) return "healthy";
  if (score >= 50) return "attention";
  return "critical";
}

export function severityColor(score: number, surface: "dark" | "light" = "dark"): string {
  const band = severityForScore(score);
  return surface === "dark" ? SEVERITY_ON_DARK[band] : SEVERITY_ON_LIGHT[band];
}

/* ------------------------------------------------------------------ *
 * Neutrals
 * ------------------------------------------------------------------ */
export const INK = {
  /** Headings on dark. */
  headingDark: "#f8fafc",
  /** Body on dark. */
  bodyDark: "#94a3b8",
  /** Slightly brighter body, used for the verdict line and scan status. */
  bodyDarkStrong: "#cbd5e1",
  /** Micro-labels / eyebrows. */
  micro: "#64748b",
  /** De-emphasised numerals — the "before" half of a before → after pair. */
  deemphasised: "#475569",
  /** Hairline borders on dark. */
  hairlineDark: "rgba(30,41,59,.9)",
  /** Borders on light. */
  borderLight: "#e7ebf0",
  /** Body on light. */
  bodyLight: "#3d5875",
  /** Link blue, both surfaces. */
  link: "#60a5fa",
  linkHover: "#93c5fd",
} as const;

/**
 * Text on the navy chrome — the Document Viewer's sidebar and the ShaneBot
 * panel.
 *
 * The design writes these as `color-mix(in oklab, hsl(var(--sidebar-foreground))
 * N%, var(--brand-navy))` at five percentages. Those are resolved to sRGB
 * literals here for the same reason the rest of this module is literal: the
 * `--sidebar-foreground` those expressions read is the `_ds` export's value,
 * not this app's, so evaluating them live against the portal's own token would
 * mix toward the wrong colour entirely.
 */
export const INK_ON_NAVY = {
  /** 48% — placeholder text in the disabled ShaneBot input. */
  faint: "#5b7186",
  /** 58% — eyebrows, metadata, the credibility line. */
  muted: "#6b8096",
  /** 70% — body copy on navy. */
  body: "#8496a8",
  /** 84% — inactive switcher rows. */
  strong: "#a3b1bf",
  /** 88% — the "Asking about" context line. */
  strongest: "#adbac6",
} as const;

/* ------------------------------------------------------------------ *
 * Radii — 6px inputs/buttons · 10–14px cards · 16px emphasis panels ·
 * 999px pills · 11px icon tiles.
 * ------------------------------------------------------------------ */
export const RADIUS = {
  control: 6,
  card: 10,
  cardLarge: 14,
  panel: 16,
  pill: 999,
  iconTile: 11,
} as const;

/* ------------------------------------------------------------------ *
 * Motion. 150–260ms for state transitions; no bounces anywhere except the
 * deliberate weighted landing on a critical pillar's count-up.
 * ------------------------------------------------------------------ */
export const MOTION = {
  /** Scene-0 radar sheen sweep. */
  radarSheenMs: 9000,
  /** Scene-1 verdict count-up + ring settle. */
  verdictMs: 2600,
  /** ShaneBot expand. */
  botOpacityMs: 220,
  botTransformMs: 260,
  botEase: "cubic-bezier(.2,.8,.2,1)",
  /** Generic state transition band. */
  stateMinMs: 150,
  stateMaxMs: 260,
  /** Checkout kickoff rise. */
  kickoffMs: 520,
  /** Document-switcher "still generating" pulse. */
  genPulseMs: 1600,
} as const;

/**
 * Numerals are tabular everywhere in this journey — a count-up that reflows its
 * own width reads as broken.
 */
export const TABULAR = { fontVariantNumeric: "tabular-nums" } as const;

/**
 * The eight reports **as the design names them**, in generation order.
 *
 * This is the prototype's own list, NOT the platform's document catalogue —
 * the design's earlier 9-title revision was checked against `document_types`
 * and found 3 titles with no seeded type behind them; this revised 8-title
 * list has not been re-checked against the live catalogue (no DB access in
 * this environment), so the same caveat applies until it is. So this is
 * reference copy for the design preview only.
 *
 * It is deliberately NOT used as a live fallback. `buildGeneration()` reads the
 * tenant's real `documents.expected` set and renders an unavailable state when
 * there isn't one — printing a deliverable name the platform cannot produce
 * would be exactly the fabricated-fact failure the data contract forbids, and a
 * fetch failure is the case where a fallback list would fire.
 */
export const JOURNEY_DESIGN_DOCUMENTS = [
  "Copilot Readiness, Safety & Enablement Report",
  "Microsoft 365 Security Posture & Blast Radius Report",
  "Microsoft 365 Governance Posture Report",
  "Microsoft 365 Compliance & Regulatory Alignment Report",
  "Copilot Licensing Alignment Report",
  "Copilot Adoption & Workflow Readiness Report",
  "Microsoft 365 Operational Health & Service Integrity Report",
  "Full Remediation Guide — Copilot Gate Clearance Plan",
] as const;

export const JOURNEY_DESIGN_DOCUMENT_COUNT = JOURNEY_DESIGN_DOCUMENTS.length;
