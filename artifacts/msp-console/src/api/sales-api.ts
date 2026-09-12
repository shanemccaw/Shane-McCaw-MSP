/**
 * React Query hooks for the MSP Console's Sales module (Git #2643, Feature
 * #2568) — wired against the real, current routes in:
 *
 *   artifacts/api-server/src/routes/msp-sales-offers.ts
 *     GET    /api/msp/:mspId/sales-offers
 *     GET    /api/msp/sales-offers/:id/events
 *     POST   /api/msp/sales-offers/generate
 *     POST   /api/msp/:mspId/sales-offers/expire-stale
 *     PATCH  /api/msp/sales-offers/:id           (title/rationale, draft only)
 *     PATCH  /api/msp/sales-offers/:id/state     (sent/rejected only — see below)
 *     DELETE /api/msp/sales-offers/:id
 *   artifacts/api-server/src/routes/msp-sow.ts
 *     POST   /api/msp/offers/:offerId/accept     (the ONLY real accept path)
 *     GET    /api/msp/sows                       (filters: status, customerId, offerId — offerId added by #2643)
 *     GET    /api/msp/sows/:sowId
 *     GET    /api/msp/sows/:sowId/document
 *     POST   /api/msp/sows/:sowId/charge
 *     POST   /api/msp/sows/:sowId/expire
 *   artifacts/api-server/src/routes/msp-sales-bundles.ts
 *     GET    /api/msp/monitoring-packages
 *     GET    /api/msp/sales-bundles
 *     POST   /api/msp/sales-bundles
 *     GET    /api/msp/sales-bundles/:bundleId
 *     PATCH  /api/msp/sales-bundles/:bundleId
 *     DELETE /api/msp/sales-bundles/:bundleId
 *     GET    /api/msp/sales-bundles/:bundleId/assignments
 *     POST   /api/msp/sales-bundles/:bundleId/assignments
 *     DELETE /api/msp/sales-bundles/:bundleId/assignments/:assignmentId
 *
 * IMPORTANT — the real state machine, not the design mock's fake one:
 * `Sales.dc.html`'s prototype lets an operator flip an offer straight to
 * "accepted" from the detail drawer and warns that doing so "delivers
 * nothing" — that was true of the mock's own fake state-only transition.
 * The real backend does not have that transition at all: PATCH
 * .../sales-offers/:id/state hard-rejects `newState: "accepted"` with a 422
 * (msp-sales-offers.ts #3386) specifically because it has no fulfillment
 * logic — a real accept can ONLY happen through
 * `POST /api/msp/offers/:offerId/accept` (msp-sow.ts), which branches by the
 * service's serviceClass and does real work: creates a signable SOW
 * (project), opens a real Stripe Checkout Session (add_on/subscription), or
 * activates immediately for a genuine $0 item. This client only ever calls
 * that route to accept — never the state route.
 *
 * Real, still-open financial-correctness gaps on the accept/checkout path
 * (do not treat this as a fully-hardened payment flow):
 *   #3400 — a paid checkout failure can leave an offer permanently "accepted"
 *           with no charge collected (this route's own fix already guards
 *           the *sales offer* row; the underlying Stripe failure modes remain).
 *   #3405 — free ($0) checkout does not check services.allow_free_checkout.
 *   #3650 — the add-on/subscription checkout path has no webhook consumer
 *           and can mis-target the customer email.
 * The UI surfaces these honestly rather than implying the accept action is
 * fully reliable.
 *
 * No fixture module, no fabricated row — every read either resolves to a
 * real server response or surfaces as a failed/loading state the module
 * renders honestly.
 */
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

// ── Wire types ────────────────────────────────────────────────────────────────

export type SalesOfferState = "draft" | "sent" | "accepted" | "rejected" | "expired";

