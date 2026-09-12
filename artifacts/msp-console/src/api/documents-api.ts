/**
 * documents-api.ts — the data seam for the MSP Console's Documents module
 * (Git #2647, Feature #2569). One component, three real screens
 * (`Design/MSP_Console/design_handoff_msp_console/Documents.dc.html`, README
 * screens 22, 32, 33):
 *
 *   Tenant "Documents" page          (screen 22, nav id `hub`)        — customer-scoped
 *   MSP-wide "Documents" page        (screen 32, nav id `docs`)       — unscoped
 *   MSP-wide "SharePoint connectors" (screen 33, nav id `connectors`) — unscoped
 *
 * Backed by two real, distinct route files the design's own README names:
 *
 *   msp-documents-hub.ts — read-only aggregation over insights_generated_documents
 *                          (customer-generated deliverables: reports, SOWs).
 *     GET  /api/msp/documents-hub
 *     GET  /api/msp/documents-hub/:id/view
 *     GET  /api/msp/documents-hub/:id/pdf
 *     POST /api/msp/documents-hub/:id/share
 *
 *   msp-documents.ts     — the MSP's own document authoring/publishing pipeline
 *                          (msp_documents / msp_document_versions / msp_sharepoint_connectors).
 *     POST   /api/msp/documents
 *     GET    /api/msp/documents
 *     GET    /api/msp/documents/:id
 *     POST   /api/msp/documents/:id/versions
 *     GET    /api/msp/documents/:id/versions
 *     POST   /api/msp/documents/:id/publish
 *     GET    /api/msp/sharepoint-connectors
 *     PATCH  /api/msp/sharepoint-connectors/:id
 *
 * Real, honest departures from the design's fixture:
 *   - A hub row's `kind` badge is the document's real, free-text `docType`
 *     (`security_posture_report`, `scoped_sow`, `consolidated_sow`, …), not the
 *     fixture's two invented values ("report" / "scoped SOW"). Its tone comes
 *     from the real `category` enum (`report` | `consulting`).
 *   - The hub filter the design calls "Statements of work" is really the
 *     `category === "consulting"` bucket, which is broader than SOWs alone —
 *     labelled "Consulting" here instead of claiming a category the schema
 *     doesn't have.
 *   - `canShare`/`canPdf` mirror the route's own real gates exactly: the PDF
 *     route requires `status` in (`approved`,`delivered`); the share route
 *     requires that OR `docType === "scoped_sow"` verbatim
 *     (`msp-documents-hub.ts:296`) — a real docType comparison, not a `kind`
 *     string check.
 *   - `autoPublish`: post-#2724 this is a real, honored field — default
 *     `false` now genuinely skips the publish write, leaving the document at
 *     `version_registered`. That is the OPPOSITE of "every document publishes
 *     unconditionally." This seam always sends `autoPublish: true` on submit
 *     and on a new version, because the design's own author-drawer copy
 *     ("There is no draft stop") is a real product promise this UI keeps by
 *     asking for it explicitly, not by relying on the route's default.
 *   - The design's 7-step STEPS ladder (which includes fictional "Logged" /
 *     "Tidied up" stages) is replaced by the real 8-value `DOC_PIPELINE_STATUSES`
 *     enum (`pending` → … → `published`); `failed` is a distinct terminal state,
 *     not a rung on the ladder, because the schema tracks no more granularity
 *     than "the pipeline failed."
 *   - "Where it gets filed → our own SharePoint" needs a specific connector id
 *     the design never asks for; this seam resolves it to the single active
 *     `msp_owned` connector (the design's own copy: "Uses one of our own
 *     connectors. If none resolves, the whole thing stops") rather than
 *     inventing a connector picker the design doesn't show.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

// ── Shared error + fetch helpers (same pattern as data-rights-api.ts) ───────────

export class DocumentsApiError extends Error {
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
    throw new DocumentsApiError(res.status, message);
  }
  return (await res.json()) as T;
}

// ── Hub (customer-generated documents) ──────────────────────────────────────────

export type DocumentCategory = "report" | "consulting";
export type DocumentHubStatus = "draft" | "approved" | "delivered" | "archived" | "generating" | "failed";

export interface HubDocument {
  readonly id: number;
  readonly title: string;
  readonly category: DocumentCategory;
  readonly docType: string;
  readonly status: DocumentHubStatus;
  readonly deliveredAt: string | null;
  readonly createdAt: string;
  readonly sowTotalPrice: number | null;
  readonly projectId: number | null;
  readonly projectTitle: string | null;
  readonly customerId: number | null;
  readonly customerName: string | null;
  readonly deepLink: string | null;
}

export interface HubDocumentsResponse {
  readonly documents: HubDocument[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface HubDocumentView {
  readonly id: number;
  readonly title: string;
  readonly htmlContent: string;
}

export interface HubShareResult {
  readonly shareUrl: string;
  readonly expiresAt: string;
}

const hubKey = (customerId?: number) => ["msp", "documents-hub", customerId ?? "all"] as const;

/** README screens 22 (customerId set) and 32 (unscoped). */
export function useDocumentsHub(customerId?: number): UseQueryResult<HubDocumentsResponse, DocumentsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: hubKey(customerId),
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: "200" });
      if (customerId != null) qs.set("customerId", String(customerId));
      const res = await fetchWithAuth(`/api/msp/documents-hub?${qs.toString()}`);
      return parseJsonOrThrow<HubDocumentsResponse>(res);
    },
    enabled: !isLoading && !!accessToken,
    staleTime: 20_000,
  });
}

