import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";
import { startRegistration } from "@simplewebauthn/browser";

interface Enrollments {
  totp: boolean;
  sms: boolean;
  smsPhone: string | null;
  passkey: boolean;
  passkeyCount: number;
}

type Alert = { type: "success" | "error"; message: string } | null;

function AlertBox({ alert }: { alert: Alert }) {
  if (!alert) return null;
  return (
    <div className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm border mb-4 ${
      alert.type === "success"
        ? "bg-green-50 border-green-200 text-green-800"
        : "bg-red-50 border-red-200 text-red-700"
    }`}>
      <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        {alert.type === "success"
          ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          : <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3a9 9 0 110 18A9 9 0 0112 3z" />
        }
      </svg>
      <span>{alert.message}</span>
    </div>
  );
}

// ── TOTP Card ─────────────────────────────────────────────────────────────────

function TotpCard({ enrolled, onEnroll, onRemove }: {
  enrolled: boolean;
  onEnroll: () => void;
  onRemove: () => void;
}) {
  const [showSetup, setShowSetup] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<Alert>(null);
  const { fetchWithAuth } = useAuth();

  const startSetup = async () => {
    setLoading(true);
    setAlert(null);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/totp/setup", { method: "POST" });
      if (!res.ok) throw new Error("Failed to start TOTP setup");
      const data = await res.json() as { secret: string; qrDataUrl: string };
      setSecret(data.secret);
      setQrDataUrl(data.qrDataUrl);
      setShowSetup(true);
    } catch (err) {
      setAlert({ type: "error", message: err instanceof Error ? err.message : "Setup failed" });
    } finally {
      setLoading(false);
    }
  };

  const confirmSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAlert(null);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/totp/verify-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, code }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Verification failed");
      setShowSetup(false);
      setCode("");
      onEnroll();
    } catch (err) {
      setAlert({ type: "error", message: err instanceof Error ? err.message : "Verification failed" });
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm("Remove your authenticator app? You will no longer be prompted for a TOTP code on login.")) return;
    setLoading(true);
    try {
      await fetchWithAuth("/api/auth/mfa/totp", { method: "DELETE" });
      onRemove();
    } catch {
      setAlert({ type: "error", message: "Failed to remove TOTP" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
            <svg className="w-4.5 h-4.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#0A2540]">Authenticator App (TOTP)</h3>
            <p className="text-xs text-muted-foreground">Use Google Authenticator, Authy, or similar</p>
          </div>
        </div>
        {enrolled && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700 border border-green-200">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
            Active
          </span>
        )}
      </div>

      <div className="px-5 py-4">
        <AlertBox alert={alert} />

        {!showSetup ? (
          <div className="flex items-center gap-3">
            {enrolled ? (
              <>
                <p className="text-sm text-muted-foreground flex-1">Your authenticator app is linked. You're prompted for a code on every login.</p>
                <button
                  onClick={handleRemove}
                  disabled={loading}
                  className="text-xs font-semibold text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  Remove
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground flex-1">Not enrolled. Link your authenticator app to enable 6-digit codes on login.</p>
                <button
                  onClick={startSetup}
                  disabled={loading}
                  className="text-xs font-semibold text-[#0078D4] border border-[#0078D4] px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/5 transition-colors disabled:opacity-50"
                >
                  {loading ? "Loading…" : "Set up"}
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.</p>
            {qrDataUrl && (
              <div className="flex justify-center">
                <img src={qrDataUrl} alt="TOTP QR Code" className="w-44 h-44 rounded-xl border border-border" />
              </div>
            )}
            <p className="text-xs text-muted-foreground text-center">Can't scan? Enter manually: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">{secret}</code></p>
            <form onSubmit={(e) => void confirmSetup(e)} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">Verification Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] font-mono text-center tracking-widest"
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setShowSetup(false); setCode(""); }}
                  className="flex-1 text-sm font-medium text-muted-foreground border border-border px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || code.length < 6}
                  className="flex-1 text-sm font-semibold text-white bg-[#0078D4] px-4 py-2.5 rounded-xl hover:bg-[#0078D4]/90 transition-colors disabled:opacity-50"
                >
                  {loading ? "Verifying…" : "Confirm"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

// ── SMS Card ──────────────────────────────────────────────────────────────────

function SmsCard({ enrolled, enrolledPhone, onEnroll, onRemove }: {
  enrolled: boolean;
  enrolledPhone: string | null;
  onEnroll: () => void;
  onRemove: () => void;
}) {
  const [step, setStep] = useState<"idle" | "enter-phone" | "verify">("idle");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<Alert>(null);
  const [phoneLast4, setPhoneLast4] = useState("");
  const { fetchWithAuth } = useAuth();

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAlert(null);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/sms/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; phoneLast4?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to send code");
      setPhoneLast4(data.phoneLast4 ?? phone.slice(-4));
      setStep("verify");
    } catch (err) {
      setAlert({ type: "error", message: err instanceof Error ? err.message : "Failed to send code" });
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAlert(null);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/sms/verify-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Invalid code");
      setStep("idle");
      setCode("");
      setPhone("");
      onEnroll();
    } catch (err) {
      setAlert({ type: "error", message: err instanceof Error ? err.message : "Invalid code" });
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm("Remove SMS verification? You will no longer be sent a code on login.")) return;
    setLoading(true);
    try {
      await fetchWithAuth("/api/auth/mfa/sms", { method: "DELETE" });
      onRemove();
    } catch {
      setAlert({ type: "error", message: "Failed to remove SMS" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
            <svg className="w-4.5 h-4.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#0A2540]">SMS One-Time Code</h3>
            <p className="text-xs text-muted-foreground">Receive a code by text message on login</p>
          </div>
        </div>
        {enrolled && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700 border border-green-200">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
            Active
          </span>
        )}
      </div>

      <div className="px-5 py-4">
        <AlertBox alert={alert} />

        {step === "idle" && (
          <div className="flex items-center gap-3">
            {enrolled ? (
              <>
                <p className="text-sm text-muted-foreground flex-1">
                  Texts sent to number ending in ···{enrolledPhone?.slice(-4) ?? "????"}
                </p>
                <button
                  onClick={handleRemove}
                  disabled={loading}
                  className="text-xs font-semibold text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  Remove
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground flex-1">Not enrolled. Add a phone number to receive OTP codes via text.</p>
                <button
                  onClick={() => setStep("enter-phone")}
                  className="text-xs font-semibold text-[#0078D4] border border-[#0078D4] px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/5 transition-colors"
                >
                  Set up
                </button>
              </>
            )}
          </div>
        )}

        {step === "enter-phone" && (
          <form onSubmit={(e) => void sendCode(e)} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+1 555 000 0000"
                className="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4]"
                autoFocus
              />
              <p className="mt-1 text-xs text-muted-foreground">Include country code (e.g. +1 for US)</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep("idle")}
                className="flex-1 text-sm font-medium text-muted-foreground border border-border px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !phone.trim()}
                className="flex-1 text-sm font-semibold text-white bg-[#0078D4] px-4 py-2.5 rounded-xl hover:bg-[#0078D4]/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Sending…" : "Send Code"}
              </button>
            </div>
          </form>
        )}

        {step === "verify" && (
          <form onSubmit={(e) => void verifyCode(e)} className="space-y-3">
            <p className="text-sm text-muted-foreground">We sent a 6-digit code to the number ending in ···{phoneLast4}. Enter it below to confirm.</p>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">Verification Code</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] font-mono text-center tracking-widest"
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setStep("idle"); setCode(""); }}
                className="flex-1 text-sm font-medium text-muted-foreground border border-border px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || code.length < 6}
                className="flex-1 text-sm font-semibold text-white bg-[#0078D4] px-4 py-2.5 rounded-xl hover:bg-[#0078D4]/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Verifying…" : "Confirm"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Passkey Card ──────────────────────────────────────────────────────────────

function PasskeyCard({ enrolled, passkeyCount, onEnroll, onRemove }: {
  enrolled: boolean;
  passkeyCount: number;
  onEnroll: () => void;
  onRemove: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<Alert>(null);
  const { fetchWithAuth } = useAuth();

  const handleEnroll = async () => {
    setLoading(true);
    setAlert(null);
    try {
      const optRes = await fetchWithAuth("/api/auth/mfa/passkey/registration-options", { method: "POST" });
      if (!optRes.ok) throw new Error("Failed to get registration options");
      const options = await optRes.json();

      const attResp = await startRegistration({ optionsJSON: options });

      const verRes = await fetchWithAuth("/api/auth/mfa/passkey/verify-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attResp),
      });
      const verData = await verRes.json() as { ok?: boolean; error?: string };
      if (!verRes.ok || !verData.ok) throw new Error(verData.error ?? "Registration failed");

      setAlert({ type: "success", message: "Passkey registered successfully!" });
      onEnroll();
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setAlert({ type: "error", message: "Passkey registration was cancelled." });
      } else {
        setAlert({ type: "error", message: err instanceof Error ? err.message : "Registration failed" });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm(`Remove all ${passkeyCount} passkey(s)? You will need to re-enroll to use passkeys again.`)) return;
    setLoading(true);
    try {
      await fetchWithAuth("/api/auth/mfa/passkey", { method: "DELETE" });
      onRemove();
    } catch {
      setAlert({ type: "error", message: "Failed to remove passkeys" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
            <svg className="w-4.5 h-4.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#0A2540]">Passkey (Biometric / Hardware Key)</h3>
            <p className="text-xs text-muted-foreground">Fingerprint, Face ID, or security key — no code needed</p>
          </div>
        </div>
        {enrolled && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700 border border-green-200">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
            {passkeyCount} key{passkeyCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="px-5 py-4">
        <AlertBox alert={alert} />

        <div className="flex items-start gap-3">
          {enrolled ? (
            <>
              <p className="text-sm text-muted-foreground flex-1">
                You have {passkeyCount} passkey{passkeyCount !== 1 ? "s" : ""} registered. Used for passwordless second-factor on login.
              </p>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={handleEnroll}
                  disabled={loading}
                  className="text-xs font-semibold text-[#0078D4] border border-[#0078D4] px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/5 transition-colors disabled:opacity-50"
                >
                  Add another
                </button>
                <button
                  onClick={handleRemove}
                  disabled={loading}
                  className="text-xs font-semibold text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  Remove all
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground flex-1">Not enrolled. Register a passkey to use biometrics or a hardware key on login.</p>
              <button
                onClick={handleEnroll}
                disabled={loading}
                className="text-xs font-semibold text-[#0078D4] border border-[#0078D4] px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/5 transition-colors disabled:opacity-50"
              >
                {loading ? "Setting up…" : "Set up"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortalSecurity() {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [enrollments, setEnrollments] = useState<Enrollments>({
    totp: false,
    sms: false,
    smsPhone: null,
    passkey: false,
    passkeyCount: 0,
  });

  const fetchEnrollments = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/auth/mfa/enrollments");
      if (res.ok) {
        const data = await res.json() as Enrollments;
        setEnrollments(data);
      }
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void fetchEnrollments();
  }, [fetchEnrollments]);

  return (
    <PortalLayout>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-7">
          <h1 className="text-2xl font-bold text-[#0A2540]">Account Security</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Set up an additional second factor. Once enabled, you will be prompted after entering your password.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            <TotpCard
              enrolled={enrollments.totp}
              onEnroll={() => void fetchEnrollments()}
              onRemove={() => void fetchEnrollments()}
            />
            <SmsCard
              enrolled={enrollments.sms}
              enrolledPhone={enrollments.smsPhone}
              onEnroll={() => void fetchEnrollments()}
              onRemove={() => void fetchEnrollments()}
            />
            <PasskeyCard
              enrolled={enrollments.passkey}
              passkeyCount={enrollments.passkeyCount}
              onEnroll={() => void fetchEnrollments()}
              onRemove={() => void fetchEnrollments()}
            />

            {(enrollments.totp || enrollments.sms || enrollments.passkey) && (
              <div className="bg-[#0078D4]/5 border border-[#0078D4]/20 rounded-2xl px-5 py-4">
                <p className="text-xs text-[#0078D4] font-semibold">
                  MFA is active on your account. You will be asked for a second factor each time you sign in.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
