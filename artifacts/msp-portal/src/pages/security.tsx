import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startRegistration } from "@simplewebauthn/browser";
import { Smartphone, MessageSquare, KeyRound, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Enrollments {
  totp: boolean;
  sms: boolean;
  smsPhone: string | null;
  passkey: boolean;
  passkeyCount: number;
}

type AlertState = { type: "success" | "error"; message: string } | null;

// ── AlertBox ─────────────────────────────────────────────────────────────────

function AlertBox({ alert }: { alert: AlertState }) {
  if (!alert) return null;
  const isSuccess = alert.type === "success";
  return (
    <div className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm border mb-4 ${
      isSuccess
        ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-500/10 dark:border-green-500/20 dark:text-green-400"
        : "bg-red-50 border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400"
    }`}>
      {isSuccess
        ? <CheckCircle2 className="size-4 flex-shrink-0 mt-0.5" />
        : <AlertCircle className="size-4 flex-shrink-0 mt-0.5" />}
      <span>{alert.message}</span>
    </div>
  );
}

// ── Active badge ──────────────────────────────────────────────────────────────

function ActiveBadge({ label }: { label: string }) {
  return (
    <Badge variant="outline" className="gap-1.5 text-green-700 border-green-300 bg-green-50 dark:text-green-400 dark:border-green-500/30 dark:bg-green-500/10">
      <span className="size-1.5 rounded-full bg-green-500 inline-block" />
      {label}
    </Badge>
  );
}

// ── TOTP Card ─────────────────────────────────────────────────────────────────

function TotpCard({ enrolled, onRefresh }: { enrolled: boolean; onRefresh: () => void }) {
  const [showSetup, setShowSetup] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<AlertState>(null);
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
      onRefresh();
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
      onRefresh();
    } catch {
      setAlert({ type: "error", message: "Failed to remove TOTP" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2">
              <Smartphone className="size-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Authenticator App (TOTP)</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Google Authenticator, Authy, or similar</p>
            </div>
          </div>
          {enrolled && <ActiveBadge label="Active" />}
        </div>
      </CardHeader>
      <CardContent>
        <AlertBox alert={alert} />
        {!showSetup ? (
          <div className="flex items-center gap-3">
            {enrolled ? (
              <>
                <p className="text-sm text-muted-foreground flex-1">
                  Your authenticator app is linked. You&apos;re prompted for a code on every login.
                </p>
                <Button variant="destructive" size="sm" onClick={() => void handleRemove()} disabled={loading}>
                  Remove
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground flex-1">
                  Not enrolled. Link your authenticator app to enable 6-digit codes on login.
                </p>
                <Button variant="outline" size="sm" onClick={() => void startSetup()} disabled={loading}>
                  {loading ? <><Loader2 className="size-3 mr-1.5 animate-spin" />Loading…</> : "Set up"}
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.
            </p>
            {qrDataUrl && (
              <div className="flex justify-center">
                <img src={qrDataUrl} alt="TOTP QR Code" className="w-44 h-44 rounded-lg border border-border" />
              </div>
            )}
            <p className="text-xs text-muted-foreground text-center">
              Can&apos;t scan? Enter manually:{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{secret}</code>
            </p>
            <form onSubmit={(e) => void confirmSetup(e)} className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Verification Code</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="font-mono text-center tracking-widest"
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1"
                  onClick={() => { setShowSetup(false); setCode(""); }}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={loading || code.length < 6}>
                  {loading ? <><Loader2 className="size-3 mr-1.5 animate-spin" />Verifying…</> : "Confirm"}
                </Button>
              </div>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── SMS Card ──────────────────────────────────────────────────────────────────

function SmsCard({
  enrolled,
  enrolledPhone,
  onRefresh,
}: {
  enrolled: boolean;
  enrolledPhone: string | null;
  onRefresh: () => void;
}) {
  const [step, setStep] = useState<"idle" | "enter-phone" | "verify">("idle");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<AlertState>(null);
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
      onRefresh();
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
      onRefresh();
    } catch {
      setAlert({ type: "error", message: "Failed to remove SMS" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2">
              <MessageSquare className="size-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">SMS One-Time Code</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Receive a code by text message on login</p>
            </div>
          </div>
          {enrolled && <ActiveBadge label="Active" />}
        </div>
      </CardHeader>
      <CardContent>
        <AlertBox alert={alert} />

        {step === "idle" && (
          <div className="flex items-center gap-3">
            {enrolled ? (
              <>
                <p className="text-sm text-muted-foreground flex-1">
                  Texts sent to number ending in ···{enrolledPhone?.slice(-4) ?? "????"}
                </p>
                <Button variant="destructive" size="sm" onClick={() => void handleRemove()} disabled={loading}>
                  Remove
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground flex-1">
                  Not enrolled. Add a phone number to receive OTP codes via text.
                </p>
                <Button variant="outline" size="sm" onClick={() => setStep("enter-phone")}>
                  Set up
                </Button>
              </>
            )}
          </div>
        )}

        {step === "enter-phone" && (
          <form onSubmit={(e) => void sendCode(e)} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Phone Number</Label>
              <Input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+1 555 000 0000"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">Include country code (e.g. +1 for US)</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setStep("idle")}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={loading || !phone.trim()}>
                {loading ? <><Loader2 className="size-3 mr-1.5 animate-spin" />Sending…</> : "Send Code"}
              </Button>
            </div>
          </form>
        )}

        {step === "verify" && (
          <form onSubmit={(e) => void verifyCode(e)} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              We sent a 6-digit code to the number ending in ···{phoneLast4}. Enter it below to confirm.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Verification Code</Label>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="font-mono text-center tracking-widest"
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                onClick={() => { setStep("idle"); setCode(""); }}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={loading || code.length < 6}>
                {loading ? <><Loader2 className="size-3 mr-1.5 animate-spin" />Verifying…</> : "Confirm"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// ── Passkey Card ──────────────────────────────────────────────────────────────

function PasskeyCard({
  enrolled,
  passkeyCount,
  onRefresh,
}: {
  enrolled: boolean;
  passkeyCount: number;
  onRefresh: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<AlertState>(null);
  const { fetchWithAuth, user } = useAuth();

  const registrationOptionsUrl =
    user?.role === "admin"
      ? "/api/auth/mfa/passkey/admin-registration-options"
      : "/api/auth/mfa/passkey/registration-options";

  const handleEnroll = async () => {
    setLoading(true);
    setAlert(null);
    try {
      const optRes = await fetchWithAuth(registrationOptionsUrl, { method: "POST" });
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
      onRefresh();
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
      onRefresh();
    } catch {
      setAlert({ type: "error", message: "Failed to remove passkeys" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2">
              <KeyRound className="size-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Passkey (Biometric / Hardware Key)</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Fingerprint, Face ID, or security key — no code needed</p>
            </div>
          </div>
          {enrolled && (
            <ActiveBadge label={`${passkeyCount} key${passkeyCount !== 1 ? "s" : ""}`} />
          )}
        </div>
      </CardHeader>
      <CardContent>
        <AlertBox alert={alert} />
        <div className="flex items-start gap-3">
          {enrolled ? (
            <>
              <p className="text-sm text-muted-foreground flex-1">
                You have {passkeyCount} passkey{passkeyCount !== 1 ? "s" : ""} registered. Used for passwordless second-factor on login.
              </p>
              <div className="flex gap-2 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => void handleEnroll()} disabled={loading}>
                  Add another
                </Button>
                <Button variant="destructive" size="sm" onClick={() => void handleRemove()} disabled={loading}>
                  Remove all
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground flex-1">
                Not enrolled. Register a passkey to use biometrics or a hardware key on login.
              </p>
              <Button variant="outline" size="sm" onClick={() => void handleEnroll()} disabled={loading}>
                {loading ? <><Loader2 className="size-3 mr-1.5 animate-spin" />Setting up…</> : "Set up"}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SecurityPage() {
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
      // silently ignore — page still renders usefully
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void fetchEnrollments();
  }, [fetchEnrollments]);

  const mfaActive = enrollments.totp || enrollments.sms || enrollments.passkey;

  return (
    <AppShell title="Account Security">
      <div className="p-6 max-w-2xl space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Account Security</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Set up an additional second factor. Once enabled, you will be prompted after entering your password.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <TotpCard
              enrolled={enrollments.totp}
              onRefresh={() => void fetchEnrollments()}
            />
            <SmsCard
              enrolled={enrollments.sms}
              enrolledPhone={enrollments.smsPhone}
              onRefresh={() => void fetchEnrollments()}
            />
            <PasskeyCard
              enrolled={enrollments.passkey}
              passkeyCount={enrollments.passkeyCount}
              onRefresh={() => void fetchEnrollments()}
            />

            {mfaActive && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg px-5 py-4">
                <p className="text-xs text-primary font-semibold">
                  MFA is active on your account. You will be asked for a second factor each time you sign in.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
