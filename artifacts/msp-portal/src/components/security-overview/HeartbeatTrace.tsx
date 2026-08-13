import React from 'react';

/**
 * HeartbeatTrace — the shared animated ECG/heartbeat hero decoration
 * (security-overview hero band + the m365-health hero, per the cross-page
 * hero-treatment consistency decision).
 *
 * The waveform is a widescreen composition of the lucide `Activity` glyph's
 * heartbeat motif (baseline → small rise → tall spike → deep drop → recover),
 * drawn twice across the width. Two strokes of the same path:
 *   1. a faint static under-trace that softly throbs (animate-ecg-blip), and
 *   2. a bright 14%-length pulse segment that travels the full path
 *      (pathLength=100 + dasharray "14 86" + animate-ecg-trace).
 * Both animation tokens are real theme keyframes in index.css (same mechanism
 * as the existing shimmer-sweep token). Purely decorative: aria-hidden,
 * pointer-events-none, and static under prefers-reduced-motion.
 */

const ECG_PATH =
  'M0 44 H150 l10 -6 l8 6 l10 -28 l12 48 l10 -26 l8 6 H380 l10 -6 l8 6 l10 -28 l12 48 l10 -26 l8 6 H600';

export const HeartbeatTrace: React.FC<{ className?: string }> = ({ className }) => (
  <div
    aria-hidden
    className={`absolute inset-x-0 bottom-4 pointer-events-none text-primary ${className ?? ''}`}
  >
    <svg viewBox="0 0 600 80" preserveAspectRatio="none" className="w-full h-14" fill="none">
      {/* Static faint trace — soft throb in time with the traveling pulse */}
      <path
        d={ECG_PATH}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animate-ecg-blip motion-reduce:animate-none motion-reduce:opacity-15"
      />
      {/* Traveling pulse segment */}
      <path
        d={ECG_PATH}
        pathLength={100}
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="14 86"
        className="opacity-60 animate-ecg-trace motion-reduce:animate-none motion-reduce:opacity-0"
      />
    </svg>
  </div>
);
