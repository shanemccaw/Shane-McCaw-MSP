import { useState, useEffect, useRef } from "react";
import { useAuth, isMfaChallenge, type MfaChallenge } from "@/contexts/AuthContext";
import { useLocation, useSearch } from "wouter";
import { startAuthentication } from "@simplewebauthn/browser";
import {
  Loader2, Eye, EyeOff, Mail,
  ShieldCheck, Sparkles, ClipboardCheck, Zap, Lock, FileText,
} from "lucide-react";
import AnimatedBackground from "@/components/quickwin/AnimatedBackground";
import CopilotAura from "@/components/wizard/CopilotAura";
import ScoreRing from "@/components/ScoreRing";

// ─── Auth helpers ──────────────────────────────────────────────────────────────
function redirectAfterAuth(role: string, setLocation: (path: string) => void) {
  if (role === "client") {
    const returnTo = sessionStorage.getItem("onboardingReturnTo");
    if (returnTo) {
      sessionStorage.removeItem("onboardingReturnTo");
      setLocation(returnTo);
    } else {
      setLocation("/portal");
    }
  } else {
    setLocation("/dashboard");
  }
}

// ─── M365 Health Score Panel ───────────────────────────────────────────────────
const SCORE_CATEGORIES = [
  { label: "Compliance",  key: "compliance",   target: 88 },
  { label: "Copilot",     key: "copilot",      target: 91 },
  { label: "Governance",  key: "governance",   target: 76 },
  { label: "Adoption",    key: "productivity", target: 73 },
  { label: "Security",    key: "security",     target: 84 },
] as const;

const OVERALL_TARGET = Math.round((88 + 91 + 76 + 73 + 84) / 5);
const START_PCT = 0.20;

function ringColor(s: number) {
  return s >= 70 ? "#22c55e" : s >= 40 ? "#f59e0b" : "#ef4444";
}

