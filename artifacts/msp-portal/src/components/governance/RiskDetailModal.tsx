import React, { useState } from 'react';
import { GovernanceRisk, HeatmapCell } from '../types';
import { X, ShieldAlert, Terminal, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';

interface RiskDetailModalProps {
  risk: GovernanceRisk | null;
  cell: HeatmapCell | null;
  onClose: () => void;
  onRemediateSuccess?: () => void;
}

export const RiskDetailModal: React.FC<RiskDetailModalProps> = ({
  risk,
  cell,
  onClose,
  onRemediateSuccess
}) => {
  const [isFixing, setIsFixing] = useState(false);
  const [fixed, setFixed] = useState(false);

  if (!risk && !cell) return null;

  const title = risk ? risk.title : cell ? `Risk Details: ${cell.groupName}` : '';
  const description = risk
    ? risk.description
    : cell
    ? `Group with ${cell.membersCount} members audited ${cell.lastAudited}. High risk concentration detected.`
    : '';

  const priority = risk
    ? risk.priority
    : cell
    ? `${cell.riskLevel.toUpperCase()} RISK`
    : 'AUDIT ALERT';

  const remediationEndpoint = risk
    ? risk.remediationPath || 'PATCH /governance/remediate'
    : `PATCH /groups/${cell?.groupName.toLowerCase()}/remediate`;

  const handleRemediate = () => {
    setIsFixing(true);
    setTimeout(() => {
      setIsFixing(false);
      setFixed(true);
      if (onRemediateSuccess) onRemediateSuccess();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div className="bg-[#1e2020] border border-[#479ef5]/30 w-full max-w-xl rounded-xl p-6 shadow-2xl relative animate-in fade-in zoom-in duration-200">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#8a919d] hover:text-[#e2e2e2] p-1 rounded-lg hover:bg-white/5 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 bg-[#ef4444]/15 border border-[#ef4444]/30 text-[#ef4444] rounded-lg">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <span className="font-mono text-[10px] text-[#ef4444] bg-[#ef4444]/10 border border-[#ef4444]/30 px-2 py-0.5 rounded uppercase font-semibold">
              {priority}
            </span>
            <h3 className="font-headline text-lg font-bold text-[#e2e2e2] mt-1">
              {title}
            </h3>
          </div>
        </div>

        <p className="font-body text-sm text-[#c0c7d3] mb-6 leading-relaxed">
          {description}
        </p>

        {/* Audit Log / Payload Box */}
        <div className="bg-[#0c0f0f] border border-white/5 rounded-lg p-4 font-mono text-xs text-[#479ef5] mb-6 overflow-x-auto">
          <div className="flex justify-between text-[#8a919d] border-b border-white/10 pb-2 mb-2">
            <span className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" />
              POLICY AUDIT TELEMETRY LOG
            </span>
            <span>STATUS: {fixed ? 'REMEDIATED' : 'FLAGGED'}</span>
          </div>
          <pre className="text-[#c0c7d3] text-[11px] leading-relaxed">
            {JSON.stringify(
              {
                tenant_id: 'US-WEST-CORP-409',
                audit_timestamp: new Date().toISOString(),
                risk_category: risk?.category || cell?.category || 'Tenant Policy',
                endpoint: remediationEndpoint,
                impact_level: priority,
                status: fixed ? 'REMEDIATED' : 'REQUIRES_ACTION'
              },
              null,
              2
            )}
          </pre>
        </div>

        {/* Modal Footer Actions */}
        <div className="flex justify-between items-center pt-4 border-t border-white/10">
          <span className="font-mono text-xs text-[#8a919d]">
            AUTHENTICATED ACTION
          </span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 font-mono text-xs text-[#c0c7d3] hover:text-white bg-white/5 hover:bg-white/10 rounded transition-colors"
            >
              Dismiss
            </button>
            <button
              onClick={handleRemediate}
              disabled={isFixing || fixed}
              className={`px-4 py-2 font-mono text-xs font-semibold rounded flex items-center gap-2 transition-all ${
                fixed
                  ? 'bg-[#22c55e]/20 border border-[#22c55e] text-[#22c55e]'
                  : isFixing
                  ? 'bg-[#479ef5]/20 text-[#479ef5]'
                  : 'bg-[#479ef5] text-[#001c37] hover:brightness-110 shadow-[0_0_12px_rgba(71,158,245,0.4)]'
              }`}
            >
              {isFixing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Executing...
                </>
              ) : fixed ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Remediated
                </>
              ) : (
                <>
                  Remediate Risk
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
