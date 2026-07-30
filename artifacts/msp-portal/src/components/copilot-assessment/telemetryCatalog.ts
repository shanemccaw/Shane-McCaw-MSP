export interface GraphApiStep {
  id: string;
  title: string;
  subtitle: string;
  details: string;
  sseMessages: string[];
}

export interface TelemetryEngineDef {
  id: string;
  name: string;
  description: string;
  severity: 'None' | 'Low' | 'Medium' | 'High';
  findingCount: number;
  findingLabel: string;
  sseMessages: string[];
  icon: string;
}

export interface TelemetryDocDef {
  id: string;
  name: string;
  description: string;
  estReadTime: string;
  sseMessages: string[];
  microInsight: string;
}

export const GRAPH_API_STEPS: GraphApiStep[] = [
  {
    id: 'graph-conn',
    title: 'Connecting to Microsoft 365',
    subtitle: 'Establishing secure OAuth2 / MSAL session',
    details: 'Connecting to https://graph.microsoft.com/v1.0 with certificate auth...',
    sseMessages: [
      'Authenticating tenant admin credentials...',
      'Validating SSL certificates and TLS 1.3 session...',
      'Graph API Endpoint reachable (200 OK).'
    ]
  },
  {
    id: 'graph-perm',
    title: 'Validating Permissions',
    subtitle: 'Checking Directory.Read.All & Reports.Read.All',
    details: 'Verifying API scopes required for tenant-wide telemetry aggregation...',
    sseMessages: [
      'Checking scope: Directory.Read.All... Verified',
      'Checking scope: Reports.Read.All... Verified',
      'Checking scope: SecurityEvents.Read.All... Verified',
      'Permissions check completed successfully.'
    ]
  },
  {
    id: 'graph-profile',
    title: 'Retrieving Tenant Profile',
    subtitle: 'Extracting tenant ID, domain metadata & license topology',
    details: 'Querying /v1.0/organization and /v1.0/subscribedSkus...',
    sseMessages: [
      'Tenant ID: 0a1ef2c3-b00c-4692-9163-2e88dbe88d84 verified.',
      'Active SKUs: M365 E5 (4,500 seats), Copilot for M365 (1,200 seats).',
      'Primary domain verified: corp.enterprise.com.'
    ]
  },
  {
    id: 'graph-pull',
    title: 'Pulling Telemetry Stream',
    subtitle: 'Aggregating SharePoint ACLs, MIP labels & audit stream',
    details: 'Initiating parallel REST streams across Graph Security & Purview endpoints...',
    sseMessages: [
      'Pulling SharePoint site collection ACLs...',
      'Pulling Microsoft Purview MIP label catalog...',
      'Streaming audit logs for 12 correlation engines...'
    ]
  }
];

