import { AlertTriangle } from "lucide-react";
import type { RoomMessage } from "./roomModel";

/**
 * One row of the room transcript. Every visual decision (side, bubble tail,
 * rail colour, glow) is precomputed per speaker in `buildMessage` — this
 * component only places it.
 *
 * `gen` opts the row into the Copilot "generating" beat: the choreography loop
 * flips `data-gen` to `pending` when the row enters, and the CSS blurs the body
 * and glows the avatar until it resolves.
 */
export function MessageRow({ m, gen = false }: { m: RoomMessage; gen?: boolean }) {
  return (
    <div className={gen ? "smcr-gen" : undefined} style={m.row}>
      <span className="smcr-gen-avatar" style={m.avatar}>
        {m.initials}
      </span>
      <div className="smcr-gen-body" style={m.stack}>
        <div style={m.metaRow}>
          <span style={m.nameStyle}>{m.name}</span>
          {m.role ? <span style={m.roleStyle}>{m.role}</span> : null}
        </div>
        {m.kind === "text" ? <div style={m.bubble}>{m.text}</div> : null}
        {m.kind === "sim" ? <SimCard m={m} /> : null}
        {m.kind === "sites" ? <SitesCard m={m} /> : null}
      </div>
    </div>
  );
}

/** A Copilot answer rendered the way Copilot renders one: prompt, prose, numbered references, warning. */
function SimCard({ m }: { m: RoomMessage }) {
  return (
    <div
      style={{
        width: "min(600px,100%)",
        borderRadius: 16,
        overflow: "hidden",
        background: "rgba(10,18,42,.82)",
        backdropFilter: "blur(18px)",
        border: "1px solid rgba(96,165,250,.34)",
        boxShadow: "var(--smcr-shadow-card)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "11px 15px",
          borderBottom: "1px solid rgba(96,165,250,.24)",
          background: "rgba(59,130,246,.1)",
        }}
      >
        <span
          style={{
            width: 14,
            height: 14,
            flex: "0 0 14px",
            borderRadius: 99,
            background: "conic-gradient(#3B82F6,#8B5CF6,#67E8F9,#3B82F6)",
            animation: "smcr-spin 4s linear infinite",
          }}
        />
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: "var(--smcr-sky)",
          }}
        >
          Microsoft 365 Copilot · live against your tenant
        </span>
      </div>
      <div style={{ padding: "14px 15px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(148,163,184,.08)",
            border: "1px solid rgba(148,163,184,.16)",
          }}
        >
          <span
            style={{
              fontSize: 8.5,
              fontWeight: 800,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "var(--smcr-muted)",
              paddingTop: 2,
            }}
          >
            Prompt
          </span>
          <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--smcr-text-2)", textWrap: "pretty" }}>
            {m.prompt}
          </span>
        </div>
        {(m.paras ?? []).map((p) => (
          <span
            key={p.key}
            style={{ fontSize: 12.5, lineHeight: 1.62, color: "var(--smcr-text-3)", textWrap: "pretty" }}
          >
            {p.t}
          </span>
        ))}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            paddingTop: 12,
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
            }}
          >
            References
          </span>
          {(m.refs ?? []).map((r) => (
            <span key={r.key} style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span
                style={{
                  width: 15,
                  height: 15,
                  flex: "0 0 15px",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--smcr-mono)",
                  fontSize: 8,
                  fontWeight: 800,
                  color: "var(--smcr-sky)",
                  background: "rgba(96,165,250,.16)",
                  border: "1px solid rgba(96,165,250,.3)",
                }}
              >
                {r.n}
              </span>
              <span style={{ fontSize: 11.5, color: "#93c5fd", textWrap: "pretty" }}>{r.t}</span>
            </span>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 9,
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(248,113,113,.1)",
            border: "1px solid rgba(248,113,113,.3)",
          }}
        >
          <AlertTriangle
            width={14}
            height={14}
            style={{ flex: "0 0 14px", marginTop: 1, color: "var(--smcr-red)" }}
          />
          <span style={{ fontSize: 11.5, lineHeight: 1.5, color: "#fca5a5", textWrap: "pretty" }}>{m.warn}</span>
        </div>
      </div>
    </div>
  );
}

