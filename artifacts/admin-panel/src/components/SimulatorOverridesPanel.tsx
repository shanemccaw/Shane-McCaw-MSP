import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTestbedContext } from "@/contexts/TestbedContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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

interface MappingRule {
  sourceField: string;
  targetField: string;
  transform?: string;
}

interface MonitorCheck {
  key: string;
  label: string;
  endpoint: string;
  properties?: string[];
  mapping?: MappingRule[];
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

const CUSTOM_FIELD = "__custom__";

type FieldType = "boolean" | "number" | "string" | "unknown";

/**
 * Infer the expected value type for a Graph source field. Transforms that
 * count truthy/falsy values imply a boolean source; otherwise fall back to
 * Graph naming conventions. Returns "unknown" when nothing matches, which
 * keeps the raw JSON textarea as the input.
 */
function inferFieldType(field: string, transform?: string): FieldType {
  if (transform === "countTruthy" || transform === "countFalse") return "boolean";
  const leaf = field.split(".").pop() ?? field;
  if (/^(is|has)[A-Z]/.test(leaf) || /(Enabled|Disabled|Registered|Compliant|Capable|Required|Licensed)$/.test(leaf)) {
    return "boolean";
  }
  if (/(count|size|days|total|number|quantity|score|percent)/i.test(leaf)) return "number";
  if (/(DateTime|Date|At|On)$/.test(leaf) || /(name|mail|id|state|status|type|version|sku|principal|domain)/i.test(leaf)) {
    return "string";
  }
  return "unknown";
}

function formatInjectedValue(v: any): string {
  if (typeof v === "string") return v;
  if (typeof v === "boolean" || typeof v === "number" || v === null) return String(v);
  return JSON.stringify(v);
}

function formatExpiry(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "expired";
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hrs = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (days > 0) return `expires in ${days}d ${hrs}h`;
  if (hrs > 0) return `expires in ${hrs}h ${m}m`;
  return `expires in ${m}m`;
}

export function SimulatorOverridesPanel() {
  const { fetchWithAuth } = useAuth();
  const { selectedCustomerId, selectedCustomer } = useTestbedContext();

  const [checks, setChecks] = useState<MonitorCheck[]>([]);

  const [overrides, setOverrides] = useState<Override[]>([]);
  const [loadingOverrides, setLoadingOverrides] = useState(false);

  // Form state
  const [selectedCheckKey, setSelectedCheckKey] = useState<string>("");
  const [selectedField, setSelectedField] = useState<string>("");
  const [customFieldPath, setCustomFieldPath] = useState("");
  const [boolValue, setBoolValue] = useState(false);
  const [valueText, setValueText] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Run Now state
  const [runningCheck, setRunningCheck] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<any>(null);

  // Tick every 30s so expiry countdowns stay current
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // Fetch monitor checks — full rows, including properties + mapping
    fetchWithAuth("/api/admin/monitor-checks")
      .then(r => r.json())
      .then(d => setChecks(d.checks ?? []))
      .catch(err => toast.error("Failed to load monitor checks"));
  }, [fetchWithAuth]);

  useEffect(() => {
    if (selectedCustomerId != null) {
      loadOverrides(selectedCustomerId);
    } else {
      setOverrides([]);
      setCheckResult(null);
    }
  }, [selectedCustomerId]);

  const selectedCheck = useMemo(
    () => checks.find(c => c.key === selectedCheckKey),
    [checks, selectedCheckKey]
  );

  // Fields the user can target: mapping sourceFields, else raw properties
  const fieldOptions = useMemo(() => {
    if (!selectedCheck) return [];
    const fromMapping = (selectedCheck.mapping ?? []).map(m => m.sourceField).filter(Boolean);
    const source = fromMapping.length > 0 ? fromMapping : (selectedCheck.properties ?? []);
    return [...new Set(source)];
  }, [selectedCheck]);

  const fieldType: FieldType = useMemo(() => {
    if (!selectedField || selectedField === CUSTOM_FIELD) return "unknown";
    const rule = (selectedCheck?.mapping ?? []).find(m => m.sourceField === selectedField);
    return inferFieldType(selectedField, rule?.transform);
  }, [selectedCheck, selectedField]);

  const handleCheckChange = (key: string) => {
    setSelectedCheckKey(key);
    setSelectedField("");
    setCustomFieldPath("");
    setBoolValue(false);
    setValueText("");
  };

  const handleFieldChange = (field: string) => {
    setSelectedField(field);
    setBoolValue(false);
    setValueText("");
  };

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
    if (selectedCustomerId == null || !selectedCheckKey || !selectedField) {
      toast.error("Please fill in all required fields");
      return;
    }

    const isCustom = selectedField === CUSTOM_FIELD;
    const fieldPath = isCustom ? customFieldPath.trim() : `value[0].${selectedField}`;
    if (!fieldPath) {
      toast.error("Please enter a field path");
      return;
    }

    let injectedValue: any;
    switch (fieldType) {
      case "boolean":
        injectedValue = boolValue;
        break;
      case "number": {
        if (valueText.trim() === "" || Number.isNaN(Number(valueText))) {
          toast.error("Please enter a valid number");
          return;
        }
        injectedValue = Number(valueText);
        break;
      }
      case "string": {
        if (valueText === "") {
          toast.error("Please enter a value");
          return;
        }
        injectedValue = valueText;
        break;
      }
      default: {
        if (!valueText.trim()) {
          toast.error("Please enter a value");
          return;
        }
        try {
          injectedValue = JSON.parse(valueText);
        } catch (err) {
          toast.error("Invalid JSON in Injected Value");
          return;
        }
      }
    }

    const check = checks.find(c => c.key === selectedCheckKey);
    if (!check) return;

    setIsSubmitting(true);
    try {
      const payload = {
        testbedCustomerId: selectedCustomerId,
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
        setSelectedField("");
        setCustomFieldPath("");
        setBoolValue(false);
        setValueText("");
        setExpiresAt("");
        loadOverrides(selectedCustomerId);
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
        toast.success("Override cleared");
        if (selectedCustomerId != null) loadOverrides(selectedCustomerId);
      } else {
        toast.error("Failed to clear override");
      }
    } catch (err) {
      toast.error("Network error");
    }
  };

  const handleRunNow = async (checkKey: string) => {
    if (selectedCustomerId == null) return;
    setRunningCheck(checkKey);
    setCheckResult(null);
    try {
      const res = await fetchWithAuth(`/api/admin/simulator/monitor-checks/${checkKey}/run-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testbedCustomerId: selectedCustomerId }),
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

  const checkLabelFor = (key: string) => checks.find(c => c.key === key)?.label ?? key;

  const fieldNameFor = (fieldPath: string) => fieldPath.replace(/^value\[\d+\]\./, "");

  const renderValueInput = () => {
    if (fieldType === "boolean") {
      return (
        <div className="flex items-center gap-3 h-10">
          <Switch checked={boolValue} onCheckedChange={setBoolValue} />
          <span className="font-mono text-xs text-foreground/90">{boolValue ? "true" : "false"}</span>
        </div>
      );
    }
    if (fieldType === "number") {
      return (
        <Input
          type="number"
          step="any"
          placeholder="e.g. 42"
          value={valueText}
          onChange={e => setValueText(e.target.value)}
          className="bg-background font-mono text-xs"
        />
      );
    }
    if (fieldType === "string") {
      return (
        <Input
          placeholder="e.g. user@contoso.com"
          value={valueText}
          onChange={e => setValueText(e.target.value)}
          className="bg-background font-mono text-xs"
        />
      );
    }
    return (
      <textarea
        placeholder={'e.g. false, 42, "string", or {"key": "value"}'}
        value={valueText}
        onChange={e => setValueText(e.target.value)}
        className="w-full h-24 bg-background border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-ring"
      />
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background font-sans text-foreground/90">
      <div className="p-4 overflow-y-auto space-y-5 flex-1">

        {selectedCustomerId == null ? (
          <div className="border border-dashed border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
            Select a testbed customer in the header above to inject overrides against it.
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            Target: <span className="text-foreground font-medium">{selectedCustomer?.name ?? `Customer #${selectedCustomerId}`}</span>
            <span className="font-mono text-[10px]"> (#{selectedCustomerId})</span>
          </div>
        )}

        {selectedCustomerId != null && (
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
                        onChange={e => handleCheckChange(e.target.value)}
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
                              <span className="font-semibold text-primary">Status: {checkResult.status}</span>
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
                    <label className="text-xs font-medium text-muted-foreground">Field</label>
                    <select
                      value={selectedField}
                      onChange={e => handleFieldChange(e.target.value)}
                      disabled={!selectedCheckKey}
                      className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring disabled:opacity-50"
                    >
                      <option value="">{selectedCheckKey ? "-- Select Field --" : "Select a check first"}</option>
                      {fieldOptions.map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                      {selectedCheckKey && <option value={CUSTOM_FIELD}>Custom field path…</option>}
                    </select>
                    {selectedField && selectedField !== CUSTOM_FIELD && (
                      <div className="text-[10px] font-mono text-muted-foreground">
                        Path: value[0].{selectedField}
                      </div>
                    )}
                    {selectedField === CUSTOM_FIELD && (
                      <Input
                        placeholder="e.g. value[0].isMfaRegistered"
                        value={customFieldPath}
                        onChange={e => setCustomFieldPath(e.target.value)}
                        className="bg-background font-mono text-xs"
                      />
                    )}
                  </div>

                  <div className="space-y-2 col-span-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Injected Value
                      {fieldType !== "unknown" && (
                        <span className="ml-2 text-[10px] font-mono text-primary/70">({fieldType})</span>
                      )}
                      {fieldType === "unknown" && selectedField && (
                        <span className="ml-2 text-[10px] font-mono text-muted-foreground/70">(JSON)</span>
                      )}
                    </label>
                    {renderValueInput()}
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
                      <TableHead className="text-xs font-semibold py-3">Check</TableHead>
                      <TableHead className="text-xs font-semibold py-3">Field</TableHead>
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
                          <TableCell className="py-2.5 text-xs text-foreground/90">
                            <div className="flex flex-col">
                              <span className="font-medium">{checkLabelFor(ov.monitorCheckKey)}</span>
                              <span className="text-[10px] font-mono text-muted-foreground">{ov.monitorCheckKey}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 font-mono text-xs text-foreground/90">
                            <span title={ov.fieldPath}>{fieldNameFor(ov.fieldPath)}</span>
                          </TableCell>
                          <TableCell className="py-2.5 font-mono text-[11px] text-emerald-400">
                            <span className="break-all">{formatInjectedValue(ov.injectedValue)}</span>
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
                              <div className="text-[9px] text-muted-foreground mt-1" title={new Date(ov.expiresAt).toLocaleString()}>
                                {formatExpiry(ov.expiresAt, now)}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="py-2.5 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteOverride(ov.id)}
                              title="Clear override"
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
