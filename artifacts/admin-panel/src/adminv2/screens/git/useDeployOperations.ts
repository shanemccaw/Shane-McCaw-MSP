/**
 * Runs a Deploy Console operation and tracks its per-operation result.
 *
 * Plain `useState`, not a module-level store — every actual run happens with
 * this screen mounted (ribbon buttons under the Git tab only open the
 * screen, they never fire an operation themselves; see `screens/git/index.tsx`),
 * so there is nothing to keep alive across a mount/unmount the way the
 * shell's own `state.docs` does.
 */

import { useCallback, useState } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { logger } from "@/lib/logger";

const log = logger.child({ channel: "admin.shell" });

export interface DeployStepResult {
  label: string;
  command: string;
  ok: boolean;
  output: string;
}

export type DeployRunStatus = "idle" | "running" | "ok" | "failed";

export interface DeployRunState {
  status: DeployRunStatus;
  steps: DeployStepResult[];
  error?: string;
}

const IDLE_STATE: DeployRunState = { status: "idle", steps: [] };

export function useDeployOperations() {
  const { adminFetch } = useAdminFetch();
  const [runs, setRuns] = useState<Record<string, DeployRunState>>({});

  const run = useCallback(
    async (key: string) => {
      setRuns((prev) => ({ ...prev, [key]: { status: "running", steps: [] } }));
      try {
        const res = await adminFetch(`/api/admin/simulator/deploy/${key}`, { method: "POST" });
        const data = await res.json();
        if (res.ok && data.ok) {
          setRuns((prev) => ({ ...prev, [key]: { status: "ok", steps: data.steps ?? [] } }));
        } else {
          setRuns((prev) => ({
            ...prev,
            [key]: { status: "failed", steps: data.steps ?? [], error: data.error ?? "Operation failed" },
          }));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ operation: key, message }, "deploy console request failed");
        setRuns((prev) => ({ ...prev, [key]: { status: "failed", steps: [], error: message } }));
      }
    },
    [adminFetch],
  );

  const stateFor = useCallback((key: string): DeployRunState => runs[key] ?? IDLE_STATE, [runs]);

  return { run, stateFor };
}
