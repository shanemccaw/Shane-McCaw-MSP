import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useModal } from "@/contexts/ModalContext";
import {
  Lock,
  Unlock,
  Loader2,
  Building2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SimulatorOverridesPanel } from "./SimulatorOverridesPanel";
import { SimulatorEnginesPanel } from "./SimulatorEnginesPanel";
import { SqlQueryCanvas, type SqlOutput } from "./SqlQueryCanvas";

interface Msp {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  status: "active" | "suspended" | "trial";
  isDirectBusiness: boolean;
  isTestbed: boolean;
}

interface TestbedCustomer {
  id: number;
  mspId: number;
  name: string;
  domain: string | null;
  isTestbed: boolean;
}

export function SimulatorCenterCanvas({
  sqlOutput,
  onSqlOutputChange,
}: {
  simDate?: string;
  isReplaying?: boolean;
  /** Lifted to SimulatorStudioPage — the bottom panel's Query Output tab
   *  renders the same state the SQL Query editor writes. */
  sqlOutput: SqlOutput;
  onSqlOutputChange: (next: SqlOutput) => void;
}) {
  const { fetchWithAuth } = useAuth();
  const { openModal } = useModal();

  const [activeTab, setActiveTab] = useState<"sql" | "testbeds" | "overrides" | "engines">("sql");

  // Testbeds state
  const [msps, setMsps] = useState<Msp[]>([]);
  const [loadingTestbeds, setLoadingTestbeds] = useState(false);
  const [sessionLocks, setSessionLocks] = useState<Record<number, boolean>>({});
  const [selectedMspId, setSelectedMspId] = useState<number | null>(null);
  const [testbedCustomers, setTestbedCustomers] = useState<TestbedCustomer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  useEffect(() => {
    // Saved scripts clicked (or run) in SimulatorLeftTree load into the SQL
    // Query tab. SqlQueryCanvas owns the editor doc and listens for the same
    // events; this listener just brings the tab forward (the canvas stays
    // mounted while hidden, so its listener is always live).
    const handleLoadScript = () => setActiveTab("sql");
    window.addEventListener("simulator-load-script", handleLoadScript);
    window.addEventListener("simulator-run-script", handleLoadScript);
    return () => {
      window.removeEventListener("simulator-load-script", handleLoadScript);
      window.removeEventListener("simulator-run-script", handleLoadScript);
    };
  }, []);

  // Fetch testbed-flagged MSPs
  const loadMsps = async () => {
    setLoadingTestbeds(true);
    try {
      const res = await fetchWithAuth("/api/admin/msps?limit=100&isTestbed=true");
      if (res.ok) {
        const data = await res.json();
        setMsps(data.msps || []);
      }
    } catch (err) {
      console.error("Failed to load testbeds", err);
      toast.error("Failed to reload MSP registry");
    } finally {
      setLoadingTestbeds(false);
    }
  };

  // Fetch testbed customers under a given MSP
  const loadTestbedCustomers = async (mspId: number) => {
    setLoadingCustomers(true);
    try {
      const res = await fetchWithAuth(`/api/admin/testbeds?mspId=${mspId}`);
      if (res.ok) {
        const data = await res.json();
        setTestbedCustomers(data.testbeds || []);
      }
    } catch (err) {
      console.error("Failed to load testbed customers", err);
      toast.error("Failed to load testbed customers");
    } finally {
      setLoadingCustomers(false);
    }
  };

  useEffect(() => {
    if (activeTab === "testbeds") {
      loadMsps();
    }
  }, [activeTab, fetchWithAuth]);

  useEffect(() => {
    if (selectedMspId != null) {
      loadTestbedCustomers(selectedMspId);
    } else {
      setTestbedCustomers([]);
    }
  }, [selectedMspId]);

  // Toggle Session Lock
  const handleToggleLock = async (mspId: number, isCurrentlyLocked: boolean) => {
    try {
      const res = await fetchWithAuth("/api/simulator/session-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testbedMspId: mspId,
          lock: !isCurrentlyLocked
        }),
      });

      if (res.ok) {
        setSessionLocks(prev => ({ ...prev, [mspId]: !isCurrentlyLocked }));
        toast.success(!isCurrentlyLocked ? "Session locked" : "Session unlocked");
        loadMsps();
        
        window.dispatchEvent(new CustomEvent("simulator-log", { 
          detail: { 
            type: "info", 
            message: `MSP ${mspId} simulation lock state updated to: ${!isCurrentlyLocked}` 
          } 
        }));
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to toggle session lock");
      }
    } catch (err: any) {
      toast.error(err.message || "Network error updating lock status");
    }
  };

  // Toggle MSP status (suspend/reactivate)
  const handleToggleStatus = async (msp: Msp) => {
    const isSuspended = msp.status === "suspended";
    const endpoint = `/api/admin/msps/${msp.id}/${isSuspended ? 'reactivate' : 'suspend'}`;
    try {
      const res = await fetchWithAuth(endpoint, { method: "POST" });
      if (res.ok) {
        toast.success(isSuspended ? "MSP reactivated" : "MSP suspended");
        loadMsps();
        
        window.dispatchEvent(new CustomEvent("simulator-log", { 
          detail: { 
            type: "info", 
            message: `MSP ${msp.name} (${msp.id}) status set to: ${isSuspended ? 'active' : 'suspended'}` 
          } 
        }));
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to update MSP status");
      }
    } catch (err: any) {
      toast.error(err.message || "Error toggling status");
    }
  };

  const TABS: Array<{ key: typeof activeTab; label: string }> = [
    { key: "sql", label: "SQL Query" },
    { key: "testbeds", label: "Testbeds" },
    { key: "overrides", label: "Overrides" },
    { key: "engines", label: "Run Engines" },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full bg-background font-sans">
      {/* Editor-style tab strip */}
      <div className="flex-shrink-0 flex items-end bg-card border-b border-border select-none">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`relative h-9 px-3.5 text-xs border-r border-border transition-colors ${
              activeTab === key
                ? "bg-background text-foreground before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Workspace Area */}
      <div className="flex-1 flex flex-col min-h-0">
        
        {/* Tab 1: SQL Query canvas — stays mounted while hidden so the editor
            doc survives tab switches and the load-script listener stays live. */}
        <div className={`min-h-0 flex-1 ${activeTab === "sql" ? "flex flex-col" : "hidden"}`}>
          <SqlQueryCanvas output={sqlOutput} onOutputChange={onSqlOutputChange} />
        </div>

        {/* Tab 2: Testbeds Dashboard */}
        {activeTab === "testbeds" && (
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Registered Platform MSP Tenants</h3>
                <p className="text-xs text-muted-foreground">Configure simulated status and locks for local development testing.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadMsps}
                disabled={loadingTestbeds}
                className="h-7 text-xs px-2.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingTestbeds ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>

            {loadingTestbeds && msps.length === 0 ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : msps.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-lg">
                <Building2 className="w-12 h-12 opacity-30 mx-auto mb-3" />
                <h4 className="font-semibold text-foreground/80">No MSPs Registered</h4>
                <p className="text-xs max-w-sm mx-auto mt-1">Please populate the database or create active MSP organizations via command dashboards.</p>
              </div>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden bg-background">
                <Table>
                  <TableHeader className="bg-card select-none">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold py-3">MSP Name</TableHead>
                      <TableHead className="text-xs font-semibold py-3">Slug</TableHead>
                      <TableHead className="text-xs font-semibold py-3 text-center">Status</TableHead>
                      <TableHead className="text-xs font-semibold py-3 text-center">Is Testbed</TableHead>
                      <TableHead className="text-xs font-semibold py-3 text-center">Demo Session Lock</TableHead>
                      <TableHead className="text-xs font-semibold py-3 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {msps.map((msp) => {
                      const isLocked = sessionLocks[msp.id] || false;
                      const isSelected = selectedMspId === msp.id;
                      return (
                        <TableRow
                          key={msp.id}
                          onClick={() => setSelectedMspId(isSelected ? null : msp.id)}
                          className={`cursor-pointer hover:bg-accent/30 ${isSelected ? "bg-accent/40" : ""}`}
                        >
                          <TableCell className="font-medium py-2.5 text-foreground">
                            <div className="flex flex-col">
                              <span>{msp.name}</span>
                              <span className="text-[10px] text-muted-foreground/70 font-mono">ID: {msp.id}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 text-muted-foreground font-mono text-[11px]">{msp.slug}</TableCell>
                          <TableCell className="py-2.5 text-center">
                            <Badge
                              className={`rounded-full px-2.5 py-0.5 border text-[10px] font-semibold capitalize font-mono ${
                                msp.status === "active"
                                  ? "text-emerald-400 border-emerald-400/25 bg-emerald-400/10"
                                  : msp.status === "suspended"
                                  ? "text-destructive border-destructive/25 bg-destructive/10"
                                  : "text-amber-400 border-amber-400/25 bg-amber-400/10"
                              }`}
                            >
                              {msp.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2.5 text-center">
                            <Badge
                              className={`rounded px-1.5 py-0.5 text-[9px] font-bold font-mono ${
                                msp.isTestbed
                                  ? "text-primary border border-primary/25 bg-primary/10"
                                  : "text-muted-foreground/70 border border-border bg-card"
                              }`}
                            >
                              {msp.isTestbed ? "TRUE" : "FALSE"}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2.5 text-center">
                            <div className="flex items-center justify-center">
                              {msp.isTestbed ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleToggleLock(msp.id, isLocked); }}
                                  className={`p-1.5 rounded-md border text-xs flex items-center gap-1.5 transition-all select-none font-mono text-[10px] ${
                                    isLocked
                                      ? "text-amber-400 border-amber-400/30 bg-amber-400/5 hover:bg-amber-400/10"
                                      : "text-muted-foreground border-border bg-card hover:bg-accent"
                                  }`}
                                >
                                  {isLocked ? (
                                    <>
                                      <Lock className="w-3.5 h-3.5 shrink-0" /> LOCKED
                                    </>
                                  ) : (
                                    <>
                                      <Unlock className="w-3.5 h-3.5 shrink-0" /> UNLOCKED
                                    </>
                                  )}
                                </button>
                              ) : (
                                <span className="text-[10px] text-muted-foreground/60 italic font-mono">-</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 text-right">
                            <div className="flex justify-end gap-2">
                              {msp.isTestbed && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={(e) => { e.stopPropagation(); handleToggleStatus(msp); }}
                                  className={`h-7 text-[11px] font-mono ${
                                    msp.status === "suspended"
                                      ? "text-emerald-400 hover:text-emerald-300"
                                      : "text-destructive hover:text-destructive/80"
                                  }`}
                                >
                                  {msp.status === "suspended" ? "Reactivate" : "Suspend"}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openModal("execute-scenario", {
                                    event: {
                                      id: "FACTORY_RESET",
                                      name: "Factory Reset Testbed",
                                      description: "Wipes telemetry logs, clears suspensions, and restores baseline score definitions.",
                                      category: "crm"
                                    }
                                  });
                                }}
                                className="h-7 text-[11px] font-mono"
                              >
                                Reset
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {selectedMspId != null && (
              <div className="border border-border rounded-lg overflow-hidden bg-background">
                <div className="px-3 py-2 bg-card border-b border-border">
                  <h4 className="text-xs font-semibold text-foreground">
                    Testbed Customers — {msps.find(m => m.id === selectedMspId)?.name ?? `MSP ${selectedMspId}`}
                  </h4>
                </div>
                {loadingCustomers ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  </div>
                ) : testbedCustomers.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-xs">
                    No testbed customers for this MSP.
                  </div>
                ) : (
                  <Table>
                    <TableHeader className="bg-card select-none">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="text-xs font-semibold py-2.5">Customer Name</TableHead>
                        <TableHead className="text-xs font-semibold py-2.5">Domain</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {testbedCustomers.map((customer) => (
                        <TableRow key={customer.id} className="hover:bg-accent/30">
                          <TableCell className="py-2 text-foreground">
                            <div className="flex flex-col">
                              <span>{customer.name}</span>
                              <span className="text-[10px] text-muted-foreground/70 font-mono">ID: {customer.id}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2 text-muted-foreground font-mono text-[11px]">{customer.domain ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </div>)}
        {/* Tab 3: Overrides Panel */}
        {activeTab === "overrides" && (
          <SimulatorOverridesPanel />
        )}
        {/* Tab 4: Run Engines Panel */}
        {activeTab === "engines" && (
          <SimulatorEnginesPanel />
        )}
      </div>
    </div>
  );
}
