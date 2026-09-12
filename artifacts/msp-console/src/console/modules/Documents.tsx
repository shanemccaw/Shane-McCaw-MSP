/**
 * Documents — MSP Console module page (Git #2647, Feature #2569). One
 * component mounts into all three of the design's document screens
 * (`Design/MSP_Console/design_handoff_msp_console/Documents.dc.html`, README
 * screens 22, 32, 33):
 *
 *   Tenant "Documents" page          (screen 22) — `<Documents scopeCustomerId scopeCustomerName initialTab="hub" />`
 *   MSP-wide "Documents" page        (screen 32) — `<Documents initialTab="hub" />`
 *   MSP-wide "SharePoint connectors" (screen 33) — `<Documents initialTab="connectors" />`
 *
 * Three tabs, exactly as the design's own logic class:
 *
 *   For customers ("hub")  — read-only aggregation of customer-generated
 *                             deliverables (reports, SOWs) over
 *                             `insights_generated_documents`, via
 *                             `msp-documents-hub.ts`. This view reads and
 *                             shares them; it never edits or regenerates one.
 *   Ours ("authored")      — the MSP's own document authoring/publishing
 *                             pipeline (`msp_documents`), via `msp-documents.ts`.
 *   Where they go ("connectors") — the MSP's own SharePoint connector rows
 *                             (`msp_sharepoint_connectors`).
 *
 * Real, honest departures from the design's fixture — see the header comment
 * in `@/api/documents-api` for the full list (kind/category, the "Statements
 * of work" filter, canShare/canPdf's real gates, autoPublish's real post-#2724
 * meaning, and the real 8-value pipeline ladder replacing the fixture's
 * 7-step one). Two more, specific to this component:
 *
 *   - `GET /api/msp/documents` returns no customer NAME (unlike the hub route,
 *     it does not join `tenants`) — an authored document owned by a customer
 *     shows that tenant's name when this page is itself tenant-scoped (the
 *     name is already in hand via `scopeCustomerName`), and a numeric
 *     "customer #<id>" otherwise. No name is invented where the API doesn't
 *     supply one.
 *   - The design's author drawer has no connector picker; this build resolves
 *     "our own SharePoint" to the single active `msp_owned` connector
 *     automatically, per the design's own copy ("uses one of our own
 *     connectors"). If none is active, submitting with that destination is
 *     disabled rather than silently failing the pipeline run.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Icon, type IconName } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import {
  DOC_PIPELINE_STATUSES,
  DocumentsApiError,
  useAddDocumentVersion,
  useAuthoredDocuments,
  useDocumentsHub,
  useDocumentVersions,
  useDownloadHubPdf,
  useHubDocumentView,
  usePublishDocument,
  useRetireConnector,
  useSharepointConnectors,
  useShareHubDocument,
  useSubmitDocument,
  type AuthoredDocument,
  type ConnectorMode,
  type DocPipelineStatus,
  type DocumentCategory,
  type DocumentHubStatus,
  type HubDocument,
  type HubShareResult,
  type SharepointConnector,
} from "@/api/documents-api";

type Tab = "hub" | "authored" | "connectors";
type HubFilter = "all" | "report" | "consulting" | "shareable";

// ── Display helpers ──────────────────────────────────────────────────────────────

function statusTone(status: DocumentHubStatus) {
  switch (status) {
    case "delivered": return signal.ok;
    case "approved": return signal.info;
    case "draft": return signal.warning;
    case "generating": return signal.notice;
    case "failed": return signal.critical;
    case "archived": return signal.neutral;
  }
}

function categoryTone(category: DocumentCategory) {
  return category === "consulting" ? signal.notice : signal.info;
}

/** `signal.notice`/`signal.neutral` carry no `.text` shade (only `strong`/`tint`/`border`) — fall back to `.strong`. */
function toneText(t: { strong: string; text?: string }): string {
  return t.text ?? t.strong;
}

function humanize(value: string): string {
  return value.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

function money(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1).replace(".0", "") + "m";
  if (n >= 1_000) return "$" + Math.round(n / 1_000) + "k";
  return "$" + n;
}

