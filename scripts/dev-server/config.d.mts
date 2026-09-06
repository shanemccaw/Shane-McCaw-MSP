// Type declarations for config.mjs -- see that file for full documentation.
// Paired by filename convention so a TS consumer importing "./config.mjs" (or a
// relative path ending in it) gets real types instead of implicit `any`.

export interface DevServerConfig {
  mainRepoRoot: string;
  stateDir: string;
  lockDir: string;
  queueDir: string;
  claimedDir: string;
  cyclesLog: string;
  cleanupsLog: string;
  currentCycleFile: string;
  serverMetaFile: string;
  restartsLog: string;
  buildSetsDir: string;
  buildSetsLog: string;
  worktreesDir: string;
  restartHoldsDir: string;
  serverWorktree: string;
  serverBranch: string;
  baseRef: string;
  devAllPath: string;
  devAllLogDir: string;
  apiPort: number;
  heartbeatMs: number;
  staleLockMs: number;
  acquireBackoffMs: number;
  maxWaitMs: number;
  restartStopTimeoutMs: number;
  readyTimeoutMs: number;
  buildSetStaleMs: number;
  restartHoldDefaultTtlMs: number;
  restartHoldMaxWaitMs: number;
  setStopUnneeded: boolean;
  fakeRestart: boolean;
  serverWorktreeExists: boolean;
  [key: string]: unknown;
}

export function loadConfig(opts?: { cwd?: string }): DevServerConfig;
export function isWindows(): boolean;