export interface SalesOffer {
  id: number;
  customerId: number | null;
  serviceId: number | null;
  mspId: number | null;
  title: string;
  rationale: string | null;
  firedSignalKeys: string[];
  bundledOfferIds: number[];
  basePriceCents: number;
  adjustedPriceCents: number;
  internalCostCents: number | null;
  priceCents: number | null;
  score: number;
  state: SalesOfferState;
  expiresAt: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  closedAt: string | null;
  rejectionReason: string | null;
  engineSnapshot: Record<string, unknown>;
  trialPeriodDays: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SalesOfferEvent {
  id: number;
  offerId: number;
  eventName: string;
  payload: Record<string, unknown>;
  actorUserId: number | null;
  createdAt: string;
}

export interface GenerateOffersResult {
  insertedOfferIds: number[];
  candidateCount: number;
  firedSignals: string[];
}

export type AcceptOfferResult =
  | { outcome: "sow_created"; sowId: string; shareToken: string; message: string }
  | { outcome: "checkout_required"; checkoutUrl: string | null; sessionId: string }
  | { outcome: "free_activated"; message: string }
  // The paid path's own reconciliation-needed outcome (msp-sow.ts calls the
  // real fulfillment through a different route than this offer-accept one,
  // but msp-marketplace-purchase.ts's sibling shape is mirrored here in case
  // a future accept path returns it) — kept honest rather than narrowed away.
  | { outcome: "payment_processed"; offerId: number | null; message: string; subscriptionId?: string | null; paymentIntentId?: string | null };

export interface MonitoringPackageFull {
  id: number;
  packageId: string;
  key: string;
  label: string;
  description: string | null;
  engines: string[];
  platformCostCents: number;
  requiredPlanFeature: string | null;
  status: string;
  createdAt: string;
}

export type MspSalesBundleStatus = "draft" | "active" | "archived";

export interface MspSalesBundle {
  id: number;
  bundleId: string;
  mspId: number;
  name: string;
  description: string | null;
  monitoringPackageKeys: string[];
  internalCostCents: number;
  resalePriceCents: number;
  status: MspSalesBundleStatus;
  trialDays: number | null;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MspSalesBundleAssignment {
  id: number;
  assignmentId: string;
  bundleId: string;
  mspId: number;
  customerId: number;
  tenantId: string | null;
  status: "active" | "suspended" | "revoked";
  activatedAt: string | null;
  trialExpiresAt: string | null;
  assignedAt: string;
  revokedAt: string | null;
  customerName?: string | null;
  customerDomain?: string | null;
}

export type MspSowStatus = "draft" | "sent" | "signed" | "paid" | "failed" | "expired";

export interface MspSowSummary {
  sowId: string;
  offerId: number | null;
  title: string;
  amountCents: number;
  status: MspSowStatus;
  customerId: number | null;
  signedAt: string | null;
  signerName: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface MspSow {
  id: number;
  sowId: string;
  offerId: number | null;
  /** Set once signing this SOW kicked off fulfillAcceptedProjectOffer() and it
   * produced a real projects row (Git #2009) — null until then, and always
   * null for a standalone SOW with no offerId. */
  projectId: number | null;
  mspId: number;
  customerId: number | null;
  customerUserId: number | null;
  serviceId: number | null;
  title: string;
  description: string | null;
  amountCents: number;
  currency: string;
  documentHtml: string | null;
  documentGeneratedAt: string | null;
  shareToken: string | null;
  shareTokenExpiresAt: string | null;
  signerName: string | null;
  signatureData: string | null;
  signedAt: string | null;
  signedIp: string | null;
  stripePaymentIntentId: string | null;
  chargeAttemptedAt: string | null;
  chargeConfirmedAt: string | null;
  status: MspSowStatus;
  expiresAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ApiErrorBody {
  error?: string;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      if (typeof body?.error === "string" && body.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

// ── Query keys ────────────────────────────────────────────────────────────────

const offersKey = (mspId: number, state: string) => ["msp", "sales-offers", mspId, state] as const;
const offerEventsKey = (offerId: number) => ["msp", "sales-offers", offerId, "events"] as const;
const packagesKey = ["msp", "sales", "monitoring-packages"] as const;
const bundlesKey = (status: string) => ["msp", "sales-bundles", status] as const;
const bundleKey = (bundleId: string) => ["msp", "sales-bundles", "detail", bundleId] as const;
const bundleAssignmentsKey = (bundleId: string) => ["msp", "sales-bundles", bundleId, "assignments"] as const;
const sowsByOfferKey = (offerId: number) => ["msp", "sows", "by-offer", offerId] as const;
const sowDetailKey = (sowId: string) => ["msp", "sows", "detail", sowId] as const;

// ── Offers ────────────────────────────────────────────────────────────────────

export function useSalesOffers(mspId: number | null, state: SalesOfferState | "all" = "all") {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: offersKey(mspId ?? 0, state),
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: "200" });
      if (state !== "all") qs.set("state", state);
      const res = await fetchWithAuth(`/api/msp/${mspId}/sales-offers?${qs.toString()}`);
      return parseJsonOrThrow<{ offers: SalesOffer[]; limit: number; offset: number }>(res);
    },
    enabled: mspId != null,
  });
}

export function useSalesOfferEvents(offerId: number | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: offerEventsKey(offerId ?? 0),
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/sales-offers/${offerId}/events`);
      return parseJsonOrThrow<{ events: SalesOfferEvent[] }>(res);
    },
    enabled: offerId != null,
  });
}

function invalidateOffers(queryClient: ReturnType<typeof useQueryClient>, mspId: number | null) {
  if (mspId == null) return;
  void queryClient.invalidateQueries({ queryKey: ["msp", "sales-offers", mspId] });
}

export function useGenerateOffers(mspId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (customerId: number) => {
      const res = await fetchWithAuth("/api/msp/sales-offers/generate", {
        method: "POST",
        body: JSON.stringify({ customerId }),
      });
      return parseJsonOrThrow<GenerateOffersResult>(res);
    },
    onSuccess: () => invalidateOffers(queryClient, mspId),
  });
}

export function useExpireStaleOffers(mspId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/msp/${mspId}/sales-offers/expire-stale`, { method: "POST" });
      return parseJsonOrThrow<{ expired: number }>(res);
    },
    onSuccess: () => invalidateOffers(queryClient, mspId),
  });
}

