import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Footer } from "@/components/Footer";
import { SEOMeta } from "@/components/SEOMeta";
import { useServices, resolvePublicServicePriceCents } from "@/hooks/useServices";
import { useTypewriterHeadline } from "@/hooks/useHeroHeadlines";
import { Button, Eyebrow, Logo } from "./home/dsComponents";
import { PILLARS, QUESTIONS, VARIANTS, VALUES, LETTERS, SEATS } from "./home/quizData";
import { CHAPTERS } from "./home/chapterData";
import { REPORT_CARDS } from "./home/reportCardData";
import { RadarChart, RadarBackdrop, OrbitRing } from "./home/RadarChart";
import { PillarChapter } from "./home/PillarChapter";
import { ReportCard } from "./home/ReportCard";
import { AssessmentFlow } from "./home/AssessmentFlow";
import { useReveal, useParallax } from "./home/useScrollFx";

/**
 * The catalog row this page's assessment CTA references. Matched by exact
 * service name, the same convention the previous Home.tsx used — the price
 * comes from `/api/services`, never a literal in this file.
 */
const COPILOT_ASSESSMENT_NAME = "Copilot Readiness Assessment";
const FEE_UNRESOLVED = "a fixed fee";

function formatCents(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString("en-US");
}

const KEYFRAMES = `
@keyframes smcSpin{to{transform:rotate(360deg)}}
@keyframes smcOrb{to{transform:rotate(-360deg)}}
@keyframes smcBreath{0%,100%{opacity:.42}50%{opacity:.72}}
@keyframes smcBlink{50%{opacity:0}}
@keyframes smcHeroShimmer{0%{background-position:0 0,0% 0}100%{background-position:0 0,220% 0}}
@media (prefers-reduced-motion:reduce){.smc-sheen{display:none}.smc-hero-gradient{animation:none!important}}
.smc-scope-group summary{list-style:none}
.smc-scope-group summary::-webkit-details-marker{display:none}
.smc-scope-group summary::after{content:"";width:7px;height:7px;margin-left:auto;flex-shrink:0;border-right:1.5px solid #64748b;border-bottom:1.5px solid #64748b;transform:rotate(45deg);transition:transform .15s ease}
.smc-scope-group[open] summary::after{transform:rotate(-135deg)}
`;

const HEADLINE_FONT_SIZE = "clamp(30px,6.4vw,52px)";
const HEADLINE_LINE_HEIGHT = 1.06;
const HEADLINE_LETTER_SPACING = "-.028em";
const HEADLINE_WIDTH = 520;
const HEADLINE_BOX_HEIGHT_EM = 3.18;
const HEADLINE_MIN_SCALE = 0.42;

/** Blue -> Violet -> Cyan -> White primary treatment (#446), with a second
 * comma-layered background (the same background-position-sweep technique the
 * War Room briefing scene's "tipsheen" line already uses) blended on top for
 * the holographic rainbow shimmer accent, so this reuses that established
 * shimmer pattern instead of introducing a new one. */
const HERO_GRADIENT_STYLE = {
  backgroundImage:
    "linear-gradient(96deg,#93c5fd 0%,#c4b5fd 33%,#a5f3fc 66%,#ffffff 100%)," +
    "linear-gradient(96deg,transparent 0%,#67e8f9 10%,#a78bfa 20%,#f472b6 30%,#fbbf24 40%,transparent 50%)",
  backgroundSize: "100% 100%, 220% 100%",
  backgroundPosition: "0 0, 0% 0",
  // #450: "overlay" rendered text near-invisible wherever the shimmer layer's
  // transparent stops (rgba(0,0,0,0), interpolated non-premultiplied toward
  // the adjacent color stops) swept over it — confirmed by rendering this
  // exact gradient pair at several shimmer sweep positions and headline
  // lengths and screenshotting: the 50%-ish sweep position went nearly
  // black-on-black under overlay, matching Shane's screenshot. "screen" never
  // darkens (screen(x,0)=x), so every sweep position stays readable while
  // keeping the rainbow shimmer accent.
  backgroundBlendMode: "screen",
  WebkitBackgroundClip: "text" as const,
  backgroundClip: "text" as const,
  color: "transparent",
  animation: "smcHeroShimmer 5s linear infinite",
};

/** Types out admin-authored headline variants (admin-panel/content/hero-headlines)
 * one character at a time, cycling through the set — replaces the old static
 * hardcoded h1 (#429). Falls back to a single static headline via the hook
 * itself if the API returns nothing.
 *
 * The outer box keeps the fixed footprint #442 introduced (no reflow of the
 * quiz card/radar while cycling), but instead of `overflow:hidden` clipping
 * any variant longer than that footprint (#445), the h1 inside it is
 * auto-shrunk to whatever font-size lets the CURRENT variant's full text wrap
 * and fit within the box — measured once per headline (not per keystroke, so
 * the size never changes mid-type/delete) against a hidden same-width clone. */
