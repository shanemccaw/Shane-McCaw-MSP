/**
 * Wire types for the customer-facing Offers and SOW Acceptance surface
 * (#3997, Feature #1657), extracted from
 * `Design/portal/design_handoff_full_site/docs/offers-and-sow-acceptance-contract-pack.md`
 * against the real, live `portal-offers.ts` / `portal-presentations.ts` routes.
 */

/** `portal-offers.ts` / `portal-presentations.ts` send `{ error: "<message>" }`. */
export interface ApiErrorBody {
  error?: string;
}

/** Customer-safe offer shape — `GET /api/portal/offers`, `/offers/:id`, `/accept`, `/reject`. */
export interface WireCustomerOffer {
  id: number;
  title: string;
  rationale: string | null;
  adjustedPriceCents: number;
  state: "sent" | "accepted" | "rejected" | "expired";
  expiresAt: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  closedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

/** `GET /api/portal/presentations/latest` — entry point to resolve which presentation to view. */
export interface WireLatestPresentation {
  id: number;
  status: "draft" | "signed" | "paid";
  totalPrice: number | null;
  createdAt: string;
}

export interface WireSowPhase {
  id: string;
  title: string;
  description: string;
  price: number;
  selected: boolean;
  weeks?: number;
  deliveryDate?: string | null;
}

export interface WireAdjustmentLine {
  title: string;
  description: string;
  price: number;
}

export interface WirePresentationDocument {
  id: number;
  title: string;
  category: string | null;
  docType: string;
  htmlContent: string;
  sowPricingLines: unknown;
  sowTotalPrice: number | null;
  createdAt: string;
}

/** `GET /api/portal/presentations/:id` — full presentation detail. */
export interface WirePresentationDetail {
  id: number;
  projectId: number | null;
  clientUserId: number | null;
  shareToken: string | null;
  documents: WirePresentationDocument[];
  sowPhases: WireSowPhase[];
  selectedPhaseIds: string[];
  /** Dollars, not cents. */
  totalPrice: number;
  /** Dollars, not cents. */
  adjustmentsTotal: number;
  adjustmentLines: WireAdjustmentLine[];
  sowVersion: string;
  signatureData: string | null;
  signedAt: string | null;
  signerName: string | null;
  paymentPlan: "full" | "phased" | null;
  status: "draft" | "signed" | "paid";
  projectTitle: string | null;
  clientName: string | null;
  contractBody: string | null;
  workflowName: string | null;
  scopedSowHtml: string | null;
  /** Dollars, not cents (the column itself is cents; the server converts). */
  scopedTotalPrice: number | null;
  scopedPhaseIds: string[] | null;
  discountedTotalCents: number | null;
  phaseGenCompleted: boolean;
}

/** `POST /api/portal/presentations/:id/sign` response — field is genuinely dollars (#2511, fixed). */
export interface WireSignResult {
  ok: true;
  signedAt: string;
  effectivePrice: number;
  scopedPhaseIds: string[] | null;
}

/** `GET /api/portal/offers/sse` frame payloads. */
export interface OfferSSEEvent {
  type: "connected" | "offer_changed";
  customerId?: number;
  offerId?: number;
  state?: "accepted" | "rejected";
}
