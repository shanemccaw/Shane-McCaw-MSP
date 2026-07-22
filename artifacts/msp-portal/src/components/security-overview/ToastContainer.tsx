import React from 'react';
import { ToastMessage } from '../types';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 space-y-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto bg-[#1e2020]/95 backdrop-blur-md border border-[#479ef5]/30 p-4 rounded-xl shadow-2xl flex items-start gap-3 animate-slide-up text-white"
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-[#40c463] shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-[#a0c9ff] shrink-0 mt-0.5" />
          )}

          <div className="flex-grow">
            <h4 className="font-mono text-xs font-semibold text-[#a0c9ff]">{toast.title}</h4>
            <p className="text-xs text-[#c0c7d3] mt-0.5 font-body">{toast.description}</p>
          </div>

          <button
            onClick={() => onDismiss(toast.id)}
            className="text-[#c0c7d3] hover:text-white p-0.5 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
