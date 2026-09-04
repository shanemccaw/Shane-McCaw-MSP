import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import router from "./routes";
import { subscriptionGate } from "./middlewares/subscriptionGate";
import { logger } from "./lib/logger";
import { ConsentRevokedError } from "./lib/graph";
import { apiError, ApiErrorCode } from "./lib/api-helpers";
import { runWithRequestContext, getRequestContext } from "./lib/request-context.ts";
import { captureException } from "./lib/exception-tracker.ts";

// Durably record a crash before the process dies, but never let a hung DB
// write delay exit — a stuck process is strictly worse than one lost record.
async function captureWithTimeout(
  err: Error,
  opts: { channel: string; source: "uncaught" },
  timeoutMs = 2000,
): Promise<void> {
  await Promise.race([
    captureException(err, opts),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

// Previously anything uncaught crashed the process with no record. Preserve
// that exit behaviour (process.exit(1)) — the only change is the durable
// record written first.
process.on("uncaughtException", (err) => {
  void captureWithTimeout(err, { channel: "system.core", source: "uncaught" })
    .catch(() => {})
    .finally(() => {
      logger.fatal({ err }, "Uncaught exception — process exiting");
      process.exit(1);
    });
});

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  void captureWithTimeout(err, { channel: "system.core", source: "uncaught" })
    .catch(() => {})
    .finally(() => {
      logger.fatal({ err }, "Unhandled promise rejection — process exiting");
      process.exit(1);
    });
});

const app: Express = express();

// Trust Replit's reverse proxy so X-Forwarded-For is honoured and IP-based
// middleware (rate limiters, etc.) sees Stripe's real source IP correctly.
app.set("trust proxy", 1);

// Establish one AsyncLocalStorage-backed correlation context per request.
// Everything downstream (logger, event-bus, audit inserts) reads from this
// instead of generating its own ID.
// Only UUID-shaped forwarded ids are honoured: the event-bus envelope schema
// requires correlationId to be a UUID, so an arbitrary client-supplied
// x-trace-id would otherwise make every dispatch in the request throw.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
app.use((req: Request, res: Response, next: NextFunction) => {
  const forwarded = req.headers["x-trace-id"];
  const traceId =
    typeof forwarded === "string" && UUID_RE.test(forwarded) ? forwarded : randomUUID();
  runWithRequestContext(
    { traceId, mspId: null, customerId: null, actor: null },
    next,
  );
});

app.use(
  pinoHttp({
    logger,
    // Reuse the traceId established by the request-context middleware above,
    // exposed as x-trace-id response header.
    genReqId(req) {
      return getRequestContext()?.traceId ?? randomUUID();
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
          traceId: req.id,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Expose the traceId in every response so clients can correlate logs.
app.use((req: Request, res: Response, next: NextFunction) => {
  const traceId = (req as unknown as { id?: string }).id ?? randomUUID();
  res.setHeader("x-trace-id", traceId);
  next();
});
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
// Webhook endpoints need raw body for signature verification — must be before express.json()
app.use("/api/portal/stripe/webhook", express.raw({ type: "application/json" }));
app.use("/api/msp/v1/webhooks", express.raw({ type: "application/json" }));
// MSP platform billing webhook — separate from per-offer billing
app.use("/api/msp/stripe/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── The subscription gate — ONE check point, ahead of ALL routing (#2765, #1944 part 8)
//
// Mounted here rather than inside the router, and ahead of it rather than beside it, so
// that every existing and every future route is covered by sitting behind it — with no
// route knowing it exists. It runs before `requireAuth`, and therefore before any
// `requireRole`/`can()` evaluation: a customer whose subscription has lapsed never
// reaches permission evaluation at all, they reach the "Come back! Download your data"
// wall, with export the one path that stays open.
//
// *"A gate in front of routing cannot be bypassed by a route that forgot to check —
// there is nothing to forget."* Do not move this into the router, and do not add
// per-route awareness of it; the allowlist inside it is the only place that decides what
// stays reachable.
app.use("/api", subscriptionGate, router);

// ── Global error handler ───────────────────────────────────────────────────────
// ConsentRevokedError bubbles up from graphFetchForTenant when a live Graph call
// returns 401 or a consent-error body. Surface a typed 403 so clients can show
// a "re-authorize" prompt without any operator action.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ConsentRevokedError) {
    logger.warn({ tenantId: err.tenantId }, "ConsentRevokedError reached top-level handler — returning 403");
    res.status(403).json({ code: "consent_revoked", tenantId: err.tenantId, reAuthorizeRequired: true });
    return;
  }
  // express.json()/body-parser reject a malformed body with a real SyntaxError
  // carrying statusCode/status + expose: true — the standard body-parser
  // contract. Respect that instead of collapsing every non-ConsentRevokedError
  // to a hardcoded 500 (Git #2100).
  const declared = err as { status?: unknown; statusCode?: unknown; expose?: unknown; message?: unknown };
  const declaredStatus = typeof declared?.statusCode === "number"
    ? declared.statusCode
    : typeof declared?.status === "number"
      ? declared.status
      : undefined;

  if (declared?.expose === true && declaredStatus !== undefined) {
    logger.warn({ err, statusCode: declaredStatus }, "Client error reached top-level handler");
    apiError(res, declaredStatus, ApiErrorCode.VALIDATION, "Malformed request body");
    return;
  }

  logger.error({ err }, "Unhandled error");
  apiError(res, 500, ApiErrorCode.INTERNAL, "Internal server error");
});

export default app;
