import { useCallback, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { X, Wand2, BookOpen, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface ParseResult {
  valid: boolean;
  records: unknown[];
  isBulk: boolean;
  syntaxError?: string;
}

interface RecordValidation {
  ok: boolean;
  errors: string[];
  data?: Record<string, unknown>;
}

function parseJson(raw: string): ParseResult {
  if (!raw.trim()) return { valid: false, records: [], isBulk: false };
  try {
    const parsed = JSON.parse(raw);
    const isBulk = Array.isArray(parsed);
    const records = isBulk ? (parsed as unknown[]) : [parsed];
    return { valid: true, records, isBulk };
  } catch (e) {
    return { valid: false, records: [], isBulk: false, syntaxError: (e as Error).message };
  }
}

function validateRecords(records: unknown[], schema: z.ZodTypeAny): RecordValidation[] {
  return records.map(rec => {
    const result = schema.safeParse(rec);
    if (result.success) {
      return { ok: true, errors: [], data: result.data as Record<string, unknown> };
    }
    const errors = result.error.errors.map(e => {
      const path = e.path.length ? e.path.join(".") + ": " : "";
      return `${path}${e.message}`;
    });
    return { ok: false, errors };
  });
}

function RecordPreviewCard({ index, record, validation, isBulk }: {
  index: number;
  record: unknown;
  validation: RecordValidation;
  isBulk: boolean;
}) {
  const [expanded, setExpanded] = useState(index < 5);
  const rec = record as Record<string, unknown>;
  const title = typeof rec?.title === "string" ? rec.title : `Record ${index + 1}`;
  const hasId = typeof rec?.id === "number";

  return (
    <div className={`rounded-lg border text-sm ${validation.ok ? "border-border bg-card" : "border-red-500/20 bg-red-500/10"}`}>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        {validation.ok
          ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
          : <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
        }
        <span className="flex-1 font-medium text-foreground truncate">
          {isBulk ? `[${index}] ` : ""}{title}
        </span>
        {hasId && (
          <span className="text-xs text-muted-foreground shrink-0">update #{rec.id as number}</span>
        )}
        {!hasId && validation.ok && (
          <span className="text-xs text-green-600 shrink-0">new</span>
        )}
        <span className="text-muted-foreground text-xs">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-1.5">
          {validation.ok ? (
            <div className="space-y-1">
              {Object.entries(rec).filter(([k]) => k !== "id").map(([k, v]) => (
                <div key={k} className="flex gap-2 text-xs">
                  <span className="font-mono text-gray-500 shrink-0 w-24 truncate">{k}</span>
                  <span className="text-foreground truncate">
                    {Array.isArray(v)
                      ? `[${(v as unknown[]).length} item${(v as unknown[]).length !== 1 ? "s" : ""}]`
                      : typeof v === "object" && v !== null
                        ? JSON.stringify(v).slice(0, 80)
                        : String(v ?? "—")}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <ul className="space-y-1">
              {validation.errors.map((err, i) => (
                <li key={i} className="text-xs text-red-600 flex gap-1">
                  <span className="shrink-0">•</span>
                  <span>{err}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface JsonImportModalProps {
  collection: string;
  schema: z.ZodTypeAny;
  exampleJson: string;
  onClose: () => void;
  onImported: () => void;
}

export default function JsonImportModal({
  collection,
  schema,
  exampleJson,
  onClose,
  onImported,
}: JsonImportModalProps) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [raw, setRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [networkErrors, setNetworkErrors] = useState<string[]>([]);

  const parseResult = useMemo(() => parseJson(raw), [raw]);
  const validations = useMemo(
    () => parseResult.valid ? validateRecords(parseResult.records, schema) : [],
    [parseResult, schema]
  );

  const allValid = parseResult.valid && validations.length > 0 && validations.every(v => v.ok);
  const validCount = validations.filter(v => v.ok).length;
  const invalidCount = validations.filter(v => !v.ok).length;

  const handleFormat = useCallback(() => {
    try {
      const parsed = JSON.parse(raw);
      setRaw(JSON.stringify(parsed, null, 2));
    } catch {
    }
  }, [raw]);

  const handleLoadExample = useCallback(() => {
    setRaw(exampleJson);
  }, [exampleJson]);

  const editorBorderClass = !raw.trim()
    ? "border-border"
    : parseResult.syntaxError
      ? "border-red-400"
      : parseResult.valid && invalidCount > 0
        ? "border-amber-400"
        : parseResult.valid
          ? "border-green-400"
          : "border-border";

  const submit = async () => {
    if (!allValid) return;
    setNetworkErrors([]);
    setSaving(true);

    let created = 0, updated = 0;
    const errs: string[] = [];

    for (const v of validations) {
      if (!v.ok || !v.data) continue;
      const data = v.data;
      const hasId = typeof data.id === "number";
      const url = hasId
        ? `/api/admin/asset-library/${collection}/${data.id as number}`
        : `/api/admin/asset-library/${collection}`;
      try {
        const res = await fetchWithAuth(url, {
          method: hasId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({ error: "Unknown error" }));
          errs.push((j as { error?: string }).error ?? "Request failed");
        } else if (hasId) {
          updated++;
        } else {
          created++;
        }
      } catch {
        errs.push("Network error — please try again.");
      }
    }

    setSaving(false);

    if (errs.length > 0) {
      setNetworkErrors(errs);
      if (created > 0 || updated > 0) {
        toast({ title: `Partial import: ${created} created, ${updated} updated` });
        onImported();
      }
      return;
    }

    const msg = parseResult.isBulk
      ? `${created} created, ${updated} updated`
      : validations[0] && typeof (validations[0].data as Record<string, unknown>)?.id === "number"
        ? "Record updated via import"
        : "Record created via import";
    toast({ title: msg });
    onImported();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const lineCount = raw ? raw.split("\n").length : 0;
  const charCount = raw.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-5xl flex flex-col" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="font-semibold text-foreground">JSON Import</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-muted-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col border-r min-w-0">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-card shrink-0">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Editor</span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={handleLoadExample}
                className="flex items-center gap-1 px-2.5 py-1 text-xs border border-border rounded hover:bg-accent text-muted-foreground"
              >
                <BookOpen className="w-3 h-3" /> Load Example
              </button>
              <button
                type="button"
                onClick={handleFormat}
                disabled={!raw.trim() || !!parseResult.syntaxError}
                className="flex items-center gap-1 px-2.5 py-1 text-xs border border-border rounded hover:bg-accent text-muted-foreground disabled:opacity-40"
              >
                <Wand2 className="w-3 h-3" /> Format
              </button>
            </div>

            <div className={`flex-1 overflow-hidden border-2 rounded-none transition-colors ${editorBorderClass}`} style={{ borderLeft: "none", borderRight: "none" }}>
              <CodeMirror
                value={raw}
                onChange={setRaw}
                extensions={[json()]}
                theme={oneDark}
                height="100%"
                style={{ height: "100%", fontSize: "13px" }}
                basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
              />
            </div>

            <div className="flex items-center gap-3 px-4 py-2 border-t bg-card text-xs text-muted-foreground shrink-0">
              <span>{lineCount} line{lineCount !== 1 ? "s" : ""}</span>
              <span>·</span>
              <span>{charCount} char{charCount !== 1 ? "s" : ""}</span>
              {parseResult.syntaxError && (
                <>
                  <span>·</span>
                  <span className="text-red-500 truncate">{parseResult.syntaxError}</span>
                </>
              )}
            </div>
          </div>

          <div className="w-80 flex flex-col shrink-0">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-card shrink-0">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preview</span>
              <div className="flex-1" />
              {parseResult.valid && validations.length > 0 && (
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${allValid ? "bg-green-500/15 text-green-400" : "bg-amber-500/15 text-amber-400"}`}>
                  {allValid
                    ? `${validations.length} record${validations.length !== 1 ? "s" : ""} ready`
                    : `${validCount} ok · ${invalidCount} error${invalidCount !== 1 ? "s" : ""}`}
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {!raw.trim() ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-8">
                  <p className="text-sm font-medium">No JSON yet</p>
                  <p className="text-xs mt-1">Paste JSON or click "Load Example"</p>
                </div>
              ) : parseResult.syntaxError ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-red-400">Syntax error</p>
                      <p className="text-xs text-red-600 mt-1">{parseResult.syntaxError}</p>
                    </div>
                  </div>
                </div>
              ) : validations.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-500/10 p-3">
                  <p className="text-sm text-amber-400">No records found in JSON.</p>
                </div>
              ) : (
                validations.map((v, i) => (
                  <RecordPreviewCard
                    key={i}
                    index={i}
                    record={parseResult.records[i]}
                    validation={v}
                    isBulk={parseResult.isBulk}
                  />
                ))
              )}

              {networkErrors.length > 0 && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 space-y-1">
                  <p className="text-xs font-semibold text-red-400">Import errors</p>
                  {networkErrors.map((e, i) => (
                    <p key={i} className="text-xs text-red-600">• {e}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t bg-card shrink-0">
          <p className="text-xs text-gray-500">
            Records with an <code className="bg-border px-1 rounded text-foreground">id</code> field are updated; without one, a new record is created.
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-accent">
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={saving || !allValid}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-[#005fa3] disabled:opacity-50"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? "Importing…" : "Import"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