export const TELEMETRY_ENGINES: TelemetryEngineDef[] = [
  {
    id: 'signals-engine',
    name: 'Signals Engine',
    description: 'Scans Graph activity logs, user events, and interaction frequency.',
    severity: 'Low',
    findingCount: 4200000,
    findingLabel: '4.2M Activity Events',
    sseMessages: [
      'Correlating user activity logs across M365 apps...',
      'Analyzing activity spikes in SharePoint & Teams...',
      '4.2M telemetry events aggregated.'
    ],
    icon: 'Activity'
  },
  {
    id: 'drift-engine',
    name: 'Drift Engine',
    description: 'Monitors permission and policy drift across sites and teams.',
    severity: 'Medium',
    findingCount: 7,
    findingLabel: '7 Libraries Drifting',
    sseMessages: [
      'Evaluating permission inheritance drift...',
      'Found 7 SharePoint document libraries with broken inheritance.',
      'Drift vulnerability score calculated.'
    ],
    icon: 'Sliders'
  },
  {
    id: 'health-engine',
    name: 'Health Engine',
    description: 'Checks M365 tenant service health and Copilot API endpoint latency.',
    severity: 'None',
    findingCount: 0,
    findingLabel: '99.9% Service Health',
    sseMessages: [
      'Checking M365 Copilot endpoint latency (28ms)...',
      'Exchange & SharePoint REST status healthy.',
      'Tenant service health verified.'
    ],
    icon: 'Server'
  },
  {
    id: 'priority-engine',
    name: 'Priority Engine',
    description: 'Ranks tenant security & governance remediation tasks by urgency.',
    severity: 'High',
    findingCount: 3,
    findingLabel: '3 Critical Priorities',
    sseMessages: [
      'Ranking remediation urgency matrix...',
      'Priority 1: Unlabeled sensitive files.',
      'Priority 2: Overshared SharePoint sites.'
    ],
    icon: 'Zap'
  },
  {
    id: 'copilot-readiness',
    name: 'Copilot Readiness Engine',
    description: 'Assesses license allocation state and M365 app integration status.',
    severity: 'Medium',
    findingCount: 120,
    findingLabel: '120 Unassigned Licenses',
    sseMessages: [
      'Evaluating Copilot for M365 license assignment...',
      'Found 120 unassigned Copilot licenses.',
      'App readiness index: 82/100.'
    ],
    icon: 'Sparkles'
  },
  {
    id: 'oversharing-engine',
    name: 'Oversharing Engine',
    description: 'Analyzes SharePoint ACLs, anonymous links, and broad organization permissions.',
    severity: 'High',
    findingCount: 14,
    findingLabel: '14 Overshared Sites',
    sseMessages: [
      'Scanning ACLs for "Everyone except external" & public links...',
      'Identified 14 SharePoint sites with unrestricted internal access.',
      'Exposure vector generated.'
    ],
    icon: 'Users'
  },
  {
    id: 'sensitivity-label',
    name: 'Sensitivity Label Engine',
    description: 'Evaluates Microsoft Purview MIP label coverage across documents.',
    severity: 'High',
    findingCount: 62,
    findingLabel: '62% Unlabeled Files',
    sseMessages: [
      'Analyzing MIP sensitivity label taxonomy...',
      '62% of tenant files lack sensitivity labels.',
      'PII exposure risk calculated.'
    ],
    icon: 'ShieldAlert'
  },
  {
    id: 'dlp-conflict',
    name: 'DLP Conflict Engine',
    description: 'Identifies Data Loss Prevention rules that block Copilot agent workflows.',
    severity: 'Medium',
    findingCount: 4,
    findingLabel: '4 Rule Conflicts',
    sseMessages: [
      'Evaluating Data Loss Prevention rules vs Copilot agents...',
      'Found 4 DLP rules blocking Copilot cross-document synthesis.',
      'Conflict report generated.'
    ],
    icon: 'Lock'
  },
  {
    id: 'conditional-access',
    name: 'Conditional Access Engine',
    description: 'Checks MFA enforcement, CA01 policy status, and compliant device rules.',
    severity: 'High',
    findingCount: 1,
    findingLabel: 'CA01 Disabled',
    sseMessages: [
      'Checking Conditional Access policy state...',
      'CA01 baseline security policy is currently DISABLED.',
      'High governance vulnerability flagged.'
    ],
    icon: 'Key'
  },
  {
    id: 'pim-engine',
    name: 'PIM Engine',
    description: 'Evaluates Privileged Identity Management and permanent admin roles.',
    severity: 'Medium',
    findingCount: 12,
    findingLabel: '12 Permanent Admins',
    sseMessages: [
      'Checking Entra ID admin role assignments...',
      'Found 12 users with permanent Global Admin rights (no PIM).',
      'Identity risk vector created.'
    ],
    icon: 'Shield'
  },
  {
    id: 'permission-sprawl',
    name: 'Permission Sprawl Engine',
    description: 'Scans nested group memberships and legacy inherited permissions.',
    severity: 'High',
    findingCount: 28,
    findingLabel: '28 Sprawl Groups',
    sseMessages: [
      'Scanning nested M365 Group memberships...',
      'Found 28 groups with circular/deep nesting sprawl.',
      'Permission depth graph generated.'
    ],
    icon: 'Database'
  },
  {
    id: 'data-exposure',
    name: 'Data Exposure Engine',
    description: 'Identifies high-risk PII, PHI, and financial data in unprotected stores.',
    severity: 'High',
    findingCount: 3420,
    findingLabel: '3,420 Exposed Records',
    sseMessages: [
      'Scanning unstructured stores for PII, PHI, and financial markers...',
      'Found 3,420 sensitive records in public SharePoint libraries.',
      'Data breach potential score calculated.'
    ],
    icon: 'FileCode'
  }
];

