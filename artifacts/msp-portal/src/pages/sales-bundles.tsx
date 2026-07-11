/**
 * Sales Bundles — MSP Portal
 *
 * Lets MSP admins compose, price, and assign Sales Bundles made from
 * platform-authored Monitoring Packages. MSPs never author Monitor Checks
 * or Monitoring Packages — those stay platform-only.
 *
 * Features:
 *   - List all MSP bundles with status, assignment count, pricing
 *   - Create bundle dialog: package picker, live pricing preview, resale price, trial
 *   - Bundle detail drawer: package list, assignment list, revoke/assign actions
 *   - Plan-gate UI hint for custom composition (multi-package)
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  AlertCircle,
  Box,
  CheckCircle2,
  ChevronDown,
  DollarSign,
  Layers,
  Loader2,
  MoreVertical,
  Package,
  Plus,
  RefreshCw,
  Tag,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/confirm-modal";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonitoringPackage {
  packageId: string;
  key: string;
  label: string;
  description?: string;
  engines: string[];
  platformCostCents: number;
  requiredPlanFeature?: string;
  status: string;
}

interface SalesBundle {
  id: number;
  bundleId: string;
  mspId: number;
  name: string;
  description?: string;
  monitoringPackageKeys: string[];
  internalCostCents: number;
  resalePriceCents: number;
  status: "draft" | "active" | "archived";
  trialDays?: number;
  createdAt: string;
  updatedAt: string;
}

interface BundleAssignment {
  assignmentId: string;
  bundleId: string;
  customerId: number;
  tenantId?: string;
  status: "active" | "suspended" | "revoked";
  activatedAt?: string;
  trialExpiresAt?: string;
  assignedAt: string;
  revokedAt?: string;
  customerName?: string;
  customerDomain?: string;
}

interface Customer {
  id: number;
  name: string;
  domain?: string;
  tenantId?: string;
  status: string;
}

interface PricingPreview {
  packageKeys: string[];
  internalCostCents: number;
  breakdown: Array<{
    key: string;
    label: string;
    platformCostCents: number;
    engines: string[];
    requiredPlanFeature?: string;
    available: boolean;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    draft: { label: "Draft", variant: "secondary" },
    active: { label: "Active", variant: "default" },
    archived: { label: "Archived", variant: "outline" },
  };
  const cfg = map[status] ?? { label: status, variant: "outline" };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

// ── Create/Edit Bundle Dialog ─────────────────────────────────────────────────

interface BundleDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  fetchWithAuth: ReturnType<typeof useAuth>["fetchWithAuth"];
  editBundle?: SalesBundle;
  availablePackages: MonitoringPackage[];
}

function BundleDialog({
  open,
  onClose,
  onSaved,
  fetchWithAuth,
  editBundle,
  availablePackages,
}: BundleDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [resalePriceCents, setResalePriceCents] = useState(0);
  const [resalePriceInput, setResalePriceInput] = useState("0.00");
  const [trialDays, setTrialDays] = useState<string>("");
  const [bundleStatus, setBundleStatus] = useState<"draft" | "active">("draft");
  const [pricingPreview, setPricingPreview] = useState<PricingPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const isEdit = !!editBundle;

  useEffect(() => {
    if (open) {
      if (editBundle) {
        setName(editBundle.name);
        setDescription(editBundle.description ?? "");
        setSelectedKeys(editBundle.monitoringPackageKeys);
        setResalePriceCents(editBundle.resalePriceCents);
        setResalePriceInput((editBundle.resalePriceCents / 100).toFixed(2));
        setTrialDays(editBundle.trialDays ? String(editBundle.trialDays) : "");
        setBundleStatus(editBundle.status === "archived" ? "draft" : editBundle.status);
      } else {
        setName("");
        setDescription("");
        setSelectedKeys([]);
        setResalePriceCents(0);
        setResalePriceInput("0.00");
        setTrialDays("");
        setBundleStatus("draft");
      }
      setPricingPreview(null);
    }
  }, [open, editBundle]);

  // Fetch pricing preview when package selection changes
  useEffect(() => {
    if (!open || selectedKeys.length === 0) {
      setPricingPreview(null);
      return;
    }
    setPreviewLoading(true);
    const params = new URLSearchParams();
    selectedKeys.forEach((k) => params.append("packageKeys[]", k));
    fetchWithAuth(`/api/msp/sales-bundles/pricing-preview?${params}`)
      .then((r) => r.json())
      .then((data: PricingPreview) => setPricingPreview(data))
      .catch(() => {})
      .finally(() => setPreviewLoading(false));
  }, [open, selectedKeys, fetchWithAuth]);

  function togglePackage(key: string) {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  const isMultiPackage = selectedKeys.length > 1;

  async function handleSave() {
    if (!name.trim()) { toast.error("Bundle name is required"); return; }
    if (selectedKeys.length === 0) { toast.error("Select at least one monitoring package"); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || undefined,
        monitoringPackageKeys: selectedKeys,
        resalePriceCents,
        status: bundleStatus,
        trialDays: trialDays ? parseInt(trialDays, 10) : null,
      };
      const url = isEdit ? `/api/msp/sales-bundles/${editBundle!.bundleId}` : "/api/msp/sales-bundles";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetchWithAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          toast.error("Upgrade required: custom bundle composition (multiple packages) requires the Pro tier.");
        } else {
          toast.error(data.error ?? "Failed to save bundle");
        }
        return;
      }
      toast.success(isEdit ? "Bundle updated" : "Bundle created");
      onSaved();
      onClose();
    } catch {
      toast.error("Failed to save bundle");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Bundle" : "Create Sales Bundle"}</DialogTitle>
          <DialogDescription>
            Compose a named bundle from platform-authored Monitoring Packages and set your resale price.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="bundle-name">Bundle Name <span className="text-destructive">*</span></Label>
            <Input
              id="bundle-name"
              placeholder="e.g. M365 Security Essentials"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="bundle-desc">Description</Label>
            <Textarea
              id="bundle-desc"
              placeholder="What does this bundle provide to the customer?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>

          {/* Package selector */}
          <div className="space-y-2">
            <Label>
              Monitoring Packages <span className="text-destructive">*</span>
            </Label>
            {isMultiPackage && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  <strong>Pro tier required</strong> — custom composition (mixing multiple packages) is a Pro-tier
                  feature. Saving will fail if your plan does not include <code>custom_bundle_composition</code>.
                </span>
              </div>
            )}
            <div className="border rounded-md divide-y max-h-52 overflow-y-auto">
              {availablePackages.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground text-center">
                  No active monitoring packages available yet.
                </p>
              ) : (
                availablePackages.map((pkg) => (
                  <div
                    key={pkg.key}
                    className="flex items-start gap-3 p-3 hover:bg-muted/40 cursor-pointer"
                    onClick={() => togglePackage(pkg.key)}
                  >
                    <Checkbox
                      checked={selectedKeys.includes(pkg.key)}
                      onCheckedChange={() => togglePackage(pkg.key)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{pkg.label}</span>
                        {pkg.engines.map((e) => (
                          <Badge key={e} variant="outline" className="text-xs py-0">
                            {e}
                          </Badge>
                        ))}
                        {pkg.requiredPlanFeature && (
                          <Badge variant="secondary" className="text-xs py-0">Pro</Badge>
                        )}
                      </div>
                      {pkg.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{pkg.description}</p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                      {pkg.platformCostCents > 0 ? formatCents(pkg.platformCostCents) + "/mo" : "Included"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Pricing preview */}
          {selectedKeys.length > 0 && (
            <Card className="bg-muted/30">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5" />
                  Pricing Preview
                  {previewLoading && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                {pricingPreview ? (
                  <div className="space-y-1.5 text-sm">
                    {pricingPreview.breakdown.map((b) => (
                      <div key={b.key} className="flex justify-between text-muted-foreground">
                        <span>{b.label}</span>
                        <span>{b.platformCostCents > 0 ? formatCents(b.platformCostCents) : "—"}</span>
                      </div>
                    ))}
                    <Separator className="my-1" />
                    <div className="flex justify-between font-medium">
                      <span>Your internal cost / tenant / mo</span>
                      <span>{formatCents(pricingPreview.internalCostCents)}</span>
                    </div>
                    {resalePriceCents > pricingPreview.internalCostCents && (
                      <div className="flex justify-between text-green-700 dark:text-green-400 text-xs">
                        <span>Margin</span>
                        <span>
                          {formatCents(resalePriceCents - pricingPreview.internalCostCents)}
                          {" "}
                          ({pricingPreview.internalCostCents > 0
                            ? Math.round(((resalePriceCents - pricingPreview.internalCostCents) / pricingPreview.internalCostCents) * 100)
                            : "∞"}%)
                        </span>
                      </div>
                    )}
                  </div>
                ) : previewLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : null}
              </CardContent>
            </Card>
          )}

          {/* Resale price */}
          <div className="space-y-1.5">
            <Label htmlFor="resale-price">Your Resale Price (per tenant / month)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                id="resale-price"
                className="pl-7"
                type="number"
                min="0"
                step="0.01"
                value={resalePriceInput}
                onChange={(e) => {
                  setResalePriceInput(e.target.value);
                  const v = parseFloat(e.target.value);
                  setResalePriceCents(isNaN(v) ? 0 : Math.round(v * 100));
                }}
                onBlur={() => setResalePriceInput((resalePriceCents / 100).toFixed(2))}
                placeholder="0.00"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              You set the price — no restrictions on markup. Leave at $0.00 if included in your service contract.
            </p>
          </div>

          {/* Trial */}
          <div className="space-y-1.5">
            <Label htmlFor="trial-days">Trial Period (days)</Label>
            <Input
              id="trial-days"
              type="number"
              min="1"
              max="365"
              value={trialDays}
              onChange={(e) => setTrialDays(e.target.value)}
              placeholder="Leave blank for no trial"
            />
            <p className="text-xs text-muted-foreground">
              Set once at bundle creation. Customers assigned to this bundle get this trial automatically.
            </p>
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={bundleStatus} onValueChange={(v) => setBundleStatus(v as "draft" | "active")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft — not yet assignable</SelectItem>
                <SelectItem value="active">Active — ready to assign to customers</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || selectedKeys.length === 0 || !name.trim()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {isEdit ? "Save Changes" : "Create Bundle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Assign Bundle Dialog ──────────────────────────────────────────────────────

interface AssignDialogProps {
  open: boolean;
  onClose: () => void;
  onAssigned: () => void;
  fetchWithAuth: ReturnType<typeof useAuth>["fetchWithAuth"];
  bundle: SalesBundle;
}

function AssignDialog({ open, onClose, onAssigned, fetchWithAuth, bundle }: AssignDialogProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [tenantIdOverride, setTenantIdOverride] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCustomersLoading(true);
    fetchWithAuth("/api/msp/v1/msps/0/customers?limit=200")
      .then((r) => r.json())
      .then((data: { customers?: Customer[] }) => setCustomers(data.customers ?? []))
      .catch(() => setCustomers([]))
      .finally(() => setCustomersLoading(false));
  }, [open, fetchWithAuth]);

  async function handleAssign() {
    if (!selectedCustomerId) { toast.error("Select a customer"); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { customerId: parseInt(selectedCustomerId, 10) };
      if (tenantIdOverride.trim()) body["tenantId"] = tenantIdOverride.trim();
      const res = await fetchWithAuth(`/api/msp/sales-bundles/${bundle.bundleId}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to assign bundle"); return; }
      toast.success("Bundle assigned — monitoring packages activated");
      onAssigned();
      onClose();
    } catch {
      toast.error("Failed to assign bundle");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Bundle</DialogTitle>
          <DialogDescription>
            Assign <strong>{bundle.name}</strong> to a customer. This activates the underlying monitoring
            packages for their tenant.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Customer</Label>
            {customersLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a customer…" />
                </SelectTrigger>
                <SelectContent>
                  {customers.filter((c) => c.status === "active").map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}{c.domain ? ` (${c.domain})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tenant-id-override">M365 Tenant ID (optional override)</Label>
            <Input
              id="tenant-id-override"
              value={tenantIdOverride}
              onChange={(e) => setTenantIdOverride(e.target.value)}
              placeholder="Uses customer's tenantId by default"
            />
          </div>
          {bundle.trialDays && (
            <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
              <Tag className="h-3.5 w-3.5 shrink-0" />
              <span>This bundle includes a <strong>{bundle.trialDays}-day trial</strong>.</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleAssign} disabled={saving || !selectedCustomerId}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Assign &amp; Activate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bundle Detail Sheet ───────────────────────────────────────────────────────

interface BundleDetailSheetProps {
  bundle: SalesBundle | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAssign: () => void;
  onRevoked: () => void;
  fetchWithAuth: ReturnType<typeof useAuth>["fetchWithAuth"];
  availablePackages: MonitoringPackage[];
}

function BundleDetailSheet({
  bundle,
  onClose,
  onEdit,
  onDelete,
  onAssign,
  onRevoked,
  fetchWithAuth,
  availablePackages,
}: BundleDetailSheetProps) {
  const [assignments, setAssignments] = useState<BundleAssignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<BundleAssignment | null>(null);
  const [revoking, setRevoking] = useState(false);

  const loadAssignments = useCallback(async () => {
    if (!bundle) return;
    setAssignmentsLoading(true);
    try {
      const res = await fetchWithAuth(`/api/msp/sales-bundles/${bundle.bundleId}/assignments`);
      const data = await res.json();
      setAssignments(data.assignments ?? []);
    } catch {
      setAssignments([]);
    } finally {
      setAssignmentsLoading(false);
    }
  }, [bundle, fetchWithAuth]);

  useEffect(() => {
    if (bundle) loadAssignments();
    else setAssignments([]);
  }, [bundle, loadAssignments]);

  async function revokeAssignment() {
    if (!bundle || !revokeTarget) return;
    setRevoking(true);
    try {
      const res = await fetchWithAuth(
        `/api/msp/sales-bundles/${bundle.bundleId}/assignments/${revokeTarget.assignmentId}`,
        { method: "DELETE" },
      );
      if (!res.ok) { toast.error("Failed to revoke assignment"); return; }
      toast.success("Assignment revoked");
      setRevokeTarget(null);
      onRevoked();
      loadAssignments();
    } catch {
      toast.error("Failed to revoke assignment");
    } finally {
      setRevoking(false);
    }
  }

  const packageMap = new Map(availablePackages.map((p) => [p.key, p]));
  const bundlePackages = bundle?.monitoringPackageKeys.map((k) => packageMap.get(k)).filter(Boolean) as MonitoringPackage[];

  return (
    <>
      <Sheet open={!!bundle} onOpenChange={(v) => !v && onClose()}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {bundle && (
            <>
              <SheetHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <SheetTitle className="truncate">{bundle.name}</SheetTitle>
                    <SheetDescription className="flex items-center gap-2 mt-1">
                      {statusBadge(bundle.status)}
                      {bundle.trialDays && (
                        <Badge variant="outline" className="text-xs">
                          {bundle.trialDays}-day trial
                        </Badge>
                      )}
                    </SheetDescription>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" onClick={onAssign} disabled={bundle.status !== "active"}>
                      <Users className="h-3.5 w-3.5 mr-1" />
                      Assign
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={onEdit}>Edit bundle</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                          Delete bundle
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </SheetHeader>

              {bundle.description && (
                <p className="text-sm text-muted-foreground mt-4">{bundle.description}</p>
              )}

              {/* Pricing summary */}
              <Card className="mt-4">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs mb-0.5">Internal cost / tenant</p>
                      <p className="font-semibold">{formatCents(bundle.internalCostCents)}<span className="text-xs text-muted-foreground font-normal">/mo</span></p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs mb-0.5">Your resale price</p>
                      <p className="font-semibold text-green-700 dark:text-green-400">
                        {formatCents(bundle.resalePriceCents)}<span className="text-xs text-muted-foreground font-normal">/mo</span>
                      </p>
                    </div>
                    {bundle.resalePriceCents > bundle.internalCostCents && (
                      <div>
                        <p className="text-muted-foreground text-xs mb-0.5">Margin</p>
                        <p className="font-semibold text-blue-700 dark:text-blue-400">
                          {formatCents(bundle.resalePriceCents - bundle.internalCostCents)}
                          {bundle.internalCostCents > 0
                            ? ` (${Math.round(((bundle.resalePriceCents - bundle.internalCostCents) / bundle.internalCostCents) * 100)}%)`
                            : " (∞%)"}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-muted-foreground text-xs mb-0.5">Packages</p>
                      <p className="font-semibold">{bundle.monitoringPackageKeys.length}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Packages */}
              <div className="mt-5">
                <h3 className="text-sm font-medium mb-2">Monitoring Packages</h3>
                <div className="border rounded-md divide-y text-sm">
                  {bundlePackages.length === 0 ? (
                    <p className="p-3 text-muted-foreground text-center">No packages</p>
                  ) : (
                    bundlePackages.map((pkg) => (
                      <div key={pkg.key} className="flex items-center justify-between px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{pkg.label}</p>
                          {pkg.description && (
                            <p className="text-xs text-muted-foreground truncate">{pkg.description}</p>
                          )}
                          <div className="flex gap-1 flex-wrap mt-0.5">
                            {pkg.engines.map((e) => (
                              <Badge key={e} variant="outline" className="text-xs py-0">{e}</Badge>
                            ))}
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 ml-3">
                          {pkg.platformCostCents > 0 ? formatCents(pkg.platformCostCents) : "—"}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Assignments */}
              <div className="mt-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium">Customer Assignments</h3>
                  <Button variant="ghost" size="sm" onClick={loadAssignments}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {assignmentsLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : assignments.length === 0 ? (
                  <p className="text-sm text-muted-foreground border rounded-md p-3 text-center">
                    No assignments yet. Assign this bundle to customers above.
                  </p>
                ) : (
                  <div className="border rounded-md divide-y text-sm">
                    {assignments.map((a) => (
                      <div key={a.assignmentId} className="flex items-center justify-between px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{a.customerName ?? `Customer #${a.customerId}`}</p>
                          {a.customerDomain && (
                            <p className="text-xs text-muted-foreground">{a.customerDomain}</p>
                          )}
                          {a.tenantId && (
                            <p className="text-xs text-muted-foreground font-mono truncate">{a.tenantId}</p>
                          )}
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge
                              variant={a.status === "active" ? "default" : a.status === "revoked" ? "destructive" : "secondary"}
                              className="text-xs py-0"
                            >
                              {a.status}
                            </Badge>
                            {a.trialExpiresAt && (
                              <span className="text-xs text-muted-foreground">
                                Trial expires {new Date(a.trialExpiresAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        {a.status === "active" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setRevokeTarget(a)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmModal
        open={!!revokeTarget}
        onOpenChange={(v) => !v && setRevokeTarget(null)}
        onConfirm={revokeAssignment}
        title="Revoke Assignment"
        description={`Remove ${revokeTarget?.customerName ?? "this customer"} from the bundle? Monitoring package execution will stop.`}
        confirmLabel="Revoke"
        variant="destructive"
      />
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SalesBundlesPage() {
  const { fetchWithAuth } = useAuth();

  const [bundles, setBundles] = useState<SalesBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [availablePackages, setAvailablePackages] = useState<MonitoringPackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [editBundle, setEditBundle] = useState<SalesBundle | undefined>();
  const [detailBundle, setDetailBundle] = useState<SalesBundle | null>(null);
  const [assignBundle, setAssignBundle] = useState<SalesBundle | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SalesBundle | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadBundles = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const res = await fetchWithAuth(`/api/msp/sales-bundles${params}`);
      const data = await res.json();
      setBundles(data.bundles ?? []);
    } catch {
      toast.error("Failed to load bundles");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, statusFilter]);

  const loadPackages = useCallback(async () => {
    setPackagesLoading(true);
    try {
      const res = await fetchWithAuth("/api/msp/monitoring-packages");
      const data = await res.json();
      setAvailablePackages(data.packages ?? []);
    } catch {
      setAvailablePackages([]);
    } finally {
      setPackagesLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    loadBundles();
  }, [loadBundles]);

  useEffect(() => {
    loadPackages();
  }, [loadPackages]);

  async function deleteBundle() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/msp/sales-bundles/${deleteTarget.bundleId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to delete bundle"); return; }
      toast.success("Bundle deleted");
      setDeleteTarget(null);
      setDetailBundle(null);
      loadBundles();
    } catch {
      toast.error("Failed to delete bundle");
    } finally {
      setDeleting(false);
    }
  }

  const activeCount = bundles.filter((b) => b.status === "active").length;
  const draftCount = bundles.filter((b) => b.status === "draft").length;

  return (
    <AppShell
      title="Sales Bundles"
      actions={
        <Button onClick={() => { loadPackages(); setCreateOpen(true); }} disabled={packagesLoading}>
          <Plus className="h-4 w-4 mr-2" />
          Create Bundle
        </Button>
      }
    >
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground mb-1">Total Bundles</p>
            <p className="text-2xl font-bold">{bundles.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-1.5 mb-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              <p className="text-xs text-muted-foreground">Active</p>
            </div>
            <p className="text-2xl font-bold">{activeCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Box className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Drafts</p>
            </div>
            <p className="text-2xl font-bold">{draftCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Packages Available</p>
            </div>
            <p className="text-2xl font-bold">{availablePackages.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters + table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">All Bundles</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={loadBundles}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bundle</TableHead>
                <TableHead className="hidden sm:table-cell">Packages</TableHead>
                <TableHead className="hidden md:table-cell">Internal Cost</TableHead>
                <TableHead className="hidden md:table-cell">Resale Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : bundles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="font-medium">No bundles yet</p>
                    <p className="text-xs mt-1">Create your first Sales Bundle to start assigning monitoring to customers.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => { loadPackages(); setCreateOpen(true); }}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Create Bundle
                    </Button>
                  </TableCell>
                </TableRow>
              ) : (
                bundles.map((bundle) => (
                  <TableRow
                    key={bundle.bundleId}
                    className="cursor-pointer"
                    onClick={() => setDetailBundle(bundle)}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{bundle.name}</p>
                        {bundle.description && (
                          <p className="text-xs text-muted-foreground truncate max-w-[200px]">{bundle.description}</p>
                        )}
                        {bundle.trialDays && (
                          <Badge variant="outline" className="text-xs py-0 mt-0.5">{bundle.trialDays}d trial</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span className="text-sm">{bundle.monitoringPackageKeys.length}</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      {formatCents(bundle.internalCostCents)}<span className="text-muted-foreground text-xs">/mo</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm font-medium text-green-700 dark:text-green-400">
                      {formatCents(bundle.resalePriceCents)}<span className="text-muted-foreground text-xs font-normal">/mo</span>
                    </TableCell>
                    <TableCell>{statusBadge(bundle.status)}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDetailBundle(bundle)}>
                            View detail
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setEditBundle(bundle); loadPackages(); }}>
                            Edit
                          </DropdownMenuItem>
                          {bundle.status === "active" && (
                            <DropdownMenuItem onClick={() => setAssignBundle(bundle)}>
                              Assign to customer
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteTarget(bundle)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create/Edit dialog */}
      <BundleDialog
        open={createOpen || !!editBundle}
        onClose={() => { setCreateOpen(false); setEditBundle(undefined); }}
        onSaved={loadBundles}
        fetchWithAuth={fetchWithAuth}
        editBundle={editBundle}
        availablePackages={availablePackages}
      />

      {/* Bundle detail sheet */}
      <BundleDetailSheet
        bundle={detailBundle}
        onClose={() => setDetailBundle(null)}
        onEdit={() => { setEditBundle(detailBundle!); setDetailBundle(null); loadPackages(); }}
        onDelete={() => setDeleteTarget(detailBundle)}
        onAssign={() => { setAssignBundle(detailBundle); }}
        onRevoked={loadBundles}
        fetchWithAuth={fetchWithAuth}
        availablePackages={availablePackages}
      />

      {/* Assign dialog */}
      {assignBundle && (
        <AssignDialog
          open={!!assignBundle}
          onClose={() => setAssignBundle(null)}
          onAssigned={() => { loadBundles(); if (detailBundle?.bundleId === assignBundle.bundleId) setDetailBundle(assignBundle); }}
          fetchWithAuth={fetchWithAuth}
          bundle={assignBundle}
        />
      )}

      {/* Delete confirm */}
      <ConfirmModal
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        onConfirm={deleteBundle}
        title="Delete Bundle"
        description={`Delete "${deleteTarget?.name}"? This cannot be undone. Bundles with active assignments cannot be deleted.`}
        confirmLabel="Delete"
        variant="destructive"
      />
    </AppShell>
  );
}
