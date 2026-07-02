import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface DocumentPanelProps {
  doc: {
    id: number;
    title: string;
    category: "report" | "consulting";
    docType: string;
    htmlContent: string;
  };
  onReady?: () => void;
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

const DOC_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }

  body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.8;
    color: #1e293b;
    background: #fff;
    padding: 2.5rem 3rem;
    max-width: 860px;
    margin: 0 auto;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 800;
    color: #0A2540;
    margin: 0 0 0.25rem;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }
  h1 + p, h1 + div { margin-top: 0.75rem; }

  h2 {
    font-size: 1.05rem;
    font-weight: 700;
    color: #0078D4;
    margin: 2.25rem 0 0.6rem;
    letter-spacing: 0.01em;
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    padding-bottom: 0.35rem;
    border-bottom: 1px solid #e2e8f0;
  }
  h3 {
    font-size: 1rem;
    font-weight: 700;
    color: #0A2540;
    margin: 1.5rem 0 0.4rem;
  }
  h4 {
    font-size: 0.875rem;
    font-weight: 600;
    color: #334155;
    margin: 1.25rem 0 0.35rem;
  }

  p {
    margin: 0 0 0.875rem;
    color: #334155;
    line-height: 1.8;
  }

  ul, ol {
    margin: 0.25rem 0 1rem 1.5rem;
    padding: 0;
    color: #334155;
  }
  li {
    margin-bottom: 0.3rem;
    line-height: 1.7;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0 1.5rem;
    font-size: 0.85rem;
  }
  thead tr {
    background: #f1f5f9;
    border-bottom: 2px solid #cbd5e1;
  }
  th {
    text-align: left;
    padding: 0.55rem 0.75rem;
    font-weight: 600;
    color: #475569;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  td {
    padding: 0.55rem 0.75rem;
    color: #334155;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: top;
  }
  tr:last-child td { border-bottom: none; }

  blockquote, div.callout, div.note, div.highlight, div.info {
    border-left: 3px solid #0078D4;
    background: #f8fafc;
    padding: 0.875rem 1.125rem;
    margin: 0.75rem 0 1.25rem;
    border-radius: 0 6px 6px 0;
    color: #475569;
  }
  blockquote p, div.callout p, div.note p, div.highlight p, div.info p {
    margin: 0;
    color: #475569;
  }

  hr {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 1.75rem 0;
  }

  strong, b { font-weight: 600; color: #0A2540; }

  code {
    font-family: "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
    font-size: 0.8em;
    background: #f1f5f9;
    color: #0078D4;
    padding: 0.15em 0.4em;
    border-radius: 4px;
  }
  pre {
    background: #0f172a;
    color: #e2e8f0;
    padding: 1rem 1.25rem;
    border-radius: 8px;
    overflow-x: auto;
    margin: 1rem 0;
    font-size: 0.82rem;
    font-family: "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
  }
  pre code { background: transparent; color: inherit; padding: 0; }

  a { color: #0078D4; text-decoration: none; }
  a:hover { text-decoration: underline; }

  section { margin-bottom: 1.5rem; }

  /* Score / stat callouts the AI sometimes wraps in divs */
  div > strong:only-child { display: block; }
`;

function stripFence(html: string): string {
  return html
    .replace(/^```[a-zA-Z]*\r?\n?/, "")
    .replace(/\r?\n?```\s*$/, "")
    .trim();
}

/** Strip inline style attrs so our stylesheet has full control. */
function cleanInlineStyles(html: string): string {
  return html
    .replace(/\s+style="[^"]*"/gi, "")
    .replace(/\s+style='[^']*'/gi, "");
}

function buildSrcdoc(rawHtml: string): string {
  const body = cleanInlineStyles(stripFence(rawHtml));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${DOC_CSS}</style>
</head>
<body>${body}</body>
</html>`;
}

export default function DocumentPanel({ doc, onReady }: DocumentPanelProps) {
  const { fetchWithAuth } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  const handleIframeLoad = () => {
    setIframeLoaded(true);
    onReady?.();
  };

  const srcdoc = useMemo(() => buildSrcdoc(doc.htmlContent), [doc.htmlContent]);

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

      {/* Document content rendered in an isolated iframe */}
      <div className="flex-1 overflow-hidden rounded-xl border border-border shadow-sm bg-white relative">
        {!iframeLoaded && (
          <div className="absolute inset-0 bg-white rounded-xl p-6 flex flex-col gap-3 z-10">
            <div className="h-7 bg-slate-100 rounded-lg w-1/2 overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.2s_ease-in-out_infinite]" />
            </div>
            <div className="h-4 bg-slate-100 rounded w-full overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.2s_ease-in-out_infinite]" />
            </div>
            <div className="h-4 bg-slate-100 rounded w-11/12 overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.2s_ease-in-out_infinite]" />
            </div>
            <div className="h-4 bg-slate-100 rounded w-4/5 overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.2s_ease-in-out_infinite]" />
            </div>
            <div className="mt-2 h-px bg-slate-100 w-full" />
            <div className="h-4 bg-slate-100 rounded w-full overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.2s_ease-in-out_infinite]" />
            </div>
            <div className="h-4 bg-slate-100 rounded w-10/12 overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.2s_ease-in-out_infinite]" />
            </div>
            <div className="h-4 bg-slate-100 rounded w-full overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.2s_ease-in-out_infinite]" />
            </div>
            <div className="h-4 bg-slate-100 rounded w-3/4 overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.2s_ease-in-out_infinite]" />
            </div>
          </div>
        )}
        <iframe
          srcDoc={srcdoc}
          title={doc.title}
          className="w-full h-full border-0"
          sandbox="allow-same-origin"
          onLoad={handleIframeLoad}
        />
      </div>
    </div>
  );
}
