import { useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { WarRoomLogic } from "@/components/war-room/WarRoomLogic";
import { warRoomUrlSync } from "@/components/war-room/warRoomSections";
import "@/components/war-room/war-room.css";

/**
 * M365 War Room — the full-screen Copilot readiness briefing.
 *
 * Ported from the Claude Design prototype "M365 War Room.dc.html". The experience owns
 * the whole viewport (its root is `position:fixed; inset:0`), so it deliberately renders
 * outside AppShell rather than inside it — the shell would be covered either way.
 *
 * Route: /war-room/:section? — each of the stops the transport jump-menu already names
 * (introductions, the six pillar deep-dives, the live demo, readiness, SOW, remediation,
 * timeline, documents) is its own deep-linkable URL, so the position survives a refresh
 * and Back/Forward work (#303). The `:section` param is optional rather than the
 * redirect-to-a-default shape /copilot-assessment/:step uses, for two reasons: the War
 * Room opens on a hero prelude that is genuinely not one of the named stops, so there is
 * nothing honest to redirect a bare /war-room to; and a single route keeps this one
 * component mounted across every section change, which is the remount concern that
 * pattern exists to solve in the first place.
 *
 * The exit control below is the one piece of chrome that is NOT in the design: the
 * prototype was a standalone page with nowhere to return to, and without it a user who
 * opens this route inside the portal has no way back out.
 */
export default function WarRoomPage() {
  const [, setLocation] = useLocation();
  const { section } = useParams<{ section?: string }>();

  // The briefing's own beat machine still owns navigation; this only mirrors it
  // into the address bar. An explicitly chosen stop pushes a history entry, a
  // position the briefing reached on its own replaces one — see warRoomUrlSync.
  const handleSectionChange = useCallback(
    (next: string, explicit: boolean) => {
      const { path, replace } = warRoomUrlSync(next, explicit);
      setLocation(path, { replace });
    },
    [setLocation],
  );

  return (
    <div className="wr-root">
      <WarRoomLogic section={section} onSectionChange={handleSectionChange} />

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
