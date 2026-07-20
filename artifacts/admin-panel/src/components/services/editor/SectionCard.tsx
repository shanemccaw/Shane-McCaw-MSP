import type { SectionDef } from "@/lib/productTypeConfig";
import FieldRenderer, { type FieldContext } from "./FieldRenderer";

export interface SectionCardProps {
  section: SectionDef;
  ctx: FieldContext;
  getCoreValue: (key: string) => unknown;
  setCoreValue: (key: string, val: unknown) => void;
  getTaValue: (key: string) => unknown;
  setTaValue: (key: string, val: unknown) => void;
}

// Renders one config-driven SectionDef as a card — the single generic renderer
// shared by the shared identity/catalog sections and every per-type field
// component, so section layout stays config-driven, not hardcoded per type.
export default function SectionCard({ section, ctx, getCoreValue, setCoreValue, getTaValue, setTaValue }: SectionCardProps) {
  return (
    <div className="bg-card rounded-xl border border-border p-6 space-y-5">
      <div>
        <h3 className="text-sm font-bold text-foreground">{section.label}</h3>
      </div>
      <div className="space-y-4">
        {section.fields.map(f => (
          <div key={f.key}>
            {f.kind !== "boolean" && (
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">{f.label}</label>
            )}
            {f.hint && <p className="text-xs text-muted-foreground mb-1.5">{f.hint}</p>}
            <FieldRenderer
              field={f}
              coreValue={getCoreValue(f.key)}
              onCoreChange={val => setCoreValue(f.key, val)}
              taValue={getTaValue(f.key)}
              onTaChange={val => setTaValue(f.key, val)}
              ctx={ctx}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
