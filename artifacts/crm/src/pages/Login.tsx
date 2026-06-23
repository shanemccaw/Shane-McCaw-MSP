import { useState } from "react";
import { useAuth, isMfaChallenge, type MfaChallenge } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { startAuthentication } from "@simplewebauthn/browser";
import { Loader2, Eye, EyeOff } from "lucide-react";

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

// ─── Animated left panel ───────────────────────────────────────────────────────
function AnimatedCommandCenter({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <style>{`
        @keyframes fillBar1 {
          0%   { width: 0% }
          30%  { width: 72% }
          60%  { width: 72% }
          72%  { width: 0% }
          100% { width: 0% }
        }
        @keyframes fillBar2 {
          0%   { width: 0% }
          30%  { width: 44% }
          60%  { width: 44% }
          72%  { width: 0% }
          100% { width: 0% }
        }
        @keyframes fillBar3 {
          0%   { width: 0% }
          30%  { width: 88% }
          60%  { width: 88% }
          72%  { width: 0% }
          100% { width: 0% }
        }
        @keyframes kanbanAppear {
          0%   { opacity: 0; transform: translateX(-6px) }
          8%   { opacity: 1; transform: translateX(0) }
          42%  { opacity: 1; transform: translateX(0) }
          52%  { opacity: 0; transform: translateX(6px) }
          100% { opacity: 0; transform: translateX(6px) }
        }
        @keyframes kanbanDone {
          0%   { opacity: 0 }
          52%  { opacity: 0 }
          60%  { opacity: 1 }
          90%  { opacity: 1 }
          100% { opacity: 0 }
        }
        @keyframes notifFloat {
          0%   { opacity: 0; transform: translateY(14px) }
          6%   { opacity: 1; transform: translateY(0) }
          72%  { opacity: 1; transform: translateY(0) }
          82%  { opacity: 0; transform: translateY(-6px) }
          100% { opacity: 0; transform: translateY(-6px) }
        }
        @keyframes cmdPulse {
          0%, 100% { opacity: 0.35 }
          50%       { opacity: 0.65 }
        }
        @keyframes cmdScan {
          0%   { transform: translateY(-100%) }
          100% { transform: translateY(600%) }
        }
        @media (prefers-reduced-motion: reduce) {
          .cmd-anim { animation: none !important; }
        }
      `}</style>

      <div className={`relative w-full ${compact ? "h-full" : "h-full"} flex flex-col items-center justify-center bg-[#0A2540] overflow-hidden px-5 py-6 select-none`}>

        {/* Radial background glow */}
        <div
          className="cmd-anim absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse 75% 55% at 50% 38%, rgba(0,120,212,0.2) 0%, transparent 70%)",
            animation: "cmdPulse 5s ease-in-out infinite",
          }}
        />

        {/* Scan line */}
        <div
          className="cmd-anim absolute inset-x-0 h-[1px] pointer-events-none"
          style={{
            background: "linear-gradient(90deg, transparent 0%, rgba(0,180,216,0.5) 50%, transparent 100%)",
            animation: "cmdScan 10s linear infinite",
            opacity: 0.06,
          }}
        />

        {/* Wordmark — hidden on compact (mobile) strip */}
        {!compact && (
          <div className="relative z-10 flex flex-col items-center mb-6 text-center">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-[#0078D4] flex items-center justify-center shadow-lg shadow-[#0078D4]/30">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-white" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
                </svg>
              </div>
              <span className="text-white font-bold text-sm tracking-tight">Shane McCaw Consulting</span>
            </div>
            <p
              className="cmd-anim text-[10px] font-bold uppercase tracking-[0.3em]"
              style={{ color: "#00B4D8", animation: "cmdPulse 3s ease-in-out infinite" }}
            >
              Command Center
            </p>
          </div>
        )}

        {/* Dashboard card */}
        <div className={`relative z-10 w-full ${compact ? "max-w-full flex gap-4 items-center" : "max-w-[260px]"} bg-[#0d2e4e] ${compact ? "rounded-xl p-3" : "rounded-2xl"} border border-white/10 shadow-2xl overflow-hidden text-[9px]`}>

          {/* Card header — hidden in compact mode */}
          {!compact && (
            <div className="flex items-center justify-between px-3 py-2 bg-[#061a2e] border-b border-white/10">
              <div className="flex items-center gap-1.5">
                <div className="cmd-anim w-1.5 h-1.5 rounded-full bg-[#0078D4]" style={{ animation: "cmdPulse 1.8s ease-in-out infinite" }} />
                <span className="text-white/40 text-[8px] font-semibold uppercase tracking-widest">Live Dashboard</span>
              </div>
              <div className="w-3 h-3 rounded-full bg-[#0078D4]/30 border border-[#0078D4]/50 flex items-center justify-center">
                <span className="text-white text-[6px] font-bold">S</span>
              </div>
            </div>
          )}

          <div className={`${compact ? "flex-1" : "p-3"} space-y-3`}>

            {/* Animated progress bars */}
            <div className="space-y-2">
              {!compact && <p className="text-white/25 text-[8px] font-semibold uppercase tracking-widest">Active Engagements</p>}
              {[
                { label: "M365 Migration",    color: "#0078D4", anim: "fillBar1", duration: "7s", delay: "0s"   },
                { label: "Governance Audit",  color: "#00B4D8", anim: "fillBar2", duration: "7s", delay: "0.7s" },
                { label: "Copilot Readiness", color: "#0078D4", anim: "fillBar3", duration: "7s", delay: "1.4s" },
              ].map(({ label, color, anim, duration, delay }) => (
                <div key={label}>
                  {!compact && (
                    <span className="text-white/50 text-[8px] block mb-0.5">{label}</span>
                  )}
                  <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="cmd-anim h-full rounded-full"
                      style={{
                        backgroundColor: color,
                        width: "0%",
                        animation: `${anim} ${duration} ease-in-out infinite`,
                        animationDelay: delay,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Kanban — hidden in compact strip */}
            {!compact && (
              <div>
                <p className="text-white/25 text-[8px] font-semibold uppercase tracking-widest mb-1.5">Task Board</p>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <div className="flex items-center gap-1 mb-1">
                      <div className="w-1 h-1 rounded-full bg-[#0078D4]" />
                      <span className="text-[7px] text-white/25 font-bold uppercase tracking-wide">In Progress</span>
                    </div>
                    <div className="space-y-1">
                      <div className="bg-[#0A2540] border border-white/10 rounded px-1.5 py-1">
                        <span className="text-white/50 text-[8px]">IAM review</span>
                      </div>
                      <div
                        className="cmd-anim bg-[#0078D4]/20 border border-[#0078D4]/40 rounded px-1.5 py-1"
                        style={{ animation: "kanbanAppear 9s ease-in-out infinite" }}
                      >
                        <span className="text-[8px] font-medium" style={{ color: "#0078D4" }}>Tenant config ✦</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1 mb-1">
                      <div className="w-1 h-1 rounded-full" style={{ backgroundColor: "#00B4D8" }} />
                      <span className="text-[7px] text-white/25 font-bold uppercase tracking-wide">Done</span>
                    </div>
                    <div className="space-y-1">
                      <div className="bg-[#0A2540] border border-white/10 rounded px-1.5 py-1">
                        <span className="text-white/50 text-[8px]">Discovery</span>
                      </div>
                      <div
                        className="cmd-anim bg-[#00B4D8]/20 border border-[#00B4D8]/40 rounded px-1.5 py-1"
                        style={{ animation: "kanbanDone 9s ease-in-out infinite", opacity: 0 }}
                      >
                        <span className="text-[8px] font-medium" style={{ color: "#00B4D8" }}>Tenant config ✓</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Notification toast — hidden in compact strip */}
            {!compact && (
              <div
                className="cmd-anim flex items-start gap-2 rounded-lg px-2.5 py-2 border"
                style={{
                  background: "rgba(0,120,212,0.12)",
                  borderColor: "rgba(0,120,212,0.25)",
                  animation: "notifFloat 8s ease-in-out infinite",
                  animationDelay: "2.5s",
                  opacity: 0,
                }}
              >
                <div className="w-3 h-3 rounded-full bg-[#0078D4] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-white text-[6px]">✉</span>
                </div>
                <div>
                  <p className="text-white/75 text-[8px] font-semibold">New message from Shane</p>
                  <p className="text-white/35 text-[7px]">Phase 3 update ready for review</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom label — full panel only */}
        {!compact && (
          <p className="relative z-10 mt-5 text-[9px] font-medium uppercase tracking-[0.25em] text-white/20">
            Secure · Encrypted · Zero Trust
          </p>
        )}
      </div>
    </>
  );
}

// ─── Social login SVG icons ───────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 21 21" className="w-4 h-4 flex-shrink-0" aria-hidden="true">
      <rect x="1"  y="1"  width="9" height="9" fill="#F25022" />
      <rect x="11" y="1"  width="9" height="9" fill="#7FBA00" />
      <rect x="1"  y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" fill="#0077B5" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
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
      else { const d = await res.json() as { error?: string }; setError(d.error ?? "Failed to send SMS"); }
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
      const data = await res.json() as { accessToken?: string; user?: import("@/contexts/AuthContext").AuthUser; error?: string };
      if (!res.ok || !data.accessToken || !data.user) throw new Error(data.error ?? "Verification failed");
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

  const [mode, setMode]                 = useState<"login" | "forgot">("login");
  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]               = useState("");
  const [loading, setLoading]           = useState(false);
  const [forgotSent, setForgotSent]     = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null);
  const [socialNote, setSocialNote]     = useState("");

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

  const handleSocialClick = (provider: string) => {
    setSocialNote(`${provider} sign-in launches shortly`);
    setTimeout(() => setSocialNote(""), 3000);
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
    <div className="flex flex-col md:flex-row md:h-screen md:overflow-hidden">

      {/* ── LEFT PANEL (desktop) — full animated command center ─────────── */}
      <div className="hidden md:flex md:w-[55%] h-full relative">
        <AnimatedCommandCenter />
      </div>

      {/* ── LEFT PANEL (mobile) — slim h-40 animated strip ──────────────── */}
      <div className="md:hidden h-40 flex-shrink-0 relative overflow-hidden">
        <AnimatedCommandCenter compact />
      </div>

      {/* ── RIGHT PANEL — login card ─────────────────────────────────────── */}
      <div className="flex-1 md:w-[45%] flex flex-col items-center justify-center bg-[#F4F7FC] px-5 py-8 overflow-y-auto relative">

        {/* Social login coming-soon toast */}
        {socialNote && (
          <div
            className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-[#0A2540] text-white text-xs font-medium px-4 py-2 rounded-lg shadow-lg whitespace-nowrap pointer-events-none"
            role="status"
            aria-live="polite"
          >
            Coming soon — {socialNote}
          </div>
        )}

        <div className="w-full max-w-sm">

          {/* Logo + heading */}
          <div className="text-center mb-7">
            <div className="inline-flex items-center justify-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-xl bg-[#0078D4] flex items-center justify-center shadow-lg shadow-[#0078D4]/25 flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
                </svg>
              </div>
              <div className="text-left">
                <p className="text-[#0A2540] font-bold text-sm leading-none">Shane McCaw</p>
                <p className="text-[11px] font-semibold" style={{ color: "#0078D4" }}>Consulting</p>
              </div>
            </div>
            <h1 className="text-2xl font-extrabold text-[#0A2540] tracking-tight leading-tight">
              Customer Command Center
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {mode === "forgot" ? "Enter your email to receive a reset link" : "Secure client portal — sign in to continue"}
            </p>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-2xl shadow-[#0A2540]/10 border border-[#E4EAF2]">
            <div className="p-6">

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
                <>
                  {/* Social login buttons */}
                  <div className="space-y-2 mb-5">
                    {[
                      { label: "Continue with Google",    icon: <GoogleIcon />,    provider: "Google"    },
                      { label: "Continue with Microsoft", icon: <MicrosoftIcon />, provider: "Microsoft" },
                      { label: "Continue with LinkedIn",  icon: <LinkedInIcon />,  provider: "LinkedIn"  },
                    ].map(({ label, icon, provider }) => (
                      <button
                        key={provider}
                        type="button"
                        onClick={() => handleSocialClick(provider)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 bg-white border border-[#E0E6EF] rounded-xl text-sm font-medium text-[#0A2540] hover:bg-[#F7F9FC] hover:border-[#0078D4]/30 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0078D4] focus-visible:outline-none"
                        aria-label={`${label} (coming soon)`}
                      >
                        {icon}
                        <span className="flex-1 text-left">{label}</span>
                        <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5 font-normal">Soon</span>
                      </button>
                    ))}
                  </div>

                  {/* Divider */}
                  <div className="relative flex items-center gap-3 mb-5">
                    <div className="flex-1 h-px bg-[#E8EDF2]" />
                    <span className="text-[11px] text-muted-foreground font-medium flex-shrink-0">or sign in with email</span>
                    <div className="flex-1 h-px bg-[#E8EDF2]" />
                  </div>

                  {/* Email + Password form */}
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
                </>
              )}
            </div>

            {/* Trust badges + compliance row */}
            <div className="px-6 py-4 border-t border-[#F0F4F8] bg-[#FAFBFD] rounded-b-2xl">
              <div className="grid grid-cols-4 gap-1 mb-3">
                {[
                  { emoji: "🔒", label: "Encrypted"   },
                  { emoji: "🛡️", label: "MFA Protected" },
                  { emoji: "⚡", label: "Zero Trust"   },
                  { emoji: "🏛️", label: "NASA-grade"   },
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
                    className="text-[9px] text-muted-foreground border border-[#E8EDF2] rounded-full px-2 py-0.5 font-medium bg-white"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Access by invitation note */}
          <p className="text-center text-xs text-muted-foreground mt-5 leading-relaxed">
            Access is by invitation.{" "}
            <a
              href="mailto:support@shanemccaw.com"
              className="text-[#0078D4] hover:underline font-medium"
            >
              Contact support
            </a>{" "}
            if you need help.
          </p>
        </div>
      </div>
    </div>
  );
}
