/**
 * adminv2 design tokens.
 *
 * These are lifted verbatim from `Admin Shell.dc.html` (Claude Design project
 * "M365 Admin Panel Framework"). The prototype links the Shane McCaw MSP design
 * system for fonts/spacing but paints its surfaces with its own literal hexes —
 * a deliberate override, because the DS semantic palette is navy/blue
 * (`--brand-navy #0A2540`, `--brand-blue #0078D4`) and this shell is a neutral
 * grey Office-style chrome. Do not "fix" that by swapping these for
 * `hsl(var(--card))` etc.: the surrounding admin panel's own token layer
 * (src/index.css) is a third, different palette (#0A0D12 canvas, #2F6FED blue),
 * and adopting either one repaints the whole shell wrong.
 *
 * Everything here is a plain constant rather than a CSS custom property so that
 * a screen author gets autocomplete and a typo is a compile error. Re-skinning
 * is a one-file edit.
 */

/** Surfaces, darkest to lightest. */
export const SURFACE = {
  /** html/body behind everything; also the palette scrim base. */
  root: "#191919",
  /** Title bar, ribbon tab strip, doc-tab strip, side panels. */
  chrome: "#1b1b1b",
  /** Ribbon body + the workspace canvas. */
  app: "#1f1f1f",
  /** Endpoint request bar and other inset headers. */
  inset: "#1d1d1d",
  /** Resting card / row. */
  card: "#242424",
  /** Card hover, gallery row hover. */
  cardHover: "#272727",
  /** Input wells, search capsule, quick-access chips. */
  well: "#292929",
  /** Button hover on a well; also the gallery / modal surface. */
  wellHover: "#2b2b2b",
  /** Floating panels that sit above the app: gallery, modal, tenant detail. */
  overlay: "#2b2b2b",
} as const;

/** Hairlines. Never heavier than 1px. */
export const LINE = {
  /** Inner rule between rows inside a panel. */
  subtle: "#2a2a2a",
  /** Section rule. */
  quiet: "#2e2e2e",
  /** The default chrome border. */
  base: "#333333",
  /** Ribbon group separator / workspace top edge. */
  group: "#363636",
  /** Control borders. */
  control: "#3b3b3b",
  /** Emphasised control border. */
  strong: "#404040",
  /** Hover border on a card. */
  hover: "#4a4a4a",
} as const;

/** Text ramp, brightest to dimmest. */
export const TEXT = {
  /** Headings, active tab label. */
  bright: "#ffffff",
  /** Default body text. */
  primary: "#f3f2f1",
  strong: "#e6e4e2",
  body: "#e1dfdd",
  soft: "#d6d4d2",
  softer: "#d2d0ce",
  quiet: "#c8c6c4",
  quieter: "#bab8b6",
  dim: "#a19f9d",
  dimmer: "#96948f",
  /** Panel captions, uppercase eyebrows. */
  caption: "#8f8c88",
  /** Ribbon group caption. */
  groupLabel: "#8a8886",
  label: "#848280",
  /** Meta / hint text. */
  meta: "#797775",
  metaAlt: "#7a7876",
  faint: "#747270",
  faintest: "#6d6b69",
} as const;

/**
 * Semantic accents (handoff.md section 8). Restrained and meaningful:
 * colour carries information here, it is never decoration.
 *
 * Blue is the primary *action* colour only. There are deliberately no blue
 * icons and no blue body text — called out explicitly as hard on the eyes.
 */
export const ACCENT = {
  /** Money in, healthy. */
  green: "#7fae91",
  /** A brighter green, used for positive deltas and check marks. */
  greenBright: "#6ccb96",
  greenSoft: "#92d8ae",
  /** Money out. Muted on purpose — an expense is not an error. */
  red: "#c08b8b",
  /** Needs attention. */
  amber: "#f2ca63",
  amberDim: "#e9b949",
  /** Broken, or destructive. */
  danger: "#e57a7a",
  /** Informational — paths, monospace values, type badges. */
  info: "#7fb4d8",
} as const;

/**
 * Brighter variants of the accents, used for text and values where the muted
 * accent would not carry enough contrast on a dark surface.
 */
export const ACCENT_TEXT = {
  green: "#92d8ae",
  danger: "#eda3a3",
  amber: "#f2ca63",
  neutral: "#a8a6a4",
} as const;

/**
 * The one interactive colour, in its two real values.
 *
 * `PRIMARY` is the inline save/publish blue used by the property panel and the
 * services header. `PRIMARY_OVERLAY` is the slightly brighter brand blue the
 * design uses for the primary button inside an overlay (peek, modal). Both are
 * in `Admin Shell.dc.html`; they are not interchangeable.
 */
export const PRIMARY = "#0f6cbd";
export const PRIMARY_OVERLAY = "#0078D4";

/**
 * Command-palette kind badges: [colour, three-letter code].
 *
 * The badge is what makes a 143-entry index scannable — you recognise the shape
 * of `API` or `PKG` in the left gutter before you have read the name. Lifted
 * verbatim from the design's `cpKind` map.
 */
