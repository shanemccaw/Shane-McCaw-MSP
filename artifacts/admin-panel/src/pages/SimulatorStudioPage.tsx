import React, { useState } from "react";
import { FlaskConical, Terminal, GitBranch, Database, Zap, RefreshCw } from "lucide-react";
import { SimulatorLeftTree } from "../components/SimulatorLeftTree";
import { SimulatorCenterCanvas } from "../components/SimulatorCenterCanvas";
import { SimulatorRightRail } from "../components/SimulatorRightRail";
import { SqlTerminalPanel } from "../components/SqlTerminalPanel";

export function SimulatorStudioPage() {
  const [activeTab, setActiveTab] = useState("simulator");

  return (
    <div className="flex h-screen bg-slate-950 text-slate-300 overflow-hidden font-sans">
      {/* Left Tree Explorer */}
      <div className="w-64 border-r border-slate-800 flex flex-col">
        <div className="p-3 border-b border-slate-800 font-bold text-xs uppercase tracking-wider text-slate-500">Workspace</div>
        <SimulatorLeftTree />
      </div>

      {/* Center Main Work Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <SimulatorCenterCanvas />
        {/* Bottom Panel Drawer (Log Stream & SQL Terminal) */}
        <div className="h-64 border-t border-slate-800">
          <SqlTerminalPanel />
        </div>
      </div>

      {/* Far Right Activity Bar */}
      <div className="w-16 border-l border-slate-800 flex flex-col items-center py-4 space-y-6">
        <SimulatorRightRail />
      </div>
    </div>
  );
}