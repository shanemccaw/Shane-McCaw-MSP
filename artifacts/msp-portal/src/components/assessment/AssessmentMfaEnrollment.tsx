/**
 * AssessmentMfaEnrollment.tsx
 *
 * The mandatory first-login MFA enrollment gate for the Assessment wizard. A
 * customer cannot proceed past first login until they enroll a portal-login
 * second factor. This is about their *portal account* MFA, not their M365
 * tenant's own MFA posture.
 *
 * Only two methods are offered — Authenticator app (TOTP) and Passkey — because
 * no SMS vendor is wired for this flow. It reuses the platform's existing,
 * non-admin MFA enrollment endpoints (the same server logic behind admin-panel's
 * security page), so there is no new crypto or storage here — just the
 * customer-facing surface:
 *   POST /api/auth/mfa/passkey/registration-options → verify-registration
 *   POST /api/auth/mfa/totp/setup                   → verify-setup
 *
 * On successful enrollment it calls onEnrolled() so the wizard can drop the gate
 * and reveal the flow.
 */
import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Fingerprint, KeyRound, Loader2, ShieldCheck, Smartphone } from "lucide-react";

interface TotpSetup {
  secret: string;
  qrDataUrl: string;
}

export function AssessmentMfaEnrollment({ onEnrolled }: { onEnrolled: () => void }) {
  const { fetchWithAuth } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpSetup, setTotpSetup] = useState<TotpSetup | null>(null);
  const [totpCode, setTotpCode] = useState("");

  async function enrollPasskey() {
    setPasskeyBusy(true);
    setError(null);
    try {
      const optRes = await fetchWithAuth("/api/auth/mfa/passkey/registration-options", {
        method: "POST",
      }, { silent: true });
      if (!optRes.ok) throw new Error("Could not start passkey enrollment. Please try again.");
      const options = await optRes.json();

      const attResp = await startRegistration({ optionsJSON: options });

      const verRes = await fetchWithAuth("/api/auth/mfa/passkey/verify-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attResp),
      }, { silent: true });
      const verData = (await verRes.json()) as { ok?: boolean; error?: string };
      if (!verRes.ok || !verData.ok) throw new Error(verData.error ?? "Passkey enrollment failed.");

      onEnrolled();
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("Passkey enrollment was cancelled.");
      } else {
        setError(err instanceof Error ? err.message : "Passkey enrollment failed.");
      }
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function startTotp() {
    setTotpBusy(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/totp/setup", { method: "POST" }, { silent: true });
      if (!res.ok) throw new Error("Could not start authenticator setup. Please try again.");
      const data = (await res.json()) as TotpSetup;
      setTotpSetup(data);
      setTotpCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authenticator setup failed.");
    } finally {
      setTotpBusy(false);
    }
  }

  async function verifyTotp() {
    if (!totpSetup || totpCode.replace(/\s/g, "").length < 6) return;
    setTotpBusy(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/totp/verify-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: totpSetup.secret, code: totpCode.replace(/\s/g, "") }),
      }, { silent: true });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "That code didn't match. Please try again.");
      onEnrolled();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setTotpBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-12">
      <div className="flex flex-col items-center gap-3 text-center mb-8">
        <div className="size-14 rounded-2xl bg-primary/10 flex items-center justify-center">
          <ShieldCheck className="size-7 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground">Secure your account</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          Before you continue, add a second factor to protect your portal login.
          Choose a passkey or an authenticator app — it only takes a moment.
        </p>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Passkey — recommended */}
      <div className="rounded-2xl border border-border bg-card p-5 mb-4">
        <div className="flex items-start gap-3">
          <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Fingerprint className="size-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Passkey</h3>
              <Badge className="bg-primary/10 text-primary border-none text-[10px]">Recommended</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Use Face ID, a fingerprint, or a hardware security key. Fastest and most secure.
            </p>
          </div>
        </div>
        <Button
          className="w-full mt-4"
          onClick={() => void enrollPasskey()}
          disabled={passkeyBusy}
        >
          {passkeyBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <KeyRound className="mr-2 size-4" />}
          {passkeyBusy ? "Waiting for your device…" : "Set up a passkey"}
        </Button>
      </div>

      {/* Authenticator app (TOTP) */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="size-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
            <Smartphone className="size-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Authenticator app</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Scan a QR code with Microsoft Authenticator, Google Authenticator, or 1Password.
            </p>
          </div>
        </div>

        {!totpSetup ? (
          <Button
            variant="outline"
            className="w-full mt-4"
            onClick={() => void startTotp()}
            disabled={totpBusy}
          >
            {totpBusy && <Loader2 className="mr-2 size-4 animate-spin" />}
            {totpBusy ? "Preparing…" : "Set up an authenticator app"}
          </Button>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-background p-4">
              <img
                src={totpSetup.qrDataUrl}
                alt="Authenticator QR code"
                className="size-40 rounded-lg bg-white p-2"
              />
              <p className="text-[11px] text-muted-foreground text-center">
                Can't scan? Enter this key manually:
                <br />
                <span className="font-mono text-foreground break-all">{totpSetup.secret}</span>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="totp-code">Enter the 6-digit code</Label>
              <Input
                id="totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123 456"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void verifyTotp();
                }}
              />
            </div>
            <Button
              className="w-full"
              onClick={() => void verifyTotp()}
              disabled={totpBusy || totpCode.replace(/\s/g, "").length < 6}
            >
              {totpBusy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Verify &amp; continue
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
