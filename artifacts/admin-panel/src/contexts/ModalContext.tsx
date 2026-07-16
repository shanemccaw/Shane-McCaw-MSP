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

export type ModalType = "execute-scenario" | "edit-script" | "new-script" | null;

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
      <DialogContent className="max-w-2xl bg-slate-950 border border-slate-800 text-slate-100 shadow-2xl p-6 rounded-xl">
        {activeModal === "execute-scenario" && <ExecuteScenarioModal />}
        {activeModal === "edit-script" && <ScriptEditorModal isNew={false} />}
        {activeModal === "new-script" && <ScriptEditorModal isNew={true} />}
      </DialogContent>
    </Dialog>
  );
}

// ─── Modal 1: ExecuteScenarioModal ───────────────────────────────────────────
interface TestbedMsp {
  id: number;
  name: string;
  isTestbed: boolean;
  status: string;
}

function ExecuteScenarioModal() {
  const { modalData, closeModal } = useModal();
  const { fetchWithAuth } = useAuth();
  const { startOperation, endOperation } = useSimulatorActivity();
  const [msps, setMsps] = useState<TestbedMsp[]>([]);
  const [selectedMspId, setSelectedMspId] = useState<string>("");
  const [loadingMsps, setLoadingMsps] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<any>(null);

  const event = modalData?.event;

  useEffect(() => {
    async function loadMsps() {
      setLoadingMsps(true);
      try {
        const res = await fetchWithAuth("/api/admin/msps?limit=100");
        if (res.ok) {
          const data = await res.json();
          // Filter for isTestbed = true on frontend as backup, or show all testbeds
          const testbeds = (data.msps || []).filter((m: any) => m.isTestbed);
          setMsps(testbeds);
          if (testbeds.length > 0) {
            setSelectedMspId(String(testbeds[0].id));
          }
        }
      } catch (err) {
        console.error("Failed to load testbeds", err);
      } finally {
        setLoadingMsps(false);
      }
    }
    loadMsps();
  }, [fetchWithAuth]);

 const handleExecute = async () => {
    if (!selectedMspId) {
      toast.error("Please select a target testbed MSP");
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
          testbedMspId: Number(selectedMspId),
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
      case "billing": return <CreditCard className="w-5 h-5 text-rose-400 animate-pulse" />;
      case "security": return <Shield className="w-5 h-5 text-emerald-400 animate-pulse" />;
      case "sla": return <Clock className="w-5 h-5 text-amber-400 animate-pulse" />;
      default: return <RefreshCw className="w-5 h-5 text-cyan-400 animate-pulse" />;
    }
  };

  return (
    <div className="space-y-5">
      <DialogHeader>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
            {getEventIcon(event?.category)}
          </div>
          <div>
            <DialogTitle className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              Fire Simulation Scenario
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Run test scenarios against local testbed systems
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="border border-slate-800/80 rounded-xl bg-slate-900/40 p-4 space-y-3.5">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Scenario Name</h4>
          <p className="text-sm font-medium text-slate-200">{event?.name}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Description</h4>
          <p className="text-xs text-slate-300 leading-relaxed">{event?.description}</p>
        </div>
        {event?.demoSpeakerNote && (
          <div className="bg-cyan-950/20 border border-cyan-800/30 rounded-lg p-3 text-[11px] text-cyan-400 flex gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold uppercase tracking-wider block text-[9px] mb-0.5 text-cyan-300">Speaker Note (Demo Walkthrough)</span>
              {event.demoSpeakerNote}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <Label className="text-xs font-medium text-slate-400">Select Target Testbed MSP</Label>
        {loadingMsps ? (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading testbeds...
          </div>
        ) : msps.length === 0 ? (
          <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-3.5 text-xs text-red-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            No testbed MSPs (is_testbed = true) exist in the system. Go to platform settings to flag one.
          </div>
        ) : (
          <Select value={selectedMspId} onValueChange={setSelectedMspId}>
            <SelectTrigger className="w-full bg-slate-900 border-slate-800 text-slate-200 text-xs h-10">
              <SelectValue placeholder="Select target testbed" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800 text-slate-200 text-xs">
              {msps.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.name} (MSP ID: {m.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {executionResult && (
        <div className={`border rounded-xl p-4 font-mono text-[11px] overflow-hidden ${
          executionResult.success 
            ? "bg-emerald-950/10 border-emerald-900/30 text-emerald-300" 
            : "bg-rose-950/10 border-rose-900/30 text-rose-300"
        }`}>
          <div className="flex items-center gap-2 font-semibold text-xs mb-2">
            {executionResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400" />
            )}
            {executionResult.success ? "Execution Succeeded" : "Execution Failed"}
          </div>
          {executionResult.success ? (
            <div className="space-y-1">
              <div><span className="text-slate-500">&gt; message:</span> {executionResult.message}</div>
              <div><span className="text-slate-500">&gt; mutated_rows:</span> {executionResult.mutatedRows ?? 0}</div>
              <div><span className="text-slate-500">&gt; duration:</span> {executionResult.executionMs}ms</div>
              <div><span className="text-slate-500">&gt; timestamp:</span> {executionResult.timestamp}</div>
            </div>
          ) : (
            <div><span className="text-slate-500">&gt; error:</span> {executionResult.error}</div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-3 border-t border-slate-900">
        <Button 
          variant="outline" 
          onClick={closeModal}
          className="bg-transparent border-slate-800 hover:bg-slate-900 hover:text-slate-100 text-xs"
        >
          Cancel
        </Button>
        <Button 
          onClick={handleExecute}
          disabled={executing || msps.length === 0}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center gap-2 px-4 shadow-lg shadow-indigo-600/10"
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
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
            <TerminalIcon className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <DialogTitle className="text-lg font-semibold text-slate-100">
              {isNew ? "Create SQL Utility Script" : "Edit SQL Utility Script"}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Manage saved scripts for testing database migrations and telemetry logic
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-4 pt-1">
        <div className="space-y-1.5 col-span-2 md:col-span-1">
          <Label htmlFor="script-name" className="text-xs font-semibold text-slate-400">Script Name</Label>
          <Input 
            id="script-name" 
            placeholder="e.g. Wipe Signal Logs" 
            value={name} 
            onChange={(e) => setName(e.target.value)}
            className="bg-slate-900 border-slate-800 text-slate-200 text-xs h-9"
          />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
          <Label htmlFor="script-category" className="text-xs font-semibold text-slate-400">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full bg-slate-900 border-slate-800 text-slate-200 text-xs h-9">
              <SelectValue placeholder="Select Category" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800 text-slate-200 text-xs">
              <SelectItem value="QA Asserts">QA Asserts</SelectItem>
              <SelectItem value="Maintenance">Maintenance</SelectItem>
              <SelectItem value="Database Setup">Database Setup</SelectItem>
              <SelectItem value="Testing Helpers">Testing Helpers</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-slate-400">SQL Query</Label>
        <div className="border border-slate-800 rounded-lg overflow-hidden bg-[#282c34] text-[11px] leading-relaxed">
          <CodeMirror
            value={query}
            height="180px"
            theme={oneDark}
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

      <div className="flex items-center justify-between p-3 border border-slate-800/80 rounded-lg bg-slate-900/40">
        <div className="flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-semibold text-slate-200">Destructive Script</h4>
            <p className="text-[10px] text-slate-400">Check this if the query performs deletions, drops, or updates that wipe data.</p>
          </div>
        </div>
        <input 
          type="checkbox" 
          checked={isDestructive} 
          onChange={(e) => setIsDestructive(e.target.checked)}
          className="w-4 h-4 rounded border-slate-800 text-indigo-600 bg-slate-950 accent-indigo-600 focus:ring-indigo-600/30"
        />
      </div>

      <div className="flex justify-end gap-3 pt-3 border-t border-slate-900">
        <Button 
          variant="outline" 
          onClick={closeModal}
          className="bg-transparent border-slate-800 hover:bg-slate-900 hover:text-slate-100 text-xs"
        >
          Cancel
        </Button>
        <Button 
          onClick={handleSave}
          disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center gap-2 px-4 shadow-lg shadow-indigo-600/10"
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
