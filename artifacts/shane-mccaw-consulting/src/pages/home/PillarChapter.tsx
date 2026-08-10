import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ChapterDatum } from "./chapterData";
import { useParallax, useReveal } from "./useScrollFx";
import { Button } from "./dsComponents";

/** How far down the viewport the line sits that decides which chapter "owns" the
 * stage. Slightly above centre so the wordmark changes as a section's heading
 * arrives, not after you've already read half of it. */
const FOCUS_LINE = 0.42;

/** The old `paintRoom` faded the wordmark out, swapped its text/colour/icon, then
 * faded it back in. Same beat, same 240ms. */
const SWAP_MS = 240;

const WORDMARK_CSS = `
.smc-wordmark{position:fixed;left:0;right:0;top:42%;z-index:0;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:clamp(10px,2.4vw,34px);pointer-events:none;transition:opacity 900ms cubic-bezier(.22,1,.36,1),transform 900ms cubic-bezier(.22,1,.36,1)}
.smc-wordmark-text{font-size:clamp(40px,12.4vw,168px);font-weight:800;letter-spacing:-.04em;line-height:.86;white-space:nowrap;-webkit-text-fill-color:transparent;-webkit-text-stroke-color:currentColor;-webkit-text-stroke-width:clamp(1.2px,.28vw,2.6px);opacity:.28}
.smc-wordmark-glyph{width:clamp(44px,9vw,132px);height:auto;flex:0 0 auto;opacity:.4}
@media (max-width:640px){.smc-wordmark{top:34%;gap:8px}.smc-wordmark-text{opacity:.2;-webkit-text-stroke-width:1.4px}.smc-wordmark-glyph{opacity:.28}}
@media (prefers-reduced-motion:reduce){.smc-wordmark{transition:opacity 200ms linear}}
`;

/** Chapters announce themselves to the stage through this, so the fixed wordmark
 * layer knows which pillar is currently in view. */
const ChapterStageContext = createContext<((index: number, el: HTMLElement | null, chapter: ChapterDatum) => void) | null>(null);

/**
 * The giant outlined pillar wordmark + glyph that sits fixed behind the scrolling
 * chapters, so crossing from one pillar into the next is unmistakable (#452).
 *
 * Ported from the pre-rebuild `RoomStage.tsx` / `useRoomChoreography.ts` (deleted
 * at `a42b8118`), but driven by React state off whichever chapter straddles the
 * viewport's focus line rather than the old `querySelector`/`innerHTML` repaint.
 * Renders a fragment, so it adds no box to the chapter list's own layout.
 */
export function PillarChapterStage({ children }: { children: ReactNode }) {
  const chapters = useRef(new Map<number, { el: HTMLElement; chapter: ChapterDatum }>());
  const [active, setActive] = useState<ChapterDatum | null>(null);
  const [painted, setPainted] = useState<ChapterDatum | null>(null);
  const [lit, setLit] = useState(false);

  const register = useCallback((index: number, el: HTMLElement | null, chapter: ChapterDatum) => {
    if (el) chapters.current.set(index, { el, chapter });
    else chapters.current.delete(index);
  }, []);

  useEffect(() => {
    let queued = false;
    const run = () => {
      queued = false;
      const focus = window.innerHeight * FOCUS_LINE;
      let next: ChapterDatum | null = null;
      for (const { el, chapter } of chapters.current.values()) {
        const r = el.getBoundingClientRect();
        if (r.top <= focus && r.bottom > focus) next = chapter;
      }
      setActive((prev) => (prev?.index === next?.index ? prev : next));
    };
    const request = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(run);
    };
    request();
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
    return () => {
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
    };
  }, []);

  useEffect(() => {
    if (active?.index === painted?.index) {
      setLit(active != null);
      return;
    }
    setLit(false);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPainted(active);
      setLit(active != null);
      return;
    }
    const id = window.setTimeout(() => {
      setPainted(active);
      setLit(active != null);
    }, SWAP_MS);
    return () => window.clearTimeout(id);
  }, [active, painted]);

  return (
    <>
      <style>{WORDMARK_CSS}</style>
      <div
        aria-hidden
        className="smc-wordmark"
        style={{
          color: painted?.color ?? "transparent",
          opacity: lit ? 1 : 0,
          transform: lit ? "translateY(-50%) scale(1)" : "translateY(-50%) scale(.965)",
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" className="smc-wordmark-glyph">
          {painted?.glyph}
        </svg>
        <span className="smc-wordmark-text">{painted?.name.toUpperCase() ?? ""}</span>
      </div>
      <ChapterStageContext.Provider value={register}>{children}</ChapterStageContext.Provider>
    </>
  );
}

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
  const glowParallax = useParallax<HTMLDivElement>(0.14);
  const [inView, setInView] = useState(false);
  const register = useContext(ChapterStageContext);

  useEffect(() => {
    const el = revealRef.current;
    if (!register || !el) return;
    register(chapter.index, el, chapter);
    return () => register(chapter.index, null, chapter);
  }, [register, revealRef, chapter]);

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
      {/* The old opacity-.055 parallax icon watermark that used to sit here is gone:
          #452 named it as one of the cues too faint to register, and the fixed
          wordmark glyph is the same shape doing the same job, legibly. */}
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
              <span style={{ fontSize: 11, color: "#64748b", letterSpacing: ".04em" }}>{chapter.bench.metricLabel}</span>
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
                <span style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8" }}>Illustrative trend</span>
              </span>
            </div>
          </div>
        )}

        <div style={{ marginTop: 28, maxWidth: 540, borderTop: "1px solid rgba(30,41,59,.9)", paddingTop: 16 }}>
          <span style={{ fontSize: "clamp(9.5px,2vw,10.5px)", fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#64748b" }}>What we check</span>
          <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 9 }}>
            {chapter.whatWeCheck.map((item) => (
              <li key={item} style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 13.5, lineHeight: 1.5, color: "#94a3b8" }}>
                <span style={{ width: 5, height: 5, borderRadius: 1, background: chapter.color, opacity: 0.9, flexShrink: 0, transform: "translateY(-2px)" }} />
                {item}
              </li>
            ))}
          </ul>
          {chapter.whatWeCheckNote && (
            <p style={{ marginTop: 10, fontSize: 12, lineHeight: 1.5, color: "#64748b" }}>{chapter.whatWeCheckNote}</p>
          )}
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
            <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "#64748b", margin: "12px 0 0" }}>{chapter.costBox.note}</p>
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

        {/* #667: Clarity heatmap showed visitors bailing right around here (33%
            scroll depth, hottest at Licensing) with no low-friction path forward
            until the far-later #assessment section. Same anchor-to-#assessment
            mechanism as the header's "Get Your Real Score" button. */}
        <div style={{ marginTop: 28 }}>
          <Button as="a" href="#assessment" size="sm">
            Run your scan for {chapter.name}
          </Button>
        </div>
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
