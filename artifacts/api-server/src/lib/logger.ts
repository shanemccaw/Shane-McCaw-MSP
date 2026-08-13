import pino from "pino";
import { enqueueLogEntry } from "./log-stream-writer.ts";
import { getRequestContext } from "./request-context.ts";
import { captureException } from "./exception-tracker.ts";

const isProduction = process.env.NODE_ENV === "production";

// pino numeric levels ascend: trace=10, debug=20, info=30, warn=40, error=50,
// fatal=60. Index with `level / 10 - 1` (10 → 0 → "trace", 60 → 5 → "fatal").
// NOTE: ordered ascending on purpose — a descending array would map every level
// to the wrong name (info → "warn").
const LEVEL_NAMES = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

// Shared with pino's own `redact` option below — pino reads this array once at
// construction time and doesn't mutate it, so one array can safely back both
// pino's internal serialization redaction AND the manual walk the mirror hook
// does below (the mirror captures bindings/mergingObject BEFORE pino's own
// redaction runs, so it needs its own pass over the same paths).
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
];

function redactForMirror(obj: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(obj);
  for (const path of REDACT_PATHS) {
    const parts = path.replace(/\['([^']+)'\]/g, ".$1").split(".");
    let cursor: any = clone;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cursor?.[parts[i]] == null) { cursor = null; break; }
      cursor = cursor[parts[i]];
    }
    if (cursor && parts[parts.length - 1] in cursor) {
      cursor[parts[parts.length - 1]] = "[Redacted]";
    }
  }
  return clone;
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: REDACT_PATHS,
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
          meta: redactForMirror({ ...bindings, ...mergingObject }),
          correlationId: ctx?.traceId ?? null,
          mspId: (bindings.mspId as number | undefined) ?? ctx?.mspId ?? null,
          customerId:
            (bindings.customerId as number | undefined) ?? ctx?.customerId ?? null,
          occurredAt: new Date(),
        });
        // Feed exception tracking off the same merging object — every
        // `logger.error({ err }, "...")` call site (incl. the top-level
        // Express handler) is captured with zero call-site changes.
        const errCandidate = mergingObject.err ?? mergingObject.error;
        if (errCandidate instanceof Error) {
          void captureException(errCandidate, { channel, source: "caught" });
        }
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
