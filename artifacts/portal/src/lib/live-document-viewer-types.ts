/**
 * Wire type for the Live Document Viewer (#2825, Feature #1658):
 *
 *   GET /api/portal/live-documents/:docType
 *
 * (`artifacts/api-server/src/routes/live-document-shares.ts`) — the
 * authenticated, single-document counterpart to the public
 * `GET /api/public/live-document-shares/:token` route. Reuses
 * `LiveSharePillar`/`LiveShareNarrativeSection` from public-share-types.ts
 * rather than redeclaring the same shapes: both routes build these from the
 * exact same `buildPillarSummary()` / narrative-generator functions.
 */
import type { LiveSharePillar, LiveShareNarrativeSection } from "@/lib/public-share-types";

export interface LiveDocumentViewerReport {
  readonly docType: string;
  readonly title: string;
  readonly companyName: string | null;
  readonly pillars: readonly LiveSharePillar[];
  readonly sections: readonly LiveShareNarrativeSection[];
}