export const TELEMETRY_DOCS: TelemetryDocDef[] = [
  {
    id: 'gov-plan',
    name: 'Governance Plan',
    description: 'CA01 enforcement, sensitivity taxonomy, and DLP remediation framework.',
    estReadTime: '8 min read',
    sseMessages: [
      'Starting Governance Plan compilation...',
      'Embedding CA01 enablement timeline...',
      'Finalizing MIP label auto-labeling rules...'
    ],
    microInsight: 'Governance Plan: CA01 disabled increases governance risk.'
  },
  {
    id: 'persona-guide',
    name: 'Persona Guide',
    description: 'Tailored prompt guides, safety boundaries, and persona rollout schedules.',
    estReadTime: '12 min read',
    sseMessages: [
      'Calculating persona exposure vectors...',
      'Building prompt library for Engineer & Doctor personas...',
      'Persona rollout matrix assembled.'
    ],
    microInsight: 'Persona Guide: Engineer persona has high exposure due to missing labels.'
  },
  {
    id: 'use-case-guide',
    name: 'Use Case Guide',
    description: 'High-impact M365 Copilot workflow mappings and feasibility scores.',
    estReadTime: '10 min read',
    sseMessages: [
      'Mapping M365 Copilot use cases to department workflows...',
      'Evaluating feasibility vs oversharing blockers...',
      'Use Case implementation matrix complete.'
    ],
    microInsight: 'Use Case Guide: Research summarization feasible once labels are configured.'
  },
  {
    id: 'security-report',
    name: 'Security & Compliance Report',
    description: 'Comprehensive risk audit, 62% unlabeled files report, and remediation log.',
    estReadTime: '15 min read',
    sseMessages: [
      'Compiling Purview label coverage logs...',
      'Formatting 14 overshared sites remediation checklist...',
      'Security audit package finalized.'
    ],
    microInsight: 'Security Report: 62% of files unlabeled across 14 overshared libraries.'
  },
  {
    id: 'roi-model',
    name: 'ROI Model',
    description: 'Financial value projections, hours saved per employee, and ROI payback graph.',
    estReadTime: '6 min read',
    sseMessages: [
      'Calculating productivity multiplier across 1,200 seats...',
      'Factoring in remediation time lag cost...',
      'ROI financial model rendered.'
    ],
    microInsight: 'ROI Model: Value potential moderate with 2.4x payback in 6 months.'
  },
  {
    id: 'deployment-roadmap',
    name: 'Deployment Roadmap',
    description: 'Phased 90-day execution plan for governance fix, pilot, and enterprise scale.',
    estReadTime: '7 min read',
    sseMessages: [
      'Drafting Phase 1 (Days 1-30) Security Baseline...',
      'Drafting Phase 2 (Days 31-60) Pilot Expansion...',
      'Roadmap Gantt schedule generated.'
    ],
    microInsight: 'Deployment Roadmap: 90-day phased rollout minimizes risk.'
  }
];

import { ADAPTIVE_DATA_SENSITIVITY, ADAPTIVE_COLLABORATION } from './quizCatalog';

export interface TelemetryMismatch {
  id: string;
  title: string;
  quizText: string;
  telemetryText: string;
  severity: 'high' | 'medium' | 'sky';
}

export function generateDynamicHintCards(
  answers: Record<string, string>,
  phase: 'phase1' | 'phase2' | 'phase3',
  completedEnginesCount: number
): string[] {
  const hints: string[] = [];

  const ind = answers['industry'] || 'space';
  const sensIds = answers['sensitivity'] ? answers['sensitivity'].split(',').filter(Boolean) : [];
  const collabIds = answers['collaboration'] ? answers['collaboration'].split(',').filter(Boolean) : [];
  const speed = answers['adoption-speed'] || '';
  const outcome = answers['outcomes'] || '';

  const sensCatalog = ADAPTIVE_DATA_SENSITIVITY[ind] || ADAPTIVE_DATA_SENSITIVITY['default'] || [];
  const collabCatalog = ADAPTIVE_COLLABORATION[ind] || ADAPTIVE_COLLABORATION['default'] || [];

  const sensTitles = sensIds.map(id => sensCatalog.find(o => o.id === id)?.title.split('/')[0].trim() || id);
  const collabTitles = collabIds.map(id => collabCatalog.find(o => o.id === id)?.title.split('/')[0].trim() || id);

  // 1. Sensitivity set insight
  if (sensTitles.length > 0) {
    hints.push(`${sensTitles.join(' + ')} selected. Telemetry shows 62% unlabeled.`);
  } else {
    hints.push('PHI + HIPAA selected. Telemetry shows 62% unlabeled.');
  }

  // 2. Collaboration set insight
  if (collabTitles.length > 0) {
    hints.push(`${collabTitles.join(' + ')} collaboration. Telemetry shows 14 overshared sites.`);
  } else {
    hints.push('Cross-agency + Multi-facility collaboration. Telemetry shows 14 overshared sites.');
  }

  // 3. Persona specific insight
  hints.push('Engineer persona: 44% of engineering files missing labels.');

  // 4. Use case specific insight
  hints.push('Technical writing use case blocked by missing sensitivity labels.');

  // 5. Risk / Security priority insight
  hints.push('Mission safety priority. CA01 disabled increases risk.');

  // 6. Permission Sprawl insight
  hints.push('Permission sprawl detected: 1,200+ ACLs.');

  // 7. Additional Quiz & Telemetry correlations
  if (speed === 'early_adopter' || speed === 'fast_follower') {
    hints.push('High adoption speed selected. Telemetry shows 120 unassigned Copilot licenses.');
  }

  if (outcome.includes('research') || outcome.includes('efficiency')) {
    hints.push('Research acceleration priority. Telemetry shows governance gaps in 7 libraries.');
  }

  // 8. Dynamic Document / SSE generation items
  if (phase === 'phase3' || completedEnginesCount >= 10) {
    hints.push('Reticulating Splines… Synthesizing Security Report & Governance Plan...');
  }

  return hints;
}

