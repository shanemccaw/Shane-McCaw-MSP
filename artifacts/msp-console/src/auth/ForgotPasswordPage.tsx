import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AuthLayout, FieldLabel, TextField, PrimaryButton, InlineMessage } from "./AuthLayout";
import { forgotPassword, resetPassword, AuthApiError } from "./authApi";
import { text } from "@/console/tokens";

/**
 * Two real routes share one screen, exactly like Authentication.dc.html:
 * request a reset link (POST /auth/forgot-password) and use it
 * (POST /auth/reset-password). Which one renders is decided by whether the
 * URL carries the token the emailed link would append — a real query param,
 * not a design toggle.
 */
export default function ForgotPasswordPage() {
  const search = useSearch();
  const token = new URLSearchParams(search).get("token");
  return token ? <ResetPasswordForm token={token} /> : <ForgotPasswordForm />;
}

function ForgotPasswordForm() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await forgotPassword(email.trim());
    } finally {
      // The route always answers { ok: true } before it even looks the
      // account up (auth.ts) — there is nothing to distinguish here, by
      // design, so the sent state is unconditional.
      setLoading(false);
      setSent(true);
    }
  }

  return (
    <AuthLayout caption="Account recovery">
      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.02em", color: text.strong }}>Reset your password</span>
        <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>
          Enter the address on the account. The response is identical whether or not it exists.
        </span>
      </span>

      <form onSubmit={(e) => void handleSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <FieldLabel>Work email</FieldLabel>
          <TextField
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@tenant.com"
            autoFocus
            autoComplete="username"
          />
        </label>
        <PrimaryButton type="submit" disabled={loading || sent}>
          {loading ? "Sending…" : sent ? "Link sent" : "Send reset link"}
        </PrimaryButton>
        {sent && (
          <InlineMessage tone="ok" code="200 · { ok: true }" text="If an account exists for that address, a link is on its way. Check your inbox." />
        )}
      </form>

      <button
        type="button"
        onClick={() => setLocation("/login")}
        style={{ background: "none", border: "none", padding: 0, color: "#60a5fa", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", alignSelf: "flex-start" }}
      >
        ← Back to sign in
      </button>
    </AuthLayout>
  );
}

function ResetPasswordForm({ token }: { token: string }) {
  const [, setLocation] = useLocation();
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<{ code: string; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await resetPassword(token, newPassword);
      setDone(true);
    } catch (err) {
      if (err instanceof AuthApiError) {
        setError({ code: `${err.status} · ${err.status === 400 && err.message.startsWith("Password must") ? "too short" : "invalid link"}`, text: err.message });
      } else {
        setError({ code: "Network error", text: "Could not reach the server. Try again." });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout caption="Set a new password">
      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.02em", color: text.strong }}>Set a new password</span>
        <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>
          No session is issued from here — sign in again with the new password once it's set.
        </span>
      </span>

      {done ? (
        <>
          <InlineMessage tone="ok" code="200 · { ok: true }" text="Password updated. Sign in with your new password." />
          <PrimaryButton onClick={() => setLocation("/login")}>Go to sign in</PrimaryButton>
        </>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <FieldLabel>New password</FieldLabel>
            <TextField
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoFocus
              autoComplete="new-password"
            />
          </label>
          {error && <InlineMessage tone="critical" code={error.code} text={error.text} />}
          <PrimaryButton type="submit" disabled={loading}>
            {loading ? "Setting…" : "Set password"}
          </PrimaryButton>
        </form>
      )}
    </AuthLayout>
  );
}
