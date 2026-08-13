// @ts-nocheck
import React, { useState } from 'react';
import {
  ShieldAlert,
  Lock,
  X,
  Link2,
  ShieldCheck,
  AlertTriangle,
  Calendar,
  UserCheck,
  FileText,
  Sparkles,
  ChevronRight,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RbdRuleLinkPayload {
  alertId?: string;
  tenantId: string;
  tenantName: string;
  riskNotificationType: string;
  targetResource: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title?: string;
}

export interface SignedRbdRecord {
  rbdCode: string;
  clientUpn: string;
  clientName?: string;
  justification: string;
  reviewWindow: string;
  tenantId: string;
  tenantName: string;
  riskNotificationType: string;
  signedAt: string;
}

export interface RbdAcceptanceAndRuleLinkerProps {
  isOpen: boolean;
  alertPayload: RbdRuleLinkPayload;
  onClose: () => void;
  onConfirmRbd: (record: SignedRbdRecord) => void;
  className?: string;
}

export const RbdAcceptanceAndRuleLinker: React.FC<RbdAcceptanceAndRuleLinkerProps> = ({
  isOpen,
  alertPayload,
  onClose,
  onConfirmRbd,
  className,
}) => {
  const [clientUpn, setClientUpn] = useState('ciso@' + (alertPayload.tenantId ? alertPayload.tenantId.toLowerCase().replace('ten-', '') + '.com' : 'contoso.com'));
  const [clientName, setClientName] = useState('Alex Baker (CISO)');
  const [justification, setJustification] = useState('');
  const [reviewWindow, setReviewWindow] = useState('6_months');
  const [hasAcknowledged, setHasAcknowledged] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleLinkAndConfirm = () => {
    if (!clientUpn || !justification || !hasAcknowledged) return;

    setIsSubmitting(true);
    setTimeout(() => {
      const rbdCode = `RBD-2026-${Math.floor(100 + Math.random() * 900)}`;
      onConfirmRbd({
        rbdCode,
        clientUpn,
        clientName,
        justification,
        reviewWindow,
        tenantId: alertPayload.tenantId,
        tenantName: alertPayload.tenantName,
        riskNotificationType: alertPayload.riskNotificationType,
        signedAt: new Date().toISOString(),
      });
      setIsSubmitting(false);
    }, 600);
  };

  const getBlastRadiusInfo = () => {
    switch (alertPayload.severity) {
      case 'critical':
        return {
          breachIncrease: '42%',
          complianceGap: 'CIS 1.1 & NIST 800-53 Non-Compliance Gap',
          impactRating: 'High Severity Exposure'
        };
      case 'high':
        return {
          breachIncrease: '28%',
          complianceGap: 'ISO 27001 Access Control Deficiency',
          impactRating: 'Elevated Identity Exposure'
        };
      default:
        return {
          breachIncrease: '15%',
          complianceGap: 'Policy Baseline Drift',
          impactRating: 'Moderate Policy Exception'
        };
    }
  };

  const blastRadius = getBlastRadiusInfo();

  return (
    <div className={cn("fixed inset-0 z-50 flex items-center justify-center bg-[#090d16]/80 backdrop-blur-sm p-4 animate-in fade-in duration-200", className)}>
      <div className="w-full max-w-2xl rounded-2xl border border-red-500/40 bg-[#101419] p-6 shadow-2xl space-y-5 text-slate-100 font-sans">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#2a3240] pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Accept Risk & Generate RBD Waiver</span>
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40 font-mono">
                  LIABILITY SHIFT
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Bypassing active remediation shifts legal & financial breach liability directly to the client.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Risk Notification Type Linkage Card */}
        <div className="rounded-xl bg-[#080b12] border border-[#232b38] p-4 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 flex items-center gap-1.5 font-semibold">
              <Link2 className="h-4 w-4 text-cyan-400" />
              Target Risk Notification Rule Signature:
            </span>
            <span className="font-mono text-cyan-300 bg-cyan-950/60 px-2.5 py-0.5 rounded-md border border-cyan-500/30 font-bold">
              {alertPayload.riskNotificationType}
            </span>
          </div>

          <div className="text-xs text-slate-300 flex items-center justify-between pt-1 border-t border-[#1a2230]">
            <div>
              <span className="text-slate-500">Tenant Context:</span> <strong className="text-white">{alertPayload.tenantName}</strong> ({alertPayload.tenantId})
            </div>
            <div>
              <span className="text-slate-500">Target:</span> <code className="text-amber-300 font-mono">{alertPayload.targetResource}</code>
            </div>
          </div>

          {/* Blast Radius Assessment */}
          <div className="mt-2 p-2.5 rounded-lg bg-red-950/20 border border-red-500/20 text-xs space-y-1">
            <div className="flex items-center justify-between font-mono text-[11px] text-red-300 font-bold">
              <span>⚠️ RISK BLAST RADIUS ASSESSMENT:</span>
              <span>+{blastRadius.breachIncrease} Breach Probability</span>
            </div>
            <p className="text-[11px] text-red-200/80">
              {blastRadius.complianceGap}. Accepting this risk leaves {alertPayload.targetResource} unmonitored for this vector.
            </p>
          </div>

          {/* Rule Linking Effect Explanation */}
          <p className="text-[11.5px] text-amber-300/90 bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/20 leading-relaxed">
            ℹ️ <strong>Rule Linkage Automation:</strong> Linking this rule will register an active waiver in the RBD Engine (<code className="text-amber-200 font-mono">/portal/rbd</code>). All future identical <code className="font-mono">{alertPayload.riskNotificationType}</code> notifications for {alertPayload.tenantName} will automatically be tagged as <span className="text-emerald-400 font-bold">COVERED_BY_ACTIVE_RBD</span> and suppressed from escalation queues.
          </p>
        </div>

        {/* Form Inputs */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1 flex items-center gap-1">
                <UserCheck className="w-3.5 h-3.5 text-cyan-400" />
                Client Executive UPN & Name
              </label>
              <input
                type="email"
                value={clientUpn}
                onChange={(e) => setClientUpn(e.target.value)}
                placeholder="ciso@client.com"
                className="w-full rounded-xl bg-[#080b12] border border-[#2d3748] p-2.5 text-xs text-slate-200 focus:border-[#0078d4] focus:outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                Waiver Validity / Review Date
              </label>
              <select
                value={reviewWindow}
                onChange={(e) => setReviewWindow(e.target.value)}
                className="w-full rounded-xl bg-[#080b12] border border-[#2d3748] p-2.5 text-xs text-slate-200 focus:border-[#0078d4] focus:outline-none"
              >
                <option value="3_months">3 Months (Temporary Security Exception)</option>
                <option value="6_months">6 Months (Semi-Annual Governance Cycle)</option>
                <option value="1_year">1 Year (Annual Liability Renewal)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-cyan-400" />
              Business Justification & Compensating Controls
            </label>
            <textarea
              rows={3}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="e.g. Executive requires temporary legacy hardware bypass until Q3 FIDO2 hardware key deployment. Compensating control: Strict IP Whitelisting + Real-time SIEM alerts enabled."
              className="w-full rounded-xl bg-[#080b12] border border-[#2d3748] p-2.5 text-xs text-slate-200 focus:border-[#0078d4] focus:outline-none"
            />
          </div>

          {/* Acknowledgement Checkbox */}
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-red-950/30 border border-red-500/30">
            <input
              type="checkbox"
              id="ack_liability"
              checked={hasAcknowledged}
              onChange={(e) => setHasAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[#404752] bg-[#090d16] text-red-500 focus:ring-0 cursor-pointer"
            />
            <label htmlFor="ack_liability" className="text-xs text-slate-200 leading-normal cursor-pointer select-none">
              <strong className="text-red-400">Legal Acknowledgement:</strong> Client explicitly acknowledges full legal & financial liability for security breaches, ransomware exposure, or compliance penalties resulting from accepting this risk without remediation.
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#2a3240]">
          <button
            onClick={onClose}
            className="text-xs font-semibold text-slate-400 hover:text-white px-4 py-2 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleLinkAndConfirm}
            disabled={!clientUpn || !justification || !hasAcknowledged || isSubmitting}
            className="text-xs font-bold bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl transition-all shadow-lg flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
          >
            <Lock className="h-4 w-4" />
            <span>{isSubmitting ? 'Linking Rule & Logging Waiver...' : '🔒 Log RBD & Link Risk Rule'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};

