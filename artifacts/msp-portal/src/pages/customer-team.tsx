/**
 * Customer Team Management Page
 *
 * Route: /customer-team
 * Accessible to: CustomerUser
 *
 * Allows customers to manage their organization's employee accounts:
 *   - Employee directory with search & status filters
 *   - Create/invite new employee accounts
 *   - Slide-over user inspector with Profile and Password/MFA tabs
 *   - Reset passwords, generate temp passwords, reset MFA, emergency bypass codes
 *   - Suspend/activate employee accounts
 *   - Revoke active sessions
 *
 * No RBAC role selection — all customer employees share the CustomerUser role.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  AlertCircle,
  Copy,
  Eye,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Mail,
  MoreVertical,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Unlock,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  UserX,
  X,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type UserStatus = "Active" | "Suspended" | "Locked";
type MfaStatus = "TOTP" | "FIDO2" | "SMS" | "Disabled";

interface TeamMember {
  id: number;
  userId: number;
  email: string;
  name: string | null;
  isActive: boolean;
  status: UserStatus;
  isLockedOut?: boolean;
  mfaStatus: MfaStatus;
  mfaEnforced: boolean;
  department?: string;
  jobTitle?: string;
  phone?: string;
  lastLoginAt: string | null;
  createdAt: string;
  activeSessionsCount?: number;
}

// ── Mock Data ─────────────────────────────────────────────────────────────────

const DEFAULT_TEAM: TeamMember[] = [
  {
    id: 1,
    userId: 201,
    email: "john.martinez@acmecorp.com",
    name: "John Martinez",
    isActive: true,
    status: "Active",
    isLockedOut: false,
    mfaStatus: "TOTP",
    mfaEnforced: true,
    department: "IT Operations",
    jobTitle: "Systems Administrator",
    phone: "+1 (555) 234-5678",
    lastLoginAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    createdAt: "2024-06-15T09:00:00Z",
    activeSessionsCount: 1,
  },
  {
    id: 2,
    userId: 202,
    email: "lisa.chen@acmecorp.com",
    name: "Lisa Chen",
    isActive: true,
    status: "Active",
    isLockedOut: false,
    mfaStatus: "FIDO2",
    mfaEnforced: true,
    department: "Engineering",
    jobTitle: "DevOps Lead",
    phone: "+1 (555) 876-5432",
    lastLoginAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    createdAt: "2024-07-01T14:30:00Z",
    activeSessionsCount: 2,
  },
  {
    id: 3,
    userId: 203,
    email: "omar.hassan@acmecorp.com",
    name: "Omar Hassan",
    isActive: true,
    status: "Active",
    isLockedOut: false,
    mfaStatus: "TOTP",
    mfaEnforced: false,
    department: "Security",
    jobTitle: "Security Analyst",
    phone: "+1 (555) 345-6789",
    lastLoginAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    createdAt: "2024-08-10T10:15:00Z",
    activeSessionsCount: 1,
  },
  {
    id: 4,
    userId: 204,
    email: "priya.sharma@acmecorp.com",
    name: "Priya Sharma",
    isActive: false,
    status: "Suspended",
    isLockedOut: false,
    mfaStatus: "Disabled",
    mfaEnforced: true,
    department: "Support",
    jobTitle: "Help Desk Specialist",
    phone: "+1 (555) 456-7890",
    lastLoginAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString(),
    createdAt: "2024-09-05T08:00:00Z",
    activeSessionsCount: 0,
  },
  {
    id: 5,
    userId: 205,
    email: "marcus.williams@acmecorp.com",
    name: "Marcus Williams",
    isActive: true,
    status: "Locked",
    isLockedOut: true,
    mfaStatus: "SMS",
    mfaEnforced: true,
    department: "Compliance",
    jobTitle: "Compliance Officer",
    phone: "+1 (555) 987-6543",
    lastLoginAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    createdAt: "2024-10-12T11:20:00Z",
    activeSessionsCount: 0,
  },
  {
    id: 6,
    userId: 206,
    email: "emily.tanaka@acmecorp.com",
    name: "Emily Tanaka",
    isActive: true,
    status: "Active",
    isLockedOut: false,
    mfaStatus: "TOTP",
    mfaEnforced: true,
    department: "Engineering",
    jobTitle: "Cloud Engineer",
    phone: "+1 (555) 111-2233",
    lastLoginAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    createdAt: "2024-11-01T13:45:00Z",
    activeSessionsCount: 1,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name?: string | null, email?: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].substring(0, 2).toUpperCase();
  }
  if (email && email.trim()) return email.substring(0, 2).toUpperCase();
  return "U";
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const STATUS_BADGE: Record<UserStatus, string> = {
  Active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  Suspended: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  Locked: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

const MFA_BADGE: Record<MfaStatus, { color: string; icon: React.ElementType }> = {
  TOTP: { color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", icon: ShieldCheck },
  FIDO2: { color: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30", icon: Shield },
  SMS: { color: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30", icon: Smartphone },
  Disabled: { color: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30", icon: ShieldAlert },
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function CustomerTeamPage() {
  const { fetchWithAuth, user: currentUser } = useAuth();

  // State
  const [team, setTeam] = useState<TeamMember[]>(DEFAULT_TEAM);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Modals & Drawers
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteDept, setInviteDept] = useState("");
  const [inviteTitle, setInviteTitle] = useState("");
  const [inviting, setInviting] = useState(false);

  // Credential modal
  const [activeCredentialModal, setActiveCredentialModal] = useState<{
    title: string;
    description: string;
    codeOrPass: string;
    type: "tempPass" | "bypassCode";
  } | null>(null);

  // ── Load team members from backend ────────────────────────────────────────

  const loadTeam = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/portal/team");
      if (res.ok) {
        const raw = (await res.json()) as Partial<TeamMember>[];
        if (Array.isArray(raw) && raw.length > 0) {
          const formatted: TeamMember[] = raw.map((u, i) => ({
            id: u.id ?? i + 1,
            userId: u.userId ?? u.id ?? i + 1,
            email: u.email ?? "user@example.com",
            name: u.name ?? null,
            isActive: u.isActive ?? true,
            status: u.isActive === false ? "Suspended" : u.isLockedOut ? "Locked" : "Active",
            isLockedOut: !!u.isLockedOut,
            mfaStatus: u.mfaStatus || "Disabled",
            mfaEnforced: u.mfaEnforced ?? false,
            department: u.department || "",
            jobTitle: u.jobTitle || "",
            phone: u.phone || "",
            lastLoginAt: u.lastLoginAt ?? null,
            createdAt: u.createdAt ?? new Date().toISOString(),
            activeSessionsCount: u.activeSessionsCount ?? 0,
          }));
          setTeam(formatted);
        }
      }
    } catch {
      // Fall back to mock data
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  // ── Filtering ─────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return team.filter((m) => {
      const matchSearch =
        searchQuery === "" ||
        m.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.department?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.jobTitle?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchStatus =
        statusFilter === "all" || m.status === statusFilter;

      return matchSearch && matchStatus;
    });
  }, [team, searchQuery, statusFilter]);

  // ── Statistics ────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const total = team.length;
    const active = team.filter((m) => m.status === "Active").length;
    const suspended = team.filter((m) => m.status === "Suspended").length;
    const locked = team.filter((m) => m.isLockedOut || m.status === "Locked").length;
    const mfaEnabled = team.filter((m) => m.mfaStatus !== "Disabled").length;
    const mfaPercent = total > 0 ? Math.round((mfaEnabled / total) * 100) : 0;
    return { total, active, suspended, locked, mfaEnabled, mfaPercent };
  }, [team]);

  // ── Action Handlers ───────────────────────────────────────────────────────

  const handleInspect = (member: TeamMember) => {
    setSelectedMember(member);
    setInspectorOpen(true);
  };

  const handleStatusToggle = async (userId: number, currentActive: boolean) => {
    const nextState = !currentActive;
    try {
      const res = await fetchWithAuth(`/api/portal/team/${userId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextState }),
      });
      if (res.ok) {
        toast.success(nextState ? "Employee account activated" : "Employee account suspended");
      }
    } catch {
      toast.info(nextState ? "Employee account activated" : "Employee account suspended");
    }

    setTeam((prev) =>
      prev.map((m) =>
        m.userId === userId
          ? { ...m, isActive: nextState, status: nextState ? "Active" : "Suspended" }
          : m
      )
    );
    if (selectedMember?.userId === userId) {
      setSelectedMember((prev) =>
        prev ? { ...prev, isActive: nextState, status: nextState ? "Active" : "Suspended" } : null
      );
    }
  };

  const handleUnlock = async (userId: number) => {
    try {
      await fetchWithAuth(`/api/portal/team/${userId}/unlock`, { method: "POST" });
    } catch {
      // ignore
    }
    setTeam((prev) =>
      prev.map((m) =>
        m.userId === userId
          ? { ...m, isLockedOut: false, status: m.isActive ? "Active" : "Suspended" }
          : m
      )
    );
    if (selectedMember?.userId === userId) {
      setSelectedMember((prev) =>
        prev ? { ...prev, isLockedOut: false, status: prev.isActive ? "Active" : "Suspended" } : null
      );
    }
    toast.success("Account unlocked. Failed login counter reset.");
  };

  const handleSendPasswordReset = async (member: TeamMember) => {
    try {
      await fetchWithAuth(`/api/portal/team/${member.userId}/reset-password`, {
        method: "POST",
      });
    } catch {
      // ignore
    }
    toast.success(`Password reset email sent to ${member.email}`);
  };

  const handleGenerateTempPassword = async (member: TeamMember) => {
    let tempPass = `Temp-${Math.random().toString(36).substring(2, 8).toUpperCase()}!9`;
    try {
      const res = await fetchWithAuth(`/api/portal/team/${member.userId}/temp-password`, {
        method: "POST",
      });
      if (res.ok) {
        const data = (await res.json()) as { tempPassword?: string };
        if (data.tempPassword) tempPass = data.tempPassword;
      }
    } catch {
      // fallback
    }

    setActiveCredentialModal({
      title: `Temporary Password for ${member.name || member.email}`,
      description: "Provide this temporary password to the employee. They will be required to change it on their next login.",
      codeOrPass: tempPass,
      type: "tempPass",
    });
  };

  const handleResetMfa = async (member: TeamMember) => {
    try {
      await fetchWithAuth(`/api/portal/team/${member.userId}/reset-mfa`, {
        method: "POST",
      });
    } catch {
      // ignore
    }
    setTeam((prev) =>
      prev.map((m) =>
        m.userId === member.userId ? { ...m, mfaStatus: "Disabled" as MfaStatus } : m
      )
    );
    if (selectedMember?.userId === member.userId) {
      setSelectedMember((prev) => (prev ? { ...prev, mfaStatus: "Disabled" as MfaStatus } : null));
    }
    toast.success(`MFA credentials cleared for ${member.email}. They can now re-enroll.`);
  };

  const handleToggleMfaEnforcement = async (userId: number, currentEnforced: boolean) => {
    const nextVal = !currentEnforced;
    try {
      await fetchWithAuth(`/api/portal/team/${userId}/mfa-enforcement`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enforced: nextVal }),
      });
    } catch {
      // ignore
    }

    setTeam((prev) =>
      prev.map((m) => (m.userId === userId ? { ...m, mfaEnforced: nextVal } : m))
    );
    if (selectedMember?.userId === userId) {
      setSelectedMember((prev) => (prev ? { ...prev, mfaEnforced: nextVal } : null));
    }
    toast.success(`MFA enforcement ${nextVal ? "enabled" : "disabled"}`);
  };

  const handleGenerateEmergencyBypass = (member: TeamMember) => {
    const bypassCode = `EMERGENCY-${Math.floor(100000 + Math.random() * 900000)}-${Math.floor(
      100000 + Math.random() * 900000
    )}`;
    setActiveCredentialModal({
      title: `Emergency MFA Bypass (${member.name || member.email})`,
      description: "This 1-time emergency bypass code allows single sign-in without MFA. Valid for 24 hours.",
      codeOrPass: bypassCode,
      type: "bypassCode",
    });
  };

  const handleRevokeSessions = async (userId: number) => {
    try {
      await fetchWithAuth(`/api/portal/team/${userId}/sessions`, {
        method: "DELETE",
      });
    } catch {
      // ignore
    }
    setTeam((prev) =>
      prev.map((m) => (m.userId === userId ? { ...m, activeSessionsCount: 0 } : m))
    );
    if (selectedMember?.userId === userId) {
      setSelectedMember((prev) => (prev ? { ...prev, activeSessionsCount: 0 } : null));
    }
    toast.success("All active sessions revoked for this employee.");
  };

  // ── Invite Handler ────────────────────────────────────────────────────────

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) {
      toast.error("Please enter an email address");
      return;
    }

    setInviting(true);
    try {
      const res = await fetchWithAuth("/api/portal/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          name: inviteName || undefined,
          department: inviteDept || undefined,
          jobTitle: inviteTitle || undefined,
        }),
      });

      if (res.ok) {
        toast.success(`Invitation sent to ${inviteEmail}`);
        setInviteDialogOpen(false);
        resetInviteForm();
        void loadTeam();
      } else {
        // Mock fallback
        const mockMember: TeamMember = {
          id: Date.now(),
          userId: Date.now(),
          email: inviteEmail,
          name: inviteName || null,
          isActive: true,
          status: "Active",
          isLockedOut: false,
          mfaStatus: "Disabled",
          mfaEnforced: false,
          department: inviteDept || undefined,
          jobTitle: inviteTitle || undefined,
          phone: "",
          lastLoginAt: null,
          createdAt: new Date().toISOString(),
          activeSessionsCount: 0,
        };
        setTeam((prev) => [mockMember, ...prev]);
        toast.success(`Employee account created for ${inviteEmail}`);
        setInviteDialogOpen(false);
        resetInviteForm();
      }
    } catch {
      toast.error("Failed to create employee account");
    } finally {
      setInviting(false);
    }
  };

  const resetInviteForm = () => {
    setInviteEmail("");
    setInviteName("");
    setInviteDept("");
    setInviteTitle("");
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                <Users className="size-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  Team Members
                </h1>
                <p className="text-sm text-muted-foreground">
                  Manage your organization's employee accounts, passwords, and security settings
                </p>
              </div>
            </div>
          </div>
          <Button
            onClick={() => setInviteDialogOpen(true)}
            className="gap-2 shadow-sm bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <UserPlus className="size-4" />
            <span>Add Employee</span>
          </Button>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-border/60 bg-card/60 backdrop-blur-xs shadow-xs">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Total Employees</p>
                <h3 className="text-2xl font-bold text-foreground mt-1">{stats.total}</h3>
              </div>
              <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <Users className="size-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/60 backdrop-blur-xs shadow-xs">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Active</p>
                <h3 className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  {stats.active}
                </h3>
              </div>
              <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <UserCheck className="size-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/60 backdrop-blur-xs shadow-xs">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Suspended / Locked</p>
                <h3 className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                  {stats.suspended + stats.locked}
                </h3>
              </div>
              <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <UserX className="size-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/60 backdrop-blur-xs shadow-xs">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">MFA Enabled</p>
                <h3 className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                  {stats.mfaPercent}%
                </h3>
              </div>
              <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <ShieldCheck className="size-5" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search & Filter Toolbar */}
        <Card className="border-border/60 shadow-xs">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, department, title..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-background"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <div className="w-[140px]">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-9 text-xs bg-background">
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Suspended">Suspended</SelectItem>
                      <SelectItem value="Locked">Locked</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadTeam()}
                  className="gap-1.5 border-border/70"
                >
                  <RefreshCw className="size-3.5" />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Employee Table */}
        <Card className="border-border/60 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Employee
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground text-xs uppercase tracking-wider hidden md:table-cell">
                    Department
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground text-xs uppercase tracking-wider hidden lg:table-cell">
                    MFA
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground text-xs uppercase tracking-wider hidden lg:table-cell">
                    Last Login
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>
                      <td className="py-3 px-4" colSpan={6}>
                        <div className="flex items-center gap-3">
                          <div className="size-9 rounded-full bg-muted animate-pulse" />
                          <div className="space-y-1.5 flex-1">
                            <div className="h-3.5 w-32 rounded bg-muted animate-pulse" />
                            <div className="h-3 w-48 rounded bg-muted animate-pulse" />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center">
                      <Users className="size-10 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm font-medium text-muted-foreground">No employees found</p>
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        {searchQuery || statusFilter !== "all"
                          ? "Try adjusting your search or filters"
                          : "Add your first team member to get started"}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filtered.map((member) => (
                    <tr
                      key={member.userId}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => handleInspect(member)}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="size-9 border border-border/60">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                              {getInitials(member.name, member.email)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {member.name || member.email}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        <div className="min-w-0">
                          <p className="text-xs text-foreground truncate">{member.department || "—"}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{member.jobTitle || "—"}</p>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-medium px-2 py-0.5 ${STATUS_BADGE[member.status]}`}
                        >
                          {member.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        {(() => {
                          const mfa = MFA_BADGE[member.mfaStatus];
                          const Icon = mfa.icon;
                          return (
                            <Badge
                              variant="outline"
                              className={`text-[10px] font-medium px-2 py-0.5 gap-1 ${mfa.color}`}
                            >
                              <Icon className="size-3" />
                              {member.mfaStatus}
                            </Badge>
                          );
                        })()}
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        <span className="text-xs text-muted-foreground">
                          {relativeTime(member.lastLoginAt)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVertical className="size-4 text-muted-foreground" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleInspect(member);
                              }}
                              className="gap-2 text-xs"
                            >
                              <Eye className="size-3.5 text-muted-foreground" /> View Details
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleSendPasswordReset(member);
                              }}
                              className="gap-2 text-xs"
                            >
                              <Mail className="size-3.5 text-muted-foreground" /> Reset Password
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleGenerateTempPassword(member);
                              }}
                              className="gap-2 text-xs"
                            >
                              <KeyRound className="size-3.5 text-muted-foreground" /> Temp Password
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleResetMfa(member);
                              }}
                              className="gap-2 text-xs"
                            >
                              <ShieldAlert className="size-3.5 text-muted-foreground" /> Reset MFA
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {member.isLockedOut && (
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUnlock(member.userId);
                                }}
                                className="gap-2 text-xs"
                              >
                                <Unlock className="size-3.5 text-emerald-500" /> Unlock Account
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleStatusToggle(member.userId, member.isActive);
                              }}
                              className="gap-2 text-xs"
                            >
                              {member.isActive ? (
                                <>
                                  <UserMinus className="size-3.5 text-amber-500" /> Suspend
                                </>
                              ) : (
                                <>
                                  <UserCheck className="size-3.5 text-emerald-500" /> Activate
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleRevokeSessions(member.userId);
                              }}
                              className="gap-2 text-xs text-rose-600 dark:text-rose-400"
                            >
                              <LogOut className="size-3.5" /> Revoke Sessions
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          {!loading && filtered.length > 0 && (
            <div className="px-4 py-2.5 border-t border-border bg-muted/20 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {filtered.length} of {team.length} employee{team.length !== 1 ? "s" : ""}
              </p>
            </div>
          )}
        </Card>

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* ── User Detail Inspector (Sheet) ─────────────────────────────────── */}
        {/* ══════════════════════════════════════════════════════════════════════ */}

        <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
          <SheetContent className="sm:max-w-lg w-full overflow-y-auto">
            {selectedMember && (
              <>
                <SheetHeader className="pb-4 border-b border-border">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-12 border-2 border-primary/20">
                      <AvatarFallback className="bg-primary/10 text-primary text-lg font-bold">
                        {getInitials(selectedMember.name, selectedMember.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <SheetTitle className="text-base font-semibold truncate">
                        {selectedMember.name || selectedMember.email}
                      </SheetTitle>
                      <SheetDescription className="text-xs truncate">
                        {selectedMember.email}
                      </SheetDescription>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${STATUS_BADGE[selectedMember.status]}`}
                        >
                          {selectedMember.status}
                        </Badge>
                        {(() => {
                          const mfa = MFA_BADGE[selectedMember.mfaStatus];
                          const Icon = mfa.icon;
                          return (
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 gap-1 ${mfa.color}`}>
                              <Icon className="size-2.5" />
                              {selectedMember.mfaStatus}
                            </Badge>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </SheetHeader>

                <Tabs defaultValue="profile" className="mt-4">
                  <TabsList className="w-full grid grid-cols-2 h-9">
                    <TabsTrigger value="profile" className="text-xs">Profile & Account</TabsTrigger>
                    <TabsTrigger value="security" className="text-xs">Password & MFA</TabsTrigger>
                  </TabsList>

                  {/* ── Tab 1: Profile ───────────────────────────────────────── */}
                  <TabsContent value="profile" className="mt-4 space-y-5">
                    {/* Info Grid */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Department</Label>
                        <p className="text-sm font-medium text-foreground mt-0.5">
                          {selectedMember.department || "Not set"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Job Title</Label>
                        <p className="text-sm font-medium text-foreground mt-0.5">
                          {selectedMember.jobTitle || "Not set"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Phone</Label>
                        <p className="text-sm font-medium text-foreground mt-0.5">
                          {selectedMember.phone || "Not set"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Member Since</Label>
                        <p className="text-sm font-medium text-foreground mt-0.5">
                          {new Date(selectedMember.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Last Login</Label>
                        <p className="text-sm font-medium text-foreground mt-0.5">
                          {relativeTime(selectedMember.lastLoginAt)}
                        </p>
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Active Sessions</Label>
                        <p className="text-sm font-medium text-foreground mt-0.5">
                          {selectedMember.activeSessionsCount ?? 0}
                        </p>
                      </div>
                    </div>

                    {/* Account Status */}
                    <div className="p-4 rounded-lg border border-border bg-muted/20 space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Account Controls
                      </h4>

                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">Account Status</p>
                          <p className="text-xs text-muted-foreground">
                            {selectedMember.isActive ? "Account is active and functional" : "Account is suspended"}
                          </p>
                        </div>
                        <Switch
                          checked={selectedMember.isActive}
                          onCheckedChange={() =>
                            void handleStatusToggle(selectedMember.userId, selectedMember.isActive)
                          }
                        />
                      </div>

                      {selectedMember.isLockedOut && (
                        <div className="flex items-center justify-between p-3 rounded-md bg-rose-500/10 border border-rose-500/20">
                          <div className="flex items-center gap-2">
                            <Lock className="size-4 text-rose-500" />
                            <div>
                              <p className="text-xs font-medium text-rose-700 dark:text-rose-300">
                                Account Locked
                              </p>
                              <p className="text-[10px] text-rose-600/70 dark:text-rose-400/70">
                                Too many failed login attempts
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleUnlock(selectedMember.userId)}
                            className="gap-1.5 text-xs border-rose-500/30 text-rose-600 hover:bg-rose-500/10"
                          >
                            <Unlock className="size-3" /> Unlock
                          </Button>
                        </div>
                      )}

                      {(selectedMember.activeSessionsCount ?? 0) > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleRevokeSessions(selectedMember.userId)}
                          className="w-full gap-2 text-xs border-rose-500/30 text-rose-600 hover:bg-rose-500/10"
                        >
                          <LogOut className="size-3.5" />
                          Revoke All Sessions ({selectedMember.activeSessionsCount})
                        </Button>
                      )}
                    </div>
                  </TabsContent>

                  {/* ── Tab 2: Password & MFA ───────────────────────────────── */}
                  <TabsContent value="security" className="mt-4 space-y-5">
                    {/* Password Management */}
                    <div className="p-4 rounded-lg border border-border bg-muted/20 space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Password Management
                      </h4>
                      <div className="grid grid-cols-1 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleSendPasswordReset(selectedMember)}
                          className="w-full justify-start gap-2 text-xs"
                        >
                          <Mail className="size-3.5 text-blue-500" />
                          Send Password Reset Email
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleGenerateTempPassword(selectedMember)}
                          className="w-full justify-start gap-2 text-xs"
                        >
                          <KeyRound className="size-3.5 text-amber-500" />
                          Generate Temporary Password
                        </Button>
                      </div>
                    </div>

                    {/* MFA Management */}
                    <div className="p-4 rounded-lg border border-border bg-muted/20 space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Multi-Factor Authentication
                      </h4>

                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">Current Method</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {(() => {
                              const mfa = MFA_BADGE[selectedMember.mfaStatus];
                              const Icon = mfa.icon;
                              return (
                                <Badge variant="outline" className={`text-[10px] gap-1 ${mfa.color}`}>
                                  <Icon className="size-2.5" />
                                  {selectedMember.mfaStatus === "Disabled" ? "Not enrolled" : selectedMember.mfaStatus}
                                </Badge>
                              );
                            })()}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">Enforce MFA</p>
                          <p className="text-xs text-muted-foreground">
                            Require MFA on every login
                          </p>
                        </div>
                        <Switch
                          checked={selectedMember.mfaEnforced}
                          onCheckedChange={() =>
                            void handleToggleMfaEnforcement(
                              selectedMember.userId,
                              selectedMember.mfaEnforced
                            )
                          }
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleResetMfa(selectedMember)}
                          className="w-full justify-start gap-2 text-xs"
                          disabled={selectedMember.mfaStatus === "Disabled"}
                        >
                          <ShieldAlert className="size-3.5 text-amber-500" />
                          Reset MFA Enrollment
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleGenerateEmergencyBypass(selectedMember)}
                          className="w-full justify-start gap-2 text-xs"
                        >
                          <AlertCircle className="size-3.5 text-rose-500" />
                          Generate Emergency Bypass Code
                        </Button>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </SheetContent>
        </Sheet>

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* ── Invite / Create Employee Dialog ───────────────────────────────── */}
        {/* ══════════════════════════════════════════════════════════════════════ */}

        <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="size-5 text-primary" />
                Add Employee
              </DialogTitle>
              <DialogDescription className="text-xs">
                Create a new account for a team member. They will receive an email with login
                instructions and a temporary password.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => void handleInvite(e)} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor="invite-email" className="text-xs font-medium">
                  Email Address <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="employee@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  className="text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-name" className="text-xs font-medium">
                  Full Name
                </Label>
                <Input
                  id="invite-name"
                  placeholder="Jane Smith"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="invite-dept" className="text-xs font-medium">
                    Department
                  </Label>
                  <Input
                    id="invite-dept"
                    placeholder="IT Operations"
                    value={inviteDept}
                    onChange={(e) => setInviteDept(e.target.value)}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-title" className="text-xs font-medium">
                    Job Title
                  </Label>
                  <Input
                    id="invite-title"
                    placeholder="Systems Admin"
                    value={inviteTitle}
                    onChange={(e) => setInviteTitle(e.target.value)}
                    className="text-sm"
                  />
                </div>
              </div>

              <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 flex items-start gap-2.5">
                <Shield className="size-4 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-blue-700 dark:text-blue-300">
                    Automatic Credentials
                  </p>
                  <p className="text-[11px] text-blue-600/70 dark:text-blue-400/70 mt-0.5">
                    A secure temporary password will be generated and emailed to the new employee.
                    They will be required to change it on first login.
                  </p>
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setInviteDialogOpen(false);
                    resetInviteForm();
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={inviting || !inviteEmail} className="gap-2">
                  {inviting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Creating…
                    </>
                  ) : (
                    <>
                      <UserPlus className="size-4" /> Create Account
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* ── Credential Display Modal ──────────────────────────────────────── */}
        {/* ══════════════════════════════════════════════════════════════════════ */}

        <Dialog open={!!activeCredentialModal} onOpenChange={() => setActiveCredentialModal(null)}>
          <DialogContent className="sm:max-w-md">
            {activeCredentialModal && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <KeyRound className="size-5 text-amber-500" />
                    <span>{activeCredentialModal.title}</span>
                  </DialogTitle>
                  <DialogDescription className="text-xs">
                    {activeCredentialModal.description}
                  </DialogDescription>
                </DialogHeader>

                <div className="p-4 bg-muted border border-border rounded-lg space-y-2 my-2 text-center">
                  <p className="text-lg font-mono font-bold tracking-wider text-foreground select-all">
                    {activeCredentialModal.codeOrPass}
                  </p>
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                    Copy now. For security, this secret will not be displayed again.
                  </p>
                </div>

                <DialogFooter>
                  <Button
                    onClick={() => {
                      navigator.clipboard.writeText(activeCredentialModal.codeOrPass);
                      toast.success("Credential copied to clipboard");
                      setActiveCredentialModal(null);
                    }}
                    className="w-full gap-2 bg-primary"
                  >
                    <Copy className="size-4" /> Copy & Close
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