/** The Graph site sweep: ten real-looking sites, their share tag, and the three-step reach chain. */
function SitesCard({ m }: { m: RoomMessage }) {
  return (
    <div
      style={{
        width: "min(620px,100%)",
        padding: "15px 16px",
        borderRadius: 16,
        background: "rgba(16,11,38,.8)",
        backdropFilter: "blur(18px)",
        border: "1px solid rgba(96,165,250,.3)",
        boxShadow: "var(--smcr-shadow-card)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <span style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--smcr-text-3)", textWrap: "pretty" }}>
        {m.text}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 99,
            background: "#60A5FA",
            boxShadow: "0 0 8px #60A5FA",
          }}
        />
        <span
          style={{
            fontFamily: "var(--smcr-mono)",
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: ".06em",
            color: "var(--smcr-sky)",
          }}
        >
          {m.query}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {(m.sites ?? []).map((s) => (
          <div
            key={s.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              flexWrap: "wrap",
              padding: "8px 11px",
              borderRadius: 9,
              background: "rgba(10,18,42,.6)",
              border: "1px solid var(--smcr-rule)",
            }}
          >
            <span
              style={{
                flex: 1,
                minWidth: 150,
                fontFamily: "var(--smcr-mono)",
                fontSize: 10.5,
                color: "var(--smcr-text-3)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {s.url}
            </span>
            <span style={s.tagStyle}>{s.tag}</span>
            <span
              style={{
                fontFamily: "var(--smcr-mono)",
                fontSize: 10,
                color: "var(--smcr-muted)",
                whiteSpace: "nowrap",
              }}
            >
              {s.files}
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          paddingTop: 12,
          borderTop: "1px solid var(--smcr-rule-2)",
        }}
      >
        {(m.chain ?? []).map((c) => (
          <div key={c.key} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span
              style={{
                width: 17,
                height: 17,
                flex: "0 0 17px",
                borderRadius: 99,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--smcr-mono)",
                fontSize: 8.5,
                fontWeight: 800,
                color: "var(--smcr-red)",
                background: "rgba(248,113,113,.14)",
                border: "1px solid rgba(248,113,113,.32)",
              }}
            >
              {c.n}
            </span>
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--smcr-text)" }}>{c.k}</span>
              <span style={{ fontSize: 11, lineHeight: 1.45, color: "var(--smcr-muted)", textWrap: "pretty" }}>
                {c.d}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "Shane is typing" — the beat between a picked answer and the reply landing. */
export function TypingRow({ label = "Shane is typing" }: { label?: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <span
        style={{
          width: 34,
          height: 34,
          flex: "0 0 34px",
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9,
          fontWeight: 800,
          color: "#f8fafc",
          background: "linear-gradient(135deg,#0078D4,#67E8F9)",
          border: "1px solid rgba(103,232,249,.5)",
        }}
      >
        SM
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "11px 15px",
          borderRadius: "18px 18px 18px 5px",
          background: "var(--smcr-ink-bubble)",
          border: "1.5px solid rgba(103,232,249,.5)",
          boxShadow: "0 0 20px rgba(103,232,249,.22)",
        }}
      >
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--smcr-muted)" }}>{label}</span>
        <span style={{ display: "flex", gap: 4 }} aria-hidden="true">
          {[0, 0.18, 0.36].map((d) => (
            <span
              key={d}
              style={{
                width: 5,
                height: 5,
                borderRadius: 99,
                background: "#67E8F9",
                animation: `smcr-typedot 1.2s ease-in-out ${d}s infinite`,
              }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

/** The host avatar + name row that heads every live (interactive) turn. */
export function HostHead({ tag, tagStyle }: { tag?: string; tagStyle?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: "#67E8F9",
        }}
      >
        Shane McCaw
      </span>
      {tag ? (
        <span
          style={
            tagStyle ?? {
              padding: "3px 9px",
              borderRadius: 99,
              fontSize: 8.5,
              fontWeight: 800,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "var(--smcr-sky)",
              background: "rgba(103,232,249,.12)",
              border: "1px solid rgba(103,232,249,.34)",
            }
          }
        >
          {tag}
        </span>
      ) : null}
    </div>
  );
}

export const HOST_AVATAR: React.CSSProperties = {
  width: 34,
  height: 34,
  flex: "0 0 34px",
  borderRadius: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 9,
  fontWeight: 800,
  color: "#f8fafc",
  background: "linear-gradient(135deg,#0078D4,#67E8F9)",
  border: "1px solid rgba(103,232,249,.5)",
};

export const HOST_BUBBLE: React.CSSProperties = {
  padding: "15px 16px",
  fontSize: 13.5,
  lineHeight: 1.6,
  textWrap: "pretty",
  borderRadius: "18px 18px 18px 5px",
  color: "var(--smcr-text-2)",
  backdropFilter: "blur(16px)",
  background:
    "linear-gradient(115deg, rgba(59,130,246,.24), rgba(139,92,246,.22) 40%, rgba(103,232,249,.18) 76%, rgba(20,14,44,.62))",
  border: "1.5px solid rgba(103,232,249,.7)",
  borderLeft: "3px solid #67E8F9",
  boxShadow: "0 0 0 1px rgba(103,232,249,.2), 0 0 22px rgba(103,232,249,.3), 0 14px 38px rgba(10,6,24,.5)",
};
