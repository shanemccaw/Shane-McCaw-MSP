import { createContext, useContext, useReducer, useCallback, type ReactNode } from "react";

// ── State Machine Types ────────────────────────────────────────────────────────

export type QuickWinState =
  | "Idle"
  | "EnteringQuickWin"
  | "Ready"
  | "RunningAutoStep"
  | "WaitingForUser"
  | "StepComplete"
  | "QuickWinComplete"
  | "EscalatingToProject"
  | "ProjectTasksView"
  | "ExitQuickWin";

export interface QuickWinItem {
  id: string;
  title: string;
  description?: string;
  category?: string;
  totalSteps?: number;
  steps?: QuickWinStep[];
}

export interface QuickWinStep {
  id: string;
  title: string;
  type: "auto" | "manual";
  description?: string;
}

export type QuickWinAction =
  | { type: "SELECT_QUICK_WIN"; payload: QuickWinItem }
  | { type: "ENTRY_COMPLETE" }
  | { type: "START_AUTO_STEP" }
  | { type: "AUTO_STEP_COMPLETE" }
  | { type: "WAIT_FOR_USER" }
  | { type: "STEP_COMPLETE" }
  | { type: "NEXT_STEP" }
  | { type: "ALL_STEPS_DONE" }
  | { type: "ESCALATE_TO_PROJECT" }
  | { type: "SET_PROJECT"; payload: { projectId: string } }
  | { type: "ESCALATION_COMPLETE" }
  | { type: "EXIT" }
  | { type: "OPEN_PROJECT" }
  | { type: "SET_SCORE"; payload: number }
  | { type: "INCREMENT_STEP" };

export interface QuickWinMachineState {
  mode: QuickWinState;
  quickWin: QuickWinItem | null;
  currentStepIndex: number;
  score: number;
  prevScore: number;
  // projectId is the only project-related state stored here.
  // Live kanban task data is fetched and owned by ProjectTasksLayer,
  // not duplicated in this state machine.
  projectId: string | null;
  openProjectOnExit: boolean;
}

const initialState: QuickWinMachineState = {
  mode: "Idle",
  quickWin: null,
  currentStepIndex: 0,
  score: 0,
  prevScore: 0,
  projectId: null,
  openProjectOnExit: false,
};

function reducer(state: QuickWinMachineState, action: QuickWinAction): QuickWinMachineState {
  switch (action.type) {
    case "SELECT_QUICK_WIN":
      return { ...initialState, mode: "EnteringQuickWin", quickWin: action.payload };

    case "ENTRY_COMPLETE":
      if (state.mode !== "EnteringQuickWin") return state;
      return { ...state, mode: "Ready" };

    case "START_AUTO_STEP":
      if (state.mode !== "Ready") return state;
      return { ...state, mode: "RunningAutoStep" };

    case "AUTO_STEP_COMPLETE":
      if (state.mode !== "RunningAutoStep") return state;
      return { ...state, mode: "StepComplete" };

    case "WAIT_FOR_USER":
      if (state.mode !== "Ready") return state;
      return { ...state, mode: "WaitingForUser" };

    case "STEP_COMPLETE":
      if (state.mode !== "WaitingForUser") return state;
      return { ...state, mode: "StepComplete" };

    case "INCREMENT_STEP":
      return { ...state, currentStepIndex: state.currentStepIndex + 1 };

    case "NEXT_STEP":
      return { ...state, mode: "Ready" };

    case "ALL_STEPS_DONE":
      return { ...state, mode: "QuickWinComplete" };

    case "ESCALATE_TO_PROJECT":
      if (state.mode !== "QuickWinComplete") return state;
      return { ...state, mode: "EscalatingToProject" };

    // SET_PROJECT: escalation resolved — store the project ID and show the
    // live Kanban task view. Task data is NOT stored here; ProjectTasksLayer
    // fetches it independently via react-query so it stays in sync with the board.
    case "SET_PROJECT":
      return {
        ...state,
        mode: "ProjectTasksView",
        projectId: action.payload.projectId,
      };

    case "OPEN_PROJECT":
      if (state.mode !== "ProjectTasksView") return state;
      return { ...state, mode: "ExitQuickWin", openProjectOnExit: true };

    case "EXIT":
      return { ...state, mode: "ExitQuickWin", openProjectOnExit: false };

    case "ESCALATION_COMPLETE":
      return { ...initialState };

    case "SET_SCORE":
      return { ...state, prevScore: state.score, score: action.payload };

    default:
      return state;
  }
}

// ── Stub Async Operations (swappable hooks) ────────────────────────────────────

export type AsyncRunAutoStep = (
  quickWin: QuickWinItem,
  stepIndex: number,
  onProgress: (pct: number) => void,
  onScoreUpdate: (score: number) => void,
  onTelemetry: (line: string) => void,
) => Promise<void>;

export type AsyncEscalateToProject = (quickWin: QuickWinItem) => Promise<string | null>;

export const defaultRunAutoStep: AsyncRunAutoStep = async (
  _qw, _idx, onProgress, onScoreUpdate, onTelemetry,
) => {
  onTelemetry("Initializing diagnostic sequence…");
  await delay(400);
  onProgress(20);
  onTelemetry("Running automated check…");
  await delay(500);
  onProgress(45);
  onTelemetry("Subsystem telemetry incoming…");
  await delay(500);
  onScoreUpdate(Math.floor(Math.random() * 20) + 65);
  onProgress(75);
  onTelemetry("Integrity check in progress…");
  await delay(400);
  onProgress(100);
  onTelemetry("All checks passed.");
  await delay(300);
};

export const defaultEscalateToProject: AsyncEscalateToProject = async (_qw) => {
  await delay(480);
  return null;
};

function delay(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// ── Context ────────────────────────────────────────────────────────────────────

interface QuickWinModeContextValue {
  state: QuickWinMachineState;
  dispatch: React.Dispatch<QuickWinAction>;
  runAutoStep: AsyncRunAutoStep;
  escalateToProject: AsyncEscalateToProject;
}

const QuickWinModeContext = createContext<QuickWinModeContextValue | null>(null);

interface QuickWinModeProviderProps {
  children: ReactNode;
  runAutoStep?: AsyncRunAutoStep;
  escalateToProject?: AsyncEscalateToProject;
}

export function QuickWinModeProvider({
  children,
  runAutoStep = defaultRunAutoStep,
  escalateToProject = defaultEscalateToProject,
}: QuickWinModeProviderProps) {
  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <QuickWinModeContext.Provider value={{ state, dispatch, runAutoStep, escalateToProject }}>
      {children}
    </QuickWinModeContext.Provider>
  );
}

export function useQuickWinMode() {
  const ctx = useContext(QuickWinModeContext);
  if (!ctx) throw new Error("useQuickWinMode must be used inside QuickWinModeProvider");
  return ctx;
}

export function useQuickWinDispatch() {
  return useQuickWinMode().dispatch;
}
