import React, { useState } from 'react';
import { PersonaStory } from '../types';
import { 
  Users, 
  ArrowRight, 
  ShieldAlert, 
  Zap, 
  Terminal, 
  FileText, 
  CheckCircle2, 
  AlertTriangle, 
  ChevronDown, 
  ChevronUp, 
  Sparkles,
  Lock,
  Cpu,
  Clock,
  DollarSign,
  HelpCircle,
  X,
  ExternalLink,
  Layers,
  Activity,
  TrendingUp,
  ChevronRight,
  Bookmark,
  Target,
  BarChart3,
  Lightbulb
} from 'lucide-react';

import { TransformationSurface, TransformationData } from '../telemetry/TransformationSurface';

export interface ExtendedPersonaData {
  id: string;
  name: string;
  role: string;
  department: string;
  avatar: string;
  bgAnimationType: 'engineer' | 'security' | 'pm' | 'writer' | 'researcher';
  collaborationPattern: string[];
  sensitivitySet: string[];
  useCaseCluster: string;
  outcomePriorities: string[];
  
  // Scores & Metrics
  riskScore: number;
  feasibilityScore: number;
  adoptionFriction: number;
  sensitivityExposure: { label: string; severity: 'High' | 'Medium' | 'Low' }[];
  collaborationFriction: { label: string; severity: 'High' | 'Medium' | 'Low' }[];
  valuePotential: {
    hoursSavedPerWeek: number;
    annualValuePerSeat: string;
    roiMultiplier: string;
    primaryBenefit: string;
  };

  // Short Story (3-5 SENTENCES)
  shortStory: {
    summary: string;
    telemetryCheck: string;
    copilotUnlock: string;
  };

  // Expanded Narrative (7 Parts)
  expandedNarrative: {
    identityContext: string;
    collaborationSensitivity: string;
    telemetryRealityCheck: string;
    workflowFriction: string;
    feasibilityReadiness: string;
    copilotValueStory: string;
    roiBreakdown: string;
  };

  insightRibbonText: string;
}

