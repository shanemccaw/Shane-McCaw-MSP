// Type declarations for api-fetch.mjs -- see that file for full documentation.
// Paired by filename convention so a TS consumer importing "./api-fetch.mjs"
// (or a relative path ending in it) gets real types instead of implicit `any`.

export interface RestartState {
  cycleActive: boolean;
  phase: string | null;
  cycleId: string | null;
  lockHeld: boolean;
  lockOwnerPid: number | null;
}

/** Minimal shape of loadConfig()'s result that this module actually reads. */
export interface ApiFetchConfig {
  currentCycleFile: string;
  lockDir: string;
  [key: string]: unknown;
}

export class ApiServerUnreachableError extends Error {}

export function describeRestartState(config: ApiFetchConfig): RestartState;

export interface FetchResilientOptions {
  config: ApiFetchConfig;
  maxAttempts?: number;
  retryDelayMs?: number;
  onRetry?: (info: {
    attempt: number;
    maxAttempts: number;
    err: unknown;
    state: RestartState;
  }) => void;
}

export function fetchResilient(
  url: string | URL,
  fetchOpts?: RequestInit,
  opts?: FetchResilientOptions
): Promise<Response>;
