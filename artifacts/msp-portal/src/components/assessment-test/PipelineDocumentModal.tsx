import React, { useState } from 'react';
import {
  X,
  Share2,
  Download,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  Flame,
  CheckCircle2,
  Sparkles,
  Copy,
  Check,
  FileText,
  ShieldAlert,
  ArrowRight,
  TrendingDown,
  DollarSign,
  Building2,
  Calendar,
} from 'lucide-react';
import { AssessmentStage } from './types';

interface PipelineDocumentModalProps {
  stage: AssessmentStage | null;
  onClose: () => void;
  onAcceptPlan?: (stageId: string) => void;
}

export const PipelineDocumentModal: React.FC<PipelineDocumentModalProps> = ({
  stage,
  onClose,
  onAcceptPlan,
}) => {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isAccepted, setIsAccepted] = useState(false);

  if (!stage) return null;

  const docData = stage.documentData;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    showToast('PowerShell remediation snippet copied to clipboard!');
    setTimeout(() => setCopiedCode(false), 2000);
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

  // Severity color styles for OMG Hero Card:
  // red: panic / bad
  // yellow: meh / warning
  // green: good / optimal
  const severity = docData?.severity || 'red';

  const getHeroStyles = () => {
    switch (severity) {
      case 'red':
        return {
          bgGrad: 'from-[#7f1d1d]/80 via-[#2a0c0c] to-[#181c21]',
          borderColor: 'border-[#ef4444]/60',
          badgeBg: 'bg-[#ef4444]/20 border-[#ef4444]/60 text-[#ef4444]',
          icon: <Flame className="w-5 h-5 text-[#ef4444] animate-pulse" />,
          statText: 'bg-gradient-to-r from-[#ef4444] via-[#f87171] to-[#fca5a5] bg-clip-text text-transparent',
          accentText: 'text-[#ef4444]',
          glowShadow: 'shadow-[0_0_30px_rgba(239,68,68,0.25)]',
        };
      case 'yellow':
        return {
          bgGrad: 'from-[#78350f]/80 via-[#261808] to-[#181c21]',
          borderColor: 'border-[#f59e0b]/60',
          badgeBg: 'bg-[#f59e0b]/20 border-[#f59e0b]/60 text-[#fbbf24]',
          icon: <AlertTriangle className="w-5 h-5 text-[#fbbf24]" />,
          statText: 'bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#fef08a] bg-clip-text text-transparent',
          accentText: 'text-[#fbbf24]',
          glowShadow: 'shadow-[0_0_30px_rgba(245,158,11,0.25)]',
        };
      case 'green':
      default:
        return {
          bgGrad: 'from-[#064e3b]/80 via-[#0a2318] to-[#181c21]',
          borderColor: 'border-[#34d399]/60',
          badgeBg: 'bg-[#34d399]/20 border-[#34d399]/60 text-[#34d399]',
          icon: <CheckCircle2 className="w-5 h-5 text-[#34d399]" />,
          statText: 'bg-gradient-to-r from-[#10b981] via-[#34d399] to-[#a7f3d0] bg-clip-text text-transparent',
          accentText: 'text-[#34d399]',
          glowShadow: 'shadow-[0_0_30px_rgba(52,211,153,0.25)]',
        };
    }
  };

  const heroStyle = getHeroStyles();

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
                  EXECUTIVE BRIEFING • DOC-2026-M365
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
          
          {/* ========================================================================= */}
          {/* OMG HERO MOMENT CARD AT TOP */}
          {/* ========================================================================= */}
          {docData && (
            <div
              className={`rounded-2xl border p-5 sm:p-6 bg-gradient-to-br ${heroStyle.bgGrad} ${heroStyle.borderColor} ${heroStyle.glowShadow} relative overflow-hidden transition-all duration-300`}
            >
              {/* Subtle Background Pattern Accent */}
              <div className="absolute -right-12 -bottom-12 w-64 h-64 bg-white/5 rounded-full blur-3xl pointer-events-none" />

              {/* OMG Header Badge */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-bold uppercase tracking-wider ${heroStyle.badgeBg}`}>
                  {heroStyle.icon}
                  <span>{docData.omgHeroBadge}</span>
                </div>

                <div className="text-[11px] font-mono text-[#8a919d] flex items-center gap-1.5 bg-black/30 px-2.5 py-1 rounded-lg border border-white/5">
                  <Calendar className="w-3.5 h-3.5 text-[#479ef5]" />
                  <span>Real-time Telemetry Verification</span>
                </div>
              </div>

              {/* OMG Stat Highlight (Panic / Hero Figure) */}
              <div className="my-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8a919d] mb-1">
                  Executive Highlight
                </p>
                <h3 className={`text-2xl sm:text-3xl md:text-4xl font-extrabold font-mono tracking-tight ${heroStyle.statText}`}>
                  {docData.omgHeroStat}
                </h3>
              </div>

              {/* OMG Panic Quote Block */}
              <div className="bg-black/40 border border-white/10 rounded-xl p-4 mt-3">
                <p className="text-xs sm:text-sm text-[#e0e2ea] leading-relaxed font-medium">
                  {docData.omgHeroHighlight}
                </p>
              </div>

              {/* Key Quick Stats Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-white/10 text-xs">
                {docData.annualWasteCost && (
                  <div className="bg-black/30 rounded-lg p-2.5 border border-white/5">
                    <span className="text-[10px] text-[#8a919d] block">Financial Exposure</span>
                    <span className="text-sm font-bold text-[#e0e2ea] font-mono">{docData.annualWasteCost}</span>
                  </div>
                )}
                {docData.affectedItemsCount !== undefined && (
                  <div className="bg-black/30 rounded-lg p-2.5 border border-white/5">
                    <span className="text-[10px] text-[#8a919d] block">Affected Entities</span>
                    <span className="text-sm font-bold text-[#e0e2ea] font-mono">{docData.affectedItemsCount} Items</span>
                  </div>
                )}
                <div className="bg-black/30 rounded-lg p-2.5 border border-white/5 col-span-2 sm:col-span-1">
                  <span className="text-[10px] text-[#8a919d] block">Severity Index</span>
                  <span className={`text-sm font-bold uppercase font-mono ${heroStyle.accentText}`}>
                    {severity === 'red' ? 'HIGH / URGENT' : severity === 'yellow' ? 'MODERATE' : 'OPTIMAL'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* DOCUMENT VIEWER CONTAINER */}
          {/* ========================================================================= */}
          <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 sm:p-7 shadow-xl flex flex-col gap-6 relative">
            
            {/* Formal Document Header */}
            <div className="border-b border-white/10 pb-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="w-4 h-4 text-[#479ef5]" />
                  <span className="text-xs font-bold uppercase tracking-wider text-[#c0c7d3]">
                    Microsoft 365 Architecture & Licensing Audit
                  </span>
                </div>
                <h3 className="text-lg font-bold text-[#e0e2ea]">
                  {stage.title} — Technical Report
                </h3>
              </div>

              <div className="text-left sm:text-right text-[11px] font-mono text-[#8a919d] bg-[#181c21] p-2.5 rounded-lg border border-white/10">
                <div>Tenant ID: <span className="text-[#e0e2ea]">contoso-corp.onmicrosoft.com</span></div>
                <div>Audit Date: <span className="text-[#e0e2ea]">July 22, 2026</span></div>
              </div>
            </div>

            {/* Executive Summary Narrative */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#479ef5] mb-2">
                1. Executive Summary & Overview
              </h4>
              <p className="text-xs sm:text-sm text-[#c0c7d3] leading-relaxed bg-[#181c21]/60 p-4 rounded-xl border border-white/5">
                {docData?.executiveSummaryText || stage.description}
              </p>
            </div>

            {/* Key Findings Table / List */}
            {docData?.keyFindings && docData.keyFindings.length > 0 && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#479ef5] mb-3">
                  2. Critical Audit Findings
                </h4>
                <div className="flex flex-col gap-2.5">
                  {docData.keyFindings.map((finding, idx) => {
                    const isCritical = finding.riskLevel === 'CRITICAL';
                    const isWarning = finding.riskLevel === 'WARNING';

                    return (
                      <div
                        key={idx}
                        className="bg-[#181c21] rounded-xl p-4 border border-white/5 hover:border-white/15 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase font-mono ${
                              isCritical ? 'bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/40' :
                              isWarning ? 'bg-[#f59e0b]/20 text-[#fbbf24] border border-[#f59e0b]/40' :
                              'bg-[#38bdf8]/20 text-[#38bdf8] border border-[#38bdf8]/40'
                            }`}>
                              {finding.riskLevel}
                            </span>
                            <span className="text-xs font-semibold text-[#e0e2ea]">
                              {finding.title}
                            </span>
                          </div>
                          <p className="text-xs text-[#8a919d]">
                            {finding.detail}
                          </p>
                        </div>

                        <div className="text-xs text-[#c0c7d3] bg-white/5 px-3 py-1.5 rounded-lg border border-white/5 sm:max-w-xs flex-shrink-0">
                          <span className="text-[10px] text-[#8a919d] block font-semibold uppercase">Business Impact</span>
                          <span>{finding.impact}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Recommended Action Plan */}
            {docData?.recommendedActions && docData.recommendedActions.length > 0 && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#34d399] mb-3">
                  3. Recommended Remediation Plan
                </h4>
                <ul className="flex flex-col gap-2">
                  {docData.recommendedActions.map((action, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 bg-[#181c21] p-3 rounded-lg border border-white/5 text-xs text-[#e0e2ea]">
                      <CheckCircle2 className="w-4 h-4 text-[#34d399] flex-shrink-0 mt-0.5" />
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* PowerShell Script Code Block */}
            {docData?.powershellSnippet && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#479ef5]">
                    4. Automated PowerShell Script
                  </h4>
                  <button
                    onClick={() => handleCopyCode(docData.powershellSnippet!)}
                    className="flex items-center gap-1.5 text-[11px] font-mono text-[#479ef5] hover:text-white bg-[#181c21] px-2.5 py-1 rounded-md border border-white/10 transition-colors"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5 text-[#34d399]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedCode ? 'Copied!' : 'Copy Snippet'}</span>
                  </button>
                </div>

                <div className="bg-[#101419] rounded-xl p-4 border border-white/10 font-mono text-xs text-[#34d399] overflow-x-auto relative">
                  <pre>{docData.powershellSnippet}</pre>
                </div>
              </div>
            )}

          </div>

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

      </div>
    </div>
  );
};
