import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Azure credential self-service (#3964, Phase 4 of Feature #3960).
 *
 * Wired to the real endpoints built in #3961
 * (artifacts/api-server/src/routes/portal-azure-credential.ts), contract in
 * docs/azure-credential-portal-contract-pack.md:
 *
 *   GET  /api/portal/azure-credential         -> PortalAzureCredential | null
 *   POST /api/portal/azure-credential/rotate  { clientSecretValue } -> PortalAzureCredential
 *
 * No Design export exists for this page — Shane authorized a stub UI in the
 * portal's existing card language on 2026-09-15. The secret value is never
 * returned by the API and is never displayed; the typed value is cleared from
 * state as soon as the rotate request settles.
 */

interface PortalAzureCredential {
  id: number;
  displayName: string;
  tenantId: string;
  clientId: string;
  credentialType: "secret" | "certificate";
  expiresOn: string | null;
  updatedAt: string;
}

// Mirrors EXPIRY_WARN_DAYS in artifacts/api-server/src/lib/azure-credential-expiry.ts —
// the backend returns no status enum (contract pack §4), so the badge is derived here
// with the same cutoff the admin-side expiry alerts use.
const EXPIRY_WARN_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function expiryState(expiresOn: string | null): { tone: "green" | "amber" | "red" | "muted"; label: string } {
  if (!expiresOn) return { tone: "muted", label: "No expiry recorded" };
  const daysLeft = Math.ceil((new Date(expiresOn).getTime() - Date.now()) / DAY_MS);
  if (daysLeft <= 0) return { tone: "red", label: "Expired" };
  if (daysLeft <= EXPIRY_WARN_DAYS) return { tone: "amber", label: `Expires in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}` };
  return { tone: "green", label: `Valid · ${daysLeft} days left` };
}

const TONE_DOT: Record<string, string> = {
  green: "bg-status-green",
  amber: "bg-status-amber",
  red: "bg-status-red",
  muted: "bg-muted-foreground",
};

export default function AzureCredentialPage() {
  const { fetchWithAuth } = useAuth();
  const [state, setState] = useState<"loading" | "live" | "failed">("loading");
  const [credential, setCredential] = useState<PortalAzureCredential | null>(null);

  const [secret, setSecret] = useState("");
  const [secretConfirm, setSecretConfirm] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetchWithAuth("/api/portal/azure-credential", undefined, { silent: true });
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      setCredential((await res.json()) as PortalAzureCredential | null);
      setState("live");
    } catch {
      setState("failed");
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  const trimmed = secret.trim();
  const mismatch = secretConfirm.length > 0 && secret !== secretConfirm;
  const canSubmit = trimmed.length > 0 && secret === secretConfirm && !rotating;

  const rotate = async () => {
    setRotating(true);
    setRotateError(null);
    try {
      const res = await fetchWithAuth("/api/portal/azure-credential/rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientSecretValue: trimmed }),
      });
      const body = (await res.json().catch(() => null)) as PortalAzureCredential | { error?: string } | null;
      if (!res.ok) {
        const msg = body && "error" in body && body.error ? body.error : `Rotation failed (${res.status})`;
        setRotateError(msg);
        return;
      }
      setCredential(body as PortalAzureCredential);
      toast.success("Client secret rotated");
    } catch (err: unknown) {
      setRotateError(err instanceof Error ? err.message : "Rotation failed");
    } finally {
      setSecret("");
      setSecretConfirm("");
      setConfirmOpen(false);
      setRotating(false);
    }
  };

  const expiry = credential ? expiryState(credential.expiresOn) : null;

  return (
    <div className="flex flex-col gap-4 pb-14" data-testid="azure-credential-page">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Azure credential</h1>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              state === "failed" ? "bg-status-red" : state === "loading" || !credential ? "bg-muted-foreground" : "bg-status-green",
            )}
          />
          {state === "loading"
            ? "Reading your credential"
            : state === "failed"
              ? "Could not read your credential"
              : credential
                ? "Live"
                : "Live — no credential registered"}
        </span>
      </div>

      {state === "loading" && (
        <div className="flex animate-pulse flex-col gap-2 rounded-xl border border-border/60 bg-muted/10 p-4">
          <div className="h-2.5 w-2/5 rounded-full bg-muted-foreground/20" />
          <div className="h-2 w-1/2 rounded-full bg-muted-foreground/10" />
        </div>
      )}

      {state === "failed" && (
        <Card data-testid="azure-credential-failed">
          <CardContent className="flex flex-col gap-1 pt-6">
            <span className="text-[13px] font-semibold text-foreground">Failed to load your Azure credential</span>
            <span className="text-xs text-muted-foreground">Nothing is shown because nothing could be fetched.</span>
            <Button variant="link" size="sm" className="h-auto w-fit p-0 text-[11.5px]" onClick={() => void load()} data-testid="azure-credential-retry">
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {state === "live" && !credential && (
        <Card data-testid="azure-credential-empty">
          <CardContent className="flex flex-col gap-2 pt-6">
            <span className="text-[13.5px] font-semibold text-foreground">No Azure credential is registered for your account</span>
            <span className="max-w-[660px] text-xs leading-relaxed text-muted-foreground">
              Your provider registers the app credential that connects your Microsoft 365 tenant. Once it is set up, its
              status appears here and you can rotate its secret yourself.
            </span>
          </CardContent>
        </Card>
      )}

      {state === "live" && credential && expiry && (
        <>
          <Card data-testid="azure-credential-status">
            <CardContent className="flex flex-col gap-3 pt-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <KeyRound className="size-4 text-muted-foreground" />
                <span className="text-[13.5px] font-semibold text-foreground" data-testid="azure-credential-display-name">
                  {credential.displayName}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="azure-credential-expiry-badge">
                  <span className={cn("size-1.5 rounded-full", TONE_DOT[expiry.tone])} />
                  {expiry.label}
                </span>
              </div>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-xs sm:grid-cols-[160px_1fr]">
                <dt className="text-muted-foreground">Tenant ID</dt>
                <dd className="font-mono text-foreground" data-testid="azure-credential-tenant-id">{credential.tenantId}</dd>
                <dt className="text-muted-foreground">App (client) ID</dt>
                <dd className="font-mono text-foreground" data-testid="azure-credential-client-id">{credential.clientId}</dd>
                <dt className="text-muted-foreground">Credential type</dt>
                <dd className="text-foreground" data-testid="azure-credential-type">
                  {credential.credentialType === "secret" ? "Client secret" : "Certificate"}
                </dd>
                <dt className="text-muted-foreground">Expires</dt>
                <dd className="text-foreground" data-testid="azure-credential-expires-on">
                  {credential.expiresOn ? formatDateTime(credential.expiresOn) : "Not recorded"}
                </dd>
                <dt className="text-muted-foreground">Last updated</dt>
                <dd className="text-foreground" data-testid="azure-credential-updated-at">{formatDateTime(credential.updatedAt)}</dd>
              </dl>
              <span className="border-t border-border/50 pt-2.5 text-[10.5px] leading-relaxed text-muted-foreground/70">
                The secret value is stored in Key Vault and is never shown here.
              </span>
            </CardContent>
          </Card>

          {credential.credentialType === "secret" ? (
            <Card data-testid="azure-credential-rotate">
              <CardContent className="flex flex-col gap-3 pt-4">
                <div className="flex flex-col gap-1">
                  <span className="text-[13.5px] font-semibold text-foreground">Rotate client secret</span>
                  <span className="max-w-[660px] text-xs leading-relaxed text-muted-foreground">
                    Create a new client secret on this app registration in Microsoft Entra, then paste its value below. The
                    platform starts using the new value immediately. Keep the old secret active in Entra until you have
                    confirmed the connection still works.
                  </span>
                </div>
                <form
                  className="flex max-w-md flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (canSubmit) setConfirmOpen(true);
                  }}
                >
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="azure-secret">New secret value</Label>
                    <Input
                      id="azure-secret"
                      type="password"
                      autoComplete="off"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      data-testid="azure-credential-secret-input"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="azure-secret-confirm">Confirm secret value</Label>
                    <Input
                      id="azure-secret-confirm"
                      type="password"
                      autoComplete="off"
                      value={secretConfirm}
                      onChange={(e) => setSecretConfirm(e.target.value)}
                      data-testid="azure-credential-secret-confirm-input"
                    />
                    {mismatch && <span className="text-[11px] text-status-red">The two values do not match.</span>}
                  </div>
                  {rotateError && (
                    <div className="rounded-lg border border-dashed border-status-red/45 bg-status-red/[.06] p-2.5 text-xs text-status-red" data-testid="azure-credential-rotate-error">
                      {rotateError}
                    </div>
                  )}
                  <Button type="submit" className="w-fit gap-1.5" disabled={!canSubmit} data-testid="azure-credential-rotate-submit">
                    <RotateCw className="size-3.5" />
                    Rotate secret
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Card data-testid="azure-credential-certificate-note">
              <CardContent className="flex flex-col gap-1 pt-4">
                <span className="text-[13.5px] font-semibold text-foreground">Certificate credential</span>
                <span className="text-xs text-muted-foreground">
                  This credential uses a certificate. Certificate rotation is handled by your provider.
                </span>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!rotating) setConfirmOpen(open); }}>
        <DialogContent className="max-w-md" data-testid="azure-credential-confirm-dialog">
          <DialogHeader>
            <DialogTitle>Rotate the client secret?</DialogTitle>
            <DialogDescription>
              This replaces the live secret for {credential?.displayName ?? "this credential"} (tenant{" "}
              <span className="font-mono">{credential?.tenantId}</span>). If the new value is wrong, the platform will lose
              access to your tenant until a correct secret is saved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={rotating} data-testid="azure-credential-confirm-cancel">
              Cancel
            </Button>
            <Button onClick={() => void rotate()} disabled={rotating} className="gap-1.5" data-testid="azure-credential-confirm-rotate">
              {rotating && <Loader2 className="size-3.5 animate-spin" />}
              Rotate secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
