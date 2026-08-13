/**
 * RevealProgressRail.tsx — the nine ticks pinned to the left edge of the Reveal.
 *
 * It is a position indicator, not navigation. The Reveal is a fixed-order linear
 * narrative with no skip-ahead, so the ticks carry `pointer-events: none` and no
 * click handler at all — a rail that looks clickable and is not is worse than a
 * rail that plainly is not.
 *
 * Colour and width come from `railTicks()` so the "current / passed / upcoming"
 * vocabulary is asserted in the tested `.ts` module rather than restated here.
 */

import { railTicks } from "./revealMath.ts";

export function RevealProgressRail({
  active,
  count = 9,
}: {
  /** Index of the scene that currently owns the rail, 0-based. */
  active: number;
  count?: number;
}) {
  const ticks = railTicks(count, active);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        left: 26,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        gap: 9,
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      {ticks.map((tick, i) => (
        <div
          key={i}
          style={{
            width: 2,
            height: 24,
            borderRadius: 2,
            transition: "background 240ms, transform 240ms",
            background: tick.background,
            transform: `scaleX(${tick.scaleX})`,
          }}
        />
      ))}
    </div>
  );
}
