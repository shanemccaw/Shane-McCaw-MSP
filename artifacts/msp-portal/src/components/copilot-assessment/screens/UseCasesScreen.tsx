import React, { useState } from 'react';
import { 
  Grid, 
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
  Lightbulb,
  Code2,
  Scale,
  Crown,
  Rocket,
  Search,
  Filter,
  Users
} from 'lucide-react';

import { UnifiedTelemetryCarousel, ExtendedEngineDef, ExtendedDocDef } from '../telemetry/UnifiedTelemetryCarousel';
import { TELEMETRY_ENGINES, TELEMETRY_DOCS } from '../telemetryCatalog';
import { TransformationSurface, TransformationData } from '../telemetry/TransformationSurface';

export interface ExtendedUseCaseData {
  id: string;
  name: string;
  category: string;
  personaCluster: string;
  bgAnimationType: 'blueprint' | 'radar' | 'timeline' | 'doc_flow' | 'nebula' | 'particles';
  
  // Scores & Tags
  feasibilityScore: number;
  adoptionReadiness: number;
  blocked: boolean;
  blockers: string[];
  expectedRoi: string;
  hoursSavedPerWeek: number;
  roiMultiplier: string;
  outcomePriority: string;
  
  // Multi-Select Tags
  sensitivityImpact: string[];
  collaborationImpact: string[];

  // Severity Exposure & Collaboration Friction
  sensitivityExposure: { label: string; severity: 'High' | 'Medium' | 'Low' }[];
  collaborationFriction: { label: string; severity: 'High' | 'Medium' | 'Low' }[];

  // Short Story (3-5 SENTENCES)
  shortStory: {
    context: string;
    personaCluster: string;
    telemetryCheck: string;
    workflowFriction: string;
    copilotUnlock: string;
  };

  // Expanded Narrative (8 Parts)
  expandedNarrative: {
    workflowContext: string;
    personaInvolvement: string;
    collaborationSensitivity: string;
    telemetryRealityCheck: string;
    governanceGaps: string;
    feasibilityReadiness: string;
    copilotValueStory: string;
    roiBreakdown: string;
  };

  insightRibbonText: string;
}

