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
    { persona: 'Engineering', hrsSaved: Math.round(hoursSavedPerUserMonth * 1.35 * 32), color: '#0078D4' },
    { persona: 'HR & Ops', hrsSaved: Math.round(hoursSavedPerUserMonth * 1.45 * 28), color: '#10B981' },
    { persona: 'Sales & Mktg', hrsSaved: Math.round(hoursSavedPerUserMonth * 1.20 * 35), color: '#00B7C3' },
    { persona: 'Legal & Risk', hrsSaved: Math.round(hoursSavedPerUserMonth * 1.50 * 15), color: '#5C2D91' },
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
    { category: 'Active Adopters', count: activeAdopters, color: '#10B981' },
    { category: 'Underutilized', count: Math.max(0, totalSeats - activeAdopters - (eliminateWaste ? 0 : unusedLicenses)), color: '#FFB900' },
    { category: 'Reclaimed / Cut', count: eliminateWaste ? unusedLicenses : 0, color: '#0078D4' },
    { category: 'Unassigned Waste', count: eliminateWaste ? 0 : unusedLicenses, color: '#F25022' },
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
    <div className="h-screen w-screen bg-[#07090E] text-slate-100 flex flex-col font-sans overflow-hidden antialiased select-none relative">
      
      {/* ==================================================================== */}
      {/* TOP NAVBAR / CONTROL TOOLBAR                                         */}
      {/* ==================================================================== */}
      <header className="h-14 bg-[#0B0F19]/95 border-b border-white/10 px-5 flex items-center justify-between shrink-0 z-30 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-950 border border-emerald-500/50 flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-black uppercase tracking-wider text-white">
                Microsoft Copilot Value Engine
              </span>
              <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded font-extrabold">
                ENTERPRISE ROI & PRODUCTIVITY MODEL
              </span>
            </div>
            <p className="text-[10px] text-slate-400">
              Interactive Financial Projection • Real-Time FTE & Cost Avoidance Simulator
            </p>
          </div>
        </div>

        {/* Center Total Value Badge */}
        <div className="hidden lg:flex items-center space-x-3 bg-black/60 px-4 py-1.5 rounded-xl border border-white/10">
          <span className="text-[10px] font-mono uppercase text-slate-400 font-bold">
            Projected Annual Value:
          </span>
          <div className="flex items-center space-x-2">
            <span className="text-sm font-mono font-black text-emerald-400">
              ${(totalAnnualValue / 1000).toFixed(0)}k / yr
            </span>
            <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border bg-emerald-950/80 text-emerald-300 border-emerald-800">
              +{efficiencyGainPct}% Efficiency
            </span>
          </div>
        </div>

        {/* Right Actions & Presets */}
        <div className="flex items-center space-x-3">
          <button
            onClick={handleReset}
            className="flex items-center space-x-1.5 text-[10px] font-mono text-slate-400 hover:text-white bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset Model</span>
          </button>

          <button
            onClick={onContinue}
            className="flex items-center space-x-2 bg-gradient-to-r from-emerald-500 via-teal-600 to-indigo-600 hover:from-emerald-400 hover:to-indigo-500 text-slate-950 font-extrabold px-4 py-1.5 rounded-lg text-xs transition-all shadow-lg shadow-emerald-950/50 cursor-pointer border border-white/20"
          >
            <span>Generate Document Deliverables</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          {onExitClick && (
            <button
              onClick={onExitClick}
              className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg border border-slate-800 transition-colors cursor-pointer"
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
        <aside className="w-80 bg-[#0A0E17]/95 border-r border-white/10 p-3.5 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-3 z-20">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <Briefcase className="w-4 h-4 text-emerald-400" />
              <span>ROI Inputs & Telemetry</span>
            </span>
            <span className="text-[9px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
              Viva Insights
            </span>
          </div>

          <div className="space-y-2.5">

            {/* Section 1: Personas & Workflows */}
            <div
              onClick={() => setHighlightedCategory('personas')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedCategory === 'personas'
                  ? 'bg-[#0F291E] border-emerald-500 ring-1 ring-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'bg-[#0E131F] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-sky-400" />
                  1. Personas & Workflows
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-emerald-950 text-emerald-300 border-emerald-800 font-bold">
                  High ROI
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-slate-300 pt-1">
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Personas Selected:</span>
                  <span className="text-sky-300 font-bold">4 Key Cohorts</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Workflows Analyzed:</span>
                  <span className="text-emerald-400 font-bold">18 Workflows</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Complexity Score:</span>
                  <span className="text-slate-200">7.4 / 10</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Automation Potential:</span>
                  <span className="text-indigo-300 font-bold">68% Potential</span>
                </div>
              </div>
            </div>

            {/* Section 2: Time & Productivity Metrics */}
            <div
              onClick={() => setHighlightedCategory('time')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedCategory === 'time'
                  ? 'bg-[#0F291E] border-emerald-500 ring-1 ring-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'bg-[#0E131F] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  2. Time & Productivity Metrics
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-amber-950 text-amber-300 border-amber-800 font-bold">
                  High Impact
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-slate-300 pt-1">
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Avg Drafting Time:</span>
                  <span className="text-amber-400 font-bold">14.2 hrs/wk</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Avg Research Time:</span>
                  <span className="text-amber-400 font-bold">11.5 hrs/wk</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Avg Summarizing:</span>
                  <span className="text-slate-200">8.8 hrs/wk</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">App Switching Load:</span>
                  <span className="text-rose-400 font-bold">5.2 hrs/wk</span>
                </div>
              </div>
            </div>

            {/* Section 3: Collaboration & Communication Load */}
            <div
              onClick={() => setHighlightedCategory('collab')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedCategory === 'collab'
                  ? 'bg-[#0F291E] border-emerald-500 ring-1 ring-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'bg-[#0E131F] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-purple-400" />
                  3. Collaboration Load
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-sky-950 text-sky-300 border-sky-800 font-bold">
                  Moderate ROI
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-slate-300 pt-1">
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Emails / User / Day:</span>
                  <span className="text-slate-200">64 emails</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Teams Msgs / Day:</span>
                  <span className="text-slate-200">128 msgs</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Meetings / Week:</span>
                  <span className="text-amber-400 font-bold">18 meetings</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Docs Created / Mo:</span>
                  <span className="text-emerald-400">32 docs</span>
                </div>
              </div>
            </div>

            {/* Section 4: License Utilization */}
            <div
              onClick={() => setHighlightedCategory('license')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedCategory === 'license'
                  ? 'bg-[#0F291E] border-emerald-500 ring-1 ring-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'bg-[#0E131F] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                  4. License Utilization
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-rose-950 text-rose-300 border-rose-800 font-bold">
                  Opportunity
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-slate-300 pt-1">
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Purchased Seats:</span>
                  <span className="text-white font-bold">500 seats</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Active Adopters:</span>
                  <span className="text-emerald-400 font-bold">{activeAdopters} seats</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Unused Seats:</span>
                  <span className={eliminateWaste ? 'text-emerald-400' : 'text-rose-400 font-bold'}>
                    {unusedLicenses} seats
                  </span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80">
                  <span className="text-slate-500 block">Underutilized:</span>
                  <span className="text-amber-400">120 seats</span>
                </div>
              </div>
            </div>

            {/* Section 5: Telemetry Signals */}
            <div
              onClick={() => setHighlightedCategory('telemetry')}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                highlightedCategory === 'telemetry'
                  ? 'bg-[#0F291E] border-emerald-500 ring-1 ring-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'bg-[#0E131F] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-indigo-400" />
                  5. Telemetry Signals
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-indigo-950 text-indigo-300 border-indigo-800 font-bold">
                  Target Focus
                </span>
              </div>
              <div className="space-y-1 text-[10px] font-mono text-slate-300 pt-1">
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80 flex justify-between">
                  <span className="text-slate-400">Drafting-heavy:</span>
                  <span className="text-sky-300 font-bold">Engineering, Legal, Sales</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80 flex justify-between">
                  <span className="text-slate-400">Research-heavy:</span>
                  <span className="text-indigo-300 font-bold">Strategy, Compliance, R&D</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded border border-slate-800/80 flex justify-between">
                  <span className="text-slate-400">Comm-heavy:</span>
                  <span className="text-purple-300 font-bold">PMO, HR, Operations</span>
                </div>
              </div>
            </div>

          </div>
        </aside>

        {/* ================================================================== */}
        {/* CENTER PANEL — ROI STORY + VALUE CHARTS + SIMULATION ENGINE         */}
        {/* ================================================================== */}
        <main className="flex-1 overflow-y-auto bg-[#05070C] p-5 flex flex-col relative scrollbar-thin space-y-6">

          {/* -------------------------------------------------------------- */}
          {/* LAYER 1: SHORT ROI STORY (TOP OF CENTER PANEL)                  */}
          {/* -------------------------------------------------------------- */}
          <section className="bg-gradient-to-r from-slate-900/90 via-[#091D17] to-slate-900/90 border border-emerald-500/30 rounded-2xl p-4 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 mb-3">
              <span className="text-xs font-extrabold uppercase tracking-widest text-emerald-400 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400 animate-spin-slow" />
                <span>Executive Copilot Value Narrative & Business Justification</span>
              </span>
              <span className="text-[9.5px] font-mono px-2.5 py-0.5 rounded-full border bg-emerald-950 text-emerald-300 border-emerald-700 font-bold">
                EXECUTIVE-READY
              </span>
            </div>

            <div className="space-y-2 text-xs leading-relaxed text-slate-200 font-normal">
              <p><strong className="text-white">Tenant Value Creation:</strong> {story.overview}</p>
              <p><strong className="text-white">Top Benefiting Personas:</strong> {story.topPersonas}</p>
              <p><strong className="text-white">Workflow Cycle Reduction:</strong> {story.workflowImpact}</p>
              <p><strong className="text-white">Governance Unlock Effect:</strong> {story.governanceUnlock}</p>
              <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between text-xs font-bold text-emerald-300 font-mono">
                <span>⚡ Value Punchline: {story.punchline}</span>
                <span className="text-[10px] text-slate-400">Microsoft Viva Insights & Forrester Methodology</span>
              </div>
            </div>
          </section>

          {/* -------------------------------------------------------------- */}
          {/* LAYER 2: ROI VALUE CHARTS (MIDDLE OF CENTER PANEL)             */}
          {/* -------------------------------------------------------------- */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-sky-400" />
                <span>Microsoft Fluent UI Value & Productivity Visualizations</span>
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                Interactive Charting Engine
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Chart 1: Time Saved by Persona */}
              <div className="bg-[#090D16] border border-white/10 rounded-2xl p-4 shadow-xl space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-sky-400" />
                    1. Monthly Time Saved by Persona (Hours)
                  </span>
                  <span className="text-[10px] font-mono text-sky-400 font-bold">
                    Total: {totalMonthlyHoursSaved.toLocaleString()} hrs/mo
                  </span>
                </div>
                <div className="h-48 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={personaTimeSavedData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                      <XAxis dataKey="persona" stroke="#64748b" tick={{ fill: '#cbd5e1', fontSize: 10 }} />
                      <YAxis stroke="#64748b" tick={{ fill: '#cbd5e1', fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }}
                        itemStyle={{ color: '#38bdf8' }}
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
              <div className="bg-[#090D16] border border-white/10 rounded-2xl p-4 shadow-xl space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                    2. Projected Financial Value ($k)
                  </span>
                  <span className="text-[10px] font-mono text-emerald-400 font-bold">
                    Net: ${(totalAnnualValue / 1000).toFixed(0)}k / yr
                  </span>
                </div>
                <div className="h-48 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={financialGrowthData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                      <XAxis dataKey="quarter" stroke="#64748b" tick={{ fill: '#cbd5e1', fontSize: 10 }} />
                      <YAxis stroke="#64748b" tick={{ fill: '#cbd5e1', fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }}
                      />
                      <Area type="monotone" dataKey="savings" name="Productivity Value ($k)" stroke="#10b981" fill="#059669" fillOpacity={0.35} />
                      <Area type="monotone" dataKey="wasteCut" name="Waste Eliminated ($k)" stroke="#38bdf8" fill="#0284c7" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 3: License Utilization & Waste Optimization */}
              <div className="bg-[#090D16] border border-white/10 rounded-2xl p-4 shadow-xl space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <PieChartIcon className="w-3.5 h-3.5 text-purple-400" />
                    3. License Allocation & Waste Optimization
                  </span>
                  <span className="text-[10px] font-mono text-purple-300 font-bold">
                    {totalSeats} Total Licenses
                  </span>
                </div>
                <div className="h-48 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={licenseChartData} layout="vertical" margin={{ top: 5, right: 20, left: 25, bottom: 5 }}>
                      <XAxis type="number" stroke="#64748b" tick={{ fill: '#cbd5e1', fontSize: 10 }} />
                      <YAxis dataKey="category" type="category" stroke="#64748b" tick={{ fill: '#cbd5e1', fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }}
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
              <div className="bg-[#090D16] border border-white/10 rounded-2xl p-4 shadow-xl space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    4. Workflow Time Before vs After Copilot (hrs/wk)
                  </span>
                  <span className="text-[10px] font-mono text-amber-300 font-bold">
                    -{draftingReduction}% Drafting Cycle
                  </span>
                </div>
                <div className="h-48 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={workflowData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                      <XAxis dataKey="workflow" stroke="#64748b" tick={{ fill: '#cbd5e1', fontSize: 10 }} />
                      <YAxis stroke="#64748b" tick={{ fill: '#cbd5e1', fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }}
                      />
                      <Bar dataKey="current" name="Legacy Hrs" fill="#334155" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="reduced" name="With Copilot" fill="#10B981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>
          </section>

          {/* -------------------------------------------------------------- */}
          {/* LAYER 3: ROI SIMULATION ENGINE (BOTTOM OF CENTER PANEL)         */}
          {/* -------------------------------------------------------------- */}
          <section className="bg-[#090D16] border border-white/10 rounded-2xl p-5 shadow-2xl relative space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-white">
                  Executive ROI Simulation Parameters
                </h2>
              </div>
              <span className="text-[10px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-2.5 py-1 rounded">
                Real-Time Recalculation
              </span>
            </div>

            {/* Sliders Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

              {/* Slider 1: Adoption Rate */}
              <div className="p-3.5 rounded-xl border bg-slate-900/80 border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-white block">Increase Copilot Adoption</label>
                  <span className="text-xs font-mono font-bold text-emerald-400">{adoptionRate}%</span>
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
                  className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                />
                <span className="text-[10px] text-slate-400 block">{activeAdopters} active users of {totalSeats} seats</span>
              </div>

              {/* Slider 2: Increase Workflow Automation */}
              <div className="p-3.5 rounded-xl border bg-slate-900/80 border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-white block">Increase Workflow Automation</label>
                  <span className="text-xs font-mono font-bold text-sky-400">{automationLevel}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={automationLevel}
                  onChange={(e) => setAutomationLevel(Number(e.target.value))}
                  className="w-full accent-sky-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                />
                <span className="text-[10px] text-slate-400 block">Deploy custom Copilot Studio agent triggers</span>
              </div>

              {/* Slider 3: Reduce Drafting Time */}
              <div className="p-3.5 rounded-xl border bg-slate-900/80 border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-white block">Reduce Drafting Time</label>
                  <span className="text-xs font-mono font-bold text-amber-400">-{draftingReduction}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={draftingReduction}
                  onChange={(e) => setDraftingReduction(Number(e.target.value))}
                  className="w-full accent-amber-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                />
                <span className="text-[10px] text-slate-400 block">Accelerate Word & Outlook first-draft generation</span>
              </div>

              {/* Slider 4: Reduce Research Time */}
              <div className="p-3.5 rounded-xl border bg-slate-900/80 border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-white block">Reduce Research Time</label>
                  <span className="text-xs font-mono font-bold text-purple-400">-{researchReduction}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={researchReduction}
                  onChange={(e) => setResearchReduction(Number(e.target.value))}
                  className="w-full accent-purple-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                />
                <span className="text-[10px] text-slate-400 block">Instant search across SharePoint & Web grounding</span>
              </div>

              {/* Slider 5: Reduce Meeting Load */}
              <div className="p-3.5 rounded-xl border bg-slate-900/80 border-slate-800 space-y-2 lg:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-white block">Reduce Meeting Load</label>
                  <span className="text-xs font-mono font-bold text-indigo-400">-{meetingReduction}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="30"
                  value={meetingReduction}
                  onChange={(e) => setMeetingReduction(Number(e.target.value))}
                  className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                />
                <span className="text-[10px] text-slate-400 block">Asynchronous recap & intelligent action item synthesis in Teams</span>
              </div>

            </div>

            {/* Toggles Bar */}
            <div className="pt-3 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              
              {/* Toggle 1: All Personas */}
              <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[11px] font-bold text-slate-200">Enable All Personas</span>
                <button
                  onClick={() => {
                    setAllPersonas(!allPersonas);
                    if (!allPersonas) setHighRoiOnly(false);
                  }}
                  className={`w-10 h-5 rounded-full transition-colors p-0.5 flex items-center ${
                    allPersonas ? 'bg-emerald-500 justify-end' : 'bg-slate-800 justify-start'
                  }`}
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>

              {/* Toggle 2: High ROI Personas Only */}
              <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[11px] font-bold text-slate-200">High-ROI Cohorts Only</span>
                <button
                  onClick={() => {
                    setHighRoiOnly(!highRoiOnly);
                    if (!highRoiOnly) setAllPersonas(false);
                  }}
                  className={`w-10 h-5 rounded-full transition-colors p-0.5 flex items-center ${
                    highRoiOnly ? 'bg-sky-500 justify-end' : 'bg-slate-800 justify-start'
                  }`}
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>

              {/* Toggle 3: Eliminate License Waste */}
              <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[11px] font-bold text-slate-200">Eliminate License Waste</span>
                <button
                  onClick={() => setEliminateWaste(!eliminateWaste)}
                  className={`w-10 h-5 rounded-full transition-colors p-0.5 flex items-center ${
                    eliminateWaste ? 'bg-purple-500 justify-end' : 'bg-slate-800 justify-start'
                  }`}
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>

              {/* Toggle 4: Apply Governance Fixes */}
              <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[11px] font-bold text-slate-200">Apply Governance Fixes</span>
                <button
                  onClick={() => setApplyGovernance(!applyGovernance)}
                  className={`w-10 h-5 rounded-full transition-colors p-0.5 flex items-center ${
                    applyGovernance ? 'bg-emerald-500 justify-end' : 'bg-slate-800 justify-start'
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
        <aside className="w-84 bg-[#0A0E17]/95 border-l border-white/10 p-4 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-4 z-20">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <Award className="w-4 h-4 text-emerald-400" />
              <span>ROI Financial Summary</span>
            </span>
            <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-2 py-0.5 rounded">
              Dynamic Realtime
            </span>
          </div>

          <div className="space-y-3">

            {/* 1. Total Time Saved */}
            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-white/10 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-sky-400 font-bold block">
                Total Time Saved
              </span>
              <p className="text-lg font-mono font-black text-white">
                {totalMonthlyHoursSaved.toLocaleString()} <span className="text-xs text-slate-400 font-sans font-normal">hrs / month</span>
              </p>
              <div className="flex items-center justify-between text-xs font-mono text-emerald-400 font-bold pt-0.5">
                <span>Equivalent to {fteEquivalent} FTEs</span>
                <span className="text-[10px] text-slate-400">Reclaimed time</span>
              </div>
            </div>

            {/* 2. Total Cost Savings */}
            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-white/10 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-emerald-400 font-bold block">
                Total Financial Value
              </span>
              <p className="text-lg font-mono font-black text-emerald-400">
                ${(totalAnnualValue / 1000).toFixed(0)}k <span className="text-xs text-slate-400 font-sans font-normal">/ year</span>
              </p>
              <div className="space-y-1 text-[10px] font-mono text-slate-300 pt-1 border-t border-slate-800">
                <div className="flex justify-between">
                  <span className="text-slate-400">Operational Savings:</span>
                  <span className="text-emerald-400 font-bold">${(annualSavingsDollars / 1000).toFixed(0)}k/yr</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">License Waste Cut:</span>
                  <span className="text-sky-300 font-bold">${(wasteEliminatedDollars / 1000).toFixed(0)}k/yr</span>
                </div>
              </div>
            </div>

            {/* 3. Efficiency Gain */}
            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-white/10 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-indigo-400 font-bold block">
                Efficiency Gain
              </span>
              <p className="text-lg font-mono font-black text-indigo-300">
                +{efficiencyGainPct}% <span className="text-xs text-slate-400 font-sans font-normal">overall uplift</span>
              </p>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Reduced cycle time across 5 key enterprise departments with improved output accuracy.
              </p>
            </div>

            {/* 4. Persona Impact */}
            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-white/10 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-amber-400 font-bold block">
                Persona Productivity Uplift
              </span>
              <div className="space-y-1 text-[11px] font-mono text-slate-200">
                <div className="flex justify-between p-1 bg-slate-950 rounded border border-slate-800">
                  <span>Engineering:</span>
                  <span className="text-emerald-400 font-bold">+32% productivity</span>
                </div>
                <div className="flex justify-between p-1 bg-slate-950 rounded border border-slate-800">
                  <span>HR & Ops:</span>
                  <span className="text-emerald-400 font-bold">+41% productivity</span>
                </div>
                <div className="flex justify-between p-1 bg-slate-950 rounded border border-slate-800">
                  <span>Legal & Compliance:</span>
                  <span className="text-sky-400 font-bold">+27% productivity</span>
                </div>
              </div>
            </div>

            {/* 5. Workflow Impact */}
            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-white/10 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-purple-400 font-bold block">
                Workflow Cycle Reduction
              </span>
              <div className="space-y-1 text-[11px] font-mono text-slate-200">
                <div className="flex justify-between p-1 bg-slate-950 rounded border border-slate-800">
                  <span>Drafting:</span>
                  <span className="text-amber-400 font-bold">-{draftingReduction}% cycle time</span>
                </div>
                <div className="flex justify-between p-1 bg-slate-950 rounded border border-slate-800">
                  <span>Research:</span>
                  <span className="text-purple-400 font-bold">-{researchReduction}% cycle time</span>
                </div>
                <div className="flex justify-between p-1 bg-slate-950 rounded border border-slate-800">
                  <span>Meeting Load:</span>
                  <span className="text-indigo-400 font-bold">-{meetingReduction}% meeting load</span>
                </div>
              </div>
            </div>

          </div>
        </aside>

      </div>

    </div>
  );
};
