import { useEffect, useState } from "react";
import { Button } from "./dsComponents";
import { PILLARS } from "./quizData";
import { RadarChart } from "./RadarChart";
import { useConsentScopes } from "@/hooks/useConsentScopes";

/**
 * Illustrative walkthrough of what starting the Copilot Readiness Assessment
 * looks like: Details -> Consent -> Payment -> Verify -> Password -> MFA.
 *
 * This is a pure client-side demo — local component state only, exactly as
 * the source Claude Design mockup implements it (no fetch/axios anywhere in
 * its script). It never calls a real API, never charges a card, never
 * requests real Microsoft consent, and never creates an account. The actual
 * checkout/consent/account flow lives elsewhere (Checkout.tsx) and is
 * explicitly out of scope for this page.
 */

const STEP_LABELS = ["Details", "Consent", "Payment", "Verify", "Password", "MFA"];

const INCLUDES = [
  "Read-only Graph scan of all six pillars",
  "Whole tenant, no seat tiers or sampling",
  "Eight reports, generated in under thirty minutes",
  "Your Copilot Gate status and blast radius",
  "Evidence behind every finding, not just scores",
  "Remediation sequence, phase by phase",
];

const SCAN_FALLBACK = [62, 48, 57, 71, 39, 66];
const SCAN_FINDINGS: [string, string][] = [
  ["14 sites with no owner", "Guest access on 6 sites"],
  ["3 Conditional Access exclusions", "Legacy auth still reachable"],
  ["41 sensitive files unlabelled", "No DLP policy on Teams"],
  ["22 dormant Copilot seats", "4 duplicate assignments"],
  ["68% have never prompted", "No role-specific enablement"],
  ["9 config changes in 24h", "2 unreviewed OAuth consents"],
];

interface FlowForm {
  first?: string;
  last?: string;
  company?: string;
  email?: string;
  card?: string;
  exp?: string;
  cvc?: string;
  code?: string;
  pass?: string;
  pass2?: string;
  mfa?: string;
}

function fieldStyle(): React.CSSProperties {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "13px 15px",
    borderRadius: 10,
    border: "1px solid rgba(51,65,85,.9)",
    background: "rgba(2,6,23,.6)",
    color: "#f1f5f9",
    fontFamily: "inherit",
    fontSize: 15,
    outline: "none",
  };
}

function labelStyle(): React.CSSProperties {
  return { display: "block", fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: "#64748b", marginBottom: 7 };
}

