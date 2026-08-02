import type { CSSProperties } from "react";

export interface SeatView {
  key: string;
  initials: string;
  short: string;
  title: string;
  state: string;
  live: boolean;
  color: string;
  tile: string;
  bd: string;
  isYou: boolean;
}

/**
 * The people currently in the room, down the left gutter. Seats arrive as their
 * chapter is reached (Shane from the start, the personas and Kira at the cast
 * chapter, "You" once discovery opens) and the speaker's seat lights up.
 *
 * Hidden below 900px, where the gutter it lives in no longer exists.
 */
export function SeatRail({ seats }: { seats: SeatView[] }) {
  return (
    <div
      className="smcr-seatrail"
      aria-hidden="true"
      style={{
        position: "fixed",
        left: "clamp(14px,2.2vw,30px)",
        top: 76,
        bottom: 90,
        zIndex: 60,
        flexDirection: "column",
        justifyContent: "space-evenly",
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      {seats.map((s) => (
        <div
          key={s.key}
          data-seatkey={s.key}
          title={s.title}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            opacity: s.live ? 1 : 0.5,
            transform: s.live ? "translateX(4px)" : "none",
            transition: "opacity 500ms, transform 500ms",
          }}
        >
          <div
            data-seattile=""
            style={{
              position: "relative",
              width: 38,
              height: 38,
              flex: "0 0 38px",
              borderRadius: 99,
              padding: 2,
              background: s.live ? `linear-gradient(135deg,${s.color},transparent)` : "transparent",
              boxShadow: s.live ? `0 0 26px ${s.color}55` : "none",
              transition: "box-shadow 500ms, background 500ms",
            }}
          >
            <span
              style={{
                position: "relative",
                display: "flex",
                width: "100%",
                height: "100%",
                borderRadius: 99,
                overflow: "hidden",
                alignItems: "center",
                justifyContent: "center",
                fontSize: s.isYou ? 8 : 10,
                fontWeight: 800,
                color: s.isYou ? "var(--smcr-text-3)" : "#f8fafc",
                background: s.tile,
                border: `1px solid ${s.bd}`,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "repeating-linear-gradient(0deg,rgba(103,232,249,.18) 0 1px,transparent 1px 3px)",
                }}
              />
              <span style={{ position: "relative" }}>{s.initials}</span>
            </span>
          </div>
          <div
            data-seatmeta=""
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 1,
              minWidth: 0,
              maxWidth: 120,
              overflow: "hidden",
              opacity: s.live ? 1 : 0,
              transform: s.live ? "none" : "translateX(-6px)",
              transition: "opacity 400ms, transform 400ms",
              pointerEvents: "none",
            }}
          >
            <span style={NAME_STYLE}>{s.short}</span>
            <span
              style={{
                fontSize: 8.5,
                fontWeight: 800,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: s.color,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {s.state}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

const NAME_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "-.01em",
  color: "var(--smcr-text)",
  whiteSpace: "nowrap",
};