/** Fetched lazily when a hub row's preview drawer opens. */
export function useHubDocumentView(id: number | null): UseQueryResult<HubDocumentView, DocumentsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "documents-hub", "view", id],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/documents-hub/${id}/view`);
      return parseJsonOrThrow<HubDocumentView>(res);
    },
    enabled: !isLoading && !!accessToken && id != null,
    staleTime: 60_000,
  });
}

/** The PDF route is bearer-only, so a plain `<a href>` can't authenticate — fetch as a blob and trigger the download by hand. */
export function useDownloadHubPdf() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async ({ id, title }: { id: number; title: string }) => {
      const res = await fetchWithAuth(`/api/msp/documents-hub/${id}/pdf`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new DocumentsApiError(res.status, body?.error ?? `Failed to download PDF (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "-").slice(0, 80) || "document"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  });
}

export function useShareHubDocument() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/msp/documents-hub/${id}/share`, { method: "POST" });
      return parseJsonOrThrow<HubShareResult>(res);
    },
  });
}

// ── Authored (MSP's own document pipeline) ──────────────────────────────────────

export const DOC_PIPELINE_STATUSES = [
  "pending", "html_stored", "pdf_generating", "pdf_ready",
  "sharepoint_uploading", "sharepoint_uploaded", "version_registered", "published",
] as const;
export type DocPipelineStatus = typeof DOC_PIPELINE_STATUSES[number] | "failed";

export type MspDocumentStatus = "draft" | "active" | "archived";
export type ConnectorMode = "platform" | "msp_owned";

export interface AuthoredDocument {
  readonly id: number;
  readonly documentId: string;
  readonly mspId: number;
  readonly customerId: number | null;
  readonly ownerType: "customer" | "msp" | "platform";
  readonly title: string;
  readonly documentType: string;
  readonly status: MspDocumentStatus;
  readonly currentVersionId: string | null;
  readonly createdByUserId: number;
  readonly pipelineStatus: DocPipelineStatus | null;
  readonly pipelineRunId: string | null;
  readonly connectorMode: ConnectorMode;
  readonly connectorId: string | null;
  readonly publishedAt: string | null;
  readonly publishedByUserId: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AuthoredDocumentVersion {
  readonly versionId: string;
  readonly documentId: string;
  readonly versionNumber: number;
  readonly contentHash: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly pdfSizeBytes: number | null;
  readonly sharepointFileId: string | null;
  readonly sharepointFileUrl: string | null;
  readonly pipelineStatus: DocPipelineStatus | null;
  readonly authorUserId: number;
  readonly changeNote: string | null;
  readonly createdAt: string;
}

const authoredKey = (customerId?: number) => ["msp", "documents", customerId ?? "all"] as const;

export function useAuthoredDocuments(customerId?: number): UseQueryResult<{ documents: AuthoredDocument[] }, DocumentsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: authoredKey(customerId),
    queryFn: async () => {
      const qs = customerId != null ? `?customerId=${customerId}` : "";
      const res = await fetchWithAuth(`/api/msp/documents${qs}`);
      return parseJsonOrThrow<{ documents: AuthoredDocument[] }>(res);
    },
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

export function useDocumentVersions(documentId: string | null): UseQueryResult<{ versions: AuthoredDocumentVersion[] }, DocumentsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "documents", documentId, "versions"],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/documents/${documentId}/versions`);
      return parseJsonOrThrow<{ versions: AuthoredDocumentVersion[] }>(res);
    },
    enabled: !isLoading && !!accessToken && !!documentId,
    staleTime: 15_000,
  });
}

