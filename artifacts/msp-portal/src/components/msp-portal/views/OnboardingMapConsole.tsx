// @ts-nocheck
import React, { useState, useMemo, useRef } from 'react';
import {
  GitBranch,
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  Building2,
  KeyRound,
  ShieldCheck,
  Layers,
  ShieldAlert,
  Lock,
  Zap,
  Search,
  Filter,
  RefreshCw,
  FileText,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  Terminal,
  AlertTriangle,
  Eye,
  ArrowRight,
  Check,
  X,
  ChevronDown,
  Activity,
  RotateCcw,
  ExternalLink,
  Award,
  Globe,
  Info,
  Copy,
  Cpu,
  BarChart3,
  Bot,
  Compass,
  LayoutGrid,
  List,
  ArrowDown,
  Sliders,
  SlidersHorizontal,
  CheckSquare,
  Shield
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tenant } from '../types';

// ==========================================
// TYPES & INTERFACES
// ==========================================

export type OnboardingStageStatus = 'completed' | 'in_progress' | 'blocked' | 'pending';

export interface OnboardingSubItem {
  id: string;
  name: string;
  passed: boolean;
  notes?: string;
}

export interface OnboardingStage {
  id: string;
  stageNumber: number; // 1 to 8
  title: string;
  subtitle: string;
  description: string;
  status: OnboardingStageStatus;
  startedAt: string | null;
  completedAt: string | null;
  duration: string | null;
  assignedTech: string;
  graphEndpoint: string;
  subItems: OnboardingSubItem[];
  apiPayloadJson: Record<string, any>;
  apiLogs: string[];
  metricsSummary: string;
  recommendedActions: string[];
}

export interface PillarBreakout {
  id: string;
  name: string;
  category: 'Security' | 'Governance' | 'Compliance' | 'Adoption' | 'Copilot Readiness' | 'Architecture' | 'Licensing';
  status: OnboardingStageStatus;
  score: number; // 0-100
  itemsScanned: number;
  criticalGaps: number;
  description: string;
  accentColor: string;
  subItems: OnboardingSubItem[];
}

export interface TenantOnboardingWorkflow {
  tenantId: string;
  tenantName: string;
  primaryDomain: string;
  licenseTier: string;
  overallProgressPercent: number;
  currentStageNumber: number;
  status: 'Active Onboarding' | 'Blocked' | 'Tenant Live' | 'Pending Consent';
  initiatedBy: string;
  initiatedAt: string;
  targetGoLiveDate: string;
  stages: OnboardingStage[];
  pillars: PillarBreakout[];
}

interface OnboardingMapConsoleProps {
  tenants?: Tenant[];
  selectedTenantId?: string;
  onShowToast?: (type: 'success' | 'info' | 'warning' | 'error', title: string, description: string) => void;
  onExecuteOnboardingStep?: (tenantId: string, stepId: string) => void;
}

// ==========================================
// INITIAL WORKFLOW TEMPLATES DATA
// ==========================================

const INITIAL_PILLARS_TEMPLATE: PillarBreakout[] = [
  {
    id: 'pil-sec',
    name: 'Security Pillar',
    category: 'Security',
    status: 'completed',
    score: 92,
    itemsScanned: 48,
    criticalGaps: 0,
    description: 'Entra ID Conditional Access, Defender XDR, Identity Protection & MFA Enforcement',
    accentColor: '#0078D4', // M365 Blue
    subItems: [
      { id: 'sec-1', name: 'MFA Enforcement (FIDO2 & Authenticator)', passed: true },
      { id: 'sec-2', name: 'Conditional Access Baseline Policies', passed: true },
      { id: 'sec-3', name: 'Defender for Endpoint EDR Deployment', passed: true },
      { id: 'sec-4', name: 'AitM Token Theft Protections', passed: true },
    ],
  },
  {
    id: 'pil-gov',
    name: 'Governance Pillar',
    category: 'Governance',
    status: 'completed',
    score: 88,
    itemsScanned: 32,
    criticalGaps: 0,
    description: 'Privileged Identity Management (PIM), Lifecycle Workflows, Access Reviews',
    accentColor: '#6264A7', // Teams Purple
    subItems: [
      { id: 'gov-1', name: 'PIM Admin Just-In-Time Roles', passed: true },
      { id: 'gov-2', name: 'Quarterly Access Reviews Triggered', passed: true },
      { id: 'gov-3', name: 'Tenant Change Control Baseline Lock', passed: true },
    ],
  },
  {
    id: 'pil-cmp',
    name: 'Compliance Pillar',
    category: 'Compliance',
    status: 'in_progress',
    score: 76,
    itemsScanned: 29,
    criticalGaps: 1,
    description: 'Purview Data Loss Prevention (DLP), Information Barriers & Retention Labels',
    accentColor: '#107C41', // Excel Green
    subItems: [
      { id: 'cmp-1', name: 'Sensitive Data Discovery Scan', passed: true },
      { id: 'cmp-2', name: 'Purview DLP Auto-labeling Policies', passed: true },
      { id: 'cmp-3', name: 'FINRA / HIPAA Compliance Rule Binding', passed: false, notes: 'Awaiting CISO verification' },
    ],
  },
  {
    id: 'pil-ado',
    name: 'Adoption Pillar',
    category: 'Adoption',
    status: 'completed',
    score: 85,
    itemsScanned: 24,
    criticalGaps: 0,
    description: 'Teams Telemetry, OneDrive Sync Health, Exchange Online Active Usage',
    accentColor: '#008272', // Teal
    subItems: [
      { id: 'ado-1', name: 'Active User Telemetry Ingestion', passed: true },
      { id: 'ado-2', name: 'Exchange & OneDrive Migration Verification', passed: true },
      { id: 'ado-3', name: 'M365 Apps Deployment Audit', passed: true },
    ],
  },
  {
    id: 'pil-cop',
    name: 'Copilot Readiness Pillar',
    category: 'Copilot Readiness',
    status: 'in_progress',
    score: 81,
    itemsScanned: 36,
    criticalGaps: 1,
    description: 'Over-sharing Risk Scans, Semantic Index Permissions, Copilot License Mapping',
    accentColor: '#00B7C3', // Cyan
    subItems: [
      { id: 'cop-1', name: 'SharePoint Link Over-sharing Scan', passed: true },
      { id: 'cop-2', name: 'Restricted SharePoint Search Enabled', passed: true },
      { id: 'cop-3', name: 'Copilot Studio Agent Governance', passed: false, notes: 'Reviewing guest permissions' },
    ],
  },
  {
    id: 'pil-arc',
    name: 'Architecture Pillar',
    category: 'Architecture',
    status: 'completed',
    score: 94,
    itemsScanned: 41,
    criticalGaps: 0,
    description: 'Entra Connect Sync, Hybrid Exchange Routing, DNS/MX Records & SPF/DKIM/DMARC',
    accentColor: '#744DA9', // Deep Purple
    subItems: [
      { id: 'arc-1', name: 'SPF / DKIM / DMARC Strict Enforcement', passed: true },
      { id: 'arc-2', name: 'Hybrid Identity Sync Health Check', passed: true },
      { id: 'arc-3', name: 'Tenant-to-Tenant Migration Routing', passed: true },
    ],
  },
  {
    id: 'pil-lic',
    name: 'Licensing Pillar',
    category: 'Licensing',
    status: 'completed',
    score: 98,
    itemsScanned: 18,
    criticalGaps: 0,
    description: 'License Optimization, Inactive User Cleanups, E5 / Defender SKU Allocation',
    accentColor: '#D13438', // M365 Red/Coral
    subItems: [
      { id: 'lic-1', name: 'Unassigned License Waste Audit', passed: true },
      { id: 'lic-2', name: 'Group-based License Automation', passed: true },
      { id: 'lic-3', name: 'Defender & Copilot Add-on SKU Allocation', passed: true },
    ],
  },
];

