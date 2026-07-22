import React, { useState } from 'react';
import { X, Download, FileText, Check, ShieldCheck, Sparkles, Database } from 'lucide-react';

interface ExportReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantName?: string;
}

export const ExportReportModal: React.FC<ExportReportModalProps> = ({
  isOpen,
  onClose,
  tenantName = 'Contoso Global Inc.',
}) => {
  const [format, setFormat] = useState<'pdf' | 'csv' | 'json'>('pdf');
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  if (!isOpen) return null;

  const handleDownload = () => {
    setDownloading(true);
    setTimeout(() => {
      setDownloading(false);
      setDownloaded(true);
      setTimeout(() => {
        setDownloaded(false);
        onClose();
      }, 1500);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#242424] border border-white/10 rounded-xl max-w-md w-full p-6 shadow-2xl relative overflow-hidden flex flex-col gap-4">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#479ef5]/10 border border-[#479ef5]/30 flex items-center justify-center text-[#479ef5]">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#e0e2ea]">Export Assessment Report</h3>
              <p className="text-xs text-[#8a919d]">Tenant: {tenantName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#8a919d] hover:text-[#e0e2ea] p-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Format Selection */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[#8a919d] uppercase tracking-wider block">
            Select Export Format
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'pdf', label: 'Executive PDF', desc: 'Full graphical audit' },
              { id: 'csv', label: 'CSV Telemetry', desc: 'Raw findings table' },
              { id: 'json', label: 'JSON Schema', desc: 'API / SIEM import' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setFormat(item.id as 'pdf' | 'csv' | 'json')}
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                  format === item.id
                    ? 'bg-[#479ef5]/15 border-[#479ef5] text-[#e0e2ea]'
                    : 'bg-[#101419] border-white/5 text-[#8a919d] hover:text-[#e0e2ea]'
                }`}
              >
                <div className="text-xs font-bold mb-0.5">{item.label}</div>
                <div className="text-[10px] text-[#8a919d]">{item.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Included Data Points */}
        <div className="bg-[#101419] p-3 rounded-lg border border-white/5 space-y-1.5 text-xs text-[#c0c7d3]">
          <div className="font-semibold text-[#e0e2ea] mb-1 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#479ef5]" />
            Report Highlights Included
          </div>
          <div className="flex items-center gap-2">
            <Check className="w-3.5 h-3.5 text-[#34d399]" />
            <span>M365 Security Baseline Score (72%)</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="w-3.5 h-3.5 text-[#34d399]" />
            <span>Telemetry Briefing Findings (6 active)</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="w-3.5 h-3.5 text-[#34d399]" />
            <span>Copilot Readiness & Licensing ROI ($4,250/mo)</span>
          </div>
        </div>

        {/* Action button */}
        <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-white/10 text-xs font-medium text-[#c0c7d3] hover:bg-white/5 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading || downloaded}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-[#479ef5] hover:bg-[#388ee0] text-[#001c37] text-xs font-semibold transition-all cursor-pointer shadow-md"
          >
            {downloaded ? (
              <>
                <Check className="w-4 h-4 text-[#001c37]" />
                <span>Downloaded!</span>
              </>
            ) : downloading ? (
              <span>Generating {format.toUpperCase()}...</span>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Download {format.toUpperCase()} Report</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
