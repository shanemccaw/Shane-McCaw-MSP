import React, { useState } from 'react';
import { X, AlertTriangle, ShieldCheck, Wrench, Sparkles, Copy, Check, ToggleLeft, ToggleRight } from 'lucide-react';

export type IssueCategory = 'blocker' | 'sensitivity' | 'friction';
export type IssueSeverity = 'High' | 'Medium' | 'Low';

export interface UseCaseIssue {
  label: string;
  category: IssueCategory;
  severity: IssueSeverity;
}

interface UseCaseIssueModalProps {
  issue: UseCaseIssue | null;
  onClose: () => void;
}

interface RemediationStep {
  text: string;
  code?: string;
}

const CATEGORY_META: Record<IssueCategory, { title: string; icon: React.ReactNode }> = {
  blocker: { title: 'Governance & Security Blocker', icon: <AlertTriangle className="w-5 h-5" /> },
  sensitivity: { title: 'Sensitivity Exposure', icon: <ShieldCheck className="w-5 h-5" /> },
  friction: { title: 'Collaboration Friction', icon: <Sparkles className="w-5 h-5" /> },
};

const SEVERITY_CLASSES: Record<IssueSeverity, string> = {
  High: 'text-destructive bg-destructive/10 border-destructive/30',
  Medium: 'text-status-amber bg-status-amber/10 border-status-amber/30',
  Low: 'text-status-green bg-status-green/10 border-status-green/30',
};

// Mock current/projected scores by severity, standing in for a real signal
// score until this is wired to live data. Higher severity = bigger gap
// between "before" and "after" fixing it.
const MOCK_SCORES: Record<IssueSeverity, { current: number; projected: number }> = {
  High: { current: 34, projected: 88 },
  Medium: { current: 58, projected: 84 },
  Low: { current: 72, projected: 90 },
};

// Placeholder copy only -- this is a design pass. Real per-item detail and
// remediation content gets wired to live Copilot Readiness signal data in a
// later phase, not authored here.
function mockDetail(issue: UseCaseIssue): string {
  return `Telemetry flagged "${issue.label}" during the most recent tenant scan. This is placeholder detail text standing in for the real signal breakdown -- once wired, this section will show exactly which check fired, which objects it affected, and when it was last observed.`;
}

function mockRemediation(issue: UseCaseIssue): RemediationStep[] {
  return [
    { text: 'Placeholder remediation step one -- real guidance will be specific to this exact finding.' },
    {
      text: 'Run this Graph/PowerShell check to confirm current exposure before remediating (placeholder command):',
      code: `Connect-MgGraph -Scopes "Sites.Read.All"\nGet-MgSite -Search "*" | Where-Object { $_.Permissions -match "Everyone" }`,
    },
    {
      text: 'Apply the fix once confirmed (placeholder command):',
      code: `Set-SPOSite -Identity <SiteUrl> -SharingCapability Disabled`,
    },
  ];
}

const CodeBlock: React.FC<{ code: string }> = ({ code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-2 rounded-md border border-border bg-background overflow-hidden">
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border bg-secondary/60">
        <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">PowerShell</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {copied ? <Check className="w-3 h-3 text-status-green" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-2.5 text-[10.5px] font-mono text-foreground overflow-x-auto whitespace-pre-wrap leading-relaxed">
        {code}
      </pre>
    </div>
  );
};

export const UseCaseIssueModal: React.FC<UseCaseIssueModalProps> = ({ issue, onClose }) => {
  const [showSimulated, setShowSimulated] = useState(false);

  if (!issue) return null;

  const meta = CATEGORY_META[issue.category];
  const scores = MOCK_SCORES[issue.severity];
  const displayScore = showSimulated ? scores.projected : scores.current;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-card-border rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto scrollbar-thin shadow-2xl space-y-5 p-6 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border pb-4">
          <div className="flex items-start space-x-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center text-primary shrink-0">
              {meta.icon}
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground font-semibold">
                {meta.title}
              </span>
              <h2 className="text-base font-bold text-foreground leading-snug mt-0.5">
                {issue.label}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Severity badge */}
        <span className={`inline-flex items-center text-[10px] font-mono font-bold uppercase px-2 py-1 rounded border ${SEVERITY_CLASSES[issue.severity]}`}>
          {issue.severity} Severity
        </span>

        {/* Before / After simulator */}
        <div className="bg-muted/50 border border-border rounded-lg p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">
              Fix Simulator
            </span>
            <button
              onClick={() => setShowSimulated(v => !v)}
              className="flex items-center gap-1.5 text-[10px] font-mono font-bold cursor-pointer"
            >
              <span className={showSimulated ? 'text-muted-foreground' : 'text-foreground'}>Current</span>
              {showSimulated
                ? <ToggleRight className="w-7 h-7 text-primary" />
                : <ToggleLeft className="w-7 h-7 text-muted-foreground" />}
              <span className={showSimulated ? 'text-primary' : 'text-muted-foreground'}>Simulated Fix</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 bg-secondary rounded-full h-2.5 overflow-hidden border border-border/50">
              <div
                className={`h-full rounded-full transition-all duration-500 ${showSimulated ? 'bg-status-green' : 'bg-destructive'}`}
                style={{ width: `${displayScore}%` }}
              />
            </div>
            <span className={`text-sm font-mono font-extrabold w-10 text-right ${showSimulated ? 'text-status-green' : 'text-destructive'}`}>
              {displayScore}
            </span>
          </div>
          <p className="text-[9.5px] text-muted-foreground">
            {showSimulated
              ? `Projected Copilot Readiness score if this finding is remediated.`
              : `Current Copilot Readiness score with this finding unresolved.`}
            {' '}Simulated values -- not yet wired to live signal data.
          </p>
        </div>

        {/* What this means */}
        <div className="space-y-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">
            What This Means
          </span>
          <p className="text-sm text-foreground leading-relaxed bg-muted/50 p-4 rounded-lg border border-border">
            {mockDetail(issue)}
          </p>
        </div>

        {/* How to fix it */}
        <div className="space-y-2">
          <span className="text-xs font-semibold text-primary uppercase tracking-wider font-mono flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5" />
            How To Fix It
          </span>
          <div className="space-y-2">
            {mockRemediation(issue).map((step, idx) => (
              <div
                key={idx}
                className="bg-muted/50 border border-border p-3 rounded-md text-xs text-foreground"
              >
                <div className="flex items-start space-x-2.5">
                  <span className="font-mono font-bold text-primary shrink-0">{idx + 1}.</span>
                  <span className="leading-relaxed">{step.text}</span>
                </div>
                {step.code && <CodeBlock code={step.code} />}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <span className="text-[10px] font-mono text-muted-foreground">
            Design preview -- not yet wired to live signal data
          </span>
          <button
            onClick={onClose}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2 rounded-md text-xs transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