export function generateTop3Mismatches(
  answers: Record<string, string>
): TelemetryMismatch[] {
  const ind = answers['industry'] || 'space';
  const sensIds = answers['sensitivity'] ? answers['sensitivity'].split(',').filter(Boolean) : [];
  const collabIds = answers['collaboration'] ? answers['collaboration'].split(',').filter(Boolean) : [];
  const speed = answers['adoption-speed'] || '';

  const sensCatalog = ADAPTIVE_DATA_SENSITIVITY[ind] || ADAPTIVE_DATA_SENSITIVITY['default'] || [];
  const collabCatalog = ADAPTIVE_COLLABORATION[ind] || ADAPTIVE_COLLABORATION['default'] || [];

  const sensTitles = sensIds.map(id => sensCatalog.find(o => o.id === id)?.title.split('/')[0].trim() || id);
  const collabTitles = collabIds.map(id => collabCatalog.find(o => o.id === id)?.title.split('/')[0].trim() || id);

  const mismatches: TelemetryMismatch[] = [];

  // 1. Sensitivity Mismatch
  if (sensTitles.length > 0) {
    mismatches.push({
      id: 'sens_mismatch',
      title: '1. Sensitivity Exposure',
      quizText: `Selected sensitivity: ${sensTitles.join(' + ')}`,
      telemetryText: 'Telemetry: Unlabeled files (62%) + high exposure detected.',
      severity: 'high'
    });
  } else {
    mismatches.push({
      id: 'sens_mismatch',
      title: '1. Sensitivity Exposure',
      quizText: 'Self-rated low or unselected sensitivity',
      telemetryText: 'Telemetry: 3,420 sensitive records in public libraries & 62% missing MIP labels.',
      severity: 'high'
    });
  }

  // 2. Collaboration Mismatch
  if (collabTitles.length > 0) {
    mismatches.push({
      id: 'collab_mismatch',
      title: '2. Oversharing Drift',
      quizText: `Selected collaboration: ${collabTitles.join(' + ')}`,
      telemetryText: 'Telemetry: Oversharing detected across 14 SharePoint sites.',
      severity: 'medium'
    });
  } else {
    mismatches.push({
      id: 'collab_mismatch',
      title: '2. Oversharing Drift',
      quizText: 'Self-assessed restricted/internal collaboration',
      telemetryText: 'Telemetry: 14 sites found with "Everyone except external" broad access.',
      severity: 'medium'
    });
  }

  // 3. Conditional Access / Adoption Mismatch
  if (speed === 'early_adopter' || speed === 'fast_follower') {
    mismatches.push({
      id: 'speed_mismatch',
      title: '3. Readiness vs Adoption Gap',
      quizText: 'Selected fast adoption speed',
      telemetryText: 'Telemetry: 120 unassigned Copilot licenses & CA01 policy disabled.',
      severity: 'sky'
    });
  } else {
    mismatches.push({
      id: 'ca_mismatch',
      title: '3. Conditional Access Gap',
      quizText: 'Self-assumed baseline security posture',
      telemetryText: 'Telemetry: CA01 policy disabled, exposing tenant to MFA bypass.',
      severity: 'sky'
    });
  }

  return mismatches.slice(0, 3);
}
