import { useMemo, type CSSProperties } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { INDUSTRIES, type IndustryDef, type Persona } from "./roomData";
import { buildMessage, plural, type RoomMessage } from "./roomModel";
import { MessageRow, TypingRow, HostHead, HOST_AVATAR, HOST_BUBBLE } from "./RoomTranscript";
import type { MultiList, RoomActions, RoomState } from "./useRoomState";

export interface Selections {
  clusters: string[];
  people: string[];
  useCases: string[];
}

interface Step {
  key: string;
  q: string;
  done: boolean;
  answer: string;
  reply: string;
  chips: ChipView[];
  ph: string;
  field: string;
  send: () => void;
  note: string;
  multi?: MultiList;
  picked?: number;
  all?: string[];
}

interface ChipView {
  key: string;
  label: string;
  pick: () => void;
  hasBox: boolean;
  tick: string;
  style: CSSProperties;
  boxStyle?: CSSProperties;
  textStyle?: CSSProperties;
  locked?: boolean;
}

/** Multi-select reads as a checklist, not a set of buttons that fire on click. */
function checkChip(label: string, selected: boolean, onPick: () => void, locked = false): ChipView {
  return {
    key: label,
    label,
    pick: onPick,
    hasBox: true,
    tick: selected ? "✓" : "",
    locked,
    textStyle: { flex: 1, minWidth: 0, lineHeight: 1.35, textWrap: "pretty" },
    style: {
      minHeight: 40,
      width: "100%",
      padding: "9px 13px 9px 11px",
      borderRadius: 10,
      fontFamily: "inherit",
      fontSize: 11.5,
      fontWeight: 700,
      cursor: locked ? "not-allowed" : "pointer",
      textAlign: "left",
      display: "flex",
      alignItems: "center",
      gap: 9,
      opacity: locked ? 0.3 : 1,
      color: selected ? "#e6fbff" : "var(--smcr-text-3)",
      background: selected ? "rgba(103,232,249,.14)" : "rgba(148,163,184,.05)",
      border: `1px solid ${selected ? "rgba(103,232,249,.65)" : "rgba(148,163,184,.16)"}`,
      boxShadow: selected ? "0 0 16px rgba(103,232,249,.18)" : "none",
      transition: "background 160ms, border-color 160ms, color 160ms, opacity 160ms, box-shadow 160ms",
    },
    boxStyle: {
      width: 14,
      height: 14,
      flex: "0 0 14px",
      borderRadius: 4,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 9,
      fontWeight: 900,
      lineHeight: 1,
      color: selected ? "#04141c" : "transparent",
      background: selected ? "#67E8F9" : "transparent",
      border: `1.5px solid ${selected ? "#67E8F9" : "rgba(148,163,184,.4)"}`,
      transition: "background 160ms, border-color 160ms, color 160ms",
    },
  };
}

/** Single-select pill. */
export function plainChip(label: string, onPick: () => void, selected = false): ChipView {
  return {
    key: label,
    label,
    pick: onPick,
    hasBox: false,
    tick: "",
    style: {
      minHeight: 34,
      padding: "0 12px",
      borderRadius: 9,
      fontFamily: "inherit",
      fontSize: 11.5,
      fontWeight: 700,
      cursor: "pointer",
      textAlign: "left",
      color: selected ? "#04141c" : "var(--smcr-sky)",
      background: selected ? "#67e8f9" : "rgba(103,232,249,.08)",
      border: `1px solid ${selected ? "rgba(103,232,249,.9)" : "rgba(103,232,249,.35)"}`,
      transition: "background 180ms, border-color 180ms, color 180ms, opacity 180ms",
    },
  };
}

function Chip({ c }: { c: ChipView }) {
  return (
    <button type="button" onClick={c.pick} disabled={c.locked} className="smcr-opt" style={c.style}>
      {c.hasBox ? (
        <span style={c.boxStyle} aria-hidden="true">
          {c.tick}
        </span>
      ) : null}
      <span style={c.textStyle}>{c.label}</span>
    </button>
  );
}

