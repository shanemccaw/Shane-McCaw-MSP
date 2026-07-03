import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useQuickWinMode } from "@/context/QuickWinModeContext";
import { QW_COPY, DEFAULT_QUICK_WIN_STEPS } from "@/lib/quickWinCopy";
import { CATEGORY_TO_SCORE_KEY } from "@/hooks/useQuickWinRealImpl";
import AnimatedBackground from "./AnimatedBackground";
import CopilotAura from "@/components/wizard/CopilotAura";
import PhaseStepperBar from "./PhaseStepperBar";
import HealthPanel from "./HealthPanel";
import QueueColumn from "./QueueColumn";
import ProcessingHeroCard from "./ProcessingHeroCard";
import QuickWinFooter from "./QuickWinFooter";
import ScoreRing from "@/components/ScoreRing";
import type { ManualScriptRecord } from "@/components/ManualScriptUploadCard";
import DiagnosticScriptPanel from "./DiagnosticScriptPanel";
import type { DownloadState } from "./ActionRequiredCard";
import type { QuickWinStep } from "@/context/QuickWinModeContext";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Scorecard {
  hasProfile: boolean;
  scores: Record<string, number>;
  telemetry: Record<string, string[]>;
  subsystemsChecked: string[];
}

type SubState = "queued" | "starting" | "running" | "done";

interface KanbanTask {
  id: number;
  title: string;
  column: "backlog" | "in_progress" | "waiting_on_customer" | "completed";
  groupName: string | null;
  description: string | null;
  taskType: string | null;
  taskMetadata: Record<string, unknown> | null;
}

interface WorkflowStep {
  id: number;
  title: string;
  status: "not_started" | "in_progress" | "completed";
  order: number;
}

interface ProjectData {
  tasks: KanbanTask[];
  steps: WorkflowStep[];
}

type M365ScoreKey = "security" | "compliance" | "copilot" | "governance" | "productivity";

