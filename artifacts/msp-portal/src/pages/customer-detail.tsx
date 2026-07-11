/**
 * CustomerDetail — tabbed scaffold for a single customer.
 *
 * Tabs (scaffold — content populated by downstream tasks):
 *   Overview · Documents · Monitoring · Offers · Billing · Reports
 */

import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Activity,
  ArrowLeft,
  Building2,
  Calendar,
  DollarSign,
  FileText,
  Globe,
  LayoutDashboard,
  Mail,
  MoreHorizontal,
  Phone,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CustomerDetail {
  id: number;
  name: string;
  domain?: string;
  status: "active" | "inactive" | "onboarding" | "archived";
  tenantId?: string;
  primaryContact?: string;
  primaryEmail?: string;
  primaryPhone?: string;
  employeeCount?: number;
  mspId?: number;
  mspName?: string;
  createdAt: string;
  notes?: string;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/15 text-green-400 border-green-500/20",
  inactive: "bg-muted text-muted-foreground border-border",
  onboarding: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  archived: "bg-amber-500/15 text-amber-400 border-amber-500/20",
};

// ── Placeholder tab content ───────────────────────────────────────────────────

function PlaceholderTab({ icon: Icon, label, description }: { icon: React.ElementType; label: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <div className="rounded-xl bg-muted/40 p-4">
        <Icon className="size-7 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">{description}</p>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { fetchWithAuth } = useAuth();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchWithAuth(`/api/msp/customers/${id}`)
      .then(async (res) => {
        if (res.ok && mounted) {
          const data = (await res.json()) as CustomerDetail;
          setCustomer(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const breadcrumb = (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Link href="/customers">
        <button className="flex items-center gap-1 hover:text-foreground transition-colors">
          <ArrowLeft className="size-3.5" />
          Customers
        </button>
      </Link>
      <span>/</span>
      {loading ? (
        <Skeleton className="h-4 w-28 inline-block" />
      ) : (
        <span className="text-foreground font-medium">{customer?.name ?? `Customer #${id}`}</span>
      )}
    </div>
  );

  const title = loading
    ? "Customer"
    : (customer?.name ?? `Customer #${id}`);

  return (
    <AppShell title={title}>
      <div className="p-6 space-y-6">
        {/* Breadcrumb */}
        {breadcrumb}

        {/* Header card */}
        <Card>
          <CardContent className="p-6">
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-4 w-32" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12" />
                  ))}
                </div>
              </div>
            ) : customer ? (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-primary/10 p-3">
                      <Building2 className="size-6 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold">{customer.name}</h2>
                      <div className="flex items-center gap-2 mt-1">
                        {customer.domain && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Globe className="size-3" />
                            {customer.domain}
                          </div>
                        )}
                        <Badge
                          variant="outline"
                          className={`capitalize text-[11px] ${STATUS_COLORS[customer.status] ?? ""}`}
                        >
                          {customer.status}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <MoreHorizontal className="size-4" />
                    Actions
                  </Button>
                </div>

                <Separator className="my-4" />

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  {customer.primaryContact && (
                    <div>
                      <dt className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                        <Users className="size-3" /> Primary Contact
                      </dt>
                      <dd className="font-medium">{customer.primaryContact}</dd>
                    </div>
                  )}
                  {customer.primaryEmail && (
                    <div>
                      <dt className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                        <Mail className="size-3" /> Email
                      </dt>
                      <dd className="font-medium truncate">{customer.primaryEmail}</dd>
                    </div>
                  )}
                  {customer.employeeCount != null && (
                    <div>
                      <dt className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                        <Users className="size-3" /> Employees
                      </dt>
                      <dd className="font-medium">{customer.employeeCount.toLocaleString()}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                      <Calendar className="size-3" /> Added
                    </dt>
                    <dd className="font-medium">
                      {new Date(customer.createdAt).toLocaleDateString()}
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">Customer not found.</p>
            )}
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-3 sm:grid-cols-6 w-full h-auto">
            <TabsTrigger value="overview" className="text-xs gap-1.5 py-2">
              <LayoutDashboard className="size-3.5" />
              <span className="hidden sm:inline">Overview</span>
            </TabsTrigger>
            <TabsTrigger value="documents" className="text-xs gap-1.5 py-2">
              <FileText className="size-3.5" />
              <span className="hidden sm:inline">Documents</span>
            </TabsTrigger>
            <TabsTrigger value="monitoring" className="text-xs gap-1.5 py-2">
              <Activity className="size-3.5" />
              <span className="hidden sm:inline">Monitoring</span>
            </TabsTrigger>
            <TabsTrigger value="offers" className="text-xs gap-1.5 py-2">
              <TrendingUp className="size-3.5" />
              <span className="hidden sm:inline">Offers</span>
            </TabsTrigger>
            <TabsTrigger value="billing" className="text-xs gap-1.5 py-2">
              <DollarSign className="size-3.5" />
              <span className="hidden sm:inline">Billing</span>
            </TabsTrigger>
            <TabsTrigger value="reports" className="text-xs gap-1.5 py-2">
              <ShieldCheck className="size-3.5" />
              <span className="hidden sm:inline">Reports</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Tenant ID</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-5 w-40" />
                  ) : (
                    <p className="font-mono text-sm text-muted-foreground break-all">
                      {customer?.tenantId ?? "Not linked"}
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">MSP</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-5 w-28" />
                  ) : (
                    <p className="text-sm font-medium">{customer?.mspName ?? "—"}</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Status</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-5 w-20" />
                  ) : (
                    <Badge
                      variant="outline"
                      className={`capitalize ${STATUS_COLORS[customer?.status ?? ""] ?? ""}`}
                    >
                      {customer?.status ?? "—"}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            </div>

            {customer?.notes && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{customer.notes}</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="documents" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <PlaceholderTab
                  icon={FileText}
                  label="Documents"
                  description="SOWs, contracts, and proposals for this customer will appear here. Coming in the Billing/SOW task."
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="monitoring" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <PlaceholderTab
                  icon={Activity}
                  label="Monitoring"
                  description="Tenant health signals, adoption scores, and diagnostics will appear here. Coming in the Diagnostics task."
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="offers" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <PlaceholderTab
                  icon={TrendingUp}
                  label="Sales Offers"
                  description="Active and past sales offers for this customer will appear here. Coming in the Sales Offers task."
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="billing" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <PlaceholderTab
                  icon={DollarSign}
                  label="Billing & SOW"
                  description="Invoices, SOW documents, and subscription details will appear here. Coming in the Billing task."
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reports" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <PlaceholderTab
                  icon={ShieldCheck}
                  label="Reports"
                  description="Automated health reports and usage analytics will appear here. Coming in the Reporting task."
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
