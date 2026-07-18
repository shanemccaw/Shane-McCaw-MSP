import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useModal } from "@/contexts/ModalContext";
import { useTestbedContext } from "@/contexts/TestbedContext";
import {
  ChevronRight,
  ChevronDown,
  CreditCard,
  Shield,
  Clock,
  RefreshCw,
  Database,
  Plus,
  Folder,
  FolderOpen,
  FileCode,
  Edit2,
  Sparkles,
  Play,
  Trash2,
  AlertTriangle,
  ListChecks,
  Loader2,
  Cpu,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface EventDef {
  id: string;
  name: string;
  icon: string;
  category: "billing" | "security" | "sow" | "sla" | "crm";
  description: string;
  demoSpeakerNote?: string;
}

interface SavedScript {
  id: number;
  name: string;
  category: string;
  query: string;
  isDestructive: boolean;
  isResetScript: boolean;
}

// Exact step shapes stored by /api/admin/test-suites — the tree only needs the
// step count, but the full union keeps the edit-test-suite modalData typed.
type TestSuiteStep =
  | { type: "sql"; scriptId: number }
  | { type: "scenario"; eventId: string }
  | { type: "exception_trigger"; marker?: string }
  | { type: "orchestrated_pipeline"; testbedCustomerId?: number; engineKeys?: string[] };

interface TestSuite {
  id: number;
  name: string;
  steps: TestSuiteStep[];
  createdAt: string;
  updatedAt: string;
}

interface EngineDefSummary {
  key: string;
  label: string;
  description: string;
  categoryPrefix: string;
  tenantScoped: boolean;
}

// Canonical event-bus event types from GET /api/admin/events/types,
// grouped by dot-prefix (e.g. "auth", "customer", "dlq").
interface BusEventType {
  eventType: string;
  group: string;
}

// ~5 minutes of polling at 1500ms per tick.
const SUITE_POLL_INTERVAL_MS = 1500;
const SUITE_POLL_MAX_TICKS = 200;

export function SimulatorLeftTree() {
  const { fetchWithAuth } = useAuth();
  const { openModal } = useModal();
  const { selectedCustomerId } = useTestbedContext();

  const [scenarios, setScenarios] = useState<EventDef[]>([]);
  const [scripts, setScripts] = useState<SavedScript[]>([]);
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [engines, setEngines] = useState<EngineDefSummary[]>([]);
  const [busEventTypes, setBusEventTypes] = useState<BusEventType[]>([]);
  const [loading, setLoading] = useState(false);

  const [triggeringException, setTriggeringException] = useState(false);
  // Suites with an in-flight run — spinner on the row, re-run blocked.
  const [runningSuites, setRunningSuites] = useState<Record<number, boolean>>({});
  // Engines with an in-flight run — spinner on the row, re-run blocked.
  const [runningEngines, setRunningEngines] = useState<Record<string, boolean>>({});
  const pollTimersRef = useRef<number[]>([]);

  // Tree toggle states
  const [scenariosOpen, setScenariosOpen] = useState(true);
  const [scriptsOpen, setScriptsOpen] = useState(true);
  const [exceptionsOpen, setExceptionsOpen] = useState(true);
  const [suitesOpen, setSuitesOpen] = useState(true);
  const [enginesOpen, setEnginesOpen] = useState(true);
  const [busEventsOpen, setBusEventsOpen] = useState(true);

  // Categorized expansion states
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({
    billing: true,
    security: true,
    sla: true,
    crm: true,
    "QA Asserts": true,
    Maintenance: true,
  });

  const toggleCat = (catName: string) => {
    setExpandedCats((prev) => ({ ...prev, [catName]: !prev[catName] }));
  };

  // Group event types by dot-prefix; keys are namespaced ("evt:auth") so event
  // groups never collide with scenario/script categories in expandedCats.
  const busEventsByGroup = busEventTypes.reduce(
    (acc, t) => {
      const group = t.group || "other";
      if (!acc[group]) acc[group] = [];
      acc[group].push(t);
      return acc;
    },
    {} as Record<string, BusEventType[]>,
  );

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch simulator manifest
      const manifestRes = await fetchWithAuth("/api/simulator/manifest");
      if (manifestRes.ok) {
        const manifestData = await manifestRes.json();
        setScenarios(manifestData.events || []);
      } else {
        // Fallback default manifest if server fails
        setScenarios([
          {
            id: "MSP_SUSPEND_7_DAYS",
            name: "Simulate Unpaid Bill (>7 Days)",
            icon: "CreditCard",
            category: "billing",
            description: "Fast-forwards the MSP's suspended_at date to trigger the red lock-out banner in the portal.",
          },
          {
            id: "INJECT_MFA_DRIFT",
            name: "Fire MFA Disabled Alert",
            icon: "ShieldAlert",
            category: "security",
            description: "Injects an active MFA_DISABLED signal directly into the tenant to trigger a score drop.",
          },
          {
            id: "SLA_BREACH_TICKETS",
            name: "Age Open Tickets (SLA Breach)",
            icon: "Clock",
            category: "sla",
            description: "Ages all open Kanban tasks for this MSP past 48 hours to trigger escalation rules.",
          },
          {
            id: "FACTORY_RESET",
            name: "Factory Reset Testbed",
            icon: "RefreshCcw",
            category: "crm",
            description: "Wipes all generated signals, clears suspensions, and restores baseline health scores.",
          },
        ]);
      }

      // 2. Fetch saved SQL scripts
      const scriptsRes = await fetchWithAuth("/api/simulator/sql/scripts");
      if (scriptsRes.ok) {
        const scriptsData = await scriptsRes.json();
        setScripts(scriptsData.scripts || []);
      }

      // 3. Fetch test suites
      const suitesRes = await fetchWithAuth("/api/admin/test-suites");
      if (suitesRes.ok) {
        const suitesData = await suitesRes.json();
        setSuites(suitesData.suites || []);
      }

      // 4. Fetch engine registry
      const enginesRes = await fetchWithAuth("/api/admin/engines");
      if (enginesRes.ok) {
        const enginesData = await enginesRes.json();
        setEngines(enginesData.engines || []);
      }

      // 5. Fetch canonical event-bus event types
      const eventTypesRes = await fetchWithAuth("/api/admin/events/types");
      if (eventTypesRes.ok) {
        const eventTypesData = await eventTypesRes.json();
        setBusEventTypes(eventTypesData.types || []);
      }
    } catch (err) {
      console.error("Error loading simulator tree data:", err);
      toast.error("Failed to load some simulator workspace items");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Listen for scripts-updated / suites-updated events to reload lists
    const handleScriptsUpdate = () => {
      loadData();
    };
    const handleSuitesUpdate = () => {
      loadData();
    };
    window.addEventListener("simulator-scripts-updated", handleScriptsUpdate);
    window.addEventListener("simulator-suites-updated", handleSuitesUpdate);
    return () => {
      window.removeEventListener("simulator-scripts-updated", handleScriptsUpdate);
      window.removeEventListener("simulator-suites-updated", handleSuitesUpdate);
    };
  }, [fetchWithAuth]);

  // Stop any in-flight suite-run polling on unmount.
  useEffect(() => {
    return () => {
      pollTimersRef.current.forEach((timer) => window.clearInterval(timer));
      pollTimersRef.current = [];
    };
  }, []);

  // Group events by category
  const scenariosByCategory = scenarios.reduce(
    (acc, event) => {
      const cat = event.category || "crm";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(event);
      return acc;
    },
    {} as Record<string, EventDef[]>,
  );

  // Group scripts by category
  const scriptsByCategory = scripts.reduce(
    (acc, script) => {
      const cat = script.category || "Uncategorized";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(script);
      return acc;
    },
    {} as Record<string, SavedScript[]>,
  );

  const getCategoryIcon = (cat: string) => {
    switch (cat.toLowerCase()) {
      case "billing":
        return <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />;
      case "security":
        return <Shield className="h-3.5 w-3.5 text-muted-foreground" />;
      case "sla":
        return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
      default:
        return <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const handleScriptClick = (script: SavedScript) => {
    // Fire event to load script query in Editor canvas
    window.dispatchEvent(new CustomEvent("simulator-load-script", { detail: script }));
  };

  const handleScriptRun = (script: SavedScript) => {
    window.dispatchEvent(new CustomEvent("simulator-run-script", { detail: script }));
  };

  const handleScriptDelete = async (script: SavedScript) => {
    if (!confirm(`Delete saved script "${script.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetchWithAuth(`/api/simulator/sql/scripts/${script.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Script deleted");
        window.dispatchEvent(new CustomEvent("simulator-scripts-updated"));
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to delete script");
      }
    } catch (err: any) {
      toast.error(err.message || "Network error deleting script");
    }
  };

  const handleTriggerException = async () => {
    if (triggeringException) return;
    setTriggeringException(true);
    try {
      const res = await fetchWithAuth("/api/admin/exceptions/_test/trigger?marker=simulator-tree", {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
      } else {
        toast.error(data.error || "Failed to trigger synthetic exception");
      }
    } catch (err: any) {
      toast.error(err.message || "Network error triggering synthetic exception");
    } finally {
      setTriggeringException(false);
    }
  };

  const stopSuitePoll = (timer: number, suiteId: number) => {
    window.clearInterval(timer);
    pollTimersRef.current = pollTimersRef.current.filter((t) => t !== timer);
    setRunningSuites((prev) => ({ ...prev, [suiteId]: false }));
  };

  const handleSuiteRun = async (suite: TestSuite) => {
    if (runningSuites[suite.id]) return;
    if (selectedCustomerId == null) {
      toast.error("Select a testbed customer in the header first");
      return;
    }
    setRunningSuites((prev) => ({ ...prev, [suite.id]: true }));
    try {
      const res = await fetchWithAuth(`/api/admin/test-suites/${suite.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testbedCustomerId: selectedCustomerId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRunningSuites((prev) => ({ ...prev, [suite.id]: false }));
        toast.error(data.error || "Failed to start suite run");
        return;
      }
      const runId: number = data.runId;
      toast.success(`Suite run #${runId} started — output streams to the Log Stream`);

      // Async interval callbacks can overlap when a poll runs longer than the
      // interval: `inFlight` skips a tick while the previous fetch is pending,
      // and `done` guarantees exactly one tick finalizes (stop + toast).
      let ticks = 0;
      let inFlight = false;
      let done = false;
      const finalize = (notify: () => void) => {
        if (done) return;
        done = true;
        stopSuitePoll(timer, suite.id);
        notify();
      };
      const timer = window.setInterval(async () => {
        if (done) return;
        // Every tick counts toward the cap — including skipped ones — so a
        // hung request can't stretch the 5-minute budget.
        ticks += 1;
        if (!inFlight) {
          inFlight = true;
          try {
            const pollRes = await fetchWithAuth(`/api/admin/test-suites/runs/${runId}`);
            if (!done && pollRes.ok) {
              const pollData = await pollRes.json();
              const run = pollData.run;
              if (run && run.status !== "running") {
                finalize(() => {
                  if (run.status === "completed") {
                    toast.success(`Suite run #${runId} completed`);
                  } else {
                    const stepResults: Array<{ status: string }> = run.stepResults ?? [];
                    const failed = stepResults.filter((s) => s.status === "failed").length;
                    toast.error(`Suite run #${runId} failed — ${failed} of ${stepResults.length} steps failed`);
                  }
                });
                return;
              }
            }
          } catch {
            // Transient poll error — keep polling until the tick budget runs out.
          } finally {
            inFlight = false;
          }
        }
        if (ticks >= SUITE_POLL_MAX_TICKS) {
          finalize(() => toast.error(`Suite run #${runId} is still running after 5 minutes — stopped polling`));
        }
      }, SUITE_POLL_INTERVAL_MS);
      pollTimersRef.current.push(timer);
    } catch (err: any) {
      setRunningSuites((prev) => ({ ...prev, [suite.id]: false }));
      toast.error(err.message || "Network error starting suite run");
    }
  };

  const handleEngineRun = async (engine: EngineDefSummary) => {
    if (runningEngines[engine.key]) return;
    if (selectedCustomerId == null) {
      toast.error("Select a testbed customer in the header first");
      return;
    }
    setRunningEngines((prev) => ({ ...prev, [engine.key]: true }));
    try {
      const res = await fetchWithAuth(`/api/admin/engines/${engine.key}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: selectedCustomerId, debug: true }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`${engine.key} ran against real tenant data`);
      } else {
        toast.error(data.error || "Engine run failed");
      }
    } catch (err: any) {
      toast.error(err.message || "Network error running engine");
    } finally {
      setRunningEngines((prev) => ({ ...prev, [engine.key]: false }));
    }
  };

  const handleSuiteDelete = async (suite: TestSuite) => {
    if (!confirm(`Delete test suite "${suite.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetchWithAuth(`/api/admin/test-suites/${suite.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Test suite deleted");
        window.dispatchEvent(new CustomEvent("simulator-suites-updated"));
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to delete test suite");
      }
    } catch (err: any) {
      toast.error(err.message || "Network error deleting test suite");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-xs select-none">
      {/* Explorer header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Explorer</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => openModal("new-script")}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="New SQL script"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Refresh explorer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Tree content */}
      <ContextMenu>
      <ContextMenuTrigger asChild>
      <div className="flex-1 space-y-1 overflow-y-auto py-1">
        {/* Section 1: Simulation Scenarios */}
        <div>
          <div
            onClick={() => setScenariosOpen(!scenariosOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {scenariosOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate">Simulation Scenarios</span>
          </div>

          {scenariosOpen && (
            <div>
              {Object.keys(scenariosByCategory).map((cat) => (
                <div key={cat}>
                  <div
                    onClick={() => toggleCat(cat)}
                    className="flex h-[22px] cursor-pointer items-center gap-1.5 pl-4 pr-2 text-muted-foreground hover:bg-accent"
                  >
                    {expandedCats[cat] ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground/70" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground/70" />
                    )}
                    {expandedCats[cat] ? (
                      <FolderOpen className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <Folder className="h-3.5 w-3.5 text-primary" />
                    )}
                    <span className="truncate capitalize">{cat}</span>
                    <span className="ml-auto text-[9px] tabular-nums text-muted-foreground/60">
                      {scenariosByCategory[cat].length}
                    </span>
                  </div>

                  {expandedCats[cat] && (
                    <div className="ml-[22px] border-l border-accent">
                      {scenariosByCategory[cat].map((event) => (
                        <ContextMenu key={event.id}>
                          <ContextMenuTrigger asChild>
                            <div
                              onClick={() => openModal("execute-scenario", { event })}
                              className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 text-foreground/85 transition-colors hover:bg-accent hover:text-foreground"
                            >
                              <Sparkles className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-primary" />
                              <span className="flex-1 truncate" title={event.description || event.name}>
                                {event.name}
                              </span>
                              <span className="hidden shrink-0 group-hover:inline">{getCategoryIcon(event.category)}</span>
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="w-44">
                            <ContextMenuItem onSelect={() => openModal("execute-scenario", { event })} className="gap-2 text-xs">
                              <Play className="h-3.5 w-3.5" />
                              Execute
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 2: Saved SQL Scripts */}
        <div>
          <div
            onClick={() => setScriptsOpen(!scriptsOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {scriptsOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate">Saved SQL Scripts</span>
          </div>

          {scriptsOpen && (
            <div>
              {Object.keys(scriptsByCategory).length === 0 ? (
                <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">No saved scripts</div>
              ) : (
                Object.keys(scriptsByCategory).map((cat) => (
                  <div key={cat}>
                    <div
                      onClick={() => toggleCat(cat)}
                      className="flex h-[22px] cursor-pointer items-center gap-1.5 pl-4 pr-2 text-muted-foreground hover:bg-accent"
                    >
                      {expandedCats[cat] ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground/70" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground/70" />
                      )}
                      <Database className="h-3.5 w-3.5 text-primary" />
                      <span className="truncate">{cat}</span>
                      <span className="ml-auto text-[9px] tabular-nums text-muted-foreground/60">
                        {scriptsByCategory[cat].length}
                      </span>
                    </div>

                    {expandedCats[cat] && (
                      <div className="ml-[22px] border-l border-accent">
                        {scriptsByCategory[cat].map((script) => (
                          <ContextMenu key={script.id}>
                            <ContextMenuTrigger asChild>
                              <div className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 text-foreground/85 transition-colors hover:bg-accent hover:text-foreground">
                                <div className="flex min-w-0 flex-1 items-center gap-1.5" onClick={() => handleScriptClick(script)}>
                                  <FileCode
                                    className={`h-3.5 w-3.5 shrink-0 ${
                                      script.isDestructive
                                        ? "text-destructive"
                                        : script.isResetScript
                                          ? "text-amber-400"
                                          : "text-muted-foreground"
                                    }`}
                                    aria-label={
                                      script.isDestructive
                                        ? "Destructive script"
                                        : script.isResetScript
                                          ? "Reset script (always runs first in test suites)"
                                          : undefined
                                    }
                                  />
                                  <span className="truncate font-mono text-[11px]" title={script.name}>
                                    {script.name}
                                  </span>
                                </div>
                                <button
                                  onClick={() => openModal("edit-script", { script })}
                                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-all hover:text-foreground group-hover:opacity-100"
                                  title="Edit script details"
                                >
                                  <Edit2 className="h-3 w-3" />
                                </button>
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-44">
                              <ContextMenuItem onSelect={() => handleScriptRun(script)} className="gap-2 text-xs">
                                <Play className="h-3.5 w-3.5" />
                                Execute
                              </ContextMenuItem>
                              <ContextMenuItem onSelect={() => openModal("edit-script", { script })} className="gap-2 text-xs">
                                <Edit2 className="h-3.5 w-3.5" />
                                Edit
                              </ContextMenuItem>
                              <ContextMenuItem
                                onSelect={() => handleScriptDelete(script)}
                                className="gap-2 text-xs text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Section 3: Exception Testing */}
        <div>
          <div
            onClick={() => setExceptionsOpen(!exceptionsOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {exceptionsOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate">Exception Testing</span>
          </div>

          {exceptionsOpen && (
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  onClick={() => {
                    if (!triggeringException) handleTriggerException();
                  }}
                  className={`group flex h-[22px] items-center gap-1.5 pl-4 pr-2 text-foreground/85 transition-colors hover:bg-accent hover:text-foreground ${
                    triggeringException ? "cursor-default opacity-60" : "cursor-pointer"
                  }`}
                >
                  {triggeringException ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-400" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  )}
                  <span
                    className="flex-1 truncate"
                    title="Fires a synthetic exception through the exception pipeline (marker: simulator-tree)"
                  >
                    Trigger Synthetic Exception
                  </span>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-44">
                <ContextMenuItem
                  onSelect={handleTriggerException}
                  disabled={triggeringException}
                  className="gap-2 text-xs"
                >
                  <Play className="h-3.5 w-3.5" />
                  Trigger
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )}
        </div>

        {/* Section 4: Test Suites */}
        <div>
          <div
            onClick={() => setSuitesOpen(!suitesOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {suitesOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate">Test Suites</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                openModal("new-test-suite");
              }}
              className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="New test suite"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          {suitesOpen && (
            <div>
              {suites.length === 0 ? (
                <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">No test suites</div>
              ) : (
                suites.map((suite) => {
                  const isRunning = !!runningSuites[suite.id];
                  return (
                    <ContextMenu key={suite.id}>
                      <ContextMenuTrigger asChild>
                        <div
                          onClick={() => openModal("edit-test-suite", { suite })}
                          className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-4 pr-2 text-foreground/85 transition-colors hover:bg-accent hover:text-foreground"
                        >
                          {isRunning ? (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-label="Suite run in progress" />
                          ) : (
                            <ListChecks className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                          )}
                          <span className="flex-1 truncate" title={suite.name}>
                            {suite.name}
                          </span>
                          <span className="ml-auto text-[9px] tabular-nums text-muted-foreground/60">
                            {suite.steps.length}
                          </span>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-44">
                        <ContextMenuItem
                          onSelect={() => handleSuiteRun(suite)}
                          disabled={isRunning}
                          className="gap-2 text-xs"
                        >
                          <Play className="h-3.5 w-3.5" />
                          Run
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => openModal("edit-test-suite", { suite })} className="gap-2 text-xs">
                          <Edit2 className="h-3.5 w-3.5" />
                          Edit
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => handleSuiteDelete(suite)}
                          className="gap-2 text-xs text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Section 5: Engines */}
        <div>
          <div
            onClick={() => setEnginesOpen(!enginesOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {enginesOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate">Engines</span>
          </div>

          {enginesOpen && (
            <div>
              {engines.length === 0 ? (
                <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">No engines</div>
              ) : (
                engines.map((engine) => {
                  const isRunning = !!runningEngines[engine.key];
                  return (
                    <ContextMenu key={engine.key}>
                      <ContextMenuTrigger asChild>
                        <div
                          onClick={() => handleEngineRun(engine)}
                          className={`group flex h-[22px] items-center gap-1.5 pl-4 pr-2 text-foreground/85 transition-colors hover:bg-accent hover:text-foreground ${
                            isRunning ? "cursor-default opacity-60" : "cursor-pointer"
                          }`}
                        >
                          {isRunning ? (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-label="Engine run in progress" />
                          ) : (
                            <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                          )}
                          <span className="flex-1 truncate" title={engine.description || engine.label}>
                            {engine.label}
                          </span>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-44">
                        <ContextMenuItem
                          onSelect={() => handleEngineRun(engine)}
                          disabled={isRunning}
                          className="gap-2 text-xs"
                        >
                          <Play className="h-3.5 w-3.5" />
                          Run
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Section 6: Events (canonical event bus) */}
        <div>
          <div
            onClick={() => setBusEventsOpen(!busEventsOpen)}
            className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
          >
            {busEventsOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate">Events</span>
          </div>

          {busEventsOpen && (
            <div>
              {busEventTypes.length === 0 ? (
                <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">No event types</div>
              ) : (
                Object.keys(busEventsByGroup).map((group) => (
                  <div key={group}>
                    <div
                      onClick={() => toggleCat(`evt:${group}`)}
                      className="flex h-[22px] cursor-pointer items-center gap-1.5 pl-4 pr-2 text-muted-foreground hover:bg-accent"
                    >
                      {expandedCats[`evt:${group}`] ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground/70" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground/70" />
                      )}
                      {expandedCats[`evt:${group}`] ? (
                        <FolderOpen className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <Folder className="h-3.5 w-3.5 text-primary" />
                      )}
                      <span className="truncate">{group}</span>
                      <span className="ml-auto text-[9px] tabular-nums text-muted-foreground/60">
                        {busEventsByGroup[group].length}
                      </span>
                    </div>

                    {expandedCats[`evt:${group}`] && (
                      <div className="ml-[22px] border-l border-accent">
                        {busEventsByGroup[group].map((t) => (
                          <ContextMenu key={t.eventType}>
                            <ContextMenuTrigger asChild>
                              <div
                                onClick={() => openModal("fire-bus-event", { eventType: t.eventType })}
                                className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 text-foreground/85 transition-colors hover:bg-accent hover:text-foreground"
                              >
                                <Zap className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-amber-400" />
                                <span className="flex-1 truncate font-mono text-[11px]" title={t.eventType}>
                                  {t.eventType}
                                </span>
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-44">
                              <ContextMenuItem
                                onSelect={() => openModal("fire-bus-event", { eventType: t.eventType })}
                                className="gap-2 text-xs"
                              >
                                <Zap className="h-3.5 w-3.5" />
                                Fire…
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onSelect={() => openModal("new-script")} className="gap-2 text-xs">
          <Plus className="h-3.5 w-3.5" />
          New Script
        </ContextMenuItem>
      </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