function formatDay(iso: string | null): string {
  if (!iso) return "not yet";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** `docType === "scoped_sow"` verbatim — the exact real gate `msp-documents-hub.ts:296` checks. */
function canShareHub(doc: HubDocument): boolean {
  return doc.status === "approved" || doc.status === "delivered" || doc.docType === "scoped_sow";
}
function canPdfHub(doc: HubDocument): boolean {
  return doc.status === "approved" || doc.status === "delivered";
}

// ── Root ──────────────────────────────────────────────────────────────────────────

export function Documents({
  scopeCustomerId,
  scopeCustomerName,
  initialTab = "hub",
}: {
  scopeCustomerId?: number;
  scopeCustomerName?: string;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [hubFilter, setHubFilter] = useState<HubFilter>("all");
  const [hubSelId, setHubSelId] = useState<number | null>(null);
  const [shareResults, setShareResults] = useState<Record<number, HubShareResult>>({});
  const [docSelId, setDocSelId] = useState<string | null>(null);
  const [authorOpen, setAuthorOpen] = useState(false);
  const [versionForDocId, setVersionForDocId] = useState<string | null>(null);

  const hubQuery = useDocumentsHub(scopeCustomerId);
  const authoredQuery = useAuthoredDocuments(scopeCustomerId);
  const connectorsQuery = useSharepointConnectors();

  const hubDocs = hubQuery.data?.documents ?? [];
  const authoredDocs = authoredQuery.data?.documents ?? [];
  const connectors = connectorsQuery.data?.connectors ?? [];

  const filterDefs: { id: HubFilter; label: string; match: (d: HubDocument) => boolean }[] = [
    { id: "all", label: "Everything", match: () => true },
    { id: "report", label: "Reports", match: (d) => d.category === "report" },
    { id: "consulting", label: "Consulting", match: (d) => d.category === "consulting" },
    { id: "shareable", label: "Shareable", match: canShareHub },
  ];
  const activeFilter = filterDefs.find((f) => f.id === hubFilter) ?? filterDefs[0];
  const visibleHub = hubDocs.filter(activeFilter.match);
  const hubSel = hubSelId != null ? hubDocs.find((d) => d.id === hubSelId) ?? null : null;
  const docSel = docSelId != null ? authoredDocs.find((d) => d.documentId === docSelId) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {(
          [
            { id: "hub" as const, label: "For customers", count: hubDocs.length },
            { id: "authored" as const, label: "Ours", count: authoredDocs.length },
            { id: "connectors" as const, label: "Where they go", count: connectors.length },
          ]
        ).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 7,
                border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
                background: active ? "rgba(37,99,235,.18)" : "transparent",
                color: active ? "#bfdbfe" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {t.label}
              <span style={{ fontSize: 10.5, color: active ? signal.info.strong : text.faint }}>{t.count}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        {tab === "authored" && (
          <button
            onClick={() => setAuthorOpen(true)}
            style={{
              display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: 7,
              border: "1px solid #2563eb", background: "#2563eb", color: "#fff",
              fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            <Icon name="plus" size={13} />
            Write a document
          </button>
        )}
      </div>

      {tab === "hub" && (
        <HubTab
          docs={hubDocs}
          visible={visibleHub}
          filterDefs={filterDefs}
          filter={hubFilter}
          onFilter={setHubFilter}
          loading={hubQuery.isLoading}
          error={hubQuery.isError}
          errorMessage={hubQuery.error?.message}
          scoped={scopeCustomerId != null}
          onOpen={(id) => setHubSelId(id)}
        />
      )}

      {tab === "authored" && (
        <AuthoredTab
          docs={authoredDocs}
          loading={authoredQuery.isLoading}
          error={authoredQuery.isError}
          errorMessage={authoredQuery.error?.message}
          scopeCustomerName={scopeCustomerName}
          onOpen={(id) => setDocSelId(id)}
        />
      )}

      {tab === "connectors" && (
        <ConnectorsTab
          connectors={connectors}
          loading={connectorsQuery.isLoading}
          error={connectorsQuery.isError}
          errorMessage={connectorsQuery.error?.message}
        />
      )}

      {hubSel && (
        <HubDetailDrawer doc={hubSel} shareResult={shareResults[hubSel.id] ?? null} onShared={(r) => setShareResults((prev) => ({ ...prev, [hubSel.id]: r }))} onClose={() => setHubSelId(null)} />
      )}

      {docSel && (
        <DocDetailDrawer
          doc={docSel}
          onClose={() => setDocSelId(null)}
          onNewVersion={() => { setVersionForDocId(docSel.documentId); setDocSelId(null); }}
        />
      )}

      {authorOpen && (
        <AuthorDrawer
          scopeCustomerId={scopeCustomerId}
          scopeCustomerName={scopeCustomerName}
          connectors={connectors}
          onClose={() => setAuthorOpen(false)}
        />
      )}

      {versionForDocId && (
        <NewVersionDrawer documentId={versionForDocId} onClose={() => setVersionForDocId(null)} />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 2 }}>
        <Icon name="info" size={13} color={text.faint} />
        <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
          {tab === "hub"
            ? "The platform generated these for customers. This view reads and shares them — it never edits or regenerates one."
            : tab === "authored"
              ? "Submitting a document runs the whole pipeline through to published. There is no draft stop, and the PDF it produces is plain text — layout, images and tables do not survive."
              : "Credentials are held in the vault and only ever referenced by name. Nothing on this screen can show a secret back to you, and only an admin can add or change one."}
        </span>
      </div>
    </div>
  );
}

// ── Empty/error state panel (shared) ─────────────────────────────────────────────

function StatePanel({
  icon, tone, title, body, wire,
}: {
  icon: IconName;
  tone: { strong: string; text: string; tint: string; border: string };
  title: string;
  body: string;
  wire: string;
}) {
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 22, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 13, background: tone.tint, border: `1px solid ${tone.border}` }}>
        <Icon name={icon} size={20} color={tone.text} />
      </span>
      <span style={{ fontSize: 16, fontWeight: 700, color: text.title }}>{title}</span>
      <span style={{ fontSize: 13, color: text.muted, textWrap: "pretty", lineHeight: 1.5 }}>{body}</span>
      <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.faint, wordBreak: "break-all" }}>{wire}</span>
    </div>
  );
}

