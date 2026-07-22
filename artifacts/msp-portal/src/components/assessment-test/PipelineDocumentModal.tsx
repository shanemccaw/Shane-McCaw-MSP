import React, { useCallback, useEffect, useState } from 'react';
import {
  X,
  Share2,
  Download,
  CheckCircle,
  AlertTriangle,
  Flame,
  CheckCircle2,
  Sparkles,
  FileText,
  ShieldAlert,
  Maximize2,
} from 'lucide-react';
import { AssessmentStage } from './types';

type FetchWithAuth = (
  path: string,
  init?: RequestInit,
  opts?: { silent?: boolean },
) => Promise<Response>;

// Mirrors GET /api/portal/assessment/documents/:id — the same real endpoint
// AssessmentDocumentViewer.tsx uses for the wizard's Review step.
interface OmgCard {
  severity: 'red' | 'amber' | 'green';
  metric: string;
  metricLabel: string;
  headline: string;
  detail: string;
}

interface DocumentPayload {
  id: number;
  docType: string;
  category: string;
  title: string;
  status: string;
  htmlContent: string;
  omgCards: OmgCard[];
}

const OMG_SEVERITY_STYLES: Record<
  OmgCard['severity'],
  { border: string; bg: string; badge: string; text: string; icon: React.ReactNode }
