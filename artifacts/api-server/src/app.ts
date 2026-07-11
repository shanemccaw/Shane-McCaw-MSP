import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Trust Replit's reverse proxy so X-Forwarded-For is honoured and IP-based
// middleware (rate limiters, etc.) sees Stripe's real source IP correctly.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    // Generate a stable traceId per request, exposed as x-trace-id response header.
    genReqId(req) {
      const existing = req.headers["x-trace-id"];
      if (typeof existing === "string" && existing.length > 0) return existing;
      return randomUUID();
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

export default app;
