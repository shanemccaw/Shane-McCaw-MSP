import React, { useState } from 'react';
import { X, FileText, Download, CheckCircle2, Shield, Activity, Sparkles } from 'lucide-react';

interface ReportModalProps {
  onClose: () => void;
  addToast: (msg: string, type?: 'success' | 'info') => void;
}

export const ReportModal: React.FC<ReportModalProps> = ({ onClose, addToast }) => {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = () => {
    setIsDownloading(true);
    setTimeout(() => {
      setIsDownloading(false);
      addToast('Monthly_Tenant_Health_Report_2026.pdf exported!', 'success');
      onClose();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in">
      <div className="bg-card border border-border rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl relative my-8">

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-foreground tracking-tight">Monthly Tenant Executive Audit Report</h3>
              <p className="text-xs text-muted-foreground">Comprehensive M365 Security & Copilot Health Summary</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Report Preview */}
        <div className="py-6 space-y-6 text-xs text-muted-foreground max-h-[60vh] overflow-y-auto pr-2">

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-background p-3 rounded-xl border border-border text-center">
              <div className="text-2xl font-extrabold text-foreground font-mono">92%</div>
              <div className="text-[10px] text-muted-foreground uppercase mt-0.5">Tenant Health</div>
            </div>
            <div className="bg-background p-3 rounded-xl border border-border text-center">
              <div className="text-2xl font-extrabold text-destructive font-mono">78%</div>
              <div className="text-[10px] text-muted-foreground uppercase mt-0.5">Security Score</div>
            </div>
            <div className="bg-background p-3 rounded-xl border border-border text-center">
              <div className="text-2xl font-extrabold text-accent font-mono">64%</div>
              <div className="text-[10px] text-muted-foreground uppercase mt-0.5">Copilot Index</div>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-foreground text-xs uppercase font-mono tracking-wider mb-2 text-muted-foreground">
              Executive Key Takeaways
            </h4>
            <ul className="space-y-2">
              <li className="p-3 bg-white/5 rounded-lg border border-border flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[hsl(149,36%,49%)] flex-shrink-0 mt-0.5" />
                <span>Overall tenant health improved by +2.4% over the past 30 days due to automated device compliance enforcement.</span>
              </li>
              <li className="p-3 bg-white/5 rounded-lg border border-border flex items-start gap-2">
                <Shield className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                <span>4 Global Admins still require MFA registration to mitigate active identity threat surface.</span>
              </li>
              <li className="p-3 bg-white/5 rounded-lg border border-border flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
                <span>850 users are fully licensed and eligible for immediate Copilot deployment.</span>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-foreground text-xs uppercase font-mono tracking-wider mb-2 text-muted-foreground">
              Included Appendices in Export
            </h4>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-muted-foreground">
              <div className="bg-background p-2.5 rounded-lg border border-border">✓ Full RBAC Admin Role Roster</div>
              <div className="bg-background p-2.5 rounded-lg border border-border">✓ Shadow IT Application Registry</div>
              <div className="bg-background p-2.5 rounded-lg border border-border">✓ License Reallocation Matrix</div>
              <div className="bg-background p-2.5 rounded-lg border border-border">✓ Intune Device OS Compliance Log</div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-border flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-secondary hover:bg-secondary/70 text-xs font-semibold text-muted-foreground"
          >
            Close
          </button>

          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className="px-6 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-xs font-bold text-primary-foreground flex items-center gap-2 shadow-lg shadow-primary/20"
          >
            <Download className={`w-4 h-4 ${isDownloading ? 'animate-bounce' : ''}`} />
            <span>{isDownloading ? 'Generating PDF...' : 'Download Full PDF Report'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};
