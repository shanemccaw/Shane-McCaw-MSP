import React from 'react';
import { X, Shield, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';

interface DetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  type?: 'anomaly' | 'risk' | 'policy' | 'generic';
  content?: React.ReactNode;
}

export const DetailModal: React.FC<DetailModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  type = 'generic',
  content,
}) => {
  if (!isOpen) return null;

  const getHeaderIcon = () => {
    switch (type) {
      case 'anomaly':
      case 'risk':
        return <AlertTriangle className="h-5 w-5 text-[#f59e0b]" />;
      case 'policy':
        return <Shield className="h-5 w-5 text-[#479ef5]" />;
      default:
        return <Info className="h-5 w-5 text-[#a0c9ff]" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-lg border border-[#333535] bg-[#1a1c1c] p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#282a2b] pb-4">
          <div className="flex items-center gap-2.5">
            {getHeaderIcon()}
            <div>
              <h3 className="font-display text-base font-semibold text-[#e2e2e2]">
                {title}
              </h3>
              {subtitle && <p className="text-xs text-[#8a919d]">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#8a919d] hover:bg-[#282a2b] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 font-mono text-xs text-[#c0c7d3] space-y-4">
          {content}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-[#282a2b] px-4 py-2 font-mono text-xs font-semibold text-[#e2e2e2] hover:bg-[#333535]"
          >
            Acknowledge & Close
          </button>
        </div>
      </div>
    </div>
  );
};
