// @ts-nocheck
import React, { useState } from 'react';
import { Sparkles, Play, AlertTriangle, ShieldCheck, FileCode, Users, Laptop, Zap, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChangeControlGateModal } from './ChangeControlGate';

export interface AiRemediationCopilotProps {
  title?: string;
  rootCause: string;
  impactAssessment: {
    usersAffected: number;
    devicesAffected: number;
    description: string;
  };
  remediationPayload: Record<string, any>;
  targetEndpoint: string;
  tenantName: string;
  onExecuteRemediation: (psaTicketRef: string, justification: string) => void;
  className?: string;
}

export const AiRemediationCopilot: React.FC<AiRemediationCopilotProps> = ({
  title = 'AI Remediation Recommendation',
  rootCause,
  impactAssessment,
  remediationPayload,
  targetEndpoint,
  tenantName,
  onExecuteRemediation,
  className
}) => {
  const [showGateModal, setShowGateModal] = useState(false);
  const [isExecuted, setIsExecuted] = useState(false);

  const payloadJsonString = JSON.stringify(remediationPayload, null, 2);
  const beforeStateMock = JSON.stringify(
    {
      status: 'drifted',
      securitySetting: 'Disabled',
      enforcement: 'None',
      lastScan: new Date().toISOString()
    },
    null,
    2
  );

  const handleGateApproved = (psaTicketRef: string, justification: string) => {
    setIsExecuted(true);
    onExecuteRemediation(psaTicketRef, justification);
  };

  return (
    <div
      className={cn(
        'p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-purple-950/40 via-[#131927] to-[#182235] border border-purple-500/30 shadow-xl space-y-4 text-slate-100 relative overflow-hidden',
        className
      )}
    >
      {/* GLOWING ACCENT TOP BANNER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-purple-500/20">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-400/30 shadow-inner">
            <Sparkles className="w-3.5 h-3.5 text-purple-300 animate-spin-slow" />
            ✨ AI Suggested Remediation
          </span>
          <span className="text-xs text-slate-400">Target: <strong className="text-purple-200">{tenantName}</strong></span>
        </div>

        {isExecuted && (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-950/80 px-2.5 py-0.5 rounded-full border border-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Remediation Executed
          </span>
        )}
      </div>

      {/* SECTION 1: PLAIN-ENGLISH ROOT CAUSE */}
      <div className="space-y-1">
        <h4 className="text-xs font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-purple-400" />
          1. Plain-English Root Cause
        </h4>
        <p className="text-xs text-slate-200 leading-relaxed bg-[#182235]/80 p-3 rounded-xl border border-purple-900/30">
          {rootCause}
        </p>
      </div>

      {/* SECTION 2: IMPACT ASSESSMENT & BLAST RADIUS */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
          <Zap className="w-4 h-4 text-amber-400" />
          2. Blast Radius & User Impact Assessment
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-400 shrink-0" />
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-bold">Affected Users</p>
              <p className="text-xs font-bold text-white">{impactAssessment.usersAffected} Identities</p>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center gap-2">
            <Laptop className="w-4 h-4 text-blue-400 shrink-0" />
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-bold">Affected Devices</p>
              <p className="text-xs font-bold text-white">{impactAssessment.devicesAffected} Endpoints</p>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-bold">Risk Severity</p>
              <p className="text-xs font-bold text-emerald-300">Auto-Fix Eligible</p>
            </div>
          </div>
        </div>
        <p className="text-[11px] text-slate-300 italic px-1">
          {impactAssessment.description}
        </p>
      </div>

      {/* SECTION 3: EXECUTABLE ACTION PAYLOAD */}
      <div className="space-y-2 pt-1 border-t border-purple-500/20">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
            <FileCode className="w-4 h-4 text-cyan-400" />
            3. Executable Remediation Action Payload
          </h4>
          <span className="text-[10px] font-mono text-slate-400">{targetEndpoint}</span>
        </div>

        <div className="p-3 rounded-xl bg-slate-950 border border-purple-900/40 text-purple-200 font-mono text-[11px] max-h-36 overflow-y-auto custom-scrollbar">
          <pre className="whitespace-pre-wrap">{payloadJsonString}</pre>
        </div>

        {/* BOLD EXECUTE REMEDIATION BUTTON */}
        <button
          onClick={() => setShowGateModal(true)}
          disabled={isExecuted}
          className={cn(
            'w-full py-3 px-4 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 transition-all shadow-lg cursor-pointer mt-2',
            isExecuted
              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800 cursor-not-allowed'
              : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-purple-600/30'
          )}
        >
          <Play className="w-4 h-4 fill-current" />
          <span>{isExecuted ? 'AI Remediation Successfully Applied' : '▶️ Execute AI Remediation (Gated Change Control)'}</span>
        </button>
      </div>

      {/* CHANGE CONTROL MODAL */}
      <ChangeControlGateModal
        isOpen={showGateModal}
        onClose={() => setShowGateModal(false)}
        actionTitle={title}
        targetEndpoint={targetEndpoint}
        targetTenantName={tenantName}
        beforeStateJson={beforeStateMock}
        proposedStateJson={payloadJsonString}
        onApproveAndExecute={handleGateApproved}
      />
    </div>
  );
};

