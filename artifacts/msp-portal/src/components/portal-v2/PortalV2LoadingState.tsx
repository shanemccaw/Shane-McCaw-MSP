/**
 * PortalV2LoadingState.tsx — the ONE honest "real data is still loading" state
 * for the Customer Portal (Git #1343).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Several portal-v2 data hooks follow a `loading | live | fixture` (or the
 * two-state `live | fixture`) shape, and for a long time they handed the page
 * the DESIGN FIXTURE while the real fetch was still in flight — "an empty matrix
 * and a broken matrix look identical, so show the prototype's estate meanwhile".
 * Shane overruled that platform-wide: a confident set of fake names that then
 * flickers to real data erodes trust worse than a stable loading state ever
 * could. His words: "I would rather a loading... or block out then fake data
 * that changes."
 *
 * So while a real fetch is IN FLIGHT, a page renders THIS — an honest skeleton —
 * never the fixture. The fixture stays only as the fallback for a genuinely
 * FAILED read or a legitimately-empty tenant, which is a separate, more
 * defensible case (see the sibling `NoScanDataState` for the "no real data at
 * all" case from #1339).
 *
 * ── What it standardises ────────────────────────────────────────────────────
 *   • `<PortalV2Skeleton>`     — one shimmering placeholder bar, the primitive a
 *                                page composes into its own layout.
 *   • `<PortalV2LoadingState>` — the block skeleton for a whole card / panel /
 *                                section body whose data has not landed yet.
 *
 * Like `NoScanDataState`, it carries the same hidden, visually-clipped source
 * marker (`PV2_SOURCE_CLIP`) the live/fixture indicators use: the word "loading"
 * stays in the DOM so a test can read `el.innerText` and prove the honest
 * loading state is genuinely on screen, but it takes no visual space, so the
 * design is unaffected on screen.
 */

import type { CSSProperties } from "react";

import { PV2_SOURCE_CLIP } from "./useLivePillarHero";

/** The canonical honest-loading sentence. Kept in one place so it never drifts. */
export const PV2_LOADING_LABEL = "Loading your latest data…";

/** The name of the keyframe both the primitive and the block animate on. */
const PV2_SHIMMER = "pv2-skeleton-shimmer";

/**
 * The keyframe, rendered once inline. Duplicate `<style>` tags carrying the same
 * keyframe name are harmless in every browser, so a component that renders more
 * than one skeleton does not need to hoist this — it just works.
 */
function ShimmerKeyframes() {
  return (
    <style>{`@keyframes ${PV2_SHIMMER}{0%{opacity:.45}50%{opacity:.85}100%{opacity:.45}}`}</style>
  );
}

const SKELETON_BASE: CSSProperties = {
  borderRadius: 6,
  background:
    "linear-gradient(90deg,rgba(148,163,184,.10),rgba(148,163,184,.20),rgba(148,163,184,.10))",
  animation: `${PV2_SHIMMER} 1.4s ease-in-out infinite`,
};

/**
 * One shimmering placeholder bar. Pass a `width` (a CSS length or percentage)
 * and a `height`; everything else is the shared muted treatment. Drop it into a
 * page's own layout to mirror the shape of the real content that is loading.
 */
export function PortalV2Skeleton({
  width = "100%",
  height = 12,
  radius,
  style,
  testId,
}: {
  width?: number | string;
  height?: number | string;
  /** Override the default corner radius (e.g. a circular avatar placeholder). */
  radius?: number | string;
  style?: CSSProperties;
  testId?: string;
}) {
  return (
    <>
      <ShimmerKeyframes />
      <span
        data-testid={testId}
        aria-hidden="true"
        style={{
          display: "block",
          width,
          height,
          ...SKELETON_BASE,
          ...(radius != null ? { borderRadius: radius } : {}),
          ...style,
        }}
      />
    </>
  );
}

/**
 * The block honest-loading state for a card / panel / section body whose real
 * data is still in flight. A small stack of shimmer bars, an honest one-line
 * label, and the hidden "loading" marker a test can assert on.
 *
 * `rows` controls how many shimmer bars render, so a tall section can look like
 * a tall section loading and a tight tile like a tight one. `label` defaults to
 * `PV2_LOADING_LABEL`; override only for an equally-honest, more specific line.
 */
export function PortalV2LoadingState({
  label = PV2_LOADING_LABEL,
  rows = 3,
  align = "start",
  compact = false,
  showLabel = true,
  style,
  testId = "pv2-loading",
}: {
  label?: string;
  /** How many shimmer bars to render. */
  rows?: number;
  align?: "center" | "start";
  /** Tighter padding/sizing for a small slot; roomier for a full section. */
  compact?: boolean;
  /** Hide the text label when the shimmer bars alone read as "loading". */
  showLabel?: boolean;
  style?: CSSProperties;
  testId?: string;
}) {
  const count = Math.max(1, rows);
  return (
    <div
      data-testid={testId}
      data-state="loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "stretch",
        gap: compact ? 8 : 12,
        padding: compact ? "12px 10px" : "22px 18px",
        width: "100%",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {showLabel && (
        <span
          style={{
            fontSize: compact ? 11.5 : 13,
            fontWeight: 600,
            letterSpacing: "-.005em",
            color: "#94a3b8",
            lineHeight: 1.35,
            alignSelf: align === "center" ? "center" : "flex-start",
          }}
        >
          {label}
        </span>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: compact ? 7 : 10, width: "100%" }}>
        {Array.from({ length: count }, (_, i) => (
          <PortalV2Skeleton
            key={i}
            height={compact ? 10 : 13}
            // Vary the last bar's width so the stack does not read as a solid block.
            width={i === count - 1 ? "62%" : "100%"}
          />
        ))}
      </div>
      {/* Hidden marker so a test can prove the honest loading state is genuinely
          on screen — same visually-clipped technique NoScanDataState /
          PillarLiveSource use. Reads "loading", distinct from "live"/"fixture". */}
      <span style={PV2_SOURCE_CLIP}>loading</span>
    </div>
  );
}