interface ScorecardHistoryData {
  hasData: boolean;
  latest?: Partial<Record<M365ScoreKey, number>>;
  first?: Partial<Record<M365ScoreKey, number>>;
  firstDate?: string;
  latestDate?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FullScreenWrapper() {
  const { state, dispatch, runAutoStep, escalateToProject } = useQuickWinMode();
  const { mode, quickWin, currentStepIndex, score } = state;
  const { user, fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();

  const isVisible = mode !== "Idle";
  const [mounted, setMounted] = useState(false);
  const [backdropOpacity, setBackdropOpacity] = useState(0);

  // ── Step logic state ──────────────────────────────────────────────────────
  const [progress, setProgress] = useState(0);
  const [subState, setSubState] = useState<SubState>("queued");
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [cardExiting, setCardExiting] = useState(false);
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const runnerActive = useRef(false);
  const escalationInFlight = useRef(false);

  // ── Scorecard state ───────────────────────────────────────────────────────
  const [categoryScores, setCategoryScores] = useState<Record<string, number>>({});
  const scorecardRef = useRef<Scorecard | null>(null);
  // Last score emitted by onScoreUpdate — used as fallback if scorecard cache
  // isn't ready when reconciliation runs after a step completes.
  const lastStepScoreRef = useRef<number>(0);

  // ── Health score animation (ProjectTasksView only) ────────────────────────
  // Target scores are locked in when the scorecard API first returns real data.
  // Display scores increment gradually from 0 toward target, driven by the
  // smaller of task-completion fraction and elapsed-time fraction, so the bars
  // never run ahead of actual progress.  On final step completion they snap.
  const targetScoresRef = useRef<Record<string, number>>({});
  const scoreAnimStartRef = useRef<number | null>(null);
  const [displayScores, setDisplayScores] = useState<Record<string, number>>({});
  // Mutable mirrors so intervals can read fresh data without restarting
  const kanbanTasksRef = useRef<KanbanTask[]>([]);
  const workflowStepsRef = useRef<WorkflowStep[]>([]);

  const addTelemetry = useCallback((_line: string) => {
    // Telemetry is no longer shown in the full-screen view — no-op kept
    // for API compatibility with runAutoStep
  }, []);

  // ── Presentation CTA state ───────────────────────────────────────────────────
  const [openingPresentation, setOpeningPresentation] = useState(false);

  const handleViewPresentation = useCallback(async () => {
    const pid = state.projectId ? parseInt(state.projectId, 10) : null;
    if (!pid) {
      navigate("/portal/insights");
      return;
    }
    setOpeningPresentation(true);
    try {
      const res = await fetchWithAuth("/api/portal/presentations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: pid }),
      });
      if (res.ok) {
        const { id } = await res.json() as { id: number };
        dispatch({ type: "EXIT" });
        navigate(`/portal/presentation/${id}`);
      } else {
        navigate("/portal/insights");
      }
    } catch {
      navigate("/portal/insights");
    } finally {
      setOpeningPresentation(false);
    }
  }, [state.projectId, fetchWithAuth, navigate, dispatch]);

  // ── Live: client projects (to get a project ID when escalation hasn't happened yet) ──
  const { data: portalProjects = [], isLoading: projectsLoading } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["portal-projects-for-overlay"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/projects");
      if (!res.ok) return [];
      const body = await res.json() as unknown;
      return Array.isArray(body) ? (body as Array<{ id: number; name: string }>) : [];
    },
    enabled: isVisible,
    staleTime: 60_000,
  });

  // Use ONLY state.projectId — set either by escalation (SET_PROJECT) or by
  // entry-time detection (BIND_PROJECT). We no longer fall back to
  // "first/only portal project" because that guesses incorrectly when a
  // client has multiple projects and produces a different source of truth
  // from the Kanban board.
  const kanbanProjectId = state.projectId ? parseInt(state.projectId, 10) : undefined;
  const queryClient = useQueryClient();

  // ── Live: kanban tasks + workflow steps for the project (5 s poll) ───────────
  // The API returns { tasks, steps, ... } — we parse both so that the phase
  // stepper uses real workflow step titles, not kanban task groupName values.
  const { data: projectData, isLoading: kanbanTasksLoading } = useQuery<ProjectData>({
    queryKey: ["qw-overlay-kanban", kanbanProjectId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/portal/projects/${kanbanProjectId}`);
      if (!res.ok) return { tasks: [], steps: [] };
      const body = await res.json() as { tasks?: KanbanTask[]; steps?: WorkflowStep[] };
      return { tasks: body.tasks ?? [], steps: body.steps ?? [] };
    },
    enabled: !!kanbanProjectId && isVisible,
    refetchInterval: 5_000,
    staleTime: 0,
  });
  // ── Live: M365 scorecard history — same endpoint as the portal dashboard ───
  const { data: scorecardHistory } = useQuery<ScorecardHistoryData>({
    queryKey: ["portal-scorecard-history-overlay"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/m365-scorecard-history");
      if (!res.ok) return { hasData: false };
      return res.json() as Promise<ScorecardHistoryData>;
    },
    enabled: isVisible,
    refetchInterval: 30_000,
    staleTime: 0,
  });

  // ── Simulation mock data — used when projectId === "__sim" ───────────────
  // Provides the ProjectTasksView with realistic-looking task/step/scorecard
  // data so the `/portal/diagnostic-sim` preview route demonstrates the layout.
  const IS_SIM = state.projectId === "__sim";
  const SIM_STEPS: WorkflowStep[] = [
    { id: 1, title: "Security baseline scan", status: "completed", order: 0 },
    { id: 2, title: "Policy hardening", status: "in_progress", order: 1 },
    { id: 3, title: "Compliance validation", status: "not_started", order: 2 },
  ];
  const SIM_TASKS: KanbanTask[] = [
    { id: 1, title: "Audit MFA registration coverage", column: "completed", groupName: "Security baseline scan", description: null, taskType: null, taskMetadata: null },
    { id: 2, title: "Review conditional access policies", column: "completed", groupName: "Security baseline scan", description: null, taskType: null, taskMetadata: null },
    { id: 3, title: "Identify legacy authentication blockers", column: "completed", groupName: "Security baseline scan", description: null, taskType: null, taskMetadata: null },
    { id: 4, title: "Enable MFA for all admin accounts", column: "in_progress", groupName: "Policy hardening", description: "Configuring SSPR and MFA enforcement for all privileged identities.", taskType: null, taskMetadata: null },
    { id: 5, title: "Block legacy authentication protocols", column: "backlog", groupName: "Policy hardening", description: null, taskType: null, taskMetadata: null },
    { id: 6, title: "Configure risky sign-in policies", column: "backlog", groupName: "Compliance validation", description: null, taskType: null, taskMetadata: null },
    { id: 7, title: "Enable Defender for Office 365", column: "backlog", groupName: "Compliance validation", description: null, taskType: null, taskMetadata: null },
    { id: 8, title: "Generate compliance posture report", column: "backlog", groupName: "Compliance validation", description: null, taskType: null, taskMetadata: null },
  ];
  const SIM_SCORECARD: ScorecardHistoryData = {
    hasData: true,
    latest: { compliance: 74, copilot: 58, governance: 82, productivity: 61, security: 69 },
  };
  const kanbanTasks = IS_SIM ? SIM_TASKS : (projectData?.tasks ?? []);
  const workflowSteps = IS_SIM ? SIM_STEPS : (projectData?.steps ?? []);
  const effectiveScorecardHistory = IS_SIM ? SIM_SCORECARD : scorecardHistory;

  // ── Manual scripts for the current project ───────────────────────────────────
  // Fetched whenever we're in ProjectTasksView with a known project. Only
  // awaiting_upload entries are shown — completed ones have no call to action.
  const { data: overlayManualScripts = [], refetch: refetchManualScripts } = useQuery<(ManualScriptRecord & { projectId: number })[]>({
    queryKey: ["qw-overlay-manual-scripts", kanbanProjectId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/portal/projects/${kanbanProjectId}/manual-scripts`);
      if (!res.ok) return [];
      const data = await res.json() as ManualScriptRecord[];
      return data.map(s => ({ ...s, projectId: kanbanProjectId! }));
    },
    enabled: !!kanbanProjectId && isVisible,
    refetchInterval: 15_000,
    staleTime: 0,
  });
  const pendingManualScripts = overlayManualScripts.filter(s => s.status === "awaiting_upload");
  // Tracks whether the user has dismissed all manual-script cards for this session.
  // Resets automatically when kanbanProjectId changes (new project = fresh prompts).
  const [allScriptsDismissed, setAllScriptsDismissed] = useState(false);
  useEffect(() => { setAllScriptsDismissed(false); }, [kanbanProjectId]);
  // Show the panel whenever a waiting_on_customer kanban task of type manualScript
  // exists — regardless of whether the script_run_result is awaiting_upload or
  // completed (customer still needs to mark the task done in that case).
  const manualScriptTasks = kanbanTasks.filter(
    t => t.column === "waiting_on_customer" && t.taskType === "manualScript"
  );
  const waitingManualScriptCount = manualScriptTasks.length;
  // Tasks that already have a script ready for download (scriptId present in metadata)
  const downloadableTasks = manualScriptTasks
    .map(t => {
      const cd = t.taskMetadata?.customerDownload as { scriptId?: string; scriptTitle?: string } | undefined;
      if (!cd?.scriptId) return null;
      return { taskId: t.id, scriptTitle: cd.scriptTitle ?? t.title };
    })
    .filter((x): x is { taskId: number; scriptTitle: string } => x !== null);
  const showScriptPanel = (waitingManualScriptCount > 0 || pendingManualScripts.length > 0) && !allScriptsDismissed;

  // ── Completed-task exit animation ───────────────────────────────────────────
  // We store the FULL task objects (not just IDs) so we can render ghost cards
  // even after the task has been removed from inProgressTasks. Without this,
  // the card disappears immediately instead of animating out.
  const prevKanbanTasksRef = useRef<KanbanTask[]>([]);
  const [exitingKanbanTasks, setExitingKanbanTasks] = useState<KanbanTask[]>([]);

  useEffect(() => {
    const prev = prevKanbanTasksRef.current;
    // Find tasks that just transitioned into the "completed" column
    const newlyCompleted = prev.length === 0
      ? []
      : kanbanTasks.filter(t => {
          if (t.column !== "completed") return false;
          const prior = prev.find(p => p.id === t.id);
          return prior !== undefined && prior.column !== "completed";
        });
    prevKanbanTasksRef.current = kanbanTasks;

    if (newlyCompleted.length === 0) return undefined;

    // Add ghost cards; clear them after the animation completes (450 ms)
    setExitingKanbanTasks(prev => {
      const existingIds = new Set(prev.map(t => t.id));
      return [...prev, ...newlyCompleted.filter(t => !existingIds.has(t.id))];
    });
    const completedIds = new Set(newlyCompleted.map(t => t.id));
    const timer = setTimeout(() => {
      setExitingKanbanTasks(prev => prev.filter(t => !completedIds.has(t.id)));
    }, 450);
    return () => clearTimeout(timer);
  }, [kanbanTasks]);

  // ── Live status ticker (cycles through active task titles) ──────────────────
  const [tickerIdx, setTickerIdx] = useState(0);
  const [tickerVisible, setTickerVisible] = useState(true);

  useEffect(() => {
    if (mode !== "ProjectTasksView") return undefined;
    let fadeTimer: ReturnType<typeof setTimeout>;
    const interval = setInterval(() => {
      setTickerVisible(false);
      fadeTimer = setTimeout(() => {
        setTickerIdx(i => i + 1);
        setTickerVisible(true);
      }, 400);
    }, 3000);
    return () => {
      clearInterval(interval);
      clearTimeout(fadeTimer);
    };
  }, [mode]);

  // ── Elapsed time timer ────────────────────────────────────────────────────
  const timerStartRef = useRef<number | null>(null);
  const timingSavedRef = useRef(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Start/stop the clock based on mode — persist start time in sessionStorage
  // so page refreshes don't reset the timer.
  useEffect(() => {
    if (mode !== "ProjectTasksView") {
      timerStartRef.current = null;
      timingSavedRef.current = false;
      setElapsedSeconds(0);
      return undefined;
    }

    // Derive a stable storage key from the project being viewed.
    const storageKey = kanbanProjectId ? `qw-timer-start-${kanbanProjectId}` : null;

    if (timerStartRef.current === null) {
      // Try to restore a persisted start time first.
      const stored = storageKey ? sessionStorage.getItem(storageKey) : null;
      const restored = stored ? parseInt(stored, 10) : NaN;
      const startTime = !isNaN(restored) ? restored : Date.now();
      if (storageKey && isNaN(restored)) sessionStorage.setItem(storageKey, String(startTime));
      timerStartRef.current = startTime;
    }

    const interval = setInterval(() => {
      if (timerStartRef.current !== null)
        setElapsedSeconds(Math.floor((Date.now() - timerStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [mode, kanbanProjectId]);

  // Save elapsed time to DB once when all tasks are done
  const allTasksDoneForSave = kanbanTasks.length > 0 && kanbanTasks.every(t => t.column === "completed");
  useEffect(() => {
    if (!allTasksDoneForSave || !kanbanProjectId || timingSavedRef.current) return;
    timingSavedRef.current = true;
    const secs = timerStartRef.current
      ? Math.floor((Date.now() - timerStartRef.current) / 1000)
      : elapsedSeconds;
    // Clear the persisted start so a future visit to the same project doesn't
    // inherit the old timer.
    sessionStorage.removeItem(`qw-timer-start-${kanbanProjectId}`);
    void fetchWithAuth(`/api/portal/projects/${kanbanProjectId}/timing`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elapsedSeconds: secs }),
    }).catch(() => { /* non-fatal */ });
  }, [allTasksDoneForSave, kanbanProjectId, elapsedSeconds, fetchWithAuth]);

  // ── Waiting-task mutation (mark as done) ────────────────────────────────────
  const [markingDoneId, setMarkingDoneId] = useState<number | null>(null);
  const markDoneMutation = useMutation({
    mutationFn: async (taskId: number) => {
      const res = await fetchWithAuth(`/api/portal/kanban-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: "completed" }),
      });
      if (!res.ok) throw new Error("Failed to update task");
      return res.json();
    },
    onSettled: () => {
      setMarkingDoneId(null);
      void queryClient.invalidateQueries({ queryKey: ["qw-overlay-kanban", kanbanProjectId] });
    },
  });

  const fetchScorecard = useCallback(async () => {
    if (scorecardRef.current) return;
    try {
      const res = await fetchWithAuth("/api/portal/quick-win/scorecard");
      if (res.ok) {
        const sc = (await res.json()) as Scorecard;
        scorecardRef.current = sc;
        // Intentionally NOT bulk-setting categoryScores here — scores are
        // revealed progressively as each step completes via onScoreUpdate.
      }
    } catch { /* non-fatal */ }
  }, [fetchWithAuth]);

  // Reset step state whenever a new quick win starts
  useEffect(() => {
    if (mode === "EnteringQuickWin") {
      setProgress(0);
      setSubState("queued");
      setCompletedSteps([]);
      setCardExiting(false);
      setDownloadState("idle");
      scorecardRef.current = null;
      setCategoryScores({});
    }
  }, [mode]);

  // Reset downloadState when a manual step begins (WaitingForUser)
  useEffect(() => {
    if (mode === "WaitingForUser") setDownloadState("idle");
  }, [mode, currentStepIndex]);

  // ── Mount / unmount fade ──────────────────────────────────────────────────

  useEffect(() => {
    if (isVisible && !mounted) {
      setMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setBackdropOpacity(1));
      });
      return;
    }
    if (!isVisible && mounted) {
      setBackdropOpacity(0);
      const t = setTimeout(() => setMounted(false), 240);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isVisible, mounted]);

  // ── Helper: find a matching portal project for the active quick win ──────────
  const findMatchingProject = useCallback(
    (projects: Array<{ id: number; name: string }>) => {
      const titleLower = quickWin?.title?.toLowerCase() ?? "";
      return (
        projects.find(p => p.name?.toLowerCase() === titleLower) ??
        (titleLower
          ? projects.find(
              p =>
                p.name?.toLowerCase().includes(titleLower) ||
                titleLower.includes(p.name?.toLowerCase() ?? ""),
            )
          : undefined) ??
        (projects.length === 1 ? projects[0] : undefined)
      );
    },
    [quickWin],
  );

  // ── EnteringQuickWin: detect existing project → skip diagnostic if found ───
  // Wait for the portalProjects query to resolve (projectsLoading → false)
  // before deciding. This avoids the old 400ms race where the timer fired
  // while the fetch was still in flight and the project list was empty.

  useEffect(() => {
    if (mode !== "EnteringQuickWin") return;
    // Simulation preview mode — skip project detection entirely.
    if (quickWin?.id === "__sim") { dispatch({ type: "ENTRY_COMPLETE" }); return; }
    // Still fetching — hold off until the response lands.
    if (projectsLoading) return;

    const matching = findMatchingProject(portalProjects);
    if (matching) {
      dispatch({ type: "BIND_PROJECT", payload: { projectId: String(matching.id) } });
    } else {
      dispatch({ type: "ENTRY_COMPLETE" });
    }
  }, [mode, dispatch, projectsLoading, portalProjects, findMatchingProject, quickWin]);

  // ── Mid-simulation recovery: bind project if one appears after simulation starts ──
  // If EnteringQuickWin already transitioned to Ready/RunningAutoStep/etc. before
  // portalProjects loaded, this reactive effect will bind the project and jump
  // straight to ProjectTasksView as soon as the list arrives with a match.

  useEffect(() => {
    const BINDABLE = new Set([
      "Ready", "RunningAutoStep", "WaitingForUser",
      "StepComplete", "QuickWinComplete", "Error",
    ]);
    if (!BINDABLE.has(mode)) return;
    if (state.projectId) return; // already bound — nothing to do
    if (quickWin?.id === "__sim") return; // simulation preview — never bind
    if (projectsLoading || portalProjects.length === 0) return;

    const matching = findMatchingProject(portalProjects);
    if (matching) {
      dispatch({ type: "BIND_PROJECT", payload: { projectId: String(matching.id) } });
    }
  }, [mode, state.projectId, projectsLoading, portalProjects, findMatchingProject, dispatch, quickWin]);

  // ── Mirror kanban/step data into refs so animation intervals stay stable ──
  useEffect(() => { kanbanTasksRef.current = kanbanTasks; }, [kanbanTasks]);
  useEffect(() => { workflowStepsRef.current = workflowSteps; }, [workflowSteps]);

  // ── Lock in target scores when scorecard first arrives in ProjectTasksView ─
  useEffect(() => {
    if (mode !== "ProjectTasksView") {
      targetScoresRef.current = {};
      scoreAnimStartRef.current = null;
      setDisplayScores({});
      return;
    }
    if (!effectiveScorecardHistory?.hasData || !effectiveScorecardHistory.latest) return;
    if (Object.keys(targetScoresRef.current).length > 0) return; // already locked
    const targets: Record<string, number> = {};
    for (const [k, v] of Object.entries(effectiveScorecardHistory.latest)) {
      if (v !== undefined) targets[k] = v;
    }
    if (Object.keys(targets).length > 0) {
      targetScoresRef.current = targets;
      scoreAnimStartRef.current = Date.now();
    }
  }, [mode, effectiveScorecardHistory]);

  // ── Animate display scores every 2 s toward target ────────────────────────
  // Expected session duration — Copilot Quick Win ~30 min; used only as a
  // secondary smoothing signal alongside task-completion fraction.
  const EXPECTED_SESSION_MS = 30 * 60 * 1000;
  useEffect(() => {
    if (mode !== "ProjectTasksView") return;

    const tick = (clearFn?: () => void) => {
      const targets = targetScoresRef.current;
      if (Object.keys(targets).length === 0) return;
      const tasks = kanbanTasksRef.current;
      const steps = workflowStepsRef.current;
      const totalTasks = tasks.length;
      const completedCount = tasks.filter(t => t.column === "completed").length;
      const taskFrac = totalTasks > 0 ? completedCount / totalTasks : 0;
      const elapsed = scoreAnimStartRef.current ? Date.now() - scoreAnimStartRef.current : 0;
      const timeFrac = Math.min(1, elapsed / EXPECTED_SESSION_MS);
      // When all workflow steps are done, snap immediately to full targets and stop
      const allStepsDone = steps.length > 0 && steps.every(s => s.status === "completed");
      if (allStepsDone) {
        setDisplayScores({ ...targets });
        clearFn?.();
        return;
      }
      const fraction = Math.min(taskFrac, timeFrac);
      const next: Record<string, number> = {};
      for (const [k, target] of Object.entries(targets)) {
        next[k] = Math.round(target * fraction);
      }
      setDisplayScores(next);
    };

    // Run once immediately on mount so there's no blank 2-second gap
    tick();
    let stopped = false;
    const interval = setInterval(() => tick(() => { stopped = true; clearInterval(interval); }), 2000);
    return () => { stopped = true; clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]); // intentionally omit kanbanTasks/workflowSteps — reads from refs

  // ── Ready: dispatch auto or manual step ───────────────────────────────────

  useEffect(() => {
    if (mode !== "Ready") return;
    setProgress(0);
    setSubState("queued");
    const steps: QuickWinStep[] = quickWin?.steps ?? DEFAULT_QUICK_WIN_STEPS;
    const currentStep = steps[currentStepIndex];
    if (!currentStep) return;
    if (currentStep.type === "auto") {
      dispatch({ type: "START_AUTO_STEP" });
    } else {
      dispatch({ type: "WAIT_FOR_USER" });
    }
  }, [mode, quickWin, currentStepIndex, dispatch]);

  // ── RunningAutoStep: sub-state animation + actual async runner ────────────

  useEffect(() => {
    if (mode !== "RunningAutoStep" || runnerActive.current) return;
    runnerActive.current = true;

    void fetchScorecard();

    // Animate sub-states with slight delays to match telemetry pacing
    const t1 = setTimeout(() => setSubState("starting"), 350);
    const t2 = setTimeout(() => setSubState("running"), 700);

    const category = quickWin?.category ?? "";
    const scoreKey = CATEGORY_TO_SCORE_KEY[category] ?? null;

    runAutoStep(
      quickWin!,
      currentStepIndex,
      (pct) => setProgress(pct),
      (s) => {
        lastStepScoreRef.current = s;
        dispatch({ type: "SET_SCORE", payload: s });
        // Optimistic update — animates the bar immediately while awaiting
        // the post-step reconciliation against the authoritative cache.
        if (scoreKey) {
          setCategoryScores((prev) => ({ ...prev, [scoreKey]: s }));
        }
      },
      addTelemetry,
    ).then(() => {
      setSubState("done");

      // Reconcile with the canonical scorecard cache once the step is done.
      // scorecardRef is populated by fetchScorecard() (called at step start)
      // so it should be ready by the time the async step resolves.
      // Fall back to the last onScoreUpdate value if the cache isn't ready yet.
      if (scoreKey) {
        const authoritativeScore =
          scorecardRef.current?.scores?.[scoreKey] ?? lastStepScoreRef.current;
        setCategoryScores((prev) => ({ ...prev, [scoreKey]: authoritativeScore }));
      }

      dispatch({ type: "AUTO_STEP_COMPLETE" });
      runnerActive.current = false;
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      dispatch({ type: "AUTO_STEP_ERROR", payload: message });
      runnerActive.current = false;
    });

    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [mode, quickWin, currentStepIndex, runAutoStep, dispatch, addTelemetry, fetchScorecard]);

  // ── StepComplete: card exit animation → prepend completed chip → next step ─

  useEffect(() => {
    if (mode !== "StepComplete") return undefined;

    const steps: QuickWinStep[] = quickWin?.steps ?? DEFAULT_QUICK_WIN_STEPS;
    const completedStep = steps[currentStepIndex];

    // Animate card exit
    setCardExiting(true);

    const t = setTimeout(() => {
      // Prepend completed chip
      if (completedStep) {
        setCompletedSteps((prev) => [completedStep.title, ...prev]);
      }
      setCardExiting(false);
      setSubState("queued");

      const nextIndex = currentStepIndex + 1;
      if (nextIndex >= steps.length) {
        // If Kanban data already exists for a bound project (edge case: project was
        // detected mid-diagnostic), skip QuickWinComplete and go straight to the
        // live Kanban view so we never fire ALL_STEPS_DONE while tasks are active.
        if (kanbanProjectId && kanbanTasks.length > 0) {
          dispatch({ type: "BIND_PROJECT", payload: { projectId: String(kanbanProjectId) } });
        } else {
          dispatch({ type: "ALL_STEPS_DONE" });
        }
      } else {
        dispatch({ type: "INCREMENT_STEP" });
        setTimeout(() => dispatch({ type: "NEXT_STEP" }), 24);
      }
    }, 500);

    return () => clearTimeout(t);
  }, [mode, quickWin, currentStepIndex, dispatch, kanbanProjectId, kanbanTasks]);

  // ── EscalatingToProject ───────────────────────────────────────────────────

  useEffect(() => {
    if (mode !== "EscalatingToProject") return undefined;
    if (!quickWin || escalationInFlight.current) return undefined;

    escalationInFlight.current = true;
    escalateToProject(quickWin)
      .then((newProjectId) => {
        if (newProjectId) {
          dispatch({ type: "SET_PROJECT", payload: { projectId: newProjectId } });
        } else {
          dispatch({ type: "ESCALATION_COMPLETE" });
          navigate("/portal/projects");
        }
      })
      .catch(() => {
        dispatch({ type: "ESCALATION_COMPLETE" });
        navigate("/portal/projects");
      })
      .finally(() => { escalationInFlight.current = false; });

    return undefined;
  }, [mode, quickWin, escalateToProject, dispatch, navigate]);

  // ── ExitQuickWin: fade out then reset ────────────────────────────────────

  useEffect(() => {
    if (mode !== "ExitQuickWin") return undefined;
    setBackdropOpacity(0);
    const t = setTimeout(() => {
      dispatch({ type: "ESCALATION_COMPLETE" });
      if (state.openProjectOnExit && state.projectId) {
        navigate(`/portal/projects/${state.projectId}`);
      }
    }, 240);
    return () => clearTimeout(t);
  }, [mode, dispatch, navigate, state.openProjectOnExit, state.projectId]);

  if (!mounted) return null;

  // ── Derived data ──────────────────────────────────────────────────────────

  const steps: QuickWinStep[] = quickWin?.steps ?? DEFAULT_QUICK_WIN_STEPS;
  const totalSteps = steps.length;
  const currentStep = steps[currentStepIndex] ?? steps[0];
  const stepTitles = steps.map((s) => s.title);
  const progressPct = totalSteps > 0 ? Math.round((completedSteps.length / totalSteps) * 100) : 0;
  const pendingSteps = steps.slice(currentStepIndex + 1).map((s) => s.title);
  const clientName = user?.name ?? user?.email ?? "Client";

  // Compute overall score from the consolidated scorecard (average of all 5 category scores).
  // Falls back to state.score (per-step score from the state machine) when no scorecard yet.
  const overallScore = (() => {
    const vals = Object.values(categoryScores);
    if (vals.length > 0) return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    return score;
  })();

  // Derive category from the Quick Win item (not the step — QuickWinStep has no category field)
  const currentCategory = quickWin?.category ?? "";

  const isProjectView = mode === "ProjectTasksView";

  // ── Real kanban-derived display data ──────────────────────────────────────

  const backlogTasks    = kanbanTasks.filter(t => t.column === "backlog");
  const inProgressTasks = kanbanTasks.filter(t => t.column === "in_progress");
  const waitingTasks    = kanbanTasks.filter(t => t.column === "waiting_on_customer");
  const completedKanbanTasks = kanbanTasks.filter(t => t.column === "completed");

  // Live ticker messages — cycle through active task titles with action verbs
  const tickerMessages: string[] = (() => {
    const active = inProgressTasks.length > 0 ? inProgressTasks : backlogTasks.slice(0, 6);
    if (active.length === 0) return ["Connecting to your Microsoft 365 tenant…"];
    return active.map(t => {
      const lower = t.title.toLowerCase();
      const type  = t.taskType ?? "";
      let verb = "Processing";
      if (type === "script" || lower.includes("execut") || lower.includes("graph") || lower.includes("audit") || lower.includes("scan"))
        verb = "Executing";
      else if (lower.includes("generat") || lower.includes("creat") || lower.includes("document") || lower.includes("report"))
        verb = "Generating";
      else if (lower.includes("provision") || lower.includes("deploy") || lower.includes("site"))
        verb = "Provisioning";
      else if (lower.includes("configur") || lower.includes("setup") || lower.includes("policy") || lower.includes("policies"))
        verb = "Configuring";
      else if (lower.includes("analyz") || lower.includes("review") || lower.includes("assess") || lower.includes("check"))
        verb = "Analyzing";
      else if (lower.includes("harden") || lower.includes("secur"))
        verb = "Hardening";
      return `${verb}: ${t.title}…`;
    });
  })();

  // All tasks done — gate the CTA buttons
  const allTasksDone = kanbanTasks.length > 0 &&
    backlogTasks.length === 0 &&
    inProgressTasks.length === 0 &&
    waitingTasks.length === 0;

  // Progress derived from real kanban completion
  const kanbanProgress = kanbanTasks.length > 0
    ? Math.round((completedKanbanTasks.length / kanbanTasks.length) * 100)
    : progressPct;

  // True only during the initial fetch window — before the first response
  // lands. Once projectData arrives (even as an empty task list) this is false.
  const isKanbanLoading = !IS_SIM && !!kanbanProjectId && isVisible && kanbanTasksLoading && kanbanTasks.length === 0;

  // Phases = workflow step titles (already ordered by `order`).
  // Fall back to task groupNames, then to simulation stepTitles — so the
  // stepper is never blank while data is loading.
  const kanbanPhases: string[] = (() => {
    if (workflowSteps.length > 0) return workflowSteps.map(s => s.title);
    // Fallback: unique groupNames from task list
    const seen = new Set<string>();
    const result: string[] = [];
    for (const t of kanbanTasks) {
      const g = t.groupName ?? t.title;
      if (!seen.has(g)) { seen.add(g); result.push(g); }
    }
    return result.length > 0 ? result : stepTitles;
  })();

  // Active phase = the in_progress workflow step; fall back to task column
  const activePhaseIndex = (() => {
    if (workflowSteps.length > 0) {
      const idx = workflowSteps.findIndex(s => s.status === "in_progress");
      if (idx >= 0) return idx;
      // All done or not started yet
      const doneCount = workflowSteps.filter(s => s.status === "completed").length;
      return doneCount > 0 ? doneCount - 1 : 0;
    }
    // Fallback: derive from task groupName
    const activeKanbanTask = inProgressTasks[0] ?? waitingTasks[0] ?? null;
    if (!activeKanbanTask) return completedKanbanTasks.length > 0 ? kanbanPhases.length - 1 : 0;
    const g = activeKanbanTask.groupName ?? activeKanbanTask.title;
    const idx = kanbanPhases.indexOf(g);
    return idx >= 0 ? idx : 0;
  })();

  const activePhaseCompletedCount = workflowSteps.length > 0
    ? workflowSteps.filter(s => s.status === "completed").length
    : activePhaseIndex;

  // For JSX: first in-progress or waiting task (used in the subtitle below the progress bar)
  const activeKanbanTask = inProgressTasks[0] ?? waitingTasks[0] ?? null;

  // Real M365 health scores — same data as portal dashboard
  const realCategoryScores: Record<string, number> = (() => {
    if (!scorecardHistory?.hasData || !scorecardHistory.latest) return categoryScores;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(scorecardHistory.latest)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  })();
  const realOverallScore = (() => {
    const vals = Object.values(realCategoryScores);
    if (vals.length > 0) return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    return overallScore;
  })();

  // Animated overall score from the gradually-incrementing displayScores
  const animatedOverallScore = (() => {
    const vals = Object.values(displayScores);
    if (vals.length > 0) return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    return 0;
  })();

  // Right column "next up" tasks: tasks belonging to the first not_started workflow step.
  // If workflow steps don't have matching groupNames on tasks, fall back to raw backlog slice.
  const nextStepTasks = (() => {
    const nextStep = workflowSteps.find(s => s.status === "not_started");
    if (nextStep) {
      const matched = backlogTasks.filter(t => t.groupName === nextStep.title);
      if (matched.length > 0) return matched;
    }
    return backlogTasks.slice(0, 8);
  })();


  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[10000] flex flex-col"
      style={{
        opacity: backdropOpacity,
        transition: "opacity 240ms cubic-bezier(0.42,0,0.58,1)",
        backgroundColor: "rgb(248,249,251)",
      }}
    >
      {/* 3D Torus Knot Background */}
      <AnimatedBackground />

      {/* Screen-edge Copilot Aura — brand colour glow around the perimeter */}
      <CopilotAura />

      {/* Close button — always visible */}
      <button
        onClick={() => dispatch({ type: "EXIT" })}
        className="fixed top-10 right-10 z-[10001] w-10 h-10 flex items-center justify-center rounded-full bg-white/80 border border-black/5 text-black/50 hover:bg-white hover:text-black/80 shadow-sm"
        style={{ backdropFilter: "blur(8px)", transition: "all 200ms" }}
        aria-label="Close"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* ── Project Tasks View — full-screen three-column diagnostic layout ── */}
      {isProjectView && (
        <main className="flex-1 relative z-10 flex flex-col items-center justify-start px-6 sm:px-10 pt-4 pb-2 overflow-y-auto min-h-0">

          {/* Header: badge + title + phase stepper + progress bar */}
          <div className="w-full max-w-6xl mb-5">
            <div className="flex flex-col items-center gap-5">
              {/* Badge + elapsed */}
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0078D4]/10 border border-[#0078D4]/20 text-[#0078D4] text-[11px] font-bold backdrop-blur-md">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] animate-pulse" />
                  ACTIVE DIAGNOSTIC SESSION
                </div>
                <span className="text-[11px] font-mono text-black/30">
                  ⏱ {String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:{String(elapsedSeconds % 60).padStart(2, "0")}
                </span>
              </div>

              {/* Title */}
              <h1 className="text-[26px] font-bold text-[#191c1e] tracking-tight leading-tight text-center">
                {quickWin?.title ?? "Your Project"}
              </h1>

              {/* Phase stepper — real WorkflowStep records */}
              <div className="w-full">
                <PhaseStepperBar
                  steps={kanbanPhases.length > 0 ? kanbanPhases : ["Provisioning", "Configuration", "Validation"]}
                  activeIndex={activePhaseIndex}
                  completedCount={activePhaseCompletedCount}
                />
              </div>

              {/* Velocity progress bar */}
              <div className="w-full space-y-2">
                <div className="flex justify-between items-end">
                  <span className="text-[11px] font-bold text-[#0078D4] uppercase tracking-widest">Project Completion</span>
                  <span className="text-lg font-semibold text-[#0078D4]">
                    {completedKanbanTasks.length}
                    <span className="text-sm font-medium text-black/40 ml-1">/ {kanbanTasks.length} tasks</span>
                  </span>
                </div>
                <div className="h-3 w-full bg-[#0078D4]/10 rounded-full overflow-hidden relative border border-[#0078D4]/5">
                  <div
                    className="absolute inset-y-0 left-0 bg-[#0078D4] shadow-[0_0_12px_rgba(0,95,170,0.4)] rounded-full"
                    style={{ width: `${kanbanProgress}%`, transition: "width 800ms cubic-bezier(0.42,0,0.58,1)" }}
                  >
                    <div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite]" />
                  </div>
                </div>
                <p className="text-[13px] text-black/40">
                  {activeKanbanTask ? (
                    <>Currently running{" "}<span className="text-[#0078D4] font-semibold">{activeKanbanTask.title}</span>.</>
                  ) : allTasksDone ? (
                    "All tasks complete."
                  ) : (
                    "Scripts queued — starting soon."
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Health Panel — scores animate gradually from 0 toward real targets */}
          <HealthPanel
            overallScore={animatedOverallScore}
            categoryScores={displayScores}
            scanning={Object.keys(displayScores).length === 0}
          />

          {/* Three-column task grid */}
          <div className="w-full max-w-6xl grid grid-cols-12 gap-5 flex-1 min-h-0 mb-2">

            {/* ── LEFT: Completed tasks (small, muted) ── */}
            <div className="col-span-3 flex flex-col gap-2 min-h-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-black/30 shrink-0 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                Done · {completedKanbanTasks.length}
              </p>
              <div className="flex flex-col gap-1.5 overflow-y-auto flex-1 pr-0.5">
                {completedKanbanTasks.length === 0 && (
                  <p className="text-[11px] text-black/20 italic mt-2">Tasks complete here as scripts run.</p>
                )}
                {completedKanbanTasks.map(task => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/50 ring-1 ring-black/5 border-l-2 border-l-emerald-400"
                  >
                    <div className="w-3.5 h-3.5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                      <svg className="w-2 h-2 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <p className="text-[11px] font-medium text-[#0A2540]/45 line-through truncate leading-snug">{task.title}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── CENTER: Active tasks — in_progress + waiting_on_customer ── */}
            <div className="col-span-6 flex flex-col gap-3 min-h-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#0078D4] shrink-0 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] animate-pulse inline-block" />
                Active · {inProgressTasks.length + waitingTasks.length}
              </p>

              {/* Manual script panel when applicable */}
              {showScriptPanel && (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <DiagnosticScriptPanel
                    scripts={overlayManualScripts}
                    waitingManualScriptCount={waitingManualScriptCount}
                    downloadableTasks={downloadableTasks}
                    onCompleted={() => void refetchManualScripts()}
                    onAllDismissed={() => setAllScriptsDismissed(true)}
                  />
                </div>
              )}

              {!showScriptPanel && (
                <div className="flex flex-col gap-4 overflow-y-auto flex-1 pr-0.5">
                  {/* Loading state */}
                  {kanbanTasks.length === 0 && (
                    <div className="flex items-center gap-3 py-10 justify-center">
                      <div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm text-black/40">Loading tasks…</p>
                    </div>
                  )}

                  {/* Exit-animation ghost cards */}
                  {exitingKanbanTasks.map(task => (
                    <ProcessingHeroCard
                      key={`exit-${task.id}`}
                      title={task.title}
                      description={task.description ?? undefined}
                      category={currentCategory}
                      subState="done"
                      isExiting={true}
                    />
                  ))}

                  {/* In-progress cards */}
                  {inProgressTasks.map(task => (
                    <ProcessingHeroCard
                      key={task.id}
                      title={task.title}
                      description={task.description ?? undefined}
                      category={currentCategory}
                      subState="running"
                      isExiting={false}
                    />
                  ))}

                  {/* Waiting-on-customer cards — bold "Action Required" treatment */}
                  {waitingTasks.map(task => {
                    const dl = (task.taskMetadata?.customerDownload ?? null) as
                      | { scriptId?: string; scriptTitle?: string }
                      | null;
                    return (
                      <div
                        key={task.id}
                        className="rounded-xl p-6 flex flex-col border border-amber-300/60 bg-amber-50/80 shadow-lg gap-3"
                        style={{ backdropFilter: "blur(12px)" }}
                      >
                        <div className="flex items-center gap-2">
                          <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-[11px] font-bold text-amber-700 uppercase tracking-widest">Action Required</span>
                        </div>
                        <p className="text-base font-bold text-[#0A2540]">{task.title}</p>
                        {task.description && (
                          <p className="text-xs text-black/50 leading-snug">{task.description}</p>
                        )}
                        <div className="pt-1">
                          {dl?.scriptId ? (
                            <button
                              onClick={async () => {
                                try {
                                  const res = await fetchWithAuth(`/api/portal/tasks/${task.id}/download-script`);
                                  if (!res.ok) throw new Error("Download failed");
                                  const blob = await res.blob();
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = url;
                                  const cd = res.headers.get("content-disposition") ?? "";
                                  const match = /filename="?([^"]+)"?/.exec(cd);
                                  a.download = match?.[1] ?? `script-${task.id}.ps1`;
                                  a.click();
                                  setTimeout(() => URL.revokeObjectURL(url), 10_000);
                                } catch { /* non-fatal */ }
                              }}
                              className="inline-flex items-center gap-2 text-xs font-bold text-[#0078D4] hover:underline"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              {dl.scriptTitle ?? "Download Script"}
                            </button>
                          ) : (
                            <button
                              onClick={() => { setMarkingDoneId(task.id); markDoneMutation.mutate(task.id); }}
                              disabled={markingDoneId === task.id}
                              className="text-xs font-bold px-4 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                            >
                              {markingDoneId === task.id ? "Saving…" : "Mark as Done"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Queued — nothing active yet */}
                  {kanbanTasks.length > 0 && inProgressTasks.length === 0 && waitingTasks.length === 0 && !allTasksDone && (
                    <div className="flex flex-col items-center gap-3 py-10">
                      <div className="w-6 h-6 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm text-black/40">Scripts queued — waiting to start…</p>
                    </div>
                  )}

                  {/* All done */}
                  {allTasksDone && (
                    <div className="flex flex-col items-center gap-5 py-8">
                      <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                        <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-[#0A2540]">All tasks complete!</p>
                        <p className="text-sm text-black/40 mt-1">Your M365 environment has been configured.</p>
                      </div>
                      <div className="flex flex-col gap-2.5 w-full max-w-xs">
                        <button
                          onClick={() => void handleViewPresentation()}
                          disabled={openingPresentation}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#0078D4]/90 active:scale-[0.98] shadow-lg shadow-[#0078D4]/20 disabled:opacity-60"
                          style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
                        >
                          {openingPresentation ? (
                            <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Opening…</>
                          ) : (
                            <>
                              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              View Deliverables &amp; SOW
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => { dispatch({ type: "EXIT" }); navigate("/portal/services"); }}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#0A2540] text-white font-bold text-sm hover:bg-[#0A2540]/90 active:scale-[0.98]"
                          style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
                        >
                          Purchase Full Plan
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── RIGHT: Next-up tasks (small, muted, from the first not_started step) ── */}
            <div className="col-span-3 flex flex-col gap-2 min-h-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-black/30 shrink-0 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full border border-black/20 inline-block" />
                Up Next · {nextStepTasks.length}
              </p>
              <div className="flex flex-col gap-1.5 overflow-y-auto flex-1 pr-0.5">
                {nextStepTasks.map(task => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/30 ring-1 ring-black/5 border border-dashed border-[#0078D4]/20"
                  >
                    <div className="w-3.5 h-3.5 rounded-full border border-[#0078D4]/25 flex items-center justify-center flex-shrink-0">
                      <div className="w-1 h-1 rounded-full bg-[#0078D4]/30" />
                    </div>
                    <p className="text-[11px] font-medium text-[#0A2540]/35 truncate leading-snug">{task.title}</p>
                  </div>
                ))}
                {nextStepTasks.length === 0 && !allTasksDone && (
                  <p className="text-[11px] text-black/20 italic mt-2">Next workflow step tasks appear here.</p>
                )}
                {allTasksDone && (
                  <p className="text-[11px] text-black/20 italic mt-2">All workflow steps complete.</p>
                )}
              </div>
            </div>
          </div>
        </main>
      )}

      {/* ── Main Full-Screen Layout ── */}
      {!isProjectView && (
        <main className="flex-1 relative z-10 flex flex-col items-center justify-start px-6 sm:px-12 pt-4 pb-4 overflow-y-auto">

          {/* ── EnteringQuickWin: loading pulse ── */}
          {mode === "EnteringQuickWin" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div className="w-12 h-12 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-bold text-[#0A2540]">{QW_COPY.entering}</p>
            </div>
          )}

          {/* ── QuickWinComplete: summary ── */}
          {mode === "QuickWinComplete" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 max-w-md mx-auto text-center">
              <ScoreRing score={score} size={140} />
              <div>
                <h2 className="text-2xl font-black text-[#0A2540]">{QW_COPY.complete.heading}</h2>
                <p className="text-sm text-black/50 mt-1">{QW_COPY.complete.subtext}</p>
              </div>
              <div className="flex flex-col gap-3 w-full">
                {/* Primary CTA: view the full presentation deck */}
                <button
                  onClick={() => void handleViewPresentation()}
                  disabled={openingPresentation}
                  className="w-full px-5 py-3.5 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#0078D4]/90 active:scale-[0.98] shadow-lg shadow-[#0078D4]/20 flex items-center justify-center gap-2"
                  style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
                >
                  {openingPresentation ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Opening…
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      View Your Presentation
                    </>
                  )}
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={() => dispatch({ type: "ESCALATE_TO_PROJECT" })}
                    className="flex-1 px-5 py-3 rounded-xl border border-[#0078D4]/40 text-[#0078D4] font-bold text-sm hover:bg-[#0078D4]/5 active:scale-[0.98]"
                    style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
                  >
                    {QW_COPY.complete.escalateBtn}
                  </button>
                  <button
                    onClick={() => dispatch({ type: "EXIT" })}
                    className="flex-1 px-5 py-3 rounded-xl border border-black/10 text-[#0A2540] font-bold text-sm hover:bg-black/5 active:scale-[0.98]"
                    style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
                  >
                    {QW_COPY.complete.exitBtn}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── EscalatingToProject ── */}
          {mode === "EscalatingToProject" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div className="w-10 h-10 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-bold text-[#0A2540]">Creating your project…</p>
            </div>
          )}

          {/* ── Error ── */}
          {mode === "Error" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 max-w-md mx-auto text-center">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <p className="text-lg font-black text-[#0A2540]">Step failed</p>
                <p className="text-sm text-black/50 mt-1 max-w-xs mx-auto break-words">
                  {state.errorMessage ?? "An unexpected error occurred during the automated step."}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => dispatch({ type: "RETRY_STEP" })}
                  className="px-5 py-3 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#0078D4]/90"
                  style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
                >
                  Retry step
                </button>
                <button
                  onClick={() => dispatch({ type: "EXIT" })}
                  className="px-5 py-3 rounded-xl border border-black/10 text-[#0A2540] font-bold text-sm hover:bg-black/5"
                  style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
                >
                  Exit
                </button>
              </div>
            </div>
          )}

          {/* ── Main diagnostic layout (Running / WaitingForUser / StepComplete / Ready) ── */}
          {(mode === "RunningAutoStep" ||
            mode === "WaitingForUser" ||
            mode === "StepComplete" ||
            mode === "Ready") && (
            <>
              {/* Header */}
              <div className="w-full max-w-4xl text-center space-y-6 mb-6">
                <div className="flex flex-col items-center gap-6 mb-2 relative">
                  {/* Badge */}
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0078D4]/10 border border-[#0078D4]/20 text-[#0078D4] text-[11px] font-bold backdrop-blur-md">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] animate-pulse" />
                    ACTIVE DIAGNOSTIC SESSION
                  </div>

                  {/* Title = active Quick Win project name */}
                  <h1 className="text-[28px] font-bold text-[#191c1e] tracking-tight leading-tight">
                    {quickWin?.title ?? "M365 Diagnostic"}
                  </h1>

                  {/* Phase stepper — kanban group names as phases */}
                  <PhaseStepperBar
                    steps={kanbanPhases.length > 0 ? kanbanPhases : stepTitles}
                    activeIndex={activePhaseIndex}
                    completedCount={activePhaseCompletedCount}
                  />

                  {/* Velocity progress bar */}
                  <div className="w-full space-y-3">
                    <div className="flex justify-between items-end">
                      <span className="text-[11px] font-bold text-[#0078D4] uppercase tracking-widest">
                        Project Completion
                      </span>
                      <span className="text-xl font-semibold text-[#0078D4]">
                        {completedKanbanTasks.length}
                        <span className="text-sm font-medium text-black/40 ml-1">
                          / {kanbanTasks.length} tasks
                        </span>
                      </span>
                    </div>
                    <div className="h-3 w-full bg-[#0078D4]/10 rounded-full overflow-hidden relative border border-[#0078D4]/5">
                      <div
                        className="absolute inset-y-0 left-0 bg-[#0078D4] shadow-[0_0_12px_rgba(0,95,170,0.4)] rounded-full"
                        style={{
                          width: `${kanbanProgress}%`,
                          transition: "width 800ms cubic-bezier(0.42,0,0.58,1)",
                        }}
                      >
                        <div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite]" />
                      </div>
                    </div>
                    <p className="text-[14px] text-black/50 mt-1">
                      {activeKanbanTask ? (
                        <>Currently running{" "}
                          <span className="text-[#0078D4] font-semibold">{activeKanbanTask.title}</span>.
                        </>
                      ) : completedKanbanTasks.length === kanbanTasks.length && kanbanTasks.length > 0 ? (
                        "All tasks complete."
                      ) : (
                        "Scripts queued — starting soon."
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Consolidated Health Panel — real M365 scorecard scores */}
              <HealthPanel
                overallScore={realOverallScore}
                categoryScores={realCategoryScores}
                scanning={Object.keys(realCategoryScores).length === 0}
              />

              {/* Kanban 12-col grid */}
              <div className="w-full max-w-7xl grid grid-cols-12 gap-8 relative flex-1 mb-4">

                {/* Centre (col-span-9): Live kanban cards — horizontal scroll row */}
                <div className="col-span-12 lg:col-span-9 relative flex flex-col justify-center">

                  {/* Loading: no project tasks yet */}
                  {kanbanTasks.length === 0 && (
                    <div className="flex items-center gap-3 py-12 justify-center">
                      <div className="w-6 h-6 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      <p className="text-sm text-black/50">Loading tasks…</p>
                    </div>
                  )}

                  {/* Horizontal scroll row: in-progress + waiting cards side-by-side */}
                  {(inProgressTasks.length > 0 || waitingTasks.length > 0) && (
                    <div className="relative">
                      {/* Scroll container */}
                      <div
                        className="flex flex-row gap-5 overflow-x-auto pb-3 no-scrollbar"
                        style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
                      >
                        {/* Ghost cards: tasks that just moved to completed,
                            held here for 450 ms so the exit animation plays.
                            These are rendered BEFORE the live in-progress list
                            so they appear in-place while fading/sliding out. */}
                        {exitingKanbanTasks.map(task => (
                          <div key={`exit-${task.id}`} className="flex-shrink-0" style={{ scrollSnapAlign: "start" }}>
                            <ProcessingHeroCard
                              title={task.title}
                              description={task.description ?? undefined}
                              category={currentCategory}
                              subState="done"
                              isExiting={true}
                            />
                          </div>
                        ))}

                        {/* Live in-progress tasks */}
                        {inProgressTasks.map(task => (
                          <div key={task.id} className="flex-shrink-0" style={{ scrollSnapAlign: "start" }}>
                            <ProcessingHeroCard
                              title={task.title}
                              description={task.description ?? undefined}
                              category={currentCategory}
                              subState="running"
                              isExiting={false}
                            />
                          </div>
                        ))}

                        {/* Waiting-on-customer tasks */}
                        {waitingTasks.map(task => {
                          const dl = (task.taskMetadata?.customerDownload ?? null) as
                            | { scriptId?: string; scriptTitle?: string }
                            | null;
                          return (
                            <div key={task.id} className="flex-shrink-0" style={{ scrollSnapAlign: "start" }}>
                              <div
                                className="rounded-xl p-6 flex flex-col w-[340px] min-h-[300px] border border-amber-300/50 bg-amber-50/80 shadow-lg gap-3"
                                style={{ backdropFilter: "blur(12px)" }}
                              >
                                <div className="flex items-center gap-2">
                                  <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  <span className="text-[11px] font-bold text-amber-700 uppercase tracking-widest">Action Required</span>
                                </div>
                                <p className="text-base font-semibold text-[#0A2540]">{task.title}</p>
                                {task.description && (
                                  <p className="text-xs text-black/50 leading-snug">{task.description}</p>
                                )}
                                <div className="pt-1">
                                  {dl?.scriptId ? (
                                    <button
                                      onClick={async () => {
                                        try {
                                          const res = await fetchWithAuth(`/api/portal/tasks/${task.id}/download-script`);
                                          if (!res.ok) throw new Error("Download failed");
                                          const blob = await res.blob();
                                          const url = URL.createObjectURL(blob);
                                          const a = document.createElement("a");
                                          a.href = url;
                                          const cd = res.headers.get("content-disposition") ?? "";
                                          const match = /filename="?([^"]+)"?/.exec(cd);
                                          a.download = match?.[1] ?? `script-${task.id}.ps1`;
                                          a.click();
                                          setTimeout(() => URL.revokeObjectURL(url), 10_000);
                                        } catch { /* non-fatal */ }
                                      }}
                                      className="inline-flex items-center gap-2 text-xs font-bold text-[#0078D4] hover:underline"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                      </svg>
                                      {dl.scriptTitle ?? "Download Script"}
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        setMarkingDoneId(task.id);
                                        markDoneMutation.mutate(task.id);
                                      }}
                                      disabled={markingDoneId === task.id}
                                      className="text-xs font-bold px-4 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                                    >
                                      {markingDoneId === task.id ? "Saving…" : "Mark as Done"}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Right-edge fade-out gradient (only meaningful when cards overflow) */}
                      <div
                        className="pointer-events-none absolute inset-y-0 right-0 w-24"
                        style={{ background: "linear-gradient(to right, transparent, rgba(248,249,251,0.92))" }}
                      />
                    </div>
                  )}

                  {/* Tasks exist but nothing active yet */}
                  {kanbanTasks.length > 0 &&
                    inProgressTasks.length === 0 &&
                    waitingTasks.length === 0 &&
                    completedKanbanTasks.length < kanbanTasks.length && (
                    <div className="flex flex-col items-center gap-3 py-12 text-center">
                      <div className="w-6 h-6 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      <p className="text-sm text-black/50">Scripts queued — waiting to start…</p>
                    </div>
                  )}

                  {/* All tasks complete */}
                  {kanbanTasks.length > 0 &&
                    completedKanbanTasks.length === kanbanTasks.length && (
                    <div className="flex flex-col items-center gap-4 py-12 text-center">
                      <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                        <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-[#0A2540]">All tasks complete!</p>
                        <p className="text-sm text-black/50 mt-1">Your M365 environment has been configured.</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right: Backlog tasks */}
                <QueueColumn pendingSteps={backlogTasks.map(t => t.title)} />
              </div>
            </>
          )}
        </main>
      )}

      {/* Pinned footer — shown in both simulation and ProjectTasksView */}
      {mode !== "EnteringQuickWin" && (
        <QuickWinFooter
          progressPct={kanbanProgress}
          completedCount={completedKanbanTasks.length}
          totalCount={isProjectView && kanbanTasks.length > 0 ? kanbanTasks.length : undefined}
          clientName={clientName}
          clientAvatarUrl={undefined}
          label={isProjectView ? "PROJECT PROGRESS" : "QUICK WIN PROGRESS"}
          isLoading={isKanbanLoading}
        />
      )}
    </div>
  );
}
