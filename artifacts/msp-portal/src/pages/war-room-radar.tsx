import { useEffect, useMemo, useState } from "react";
import { TopologyCanvas } from "@/components/war-room/topology/TopologyCanvas";
import { toTopologyBaseline } from "@/components/war-room/warRoomTopologyScores";
import { useRealTelemetryComparison } from "@/components/copilot-assessment/useRealTelemetryComparison";
import "@/components/war-room/war-room.css";

/**
 * /war-room-radar — the radar, and nothing else.
 *
 * Built as a reference surface for the War Room's real size ceiling (#302/#342).
 * Inside the room the radar shares the viewport with the persona strip, the
 * composer, the speech bubble, the host card and the right dock, and repeated
 * attempts to grow it by trimming those have each returned very little. This page
 * removes every one of them so the diagram's actual maximum can be seen and
 * measured directly, rather than argued about from the room's own layout.
 *
 * It is deliberately NOT a second copy of the radar's data wiring: it runs the
 * same `useRealTelemetryComparison()` → `toTopologyBaseline()` path the War Room
 * page itself uses (#312), so the scores here are the customer's real per-pillar
 * engine scores, not a demo constant. Pillars the engine has no real score for
 * stay null and render as "no data", exactly as they do in the room.
 *
 * Two things are worth knowing about what this page can and cannot show:
 *
 *   - The canvas is `width:100%; height:auto` over a SQUARE 1900-unit viewBox, so
 *     it is driven by width and its height follows. On any landscape screen the
 *     binding constraint is therefore height, which is why the host box below is
 *     sized to `min(vw, vh)` — handing it the full width would just overflow the
 *     bottom of the screen.
 *   - `embed` is what the War Room passes. In embed mode the canvas suppresses
 *     every leaf label (`chip = !embed || isFocus || isSel`), so the inner nodes
 *     render as bare dots. `?labels=1` turns embed OFF, which is the canvas's
 *     other, never-yet-shipped mode: full node chips, hub names and ring labels.
 *     That is the mode to look at when the question is "can the inner chips be
 *     read", because size alone does not answer it.
 */
export default function WarRoomRadarPage() {
  const telemetry = useRealTelemetryComparison();
  const baseline = useMemo(
    () => (telemetry.loaded ? toTopologyBaseline(telemetry.pillars) : null),
    [telemetry.loaded, telemetry.pillars],
  );

  // `?labels=1` → embed off (every node chip drawn). Read once per navigation
  // rather than held in state: it is a debugging switch, not a UI control.
  const labelled =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("labels") === "1";

  // The square the canvas gets. min(vw, vh) because the viewBox is square and the
  // svg's height is derived from its width.
  const [side, setSide] = useState(() =>
    typeof window === "undefined" ? 800 : Math.min(window.innerWidth, window.innerHeight),
  );
  useEffect(() => {
    const onResize = () => setSide(Math.min(window.innerWidth, window.innerHeight));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div
      data-radar-only="true"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        background: "#02060f",
      }}
    >
      <div data-radar-box="true" style={{ position: "relative", width: side, height: side }}>
        <TopologyCanvas
          embed={!labelled}
          baseline={baseline}
          scenario="baseline"
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}