function EmptyPanel({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
      <span style={{ width: 42, height: 42, borderRadius: 13, background: signal.info.tint, border: `1px solid ${signal.info.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={20} color={signal.info.strong} />
      </span>
      <span style={{ fontSize: 15.5, fontWeight: 700, color: text.title }}>{title}</span>
      <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 440, textWrap: "pretty" }}>{body}</span>
    </div>
  );
}

// ── Hub tab ("For customers") ────────────────────────────────────────────────────

function HubTab({
  docs, visible, filterDefs, filter, onFilter, loading, error, errorMessage, scoped, onOpen,
}: {
  docs: HubDocument[];
  visible: HubDocument[];
  filterDefs: { id: HubFilter; label: string }[];
  filter: HubFilter;
  onFilter: (f: HubFilter) => void;
  loading: boolean;
  error: boolean;
  errorMessage: string | undefined;
  scoped: boolean;
  onOpen: (id: number) => void;
}) {
  if (loading) return <div style={{ fontSize: 11.5, color: text.muted }}>Loading customer documents…</div>;
  if (error) {
    return (
      <StatePanel
        icon="triangle-alert" tone={signal.warning}
        title="Documents could not be loaded"
        body={errorMessage ?? "The request failed. Try again shortly."}
        wire="GET /api/msp/documents-hub"
      />
    );
  }
  if (docs.length === 0) {
    return (
      <EmptyPanel
        icon="files"
        title="Nothing generated yet"
        body={scoped
          ? "This tenant has no reports or statements of work generated yet."
          : "No customer has a generated report or statement of work yet."}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        {filterDefs.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => onFilter(f.id)}
              style={{
                height: 28, padding: "0 10px", borderRadius: 7,
                border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
                background: active ? "rgba(37,99,235,.18)" : "transparent",
                color: active ? "#bfdbfe" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {f.label}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: text.label, whiteSpace: "nowrap" }}>{visible.length} of {docs.length} documents</span>
      </div>

      <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflowX: "auto" }}>
        <div style={{ minWidth: 1020 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2.4fr 1.3fr 1.2fr 1.1fr 1.1fr 120px", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.soft}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
            <span>DOCUMENT</span><span>CUSTOMER</span><span>KIND</span><span>STATE</span><span>DELIVERED</span><span style={{ textAlign: "right" }} />
          </div>
          {visible.map((d) => {
            const st = statusTone(d.status);
            const kd = categoryTone(d.category);
            return (
              <div
                key={d.id}
                onClick={() => onOpen(d.id)}
                style={{ display: "grid", gridTemplateColumns: "2.4fr 1.3fr 1.2fr 1.1fr 1.1fr 120px", gap: 12, alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${border.faint}`, cursor: "pointer" }}
              >
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: text.title, textWrap: "pretty" }}>{d.title}</span>
                  <span style={{ fontSize: 11, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.projectTitle ?? "no linked project"}</span>
                </span>
                <span style={{ fontSize: 12, color: text.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.customerName ?? "unknown"}</span>
                <span style={{ display: "inline-flex", justifySelf: "start", padding: "3px 10px", borderRadius: 999, background: kd.tint, border: `1px solid ${kd.border}`, fontSize: 11, fontWeight: 600, color: toneText(kd), whiteSpace: "nowrap" }}>{humanize(d.docType)}</span>
                <span style={{ display: "inline-flex", justifySelf: "start", padding: "3px 10px", borderRadius: 999, background: st.tint, border: `1px solid ${st.border}`, fontSize: 11, fontWeight: 600, color: toneText(st), whiteSpace: "nowrap" }}>{d.status}</span>
                <span style={{ fontSize: 12, color: text.muted, whiteSpace: "nowrap" }}>{formatDay(d.deliveredAt)}</span>
                <span style={{ justifySelf: "end", fontSize: 12, color: text.secondary, whiteSpace: "nowrap" }}>{d.sowTotalPrice ? money(d.sowTotalPrice) : ""}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HubDetailDrawer({
  doc, shareResult, onShared, onClose,
}: {
  doc: HubDocument;
  shareResult: HubShareResult | null;
  onShared: (r: HubShareResult) => void;
  onClose: () => void;
}) {
  const viewQuery = useHubDocumentView(doc.id);
  const downloadPdf = useDownloadHubPdf();
  const share = useShareHubDocument();

  const canPdf = canPdfHub(doc);
  const canShare = canShareHub(doc);
  const preview = viewQuery.data ? stripHtml(viewQuery.data.htmlContent).slice(0, 700) : null;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(500px,95%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.info.text }}>{(doc.customerName ?? "UNKNOWN CUSTOMER").toUpperCase()}</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>{doc.title}</span>
            <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>{doc.projectTitle ?? "Not linked to a project"}</span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "none", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 11 }}>
          <Fact label="KIND" value={humanize(doc.docType)} color={text.secondary} />
          <Fact label="STATE" value={doc.status} color={statusTone(doc.status).strong} />
          <Fact label="DELIVERED" value={formatDay(doc.deliveredAt)} color={text.muted} />
          <Fact label="VALUE" value={doc.sowTotalPrice ? money(doc.sowTotalPrice) : "not priced"} color={doc.sowTotalPrice ? text.secondary : text.label} />
        </div>

        <div style={{ border: `1px solid ${border.card}`, borderRadius: 11, background: "rgba(2,6,23,.5)", padding: 16, display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>PREVIEW</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: text.strong, letterSpacing: "-.01em", textWrap: "pretty" }}>{doc.title}</span>
          {viewQuery.isLoading ? (
            <span style={{ fontSize: 12, color: text.muted }}>Loading…</span>
          ) : viewQuery.isError ? (
            <span style={{ fontSize: 12, color: signal.warning.text }}>{viewQuery.error.message}</span>
          ) : (
            <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>{preview}{preview && preview.length >= 700 ? "…" : ""}</span>
          )}
          <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>Shown as the customer sees it, with any internal review banner removed.</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => canPdf && downloadPdf.mutate({ id: doc.id, title: doc.title }, { onError: (err) => toast.error(err instanceof DocumentsApiError ? err.message : "Failed to download the PDF.") })}
              disabled={!canPdf || downloadPdf.isPending}
              title={canPdf ? "Built fresh each time you ask for it" : "Only an approved or delivered document can be downloaded"}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 12px", borderRadius: 8,
                border: `1px solid ${canPdf ? "#2563eb" : border.card}`,
                background: canPdf ? "#2563eb" : "transparent",
                color: canPdf ? "#fff" : text.label,
                fontSize: 12.5, fontWeight: 600, cursor: canPdf ? "pointer" : "not-allowed", opacity: canPdf ? 1 : 0.6, whiteSpace: "nowrap",
              }}
            >
              <Icon name={canPdf ? "download" : "lock"} size={13} />
              {downloadPdf.isPending ? "Building…" : "Download the PDF"}
            </button>
            <button
              onClick={() => canShare && share.mutate(doc.id, {
                onSuccess: onShared,
                onError: (err) => toast.error(err instanceof DocumentsApiError ? err.message : "Failed to create the share link."),
              })}
              disabled={!canShare || share.isPending}
              title={canShare ? "" : "Not shareable until it is approved or delivered"}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 12px", borderRadius: 8,
                border: `1px solid ${canShare ? border.card : border.card}`,
                background: "transparent",
                color: canShare ? text.secondary : text.label,
                fontSize: 12.5, fontWeight: 600, cursor: canShare ? "pointer" : "not-allowed", opacity: canShare ? 1 : 0.6, whiteSpace: "nowrap",
              }}
            >
              <Icon name={canShare ? "link" : "lock"} size={13} />
              {share.isPending ? "Creating…" : shareResult ? "Replace the link" : "Create a share link"}
            </button>
          </div>
          <span style={{ fontSize: 11.5, color: canPdf ? text.label : signal.warning.text, textWrap: "pretty" }}>
            {canPdf
              ? "The preview above is always available. The PDF and the share link are only offered once the document is approved or delivered."
              : "Still being worked on, so only the preview is available. A scoped statement of work can be shared before approval; nothing else can."}
          </span>
          {shareResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: 11, borderRadius: 10, border: `1px solid ${signal.info.border}`, background: "rgba(37,99,235,.08)" }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.info.text }}>SHARE LINK · EXPIRES {formatDay(shareResult.expiresAt)}</span>
              <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.secondary, wordBreak: "break-all" }}>{shareResult.shareUrl}</span>
              <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>Creating another link replaces this one. There is only ever one live link per document.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{label}</span>
      <span style={{ fontSize: 12.5, color, textWrap: "pretty" }}>{value}</span>
    </div>
  );
}

