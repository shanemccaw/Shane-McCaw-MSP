import { useSimulatorActivity } from "@/contexts/SimulatorActivityContext";
import React, { createContext, useContext, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useTestbedContext } from "@/contexts/TestbedContext";
import { toast } from "sonner";
import { 
  Play, 
  Terminal as TerminalIcon, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Info,
  Loader2,
  Save,
  Shield,
  CreditCard,
  Clock,
  RefreshCw
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";

// Same repaint as SimulatorCenterCanvas's editor: keep One Dark's syntax
// palette but swap its #282c34 surfaces for the app's GitHub-dark tokens.
// Defined locally rather than imported from the canvas — components import
// useModal from this file, so importing back from them would be a cycle.
const editorSurfaceTheme = EditorView.theme({
  "&": { backgroundColor: "#0D1117" },
  ".cm-gutters": { backgroundColor: "#0D1117", borderRight: "1px solid #21262D" },
  ".cm-activeLine": { backgroundColor: "#161B2280" },
  ".cm-activeLineGutter": { backgroundColor: "#161B2280" },
});

export type ModalType = "execute-scenario" | "edit-script" | "new-script" | "engine-trace" | null;

interface ModalContextType {
  activeModal: ModalType;
  modalData: any;
  openModal: (type: ModalType, data?: any) => void;
  closeModal: () => void;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export function useModal() {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error("useModal must be used within a ModalProvider");
  }
  return context;
}

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [modalData, setModalData] = useState<any>(null);

  const openModal = (type: ModalType, data?: any) => {
    setActiveModal(type);
    setModalData(data);
  };

  const closeModal = () => {
    setActiveModal(null);
    setModalData(null);
  };

  return (
    <ModalContext.Provider value={{ activeModal, modalData, openModal, closeModal }}>
      {children}
      <ModalContainer />
    </ModalContext.Provider>
  );
}

function ModalContainer() {
  const { activeModal, closeModal } = useModal();

  return (
    <Dialog open={activeModal !== null} onOpenChange={(open) => { if (!open) closeModal(); }}>
      <DialogContent className={`${activeModal === "engine-trace" ? "max-w-3xl" : "max-w-2xl"} bg-background border border-border text-foreground shadow-2xl p-6 rounded-xl`}>
        {activeModal === "execute-scenario" && <ExecuteScenarioModal />}
        {activeModal === "edit-script" && <ScriptEditorModal isNew={false} />}
        {activeModal === "new-script" && <ScriptEditorModal isNew={true} />}
        {activeModal === "engine-trace" && <EngineTraceModal />}
      </DialogContent>
    </Dialog>
  );
}

