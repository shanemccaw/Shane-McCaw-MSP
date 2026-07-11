/**
 * Active Sessions settings sub-page.
 * Shows refresh-token sessions for all MSP users, with ability to revoke.
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowLeft, Laptop, Loader2, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { Link } from "wouter";

interface Session {
  id: number;
  userId: number;
  tokenHash: string;
  issuedAt: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
  email: string;
  name: string | null;
}

export default function SettingsSessionsPage() {
  const { fetchWithAuth, user } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/msp/settings/sessions");
      if (res.ok) {
        const data = (await res.json()) as Session[];
        setSessions(data);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  async function handleRevoke(tokenHash: string, email: string) {
    if (!confirm(`Revoke session for ${email}? They will be signed out immediately.`)) return;
    setRevokingId(tokenHash);
    try {
      const res = await fetchWithAuth(`/api/msp/settings/sessions/${tokenHash}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(`Session for ${email} revoked`);
        setSessions((s) => s.filter((sess) => sess.tokenHash !== tokenHash));
      } else {
        toast.error("Revoke failed");
      }
    } finally {
      setRevokingId(null);
    }
  }

  function parseUserAgent(ua: string | null) {
    if (!ua) return "Unknown device";
    if (ua.includes("Mobile")) return "Mobile browser";
    if (ua.includes("Chrome")) return "Chrome";
    if (ua.includes("Firefox")) return "Firefox";
    if (ua.includes("Safari")) return "Safari";
    return "Browser";
  }

  const isExpired = (expiresAt: string) => new Date(expiresAt) < new Date();

  const actions = (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => void loadSessions()}>
        <RefreshCw className="size-3.5" />
        Refresh
      </Button>
      <Link href="/settings">
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <ArrowLeft className="size-3.5" />
          Settings
        </Button>
      </Link>
    </div>
  );

  return (
    <AppShell title="Active Sessions" actions={actions}>
      <div className="p-6 max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-muted/60 p-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Active Sessions</h2>
            <p className="text-sm text-muted-foreground">
              All active refresh-token sessions for your MSP users. Revoke any suspicious session.
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-4">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No active sessions found.
              </div>
            ) : (
              <div className="space-y-2">
                {sessions.map((s) => {
                  const expired = isExpired(s.expiresAt);
                  const isSelf = s.userId === user?.id;
                  return (
                    <div
                      key={s.tokenHash}
                      className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${
                        expired ? "border-muted bg-muted/10 opacity-60" : "border-border"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Laptop className="size-3.5 text-muted-foreground shrink-0" />
                          <p className="text-sm font-medium truncate">
                            {s.name ?? s.email}
                            {isSelf && " (you)"}
                          </p>
                          {expired && <Badge variant="outline" className="text-[10px] text-destructive">Expired</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{s.email}</p>
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                          <span>{parseUserAgent(s.userAgent)}</span>
                          {s.ipAddress && <span>IP: {s.ipAddress}</span>}
                          <span>Issued: {new Date(s.issuedAt).toLocaleDateString()}</span>
                          <span>Expires: {new Date(s.expiresAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-destructive border-destructive/20 hover:bg-destructive/5 shrink-0"
                        disabled={revokingId === s.tokenHash || expired}
                        onClick={() => void handleRevoke(s.tokenHash, s.email)}
                      >
                        {revokingId === s.tokenHash
                          ? <Loader2 className="size-3.5 animate-spin" />
                          : <LogOut className="size-3.5" />}
                        Revoke
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Sessions expire automatically after 7 days. Revoking a session signs out the user immediately.
        </p>
      </div>
    </AppShell>
  );
}
