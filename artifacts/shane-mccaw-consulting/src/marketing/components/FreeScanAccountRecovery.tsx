import { useState } from "react";
import { logger } from "../../lib/logger";

/**
 * Recovery for the Free Scan engagement account (Git #4483, Feature #1352) —
 * the "Forgot your password?" and "Lost your authenticator?" paths off the
 * /scan/account sign-in card.
 *
 * The two paths are deliberately not the same shape (see
 * artifacts/api-server/src/lib/free-scan-account-recovery.ts):
 *   • lost password — emailed code, then a new password. It does not sign in;
 *     the Prospect signs in with the new password and their second factor.
 *   • lost authenticator — emailed code plus the current password lodges a
 *     request, which Shane approves after checking identity directly. Once
 *     approved: emailed code, password, and proof of the new factor.
 *
 * No design export exists for this page; it is built in the sign-in card's own
 * visual language. Every state shown comes from the recovery endpoints.
 */

const log = logger.child({ channel: "auth" });

const API = "/api/public/free-scan/account/recover";

const EYEBROW: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#34d399" };
const H1: React.CSSProperties = { margin: 0, fontSize: "clamp(22px,2.7vw,29px)", fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.18, color: "#f8fafc" };
const BODY: React.CSSProperties = { margin: 0, fontSize: 14, lineHeight: 1.65, color: "#94a3b8" };
const CARD: React.CSSProperties = {
  border: "1px solid rgba(30,41,59,.95)",
  borderRadius: 16,
  background: "#0b1524",
  padding: 22,
  display: "flex",
  flexDirection: "column",
  gap: 14,
};
const INPUT: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(2,6,23,.7)",
  border: "1px solid rgba(51,65,85,.9)",
  borderRadius: 10,
  padding: "11px 13px",
  fontFamily: "inherit",
  fontSize: 13.5,
  color: "#f1f5f9",
  outline: "none",
};
const CODE_INPUT: React.CSSProperties = {
  ...INPUT,
  padding: 14,
  fontSize: 26,
  fontWeight: 700,
  letterSpacing: ".42em",
  textAlign: "center",
  fontFamily: "Menlo,Consolas,monospace",
};
const LINK: React.CSSProperties = { padding: 0, border: 0, background: "none", fontFamily: "inherit", fontSize: 11.5, fontWeight: 600, color: "#60a5fa", cursor: "pointer" };
const FOOT: React.CSSProperties = { fontSize: 11, color: "#475569", lineHeight: 1.5, textAlign: "center" };
const btn = (ready: boolean): React.CSSProperties => ({
  width: "100%",
  padding: 12,
  border: 0,
  borderRadius: 10,
  fontFamily: "inherit",
  fontSize: 13.5,
  fontWeight: 700,
  color: "#fff",
  cursor: ready ? "pointer" : "not-allowed",
  background: ready ? "linear-gradient(90deg,#3b82f6,#8b5cf6)" : "rgba(71,85,105,.4)",
});

const ERRORS: Record<string, string> = {
  email_invalid: "Enter the email address you sign in with.",
  code_invalid: "That code doesn't match, or it has expired. Request a new one if you need to.",
  recovery_expired: "This recovery timed out. Start again to get a new code.",
  weak_password: "The password needs at least 12 characters, one capital letter and one number.",
  invalid_password: "That password isn't right.",
  account_locked: "Too many wrong passwords. Wait fifteen minutes and try again.",
  not_approved: "Replacing your second factor hasn't been approved yet.",
  phone_invalid: "Enter the full mobile number, including the country code.",
  sms_send_failed: "We couldn't send a text to that number. Check it and try again.",
  code_expired: "That code has expired. Send a new one.",
  too_many_attempts: "Too many tries on that code. Send a new one.",
  no_pending_factor: "Set up the new second factor first.",
};

class ApiError extends Error {
  constructor(readonly key: string) {
    super(key);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data?.error ?? `request_failed_${res.status}`);
  return data;
}

