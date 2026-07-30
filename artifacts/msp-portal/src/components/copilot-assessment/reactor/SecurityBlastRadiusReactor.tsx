import React, { useState } from 'react';
import { GovernanceState } from '../types';
import { 
  ShieldAlert, 
  Flame, 
  Zap, 
  Sparkles, 
  Sliders, 
  AlertTriangle, 
  HelpCircle, 
  ArrowRight, 
  X, 
  ChevronRight,
  Layers,
  Activity
} from 'lucide-react';

import { ReactorCore } from './ReactorCore';
import { M365SecurityScorecard } from './M365SecurityScorecard';
import { CopilotSafeguardsPanel } from './CopilotSafeguardsPanel';
import { SocSimulationStream, SocEventCard } from './SocSimulationStream';
import { SecurityHeatMap } from './SecurityHeatMap';

interface SecurityBlastRadiusReactorProps {
  governance: GovernanceState;
  onUpdateGovernance: (updated: Partial<GovernanceState>) => void;
  onContinue: () => void;
  onHelpClick?: () => void;
  onExitClick?: () => void;
  onNavigate?: (step: string) => void;
}

export const SecurityBlastRadiusReactor: React.FC<SecurityBlastRadiusReactorProps> = ({
  governance,
  onUpdateGovernance,
  onContinue,
  onHelpClick,
  onExitClick,
  onNavigate
}) => {
  // Mode: 'projected' (Default / Copilot Not Deployed) | 'soc' (SOC Telemetry) | 'redteam'
  const [mode, setMode] = useState<'projected' | 'soc' | 'redteam'>('projected');

  // Simulation Controls State
  const [enableCopilot, setEnableCopilot] = useState<boolean>(true);
  const [tightenCA01, setTightenCA01] = useState<boolean>(governance.ca01 || false);
  const [fixUnlabeled, setFixUnlabeled] = useState<boolean>(governance.sensitivityLabels || false);
  const [resolveDLP, setResolveDLP] = useState<boolean>(governance.dlp !== 'off');
  const [removePermanentAdmins, setRemovePermanentAdmins] = useState<boolean>(governance.pim || false);
  const [externalGuestsLevel, setExternalGuestsLevel] = useState<number>(70);
  const [federatedDomainsLevel, setFederatedDomainsLevel] = useState<number>(88);

  // Focus pillar for scorecard highlighting
  const [selectedPillarId, setSelectedPillarId] = useState<string>('overexposure');

  // Calculate Copilot Readiness Score (0-100)
  let readinessScore = 28;
  if (tightenCA01) readinessScore += 24;
  if (fixUnlabeled) readinessScore += 22;
  if (resolveDLP) readinessScore += 16;
  if (removePermanentAdmins) readinessScore += 14;
  if (externalGuestsLevel < 40) readinessScore += 10;
  if (readinessScore > 100) readinessScore = 100;

  // Toggle Handlers syncing with state and parent governance
  const handleToggleCA01 = () => {
    const nextVal = !tightenCA01;
    setTightenCA01(nextVal);
    onUpdateGovernance({ ca01: nextVal });
  };

  const handleToggleUnlabeled = () => {
    const nextVal = !fixUnlabeled;
    setFixUnlabeled(nextVal);
    onUpdateGovernance({ sensitivityLabels: nextVal });
  };

  const handleToggleDLP = () => {
    const nextVal = !resolveDLP;
    setResolveDLP(nextVal);
    onUpdateGovernance({ dlp: nextVal ? 'strict' : 'off' });
  };

  const handleTogglePIM = () => {
    const nextVal = !removePermanentAdmins;
    setRemovePermanentAdmins(nextVal);
    onUpdateGovernance({ pim: nextVal });
  };

  // SOC Telemetry Simulation Stream Events
  const [events, setEvents] = useState<SocEventCard[]>([
    {
      id: 'e1',
      type: 'xpia',
      category: 'Document Infiltration',
      severity: 'Critical',
      title: 'If Copilot were enabled today...',
      description: 'Copilot WOULD access 3,420 unlabeled PHI records in guest-accessible Teams libraries.',
      impact: 'Exposes HIPAA protected records to unverified external guests',
      recommendedAction: 'Enforce CA01 Policy & Apply Labels',
      timestamp: '12:04:15'
    },
    {
      id: 'e2',
      type: 'xpia',
      category: 'XPIA Summarization Vector',
      severity: 'High',
      title: 'If Copilot were enabled today...',
      description: 'Copilot WOULD summarize overshared CUI mission critical defense logs across public channels.',
      impact: 'Unsanitized military specification logs summarized into unencrypted draft emails',
      recommendedAction: 'Restrict Graph Connector',
      timestamp: '12:04:22'
    },
    {
      id: 'e3',
      type: 'prompt_risk',
      category: 'Bad Prompt Intent',
      severity: 'Critical',
      title: 'Adversarial Prompt Attempt',
      description: 'User asked Copilot: "Summarize all executive compensation and HR medical files in SharePoint"',
      impact: 'Privileged role escalation vector via unmonitored Copilot Graph queries',
      recommendedAction: 'Enable PIM JIT Identity',
      timestamp: '12:04:30'
    }
  ]);

  const handleTriggerCriticalCombination = () => {
    const newEvt: SocEventCard = {
      id: `crit-${Date.now()}`,
      type: 'prompt_risk',
      category: 'Exfiltration Combination',
      severity: 'Critical',
      title: 'CRITICAL OVERLAP TRIGGERED',
      description: 'Compromised account executed prompt: "Export all PHI patient lists and draft email to external guest"',
      impact: 'Combined overexposure + permanent admin + missing DLP allowed instant data leak vector',
      recommendedAction: 'Enforce CA01 & Strict DLP',
      timestamp: new Date().toLocaleTimeString()
    };
    setEvents(prev => [newEvt, ...prev]);
  };

  const handleApplyFixAction = (action: string) => {
    if (action.includes('CA01')) handleToggleCA01();
    else if (action.includes('Labels')) handleToggleUnlabeled();
    else if (action.includes('DLP')) handleToggleDLP();
    else if (action.includes('PIM')) handleTogglePIM();
    else {
      handleToggleCA01();
      handleToggleUnlabeled();
    }
  };

  return (
    <div className={`h-screen w-screen flex flex-col font-sans overflow-hidden antialiased select-none relative transition-colors duration-500 ${
      mode === 'redteam' ? 'bg-background text-foreground' : 'bg-background text-foreground'
    }`}>
      
      {/* -------------------------------------------------------------------- */}
      {/* TOP HEADER BAR                                                      */}
      {/* -------------------------------------------------------------------- */}
      <header className={`h-16 px-4 flex items-center justify-between shrink-0 z-30 backdrop-blur-md border-b transition-colors ${
        mode === 'redteam'
          ? 'bg-background/95 border-destructive/50'
          : 'bg-background/95 border-border'
      }`}>
        
        {/* Left Title & Badge */}
        <div className="flex items-center space-x-3">
          <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${
            mode === 'redteam'
              ? 'bg-destructive/10 border-destructive text-destructive'
              : 'bg-primary/10 border-primary text-primary'
          }`}>
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-black uppercase tracking-widest text-foreground">
                Microsoft Copilot Security Blast Radius
              </span>
              <span className="text-[10px] font-mono bg-primary/15 text-primary border border-primary/30 px-2 py-0.5 rounded font-extrabold">
                M365 SECURITY CORE
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Defender & Purview Telemetry • Zero Trust Blast Radius Model
            </p>
          </div>
        </div>

        {/* CENTER COPILOT READINESS SCORE (0-100) */}
        <div className="hidden lg:flex items-center space-x-4 bg-muted/60 px-4 py-1.5 rounded-xl border border-border">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-mono font-bold text-muted-foreground uppercase">
                Copilot Readiness Score:
              </span>
              <span className={`text-lg font-black font-mono ${
                readinessScore >= 75 ? 'text-status-green' : readinessScore >= 50 ? 'text-status-amber' : 'text-destructive'
              }`}>
                {readinessScore} / 100
              </span>
            </div>
            {/* Visual Gauge Bar */}
            <div className="w-48 h-2 bg-secondary rounded-full overflow-hidden mt-1 flex">
              <div
                className={`h-full transition-all duration-700 ${
                  readinessScore >= 75 ? 'bg-status-green' : readinessScore >= 50 ? 'bg-status-amber' : 'bg-destructive'
                }`}
                style={{ width: `${readinessScore}%` }}
              />
            </div>
          </div>

          <span className={`text-[9.5px] font-mono font-extrabold px-2 py-1 rounded border uppercase ${
            readinessScore >= 75
              ? 'bg-status-green/10 text-status-green border-status-green/30'
              : readinessScore >= 50
              ? 'bg-status-amber/10 text-status-amber border-status-amber/30'
              : 'bg-destructive/10 text-destructive border-destructive/30'
          }`}>
            {readinessScore >= 75 ? 'Ready to Deploy' : readinessScore >= 50 ? 'Needs Guardrails' : 'PRE-DEPLOYMENT BLOCKER'}
          </span>
        </div>

        {/* Right Mode Controls & Actions */}
        <div className="flex items-center space-x-3">
          
          {/* Dual-Mode Selector */}
          <div className="bg-muted/60 p-1 rounded-xl border border-border flex items-center space-x-1">
            <button
              onClick={() => setMode('projected')}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                mode === 'projected'
                  ? 'bg-status-amber/10 text-status-amber border border-status-amber shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              1. PROJECTED MODE
            </button>

            <button
              onClick={() => setMode('soc')}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                mode === 'soc'
                  ? 'bg-accent/10 text-accent border border-accent shadow-[0_0_12px_rgba(168,85,247,0.3)]'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              2. SOC SIMULATION
            </button>
          </div>

          {/* Red Team Toggle */}
          <button
            onClick={() => setMode(mode === 'redteam' ? 'projected' : 'redteam')}
            className={`px-3 py-1.5 rounded-xl font-mono text-xs font-extrabold flex items-center space-x-1.5 transition-all cursor-pointer border ${
              mode === 'redteam'
                ? 'bg-destructive text-foreground border-destructive shadow-[0_0_20px_rgba(244,63,94,0.5)]'
                : 'bg-secondary text-destructive border-destructive/60 hover:border-destructive'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>{mode === 'redteam' ? '🔴 RED TEAM ACTIVE' : 'RED TEAM MODE'}</span>
          </button>

          {/* Proceed Button */}
          <button
            onClick={onContinue}
            className="flex items-center space-x-2 bg-gradient-to-r from-destructive via-accent to-accent hover:from-destructive hover:to-accent text-primary-foreground font-extrabold px-4 py-1.5 rounded-lg text-xs transition-all shadow-lg shadow-destructive/50 cursor-pointer border border-border"
          >
            <span>Proceed to Governance Sandbox</span>
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

      {/* -------------------------------------------------------------------- */}
      {/* MAIN CONTENT BODY (THREE-PANEL LAYOUT)                               */}
      {/* -------------------------------------------------------------------- */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        
        {/* PERSPECTIVE MODE EXPLANATION BAR */}
        <div className={`p-3 rounded-2xl border text-xs font-mono transition-all flex flex-col md:flex-row items-center justify-between gap-3 ${
          mode === 'redteam'
            ? 'bg-destructive/15 border-destructive/80 text-destructive shadow-[0_0_20px_rgba(244,63,94,0.3)]'
            : mode === 'soc'
            ? 'bg-accent/80 border-accent/80 text-accent'
            : 'bg-status-amber/10 border-status-amber/60 text-status-amber'
        }`}>
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-xl border ${
              mode === 'redteam'
                ? 'bg-destructive/10 border-destructive text-destructive'
                : mode === 'soc'
                ? 'bg-accent/10 border-accent text-accent'
                : 'bg-status-amber/10 border-status-amber text-status-amber'
            }`}>
              {mode === 'redteam' ? <Flame className="w-4 h-4" /> : mode === 'soc' ? <Zap className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold uppercase text-sm tracking-wider">
                  {mode === 'projected' && '1. Projected Mode — CISO Baseline Assessment'}
                  {mode === 'soc' && '2. SOC Incident Simulation — Compromised Credential / Insider Threat'}
                  {mode === 'redteam' && '3. Red Team Penetration Scenario — Adversarial Cyber Attack'}
                </span>
                <span className="text-[9px] px-2 py-0.5 rounded font-black uppercase bg-muted/60 border border-border">
                  {mode === 'projected' ? 'Business Operations' : mode === 'soc' ? 'Incident Response' : 'Full Attack Chain'}
                </span>
              </div>
              <p className="text-[10.5px] opacity-90 mt-0.5">
                {mode === 'projected' && 'Evaluates standard user Copilot prompts under normal enterprise workflows to project baseline data exposure risk.'}
                {mode === 'soc' && 'Simulates an active insider threat or compromised credential attempting prompt extraction of PHI, salaries, and CUI files.'}
                {mode === 'redteam' && 'Simulates an external threat actor exploiting overshared B2B guest domains, prompt injection, and unclassified SharePoint sites.'}
              </p>
            </div>
          </div>

          {/* Mode Switcher Buttons */}
          <div className="flex items-center space-x-1.5 shrink-0 bg-muted/80 p-1 rounded-xl border border-border">
            <button
              onClick={() => setMode('projected')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer ${
                mode === 'projected' ? 'bg-status-amber text-black font-extrabold' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              CISO Baseline
            </button>
            <button
              onClick={() => setMode('soc')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer ${
                mode === 'soc' ? 'bg-accent text-black font-extrabold' : 'text-muted-foreground hover:text-primary-foreground'
              }`}
            >
              SOC Incident
            </button>
            <button
              onClick={() => setMode('redteam')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer ${
                mode === 'redteam' ? 'bg-destructive text-foreground font-extrabold' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Red Team
            </button>
          </div>
        </div>

        {/* RED TEAM ATTACK CHAIN BANNER IF ACTIVE */}
        {mode === 'redteam' && (
          <div className="p-3.5 rounded-2xl bg-destructive/10/90 border-2 border-destructive text-xs space-y-2 shadow-[0_0_30px_rgba(244,63,94,0.4)]">
            <div className="flex items-center space-x-2 text-destructive font-mono font-black uppercase tracking-wider">
              <Flame className="w-4 h-4 text-destructive" />
              <span>Microsoft Attack Simulation — Adversarial Copilot Exfiltration Chain</span>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 bg-muted/80 p-3 rounded-xl border border-destructive font-mono text-[11px] text-foreground">
              <span className="text-destructive font-bold">1. Attacker Prompt</span>
              <ChevronRight className="w-4 h-4 text-destructive hidden sm:block" />
              <span className="text-status-amber font-bold">2. Copilot Accesses Overshared CUI</span>
              <ChevronRight className="w-4 h-4 text-destructive hidden sm:block" />
              <span className="text-accent font-bold">3. Copilot Summarizes PHI</span>
              <ChevronRight className="w-4 h-4 text-destructive hidden sm:block" />
              <span className="text-destructive font-bold">4. Copilot Drafts Outbound Exfiltration</span>
            </div>
          </div>
        )}

        {/* ================================================================== */}
        {/* THREE-PANEL LAYOUT STRUCTURE                                        */}
        {/* ================================================================== */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          
          {/* LEFT PANEL (3 COLS): M365 SECURITY SCORECARD */}
          <div className="lg:col-span-3">
            <M365SecurityScorecard
              governance={governance}
              selectedPillarId={selectedPillarId}
              onSelectPillar={(id) => setSelectedPillarId(id)}
              tightenCA01={tightenCA01}
              fixUnlabeled={fixUnlabeled}
              resolveDLP={resolveDLP}
              removePermanentAdmins={removePermanentAdmins}
              externalGuestsLevel={externalGuestsLevel}
              federatedDomainsLevel={federatedDomainsLevel}
            />
          </div>

          {/* CENTER PANEL (6 COLS): STORY + RADAR + SIMULATION CONTROLS */}
          <div className="lg:col-span-6 flex flex-col justify-between">
            <ReactorCore
              enableCopilot={enableCopilot}
              onToggleEnableCopilot={() => setEnableCopilot(!enableCopilot)}
              tightenCA01={tightenCA01}
              onToggleCA01={handleToggleCA01}
              fixUnlabeled={fixUnlabeled}
              onToggleUnlabeled={handleToggleUnlabeled}
              resolveDLP={resolveDLP}
              onToggleDLP={handleToggleDLP}
              removePermanentAdmins={removePermanentAdmins}
              onTogglePIM={handleTogglePIM}
              externalGuestsLevel={externalGuestsLevel}
              onChangeExternalGuests={(val) => setExternalGuestsLevel(val)}
              federatedDomainsLevel={federatedDomainsLevel}
              onChangeFederatedDomains={(val) => setFederatedDomainsLevel(val)}
              selectedPillarId={selectedPillarId}
              onSelectPillar={(id) => setSelectedPillarId(id)}
            />
          </div>

          {/* RIGHT PANEL (3 COLS): COPILOT SAFEGUARDS & IMPACT METRICS */}
          <div className="lg:col-span-3">
            <CopilotSafeguardsPanel
              tightenCA01={tightenCA01}
              onToggleCA01={handleToggleCA01}
              fixUnlabeled={fixUnlabeled}
              onToggleUnlabeled={handleToggleUnlabeled}
              resolveDLP={resolveDLP}
              onToggleDLP={handleToggleDLP}
              removePermanentAdmins={removePermanentAdmins}
              onTogglePIM={handleTogglePIM}
              externalGuestsLevel={externalGuestsLevel}
            />
          </div>

        </div>

        {/* BOTTOM PANEL: SOC SIMULATION STREAM */}
        <SocSimulationStream
          mode={mode}
          events={events}
          onTriggerCriticalCombination={handleTriggerCriticalCombination}
          onApplyFixAction={handleApplyFixAction}
        />

        {/* HEATMAP / SCALE MATRIX */}
        <SecurityHeatMap
          mode={mode}
          aiComfortLevel={2}
        />

      </main>

    </div>
  );
};
