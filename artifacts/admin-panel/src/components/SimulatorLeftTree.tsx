import React, { useState, useEffect } from "react";
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
  Terminal, 
  Plus, 
  Folder, 
  FolderOpen,
  FileCode,
  Edit2,
  Trash2,
  Sparkles
} from "lucide-react";
import { toast } from "sonner";

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

export function SimulatorLeftTree(props?: {
  selectedCustomerId?: string;
  onSelectCustomer?: (id: string) => void;
  currentStep?: number;
}) {
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
    "Maintenance": true,
  });

  const toggleCat = (catName: string) => {
    setExpandedCats(prev => ({ ...prev, [catName]: !prev[catName] }));
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
            description: "Fast-forwards the MSP's suspended_at date to trigger the red lock-out banner in the portal."
          },
          {
            id: "INJECT_MFA_DRIFT",
            name: "Fire MFA Disabled Alert",
            icon: "ShieldAlert",
            category: "security",
            description: "Injects an active MFA_DISABLED signal directly into the tenant to trigger a score drop."
          },
          {
            id: "SLA_BREACH_TICKETS",
            name: "Age Open Tickets (SLA Breach)",
            icon: "Clock",
            category: "sla",
            description: "Ages all open Kanban tasks for this MSP past 48 hours to trigger escalation rules."
          },
          {
            id: "FACTORY_RESET",
            name: "Factory Reset Testbed",
            icon: "RefreshCcw",
            category: "crm",
            description: "Wipes all generated signals, clears suspensions, and restores baseline health scores."
          }
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
  const scenariosByCategory = scenarios.reduce((acc, event) => {
    const cat = event.category || "crm";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(event);
    return acc;
  }, {} as Record<string, EventDef[]>);

  // Group scripts by category
  const scriptsByCategory = scripts.reduce((acc, script) => {
    const cat = script.category || "Uncategorized";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(script);
    return acc;
  }, {} as Record<string, SavedScript[]>);

  const getCategoryIcon = (cat: string) => {
    switch (cat.toLowerCase()) {
      case "billing": return <CreditCard className="w-3.5 h-3.5 text-rose-400" />;
      case "security": return <Shield className="w-3.5 h-3.5 text-emerald-400" />;
      case "sla": return <Clock className="w-3.5 h-3.5 text-amber-400" />;
      default: return <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />;
    }
  };

  const handleScriptClick = (script: SavedScript) => {
    // Fire event to load script query in Editor canvas
    window.dispatchEvent(new CustomEvent("simulator-load-script", { detail: script }));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 font-mono text-xs select-none">
      {/* Search / Tree Utilities */}
      <div className="p-3 border-b border-slate-900 flex items-center justify-between gap-2 shrink-0">
        <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Explorer</span>
        <div className="flex items-center gap-1.5">
          <button 
            onClick={() => openModal("new-script")}
            className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 transition-colors"
            title="New SQL Script"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button 
            onClick={loadData}
            disabled={loading}
            className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 transition-colors disabled:opacity-50"
            title="Refresh Explorer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto py-2 pr-1 space-y-2.5">
        
        {/* Section 1: Demo Scenarios */}
        <div className="space-y-1">
          <div 
            onClick={() => setScenariosOpen(!scenariosOpen)}
            className="flex items-center gap-1.5 px-3 py-1 cursor-pointer hover:bg-slate-900 text-slate-300 font-bold tracking-wide"
          >
            {scenariosOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
            {scenariosOpen ? <FolderOpen className="w-4 h-4 text-indigo-400 fill-indigo-400/20" /> : <Folder className="w-4 h-4 text-indigo-400 fill-indigo-400/20" />}
            <span className="truncate">Simulation Scenarios</span>
          </div>

          {scenariosOpen && (
            <div className="pl-4 space-y-1">
              {Object.keys(scenariosByCategory).map(cat => (
                <div key={cat} className="space-y-0.5">
                  <div 
                    onClick={() => toggleCat(cat)}
                    className="flex items-center gap-1.5 px-3 py-0.5 cursor-pointer hover:bg-slate-900/60 text-slate-400 text-[11px]"
                  >
                    {expandedCats[cat] ? <ChevronDown className="w-3 h-3 text-slate-600" /> : <ChevronRight className="w-3 h-3 text-slate-600" />}
                    {getCategoryIcon(cat)}
                    <span className="capitalize truncate">{cat}</span>
                    <span className="text-[9px] text-slate-600 ml-auto">({scenariosByCategory[cat].length})</span>
                  </div>

                  {expandedCats[cat] && (
                    <div className="pl-4 space-y-0.5 border-l border-slate-900/80 ml-4.5 my-0.5">
                      {scenariosByCategory[cat].map(event => (
                        <div 
                          key={event.id}
                          onClick={() => openModal("execute-scenario", { event })}
                          className="group flex items-center gap-2 pl-3 pr-2 py-1 cursor-pointer rounded hover:bg-slate-900 text-slate-300 transition-colors"
                        >
                          <Sparkles className="w-3 h-3 text-indigo-500/80 group-hover:text-indigo-400 shrink-0" />
                          <span className="truncate flex-1 group-hover:text-indigo-200" title={event.name}>
                            {event.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 2: Saved Scripts */}
        <div className="space-y-1">
          <div 
            onClick={() => setScriptsOpen(!scriptsOpen)}
            className="flex items-center gap-1.5 px-3 py-1 cursor-pointer hover:bg-slate-900 text-slate-300 font-bold tracking-wide"
          >
            {scriptsOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
            {scriptsOpen ? <FolderOpen className="w-4 h-4 text-cyan-400 fill-cyan-400/20" /> : <Folder className="w-4 h-4 text-cyan-400 fill-cyan-400/20" />}
            <span className="truncate">Saved SQL Scripts</span>
          </div>

          {scriptsOpen && (
            <div className="pl-4 space-y-1">
              {Object.keys(scriptsByCategory).length === 0 ? (
                <div className="text-[10px] text-slate-600 px-3 py-1 italic">
                  No saved scripts
                </div>
              ) : (
                Object.keys(scriptsByCategory).map(cat => (
                  <div key={cat} className="space-y-0.5">
                    <div 
                      onClick={() => toggleCat(cat)}
                      className="flex items-center gap-1.5 px-3 py-0.5 cursor-pointer hover:bg-slate-900/60 text-slate-400 text-[11px]"
                    >
                      {expandedCats[cat] ? <ChevronDown className="w-3 h-3 text-slate-600" /> : <ChevronRight className="w-3 h-3 text-slate-600" />}
                      <Database className="w-3.5 h-3.5 text-cyan-500" />
                      <span className="truncate">{cat}</span>
                      <span className="text-[9px] text-slate-600 ml-auto">({scriptsByCategory[cat].length})</span>
                    </div>

                    {expandedCats[cat] && (
                      <div className="pl-4 space-y-0.5 border-l border-slate-900/80 ml-4.5 my-0.5">
                        {scriptsByCategory[cat].map(script => (
                          <div 
                            key={script.id}
                            className="group flex items-center gap-2 pl-3 pr-2 py-1 cursor-pointer rounded hover:bg-slate-900 text-slate-300 transition-colors"
                          >
                            <div 
                              className="flex-1 flex items-center gap-2 min-w-0"
                              onClick={() => handleScriptClick(script)}
                            >
                              <FileCode className={`w-3.5 h-3.5 shrink-0 ${script.isDestructive ? 'text-rose-500' : 'text-slate-400'}`} />
                              <span className="truncate hover:text-cyan-400" title={script.name}>
                                {script.name}
                              </span>
                            </div>
                            <button 
                              onClick={() => openModal("edit-script", { script })}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-500 hover:text-slate-200 transition-all shrink-0"
                              title="Edit Script Details"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                          </div>
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
    </div>
  );
}