export const KIND_BADGE: Record<string, readonly [string, string]> = {
  run: ["#f2ca63", "DO"],
  answer: ["#92d8ae", "NOW"],
  mail: ["#c3c1bf", "MAIL"],
  go: ["#7fb4d8", "GO"],
  tenant: ["#92d8ae", "TEN"],
  endpoint: ["#7fb4d8", "API"],
  service: ["#92d8ae", "SVC"],
  document: ["#c3c1bf", "DOC"],
  script: ["#7fb4d8", "SQL"],
  package: ["#f2ca63", "PKG"],
  lead: ["#92d8ae", "CRM"],
  workflow: ["#c3c1bf", "FLW"],
  prompt: ["#c3c1bf", "AI"],
  customer: ["#92d8ae", "CUS"],
  msp: ["#7fb4d8", "MSP"],
  user: ["#92d8ae", "USR"],
  group: ["#c3c1bf", "RBAC"],
  // Tenant Signals. Neutral on purpose: a signal is a definition, not a
  // verdict — whether it is good or bad news depends entirely on the tenant
  // it fired against, which the palette cannot know.
  signal: ["#c3c1bf", "SIG"],
  // Observability. These four are the only badges that carry a "something is
  // wrong" colour, and they earn it: each names a row that exists solely
  // because a thing broke, so the tint is information rather than emphasis.
  alert: ["#f2ca63", "ALT"],
  exception: ["#eda3a3", "ERR"],
  incident: ["#7fb4d8", "INC"],
  dlq: ["#f2ca63", "DLQ"],
  // Engines. Neutral for the same reason `signal` is: an engine is a scorer,
  // and whether the number it produced is good news depends on the engine —
  // a high `health` is healthy, a high `security` or `drift` is not.
  engine: ["#c3c1bf", "ENG"],
  // Fulfillment. `delivery` carries the amber "needs attention" tint because
  // an overdue delivery is exactly what the Watch tab exists for; a
  // `fulfillmentType` is a registry definition, not a verdict on any one
  // sale, so it stays neutral like `signal`/`engine`.
  delivery: ["#f2ca63", "DLV"],
  fulfillmentType: ["#c3c1bf", "TYPE"],
  // Marketing. Informational blue like `endpoint`/`msp` — a campaign is a
  // record you go look at, not a verdict on anything.
  campaign: ["#7fb4d8", "CMP"],
  // Shared Links. Amber like `alert`/`delivery` — unlike a campaign, a
  // share's own engagement (views, days left) is exactly the kind of
  // needs-a-look signal the Watch tab exists for.
  share: ["#f2ca63", "SHR"],
};

export const KIND_BADGE_FALLBACK: readonly [string, string] = ["#8f8c88", "·"];

/** Translucent overlays used for hover and selection. */
export const WASH = {
  hover: "rgba(255,255,255,.08)",
  hoverSoft: "rgba(255,255,255,.06)",
  hoverFaint: "rgba(255,255,255,.04)",
  chip: "rgba(255,255,255,.09)",
  /** Ribbon button selected state. */
  selected: "rgba(15,108,189,.22)",
  selectedBorder: "rgba(15,108,189,.55)",
  /** The amber capsule that marks Git/Run as the developer set. */
  devCapsule: "rgba(242,202,99,.10)",
  devCapsuleBorder: "rgba(242,202,99,.28)",
  /** Contextual-tab accent wash. */
  context: "rgba(242,202,99,.16)",
} as const;

/** Type ramp. Sizes are in px and deliberately fractional in places. */
export const FONT = {
  sans: "Inter, 'Segoe UI', system-ui, sans-serif",
  mono: "Menlo, Consolas, monospace",
} as const;

/**
 * Fixed chrome geometry. The ribbon body height is load-bearing: handoff.md
 * section 3 says 108px, and anything taller clips the 17px group caption.
 */
export const METRICS = {
  titleBar: 36,
  ribbonTabs: 30,
  /** Ribbon body content height. Do not grow this without growing the group caption budget. */
  ribbonBody: 108,
  ribbonGroupCaption: 17,
  docStrip: 32,
  panelHeader: 30,
  bottomTabs: 28,
  /** The status bar at the very bottom of the window. */
  statusBar: 24,
  /** Collapsed side panel rail. */
  rail: 28,
  /** Collapsed bottom panel rail. */
  bottomRail: 24,
  splitter: 4,
  /** Side panel default / min / max widths. */
  leftWidth: 250,
  rightWidth: 280,
  panelMin: 180,
  panelMax: 560,
  bottomHeight: 180,
  bottomMin: 90,
  bottomMax: 520,
} as const;

/** Scrim behind the command palette and the peek overlay. */
export const SCRIM = "rgba(0,0,0,.52)";

/** Elevation for floating surfaces. */
export const SHADOW = {
  popover: "0 16px 34px rgba(0,0,0,.5)",
  overlay: "0 28px 70px rgba(0,0,0,.62)",
} as const;

/**
 * Stacking order, from `Admin Shell.dc.html`.
 *
 * The palette sits **above** the peek, not below it: a peek can be open behind
 * the palette (you hit Ctrl K while looking at a record), and the thing you just
 * summoned has to be the thing on top. Esc therefore unwinds palette → gallery
 * → peek, closing whatever is actually frontmost.
 */
export const Z = {
  ribbon: 40,
  peekBackdrop: 110,
  peek: 111,
  galleryBackdrop: 118,
  gallery: 119,
  paletteBackdrop: 130,
  palette: 131,
} as const;
