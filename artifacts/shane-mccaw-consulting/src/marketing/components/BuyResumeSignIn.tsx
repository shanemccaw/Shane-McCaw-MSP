import React, { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { logger } from "../../lib/logger";

// Git #4377 — "Already started? Sign in to resume." on /buy.
//
// Account → consent → pay means a Monitoring, Pack or (#4383) Retainer buyer has a real account
// (password + MFA) before anything else happens. A buyer who closed the tab,
// crashed, or came back on another device therefore resumes by signing in —
// not by hoping a localStorage session id survived. This is the platform's own
// sign-in (POST /api/auth/login, then the TOTP or passkey challenge the account
// actually has), followed by GET /api/public/purchase/resume, which hands back
// the checkout session THIS account owns. Buy.tsx lands the buyer on the real
// stage from that response.

const authLog = logger.child({ channel: "auth" });

export interface ResumedPurchase {
  sessionId: string;
  productSlug: string;
  productCategory: "monitoring" | "config_pack" | "retainer";
  seats: number;
  status: "pending" | "consented" | "paid";
  mfaEnrolled: boolean;
  tenantConnected: boolean;
  /** #4383 — the buyer declined the optional Retainer scan on this session. */
  readConsentSkipped: boolean;
  email: string;
  fullName: string;
  company: string | null;
  renewed: boolean;
}

type Step = "credentials" | "totp" | "passkey";

interface Props {
  /** Pre-fills the email, e.g. the address a returning buyer just typed. */
  defaultEmail?: string;
  inputStyle: React.CSSProperties;
  buttonBackground: string;
  onResumed: (purchase: ResumedPurchase) => void;
  onCancel: () => void;
}

export function BuyResumeSignIn({ defaultEmail, inputStyle, buttonBackground, onResumed, onCancel }: Props) {
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [methods, setMethods] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // The access token lives only in this call chain — it is used once, for the
  // resume read, and never stored.
  const resumeWith = async (accessToken: string) => {
    const res = await fetch("/api/public/purchase/resume", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json().catch(() => ({}))) as Partial<ResumedPurchase> & { error?: string };
    if (res.status === 404) {
      authLog.info({}, "purchase resume: signed in, no unfinished purchase on this account");
      throw new Error(
        "You're signed in, but this account has no unfinished purchase to resume. If you already finished one, open the Portal instead.",
      );
    }
    if (!res.ok || !data.sessionId) {
      authLog.warn({ status: res.status, error: data.error }, "purchase resume read failed");
      throw new Error("Could not load your purchase. Please try again.");
    }
    authLog.info({ sessionId: data.sessionId, status: data.status, renewed: data.renewed }, "purchase resumed after sign-in");
    onResumed(data as ResumedPurchase);
  };

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const signIn = () =>
    run(async () => {
      if (!email.trim() || !password) throw new Error("Enter the email and password you created your account with.");
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        accessToken?: string;
        mfaRequired?: boolean;
        mfaToken?: string;
        methods?: string[];
        error?: string;
      };
      if (!res.ok) {
        authLog.warn({ status: res.status }, "purchase resume sign-in refused");
        throw new Error(data.error ?? "Could not sign you in. Please try again.");
      }
      if (data.mfaRequired && data.mfaToken) {
        const m = data.methods ?? [];
        setMfaToken(data.mfaToken);
        setMethods(m);
        setStep(m.includes("totp") ? "totp" : "passkey");
        return;
      }
      if (!data.accessToken) throw new Error("Could not sign you in. Please try again.");
      await resumeWith(data.accessToken);
    });

  const verifyTotp = () =>
    run(async () => {
      if (code.length !== 6 || !mfaToken) return;
      const res = await fetch("/api/auth/mfa/totp/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaToken, code }),
      });
      const data = (await res.json().catch(() => ({}))) as { accessToken?: string; error?: string };
      if (!res.ok || !data.accessToken) {
        throw new Error(data.error ?? "That code didn't match. Please try again.");
      }
      await resumeWith(data.accessToken);
    });

  const verifyPasskey = () =>
    run(async () => {
      if (!mfaToken) return;
      try {
        const optRes = await fetch("/api/auth/mfa/passkey/authentication-options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mfaToken }),
        });
        if (!optRes.ok) throw new Error("Could not start passkey sign-in.");
        const options = await optRes.json();
        const assertion = await startAuthentication({ optionsJSON: options });
        const verRes = await fetch("/api/auth/mfa/passkey/verify-authentication", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mfaToken, ...assertion }),
        });
        const verData = (await verRes.json().catch(() => ({}))) as { accessToken?: string; error?: string };
        if (!verRes.ok || !verData.accessToken) throw new Error(verData.error ?? "Passkey sign-in failed.");
        await resumeWith(verData.accessToken);
      } catch (err) {
        if (err instanceof Error && err.name === "NotAllowedError") throw new Error("Passkey sign-in was cancelled.");
        throw err;
      }
    });

  const primary: React.CSSProperties = {
    width: "100%",
    padding: "11px",
    border: 0,
    borderRadius: "10px",
    fontFamily: "inherit",
    fontSize: "13px",
    fontWeight: 700,
    color: "#fff",
    background: busy ? "rgba(71,85,105,.4)" : buttonBackground,
    cursor: busy ? "wait" : "pointer",
  };

  return (
    <div
      data-testid="buy-resume"
      data-step={step}
      style={{
        border: "1px solid rgba(59,130,246,.3)",
        borderRadius: "16px",
        background: "rgba(59,130,246,.05)",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <span style={{ fontSize: "14.5px", fontWeight: 700, color: "#f8fafc" }}>Sign in to resume your purchase</span>
      <p style={{ margin: 0, fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.65 }}>
        {step === "credentials"
          ? "Use the email and password you created your account with. You'll pick up exactly where you left off."
          : step === "totp"
            ? "Enter the code from your authenticator app."
            : "Confirm with your passkey to continue."}
      </p>

      {step === "credentials" && (
        <>
          <input
            data-testid="buy-resume-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourcompany.com"
            style={inputStyle}
          />
          <input
            data-testid="buy-resume-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void signIn()}
            placeholder="Password"
            style={inputStyle}
          />
          <button data-testid="buy-resume-signin" onClick={() => void signIn()} disabled={busy} style={primary}>
            {busy ? "Signing in…" : "Sign in and resume"}
          </button>
        </>
      )}

      {step === "totp" && (
        <>
          <input
            data-testid="buy-resume-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && void verifyTotp()}
            placeholder="Code from your app"
            style={inputStyle}
          />
          <button data-testid="buy-resume-verify" onClick={() => void verifyTotp()} disabled={busy} style={primary}>
            {busy ? "Checking…" : "Verify and resume"}
          </button>
          {methods.includes("passkey") && (
            <button
              onClick={() => setStep("passkey")}
              style={{ padding: 0, border: 0, background: "none", fontFamily: "inherit", fontSize: "11.5px", fontWeight: 600, color: "#60a5fa", cursor: "pointer", alignSelf: "flex-start" }}
            >
              Use a passkey instead
            </button>
          )}
        </>
      )}

      {step === "passkey" && (
        <>
          <button data-testid="buy-resume-passkey" onClick={() => void verifyPasskey()} disabled={busy} style={primary}>
            {busy ? "Waiting for your passkey…" : "Use my passkey"}
          </button>
          {methods.includes("totp") && (
            <button
              onClick={() => setStep("totp")}
              style={{ padding: 0, border: 0, background: "none", fontFamily: "inherit", fontSize: "11.5px", fontWeight: 600, color: "#60a5fa", cursor: "pointer", alignSelf: "flex-start" }}
            >
              Use the authenticator app instead
            </button>
          )}
        </>
      )}

      {notice && (
        <p data-testid="buy-resume-notice" style={{ margin: 0, fontSize: "12.5px", color: "#f87171", lineHeight: 1.55 }}>
          {notice}
        </p>
      )}
      <button
        data-testid="buy-resume-cancel"
        onClick={onCancel}
        style={{ padding: 0, border: 0, background: "none", fontFamily: "inherit", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8", cursor: "pointer", alignSelf: "flex-start" }}
      >
        Start a new purchase instead
      </button>
    </div>
  );
}
