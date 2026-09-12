/**
 * data-rights-api.ts — the data seam for the MSP Console's Data Rights module
 * page (Git #2633, Feature #2565). Mounts at `/tenants/:id/dr`
 * (`Design/MSP_Console/design_handoff_msp_console/Data Rights.dc.html`, README
 * screen 16), wiring the real, finished, previously-orphaned operator backend
 * documented in full at
 * `docs/msp-console/data-rights-and-privacy-msp-console-contract-pack.md`:
 *
 *   GET  /api/msp/data-rights                                          — MSP-wide
 *        activity feed (deletion requests + data exports), NOT scoped by
 *        customer server-side; this module filters client-side to the
 *        current tenant, same as the design's own `tenantName` prop does.
 *   GET  /api/msp/data-rights/customers/:customerId/users               — this
 *        customer's linked portal users, so an admin can pick who a
 *        deletion request applies to.
 *   POST /api/msp/data-rights/customers/:customerId/deletion-request    — records
 *        a deletion request on the customer's behalf via the exact same
 *        `lib/data-rights.ts` helper the self-service portal route uses.
 *
 * There is no dedicated "deletion-request queue" table and no status/lifecycle
 * field anywhere (the route's own header comment, `msp-data-rights.ts:9-15`) —
 * both endpoints only ever write a fire-and-forget `audit_logs` row. This seam
 * does not invent a status this backend doesn't have.
 *
 * `currentSchema` mirrors the real `CurrentSchemaSummary` shape
 * (`artifacts/api-server/src/lib/data-rights.ts`) — diagnostic runs/findings,
 * SOWs, MSP documents, engine snapshots — never the design's own placeholder
 * category names ("assessments" / "support threads" / "invoices"), which do
 * not exist as real columns.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export type DataRightsActionType = "deletion_request_submitted" | "data_export_downloaded";

/** Real shape of `artifacts/api-server/src/lib/data-rights.ts`'s `CurrentSchemaSummary`. */
export interface CurrentSchemaSummary {
  readonly customerId: number;
  readonly mspId: number | null;
  readonly customerName: string | null;
  readonly diagnosticRuns: number;
  readonly diagnosticFindings: number;
  readonly sows: number;
  readonly mspDocuments: number;
  readonly engineSnapshots: number;
}

export interface DataRightsActivityRow {
  readonly id: number;
  readonly actionType: DataRightsActionType;
  readonly submittedByAdmin: boolean;
  readonly submittedByName: string | null;
  readonly customerId: number | null;
  readonly customerName: string | null;
  readonly currentSchema: CurrentSchemaSummary | null;
  readonly createdAt: string;
}

export interface CustomerLinkedUser {
  readonly userId: number;
  readonly name: string | null;
  readonly email: string;
  readonly isActive: boolean;
}

export interface DeletionRequestResult {
  readonly ok: true;
  readonly message: string;
  readonly currentSchemaSummary: CurrentSchemaSummary | null;
}

/** A fetch that failed reports its real HTTP status so the page can tell
 * "not in this MSP's book" (403) apart from a generic failure — same pattern
 * as `break-glass-api.ts`'s `BreakGlassApiError`. */
export class DataRightsApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new DataRightsApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const ACTIVITY_LIMIT = 200; // MAX_LIMIT (msp-data-rights.ts:59) — the route has no pagination beyond this.
const activityKey = ["msp", "data-rights", "activity"] as const;
const usersKey = (customerId: number) => ["msp", "data-rights", "customers", customerId, "users"] as const;

/**
 * The MSP-wide feed, `requireCapability("ladder.msp-admin")` gated (stricter
 * than the console's usual MSPOperator+ default — this surfaces PII). Fetched
 * once and filtered client-side per tenant, exactly like the design's own
 * `tenantName` prop scoping — there is no server-side per-customer filter on
 * this route.
 */
export function useDataRightsActivity(): UseQueryResult<{ requests: DataRightsActivityRow[] }, DataRightsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: activityKey,
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/data-rights?limit=${ACTIVITY_LIMIT}`);
      return parseJsonOrThrow<{ requests: DataRightsActivityRow[] }>(res);
    },
    enabled: !isLoading && !!accessToken,
    staleTime: 20_000,
  });
}

export function useCustomerLinkedUsers(customerId: number): UseQueryResult<{ users: CustomerLinkedUser[] }, DataRightsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: usersKey(customerId),
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/data-rights/customers/${customerId}/users`);
      return parseJsonOrThrow<{ users: CustomerLinkedUser[] }>(res);
    },
    enabled: !isLoading && !!accessToken && Number.isInteger(customerId),
    staleTime: 20_000,
  });
}

export function useFileDeletionRequest(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetchWithAuth(`/api/msp/data-rights/customers/${customerId}/deletion-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      return parseJsonOrThrow<DeletionRequestResult>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: activityKey }),
  });
}
