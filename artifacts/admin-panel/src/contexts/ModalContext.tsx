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
  RefreshCw,
  ListChecks,
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";

// Same repaint as SimulatorCenterCanvas's editor: keep One Dark's syntax
// palette but swap its #282c34 surfaces for the app's GitHub-dark tokens.
// Defined locally rather than imported from the canvas — components import
// useModal from this file, so importing back from them would be a cycle.
const editorSurfaceTheme = EditorView.theme({
  "&": { backgroundColor: "#0A0D12" },
  ".cm-gutters": { backgroundColor: "#0A0D12", borderRight: "1px solid #171C26" },
  ".cm-activeLine": { backgroundColor: "#11151C80" },
  ".cm-activeLineGutter": { backgroundColor: "#11151C80" },
});

export type ModalType =
  | "execute-scenario"
  | "edit-script"
  | "new-script"
  | "engine-trace"
  | "new-test-suite"
  | "edit-test-suite"
  | null;

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
  const isWide =
    activeModal === "engine-trace" || activeModal === "new-test-suite" || activeModal === "edit-test-suite";

  return (
    <Dialog open={activeModal !== null} onOpenChange={(open) => { if (!open) closeModal(); }}>
      <DialogContent className={`${isWide ? "max-w-3xl" : "max-w-2xl"} bg-background border border-border text-foreground shadow-2xl p-6 rounded-xl`}>
        {activeModal === "execute-scenario" && <ExecuteScenarioModal />}
        {activeModal === "edit-script" && <ScriptEditorModal isNew={false} />}
        {activeModal === "new-script" && <ScriptEditorModal isNew={true} />}
        {activeModal === "engine-trace" && <EngineTraceModal />}
        {activeModal === "new-test-suite" && <TestSuiteEditorModal isNew={true} />}
        {activeModal === "edit-test-suite" && <TestSuiteEditorModal isNew={false} />}
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
                    <span className="text-primary font-bold text-xs">{step.ruleId}:</span>
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
      default: return <RefreshCw className="w-5 h-5 text-primary animate-pulse" />;
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
          <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 text-[11px] text-primary flex gap-2">
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
  const [isResetScript, setIsResetScript] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isNew && modalData?.script) {
      const s = modalData.script;
      setName(s.name || "");
      setCategory(s.category || "QA Asserts");
      setQuery(s.query || "");
      setIsDestructive(s.isDestructive || false);
      setIsResetScript(modalData?.script?.isResetScript ?? false);
    } else {
      setName("");
      setCategory("QA Asserts");
      setQuery("");
      setIsDestructive(false);
      setIsResetScript(false);
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
      const url = isNew
        ? "/api/simulator/sql/scripts"
        : `/api/simulator/sql/scripts/${modalData?.script?.id}`;
      const res = await fetchWithAuth(url, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          query,
          isDestructive,
          isResetScript
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
            <TerminalIcon className="w-5 h-5 text-primary" />
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
        <div className="border border-border rounded-lg overflow-hidden bg-background text-[11px] leading-relaxed">
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

      <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card/50">
        <div className="flex gap-2">
          <RefreshCw className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-semibold text-foreground">Reset script (always runs first in test suites)</h4>
            <p className="text-[10px] text-muted-foreground">Check this if the query restores the testbed to a known baseline before other steps run.</p>
          </div>
        </div>
        <input
          type="checkbox"
          checked={isResetScript}
          onChange={(e) => setIsResetScript(e.target.checked)}
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

// ─── Modal 3: TestSuiteEditorModal ───────────────────────────────────────────

// Exact step shapes the Test Suite Runner backend stores (see /api/admin/test-suites).
type TestSuiteStep =
  | { type: "sql"; scriptId: number }
  | { type: "scenario"; eventId: string }
  | { type: "exception_trigger"; marker?: string }
  | { type: "orchestrated_pipeline"; testbedCustomerId?: number; engineKeys?: string[] };

type TestSuiteStepType = "sql" | "scenario" | "exception_trigger" | "orchestrated_pipeline";

// Editable row state — a superset of every step type's fields so switching the
// type Select doesn't lose in-progress values mid-edit. testbedCustomerId /
// engineKeys have no UI here; they are round-tripped so a no-op open-and-save
// of an API-authored pipeline step doesn't strip them.
interface SuiteStepRow {
  type: TestSuiteStepType;
  scriptId?: number;
  eventId?: string;
  marker?: string;
  testbedCustomerId?: number;
  engineKeys?: string[];
}

interface SuiteSavedScript {
  id: number;
  name: string;
  category: string;
  isDestructive: boolean;
  isResetScript?: boolean;
}

interface SuiteEventDef {
  id: string;
  name: string;
  category: string;
  description: string;
}

const STEP_TYPE_LABELS: Record<TestSuiteStepType, string> = {
  sql: "SQL Script",
  scenario: "Scenario",
  exception_trigger: "Exception Trigger",
  orchestrated_pipeline: "Orchestrated Pipeline",
};

function TestSuiteEditorModal({ isNew = false }: { isNew: boolean }) {
  const { modalData, closeModal } = useModal();
  const { fetchWithAuth } = useAuth();
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<SuiteStepRow[]>([]);
  const [scripts, setScripts] = useState<SuiteSavedScript[]>([]);
  const [events, setEvents] = useState<SuiteEventDef[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isNew && modalData?.suite) {
      const suite = modalData.suite;
      setName(suite.name || "");
      setSteps(
        (suite.steps || []).map((s: TestSuiteStep): SuiteStepRow => ({
          type: s.type,
          scriptId: s.type === "sql" ? s.scriptId : undefined,
          eventId: s.type === "scenario" ? s.eventId : undefined,
          marker: s.type === "exception_trigger" ? s.marker : undefined,
          testbedCustomerId: s.type === "orchestrated_pipeline" ? s.testbedCustomerId : undefined,
          engineKeys: s.type === "orchestrated_pipeline" ? s.engineKeys : undefined,
        })),
      );
    } else {
      setName("");
      setSteps([{ type: "sql" }]);
    }
  }, [isNew, modalData]);

  // Load the pickable scripts and scenario events once per modal mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [scriptsRes, manifestRes] = await Promise.all([
          fetchWithAuth("/api/simulator/sql/scripts"),
          fetchWithAuth("/api/simulator/manifest"),
        ]);
        if (scriptsRes.ok) {
          const data = await scriptsRes.json();
          if (!cancelled) setScripts(data.scripts || []);
        }
        if (manifestRes.ok) {
          const data = await manifestRes.json();
          if (!cancelled) setEvents(data.events || []);
        }
      } catch {
        // Selects just stay empty; save validation still guards incomplete rows.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  const updateStep = (index: number, patch: Partial<SuiteStepRow>) => {
    setSteps((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const moveStep = (index: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const addStep = () => {
    setSteps((prev) => [...prev, { type: "sql" }]);
  };

  const hasResetScriptStep = steps.some(
    (row) => row.type === "sql" && row.scriptId != null && scripts.find((s) => s.id === row.scriptId)?.isResetScript,
  );

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Suite name is required");
      return;
    }
    if (steps.length === 0) {
      toast.error("Add at least one step");
      return;
    }
    for (let i = 0; i < steps.length; i++) {
      const row = steps[i];
      if (row.type === "sql" && row.scriptId == null) {
        toast.error(`Step ${i + 1}: select a SQL script`);
        return;
      }
      if (row.type === "scenario" && !row.eventId) {
        toast.error(`Step ${i + 1}: select a scenario`);
        return;
      }
      if (row.type === "exception_trigger" && row.marker?.trim() && /^\d+$/.test(row.marker.trim())) {
        toast.error(`Step ${i + 1}: marker must be non-numeric`);
        return;
      }
    }

    const payloadSteps: TestSuiteStep[] = steps.map((row) => {
      switch (row.type) {
        case "sql":
          return { type: "sql", scriptId: row.scriptId! };
        case "scenario":
          return { type: "scenario", eventId: row.eventId! };
        case "exception_trigger":
          return row.marker?.trim()
            ? { type: "exception_trigger", marker: row.marker.trim() }
            : { type: "exception_trigger" };
        case "orchestrated_pipeline":
          // The UI never sets testbedCustomerId/engineKeys (run-level customer,
          // all engines) but round-trips API-authored values so an open-and-save
          // doesn't strip them.
          return {
            type: "orchestrated_pipeline",
            ...(row.testbedCustomerId != null ? { testbedCustomerId: row.testbedCustomerId } : {}),
            ...(row.engineKeys != null ? { engineKeys: row.engineKeys } : {}),
          };
      }
    });

    setSaving(true);
    try {
      const url = isNew ? "/api/admin/test-suites" : `/api/admin/test-suites/${modalData?.suite?.id}`;
      const res = await fetchWithAuth(url, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, steps: payloadSteps }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(isNew ? "Test suite created successfully" : "Test suite updated successfully");
        window.dispatchEvent(new CustomEvent("simulator-suites-updated"));
        closeModal();
      } else {
        toast.error(data.error || "Failed to save test suite");
      }
    } catch (err: any) {
      toast.error(err.message || "Network error when saving test suite");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <DialogHeader>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-card border border-border">
            <ListChecks className="w-5 h-5 text-primary" />
          </div>
          <div>
            <DialogTitle className="text-lg font-semibold text-foreground">
              {isNew ? "Create Test Suite" : "Edit Test Suite"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Chain SQL scripts, scenarios, exception triggers, and pipeline runs into one repeatable suite
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="suite-name" className="text-xs font-semibold text-muted-foreground">Suite Name</Label>
        <Input
          id="suite-name"
          placeholder="e.g. Billing Escalation Smoke Test"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-background border-border text-foreground text-xs h-9"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground">Steps</Label>
        <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
          {steps.length === 0 ? (
            <div className="border border-dashed border-border rounded-lg p-4 text-center text-xs italic text-muted-foreground">
              No steps yet — add one below.
            </div>
          ) : (
            steps.map((row, index) => (
              <div
                key={index}
                className="flex items-center gap-2 p-2 border border-border rounded-lg bg-card/50"
              >
                <span className="w-5 shrink-0 text-center text-[10px] font-semibold tabular-nums text-muted-foreground select-none">
                  {index + 1}
                </span>

                <Select
                  value={row.type}
                  onValueChange={(val) =>
                    updateStep(index, {
                      type: val as TestSuiteStepType,
                      scriptId: undefined,
                      eventId: undefined,
                      marker: undefined,
                      testbedCustomerId: undefined,
                      engineKeys: undefined,
                    })
                  }
                >
                  <SelectTrigger className="w-44 shrink-0 bg-background border-border text-foreground text-xs h-8">
                    <SelectValue placeholder="Step type" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground text-xs">
                    {(Object.keys(STEP_TYPE_LABELS) as TestSuiteStepType[]).map((type) => (
                      <SelectItem key={type} value={type}>{STEP_TYPE_LABELS[type]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="min-w-0 flex-1">
                  {row.type === "sql" && (
                    <Select
                      value={row.scriptId != null ? String(row.scriptId) : ""}
                      onValueChange={(val) => updateStep(index, { scriptId: Number(val) })}
                    >
                      <SelectTrigger className="w-full bg-background border-border text-foreground text-xs h-8">
                        <SelectValue placeholder="Select saved script" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border text-foreground text-xs">
                        {scripts.map((script) => (
                          <SelectItem key={script.id} value={String(script.id)}>
                            {script.name}
                            {script.isResetScript && <span className="text-muted-foreground"> (reset)</span>}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {row.type === "scenario" && (
                    <Select
                      value={row.eventId ?? ""}
                      onValueChange={(val) => updateStep(index, { eventId: val })}
                    >
                      <SelectTrigger className="w-full bg-background border-border text-foreground text-xs h-8">
                        <SelectValue placeholder="Select scenario" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border text-foreground text-xs">
                        {events.map((event) => (
                          <SelectItem key={event.id} value={event.id}>{event.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {row.type === "exception_trigger" && (
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="test-suite"
                        value={row.marker ?? ""}
                        onChange={(e) => updateStep(index, { marker: e.target.value })}
                        className="bg-background border-border text-foreground text-xs h-8"
                      />
                      <span className="shrink-0 text-[10px] text-muted-foreground select-none">non-numeric</span>
                    </div>
                  )}
                  {row.type === "orchestrated_pipeline" && (
                    <p className="text-[11px] text-muted-foreground">
                      Runs the full engine manifest against the selected testbed customer
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    onClick={() => moveStep(index, -1)}
                    disabled={index === 0}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                    title="Move step up"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => moveStep(index, 1)}
                    disabled={index === steps.length - 1}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                    title="Move step down"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => removeStep(index)}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                    title="Remove step"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={addStep}
            className="bg-transparent border-border hover:bg-accent hover:text-foreground text-xs h-7 gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add step
          </Button>
          {hasResetScriptStep && (
            <p className="text-[10px] text-muted-foreground">
              Reset scripts always run first, regardless of order.
            </p>
          )}
        </div>
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
              <Save className="w-3.5 h-3.5" /> Save Suite
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
