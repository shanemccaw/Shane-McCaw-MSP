import React, { useState } from 'react';
import { X, FileText, Download, CheckCircle, Send, Sparkles } from 'lucide-react';

interface SOWModalProps {
  onClose: () => void;
  addToast: (msg: string, type?: 'success' | 'info') => void;
}

export const SOWModal: React.FC<SOWModalProps> = ({ onClose, addToast }) => {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = () => {
    setIsExporting(true);
    setTimeout(() => {
      setIsExporting(false);
      addToast('Statement of Work (SOW.docx) downloaded successfully!', 'success');
      onClose();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in">
      <div className="bg-card border border-border rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl relative my-8">

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-accent/10 text-accent border border-accent/20">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-foreground tracking-tight">Auto-Generated Statement of Work (SOW)</h3>
              <p className="text-xs text-muted-foreground">Microsoft 365 Tenant Remediation & Copilot Alignment</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="py-6 space-y-5 text-xs text-muted-foreground max-h-[60vh] overflow-y-auto pr-2">

          <div className="bg-background p-4 rounded-xl border border-border space-y-2">
            <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
              <span>PROJECT: Contoso M365 Security Hardening</span>
              <span>REF: SOW-2026-M365-092</span>
            </div>
            <div className="font-semibold text-foreground text-sm">
              Prepared for: Contoso IT & Information Security Committee
            </div>
          </div>

          <div>
            <h4 className="font-bold text-foreground text-xs uppercase font-mono tracking-wider mb-2 text-muted-foreground">
              1. Project Objectives
            </h4>
            <p className="leading-relaxed">
              This Statement of Work addresses 4 critical security gaps identified during the live tenant scan, including Global Admin MFA enforcement, Legacy Protocol disabling, Over-privileged App Registration cleanup, and SharePoint Anonymous link restrictions.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-foreground text-xs uppercase font-mono tracking-wider mb-2 text-muted-foreground">
              2. Scope of Deliverables & Timeline
            </h4>
            <div className="space-y-2">
              <div className="p-3 bg-white/5 rounded-lg border border-border flex justify-between items-center">
                <div>
                  <div className="font-bold text-foreground">Phase 1: Admin Identity Hardening</div>
                  <div className="text-[11px] text-muted-foreground">MFA enforcement & Break-glass account policy</div>
                </div>
                <span className="font-mono text-primary">Est. 8 Hours</span>
              </div>

              <div className="p-3 bg-white/5 rounded-lg border border-border flex justify-between items-center">
                <div>
                  <div className="font-bold text-foreground">Phase 2: App & External Sharing Lock-Down</div>
                  <div className="text-[11px] text-muted-foreground">Directory.ReadWrite.All revocation & SharePoint audit</div>
                </div>
                <span className="font-mono text-primary">Est. 12 Hours</span>
              </div>

              <div className="p-3 bg-white/5 rounded-lg border border-border flex justify-between items-center">
                <div>
                  <div className="font-bold text-foreground">Phase 3: Copilot Data Classification & License Right-Sizing</div>
                  <div className="text-[11px] text-muted-foreground">Sensitive label rollout & $12k license waste reclamation</div>
                </div>
                <span className="font-mono text-primary">Est. 16 Hours</span>
              </div>
            </div>
          </div>

          <div className="bg-[hsl(149,36%,49%)]/10 p-4 rounded-xl border border-[hsl(149,36%,49%)]/20 flex justify-between items-center">
            <div>
              <div className="text-[hsl(149,36%,49%)] font-bold">Estimated Financial Impact / Savings</div>
              <div className="text-muted-foreground">Reclaims ~$14.4k/yr in unused E5 license optimization</div>
            </div>
            <div className="text-right font-mono font-bold text-[hsl(149,36%,49%)] text-base">
              +$14,400 / yr
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-border flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-secondary hover:bg-secondary/70 text-xs font-semibold text-muted-foreground"
          >
            Cancel
          </button>

          <div className="flex gap-3">
            <button
              onClick={() => {
                addToast('SOW sent to stakeholder email approval queue', 'info');
                onClose();
              }}
              className="px-4 py-2.5 rounded-xl bg-secondary hover:bg-secondary/70 text-xs font-bold text-foreground flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5 text-primary" />
              Send for Review
            </button>

            <button
              onClick={handleExport}
              disabled={isExporting}
              className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent/90 text-xs font-bold text-accent-foreground flex items-center gap-2 shadow-lg shadow-accent/20"
            >
              <Download className={`w-4 h-4 ${isExporting ? 'animate-bounce' : ''}`} />
              <span>{isExporting ? 'Exporting SOW...' : 'Download SOW (.docx)'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
