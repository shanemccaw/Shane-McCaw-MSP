/**
 * Launch Control — M365 Launch Control
 *
 * MSP-facing console where a technician executes real, live M365 write
 * actions against a selected customer's tenant, one action at a time.
 * Distinct from Mission Control (customer monitoring dashboard).
 *
 * Backend: msp-launch-control.ts
 *   GET  /api/msp/:mspId/launch-control/actions?customerId=
 *   POST /api/msp/:mspId/launch-control/execute
 *
 * Every row's real availability/execute-eligibility is re-validated server
 * side on every POST — the client-side availability label here is purely
 * informational, never trusted for gating beyond disabling the UI control.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearch } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { CustomerPicker } from "@/components/customer-picker";
import { ConfirmModal } from "@/components/confirm-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  Rocket,
  Play,
  Lock,
  ShieldCheck,
  Sparkles,
  ShoppingCart,
  HelpCircle,
  CheckCircle2,
  XCircle,
} from "lucide-react";

interface LaunchControlAction {
  id: number;
  domain: string;
  actionName: string;
  surface: string;
  requiredPermission: string | null;
  safeOrGated: "safe" | "gated";
  minBundledTier: string | null;
  requiredCapabilityKey: string | null;
  snapshotNotes: string | null;
  status: string | null;
  blockedReason: string | null;
  sortOrder: number;
  templateId: string | null;
  availability: "included" | "billable_upsell" | "a_la_carte";
  requiredVariables: string[];
}

interface ActionsResponse {
  actions: LaunchControlAction[];
  customerTier: string | null;
}

interface ExecutionResult {
  success: boolean;
  status: number;
  data: unknown;
  errorType?: "insufficient_privilege" | "conflict" | "bad_request" | "unexpected";
  endpoint: string;
  method: string;
  label: string;
  missingVariables?: string[];
}

interface RowResult {
  success: boolean;
  message: string;
  at: number;
}

const AVAILABILITY_LABELS: Record<LaunchControlAction["availability"], string> = {
  included: "Included",
  billable_upsell: "Billable upsell",
  a_la_carte: "À la carte",
};

const AVAILABILITY_STYLES: Record<LaunchControlAction["availability"], string> = {
  included: "bg-green-500/15 text-green-400 border-green-500/20",
  billable_upsell: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  a_la_carte: "bg-blue-500/15 text-blue-400 border-blue-500/20",
};

const AVAILABILITY_ICONS: Record<LaunchControlAction["availability"], typeof Sparkles> = {
  included: CheckCircle2,
  billable_upsell: Sparkles,
  a_la_carte: ShoppingCart,
};

function domainLabel(domain: string): string {
  return domain
    .split(/[_-]/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export default function LaunchControlPage() {
  const { fetchWithAuth, user } = useAuth();
  const search = useSearch();

  const [customerId, setCustomerId] = useState<string>("");
  const [actions, setActions] = useState<LaunchControlAction[]>([]);
  const [customerTier, setCustomerTier] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [target, setTarget] = useState<LaunchControlAction | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [rowResults, setRowResults] = useState<Record<number, RowResult>>({});

  // Prefill from ?customerId= — e.g. a deep link from a customer's own page.
  useEffect(() => {
    const params = new URLSearchParams(search);
    const prefill = params.get("customerId");
    if (prefill) setCustomerId(prefill);
  }, [search]);

  const fetchActions = useCallback(async () => {
    if (!user?.mspId || !customerId) return;
    setLoading(true);
    try {
      const res = await fetchWithAuth(
        `/api/msp/${user.mspId}/launch-control/actions?customerId=${customerId}`,
      );
      if (!res.ok) {
        toast.error("Failed to load Launch Control actions for this customer");
        setActions([]);
        setCustomerTier(null);
        return;
      }
      const data = (await res.json()) as ActionsResponse;
      setActions(data.actions ?? []);
      setCustomerTier(data.customerTier ?? null);
    } catch {
      toast.error("Network error — please try again");
      setActions([]);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, user?.mspId, customerId]);

  useEffect(() => {
    void fetchActions();
    setRowResults({});
  }, [fetchActions]);

  const grouped = useMemo(() => {
    const byDomain = new Map<string, LaunchControlAction[]>();
    for (const action of actions) {
      const list = byDomain.get(action.domain) ?? [];
      list.push(action);
      byDomain.set(action.domain, list);
    }
    return Array.from(byDomain.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [actions]);

  function openConfirm(action: LaunchControlAction) {
    setTarget(action);
    setVariableValues({});
    setConfirmOpen(true);
  }

  const missingRequired = target
    ? target.requiredVariables.filter((v) => !variableValues[v]?.trim())
    : [];

  async function handleExecute() {
    if (!target || !user?.mspId) return;
    const action = target;
    try {
      const res = await fetchWithAuth(`/api/msp/${user.mspId}/launch-control/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogActionId: action.id,
          customerId: Number(customerId),
          variables: action.requiredVariables.length > 0 ? variableValues : undefined,
        }),
      });

      if (res.status === 409) {
        const err = await res.json().catch(() => ({}));
        const message = err.error ?? "This action isn't wired to a real executable template yet.";
        setRowResults((prev) => ({ ...prev, [action.id]: { success: false, message, at: Date.now() } }));
        toast.error(message);
        return;
      }
      if (res.status === 402) {
        const err = await res.json().catch(() => ({}));
        const message = err.error ?? "This action is not included in your current plan for this customer.";
        setRowResults((prev) => ({ ...prev, [action.id]: { success: false, message, at: Date.now() } }));
        toast.error(message);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = err.error ?? "Failed to execute action.";
        setRowResults((prev) => ({ ...prev, [action.id]: { success: false, message, at: Date.now() } }));
        toast.error(message);
        return;
      }

      const data = (await res.json()) as { result: ExecutionResult };
      const success = data.result?.success ?? false;
      const message = success
        ? `Executed successfully (${data.result.status})`
        : `Execution failed (${data.result.status}${data.result.errorType ? `, ${data.result.errorType}` : ""})`;
      setRowResults((prev) => ({ ...prev, [action.id]: { success, message, at: Date.now() } }));
      if (success) {
        toast.success(`${action.actionName} executed`);
      } else {
        toast.error(`${action.actionName} failed to execute`);
      }
    } catch {
      const message = "Network error — please try again.";
      setRowResults((prev) => ({ ...prev, [action.id]: { success: false, message, at: Date.now() } }));
      toast.error(message);
    }
  }

  return (
    <AppShell title="Launch Control">
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Rocket className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">Launch Control</h1>
            <p className="text-sm text-muted-foreground">
              Execute real M365 write actions against a customer&apos;s tenant, one action at a
              time.
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-1.5 max-w-md">
            <Label>Customer</Label>
            <CustomerPicker
              value={customerId}
              onChange={(id) => setCustomerId(id)}
            />
            {customerTier && (
              <p className="text-xs text-muted-foreground pt-1">
                Purchased Monitoring tier: <span className="font-medium">{customerTier}</span>
              </p>
            )}
          </CardContent>
        </Card>

        {!customerId && (
          <div className="text-sm text-muted-foreground py-8 text-center">
            Select a customer to see their available Launch Control actions.
          </div>
        )}

        {customerId && loading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}

        {customerId && !loading && actions.length === 0 && (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No Launch Control actions found.
          </div>
        )}

        {customerId &&
          !loading &&
          grouped.map(([domain, domainActions]) => (
            <Card key={domain}>
              <CardHeader>
                <CardTitle className="text-base">{domainLabel(domain)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {domainActions.map((action) => {
                  const executable = Boolean(action.templateId);
                  const clickable = executable && action.availability === "included";
                  const AvailabilityIcon = AVAILABILITY_ICONS[action.availability];
                  const result = rowResults[action.id];

                  const row = (
                    <div
                      key={action.id}
                      className={`flex items-center justify-between gap-4 rounded-md border p-3 ${
                        !executable ? "opacity-50" : ""
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        {action.safeOrGated === "gated" ? (
                          <Lock className="h-4 w-4 mt-1 flex-shrink-0 text-amber-400" />
                        ) : (
                          <ShieldCheck className="h-4 w-4 mt-1 flex-shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium truncate">{action.actionName}</span>
                            <Badge className={AVAILABILITY_STYLES[action.availability]}>
                              <AvailabilityIcon className="h-3 w-3 mr-1" />
                              {AVAILABILITY_LABELS[action.availability]}
                            </Badge>
                            <Badge variant="outline" className="capitalize">
                              {action.safeOrGated}
                            </Badge>
                            {!executable && (
                              <Badge variant="outline" className="text-muted-foreground">
                                Not yet available
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {action.surface}
                            {action.minBundledTier ? ` · min tier: ${action.minBundledTier}` : ""}
                          </div>
                          {result && (
                            <div
                              className={`text-xs mt-1.5 flex items-center gap-1 ${
                                result.success ? "text-green-400" : "text-red-400"
                              }`}
                            >
                              {result.success ? (
                                <CheckCircle2 className="h-3 w-3" />
                              ) : (
                                <XCircle className="h-3 w-3" />
                              )}
                              {result.message}
                            </div>
                          )}
                        </div>
                      </div>

                      {clickable && (
                        <Button variant="outline" size="sm" onClick={() => openConfirm(action)}>
                          <Play className="h-4 w-4 mr-1" />
                          Execute
                        </Button>
                      )}
                    </div>
                  );

                  if (executable) return row;

                  return (
                    <Tooltip key={action.id}>
                      <TooltipTrigger asChild>{row}</TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        Not yet available — no executable template wired up for this action yet.
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </CardContent>
            </Card>
          ))}

        {target && (
          <ConfirmModal
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={`Execute: ${target.actionName}`}
            description={
              target.safeOrGated === "gated"
                ? "This is a gated action — it may have a broader or higher-risk impact on the tenant. Confirm before proceeding."
                : "This will run a real write action against the customer's tenant."
            }
            confirmLabel="Execute"
            variant={target.safeOrGated === "gated" ? "destructive" : "default"}
            confirmDisabled={missingRequired.length > 0}
            onConfirm={handleExecute}
          >
            {target.requiredVariables.length > 0 && (
              <div className="space-y-3">
                {target.requiredVariables.map((varName) => (
                  <div key={varName} className="space-y-1">
                    <Label htmlFor={`lc-var-${varName}`} className="flex items-center gap-1">
                      {varName}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3 w-3 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">
                          Required by this action&apos;s template.
                        </TooltipContent>
                      </Tooltip>
                    </Label>
                    <Input
                      id={`lc-var-${varName}`}
                      value={variableValues[varName] ?? ""}
                      onChange={(e) =>
                        setVariableValues((prev) => ({ ...prev, [varName]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </ConfirmModal>
        )}
      </div>
    </AppShell>
  );
}
