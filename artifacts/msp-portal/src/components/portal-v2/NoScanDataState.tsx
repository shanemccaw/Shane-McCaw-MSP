/**
 * NoScanDataState.tsx — the ONE honest "no real data" state for the Customer
 * Portal (Git #1339).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Shane's standing rule: anywhere the UI has no real data to show — confirmed
 * zero backing, or a tenant genuinely never scanned — it shows "—" and "No scan
 * data available" (or the equivalent honest phrasing for that context). Never a
 * fake number, never a silent fallback to a fixture that looks real.
 *
 * Before this file, every page did that ad-hoc: the Overview pillar strip
 * inlined `p.score === null ? "—" : p.score`, the pillar hero tiles picked their
 * own muted colour and their own "Not measured yet" copy, and each new page
 * invented its own phrasing. This is the same category of platform convention
 * `useLivePillarHero`'s honest-null score contract already established for hero
 * SCALARS (#517) and `PillarLiveSource` established for the hidden live/fixture
 * marker (#1204) — extracted, at last, into a reusable body-content component so
 * there is ONE place to change the phrasing or the visual treatment if the
 * convention ever moves.
 *
 * ── What it standardises ────────────────────────────────────────────────────
 *   • `NO_DATA_DASH`        — the em dash every numeric slot prints when there
 *                             is genuinely no real value.
 *   • `NO_SCAN_DATA_LABEL`  — the canonical honest sentence. Copy is final.
 *   • `NO_DATA_INK`         — the muted ink a dashed value/state renders in, so a
 *                             "—" never reads as loud as a real number. Same
 *                             #475569 the hero tiles already picked by hand.
 *   • `hasScanValue` / `noScanValue` — the pure predicate + formatter every
 *                             numeric slot routes through instead of its own
 *                             `x === null ? "—" : x` ternary.
 *   • `<NoScanValue>`       — the inline component for a single numeric slot: the
 *                             real value in its own colour, or a muted "—".
 *   • `<NoScanDataState>`   — the block component for a card/panel/section body
 *                             that has genuinely nothing real to show.
 *
 * Both components carry the same hidden, visually-clipped source marker
 * `PillarLiveSource` uses (`PV2_SOURCE_CLIP`): the word "empty" stays in the DOM
 * so a test can read `el.innerText` and prove the honest state is on screen, but
 * it takes no visual space, so the design is recreated byte-for-byte.
 */

import type { CSSProperties, ReactNode } from "react";
import { CircleDashed } from "lucide-react";

import { PV2_SOURCE_CLIP } from "./useLivePillarHero";

/** The em dash every numeric slot prints when there is no real value. U+2014. */
export const NO_DATA_DASH = "—";

/** The canonical honest-empty sentence. Copy is final — do not reword per page. */
export const NO_SCAN_DATA_LABEL = "No scan data available";

/**
 * The muted slate a dashed value / honest-empty state renders in, so "—" never
 * reads as loud as a real measurement. Same colour the pillar hero tiles already
 * chose by hand for their unmeasured branch (`t.unmeasured ? "#475569" : …`).
 */
export const NO_DATA_INK = "#475569";

/**
 * True only for a real, finite number. `null` / `undefined` / `NaN` all mean
 * "no real data" and must render the dash, never a `0` or a `NaN`.
 */
export function hasScanValue(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A real number formatted for display, or the em dash when there is genuinely no
 * value. The one helper a numeric slot routes through instead of writing its own
 * `x === null ? "—" : x` ternary — so the "no data" glyph is decided in exactly
 * one place. `format` defaults to a thousands-grouped string.
 */
export function noScanValue(
  value: number | null | undefined,
  format: (n: number) => string = (n) => n.toLocaleString(),
): string {
  return hasScanValue(value) ? format(value) : NO_DATA_DASH;
}

/**
 * One numeric slot: the real value in `color`, or a muted "—" when there is no
 * real value. Drop-in for an inline `{x === null ? "—" : x}` — pass the colour
 * the real value should use and the muted dash is handled automatically.
 */
export function NoScanValue({
  value,
  format,
  color = "#f8fafc",
  style,
  testId,
}: {
  value: number | null | undefined;
  /** How to render a real number. Defaults to a thousands-grouped string. */
  format?: (n: number) => string;
  /** Colour for a REAL value. A dash always uses the muted `NO_DATA_INK`. */
  color?: string;
  style?: CSSProperties;
  testId?: string;
}) {
  const has = hasScanValue(value);
  return (
    <span
      data-testid={testId}
      data-state={has ? "live" : "empty"}
      style={{ color: has ? color : NO_DATA_INK, ...style }}
    >
      {noScanValue(value, format)}
    </span>
  );
}

/**
 * The block honest-empty state for a card / panel / section body that has
 * genuinely nothing real to show. A subtle dashed-circle glyph (lucide, never an
 * emoji), the canonical `NO_SCAN_DATA_LABEL`, and an optional one-line `detail`
 * for the specific reason ("This check is not in your scan package yet").
 */
export function NoScanDataState({
  label = NO_SCAN_DATA_LABEL,
  detail,
  icon = true,
  align = "center",
  compact = false,
  style,
  testId = "pv2-no-scan-data",
}: {
  /** The honest headline. Defaults to `NO_SCAN_DATA_LABEL`; override only for a
   *  genuinely more specific-but-equally-honest phrasing for the context. */
  label?: string;
  /** An optional second line stating the specific reason there is no data. */
  detail?: ReactNode;
  /** Show the dashed-circle glyph. Set false in a very tight slot. */
  icon?: boolean;
  align?: "center" | "start";
  /** Tighter padding/size for a small tile; roomier for a full section. */
  compact?: boolean;
  style?: CSSProperties;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        justifyContent: "center",
        textAlign: align === "center" ? "center" : "left",
        gap: compact ? 5 : 8,
        padding: compact ? "12px 10px" : "22px 18px",
        color: NO_DATA_INK,
        ...style,
      }}
    >
      {icon && <CircleDashed size={compact ? 15 : 20} color={NO_DATA_INK} aria-hidden="true" />}
      <span
        style={{
          fontSize: compact ? 11.5 : 13,
          fontWeight: 600,
          letterSpacing: "-.005em",
          color: "#94a3b8",
          lineHeight: 1.35,
        }}
      >
        {label}
      </span>
      {detail && (
        <span style={{ fontSize: compact ? 10 : 11.5, color: NO_DATA_INK, lineHeight: 1.4 }}>
          {detail}
        </span>
      )}
      {/* Hidden live/fixture-style marker so a test can prove the honest state is
          genuinely on screen — same visually-clipped technique PillarLiveSource
          uses. Reads "empty", distinct from that marker's "live" / "fixture". */}
      <span style={PV2_SOURCE_CLIP}>empty</span>
    </div>
  );
}
