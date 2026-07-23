import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Play, Loader2, CheckCircle2, XCircle, Rocket } from "lucide-react";

interface StepResult {
  label: string;
  command: string;
  ok: boolean;
  output: string;
}

interface DeployRunState {
  status: "idle" | "running" | "ok" | "failed";
  steps: StepResult[];
  error?: string;
}

// Fixed, real set of whitelisted operations — must match the keys in
// api-server's admin-deploy-console.ts DEPLOY_OPERATIONS exactly. There is
// deliberately no free-text command input anywhere in this panel.
const OPERATIONS: Array<{ key: string; label: string; description: string }> = [
  { key: "git-status", label: "Git Status", description: "Read-only working tree status." },
  { key: "version-info", label: "Version Info", description: "Last commit + total commit count (build-number diagnostic)." },
  { key: "git-pull", label: "Git Pull", description: "Fast-forward only pull of main." },
  { key: "pnpm-install", label: "pnpm install", description: "Reinstall workspace dependencies." },
  { key: "pnpm-build", label: "pnpm run build", description: "Typecheck + production build." },
  { key: "full-rebuild", label: "Full Rebuild", description: "git pull --ff-only → pnpm install → pnpm run build." },
];

export function SimulatorDeployConsolePanel() {
  const { fetchWithAuth } = useAuth();
  const [runs, setRuns] = useState<Record<string, DeployRunState>>({});

  const runOperation = async (key: string) => {
    setRuns(prev => ({ ...prev, [key]: { status: "running", steps: [] } }));
    try {
      const res = await fetchWithAuth(`/api/admin/simulator/deploy/${key}`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.ok) {
        setRuns(prev => ({ ...prev, [key]: { status: "ok", steps: data.steps ?? [] } }));
        toast.success(`${key} completed`);
      } else {
        setRuns(prev => ({ ...prev, [key]: { status: "failed", steps: data.steps ?? [], error: data.error ?? "Operation failed" } }));
        toast.error(data.error ?? "Operation failed");
      }
    } catch (err: any) {
      setRuns(prev => ({ ...prev, [key]: { status: "failed", steps: [], error: err.message ?? "Network error" } }));
      toast.error(err.message ?? "Network error");
    }
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full bg-background">
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Rocket className="w-4 h-4" /> Deploy Console
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          A fixed whitelist of real git/pnpm operations — there is no free-text command input here.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {OPERATIONS.map(op => {
          const run = runs[op.key];
          const isRunning = run?.status === "running";
          return (
            <div key={op.key} className="bg-card border border-border rounded-lg p-3.5 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold text-foreground">{op.label}</div>
                  <p className="text-xs text-muted-foreground mt-0.5">{op.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runOperation(op.key)}
                  disabled={isRunning}
                  className="h-7 px-3 shrink-0"
                >
                  {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                </Button>
              </div>

              {run && run.status !== "running" && (
                <div className="space-y-2">
                  <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${
                    run.status === "ok" ? "text-emerald-400" : "text-destructive"
                  }`}>
                    {run.status === "ok" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                    {run.status === "ok" ? "Succeeded" : (run.error ?? "Failed")}
                  </div>
                  <div className="bg-background border border-border rounded-md p-2.5 space-y-2 max-h-64 overflow-y-auto">
                    {run.steps.map((step, i) => (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center gap-1.5 text-[11px] font-mono text-foreground/90">
                          {step.ok ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                          ) : (
                            <XCircle className="w-3 h-3 text-destructive shrink-0" />
                          )}
                          {step.label}
                        </div>
                        {step.output && (
                          <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all bg-card border border-border rounded p-2">
                            {step.output}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
