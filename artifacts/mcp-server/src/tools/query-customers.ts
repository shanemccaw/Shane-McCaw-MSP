import { z } from "zod";
import { apiFetch } from "../api-client.ts";
import type { ToolDef } from "./registry.ts";

/**
 * query_customers — the operator's customer list with the seven computed pillar
 * scores, wrapping the real admin route the Admin Panel's client list reads
 * (GET /admin/clients/enriched). Filterable by any pillar score ("security
 * score below 60") and by a name/company/email substring, applied over the
 * real response — the route itself returns the full set.
 *
 * The pillar keys map to the enriched route's own computed score fields
 * (governanceScore, securityScore, …); nulls (no quiz/M365 data to score from)
 * are excluded from a below/above filter rather than treated as 0.
 */

const PILLAR_FIELDS = {
  security: "securityScore",
  governance: "governanceScore",
  compliance: "complianceScore",
  copilotReadiness: "copilotReadinessScore",
  powerPlatform: "powerPlatformScore",
  externalSharing: "externalSharingScore",
  shadowIt: "shadowItScore",
} as const;

type PillarKey = keyof typeof PILLAR_FIELDS;

interface EnrichedClient {
  id: number;
  name: string | null;
  email: string;
  company: string | null;
  industry?: string | null;
  licenseTier?: string | null;
  employeeCount?: number | null;
  tenantAge?: number | null;
  hasM365Profile?: boolean;
  appRegStatus?: string | null;
  governanceScore: number | null;
  securityScore: number | null;
  complianceScore: number | null;
  copilotReadinessScore: number | null;
  powerPlatformScore: number | null;
  externalSharingScore: number | null;
  shadowItScore: number | null;
  [k: string]: unknown;
}

const inputSchema = {
  pillar: z
    .enum(["security", "governance", "compliance", "copilotReadiness", "powerPlatform", "externalSharing", "shadowIt"])
    .optional()
    .describe("Which pillar score to filter on when using below/above."),
  below: z.number().optional().describe("Keep customers whose chosen pillar score is strictly below this (requires pillar)."),
  above: z.number().optional().describe("Keep customers whose chosen pillar score is strictly above this (requires pillar)."),
  search: z.string().optional().describe("Case-insensitive substring match on name, company or email."),
};

export const queryCustomersTool: ToolDef = {
  name: "query_customers",
  description:
    "List the operator's customers with their seven computed pillar scores (security, governance, compliance, " +
    "copilot readiness, power platform, external sharing, shadow IT), from the real GET /admin/clients/enriched. " +
    "Filter by a pillar score threshold (e.g. pillar=security, below=60) and/or a name/company/email search.",
  inputSchema,
  handler: async (args) => {
    const pillar = args.pillar as PillarKey | undefined;
    const below = typeof args.below === "number" ? args.below : undefined;
    const above = typeof args.above === "number" ? args.above : undefined;
    const search = typeof args.search === "string" ? args.search.trim().toLowerCase() : "";

    const clients = await apiFetch<EnrichedClient[]>("/admin/clients/enriched");
    let list = Array.isArray(clients) ? clients : [];

    if (search) {
      list = list.filter((c) =>
        [c.name, c.company, c.email].some((v) => typeof v === "string" && v.toLowerCase().includes(search)),
      );
    }

    if (pillar && (below !== undefined || above !== undefined)) {
      const field = PILLAR_FIELDS[pillar];
      list = list.filter((c) => {
        const score = c[field] as number | null;
        if (typeof score !== "number") return false; // unscored — excluded from a numeric filter
        if (below !== undefined && !(score < below)) return false;
        if (above !== undefined && !(score > above)) return false;
        return true;
      });
    }

    const customers = list.map((c) => ({
      id: c.id,
      name: c.name,
      company: c.company,
      email: c.email,
      industry: c.industry ?? null,
      licenseTier: c.licenseTier ?? null,
      employeeCount: c.employeeCount ?? null,
      tenantAge: c.tenantAge ?? null,
      hasM365Profile: c.hasM365Profile ?? false,
      appRegStatus: c.appRegStatus ?? null,
      scores: {
        security: c.securityScore,
        governance: c.governanceScore,
        compliance: c.complianceScore,
        copilotReadiness: c.copilotReadinessScore,
        powerPlatform: c.powerPlatformScore,
        externalSharing: c.externalSharingScore,
        shadowIt: c.shadowItScore,
      },
    }));

    return {
      count: customers.length,
      totalCustomers: list.length,
      filters: {
        pillar: pillar ?? null,
        below: below ?? null,
        above: above ?? null,
        search: search || null,
      },
      customers,
    };
  },
};
