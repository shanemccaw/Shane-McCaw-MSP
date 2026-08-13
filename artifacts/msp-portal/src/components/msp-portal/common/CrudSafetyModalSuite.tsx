// @ts-nocheck
import React, { useState, useEffect } from 'react';
import {
  Trash2,
  AlertTriangle,
  ShieldAlert,
  Flame,
  Edit3,
  Plus,
  CheckCircle2,
  X,
  Lock,
  RefreshCw,
  FileText,
  Sparkles,
  Eye,
  EyeOff,
  Building2,
  Check,
  Zap,
  Info,
  Key
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES & CONTRACTS
// ============================================================================

export type DeleteSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface DeleteResourcePayload {
  id: string;
  type: string;
  name: string;
  tenantName?: string;
  severity: DeleteSeverity;
  impactList: string[];
  confirmationCode?: string; // For critical deletions (e.g. "PURGE CONTOSO CORP")
  psaTicketNumber?: string; // For high severity deletions
}

export interface FormFieldConfig {
  name: string;
  label: string;
  type: 'text' | 'select' | 'textarea' | 'checkbox' | 'password';
  placeholder?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
  defaultValue?: any;
  helpText?: string;
  isMonospace?: boolean;
}

export interface DestructiveDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmDelete: (payload: DeleteResourcePayload & { psaticket?: string; dualCustodySigned?: boolean }) => void;
  payload: DeleteResourcePayload;
  className?: string;
}

export interface ResourceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: Record<string, any>) => void;
  mode: 'create' | 'edit';
  entityTitle: string;
  initialData?: Record<string, any>;
  fields: FormFieldConfig[];
  className?: string;
}

// ============================================================================
// COMPONENT 1: DESTRUCTIVE DELETE MODAL (4-TIER SEVERITY SYSTEM)
// ============================================================================

