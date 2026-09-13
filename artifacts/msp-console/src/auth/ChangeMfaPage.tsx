import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { startRegistration } from "@simplewebauthn/browser";
import { useAuth } from "@/contexts/AuthContext";
import { AuthLayout, FieldLabel, TextField, PrimaryButton, GhostButton, InlineMessage } from "./AuthLayout";
import { AuthApiError } from "./authApi";
import { border, signal, text } from "@/console/tokens";

interface Enrollments {
  totp: boolean;
  sms: boolean;
  smsPhone: string | null;
  passkey: boolean;
  passkeyCount: number;
  gateRequired: boolean;
}

type Alert = { tone: "ok" | "critical" | "warning"; text: string } | null;

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new AuthApiError(res.status, data as Record<string, unknown>);
  return data;
}

/**
 * Self-service "change MFA" — screen 38's own turf. Resetting someone ELSE's
 * MFA (the design's "OPERATOR SIDE — POST /auth/mfa/admin/reset/:userId"
 * block) is screen 39, Account Security, already wired in
 * `console/modules/AccountSecurity.tsx` via `msp-settings.ts`'s own wrapper —
 * deliberately not duplicated here.
 */
export default function ChangeMfaPage() {
  const { accessToken, isLoading: sessionLoading, fetchWithAuth } = useAuth();
  const [, setLocation] = useLocation();

  const [loading, setLoading] = useState(true);
  const [enrollments, setEnrollments] = useState<Enrollments | null>(null);
  const [alert, setAlert] = useState<Alert>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [setup, setSetup] = useState<"totp" | "sms" | null>(null);
  const [totpData, setTotpData] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/auth/mfa/enrollments");
      const data = await readJson<Enrollments>(res);
      setEnrollments(data);
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 403) {
        setAlert({ tone: "critical", text: "This session hasn't finished MFA enrollment yet, or has expired. Sign in again." });
      } else {
        setAlert({ tone: "critical", text: "Could not load your two-factor status." });
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    if (sessionLoading) return;
    if (!accessToken) { setLocation("/login"); return; }
    // Admin-only gate (rejectIfAdmin in mfa.ts) reads role off the token, not
    // this endpoint — decode the same JWT payload the console already trusts
    // for its own expiry timer (AuthContext), rather than guessing.
    try {
      const payload = JSON.parse(atob(accessToken.split(".")[1])) as { role?: string };
      setIsAdmin(payload.role === "admin");
    } catch { /* ignore malformed token */ }
    void fetchStatus();
  }, [accessToken, sessionLoading, setLocation, fetchStatus]);

  if (sessionLoading || loading) {
    return (
      <AuthLayout caption="Security settings">
        <span style={{ fontSize: 12.5, color: text.muted }}>Loading…</span>
      </AuthLayout>
    );
  }

  const enrolledCount = enrollments ? Number(enrollments.totp) + Number(enrollments.sms) + Number(enrollments.passkey) : 0;
  const nothingEnrolledAndRequired = !!enrollments && enrolledCount === 0 && enrollments.gateRequired;

  async function startTotp() {
    setAlert(null);
    setBusy(true);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/totp/setup", { method: "POST" });
      const data = await readJson<{ secret: string; otpauth: string; qrDataUrl: string }>(res);
      setTotpData(data);
      setSetup("totp");
      setCode("");
    } catch {
      setAlert({ tone: "critical", text: "Failed to start authenticator setup." });
    } finally {
      setBusy(false);
    }
  }

  async function verifyTotp() {
    if (!totpData) return;
    setAlert(null);
    setBusy(true);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/totp/verify-setup", {
        method: "POST",
        body: JSON.stringify({ secret: totpData.secret, code }),
      });
      await readJson(res);
      setAlert({ tone: "ok", text: "Authenticator app is now active." });
      setSetup(null);
      setTotpData(null);
      setCode("");
      await fetchStatus();
    } catch (err) {
      setAlert({ tone: "critical", text: err instanceof AuthApiError ? err.message : "Invalid verification code. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function removeTotp() {
    setBusy(true);
    try {
      await fetchWithAuth("/api/auth/mfa/totp", { method: "DELETE" });
      setAlert({ tone: "warning", text: "Authenticator app removed. No re-authentication was required to do it." });
      await fetchStatus();
    } finally {
      setBusy(false);
    }
  }

  function startSms() {
    setSetup("sms");
    setPhone("");
    setCode("");
    setAlert(null);
  }

  async function sendSmsCode() {
    setAlert(null);
    setBusy(true);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/sms/setup", {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      const data = await readJson<{ phoneLast4: string }>(res);
      setAlert({ tone: "ok", text: `Code sent to •••• ${data.phoneLast4}.` });
    } catch (err) {
      setAlert({ tone: "critical", text: err instanceof AuthApiError ? err.message : "Failed to send the code." });
    } finally {
      setBusy(false);
    }
  }

  async function verifySms() {
    setAlert(null);
    setBusy(true);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/sms/verify-setup", {
        method: "POST",
        body: JSON.stringify({ phone, code }),
      });
      await readJson(res);
      setAlert({ tone: "ok", text: "Text-message codes are now active." });
      setSetup(null);
      setCode("");
      await fetchStatus();
    } catch (err) {
      setAlert({ tone: "critical", text: err instanceof AuthApiError ? err.message : "Invalid or expired code." });
    } finally {
      setBusy(false);
    }
  }

  async function removeSms() {
    setBusy(true);
    try {
      await fetchWithAuth("/api/auth/mfa/sms", { method: "DELETE" });
      setAlert({ tone: "warning", text: "Enrollment removed. No re-authentication was required to do it." });
      await fetchStatus();
    } finally {
      setBusy(false);
    }
  }

  async function addPasskey() {
    setAlert(null);
    setBusy(true);
    try {
      const path = isAdmin ? "/api/auth/mfa/passkey/admin-registration-options" : "/api/auth/mfa/passkey/registration-options";
      const optRes = await fetchWithAuth(path, { method: "POST" });
      const options = await readJson<unknown>(optRes);
      const attResp = await startRegistration({ optionsJSON: options as never });
      const verRes = await fetchWithAuth("/api/auth/mfa/passkey/verify-registration", {
        method: "POST",
        body: JSON.stringify(attResp),
      });
      await readJson(verRes);
      setAlert({ tone: "ok", text: "Passkey added." });
      await fetchStatus();
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setAlert({ tone: "warning", text: "Passkey registration was cancelled." });
      } else {
        setAlert({ tone: "critical", text: err instanceof AuthApiError ? err.message : "Registration failed." });
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeAllPasskeys() {
    setBusy(true);
    try {
      await fetchWithAuth("/api/auth/mfa/passkey", { method: "DELETE" });
      setAlert({ tone: "warning", text: "Every registered credential for this account was deleted — the route cannot target just one." });
      await fetchStatus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout caption="Security settings">
      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.02em", color: text.strong }}>Two-factor methods</span>
        <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>
          {enrollments && enrolledCount > 0
            ? `${enrolledCount} of 3 methods active. Any one of them completes a challenge; there is no primary method.`
            : nothingEnrolledAndRequired
              ? "Nothing is enrolled and this account requires MFA, so the console stays locked until one method is active."
              : "Nothing is enrolled. Set up at least one method below."}
        </span>
      </span>

      {alert && <InlineMessage tone={alert.tone} text={alert.text} />}

      {/* Authenticator app */}
      <MethodCard
        title="Authenticator app (TOTP)"
        detail={enrollments?.totp ? "Enrolled. The secret is never returned once stored." : "Not enrolled. Works for both operator and client accounts."}
        active={!!enrollments?.totp}
      >
        {setup === "totp" && totpData ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <img src={totpData.qrDataUrl} alt="TOTP QR code" style={{ width: 140, height: 140, borderRadius: 8, border: `1px solid ${border.card}` }} />
            </div>
            <span style={{ fontSize: 11, color: text.label, wordBreak: "break-all" }}>Manual secret: {totpData.secret}</span>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <FieldLabel>6-digit code from the app</FieldLabel>
              <TextField value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" style={{ fontFamily: "Menlo, monospace", letterSpacing: ".22em" }} />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <PrimaryButton onClick={() => void verifyTotp()} disabled={busy || code.length < 6}>Verify and enrol</PrimaryButton>
              <GhostButton onClick={() => { setSetup(null); setTotpData(null); }}>Cancel</GhostButton>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            {enrollments?.totp ? (
              <GhostButton onClick={() => void removeTotp()} disabled={busy}>Remove</GhostButton>
            ) : (
              <PrimaryButton onClick={() => void startTotp()} disabled={busy}>Set up</PrimaryButton>
            )}
          </div>
        )}
      </MethodCard>

      {/* SMS */}
      <MethodCard
        title="Text message"
        detail={
          enrollments?.sms
            ? `Enrolled on a number ending ${enrollments.smsPhone?.slice(-4) ?? "····"}.`
            : isAdmin
              ? "Blocked for admin accounts — the route refuses it at setup."
              : "Not enrolled. 6-digit codes, 10-minute lifetime."
        }
        active={!!enrollments?.sms}
      >
        {setup === "sms" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <FieldLabel>Mobile number</FieldLabel>
              <TextField value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0142" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <FieldLabel>Code we texted</FieldLabel>
              <TextField value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" style={{ fontFamily: "Menlo, monospace", letterSpacing: ".22em" }} />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <GhostButton onClick={() => void sendSmsCode()} disabled={busy || !phone}>Send code</GhostButton>
              <PrimaryButton onClick={() => void verifySms()} disabled={busy || code.length < 6}>Verify and enrol</PrimaryButton>
              <GhostButton onClick={() => setSetup(null)}>Cancel</GhostButton>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            {enrollments?.sms ? (
              <GhostButton onClick={() => void removeSms()} disabled={busy}>Remove</GhostButton>
            ) : (
              <PrimaryButton onClick={startSms} disabled={busy || isAdmin}>Set up</PrimaryButton>
            )}
          </div>
        )}
      </MethodCard>

      {/* Passkey */}
      <MethodCard
        title="Passkey or security key"
        detail={
          enrollments && enrollments.passkeyCount > 0
            ? `${enrollments.passkeyCount} credential${enrollments.passkeyCount === 1 ? "" : "s"} registered. No per-key detail is available.`
            : "Not enrolled." + (isAdmin ? " Required for admin accounts." : "")
        }
        active={!!enrollments?.passkey}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <PrimaryButton onClick={() => void addPasskey()} disabled={busy}>Add a passkey</PrimaryButton>
          {enrollments && enrollments.passkeyCount > 0 && (
            <GhostButton onClick={() => void removeAllPasskeys()} disabled={busy}>Remove all</GhostButton>
          )}
        </div>
      </MethodCard>

      <button
        type="button"
        onClick={() => setLocation("/tenants")}
        style={{ background: "none", border: "none", padding: 0, color: "#60a5fa", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", alignSelf: "flex-start" }}
      >
        ← Back to the console
      </button>
    </AuthLayout>
  );
}

function MethodCard({ title, detail, active, children }: { title: string; detail: string; active: boolean; children: React.ReactNode }) {
  const tone = active ? signal.ok : signal.neutral;
  return (
    <div style={{ border: `1px solid ${active ? "rgba(52,211,153,.18)" : border.card}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 13, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 170, flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: text.strong }}>{title}</span>
          <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{detail}</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, background: tone.tint, border: `1px solid ${tone.border}`, fontSize: 10.5, fontWeight: 600, color: tone.strong, whiteSpace: "nowrap" }}>
          {active ? "Active" : "Off"}
        </span>
      </div>
      {children}
    </div>
  );
}
