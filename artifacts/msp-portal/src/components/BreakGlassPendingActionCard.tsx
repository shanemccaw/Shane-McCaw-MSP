/**
 * BreakGlassPendingActionCard
 *
 * Shown wherever the Portal has a specific workflow run (runId) in view.
 * Renders nothing when that run isn't currently paused at a
 * break_glass_verification_gate node. When it is, lets the initiator:
 *   - see gate status + per-recipient verification-link progress
 *   - invite 1–5 recipients
 *
 * NEVER shows the secret value or a linkToken — this is a status/invite
 * surface for the initiator, not a delivery surface. The recipient reveals
 * the credential themselves via their own single-use email link.
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Loader2, Mail, Clock, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface BreakGlassAttempt {
  id: number;
  invitedEmail: string;
  linkStatus: "pending" | "consumed" | "expired" | "superseded";
  verificationOutcome: "success" | "role_not_active_pim_eligible" | "role_absent" | "expired" | "superseded" | null;
  attemptedAt: string | null;
}

type StatusResponse =
  | { pending: false }
  | { pending: true; pendingSecretId: number; status: string; attempts: BreakGlassAttempt[] };

const LINK_STATUS_BADGE: Record<BreakGlassAttempt["linkStatus"], { label: string; className: string; icon: typeof Clock }> = {
  pending: { label: "Pending", className: "bg-primary/10 text-primary border-primary/20", icon: Clock },
  consumed: { label: "Verified", className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20", icon: CheckCircle2 },
  expired: { label: "Expired", className: "bg-muted text-muted-foreground border-border", icon: XCircle },
  superseded: { label: "Superseded", className: "bg-muted text-muted-foreground border-border", icon: XCircle },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "Just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function BreakGlassPendingActionCard({ runId }: { runId: number }) {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<StatusResponse | null>(null);
  const [emails, setEmails] = useState<string[]>([""]);
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/portal/break-glass/by-run/${runId}`);
      if (res.ok) {
        setData((await res.json()) as StatusResponse);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, runId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-6 flex items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Not currently paused at a break-glass gate — render nothing, this card is
  // purely conditional on that state.
  if (!data || !data.pending) return null;

  const validEmails = emails.map((e) => e.trim()).filter(Boolean);

  function updateEmail(i: number, value: string) {
    setEmails((prev) => prev.map((e, idx) => (idx === i ? value : e)));
  }
  function addEmailField() {
    setEmails((prev) => (prev.length < 5 ? [...prev, ""] : prev));
  }
  function removeEmailField(i: number) {
    setEmails((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  async function handleInvite() {
    if (!data || !data.pending) return;
    if (validEmails.length === 0) { toast.error("Enter at least one recipient email"); return; }
    if (validEmails.length > 5) { toast.error("At most 5 recipients"); return; }

    setInviting(true);
    try {
      const res = await fetchWithAuth(`/api/portal/break-glass/${data.pendingSecretId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: validEmails }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(err.error ?? "Failed to send invites");
        return;
      }
      toast.success(`Verification link${validEmails.length > 1 ? "s" : ""} sent`);
      setEmails([""]);
      await load();
    } finally {
      setInviting(false);
    }
  }

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[10px] font-semibold gap-1 mb-1">
              <KeyRound className="size-3" />
              Awaiting Break-Glass Verification
            </Badge>
            <CardTitle className="text-base font-semibold">
              This automation is paused pending emergency-access verification
            </CardTitle>
            <CardDescription>
              Invite an administrator to prove control of the tenant. Once they verify and
              acknowledge receipt of the credential, this run resumes automatically.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()} className="shrink-0 gap-1.5 text-muted-foreground">
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Invite form */}
        <div className="space-y-2">
          <Label className="text-xs">Recipient email(s) — up to 5</Label>
          {emails.map((email, i) => (
            <div key={i} className="flex items-center gap-2">
              <Mail className="size-3.5 text-muted-foreground shrink-0" />
              <Input
                type="email"
                value={email}
                onChange={(e) => updateEmail(i, e.target.value)}
                placeholder="admin@customer-tenant.com"
                disabled={inviting}
                className="h-8 text-sm"
              />
              {emails.length > 1 && (
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => removeEmailField(i)} disabled={inviting}>
                  <XCircle className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            {emails.length < 5 && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addEmailField} disabled={inviting}>
                + Add recipient
              </Button>
            )}
            <Button size="sm" className="h-7 text-xs ml-auto gap-1.5" onClick={() => void handleInvite()} disabled={inviting || validEmails.length === 0}>
              {inviting && <Loader2 className="size-3 animate-spin" />}
              Send verification link{validEmails.length > 1 ? "s" : ""}
            </Button>
          </div>
        </div>

        {/* Per-recipient status — never shows the secret or the link token */}
        {data.attempts.length > 0 && (
          <div className="border-t border-border/60 pt-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Verification link status</p>
            {data.attempts.map((a) => {
              const badge = LINK_STATUS_BADGE[a.linkStatus];
              const Icon = badge.icon;
              return (
                <div key={a.id} className="flex items-center justify-between gap-2 text-sm rounded-md bg-muted/40 px-2.5 py-1.5">
                  <span className="truncate">{a.invitedEmail}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {a.attemptedAt && <span className="text-[10px] text-muted-foreground">{relativeTime(a.attemptedAt)}</span>}
                    <Badge variant="outline" className={`text-[10px] font-semibold gap-1 ${badge.className}`}>
                      <Icon className="size-3" />
                      {badge.label}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
