import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useInbox } from "@/contexts/InboxContext";

interface Props {
  messageId: string;
  subject: string | null;
  bodyText: string;
  senderName?: string;
  crmContext?: {
    leadName?: string;
    leadCompany?: string;
    leadScore?: number;
    opportunityStage?: string;
    customerName?: string;
  };
  onInsertText?: (text: string) => void;
  onExtractedTasks?: (tasks: TaskSuggestion[]) => void;
}

interface TaskSuggestion {
  title: string;
  description?: string;
  dueDate?: string | null;
  priority?: string;
}

type AIAction = "draft_reply" | "suggest_subject" | "summarize" | "suggest_followup" | "generate_template" | "extract_tasks" | "detect_opportunity" | "detect_lead_signals";

interface AIResult {
  action: AIAction;
  result: unknown;
}

const AI_ACTIONS: { key: AIAction; label: string; icon: string }[] = [
  { key: "draft_reply", label: "Draft Reply", icon: "✍️" },
  { key: "summarize", label: "Summarize", icon: "📋" },
  { key: "extract_tasks", label: "Extract Tasks", icon: "✅" },
  { key: "detect_opportunity", label: "Opportunity Signals", icon: "🎯" },
  { key: "detect_lead_signals", label: "Lead Signals", icon: "📊" },
  { key: "suggest_subject", label: "Suggest Subjects", icon: "💡" },
  { key: "suggest_followup", label: "Follow-up Ideas", icon: "📅" },
  { key: "generate_template", label: "Generate Template", icon: "📄" },
];

