import { useMemo, type CSSProperties } from "react";
import { Sparkles } from "lucide-react";
import {
  DELIVERABLES,
  PERSONA_TAKE,
  READINESS,
  SOURCES,
  fillTokens,
  type IndustryDef,
  type Persona,
  type PillarDef,
  type PillarId,
  type ProblemDef,
} from "./roomData";
import {
  buildCard,
  buildMessage,
  classify,
  pillarPosture,
  siteTagStyle,
  type RoomMessage,
} from "./roomModel";
import { MessageRow, TypingRow, HostHead, HOST_AVATAR, HOST_BUBBLE } from "./RoomTranscript";
import { plainChip } from "./DiscoveryCard";
import type { RoomActions, RoomState } from "./useRoomState";

interface PillarSectionProps {
  p: PillarDef;
  index: number;
  state: RoomState;
  actions: RoomActions;
  ind: IndustryDef;
  roster: Persona[];
  problem: ProblemDef;
  focus: PillarId;
  voiceAlly: string;
  voiceLine: string;
  fee: string;
  /** The headline price on the close card: the catalog price, or a neutral label until it resolves. */
  feeDisplay: string;
  /** False while `/api/services` has not returned a usable price for this row. */
  feeResolved: boolean;
  /** Once a pillar's findings are unveiled they stay unveiled — see useRoomState. */
  opened: React.MutableRefObject<Record<string, boolean>>;
  /** Match card (health pillar) */
  score: number;
  verdict: string;
  /** Close card (copilot pillar) */
  bookHref: string;
  closeLine: string;
}

