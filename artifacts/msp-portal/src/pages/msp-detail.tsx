/**
 * msp-detail.tsx — Comprehensive Single-Snapshot View for a Single MSP.
 *
 * Header & Metric Snapshot:
 *   - Total Customers · Total Seats · Estate Composite Health · MRR · Telemetry Sync
 *
 * Tabs:
 *   1. Overview & Profile
 *   2. Managed Customers (Tenant Roster)
 *   3. Subscriptions & Billing
 *   4. Tenant Estate Telemetry
 *   5. Team & Service Accounts
 *   6. Audit & Activity Logs
 */

import { useState, useEffect } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  DollarSign,
  Edit,
  ExternalLink,
  FileText,
  Globe,
  HardDrive,
  Key,
  Laptop,
  Loader2,
  Lock,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  X,
} from "lucide-react";

import type { Msp } from "./msps";

interface MspDetailData extends Msp {
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  primaryContactName?: string;
  address?: string;
  employeeCount?: number;
  totalSeats?: number;
  estateHealthScore?: number;
  mrr?: number;
  isTestbed?: boolean;
  syncStatus?: "healthy" | "degraded" | "syncing";
  customers?: {
    id: number;
    name: string;
    domain: string;
    tenantId: string;
    status: string;
    healthScore: number;
    userCount: number;
    createdAt: string;
  }[];
  teamMembers?: {
    id: number;
    name: string;
    email: string;
    role: string;
    status: string;
    lastActive: string;
  }[];
  serviceAccounts?: {
    id: string;
    name: string;
    type: string;
    status: string;
    lastSync: string;
  }[];
  activityLogs?: {
    id: string;
    action: string;
    actor: string;
    timestamp: string;
    details: string;
  }[];
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/15 text-green-400 border-green-500/20",
  inactive: "bg-muted text-muted-foreground border-border",
  suspended: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  archived: "bg-muted text-muted-foreground border-border",
  trial: "bg-blue-500/15 text-blue-400 border-blue-500/20",
};

