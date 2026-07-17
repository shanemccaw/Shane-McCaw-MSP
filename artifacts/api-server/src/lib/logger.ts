import pino from "pino";
import { enqueueLogEntry } from "./log-stream-writer.ts";
import { getRequestContext } from "./request-context.ts";

const isProduction = process.env.NODE_ENV === "production";

// pino numeric levels ascend: trace=10, debug=20, info=30, warn=40, error=50,
// fatal=60. Index with `level / 10 - 1` (10 → 0 → "trace", 60 → 5 → "fatal").
// NOTE: ordered ascending on purpose — a descending array would map every level
// to the wrong name (info → "warn").
const LEVEL_NAMES = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  hooks: {
    // Fires synchronously on every `logger.*()` / child-logger `.error()` call.
    // Mirrors the call into platform_log_stream via the batched writer, then
    // delegates to the real log method. Wrapped in try/catch so the mirror can
    // never break actual logging.
    logMethod(inputArgs, method, level) {
      try {
        const bindings = this.bindings() as Record<string, unknown>;
        const channel = (bindings.channel as string | undefined) ?? "unassigned";
        const [first, ...rest] = inputArgs;
        const isObj = typeof first === "object" && first !== null;
        const mergingObject = isObj ? (first as Record<string, unknown>) : {};
        const message = isObj
          ? typeof rest[0] === "string"
            ? rest[0]
            : ""
          : typeof first === "string"
            ? first
            : "";
        const ctx = getRequestContext();
        enqueueLogEntry({
          channel,
          level: LEVEL_NAMES[Math.floor(level / 10) - 1] ?? "info",
          message,
          meta: { ...bindings, ...mergingObject },
          correlationId: ctx?.traceId ?? null,
          mspId: (bindings.mspId as number | undefined) ?? ctx?.mspId ?? null,
          customerId:
            (bindings.customerId as number | undefined) ?? ctx?.customerId ?? null,
          occurredAt: new Date(),
        });
      } catch {
        // Never let the mirror hook break actual logging.
      }
      return method.apply(this, inputArgs);
    },
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
