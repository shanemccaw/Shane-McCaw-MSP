/**
 * PayloadField.tsx
 *
 * The label + {{token}} variable picker + input/textarea component, plus its
 * FocusTrackerContext and FieldHint tooltip. Extracted from WorkflowBuilderPage.tsx
 * so it can be reused anywhere a flat list of insertable `{{variable}}` tokens
 * needs to be offered against a text/JSON field — e.g. the Baseline Templates
 * endpoint/body-template editor (BaselineTemplates.tsx) — without building a
 * second variable-insertion UI.
 *
 * Framework-light: depends only on React + AncestorGroup (from ./ancestorOutputs,
 * itself framework-free). Callers that have no ancestor-node graph (like Baseline
 * Templates) can synthesize a single-group AncestorGroup[] from a flat variable
 * list — see BaselineTemplates.tsx for an example.
 */

import { useState, useRef, useContext, useEffect, createContext } from "react";
import { createPortal } from "react-dom";
import type { AncestorGroup } from "./ancestorOutputs";

// ── Focus tracker context ─────────────────────────────────────────────────────
// Allows a VariableChipPanel-style inserter to insert tokens into whichever
// PayloadField / ExpressionField was most recently focused — without threading
// props through every call site.

export interface FocusedFieldInfo {
  el: HTMLInputElement | HTMLTextAreaElement;
  /** React state setter — called with the new string value after insertion. */
  setValue: (v: string) => void;
}

export interface FocusTrackerCtx {
  /** Called on `onFocus` — always overrides the current focus target. */
  setFocus: (info: FocusedFieldInfo) => void;
  /**
   * Called on mount — registers a field as the default append target.
   * Only takes effect when no default target has been set yet (first mount wins).
   * Cleared on node change.
   */
  setDefault: (info: FocusedFieldInfo) => void;
}

export const FocusTrackerContext = createContext<FocusTrackerCtx | null>(null);

// ── Field hint tooltip ────────────────────────────────────────────────────────

