import { useState } from "react";
import {
  Sparkles, Cloud, Bot, Shield, Zap, Server, Users,
  Layout as LayoutIcon, ShieldCheck, Lock, Globe, Settings, FileText,
  BarChart2, Award, Briefcase, Target, Code, Database, Monitor, Cpu,
  BookOpen, MessageSquare, Calendar, Star, Layers, CheckCircle, Clock,
  Trash2, Plus,
  type LucideIcon,
} from "lucide-react";
import ArrayEditor from "../ArrayEditor";
import CategoryPickerDropdown from "../CategoryPickerDropdown";
import type { FieldDef } from "@/lib/productTypeConfig";

export const ICON_MAP: Record<string, LucideIcon> = {
  Cloud, Bot, Shield, Zap, Server, Users, Layout: LayoutIcon, Sparkles,
  ShieldCheck, Lock, Globe, Settings, FileText, BarChart2, Award,
  Briefcase, Target, Code, Database, Monitor, Cpu, BookOpen,
  MessageSquare, Calendar, Star, CheckCircle, Clock, Layers,
};
const ICON_NAMES = Object.keys(ICON_MAP).sort();

export function resolveIcon(name: string | null): LucideIcon {
  if (!name) return Sparkles;
  const pascal = name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return ICON_MAP[pascal] ?? ICON_MAP[name] ?? Sparkles;
}

export interface WorkflowTemplateMeta { id: number; name: string; }

export interface FieldContext {
  fulfillmentTypes: { key: string; label: string }[];
  tenantSignals: { key: string; label: string }[];
  registryEngines: { key: string; label: string }[];
  registryFeatures: { key: string; label: string }[];
  workflowTemplates: WorkflowTemplateMeta[];
  allCategoryPaths: string[];
}

function MultiCheckboxSelect({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (key: string) =>
    onChange(value.includes(key) ? value.filter(k => k !== key) : [...value, key]);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      {options.map(opt => (
        <label key={opt.key} className="flex items-start gap-2 cursor-pointer select-none group">
          <input
            type="checkbox"
            className="mt-0.5 shrink-0 rounded border-border accent-cyan-500"
            checked={value.includes(opt.key)}
            onChange={() => toggle(opt.key)}
          />
          <span className="flex flex-col min-w-0">
            <span className="text-xs text-foreground leading-tight">{opt.label}</span>
            <code className="text-[10px] text-muted-foreground leading-tight">{opt.key}</code>
          </span>
        </label>
      ))}
    </div>
  );
}

