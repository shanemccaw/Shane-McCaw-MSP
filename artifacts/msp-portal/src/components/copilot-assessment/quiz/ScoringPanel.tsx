import React from 'react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer
} from 'recharts';
import { Shield, Sparkles, TrendingUp, CheckCircle, Info, Activity, AlertTriangle, Layers } from 'lucide-react';
import {
  INDUSTRY_OPTIONS,
  ADAPTIVE_CLUSTERS,
  ADAPTIVE_PERSONAS,
  ADAPTIVE_USE_CASES,
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
}

export const ScoringPanel: React.FC<ScoringPanelProps> = ({ answers, activeStepId, isReviewScreen }) => {
  const currentIndustry = answers['industry'] || '';

  const getArrayFromAnswer = (key: string): string[] => {
    const raw = answers[key];
    if (!raw) return [];
    return raw.split(',').filter(Boolean);
  };

  const selectedClusters = getArrayFromAnswer('clusters');
  const selectedPersonas = getArrayFromAnswer('personas');
  const selectedUseCases = getArrayFromAnswer('use-cases');
  const selectedSensitivities = getArrayFromAnswer('sensitivity');
  const selectedCollaborations = getArrayFromAnswer('collaboration');
  const selectedOutcomes = getArrayFromAnswer('outcomes');

  // Build Answer Summary Items
  const summaryItems: Array<{ label: string; value: string; category: string }> = [];

  if (answers['industry']) {
    const found = INDUSTRY_OPTIONS.find(o => o.id === answers['industry']);
    if (found) summaryItems.push({ label: 'Industry', value: found.title, category: 'industry' });
  }

  if (selectedClusters.length > 0) {
    const catalog = ADAPTIVE_CLUSTERS[currentIndustry] || ADAPTIVE_CLUSTERS['default'] || [];
    const titles = selectedClusters.map(id => catalog.find(o => o.id === id)?.title || id);
    summaryItems.push({ label: 'Clusters', value: `${titles.length} selected (${titles.slice(0, 2).join(', ')}${titles.length > 2 ? '...' : ''})`, category: 'clusters' });
  }

  if (selectedPersonas.length > 0) {
    const catalog = ADAPTIVE_PERSONAS[currentIndustry] || ADAPTIVE_PERSONAS['default'] || [];
    const titles = selectedPersonas.map(id => catalog.find(o => o.id === id)?.title || id);
    summaryItems.push({ label: 'Personas', value: `${titles.length} selected`, category: 'personas' });
  }

  if (selectedUseCases.length > 0) {
    const catalog = ADAPTIVE_USE_CASES[currentIndustry] || ADAPTIVE_USE_CASES['default'] || [];
    const titles = selectedUseCases.map(id => catalog.find(o => o.id === id)?.title || id);
    summaryItems.push({ label: 'Use Cases', value: `${titles.length} selected`, category: 'use-cases' });
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

  // Real-time calculations for Progress Meters
  const hasIndustry = !!answers['industry'];

  // Persona Coverage
  const personaCoverage = !hasIndustry ? 0 : selectedPersonas.length > 0
    ? Math.min(100, Math.round((selectedPersonas.length / 6) * 100))
    : selectedClusters.length > 0
    ? Math.min(100, selectedClusters.length * 25)
    : 0;

  // Use-Case Coverage
  const useCaseCoverage = !hasIndustry ? 0 : selectedUseCases.length > 0
    ? Math.min(100, Math.round((selectedUseCases.length / 5) * 100))
    : 0;

  // Governance Risk
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

  // Adoption Difficulty
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

  // Value Potential
  const valuePotential = !hasIndustry ? 0 : (selectedUseCases.length > 0 || selectedOutcomes.length > 0)
    ? Math.min(100, Math.round((selectedUseCases.length * 15) + (selectedPersonas.length * 8) + (selectedOutcomes.length * 15)))
    : 0;

  // Radar Chart Axes
  // 1. Governance Tolerance
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

  // 2. Risk Posture
  const riskPosture = !hasIndustry ? 0 : governanceRisk > 0 ? governanceRisk : (selectedSensitivities.length > 0 ? sensScore : 0);

  // 3. Adoption Friction
  const adoptionFriction = !hasIndustry ? 0 : adoptionDifficulty;

  // 4. Use-Case Feasibility
  const useCaseFeasibility = !hasIndustry ? 0 : selectedUseCases.length > 0
    ? Math.min(100, Math.max(10, Math.round(useCaseCoverage * 0.7 + (answers['workflow'] === 'highly_structured' ? 30 : 15))))
    : 0;

  // 5. Persona Complexity
  const personaComplexity = !hasIndustry ? 0 : selectedPersonas.length > 0
    ? Math.min(100, Math.round(selectedPersonas.length * 15 + selectedClusters.length * 10))
    : selectedClusters.length > 0
    ? selectedClusters.length * 20
    : 0;

  // 6. Value Levers
  const valueLevers = !hasIndustry ? 0 : valuePotential;

  // Readiness Score
  const readinessScore = (!hasIndustry || summaryItems.length <= 1)
    ? 0
    : Math.min(100, Math.max(0, Math.round(
        (useCaseFeasibility * 0.25) +
        (personaCoverage * 0.20) +
        (valuePotential * 0.25) +
        ((100 - governanceRisk) * 0.15) +
        ((100 - adoptionDifficulty) * 0.15)
      )));

  const radarData = [
    { axis: 'Governance Tolerance', val: governanceTolerance },
    { axis: 'Risk Posture', val: riskPosture },
    { axis: 'Adoption Friction', val: adoptionFriction },
    { axis: 'Use-Case Feasibility', val: useCaseFeasibility },
    { axis: 'Persona Complexity', val: personaComplexity },
    { axis: 'Value Levers', val: valueLevers },
  ];

  // SVG Circle parameters for Section B Readiness Score Gauge
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (readinessScore / 100) * circumference;

  return (
    <aside className="w-80 bg-[#111111] border-l border-[#2D2D2D] p-4 flex flex-col justify-between shrink-0 overflow-y-auto scrollbar-thin select-none">
      <div className="space-y-5">
        {/* Title */}
        <div className="flex items-center justify-between pb-2 border-b border-[#2D2D2D]">
          <h2 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#0078D4] animate-pulse"></span>
            Based on your answers
          </h2>
          <span className="text-[10px] font-mono text-[#0078D4] font-semibold bg-[#0078D4]/10 px-2 py-0.5 rounded border border-[#0078D4]/30">
            Real-Time
          </span>
        </div>

        {/* SECTION A: Answer Summary */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-bold text-[#A1A1A1]">
            <span>Section A: Answer Summary</span>
            <span className="text-[10px] font-mono text-[#666666]">{summaryItems.length} selected</span>
          </div>

          <div className="p-3 bg-[#161616] border border-[#2D2D2D] rounded-lg max-h-36 overflow-y-auto scrollbar-thin space-y-1.5">
            {summaryItems.length > 0 ? (
              summaryItems.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] gap-2 py-0.5 border-b border-[#222222] last:border-none">
                  <span className="text-[#888888] font-mono text-[10px] shrink-0">{item.label}:</span>
                  <span className="text-white font-semibold truncate text-[11px] text-right">{item.value}</span>
                </div>
              ))
            ) : (
              <div className="text-center py-3 text-xs text-[#555555] italic">
                No answers selected yet. Select tiles to build your baseline.
              </div>
            )}
          </div>
        </div>

        {/* SECTION B: Readiness Score (Circular Gauge) */}
        <div className="space-y-2 bg-[#161616] border border-[#2D2D2D] p-3.5 rounded-lg">
          <div className="flex items-center justify-between text-[11px] font-bold text-[#A1A1A1]">
            <span>Section B: Readiness Score</span>
            <span className="text-[10px] font-mono text-[#0078D4] font-semibold">0 – 100</span>
          </div>

          <div className="flex items-center justify-center gap-4 pt-1">
            <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
              <svg className="w-24 h-24 transform -rotate-90">
                {/* Background Arc */}
                <circle
                  cx="48"
                  cy="48"
                  r={radius}
                  stroke="#222222"
                  strokeWidth="7"
                  fill="transparent"
                />
                {/* Score Arc */}
                <circle
                  cx="48"
                  cy="48"
                  r={radius}
                  stroke={readinessScore > 70 ? '#10B981' : readinessScore > 40 ? '#0078D4' : '#F59E0B'}
                  strokeWidth="7"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  fill="transparent"
                  className="transition-all duration-500 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-extrabold text-white font-mono tracking-tighter">
                  {readinessScore}
                </span>
                <span className="text-[9px] text-[#888888] font-mono uppercase tracking-widest">
                  / 100
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-bold text-white">
                {readinessScore >= 75 ? 'High Readiness' : readinessScore >= 45 ? 'Moderate Readiness' : readinessScore > 0 ? 'Initial Baseline' : 'Not Calculated'}
              </div>
              <p className="text-[10px] text-[#A1A1A1] leading-relaxed">
                {readinessScore >= 75
                  ? 'Strong alignment across use cases, governance & personas.'
                  : readinessScore >= 45
                  ? 'Promising foundation with manageable adoption friction.'
                  : readinessScore > 0
                  ? 'Baseline inputs recorded. Complete remaining questions.'
                  : 'Select industry and persona parameters to initiate scoring.'}
              </p>
            </div>
          </div>
        </div>

        {/* SECTION C: Multi-Dimension Radar Chart */}
        <div className="space-y-2 bg-[#161616] border border-[#2D2D2D] p-3 rounded-lg">
          <div className="flex items-center justify-between text-[11px] font-bold text-[#A1A1A1]">
            <span>Section C: Multi-Dimension Assessment</span>
            <Sparkles className="w-3.5 h-3.5 text-[#0078D4]" />
          </div>

          <div className="h-44 w-full relative">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="65%" data={radarData}>
                <PolarGrid stroke="#2A2A2A" />
                <PolarAngleAxis
                  dataKey="axis"
                  tick={{ fill: '#888888', fontSize: 8 }}
                />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar
                  name="Assessment Score"
                  dataKey="val"
                  stroke="#0078D4"
                  fill="#0078D4"
                  fillOpacity={0.35}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* SECTION D: Progress Meters */}
        <div className="space-y-2 bg-[#161616] border border-[#2D2D2D] p-3.5 rounded-lg">
          <div className="flex items-center justify-between text-[11px] font-bold text-[#A1A1A1] mb-2">
            <span>Section D: Progress Meters</span>
            <Activity className="w-3.5 h-3.5 text-[#0078D4]" />
          </div>

          <div className="space-y-2.5">
            {/* Persona Coverage */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-semibold">
                <span className="text-[#CCCCCC]">Persona Coverage</span>
                <span className="font-mono text-[#0078D4]">{personaCoverage}%</span>
              </div>
              <div className="w-full h-1.5 bg-[#222222] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#0078D4] transition-all duration-300"
                  style={{ width: `${personaCoverage}%` }}
                />
              </div>
            </div>

            {/* Use-Case Coverage */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-semibold">
                <span className="text-[#CCCCCC]">Use-Case Coverage</span>
                <span className="font-mono text-emerald-400">{useCaseCoverage}%</span>
              </div>
              <div className="w-full h-1.5 bg-[#222222] rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${useCaseCoverage}%` }}
                />
              </div>
            </div>

            {/* Governance Risk */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-semibold">
                <span className="text-[#CCCCCC]">Governance Risk</span>
                <span className="font-mono text-amber-400">{governanceRisk}%</span>
              </div>
              <div className="w-full h-1.5 bg-[#222222] rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${governanceRisk}%` }}
                />
              </div>
            </div>

            {/* Adoption Difficulty */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-semibold">
                <span className="text-[#CCCCCC]">Adoption Difficulty</span>
                <span className="font-mono text-rose-400">{adoptionDifficulty}%</span>
              </div>
              <div className="w-full h-1.5 bg-[#222222] rounded-full overflow-hidden">
                <div
                  className="h-full bg-rose-500 transition-all duration-300"
                  style={{ width: `${adoptionDifficulty}%` }}
                />
              </div>
            </div>

            {/* Value Potential */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-semibold">
                <span className="text-[#CCCCCC]">Value Potential</span>
                <span className="font-mono text-purple-400">{valuePotential}%</span>
              </div>
              <div className="w-full h-1.5 bg-[#222222] rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 transition-all duration-300"
                  style={{ width: `${valuePotential}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Note on Screen 12 or Footer */}
        {isReviewScreen ? (
          <div className="p-3 bg-[#0078D4]/10 border border-[#0078D4]/40 rounded-lg text-xs text-[#0078D4] space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>Assessment Baseline Set</span>
            </div>
            <p className="text-[11px] text-[#A1A1A1] leading-relaxed">
              This self-assessment score ({readinessScore}/100) will be compared to your actual tenant telemetry score in the next step.
            </p>
          </div>
        ) : (
          <div className="p-3 bg-[#161616] border border-[#2D2D2D] rounded-lg text-[10px] font-mono text-[#666666] leading-relaxed">
            EVALUATION ARCHITECTURE:
            <br />
            Adaptive Multi-Persona Matrix v5.0
          </div>
        )}
      </div>
    </aside>
  );
};