function EngineTraceModal() {
  const { modalData, closeModal } = useModal();
  if (!modalData) return null;
  const { engineName, data } = modalData;

  return (
    <div className="space-y-4 font-sans text-sm">
      <DialogHeader>
        <DialogTitle className="text-foreground text-base font-semibold">{engineName} Evaluation Trace</DialogTitle>
        <DialogDescription className="text-muted-foreground text-xs">
          Interactive trace of evaluated rules and tenant profile state.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 font-mono text-sm max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin">
        <section className="space-y-1.5">
          <h4 className="text-muted-foreground uppercase text-[10px] tracking-wider font-bold">Input Tenant Profile</h4>
          <pre className="bg-card border border-border p-3 rounded-lg text-emerald-400 overflow-x-auto text-[11px] max-h-48 overflow-y-auto leading-relaxed">
            {JSON.stringify(data?.rawInput || {}, null, 2)}
          </pre>
        </section>

        <section className="space-y-1.5">
          <h4 className="text-muted-foreground uppercase text-[10px] tracking-wider font-bold">Rule Logic Path</h4>
          {data?.trace && data.trace.length > 0 ? (
            <div className="border-l-2 border-border pl-4 space-y-3">
              {data.trace.map((step: any, i: number) => (
                <div key={i} className="text-foreground">
                  <div className="flex items-center gap-2">
                    <span className="text-[#58A6FF] font-bold text-xs">{step.ruleId}:</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold tracking-wider ${
                      step.outcome === "FIRED"
                        ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/25"
                        : "bg-card text-muted-foreground border border-border"
                    }`}>
                      {step.outcome}
                    </span>
                  </div>
                  <small className="text-muted-foreground block mt-1 leading-normal font-sans text-[11px]">{step.reasoning}</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground text-xs italic font-sans">No evaluation trace logs generated for this engine run.</div>
          )}
        </section>
      </div>

      <div className="flex justify-end pt-3 border-t border-border">
        <Button
          variant="outline"
          onClick={closeModal}
          className="bg-transparent border-border hover:bg-accent hover:text-foreground text-xs"
        >
          Close
        </Button>
      </div>
    </div>
  );
}

// ─── Modal 1: ExecuteScenarioModal ───────────────────────────────────────────
function ExecuteScenarioModal() {
  const { modalData, closeModal } = useModal();
  const { fetchWithAuth } = useAuth();
  const { startOperation, endOperation } = useSimulatorActivity();
  const { selectedCustomerId, selectedCustomer } = useTestbedContext();
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<any>(null);

  const event = modalData?.event;

  const handleExecute = async () => {
    if (selectedCustomerId == null) {
      toast.error("Select a testbed customer in the Simulator Studio header first");
      return;
    }
    setExecuting(true);
    setExecutionResult(null);
    startOperation(event.id);
    try {
      const res = await fetchWithAuth("/api/simulator/fire-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: event.id,
          testbedCustomerId: selectedCustomerId,
          params: {}
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setExecutionResult({
          success: true,
          message: data.message,
          mutatedRows: data.mutatedRows,
          executionMs: data.executionMs,
          timestamp: data.timestamp,
        });
        toast.success("Scenario fired successfully");
        // Dispatch custom event to let other components know they should refresh
        window.dispatchEvent(new CustomEvent("simulator-event-fired", { detail: { eventId: event.id } }));
      } else {
        setExecutionResult({
          success: false,
          error: data.error || "Execution failed",
        });
        toast.error(data.error || "Failed to fire scenario");
      }
    } catch (err: any) {
      setExecutionResult({
        success: false,
        error: err.message || "Network error",
      });
      toast.error("Network error when firing scenario");
    } finally {
      setExecuting(false);
      endOperation(event.id);
    }
  };

  const getEventIcon = (cat: string) => {
    switch (cat) {
      case "billing": return <CreditCard className="w-5 h-5 text-destructive animate-pulse" />;
      case "security": return <Shield className="w-5 h-5 text-emerald-400 animate-pulse" />;
      case "sla": return <Clock className="w-5 h-5 text-amber-400 animate-pulse" />;
      default: return <RefreshCw className="w-5 h-5 text-[#58A6FF] animate-pulse" />;
    }
  };

  return (
    <div className="space-y-5">
      <DialogHeader>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-card border border-border">
            {getEventIcon(event?.category)}
          </div>
          <div>
            <DialogTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
              Fire Simulation Scenario
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Run test scenarios against local testbed systems
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="border border-border rounded-xl bg-card/50 p-4 space-y-3.5">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Scenario Name</h4>
          <p className="text-sm font-medium text-foreground">{event?.name}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Description</h4>
          <p className="text-xs text-foreground/90 leading-relaxed">{event?.description}</p>
        </div>
        {event?.demoSpeakerNote && (
          <div className="bg-[#58A6FF]/10 border border-[#58A6FF]/30 rounded-lg p-3 text-[11px] text-[#58A6FF] flex gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold uppercase tracking-wider block text-[9px] mb-0.5">Speaker Note (Demo Walkthrough)</span>
              {event.demoSpeakerNote}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <Label className="text-xs font-medium text-muted-foreground">Target Testbed Customer</Label>
        {selectedCustomerId == null ? (
          <div className="bg-destructive/10 border border-destructive/40 rounded-lg p-3.5 text-xs text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            No testbed customer selected — pick an MSP and customer in the Simulator Studio header first.
          </div>
        ) : (
          <div className="bg-background border border-border rounded-lg px-3 py-2.5 text-xs text-foreground">
            {selectedCustomer?.name ?? `Customer #${selectedCustomerId}`}
            {selectedCustomer?.domain ? ` (${selectedCustomer.domain})` : ""}
            <span className="text-muted-foreground"> (Customer ID: {selectedCustomerId})</span>
          </div>
        )}
      </div>

      {executionResult && (
        <div className={`border rounded-xl p-4 font-mono text-[11px] overflow-hidden ${
          executionResult.success
            ? "bg-emerald-400/10 border-emerald-400/30 text-emerald-400"
            : "bg-destructive/10 border-destructive/40 text-destructive"
        }`}>
          <div className="flex items-center gap-2 font-semibold text-xs mb-2">
            {executionResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-destructive" />
            )}
            {executionResult.success ? "Execution Succeeded" : "Execution Failed"}
          </div>
          {executionResult.success ? (
            <div className="space-y-1">
              <div><span className="text-muted-foreground">&gt; message:</span> {executionResult.message}</div>
              <div><span className="text-muted-foreground">&gt; mutated_rows:</span> {executionResult.mutatedRows ?? 0}</div>
              <div><span className="text-muted-foreground">&gt; duration:</span> {executionResult.executionMs}ms</div>
              <div><span className="text-muted-foreground">&gt; timestamp:</span> {executionResult.timestamp}</div>
            </div>
          ) : (
            <div><span className="text-muted-foreground">&gt; error:</span> {executionResult.error}</div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-3 border-t border-border">
        <Button
          variant="outline"
          onClick={closeModal}
          className="bg-transparent border-border hover:bg-accent hover:text-foreground text-xs"
        >
          Cancel
        </Button>
        <Button
          onClick={handleExecute}
          disabled={executing || selectedCustomerId == null}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs flex items-center gap-2 px-4"
        >
          {executing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Firing...
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" /> Fire Scenario
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ─── Modal 2: ScriptEditorModal ──────────────────────────────────────────────
function ScriptEditorModal({ isNew = false }: { isNew: boolean }) {
  const { modalData, closeModal } = useModal();
  const { fetchWithAuth } = useAuth();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("QA Asserts");
  const [query, setQuery] = useState("");
  const [isDestructive, setIsDestructive] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isNew && modalData?.script) {
      const s = modalData.script;
      setName(s.name || "");
      setCategory(s.category || "QA Asserts");
      setQuery(s.query || "");
      setIsDestructive(s.isDestructive || false);
    } else {
      setName("");
      setCategory("QA Asserts");
      setQuery("");
      setIsDestructive(false);
    }
  }, [isNew, modalData]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Script name is required");
      return;
    }
    if (!query.trim()) {
      toast.error("SQL query query cannot be empty");
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/simulator/sql/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          query,
          isDestructive
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(isNew ? "Script created successfully" : "Script updated successfully");
        // Trigger refetch of scripts
        window.dispatchEvent(new CustomEvent("simulator-scripts-updated"));
        closeModal();
      } else {
        toast.error(data.error || "Failed to save script");
      }
    } catch (err: any) {
      toast.error(err.message || "Network error when saving script");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <DialogHeader>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-card border border-border">
            <TerminalIcon className="w-5 h-5 text-[#58A6FF]" />
          </div>
          <div>
            <DialogTitle className="text-lg font-semibold text-foreground">
              {isNew ? "Create SQL Utility Script" : "Edit SQL Utility Script"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Manage saved scripts for testing database migrations and telemetry logic
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-4 pt-1">
        <div className="space-y-1.5 col-span-2 md:col-span-1">
          <Label htmlFor="script-name" className="text-xs font-semibold text-muted-foreground">Script Name</Label>
          <Input
            id="script-name"
            placeholder="e.g. Wipe Signal Logs"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-background border-border text-foreground text-xs h-9"
          />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
          <Label htmlFor="script-category" className="text-xs font-semibold text-muted-foreground">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full bg-background border-border text-foreground text-xs h-9">
              <SelectValue placeholder="Select Category" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border text-foreground text-xs">
              <SelectItem value="QA Asserts">QA Asserts</SelectItem>
              <SelectItem value="Maintenance">Maintenance</SelectItem>
              <SelectItem value="Database Setup">Database Setup</SelectItem>
              <SelectItem value="Testing Helpers">Testing Helpers</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground">SQL Query</Label>
        <div className="border border-border rounded-lg overflow-hidden bg-[#0D1117] text-[11px] leading-relaxed">
          <CodeMirror
            value={query}
            height="180px"
            theme={oneDark}
            extensions={[editorSurfaceTheme]}
            onChange={(val) => setQuery(val)}
            basicSetup={{
              lineNumbers: true,
              foldGutter: false,
              highlightActiveLine: false,
              autocompletion: false,
            }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card/50">
        <div className="flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-semibold text-foreground">Destructive Script</h4>
            <p className="text-[10px] text-muted-foreground">Check this if the query performs deletions, drops, or updates that wipe data.</p>
          </div>
        </div>
        <input
          type="checkbox"
          checked={isDestructive}
          onChange={(e) => setIsDestructive(e.target.checked)}
          className="w-4 h-4 rounded border-border bg-background accent-primary focus:ring-ring/30"
        />
      </div>

      <div className="flex justify-end gap-3 pt-3 border-t border-border">
        <Button
          variant="outline"
          onClick={closeModal}
          className="bg-transparent border-border hover:bg-accent hover:text-foreground text-xs"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs flex items-center gap-2 px-4"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Saving...
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" /> Save Script
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
