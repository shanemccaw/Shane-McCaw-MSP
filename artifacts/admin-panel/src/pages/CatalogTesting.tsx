/**
 * CatalogTesting.tsx — the "Packs & Remediations" testbed testing surface
 * (Git #1172). Lists every sellable Quick-Start Write Pack and micro-remediation
 * catalog product joined to its real executable (via GET /admin/remediation-
 * catalog), and lets an admin trigger each against a connected TESTBED tenant
 * and see the actual result.
 *
 * It introduces no new execution path: packs run through the existing
 * POST /admin/config-packs/:packKey/run(/plan); micro-remediations through the
 * existing POST /admin/write-actions/:templateId/preview|execute (which is
 * testbed-gated and requires confirmed:true server-side). This surface only
 * resolves which key to send. Every write is REAL against the selected tenant.
 */
import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const API = "/api";

interface TestbedCustomer { id: number; name: string; tenantId: string; }

interface Executable {
  kind: "config_pack" | "micro_remediation" | "unwired" | "not_in_catalog";
  packKey?: string;
  templateId?: string;
  reason?: string;
  existsInDb: boolean;
  stepCount?: number;
  method?: string;
  endpoint?: string;
  requiredVariables?: string[];
  reversible?: boolean;
  requiresVerificationGate?: boolean;
}

interface CatalogProduct {
  serviceId: number;
  name: string;
  slug: string | null;
  category: string | null;
  priceCents: number | null;
  visibility: string;
  isPublic: boolean;
  executionReadiness: string | null;
  requiredPermission: string | null;
  executable: Executable;
  testbedRunnable: boolean;
}

interface CatalogResponse {
  packs: CatalogProduct[];
  microRemediations: CatalogProduct[];
  summary: {
    packCount: number;
    microRemediationCount: number;
    runnablePackCount: number;
    runnableMicroRemediationCount: number;
    unwiredMicroRemediations: Array<{ slug: string | null; reason?: string }>;
  };
}

/**
 * Per-executable permission verdict from GET /api/admin/write-permissions
 * (Git #1875). `missing` non-empty means a run here is a guaranteed
 * 403 Authorization_RequestDenied, not a maybe.
 */
interface PermissionVerdict {
  required: string[];
  missing: string[];
  notRequested: string[];
  nonGraphSteps: string[];
  unmappedSteps: string[];
}

interface WritePermissionsResponse {
  customerId: number;
  tenantId: string;
  checkedAt: string;
  mspWriteBackEnabled: boolean;
  writeConsentStatus: string;
  writeAppId: string;
  granted: string[];
  grantedError: string | null;
  platformRequired: string[];
  platformMissing: string[];
  documentedButNotRequested: Array<{ permission: string; reason: string }>;
  byPack: Record<string, PermissionVerdict>;
  byTemplate: Record<string, PermissionVerdict>;
}

/**
 * What the UI is allowed to say about a given executable's write permissions.
 * `unknown` exists so a failed permission read renders as explicitly unknown
 * rather than falling back to green — presenting a 403-guaranteed action as
 * ready to fire is the exact defect #1875 was filed for.
 */
type WriteGate =
  | { state: "ok" }
  | { state: "unknown"; detail: string }
  | { state: "refused"; missing: string[]; notRequested: string[]; nonGraphSteps: string[] };

