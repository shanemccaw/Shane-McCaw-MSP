import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useModal } from "@/contexts/ModalContext";
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
}

export function SimulatorLeftTree() {
  const { fetchWithAuth } = useAuth();
  const { openModal } = useModal();

  const [scenarios, setScenarios] = useState<EventDef[]>([]);
  const [scripts, setScripts] = useState<SavedScript[]>([]);
  const [loading, setLoading] = useState(false);

  // Tree toggle states
  const [scenariosOpen, setScenariosOpen] = useState(true);
  const [scriptsOpen, setScriptsOpen] = useState(true);

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
    } catch (err) {
      console.error("Error loading simulator tree data:", err);
      toast.error("Failed to load some simulator workspace items");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Listen for scripts-updated event to reload list
    const handleScriptsUpdate = () => {
      loadData();
    };
    window.addEventListener("simulator-scripts-updated", handleScriptsUpdate);
    return () => {
      window.removeEventListener("simulator-scripts-updated", handleScriptsUpdate);
    };
  }, [fetchWithAuth]);

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
                      <FolderOpen className="h-3.5 w-3.5 text-[#58A6FF]" />
                    ) : (
                      <Folder className="h-3.5 w-3.5 text-[#58A6FF]" />
                    )}
                    <span className="truncate capitalize">{cat}</span>
                    <span className="ml-auto text-[9px] tabular-nums text-muted-foreground/60">
                      {scenariosByCategory[cat].length}
                    </span>
                  </div>

                  {expandedCats[cat] && (
                    <div className="ml-[22px] border-l border-[#21262D]">
                      {scenariosByCategory[cat].map((event) => (
                        <ContextMenu key={event.id}>
                          <ContextMenuTrigger asChild>
                            <div
                              onClick={() => openModal("execute-scenario", { event })}
                              className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 text-foreground/85 transition-colors hover:bg-accent hover:text-foreground"
                            >
                              <Sparkles className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-[#58A6FF]" />
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
                      <Database className="h-3.5 w-3.5 text-[#58A6FF]" />
                      <span className="truncate">{cat}</span>
                      <span className="ml-auto text-[9px] tabular-nums text-muted-foreground/60">
                        {scriptsByCategory[cat].length}
                      </span>
                    </div>

                    {expandedCats[cat] && (
                      <div className="ml-[22px] border-l border-[#21262D]">
                        {scriptsByCategory[cat].map((script) => (
                          <ContextMenu key={script.id}>
                            <ContextMenuTrigger asChild>
                              <div className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 text-foreground/85 transition-colors hover:bg-accent hover:text-foreground">
                                <div className="flex min-w-0 flex-1 items-center gap-1.5" onClick={() => handleScriptClick(script)}>
                                  <FileCode
                                    className={`h-3.5 w-3.5 shrink-0 ${script.isDestructive ? "text-destructive" : "text-muted-foreground"}`}
                                    aria-label={script.isDestructive ? "Destructive script" : undefined}
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
