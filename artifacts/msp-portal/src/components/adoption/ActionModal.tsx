import React, { useState } from 'react';
import { Opportunity, AutomationAction } from './types';
import { X, CheckCircle2, ShieldAlert, Sparkles, Send, ArrowRight } from 'lucide-react';

interface ActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: Opportunity | AutomationAction | null;
  onConfirm: (item: Opportunity | AutomationAction) => void;
}

export const ActionModal: React.FC<ActionModalProps> = ({
  isOpen,
  onClose,
  item,
  onConfirm
}) => {
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen || !item) return null;

  const isOpportunity = 'severity' in item;

  const handleSubmit = () => {
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      onConfirm(item);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
      <div 
        className="glass-card w-full max-w-lg rounded-xl border border-white/15 p-6 shadow-2xl relative bg-[#1e2020] text-white animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#8a919d] hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-[#479ef5]/15 border border-[#479ef5]/30 flex items-center justify-center text-[#479ef5]">
            {isOpportunity ? <ShieldAlert className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
          </div>
          <div>
            <span className="font-mono-data text-[10px] uppercase tracking-wider text-[#479ef5] font-bold">
              {isOpportunity ? 'Tenant Optimization Action' : 'Automation Workflow'}
            </span>
            <h3 className="font-headline text-lg font-bold text-white tracking-tight">
              {item.title}
            </h3>
          </div>
        </div>

        {/* Content Details */}
        <div className="space-y-4 my-4 text-xs font-body">
          {isOpportunity ? (
            <>
              <div className="p-3 bg-[#1a1c1c] rounded-lg border border-white/5 space-y-2">
                <div className="flex justify-between font-mono-data">
                  <span className="text-[#8a919d]">Severity:</span>
                  <span className="font-bold text-[#479ef5]">{item.severity}</span>
                </div>
                <div className="flex justify-between font-mono-data">
                  <span className="text-[#8a919d]">Target Area:</span>
                  <span className="text-white font-medium">{item.department || 'Tenant-wide'}</span>
                </div>
                <div className="flex justify-between font-mono-data">
                  <span className="text-[#8a919d]">Affected Users/Sites:</span>
                  <span className="text-white font-medium">{item.affectedCount || 100}</span>
                </div>
                <div className="flex justify-between font-mono-data">
                  <span className="text-[#8a919d]">Projected ROI:</span>
                  <span className="text-emerald-400 font-bold">{item.impactScore}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono-data text-[#c0c7d3] mb-1">
                  Recommended Action Plan:
                </label>
                <p className="p-3 bg-[#1a1c1c] rounded-lg text-[#e2e2e2] leading-relaxed border border-white/5">
                  {item.recommendedAction}
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="p-3 bg-[#1a1c1c] rounded-lg border border-white/5">
                <p className="text-[#e2e2e2] leading-relaxed mb-2">
                  {item.description}
                </p>
                <div className="font-mono-data text-[11px] text-[#479ef5] flex items-center gap-1.5 pt-2 border-t border-white/5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Targeted dispatch across active Microsoft 365 tenant</span>
                </div>
              </div>
            </>
          )}

          {/* Optional notes */}
          <div>
            <label className="block text-[11px] font-mono-data text-[#8a919d] mb-1">
              Admin Directive Notes (Optional):
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add optional administrative note or target group tag..."
              rows={2}
              className="w-full bg-[#1a1c1c] border border-white/10 rounded-lg p-2.5 text-xs text-white placeholder-[#8a919d] focus:outline-none focus:border-[#479ef5] font-body"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg font-mono-data text-xs text-[#8a919d] hover:text-white transition-colors"
          >
            Cancel
          </button>

          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex items-center gap-2 bg-[#479ef5] hover:bg-[#388de4] text-[#003259] font-bold font-mono-data text-xs px-4 py-2 rounded-lg transition-all active:scale-95 shadow-lg shadow-[#479ef5]/20 disabled:opacity-50"
          >
            {isSubmitting ? (
              <span>Executing...</span>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Confirm & Execute</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