function resolveWriteGate(
  perms: WritePermissionsResponse | null,
  verdict: PermissionVerdict | undefined,
): WriteGate {
  if (!perms) return { state: "unknown", detail: "Select a testbed tenant to check write permissions." };
  if (perms.grantedError) return { state: "unknown", detail: perms.grantedError };
  if (!perms.mspWriteBackEnabled) {
    return { state: "refused", missing: [], notRequested: [], nonGraphSteps: [] };
  }
  if (perms.writeConsentStatus !== "granted") {
    return { state: "refused", missing: [], notRequested: [], nonGraphSteps: [] };
  }
  if (!verdict) return { state: "unknown", detail: "No permission mapping was returned for this executable." };
  if (verdict.missing.length > 0 || verdict.notRequested.length > 0 || verdict.nonGraphSteps.length > 0) {
    return {
      state: "refused",
      missing: verdict.missing,
      notRequested: verdict.notRequested,
      nonGraphSteps: verdict.nonGraphSteps,
    };
  }
  // Nothing is known to be missing, but at least one step has no permission rule
  // — so "nothing missing" is a gap in the mapping, not a clean bill of health.
  // Report it as unverified rather than letting it fall through to green.
  if (verdict.unmappedSteps.length > 0) {
    return {
      state: "unknown",
      detail: `Permission requirements are unmapped for: ${verdict.unmappedSteps.join(", ")}`,
    };
  }
  return { state: "ok" };
}

/**
 * The real "write refused by tenant permissions" state. Rendered in place of a
 * green ready-to-fire row whenever a write against this tenant cannot succeed.
 */
