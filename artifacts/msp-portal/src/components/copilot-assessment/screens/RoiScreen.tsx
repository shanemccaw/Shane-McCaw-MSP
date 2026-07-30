import React, { useState } from 'react';
import { RoiState } from '../types';
import { 
  TrendingUp, 
  DollarSign, 
  Clock, 
  Zap, 
  Users, 
  Sliders, 
  Sparkles, 
  ArrowRight, 
  BarChart2, 
  PieChart as PieChartIcon, 
  Layers, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  X, 
  Briefcase, 
  FileText, 
  ShieldCheck,
  TrendingDown,
  Activity,
  Award,
  HelpCircle
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  Cell, 
  AreaChart, 
  Area, 
  RadialBarChart, 
  RadialBar,
  Legend
} from 'recharts';

interface RoiScreenProps {
  roi?: RoiState;
  onUpdateRoi?: (updated: Partial<RoiState>) => void;
  onContinue: () => void;
  onHelpClick?: () => void;
  onExitClick?: () => void;
  onNavigate?: (step: string) => void;
}

export const RoiScreen: React.FC<RoiScreenProps> = ({
  roi,
  onUpdateRoi,
  onContinue,
  onHelpClick,
  onExitClick,
  onNavigate
}) => {
  // Simulation Control States
  const [adoptionRate, setAdoptionRate] = useState<number>(roi?.adoptionRate ?? 75); // 0 - 100%
  const [automationLevel, setAutomationLevel] = useState<number>(60); // 0 - 100%
  const [draftingReduction, setDraftingReduction] = useState<number>(35); // 0 - 50%
  const [researchReduction, setResearchReduction] = useState<number>(30); // 0 - 50%
  const [meetingReduction, setMeetingReduction] = useState<number>(20); // 0 - 30%

  // Toggles State
  const [allPersonas, setAllPersonas] = useState<boolean>(true);
  const [highRoiOnly, setHighRoiOnly] = useState<boolean>(false);
  const [eliminateWaste, setEliminateWaste] = useState<boolean>(true);
  const [applyGovernance, setApplyGovernance] = useState<boolean>(true);

  // Clicked Left Panel Section Highlight State
  const [highlightedCategory, setHighlightedCategory] = useState<string | null>('personas');

  // Math Calculations for Dynamic Metrics
  // Base seats = 500
  const totalSeats = 500;
  const activeAdopters = Math.round(totalSeats * (adoptionRate / 100));
  
  // Base multipliers based on toggles
  const personaMultiplier = highRoiOnly ? 1.25 : allPersonas ? 1.0 : 0.85;
  const governanceMultiplier = applyGovernance ? 1.30 : 1.0; // Governance unlocks full Graph indexing & trust

  // Total Hours Saved per month calculation
  // Baseline avg hours saved per active user/mo = 12 hrs
  const hoursSavedPerUserMonth = (
    (draftingReduction * 0.22 + researchReduction * 0.18 + meetingReduction * 0.15 + (automationLevel / 100) * 8)
    * personaMultiplier * governanceMultiplier
  );

  const totalMonthlyHoursSaved = Math.round(activeAdopters * hoursSavedPerUserMonth);
  const fteEquivalent = (totalMonthlyHoursSaved / 160).toFixed(1);

  // Cost Savings calculation ($65/hr fully loaded blend rate)
  const hourlyRate = 65;
  const monthlySavingsDollars = totalMonthlyHoursSaved * hourlyRate;
  const annualSavingsDollars = monthlySavingsDollars * 12;

  // License Waste Reduction
  const unusedLicenses = 85;
  const wasteEliminatedDollars = eliminateWaste ? unusedLicenses * 30 * 12 : 0; // $30/mo Copilot M365 license
  const totalAnnualValue = annualSavingsDollars + wasteEliminatedDollars;

  // Overall Efficiency Gain %
  const baseEfficiencyGain = Math.round(
    ((adoptionRate / 100) * 15) + ((automationLevel / 100) * 12) + (draftingReduction * 0.25) + (researchReduction * 0.2)
  );
  const efficiencyGainPct = Math.min(65, Math.max(8, Math.round(baseEfficiencyGain * personaMultiplier * (applyGovernance ? 1.15 : 1.0))));

  // Dynamic Chart Data Generation
  // 1. Time Saved by Persona (Bar Chart)
  const personaTimeSavedData = [
    { persona: 'Engineering', hrsSaved: Math.round(hoursSavedPerUserMonth * 1.35 * 32), color: 'hsl(var(--primary))' },
    { persona: 'HR & Ops', hrsSaved: Math.round(hoursSavedPerUserMonth * 1.45 * 28), color: 'hsl(var(--status-green))' },
    { persona: 'Sales & Mktg', hrsSaved: Math.round(hoursSavedPerUserMonth * 1.20 * 35), color: 'hsl(var(--status-teal))' },
    { persona: 'Legal & Risk', hrsSaved: Math.round(hoursSavedPerUserMonth * 1.50 * 15), color: 'hsl(var(--accent))' },
  ];

  // 2. Cumulative Annual Financial Growth (Area Chart)
  const financialGrowthData = [
    { quarter: 'Q1 Launch', savings: Math.round((annualSavingsDollars * 0.12) / 1000), wasteCut: Math.round(wasteEliminatedDollars * 0.25 / 1000) },
    { quarter: 'Q2 Wave 1', savings: Math.round((annualSavingsDollars * 0.35) / 1000), wasteCut: Math.round(wasteEliminatedDollars * 0.50 / 1000) },
    { quarter: 'Q3 Enterprise', savings: Math.round((annualSavingsDollars * 0.68) / 1000), wasteCut: Math.round(wasteEliminatedDollars * 0.75 / 1000) },
    { quarter: 'Q4 Full ROI', savings: Math.round((annualSavingsDollars * 1.0) / 1000), wasteCut: Math.round(wasteEliminatedDollars * 1.0 / 1000) },
  ];

  // 3. License Utilization Waste Chart
  const licenseChartData = [
    { category: 'Active Adopters', count: activeAdopters, color: 'hsl(var(--status-green))' },
    { category: 'Underutilized', count: Math.max(0, totalSeats - activeAdopters - (eliminateWaste ? 0 : unusedLicenses)), color: 'hsl(var(--status-amber))' },
    { category: 'Reclaimed / Cut', count: eliminateWaste ? unusedLicenses : 0, color: 'hsl(var(--primary))' },
    { category: 'Unassigned Waste', count: eliminateWaste ? 0 : unusedLicenses, color: 'hsl(var(--primary))' },
  ];

  // 4. Workflow Automation Potential (Stacked Bar)
  const workflowData = [
    { workflow: 'Drafting', current: 14.2, reduced: (14.2 * (1 - draftingReduction / 100)).toFixed(1) },
    { workflow: 'Research', current: 11.5, reduced: (11.5 * (1 - researchReduction / 100)).toFixed(1) },
    { workflow: 'Summary', current: 8.8, reduced: (8.8 * (1 - (draftingReduction + 15) / 100)).toFixed(1) },
    { workflow: 'App Sync', current: 5.2, reduced: (5.2 * (1 - (automationLevel / 200))).toFixed(1) },
  ];

  // Dynamic Story Narrative
  const generateRoiStory = () => {
    return {
      overview: `Copilot generates substantial measurable value across this tenant by automating repetitive drafting, synthesis, and search tasks for ${activeAdopters} active users.`,
      topPersonas: `HR, Legal, and Engineering exhibit the highest productivity gains, reclaiming up to ${(hoursSavedPerUserMonth * 1.4).toFixed(1)} hours per employee every month.`,
      workflowImpact: `Document drafting and research workflows experience the sharpest cycle-time reductions (${draftingReduction}% and ${researchReduction}% respectively).`,
      governanceUnlock: applyGovernance 
        ? `Enforcing Purview auto-labeling and Zero Trust CA01 unlocks full Graph connector indexing safely, boosting net ROI by an additional 30%.`
        : `Unmitigated governance gaps constrain Copilot scope, leaving 30% potential value locked behind data access restrictions.`,
      punchline: `Your organization stands to reclaim ${totalMonthlyHoursSaved.toLocaleString()} hours per month, equivalent to ${fteEquivalent} full-time FTEs and $${(totalAnnualValue / 1000).toFixed(0)}k in total annual value.`
    };
  };

  const story = generateRoiStory();

  // Reset controls
  const handleReset = () => {
    setAdoptionRate(75);
    setAutomationLevel(60);
    setDraftingReduction(35);
    setResearchReduction(30);
    setMeetingReduction(20);
    setAllPersonas(true);
    setHighRoiOnly(false);
    setEliminateWaste(true);
    setApplyGovernance(true);
    if (onUpdateRoi) {
      onUpdateRoi({
        adoptionRate: 75,
        personaCoverage: 80,
        useCaseIntensity: 70
      });
    }
  };

  return (
    <div className="h-screen w-screen bg-background text-foreground flex flex-col font-sans overflow-hidden antialiased select-none relative">
      
      {/* ==================================================================== */}
      {/* TOP NAVBAR / CONTROL TOOLBAR                                         */}
      {/* ==================================================================== */}
      <header className="h-14 bg-background/95 border-b border-border px-5 flex items-center justify-between shrink-0 z-30 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-status-green border border-status-green/50 flex items-center justify-center text-status-green shadow-[0_0_15px_rgba(16,185,129,0.3)]">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-black uppercase tracking-wider text-foreground">
                Microsoft Copilot Value Engine
              </span>
              <span className="text-[10px] font-mono bg-status-green/20 text-status-green border border-status-green/40 px-2 py-0.5 rounded font-extrabold">
                ENTERPRISE ROI & PRODUCTIVITY MODEL
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Interactive Financial Projection • Real-Time FTE & Cost Avoidance Simulator
            </p>
          </div>
        </div>

        {/* Center Total Value Badge */}
        <div className="hidden lg:flex items-center space-x-3 bg-muted/60 px-4 py-1.5 rounded-xl border border-border">
          <span className="text-[10px] font-mono uppercase text-muted-foreground font-bold">
            Projected Annual Value:
          </span>
          <div className="flex items-center space-x-2">
            <span className="text-sm font-mono font-black text-status-green">
              ${(totalAnnualValue / 1000).toFixed(0)}k / yr
            </span>
            <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border bg-status-green/15 text-status-green border-status-green/30">
              +{efficiencyGainPct}% Efficiency
            </span>
          </div>
        </div>

        {/* Right Actions & Presets */}
        <div className="flex items-center space-x-3">
          <button
            onClick={handleReset}
            className="flex items-center space-x-1.5 text-[10px] font-mono text-muted-foreground hover:text-foreground bg-secondary border border-border px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset Model</span>
          </button>

          <button
            onClick={onContinue}
            className="flex items-center space-x-2 bg-gradient-to-r from-status-green via-status-teal to-accent hover:from-status-green hover:to-accent text-primary-foreground font-extrabold px-4 py-1.5 rounded-lg text-xs transition-all shadow-lg shadow-status-green/50 cursor-pointer border border-border"
          >
            <span>Generate Document Deliverables</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          {onExitClick && (
            <button
              onClick={onExitClick}
              className="p-1.5 hover:bg-secondary text-muted-foreground hover:text-foreground rounded-lg border border-border transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* ==================================================================== */}
      {/* THREE-PANEL BODY LAYOUT                                              */}
      {/* ==================================================================== */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* ================================================================== */}
        {/* LEFT PANEL — ROI INPUTS (STATIC + CLICKABLE)                      */}
        {/* ================================================================== */}
        <aside className="w-80 bg-sidebar/95 border-r border-border p-3.5 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-3 z-20">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <span className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <Briefcase className="w-4 h-4 text-status-green" />
              <span>ROI Inputs & Telemetry</span>
            </span>
            <span className="text-[9px] font-mono text-muted-foreground bg-secondary border border-border px-2 py-0.5 rounded">
              Viva Insights
            </span>
          </div>

          <div className="space-y-2.5">

            {/* Section 1: Personas & Workflows */}
            <div
              onClick={() => setHighlightedCategory('personas')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedCategory === 'personas'
                  ? 'bg-background border-status-green ring-1 ring-status-green/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'bg-background border-border hover:border-border'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-primary" />
                  1. Personas & Workflows
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-status-green text-status-green border-status-green/30 font-bold">
                  High ROI
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-muted-foreground pt-1">
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Personas Selected:</span>
                  <span className="text-primary font-bold">4 Key Cohorts</span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Workflows Analyzed:</span>
                  <span className="text-status-green font-bold">18 Workflows</span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Complexity Score:</span>
                  <span className="text-foreground">7.4 / 10</span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Automation Potential:</span>
                  <span className="text-accent font-bold">68% Potential</span>
                </div>
              </div>
            </div>

            {/* Section 2: Time & Productivity Metrics */}
            <div
              onClick={() => setHighlightedCategory('time')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedCategory === 'time'
                  ? 'bg-background border-status-green ring-1 ring-status-green/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'bg-background border-border hover:border-border'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-status-amber" />
                  2. Time & Productivity Metrics
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-status-amber/10 text-status-amber border-status-amber/30 font-bold">
                  High Impact
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-muted-foreground pt-1">
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Avg Drafting Time:</span>
                  <span className="text-status-amber font-bold">14.2 hrs/wk</span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Avg Research Time:</span>
                  <span className="text-status-amber font-bold">11.5 hrs/wk</span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Avg Summarizing:</span>
                  <span className="text-foreground">8.8 hrs/wk</span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">App Switching Load:</span>
                  <span className="text-destructive font-bold">5.2 hrs/wk</span>
                </div>
              </div>
            </div>

            {/* Section 3: Collaboration & Communication Load */}
            <div
              onClick={() => setHighlightedCategory('collab')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedCategory === 'collab'
                  ? 'bg-background border-status-green ring-1 ring-status-green/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'bg-background border-border hover:border-border'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-accent" />
                  3. Collaboration Load
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-primary text-primary border-primary/30 font-bold">
                  Moderate ROI
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-muted-foreground pt-1">
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Emails / User / Day:</span>
                  <span className="text-foreground">64 emails</span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Teams Msgs / Day:</span>
                  <span className="text-foreground">128 msgs</span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Meetings / Week:</span>
                  <span className="text-status-amber font-bold">18 meetings</span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Docs Created / Mo:</span>
                  <span className="text-status-green">32 docs</span>
                </div>
              </div>
            </div>

            {/* Section 4: License Utilization */}
            <div
              onClick={() => setHighlightedCategory('license')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedCategory === 'license'
                  ? 'bg-background border-status-green ring-1 ring-status-green/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'bg-background border-border hover:border-border'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-status-green" />
                  4. License Utilization
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-destructive/10 text-destructive border-destructive/30 font-bold">
                  Opportunity
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-muted-foreground pt-1">
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Purchased Seats:</span>
                  <span className="text-foreground font-bold">500 seats</span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Active Adopters:</span>
                  <span className="text-status-green font-bold">{activeAdopters} seats</span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Unused Seats:</span>
                  <span className={eliminateWaste ? 'text-status-green' : 'text-destructive font-bold'}>
                    {unusedLicenses} seats
                  </span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80">
                  <span className="text-muted-foreground block">Underutilized:</span>
                  <span className="text-status-amber">120 seats</span>
                </div>
              </div>
            </div>

            {/* Section 5: Telemetry Signals */}
            <div
              onClick={() => setHighlightedCategory('telemetry')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedCategory === 'telemetry'
                  ? 'bg-background border-status-green ring-1 ring-status-green/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'bg-background border-border hover:border-border'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-accent" />
                  5. Telemetry Signals
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-accent text-accent border-accent font-bold">
                  Target Focus
                </span>
              </div>
              <div className="space-y-1 text-[10px] font-mono text-muted-foreground pt-1">
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80 flex justify-between">
                  <span className="text-muted-foreground">Drafting-heavy:</span>
                  <span className="text-primary font-bold">Engineering, Legal, Sales</span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80 flex justify-between">
                  <span className="text-muted-foreground">Research-heavy:</span>
                  <span className="text-accent font-bold">Strategy, Compliance, R&D</span>
                </div>
                <div className="bg-secondary/80 p-1.5 rounded border border-border/80 flex justify-between">
                  <span className="text-muted-foreground">Comm-heavy:</span>
                  <span className="text-accent font-bold">PMO, HR, Operations</span>
                </div>
              </div>
            </div>

          </div>
        </aside>

        {/* ================================================================== */}
        {/* CENTER PANEL — ROI STORY + VALUE CHARTS + SIMULATION ENGINE         */}
        {/* ================================================================== */}
        <main className="flex-1 overflow-y-auto bg-background p-5 flex flex-col relative scrollbar-thin space-y-6">

          {/* -------------------------------------------------------------- */}
          {/* LAYER 1: SHORT ROI STORY (TOP OF CENTER PANEL)                  */}
          {/* -------------------------------------------------------------- */}
          <section className="bg-gradient-to-r from-secondary/90 via-background to-secondary/90 border border-status-green/30 rounded-2xl p-4 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between pb-2 border-b border-border mb-3">
              <span className="text-xs font-extrabold uppercase tracking-widest text-status-green flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-status-green animate-spin-slow" />
                <span>Executive Copilot Value Narrative & Business Justification</span>
              </span>
              <span className="text-[9.5px] font-mono px-2.5 py-0.5 rounded-full border bg-status-green text-status-green border-status-green font-bold">
                EXECUTIVE-READY
              </span>
            </div>

            <div className="space-y-2 text-xs leading-relaxed text-foreground font-normal">
              <p><strong className="text-foreground">Tenant Value Creation:</strong> {story.overview}</p>
              <p><strong className="text-foreground">Top Benefiting Personas:</strong> {story.topPersonas}</p>
              <p><strong className="text-foreground">Workflow Cycle Reduction:</strong> {story.workflowImpact}</p>
              <p><strong className="text-foreground">Governance Unlock Effect:</strong> {story.governanceUnlock}</p>
              <div className="mt-3 pt-2 border-t border-border flex items-center justify-between text-xs font-bold text-status-green font-mono">
                <span>⚡ Value Punchline: {story.punchline}</span>
                <span className="text-[10px] text-muted-foreground">Microsoft Viva Insights & Forrester Methodology</span>
              </div>
            </div>
          </section>

          {/* -------------------------------------------------------------- */}
          {/* LAYER 2: ROI VALUE CHARTS (MIDDLE OF CENTER PANEL)             */}
          {/* -------------------------------------------------------------- */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-foreground flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-primary" />
                <span>Microsoft Fluent UI Value & Productivity Visualizations</span>
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">
                Interactive Charting Engine
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Chart 1: Time Saved by Persona */}
              <div className="bg-background border border-border rounded-2xl p-4 shadow-xl space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-primary" />
                    1. Monthly Time Saved by Persona (Hours)
                  </span>
                  <span className="text-[10px] font-mono text-primary font-bold">
                    Total: {totalMonthlyHoursSaved.toLocaleString()} hrs/mo
                  </span>
                </div>
                <div className="h-48 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={personaTimeSavedData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                      <XAxis dataKey="persona" stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                      <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
                        itemStyle={{ color: 'hsl(var(--primary))' }}
                      />
                      <Bar dataKey="hrsSaved" radius={[6, 6, 0, 0]}>
                        {personaTimeSavedData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 2: Cumulative Annual Financial Growth */}
              <div className="bg-background border border-border rounded-2xl p-4 shadow-xl space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-status-green" />
                    2. Projected Financial Value ($k)
                  </span>
                  <span className="text-[10px] font-mono text-status-green font-bold">
                    Net: ${(totalAnnualValue / 1000).toFixed(0)}k / yr
                  </span>
                </div>
                <div className="h-48 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={financialGrowthData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                      <XAxis dataKey="quarter" stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                      <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
                      />
                      <Area type="monotone" dataKey="savings" name="Productivity Value ($k)" stroke="hsl(var(--status-green))" fill="hsl(var(--status-green))" fillOpacity={0.35} />
                      <Area type="monotone" dataKey="wasteCut" name="Waste Eliminated ($k)" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 3: License Utilization & Waste Optimization */}
              <div className="bg-background border border-border rounded-2xl p-4 shadow-xl space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <PieChartIcon className="w-3.5 h-3.5 text-accent" />
                    3. License Allocation & Waste Optimization
                  </span>
                  <span className="text-[10px] font-mono text-accent font-bold">
                    {totalSeats} Total Licenses
                  </span>
                </div>
                <div className="h-48 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={licenseChartData} layout="vertical" margin={{ top: 5, right: 20, left: 25, bottom: 5 }}>
                      <XAxis type="number" stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                      <YAxis dataKey="category" type="category" stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
                      />
                      <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                        {licenseChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 4: Workflow Automation Potential */}
              <div className="bg-background border border-border rounded-2xl p-4 shadow-xl space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-status-amber" />
                    4. Workflow Time Before vs After Copilot (hrs/wk)
                  </span>
                  <span className="text-[10px] font-mono text-status-amber font-bold">
                    -{draftingReduction}% Drafting Cycle
                  </span>
                </div>
                <div className="h-48 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={workflowData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                      <XAxis dataKey="workflow" stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                      <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
                      />
                      <Bar dataKey="current" name="Legacy Hrs" fill="hsl(var(--border))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="reduced" name="With Copilot" fill="hsl(var(--status-green))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>
          </section>

          {/* -------------------------------------------------------------- */}
          {/* LAYER 3: ROI SIMULATION ENGINE (BOTTOM OF CENTER PANEL)         */}
          {/* -------------------------------------------------------------- */}
          <section className="bg-background border border-border rounded-2xl p-5 shadow-2xl relative space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-status-green" />
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-foreground">
                  Executive ROI Simulation Parameters
                </h2>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground bg-secondary border border-border px-2.5 py-1 rounded">
                Real-Time Recalculation
              </span>
            </div>

            {/* Sliders Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

              {/* Slider 1: Adoption Rate */}
              <div className="p-3.5 rounded-xl border bg-secondary/80 border-border space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground block">Increase Copilot Adoption</label>
                  <span className="text-xs font-mono font-bold text-status-green">{adoptionRate}%</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={adoptionRate}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setAdoptionRate(val);
                    if (onUpdateRoi) onUpdateRoi({ adoptionRate: val });
                  }}
                  className="w-full accent-status-green bg-secondary h-1.5 rounded-lg cursor-pointer"
                />
                <span className="text-[10px] text-muted-foreground block">{activeAdopters} active users of {totalSeats} seats</span>
              </div>

              {/* Slider 2: Increase Workflow Automation */}
              <div className="p-3.5 rounded-xl border bg-secondary/80 border-border space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground block">Increase Workflow Automation</label>
                  <span className="text-xs font-mono font-bold text-primary">{automationLevel}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={automationLevel}
                  onChange={(e) => setAutomationLevel(Number(e.target.value))}
                  className="w-full accent-primary bg-secondary h-1.5 rounded-lg cursor-pointer"
                />
                <span className="text-[10px] text-muted-foreground block">Deploy custom Copilot Studio agent triggers</span>
              </div>

              {/* Slider 3: Reduce Drafting Time */}
              <div className="p-3.5 rounded-xl border bg-secondary/80 border-border space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground block">Reduce Drafting Time</label>
                  <span className="text-xs font-mono font-bold text-status-amber">-{draftingReduction}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={draftingReduction}
                  onChange={(e) => setDraftingReduction(Number(e.target.value))}
                  className="w-full accent-status-amber bg-secondary h-1.5 rounded-lg cursor-pointer"
                />
                <span className="text-[10px] text-muted-foreground block">Accelerate Word & Outlook first-draft generation</span>
              </div>

              {/* Slider 4: Reduce Research Time */}
              <div className="p-3.5 rounded-xl border bg-secondary/80 border-border space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground block">Reduce Research Time</label>
                  <span className="text-xs font-mono font-bold text-accent">-{researchReduction}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={researchReduction}
                  onChange={(e) => setResearchReduction(Number(e.target.value))}
                  className="w-full accent-accent bg-secondary h-1.5 rounded-lg cursor-pointer"
                />
                <span className="text-[10px] text-muted-foreground block">Instant search across SharePoint & Web grounding</span>
              </div>

              {/* Slider 5: Reduce Meeting Load */}
              <div className="p-3.5 rounded-xl border bg-secondary/80 border-border space-y-2 lg:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground block">Reduce Meeting Load</label>
                  <span className="text-xs font-mono font-bold text-accent">-{meetingReduction}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="30"
                  value={meetingReduction}
                  onChange={(e) => setMeetingReduction(Number(e.target.value))}
                  className="w-full accent-accent bg-secondary h-1.5 rounded-lg cursor-pointer"
                />
                <span className="text-[10px] text-muted-foreground block">Asynchronous recap & intelligent action item synthesis in Teams</span>
              </div>

            </div>

            {/* Toggles Bar */}
            <div className="pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              
              {/* Toggle 1: All Personas */}
              <div className="flex items-center justify-between bg-secondary p-2.5 rounded-xl border border-border">
                <span className="text-[11px] font-bold text-foreground">Enable All Personas</span>
                <button
                  onClick={() => {
                    setAllPersonas(!allPersonas);
                    if (!allPersonas) setHighRoiOnly(false);
                  }}
                  className={`w-10 h-5 rounded-full transition-colors p-0.5 flex items-center ${
                    allPersonas ? 'bg-status-green justify-end' : 'bg-secondary justify-start'
                  }`}
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>

              {/* Toggle 2: High ROI Personas Only */}
              <div className="flex items-center justify-between bg-secondary p-2.5 rounded-xl border border-border">
                <span className="text-[11px] font-bold text-foreground">High-ROI Cohorts Only</span>
                <button
                  onClick={() => {
                    setHighRoiOnly(!highRoiOnly);
                    if (!highRoiOnly) setAllPersonas(false);
                  }}
                  className={`w-10 h-5 rounded-full transition-colors p-0.5 flex items-center ${
                    highRoiOnly ? 'bg-primary justify-end' : 'bg-secondary justify-start'
                  }`}
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>

              {/* Toggle 3: Eliminate License Waste */}
              <div className="flex items-center justify-between bg-secondary p-2.5 rounded-xl border border-border">
                <span className="text-[11px] font-bold text-foreground">Eliminate License Waste</span>
                <button
                  onClick={() => setEliminateWaste(!eliminateWaste)}
                  className={`w-10 h-5 rounded-full transition-colors p-0.5 flex items-center ${
                    eliminateWaste ? 'bg-accent justify-end' : 'bg-secondary justify-start'
                  }`}
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>

              {/* Toggle 4: Apply Governance Fixes */}
              <div className="flex items-center justify-between bg-secondary p-2.5 rounded-xl border border-border">
                <span className="text-[11px] font-bold text-foreground">Apply Governance Fixes</span>
                <button
                  onClick={() => setApplyGovernance(!applyGovernance)}
                  className={`w-10 h-5 rounded-full transition-colors p-0.5 flex items-center ${
                    applyGovernance ? 'bg-status-green justify-end' : 'bg-secondary justify-start'
                  }`}
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>

            </div>
          </section>

        </main>

        {/* ================================================================== */}
        {/* RIGHT PANEL — ROI SUMMARY (DYNAMIC)                                */}
        {/* ================================================================== */}
        <aside className="w-84 bg-sidebar/95 border-l border-border p-4 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-4 z-20">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <span className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <Award className="w-4 h-4 text-status-green" />
              <span>ROI Financial Summary</span>
            </span>
            <span className="text-[9px] font-mono text-status-green bg-status-green/15 border border-status-green/30 px-2 py-0.5 rounded">
              Dynamic Realtime
            </span>
          </div>

          <div className="space-y-3">

            {/* 1. Total Time Saved */}
            <div className="p-3.5 rounded-xl bg-secondary/90 border border-border space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-primary font-bold block">
                Total Time Saved
              </span>
              <p className="text-lg font-mono font-black text-foreground">
                {totalMonthlyHoursSaved.toLocaleString()} <span className="text-xs text-muted-foreground font-sans font-normal">hrs / month</span>
              </p>
              <div className="flex items-center justify-between text-xs font-mono text-status-green font-bold pt-0.5">
                <span>Equivalent to {fteEquivalent} FTEs</span>
                <span className="text-[10px] text-muted-foreground">Reclaimed time</span>
              </div>
            </div>

            {/* 2. Total Cost Savings */}
            <div className="p-3.5 rounded-xl bg-secondary/90 border border-border space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-status-green font-bold block">
                Total Financial Value
              </span>
              <p className="text-lg font-mono font-black text-status-green">
                ${(totalAnnualValue / 1000).toFixed(0)}k <span className="text-xs text-muted-foreground font-sans font-normal">/ year</span>
              </p>
              <div className="space-y-1 text-[10px] font-mono text-muted-foreground pt-1 border-t border-border">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Operational Savings:</span>
                  <span className="text-status-green font-bold">${(annualSavingsDollars / 1000).toFixed(0)}k/yr</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">License Waste Cut:</span>
                  <span className="text-primary font-bold">${(wasteEliminatedDollars / 1000).toFixed(0)}k/yr</span>
                </div>
              </div>
            </div>

            {/* 3. Efficiency Gain */}
            <div className="p-3.5 rounded-xl bg-secondary/90 border border-border space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-accent font-bold block">
                Efficiency Gain
              </span>
              <p className="text-lg font-mono font-black text-accent">
                +{efficiencyGainPct}% <span className="text-xs text-muted-foreground font-sans font-normal">overall uplift</span>
              </p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Reduced cycle time across 5 key enterprise departments with improved output accuracy.
              </p>
            </div>

            {/* 4. Persona Impact */}
            <div className="p-3.5 rounded-xl bg-secondary/90 border border-border space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-status-amber font-bold block">
                Persona Productivity Uplift
              </span>
              <div className="space-y-1 text-[11px] font-mono text-foreground">
                <div className="flex justify-between p-1 bg-secondary rounded border border-border">
                  <span>Engineering:</span>
                  <span className="text-status-green font-bold">+32% productivity</span>
                </div>
                <div className="flex justify-between p-1 bg-secondary rounded border border-border">
                  <span>HR & Ops:</span>
                  <span className="text-status-green font-bold">+41% productivity</span>
                </div>
                <div className="flex justify-between p-1 bg-secondary rounded border border-border">
                  <span>Legal & Compliance:</span>
                  <span className="text-primary font-bold">+27% productivity</span>
                </div>
              </div>
            </div>

            {/* 5. Workflow Impact */}
            <div className="p-3.5 rounded-xl bg-secondary/90 border border-border space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-accent font-bold block">
                Workflow Cycle Reduction
              </span>
              <div className="space-y-1 text-[11px] font-mono text-foreground">
                <div className="flex justify-between p-1 bg-secondary rounded border border-border">
                  <span>Drafting:</span>
                  <span className="text-status-amber font-bold">-{draftingReduction}% cycle time</span>
                </div>
                <div className="flex justify-between p-1 bg-secondary rounded border border-border">
                  <span>Research:</span>
                  <span className="text-accent font-bold">-{researchReduction}% cycle time</span>
                </div>
                <div className="flex justify-between p-1 bg-secondary rounded border border-border">
                  <span>Meeting Load:</span>
                  <span className="text-accent font-bold">-{meetingReduction}% meeting load</span>
                </div>
              </div>
            </div>

          </div>
        </aside>

      </div>

    </div>
  );
};