export const DestructiveDeleteModal: React.FC<DestructiveDeleteModalProps> = ({
  isOpen,
  onClose,
  onConfirmDelete,
  payload,
  className,
}) => {
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const [psaTicket, setPsaTicket] = useState('');
  const [mediumCheck, setMediumCheck] = useState(false);
  const [dualCustodyCheck, setDualCustodyCheck] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [snapshotHash, setSnapshotHash] = useState<string>('');

  // Reset state on modal open
  useEffect(() => {
    if (isOpen) {
      setTypedConfirmation('');
      setPsaTicket('');
      setMediumCheck(false);
      setDualCustodyCheck(false);
      setIsDeleting(false);
      // Simulate Pre-Delete Snapshot Hash generation
      const randomHash = Math.random().toString(36).substring(2, 10).toUpperCase();
      setSnapshotHash(`SHA256-${randomHash}`);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const requiredCode = (payload.confirmationCode || `PURGE ${payload.name}`).toUpperCase();
  const isTypedCodeValid = typedConfirmation.trim().toUpperCase() === requiredCode;

  // Validation rules based on Severity Tier
  const canDelete = (() => {
    switch (payload.severity) {
      case 'low':
        return true;
      case 'medium':
        return mediumCheck;
      case 'high':
        return psaTicket.trim().length >= 4;
      case 'critical':
        return isTypedCodeValid && dualCustodyCheck;
      default:
        return false;
    }
  })();

  const handleExecuteDelete = () => {
    if (!canDelete || isDeleting) return;
    setIsDeleting(true);
    setTimeout(() => {
      onConfirmDelete({
        ...payload,
        psaTicketNumber: psaTicket,
        dualCustodySigned: dualCustodyCheck,
      });
      setIsDeleting(false);
    }, 800);
  };

  // Severity visual configurations
  const getSeverityConfig = () => {
    switch (payload.severity) {
      case 'low':
        return {
          title: 'Severity 1: Low Risk (Soft Delete)',
          badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          borderClass: 'border-emerald-500/30',
          bgHeaderClass: 'bg-emerald-950/20',
          icon: <Trash2 className="w-6 h-6 text-emerald-400" />,
          btnClass: 'bg-emerald-600 hover:bg-emerald-500 text-white',
          badgeLabel: 'LOW RISK',
        };
      case 'medium':
        return {
          title: 'Severity 2: Medium Risk (Unlink & Reclaim)',
          badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
          borderClass: 'border-amber-500/30',
          bgHeaderClass: 'bg-amber-950/20',
          icon: <AlertTriangle className="w-6 h-6 text-amber-400" />,
          btnClass: 'bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold',
          badgeLabel: 'MEDIUM RISK',
        };
      case 'high':
        return {
          title: 'Severity 3: High Risk (Production Baseline Deletion)',
          badgeClass: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
          borderClass: 'border-orange-500/40',
          bgHeaderClass: 'bg-orange-950/30',
          icon: <ShieldAlert className="w-6 h-6 text-orange-400" />,
          btnClass: 'bg-orange-600 hover:bg-orange-500 text-white font-bold',
          badgeLabel: 'HIGH RISK',
        };
      case 'critical':
        return {
          title: 'Severity 4: Critical (Irreversible Global Purge)',
          badgeClass: 'bg-red-500/20 text-red-300 border-red-500/50 animate-pulse',
          borderClass: 'border-red-500/60 shadow-[0_0_25px_rgba(239,68,68,0.2)]',
          bgHeaderClass: 'bg-red-950/40',
          icon: <Flame className="w-6 h-6 text-red-500 animate-bounce" />,
          btnClass: 'bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white font-extrabold shadow-lg shadow-red-950/80',
          badgeLabel: 'CRITICAL PURGE',
        };
    }
  };

  const sev = getSeverityConfig();

  return (
    <div className={cn("fixed inset-0 z-50 flex items-center justify-center bg-[#06080d]/85 backdrop-blur-md p-4 animate-in fade-in duration-200", className)}>
      <div className={cn("w-full max-w-xl rounded-2xl border bg-[#0f141c] p-6 shadow-2xl space-y-5 text-slate-100 font-sans relative overflow-hidden", sev.borderClass)}>
        
        {/* Top Header */}
        <div className={cn("flex items-start justify-between p-3.5 rounded-xl border border-white/5", sev.bgHeaderClass)}>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-700/50 shrink-0">
              {sev.icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-tight">{sev.title}</h3>
                <span className={cn("text-[10px] font-mono font-extrabold uppercase px-2 py-0.5 rounded border", sev.badgeClass)}>
                  {sev.badgeLabel}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Target: <strong className="text-white font-mono">{payload.name}</strong> ({payload.type})
                {payload.tenantName && <span className="text-cyan-400 ml-1.5">• {payload.tenantName}</span>}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Pre-Delete Snapshot Status */}
        <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-[#080b10] border border-[#232d3d] text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-slate-300 font-medium">Pre-Delete JSON Snapshot Generated</span>
          </div>
          <span className="font-mono text-[10px] text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800">
            {snapshotHash}
          </span>
        </div>

        {/* Impact Blast Radius Section */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            Blast Radius & Destruction Impact Assessment:
          </label>
          <div className="p-3 rounded-xl bg-[#080b10] border border-[#1f2838] space-y-1.5">
            {payload.impactList && payload.impactList.length > 0 ? (
              payload.impactList.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                  <span className="text-red-400 font-bold">•</span>
                  <span>{item}</span>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-400 italic">No automated blast radius alerts detected for this entity.</p>
            )}
          </div>
        </div>

        {/* Severity Specific Input Guardrails */}
        {payload.severity === 'medium' && (
          <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/30 space-y-2">
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                id="med_check"
                checked={mediumCheck}
                onChange={(e) => setMediumCheck(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-amber-600 bg-slate-900 text-amber-500 focus:ring-0 cursor-pointer"
              />
              <label htmlFor="med_check" className="text-xs text-amber-200 cursor-pointer select-none leading-normal">
                I confirm this resource will be unlinked. A <strong>30-day restore window</strong> is available before permanent purge.
              </label>
            </div>
          </div>
        )}

        {payload.severity === 'high' && (
          <div className="p-3.5 rounded-xl bg-orange-950/20 border border-orange-500/30 space-y-2">
            <label className="block text-xs font-bold text-orange-200">
              Linked PSA Ticket Number (Required for Change Control Audit Log):
            </label>
            <input
              type="text"
              value={psaTicket}
              onChange={(e) => setPsaTicket(e.target.value)}
              placeholder="e.g. PSA-9482"
              className="w-full rounded-xl bg-[#080b10] border border-orange-500/40 p-2.5 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-orange-400"
            />
            <p className="text-[11px] text-slate-400">
              Deletions of production baselines are posted directly to <code className="text-orange-300">/portal/changes</code>.
            </p>
          </div>
        )}

        {payload.severity === 'critical' && (
          <div className="p-3.5 rounded-xl bg-red-950/30 border border-red-500/40 space-y-3">
            <div className="space-y-1">
              <label className="block text-xs font-bold text-red-200">
                To confirm purge, type: <code className="text-white font-extrabold bg-red-950 px-2 py-0.5 rounded border border-red-500/50 font-mono select-all">{requiredCode}</code>
              </label>
              <input
                type="text"
                value={typedConfirmation}
                onChange={(e) => setTypedConfirmation(e.target.value)}
                placeholder={`Type "${requiredCode}" exactly`}
                className="w-full rounded-xl bg-[#080b10] border border-red-500/50 p-2.5 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-red-400 uppercase tracking-wide font-bold"
              />
            </div>

            <div className="flex items-start gap-2.5 pt-1">
              <input
                type="checkbox"
                id="dual_custody"
                checked={dualCustodyCheck}
                onChange={(e) => setDualCustodyCheck(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-red-500 bg-slate-900 text-red-500 focus:ring-0 cursor-pointer"
              />
              <label htmlFor="dual_custody" className="text-xs text-red-200/90 cursor-pointer select-none leading-normal">
                Senior Architect dual-custody verification completed. This action is <strong>IRREVERSIBLE</strong>.
              </label>
            </div>
          </div>
        )}

        {/* Action Footer Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
          <button
            onClick={onClose}
            className="text-xs font-semibold text-slate-400 hover:text-white px-4 py-2.5 rounded-xl hover:bg-slate-800/60 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleExecuteDelete}
            disabled={!canDelete || isDeleting}
            className={cn(
              "text-xs px-5 py-2.5 rounded-xl transition-all shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
              sev.btnClass
            )}
          >
            {isDeleting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : payload.severity === 'critical' ? (
              <Flame className="w-4 h-4 text-amber-300" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            <span>
              {isDeleting
                ? 'Purging Entity...'
                : payload.severity === 'critical'
                ? '🔥 IRREVERSIBLY PURGE RESOURCE'
                : 'Confirm Deletion'}
            </span>
          </button>
        </div>

      </div>
    </div>
  );
};

// ============================================================================
// COMPONENT 2: UNIVERSAL RESOURCE CREATE / UPDATE FORM MODAL
// ============================================================================

export const ResourceFormModal: React.FC<ResourceFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  mode = 'create',
  entityTitle,
  initialData = {},
  fields = [],
  className,
}) => {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      const defaultState: Record<string, any> = {};
      fields.forEach((f) => {
        if (initialData[f.name] !== undefined) {
          defaultState[f.name] = initialData[f.name];
        } else if (f.defaultValue !== undefined) {
          defaultState[f.name] = f.defaultValue;
        } else if (f.type === 'checkbox') {
          defaultState[f.name] = false;
        } else {
          defaultState[f.name] = '';
        }
      });
      setFormData(defaultState);
      setErrors({});
    }
  }, [isOpen, initialData, fields]);

  if (!isOpen) return null;

  const handleInputChange = (fieldName: string, value: any) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
    if (errors[fieldName]) {
      setErrors((prev) => {
        const copy = { ...prev };
        delete copy[fieldName];
        return copy;
      });
    }
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    fields.forEach((f) => {
      if (f.required && (formData[f.name] === undefined || formData[f.name] === '')) {
        errs[f.name] = `${f.label} is required`;
      }
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    onSubmit(formData);
  };

  return (
    <div className={cn("fixed inset-0 z-50 flex items-center justify-center bg-[#06080d]/85 backdrop-blur-md p-4 animate-in fade-in duration-200", className)}>
      <div className="w-full max-w-xl rounded-2xl border border-[#2a3854] bg-[#0f141c] p-6 shadow-2xl space-y-5 text-slate-100 font-sans relative">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#23314a] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#0078d4]/20 border border-[#0078d4]/40 text-[#38BDF8]">
              {mode === 'create' ? <Plus className="w-5 h-5" /> : <Edit3 className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">{entityTitle}</h3>
                <span className={cn(
                  "text-[10px] font-mono font-extrabold uppercase px-2 py-0.5 rounded border",
                  mode === 'create' ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40" : "bg-amber-500/20 text-amber-300 border-amber-500/40"
                )}>
                  {mode === 'create' ? 'CREATE NEW' : 'EDIT CONFIG'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Configure M365 MSP platform resource baseline settings.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Dynamic Form Grid */}
        <form onSubmit={handleSubmit} className="space-y-4 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
          {fields.map((field) => (
            <div key={field.name} className="space-y-1">
              <label className="block text-xs font-bold text-slate-300 flex items-center justify-between">
                <span>
                  {field.label} {field.required && <span className="text-red-400">*</span>}
                </span>
                {errors[field.name] && (
                  <span className="text-[10px] text-red-400 font-normal">{errors[field.name]}</span>
                )}
              </label>

              {/* Text Input */}
              {field.type === 'text' && (
                <input
                  type="text"
                  value={formData[field.name] || ''}
                  onChange={(e) => handleInputChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  className={cn(
                    "w-full rounded-xl bg-[#080b10] border p-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#0078d4]",
                    errors[field.name] ? "border-red-500" : "border-[#23314a]",
                    field.isMonospace && "font-mono text-cyan-300"
                  )}
                />
              )}

              {/* Select Dropdown */}
              {field.type === 'select' && (
                <select
                  value={formData[field.name] || ''}
                  onChange={(e) => handleInputChange(field.name, e.target.value)}
                  className={cn(
                    "w-full rounded-xl bg-[#080b10] border p-2.5 text-xs text-white focus:outline-none focus:border-[#0078d4]",
                    errors[field.name] ? "border-red-500" : "border-[#23314a]"
                  )}
                >
                  <option value="">Select an option...</option>
                  {field.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}

              {/* Textarea */}
              {field.type === 'textarea' && (
                <textarea
                  rows={3}
                  value={formData[field.name] || ''}
                  onChange={(e) => handleInputChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  className={cn(
                    "w-full rounded-xl bg-[#080b10] border p-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#0078d4]",
                    errors[field.name] ? "border-red-500" : "border-[#23314a]"
                  )}
                />
              )}

              {/* Password / Secret Input with Masking Toggle */}
              {field.type === 'password' && (
                <div className="relative">
                  <input
                    type={showPassword[field.name] ? 'text' : 'password'}
                    value={formData[field.name] || ''}
                    onChange={(e) => handleInputChange(field.name, e.target.value)}
                    placeholder={field.placeholder || '••••••••••••••••'}
                    className={cn(
                      "w-full rounded-xl bg-[#080b10] border p-2.5 pr-10 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-[#0078d4]",
                      errors[field.name] ? "border-red-500" : "border-[#23314a]"
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => ({ ...prev, [field.name]: !prev[field.name] }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showPassword[field.name] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              )}

              {/* Checkbox */}
              {field.type === 'checkbox' && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id={field.name}
                    checked={!!formData[field.name]}
                    onChange={(e) => handleInputChange(field.name, e.target.checked)}
                    className="h-4 w-4 rounded border-[#23314a] bg-[#080b10] text-[#0078d4] focus:ring-0 cursor-pointer"
                  />
                  <label htmlFor={field.name} className="text-xs text-slate-300 cursor-pointer select-none">
                    {field.label}
                  </label>
                </div>
              )}

              {field.helpText && (
                <p className="text-[10px] text-slate-400 leading-normal">{field.helpText}</p>
              )}
            </div>
          ))}

          {/* Form Actions Footer */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#23314a]">
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-semibold text-slate-400 hover:text-white px-4 py-2.5 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="text-xs font-bold bg-[#0078d4] hover:bg-[#005a9e] text-white px-5 py-2.5 rounded-xl transition-all shadow-md flex items-center gap-2 cursor-pointer"
            >
              <Zap className="w-4 h-4 text-cyan-300" />
              <span>{mode === 'create' ? '⚡ Create Entity' : '💾 Save Changes'}</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};

