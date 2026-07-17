import { PccTest } from './taxonomy-catalog.js';

export interface PccRunResult {
  runId: string;
  testId: string;
  taxonomy: string;
  environment: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  timestamp: string;
  durationMs: number;
  why?: string;
  comparison?: {
    expected: any;
    actual: any;
    diff?: any;
  };
  metadata?: Record<string, any>;
}

export interface PccReplayTickMetrics {
  activeUsersCount: number;
  dbConnectionsCount: number;
  driftAlertsCount: number;
}

export class PccStateManager {
  private static instance: PccStateManager | null = null;

  // In-memory caches
  private activeRuns = new Map<string, PccRunResult[]>();
  private currentRunId: string | null = null;
  private environment: 'dev' | 'test' | 'prod' = 'test';
  
  // Replay parameters
  private replayMode: 'live' | 'replay' = 'live';
  private currentDay = 0;
  private currentTick = 0;
  private playbackSpeed = '1x';

  private constructor() {}

  public static getInstance(): PccStateManager {
    if (!PccStateManager.instance) {
      PccStateManager.instance = new PccStateManager();
    }
    return PccStateManager.instance;
  }

  public getEnvironment() {
    return this.environment;
  }

  public setEnvironment(env: 'dev' | 'test' | 'prod') {
    this.environment = env;
  }

  public startRun(runId: string) {
    this.currentRunId = runId;
    this.activeRuns.set(runId, []);
  }

  public addTestResult(runId: string, result: PccRunResult) {
    const results = this.activeRuns.get(runId) || [];
    results.push(result);
    this.activeRuns.set(runId, results);
  }

  public getRunResults(runId: string): PccRunResult[] {
    return this.activeRuns.get(runId) || [];
  }

  public getCurrentRunId(): string | null {
    return this.currentRunId;
  }

  public setReplayMode(mode: 'live' | 'replay') {
    this.replayMode = mode;
  }

  public getReplayMode() {
    return this.replayMode;
  }

  public setReplayProgress(day: number, tick: number) {
    this.currentDay = day;
    this.currentTick = tick;
  }

  public getReplayProgress() {
    return { day: this.currentDay, tick: this.currentTick };
  }

  public setPlaybackSpeed(speed: string) {
    this.playbackSpeed = speed;
  }

  public getPlaybackSpeed() {
    return this.playbackSpeed;
  }

  public clearAll() {
    this.activeRuns.clear();
    this.currentRunId = null;
    this.currentDay = 0;
    this.currentTick = 0;
  }
}
