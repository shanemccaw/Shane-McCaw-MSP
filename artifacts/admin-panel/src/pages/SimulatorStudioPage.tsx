import React from "react";
import { ModalProvider } from "../contexts/ModalContext";
import { SimulatorActivityProvider, useSimulatorActivity } from "../contexts/SimulatorActivityContext";
import { SimulatorLeftTree } from "../components/SimulatorLeftTree";
import { SimulatorCenterCanvas } from "../components/SimulatorCenterCanvas";
import { SimulatorReplayCanvas } from "../components/SimulatorReplayCanvas";
import { SimulatorPortalMirror } from "../components/SimulatorPortalMirror";
import { SimulatorRightRail } from "../components/SimulatorRightRail";

function SimulationProgressBar() {
  const { isBusy } = useSimulatorActivity();
  if (!isBusy) return null;
  return <div className="h-0.5 w-full bg-indigo-500/80 animate-pulse shrink-0" />;
}

export function SimulatorStudioPage() {
  return (
    <SimulatorActivityProvider>
      <ModalProvider>
        <div className="flex flex-col h-full bg-slate-950 overflow-hidden">
          <SimulationProgressBar />
          <div className="flex flex-1 min-h-0 text-slate-300 font-sans">
            {/* Left Panel: Testbed Explorer, Overrides & Simulation Scenarios */}
            <div className="w-64 border-r border-slate-900 flex flex-col bg-slate-950 shrink-0 min-h-0 overflow-hidden">
              <SimulatorLeftTree />
            </div>

            {/* Center: Live Replay Canvas (fills remaining space) + Bottom
                Drawer (fixed height — SQL Terminal, Testbeds, Overrides,
                ad-hoc Engine runs, Live DB Schema) */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-slate-950">
              <div className="flex-1 min-h-0 overflow-hidden border-b border-slate-900">
                <SimulatorReplayCanvas />
              </div>
              <div className="h-[420px] shrink-0 overflow-hidden border-t border-slate-900">
                <SimulatorCenterCanvas />
              </div>
            </div>

            {/* Right Panel: Customer Portal View Mirror */}
            <div className="w-96 border-l border-slate-900 flex flex-col bg-slate-950 shrink-0 min-h-0 overflow-hidden">
              <SimulatorPortalMirror />
            </div>

            {/* Far Right Activity Bar */}
            <div className="w-16 border-l border-slate-900 flex flex-col items-center py-4 bg-slate-950 shrink-0">
              <SimulatorRightRail />
            </div>
          </div>
        </div>
      </ModalProvider>
    </SimulatorActivityProvider>
  );
}