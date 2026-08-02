import { memo } from "react";

/**
 * The fixed room behind the whole page: aurora wash, parallax grid, horizon,
 * perspective floor, chapter tint, the security alarm and the giant pillar
 * wordmark.
 *
 * Deliberately props-less and memoised. Every layer in here is repainted
 * imperatively by `paintRoom()` in useRoomChoreography (tint / alarm / flare /
 * wordmark / motion signature) and translated by the parallax loop, so React
 * must never re-render it and undo those writes. No props means memo's shallow
 * compare is always true, which is exactly the guarantee we need.
 *
 * Entirely decorative — aria-hidden, no content, no interaction.
 */
export const RoomStage = memo(function RoomStage() {
  return (
    <div
      className="smcr-stage"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
        background:
          "radial-gradient(ellipse 120% 80% at 18% 6%,rgba(214,63,140,.30),transparent 62%)," +
          "radial-gradient(ellipse 110% 76% at 78% 16%,rgba(122,86,240,.34),transparent 64%)," +
          "radial-gradient(ellipse 120% 82% at 52% 88%,rgba(38,193,201,.24),transparent 66%)," +
          "linear-gradient(180deg,#160b2e 0%,#120b33 34%,#0c1030 62%,#0a0618 100%)",
      }}
    >
      {/* drifting field grid */}
      <div
        data-plx="0.06"
        style={{
          position: "absolute",
          left: "-10%",
          right: "-10%",
          top: "-6%",
          height: "76%",
          opacity: 0.5,
          backgroundImage:
            "linear-gradient(rgba(148,163,184,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.07) 1px,transparent 1px)",
          backgroundSize: "58px 58px",
          maskImage: "linear-gradient(180deg,transparent,#000 22%,#000 62%,transparent 96%)",
          WebkitMaskImage: "linear-gradient(180deg,transparent,#000 22%,#000 62%,transparent 96%)",
        }}
      />

      {/* chapter tint — repainted by paintRoom */}
      <div
        data-tint
        style={{
          position: "absolute",
          left: "-4%",
          right: "-4%",
          top: "-6%",
          height: "66%",
          filter: "blur(60px)",
          opacity: 0.5,
          transition: "background 1400ms cubic-bezier(.22,1,.36,1)",
        }}
      />

      {/* one-shot flare on every chapter change */}
      <div data-flare style={{ position: "absolute", inset: 0, opacity: 0, pointerEvents: "none" }}>
        <div data-flare-band style={{ position: "absolute", inset: 0 }} />
        <div
          data-flare-line
          style={{ position: "absolute", left: 0, right: 0, top: "38%", height: 2, filter: "blur(1px)" }}
        />
      </div>

      {/* giant pillar wordmark + glyph */}
      <div
        data-wordmark
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "38%",
          transform: "translateY(-50%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "clamp(14px,2.4vw,34px)",
          opacity: 0,
          transition:
            "opacity 900ms cubic-bezier(.22,1,.36,1),transform 900ms cubic-bezier(.22,1,.36,1)",
          pointerEvents: "none",
        }}
      >
        <svg
          data-wordmark-icon
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ width: "clamp(64px,9vw,132px)", height: "auto", flex: "0 0 auto", opacity: 0.5 }}
        />
        <span
          data-wordmark-text
          style={{
            fontSize: "clamp(52px,11vw,168px)",
            fontWeight: 800,
            letterSpacing: "-.04em",
            lineHeight: 0.86,
            whiteSpace: "nowrap",
            color: "transparent",
            WebkitTextStroke: "1.5px currentColor",
            opacity: 0.22,
          }}
        />
      </div>

      {/* per-pillar motion signature — innerHTML'd by paintRoom */}
      <div
        data-motion
        style={{
          position: "absolute",
          left: "6%",
          right: "6%",
          top: "6%",
          height: "48%",
          overflow: "hidden",
          maskImage: "radial-gradient(ellipse 62% 66% at 50% 46%,#000,transparent 84%)",
          WebkitMaskImage: "radial-gradient(ellipse 62% 66% at 50% 46%,#000,transparent 84%)",
        }}
      />

      {/* security alarm wash */}
      <div
        data-alarm
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0,
          transition: "opacity 1200ms cubic-bezier(.22,1,.36,1)",
          background:
            "radial-gradient(ellipse 130% 90% at 50% 4%,rgba(220,38,38,.42),transparent 62%)," +
            "radial-gradient(ellipse 110% 80% at 50% 96%,rgba(190,18,60,.3),transparent 66%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse 60% 44% at 50% 46%,rgba(248,113,113,.16),transparent 70%)",
            animation: "smcr-heartbeat 3s ease-in-out infinite",
          }}
        />
      </div>

      {/* horizon */}
      <div
        data-plx="0.12"
        style={{
          position: "absolute",
          left: "16%",
          right: "16%",
          top: "58%",
          height: 1,
          background: "linear-gradient(90deg,transparent,rgba(103,232,249,.32),transparent)",
          boxShadow: "0 0 40px rgba(103,232,249,.16)",
        }}
      />

      {/* perspective floor */}
      <div
        data-plx="0.2"
        style={{
          position: "absolute",
          left: "-34%",
          right: "-34%",
          top: "58%",
          bottom: "-34%",
          transform: "perspective(820px) rotateX(73deg)",
          transformOrigin: "top center",
          opacity: 0.3,
          backgroundImage:
            "linear-gradient(rgba(167,139,250,.1) 1px,transparent 1px),linear-gradient(90deg,rgba(103,232,249,.09) 1px,transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 0%,#000,transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 0%,#000,transparent 78%)",
        }}
      />

      {/* the table itself */}
      <div
        data-plx="0.28"
        data-table
        style={{
          position: "absolute",
          left: "50%",
          top: "72%",
          transform: "translate(-50%,-50%)",
          width: "min(84vw,1180px)",
          height: "min(26vh,260px)",
          borderRadius: "50%",
          filter: "blur(34px)",
          opacity: 0.55,
          background: "radial-gradient(ellipse at 50% 42%,rgba(103,232,249,.1),transparent 66%)",
          transition: "background 1400ms cubic-bezier(.22,1,.36,1)",
        }}
      />

      {/* edge vignettes — keep the transcript legible over the aurora */}
      <div
        data-plx="0.05"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: "22%",
          background: "linear-gradient(90deg,rgba(10,6,24,.96),transparent)",
        }}
      />
      <div
        data-plx="0.05"
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: "26%",
          background: "linear-gradient(270deg,rgba(10,6,24,.9),transparent)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "24%",
          background: "linear-gradient(0deg,rgba(10,6,24,.94),transparent)",
        }}
      />

      {/* motes */}
      <div data-plx="0.42" style={{ position: "absolute", inset: 0 }}>
        <span
          style={{
            position: "absolute",
            left: "12%",
            bottom: "16%",
            width: 2,
            height: 2,
            borderRadius: 99,
            background: "#7dd3fc",
            boxShadow: "0 0 9px #67e8f9",
            animation: "smcr-float 22s linear infinite",
          }}
        />
        <span
          style={{
            position: "absolute",
            left: "31%",
            bottom: "14%",
            width: 3,
            height: 3,
            borderRadius: 99,
            background: "#a78bfa",
            boxShadow: "0 0 10px #a78bfa",
            animation: "smcr-float 28s linear 5s infinite",
          }}
        />
        <span
          style={{
            position: "absolute",
            left: "57%",
            bottom: "18%",
            width: 2,
            height: 2,
            borderRadius: 99,
            background: "#67e8f9",
            boxShadow: "0 0 9px #67e8f9",
            animation: "smcr-float 25s linear 11s infinite",
          }}
        />
        <span
          style={{
            position: "absolute",
            left: "78%",
            bottom: "15%",
            width: 2,
            height: 2,
            borderRadius: 99,
            background: "#60a5fa",
            boxShadow: "0 0 8px #0078D4",
            animation: "smcr-float 30s linear 3s infinite",
          }}
        />
      </div>
    </div>
  );
});
