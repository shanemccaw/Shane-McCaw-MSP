import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Loader2, Play, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Testbed {
  id: number;
  name: string;
  domain?: string;
}

interface MonitorCheck {
  key: string;
  label: string;
  endpoint: string;
}

interface Override {
  id: number;
  testbedCustomerId: number;
  monitorCheckKey: string;
  graphEndpoint: string;
  fieldPath: string;
  injectedValue: any;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export function SimulatorOverridesPanel() {
  const { fetchWithAuth } = useAuth();
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [selectedTestbedId, setSelectedTestbedId] = useState<number | "">("");

  const [checks, setChecks] = useState<MonitorCheck[]>([]);
  
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [loadingOverrides, setLoadingOverrides] = useState(false);

  // Form state
  const [selectedCheckKey, setSelectedCheckKey] = useState<string>("");
  const [fieldPath, setFieldPath] = useState("");
  const [injectedValueText, setInjectedValueText] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Run Now state
  const [runningCheck, setRunningCheck] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<any>(null);

  useEffect(() => {
    // Fetch testbeds
    fetchWithAuth("/api/admin/testbeds")
      .then(r => r.json())
      .then(d => setTestbeds(d.testbeds ?? []))
      .catch(err => toast.error("Failed to load testbeds"));

    // Fetch monitor checks
    fetchWithAuth("/api/admin/monitor-checks")
      .then(r => r.json())
      .then(d => setChecks(d.checks ?? []))
      .catch(err => toast.error("Failed to load monitor checks"));
  }, [fetchWithAuth]);

  useEffect(() => {
    if (selectedTestbedId !== "") {
      loadOverrides(Number(selectedTestbedId));
    } else {
      setOverrides([]);
      setCheckResult(null);
    }
  }, [selectedTestbedId]);

  const loadOverrides = async (testbedId: number) => {
    setLoadingOverrides(true);
    try {
      const res = await fetchWithAuth(`/api/admin/simulator/overrides?testbedCustomerId=${testbedId}`);
      if (res.ok) {
        const data = await res.json();
        setOverrides(data.overrides || []);
      } else {
        toast.error("Failed to load overrides");
      }
    } catch (err) {
      toast.error("Network error loading overrides");
    } finally {
      setLoadingOverrides(false);
    }
  };

  const handleCreateOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTestbedId === "" || !selectedCheckKey || !fieldPath || !injectedValueText) {
      toast.error("Please fill in all required fields");
      return;
    }

    let injectedValue: any;
    try {
      injectedValue = JSON.parse(injectedValueText);
    } catch (err) {
      toast.error("Invalid JSON in Injected Value");
      return;
    }

    const check = checks.find(c => c.key === selectedCheckKey);
    if (!check) return;

    setIsSubmitting(true);
    try {
      const payload = {
        testbedCustomerId: Number(selectedTestbedId),
        monitorCheckKey: check.key,
        graphEndpoint: check.endpoint,
        fieldPath,
        injectedValue,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      };

      const res = await fetchWithAuth("/api/admin/simulator/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success("Override created");
        setFieldPath("");
        setInjectedValueText("");
        setExpiresAt("");
        loadOverrides(Number(selectedTestbedId));
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to create override");
      }
    } catch (err: any) {
      toast.error(err.message || "Network error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteOverride = async (id: number) => {
    try {
      const res = await fetchWithAuth(`/api/admin/simulator/overrides/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Override deleted");
        if (selectedTestbedId !== "") loadOverrides(Number(selectedTestbedId));
      } else {
        toast.error("Failed to delete override");
      }
    } catch (err) {
      toast.error("Network error");
    }
  };

  const handleRunNow = async (checkKey: string) => {
    if (selectedTestbedId === "") return;
    setRunningCheck(checkKey);
    setCheckResult(null);
    try {
      const res = await fetchWithAuth(`/api/admin/simulator/monitor-checks/${checkKey}/run-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testbedCustomerId: Number(selectedTestbedId) }),
      });
      
