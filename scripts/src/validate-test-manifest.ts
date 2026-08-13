// Git #811 (Phase 8 of Epic #803) — offline schema/reachability check for a
// /test-manifests/*.json file. The WPF BuildConsole app (desktop/BuildConsole) is
// the real test runner (HTTP/Graph/UI, per #803's design) — this script only
// validates a manifest's shape against TestManifest.cs's expectations and does a
// best-effort live smoke call, since no WPF/WebView2 GUI is drivable from this
// environment.
//
// Usage: tsx ./src/validate-test-manifest.ts <path-to-manifest.json> [baseUrl]

import { readFileSync } from "node:fs";
import { logger } from "./lib/logger";

const log = logger.child({ channel: "testing.poc" });

interface ManifestApiTest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  expect: { status: number; jsonPath?: string; exists?: boolean; isArray?: boolean };
}

interface Manifest {
  issue: number;
  feature: string;
  baseUrl: string;
  apiTests?: ManifestApiTest[];
  graphTests?: unknown[];
  uiSteps?: Array<{ action: string; target?: string; selector?: string; value?: string; state?: string }>;
}

function resolveJsonPath(obj: unknown, path: string): unknown {
  // Only supports the simple "$.field.nested" shape this manifest schema uses.
  const parts = path.replace(/^\$\.?/, "").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

async function main(): Promise<void> {
  const manifestPath = process.argv[2];
  const baseUrlOverride = process.argv[3];
  if (!manifestPath) {
    log.error({}, "usage: validate-test-manifest.ts <path> [baseUrl]");
    process.exitCode = 1;
    return;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
  log.info(
    { issue: manifest.issue, feature: manifest.feature, apiTests: manifest.apiTests?.length ?? 0, uiSteps: manifest.uiSteps?.length ?? 0, graphTests: manifest.graphTests?.length ?? 0 },
    "manifest loaded",
  );

  if (!manifest.issue || !manifest.feature || !manifest.baseUrl) {
    log.error({ manifest }, "manifest missing required top-level field (issue/feature/baseUrl)");
    process.exitCode = 1;
    return;
  }

  const baseUrl = baseUrlOverride ?? (manifest.baseUrl.includes("{{") ? null : manifest.baseUrl);
  if (!baseUrl) {
    log.warn({}, "baseUrl is an unresolved placeholder and no override was given — skipping live apiTests, schema-only check passed");
    return;
  }

  for (const test of manifest.apiTests ?? []) {
    const url = new URL(test.path, baseUrl).toString();
    try {
      const res = await fetch(url, {
        method: test.method,
        headers: test.headers,
        body: test.body ? JSON.stringify(test.body) : undefined,
      });
      const statusOk = res.status === test.expect.status;
      let jsonPathOk = true;
      if (test.expect.jsonPath) {
        const json = await res.json().catch(() => null);
        const value = resolveJsonPath(json, test.expect.jsonPath);
        jsonPathOk = test.expect.exists ? value !== undefined : true;
      }
      log.info(
        { url, method: test.method, status: res.status, expectedStatus: test.expect.status, statusOk, jsonPathOk },
        statusOk && jsonPathOk ? "apiTest PASS" : "apiTest FAIL",
      );
    } catch (err) {
      log.error({ url, err: err instanceof Error ? err.message : String(err) }, "apiTest request failed");
    }
  }
}

void main();
