import { useMemo, type CSSProperties } from "react";
import { Link } from "wouter";
import { Lock, ShieldCheck, Sparkles } from "lucide-react";
import { BOOK_STEPS, CONSENT_QA, CONSENT_SCOPES, INDUSTRIES, type Persona } from "./roomData";
import { buildMessage, type RoomMessage } from "./roomModel";
import { HOST_AVATAR, HOST_BUBBLE, HostHead, MessageRow, TypingRow } from "./RoomTranscript";
import { plainChip } from "./DiscoveryCard";
import type { RoomActions, RoomState } from "./useRoomState";

/**
 * The booking conversation, nested inside the close card on the Copilot pillar.
 *
 * WHAT THIS DOES AND DELIBERATELY DOES NOT DO
 * -------------------------------------------
 * The design export ends this flow with a simulated tenant-consent grant (a
 * 2.6s timer flipping to "Consent confirmed" — its own comment calls it a stand-in
 * for the Microsoft round-trip) and a "Pay" button with no handler at all.
 *
 * Neither is shipped. This app already has the real sequence in
 * `pages/Checkout.tsx`: guest info → clickwrap → a server-side session → an
 * admin-consent URL carrying a `state` param → the Microsoft redirect → Stripe.
 * Rendering a convincing fake of that on the public home page would tell a real
 * prospect their tenant consent "came back clean" when nothing happened, and
 * would put a dead Pay button in front of a five-figure decision.
 *
 * So every piece of *content* the design specifies is here — the intake, the
 * clickwrap, the scope disclosure, the consent Q&A, the order summary — and the
 * two irreversible actions hand off to the real checkout instead of imitating it.
 * Nothing entered here is transmitted anywhere; it shapes this conversation only.
 */