export function PillarSection(props: PillarSectionProps) {
  const {
    p,
    index,
    state,
    actions,
    ind,
    roster,
    problem,
    focus,
    voiceAlly,
    voiceLine,
    fee,
    feeDisplay,
    feeResolved,
    opened,
    score,
    verdict,
    bookHref,
    closeLine,
  } = props;

  const isFocus = p.id === focus;
  const fill = (s: string) => fillTokens(s, ind, fee);

  const view = useMemo(() => {
    const checks = state.checks;
    const posture = pillarPosture(p.id, checks);
    const qs = READINESS[p.id] ?? [];

    /* ---------- the veiled narrative ---------- */
    const messages: RoomMessage[] = [];
    const mySaid = state.said[p.id];
    if (!mySaid && (isFocus || index === 0)) {
      messages.push(buildMessage("you", state.problemText || problem.said, roster));
    }
    if (mySaid) {
      const aimed = {
        sprawl:
          "So the fear is reach, not the model. That is the right fear — and it is the one this pillar answers with a permission map rather than an opinion.",
        waste:
          "You framed that as a cost question, so I will answer it as one: reach drives licence value. A tenant that returns wrong answers wastes every seat you assign.",
        adoption:
          "Then reach matters to you because of trust. People stop asking once the answers are wrong, and wrong answers almost always start as a permissions problem.",
        evidence:
          "You want it evidenced, not asserted. Everything from here comes with the tenant setting behind it, so this section is written for your file.",
        signoff:
          "That is a sign-off problem, so this pillar has to produce something an assessor accepts: ranked, evidenced, finite.",
      }[classify(mySaid)];
      if (aimed) messages.push(buildMessage("shane", aimed, roster));
    }
    if (posture) {
      const react = {
        weak: `Right — that answer tells me more than a scan would. Your exposure sits squarely in ${p.title.toLowerCase()}, so treat the rest of this section as your section.`,
        mixed:
          "That is the common answer, and it is the awkward one: partly covered, unevenly enforced. Copilot does not care about intent, only about what resolves at query time.",
        strong:
          "Good. That puts you ahead of most tenants I open — which means the findings here will be narrow and specific rather than structural.",
      }[posture];
      messages.push(buildMessage("shane", react, roster));
    }
    p.lead.forEach((m) => messages.push(buildMessage(m.who, m.text, roster)));
    if (isFocus && p.focusLine) messages.push(buildMessage(p.focusLine.who, fill(p.focusLine.text), roster));
    if (p.id === "governance" && !isFocus) messages.push(buildMessage("shane", ind.tone, roster));
    (PERSONA_TAKE[p.id] ?? []).forEach((pv) => {
      const speaker = roster[pv.i % roster.length];
      if (speaker) messages.push(buildMessage(speaker.id, pv.line, roster));
    });
    if (
      !isFocus &&
      ((voiceAlly === "kira" && p.id === "security") ||
        (voiceAlly === "beth" && p.id === "compliance") ||
        (voiceAlly === "alex" && p.id === "adoption"))
    ) {
      messages.push(buildMessage("shane", voiceLine, roster));
    }

    /* ---------- what the visitor asked, and the reply ---------- */
    const convo: RoomMessage[] = [];
    (state.threads[p.id] ?? []).forEach((m) => {
      if (m.card === "exposure") {
        const speaker = roster[0]?.id ?? "shane";
        const site = { label: ind.sitesLabel, files: ind.sites[0].files };
        convo.push(
          buildMessage(
            speaker,
            `Running it now against ${site.label}, grounded exactly the way Copilot would.`,
            roster,
          ),
        );
        convo.push(
          buildCard(speaker, "sim", roster, {
            prompt: "Summarise what this site contains and who can reach it.",
            paras: [
              {
                key: "a",
                t: `${site.label} holds ${site.files} files across its default document library. The content centres on operational documentation, working drafts and project records.`,
              },
              {
                key: "b",
                t: "Access resolves to every internal account through the EEEU grant, so any of your 1,876 licensed users can retrieve this content — and so can I.",
              },
              {
                key: "c",
                t: "Everyone Except External Users granted Edit at site root. Every internal user, and every grounded Copilot answer, can read it.",
              },
            ],
            refs: [
              { key: "r1", n: "1", t: `${site.label} › Shared Documents` },
              { key: "r2", n: "2", t: `${site.label} › Working` },
              { key: "r3", n: "3", t: `${site.label} › Archive` },
            ],
            warn: "No sensitivity label on the source, so this answer carries no classification.",
          }),
        );
        convo.push(
          buildCard("shane", "sites", roster, {
            text: "Your tenant has 2,356 overshared sites. These ten came back at random from the same Graph query Copilot runs when it builds its index — so this is literally what it would see.",
            query: "GET /v1.0/sites?search=* · 10 of 2,356",
            sites: ind.sites.map((s, i) => ({
              key: `s${i}`,
              url: s.url,
              tag: s.tag,
              files: `${s.files} files`,
              tagStyle: siteTagStyle(s.tag),
            })),
            chain: [
              { key: "c1", n: "1", k: "File sits in a library", d: "No sensitivity label, inherited site permissions" },
              {
                key: "c2",
                n: "2",
                k: "Site grants EEEU",
                d: "'Everyone except external users' resolves to 1,876 accounts",
              },
              { key: "c3", n: "3", k: "Graph permission check passes", d: "Copilot honours ACLs — and this ACL says yes" },
            ],
          }),
        );
        return;
      }
      convo.push(buildMessage(m.who, m.text, roster));
    });

    /* ---------- readiness checks ---------- */
    const answeredAny = qs.some((q) => checks[q.id] !== undefined);
    const allAnswered = !qs.some((q) => checks[q.id] === undefined);
    const askedAlready = (state.threads[p.id] ?? []).some((m) => m.who === "you");
    const typing = !!state.typing[p.id];
    const showAsk = !typing && allAnswered && !askedAlready;

    const checkThread: RoomMessage[] = [];
    qs.forEach((q) => {
      const ans = checks[q.id];
      if (ans === undefined) return;
      const chosen = (q.opts.find((o) => o[1] === ans) ?? [""])[0];
      checkThread.push(buildMessage("shane", q.q, roster));
      checkThread.push(buildMessage("you", chosen, roster));
      checkThread.push(buildMessage("shane", q.back[ans], roster));
    });
    // The last reply is only lifted out of the transcript when the ask bubble will carry it.
    if (checkThread.length && showAsk) checkThread.pop();

    let lastReply: string | null = null;
    qs.forEach((q) => {
      if (checks[q.id] !== undefined) lastReply = q.back[checks[q.id]];
    });

    const live = qs.find((q) => checks[q.id] === undefined) ?? null;

    /* ---------- the veil ---------- */
    // Once opened, a pillar stays open. "Scrolled past" is measured from the
    // section's own geometry in the scroll loop — never from chapter order,
    // which is unreliable on first paint.
    if (!live || state.skipAll || state.pillarSkip[p.id] || state.scrolledPast[p.id]) {
      opened.current[p.id] = true;
    }
    const hidden = !opened.current[p.id];

    return {
      posture,
      messages,
      convo,
      checkThread,
      lastReply: lastReply as string | null,
      live,
      typing,
      showAsk,
      answeredAny,
      allAnswered,
      hidden,
      done: qs.filter((q) => checks[q.id] !== undefined).length,
      total: qs.length,
    };
    // `fill` closes over ind + fee, both in the dep list; excluding it keeps the
    // memo from busting on every render for an identical result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, index, state, roster, ind, problem, isFocus, voiceAlly, voiceLine, fee, opened]);

  const askPrompt = view.answeredAny
    ? `Real quick — ${p.prompt.replace(/^Your turn — /, "")}`
    : p.prompt;

  return (
    <section
      id={p.id}
      data-chapter={p.id}
      className="smcr-chapter"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 15,
        paddingTop: "clamp(24px,7vh,70px)",
        scrollMarginTop: 78,
      }}
    >
      {/* kicker */}
      <div data-reveal className="smcr-reveal-l" style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
        <span
          style={{
            width: 32,
            height: 32,
            flex: "0 0 32px",
            borderRadius: 11,
            background: `${p.primary}1f`,
            border: `1px solid ${p.primary}59`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 0 26px ${p.primary}${isFocus ? "4d" : "1f"}`,
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke={p.accent}
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {p.paths.map((d) => (
              <path key={d} d={d} />
            ))}
            {(p.circles ?? []).map((c) => (
              <circle key={`${c.cx}-${c.cy}`} cx={c.cx} cy={c.cy} r={c.r} />
            ))}
          </svg>
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: ".16em",
            textTransform: "uppercase",
            color: p.accent,
          }}
        >
          {`Pillar ${p.n} · ${p.title}`}
        </span>
        {isFocus ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "5px 11px",
              borderRadius: 99,
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "#04141c",
              background: p.accent,
            }}
          >
            Your blocker
          </span>
        ) : null}
      </div>

      <h2
        data-reveal
        className="smcr-reveal-l"
        style={{
          margin: 0,
          maxWidth: "32ch",
          fontSize: "clamp(22px,2.9vw,34px)",
          lineHeight: 1.12,
          fontWeight: 800,
          letterSpacing: "-.025em",
          color: "var(--smcr-text)",
          textWrap: "pretty",
        }}
      >
        {p.headline}
      </h2>

      {/* live conversation */}
      <div data-reveal className="smcr-reveal-l" style={{ display: "flex", flexDirection: "column", gap: 15 }}>
        {view.checkThread.map((m, i) => (
          <MessageRow key={`${m.key}|${i}`} m={m} />
        ))}

        {view.typing ? <TypingRow /> : null}

        {view.live && !view.typing ? (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span style={HOST_AVATAR}>SM</span>
            <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 9 }}>
              <HostHead
                tag={`Readiness check ${view.live.n}`}
                tagStyle={{
                  padding: "3px 9px",
                  borderRadius: 99,
                  fontSize: 8.5,
                  fontWeight: 800,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: p.accent,
                  background: `${p.primary}26`,
                  border: `1px solid ${p.primary}59`,
                }}
              />
              <div style={HOST_BUBBLE}>
                {view.answeredAny && view.lastReply ? (
                  <span style={{ display: "block", marginBottom: 11 }}>{view.lastReply}</span>
                ) : null}
                <span style={{ display: "block" }}>
                  {view.answeredAny
                    ? `Real quick — ${view.live.q.charAt(0).toLowerCase()}${view.live.q.slice(1)}`
                    : view.live.q}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {view.live.opts.map((o) => (
                  <button
                    key={o[0]}
                    type="button"
                    className="smcr-opt"
                    onClick={() => actions.answerCheck(p.id, view.live!.id, o[1])}
                    style={OPT_STYLE}
                  >
                    {o[0]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => actions.skipPillar(p.id)}
                className="smcr-quiet"
                style={{
                  alignSelf: "flex-start",
                  minHeight: 28,
                  padding: "0 10px",
                  borderRadius: 8,
                  fontFamily: "inherit",
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: "pointer",
                  color: "var(--smcr-faint)",
                  background: "transparent",
                  border: "1px solid rgba(148,163,184,.18)",
                }}
              >
                Skip — show me the findings
              </button>
            </div>
          </div>
        ) : null}

        {view.showAsk ? (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", paddingTop: 2 }}>
            <span style={HOST_AVATAR}>SM</span>
            <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 9 }}>
              <HostHead tag="One more thing" />
              <div style={HOST_BUBBLE}>
                {view.lastReply ? (
                  <span style={{ display: "block", marginBottom: 11 }}>{view.lastReply}</span>
                ) : null}
                <span style={{ display: "block" }}>{askPrompt}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {p.chips.map((c) => {
                  const chip = plainChip(c[0], () => actions.askPillar(p.id, c[0]));
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      className="smcr-opt"
                      onClick={chip.pick}
                      style={chip.style}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  type="text"
                  aria-label={p.placeholder}
                  placeholder={p.placeholder}
                  value={state.drafts[p.id] ?? ""}
                  onChange={(e) => actions.draft(p.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") actions.askPillar(p.id, state.drafts[p.id] ?? "");
                  }}
                  style={{
                    flex: "1 1 220px",
                    minHeight: 38,
                    padding: "0 12px",
                    borderRadius: 9,
                    fontFamily: "inherit",
                    fontSize: 12,
                    color: "var(--smcr-text)",
                    background: "rgba(10,6,24,.6)",
                    border: "1px solid rgba(103,232,249,.28)",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={() => actions.askPillar(p.id, state.drafts[p.id] ?? "")}
                  style={{
                    minHeight: 38,
                    padding: "0 15px",
                    borderRadius: 9,
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    color: "#fff",
                    background: "#0078D4",
                    border: "1px solid rgba(103,232,249,.4)",
                  }}
                >
                  Ask
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {view.convo.length ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 13,
              paddingTop: 14,
              borderTop: "1px solid var(--smcr-rule-2)",
            }}
          >
            {view.convo.map((m, i) => (
              <MessageRow key={`${m.key}|${i}`} m={m} />
            ))}
          </div>
        ) : null}
      </div>

      {p.isProfile ? (
        <MatchCard problem={problem} score={score} verdict={verdict} />
      ) : null}

      {p.isClose ? (
        <CloseCard
          feeDisplay={feeDisplay}
          feeResolved={feeResolved}
          closeLine={closeLine}
          focus={focus}
          bookHref={bookHref}
        />
      ) : null}

      {/* the beat, then the findings */}
      <div
        data-pillar-beat={p.id}
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 9,
          textAlign: "center",
          padding: "clamp(40px,9vh,80px) 0 clamp(22px,5vh,44px)",
        }}
      >
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            width: 2,
            height: "34%",
            transform: "translateX(-50%)",
            background: `linear-gradient(180deg,transparent,${p.accent}8c)`,
          }}
        />
        <span
          style={{
            position: "relative",
            width: 46,
            height: 46,
            flex: "0 0 46px",
            borderRadius: 15,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            background: `linear-gradient(135deg,${p.primary},${p.accent})`,
            boxShadow: `0 0 34px ${p.primary}99`,
            animation: "smcr-pop 620ms cubic-bezier(.34,1.56,.64,1) both",
          }}
        >
          <Sparkles width={20} height={20} />
        </span>
        <span
          style={{
            position: "relative",
            fontSize: 9.5,
            fontWeight: 800,
            letterSpacing: ".2em",
            textTransform: "uppercase",
            color: p.accent,
          }}
        >
          {view.hidden ? `Next up · Pillar ${p.n}` : "Findings assembled"}
        </span>
        <span
          style={{
            position: "relative",
            fontSize: "clamp(19px,2.6vw,28px)",
            fontWeight: 800,
            letterSpacing: "-.02em",
            color: "var(--smcr-text)",
            textWrap: "pretty",
          }}
        >
          {view.hidden ? `${p.title} — your turn` : `Your ${p.title.toLowerCase()} picture`}
        </span>
        <span
          style={{
            position: "relative",
            maxWidth: "46ch",
            fontSize: 12.5,
            lineHeight: 1.6,
            color: "var(--smcr-muted)",
            textWrap: "pretty",
          }}
        >
          {view.hidden
            ? "Answer above and this section is written against your tenant. Keep scrolling and I will use the sector defaults."
            : "Here is what the room says about it, and the signals I would pull first."}
        </span>
      </div>

      {/* Veil rather than unmount: the page height never changes, so scrolling never jumps. */}
      <div
        aria-hidden={view.hidden}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 15,
          filter: view.hidden ? "blur(14px)" : "none",
          opacity: view.hidden ? 0.07 : 1,
          pointerEvents: view.hidden ? "none" : "auto",
          userSelect: view.hidden ? "none" : "auto",
          transition:
            "filter 800ms cubic-bezier(.22,1,.36,1), opacity 800ms cubic-bezier(.22,1,.36,1)",
        }}
      >
        {view.messages.map((m, i) => (
          <MessageRow key={`${m.key}|${i}`} m={m} />
        ))}

        {p.stats?.length ? (
          <div
            data-reveal
            className="smcr-reveal-r smcr-indent"
            style={{
              padding: "15px 16px",
              borderRadius: 18,
              background: `linear-gradient(160deg,${p.primary}14, rgba(16,11,38,.72))`,
              backdropFilter: "blur(18px)",
              border: `1px solid ${p.primary}3d`,
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
                  color: p.accent,
                  background: `${p.primary}26`,
                  border: `1px solid ${p.primary}59`,
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
                {`Active card · ${p.title} signals${view.posture ? " · shaped by your answers" : ""}`}
              </span>
              <span
                style={{
                  padding: "3px 9px",
                  borderRadius: 99,
                  fontSize: 8.5,
                  fontWeight: 800,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color:
                    view.posture === "weak" ? "#F87171" : view.posture === "strong" ? "#4ADE80" : p.accent,
                  background:
                    view.posture === "weak"
                      ? "rgba(248,113,113,.14)"
                      : view.posture === "strong"
                        ? "rgba(74,222,128,.14)"
                        : `${p.primary}1f`,
                  border: `1px solid ${
                    view.posture === "weak"
                      ? "rgba(248,113,113,.36)"
                      : view.posture === "strong"
                        ? "rgba(74,222,128,.36)"
                        : `${p.primary}40`
                  }`,
                }}
              >
                {view.posture === "weak"
                  ? "High exposure"
                  : view.posture === "mixed"
                    ? "Partial cover"
                    : view.posture === "strong"
                      ? "Ahead of median"
                      : "Indicative"}
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(min(180px,100%),1fr))",
                gap: 9,
                padding: "13px 0",
              }}
            >
              {p.stats.map((s) => (
                <div
                  key={s.k}
                  style={{
                    padding: "14px 15px",
                    borderRadius: 14,
                    background: "var(--smcr-ink-solid)",
                    backdropFilter: "blur(16px)",
                    border: `1px solid ${
                      s.bad ? "rgba(248,113,113,.32)" : s.good ? "rgba(74,222,128,.32)" : `${p.primary}40`
                    }`,
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
                      color: "var(--smcr-muted)",
                    }}
                  >
                    {s.k}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--smcr-mono)",
                      fontSize: 21,
                      fontWeight: 800,
                      color: s.bad ? "#f87171" : s.good ? "#4ADE80" : p.accent,
                    }}
                  >
                    {s.v}
                  </span>
                  <span
                    style={{ fontSize: 10.5, lineHeight: 1.45, color: "var(--smcr-muted)", textWrap: "pretty" }}
                  >
                    {s.d}
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
              {(SOURCES[p.id] ?? []).map((src) => (
                <span
                  key={src}
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
                  {src}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

const OPT_STYLE: CSSProperties = {
  minHeight: 36,
  padding: "0 13px",
  borderRadius: 10,
  fontFamily: "inherit",
  fontSize: 11.5,
  fontWeight: 700,
  cursor: "pointer",
  textAlign: "left",
  color: "var(--smcr-sky)",
  background: "rgba(103,232,249,.08)",
  border: "1px solid rgba(103,232,249,.35)",
  transition: "background 180ms, border-color 180ms, color 180ms",
};

/** The indicative reading — an honest "this is not the verdict" card on the Health pillar. */
function MatchCard({ problem, score, verdict }: { problem: ProblemDef; score: number; verdict: string }) {
  const turn = `${(score / 100).toFixed(2)}turn`;
  return (
    <div
      className="smcr-indent"
      style={{
        padding: 18,
        borderRadius: 20,
        background: "linear-gradient(160deg,rgba(103,232,249,.12),rgba(10,6,24,.68))",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(103,232,249,.4)",
        boxShadow: "var(--smcr-shadow-card-lg)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: 90,
          background: "linear-gradient(90deg,transparent,rgba(125,211,252,.1),transparent)",
          animation: "smcr-shimmer 5.5s linear infinite",
        }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span className="smcr-eyebrow">Indicative reading · not the verdict</span>
        <span className="smcr-badge">Live</span>
      </div>
      <div
        style={{ position: "relative", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}
      >
        <div
          style={{
            position: "relative",
            width: 82,
            height: 82,
            flex: "0 0 82px",
            borderRadius: 99,
            background: `conic-gradient(#67e8f9 0turn ${turn},rgba(148,163,184,.16) ${turn} 1turn)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ position: "absolute", inset: 8, borderRadius: 99, background: "var(--smcr-deep)" }} />
          <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span
              style={{ fontFamily: "var(--smcr-mono)", fontSize: 21, fontWeight: 800, color: "var(--smcr-text)" }}
            >
              {score}
            </span>
            <span
              style={{
                fontSize: 7.5,
                fontWeight: 800,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: "var(--smcr-muted)",
              }}
            >
              of 100
            </span>
          </div>
        </div>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-.01em", color: "var(--smcr-text)" }}>
            {problem.name}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: problem.color,
            }}
          >
            {problem.role}
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--smcr-sky)" }}>{verdict}</span>
        </div>
      </div>
      <div
        style={{ position: "relative", fontSize: 13, lineHeight: 1.6, color: "var(--smcr-text-3)", textWrap: "pretty" }}
      >
        {problem.body}
      </div>
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 7,
          paddingTop: 13,
          borderTop: "1px solid rgba(103,232,249,.24)",
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: ".16em",
            textTransform: "uppercase",
            color: "var(--smcr-muted)",
          }}
        >
          Where the paid assessment would start
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--smcr-sky)" }}>{problem.start}</span>
      </div>
    </div>
  );
}