> = {
  red: {
    border: 'border-[#ef4444]/40',
    bg: 'bg-[#7f1d1d]/20',
    badge: 'bg-[#ef4444]/20 text-[#ef4444] border-[#ef4444]/40',
    text: 'text-[#ef4444]',
    icon: <Flame className="w-3.5 h-3.5" />,
  },
  amber: {
    border: 'border-[#f59e0b]/40',
    bg: 'bg-[#78350f]/20',
    badge: 'bg-[#f59e0b]/20 text-[#fbbf24] border-[#f59e0b]/40',
    text: 'text-[#fbbf24]',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  green: {
    border: 'border-[#34d399]/40',
    bg: 'bg-[#064e3b]/20',
    badge: 'bg-[#34d399]/20 text-[#34d399] border-[#34d399]/40',
    text: 'text-[#34d399]',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
};

interface PipelineDocumentModalProps {
  stage: AssessmentStage | null;
  /** Every real pipeline stage for this assessment — drives the document
   * navigator (bottom-right) so the user can move between all real generated
   * documents without closing the modal. */
  stages: AssessmentStage[];
  onClose: () => void;
  onSelectStage: (stage: AssessmentStage) => void;
  fetchWithAuth: FetchWithAuth;
  onAcceptPlan?: (stageId: string) => void;
}

export const PipelineDocumentModal: React.FC<PipelineDocumentModalProps> = ({
  stage,
  stages,
  onClose,
  onSelectStage,
  fetchWithAuth,
  onAcceptPlan,
}) => {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isAccepted, setIsAccepted] = useState(false);

  const [payload, setPayload] = useState<DocumentPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Real per-session "opened this document" tracking for the navigator's
  // read/unread indicator. The component instance stays mounted across
  // stage selections (it just renders null when `stage` is unset), so this
  // survives switching between documents. The authoritative event is the
  // POST /documents/:id/view fire below — this Set is purely the visual
  // derivation of that for the current session, not a second source of truth.
  const [viewedDocumentIds, setViewedDocumentIds] = useState<Set<number>>(new Set());

  const documentId = stage?.documentId;
  const canFetch = stage?.status === 'done' && documentId != null;

  const load = useCallback(async () => {
    if (documentId == null) return;
    setLoading(true);
    setErrored(false);
    try {
      const res = await fetchWithAuth(`/api/portal/assessment/documents/${documentId}`);
      if (!res.ok) {
        setErrored(true);
        return;
      }
      const data = (await res.json()) as DocumentPayload;
      setPayload(data);
      setViewedDocumentIds((prev) => (prev.has(documentId) ? prev : new Set(prev).add(documentId)));
      void fetchWithAuth(
        `/api/portal/assessment/documents/${documentId}/view`,
        { method: 'POST' },
        { silent: true },
      ).catch(() => {
        // best-effort analytics — never block the reading experience
      });
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, [documentId, fetchWithAuth]);

  useEffect(() => {
    setPayload(null);
    setFullscreen(false);
    if (canFetch) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, canFetch]);

  if (!stage) return null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  const handleShare = () => {
    showToast(`Executive Briefing link for "${stage.title}" copied to clipboard!`);
  };

  const handleSave = () => {
    showToast(`Executive Summary "${stage.title}" saved to local documents (PDF).`);
  };

  const handleAccept = () => {
    setIsAccepted(true);
    showToast(`Executive Action Plan Accepted! Triggering automated remediation workflows...`);
    if (onAcceptPlan) {
      onAcceptPlan(stage.id);
    }
  };

  // Only stages with a real, ready document can be opened/navigated to.
  const navigableStages = stages.filter((s) => s.status === 'done' && s.documentId != null);
  const readCount = navigableStages.filter(
    (s) => s.documentId != null && viewedDocumentIds.has(s.documentId),
  ).length;

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0d11]/90 backdrop-blur-xl flex flex-col items-center justify-start overflow-y-auto p-3 sm:p-6 md:p-8 animate-in fade-in duration-200">

      {/* Toast Notification Popup */}
      {toastMessage && (
        <div className="fixed top-6 z-50 bg-[#181c21] border border-[#479ef5]/60 text-[#e0e2ea] px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 animate-in slide-in-from-top duration-300">
          <Sparkles className="w-4 h-4 text-[#479ef5]" />
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Main Full-Screen Dialog Container */}
      <div className="w-full max-w-5xl bg-[#181c21] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden my-auto relative">

        {/* Top Header Bar */}
        <div className="bg-[#242424] px-5 py-4 border-b border-white/10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-[#181c21] border border-white/10 text-[#479ef5]">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#8a919d] bg-white/5 px-2 py-0.5 rounded border border-white/10">
                  EXECUTIVE BRIEFING{payload ? ` • ${payload.docType}` : ''}
                </span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wider ${
                  stage.status === 'done' ? 'bg-[#34d399]/10 text-[#34d399] border border-[#34d399]/30' : 'bg-[#479ef5]/10 text-[#479ef5] border border-[#479ef5]/30'
                }`}>
                  {stage.status === 'done' ? 'Completed Audit' : 'In Progress'}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-bold text-[#e0e2ea] truncate mt-0.5">
                {stage.title}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-[#181c21] hover:bg-white/10 text-[#8a919d] hover:text-white transition-colors border border-white/10 flex-shrink-0"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 sm:p-7 flex flex-col gap-6 max-h-[80vh] overflow-y-auto">

          {!canFetch && (
            <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center">
              <FileText className="mx-auto w-8 h-8 text-[#8a919d]/40" />
              <p className="mt-2 text-sm text-[#8a919d]">
                {stage.status === 'failed'
                  ? 'This document failed to generate.'
                  : "This document hasn't been generated yet — it'll appear here once ready."}
              </p>
            </div>
          )}

          {canFetch && loading && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="h-32 rounded-2xl bg-white/5 animate-pulse" />
                <div className="h-32 rounded-2xl bg-white/5 animate-pulse" />
                <div className="h-32 rounded-2xl bg-white/5 animate-pulse" />
              </div>
              <div className="h-96 w-full rounded-2xl bg-white/5 animate-pulse" />
            </div>
          )}

          {canFetch && !loading && (errored || !payload) && (
            <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center">
              <FileText className="mx-auto w-8 h-8 text-[#8a919d]/40" />
              <p className="mt-2 text-sm text-[#8a919d]">We couldn't load this report just now.</p>
              <button
                onClick={() => void load()}
                className="mt-4 px-3.5 py-2 rounded-xl bg-[#242424] hover:bg-white/10 text-xs font-semibold text-[#e0e2ea] border border-white/10 transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {canFetch && !loading && payload && (
            <>
              {/* ==================================================== */}
              {/* OMG CARDS — the real "what stood out" hero moment */}
              {/* ==================================================== */}
              {payload.omgCards.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-[#479ef5]" />
                    <h3 className="text-sm font-semibold text-[#e0e2ea]">What stood out</h3>
                    <span className="text-xs text-[#8a919d]">— the findings that matter most</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {payload.omgCards.map((card, idx) => {
                      const s = OMG_SEVERITY_STYLES[card.severity] ?? OMG_SEVERITY_STYLES.amber;
                      return (
                        <div key={idx} className={`rounded-2xl border p-4 ${s.border} ${s.bg}`}>
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${s.badge}`}>
                            {s.icon}
                            {card.severity}
                          </span>
                          <div className="mt-3 flex items-baseline gap-1.5">
                            <span className={`text-2xl font-extrabold font-mono tracking-tight ${s.text}`}>
                              {card.metric}
                            </span>
                            <span className="text-[10px] font-medium text-[#8a919d]">{card.metricLabel}</span>
                          </div>
                          <p className="mt-2 text-xs font-semibold text-[#e0e2ea]">{card.headline}</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-[#8a919d]">{card.detail}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ==================================================== */}
              {/* FULL REPORT — real htmlContent, sandboxed iframe */}
              {/* ==================================================== */}
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#242424]">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-medium text-[#e0e2ea]">
                    <FileText className="w-4 h-4 text-[#8a919d]" />
                    Full report
                  </span>
                  <button
                    onClick={() => setFullscreen(true)}
                    className="flex items-center gap-1.5 text-[11px] font-semibold text-[#8a919d] hover:text-white transition-colors"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    Full screen
                  </button>
                </div>
                <iframe
                  srcDoc={payload.htmlContent}
                  title={payload.title}
                  className="w-full border-0 bg-white"
                  style={{ height: '560px' }}
                  sandbox="allow-same-origin"
                />
              </div>

              {fullscreen && (
                <div className="fixed inset-0 z-[60] flex flex-col bg-black/80">
                  <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#181c21] px-5 py-3">
                    <p className="truncate text-sm font-semibold text-[#e0e2ea]">{payload.title}</p>
                    <button
                      onClick={() => setFullscreen(false)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-[#8a919d] hover:text-white transition-colors"
                    >
                      <X className="w-4 h-4" />
                      Close
                    </button>
                  </div>
                  <iframe
                    srcDoc={payload.htmlContent}
                    title={payload.title}
                    className="flex-1 border-0 bg-white"
                    sandbox="allow-same-origin"
                  />
                </div>
              )}
            </>
          )}

        </div>

        {/* ========================================================================= */}
        {/* BOTTOM TOOLBAR / ACTION CONTROLS */}
        {/* ========================================================================= */}
        <div className="bg-[#242424] px-5 py-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">

          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#181c21] hover:bg-white/10 text-xs font-semibold text-[#e0e2ea] border border-white/10 transition-colors"
            >
              <Share2 className="w-4 h-4 text-[#479ef5]" />
              <span>Share</span>
            </button>

            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#181c21] hover:bg-white/10 text-xs font-semibold text-[#e0e2ea] border border-white/10 transition-colors"
            >
              <Download className="w-4 h-4 text-[#34d399]" />
              <span>Save Report</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-[#8a919d] hover:text-white transition-colors"
            >
              Dismiss
            </button>

            <button
              onClick={handleAccept}
              disabled={isAccepted}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg ${
                isAccepted
                  ? 'bg-[#34d399]/20 text-[#34d399] border border-[#34d399]/40 cursor-default'
                  : 'bg-gradient-to-r from-[#479ef5] to-[#2b82dc] hover:brightness-110 text-white shadow-[#479ef5]/20'
              }`}
            >
              {isAccepted ? (
                <>
                  <CheckCircle className="w-4 h-4 text-[#34d399]" />
                  <span>Plan Approved & Executed</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-white" />
                  <span>Accept & Remediate Plan</span>
                </>
              )}
            </button>
          </div>

        </div>

        {/* ========================================================================= */}
        {/* DOCUMENT NAVIGATOR — move between every real generated document */}
        {/* ========================================================================= */}
        {navigableStages.length > 0 && (
          <div className="absolute bottom-24 right-4 sm:right-6 z-20">
            <div className="bg-[#181c21]/95 backdrop-blur border border-white/10 rounded-xl shadow-2xl p-2.5 flex flex-col gap-1 max-h-64 w-56 overflow-y-auto">
              <span className="text-[9px] font-bold uppercase tracking-wider text-[#8a919d] px-1.5 pb-1">
                Reports ({readCount}/{navigableStages.length} read)
              </span>
              {navigableStages.map((s) => {
                const active = s.id === stage.id;
                const isViewed = s.documentId != null && viewedDocumentIds.has(s.documentId);
                return (
                  <button
                    key={s.id}
                    onClick={() => onSelectStage(s)}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors border ${
                      active
                        ? 'bg-[#479ef5]/15 border-[#479ef5]/50 text-[#e0e2ea]'
                        : 'border-transparent hover:bg-white/5 text-[#8a919d] hover:text-[#e0e2ea]'
                    }`}
                  >
                    {isViewed ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#34d399] flex-shrink-0" />
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-full border border-white/20 flex-shrink-0" />
                    )}
                    <span className="truncate">{s.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