export function FieldHint({ text }: { text: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span
      ref={ref}
      className="inline-flex items-center flex-shrink-0 cursor-help"
      onMouseEnter={() => { if (ref.current) setRect(ref.current.getBoundingClientRect()); }}
      onMouseLeave={() => setRect(null)}
    >
      <svg className="w-3 h-3 text-[#484F58] hover:text-[#7D8590] transition-colors" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
      </svg>
      {rect && createPortal(
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ left: rect.left + rect.width / 2, top: rect.top - 8, transform: "translate(-50%, -100%)" }}
        >
          <div className="relative w-52 bg-[#1C2128] border border-[#444C56] rounded-lg px-2.5 py-2 shadow-xl">
            <p className="text-[11px] text-[#CDD9E5] leading-snug">{text}</p>
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-[5px] border-x-transparent border-t-[5px] border-t-[#444C56]" />
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}

// ── Shared type for inline autocomplete suggestions ────────────────────────────

export type InlineSuggestion = {
  key: string;
  tokenPath: string;
  label: string;
  insertText: string;
  enumValue?: string;
};

// ── Payload field (label + variable picker + input/textarea) ──────────────────

export function PayloadField({
  label, value, onChange, placeholder, multiline, ancestorOutputs, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  ancestorOutputs: AncestorGroup[];
  hint?: string;
}) {
  const focusCtx = useContext(FocusTrackerContext);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // Register as default append target on mount (first-mounted field wins)
  useEffect(() => {
    if (inputRef.current) focusCtx?.setDefault({ el: inputRef.current, setValue: onChange });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerPos, setPickerPos] = useState<{ top: number; right: number } | null>(null);
  const [suggest, setSuggest] = useState<{ openAt: number; filter: string } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const pickerBtnRef = useRef<HTMLButtonElement>(null);

  // Flat list of all tokens across ancestor groups
  const allTokens = ancestorOutputs.flatMap(group =>
    group.outputs.map(o => ({
      tokenPath: group.isStartNode ? o.key : `steps.${group.nodeId}.${o.key}`,
      label: o.label,
      groupName: group.nodeName,
      enumValues: o.enumValues,
    }))
  );

  const filteredTokens: InlineSuggestion[] = suggest
    ? allTokens.flatMap(t => {
        if (!t.tokenPath.toLowerCase().includes(suggest.filter.toLowerCase())) return [];
        const base: InlineSuggestion = {
          key: t.tokenPath,
          tokenPath: t.tokenPath,
          label: t.label,
          insertText: `{{${t.tokenPath}}}`,
        };
        const enumItems: InlineSuggestion[] = (t.enumValues ?? []).map(ev => ({
          key: `${t.tokenPath}::${ev}`,
          tokenPath: t.tokenPath,
          label: t.label,
          insertText: `{{${t.tokenPath}}} == '${ev}'`,
          enumValue: ev,
        }));
        return [base, ...enumItems];
      })
    : [];

  function insertToken(key: string) {
    const token = `{{${key}}}`;
    const el = inputRef.current;
    if (el) {
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      onChange(value.slice(0, start) + token + value.slice(end));
      setTimeout(() => { el.focus(); const pos = start + token.length; el.setSelectionRange(pos, pos); }, 0);
    } else {
      onChange(value ? `${value} ${token}` : token);
    }
    setPickerOpen(false);
  }

  function pickSuggestion(item: InlineSuggestion) {
    if (!suggest) return;
    const el = inputRef.current;
    const cursorPos = el ? (el.selectionStart ?? value.length) : value.length;
    const replacement = item.insertText;
    const newVal = value.slice(0, suggest.openAt) + replacement + value.slice(cursorPos);
    onChange(newVal);
    const pos = suggest.openAt + replacement.length;
    setTimeout(() => { if (el) { el.focus(); el.setSelectionRange(pos, pos); } }, 0);
    setSuggest(null);
    setActiveIdx(0);
  }

  function handleChange(newVal: string, cursorPos: number) {
    onChange(newVal);
    const before = newVal.slice(0, cursorPos);
    // Match an open {{ that hasn't been closed yet
    const match = before.match(/\{\{([^{}]*)$/);
    if (match) {
      setSuggest({ openAt: cursorPos - match[0].length, filter: match[1] });
      setActiveIdx(0);
    } else {
      setSuggest(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!suggest || filteredTokens.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => (i + 1) % filteredTokens.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => (i - 1 + filteredTokens.length) % filteredTokens.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pickSuggestion(filteredTokens[activeIdx]!);
    } else if (e.key === "Escape") {
      setSuggest(null);
    }
  }

  const hasVars = ancestorOutputs.some(g => g.outputs.length > 0);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between min-h-[18px]">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">{label}</label>
          {hint && <FieldHint text={hint} />}
        </div>
        {hasVars && (
          <div className="relative">
            <button
              ref={pickerBtnRef}
              type="button"
              onClick={() => {
                if (pickerBtnRef.current) {
                  const r = pickerBtnRef.current.getBoundingClientRect();
                  setPickerPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
                }
                setPickerOpen(v => !v);
                setPickerSearch("");
              }}
              className="text-[10px] text-[#0078D4] hover:text-[#2E9EFF] transition-colors flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              variables
            </button>
            {pickerOpen && pickerPos && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => { setPickerOpen(false); setPickerSearch(""); }} />
                <div
                  className="fixed z-50 w-64 bg-[#161B22] border border-[#30363D] rounded-lg shadow-2xl overflow-hidden"
                  style={{ top: pickerPos.top, right: pickerPos.right }}
                >
                  <div className="px-2 pt-2 pb-1">
                    <input
                      autoFocus
                      type="text"
                      value={pickerSearch}
                      onChange={e => setPickerSearch(e.target.value)}
                      placeholder="Search variables…"
                      className="w-full bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
                    />
                  </div>
                  <div className="max-h-52 overflow-y-auto py-1">
                    {(() => {
                      const q = pickerSearch.trim().toLowerCase();
                      const filteredGroups = ancestorOutputs.map(group => ({
                        ...group,
                        outputs: q
                          ? group.outputs.filter(o =>
                              o.key.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
                            )
                          : group.outputs,
                      })).filter(g => g.outputs.length > 0);
                      if (filteredGroups.length === 0) {
                        return <p className="px-3 py-2 text-[10px] text-[#484F58]">No variables match.</p>;
                      }
                      return filteredGroups.map(group => (
                        <div key={group.nodeId}>
                          <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-[#484F58] uppercase tracking-wider">{group.nodeName}</p>
                          {group.outputs.map(o => {
                            const tokenPath = group.isStartNode ? o.key : `steps.${group.nodeId}.${o.key}`;
                            return (
                              <div key={o.key}>
                                <button type="button" onClick={() => insertToken(tokenPath)}
                                  className="w-full text-left px-3 py-1.5 hover:bg-[#0D1117] flex items-start justify-between gap-3">
                                  <span className="font-mono text-[11px] text-[#2E9EFF] shrink-0">{`{{${tokenPath}}}`}</span>
                                  <span className="text-[10px] text-[#484F58] text-right leading-tight">{o.label}</span>
                                </button>
                                {o.enumValues && o.enumValues.length > 0 && (
                                  <p className="px-3 pb-1.5 text-[9px] font-mono text-amber-500/60 leading-tight">
                                    {o.enumValues.map(ev => `"${ev}"`).join(" · ")}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {/* Input / textarea with inline autocomplete dropdown */}
      <div className="relative">
        {multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={value}
            onChange={e => handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setSuggest(null), 150)}
            onFocus={() => { if (inputRef.current) focusCtx?.setFocus({ el: inputRef.current, setValue: onChange }); }}
            placeholder={placeholder}
            rows={3}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 resize-none font-mono"
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={value}
            onChange={e => handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setSuggest(null), 150)}
            onFocus={() => { if (inputRef.current) focusCtx?.setFocus({ el: inputRef.current, setValue: onChange }); }}
            placeholder={placeholder}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
          />
        )}
        {suggest && filteredTokens.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-[#161B22] border border-[#30363D] rounded-lg shadow-2xl overflow-hidden">
            <div className="max-h-48 overflow-y-auto py-1">
              {filteredTokens.map((t, i) => (
                <button
                  key={t.key}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); pickSuggestion(t); }}
                  className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-3 ${i === activeIdx ? "bg-[#0078D4]/20" : "hover:bg-[#0D1117]"}`}
                >
                  <span className="font-mono text-[11px] text-[#2E9EFF] shrink-0 truncate">{t.insertText}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {t.enumValue !== undefined && (
                      <span className="px-1 py-0.5 rounded text-[9px] font-mono bg-amber-500/15 text-amber-400 border border-amber-500/25">enum</span>
                    )}
                    <span className="text-[10px] text-[#484F58] text-right leading-tight">{t.label}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="px-3 py-1 border-t border-[#30363D] flex items-center gap-2">
              <span className="text-[9px] text-[#484F58]">↑↓ navigate</span>
              <span className="text-[9px] text-[#484F58]">↵ / Tab insert</span>
              <span className="text-[9px] text-[#484F58]">Esc dismiss</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
