import React from "react";
import { ModalProvider } from "../contexts/ModalContext";
import { SimulatorLeftTree } from "../components/SimulatorLeftTree";
import { SimulatorCenterCanvas } from "../components/SimulatorCenterCanvas";
import { SimulatorRightRail } from "../components/SimulatorRightRail";
import { SqlTerminalPanel } from "../components/SqlTerminalPanel";

export function SimulatorStudioPage() {
  return (
    <ModalProvider>
      <div className="flex h-screen bg-slate-950 text-slate-300 overflow-hidden font-sans">
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

        {/* Far Right Activity Bar */}
        <div className="w-16 border-l border-slate-900 flex flex-col items-center py-4 bg-slate-950 shrink-0">
          <SimulatorRightRail />
        </div>
      </div>
    </ModalProvider>
  );
}