// artifacts/admin-panel/src/pages/SimulatorStudioPage.tsx

import React, { useState, useEffect } from "react";
import {
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Terminal,
  Radio,
  Activity,
  Layers,
  Sliders,
  Monitor,
  Clock,
  Cpu
} from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Progress } from "../components/ui/progress";
import { SimulatorLeftTree } from "../components/SimulatorLeftTree";
import { SimulatorCenterCanvas } from "../components/SimulatorCenterCanvas";
import { SimulatorPortalMirror } from "../components/SimulatorPortalMirror";
import { ModalProvider } from "../contexts/ModalContext";
import { SimulatorActivityProvider } from "../contexts/SimulatorActivityContext";
import { SqlTerminalPanel } from "../components/SqlTerminalPanel";
import { EventBusStreamTab } from "../components/EventBusStreamTab";
import { EnginesStreamTab } from "../components/EnginesStreamTab";
import { SqlSnapshotTab } from "../components/SqlSnapshotTab";

export function SimulatorStudioPage() {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [timeMultiplier, setTimeMultiplier] = useState<number>(1);
  const [simDate, setSimDate] = useState<string>(new Date().toISOString());

  // Step change dispatch log effect
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("simulator-log", {
      detail: {
        type: "info",
        message: `Simulation clock advanced: Day ${currentStep} (${simDate})`
      }
    }));
  }, [currentStep, simDate]);

  // Simulation ticking effect
  useEffect(() => {
    let timer: any = null;
    if (isReplaying) {
      const intervalMs = timeMultiplier === 60 ? 1000 : (timeMultiplier === 10 ? 3000 : 5000);
      timer = setInterval(() => {
        setCurrentStep(prev => {
          if (prev >= 90) {
            setIsReplaying(false);
            window.dispatchEvent(new CustomEvent("simulator-log", {
              detail: {
                type: "success",
                message: "Simulation run completed (Day 90 reached)."
              }
            }));
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isReplaying, timeMultiplier]);

  // Calculate dynamic simDate based on currentStep
  useEffect(() => {
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() - 90 + currentStep);
    setSimDate(baseDate.toLocaleDateString() + " " + baseDate.toLocaleTimeString());
  }, [currentStep]);

  return (
    <SimulatorActivityProvider>
      <ModalProvider>
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#090d16] font-mono text-slate-200 antialiased select-none">

          {/* 1. TOP HEADER MISSION CONTROL RIBBON */}
          <header className="flex h-12 w-full items-center justify-between border-b border-slate-800 bg-[#0c1222] px-4 shadow-sm z-20">
            <div className="flex items-center gap-3">
              <div className="relative flex h-2 w-2">
                <span className={`absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 ${isReplaying ? 'animate-ping' : ''}`}></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs uppercase tracking-wider font-black text-slate-100">SIMULATOR ENGINE STUDIO</span>
                <span className="text-[10px] text-slate-500 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded font-bold">PLATFORM_ADMIN ONLY</span>
              </div>
            </div>

            {/* Unified Clock Dynamics Node Control Area */}
            <div className="flex items-center gap-4 bg-[#060a12] border border-slate-800/80 rounded-md px-3 py-1 text-xs">
              <div className="flex items-center gap-2 border-r border-slate-800 pr-3">
                <Clock className="h-3.5 w-3.5 text-cyan-400" />
                <span className="text-slate-400 text-[11px]">VIRTUAL CLOCK:</span>
                <span className="text-cyan-400 font-bold tracking-tight">{simDate}</span>
              </div>

              {/* Hardware Style Controls */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setIsReplaying(!isReplaying)}
                  className={`p-1 rounded transition-colors ${isReplaying ? 'bg-amber-950/50 text-amber-400 border border-amber-800' : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-100'}`}
                  title={isReplaying ? "Pause Simulation" : "Start Acceleration Replay"}
                >
                  {isReplaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                </button>
                <button
                  onClick={() => setCurrentStep(prev => prev + 1)}
                  className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100 transition-colors"
                  title="Step Day Context Lookback"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => { setCurrentStep(0); setIsReplaying(false); }}
                  className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
                  title="Reset Testbed State Engine Records"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
                <span className="text-[10px] text-slate-500">SPEED:</span>
                <select
                  value={timeMultiplier}
                  onChange={(e) => setTimeMultiplier(Number(e.target.value))}
                  className="bg-slate-900 border border-slate-800 text-slate-300 text-[11px] rounded px-1 py-0.5 outline-none focus:border-cyan-500 font-bold"
                >
                  <option value={1}>1x (Realtime Mode)</option>
                  <option value={10}>10x (90 Days / 30m)</option>
                  <option value={60}>60x (90 Days / 5m)</option>
                </select>
              </div>
            </div>
          </header>

          {/* 2. THE THREE-COLUMN INTEGRATED SPLIT STUDIO CANVAS */}
          <div className="flex flex-1 w-full overflow-hidden relative">

            {/* PANEL A: LEFT PANEL — TESTBED TREE EXPLORER & OVERRIDES */}
            <aside className="w-80 h-full flex flex-col border-r border-slate-800 bg-[#0a0f1d] flex-shrink-0">
              <div className="flex items-center gap-2 border-b border-slate-800 bg-[#0c1222] px-3 py-2 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                <Sliders className="h-3 w-3 text-cyan-400" />
                <span>Testbed & API Overrides</span>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 p-2">
                <SimulatorLeftTree
                  selectedCustomerId={selectedCustomerId}
                  onSelectCustomer={setSelectedCustomerId}
                  currentStep={currentStep}
                />
              </div>
            </aside>

            {/* PANEL B: CENTER PANEL — LIVE TIMELINE REPLAY & TRACE STREAM */}
            <main className="flex-1 h-full flex flex-col bg-[#070b14] min-w-0">
              {/* Time Compression Timeline Bar */}
              <div className="bg-[#0b101c] border-b border-slate-800/60 p-2.5 flex flex-col gap-1.5 flex-shrink-0">
                <div className="flex justify-between items-center text-[10px] text-slate-400">
                  <span className="flex items-center gap-1"><Activity className="h-3 w-3 text-emerald-400" /> TIMELINE REPLAY TIMEFRAME STATE PROGRESS</span>
                  <span className="font-bold text-cyan-400">Day {currentStep} / Day 90</span>
                </div>
                <Progress value={(currentStep / 90) * 100} className="h-1.5 bg-slate-900" />
              </div>

              {/* Core Engine Scoring Grid and Evaluation Trace Container */}
              <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 p-4 space-y-4">
                <SimulatorCenterCanvas
                  customerId={selectedCustomerId}
                  simDate={simDate}
                  isReplaying={isReplaying}
                />
              </div>
            </main>

            {/* PANEL C: RIGHT PANEL — LIVE RECONCILED CUSTOMER PORTAL VIEW MIRROR */}
            <aside className="w-[480px] h-full flex flex-col border-l border-slate-800 bg-[#080d19] flex-shrink-0">
              <div className="flex items-center justify-between border-b border-slate-800 bg-[#0c1222] px-3 py-2">
                <div className="flex items-center gap-2 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                  <Monitor className="h-3 w-3 text-emerald-400" />
                  <span>Customer Portal View Mirror</span>
                </div>
                <span className="text-[9px] text-emerald-400 bg-emerald-950/60 border border-emerald-800 rounded px-1.5 font-bold tracking-tight">
                  LIVE AUTOMATIC SYNC
                </span>
              </div>

              {/* Boundary-Locked Client Rendering Sandbox Frame Mirror Area */}
              <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 p-3 bg-[#050810]">
                <SimulatorPortalMirror
                  customerId={selectedCustomerId}
                  simDate={simDate}
                />
              </div>
            </aside>

          </div>

          {/* 3. BOTTOM DRAWER PANEL — DB INSPECTION TERMINAL & SIGNAL ENGINE BUS */}
          <footer className="h-44 w-full border-t border-slate-800 bg-[#070b13] flex-shrink-0 flex flex-col z-10">
            <Tabs defaultValue="stdout" className="w-full h-full flex flex-col">

              {/* Drawer Navigation Headers */}
              <div className="bg-[#0b101c] border-b border-slate-800 h-7 flex items-center justify-between px-2">
                <TabsList className="bg-transparent h-full p-0 flex gap-1">
                  <TabsTrigger
                    value="stdout"
                    className="text-[10px] tracking-wide font-bold uppercase h-full px-3 data-[state=active]:bg-[#070b13] data-[state=active]:text-slate-100 border-x border-slate-800/40 rounded-t-sm"
                  >
                    <div className="flex items-center gap-1.5">
                      <Terminal className="h-3 w-3 text-cyan-400" />
                      <span>Telemetry Log Stream</span>
                    </div>
                  </TabsTrigger>
                  <TabsTrigger
                    value="sql_terminal"
                    className="text-[10px] tracking-wide font-bold uppercase h-full px-3 data-[state=active]:bg-[#070b13] data-[state=active]:text-slate-100 border-x border-slate-800/40 rounded-t-sm"
                  >
                    <div className="flex items-center gap-1.5">
                      <Layers className="h-3 w-3 text-purple-400" />
                      <span>SQL Snapshot Inspection</span>
                    </div>
                  </TabsTrigger>
                  <TabsTrigger
                    value="event_bus"
                    className="text-[10px] tracking-wide font-bold uppercase h-full px-3 data-[state=active]:bg-[#070b13] data-[state=active]:text-slate-100 border-x border-slate-800/40 rounded-t-sm"
                  >
                    <div className="flex items-center gap-1.5">
                      <Radio className="h-3 w-3 text-amber-400" />
                      <span>Signal Engine Bus Output</span>
                    </div>
                  </TabsTrigger>
                  <TabsTrigger
                    value="engines"
                    className="text-[10px] tracking-wide font-bold uppercase h-full px-3 data-[state=active]:bg-[#070b13] data-[state=active]:text-slate-100 border-x border-slate-800/40 rounded-t-sm"
                  >
                    <div className="flex items-center gap-1.5">
                      <Cpu className="h-3 w-3 text-teal-400" />
                      <span>Engines</span>
                    </div>
                  </TabsTrigger>
                </TabsList>

                <div className="text-[9px] text-slate-500 pr-2">
                  SESSIONID: <span className="text-slate-400">SES_TRACE_{selectedCustomerId || 'UNSET'}</span>
                </div>
              </div>

              {/* Bound Drawer Output Scrollers */}
              <div className="flex-1 bg-[#04060c] min-h-0 relative">
                <TabsContent value="stdout" className="mt-0 focus-visible:outline-none h-full">
                  <SqlTerminalPanel />
                </TabsContent>

                <TabsContent value="sql_terminal" className="mt-0 focus-visible:outline-none h-full">
                  <SqlSnapshotTab />
                </TabsContent>

                <TabsContent value="event_bus" className="mt-0 focus-visible:outline-none h-full">
                  <EventBusStreamTab />
                </TabsContent>

                <TabsContent value="engines" className="mt-0 focus-visible:outline-none h-full">
                  <EnginesStreamTab />
                </TabsContent>
              </div>

            </Tabs>
          </footer>
        </div>
      </ModalProvider>
    </SimulatorActivityProvider>
  );
}