export function useUpdateOfferState(mspId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: number; newState: "sent" | "rejected" | "expired"; rejectionReason?: string }) => {
      const res = await fetchWithAuth(`/api/msp/sales-offers/${input.id}/state`, {
        method: "PATCH",
        body: JSON.stringify({ newState: input.newState, rejectionReason: input.rejectionReason }),
      });
      return parseJsonOrThrow<{ offer: SalesOffer }>(res);
    },
    onSuccess: (_data, vars) => {
      invalidateOffers(queryClient, mspId);
      void queryClient.invalidateQueries({ queryKey: offerEventsKey(vars.id) });
    },
  });
}

export function useUpdateOffer(mspId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: number; title?: string; rationale?: string }) => {
      const res = await fetchWithAuth(`/api/msp/sales-offers/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: input.title, rationale: input.rationale }),
      });
      return parseJsonOrThrow<{ offer: SalesOffer }>(res);
    },
    onSuccess: () => invalidateOffers(queryClient, mspId),
  });
}

export function useDeleteOffer(mspId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/msp/sales-offers/${id}`, { method: "DELETE" });
      return parseJsonOrThrow<{ deleted: boolean; id: number }>(res);
    },
    onSuccess: () => invalidateOffers(queryClient, mspId),
  });
}

/** The one real accept path — see this file's header comment. */
export function useAcceptOffer(mspId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (offerId: number) => {
      const res = await fetchWithAuth(`/api/msp/offers/${offerId}/accept`, { method: "POST" });
      return parseJsonOrThrow<AcceptOfferResult>(res);
    },
    onSuccess: (_data, offerId) => {
      invalidateOffers(queryClient, mspId);
      void queryClient.invalidateQueries({ queryKey: offerEventsKey(offerId) });
      void queryClient.invalidateQueries({ queryKey: sowsByOfferKey(offerId) });
    },
  });
}

