/**
 * Display helpers ported from the design's own logic class
 * (`Retainer Hours.dc.html`'s `GREEN`/`AMBER`/`RED`/`BLUE`/`GREY` 3-tuples and
 * `STATE_DISPLAY`), so this screen's exact hex/rgba values and state labels
 * survive into the real build unchanged.
 */
export type Tone = readonly [tint: string, line: string, color: string];

export const GREEN: Tone = ["rgba(52,211,153,.1)", "rgba(52,211,153,.26)", "#34d399"];
export const AMBER: Tone = ["rgba(251,191,36,.1)", "rgba(251,191,36,.26)", "#fbbf24"];
export const RED: Tone = ["rgba(248,113,113,.1)", "rgba(248,113,113,.28)", "#f87171"];
export const BLUE: Tone = ["rgba(96,165,250,.1)", "rgba(96,165,250,.24)", "#60a5fa"];
export const GREY: Tone = ["rgba(148,163,184,.08)", "rgba(148,163,184,.2)", "#94a3b8"];

export const STATE_DISPLAY: Record<string, string> = {
  in_progress: "In progress",
  closed: "Closed",
  in_review: "In review",
  scheduled: "Scheduled",
};

export const STATE_OPTIONS: readonly [string, string][] = [
  ["in_progress", "In progress"],
  ["closed", "Closed"],
  ["in_review", "In review"],
  ["scheduled", "Scheduled"],
];

export function stateTone(state: string): Tone {
  if (state === "closed") return GREEN;
  if (state === "in_review") return AMBER;
  if (state === "scheduled") return BLUE;
  return GREY;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatHours(hours: number): string {
  return `${hours.toFixed(1)}h`;
}

export function formatRate(cents: number): string {
  return `$${(cents / 100).toFixed(2)}/hr`;
}