export function BookingFlow({
  state,
  actions,
  roster,
  feeDisplay,
  bookHref,
}: {
  state: RoomState;
  actions: RoomActions;
  roster: Persona[];
  feeDisplay: string;
  bookHref: string;
}) {
  const model = useMemo(() => {
    // Discovery already asked for the industry — don't ask twice.
    const knownIndustry = state.industryPicked ? state.industry : "";
    const steps = BOOK_STEPS.filter((s) => !(s.key === "industry" && knownIndustry));
    const idx = Math.min(state.bkStep, steps.length);
    const step = idx < steps.length ? steps[idx] : null;

    const thread: RoomMessage[] = [];
    steps.slice(0, idx).forEach((s) => {
      const answer = state.bkData[s.key] ?? "";
      thread.push(buildMessage("shane", s.q, roster));
      thread.push(buildMessage("you", answer, roster));
      thread.push(buildMessage("shane", s.reply(answer), roster));
    });
    if (!step && state.bkTermsDone) thread.push(buildMessage("you", "Yes, I confirm", roster));
    state.bkAsks.forEach((a) => {
      thread.push(buildMessage("you", a.q, roster));
      thread.push(buildMessage("shane", a.a, roster));
    });

    return { steps, idx, step, thread, knownIndustry };
  }, [state, roster]);

  const { steps, idx, step, thread, knownIndustry } = model;
  const showField = !!step && !state.bkTyping;
  const showTerms = !step && !state.bkTermsDone && !state.bkTyping;
  const showHandoff = !step && state.bkTermsDone && !state.bkTyping;

  const progress = step
    ? `${idx + 1} / ${steps.length}`
    : state.bkTermsDone
      ? "Ready to check out"
      : "Terms";

  const summary: { k: string; v: string }[] = [
    { k: "Name", v: state.bkData.name || "—" },
    { k: "Report to", v: state.bkData.email || "—" },
    { k: "Company", v: state.bkData.company || "—" },
    { k: "Industry", v: state.bkData.industry || knownIndustry || "—" },
  ];

  return (
    <div
      id="book"
      data-chapter="book"
      className="smcr-chapter"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        marginTop: 16,
        padding: "16px 0 4px",
        borderTop: "1px solid rgba(103,232,249,.24)",
        animation: "smcr-rise 620ms cubic-bezier(.22,1,.36,1) both",
      }}
    >
      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          paddingBottom: 14,
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
        <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--smcr-text)" }}>ShaneBot</span>
        <span style={TAG_STYLE}>{`Booking · ${feeDisplay}`}</span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--smcr-mono)",
            fontSize: 9.5,
            fontWeight: 700,
            color: "var(--smcr-faint)",
          }}
        >
          {progress}
        </span>
      </div>

      {thread.map((m, i) => (
        <MessageRow key={`${m.key}|${i}`} m={m} />
      ))}

      {state.bkTyping ? <TypingRow /> : null}

      {/* ---- intake ---- */}
      {showField && step ? (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span style={HOST_AVATAR}>SM</span>
          <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 9 }}>
            <HostHead tag={`${idx + 1} of ${steps.length}`} />
            <div style={HOST_BUBBLE}>{step.q}</div>

            {step.chips ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {INDUSTRIES.map((i) => {
                  const c = plainChip(i, () => actions.bkSubmit(step, i));
                  return (
                    <button key={c.key} type="button" className="smcr-opt" onClick={c.pick} style={c.style}>
                      {c.label}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type={step.type}
                aria-label={step.ph}
                autoComplete={
                  step.key === "name" ? "name" : step.key === "email" ? "email" : "organization"
                }
                placeholder={step.ph}
                value={state.drafts.__bk ?? ""}
                onChange={(e) => actions.draft("__bk", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") actions.bkSubmit(step, state.drafts.__bk ?? "");
                }}
                style={FIELD_STYLE}
              />
              <button
                type="button"
                onClick={() => actions.bkSubmit(step, state.drafts.__bk ?? "")}
                style={SEND_STYLE}
              >
                Send
              </button>
            </div>

            {state.bkError ? (
              <span role="alert" style={{ fontSize: 11, fontWeight: 600, color: "var(--smcr-red)" }}>
                {state.bkError}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ---- clickwrap ---- */}
      {showTerms ? (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span style={HOST_AVATAR}>SM</span>
          <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 11 }}>
            <HostHead />
            <div style={HOST_BUBBLE}>
              Before we go further — the boring but important part. Have a read of the{" "}
              {/* New tab on purpose: this conversation is in-memory, so navigating away
                  in-place would throw away everything they just typed. */}
              <Link href="/terms" target="_blank" rel="noopener noreferrer" style={LINK_STYLE}>
                Terms of Service
              </Link>{" "}
              and the{" "}
              <Link href="/privacy" target="_blank" rel="noopener noreferrer" style={LINK_STYLE}>
                Privacy Policy
              </Link>
              . Nothing hidden in there, but I need your confirmation on the record.
            </div>

            <button
              type="button"
              onClick={actions.bkToggleTerms}
              aria-pressed={state.bkTermsOk}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                minHeight: 42,
                padding: "9px 13px 9px 11px",
                borderRadius: 11,
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                color: state.bkTermsOk ? "#e6fbff" : "var(--smcr-text-3)",
                background: state.bkTermsOk ? "rgba(103,232,249,.14)" : "rgba(148,163,184,.05)",
                border: `1px solid ${state.bkTermsOk ? "rgba(103,232,249,.65)" : "rgba(148,163,184,.18)"}`,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 15,
                  height: 15,
                  flex: "0 0 15px",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9.5,
                  fontWeight: 900,
                  color: state.bkTermsOk ? "#04141c" : "transparent",
                  background: state.bkTermsOk ? "#67E8F9" : "transparent",
                  border: `1.5px solid ${state.bkTermsOk ? "#67E8F9" : "rgba(148,163,184,.4)"}`,
                }}
              >
                ✓
              </span>
              <span style={{ flex: 1, minWidth: 0, textAlign: "left", lineHeight: 1.4 }}>
                I agree to the Terms of Service and Privacy Policy
              </span>
            </button>

            <button
              type="button"
              onClick={actions.bkConfirmTerms}
              disabled={!state.bkTermsOk}
              style={{
                alignSelf: "flex-start",
                minHeight: 42,
                padding: "0 18px",
                borderRadius: 11,
                fontFamily: "inherit",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: state.bkTermsOk ? "pointer" : "not-allowed",
                opacity: state.bkTermsOk ? 1 : 0.4,
                color: "#fff",
                background: "#0078D4",
                border: "1px solid rgba(103,232,249,.45)",
                boxShadow: state.bkTermsOk ? "var(--smcr-glow-blue-sm)" : "none",
              }}
            >
              Yes, I confirm
            </button>
          </div>
        </div>
      ) : null}

      {/* ---- consent disclosure, Q&A, and the hand-off ---- */}
      {showHandoff ? (
        <div data-consent-card style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span style={HOST_AVATAR}>SM</span>
          <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 11 }}>
            <HostHead />
            <div style={HOST_BUBBLE}>
              Now the part that does the work. The assessment needs read-only consent on your Microsoft 365
              tenant — that is what lets the scan see the configuration it is grading. Ask me anything about
              it here, then the secure checkout takes the consent and the payment.
            </div>

            <div
              style={{
                padding: 16,
                borderRadius: 16,
                background: "linear-gradient(160deg,rgba(0,120,212,.16),rgba(16,11,38,.78))",
                border: "1px solid rgba(103,232,249,.4)",
                boxShadow: "var(--smcr-shadow-card)",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <span
                  style={{
                    width: 22,
                    height: 22,
                    flex: "0 0 22px",
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(103,232,249,.16)",
                    border: "1px solid rgba(103,232,249,.4)",
                  }}
                >
                  <Lock width={11} height={11} style={{ color: "#67E8F9" }} />
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
                  Tenant consent · read-only
                </span>
                <span
                  style={{
                    padding: "3px 9px",
                    borderRadius: 99,
                    fontSize: 8,
                    fontWeight: 800,
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    color: "var(--smcr-muted)",
                    background: "rgba(148,163,184,.1)",
                    border: "1px solid rgba(148,163,184,.2)",
                  }}
                >
                  Granted at checkout
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {CONSENT_SCOPES.map((s) => (
                  <div key={s.scope} style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        flex: "0 0 5px",
                        borderRadius: 99,
                        background: "#67E8F9",
                      }}
                    />
                    <span
                      style={{ fontFamily: "var(--smcr-mono)", fontSize: 10.5, color: "var(--smcr-sky)" }}
                    >
                      {s.scope}
                    </span>
                    <span style={{ fontSize: 10.5, color: "var(--smcr-muted)" }}>· {s.why}</span>
                  </div>
                ))}
              </div>

              {/* order summary */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                  paddingTop: 12,
                  borderTop: "1px solid rgba(103,232,249,.24)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--smcr-text)" }}>
                    Copilot Readiness Assessment
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--smcr-mono)",
                      fontSize: 26,
                      fontWeight: 800,
                      color: "var(--smcr-text)",
                    }}
                  >
                    {feeDisplay}
                  </span>
                </div>
                {summary.map((s) => (
                  <div
                    key={s.k}
                    style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        letterSpacing: ".14em",
                        textTransform: "uppercase",
                        color: "var(--smcr-muted)",
                      }}
                    >
                      {s.k}
                    </span>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: "var(--smcr-text-2)",
                        textAlign: "right",
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {s.v}
                    </span>
                  </div>
                ))}
              </div>

              <a href={bookHref} className="smcr-cta smcr-cta-primary" data-track="cta" style={{ width: "100%" }}>
                <ShieldCheck width={15} height={15} />
                Continue to secure checkout
              </a>
              <span style={{ fontSize: 10, lineHeight: 1.5, color: "var(--smcr-faint)", textWrap: "pretty" }}>
                Consent and payment both happen there — the Microsoft consent screen is read-only and revocable
                from Entra ID at any time, and nothing is installed in your tenant. Card or invoice, credited in
                full against any remediation engagement.
              </span>
            </div>

            {/* consent Q&A */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {CONSENT_QA.slice(0, 4).map((q) => {
                const c = plainChip(q.q, () => actions.bkAsk(q.q));
                return (
                  <button key={c.key} type="button" className="smcr-opt" onClick={c.pick} style={c.style}>
                    {c.label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text"
                aria-label="Ask about the access"
                placeholder="Ask me anything about the access…"
                value={state.drafts.__bkAsk ?? ""}
                onChange={(e) => actions.draft("__bkAsk", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") actions.bkAsk(state.drafts.__bkAsk ?? "");
                }}
                style={FIELD_STYLE}
              />
              <button
                type="button"
                onClick={() => actions.bkAsk(state.drafts.__bkAsk ?? "")}
                style={{ ...SEND_STYLE, color: "var(--smcr-sky)", background: "rgba(103,232,249,.1)" }}
              >
                Ask
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const TAG_STYLE: CSSProperties = {
  padding: "3px 9px",
  borderRadius: 99,
  fontSize: 8.5,
  fontWeight: 800,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: "var(--smcr-sky)",
  background: "rgba(103,232,249,.12)",
  border: "1px solid rgba(103,232,249,.34)",
};

const FIELD_STYLE: CSSProperties = {
  flex: "1 1 240px",
  minHeight: 40,
  padding: "0 13px",
  borderRadius: 10,
  fontFamily: "inherit",
  fontSize: 12.5,
  color: "var(--smcr-text)",
  background: "rgba(10,6,24,.6)",
  border: "1px solid rgba(103,232,249,.3)",
  outline: "none",
};

const SEND_STYLE: CSSProperties = {
  minHeight: 40,
  padding: "0 17px",
  borderRadius: 10,
  fontFamily: "inherit",
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
  color: "#fff",
  background: "#0078D4",
  border: "1px solid rgba(103,232,249,.4)",
};

const LINK_STYLE: CSSProperties = { color: "var(--smcr-sky)", textDecoration: "underline" };
