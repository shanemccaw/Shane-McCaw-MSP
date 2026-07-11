/**
 * Team Members settings sub-page.
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Shield, UserMinus, Users } from "lucide-react";
import { Link } from "wouter";

interface TeamMember {
  id: number;
  userId: number;
  mspRole: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  email: string;
  name: string | null;
}

export default function SettingsTeamPage() {
  const { fetchWithAuth, user } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/msp/settings/users");
      if (res.ok) {
        const data = (await res.json()) as TeamMember[];
        setMembers(data);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  async function handleRoleChange(userId: number, role: string) {
    setUpdatingId(userId);
    try {
      const res = await fetchWithAuth(`/api/msp/settings/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mspRole: role }),
      });
      if (res.ok) {
        toast.success("Role updated");
        setMembers((m) => m.map((mm) => mm.userId === userId ? { ...mm, mspRole: role } : mm));
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Update failed");
      }
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleRemove(userId: number, email: string) {
    if (!confirm(`Remove ${email} from this MSP? They will lose access immediately.`)) return;
    setRemovingId(userId);
    try {
      const res = await fetchWithAuth(`/api/msp/settings/users/${userId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(`${email} removed from MSP`);
        setMembers((m) => m.filter((mm) => mm.userId !== userId));
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Remove failed");
      }
    } finally {
      setRemovingId(null);
    }
  }

  const actions = (
    <Link href="/settings">
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
        <ArrowLeft className="size-3.5" />
        Settings
      </Button>
    </Link>
  );

  const roleColor = (role: string) => {
    if (role === "MSPAdmin") return "text-blue-600 bg-blue-50 border-blue-200";
    if (role === "MSPOperator") return "text-muted-foreground";
    return "";
  };

  return (
    <AppShell title="Team Members" actions={actions}>
      <div className="p-6 max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-muted/60 p-2">
            <Users className="size-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Team Members</h2>
            <p className="text-sm text-muted-foreground">Manage roles within your MSP organisation.</p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-4">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : members.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No team members found.
              </div>
            ) : (
              <div className="space-y-2">
                {members.map((m) => {
                  const isSelf = m.userId === user?.id;
                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{m.name ?? m.email}</p>
                          {isSelf && <Badge variant="outline" className="text-[10px]">You</Badge>}
                          {!m.isActive && <Badge variant="outline" className="text-[10px] text-destructive">Inactive</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{m.email}</p>
                        {m.lastLoginAt && (
                          <p className="text-[11px] text-muted-foreground">
                            Last login: {new Date(m.lastLoginAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isSelf ? (
                          <Badge variant="outline" className={`text-[11px] ${roleColor(m.mspRole)}`}>
                            <Shield className="size-3 mr-1" />
                            {m.mspRole}
                          </Badge>
                        ) : (
                          <Select
                            value={m.mspRole}
                            onValueChange={(v) => void handleRoleChange(m.userId, v)}
                            disabled={updatingId === m.userId}
                          >
                            <SelectTrigger className="h-7 text-xs w-36">
                              {updatingId === m.userId
                                ? <Loader2 className="size-3 animate-spin" />
                                : <SelectValue />}
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="MSPAdmin" className="text-xs">MSP Admin</SelectItem>
                              <SelectItem value="MSPOperator" className="text-xs">MSP Operator</SelectItem>
                            </SelectContent>
                          </Select>
                        )}

                        {!isSelf && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 text-destructive hover:text-destructive"
                            disabled={removingId === m.userId}
                            onClick={() => void handleRemove(m.userId, m.email)}
                          >
                            {removingId === m.userId
                              ? <Loader2 className="size-3.5 animate-spin" />
                              : <UserMinus className="size-3.5" />}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
