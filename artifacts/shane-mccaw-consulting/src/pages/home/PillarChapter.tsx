import { useEffect, useRef, useState } from "react";
import type { ChapterDatum } from "./chapterData";
import { useParallax, useReveal } from "./useScrollFx";

function useCountUp(target: number | null, active: boolean): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active || target == null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    const dur = 1100;
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const t = Math.min(1, (Date.now() - t0) / dur);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t >= 1) window.clearInterval(id);
    }, 40);
    return () => window.clearInterval(id);
  }, [active, target]);
  return active ? value : 0;
}

export function PillarChapter({
  chapter,
  headline,
  body,
  showBenchmarks,
  showCaption,
}: {
  chapter: ChapterDatum;
  headline: string;
  body: string;
  showBenchmarks: boolean;
  showCaption: boolean;
}) {
  const revealRef = useReveal<HTMLElement>();
  const iconParallax = useParallax<HTMLDivElement>(0.3);
  const glowParallax = useParallax<HTMLDivElement>(0.14);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = revealRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [revealRef]);

  const countUp = useCountUp(chapter.statValue, inView);

  return (
    <article
      ref={revealRef}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))",
        gap: "clamp(26px,4vw,64px)",
        padding: "clamp(44px,7vw,72px) 0",
        position: "relative",
        overflow: "hidden",
        borderTop: "1px solid rgba(30,41,59,.75)",
      }}
    >
      <div ref={iconParallax} style={{ position: "absolute", left: 0, top: "8%", width: 340, height: 340, opacity: 0.055, pointerEvents: "none", willChange: "transform" }}>
        {chapter.icon}
      </div>
      <div
        ref={glowParallax}
        style={{
          position: "absolute",
          left: 0,
          top: "6%",
          width: 380,
          height: 380,
          borderRadius: "50%",
          background: `radial-gradient(circle,${chapter.glow},transparent 68%)`,
          filter: "blur(30px)",
          pointerEvents: "none",
          willChange: "transform",
        }}
      />

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: chapter.color, boxShadow: `0 0 14px ${chapter.color}` }} />
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: chapter.color }}>{chapter.tag}</span>
        </div>
        <div style={{ fontSize: "clamp(52px,11vw,80px)", fontWeight: 800, letterSpacing: "-.04em", color: "#f1f5f9", lineHeight: 0.95 }}>
          {chapter.statPrefix}
          {chapter.statValue != null ? countUp : chapter.statLiteral}
          {chapter.statSuffix}
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: "#64748b", margin: "14px 0 0", maxWidth: 270 }}>{chapter.statCaption}</p>
      </div>

      <div>
        <h3 style={{ fontSize: "clamp(21px,3.7vw,26px)", fontWeight: 700, letterSpacing: "-.015em", color: "#f1f5f9", margin: "0 0 14px" }}>{headline}</h3>
        <p style={{ fontSize: 16, lineHeight: 1.7, color: "#94a3b8", margin: "0 0 12px" }}>{body}</p>

        {showBenchmarks && (
          <div style={{ marginTop: 26, display: "grid", gap: 14, maxWidth: 520 }}>
            <BenchmarkRow label="Organizations like yours" pct={chapter.bench.orgPct} color={chapter.color} track />
            <BenchmarkRow label="Top quartile" pct={chapter.bench.topPct} color={chapter.color} />
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "14px 24px", marginTop: 10 }}>
              <span style={{ fontSize: 11, color: "#475569", letterSpacing: ".04em" }}>{chapter.bench.metricLabel}</span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                <svg width="118" height="30" viewBox="0 0 118 30" style={{ display: "block" }}>
                  <polyline
                    points={chapter.bench.sparkline}
                    fill="none"
                    stroke={chapter.color}
                    strokeOpacity=".85"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ filter: `drop-shadow(0 0 4px ${chapter.color}66)` }}
                  />
                </svg>
                <span style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#334155" }}>Illustrative trend</span>
              </span>
            </div>
          </div>
        )}

        <div style={{ marginTop: 28, maxWidth: 540, borderTop: "1px solid rgba(30,41,59,.9)", paddingTop: 16 }}>
          <span style={{ fontSize: "clamp(9.5px,2vw,10.5px)", fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#475569" }}>What we check</span>
          <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 9 }}>
            {chapter.whatWeCheck.map((item) => (
              <li key={item} style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 13.5, lineHeight: 1.5, color: "#94a3b8" }}>
                <span style={{ width: 5, height: 5, borderRadius: 1, background: chapter.color, opacity: 0.9, flexShrink: 0, transform: "translateY(-2px)" }} />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {chapter.costBox && (
          <div
            style={{
              marginTop: 24,
              maxWidth: 540,
              border: "1px solid rgba(45,212,191,.3)",
              borderRadius: 14,
              background: "linear-gradient(160deg,rgba(19,78,74,.3),rgba(15,23,42,.72) 70%)",
              padding: "22px 24px",
            }}
          >
            <span style={{ fontSize: "clamp(9.5px,2vw,10.5px)", fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#2dd4bf" }}>Cost recoupment</span>
            <p style={{ fontSize: 17, lineHeight: 1.55, color: "#f1f5f9", margin: "10px 0 0", fontWeight: 500 }}>{chapter.costBox.body}</p>
            <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "#475569", margin: "12px 0 0" }}>{chapter.costBox.note}</p>
          </div>
        )}

        {showCaption && (
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginTop: 30, maxWidth: 560 }}>
            <span
              style={{
                flexShrink: 0,
                width: 26,
                height: 26,
                borderRadius: 8,
                background: "linear-gradient(135deg,#0078D4,#00B4D8)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "-.5px",
              }}
            >
              SM
            </span>
            <p style={{ fontSize: 15, lineHeight: 1.65, color: "#cbd5e1", margin: 0, fontStyle: "italic" }}>{chapter.quote}</p>
          </div>
        )}
      </div>
    </article>
  );
}

function BenchmarkRow({ label, pct, color, track }: { label: string; pct: number; color: string; track?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "clamp(92px,26vw,170px) minmax(0,1fr) 44px", alignItems: "center", gap: 14 }}>
      <span style={{ fontSize: 12, color: "#64748b" }}>{label}</span>
      <span style={{ height: 6, borderRadius: 3, background: "rgba(30,41,59,.9)", position: "relative", overflow: "hidden" }}>
        <span style={{ position: "absolute", inset: `0 ${100 - pct}% 0 0`, background: track ? shadeBar(color) : color, borderRadius: 3 }} />
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", textAlign: "right" }}>{pct}%</span>
    </div>
  );
}

/** The "organizations like yours" bar uses a slightly duller shade of the pillar color per the design (e.g. #3B82F6 vs #60a5fa for Governance). */
function shadeBar(color: string): string {
  const map: Record<string, string> = {
    "#60a5fa": "#3B82F6",
    "#a78bfa": "#8b5cf6",
    "#D1D5DB": "#D1D5DB",
    "#2dd4bf": "#14b8a6",
    "#fb923c": "#f97316",
    "#4ADE80": "#22C55E",
  };
  return map[color] ?? color;
}
