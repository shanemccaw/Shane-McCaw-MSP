/**
 * Team Members settings sub-page.
 * Includes "Invite Team Member" button + pending invites section.
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, Clock, Loader2, MailPlus, Shield, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
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

interface PendingInvite {
  id: number;
  invitedEmail: string;
  mspRole: string;
  expiresAt: string;
  createdAt: string;
  inviterEmail: string | null;
  inviterName: string | null;
}

export default function SettingsTeamPage() {
  const { fetchWithAuth, user } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"MSPAdmin" | "MSPOperator">("MSPOperator");
  const [inviting, setInviting] = useState(false);

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

  const loadInvites = useCallback(async () => {
    setInvitesLoading(true);
    try {
      const res = await fetchWithAuth("/api/msp/settings/invites");
      if (res.ok) {
        const data = (await res.json()) as PendingInvite[];
        setInvites(data);
      }
    } finally {
      setInvitesLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void loadMembers();
    void loadInvites();
  }, [loadMembers, loadInvites]);

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

  async function handleSendInvite() {
    if (!inviteEmail.trim()) { toast.error("Email is required"); return; }
    setInviting(true);
    try {
      const res = await fetchWithAuth("/api/msp/settings/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), mspRole: inviteRole }),
      });
      if (res.ok) {
        toast.success(`Invite sent to ${inviteEmail}`);
        setShowInviteDialog(false);
        setInviteEmail("");
        setInviteRole("MSPOperator");
        void loadInvites();
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Failed to send invite");
      }
    } finally {
      setInviting(false);
    }
  }

  async function handleRevokeInvite(inviteId: number, email: string) {
    if (!confirm(`Revoke invite for ${email}?`)) return;
    setRevokingId(inviteId);
    try {
      const res = await fetchWithAuth(`/api/msp/settings/invites/${inviteId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Invite revoked");
        setInvites((inv) => inv.filter((i) => i.id !== inviteId));
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Revoke failed");
      }
    } finally {
      setRevokingId(null);
    }
  }

  const isMspAdmin = user?.mspRole === "MSPAdmin" || user?.role === "admin";

  const actions = (
    <div className="flex items-center gap-2">
      {isMspAdmin && (
        <Button size="sm" className="gap-1.5" onClick={() => setShowInviteDialog(true)}>
          <UserPlus className="size-3.5" />
          Invite Team Member
        </Button>
      )}
      <Link href="/settings">
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <ArrowLeft className="size-3.5" />
          Settings
        </Button>
      </Link>
    </div>
  );

  const roleColor = (role: string) => {
    if (role === "MSPAdmin") return "text-blue-600 bg-blue-50 border-blue-200";
    if (role === "MSPOperator") return "text-muted-foreground";
    return "";
  };

  function expiryCountdown(expiresAt: string): string {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return "< 1 hour left";
    if (hours < 24) return `${hours}h left`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h left`;
  }

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

        {/* Active members */}
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
                            disabled={updatingId === m.userId || !isMspAdmin}
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

                        {!isSelf && isMspAdmin && (
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

        {/* Pending invites — only shown to MSPAdmins */}
        {isMspAdmin && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <MailPlus className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Pending Invites</h3>
            </div>

            <Card>
              <CardContent className="pt-4">
                {invitesLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : invites.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No pending invites.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {invites.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{inv.invitedEmail}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant="outline" className={`text-[10px] ${roleColor(inv.mspRole)}`}>
                              {inv.mspRole === "MSPAdmin" ? "MSP Admin" : "MSP Operator"}
                            </Badge>
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Clock className="size-3" />
                              {expiryCountdown(inv.expiresAt)}
                            </span>
                          </div>
                        </div>

                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-destructive hover:text-destructive shrink-0"
                          disabled={revokingId === inv.id}
                          onClick={() => void handleRevokeInvite(inv.id, inv.invitedEmail)}
                          title="Revoke invite"
                        >
                          {revokingId === inv.id
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <Trash2 className="size-3.5" />}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Invite dialog */}
      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              The invite link expires in 72 hours. The recipient will receive an email with a link to set up their account.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email Address</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={inviting}
                onKeyDown={(e) => { if (e.key === "Enter") void handleSendInvite(); }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "MSPAdmin" | "MSPOperator")} disabled={inviting}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MSPOperator">
                    <div>
                      <div className="font-medium text-sm">MSP Operator</div>
                      <div className="text-xs text-muted-foreground">Operational access — no billing or settings</div>
                    </div>
                  </SelectItem>
                  <SelectItem value="MSPAdmin">
                    <div>
                      <div className="font-medium text-sm">MSP Admin</div>
                      <div className="text-xs text-muted-foreground">Full access within your MSP</div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteDialog(false)} disabled={inviting}>
              Cancel
            </Button>
            <Button onClick={() => void handleSendInvite()} disabled={inviting} className="gap-1.5">
              {inviting ? <Loader2 className="size-4 animate-spin" /> : <MailPlus className="size-4" />}
              Send Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
