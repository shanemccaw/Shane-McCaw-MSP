/**
 * SimulatorWriteActionCanvas.tsx
 *
 * Center canvas for the Simulator "Write Actions" surface — the tenant-MUTATING
 * sibling of SimulatorEndpointCanvas. Executes a real baseline_action_template
 * against a TESTBED tenant, through the one production execution engine
 * (runBaselineTemplateAgainstTenant), behind an explicit confirmation of the
 * ACTUAL resolved request.
 *
 * The safety flow is the point, not decoration:
 *   1. Testbed-only. The customer picker offers only testbed customers, and the
 *      server re-enforces it (a non-testbed customerId is rejected 403) — the UI
 *      is never the gate.
 *   2. Preview before execute. "Preview request" resolves the REAL endpoint +
 *      method + body (server-side, via the executor's own resolver) and shows it
 *      verbatim in a confirmation dialog. Nothing is written until the operator
 *      confirms THAT request.
 *   3. Rollback / verification-gate / catalog gating (safeOrGated, minBundledTier,
 *      status, blockedReason, snapshotNotes) are surfaced BEFORE running.
 *   4. dependsOn chain state is surfaced — a standalone run of a dependent action
 *      shows an explicit warning.
 *   5. Results show the real response, the HTTP status, and whether the template's
 *      declared successCriteria matched.
 */

import { useEffect, useState } from "react";
import { Loader2, Play, AlertTriangle, ShieldCheck, ShieldAlert, RotateCcw, X, Link2Off } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { useTestbedContext } from "@/contexts/TestbedContext";
import { JsonResponseViewer } from "./JsonResponseViewer";
import type { WriteActionNode } from "./SimulatorLeftTree";
import {
  buildInitialVariables,
  variablePlaceholder,
  readyToPreview,
  describeMethodConsequence,
  describeRollback,
} from "./simulatorWriteAction";

interface DependsOnEntry {
  templateId: string;
  exists: boolean;
  label: string | null;
  hasRecentSuccess: boolean;
}
interface DependsOnState {
  entries: DependsOnEntry[];
  hasDependencies: boolean;
  possiblyUnsatisfied: boolean;
  isolatedRunWarning: string | null;
}

interface PreviewResponse {
  resolvedRequest: {
    endpoint: string;
    rawEndpoint: string;
    method: string;
    body: Record<string, unknown>;
    rawBodyTemplate: Record<string, unknown>;
    requiredVariables: string[];
    missingVariables: string[];
  };
  ready: boolean;
  safety: {
    reversible: boolean;
    reverse: { templateId: string; label: string | null; endpoint: string | null; method: string | null } | null;
    requiresVerificationGate: boolean;
    successCriteria: Record<string, unknown>;
    dependsOn: DependsOnState;
    catalogLinked: boolean;
    catalog: WriteActionNode["catalog"];
  };
  tenant: { customerId: number; name: string | null };
}

interface ExecuteResponse {
  result: {
    success: boolean;
    status: number;
    data: unknown;
    errorType?: string;
    endpoint: string;
    method: string;
    label: string;
    missingVariables?: string[];
    auditLogId?: number;
  };
  successCriteria: {
    defined: boolean;
    expectedStatus?: number;
    actualStatus: number;
    met?: boolean;
    note: string;
  };
  tenant: { customerId: number; name: string | null };
}

interface RunSummary {
  id: number;
  action: string;
  createdAt: string;
  success: boolean;
  status: number | null;
  errorType: string | null;
  endpoint: string | null;
  method: string | null;
  customerId: number | null;
  source: string | null;
  requestVariables: Record<string, unknown>;
}

interface TestbedCustomerOption {
  id: number;
  name: string | null;
  tenantId: string;
}

function methodBadgeClass(method: string): string {
  return method === "DELETE"
    ? "bg-red-500/15 text-red-400"
    : method === "POST"
      ? "bg-emerald-500/15 text-emerald-400"
      : "bg-amber-500/15 text-amber-400";
}