function M365HealthPanel({ dark = false, vertical = false }: { dark?: boolean; vertical?: boolean }) {
  const startVals = {
    compliance:   Math.round(88 * START_PCT),
    copilot:      Math.round(91 * START_PCT),
    governance:   Math.round(76 * START_PCT),
    productivity: Math.round(73 * START_PCT),
    security:     Math.round(84 * START_PCT),
  };
  const [scores, setScores] = useState<Record<string, number>>(startVals);
  const [overall, setOverall] = useState(Math.round(OVERALL_TARGET * START_PCT));
  const startRef = useRef<number | null>(null);
  const rafRef   = useRef<number | null>(null);

  useEffect(() => {
    function tick(now: number) {
      if (startRef.current === null) startRef.current = now;
      const t    = Math.min((now - startRef.current) / 8000, 1);
      const frac = START_PCT + (1 - START_PCT) * t;
      setScores({
        compliance:   Math.round(88 * frac),
        copilot:      Math.round(91 * frac),
        governance:   Math.round(76 * frac),
        productivity: Math.round(73 * frac),
        security:     Math.round(84 * frac),
      });
      setOverall(Math.round(OVERALL_TARGET * frac));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, []);

  const r         = 30;
  const circ      = 2 * Math.PI * r;
  const oBg       = dark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.8)";
  const oBorder   = dark ? "rgba(255,255,255,0.12)" : "rgba(10,37,64,0.06)";
  const oTrack    = dark ? "rgba(255,255,255,0.10)" : "rgba(10,37,64,0.06)";
  const oDiv      = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  const titleCol  = dark ? "rgba(255,255,255,0.65)" : "rgba(10,37,64,0.6)";
  const subCol    = dark ? "rgba(255,255,255,0.35)" : "rgba(10,37,64,0.4)";
  const pctCol    = dark ? "#ffffff"                : ringColor(overall);
  const catCol    = dark ? "rgba(255,255,255,0.45)" : "rgba(10,37,64,0.45)";

  const rV = 34;
  const circV = 2 * Math.PI * rV;

  if (vertical) {
    return (
      <div
        className="w-full rounded-xl border flex flex-col items-center gap-3 p-4"
        style={{ background: oBg, backdropFilter: "blur(14px)", borderColor: oBorder }}
      >
        {/* Overall ring — centered top */}
        <div className="flex flex-col items-center gap-1">
          <div className="relative flex items-center justify-center" style={{ width: 80, height: 80 }}>
            <svg width={80} height={80} viewBox="0 0 80 80" className="-rotate-90">
              <circle cx="40" cy="40" r={rV} fill="none" stroke={oTrack} strokeWidth="8" />
              <circle
                cx="40" cy="40" r={rV} fill="none"
                stroke={ringColor(overall)} strokeWidth="8"
                strokeDasharray={circV}
                strokeDashoffset={circV - (overall / 100) * circV}
              />
            </svg>
            <span className="absolute text-sm font-bold" style={{ color: pctCol }}>{overall}%</span>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: titleCol }}>M365 Health</p>
          <p className="text-[9px]" style={{ color: subCol }}>Tenant Posture</p>
        </div>

        {/* Divider */}
        <div className="w-full h-px" style={{ background: oDiv }} />

        {/* Category rings — row of 5 */}
        <div className="flex items-end justify-around w-full gap-1">
          {SCORE_CATEGORIES.map(({ label, key }) => {
            const pct = scores[key] ?? 0;
            return (
              <div key={key} className="flex flex-col items-center gap-1">
                <ScoreRing score={pct} size={46} strokeWidth={4} dark={dark} />
                <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: catCol }}>{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-full rounded-xl border flex items-center gap-3 p-4"
      style={{ background: oBg, backdropFilter: "blur(14px)", borderColor: oBorder }}
    >
      {/* Overall ring */}
      <div
        className="flex items-center gap-3 pr-4 border-r shrink-0"
        style={{ borderColor: oDiv }}
      >
        <div className="relative flex items-center justify-center" style={{ width: 64, height: 64 }}>
          <svg width={64} height={64} viewBox="0 0 72 72" className="-rotate-90">
            <circle cx="36" cy="36" r={r} fill="none" stroke={oTrack} strokeWidth="8" />
            <circle
              cx="36" cy="36" r={r} fill="none"
              stroke={ringColor(overall)} strokeWidth="8"
              strokeDasharray={circ}
              strokeDashoffset={circ - (overall / 100) * circ}
            />
          </svg>
          <span className="absolute text-xs font-bold" style={{ color: pctCol }}>{overall}%</span>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: titleCol }}>M365 Health</p>
          <p className="text-[9px]" style={{ color: subCol }}>Tenant Posture</p>
        </div>
      </div>

      {/* Category rings */}
      <div className="flex-1 flex items-center justify-around gap-1">
        {SCORE_CATEGORIES.map(({ label, key }) => {
          const pct = scores[key] ?? 0;
          return (
            <div key={key} className="flex flex-col items-center gap-1">
              <ScoreRing score={pct} size={52} strokeWidth={4} dark={dark} />
              <span
                className="text-[9px] font-bold uppercase tracking-wider"
                style={{ color: catCol }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Activity Ticker ───────────────────────────────────────────────────────────
const TICKER_MESSAGES = [
  "✓ MFA enforced across 214 identities",
  "↑ Secure Score +7 pts this week",
  "⚡ Copilot readiness scan complete",
  "🔒 Conditional Access policies applied",
  "📋 DLP policy deployed to 3 sites",
  "🛡️ Zero Trust posture validated",
  "✦ Governance audit 88% complete",
];

function ActivityTicker({ dark = false }: { dark?: boolean }) {
  const [index, setIndex]   = useState(0);
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false);
      timerRef.current = setTimeout(() => {
        setIndex(i => (i + 1) % TICKER_MESSAGES.length);
        setVisible(true);
      }, 400);
    }, 3000);
    return () => {
      clearInterval(id);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="flex items-center gap-2 mt-2.5">
      <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] animate-pulse flex-shrink-0" />
      <div className="w-0.5 h-4 rounded-full bg-[#0078D4] flex-shrink-0" />
      <span
        className={`text-xs font-medium ${dark ? "text-white/55" : "text-[#0A2540]/55"}`}
        style={{ opacity: visible ? 1 : 0, transition: "opacity 400ms ease" }}
      >
        {TICKER_MESSAGES[index]}
      </span>
    </div>
  );
}

// ─── Floating chips (decorative, z-20) ────────────────────────────────────────
const CHIPS = [
  { icon: ShieldCheck,    label: "Security Posture", pos: "top-[18%] left-[3%]",     delay: "0s",   dur: "6s"   },
  { icon: Sparkles,       label: "Copilot Ready",    pos: "top-[22%] right-[2%]",    delay: "1.5s", dur: "7s"   },
  { icon: ClipboardCheck, label: "Compliance 88%",   pos: "bottom-[22%] left-[2%]",  delay: "3s",   dur: "8s"   },
  { icon: Zap,            label: "Automation Active",pos: "bottom-[18%] right-[2%]", delay: "4.5s", dur: "6.5s" },
] as const;

function FloatingChips() {
  return (
    <>
      {CHIPS.map(({ icon: Icon, label, pos, delay, dur }) => (
        <div
          key={label}
          className={`absolute ${pos} hidden md:flex items-center gap-1.5 pointer-events-none z-20 opacity-20`}
          style={{ animation: `chipFloat ${dur} ease-in-out infinite`, animationDelay: delay }}
        >
          <div className="flex items-center gap-1.5 bg-white/80 border border-[#0078D4]/20 backdrop-blur-sm rounded-full px-3 py-1.5">
            <Icon className="w-3 h-3 text-[#0078D4]" />
            <span className="text-[10px] font-semibold text-[#0A2540]/60">{label}</span>
          </div>
        </div>
      ))}
    </>
  );
}

// ─── Left value panel ─────────────────────────────────────────────────────────
const VALUE_BULLETS = [
  { icon: ShieldCheck,    text: "Real-time tenant health" },
  { icon: Sparkles,       text: "Copilot readiness scoring" },
  { icon: Lock,           text: "Governance & security posture" },
  { icon: ClipboardCheck, text: "Project tracking & deliverables" },
  { icon: FileText,       text: "Secure document exchange" },
  { icon: Zap,            text: "Zero Trust architecture" },
];

const SEC_BADGES = [
  { emoji: "🔒", label: "Encrypted" },
  { emoji: "🛡️", label: "MFA Protected" },
  { emoji: "⚡", label: "Zero Trust" },
  { emoji: "🏛️", label: "NASA-grade" },
];

const COMP_BADGES = ["HIPAA", "SOC 2", "FINRA", "CMMC", "ITAR"];

function LeftPanel() {
  return (
    <div
      className="hidden md:flex flex-col px-10 py-12 overflow-y-auto"
      style={{
        background: "linear-gradient(155deg, rgba(10,37,64,0.94) 0%, rgba(0,8,28,0.90) 100%)",
        backdropFilter: "blur(24px)",
      }}
    >
      {/* Wordmark */}
      <div className="flex items-center gap-2.5 mb-10 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-[#0078D4] flex items-center justify-center shadow-lg shadow-[#0078D4]/30 flex-shrink-0">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
          </svg>
        </div>
        <div>
          <p className="text-white font-bold text-sm leading-tight">Shane McCaw Consulting</p>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#0078D4" }}>
            Microsoft 365 Architecture
          </p>
        </div>
      </div>

      {/* Hero — text left, health panel right */}
      <div className="flex-1 flex items-center gap-8 min-h-0">

        {/* Left column: headline + bullets + badges */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <h1 className="font-black text-white leading-tight mb-3" style={{ fontSize: "clamp(1.75rem,3vw,2.75rem)" }}>
            Your M365<br />
            <span style={{ color: "#00B4D8" }}>Command Center</span>
          </h1>
          <p className="text-white/58 text-sm leading-relaxed mb-6 max-w-xs">
            A secure, unified portal for assessments, reports, insights, and project delivery.
          </p>

          {/* Value bullets */}
          <ul className="space-y-2.5 mb-6">
            {VALUE_BULLETS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(0,120,212,0.18)", border: "1px solid rgba(0,120,212,0.30)" }}
                >
                  <Icon className="w-3.5 h-3.5 text-[#0078D4]" />
                </div>
                <span className="text-white/72 text-sm font-medium">{text}</span>
              </li>
            ))}
          </ul>

        </div>

        {/* Right column: tenant health snapshot */}
        <div className="shrink-0 flex flex-col justify-center" style={{ width: "clamp(200px,30%,260px)" }}>
          <p
            className="text-[9px] font-bold uppercase tracking-widest mb-2"
            style={{ color: "rgba(255,255,255,0.28)" }}
          >
            Tenant Health Snapshot
          </p>
          <M365HealthPanel dark vertical />
        </div>
      </div>
    </div>
  );
}

// ─── MFA challenge screen ──────────────────────────────────────────────────────
function MfaChallengeScreen({
  challenge,
  onSuccess,
  onBack,
}: {
  challenge: MfaChallenge;
  onSuccess: (token: string, user: import("@/contexts/AuthContext").AuthUser) => void;
  onBack: () => void;
}) {
  const [activeMethod, setActiveMethod] = useState<string>(
    challenge.methods.includes("passkey") ? "passkey" : (challenge.methods[0] ?? "totp")
  );
  const [code, setCode]       = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [smsSent, setSmsSent] = useState(false);

  const sendSms = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/mfa/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaToken: challenge.mfaToken }),
      });
      if (res.ok) setSmsSent(true);
      else {
        let msg = "Failed to send SMS";
        try { const d = await res.json() as { error?: string }; if (d.error) msg = d.error; } catch { /* empty body */ }
        setError(msg);
      }
    } catch { setError("Failed to send SMS"); }
    finally { setLoading(false); }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaToken: challenge.mfaToken, method: activeMethod, code }),
      });
      if (!res.ok) {
        let msg = "Verification failed";
        try { const d = await res.json() as { error?: string }; if (d.error) msg = d.error; } catch { /* empty body */ }
        throw new Error(msg);
      }
      const data = await res.json() as { accessToken?: string; user?: import("@/contexts/AuthContext").AuthUser; error?: string };
      if (!data.accessToken || !data.user) throw new Error(data.error ?? "Verification failed");
      onSuccess(data.accessToken, data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const verifyPasskey = async () => {
    setError("");
    setLoading(true);
    try {
      const optRes = await fetch("/api/auth/mfa/passkey/authentication-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaToken: challenge.mfaToken }),
      });
      if (!optRes.ok) throw new Error("Failed to get authentication options");
      const options = await optRes.json();
      const authResp = await startAuthentication({ optionsJSON: options });
      const verRes = await fetch("/api/auth/mfa/passkey/verify-authentication", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaToken: challenge.mfaToken, ...authResp }),
      });
      const data = await verRes.json() as { accessToken?: string; user?: import("@/contexts/AuthContext").AuthUser; error?: string };
      if (!verRes.ok || !data.accessToken || !data.user) throw new Error(data.error ?? "Authentication failed");
      onSuccess(data.accessToken, data.user);
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("Passkey authentication was cancelled.");
      } else {
        setError(err instanceof Error ? err.message : "Authentication failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const methodLabel: Record<string, string> = { totp: "Authenticator App", sms: "SMS Code", passkey: "Passkey" };

  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="w-12 h-12 bg-[#0078D4]/10 border border-[#0078D4]/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-[#0078D4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-[#0A2540]">Two-Factor Verification</h2>
        <p className="text-sm text-muted-foreground mt-1">An extra step is required to sign in</p>
      </div>

      {challenge.methods.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {challenge.methods.map(m => (
            <button key={m} onClick={() => { setActiveMethod(m); setCode(""); setError(""); setSmsSent(false); }}
              className={`flex-1 text-xs font-semibold px-3 py-2 rounded-lg border transition-colors ${
                activeMethod === m ? "bg-[#0078D4] text-white border-[#0078D4]" : "border-border text-muted-foreground hover:border-[#0078D4]/40"
              }`}>
              {methodLabel[m] ?? m}
            </button>
          ))}
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2.5 rounded-xl">{error}</div>}

      {activeMethod === "passkey" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground text-center">Use your registered passkey (biometric or hardware key) to complete sign-in.</p>
          <button onClick={() => void verifyPasskey()} disabled={loading}
            className="w-full bg-[#0078D4] text-white rounded-xl px-4 py-3 text-sm font-semibold hover:bg-[#006CBE] transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            {loading ? "Waiting…" : "Authenticate with Passkey"}
          </button>
        </div>
      ) : activeMethod === "sms" && !smsSent ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground text-center">Send a 6-digit code to your registered phone number to verify your identity.</p>
          <button onClick={() => void sendSms()} disabled={loading}
            className="w-full bg-[#0078D4] text-white rounded-xl px-4 py-3 text-sm font-semibold hover:bg-[#006CBE] transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {loading ? "Sending…" : "Send SMS Code"}
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => void verifyCode(e)} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">
              {activeMethod === "totp" ? "6-digit authenticator code" : "SMS verification code"}
            </label>
            <input type="text" inputMode="numeric" maxLength={6} value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" autoFocus
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] font-mono text-center tracking-widest" />
            {activeMethod === "sms" && (
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-muted-foreground">Check your phone for the code</p>
                <button type="button" onClick={() => void sendSms()} disabled={loading}
                  className="text-xs text-[#0078D4] hover:underline disabled:opacity-50">Resend</button>
              </div>
            )}
          </div>
          <button type="submit" disabled={loading || code.length < 6}
            className="w-full bg-[#0078D4] text-white rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-[#006CBE] transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            {loading ? "Verifying…" : "Verify Code"}
          </button>
        </form>
      )}

      <button onClick={onBack} className="w-full text-xs text-muted-foreground hover:text-[#0A2540] transition-colors text-center">
        ← Back to sign in
      </button>
    </div>
  );
}