export default function InboxAIPanel({ messageId, subject, bodyText, senderName, crmContext, onInsertText, onExtractedTasks }: Props) {
  const { fetchWithAuth } = useAuth();
  const { toggleAIPanel } = useInbox();
  const [loading, setLoading] = useState<AIAction | null>(null);
  const [results, setResults] = useState<AIResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function runAction(action: AIAction) {
    setLoading(action);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/inbox/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, messageBody: bodyText, subject, senderName, crmContext }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { result: unknown };
      setResults(prev => {
        const filtered = prev.filter(r => r.action !== action);
        return [{ action, result: data.result }, ...filtered];
      });
      if (action === "extract_tasks" && Array.isArray(data.result)) {
        onExtractedTasks?.(data.result as TaskSuggestion[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI error");
    } finally {
      setLoading(null);
    }
  }

  function copyText(text: string, key: string) {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  function renderResult(r: AIResult) {
    const { action, result } = r;

    if (action === "draft_reply" && typeof result === "string") {
      return (
        <div className="space-y-2">
          <p className="text-xs text-foreground/90 whitespace-pre-wrap">{result}</p>
          <div className="flex gap-2">
            <button onClick={() => onInsertText?.(result)} className="text-[10px] px-2 py-0.5 bg-primary/20 text-primary rounded hover:bg-primary/30">Insert</button>
            <button onClick={() => copyText(result, action)} className="text-[10px] px-2 py-0.5 bg-accent text-muted-foreground rounded hover:text-foreground/90">
              {copied === action ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      );
    }

    if (action === "suggest_subject" && Array.isArray(result)) {
      return (
        <ul className="space-y-1">
          {(result as string[]).map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="text-xs text-foreground/90 flex-1">{s}</span>
              <button onClick={() => copyText(s, `subject_${i}`)} className="text-[10px] text-muted-foreground hover:text-foreground/90">
                {copied === `subject_${i}` ? "✓" : "Copy"}
              </button>
            </li>
          ))}
        </ul>
      );
    }

    if (action === "summarize" && typeof result === "object" && result !== null) {
      const s = result as { summary?: string; actionItems?: string[]; commitments?: string[]; deadlines?: string[] };
      return (
        <div className="space-y-2">
          {s.summary && <p className="text-xs text-foreground/90">{s.summary}</p>}
          {s.actionItems && s.actionItems.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5">Action Items</p>
              <ul className="space-y-0.5">
                {s.actionItems.map((a, i) => <li key={i} className="text-xs text-foreground/90">• {a}</li>)}
              </ul>
            </div>
          )}
          {s.commitments && s.commitments.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5">Commitments</p>
              <ul className="space-y-0.5">
                {s.commitments.map((c, i) => <li key={i} className="text-xs text-foreground/90">• {c}</li>)}
              </ul>
            </div>
          )}
          {s.deadlines && s.deadlines.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5">Deadlines</p>
              <ul className="space-y-0.5">
                {s.deadlines.map((d, i) => <li key={i} className="text-xs text-foreground/90">• {d}</li>)}
              </ul>
            </div>
          )}
        </div>
      );
    }

    if (action === "extract_tasks" && Array.isArray(result)) {
      const tasks = result as TaskSuggestion[];
      return (
        <div className="space-y-1.5">
          {tasks.map((t, i) => (
            <div key={i} className="border border-border rounded-lg p-2 space-y-0.5">
              <p className="text-xs font-medium text-foreground">{t.title}</p>
              {t.description && <p className="text-[11px] text-muted-foreground">{t.description}</p>}
              <div className="flex gap-2 text-[10px] text-muted-foreground">
                {t.priority && <span className="capitalize">{t.priority}</span>}
                {t.dueDate && <span>{t.dueDate}</span>}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (action === "detect_opportunity" && typeof result === "object" && result !== null) {
      const o = result as { detected?: boolean; confidence?: string; signals?: string[]; opportunityName?: string; recommendedNextStep?: string };
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${o.detected ? "bg-emerald-500/20 text-emerald-400" : "bg-accent text-muted-foreground"}`}>
              {o.detected ? "Opportunity Detected" : "No signals"}
            </span>
            {o.confidence && <span className="text-[10px] text-muted-foreground">{o.confidence} confidence</span>}
          </div>
          {o.opportunityName && <p className="text-xs font-medium text-foreground">{o.opportunityName}</p>}
          {o.signals && o.signals.length > 0 && (
            <ul className="space-y-0.5">
              {o.signals.map((s, i) => <li key={i} className="text-[11px] text-foreground/90">• {s}</li>)}
            </ul>
          )}
          {o.recommendedNextStep && <p className="text-[11px] text-muted-foreground italic">{o.recommendedNextStep}</p>}
        </div>
      );
    }

    if (action === "detect_lead_signals" && typeof result === "object" && result !== null) {
      const l = result as { scoreFit?: number; scorePain?: number; scoreMaturity?: number; scoreIntent?: number; scoreUrgency?: number; signals?: string[]; stageProgression?: string; confidence?: string };
      const dims = [
        { label: "Fit", val: l.scoreFit ?? 0 },
        { label: "Pain", val: l.scorePain ?? 0 },
        { label: "Maturity", val: l.scoreMaturity ?? 0 },
        { label: "Intent", val: l.scoreIntent ?? 0 },
        { label: "Urgency", val: l.scoreUrgency ?? 0 },
      ];
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-5 gap-1">
            {dims.map(d => (
              <div key={d.label} className="text-center">
                <div className="text-xs font-bold text-foreground">{d.val}</div>
                <div className="text-[9px] text-muted-foreground">{d.label}</div>
              </div>
            ))}
          </div>
          {l.stageProgression && l.stageProgression !== "none" && (
            <p className="text-[11px] text-amber-400">Stage progression: {l.stageProgression}</p>
          )}
          {l.signals && l.signals.length > 0 && (
            <ul className="space-y-0.5">
              {l.signals.map((s, i) => <li key={i} className="text-[11px] text-foreground/90">• {s}</li>)}
            </ul>
          )}
        </div>
      );
    }

    if (typeof result === "string") {
      return (
        <div className="space-y-1.5">
          <p className="text-xs text-foreground/90 whitespace-pre-wrap">{result}</p>
          <button onClick={() => copyText(result, action)} className="text-[10px] px-2 py-0.5 bg-accent text-muted-foreground rounded hover:text-foreground/90">
            {copied === action ? "Copied!" : "Copy"}
          </button>
        </div>
      );
    }

    return <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap overflow-auto max-h-40">{JSON.stringify(result, null, 2)}</pre>;
  }

  return (
    <div className="flex flex-col h-full bg-card border-l border-border">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">AI Assistant</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-bold">CLAUDE</span>
        </div>
        <button onClick={toggleAIPanel} className="text-muted-foreground hover:text-foreground/90">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-1.5">
          {AI_ACTIONS.map(a => (
            <button
              key={a.key}
              onClick={() => void runAction(a.key)}
              disabled={loading !== null}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-background border border-border text-[11px] text-foreground/90 hover:border-primary hover:text-foreground transition-colors disabled:opacity-50 text-left"
            >
              {loading === a.key ? (
                <div className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin shrink-0" />
              ) : (
                <span>{a.icon}</span>
              )}
              {a.label}
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        {/* Results */}
        {results.map(r => {
          const action = AI_ACTIONS.find(a => a.key === r.action);
          return (
            <div key={r.action} className="space-y-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase">{action?.icon} {action?.label}</span>
              </div>
              <div className="bg-background border border-border rounded-lg p-3">
                {renderResult(r)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
