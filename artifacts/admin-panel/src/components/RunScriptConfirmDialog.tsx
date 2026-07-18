interface Props {
  scriptTitle: string;
  clientName?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export default function RunScriptConfirmDialog({ scriptTitle, clientName, onConfirm, onCancel, disabled }: Props) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-sm mx-4 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-accent">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-0.5">Confirm Script Run</p>
          <p className="text-sm font-semibold text-foreground">{scriptTitle}</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="rounded-lg bg-background border border-border px-4 py-3 space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 w-20 flex-shrink-0 pt-0.5">Script</span>
              <span className="text-xs text-foreground font-medium leading-snug">{scriptTitle}</span>
            </div>
            {clientName && (
              <div className="flex items-start gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 w-20 flex-shrink-0 pt-0.5">Client</span>
                <span className="text-xs text-foreground font-medium leading-snug">{clientName}</span>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            This will run the script on Azure. The card will move to{" "}
            <span className="text-blue-400 font-semibold">In Progress</span> immediately. You can close the execution panel at any time — the script keeps running and you'll get a notification when it finishes.
          </p>
        </div>
        <div className="flex items-center gap-2 px-5 py-3 border-t border-accent bg-background/40">
          <button
            onClick={onCancel}
            className="flex-1 text-sm font-semibold text-muted-foreground hover:text-foreground border border-border hover:border-muted-foreground/60 rounded-lg px-4 py-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={disabled ? undefined : onConfirm}
            disabled={disabled}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg px-4 py-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-emerald-600"
          >
            {disabled ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Script running…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
                Run Script
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
