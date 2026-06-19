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

export default function PortalReports() {
  const { fetchWithAuth } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/portal/reports")
      .then(r => r.json())
      .then(d => setReports(d as Report[]))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  const grouped = groupByPeriod(reports);

  return (
    <PortalLayout>
      <div className="px-6 py-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-[#0A2540]">Reporting Center</h1>
          <p className="text-muted-foreground text-sm mt-1">All reports from Shane — download or review at any time.</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : reports.length === 0 ? (
          <div className="bg-white border border-border rounded-xl p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-[#0078D4]/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-[#0A2540] font-bold mb-2">No reports yet</h3>
            <p className="text-muted-foreground text-sm">Reports will appear here once Shane uploads them.</p>
          </div>
        ) : (
          <div className="space-y-8">
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
                        <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
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
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
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
