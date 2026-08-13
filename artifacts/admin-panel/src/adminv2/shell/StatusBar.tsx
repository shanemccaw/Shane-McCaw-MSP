/**
 * Status bar — 24px, the bottom edge of the window.
 *
 * Ambient state that is true regardless of what you have open: the tenant in
 * scope, whether anything is on fire, the month's money, unsaved work. It is
 * the one strip that never changes position, which is what makes it worth
 * glancing at.
 *
 * Segments are supplied by the app, not by screens — a screen that wants to say
 * something says it on its own surface. Anything here that can be acted on
 * carries an `onSelect` and becomes a button; the rest is read-only text with
 * no false affordance.
 */

import type { CSSProperties } from "react";
import { LINE, METRICS, SURFACE, TEXT } from "../theme";

export interface StatusSegment {
  id: string;
  label: string;
  title?: string;
  /** A state dot before the label. Colour carries the meaning. */
  dot?: string;
  /** Tints the label. */
  color?: string;
  /** Fills the whole segment — used only when the news is loud (a sale landed). */
  background?: string;
  bold?: boolean;
  onSelect?: () => void;
}

export interface StatusBarProps {
  left?: StatusSegment[];
  right?: StatusSegment[];
}

function segmentStyle(segment: StatusSegment): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: segment.background ? "0 11px" : "0 10px",
    whiteSpace: "nowrap",
    border: 0,
    fontFamily: "inherit",
    fontSize: 11,
    cursor: segment.onSelect ? "pointer" : "default",
    fontWeight: segment.bold ? 700 : 400,
    color: segment.color ?? TEXT.quieter,
    background: segment.background ?? "transparent",
  };
}

function Segment({ segment }: { segment: StatusSegment }) {
  const content = (
    <>
      {segment.dot && (
        <span
          style={{
            width: 7,
            height: 7,
            flex: "none",
            borderRadius: "50%",
            background: segment.dot,
          }}
        />
      )}
      <span>{segment.label}</span>
    </>
  );

  // Only actionable segments become buttons. Wrapping inert text in a button
  // would put four fake stops in the tab order along the bottom of every screen.
  if (!segment.onSelect) {
    return (
      <div title={segment.title} style={segmentStyle(segment)}>
        {content}
      </div>
    );
  }

  return (
    <button
      className="av2-ghost"
      title={segment.title}
      onClick={segment.onSelect}
      style={segmentStyle(segment)}
    >
      {content}
    </button>
  );
}

export function StatusBar({ left = [], right = [] }: StatusBarProps) {
  if (left.length === 0 && right.length === 0) return null;

  return (
    <div
      role="status"
      aria-label="Status"
      style={{
        flex: "none",
        height: METRICS.statusBar,
        display: "flex",
        alignItems: "stretch",
        background: SURFACE.chrome,
        borderTop: `1px solid ${LINE.group}`,
        color: TEXT.quieter,
        fontSize: 11,
      }}
    >
      {left.filter((s) => s.label).map((segment) => (
        <Segment key={segment.id} segment={segment} />
      ))}
      <div style={{ flex: 1 }} />
      {right.filter((s) => s.label).map((segment) => (
        <Segment key={segment.id} segment={segment} />
      ))}
    </div>
  );
}