type MfaResetState = "none" | "pending" | "approved" | "approval_expired" | "denied";

interface Verified {
  recoveryToken: string;
  mfaMethod: "totp" | "sms" | null;
  phoneLast4: string | null;
  mfaReset: { state: MfaResetState; approvalExpiresAt: string | null };
}

type Step =
  | "email"
  | "code"
  | "new_password"
  | "password_done"
  | "mfa_request"
  | "mfa_requested"
  | "mfa_pending"
  | "mfa_enrol";

export type RecoveryKind = "password" | "mfa";

export function FreeScanAccountRecovery({
  kind: initialKind,
  initialEmail,
  onBack,
  onSignedIn,
}: {
  kind: RecoveryKind;
  initialEmail: string;
  onBack: () => void;
  onSignedIn: () => void;
}) {
  const [kind, setKind] = useState<RecoveryKind>(initialKind);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [verified, setVerified] = useState<Verified | null>(null);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState<"app" | "sms">("app");
  const [secret, setSecret] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [smsSentTo, setSmsSentTo] = useState<string | null>(null);
  const [factorCode, setFactorCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fail = (err: unknown, what: string) => {
    const key = err instanceof ApiError ? err.key : "";
    log.error({ err, key, what }, "free-scan account recovery: step failed");
    // express-rate-limit answers with a readable sentence in `error`.
    setError(ERRORS[key] ?? (key.includes(" ") ? key : "Something went wrong. Please try again."));
    if (key === "recovery_expired") {
      setToken(null);
      setStep("email");
    }
  };

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      fail(err, what);
    } finally {
      setBusy(false);
    }
  };

  const emailOk = /\S+@\S+\.\S+/.test(email);
  const pwOk = pw1.length >= 12 && /[A-Z]/.test(pw1) && /[0-9]/.test(pw1) && pw1 === pw2;

  const sendCode = () =>
    run("send code", async () => {
      const sent = await post<{ expiresInMinutes: number }>("send-code", { email });
      setCode("");
      setStep("code");
      setNotice(`If ${email} has an engagement account, a code is on its way. It expires in ${sent.expiresInMinutes} minutes.`);
    });

  /** Where a verified recovery lands, for whichever factor was lost. */
  const route = (v: Verified, k: RecoveryKind) => {
    if (k === "password") {
      setStep("new_password");
      return;
    }
    if (v.mfaReset.state === "approved") setStep("mfa_enrol");
    else if (v.mfaReset.state === "pending") setStep("mfa_pending");
    else setStep("mfa_request");
  };

  const verifyCode = () =>
    run("verify code", async () => {
      const v = await post<Verified>("verify-code", { email, code });
      setVerified(v);
      setToken(v.recoveryToken);
      setCode("");
      route(v, kind);
    });

  const resetPassword = () =>
    run("reset password", async () => {
      const data = await post<{ recoveryToken: string }>("reset-password", { recoveryToken: token, password: pw1 });
      setToken(data.recoveryToken);
      setPw1("");
      setPw2("");
      // A password reset cancels any factor reset that was in flight.
      if (verified) setVerified({ ...verified, mfaReset: { state: "none", approvalExpiresAt: null } });
      setStep("password_done");
    });

  const requestMfaReset = () =>
    run("request factor reset", async () => {
      const data = await post<{ state: "pending" | "approved" }>("mfa-reset", { recoveryToken: token, password });
      setPassword("");
      if (data.state === "approved") {
        // Already approved, and the token was not spent: carry straight on.
        setStep("mfa_enrol");
        return;
      }
      setToken(null);
      setStep("mfa_requested");
    });

  const beginFactor = () =>
    run("begin new factor", async () => {
      if (method === "app") {
        const data = await post<{ secret: string }>("mfa/totp/setup", { recoveryToken: token, password });
        setSecret(data.secret);
      } else {
        const data = await post<{ phoneLast4: string }>("mfa/sms/setup", { recoveryToken: token, password, phone });
        setSmsSentTo(data.phoneLast4);
      }
    });

  const finishFactor = () =>
    run("finish new factor", async () => {
      await post("mfa/verify", { recoveryToken: token, code: factorCode });
      onSignedIn();
    });

  const factorStarted = method === "app" ? !!secret : !!smsSentTo;

  let eyebrow = kind === "password" ? "Forgot your password" : "Lost your authenticator";
  let title = "Recover your engagement account";
  let body = "Enter the email address you sign in with. We'll send a six-digit code to it.";
  let cta: string | null = "Send code";
  let ready = emailOk && !busy;
  let submit: (() => Promise<void>) | null = sendCode;

  switch (step) {
    case "code":
      title = "Check your email for a six-digit code";
      body = `Enter the code sent to ${email}.`;
      cta = "Verify code";
      ready = code.length === 6 && !busy;
      submit = verifyCode;
      break;
    case "new_password":
      title = "Set a new password";
      body = "Twelve characters minimum, one capital, one number. Every signed-in session will be signed out.";
      cta = "Set new password";
      ready = pwOk && !busy;
      submit = resetPassword;
      break;
    case "password_done":
      eyebrow = "Password changed";
      title = "Sign in with your new password";
      body = "Signing in still needs your second factor.";
      cta = null;
      submit = null;
      break;
    case "mfa_request":
      title = "Confirm your password";
      body =
        verified?.mfaReset.state === "denied"
          ? "Your last request to replace your second factor wasn't approved. Enter your password to ask again."
          : verified?.mfaReset.state === "approval_expired"
            ? "Your approval to replace your second factor expired before it was used. Enter your password to ask again."
            : "The emailed code alone can't replace a second factor. Enter your password, and we'll check your identity with you directly before a new one can be set up.";
      cta = "Request a new second factor";
      ready = password.length > 0 && !busy;
      submit = requestMfaReset;
      break;
    case "mfa_requested":
    case "mfa_pending":
      eyebrow = "Request received";
      title = "We'll confirm it's you first";
      body =
        "Before a new second factor can be set up, Shane checks your identity with you directly. Once that's done we'll email you, including how long you have to set it up here.";
      cta = null;
      submit = null;
      break;
    case "mfa_enrol":
      eyebrow = "Approved";
      title = "Set up a new second factor";
      body = factorStarted
        ? method === "app"
          ? "Add this key to your authenticator app, then enter the six-digit code it shows."
          : `We texted a code to the number ending ${smsSentTo ?? ""}.`
        : "Enter your password and choose the new second factor. The old one stops working once this is done.";
      cta = factorStarted ? "Finish and sign in" : method === "app" ? "Show my new key" : "Text me a code";
      ready = !busy && (factorStarted ? factorCode.length === 6 : password.length > 0 && (method === "app" || phone.replace(/\D/g, "").length >= 8));
      submit = factorStarted ? finishFactor : beginFactor;
      break;
  }

  return (
    <div
      style={{ maxWidth: 520, margin: "0 auto", padding: "64px 32px 96px", display: "flex", flexDirection: "column", gap: 20 }}
      data-testid="freescan-account-recovery"
      data-step={step}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <span style={EYEBROW}>{eyebrow}</span>
        <h1 style={H1}>{title}</h1>
        <p style={BODY}>{body}</p>
      </div>
      <form
        style={CARD}
        onSubmit={(e) => {
          e.preventDefault();
          if (submit && ready) void submit();
        }}
      >
        {step === "email" ? (
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" autoComplete="username" autoFocus style={INPUT} data-testid="freescan-recovery-email" />
        ) : null}

        {step === "code" ? (
          <>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-label="Six-digit code"
              autoFocus
              style={CODE_INPUT}
              data-testid="freescan-recovery-code"
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => void sendCode()} disabled={busy} style={LINK} data-testid="freescan-recovery-resend">
                Send a new code
              </button>
            </div>
          </>
        ) : null}

        {step === "new_password" ? (
          <>
            <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="New password" autoComplete="new-password" style={INPUT} data-testid="freescan-recovery-pw1" />
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm new password" autoComplete="new-password" style={INPUT} data-testid="freescan-recovery-pw2" />
          </>
        ) : null}

        {step === "mfa_request" ? (
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Current password" autoComplete="current-password" style={INPUT} data-testid="freescan-recovery-password" />
        ) : null}

        {step === "mfa_enrol" && !factorStarted ? (
          <>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password" style={INPUT} data-testid="freescan-recovery-enrol-password" />
            <div role="radiogroup" style={{ display: "flex", gap: 10 }}>
              {(
                [
                  { key: "app", name: "Authenticator app" },
                  { key: "sms", name: "Text message" },
                ] as const
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="radio"
                  aria-checked={method === m.key}
                  onClick={() => setMethod(m.key)}
                  data-testid={`freescan-recovery-method-${m.key}`}
                  style={{
                    flex: 1,
                    padding: "11px 12px",
                    borderRadius: 10,
                    fontFamily: "inherit",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#f8fafc",
                    cursor: "pointer",
                    border: `1px solid ${method === m.key ? "rgba(59,130,246,.5)" : "rgba(30,41,59,.9)"}`,
                    background: method === m.key ? "rgba(59,130,246,.07)" : "rgba(2,6,23,.4)",
                  }}
                >
                  {m.name}
                </button>
              ))}
            </div>
            {method === "sms" ? (
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number, with country code" autoComplete="tel" style={INPUT} data-testid="freescan-recovery-phone" />
            ) : null}
          </>
        ) : null}

        {step === "mfa_enrol" && factorStarted ? (
          <>
            {method === "app" && secret ? (
              <div style={{ border: "1px solid rgba(59,130,246,.28)", borderRadius: 11, background: "rgba(59,130,246,.06)", padding: "13px 15px", display: "flex", flexDirection: "column", gap: 7 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>Setup key</span>
                <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".16em", color: "#f1f5f9", fontFamily: "Menlo,Consolas,monospace", wordBreak: "break-all" }} data-testid="freescan-recovery-secret">
                  {secret}
                </span>
              </div>
            ) : null}
            <input
              value={factorCode}
              onChange={(e) => setFactorCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-label="Six-digit code"
              autoFocus
              style={CODE_INPUT}
              data-testid="freescan-recovery-factor-code"
            />
          </>
        ) : null}

        {cta && submit ? (
          <button type="submit" disabled={!ready} style={btn(ready)} data-testid="freescan-recovery-submit">
            {cta}
          </button>
        ) : null}

        {notice && !error ? (
          <span style={{ fontSize: 12, lineHeight: 1.55, color: "#94a3b8", textAlign: "center" }} data-testid="freescan-recovery-notice">
            {notice}
          </span>
        ) : null}
        {error ? (
          <span style={{ fontSize: 12, lineHeight: 1.55, color: "#f87171", textAlign: "center" }} data-testid="freescan-recovery-error">
            {error}
          </span>
        ) : null}

        {step === "new_password" ? (
          <span style={FOOT}>
            Lost your authenticator too? Set the new password first, then replace the second factor.
          </span>
        ) : null}

        {step === "password_done" ? (
          <button
            type="button"
            onClick={() => {
              setKind("mfa");
              setStep("mfa_request");
              setError(null);
            }}
            style={LINK}
            data-testid="freescan-recovery-also-mfa"
          >
            Lost your authenticator too?
          </button>
        ) : null}

        {step === "mfa_request" ? (
          <button
            type="button"
            onClick={() => {
              setKind("password");
              setStep("new_password");
              setError(null);
            }}
            style={LINK}
            data-testid="freescan-recovery-also-password"
          >
            Forgot the password too?
          </button>
        ) : null}

        <button type="button" onClick={onBack} style={LINK} data-testid="freescan-recovery-back">
          Back to sign in
        </button>
      </form>
    </div>
  );
}
