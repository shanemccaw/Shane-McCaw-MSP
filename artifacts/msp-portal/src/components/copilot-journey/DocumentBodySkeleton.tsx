/**
 * DocumentBodySkeleton.tsx — the loading placeholder for `LiveBody`'s
 * `"loading"` state (DocumentBody.tsx), replacing what used to be a small
 * ~40px centred spinner.
 *
 * The old spinner let the reading pane sit at almost-zero height, then swap
 * atomically to a real document that can be thousands of pixels tall — a
 * customer scrolling mid-swap got the page reflowed under them. This
 * placeholder is full-height and roughly matches `.cj-doc-body`'s real
 * typography (copilot-journey.css lines 41-53) so the swap to real content
 * doesn't itself cause a big jump, plus an indeterminate progress bar
 * (no literal percentage — there is no real backend progress signal for a
 * single document fetch, so it reads as "still working," not a fake number).
 */

import { INK } from "./journeyTokens.ts";

function ShimmerBlock({
  width,
  height,
  reduceMotion,
  delayMs = 0,
}: {
  width: string;
  height: number;
  reduceMotion: boolean;
  delayMs?: number;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        width,
        height,
        borderRadius: 6,
        background: reduceMotion
          ? INK.hairlineDark
          : `linear-gradient(90deg, ${INK.hairlineDark} 25%, rgba(148,163,184,.18) 50%, ${INK.hairlineDark} 75%)`,
        backgroundSize: "200% 100%",
        animation: reduceMotion ? "none" : `cj-doc-skeleton-shimmer 1.6s ease-in-out infinite`,
        animationDelay: reduceMotion ? undefined : `${delayMs}ms`,
      }}
    />
  );
}

function ParagraphBlock({ reduceMotion, delayMs }: { reduceMotion: boolean; delayMs: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: "66ch" }}>
      <ShimmerBlock width="100%" height={15} reduceMotion={reduceMotion} delayMs={delayMs} />
      <ShimmerBlock width="96%" height={15} reduceMotion={reduceMotion} delayMs={delayMs + 60} />
      <ShimmerBlock width="88%" height={15} reduceMotion={reduceMotion} delayMs={delayMs + 120} />
    </div>
  );
}

/**
 * Indeterminate — a sweeping bar rather than a filled percentage, since a
 * single document fetch has no real progress signal to report.
 */
function IndeterminateProgressBar({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <div
      role="progressbar"
      aria-label="Loading document"
      style={{
        width: "100%",
        height: 3,
        borderRadius: 999,
        overflow: "hidden",
        background: INK.hairlineDark,
      }}
    >
      <div
        style={{
          height: "100%",
          width: "40%",
          borderRadius: 999,
          background: "linear-gradient(90deg,#0078D4,#00B4D8)",
          animation: reduceMotion ? "none" : "cj-doc-skeleton-progress 1.4s ease-in-out infinite",
          opacity: reduceMotion ? 0.6 : 1,
        }}
      />
    </div>
  );
}

export function DocumentBodySkeleton({ reduceMotion }: { readonly reduceMotion: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <IndeterminateProgressBar reduceMotion={reduceMotion} />
      <ShimmerBlock width="70%" height={30} reduceMotion={reduceMotion} />
      <ParagraphBlock reduceMotion={reduceMotion} delayMs={80} />
      <ParagraphBlock reduceMotion={reduceMotion} delayMs={200} />
      <ShimmerBlock width="42%" height={19} reduceMotion={reduceMotion} delayMs={320} />
      <ParagraphBlock reduceMotion={reduceMotion} delayMs={360} />
      {/* A table-shaped block — rows of even-width cells, echoing .cj-doc-body's
          table rhythm (12px vertical padding, hairline row dividers). */}
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            style={{
              display: "flex",
              gap: 24,
              padding: "12px 0",
              borderBottom: `1px solid ${INK.hairlineDark}`,
            }}
          >
            <ShimmerBlock width="30%" height={13.5} reduceMotion={reduceMotion} delayMs={440 + row * 60} />
            <ShimmerBlock width="20%" height={13.5} reduceMotion={reduceMotion} delayMs={460 + row * 60} />
            <ShimmerBlock width="16%" height={13.5} reduceMotion={reduceMotion} delayMs={480 + row * 60} />
          </div>
        ))}
      </div>
    </div>
  );
}
