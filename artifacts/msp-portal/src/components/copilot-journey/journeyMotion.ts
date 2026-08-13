/**
 * journeyMotion.ts — #540. Shared crossfade lifecycle for the Reveal's
 * full-bleed state overlays (`RevealNoScanGate`, `RevealScanOverlay`).
 *
 * Both overlays occupy the exact same `position:fixed; inset:0` footprint, so
 * swapping which one is mounted is what reads as the "boop" this issue is
 * about — one vanishes and the other appears on the same frame. `useOverlayFade`
 * gives every consumer the same two-sided fade: it stays mounted through its
 * own exit fade (so it does not just vanish), and it defers becoming visible by
 * one frame on entry (so the browser has a "before" frame at opacity 0 to
 * transition away from, instead of popping straight to opacity 1 the instant it
 * mounts). Two overlays doing this at once is what makes a state handoff read
 * as a single continuous dissolve rather than two independent, uncoordinated
 * swaps.
 *
 * Reduced motion is handled for free: `copilot-journey.css`'s `.cj-dark *`
 * rule already forces `transition-duration: 1ms` under
 * `prefers-reduced-motion: reduce`, so this collapses to an (imperceptible)
 * instant swap without any branching here.
 */

import { useEffect, useState } from "react";

/** How long an overlay takes to fade in or out. Shared so two overlays
 *  crossfading against each other move at the same speed. */
export const OVERLAY_FADE_MS = 700;

export interface OverlayFade {
  /** Whether the overlay should still be in the DOM at all — false only once
   *  the exit fade has fully played out. */
  readonly mounted: boolean;
  /** Whether the overlay should currently read as opacity 1. Drive the
   *  element's `opacity`/`pointerEvents` off this, not off `open` directly. */
  readonly visible: boolean;
}

export function useOverlayFade(open: boolean, fadeMs: number = OVERLAY_FADE_MS): OverlayFade {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = setTimeout(() => setMounted(false), fadeMs);
    return () => clearTimeout(timer);
  }, [open, fadeMs]);

  return { mounted, visible };
}
