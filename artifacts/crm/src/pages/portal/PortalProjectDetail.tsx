import { useEffect, useState, useCallback, useRef } from "react";
import SignatureCanvas from "react-signature-canvas";
import { useParams, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { formatAuditEntry, formatActivityItem, relativeTime, type AuditLogEntry } from "@/lib/auditFormatter";
import PortalLayout from "@/components/PortalLayout";
import PortalRetainerDetail from "./PortalRetainerDetail";
import PortalProjectCloseOut from "./PortalProjectCloseOut";
import { KanbanCardModal } from "@/components/KanbanCardModal";
import type { KanbanCardModalTask } from "@/components/KanbanCardModal";
import { TypedCardContent } from "@/components/kanban/TypedCardContent";

interface Project {
  id: number;
  title: string;
  description: string | null;
  status: string;
  phase: string | null;
  progress: number;
  startDate: string | null;
  endDate: string | null;
  projectType: string;
  sharepointFolderUrl: string | null;
}

interface WorkflowStep {
  id: number;
  title: string;
  description: string | null;
  status: string;
  notes: string | null;
  completedAt: string | null;
  dueDate: string | null;
  order: number;
}

interface KanbanTask {
  id: number;
  title: string;
  description: string | null;
  column: "backlog" | "in_progress" | "waiting_on_customer" | "completed";
  order: number;
  assignedTo: string | null;
  dueDate: string | null;
  workflowStepId: number | null;
  groupName: string | null;
  waitingReason: string | null;
  completionStatus: string | null;
  completionNotes: string | null;
  createdAt: string;
  updatedAt: string;
  taskType: string | null;
  taskMetadata: Record<string, unknown> | null;
}

interface Document {
  id: number;
  name: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

interface SharePointFile {
  id: string;
  name: string;
  webUrl: string;
  mimeType: string | null;
  size: number | null;
  lastModifiedDateTime: string | null;
}

interface Update {
  id: number;
  content: string;
  type: string;
  createdAt: string;
}

interface PreviewTask {
  stepId: number;
  title: string;
  groupName: string | null;
  description: string | null;
}

interface ThreadMessage {
  sender: "client" | "admin";
  content: string;
  timestamp: string;
}

interface StatusReport {
  id: number;
  title: string;
  period: string;
  executiveSummary: string | null;
  completedActivities: Array<{ title: string; description: string }>;
  nextSteps: Array<{ label: string; title: string; description: string }>;
  reportDate: string | null;
  sentAt: string | null;
  clientStatus: "pending" | "accepted" | "has_questions";
  clientQuestion: string | null;
  adminReply: string | null;
  replyThread: ThreadMessage[];
}

interface ClosureRecord {
  id: number;
  projectId: number;
  requestedAt: string;
  feedback: string | null;
  permissionGranted: boolean;
  signatureDataUrl: string | null;
  signedAt: string | null;
}

interface ContractRef {
  id: number;
  signedAt: string | null;
  signerName: string | null;
  pdfFilename: string | null;
  sharepointFileUrl: string | null;
  sharepointFileId: string | null;
  localFilePath: string | null;
  serviceName: string;
}

interface AppliedCoupon {
  couponCode: string;
  discountAmount: string | null;
}

interface ProjectDetailData {
  project: Project;
  steps: WorkflowStep[];
  tasks: KanbanTask[];
  previewTasks: PreviewTask[];
  documents: Document[];
  updates: Update[];
  statusReports: StatusReport[];
  pendingStatusReport: StatusReport | null;
  contract: ContractRef | null;
  contracts: ContractRef[];
  appliedCoupon: AppliedCoupon | null;
}

type SecondaryTab = "kanban" | "documents" | "status-reports" | "contracts" | "timeline";

const KANBAN_COLUMNS = [
  { key: "backlog" as const, label: "Backlog", color: "border-gray-200 bg-gray-50" },
  { key: "in_progress" as const, label: "In Progress", color: "border-blue-200 bg-blue-50" },
  { key: "waiting_on_customer" as const, label: "Waiting on You", color: "border-yellow-200 bg-yellow-50" },
  { key: "completed" as const, label: "Completed", color: "border-green-200 bg-green-50" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatRefNumber(id: number): string {
  const year = new Date().getFullYear();
  return `SMC-${year}-${String(id).padStart(3, "0")}`;
}

function stepPercent(status: string): number {
  if (status === "completed") return 100;
  if (status === "in_progress") return 50;
  return 0;
}

function TaskCard({ task, onCardClick }: { task: KanbanTask; onCardClick: (task: KanbanTask) => void }) {
  return (
    <div
      onClick={() => onCardClick(task)}
      className="bg-white rounded-lg border border-border p-3 shadow-sm cursor-pointer hover:border-[#0078D4]/40 hover:shadow-md transition-all select-none"
    >
      <p className="text-sm font-medium text-[#0A2540] leading-snug">{task.title}</p>
      {task.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>}
      <TypedCardContent taskType={task.taskType} metadata={task.taskMetadata} />
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {task.assignedTo && (
          <span className="text-xs bg-[#0078D4]/10 text-[#0078D4] px-2 py-0.5 rounded-full font-medium">{task.assignedTo}</span>
        )}
        {task.dueDate && (
          <span className="text-xs text-muted-foreground">Due {new Date(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        )}
        <span className="ml-auto text-[10px] font-semibold text-[#0078D4] flex items-center gap-0.5 flex-shrink-0">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Details
        </span>
      </div>
    </div>
  );
}



function DocumentUpload({ projectId, onUploaded, fetchWithAuth }: {
  projectId: number;
  onUploaded: () => void;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (name.trim()) fd.append("name", name.trim());
      const res = await fetchWithAuth(`/api/portal/projects/${projectId}/documents`, { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json() as { error: string };
        setError(data.error ?? "Upload failed");
      } else {
        setFile(null);
        setName("");
        onUploaded();
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleUpload} className="bg-white border border-border rounded-xl p-4 flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[200px]">
        <label className="block text-xs font-semibold text-[#0A2540] mb-1">Upload Document</label>
        <input
          type="file"
          required
          onChange={e => setFile(e.target.files?.[0] ?? null)}
          className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none file:mr-3 file:text-xs file:font-semibold file:bg-[#0078D4] file:text-white file:border-0 file:rounded file:px-2 file:py-1 file:cursor-pointer"
        />
      </div>
      <div className="flex-1 min-w-[160px]">
        <label className="block text-xs font-semibold text-[#0A2540] mb-1">Display Name <span className="font-normal text-muted-foreground">(optional)</span></label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Project Proposal"
          className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
        />
      </div>
      <div className="flex flex-col gap-1">
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={!file || uploading}
          className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>
    </form>
  );
}

function CheckCircleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    active: { label: "IN PROGRESS", cls: "bg-blue-100 text-blue-700 border border-blue-200" },
    on_hold: { label: "ON HOLD", cls: "bg-yellow-100 text-yellow-700 border border-yellow-200" },
    completed: { label: "COMPLETED", cls: "bg-green-100 text-green-700 border border-green-200" },
    cancelled: { label: "CANCELLED", cls: "bg-red-100 text-red-600 border border-red-200" },
  };
  const c = cfg[status] ?? { label: status.replace("_", " ").toUpperCase(), cls: "bg-gray-100 text-gray-600 border border-gray-200" };
  return (
    <span className={`text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-md ${c.cls}`}>{c.label}</span>
  );
}

const MIME_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.ms-powerpoint": "PPT",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "application/vnd.oasis.opendocument.text": "ODT",
  "application/vnd.oasis.opendocument.spreadsheet": "ODS",
  "application/zip": "ZIP",
  "text/plain": "TXT",
  "text/csv": "CSV",
  "text/html": "HTML",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/gif": "GIF",
  "image/webp": "WEBP",
  "image/svg+xml": "SVG",
  "video/mp4": "MP4",
  "audio/mpeg": "MP3",
};

function mimeToLabel(mimeType: string | null | undefined, filename?: string): string {
  if (mimeType) {
    const clean = mimeType.split(";")[0].trim().toLowerCase();
    if (MIME_LABELS[clean]) return MIME_LABELS[clean];
  }
  if (filename && filename.includes(".")) {
    return filename.split(".").pop()!.toUpperCase();
  }
  return "FILE";
}

function GradientProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-white/10 rounded-full h-2.5">
      <div
        className="h-2.5 rounded-full transition-all"
        style={{
          width: `${Math.min(100, value)}%`,
          background: "linear-gradient(90deg, #0078D4 0%, #00B4D8 100%)",
        }}
      />
    </div>
  );
}

function StepProgressBar({ value }: { value: number }) {
  return (
    <div className="w-16 bg-gray-200 rounded-full h-1.5 flex-shrink-0">
      <div
        className="h-1.5 rounded-full transition-all"
        style={{
          width: `${value}%`,
          background: value === 100 ? "#16a34a" : value > 0 ? "#0078D4" : "#d1d5db",
        }}
      />
    </div>
  );
}

function periodLabel(period: string): string {
  const m: Record<string, string> = {
    weekly: "Weekly",
    monthly: "Monthly",
    executive_summary: "Executive Summary",
    other: "Report",
  };
  return m[period] ?? period;
}

function ClientStatusChip({ status }: { status: "pending" | "accepted" | "has_questions" }) {
  if (status === "accepted") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
        Accepted
      </span>
    );
  }
  if (status === "has_questions") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        Has Questions
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      Pending
    </span>
  );
}