export function AssessmentFlow({ fee }: { fee: string }) {
  const [flowStep, setFlowStep] = useState(0);
  const [form, setForm] = useState<FlowForm>({});
  const [scanIdx, setScanIdx] = useState<number | undefined>(undefined);
  const { scopes, loading: scopesLoading } = useConsentScopes();

  const setField = (key: keyof FlowForm, value: string) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (flowStep < 3) return;
    if (scanIdx !== undefined && scanIdx > 6) return;
    if (scanIdx === undefined) {
      setScanIdx(0);
      return;
    }
    const t = setTimeout(() => setScanIdx((idx) => (idx === undefined ? 0 : idx + 1)), 950);
    return () => clearTimeout(t);
  }, [flowStep, scanIdx]);

  const next = () => setFlowStep((fs) => fs + 1);
  const back = () => setFlowStep((fs) => Math.max(0, fs - 1));
  const restartFlow = () => {
    setFlowStep(0);
    setScanIdx(undefined);
    setForm((f) => ({ ...f, code: "", mfa: "" }));
  };

  const f = form;
  const fs = flowStep;

  const detailsInvalid = !(f.first && f.last && f.company && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email || ""));
  const payInvalid = !((f.card || "").replace(/\D/g, "").length === 16 && (f.exp || "").replace(/\D/g, "").length === 4 && (f.cvc || "").length >= 3);
  const codeInvalid = (f.code || "").length !== 6;
  const passInvalid = !((f.pass || "").length >= 12 && f.pass === f.pass2);
  const mfaInvalid = (f.mfa || "").length !== 6;

  const pl = (f.pass || "").length;
  const pw =
    pl === 0
      ? { width: "0%", color: "#334155", label: "Twelve characters minimum" }
      : pl < 12
        ? { width: `${Math.round((pl / 12) * 60)}%`, color: "#F97316", label: "Too short" }
        : pl < 16
          ? { width: "72%", color: "#3B82F6", label: "Good" }
          : { width: "100%", color: "#22C55E", label: "Strong" };

  const idx = scanIdx === undefined ? -1 : scanIdx;
  const elapsed = Math.max(1, Math.min(6, Math.max(0, idx))) * 4;
  const scanValues = PILLARS.map((_, i) => (idx > i + 1 ? 1 : idx === i + 1 ? 0.42 : 0.06));
  const scanScores = PILLARS.map((_, i) => SCAN_FALLBACK[i]);
  const scanChips: { text: string; color: string }[] = [];
  for (let i = 0; i < 6; i++) {
    if (idx > i + 1) SCAN_FINDINGS[i].forEach((text) => scanChips.push({ text, color: PILLARS[i].color }));
  }
  const findingCount = Math.min(6, Math.max(0, idx)) * 2;
  const scanHubNum = idx > 6 ? String(Math.round(scanScores.reduce((a, b) => a + b, 0) / 6)) : `${Math.min(6, Math.max(0, idx))}/6`;
  const scanHubShort = idx > 6 ? "Gate score" : "Scanning";
  const scanFindingCount = idx <= 0 ? "reading tenant…" : `${findingCount} so far`;
  const scanHeadline = idx <= 0 ? "Scan starting…" : idx > 6 ? "Scan complete — generating reports" : `Scanning ${PILLARS[Math.min(5, idx - 1)].name.toLowerCase()}`;
  const scanMeta = idx <= 0 ? "graph.microsoft.com · connected" : idx > 6 ? `6 of 6 pillars · ${elapsed}s` : `${Math.min(6, idx)} of 6 pillars · ${elapsed}s`;

  return (
    <div style={{ position: "relative", marginTop: "clamp(30px,5vw,44px)", border: "1px solid rgba(30,41,59,.9)", borderRadius: 20, background: "rgba(2,6,23,.42)", padding: "clamp(22px,4vw,34px)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 22px", marginBottom: 34 }}>
        {STEP_LABELS.map((label, i) => {
          const ring = i === fs ? "#3B82F6" : i < fs ? "rgba(37,99,235,.5)" : "rgba(51,65,85,.9)";
          const fill = i === fs ? "#3B82F6" : i < fs ? "rgba(37,99,235,.14)" : "transparent";
          const numColor = i === fs ? "#f8fafc" : i < fs ? "#93c5fd" : "#475569";
          const color = i === fs ? "#f1f5f9" : i < fs ? "#93c5fd" : "#475569";
          return (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", border: `1px solid ${ring}`, background: fill, color: numColor, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {i < fs ? "✓" : String(i + 1)}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color }}>{label}</span>
            </span>
          );
        })}
      </div>

      {fs === 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,270px),1fr))", gap: "clamp(26px,4vw,44px)", alignItems: "start" }}>
          <div>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#60a5fa" }}>One flat fee</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, margin: "14px 0 10px" }}>
              <span style={{ fontSize: "clamp(38px,9vw,52px)", fontWeight: 800, letterSpacing: "-.04em", lineHeight: 1, color: "#f8fafc" }}>{fee}</span>
              <span style={{ fontSize: 15, color: "#64748b" }}>every tenant, every size</span>
            </div>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: "#94a3b8", margin: "0 0 30px", maxWidth: 480 }}>
              Not priced per seat and not scoped by headcount. A hundred users or twenty thousand, the scan covers the whole tenant and all eight reports are the same price.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,170px),1fr))", gap: 14, maxWidth: 520 }}>
              <label>
                <span style={labelStyle()}>First name</span>
                <input value={f.first || ""} onChange={(e) => setField("first", e.target.value)} placeholder="First name" style={fieldStyle()} />
              </label>
              <label>
                <span style={labelStyle()}>Last name</span>
                <input value={f.last || ""} onChange={(e) => setField("last", e.target.value)} placeholder="Last name" style={fieldStyle()} />
              </label>
              <label style={{ gridColumn: "1/-1" }}>
                <span style={labelStyle()}>Company</span>
                <input value={f.company || ""} onChange={(e) => setField("company", e.target.value)} placeholder="Company name" style={fieldStyle()} />
              </label>
              <label style={{ gridColumn: "1/-1" }}>
                <span style={labelStyle()}>Work email</span>
                <input type="email" value={f.email || ""} onChange={(e) => setField("email", e.target.value)} placeholder="you@yourcompany.com" style={fieldStyle()} />
              </label>
            </div>
            <div style={{ marginTop: 22 }}>
              <Button size="lg" onClick={next} disabled={detailsInvalid}>
                Continue to Consent
              </Button>
            </div>
            <p style={{ fontSize: 12, lineHeight: 1.55, color: "#475569", margin: "18px 0 0", maxWidth: 520 }}>Nothing is charged at this step. Consent comes next, payment after that.</p>
          </div>

          <div style={{ border: "1px solid rgba(30,41,59,.9)", borderRadius: 16, background: "rgba(2,6,23,.5)", padding: 24 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>Included</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "14px 0 4px" }}>
              <span style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-.035em", color: "#f8fafc", lineHeight: 1 }}>{fee}</span>
              <span style={{ fontSize: 13, color: "#475569" }}>flat fee</span>
            </div>
            <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 20px" }}>Your whole tenant, scanned in full — no sampling, no seat tiers.</p>
            <div style={{ display: "grid", gap: 11 }}>
              {INCLUDES.map((item) => (
                <span key={item} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5, lineHeight: 1.45, color: "#cbd5e1" }}>
                  <CheckIcon color="#60a5fa" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {fs === 1 && (
        <div style={{ maxWidth: 620 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#60a5fa" }}>Step 2 — Microsoft consent</span>
          <h3 style={{ fontSize: "clamp(21px,3.7vw,26px)", fontWeight: 700, letterSpacing: "-.018em", color: "#f8fafc", margin: "14px 0 10px", lineHeight: 1.22 }}>
            Grant read-only access to your tenant.
          </h3>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: "#94a3b8", margin: "0 0 26px", maxWidth: 520 }}>
            This opens the Microsoft admin consent screen. An account with Global Administrator or Privileged Role Administrator can approve it. The scan reads; it never writes, never moves a file, and never changes a policy.
          </p>
          <div style={{ border: "1px solid rgba(30,41,59,.9)", borderRadius: 14, background: "rgba(2,6,23,.5)", padding: "20px 22px", marginBottom: 26 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#64748b" }}>Scopes requested</span>
            {scopes.length > 0 ? (
              <div style={{ display: "grid", gap: 9, marginTop: 14 }}>
                {scopes.map((scope) => (
                  <span key={scope} style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "Menlo,ui-monospace,monospace", fontSize: 12.5, color: "#cbd5e1" }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#60a5fa", flexShrink: 0 }} />
                    {scope}
                  </span>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 12.5, color: "#475569", margin: "14px 0 0" }}>
                {scopesLoading ? "Loading requested scopes…" : "Scope list is temporarily unavailable."}
              </p>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <Button size="lg" onClick={next}>
              Grant Consent in Microsoft 365
            </Button>
            <BackLink onClick={back} />
          </div>
          <p style={{ fontSize: 12, lineHeight: 1.55, color: "#475569", margin: "18px 0 0", maxWidth: 520 }}>
            Consent is revocable at any time from Entra ID → Enterprise applications. Revoking it stops all future scans immediately.
          </p>
        </div>
      )}

      {fs === 2 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,250px),1fr))", gap: "clamp(26px,4vw,44px)", alignItems: "start" }}>
          <div>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#60a5fa" }}>Step 3 — Payment</span>
            <h3 style={{ fontSize: "clamp(21px,3.7vw,26px)", fontWeight: 700, letterSpacing: "-.018em", color: "#f8fafc", margin: "14px 0 10px", lineHeight: 1.22 }}>
              One charge of {fee}.
            </h3>
            <p style={{ fontSize: 15, lineHeight: 1.65, color: "#94a3b8", margin: "0 0 26px", maxWidth: 520 }}>
              Consent granted. Card is charged once, today — there is no subscription on the assessment and no hourly billing after it.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,170px),1fr))", gap: 14, maxWidth: 480 }}>
              <label style={{ gridColumn: "1/-1" }}>
                <span style={labelStyle()}>Card number</span>
                <input
                  value={f.card || ""}
                  onChange={(e) => setField("card", e.target.value.replace(/\D/g, "").slice(0, 16).replace(/(.{4})(?=.)/g, "$1 "))}
                  inputMode="numeric"
                  autoComplete="cc-number"
                  maxLength={19}
                  placeholder="4242 4242 4242 4242"
                  style={{ ...fieldStyle(), fontFamily: "Menlo,ui-monospace,monospace", letterSpacing: ".06em" }}
                />
              </label>
              <label>
                <span style={labelStyle()}>Expiry</span>
                <input
                  value={f.exp || ""}
                  onChange={(e) => {
                    const d = e.target.value.replace(/\D/g, "").slice(0, 4);
                    let out = d;
                    if (d.length === 1 && +d > 1) out = "0" + d;
                    if (d.length >= 2) {
                      const mm = Math.min(12, Math.max(1, parseInt(d.slice(0, 2), 10) || 1));
                      out = String(mm).padStart(2, "0") + (d.length > 2 ? " / " + d.slice(2) : "");
                    }
                    setField("exp", out);
                  }}
                  inputMode="numeric"
                  autoComplete="cc-exp"
                  maxLength={7}
                  placeholder="MM / YY"
                  style={{ ...fieldStyle(), fontFamily: "Menlo,ui-monospace,monospace" }}
                />
              </label>
              <label>
                <span style={labelStyle()}>CVC</span>
                <input
                  value={f.cvc || ""}
                  onChange={(e) => setField("cvc", e.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="123"
                  style={{ ...fieldStyle(), fontFamily: "Menlo,ui-monospace,monospace" }}
                />
              </label>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 22 }}>
              <Button size="lg" onClick={next} disabled={payInvalid}>
                Pay {fee}
              </Button>
              <BackLink onClick={back} />
            </div>
            <p style={{ fontSize: 12, lineHeight: 1.55, color: "#475569", margin: "18px 0 0", maxWidth: 520 }}>Card details are handled by the payment processor; they never touch our servers.</p>
          </div>
          <div style={{ border: "1px solid rgba(30,41,59,.9)", borderRadius: 16, background: "rgba(2,6,23,.5)", padding: 22 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#64748b" }}>Order</span>
            <p style={{ fontSize: 14, lineHeight: 1.5, color: "#e2e8f0", margin: "14px 0 4px", fontWeight: 600 }}>Copilot Readiness Assessment</p>
            <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 18px" }}>{f.company || "your tenant"}</p>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", paddingTop: 16, borderTop: "1px solid rgba(30,41,59,.9)" }}>
              <span style={{ fontSize: 13, color: "#94a3b8" }}>Total due today</span>
              <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em", color: "#f8fafc" }}>{fee}</span>
            </div>
          </div>
        </div>
      )}

      {fs === 3 && (
        <div style={{ maxWidth: 620 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 26 }}>
            <StepIcon />
            <div>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#60a5fa" }}>Step 4 — Verify</span>
              <h3 style={{ fontSize: "clamp(21px,3.7vw,26px)", fontWeight: 700, letterSpacing: "-.018em", color: "#f8fafc", margin: "14px 0 10px", lineHeight: 1.22 }}>
                Thank you. The scan has already begun.
              </h3>
              <p style={{ fontSize: 15, lineHeight: 1.65, color: "#94a3b8", margin: "0 0 26px", maxWidth: 520 }}>
                Payment received, consent is live, and your tenant is being read right now — the pillar scores below are filling in as it goes. We sent a six-digit code to {f.email || "your inbox"}; enter it to claim the account your reports land in.
              </p>
            </div>
          </div>
          <label style={{ display: "block", maxWidth: "min(100%,340px)" }}>
            <span style={labelStyle()}>Six-digit code</span>
            <input
              value={f.code || ""}
              onChange={(e) => setField("code", e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              maxLength={6}
              placeholder="——————"
              style={{ ...fieldStyle(), fontFamily: "Menlo,ui-monospace,monospace", fontSize: 26, letterSpacing: ".42em", textAlign: "center", padding: "16px 15px" }}
            />
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 20 }}>
            <Button size="lg" onClick={next} disabled={codeInvalid}>
              Verify Code
            </Button>
            <button type="button" onClick={() => {}} style={{ background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 13, color: "#475569", cursor: "pointer" }}>
              Resend code
            </button>
          </div>
          <p style={{ fontSize: 12, lineHeight: 1.55, color: "#475569", margin: "18px 0 0", maxWidth: 520 }}>Codes expire after ten minutes. Check spam if it has not arrived within two.</p>
        </div>
      )}

      {fs === 4 && (
        <div style={{ maxWidth: 620 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#60a5fa" }}>Step 5 — Password</span>
          <h3 style={{ fontSize: "clamp(21px,3.7vw,26px)", fontWeight: 700, letterSpacing: "-.018em", color: "#f8fafc", margin: "14px 0 10px", lineHeight: 1.22 }}>
            Set a password for your account.
          </h3>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: "#94a3b8", margin: "0 0 26px", maxWidth: 520 }}>This is how you get back into your reports. Twelve characters minimum.</p>
          <div style={{ display: "grid", gap: 14, maxWidth: 420 }}>
            <label>
              <span style={labelStyle()}>Password</span>
              <input type="password" value={f.pass || ""} onChange={(e) => setField("pass", e.target.value)} placeholder="••••••••••••" style={fieldStyle()} />
            </label>
            <label>
              <span style={labelStyle()}>Confirm password</span>
              <input type="password" value={f.pass2 || ""} onChange={(e) => setField("pass2", e.target.value)} placeholder="••••••••••••" style={fieldStyle()} />
            </label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
            <span style={{ flex: 1, maxWidth: 200, height: 4, borderRadius: 2, background: "rgba(30,41,59,.9)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: pw.width, background: pw.color, borderRadius: 2, transition: "width .3s,background .3s" }} />
            </span>
            <span style={{ fontSize: 12, color: "#64748b" }}>{pw.label}</span>
          </div>
          <div style={{ marginTop: 24 }}>
            <Button size="lg" onClick={next} disabled={passInvalid}>
              Continue to MFA
            </Button>
          </div>
        </div>
      )}

      {fs === 5 && (
        <div style={{ maxWidth: 640 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#60a5fa" }}>Step 6 — Multi-factor</span>
          <h3 style={{ fontSize: "clamp(21px,3.7vw,26px)", fontWeight: 700, letterSpacing: "-.018em", color: "#f8fafc", margin: "14px 0 10px", lineHeight: 1.22 }}>
            Add multi-factor authentication.
          </h3>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: "#94a3b8", margin: "0 0 26px", maxWidth: 520 }}>
            Required, not optional — these reports name every exposure in your tenant. Scan the code in Microsoft Authenticator, then enter the six digits it shows.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "clamp(18px,4vw,26px)", alignItems: "center" }}>
            <div style={{ width: 132, height: 132, borderRadius: 12, border: "1px solid rgba(51,65,85,.9)", background: "rgba(2,6,23,.6)", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 14, boxSizing: "border-box" }}>
              <span style={{ fontSize: 11, lineHeight: 1.5, letterSpacing: ".1em", textTransform: "uppercase", color: "#475569" }}>Authenticator QR</span>
            </div>
            <div>
              <span style={labelStyle()}>Or enter this key manually</span>
              <p style={{ fontFamily: "Menlo,ui-monospace,monospace", fontSize: 14, letterSpacing: ".14em", color: "#cbd5e1", margin: "0 0 18px" }}>JBSW Y3DP EHPK 3PXP</p>
              <label style={{ display: "block", maxWidth: 300 }}>
                <span style={labelStyle()}>Code from the app</span>
                <input
                  value={f.mfa || ""}
                  onChange={(e) => setField("mfa", e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="——————"
                  style={{ ...fieldStyle(), fontFamily: "Menlo,ui-monospace,monospace", fontSize: 22, letterSpacing: ".36em", textAlign: "center" }}
                />
              </label>
            </div>
          </div>
          <div style={{ marginTop: 26 }}>
            <Button size="lg" onClick={next} disabled={mfaInvalid}>
              Finish and Open Portal
            </Button>
          </div>
        </div>
      )}

      {fs >= 3 && (
        <div style={{ marginTop: "clamp(24px,4vw,34px)", paddingTop: 24, borderTop: "1px solid rgba(30,41,59,.9)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#60a5fa", boxShadow: "0 0 10px #60a5fa", animation: "smcBreath 1.4s ease-in-out infinite", flexShrink: 0 }} />
              <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#93c5fd" }}>{scanHeadline}</span>
            </div>
            <span style={{ fontFamily: "Menlo,ui-monospace,monospace", fontSize: 10.5, color: "#475569" }}>{scanMeta}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "clamp(16px,3vw,26px)", alignItems: "center" }}>
            <div style={{ position: "relative", width: "clamp(116px,17vw,148px)", aspectRatio: "1/1", flexShrink: 0 }}>
              <RadarChart idPrefix="scan" values={scanValues} trackOnly />
              <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                <span style={{ fontSize: "clamp(15px,2.4vw,19px)", fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1, color: "#f8fafc" }}>{scanHubNum}</span>
                <span style={{ fontSize: "clamp(9.5px,1.4vw,10.5px)", fontWeight: 600, letterSpacing: ".13em", textTransform: "uppercase", color: "#94a3b8", textShadow: "0 1px 6px rgba(2,6,23,.9)" }}>{scanHubShort}</span>
              </div>
            </div>
            <div style={{ flex: "1 1 260px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#64748b" }}>Findings</span>
                <span style={{ fontSize: 11, color: "#475569" }}>{scanFindingCount}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {scanChips.map((chip, i) => (
                  <span key={i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, lineHeight: 1.25, color: "#cbd5e1", border: "1px solid rgba(51,65,85,.85)", background: "rgba(2,6,23,.5)", borderRadius: 999, padding: "5px 11px" }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: chip.color, flexShrink: 0 }} />
                    {chip.text}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {fs >= 6 && (
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start", maxWidth: 640, marginTop: "clamp(24px,4vw,34px)", paddingTop: 24, borderTop: "1px solid rgba(30,41,59,.9)" }}>
          <StepIcon />
          <div>
            <h3 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-.018em", color: "#f8fafc", margin: "0 0 10px" }}>
              You are set up, {f.first || "there"}. Taking you to the portal.
            </h3>
            <p style={{ fontSize: 15, lineHeight: 1.65, color: "#94a3b8", margin: "0 0 20px" }}>
              The scan is already running against {f.company || "your tenant"}. Your eight reports appear in the portal as they generate — the first within a few minutes.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 22 }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(96,165,250,.3)", borderTopColor: "#60a5fa", animation: "smcSpin .9s linear infinite" }} />
              <span style={{ fontSize: 13, color: "#64748b" }}>Redirecting to portal.shanemccaw.com</span>
            </div>
            <button type="button" onClick={restartFlow} style={{ background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 13, color: "#475569", cursor: "pointer" }}>
              Start the flow over
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function StepIcon() {
  return (
    <span style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 12, background: "rgba(37,99,235,.14)", border: "1px solid rgba(37,99,235,.32)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 13, color: "#475569", cursor: "pointer" }}>
      Back
    </button>
  );
}
