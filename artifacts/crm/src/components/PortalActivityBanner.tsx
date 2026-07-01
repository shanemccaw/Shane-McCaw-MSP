import { useMemo } from "react";
import type { AutomationHistoryRun } from "./RecentAutomationPanel";

interface Project {
  id: number;
  title: string;
  status: string;
  currentTask: { stepNumber: number; totalSteps: number; title: string } | null;
}

interface ClientService {
  cs: { status: string };
}

interface Props {
  projects: Project[];
  clientServices: ClientService[];
  automationRuns: AutomationHistoryRun[];
  automationRunning: boolean;
}

function deriveStatus(
  projects: Project[],
  clientServices: ClientService[],
  automationRuns: AutomationHistoryRun[],
  automationRunning: boolean,
): { active: boolean; pulse: boolean; message: string } | null {
  // 1. Active automation run takes top priority
  if (automationRunning) {
    const latest = automationRuns[0];
    const pkg = latest?.packageTitle ? `"${latest.packageTitle}"` : "an automation package";
    const steps = latest?.modulesTotal > 0
      ? ` (step ${latest.modulesCompleted + 1} of ${latest.modulesTotal})`
      : "";
    return { active: true, pulse: true, message: `Running ${pkg}${steps} on your tenant — results will appear below when complete.` };
  }

  // 2. Recent automation run (completed within last 24 hours)
  const recentCompleted = automationRuns.find(r => {
    if (r.status !== "completed" || !r.finishedAt) return false;
    return Date.now() - new Date(r.finishedAt).getTime() < 24 * 60 * 60 * 1000;
  });
  if (recentCompleted) {
    const pkg = recentCompleted.packageTitle ? `${recentCompleted.packageTitle} scan` : "automation run";
    const when = (() => {
      if (!recentCompleted.finishedAt) return "recently";
      const diffMs = Date.now() - new Date(recentCompleted.finishedAt).getTime();
      const h = Math.floor(diffMs / 3600000);
      const m = Math.floor(diffMs / 60000);
      if (m < 1) return "just now";
      if (m < 60) return `${m} minutes ago`;
      return `${h} hour${h !== 1 ? "s" : ""} ago`;
    })();
    return { active: true, pulse: false, message: `Your ${pkg} completed ${when} — results are below.` };
  }

  // 3. Project with in-progress task
  const activeProject = projects.find(p => p.status === "active" && p.currentTask);
  if (activeProject?.currentTask) {
    const t = activeProject.currentTask;
    return { active: true, pulse: false, message: `"${activeProject.title}" is underway — Step ${t.stepNumber} of ${t.totalSteps}: ${t.title}.` };
  }

  // 4. Recently queued automation run (pending within last 6 hours)
  const recentFailed = automationRuns.find(r => {
    if (r.status !== "failed" || !r.finishedAt) return false;
    return Date.now() - new Date(r.finishedAt).getTime() < 6 * 60 * 60 * 1000;
  });
  if (recentFailed) {
    const pkg = recentFailed.packageTitle ? `"${recentFailed.packageTitle}"` : "An automation run";
    return { active: true, pulse: false, message: `${pkg} encountered an issue — Shane's team has been notified and will follow up.` };
  }

  // 5. Paused / on-hold services (not yet activated)
  const pausedService = clientServices.find(s => s.cs.status === "paused");
  if (pausedService) {
    return { active: true, pulse: false, message: "A service on your account is paused — Shane's team will review and activate it shortly." };
  }

  return null;
}

export default function PortalActivityBanner({ projects, clientServices, automationRuns, automationRunning }: Props) {
  const status = useMemo(
    () => deriveStatus(projects, clientServices, automationRuns, automationRunning),
    [projects, clientServices, automationRuns, automationRunning],
  );

  if (!status) return null;

  return (
    <div className="rounded-xl border border-[#0078D4]/20 bg-[#0078D4]/5 px-4 py-3.5 flex items-start gap-3">
      <div className="flex items-center justify-center flex-shrink-0 mt-0.5">
        {status.pulse ? (
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0078D4] opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#0078D4]" />
          </span>
        ) : (
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        )}
      </div>
      <p className="text-sm text-[#0A2540] font-medium leading-snug">{status.message}</p>
    </div>
  );
}
