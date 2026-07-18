// artifacts/admin-panel/src/pages/SimulatorStudioPage.tsx
//
// VS Code-style IDE shell for the Simulator Studio, on the app's GitHub-dark
// token system (bg-background / bg-card / border-border / #2F6FED primary):
//   left    — Explorer tree (scenarios + saved SQL scripts)
//   center  — working canvas (SQL / testbeds / overrides / engines)
//   right   — collapsible tabbed panel: Portal Snapshot / DB Schema
//             (collapsed by default)
//   bottom  — tabbed: Log Stream (multi-channel split panes) / Query Output
//             (results from the center canvas's SQL editor)
//   footer  — status bar

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Clock,
  PanelRight,
  PanelBottom,
  ChevronDown,
  X,
} from "lucide-react";
import type { ImperativePanelHandle } from "react-resizable-panels";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/ui/resizable";
import { SimulatorLeftTree } from "../components/SimulatorLeftTree";
import { SimulatorCenterCanvas } from "../components/SimulatorCenterCanvas";
import { SimulatorPortalSnapshot } from "../components/SimulatorPortalSnapshot";
import { SimulatorLogStream } from "../components/SimulatorLogStream";
import { SqlQueryOutput } from "../components/SqlQueryOutput";
import { EMPTY_SQL_OUTPUT, type SqlOutput } from "../components/SqlQueryCanvas";
import { LiveDbSchemaTree } from "../components/LiveDbSchemaTree";
import { ModalProvider } from "../contexts/ModalContext";
import { SimulatorActivityProvider } from "../contexts/SimulatorActivityContext";
import { TestbedProvider, useTestbedContext } from "../contexts/TestbedContext";

const RIGHT_PANEL_KEY = "simulator-right-panel-open";
const LOG_CHANNELS_KEY = "simulator-log-channels";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function SimulatorStudioPage() {
  // Providers live here so StudioShell (and every panel under it) can read
  // the shared testbed selection; TestbedProvider wraps ModalProvider because
  // the execute-scenario modal fires against the globally selected testbed.
  return (
    <TestbedProvider>
      <SimulatorActivityProvider>
        <ModalProvider>
          <StudioShell />
        </ModalProvider>
      </SimulatorActivityProvider>
    </TestbedProvider>
  );
}