function TypewriterHeadline() {
  const { leadDisplayed, gradientDisplayed, current } = useTypewriterHeadline();
  const boxRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const measure = measureRef.current;
    if (!box || !measure) return;

    const fit = () => {
      const availableHeight = box.clientHeight;
      if (!availableHeight) return;
      const fullText = current.leadText + current.gradientText;
      measure.textContent = fullText || " ";

      measure.style.fontSize = "100%";
      if (measure.scrollHeight <= availableHeight) {
        setScale(1);
        return;
      }

      let lo = HEADLINE_MIN_SCALE * 100;
      let hi = 100;
      let best = lo;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        measure.style.fontSize = `${mid}%`;
        if (measure.scrollHeight <= availableHeight) {
          best = mid;
          lo = mid;
        } else {
          hi = mid;
        }
      }
      setScale(best / 100);
    };

    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [current]);

  return (
    <div
      ref={boxRef}
      style={{
        fontSize: HEADLINE_FONT_SIZE,
        width: HEADLINE_WIDTH,
        maxWidth: "100%",
        height: `${HEADLINE_BOX_HEIGHT_EM}em`,
        margin: "22px 0 16px",
        overflow: "hidden",
      }}
    >
      <span
        ref={measureRef}
        aria-hidden
        style={{
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
          left: -99999,
          top: -99999,
          display: "block",
          width: HEADLINE_WIDTH,
          maxWidth: "100%",
          lineHeight: HEADLINE_LINE_HEIGHT,
          letterSpacing: HEADLINE_LETTER_SPACING,
          fontWeight: 800,
          whiteSpace: "normal",
          wordBreak: "break-word",
        }}
      />
      <h1
        style={{
          fontSize: `${scale * 100}%`,
          lineHeight: HEADLINE_LINE_HEIGHT,
          letterSpacing: HEADLINE_LETTER_SPACING,
          fontWeight: 800,
          color: "#f8fafc",
          margin: 0,
          whiteSpace: "normal",
          wordBreak: "break-word",
        }}
      >
        {leadDisplayed}
        <span className="smc-hero-gradient" style={HERO_GRADIENT_STYLE}>{gradientDisplayed}</span>
        <span aria-hidden style={{ display: "inline-block", width: 3, height: "0.8em", marginLeft: 2, verticalAlign: "-0.1em", background: "#60a5fa", animation: "smcBlink 1s step-end infinite" }} />
      </h1>
    </div>
  );
}

type Answers = (number | null)[];

const RADAR_SIDE_LABELS: { pillar: string; blurb: string; color: string; left: string; top: string; align: "left" | "right" }[] = [
  { pillar: "Governance", blurb: "1 in 3 lack a named owner", color: "#60a5fa", left: "62%", top: "16.5%", align: "left" },
  { pillar: "Security", blurb: "41% have a CA bypass path", color: "#a78bfa", left: "74%", top: "50%", align: "left" },
  { pillar: "Compliance", blurb: "Over-sharing: 6-month lag", color: "#D1D5DB", left: "62%", top: "83.5%", align: "left" },
  { pillar: "Licensing", blurb: "22% of seats sit unused", color: "#2dd4bf", left: "38%", top: "83.5%", align: "right" },
  { pillar: "Adoption", blurb: "3 apps carry all usage", color: "#fb923c", left: "26%", top: "50%", align: "right" },
  { pillar: "Health", blurb: "Config changes hourly", color: "#4ADE80", left: "38%", top: "16.5%", align: "right" },
];