const EXTENDED_USE_CASES: ExtendedUseCaseData[] = [
  {
    id: 'uc_eng_api',
    name: 'Automated Code Review & API Microservices',
    category: 'Engineering & Dev Ops',
    personaCluster: 'Engineering & Dev Lead Cohort',
    bgAnimationType: 'blueprint',
    feasibilityScore: 92,
    adoptionReadiness: 90,
    blocked: false,
    blockers: [],
    expectedRoi: '$18,400 / seat / yr',
    hoursSavedPerWeek: 6.8,
    roiMultiplier: '8.4x ROI',
    outcomePriority: '+35% Dev Velocity',
    sensitivityImpact: ['API Keys & Secrets', 'Confidential IP', 'Prod Conn Strings'],
    collaborationImpact: ['GitHub Repos', 'Teams Dev Channel', 'M365 Loop', 'VS Code'],
    sensitivityExposure: [
      { label: 'Unmonitored API Key Snippets', severity: 'High' },
      { label: 'Overshared Dev Specs in Teams', severity: 'Medium' },
      { label: 'Unlabeled Architecture Diagrams', severity: 'Low' }
    ],
    collaborationFriction: [
      { label: 'Manual PR & Spec Reconciliation', severity: 'High' },
      { label: 'Cross-Squad Context Loss in Slack/Teams', severity: 'Medium' }
    ],
    shortStory: {
      context: 'Engineers coordinate multi-repo microservices across 1,400+ weekly Teams messages and GitHub pull requests.',
      personaCluster: 'Dev Leads and Cloud Architects manage code contracts and release pipelines.',
      telemetryCheck: 'Drift Engine detected 14 unmonitored API key strings in public Teams chats & 3 overshared SharePoint dev repos.',
      workflowFriction: 'Developers waste 1.5 hours daily manually verifying spec changes and reconciling API versions across Jira and Teams.',
      copilotUnlock: 'M365 Copilot with Graph Connectors & Copilot Studio automates PR reviews and architectural synthesis while Purview enforces auto-labeling on secret credentials.'
    },
    expandedNarrative: {
      workflowContext: 'This workflow accelerates engineering release velocity by connecting Microsoft Graph telemetry directly to developer tools, code repositories, and architectural specification stores.',
      personaInvolvement: 'Primary users include Lead Cloud Architects, Senior Software Engineers, and DevOps Engineers managing multi-squad microservice deployments.',
      collaborationSensitivity: 'Operates across GitHub Repos, Teams Dev Channels, and M365 Loop workspaces. Sensitive assets include proprietary source code algorithms, cloud connection strings, and production architecture specs.',
      telemetryRealityCheck: 'Signals & Drift Engines identified 14 hardcoded credential strings in Teams snippets, 3 overshared SharePoint sites with broad "Everyone" permissions, and CA01 MFA bypass exceptions on legacy service accounts.',
      governanceGaps: 'Dev teams lack automated secret detection prior to commit, leaving raw credentials exposed in unencrypted chat logs and internal repos.',
      feasibilityReadiness: 'Feasibility Score is 92/100 due to high technical literacy and existing M365 E5 licensing. Champion readiness is high with minimal change resistance.',
      copilotValueStory: 'Integrating M365 Copilot with GitHub Copilot & Azure Graph Connectors enables instant code documentation synthesis, real-time PR triage, and automated architecture brief generation.',
      roiBreakdown: 'Recovers 6.8 hours/week per developer. At an average developer cost, this yields $18,400 in annual productivity value per seat with an 8.4x ROI multiplier.'
    },
    insightRibbonText: '⚡ Engineering Workflow: 14 unmonitored API keys detected in specs — Copilot Graph Grounding recovers 6.8 hrs/wk with automated sensitivity enforcement.'
  },
  {
    id: 'uc_sec_audit',
    name: 'Contract Redline & SecOps Guardrail Audit',
    category: 'Security & Compliance',
    personaCluster: 'SecOps & Mission Specialist Cohort',
    bgAnimationType: 'radar',
    feasibilityScore: 85,
    adoptionReadiness: 82,
    blocked: true,
    blockers: ['CA01 Policy Exception Drift', 'Public Link Oversharing on Sensitive Sites'],
    expectedRoi: '$21,200 / seat / yr',
    hoursSavedPerWeek: 5.4,
    roiMultiplier: '9.1x ROI',
    outcomePriority: '100% Audit Coverage',
    sensitivityImpact: ['PII Records', 'Credential Vaults', 'DLP Audit Logs', 'CA01 Specs'],
    collaborationImpact: ['Purview Center', 'Defender SIEM', 'Teams Incident Room', 'Exchange'],
    sensitivityExposure: [
      { label: 'Public Sharing Links on Sensitive Sites', severity: 'High' },
      { label: 'CA01 Policy Exception Drift', severity: 'High' },
      { label: 'Unlabeled PII in Legacy Exchange Logs', severity: 'Medium' }
    ],
    collaborationFriction: [
      { label: 'Manual Security Incident Triage', severity: 'High' },
      { label: 'DLP Override Audit Bottlenecks', severity: 'Medium' }
    ],
    shortStory: {
      context: 'SecOps analysts continuously triage tenant threats and monitor data loss prevention policies across 1,240 SharePoint sites.',
      personaCluster: 'Principal Security Engineers and Governance Officers lead zero-trust compliance.',
      telemetryCheck: 'Health Engine & Priority Engine flagged CA01 Conditional Access exemptions and 18 public sharing links on sensitive HR/Finance sites.',
      workflowFriction: 'Analysts spend 18+ hours weekly manually cross-referencing Defender SIEM logs with manual DLP override requests.',
      copilotUnlock: 'Copilot for Security correlates Graph signals with Defender incidents in natural language, automatically applying Purview Labels and blocking unauthorized link sharing.'
    },
    expandedNarrative: {
      workflowContext: 'Provides automated security guardrail auditing and real-time threat intelligence correlation across Microsoft Purview and Defender SIEM.',
      personaInvolvement: 'Directly serves Security Operations Center (SOC) analysts, Compliance Officers, and Infrastructure Security Leads.',
      collaborationSensitivity: 'Utilizes Purview Compliance Center, Defender SIEM, and dedicated Teams Incident War Rooms. Handles highly sensitive PII, audit trails, and conditional access policies.',
      telemetryRealityCheck: 'Tenant telemetry revealed legacy basic auth protocols still active on 2 admin endpoints, missing PIM step-up MFA for 3 global admin roles, and 18 overshared public links.',
      governanceGaps: 'Requires strict enforcement of Purview auto-labeling rules and elimination of CA01 Conditional Access bypass groups before full rollout.',
      feasibilityReadiness: 'Feasibility Score of 85/100. High readiness for automated security copilots once CA01 conditional access policies are tightened.',
      copilotValueStory: 'Copilot for Security correlates Graph signals with Defender incidents in natural language, reducing threat investigation time from hours to seconds.',
      roiBreakdown: 'Saves 5.4 hours/week per SecOps analyst, avoiding costly audit findings and generating $21,200 in annual productivity and risk-mitigation value per seat.'
    },
    insightRibbonText: '🛡️ SecOps Guardrails: 18 overshared public links & CA01 MFA exemptions flagged — Copilot for Security automates threat triage and Purview auto-labeling.'
  },
  {
    id: 'uc_pm_sprint',
    name: 'Cross-Squad Sprint Synthesis & Status Briefs',
    category: 'Product & Agile PMO',
    personaCluster: 'Product & Project Manager Cohort',
    bgAnimationType: 'timeline',
    feasibilityScore: 94,
    adoptionReadiness: 95,
    blocked: false,
    blockers: [],
    expectedRoi: '$16,500 / seat / yr',
    hoursSavedPerWeek: 5.8,
    roiMultiplier: '7.8x ROI',
    outcomePriority: '+40% Sprint Cycle Speed',
    sensitivityImpact: ['Roadmap Strategy', 'Customer Feedback', 'Sprint Velocity Logs', 'Vendor SOWs'],
    collaborationImpact: ['Teams Squad Channels', 'Word PRDs', 'Loop Workspaces', 'Jira / DevOps'],
    sensitivityExposure: [
      { label: 'Unrestricted Customer Feedback Repos', severity: 'Medium' },
      { label: 'Draft Financial SOWs in Teams', severity: 'Medium' }
    ],
    collaborationFriction: [
      { label: '68% Meeting Time Congestion', severity: 'High' },
      { label: 'Manual Executive Status Report Assembly', severity: 'High' }
    ],
    shortStory: {
      context: 'Program managers oversee 12 cross-functional sprint pods and process 1,400 Teams messages weekly.',
      personaCluster: 'Staff Product Managers and Agile Leads drive feature roadmaps and release trains.',
      telemetryCheck: 'Signals Engine detected 68% of work hours spent in Teams calls with 1,400+ weekly chat messages across 12 squad channels.',
      workflowFriction: 'PMs lose up to 10 hours every week manually writing meeting minutes, drafting status decks, and following up on unassigned action items.',
      copilotUnlock: 'Copilot in Teams & Word auto-generates meeting recaps, extracts action items directly into Jira/DevOps, and drafts executive status briefs.'
    },
    expandedNarrative: {
      workflowContext: 'Automates sprint documentation generation, meeting action item extraction, and executive status reporting across multi-squad agile teams.',
      personaInvolvement: 'Designed for Technical Product Managers, Scrum Masters, and PMO Program Directors.',
      collaborationSensitivity: 'Heavy daily activity in Teams Channels, Word PRDs, M365 Loop workspaces, and DevOps boards. Manages strategic roadmap data and vendor SOWs.',
      telemetryRealityCheck: 'Priority Engine highlighted extreme meeting fragmentation (68% meeting time ratio) causing status reporting delay cycles of 4+ days.',
      governanceGaps: 'Draft product requirements documents (PRDs) often contain customer PII without automated classification labels.',
      feasibilityReadiness: 'Feasibility Score of 94/100. Highest adoption velocity among all enterprise cohorts with immediate productivity return.',
      copilotValueStory: 'Copilot in Teams captures key decisions during live meetings, creates action-item tables in Loop, and converts PRDs into executive slides automatically.',
      roiBreakdown: 'Recovers 5.8 hours/week per PM. Delivers $16,500 in annual seat value with a 7.8x ROI multiplier.'
    },
    insightRibbonText: '🚀 PMO Sprint Synthesis: 68% meeting time congestion across 12 sprint pods — Copilot synthesizes multi-hour discussions into instant Azure DevOps items.'
  },
  {
    id: 'uc_legal_redline',
    name: 'Contract Redline Analysis & Policy Delta',
    category: 'Legal & Documentation',
    personaCluster: 'Technical Writer & Legal Counsel',
    bgAnimationType: 'doc_flow',
    feasibilityScore: 74,
    adoptionReadiness: 78,
    blocked: true,
    blockers: ['Unlabeled Legal Drafts in SharePoint', 'Missing Encryption on M&A Attachments'],
    expectedRoi: '$19,800 / seat / yr',
    hoursSavedPerWeek: 4.8,
    roiMultiplier: '8.8x ROI',
    outcomePriority: 'Zero Document Delta Error',
    sensitivityImpact: ['Legal Redlines', 'IP Patent Claims', 'Customer NDAs', 'M&A Disclosures'],
    collaborationImpact: ['Word Docs', 'SharePoint Portal', 'Outlook Legal Thread', 'Adobe Acrobat'],
    sensitivityExposure: [
      { label: 'Unlabeled Legal Contract Drafts', severity: 'High' },
      { label: 'Legacy Non-Encrypted M&A Attachments', severity: 'High' }
    ],
    collaborationFriction: [
      { label: '45+ Page Manual Contract Redlines', severity: 'High' },
      { label: 'Version Control Friction in Email Threads', severity: 'Medium' }
    ],
    shortStory: {
      context: 'Legal counsel and technical documentation teams synthesize complex 45+ page contracts and regulatory frameworks.',
      personaCluster: 'Corporate Counsel and Lead Technical Writers manage contract risk and intellectual property.',
      telemetryCheck: 'Drift Engine discovered 42 unlabeled legal contract drafts and NDA documents stored in unencrypted SharePoint folders.',
      workflowFriction: 'Reviewing a single 50-page vendor agreement or contract redline takes 4-6 hours of manual clause comparison.',
      copilotUnlock: 'Copilot in Word compares contract versions, extracts non-standard indemnification clauses, and verifies compliance with enterprise policy.'
    },
    expandedNarrative: {
      workflowContext: 'Accelerates legal contract reviews, regulatory compliance verification, and policy documentation generation while preserving strict provenance.',
      personaInvolvement: 'Primary users include Corporate Legal Counsel, Contract Managers, and Technical Compliance Writers.',
      collaborationSensitivity: 'Operates in Word, SharePoint, and Outlook. Handles highly confidential IP claims, acquisition NDAs, and customer contracts.',
      telemetryRealityCheck: 'Drift Engine detected 42 unlabeled legal contract drafts sitting in public department channels without sensitivity classification.',
      governanceGaps: 'Requires mandatory Purview label auto-application rules to prevent unencrypted legal attachments from leaving tenant boundaries.',
      feasibilityReadiness: 'Feasibility Score of 74/100. Requires strict Purview label enforcement before deploying Copilot to ensure zero accidental data leak.',
      copilotValueStory: 'Copilot in Word performs side-by-side contract analysis, highlights risky liability clauses, and drafts executive summary memos with source citations.',
      roiBreakdown: 'Saves 4.8 hours/week per legal counsel, slashing contract turnaround time from 12 days to 3 days and generating $19,800 in seat value.'
    },
    insightRibbonText: '📜 Legal Redline Workflow: 42 unlabeled legal drafts in public channels — Copilot accelerates contract redline analysis with 100% audit provenance.'
  },
  {
    id: 'uc_exec_brief',
    name: 'Multi-Document Executive Briefing & Strategy',
    category: 'Executive & Strategy',
    personaCluster: 'Executive Leadership & Strategy',
    bgAnimationType: 'nebula',
    feasibilityScore: 96,
    adoptionReadiness: 96,
    blocked: false,
    blockers: [],
    expectedRoi: '$26,500 / seat / yr',
    hoursSavedPerWeek: 7.2,
    roiMultiplier: '11.2x ROI',
    outcomePriority: '+50% Decision Velocity',
    sensitivityImpact: ['Board Packages', 'Financial M&A', 'Executive Compensation', 'Strategic Acquisition'],
    collaborationImpact: ['Board Exchange Threads', 'PowerPoint Decks', 'Excel Financials', 'Teams Exec Briefs'],
    sensitivityExposure: [
      { label: 'Unencrypted Board Presentation Drafts', severity: 'Medium' }
    ],
    collaborationFriction: [
      { label: '480 Weekly Email Thread Overload', severity: 'High' },
      { label: 'Multi-Document Strategy Synthesis Lag', severity: 'Medium' }
    ],
    shortStory: {
      context: 'Executive leadership evaluates strategic M&A proposals, quarterly board decks, and market research dossiers.',
      personaCluster: 'VP Strategy and Chief Research Officers drive executive decision-making and board reporting.',
      telemetryCheck: 'Signals Engine recorded 480 weekly email threads, 18 strategic PowerPoint decks, and continuous multi-document context switches.',
      workflowFriction: 'Synthesizing 5 competitor research reports and preparing a board briefing takes up to 12 hours of manual compilation.',
      copilotUnlock: 'Copilot in PowerPoint & Outlook synthesizes complex financial reports, generates executive briefs, and prepares board presentation storyboards in seconds.'
    },
    expandedNarrative: {
      workflowContext: 'Transforms multi-source financial decks, board memos, and market research reports into concise executive briefings with conversational Q&A capability.',
      personaInvolvement: 'Tailored for Chief Executive Officers, Chief Financial Officers, VPs of Strategy, and Board Directors.',
      collaborationSensitivity: 'High email density in Exchange, confidential board decks in PowerPoint, and financial forecasting models in Excel.',
      telemetryRealityCheck: 'Telemetry shows high executive time spent reading lengthy market research PDFs and reconciling mismatched Excel data.',
      governanceGaps: 'Requires Restricted Access Control (RAC) on C-suite SharePoint document libraries to prevent unauthorized internal exposure.',
      feasibilityReadiness: 'Feasibility Score of 96/100. Highest strategic impact cohort with immediate executive sponsorship.',
      copilotValueStory: 'Copilot synthesizes multi-file dossiers across Outlook, Word, and Excel into a 5-bullet executive summary with interactive Q&A grounding.',
      roiBreakdown: 'Recovers 7.2 hours/week per executive, unlocking $26,500 in annual strategic productivity value per seat.'
    },
    insightRibbonText: '👑 Executive Strategy: 480 weekly email threads & tight M&A review windows — Copilot synthesizes 100-page dossiers in seconds, saving 7.2 hrs/wk.'
  },
  {
    id: 'uc_kb_grounding',
    name: 'Customer Support KB Grounding & Mission Logs',
    category: 'Support & Ops',
    personaCluster: 'Customer Support & Knowledge Ops',
    bgAnimationType: 'particles',
    feasibilityScore: 90,
    adoptionReadiness: 88,
    blocked: false,
    blockers: [],
    expectedRoi: '$15,200 / seat / yr',
    hoursSavedPerWeek: 5.1,
    roiMultiplier: '7.2x ROI',
    outcomePriority: '-65% First Response Time',
    sensitivityImpact: ['Customer Support Logs', 'Internal KB Articles', 'PII Masking', 'SLA Records'],
    collaborationImpact: ['SharePoint Portal', 'Dynamics 365', 'Teams Support Rooms', 'Outlook'],
    sensitivityExposure: [
      { label: 'Unmasked Customer PII in Ticket History', severity: 'Medium' },
      { label: 'Outdated Internal Knowledge Base Articles', severity: 'Low' }
    ],
    collaborationFriction: [
      { label: 'Manual KB Search Across 4 Disparate Repos', severity: 'High' },
      { label: 'Escalation Handoff Delays in Support Channels', severity: 'Medium' }
    ],
    shortStory: {
      context: 'Customer support teams manage technical escalation logs, SLA compliance, and customer resolution documentation.',
      personaCluster: 'Support Operations Managers and Tier-2 Technical Specialists handle complex customer inquiries.',
      telemetryCheck: 'Telemetry signals show 2,400 monthly support ticket logs scattered across SharePoint, Dynamics 365, and email threads.',
      workflowFriction: 'Support agents lose 2 hours daily searching across fragmented knowledge repositories and copying solutions manually.',
      copilotUnlock: 'Copilot Studio grounds Copilot directly in internal support KBs and incident logs, drafting context-aware responses instantly.'
    },
    expandedNarrative: {
      workflowContext: 'Grounds Copilot in internal support knowledge bases and historical resolution logs to empower Tier-1 and Tier-2 agents with real-time technical answers.',
      personaInvolvement: 'Primary users include Customer Support Specialists, Technical Account Managers, and Knowledge Management Directors.',
      collaborationSensitivity: 'Integrates SharePoint knowledge portals, Dynamics 365 Customer Service, and Microsoft Teams escalation channels.',
      telemetryRealityCheck: 'Signals Engine identified 31% duplicate effort in support ticket resolutions due to missing knowledge search integration.',
      governanceGaps: 'Requires automatic PII masking on historical support ticket logs before indexing into Microsoft Graph.',
      feasibilityReadiness: 'Feasibility Score of 90/100. High readiness with clear, measurable operational efficiency gains.',
      copilotValueStory: 'Copilot Studio agent drafts tailored customer response templates in seconds, referencing accurate, up-to-date internal resolution procedures.',
      roiBreakdown: 'Saves 5.1 hours/week per support specialist, reducing resolution time by 65% and delivering $15,200 in annual seat value.'
    },
    insightRibbonText: '💬 Support KB Grounding: 31% duplicate resolution effort detected — Copilot Studio grounds support KBs to cut response times by 65%.'
  }
];

