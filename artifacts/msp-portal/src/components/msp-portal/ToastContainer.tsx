// @ts-nocheck
import React from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { ToastMessage } from '../types';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`p-3 rounded-md border shadow-2xl flex items-start justify-between gap-2.5 text-xs text-[#e0e2ea] transition-all animate-in slide-in-from-bottom-2 ${
            toast.type === 'success'
              ? 'bg-[#052e16] border-[#166534] text-[#4ade80]'
              : toast.type === 'error'
              ? 'bg-[#450a0a] border-[#991b1b] text-[#ffb4ab]'
              : toast.type === 'warning'
              ? 'bg-[#451a03] border-[#9a3412] text-[#fb923c]'
              : 'bg-[#181c22] border-[#0078d4] text-[#a3c9ff]'
          }`}
        >
          <div className="flex items-start gap-2">
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : toast.type === 'error' ? (
              <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
            ) : toast.type === 'warning' ? (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
            )}

            <div>
              <div className="font-bold">{toast.title}</div>
              <div className="text-[11px] opacity-90">{toast.description}</div>
              <div className="text-[9px] opacity-60 font-mono mt-0.5">{toast.timestamp}</div>
            </div>
          </div>

          <button
            onClick={() => onDismiss(toast.id)}
            className="p-1 hover:opacity-100 opacity-60 transition-opacity"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};