const EXTENDED_PERSONAS: ExtendedPersonaData[] = [
  {
    id: 'dev_lead',
    name: 'Engineering & Dev Lead',
    role: 'Lead Cloud Architect & Dev Lead',
    department: 'Engineering & Tech Ops',
    avatar: '💻',
    bgAnimationType: 'engineer',
    collaborationPattern: ['GitHub Repos', 'Teams Dev Channel', 'M365 Loop', 'Azure DevOps', 'VS Code'],
    sensitivitySet: ['Confidential IP', 'API Keys & Secrets', 'Architecture Specs', 'Prod Conn Strings'],
    useCaseCluster: 'Automated Code Review & API Microservices Grounding',
    outcomePriorities: ['Engineering Velocity (+35%)', 'Zero Key Exposure', 'CI/CD Auto-Sync'],
    riskScore: 32,
    feasibilityScore: 92,
    adoptionFriction: 18,
    sensitivityExposure: [
      { label: 'Unmonitored API Key Snippets', severity: 'High' },
      { label: 'Overshared Dev Specs in Teams', severity: 'Medium' },
      { label: 'Unlabeled Architecture Diagrams', severity: 'Low' }
    ],
    collaborationFriction: [
      { label: 'Manual PR & Spec Reconciliation', severity: 'High' },
      { label: 'Cross-Squad Context Loss in Slack/Teams', severity: 'Medium' }
    ],
    valuePotential: {
      hoursSavedPerWeek: 6.8,
      annualValuePerSeat: '$18,400 / seat',
      roiMultiplier: '8.4x ROI',
      primaryBenefit: 'Accelerated Code Delivery & Automated Governance Grounding'
    },
    shortStory: {
      summary: 'Coordinates multi-repo microservices architecture across 1,400+ weekly Teams messages and GitHub commits. While Quiz intent highlights high custom AI extensibility and REST API integration needs, live Telemetry reveals 14 unmonitored API key snippets and overshared dev specs across legacy channels.',
      telemetryCheck: 'Drift Engine detected 14 unmonitored API key strings in public Teams chats & 3 overshared SharePoint dev repos.',
      copilotUnlock: 'M365 Copilot with Graph Connectors & Copilot Studio automates PR reviews and architectural synthesis while Purview enforces auto-labeling on secret credentials.'
    },
    expandedNarrative: {
      identityContext: 'As Lead Cloud Architect, this persona manages microservice boundaries, API contract definitions, and sprint velocity across 4 sub-squads. They spend 22+ hours weekly navigating scattered specification docs, pull request threads, and incident channels.',
      collaborationSensitivity: 'Heavy reliance on GitHub Repos, Teams Dev Channels, and M365 Loop workspaces. Sensitive assets include proprietary source code algorithms, cloud connection strings, and production architecture specs.',
      telemetryRealityCheck: 'Signals & Drift Engines identified 14 hardcoded credential strings in Teams snippets, 3 overshared SharePoint sites with broad "Everyone" permissions, and CA01 MFA bypass exceptions on legacy service accounts.',
      workflowFriction: 'Devs waste 1.5 hours daily manually searching for API specs and reconciling contradictory architectural updates across Jira, Teams, and Loop.',
      feasibilityReadiness: 'Feasibility Score is 92/100 due to high technical literacy and existing M365 E5 licensing. Champion readiness is high with minimal change resistance.',
      copilotValueStory: 'Integrating M365 Copilot with GitHub Copilot & Azure Graph Connectors enables instant code documentation synthesis, real-time PR triage, and automated architecture brief generation.',
      roiBreakdown: 'Recovers 6.8 hours/week per developer. At an average developer cost, this yields $18,400 in annual productivity value per seat with an 8.4x ROI multiplier.'
    },
    insightRibbonText: '⚡ Dev Lead Cohort: 14 unmonitored API keys detected in overshared specs — Copilot Graph Grounding recovers 6.8 hrs/wk with automated sensitivity enforcement.'
  },
  {
    id: 'sec_spec',
    name: 'Mission Specialist & SecOps',
    role: 'Principal Security Engineer & SecOps Lead',
    department: 'Cyber Security & Governance',
    avatar: '🛡️',
    bgAnimationType: 'security',
    collaborationPattern: ['Exchange Online', 'Teams Incident Room', 'Purview Center', 'Defender SIEM'],
    sensitivitySet: ['PII Records', 'Credential Vaults', 'DLP Audit Logs', 'CA01 Policy Specs'],
    useCaseCluster: 'SecOps Guardrail Audit & Automated DLP Enforcement',
    outcomePriorities: ['Zero Drift', 'Conditional Access Alignment', '100% Audit Coverage'],
    riskScore: 68,
    feasibilityScore: 85,
    adoptionFriction: 24,
    sensitivityExposure: [
      { label: 'Public Sharing Links on Sensitive Sites', severity: 'High' },
      { label: 'CA01 Policy Exception Drift', severity: 'High' },
      { label: 'Unlabeled PII in Legacy Exchange Logs', severity: 'Medium' }
    ],
    collaborationFriction: [
      { label: 'Manual Security Incident Triage', severity: 'High' },
      { label: 'DLP Override Audit Bottlenecks', severity: 'Medium' }
    ],
    valuePotential: {
      hoursSavedPerWeek: 5.4,
      annualValuePerSeat: '$21,200 / seat',
      roiMultiplier: '9.1x ROI',
      primaryBenefit: 'Automated Threat Mitigation & Continuous Purview Guardrail Sync'
    },
    shortStory: {
      summary: 'Coordinates continuous incident triage and Purview compliance across 1,240 SharePoint sites and M365 tenant endpoints. Telemetry flags 18 overshared public links and CA01 MFA exemptions. Copilot for Security automates threat hunting while DLP auto-labeling blocks data egress.',
      telemetryCheck: 'Health Engine & Priority Engine flagged CA01 Conditional Access exemptions and 18 public sharing links on sensitive HR/Finance sites.',
      copilotUnlock: 'Automates SIEM query generation, summarizes complex audit trails, and automatically applies Purview Sensitivity Labels across all tenant repositories.'
    },
    expandedNarrative: {
      identityContext: 'The Principal Security Engineer leads tenant threat hunting, zero-trust compliance, and data loss prevention across all enterprise endpoints and cloud workloads.',
      collaborationSensitivity: 'Utilizes Purview Compliance Center, Defender SIEM, and dedicated Teams Incident War Rooms. Handles highly sensitive PII, audit trails, and conditional access policies.',
      telemetryRealityCheck: 'Tenant telemetry revealed legacy basic auth protocols still active on 2 admin endpoints, missing PIM step-up MFA for 3 global admin roles, and 18 overshared public links.',
      workflowFriction: 'SecOps engineers lose 18+ hours weekly manually sifting through raw Defender logs and verifying DLP override exceptions.',
      feasibilityReadiness: 'Feasibility Score of 85/100. High readiness for automated security copilots once CA01 conditional access policies are tightened.',
      copilotValueStory: 'Copilot for Security correlates Graph signals with Defender incidents in natural language, reducing threat investigation time from hours to seconds.',
      roiBreakdown: 'Saves 5.4 hours/week per SecOps analyst, avoiding costly audit findings and generating $21,200 in annual productivity and risk-mitigation value per seat.'
    },
    insightRibbonText: '🛡️ SecOps Specialist: 18 overshared public links & CA01 MFA exemptions flagged — Copilot for Security automates threat triage and Purview auto-labeling.'
  },
  {
    id: 'prog_mgr',
    name: 'Program & Product Manager',
    role: 'Staff Product Manager & Agile Lead',
    department: 'Product & PMO',
    avatar: '🚀',
    bgAnimationType: 'pm',
    collaborationPattern: ['Teams Squad Channels', 'Word PRDs', 'Loop Workspaces', 'Jira / DevOps'],
    sensitivitySet: ['Roadmap Strategy', 'Customer Feedback', 'Sprint Velocity Logs', 'Vendor SOWs'],
    useCaseCluster: 'Cross-Squad Sprint Synthesis & Automated Status Briefs',
    outcomePriorities: ['Sprint Cycle Speed (+40%)', 'Zero Meeting Lag', 'Cross-Functional Sync'],
    riskScore: 24,
    feasibilityScore: 94,
    adoptionFriction: 12,
    sensitivityExposure: [
      { label: 'Unrestricted Customer Feedback Repos', severity: 'Medium' },
      { label: 'Draft Financial SOWs in Teams', severity: 'Medium' }
    ],
    collaborationFriction: [
      { label: '68% Meeting Time Congestion', severity: 'High' },
      { label: 'Manual Executive Status Report Assembly', severity: 'High' }
    ],
    valuePotential: {
      hoursSavedPerWeek: 5.8,
      annualValuePerSeat: '$16,500 / seat',
      roiMultiplier: '7.8x ROI',
      primaryBenefit: 'Elimination of Administrative Meeting Burden & Rapid Sprint Alignment'
    },
    shortStory: {
      summary: 'Manages 12 cross-functional sprint pods and processes 1,400 Teams messages weekly. Telemetry indicates 68% meeting time congestion. Copilot synthesizes multi-hour roadmap discussions into instant Azure DevOps backlog items, recovering 5.8 hrs/wk.',
      telemetryCheck: 'Signals Engine detected 68% of work hours spent in Teams calls with 1,400+ weekly chat messages across 12 squad channels.',
      copilotUnlock: 'Copilot in Teams & Word auto-generates meeting recaps, extracts action items directly into Jira/DevOps, and drafts executive status briefs.'
    },
    expandedNarrative: {
      identityContext: 'Oversees product strategy, feature prioritization, and engineering execution across multiple release trains and business stakeholders.',
      collaborationSensitivity: 'Heavy daily activity in Teams Channels, Word PRDs, M365 Loop workspaces, and DevOps boards. Manages strategic roadmap data and vendor SOWs.',
      telemetryRealityCheck: 'Priority Engine highlighted extreme meeting fragmentation (68% meeting time ratio) causing status reporting delay cycles of 4+ days.',
      workflowFriction: 'PMs spend up to 10 hours every week manually writing meeting minutes, drafting status decks, and following up on unassigned action items.',
      feasibilityReadiness: 'Feasibility Score of 94/100. Highest adoption velocity among all enterprise cohorts with immediate productivity return.',
      copilotValueStory: 'Copilot in Teams captures key decisions during live meetings, creates action-item tables in Loop, and converts PRDs into executive slides automatically.',
      roiBreakdown: 'Recovers 5.8 hours/week per PM. Delivers $16,500 in annual seat value with a 7.8x ROI multiplier.'
    },
    insightRibbonText: '🚀 Program Manager: 68% meeting time congestion across 12 sprint pods — Copilot synthesizes multi-hour discussions into instant Azure DevOps items.'
  },
  {
    id: 'tech_writer',
    name: 'Technical Writer & Legal Counsel',
    role: 'Lead Technical Writer & Corporate Counsel',
    department: 'Legal & Documentation',
    avatar: '📜',
    bgAnimationType: 'writer',
    collaborationPattern: ['Word Docs', 'SharePoint Portal', 'Outlook Legal Thread', 'Adobe Acrobat'],
    sensitivitySet: ['Legal Redlines', 'IP Patent Claims', 'Customer NDAs', 'M&A Disclosures'],
    useCaseCluster: 'Contract Redline & Automated Policy Compliance Check',
    outcomePriorities: ['Document Accuracy', 'Audit Provenance', 'Contract Velocity'],
    riskScore: 52,
    feasibilityScore: 81,
    adoptionFriction: 30,
    sensitivityExposure: [
      { label: 'Unlabeled Legal Contract Drafts', severity: 'High' },
      { label: 'Legacy Non-Encrypted M&A Attachments', severity: 'High' }
    ],
    collaborationFriction: [
      { label: '45+ Page Manual Contract Redlines', severity: 'High' },
      { label: 'Version Control Friction in Email Threads', severity: 'Medium' }
    ],
    valuePotential: {
      hoursSavedPerWeek: 4.8,
      annualValuePerSeat: '$19,800 / seat',
      roiMultiplier: '8.8x ROI',
      primaryBenefit: 'Accelerated Contract Review Cycles with Complete Compliance Audit Trail'
    },
    shortStory: {
      summary: 'Synthesizes complex 45+ page legal contracts and regulatory policies. Telemetry flags 42 unlabeled legal drafts in public team channels. Copilot accelerates redline analysis and clause extraction with full audit provenance while Purview auto-labels sensitivity.',
      telemetryCheck: 'Drift Engine discovered 42 unlabeled legal drafts and NDA documents stored in unencrypted SharePoint folders.',
      copilotUnlock: 'Copilot in Word compares contract versions, extracts non-standard indemnification clauses, and verifies compliance with enterprise policy.'
    },
    expandedNarrative: {
      identityContext: 'Responsible for legal risk mitigation, contract redlining, compliance documentation, and regulatory filing reviews.',
      collaborationSensitivity: 'Operates in Word, SharePoint, and Outlook. Handles highly confidential IP claims, acquisition NDAs, and customer contracts.',
      telemetryRealityCheck: 'Drift Engine detected 42 unlabeled legal contract drafts sitting in public department channels without sensitivity classification.',
      workflowFriction: 'Reviewing a single 50-page vendor agreement or contract redline takes 4-6 hours of manual clause comparison.',
      feasibilityReadiness: 'Feasibility Score of 81/100. Requires strict Purview label enforcement before deploying Copilot to ensure zero accidental data leak.',
      copilotValueStory: 'Copilot in Word performs side-by-side contract analysis, highlights risky liability clauses, and drafts executive summary memos with source citations.',
      roiBreakdown: 'Saves 4.8 hours/week per legal counsel, slashing contract turnaround time from 12 days to 3 days and generating $19,800 in seat value.'
    },
    insightRibbonText: '📜 Legal Counsel: 42 unlabeled legal drafts in public channels — Copilot accelerates contract redline analysis with 100% audit provenance.'
  },
  {
    id: 'research_exec',
    name: 'Research & Strategic Executive',
    role: 'VP Strategy & Chief Research Officer',
    department: 'Executive Management',
    avatar: '👑',
    bgAnimationType: 'researcher',
    collaborationPattern: ['Board Exchange Threads', 'PowerPoint Decks', 'Excel Financials', 'Teams Exec Briefs'],
    sensitivitySet: ['Board Packages', 'Financial M&A', 'Executive Compensation', 'Strategic Acquisition'],
    useCaseCluster: 'Multi-Document Executive Briefing & Decision Acceleration',
    outcomePriorities: ['Decision Speed (+50%)', 'Strategic Focus', 'Board Package Fidelity'],
    riskScore: 18,
    feasibilityScore: 96,
    adoptionFriction: 8,
    sensitivityExposure: [
      { label: 'Unencrypted Board Presentation Drafts', severity: 'Medium' }
    ],
    collaborationFriction: [
      { label: '480 Weekly Email Thread Overload', severity: 'High' },
      { label: 'Multi-Document Strategy Synthesis Lag', severity: 'Medium' }
    ],
    valuePotential: {
      hoursSavedPerWeek: 7.2,
      annualValuePerSeat: '$26,500 / seat',
      roiMultiplier: '11.2x ROI',
      primaryBenefit: 'Instant Multi-Report Synthesis & High-Fidelity Strategic Briefing'
    },
    shortStory: {
      summary: 'Evaluates strategic M&A proposals, quarterly board decks, and market research. Telemetry confirms 480 weekly email threads and tight executive schedules. Copilot synthesizes 100-page market dossiers in seconds, recovering 7.2 hrs/wk for high-leverage decision making.',
      telemetryCheck: 'Signals Engine recorded 480 weekly email threads, 18 strategic PowerPoint decks, and continuous multi-document context switches.',
      copilotUnlock: 'Copilot in PowerPoint & Outlook synthesizes complex financial reports, generates executive briefs, and prepares board presentation storyboards.'
    },
    expandedNarrative: {
      identityContext: 'Drives enterprise corporate strategy, market intelligence research, and high-stakes M&A evaluation reporting to the CEO and Board.',
      collaborationSensitivity: 'High email density in Exchange, confidential board decks in PowerPoint, and financial forecasting models in Excel.',
      telemetryRealityCheck: 'Telemetry shows high executive time spent reading lengthy market research PDFs and reconciling mismatched Excel data.',
      workflowFriction: 'Synthesizing 5 competitor research reports and preparing a board briefing takes up to 12 hours of manual compilation.',
      feasibilityReadiness: 'Feasibility Score of 96/100. Highest strategic impact cohort with immediate executive sponsorship.',
      copilotValueStory: 'Copilot synthesizes multi-file dossiers across Outlook, Word, and Excel into a 5-bullet executive summary with interactive Q&A grounding.',
      roiBreakdown: 'Recovers 7.2 hours/week per executive, unlocking $26,500 in annual strategic productivity value per seat.'
    },
    insightRibbonText: '👑 Executive Leadership: 480 weekly email threads & tight M&A review windows — Copilot synthesizes 100-page dossiers in seconds, saving 7.2 hrs/wk.'
  }
];

