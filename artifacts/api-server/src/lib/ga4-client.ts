// GA4 Data API client (Admin Panel Analytics dashboard, #118).
//
// Single-property client — this MSP serves exactly one GA4 property
// (shane-mccaw-consulting, MSP #1). Multi-tenant/MSP-wide GA4 dashboards
// are explicitly out of scope per #113's finalized build plan.
//
// The GA4 Data API (runReport/runRealtimeReport) has no clientId/user
// dimension — per-lead attribution join (lead_staging.ga4ClientId → GA4
// session) is not achievable here; that would require BigQuery export,
// which this epic deliberately does not use. Callers needing per-lead
// attribution must look elsewhere; this client only supports aggregate
// property-level reporting.
//
// Credentials: the GCP service account key JSON lives in Azure Key Vault
// (same secrets-at-rest convention as Zoho's refresh token — see
// zoho-client.ts), referenced by a deterministic secret name.
// GA4_PROPERTY_ID is a plain env var, not a secret.

import { BetaAnalyticsDataClient, protos } from "@google-analytics/data";
import { getSecretValue } from "./azure-keyvault.ts";
import { logger } from "./logger";

const log = logger.child({ channel: "growth.website-analytics" });

const GA4_KEYVAULT_SECRET_NAME = "ga4-service-account-key";

export type RunReportRequest = protos.google.analytics.data.v1beta.IRunReportRequest;
export type RunReportResponse = protos.google.analytics.data.v1beta.IRunReportResponse;
export type RunRealtimeReportRequest = protos.google.analytics.data.v1beta.IRunRealtimeReportRequest;
export type RunRealtimeReportResponse = protos.google.analytics.data.v1beta.IRunRealtimeReportResponse;
export type Ga4Row = protos.google.analytics.data.v1beta.IRow;

export class Ga4NotConfiguredError extends Error {
  constructor(message = "GA4 is not configured — set GA4_PROPERTY_ID and the ga4-service-account-key Key Vault secret") {
    super(message);
    this.name = "Ga4NotConfiguredError";
  }
}

export function ga4CredentialsPresent(): boolean {
  return Boolean(process.env.GA4_PROPERTY_ID);
}

function ga4PropertyPath(): string {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) throw new Ga4NotConfiguredError();
  return `properties/${propertyId}`;
}

let cachedClient: BetaAnalyticsDataClient | null = null;

async function getClient(): Promise<BetaAnalyticsDataClient> {
  if (cachedClient) return cachedClient;
  const keyJson = await getSecretValue(GA4_KEYVAULT_SECRET_NAME);
  let credentials: { client_email: string; private_key: string };
  try {
    credentials = JSON.parse(keyJson);
  } catch {
    throw new Error(`Key Vault secret '${GA4_KEYVAULT_SECRET_NAME}' is not valid JSON`);
  }
  cachedClient = new BetaAnalyticsDataClient({ credentials });
  return cachedClient;
}

export async function runReport(
  request: Omit<RunReportRequest, "property">,
): Promise<RunReportResponse> {
  if (!ga4CredentialsPresent()) throw new Ga4NotConfiguredError();
  const client = await getClient();
  try {
    const [response] = await client.runReport({ ...request, property: ga4PropertyPath() });
    return response;
  } catch (err) {
    log.error({ err }, "ga4-client: runReport failed");
    throw err;
  }
}

export async function runRealtimeReport(
  request: Omit<RunRealtimeReportRequest, "property">,
): Promise<RunRealtimeReportResponse> {
  if (!ga4CredentialsPresent()) throw new Ga4NotConfiguredError();
  const client = await getClient();
  try {
    const [response] = await client.runRealtimeReport({ ...request, property: ga4PropertyPath() });
    return response;
  } catch (err) {
    log.error({ err }, "ga4-client: runRealtimeReport failed");
    throw err;
  }
}

/** Reads a single dimension/metric value out of a GA4 report row by index. Empty string if absent. */
export function rowValue(row: Ga4Row, kind: "dimension" | "metric", index: number): string {
  const values = kind === "dimension" ? row.dimensionValues : row.metricValues;
  return values?.[index]?.value ?? "";
}

/** Resolves a GA4 preset/custom date range into the API's dateRange string format. */
export function resolveGa4DateRange(query: Record<string, unknown>): { startDate: string; endDate: string } {
  const start = query["start"];
  const end = query["end"];
  if (typeof start === "string" && typeof end === "string" && start && end) {
    return { startDate: start, endDate: end };
  }
  const range = String(query["range"] ?? "30d");
  if (range === "today") return { startDate: "today", endDate: "today" };
  if (range === "7d") return { startDate: "7daysAgo", endDate: "today" };
  if (range === "90d") return { startDate: "90daysAgo", endDate: "today" };
  return { startDate: "30daysAgo", endDate: "today" };
}
