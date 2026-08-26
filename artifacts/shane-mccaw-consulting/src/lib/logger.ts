/**
 * Browser-side structured logger for the marketing site (#1306).
 *
 * The platform's logging spine (`logger.child({ channel })`, locked channel
 * taxonomy: engine.*, workflow.*, billing, auth, comms.*, notification,
 * tenant.*, admin.*, integration.azure, growth.*, crm, system.core, audit)
 * lives server-side in the api-server. This module gives client code the same
 * call shape so a component's log sites read identically to a route's, and so
 * a future transport (e.g. a public client-events beacon) can be wired in one
 * place without touching call sites.
 *
 * Transport today is the console only, deliberately: the existing
 * POST /api/client-events door into the exception tracker sits behind
 * requireAuth, and the marketing site's buyers are unauthenticated — a beacon
 * from here would 401 on every call. When a public ingestion path exists,
 * route the error level through it here.
 */

type LogFields = Record<string, unknown>;

export interface ChannelLogger {
  info: (fields: LogFields, message: string) => void;
  warn: (fields: LogFields, message: string) => void;
  error: (fields: LogFields, message: string) => void;
}

function emit(level: "info" | "warn" | "error", channel: string, fields: LogFields, message: string): void {
  // One structured line per event, channel first — same reading order as the
  // server's pino stream.
  console[level](`[${channel}] ${message}`, fields);
}

export const logger = {
  child({ channel }: { channel: string }): ChannelLogger {
    return {
      info: (fields, message) => emit("info", channel, fields, message),
      warn: (fields, message) => emit("warn", channel, fields, message),
      error: (fields, message) => emit("error", channel, fields, message),
    };
  },
};