function CapabilitiesEditor({
  value,
  onChange,
}: {
  value: Record<string, boolean>;
  onChange: (v: Record<string, boolean>) => void;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(value);
  return (
    <div className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2">
          <code className="text-xs text-muted-foreground flex-1">{k}</code>
          <label className="flex items-center gap-1.5 text-xs text-foreground">
            <input
              type="checkbox"
              checked={v}
              onChange={e => onChange({ ...value, [k]: e.target.checked })}
              className="rounded border-border accent-primary"
            />
            {v ? "Enabled" : "Disabled"}
          </label>
          <button
            type="button"
            onClick={() => {
              const next = { ...value };
              delete next[k];
              onChange(next);
            }}
            className="text-red-400 hover:text-red-300"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}
      <div className="flex gap-2 mt-2">
        <input
          type="text"
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          placeholder="capability key"
          className="flex-1 border border-border rounded-lg px-2 py-1 text-xs bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          disabled={!newKey.trim()}
          onClick={() => {
            if (!newKey.trim()) return;
            onChange({ ...value, [newKey.trim()]: true });
            setNewKey("");
          }}
          className="text-xs border border-border px-2 py-1 rounded-lg hover:bg-accent text-muted-foreground disabled:opacity-40"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function PermissionsArrayEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const entries: { scope: string; reason: string }[] = Array.isArray(value)
    ? (value as { scope: string; reason: string }[]).map(e =>
        e && typeof e === "object"
          ? { scope: String((e as Record<string, unknown>).scope ?? ""), reason: String((e as Record<string, unknown>).reason ?? "") }
          : { scope: "", reason: "" }
      )
    : [];
  const cls = "border border-border rounded-lg px-3 py-2 text-xs bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary";
  const update = (i: number, key: "scope" | "reason", val: string) => {
    const next = entries.map((e, idx) => idx === i ? { ...e, [key]: val } : e);
    onChange(next.length > 0 ? next : null);
  };
  const remove = (i: number) => {
    const next = entries.filter((_, idx) => idx !== i);
    onChange(next.length > 0 ? next : null);
  };
  const add = () => onChange([...entries, { scope: "", reason: "" }]);
  return (
    <div className="space-y-2">
      {entries.map((e, i) => (
        <div key={i} className="flex gap-2 items-start">
          <div className="flex-1 grid grid-cols-2 gap-2">
            <input value={e.scope} onChange={ev => update(i, "scope", ev.target.value)} placeholder="Scope (e.g. User.Read.All)" className={cls} />
            <input value={e.reason} onChange={ev => update(i, "reason", ev.target.value)} placeholder="Reason" className={cls} />
          </div>
          <button type="button" onClick={() => remove(i)} className="text-red-400 hover:text-red-300 mt-2"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      <button type="button" onClick={add} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary">
        <Plus className="w-3.5 h-3.5" />Add permission
      </button>
    </div>
  );
}

interface FieldRendererProps {
  field: FieldDef;
  coreValue: unknown;
  onCoreChange: (val: unknown) => void;
  taValue: unknown;
  onTaChange: (val: unknown) => void;
  ctx: FieldContext;
}

export default function FieldRenderer({ field, coreValue, onCoreChange, taValue, onTaChange, ctx }: FieldRendererProps) {
  const isTA = field.target === "typeAttributes";
  const value = isTA ? taValue : coreValue;
  const onChange = isTA ? onTaChange : onCoreChange;

  const cls = "w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary";

  switch (field.kind) {
    case "text":
      return (
        <input
          type="text"
          value={(value as string | null | undefined) ?? ""}
          onChange={e => onChange(e.target.value || null)}
          placeholder={field.placeholder}
          className={cls}
        />
      );

    case "textarea":
      return (
        <textarea
          rows={4}
          value={(value as string | null | undefined) ?? ""}
          onChange={e => onChange(e.target.value || null)}
          placeholder={field.placeholder}
          className={`${cls} resize-none`}
        />
      );

    case "number":
      return (
        <input
          type="number"
          value={(value as number | null | undefined) ?? ""}
          onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
          placeholder={field.placeholder}
          className={cls}
        />
      );

    case "currency":
      return (
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={(value as string | number | null | undefined) ?? ""}
            onChange={e => onChange(e.target.value === "" ? null : e.target.value)}
            placeholder="0.00"
            className={`${cls} pl-7`}
          />
        </div>
      );

    case "boolean":
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={e => onChange(e.target.checked)}
            className="rounded border-border accent-primary w-4 h-4"
          />
          <span className="text-sm text-foreground">{field.label}</span>
        </label>
      );

    case "select": {
      const staticOpts = field.options ?? [];
      const dynamicOpts =
        field.key === "fulfillmentTypeKey" ? ctx.fulfillmentTypes.map(f => ({ value: f.key, label: f.label })) :
        field.key === "billingType" ? [{ value: "one_time", label: "One-time" }, { value: "recurring_monthly", label: "Monthly" }] :
        staticOpts;
      return (
        <select
          value={(value as string | null | undefined) ?? ""}
          onChange={e => onChange(e.target.value || null)}
          className={cls}
        >
          <option value="">— None —</option>
          {dynamicOpts.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );
    }

    case "multiselect": {
      const staticOpts = field.options ?? [];
      const dynamicOpts =
        field.key === "triggeringSignalKeys" ? ctx.tenantSignals.map(s => ({ value: s.key, label: s.label })) :
        staticOpts;
      const currentArr = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (v: string) =>
        onChange(currentArr.includes(v) ? currentArr.filter(x => x !== v) : [...currentArr, v]);
      if (dynamicOpts.length === 0) {
        return <p className="text-xs text-muted-foreground italic">No options available</p>;
      }
      return (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {dynamicOpts.map(opt => (
            <label key={opt.value} className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 rounded border-border accent-primary"
                checked={currentArr.includes(opt.value)}
                onChange={() => toggle(opt.value)}
              />
              <span className="text-xs text-foreground leading-tight">{opt.label}</span>
            </label>
          ))}
        </div>
      );
    }

    case "jsonb-array": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return <ArrayEditor value={arr} onChange={v => onChange(v)} placeholder={field.placeholder} />;
    }

    case "seat-range": {
      const pair = (value as [number | null, number | null] | null | undefined) ?? [null, null];
      return (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">Min seats</label>
            <input
              type="number"
              min="0"
              value={pair[0] ?? ""}
              onChange={e => onChange([e.target.value === "" ? null : Number(e.target.value), pair[1]])}
              className={cls}
            />
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">Max seats</label>
            <input
              type="number"
              min="0"
              value={pair[1] ?? ""}
              onChange={e => onChange([pair[0], e.target.value === "" ? null : Number(e.target.value)])}
              className={cls}
            />
          </div>
        </div>
      );
    }

    case "engine-picker": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <MultiCheckboxSelect
          options={ctx.registryEngines}
          value={selected}
          onChange={v => onChange(v)}
        />
      );
    }

    case "feature-picker": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <MultiCheckboxSelect
          options={ctx.registryFeatures}
          value={selected}
          onChange={v => onChange(v)}
        />
      );
    }

    case "capabilities-editor": {
      const caps = (value && typeof value === "object" && !Array.isArray(value))
        ? (value as Record<string, boolean>)
        : {};
      return <CapabilitiesEditor value={caps} onChange={v => onChange(v)} />;
    }

    case "icon-picker": {
      return (
        <select
          value={(value as string | null | undefined) ?? ""}
          onChange={e => onChange(e.target.value || null)}
          className={cls}
        >
          <option value="">— None —</option>
          {ICON_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      );
    }

    case "category-path":
      return (
        <CategoryPickerDropdown
          value={(value as string | null | undefined) ?? null}
          onChange={v => onChange(v)}
          allCategoryPaths={ctx.allCategoryPaths}
        />
      );

    case "permissions-array":
      return <PermissionsArrayEditor value={value} onChange={onChange} />;

    default:
      return <p className="text-xs text-muted-foreground italic">Unsupported field kind</p>;
  }
}
