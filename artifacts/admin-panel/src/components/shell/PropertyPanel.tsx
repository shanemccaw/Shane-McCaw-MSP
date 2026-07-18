import { PanelRightClose } from "lucide-react";
import { resolveShownSelection, usePropertyPanel, type PropertySelection } from "./PropertyPanelContext";

// Right-hand collapsible Property Panel — context-sensitive details for
// whatever is selected in the Explorer tree or active in the center tabs.

interface PropertyPanelProps {
  /** Fallback shown when nothing has been explicitly selected. */
  fallback: PropertySelection | null;
  onCollapse: () => void;
}

export default function PropertyPanel({ fallback, onCollapse }: PropertyPanelProps) {
  const { selection } = usePropertyPanel();
  const shown = resolveShownSelection(selection, fallback);

  return (
    <div className="h-full flex flex-col bg-card">
      <div className="flex items-center justify-between pl-3 pr-2 py-2 border-b border-border shrink-0">
        <span className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-widest truncate">
          Properties
        </span>
        <button
          onClick={onCollapse}
          title="Collapse properties"
          className="p-1 rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <PanelRightClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {shown ? (
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 pt-3 pb-2 border-b border-border">
            <p className="text-sm font-semibold text-foreground leading-snug">{shown.title}</p>
            {shown.subtitle && (
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{shown.subtitle}</p>
            )}
          </div>
          <dl className="px-3 py-2">
            {shown.properties.map((prop, i) => (
              <div key={i} className="py-1.5 border-b border-border/50 last:border-b-0">
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground/80 font-medium">
                  {prop.label}
                </dt>
                <dd className={`text-xs text-foreground mt-0.5 break-words ${prop.mono ? "font-mono tabular-nums" : ""}`}>
                  {prop.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center px-6 text-center">
          <p className="text-xs text-muted-foreground/70">
            Select an item in the Explorer to inspect its properties.
          </p>
        </div>
      )}
    </div>
  );
}
