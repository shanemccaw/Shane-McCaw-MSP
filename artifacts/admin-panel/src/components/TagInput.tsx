import { useState, useRef, KeyboardEvent } from "react";
import { X } from "lucide-react";

interface TagInputProps {
  value: string[] | null;
  onChange: (value: string[] | null) => void;
  placeholder?: string;
  label?: string;
}

export function TagInput({ value, onChange, placeholder = "Type and press Enter or Tab…" }: TagInputProps) {
  const [inputVal, setInputVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const tags = value ?? [];

  function addTag(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const next = [...tags, trimmed];
    onChange(next.length > 0 ? next : null);
    setInputVal("");
  }

  function removeTag(idx: number) {
    const next = tags.filter((_, i) => i !== idx);
    onChange(next.length > 0 ? next : null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      addTag(inputVal);
    } else if (e.key === "Backspace" && inputVal === "" && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  }

  function handleBlur() {
    if (inputVal.trim()) {
      addTag(inputVal);
    }
  }

  return (
    <div
      className="min-h-[42px] flex flex-wrap gap-1.5 items-center border border-gray-300 rounded-lg px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-[#0078D4] focus-within:border-[#0078D4] cursor-text transition-all"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 bg-[#0078D4]/10 text-[#0078D4] text-xs font-medium px-2 py-1 rounded-md"
        >
          {tag}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); removeTag(i); }}
            className="hover:text-[#E6EDF3] transition-colors ml-0.5"
            aria-label={`Remove ${tag}`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputVal}
        onChange={e => setInputVal(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="flex-1 min-w-[140px] text-sm outline-none bg-transparent py-0.5"
        placeholder={tags.length === 0 ? placeholder : ""}
      />
    </div>
  );
}
