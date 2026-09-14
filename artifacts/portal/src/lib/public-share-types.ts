/**
 * Wire types for the 3 public, unauthenticated Public Share Pages routes
 * (#4001, Feature #1663), extracted from
 * `Design/portal/design_handoff_full_site/docs/public-share-pages-contract-pack.md`.
 * These pages render to anonymous visitors holding a share link — no
 * session, no auth context. Real enum vocabularies only, traced to the
 * pack's own field-level tables.
 */

// ── §1 — GET /api/public/documents/:shareToken ──────────────────────────────

export interface PublicSharedDocument {
  title: string;
  htmlContent: string;
  docType: string | null;
  expiresAt: string;
}

// ── §2 — GET /api/public/live-document-shares/:token ────────────────────────

export interface LiveShareStat {
  readonly id: string;
  readonly label: string;
  readonly value: number | null;
  readonly unit?: string;
  readonly unavailableReason?: string;
}

export interface LiveShareFinding {
  readonly severity: string;
  readonly checkKey: string;
  readonly title: string;
}

export interface LiveSharePillar {
  readonly pillar: string;
  readonly score: number | null;
  readonly evaluation: string;
  readonly stats: readonly LiveShareStat[];
  readonly findings: readonly LiveShareFinding[];
  readonly findingCounts: { readonly critical: number; readonly warning: number };
}

export interface LiveShareNarrativeSection {
  readonly key: string;
  readonly heading: string;
  readonly html: string | null;
}

export interface LiveShareReport {
  readonly docType: string;
  readonly title: string;
  readonly sections: readonly LiveShareNarrativeSection[];
}

export interface LiveShareOfferLine {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly title: string;
  readonly rationale: string;
  readonly priceCents: number;
  readonly pillars: readonly string[];
  readonly link: string;
  readonly stage: string;
  readonly durationWeeks: number | null;
}

export interface LiveShareAddon {
  readonly id?: string;
  readonly title?: string;
  readonly [key: string]: unknown;
}

export interface LiveShareOffers {
  readonly offers: readonly LiveShareOfferLine[];
  readonly addons: readonly LiveShareAddon[];
}

export interface LiveDocumentShareSet {
  readonly variant: "review" | "purchasing";
  readonly companyName: string | null;
  readonly pillars: readonly LiveSharePillar[];
  readonly reports: readonly LiveShareReport[];
  readonly offers?: LiveShareOffers;
}

// ── §3/§4 — GET/POST /api/public/sows/:shareToken[/sign] ────────────────────

export const MSP_SOW_STATUSES = ["draft", "sent", "signed", "paid", "failed", "expired"] as const;
export type MspSowStatus = (typeof MSP_SOW_STATUSES)[number];

export interface PublicMspSow {
  sowId: string;
  title: string;
  description: string | null;
  amountCents: number;
  currency: string;
  status: MspSowStatus;
  documentHtml: string | null;
  expiresAt: string | null;
  signedAt: string | null;
  signerName: string | null;
  customerAgreementText: string | null;
}

export interface ApiErrorBody {
  error?: string;
}
