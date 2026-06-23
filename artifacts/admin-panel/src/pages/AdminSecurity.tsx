import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import DashboardShell from "@/components/DashboardShell";
import { startRegistration } from "@simplewebauthn/browser";

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

interface PasskeyStatus {
  count: number;
}

export default function AdminSecurity() {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [alert, setAlert] = useState<Alert>(null);
  const [status, setStatus] = useState<PasskeyStatus>({ count: 0 });

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/auth/mfa/enrollments");
      if (res.ok) {
        const data = await res.json() as { passkeyCount: number };
        setStatus({ count: data.passkeyCount });
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

  const handleEnroll = async () => {
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

  const handleRemove = async () => {
    if (!confirm(`Remove all ${status.count} admin passkey(s)?`)) return;
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

  return (
    <DashboardShell>
      <div className="max-w-lg mx-auto py-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-[#0A2540]">Admin Security</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Register a passkey (biometric or hardware key) for a second factor on admin login.
          </p>
        </div>

        <AlertBox alert={alert} />

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
            Loading…
          </div>
        ) : (
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
                  <p className="text-xs text-muted-foreground">Fingerprint, Face ID, or security key</p>
                </div>
              </div>
              {status.count > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700 border border-green-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  {status.count} key{status.count !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="px-5 py-4">
              {status.count === 0 ? (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-muted-foreground flex-1">No passkeys registered. Enroll one to add a second factor to your admin login.</p>
                  <button
                    onClick={() => void handleEnroll()}
                    disabled={enrolling}
                    className="text-xs font-semibold text-[#0078D4] border border-[#0078D4] px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/5 transition-colors disabled:opacity-50"
                  >
                    {enrolling ? "Setting up…" : "Enroll Passkey"}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-muted-foreground flex-1">
                    You have {status.count} passkey{status.count !== 1 ? "s" : ""} registered. You are prompted after password entry on each login.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleEnroll()}
                      disabled={enrolling}
                      className="text-xs font-semibold text-[#0078D4] border border-[#0078D4] px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/5 transition-colors disabled:opacity-50"
                    >
                      {enrolling ? "Setting up…" : "Add another"}
                    </button>
                    <button
                      onClick={() => void handleRemove()}
                      disabled={removing}
                      className="text-xs font-semibold text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      {removing ? "Removing…" : "Remove all"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="bg-[#F7F9FC] border border-border rounded-2xl px-5 py-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#0A2540] mb-2">How it works</h4>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-[#0078D4] font-bold mt-0.5">1.</span>
              Enter your email and password as usual.
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0078D4] font-bold mt-0.5">2.</span>
              If a passkey is registered, you will be prompted to authenticate with your device (fingerprint, Face ID, or security key).
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0078D4] font-bold mt-0.5">3.</span>
              On success, you are logged in. No passkey = no second step (existing login unchanged).
            </li>
          </ul>
        </div>
      </div>
    </DashboardShell>
  );
}
