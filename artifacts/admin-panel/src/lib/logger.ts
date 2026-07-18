// Browser-side logger following the platform telemetry-spine convention:
// module-level `logger` import, `logger.child({ channel })` per module, with
// the same channel taxonomy as the api-server's pino logger (see
// api-server/src/routes/admin-live-stream.ts CHANNEL_TAXONOMY).
//
// Entries go to the devtools console and into an in-memory ring buffer that
// the shell's Console panel renders. No network mirror — browser logs are
// local diagnostics, not platform_log_stream rows.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  seq: number;
  time: Date;
  level: LogLevel;
  channel: string;
  message: string;
  meta?: Record<string, unknown>;
}

type LogListener = (entry: LogEntry) => void;

const RING_SIZE = 500;

const ring: LogEntry[] = [];
const listeners = new Set<LogListener>();
let seq = 0;

function emit(level: LogLevel, channel: string, messageOrMeta: string | Record<string, unknown>, maybeMessage?: string) {
  const meta = typeof messageOrMeta === "object" ? messageOrMeta : undefined;
  const message = typeof messageOrMeta === "string" ? messageOrMeta : (maybeMessage ?? "");
  const entry: LogEntry = { seq: ++seq, time: new Date(), level, channel, message, meta };

  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();

  const fn = level === "debug" ? console.debug : level === "warn" ? console.warn : level === "error" ? console.error : console.info;
  if (meta) fn(`[${channel}] ${message}`, meta);
  else fn(`[${channel}] ${message}`);

  for (const listener of listeners) {
    try { listener(entry); } catch {}
  }
}

export interface ChildLogger {
  debug(message: string): void;
  debug(meta: Record<string, unknown>, message: string): void;
  info(message: string): void;
  info(meta: Record<string, unknown>, message: string): void;
  warn(message: string): void;
  warn(meta: Record<string, unknown>, message: string): void;
  error(message: string): void;
  error(meta: Record<string, unknown>, message: string): void;
}

export const logger = {
  child({ channel }: { channel: string }): ChildLogger {
    return {
      debug: (a: string | Record<string, unknown>, b?: string) => emit("debug", channel, a, b),
      info:  (a: string | Record<string, unknown>, b?: string) => emit("info", channel, a, b),
      warn:  (a: string | Record<string, unknown>, b?: string) => emit("warn", channel, a, b),
      error: (a: string | Record<string, unknown>, b?: string) => emit("error", channel, a, b),
    } as ChildLogger;
  },
};

/** Snapshot of the ring buffer (oldest → newest). */
export function getLogBuffer(): LogEntry[] {
  return [...ring];
}

/** Subscribe to new entries; returns an unsubscribe function. */
export function subscribeLogs(listener: LogListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
