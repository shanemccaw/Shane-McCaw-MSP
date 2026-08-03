import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Sparkles } from "lucide-react";
import { SEOMeta } from "@/components/SEOMeta";
import { Footer } from "@/components/Footer";
import { useServices, resolvePublicServicePriceCents } from "@/hooks/useServices";
import "@/styles/home-room.css";

import {
  CAST,
  CHAP,
  CHAP_ORDER,
  DEFAULT_VOICE,
  FIVE_W,
  FOCUS_LABEL,
  FEE_UNRESOLVED,
  HERO_LINE,
  HERO_STATS,
  INTRO_MESSAGES,
  INDUSTRY_PRIORITY,
  PILLARS,
  READINESS,
  VOICE,
  fillTokens,
  type ChapterId,
  type Persona,
  type PillarId,
} from "./home/roomData";
import {
  TOTAL_CHECKS,
  buildMessage,
  computeScore,
  formatCents,
  getIndustry,
  getProblem,
} from "./home/roomModel";
import { RoomStage } from "./home/RoomStage";
import { SeatRail, type SeatView } from "./home/SeatRail";
import { Dossier, type FactPill, type LadderRow, type RosterRow } from "./home/Dossier";
import { DiscoveryCard } from "./home/DiscoveryCard";
import { PillarSection } from "./home/PillarSection";
import { MessageRow } from "./home/RoomTranscript";
import { useRoomState } from "./home/useRoomState";
import { useRoomChoreography, scrollToChapter, prefersReducedMotion } from "./home/useRoomChoreography";

/**
 * The catalog row this page sells. Matched by exact service name, the same
 * convention lib/assessmentZones.ts uses — the slug and the price both come from
 * `/api/services`, never from a literal in this file.
 */
const COPILOT_ASSESSMENT_NAME = "Copilot Readiness Assessment";

/** Types HERO_LINE out once, at the export's default 22ms/2chars. */
function useTypedHeroLine(): string {
  const [n, setN] = useState(() => (prefersReducedMotion() ? HERO_LINE.length : 0));

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const want = Math.floor((Date.now() - t0) / 22) * 2;
      if (want >= HERO_LINE.length) {
        setN(HERO_LINE.length);
        window.clearInterval(id);
        return;
      }
      setN(Math.max(2, want));
    }, 22);
    return () => window.clearInterval(id);
  }, []);

  return HERO_LINE.slice(0, n);
}

