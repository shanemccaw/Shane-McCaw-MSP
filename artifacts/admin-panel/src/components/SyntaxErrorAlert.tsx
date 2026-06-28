interface SyntaxError {
  line: number;
  column: number;
  message: string;
}

interface SyntaxErrorAlertProps {
  errors: SyntaxError[];
  onDismiss: () => void;
}

export default function SyntaxErrorAlert({ errors, onDismiss }: SyntaxErrorAlertProps) {
  if (errors.length === 0) return null;

  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <p className="text-xs font-semibold text-red-400">
            PowerShell syntax {errors.length === 1 ? "error" : `errors (${errors.length})`} — fix before running
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="text-red-400/60 hover:text-red-400 transition-colors flex-shrink-0"
          title="Dismiss"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <ul className="space-y-1">
        {errors.map((e, i) => (
          <li key={i} className="font-mono text-[11px] text-red-300 leading-snug">
            <span className="text-red-500 font-semibold">Line {e.line}, Col {e.column}:</span>{" "}
            {e.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
