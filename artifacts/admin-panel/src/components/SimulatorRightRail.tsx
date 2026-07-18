import React, { useState } from "react";
import { useModal } from "@/contexts/ModalContext";
import { useSimulatorActivity } from "@/contexts/SimulatorActivityContext";
import {
  RefreshCcw,
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
  const [showProbe, setShowProbe] = useState(false);

  return (
    <TooltipProvider>
      <div className="flex flex-col items-center justify-between h-full py-4 select-none">
        {/* Top actions */}
        <div className="flex flex-col items-center space-y-5">
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
      </div>

      <GraphProbeModal isOpen={showProbe} onClose={() => setShowProbe(false)} />
    </TooltipProvider>
  );
}