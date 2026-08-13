// @ts-nocheck
import React, { useState } from 'react';
import {
  ShieldOff,
  AlertTriangle,
  Link2Off,
  CheckCircle2,
  XCircle,
  Lock,
  UserCheck,
  FileText,
  RotateCcw,
  Sparkles,
  X,
  ChevronRight,
  Zap,
  ShieldAlert,
  Building2,
  Calendar,
  Clock,
  ShieldCheck,
  ArrowRight
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES & CONTRACTS
// ============================================================================

export interface LinkedRiskRule {
  rbdCode: string;
  tenantId: string;
  tenantName: string;
  riskNotificationType: string;
  originalSignerUpn: string;
  signedAt: string;
  reviewDate: string;
  associatedPillar: string;
  targetResource: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description?: string;
}

export interface RevocationPayload {
  rbdCode: string;
  tenantId: string;
  revokedByUpn: string;
  approverUpn: string;
  reasonCategory: string;
  auditNotes: string;
  autoExecuteSop: boolean;
  unlinkedRuleType: string;
  revokedAt: string;
}

export interface RiskRevocationModalProps {
  isOpen: boolean;
  rule: LinkedRiskRule;
  onClose: () => void;
  onConfirmRevocation: (payload: RevocationPayload) => void;
  className?: string;
}

// ============================================================================
// COMPONENT 1: RISK REVOCATION MODAL (<RiskRevocationModal />)
// ============================================================================

export const RiskRevocationModal: React.FC<RiskRevocationModalProps> = ({
  isOpen,
  rule,
  onClose,
  onConfirmRevocation,
  className,
}) => {
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);
  const [reasonCategory, setReasonCategory] = useState<string>('Risk Profile Changed (Compensating Controls Failed)');
  const [auditNotes, setAuditNotes] = useState<string>('');
  const [autoExecuteSop, setAutoExecuteSop] = useState<boolean>(true);
  const [unlinkRule, setUnlinkRule] = useState<boolean>(true);
  const [revokedByUpn, setRevokedByUpn] = useState<string>('lead.engineer@msp-portal.com');
  const [approverUpn, setApproverUpn] = useState<string>('ciso@' + (rule?.tenantId ? rule.tenantId.toLowerCase().replace('ten-', '') + '.com' : 'contoso.com'));
  const [clientNotifiedCheck, setClientNotifiedCheck] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen || !rule) return null;

  const isNotesValid = auditNotes.trim().length >= 15;

  const handleFinalRevoke = () => {
    if (!isNotesValid || !clientNotifiedCheck || !approverUpn || isSubmitting) return;

    setIsSubmitting(true);
    setTimeout(() => {
      onConfirmRevocation({
        rbdCode: rule.rbdCode,
        tenantId: rule.tenantId,
        revokedByUpn,
        approverUpn,
        reasonCategory,
        auditNotes,
        autoExecuteSop,
        unlinkedRuleType: rule.riskNotificationType,
        revokedAt: new Date().toISOString(),
      });
      setIsSubmitting(false);
      onClose();
    }, 700);
  };

  return (
    <div className={cn("fixed inset-0 z-50 flex items-center justify-center bg-[#06080d]/85 backdrop-blur-md p-4 animate-in fade-in duration-200", className)}>
      <div className="w-full max-w-2xl rounded-2xl border border-red-500/40 bg-[#0f141c] p-6 shadow-2xl space-y-5 text-slate-100 font-sans relative">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-red-500/20 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400">
              <ShieldOff className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Revoke Risk Acceptance & Re-Enforce Policy</h3>
                <span className="text-[10px] font-mono font-extrabold uppercase px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40">
                  WAIVER REMOVAL
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Target Waiver: <strong className="text-cyan-300 font-mono">{rule.rbdCode}</strong> ({rule.tenantName})
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Workflow Step Progress Bar */}
        <div className="grid grid-cols-3 gap-2">
          <div
            onClick={() => setActiveStep(1)}
            className={cn(
              "p-2 rounded-xl border text-center cursor-pointer transition-all",
              activeStep === 1
                ? "bg-[#0078d4]/20 border-[#38BDF8] text-white font-bold"
                : "bg-[#080b10] border-[#1e2838] text-slate-400 hover:text-slate-200"
            )}
          >
            <span className="text-[10px] font-mono block text-slate-500">STEP 1</span>
            <span className="text-xs">1. Blast Radius</span>
          </div>

          <div
            onClick={() => setActiveStep(2)}
            className={cn(
              "p-2 rounded-xl border text-center cursor-pointer transition-all",
              activeStep === 2
                ? "bg-[#0078d4]/20 border-[#38BDF8] text-white font-bold"
                : "bg-[#080b10] border-[#1e2838] text-slate-400 hover:text-slate-200"
            )}
          >
            <span className="text-[10px] font-mono block text-slate-500">STEP 2</span>
            <span className="text-xs">2. Reason & Strategy</span>
          </div>

          <div
            onClick={() => isNotesValid && setActiveStep(3)}
            className={cn(
              "p-2 rounded-xl border text-center cursor-pointer transition-all",
              activeStep === 3
                ? "bg-[#0078d4]/20 border-[#38BDF8] text-white font-bold"
                : "bg-[#080b10] border-[#1e2838] text-slate-400 hover:text-slate-200",
              !isNotesValid && "opacity-50 cursor-not-allowed"
            )}
          >
            <span className="text-[10px] font-mono block text-slate-500">STEP 3</span>
            <span className="text-xs">3. Dual-Custody</span>
          </div>
        </div>

        {/* STEP 1: IMPACT & UNLINKING ASSESSMENT */}
        {activeStep === 1 && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="rounded-xl bg-[#080b10] border border-[#232d3d] p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-[#1c2533] pb-2">
                <span className="text-slate-400 flex items-center gap-1.5 font-bold">
                  <Link2Off className="w-4 h-4 text-red-400" />
                  Target Risk Rule Signature To Unlink:
                </span>
                <span className="font-mono text-cyan-300 bg-cyan-950/60 px-2.5 py-0.5 rounded border border-cyan-800 font-bold">
                  {rule.riskNotificationType}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-slate-300">
                <div>
                  <span className="text-slate-500">Tenant:</span> <strong>{rule.tenantName}</strong> ({rule.tenantId})
                </div>
                <div>
                  <span className="text-slate-500">Resource:</span> <code className="text-amber-300 font-mono">{rule.targetResource}</code>
                </div>
                <div>
                  <span className="text-slate-500">Original Signer:</span> <span className="font-mono text-cyan-400">{rule.originalSignerUpn}</span>
                </div>
                <div>
                  <span className="text-slate-500">Associated Governance Pillar:</span> <span className="text-white font-semibold">{rule.associatedPillar}</span>
                </div>
              </div>

              {/* Security Impact Notice */}
              <div className="p-3 rounded-lg bg-red-950/30 border border-red-500/30 text-red-200/90 leading-relaxed">
                <div className="font-bold flex items-center gap-1.5 text-red-400 mb-1">
                  <AlertTriangle className="w-4 h-4" />
                  Security Impact of Revocation:
                </div>
                Revoking waiver <code className="font-mono text-white">{rule.rbdCode}</code> immediately removes immunity for <code className="font-mono text-cyan-300">{rule.riskNotificationType}</code>. Threat alarms will re-activate across the SOC queue, and the tenant compliance score will reflect active drift until remediated.
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setActiveStep(2)}
                className="text-xs font-bold bg-[#0078d4] hover:bg-[#005a9e] text-white px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>Proceed to Reason & Strategy</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: REASON & RE-ENFORCEMENT STRATEGY */}
        {activeStep === 2 && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="space-y-3">
              {/* Reason Category Dropdown */}
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Mandatory Revocation Reason Category <span className="text-red-400">*</span>
                </label>
                <select
                  value={reasonCategory}
                  onChange={(e) => setReasonCategory(e.target.value)}
                  className="w-full rounded-xl bg-[#080b10] border border-[#232d3d] p-2.5 text-xs text-white focus:outline-none focus:border-[#0078d4]"
                >
                  <option value="Risk Profile Changed (Compensating Controls Failed)">Risk Profile Changed (Compensating Controls Failed)</option>
                  <option value="Temporary Exemption Period Expired">Temporary Exemption Period Expired</option>
                  <option value="Client Requested Governance Re-Enforcement">Client Requested Governance Re-Enforcement</option>
                  <option value="Audit / Regulatory Finding (NIST / CIS Non-Compliance)">Audit / Regulatory Finding (NIST / CIS Non-Compliance)</option>
                </select>
              </div>

              {/* Audit Notes Textarea */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <label className="font-bold text-slate-300">
                    Detailed Audit Justification Notes <span className="text-red-400">*</span>
                  </label>
                  <span className={cn("text-[10px] font-mono", isNotesValid ? "text-emerald-400" : "text-amber-400")}>
                    {auditNotes.trim().length} / 15 chars min
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={auditNotes}
                  onChange={(e) => setAuditNotes(e.target.value)}
                  placeholder="e.g. Compensating IP whitelisting failed during quarterly review. Client CISO agreed to terminate waiver and trigger SOP auto-heal..."
                  className={cn(
                    "w-full rounded-xl bg-[#080b10] border p-2.5 text-xs text-white placeholder-slate-600 focus:outline-none",
                    isNotesValid ? "border-[#232d3d] focus:border-[#0078d4]" : "border-amber-500/50"
                  )}
                />
              </div>

              {/* Re-Enforcement Strategy Checkboxes */}
              <div className="p-3.5 rounded-xl bg-[#080b10] border border-[#232d3d] space-y-2.5">
                <div className="text-xs font-bold text-cyan-300 uppercase tracking-wider font-mono">
                  Automated Re-Enforcement Strategy:
                </div>

                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id="auto_sop"
                    checked={autoExecuteSop}
                    onChange={(e) => setAutoExecuteSop(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#232d3d] bg-slate-900 text-[#0078d4] focus:ring-0 cursor-pointer"
                  />
                  <label htmlFor="auto_sop" className="text-xs text-slate-200 cursor-pointer select-none">
                    <strong>Execute SOP Auto-Heal Immediately:</strong> Dispatches Graph API remediation to auto-fix baseline gap upon waiver removal.
                  </label>
                </div>

                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id="unlink_rule"
                    checked={unlinkRule}
                    onChange={(e) => setUnlinkRule(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#232d3d] bg-slate-900 text-[#0078d4] focus:ring-0 cursor-pointer"
                  />
                  <label htmlFor="unlink_rule" className="text-xs text-slate-200 cursor-pointer select-none">
                    <strong>Unlink Rule Signature:</strong> Restores threat alarm triggers for future identical risk notifications across SOC queues.
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setActiveStep(1)}
                className="text-xs text-slate-400 hover:text-white px-3 py-2"
              >
                Back
              </button>
              <button
                onClick={() => isNotesValid && setActiveStep(3)}
                disabled={!isNotesValid}
                className="text-xs font-bold bg-[#0078d4] hover:bg-[#005a9e] disabled:opacity-40 text-white px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>Proceed to Dual-Custody</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: DUAL-CUSTODY APPROVAL & VERIFICATION */}
        {activeStep === 3 && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Revoking Engineer UPN
                </label>
                <input
                  type="text"
                  value={revokedByUpn}
                  onChange={(e) => setRevokedByUpn(e.target.value)}
                  className="w-full rounded-xl bg-[#080b10] border border-[#232d3d] p-2.5 text-xs text-cyan-300 font-mono focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Approving Senior Architect / CISO UPN <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={approverUpn}
                  onChange={(e) => setApproverUpn(e.target.value)}
                  placeholder="ciso@client.com"
                  className="w-full rounded-xl bg-[#080b10] border border-[#232d3d] p-2.5 text-xs text-cyan-300 font-mono focus:outline-none"
                />
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-red-950/30 border border-red-500/30 flex items-start gap-3">
              <input
                type="checkbox"
                id="client_notify"
                checked={clientNotifiedCheck}
                onChange={(e) => setClientNotifiedCheck(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-red-500 bg-slate-900 text-red-500 focus:ring-0 cursor-pointer"
              />
              <label htmlFor="client_notify" className="text-xs text-slate-200 cursor-pointer select-none leading-normal">
                <strong className="text-red-400">Governance Notice:</strong> I verify that the client executive has been formally notified of this risk waiver revocation and that threat monitoring for this rule signature is now active.
              </label>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <button
                onClick={() => setActiveStep(2)}
                className="text-xs text-slate-400 hover:text-white px-3 py-2"
              >
                Back
              </button>
              <button
                onClick={handleFinalRevoke}
                disabled={!clientNotifiedCheck || !approverUpn || isSubmitting}
                className="text-xs font-bold bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl transition-all shadow-lg flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
              >
                <ShieldOff className="w-4 h-4" />
                <span>{isSubmitting ? 'Revoking Waiver & Restoring Rules...' : '🔒 Revoke RBD Waiver & Unlink Rule'}</span>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

// ============================================================================
// COMPONENT 2: ACTIVE RBD CARD WITH REVOKE ACTION (<ActiveRbdWaiverCard />)
// ============================================================================

export interface ActiveRbdWaiverCardProps {
  rule: LinkedRiskRule;
  onOpenRevokeModal: (rule: LinkedRiskRule) => void;
  className?: string;
}

export const ActiveRbdWaiverCard: React.FC<ActiveRbdWaiverCardProps> = ({
  rule,
  onOpenRevokeModal,
  className,
}) => {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[#232d3d] bg-[#0f141c] p-4 shadow-xl space-y-3 font-sans transition-all hover:border-[#0078d4]/50",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-[#1f2838] pb-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold text-white font-mono">{rule.rbdCode}</span>
          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded font-mono font-bold">
            ACTIVE WAIVER
          </span>
        </div>
        <span className="text-[10px] font-mono text-slate-400">
          Review: {rule.reviewDate}
        </span>
      </div>

      <div className="space-y-1">
        <h4 className="text-xs font-bold text-slate-100">{rule.tenantName} ({rule.tenantId})</h4>
        <p className="text-[11px] text-slate-400 leading-tight">
          Linked Signature: <code className="text-cyan-300 font-mono">{rule.riskNotificationType}</code>
        </p>
        <p className="text-[11px] text-slate-400">
          Target: <code className="text-amber-300 font-mono">{rule.targetResource}</code>
        </p>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-[#1f2838]">
        <span className="text-[10px] text-slate-500">
          Signer: {rule.originalSignerUpn}
        </span>

        <button
          onClick={() => onOpenRevokeModal(rule)}
          className="text-xs bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-500/40 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 font-bold cursor-pointer"
        >
          <ShieldOff className="w-3.5 h-3.5 text-red-400" />
          <span>Revoke Waiver</span>
        </button>
      </div>
    </div>
  );
};