// ── Monitoring packages catalog (Packages tab + bundle builder) ─────────────────
// NOTE: this is a genuinely different route than diagnostics-api.ts's
// useMonitoringPackages. The two used to collide on the same bare path
// (Git #3787) — msp-sales-bundles.ts's version here (the full catalog incl.
// dashboard-only "cat-*" rows) always won, leaving msp-diagnostics.ts's
// scan-bundle-only picker unreachable. Fixed by moving the diagnostics-only
// picker to its own `/msp/monitoring-packages/runnable` path; this route
// keeps the bare path since sales-api.ts and the bundle-builder UI depend on
// the full catalog.

export function useSalesMonitoringPackages() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: packagesKey,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/msp/monitoring-packages");
      return parseJsonOrThrow<{ packages: MonitoringPackageFull[] }>(res);
    },
    staleTime: 60_000,
  });
}

// ── Bundles ───────────────────────────────────────────────────────────────────

export function useSalesBundles(status: MspSalesBundleStatus | "all" = "all") {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: bundlesKey(status),
    queryFn: async () => {
      const qs = status === "all" ? "" : `?status=${status}`;
      const res = await fetchWithAuth(`/api/msp/sales-bundles${qs}`);
      return parseJsonOrThrow<{ bundles: MspSalesBundle[]; total: number; limit: number; offset: number }>(res);
    },
  });
}

export function useSalesBundleDetail(bundleId: string | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: bundleKey(bundleId ?? ""),
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/sales-bundles/${bundleId}`);
      return parseJsonOrThrow<{ bundle: MspSalesBundle; packages: MonitoringPackageFull[]; activeAssignmentCount: number }>(res);
    },
    enabled: bundleId != null,
  });
}

function invalidateBundles(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["msp", "sales-bundles"] });
}

export interface CreateBundleInput {
  name: string;
  description?: string;
  monitoringPackageKeys: string[];
  resalePriceCents: number;
  trialDays?: number | null;
  status?: "draft" | "active";
}

export function useCreateBundle() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBundleInput) => {
      const res = await fetchWithAuth("/api/msp/sales-bundles", { method: "POST", body: JSON.stringify(input) });
      return parseJsonOrThrow<{ bundle: MspSalesBundle }>(res);
    },
    onSuccess: () => invalidateBundles(queryClient),
  });
}

export interface UpdateBundleInput {
  bundleId: string;
  name?: string;
  description?: string | null;
  monitoringPackageKeys?: string[];
  resalePriceCents?: number;
  trialDays?: number | null;
  status?: MspSalesBundleStatus;
}

export function useUpdateBundle() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateBundleInput) => {
      const { bundleId, ...body } = input;
      const res = await fetchWithAuth(`/api/msp/sales-bundles/${bundleId}`, { method: "PATCH", body: JSON.stringify(body) });
      return parseJsonOrThrow<{ bundle: MspSalesBundle }>(res);
    },
    onSuccess: (_data, vars) => {
      invalidateBundles(queryClient);
      void queryClient.invalidateQueries({ queryKey: bundleKey(vars.bundleId) });
    },
  });
}

export function useDeleteBundle() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bundleId: string) => {
      const res = await fetchWithAuth(`/api/msp/sales-bundles/${bundleId}`, { method: "DELETE" });
      return parseJsonOrThrow<{ ok: boolean }>(res);
    },
    onSuccess: () => invalidateBundles(queryClient),
  });
}

export function useBundleAssignments(bundleId: string | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: bundleAssignmentsKey(bundleId ?? ""),
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/sales-bundles/${bundleId}/assignments`);
      return parseJsonOrThrow<{ assignments: MspSalesBundleAssignment[] }>(res);
    },
    enabled: bundleId != null,
  });
}

/**
 * Cross-bundle "who has what" (README's `isAssignments` tab). There is no
 * single MSP-wide assignments route — only per-bundle
 * (GET .../sales-bundles/:bundleId/assignments) and per-customer
 * (GET .../customers/:customerId/bundle-assignments). With a small number of
 * bundles per MSP, fanning the per-bundle read out client-side is the real
 * data, not an aggregation invented on top of it.
 */
