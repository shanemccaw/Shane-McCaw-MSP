/**
 * portal-remediation-tracker-export.test.ts — Git #733 (Phase D1 of Epic #647).
 *
 * Two things worth guarding:
 *   1. THE CSV LISTS ALL 28 STEPS with a real title/status, including steps
 *      the customer never touched (no row means `not_started`, same
 *      convention the GET route uses — an untouched tracker must still
 *      export a complete row set, not a partial one).
 *   2. THE PDF PIPELINE IS THE PLATFORM'S REAL ONE — `insight-pdf.ts`'s
 *      `buildHtmlDoc`/`htmlToPdf`, the same Chromium path `dashboard-export.ts`
 *      already uses, not a second bespoke renderer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

let mockSelectResultsQueue: any[][] = [];
let htmlToPdfCalls: string[] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (onfulfilled: any, onrejected?: any) =>
        Promise.resolve(mockSelectResultsQueue.shift() ?? []).then(onfulfilled, onrejected),
    };
    return chain;
  };

  return {
    db: { select: vi.fn(() => makeSelectChain()) },
    remediationTrackerStepsTable: {
      customerId: "customer_id",
      stepId: "step_id",
      status: "status",
      completedAt: "completed_at",
      updatedAt: "updated_at",
      verificationState: "verification_state",
      verifiedAt: "verified_at",
      verifiedByRunId: "verified_by_run_id",
      updatedByUserId: "updated_by_user_id",
    },
    tenantsTable: {
      id: "id",
      customerName: "customer_name",
    },
    usersTable: {
      id: "id",
      name: "name",
      mspRole: "msp_role",
      mspId: "msp_id",
    },
    mspsTable: {
      id: "id",
      name: "name",
    },
    mspDiagnosticFindingsTable: {
      runId: "run_id",
      customerId: "customer_id",
      checkKey: "check_key",
      title: "title",
      checkLabel: "check_label",
      severity: "severity",
    },
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireRole: () => (_req: any, _res: any, next: () => void) => next(),
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../lib/logger", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

vi.mock("../lib/insight-pdf", () => ({
  buildHtmlDoc: (html: string) => `<html><body>${html}</body></html>`,
  htmlToPdf: vi.fn(async (html: string) => {
    htmlToPdfCalls.push(html);
    return Buffer.from("%PDF-fake");
  }),
}));

import router from "./portal-remediation-tracker-export";

function makeApp(user: Record<string, unknown> | null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) (req as any).user = user;
    next();
  });
  app.use("/api", router);
  return app;
}

const CUSTOMER = { id: 7, customerId: 42, role: "client" };

beforeEach(() => {
  mockSelectResultsQueue = [];
  htmlToPdfCalls = [];
});

describe("GET /portal/remediation-tracker/export.csv", () => {
  it("rejects a token with no customer identity", async () => {
    const res = await request(makeApp({ id: 7, role: "client" })).get(
      "/api/portal/remediation-tracker/export.csv",
    );
    expect(res.status).toBe(403);
  });

  it("lists all 28 steps, defaulting untouched ones to not_started", async () => {
    mockSelectResultsQueue = [
      [{ stepId: "s2", status: "completed", completedAt: new Date("2026-08-01T00:00:00Z"), updatedAt: new Date("2026-08-01T00:00:00Z") }],
      [{ customerName: "Halden Materials" }],
    ];

    const res = await request(makeApp(CUSTOMER)).get("/api/portal/remediation-tracker/export.csv");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("Halden-Materials-remediation-tracker.csv");

    const lines = res.text.trim().split("\r\n");
    // header + 28 steps
    expect(lines.length).toBe(29);
    expect(lines[0]).toBe('"Step","Title","Pillar","Status","Completed At","Last Updated"');
    // s1 was never touched -> not_started
    expect(lines[1]).toContain('"Step 1"');
    expect(lines[1]).toContain('"Not started"');
    // s2 was completed
    expect(lines[2]).toContain('"Step 2"');
    expect(lines[2]).toContain('"Completed"');
    expect(lines[2]).toContain("2026-08-01T00:00:00.000Z");
  });

  it("escapes embedded quotes/commas safely", async () => {
    mockSelectResultsQueue = [[], [{ customerName: 'Acme, "The" Co' }]];
    const res = await request(makeApp(CUSTOMER)).get("/api/portal/remediation-tracker/export.csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("Acme-The-Co-remediation-tracker.csv");
  });
});

describe("GET /portal/remediation-tracker/export.pdf", () => {
  it("rejects a token with no customer identity", async () => {
    const res = await request(makeApp({ id: 7, role: "client" })).get(
      "/api/portal/remediation-tracker/export.pdf",
    );
    expect(res.status).toBe(403);
  });

  it("renders through the real insight-pdf.ts pipeline and streams the buffer", async () => {
    mockSelectResultsQueue = [[], [{ customerName: "Halden Materials" }]];

    const res = await request(makeApp(CUSTOMER)).get("/api/portal/remediation-tracker/export.pdf");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("Halden-Materials-remediation-tracker.pdf");
    expect(htmlToPdfCalls.length).toBe(1);
    expect(htmlToPdfCalls[0]).toContain("Remediation Tracker");
    expect(htmlToPdfCalls[0]).toContain("Halden Materials");
  });
});

describe("GET /portal/remediation-tracker/evidence-pack.pdf", () => {
  it("rejects a token with no customer identity", async () => {
    const res = await request(makeApp({ id: 7, role: "client" })).get(
      "/api/portal/remediation-tracker/evidence-pack.pdf",
    );
    expect(res.status).toBe(403);
  });

  it("renders the design's own 'nothing verified yet' copy when no step is verified", async () => {
    mockSelectResultsQueue = [[], [{ customerName: "Halden Materials" }]];

    const res = await request(makeApp(CUSTOMER)).get("/api/portal/remediation-tracker/evidence-pack.pdf");

    expect(res.status).toBe(200);
    expect(htmlToPdfCalls.length).toBe(1);
    expect(htmlToPdfCalls[0]).toContain("nothing verified yet");
    expect(htmlToPdfCalls[0]).toContain("A tick on its own is not evidence.");
  });

  it("cites the real finding, verified date and verifier for a verified step, gated on verificationState", async () => {
    mockSelectResultsQueue = [
      [
        {
          stepId: "s7",
          status: "completed",
          verifiedAt: new Date("2026-08-05T00:00:00Z"),
          verifiedByRunId: "11111111-1111-1111-1111-111111111111",
          updatedByUserId: 3,
        },
      ],
      [{ customerName: "Halden Materials" }],
      [
        {
          runId: "11111111-1111-1111-1111-111111111111",
          checkKey: "identity:mfa-registration",
          title: "MFA now enforced for all 11 admin accounts",
          checkLabel: "MFA registration",
          severity: "ok",
        },
      ],
      [{ id: 3, name: "Jamie Ops", mspRole: "MSPAdmin", mspId: 9 }],
      [{ id: 9, name: "Shane McCaw Consulting" }],
    ];

    const res = await request(makeApp(CUSTOMER)).get("/api/portal/remediation-tracker/evidence-pack.pdf");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("Halden-Materials-remediation-evidence-pack.pdf");
    expect(htmlToPdfCalls.length).toBe(1);
    const html = htmlToPdfCalls[0];
    expect(html).toContain("Step 7");
    expect(html).toContain("MFA now enforced for all 11 admin accounts");
    expect(html).toContain("Shane McCaw Consulting");
    expect(html).toContain("August 5, 2026");
  });
});
