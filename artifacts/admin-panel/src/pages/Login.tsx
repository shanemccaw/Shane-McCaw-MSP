import { useState } from "react";
import { useAuth, isMfaChallenge, type MfaChallenge, type AuthUser } from "@/contexts/AuthContext";
import { startAuthentication } from "@simplewebauthn/browser";

function MfaChallengeScreen({
  challenge,
  onSuccess,
  onBack,
}: {
  challenge: MfaChallenge;
  onSuccess: (token: string, user: AuthUser) => void;
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
      const data = await res.json() as { accessToken?: string; user?: AuthUser; error?: string };
      if (!res.ok || !data.accessToken || !data.user) {
        throw new Error(data.error ?? "Verification failed");
      }
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
      const data = await verRes.json() as { accessToken?: string; user?: AuthUser; error?: string };
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

  const methodLabel: Record<string, string> = {
    totp: "Authenticator App",
    sms: "SMS Code",
    passkey: "Passkey",
  };

  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="w-14 h-14 bg-[#0078D4]/10 border border-[#0078D4]/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
          <svg className="w-7 h-7 text-[#0078D4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-[#0A2540]">Two-Factor Verification</h2>
        <p className="text-sm text-gray-500 mt-1">An extra step is required for admin access</p>
      </div>

      {challenge.methods.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {challenge.methods.map(m => (
            <button
              key={m}
              onClick={() => { setActiveMethod(m); setCode(""); setError(""); setSmsSent(false); }}
              className={`flex-1 text-xs font-semibold px-3 py-2 rounded-lg border transition-colors ${
                activeMethod === m
                  ? "bg-[#0078D4] text-white border-[#0078D4]"
                  : "border-gray-200 text-gray-500 hover:border-[#0078D4]/40"
              }`}
            >
              {methodLabel[m] ?? m}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2.5 rounded-lg">
          {error}
        </div>
      )}

      {activeMethod === "passkey" ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-500 text-center">
            Use your registered passkey (biometric or hardware key) to complete sign-in.
          </p>
          <button
            onClick={() => void verifyPasskey()}
            disabled={loading}
            className="w-full bg-[#0078D4] text-white rounded-lg px-4 py-3 text-sm font-semibold hover:bg-[#006CBE] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            {loading ? "Waiting…" : "Authenticate with Passkey"}
          </button>
        </div>
      ) : activeMethod === "sms" && !smsSent ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-500 text-center">Send a 6-digit code to your registered phone number to verify your identity.</p>
          <button
            onClick={() => void sendSms()}
            disabled={loading}
            className="w-full bg-[#0078D4] text-white rounded-lg px-4 py-3 text-sm font-semibold hover:bg-[#006CBE] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading ? "Sending…" : "Send SMS Code"}
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => void verifyCode(e)} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
              {activeMethod === "totp" ? "6-digit authenticator code" : "SMS verification code"}
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] transition font-mono text-center tracking-widest"
            />
            {activeMethod === "sms" && (
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-gray-400">Check your phone for the code</p>
                <button type="button" onClick={() => void sendSms()} disabled={loading}
                  className="text-xs text-[#0078D4] hover:underline disabled:opacity-50">Resend</button>
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={loading || code.length < 6}
            className="w-full bg-[#0078D4] text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-[#006CBE] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? "Verifying…" : "Verify"}
          </button>
        </form>
      )}

      <button
        onClick={onBack}
        className="w-full text-xs text-gray-400 hover:text-gray-600 transition-colors text-center"
      >
        ← Back to login
      </button>
    </div>
  );
}

export default function LoginPage() {
  const { login, completeMfaLogin } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await login(email.trim(), password);
      if (isMfaChallenge(result)) {
        setMfaChallenge(result);
      }
      // if not MFA, AuthContext sets user state and the Router redirects automatically
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  const handleMfaSuccess = (accessToken: string, user: AuthUser) => {
    if (user.role !== "admin") {
      setError("Access denied: admin credentials required");
      setMfaChallenge(null);
      return;
    }
    completeMfaLogin(accessToken, user);
  };

  return (
    <div className="min-h-screen bg-[#0A2540] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        {mfaChallenge ? (
          <MfaChallengeScreen
            challenge={mfaChallenge}
            onSuccess={handleMfaSuccess}
            onBack={() => { setMfaChallenge(null); setPassword(""); }}
          />
        ) : (
          <>
            <div className="text-center mb-8">
              <div className="w-14 h-14 bg-[#0078D4] rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-[#0A2540]">Admin Panel</h1>
              <p className="text-sm text-gray-500 mt-1">Shane McCaw Consulting</p>
            </div>

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] transition"
                  placeholder="admin@example.com"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] transition"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2.5 rounded-lg">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#0078D4] text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-[#006CBE] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