export function useAllBundleAssignments(bundles: MspSalesBundle[]) {
  const { fetchWithAuth } = useAuth();
  const results = useQueries({
    queries: bundles.map((b) => ({
      queryKey: bundleAssignmentsKey(b.bundleId),
      queryFn: async () => {
        const res = await fetchWithAuth(`/api/msp/sales-bundles/${b.bundleId}/assignments`);
        const body = await parseJsonOrThrow<{ assignments: MspSalesBundleAssignment[] }>(res);
        return body.assignments.map((a) => ({ ...a, bundleName: b.name }));
      },
    })),
  });
  const isLoading = results.some((r) => r.isLoading);
  const isError = results.some((r) => r.isError);
  const assignments = results.flatMap((r) => r.data ?? []);
  return { isLoading, isError, assignments };
}

/** bundleId is per-call, not bound to the hook — the Assignments ("who has
 * what") tab revokes across every bundle in the book, not just one. */
export function useAssignBundle() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bundleId: string; customerId: number }) => {
      const res = await fetchWithAuth(`/api/msp/sales-bundles/${input.bundleId}/assignments`, {
        method: "POST",
        body: JSON.stringify({ customerId: input.customerId }),
      });
      return parseJsonOrThrow<{ assignment: MspSalesBundleAssignment }>(res);
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: bundleAssignmentsKey(vars.bundleId) });
      invalidateBundles(queryClient);
    },
  });
}

export function useRevokeAssignment() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bundleId: string; assignmentId: string }) => {
      const res = await fetchWithAuth(`/api/msp/sales-bundles/${input.bundleId}/assignments/${input.assignmentId}`, { method: "DELETE" });
      return parseJsonOrThrow<{ assignment: MspSalesBundleAssignment }>(res);
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: bundleAssignmentsKey(vars.bundleId) });
    },
  });
}

// ── SOW (view/sign lifecycle — the operator-side half; see msp-sow.ts) ──────────

export function useSowsByOffer(offerId: number | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: sowsByOfferKey(offerId ?? 0),
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/sows?offerId=${offerId}&limit=5`);
      return parseJsonOrThrow<{ items: MspSowSummary[]; total: number }>(res);
    },
    enabled: offerId != null,
  });
}

export function useSowDetail(sowId: string | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: sowDetailKey(sowId ?? ""),
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/sows/${sowId}`);
      return parseJsonOrThrow<MspSow>(res);
    },
    enabled: sowId != null,
  });
}

export function useTriggerSowCharge() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sowId: string) => {
      const res = await fetchWithAuth(`/api/msp/sows/${sowId}/charge`, { method: "POST" });
      return parseJsonOrThrow<{ ok: boolean; message: string }>(res);
    },
    onSuccess: (_data, sowId) => void queryClient.invalidateQueries({ queryKey: sowDetailKey(sowId) }),
  });
}

export function useExpireSow() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sowId: string) => {
      const res = await fetchWithAuth(`/api/msp/sows/${sowId}/expire`, { method: "POST" });
      return parseJsonOrThrow<{ ok: boolean }>(res);
    },
    onSuccess: (_data, sowId) => void queryClient.invalidateQueries({ queryKey: sowDetailKey(sowId) }),
  });
}

/** Opens the real generated SOW document (GET .../document, auth-gated — so a
 * plain <a href> can't carry the bearer token) in a new tab, exactly like
 * diagnostics-api.ts's script download uses fetchWithAuth + a blob URL. */
export function useOpenSowDocument() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async (sowId: string) => {
      const res = await fetchWithAuth(`/api/msp/sows/${sowId}/document`);
      if (!res.ok) {
        let message = `Failed to load document (${res.status})`;
        try {
          const body = (await res.clone().json()) as ApiErrorBody;
          if (typeof body?.error === "string" && body.error) message = body.error;
        } catch { /* non-JSON error body */ }
        throw new Error(message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  });
}