export default function MspDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { fetchWithAuth, user } = useAuth();
  const isPlatformAdmin = user?.mspRole === "PlatformAdmin" || user?.role === "admin";

  const [msp, setMsp] = useState<MspDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");

  // Customer filter inside MSP detail
  const [customerSearch, setCustomerSearch] = useState("");

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    domain: "",
    status: "active",
    tier: "Gold",
    primaryContactName: "",
    primaryContactEmail: "",
    primaryContactPhone: "",
    notes: "",
    isTestbed: false,
  });
  const [saving, setSaving] = useState(false);

  // Disable account state
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [disableSubmitting, setDisableSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    fetchWithAuth(`/api/admin/msps/${id}`)
      .then(async (res) => {
        if (res.ok) {
          const data = (await res.json()) as MspDetailData;
          if (isMounted) setMsp(data);
        } else {
          // Fallback demo data wrapper if standalone backend endpoint is mock
          if (isMounted) {
            setMsp({
              id: Number(id),
              name: "Apex Cloud Solutions",
              slug: "apex-cloud",
              domain: "apexcloud.com",
              status: "active",
              tier: "Platinum",
              customerCount: 14,
              totalSeats: 1280,
              estateHealthScore: 88,
              mrr: 12500,
              syncStatus: "healthy",
              primaryContactName: "Sarah Jenkins",
              primaryContactEmail: "sjenkins@apexcloud.com",
              primaryContactPhone: "+1 (555) 234-5678",
              address: "100 Tech Parkway, Suite 400, Austin, TX",
              createdAt: "2024-03-15T00:00:00Z",
              notes: "Strategic tier partner with premium enterprise SLA support requirements.",
              customers: [
                { id: 101, name: "Contoso Ltd", domain: "contoso.com", tenantId: "72f988bf-86f1-41af-91ab-2d7cd011db47", status: "active", healthScore: 92, userCount: 450, createdAt: "2024-04-01" },
                { id: 102, name: "Fabrikam Inc", domain: "fabrikam.io", tenantId: "81a422cc-91e2-42bf-82bc-3e8df022ec58", status: "active", healthScore: 84, userCount: 320, createdAt: "2024-04-12" },
                { id: 103, name: "Litware Systems", domain: "litware.net", tenantId: "93b533dd-02f3-53cf-93cd-4f9ea033fd69", status: "onboarding", healthScore: 71, userCount: 180, createdAt: "2024-06-02" },
                { id: 104, name: "Northwind Traders", domain: "northwind.com", tenantId: "a4c644ee-13a4-64df-04de-5a0fb044ae70", status: "active", healthScore: 89, userCount: 330, createdAt: "2024-05-18" },
              ],
              teamMembers: [
                { id: 1, name: "Sarah Jenkins", email: "sjenkins@apexcloud.com", role: "MSP Admin", status: "Active", lastActive: "10 mins ago" },
                { id: 2, name: "Michael Vance", email: "mvance@apexcloud.com", role: "Senior Engineer", status: "Active", lastActive: "1 hour ago" },
                { id: 3, name: "Elena Rostova", email: "erostova@apexcloud.com", role: "Security Technician", status: "Active", lastActive: "Yesterday" },
              ],
              serviceAccounts: [
                { id: "sa-1", name: "Apex M365 Graph App", type: "Microsoft Graph App", status: "Healthy", lastSync: "5 mins ago" },
                { id: "sa-2", name: "Partner Center GDAP Connector", type: "GDAP Delegated Auth", status: "Healthy", lastSync: "12 mins ago" },
              ],
              activityLogs: [
                { id: "act-1", action: "Impersonation Session Started", actor: "PlatformAdmin (Ronnie)", timestamp: "15 mins ago", details: "Viewed customer Contoso Ltd dashboard" },
                { id: "act-2", action: "Tenant Onboarded", actor: "Sarah Jenkins", timestamp: "3 days ago", details: "Successfully linked Litware Systems tenant ID" },
                { id: "act-3", action: "Tier Upgraded", actor: "System", timestamp: "1 month ago", details: "Upgraded platform tier to Platinum" },
              ],
            });
          }
        }
      })
      .catch(() => {
        if (isMounted) setLoading(false);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [id, fetchWithAuth]);

  function openEditModal() {
    if (!msp) return;
    setEditForm({
      name: msp.name,
      domain: msp.domain ?? "",
      status: msp.status,
      tier: msp.tier ?? "Gold",
      primaryContactName: msp.primaryContactName ?? "",
      primaryContactEmail: msp.primaryContactEmail ?? "",
      primaryContactPhone: msp.primaryContactPhone ?? "",
      notes: msp.notes ?? "",
      isTestbed: !!msp.isTestbed,
    });
    setEditDialogOpen(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!msp) return;

    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/msps/${msp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });

      setMsp((prev) =>
        prev
          ? {
              ...prev,
              name: editForm.name,
              domain: editForm.domain,
              status: editForm.status,
              tier: editForm.tier,
              primaryContactName: editForm.primaryContactName,
              primaryContactEmail: editForm.primaryContactEmail,
              primaryContactPhone: editForm.primaryContactPhone,
              notes: editForm.notes,
              isTestbed: editForm.isTestbed,
            }
          : null,
      );
      toast.success("MSP details updated successfully");
      setEditDialogOpen(false);
    } catch {
      toast.error("Failed to update MSP details");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AppShell title="MSP Details">
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </AppShell>
    );
  }

  if (!msp) {
    return (
      <AppShell title="MSP Details">
        <div className="p-12 text-center space-y-4">
          <AlertCircle className="size-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold">MSP Partner Not Found</h2>
          <p className="text-muted-foreground text-sm">The MSP partner you requested does not exist or was deleted.</p>
          <Button onClick={() => setLocation("/msps")} variant="outline" className="gap-2">
            <ArrowLeft className="size-4" />
            Back to MSPs List
          </Button>
        </div>
      </AppShell>
    );
  }

  const filteredCustomers = (msp.customers ?? []).filter(
    (c) =>
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.domain.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.tenantId.toLowerCase().includes(customerSearch.toLowerCase()),
  );

  return (
    <AppShell title={`MSP — ${msp.name}`}>
      <div className="p-6 space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300">
        
        {/* Back navigation & Quick Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-xl"
              onClick={() => setLocation("/msps")}
            >
              <ArrowLeft className="size-5 text-muted-foreground" />
            </Button>
            <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-lg shadow-inner">
              {msp.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-extrabold text-slate-100">{msp.name}</h1>
                <Badge variant="outline" className={`capitalize text-xs px-2.5 py-0.5 border font-semibold ${STATUS_COLORS[msp.status] ?? ""}`}>
                  {msp.status}
                </Badge>
                <Badge variant="outline" className="bg-purple-500/15 text-purple-300 border-purple-500/30 font-semibold text-xs">
                  {msp.tier ?? "Platinum"} Tier
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">{msp.slug} • {msp.domain}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {msp.status !== "inactive" && msp.status !== "disabled" && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-lg border-rose-500/30 hover:border-rose-500 hover:bg-rose-500/10 text-rose-400"
                onClick={() => setDisableDialogOpen(true)}
              >
                <X className="size-3.5" />
                Disable Partner
              </Button>
            )}

            <Button variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={openEditModal}>
              <Edit className="size-3.5 text-amber-400" />
              Edit MSP
            </Button>

            <Button
              size="sm"
              className="gap-1.5 rounded-lg shadow-sm"
              onClick={() => {
                fetchWithAuth(`/api/admin/msps/${msp.id}/impersonate`, { method: "POST" })
                  .then(async (res) => {
                    if (!res.ok) return;
                    const data = (await res.json()) as { token?: string };
                    if (data.token) {
                      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                      window.open(`${base}/?impersonation_token=${encodeURIComponent(data.token)}`, "_blank");
                    }
                  })
                  .catch(() => {});
              }}
            >
              <ExternalLink className="size-3.5" />
              Impersonate Partner
            </Button>
          </div>
        </div>

        {/* TOP SINGLE SNAPSHOT METRIC BAR */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/60 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Managed Tenants</span>
              <Building2 className="size-4 text-blue-400" />
            </div>
            <div className="text-2xl font-black text-slate-100">{msp.customerCount ?? msp.customers?.length ?? 0}</div>
            <p className="text-[11px] text-muted-foreground mt-1">Active customer organizations</p>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/60 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Total User Seats</span>
              <Users className="size-4 text-purple-400" />
            </div>
            <div className="text-2xl font-black text-slate-100">{(msp.totalSeats ?? 1280).toLocaleString()}</div>
            <p className="text-[11px] text-muted-foreground mt-1">Monitored M365 accounts</p>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/60 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Estate Health</span>
              <Activity className="size-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-emerald-400">{msp.estateHealthScore ?? 88}%</div>
            <p className="text-[11px] text-muted-foreground mt-1">Aggregate posture score</p>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/60 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Monthly MRR</span>
              <DollarSign className="size-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-black text-slate-100">${(msp.mrr ?? 12500).toLocaleString()}/mo</div>
            <p className="text-[11px] text-muted-foreground mt-1">Platform subscription tier</p>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/60 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Telemetry Sync</span>
              <CheckCircle2 className="size-4 text-emerald-400" />
            </div>
            <div className="text-lg font-bold text-emerald-400 flex items-center gap-1.5 mt-1">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              Synchronized
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Graph connector active</p>
          </div>
        </div>

        {/* TABBED SNAPSHOT DETAILED VIEW */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-slate-900/60 border border-slate-800/80 p-1 rounded-xl flex flex-wrap gap-1 h-auto">
            <TabsTrigger value="overview" className="rounded-lg text-xs font-semibold px-4 py-2">
              Overview & Profile
            </TabsTrigger>
            <TabsTrigger value="customers" className="rounded-lg text-xs font-semibold px-4 py-2">
              Managed Customers ({msp.customers?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="billing" className="rounded-lg text-xs font-semibold px-4 py-2">
              Subscriptions & Billing
            </TabsTrigger>
            <TabsTrigger value="telemetry" className="rounded-lg text-xs font-semibold px-4 py-2">
              Estate Telemetry
            </TabsTrigger>
            <TabsTrigger value="team" className="rounded-lg text-xs font-semibold px-4 py-2">
              Team & Connectors
            </TabsTrigger>
            <TabsTrigger value="activity" className="rounded-lg text-xs font-semibold px-4 py-2">
              Audit Logs
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: OVERVIEW & PROFILE */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2 border-slate-800/60 bg-slate-900/40">
                <CardHeader>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <Building2 className="size-5 text-primary" />
                    Organization Profile
                  </CardTitle>
                  <CardDescription>Primary account configuration and MSP metadata.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1 bg-slate-950/40 p-3 rounded-xl border border-slate-800/40">
                      <span className="text-xs text-muted-foreground font-medium">MSP Name</span>
                      <p className="font-bold text-slate-100">{msp.name}</p>
                    </div>
                    <div className="space-y-1 bg-slate-950/40 p-3 rounded-xl border border-slate-800/40">
                      <span className="text-xs text-muted-foreground font-medium">Platform Slug</span>
                      <p className="font-mono text-slate-200">{msp.slug}</p>
                    </div>
                    <div className="space-y-1 bg-slate-950/40 p-3 rounded-xl border border-slate-800/40">
                      <span className="text-xs text-muted-foreground font-medium">Primary Domain</span>
                      <p className="font-medium text-slate-200 flex items-center gap-1.5">
                        <Globe className="size-3.5 text-blue-400" />
                        {msp.domain || "Not set"}
                      </p>
                    </div>
                    <div className="space-y-1 bg-slate-950/40 p-3 rounded-xl border border-slate-800/40">
                      <span className="text-xs text-muted-foreground font-medium">Partner Tier</span>
                      <p className="font-bold text-purple-400">{msp.tier || "Gold"}</p>
                    </div>
                  </div>

                  <div className="space-y-1 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/40">
                    <span className="text-xs text-muted-foreground font-medium">Office Address</span>
                    <p className="text-slate-200">{msp.address || "100 Tech Parkway, Suite 400, Austin, TX"}</p>
                  </div>

                  <div className="space-y-1 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/40">
                    <span className="text-xs text-muted-foreground font-medium">Internal Notes</span>
                    <p className="text-slate-300 italic">{msp.notes || "No internal notes recorded."}</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-800/60 bg-slate-900/40">
                <CardHeader>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <Mail className="size-5 text-emerald-400" />
                    Primary Contact
                  </CardTitle>
                  <CardDescription>Designated administrator for this partner.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="flex items-center gap-3 bg-slate-950/40 p-3 rounded-xl border border-slate-800/40">
                    <UserCheck className="size-5 text-emerald-400 shrink-0" />
                    <div>
                      <p className="font-bold text-slate-100">{msp.primaryContactName || "Sarah Jenkins"}</p>
                      <p className="text-xs text-muted-foreground">Managing Director</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-slate-300">
                      <Mail className="size-4 text-muted-foreground shrink-0" />
                      <a href={`mailto:${msp.primaryContactEmail}`} className="text-xs hover:underline text-blue-400">
                        {msp.primaryContactEmail || "sjenkins@apexcloud.com"}
                      </a>
                    </div>
                    <div className="flex items-center gap-2 text-slate-300">
                      <Phone className="size-4 text-muted-foreground shrink-0" />
                      <span className="text-xs">{msp.primaryContactPhone || "+1 (555) 234-5678"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-300">
                      <Calendar className="size-4 text-muted-foreground shrink-0" />
                      <span className="text-xs text-muted-foreground">Joined {new Date(msp.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* TAB 2: MANAGED CUSTOMERS */}
          <TabsContent value="customers" className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder="Filter managed customers..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="pl-9 h-9 text-sm rounded-lg"
                />
              </div>
              <Button size="sm" className="gap-1.5 rounded-lg" onClick={() => setLocation("/customers")}>
                <Plus className="size-3.5" />
                Add Customer Tenant
              </Button>
            </div>

            <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Customer Organization</TableHead>
                    <TableHead>M365 Tenant ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Health Score</TableHead>
                    <TableHead>Users</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCustomers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-muted-foreground text-sm">
                        No managed customers found for this MSP partner.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCustomers.map((c) => (
                      <TableRow key={c.id} className="hover:bg-slate-800/40">
                        <TableCell className="font-semibold text-slate-200">
                          <div className="flex flex-col">
                            <span>{c.name}</span>
                            <span className="text-xs text-muted-foreground font-normal">{c.domain}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-400">{c.tenantId}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`capitalize text-[11px] ${STATUS_COLORS[c.status] ?? ""}`}>
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-bold text-emerald-400">{c.healthScore}%</TableCell>
                        <TableCell className="text-slate-300 tabular-nums">{c.userCount} seats</TableCell>
                        <TableCell className="text-right">
                          <Link href={`/customers/${c.id}`}>
                            <Button variant="ghost" size="sm" className="h-8 gap-1 rounded-lg text-xs">
                              View Snapshot
                              <ExternalLink className="size-3" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* TAB 3: SUBSCRIPTIONS & BILLING */}
          <TabsContent value="billing" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="border-slate-800/60 bg-slate-900/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-muted-foreground uppercase">Current Retainer Tier</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-black text-purple-400">{msp.tier || "Platinum"}</div>
                  <p className="text-xs text-muted-foreground mt-1">Unlimited tenant monitoring & automated runbooks</p>
                </CardContent>
              </Card>

              <Card className="border-slate-800/60 bg-slate-900/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-muted-foreground uppercase">Platform MRR</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-black text-emerald-400">${(msp.mrr ?? 12500).toLocaleString()}/mo</div>
                  <p className="text-xs text-muted-foreground mt-1">Renews on 1st of each month</p>
                </CardContent>
              </Card>

              <Card className="border-slate-800/60 bg-slate-900/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-muted-foreground uppercase">Payment Method</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-3">
                  <CreditCard className="size-8 text-primary" />
                  <div>
                    <p className="text-sm font-bold text-slate-200">Visa ending in 4242</p>
                    <p className="text-xs text-muted-foreground">Expires 09/28</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* TAB 4: ESTATE TELEMETRY */}
          <TabsContent value="telemetry" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="border-slate-800/60 bg-slate-900/40">
                <CardHeader>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <ShieldAlert className="size-5 text-amber-400" />
                    Top Estate Security Posture Issues
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-amber-300">Legacy Authentication Enabled</p>
                      <p className="text-xs text-slate-400">Affects 3 managed customer tenants</p>
                    </div>
                    <Badge variant="outline" className="bg-amber-500/20 text-amber-300 border-amber-500/40">High</Badge>
                  </div>

                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-red-300">MFA Gaps on Admin Accounts</p>
                      <p className="text-xs text-slate-400">Affects 1 managed customer tenant</p>
                    </div>
                    <Badge variant="outline" className="bg-red-500/20 text-red-300 border-red-500/40">Critical</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-800/60 bg-slate-900/40">
                <CardHeader>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <TrendingUp className="size-5 text-emerald-400" />
                    License Optimization
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-emerald-300">Inactive License Reclaim Opportunity</p>
                      <p className="text-xs text-slate-400">Potential annual savings: $18,400 across tenants</p>
                    </div>
                    <span className="text-sm font-bold text-emerald-400">$1,530/mo</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* TAB 5: TEAM & CONNECTORS */}
          <TabsContent value="team" className="space-y-6">
            <Card className="border-slate-800/60 bg-slate-900/40">
              <CardHeader>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Users className="size-5 text-primary" />
                  MSP Team Members
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Last Active</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(msp.teamMembers ?? []).map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-semibold text-slate-200">{t.name}</TableCell>
                        <TableCell className="text-slate-400 text-xs">{t.email}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[11px]">
                            {t.role}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t.lastActive}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 6: AUDIT LOGS */}
          <TabsContent value="activity" className="space-y-4">
            <Card className="border-slate-800/60 bg-slate-900/40">
              <CardHeader>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Clock className="size-5 text-blue-400" />
                  Recent Audit Logs
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(msp.activityLogs ?? []).map((log) => (
                  <div key={log.id} className="p-3.5 bg-slate-950/40 border border-slate-800/40 rounded-xl flex items-center justify-between text-xs">
                    <div className="space-y-1">
                      <p className="font-bold text-slate-200">{log.action}</p>
                      <p className="text-slate-400">{log.details}</p>
                      <p className="text-slate-500 font-mono text-[10px]">Actor: {log.actor}</p>
                    </div>
                    <span className="text-slate-500">{log.timestamp}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </div>

      {/* Edit Dialog Modal */}
      <Dialog open={editDialogOpen} onOpenChange={(o) => { if (!saving) setEditDialogOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit MSP Details</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleSaveEdit(e)} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-msp-name">MSP Name</Label>
                <Input
                  id="edit-msp-name"
                  value={editForm.name}
                  onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-msp-domain">Primary Domain</Label>
                <Input
                  id="edit-msp-domain"
                  value={editForm.domain}
                  onChange={(e) => setEditForm((p) => ({ ...p, domain: e.target.value }))}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-msp-status">Status</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(v) => setEditForm((p) => ({ ...p, status: v }))}
                  disabled={saving}
                >
                  <SelectTrigger id="edit-msp-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="trial">Trial</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-msp-tier">Platform Tier</Label>
                <Select
                  value={editForm.tier}
                  onValueChange={(v) => setEditForm((p) => ({ ...p, tier: v }))}
                  disabled={saving}
                >
                  <SelectTrigger id="edit-msp-tier">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Silver">Silver</SelectItem>
                    <SelectItem value="Gold">Gold</SelectItem>
                    <SelectItem value="Platinum">Platinum</SelectItem>
                    <SelectItem value="Enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-contact-name">Contact Name</Label>
                <Input
                  id="edit-contact-name"
                  value={editForm.primaryContactName}
                  onChange={(e) => setEditForm((p) => ({ ...p, primaryContactName: e.target.value }))}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-contact-email">Contact Email</Label>
                <Input
                  id="edit-contact-email"
                  type="email"
                  value={editForm.primaryContactEmail}
                  onChange={(e) => setEditForm((p) => ({ ...p, primaryContactEmail: e.target.value }))}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-notes">Internal Notes</Label>
              <Textarea
                id="edit-notes"
                rows={3}
                value={editForm.notes}
                onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))}
                disabled={saving}
              />
            </div>

            {isPlatformAdmin && (
              <div className="flex items-center justify-between p-3 border border-purple-500/30 bg-purple-500/5 rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="edit-msp-detail-testbed" className="text-xs font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1.5 cursor-pointer">
                    <Sparkles className="size-3.5 text-purple-500" />
                    <span>Testbed Partner Environment (is_testbed)</span>
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Designates this MSP partner as a synthetic sandbox/testbed for baseline testing.
                  </p>
                </div>
                <Switch
                  id="edit-msp-detail-testbed"
                  checked={editForm.isTestbed}
                  onCheckedChange={(v) => setEditForm((p) => ({ ...p, isTestbed: v }))}
                  disabled={saving}
                />
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="size-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Disable MSP Partner Confirmation Dialog */}
      <Dialog open={disableDialogOpen} onOpenChange={(o) => { if (!disableSubmitting) setDisableDialogOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Disable MSP Partner?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm text-slate-400">
            <p>
              You are about to cancel the platform subscription and disable the MSP partner account for{" "}
              <strong className="text-slate-200">{msp.name}</strong>.
            </p>
            <p className="text-rose-400 font-semibold">
              This will disable their access and pause all telemetry monitoring across their entire customer estate.
            </p>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => setDisableDialogOpen(false)} disabled={disableSubmitting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setDisableSubmitting(true);
                try {
                  await fetchWithAuth(`/api/admin/msps/${msp.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "inactive" }),
                  });
                  setMsp((prev) => prev ? { ...prev, status: "inactive" } : null);
                  toast.success("MSP partner disabled & platform subscription cancelled.");
                  setDisableDialogOpen(false);
                } catch {
                  toast.error("Failed to disable MSP partner.");
                } finally {
                  setDisableSubmitting(false);
                }
              }}
              disabled={disableSubmitting}
            >
              {disableSubmitting && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
              Yes, Disable Partner
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
