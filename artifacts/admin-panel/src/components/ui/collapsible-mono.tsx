import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, icon, defaultOpen = false, badge, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-700/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-background hover:bg-gray-800/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
          <span className="text-blue-400">{icon}</span>
          {title}
          {badge && (
            <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-blue-500/20 text-blue-300 rounded-full border border-blue-500/30">
              {badge}
            </span>
          )}
        </div>
        {open
          ? <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
          : <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
        }
      </button>
      {open && (
        <div className="px-4 py-3 bg-background/60 border-t border-gray-700/50">
          {children}
        </div>
      )}
    </div>
  );
}

export function MonoPre({ text }: { text: string }) {
  return (
    <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap leading-relaxed bg-card rounded-lg p-3 overflow-auto max-h-80">
      {text}
    </pre>
  );
}
