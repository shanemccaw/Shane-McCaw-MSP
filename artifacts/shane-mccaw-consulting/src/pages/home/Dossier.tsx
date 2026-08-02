import { Building2, RotateCcw } from "lucide-react";
import { ICON_PATH, type PillarId, type PriorityFlag } from "./roomData";
import { scrollToChapter } from "./useRoomChoreography";

export interface RosterRow {
  key: string;
  initials: string;
  name: string;
  role: string;
  color: string;
  tile: string;
  isKira: boolean;
  index: number;
}

export interface LadderRow {
  key: PillarId;
  name: string;
  primary: string;
  accent: string;
  now: boolean;
  past: boolean;
  done: number;
  total: number;
  flag: PriorityFlag | null;
}

export interface FactPill {
  key: string;
  t: string;
  full: string;
  hot: boolean;
}

interface DossierProps {
  chapterColor: string;
  captured: boolean;
  canReset: boolean;
  onReset: () => void;
  roomVisible: boolean;
  roomCount: string;
  industry: string;
  roster: RosterRow[];
  hasFacts: boolean;
  facts: FactPill[];
  score: number;
  verdict: string;
  checksLine: string;
  ladder: LadderRow[];
}

/**
 * The readiness dossier — the fixed right-hand panel that fills in as the
 * visitor answers: who is in their room, the indicative score, and the seven
 * pillars with per-pillar completion and their sector's priority flags.
 *
 * Hidden below 1240px, and faded out over the site footer (see the `data-chrome`
 * rule in home-room.css) so it never floats above real navigation.
 */
