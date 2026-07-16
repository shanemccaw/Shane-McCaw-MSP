import React, { useState } from "react";
import { useModal } from "@/contexts/ModalContext";
import { useSimulatorActivity } from "@/contexts/SimulatorActivityContext";
import { 
  Database, 
  RefreshCcw, 
  Info,
  X,
  BookOpen,
  Radio,
  CreditCard,
  ShieldAlert,
  Clock,
  Loader2
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GraphProbeModal } from "@/components/GraphProbeModal";

interface QuickFireEvent {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  category: "billing" | "security" | "sow" | "sla" | "crm";
  description: string;
}

// Mirrors the fallback manifest data in SimulatorLeftTree.tsx — kept as a
// small fixed set of "greatest hits" for one-click access during a live demo.
// The full categorized tree with all manifest events still lives in the
// left Explorer; this is a shortcut, not a duplicate of it.
const QUICK_FIRE_EVENTS: QuickFireEvent[] = [
  {
    id: "MSP_SUSPEND_7_DAYS",
    name: "Simulate Unpaid Bill (>7 Days)",
    icon: CreditCard,
    category: "billing",
    description: "Fast-forwards the MSP's suspended_at date to trigger the red lock-out banner in the portal.",
  },
  {
    id: "INJECT_MFA_DRIFT",
    name: "Fire MFA Disabled Alert",
    icon: ShieldAlert,
    category: "security",
    description: "Injects an active MFA_DISABLED signal directly into the tenant to trigger a score drop.",
  },
  {
    id: "SLA_BREACH_TICKETS",
    name: "Age Open Tickets (SLA Breach)",
    icon: Clock,
    category: "sla",
    description: "Ages all open Kanban tasks for this MSP past 48 hours to trigger escalation rules.",
  },
];

