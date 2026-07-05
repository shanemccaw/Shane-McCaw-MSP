import { useState, useEffect, useRef } from "react";
import { useAuth, isMfaChallenge, type MfaChallenge } from "@/contexts/AuthContext";
import { useLocation, useSearch } from "wouter";
import { startAuthentication } from "@simplewebauthn/browser";
import { Loader2, Eye, EyeOff, Mail, ShieldCheck, Sparkles, ClipboardCheck, Zap } from "lucide-react";
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

// ─── Score helpers ─────────────────────────────────────────────────────────────
function scoreColor(pct: number): { bar: string; text: string } {
  if (pct < 40) return { bar: "#ef4444", text: "text-red-600" };
  if (pct < 70) return { bar: "#f59e0b", text: "text-amber-600" };
  return { bar: "#10b981", text: "text-emerald-600" };
}

// ─── M365 Health Score Panel ───────────────────────────────────────────────────
const SCORE_CATEGORIES = [
  { label: "Compliance",  key: "compliance",  target: 88 },
  { label: "Copilot",     key: "copilot",     target: 91 },
  { label: "Governance",  key: "governance",  target: 76 },
  { label: "Adoption",    key: "productivity",target: 73 },
  { label: "Security",    key: "security",    target: 84 },
] as const;

const OVERALL_TARGET = Math.round(
  (88 + 91 + 76 + 73 + 84) / 5
);

// Starting values (~20% of target so the count-up is clearly visible)
const START_PCT = 0.20;

