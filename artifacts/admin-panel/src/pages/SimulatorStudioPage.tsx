import React from "react";
import { ModalProvider } from "../contexts/ModalContext";
import { SimulatorActivityProvider, useSimulatorActivity } from "../contexts/SimulatorActivityContext";
import { SimulatorLeftTree } from "../components/SimulatorLeftTree";
import { SimulatorCenterCanvas } from "../components/SimulatorCenterCanvas";
import { SimulatorRightRail } from "../components/SimulatorRightRail";
import { SqlTerminalPanel } from "../components/SqlTerminalPanel";
import { LiveDbSchemaTree } from "../components/LiveDbSchemaTree";

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
            {/* Left Tree Explorer */}
            <div className="w-64 border-r border-slate-900 flex flex-col bg-slate-950 shrink-0">
              <SimulatorLeftTree />
            </div>

            {/* Center Main Work Area */}
            <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
              <div className="flex-1 flex flex-col min-h-0">
                <SimulatorCenterCanvas />
              </div>
              {/* Bottom Panel Drawer (Log Stream & SQL Terminal) */}
              <div className="h-64 border-t border-slate-900 bg-slate-950">
                <SqlTerminalPanel />
              </div>
            </div>

            {/* Right Panel: Live DB Schema Table Explorer */}
            <div className="w-80 border-l border-slate-900 flex flex-col bg-slate-950 shrink-0 min-h-0 overflow-hidden">
              <LiveDbSchemaTree />
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