function WriteRefusedNotice({ gate, perms }: { gate: WriteGate; perms: WritePermissionsResponse | null }) {
  if (gate.state === "ok") return null;

  if (gate.state === "unknown") {
    return (
      <div className="mt-2 rounded-md border border-gray-500/30 bg-gray-500/5 px-3 py-2">
        <div className="text-[11px] font-semibold text-gray-300">Write permissions not verified</div>
        <div className="mt-0.5 text-[11px] text-gray-400">{gate.detail}</div>
      </div>
    );
  }

  const gateBlocked =
    perms && (!perms.mspWriteBackEnabled || perms.writeConsentStatus !== "granted");

  return (
    <div className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2">
      <div className="text-[11px] font-semibold text-red-300">Write refused by tenant permissions</div>
      {gateBlocked ? (
        <div className="mt-0.5 text-[11px] text-red-200/90">
          {!perms?.mspWriteBackEnabled
            ? "Write-back is switched off for this customer's MSP (msps.write_back_enabled = false)."
            : `The tenant's write consent is "${perms?.writeConsentStatus}", not "granted".`}
        </div>
      ) : (
        <>
          {gate.missing.length > 0 && (
            <div className="mt-1 text-[11px] text-red-200/90">
              The write app has not been admin-consented for{" "}
              {gate.missing.length === 1 ? "this permission" : "these permissions"} in this tenant, so
              running it returns <span className="font-mono">403 Authorization_RequestDenied</span>:
              <ul className="mt-1 space-y-0.5">
                {gate.missing.map(p => (
                  <li key={p} className="font-mono text-[10px] text-red-300">• {p}</li>
                ))}
              </ul>
            </div>
          )}
          {gate.notRequested.length > 0 && (
            <div className="mt-1 text-[11px] text-amber-200/90">
              Deliberately not requested from customers — this product stays unavailable by design:
              <ul className="mt-1 space-y-0.5">
                {gate.notRequested.map(p => (
                  <li key={p} className="font-mono text-[10px] text-amber-300">• {p}</li>
                ))}
              </ul>
            </div>
          )}
          {gate.nonGraphSteps.length > 0 && (
            <div className="mt-1 text-[11px] text-amber-200/90">
              No Graph permission can enable{" "}
              {gate.nonGraphSteps.length === 1 ? "this step" : "these steps"} — the executor has no
              transport for the endpoint:
              <ul className="mt-1 space-y-0.5">
                {gate.nonGraphSteps.map(s => (
                  <li key={s} className="font-mono text-[10px] text-amber-300">• {s}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

type Fetcher = (url: string, opts?: RequestInit) => Promise<Response>;

function price(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;
}

function VisibilityBadge({ visibility }: { visibility: string }) {
  const isPublic = visibility === "public";
  return (
    <Badge variant="outline" className={isPublic ? "border-emerald-500/30 text-emerald-400" : "border-amber-500/30 text-amber-400"}>
      {visibility}
    </Badge>
  );
}

/** Shared inline result box for both packs and micro-remediations. */
function ResultBox({ ok, label, body }: { ok: boolean; label: string; body: unknown }) {
  return (
    <div className={`mt-2 rounded-md border px-3 py-2 ${ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={ok ? "border-emerald-500/30 text-emerald-400" : "border-red-500/30 text-red-400"}>{label}</Badge>
      </div>
      <pre className="mt-2 text-[10px] text-gray-300 font-mono bg-background rounded p-2 overflow-x-auto max-h-64">{JSON.stringify(body, null, 2)}</pre>
    </div>
  );
}

// ── Micro-remediation row ────────────────────────────────────────────────────

function MicroRemediationRow({ product, customerId, fetchWithAuth, perms }: {
  product: CatalogProduct; customerId: string; fetchWithAuth: Fetcher; perms: WritePermissionsResponse | null;
}) {
  const { toast } = useToast();
  const templateId = product.executable.templateId;
  const wired = product.testbedRunnable && !!templateId;
  const gate = resolveWriteGate(perms, templateId ? perms?.byTemplate[templateId] : undefined);
  // #1875 — a wired executable is NOT runnable if the tenant would refuse the
  // write. Only an affirmatively-verified "ok" enables the real-run button.
  const runnable = wired && gate.state === "ok";
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [previewed, setPreviewed] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; label: string; body: unknown } | null>(null);

  useEffect(() => {
    setVariables(Object.fromEntries((product.executable.requiredVariables ?? []).map(v => [v, ""])));
    setPreviewed(false);
    setResult(null);
  }, [product.serviceId, product.executable.requiredVariables]);

  const requireTenant = () => {
    if (!customerId) { toast({ title: "Select a testbed tenant first", variant: "destructive" }); return false; }
    return true;
  };

  const preview = async () => {
    if (!requireTenant() || !templateId) return;
    setBusy(true); setResult(null);
    try {
      const res = await fetchWithAuth(`${API}/admin/write-actions/${templateId}/preview`, {
        method: "POST", body: JSON.stringify({ customerId: Number(customerId), variables }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setPreviewed(Boolean(data.ready));
      setResult({ ok: Boolean(data.ready), label: data.ready ? "resolved — ready to run" : "resolved — missing variables", body: data });
    } catch (err) {
      setResult({ ok: false, label: "preview error", body: { error: err instanceof Error ? err.message : String(err) } });
    } finally { setBusy(false); }
  };

  const execute = async () => {
    if (!requireTenant() || !templateId) return;
    if (!window.confirm(`Run "${product.name}" for REAL against the selected testbed tenant? This makes an actual ${product.executable.method ?? ""} write.`)) return;
    setBusy(true); setResult(null);
    try {
      const res = await fetchWithAuth(`${API}/admin/write-actions/${templateId}/execute`, {
        method: "POST", body: JSON.stringify({ customerId: Number(customerId), variables, confirmed: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Execute failed (${res.status})`);
      const ok = Boolean(data.result?.success);
      setResult({ ok, label: ok ? `executed — status ${data.result?.status}` : `execution returned an error — status ${data.result?.status}`, body: data });
      toast({ title: ok ? "Remediation executed" : "Remediation returned an error", variant: ok ? "default" : "destructive" });
    } catch (err) {
      setResult({ ok: false, label: "execute error", body: { error: err instanceof Error ? err.message : String(err) } });
      toast({ title: "Error", description: err instanceof Error ? err.message : "Execute failed", variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-border bg-card/40 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white">{product.name}</span>
            <VisibilityBadge visibility={product.visibility} />
            <span className="text-xs text-gray-500">{price(product.priceCents)}</span>
          </div>
          <div className="mt-1 text-xs text-gray-500 font-mono truncate">{product.slug}</div>
          {wired ? (
            <div className="mt-1 text-[11px] text-gray-400 font-mono truncate">
              {product.executable.method} {product.executable.endpoint} · {templateId}
              {product.executable.reversible ? " · reversible" : ""}
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-amber-400">
              {product.executable.kind === "unwired"
                ? `Not runnable — ${product.executable.reason ?? "no executable template"}`
                : "Not runnable — executable missing in DB"}
            </div>
          )}
          {product.executionReadiness && (
            <div className="mt-1 text-[11px] text-gray-500">readiness: {product.executionReadiness}{product.requiredPermission ? ` · needs ${product.requiredPermission}` : ""}</div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {/* Preview never writes, so it stays available even when the tenant would refuse the write. */}
          <Button size="sm" variant="outline" disabled={!wired || busy} onClick={preview} className="text-xs">Preview</Button>
          <Button size="sm" disabled={!runnable || busy || !previewed} onClick={execute}
            className="bg-amber-600 hover:bg-amber-700 text-white text-xs">{busy ? "…" : "Run (real)"}</Button>
        </div>
      </div>

      {wired && <WriteRefusedNotice gate={gate} perms={perms} />}

      {wired && (product.executable.requiredVariables?.length ?? 0) > 0 && (
        <div className="mt-3 space-y-1.5">
          {(product.executable.requiredVariables ?? []).map(v => (
            <div key={v} className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-[#2E9EFF] w-40 shrink-0 truncate">{`{{${v}}}`}</span>
              <Input value={variables[v] ?? ""} onChange={e => { setVariables(prev => ({ ...prev, [v]: e.target.value })); setPreviewed(false); }}
                className="bg-background border-border text-white text-xs font-mono h-7" />
            </div>
          ))}
        </div>
      )}

      {result && <ResultBox ok={result.ok} label={result.label} body={result.body} />}
    </div>
  );
}

// ── Config-pack row ──────────────────────────────────────────────────────────

function PackRow({ product, customerId, fetchWithAuth, perms }: {
  product: CatalogProduct; customerId: string; fetchWithAuth: Fetcher; perms: WritePermissionsResponse | null;
}) {
  const { toast } = useToast();
  const packKey = product.executable.packKey;
  const wired = product.testbedRunnable && !!packKey;
  const gate = resolveWriteGate(perms, packKey ? perms?.byPack[packKey] : undefined);
  // #1875 — the pack fires 8 real writes through the Workflow Engine. If any of
  // its steps needs a permission the tenant has not consented, the run reaches
  // Graph and fails there; it must not be offered as ready.
  const runnable = wired && gate.state === "ok";
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; label: string; body: unknown } | null>(null);

  const requireTenant = () => {
    if (!customerId) { toast({ title: "Select a testbed tenant first", variant: "destructive" }); return false; }
    return true;
  };

  const plan = async () => {
    if (!packKey) return;
    setBusy(true); setResult(null);
    try {
      const res = await fetchWithAuth(`${API}/admin/config-packs/${packKey}/run/plan`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Plan failed");
      setResult({ ok: true, label: `plan — ${data.ordered?.length ?? 0} steps`, body: data });
    } catch (err) {
      setResult({ ok: false, label: "plan error", body: { error: err instanceof Error ? err.message : String(err) } });
    } finally { setBusy(false); }
  };

  const run = async () => {
    if (!requireTenant() || !packKey) return;
    if (!window.confirm(`Run the "${product.name}" pack for REAL against the selected testbed tenant? This fires ${product.executable.stepCount ?? "multiple"} real write steps through the Workflow Engine.`)) return;
    setBusy(true); setResult(null);
    try {
      const res = await fetchWithAuth(`${API}/admin/config-packs/${packKey}/run`, {
        method: "POST", body: JSON.stringify({ customerId: Number(customerId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Run failed (${res.status})`);
      setResult({ ok: true, label: `run started — runId ${data.runId}`, body: data });
      toast({ title: "Pack run started", description: `runId ${data.runId}` });
    } catch (err) {
      setResult({ ok: false, label: "run error", body: { error: err instanceof Error ? err.message : String(err) } });
      toast({ title: "Error", description: err instanceof Error ? err.message : "Run failed", variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-border bg-card/40 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white">{product.name}</span>
            <VisibilityBadge visibility={product.visibility} />
            <span className="text-xs text-gray-500">{price(product.priceCents)}</span>
          </div>
          <div className="mt-1 text-xs text-gray-500 font-mono truncate">{product.slug}</div>
          {wired ? (
            <div className="mt-1 text-[11px] text-gray-400 font-mono truncate">{packKey} · {product.executable.stepCount ?? 0} steps</div>
          ) : (
            <div className="mt-1 text-[11px] text-amber-400">
              {product.executable.kind === "unwired" ? `Not runnable — ${product.executable.reason ?? "no pack"}` : "Not runnable — pack missing in DB"}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {/* Plan is pure materialization — no tenant I/O — so permissions don't gate it. */}
          <Button size="sm" variant="outline" disabled={!wired || busy} onClick={plan} className="text-xs">Plan</Button>
          <Button size="sm" disabled={!runnable || busy} onClick={run}
            className="bg-amber-600 hover:bg-amber-700 text-white text-xs">{busy ? "…" : "Run (real)"}</Button>
        </div>
      </div>
      {wired && <WriteRefusedNotice gate={gate} perms={perms} />}
      {result && <ResultBox ok={result.ok} label={result.label} body={result.body} />}
    </div>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

export function CatalogTestingSection({ fetchWithAuth }: { fetchWithAuth: Fetcher }) {
  const { toast } = useToast();
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [customers, setCustomers] = useState<TestbedCustomer[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [perms, setPerms] = useState<WritePermissionsResponse | null>(null);
  const [permsLoading, setPermsLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetchWithAuth(`${API}/admin/remediation-catalog`).then(r => r.json()),
      fetchWithAuth(`${API}/admin/baseline-templates/testbed-customers`).then(r => r.json()),
    ])
      .then(([cat, cust]: [CatalogResponse, { customers: TestbedCustomer[] }]) => {
        setCatalog(cat);
        setCustomers(cust.customers ?? []);
        if ((cust.customers ?? []).length === 1) setCustomerId(String(cust.customers[0].id));
      })
      .catch(() => toast({ title: "Error", description: "Failed to load remediation catalog", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [fetchWithAuth, toast]);

  useEffect(() => { load(); }, [load]);

  // #1875 — re-check the selected tenant's REAL write permissions whenever the
  // tenant changes. Until this resolves, every row renders "not verified" and
  // its real-run button stays disabled: a 403-guaranteed action must never be
  // presented as green and ready to fire.
  useEffect(() => {
    if (!customerId) { setPerms(null); return; }
    let cancelled = false;
    setPermsLoading(true);
    setPerms(null);
    fetchWithAuth(`${API}/admin/write-permissions?customerId=${customerId}`)
      .then(r => r.json())
      .then((data: WritePermissionsResponse & { error?: string }) => {
        if (cancelled) return;
        if (data.error) {
          setPerms(null);
          toast({ title: "Write permission check failed", description: data.error, variant: "destructive" });
          return;
        }
        setPerms(data);
      })
      .catch(() => { if (!cancelled) setPerms(null); })
      .finally(() => { if (!cancelled) setPermsLoading(false); });
    return () => { cancelled = true; };
  }, [customerId, fetchWithAuth, toast]);

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading catalog…</div>;
  if (!catalog) return <div className="p-6 text-sm text-gray-500">No catalog data.</div>;

  const { packs, microRemediations, summary } = catalog;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <p className="text-xs font-bold text-amber-400 uppercase tracking-wide">⚠ Runs REAL write actions against a connected testbed tenant — not a dry run</p>
        <p className="text-xs text-amber-300/80 mt-1">Every "Run (real)" here executes actual Microsoft Graph writes (create/disable accounts, revoke sessions, remove licenses, isolate devices, …) against the selected testbed tenant. Only testbed-flagged customers are selectable, enforced server-side.</p>
      </div>

      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-[280px]">
          <Label className="text-gray-400 text-xs">Test tenant (testbed customers only)</Label>
          {customers.length === 0 ? (
            <div className="text-xs text-gray-500 mt-2">No testbed customers configured.</div>
          ) : (
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger className="bg-background border-border text-white mt-1"><SelectValue placeholder="Select a testbed customer…" /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                {customers.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="text-[11px] text-gray-500 text-right">
          <div>Packs wired: {summary.runnablePackCount}/{summary.packCount}</div>
          <div>Micro-remediations wired: {summary.runnableMicroRemediationCount}/{summary.microRemediationCount}</div>
          <Button size="sm" variant="outline" onClick={load} className="text-xs mt-1">Refresh</Button>
        </div>
      </div>

      {/*
        #1875 — tenant-level write permission state. "Wired" above counts what
        exists in the DB; this counts what the tenant will actually permit. They
        are different numbers and conflating them is what made every pack look
        ready while all of them were being refused 403.
      */}
      {customerId && (
        permsLoading ? (
          <div className="rounded-lg border border-border bg-card/40 px-4 py-3 text-xs text-gray-400">
            Checking this tenant's real write permissions…
          </div>
        ) : !perms ? (
          <div className="rounded-lg border border-gray-500/30 bg-gray-500/5 px-4 py-3">
            <p className="text-xs font-semibold text-gray-300">Write permissions could not be checked</p>
            <p className="text-[11px] text-gray-400 mt-1">
              Every real-run button stays disabled until this check succeeds.
            </p>
          </div>
        ) : perms.grantedError ? (
          <div className="rounded-lg border border-gray-500/30 bg-gray-500/5 px-4 py-3">
            <p className="text-xs font-semibold text-gray-300">Write permissions not verified</p>
            <p className="text-[11px] text-gray-400 mt-1">{perms.grantedError}</p>
          </div>
        ) : perms.platformMissing.length > 0 ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3">
            <p className="text-xs font-bold text-red-300 uppercase tracking-wide">
              Write refused by tenant permissions — {perms.platformMissing.length} of {perms.platformRequired.length} required permissions are not consented
            </p>
            <p className="text-[11px] text-red-200/90 mt-1">
              Write app <span className="font-mono">{perms.writeAppId}</span> holds {perms.granted.length} Graph
              application permission{perms.granted.length === 1 ? "" : "s"} in tenant{" "}
              <span className="font-mono">{perms.tenantId}</span>. Writes needing any of the following return{" "}
              <span className="font-mono">403 Authorization_RequestDenied</span>:
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {perms.platformMissing.map(p => (
                <span key={p} className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] text-red-300">{p}</span>
              ))}
            </div>
            {perms.documentedButNotRequested.length > 0 && (
              <p className="text-[11px] text-amber-200/80 mt-2">
                Separately, {perms.documentedButNotRequested.length} documented permission
                {perms.documentedButNotRequested.length === 1 ? " is" : "s are"} deliberately not requested from
                customers — the products needing{" "}
                {perms.documentedButNotRequested.length === 1 ? "it" : "them"} stay unavailable by design.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
            <p className="text-xs font-semibold text-emerald-300">
              Write permissions verified — all {perms.platformRequired.length} required Graph application permissions are admin-consented in this tenant
            </p>
            <p className="text-[11px] text-emerald-200/70 mt-1">
              Checked {new Date(perms.checkedAt).toLocaleString()} against tenant{" "}
              <span className="font-mono">{perms.tenantId}</span>.
            </p>
          </div>
        )
      )}

      <div>
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wide mb-2">Micro-Remediations ({microRemediations.length})</h3>
        <div className="space-y-2">
          {microRemediations.map(p => <MicroRemediationRow key={p.serviceId} product={p} customerId={customerId} fetchWithAuth={fetchWithAuth} perms={perms} />)}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wide mb-2">Config Packs / Quick-Start Write Packs ({packs.length})</h3>
        <div className="space-y-2">
          {packs.map(p => <PackRow key={p.serviceId} product={p} customerId={customerId} fetchWithAuth={fetchWithAuth} perms={perms} />)}
        </div>
      </div>
    </div>
  );
}