function QuestionDialog({
  reportTitle,
  onSubmit,
  onCancel,
  submitting,
}: {
  reportTitle: string;
  onSubmit: (question: string) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [question, setQuestion] = useState("");
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h3 className="text-base font-bold text-[#0A2540] mb-1">Ask a Question</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Re: <span className="font-semibold text-[#0A2540]">{reportTitle}</span>
        </p>
        <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">Your Question</label>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          rows={4}
          placeholder="Describe your question or concern about this report…"
          className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
        />
        <p className="text-xs text-muted-foreground mt-1.5 mb-5">Your question will be submitted to your consultant for follow-up.</p>
        <div className="flex items-center gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="text-sm font-semibold text-muted-foreground px-4 py-2 rounded-lg border border-border hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => { if (question.trim()) onSubmit(question.trim()); }}
            disabled={!question.trim() || submitting}
            className="text-sm font-semibold text-white bg-[#0078D4] px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            Submit Question
          </button>
        </div>
      </div>
    </div>
  );
}

const OFFICE_MIMES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
]);

function ViewerErrorCard({ message, downloadUrl, filename }: { message: string; downloadUrl: string; filename: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl p-6 max-w-sm text-center shadow-lg">
        <svg className="w-10 h-10 text-red-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <p className="text-sm font-semibold text-red-600 mb-2">Preview unavailable</p>
        <p className="text-xs text-gray-600 mb-4">{message}</p>
        <a href={downloadUrl} download={filename}
          className="inline-flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#005fa3] transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download instead
        </a>
      </div>
    </div>
  );
}

function ViewerSpinner() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-3 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-600">Loading preview…</p>
      </div>
    </div>
  );
}

