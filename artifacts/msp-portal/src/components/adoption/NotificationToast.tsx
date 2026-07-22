import React, { useEffect } from 'react';
import { CheckCircle2, Info, AlertCircle, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'info' | 'warning';
  title: string;
  message: string;
}

interface NotificationToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({
  toast,
  onDismiss
}) => {
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        onDismiss();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-md w-full animate-in slide-in-from-bottom-5 fade-in duration-300">
      <div className="glass-card p-4 rounded-xl border border-[#479ef5]/40 shadow-2xl bg-[#1e2020] text-white flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#479ef5]/20 flex items-center justify-center text-[#479ef5] shrink-0 mt-0.5">
          {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          {toast.type === 'info' && <Info className="w-4 h-4 text-[#479ef5]" />}
          {toast.type === 'warning' && <AlertCircle className="w-4 h-4 text-amber-400" />}
        </div>

        <div className="flex-1 pr-2">
          <p className="font-headline font-bold text-sm text-white">
            {toast.title}
          </p>
          <p className="font-body text-xs text-[#c0c7d3] mt-0.5 leading-relaxed">
            {toast.message}
          </p>
        </div>

        <button
          onClick={onDismiss}
          className="text-[#8a919d] hover:text-white p-1 rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
