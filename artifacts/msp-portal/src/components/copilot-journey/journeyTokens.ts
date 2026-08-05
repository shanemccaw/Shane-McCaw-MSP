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
 * Single-path glyphs for each pillar, plus the Copilot sparkle that stands for
 * the roll-up report. Verbatim from the design project's own `scraps/
 * pillar-icons.json`, which is where the prototype keeps them — so the header
 * strip, the switcher rows and the report eyebrows all draw the same mark.
 *
 * One `<path d>` each, sized for a 24×24 viewBox with round caps and joins.
 */
export const PILLAR_ICON_PATHS: Readonly<Record<PillarKey | "copilot", string>> = {
  governance:
    "M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1 1 0 0 1 1.3 0C14.3 3.8 16.8 5 18.8 5a1 1 0 0 1 1 1zM9 12l2 2 4-4",
  security:
    "M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1 1 0 0 1 1.3 0C14.3 3.8 16.8 5 18.8 5a1 1 0 0 1 1 1z",
  compliance:
    "M16 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1zM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1zM7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2",
  licensing:
    "M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76zM16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 18V6",
  adoption: "M18 21a8 8 0 0 0-16 0M10 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3",
  health:
    "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
  copilot:
    "M12 3l1.7 4.4L18 9l-4.3 1.6L12 15l-1.7-4.4L6 9l4.3-1.6zM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z",
};

/**
 * The per-report accent: what tints the reading pane's ambient glow, the 3px
 * band across the top of the reading card, and the eyebrow's icon.
 *
 * `null` is the roll-up Copilot Readiness report — it belongs to no single
 * pillar, so it takes the journey's own blue→teal rather than borrowing one
 * pillar's identity and implying the report is about that pillar.
 */
export interface ReportAccent {
  readonly colour: string;
  readonly band: string;
  readonly glow: string;
  readonly icon: string;
}

/**
 * The full-spectrum treatment the three multi-pillar documents share — the
 * roll-up report, the remediation guide and the statement of work. The design is
 * explicit about why: they span all six pillars, so they take the Copilot
 * identity "rather than a seventh invented colour".
 */
const SPECTRUM_BAND = "linear-gradient(90deg,#3B82F6,#8B5CF6,#22D3EE,#F3F4F6)";

/**
 * Per-document ambient glow, verbatim from the design's own `GLOWS` table rather
 * than computed from the pillar colour at a fixed alpha.
 *
 * They are hand-tuned and not interchangeable: Compliance's near-white gets a
 * cooler, lower-opacity two-stop mix so it reads as light rather than as a
 * washed-out grey, and Adoption's orange is pulled down to .26 where the others
 * sit at .28–.30. A derived `colour @ 16%` looked plausible and was wrong on
 * every one of them.
 */
const PILLAR_GLOWS: Readonly<Record<PillarKey, string>> = {
  governance: "radial-gradient(closest-side, rgba(59,130,246,.30), rgba(2,6,23,0) 100%)",
  security: "radial-gradient(closest-side, rgba(139,92,246,.30), rgba(2,6,23,0) 100%)",
  compliance:
    "radial-gradient(closest-side, rgba(226,232,240,.22), rgba(148,163,184,.12) 58%, rgba(2,6,23,0) 100%)",
  licensing: "radial-gradient(closest-side, rgba(20,184,166,.30), rgba(2,6,23,0) 100%)",
  adoption: "radial-gradient(closest-side, rgba(249,115,22,.26), rgba(2,6,23,0) 100%)",
  health: "radial-gradient(closest-side, rgba(34,197,94,.28), rgba(2,6,23,0) 100%)",
};

const SPECTRUM_GLOW =
  "radial-gradient(closest-side, rgba(59,130,246,.30), rgba(139,92,246,.20) 46%, rgba(34,211,238,.14) 70%, rgba(2,6,23,0) 100%)";

export function reportAccent(pillar: PillarKey | null): ReportAccent {
  if (pillar === null) {
    return {
      // Teal for the icon stroke, because a gradient cannot stroke an SVG path —
      // the design's own `ICON_COLORS` makes the same substitution.
      colour: BRAND.teal,
      band: SPECTRUM_BAND,
      glow: SPECTRUM_GLOW,
      icon: PILLAR_ICON_PATHS.copilot,
    };
  }
  const identity = PILLARS[pillar];
  return {
    colour: identity.primary,
    band: `linear-gradient(90deg,${identity.primary},${identity.accent})`,
    glow: PILLAR_GLOWS[pillar],
    icon: PILLAR_ICON_PATHS[pillar],
  };
}

/** `#RRGGBB` + alpha → `rgba(...)`. The identity colours are all six-digit hex. */
export function hexAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

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
 * The Copilot Gate
 * ------------------------------------------------------------------ */

