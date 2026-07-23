import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  description?: string;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full px-4 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-lg border shadow-xl transition-all animate-in fade-in slide-in-from-bottom-3 duration-200 ${
            toast.type === 'success'
              ? 'bg-[#18231c] border-[#294c35] text-[#86efac]'
              : toast.type === 'error'
              ? 'bg-[#291618] border-[#532025] text-[#fca5a5]'
              : 'bg-[#1a212d] border-[#2a3d58] text-[#93c5fd]'
          }`}
        >
          {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-[#4ade80]" />}
          {toast.type === 'error' && <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-[#f87171]" />}
          {toast.type === 'info' && <Info className="w-5 h-5 shrink-0 mt-0.5 text-[#60a5fa]" />}
          
          <div className="flex-1 text-sm">
            <p className="font-semibold text-white">{toast.title}</p>
            {toast.description && (
              <p className="text-xs mt-0.5 text-zinc-300">{toast.description}</p>
            )}
          </div>

          <button
            onClick={() => onDismiss(toast.id)}
            className="text-zinc-400 hover:text-white p-0.5 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
