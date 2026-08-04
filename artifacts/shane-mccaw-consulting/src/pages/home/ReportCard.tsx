import { useParallax } from "./useScrollFx";
import type { ReportCardDatum } from "./reportCardData";

export function ReportCard({ card, offsetTop }: { card: ReportCardDatum; offsetTop: number }) {
  const glowRef = useParallax<HTMLDivElement>(0.28);
  const cardRef = useParallax<HTMLDivElement>(0.07);

  return (
    <div style={{ position: "relative", paddingTop: offsetTop }}>
      <div ref={glowRef} style={{ position: "absolute", left: "-14%", top: "6%", width: 340, height: 340, borderRadius: "50%", background: `radial-gradient(circle,${card.glow},transparent 68%)`, filter: "blur(38px)", pointerEvents: "none", willChange: "transform" }} />
      <div style={{ position: "absolute", left: 16, right: -12, top: offsetTop + 24, bottom: -12, borderRadius: 18, border: "1px solid rgba(30,41,59,.6)", background: "rgba(9,15,31,.55)", transform: "rotate(1.4deg)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: 9, right: -6, top: offsetTop + 13, bottom: -6, borderRadius: 18, border: "1px solid rgba(30,41,59,.85)", background: "rgba(12,19,37,.8)", transform: "rotate(.7deg)", pointerEvents: "none" }} />
      <div
        ref={cardRef}
        style={{
          position: "relative",
          border: "1px solid rgba(30,41,59,.95)",
          borderRadius: 18,
          background: "linear-gradient(158deg,rgba(17,25,45,.97),rgba(7,12,26,.97))",
          overflow: "hidden",
          boxShadow: "0 30px 70px -34px rgba(2,6,23,.95)",
          willChange: "transform",
          transition: "border-color .25s ease,box-shadow .25s ease",
        }}
      >
        <div style={{ height: 3, background: `linear-gradient(90deg,${card.color},${card.gradientTo} 55%,transparent)` }} />
        <div style={{ position: "relative", padding: "clamp(18px,4vw,24px) clamp(18px,4vw,26px) 22px" }}>
          <span style={{ position: "absolute", right: 16, top: 2, fontSize: 76, fontWeight: 800, letterSpacing: "-.05em", lineHeight: 1, color: `${card.color}12`, pointerEvents: "none" }}>{card.n}</span>
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 9, marginBottom: 16 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: card.color, boxShadow: `0 0 12px ${card.color}` }} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: card.color }}>{card.category}</span>
            <span style={{ width: 1, height: 11, background: "#334155" }} />
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#475569" }}>Report {card.n} / 08</span>
          </div>
          <h3 style={{ position: "relative", fontSize: 19, fontWeight: 700, letterSpacing: "-.015em", color: "#f1f5f9", margin: "0 0 9px", lineHeight: 1.28 }}>{card.title}</h3>
          <p style={{ position: "relative", fontSize: 14, lineHeight: 1.6, color: "#94a3b8", margin: "0 0 22px" }}>{card.desc}</p>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 18, paddingTop: 16, borderTop: "1px solid rgba(30,41,59,.8)" }}>
            <div style={{ display: "grid", gap: 6, flex: 1 }}>
              <span style={{ display: "block", height: 5, borderRadius: 3, width: "100%", background: "rgba(71,85,105,0.5)" }} />
              <span style={{ display: "block", height: 5, borderRadius: 3, width: "82%", background: "rgba(71,85,105,0.38)" }} />
              <span style={{ display: "block", height: 5, borderRadius: 3, width: "64%", background: "rgba(71,85,105,0.26)" }} />
            </div>
            <svg width="52" height="30" viewBox="0 0 52 30" style={{ display: "block", flexShrink: 0 }}>
              <rect x="0" y="18" width="9" height="12" rx="2" fill={`${card.color}59`} />
              <rect x="14" y="11" width="9" height="19" rx="2" fill={`${card.color}8c`} />
              <rect x="28" y="5" width="9" height="25" rx="2" fill={card.color} fillOpacity=".8" />
              <rect x="42" y="14" width="9" height="16" rx="2" fill={`${card.color}73`} />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