export default function Home() {
  const rootRef = useRef<HTMLDivElement>(null);
  const { state, actions, latches } = useRoomState();
  const { services } = useServices();
  const typed = useTypedHeroLine();

  /* ------------------------------------------------------------------ *
   * Catalog wiring — price and destination for the close card + header CTA
   * ------------------------------------------------------------------ */
  const service = useMemo(
    () => services.find((s) => s.name.trim() === COPILOT_ASSESSMENT_NAME) ?? null,
    [services],
  );
  const feeCents = service ? resolvePublicServicePriceCents(service) : null;
  const feePrice = feeCents != null && feeCents > 0 ? formatCents(feeCents) : null;
  /** Inline, mid-sentence form. */
  const fee = feePrice ?? FEE_UNRESOLVED;
  /** The close card's headline number. */
  const feeDisplay = feePrice ?? "Fixed fee";
  const bookHref = service?.slug ? `/checkout/${service.slug}` : "/assessments";

  /* ------------------------------------------------------------------ *
   * Derived room — port of the export's renderVals()
   * ------------------------------------------------------------------ */
  const ind = getIndustry(state.industry);
  const problem = getProblem(state.problem);
  const voice = VOICE[state.persona] ?? DEFAULT_VOICE;
  const focus = problem.focus;
  const chap = CHAP[state.active] ?? CHAP.hero;

  const sel = useMemo(
    () => ({
      clusters: state.clusters.length ? state.clusters : ind.clusters,
      people: state.people.length ? state.people : ind.personas.map((p) => p.name),
      useCases: state.useCases.length ? state.useCases : ind.useCases,
    }),
    [state.clusters, state.people, state.useCases, ind],
  );

  const roster: Persona[] = useMemo(() => {
    const chosen = ind.personas.filter((p) => sel.people.includes(p.name));
    const extras: Persona[] = sel.people
      .filter((n) => !ind.personas.some((p) => p.name === n))
      .map((n, i) => ({
        id: `x${i}`,
        name: n,
        short: n.split(" ")[0],
        role: "Added by you",
        initials: n.slice(0, 2).toUpperCase(),
        color: "#67E8F9",
        tile: "linear-gradient(135deg,#0078D4,#67E8F9)",
        bd: "rgba(103,232,249,.45)",
        day: "You named this one, so you know the day better than I do.",
        win: "We test Copilot against their real workload during the assessment.",
        risk: "And we check what their permissions actually reach before anyone gets a licence.",
      }));
    return chosen.concat(extras).slice(0, 3);
  }, [ind, sel.people]);

  const answeredCount = Object.keys(state.checks).length;
  const score = computeScore(state.checks);

  // How far the visitor has read. `at()` returns true for anything not in
  // CHAP_ORDER (indexOf -1), which is how the export's first dossier pills
  // ("clusters"/"people"/"usecases") show as soon as the room exists.
  const seen = CHAP_ORDER.indexOf(state.active as ChapterId);
  const at = useCallback(
    (id: string) => seen >= CHAP_ORDER.indexOf(id as ChapterId),
    [seen],
  );

  /** Pillar order is fixed once the page is laid out — re-sorting mid-scroll teleports the reader. */
  if (!latches.order.current) {
    latches.order.current = PILLARS.slice()
      .sort((a, b) => {
        if (a.id === "copilot") return 1;
        if (b.id === "copilot") return -1;
        return (a.id === focus ? -1 : 0) - (b.id === focus ? -1 : 0);
      })
      .map((p) => p.id);
  }
  const ordered = useMemo(
    () => (latches.order.current ?? []).map((id) => PILLARS.find((p) => p.id === id)!).filter(Boolean),
    // Recomputed when the latch is cleared by Reset, which also bumps state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.industryPicked, state.problem, latches.order.current],
  );

  /* ---- seats ---- */
  const seats: SeatView[] = useMemo(() => {
    const keys = ["shane"]
      .concat(at("cast") ? roster.map((c) => c.id) : [])
      .concat(at("cast") ? ["kira"] : [])
      .concat(at("industry") ? ["you"] : []);
    return keys.flatMap((k) => {
      const c = (CAST as Record<string, (typeof CAST)["shane"]>)[k] ?? roster.find((x) => x.id === k);
      if (!c) return [];
      const live = k === chap.who;
      const isYou = k === "you";
      return [
        {
          key: k,
          initials: c.initials,
          short: isYou ? "You" : c.short || c.name.split(" ")[0],
          title: c.name + (c.role ? ` — ${c.role}` : ""),
          state: live ? "Speaking" : isYou ? "Seated" : c.role,
          live,
          color: c.color,
          tile: c.tile,
          bd: c.bd,
          isYou,
        },
      ];
    });
  }, [at, roster, chap.who]);

  /* ---- dossier ---- */
  const roomVisible =
    (state.industryPicked || state.autoSkipped) &&
    CHAP_ORDER.indexOf(state.active as ChapterId) >= CHAP_ORDER.indexOf("industry");
  const roomSeated = state.confirmed.people || state.autoSkipped;

  const dossierRoster: RosterRow[] = useMemo(() => {
    if (!(roomVisible && roomSeated)) return [];
    const rows = [...roster, ...(at("cast") ? [CAST.kira] : [])];
    return rows.map((r, i) => ({
      key: r.id,
      initials: r.initials,
      name: r.name,
      role: r.role,
      color: r.color,
      tile: r.tile,
      isKira: r.id === "kira",
      index: i,
    }));
  }, [roomVisible, roomSeated, roster, at]);

  const facts: FactPill[] = useMemo(() => {
    const out: FactPill[] = [];
    const pill = (t: string, full?: string, hot = false) => out.push({ key: t, t, full: full ?? t, hot });
    if (at("clusters")) pill(state.industry, state.industry, state.industryPicked);
    if (at("people")) pill(`${sel.clusters.length} clusters`, sel.clusters.join(", "));
    if (at("usecases")) roster.forEach((r) => pill(r.short, `${r.name} — ${r.role}`));
    if (at("cast")) pill(`${sel.useCases.length} use cases`, sel.useCases.join(", "));
    if (at("governance")) pill(ind.reg.length > 22 ? `${ind.reg.slice(0, 21)}…` : ind.reg, ind.reg);
    if (at("governance")) pill(`Opens on ${FOCUS_LABEL[focus]}`);
    return out.slice(0, 6);
  }, [at, state.industry, state.industryPicked, sel, roster, ind.reg, focus]);

  const ladder: LadderRow[] = useMemo(
    () =>
      ordered.map((p) => {
        const qs = READINESS[p.id] ?? [];
        return {
          key: p.id,
          name: p.title,
          primary: p.primary,
          accent: p.accent,
          now: state.active === p.id,
          past: CHAP_ORDER.indexOf(state.active as ChapterId) > CHAP_ORDER.indexOf(p.id),
          done: qs.filter((q) => state.checks[q.id] !== undefined).length,
          total: qs.length,
          flag: state.industryPicked ? ((INDUSTRY_PRIORITY[state.industry] ?? {})[p.id] ?? null) : null,
        };
      }),
    [ordered, state.active, state.checks, state.industryPicked, state.industry],
  );

  const verdict =
    answeredCount === 0
      ? "Answer the readiness checks and this builds as you go"
      : answeredCount < TOTAL_CHECKS
        ? `Building — ${TOTAL_CHECKS - answeredCount} check${TOTAL_CHECKS - answeredCount === 1 ? "" : "s"} still to answer`
        : score < 55
          ? "Indicative: significant gaps before enablement"
          : score < 75
            ? "Indicative: promising, with known gaps"
            : "Indicative: strong footing, worth confirming";

  const dossierVerdict =
    answeredCount === 0
      ? "Not enough signal yet"
      : answeredCount < TOTAL_CHECKS
        ? `${answeredCount} of ${TOTAL_CHECKS} answered`
        : score < 55
          ? "Significant gaps"
          : score < 75
            ? "Promising, with gaps"
            : "Strong footing";

  const closeLine = `${fillTokens(problem.close, ind, fee)} Nine documents in total, and ${ind.reg} gets the version written for them.`;

  /* ------------------------------------------------------------------ *
   * Choreography
   * ------------------------------------------------------------------ */
  useRoomChoreography(rootRef, {
    onChapter: actions.setChapter,
    onScrolledPast: actions.markScrolledPast,
    onAutoSkip: actions.autoSkip,
    bookOpen: state.bookOpen,
  });

  /** Any jump link into gated content builds the room first, so no anchor is ever dead. */
  const unlockThen = useCallback(
    (id: PillarId | string) => (e: React.MouseEvent) => {
      e.preventDefault();
      actions.autoSkip();
      window.setTimeout(() => scrollToChapter(id), 90);
    },
    [actions],
  );

  const castMessages = useMemo(() => {
    const first = roster[0];
    return [
      buildMessage(
        "shane",
        "One more person before we start, and she is not optional. Kira Vance is an independent security assessor — she is the one who signs off, or does not, and I would rather she asked her questions here than in your steering committee three months from now.",
        roster,
      ),
      buildMessage(
        "kira",
        "Kira Vance. I assess security for a living, which makes me the least popular person in most of these meetings. I have no stake in you buying anything — I only care whether the tenant can survive the retrieval.",
        roster,
      ),
      buildMessage(
        "shane",
        `Now the people who actually do the work. In ${state.industry.toLowerCase()} the room usually looks like this. Copilot has built three personas from your sector — these are the people whose day actually changes, and the people the seven pillars are really about.`,
        roster,
      ),
      ...(first ? [buildMessage(first.id, `${first.win} ${first.risk}`, roster)] : []),
      buildMessage(
        "shane",
        "Three people, three Copilot wins, three readiness conditions sitting in front of them. The pillars below are just those conditions, one at a time.",
        roster,
      ),
    ];
  }, [roster, state.industry]);

  const introMessages = useMemo(
    () => INTRO_MESSAGES.map((m) => buildMessage(m.who, m.text, roster)),
    [roster],
  );

  const assembleChips = useMemo(
    () =>
      [state.industry, ...sel.clusters.slice(0, 2), ...roster.map((r) => r.short), `${sel.useCases.length} use cases`],
    [state.industry, sel, roster],
  );

  return (
    <div className="smcr-root" ref={rootRef}>
      <SEOMeta
        title="Shane McCaw Consulting | Is your tenant ready for Microsoft 365 Copilot?"
        description="Walk the seven Copilot readiness pillars with a security assessor and the people who would actually use it — then find out whether you need the paid assessment. Built on the governance framework Shane McCaw wrote for NASA."
      />

      <RoomStage />

      {/* ---------------------------------------------------------------- */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 70,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          padding: "11px clamp(14px,3vw,32px)",
          background: "rgba(16,11,38,.74)",
          backdropFilter: "blur(22px)",
          borderBottom: "1px solid var(--smcr-rule)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <a href="/" className="smcr-logo" aria-label="Shane McCaw Consulting — home">
            <span className="smcr-logo-mark" aria-hidden="true">
              SM
            </span>
            <span className="smcr-logo-txt">
              <span className="smcr-logo-name">Shane McCaw</span>
              <span className="smcr-logo-tag">Copilot Readiness</span>
            </span>
          </a>
          <span
            style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, paddingLeft: 44 }}
            aria-live="polite"
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: 99,
                flex: "0 0 5px",
                background: chap.color,
                boxShadow: `0 0 10px ${chap.color}`,
              }}
            />
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: "var(--smcr-muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {chap.label}
            </span>
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div className="smcr-navlinks" style={{ alignItems: "center", gap: 16 }}>
            <a href="#industry" className="smcr-navlink" onClick={unlockThen("industry")}>
              Discovery
            </a>
            <a href="#health" className="smcr-navlink" onClick={unlockThen("health")}>
              Your profile
            </a>
            <a href="/assessments" className="smcr-navlink">
              Assessments
            </a>
          </div>
          <a href={bookHref} className="smcr-cta smcr-cta-primary smcr-cta-nav" data-track="cta">
            Book the Assessment
          </a>
        </div>
      </header>

      <SeatRail seats={seats} />

      {/* ---------------------------------------------------------------- */}
      {/* display / justify / padding live in home-room.css so the breakpoints can reach them */}
      <div className="smcr-convo" style={{ position: "relative", zIndex: 1 }}>
        <div
          style={{
            width: "min(760px,100%)",
            display: "flex",
            flexDirection: "column",
            gap: "clamp(26px,4vh,44px)",
          }}
        >
          {/* ---------------- 01 · the room ---------------- */}
          <section
            id="hero"
            data-chapter="hero"
            data-reveal
            className="smcr-chapter smcr-reveal smcr-hero"
            style={{
              minHeight: "calc(100vh - var(--smcr-header-h))",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: "clamp(14px,2.2vh,26px)",
              padding: "clamp(24px,5vh,64px) 0",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 99,
                  background: "#67e8f9",
                  boxShadow: "0 0 12px #67e8f9",
                  animation: "smcr-pulse 2.6s ease-in-out infinite",
                }}
              />
              <span className="smcr-eyebrow">Persona workshop · room is live</span>
            </div>

            <h1
              style={{
                margin: 0,
                fontWeight: 800,
                letterSpacing: "-.03em",
                color: "var(--smcr-text)",
                textWrap: "pretty",
              }}
            >
              Meet your personas. See how Copilot changes their day.
            </h1>

            <p
              style={{ margin: 0, color: "var(--smcr-text-3)", textWrap: "pretty" }}>
              <span>{typed}</span>
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: 2,
                  height: "1.05em",
                  marginLeft: 2,
                  verticalAlign: -2,
                  background: "#67e8f9",
                  animation: "smcr-caret 1s step-end infinite",
                }}
              />
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <a
                href="#industry"
                onClick={unlockThen("industry")}
                style={{
                  minHeight: 50,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "0 22px",
                  borderRadius: 13,
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: "#fff",
                  background: "#0078D4",
                  border: "1px solid rgba(103,232,249,.4)",
                  boxShadow: "0 14px 40px rgba(0,120,212,.38)",
                }}
              >
                Meet the room
                <ArrowDown width={15} height={15} />
              </a>
              <a
                href="#copilot"
                onClick={unlockThen("copilot")}
                style={{
                  minHeight: 50,
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "0 20px",
                  borderRadius: 13,
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: "var(--smcr-sky)",
                  background: "rgba(103,232,249,.08)",
                  border: "1px solid rgba(103,232,249,.35)",
                }}
              >
                Skip to the price
              </a>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "clamp(14px,3vw,32px)",
                paddingTop: "clamp(8px,1.6vh,18px)",
                borderTop: "1px solid var(--smcr-rule)",
              }}
            >
              {HERO_STATS.map((s) => (
                <div key={s.k} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span
                    style={{
                      fontFamily: "var(--smcr-mono)",
                      fontSize: 20,
                      fontWeight: 800,
                      color: "var(--smcr-text)",
                    }}
                  >
                    {s.v}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: ".16em",
                      textTransform: "uppercase",
                      color: "var(--smcr-muted)",
                    }}
                  >
                    {s.k}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* ---------------- 02 · who is running this ---------------- */}
          <section
            id="intro"
            data-chapter="intro"
            data-reveal
            className="smcr-chapter smcr-reveal"
            style={{
              minHeight: "92vh",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 14,
              padding: "clamp(20px,6vh,60px) 0",
            }}
          >
            {introMessages.map((m, i) => (
              <MessageRow key={`${m.key}|${i}`} m={m} gen />
            ))}

            <div
              data-reveal
              className="smcr-reveal-r smcr-indent"
              style={{
                padding: 16,
                borderRadius: 18,
                background: "linear-gradient(160deg,rgba(122,86,240,.14),rgba(16,11,38,.74))",
                backdropFilter: "blur(18px)",
                border: "1px solid rgba(122,86,240,.34)",
                boxShadow: "var(--smcr-shadow-card)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  flexWrap: "wrap",
                  paddingBottom: 12,
                  borderBottom: "1px solid var(--smcr-rule)",
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    flex: "0 0 22px",
                    borderRadius: 7,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#A78BFA",
                    background: "rgba(122,86,240,.2)",
                    border: "1px solid rgba(122,86,240,.4)",
                  }}
                >
                  <Sparkles width={11} height={11} />
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "var(--smcr-text-2)",
                  }}
                >
                  Active card · Meeting summary
                </span>
                <span
                  style={{
                    padding: "3px 9px",
                    borderRadius: 99,
                    fontSize: 8.5,
                    fontWeight: 800,
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    color: "#A78BFA",
                    background: "rgba(122,86,240,.16)",
                    border: "1px solid rgba(122,86,240,.4)",
                  }}
                >
                  Generated
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(min(210px,100%),1fr))",
                  gap: 9,
                  padding: "13px 0",
                }}
              >
                {FIVE_W.map((w) => (
                  <div
                    key={w.k}
                    style={{
                      padding: "13px 14px",
                      borderRadius: 13,
                      background: "var(--smcr-ink-solid)",
                      border: "1px solid var(--smcr-rule-2)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        letterSpacing: ".16em",
                        textTransform: "uppercase",
                        color: "var(--smcr-sky)",
                      }}
                    >
                      {w.k}
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--smcr-text)" }}>{w.v}</span>
                    <span
                      style={{
                        fontSize: 10.5,
                        lineHeight: 1.5,
                        color: "var(--smcr-muted)",
                        textWrap: "pretty",
                      }}
                    >
                      {w.d}
                    </span>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  paddingTop: 11,
                  borderTop: "1px solid var(--smcr-rule)",
                }}
              >
                <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--smcr-muted)" }}>Grounded in</span>
                {["NASA M365 governance framework", "150+ tenant checks"].map((t) => (
                  <span
                    key={t}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 99,
                      fontSize: 9.5,
                      fontWeight: 700,
                      color: "var(--smcr-text-3)",
                      background: "rgba(148,163,184,.1)",
                      border: "1px solid rgba(148,163,184,.18)",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </section>

          {/* ---------------- 03 · discovery ---------------- */}
          <section
            id="industry"
            data-chapter="industry"
            data-reveal
            className="smcr-chapter smcr-reveal"
            style={{
              minHeight: "92vh",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 14,
              padding: "clamp(20px,6vh,60px) 0",
              scrollMarginTop: 80,
            }}
          >
            <DiscoveryCard state={state} actions={actions} ind={ind} roster={roster} sel={sel} />
          </section>

          {/* ---------------- assembling ---------------- */}
          <div
            data-assemble
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 18,
              padding: "clamp(56px,14vh,120px) 0 clamp(30px,7vh,60px)",
              overflow: "hidden",
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: "50%",
                top: 0,
                width: 2,
                height: "46%",
                transform: "translateX(-50%)",
                background: "linear-gradient(180deg,transparent,rgba(103,232,249,.55))",
                animation: "smcr-drop 900ms cubic-bezier(.22,1,.36,1) both",
              }}
            />
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: "50%",
                top: "46%",
                width: "min(560px,80%)",
                height: "min(560px,80%)",
                transform: "translate(-50%,-8%)",
                pointerEvents: "none",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  inset: "18%",
                  borderRadius: 99,
                  border: "1px solid rgba(103,232,249,.22)",
                  animation: "smcr-ring 2.6s cubic-bezier(.22,1,.36,1) .25s both",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  inset: "18%",
                  borderRadius: 99,
                  border: "1px solid rgba(139,92,246,.2)",
                  animation: "smcr-ring 2.6s cubic-bezier(.22,1,.36,1) .6s both",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  inset: "18%",
                  borderRadius: 99,
                  border: "1px dashed rgba(148,163,184,.16)",
                  animation: "smcr-spin 44s linear infinite",
                }}
              />
            </div>

            <div
              style={{
                position: "relative",
                width: 52,
                height: 52,
                borderRadius: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "linear-gradient(135deg,#7A56F0,#26C1C9)",
                boxShadow: "0 0 40px rgba(103,232,249,.4)",
                animation: "smcr-pop 700ms cubic-bezier(.34,1.56,.64,1) .2s both",
              }}
            >
              <Sparkles width={24} height={24} style={{ color: "#fff" }} />
            </div>

            <div
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 7,
                textAlign: "center",
                animation: "smcr-rise 700ms cubic-bezier(.22,1,.36,1) .42s both",
              }}
            >
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  color: "#67E8F9",
                }}
              >
                Assembling your room
              </span>
              <span
                style={{
                  fontSize: "clamp(19px,2.6vw,28px)",
                  fontWeight: 800,
                  letterSpacing: "-.02em",
                  color: "var(--smcr-text)",
                  textWrap: "pretty",
                }}
              >
                {`Your ${state.industry.toLowerCase()} room is ready`}
              </span>
              <span
                style={{
                  maxWidth: "46ch",
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  color: "var(--smcr-muted)",
                  textWrap: "pretty",
                }}
              >
                Three people, one assessor, and seven pillars — every finding below is now measured against
                their permissions and their workload, not a generic tenant.
              </span>
            </div>

            <div
              style={{
                position: "relative",
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: 7,
              }}
            >
              {assembleChips.map((label, i) => (
                <span
                  key={`${label}-${i}`}
                  style={{
                    padding: "5px 11px",
                    borderRadius: 99,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: ".02em",
                    color: "var(--smcr-text-3)",
                    background: "rgba(148,163,184,.09)",
                    border: "1px solid rgba(148,163,184,.2)",
                    animation: `smcr-rise 600ms cubic-bezier(.22,1,.36,1) ${(0.55 + i * 0.08).toFixed(2)}s both`,
                  }}
                >
                  {label}
                </span>
              ))}
            </div>

            <div
              aria-hidden="true"
              style={{
                position: "relative",
                width: 2,
                height: "clamp(40px,7vh,70px)",
                background: "linear-gradient(180deg,rgba(103,232,249,.55),transparent)",
                animation: "smcr-drop 900ms cubic-bezier(.22,1,.36,1) .9s both",
              }}
            />
          </div>

          {/* ---------------- 04 · your personas ---------------- */}
          <section
            id="cast"
            data-chapter="cast"
            data-reveal
            className="smcr-chapter smcr-reveal"
            style={{
              minHeight: "92vh",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 14,
              padding: "clamp(20px,6vh,60px) 0",
            }}
          >
            {castMessages.map((m, i) => (
              <MessageRow key={`${m.key}|${i}`} m={m} gen />
            ))}

            {/* Kira — the assessor who is not on the payroll */}
            <div
              data-reveal
              className="smcr-reveal-r smcr-indent"
              style={{
                padding: "16px 17px",
                borderRadius: 18,
                background: "linear-gradient(160deg,rgba(139,92,246,.16),rgba(16,11,38,.74))",
                backdropFilter: "blur(18px)",
                border: "1px solid rgba(167,139,250,.4)",
                boxShadow: "0 24px 60px rgba(10,6,24,.6)",
                display: "flex",
                flexDirection: "column",
                gap: 13,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span
                  style={{
                    position: "relative",
                    width: 42,
                    height: 42,
                    flex: "0 0 42px",
                    borderRadius: 14,
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 800,
                    color: "#f8fafc",
                    background: "linear-gradient(135deg,#5b21b6,#A78BFA)",
                    border: "1px solid rgba(167,139,250,.5)",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      background:
                        "repeating-linear-gradient(0deg,rgba(103,232,249,.16) 0 1px,transparent 1px 3px)",
                    }}
                  />
                  <span style={{ position: "relative" }}>KV</span>
                </span>
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span
                    style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-.01em", color: "var(--smcr-text)" }}
                  >
                    Kira Vance
                  </span>
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 800,
                      letterSpacing: ".12em",
                      textTransform: "uppercase",
                      color: "#A78BFA",
                    }}
                  >
                    Independent Security Assessor
                  </span>
                </div>
                <span
                  style={{
                    marginLeft: "auto",
                    padding: "4px 10px",
                    borderRadius: 99,
                    fontSize: 8.5,
                    fontWeight: 800,
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    color: "#A78BFA",
                    background: "rgba(167,139,250,.14)",
                    border: "1px solid rgba(167,139,250,.36)",
                  }}
                >
                  Not on my payroll
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(min(200px,100%),1fr))",
                  gap: 9,
                }}
              >
                {[
                  [
                    "Why she is here",
                    "To ask the questions your own security team will ask later, when the answer is more expensive.",
                  ],
                  [
                    "What she blocks on",
                    "Blast radius, MFA exceptions, report-only Conditional Access, and DLP that never sees the Copilot path.",
                  ],
                  [
                    "What wins her over",
                    "A finite, ordered, evidenced list she can watch shrink. Never an assurance.",
                  ],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span
                      style={{
                        fontSize: 8.5,
                        fontWeight: 800,
                        letterSpacing: ".14em",
                        textTransform: "uppercase",
                        color: "var(--smcr-muted)",
                      }}
                    >
                      {k}
                    </span>
                    <span
                      style={{
                        fontSize: 11.5,
                        lineHeight: 1.5,
                        color: "var(--smcr-text-3)",
                        textWrap: "pretty",
                      }}
                    >
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* the three personas */}
            <div
              className="smcr-castgrid smcr-indent"
              style={{ gap: 10 }}
            >
              {roster.map((c) => (
                <div
                  key={c.id}
                  data-reveal
                  className="smcr-reveal-r"
                  style={{
                    padding: "15px 16px",
                    borderRadius: 18,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    background: `linear-gradient(160deg,${c.color}12, rgba(16,11,38,.7))`,
                    backdropFilter: "blur(18px)",
                    border: `1px solid ${c.color}3d`,
                    boxShadow: "0 22px 60px rgba(10,6,24,.55)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        position: "relative",
                        width: 38,
                        height: 38,
                        flex: "0 0 38px",
                        borderRadius: 13,
                        overflow: "hidden",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 800,
                        color: "#f8fafc",
                        background: c.tile,
                        border: `1px solid ${c.bd}`,
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          inset: 0,
                          background:
                            "repeating-linear-gradient(0deg,rgba(103,232,249,.16) 0 1px,transparent 1px 3px)",
                        }}
                      />
                      <span style={{ position: "relative" }}>{c.initials}</span>
                    </span>
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 800,
                          letterSpacing: "-.01em",
                          color: "var(--smcr-text)",
                        }}
                      >
                        {c.name}
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          letterSpacing: ".12em",
                          textTransform: "uppercase",
                          color: c.color,
                        }}
                      >
                        {c.role}
                      </span>
                    </div>
                  </div>
                  {(
                    [
                      ["Their day", c.day, "var(--smcr-muted)", true],
                      ["What Copilot gives them", c.win, "#4ADE80", false],
                      ["What has to be true first", c.risk, "#F87171", false],
                    ] as const
                  ).map(([k, v, color, ruled]) => (
                    <div
                      key={k}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 7,
                        ...(ruled ? { paddingTop: 12, borderTop: "1px solid var(--smcr-rule)" } : null),
                      }}
                    >
                      <span
                        style={{
                          fontSize: 8.5,
                          fontWeight: 800,
                          letterSpacing: ".14em",
                          textTransform: "uppercase",
                          color,
                        }}
                      >
                        {k}
                      </span>
                      <span
                        style={{
                          fontSize: 11.5,
                          lineHeight: 1.5,
                          color: "var(--smcr-text-3)",
                          textWrap: "pretty",
                        }}
                      >
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          {/* ---------------- the seven pillars ---------------- */}
          {ordered.map((p, i) => (
            <PillarSection
              key={p.id}
              p={p}
              index={i}
              state={state}
              actions={actions}
              ind={ind}
              roster={roster}
              problem={problem}
              focus={focus}
              voiceAlly={voice.ally}
              voiceLine={voice.line}
              fee={fee}
              feeDisplay={feeDisplay}
              feeResolved={feePrice !== null}
              opened={latches.opened}
              score={score}
              verdict={verdict}
              bookHref={bookHref}
              closeLine={closeLine}
              onChangeAnswers={unlockThen("health")}
            />
          ))}
        </div>
      </div>

      <Dossier
        chapterColor={chap.color}
        captured={state.industryPicked}
        canReset={
          state.industryPicked ||
          state.clusters.length > 0 ||
          state.people.length > 0 ||
          state.useCases.length > 0 ||
          answeredCount > 0
        }
        onReset={actions.reset}
        roomVisible={roomVisible}
        roomCount={!roomVisible ? "empty" : roomSeated ? `${roster.length} seated` : "building"}
        industry={state.industry}
        roster={dossierRoster}
        hasFacts={roomVisible && !!(state.confirmed.useCases || state.autoSkipped)}
        facts={facts}
        score={score}
        verdict={dossierVerdict}
        checksLine={`${answeredCount} / ${TOTAL_CHECKS} checks answered`}
        ladder={ladder}
      />

      {/*
        The design is a self-contained scroll narrative with its own header, so it
        does not use the site <Layout>. The real Footer still ships here: it is the
        page's only route to /services, /pricing, /resources and the legal pages,
        and the home page must not be a navigation dead end. The fixed rails fade
        out over it — see the `data-chrome` rule in home-room.css.
      */}
      <div data-room-footer style={{ position: "relative", zIndex: 2 }}>
        <Footer />
      </div>
    </div>
  );
}
