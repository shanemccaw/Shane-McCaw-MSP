import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, CheckCircle2, ShieldCheck } from "lucide-react";

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token"));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        setDone(true);
      } else {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Could not reset password. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const invalidToken = !token;

  return (
    <div className="min-h-screen bg-[#F7F9FC] flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2.5 mb-10 group w-fit mx-auto">
          <div className="w-8 h-8 rounded-lg bg-[#0078D4] flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
            </svg>
          </div>
          <span className="text-[#0A2540] font-bold text-base group-hover:text-[#0078D4] transition-colors">Shane McCaw Consulting</span>
        </a>

        {invalidToken ? (
          <div className="bg-white border border-border rounded-2xl shadow-sm p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-lg font-bold text-[#0A2540] mb-2">Invalid reset link</h1>
            <p className="text-sm text-muted-foreground mb-6">This password reset link is missing or malformed. Please request a new one.</p>
            <button
              onClick={() => setLocation("/")}
              className="w-full bg-[#0078D4] text-white font-semibold rounded-lg py-2.5 text-sm hover:bg-[#005A9E] transition-colors"
            >
              Back to sign in
            </button>
          </div>
        ) : done ? (
          <div className="bg-white border border-border rounded-2xl shadow-sm p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
            </div>
            <h1 className="text-lg font-bold text-[#0A2540] mb-2">Password updated!</h1>
            <p className="text-sm text-muted-foreground mb-6">Your password has been changed successfully. You can now sign in with your new password.</p>
            <button
              onClick={() => setLocation("/")}
              className="w-full bg-[#0078D4] text-white font-semibold rounded-lg py-2.5 text-sm hover:bg-[#005A9E] transition-colors"
            >
              Sign in to your portal
            </button>
          </div>
        ) : (
          <div className="bg-white border border-border rounded-2xl shadow-sm p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-5 h-5 text-[#0078D4]" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-[#0A2540]">Set new password</h1>
                <p className="text-xs text-muted-foreground">Choose a strong password for your portal account.</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">New password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className="w-full border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] transition-shadow"
                  data-testid="input-new-password"
                />
                <p className="text-xs text-muted-foreground mt-1">Minimum 8 characters</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">Confirm new password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className="w-full border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] transition-shadow"
                  data-testid="input-confirm-new-password"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#0078D4] text-white font-semibold rounded-lg py-3 text-sm hover:bg-[#005A9E] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                data-testid="button-reset-password"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Updating password…
                  </>
                ) : (
                  "Update password"
                )}
              </button>
            </form>

            <p className="text-center text-xs text-muted-foreground mt-4">
              Remember your password?{" "}
              <button
                type="button"
                onClick={() => setLocation("/")}
                className="text-[#0078D4] hover:underline font-medium"
              >
                Sign in
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
