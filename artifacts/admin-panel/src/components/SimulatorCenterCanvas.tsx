import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useModal } from "@/contexts/ModalContext";
import {
  Lock,
  Unlock,
  Loader2,
  Building2,
  RefreshCw,
  X,
  Terminal,
  Play,
  Layers,
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
import { SimulatorDeployConsolePanel } from "./SimulatorDeployConsolePanel";
import { SqlQueryCanvas, type SqlOutput } from "./SqlQueryCanvas";
import { SimulatorEndpointCanvas, type MonitorCheckSummary } from "./SimulatorEndpointCanvas";
import { SimulatorBatchCanvas, type BulkRunTarget } from "./SimulatorBatchCanvas";
import { SimulatorWriteActionCanvas } from "./SimulatorWriteActionCanvas";
import { SimulatorConfigPackCanvas } from "./SimulatorConfigPackCanvas";
import { SimulatorPillarMatrixCanvas, type PillarKey } from "./SimulatorPillarMatrixCanvas";
import type { ConfigPackNode, WriteActionNode } from "./SimulatorLeftTree";

export interface SimDocumentTab {
  id: string;
  type: "script" | "endpoint" | "write-action" | "config-pack" | "batch" | "pillar" | "migration";
  label: string;
  data: any;
}

const LS_OPEN_DOCS_KEY = "simulator-open-documents-v1";
const LS_ACTIVE_DOC_KEY = "simulator-active-doc-id-v1";

function readOpenDocs(): SimDocumentTab[] {
  try {
    const raw = localStorage.getItem(LS_OPEN_DOCS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readActiveDocId(): string | null {
  try {
    return localStorage.getItem(LS_ACTIVE_DOC_KEY) || null;
  } catch {
    return null;
  }
}

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

  const [activeTab, setActiveTab] = useState<
    "sql" | "testbeds" | "overrides" | "engines" | "deploy" | "endpoint" | "batch" | "write-action" | "pillar-matrix" | "config-pack"
  >("sql");

  // The pillar currently open in the Pillar Matrix tab, set by clicking a pillar
  // in the Explorer tree. Defaults to governance when the tab is opened directly.
  const [selectedPillar, setSelectedPillar] = useState<PillarKey>("governance");

  // The M365 endpoint currently open in the Endpoint tab, set by clicking an
  // endpoint in the Explorer tree.
  const [selectedEndpoint, setSelectedEndpoint] = useState<MonitorCheckSummary | null>(null);

  // The write-action template currently open in the Write Action tab, set by
  // clicking a write-action in the Explorer tree.
  const [selectedWriteAction, setSelectedWriteAction] = useState<WriteActionNode | null>(null);

  // The config pack currently open in the Config Pack tab, set by clicking a
  // pack in the Explorer tree.
  const [selectedConfigPack, setSelectedConfigPack] = useState<ConfigPackNode | null>(null);

  // The bulk run currently open in the Batch tab, set by "Run all" on a domain
  // folder in the Explorer tree.
  const [bulkRun, setBulkRun] = useState<BulkRunTarget | null>(null);

  // Open Document Tabs state (persisted in localStorage)
  const [openDocuments, setOpenDocuments] = useState<SimDocumentTab[]>(() => readOpenDocs());
  const [activeDocId, setActiveDocId] = useState<string | null>(() => readActiveDocId());

  // Testbeds state
  const [msps, setMsps] = useState<Msp[]>([]);
  const [loadingTestbeds, setLoadingTestbeds] = useState(false);
  const [sessionLocks, setSessionLocks] = useState<Record<number, boolean>>({});
  const [selectedMspId, setSelectedMspId] = useState<number | null>(null);
  const [testbedCustomers, setTestbedCustomers] = useState<TestbedCustomer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  const openDoc = (doc: SimDocumentTab) => {
    setOpenDocuments((prev) => {
      const exists = prev.some((d) => d.id === doc.id);
      const next = exists ? prev.map((d) => (d.id === doc.id ? doc : d)) : [...prev, doc];
      try {
        localStorage.setItem(LS_OPEN_DOCS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    setActiveDocId(doc.id);
    try {
      localStorage.setItem(LS_ACTIVE_DOC_KEY, doc.id);
    } catch {}
  };

  // Restore active document state on mount from persisted localStorage
  useEffect(() => {
    const docs = readOpenDocs();
    const activeId = readActiveDocId();
    if (activeId && docs.length > 0) {
      const doc = docs.find((d) => d.id === activeId);
      if (doc) {
        if (doc.type === "script" || doc.type === "migration") {
          setActiveTab("sql");
          setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent(doc.type === "script" ? "simulator-load-script" : "simulator-run-migration", {
                detail: doc.data,
              })
            );
          }, 50);
        } else if (doc.type === "endpoint") {
          setSelectedEndpoint(doc.data);
          setActiveTab("endpoint");
        } else if (doc.type === "write-action") {
          setSelectedWriteAction(doc.data);
          setActiveTab("write-action");
        } else if (doc.type === "config-pack") {
          setSelectedConfigPack(doc.data);
          setActiveTab("config-pack");
        } else if (doc.type === "batch") {
          setBulkRun(doc.data);
          setActiveTab("batch");
        } else if (doc.type === "pillar") {
          if (doc.data?.pillar) setSelectedPillar(doc.data.pillar);
          setActiveTab("pillar-matrix");
        }
      }
    }
  }, []);

  const handleSelectDocument = (doc: SimDocumentTab) => {
    setActiveDocId(doc.id);
    try {
      localStorage.setItem(LS_ACTIVE_DOC_KEY, doc.id);
    } catch {}

    if (doc.type === "script") {
      setActiveTab("sql");
      window.dispatchEvent(new CustomEvent("simulator-load-script", { detail: doc.data }));
    } else if (doc.type === "migration") {
      setActiveTab("sql");
      window.dispatchEvent(new CustomEvent("simulator-run-migration", { detail: doc.data }));
    } else if (doc.type === "endpoint") {
      setSelectedEndpoint(doc.data);
      setActiveTab("endpoint");
    } else if (doc.type === "write-action") {
      setSelectedWriteAction(doc.data);
      setActiveTab("write-action");
    } else if (doc.type === "config-pack") {
      setSelectedConfigPack(doc.data);
      setActiveTab("config-pack");
    } else if (doc.type === "batch") {
      setBulkRun(doc.data);
      setActiveTab("batch");
    } else if (doc.type === "pillar") {
      if (doc.data?.pillar) setSelectedPillar(doc.data.pillar);
      setActiveTab("pillar-matrix");
    }
  };

  const handleCloseDocument = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setOpenDocuments((prev) => {
      const next = prev.filter((d) => d.id !== id);
      try {
        localStorage.setItem(LS_OPEN_DOCS_KEY, JSON.stringify(next));
      } catch {}

      if (activeDocId === id) {
        if (next.length > 0) {
          const closedIndex = prev.findIndex((d) => d.id === id);
          const nextDoc = next[Math.min(closedIndex, next.length - 1)];
          if (nextDoc) {
            setTimeout(() => handleSelectDocument(nextDoc), 0);
          }
        } else {
          setActiveDocId(null);
          try {
            localStorage.removeItem(LS_ACTIVE_DOC_KEY);
          } catch {}
          setActiveTab("sql");
        }
      }
      return next;
    });
  };

  useEffect(() => {
    const handleLoadScript = (e: Event) => {
      const detail = (e as CustomEvent<any>).detail;
      setActiveTab("sql");
      if (detail && (detail.id || detail.name)) {
        openDoc({
          id: `script:${detail.id || detail.name}`,
          type: "script",
          label: detail.name || `Script ${detail.id}`,
          data: detail,
        });
      }
    };
    const handleRunMigration = (e: Event) => {
      const detail = (e as CustomEvent<any>).detail;
      setActiveTab("sql");
      if (detail && detail.filename) {
        openDoc({
          id: `migration:${detail.filename}`,
          type: "migration",
          label: detail.filename,
          data: detail,
        });
      }
    };
    const handleSelectEndpoint = (e: Event) => {
      const detail = (e as CustomEvent<MonitorCheckSummary>).detail;
      if (!detail) return;
      setSelectedEndpoint(detail);
      setActiveTab("endpoint");
      openDoc({
        id: `endpoint:${detail.key}`,
        type: "endpoint",
        label: detail.key,
        data: detail,
      });
    };
    const handleBulkRun = (e: Event) => {
      const detail = (e as CustomEvent<BulkRunTarget>).detail;
      if (!detail) return;
      setBulkRun(detail);
      setActiveTab("batch");
      openDoc({
        id: `batch:${detail.batchId || detail.domain}`,
        type: "batch",
        label: `${detail.domain}:* run`,
        data: detail,
      });
    };
    const handleSelectWriteAction = (e: Event) => {
      const detail = (e as CustomEvent<WriteActionNode>).detail;
      if (!detail) return;
      setSelectedWriteAction(detail);
      setActiveTab("write-action");
      openDoc({
        id: `write-action:${detail.templateId}`,
        type: "write-action",
        label: `⚡ ${detail.label}`,
        data: detail,
      });
    };
    const handleSelectPillarMatrix = (e: Event) => {
      const detail = (e as CustomEvent<{ pillar: PillarKey }>).detail;
      if (detail?.pillar) setSelectedPillar(detail.pillar);
      setActiveTab("pillar-matrix");
      if (detail?.pillar) {
        openDoc({
          id: `pillar:${detail.pillar}`,
          type: "pillar",
          label: `Pillar: ${detail.pillar}`,
          data: detail,
        });
      }
    };
    const handleSelectConfigPack = (e: Event) => {
      const detail = (e as CustomEvent<ConfigPackNode>).detail;
      if (!detail) return;
      setSelectedConfigPack(detail);
      setActiveTab("config-pack");
      openDoc({
        id: `config-pack:${detail.packKey}`,
        type: "config-pack",
        label: `📦 ${detail.label}`,
        data: detail,
      });
    };
    window.addEventListener("simulator-load-script", handleLoadScript);
    window.addEventListener("simulator-run-script", handleLoadScript);
    window.addEventListener("simulator-run-migration", handleRunMigration);
    window.addEventListener("simulator-select-endpoint", handleSelectEndpoint);
    window.addEventListener("simulator-bulk-run", handleBulkRun);
    window.addEventListener("simulator-select-write-action", handleSelectWriteAction);
    window.addEventListener("simulator-select-pillar-matrix", handleSelectPillarMatrix);
    window.addEventListener("simulator-select-config-pack", handleSelectConfigPack);
    return () => {
      window.removeEventListener("simulator-load-script", handleLoadScript);
      window.removeEventListener("simulator-run-script", handleLoadScript);
      window.removeEventListener("simulator-run-migration", handleRunMigration);
      window.removeEventListener("simulator-select-endpoint", handleSelectEndpoint);
      window.removeEventListener("simulator-bulk-run", handleBulkRun);
      window.removeEventListener("simulator-select-write-action", handleSelectWriteAction);
      window.removeEventListener("simulator-select-pillar-matrix", handleSelectPillarMatrix);
      window.removeEventListener("simulator-select-config-pack", handleSelectConfigPack);
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
    { key: "deploy", label: "Deploy Console" },
    { key: "pillar-matrix", label: "Pillar Matrix" },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full bg-background font-sans">
      {/* Existing Top Tab Strip */}
      <div className="flex-shrink-0 flex items-end bg-card border-b border-border select-none overflow-x-auto scrollbar-none">
        {TABS.map(({ key, label }) => {
          const isTopSelected = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => {
                setActiveTab(key);
              }}
              className={`relative h-9 px-3.5 text-xs border-r border-border transition-colors shrink-0 ${
                isTopSelected
                  ? "bg-background text-foreground font-medium before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/80"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* New VS Code / Antigravity Document Tabs Strip (persisted across refreshes) */}
      {openDocuments.length > 0 && (
        <div className="flex-shrink-0 flex items-center bg-muted/30 border-b border-border overflow-x-auto select-none min-h-[34px] px-1 gap-1 scrollbar-thin">
          {openDocuments.map((doc) => {
            const isDocActive =
              activeDocId === doc.id &&
              ((doc.type === "script" && activeTab === "sql") ||
                (doc.type === "migration" && activeTab === "sql") ||
                (doc.type === "endpoint" && activeTab === "endpoint") ||
                (doc.type === "write-action" && activeTab === "write-action") ||
                (doc.type === "config-pack" && activeTab === "config-pack") ||
                (doc.type === "batch" && activeTab === "batch") ||
                (doc.type === "pillar" && activeTab === "pillar-matrix"));

            return (
              <div
                key={doc.id}
                onClick={() => handleSelectDocument(doc)}
                className={`group flex items-center gap-1.5 h-7 px-2.5 text-xs rounded-t border border-b-0 transition-all cursor-pointer shrink-0 max-w-[240px] ${
                  isDocActive
                    ? "bg-background text-foreground font-medium border-border shadow-sm relative after:absolute after:inset-x-0 after:-bottom-[1px] after:h-[2px] after:bg-background"
                    : "bg-card/40 text-muted-foreground hover:bg-card hover:text-foreground border-transparent hover:border-border/60"
                }`}
              >
                {doc.type === "script" && <Terminal className="w-3 h-3 text-sky-400 shrink-0" />}
                {doc.type === "migration" && <RefreshCw className="w-3 h-3 text-emerald-400 shrink-0" />}
                {doc.type === "endpoint" && <Building2 className="w-3 h-3 text-indigo-400 shrink-0" />}
                {doc.type === "batch" && <Play className="w-3 h-3 text-amber-400 shrink-0" />}
                {doc.type === "pillar" && <Layers className="w-3 h-3 text-purple-400 shrink-0" />}
                <span className="truncate">{doc.label}</span>
                <button
                  type="button"
                  onClick={(e) => handleCloseDocument(doc.id, e)}
                  title="Close document"
                  className={`w-4 h-4 rounded-sm flex items-center justify-center transition-colors shrink-0 ml-0.5 ${
                    isDocActive
                      ? "text-muted-foreground hover:bg-accent hover:text-foreground opacity-100"
                      : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Workspace Area */}
      <div className="flex-1 flex flex-col min-h-0">
        
        {/* Tab 1: SQL Query canvas — stays mounted while hidden so the editor
            doc survives tab switches and the load-script listener stays live. */}
        <div className={`min-h-0 flex-1 ${activeTab === "sql" ? "flex flex-col" : "hidden"}`}>
          <SqlQueryCanvas output={sqlOutput} onOutputChange={onSqlOutputChange} />
        </div>

        {/* Tab: M365 Endpoint — real URL/method/params + live single execution */}
        {activeTab === "endpoint" && selectedEndpoint && (
          <SimulatorEndpointCanvas key={selectedEndpoint.key} check={selectedEndpoint} />
        )}

        {/* Tab: bulk run — live per-check summary polled from the persisted batch */}
        {activeTab === "batch" && bulkRun && <SimulatorBatchCanvas key={bulkRun.batchId} target={bulkRun} />}

        {/* Tab: Write Action — real tenant-MUTATING template with confirmation + safety flow */}
        {activeTab === "write-action" && selectedWriteAction && (
          <SimulatorWriteActionCanvas key={selectedWriteAction.templateId} action={selectedWriteAction} />
        )}

        {/* Tab: Config Pack — orchestrated write-action sequence (whole-pack in
            dependency order, or single step), testbed-only, with live progress */}
        {activeTab === "config-pack" && selectedConfigPack && (
          <SimulatorConfigPackCanvas key={selectedConfigPack.packKey} pack={selectedConfigPack} />
        )}

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
        {/* Tab 5: Deploy Console — whitelisted git/pnpm operations only */}
        {activeTab === "deploy" && (
          <SimulatorDeployConsolePanel />
        )}
        {/* Tab 6: Pillar Matrix — cross-signal per-pillar impact tuning. Keyed on
            the selected pillar so a tree re-select remounts with fresh state. */}
        {activeTab === "pillar-matrix" && (
          <SimulatorPillarMatrixCanvas key={selectedPillar} initialPillar={selectedPillar} />
        )}
      </div>
    </div>
  );
}