/**
 * The close. Price and destination both come from the live catalog (see
 * roomData's header note) — `fee` is already resolved, `bookHref` already
 * points at the real checkout for the Copilot Readiness Assessment.
 */
function CloseCard({
  feeDisplay,
  feeResolved,
  closeLine,
  focus,
  bookHref,
}: {
  feeDisplay: string;
  feeResolved: boolean;
  closeLine: string;
  focus: PillarId;
  bookHref: string;
}) {
  return (
    <div
      data-reveal
      className="smcr-reveal-r smcr-indent"
      style={{
        padding: "clamp(18px,3vw,26px)",
        borderRadius: 20,
        background:
          "linear-gradient(160deg,rgba(0,120,212,.2),rgba(139,92,246,.16) 52%,rgba(10,6,24,.74))",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(103,232,249,.42)",
        boxShadow: "var(--smcr-shadow-close)",
        display: "flex",
        flexDirection: "column",
        gap: 15,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "-40%",
          right: "-16%",
          width: "64%",
          aspectRatio: "1",
          borderRadius: 99,
          border: "1px dashed rgba(103,232,249,.16)",
          animation: "smcr-spin 60s linear infinite",
        }}
      />
      <span className="smcr-eyebrow">Copilot Readiness Assessment</span>
      <div
        style={{ position: "relative", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}
      >
        <span
          style={{
            fontFamily: "var(--smcr-mono)",
            fontSize: "clamp(36px,4.6vw,50px)",
            fontWeight: 800,
            letterSpacing: "-.03em",
            color: "var(--smcr-text)",
          }}
        >
          {feeDisplay}
        </span>
        {/* Without a resolved price the headline slot already says "Fixed fee" — don't say it twice. */}
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--smcr-muted)" }}>
          {feeResolved ? "fixed fee · one session" : "one session"}
        </span>
      </div>
      <div
        style={{ position: "relative", fontSize: 12.5, lineHeight: 1.6, color: "var(--smcr-text-3)", textWrap: "pretty" }}
      >
        {closeLine}
      </div>
      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(min(180px,100%),1fr))",
          gap: 9,
        }}
      >
        {DELIVERABLES.map((d) => (
          <div
            key={d.tag}
            style={{
              padding: "12px 13px",
              borderRadius: 13,
              background: "rgba(10,6,24,.55)",
              border: `1px solid ${d.key === focus ? "rgba(103,232,249,.45)" : "rgba(148,163,184,.14)"}`,
            }}
          >
            <div
              style={{
                fontSize: 8.5,
                fontWeight: 800,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: d.color,
              }}
            >
              {d.tag}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--smcr-text)", marginTop: 4 }}>
              {d.name}
            </div>
            <div
              style={{
                fontSize: 10.5,
                lineHeight: 1.45,
                color: "var(--smcr-muted)",
                marginTop: 4,
                textWrap: "pretty",
              }}
            >
              {d.note}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          position: "relative",
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          paddingTop: 14,
          borderTop: "1px solid rgba(103,232,249,.24)",
        }}
      >
        <a href={bookHref} className="smcr-cta smcr-cta-primary" data-track="cta">
          Book the Assessment
        </a>
        <a href="#industry" className="smcr-cta smcr-cta-outline">
          Change the brief
        </a>
      </div>
      <div
        style={{ position: "relative", fontSize: 10.5, lineHeight: 1.5, color: "var(--smcr-faint)", textWrap: "pretty" }}
      >
        One session, read-only access, credited in full against any remediation engagement. The framework is
        the one Shane McCaw wrote at NASA and the agency distributed M365-wide.
      </div>
    </div>
  );
}