function M365HealthPanel() {
  const startVals = {
    compliance:  Math.round(88 * START_PCT),
    copilot:     Math.round(91 * START_PCT),
    governance:  Math.round(76 * START_PCT),
    productivity:Math.round(73 * START_PCT),
    security:    Math.round(84 * START_PCT),
  };
  const [scores, setScores] = useState<Record<string, number>>(startVals);
  const [overall, setOverall] = useState(Math.round(OVERALL_TARGET * START_PCT));
  const startRef = useRef<number | null>(null);
  const rafRef   = useRef<number | null>(null);
  const DURATION = 8000; // 8 s slow count-up

  useEffect(() => {
    // Linear ease so numbers tick steadily upward
    function tick(now: number) {
      if (startRef.current === null) startRef.current = now;
      const t = Math.min((now - startRef.current) / DURATION, 1);
      // interpolate from START_PCT → 1.0
      const frac = START_PCT + (1 - START_PCT) * t;
      setScores({
        compliance:  Math.round(88 * frac),
        copilot:     Math.round(91 * frac),
        governance:  Math.round(76 * frac),
        productivity:Math.round(73 * frac),
        security:    Math.round(84 * frac),
      });
      setOverall(Math.round(OVERALL_TARGET * frac));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, []);

  // Overall ring SVG
  const r = 45;
  const circ = 2 * Math.PI * r;
  const { bar: overallBar, text: overallText } = scoreColor(overall);

  return (
    <div
      className="w-full max-w-3xl rounded-xl border border-black/5 shadow-sm hidden md:flex items-center gap-6 p-5 mb-3"
      style={{ backgroundColor: "rgba(255,255,255,0.72)", backdropFilter: "blur(14px)" }}
    >
      {/* Overall ring */}
      <div className="flex items-center gap-4 pr-6 border-r border-black/10 shrink-0">
        <div className="relative w-16 h-16 flex items-center justify-center">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-black/5" />
            <circle
              cx="50" cy="50" r={r} fill="none"
              stroke={overallBar} strokeWidth="10"
              strokeDasharray={circ}
              strokeDashoffset={circ - (overall / 100) * circ}
            />
          </svg>
          <span className={`absolute text-sm font-bold ${overallText}`}>{overall}%</span>
        </div>
        <div className="space-y-0.5">
          <h3 className="text-[11px] font-bold text-black/60 uppercase tracking-wider">M365 Health</h3>
          <p className="text-[10px] text-black/40">Tenant Posture</p>
        </div>
      </div>

      {/* Category score rings */}
      <div className="flex-1 flex items-center justify-around gap-2">
        {SCORE_CATEGORIES.map(({ label, key }) => {
          const pct = scores[key] ?? 0;
          return (
            <div key={key} className="flex flex-col items-center gap-1.5">
              <ScoreRing score={pct} size={72} strokeWidth={5} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#0A2540]/50">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Floating M365 health chips ────────────────────────────────────────────────
const CHIPS = [
  { icon: ShieldCheck,    label: "Security Posture", pos: "top-[15%] left-[8%]",     delay: "0s",   dur: "6s"  },
  { icon: Sparkles,       label: "Copilot Ready",    pos: "top-[15%] right-[8%]",    delay: "1.5s", dur: "7s"  },
  { icon: ClipboardCheck, label: "Compliance 88%",   pos: "bottom-[20%] left-[6%]",  delay: "3s",   dur: "8s"  },
  { icon: Zap,            label: "Automation Active",pos: "bottom-[20%] right-[6%]", delay: "4.5s", dur: "6.5s"},
] as const;

function FloatingChips() {
  return (
    <>
      {CHIPS.map(({ icon: Icon, label, pos, delay, dur }) => (
        <div
          key={label}
          className={`absolute ${pos} hidden md:flex items-center gap-1.5 pointer-events-none z-20 opacity-25`}
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

// ─── Activity ticker ───────────────────────────────────────────────────────────
const TICKER_MESSAGES = [
  "✓ MFA enforced across 214 identities",
  "↑ Secure Score +7 pts this week",
  "⚡ Copilot readiness scan complete",
  "🔒 Conditional Access policies applied",
  "📋 DLP policy deployed to 3 sites",
  "🛡️ Zero Trust posture validated",
  "✦ Governance audit 88% complete",
];

function ActivityTicker() {
  const [index,   setIndex]   = useState(0);
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
    <div className="hidden md:flex items-center gap-2.5 w-full max-w-md mb-3">
      <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] animate-pulse flex-shrink-0" />
      <div className="w-1 h-5 rounded-full bg-[#0078D4] flex-shrink-0" />
      <span
        className="text-xs text-[#0A2540]/60 font-medium whitespace-nowrap"
        style={{ opacity: visible ? 1 : 0, transition: "opacity 400ms ease" }}
      >
        {TICKER_MESSAGES[index]}
      </span>
    </div>
  );
}

// ─── MFA challenge screen ─────────────────────────────────────────────────────
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
    challenge.methods.includes("passkey") ? "passkey" : challenge.methods[0] ?? "totp"
  );
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
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
          0%, 100% { transform: translateY(0px);  }
          50%       { transform: translateY(-8px); }
        }
      `}</style>

      <div className="relative w-full min-h-screen overflow-hidden bg-[#F7F9FC]">

        {/* Three.js torus knot — z-1 */}
        <AnimatedBackground fullScreen />

        {/* CopilotAura edge glow — z-10 */}
        <CopilotAura />

        {/* Floating M365 health chips — z-20, hidden on mobile */}
        <FloatingChips />

        {/* ── Centered column — z-40 ────────────────────────────────────── */}
        <div className="relative z-40 flex flex-col items-center justify-center min-h-screen px-5 py-10">

          {/* Activity ticker — above the health panel, desktop only */}
          <ActivityTicker />

          {/* M365 Health Score panel — desktop only */}
          <M365HealthPanel />

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

            {/* White card */}
            <div className="bg-white border border-[#0A2540]/10 rounded-3xl shadow-xl px-8 py-10">

              {/* Wordmark */}
              <div className="flex flex-col items-center mb-7 text-center">
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

              {mfaChallenge ? (
                /* ── MFA challenge step ── */
                <MfaChallengeScreen
                  challenge={mfaChallenge}
                  onSuccess={handleMfaSuccess}
                  onBack={() => { setMfaChallenge(null); setPassword(""); }}
                />

              ) : mode === "forgot" ? (
                /* ── Forgot password flow ── */
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
                /* ── Login flow ── */
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
                </form>
              )}

              {/* Trust badges */}
              <div className="mt-6 pt-5 border-t border-[#F0F4F8]">
                <div className="grid grid-cols-4 gap-1 mb-3">
                  {[
                    { emoji: "🔒", label: "Encrypted"    },
                    { emoji: "🛡️", label: "MFA Protected" },
                    { emoji: "⚡", label: "Zero Trust"    },
                    { emoji: "🏛️", label: "NASA-grade"    },
                  ].map(({ emoji, label }) => (
                    <div key={label} className="flex flex-col items-center gap-0.5">
                      <span className="text-sm leading-none">{emoji}</span>
                      <span className="text-[9px] text-muted-foreground font-medium text-center leading-tight">{label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {["HIPAA", "SOC 2", "FINRA", "CMMC", "ITAR", "Zero Trust"].map(badge => (
                    <span
                      key={badge}
                      className="text-[9px] text-muted-foreground border border-[#E8EDF2] rounded-full px-2 py-0.5 font-medium bg-[#F7F9FC]"
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