const INITIAL_WORKFLOWS: TenantOnboardingWorkflow[] = [
  {
    tenantId: 't-contoso-01',
    tenantName: 'Contoso Corp',
    primaryDomain: 'contoso.com',
    licenseTier: 'M365 E5 Premium + Defender',
    overallProgressPercent: 75,
    currentStageNumber: 6,
    status: 'Active Onboarding',
    initiatedBy: 'Shane McCaw (Lead Architect)',
    initiatedAt: '2026-07-20 09:00:00',
    targetGoLiveDate: '2026-07-26',
    pillars: INITIAL_PILLARS_TEMPLATE,
    stages: [
      {
        id: 'stg-1',
        stageNumber: 1,
        title: 'Customer Initialization',
        subtitle: 'Tenant Metadata & SLA Binding',
        description: 'Initialize tenant master record, register primary M365 domain, bind partner CSP ID, and designate emergency contacts.',
        status: 'completed',
        startedAt: '2026-07-20 09:00:00',
        completedAt: '2026-07-20 09:12:15',
        duration: '12m 15s',
        assignedTech: 'Shane McCaw',
        graphEndpoint: 'POST /v1.0/organization/contoso.com',
        subItems: [
          { id: 's1-1', name: 'Customer Created', passed: true },
          { id: 's1-2', name: 'Tenant metadata captured', passed: true },
          { id: 's1-3', name: 'SLA package selected', passed: true },
        ],
        apiPayloadJson: {
          tenantId: 't-contoso-01',
          primaryDomain: 'contoso.com',
          partnerCspId: 'CSP-98812-US',
          slaTier: 'Platinum 15m MTTR',
          provisioningStatus: 'Active',
        },
        apiLogs: [
          '09:00:02 [INFO] Initializing tenant record for contoso.com',
          '09:05:10 [SUCCESS] DNS TXT verification passed: MS=ms98129384',
          '09:12:15 [SUCCESS] Customer record & SLA Platinum tier bound successfully',
        ],
        metricsSummary: 'Domain Verified | Platinum SLA Bound',
        recommendedActions: ['Proceed to M365 Admin Consent'],
      },
      {
        id: 'stg-2',
        stageNumber: 2,
        title: 'M365 Consent & Access',
        subtitle: 'GDAP Relationship & OAuth Identity',
        description: 'Grant Granular Delegated Admin Privileges (GDAP), validate Microsoft Graph API scopes, and provision automation identities.',
        status: 'completed',
        startedAt: '2026-07-20 09:15:00',
        completedAt: '2026-07-20 09:45:00',
        duration: '30m 00s',
        assignedTech: 'Alex Rivera (SOC Tech)',
        graphEndpoint: 'GET /v1.0/delegatedAdminRelationships',
        subItems: [
          { id: 's2-1', name: 'Admin Consent granted', passed: true },
          { id: 's2-2', name: 'Graph permissions validated', passed: true },
          { id: 's2-3', name: 'Automation identity provisioned', passed: true },
        ],
        apiPayloadJson: {
          relationshipId: 'gdap-rel-88192-contoso',
          accessAssignmentStatus: 'Active',
          grantedScopes: ['Directory.ReadWrite.All', 'SecurityEvents.ReadWrite.All', 'AuditLog.Read.All'],
        },
        apiLogs: [
          '09:15:00 [INFO] Dispatched GDAP Admin Consent link to admin@contoso.com',
          '09:40:22 [SUCCESS] Global Admin granted consent for 18 Graph API permissions',
          '09:45:00 [SUCCESS] Automation Enterprise App Service Principal initialized',
        ],
        metricsSummary: 'GDAP Active | 18 Scopes Authorized',
        recommendedActions: ['Apply SLA & Governance Operational Templates'],
      },
      {
        id: 'stg-3',
        stageNumber: 3,
        title: 'Apply SLA & Governance Templates',
        subtitle: 'Operational Rules & Tracking Engine',
        description: 'Enforce operational frameworks: apply SLA response templates, activate change control tracking, and bind Alerts, DLQ, and Workflow tracking daemons.',
        status: 'completed',
        startedAt: '2026-07-21 08:00:00',
        completedAt: '2026-07-21 08:10:00',
        duration: '10m 00s',
        assignedTech: 'Shane McCaw',
        graphEndpoint: 'POST /api/msp/sla/bindTenant',
        subItems: [
          { id: 's3-1', name: 'Apply SLA Templates', passed: true },
          { id: 's3-2', name: 'Enable Change Control', passed: true },
          { id: 's3-3', name: 'Enable Alerts, DLQ, Workflow Tracking', passed: true },
        ],
        apiPayloadJson: {
          slaTier: 'Platinum',
          mttrMinutes: 15,
          changeControlMode: 'Enforced',
          dlqAutoRetry: true,
        },
        apiLogs: [
          '08:00:01 [INFO] Applying Platinum SLA Operational Policy',
          '08:04:12 [SUCCESS] Enabled 5-min Change Control polling & DLQ error listener',
          '08:10:00 [SUCCESS] Workflow telemetry tracking active',
        ],
        metricsSummary: 'Platinum SLA | Change Control Active',
        recommendedActions: ['Launch Baseline Discovery Scan'],
      },
      {
        id: 'stg-4',
        stageNumber: 4,
        title: 'First Scan',
        subtitle: 'Baseline Discovery Across 7 Domains',
        description: 'Execute initial comprehensive automated discovery scan across identity, security, compliance, licensing, adoption, Copilot readiness, and architecture.',
        status: 'completed',
        startedAt: '2026-07-21 08:15:00',
        completedAt: '2026-07-21 08:32:00',
        duration: '17m 00s',
        assignedTech: 'Automated Scan Daemon',
        graphEndpoint: 'GET /v1.0/security/secureScores & /identity/conditionalAccess/policies',
        subItems: [
          { id: 's4-1', name: 'Identity scan', passed: true },
          { id: 's4-2', name: 'Security scan', passed: true },
          { id: 's4-3', name: 'Compliance scan', passed: true },
          { id: 's4-4', name: 'Licensing scan', passed: true },
          { id: 's4-5', name: 'Adoption scan', passed: true },
          { id: 's4-6', name: 'Copilot readiness scan', passed: true },
          { id: 's4-7', name: 'Architecture scan', passed: true },
        ],
        apiPayloadJson: {
          totalEndpointsScanned: 134,
          secureScore: 742,
          maxScore: 850,
          detectedGaps: 14,
        },
        apiLogs: [
          '08:15:01 [INFO] Commencing parallel discovery scan across 7 tenant domains',
          '08:25:00 [INFO] Identity, Security, & Copilot readiness endpoints ingested',
          '08:32:00 [SUCCESS] First scan complete. Raw secure score: 742 / 850',
        ],
        metricsSummary: '134 Endpoints Scanned | 14 Gaps Scanned',
        recommendedActions: ['Trigger Pillar Processing Breakouts'],
      },
      {
        id: 'stg-5',
        stageNumber: 5,
        title: 'Pillar Processing',
        subtitle: '7 Domain Breakout Engine',
        description: 'Dispatch parallel analysis routines into 7 specialized pillar engines: Security, Governance, Compliance, Adoption, Copilot Readiness, Architecture, and Licensing.',
        status: 'completed',
        startedAt: '2026-07-21 09:00:00',
        completedAt: '2026-07-21 09:25:00',
        duration: '25m 00s',
        assignedTech: 'Parallel Analysis Cluster',
        graphEndpoint: 'POST /api/msp/pillars/evaluate',
        subItems: [
          { id: 's5-1', name: 'Security Pillar', passed: true },
          { id: 's5-2', name: 'Governance Pillar', passed: true },
          { id: 's5-3', name: 'Compliance Pillar', passed: true },
          { id: 's5-4', name: 'Adoption Pillar', passed: true },
          { id: 's5-5', name: 'Copilot Readiness Pillar', passed: true },
          { id: 's5-6', name: 'Architecture Pillar', passed: true },
          { id: 's5-7', name: 'Licensing Pillar', passed: true },
        ],
        apiPayloadJson: {
          pillarsProcessed: 7,
          avgPillarScore: 87.5,
          topPerformingPillar: 'Licensing (98%)',
          laggingPillar: 'Compliance (76%)',
        },
        apiLogs: [
          '09:00:00 [INFO] Dispatched 7 pillar evaluation engines simultaneously',
          '09:12:30 [SUCCESS] Security (92%), Governance (88%), & Architecture (94%) evaluations calculated',
          '09:25:00 [SUCCESS] All 7 breakouts processed. Overall score index generated.',
        ],
        metricsSummary: '7/7 Pillars Processed | Avg Score: 87.5%',
        recommendedActions: ['Consolidate Score & Review Risk Acceptance'],
      },
      {
        id: 'stg-6',
        stageNumber: 6,
        title: 'Score Consolidation & Risk Acceptance',
        subtitle: 'Tenant Intelligence Score & CISO Sign-off',
        description: 'Normalize scores across all 7 pillars to compute the overall Tenant Intelligence Score, highlight critical risk items, and request CISO risk acceptance.',
        status: 'in_progress',
        startedAt: '2026-07-22 10:00:00',
        completedAt: null,
        duration: 'In Progress (Awaiting Sign-off)',
        assignedTech: 'Adele Vance (Contoso CISO) & Shane McCaw',
        graphEndpoint: 'POST /api/msp/risk/decisionAcceptance',
        subItems: [
          { id: 's6-1', name: 'Normalize pillar scores', passed: true },
          { id: 's6-2', name: 'Generate Tenant Intelligence Score', passed: true },
          { id: 's6-3', name: 'Identify risks requiring acceptance or remediation', passed: false, notes: 'Awaiting CISO approval for legacy auth exception' },
        ],
        apiPayloadJson: {
          tenantIntelligenceScore: 87.2,
          normalizedRating: 'A-',
          pendingRiskAcceptances: 1,
          cisoApprovalRequired: true,
        },
        apiLogs: [
          '10:00:00 [INFO] Normalized 7 pillar vector weights into Tenant Intelligence Score: 87.2',
          '10:15:30 [WARNING] Identified 1 high-risk item: Legacy Auth enablement on Service Accounts',
          '10:30:00 [INFO] Sent Risk Acceptance Form #RBD-2026-881 to adele.vance@contoso.com',
        ],
        metricsSummary: 'Tenant Score: 87.2 (A-) | 1 Risk Pending',
        recommendedActions: ['Review CISO Sign-off or Trigger Remediation Override'],
      },
      {
        id: 'stg-7',
        stageNumber: 7,
        title: 'Automated Remediation & Change Requests',
        subtitle: 'Auto-Heal & Operator Dispatch',
        description: 'Execute approved automated remediations, spawn Operator Tasks for manual items, and submit Change Requests to Change Advisory Board.',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        duration: null,
        assignedTech: 'Shane McCaw',
        graphEndpoint: 'POST /api/msp/remediation/dispatch',
        subItems: [
          { id: 's7-1', name: 'Auto-remediations triggered', passed: false },
          { id: 's7-2', name: 'Operator Tasks generated', passed: false },
          { id: 's7-3', name: 'Change Requests submitted', passed: false },
        ],
        apiPayloadJson: {
          remediationEngineStatus: 'Armed (Pending Stage 6 Sign-off)',
          pendingChangeRequests: 2,
        },
        apiLogs: [
          '[PENDING] Waiting for Stage 6 (Risk Acceptance) sign-off before triggering auto-remediations.',
        ],
        metricsSummary: 'Armed & Ready',
        recommendedActions: ['Complete Stage 6 to unleash auto-remediation engine'],
      },
      {
        id: 'stg-8',
        stageNumber: 8,
        title: 'Tenant Goes Live',
        subtitle: 'Go-Live Activation & Continuous Scans',
        description: 'Activate customer Tenant Portal, populate Heatmap, Map, and Timeline dashboards, go live with SLA monitoring, and schedule continuous 5m scans.',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        duration: null,
        assignedTech: 'Shane McCaw',
        graphEndpoint: 'POST /api/msp/tenant/activateGoLive',
        subItems: [
          { id: 's8-1', name: 'Tenant Portal activated', passed: false },
          { id: 's8-2', name: 'Heatmap, Map, Timeline populated', passed: false },
          { id: 's8-3', name: 'SLA Dashboard live', passed: false },
          { id: 's8-4', name: 'Ongoing scans scheduled', passed: false },
        ],
        apiPayloadJson: {
          goLiveStatus: 'Staging',
          continuousScanningInterval: '5 minutes',
        },
        apiLogs: [
          '[PENDING] Awaiting completion of Stage 7 to trigger final Go-Live sequence.',
        ],
        metricsSummary: 'Pending Go-Live Activation',
        recommendedActions: ['Complete Stage 7 to activate tenant live monitoring'],
      },
    ],
  },
  {
    tenantId: 't-fabrikam-02',
    tenantName: 'Fabrikam Inc',
    primaryDomain: 'fabrikam.com',
    licenseTier: 'M365 E3 + Defender EDR',
    overallProgressPercent: 100,
    currentStageNumber: 8,
    status: 'Tenant Live',
    initiatedBy: 'Alex Rivera (SOC Tech)',
    initiatedAt: '2026-07-15 10:00:00',
    targetGoLiveDate: '2026-07-22',
    pillars: INITIAL_PILLARS_TEMPLATE.map((p) => ({ ...p, status: 'completed' as const, score: 95 })),
    stages: [
      {
        id: 'f-stg-1',
        stageNumber: 1,
        title: 'Customer Initialization',
        subtitle: 'Tenant Metadata & SLA Binding',
        description: 'Initialize tenant master record, register domain, bind CSP ID.',
        status: 'completed',
        startedAt: '2026-07-15 10:00:00',
        completedAt: '2026-07-15 10:08:00',
        duration: '8m 00s',
        assignedTech: 'Alex Rivera',
        graphEndpoint: 'POST /v1.0/organization/fabrikam.com',
        subItems: [
          { id: 'fs1-1', name: 'Customer Created', passed: true },
          { id: 'fs1-2', name: 'Tenant metadata captured', passed: true },
          { id: 'fs1-3', name: 'SLA package selected', passed: true },
        ],
        apiPayloadJson: { status: 'Active' },
        apiLogs: ['[SUCCESS] Initialized Fabrikam Inc record'],
        metricsSummary: 'Domain Verified',
        recommendedActions: [],
      },
      {
        id: 'f-stg-2',
        stageNumber: 2,
        title: 'M365 Consent & Access',
        subtitle: 'GDAP Relationship & OAuth Identity',
        description: 'Grant GDAP privileges, validate scopes.',
        status: 'completed',
        startedAt: '2026-07-15 10:10:00',
        completedAt: '2026-07-15 10:25:00',
        duration: '15m 00s',
        assignedTech: 'Alex Rivera',
        graphEndpoint: 'GET /v1.0/delegatedAdminRelationships',
        subItems: [
          { id: 'fs2-1', name: 'Admin Consent granted', passed: true },
          { id: 'fs2-2', name: 'Graph permissions validated', passed: true },
          { id: 'fs2-3', name: 'Automation identity provisioned', passed: true },
        ],
        apiPayloadJson: { status: 'GDAP Granted' },
        apiLogs: ['[SUCCESS] GDAP Approved'],
        metricsSummary: 'GDAP Active',
        recommendedActions: [],
      },
      {
        id: 'f-stg-3',
        stageNumber: 3,
        title: 'Apply SLA & Governance Templates',
        subtitle: 'Operational Rules & Tracking Engine',
        description: 'Apply SLA templates and enable monitoring.',
        status: 'completed',
        startedAt: '2026-07-15 10:30:00',
        completedAt: '2026-07-15 10:40:00',
        duration: '10m 00s',
        assignedTech: 'Alex Rivera',
        graphEndpoint: 'POST /api/msp/sla/bindTenant',
        subItems: [
          { id: 'fs3-1', name: 'Apply SLA Templates', passed: true },
          { id: 'fs3-2', name: 'Enable Change Control', passed: true },
          { id: 'fs3-3', name: 'Enable Alerts, DLQ, Workflow Tracking', passed: true },
        ],
        apiPayloadJson: { status: 'SLA Bound' },
        apiLogs: ['[SUCCESS] Templates Applied'],
        metricsSummary: 'Gold SLA Live',
        recommendedActions: [],
      },
      {
        id: 'f-stg-4',
        stageNumber: 4,
        title: 'First Scan',
        subtitle: 'Baseline Discovery Across 7 Domains',
        description: 'Perform baseline discovery scan.',
        status: 'completed',
        startedAt: '2026-07-15 11:00:00',
        completedAt: '2026-07-15 11:15:00',
        duration: '15m 00s',
        assignedTech: 'Scan Engine',
        graphEndpoint: 'GET /v1.0/security/secureScores',
        subItems: [
          { id: 'fs4-1', name: 'Identity scan', passed: true },
          { id: 'fs4-2', name: 'Security scan', passed: true },
          { id: 'fs4-3', name: 'Compliance scan', passed: true },
          { id: 'fs4-4', name: 'Licensing scan', passed: true },
          { id: 'fs4-5', name: 'Adoption scan', passed: true },
          { id: 'fs4-6', name: 'Copilot readiness scan', passed: true },
          { id: 'fs4-7', name: 'Architecture scan', passed: true },
        ],
        apiPayloadJson: { secureScore: 790 },
        apiLogs: ['[SUCCESS] Scan Complete'],
        metricsSummary: '110 Scanned',
        recommendedActions: [],
      },
      {
        id: 'f-stg-5',
        stageNumber: 5,
        title: 'Pillar Processing',
        subtitle: '7 Domain Breakout Engine',
        description: 'Execute 7 pillar breakouts.',
        status: 'completed',
        startedAt: '2026-07-15 11:20:00',
        completedAt: '2026-07-15 11:45:00',
        duration: '25m 00s',
        assignedTech: 'Pillar Engine',
        graphEndpoint: 'POST /api/msp/pillars/evaluate',
        subItems: [
          { id: 'fs5-1', name: 'Security Pillar', passed: true },
          { id: 'fs5-2', name: 'Governance Pillar', passed: true },
          { id: 'fs5-3', name: 'Compliance Pillar', passed: true },
          { id: 'fs5-4', name: 'Adoption Pillar', passed: true },
          { id: 'fs5-5', name: 'Copilot Readiness Pillar', passed: true },
          { id: 'fs5-6', name: 'Architecture Pillar', passed: true },
          { id: 'fs5-7', name: 'Licensing Pillar', passed: true },
        ],
        apiPayloadJson: { pillars: 7 },
        apiLogs: ['[SUCCESS] 7 Breakouts Complete'],
        metricsSummary: 'Avg Score 95%',
        recommendedActions: [],
      },
      {
        id: 'f-stg-6',
        stageNumber: 6,
        title: 'Score Consolidation & Risk Acceptance',
        subtitle: 'Tenant Intelligence Score & CISO Sign-off',
        description: 'Consolidate score & verify risk sign-off.',
        status: 'completed',
        startedAt: '2026-07-15 12:00:00',
        completedAt: '2026-07-15 12:15:00',
        duration: '15m 00s',
        assignedTech: 'Alex Rivera',
        graphEndpoint: 'POST /api/msp/risk/decisionAcceptance',
        subItems: [
          { id: 'fs6-1', name: 'Normalize pillar scores', passed: true },
          { id: 'fs6-2', name: 'Generate Tenant Intelligence Score', passed: true },
          { id: 'fs6-3', name: 'Identify risks requiring acceptance or remediation', passed: true },
        ],
        apiPayloadJson: { score: 92.5 },
        apiLogs: ['[SUCCESS] Signed off by CISO'],
        metricsSummary: 'Score 92.5 (A+)',
        recommendedActions: [],
      },
      {
        id: 'f-stg-7',
        stageNumber: 7,
        title: 'Automated Remediation & Change Requests',
        subtitle: 'Auto-Heal & Operator Dispatch',
        description: 'Execute remediations and change requests.',
        status: 'completed',
        startedAt: '2026-07-15 13:00:00',
        completedAt: '2026-07-15 13:20:00',
        duration: '20m 00s',
        assignedTech: 'Alex Rivera',
        graphEndpoint: 'POST /api/msp/remediation/dispatch',
        subItems: [
          { id: 'fs7-1', name: 'Auto-remediations triggered', passed: true },
          { id: 'fs7-2', name: 'Operator Tasks generated', passed: true },
          { id: 'fs7-3', name: 'Change Requests submitted', passed: true },
        ],
        apiPayloadJson: { status: 'Executed' },
        apiLogs: ['[SUCCESS] Remediations applied'],
        metricsSummary: 'All Remediated',
        recommendedActions: [],
      },
      {
        id: 'f-stg-8',
        stageNumber: 8,
        title: 'Tenant Goes Live',
        subtitle: 'Go-Live Activation & Continuous Scans',
        description: 'Tenant live and monitoring active.',
        status: 'completed',
        startedAt: '2026-07-15 14:00:00',
        completedAt: '2026-07-15 14:05:00',
        duration: '5m 00s',
        assignedTech: 'Alex Rivera',
        graphEndpoint: 'POST /api/msp/tenant/activateGoLive',
        subItems: [
          { id: 'fs8-1', name: 'Tenant Portal activated', passed: true },
          { id: 'fs8-2', name: 'Heatmap, Map, Timeline populated', passed: true },
          { id: 'fs8-3', name: 'SLA Dashboard live', passed: true },
          { id: 'fs8-4', name: 'Ongoing scans scheduled', passed: true },
        ],
        apiPayloadJson: { live: true },
        apiLogs: ['[SUCCESS] Tenant Live!'],
        metricsSummary: 'Tenant Live',
        recommendedActions: [],
      },
    ],
  },
];