// The one testbed picker. Customers are filtered on is_testbed only — a
// testbed customer doesn't have to have an MSP assigned — so the customer
// dropdown lists all testbed customers by default; picking an MSP just
// narrows it. Every panel that used to have its own picker now reads this
// selection from TestbedContext.
function TestbedHeaderPicker() {
  const {
    msps,
    customers,
    loadingMsps,
    loadingCustomers,
    selectedMspId,
    selectedCustomerId,
    setSelectedMsp,
    setSelectedCustomer,
  } = useTestbedContext();

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="font-semibold uppercase tracking-wider text-muted-foreground">Testbed</span>
      <select
        value={selectedMspId ?? ""}
        onChange={(e) => setSelectedMsp(e.target.value === "" ? null : Number(e.target.value))}
        className="max-w-36 rounded border border-border bg-background px-1 py-0.5 text-[10px] text-foreground focus:border-ring focus:outline-none"
        title="Testbed MSP"
      >
        <option value="">{loadingMsps ? "Loading MSPs…" : "-- MSP --"}</option>
        {msps.map((msp) => (
          <option key={msp.id} value={msp.id}>
            {msp.name}
          </option>
        ))}
      </select>
      <select
        value={selectedCustomerId ?? ""}
        onChange={(e) => setSelectedCustomer(e.target.value === "" ? null : Number(e.target.value))}
        className="max-w-44 rounded border border-border bg-background px-1 py-0.5 text-[10px] text-foreground focus:border-ring focus:outline-none disabled:opacity-50"
        title="Testbed customer"
      >
        <option value="">
          {loadingCustomers ? "Loading…" : customers.length === 0 ? "No testbed customers" : "-- Customer --"}
        </option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.name}
            {customer.domain ? ` (${customer.domain})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function StudioShell() {
  const { selectedCustomerId } = useTestbedContext();
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [timeMultiplier, setTimeMultiplier] = useState<number>(1);

  // Derived, not state — deriving it in a follow-up effect made every clock
  // step dispatch twice (first with the previous day's date).
  const simDate = useMemo(() => {
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() - 90 + currentStep);
    return baseDate.toLocaleDateString() + " " + baseDate.toLocaleTimeString();
  }, [currentStep]);

  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const bottomPanelRef = useRef<ImperativePanelHandle>(null);

  const [rightOpen, setRightOpen] = useState<boolean>(() => readJson(RIGHT_PANEL_KEY, false));
  const [rightTab, setRightTab] = useState<"portal" | "schema">("portal");
  const [selectedChannels, setSelectedChannels] = useState<string[]>(() => readJson(LOG_CHANNELS_KEY, []));

  // SQL output is lifted here (same pattern as selectedChannels feeding the
  // Log Stream): the center canvas's SQL editor writes it, the bottom panel's
  // Query Output tab renders it.
  const [bottomTab, setBottomTab] = useState<"logs" | "output">("logs");
  const [sqlOutput, setSqlOutput] = useState<SqlOutput>(EMPTY_SQL_OUTPUT);

  const handleSqlOutputChange = (next: SqlOutput) => {
    setSqlOutput(next);
    // Auto-switch the bottom panel to Query Output when a run starts so
    // results are visible without an extra click — except when a replay is
    // actively streaming and the user is watching the Log Stream; stealing
    // the panel mid-replay would hide exactly what they're tracking.
    if (next.isExecuting) {
      const watchingReplayLogs = isReplaying && bottomTab === "logs" && !bottomCollapsed;
      if (!watchingReplayLogs) {
        setBottomTab("output");
        bottomPanelRef.current?.expand();
      }
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(RIGHT_PANEL_KEY, JSON.stringify(rightOpen));
    } catch {}
  }, [rightOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(LOG_CHANNELS_KEY, JSON.stringify(selectedChannels));
    } catch {}
  }, [selectedChannels]);

  // Step change dispatch log effect
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("simulator-log", {
        detail: {
          type: "info",
          message: `Simulation clock advanced: Day ${currentStep} (${simDate})`,
        },
      }),
    );
  }, [currentStep, simDate]);

  // Simulation ticking effect
  useEffect(() => {
    let timer: any = null;
    if (isReplaying) {
      const intervalMs = timeMultiplier === 60 ? 1000 : timeMultiplier === 10 ? 3000 : 5000;
      timer = setInterval(() => {
        setCurrentStep((prev) => {
          if (prev >= 90) {
            setIsReplaying(false);
            window.dispatchEvent(
              new CustomEvent("simulator-log", {
                detail: {
                  type: "success",
                  message: "Simulation run completed (Day 90 reached).",
                },
              }),
            );
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

  const toggleBottomPanel = () => {
    const panel = bottomPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background font-sans text-foreground">
      {/* ── Studio toolbar ── */}
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-card px-3 select-none">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            {isReplaying && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${isReplaying ? "bg-emerald-400" : "bg-muted-foreground/60"}`} />
          </span>
          <span className="text-[11px] font-semibold tracking-wide text-foreground">Simulator Studio</span>
          <span className="rounded-sm border border-border bg-background px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
            Platform admin
          </span>
          <div className="h-4 w-px bg-border" />
          <TestbedHeaderPicker />
        </div>

        <div className="flex items-center gap-3">
          {/* Virtual clock + replay transport */}
          <div className="flex items-center gap-2 text-[11px]">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono tabular-nums text-primary">{simDate}</span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              Day {currentStep}/90
            </span>
            <div className="h-1 w-20 overflow-hidden rounded-full bg-accent">
              <div className="h-full bg-primary transition-all" style={{ width: `${(currentStep / 90) * 100}%` }} />
            </div>
          </div>

          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setIsReplaying(!isReplaying)}
              className={`rounded p-1 transition-colors ${
                isReplaying ? "bg-accent text-amber-400" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              title={isReplaying ? "Pause simulation" : "Start accelerated replay"}
            >
              {isReplaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
            </button>
            <button
              onClick={() => setCurrentStep((prev) => prev + 1)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Step one day"
            >
              <SkipForward className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                setCurrentStep(0);
                setIsReplaying(false);
              }}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
              title="Reset simulation clock"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <select
              value={timeMultiplier}
              onChange={(e) => setTimeMultiplier(Number(e.target.value))}
              className="ml-1 rounded border border-border bg-background px-1 py-0.5 text-[10px] text-foreground focus:border-ring focus:outline-none"
              title="Replay speed"
            >
              <option value={1}>1×</option>
              <option value={10}>10×</option>
              <option value={60}>60×</option>
            </select>
          </div>

          <div className="h-4 w-px bg-border" />

          {/* Layout controls — VS Code's top-right cluster */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={toggleBottomPanel}
              className={`rounded p-1 transition-colors ${
                !bottomCollapsed ? "text-primary" : "text-muted-foreground hover:text-foreground"
              } hover:bg-accent`}
              title="Toggle bottom panel"
            >
              <PanelBottom className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setRightOpen(!rightOpen)}
              className={`rounded p-1 transition-colors ${
                rightOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"
              } hover:bg-accent`}
              title="Toggle right panel (Portal Snapshot / DB Schema)"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main working area ── */}
      <div className="min-h-0 flex-1">
        {/* id/order on every panel: the right panel renders conditionally,
            and without them react-resizable-panels rebuilds the layout from
            defaults on each toggle, wiping the user's dragged sizes. */}
        <ResizablePanelGroup direction="horizontal" autoSaveId="simulator-studio-h">
          {/* Explorer */}
          <ResizablePanel id="explorer" order={1} defaultSize={17} minSize={12} maxSize={30}>
            <SimulatorLeftTree />
          </ResizablePanel>
          <ResizableHandle className="w-px bg-border" />

          {/* Center canvas + bottom panel */}
          <ResizablePanel id="center" order={2} defaultSize={rightOpen ? 59 : 83} minSize={30}>
            <ResizablePanelGroup direction="vertical" autoSaveId="simulator-studio-v">
              <ResizablePanel id="canvas" order={1} defaultSize={62} minSize={20}>
                <SimulatorCenterCanvas
                  simDate={simDate}
                  isReplaying={isReplaying}
                  sqlOutput={sqlOutput}
                  onSqlOutputChange={handleSqlOutputChange}
                />
              </ResizablePanel>
              <ResizableHandle className="h-px bg-border" />
              <ResizablePanel
                ref={bottomPanelRef}
                id="bottom-panel"
                order={2}
                defaultSize={38}
                minSize={15}
                collapsible
                collapsedSize={0}
                onCollapse={() => setBottomCollapsed(true)}
                onExpand={() => setBottomCollapsed(false)}
              >
                <div className="flex h-full min-h-0 flex-col bg-background">
                  {/* Panel tab strip — Log Stream / Query Output share the
                      bottom panel; mirrors the right panel's pattern. */}
                  <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-card px-2 select-none">
                    <div className="flex h-full min-w-0 items-center gap-1 overflow-x-auto">
                      {(
                        [
                          { key: "logs", label: "Log Stream" },
                          { key: "output", label: "Query Output" },
                        ] as const
                      ).map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => setBottomTab(key)}
                          className={`relative h-full whitespace-nowrap px-2.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                            bottomTab === key
                              ? "text-foreground after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-primary"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={toggleBottomPanel}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      title="Collapse panel"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Both tabs stay mounted so log buffers and query
                      results survive tab switches — only visibility
                      toggles. */}
                  <div className={`min-h-0 flex-1 ${bottomTab === "logs" ? "flex flex-col" : "hidden"}`}>
                    <SimulatorLogStream selectedChannels={selectedChannels} onChangeChannels={setSelectedChannels} />
                  </div>
                  <div className={`min-h-0 flex-1 ${bottomTab === "output" ? "flex flex-col" : "hidden"}`}>
                    <SqlQueryOutput output={sqlOutput} />
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          {/* Right side panel — collapsed by default. Tabbed: Portal
              Snapshot / DB Schema share the one panel. */}
          {rightOpen && (
            <>
              <ResizableHandle className="w-px bg-border" />
              <ResizablePanel id="portal-snapshot" order={3} defaultSize={24} minSize={16} maxSize={40}>
                <div className="flex h-full min-h-0 flex-col">
                  {/* Panel tab strip — mirrors the bottom panel's pattern */}
                  <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-card px-2 select-none">
                    <div className="flex h-full min-w-0 items-center gap-1 overflow-x-auto">
                      {(
                        [
                          { key: "portal", label: "Portal Snapshot" },
                          { key: "schema", label: "DB Schema" },
                        ] as const
                      ).map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => setRightTab(key)}
                          className={`relative h-full whitespace-nowrap px-2 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                            rightTab === key
                              ? "text-foreground after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-primary"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setRightOpen(false)}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      title="Close panel"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Both tabs stay mounted so snapshot state survives
                      tab switches — only visibility toggles. */}
                  <div className={`min-h-0 flex-1 ${rightTab === "portal" ? "" : "hidden"}`}>
                    <SimulatorPortalSnapshot />
                  </div>
                  <div className={`min-h-0 flex-1 overflow-hidden ${rightTab === "schema" ? "" : "hidden"}`}>
                    <LiveDbSchemaTree />
                  </div>
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      {/* ── Status bar ── */}
      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-card px-3 text-[10px] text-muted-foreground select-none">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {selectedChannels.length === 0
              ? "log stream: firehose"
              : `log stream: ${selectedChannels.length} channel${selectedChannels.length > 1 ? "s" : ""}`}
          </span>
          <span className="font-mono">
            SES_TRACE_<span className="text-foreground/70">{selectedCustomerId ?? "UNSET"}</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono tabular-nums">
            Day {currentStep}/90 · {timeMultiplier}×
          </span>
          <span className="uppercase tracking-wider">Platform admin</span>
        </div>
      </footer>
    </div>
  );
}
