import React from 'react';
import { UI_ARCHITECTURE_SPEC_DOCUMENT } from './assessmentData';
import { X, Copy, Check, FileText } from 'lucide-react';

interface ArchitectureDocModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ArchitectureDocModal: React.FC<ArchitectureDocModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = React.useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(UI_ARCHITECTURE_SPEC_DOCUMENT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#161616] border border-[#2D2D2D] rounded-xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-[#2D2D2D] flex items-center justify-between bg-[#161616] shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-md text-[#0078D4]">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Copilot Assessment UI Architecture Specification</h2>
              <p className="text-xs text-[#A1A1A1]">Deterministic 4-region layout, navigation model, and component hierarchy</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopy}
              className="flex items-center space-x-1.5 bg-[#2D2D2D] hover:bg-[#3D3D3D] text-[#E1E1E1] border border-[#444444] px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? "Copied Spec!" : "Copy Architecture Doc"}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-[#A1A1A1] hover:text-white hover:bg-[#2D2D2D] rounded transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Specification Document Body */}
        <div className="flex-1 p-6 overflow-y-auto font-mono text-xs text-[#CCCCCC] bg-[#0A0A0A] whitespace-pre-wrap leading-relaxed select-text">
          {UI_ARCHITECTURE_SPEC_DOCUMENT}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#2D2D2D] bg-[#161616] flex justify-between items-center shrink-0 text-xs">
          <span className="text-[#888888] font-mono">Format: Structured Architecture Spec (Markdown)</span>
          <button
            onClick={onClose}
            className="bg-[#0078D4] hover:bg-[#0086F0] text-white font-bold px-5 py-1.5 rounded-md text-xs transition-colors cursor-pointer"
          >
            Close Document
          </button>
        </div>
      </div>
    </div>
  );
};