// Helper to get M365 Stage Icon
function getStageIcon(stageNumber: number, className = 'w-5 h-5') {
  switch (stageNumber) {
    case 1:
      return <Building2 className={cn(className, 'text-[#0078D4]')} />;
    case 2:
      return <KeyRound className={cn(className, 'text-[#00B7C3]')} />;
    case 3:
      return <ShieldCheck className={cn(className, 'text-[#6264A7]')} />;
    case 4:
      return <Search className={cn(className, 'text-[#008272]')} />;
    case 5:
      return <Cpu className={cn(className, 'text-[#744DA9]')} />;
    case 6:
      return <BarChart3 className={cn(className, 'text-[#107C41]')} />;
    case 7:
      return <Zap className={cn(className, 'text-[#D13438]')} />;
    case 8:
      return <Award className={cn(className, 'text-emerald-400 animate-pulse')} />;
    default:
      return <GitBranch className={cn(className, 'text-[#0078D4]')} />;
  }
}

// Helper for Pillar Icon
function getPillarIcon(category: PillarBreakout['category'], className = 'w-4 h-4') {
  switch (category) {
    case 'Security':
      return <ShieldAlert className={cn(className, 'text-[#0078D4]')} />;
    case 'Governance':
      return <Lock className={cn(className, 'text-[#6264A7]')} />;
    case 'Compliance':
      return <ShieldCheck className={cn(className, 'text-[#107C41]')} />;
    case 'Adoption':
      return <Activity className={cn(className, 'text-[#008272]')} />;
    case 'Copilot Readiness':
      return <Bot className={cn(className, 'text-[#00B7C3]')} />;
    case 'Architecture':
      return <Globe className={cn(className, 'text-[#744DA9]')} />;
    case 'Licensing':
      return <FileText className={cn(className, 'text-[#D13438]')} />;
  }
}

