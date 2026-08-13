/**
 * The Deploy Console's operation whitelist.
 *
 * Display-only metadata for `POST /api/admin/simulator/deploy/:key` (the
 * existing, already-shipped `admin-deploy-console.ts` route — this screen
 * does not add a new backend, it reuses that one). `key` and `command` must
 * match `DEPLOY_OPERATIONS` in `artifacts/api-server/src/routes/admin-deploy-console.ts`
 * exactly; there is no dynamic discovery, so a server-side rename has to be
 * mirrored here by hand (the same tradeoff the legacy
 * `SimulatorDeployConsolePanel.tsx` already made and documents at its own
 * `OPERATIONS` array).
 */

export type DeployOpKind = "read" | "write" | "heavy";

export interface DeployOperation {
  key: string;
  label: string;
  /** What actually runs, shown verbatim — handoff.md's "everything states its cost". */
  command: string;
  /** read: fires immediately. write/heavy: arms on the first press, runs on the second. */
  kind: DeployOpKind;
  note: string;
}

export const DEPLOY_OPERATIONS: DeployOperation[] = [
  {
    key: "git-status",
    label: "Git status",
    command: "git status --short --branch",
    kind: "read",
    note: "Read-only. Shows drift between what is running and origin.",
  },
  {
    key: "version-info",
    label: "Version info",
    command: "git log -1 --format=%H%n%an%n%ad%n%s && git rev-list --count HEAD",
    kind: "read",
    note: "Read-only. What commit is actually live.",
  },
  {
    key: "git-pull",
    label: "Git pull",
    command: "git pull --ff-only",
    kind: "write",
    note: "Fast-forward only, so a divergence fails loudly instead of merging.",
  },
  {
    key: "pnpm-install",
    label: "pnpm install",
    command: "pnpm install",
    kind: "write",
    note: "Reinstalls from the current package.json. Up to 5 minutes.",
  },
  {
    key: "pnpm-build",
    label: "pnpm build",
    command: "pnpm run build",
    kind: "write",
    note: "Production build against the checked-out code. Up to 10 minutes.",
  },
  {
    key: "full-rebuild",
    label: "Full rebuild",
    command: "git pull --ff-only && pnpm install && pnpm run build",
    kind: "heavy",
    note: "Pull, install, build. Stops at the first failure. Up to 16 minutes.",
  },
];

export function findDeployOperation(key: string): DeployOperation | undefined {
  return DEPLOY_OPERATIONS.find((op) => op.key === key);
}