export function SimulatorRightRail() {
  const { openModal } = useModal();
  const { isOperationActive } = useSimulatorActivity();
  const [showSchema, setShowSchema] = useState(false);
  const [showProbe, setShowProbe] = useState(false);

  return (
    <TooltipProvider>
      <div className="flex flex-col items-center justify-between h-full py-4 select-none">
        {/* Top actions */}
        <div className="flex flex-col items-center space-y-5">
          {/* Action: Schema Reference */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowSchema(!showSchema)}
                className={`w-10 h-10 flex items-center justify-center rounded-lg border transition-all ${
                  showSchema
                    ? "bg-indigo-600/10 text-indigo-400 border-indigo-500/30"
                    : "text-slate-400 hover:text-slate-200 border-slate-800 bg-slate-900/40 hover:bg-slate-900/80"
                }`}
                title="Database Schema Guide"
              >
                <Database className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="bg-slate-900 border-slate-800 text-slate-200 font-mono text-[10px]">
              Schema Reference
            </TooltipContent>
          </Tooltip>

          <div className="w-6 border-t border-slate-900" />

          {/* Quick-fire scenario shortcuts */}
          {QUICK_FIRE_EVENTS.map((qe) => {
            const Icon = qe.icon;
            const running = isOperationActive(qe.id);
            return (
              <Tooltip key={qe.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => openModal("execute-scenario", { event: qe })}
                    disabled={running}
                    className="w-10 h-10 flex items-center justify-center rounded-lg border text-slate-400 hover:text-slate-200 border-slate-800 bg-slate-900/40 hover:bg-slate-900/80 transition-all disabled:opacity-60"
                    title={qe.name}
                  >
                    {running ? (
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left" className="bg-slate-900 border-slate-800 text-slate-200 font-mono text-[10px]">
                  {qe.name}
                </TooltipContent>
              </Tooltip>
            );
          })}

          <div className="w-6 border-t border-slate-900" />

          {/* Action: Publish Probe */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowProbe(true)}
                className={`w-10 h-10 flex items-center justify-center rounded-lg border transition-all ${
                  showProbe
                    ? "bg-indigo-600/10 text-indigo-400 border-indigo-500/30"
                    : "text-slate-400 hover:text-slate-200 border-slate-800 bg-slate-900/40 hover:bg-slate-900/80"
                }`}
                title="Publish Probe"
              >
                <Radio className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="bg-slate-900 border-slate-800 text-slate-200 font-mono text-[10px]">
              Publish Probe
            </TooltipContent>
          </Tooltip>

          {/* Action: Reset Testbeds */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => openModal("execute-scenario", { 
                  event: {
                    id: "FACTORY_RESET",
                    name: "Factory Reset Testbed",
                    description: "Wipes telemetry logs, clears suspensions, and restores baseline health score definitions.",
                    category: "crm"
                  }
                })}
                disabled={isOperationActive("FACTORY_RESET")}
                className="w-10 h-10 flex items-center justify-center rounded-lg border text-slate-400 hover:text-slate-200 border-slate-800 bg-slate-900/40 hover:bg-slate-900/80 transition-all disabled:opacity-60"
                title="Factory Reset Testbed"
              >
                {isOperationActive("FACTORY_RESET") ? (
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                ) : (
                  <RefreshCcw className="w-4 h-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="bg-slate-900 border-slate-800 text-slate-200 font-mono text-[10px]">
              Factory Reset Testbed
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Bottom help */}
        <div className="flex flex-col items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => window.open("/ADMIN_PORTAL_DOCS.md", "_blank")}
                className="w-10 h-10 flex items-center justify-center rounded-lg border text-slate-400 hover:text-slate-200 border-slate-800 bg-slate-900/40 hover:bg-slate-900/80 transition-all"
                title="Simulator Guide & Docs"
              >
                <BookOpen className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="bg-slate-900 border-slate-800 text-slate-200 font-mono text-[10px]">
              Documentation
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Schema Guide Overlay Drawer */}
        {showSchema && (
          <div className="fixed inset-y-0 right-16 w-80 bg-slate-950 border-l border-slate-800/80 shadow-2xl p-5 z-50 flex flex-col font-mono text-xs text-slate-300">
            <div className="flex items-center justify-between border-b border-slate-850 pb-3 mb-4 select-none shrink-0">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-indigo-500" /> DB Schema Reference
              </span>
              <button 
                onClick={() => setShowSchema(false)}
                className="text-slate-500 hover:text-slate-300 p-0.5 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin">
              <div className="space-y-1.5">
                <h4 className="font-bold text-indigo-400 border-b border-slate-900 pb-0.5 select-none">1. msps</h4>
                <div className="pl-2 space-y-0.5 text-[11px] text-slate-400">
                  <div><span className="text-slate-200 font-semibold">id:</span> serial (PK)</div>
                  <div><span className="text-slate-200 font-semibold">name:</span> text</div>
                  <div><span className="text-slate-200 font-semibold">slug:</span> text (unique)</div>
                  <div><span className="text-slate-200 font-semibold">domain:</span> text</div>
                  <div><span className="text-slate-200 font-semibold">status:</span> text (active, suspended, trial)</div>
                  <div><span className="text-slate-200 font-semibold">suspended_at:</span> timestamp</div>
                  <div><span className="text-slate-200 font-semibold">is_testbed:</span> boolean</div>
                </div>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-bold text-indigo-400 border-b border-slate-900 pb-0.5 select-none">2. saved_sql_scripts</h4>
                <div className="pl-2 space-y-0.5 text-[11px] text-slate-400">
                  <div><span className="text-slate-200 font-semibold">id:</span> serial (PK)</div>
                  <div><span className="text-slate-200 font-semibold">name:</span> text</div>
                  <div><span className="text-slate-200 font-semibold">category:</span> text</div>
                  <div><span className="text-slate-200 font-semibold">query:</span> text</div>
                  <div><span className="text-slate-200 font-semibold">is_destructive:</span> boolean</div>
                </div>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-bold text-indigo-400 border-b border-slate-900 pb-0.5 select-none">3. msp_customers</h4>
                <div className="pl-2 space-y-0.5 text-[11px] text-slate-400">
                  <div><span className="text-slate-200 font-semibold">id:</span> serial (PK)</div>
                  <div><span className="text-slate-200 font-semibold">msp_id:</span> integer (FK)</div>
                  <div><span className="text-slate-200 font-semibold">name:</span> text</div>
                  <div><span className="text-slate-200 font-semibold">domain:</span> text</div>
                  <div><span className="text-slate-200 font-semibold">is_testbed:</span> boolean</div>
                  <div><span className="text-slate-200 font-semibold">status:</span> text</div>
                </div>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-bold text-indigo-400 border-b border-slate-900 pb-0.5 select-none">4. tenant_signal_history</h4>
                <div className="pl-2 space-y-0.5 text-[11px] text-slate-400">
                  <div><span className="text-slate-200 font-semibold">id:</span> serial (PK)</div>
                  <div><span className="text-slate-200 font-semibold">msp_id:</span> integer (FK)</div>
                  <div><span className="text-slate-200 font-semibold">customer_id:</span> integer (FK)</div>
                  <div><span className="text-slate-200 font-semibold">signal_key:</span> text</div>
                  <div><span className="text-slate-200 font-semibold">fired_at:</span> timestamp</div>
                  <div><span className="text-slate-200 font-semibold">resolved_at:</span> timestamp</div>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-900 text-[10px] text-slate-500 leading-normal select-none">
              <span className="font-bold text-slate-400 block mb-0.5">Quick Hint:</span>
              Use these column names in the Query Canvas to inspect tables or inject values.
            </div>
          </div>
        )}
      </div>

      <GraphProbeModal isOpen={showProbe} onClose={() => setShowProbe(false)} />
    </TooltipProvider>
  );
}