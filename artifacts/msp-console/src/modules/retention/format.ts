/**
 * Display helpers ported from the design's own logic class
 * (`Retention Queue.dc.html`'s `GREEN`/`AMBER`/`RED`/`BLUE`/`GREY` 3-tuples),
 * so this screen's exact hex/rgba values survive into the real build unchanged.
 */
export type Tone = readonly [tint: string, line: string, color: string];

export const GREEN: Tone = ["rgba(52,211,153,.1)", "rgba(52,211,153,.26)", "#34d399"];
export const AMBER: Tone = ["rgba(251,191,36,.1)", "rgba(251,191,36,.26)", "#fbbf24"];
export const RED: Tone = ["rgba(248,113,113,.1)", "rgba(248,113,113,.28)", "#f87171"];
export const BLUE: Tone = ["rgba(96,165,250,.1)", "rgba(96,165,250,.24)", "#60a5fa"];
export const GREY: Tone = ["rgba(148,163,184,.08)", "rgba(148,163,184,.2)", "#94a3b8"];

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
