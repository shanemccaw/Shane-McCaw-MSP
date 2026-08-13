import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: ToastMessage; onDismiss: (id: string) => void }> = ({
  toast,
  onDismiss,
}) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-[#ffb4ab] shrink-0" />;
      default:
        return <Info className="w-4 h-4 text-[#479ef5] shrink-0" />;
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-[#1e2020] border border-white/10 rounded-lg shadow-2xl font-mono-tech text-xs text-[#e2e2e2] animate-in slide-in-from-right-5">
      <div className="flex items-center gap-2.5">
        {getIcon()}
        <span>{toast.message}</span>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-[#c0c7d3] hover:text-white p-0.5"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
