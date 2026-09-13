import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { startAuthentication } from "@simplewebauthn/browser";
import { useAuth } from "@/contexts/AuthContext";
import { AuthLayout, FieldLabel, TextField, PrimaryButton, GhostButton, InlineMessage } from "./AuthLayout";
import { mfaVerify, mfaBypass, mfaSmsSend, passkeyAuthenticationOptions, passkeyVerifyAuthentication, AuthApiError, type SessionResult } from "./authApi";
import { readMfaChallenge, clearMfaChallenge } from "./SignInPage";
import { text } from "@/console/tokens";

type Method = "totp" | "sms" | "passkey" | "bypass";

const METHOD_LABEL: Record<Method, string> = {
  totp: "Authenticator",
  sms: "Text message",
  passkey: "Passkey",
  bypass: "Emergency code",
};

function afterSession(result: SessionResult, setSession: (t: string) => void, setLocation: (p: string) => void) {
  clearMfaChallenge();
  setSession(result.accessToken);
  setLocation(result.user.mfaSetupPending ? "/account/mfa" : "/tenants");
}

export default function TwoFactorPage() {
  const { setSession } = useAuth();
  const [, setLocation] = useLocation();
  const [challenge] = useState(() => readMfaChallenge());

  const [method, setMethod] = useState<Method>(() => {
    const c = readMfaChallenge();
    return (c?.methods.includes("passkey") ? "passkey" : (c?.methods[0] as Method)) ?? "totp";
  });
  const [code, setCode] = useState("");
  const [smsSent, setSmsSent] = useState(false);
  const [smsMask, setSmsMask] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; text: string } | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!challenge) setLocation("/login");
  }, [challenge, setLocation]);

  if (!challenge) return null;

  const tabs: Method[] = [...challenge.methods.filter((m): m is Method => m === "totp" || m === "sms" || m === "passkey"), "bypass"];

  function handleAuthError(err: unknown) {
    if (err instanceof AuthApiError) {
      if (err.status === 401 && err.message.toLowerCase().includes("expired mfa session")) {
        setExpired(true);
        clearMfaChallenge();
        setError({ code: "401 · MFA session expired", text: err.message });
        return;
      }
      if (err.status === 403) {
        setError({ code: "403 · passkey only", text: err.message });
        setMethod("passkey");
        return;
      }
      setError({ code: `${err.status}`, text: err.message });
    } else {
      setError({ code: "Network error", text: "Could not reach the server. Try again." });
    }
  }

  async function submitCode() {
    if (!challenge) return;
    setError(null);
    setLoading(true);
    try {
      const result = method === "bypass"
        ? await mfaBypass(challenge.mfaToken, code)
        : await mfaVerify(challenge.mfaToken, method as "totp" | "sms", code);
      afterSession(result, setSession, setLocation);
    } catch (err) {
      handleAuthError(err);
    } finally {
      setLoading(false);
    }
  }

  async function sendSms() {
    if (!challenge) return;
    setError(null);
    setLoading(true);
    try {
      const res = await mfaSmsSend(challenge.mfaToken);
      setSmsSent(true);
      setSmsMask(res.phoneLast4);
    } catch (err) {
      handleAuthError(err);
    } finally {
      setLoading(false);
    }
  }

  async function submitPasskey() {
    if (!challenge) return;
    setError(null);
    setLoading(true);
    try {
      const options = await passkeyAuthenticationOptions(challenge.mfaToken);
      const authResp = await startAuthentication({ optionsJSON: options as never });
      const result = await passkeyVerifyAuthentication(challenge.mfaToken, authResp as unknown as Record<string, unknown>);
      afterSession(result, setSession, setLocation);
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError({ code: "Cancelled", text: "Passkey authentication was cancelled." });
      } else {
        handleAuthError(err);
      }
    } finally {
      setLoading(false);
    }
  }

  const needsCode = method !== "passkey";
  const codeLabel = method === "bypass" ? "Emergency bypass code" : "6-digit code";
  const codePlaceholder = method === "bypass" ? "XXXX-XXXX" : "000000";
  const cta = method === "passkey" ? "Use your passkey" : "Verify";

  return (
    <AuthLayout caption="Verification step">
      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.02em", color: text.strong }}>Two-factor required</span>
        <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>
          Your password was accepted. The 10-minute verification token is the only thing you hold until this step passes.
        </span>
      </span>

      {tabs.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {tabs.map((m) => {
            const on = method === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => { setMethod(m); setCode(""); setError(null); setSmsSent(false); }}
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
                  height: 28, padding: "0 10px", borderRadius: 7,
                  border: `1px solid ${on ? "rgba(96,165,250,.45)" : "rgba(148,163,184,.16)"}`,
                  background: on ? "rgba(37,99,235,.18)" : "rgba(148,163,184,.06)",
                  color: on ? text.strong : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {METHOD_LABEL[m]}
              </button>
            );
          })}
        </div>
      )}

      {method === "sms" && !smsSent && (
        <GhostButton onClick={() => void sendSms()} disabled={loading}>
          {loading ? "Sending…" : "Send a code by text message"}
        </GhostButton>
      )}
      {method === "sms" && smsSent && smsMask && (
        <span style={{ fontSize: 11.5, color: text.muted }}>Code sent to •••• {smsMask}.</span>
      )}

      {needsCode && (
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <FieldLabel>{codeLabel}</FieldLabel>
          <TextField
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={codePlaceholder}
            autoFocus
            style={{ height: 40, fontSize: 16, letterSpacing: ".22em", fontFamily: "Menlo, monospace" }}
          />
        </label>
      )}

      {error && <InlineMessage tone="critical" code={error.code} text={error.text} />}

      {expired ? (
        <PrimaryButton onClick={() => setLocation("/login")}>Back to sign in</PrimaryButton>
      ) : method === "passkey" ? (
        <PrimaryButton onClick={() => void submitPasskey()} disabled={loading}>
          {loading ? "Waiting…" : cta}
        </PrimaryButton>
      ) : (
        <PrimaryButton onClick={() => void submitCode()} disabled={loading || code.trim().length === 0}>
          {loading ? "Verifying…" : cta}
        </PrimaryButton>
      )}

      <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>
        20 attempts per IP per 15 minutes across every verify route.
      </span>
    </AuthLayout>
  );
}
