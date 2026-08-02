import { useLocation } from "wouter";
import { WarRoomLogic } from "@/components/war-room/WarRoomLogic";
import "@/components/war-room/war-room.css";

/**
 * M365 War Room — the full-screen Copilot readiness briefing.
 *
 * Ported from the Claude Design prototype "M365 War Room.dc.html". The experience owns
 * the whole viewport (its root is `position:fixed; inset:0`), so it deliberately renders
 * outside AppShell rather than inside it — the shell would be covered either way.
 *
 * The exit control below is the one piece of chrome that is NOT in the design: the
 * prototype was a standalone page with nowhere to return to, and without it a user who
 * opens this route inside the portal has no way back out.
 */
export default function WarRoomPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="wr-root">
      <WarRoomLogic />

      <button
        type="button"
        onClick={() => setLocation("/")}
        aria-label="Exit the War Room and return to the portal"
        style={{
          position: "fixed",
          left: 14,
          top: 14,
          zIndex: 400,
          display: "flex",
          alignItems: "center",
          gap: 7,
          height: 28,
          padding: "0 12px",
          borderRadius: 9,
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: ".04em",
          color: "#94a3b8",
          border: "1px solid rgba(51,65,85,.85)",
          background: "rgba(8,15,30,.72)",
          backdropFilter: "blur(6px)",
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 12H5M11 18l-6-6 6-6" />
        </svg>
        Exit
      </button>
    </div>
  );
}