function SpFileViewerModal({
  projectId,
  file,
  onClose,
  fetchWithAuth,
}: {
  projectId: number;
  file: { id: string; name: string; mimeType: string | null };
  onClose: () => void;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const proxyUrl = `/api/portal/projects/${projectId}/sharepoint-file/${encodeURIComponent(file.id)}`;

  const mimeClean = file.mimeType?.split(";")[0].trim().toLowerCase() ?? "";
  const isPdf = mimeClean === "application/pdf";
  const isImage = mimeClean.startsWith("image/");
  const isOffice = OFFICE_MIMES.has(mimeClean);

  // PDF / image: preflight via fetchWithAuth to catch proxy errors before showing iframe/img
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobLoading, setBlobLoading] = useState(false);
  const [blobError, setBlobError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPdf && !isImage) return;
    let objectUrl: string | null = null;
    setBlobLoading(true);
    setBlobError(null);
    fetchWithAuth(proxyUrl)
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({})) as { error?: string };
          setBlobError(d.error ?? `Could not load file (HTTP ${r.status}).`);
        } else {
          const blob = await r.blob();
          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
        }
      })
      .catch(() => setBlobError("Network error loading file."))
      .finally(() => setBlobLoading(false));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Office: fetch metaOnly to get download URL for Office Online viewer
  const [officeEmbedUrl, setOfficeEmbedUrl] = useState<string | null>(null);
  const [officeLoading, setOfficeLoading] = useState(false);
  const [officeError, setOfficeError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOffice) return;
    setOfficeLoading(true);
    setOfficeError(null);
    fetchWithAuth(`${proxyUrl}?metaOnly=true`)
      .then(r => r.json() as Promise<{ downloadUrl?: string; error?: string }>)
      .then(data => {
        if (data.downloadUrl) {
          setOfficeEmbedUrl(`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(data.downloadUrl)}`);
        } else {
          setOfficeError(data.error ?? "Could not load file for preview.");
        }
      })
      .catch(() => setOfficeError("Network error loading file preview."))
      .finally(() => setOfficeLoading(false));
  }, [file.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex flex-col" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex items-center gap-3 px-5 py-3 bg-[#0A2540] text-white flex-shrink-0">
        <svg className="w-4 h-4 text-[#0078D4] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        <p className="text-sm font-semibold truncate flex-1">{file.name}</p>
        <button onClick={onClose} className="ml-2 text-white/70 hover:text-white transition-colors flex-shrink-0" aria-label="Close">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-hidden bg-gray-100">
        {isPdf && (
          blobLoading ? <ViewerSpinner /> :
          blobError ? <ViewerErrorCard message={blobError} downloadUrl={proxyUrl} filename={file.name} /> :
          blobUrl ? <iframe src={blobUrl} className="w-full h-full border-0" title={file.name} /> : null
        )}
        {isImage && (
          blobLoading ? <ViewerSpinner /> :
          blobError ? <ViewerErrorCard message={blobError} downloadUrl={proxyUrl} filename={file.name} /> :
          blobUrl ? (
            <div className="w-full h-full flex items-center justify-center p-6">
              <img src={blobUrl} alt={file.name} className="max-w-full max-h-full object-contain rounded-lg shadow-lg" />
            </div>
          ) : null
        )}
        {isOffice && (
          officeLoading ? <ViewerSpinner /> :
          officeError ? <ViewerErrorCard message={officeError} downloadUrl={proxyUrl} filename={file.name} /> :
          officeEmbedUrl ? <iframe src={officeEmbedUrl} className="w-full h-full border-0" title={file.name} /> : null
        )}
        {!isPdf && !isImage && !isOffice && (
          <div className="w-full h-full flex items-center justify-center p-6">
            <div className="bg-white rounded-2xl p-6 max-w-sm text-center shadow-lg">
              <svg className="w-12 h-12 text-[#0078D4] mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <p className="text-sm font-semibold text-[#0A2540] mb-1">{file.name}</p>
              <p className="text-xs text-gray-500 mb-4">This file type cannot be previewed. Click below to download it.</p>
              <a href={proxyUrl} download={file.name}
                className="inline-flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#005fa3] transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download File
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PortalProjectDetail() {
  const params = useParams<{ id: string }>();
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<ProjectDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [secondaryTab, setSecondaryTab] = useState<SecondaryTab | null>(null);
  const [expandedStepId, setExpandedStepId] = useState<number | null>(null);
  const [showAllPhases, setShowAllPhases] = useState(false);
  const [exportingAudit, setExportingAudit] = useState(false);
  const [selectedTask, setSelectedTask] = useState<KanbanCardModalTask | null>(null);
  const [selectedStepTitle, setSelectedStepTitle] = useState<string | null>(null);

  // Status report acknowledgement state
  const [acknowledging, setAcknowledging] = useState(false);
  const [questionDialogReportId, setQuestionDialogReportId] = useState<number | null>(null);
  const [threadReplyDraft, setThreadReplyDraft] = useState<Record<number, string>>({});
  const [threadReplySending, setThreadReplySending] = useState<Record<number, boolean>>({});
  const [expandedReportId, setExpandedReportId] = useState<number | null>(null);

  // Closure sign-off state
  const [closure, setClosure] = useState<ClosureRecord | null>(null);
  const [signModalOpen, setSignModalOpen] = useState(false);
  const [closureFeedback, setClosureFeedback] = useState("");
  const [closurePermission, setClosurePermission] = useState(true);
  const [closureSigning, setClosureSigning] = useState(false);
  const sigCanvasRef = useRef<SignatureCanvas>(null);

  // SharePoint documents state
  const [spFiles, setSpFiles] = useState<SharePointFile[]>([]);
  const [spLoading, setSpLoading] = useState(false);
  const [spError, setSpError] = useState<string | null>(null);
  const [spNoSite, setSpNoSite] = useState(false);
  const [spFetched, setSpFetched] = useState(false);
  const [viewerFile, setViewerFile] = useState<{ id: string; name: string; mimeType: string | null } | null>(null);

  // Task activity state (auto-loaded on mount)
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const loadSpFiles = useCallback(async () => {
    if (!params.id || spFetched) return;
    setSpLoading(true);
    setSpError(null);
    try {
      const res = await fetchWithAuth(`/api/portal/projects/${params.id}/sharepoint-documents`);
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setSpError(d.error ?? "Failed to load SharePoint files.");
      } else {
        const d = await res.json() as { items: SharePointFile[]; noSite: boolean };
        setSpFiles(d.items);
        setSpNoSite(d.noSite);
      }
    } catch {
      setSpError("Could not connect to the server. Please try again.");
    } finally {
      setSpLoading(false);
      setSpFetched(true);
    }
  }, [params.id, fetchWithAuth, spFetched]);

  const loadAuditLogs = useCallback(async () => {
    if (!params.id) return;
    setAuditLoading(true);
    try {
      const res = await fetchWithAuth(`/api/portal/projects/${params.id}/audit-logs?limit=25`);
      if (res.ok) {
        const d = await res.json() as { entries: AuditLogEntry[] };
        setAuditLogs(d.entries);
      }
    } finally {
      setAuditLoading(false);
    }
  }, [params.id, fetchWithAuth]);

  const handleCardClick = useCallback((task: KanbanTask, stepTitle?: string | null) => {
    setSelectedTask(task);
    setSelectedStepTitle(stepTitle ?? null);
  }, []);

  const loadProject = useCallback(() => {
    if (!params.id) return;
    setLoading(true);
    fetchWithAuth(`/api/portal/projects/${params.id}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d || !d.project) return;
        const detail = d as ProjectDetailData;
        setData(detail);
        const firstInProgress = detail.steps.find(s => s.status === "in_progress");
        if (firstInProgress) setExpandedStepId(firstInProgress.id);
        else if (detail.steps.length > 0) setExpandedStepId(detail.steps[0].id);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth, params.id]);

  const loadClosure = useCallback(() => {
    if (!params.id) return;
    fetchWithAuth(`/api/portal/projects/${params.id}/closure`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setClosure(d as ClosureRecord | null))
      .catch(() => null);
  }, [fetchWithAuth, params.id]);

  useEffect(() => { loadClosure(); }, [loadClosure]);
  useEffect(() => { if (secondaryTab === "documents") void loadSpFiles(); }, [secondaryTab, loadSpFiles]);

  const handleSignClosure = async () => {
    if (!params.id || closureSigning) return;
    const sigEmpty = sigCanvasRef.current?.isEmpty() !== false;
    if (sigEmpty) { alert("Please draw your signature before submitting."); return; }
    const signatureDataUrl = sigCanvasRef.current!.toDataURL("image/png");
    setClosureSigning(true);
    try {
      const r = await fetchWithAuth(`/api/portal/projects/${params.id}/closure/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: closureFeedback.trim() || null, permissionGranted: closurePermission, signatureDataUrl }),
      });
      if (r.ok) {
        const updated = await r.json() as ClosureRecord;
        setClosure(updated);
        setSignModalOpen(false);
        void loadAuditLogs();
      }
    } finally {
      setClosureSigning(false);
    }
  };

  const handleExportAudit = async () => {
    if (!params.id || exportingAudit) return;
    setExportingAudit(true);
    try {
      const res = await fetchWithAuth(`/api/portal/projects/${params.id}/audit-pdf`);
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        alert(err.error ?? "Failed to generate audit PDF. Please try again.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const year = new Date().getFullYear();
      const refNum = `SMC-${year}-${String(params.id).padStart(3, "0")}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-${refNum}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExportingAudit(false);
    }
  };

  const handleAcknowledge = async (reportId: number, status: "accepted" | "has_questions", question?: string) => {
    setAcknowledging(true);
    try {
      const res = await fetchWithAuth(`/api/portal/status-reports/${reportId}/acknowledge`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, question }),
      });
      if (res.ok) {
        const updated = await res.json() as StatusReport;
        setData(prev => {
          if (!prev) return prev;
          const newReports = prev.statusReports.map(r => r.id === reportId ? { ...r, ...updated } : r);
          const newPending = newReports.find(r => r.clientStatus === "pending" || r.clientStatus === "has_questions") ?? null;
          return { ...prev, statusReports: newReports, pendingStatusReport: newPending };
        });
        setQuestionDialogReportId(null);
        void loadAuditLogs();
      }
    } finally {
      setAcknowledging(false);
    }
  };

  const handleThreadReply = async (reportId: number) => {
    const content = (threadReplyDraft[reportId] ?? "").trim();
    if (!content) return;
    setThreadReplySending(prev => ({ ...prev, [reportId]: true }));
    try {
      const res = await fetchWithAuth(`/api/portal/status-reports/${reportId}/thread`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        const updated = await res.json() as StatusReport;
        setThreadReplyDraft(prev => ({ ...prev, [reportId]: "" }));
        setData(prev => {
          if (!prev) return prev;
          const newReports = prev.statusReports.map(r => r.id === reportId ? { ...r, ...updated } : r);
          const newPending = newReports.find(r => r.clientStatus === "pending" || r.clientStatus === "has_questions") ?? null;
          return { ...prev, statusReports: newReports, pendingStatusReport: newPending };
        });
        void loadAuditLogs();
      }
    } finally {
      setThreadReplySending(prev => ({ ...prev, [reportId]: false }));
    }
  };

  const handleResolve = async (reportId: number) => {
    setAcknowledging(true);
    try {
      const res = await fetchWithAuth(`/api/portal/status-reports/${reportId}/resolve`, {
        method: "POST",
      });
      if (res.ok) {
        const updated = await res.json() as StatusReport;
        setData(prev => {
          if (!prev) return prev;
          const newReports = prev.statusReports.map(r => r.id === reportId ? { ...r, ...updated } : r);
          const newPending = newReports.find(r => r.clientStatus === "pending" || r.clientStatus === "has_questions") ?? null;
          return { ...prev, statusReports: newReports, pendingStatusReport: newPending };
        });
        void loadAuditLogs();
      }
    } finally {
      setAcknowledging(false);
    }
  };

  useEffect(() => { loadProject(); }, [loadProject]);
  useEffect(() => { void loadAuditLogs(); }, [loadAuditLogs]);


  if (loading) {
    return (
      <PortalLayout>
        <div className="flex items-center justify-center min-h-96">
          <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      </PortalLayout>
    );
  }

  if (!data) {
    return (
      <PortalLayout>
        <div className="p-8 text-center text-muted-foreground">Project not found.</div>
      </PortalLayout>
    );
  }

  const { project, steps, tasks, documents, updates, statusReports, pendingStatusReport, contract, contracts } = data;

  // Retainer engagements get an executive dashboard view
  if (project.projectType === "retainer") {
    return (
      <PortalLayout>
        <PortalRetainerDetail data={data} projectId={params.id ?? ""} fetchWithAuth={fetchWithAuth} />
      </PortalLayout>
    );
  }

  // Closed-out projects get a dedicated executive close-out view
  if (closure?.signedAt) {
    return (
      <PortalLayout>
        <PortalProjectCloseOut
          data={data}
          closure={closure}
          auditLogs={auditLogs}
          projectId={params.id ?? ""}
          fetchWithAuth={fetchWithAuth}
        />
      </PortalLayout>
    );
  }

  const nextMilestone = steps.find(s => s.status !== "completed");
  const PHASE_LIMIT = 4;
  const visibleSteps = showAllPhases ? steps : steps.slice(0, PHASE_LIMIT);
  const hiddenCount = steps.length - PHASE_LIMIT;

  const secondaryTabs: { key: SecondaryTab; label: string; count?: number }[] = [
    { key: "kanban", label: "Kanban Board" },
    { key: "documents", label: "Documents", count: documents.length },
    { key: "status-reports", label: "Status Reports", count: statusReports.length },
    { key: "contracts", label: "Contracts", count: contracts.length },
    { key: "timeline", label: "Timeline" },
  ];

  return (
    <PortalLayout>
      <div className="px-4 sm:px-6 py-6 sm:py-8 max-w-7xl mx-auto">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/portal/projects"><span className="hover:text-[#0078D4] cursor-pointer">Projects</span></Link>
          <span>/</span>
          <span className="text-[#0A2540] font-medium truncate">{project.title}</span>
        </nav>

        {/* ── Project Header ── */}
        <div className="bg-white border border-border rounded-2xl p-6 mb-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <StatusBadge status={project.status} />
                <span className="text-xs font-mono text-muted-foreground tracking-wider">
                  REF: {formatRefNumber(project.id)}
                </span>
              </div>
              <h1 className="text-2xl font-extrabold text-[#0A2540] leading-tight mb-1">{project.title}</h1>
              {project.description && (
                <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">{project.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2.5 flex-shrink-0 sm:pt-1 flex-wrap">
              <Link href="/portal/book-meeting">
                <span className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-[#0078D4] text-white hover:bg-[#0078D4]/90 transition-colors cursor-pointer">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                  </svg>
                  Book a Meeting
                </span>
              </Link>
              <button
                onClick={() => void handleExportAudit()}
                disabled={exportingAudit}
                className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg border border-[#0A2540] text-[#0A2540] hover:bg-[#0A2540]/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {exportingAudit ? (
                  <div className="w-4 h-4 border-2 border-[#0A2540] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
                {exportingAudit ? "Exporting…" : "Export Audit"}
              </button>
            </div>
          </div>
        </div>

        {/* ── Coupon / Discount Banner ── */}
        {data.appliedCoupon && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-3 mb-5 flex items-center gap-3">
            <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            <p className="text-sm text-green-800 font-medium">
              Discount applied:{" "}
              <span className="font-mono font-bold bg-green-100 border border-green-300 px-1.5 py-0.5 rounded text-green-800">
                {data.appliedCoupon.couponCode}
              </span>
              {data.appliedCoupon.discountAmount && (
                <span className="ml-2 text-green-700">
                  (−${parseFloat(data.appliedCoupon.discountAmount).toFixed(2)})
                </span>
              )}
            </p>
          </div>
        )}

        {/* ── Secondary Tab Bar ── */}
        <div className="flex items-center gap-1 mb-6 border-b border-border">
          <button
            onClick={() => setSecondaryTab(null)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
              secondaryTab === null
                ? "border-[#0A2540] text-[#0A2540]"
                : "border-transparent text-muted-foreground hover:text-[#0A2540]"
            }`}
          >
            Workflow Explorer
          </button>
          {secondaryTabs.map(t => (
            <button
              key={t.key}
              onClick={() => setSecondaryTab(t.key)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
                secondaryTab === t.key
                  ? "border-[#0078D4] text-[#0078D4]"
                  : "border-transparent text-muted-foreground hover:text-[#0A2540]"
              }`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="ml-1.5 text-xs bg-[#0078D4]/10 text-[#0078D4] px-1.5 py-0.5 rounded-full">{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Workflow Explorer (default view) ── */}
        {secondaryTab === null && (
          <div className="space-y-6">
            {/* Closure Sign-Off Banner */}
            {closure && !closure.signedAt && (
              <div className="bg-[#0A2540] border border-[#0078D4]/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[#0078D4]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-[#00B4D8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white">Project Closure — Sign-Off Requested</p>
                    <p className="text-xs text-white/60 mt-0.5">
                      Shane has completed your project. Please review and sign off to confirm delivery.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSignModalOpen(true)}
                  className="flex items-center gap-2 text-sm font-bold px-4 py-2 rounded-lg bg-[#0078D4] text-white hover:bg-[#0078D4]/90 transition-colors flex-shrink-0 whitespace-nowrap"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  Review &amp; Sign Off
                </button>
              </div>
            )}

            {closure?.signedAt && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-green-800">Project signed off</p>
                  <p className="text-xs text-green-600 mt-0.5">
                    Thank you — closure confirmed on {new Date(closure.signedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
                  </p>
                </div>
              </div>
            )}

            {/* Pending Status Report Banner */}
            {pendingStatusReport && pendingStatusReport.clientStatus === "pending" && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-amber-900">New Status Report Ready for Review</p>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
                      <p className="text-sm text-amber-800 font-medium truncate">{pendingStatusReport.title}</p>
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 flex-shrink-0">
                        {periodLabel(pendingStatusReport.period)}
                      </span>
                    </div>
                    {pendingStatusReport.sentAt && (
                      <p className="text-xs text-amber-600 mt-0.5">
                        Sent {new Date(pendingStatusReport.sentAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 sm:flex-col sm:gap-2 lg:flex-row">
                  <button
                    onClick={() => void handleAcknowledge(pendingStatusReport.id, "accepted")}
                    disabled={acknowledging}
                    className="flex items-center gap-1.5 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {acknowledging ? (
                      <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    )}
                    Mark Accepted
                  </button>
                  <button
                    onClick={() => setQuestionDialogReportId(pendingStatusReport.id)}
                    disabled={acknowledging}
                    className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Has Questions
                  </button>
                </div>
              </div>
            )}

            {/* Has-Questions Status Report Banner — persists until client accepts */}
            {pendingStatusReport && pendingStatusReport.clientStatus === "has_questions" && (
              <div className={`border rounded-xl p-4 flex flex-col gap-4 ${
                pendingStatusReport.adminReply
                  ? "bg-blue-50 border-blue-400 ring-1 ring-blue-200"
                  : "bg-blue-50 border-blue-200"
              }`}>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-blue-900">Status Report — Question Submitted</p>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
                      <p className="text-sm text-blue-800 font-medium truncate">{pendingStatusReport.title}</p>
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-200 text-blue-800 flex-shrink-0">
                        {periodLabel(pendingStatusReport.period)}
                      </span>
                    </div>
                    {pendingStatusReport.clientQuestion && (
                      <p className="text-xs text-blue-700 mt-1.5 italic">
                        Your question: &ldquo;{pendingStatusReport.clientQuestion}&rdquo;
                      </p>
                    )}
                  </div>
                </div>

                {pendingStatusReport.adminReply ? (
                  <div className="flex flex-col gap-3">
                    {/* Initial exchange */}
                    <div className="bg-white border border-blue-200 rounded-lg p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-blue-600 mb-1">Consultant Reply</p>
                      <p className="text-sm text-[#0A2540] leading-relaxed">{pendingStatusReport.adminReply}</p>
                    </div>

                    {/* Thread follow-up messages */}
                    {(pendingStatusReport.replyThread ?? []).length > 0 && (
                      <div className="space-y-2">
                        {(pendingStatusReport.replyThread ?? []).map((msg, i) => (
                          <div key={i} className={`rounded-lg p-3 ${msg.sender === "client" ? "bg-blue-50 border border-blue-100 ml-4" : "bg-white border border-blue-200"}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${msg.sender === "client" ? "bg-blue-500" : "bg-[#0078D4]"}`}>
                                <span className="text-white text-[7px] font-bold">{msg.sender === "client" ? "ME" : "SM"}</span>
                              </div>
                              <p className="text-[10px] font-semibold text-gray-500">{msg.sender === "client" ? "You" : "Consultant"} · {new Date(msg.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                            </div>
                            <p className="text-sm text-[#0A2540] leading-relaxed">{msg.content}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Reply box for client + resolve */}
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={threadReplyDraft[pendingStatusReport.id] ?? ""}
                        onChange={e => setThreadReplyDraft(prev => ({ ...prev, [pendingStatusReport.id]: e.target.value }))}
                        placeholder="Send a follow-up message…"
                        rows={2}
                        className="w-full text-sm border border-blue-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                      />
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => void handleThreadReply(pendingStatusReport.id)}
                          disabled={!(threadReplyDraft[pendingStatusReport.id] ?? "").trim() || !!threadReplySending[pendingStatusReport.id]}
                          className="flex items-center gap-1.5 text-sm font-semibold text-white bg-[#0078D4] hover:bg-[#0078D4]/90 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {threadReplySending[pendingStatusReport.id] ? (
                            <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                          )}
                          Send follow-up
                        </button>
                        <button
                          onClick={() => void handleAcknowledge(pendingStatusReport.id, "accepted")}
                          disabled={acknowledging}
                          className="flex items-center gap-1.5 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {acknowledging ? (
                            <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                          )}
                          Mark Accepted
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-100/60 rounded-lg px-3 py-2">
                    <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    Your question has been sent — awaiting a response from your consultant.
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-12 gap-6 items-start">
              {/* Left: Workflow Explorer */}
              <div className="col-span-12 lg:col-span-8 space-y-3">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-base font-bold text-[#0A2540] tracking-tight">Workflow Explorer</h2>
                  <span className="text-xs text-muted-foreground">{steps.filter(s => s.status === "completed").length}/{steps.length} phases complete</span>
                </div>

                {steps.length === 0 ? (
                  <div className="bg-white border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">
                    No workflow steps defined yet.
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      {visibleSteps.map((step, idx) => {
                        const isCompleted = step.status === "completed";
                        const isInProgress = step.status === "in_progress";
                        const isExpanded = expandedStepId === step.id;
                        const isFirstInProgress = isInProgress && !steps.slice(0, idx).some(s => s.status === "in_progress");

                        const prevAllComplete = steps.slice(0, idx).every(s => s.status === "completed");
                        const isLocked = step.status === "pending" && !prevAllComplete;

                        return (
                          <div
                            key={step.id}
                            className={`rounded-xl border overflow-hidden transition-all ${
                              isFirstInProgress
                                ? "border-2 border-[#0A2540] shadow-md"
                                : isCompleted
                                ? "border border-border opacity-60"
                                : "border border-border"
                            }`}
                          >
                            {/* Phase row header */}
                            <button
                              onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                              className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                                isFirstInProgress
                                  ? "bg-[#0A2540] text-white"
                                  : isCompleted
                                  ? "bg-gray-50 text-muted-foreground"
                                  : "bg-white text-[#0A2540] hover:bg-gray-50"
                              }`}
                            >
                              {/* Status icon */}
                              <span className={`flex-shrink-0 ${isCompleted ? "text-green-500" : isFirstInProgress ? "text-white/70" : "text-muted-foreground"}`}>
                                {isCompleted ? (
                                  <CheckCircleIcon />
                                ) : isLocked ? (
                                  <LockIcon />
                                ) : (
                                  <CircleIcon />
                                )}
                              </span>

                              {/* Phase number + title */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`text-[10px] font-bold uppercase tracking-widest ${isFirstInProgress ? "text-white/50" : "text-muted-foreground"}`}>
                                    Phase {idx + 1}
                                  </span>
                                  {isFirstInProgress && (
                                    <span className="text-[10px] font-bold uppercase tracking-wide bg-white/20 text-white px-2 py-0.5 rounded">
                                      Active
                                    </span>
                                  )}
                                </div>
                                <p className={`text-sm font-semibold leading-tight ${isCompleted ? "line-through" : ""}`}>
                                  {step.title}
                                </p>
                              </div>

                              {/* Completion date or status */}
                              <div className="flex items-center gap-3 flex-shrink-0">
                                {isCompleted && step.completedAt && (
                                  <span className="text-xs hidden sm:block">
                                    {new Date(step.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                  </span>
                                )}
                                {!isCompleted && (
                                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full hidden sm:block ${
                                    isInProgress ? (isFirstInProgress ? "bg-white/20 text-white" : "bg-blue-100 text-blue-700") :
                                    isLocked ? "bg-gray-100 text-gray-500" :
                                    "bg-gray-100 text-gray-500"
                                  }`}>
                                    {isInProgress ? "In Progress" : isLocked ? "Locked" : "Pending"}
                                  </span>
                                )}
                                <span className={isFirstInProgress ? "text-white/60" : "text-muted-foreground"}>
                                  <ChevronIcon open={isExpanded} />
                                </span>
                              </div>
                            </button>

                            {/* Expanded phase content */}
                            {isExpanded && (() => {
                              const stepTasks = data.tasks.filter(t => t.workflowStepId === step.id);
                              const stepPreviewTasks = data.previewTasks?.filter(t => t.stepId === step.id) ?? [];
                              const isPreviewOnly = stepTasks.length === 0 && stepPreviewTasks.length > 0;

                              const groups: Record<string, KanbanTask[]> = {};
                              for (const t of stepTasks) {
                                const g = t.groupName ?? "Tasks";
                                if (!groups[g]) groups[g] = [];
                                groups[g].push(t);
                              }

                              const previewGroups: Record<string, PreviewTask[]> = {};
                              for (const t of stepPreviewTasks) {
                                const g = t.groupName ?? "Tasks";
                                if (!previewGroups[g]) previewGroups[g] = [];
                                previewGroups[g].push(t);
                              }

                              return (
                                <div className="bg-white border-t border-border px-5 py-4 space-y-4">
                                  {step.description && (
                                    <p className="text-xs text-muted-foreground leading-relaxed">{step.description}</p>
                                  )}

                                  {isPreviewOnly && (
                                    <>
                                      <p className="text-[10px] font-semibold text-[#0078D4] uppercase tracking-wide">
                                        Planned tasks — will activate when this phase begins
                                      </p>
                                      {Object.entries(previewGroups).map(([group, pts]) => (
                                        <div key={group}>
                                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{group}</p>
                                          <div className="space-y-2">
                                            {pts.map((pt, tidx) => (
                                              <div key={tidx} className="flex items-start gap-3 py-2.5 border border-dashed border-border rounded-xl px-4 bg-gray-50/60">
                                                <div className="w-4 h-4 rounded border-2 border-gray-200 flex-shrink-0 mt-0.5" />
                                                <div className="flex-1 min-w-0">
                                                  <p className="text-sm font-medium text-muted-foreground leading-snug">{pt.title}</p>
                                                  {pt.description && (
                                                    <p className="text-xs text-muted-foreground/70 mt-0.5 leading-relaxed">{pt.description}</p>
                                                  )}
                                                </div>
                                                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0 bg-gray-100 text-gray-400">
                                                  Planned
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      ))}
                                    </>
                                  )}

                                  {!isPreviewOnly && (
                                    <>
                                      {stepTasks.length === 0 ? (
                                        <p className="text-xs text-muted-foreground italic">No tasks defined for this phase.</p>
                                      ) : (
                                        Object.entries(groups).map(([group, kts]) => (
                                          <div key={group}>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{group}</p>
                                            <div className="space-y-2">
                                              {kts.map(kt => {
                                                const taskDone = kt.column === "completed";
                                                return (
                                                  <div key={kt.id} className="flex items-start gap-3 py-2.5 border border-border rounded-xl px-4 bg-[#F7F9FC] cursor-pointer hover:border-[#0078D4]/40 transition-colors" onClick={() => handleCardClick(kt, step.title)}>
                                                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${taskDone ? "bg-green-500 border-green-500" : "border-gray-300"}`}>
                                                      {taskDone && (
                                                        <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none">
                                                          <path d="M2 6l3 3 5-5" stroke="white" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                                                        </svg>
                                                      )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                      <p className={`text-sm font-medium leading-snug ${taskDone ? "line-through text-muted-foreground" : "text-[#0A2540]"}`}>{kt.title}</p>
                                                      {kt.description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{kt.description}</p>}
                                                      {kt.assignedTo && <p className="text-[10px] text-muted-foreground mt-0.5">{kt.assignedTo}</p>}
                                                    </div>
                                                    {!taskDone && (
                                                      <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0 ${kt.column === "in_progress" ? "bg-blue-100 text-blue-700" : kt.column === "waiting_on_customer" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500"}`}>
                                                        {kt.column === "in_progress" ? "In Progress" : kt.column === "waiting_on_customer" ? "Waiting" : "Backlog"}
                                                      </span>
                                                    )}
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        ))
                                      )}
                                    </>
                                  )}
                                  {step.notes && (
                                    <p className="text-xs text-[#0078D4] italic">Note: {step.notes}</p>
                                  )}
                                  {step.dueDate && (
                                    <p className="text-xs text-muted-foreground">
                                      Due: {new Date(step.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                    </p>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>

                    {!showAllPhases && hiddenCount > 0 && (
                      <button
                        onClick={() => setShowAllPhases(true)}
                        className="w-full py-3 text-sm font-semibold text-muted-foreground border border-dashed border-border rounded-xl hover:border-[#0078D4]/40 hover:text-[#0078D4] transition-colors bg-white"
                      >
                        Show Remaining {hiddenCount} Phase{hiddenCount !== 1 ? "s" : ""}
                      </button>
                    )}
                    {showAllPhases && steps.length > PHASE_LIMIT && (
                      <button
                        onClick={() => setShowAllPhases(false)}
                        className="w-full py-3 text-sm font-semibold text-muted-foreground border border-dashed border-border rounded-xl hover:border-[#0078D4]/40 hover:text-[#0078D4] transition-colors bg-white"
                      >
                        Collapse Phases
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Right: Sidebar */}
              <div className="col-span-12 lg:col-span-4 space-y-4">
                {/* Contract Card */}
                <div className="bg-white border border-border rounded-2xl p-5 shadow-sm">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Project Contract</h3>
                  {contract ? (
                    <Link href={`/portal/billing/contracts/${contract.id}`}>
                      <div className="flex items-center gap-3 cursor-pointer group">
                        <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#0078D4]/20 transition-colors">
                          <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#0078D4] group-hover:underline leading-tight">View Contract</p>
                          {contract.signedAt && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Signed {new Date(contract.signedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              {contract.signerName ? ` by ${contract.signerName}` : ""}
                            </p>
                          )}
                        </div>
                        <svg className="w-4 h-4 text-muted-foreground group-hover:text-[#0078D4] flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <p className="text-sm text-muted-foreground italic">No contract on file yet</p>
                    </div>
                  )}
                </div>

                {/* Phase Completion Card */}
                <div className="bg-white border border-border rounded-2xl p-5 shadow-sm">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Phase Completion</h3>

                  {(() => {
                    const allTasks = data.tasks ?? [];
                    const overallPct = allTasks.length > 0
                      ? Math.round(allTasks.filter(t => t.column === "completed").length / allTasks.length * 100)
                      : project.progress;
                    return (
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-[#0A2540]">Overall Progress</span>
                          <span className="text-lg font-extrabold text-[#0078D4]">{overallPct}%</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2.5">
                          <div
                            className="h-2.5 rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, overallPct)}%`,
                              background: "linear-gradient(90deg, #0078D4 0%, #00B4D8 100%)",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {steps.length > 0 && (
                    <div className="space-y-2.5 border-t border-border pt-3">
                      {steps.map(s => {
                        const stepTasks = (data.tasks ?? []).filter(t => t.workflowStepId === s.id);
                        const pct = stepTasks.length > 0
                          ? Math.round(stepTasks.filter(t => t.column === "completed").length / stepTasks.length * 100)
                          : stepPercent(s.status);
                        return (
                          <div key={s.id} className="flex items-center gap-2">
                            <p className="text-xs text-[#0A2540] flex-1 truncate font-medium">{s.title}</p>
                            <StepProgressBar value={pct} />
                            <span className={`text-xs font-bold w-8 text-right flex-shrink-0 ${
                              pct === 100 ? "text-green-600" : pct > 0 ? "text-[#0078D4]" : "text-gray-400"
                            }`}>{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Next Milestone Card */}
                <div className="bg-[#0A2540] rounded-2xl p-5 shadow-sm">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-3">Next Milestone</h3>
                  {nextMilestone ? (
                    <>
                      <p className="text-white font-bold text-base leading-snug mb-1">{nextMilestone.title}</p>
                      {nextMilestone.dueDate ? (
                        <p className="text-white/50 text-xs mb-4">
                          Target: {new Date(nextMilestone.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                        </p>
                      ) : project.endDate ? (
                        <p className="text-white/50 text-xs mb-4">
                          Target: {new Date(project.endDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                        </p>
                      ) : (
                        <p className="text-white/30 text-xs mb-4">No target date set</p>
                      )}
                      {nextMilestone.dueDate && <button
                        onClick={() => {
                          const dateStr = nextMilestone.dueDate;
                          const title = encodeURIComponent(`[SMC] ${nextMilestone.title}`);
                          const details = encodeURIComponent(`Project milestone from Shane McCaw Consulting.`);
                          let dates = "";
                          if (dateStr) {
                            const d = new Date(dateStr);
                            const y = d.getUTCFullYear();
                            const m = String(d.getUTCMonth() + 1).padStart(2, "0");
                            const day = String(d.getUTCDate()).padStart(2, "0");
                            const ymd = `${y}${m}${day}`;
                            dates = `${ymd}/${ymd}`;
                          }
                          const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}`;
                          window.open(url, "_blank", "noopener,noreferrer");
                        }}
                        className="flex items-center gap-2 text-xs font-semibold text-white/70 border border-white/20 rounded-lg px-3 py-2 hover:bg-white/10 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Add to Calendar
                      </button>}
                    </>
                  ) : (
                    <p className="text-white/50 text-sm">All phases complete — great work!</p>
                  )}
                </div>

                {/* Task Activity */}
                <div className="bg-white border border-border rounded-2xl p-5 shadow-sm">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Task Activity</h3>
                  {auditLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : (() => {
                    const taskLogs = auditLogs.filter(e => e.entityType === "kanban_task");
                    if (taskLogs.length === 0) {
                      return <p className="text-xs text-muted-foreground text-center py-2">No task updates yet.</p>;
                    }
                    return (
                      <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-3">
                        {taskLogs.map((entry, i) => {
                          const meta = formatActivityItem(entry);
                          const bgClass = meta.color.split(" ").find(c => c.startsWith("bg-")) ?? "bg-gray-200";
                          return (
                            <div key={entry.id ?? i} className="flex items-start gap-2.5">
                              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${bgClass}`} />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-[#0A2540] leading-snug">{meta.label}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">{relativeTime(entry.createdAt)}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

              </div>
            </div>
          </div>
        )}

        {/* ── Kanban Board ── */}
        {secondaryTab === "kanban" && (
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {KANBAN_COLUMNS.map(col => {
                const colTasks = tasks.filter(t => t.column === col.key);
                return (
                  <div key={col.key} className={`rounded-xl border p-3 min-h-[300px] ${col.color}`}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{col.label}</h3>
                      <span className="text-xs bg-white/60 text-muted-foreground font-semibold px-2 py-0.5 rounded-full">{colTasks.length}</span>
                    </div>
                    <div className="space-y-2">
                      {colTasks.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onCardClick={t => {
                            const stepTitle = t.workflowStepId ? steps.find(s => s.id === t.workflowStepId)?.title ?? null : null;
                            handleCardClick(t, stepTitle);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Documents ── */}
        {secondaryTab === "documents" && (
          <div className="space-y-6">
            {/* ── SharePoint Files ── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-[#0078D4]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10.5 3A7.5 7.5 0 003 10.5a7.5 7.5 0 007.5 7.5 7.45 7.45 0 004.743-1.694l4.476 4.476a.75.75 0 001.06-1.06l-4.476-4.476A7.45 7.45 0 0018 10.5 7.5 7.5 0 0010.5 3zm0 1.5a6 6 0 110 12 6 6 0 010-12z" />
                </svg>
                <h3 className="text-sm font-bold text-[#0A2540]">SharePoint Files</h3>
                <span className="text-xs text-muted-foreground">Files from your project folder in SharePoint</span>
              </div>

              {spLoading ? (
                <div className="bg-white border border-border rounded-xl divide-y divide-border">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex items-center gap-4 px-5 py-4">
                      <div className="w-10 h-10 rounded-xl bg-gray-100 animate-pulse flex-shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 bg-gray-100 rounded animate-pulse w-2/3" />
                        <div className="h-2.5 bg-gray-100 rounded animate-pulse w-1/3" />
                      </div>
                      <div className="w-16 h-7 bg-gray-100 rounded-lg animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : spError ? (
                <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-center gap-3">
                  <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <p className="text-sm text-red-700">{spError}</p>
                </div>
              ) : spNoSite ? (
                <div className="bg-gray-50 border border-border rounded-xl px-5 py-6 flex items-center gap-3">
                  <svg className="w-5 h-5 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                  </svg>
                  <p className="text-sm text-muted-foreground">No SharePoint site has been linked to this account yet.</p>
                </div>
              ) : spFiles.length === 0 ? (
                <div className="bg-gray-50 border border-border rounded-xl px-5 py-6 text-center text-sm text-muted-foreground">
                  No files found in the SharePoint project folder.
                </div>
              ) : (
                <div className="bg-white border border-border rounded-xl divide-y divide-border">
                  {spFiles.map(file => {
                    const typeLabel = mimeToLabel(file.mimeType, file.name);
                    return (
                      <div key={file.id} className="flex items-center gap-4 px-5 py-4">
                        <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                          <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#0A2540] truncate">{file.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {typeLabel}
                            {file.size != null ? ` · ${formatBytes(file.size)}` : ""}
                            {file.lastModifiedDateTime ? ` · ${new Date(file.lastModifiedDateTime).toLocaleDateString()}` : ""}
                          </p>
                        </div>
                        <button
                          onClick={() => setViewerFile({ id: file.id, name: file.name, mimeType: file.mimeType })}
                          className="flex items-center gap-1.5 text-sm font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors px-3 py-1.5 border border-[#0078D4]/30 rounded-lg hover:bg-[#0078D4]/5 whitespace-nowrap"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                          Open
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Uploaded Files ── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-[#0A2540]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <h3 className="text-sm font-bold text-[#0A2540]">Uploaded Files</h3>
                <span className="text-xs text-muted-foreground">Files uploaded directly through the portal</span>
              </div>
              <DocumentUpload projectId={Number(params.id)} onUploaded={loadProject} fetchWithAuth={fetchWithAuth} />
              <div className="mt-3 bg-white border border-border rounded-xl divide-y divide-border">
                {documents.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">No documents uploaded yet.</div>
                ) : documents.map(doc => (
                  <div key={doc.id} className="flex items-center gap-4 px-5 py-4">
                    <div className="w-10 h-10 rounded-xl bg-[#0A2540]/8 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-[#0A2540]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#0A2540] truncate">{doc.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {doc.sizeBytes ? formatBytes(doc.sizeBytes) : ""}{doc.mimeType ? ` · ${mimeToLabel(doc.mimeType)}` : ""} · {new Date(doc.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        const r = await fetchWithAuth(`/api/portal/documents/${doc.id}/download`);
                        const blob = await r.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url; a.download = doc.name; a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="flex items-center gap-1.5 text-sm font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors px-3 py-1.5 border border-[#0078D4]/30 rounded-lg hover:bg-[#0078D4]/5"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Status Reports ── */}
        {secondaryTab === "status-reports" && (
          <div className="space-y-4">
            {statusReports.length === 0 ? (
              <div className="bg-white border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">
                No status reports have been sent yet. Your consultant will share structured reports here as the project progresses.
              </div>
            ) : statusReports.map(report => {
              const isExpanded = expandedReportId === report.id;
              return (
                <div key={report.id} className={`bg-white border rounded-xl shadow-sm overflow-hidden ${
                  report.clientStatus === "pending" ? "border-amber-300" :
                  (report.clientStatus === "has_questions" && report.adminReply) ? "border-blue-400 ring-1 ring-blue-200" :
                  "border-border"
                }`}>
                  {/* Card header */}
                  <button
                    onClick={() => setExpandedReportId(isExpanded ? null : report.id)}
                    className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#0078D4]/10 text-[#0078D4]">
                          {periodLabel(report.period)}
                        </span>
                        <ClientStatusChip status={report.clientStatus} />
                        {report.clientStatus === "has_questions" && report.adminReply && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-500 text-white animate-pulse">
                            <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" /></svg>
                            New Reply
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-bold text-[#0A2540] leading-tight">{report.title}</p>
                      {(report.sentAt ?? report.reportDate) && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(report.sentAt ?? report.reportDate ?? "").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                        </p>
                      )}
                    </div>
                    <ChevronIcon open={isExpanded} />
                  </button>

                  {/* Inline accept/question buttons when pending */}
                  {report.clientStatus === "pending" && (
                    <div className="px-5 pb-4 flex items-center gap-2 border-t border-amber-100 pt-3 bg-amber-50/40">
                      <p className="text-xs text-amber-700 flex-1">Please acknowledge this report:</p>
                      <button
                        onClick={() => void handleAcknowledge(report.id, "accepted")}
                        disabled={acknowledging}
                        className="flex items-center gap-1 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        Accept
                      </button>
                      <button
                        onClick={() => { setExpandedReportId(report.id); setQuestionDialogReportId(report.id); }}
                        disabled={acknowledging}
                        className="flex items-center gap-1 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Has Questions
                      </button>
                    </div>
                  )}

                  {/* If has_questions, show submitted question + any admin reply + thread */}
                  {report.clientStatus === "has_questions" && report.clientQuestion && (
                    <div className="px-5 pb-4 pt-3 border-t border-amber-100 bg-amber-50/30 space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-amber-800 mb-1">Your Question:</p>
                        <p className="text-xs text-amber-700 leading-relaxed">{report.clientQuestion}</p>
                      </div>
                      {report.adminReply && (
                        <>
                          <div className="border-l-4 border-[#0078D4] pl-3 bg-white/60 rounded-r-lg py-2 pr-3">
                            <div className="flex items-center gap-1.5 mb-1">
                              <div className="w-5 h-5 rounded-full bg-[#0078D4] flex items-center justify-center flex-shrink-0">
                                <span className="text-white text-[8px] font-bold">SM</span>
                              </div>
                              <p className="text-xs font-semibold text-[#0A2540]">Consultant Response</p>
                            </div>
                            <p className="text-xs text-[#0A2540] leading-relaxed">{report.adminReply}</p>
                          </div>

                          {/* Thread follow-up messages */}
                          {(report.replyThread ?? []).length > 0 && (
                            <div className="space-y-2 pl-1">
                              {(report.replyThread ?? []).map((msg, i) => (
                                <div key={i} className={`rounded-lg px-3 py-2 ${msg.sender === "client" ? "bg-amber-50 border border-amber-200 ml-4" : "bg-white/80 border border-[#0078D4]/20"}`}>
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 ${msg.sender === "client" ? "bg-amber-500" : "bg-[#0078D4]"}`}>
                                      <span className="text-white text-[6px] font-bold">{msg.sender === "client" ? "ME" : "SM"}</span>
                                    </div>
                                    <p className="text-[9px] font-semibold text-gray-500">
                                      {msg.sender === "client" ? "You" : "Consultant"} · {new Date(msg.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                    </p>
                                  </div>
                                  <p className="text-xs text-[#0A2540] leading-relaxed">{msg.content}</p>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Client follow-up reply box */}
                          <div className="space-y-1.5">
                            <textarea
                              value={threadReplyDraft[report.id] ?? ""}
                              onChange={e => setThreadReplyDraft(prev => ({ ...prev, [report.id]: e.target.value }))}
                              placeholder="Send a follow-up message…"
                              rows={2}
                              className="w-full text-xs border border-amber-200 rounded-lg px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-[#0078D4] bg-white"
                            />
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                onClick={() => void handleThreadReply(report.id)}
                                disabled={!(threadReplyDraft[report.id] ?? "").trim() || !!threadReplySending[report.id]}
                                className="flex items-center gap-1 text-[10px] font-bold text-white bg-[#0078D4] hover:bg-[#0078D4]/90 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {threadReplySending[report.id] ? (
                                  <div className="w-2.5 h-2.5 border border-white/40 border-t-white rounded-full animate-spin" />
                                ) : (
                                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                )}
                                Send follow-up
                              </button>
                              <button
                                onClick={() => void handleResolve(report.id)}
                                disabled={acknowledging}
                                className="flex items-center gap-1 text-[10px] font-semibold text-white bg-green-600 hover:bg-green-700 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                              >
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                Mark as resolved
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                      {!report.adminReply && (
                        <p className="text-[10px] text-amber-600 italic">Your consultant will reply shortly.</p>
                      )}
                    </div>
                  )}

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="border-t border-border px-5 py-5 space-y-5">
                      {report.executiveSummary && (
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Executive Summary</h4>
                          <p className="text-sm text-[#0A2540] leading-relaxed">{report.executiveSummary}</p>
                        </div>
                      )}

                      {report.completedActivities.length > 0 && (
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Completed Activities</h4>
                          <div className="space-y-2">
                            {report.completedActivities.map((act, i) => (
                              <div key={i} className="flex items-start gap-2.5">
                                <div className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                  <svg className="w-2.5 h-2.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-[#0A2540] leading-tight">{act.title}</p>
                                  {act.description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{act.description}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {report.nextSteps.length > 0 && (
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Next Steps</h4>
                          <div className="space-y-2">
                            {report.nextSteps.map((step, i) => (
                              <div key={i} className="flex items-start gap-2.5">
                                <div className="w-4 h-4 rounded-full bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                  <svg className="w-2.5 h-2.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                </div>
                                <div>
                                  {step.label && <span className="text-[10px] font-bold uppercase tracking-wide text-[#0078D4]">{step.label} — </span>}
                                  <span className="text-sm font-semibold text-[#0A2540] leading-tight">{step.title}</span>
                                  {step.description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.description}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {!report.executiveSummary && report.completedActivities.length === 0 && report.nextSteps.length === 0 && (
                        <p className="text-sm text-muted-foreground italic">No detailed content available for this report.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Contracts ── */}
      {secondaryTab === "timeline" && (
        <div className="bg-white border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-bold text-[#0A2540]">Project Timeline</h3>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" />Completed</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#0078D4] inline-block" />In Progress</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-gray-200 inline-block" />Pending</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" />Overdue</span>
            </div>
          </div>

          {steps.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No workflow steps defined for this project yet.
            </div>
          ) : (() => {
            const now = new Date();

            const dates = steps
              .flatMap(s => [s.dueDate, s.completedAt].filter(Boolean) as string[])
              .map(d => new Date(d).getTime())
              .filter(t => !isNaN(t));

            const minTs = dates.length > 0 ? Math.min(...dates) : Date.now() - 7 * 86400_000;
            const maxTs = dates.length > 0 ? Math.max(...dates, Date.now()) : Date.now() + 30 * 86400_000;
            const rangeMs = Math.max(maxTs - minTs, 7 * 86400_000);

            function pct(ts: number | null | undefined): number {
              if (!ts) return 0;
              return Math.max(0, Math.min(100, ((ts - minTs) / rangeMs) * 100));
            }

            const todayPct = pct(Date.now());

            const formatDate = (d: string | null) =>
              d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;

            return (
              <div className="space-y-1">
                {/* Header axis */}
                <div className="flex items-center pl-48 mb-3 pr-4">
                  <div className="flex-1 relative h-4">
                    {[0, 25, 50, 75, 100].map(p => (
                      <span
                        key={p}
                        className="absolute text-[9px] text-muted-foreground transform -translate-x-1/2"
                        style={{ left: `${p}%` }}
                      >
                        {p === 0
                          ? new Date(minTs).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                          : p === 100
                          ? new Date(maxTs).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                          : ""}
                      </span>
                    ))}
                  </div>
                </div>

                {steps.map((step, idx) => {
                  const isOverdue = step.status !== "completed" && step.dueDate && new Date(step.dueDate) < now;
                  const startPct = pct(minTs + (idx / Math.max(steps.length, 1)) * rangeMs * 0.8);
                  const endPct = step.dueDate
                    ? pct(new Date(step.dueDate).getTime())
                    : step.completedAt
                    ? pct(new Date(step.completedAt).getTime())
                    : Math.min(startPct + 10, 100);
                  const barWidth = Math.max(endPct - startPct, 3);

                  const barColor =
                    step.status === "completed" ? "bg-green-500"
                    : isOverdue ? "bg-red-400"
                    : step.status === "in_progress" ? "bg-[#0078D4]"
                    : "bg-gray-200";

                  const statusIcon =
                    step.status === "completed" ? "✅"
                    : step.status === "in_progress" ? "🔄"
                    : "⬜";

                  return (
                    <div key={step.id} className="flex items-center gap-2 group hover:bg-gray-50/80 rounded-lg py-1.5 px-2 -mx-2 transition-colors">
                      {/* Step label */}
                      <div className="w-44 flex-shrink-0 flex items-center gap-2 min-w-0">
                        <span className="text-xs flex-shrink-0">{statusIcon}</span>
                        <p className="text-xs font-medium text-[#0A2540] truncate" title={step.title}>{step.title}</p>
                      </div>

                      {/* Gantt bar area */}
                      <div className="flex-1 relative h-6 pr-4">
                        {/* Background track */}
                        <div className="absolute inset-y-1.5 left-0 right-4 bg-gray-100 rounded-full" />

                        {/* Today marker */}
                        <div
                          className="absolute top-0 bottom-0 w-px bg-[#0078D4]/40 z-10"
                          style={{ left: `${todayPct}%` }}
                          title="Today"
                        />

                        {/* Bar */}
                        <div
                          className={`absolute inset-y-1.5 rounded-full transition-all ${barColor}`}
                          style={{ left: `${startPct}%`, width: `${barWidth}%` }}
                          title={`${step.dueDate ? `Due: ${formatDate(step.dueDate)}` : ""}${step.completedAt ? `  Completed: ${formatDate(step.completedAt)}` : ""}`}
                        />

                        {/* Date labels on hover */}
                        <div className="absolute right-0 inset-y-0 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-[9px] text-muted-foreground whitespace-nowrap">
                            {step.completedAt
                              ? `✓ ${formatDate(step.completedAt)}`
                              : step.dueDate
                              ? `Due ${formatDate(step.dueDate)}`
                              : ""}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Summary footer */}
                <div className="flex items-center gap-4 pt-4 mt-4 border-t border-border text-xs text-muted-foreground">
                  <span>{steps.filter(s => s.status === "completed").length} completed</span>
                  <span>{steps.filter(s => s.status === "in_progress").length} in progress</span>
                  <span>{steps.filter(s => s.status !== "completed" && s.dueDate && new Date(s.dueDate) < now).length} overdue</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {secondaryTab === "contracts" && (
        <div className="space-y-4">
          {contracts.length === 0 ? (
            <div className="bg-white border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">
              No signed contracts are linked to this project yet.
            </div>
          ) : contracts.map(c => (
            <div key={c.id} className="bg-white border border-border rounded-xl shadow-sm p-5 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1 min-w-0">
                <Link href={`/portal/billing/contracts/${c.id}`}>
                  <p className="text-sm font-bold text-[#0078D4] hover:underline cursor-pointer">{c.serviceName}</p>
                </Link>
                {c.signerName && (
                  <p className="text-xs text-muted-foreground mt-0.5">Signed by {c.signerName}</p>
                )}
                {c.signedAt && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(c.signedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {c.sharepointFileUrl ? (
                  <a
                    href={c.sharepointFileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors px-3 py-1.5 border border-[#0078D4]/30 rounded-lg hover:bg-[#0078D4]/5"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    Open in SharePoint
                  </a>
                ) : null}
                {!c.sharepointFileUrl && c.localFilePath ? (
                  <a
                    href={`/api/portal/contracts/${c.id}/pdf`}
                    download={c.pdfFilename ?? `contract-${c.id}.pdf`}
                    className="flex items-center gap-1.5 text-sm font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors px-3 py-1.5 border border-[#0078D4]/30 rounded-lg hover:bg-[#0078D4]/5"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download PDF
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Question Dialog */}
      {questionDialogReportId !== null && (() => {
        const report = statusReports.find(r => r.id === questionDialogReportId);
        if (!report) return null;
        return (
          <QuestionDialog
            reportTitle={report.title}
            onSubmit={q => void handleAcknowledge(report.id, "has_questions", q)}
            onCancel={() => setQuestionDialogReportId(null)}
            submitting={acknowledging}
          />
        );
      })()}

      <KanbanCardModal
        task={selectedTask}
        stepTitle={selectedStepTitle}
        open={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        mode="client"
      />

      {/* ── Closure Sign-Off Modal ─────────────────────────────────────────── */}
      {signModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            {/* Header */}
            <div className="bg-[#0A2540] px-6 py-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-extrabold text-white">Project Sign-Off</h2>
                  <p className="text-white/50 text-xs mt-0.5">Confirm project delivery and leave your feedback</p>
                </div>
                <button onClick={() => setSignModalOpen(false)} className="text-white/40 hover:text-white/80 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Project Summary */}
              <div className="bg-[#F7F9FC] border border-border rounded-xl p-4">
                <p className="text-xs font-bold text-[#0A2540]">{project.title}</p>
                {project.description && (
                  <p className="text-xs text-muted-foreground leading-relaxed mt-1">{project.description}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[10px] font-medium text-muted-foreground">
                  {project.startDate && (
                    <span>Started: {new Date(project.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  )}
                  {project.endDate && (
                    <span>Target: {new Date(project.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  )}
                </div>
              </div>

              {/* Feedback */}
              <div>
                <label className="block text-xs font-bold text-[#0A2540] mb-1.5">
                  Your Feedback <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={4}
                  value={closureFeedback}
                  onChange={e => setClosureFeedback(e.target.value)}
                  placeholder="How was working with Shane? What impact did this project have on your team?…"
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
                />
              </div>

              {/* Permission checkbox */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={closurePermission}
                  onChange={e => setClosurePermission(e.target.checked)}
                  className="mt-0.5 accent-[#0078D4] w-4 h-4 flex-shrink-0"
                />
                <span className="text-xs text-[#0A2540] leading-relaxed group-hover:text-[#0078D4] transition-colors">
                  I give permission for my feedback to be published as a testimonial on the Shane McCaw Consulting website. I understand I can request removal at any time.
                </span>
              </label>

              {/* Signature canvas */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-[#0A2540]">Your Signature <span className="text-red-500">*</span></label>
                  <button
                    type="button"
                    onClick={() => sigCanvasRef.current?.clear()}
                    className="text-[10px] text-muted-foreground hover:text-[#0078D4] transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <div className="border-2 border-dashed border-border rounded-xl overflow-hidden bg-gray-50 touch-none">
                  <SignatureCanvas
                    ref={sigCanvasRef}
                    canvasProps={{ className: "w-full", height: 140, style: { display: "block" } }}
                    backgroundColor="transparent"
                    penColor="#0A2540"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Draw your signature above using your mouse or finger</p>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setSignModalOpen(false)}
                  className="flex-1 border border-border text-sm font-semibold py-2.5 rounded-xl hover:bg-[#F7F9FC] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleSignClosure()}
                  disabled={closureSigning || !closureFeedback.trim() || sigCanvasRef.current?.isEmpty() !== false}
                  className="flex-1 bg-[#0078D4] text-white text-sm font-bold py-2.5 rounded-xl hover:bg-[#0078D4]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {closureSigning ? (
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  )}
                  {closureSigning ? "Signing…" : "Sign Off"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {viewerFile && (
        <SpFileViewerModal
          projectId={Number(params.id)}
          file={viewerFile}
          onClose={() => setViewerFile(null)}
          fetchWithAuth={fetchWithAuth}
        />
      )}
    </PortalLayout>
  );
}
