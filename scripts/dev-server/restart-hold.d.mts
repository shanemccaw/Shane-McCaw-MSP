// Type declarations for restart-hold.mjs -- see that file for full documentation.
// Paired by filename convention so a TS consumer importing "./restart-hold.mjs"
// (or a relative path ending in it) gets real types instead of implicit `any`.

export interface RestartHold {
  name: string;
  holder: string;
  pid: number;
  acquiredAt: number;
  heartbeatAt: number;
  ttlMs: number;
}

/** Minimal shape of loadConfig()'s result that this module actually reads. */
export interface RestartHoldConfig {
  restartHoldsDir: string;
  restartHoldDefaultTtlMs: number;
  [key: string]: unknown;
}

export function holdPath(config: RestartHoldConfig, name: string): string;
export function readHold(config: RestartHoldConfig, name: string): RestartHold | null;
export function isExpired(hold: RestartHold | null, now?: number): boolean;
export function acquireHold(
  config: RestartHoldConfig,
  name: string,
  opts?: { ttlMs?: number; holder?: string }
): RestartHold;
export function renewHold(config: RestartHoldConfig, name: string): RestartHold | null;
export function releaseHold(config: RestartHoldConfig, name: string): boolean;
export function activeHolds(config: RestartHoldConfig): RestartHold[];