interface UseCasesScreenProps {
  quizAnswers?: Record<string, string>;
  useCases?: any[];
  onContinue: () => void;
  onHelpClick?: () => void;
  onExitClick?: () => void;
  onNavigate?: (step: any) => void;
}

export const UseCasesScreen: React.FC<UseCasesScreenProps> = ({
  quizAnswers = {},
  onContinue,
  onHelpClick,
  onExitClick,
  onNavigate
}) => {
  const [activeUseCaseId, setActiveUseCaseId] = useState<string>('uc_eng_api');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [ribbonPulse, setRibbonPulse] = useState<boolean>(false);

  // Transformation Surface State
  const [transSliderPos, setTransSliderPos] = useState<number>(50);
  const [isTransExpanded, setIsTransExpanded] = useState<boolean>(false);

  const activeUseCase = EXTENDED_USE_CASES.find(u => u.id === activeUseCaseId) || EXTENDED_USE_CASES[0];

  const handleSelectUseCase = (id: string) => {
    if (id === activeUseCaseId) return;
    if (isExpanded) {
      setIsExpanded(false);
    }
    setActiveUseCaseId(id);
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

  // Transformation Data for active use case
  const transformationData: TransformationData = {
    title: activeUseCase.name,
    category: activeUseCase.category,
    before: {
      headline: activeUseCase.shortStory.workflowFriction,
      telemetryItems: activeUseCase.sensitivityExposure.map(s => ({
        label: s.label,
        value: s.severity,
        severity: s.severity
      })),
      frictionPoints: activeUseCase.collaborationFriction.map(f => f.label),
      riskSummary: `Feasibility (${activeUseCase.feasibilityScore}%) • ${activeUseCase.blocked ? 'CA01 Blocked' : 'Policy Drift Detected'}`
    },
    after: {
      headline: activeUseCase.shortStory.copilotUnlock,
      copilotUnlocks: activeUseCase.collaborationImpact.map(ch => ({
        label: ch,
        value: '100% Connected',
        impact: 'Automated Grounding'
      })),
      optimizations: [
        `Purview Auto-Labeling on ${activeUseCase.sensitivityImpact.join(', ')}`,
        `Copilot Grounding for ${activeUseCase.personaCluster}`,
        `Zero manual reconciliation required`
      ],
      roiOutcome: `${activeUseCase.outcomePriority} • ${activeUseCase.hoursSavedPerWeek} hrs/wk saved (${activeUseCase.roiMultiplier})`
    }
  };

  // Dynamic Reactive Metrics based on Slider Position
  const ratio = transSliderPos / 100;
  const effectiveFeasibility = Math.min(100, Math.round(activeUseCase.feasibilityScore * (0.5 + 0.5 * ratio)));
  const effectiveAdoptionReadiness = Math.min(100, Math.round(activeUseCase.adoptionReadiness * (0.5 + 0.5 * ratio)));
  const effectiveHoursSaved = (activeUseCase.hoursSavedPerWeek * (0.2 + 0.8 * ratio)).toFixed(1);

  // Helper icon renderer for carousel
  const renderEngineIcon = (iconName: string) => {
    switch (iconName) {
      case 'Activity': return <Activity className="w-4 h-4 text-sky-400" />;
      case 'ShieldAlert': return <ShieldAlert className="w-4 h-4 text-rose-400" />;
      case 'Layers': return <Layers className="w-4 h-4 text-emerald-400" />;
      case 'TrendingUp': return <TrendingUp className="w-4 h-4 text-amber-400" />;
      case 'CheckCircle2': return <CheckCircle2 className="w-4 h-4 text-indigo-400" />;
      default: return <Sparkles className="w-4 h-4 text-sky-400" />;
    }
  };

  // Convert catalog items for UnifiedTelemetryCarousel
  const extendedEngines: ExtendedEngineDef[] = TELEMETRY_ENGINES.map(e => ({
    ...e,
    status: 'complete',
    progress: 100,
    currentSseMsg: 'Workflow analysis verified'
  }));

  const extendedDocs: ExtendedDocDef[] = TELEMETRY_DOCS.map(d => ({
    ...d,
    status: 'complete',
    progress: 100,
    currentSseMsg: 'Workflow doc mapped'
  }));

  // Gauge calculations
  const feasRadius = 28;
  const feasCircumference = 2 * Math.PI * feasRadius;
  const feasOffset = feasCircumference - (effectiveFeasibility / 100) * feasCircumference;

  const adoptRadius = 28;
  const adoptCircumference = 2 * Math.PI * adoptRadius;
  const adoptOffset = adoptCircumference - (effectiveAdoptionReadiness / 100) * adoptCircumference;

  const dynamicRibbonText = isTransExpanded
    ? transSliderPos < 30
      ? `⚠️ Telemetry Reality Mode (${transSliderPos}%): CA01 policy drift & workflow friction detected for ${activeUseCase.name}.`
      : transSliderPos < 70
      ? `⚡ Transformation Transition Mode (${transSliderPos}%): Graph Connectors & Purview auto-labeling deploying...`
      : `✨ Copilot-Optimized Mode (${transSliderPos}%): ${activeUseCase.insightRibbonText}`
    : activeUseCase.insightRibbonText;

  // Icon selector per use case
  const getUseCaseIcon = (type: string) => {
    switch (type) {
      case 'blueprint': return <Terminal className="w-4 h-4 text-sky-400" />;
      case 'radar': return <ShieldAlert className="w-4 h-4 text-rose-400" />;
      case 'timeline': return <Zap className="w-4 h-4 text-emerald-400" />;
      case 'doc_flow': return <FileText className="w-4 h-4 text-amber-400" />;
      case 'nebula': return <Crown className="w-4 h-4 text-purple-400" />;
      case 'particles': return <Layers className="w-4 h-4 text-indigo-400" />;
      default: return <Grid className="w-4 h-4 text-sky-400" />;
    }
  };

  return (
    <div className="h-screen w-screen bg-[#07090E] text-slate-100 flex flex-col font-sans overflow-hidden antialiased select-none relative">
      
      {/* 1. TOP MISSION-CONTROL TOOLBAR */}
      <header className="h-13 bg-[#0B0F19]/90 border-b border-white/10 px-4 flex items-center justify-between shrink-0 z-30 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <Grid className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                Use-Case Stories & Workflow Intelligence
              </span>
              <span className="text-[10px] font-mono bg-sky-500/20 text-sky-300 border border-sky-500/40 px-2 py-0.5 rounded font-semibold">
                STEP 5 OF 8
              </span>
            </div>
            <p className="text-[10px] text-slate-400">
              Quiz Intent × Persona Clusters × Live Telemetry Reality
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
            <span>Evaluate Security Simulation</span>
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
        {/* LEFT PANEL — USE-CASE SELECTOR RAIL */}
        {/* ==================================================================== */}
        <aside className="w-80 bg-[#0A0E17]/95 border-r border-white/10 p-3.5 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-3 z-20">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Grid className="w-3.5 h-3.5 text-sky-400" />
              <span>Use-Case Rail ({EXTENDED_USE_CASES.length})</span>
            </span>
            <span className="text-[10px] font-mono text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">
              Live Select
            </span>
          </div>

          <div className="space-y-2.5">
            {EXTENDED_USE_CASES.map((uc) => {
              const isActive = uc.id === activeUseCaseId;
              return (
                <div
                  key={uc.id}
                  onClick={() => handleSelectUseCase(uc.id)}
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
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border transition-transform ${
                          isActive
                            ? 'bg-sky-950/80 border-sky-400 text-sky-300 shadow-[0_0_10px_rgba(0,120,212,0.4)] scale-105'
                            : 'bg-slate-900 border-slate-800 text-slate-400 group-hover:scale-105'
                        }`}
                      >
                        {getUseCaseIcon(uc.bgAnimationType)}
                      </div>
                      <div>
                        <h3 className={`text-xs font-bold leading-tight ${
                          isActive ? 'text-white' : 'text-slate-200 group-hover:text-sky-300'
                        }`}>
                          {uc.name}
                        </h3>
                        <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
                          {uc.personaCluster}
                        </p>
                      </div>
                    </div>

                    {uc.blocked ? (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-800/80 text-rose-300 shrink-0 font-bold">
                        BLOCKED
                      </span>
                    ) : (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-800/80 text-emerald-300 shrink-0 font-bold">
                        {uc.feasibilityScore}% FIT
                      </span>
                    )}
                  </div>

                  {/* Multi-Select Collaboration & Sensitivity Chips */}
                  <div className="mt-2.5 pt-2 border-t border-white/5 space-y-1.5">
                    <div className="flex flex-wrap gap-1">
                      <span className="text-[9px] font-mono text-slate-500 font-semibold mr-1">Channels:</span>
                      {uc.collaborationImpact.slice(0, 3).map((ch, idx) => (
                        <span key={idx} className="text-[8.5px] font-mono bg-slate-900/90 text-sky-300 px-1.5 py-0.2 rounded border border-sky-900/50">
                          {ch}
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-1">
                      <span className="text-[9px] font-mono text-slate-500 font-semibold mr-1">Sensitivity:</span>
                      {uc.sensitivityImpact.slice(0, 2).map((sen, idx) => (
                        <span key={idx} className="text-[8.5px] font-mono bg-rose-950/60 text-rose-300 px-1.5 py-0.2 rounded border border-rose-900/50">
                          {sen}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Outcome Priority */}
                  <div className="mt-2 flex items-center justify-between text-[9px] font-mono text-emerald-400 font-semibold bg-emerald-950/30 px-2 py-1 rounded border border-emerald-900/40">
                    <span className="truncate">🎯 {uc.outcomePriority}</span>
                    <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ==================================================================== */}
        {/* CENTER PANEL — USE-CASE STORY (SHORT → EXPANDED NARRATIVE) */}
        {/* ==================================================================== */}
        <main className="flex-1 overflow-y-auto bg-[#05070C] p-5 flex flex-col justify-between relative scrollbar-thin">
          
          <div className="space-y-4">
            {/* INSIGHT RIBBON SYNC */}
            <div
              className={`p-3.5 rounded-xl border transition-all duration-700 backdrop-blur-md relative overflow-hidden shrink-0 ${
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
                  {isTransExpanded ? `Transformation ${transSliderPos}%` : 'Workflow Synced'}
                </span>
              </div>
              <div className="absolute inset-0 animate-shimmer opacity-20 pointer-events-none" />
            </div>

            {/* CINEMATIC NARRATIVE HERO CARD */}
            <div className="relative rounded-2xl border border-white/10 overflow-hidden shadow-2xl flex flex-col transition-all duration-700 bg-[#090D16]">
              
              {/* USE-CASE SPECIFIC BACKGROUND ANIMATIONS */}
              {activeUseCase.bgAnimationType === 'blueprint' && (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="absolute inset-0 bg-[radial-gradient(#0078D4_1px,transparent_1px)] [background-size:24px_24px] opacity-15 animate-grid-move" />
                  <div className="absolute top-10 right-10 w-64 h-64 rounded-full bg-sky-500/10 blur-3xl animate-pulse" />
                </div>
              )}

              {activeUseCase.bgAnimationType === 'radar' && (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-[#02152E] via-[#081C38] to-[#010D1E] opacity-90" />
                  <div className="absolute -top-20 -right-20 w-96 h-96 rounded-full border border-rose-500/20 animate-radar-sweep" />
                </div>
              )}

              {activeUseCase.bgAnimationType === 'timeline' && (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="absolute top-0 bottom-0 left-10 right-10 flex flex-col justify-around opacity-15">
                    <div className="h-0.5 bg-emerald-400 animate-shimmer" />
                    <div className="h-0.5 bg-sky-400 animate-shimmer" />
                    <div className="h-0.5 bg-indigo-400 animate-shimmer" />
                  </div>
                </div>
              )}

              {activeUseCase.bgAnimationType === 'doc_flow' && (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="absolute top-0 bottom-0 left-1/4 w-0.5 bg-gradient-to-b from-transparent via-amber-400/30 to-transparent animate-doc-flow" />
                  <div className="absolute top-0 bottom-0 right-1/4 w-0.5 bg-gradient-to-b from-transparent via-sky-400/30 to-transparent animate-doc-flow" />
                </div>
              )}

              {activeUseCase.bgAnimationType === 'nebula' && (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-tr from-purple-950/60 via-slate-950 to-sky-950/60" />
                  <div className="absolute left-1/3 top-1/4 w-40 h-40 rounded-full bg-purple-500/20 blur-xl animate-nebula" />
                </div>
              )}

              {activeUseCase.bgAnimationType === 'particles' && (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="absolute inset-0 bg-[radial-gradient(#6366F1_1px,transparent_1px)] [background-size:20px_20px] opacity-20 animate-grid-move" />
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-indigo-500/10 blur-3xl animate-pulse" />
                </div>
              )}

              {/* OVERLAY */}
              <div className={`absolute inset-0 bg-black/40 backdrop-blur-md transition-opacity duration-700 ${
                isExpanded ? 'opacity-90' : 'opacity-40'
              }`} />

              {/* CARD MAIN CONTENT CONTAINER */}
              <div className="relative z-10 p-6 space-y-6">
                
                {/* Use Case Story Header */}
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/10">
                  <div className="flex items-center space-x-4">
                    <div className="w-14 h-14 rounded-2xl bg-slate-900/90 border border-sky-500/50 flex items-center justify-center text-3xl shadow-[0_0_20px_rgba(0,120,212,0.35)] animate-pulse shrink-0">
                      {getUseCaseIcon(activeUseCase.bgAnimationType)}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2.5">
                        <h2 className="text-lg font-extrabold text-white tracking-tight">
                          {activeUseCase.name}
                        </h2>
                        <span className="text-[11px] font-mono bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2.5 py-0.5 rounded-full font-bold">
                          {activeUseCase.category}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 font-medium mt-0.5">
                        {activeUseCase.personaCluster} • <span className="text-emerald-400 font-semibold">{activeUseCase.outcomePriority}</span>
                      </p>
                    </div>
                  </div>

                  {/* Quick Value Badge & EXPAND STORY BUTTON */}
                  <div className="flex items-center space-x-3">
                    <div className="hidden lg:flex flex-col items-end px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800">
                      <span className="text-[10px] font-mono text-slate-400">Value Potential</span>
                      <span className="text-xs font-mono font-extrabold text-emerald-400">{activeUseCase.expectedRoi}</span>
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
                      <span>{isExpanded ? 'Collapse 8-Part Story' : 'Expand Full 8-Part Narrative'}</span>
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* MODE 1 — SHORT STORY (3-5 SENTENCES) */}
                {!isExpanded && (
                  <div className="space-y-5 animate-fade-in">
                    
                    {/* Short Story Narrative Synthesis */}
                    <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900/90 via-[#0C1425] to-slate-900/90 border border-sky-500/30 relative overflow-hidden shadow-lg">
                      <div className="absolute top-0 right-0 p-3 text-sky-500/10 pointer-events-none">
                        <Bookmark className="w-16 h-16" />
                      </div>
                      <span className="text-[10px] font-mono font-extrabold text-sky-400 uppercase tracking-widest block mb-1.5">
                        Workflow Story Narrative Synthesis
                      </span>
                      <p className="text-sm text-slate-100 leading-relaxed font-normal">
                        "{activeUseCase.shortStory.context} {activeUseCase.shortStory.personaCluster} {activeUseCase.shortStory.telemetryCheck} {activeUseCase.shortStory.workflowFriction} {activeUseCase.shortStory.copilotUnlock}"
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
                          <span>Collaboration Channels & Pattern</span>
                          <span className="text-sky-400 font-mono text-[9px]">{activeUseCase.collaborationImpact.length} Channels</span>
                        </span>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {activeUseCase.collaborationImpact.map((ch, idx) => (
                            <span key={idx} className="text-[10px] font-mono bg-sky-950/80 text-sky-300 border border-sky-800/80 px-2.5 py-1 rounded-lg flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                              {ch}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800 space-y-2">
                        <span className="text-[10px] font-mono text-slate-400 uppercase font-bold flex items-center justify-between">
                          <span>Sensitivity & Data Classifications</span>
                          <span className="text-rose-400 font-mono text-[9px]">{activeUseCase.sensitivityImpact.length} Assets</span>
                        </span>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {activeUseCase.sensitivityImpact.map((sen, idx) => (
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
                          {activeUseCase.shortStory.telemetryCheck}
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-sky-950/30 border border-sky-500/30 text-xs space-y-1.5">
                        <span className="text-[10px] font-mono font-bold uppercase text-sky-400 flex items-center gap-1.5">
                          <Zap className="w-4 h-4" />
                          Copilot Workflow Unlock
                        </span>
                        <p className="text-sky-200/95 leading-relaxed">
                          {activeUseCase.shortStory.copilotUnlock}
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
                          <span className="text-[10px] font-mono text-slate-400 uppercase font-bold block">Outcome Priority</span>
                          <p className="text-xs font-bold text-emerald-300">
                            {activeUseCase.outcomePriority}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-4 shrink-0">
                        <div className="text-right">
                          <span className="text-[10px] font-mono text-slate-400 block">Weekly Return</span>
                          <span className="text-xs font-mono font-extrabold text-white">{activeUseCase.hoursSavedPerWeek} hrs / week</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] font-mono text-slate-400 block">ROI Multiplier</span>
                          <span className="text-xs font-mono font-extrabold text-emerald-400">{activeUseCase.roiMultiplier}</span>
                        </div>
                      </div>
                    </div>

                  </div>
                )}

                {/* MODE 2 — EXPANDED NARRATIVE (8-PART ANALYSIS) */}
                {isExpanded && (
                  <div className="pt-2 space-y-5 animate-fade-slide">
                    
                    <div className="flex items-center justify-between pb-2 border-b border-purple-500/30">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-purple-300 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-purple-400" />
                        <span>Full 8-Part Workflow Intelligence Narrative</span>
                      </h3>
                      <span className="text-[10px] font-mono text-purple-300 bg-purple-500/20 px-2.5 py-0.5 rounded-full border border-purple-500/40">
                        Expanded Mode Active
                      </span>
                    </div>

                    {/* 8 Structured Sections */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      
                      {/* 1. Workflow Context */}
                      <div className="p-4 bg-black/60 rounded-xl border border-white/10 space-y-2">
                        <span className="text-[10px] font-mono font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Grid className="w-3.5 h-3.5" />
                          1. Workflow Context & Mission Scope
                        </span>
                        <p className="text-slate-300 leading-relaxed text-xs">
                          {activeUseCase.expandedNarrative.workflowContext}
                        </p>
                      </div>

                      {/* 2. Persona Cluster Involvement */}
                      <div className="p-4 bg-black/60 rounded-xl border border-white/10 space-y-2">
                        <span className="text-[10px] font-mono font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5" />
                          2. Persona Cluster Involvement
                        </span>
                        <p className="text-slate-300 leading-relaxed text-xs">
                          {activeUseCase.expandedNarrative.personaInvolvement}
                        </p>
                      </div>

                      {/* 3. Collaboration Patterns & Sensitivity */}
                      <div className="p-4 bg-black/60 rounded-xl border border-white/10 space-y-2">
                        <span className="text-[10px] font-mono font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5" />
                          3. Collaboration & Sensitivity Impact
                        </span>
                        <p className="text-slate-300 leading-relaxed text-xs">
                          {activeUseCase.expandedNarrative.collaborationSensitivity}
                        </p>
                      </div>

                      {/* 4. Telemetry Reality Check */}
                      <div className="p-4 bg-black/60 rounded-xl border border-amber-500/30 space-y-2">
                        <span className="text-[10px] font-mono font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          4. Telemetry Reality Check
                        </span>
                        <p className="text-amber-200/90 leading-relaxed text-xs">
                          {activeUseCase.expandedNarrative.telemetryRealityCheck}
                        </p>
                      </div>

                      {/* 5. Governance Gaps & Friction */}
                      <div className="p-4 bg-black/60 rounded-xl border border-white/10 space-y-2">
                        <span className="text-[10px] font-mono font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          5. Governance Gaps & Workflow Friction
                        </span>
                        <p className="text-slate-300 leading-relaxed text-xs">
                          {activeUseCase.expandedNarrative.governanceGaps}
                        </p>
                      </div>

                      {/* 6. Feasibility & Readiness */}
                      <div className="p-4 bg-black/60 rounded-xl border border-emerald-500/30 space-y-2">
                        <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          6. Feasibility & Adoption Readiness
                        </span>
                        <p className="text-emerald-200/90 leading-relaxed text-xs">
                          {activeUseCase.expandedNarrative.feasibilityReadiness}
                        </p>
                      </div>

                      {/* 7. Copilot Value Story */}
                      <div className="p-4 bg-black/60 rounded-xl border border-purple-500/30 space-y-2 md:col-span-2">
                        <span className="text-[10px] font-mono font-bold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5" />
                          7. Copilot Workflow Value Unlock
                        </span>
                        <p className="text-purple-200/90 leading-relaxed text-xs">
                          {activeUseCase.expandedNarrative.copilotValueStory}
                        </p>
                      </div>

                    </div>

                    {/* 8. Workflow-Specific ROI Potential Banner */}
                    <div className="p-5 rounded-2xl bg-gradient-to-r from-purple-950/90 via-indigo-950/90 to-sky-950/90 border border-purple-500/40 space-y-2.5">
                      <div className="flex items-center justify-between text-xs font-bold text-purple-300 uppercase tracking-wider">
                        <span className="flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-emerald-400" />
                          <span>8. Workflow-Specific ROI Potential & Value Vector</span>
                        </span>
                        <span className="font-mono text-emerald-400 text-base font-extrabold">{activeUseCase.expectedRoi}</span>
                      </div>
                      <p className="text-slate-200 text-xs leading-relaxed">
                        {activeUseCase.expandedNarrative.roiBreakdown}
                      </p>
                    </div>

                    {/* Bottom Collapse Button */}
                    <div className="pt-2 flex justify-center">
                      <button
                        onClick={toggleExpand}
                        className="px-5 py-2.5 bg-purple-600/90 hover:bg-purple-500 text-white font-bold text-xs rounded-xl border border-purple-400 flex items-center space-x-2 transition-all cursor-pointer shadow-lg shadow-purple-950/50"
                      >
                        <ChevronUp className="w-4 h-4" />
                        <span>Collapse 8-Part Story View</span>
                      </button>
                    </div>

                  </div>
                )}

              </div>
            </div>
          </div>

          {/* UNIFIED CAROUSEL INTEGRATION (SUBDUED DOCK AT BOTTOM) */}
          <div className={`mt-4 pt-3 border-t border-white/10 transition-all duration-500 ${
            isExpanded || isTransExpanded ? 'opacity-35 scale-[0.98] pointer-events-none' : 'opacity-80 hover:opacity-100'
          }`}>
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[10px] font-mono text-slate-400 uppercase font-bold flex items-center gap-1.5">
                <Activity className="w-3 h-3 text-sky-400" />
                <span>Unified Telemetry Analysis Dock (Subdued in Workflow View)</span>
              </span>
              <span className="text-[9px] font-mono text-slate-500">
                {isExpanded || isTransExpanded ? 'Subdued Mode Active' : 'Live Grounding Active'}
              </span>
            </div>
            <UnifiedTelemetryCarousel
              phase="complete"
              engines={extendedEngines}
              completedEnginesCount={extendedEngines.length}
              docs={extendedDocs}
              completedDocsCount={extendedDocs.length}
              renderEngineIcon={renderEngineIcon}
            />
          </div>

        </main>

        {/* ==================================================================== */}
        {/* RIGHT PANEL — USE-CASE METRICS (ANIMATED) */}
        {/* ==================================================================== */}
        <aside className="w-80 bg-[#0A0E17]/95 border-l border-white/10 p-4 flex flex-col justify-between shrink-0 overflow-y-auto scrollbar-thin space-y-4 z-20 select-none">
          
          <div className="space-y-4">
            
            {/* Title */}
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h2 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
                Workflow Telemetry Metrics
              </h2>
              <span className="text-[10px] font-mono text-sky-400 font-semibold bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/30">
                Live Vector
              </span>
            </div>

            {/* DUAL RADIAL GAUGES: Feasibility Score vs Adoption Readiness */}
            <div className="bg-black/40 backdrop-blur-md border border-white/10 p-3.5 rounded-xl space-y-3">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-300">
                <span>Workflow Readiness Gauges</span>
                <span className="text-[9.5px] font-mono text-slate-500">2-Meter Sync</span>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                {/* Gauge 1: Feasibility Score */}
                <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                  <div className="relative w-16 h-16 flex items-center justify-center">
                    <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 64 64">
                      <circle
                        cx="32"
                        cy="32"
                        r={feasRadius}
                        className="stroke-slate-800"
                        strokeWidth="5"
                        fill="transparent"
                      />
                      <circle
                        cx="32"
                        cy="32"
                        r={feasRadius}
                        className="stroke-sky-400 transition-all duration-1000 ease-out"
                        strokeWidth="5"
                        strokeDasharray={feasCircumference}
                        strokeDashoffset={feasOffset}
                        strokeLinecap="round"
                        fill="transparent"
                      />
                    </svg>
                    <span className="absolute text-xs font-mono font-extrabold text-white">
                      {effectiveFeasibility}%
                    </span>
                  </div>
                  <span className="text-[9.5px] font-mono text-slate-400 mt-1 font-semibold text-center">
                    Feasibility Score
                  </span>
                </div>

                {/* Gauge 2: Adoption Readiness */}
                <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                  <div className="relative w-16 h-16 flex items-center justify-center">
                    <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 64 64">
                      <circle
                        cx="32"
                        cy="32"
                        r={adoptRadius}
                        className="stroke-slate-800"
                        strokeWidth="5"
                        fill="transparent"
                      />
                      <circle
                        cx="32"
                        cy="32"
                        r={adoptRadius}
                        className="stroke-emerald-400 transition-all duration-1000 ease-out"
                        strokeWidth="5"
                        strokeDasharray={adoptCircumference}
                        strokeDashoffset={adoptOffset}
                        strokeLinecap="round"
                        fill="transparent"
                      />
                    </svg>
                    <span className="absolute text-xs font-mono font-extrabold text-white">
                      {effectiveAdoptionReadiness}%
                    </span>
                  </div>
                  <span className="text-[9.5px] font-mono text-slate-400 mt-1 font-semibold text-center">
                    Adoption Readiness
                  </span>
                </div>
              </div>
            </div>

            {/* GOVERNANCE BLOCKERS LIST */}
            <div className="bg-black/40 backdrop-blur-md border border-white/10 p-3.5 rounded-xl space-y-2.5">
              <span className="text-[10px] font-mono text-slate-400 uppercase font-bold flex items-center justify-between">
                <span>Governance & Security Blockers</span>
                {activeUseCase.blocked ? (
                  <span className="text-rose-400 font-mono text-[9px] font-bold">Action Required</span>
                ) : (
                  <span className="text-emerald-400 font-mono text-[9px] font-bold">Cleared</span>
                )}
              </span>

              {activeUseCase.blockers.length > 0 ? (
                <div className="space-y-1.5 pt-0.5">
                  {activeUseCase.blockers.map((b, idx) => (
                    <div key={idx} className="p-2 rounded-lg bg-rose-950/40 border border-rose-900/60 text-[10.5px] text-rose-200 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                      <span>{b}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-900/50 text-[10.5px] text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>No security blockers. Ready for immediate deployment.</span>
                </div>
              )}
            </div>

            {/* SENSITIVITY EXPOSURE LIST */}
            <div className="bg-black/40 backdrop-blur-md border border-white/10 p-3.5 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-slate-400 uppercase font-bold flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-rose-400" />
                  <span>Sensitivity Exposure</span>
                </span>
                <span className="text-[9px] font-mono text-rose-400 font-bold">Severity</span>
              </div>

              <div className="space-y-1.5 pt-1">
                {activeUseCase.sensitivityExposure.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-slate-900/80 border border-slate-800 text-[10px]">
                    <span className="text-slate-300 font-medium truncate max-w-[170px]">{item.label}</span>
                    <span className={`font-mono px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      item.severity === 'High' ? 'bg-rose-950 text-rose-300 border border-rose-800' :
                      item.severity === 'Medium' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                      'bg-slate-800 text-slate-300 border border-slate-700'
                    }`}>
                      {item.severity}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* COLLABORATION FRICTION LIST */}
            <div className="bg-black/40 backdrop-blur-md border border-white/10 p-3.5 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-slate-400 uppercase font-bold flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-sky-400" />
                  <span>Collaboration Friction</span>
                </span>
                <span className="text-[9px] font-mono text-sky-400 font-bold">Impact</span>
              </div>

              <div className="space-y-1.5 pt-1">
                {activeUseCase.collaborationFriction.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-slate-900/80 border border-slate-800 text-[10px]">
                    <span className="text-slate-300 font-medium truncate max-w-[170px]">{item.label}</span>
                    <span className={`font-mono px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      item.severity === 'High' ? 'bg-rose-950 text-rose-300 border border-rose-800' :
                      item.severity === 'Medium' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                      'bg-slate-800 text-slate-300 border border-slate-700'
                    }`}>
                      {item.severity}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* VALUE & ROI VECTOR SUMMARY */}
            <div className="bg-gradient-to-br from-emerald-950/40 to-slate-900 border border-emerald-500/30 p-3.5 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-emerald-400 uppercase font-bold flex items-center justify-between">
                <span>Value Potential & Seat Impact</span>
                <span className="text-emerald-300 font-mono font-bold text-[9px]">Verified Vector</span>
              </span>

              <div className="grid grid-cols-2 gap-2 pt-1 text-center">
                <div className="p-2 bg-slate-900/90 rounded-lg border border-slate-800">
                  <span className="text-[9px] font-mono text-slate-400 block">Weekly Return</span>
                  <span className="text-xs font-mono font-extrabold text-white">{activeUseCase.hoursSavedPerWeek} hrs / wk</span>
                </div>
                <div className="p-2 bg-slate-900/90 rounded-lg border border-slate-800">
                  <span className="text-[9px] font-mono text-slate-400 block">ROI Multiplier</span>
                  <span className="text-xs font-mono font-extrabold text-emerald-400">{activeUseCase.roiMultiplier}</span>
                </div>
              </div>

              <div className="p-2 bg-slate-900/90 rounded-lg border border-slate-800 text-center">
                <span className="text-[9px] font-mono text-slate-400 block">Annual Value Per Seat</span>
                <span className="text-xs font-mono font-extrabold text-emerald-300">{activeUseCase.expectedRoi}</span>
              </div>
            </div>

          </div>

          {/* NEXT STEP BUTTON IN RIGHT PANEL */}
          <div className="pt-3 border-t border-white/10">
            <button
              onClick={onContinue}
              className="w-full py-2.5 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-slate-950 font-extrabold text-xs rounded-xl shadow-lg shadow-sky-950/50 flex items-center justify-center space-x-2 transition-all cursor-pointer"
            >
              <span>Evaluate Security Simulation</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

        </aside>

      </div>
    </div>
  );
};
