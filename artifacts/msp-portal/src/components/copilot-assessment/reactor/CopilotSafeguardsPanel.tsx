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
    <div className="bg-[#090714] border border-white/10 rounded-2xl p-3.5 space-y-3 flex flex-col justify-between h-full select-none overflow-hidden">
      
      {/* HEADER */}
      <div className="flex items-center justify-between pb-2 border-b border-white/10 shrink-0">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
            <ShieldCheck className="w-3.5 h-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-black uppercase tracking-wider text-white">
              Copilot Safeguards & Guardrails
            </h4>
            <p className="text-[9.5px] text-slate-400">
              Readiness Controls • Impact Metrics
            </p>
          </div>
        </div>
        <span className={`text-[9px] font-mono px-2 py-0.5 rounded border font-bold uppercase ${
          blockersCount > 0
            ? 'bg-rose-950/90 text-rose-300 border-rose-800'
            : 'bg-emerald-950 text-emerald-300 border-emerald-800'
        }`}>
          {blockersCount > 0 ? `${blockersCount} Blockers Active` : 'All Enforced'}
        </span>
      </div>

      {/* BIG RISK AMPLIFIER CALLOUT (TOP OF PANEL) */}
      <div className="shrink-0">
        <div className={`p-3 rounded-xl border text-[11px] font-mono space-y-1 shadow-lg ${
          riskAmplifierSeverity === 'Critical'
            ? 'bg-rose-950/90 border-rose-500/80 text-rose-100 shadow-[0_0_15px_rgba(244,63,94,0.25)]'
            : riskAmplifierSeverity === 'High'
            ? 'bg-amber-950/90 border-amber-500/80 text-amber-100'
            : 'bg-emerald-950/90 border-emerald-500/80 text-emerald-100'
        }`}>
          <div className="flex items-center space-x-2 font-extrabold uppercase text-[10px]">
            {riskAmplifierSeverity === 'Critical' ? (
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            ) : riskAmplifierSeverity === 'High' ? (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span className={
              riskAmplifierSeverity === 'Critical' ? 'text-rose-300' :
              riskAmplifierSeverity === 'High' ? 'text-amber-300' : 'text-emerald-300'
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
              ? 'bg-emerald-950/40 border-emerald-500/60 text-emerald-200'
              : 'bg-rose-950/40 border-rose-500 text-rose-200 hover:border-rose-400'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Lock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="text-xs font-extrabold text-white">CA01 Conditional Access</span>
            </div>
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border uppercase ${
              tightenCA01 ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-rose-950 text-rose-300 border-rose-800'
            }`}>
              {tightenCA01 ? 'Enforced' : 'Not Enforced'}
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-300 bg-black/40 p-1.5 rounded border border-white/5 flex items-center justify-between">
            <span className="text-slate-400">Impact:</span>
            <span className="font-semibold text-sky-300">Reduces identity blast radius</span>
          </div>
        </div>

        {/* 2. Sensitivity Label Coverage */}
        <div
          onClick={onToggleUnlabeled}
          className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between space-y-1 ${
            fixUnlabeled
              ? 'bg-emerald-950/40 border-emerald-500/60 text-emerald-200'
              : 'bg-amber-950/40 border-amber-500/60 text-amber-200 hover:border-amber-400'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <FileCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-xs font-extrabold text-white">Sensitivity Label Coverage</span>
            </div>
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border uppercase ${
              fixUnlabeled ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-amber-950 text-amber-300 border-amber-800'
            }`}>
              {fixUnlabeled ? 'Good (92%)' : 'Drift (38%)'}
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-300 bg-black/40 p-1.5 rounded border border-white/5 flex items-center justify-between">
            <span className="text-slate-400">Impact:</span>
            <span className="font-semibold text-emerald-300">Controls what Copilot can safely see</span>
          </div>
        </div>

        {/* 3. DLP Flow Protection */}
        <div
          onClick={onToggleDLP}
          className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between space-y-1 ${
            resolveDLP
              ? 'bg-emerald-950/40 border-emerald-500/60 text-emerald-200'
              : 'bg-purple-950/40 border-purple-500/60 text-purple-200 hover:border-purple-400'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              <span className="text-xs font-extrabold text-white">DLP Flow Protection</span>
            </div>
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border uppercase ${
              resolveDLP ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-purple-950 text-purple-300 border-purple-800'
            }`}>
              {resolveDLP ? 'Strong' : 'Weak'}
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-300 bg-black/40 p-1.5 rounded border border-white/5 flex items-center justify-between">
            <span className="text-slate-400">Impact:</span>
            <span className="font-semibold text-purple-300">Controls what Copilot can safely do</span>
          </div>
        </div>

        {/* 4. Privileged Identity Management (PIM) */}
        <div
          onClick={onTogglePIM}
          className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between space-y-1 ${
            removePermanentAdmins
              ? 'bg-emerald-950/40 border-emerald-500/60 text-emerald-200'
              : 'bg-rose-950/40 border-rose-500/60 text-rose-200 hover:border-rose-400'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-xs font-extrabold text-white">Privileged Identity (PIM)</span>
            </div>
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border uppercase ${
              removePermanentAdmins ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-rose-950 text-rose-300 border-rose-800'
            }`}>
              {removePermanentAdmins ? 'JIT Active' : 'Not Configured'}
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-300 bg-black/40 p-1.5 rounded border border-white/5 flex items-center justify-between">
            <span className="text-slate-400">Impact:</span>
            <span className="font-semibold text-amber-300">Limits Copilot admin-level actions</span>
          </div>
        </div>

      </div>

      {/* FOOTER TIP */}
      <div className="p-2 rounded-xl bg-purple-950/30 border border-purple-800/40 text-[9.5px] font-mono text-purple-300 flex items-center justify-between shrink-0">
        <span>💡 Click any safeguard above or use simulation strip to test impact</span>
      </div>

    </div>
  );
};