// ── Authored tab ("Ours") ────────────────────────────────────────────────────────

const PIPELINE_LABELS: Record<string, string> = {
  pending: "Queued", html_stored: "Content stored", pdf_generating: "PDF generating", pdf_ready: "PDF produced",
  sharepoint_uploading: "Filing in SharePoint", sharepoint_uploaded: "Filed in SharePoint",
  version_registered: "Version recorded", published: "Published",
};

function pipelineIndex(status: DocPipelineStatus | null): number {
  if (!status || status === "failed") return -1;
  return DOC_PIPELINE_STATUSES.indexOf(status);
}

function AuthoredTab({
  docs, loading, error, errorMessage, scopeCustomerName, onOpen,
}: {
  docs: AuthoredDocument[];
  loading: boolean;
  error: boolean;
  errorMessage: string | undefined;
  scopeCustomerName: string | undefined;
  onOpen: (documentId: string) => void;
}) {
  if (loading) return <div style={{ fontSize: 11.5, color: text.muted }}>Loading documents we've authored…</div>;
  if (error) {
    return (
      <StatePanel icon="triangle-alert" tone={signal.warning} title="Documents could not be loaded" body={errorMessage ?? "The request failed. Try again shortly."} wire="GET /api/msp/documents" />
    );
  }
  if (docs.length === 0) {
    return <EmptyPanel icon="file-plus" title="Nothing published yet" body="Write a document here and it is turned into a PDF, filed in SharePoint and published in one pass." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {docs.map((a) => {
        const failed = a.pipelineStatus === "failed";
        const done = a.pipelineStatus === "published";
        const tone = failed ? signal.critical : done ? signal.ok : signal.info;
        const idx = pipelineIndex(a.pipelineStatus);
        const owner = a.ownerType === "customer"
          ? (scopeCustomerName ? `for ${scopeCustomerName}` : a.customerId != null ? `for customer #${a.customerId}` : "for a customer")
          : "ours";
        return (
          <div key={a.documentId} onClick={() => onOpen(a.documentId)} style={{ border: `1px solid ${done ? border.card : failed ? signal.critical.border : "rgba(96,165,250,.24)"}`, borderRadius: 12, background: surface.card, padding: 15, display: "flex", flexDirection: "column", gap: 12, minWidth: 0, cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 11, flexWrap: "wrap" }}>
              <span style={{ width: 30, height: 30, flex: "0 0 30px", borderRadius: 9, background: tone.tint, border: `1px solid ${tone.border}`, color: tone.strong, padding: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="file-text" size={16} />
              </span>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 180, flex: 1 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: text.title, textWrap: "pretty" }}>{a.title}</span>
                <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>{humanize(a.documentType)} · {owner}</span>
              </span>
              <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 999, background: tone.tint, border: `1px solid ${tone.border}`, fontSize: 11, fontWeight: 600, color: tone.text, whiteSpace: "nowrap" }}>
                {failed ? "failed" : done ? "published" : "working through it"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              {!failed && DOC_PIPELINE_STATUSES.map((st, n) => {
                const state = n < idx ? "done" : n === idx ? "now" : "todo";
                const t = state === "done" ? signal.ok : state === "now" ? signal.info : signal.neutral;
                return (
                  <span key={st} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 7, background: state === "todo" ? "rgba(148,163,184,.05)" : t.tint, border: `1px solid ${state === "todo" ? border.soft : t.border}`, fontSize: 10.5, fontWeight: 600, color: state === "todo" ? text.faint : t.strong, whiteSpace: "nowrap" }}>
                    <Icon name={state === "done" ? "check" : state === "now" ? "loader" : "circle"} size={10} />
                    {PIPELINE_LABELS[st]}
                  </span>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap", paddingTop: 10, borderTop: `1px solid ${border.soft}` }}>
              <span style={{ fontSize: 11.5, color: text.muted, whiteSpace: "nowrap" }}>filed via {a.connectorMode === "platform" ? "platform SharePoint" : "our own SharePoint"}</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: text.label, whiteSpace: "nowrap" }}>
                {a.publishedAt ? `published ${formatDay(a.publishedAt)}` : `updated ${formatWhen(a.updatedAt)}`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DocDetailDrawer({
  doc, onClose, onNewVersion,
}: {
  doc: AuthoredDocument;
  onClose: () => void;
  onNewVersion: () => void;
}) {
  const versionsQuery = useDocumentVersions(doc.documentId);
  const publish = usePublishDocument(doc.customerId ?? undefined);
  const versions = versionsQuery.data?.versions ?? [];
  const currentVersion = versions.find((v) => v.versionId === doc.currentVersionId) ?? versions[0] ?? null;
  const failed = doc.pipelineStatus === "failed";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(500px,95%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.info.text }}>{humanize(doc.documentType).toUpperCase()} · {doc.ownerType.toUpperCase()}</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>{doc.title}</span>
            <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>{doc.status} · filed via {doc.connectorMode === "platform" ? "platform SharePoint" : "our own SharePoint"}</span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "none", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        {failed ? (
          <div style={{ display: "flex", gap: 10, padding: 12, borderRadius: 10, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint }}>
            <Icon name="triangle-alert" size={15} color={signal.critical.strong} />
            <span style={{ fontSize: 12.5, color: text.secondary, textWrap: "pretty" }}>The pipeline failed for this document. Submit a new version to try again.</span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>WHERE IT IS UP TO</span>
            {DOC_PIPELINE_STATUSES.map((st, n) => {
              const idx = pipelineIndex(doc.pipelineStatus);
              const state = n < idx ? "done" : n === idx ? "now" : "todo";
              const color = state === "done" ? signal.ok.strong : state === "now" ? signal.info.strong : text.faint;
              return (
                <div key={st} style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0 }}>
                  <Icon name={state === "done" ? "circle-check-big" : state === "now" ? "loader" : "circle"} size={15} color={color} />
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: state === "todo" ? text.label : text.strong }}>{PIPELINE_LABELS[st]}</span>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>VERSIONS</span>
          {versionsQuery.isLoading ? (
            <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span>
          ) : versions.length === 0 ? (
            <span style={{ fontSize: 11.5, color: text.muted }}>No versions recorded yet.</span>
          ) : (
            versions.map((v) => {
              const isCurrent = v.versionId === doc.currentVersionId;
              return (
                <div key={v.versionId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 10, border: `1px solid ${isCurrent ? "rgba(96,165,250,.24)" : border.soft}`, background: isCurrent ? "rgba(37,99,235,.08)" : "rgba(2,6,23,.4)", minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong, flex: "0 0 auto" }}>v{v.versionNumber}</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{v.changeNote || "No change note"}</span>
                    <span style={{ fontSize: 11, color: text.faint }}>{formatWhen(v.createdAt)}</span>
                  </div>
                  {isCurrent && (
                    <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 999, background: "rgba(96,165,250,.12)", border: "1px solid rgba(96,165,250,.28)", fontSize: 10.5, fontWeight: 600, color: signal.info.text, whiteSpace: "nowrap", flex: "0 0 auto" }}>current</span>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={onNewVersion}
              style={{ display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 12px", borderRadius: 8, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              <Icon name="file-plus" size={13} />
              New version
            </button>
            <button
              onClick={() => currentVersion?.sharepointFileUrl && window.open(currentVersion.sharepointFileUrl, "_blank", "noopener")}
              disabled={!currentVersion?.sharepointFileUrl}
              title={currentVersion?.sharepointFileUrl ? "" : "Not filed in SharePoint yet"}
              style={{ display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 12px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: currentVersion?.sharepointFileUrl ? text.secondary : text.label, fontSize: 12.5, fontWeight: 600, cursor: currentVersion?.sharepointFileUrl ? "pointer" : "not-allowed", opacity: currentVersion?.sharepointFileUrl ? 1 : 0.6, whiteSpace: "nowrap" }}
            >
              <Icon name="external-link" size={13} />
              Open the filed copy
            </button>
            <button
              onClick={() => doc.status !== "archived" && publish.mutate(doc.documentId, { onError: (err) => toast.error(err instanceof DocumentsApiError ? err.message : "Failed to publish.") })}
              disabled={doc.status === "archived" || publish.isPending}
              title={doc.status === "archived" ? "Archived documents can't be republished" : "Re-stamps the published date — it does not warn you it was already published"}
              style={{ display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 12px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: doc.status === "archived" ? text.label : text.secondary, fontSize: 12.5, fontWeight: 600, cursor: doc.status === "archived" ? "not-allowed" : "pointer", opacity: doc.status === "archived" ? 0.6 : 1, whiteSpace: "nowrap" }}
            >
              <Icon name={doc.status === "archived" ? "lock" : "upload"} size={13} />
              {publish.isPending ? "Publishing…" : "Publish again"}
            </button>
          </div>
          <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
            Publishing again re-stamps the date rather than telling you it was already published. Progress has to be refreshed to be seen — nothing pushes an update to this drawer while the pipeline runs.
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Author drawer (new document) ─────────────────────────────────────────────────

function AuthorDrawer({
  scopeCustomerId, scopeCustomerName, connectors, onClose,
}: {
  scopeCustomerId: number | undefined;
  scopeCustomerName: string | undefined;
  connectors: SharepointConnector[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [owner, setOwner] = useState<"us" | "customer">("us");
  const [dest, setDest] = useState<ConnectorMode>("platform");
  const submit = useSubmitDocument(scopeCustomerId);

  const activeConnector = connectors.find((c) => c.isActive) ?? null;
  const customerLabel = scopeCustomerName ?? (scopeCustomerId != null ? `customer #${scopeCustomerId}` : null);
  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && (dest === "platform" || !!activeConnector);

  const doSubmit = () => {
    if (!canSubmit) return;
    submit.mutate(
      {
        title: title.trim(),
        htmlContent: body,
        customerId: owner === "customer" ? scopeCustomerId : undefined,
        connectorMode: dest,
        connectorId: dest === "msp_owned" ? activeConnector?.connectorId : undefined,
      },
      {
        onSuccess: () => { toast.success("Document submitted — the pipeline is running."); onClose(); },
        onError: (err) => toast.error(err instanceof DocumentsApiError ? err.message : "Failed to submit the document."),
      },
    );
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 91, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(470px,94%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.info.text }}>NEW DOCUMENT</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>Write and publish</span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "none", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What this document is" style={inputStyle} />
        </Field>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>Who it belongs to</span>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            <ToggleButton active={owner === "us"} label="us" onClick={() => setOwner("us")} />
            {customerLabel && <ToggleButton active={owner === "customer"} label={customerLabel} onClick={() => setOwner("customer")} />}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>Where it gets filed</span>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            <ToggleButton active={dest === "platform"} label="platform SharePoint" onClick={() => setDest("platform")} />
            <ToggleButton active={dest === "msp_owned"} label="our own SharePoint" onClick={() => setDest("msp_owned")} />
          </div>
          <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>
            {dest === "msp_owned"
              ? activeConnector
                ? `Uses ${activeConnector.label}, the one active connector on file.`
                : "No active connector is configured — add one before filing here, or the pipeline stops rather than filing it somewhere else."
              : "Uses the shared platform library."}
          </span>
        </div>

        <Field label="The document itself">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Paste or write the content" style={{ ...inputStyle, minHeight: 120, padding: "10px 11px", fontFamily: "Menlo, monospace", fontSize: 12.5, resize: "vertical" as const }} />
        </Field>

        <div style={{ display: "flex", gap: 10, padding: "12px 13px", borderRadius: 10, border: `1px solid ${signal.warning.border}`, background: signal.warning.tint }}>
          <Icon name="triangle-alert" size={15} color={signal.warning.strong} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: text.title, textWrap: "pretty" }}>Submitting runs the whole thing through to published</span>
            <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>There is no draft stop. The PDF it produces is plain text today — layout, images and tables do not survive.</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
          <button
            onClick={doSubmit}
            disabled={!canSubmit || submit.isPending}
            title={canSubmit ? "" : "A title and some content are both needed"}
            style={{ flex: 1, height: 38, borderRadius: 8, border: `1px solid ${canSubmit ? "#2563eb" : border.card}`, background: canSubmit ? "#2563eb" : "transparent", color: canSubmit ? "#fff" : text.label, fontSize: 13, fontWeight: 600, cursor: canSubmit && !submit.isPending ? "pointer" : "not-allowed", opacity: canSubmit ? 1 : 0.6 }}
          >
            {submit.isPending ? "Submitting…" : "Submit and publish"}
          </button>
          <button onClick={onClose} style={{ height: 38, padding: "0 15px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 13, cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function NewVersionDrawer({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const [changeNote, setChangeNote] = useState("");
  const [body, setBody] = useState("");
  const addVersion = useAddDocumentVersion();
  const canSubmit = body.trim().length > 0;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 91, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(470px,94%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.info.text }}>NEW VERSION</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>Runs the pipeline again</span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "none", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <Field label="Change note (optional)">
          <input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="What changed in this version" style={inputStyle} />
        </Field>

        <Field label="The document itself">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Paste or write the new content" style={{ ...inputStyle, minHeight: 160, padding: "10px 11px", fontFamily: "Menlo, monospace", fontSize: 12.5, resize: "vertical" as const }} />
        </Field>

        <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
          <button
            onClick={() => canSubmit && addVersion.mutate(
              { documentId, htmlContent: body, changeNote: changeNote.trim() || undefined },
              {
                onSuccess: () => { toast.success("New version submitted — the pipeline is running."); onClose(); },
                onError: (err) => toast.error(err instanceof DocumentsApiError ? err.message : "Failed to submit the version."),
              },
            )}
            disabled={!canSubmit || addVersion.isPending}
            title={canSubmit ? "" : "Content is needed"}
            style={{ flex: 1, height: 38, borderRadius: 8, border: `1px solid ${canSubmit ? "#2563eb" : border.card}`, background: canSubmit ? "#2563eb" : "transparent", color: canSubmit ? "#fff" : text.label, fontSize: 13, fontWeight: 600, cursor: canSubmit && !addVersion.isPending ? "pointer" : "not-allowed", opacity: canSubmit ? 1 : 0.6 }}
          >
            {addVersion.isPending ? "Submitting…" : "Submit and publish"}
          </button>
          <button onClick={onClose} style={{ height: 38, padding: "0 15px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 13, cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>{label}</span>
      {children}
    </div>
  );
}

function ToggleButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 30, padding: "0 11px", borderRadius: 7,
        border: `1px solid ${active ? "rgba(96,165,250,.32)" : border.card}`,
        background: active ? "rgba(37,99,235,.18)" : "transparent",
        color: active ? "#bfdbfe" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  height: 36, padding: "0 11px", borderRadius: 8, border: `1px solid ${border.card}`,
  background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 13, outline: "none",
};

// ── Connectors tab ("Where they go") ─────────────────────────────────────────────

function ConnectorsTab({
  connectors, loading, error, errorMessage,
}: {
  connectors: SharepointConnector[];
  loading: boolean;
  error: boolean;
  errorMessage: string | undefined;
}) {
  const retire = useRetireConnector();

  if (loading) return <div style={{ fontSize: 11.5, color: text.muted }}>Loading SharePoint connectors…</div>;
  if (error) {
    return <StatePanel icon="triangle-alert" tone={signal.warning} title="Connectors could not be loaded" body={errorMessage ?? "The request failed. Try again shortly."} wire="GET /api/msp/sharepoint-connectors" />;
  }
  if (connectors.length === 0) {
    return <EmptyPanel icon="folder-open" title="No SharePoint connectors configured" body="Documents filed under &quot;our own SharePoint&quot; need at least one active connector here first." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {connectors.map((c) => {
        const t = c.isActive ? signal.ok : signal.neutral;
        return (
          <div key={c.connectorId} style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 15, display: "flex", flexDirection: "column", gap: 12, minWidth: 0, opacity: c.isActive ? 1 : 0.72 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 11, flexWrap: "wrap" }}>
              <span style={{ width: 30, height: 30, flex: "0 0 30px", borderRadius: 9, background: t.tint, border: `1px solid ${t.border}`, color: t.strong, padding: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="folder-open" size={16} />
              </span>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 180, flex: 1 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: text.title, textWrap: "pretty" }}>{c.label}</span>
                <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>{c.sharepointSiteUrl ?? "No site URL resolved yet"}</span>
              </span>
              <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 999, background: t.tint, border: `1px solid ${t.border}`, fontSize: 11, fontWeight: 600, color: toneText(t), whiteSpace: "nowrap" }}>{c.isActive ? "in use" : "retired"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
              <Fact label="OWNERSHIP" value="MSP-owned" color={text.secondary} />
              <Fact label="CREDENTIAL" value={c.clientSecretRef ?? "not set"} color={signal.info.text} />
              <Fact label="ADDED" value={formatDay(c.createdAt)} color={text.muted} />
              <Fact label="DEFAULT FOLDER" value={c.defaultFolderPath ?? "Documents"} color={text.secondary} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingTop: 11, borderTop: `1px solid ${border.soft}` }}>
              {c.isActive ? (
                <button
                  onClick={() => retire.mutate(c.connectorId, {
                    onError: (err) => toast.error(err instanceof DocumentsApiError ? err.message : "Failed to retire the connector."),
                  })}
                  disabled={retire.isPending}
                  style={{ height: 30, padding: "0 11px", borderRadius: 7, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {retire.isPending ? "Retiring…" : "Retire"}
                </button>
              ) : (
                <button disabled style={{ height: 30, padding: "0 11px", borderRadius: 7, border: `1px solid ${border.card}`, background: "transparent", color: text.label, fontSize: 12, fontWeight: 600, cursor: "not-allowed", whiteSpace: "nowrap" }}>Retired</button>
              )}
              <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty", flex: 1, minWidth: 160 }}>
                {c.isActive
                  ? "Retiring hides it from new documents. Anything already pointed at it keeps using it."
                  : "Retired, but still reachable by documents that were already pointed at it."}
              </span>
            </div>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 10, padding: "12px 13px", borderRadius: 11, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.4)" }}>
        <Icon name="key-round" size={15} color={text.muted} />
        <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>Credentials are held in the vault and only ever referenced by name. Nothing on this screen can show a secret back to you, and only an admin can add or change one.</span>
      </div>
    </div>
  );
}
