import React, { useState } from 'react';
import { GovernanceState } from '../types';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Sliders, 
  Sparkles, 
  ArrowRight, 
  CheckCircle2, 
  AlertTriangle, 
  Lock, 
  Users, 
  Globe, 
  Key, 
  FileText, 
  RefreshCw, 
  HelpCircle, 
  X,
  ChevronRight,
  TrendingUp,
  Activity,
  Layers,
  Check,
  Zap,
  Info
} from 'lucide-react';

interface GovernanceScreenProps {
  governance?: GovernanceState;
  onUpdateGovernance?: (updated: Partial<GovernanceState>) => void;
  onContinue: () => void;
  onHelpClick?: () => void;
  onExitClick?: () => void;
  onNavigate?: (step: string) => void;
}

export const GovernanceScreen: React.FC<GovernanceScreenProps> = ({
  governance,
  onUpdateGovernance,
  onContinue,
  onHelpClick,
  onExitClick,
  onNavigate
}) => {
  // Simulation Controls State
  const [fixUnlabeled, setFixUnlabeled] = useState<boolean>(governance?.sensitivityLabels || false);
  const [resolveDlp, setResolveDlp] = useState<boolean>(governance?.dlp !== 'off');
  const [tightenCA01, setTightenCA01] = useState<boolean>(governance?.ca01 || false);
  const [enforceMfa, setEnforceMfa] = useState<boolean>(true);
  const [requireDevice, setRequireDevice] = useState<boolean>(false);
  const [externalGuests, setExternalGuests] = useState<number>(1240); // slider: 100 to 1500
  const [federatedDomains, setFederatedDomains] = useState<number>(88); // slider: 5 to 100
  const [removeAdmins, setRemoveAdmins] = useState<boolean>(governance?.pim || false);
  const [permissionSprawl, setPermissionSprawl] = useState<number>(15); // slider: 1 to 20

  // Clicked Scorecard Section Highlight
  const [highlightedControl, setHighlightedControl] = useState<string | null>('labels');

  // Compute Readiness & Blast Radius Metrics
  // Base readiness = 42
  let readinessScore = 42;
  if (fixUnlabeled) readinessScore += 14;
  if (resolveDlp) readinessScore += 12;
  if (tightenCA01) readinessScore += 10;
  if (enforceMfa) readinessScore += 6;
  if (requireDevice) readinessScore += 6;
  if (removeAdmins) readinessScore += 10;
  
  // Guest impact
  const guestReduction = Math.max(0, 1240 - externalGuests);
  readinessScore += Math.round((guestReduction / 1140) * 8);

  // Domain impact
  const domainReduction = Math.max(0, 88 - federatedDomains);
  readinessScore += Math.round((domainReduction / 83) * 4);

  // Sprawl impact
  const sprawlReduction = Math.max(0, 15 - permissionSprawl);
  readinessScore += Math.round((sprawlReduction / 14) * 8);

  readinessScore = Math.min(100, Math.max(10, readinessScore));

  // Blast Radius % (Inverse of readiness, modified by specific high-risk gaps)
  const rawBlastRadius = Math.max(12, 100 - readinessScore);
  const blastRadiusReductionPct = Math.round(((85 - rawBlastRadius) / 85) * 100);

  // Ring Severity Color Logic
  // Green -> Blue -> Yellow -> Amber -> Red
  const getSeverityTheme = (radius: number) => {
    if (radius <= 25) {
      return {
        label: 'Low / Governed',
        badgeBg: 'bg-emerald-950/80 text-emerald-300 border-emerald-700',
        ringStroke: '#10B981',
        glowColor: 'rgba(16, 185, 129, 0.35)',
        textColor: 'text-emerald-400',
        storyBadge: 'HIGH COPILOT READINESS'
      };
    } else if (radius <= 45) {
      return {
        label: 'Moderate Risk',
        badgeBg: 'bg-sky-950/80 text-sky-300 border-sky-700',
        ringStroke: '#0078D4',
        glowColor: 'rgba(0, 120, 212, 0.35)',
        textColor: 'text-sky-400',
        storyBadge: 'BALANCED GUARDRAILS'
      };
    } else if (radius <= 65) {
      return {
        label: 'Elevated Risk',
        badgeBg: 'bg-yellow-950/80 text-yellow-300 border-yellow-700',
        ringStroke: '#EAB308',
        glowColor: 'rgba(234, 179, 8, 0.35)',
        textColor: 'text-yellow-400',
        storyBadge: 'ELEVATED BLAST RADIUS'
      };
    } else if (radius <= 80) {
      return {
        label: 'High Risk',
        badgeBg: 'bg-amber-950/80 text-amber-300 border-amber-700',
        ringStroke: '#F59E0B',
        glowColor: 'rgba(245, 158, 11, 0.35)',
        textColor: 'text-amber-400',
        storyBadge: 'HIGH DEPLOYMENT BLOCKER'
      };
    } else {
      return {
        label: 'Critical Blast Radius',
        badgeBg: 'bg-rose-950/80 text-rose-300 border-rose-700',
        ringStroke: '#EF4444',
        glowColor: 'rgba(239, 68, 68, 0.45)',
        textColor: 'text-rose-400',
        storyBadge: 'CRITICAL SECURITY BLOCKER'
      };
    }
  };

  const theme = getSeverityTheme(rawBlastRadius);

  // Dynamic Story Narrative
  const generateStoryText = () => {
    if (readinessScore >= 85) {
      return {
        summary: `Current governance posture is fully optimized for safe enterprise Copilot deployment. Sensitivity labels cover 92%+ of files, DLP conflicts are resolved, and Conditional Access CA01 enforces Zero Trust identity verification.`,
        blocker: `Key blockers have been mitigated across external guest access, permanent admin roles, and permission sprawl clusters.`,
        amplification: `Purview auto-labeling prevents Copilot from over-indexing or summarizing sensitive CUI/PHI in unmonitored channels.`,
        wouldHappen: `Enabling Copilot today triggers zero unmonitored egress and ensures complete Graph connector safety across all tenant workloads.`,
        impactLine: `Copilot Readiness stands at ${readinessScore}/100 with a ${Math.max(0, blastRadiusReductionPct)}% reduction in blast radius.`
      };
    } else if (readinessScore >= 65) {
      return {
        summary: `Governance posture shows steady progress toward Copilot deployment readiness, with partial guardrails active across core tenant repositories.`,
        blocker: `Remaining blockers include unmonitored external guests (${externalGuests}) and residual permission sprawl in legacy SharePoint teams.`,
        amplification: `Unlabeled files and loose DLP rules allow Copilot to synthesize confidential specs into shared Loop workspaces.`,
        wouldHappen: `Enabling Copilot today would deliver high productivity, but requires step-up MFA and CA01 enforcement on high-risk admin endpoints.`,
        impactLine: `Copilot Readiness improved to ${readinessScore}/100 — complete remaining toggles to lock down tenant blast radius.`
      };
    } else {
      return {
        summary: `Current governance posture reflects severe overexposure and significant deployment blockers across tenant data repositories.`,
        blocker: `Key blockers include 62% unlabeled files, 18 active DLP conflicts, 12 permanent global admins, and 1,240 unmonitored external guests.`,
        amplification: `Governance gaps significantly amplify Copilot's blast radius by exposing unindexed PHI, CUI, and API secrets to natural language prompts.`,
        wouldHappen: `If Copilot were enabled today without safeguards, overshared public links and broad permissions would allow users to summarize executive salary logs and legal redlines.`,
        impactLine: `Copilot Readiness is blocked at ${readinessScore}/100 with a critical blast radius of ${rawBlastRadius}%.`
      };
    }
  };

  const story = generateStoryText();

  // Presets
  const handleApplyPreset = (preset: 'baseline' | 'balanced' | 'strict') => {
    if (preset === 'baseline') {
      setFixUnlabeled(false);
      setResolveDlp(false);
      setTightenCA01(false);
      setEnforceMfa(false);
      setRequireDevice(false);
      setExternalGuests(1240);
      setFederatedDomains(88);
      setRemoveAdmins(false);
      setPermissionSprawl(15);
    } else if (preset === 'balanced') {
      setFixUnlabeled(true);
      setResolveDlp(true);
      setTightenCA01(true);
      setEnforceMfa(true);
      setRequireDevice(false);
      setExternalGuests(450);
      setFederatedDomains(25);
      setRemoveAdmins(true);
      setPermissionSprawl(6);
    } else {
      setFixUnlabeled(true);
      setResolveDlp(true);
      setTightenCA01(true);
      setEnforceMfa(true);
      setRequireDevice(true);
      setExternalGuests(150);
      setFederatedDomains(10);
      setRemoveAdmins(true);
      setPermissionSprawl(2);
    }
    if (onUpdateGovernance) {
      onUpdateGovernance({
        ca01: preset !== 'baseline',
        pim: preset !== 'baseline',
        sensitivityLabels: preset !== 'baseline',
        dlp: preset === 'strict' ? 'strict' : preset === 'balanced' ? 'moderate' : 'off'
      });
    }
  };

  return (
    <div className="h-screen w-screen bg-[#07090E] text-slate-100 flex flex-col font-sans overflow-hidden antialiased select-none relative">
      
      {/* ==================================================================== */}
      {/* TOP NAVBAR / CONTROL TOOLBAR                                         */}
      {/* ==================================================================== */}
      <header className="h-14 bg-[#0B0F19]/95 border-b border-white/10 px-5 flex items-center justify-between shrink-0 z-30 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-sky-950 border border-sky-500/50 flex items-center justify-center text-sky-400 shadow-[0_0_15px_rgba(0,120,212,0.3)]">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-black uppercase tracking-wider text-white">
                Microsoft Copilot Safety Sandbox
              </span>
              <span className="text-[10px] font-mono bg-sky-500/20 text-sky-300 border border-sky-500/40 px-2 py-0.5 rounded font-extrabold">
                PURVIEW & DEFENDER SIMULATOR
              </span>
            </div>
            <p className="text-[10px] text-slate-400">
              Interactive Governance Controls • Real-time Copilot Blast Radius Engine
            </p>
          </div>
        </div>

        {/* Center Readiness Badge */}
        <div className="hidden lg:flex items-center space-x-3 bg-black/60 px-4 py-1.5 rounded-xl border border-white/10">
          <span className="text-[10px] font-mono uppercase text-slate-400 font-bold">
            Simulated Readiness:
          </span>
          <div className="flex items-center space-x-2">
            <span className={`text-sm font-mono font-black ${
              readinessScore >= 80 ? 'text-emerald-400' : readinessScore >= 60 ? 'text-sky-400' : 'text-amber-400'
            }`}>
              {readinessScore} / 100
            </span>
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border ${theme.badgeBg}`}>
              {theme.label}
            </span>
          </div>
        </div>

        {/* Right Actions & Presets */}
        <div className="flex items-center space-x-3">
          <div className="hidden sm:flex items-center bg-black/60 p-1 rounded-xl border border-white/10 space-x-1">
            <button
              onClick={() => handleApplyPreset('baseline')}
              className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Reset to initial un-governed posture"
            >
              Baseline
            </button>
            <button
              onClick={() => handleApplyPreset('balanced')}
              className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold text-sky-300 bg-sky-950/60 border border-sky-800/80 hover:bg-sky-900 transition-colors"
            >
              Balanced
            </button>
            <button
              onClick={() => handleApplyPreset('strict')}
              className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-800/80 hover:bg-emerald-900 transition-colors"
            >
              Zero Trust
            </button>
          </div>

          <button
            onClick={onContinue}
            className="flex items-center space-x-2 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-slate-950 font-extrabold px-4 py-1.5 rounded-lg text-xs transition-all shadow-lg shadow-sky-950/50 cursor-pointer border border-white/20"
          >
            <span>Proceed to ROI Modeling</span>
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
        {/* LEFT PANEL — GOVERNANCE SCORECARD (STATIC + CLICKABLE)             */}
        {/* ================================================================== */}
        <aside className="w-80 bg-[#0A0E17]/95 border-r border-white/10 p-3.5 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-3 z-20">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-sky-400" />
              <span>Governance Scorecard</span>
            </span>
            <span className="text-[9px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
              Defender / Purview
            </span>
          </div>

          <div className="space-y-2.5">
            
            {/* Section 1: Sensitivity Label Coverage */}
            <div
              onClick={() => setHighlightedControl('labels')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedControl === 'labels'
                  ? 'bg-[#0F223D] border-sky-500 ring-1 ring-sky-500/40 shadow-[0_0_15px_rgba(0,120,212,0.2)]'
                  : 'bg-[#0E131F] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-amber-400" />
                  1. Sensitivity Label Coverage
                </span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                  fixUnlabeled ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-amber-950 text-amber-300 border-amber-800'
                }`}>
                  {fixUnlabeled ? 'Governed' : '62% Unlabeled'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-slate-300 pt-1">
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Labeled Files:</span>
                  <span className={fixUnlabeled ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                    {fixUnlabeled ? '94%' : '38%'}
                  </span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Unlabeled Files:</span>
                  <span className={fixUnlabeled ? 'text-emerald-400 font-bold' : 'text-rose-400'}>
                    {fixUnlabeled ? '6%' : '62%'}
                  </span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Drifted Repos:</span>
                  <span className="text-slate-200">{fixUnlabeled ? '2 repos' : '24 repos'}</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Accuracy:</span>
                  <span className="text-sky-300">{fixUnlabeled ? '98.4%' : '72.0%'}</span>
                </div>
              </div>
            </div>

            {/* Section 2: DLP Enforcement */}
            <div
              onClick={() => setHighlightedControl('dlp')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedControl === 'dlp'
                  ? 'bg-[#0F223D] border-sky-500 ring-1 ring-sky-500/40 shadow-[0_0_15px_rgba(0,120,212,0.2)]'
                  : 'bg-[#0E131F] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-rose-400" />
                  2. DLP Enforcement
                </span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                  resolveDlp ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-rose-950 text-rose-300 border-rose-800'
                }`}>
                  {resolveDlp ? 'Strict DLP' : '18 Conflicts'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-slate-300 pt-1">
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Active Conflicts:</span>
                  <span className={resolveDlp ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                    {resolveDlp ? '0 conflicts' : '18 conflicts'}
                  </span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Flows Blocked:</span>
                  <span className="text-emerald-400">{resolveDlp ? '42 flows' : '12 flows'}</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80 col-span-2">
                  <span className="text-slate-500 block">Unprotected Sensitive Flows:</span>
                  <span className={resolveDlp ? 'text-emerald-400' : 'text-rose-400 font-bold'}>
                    {resolveDlp ? '0 unprotected (100% guarded)' : '42 unprotected egress flows'}
                  </span>
                </div>
              </div>
            </div>

            {/* Section 3: Conditional Access (CA01 + Zero Trust) */}
            <div
              onClick={() => setHighlightedControl('ca01')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedControl === 'ca01'
                  ? 'bg-[#0F223D] border-sky-500 ring-1 ring-sky-500/40 shadow-[0_0_15px_rgba(0,120,212,0.2)]'
                  : 'bg-[#0E131F] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                  3. Conditional Access (CA01)
                </span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                  tightenCA01 ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-amber-950 text-amber-300 border-amber-800'
                }`}>
                  {tightenCA01 ? 'CA01 Strict' : 'CA01 Soft'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-slate-300 pt-1">
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">CA01 Status:</span>
                  <span className={tightenCA01 ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                    {tightenCA01 ? 'Strict Enforced' : 'Exemptions Active'}
                  </span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">MFA Rate:</span>
                  <span className={enforceMfa ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                    {enforceMfa ? '100% All Users' : '94% Enforcement'}
                  </span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80 col-span-2">
                  <span className="text-slate-500 block">Device Compliance Rate:</span>
                  <span className={requireDevice ? 'text-emerald-400 font-bold' : 'text-slate-300'}>
                    {requireDevice ? '100% Required Compliant' : '78% Compliant (22% unmanaged)'}
                  </span>
                </div>
              </div>
            </div>

            {/* Section 4: External Exposure (EEEU) */}
            <div
              onClick={() => setHighlightedControl('external')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedControl === 'external'
                  ? 'bg-[#0F223D] border-sky-500 ring-1 ring-sky-500/40 shadow-[0_0_15px_rgba(0,120,212,0.2)]'
                  : 'bg-[#0E131F] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-purple-400" />
                  4. External Exposure (EEEU)
                </span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                  externalGuests < 500 ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-rose-950 text-rose-300 border-rose-800'
                }`}>
                  {externalGuests} Guests
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-slate-300 pt-1">
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">External Guests:</span>
                  <span className={externalGuests < 500 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                    {externalGuests} guests
                  </span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Federated Domains:</span>
                  <span className={federatedDomains < 30 ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                    {federatedDomains} domains
                  </span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80 col-span-2">
                  <span className="text-slate-500 block">External Sharing Links:</span>
                  <span className="text-slate-200">
                    {Math.round((externalGuests / 1240) * 4120)} active links
                  </span>
                </div>
              </div>
            </div>

            {/* Section 5: Permissions & Admin Roles */}
            <div
              onClick={() => setHighlightedControl('admins')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedControl === 'admins'
                  ? 'bg-[#0F223D] border-sky-500 ring-1 ring-sky-500/40 shadow-[0_0_15px_rgba(0,120,212,0.2)]'
                  : 'bg-[#0E131F] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-rose-400" />
                  5. Permissions & Admin Roles
                </span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                  removeAdmins ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-rose-950 text-rose-300 border-rose-800'
                }`}>
                  {removeAdmins ? 'PIM Active' : '12 Admins'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-slate-300 pt-1">
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Permanent Admins:</span>
                  <span className={removeAdmins ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                    {removeAdmins ? '0 (JIT PIM)' : '12 permanent'}
                  </span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Privileged Roles:</span>
                  <span className="text-slate-200">34 accounts</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80 col-span-2">
                  <span className="text-slate-500 block">Permission Sprawl Clusters:</span>
                  <span className={permissionSprawl <= 5 ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                    {permissionSprawl} clusters
                  </span>
                </div>
              </div>
            </div>

          </div>
        </aside>

        {/* ================================================================== */}
        {/* CENTER PANEL — GOVERNANCE STORY + SIMULATION ENGINE                */}
        {/* ================================================================== */}
        <main className="flex-1 overflow-y-auto bg-[#05070C] p-5 flex flex-col relative scrollbar-thin space-y-6">

          {/* -------------------------------------------------------------- */}
          {/* LAYER 1: SHORT GOVERNANCE STORY (TOP OF CENTER PANEL)           */}
          {/* -------------------------------------------------------------- */}
          <section className="bg-gradient-to-r from-slate-900/90 via-[#0B1528] to-slate-900/90 border border-sky-500/30 rounded-2xl p-4 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 mb-3">
              <span className="text-xs font-extrabold uppercase tracking-widest text-sky-400 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-sky-400 animate-spin-slow" />
                <span>Executive Governance Story & Readiness Narrative</span>
              </span>
              <span className={`text-[9.5px] font-mono px-2.5 py-0.5 rounded-full border font-bold ${theme.badgeBg}`}>
                {theme.storyBadge}
              </span>
            </div>

            <div className="space-y-2 text-xs leading-relaxed text-slate-200 font-normal">
              <p><strong className="text-white">Current Posture:</strong> {story.summary}</p>
              <p><strong className="text-white">Deployment Blockers:</strong> {story.blocker}</p>
              <p><strong className="text-white">Blast Radius Mechanics:</strong> {story.amplification}</p>
              <p><strong className="text-white">Copilot Readiness Impact:</strong> {story.wouldHappen}</p>
              <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between text-xs font-bold text-sky-300 font-mono">
                <span>🎯 Key Impact Line: {story.impactLine}</span>
                <span className="text-[10px] text-slate-400">Microsoft Defender & Purview Verified</span>
              </div>
            </div>
          </section>

          {/* -------------------------------------------------------------- */}
          {/* LAYER 2: GOVERNANCE SIMULATION ENGINE (MIDDLE OF CENTER PANEL)  */}
          {/* -------------------------------------------------------------- */}
          <section className="bg-[#090D16] border border-white/10 rounded-2xl p-5 shadow-2xl relative space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-sky-400" />
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-white">
                  Governance Simulation Engine (Copilot Safety Controls)
                </h2>
              </div>
              <button
                onClick={() => handleApplyPreset('baseline')}
                className="flex items-center space-x-1 text-[10px] font-mono text-slate-400 hover:text-white bg-slate-900 border border-slate-800 px-2.5 py-1 rounded transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Reset Simulation</span>
              </button>
            </div>

            {/* Controls Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Control 1: Fix Unlabeled Files */}
              <div className={`p-3.5 rounded-xl border transition-all ${
                highlightedControl === 'labels' ? 'bg-sky-950/40 border-sky-500' : 'bg-slate-900/80 border-slate-800'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-white block">Fix Unlabeled Files</span>
                    <span className="text-[10px] text-slate-400">Enforce Purview auto-labeling on 62% unlabeled files</span>
                  </div>
                  <button
                    onClick={() => {
                      setFixUnlabeled(!fixUnlabeled);
                      if (onUpdateGovernance) onUpdateGovernance({ sensitivityLabels: !fixUnlabeled });
                    }}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 flex items-center ${
                      fixUnlabeled ? 'bg-sky-500 justify-end' : 'bg-slate-800 justify-start'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>
              </div>

              {/* Control 2: Resolve DLP Conflicts */}
              <div className={`p-3.5 rounded-xl border transition-all ${
                highlightedControl === 'dlp' ? 'bg-sky-950/40 border-sky-500' : 'bg-slate-900/80 border-slate-800'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-white block">Resolve DLP Conflicts</span>
                    <span className="text-[10px] text-slate-400">Clear 18 active DLP overrides & protect sensitive flows</span>
                  </div>
                  <button
                    onClick={() => {
                      setResolveDlp(!resolveDlp);
                      if (onUpdateGovernance) onUpdateGovernance({ dlp: !resolveDlp ? 'moderate' : 'off' });
                    }}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 flex items-center ${
                      resolveDlp ? 'bg-sky-500 justify-end' : 'bg-slate-800 justify-start'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>
              </div>

              {/* Control 3: Tighten CA01 */}
              <div className={`p-3.5 rounded-xl border transition-all ${
                highlightedControl === 'ca01' ? 'bg-sky-950/40 border-sky-500' : 'bg-slate-900/80 border-slate-800'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-white block">Tighten CA01 Policy</span>
                    <span className="text-[10px] text-slate-400">Remove legacy exemptions & enforce strict Zero Trust</span>
                  </div>
                  <button
                    onClick={() => {
                      setTightenCA01(!tightenCA01);
                      if (onUpdateGovernance) onUpdateGovernance({ ca01: !tightenCA01 });
                    }}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 flex items-center ${
                      tightenCA01 ? 'bg-sky-500 justify-end' : 'bg-slate-800 justify-start'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>
              </div>

              {/* Control 4: Enforce MFA for All Users */}
              <div className="p-3.5 rounded-xl border bg-slate-900/80 border-slate-800">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-white block">Enforce MFA for All Users</span>
                    <span className="text-[10px] text-slate-400">Mandate step-up MFA across 100% of tenant accounts</span>
                  </div>
                  <button
                    onClick={() => setEnforceMfa(!enforceMfa)}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 flex items-center ${
                      enforceMfa ? 'bg-sky-500 justify-end' : 'bg-slate-800 justify-start'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>
              </div>

              {/* Control 5: Require Device Compliance */}
              <div className="p-3.5 rounded-xl border bg-slate-900/80 border-slate-800">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-white block">Require Device Compliance</span>
                    <span className="text-[10px] text-slate-400">Block unmanaged or non-compliant Intune endpoints</span>
                  </div>
                  <button
                    onClick={() => setRequireDevice(!requireDevice)}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 flex items-center ${
                      requireDevice ? 'bg-sky-500 justify-end' : 'bg-slate-800 justify-start'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>
              </div>

              {/* Control 8: Remove Permanent Admins */}
              <div className={`p-3.5 rounded-xl border transition-all ${
                highlightedControl === 'admins' ? 'bg-sky-950/40 border-sky-500' : 'bg-slate-900/80 border-slate-800'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-white block">Remove Permanent Admins</span>
                    <span className="text-[10px] text-slate-400">Migrate 12 global admin accounts to Entra PIM JIT</span>
                  </div>
                  <button
                    onClick={() => {
                      setRemoveAdmins(!removeAdmins);
                      if (onUpdateGovernance) onUpdateGovernance({ pim: !removeAdmins });
                    }}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 flex items-center ${
                      removeAdmins ? 'bg-sky-500 justify-end' : 'bg-slate-800 justify-start'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>
              </div>

              {/* Control 6: Reduce External Guests (SLIDER) */}
              <div className={`p-3.5 rounded-xl border transition-all md:col-span-2 ${
                highlightedControl === 'external' ? 'bg-sky-950/40 border-sky-500' : 'bg-slate-900/80 border-slate-800'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-xs font-bold text-white block">Reduce External Guests</span>
                    <span className="text-[10px] text-slate-400">Prune unmonitored guest access across tenant SharePoint & Teams</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-sky-400">{externalGuests} guests</span>
                </div>
                <input
                  type="range"
                  min="100"
                  max="1500"
                  step="50"
                  value={externalGuests}
                  onChange={(e) => setExternalGuests(Number(e.target.value))}
                  className="w-full accent-sky-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                />
              </div>

              {/* Control 7: Reduce Federated Domains (SLIDER) */}
              <div className="p-3.5 rounded-xl border bg-slate-900/80 border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-xs font-bold text-white block">Reduce Federated Domains</span>
                    <span className="text-[10px] text-slate-400">Restrict tenant federation to trusted B2B orgs</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-purple-400">{federatedDomains} domains</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="5"
                  value={federatedDomains}
                  onChange={(e) => setFederatedDomains(Number(e.target.value))}
                  className="w-full accent-purple-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                />
              </div>

              {/* Control 9: Reduce Permission Sprawl (SLIDER) */}
              <div className="p-3.5 rounded-xl border bg-slate-900/80 border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-xs font-bold text-white block">Reduce Permission Sprawl</span>
                    <span className="text-[10px] text-slate-400">Consolidate overshared SharePoint sites with broad access</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-amber-400">{permissionSprawl} clusters</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  value={permissionSprawl}
                  onChange={(e) => setPermissionSprawl(Number(e.target.value))}
                  className="w-full accent-amber-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                />
              </div>

            </div>
          </section>

          {/* -------------------------------------------------------------- */}
          {/* LAYER 3: SIMULATED BLAST RADIUS RING (BOTTOM OF CENTER PANEL)   */}
          {/* -------------------------------------------------------------- */}
          <section className="bg-[#090D16] border border-white/10 rounded-2xl p-6 shadow-2xl relative flex flex-col items-center justify-center space-y-4">
            <div className="flex items-center justify-between w-full pb-2 border-b border-white/10">
              <span className="text-xs font-extrabold uppercase tracking-widest text-slate-300 flex items-center gap-2">
                <Activity className="w-4 h-4 text-sky-400" />
                <span>Simulated Copilot Blast Radius Surface</span>
              </span>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-bold ${theme.badgeBg}`}>
                Blast Radius: {rawBlastRadius}%
              </span>
            </div>

            {/* Circular Ring Visualization */}
            <div className="relative w-64 h-64 flex items-center justify-center my-2">
              
              {/* Outer Decorative Glow Ring */}
              <div
                className="absolute rounded-full transition-all duration-700 pointer-events-none"
                style={{
                  width: `${Math.max(140, Math.min(240, rawBlastRadius * 2.2))}px`,
                  height: `${Math.max(140, Math.min(240, rawBlastRadius * 2.2))}px`,
                  boxShadow: `0 0 45px ${theme.glowColor}, inset 0 0 25px ${theme.glowColor}`,
                  borderColor: theme.ringStroke,
                  borderWidth: '2px',
                  borderStyle: 'solid'
                }}
              />

              {/* Inner Circle Content */}
              <div className="relative z-10 text-center flex flex-col items-center justify-center p-4">
                <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 font-bold block mb-1">
                  Copilot Blast Radius
                </span>
                <span className={`text-3xl font-mono font-black ${theme.textColor}`}>
                  {rawBlastRadius}%
                </span>
                <span className="text-[10px] font-mono font-bold text-slate-300 mt-1">
                  {readinessScore >= 80 ? '🔒 Contained & Safe' : readinessScore >= 50 ? '⚠️ Moderate Exposure' : '🚨 Severe Overexposure'}
                </span>
                <div className="mt-2 text-[9px] font-mono bg-black/60 px-2.5 py-1 rounded-full border border-white/10 text-slate-400">
                  Reduction Delta: <span className="text-emerald-400 font-bold">-{Math.max(0, blastRadiusReductionPct)}%</span>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 text-center max-w-lg">
              The circular blast radius contracts as you enable Purview auto-labeling, enforce DLP rules, and prune external guests. A smaller ring guarantees Copilot cannot summarize overshared confidential assets.
            </p>
          </section>

        </main>

        {/* ================================================================== */}
        {/* RIGHT PANEL — IMPACT METRICS & SAFEGUARDS (DYNAMIC)                */}
        {/* ================================================================== */}
        <aside className="w-84 bg-[#0A0E17]/95 border-l border-white/10 p-4 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-4 z-20">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span>Impact Metrics & Safeguards</span>
            </span>
            <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-2 py-0.5 rounded">
              Dynamic Realtime
            </span>
          </div>

          <div className="space-y-3">

            {/* 1. Copilot Readiness Delta */}
            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-white/10 space-y-2">
              <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block">
                Copilot Readiness Delta
              </span>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-400 block">Readiness Score:</span>
                  <span className="text-sm font-mono font-black text-white">42 → <span className="text-emerald-400">{readinessScore}</span></span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-400 block">Blast Radius Delta:</span>
                  <span className="text-xs font-mono font-bold text-emerald-400">-{Math.max(0, blastRadiusReductionPct)}% Reduced</span>
                </div>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${readinessScore}%` }} />
              </div>
            </div>

            {/* 2. Sensitivity Label Impact */}
            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-white/10 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-sky-400 font-bold flex items-center justify-between">
                <span>Sensitivity Label Impact</span>
                <span className="text-slate-400">{fixUnlabeled ? 'Active' : 'Pending'}</span>
              </span>
              <p className="text-xs text-slate-200 font-bold">
                {fixUnlabeled ? 'Label coverage increased to 94%' : '38% labeled (62% unprotected)'}
              </p>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                {fixUnlabeled ? 'PHI/CUI files auto-labeled with Purview MIP headers to block unauthorized Copilot summarization.' : 'Unlabeled files remain vulnerable to Copilot Graph over-indexing.'}
              </p>
            </div>

            {/* 3. DLP Impact */}
            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-white/10 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-rose-400 font-bold flex items-center justify-between">
                <span>DLP Safeguard Impact</span>
                <span className="text-slate-400">{resolveDlp ? 'Enforced' : 'Off'}</span>
              </span>
              <p className="text-xs text-slate-200 font-bold">
                {resolveDlp ? '18 active DLP conflicts resolved' : '18 active DLP policy conflicts'}
              </p>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                {resolveDlp ? '42 sensitive egress flows guarded against external export via Copilot Studio connectors.' : 'Unchecked DLP overrides allow Copilot prompts to synthesize sensitive outputs.'}
              </p>
            </div>

            {/* 4. CA01 Impact */}
            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-white/10 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-amber-400 font-bold flex items-center justify-between">
                <span>CA01 & Identity Impact</span>
                <span className="text-slate-400">{tightenCA01 ? 'Strict' : 'Soft'}</span>
              </span>
              <p className="text-xs text-slate-200 font-bold">
                {tightenCA01 ? 'Identity blast radius reduced' : 'CA01 exemptions active'}
              </p>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                {tightenCA01 ? 'Zero Trust posture strengthened with compulsory step-up MFA and strict device validation.' : 'Bypasses in CA01 allow non-compliant endpoints to run Copilot prompts.'}
              </p>
            </div>

            {/* 5. External Exposure Impact */}
            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-white/10 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-purple-400 font-bold flex items-center justify-between">
                <span>External Exposure Impact</span>
                <span className="text-slate-400">{externalGuests < 500 ? 'Low' : 'High'}</span>
              </span>
              <p className="text-xs text-slate-200 font-bold">
                Guest access reduced (1,240 → {externalGuests})
              </p>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Federated domain risk lowered ({federatedDomains} active domains). Minimizes risk of external guest accounts prompting Copilot for internal tenant data.
              </p>
            </div>

            {/* 6. Permissions Impact */}
            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-white/10 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-emerald-400 font-bold flex items-center justify-between">
                <span>Permissions & Privilege Impact</span>
                <span className="text-slate-400">{removeAdmins ? 'PIM Active' : 'Sprawl'}</span>
              </span>
              <p className="text-xs text-slate-200 font-bold">
                {removeAdmins ? '12 permanent admins removed (PIM JIT)' : '12 permanent global admins active'}
              </p>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Privilege sprawl reduced to {permissionSprawl} clusters. Prevents credential harvesting and administrative privilege escalation via Copilot Graph indexing.
              </p>
            </div>

          </div>
        </aside>

      </div>
    </div>
  );
};
