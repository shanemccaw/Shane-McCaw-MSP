import React from 'react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer
} from 'recharts';
import { Sparkles, Info, Activity } from 'lucide-react';
import {
  INDUSTRY_OPTIONS,
  ADAPTIVE_DATA_SENSITIVITY,
  ADAPTIVE_COLLABORATION,
  UNIVERSAL_AI_COMFORT,
  UNIVERSAL_WORKFLOW_STRUCTURE,
  UNIVERSAL_ADOPTION_SPEED,
  ADAPTIVE_OUTCOME_PRIORITIES,
  UNIVERSAL_CHANGE_MGMT
} from '../quizCatalog';

interface ScoringPanelProps {
  answers: Record<string, string>;
  activeStepId: string;
  isReviewScreen?: boolean;
  // Optional -- populated once the About You / Workload Mix steps have real
  // values. Kept optional so this panel still renders sensibly mid-quiz.
  role?: string;
  department?: string;
  workload?: { draftingLoad: number; researchLoad: number; communicationLoad: number; repetitiveLoad: number };
}

export const ScoringPanel: React.FC<ScoringPanelProps> = ({ answers, activeStepId, isReviewScreen, role, department, workload }) => {
  const currentIndustry = answers['industry'] || '';

  const getArrayFromAnswer = (key: string): string[] => {
    const raw = answers[key];
    if (!raw) return [];
    return raw.split(',').filter(Boolean);
  };

  const selectedSensitivities = getArrayFromAnswer('sensitivity');
  const selectedCollaborations = getArrayFromAnswer('collaboration');
  const selectedOutcomes = getArrayFromAnswer('outcomes');

  // Build Answer Summary Items
  const summaryItems: Array<{ label: string; value: string; category: string }> = [];

  if (role && department) {
    summaryItems.push({ label: 'Role / Dept', value: `${role} / ${department}`, category: 'about-you' });
  }

  if (answers['industry']) {
    const found = INDUSTRY_OPTIONS.find(o => o.id === answers['industry']);
    if (found) summaryItems.push({ label: 'Industry', value: found.title, category: 'industry' });
  }

  if (selectedSensitivities.length > 0) {
    const catalog = ADAPTIVE_DATA_SENSITIVITY[currentIndustry] || ADAPTIVE_DATA_SENSITIVITY['default'] || [];
    const titles = selectedSensitivities.map(id => catalog.find(o => o.id === id)?.title || id);
    summaryItems.push({
      label: 'Sensitivity',
      value: `${titles.length} selected (${titles.slice(0, 2).join(', ')}${titles.length > 2 ? '...' : ''})`,
      category: 'sensitivity'
    });
  }

  if (selectedCollaborations.length > 0) {
    const catalog = ADAPTIVE_COLLABORATION[currentIndustry] || ADAPTIVE_COLLABORATION['default'] || [];
    const titles = selectedCollaborations.map(id => catalog.find(o => o.id === id)?.title || id);
    summaryItems.push({
      label: 'Collaboration',
      value: `${titles.length} selected (${titles.slice(0, 2).join(', ')}${titles.length > 2 ? '...' : ''})`,
      category: 'collaboration'
    });
  }

  if (answers['ai-comfort']) {
    const found = UNIVERSAL_AI_COMFORT.find(o => o.id === answers['ai-comfort']);
    if (found) summaryItems.push({ label: 'AI Comfort', value: found.title, category: 'ai-comfort' });
  }

  if (answers['workflow']) {
    const found = UNIVERSAL_WORKFLOW_STRUCTURE.find(o => o.id === answers['workflow']);
    if (found) summaryItems.push({ label: 'Workflow', value: found.title, category: 'workflow' });
  }

  if (answers['adoption-speed']) {
    const found = UNIVERSAL_ADOPTION_SPEED.find(o => o.id === answers['adoption-speed']);
    if (found) summaryItems.push({ label: 'Adoption Speed', value: found.title, category: 'adoption-speed' });
  }

  if (selectedOutcomes.length > 0) {
    const catalog = ADAPTIVE_OUTCOME_PRIORITIES[currentIndustry] || ADAPTIVE_OUTCOME_PRIORITIES['default'] || [];
    const titles = selectedOutcomes.map(id => catalog.find(o => o.id === id)?.title || id);
    summaryItems.push({
      label: 'Outcomes',
      value: `${titles.length} selected (${titles.slice(0, 2).join(', ')}${titles.length > 2 ? '...' : ''})`,
      category: 'outcomes'
    });
  }

  if (answers['change-mgmt']) {
    const found = UNIVERSAL_CHANGE_MGMT.find(o => o.id === answers['change-mgmt']);
    if (found) summaryItems.push({ label: 'Change Mgmt', value: found.title, category: 'change-mgmt' });
  }

  if (workload) {
    const avg = Math.round(((workload.draftingLoad + workload.researchLoad + workload.communicationLoad + workload.repetitiveLoad) / 4) * 100);
    summaryItems.push({ label: 'Workload Mix', value: `${avg}% avg load`, category: 'workload-mix' });
  }

  const hasIndustry = !!answers['industry'];

  // Governance Risk (unchanged from original -- driven entirely by sensitivity + collaboration, neither of which was removed)
  let sensScore = 0;
  if (selectedSensitivities.length > 0) {
    const scores = selectedSensitivities.map(val => {
      if (['classified', 'phi', 'sec_reg', 'cui_restricted'].includes(val)) return 85;
      if (['mission_crit', 'hipaa_reg', 'sox', 'confidential'].includes(val)) return 65;
      if (['res_sens', 'mixed_sens', 'high_sens', 'internal'].includes(val)) return 45;
      return 20;
    });
    sensScore = Math.max(...scores);
  }

  let collabScore = 0;
  if (selectedCollaborations.length > 0) {
    const scores = selectedCollaborations.map(val => {
      if (['cross_agency', 'multi_facility', 'client_facing', 'external_partners'].includes(val)) return 85;
      if (['cross_mission', 'department', 'firm_wide', 'cross_functional'].includes(val)) return 60;
      return 35;
    });
    collabScore = Math.max(...scores);
  }

  const governanceRisk = !hasIndustry ? 0 : (selectedSensitivities.length > 0 || selectedCollaborations.length > 0)
    ? Math.round((sensScore * 0.6) + (collabScore * 0.4))
    : 0;

  // Adoption Difficulty (unchanged -- driven by adoption-speed/workflow/change-mgmt, none removed)
  let speedScore = 50;
  if (answers['adoption-speed']) {
    const val = answers['adoption-speed'];
    if (val === 'slow_adopter') speedScore = 85;
    else if (val === 'average_adopter') speedScore = 60;
    else if (val === 'fast_follower') speedScore = 35;
    else if (val === 'early_adopter') speedScore = 15;
  }

  let wfScore = 50;
  if (answers['workflow']) {
    const val = answers['workflow'];
    if (val === 'unstructured') wfScore = 80;
    else if (val === 'moderately_structured') wfScore = 45;
    else if (val === 'highly_structured') wfScore = 20;
  }

  let cmScore = 50;
  if (answers['change-mgmt']) {
    const val = answers['change-mgmt'];
    if (val === 'significant') cmScore = 85;
    else if (val === 'moderate') cmScore = 50;
    else if (val === 'minimal') cmScore = 20;
  }

  const adoptionDifficulty = !hasIndustry ? 0 : (answers['adoption-speed'] || answers['workflow'] || answers['change-mgmt'])
    ? Math.round((speedScore * 0.4) + (wfScore * 0.3) + (cmScore * 0.3))
    : 0;

  // Value Potential -- REBUILT. Original formula weighted selected use-case/persona
  // counts, which no longer exist as quiz inputs (personas/use-cases are now AI-
  // generated from context, not user-selected -- see #183/#186/#187). Rebuilt from
  // the two real remaining value signals: how many outcome priorities were flagged,
  // and the average workload-mix load (higher load = more for Copilot to take off
  // someone's plate = more value potential).
  const workloadAvg = workload
    ? Math.round(((workload.draftingLoad + workload.researchLoad + workload.communicationLoad + workload.repetitiveLoad) / 4) * 100)
    : 0;
  const valuePotential = !hasIndustry ? 0 : (selectedOutcomes.length > 0 || workloadAvg > 0)
    ? Math.min(100, Math.round((selectedOutcomes.length * 15) + (workloadAvg * 0.5)))
    : 0;

  // Radar Chart Axes
  let aiComfortScore = 0;
  if (answers['ai-comfort']) {
    const val = answers['ai-comfort'];
    if (val === 'very_comfortable') aiComfortScore = 95;
    else if (val === 'somewhat_comfortable') aiComfortScore = 75;
    else if (val === 'neutral') aiComfortScore = 55;
    else if (val === 'cautious') aiComfortScore = 35;
    else if (val === 'not_comfortable') aiComfortScore = 15;
  }
  const governanceTolerance = !hasIndustry ? 0 : answers['ai-comfort'] ? aiComfortScore : (selectedSensitivities.length > 0 ? Math.max(20, 100 - sensScore) : 0);
  const riskPosture = !hasIndustry ? 0 : governanceRisk > 0 ? governanceRisk : (selectedSensitivities.length > 0 ? sensScore : 0);
  const adoptionFriction = !hasIndustry ? 0 : adoptionDifficulty;
  const valueLevers = !hasIndustry ? 0 : valuePotential;

  // Workload Intensity axis -- REPLACES the old "Use-Case Feasibility" axis
  // (used to derive from selected use-case count, which no longer exists as a
  // quiz input). Now reflects the real Workload Mix sliders directly.
  const workloadIntensity = !hasIndustry ? 0 : workloadAvg;

  // Outcome Focus axis -- REPLACES the old "Persona Complexity" axis (used to
  // derive from selected persona/cluster counts, same reason as above). Now
  // reflects how many outcome priorities were flagged as important.
  const outcomeFocus = !hasIndustry ? 0 : Math.min(100, selectedOutcomes.length * 25);

  // Readiness Score -- REBUILT. Original weighted useCaseFeasibility (25%) and
  // personaCoverage (20%), both gone. Redistributed across the real remaining
  // signals: value potential now carries more weight since it's the strongest
  // real proxy for "how much this assessment is worth pursuing."
  const readinessScore = (!hasIndustry || summaryItems.length <= 1)
    ? 0
    : Math.min(100, Math.max(0, Math.round(
        (valuePotential * 0.40) +
        (workloadIntensity * 0.20) +
        ((100 - governanceRisk) * 0.20) +
        ((100 - adoptionDifficulty) * 0.20)
      )));

  const radarData = [
    { axis: 'Governance Tolerance', val: governanceTolerance },
    { axis: 'Risk Posture', val: riskPosture },
    { axis: 'Adoption Friction', val: adoptionFriction },
    { axis: 'Workload Intensity', val: workloadIntensity },
    { axis: 'Outcome Focus', val: outcomeFocus },
    { axis: 'Value Levers', val: valueLevers },
  ];

  // SVG Circle parameters for Section B Readiness Score Gauge
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (readinessScore / 100) * circumference;

  return (
    <aside className="w-80 bg-sidebar border-l border-border p-4 flex flex-col justify-between shrink-0 overflow-y-auto scrollbar-thin select-none">
      <div className="space-y-5">
        {/* Title */}
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <h2 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
            Based on your answers
          </h2>
          <span className="text-[10px] font-mono text-primary font-semibold bg-primary/10 px-2 py-0.5 rounded border border-primary/30">
            Real-Time
          </span>
        </div>

        {/* SECTION A: Answer Summary */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
            <span>Section A: Answer Summary</span>
            <span className="text-[10px] font-mono text-muted-foreground/70">{summaryItems.length} selected</span>
          </div>

          <div className="p-3 bg-card border border-border rounded-lg max-h-36 overflow-y-auto scrollbar-thin space-y-1.5">
            {summaryItems.length > 0 ? (
              summaryItems.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] gap-2 py-0.5 border-b border-border last:border-none">
                  <span className="text-muted-foreground font-mono text-[10px] shrink-0">{item.label}:</span>
                  <span className="text-foreground font-semibold truncate text-[11px] text-right">{item.value}</span>
                </div>
              ))
            ) : (
              <div className="text-center py-3 text-xs text-muted-foreground/70 italic">
                No answers selected yet. Select tiles to build your baseline.
              </div>
            )}
          </div>
        </div>

        {/* SECTION B: Readiness Score (Circular Gauge) */}
        <div className="space-y-2 bg-card border border-border p-3.5 rounded-lg">
          <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
            <span>Section B: Readiness Score</span>
            <span className="text-[10px] font-mono text-primary font-semibold">0 – 100</span>
          </div>

          <div className="flex items-center justify-center gap-4 pt-1">
            <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
              <svg className="w-24 h-24 transform -rotate-90">
                <circle
                  cx="48"
                  cy="48"
                  r={radius}
                  stroke="hsl(var(--border))"
                  strokeWidth="7"
                  fill="transparent"
                />
                <circle
                  cx="48"
                  cy="48"
                  r={radius}
                  stroke={readinessScore > 70 ? 'hsl(var(--status-green))' : readinessScore > 40 ? 'hsl(var(--primary))' : 'hsl(var(--status-amber))'}
                  strokeWidth="7"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  fill="transparent"
                  className="transition-all duration-500 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-extrabold text-foreground font-mono tracking-tighter">
                  {readinessScore}
                </span>
                <span className="text-[9px] text-muted-foreground font-mono uppercase tracking-widest">
                  / 100
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-bold text-foreground">
                {readinessScore >= 75 ? 'High Readiness' : readinessScore >= 45 ? 'Moderate Readiness' : readinessScore > 0 ? 'Initial Baseline' : 'Not Calculated'}
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {readinessScore >= 75
                  ? 'Strong value signal with manageable governance risk.'
                  : readinessScore >= 45
                  ? 'Promising foundation with manageable adoption friction.'
                  : readinessScore > 0
                  ? 'Baseline inputs recorded. Complete remaining questions.'
                  : 'Select industry and profile parameters to initiate scoring.'}
              </p>
            </div>
          </div>
        </div>

        {/* SECTION C: Multi-Dimension Radar Chart */}
        <div className="space-y-2 bg-card border border-border p-3 rounded-lg">
          <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
            <span>Section C: Multi-Dimension Assessment</span>
            <Sparkles className="w-3.5 h-3.5 text-primary" />
          </div>

          <div className="h-44 w-full relative">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="65%" data={radarData}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis
                  dataKey="axis"
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 8 }}
                />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar
                  name="Assessment Score"
                  dataKey="val"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary))"
                  fillOpacity={0.35}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* SECTION D: Progress Meters */}
        <div className="space-y-2 bg-card border border-border p-3.5 rounded-lg">
          <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground mb-2">
            <span>Section D: Progress Meters</span>
            <Activity className="w-3.5 h-3.5 text-primary" />
          </div>

          <div className="space-y-2.5">
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-semibold">
                <span className="text-foreground/80">Workload Intensity</span>
                <span className="font-mono text-primary">{workloadIntensity}%</span>
              </div>
              <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${workloadIntensity}%` }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-semibold">
                <span className="text-foreground/80">Governance Risk</span>
                <span className="font-mono text-status-amber">{governanceRisk}%</span>
              </div>
              <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-status-amber transition-all duration-300"
                  style={{ width: `${governanceRisk}%` }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-semibold">
                <span className="text-foreground/80">Adoption Difficulty</span>
                <span className="font-mono text-destructive">{adoptionDifficulty}%</span>
              </div>
              <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-destructive transition-all duration-300"
                  style={{ width: `${adoptionDifficulty}%` }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-semibold">
                <span className="text-foreground/80">Value Potential</span>
                <span className="font-mono text-accent">{valuePotential}%</span>
              </div>
              <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{ width: `${valuePotential}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Note on Review screen or Footer */}
        {isReviewScreen ? (
          <div className="p-3 bg-primary/10 border border-primary/40 rounded-lg text-xs text-primary space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>Assessment Baseline Set</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              This self-assessment score ({readinessScore}/100) will be compared to your actual tenant telemetry score in the next step.
            </p>
          </div>
        ) : (
          <div className="p-3 bg-card border border-border rounded-lg text-[10px] font-mono text-muted-foreground/70 leading-relaxed">
            EVALUATION ARCHITECTURE:
            <br />
            Adaptive Multi-Persona Matrix v5.0
          </div>
        )}
      </div>
    </aside>
  );
};
