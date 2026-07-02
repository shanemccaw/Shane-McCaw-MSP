import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface DocumentPanelProps {
  doc: {
    id: number;
    title: string;
    category: "report" | "consulting";
    docType: string;
    htmlContent: string;
  };
}

const DOC_TYPE_LABELS: Record<string, string> = {
  executive_summary: "Executive Summary",
  full_readiness_report: "Full Readiness Report",
  security_posture_report: "Security Posture Report",
  governance_maturity_report: "Governance Maturity Report",
  data_exposure_risk_report: "Data Exposure Risk Report",
  license_optimization_report: "License Optimization Report",
  sow: "Statement of Work",
  remediation_plan: "Remediation Plan",
  deployment_plan: "Deployment Plan",
  governance_framework: "Governance Framework",
  security_hardening_plan: "Security Hardening Plan",
  copilot_enablement_plan: "Copilot Enablement Plan",
  identity_modernization_plan: "Identity Modernization Plan",
};

export default function DocumentPanel({ doc }: DocumentPanelProps) {
  const { fetchWithAuth } = useAuth();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetchWithAuth(`/api/portal/insights-documents/${doc.id}/view`);
      const data = await res.json() as { htmlContent?: string };
      const html = data.htmlContent ?? "";
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.title.replace(/\s+/g, "-")}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  const typeLabel = DOC_TYPE_LABELS[doc.docType] ?? doc.docType;
  const categoryLabel = doc.category === "consulting" ? "Consulting Deliverable" : "Assessment Report";

  return (
    <div className="flex flex-col h-full">
      {/* Document header */}
      <div className="flex items-start justify-between gap-4 mb-4 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-[#0A2540] truncate">{doc.title}</h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                doc.category === "consulting"
                  ? "bg-purple-100 text-purple-700"
                  : "bg-[#0078D4]/10 text-[#0078D4]"
              }`}>
                {categoryLabel}
              </span>
              <span className="text-xs bg-gray-100 text-gray-600 font-semibold px-2 py-0.5 rounded-full">
                {typeLabel}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={() => void handleDownload()}
          disabled={downloading}
          className="flex items-center gap-1.5 text-sm font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors px-3 py-1.5 border border-[#0078D4]/30 rounded-lg hover:bg-[#0078D4]/5 flex-shrink-0 disabled:opacity-50"
        >
          {downloading ? (
            <div className="w-4 h-4 border-2 border-[#0078D4]/30 border-t-[#0078D4] rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          )}
          Download
        </button>
      </div>

      {/* Document content */}
      <div className="flex-1 overflow-y-auto bg-white rounded-xl border border-border shadow-sm">
        <div
          className="p-6"
          dangerouslySetInnerHTML={{ __html: doc.htmlContent.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```\s*$/, "").trim() }}
        />
      </div>
    </div>
  );
}