export default function Home() {
  const { services } = useServices();
  const service = useMemo(() => services.find((s) => s.name.trim() === COPILOT_ASSESSMENT_NAME) ?? null, [services]);
  const feeCents = service ? resolvePublicServicePriceCents(service) : null;
  const feePrice = feeCents != null && feeCents > 0 ? formatCents(feeCents) : null;
  const fee = feePrice ?? FEE_UNRESOLVED;
  /** Real "what's included" copy off the catalog row, for the checkout's value
   *  column (#430). The flow falls back to its own list when all three are empty. */
  const assessmentIncludes = useMemo(
    () => service?.inclusions ?? service?.features ?? service?.deliverables ?? null,
    [service],
  );

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>([null, null, null, null, null, null, null]);
  const [done, setDone] = useState(false);

  const wedges = useMemo(() => PILLARS.map((_, i) => (answers[i + 1] == null ? 0.1 : VALUES[answers[i + 1] as number])), [answers]);
  const score = Math.round((wedges.reduce((s, v) => s + v, 0) / wedges.length) * 100);
  const answered = answers.slice(1).some((a) => a !== null);
  const band = score >= 80 ? "Advanced" : score >= 60 ? "Established" : score >= 40 ? "Developing" : "Early";
  const seat = answers[0] == null ? null : SEATS[answers[0] as number];
  const cohortPhrase = seat ? `with ${seat}` : "of comparable size";
  const blurb =
    score >= 70
      ? "Strong for an estimate, which usually means the gaps are narrow and specific. Those are the ones a scan finds and a questionnaire never will."
      : score >= 45
        ? "A middling estimate almost always hides one pillar dragging the rest down. Which one it is, is the whole question."
        : "An estimate this low is common and fixable. The order you fix things in matters more than the score itself.";

  const bonusText = useMemo(() => {
    const [, gov, sec, , lic] = answers;
    if (gov === null || sec === null || lic === null) return "";
    const govWeak = gov <= 1;
    const govStrong = gov >= 2;
    const secWeak = sec <= 1;
    const secStrong = sec >= 2;
    const licNone = lic === 0;
    const licCommitted = lic >= 2;
    if (govWeak && secWeak && licCommitted)
      return "All three foundational pillars — security, governance and licensing — have real gaps, and seats are already committed. Close those and the work left is getting your people using it well. That is exactly what White-Glove Adoption is built for.";
    if (govWeak && licNone)
      return "Nobody owns governance and no licences are bought yet. That is the cleanest possible starting position: settle ownership before the licensing decision, not after it.";
    if (secStrong && govWeak)
      return "Your security answers look solid today. With nobody owning governance, that is a snapshot rather than a guarantee — policies drift when no one is watching them.";
    if (secWeak && licNone)
      return "You have not spent anything on Copilot licensing yet, so nothing is on a deadline. Worth closing the security gaps now, before a purchase adds one.";
    if (govStrong && secStrong && licCommitted)
      return "Security, governance and licensing all hold up. At that point the constraint is not the tenant, it is whether your people are being shown how to use it — which is where White-Glove Adoption picks up.";
    return "";
  }, [answers]);

  const q = QUESTIONS[step];

  const pick = (i: number) => {
    const next = answers.slice();
    next[step] = i;
    const last = step >= QUESTIONS.length - 1;
    setAnswers(next);
    setDone(last);
    if (!last) setStep(step + 1);
  };
  const back = () => {
    if (step > 0) {
      setStep(step - 1);
      setDone(false);
    }
  };
  const restart = () => {
    setStep(0);
    setAnswers([null, null, null, null, null, null, null]);
    setDone(false);
  };
  const goEditorial = () => {
    const el = document.getElementById("chapters");
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72, behavior: "smooth" });
  };
  const goAdoption = () => {
    const el = document.getElementById("adoption");
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72, behavior: "smooth" });
  };
  /** #453: above this score the foundational pillars already look strong per
   *  self-report, so White-Glove Adoption becomes the headline upsell — a
   *  prominence change only, distinct from `band`/`bonusText`. The Copilot
   *  Assessment stays the actual purchase; this just surfaces existing
   *  "adoption" section content earlier instead of only late-page. */
  const highAdoptionFit = score > 82;

  const hubSize = done ? "56%" : "54%";
  const hubGlow = done ? "46%" : "40%";
  const hubGlowOpacity = done ? 0.6 : 0.32;
  const hubFont = done ? 38 : 24;
  const hubNum = answered ? String(score) : "—";
  const hubLabel = done ? "Estimated" : "Live estimate";

  const chaptersReveal = useReveal<HTMLDivElement>();
  const deliverablesReveal = useReveal<HTMLDivElement>();
  const adoptionReveal1 = useReveal<HTMLDivElement>();
  const adoptionReveal2 = useReveal<HTMLDivElement>();
  const adoptionReveal3 = useReveal<HTMLDivElement>();
  const assessmentReveal = useReveal<HTMLDivElement>();
  const closingLine = done ? `Your estimate of ${score} came from seven answers about how things are meant to work.` : "An estimate comes from how things are meant to work.";

  return (
    <>
      <SEOMeta
        title="Copilot Readiness — Free Estimate | Shane McCaw Consulting"
        description="Seven questions. No sign-in, no scan, no sales call. Find out whether your Microsoft 365 tenant is actually ready for Copilot."
      />
      <div className="dark" style={{ background: "#020617", color: "#cbd5e1", fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh", overflowX: "hidden" }}>
        <style>{KEYFRAMES}</style>

        <header style={{ position: "sticky", top: 0, zIndex: 50, height: 80, background: "rgba(2,6,23,.95)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(30,41,59,.8)" }}>
          <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 clamp(16px,4vw,32px)", height: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <Logo tagline="M365 Architect" onDark />
            <Button as="a" href="#assessment">
              Get Your Real Score
            </Button>
          </div>
        </header>

        {/* ------------------------------------------------------------ Quiz + radar hero */}
        <section
          id="quiz"
          style={{
            maxWidth: 1280,
            margin: "0 auto",
            padding: "clamp(40px,8vw,72px) clamp(16px,4vw,32px) clamp(56px,9vw,96px)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,400px),1fr))",
            gap: "clamp(40px,6vw,72px)",
            alignItems: "center",
          }}
        >
          <div>
            <Eyebrow>Your Estimated Readiness Score</Eyebrow>
            <TypewriterHeadline />
            <p style={{ fontSize: "clamp(15px,2.3vw,17px)", lineHeight: 1.6, color: "#94a3b8", margin: "0 0 32px", maxWidth: 440 }}>
              Seven questions. No sign-in, no scan, no sales call. The radar fills in as you answer, one pillar at a time.
            </p>

            {!done && (
              <div style={{ background: "#0f172a", border: "1px solid rgba(30,41,59,.9)", borderRadius: 16, padding: "clamp(18px,4vw,26px) clamp(18px,4vw,26px) 22px", maxWidth: 520 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".12em", color: "#f1f5f9" }}>{String(step + 1).padStart(2, "0")}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".12em", color: "#475569" }}>/ {String(QUESTIONS.length).padStart(2, "0")}</span>
                    <span style={{ width: 1, height: 12, background: "#334155" }} />
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: q.color }}>{q.tag}</span>
                  </div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {QUESTIONS.map((_, i) => (
                      <span key={i} style={{ width: 16, height: 3, borderRadius: 2, background: i < step || done ? "#3b82f6" : i === step ? "#60a5fa" : "rgba(51,65,85,.9)", transition: "background .3s" }} />
                    ))}
                  </div>
                </div>

                <p style={{ fontSize: "clamp(19px,3.4vw,22px)", lineHeight: 1.3, fontWeight: 600, color: "#f8fafc", margin: "0 0 20px", letterSpacing: "-.01em", minHeight: 58 }}>{q.q}</p>

                <div style={{ display: "grid", gap: 8 }}>
                  {q.opts.map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => pick(i)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        width: "100%",
                        textAlign: "left",
                        padding: "14px 16px",
                        borderRadius: 10,
                        border: "1px solid rgba(51,65,85,.8)",
                        background: "rgba(2,6,23,.5)",
                        color: "#e2e8f0",
                        fontFamily: "inherit",
                        fontSize: 15,
                        cursor: "pointer",
                        transition: "border-color .18s,background .18s",
                      }}
                    >
                      <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(71,85,105,.9)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                        {LETTERS[i]}
                      </span>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18, minHeight: 20 }}>
                  <button type="button" onClick={back} style={{ background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 13, color: "#475569", cursor: "pointer", visibility: step > 0 ? "visible" : "hidden" }}>
                    ← Previous question
                  </button>
                  <span style={{ fontSize: 12, color: "#334155" }}>Illustrative estimate only</span>
                </div>
              </div>
            )}

            {done && (
              <div style={{ background: "linear-gradient(160deg,rgba(23,37,84,.42),#0f172a 62%)", border: "1px solid rgba(37,99,235,.28)", borderRadius: 16, padding: "clamp(20px,4vw,28px)", maxWidth: 520 }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#60a5fa" }}>Estimated Copilot Readiness</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "12px 0 6px" }}>
                  <span style={{ fontSize: "clamp(54px,13vw,82px)", fontWeight: 800, letterSpacing: "-.04em", lineHeight: 0.9, color: "#f8fafc" }}>{score}</span>
                  <span style={{ fontSize: 22, fontWeight: 600, color: "#475569" }}>/ 100</span>
                  <span style={{ marginLeft: 8, padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, letterSpacing: ".06em", background: "rgba(37,99,235,.12)", border: "1px solid rgba(37,99,235,.3)", color: "#93c5fd" }}>
                    {band}
                  </span>
                </div>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: "#94a3b8", margin: "14px 0 22px", maxWidth: 400 }}>{blurb}</p>
                {bonusText && (
                  <div style={{ borderTop: "1px solid rgba(37,99,235,.22)", paddingTop: 18, margin: "0 0 22px" }}>
                    <span style={{ fontSize: "clamp(9.5px,2vw,10.5px)", fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#60A5FA" }}>One thing we noticed</span>
                    <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "#e2e8f0", margin: "10px 0 0", maxWidth: 440 }}>{bonusText}</p>
                  </div>
                )}
                {highAdoptionFit && (
                  <div style={{ border: "1px solid rgba(251,146,60,.3)", background: "linear-gradient(160deg,rgba(60,28,10,.4),rgba(9,14,28,.5) 70%)", borderRadius: 14, padding: "18px 20px", margin: "0 0 22px" }}>
                    <span style={{ fontSize: "clamp(9.5px,2vw,10.5px)", fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#FB923C" }}>Your better next step</span>
                    <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "#e2e8f0", margin: "10px 0 14px", maxWidth: 440 }}>
                      An estimate this high usually means the foundational pillars already hold up. The assessment still confirms that against your real tenant, but from here the bigger lever is White-Glove
                      Copilot Adoption — getting your people to the second prompt.
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                      {ADOPTION_STEPS.slice(0, 3).map((s) => (
                        <span key={s.title} style={{ fontSize: 12, color: "#fdba74", border: "1px solid rgba(251,146,60,.3)", background: "rgba(251,146,60,.09)", borderRadius: 999, padding: "6px 12px" }}>
                          {s.title}
                        </span>
                      ))}
                    </div>
                    <Button size="sm" variant="outline" onClick={goAdoption} style={{ borderColor: "rgba(251,146,60,.4)", color: "#fdba74" }}>
                      See the White-Glove Adoption programme
                    </Button>
                  </div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <Button size="lg" onClick={goEditorial}>
                    Read What the Data Says
                  </Button>
                  <Button size="lg" variant="ghost" onClick={restart}>
                    Start over
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div style={{ position: "relative", width: "100%", maxWidth: 720, margin: "0 auto", aspectRatio: "1/0.62" }}>
            <div style={{ position: "absolute", left: "27%", top: "12.9%", width: "46%", height: "74.2%" }}>
              <svg viewBox="0 0 480 480" style={{ position: "relative", width: "100%", height: "100%", display: "block", overflow: "visible" }}>
                <defs>
                  <radialGradient id="hubGlow" gradientUnits="userSpaceOnUse" cx="240" cy="240" r="122">
                    <stop offset="0" stopColor="#ffffff" stopOpacity="0.30" />
                    <stop offset="0.34" stopColor="#22D3EE" stopOpacity="0.26" />
                    <stop offset="0.72" stopColor="#3B82F6" stopOpacity="0.16" />
                    <stop offset="1" stopColor="#020617" stopOpacity="0" />
                  </radialGradient>
                  <radialGradient id="sheen" gradientUnits="userSpaceOnUse" cx="240" cy="240" r="214">
                    <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.22" />
                    <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
                  </radialGradient>
                </defs>

                <circle cx="240" cy="240" r="214" fill="none" stroke="rgba(148,163,184,.16)" strokeWidth="1" />
                <circle cx="240" cy="240" r="143" fill="none" stroke="rgba(148,163,184,.10)" strokeWidth="1" />
                <circle cx="240" cy="240" r="71" fill="none" stroke="rgba(148,163,184,.08)" strokeWidth="1" />
                <g stroke="rgba(148,163,184,.10)" strokeWidth="1">
                  <line x1="240" y1="240" x2="240" y2="26" />
                  <line x1="240" y1="240" x2="425.33" y2="133" />
                  <line x1="240" y1="240" x2="425.33" y2="347" />
                  <line x1="240" y1="240" x2="240" y2="454" />
                  <line x1="240" y1="240" x2="54.67" y2="347" />
                  <line x1="240" y1="240" x2="54.67" y2="133" />
                </g>

                <circle cx="240" cy="240" r="100" fill="#050d1f" />
                <circle cx="240" cy="240" r="100" fill="url(#hubGlow)" />

                <RadarBackdrop />
              </svg>

              <div style={{ position: "absolute", inset: 0 }}>
                <RadarChart idPrefix="wg" values={wedges} />
              </div>

              <div className="smc-sheen" style={{ position: "absolute", inset: 0, mixBlendMode: "screen", pointerEvents: "none" }}>
                <svg viewBox="0 0 480 480" style={{ width: "100%", height: "100%" }}>
                  <path d="M240,240 L247.47,26.13 A214,214 0 0 1 421.48,126.60 Z" fill="url(#sheen)" opacity=".55">
                    <animateTransform attributeName="transform" type="rotate" from="0 240 240" to="360 240 240" dur="9s" repeatCount="indefinite" />
                  </path>
                </svg>
              </div>

              <OrbitRing size={hubGlow} opacity={hubGlowOpacity} spin={false} />
              <OrbitRing size={hubSize} opacity={0.5} />

              <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <span style={{ fontSize: hubFont, fontWeight: 800, letterSpacing: "-.03em", color: "#f8fafc", lineHeight: 1, transition: "font-size .8s ease" }}>{hubNum}</span>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#bcccdc", textShadow: "0 1px 6px rgba(2,6,23,.9)" }}>{hubLabel}</span>
              </div>
            </div>

            {RADAR_SIDE_LABELS.map((l) => (
              <div
                key={l.pillar}
                style={{
                  position: "absolute",
                  left: l.left,
                  top: l.top,
                  transform: l.align === "left" ? "translate(0,-50%)" : "translate(-100%,-50%)",
                  width: "clamp(84px,23vw,148px)",
                  textAlign: l.align,
                  pointerEvents: "none",
                }}
              >
                <div style={{ fontSize: "clamp(9.5px,2vw,10.5px)", fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: l.color }}>{l.pillar}</div>
                <div style={{ fontSize: "clamp(10px,2.1vw,11px)", lineHeight: 1.35, color: "#64748b", marginTop: 5 }}>{l.blurb}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------------ Aggregate picture / pillar chapters */}
        <div id="chapters" style={{ borderTop: "1px solid rgba(30,41,59,.8)", background: "linear-gradient(180deg,#020617,#040b1e 40%,#020617)" }}>
          <div style={{ maxWidth: 1160, margin: "0 auto", padding: "clamp(56px,9vw,96px) clamp(16px,4vw,32px) 40px" }}>
            <div ref={chaptersReveal} style={{ maxWidth: 720 }}>
              <Eyebrow pill={false}>The Aggregate Picture</Eyebrow>
              <h2 style={{ fontSize: "clamp(28px,5.6vw,42px)", lineHeight: 1.12, letterSpacing: "-.025em", fontWeight: 800, color: "#f8fafc", margin: "16px 0 18px" }}>
                What organizations {cohortPhrase} typically show.
              </h2>
              <p style={{ fontSize: 17, lineHeight: 1.65, color: "#94a3b8", margin: 0 }}>
                Six pillars decide whether Copilot returns anything. The figures below are aggregate and illustrative — drawn from patterns across tenants of comparable size, not from a scan of yours. Narration
                throughout is Shane McCaw, Lead Microsoft 365 Architect at NASA.
              </p>
              <p style={{ fontSize: 15, lineHeight: 1.6, color: "#7dd3c8", margin: "20px 0 0", maxWidth: 640 }}>
                Worth reading as far as Licensing: the unused Copilot seats we typically find are often worth more than the assessment itself.
              </p>
            </div>
          </div>

          <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 clamp(16px,4vw,32px) 40px" }}>
            {CHAPTERS.map((chapter) => {
              const answer = answers[chapter.index + 1];
              const [headline, body] = answer == null ? VARIANTS[chapter.index].none : VARIANTS[chapter.index].a[answer];
              return <PillarChapter key={chapter.index} chapter={chapter} headline={headline} body={body} showBenchmarks showCaption />;
            })}
          </div>
        </div>

        {/* ------------------------------------------------------------ What You Receive (report cards) */}
        <section id="deliverables" style={{ maxWidth: 1160, margin: "0 auto", padding: "16px clamp(16px,4vw,32px) 0" }}>
          <div ref={deliverablesReveal} style={{ maxWidth: 760 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#60A5FA" }}>What You Receive</span>
            <h2 style={{ fontSize: "clamp(28px,5.6vw,42px)", lineHeight: 1.12, letterSpacing: "-.025em", fontWeight: 800, color: "#f8fafc", margin: "16px 0 18px" }}>Eight reports, in under thirty minutes.</h2>
            <p style={{ fontSize: 17, lineHeight: 1.65, color: "#94a3b8", margin: 0 }}>
              The scan takes a minute or two. The reports generate straight after it, sized to your tenant. Every finding carries the evidence behind it and traces to a specific step in the Copilot Gate Clearance
              Plan.
            </p>
          </div>
        </section>

        <section style={{ maxWidth: 1160, margin: "0 auto", padding: "44px clamp(16px,4vw,32px) 24px" }}>
          <div style={{ display: "grid", gap: 56 }}>
            {[0, 2, 4, 6].map((startIdx) => (
              <div key={startIdx} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: "clamp(26px,4vw,34px) 30px", alignItems: "start" }}>
                <ReportCard card={REPORT_CARDS[startIdx]} offsetTop={0} />
                <ReportCard card={REPORT_CARDS[startIdx + 1]} offsetTop={44} />
              </div>
            ))}
          </div>
          <p style={{ fontSize: 13, color: "#475569", margin: "44px 0 0", maxWidth: 760 }}>
            The Statement of Work is generated separately, at the proposal step — it is a contract artifact, not one of the eight reports.
          </p>
        </section>

        {/* ------------------------------------------------------------ White-Glove Copilot Adoption */}
        <section id="adoption" style={{ maxWidth: 1160, margin: "0 auto", padding: "clamp(48px,8vw,72px) clamp(16px,4vw,32px) 24px" }}>
          <div ref={adoptionReveal1} style={{ maxWidth: 760, marginBottom: 36 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#fb923c" }}>White-Glove Copilot Adoption</span>
            <h2 style={{ fontSize: "clamp(28px,5.6vw,42px)", lineHeight: 1.12, letterSpacing: "-.025em", fontWeight: 800, color: "#f8fafc", margin: "16px 0 18px" }}>
              Remediation fixes the tenant. Adoption is how your people actually use it.
            </h2>
            <p style={{ fontSize: 17, lineHeight: 1.65, color: "#94a3b8", margin: 0 }}>
              The assessment and the remediation work that follows put the tenant in a state where Copilot can return something. Getting employees to the second prompt is a separate discipline, and it is the one
              that decides whether the licences renew. The programme is drawn from the enablement work Shane ran at NASA. Anything quoted for it comes from comparable pilot deployments, not a guaranteed outcome
              for your tenant.
            </p>
          </div>

          <div ref={adoptionReveal2} style={{ position: "relative", marginBottom: 52 }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>The programme</span>
              <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg,rgba(249,115,22,.35),rgba(30,41,59,.2))" }} />
            </div>
            <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,230px),1fr))", gap: 18, alignItems: "start" }}>
              {ADOPTION_STEPS.map((s, i) => (
                <div key={s.title} style={{ position: "relative", paddingTop: i % 2 === 1 ? 26 : 0 }}>
                  <div
                    style={{
                      position: "relative",
                      border: "1px solid rgba(30,41,59,.9)",
                      borderRadius: 16,
                      background: "linear-gradient(165deg,rgba(30,20,10,.5),rgba(9,14,28,.92) 62%)",
                      padding: "22px 22px 24px",
                      overflow: "hidden",
                    }}
                  >
                    <span style={{ position: "absolute", right: -14, bottom: -26, fontSize: 96, fontWeight: 800, letterSpacing: "-.05em", lineHeight: 1, color: "rgba(251,146,60,.06)", pointerEvents: "none" }}>{i + 1}</span>
                    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
                      <span style={{ width: 34, height: 34, borderRadius: 11, background: "rgba(249,115,22,.11)", border: "1px solid rgba(249,115,22,.24)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {s.icon}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#FB923C", background: "rgba(249,115,22,.09)", border: "1px solid rgba(249,115,22,.2)", borderRadius: 999, padding: "4px 10px" }}>
                        {s.cadence}
                      </span>
                    </div>
                    <h4 style={{ position: "relative", fontSize: 16, fontWeight: 700, letterSpacing: "-.01em", color: "#f1f5f9", margin: "0 0 8px", lineHeight: 1.3 }}>{s.title}</h4>
                    <p style={{ position: "relative", fontSize: 13.5, lineHeight: 1.6, color: "#94a3b8", margin: 0 }}>{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div ref={adoptionReveal3}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>Three tiers</span>
              <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg,rgba(249,115,22,.35),rgba(30,41,59,.2))" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,258px),1fr))", gap: 18, alignItems: "stretch" }}>
              {ADOPTION_TIERS.map((tier) => (
                <div
                  key={tier.name}
                  style={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    border: tier.featured ? "1px solid rgba(249,115,22,.4)" : "1px solid rgba(30,41,59,.92)",
                    borderRadius: 18,
                    background: tier.featured ? "linear-gradient(168deg,rgba(60,28,10,.5),rgba(9,14,28,.95) 64%)" : "linear-gradient(168deg,rgba(17,25,45,.85),rgba(7,12,26,.95) 70%)",
                    padding: "26px 24px 24px",
                  }}
                >
                  {tier.featured && (
                    <span style={{ position: "absolute", top: -9, left: 24, fontSize: 9.5, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#0b1220", background: "#FB923C", borderRadius: 999, padding: "4px 10px" }}>
                      Most chosen
                    </span>
                  )}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 18 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: tier.featured ? "#FB923C" : "#94a3b8" }}>{tier.name}</span>
                    <span style={{ display: "flex", gap: 4 }}>
                      {[0, 1, 2].map((i) => (
                        <span key={i} style={{ width: 18, height: 4, borderRadius: 2, background: i < tier.dots ? "#F97316" : "rgba(51,65,85,.9)" }} />
                      ))}
                    </span>
                  </div>
                  <div style={{ display: "grid", gap: 10, flex: 1 }}>
                    {tier.features.map((feat) => (
                      <span key={feat} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5, lineHeight: 1.5, color: "#cbd5e1" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FB923C" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 3 }}>
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>{feat}</span>
                      </span>
                    ))}
                  </div>
                  <span style={{ fontSize: 11.5, color: "#475569", marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(30,41,59,.9)" }}>Priced in your proposal</span>
                </div>
              ))}
            </div>
          </div>
          <p style={{ fontSize: 13, color: "#475569", margin: "22px 0 0", maxWidth: 720 }}>
            Offered alongside the assessment in your proposal, not a separate decision to make cold. Tier pricing is confirmed in the proposal.
          </p>
        </section>

        {/* ------------------------------------------------------------ The Real Number / assessment CTA */}
        <section id="assessment" style={{ maxWidth: 1160, margin: "0 auto", padding: "40px clamp(16px,4vw,32px) 110px" }}>
          <div
            ref={assessmentReveal}
            style={{
              position: "relative",
              border: "1px solid rgba(37,99,235,.26)",
              borderRadius: 26,
              background: "radial-gradient(1100px 420px at 6% -14%,rgba(37,99,235,.17),transparent 62%),linear-gradient(168deg,rgba(20,32,72,.5),#070d1e 64%)",
              padding: "clamp(32px,6vw,76px) clamp(20px,5vw,64px)",
              overflow: "hidden",
              boxShadow: "0 40px 90px -50px rgba(2,6,23,.95)",
            }}
          >
            <div
              style={{
                position: "relative",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))",
                gap: "clamp(30px,4vw,56px)",
                alignItems: "center",
              }}
            >
              <div style={{ maxWidth: 600 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
                  <span style={{ width: 26, height: 1, background: "linear-gradient(90deg,#60a5fa,rgba(96,165,250,.15))" }} />
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#60a5fa" }}>The Real Number</span>
                </div>
                <h2 style={{ fontSize: "clamp(30px,5.8vw,46px)", lineHeight: 1.08, letterSpacing: "-.03em", fontWeight: 800, color: "#f8fafc", margin: "0 0 18px" }}>
                  Want your actual number,{" "}
                  <span style={{ background: "linear-gradient(96deg,#93c5fd,#c4b5fd 46%,#a5f3fc)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>not an estimate?</span>
                </h2>
                <p style={{ fontSize: 17, lineHeight: 1.65, color: "#94a3b8", margin: "0 0 20px" }}>
                  {closingLine} The Copilot Readiness Assessment connects to your tenant through the Microsoft Graph API and scores all six pillars on what is actually there — every site, every policy, every
                  dormant seat. You get your Copilot Gate status, your blast radius, the evidence behind every finding, and the order to fix them in.
                </p>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: "#7dd3c8", margin: "0 0 32px" }}>
                  It's not a one-time snapshot: the same scan re-runs weekly, so you can watch your score move as things change instead of guessing whether last quarter's fixes stuck.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#cbd5e1", border: "1px solid rgba(51,65,85,.85)", background: "rgba(2,6,23,.45)", borderRadius: 999, padding: "7px 14px" }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#60a5fa", boxShadow: "0 0 10px #60a5fa", flexShrink: 0 }} />
                    NASA's M365 Copilot Architect
                  </span>
                  <span style={{ fontSize: 12, color: "#cbd5e1", border: "1px solid rgba(51,65,85,.85)", background: "rgba(2,6,23,.45)", borderRadius: 999, padding: "7px 14px" }}>Scan: a minute or two</span>
                  <span style={{ fontSize: 12, color: "#cbd5e1", border: "1px solid rgba(51,65,85,.85)", background: "rgba(2,6,23,.45)", borderRadius: 999, padding: "7px 14px" }}>Reports: under thirty</span>
                  <span style={{ fontSize: 12, color: "#cbd5e1", border: "1px solid rgba(51,65,85,.85)", background: "rgba(2,6,23,.45)", borderRadius: 999, padding: "7px 14px" }}>Re-scanned weekly, not once</span>
                </div>
              </div>

              <div
                style={{
                  position: "relative",
                  justifySelf: "end",
                  width: "100%",
                  maxWidth: 340,
                  border: "1px solid rgba(37,99,235,.3)",
                  borderRadius: 20,
                  background: "linear-gradient(168deg,rgba(23,37,84,.55),rgba(4,9,22,.9) 68%)",
                  padding: 24,
                  boxShadow: "0 30px 70px -40px rgba(2,6,23,.95)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, paddingBottom: 18, borderBottom: "1px solid rgba(30,41,59,.85)" }}>
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>Your estimate</span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}>
                      <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-.04em", lineHeight: 1, color: "#93c5fd" }}>{hubNum}</span>
                      <span style={{ fontSize: 13, color: "#475569" }}>/ 100</span>
                    </div>
                    <span style={{ fontSize: 11, color: "#475569" }}>From seven questions</span>
                  </div>
                  <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#60a5fa", border: "1px solid rgba(37,99,235,.34)", background: "rgba(37,99,235,.12)", borderRadius: 999, padding: "4px 9px", whiteSpace: "nowrap" }}>
                    Illustrative
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, paddingTop: 18 }}>
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#93c5fd" }}>Your actual number</span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}>
                      <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-.04em", lineHeight: 1, background: "linear-gradient(120deg,#93c5fd,#c4b5fd 50%,#a5f3fc)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>••</span>
                      <span style={{ fontSize: 13, color: "#475569" }}>/ 100</span>
                    </div>
                    <span style={{ fontSize: 11, color: "#64748b" }}>From your tenant, all six pillars</span>
                  </div>
                  <span style={{ width: 26, height: 26, borderRadius: 8, border: "1px solid rgba(51,65,85,.9)", background: "rgba(2,6,23,.6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                </div>
                <div style={{ display: "flex", gap: 5, marginTop: 20 }}>
                  {["#3B82F6", "#8B5CF6", "#D1D5DB", "#14B8A6", "#F97316", "#22C55E"].map((c) => (
                    <span key={c} style={{ flex: 1, height: 4, borderRadius: 2, background: c }} />
                  ))}
                </div>
              </div>
            </div>

            <AssessmentFlow fee={fee} productSlug={service?.slug ?? null} includes={assessmentIncludes} />
          </div>
        </section>

        <p style={{ maxWidth: 1160, margin: "0 auto", padding: "0 clamp(16px,4vw,32px) 40px", fontSize: 12, color: "#475569" }}>
          Figures shown on this page are aggregate and illustrative. They describe patterns across comparable tenants and are not a measurement of your environment.
        </p>
      </div>
      <Footer />
    </>
  );
}

const ADOPTION_STEPS = [
  {
    title: "Pilot cohort setup",
    cadence: "Week 1",
    desc: "A representative group chosen with you, instrumented so usage is measurable from day one.",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#FB923C" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    title: "Change communications",
    cadence: "Week 2",
    desc: "Plain-language messages for the people who will use it, not a policy memo.",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#FB923C" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    title: "Daily prompt drip",
    cadence: "Daily",
    desc: "One short, role-relevant prompt a day, delivered where people already work.",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#FB923C" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
      </svg>
    ),
  },
  {
    title: "Live enablement sessions",
    cadence: "Ongoing",
    desc: "Working sessions against your own content, not a generic demo tenant.",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#FB923C" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h20v12H2z" />
        <path d="M12 15v6" />
        <path d="M8 21h8" />
        <path d="m7 11 3-3 2 2 4-4" />
      </svg>
    ),
  },
];

const ADOPTION_TIERS = [
  { name: "Essential", featured: false, dots: 1, features: ["Pilot cohort setup", "Change communication templates", "30-day prompt drip"] },
  { name: "Growth", featured: true, dots: 2, features: ["Everything in Essential", "Two live enablement sessions", "Role-specific prompt packs"] },
  { name: "Enterprise", featured: false, dots: 3, features: ["Everything in Growth", "Department-by-department rollout", "Manager briefings", "Quarterly reviews"] },
];