/**
 * The score a tenant has to reach before Copilot is safe to turn on — the real
 * Copilot Gate, confirmed by Shane (#359). At or above 82 = Go. Below 82 =
 * No-Go. The boundary case was raised explicitly and answered explicitly: 82
 * itself is a Go.
 *
 * THIS IS THE ONLY GATE NUMBER IN THE JOURNEY. It was 60 until #359, for a
 * reason that has now been resolved rather than abandoned: the chrome could not
 * be allowed to compute a gate at 82 while `verdictLabel()` called the same
 * score "cleared for rollout" at 60 — two verdicts on one number. The fix is
 * that both now read this constant, so the Reveal's verdict, the Document
 * Viewer's gate chip and rail, and the SOW's projected-score line state one
 * thing about one tenant. `StatementOfWorkBody`'s own `SOW_GATE_TARGET` — the
 * one place already carrying 82 — was folded into this too.
 *
 * Distinct from `severityForScore` on purpose, and the two are NOT in conflict:
 * severity is the design's colour banding for any score (green >= 60, amber
 * >= 50, red below), applied to pillar scores and projections alike; the Gate is
 * a single Go/No-Go on the Copilot pillar. A tenant at 70 is legitimately a
 * green number that has not cleared the Gate, and the copy says exactly that.
 *
 * Server-side mirror: `copilot-gate.ts`'s `COPILOT_GATE_THRESHOLD`. The two apps
 * cannot import across each other, so each side asserts the value in its own
 * test.
 */
export const COPILOT_GATE_TARGET = 82;

/** "Not safe yet" / "Safe to deploy" — the revised design's wording for the gate. */
export function gateLabel(score: number): string {
  return score >= COPILOT_GATE_TARGET ? "Safe to deploy" : "Not safe yet";
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
 * Text on the navy chrome — the Document Viewer's sidebar.
 *
 * The design writes these as `color-mix(in oklab, hsl(var(--sidebar-foreground))
 * N%, var(--brand-navy))` at five percentages. Those are resolved to sRGB
 * literals here for the same reason the rest of this module is literal: the
 * `--sidebar-foreground` those expressions read is the `_ds` export's value,
 * not this app's, so evaluating them live against the portal's own token would
 * mix toward the wrong colour entirely.
 */
export const INK_ON_NAVY = {
  /** 48% — the de-emphasised "/ 100" beside the rail's gate score. */
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
  /* The design's ShaneBot expand timings (220ms opacity / 260ms transform on
     `cubic-bezier(.2,.8,.2,1)`) lived here. ShaneBot is removed for this
     release and they had no other consumer. */
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
 * The nine documents **as the design names them**, in generation order.
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
  "Statement of Work — Copilot Gate Clearance",
] as const;

/**
 * The two documents that are not reports. They render their own bodies rather
 * than a `ReportSection[]`, and the customer acts on both: the guide's steps get
 * ticked off, the SOW's phases get switched in and out of scope before signing.
 */
export const JOURNEY_REMEDIATION_DOCUMENT = "Full Remediation Guide — Copilot Gate Clearance Plan";
export const JOURNEY_SOW_DOCUMENT = "Statement of Work — Copilot Gate Clearance";

/**
 * The roll-up readiness report — the one document the viewer renders from the
 * tenant's own live data rather than from the platform's generated HTML (#409).
 *
 * MATCHED ON `docType`, NOT TITLE. `document_types` is the real catalogue and
 * `copilot_readiness` is its real key (seeded by
 * `lib/db/migrations/manual/2026-07-20-document-types.sql`, label "Copilot
 * Readiness Assessment"). The title is admin-editable free text on the
 * service's `associated_documents`, so matching on it would silently stop
 * working the first time somebody renames a deliverable — the same reason
 * `buildGeneration` joins its expected set to its rows on `docType` and not on
 * title.
 *
 * The design's own title is accepted as a SECOND key purely so a document set
 * that names the report the design's way still resolves. It is deliberately an
 * exact match, not a substring one: a loose match here would hijack the live
 * HTML rendering of some other report that happens to mention Copilot.
 */
export const JOURNEY_READINESS_DOC_TYPE = "copilot_readiness";
export const JOURNEY_READINESS_DOCUMENT = "Copilot Readiness, Safety & Enablement Report";

export function isCopilotReadinessReport(
  doc: { readonly title: string; readonly docType: string } | null | undefined,
): boolean {
  if (!doc) return false;
  return doc.docType === JOURNEY_READINESS_DOC_TYPE || doc.title === JOURNEY_READINESS_DOCUMENT;
}

export const JOURNEY_DESIGN_DOCUMENT_COUNT = JOURNEY_DESIGN_DOCUMENTS.length;
