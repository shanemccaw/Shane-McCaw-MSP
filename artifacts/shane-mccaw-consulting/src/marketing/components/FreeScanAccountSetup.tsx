import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "../../lib/logger";

/**
 * The `{{ acctScreen }}` block of the confirmed design
 * `Design/marketing/marketing_handoff/Marketing Checkout.dc.html` — emailed
 * six-digit code → password → second factor — for a paid Free Scan Prospect
 * (Git #4329). Rendered by /scan/remediate at the server's `account` stage, which
 * sits exactly where the design puts it: after payment, before the write step.
 *
 * ── The account is SCOPED, and the copy says so ───────────────────────────────
 * Shane's scope correction on #4329: this account opens the Prospect's own scan
 * results and signed SOW (their engagement page, /scan/account) and is not a
 * Portal login. The design's strings are kept verbatim except where they named
 * "the Portal" as the thing being created or opened — those two now name the
 * engagement instead, because the Portal is exactly what this account must not
 * promise.
 *
 * ── Two additions the design's mock state machine does not show ──────────────
 *   • Text message: the design completes on a phone number alone. A number nobody
 *     has proven is not a second factor, so the first press sends a real code and
 *     a code field appears under the number; the second press confirms it.
 *   • Error lines under the button, for the real refusals the server can return.
 *     The design's mock never fails.
 *
 * Nothing here is a fixture: the masked address, the authenticator key and every
 * transition come from `/api/public/free-scan/account/*`.
 */

const log = logger.child({ channel: "auth" });

export type FreeScanCredential = { sessionId: string } | { returnToken: string } | { accountSession: true };

type Stage = "not_paid" | "code" | "password" | "mfa" | "complete";

interface StatusResponse {
  stage: Stage;
  email: string | null;
  codePending: boolean;
  mfaMethod: "totp" | "sms" | null;
  phoneLast4: string | null;
  signedIn: boolean;
}

const ERROR_COPY: Record<string, string> = {
  code_invalid: "That code doesn't match. Check the email and try again.",
  code_expired: "That code has expired. Use Resend code for a new one.",
  code_not_issued: "We haven't sent a code yet. Use Resend code.",
  too_many_attempts: "Too many tries on that code. Use Resend code for a new one.",
  email_send_failed: "We couldn't send the code just now. Try Resend code in a moment.",
  email_missing: "We don't have a billing address on your signature to send a code to. Shane will set this up with you directly.",
  email_mismatch: "Your billing address changed after that code was sent. Use Resend code.",
  email_unverified: "Confirm the code from your email first.",
  email_in_use: "That address already has an engagement account. Sign in to it from your engagement page instead.",
  weak_password: "Twelve characters minimum, one capital, one number.",
  phone_invalid: "Enter the mobile number with its country code.",
  sms_send_failed: "We couldn't text that number. Check it and try again.",
  account_exists: "Your account is already set up.",
};

const ACCT_INPUT: React.CSSProperties = {
  width: "100%",
  background: "rgba(2,6,23,.7)",
  border: "1px solid rgba(51,65,85,.9)",
  borderRadius: 10,
  padding: "11px 13px",
  fontFamily: "inherit",
  fontSize: 13.5,
  color: "#f1f5f9",
  outline: "none",
  boxSizing: "border-box",
};

const markIcon = (ok: boolean) => (
  <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {ok ? <path d="M5 13l4 4L19 7" /> : <circle cx={12} cy={12} r={8} />}
  </svg>
);

/** `JBSWY3DPEHPK3PXP` → `JBSW Y3DP EHPK 3PXP`, the design's own presentation of the key. */
const groupKey = (secret: string) => secret.replace(/(.{4})(?=.)/g, "$1 ");

