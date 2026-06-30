import { useState, useRef } from "react";
import { ChevronUp, ChevronDown, Trash2, Plus } from "lucide-react";

interface Props {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function ArrayEditor({ value, onChange, placeholder = "Add item…", disabled }: Props) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function add() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...value, trimmed]);
    setDraft("");
    inputRef.current?.focus();
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function move(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= value.length) return;
    const arr = [...value];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    onChange(arr);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      add();
    }
  }

  return (
    <div className="space-y-1.5">
      {value.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5 group">
          <div className="flex flex-col gap-0.5 flex-shrink-0">
            <button type="button" onClick={() => move(i, -1)} disabled={disabled || i === 0}
              className="text-[#484F58] hover:text-[#E6EDF3] disabled:opacity-30 transition-colors">
              <ChevronUp className="w-3 h-3" />
            </button>
            <button type="button" onClick={() => move(i, 1)} disabled={disabled || i === value.length - 1}
              className="text-[#484F58] hover:text-[#E6EDF3] disabled:opacity-30 transition-colors">
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>
          <input
            type="text"
            value={item}
            disabled={disabled}
            onChange={e => {
              const arr = [...value];
              arr[i] = e.target.value;
              onChange(arr);
            }}
            className="flex-1 border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-1 focus:ring-[#0078D4] disabled:opacity-50"
          />
          <button type="button" onClick={() => remove(i)} disabled={disabled}
            className="flex-shrink-0 text-[#484F58] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-30">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <div className="w-5 flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className="flex-1 border border-dashed border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs bg-transparent text-[#E6EDF3] placeholder-[#484F58] focus:outline-none focus:ring-1 focus:ring-[#0078D4] focus:border-[#0078D4] disabled:opacity-50"
        />
        <button type="button" onClick={add} disabled={disabled || !draft.trim()}
          className="flex-shrink-0 text-[#0078D4] hover:text-[#58A6FF] disabled:opacity-30 transition-colors">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-[10px] text-[#484F58] pl-6">Press Enter to add · Drag arrows to reorder</p>
    </div>
  );
}
