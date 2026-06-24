import { useState, useImperativeHandle, forwardRef } from "react";

export interface ClosureField {
  id: string;
  label: string;
  type: "text" | "textarea" | "date" | "list" | "url";
  placeholder?: string;
  required?: boolean;
  hint?: string;
}

export interface ChecklistClosureFormHandle {
  getValues: () => Record<string, string | string[]>;
}

interface Props {
  fields: ClosureField[];
}

const inputCls =
  "w-full border border-border rounded-lg px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 bg-[#1C2128] placeholder:text-muted-foreground/60";

const ChecklistClosureForm = forwardRef<ChecklistClosureFormHandle, Props>(
  ({ fields }, ref) => {
    const [values, setValues] = useState<Record<string, string | string[]>>(
      () => {
        const init: Record<string, string | string[]> = {};
        for (const f of fields) {
          init[f.id] = f.type === "list" ? [""] : "";
        }
        return init;
      }
    );

    useImperativeHandle(ref, () => ({
      getValues: () => {
        const clean: Record<string, string | string[]> = {};
        for (const f of fields) {
          if (f.type === "list") {
            clean[f.id] = (values[f.id] as string[]).filter((r) => r.trim());
          } else {
            clean[f.id] = values[f.id] as string;
          }
        }
        return clean;
      },
    }));

    const setStr = (id: string, val: string) =>
      setValues((v) => ({ ...v, [id]: val }));

    const setListRow = (id: string, idx: number, val: string) => {
      setValues((v) => {
        const rows = [...(v[id] as string[])];
        rows[idx] = val;
        return { ...v, [id]: rows };
      });
    };

    const addRow = (id: string) =>
      setValues((v) => ({ ...v, [id]: [...(v[id] as string[]), ""] }));

    const removeRow = (id: string, idx: number) =>
      setValues((v) => {
        const rows = (v[id] as string[]).filter((_, i) => i !== idx);
        return { ...v, [id]: rows.length ? rows : [""] };
      });

    return (
      <div className="space-y-4">
        {fields.map((f) => (
          <div key={f.id}>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              {f.label}
              {f.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>

            {f.type === "text" && (
              <input
                type="text"
                className={inputCls}
                placeholder={f.placeholder ?? ""}
                value={values[f.id] as string}
                onChange={(e) => setStr(f.id, e.target.value)}
              />
            )}

            {f.type === "url" && (
              <input
                type="url"
                className={inputCls}
                placeholder={f.placeholder ?? "https://"}
                value={values[f.id] as string}
                onChange={(e) => setStr(f.id, e.target.value)}
              />
            )}

            {f.type === "date" && (
              <input
                type="date"
                className={inputCls}
                value={values[f.id] as string}
                onChange={(e) => setStr(f.id, e.target.value)}
              />
            )}

            {f.type === "textarea" && (
              <textarea
                className={inputCls + " resize-y min-h-[72px]"}
                placeholder={f.placeholder ?? ""}
                value={values[f.id] as string}
                onChange={(e) => setStr(f.id, e.target.value)}
                rows={3}
              />
            )}

            {f.type === "list" && (
              <div className="space-y-1.5">
                {(values[f.id] as string[]).map((row, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      className={inputCls}
                      placeholder={f.placeholder ?? `Item ${idx + 1}`}
                      value={row}
                      onChange={(e) => setListRow(f.id, idx, e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(f.id, idx)}
                      className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors rounded"
                      title="Remove row"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addRow(f.id)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add item
                </button>
              </div>
            )}

            {f.hint && (
              <p className="text-[10px] text-muted-foreground mt-1">{f.hint}</p>
            )}
          </div>
        ))}
      </div>
    );
  }
);

ChecklistClosureForm.displayName = "ChecklistClosureForm";

export default ChecklistClosureForm;
