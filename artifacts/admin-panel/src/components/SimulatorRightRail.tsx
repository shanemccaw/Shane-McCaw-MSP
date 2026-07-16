import React, { useState } from "react";
import { useModal } from "@/contexts/ModalContext";
import { 
  Database, 
  HelpCircle, 
  RefreshCcw, 
  Info,
  ChevronLeft,
  X,
  BookOpen
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function SimulatorRightRail() {
  const { openModal } = useModal();
  const [showSchema, setShowSchema] = useState(false);

  return (
    <TooltipProvider>
      <div className="flex flex-col items-center justify-between h-full py-4 select-none">
        {/* Top actions */}
        <div className="flex flex-col items-center space-y-5">
          {/* Action 1: Schema Reference */}
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

          {/* Action 2: Reset Testbeds */}
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
                className="w-10 h-10 flex items-center justify-center rounded-lg border text-slate-400 hover:text-slate-200 border-slate-800 bg-slate-900/40 hover:bg-slate-900/80 transition-all"
                title="Factory Reset Testbed"
              >
                <RefreshCcw className="w-4 h-4" />
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
              {/* Table 1 */}
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

              {/* Table 2 */}
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

              {/* Table 3 */}
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

              {/* Table 4 */}
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
    </TooltipProvider>
  );
}