      const data = await res.json();
      if (res.ok) {
        toast.success("Monitor check executed");
        setCheckResult({ checkKey, ...data });
      } else {
        toast.error(data.error || "Failed to execute monitor check");
        setCheckResult({ checkKey, error: data.error });
      }
    } catch (err: any) {
      toast.error(err.message || "Network error executing monitor check");
      setCheckResult({ checkKey, error: err.message });
    } finally {
      setRunningCheck(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background font-sans text-foreground/90">
      <div className="p-4 overflow-y-auto space-y-5 flex-1">

        {/* Top Section: Picker */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Testbed Customer Selection</h3>
          <div className="w-80">
            <select
              value={selectedTestbedId}
              onChange={e => setSelectedTestbedId(e.target.value ? Number(e.target.value) : "")}
              className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring"
            >
              <option value="">-- Select Testbed Customer --</option>
              {testbeds.map(tb => (
                <option key={tb.id} value={tb.id}>{tb.name} {tb.domain ? `(${tb.domain})` : ""}</option>
              ))}
            </select>
          </div>
        </div>

        {selectedTestbedId !== "" && (
          <>
            {/* Create Override Form */}
            <div className="bg-card border border-border rounded-lg p-4 space-y-4">
              <h3 className="text-sm font-semibold text-foreground border-b border-border pb-2">Create Simulator Override</h3>

              <form onSubmit={handleCreateOverride} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Monitor Check</label>
                    <div className="flex gap-2">
                      <select
                        value={selectedCheckKey}
                        onChange={e => setSelectedCheckKey(e.target.value)}
                        className="flex-1 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring"
                      >
                        <option value="">-- Select Check --</option>
                        {checks.map(c => (
                          <option key={c.key} value={c.key}>{c.label} ({c.key})</option>
                        ))}
                      </select>
                      {selectedCheckKey && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => handleRunNow(selectedCheckKey)}
                          disabled={runningCheck === selectedCheckKey}
                          className="h-10 px-3 shrink-0"
                        >
                          {runningCheck === selectedCheckKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        </Button>
                      )}
                    </div>
                    {checkResult && selectedCheckKey === checkResult.checkKey && (
                      <div className={`mt-2 p-3 rounded-md border text-xs ${checkResult.error ? 'bg-destructive/10 border-destructive/40 text-destructive' : 'bg-background border-border text-foreground/90'}`}>
                        {checkResult.error ? (
                          <div className="flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {checkResult.error}</div>
                        ) : (
                          <div className="space-y-1 font-mono text-[11px]">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-[#58A6FF]">Status: {checkResult.status}</span>
                              <span className="text-muted-foreground">Items: {checkResult.itemCount}</span>
                            </div>
                            {checkResult.severityMatched && (
                              <div className="text-destructive">Severity: {checkResult.severityMatched}</div>
                            )}
                            {checkResult.errorMessage && (
                              <div className="text-amber-400 mt-1">Error: {checkResult.errorMessage}</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Field Path</label>
                    <Input
                      placeholder="e.g. value[0].isMfaRegistered"
                      value={fieldPath}
                      onChange={e => setFieldPath(e.target.value)}
                      className="bg-background font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-2 col-span-2">
                    <label className="text-xs font-medium text-muted-foreground">Injected Value (JSON)</label>
                    <textarea
                      placeholder={'e.g. false, 42, "string", or {"key": "value"}'}
                      value={injectedValueText}
                      onChange={e => setInjectedValueText(e.target.value)}
                      className="w-full h-24 bg-background border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-ring"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Expires At (Optional)</label>
                    <Input
                      type="datetime-local"
                      value={expiresAt}
                      onChange={e => setExpiresAt(e.target.value)}
                      className="bg-background [color-scheme:dark]"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="text-xs px-4"
                  >
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Create Override
                  </Button>
                </div>
              </form>
            </div>

            {/* Overrides Table */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center justify-between">
                <span>Active Overrides</span>
                <Badge variant="outline" className="text-muted-foreground">{overrides.length} Total</Badge>
              </h3>

              <div className="border border-border rounded-lg overflow-hidden bg-background">
                <Table>
                  <TableHeader className="bg-card">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold py-3">Endpoint</TableHead>
                      <TableHead className="text-xs font-semibold py-3">Field Path</TableHead>
                      <TableHead className="text-xs font-semibold py-3">Injected Value</TableHead>
                      <TableHead className="text-xs font-semibold py-3">Status</TableHead>
                      <TableHead className="text-xs font-semibold py-3 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingOverrides && overrides.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center">
                          <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto" />
                        </TableCell>
                      </TableRow>
                    ) : overrides.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center text-muted-foreground text-sm">
                          No overrides found for this testbed.
                        </TableCell>
                      </TableRow>
                    ) : (
                      overrides.map(ov => (
                        <TableRow key={ov.id} className="hover:bg-accent/30">
                          <TableCell className="py-2.5 font-mono text-xs text-foreground/90">
                            <div className="flex flex-col">
                              <span className="text-[#58A6FF]">{ov.monitorCheckKey}</span>
                              <span className="text-[10px] text-muted-foreground">{ov.graphEndpoint}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 font-mono text-xs text-foreground/90">{ov.fieldPath}</TableCell>
                          <TableCell className="py-2.5 font-mono text-[11px] text-emerald-400">
                            <pre className="whitespace-pre-wrap max-w-xs">{JSON.stringify(ov.injectedValue, null, 2)}</pre>
                          </TableCell>
                          <TableCell className="py-2.5">
                            <Badge
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold font-mono border ${
                                ov.isActive
                                  ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/10"
                                  : "text-muted-foreground border-border bg-card"
                              }`}
                            >
                              {ov.isActive ? "ACTIVE" : "EXPIRED"}
                            </Badge>
                            {ov.expiresAt && (
                              <div className="text-[9px] text-muted-foreground mt-1">
                                Exp: {new Date(ov.expiresAt).toLocaleString()}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="py-2.5 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteOverride(ov.id)}
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