interface PersonasScreenProps {
  quizAnswers?: Record<string, string>;
  personas?: PersonaStory[];
  onSelectPersona?: (persona: PersonaStory) => void;
  onContinue: () => void;
  onHelpClick?: () => void;
  onExitClick?: () => void;
  onNavigate?: (step: any) => void;
}

export const PersonasScreen: React.FC<PersonasScreenProps> = ({
  quizAnswers = {},
  onContinue,
  onHelpClick,
  onExitClick,
  onNavigate
}) => {
  const [activePersonaId, setActivePersonaId] = useState<string>('dev_lead');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [ribbonPulse, setRibbonPulse] = useState<boolean>(false);
  
  // Transformation Surface State
  const [transSliderPos, setTransSliderPos] = useState<number>(50);
  const [isTransExpanded, setIsTransExpanded] = useState<boolean>(false);

  const activePersona = EXTENDED_PERSONAS.find(p => p.id === activePersonaId) || EXTENDED_PERSONAS[0];

  const handleSelectPersona = (id: string) => {
    if (id === activePersonaId) return;
    if (isExpanded) {
      setIsExpanded(false);
    }
    setActivePersonaId(id);
    setRibbonPulse(true);
    setTimeout(() => setRibbonPulse(false), 1200);
  };

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
    setRibbonPulse(true);
    setTimeout(() => setRibbonPulse(false), 1000);
  };

  const handleSliderChange = (pos: number) => {
    setTransSliderPos(pos);
    setRibbonPulse(true);
    setTimeout(() => setRibbonPulse(false), 800);
  };

  // Transformation Surface Data
  const transformationData: TransformationData = {
    title: activePersona.name,
    category: activePersona.department,
    before: {
      headline: `${activePersona.role} operates with unmonitored data exposure and manual collaboration friction across ${activePersona.collaborationPattern.length} channels.`,
      telemetryItems: activePersona.sensitivityExposure.map(s => ({
        label: s.label,
        value: s.severity,
        severity: s.severity
      })),
      frictionPoints: activePersona.collaborationFriction.map(f => f.label),
      riskSummary: `Elevated Risk Score (${activePersona.riskScore}/100) • High Friction (${activePersona.adoptionFriction}%)`
    },
    after: {
      headline: `M365 Copilot & Purview auto-governance optimize ${activePersona.name}'s daily workflow with zero credential leakage.`,
      copilotUnlocks: activePersona.outcomePriorities.map(op => ({
        label: op,
        value: '100% Active',
        impact: 'Automated'
      })),
      optimizations: [
        `Automated Graph Grounding across ${activePersona.collaborationPattern.slice(0, 3).join(', ')}`,
        `Purview Auto-Labeling on ${activePersona.sensitivitySet.slice(0, 2).join(', ')}`,
        `Zero manual reconciliation required`
      ],
      roiOutcome: `${activePersona.valuePotential.hoursSavedPerWeek} hrs/wk saved (${activePersona.valuePotential.annualValuePerSeat})`
    }
  };

  // Dynamic Reactive Metrics based on Slider Position
  const ratio = transSliderPos / 100;
  const effectiveRiskScore = Math.max(0, Math.round(activePersona.riskScore * (1.8 - 0.8 * ratio)));
  const effectiveFeasibilityScore = Math.min(100, Math.round(activePersona.feasibilityScore * (0.6 + 0.4 * ratio)));
  const effectiveAdoptionFriction = Math.max(0, Math.round(activePersona.adoptionFriction * (1.8 - 0.8 * ratio)));
  const effectiveHoursSaved = (activePersona.valuePotential.hoursSavedPerWeek * (0.2 + 0.8 * ratio)).toFixed(1);

  // Gauge calculations for active persona
  const riskRadius = 28;
  const riskCircumference = 2 * Math.PI * riskRadius;
  const riskOffset = riskCircumference - (effectiveRiskScore / 100) * riskCircumference;

  const feasRadius = 28;
  const feasCircumference = 2 * Math.PI * feasRadius;
  const feasOffset = feasCircumference - (effectiveFeasibilityScore / 100) * feasCircumference;

  const dynamicRibbonText = isTransExpanded
    ? transSliderPos < 30
      ? `⚠️ Telemetry Reality Mode (${transSliderPos}%): High unmonitored risk & manual workflow friction detected for ${activePersona.name}.`
      : transSliderPos < 70
      ? `⚡ Transformation Transition Mode (${transSliderPos}%): Purview governance & Copilot grounding in progress...`
      : `✨ Copilot-Optimized Mode (${transSliderPos}%): ${activePersona.insightRibbonText}`
    : activePersona.insightRibbonText;

  return (
    <div className="h-screen w-screen bg-[#07090E] text-slate-100 flex flex-col font-sans overflow-hidden antialiased select-none relative">
      
      {/* 1. TOP MISSION-CONTROL TOOLBAR */}
      <header className="h-13 bg-[#0B0F19]/90 border-b border-white/10 px-4 flex items-center justify-between shrink-0 z-30 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <Users className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                Persona Stories & Cohort Fusion
              </span>
              <span className="text-[10px] font-mono bg-sky-500/20 text-sky-300 border border-sky-500/40 px-2 py-0.5 rounded font-semibold">
                STEP 4 OF 8
              </span>
            </div>
            <p className="text-[10px] text-slate-400">
              Quiz Intent × Live Telemetry Reality Surface
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-3">
          {onHelpClick && (
            <button
              onClick={onHelpClick}
              className="flex items-center space-x-1.5 bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded-lg border border-slate-700 transition-all cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5 text-sky-400" />
              <span>Spec Info</span>
            </button>
          )}

          <button
            onClick={onContinue}
            className="flex items-center space-x-2 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-slate-950 font-extrabold px-4 py-1.5 rounded-lg text-xs transition-all shadow-lg shadow-sky-950/50 cursor-pointer"
          >
            <span>Evaluate Use-Case Stories</span>
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

      {/* 2. THREE-PANEL MISSION-CONTROL BODY */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* ==================================================================== */}
        {/* LEFT PANEL — PERSONA SELECTOR RAIL */}
        {/* ==================================================================== */}
        <aside className="w-80 bg-[#0A0E17]/95 border-r border-white/10 p-3.5 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-3 z-20">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-sky-400" />
              <span>Persona Cohort Rail ({EXTENDED_PERSONAS.length})</span>
            </span>
            <span className="text-[10px] font-mono text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">
              Live Select
            </span>
          </div>

          <div className="space-y-2.5">
            {EXTENDED_PERSONAS.map((p) => {
              const isActive = p.id === activePersonaId;
              return (
                <div
                  key={p.id}
                  onClick={() => handleSelectPersona(p.id)}
                  className={`p-3 rounded-xl border transition-all duration-300 cursor-pointer relative group ${
                    isActive
                      ? 'bg-gradient-to-br from-[#0F223D] to-[#121A2B] border-sky-500 ring-1 ring-sky-500/40 shadow-[0_0_20px_rgba(0,120,212,0.25)]'
                      : 'bg-[#0E131F]/80 border-slate-800 hover:border-slate-700 hover:bg-[#111827]'
                  }`}
                >
                  {/* Selection Indicator Line */}
                  {isActive && (
                    <div className="absolute left-0 top-3 bottom-3 w-1 bg-sky-400 rounded-r" />
                  )}

                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center space-x-2.5">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0 border transition-transform ${
                          isActive
                            ? 'bg-sky-950/80 border-sky-400 text-sky-300 shadow-[0_0_10px_rgba(0,120,212,0.4)] scale-105'
                            : 'bg-slate-900 border-slate-800 text-slate-400 group-hover:scale-105'
                        }`}
                      >
                        {p.avatar}
                      </div>
                      <div>
                        <h3 className={`text-xs font-bold leading-tight ${
                          isActive ? 'text-white' : 'text-slate-200 group-hover:text-sky-300'
                        }`}>
                          {p.name}
                        </h3>
                        <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
                          {p.role}
                        </p>
                      </div>
                    </div>

                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 shrink-0">
                      {p.department.split(' ')[0]}
                    </span>
                  </div>

                  {/* Multi-Select Collaboration Chips */}
                  <div className="mt-2.5 pt-2 border-t border-white/5 space-y-1.5">
                    <div className="flex flex-wrap gap-1">
                      <span className="text-[9px] font-mono text-slate-500 font-semibold mr-1">Channels:</span>
                      {p.collaborationPattern.slice(0, 3).map((ch, idx) => (
                        <span key={idx} className="text-[8.5px] font-mono bg-slate-900/90 text-sky-300 px-1.5 py-0.2 rounded border border-sky-900/50">
                          {ch}
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-1">
                      <span className="text-[9px] font-mono text-slate-500 font-semibold mr-1">Sensitivity:</span>
                      {p.sensitivitySet.slice(0, 2).map((sen, idx) => (
                        <span key={idx} className="text-[8.5px] font-mono bg-rose-950/60 text-rose-300 px-1.5 py-0.2 rounded border border-rose-900/50">
                          {sen}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Outcome Priorities */}
                  <div className="mt-2 flex items-center justify-between text-[9px] font-mono text-emerald-400 font-semibold bg-emerald-950/30 px-2 py-1 rounded border border-emerald-900/40">
                    <span className="truncate">🎯 {p.outcomePriorities[0]}</span>
                    <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ==================================================================== */}
        {/* CENTER PANEL — FULL EXPANDED NARRATIVE SURFACE (HERO STORY FOCUS) */}
        {/* ==================================================================== */}
        <main className="flex-1 overflow-y-auto bg-[#05070C] p-5 flex flex-col relative scrollbar-thin">
          
          {/* INSIGHT RIBBON SYNC */}
          <div
            className={`mb-4 p-3.5 rounded-xl border transition-all duration-700 backdrop-blur-md relative overflow-hidden shrink-0 ${
              ribbonPulse ? 'animate-ribbon-pulse' : ''
            } ${
              isExpanded || isTransExpanded
                ? 'bg-purple-950/40 border-purple-500/40 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                : 'bg-sky-950/40 border-sky-500/40 shadow-[0_0_20px_rgba(0,120,212,0.2)]'
            }`}
          >
            <div className="flex items-center justify-between gap-3 relative z-10">
              <div className="flex items-center space-x-2.5 text-xs font-semibold text-slate-100">
                <Sparkles className="w-4 h-4 text-sky-400 shrink-0 animate-spin-slow" />
                <span>{dynamicRibbonText}</span>
              </div>
              <span className="text-[9.5px] font-mono uppercase font-bold tracking-wider text-sky-400 bg-sky-500/20 px-2 py-0.5 rounded border border-sky-500/40 shrink-0">
                {isTransExpanded ? `Transformation ${transSliderPos}%` : 'Ribbon Synced'}
              </span>
            </div>
            <div className="absolute inset-0 animate-shimmer opacity-20 pointer-events-none" />
          </div>

          {/* CINEMATIC NARRATIVE HERO CARD */}
          <div className="relative rounded-2xl border border-white/10 overflow-hidden shadow-2xl shrink-0 flex flex-col transition-all duration-700 bg-[#090D16] min-h-fit">
            
            {/* PERSONA-SPECIFIC BACKGROUND ANIMATIONS */}
            {activePersona.bgAnimationType === 'engineer' && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(#0078D4_1px,transparent_1px)] [background-size:24px_24px] opacity-15 animate-grid-move" />
                <div className="absolute top-10 right-10 w-64 h-64 rounded-full bg-sky-500/10 blur-3xl animate-pulse" />
              </div>
            )}

            {activePersona.bgAnimationType === 'security' && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-[#02152E] via-[#081C38] to-[#010D1E] opacity-90" />
                <div className="absolute -top-20 -right-20 w-96 h-96 rounded-full border border-sky-500/20 animate-radar-sweep" />
              </div>
            )}

            {activePersona.bgAnimationType === 'pm' && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-0 bottom-0 left-10 right-10 flex flex-col justify-around opacity-15">
                  <div className="h-0.5 bg-sky-400 animate-shimmer" />
                  <div className="h-0.5 bg-purple-400 animate-shimmer" />
                  <div className="h-0.5 bg-emerald-400 animate-shimmer" />
                </div>
              </div>
            )}

            {activePersona.bgAnimationType === 'writer' && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-0 bottom-0 left-1/4 w-0.5 bg-gradient-to-b from-transparent via-amber-400/30 to-transparent animate-doc-flow" />
                <div className="absolute top-0 bottom-0 right-1/4 w-0.5 bg-gradient-to-b from-transparent via-sky-400/30 to-transparent animate-doc-flow" />
              </div>
            )}

            {activePersona.bgAnimationType === 'researcher' && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-purple-950/60 via-slate-950 to-sky-950/60" />
                <div className="absolute left-1/3 top-1/4 w-40 h-40 rounded-full bg-purple-500/20 blur-xl animate-nebula" />
              </div>
            )}

            {/* OVERLAY */}
            <div className={`absolute inset-0 bg-black/40 backdrop-blur-md transition-opacity duration-700 ${
              isExpanded ? 'opacity-90' : 'opacity-40'
            }`} />

            {/* CARD MAIN CONTENT CONTAINER */}
            <div className="relative z-10 p-6 flex flex-col space-y-6">
              
              {/* Persona Story Header */}
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/10 shrink-0">
                <div className="flex items-center space-x-4">
                  <div className="w-14 h-14 rounded-2xl bg-slate-900/90 border border-sky-500/50 flex items-center justify-center text-3xl shadow-[0_0_20px_rgba(0,120,212,0.35)] animate-pulse shrink-0">
                    {activePersona.avatar}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2.5">
                      <h2 className="text-lg font-extrabold text-white tracking-tight">
                        {activePersona.name}
                      </h2>
                      <span className="text-[11px] font-mono bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2.5 py-0.5 rounded-full font-bold">
                        {activePersona.department}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 font-medium mt-0.5">
                      {activePersona.role} • <span className="text-sky-400 font-semibold">{activePersona.useCaseCluster}</span>
                    </p>
                  </div>
                </div>

                {/* Quick Value Badge & EXPAND STORY / COLLAPSE BUTTON */}
                <div className="flex items-center space-x-3">
                  <div className="hidden lg:flex flex-col items-end px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400">Value Potential</span>
                    <span className="text-xs font-mono font-extrabold text-emerald-400">{activePersona.valuePotential.annualValuePerSeat}</span>
                  </div>

                  <button
                    onClick={toggleExpand}
                    className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl font-extrabold text-xs transition-all duration-300 border cursor-pointer ${
                      isExpanded
                        ? 'bg-purple-600 hover:bg-purple-500 text-white border-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.4)]'
                        : 'bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white border-sky-400 shadow-[0_0_20px_rgba(0,120,212,0.4)]'
                    }`}
                  >
                    <Sparkles className="w-4 h-4 animate-spin-slow" />
                    <span>{isExpanded ? 'Collapse 7-Part Story' : 'Expand Full 7-Part Narrative'}</span>
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* MODE 1 — SHORT STORY (MODE 1 ACTIVE) */}
              {!isExpanded && (
                <div className="space-y-5 flex flex-col animate-fade-in">
                  
                  {/* Persona Story Quote Summary */}
                  <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900/90 via-[#0C1425] to-slate-900/90 border border-sky-500/30 relative overflow-hidden shadow-lg">
                    <div className="absolute top-0 right-0 p-3 text-sky-500/10 pointer-events-none">
                      <Bookmark className="w-16 h-16" />
                    </div>
                    <span className="text-[10px] font-mono font-extrabold text-sky-400 uppercase tracking-widest block mb-1.5">
                      Persona Story Narrative Synthesis
                    </span>
                    <p className="text-sm text-slate-100 leading-relaxed font-normal">
                      "{activePersona.shortStory.summary}"
                    </p>
                  </div>

                  {/* INLINE TRANSFORMATION SURFACE (BEFORE → AFTER) */}
                  <TransformationSurface
                    data={transformationData}
                    sliderPos={transSliderPos}
                    onSliderChange={handleSliderChange}
                    isExpanded={isTransExpanded}
                    onToggleExpand={() => setIsTransExpanded(!isTransExpanded)}
                  />

                  {/* Multi-Select Collaboration & Sensitivity Matrix */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800 space-y-2">
                      <span className="text-[10px] font-mono text-slate-400 uppercase font-bold flex items-center justify-between">
                        <span>Multi-Select Collaboration Pattern</span>
                        <span className="text-sky-400 font-mono text-[9px]">{activePersona.collaborationPattern.length} Selected</span>
                      </span>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {activePersona.collaborationPattern.map((ch, idx) => (
                          <span key={idx} className="text-[10px] font-mono bg-sky-950/80 text-sky-300 border border-sky-800/80 px-2.5 py-1 rounded-lg flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                            {ch}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800 space-y-2">
                      <span className="text-[10px] font-mono text-slate-400 uppercase font-bold flex items-center justify-between">
                        <span>Multi-Select Sensitivity Profile</span>
                        <span className="text-rose-400 font-mono text-[9px]">{activePersona.sensitivitySet.length} Selected</span>
                      </span>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {activePersona.sensitivitySet.map((sen, idx) => (
                          <span key={idx} className="text-[10px] font-mono bg-rose-950/80 text-rose-300 border border-rose-800/80 px-2.5 py-1 rounded-lg flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                            {sen}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Key Callout Boxes */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs space-y-1.5">
                      <span className="text-[10px] font-mono font-bold uppercase text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" />
                        Telemetry Reality Check
                      </span>
                      <p className="text-amber-200/95 leading-relaxed">
                        {activePersona.shortStory.telemetryCheck}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-sky-950/30 border border-sky-500/30 text-xs space-y-1.5">
                      <span className="text-[10px] font-mono font-bold uppercase text-sky-400 flex items-center gap-1.5">
                        <Zap className="w-4 h-4" />
                        Copilot Value Unlock
                      </span>
                      <p className="text-sky-200/95 leading-relaxed">
                        {activePersona.shortStory.copilotUnlock}
                      </p>
                    </div>
                  </div>

                  {/* Outcome Priorities & ROI Impact Footer */}
                  <div className="p-4 rounded-xl bg-slate-900/90 border border-white/10 flex flex-col md:flex-row items-center justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                        <Target className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-[10px] font-mono text-slate-400 uppercase font-bold block">Outcome Priorities</span>
                        <p className="text-xs font-bold text-emerald-300">
                          {activePersona.outcomePriorities.join(' • ')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4 shrink-0">
                      <div className="text-right">
                        <span className="text-[10px] font-mono text-slate-400 block">Weekly Return</span>
                        <span className="text-xs font-mono font-extrabold text-white">{activePersona.valuePotential.hoursSavedPerWeek} hrs / week</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-mono text-slate-400 block">ROI Multiplier</span>
                        <span className="text-xs font-mono font-extrabold text-emerald-400">{activePersona.valuePotential.roiMultiplier}</span>
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* MODE 2 — EXPANDED NARRATIVE (7-PART CINEMATIC ANALYSIS) */}
              {isExpanded && (
                <div className="pt-2 space-y-5 animate-fade-slide">
                  
                  <div className="flex items-center justify-between pb-2 border-b border-purple-500/30">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-purple-300 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      <span>Full 7-Part Persona Narrative Surface</span>
                    </h3>
                    <span className="text-[10px] font-mono text-purple-300 bg-purple-500/20 px-2.5 py-0.5 rounded-full border border-purple-500/40">
                      Expanded Mode Active
                    </span>
                  </div>

                  {/* 7 Structured Sections */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    
                    {/* 1. Identity & Role Context */}
                    <div className="p-4 bg-black/60 rounded-xl border border-white/10 space-y-2">
                      <span className="text-[10px] font-mono font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        1. Identity & Role Context
                      </span>
                      <p className="text-slate-300 leading-relaxed text-xs">
                        {activePersona.expandedNarrative.identityContext}
                      </p>
                    </div>

                    {/* 2. Collaboration Patterns & Sensitivity Profile */}
                    <div className="p-4 bg-black/60 rounded-xl border border-white/10 space-y-2">
                      <span className="text-[10px] font-mono font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" />
                        2. Collaboration Patterns & Sensitivity
                      </span>
                      <p className="text-slate-300 leading-relaxed text-xs">
                        {activePersona.expandedNarrative.collaborationSensitivity}
                      </p>
                    </div>

                    {/* 3. Telemetry Reality Check */}
                    <div className="p-4 bg-black/60 rounded-xl border border-amber-500/30 space-y-2">
                      <span className="text-[10px] font-mono font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        3. Telemetry Reality Check
                      </span>
                      <p className="text-amber-200/90 leading-relaxed text-xs">
                        {activePersona.expandedNarrative.telemetryRealityCheck}
                      </p>
                    </div>

                    {/* 4. Workflow Friction & Governance Gaps */}
                    <div className="p-4 bg-black/60 rounded-xl border border-white/10 space-y-2">
                      <span className="text-[10px] font-mono font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5" />
                        4. Workflow Friction & Governance Gaps
                      </span>
                      <p className="text-slate-300 leading-relaxed text-xs">
                        {activePersona.expandedNarrative.workflowFriction}
                      </p>
                    </div>

                    {/* 5. Use-Case Feasibility & Adoption Readiness */}
                    <div className="p-4 bg-black/60 rounded-xl border border-emerald-500/30 space-y-2">
                      <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        5. Use-Case Feasibility & Adoption
                      </span>
                      <p className="text-emerald-200/90 leading-relaxed text-xs">
                        {activePersona.expandedNarrative.feasibilityReadiness}
                      </p>
                    </div>

                    {/* 6. Copilot Value Story */}
                    <div className="p-4 bg-black/60 rounded-xl border border-purple-500/30 space-y-2">
                      <span className="text-[10px] font-mono font-bold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5" />
                        6. Copilot Value Story
                      </span>
                      <p className="text-purple-200/90 leading-relaxed text-xs">
                        {activePersona.expandedNarrative.copilotValueStory}
                      </p>
                    </div>

                  </div>

                  {/* 7. Persona-Specific ROI Potential Banner */}
                  <div className="p-5 rounded-2xl bg-gradient-to-r from-purple-950/90 via-indigo-950/90 to-sky-950/90 border border-purple-500/40 space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-bold text-purple-300 uppercase tracking-wider">
                      <span className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-emerald-400" />
                        <span>7. Persona-Specific ROI Potential & Seat Value</span>
                      </span>
                      <span className="font-mono text-emerald-400 text-base font-extrabold">{activePersona.valuePotential.annualValuePerSeat}</span>
                    </div>
                    <p className="text-slate-200 text-xs leading-relaxed">
                      {activePersona.expandedNarrative.roiBreakdown}
                    </p>
                  </div>

                  {/* Bottom Collapse Story Button */}
                  <div className="pt-2 flex justify-center">
                    <button
                      onClick={toggleExpand}
                      className="px-5 py-2.5 bg-purple-600/90 hover:bg-purple-500 text-white font-bold text-xs rounded-xl border border-purple-400 flex items-center space-x-2 transition-all cursor-pointer shadow-lg shadow-purple-950/50"
                    >
                      <ChevronUp className="w-4 h-4" />
                      <span>Collapse 7-Part Story View</span>
                    </button>
                  </div>

                </div>
              )}

            </div>
          </div>

        </main>

        {/* ==================================================================== */}
        {/* RIGHT PANEL — PERSONA METRICS (ANIMATED) */}
        {/* ==================================================================== */}
        <aside className="w-80 bg-[#0A0E17]/95 border-l border-white/10 p-4 flex flex-col justify-between shrink-0 overflow-y-auto scrollbar-thin space-y-4 z-20 select-none">
          
          <div className="space-y-4">
            
            {/* Title */}
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h2 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
                Persona Telemetry Metrics
              </h2>
              <span className="text-[10px] font-mono text-sky-400 font-semibold bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/30">
                Live Fusion
              </span>
            </div>

            {/* DUAL RADIAL GAUGES: Risk Score vs Feasibility Score */}
            <div className="bg-black/40 backdrop-blur-md border border-white/10 p-3.5 rounded-xl space-y-3">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-300">
                <span>Score Vectors</span>
                <span className="text-[10px] font-mono text-slate-500">0 – 100 Scale</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center">
                
                {/* Persona Risk Gauge */}
                <div className="flex flex-col items-center space-y-1 bg-black/50 p-2 rounded-lg border border-white/5 relative">
                  <span className="text-[10px] font-mono text-slate-400">Risk Score</span>
                  <div className="relative w-16 h-16 flex items-center justify-center">
                    <div className="absolute inset-0 rounded-full border border-rose-500/30 animate-ring-rotate pointer-events-none" />
                    <svg className="w-16 h-16 transform -rotate-90">
                      <circle cx="32" cy="32" r={riskRadius} stroke="rgba(255,255,255,0.1)" strokeWidth="5" fill="transparent" />
                      <circle
                        cx="32"
                        cy="32"
                        r={riskRadius}
                        stroke={effectiveRiskScore > 50 ? '#F43F5E' : effectiveRiskScore > 30 ? '#F59E0B' : '#10B981'}
                        strokeWidth="5"
                        strokeDasharray={riskCircumference}
                        strokeDashoffset={riskOffset}
                        strokeLinecap="round"
                        fill="transparent"
                        className="transition-all duration-700 ease-out"
                      />
                    </svg>
                    <span className="absolute text-sm font-extrabold text-white font-mono">
                      {effectiveRiskScore}
                    </span>
                  </div>
                  <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.2 rounded border ${
                    effectiveRiskScore > 50
                      ? 'text-rose-400 bg-rose-950/60 border-rose-800'
                      : effectiveRiskScore > 30
                      ? 'text-amber-400 bg-amber-950/60 border-amber-800'
                      : 'text-emerald-400 bg-emerald-950/60 border-emerald-800'
                  }`}>
                    {effectiveRiskScore > 50 ? 'Elevated Risk' : effectiveRiskScore > 30 ? 'Moderate' : 'Low Risk'}
                  </span>
                </div>

                {/* Persona Feasibility Score */}
                <div className="flex flex-col items-center space-y-1 bg-black/50 p-2 rounded-lg border border-white/5 relative">
                  <span className="text-[10px] font-mono text-slate-400">Feasibility</span>
                  <div className="relative w-16 h-16 flex items-center justify-center">
                    <div className="absolute inset-0 rounded-full border border-sky-500/30 animate-ring-rotate pointer-events-none" />
                    <svg className="w-16 h-16 transform -rotate-90">
                      <circle cx="32" cy="32" r={feasRadius} stroke="rgba(255,255,255,0.1)" strokeWidth="5" fill="transparent" />
                      <circle
                        cx="32"
                        cy="32"
                        r={feasRadius}
                        stroke="#0078D4"
                        strokeWidth="5"
                        strokeDasharray={feasCircumference}
                        strokeDashoffset={feasOffset}
                        strokeLinecap="round"
                        fill="transparent"
                        className="transition-all duration-700 ease-out"
                      />
                    </svg>
                    <span className="absolute text-sm font-extrabold text-white font-mono">
                      {effectiveFeasibilityScore}%
                    </span>
                  </div>
                  <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.2 rounded border text-sky-400 bg-sky-950/60 border-sky-800">
                    High Readiness
                  </span>
                </div>

              </div>
            </div>

            {/* ADOPTION FRICTION BAR */}
            <div className="bg-black/40 backdrop-blur-md border border-white/10 p-3 rounded-xl space-y-1.5">
              <div className="flex justify-between items-center text-[11px] font-bold">
                <span className="text-slate-300">Adoption Friction</span>
                <span className="font-mono text-sky-400 text-xs">{effectiveAdoptionFriction}%</span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-white/5">
                <div
                  className="bg-gradient-to-r from-emerald-500 via-sky-500 to-amber-500 h-full rounded-full transition-all duration-700"
                  style={{ width: `${Math.min(100, effectiveAdoptionFriction)}%` }}
                />
              </div>
              <p className="text-[9.5px] text-slate-400 text-right">
                Change management resistance factor
              </p>
            </div>

            {/* SENSITIVITY EXPOSURE LIST */}
            <div className="bg-black/40 backdrop-blur-md border border-white/10 p-3 rounded-xl space-y-2">
              <span className="text-[10px] font-mono uppercase font-bold text-slate-400 block">
                Sensitivity Exposure (Telemetry × Quiz)
              </span>
              <div className="space-y-1.5">
                {activePersona.sensitivityExposure.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-[10px] bg-slate-900/80 p-2 rounded border border-slate-800">
                    <span className="text-slate-300 font-medium truncate max-w-[170px]">{item.label}</span>
                    <span className={`font-mono text-[9px] px-1.5 py-0.2 rounded border font-semibold ${
                      item.severity === 'High'
                        ? 'text-rose-400 bg-rose-950/80 border-rose-800'
                        : item.severity === 'Medium'
                        ? 'text-amber-400 bg-amber-950/80 border-amber-800'
                        : 'text-emerald-400 bg-emerald-950/80 border-emerald-800'
                    }`}>
                      {item.severity}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* COLLABORATION FRICTION LIST */}
            <div className="bg-black/40 backdrop-blur-md border border-white/10 p-3 rounded-xl space-y-2">
              <span className="text-[10px] font-mono uppercase font-bold text-slate-400 block">
                Collaboration Friction Bottlenecks
              </span>
              <div className="space-y-1.5">
                {activePersona.collaborationFriction.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-[10px] bg-slate-900/80 p-2 rounded border border-slate-800">
                    <span className="text-slate-300 font-medium truncate max-w-[170px]">{item.label}</span>
                    <span className={`font-mono text-[9px] px-1.5 py-0.2 rounded border font-semibold ${
                      item.severity === 'High'
                        ? 'text-rose-400 bg-rose-950/80 border-rose-800'
                        : 'text-amber-400 bg-amber-950/80 border-amber-800'
                    }`}>
                      {item.severity}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* VALUE POTENTIAL VECTOR (ROI CARD) */}
            <div className="bg-gradient-to-br from-emerald-950/50 via-slate-900 to-sky-950/50 border border-emerald-500/40 p-3.5 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold uppercase text-emerald-400 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Value Potential ROI Vector
                </span>
                <span className="text-xs font-mono font-extrabold text-emerald-300">
                  {activePersona.valuePotential.roiMultiplier}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center pt-1">
                <div className="bg-black/40 p-2 rounded border border-white/5">
                  <span className="text-[9px] font-mono text-slate-400 block">Weekly Return</span>
                  <span className="text-xs font-mono font-bold text-white">
                    {activePersona.valuePotential.hoursSavedPerWeek} hrs/wk
                  </span>
                </div>
                <div className="bg-black/40 p-2 rounded border border-white/5">
                  <span className="text-[9px] font-mono text-slate-400 block">Annual Seat Value</span>
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    {activePersona.valuePotential.annualValuePerSeat}
                  </span>
                </div>
              </div>

              <p className="text-[9.5px] text-slate-300 leading-tight pt-1">
                {activePersona.valuePotential.primaryBenefit}
              </p>
            </div>

          </div>

          {/* FOOTER METRICS STAMP */}
          <div className="pt-2 border-t border-white/10 text-center text-[9px] font-mono text-slate-500">
            Persona Cohort Fusion Engine • Live Telemetry Active
          </div>

        </aside>

      </div>

    </div>
  );
};