// ─── Login page ────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const { login, completeMfaLogin } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const fromPurchase = new URLSearchParams(search).get("from") === "purchase";

  const [mode, setMode]                 = useState<"login" | "forgot">("login");
  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]               = useState("");
  const [loading, setLoading]           = useState(false);
  const [forgotSent, setForgotSent]     = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null);

  const handleMfaSuccess = (accessToken: string, user: import("@/contexts/AuthContext").AuthUser) => {
    completeMfaLogin(accessToken, user);
    redirectAfterAuth(user.role, setLocation);
  };

  const switchMode = (next: "login" | "forgot") => {
    setMode(next);
    setError("");
    setPassword("");
    setMfaChallenge(null);
    if (next !== "forgot") setForgotSent(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "forgot") {
      setLoading(true);
      try {
        await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        setForgotSent(true);
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      const result = await login(email, password);
      if (isMfaChallenge(result)) {
        setMfaChallenge(result);
      } else {
        redirectAfterAuth(result.role, setLocation);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @keyframes chipFloat {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-8px); }
        }
      `}</style>

      <div className="relative w-full h-screen overflow-hidden bg-[#0A2540]">

        {/* Three.js torus knot — z-1 */}
        <AnimatedBackground fullScreen />

        {/* CopilotAura edge glow — z-10 */}
        <CopilotAura />

        {/* Decorative floating chips — z-20, desktop only */}
        <FloatingChips />

        {/* ── Page content — z-40 ───────────────────────────────────────── */}
        <div className="relative z-40 h-full flex flex-col">

          {/* ── Two-column main area ─────────────────────────────────────── */}
          <div className="flex-1 flex flex-col md:grid md:grid-cols-[55fr_45fr] min-h-0">

            {/* LEFT panel — value + trust + health (desktop only) */}
            <LeftPanel />

            {/* RIGHT panel — login form (always visible) */}
            <div className="flex flex-col items-center justify-center overflow-y-auto px-6 py-12 bg-white/[0.97]">

              {/* Mobile-only compact wordmark (left panel is hidden on mobile) */}
              <div className="md:hidden flex flex-col items-center mb-6 text-center">
                <div className="inline-flex items-center gap-2.5 mb-2">
                  <div className="w-9 h-9 rounded-xl bg-[#0078D4] flex items-center justify-center shadow-lg shadow-[#0078D4]/25 flex-shrink-0">
                    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
                    </svg>
                  </div>
                  <span className="text-[#0A2540] font-bold text-base leading-tight">Shane McCaw Consulting</span>
                </div>
                <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "#00B4D8" }}>
                  M365 Client Portal
                </span>
              </div>

              {/* Activity ticker — above the login card */}
              <div className="w-full max-w-md mb-3">
                <ActivityTicker />
              </div>

              <div className="w-full max-w-md">

                {/* Purchase context hint */}
                {fromPurchase && (
                  <div className="bg-[#0078D4]/8 border border-[#0078D4]/25 rounded-2xl px-4 py-3.5 mb-5 flex items-start gap-3">
                    <div className="w-7 h-7 rounded-lg bg-[#0078D4]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Mail className="w-3.5 h-3.5 text-[#0078D4]" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-[#0A2540] leading-snug mb-0.5">Check your email first</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        We sent a password-setup link to your inbox. Click that link to activate your account, then sign in here.
                      </p>
                    </div>
                  </div>
                )}

                {/* ── Login card ── */}
                <div className="bg-white border border-[#0A2540]/10 rounded-3xl shadow-xl px-8 py-10">

                  {/* Wordmark — desktop only (mobile has it above the card) */}
                  <div className="hidden md:flex flex-col items-center mb-7 text-center">
                    <div className="inline-flex items-center gap-2.5 mb-2">
                      <div className="w-9 h-9 rounded-xl bg-[#0078D4] flex items-center justify-center shadow-lg shadow-[#0078D4]/25 flex-shrink-0">
                        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
                        </svg>
                      </div>
                      <span className="text-[#0A2540] font-bold text-base leading-tight">Shane McCaw Consulting</span>
                    </div>
                    <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "#00B4D8" }}>
                      M365 Client Portal
                    </span>
                  </div>

                  {/* ── Auth flows ── */}
                  {mfaChallenge ? (
                    <MfaChallengeScreen
                      challenge={mfaChallenge}
                      onSuccess={handleMfaSuccess}
                      onBack={() => { setMfaChallenge(null); setPassword(""); }}
                    />

                  ) : mode === "forgot" ? (
                    <>
                      {forgotSent ? (
                        <div className="text-center py-3">
                          <div className="w-11 h-11 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                          <p className="font-bold text-[#0A2540] mb-1">Check your inbox</p>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            If an account exists for <span className="font-semibold text-[#0A2540]">{email}</span>, a reset link has been sent. It expires in 1 hour.
                          </p>
                          <button
                            type="button"
                            onClick={() => switchMode("login")}
                            className="mt-4 text-sm font-semibold text-[#0078D4] hover:underline"
                            data-testid="link-back-to-signin"
                          >
                            ← Back to sign in
                          </button>
                        </div>
                      ) : (
                        <form onSubmit={handleSubmit} aria-label="Forgot password form" className="space-y-4">
                          <div>
                            <label htmlFor="forgot-email" className="block text-xs font-semibold text-[#0A2540] mb-1.5">
                              Email address
                            </label>
                            <input
                              id="forgot-email"
                              type="email"
                              value={email}
                              onChange={e => setEmail(e.target.value)}
                              required
                              placeholder="you@organization.com"
                              autoComplete="email"
                              className="w-full border border-[#E0E6EF] rounded-xl py-2.5 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] focus:border-transparent transition-all placeholder:text-muted-foreground"
                              data-testid="input-forgot-email"
                            />
                          </div>

                          {error && (
                            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                              {error}
                            </p>
                          )}

                          <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-[#0078D4] hover:bg-[#005A9E] disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-md shadow-[#0078D4]/20 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0078D4] focus-visible:outline-none"
                            data-testid="button-send-reset"
                          >
                            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                            Send Reset Link
                          </button>

                          <button
                            type="button"
                            onClick={() => switchMode("login")}
                            className="w-full text-sm text-muted-foreground hover:text-[#0078D4] transition-colors"
                            data-testid="link-back-to-signin"
                          >
                            ← Back to sign in
                          </button>
                        </form>
                      )}
                    </>

                  ) : (
                    <form onSubmit={handleSubmit} aria-label="Sign in form" className="space-y-4">
                      <div>
                        <label htmlFor="login-email" className="block text-xs font-semibold text-[#0A2540] mb-1.5">
                          Email address
                        </label>
                        <input
                          id="login-email"
                          type="email"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          required
                          placeholder="you@organization.com"
                          autoComplete="email"
                          className="w-full border border-[#E0E6EF] rounded-xl py-2.5 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] focus:border-transparent transition-all placeholder:text-muted-foreground"
                          data-testid="input-email"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label htmlFor="login-password" className="text-xs font-semibold text-[#0A2540]">
                            Password
                          </label>
                          <button
                            type="button"
                            onClick={() => switchMode("forgot")}
                            className="text-xs font-medium text-[#0078D4] hover:underline focus-visible:ring-1 focus-visible:ring-[#0078D4] focus-visible:outline-none rounded"
                            data-testid="link-forgot-password"
                          >
                            Forgot password?
                          </button>
                        </div>
                        <div className="relative">
                          <input
                            id="login-password"
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            placeholder="••••••••"
                            autoComplete="current-password"
                            className="w-full border border-[#E0E6EF] rounded-xl py-2.5 pl-3.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] focus:border-transparent transition-all placeholder:text-muted-foreground"
                            data-testid="input-password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(v => !v)}
                            tabIndex={-1}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-[#0078D4] transition-colors focus-visible:outline-none"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {error && (
                        <div
                          className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
                          data-testid="login-error"
                          role="alert"
                        >
                          {error}
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-[#0078D4] hover:bg-[#005A9E] disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors shadow-md shadow-[#0078D4]/20 flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0078D4] focus-visible:outline-none"
                        data-testid="button-login"
                      >
                        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                        {loading ? "Signing in…" : "Sign In"}
                      </button>

                      <div className="flex items-center justify-center gap-1.5 -mt-1">
                        <Lock className="w-3 h-3 text-[#0A2540]/45 flex-shrink-0" />
                        <span className="text-[11px] text-[#0A2540]/50 font-medium">
                          Secure access to your M365 Command Center
                        </span>
                      </div>
                    </form>
                  )}
                </div>
              </div>

              {/* ── Security & Compliance badges — bold, below the login card ── */}
              <div className="w-full max-w-md mt-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-px flex-1" style={{ background: "rgba(10,37,64,0.10)" }} />
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#0A2540]/45">
                    Security &amp; Compliance
                  </span>
                  <div className="h-px flex-1" style={{ background: "rgba(10,37,64,0.10)" }} />
                </div>

                {/* Security badges */}
                <div className="flex justify-center flex-wrap gap-2 mb-2.5">
                  {SEC_BADGES.map(({ emoji, label }) => (
                    <div
                      key={label}
                      className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 bg-[#0A2540]"
                    >
                      <span className="text-sm leading-none">{emoji}</span>
                      <span className="text-white text-xs font-bold tracking-wide">{label}</span>
                    </div>
                  ))}
                </div>

                {/* Compliance badges */}
                <div className="flex justify-center flex-wrap gap-2">
                  {COMP_BADGES.map(badge => (
                    <span
                      key={badge}
                      className="text-xs font-bold rounded-full px-3.5 py-1 border-2 border-[#0078D4] text-[#0078D4]"
                      style={{ background: "rgba(0,120,212,0.06)" }}
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Full-width footer ─────────────────────────────────────────── */}
          <footer
            className="relative shrink-0 py-3 px-6 text-center border-t"
            style={{
              background: "rgba(10,37,64,0.96)",
              borderColor: "rgba(255,255,255,0.07)",
              backdropFilter: "blur(8px)",
            }}
          >
            <p className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.38)" }}>
              Shane McCaw Consulting — Microsoft 365 Architecture &amp; Automation
            </p>
          </footer>
        </div>
      </div>
    </>
  );
}