interface DiscoveryCardProps {
  state: RoomState;
  actions: RoomActions;
  ind: IndustryDef;
  roster: Persona[];
  sel: Selections;
}

/**
 * ShaneBot's discovery card: four questions that shape everything downstream —
 * sector, clusters in scope, who would actually use Copilot, and what for.
 *
 * Every step is skippable. Skipping is a real answer: the sector defaults load
 * and the rest of the page is written against those instead.
 */
export function DiscoveryCard({ state, actions, ind, roster, sel }: DiscoveryCardProps) {
  const model = useMemo(() => {
    const steps: Step[] = [
      {
        key: "industry",
        q: "Mind telling me a little about you? Pick your industry, or type it in. If you would rather not, we default to space — partly because it is the interesting one, and partly because this entire platform is what I ran at NASA: the same scans, the same telemetry, the same scoring, used to deploy Copilot securely to more than 60,000 people in a mission-critical environment where being wrong was not an option.",
        done: state.industryPicked,
        answer: state.industry,
        chips: INDUSTRIES.map((i) => plainChip(i, () => actions.pickIndustry(i))),
        ph: "…or type your industry",
        field: "industry",
        send: () => actions.setField("industry", state.drafts.industry ?? ""),
        note: "No answer needed — I default to space and aerospace.",
        reply: ind.tone,
      },
      {
        key: "clusters",
        q: "Which parts of the business are actually in scope?",
        done: !!state.confirmed.clusters,
        answer: sel.clusters.join(", "),
        multi: "clusters",
        picked: state.clusters.length,
        all: ind.clusters,
        chips: ind.clusters.map((c) =>
          checkChip(c, state.clusters.includes(c), () => actions.toggle("clusters", c)),
        ),
        ph: "…or name your own cluster",
        field: "__cluster",
        send: () => actions.addFree("clusters", "__cluster"),
        note: state.clusters.length
          ? `${plural(state.clusters.length, "cluster", "clusters")} in scope. Add more, or move on.`
          : "Pick as many as apply — or skip and I will assume the standard set.",
        reply: `Good — that narrows what actually matters. Copilot lands very differently in ${sel.clusters
          .slice(0, 2)
          .join(" and ")
          .toLowerCase()} than it does across a whole tenant.`,
      },
      {
        key: "people",
        q: "Who in there would actually use Copilot?",
        done: !!state.confirmed.people,
        answer: sel.people.join(", "),
        multi: "people",
        picked: state.people.length,
        all: ind.personas.map((p) => p.name),
        chips: ind.personas.map((p) => {
          const on = state.people.includes(p.name);
          const full = state.people.length >= 3 && !on;
          return checkChip(
            `${p.name} · ${p.role}`,
            on,
            () => {
              if (!full) actions.toggle("people", p.name);
            },
            full,
          );
        }),
        ph: "…or name someone on your team",
        field: "__person",
        send: () => actions.addFree("people", "__person"),
        note: state.people.length
          ? `${plural(state.people.length, "person", "people")} of 3 seated.${state.people.length >= 3 ? " That is the room." : ""}`
          : "Pick up to three — or skip and I will seat my standard three.",
        reply: "Those are the people I will run the pillars against. Their permissions, their workload, their day.",
      },
      {
        key: "usecases",
        q: "And what would you want them using it for?",
        done: !!state.confirmed.useCases,
        answer: sel.useCases.join(", "),
        multi: "useCases",
        picked: state.useCases.length,
        all: ind.useCases,
        chips: ind.useCases.map((u) =>
          checkChip(u, state.useCases.includes(u), () => actions.toggle("useCases", u)),
        ),
        ph: "…or describe your own use case",
        field: "__uc",
        send: () => actions.addFree("useCases", "__uc"),
        note: state.useCases.length
          ? `${plural(state.useCases.length, "use case", "use cases")} on the whiteboard.`
          : "Pick the ones that matter — or skip and I will use the six that pay back fastest.",
        reply: "That decides which findings matter. A tenant can be safe for one use case and reckless for another.",
      },
    ];

    // Only steps the visitor actually confirmed ever appear in the transcript.
    const thread: RoomMessage[] = [];
    let liveIdx = -1;
    steps.forEach((s, i) => {
      if (s.done) {
        thread.push(buildMessage("shane", s.q, roster));
        thread.push(buildMessage("you", s.answer, roster));
        thread.push(buildMessage("shane", s.reply, roster));
      } else if (liveIdx < 0) {
        liveIdx = i;
      }
    });

    const live = liveIdx >= 0 ? steps[liveIdx] : null;

    // The reply to the previous answer belongs in the same bubble as the next
    // question; the final reply folds into the closing summary instead.
    let carried: string | null = null;
    const lift = (text: string) => {
      for (let i = thread.length - 1; i >= 0; i--) {
        if (thread[i].text === text) {
          thread.splice(i, 1);
          return true;
        }
      }
      return false;
    };
    if (!live && steps[steps.length - 1].done) {
      const lastReply = steps[steps.length - 1].reply;
      if (lift(lastReply)) carried = lastReply;
    }
    if (live && liveIdx > 0 && steps[liveIdx - 1].done) {
      carried = steps[liveIdx - 1].reply;
      lift(carried);
    }

    return { steps, thread, live, liveIdx, carried };
  }, [state, actions, ind, roster, sel]);

  const { thread, live, liveIdx, carried } = model;
  const typing = state.discoveryTyping;
  const showLive = !!live && !typing;
  const showDone = !live && !typing;

  const allCap = live?.multi === "people" ? Math.min(3, live.all?.length ?? 0) : (live?.all?.length ?? 0);
  const allFull = (live?.picked ?? 0) >= allCap;

  return (
    <div
      data-setup-card
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        position: "relative",
        marginLeft: 16,
        padding: "6px 0 6px 24px",
        borderLeft: "2px solid rgba(103,232,249,.28)",
      }}
    >
      {/* card header */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          paddingBottom: 14,
          marginBottom: 2,
          borderBottom: "1px solid var(--smcr-rule-2)",
        }}
      >
        <span
          style={{
            width: 24,
            height: 24,
            flex: "0 0 24px",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg,#7A56F0,#26C1C9)",
            boxShadow: "0 0 16px rgba(103,232,249,.35)",
          }}
        >
          <Sparkles width={13} height={13} style={{ color: "#fff" }} />
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".02em", color: "var(--smcr-text)" }}>
          ShaneBot
        </span>
        <span
          style={{
            padding: "3px 9px",
            borderRadius: 99,
            fontSize: 8.5,
            fontWeight: 800,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            color: "var(--smcr-sky)",
            background: "rgba(103,232,249,.12)",
            border: "1px solid rgba(103,232,249,.34)",
          }}
        >
          AI · Discovery
        </span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 99,
              background: "#4ADE80",
              boxShadow: "0 0 9px #4ADE80",
              animation: "smcr-pulse 2.4s ease-in-out infinite",
            }}
          />
          <span
            style={{
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "var(--smcr-muted)",
            }}
          >
            Live
          </span>
        </span>
      </div>

      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16 }}>
        {thread.map((m, i) => (
          <MessageRow key={`${m.key}|${i}`} m={m} />
        ))}

        {typing ? <TypingRow /> : null}

        {showLive && live ? (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span style={HOST_AVATAR}>SM</span>
            <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 9 }}>
              <HostHead tag={`${liveIdx + 1} of 4`} />

              <div style={HOST_BUBBLE}>
                {carried ? <span style={{ display: "block", marginBottom: 11 }}>{carried}</span> : null}
                <span style={{ display: "block" }}>{live.q}</span>
              </div>

              {live.multi ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: ".16em",
                      textTransform: "uppercase",
                      color: "var(--smcr-faint)",
                    }}
                  >
                    {live.multi === "people"
                      ? "Select up to 3 · then continue"
                      : "Select any that apply · then continue"}
                  </span>
                  {live.all?.length ? (
                    <button
                      type="button"
                      className="smcr-opt"
                      onClick={() =>
                        actions.selectAll(live.multi!, allFull ? [] : (live.all ?? []).slice(0, allCap))
                      }
                      style={{
                        minHeight: 24,
                        padding: "0 9px",
                        borderRadius: 7,
                        fontFamily: "inherit",
                        fontSize: 9.5,
                        fontWeight: 800,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        cursor: "pointer",
                        color: "var(--smcr-sky)",
                        background: "rgba(103,232,249,.08)",
                        border: "1px solid rgba(103,232,249,.3)",
                        transition: "background 160ms",
                      }}
                    >
                      {allFull ? "Clear all" : live.multi === "people" ? "Select 3" : "Select all"}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div
                style={
                  live.multi
                    ? {
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit,minmax(min(240px,100%),1fr))",
                        gap: 8,
                        alignItems: "stretch",
                      }
                    : { display: "flex", flexWrap: "wrap", gap: 7 }
                }
              >
                {live.chips.map((c) => (
                  <Chip key={c.key} c={c} />
                ))}
              </div>

              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  type="text"
                  aria-label={live.ph}
                  placeholder={live.ph}
                  value={state.drafts[live.field] ?? ""}
                  onChange={(e) => actions.draft(live.field, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") live.send();
                  }}
                  style={{
                    flex: "1 1 200px",
                    minHeight: 34,
                    padding: "0 11px",
                    borderRadius: 9,
                    fontFamily: "inherit",
                    fontSize: 11.5,
                    color: "var(--smcr-text)",
                    background: "rgba(10,6,24,.5)",
                    border: "1px dashed rgba(148,163,184,.3)",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={live.send}
                  className="smcr-quiet"
                  style={{
                    minHeight: 34,
                    padding: "0 13px",
                    borderRadius: 9,
                    fontFamily: "inherit",
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: "pointer",
                    color: "var(--smcr-muted)",
                    background: "transparent",
                    border: "1px solid rgba(148,163,184,.24)",
                  }}
                >
                  + Add
                </button>
              </div>

              {live.multi ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                    paddingTop: 12,
                    borderTop: "1px solid var(--smcr-rule)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => actions.confirmStep(live.multi!)}
                    style={{
                      minHeight: 38,
                      padding: "0 16px",
                      borderRadius: 10,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontFamily: "inherit",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      color: live.picked ? "#fff" : "var(--smcr-sky)",
                      background: live.picked ? "#0078D4" : "rgba(103,232,249,.08)",
                      border: `1px solid ${live.picked ? "rgba(103,232,249,.45)" : "rgba(103,232,249,.3)"}`,
                      boxShadow: live.picked ? "var(--smcr-glow-blue-sm)" : "none",
                      transition: "background 180ms, color 180ms, box-shadow 180ms",
                    }}
                  >
                    <span>{live.picked ? `Continue with ${live.picked}` : "Use the standard set"}</span>
                    <ArrowRight width={13} height={13} />
                  </button>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--smcr-faint)" }}>{live.note}</span>
                </div>
              ) : (
                <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--smcr-faint)" }}>{live.note}</span>
              )}

              <button
                type="button"
                onClick={actions.skipAll}
                className="smcr-quiet"
                style={{
                  alignSelf: "flex-start",
                  minHeight: 30,
                  padding: "0 11px",
                  borderRadius: 8,
                  fontFamily: "inherit",
                  fontSize: 10.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  color: "var(--smcr-faint)",
                  background: "transparent",
                  border: "1px solid rgba(148,163,184,.18)",
                }}
              >
                Skip all this — just show me the assessment
              </button>
            </div>
          </div>
        ) : null}

        {showDone ? (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span style={HOST_AVATAR}>SM</span>
            <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <HostHead />
              <div style={HOST_BUBBLE}>
                {carried ? <span style={{ display: "block", marginBottom: 9 }}>{carried}</span> : null}
                <span style={{ display: "block" }}>
                  {`That is everything I need. ${plural(roster.length, "person", "people")}, ${plural(
                    sel.clusters.length,
                    "cluster",
                    "clusters",
                  )}, ${plural(sel.useCases.length, "use case", "use cases")} — the seven pillars below are now written against that, not against a generic tenant.`}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