export interface SubmitDocumentInput {
  readonly title: string;
  readonly htmlContent: string;
  readonly customerId?: number;
  readonly connectorMode: ConnectorMode;
  readonly connectorId?: string;
}

export function useSubmitDocument(customerId?: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SubmitDocumentInput) => {
      const res = await fetchWithAuth("/api/msp/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // autoPublish: true — see file header re: the real, post-#2724 meaning of this field.
        body: JSON.stringify({ ...input, documentType: "general", autoPublish: true }),
      });
      return parseJsonOrThrow<{ documentId: string; runId: string; message: string }>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: authoredKey(customerId) }),
  });
}

export function useAddDocumentVersion(customerId?: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ documentId, htmlContent, changeNote }: { documentId: string; htmlContent: string; changeNote?: string }) => {
      const res = await fetchWithAuth(`/api/msp/documents/${documentId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ htmlContent, changeNote, autoPublish: true }),
      });
      return parseJsonOrThrow<{ documentId: string; runId: string; message: string }>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: authoredKey(customerId) }),
  });
}

export function usePublishDocument(customerId?: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) => {
      const res = await fetchWithAuth(`/api/msp/documents/${documentId}/publish`, { method: "POST" });
      return parseJsonOrThrow<{ documentId: string; publishedAt: string }>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: authoredKey(customerId) }),
  });
}

// ── SharePoint connectors ────────────────────────────────────────────────────────
// Every row in this table is, by the schema's own design, an MSP-owned
// ("msp_owned") connector — "platform" mode uses env-level Graph secrets and
// writes no row at all (`msp.ts:810-812`). There is no per-row "mode" to show.

export interface SharepointConnector {
  readonly connectorId: string;
  readonly label: string;
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecretRef: string | null;
  readonly sharepointSiteUrl: string | null;
  readonly sharepointSiteId: string | null;
  readonly defaultFolderPath: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
}

const connectorsKey = ["msp", "sharepoint-connectors"] as const;

export function useSharepointConnectors(): UseQueryResult<{ connectors: SharepointConnector[] }, DocumentsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: connectorsKey,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/msp/sharepoint-connectors");
      return parseJsonOrThrow<{ connectors: SharepointConnector[] }>(res);
    },
    enabled: !isLoading && !!accessToken,
    staleTime: 30_000,
  });
}

export function useRetireConnector() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (connectorId: string) => {
      const res = await fetchWithAuth(`/api/msp/sharepoint-connectors/${connectorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      return parseJsonOrThrow<{ ok: true; connectorId: string }>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: connectorsKey }),
  });
}