export function Dossier(props: DossierProps) {
  const {
    chapterColor,
    captured,
    canReset,
    onReset,
    roomVisible,
    roomCount,
    industry,
    roster,
    hasFacts,
    facts,
    score,
    verdict,
    checksLine,
    ladder,
  } = props;

  return (
    <aside
      className="smcr-dossier"
      aria-label="Readiness dossier"
      style={{
        position: "fixed",
        right: 0,
        top: "var(--smcr-header-h)",
        bottom: 0,
        zIndex: 60,
        width: "clamp(268px,22vw,320px)",
        padding: "20px clamp(16px,1.6vw,24px) 22px 20px",
        overflow: "hidden",
        flexDirection: "column",
        minHeight: 0,
        gap: "clamp(9px,1.6vh,14px)",
        background:
          "linear-gradient(270deg,rgba(16,11,38,.74) 0%,rgba(16,11,38,.42) 64%,transparent 100%)",
        borderLeft: "1px solid rgba(148,163,184,.1)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.5,
          backgroundImage:
            "linear-gradient(rgba(148,163,184,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.05) 1px,transparent 1px)",
          backgroundSize: "26px 26px",
          maskImage: "linear-gradient(270deg,#000 40%,transparent)",
          WebkitMaskImage: "linear-gradient(270deg,#000 40%,transparent)",
        }}
      />

      {/* header */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 99,
              background: chapterColor,
              boxShadow: `0 0 10px ${chapterColor}`,
            }}
          />
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 800,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: "var(--smcr-text-2)",
            }}
          >
            Readiness dossier
          </span>
        </span>
        <span
          style={{
            padding: "3px 9px",
            borderRadius: 99,
            fontSize: 8.5,
            fontWeight: 800,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            color: captured ? "#04141c" : "var(--smcr-muted)",
            background: captured ? "#67E8F9" : "rgba(148,163,184,.12)",
            border: `1px solid ${captured ? "rgba(103,232,249,.9)" : "rgba(148,163,184,.22)"}`,
          }}
        >
          {captured ? "Captured" : "Assumed"}
        </span>
        {canReset ? (
          <button
            type="button"
            onClick={onReset}
            title="Clear my answers"
            aria-label="Clear my answers"
            className="smcr-reset"
            style={{
              width: 22,
              height: 22,
              flex: "0 0 22px",
              borderRadius: 7,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "var(--smcr-muted)",
              background: "rgba(148,163,184,.08)",
              border: "1px solid rgba(148,163,184,.2)",
              transition: "color 180ms, border-color 180ms",
            }}
          >
            <RotateCcw width={11} height={11} />
          </button>
        ) : null}
      </div>

      {/* your room */}
      <div style={{ position: "relative", flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <span
            style={{
              fontSize: 8.5,
              fontWeight: 800,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "var(--smcr-muted)",
            }}
          >
            Your room
          </span>
          <span style={{ fontSize: 8.5, fontWeight: 700, color: "var(--smcr-faint)" }}>{roomCount}</span>
        </div>

        {!roomVisible ? (
          <span style={{ fontSize: 11, lineHeight: 1.55, color: "var(--smcr-faint)", textWrap: "pretty" }}>
            Nothing here yet.
          </span>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderRadius: 10,
              background: "rgba(103,232,249,.08)",
              border: "1px solid rgba(103,232,249,.24)",
              animation: "smcr-rise 460ms cubic-bezier(.22,1,.36,1) both",
            }}
          >
            <Building2 width={12} height={12} style={{ flex: "0 0 12px", color: "#67E8F9" }} />
            <span
              style={{
                minWidth: 0,
                fontSize: 11,
                fontWeight: 700,
                color: "var(--smcr-text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {industry}
            </span>
          </div>
        )}

        {roster.map((r) => (
          <div
            key={r.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "7px 9px",
              borderRadius: 10,
              background: "var(--smcr-ink-solid)",
              border: `1px solid ${r.color}38`,
              boxShadow: r.isKira ? "0 0 20px rgba(139,92,246,.28)" : "none",
              animation: r.isKira
                ? "smcr-fly 620ms cubic-bezier(.34,1.4,.64,1) both"
                : `smcr-rise 460ms cubic-bezier(.22,1,.36,1) ${r.index * 0.09}s both`,
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
                fontSize: 7.5,
                fontWeight: 800,
                color: "#f8fafc",
                background: r.tile,
                border: `1px solid ${r.color}66`,
              }}
            >
              {r.initials}
            </span>
            <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: "var(--smcr-text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.name}
              </span>
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 800,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: r.color,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.role}
              </span>
            </span>
          </div>
        ))}

        {hasFacts ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, paddingTop: 2 }}>
            {facts.map((f) => (
              <span
                key={f.key}
                title={f.full}
                style={{
                  padding: "4px 9px",
                  borderRadius: 99,
                  fontSize: 9.5,
                  fontWeight: 700,
                  maxWidth: "100%",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: f.hot ? "#04141c" : "var(--smcr-text-3)",
                  background: f.hot ? "#67E8F9" : "rgba(148,163,184,.1)",
                  border: `1px solid ${f.hot ? "rgba(103,232,249,.9)" : "rgba(148,163,184,.2)"}`,
                }}
              >
                {f.t}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* score */}
      <div
        style={{
          position: "relative",
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: 12,
          paddingTop: 13,
          borderTop: "1px solid var(--smcr-rule-2)",
        }}
      >
        <div
          style={{
            position: "relative",
            width: 58,
            height: 58,
            flex: "0 0 58px",
            borderRadius: 99,
            background: `conic-gradient(${chapterColor} 0turn ${(score / 100).toFixed(2)}turn,rgba(148,163,184,.14) ${(score / 100).toFixed(2)}turn 1turn)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 900ms cubic-bezier(.22,1,.36,1)",
          }}
        >
          <div style={{ position: "absolute", inset: 6, borderRadius: 99, background: "var(--smcr-deep)" }} />
          <div
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              lineHeight: 1,
            }}
          >
            <span
              style={{ fontFamily: "var(--smcr-mono)", fontSize: 16, fontWeight: 800, color: "var(--smcr-text)" }}
            >
              {score}
            </span>
            <span
              style={{
                fontSize: 6,
                fontWeight: 800,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: "var(--smcr-muted)",
                marginTop: 2,
              }}
            >
              of 100
            </span>
          </div>
        </div>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <span
            style={{
              fontSize: 11,
              lineHeight: 1.35,
              fontWeight: 700,
              color: "var(--smcr-text)",
              textWrap: "pretty",
            }}
          >
            {verdict}
          </span>
          <span style={{ fontFamily: "var(--smcr-mono)", fontSize: 9, color: "var(--smcr-sky)" }}>
            {checksLine}
          </span>
        </div>
      </div>

      {/* seven pillars */}
      <nav
        aria-label="Seven readiness pillars"
        style={{
          position: "relative",
          flex: "1 1 auto",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          paddingTop: 13,
          borderTop: "1px solid var(--smcr-rule-2)",
        }}
      >
        <span
          style={{
            fontSize: 8.5,
            fontWeight: 800,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: "var(--smcr-muted)",
            marginBottom: 5,
          }}
        >
          Seven pillars
        </span>
        {ladder.map((l) => {
          const tier = l.flag?.t ?? null;
          const fc = tier === "critical" ? "#F87171" : tier === "high" ? "#FBBF24" : "#7DD3FC";
          return (
            <a
              key={l.key}
              href={`#${l.key}`}
              className="smcr-ladder-row"
              onClick={(e) => {
                e.preventDefault();
                scrollToChapter(l.key);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                minHeight: 26,
                padding: "0 8px 0 0",
                borderRadius: 6,
                textDecoration: "none",
                transition: "background 300ms",
                background: l.now ? `${l.primary}1a` : "transparent",
              }}
            >
              <span
                style={{
                  width: 3,
                  alignSelf: "stretch",
                  flex: "0 0 3px",
                  borderRadius: 99,
                  background: l.now ? l.accent : l.past ? `${l.accent}80` : "rgba(148,163,184,.18)",
                  boxShadow: l.now ? `0 0 10px ${l.accent}` : "none",
                  transition: "background 400ms, box-shadow 400ms",
                }}
              />
              <span
                className="smcr-ladder-label"
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 10.5,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: l.now ? "var(--smcr-text)" : l.past ? "var(--smcr-text-3)" : "var(--smcr-muted)",
                }}
              >
                {l.name}
              </span>
              {l.flag ? (
                <span
                  title={l.flag.why}
                  style={{
                    width: 14,
                    height: 14,
                    flex: "0 0 14px",
                    borderRadius: 4,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: fc,
                    background: `${fc}1f`,
                    border: `1px solid ${fc}4d`,
                  }}
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    dangerouslySetInnerHTML={{ __html: ICON_PATH[l.flag.i] ?? "" }}
                  />
                </span>
              ) : null}
              <span
                style={{
                  position: "relative",
                  width: 34,
                  height: 3,
                  flex: "0 0 34px",
                  borderRadius: 99,
                  background: "rgba(148,163,184,.18)",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    borderRadius: 99,
                    width: l.total ? `${Math.round((l.done / l.total) * 100)}%` : "0%",
                    background: l.accent,
                    transition: "width 600ms cubic-bezier(.22,1,.36,1)",
                  }}
                />
              </span>
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
