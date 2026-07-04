import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

interface Report {
  id: number;
  title: string;
  period: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  reportDate: string | null;
  createdAt: string;
}

interface InsightsDocument {
  id: number;
  title: string;
  category: "report" | "consulting";
  docType: string;
  status: string;
  deliveredAt: string | null;
  createdAt: string;
  sowTotalPrice?: string | null;
  projectId?: number | null;
  projectTitle?: string | null;
}

const PERIOD_LABELS: Record<string, string> = {
  weekly: "Weekly Report",
  monthly: "Monthly Report",
  executive_summary: "Executive Summary",
  other: "Report",
};

const PERIOD_COLORS: Record<string, string> = {
  weekly: "bg-blue-100 text-blue-700",
  monthly: "bg-purple-100 text-purple-700",
  executive_summary: "bg-[#0078D4]/10 text-[#0078D4]",
  other: "bg-gray-100 text-gray-600",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  executive_summary:           "Executive Summary",
  full_readiness_report:       "Full Readiness Report",
  security_posture_report:     "Security Posture Report",
  governance_maturity_report:  "Governance Maturity Report",
  data_exposure_risk_report:   "Data Exposure Risk Report",
  license_optimization_report: "License Optimization Report",
  scoped_sow:                  "Scoped SOW",
  sow:                         "Statement of Work",
  consolidated_sow:            "Consolidated SOW",
  remediation_plan:            "Remediation Plan",
  deployment_plan:             "Deployment Plan",
  governance_framework:        "Governance Framework",
  security_hardening_plan:     "Security Hardening Plan",
  copilot_enablement_plan:     "Copilot Enablement Plan",
  identity_modernization_plan: "Identity Modernization Plan",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function groupByPeriod(reports: Report[]): Record<string, Report[]> {
  const groups: Record<string, Report[]> = {};
  const order = ["executive_summary", "monthly", "weekly", "other"];
  for (const r of reports) {
    if (!groups[r.period]) groups[r.period] = [];
    groups[r.period].push(r);
  }
  const sorted: Record<string, Report[]> = {};
  for (const key of order) {
    if (groups[key]) sorted[key] = groups[key];
  }
  return sorted;
}

function DocIcon() {
  return (
    <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

export default function PortalReports() {
  const { fetchWithAuth } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [insightsDocs, setInsightsDocs] = useState<InsightsDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingDoc, setViewingDoc] = useState<{ id: number; title: string; html: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetchWithAuth("/api/portal/reports").then(r => r.json()).catch(() => []),
      fetchWithAuth("/api/portal/insights-documents").then(r => r.json()).catch(() => []),
    ]).then(([rpts, docs]) => {
      setReports(rpts as Report[]);
      setInsightsDocs(docs as InsightsDocument[]);
    }).finally(() => setLoading(false));
  }, [fetchWithAuth]);

  async function openDoc(doc: InsightsDocument) {
    const res = await fetchWithAuth(`/api/portal/insights-documents/${doc.id}/view`);
    const data = await res.json() as { htmlContent?: string };
    setViewingDoc({ id: doc.id, title: doc.title, html: data.htmlContent ?? "" });
  }

  const grouped = groupByPeriod(reports);
  const hasContent = reports.length > 0 || insightsDocs.length > 0;

  return (
    <PortalLayout>
      {viewingDoc && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setViewingDoc(null)}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-base font-bold text-[#0A2540] truncate">{viewingDoc.title}</h2>
              <button
                onClick={() => setViewingDoc(null)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center flex-shrink-0 ml-3 transition-colors"
              >
                <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div
              className="flex-1 overflow-y-auto p-6"
              dangerouslySetInnerHTML={{ __html: viewingDoc.html }}
            />
          </div>
        </div>
      )}

      <div className="px-4 sm:px-6 py-6 sm:py-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-[#0A2540]">Reporting Center</h1>
          <p className="text-muted-foreground text-sm mt-1">All reports and documents from Shane — view or download at any time.</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !hasContent ? (
          <div className="bg-white border border-border rounded-xl p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-[#0078D4]/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-[#0A2540] font-bold mb-2">No reports yet</h3>
            <p className="text-muted-foreground text-sm">Reports and documents will appear here once Shane delivers them.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {insightsDocs.length > 0 && (
              <section>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">AI-Generated Documents</h2>
                  <span className="text-xs bg-[#F7F9FC] border border-border text-muted-foreground font-semibold px-2 py-0.5 rounded-full">{insightsDocs.length}</span>
                </div>
                <div className="bg-white border border-border rounded-xl divide-y divide-border">
                  {insightsDocs.map(doc => (
                    <div key={doc.id} className="flex items-center gap-4 px-5 py-4">
                      <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                        <DocIcon />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <p className="text-sm font-bold text-[#0A2540]">{doc.title}</p>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            doc.category === "consulting"
                              ? "bg-purple-100 text-purple-700"
                              : "bg-[#0078D4]/10 text-[#0078D4]"
                          }`}>
                            {doc.category === "consulting" ? "Consulting" : "Report"}
                          </span>
                          <span className="text-xs bg-gray-100 text-gray-600 font-semibold px-2 py-0.5 rounded-full">
                            {DOC_TYPE_LABELS[doc.docType] ?? doc.docType}
                          </span>
                          {doc.docType === "scoped_sow" && (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                              doc.status === "delivered"
                                ? "bg-blue-100 text-blue-700"
                                : doc.status === "approved"
                                ? "bg-green-100 text-green-700"
                                : "bg-yellow-100 text-yellow-700"
                            }`}>
                              {doc.status === "delivered" ? "Delivered" : doc.status === "approved" ? "Approved" : "Draft"}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          {doc.deliveredAt && (
                            <span>Delivered {new Date(doc.deliveredAt).toLocaleDateString()}</span>
                          )}
                          {doc.docType === "scoped_sow" && !doc.deliveredAt && (
                            <span>Created {new Date(doc.createdAt).toLocaleDateString()}</span>
                          )}
                          {doc.projectTitle && (
                            <span className="text-[#0078D4]">· {doc.projectTitle}</span>
                          )}
                          {doc.sowTotalPrice && (
                            <span className="font-semibold text-[#0A2540]">
                              Total: ${parseFloat(doc.sowTotalPrice).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => openDoc(doc)}
                        className="flex items-center gap-1.5 text-sm font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors px-3 py-1.5 border border-[#0078D4]/30 rounded-lg hover:bg-[#0078D4]/5 flex-shrink-0"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        <span className="hidden sm:inline">View</span>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {Object.entries(grouped).map(([period, periodReports]) => (
              <section key={period}>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">{PERIOD_LABELS[period] ?? period}s</h2>
                  <span className="text-xs bg-[#F7F9FC] border border-border text-muted-foreground font-semibold px-2 py-0.5 rounded-full">{periodReports.length}</span>
                </div>
                <div className="bg-white border border-border rounded-xl divide-y divide-border">
                  {periodReports.map(r => (
                    <div key={r.id} className="flex items-center gap-4 px-5 py-4">
                      <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                        <DocIcon />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <p className="text-sm font-bold text-[#0A2540]">{r.title}</p>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PERIOD_COLORS[r.period] ?? "bg-gray-100 text-gray-600"}`}>
                            {PERIOD_LABELS[r.period] ?? r.period}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          {r.reportDate && <span>Period: {new Date(r.reportDate).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>}
                          {r.sizeBytes && <span>{formatBytes(r.sizeBytes)}</span>}
                          {r.mimeType && <span>{r.mimeType.split("/")[1]?.toUpperCase()}</span>}
                          <span>Uploaded {new Date(r.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          const res = await fetchWithAuth(`/api/portal/reports/${r.id}/download`);
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url; a.download = r.filename || r.title; a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="flex items-center gap-1.5 text-sm font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors px-3 py-1.5 border border-[#0078D4]/30 rounded-lg hover:bg-[#0078D4]/5 flex-shrink-0"
                        title="Download"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        <span className="hidden sm:inline">Download</span>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