export function FreeScanAccountSetup({
  credential,
  onBusy,
  onComplete,
}: {
  credential: FreeScanCredential;
  /** The page's processing overlay label, or null to clear it. */
  onBusy: (label: string | null) => void;
  onComplete: () => void;
}) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [mfaMethod, setMfaMethod] = useState<"app" | "sms">("app");
  const [mfaCode, setMfaCode] = useState("");
  const [phone, setPhone] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [smsSentTo, setSmsSentTo] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoSent = useRef(false);

  const post = useCallback(
    async <T,>(path: string, body: Record<string, unknown> = {}): Promise<T> => {
      const res = await fetch(`/api/public/free-scan/account/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ...credential, ...body }),
      });
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) throw new Error(data?.error ?? `request_failed_${res.status}`);
      return data;
    },
    [credential],
  );

  const fail = (err: unknown, context: string) => {
    const code = err instanceof Error ? err.message : "";
    log.error({ err, code }, `free-scan account: ${context} failed`);
    setError(ERROR_COPY[code] ?? "Something went wrong. Please try again.");
  };

  const refresh = useCallback(async () => {
    const next = await post<StatusResponse>("status");
    setStatus(next);
    if (next.stage === "complete") onComplete();
    return next;
  }, [post, onComplete]);

  const sendCode = useCallback(async () => {
    setError(null);
    setCodeInput("");
    try {
      await post("send-code");
    } catch (err) {
      fail(err, "send code");
    }
  }, [post]);

  // Initial status, and the one automatic send the design implies ("We sent a code").
  useEffect(() => {
    void (async () => {
      try {
        const next = await refresh();
        if (next.stage === "code" && !next.codePending && !autoSent.current) {
          autoSent.current = true;
          await sendCode();
        }
      } catch (err) {
        fail(err, "status");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Entering the second-factor step on the app option fetches the real key.
  useEffect(() => {
    if (status?.stage !== "mfa" || mfaMethod !== "app" || secret) return;
    void (async () => {
      try {
        const data = await post<{ secret: string }>("mfa/totp/setup");
        setSecret(data.secret);
      } catch (err) {
        fail(err, "authenticator setup");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.stage, mfaMethod, secret, post]);

  if (!status || status.stage === "not_paid" || status.stage === "complete") return null;

  const isCode = status.stage === "code";
  const isPassword = status.stage === "password";
  const pwOk = pw1.length >= 12 && /[A-Z]/.test(pw1) && /[0-9]/.test(pw1) && pw1 === pw2;
  const phoneOk = phone.replace(/\D/g, "").length >= 8;
  const mfaOk = mfaMethod === "app" ? mfaCode.length === 6 && !!secret : smsSentTo ? smsCode.length === 6 : phoneOk;
  const ready = isCode ? codeInput.length === 6 : isPassword ? pwOk : mfaOk;
  const email = status.email ?? "the billing address on your signature";

  const verifyCode = async () => {
    if (codeInput.length !== 6) return;
    setError(null);
    onBusy("Checking your code");
    try {
      await post("verify-code", { code: codeInput });
      await refresh();
    } catch (err) {
      fail(err, "verify code");
    } finally {
      onBusy(null);
    }
  };

  const savePw = async () => {
    if (!pwOk) return;
    setError(null);
    try {
      await post("set-password", { password: pw1 });
      setPw1("");
      setPw2("");
      await refresh();
    } catch (err) {
      fail(err, "set password");
    }
  };

  const finishAccount = async () => {
    if (!mfaOk) return;
    setError(null);
    if (mfaMethod === "sms" && !smsSentTo) {
      try {
        const data = await post<{ phoneLast4: string }>("mfa/sms/setup", { phone });
        setSmsSentTo(data.phoneLast4);
      } catch (err) {
        fail(err, "SMS setup");
      }
      return;
    }
    onBusy("Signing you in");
    try {
      await post(mfaMethod === "app" ? "mfa/totp/verify" : "mfa/sms/verify", { code: mfaMethod === "app" ? mfaCode : smsCode });
      await refresh();
    } catch (err) {
      fail(err, "second factor");
    } finally {
      onBusy(null);
    }
  };

  const title = isCode ? "Check your email for a six-digit code" : isPassword ? "Set a password" : "Add a second factor";
  const body = isCode
    ? `Payment cleared and your scope is filed. We sent a code to ${email} — entering it creates the account your engagement lives in.`
    : isPassword
    ? "This is the password you will use to open your engagement. Twelve characters minimum, one capital, one number."
    : "Your tenant’s findings and signed scope sit behind this account, so a second factor is required rather than offered.";
  const cta = isCode ? "Verify and continue" : isPassword ? "Set password" : "Finish and sign in";
  const foot = isCode
    ? "The code expires in ten minutes."
    : isPassword
    ? "Stored hashed. Shane cannot read it."
    : "You will be signed in automatically — no second login.";
  const advance = isCode ? verifyCode : isPassword ? savePw : finishAccount;

  const pwRules = [
    { text: "At least 12 characters", ok: pw1.length >= 12 },
    { text: "One capital letter and one number", ok: /[A-Z]/.test(pw1) && /[0-9]/.test(pw1) },
    { text: "Both fields match", ok: pw1.length > 0 && pw1 === pw2 },
  ];

  const mfaOptions: Array<{ key: "app" | "sms"; name: string; desc: string }> = [
    { key: "app", name: "Authenticator app", desc: "Microsoft Authenticator, 1Password, or anything TOTP." },
    { key: "sms", name: "Text message", desc: "A code by SMS. Weaker, but better than nothing." },
  ];

  return (
    <div
      style={{ maxWidth: 520, margin: "0 auto", padding: "64px 32px 96px", display: "flex", flexDirection: "column", gap: 20 }}
      data-testid="freescan-account-setup"
      data-stage={status.stage}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#34d399" }}>
          Signed and paid · {isCode ? "step 1 of 3" : isPassword ? "step 2 of 3" : "step 3 of 3"}
        </span>
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(22px,2.7vw,29px)",
            fontWeight: 800,
            letterSpacing: "-.03em",
            lineHeight: 1.18,
            color: "#f8fafc",
            textWrap: "pretty" as React.CSSProperties["textWrap"],
          }}
        >
          {title}
        </h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "#94a3b8", textWrap: "pretty" as React.CSSProperties["textWrap"] }}>
          {body}
        </p>
      </div>

      <div
        style={{
          border: "1px solid rgba(30,41,59,.95)",
          borderRadius: 16,
          background: "#0b1524",
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {isCode ? (
          <>
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-label="Six-digit code"
              data-testid="freescan-account-code"
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "rgba(2,6,23,.7)",
                border: "1px solid rgba(51,65,85,.9)",
                borderRadius: 10,
                padding: 14,
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: ".42em",
                textAlign: "center",
                color: "#f1f5f9",
                outline: "none",
                fontFamily: "Menlo,Consolas,monospace",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, color: "#64748b" }}>Sent to {email}</span>
              <button
                type="button"
                onClick={() => void sendCode()}
                data-testid="freescan-account-resend"
                style={{ padding: 0, border: 0, background: "none", fontFamily: "inherit", fontSize: 11.5, fontWeight: 600, color: "#60a5fa", cursor: "pointer" }}
              >
                Resend code
              </button>
            </div>
          </>
        ) : null}

        {isPassword ? (
          <>
            <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="Choose a password" autoComplete="new-password" style={ACCT_INPUT} data-testid="freescan-account-pw1" />
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm password" autoComplete="new-password" style={ACCT_INPUT} data-testid="freescan-account-pw2" />
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {pwRules.map((r) => (
                <span key={r.text} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11.5, color: r.ok ? "#34d399" : "#64748b" }}>
                  <span style={{ display: "flex", flex: "none" }}>{markIcon(r.ok)}</span>
                  <span>{r.text}</span>
                </span>
              ))}
            </div>
          </>
        ) : null}

        {!isCode && !isPassword ? (
          <>
            {mfaOptions.map((m) => {
              const onSel = mfaMethod === m.key;
              return (
                <div
                  key={m.key}
                  role="radio"
                  aria-checked={onSel}
                  tabIndex={0}
                  onClick={() => {
                    setMfaMethod(m.key);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setMfaMethod(m.key);
                  }}
                  data-testid={`freescan-account-mfa-${m.key}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 11,
                    padding: "13px 14px",
                    borderRadius: 11,
                    cursor: "pointer",
                    border: `1px solid ${onSel ? "rgba(59,130,246,.5)" : "rgba(30,41,59,.9)"}`,
                    background: onSel ? "rgba(59,130,246,.07)" : "rgba(2,6,23,.4)",
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      flex: "none",
                      marginTop: 2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: `1px solid ${onSel ? "#3b82f6" : "rgba(71,85,105,.9)"}`,
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: onSel ? "#3b82f6" : "transparent" }} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "#f8fafc" }}>{m.name}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: "#94a3b8", lineHeight: 1.55, marginTop: 2 }}>{m.desc}</span>
                  </span>
                </div>
              );
            })}

            {mfaMethod === "app" ? (
              <>
                <div
                  style={{
                    border: "1px solid rgba(59,130,246,.28)",
                    borderRadius: 11,
                    background: "rgba(59,130,246,.06)",
                    padding: "13px 15px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 7,
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>Setup key</span>
                  <span
                    style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".16em", color: "#f1f5f9", fontFamily: "Menlo,Consolas,monospace" }}
                    data-testid="freescan-account-totp-secret"
                  >
                    {secret ? groupKey(secret) : "…"}
                  </span>
                  <span style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>
                    Scan or paste this into your authenticator, then enter the code it shows.
                  </span>
                </div>
                <input
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="Code from your app"
                  style={ACCT_INPUT}
                  data-testid="freescan-account-totp-code"
                />
              </>
            ) : (
              <>
                <input
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setSmsSentTo(null);
                    setSmsCode("");
                  }}
                  placeholder="Mobile number"
                  autoComplete="tel"
                  style={ACCT_INPUT}
                  data-testid="freescan-account-phone"
                />
                {smsSentTo ? (
                  <input
                    value={smsCode}
                    onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={`Code texted to the number ending ${smsSentTo}`}
                    style={ACCT_INPUT}
                    data-testid="freescan-account-sms-code"
                  />
                ) : null}
              </>
            )}
          </>
        ) : null}

        <button
          type="button"
          onClick={() => void advance()}
          disabled={!ready}
          data-testid="freescan-account-advance"
          style={{
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
          }}
        >
          {cta}
        </button>
        {error ? (
          <span style={{ fontSize: 12, lineHeight: 1.55, color: "#f87171", textAlign: "center" }} data-testid="freescan-account-error">
            {error}
          </span>
        ) : null}
        <span style={{ fontSize: 11, color: "#475569", lineHeight: 1.5, textAlign: "center" }}>{foot}</span>
      </div>
    </div>
  );
}
