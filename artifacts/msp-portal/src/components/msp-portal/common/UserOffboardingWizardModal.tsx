import React, { useState, useEffect } from 'react';
import {
  UserMinus,
  X,
  CheckCircle2,
  ShieldAlert,
  Lock,
  Zap,
  Building2,
  Mail,
  UserCheck,
  Award,
  Layers,
  Sparkles,
  ArrowRight,
  FileCheck
} from 'lucide-react';
import { cn } from '../../lib/utils';

export interface UserOffboardingWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialEmployee?: {
    displayName: string;
    userPrincipalName: string;
    jobTitle?: string;
    department?: string;
    assignedClients?: string[];
  } | null;
  onCompleteOffboarding?: (offboardingDetails: any) => void;
  onShowToast?: (type: 'success' | 'info' | 'warning' | 'error', title: string, description: string) => void;
}

export const UserOffboardingWizardModal: React.FC<UserOffboardingWizardModalProps> = ({
  isOpen,
  onClose,
  initialEmployee,
  onCompleteOffboarding,
  onShowToast,
}) => {
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [wizardTenant, setWizardTenant] = useState('Apex Internal MSP');
  const [wizardTargetUpn, setWizardTargetUpn] = useState('');
  const [wizardTargetName, setWizardTargetName] = useState('');
  const [wizardTargetRole, setWizardTargetRole] = useState('');
  const [wizardPipelineType, setWizardPipelineType] = useState<'standard_user' | 'executive_user'>('standard_user');
  const [wizardManagerUpn, setWizardManagerUpn] = useState('shane.mccaw@apex-msp.io');
  const [wizardOooText, setWizardOooText] = useState('This user has departed. Please direct all technical inquiries to support@apex-msp.io.');
  const [wizardReclaimLicense, setWizardReclaimLicense] = useState(true);
  const [wizardStripGroups, setWizardStripGroups] = useState(true);
  const [isExecuting, setIsExecuting] = useState(false);

  useEffect(() => {
    if (initialEmployee) {
      setWizardTargetUpn(initialEmployee.userPrincipalName);
      setWizardTargetName(initialEmployee.displayName);
      setWizardTargetRole(initialEmployee.jobTitle || 'Technician');
      if (initialEmployee.assignedClients && initialEmployee.assignedClients.length > 0) {
        setWizardTenant(initialEmployee.assignedClients[0]);
      }
    }
  }, [initialEmployee, isOpen]);

  if (!isOpen) return null;

  const handleExecuteOffboarding = () => {
    setIsExecuting(true);
    setTimeout(() => {
      setIsExecuting(false);
      const runId = `RUN-${Date.now().toString().slice(-6)}`;
      
      onShowToast?.(
        'success',
        '7-Step Offboarding Pipeline Dispatched',
        `Sessions revoked, licenses reclaimed, GDAP permissions stripped, & certificate logged for ${wizardTargetUpn || 'Technician'}.`
      );

      if (onCompleteOffboarding) {
        onCompleteOffboarding({
          id: runId,
          targetUserUpn: wizardTargetUpn,
          targetUserName: wizardTargetName,
          tenantName: wizardTenant,
          pipelineType: wizardPipelineType,
          executedAt: new Date().toISOString(),
        });
      }

      onClose();
      setWizardStep(1);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#06080d]/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-[#0d121a] border border-[#23314a] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden text-slate-100 font-sans space-y-4 p-6">
        
        {/* HEADER */}
        <div className="flex items-center justify-between border-b border-[#202b3c] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <UserMinus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <span>Deterministic User Offboarding Wizard</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase">
                  Platform RBAC
                </span>
              </h3>
              <p className="text-xs text-slate-400">Automated 7-step identity revocation &amp; license recovery pipeline.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-[#1a2332] transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* STEP PROGRESS INDICATOR */}
        <div className="flex items-center justify-between text-xs font-mono border-b border-[#202b3c] pb-3 px-1">
          <span className={cn("px-2 py-1 rounded", wizardStep === 1 ? "bg-[#0078d4]/20 text-[#38BDF8] font-bold border border-[#0078d4]/40" : "text-slate-500")}>
            1. Target User
          </span>
          <span className={cn("px-2 py-1 rounded", wizardStep === 2 ? "bg-[#0078d4]/20 text-[#38BDF8] font-bold border border-[#0078d4]/40" : "text-slate-500")}>
            2. Data Handover
          </span>
          <span className={cn("px-2 py-1 rounded", wizardStep === 3 ? "bg-[#0078d4]/20 text-[#38BDF8] font-bold border border-[#0078d4]/40" : "text-slate-500")}>
            3. Licenses &amp; GDAP
          </span>
          <span className={cn("px-2 py-1 rounded", wizardStep === 4 ? "bg-[#0078d4]/20 text-[#38BDF8] font-bold border border-[#0078d4]/40" : "text-slate-500")}>
            4. Execution
          </span>
        </div>

        {/* WIZARD STEP 1: TARGET SELECTION */}
        {wizardStep === 1 && (
          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-300 mb-1 font-bold">Target Tenant Scope *</label>
              <select
                value={wizardTenant}
                onChange={(e) => setWizardTenant(e.target.value)}
                className="w-full bg-[#080b10] border border-[#202b3c] rounded-xl p-2.5 text-white font-mono outline-none focus:border-[#0078d4]"
              >
                <option value="Apex Internal MSP">Apex Internal MSP (Platform Staff)</option>
                <option value="Contoso Corp">Contoso Corp (TEN-CONTOSO)</option>
                <option value="Fabrikam Inc">Fabrikam Inc (TEN-FABRIKAM)</option>
                <option value="Northwind Traders">Northwind Traders (TEN-NORTHWIND)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-bold">Target User Principal Name (UPN) *</label>
              <input
                type="text"
                value={wizardTargetUpn}
                onChange={(e) => setWizardTargetUpn(e.target.value)}
                placeholder="e.g. devon.vance@apex-msp.io"
                className="w-full bg-[#080b10] border border-[#202b3c] rounded-xl p-2.5 text-white font-mono outline-none focus:border-[#0078d4]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 mb-1 font-bold">Display Name</label>
                <input
                  type="text"
                  value={wizardTargetName}
                  onChange={(e) => setWizardTargetName(e.target.value)}
                  placeholder="Devon Vance"
                  className="w-full bg-[#080b10] border border-[#202b3c] rounded-xl p-2.5 text-white outline-none focus:border-[#0078d4]"
                />
              </div>
              <div>
                <label className="block text-slate-300 mb-1 font-bold">Job Title / Role</label>
                <input
                  type="text"
                  value={wizardTargetRole}
                  onChange={(e) => setWizardTargetRole(e.target.value)}
                  placeholder="L1 Helpdesk Engineer"
                  className="w-full bg-[#080b10] border border-[#202b3c] rounded-xl p-2.5 text-white outline-none focus:border-[#0078d4]"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-bold">Pipeline Security Protocol Tier</label>
              <select
                value={wizardPipelineType}
                onChange={(e) => setWizardPipelineType(e.target.value as any)}
                className="w-full bg-[#080b10] border border-[#202b3c] rounded-xl p-2.5 text-white font-mono outline-none focus:border-[#0078d4]"
              >
                <option value="standard_user">Standard User Offboarding Pipeline</option>
                <option value="executive_user">Executive / High-Privilege GDAP Admin Offboarding</option>
              </select>
            </div>
          </div>
        )}

        {/* WIZARD STEP 2: DATA HANDOVER */}
        {wizardStep === 2 && (
          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-300 mb-1 font-bold">Designated Delegate Manager UPN *</label>
              <input
                type="text"
                value={wizardManagerUpn}
                onChange={(e) => setWizardManagerUpn(e.target.value)}
                placeholder="shane.mccaw@apex-msp.io"
                className="w-full bg-[#080b10] border border-[#202b3c] rounded-xl p-2.5 text-white font-mono outline-none focus:border-[#0078d4]"
              />
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-bold">Auto-Responder OOO Message (Exchange Online)</label>
              <textarea
                rows={3}
                value={wizardOooText}
                onChange={(e) => setWizardOooText(e.target.value)}
                className="w-full bg-[#080b10] border border-[#202b3c] rounded-xl p-2.5 text-white text-xs outline-none focus:border-[#0078d4]"
              />
            </div>

            <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-500/30 text-cyan-200 text-xs">
              <strong>Data Handover Protocol:</strong> Converts Exchange mailbox to Shared Mailbox, sets FullAccess delegation for manager, &amp; transfers OneDrive Secondary MySite Admin.
            </div>
          </div>
        )}

        {/* WIZARD STEP 3: LICENSES & GDAP */}
        {wizardStep === 3 && (
          <div className="space-y-3 text-xs">
            <label className="flex items-start gap-3 p-3 bg-[#080b10] rounded-xl border border-[#202b3c] cursor-pointer hover:border-[#0078d4]">
              <input
                type="checkbox"
                checked={wizardReclaimLicense}
                onChange={(e) => setWizardReclaimLicense(e.target.checked)}
                className="mt-0.5 rounded bg-[#06080e]"
              />
              <div>
                <div className="font-bold text-white">Reclaim M365 Business Premium &amp; Entra P2 SKUs</div>
                <div className="text-slate-400 text-[11px] mt-0.5">Removes paid subscriptions immediately to credit billing ledger.</div>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 bg-[#080b10] rounded-xl border border-[#202b3c] cursor-pointer hover:border-[#0078d4]">
              <input
                type="checkbox"
                checked={wizardStripGroups}
                onChange={(e) => setWizardStripGroups(e.target.checked)}
                className="mt-0.5 rounded bg-[#06080e]"
              />
              <div>
                <div className="font-bold text-white">Revoke GDAP Delegated Roles &amp; Security Groups</div>
                <div className="text-slate-400 text-[11px] mt-0.5">Strips GDAP Global Admin, Exchange Admin, &amp; internal tech roles across all tenants.</div>
              </div>
            </label>
          </div>
        )}

        {/* WIZARD STEP 4: CONFIRMATION */}
        {wizardStep === 4 && (
          <div className="space-y-3 text-xs bg-[#080b10] p-4 rounded-xl border border-[#202b3c]">
            <div className="font-bold text-amber-300 flex items-center gap-1.5 text-sm">
              <Zap className="w-4 h-4 text-amber-400" />
              <span>Ready to Execute 7-Step Deterministic Pipeline:</span>
            </div>
            <ul className="space-y-1.5 text-slate-300 font-mono text-[11px]">
              <li className="flex justify-between border-b border-[#1f2a3c] pb-1">
                <span className="text-slate-400">Target UPN:</span>
                <strong className="text-white">{wizardTargetUpn || 'devon.vance@apex-msp.io'}</strong>
              </li>
              <li className="flex justify-between border-b border-[#1f2a3c] pb-1">
                <span className="text-slate-400">Target Tenant Scope:</span>
                <strong className="text-white">{wizardTenant}</strong>
              </li>
              <li className="flex justify-between border-b border-[#1f2a3c] pb-1">
                <span className="text-slate-400">Delegate Manager:</span>
                <strong className="text-white">{wizardManagerUpn}</strong>
              </li>
              <li className="flex justify-between border-b border-[#1f2a3c] pb-1">
                <span className="text-slate-400">Pipeline Tier:</span>
                <strong className="text-amber-300 uppercase">{wizardPipelineType}</strong>
              </li>
              <li className="flex justify-between border-b border-[#1f2a3c] pb-1">
                <span className="text-slate-400">Reclaim Paid Licenses:</span>
                <strong className="text-emerald-400">{wizardReclaimLicense ? 'YES' : 'NO'}</strong>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-400">Revoke GDAP Admin Roles:</span>
                <strong className="text-emerald-400">{wizardStripGroups ? 'YES' : 'NO'}</strong>
              </li>
            </ul>
          </div>
        )}

        {/* FOOTER BUTTONS */}
        <div className="flex items-center justify-between pt-3 border-t border-[#202b3c]">
          {wizardStep > 1 ? (
            <button
              onClick={() => setWizardStep((s) => (s - 1) as any)}
              className="bg-[#181c22] hover:bg-[#202836] text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Back
            </button>
          ) : <div />}

          {wizardStep < 4 ? (
            <button
              onClick={() => setWizardStep((s) => (s + 1) as any)}
              className="bg-[#0078d4] hover:bg-[#0060ab] text-white px-5 py-2 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1.5 shadow-md"
            >
              <span>Next Step</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={handleExecuteOffboarding}
              disabled={isExecuting}
              className="bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white px-5 py-2 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1.5 shadow-lg"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{isExecuting ? 'Executing 7-Step Pipeline...' : '🔥 Execute Deterministic Offboarding'}</span>
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