export function SimulatorWriteActionCanvas({ action }: { action: WriteActionNode }) {
  const { fetchWithAuth } = useAuth();
  const { selectedCustomerId } = useTestbedContext();

  const [customers, setCustomers] = useState<TestbedCustomerOption[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>(buildInitialVariables(action.requiredVariables));

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<ExecuteResponse | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);

  // Re-seed every field when a different write-action is opened in the tree.
  useEffect(() => {
    setVariables(buildInitialVariables(action.requiredVariables));
    setPreview(null);
    setConfirmOpen(false);
    setResult(null);
    setGateError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.templateId]);

  // Fetch the testbed customer options (only these are valid targets).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/write-actions/testbed-customers");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const list: TestbedCustomerOption[] = data.customers || [];
        setCustomers(list);
        // Default to the header's selected testbed customer when it's a valid target.
        setCustomerId(prev => prev ?? (list.some(c => c.id === selectedCustomerId) ? selectedCustomerId : (list[0]?.id ?? null)));
      } catch {
        /* offline / no testbeds — the picker just stays empty */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomerId]);

  const loadRuns = async () => {
    try {
      const q = customerId ? `?customerId=${customerId}` : "";
      const res = await fetchWithAuth(`/api/admin/write-actions/${encodeURIComponent(action.templateId)}/runs${q}`);
      if (!res.ok) return;
      const data = await res.json();
      setRuns(data.runs || []);
    } catch {
      /* history is best-effort */
    }
  };

  useEffect(() => {
    void loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.templateId, customerId]);

  const canPreview = readyToPreview(action.requiredVariables, variables) && customerId != null && !previewing;

  const handlePreview = async () => {
    if (customerId == null) {
      toast.error("Select a testbed customer first");
      return;
    }
    setPreviewing(true);
    setResult(null);
    setGateError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/write-actions/${encodeURIComponent(action.templateId)}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, variables }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to resolve the request");
        return;
      }
      setPreview(data as PreviewResponse);
      // Open the confirmation ONLY when the request actually resolved — otherwise
      // the inline "missing variables" state stays visible instead.
      setConfirmOpen((data as PreviewResponse).ready);
      if (!(data as PreviewResponse).ready) {
        toast.error("Some required variables didn't resolve — see the highlighted fields");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error resolving the request");
    } finally {
      setPreviewing(false);
    }
  };

  const handleExecute = async () => {
    if (customerId == null || !preview) return;
    setExecuting(true);
    setGateError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/write-actions/${encodeURIComponent(action.templateId)}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, variables, confirmed: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        // A write-gate block (write-back off / consent not granted / testbed) is a
        // real, specific outcome — surface it, don't swallow it as a generic error.
        setGateError(data.error || "Execution was refused");
        toast.error(data.error || "Execution was refused");
        return;
      }
      setResult(data as ExecuteResponse);
      setConfirmOpen(false);
      const ok = (data as ExecuteResponse).result.success;
      toast[ok ? "success" : "error"](ok ? "Write executed" : "Write returned a non-success status");
      void loadRuns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error executing the write");
    } finally {
      setExecuting(false);
    }
  };

  const rollback = describeRollback(action);
  const selectedCustomer = customers.find(c => c.id === customerId) ?? null;
  const declaredCatalog = action.catalog;

  return (
    <div className="flex-1 overflow-y-auto p-4 font-sans text-foreground">
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${methodBadgeClass(action.method)}`}>
          {action.method}
        </span>
        <h2 className="truncate text-sm font-semibold">{action.label}</h2>
        <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">{action.category}</span>
      </div>
      {action.description && <p className="mb-3 text-[12px] text-muted-foreground">{action.description}</p>}

      {/* Testbed-only banner — the load-bearing restriction, made visible */}
      <div className="mb-3 flex items-start gap-2 rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-300">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          This is a <strong>real, tenant-mutating write</strong> — it {describeMethodConsequence(action.method)}. It runs only against a
          <strong> testbed</strong> customer, and the server rejects any non-testbed target. Review the resolved request before it executes.
        </span>
      </div>

      {/* Testbed customer picker */}
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Target testbed tenant</label>
      <select
        value={customerId ?? ""}
        onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : null)}
        className="mb-3 w-full rounded border border-border bg-background px-2 py-1 text-[12px] text-foreground focus:border-ring focus:outline-none"
      >
        <option value="">— select a testbed customer —</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name ?? `Customer ${c.id}`}
          </option>
        ))}
      </select>
      {customers.length === 0 && (
        <div className="mb-3 text-[11px] italic text-muted-foreground/70">No testbed customers with a connected tenant were found.</div>
      )}

      {/* Safety panel */}
      <div className="mb-3 grid grid-cols-1 gap-2 rounded border border-border bg-card p-3 md:grid-cols-2">
        {/* Rollback */}
        <div className="flex items-start gap-2 text-[11px]">
          {rollback.tone === "ok" ? (
            <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
          ) : (
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
          )}
          <div>
            <div className="font-semibold text-foreground">Rollback</div>
            <div className={rollback.tone === "ok" ? "text-emerald-300" : "text-red-300"}>{rollback.text}</div>
          </div>
        </div>
        {/* Verification gate */}
        <div className="flex items-start gap-2 text-[11px]">
          <ShieldCheck className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${action.requiresVerificationGate ? "text-amber-400" : "text-muted-foreground"}`} />
          <div>
            <div className="font-semibold text-foreground">Verification gate</div>
            <div className="text-muted-foreground">
              {action.requiresVerificationGate
                ? "Template is marked requiresVerificationGate — a human check is expected before production use."
                : "Not gated (requiresVerificationGate = false)."}
            </div>
          </div>
        </div>
        {/* Catalog gating */}
        <div className="flex items-start gap-2 text-[11px] md:col-span-2">
          {action.catalogLinked ? (
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          ) : (
            <Link2Off className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <div className="font-semibold text-foreground">Catalog (customer-facing) gating</div>
            {action.catalogLinked && declaredCatalog ? (
              <div className="text-muted-foreground">
                <span className="mr-2">Domain: <span className="text-foreground">{declaredCatalog.domain}</span></span>
                <span className="mr-2">Surface: <span className="text-foreground">{declaredCatalog.surface}</span></span>
                {declaredCatalog.safeOrGated && (
                  <span className="mr-2">
                    Classification:{" "}
                    <span className={declaredCatalog.safeOrGated === "gated" ? "text-amber-400" : "text-emerald-400"}>
                      {declaredCatalog.safeOrGated}
                    </span>
                  </span>
                )}
                {declaredCatalog.minBundledTier && <span className="mr-2">Min tier: <span className="text-foreground">{declaredCatalog.minBundledTier}</span></span>}
                {declaredCatalog.requiredPermission && <span className="mr-2">Permission: <span className="text-foreground">{declaredCatalog.requiredPermission}</span></span>}
                {declaredCatalog.status && <span className="mr-2">Status: <span className="text-foreground">{declaredCatalog.status}</span></span>}
                {declaredCatalog.blockedReason && <div className="mt-1 text-red-300">Blocked: {declaredCatalog.blockedReason}</div>}
                {declaredCatalog.snapshotNotes && <div className="mt-1 italic">Snapshot: {declaredCatalog.snapshotNotes}</div>}
              </div>
            ) : (
              <div className="text-muted-foreground/80 italic">
                Catalog link not yet established for this template (write_action_catalog.template_id is unset) — customer-facing
                gating metadata is unavailable until it's linked.
              </div>
            )}
          </div>
        </div>
        {/* dependsOn (declared) */}
        {action.dependsOn.length > 0 && (
          <div className="flex items-start gap-2 text-[11px] md:col-span-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            <div>
              <div className="font-semibold text-foreground">Depends on ({action.dependsOn.length})</div>
              <div className="text-amber-300">
                Declares dependencies ({action.dependsOn.join(", ")}) that must run first. Running standalone may fail — the
                confirmation step shows whether each has a recorded successful run for this tenant.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Endpoint + body template (read-only — this surface TESTS the template, it doesn't edit it) */}
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Template request</label>
      <div className="mb-2 break-all rounded border border-border bg-card px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
        <span className={`mr-2 rounded px-1 text-[10px] font-bold ${methodBadgeClass(action.method)}`}>{action.method}</span>
        {action.endpoint}
      </div>

      {/* Variables editor */}
      {action.requiredVariables.length > 0 ? (
        <div className="mb-3 space-y-2">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Required variables</label>
          {action.requiredVariables.map((v) => {
            const missing = preview && !preview.ready && preview.resolvedRequest.missingVariables.includes(v);
            return (
              <div key={v} className="flex items-center gap-2">
                <span className="w-40 shrink-0 truncate font-mono text-[11px] text-foreground/85">{v}</span>
                <input
                  value={variables[v] ?? ""}
                  onChange={(e) => setVariables((prev) => ({ ...prev, [v]: e.target.value }))}
                  placeholder={variablePlaceholder(v)}
                  spellCheck={false}
                  className={`flex-1 rounded border bg-background px-2 py-1 font-mono text-[11px] text-foreground focus:outline-none ${
                    missing ? "border-red-500/70 focus:border-red-500" : "border-border focus:border-ring"
                  }`}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mb-3 text-[11px] italic text-muted-foreground/70">This action takes no variables.</div>
      )}

      {/* Preview (confirmation) trigger */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={handlePreview}
          disabled={!canPreview}
          className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          title={customerId == null ? "Select a testbed customer first" : "Resolve the real request and review it before executing"}
        >
          {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 fill-current" />}
          Preview request
        </button>
        <span className="text-[11px] text-muted-foreground">Nothing is written until you confirm the resolved request.</span>
      </div>

      {/* Gate error (write-back off / consent / testbed refusal) */}
      {gateError && (
        <div className="mb-3 flex items-start gap-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{gateError}</span>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="mb-4 rounded border border-border bg-card p-3">
          <div className="mb-2 flex items-center gap-2 text-[12px]">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${result.result.success ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
              {result.result.success ? "success" : "failed"}
            </span>
            <span className="font-mono text-muted-foreground">HTTP {result.result.status}</span>
            {result.result.errorType && <span className="text-red-300">({result.result.errorType})</span>}
            {result.result.auditLogId != null && <span className="ml-auto text-[10px] text-muted-foreground/70">audit #{result.result.auditLogId}</span>}
          </div>
          {/* successCriteria — descriptive, never the authority on success */}
          <div className="mb-2 text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">successCriteria: </span>
            {result.successCriteria.defined ? (
              <span className={result.successCriteria.met ? "text-emerald-300" : "text-amber-300"}>{result.successCriteria.note}</span>
            ) : (
              <span className="italic">{result.successCriteria.note}</span>
            )}
          </div>
          {result.result.missingVariables && result.result.missingVariables.length > 0 && (
            <div className="mb-2 text-[11px] text-red-300">Missing variables: {result.result.missingVariables.join(", ")}</div>
          )}
          <JsonResponseViewer value={result.result.data} emptyLabel="No response body (e.g. a 204)" className="min-h-[120px]" />
          {action.reversible && result.result.success && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-300">
              <RotateCcw className="h-3 w-3" />
              {rollback.text} — roll back from Launch Control if needed.
            </div>
          )}
        </div>
      )}

      {/* Run history (from the production audit log) */}
      <div className="mt-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Recent executions{selectedCustomer ? ` — ${selectedCustomer.name ?? `Customer ${selectedCustomer.id}`}` : ""}
        </div>
        {runs.length === 0 ? (
          <div className="text-[11px] italic text-muted-foreground/70">No executions recorded for this template{customerId ? " against this customer" : ""}.</div>
        ) : (
          <div className="divide-y divide-border rounded border border-border">
            {runs.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-2 py-1 text-[11px]">
                <span className={`rounded px-1 text-[9px] font-bold uppercase ${r.success ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
                  {r.success ? "ok" : "fail"}
                </span>
                <span className="font-mono text-muted-foreground">{r.status ?? "—"}</span>
                <span className="truncate font-mono text-foreground/80">{r.method} {r.endpoint}</span>
                {r.source && <span className="ml-auto shrink-0 text-[9px] uppercase tracking-wider text-muted-foreground/60">{r.source}</span>}
                <span className="shrink-0 text-[10px] text-muted-foreground/60">{new Date(r.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Confirmation dialog — shows the ACTUAL resolved request ── */}
      {confirmOpen && preview && preview.ready && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !executing && setConfirmOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-background p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold">Confirm real write against {preview.tenant.name ?? `Customer ${preview.tenant.customerId}`}</h3>
              <button onClick={() => !executing && setConfirmOpen(false)} className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mb-3 text-[12px] text-muted-foreground">
              This will execute the exact request below against the tenant. It {describeMethodConsequence(preview.resolvedRequest.method)}.
            </p>

            {/* The ACTUAL resolved request */}
            <div className="mb-3 rounded border border-border bg-card p-2">
              <div className="mb-1 break-all font-mono text-[11px]">
                <span className={`mr-2 rounded px-1 text-[10px] font-bold ${methodBadgeClass(preview.resolvedRequest.method)}`}>
                  {preview.resolvedRequest.method}
                </span>
                {preview.resolvedRequest.endpoint}
              </div>
              <JsonResponseViewer value={preview.resolvedRequest.body} emptyLabel="Empty body" className="min-h-[80px]" />
            </div>

            {/* Rollback recap */}
            <div className={`mb-2 flex items-start gap-2 rounded border px-3 py-2 text-[11px] ${rollback.tone === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-300"}`}>
              {rollback.tone === "ok" ? <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>{rollback.text}</span>
            </div>

            {/* dependsOn standalone-run warning (from the server's chain state) */}
            {preview.safety.dependsOn.isolatedRunWarning && (
              <div className="mb-2 flex items-start gap-2 rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{preview.safety.dependsOn.isolatedRunWarning}</span>
              </div>
            )}

            {/* Verification-gate recap */}
            {preview.safety.requiresVerificationGate && (
              <div className="mb-2 flex items-start gap-2 rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-300">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>This template is marked requiresVerificationGate — normally a human verification precedes it in production.</span>
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)} disabled={executing} className="rounded border border-border px-3 py-1.5 text-[11px] text-foreground hover:bg-accent disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={handleExecute}
                disabled={executing}
                className="flex items-center gap-1 rounded bg-red-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {executing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 fill-current" />}
                Execute this real write
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
