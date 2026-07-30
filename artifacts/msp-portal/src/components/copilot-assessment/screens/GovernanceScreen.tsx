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
        badgeBg: 'bg-status-green/15 text-status-green border-status-green',
        ringStroke: 'hsl(var(--status-green))',
        glowColor: 'rgba(16, 185, 129, 0.35)',
        textColor: 'text-status-green',
        storyBadge: 'HIGH COPILOT READINESS'
      };
    } else if (radius <= 45) {
      return {
        label: 'Moderate Risk',
        badgeBg: 'bg-primary/15 text-primary border-primary',
        ringStroke: 'hsl(var(--primary))',
        glowColor: 'rgba(0, 120, 212, 0.35)',
        textColor: 'text-primary',
        storyBadge: 'BALANCED GUARDRAILS'
      };
    } else if (radius <= 65) {
      return {
        label: 'Elevated Risk',
        badgeBg: 'bg-status-amber/80 text-status-amber border-status-amber',
        ringStroke: 'hsl(var(--status-amber))',
        glowColor: 'rgba(234, 179, 8, 0.35)',
        textColor: 'text-status-amber',
        storyBadge: 'ELEVATED BLAST RADIUS'
      };
    } else if (radius <= 80) {
      return {
        label: 'High Risk',
        badgeBg: 'bg-status-amber/15 text-status-amber border-status-amber',
        ringStroke: 'hsl(var(--status-amber))',
        glowColor: 'rgba(245, 158, 11, 0.35)',
        textColor: 'text-status-amber',
        storyBadge: 'HIGH DEPLOYMENT BLOCKER'
      };
    } else {
      return {
        label: 'Critical Blast Radius',
        badgeBg: 'bg-destructive/15 text-destructive border-destructive',
        ringStroke: 'hsl(var(--destructive))',
        glowColor: 'rgba(239, 68, 68, 0.45)',
        textColor: 'text-destructive',
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
    <div className="h-screen w-screen bg-background text-foreground flex flex-col font-sans overflow-hidden antialiased select-none relative">
      
      {/* ==================================================================== */}
      {/* TOP NAVBAR / CONTROL TOOLBAR                                         */}
      {/* ==================================================================== */}
      <header className="h-14 bg-background/95 border-b border-border px-5 flex items-center justify-between shrink-0 z-30 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-primary border border-primary/50 flex items-center justify-center text-primary shadow-[0_0_15px_rgba(0,120,212,0.3)]">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-black uppercase tracking-wider text-foreground">
                Microsoft Copilot Safety Sandbox
              </span>
              <span className="text-[10px] font-mono bg-primary/20 text-primary border border-primary/40 px-2 py-0.5 rounded font-extrabold">
                PURVIEW & DEFENDER SIMULATOR
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Interactive Governance Controls • Real-time Copilot Blast Radius Engine
            </p>
          </div>
        </div>

        {/* Center Readiness Badge */}
        <div className="hidden lg:flex items-center space-x-3 bg-muted/60 px-4 py-1.5 rounded-xl border border-border">
          <span className="text-[10px] font-mono uppercase text-muted-foreground font-bold">
            Simulated Readiness:
          </span>
          <div className="flex items-center space-x-2">
            <span className={`text-sm font-mono font-black ${
              readinessScore >= 80 ? 'text-status-green' : readinessScore >= 60 ? 'text-primary' : 'text-status-amber'
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
          <div className="hidden sm:flex items-center bg-muted/60 p-1 rounded-xl border border-border space-x-1">
            <button
              onClick={() => handleApplyPreset('baseline')}
              className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Reset to initial un-governed posture"
            >
              Baseline
            </button>
            <button
              onClick={() => handleApplyPreset('balanced')}
              className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold text-primary bg-primary/10 border border-primary/30 hover:bg-primary transition-colors"
            >
              Balanced
            </button>
            <button
              onClick={() => handleApplyPreset('strict')}
              className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold text-status-green bg-status-green/10 border border-status-green/30/80 hover:bg-status-green transition-colors"
            >
              Zero Trust
            </button>
          </div>

          <button
            onClick={onContinue}
            className="flex items-center space-x-2 bg-gradient-to-r from-primary to-accent hover:from-primary hover:to-accent text-primary-foreground font-extrabold px-4 py-1.5 rounded-lg text-xs transition-all shadow-lg shadow-primary/50 cursor-pointer border border-border"
          >
            <span>Proceed to ROI Modeling</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          {onExitClick && (
            <button
              onClick={onExitClick}
              className="p-1.5 hover:bg-secondary text-muted-foreground hover:text-foreground rounded-lg border border-border transition-colors cursor-pointer"
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
        <aside className="w-80 bg-sidebar/95 border-r border-border p-3.5 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-3 z-20">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <span className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-primary" />
              <span>Governance Scorecard</span>
            </span>
            <span className="text-[9px] font-mono text-muted-foreground bg-secondary border border-border px-2 py-0.5 rounded">
              Defender / Purview
            </span>
          </div>

          <div className="space-y-2.5">
            
            {/* Section 1: Sensitivity Label Coverage */}
            <div
              onClick={() => setHighlightedControl('labels')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedControl === 'labels'
                  ? 'bg-background border-primary ring-1 ring-primary/40 shadow-[0_0_15px_rgba(0,120,212,0.2)]'
                  : 'bg-background border-border hover:border-border'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-status-amber" />
                  1. Sensitivity Label Coverage
                </span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                  fixUnlabeled ? 'bg-status-green text-status-green border-status-green/30' : 'bg-status-amber/10 text-status-amber border-status-amber/30'
                }`}>
                  {fixUnlabeled ? 'Governed' : '62% Unlabeled'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-muted-foreground pt-1">
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Labeled Files:</span>
                  <span className={fixUnlabeled ? 'text-status-green font-bold' : 'text-status-amber'}>
                    {fixUnlabeled ? '94%' : '38%'}
                  </span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Unlabeled Files:</span>
                  <span className={fixUnlabeled ? 'text-status-green font-bold' : 'text-destructive'}>
                    {fixUnlabeled ? '6%' : '62%'}
                  </span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Drifted Repos:</span>
                  <span className="text-foreground">{fixUnlabeled ? '2 repos' : '24 repos'}</span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Accuracy:</span>
                  <span className="text-primary">{fixUnlabeled ? '98.4%' : '72.0%'}</span>
                </div>
              </div>
            </div>

            {/* Section 2: DLP Enforcement */}
            <div
              onClick={() => setHighlightedControl('dlp')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedControl === 'dlp'
                  ? 'bg-background border-primary ring-1 ring-primary/40 shadow-[0_0_15px_rgba(0,120,212,0.2)]'
                  : 'bg-background border-border hover:border-border'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-destructive" />
                  2. DLP Enforcement
                </span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                  resolveDlp ? 'bg-status-green text-status-green border-status-green/30' : 'bg-destructive/10 text-destructive border-destructive/30'
                }`}>
                  {resolveDlp ? 'Strict DLP' : '18 Conflicts'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-muted-foreground pt-1">
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Active Conflicts:</span>
                  <span className={resolveDlp ? 'text-status-green font-bold' : 'text-destructive font-bold'}>
                    {resolveDlp ? '0 conflicts' : '18 conflicts'}
                  </span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Flows Blocked:</span>
                  <span className="text-status-green">{resolveDlp ? '42 flows' : '12 flows'}</span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80 col-span-2">
                  <span className="text-muted-foreground block">Unprotected Sensitive Flows:</span>
                  <span className={resolveDlp ? 'text-status-green' : 'text-destructive font-bold'}>
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
                  ? 'bg-background border-primary ring-1 ring-primary/40 shadow-[0_0_15px_rgba(0,120,212,0.2)]'
                  : 'bg-background border-border hover:border-border'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                  3. Conditional Access (CA01)
                </span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                  tightenCA01 ? 'bg-status-green text-status-green border-status-green/30' : 'bg-status-amber/10 text-status-amber border-status-amber/30'
                }`}>
                  {tightenCA01 ? 'CA01 Strict' : 'CA01 Soft'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-muted-foreground pt-1">
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">CA01 Status:</span>
                  <span className={tightenCA01 ? 'text-status-green font-bold' : 'text-status-amber'}>
                    {tightenCA01 ? 'Strict Enforced' : 'Exemptions Active'}
                  </span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">MFA Rate:</span>
                  <span className={enforceMfa ? 'text-status-green font-bold' : 'text-status-amber'}>
                    {enforceMfa ? '100% All Users' : '94% Enforcement'}
                  </span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80 col-span-2">
                  <span className="text-muted-foreground block">Device Compliance Rate:</span>
                  <span className={requireDevice ? 'text-status-green font-bold' : 'text-muted-foreground'}>
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
                  ? 'bg-background border-primary ring-1 ring-primary/40 shadow-[0_0_15px_rgba(0,120,212,0.2)]'
                  : 'bg-background border-border hover:border-border'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-accent" />
                  4. External Exposure (EEEU)
                </span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                  externalGuests < 500 ? 'bg-status-green text-status-green border-status-green/30' : 'bg-destructive/10 text-destructive border-destructive/30'
                }`}>
                  {externalGuests} Guests
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-muted-foreground pt-1">
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">External Guests:</span>
                  <span className={externalGuests < 500 ? 'text-status-green font-bold' : 'text-destructive font-bold'}>
                    {externalGuests} guests
                  </span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Federated Domains:</span>
                  <span className={federatedDomains < 30 ? 'text-status-green font-bold' : 'text-status-amber'}>
                    {federatedDomains} domains
                  </span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80 col-span-2">
                  <span className="text-muted-foreground block">External Sharing Links:</span>
                  <span className="text-foreground">
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
                  ? 'bg-background border-primary ring-1 ring-primary/40 shadow-[0_0_15px_rgba(0,120,212,0.2)]'
                  : 'bg-background border-border hover:border-border'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-destructive" />
                  5. Permissions & Admin Roles
                </span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                  removeAdmins ? 'bg-status-green text-status-green border-status-green/30' : 'bg-destructive/10 text-destructive border-destructive/30'
                }`}>
                  {removeAdmins ? 'PIM Active' : '12 Admins'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-muted-foreground pt-1">
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Permanent Admins:</span>
                  <span className={removeAdmins ? 'text-status-green font-bold' : 'text-destructive font-bold'}>
                    {removeAdmins ? '0 (JIT PIM)' : '12 permanent'}
                  </span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Privileged Roles:</span>
                  <span className="text-foreground">34 accounts</span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80 col-span-2">
                  <span className="text-muted-foreground block">Permission Sprawl Clusters:</span>
                  <span className={permissionSprawl <= 5 ? 'text-status-green font-bold' : 'text-status-amber'}>
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
        <main className="flex-1 overflow-y-auto bg-background p-5 flex flex-col relative scrollbar-thin space-y-6">

          {/* -------------------------------------------------------------- */}
          {/* LAYER 1: SHORT GOVERNANCE STORY (TOP OF CENTER PANEL)           */}
          {/* -------------------------------------------------------------- */}
          <section className="bg-gradient-to-r from-secondary/90 via-background to-secondary/90 border border-primary/30 rounded-2xl p-4 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between pb-2 border-b border-border mb-3">
              <span className="text-xs font-extrabold uppercase tracking-widest text-primary flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary animate-spin-slow" />
                <span>Executive Governance Story & Readiness Narrative</span>
              </span>
              <span className={`text-[9.5px] font-mono px-2.5 py-0.5 rounded-full border font-bold ${theme.badgeBg}`}>
                {theme.storyBadge}
              </span>
            </div>

            <div className="space-y-2 text-xs leading-relaxed text-foreground font-normal">
              <p><strong className="text-foreground">Current Posture:</strong> {story.summary}</p>
              <p><strong className="text-foreground">Deployment Blockers:</strong> {story.blocker}</p>
              <p><strong className="text-foreground">Blast Radius Mechanics:</strong> {story.amplification}</p>
              <p><strong className="text-foreground">Copilot Readiness Impact:</strong> {story.wouldHappen}</p>
              <div className="mt-3 pt-2 border-t border-border flex items-center justify-between text-xs font-bold text-primary font-mono">
                <span>🎯 Key Impact Line: {story.impactLine}</span>
                <span className="text-[10px] text-muted-foreground">Microsoft Defender & Purview Verified</span>
              </div>
            </div>
          </section>

          {/* -------------------------------------------------------------- */}
          {/* LAYER 2: GOVERNANCE SIMULATION ENGINE (MIDDLE OF CENTER PANEL)  */}
          {/* -------------------------------------------------------------- */}
          <section className="bg-background border border-border rounded-2xl p-5 shadow-2xl relative space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-foreground">
                  Governance Simulation Engine (Copilot Safety Controls)
                </h2>
              </div>
              <button
                onClick={() => handleApplyPreset('baseline')}
                className="flex items-center space-x-1 text-[10px] font-mono text-muted-foreground hover:text-foreground bg-secondary border border-border px-2.5 py-1 rounded transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Reset Simulation</span>
              </button>
            </div>

            {/* Controls Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Control 1: Fix Unlabeled Files */}
              <div className={`p-3.5 rounded-xl border transition-all ${
                highlightedControl === 'labels' ? 'bg-primary/10 border-primary' : 'bg-secondary/80 border-border'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-foreground block">Fix Unlabeled Files</span>
                    <span className="text-[10px] text-muted-foreground">Enforce Purview auto-labeling on 62% unlabeled files</span>
                  </div>
                  <button
                    onClick={() => {
                      setFixUnlabeled(!fixUnlabeled);
                      if (onUpdateGovernance) onUpdateGovernance({ sensitivityLabels: !fixUnlabeled });
                    }}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 flex items-center ${
                      fixUnlabeled ? 'bg-primary justify-end' : 'bg-secondary justify-start'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>
              </div>

              {/* Control 2: Resolve DLP Conflicts */}
              <div className={`p-3.5 rounded-xl border transition-all ${
                highlightedControl === 'dlp' ? 'bg-primary/10 border-primary' : 'bg-secondary/80 border-border'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-foreground block">Resolve DLP Conflicts</span>
                    <span className="text-[10px] text-muted-foreground">Clear 18 active DLP overrides & protect sensitive flows</span>
                  </div>
                  <button
                    onClick={() => {
                      setResolveDlp(!resolveDlp);
                      if (onUpdateGovernance) onUpdateGovernance({ dlp: !resolveDlp ? 'moderate' : 'off' });
                    }}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 flex items-center ${
                      resolveDlp ? 'bg-primary justify-end' : 'bg-secondary justify-start'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>
              </div>

              {/* Control 3: Tighten CA01 */}
              <div className={`p-3.5 rounded-xl border transition-all ${
                highlightedControl === 'ca01' ? 'bg-primary/10 border-primary' : 'bg-secondary/80 border-border'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-foreground block">Tighten CA01 Policy</span>
                    <span className="text-[10px] text-muted-foreground">Remove legacy exemptions & enforce strict Zero Trust</span>
                  </div>
                  <button
                    onClick={() => {
                      setTightenCA01(!tightenCA01);
                      if (onUpdateGovernance) onUpdateGovernance({ ca01: !tightenCA01 });
                    }}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 flex items-center ${
                      tightenCA01 ? 'bg-primary justify-end' : 'bg-secondary justify-start'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>
              </div>

              {/* Control 4: Enforce MFA for All Users */}
              <div className="p-3.5 rounded-xl border bg-secondary/80 border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-foreground block">Enforce MFA for All Users</span>
                    <span className="text-[10px] text-muted-foreground">Mandate step-up MFA across 100% of tenant accounts</span>
                  </div>
                  <button
                    onClick={() => setEnforceMfa(!enforceMfa)}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 flex items-center ${
                      enforceMfa ? 'bg-primary justify-end' : 'bg-secondary justify-start'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>
              </div>

              {/* Control 5: Require Device Compliance */}
              <div className="p-3.5 rounded-xl border bg-secondary/80 border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-foreground block">Require Device Compliance</span>
                    <span className="text-[10px] text-muted-foreground">Block unmanaged or non-compliant Intune endpoints</span>
                  </div>
                  <button
                    onClick={() => setRequireDevice(!requireDevice)}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 flex items-center ${
                      requireDevice ? 'bg-primary justify-end' : 'bg-secondary justify-start'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>
              </div>

              {/* Control 8: Remove Permanent Admins */}
              <div className={`p-3.5 rounded-xl border transition-all ${
                highlightedControl === 'admins' ? 'bg-primary/10 border-primary' : 'bg-secondary/80 border-border'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-foreground block">Remove Permanent Admins</span>
                    <span className="text-[10px] text-muted-foreground">Migrate 12 global admin accounts to Entra PIM JIT</span>
                  </div>
                  <button
                    onClick={() => {
                      setRemoveAdmins(!removeAdmins);
                      if (onUpdateGovernance) onUpdateGovernance({ pim: !removeAdmins });
                    }}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 flex items-center ${
                      removeAdmins ? 'bg-primary justify-end' : 'bg-secondary justify-start'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>
              </div>

              {/* Control 6: Reduce External Guests (SLIDER) */}
              <div className={`p-3.5 rounded-xl border transition-all md:col-span-2 ${
                highlightedControl === 'external' ? 'bg-primary/10 border-primary' : 'bg-secondary/80 border-border'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-xs font-bold text-foreground block">Reduce External Guests</span>
                    <span className="text-[10px] text-muted-foreground">Prune unmonitored guest access across tenant SharePoint & Teams</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-primary">{externalGuests} guests</span>
                </div>
                <input
                  type="range"
                  min="100"
                  max="1500"
                  step="50"
                  value={externalGuests}
                  onChange={(e) => setExternalGuests(Number(e.target.value))}
                  className="w-full accent-primary bg-secondary h-1.5 rounded-lg cursor-pointer"
                />
              </div>

              {/* Control 7: Reduce Federated Domains (SLIDER) */}
              <div className="p-3.5 rounded-xl border bg-secondary/80 border-border">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-xs font-bold text-foreground block">Reduce Federated Domains</span>
                    <span className="text-[10px] text-muted-foreground">Restrict tenant federation to trusted B2B orgs</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-accent">{federatedDomains} domains</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="5"
                  value={federatedDomains}
                  onChange={(e) => setFederatedDomains(Number(e.target.value))}
                  className="w-full accent-accent bg-secondary h-1.5 rounded-lg cursor-pointer"
                />
              </div>

              {/* Control 9: Reduce Permission Sprawl (SLIDER) */}
              <div className="p-3.5 rounded-xl border bg-secondary/80 border-border">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-xs font-bold text-foreground block">Reduce Permission Sprawl</span>
                    <span className="text-[10px] text-muted-foreground">Consolidate overshared SharePoint sites with broad access</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-status-amber">{permissionSprawl} clusters</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  value={permissionSprawl}
                  onChange={(e) => setPermissionSprawl(Number(e.target.value))}
                  className="w-full accent-status-amber bg-secondary h-1.5 rounded-lg cursor-pointer"
                />
              </div>

            </div>
          </section>

          {/* -------------------------------------------------------------- */}
          {/* LAYER 3: SIMULATED BLAST RADIUS RING (BOTTOM OF CENTER PANEL)   */}
          {/* -------------------------------------------------------------- */}
          <section className="bg-background border border-border rounded-2xl p-6 shadow-2xl relative flex flex-col items-center justify-center space-y-4">
            <div className="flex items-center justify-between w-full pb-2 border-b border-border">
              <span className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
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
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground font-bold block mb-1">
                  Copilot Blast Radius
                </span>
                <span className={`text-3xl font-mono font-black ${theme.textColor}`}>
                  {rawBlastRadius}%
                </span>
                <span className="text-[10px] font-mono font-bold text-muted-foreground mt-1">
                  {readinessScore >= 80 ? '🔒 Contained & Safe' : readinessScore >= 50 ? '⚠️ Moderate Exposure' : '🚨 Severe Overexposure'}
                </span>
                <div className="mt-2 text-[9px] font-mono bg-muted/60 px-2.5 py-1 rounded-full border border-border text-muted-foreground">
                  Reduction Delta: <span className="text-status-green font-bold">-{Math.max(0, blastRadiusReductionPct)}%</span>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground text-center max-w-lg">
              The circular blast radius contracts as you enable Purview auto-labeling, enforce DLP rules, and prune external guests. A smaller ring guarantees Copilot cannot summarize overshared confidential assets.
            </p>
          </section>

        </main>

        {/* ================================================================== */}
        {/* RIGHT PANEL — IMPACT METRICS & SAFEGUARDS (DYNAMIC)                */}
        {/* ================================================================== */}
        <aside className="w-84 bg-sidebar/95 border-l border-border p-4 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-4 z-20">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <span className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-status-green" />
              <span>Impact Metrics & Safeguards</span>
            </span>
            <span className="text-[9px] font-mono text-status-green bg-status-green/15 border border-status-green/30 px-2 py-0.5 rounded">
              Dynamic Realtime
            </span>
          </div>

          <div className="space-y-3">

            {/* 1. Copilot Readiness Delta */}
            <div className="p-3.5 rounded-xl bg-secondary/90 border border-border space-y-2">
              <span className="text-[10px] font-mono uppercase text-muted-foreground font-bold block">
                Copilot Readiness Delta
              </span>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-muted-foreground block">Readiness Score:</span>
                  <span className="text-sm font-mono font-black text-foreground">42 → <span className="text-status-green">{readinessScore}</span></span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-muted-foreground block">Blast Radius Delta:</span>
                  <span className="text-xs font-mono font-bold text-status-green">-{Math.max(0, blastRadiusReductionPct)}% Reduced</span>
                </div>
              </div>
              <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden mt-1">
                <div className="h-full bg-status-green transition-all duration-500" style={{ width: `${readinessScore}%` }} />
              </div>
            </div>

            {/* 2. Sensitivity Label Impact */}
            <div className="p-3.5 rounded-xl bg-secondary/90 border border-border space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-primary font-bold flex items-center justify-between">
                <span>Sensitivity Label Impact</span>
                <span className="text-muted-foreground">{fixUnlabeled ? 'Active' : 'Pending'}</span>
              </span>
              <p className="text-xs text-foreground font-bold">
                {fixUnlabeled ? 'Label coverage increased to 94%' : '38% labeled (62% unprotected)'}
              </p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {fixUnlabeled ? 'PHI/CUI files auto-labeled with Purview MIP headers to block unauthorized Copilot summarization.' : 'Unlabeled files remain vulnerable to Copilot Graph over-indexing.'}
              </p>
            </div>

            {/* 3. DLP Impact */}
            <div className="p-3.5 rounded-xl bg-secondary/90 border border-border space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-destructive font-bold flex items-center justify-between">
                <span>DLP Safeguard Impact</span>
                <span className="text-muted-foreground">{resolveDlp ? 'Enforced' : 'Off'}</span>
              </span>
              <p className="text-xs text-foreground font-bold">
                {resolveDlp ? '18 active DLP conflicts resolved' : '18 active DLP policy conflicts'}
              </p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {resolveDlp ? '42 sensitive egress flows guarded against external export via Copilot Studio connectors.' : 'Unchecked DLP overrides allow Copilot prompts to synthesize sensitive outputs.'}
              </p>
            </div>

            {/* 4. CA01 Impact */}
            <div className="p-3.5 rounded-xl bg-secondary/90 border border-border space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-status-amber font-bold flex items-center justify-between">
                <span>CA01 & Identity Impact</span>
                <span className="text-muted-foreground">{tightenCA01 ? 'Strict' : 'Soft'}</span>
              </span>
              <p className="text-xs text-foreground font-bold">
                {tightenCA01 ? 'Identity blast radius reduced' : 'CA01 exemptions active'}
              </p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {tightenCA01 ? 'Zero Trust posture strengthened with compulsory step-up MFA and strict device validation.' : 'Bypasses in CA01 allow non-compliant endpoints to run Copilot prompts.'}
              </p>
            </div>

            {/* 5. External Exposure Impact */}
            <div className="p-3.5 rounded-xl bg-secondary/90 border border-border space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-accent font-bold flex items-center justify-between">
                <span>External Exposure Impact</span>
                <span className="text-muted-foreground">{externalGuests < 500 ? 'Low' : 'High'}</span>
              </span>
              <p className="text-xs text-foreground font-bold">
                Guest access reduced (1,240 → {externalGuests})
              </p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Federated domain risk lowered ({federatedDomains} active domains). Minimizes risk of external guest accounts prompting Copilot for internal tenant data.
              </p>
            </div>

            {/* 6. Permissions Impact */}
            <div className="p-3.5 rounded-xl bg-secondary/90 border border-border space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-status-green font-bold flex items-center justify-between">
                <span>Permissions & Privilege Impact</span>
                <span className="text-muted-foreground">{removeAdmins ? 'PIM Active' : 'Sprawl'}</span>
              </span>
              <p className="text-xs text-foreground font-bold">
                {removeAdmins ? '12 permanent admins removed (PIM JIT)' : '12 permanent global admins active'}
              </p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Privilege sprawl reduced to {permissionSprawl} clusters. Prevents credential harvesting and administrative privilege escalation via Copilot Graph indexing.
              </p>
            </div>

          </div>
        </aside>

      </div>
    </div>
  );
};
