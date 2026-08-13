import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { FlaskConical, Loader2, PlayCircle, FolderSearch } from "lucide-react";

// ─── Matches the real backend shapes in admin-signal-rules.ts ─────────────────
// POST /admin/signal-rules/evaluate — runs computeTenantSignals() against a
// sample profile + findings list, returns which signals fired and the full
// per-rule trace (why each rule did/didn't match).
// POST /admin/signal-rules/preview-projects — same inputs (or a raw
// firedSignals array), returns which engagement_projects would surface and
// which were excluded and why.

interface FiredSignal {
  key: string;
  label: string;
  expectedImpact: string;
}

interface RuleTraceEntry {
  signalKey: string;
  groupId: number | null;
  ruleId: number;
  result: boolean;
  reason: string;
}

interface EvaluateResponse {
  firedSignals: FiredSignal[];
  ruleTrace: RuleTraceEntry[];
}

interface EngagementProjectRow {
  id: number;
  title: string;
  priceRange: string | null;
  description: string | null;
  triggeredBy: string[] | null;
  sortOrder: number;
}

interface ExcludedProject {
  project: EngagementProjectRow;
  reason: string;
}

interface PreviewResponse {
  firedSignals: FiredSignal[];
  included: EngagementProjectRow[];
  excluded: ExcludedProject[];
}

const inputCls =
  "w-full border border-border bg-background text-foreground rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60";
const btnPrimaryCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors";
const btnGhostCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-foreground/90 text-xs font-semibold rounded-lg border border-border hover:border-primary/40 disabled:opacity-40 transition-colors";

function parseSampleProfile(text: string): { value: Record<string, unknown>; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { value: {}, error: null };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: {}, error: "Sample profile must be a JSON object" };
    }
    return { value: parsed as Record<string, unknown>, error: null };
  } catch {
    return { value: {}, error: "Sample profile is not valid JSON" };
  }
}

function parseFindingsList(text: string): string[] {
  return text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
}