export const OnboardingMapConsole: React.FC<OnboardingMapConsoleProps> = ({
  tenants = [],
  selectedTenantId,
  onShowToast,
  onExecuteOnboardingStep,
}) => {
  // State
  const [workflows, setWorkflows] = useState<TenantOnboardingWorkflow[]>(INITIAL_WORKFLOWS);
  const [activeTenantId, setActiveTenantId] = useState<string>(
    selectedTenantId || INITIAL_WORKFLOWS[0].tenantId
  );
  const [selectedStageNumber, setSelectedStageNumber] = useState<number | null>(null);
  const [selectedPillarId, setSelectedPillarId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'canvas' | 'pipeline' | 'matrix'>('canvas');
  const [canvasZoom, setCanvasZoom] = useState<number>(100);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  // Default to TRUE for dark SOC theme integration!
  const [isFluentDarkTheme, setIsFluentDarkTheme] = useState<boolean>(true);
  const [showLogTerminal, setShowLogTerminal] = useState<boolean>(false);

  const canvasRef = useRef<HTMLDivElement>(null);

  // Active Workflow
  const currentWorkflow = useMemo(() => {
    return workflows.find((w) => w.tenantId === activeTenantId) || workflows[0];
  }, [workflows, activeTenantId]);

  // Selected Stage
  const selectedStage = useMemo(() => {
    if (!selectedStageNumber) return null;
    return currentWorkflow.stages.find((s) => s.stageNumber === selectedStageNumber) || null;
  }, [currentWorkflow, selectedStageNumber]);

  // Selected Pillar
  const selectedPillar = useMemo(() => {
    if (!selectedPillarId) return null;
    return currentWorkflow.pillars.find((p) => p.id === selectedPillarId) || null;
  }, [currentWorkflow, selectedPillarId]);

  // Execute or advance next stage
  const handleAdvanceStage = (stageNum: number) => {
    setIsExecuting(true);
    if (onShowToast) {
      onShowToast(
        'info',
        'Dispatching Stage Execution',
        `Executing Stage ${stageNum} for ${currentWorkflow.tenantName} via Graph API...`
      );
    }

    setTimeout(() => {
      setWorkflows((prev) =>
        prev.map((w) => {
          if (w.tenantId !== currentWorkflow.tenantId) return w;
          const updatedStages = w.stages.map((stg) => {
            if (stg.stageNumber === stageNum) {
              return {
                ...stg,
                status: 'completed' as const,
                completedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
                subItems: stg.subItems.map((sub) => ({ ...sub, passed: true })),
                apiLogs: [
                  ...stg.apiLogs,
                  `${new Date().toLocaleTimeString()} [SUCCESS] Executed manually via M365 Onboarding Canvas`,
                ],
              };
            }
            if (stg.stageNumber === stageNum + 1 && stg.status === 'pending') {
              return {
                ...stg,
                status: 'in_progress' as const,
                startedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
              };
            }
            return stg;
          });

          const completedCount = updatedStages.filter((s) => s.status === 'completed').length;
          const progress = Math.round((completedCount / 8) * 100);

          return {
            ...w,
            overallProgressPercent: progress,
            currentStageNumber: Math.min(8, stageNum + 1),
            status: progress === 100 ? 'Tenant Live' : w.status,
            stages: updatedStages,
          };
        })
      );

      setIsExecuting(false);
      if (onShowToast) {
        onShowToast(
          'success',
          'Stage Completed',
          `Stage ${stageNum} executed successfully. Baseline updated!`
        );
      }
      if (onExecuteOnboardingStep) {
        onExecuteOnboardingStep(currentWorkflow.tenantId, `stg-${stageNum}`);
      }
    }, 1200);
  };

  // Toggle sub-item check
  const handleToggleSubItem = (stageNum: number, subItemId: string) => {
    setWorkflows((prev) =>
      prev.map((w) => {
        if (w.tenantId !== currentWorkflow.tenantId) return w;
        return {
          ...w,
          stages: w.stages.map((stg) => {
            if (stg.stageNumber !== stageNum) return stg;
            return {
              ...stg,
              subItems: stg.subItems.map((item) =>
                item.id === subItemId ? { ...item, passed: !item.passed } : item
              ),
            };
          }),
        };
      })
    );
  };

  // Status Badge Component
  const renderStatusBadge = (status: OnboardingStageStatus) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            Completed
          </span>
        );
      case 'in_progress':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#0078D4]/20 text-cyan-300 border border-[#0078D4]/40">
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
            In Progress
          </span>
        );
      case 'blocked':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
            Blocked
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800/80 text-slate-400 border border-slate-700">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            Pending
          </span>
        );
    }
  };

  return (
    <div
      className={cn(
        'flex-1 h-full overflow-y-auto p-4 md:p-6 transition-colors duration-200 font-sans',
        isFluentDarkTheme
          ? 'bg-[#0b0f17] text-slate-100'
          : 'bg-[#f1f5f9] text-slate-900'
      )}
    >
      {/* HEADER BAR */}
      <div className={cn(
        'mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl border shadow-lg transition-all',
        isFluentDarkTheme
          ? 'bg-[#131927] border-[#1f293d] text-white shadow-black/40'
          : 'bg-white border-slate-200 text-slate-900 shadow-sm'
      )}>
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-[#0078D4]/15 rounded-xl border border-[#0078D4]/30 shadow-inner">
            <GitBranch className="w-6 h-6 text-[#38BDF8]" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-white">
                MSP Customer Onboarding Workflow Map
              </h1>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#0078D4] text-white font-semibold shadow-xs">
                M365 Fluent Design
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Interactive stage-based canvas process & 7-pillar breakout discovery engine
            </p>
          </div>
        </div>

        {/* TENANT SELECTOR & CONTROLS */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Tenant Dropdown */}
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-medium',
            isFluentDarkTheme
              ? 'bg-[#182235] border-[#23314a] text-slate-200'
              : 'bg-slate-100 border-slate-300 text-slate-800'
          )}>
            <Building2 className="w-4 h-4 text-[#38BDF8]" />
            <select
              value={activeTenantId}
              onChange={(e) => setActiveTenantId(e.target.value)}
              className="bg-transparent text-sm font-medium focus:outline-none cursor-pointer text-slate-100"
            >
              {workflows.map((w) => (
                <option key={w.tenantId} value={w.tenantId} className="bg-[#131927] text-white">
                  {w.tenantName} ({w.primaryDomain})
                </option>
              ))}
              {tenants.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#131927] text-white">
                  {t.name} ({t.primaryDomain})
                </option>
              ))}
            </select>
          </div>

          {/* View Mode Switcher */}
          <div className={cn(
            'flex items-center p-1 rounded-xl border text-xs font-medium',
            isFluentDarkTheme
              ? 'bg-[#182235] border-[#23314a]'
              : 'bg-slate-100 border-slate-300'
          )}>
            <button
              onClick={() => setViewMode('canvas')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all',
                viewMode === 'canvas'
                  ? 'bg-[#0078D4] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              )}
            >
              <Compass className="w-3.5 h-3.5" />
              Canvas Map
            </button>
            <button
              onClick={() => setViewMode('pipeline')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all',
                viewMode === 'pipeline'
                  ? 'bg-[#0078D4] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              )}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Pipeline
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all',
                viewMode === 'matrix'
                  ? 'bg-[#0078D4] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              )}
            >
              <List className="w-3.5 h-3.5" />
              Matrix View
            </button>
          </div>

          {/* Launch Stage Wizard Button */}
          <button
            onClick={() => {
              setSelectedStageNumber(selectedStageNumber || 1);
              setSelectedPillarId(null);
            }}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-bold text-xs bg-[#0078D4] hover:bg-[#005A9E] text-white shadow-md shadow-[#0078D4]/20 transition-all cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            Launch Stage Wizard
          </button>

          {/* Dark / Light Toggle */}
          <button
            onClick={() => setIsFluentDarkTheme(!isFluentDarkTheme)}
            className={cn(
              'p-2 rounded-xl border transition-colors',
              isFluentDarkTheme
                ? 'bg-[#182235] border-[#23314a] text-amber-400 hover:bg-[#202d46]'
                : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
            )}
            title="Toggle Visual Theme"
          >
            <Sparkles className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* MAIN LAYOUT CANVAS / PIPELINE / MATRIX WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* MAIN WORKSPACE */}
        <div className="lg:col-span-12 transition-all duration-300">
          {/* CANVAS VIEW / DIAGRAM */}
          {viewMode === 'canvas' && (
        <div className={cn(
          'relative rounded-3xl border shadow-2xl overflow-hidden mb-6 transition-all',
          isFluentDarkTheme ? 'bg-[#131927] border-[#1f293d]' : 'bg-white border-slate-200'
        )}>
          {/* CANVAS TOOLBAR */}
          <div className={cn(
            'p-4 border-b flex items-center justify-between',
            isFluentDarkTheme ? 'bg-[#182235]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200'
          )}>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#38BDF8]">
                M365 Fluent Diagram Canvas
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-xs text-slate-400">
                Click any stage or 7-pillar breakout to open Stage Wizard
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Zoom Controls */}
              <div className={cn(
                'flex items-center rounded-xl border text-xs font-medium',
                isFluentDarkTheme ? 'bg-[#0f172a] border-[#23314a] text-slate-200' : 'bg-white border-slate-300 text-slate-800'
              )}>
                <button
                  onClick={() => setCanvasZoom((z) => Math.max(50, z - 10))}
                  className="p-1.5 hover:bg-slate-800 rounded-l-xl text-slate-300"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="px-2 font-mono text-slate-200">
                  {canvasZoom}%
                </span>
                <button
                  onClick={() => setCanvasZoom((z) => Math.min(150, z + 10))}
                  className="p-1.5 hover:bg-slate-800 rounded-r-xl text-slate-300"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                onClick={() => setCanvasZoom(100)}
                className={cn(
                  'px-2.5 py-1.5 text-xs font-medium rounded-xl border transition-colors',
                  isFluentDarkTheme ? 'bg-[#0f172a] border-[#23314a] text-slate-300 hover:bg-slate-800' : 'bg-slate-100 border-slate-300 text-slate-700'
                )}
              >
                Reset
              </button>

              <button
                onClick={() => setShowLogTerminal(!showLogTerminal)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all',
                  showLogTerminal
                    ? 'bg-slate-900 text-emerald-400 border-emerald-500/50 shadow-md shadow-emerald-500/10'
                    : 'bg-[#182235] text-slate-300 border-[#23314a] hover:bg-slate-800'
                )}
              >
                <Terminal className="w-3.5 h-3.5" />
                Graph Logs
              </button>
            </div>
          </div>

          {/* CANVAS WORKSPACE */}
          <div className="w-full overflow-auto max-h-[800px] p-8 bg-[#0b0f17] relative custom-scrollbar">
            {/* Background Grid Accent */}
            <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:20px_20px] opacity-30 pointer-events-none" />

            <div
              ref={canvasRef}
              className="min-w-[1350px] space-y-10 relative z-10 transition-transform origin-top-left"
              style={{
                transform: `scale(${canvasZoom / 100})`,
                width: canvasZoom > 100 ? `${canvasZoom}%` : undefined,
              }}
            >
              
              {/* STAGES 1 TO 4 (HORIZONTAL FLOW) */}
              <div className="grid grid-cols-4 gap-6 relative">
                {currentWorkflow.stages.slice(0, 4).map((stage, idx) => {
                  const isSelected = selectedStageNumber === stage.stageNumber && !selectedPillarId;
                  return (
                    <div key={stage.id} className="relative group">
                      {/* Stage Card */}
                      <div
                        onClick={() => {
                          setSelectedStageNumber(stage.stageNumber);
                          setSelectedPillarId(null);
                        }}
                        className={cn(
                          'p-5 rounded-2xl border transition-all duration-200 cursor-pointer bg-[#131927] relative z-10',
                          isSelected
                            ? 'border-[#0078D4] ring-2 ring-[#0078D4]/40 shadow-xl shadow-[#0078D4]/20 bg-[#162032]'
                            : 'border-[#1f293d] hover:border-[#0078D4]/60 hover:shadow-lg hover:shadow-[#0078D4]/10'
                        )}
                      >
                        {/* Header Badge */}
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#38BDF8] bg-[#0078D4]/20 px-2 py-0.5 rounded-md border border-[#0078D4]/30">
                            Stage 0{stage.stageNumber}
                          </span>
                          {renderStatusBadge(stage.status)}
                        </div>

                        {/* Title & Icon */}
                        <div className="flex items-start gap-3 mb-3">
                          <div className="p-2.5 rounded-xl bg-[#182235] border border-[#23314a] shrink-0">
                            {getStageIcon(stage.stageNumber)}
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-white group-hover:text-[#38BDF8] transition-colors line-clamp-1">
                              {stage.title}
                            </h3>
                            <p className="text-xs text-slate-400 line-clamp-1">
                              {stage.subtitle}
                            </p>
                          </div>
                        </div>

                        {/* Sub-items Checklist */}
                        <div className="space-y-2 pt-3 border-t border-[#1f293d] text-xs">
                          {stage.subItems.map((sub) => (
                            <div key={sub.id} className="flex items-center justify-between text-slate-300">
                              <span className="flex items-center gap-2 truncate pr-2">
                                <span
                                  className={cn(
                                    'w-1.5 h-1.5 rounded-full shrink-0',
                                    sub.passed ? 'bg-emerald-400' : 'bg-slate-600'
                                  )}
                                />
                                {sub.name}
                              </span>
                              {sub.passed ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              ) : (
                                <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Connecting Arrow */}
                      {idx < 3 && (
                        <div className="absolute -right-5 top-1/2 -translate-y-1/2 z-20 hidden lg:flex items-center">
                          <div className="w-4 h-0.5 bg-[#0078D4]/60" />
                          <ChevronRight className="w-4 h-4 -ml-1 text-[#38BDF8]" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* STAGE 5 — PILLAR PROCESSING (7 BREAKOUTS BRANCHING) */}
              <div className="relative pt-6 border-t border-dashed border-[#1f293d]">
                {/* Stage 5 Container Header */}
                <div
                  onClick={() => {
                    setSelectedStageNumber(5);
                    setSelectedPillarId(null);
                  }}
                  className={cn(
                    'p-5 rounded-2xl border bg-[#131927] transition-all cursor-pointer mb-6',
                    selectedStageNumber === 5 && !selectedPillarId
                      ? 'border-[#744DA9] ring-2 ring-[#744DA9]/40 shadow-xl shadow-purple-500/10 bg-[#171e30]'
                      : 'border-[#1f293d] hover:border-[#744DA9]/60'
                  )}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex items-center gap-3.5">
                      <div className="p-3 bg-[#744DA9]/20 rounded-xl border border-[#744DA9]/40">
                        <Cpu className="w-6 h-6 text-[#a78bfa]" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300 bg-[#744DA9]/30 px-2.5 py-0.5 rounded-md border border-[#744DA9]/40">
                            Stage 05 — Pillar Processing
                          </span>
                          {renderStatusBadge(currentWorkflow.stages[4].status)}
                        </div>
                        <h3 className="text-base font-bold text-white mt-1">
                          Pillar Processing (7 Breakouts Engine)
                        </h3>
                        <p className="text-xs text-slate-400">
                          Parallel deep discovery scan across 7 core Microsoft 365 operational & governance pillars
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-semibold text-purple-300 bg-[#744DA9]/20 px-3 py-1.5 rounded-xl border border-[#744DA9]/30">
                      <span>7 Equal Sub-Blocks Branching Below</span>
                      <ArrowDown className="w-3.5 h-3.5 text-purple-400" />
                    </div>
                  </div>
                </div>

                {/* THE 7 BREAKOUT PILLARS GRID */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3.5">
                  {currentWorkflow.pillars.map((pillar) => {
                    const isPillarSelected = selectedPillarId === pillar.id;
                    return (
                      <div
                        key={pillar.id}
                        onClick={() => {
                          setSelectedPillarId(pillar.id);
                          setSelectedStageNumber(5);
                        }}
                        className={cn(
                          'p-4 rounded-2xl border transition-all duration-200 cursor-pointer bg-[#131927] flex flex-col justify-between group',
                          isPillarSelected
                            ? 'ring-2 ring-[#0078D4] border-transparent shadow-xl shadow-[#0078D4]/20 bg-[#162032]'
                            : 'border-[#1f293d] hover:border-[#0078D4]/60 hover:shadow-lg'
                        )}
                      >
                        <div>
                          {/* Header */}
                          <div className="flex items-center justify-between mb-2.5">
                            <div className="p-2 rounded-xl bg-[#182235] border border-[#23314a]">
                              {getPillarIcon(pillar.category, 'w-4 h-4')}
                            </div>
                            <span
                              className="text-xs font-extrabold px-2 py-0.5 rounded-md border border-white/10"
                              style={{
                                backgroundColor: `${pillar.accentColor}25`,
                                color: '#ffffff',
                              }}
                            >
                              {pillar.score}%
                            </span>
                          </div>

                          {/* Title */}
                          <h4 className="text-xs font-bold text-white group-hover:text-[#38BDF8] transition-colors leading-tight mb-1">
                            {pillar.name}
                          </h4>
                          <p className="text-[11px] text-slate-400 line-clamp-2 leading-snug">
                            {pillar.description}
                          </p>
                        </div>

                        {/* Sub-items list */}
                        <div className="mt-3 pt-2.5 border-t border-[#1f293d] space-y-1.5 text-[11px]">
                          {pillar.subItems.map((sub) => (
                            <div key={sub.id} className="flex items-center justify-between text-slate-300">
                              <span className="truncate pr-1">• {sub.name}</span>
                              {sub.passed ? (
                                <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                              ) : (
                                <Clock className="w-3 h-3 text-amber-400 shrink-0" />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* CONVERGING CONNECTOR & STAGES 6 TO 8 */}
              <div className="relative pt-6 border-t border-dashed border-[#1f293d]">
                <div className="text-center mb-4">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest bg-[#182235] px-3.5 py-1 rounded-full border border-[#23314a]">
                    Convergence into Consolidation & Remediation
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-6">
                  {currentWorkflow.stages.slice(5, 8).map((stage, idx) => {
                    const isSelected = selectedStageNumber === stage.stageNumber && !selectedPillarId;
                    return (
                      <div key={stage.id} className="relative group">
                        <div
                          onClick={() => {
                            setSelectedStageNumber(stage.stageNumber);
                            setSelectedPillarId(null);
                          }}
                          className={cn(
                            'p-5 rounded-2xl border transition-all duration-200 cursor-pointer bg-[#131927] relative z-10',
                            isSelected
                              ? 'border-[#0078D4] ring-2 ring-[#0078D4]/40 shadow-xl shadow-[#0078D4]/20 bg-[#162032]'
                              : 'border-[#1f293d] hover:border-[#0078D4]/60 hover:shadow-lg'
                          )}
                        >
                          {/* Header Badge */}
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[#38BDF8] bg-[#0078D4]/20 px-2 py-0.5 rounded-md border border-[#0078D4]/30">
                              Stage 0{stage.stageNumber}
                            </span>
                            {renderStatusBadge(stage.status)}
                          </div>

                          {/* Title & Icon */}
                          <div className="flex items-start gap-3 mb-3">
                            <div className="p-2.5 rounded-xl bg-[#182235] border border-[#23314a] shrink-0">
                              {getStageIcon(stage.stageNumber)}
                            </div>
                            <div>
                              <h3 className="text-sm font-bold text-white group-hover:text-[#38BDF8] transition-colors line-clamp-1">
                                {stage.title}
                              </h3>
                              <p className="text-xs text-slate-400 line-clamp-1">
                                {stage.subtitle}
                              </p>
                            </div>
                          </div>

                          {/* Sub-items Checklist */}
                          <div className="space-y-2 pt-3 border-t border-[#1f293d] text-xs">
                            {stage.subItems.map((sub) => (
                              <div key={sub.id} className="flex items-center justify-between text-slate-300">
                                <span className="flex items-center gap-2 truncate pr-2">
                                  <span
                                    className={cn(
                                      'w-1.5 h-1.5 rounded-full shrink-0',
                                      sub.passed ? 'bg-emerald-400' : 'bg-slate-600'
                                    )}
                                  />
                                  {sub.name}
                                </span>
                                {sub.passed ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                ) : (
                                  <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Arrow connector */}
                        {idx < 2 && (
                          <div className="absolute -right-5 top-1/2 -translate-y-1/2 z-20 hidden lg:flex items-center">
                            <div className="w-4 h-0.5 bg-[#0078D4]/60" />
                            <ChevronRight className="w-4 h-4 -ml-1 text-[#38BDF8]" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* PIPELINE / CARD VIEW MODE */}
      {viewMode === 'pipeline' && (
        <div className="space-y-4 mb-6">
          {currentWorkflow.stages.map((stage) => (
            <div
              key={stage.id}
              className={cn(
                'p-5 rounded-2xl bg-[#131927] border transition-all',
                selectedStageNumber === stage.stageNumber
                  ? 'border-[#0078D4] ring-2 ring-[#0078D4]/30 shadow-md'
                  : 'border-[#1f293d] hover:border-[#2a3854]'
              )}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="p-3 bg-[#182235] rounded-xl border border-[#23314a]">
                    {getStageIcon(stage.stageNumber)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[#38BDF8]">Stage 0{stage.stageNumber}</span>
                      {renderStatusBadge(stage.status)}
                    </div>
                    <h3 className="text-base font-bold text-white mt-0.5">
                      {stage.title}
                    </h3>
                    <p className="text-xs text-slate-400">{stage.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setSelectedStageNumber(stage.stageNumber);
                      setSelectedPillarId(null);
                    }}
                    className="px-3.5 py-1.5 text-xs font-medium bg-[#182235] hover:bg-[#202d46] rounded-xl text-slate-200 border border-[#23314a]"
                  >
                    Inspect Stage
                  </button>
                  <button
                    onClick={() => handleAdvanceStage(stage.stageNumber)}
                    disabled={isExecuting || stage.status === 'completed'}
                    className={cn(
                      'px-4 py-1.5 text-xs font-semibold rounded-xl text-white transition-all flex items-center gap-1.5',
                      stage.status === 'completed'
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                        : 'bg-[#0078D4] hover:bg-[#005A9E] shadow-sm'
                    )}
                  >
                    <Play className="w-3.5 h-3.5" />
                    {stage.status === 'completed' ? 'Executed' : 'Run Stage'}
                  </button>
                </div>
              </div>

              {/* Sub-items Grid */}
              <div className="mt-4 pt-3 border-t border-[#1f293d] grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {stage.subItems.map((sub) => (
                  <div
                    key={sub.id}
                    onClick={() => handleToggleSubItem(stage.stageNumber, sub.id)}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-[#182235]/60 border border-[#23314a]/50 cursor-pointer hover:bg-[#182235]"
                  >
                    <span className="truncate text-slate-200 pr-2">{sub.name}</span>
                    {sub.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <Clock className="w-4 h-4 text-slate-500 shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MATRIX VIEW MODE */}
      {viewMode === 'matrix' && (
        <div className="bg-[#131927] rounded-2xl border border-[#1f293d] overflow-hidden mb-6 shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#182235] text-slate-400 border-b border-[#1f293d] uppercase font-bold tracking-wider">
                <tr>
                  <th className="p-4">Stage</th>
                  <th className="p-4">Title & Subtitle</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Assigned Tech</th>
                  <th className="p-4">Graph Endpoint</th>
                  <th className="p-4">Sub-items Completed</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1f293d]">
                {currentWorkflow.stages.map((stage) => (
                  <tr key={stage.id} className="hover:bg-[#182235]/50 transition-colors">
                    <td className="p-4 font-bold text-[#38BDF8]">Stage 0{stage.stageNumber}</td>
                    <td className="p-4">
                      <p className="font-semibold text-white">{stage.title}</p>
                      <p className="text-[11px] text-slate-400">{stage.subtitle}</p>
                    </td>
                    <td className="p-4">{renderStatusBadge(stage.status)}</td>
                    <td className="p-4 text-slate-300">{stage.assignedTech}</td>
                    <td className="p-4 font-mono text-[11px] text-slate-400">{stage.graphEndpoint}</td>
                    <td className="p-4">
                      <span className="font-semibold text-slate-200">
                        {stage.subItems.filter((s) => s.passed).length} / {stage.subItems.length}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => {
                          setSelectedStageNumber(stage.stageNumber);
                          setSelectedPillarId(null);
                        }}
                        className="px-3 py-1 text-xs font-medium bg-[#182235] hover:bg-[#202d46] text-slate-200 rounded-lg border border-[#23314a]"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

          {/* GRAPH LOG TERMINAL MODAL */}
          {showLogTerminal && (
            <div className="p-4 bg-slate-950 text-emerald-400 rounded-2xl font-mono text-xs shadow-2xl border border-slate-800 space-y-2 mb-6">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-slate-400 text-[11px]">
                <span className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                  Live Microsoft Graph API & Onboarding Orchestration Logs
                </span>
                <button onClick={() => setShowLogTerminal(false)} className="hover:text-white">
                  Close [X]
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                <p>[SYSTEM] Connected to Graph API Tenant Endpoint for {currentWorkflow.primaryDomain}</p>
                {currentWorkflow.stages.flatMap((s) => s.apiLogs).map((log, i) => (
                  <p key={i}>{log}</p>
                ))}
              </div>
            </div>
          )}
        </div>

      {/* ONBOARDING STAGE WIZARD MODAL DIALOG */}
      {(selectedStage || selectedPillar) && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-[#131927] border border-[#1f293d] rounded-3xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-200">
            
            {/* WIZARD TOP STEPPER HEADER */}
            <div className="bg-[#182235] border-b border-[#1f293d] p-3 px-4 sm:px-6">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#38BDF8] bg-[#0078D4]/20 px-2.5 py-0.5 rounded-full border border-[#0078D4]/30">
                    Interactive Stage Wizard
                  </span>
                  <span className="text-xs text-slate-400">
                    {selectedPillar ? `Viewing ${selectedPillar.name}` : `Stage 0${selectedStage!.stageNumber} of 08`}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {selectedPillar && (
                    <button
                      onClick={() => setSelectedPillarId(null)}
                      className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-purple-900/50 text-purple-300 border border-purple-700/50 hover:bg-purple-800/60 transition-colors cursor-pointer"
                    >
                      Back to Stage Stepper
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setSelectedStageNumber(null);
                      setSelectedPillarId(null);
                    }}
                    className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                    title="Close Wizard"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Stage Stepper Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                {currentWorkflow.stages.map((stg) => {
                  const isActive = selectedStageNumber === stg.stageNumber && !selectedPillar;
                  return (
                    <button
                      key={stg.id}
                      onClick={() => {
                        setSelectedStageNumber(stg.stageNumber);
                        setSelectedPillarId(null);
                      }}
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border shrink-0 cursor-pointer',
                        isActive
                          ? 'bg-[#0078D4] text-white border-[#0078D4] shadow-md shadow-[#0078D4]/30 ring-1 ring-white/20'
                          : stg.status === 'completed'
                          ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50 hover:bg-emerald-900/40'
                          : stg.status === 'in_progress'
                          ? 'bg-blue-950/40 text-blue-300 border-blue-800/50 hover:bg-blue-900/40'
                          : 'bg-[#0f172a]/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
                      )}
                    >
                      <span className="text-[10px] font-mono opacity-80">0{stg.stageNumber}</span>
                      <span className="truncate max-w-[110px]">{stg.title.replace(/^Stage \d+ - /, '')}</span>
                      {stg.status === 'completed' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : stg.status === 'in_progress' ? (
                        <Clock className="w-3.5 h-3.5 text-blue-400 animate-pulse shrink-0" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* MODAL BODY CONTENT */}
            <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar flex-1">
              {/* Stage Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-[#182235]/90 border border-[#23314a]">
                <div className="flex items-center gap-3.5">
                  <div className="p-3 bg-[#0078D4]/20 rounded-xl border border-[#0078D4]/30 shrink-0">
                    {selectedPillar
                      ? getPillarIcon(selectedPillar.category, 'w-6 h-6')
                      : getStageIcon(selectedStage!.stageNumber, 'w-6 h-6')}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase text-[#38BDF8]">
                        {selectedPillar ? '7-Pillar Breakout' : `Stage 0${selectedStage!.stageNumber} Wizard Step`}
                      </span>
                      {selectedStage && renderStatusBadge(selectedStage.status)}
                      <span className="text-xs text-slate-400">({currentWorkflow.primaryDomain})</span>
                    </div>
                    <h2 className="text-lg font-bold text-white mt-0.5">
                      {selectedPillar ? selectedPillar.name : selectedStage!.title}
                    </h2>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                      {selectedPillar ? selectedPillar.description : selectedStage!.description}
                    </p>
                  </div>
                </div>

                {/* Quick Metrics */}
                <div className="flex items-center gap-3 sm:self-center shrink-0">
                  <div className="px-3 py-2 rounded-xl bg-[#131927] border border-[#1f293d] text-center">
                    <p className="text-[10px] text-slate-400 uppercase font-bold">Assigned Tech</p>
                    <p className="text-xs font-semibold text-slate-200 mt-0.5">
                      {selectedStage ? selectedStage.assignedTech : 'Automated Engine'}
                    </p>
                  </div>
                  <div className="px-3 py-2 rounded-xl bg-[#131927] border border-[#1f293d] text-center">
                    <p className="text-[10px] text-slate-400 uppercase font-bold">Progress</p>
                    <p className="text-xs font-bold text-emerald-400 mt-0.5">
                      {selectedPillar
                        ? `${selectedPillar.score}% Score`
                        : selectedStage?.status === 'completed'
                        ? '100% Passed'
                        : `${selectedStage?.subItems.filter((s) => s.passed).length}/${selectedStage?.subItems.length} Done`}
                    </p>
                  </div>
                </div>
              </div>

              {/* 2-Column Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left: Interactive Validation Checklist */}
                <div className="space-y-3 bg-[#182235]/50 rounded-2xl p-4 border border-[#23314a]">
                  <div className="flex items-center justify-between pb-2 border-b border-[#23314a]">
                    <h3 className="font-bold uppercase text-xs tracking-wider text-slate-300 flex items-center gap-2">
                      <CheckSquare className="w-4 h-4 text-[#38BDF8]" />
                      Stage Validation Checklist
                    </h3>
                    <span className="text-[11px] text-slate-400">Click to toggle status</span>
                  </div>

                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                    {(selectedPillar ? selectedPillar.subItems : selectedStage!.subItems).map((sub) => (
                      <div
                        key={sub.id}
                        onClick={() => {
                          if (selectedStage) {
                            handleToggleSubItem(selectedStage.stageNumber, sub.id);
                          }
                        }}
                        className={cn(
                          'p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all text-xs',
                          sub.passed
                            ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-200 hover:border-emerald-500/60'
                            : 'bg-[#131927] border-[#1f293d] text-slate-300 hover:border-[#0078D4]/60'
                        )}
                      >
                        <div className="pr-2 min-w-0 flex items-center gap-2.5">
                          <div className={cn(
                            'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                            sub.passed ? 'bg-emerald-500 border-emerald-400 text-slate-950' : 'border-slate-600 bg-slate-800'
                          )}>
                            {sub.passed && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                          <div>
                            <p className="font-semibold truncate">{sub.name}</p>
                            {sub.notes && <p className="text-[10px] text-amber-400 mt-0.5">{sub.notes}</p>}
                          </div>
                        </div>
                        {sub.passed ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                            Passed
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 shrink-0">
                            Pending
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: Graph API & Live Telemetry Stream */}
                <div className="space-y-3 bg-[#182235]/50 rounded-2xl p-4 border border-[#23314a]">
                  <div className="flex items-center justify-between pb-2 border-b border-[#23314a]">
                    <h3 className="font-bold uppercase text-xs tracking-wider text-slate-300 flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-emerald-400" />
                      Microsoft Graph API Telemetry
                    </h3>
                    <span className="text-[10px] font-mono text-cyan-400">Live Stream</span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div>
                      <p className="text-slate-400 text-[10px] uppercase font-bold">Target Graph Endpoint</p>
                      <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-cyan-300 text-[11px] mt-1 truncate">
                        {selectedStage ? selectedStage.graphEndpoint : 'POST /api/msp/pillars/evaluate'}
                      </div>
                    </div>

                    <div>
                      <p className="text-slate-400 text-[10px] uppercase font-bold mb-1">Execution Log Console</p>
                      <div className="p-3 bg-slate-950 text-emerald-400 rounded-xl font-mono text-[11px] space-y-1.5 max-h-44 overflow-y-auto border border-slate-800 custom-scrollbar">
                        {(selectedStage ? selectedStage.apiLogs : ['[INFO] Pillar breakout scan verified.']).map(
                          (log, idx) => (
                            <p key={idx} className="leading-tight">{log}</p>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* WIZARD FOOTER WITH DIRECT STEPPER NAVIGATION CONTROLS */}
            <div className="bg-[#182235] border-t border-[#1f293d] p-4 px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
              {/* Previous Stage Button */}
              <button
                onClick={() => {
                  if (selectedStageNumber && selectedStageNumber > 1) {
                    setSelectedStageNumber(selectedStageNumber - 1);
                    setSelectedPillarId(null);
                  }
                }}
                disabled={!selectedStageNumber || selectedStageNumber <= 1}
                className={cn(
                  'w-full sm:w-auto px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all border cursor-pointer',
                  selectedStageNumber && selectedStageNumber > 1
                    ? 'bg-[#131927] border-[#2a3854] text-slate-200 hover:bg-[#1f2b42] hover:border-slate-500'
                    : 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                )}
              >
                <ChevronLeft className="w-4 h-4" />
                Previous Stage
              </button>

              {/* Center: Stage Execution Dispatch Button */}
              {selectedStage && (
                <button
                  onClick={() => handleAdvanceStage(selectedStage.stageNumber)}
                  disabled={isExecuting}
                  className={cn(
                    'w-full sm:w-auto px-6 py-2.5 rounded-xl text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-lg cursor-pointer',
                    selectedStage.status === 'completed'
                      ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                      : 'bg-[#0078D4] hover:bg-[#005A9E] shadow-[#0078D4]/30'
                  )}
                >
                  <Play className="w-4 h-4 fill-current" />
                  {selectedStage.status === 'completed'
                    ? 'Re-Run Graph Validation'
                    : 'Execute Current Stage'}
                </button>
              )}

              {/* Next Stage / Complete Button */}
              <button
                onClick={() => {
                  if (selectedStageNumber && selectedStageNumber < 8) {
                    setSelectedStageNumber(selectedStageNumber + 1);
                    setSelectedPillarId(null);
                  } else if (selectedStageNumber === 8) {
                    setSelectedStageNumber(null);
                    setSelectedPillarId(null);
                  }
                }}
                className={cn(
                  'w-full sm:w-auto px-5 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer',
                  selectedStageNumber === 8
                    ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 font-extrabold'
                    : 'bg-[#0078D4] text-white hover:bg-[#005A9E]'
                )}
              >
                {selectedStageNumber === 8 ? (
                  <>
                    Finish Onboarding Wizard 🎉
                  </>
                ) : (
                  <>
                    Next Stage
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default OnboardingMapConsole;

