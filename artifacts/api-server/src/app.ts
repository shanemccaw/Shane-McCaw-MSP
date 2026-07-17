import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import router from "./routes";
import { logger } from "./lib/logger";
import { ConsentRevokedError } from "./lib/graph";
import { runWithRequestContext, getRequestContext } from "./lib/request-context.ts";

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

app.use("/api", router);

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
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
