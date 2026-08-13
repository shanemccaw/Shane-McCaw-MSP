import React from 'react';
import { CheckCircle2, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  text: string;
  type?: 'success' | 'info';
}

interface ToastProps {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onRemove }) => {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto bg-card border border-border rounded-xl p-3.5 shadow-2xl flex items-center justify-between gap-3 text-xs text-foreground animate-in fade-in slide-in-from-bottom-2"
        >
          <div className="flex items-center gap-2.5">
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-[hsl(149,36%,49%)] flex-shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-primary flex-shrink-0" />
            )}
            <span className="font-medium leading-snug">{toast.text}</span>
          </div>

          <button
            onClick={() => onRemove(toast.id)}
            className="text-muted-foreground hover:text-foreground p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
