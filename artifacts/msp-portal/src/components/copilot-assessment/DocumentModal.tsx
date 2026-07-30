import React, { useState } from 'react';
import { DocumentDeliverable } from './types';
import { 
  X, 
  Download, 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2, 
  FileText, 
  Share2,
  Printer
} from 'lucide-react';

interface DocumentModalProps {
  document: DocumentDeliverable | null;
  onClose: () => void;
}

export const DocumentModal: React.FC<DocumentModalProps> = ({ document, onClose }) => {
  if (!document) return null;

  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({ 0: true, 1: true, 2: true });
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const toggleSection = (idx: number) => {
    setExpandedSections(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const handleExport = () => {
    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#161616] border border-[#2D2D2D] rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl space-y-6 p-6 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#2D2D2D] pb-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-mono bg-[#0078D4]/20 text-[#0078D4] border border-[#0078D4]/40 px-2 py-0.5 rounded font-semibold uppercase">
                {document.type}
              </span>
              <span className="text-xs text-[#888888] font-mono">{document.readTime}</span>
            </div>
            <h2 className="text-xl font-bold text-white">{document.title}</h2>
            <p className="text-xs text-[#A1A1A1]">{document.description}</p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-[#A1A1A1] hover:text-white hover:bg-[#2D2D2D] rounded transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sections List */}
        <div className="space-y-3">
          {document.sections.map((sec, idx) => {
            const isExpanded = expandedSections[idx] ?? true;

            return (
              <div
                key={idx}
                className="bg-[#111111] border border-[#2D2D2D] rounded-lg overflow-hidden transition-colors"
              >
                <button
                  onClick={() => toggleSection(idx)}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-[#1A1A1A] transition-colors cursor-pointer"
                >
                  <span className="text-sm font-bold text-[#E1E1E1]">{sec.heading}</span>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-[#A1A1A1]" /> : <ChevronDown className="w-4 h-4 text-[#A1A1A1]" />}
                </button>

                {isExpanded && (
                  <div className="p-4 pt-0 space-y-4 border-t border-[#1F1F1F]">
                    <p className="text-xs text-[#CCCCCC] leading-relaxed pt-3">
                      {sec.content}
                    </p>

                    {sec.stats && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
                        {sec.stats.map((st, sIdx) => (
                          <div key={sIdx} className="bg-[#1F1F1F] p-3 rounded-md border border-[#2D2D2D]">
                            <span className="text-[10px] text-[#888888] block font-mono">{st.label}</span>
                            <span className="text-sm font-bold text-[#0078D4] font-mono">{st.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Modal Footer & Export Button */}
        <div className="flex items-center justify-between border-t border-[#2D2D2D] pt-4">
          <div className="text-xs text-[#888888] font-mono">
            Format: Enterprise PDF / Board Briefing
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={handleExport}
              className="flex items-center space-x-2 bg-[#0078D4] hover:bg-[#0086F0] text-white font-bold px-4 py-2 rounded-md text-xs transition-all shadow-md cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>{downloadSuccess ? "Downloaded PDF!" : "Export Deliverable"}</span>
            </button>

            <button
              onClick={onClose}
              className="bg-[#2D2D2D] hover:bg-[#3D3D3D] text-[#E1E1E1] px-4 py-2 rounded-md text-xs font-semibold cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
