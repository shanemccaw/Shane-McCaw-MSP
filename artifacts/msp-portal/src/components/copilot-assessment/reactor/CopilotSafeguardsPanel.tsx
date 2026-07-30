import React from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Lock, 
  Sliders, 
  Key, 
  FileCheck, 
  Bot, 
  Activity,
  Zap
} from 'lucide-react';

interface CopilotSafeguardsPanelProps {
  tightenCA01: boolean;
  onToggleCA01: () => void;
  fixUnlabeled: boolean;
  onToggleUnlabeled: () => void;
  resolveDLP: boolean;
  onToggleDLP: () => void;
  removePermanentAdmins: boolean;
  onTogglePIM: () => void;
  externalGuestsLevel: number;
}

export const CopilotSafeguardsPanel: React.FC<CopilotSafeguardsPanelProps> = ({
  tightenCA01,
  onToggleCA01,
  fixUnlabeled,
  onToggleUnlabeled,
  resolveDLP,
  onToggleDLP,
  removePermanentAdmins,
  onTogglePIM,
  externalGuestsLevel
}) => {
  // Determine top Risk Amplifier message
  let riskAmplifierTitle = '62% unlabeled files – Copilot cannot protect PHI and CUI data.';
  let riskAmplifierSeverity: 'Critical' | 'High' | 'Safe' = 'Critical';

  if (!tightenCA01 && !fixUnlabeled) {
    riskAmplifierTitle = 'CA01 disabled & 62% unlabeled files – Copilot will inherit unconstrained blast radius.';
    riskAmplifierSeverity = 'Critical';
  } else if (!tightenCA01) {
    riskAmplifierTitle = 'CA01 disabled – Device & session authentication posture open to unverified access.';
    riskAmplifierSeverity = 'Critical';
  } else if (!fixUnlabeled) {
    riskAmplifierTitle = '62% unlabeled files – Copilot cannot protect PHI and CUI sensitive data.';
    riskAmplifierSeverity = 'High';
  } else if (externalGuestsLevel > 50) {
    riskAmplifierTitle = '1,240 external guests active – Residual exposure in federated channels.';
    riskAmplifierSeverity = 'High';
  } else {
    riskAmplifierTitle = 'All core guardrails enforced – Blast radius minimized for safe Copilot deployment.';
    riskAmplifierSeverity = 'Safe';
  }

  // Count active blockers
  const blockersCount = (!tightenCA01 ? 1 : 0) + (!fixUnlabeled ? 1 : 0) + (!resolveDLP ? 1 : 0) + (!removePermanentAdmins ? 1 : 0);

  return (
    <div className="bg-background border border-border rounded-2xl p-3.5 space-y-3 flex flex-col justify-between h-full select-none overflow-hidden">
      
      {/* HEADER */}
      <div className="flex items-center justify-between pb-2 border-b border-border shrink-0">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded bg-accent/20 border border-accent/40 flex items-center justify-center text-accent">
            <ShieldCheck className="w-3.5 h-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-black uppercase tracking-wider text-foreground">
              Copilot Safeguards & Guardrails
            </h4>
            <p className="text-[9.5px] text-muted-foreground">
              Readiness Controls • Impact Metrics
            </p>
          </div>
        </div>
        <span className={`text-[9px] font-mono px-2 py-0.5 rounded border font-bold uppercase ${
          blockersCount > 0
            ? 'bg-destructive/10/90 text-destructive border-destructive/30'
            : 'bg-status-green text-status-green border-status-green/30'
        }`}>
          {blockersCount > 0 ? `${blockersCount} Blockers Active` : 'All Enforced'}
        </span>
      </div>

      {/* BIG RISK AMPLIFIER CALLOUT (TOP OF PANEL) */}
      <div className="shrink-0">
        <div className={`p-3 rounded-xl border text-[11px] font-mono space-y-1 shadow-lg ${
          riskAmplifierSeverity === 'Critical'
            ? 'bg-destructive/10/90 border-destructive/80 text-destructive shadow-[0_0_15px_rgba(244,63,94,0.25)]'
            : riskAmplifierSeverity === 'High'
            ? 'bg-status-amber/10/90 border-status-amber/80 text-status-amber'
            : 'bg-status-green/90 border-status-green/80 text-status-green'
        }`}>
          <div className="flex items-center space-x-2 font-extrabold uppercase text-[10px]">
            {riskAmplifierSeverity === 'Critical' ? (
              <ShieldAlert className="w-4 h-4 text-destructive shrink-0" />
            ) : riskAmplifierSeverity === 'High' ? (
              <AlertTriangle className="w-4 h-4 text-status-amber shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-status-green shrink-0" />
            )}
            <span className={
              riskAmplifierSeverity === 'Critical' ? 'text-destructive' :
              riskAmplifierSeverity === 'High' ? 'text-status-amber' : 'text-status-green'
            }>
              {riskAmplifierSeverity === 'Critical' ? 'Critical Risk Amplifier' :
               riskAmplifierSeverity === 'High' ? 'High Risk Amplifier' : 'Guardrail Status: Safe'}
            </span>
          </div>
          <p className="text-[11px] font-bold leading-relaxed pt-1">
            "{riskAmplifierTitle}"
          </p>
        </div>
      </div>

      {/* 4 CORE SAFEGUARD SECTIONS WITH STATUS & IMPACT */}
      <div className="space-y-2.5 flex-1 overflow-y-auto scrollbar-thin pr-1">
        
        {/* 1. CA01 Conditional Access */}
        <div
          onClick={onToggleCA01}
          className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between space-y-1 ${
            tightenCA01
              ? 'bg-status-green/40 border-status-green/60 text-status-green'
              : 'bg-destructive/10/40 border-destructive text-destructive hover:border-destructive'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Lock className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-xs font-extrabold text-foreground">CA01 Conditional Access</span>
            </div>
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border uppercase ${
              tightenCA01 ? 'bg-status-green text-status-green border-status-green/30' : 'bg-destructive/10 text-destructive border-destructive/30'
            }`}>
              {tightenCA01 ? 'Enforced' : 'Not Enforced'}
            </span>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground bg-muted/40 p-1.5 rounded border border-border/50 flex items-center justify-between">
            <span className="text-muted-foreground">Impact:</span>
            <span className="font-semibold text-primary">Reduces identity blast radius</span>
          </div>
        </div>

        {/* 2. Sensitivity Label Coverage */}
        <div
          onClick={onToggleUnlabeled}
          className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between space-y-1 ${
            fixUnlabeled
              ? 'bg-status-green/40 border-status-green/60 text-status-green'
              : 'bg-status-amber/10/40 border-status-amber/60 text-status-amber hover:border-status-amber'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <FileCheck className="w-3.5 h-3.5 text-status-green shrink-0" />
              <span className="text-xs font-extrabold text-foreground">Sensitivity Label Coverage</span>
            </div>
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border uppercase ${
              fixUnlabeled ? 'bg-status-green text-status-green border-status-green/30' : 'bg-status-amber/10 text-status-amber border-status-amber/30'
            }`}>
              {fixUnlabeled ? 'Good (92%)' : 'Drift (38%)'}
            </span>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground bg-muted/40 p-1.5 rounded border border-border/50 flex items-center justify-between">
            <span className="text-muted-foreground">Impact:</span>
            <span className="font-semibold text-status-green">Controls what Copilot can safely see</span>
          </div>
        </div>

        {/* 3. DLP Flow Protection */}
        <div
          onClick={onToggleDLP}
          className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between space-y-1 ${
            resolveDLP
              ? 'bg-status-green/40 border-status-green/60 text-status-green'
              : 'bg-accent/10 border-accent/60 text-accent hover:border-accent'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-3.5 h-3.5 text-accent shrink-0" />
              <span className="text-xs font-extrabold text-foreground">DLP Flow Protection</span>
            </div>
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border uppercase ${
              resolveDLP ? 'bg-status-green text-status-green border-status-green/30' : 'bg-accent text-accent border-accent'
            }`}>
              {resolveDLP ? 'Strong' : 'Weak'}
            </span>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground bg-muted/40 p-1.5 rounded border border-border/50 flex items-center justify-between">
            <span className="text-muted-foreground">Impact:</span>
            <span className="font-semibold text-accent">Controls what Copilot can safely do</span>
          </div>
        </div>

        {/* 4. Privileged Identity Management (PIM) */}
        <div
          onClick={onTogglePIM}
          className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between space-y-1 ${
            removePermanentAdmins
              ? 'bg-status-green/40 border-status-green/60 text-status-green'
              : 'bg-destructive/10/40 border-destructive/60 text-destructive hover:border-destructive'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Key className="w-3.5 h-3.5 text-status-amber shrink-0" />
              <span className="text-xs font-extrabold text-foreground">Privileged Identity (PIM)</span>
            </div>
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border uppercase ${
              removePermanentAdmins ? 'bg-status-green text-status-green border-status-green/30' : 'bg-destructive/10 text-destructive border-destructive/30'
            }`}>
              {removePermanentAdmins ? 'JIT Active' : 'Not Configured'}
            </span>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground bg-muted/40 p-1.5 rounded border border-border/50 flex items-center justify-between">
            <span className="text-muted-foreground">Impact:</span>
            <span className="font-semibold text-status-amber">Limits Copilot admin-level actions</span>
          </div>
        </div>

      </div>

      {/* FOOTER TIP */}
      <div className="p-2 rounded-xl bg-accent/30 border border-accent/40 text-[9.5px] font-mono text-accent flex items-center justify-between shrink-0">
        <span>💡 Click any safeguard above or use simulation strip to test impact</span>
      </div>

    </div>
  );
};
