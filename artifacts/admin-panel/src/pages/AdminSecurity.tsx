import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { startRegistration } from "@simplewebauthn/browser";

type Alert = { type: "success" | "error"; message: string } | null;

function AlertBox({ alert }: { alert: Alert }) {
  if (!alert) return null;
  return (
    <div className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm border mb-4 ${
      alert.type === "success"
        ? "bg-green-500/10 border-green-500/20 text-green-400"
        : "bg-red-500/10 border-red-500/20 text-red-400"
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

interface SecurityStatus {
  passkeyCount: number;
  totpEnrolled: boolean;
}

interface TotpSetupData {
  secret: string;
  qrDataUrl: string;
}

export default function AdminSecurity() {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [alert, setAlert] = useState<Alert>(null);
  const [status, setStatus] = useState<SecurityStatus>({ passkeyCount: 0, totpEnrolled: false });

  // TOTP setup state
  const [totpSetup, setTotpSetup] = useState<TotpSetupData | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpLoading, setTotpLoading] = useState(false);
  const [totpRemoving, setTotpRemoving] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/auth/mfa/enrollments");
      if (res.ok) {
        const data = await res.json() as { passkeyCount: number; totp?: boolean };
        setStatus({ passkeyCount: data.passkeyCount, totpEnrolled: data.totp ?? false });
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleEnrollPasskey = async () => {
    setEnrolling(true);
    setAlert(null);
    try {
      const optRes = await fetchWithAuth("/api/auth/mfa/passkey/admin-registration-options", { method: "POST" });
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

      setAlert({ type: "success", message: "Passkey registered! You will be prompted to use it on next login." });
      await fetchStatus();
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setAlert({ type: "error", message: "Passkey registration was cancelled." });
      } else {
        setAlert({ type: "error", message: err instanceof Error ? err.message : "Registration failed" });
      }
    } finally {
      setEnrolling(false);
    }
  };

  const handleRemovePasskey = async () => {
    if (!confirm(`Remove all ${status.passkeyCount} admin passkey(s)?`)) return;
    setRemoving(true);
    setAlert(null);
    try {
      await fetchWithAuth("/api/auth/mfa/passkey", { method: "DELETE" });
      setAlert({ type: "success", message: "All passkeys removed." });
      await fetchStatus();
    } catch {
      setAlert({ type: "error", message: "Failed to remove passkeys." });
    } finally {
      setRemoving(false);
    }
  };

  const handleTotpSetup = async () => {
    setTotpLoading(true);
    setAlert(null);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/totp/setup", { method: "POST" });
      if (!res.ok) throw new Error("Failed to start authenticator setup");
      const data = await res.json() as { secret: string; qrDataUrl: string };
      setTotpSetup({ secret: data.secret, qrDataUrl: data.qrDataUrl });
      setTotpCode("");
    } catch (err) {
      setAlert({ type: "error", message: err instanceof Error ? err.message : "Setup failed" });
    } finally {
      setTotpLoading(false);
    }
  };

  const handleTotpVerify = async () => {
    if (!totpSetup || totpCode.length < 6) return;
    setTotpLoading(true);
    setAlert(null);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/totp/verify-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: totpSetup.secret, code: totpCode }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Verification failed");
      setAlert({ type: "success", message: "Authenticator app enrolled! Use it as a second factor on next login." });
      setTotpSetup(null);
      setTotpCode("");
      await fetchStatus();
    } catch (err) {
      setAlert({ type: "error", message: err instanceof Error ? err.message : "Verification failed" });
    } finally {
      setTotpLoading(false);
    }
  };

  const handleTotpRemove = async () => {
    if (!confirm("Remove authenticator app enrollment?")) return;
    setTotpRemoving(true);
    setAlert(null);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/totp", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove authenticator app");
      setAlert({ type: "success", message: "Authenticator app removed." });
      setTotpSetup(null);
      setTotpCode("");
      await fetchStatus();
    } catch (err) {
      setAlert({ type: "error", message: err instanceof Error ? err.message : "Removal failed" });
    } finally {
      setTotpRemoving(false);
    }
  };

  return (
    <>
      <div className="max-w-lg mx-auto py-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-[#E6EDF3]">Admin Security</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage second factors for your admin login — passkeys, biometrics, or an authenticator app.
          </p>
        </div>

        <AlertBox alert={alert} />

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="space-y-4">
            {/* Passkey card */}
            <div className="bg-[#161B22] rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
                    <svg className="w-4.5 h-4.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#E6EDF3]">Passkey (Biometric / Hardware Key)</h3>
                    <p className="text-xs text-muted-foreground">Fingerprint, Face ID, or security key</p>
                  </div>
                </div>
                {status.passkeyCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                    {status.passkeyCount} key{status.passkeyCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <div className="px-5 py-4">
                {status.passkeyCount === 0 ? (
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-muted-foreground flex-1">No passkeys registered. Enroll one to add a second factor to your admin login.</p>
                    <button
                      onClick={() => void handleEnrollPasskey()}
                      disabled={enrolling}
                      className="text-xs font-semibold text-[#0078D4] border border-[#0078D4] px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/5 transition-colors disabled:opacity-50"
                    >
                      {enrolling ? "Setting up…" : "Enroll Passkey"}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-muted-foreground flex-1">
                      You have {status.passkeyCount} passkey{status.passkeyCount !== 1 ? "s" : ""} registered. You are prompted after password entry on each login.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleEnrollPasskey()}
                        disabled={enrolling}
                        className="text-xs font-semibold text-[#0078D4] border border-[#0078D4] px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/5 transition-colors disabled:opacity-50"
                      >
                        {enrolling ? "Setting up…" : "Add another"}
                      </button>
                      <button
                        onClick={() => void handleRemovePasskey()}
                        disabled={removing}
                        className="text-xs font-semibold text-red-400 border border-red-500/20 px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
                      >
                        {removing ? "Removing…" : "Remove all"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Authenticator App (TOTP) card */}
            <div className="bg-[#161B22] rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
                    <svg className="w-4.5 h-4.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#E6EDF3]">Authenticator App</h3>
                    <p className="text-xs text-muted-foreground">Google Authenticator, Authy, or any TOTP app</p>
                  </div>
                </div>
                {status.totpEnrolled && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                    Active
                  </span>
                )}
              </div>

              <div className="px-5 py-4">
                {status.totpEnrolled ? (
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-muted-foreground flex-1">
                      An authenticator app is enrolled. You will be prompted for a 6-digit code on login.
                    </p>
                    <button
                      onClick={() => void handleTotpRemove()}
                      disabled={totpRemoving}
                      className="text-xs font-semibold text-red-400 border border-red-500/20 px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    >
                      {totpRemoving ? "Removing…" : "Remove"}
                    </button>
                  </div>
                ) : totpSetup ? (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.
                    </p>
                    <div className="flex justify-center">
                      <img src={totpSetup.qrDataUrl} alt="TOTP QR code" className="w-44 h-44 rounded-lg border border-border" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#8B949E] mb-1.5 uppercase tracking-wide">
                        6-digit verification code
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={totpCode}
                        onChange={e => setTotpCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="000000"
                        autoFocus
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4] transition font-mono text-center tracking-widest"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleTotpVerify()}
                        disabled={totpLoading || totpCode.length < 6}
                        className="flex-1 bg-[#0078D4] text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[#006CBE] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {totpLoading ? "Verifying…" : "Confirm enrollment"}
                      </button>
                      <button
                        onClick={() => { setTotpSetup(null); setTotpCode(""); }}
                        className="text-xs font-semibold text-[#8B949E] border border-border px-3 py-2 rounded-lg hover:bg-[#0D1117] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-muted-foreground flex-1">
                      No authenticator app enrolled. Set one up to use a TOTP code as a second factor.
                    </p>
                    <button
                      onClick={() => void handleTotpSetup()}
                      disabled={totpLoading}
                      className="text-xs font-semibold text-[#0078D4] border border-[#0078D4] px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/5 transition-colors disabled:opacity-50"
                    >
                      {totpLoading ? "Loading…" : "Set up authenticator"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="bg-[#1C2128] border border-border rounded-2xl px-5 py-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#E6EDF3] mb-2">How it works</h4>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-[#0078D4] font-bold mt-0.5">1.</span>
              Enter your email and password as usual.
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0078D4] font-bold mt-0.5">2.</span>
              If a passkey or authenticator app is enrolled, you will be prompted for a second factor.
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0078D4] font-bold mt-0.5">3.</span>
              On success, you are logged in. No second factor enrolled = no extra step.
            </li>
          </ul>
        </div>
      </div>
    </>
  );
}
