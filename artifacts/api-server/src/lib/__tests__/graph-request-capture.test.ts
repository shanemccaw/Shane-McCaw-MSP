/**
 * graph-request-capture.test.ts — #393
 *
 * These tests deliberately issue REAL requests through the real global `fetch`
 * against a throwaway local http server. That is the only way to assert the
 * thing the capture exists to prove: what undici puts on the wire is not what
 * this codebase puts in its options object. A mocked fetch would have no wire.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

vi.mock("../logger", () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() };
  return { logger: { ...stub, child: () => ({ ...stub, child: () => stub }) } };
});

import {
  annotateCapturedResponse,
  createGraphRequestCapture,
  isCapturingGraphRequests,
  recordOutgoingGraphRequest,
} from "../graph-request-capture";

let server: Server;
let base: string;
/** Header names the server actually received, per request. */
const received: Array<Record<string, string | string[] | undefined>> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    received.push({ ...req.headers });
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "Forbidden" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A minimal stand-in for graphFetchForTenant's final three lines. */
async function fetchWithCapture(url: string, init: RequestInit): Promise<Response> {
  const seq = recordOutgoingGraphRequest(url, init);
  const res = await fetch(url, init);
  annotateCapturedResponse(seq, res.status);
  return res;
}

describe("graph-request-capture", () => {
  it("captures nothing outside a capture session — the production check path", async () => {
    expect(isCapturingGraphRequests()).toBe(false);
    const seq = recordOutgoingGraphRequest(`${base}/v1.0/organization`, { method: "GET" });
    expect(seq).toBeNull();
    // And annotating a null sequence is inert rather than throwing.
    expect(() => annotateCapturedResponse(null, 200)).not.toThrow();
  });

  it("captures the final method, URL and header set, and does not change the request", async () => {
    const capture = createGraphRequestCapture();
    try {
      const res = await capture.run(() =>
        fetchWithCapture(`${base}/v1.0/roleManagement/directory/roleEligibilitySchedules`, {
          method: "GET",
          headers: {
            Authorization: "Bearer header.eyJhdWQiOiJodHRwczovL2dyYXBoLm1pY3Jvc29mdC5jb20iLCJyb2xlcyI6WyJEaXJlY3RvcnkuUmVhZC5BbGwiXX0.sig",
            "Content-Type": "application/json",
            ConsistencyLevel: "eventual",
          },
        }),
      );
      expect(res.status).toBe(403);

      const { requests } = capture.snapshot();
      expect(requests).toHaveLength(1);
      const req = requests[0]!;

      expect(req.method).toBe("GET");
      expect(req.url).toBe(`${base}/v1.0/roleManagement/directory/roleEligibilitySchedules`);
      expect(req.responseStatus).toBe(403);

      const names = req.headers.map((h) => h.name.toLowerCase());
      expect(names).toContain("authorization");
      expect(names).toContain("consistencylevel");

      // The server still received exactly what was asked for — capture is inert.
      const sent = received.at(-1)!;
      expect(sent["consistencylevel"]).toBe("eventual");
      expect(sent["authorization"]).toContain("Bearer header.");
    } finally {
      capture.close();
    }
  });

  it("never returns the bearer token, but does return its claims", async () => {
    const capture = createGraphRequestCapture();
    try {
      await capture.run(() =>
        fetchWithCapture(`${base}/v1.0/organization`, {
          method: "GET",
          headers: {
            // {"aud":"https://graph.microsoft.com","roles":["RoleEligibilitySchedule.Read.Directory"],"tid":"t-1"}
            Authorization:
              "Bearer hdr.eyJhdWQiOiJodHRwczovL2dyYXBoLm1pY3Jvc29mdC5jb20iLCJyb2xlcyI6WyJSb2xlRWxpZ2liaWxpdHlTY2hlZHVsZS5SZWFkLkRpcmVjdG9yeSJdLCJ0aWQiOiJ0LTEifQ.sig",
          },
        }),
      );

      const req = capture.snapshot().requests[0]!;
      const auth = req.headers.find((h) => h.name.toLowerCase() === "authorization")!;
      expect(auth.redacted).toBe(true);
      expect(auth.value).not.toContain("eyJhdWQ");
      expect(auth.value).toContain("redacted");

      expect(req.tokenClaims).toMatchObject({
        aud: "https://graph.microsoft.com",
        tid: "t-1",
        roles: ["RoleEligibilitySchedule.Read.Directory"],
      });

      // The raw wire block must be redacted too — it carries the real value.
      expect((req.wireHeaders ?? []).join("\n")).not.toContain("eyJhdWQ");
    } finally {
      capture.close();
    }
  });

  it("records the wire headers, including ones this codebase never sets", async () => {
    const capture = createGraphRequestCapture();
    try {
      await capture.run(() =>
        fetchWithCapture(`${base}/v1.0/organization`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        }),
      );

      const req = capture.snapshot().requests[0]!;
      expect(req.wireHeaders).not.toBeNull();
      const wire = req.wireHeaders!.join("\n").toLowerCase();

      // The literal request line, then headers no line of this codebase sets.
      expect(req.wireHeaders![0]).toContain("GET /v1.0/organization");
      expect(wire).toContain("accept-language");
      expect(wire).toContain("user-agent");

      // The header set the options object carried has no accept-language at all —
      // this difference is exactly what the capture exists to surface.
      expect(req.headers.map((h) => h.name.toLowerCase())).not.toContain("accept-language");
      expect(received.at(-1)!["accept-language"]).toBeDefined();
    } finally {
      capture.close();
    }
  });

  it("keeps one entry per real request, including retries and extra pages", async () => {
    const capture = createGraphRequestCapture();
    try {
      await capture.run(async () => {
        await fetchWithCapture(`${base}/v1.0/users?$top=1`, { method: "GET" });
        await fetchWithCapture(`${base}/v1.0/users?$skiptoken=abc`, { method: "GET" });
      });
      const { requests } = capture.snapshot();
      expect(requests.map((r) => r.sequence)).toEqual([1, 2]);
      expect(requests[1]!.url).toContain("skiptoken=abc");
    } finally {
      capture.close();
    }
  });

  it("lets the callee's error through untouched while still capturing", async () => {
    const capture = createGraphRequestCapture();
    try {
      await expect(
        capture.run(async () => {
          await fetchWithCapture(`${base}/v1.0/organization`, { method: "GET" });
          throw new Error("Graph API error 403");
        }),
      ).rejects.toThrow("Graph API error 403");
      expect(capture.snapshot().requests).toHaveLength(1);
    } finally {
      capture.close();
    }
  });

  it("stops capturing once the session is closed", async () => {
    const capture = createGraphRequestCapture();
    capture.close();
    expect(isCapturingGraphRequests()).toBe(false);
    expect(recordOutgoingGraphRequest(`${base}/v1.0/organization`, { method: "GET" })).toBeNull();
  });
});