export default function EvaluatePreviewTester() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [profileText, setProfileText] = useState("{}");
  const [findingsText, setFindingsText] = useState("");

  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<EvaluateResponse | null>(null);

  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResponse | null>(null);

  const runEvaluate = async () => {
    const { value: profileUpdates, error: parseError } = parseSampleProfile(profileText);
    if (parseError) {
      setEvalError(parseError);
      return;
    }
    setEvaluating(true);
    setEvalError(null);
    try {
      const res = await fetchWithAuth("/api/admin/signal-rules/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileUpdates, parsedFindings: parseFindingsList(findingsText) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Evaluation failed");
      const data = (await res.json()) as EvaluateResponse;
      setEvalResult(data);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setEvaluating(false);
    }
  };

  const runPreview = async (opts: { useFiredSignals: boolean }) => {
    const { value: profileUpdates, error: parseError } = parseSampleProfile(profileText);
    if (!opts.useFiredSignals && parseError) {
      setPreviewError(parseError);
      return;
    }
    setPreviewing(true);
    setPreviewError(null);
    try {
      const body =
        opts.useFiredSignals && evalResult
          ? { firedSignals: evalResult.firedSignals.map(s => s.key) }
          : { profileUpdates, parsedFindings: parseFindingsList(findingsText) };
      const res = await fetchWithAuth("/api/admin/signal-rules/preview-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Preview failed");
      const data = (await res.json()) as PreviewResponse;
      setPreviewResult(data);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Preview failed");
      toast({ title: "Preview failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-sm font-semibold flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-primary" />
          Evaluate / Preview Tester
        </h2>
        <p className="text-muted-foreground text-xs mt-1 max-w-2xl">
          Test a sample tenant profile + findings list against the live platform rule set before it goes live for
          real tenants — see exactly which signals would fire, why each rule matched or didn't, and which Projects
          would surface as a result.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">Sample profile (JSON object)</label>
          <textarea
            className={`${inputCls} font-mono h-40 resize-y`}
            value={profileText}
            onChange={e => setProfileText(e.target.value)}
            placeholder='{"hasSecurityGaps": true, "mfaCoveragePercent": 40}'
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">Parsed findings (one per line)</label>
          <textarea
            className={`${inputCls} h-40 resize-y`}
            value={findingsText}
            onChange={e => setFindingsText(e.target.value)}
            placeholder={"Legacy authentication protocols detected\nNo conditional access policies configured"}
            spellCheck={false}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => void runEvaluate()} disabled={evaluating} className={btnPrimaryCls}>
          {evaluating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
          Evaluate Rules
        </button>
        <button onClick={() => void runPreview({ useFiredSignals: false })} disabled={previewing} className={btnGhostCls}>
          {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderSearch className="h-3.5 w-3.5" />}
          Preview Projects
        </button>
        {evalResult && (
          <button
            onClick={() => void runPreview({ useFiredSignals: true })}
            disabled={previewing}
            className={btnGhostCls}
            title="Preview Projects using the signals fired above, without re-evaluating"
          >
            Preview from Fired Signals
          </button>
        )}
      </div>

      {evalError && <p className="text-xs text-red-400">{evalError}</p>}

      {evalResult && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border text-xs font-semibold text-foreground/90">
            Fired Signals ({evalResult.firedSignals.length})
          </div>
          {evalResult.firedSignals.length === 0 ? (
            <div className="px-4 py-3 text-xs italic text-muted-foreground/70">No signals fired against this sample.</div>
          ) : (
            <div className="p-3 flex flex-wrap gap-1.5">
              {evalResult.firedSignals.map(s => (
                <span
                  key={s.key}
                  title={s.expectedImpact}
                  className="rounded-full px-2.5 py-1 text-[11px] font-mono bg-emerald-400/10 text-emerald-400 border border-emerald-400/25"
                >
                  {s.key}
                </span>
              ))}
            </div>
          )}

          <div className="px-4 py-2 border-t border-b border-border text-xs font-semibold text-foreground/90">
            Rule Trace ({evalResult.ruleTrace.length})
          </div>
          {evalResult.ruleTrace.length === 0 ? (
            <div className="px-4 py-3 text-xs italic text-muted-foreground/70">No rules were evaluated (no rules configured yet).</div>
          ) : (
            <div className="divide-y divide-border/60 max-h-96 overflow-y-auto">
              {evalResult.ruleTrace.map((t, i) => (
                <div key={`${t.ruleId}-${i}`} className="flex items-start gap-3 px-4 py-2 text-xs">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      t.result ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/25" : "bg-border text-muted-foreground"
                    }`}
                  >
                    {t.result ? "MATCH" : "NO MATCH"}
                  </span>
                  <span className="font-mono text-foreground/90 shrink-0">{t.signalKey}</span>
                  <span className="text-muted-foreground/70 shrink-0">
                    Rule #{t.ruleId}
                    {t.groupId != null && ` · Group #${t.groupId}`}
                  </span>
                  <span className="text-muted-foreground truncate">{t.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {previewError && <p className="text-xs text-red-400">{previewError}</p>}

      {previewResult && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border text-xs font-semibold text-foreground/90">
              Included Projects ({previewResult.included.length})
            </div>
            {previewResult.included.length === 0 ? (
              <div className="px-4 py-3 text-xs italic text-muted-foreground/70">No projects would surface.</div>
            ) : (
              <div className="divide-y divide-border/60">
                {previewResult.included.map(p => (
                  <div key={p.id} className="px-4 py-2.5 text-xs">
                    <div className="text-foreground/90 font-medium">{p.title}</div>
                    {p.priceRange && <div className="text-muted-foreground/70">{p.priceRange}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border text-xs font-semibold text-foreground/90">
              Excluded Projects ({previewResult.excluded.length})
            </div>
            {previewResult.excluded.length === 0 ? (
              <div className="px-4 py-3 text-xs italic text-muted-foreground/70">Nothing excluded.</div>
            ) : (
              <div className="divide-y divide-border/60">
                {previewResult.excluded.map(({ project, reason }) => (
                  <div key={project.id} className="px-4 py-2.5 text-xs">
                    <div className="text-foreground/90 font-medium">{project.title}</div>
                    <div className="text-muted-foreground/70">{reason}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
