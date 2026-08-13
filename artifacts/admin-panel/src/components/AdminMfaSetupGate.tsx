/**
 * AdminMfaSetupGate.tsx
 *
 * The mandatory MFA gate for admin-panel (Git #439) — production only, real
 * enforcement (requireAuth refuses every other route while the session is
 * mfaSetupPending; see requireAuth.ts's MFA_SETUP_ALLOWLIST). Rendered by
 * RequireAdmin in App.tsx in place of the normal app shell whenever an admin
 * has zero passkeys enrolled and the backend reports gateRequired.
 *
 * Passkey-only, deliberately not offering TOTP here even though AdminSecurity
 * (the voluntary settings page) does: /auth/mfa/verify rejects TOTP for
 * role === "admin" at the real login challenge, so a gate that let an admin
 * satisfy it with TOTP alone would set up a self-lockout at next login. Reuses
 * the exact same two endpoints AdminSecurity.tsx's own passkey button calls —
 * no new MFA mechanics.
 */
import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { useAuth } from "@/contexts/AuthContext";

export function AdminMfaSetupGate({ onEnrolled }: { onEnrolled: () => void }) {
  const { fetchWithAuth, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enrollPasskey() {
    setBusy(true);
    setError(null);
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
      const verData = (await verRes.json()) as { ok?: boolean; error?: string };
      if (!verRes.ok || !verData.ok) throw new Error(verData.error ?? "Registration failed");

      // The current access token is mfaSetupPending — refresh before letting
      // the shell render normal admin routes, or requireAuth would keep
      // refusing them for the rest of that token's 15-minute life.
      await refresh();
      onEnrolled();
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("Passkey registration was cancelled.");
      } else {
        setError(err instanceof Error ? err.message : "Registration failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0A2540] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-card rounded-2xl shadow-2xl p-8 text-center space-y-5">
        <div className="w-14 h-14 bg-primary/10 border border-primary/20 rounded-2xl flex items-center justify-center mx-auto">
          <svg className="w-7 h-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">Secure your admin account</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Production admin access requires a passkey. Use Face ID, a fingerprint, or a hardware
            security key — it only takes a moment.
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-3 py-2.5 rounded-lg text-left">
            {error}
          </div>
        )}

        <button
          onClick={() => void enrollPasskey()}
          disabled={busy}
          className="w-full bg-primary text-white rounded-lg px-4 py-3 text-sm font-semibold hover:bg-[#006CBE] transition-colors disabled:opacity-60"
        >
          {busy ? "Waiting for your device…" : "Set up a passkey"}
        </button>
      </div>
    </div>
  );
}
