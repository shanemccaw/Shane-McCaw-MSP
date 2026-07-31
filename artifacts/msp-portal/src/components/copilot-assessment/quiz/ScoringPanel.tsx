import React from 'react';
import { Info, ShieldAlert, Layers, ListChecks } from 'lucide-react';
import { INDUSTRY_OPTIONS, LOAD_CATEGORIES, SENSITIVITY_OPTIONS } from '../quizCatalog';
import type { QuizProfile } from '../types';

interface ScoringPanelProps {
  profile: Partial<QuizProfile>;
  activeStepId: string;
  isReviewScreen?: boolean;
}

const REQUIRED_FIELD_CHECKS: Array<(p: Partial<QuizProfile>) => boolean> = [
  (p) => !!p.role?.trim(),
  (p) => !!p.department?.trim(),
  (p) => !!p.industry,
  (p) => !!p.collaboration && p.collaboration.length > 0,
  (p) => !!p.sensitivity && p.sensitivity.length > 0,
  (p) => !!p.workflowStyle,
  (p) => !!p.outcomePriorities && p.outcomePriorities.length > 0,
  (p) => !!p.toolUsage && p.toolUsage.length > 0,
  (p) => !!p.aiComfort,
];

// Sensitivity + collaboration pattern drive a rough governance-emphasis preview —
// a self-reported heuristic for the quiz-taker's context, not a scored engine (the
// real Governance/Security Scoring engines are #183 Phases 5/6, over real telemetry).
const HIGH_SENSITIVITY_TAGS = new Set(['PHI', 'CUI', 'ITAR', 'MNPI', 'PCI']);

export const ScoringPanel: React.FC<ScoringPanelProps> = ({ profile, activeStepId, isReviewScreen }) => {
  const industryTitle = INDUSTRY_OPTIONS.find((o) => o.id === profile.industry)?.title;
  const sensitivity = profile.sensitivity ?? [];
  const collaboration = profile.collaboration ?? [];

  const completedCount = REQUIRED_FIELD_CHECKS.filter((check) => check(profile)).length;
  const completionPercent = Math.round((completedCount / REQUIRED_FIELD_CHECKS.length) * 100);

  const hasHighSensitivity = sensitivity.some((tag) => HIGH_SENSITIVITY_TAGS.has(tag));
  const hasExternalCollab = collaboration.includes('external');
  const governanceEmphasis = sensitivity.length === 0
    ? 'Not yet determined'
    : hasHighSensitivity && hasExternalCollab
    ? 'High'
    : hasHighSensitivity || hasExternalCollab
    ? 'Moderate'
    : 'Low';

  const governanceClass = governanceEmphasis === 'High'
    ? 'text-status-red'
    : governanceEmphasis === 'Moderate'
    ? 'text-status-amber'
    : governanceEmphasis === 'Low'
    ? 'text-status-green'
    : 'text-muted-foreground';

  const loadValues: Record<string, number> = {
    draftingLoad: profile.draftingLoad ?? 0,
    researchLoad: profile.researchLoad ?? 0,
    communicationLoad: profile.communicationLoad ?? 0,
    repetitiveLoad: profile.repetitiveLoad ?? 0,
  };

  return (
    <aside className="w-80 bg-card border-l border-border p-4 flex flex-col justify-between shrink-0 overflow-y-auto scrollbar-thin select-none">
      <div className="space-y-5">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <h2 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            Your Profile So Far
          </h2>
        </div>

        {/* Profile snapshot */}
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-muted-foreground uppercase">Snapshot</div>
          <div className="p-3 bg-secondary border border-border rounded-lg space-y-1.5 text-[11px]">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground shrink-0">Role</span>
              <span className="text-foreground font-semibold truncate text-right">{profile.role?.trim() || '—'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground shrink-0">Department</span>
              <span className="text-foreground font-semibold truncate text-right">{profile.department?.trim() || '—'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground shrink-0">Industry</span>
              <span className="text-foreground font-semibold truncate text-right">{industryTitle || '—'}</span>
            </div>
          </div>
        </div>

        {/* Completion */}
        <div className="space-y-2 bg-secondary border border-border p-3.5 rounded-lg">
          <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
            <span>Profile Completion</span>
            <span className="font-mono text-primary">{completionPercent}%</span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
        </div>

        {/* Sensitivity & governance emphasis */}
        <div className="space-y-2 bg-secondary border border-border p-3.5 rounded-lg">
          <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
            <span className="flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5" /> Governance Emphasis</span>
            <span className={`font-mono font-semibold ${governanceClass}`}>{governanceEmphasis}</span>
          </div>
          {sensitivity.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {sensitivity.map((tag) => {
                const found = SENSITIVITY_OPTIONS.find((o) => o.id === tag);
                return (
                  <span key={tag} className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-accent/15 text-accent border border-accent/30">
                    {found?.title ?? tag}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">Select data sensitivity to see governance emphasis.</p>
          )}
        </div>

        {/* Workload mix */}
        <div className="space-y-2.5 bg-secondary border border-border p-3.5 rounded-lg">
          <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
            <span className="flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> Workload Mix</span>
          </div>
          {LOAD_CATEGORIES.map((cat) => (
            <div key={cat.key} className="space-y-1">
              <div className="flex justify-between text-[10px] font-semibold">
                <span className="text-foreground/80">{cat.label}</span>
                <span className="font-mono text-accent">{Math.round(loadValues[cat.key] * 100)}%</span>
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{ width: `${Math.round(loadValues[cat.key] * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {isReviewScreen ? (
          <div className="p-3 bg-primary/10 border border-primary/40 rounded-lg text-xs text-primary space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>Profile Ready</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              This profile becomes the AI prompt context for your generated personas, use cases, and final report.
            </p>
          </div>
        ) : (
          <div className="p-3 bg-secondary border border-border rounded-lg text-[10px] font-mono text-muted-foreground leading-relaxed flex items-center gap-2">
            <ListChecks className="w-3.5 h-3.5 shrink-0" />
            <span>Step: {activeStepId}</span>
          </div>
        )}
      </div>
    </aside>
  );
};
