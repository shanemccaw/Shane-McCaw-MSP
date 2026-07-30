import React, { useState } from 'react';
import { GovernanceState, RoiState } from '../../types';
import { 
  Award, 
  ShieldCheck, 
  AlertTriangle, 
  TrendingUp, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  ArrowRight, 
  Briefcase, 
  Users, 
  Clock, 
  DollarSign, 
  Lock, 
  Sparkles, 
  ChevronRight, 
  Download, 
  HelpCircle, 
  X,
  Layers,
  ShieldAlert,
  Activity,
  Check
} from 'lucide-react';

interface FinalReportScreenProps {
  governance?: GovernanceState;
  roi?: RoiState;
  onContinue: () => void;
  onHelpClick?: () => void;
  onExitClick?: () => void;
  onNavigate?: (step: string) => void;
}

export const FinalReportScreen: React.FC<FinalReportScreenProps> = ({
  governance,
  roi,
  onContinue,
  onHelpClick,
  onExitClick,
  onNavigate
}) => {
  const [selectedFinding, setSelectedFinding] = useState<string | null>('governance');

  // Calculated or props-based metrics
  const isCa01Active = governance?.ca01 ?? true;
  const isPimActive = governance?.pim ?? true;
  const isSensitivityActive = governance?.sensitivityLabels ?? false;

  // Composite Readiness Score (0-100)
  const govScore = (isCa01Active ? 30 : 0) + (isPimActive ? 25 : 0) + (isSensitivityActive ? 35 : 10); // ~65
  const secScore = isCa01Active && isPimActive ? 78 : 55;
  const roiScore = 91;
  const compositeReadinessScore = Math.round((govScore * 0.3) + (secScore * 0.3) + (roiScore * 0.4)); // ~78

  const getReadinessBadge = (score: number) => {
    if (score >= 85) return { label: 'READY FOR ROLLOUT', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
    if (score >= 70) return { label: 'NEEDS REMEDIATION FIXES', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
    return { label: 'CRITICAL BLOCKERS DETECTED', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40' };
  };

  const readinessBadge = getReadinessBadge(compositeReadinessScore);

  return (
    <div className="h-screen w-screen bg-[#07090E] text-slate-100 flex flex-col font-sans overflow-hidden antialiased select-none relative">
      
      {/* ==================================================================== */}
      {/* NAVBAR                                                               */}
      {/* ==================================================================== */}
      <header className="h-14 bg-[#0B0F19]/95 border-b border-white/10 px-5 flex items-center justify-between shrink-0 z-30 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-950 border border-indigo-500/50 flex items-center justify-center text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.3)]">
            <Award className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-black uppercase tracking-wider text-white">
                Executive Final Assessment Report
              </span>
              <span className="text-[10px] font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-0.5 rounded font-extrabold">
                TENANT READINESS BRIEF
              </span>
            </div>
            <p className="text-[10px] text-slate-400">
              Microsoft 365 Copilot Comprehensive Assessment • Architecture & ROI Synthesis
            </p>
          </div>
        </div>

        {/* Status Pills */}
        <div className="hidden lg:flex items-center space-x-3 bg-black/60 px-4 py-1.5 rounded-xl border border-white/10">
          <span className="text-[10px] font-mono uppercase text-slate-400 font-bold">
            Readiness Score:
          </span>
          <div className="flex items-center space-x-2">
            <span className="text-sm font-mono font-black text-amber-400">
              {compositeReadinessScore} / 100
            </span>
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border ${readinessBadge.color}`}>
              {readinessBadge.label}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-3">
          <button
            onClick={onContinue}
            className="flex items-center space-x-2 bg-gradient-to-r from-emerald-500 via-teal-600 to-indigo-600 hover:from-emerald-400 hover:to-indigo-500 text-slate-950 font-extrabold px-4 py-1.5 rounded-lg text-xs transition-all shadow-lg shadow-emerald-950/50 cursor-pointer border border-white/20"
          >
            <span>Proceed to SOW</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          {onExitClick && (
            <button
              onClick={onExitClick}
              className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg border border-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* ==================================================================== */}
      {/* THREE-PANEL BODY LAYOUT                                              */}
      {/* ==================================================================== */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* ================================================================== */}
        {/* LEFT PANEL — KEY FINDINGS                                          */}
        {/* ================================================================== */}
        <aside className="w-80 bg-[#0A0E17]/95 border-r border-white/10 p-3.5 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-3 z-20">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-sky-400" />
              <span>Assessment Key Findings</span>
            </span>
            <span className="text-[9px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
              6 Modules
            </span>
          </div>

          <div className="space-y-2.5">

            {/* 1. Personas Summary */}
            <div
              onClick={() => setSelectedFinding('personas')}
              className={`p-3 rounded-xl border transition-all cursor-pointer ${
                selectedFinding === 'personas'
                  ? 'bg-[#0E1A2B] border-sky-500 ring-1 ring-sky-500/40'
                  : 'bg-[#0E131F] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-sky-400" />
                  Personas Summary
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-emerald-950 text-emerald-300 border-emerald-800 font-bold">
                  Safe
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                4 core enterprise cohorts analyzed. High readiness observed in Engineering & HR.
              </p>
              <div className="mt-2 text-[10px] font-mono text-sky-300 flex justify-between pt-1 border-t border-slate-800">
                <span>Selected Cohorts: 4</span>
                <span>Avg Readiness: 84%</span>
              </div>
            </div>

            {/* 2. Use Case Summary */}
            <div
              onClick={() => setSelectedFinding('use-cases')}
              className={`p-3 rounded-xl border transition-all cursor-pointer ${
                selectedFinding === 'use-cases'
                  ? 'bg-[#0E1A2B] border-sky-500 ring-1 ring-sky-500/40'
                  : 'bg-[#0E131F] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-indigo-400" />
                  Use Case Summary
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-emerald-950 text-emerald-300 border-emerald-800 font-bold">
                  High Fit
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                14 validated high-value use cases. 4 blocked by missing sensitivity classifications.
              </p>
              <div className="mt-2 text-[10px] font-mono text-indigo-300 flex justify-between pt-1 border-t border-slate-800">
                <span>Validated: 14</span>
                <span>Blocked: 4</span>
              </div>
            </div>

            {/* 3. Governance Summary */}
            <div
              onClick={() => setSelectedFinding('governance')}
              className={`p-3 rounded-xl border transition-all cursor-pointer ${
                selectedFinding === 'governance'
                  ? 'bg-[#0E1A2B] border-amber-500 ring-1 ring-amber-500/40'
                  : 'bg-[#0E131F] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  Governance Summary
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-amber-950 text-amber-300 border-amber-800 font-bold">
                  High Risk
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                Purview auto-labeling inactive on 35% of sites. Guest access requires DLP policy tightening.
              </p>
              <div className="mt-2 text-[10px] font-mono text-amber-300 flex justify-between pt-1 border-t border-slate-800">
                <span>Sensitivity Labels: Inactive</span>
                <span>DLP: Moderate</span>
              </div>
            </div>

            {/* 4. Security Summary */}
            <div
              onClick={() => setSelectedFinding('security')}
              className={`p-3 rounded-xl border transition-all cursor-pointer ${
                selectedFinding === 'security'
                  ? 'bg-[#2A0F17] border-rose-500 ring-1 ring-rose-500/40'
                  : 'bg-[#0E131F] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                  Security Summary
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-rose-950 text-rose-300 border-rose-800 font-bold">
                  Critical
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                Entra ID CA01 Conditional Access missing for non-compliant endpoints, elevating blast radius.
              </p>
              <div className="mt-2 text-[10px] font-mono text-rose-300 flex justify-between pt-1 border-t border-slate-800">
                <span>CA01 Status: {isCa01Active ? 'Active' : 'Missing'}</span>
                <span>PIM Admin: Enforced</span>
              </div>
            </div>

            {/* 5. ROI Summary */}
            <div
              onClick={() => setSelectedFinding('roi')}
              className={`p-3 rounded-xl border transition-all cursor-pointer ${
                selectedFinding === 'roi'
                  ? 'bg-[#0F291E] border-emerald-500 ring-1 ring-emerald-500/40'
                  : 'bg-[#0E131F] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  ROI Potential Summary
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-emerald-950 text-emerald-300 border-emerald-800 font-bold">
                  High ROI
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                $226k/yr total projected value. Reclaims 1,240 hrs/month (7.2 FTE equivalent).
              </p>
              <div className="mt-2 text-[10px] font-mono text-emerald-300 flex justify-between pt-1 border-t border-slate-800">
                <span>Annual Value: $226,000</span>
                <span>FTE Reclaimed: 7.2</span>
              </div>
            </div>

            {/* 6. License Utilization Summary */}
            <div
              onClick={() => setSelectedFinding('license')}
              className={`p-3 rounded-xl border transition-all cursor-pointer ${
                selectedFinding === 'license'
                  ? 'bg-[#0E1A2B] border-sky-500 ring-1 ring-sky-500/40'
                  : 'bg-[#0E131F] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-sky-400" />
                  License Utilization
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-sky-950 text-sky-300 border-sky-800 font-bold">
                  Moderate
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                500 total M365 Copilot seats. 85 unused seats flagged for immediate reallocation or cost recovery.
              </p>
              <div className="mt-2 text-[10px] font-mono text-sky-300 flex justify-between pt-1 border-t border-slate-800">
                <span>Active Seats: 375</span>
                <span>Unused Waste: 85</span>
              </div>
            </div>

          </div>
        </aside>

        {/* ================================================================== */}
        {/* CENTER PANEL — EXECUTIVE STORY                                     */}
        {/* ================================================================== */}
        <main className="flex-1 overflow-y-auto bg-[#05070C] p-6 flex flex-col relative scrollbar-thin space-y-6">

          {/* Executive Narrative Header */}
          <div className="bg-gradient-to-r from-slate-900/90 via-[#0A1628] to-slate-900/90 border border-sky-500/30 rounded-2xl p-5 shadow-2xl relative overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
              <span className="text-xs font-extrabold uppercase tracking-widest text-sky-400 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-sky-400 animate-spin-slow" />
                <span>Executive Summary & Strategic Deployment Narrative</span>
              </span>
              <span className="text-[9.5px] font-mono px-2.5 py-0.5 rounded-full border bg-sky-950 text-sky-300 border-sky-700 font-bold">
                C-SUITE DIRECTIVE
              </span>
            </div>

            {/* 6-8 Sentence Executive Narrative */}
            <div className="space-y-3 text-xs leading-relaxed text-slate-200 font-normal">
              <p>
                <strong className="text-white">Assessment Discovery:</strong> This enterprise tenant assessment evaluated 500 Microsoft 365 Copilot licenses across engineering, legal, HR, and operations cohorts, establishing a foundational baseline of user telemetry and data posture.
              </p>
              <p>
                <strong className="text-white">Copilot Opportunities Unlocked:</strong> We identified 14 high-value use cases—led by document drafting, research synthesis, and Teams meeting summaries—capable of reclaiming 1,240 hours per month, equivalent to 7.2 full-time FTEs.
              </p>
              <p>
                <strong className="text-amber-300">Governance Blockers:</strong> However, critical governance blockers currently restrict enterprise-wide rollout, specifically unconfigured Microsoft Purview sensitivity labels across 35% of SharePoint Online repositories.
              </p>
              <p>
                <strong className="text-rose-300">Security Blast Radius:</strong> Furthermore, missing Entra ID Conditional Access policies (CA01) and overshared permissions elevate the blast radius for AI-prompted data exposure across non-compliant endpoints.
              </p>
              <p>
                <strong className="text-emerald-300">ROI Potential:</strong> Remediating these governance gaps unlocks an additional 30% productivity gain and eliminates $42,000 in unused license waste, driving total annual financial value to $226,000.
              </p>
              <p>
                <strong className="text-sky-300">Recommended Deployment Path:</strong> We recommend a phased Wave 1 deployment targeting 250 high-ROI personas while executing the Microsoft Purview auto-labeling baseline.
              </p>
              <p>
                <strong className="text-indigo-300">Recommended Remediation Path:</strong> In parallel, enforce Microsoft Defender for Cloud Apps and Zero Trust device compliance controls before expanding Copilot access to high-risk cohorts.
              </p>
            </div>
          </div>

          {/* Strategic Deployment Roadmap Grid */}
          <div className="space-y-3">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>Recommended Phased Architecture & Remediation Roadmap</span>
            </span>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              {/* Phase 1 */}
              <div className="bg-[#090D16] border border-amber-500/40 rounded-2xl p-4 shadow-xl space-y-3 relative overflow-hidden">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <span className="text-xs font-bold text-amber-300 font-mono">PHASE 1: REMEDIATION</span>
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                    Weeks 1–4
                  </span>
                </div>
                <ul className="space-y-2 text-[11px] text-slate-300 font-mono">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>Enforce Entra ID CA01 Conditional Access</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>Deploy Purview Sensitivity Auto-labeling</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>Reclaim 85 unused Copilot licenses</span>
                  </li>
                </ul>
              </div>

              {/* Phase 2 */}
              <div className="bg-[#090D16] border border-sky-500/40 rounded-2xl p-4 shadow-xl space-y-3 relative overflow-hidden">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <span className="text-xs font-bold text-sky-300 font-mono">PHASE 2: WAVE 1 ROLLOUT</span>
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800">
                    Weeks 5–8
                  </span>
                </div>
                <ul className="space-y-2 text-[11px] text-slate-300 font-mono">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
                    <span>Deploy to Engineering & HR (250 seats)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
                    <span>Enable Viva Insights telemetry tracking</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
                    <span>Activate Copilot Studio custom agents</span>
                  </li>
                </ul>
              </div>

              {/* Phase 3 */}
              <div className="bg-[#090D16] border border-emerald-500/40 rounded-2xl p-4 shadow-xl space-y-3 relative overflow-hidden">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <span className="text-xs font-bold text-emerald-300 font-mono">PHASE 3: ENTERPRISE SCALE</span>
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                    Weeks 9–12
                  </span>
                </div>
                <ul className="space-y-2 text-[11px] text-slate-300 font-mono">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Scale to remaining 250 enterprise seats</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Full Graph connector indexing integration</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Capture $226,000 annual ROI target</span>
                  </li>
                </ul>
              </div>

            </div>
          </div>

          {/* Key Risks & Remediation Table */}
          <div className="bg-[#090D16] border border-white/10 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                Critical Assessment Risks & Mandatory Controls
              </span>
              <span className="text-[10px] font-mono text-slate-400">Microsoft Zero Trust Standard</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="pb-2">Risk Domain</th>
                    <th className="pb-2">Discovered Finding</th>
                    <th className="pb-2">Severity</th>
                    <th className="pb-2">Recommended Remediation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-200">
                  <tr>
                    <td className="py-2.5 font-bold text-sky-400">Identity & Device</td>
                    <td>CA01 Policy Unenforced</td>
                    <td><span className="px-1.5 py-0.5 bg-rose-950 text-rose-300 rounded border border-rose-800 text-[9px]">CRITICAL</span></td>
                    <td>Enable Entra ID CA01 Conditional Access for device health</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-bold text-amber-400">Information Protection</td>
                    <td>Sensitivity Auto-labeling Off</td>
                    <td><span className="px-1.5 py-0.5 bg-amber-950 text-amber-300 rounded border border-amber-800 text-[9px]">HIGH</span></td>
                    <td>Deploy Purview Sensitivity Labels across 35% unlabeled sites</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-bold text-indigo-400">Privileged Access</td>
                    <td>Static Global Admin Roles</td>
                    <td><span className="px-1.5 py-0.5 bg-amber-950 text-amber-300 rounded border border-amber-800 text-[9px]">HIGH</span></td>
                    <td>Enforce Privileged Identity Management (PIM) just-in-time access</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-bold text-emerald-400">License Optimization</td>
                    <td>85 Unused Copilot Seats</td>
                    <td><span className="px-1.5 py-0.5 bg-sky-950 text-sky-300 rounded border border-sky-800 text-[9px]">MODERATE</span></td>
                    <td>Reallocate or recover $42k/yr license waste</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

        </main>

        {/* ================================================================== */}
        {/* RIGHT PANEL — READINESS SCORE + NEXT STEPS                         */}
        {/* ================================================================== */}
        <aside className="w-84 bg-[#0A0E17]/95 border-l border-white/10 p-4 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-4 z-20">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <Award className="w-4 h-4 text-emerald-400" />
              <span>Readiness Score & Next Steps</span>
            </span>
            <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-2 py-0.5 rounded">
              Verified
            </span>
          </div>

          <div className="space-y-4">

            {/* Score Ring / Gauge Display */}
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-white/10 flex flex-col items-center justify-center text-center space-y-2 relative overflow-hidden">
              <span className="text-[10px] font-mono uppercase text-slate-400 tracking-wider font-bold">
                Overall Copilot Readiness Score
              </span>
              
              <div className="relative w-28 h-28 flex items-center justify-center my-1">
                {/* SVG Radial Gauge */}
                <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 36 36">
                  <path
                    className="text-slate-800"
                    strokeWidth="3.5"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  <path
                    className="text-amber-400"
                    strokeDasharray={`${compositeReadinessScore}, 100`}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-mono font-black text-white">{compositeReadinessScore}</span>
                  <span className="text-[9px] font-mono text-slate-400">/ 100</span>
                </div>
              </div>

              <span className={`text-[10px] font-mono font-bold px-3 py-1 rounded-full border ${readinessBadge.color}`}>
                {readinessBadge.label}
              </span>
            </div>

            {/* Individual Score Breakdown */}
            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-white/10 space-y-2.5">
              <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block">
                Category Score Breakdown
              </span>

              {/* Governance Score */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-amber-300">Governance Score</span>
                  <span className="text-amber-400 font-bold">{govScore} / 100</span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full" style={{ width: `${govScore}%` }} />
                </div>
              </div>

              {/* Security Score */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-sky-300">Security Score</span>
                  <span className="text-sky-400 font-bold">{secScore} / 100</span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-sky-500 rounded-full" style={{ width: `${secScore}%` }} />
                </div>
              </div>

              {/* ROI Score */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-emerald-300">ROI Potential Score</span>
                  <span className="text-emerald-400 font-bold">{roiScore} / 100</span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${roiScore}%` }} />
                </div>
              </div>
            </div>

            {/* Deployment Recommendation */}
            <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-amber-300 font-bold block flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                Deployment Recommendation
              </span>
              <p className="text-xs font-mono font-extrabold text-amber-200">
                NEEDS REMEDIATION FIXES
              </p>
              <p className="text-[10px] text-slate-300 leading-relaxed">
                Approved for Wave 1 conditional rollout upon execution of Entra ID CA01 & Purview labeling remediations.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-2">
              <button
                onClick={onContinue}
                className="w-full py-3 px-4 bg-gradient-to-r from-emerald-500 via-teal-600 to-indigo-600 hover:from-emerald-400 hover:to-indigo-500 text-slate-950 font-black rounded-xl text-xs flex items-center justify-center space-x-2 transition-all shadow-xl shadow-emerald-950/60 cursor-pointer border border-white/20 uppercase tracking-wider"
              >
                <span>Proceed to SOW</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                onClick={onContinue}
                className="w-full py-2 px-4 bg-slate-900 hover:bg-slate-800 text-slate-300 font-mono rounded-xl text-[11px] flex items-center justify-center space-x-2 border border-slate-800 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-sky-400" />
                <span>Download Executive Brief (PDF)</span>
              </button>
            </div>

          </div>
        </aside>

      </div>
    </div>
  );
};
