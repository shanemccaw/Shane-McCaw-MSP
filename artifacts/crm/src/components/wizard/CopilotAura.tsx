/**
 * CopilotAura — animated screen-edge glow overlay.
 * Renders brand-colored gradients (azure / teal / violet) around the
 * perimeter of its parent, leaving the centre clear. No 3-D objects.
 * Sits at z-10 with pointer-events-none so it never blocks interaction.
 */
export default function CopilotAura() {
  return (
    <div className="copilot-aura absolute inset-0 z-10 pointer-events-none overflow-hidden">

      {/* ── Edge beams ──────────────────────────────────────────────── */}

      {/* Top — azure */}
      <div
        className="copilot-aura-top absolute inset-x-0 top-0"
        style={{
          height: "clamp(100px, 18vh, 260px)",
          background: "linear-gradient(to bottom, rgba(0,120,212,0.38) 0%, rgba(0,120,212,0.14) 45%, transparent 100%)",
        }}
      />

      {/* Bottom — violet */}
      <div
        className="copilot-aura-bottom absolute inset-x-0 bottom-0"
        style={{
          height: "clamp(80px, 14vh, 200px)",
          background: "linear-gradient(to top, rgba(123,127,245,0.32) 0%, rgba(123,127,245,0.10) 48%, transparent 100%)",
        }}
      />

      {/* Left — teal */}
      <div
        className="copilot-aura-side absolute inset-y-0 left-0"
        style={{
          width: "clamp(60px, 10vw, 180px)",
          background: "linear-gradient(to right, rgba(0,180,216,0.30) 0%, rgba(0,180,216,0.08) 52%, transparent 100%)",
        }}
      />

      {/* Right — azure-teal blend */}
      <div
        className="copilot-aura-side absolute inset-y-0 right-0"
        style={{
          width: "clamp(60px, 10vw, 180px)",
          background: "linear-gradient(to left, rgba(0,120,212,0.24) 0%, rgba(0,180,216,0.07) 52%, transparent 100%)",
        }}
      />

      {/* ── Corner halos ────────────────────────────────────────────── */}

      {/* Top-left */}
      <div
        className="copilot-aura-corner-tl absolute top-0 left-0"
        style={{
          width: "clamp(140px, 25vw, 380px)",
          height: "clamp(140px, 25vh, 380px)",
          background: "radial-gradient(ellipse at top left, rgba(0,120,212,0.30) 0%, rgba(0,120,212,0.10) 40%, transparent 70%)",
        }}
      />

      {/* Top-right */}
      <div
        className="copilot-aura-corner-tr absolute top-0 right-0"
        style={{
          width: "clamp(100px, 18vw, 280px)",
          height: "clamp(100px, 18vh, 280px)",
          background: "radial-gradient(ellipse at top right, rgba(0,180,216,0.22) 0%, transparent 65%)",
        }}
      />

      {/* Bottom-right */}
      <div
        className="copilot-aura-corner-br absolute bottom-0 right-0"
        style={{
          width: "clamp(120px, 22vw, 340px)",
          height: "clamp(120px, 22vh, 340px)",
          background: "radial-gradient(ellipse at bottom right, rgba(123,127,245,0.28) 0%, rgba(123,127,245,0.08) 42%, transparent 70%)",
        }}
      />

      {/* Bottom-left */}
      <div
        className="copilot-aura-corner-bl absolute bottom-0 left-0"
        style={{
          width: "clamp(80px, 14vw, 220px)",
          height: "clamp(80px, 14vh, 220px)",
          background: "radial-gradient(ellipse at bottom left, rgba(0,120,212,0.16) 0%, transparent 65%)",
        }}
      />
    </div>
  );
}
