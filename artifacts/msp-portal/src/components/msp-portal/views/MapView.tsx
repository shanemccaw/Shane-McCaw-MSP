// @ts-nocheck
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Network,
  Activity,
  ShieldAlert,
  ShieldCheck,
  KeyRound,
  Users,
  RefreshCw,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Search,
  Zap,
  SlidersHorizontal,
  Building2,
  Laptop,
  Mail,
  DollarSign,
  Crown,
  Shield,
  Layers,
  MessageSquare,
  Globe,
  UserCheck,
  FolderGit2,
  ChevronRight,
  Copy,
  ExternalLink,
  X,
  Code2,
  Terminal,
  Info,
  Send,
  Check,
  RotateCw,
  Maximize2,
  Minimize2,
  Filter,
  Clock,
  Eye,
  Sparkles,
  Bot,
  Scale,
  HeartPulse,
  Plus,
  Minus,
  Move,
  RotateCcw,
  Compass,
  Crosshair,
  TrendingUp,
  FileText,
  BarChart3,
  Flame,
  CheckCircle,
  FileJson,
  Download,
  Gauge,
} from 'lucide-react';
import { Tenant } from '../types';
import {
  M365_ACTION_REGISTRY,
  M365ActionItem,
  M365DomainCategory,
  SafetyLevel,
} from '../../data/m365ActionRegistry';

interface MapViewProps {
  tenants: Tenant[];
  selectedTenant?: Tenant | null;
  onSelectTenant: (tenant: Tenant | null) => void;
  onDispatchWorkflow?: (actionId: string, payload: any) => void;
  onShowToast?: (type: 'success' | 'info' | 'warning' | 'error', title: string, desc: string) => void;
}

export type ClusterGroup =
  | 'Security'
  | 'Governance'
  | 'Licensing'
  | 'Adoption'
  | 'Copilot'
  | 'Compliance'
  | 'Health';

export interface MapNode {
  id: string;
  label: string;
  category: M365DomainCategory;
  clusterGroup: ClusterGroup;
  isCategoryHub?: boolean;
  isCoreNode?: boolean;
  x: number; // exact canvas pixel X (0..2400)
  y: number; // exact canvas pixel Y (0..1500)
  status: 'healthy' | 'drift' | 'alert';
  healthScore: number;
  activeAlerts: number;
  endpointPath: string;
  endpointCount: number;
  connectedTo: string[]; // Node IDs to draw links to
  latencyHistory: number[];
  drifts: { id: string; title: string; severity: 'High' | 'Medium' | 'Low'; detectedAt: string }[];
  colorHex?: string;
}

export interface TelemetryLog {
  id: string;
  timestamp: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  endpoint: string;
  statusCode: number;
  latencyMs: number;
  nodeId: string;
  statusText: string;
  requestHeaders?: Record<string, string>;
  responseBody?: any;
}

// Helper function to generate smooth SVG annular wedge paths for pie chart pillar sectors
const getPieSectorPath = (
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startAngleDeg: number,
  endAngleDeg: number
): string => {
  const startRad = (startAngleDeg * Math.PI) / 180;
  const endRad = (endAngleDeg * Math.PI) / 180;

  const x1 = cx + rOuter * Math.cos(startRad);
  const y1 = cy + rOuter * Math.sin(startRad);

  const x2 = cx + rOuter * Math.cos(endRad);
  const y2 = cy + rOuter * Math.sin(endRad);

  const x3 = cx + rInner * Math.cos(endRad);
  const y3 = cy + rInner * Math.sin(endRad);

  const x4 = cx + rInner * Math.cos(startRad);
  const y4 = cy + rInner * Math.sin(startRad);

  const largeArcFlag = Math.abs(endAngleDeg - startAngleDeg) <= 180 ? 0 : 1;

  return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${largeArcFlag} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${largeArcFlag} 0 ${x4} ${y4} Z`;
};

const PILLAR_SECTORS: { group: ClusterGroup; colorHex: string }[] = [
  { group: 'Security', colorHex: '#0078D4' },
  { group: 'Governance', colorHex: '#6B4EFF' },
  { group: 'Licensing', colorHex: '#009CA6' },
  { group: 'Adoption', colorHex: '#43A047' },
  { group: 'Copilot', colorHex: '#00B7C3' },
  { group: 'Compliance', colorHex: '#5A2D91' },
  { group: 'Health', colorHex: '#F7630C' },
];

export interface BusinessImpactSegmentConfig {
  id: string;
  label: 'Risk' | 'Cost' | 'Productivity' | 'Compliance' | 'Experience';
  iconKey: 'ShieldAlert' | 'DollarSign' | 'Zap' | 'Scale' | 'HeartPulse';
  startAngleDeg: number;
  endAngleDeg: number;
  contributingPillars: { group: ClusterGroup; weight: number }[];
  description: string;
  businessOutcomes: {
    stable: string;
    elevated: string;
    critical: string;
  };
}

export const BUSINESS_IMPACT_SEGMENTS: BusinessImpactSegmentConfig[] = [
  {
    id: 'risk',
    label: 'Risk',
    iconKey: 'ShieldAlert',
    startAngleDeg: -90 + 0.8,
    endAngleDeg: -18 - 0.8,
    contributingPillars: [
      { group: 'Security', weight: 0.5 },
      { group: 'Governance', weight: 0.5 },
    ],
    description: 'Converts identity posture, threat signals, PIM drift, and privileged exposure into enterprise breach risk.',
    businessOutcomes: {
      stable: 'Identity posture is resilient; low probability of breach or credential compromise.',
      elevated: 'MFA coverage or PIM role drift detected; elevated exposure to unauthorized privilege escalation.',
      critical: 'Critical identity gaps and active security alerts expose tenant to severe compromise risks.',
    },
  },
  {
    id: 'cost',
    label: 'Cost',
    iconKey: 'DollarSign',
    startAngleDeg: -18 + 0.8,
    endAngleDeg: 54 - 0.8,
    contributingPillars: [
      { group: 'Licensing', weight: 0.6 },
      { group: 'Compliance', weight: 0.4 },
    ],
    description: 'Translates SKU allocation efficiency, unassigned E5 seats, idle license accumulation, and regulatory fine risks into financial impact.',
    businessOutcomes: {
      stable: 'License spend is optimal; zero unassigned high-tier seats or regulatory penalty exposures.',
      elevated: 'Unassigned E5/Copilot seats detected; estimated $8,400/mo in optimizeable software waste.',
      critical: 'Severe license underutilization and non-compliance fines impacting operational margin.',
    },
  },
  {
    id: 'productivity',
    label: 'Productivity',
    iconKey: 'Zap',
    startAngleDeg: 54 + 0.8,
    endAngleDeg: 126 - 0.8,
    contributingPillars: [
      { group: 'Adoption', weight: 0.4 },
      { group: 'Copilot', weight: 0.4 },
      { group: 'Health', weight: 0.2 },
    ],
    description: 'Quantifies M365 app adoption, AI assist velocity, collaboration depth, and platform availability impact on output.',
    businessOutcomes: {
      stable: 'High M365 collaboration and Copilot usage driving maximum workforce throughput.',
      elevated: 'Copilot usage lagging target benchmarks; user enablement workflow recommended.',
      critical: 'Workload outages or tool adoption bottlenecks causing measurable productivity drop.',
    },
  },
  {
    id: 'compliance',
    label: 'Compliance',
    iconKey: 'Scale',
    startAngleDeg: 126 + 0.8,
    endAngleDeg: 198 - 0.8,
    contributingPillars: [
      { group: 'Compliance', weight: 0.4 },
      { group: 'Security', weight: 0.3 },
      { group: 'Governance', weight: 0.3 },
    ],
    description: 'Measures regulatory alignment (GDPR, HIPAA, ISO27001), DLP enforcement, retention policies, and audit readiness.',
    businessOutcomes: {
      stable: 'Full regulatory compliance across data loss prevention, audit logs, and access policies.',
      elevated: 'Unlabeled sensitive documents and unbacked retention rules present compliance gaps.',
      critical: 'Active DLP policy violations and unfulfilled regulatory requirements expose tenant to regulatory audit penalties.',
    },
  },
  {
    id: 'experience',
    label: 'Experience',
    iconKey: 'HeartPulse',
    startAngleDeg: 198 + 0.8,
    endAngleDeg: 270 - 0.8,
    contributingPillars: [
      { group: 'Adoption', weight: 0.5 },
      { group: 'Health', weight: 0.5 },
    ],
    description: 'Evaluates employee satisfaction, helpdesk ticket aging, endpoint latency, and M365 service friction.',
    businessOutcomes: {
      stable: 'Seamless user experience; low ticket resolution times and high digital satisfaction.',
      elevated: 'Elevated ticket aging in Outlook/Teams issues impacting employee sentiment.',
      critical: 'Service degradation and high ticket backlogs causing end-user friction and support overload.',
    },
  },
];

export const MapView: React.FC<MapViewProps> = ({
  tenants,
  selectedTenant,
  onSelectTenant,
  onDispatchWorkflow,
  onShowToast,
}) => {
  const activeTenant = selectedTenant || tenants[0] || {
    id: 'contoso-01',
    name: 'Contoso Corporation',
    primaryDomain: 'contosocorp.com',
    tenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47',
  };

  // Canvas Viewport Transformation State (2400px x 1500px virtual canvas)
  const CANVAS_WIDTH = 2400;
  const CANVAS_HEIGHT = 1500;

  const [zoom, setZoom] = useState<number>(0.7);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const mapCanvasRef = useRef<HTMLDivElement>(null);

  // Modal / Drawer States
  const [selectedNode, setSelectedNode] = useState<MapNode | null>(null);
  const [selectedPillarDrawer, setSelectedPillarDrawer] = useState<ClusterGroup | null>(null);
  const [selectedImpactSegment, setSelectedImpactSegment] = useState<string | null>(null);
  const [isImpactRingJsonModalOpen, setIsImpactRingJsonModalOpen] = useState<boolean>(false);
  const [isRingSimulatorOpen, setIsRingSimulatorOpen] = useState<boolean>(false);
  const [isJsonModalOpen, setIsJsonModalOpen] = useState<boolean>(false);
  const [isCmdKOpen, setIsCmdKOpen] = useState<boolean>(false);
  const [cmdKSearch, setCmdKSearch] = useState<string>('');
  const [copiedJson, setCopiedJson] = useState<boolean>(false);

  // Workflow Dispatch Modal State
  const [workflowModalAction, setWorkflowModalAction] = useState<M365ActionItem | null>(null);
  const [ticketIdInput, setTicketIdInput] = useState<string>('INC-2026-9941');
  const [reasoningInput, setReasoningInput] = useState<string>('Zero-trust remediation dispatched via M365 Map Intelligence Core.');
  const [targetUPNInput, setTargetUPNInput] = useState<string>('admin@contoso.com');
  const [isExecutingWorkflow, setIsExecutingWorkflow] = useState<boolean>(false);
  const [workflowSuccess, setWorkflowSuccess] = useState<boolean>(false);

  // Active filters
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<ClusterGroup | 'ALL'>('ALL');
  const [activeStatusFilter, setActiveStatusFilter] = useState<'ALL' | 'healthy' | 'drift' | 'alert'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // 1. RADIAL MAP TOPOLOGY REGISTRY (3 LAYERS)
  const initialNodes: MapNode[] = [
    // =========================================================================
    // LAYER 1: CENTER NODE (Tenant Intelligence Core)
    // =========================================================================
    {
      id: 'hub-core',
      label: 'Tenant Intelligence Core',
      category: 'Tenant & GDAP',
      clusterGroup: 'Health',
      isCoreNode: true,
      x: 1200,
      y: 750,
      status: 'healthy',
      healthScore: 98,
      activeAlerts: 0,
      endpointPath: '/v1.0/tenant/intelligence/core',
      endpointCount: 122,
      connectedTo: [],
      latencyHistory: [42, 45, 40, 48, 43, 41, 44, 42],
      drifts: [],
      colorHex: '#FFFFFF',
    },

    // =========================================================================
    // LAYER 2: PRIMARY PILLAR RING (7 PILLARS RADIALLY AROUND CORE AT R=380)
    // =========================================================================

    // PILLAR 1: SECURITY (#0078D4) - Top Sector
    {
      id: 'hub-security',
      label: 'Security Pillar',
      category: 'Security & Defender',
      clusterGroup: 'Security',
      isCategoryHub: true,
      x: 1200,
      y: 450,
      status: 'alert',
      healthScore: 74,
      activeAlerts: 3,
      endpointPath: '/v1.0/security/alerts_v2',
      endpointCount: 38,
      connectedTo: ['hub-core'],
      latencyHistory: [160, 175, 150, 190, 168, 182, 155, 170],
      drifts: [
        { id: 'd-s1', title: 'Impossible Travel Alert Detected on Admin UPN', severity: 'High', detectedAt: '4m ago' },
      ],
      colorHex: '#0078D4',
    },
    // SECURITY NODES (5)
    {
      id: 'node-sec-mfa',
      label: 'MFA Coverage',
      category: 'Auth & MFA',
      clusterGroup: 'Security',
      x: 1109,
      y: 177,
      status: 'healthy',
      healthScore: 96,
      activeAlerts: 0,
      endpointPath: '/v1.0/reports/credentialUserRegistrationDetails',
      endpointCount: 18,
      connectedTo: ['hub-security'],
      latencyHistory: [110, 105, 115, 108, 112, 109, 111, 107],
      drifts: [],
      colorHex: '#0078D4',
    },
    {
      id: 'node-sec-risks',
      label: 'Risky Sign-ins',
      category: 'Auth & MFA',
      clusterGroup: 'Security',
      x: 1200,
      y: 290,
      status: 'alert',
      healthScore: 68,
      activeAlerts: 2,
      endpointPath: '/v1.0/identityProtection/riskyUsers',
      endpointCount: 14,
      connectedTo: ['hub-security'],
      latencyHistory: [180, 195, 175, 210, 188, 192, 184, 189],
      drifts: [
        { id: 'd-s2', title: 'High Risk Sign-in from Tor Exit Node', severity: 'High', detectedAt: '12m ago' },
      ],
      colorHex: '#0078D4',
    },
    {
      id: 'node-sec-privdrift',
      label: 'Privileged Role Drift',
      category: 'PIM & Privileged Roles',
      clusterGroup: 'Security',
      x: 1291,
      y: 177,
      status: 'drift',
      healthScore: 82,
      activeAlerts: 1,
      endpointPath: '/v1.0/roleManagement/directory/roleAssignments',
      endpointCount: 22,
      connectedTo: ['hub-security'],
      latencyHistory: [130, 142, 125, 150, 138, 131, 129, 135],
      drifts: [
        { id: 'd-s3', title: 'Permanent Global Admin Assignment Created', severity: 'Medium', detectedAt: '1h ago' },
      ],
      colorHex: '#0078D4',
    },
    {
      id: 'node-sec-extaccess',
      label: 'External Access Risk',
      category: 'Auth & MFA',
      clusterGroup: 'Security',
      x: 1348,
      y: 293,
      status: 'drift',
      healthScore: 80,
      activeAlerts: 1,
      endpointPath: '/v1.0/identity/b2cUserFlows',
      endpointCount: 16,
      connectedTo: ['hub-security', 'hub-gov'], // Cross-link: Security + Governance
      latencyHistory: [145, 158, 140, 162, 150, 148, 142, 152],
      drifts: [
        { id: 'd-s4', title: 'Unrestricted Guest Access to Teams Shared Channels', severity: 'Medium', detectedAt: '3h ago' },
      ],
      colorHex: '#0078D4',
    },
    {
      id: 'node-sec-endpoint',
      label: 'Endpoint Compliance',
      category: 'Security & Defender',
      clusterGroup: 'Security',
      x: 1052,
      y: 293,
      status: 'healthy',
      healthScore: 92,
      activeAlerts: 0,
      endpointPath: '/v1.0/deviceManagement/managedDevices',
      endpointCount: 26,
      connectedTo: ['hub-security'],
      latencyHistory: [120, 125, 118, 130, 122, 124, 119, 121],
      drifts: [],
      colorHex: '#0078D4',
    },

    // PILLAR 2: GOVERNANCE (#6B4EFF) - Top-Right Sector
    {
      id: 'hub-gov',
      label: 'Governance Pillar',
      category: 'Tenant & GDAP',
      clusterGroup: 'Governance',
      isCategoryHub: true,
      x: 1435,
      y: 563,
      status: 'drift',
      healthScore: 81,
      activeAlerts: 1,
      endpointPath: '/v1.0/policies/directoryRoleAccessReviewPolicy',
      endpointCount: 29,
      connectedTo: ['hub-core'],
      latencyHistory: [120, 135, 118, 142, 128, 125, 122, 130],
      drifts: [
        { id: 'd-g1', title: 'Baseline Configuration Drift in Intune Policy', severity: 'Medium', detectedAt: '18m ago' },
      ],
      colorHex: '#6B4EFF',
    },
    // GOVERNANCE NODES (5)
    {
      id: 'node-gov-configdrift',
      label: 'Configuration Drift',
      category: 'Tenant & GDAP',
      clusterGroup: 'Governance',
      x: 1464,
      y: 349,
      status: 'drift',
      healthScore: 78,
      activeAlerts: 1,
      endpointPath: '/v1.0/deviceManagement/deviceConfigurations',
      endpointCount: 20,
      connectedTo: ['hub-gov'],
      latencyHistory: [135, 140, 130, 148, 138, 136, 132, 141],
      drifts: [
        { id: 'd-g2', title: 'BitLocker Enforcement Rule Overridden in Intune', severity: 'Medium', detectedAt: '45m ago' },
      ],
      colorHex: '#6B4EFF',
    },
    {
      id: 'node-gov-policy',
      label: 'Policy Compliance',
      category: 'Conditional Access',
      clusterGroup: 'Governance',
      x: 1591,
      y: 322,
      status: 'healthy',
      healthScore: 94,
      activeAlerts: 0,
      endpointPath: '/v1.0/identity/conditionalAccess/policies',
      endpointCount: 24,
      connectedTo: ['hub-gov'],
      latencyHistory: [105, 112, 108, 115, 110, 107, 109, 111],
      drifts: [],
      colorHex: '#6B4EFF',
    },
    {
      id: 'node-gov-change',
      label: 'Change Hygiene',
      category: 'Tenant & GDAP',
      clusterGroup: 'Governance',
      x: 1560,
      y: 463,
      status: 'healthy',
      healthScore: 91,
      activeAlerts: 0,
      endpointPath: '/v1.0/auditLogs/directoryAudits',
      endpointCount: 32,
      connectedTo: ['hub-gov'],
      latencyHistory: [125, 130, 120, 138, 126, 124, 122, 128],
      drifts: [],
      colorHex: '#6B4EFF',
    },
    {
      id: 'node-gov-baseline',
      label: 'Baseline Integrity',
      category: 'Tenant & GDAP',
      clusterGroup: 'Governance',
      x: 1704,
      y: 464,
      status: 'healthy',
      healthScore: 95,
      activeAlerts: 0,
      endpointPath: '/v1.0/security/secureScores',
      endpointCount: 15,
      connectedTo: ['hub-gov', 'hub-security'], // Cross-link: Governance + Security
      latencyHistory: [98, 102, 95, 108, 100, 99, 97, 101],
      drifts: [],
      colorHex: '#6B4EFF',
    },
    {
      id: 'node-gov-sharing',
      label: 'Sharing Governance',
      category: 'Exchange & Mailbox',
      clusterGroup: 'Governance',
      x: 1649,
      y: 581,
      status: 'drift',
      healthScore: 84,
      activeAlerts: 1,
      endpointPath: '/v1.0/sites/root/drive/sharedWithMe',
      endpointCount: 19,
      connectedTo: ['hub-gov'],
      latencyHistory: [140, 145, 138, 152, 142, 141, 139, 144],
      drifts: [
        { id: 'd-g3', title: 'Anonymous Link Sharing Enabled on Finance Site', severity: 'Low', detectedAt: '2h ago' },
      ],
      colorHex: '#6B4EFF',
    },

    // PILLAR 3: LICENSING (#009CA6) - Right Sector
    {
      id: 'hub-licensing',
      label: 'Licensing Pillar',
      category: 'Licensing & Billing',
      clusterGroup: 'Licensing',
      isCategoryHub: true,
      x: 1492,
      y: 817,
      status: 'healthy',
      healthScore: 90,
      activeAlerts: 0,
      endpointPath: '/v1.0/subscribedSkus',
      endpointCount: 21,
      connectedTo: ['hub-core'],
      latencyHistory: [88, 92, 85, 96, 90, 89, 87, 91],
      drifts: [],
      colorHex: '#009CA6',
    },
    // LICENSING NODES (5)
    {
      id: 'node-lic-util',
      label: 'License Utilization',
      category: 'Licensing & Billing',
      clusterGroup: 'Licensing',
      x: 1678,
      y: 707,
      status: 'healthy',
      healthScore: 98,
      activeAlerts: 0,
      endpointPath: '/v1.0/reports/getOffice365ActivationsUserDetail',
      endpointCount: 12,
      connectedTo: ['hub-licensing'],
      latencyHistory: [75, 80, 72, 85, 78, 76, 74, 79],
      drifts: [],
      colorHex: '#009CA6',
    },
    {
      id: 'node-lic-sku',
      label: 'SKU Alignment',
      category: 'Licensing & Billing',
      clusterGroup: 'Licensing',
      x: 1779,
      y: 789,
      status: 'healthy',
      healthScore: 94,
      activeAlerts: 0,
      endpointPath: '/v1.0/subscribedSkus',
      endpointCount: 10,
      connectedTo: ['hub-licensing'],
      latencyHistory: [82, 86, 80, 90, 84, 83, 81, 85],
      drifts: [],
      colorHex: '#009CA6',
    },
    {
      id: 'node-lic-idle',
      label: 'Idle Licenses',
      category: 'Licensing & Billing',
      clusterGroup: 'Licensing',
      x: 1648,
      y: 852,
      status: 'drift',
      healthScore: 82,
      activeAlerts: 1,
      endpointPath: '/v1.0/users?$select=id,userPrincipalName,signInActivity',
      endpointCount: 25,
      connectedTo: ['hub-licensing'],
      latencyHistory: [110, 118, 108, 125, 114, 112, 109, 116],
      drifts: [
        { id: 'd-l1', title: '14 Unassigned M365 E5 Licenses ($798/mo waste)', severity: 'Low', detectedAt: '3h ago' },
      ],
      colorHex: '#009CA6',
    },
    {
      id: 'node-lic-entitlement',
      label: 'Feature Entitlement',
      category: 'Licensing & Billing',
      clusterGroup: 'Licensing',
      x: 1738,
      y: 966,
      status: 'healthy',
      healthScore: 96,
      activeAlerts: 0,
      endpointPath: '/v1.0/organization/serviceMemberships',
      endpointCount: 14,
      connectedTo: ['hub-licensing'],
      latencyHistory: [90, 94, 88, 98, 92, 91, 89, 93],
      drifts: [],
      colorHex: '#009CA6',
    },
    {
      id: 'node-lic-compliance',
      label: 'Compliance Issues',
      category: 'Licensing & Billing',
      clusterGroup: 'Licensing',
      x: 1612,
      y: 996,
      status: 'healthy',
      healthScore: 92,
      activeAlerts: 0,
      endpointPath: '/v1.0/reports/getM365AppUserDetail',
      endpointCount: 16,
      connectedTo: ['hub-licensing'],
      latencyHistory: [95, 100, 92, 105, 98, 96, 94, 99],
      drifts: [],
      colorHex: '#009CA6',
    },

    // PILLAR 4: ADOPTION (#43A047) - Bottom-Right Sector
    {
      id: 'hub-adoption',
      label: 'Adoption Pillar',
      category: 'Tenant & GDAP',
      clusterGroup: 'Adoption',
      isCategoryHub: true,
      x: 1330,
      y: 1020,
      status: 'healthy',
      healthScore: 93,
      activeAlerts: 0,
      endpointPath: '/v1.0/reports/getOffice365ActiveUserDetail',
      endpointCount: 35,
      connectedTo: ['hub-core'],
      latencyHistory: [105, 112, 100, 120, 108, 106, 104, 110],
      drifts: [],
      colorHex: '#43A047',
    },
    // ADOPTION NODES (5)
    {
      id: 'node-adopt-usage',
      label: 'Active Usage',
      category: 'Tenant & GDAP',
      clusterGroup: 'Adoption',
      x: 1532,
      y: 1097,
      status: 'healthy',
      healthScore: 97,
      activeAlerts: 0,
      endpointPath: '/v1.0/reports/getTeamsUserActivityUserDetail',
      endpointCount: 18,
      connectedTo: ['hub-adoption'],
      latencyHistory: [92, 98, 90, 102, 95, 93, 91, 96],
      drifts: [],
      colorHex: '#43A047',
    },
    {
      id: 'node-adopt-workload',
      label: 'Workload Coverage',
      category: 'Tenant & GDAP',
      clusterGroup: 'Adoption',
      x: 1530,
      y: 1227,
      status: 'healthy',
      healthScore: 91,
      activeAlerts: 0,
      endpointPath: '/v1.0/reports/getSharePointActivityUserDetail',
      endpointCount: 15,
      connectedTo: ['hub-adoption'],
      latencyHistory: [100, 106, 98, 110, 102, 101, 99, 104],
      drifts: [],
      colorHex: '#43A047',
    },
    {
      id: 'node-adopt-collab',
      label: 'Collaboration Depth',
      category: 'Tenant & GDAP',
      clusterGroup: 'Adoption',
      x: 1400,
      y: 1164,
      status: 'healthy',
      healthScore: 94,
      activeAlerts: 0,
      endpointPath: '/v1.0/reports/getEmailAppUsageUserDetail',
      endpointCount: 20,
      connectedTo: ['hub-adoption'],
      latencyHistory: [88, 92, 85, 96, 90, 89, 87, 91],
      drifts: [],
      colorHex: '#43A047',
    },
    {
      id: 'node-adopt-feat',
      label: 'Feature Utilization',
      category: 'Tenant & GDAP',
      clusterGroup: 'Adoption',
      x: 1367,
      y: 1305,
      status: 'healthy',
      healthScore: 89,
      activeAlerts: 0,
      endpointPath: '/v1.0/reports/getOneDriveUsageAccountDetail',
      endpointCount: 14,
      connectedTo: ['hub-adoption', 'hub-licensing'], // Cross-link: Adoption + Licensing
      latencyHistory: [110, 116, 108, 122, 112, 111, 109, 114],
      drifts: [],
      colorHex: '#43A047',
    },
    {
      id: 'node-adopt-trend',
      label: 'Adoption Trend',
      category: 'Tenant & GDAP',
      clusterGroup: 'Adoption',
      x: 1264,
      y: 1226,
      status: 'healthy',
      healthScore: 95,
      activeAlerts: 0,
      endpointPath: '/v1.0/reports/getOffice365ServicesUserCounts',
      endpointCount: 22,
      connectedTo: ['hub-adoption'],
      latencyHistory: [85, 90, 82, 94, 87, 86, 84, 88],
      drifts: [],
      colorHex: '#43A047',
    },

    // PILLAR 5: COPILOT (#00B7C3) - Bottom-Left Sector
    {
      id: 'hub-copilot',
      label: 'Copilot Pillar',
      category: 'Tenant & GDAP',
      clusterGroup: 'Copilot',
      isCategoryHub: true,
      x: 1070,
      y: 1020,
      status: 'healthy',
      healthScore: 88,
      activeAlerts: 0,
      endpointPath: '/v1.0/reports/getCopilotUsageUserDetail',
      endpointCount: 19,
      connectedTo: ['hub-core'],
      latencyHistory: [115, 122, 110, 130, 118, 116, 114, 120],
      drifts: [],
      colorHex: '#00B7C3',
    },
    // COPILOT NODES (5)
    {
      id: 'node-copilot-lic',
      label: 'License Coverage',
      category: 'Licensing & Billing',
      clusterGroup: 'Copilot',
      x: 1136,
      y: 1226,
      status: 'healthy',
      healthScore: 92,
      activeAlerts: 0,
      endpointPath: '/v1.0/reports/getCopilotLicensingDetail',
      endpointCount: 12,
      connectedTo: ['hub-copilot'],
      latencyHistory: [100, 105, 98, 110, 102, 101, 99, 103],
      drifts: [],
      colorHex: '#00B7C3',
    },
    {
      id: 'node-copilot-usage',
      label: 'Active Usage',
      category: 'Tenant & GDAP',
      clusterGroup: 'Copilot',
      x: 1033,
      y: 1305,
      status: 'healthy',
      healthScore: 86,
      activeAlerts: 0,
      endpointPath: '/v1.0/reports/getCopilotActivityUserDetail',
      endpointCount: 16,
      connectedTo: ['hub-copilot'],
      latencyHistory: [125, 132, 120, 140, 128, 126, 124, 130],
      drifts: [],
      colorHex: '#00B7C3',
    },
    {
      id: 'node-copilot-mix',
      label: 'Feature Mix',
      category: 'Tenant & GDAP',
      clusterGroup: 'Copilot',
      x: 1000,
      y: 1164,
      status: 'healthy',
      healthScore: 90,
      activeAlerts: 0,
      endpointPath: '/v1.0/reports/getCopilotAppUsageDetail',
      endpointCount: 14,
      connectedTo: ['hub-copilot'],
      latencyHistory: [110, 115, 108, 120, 112, 111, 109, 114],
      drifts: [],
      colorHex: '#00B7C3',
    },
    {
      id: 'node-copilot-prod',
      label: 'Productivity Signals',
      category: 'Tenant & GDAP',
      clusterGroup: 'Copilot',
      x: 870,
      y: 1227,
      status: 'healthy',
      healthScore: 94,
      activeAlerts: 0,
      endpointPath: '/v1.0/reports/getWorkplaceAnalyticsCopilot',
      endpointCount: 22,
      connectedTo: ['hub-copilot'],
      latencyHistory: [95, 100, 92, 106, 98, 96, 94, 99],
      drifts: [],
      colorHex: '#00B7C3',
    },
    {
      id: 'node-copilot-safety',
      label: 'Safety & Governance',
      category: 'Security & Defender',
      clusterGroup: 'Copilot',
      x: 868,
      y: 1097,
      status: 'drift',
      healthScore: 80,
      activeAlerts: 1,
      endpointPath: '/v1.0/informationProtection/copilot/sensitivityEvaluations',
      endpointCount: 18,
      connectedTo: ['hub-copilot'],
      latencyHistory: [140, 148, 135, 155, 142, 140, 138, 145],
      drifts: [
        { id: 'd-cp1', title: 'Over-shared Document Prompted via Copilot Chat', severity: 'Medium', detectedAt: '50m ago' },
      ],
      colorHex: '#00B7C3',
    },

    // PILLAR 6: COMPLIANCE (#5A2D91) - Left Sector
    {
      id: 'hub-compliance',
      label: 'Compliance Pillar',
      category: 'Security & Defender',
      clusterGroup: 'Compliance',
      isCategoryHub: true,
      x: 908,
      y: 817,
      status: 'drift',
      healthScore: 84,
      activeAlerts: 1,
      endpointPath: '/v1.0/security/ediscovery/cases',
      endpointCount: 26,
      connectedTo: ['hub-core'],
      latencyHistory: [140, 155, 138, 168, 145, 150, 142, 148],
      drifts: [
        { id: 'd-c1', title: 'Retention Policy Scope Excluded Finance Mailbox', severity: 'Medium', detectedAt: '1h ago' },
      ],
      colorHex: '#5A2D91',
    },
    // COMPLIANCE NODES (5)
    {
      id: 'node-comp-retention',
      label: 'Retention Coverage',
      category: 'Security & Defender',
      clusterGroup: 'Compliance',
      x: 788,
      y: 996,
      status: 'healthy',
      healthScore: 92,
      activeAlerts: 0,
      endpointPath: '/v1.0/security/retentionEvents',
      endpointCount: 15,
      connectedTo: ['hub-compliance'],
      latencyHistory: [115, 120, 112, 126, 118, 116, 114, 119],
      drifts: [],
      colorHex: '#5A2D91',
    },
    {
      id: 'node-comp-labels',
      label: 'Sensitivity Labels',
      category: 'Security & Defender',
      clusterGroup: 'Compliance',
      x: 662,
      y: 966,
      status: 'drift',
      healthScore: 82,
      activeAlerts: 1,
      endpointPath: '/v1.0/informationProtection/policy/labels',
      endpointCount: 20,
      connectedTo: ['hub-compliance', 'hub-copilot'], // Cross-link: Compliance + Copilot
      latencyHistory: [130, 138, 125, 145, 132, 130, 128, 135],
      drifts: [
        { id: 'd-c2', title: '240 Finance Files Unlabeled in Sharepoint Root', severity: 'Medium', detectedAt: '2h ago' },
      ],
      colorHex: '#5A2D91',
    },
    {
      id: 'node-comp-dlp',
      label: 'DLP Enforcement',
      category: 'Security & Defender',
      clusterGroup: 'Compliance',
      x: 752,
      y: 852,
      status: 'healthy',
      healthScore: 94,
      activeAlerts: 0,
      endpointPath: '/v1.0/security/informationProtection/dlpPolicies',
      endpointCount: 28,
      connectedTo: ['hub-compliance'],
      latencyHistory: [105, 110, 102, 116, 108, 106, 104, 109],
      drifts: [],
      colorHex: '#5A2D91',
    },
    {
      id: 'node-comp-regulatory',
      label: 'Regulatory Alignment',
      category: 'Security & Defender',
      clusterGroup: 'Compliance',
      x: 621,
      y: 789,
      status: 'healthy',
      healthScore: 96,
      activeAlerts: 0,
      endpointPath: '/v1.0/compliance/assessmentResults',
      endpointCount: 30,
      connectedTo: ['hub-compliance'],
      latencyHistory: [90, 95, 88, 100, 92, 91, 89, 94],
      drifts: [],
      colorHex: '#5A2D91',
    },
    {
      id: 'node-comp-audit',
      label: 'Audit Readiness',
      category: 'Tenant & GDAP',
      clusterGroup: 'Compliance',
      x: 722,
      y: 707,
      status: 'healthy',
      healthScore: 98,
      activeAlerts: 0,
      endpointPath: '/v1.0/security/auditLogRetentionPolicies',
      endpointCount: 24,
      connectedTo: ['hub-compliance'],
      latencyHistory: [85, 90, 82, 94, 87, 86, 84, 88],
      drifts: [],
      colorHex: '#5A2D91',
    },

    // PILLAR 7: HEALTH (#F7630C) - Top-Left Sector
    {
      id: 'hub-health',
      label: 'Health Pillar',
      category: 'Tenant & GDAP',
      clusterGroup: 'Health',
      isCategoryHub: true,
      x: 965,
      y: 563,
      status: 'healthy',
      healthScore: 95,
      activeAlerts: 0,
      endpointPath: '/v1.0/admin/serviceAnnouncement/healthOverviews',
      endpointCount: 34,
      connectedTo: ['hub-core'],
      latencyHistory: [90, 85, 92, 88, 91, 87, 89, 93],
      drifts: [],
      colorHex: '#F7630C',
    },
    // HEALTH NODES (5)
    {
      id: 'node-health-ticket',
      label: 'Ticket Aging',
      category: 'Tenant & GDAP',
      clusterGroup: 'Health',
      x: 751,
      y: 581,
      status: 'healthy',
      healthScore: 92,
      activeAlerts: 0,
      endpointPath: '/v1.0/admin/serviceAnnouncement/issues',
      endpointCount: 16,
      connectedTo: ['hub-health'],
      latencyHistory: [95, 100, 92, 105, 98, 96, 94, 99],
      drifts: [],
      colorHex: '#F7630C',
    },
    {
      id: 'node-health-auto',
      label: 'Automation Success',
      category: 'Tenant & GDAP',
      clusterGroup: 'Health',
      x: 696,
      y: 464,
      status: 'healthy',
      healthScore: 98,
      activeAlerts: 0,
      endpointPath: '/v1.0/automation/runbooks/telemetry',
      endpointCount: 28,
      connectedTo: ['hub-health', 'hub-gov'], // Cross-link: Health + Governance
      latencyHistory: [80, 84, 78, 88, 82, 81, 79, 83],
      drifts: [],
      colorHex: '#F7630C',
    },
    {
      id: 'node-health-backup',
      label: 'Backup/Restore Health',
      category: 'Tenant & GDAP',
      clusterGroup: 'Health',
      x: 840,
      y: 463,
      status: 'healthy',
      healthScore: 97,
      activeAlerts: 0,
      endpointPath: '/v1.0/backupRestore/pointInTimeRestores',
      endpointCount: 22,
      connectedTo: ['hub-health'],
      latencyHistory: [88, 92, 85, 95, 89, 88, 86, 90],
      drifts: [],
      colorHex: '#F7630C',
    },
    {
      id: 'node-health-sla',
      label: 'SLA Compliance',
      category: 'Tenant & GDAP',
      clusterGroup: 'Health',
      x: 809,
      y: 322,
      status: 'healthy',
      healthScore: 99,
      activeAlerts: 0,
      endpointPath: '/v1.0/reports/getSlaComplianceOverviews',
      endpointCount: 18,
      connectedTo: ['hub-health'],
      latencyHistory: [70, 75, 68, 80, 72, 71, 69, 73],
      drifts: [],
      colorHex: '#F7630C',
    },
    {
      id: 'node-health-recurrence',
      label: 'Incident Recurrence',
      category: 'Tenant & GDAP',
      clusterGroup: 'Health',
      x: 936,
      y: 349,
      status: 'healthy',
      healthScore: 94,
      activeAlerts: 0,
      endpointPath: '/v1.0/admin/serviceAnnouncement/history',
      endpointCount: 25,
      connectedTo: ['hub-health'],
      latencyHistory: [92, 96, 90, 100, 94, 93, 91, 95],
      drifts: [],
      colorHex: '#F7630C',
    },
  ];

  const [nodes, setNodes] = useState<MapNode[]>(initialNodes);

  // Business Impact Ring Simulator - Updates health scores across nodes in a pillar
  const handleUpdatePillarScore = (pillar: ClusterGroup, targetScore: number) => {
    setNodes((prevNodes) =>
      prevNodes.map((n) => {
        if (n.clusterGroup === pillar && !n.isCoreNode) {
          return {
            ...n,
            healthScore: targetScore,
            status: targetScore < 50 ? 'drift' : targetScore < 80 ? 'alert' : 'healthy',
          };
        }
        return n;
      })
    );
  };

  const handleApplyScenario = (preset: 'breach' | 'waste' | 'stagnation' | 'degraded' | 'optimal') => {
    if (preset === 'breach') {
      handleUpdatePillarScore('Security', 20);
      handleUpdatePillarScore('Governance', 35);
      handleUpdatePillarScore('Compliance', 40);
    } else if (preset === 'waste') {
      handleUpdatePillarScore('Licensing', 25);
      handleUpdatePillarScore('Governance', 50);
    } else if (preset === 'stagnation') {
      handleUpdatePillarScore('Adoption', 30);
      handleUpdatePillarScore('Copilot', 25);
    } else if (preset === 'degraded') {
      handleUpdatePillarScore('Health', 35);
      handleUpdatePillarScore('Security', 45);
      handleUpdatePillarScore('Licensing', 40);
    } else if (preset === 'optimal') {
      (['Security', 'Governance', 'Licensing', 'Adoption', 'Copilot', 'Compliance', 'Health'] as ClusterGroup[]).forEach((group) => {
        handleUpdatePillarScore(group, 98);
      });
    }
  };

  // Calculate average health scores for each of the 7 pillars
  const pillarScores = useMemo(() => {
    const scores: Record<ClusterGroup, number> = {
      Security: 0,
      Governance: 0,
      Licensing: 0,
      Adoption: 0,
      Copilot: 0,
      Compliance: 0,
      Health: 0,
    };

    (Object.keys(scores) as ClusterGroup[]).forEach((group) => {
      const groupNodes = nodes.filter((n) => n.clusterGroup === group && !n.isCoreNode);
      if (groupNodes.length === 0) {
        scores[group] = 90;
      } else {
        const sum = groupNodes.reduce((acc, n) => acc + n.healthScore, 0);
        scores[group] = Math.round(sum / groupNodes.length);
      }
    });

    return scores;
  }, [nodes]);

  // Dynamic Impact Calculations for the 5 Business Impact Ring Segments
  const impactRingSegmentsCalculated = useMemo(() => {
    return BUSINESS_IMPACT_SEGMENTS.map((seg) => {
      // Weighted average of contributing pillar health scores
      let weightedPillarScoreSum = 0;
      let totalWeight = 0;

      seg.contributingPillars.forEach(({ group, weight }) => {
        const pillarScore = pillarScores[group] ?? 85;
        weightedPillarScoreSum += pillarScore * weight;
        totalWeight += weight;
      });

      const weightedPillarScore = totalWeight > 0 ? Math.round(weightedPillarScoreSum / totalWeight) : 85;
      const impactScore = Math.max(0, Math.min(100, 100 - weightedPillarScore));

      // Severity classification
      let severity: 'stable' | 'elevated' | 'critical' = 'stable';
      if (impactScore > 30) {
        severity = 'critical';
      } else if (impactScore > 15) {
        severity = 'elevated';
      }

      // Dynamic visual properties (Thickness, Opacity, Glow, Colors)
      const rInner = 685;
      const rOuterBase = 765;
      const thicknessDelta = Math.round((impactScore / 100) * 18); // expands up to +18px
      const rOuter = rOuterBase + thicknessDelta;

      let colorHex = '#10B981'; // Vibrant Emerald Green when Good / Stable
      let glowColor = 'rgba(16, 185, 129, 0.35)';
      let glowPx = 6;
      let fillOpacity = 0.35;
      let strokeOpacity = 0.65;

      if (severity === 'critical') {
        colorHex = '#D13438'; // Fluent Crimson
        glowColor = 'rgba(209, 52, 56, 0.6)';
        glowPx = 16;
        fillOpacity = 0.78;
        strokeOpacity = 0.95;
      } else if (severity === 'elevated') {
        colorHex = '#D97706'; // Fluent Amber
        glowColor = 'rgba(217, 119, 6, 0.45)';
        glowPx = 8;
        fillOpacity = 0.48;
        strokeOpacity = 0.75;
      } else {
        colorHex = '#10B981'; // Emerald Green for Good / Stable State
        glowColor = 'rgba(16, 185, 129, 0.35)';
        glowPx = 6;
        fillOpacity = 0.35;
        strokeOpacity = 0.65;
      }

      const outcomeText = seg.businessOutcomes[severity];

      return {
        ...seg,
        weightedPillarScore,
        impactScore,
        severity,
        rInner,
        rOuter,
        thicknessDelta,
        colorHex,
        glowColor,
        glowPx,
        fillOpacity,
        strokeOpacity,
        outcomeText,
      };
    });
  }, [pillarScores]);

  // Simulated live telemetry stream
  const [telemetryLogs, setTelemetryLogs] = useState<TelemetryLog[]>([
    {
      id: 'log-1',
      timestamp: '2026-07-23T20:53:10.112Z',
      method: 'GET',
      endpoint: '/v1.0/tenant/intelligence/core',
      statusCode: 200,
      latencyMs: 42,
      nodeId: 'hub-core',
      statusText: '200 OK (Core Signals Weighted)',
    },
    {
      id: 'log-2',
      timestamp: '2026-07-23T20:53:08.405Z',
      method: 'GET',
      endpoint: '/v1.0/security/alerts_v2',
      statusCode: 200,
      latencyMs: 165,
      nodeId: 'hub-security',
      statusText: '200 OK (3 Active Security Alerts)',
    },
  ]);

  // Handle Zoom controls
  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.15, 1.6));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.15, 0.45));
  const handleResetCanvas = () => {
    setZoom(0.7);
    setPan({ x: 0, y: 0 });
  };

  // Mouse drag panning logic
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    setIsPanning(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => setIsPanning(false);

  // Filter nodes based on state
  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      const matchesCategory =
        activeCategoryFilter === 'ALL' || node.clusterGroup === activeCategoryFilter;
      const matchesStatus =
        activeStatusFilter === 'ALL' || node.status === activeStatusFilter;
      const matchesSearch =
        !searchQuery ||
        node.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.endpointPath.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesCategory && matchesStatus && matchesSearch;
    });
  }, [nodes, activeCategoryFilter, activeStatusFilter, searchQuery]);

  // Overall Tenant Intelligence Score calculation
  const aggregateScore = useMemo(() => {
    const sum = nodes.reduce((acc, n) => acc + n.healthScore, 0);
    return (sum / nodes.length).toFixed(1);
  }, [nodes]);

  // Execute Workflow Action Confirmation
  const handleConfirmWorkflowExecute = () => {
    if (!workflowModalAction) return;
    setIsExecutingWorkflow(true);

    setTimeout(() => {
      setIsExecutingWorkflow(false);
      setWorkflowSuccess(true);

      if (onShowToast) {
        onShowToast(
          'success',
          `Workflow Dispatched: ${workflowModalAction.name}`,
          `Ticket ${ticketIdInput} associated. Payload dispatched via Graph API for ${targetUPNInput}.`
        );
      }

      if (onDispatchWorkflow) {
        onDispatchWorkflow(workflowModalAction.id, {
          ticketId: ticketIdInput,
          reasoning: reasoningInput,
          targetUPN: targetUPNInput,
        });
      }

      setTimeout(() => {
        setWorkflowModalAction(null);
        setWorkflowSuccess(false);
      }, 1000);
    }, 1200);
  };

  const handleOpenWorkflowModal = (action: M365ActionItem) => {
    setWorkflowModalAction(action);
    setTicketIdInput(`INC-2026-${Math.floor(1000 + Math.random() * 9000)}`);
  };

  // Structured JSON Architecture Export Data
  const mapArchitectureJson = useMemo(() => {
    return {
      mapMetadata: {
        mapName: 'M365 Radial Tenant Intelligence Map',
        version: '3.5.0-ENTERPRISE',
        tenantContext: {
          id: activeTenant.id,
          name: activeTenant.name,
          domain: activeTenant.primaryDomain,
          tenantGuid: activeTenant.tenantId,
        },
        generatedAt: new Date().toISOString(),
        overallTenantScore: aggregateScore,
      },
      layer1_core: {
        id: 'hub-core',
        name: 'Tenant Intelligence Core',
        colorHex: '#FFFFFF',
        purpose: 'Central processing layer that receives signals from all 7 pillars, normalizes, weights, and interprets them.',
        inputSignalsPolled: 122,
        coreHealthStatus: 'Healthy',
      },
      layer2_pillars: [
        { name: 'Security', colorHex: '#0078D4', score: 74, primaryNodeCount: 5 },
        { name: 'Governance', colorHex: '#6B4EFF', score: 81, primaryNodeCount: 5 },
        { name: 'Licensing', colorHex: '#009CA6', score: 90, primaryNodeCount: 5 },
        { name: 'Adoption', colorHex: '#43A047', score: 93, primaryNodeCount: 5 },
        { name: 'Copilot', colorHex: '#00B7C3', score: 88, primaryNodeCount: 5 },
        { name: 'Compliance', colorHex: '#5A2D91', score: 84, primaryNodeCount: 5 },
        { name: 'Health', colorHex: '#F7630C', score: 95, primaryNodeCount: 5 },
      ],
      layer3_business_impact_ring: [
        { dimension: 'Risk', weight: 0.25, colorHex: '#C8C8C8' },
        { dimension: 'Cost', weight: 0.20, colorHex: '#C8C8C8' },
        { dimension: 'Productivity', weight: 0.20, colorHex: '#C8C8C8' },
        { dimension: 'Compliance', weight: 0.20, colorHex: '#C8C8C8' },
        { dimension: 'Experience', weight: 0.15, colorHex: '#C8C8C8' },
      ],
      crossPillarConnectors: [
        { source: 'External Access Risk', targets: ['Security', 'Governance'], type: 'Cross-Domain Signal' },
        { source: 'Sensitivity Labels', targets: ['Compliance', 'Copilot'], type: 'Cross-Domain Signal' },
        { source: 'Automation Success', targets: ['Health', 'Governance'], type: 'Cross-Domain Signal' },
        { source: 'Feature Utilization', targets: ['Adoption', 'Licensing'], type: 'Cross-Domain Signal' },
        { source: 'Baseline Integrity', targets: ['Governance', 'Security'], type: 'Cross-Domain Signal' },
      ],
      primaryNodesTopology: nodes.map((n) => ({
        id: n.id,
        label: n.label,
        pillar: n.clusterGroup,
        isHub: !!n.isCategoryHub,
        isCore: !!n.isCoreNode,
        status: n.status,
        healthScore: n.healthScore,
        activeAlerts: n.activeAlerts,
        endpointPath: n.endpointPath,
        colorHex: n.colorHex,
        connectedTo: n.connectedTo,
      })),
    };
  }, [nodes, activeTenant, aggregateScore]);

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(mapArchitectureJson, null, 2));
    setCopiedJson(true);
    if (onShowToast) {
      onShowToast('success', 'JSON Architecture Copied', 'Map architecture JSON copied to clipboard.');
    }
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const getPillarColor = (pillar: ClusterGroup) => {
    switch (pillar) {
      case 'Security':
        return '#0078D4';
      case 'Governance':
        return '#6B4EFF';
      case 'Licensing':
        return '#009CA6';
      case 'Adoption':
        return '#43A047';
      case 'Copilot':
        return '#00B7C3';
      case 'Compliance':
        return '#5A2D91';
      case 'Health':
        return '#F7630C';
      default:
        return '#3b82f6';
    }
  };

  const getDomainIcon = (category: M365DomainCategory, className = 'w-4 h-4') => {
    switch (category) {
      case 'Auth & MFA':
        return <KeyRound className={className} />;
      case 'Conditional Access':
        return <Lock className={className} />;
      case 'Exchange & Mailbox':
        return <Mail className={className} />;
      case 'Licensing & Billing':
        return <DollarSign className={className} />;
      case 'PIM & Privileged Roles':
        return <Crown className={className} />;
      case 'Security & Defender':
        return <Shield className={className} />;
      case 'Tenant & GDAP':
        return <Building2 className={className} />;
      default:
        return <Layers className={className} />;
    }
  };

  const renderSafetyBadge = (level: SafetyLevel) => {
    if (level === 'safe') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
          <ShieldCheck className="w-3 h-3 text-emerald-400" />
          Safe (L1)
        </span>
      );
    }
    if (level === 'gated') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
          <Lock className="w-3 h-3 text-amber-400" />
          Gated (L2)
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-red-500/20 text-red-300 border border-red-500/30 flex items-center gap-1">
        <ShieldAlert className="w-3 h-3 text-red-400" />
        Blocked (L3)
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden select-none font-sans relative">
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & MAP CONTROLS BAR */}
      {/* ========================================================================= */}
      <header className="bg-slate-900 border-b border-slate-800 px-3 sm:px-4 py-2 sm:py-2.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5 shrink-0 shadow-md z-20">
        {/* Left Title & Tenant Switcher */}
        <div className="flex items-center justify-between w-full md:w-auto gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 shadow-inner shrink-0">
              <Compass className="w-4 h-4 animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xs sm:text-sm font-extrabold text-white tracking-tight flex items-center gap-1.5">
                  <span>Tenant Intelligence Map</span>
                  <span className="text-[9px] sm:text-[10px] font-mono px-1.5 sm:px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    7 Pillars • 35 Nodes
                  </span>
                </h1>
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-400 flex items-center gap-1 font-mono truncate max-w-[200px] sm:max-w-none">
                <Building2 className="w-3 h-3 text-slate-500 shrink-0" />
                <span className="truncate">{activeTenant.name}</span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-400 hidden xs:inline">{activeTenant.primaryDomain}</span>
              </p>
            </div>
          </div>

          {/* Aggregate Intelligence Score Badge on Mobile */}
          <div className="md:hidden bg-slate-950 border border-emerald-500/40 rounded-xl px-2.5 py-1 flex items-center gap-1.5 shrink-0">
            <div className="text-right">
              <div className="text-[8px] text-slate-400 font-mono uppercase tracking-wider">Score</div>
              <div className="text-xs font-black text-emerald-400 font-mono leading-none">{aggregateScore}</div>
            </div>
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          </div>
        </div>

        {/* Center Category Pillar Filter Buttons (Scrollable on Mobile) */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs overflow-x-auto w-full md:w-auto shrink-0 max-w-full">
          <button
            onClick={() => setActiveCategoryFilter('ALL')}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all shrink-0 text-xs ${
              activeCategoryFilter === 'ALL'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Pillars
          </button>
          {(['Security', 'Governance', 'Licensing', 'Adoption', 'Copilot', 'Compliance', 'Health'] as ClusterGroup[]).map(
            (p) => (
              <button
                key={p}
                onClick={() => setActiveCategoryFilter(p)}
                className={`px-2 py-1 rounded-lg font-medium transition-all flex items-center gap-1 text-[10px] sm:text-[11px] shrink-0 ${
                  activeCategoryFilter === p
                    ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span
                  className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full"
                  style={{ backgroundColor: getPillarColor(p) }}
                />
                {p}
              </button>
            )
          )}
        </div>

        {/* Right Search & Action Palette */}
        <div className="hidden md:flex items-center gap-2">
          {/* Quick Cmd+K Button */}
          <button
            onClick={() => setIsCmdKOpen(true)}
            className="bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs px-3 py-1.5 rounded-xl flex items-center gap-2 font-mono shadow-inner transition-colors"
          >
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <span>Search Actions</span>
            <kbd className="bg-slate-800 text-slate-400 text-[10px] px-1.5 py-0.5 rounded font-sans border border-slate-700">
              ⌘K
            </kbd>
          </button>

          {/* Export JSON Modal Trigger */}
          <button
            onClick={() => setIsJsonModalOpen(true)}
            className="bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 text-xs px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <FileJson className="w-3.5 h-3.5 text-indigo-400" />
            <span>Export JSON</span>
          </button>

          {/* Test Business Impact Ring Simulator Trigger */}
          <button
            onClick={() => setIsRingSimulatorOpen(true)}
            className="bg-gradient-to-r from-purple-600/30 to-blue-600/30 hover:from-purple-600/50 hover:to-blue-600/50 text-amber-300 border border-purple-500/40 text-xs px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
          >
            <Zap className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <span>Test Ring Impact</span>
          </button>

          {/* Aggregate Intelligence Score Badge */}
          <div className="bg-slate-900 border border-emerald-500/40 rounded-xl px-3 py-1 flex items-center gap-2 shadow-sm">
            <div className="text-right">
              <div className="text-[9px] text-slate-400 font-mono uppercase tracking-wider">
                Tenant Score
              </div>
              <div className="text-xs font-black text-emerald-400 font-mono leading-none">
                {aggregateScore} / 100
              </div>
            </div>
            <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
          </div>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. MAIN MAP CANVAS AREA */}
      {/* ========================================================================= */}
      <div className="flex-1 relative overflow-hidden bg-slate-950">
        {/* Floating Canvas Controls Overlay */}
        <div className="absolute top-4 right-4 z-20 flex flex-col gap-1.5 bg-slate-900/90 border border-slate-800 p-1.5 rounded-2xl shadow-xl backdrop-blur-md">
          <button
            onClick={handleZoomIn}
            title="Zoom In (+)"
            className="p-2 hover:bg-slate-800 rounded-xl text-slate-300 hover:text-white transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomOut}
            title="Zoom Out (-)"
            className="p-2 hover:bg-slate-800 rounded-xl text-slate-300 hover:text-white transition-colors"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={handleResetCanvas}
            title="Reset Pan & Zoom"
            className="p-2 hover:bg-slate-800 rounded-xl text-slate-300 hover:text-white transition-colors border-t border-slate-800"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsImpactRingJsonModalOpen(true)}
            title="View Business Impact Ring JSON Schema"
            className="p-2 hover:bg-slate-800 rounded-xl text-sky-400 hover:text-sky-300 transition-colors border-t border-slate-800"
          >
            <FileJson className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsRingSimulatorOpen(true)}
            title="Test Business Impact Ring Simulator"
            className="p-2 bg-gradient-to-r from-purple-600/30 to-blue-600/30 hover:from-purple-600/50 hover:to-blue-600/50 text-amber-300 hover:text-amber-200 transition-colors border-t border-purple-500/40 rounded-xl flex items-center justify-center"
          >
            <Gauge className="w-4 h-4 text-purple-400 animate-pulse" />
          </button>
        </div>

        {/* Floating Map Legend */}
        <div className="absolute top-4 left-4 z-20 bg-slate-900/90 border border-slate-800/80 p-3 rounded-2xl shadow-xl backdrop-blur-md text-xs space-y-2 max-w-xs pointer-events-auto">
          <div className="font-bold text-white flex items-center justify-between text-[11px] border-b border-slate-800 pb-1.5">
            <span className="flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-blue-400" />
              <span>Map Legend & Architecture</span>
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Radial</span>
          </div>

          <div className="space-y-1 text-[10.5px]">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-white border border-slate-300 shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
              <span className="font-semibold text-white">Layer 1: Tenant Intelligence Core</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-blue-500 border border-blue-400 shadow-[0_0_6px_rgba(59,130,246,0.5)]" />
              <span className="text-slate-300">Layer 2: 7 Primary Pillar Hubs</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-slate-700 border border-slate-400" />
              <span className="text-slate-400">Layer 3: Business Impact Ring (Soft Gray)</span>
            </div>
          </div>

          <div className="pt-1 border-t border-slate-800/80 grid grid-cols-2 gap-1 text-[10px] font-mono">
            <div className="flex items-center gap-1 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400" /> Healthy (90+)
            </div>
            <div className="flex items-center gap-1 text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" /> Drift (75-89)
            </div>
            <div className="flex items-center gap-1 text-red-400 col-span-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" /> Critical Risk (&lt;75)
            </div>
          </div>

          <button
            onClick={() => setIsRingSimulatorOpen(true)}
            className="w-full mt-2 py-1.5 px-2.5 bg-gradient-to-r from-purple-900/60 to-blue-900/60 hover:from-purple-800/80 hover:to-blue-800/80 border border-purple-500/40 rounded-xl text-purple-200 hover:text-white text-[10.5px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
          >
            <Gauge className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
            <span>Test Ring Impact Simulator</span>
          </button>
        </div>

        {/* Virtual Canvas Container with Pan & Zoom Transform */}
        <div
          ref={mapCanvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className={`w-full h-full cursor-grab active:cursor-grabbing select-none relative transition-transform duration-75 ease-out ${
            isPanning ? 'cursor-grabbing' : ''
          }`}
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)`,
            backgroundSize: '32px 32px',
          }}
        >
          <div
            className="absolute left-1/2 top-1/2 origin-center transition-transform duration-75"
            style={{
              width: `${CANVAS_WIDTH}px`,
              height: `${CANVAS_HEIGHT}px`,
              transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            {/* ========================================================================= */}
            {/* LAYER 3: BUSINESS IMPACT RING (OUTER RING) */}
            {/* ========================================================================= */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              {/* Outer Vibrant Green Circle Ring */}
              <div className="w-[1360px] h-[1360px] rounded-full border-2 border-dashed border-emerald-500/30 shadow-[0_0_80px_rgba(16,185,129,0.06)] flex items-center justify-center relative">
                {/* Ring Dimension Badges */}
                <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-slate-900 border border-emerald-500/40 px-3 py-1 rounded-full text-[11px] font-bold font-mono text-emerald-300 shadow-md flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                  <span>Business Impact: RISK</span>
                </div>

                <div className="absolute right-2 top-1/2 -translate-y-1/2 bg-slate-900 border border-emerald-500/40 px-3 py-1 rounded-full text-[11px] font-bold font-mono text-emerald-300 shadow-md flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Business Impact: COST</span>
                </div>

                <div className="absolute bottom-6 right-1/4 bg-slate-900 border border-emerald-500/40 px-3 py-1 rounded-full text-[11px] font-bold font-mono text-emerald-300 shadow-md flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                  <span>Business Impact: PRODUCTIVITY</span>
                </div>

                <div className="absolute bottom-6 left-1/4 bg-slate-900 border border-emerald-500/40 px-3 py-1 rounded-full text-[11px] font-bold font-mono text-emerald-300 shadow-md flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5 text-purple-400" />
                  <span>Business Impact: COMPLIANCE</span>
                </div>

                <div className="absolute left-2 top-1/2 -translate-y-1/2 bg-slate-900 border border-emerald-500/40 px-3 py-1 rounded-full text-[11px] font-bold font-mono text-emerald-300 shadow-md flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-sky-400" />
                  <span>Business Impact: EXPERIENCE</span>
                </div>
              </div>
            </div>

            {/* CSS Animations for Flowing Signal Particles */}
            <style>{`
              @keyframes flowDashAnimation {
                0% { stroke-dashoffset: 40; }
                100% { stroke-dashoffset: 0; }
              }
              .animate-flow-dash {
                animation: flowDashAnimation 1.6s linear infinite;
              }
              .animate-flow-dash-fast {
                animation: flowDashAnimation 1.1s linear infinite;
              }
            `}</style>

            {/* SVG CONNECTION LINES & CROSS-PILLAR LINKS */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
              viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
            >
              <defs>
                <filter id="fluent-glow-amber" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="8" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
                <filter id="fluent-glow-red" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="16" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
                <marker
                  id="arrow-core"
                  viewBox="0 0 10 10"
                  refX="28"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#3b82f6" />
                </marker>
                <marker
                  id="arrow-cross"
                  viewBox="0 0 10 10"
                  refX="20"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto"
                >
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#a855f7" />
                </marker>
              </defs>

              {/* ========================================================================= */}
              {/* BUSINESS IMPACT RING (5 Circular Segments Surrounding Pillar Layer)       */}
              {/* ========================================================================= */}
              <g className="business-impact-ring-layer">
                {/* Ring Outer Track Backdrop */}
                <circle
                  cx={1200}
                  cy={750}
                  r={725}
                  fill="none"
                  stroke="#C8C8C8"
                  strokeWidth="80"
                  strokeOpacity="0.06"
                />

                {/* 5 Segments */}
                {impactRingSegmentsCalculated.map((seg) => {
                  const segWedgePath = getPieSectorPath(
                    1200,
                    750,
                    seg.rInner,
                    seg.rOuter,
                    seg.startAngleDeg,
                    seg.endAngleDeg
                  );

                  const midAngleDeg = (seg.startAngleDeg + seg.endAngleDeg) / 2;
                  const labelRad = (midAngleDeg * Math.PI) / 180;
                  const labelRadius = seg.rOuter + 42;
                  const labelX = 1200 + labelRadius * Math.cos(labelRad);
                  const labelY = 750 + labelRadius * Math.sin(labelRad);

                  const isSelected = selectedImpactSegment === seg.id;

                  return (
                    <g
                      key={`impact-ring-seg-${seg.id}`}
                      className="cursor-pointer group pointer-events-auto"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedImpactSegment(seg.id);
                      }}
                    >
                      {/* Segment Arc Path */}
                      <path
                        d={segWedgePath}
                        fill={seg.colorHex}
                        fillOpacity={isSelected ? 0.90 : seg.fillOpacity}
                        stroke={seg.colorHex}
                        strokeWidth={isSelected ? 4 : 2}
                        strokeOpacity={isSelected ? 1.0 : seg.strokeOpacity}
                        filter={
                          seg.severity === 'critical'
                            ? 'url(#fluent-glow-red)'
                            : seg.severity === 'elevated'
                            ? 'url(#fluent-glow-amber)'
                            : undefined
                        }
                        className="transition-all duration-300 group-hover:fill-opacity-90 group-hover:stroke-white"
                      />

                      {/* Segment Pulsing Edge Accent when Elevated or Critical */}
                      {seg.severity !== 'stable' && (
                        <path
                          d={getPieSectorPath(
                            1200,
                            750,
                            seg.rOuter - 4,
                            seg.rOuter,
                            seg.startAngleDeg,
                            seg.endAngleDeg
                          )}
                          fill={seg.colorHex}
                          fillOpacity={0.9}
                          className="animate-pulse"
                        />
                      )}

                      {/* M365 Business Impact Label Badge */}
                      <g transform={`translate(${labelX}, ${labelY})`}>
                        <rect
                          x="-85"
                          y="-16"
                          width="170"
                          height="32"
                          rx="16"
                          fill="#090D16"
                          fillOpacity="0.96"
                          stroke={isSelected ? '#FFFFFF' : seg.colorHex}
                          strokeWidth={isSelected ? '2.5' : '1.5'}
                          strokeOpacity={isSelected ? '1' : '0.8'}
                          className="shadow-xl"
                        />
                        <text
                          x="0"
                          y="-2"
                          textAnchor="middle"
                          fill="#FFFFFF"
                          fontSize="11"
                          fontWeight="900"
                          letterSpacing="1"
                          fontFamily="sans-serif"
                        >
                          {seg.label.toUpperCase()}
                        </text>
                        <text
                          x="0"
                          y="10"
                          textAnchor="middle"
                          fill={seg.colorHex}
                          fontSize="9"
                          fontWeight="800"
                          fontFamily="monospace"
                        >
                          {seg.impactScore}% IMPACT
                        </text>
                      </g>
                    </g>
                  );
                })}
              </g>

              {/* ========================================================================= */}
              {/* PIE CHART SECTOR ZONES (7 Equal Ring Sectors Cut Around the Core)        */}
              {/* ========================================================================= */}
              {PILLAR_SECTORS.map((sector, index) => {
                const sectorAngle = 360 / 7;
                const midAngleDeg = -90 + index * sectorAngle;
                const gapDeg = 0.6;
                const startAngleDeg = midAngleDeg - sectorAngle / 2 + gapDeg;
                const endAngleDeg = midAngleDeg + sectorAngle / 2 - gapDeg;

                const wedgePath = getPieSectorPath(1200, 750, 160, 670, startAngleDeg, endAngleDeg);

                const tagRad = (midAngleDeg * Math.PI) / 180;
                const tagX = 1200 + 640 * Math.cos(tagRad);
                const tagY = 750 + 640 * Math.sin(tagRad);

                // Watermark Background Icon position (centered at radius ~410px in each zone)
                const bgIconX = 1200 + 410 * Math.cos(tagRad);
                const bgIconY = 750 + 410 * Math.sin(tagRad);
                const iconScale = 6.8; // ~163px watermark
                const iconOffset = -12 * iconScale;

                return (
                  <g key={`pie-sector-${sector.group}`} className="pie-sector-group">
                    {/* Translucent Pie Slice Background */}
                    <path
                      d={wedgePath}
                      fill={sector.colorHex}
                      fillOpacity={0.09}
                      stroke={sector.colorHex}
                      strokeWidth={1.5}
                      strokeOpacity={0.4}
                    />

                    {/* Sector Inner Border Glow */}
                    <path
                      d={wedgePath}
                      fill="none"
                      stroke={sector.colorHex}
                      strokeWidth={3}
                      strokeOpacity={0.12}
                    />

                    {/* Subtle Large Background Watermark Icon for Zone */}
                    <g
                      transform={`translate(${bgIconX + iconOffset}, ${bgIconY + iconOffset}) scale(${iconScale})`}
                      className="pointer-events-none opacity-25"
                    >
                      {sector.group === 'Security' && (
                        <path
                          d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
                          fill={sector.colorHex}
                          fillOpacity="0.08"
                          stroke={sector.colorHex}
                          strokeWidth="1.6"
                          strokeOpacity="0.6"
                        />
                      )}
                      {sector.group === 'Governance' && (
                        <g stroke={sector.colorHex} strokeWidth="1.6" strokeOpacity="0.6" fill="none">
                          <line x1="2" y1="22" x2="22" y2="22" />
                          <line x1="6" y1="18" x2="6" y2="11" />
                          <line x1="10" y1="18" x2="10" y2="11" />
                          <line x1="14" y1="18" x2="14" y2="11" />
                          <line x1="18" y1="18" x2="18" y2="11" />
                          <polygon points="12 2 20 7 4 7 12 2" fill={sector.colorHex} fillOpacity="0.08" />
                          <line x1="2" y1="11" x2="22" y2="11" />
                          <line x1="3" y1="18" x2="21" y2="18" />
                        </g>
                      )}
                      {sector.group === 'Licensing' && (
                        <g stroke={sector.colorHex} strokeWidth="2.0" strokeOpacity="0.7" fill="none">
                          <line x1="12" y1="2" x2="12" y2="22" />
                          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                        </g>
                      )}
                      {sector.group === 'Adoption' && (
                        <g stroke={sector.colorHex} strokeWidth="1.6" strokeOpacity="0.6" fill="none">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" fill={sector.colorHex} fillOpacity="0.08" />
                          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </g>
                      )}
                      {sector.group === 'Copilot' && (
                        <g stroke={sector.colorHex} strokeWidth="1.6" strokeOpacity="0.7" fill="none">
                          {/* Primary 4-point AI Sparkle */}
                          <path
                            d="M12 2L13.9 7.8A2 2 0 0 0 15.2 9.1L21 11L15.2 12.9A2 2 0 0 0 13.9 14.2L12 20L10.1 14.2A2 2 0 0 0 8.8 12.9L3 11L8.8 9.1A2 2 0 0 0 10.1 7.8L12 2Z"
                            fill={sector.colorHex}
                            fillOpacity="0.14"
                          />
                          {/* Satellite Sparkle 1 */}
                          <path
                            d="M19 2L19.8 4.2A1 1 0 0 0 20.8 5.2L23 6L20.8 6.8A1 1 0 0 0 19.8 7.8L19 10L18.2 7.8A1 1 0 0 0 17.2 6.8L15 6L17.2 5.2A1 1 0 0 0 18.2 4.2L19 2Z"
                            fill={sector.colorHex}
                            fillOpacity="0.20"
                          />
                          {/* Satellite Sparkle 2 */}
                          <path
                            d="M5 16L5.6 17.6A1 1 0 0 0 6.4 18.4L8 19L6.4 19.6A1 1 0 0 0 5.6 20.4L5 22L4.4 20.4A1 1 0 0 0 3.6 19.6L2 19L3.6 18.4A1 1 0 0 0 4.4 17.6L5 16Z"
                            fill={sector.colorHex}
                            fillOpacity="0.20"
                          />
                        </g>
                      )}
                      {sector.group === 'Compliance' && (
                        <g stroke={sector.colorHex} strokeWidth="1.6" strokeOpacity="0.6" fill="none">
                          <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" fill={sector.colorHex} fillOpacity="0.08" />
                          <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" fill={sector.colorHex} fillOpacity="0.08" />
                          <path d="M7 21h10" />
                          <path d="M12 3v18" />
                          <path d="M3 7h18" />
                        </g>
                      )}
                      {sector.group === 'Health' && (
                        <g stroke={sector.colorHex} strokeWidth="1.6" strokeOpacity="0.6" fill="none">
                          <path
                            d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
                            fill={sector.colorHex}
                            fillOpacity="0.08"
                          />
                          <path
                            d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"
                            stroke={sector.colorHex}
                            strokeWidth="2"
                            strokeOpacity="0.8"
                          />
                        </g>
                      )}
                    </g>

                    {/* Sector Tag Badge Header */}
                    <g transform={`translate(${tagX}, ${tagY})`}>
                      <rect
                        x="-65"
                        y="-12"
                        width="130"
                        height="24"
                        rx="12"
                        fill="#090d16"
                        fillOpacity="0.95"
                        stroke={sector.colorHex}
                        strokeWidth="1.5"
                        strokeOpacity="0.8"
                      />
                      <text
                        x="0"
                        y="4"
                        textAnchor="middle"
                        fill={sector.colorHex}
                        fontSize="10"
                        fontWeight="800"
                        letterSpacing="1"
                        fontFamily="monospace"
                      >
                        {sector.group.toUpperCase()} ZONE
                      </text>
                    </g>
                  </g>
                );
              })}

              {/* Render Connection Lines between Nodes */}
              {nodes.map((sourceNode) => {
                return sourceNode.connectedTo.map((targetId) => {
                  const targetNode = nodes.find((n) => n.id === targetId);
                  if (!targetNode) return null;

                  const isHighlighted =
                    selectedNode?.id === sourceNode.id || selectedNode?.id === targetNode.id;

                  const isCoreLink = targetNode.id === 'hub-core' || sourceNode.id === 'hub-core';
                  const isCrossLink = !isCoreLink && !sourceNode.isCategoryHub && !targetNode.isCategoryHub;

                  const strokeColor = isHighlighted
                    ? '#38bdf8'
                    : isCrossLink
                    ? '#a855f7'
                    : isCoreLink
                    ? '#3b82f6'
                    : sourceNode.colorHex || '#1e293b';

                  const particleColor = isCrossLink
                    ? '#c084fc'
                    : isCoreLink
                    ? '#60a5fa'
                    : '#38bdf8';

                  return (
                    <g key={`${sourceNode.id}-${targetNode.id}`}>
                      {/* Base Line */}
                      <line
                        x1={sourceNode.x}
                        y1={sourceNode.y}
                        x2={targetNode.x}
                        y2={targetNode.y}
                        stroke={strokeColor}
                        strokeWidth={isHighlighted ? 3 : isCoreLink ? 2.5 : isCrossLink ? 1.8 : 1.4}
                        strokeOpacity={isHighlighted ? 0.9 : isCrossLink ? 0.6 : 0.45}
                        strokeDasharray={isCrossLink ? '4,6' : undefined}
                      />

                      {/* Animated Flow Line Overlay */}
                      <line
                        x1={sourceNode.x}
                        y1={sourceNode.y}
                        x2={targetNode.x}
                        y2={targetNode.y}
                        stroke={particleColor}
                        strokeWidth={isCoreLink ? 2.2 : 1.5}
                        strokeDasharray={isCoreLink ? '8,12' : '6,10'}
                        strokeOpacity={0.7}
                        className={isCoreLink ? 'animate-flow-dash-fast' : 'animate-flow-dash'}
                      />

                      {/* Traveling Pulse Circle Particle */}
                      <circle r={isCoreLink ? 4 : 2.5} fill={particleColor}>
                        <animateMotion
                          path={`M ${sourceNode.x} ${sourceNode.y} L ${targetNode.x} ${targetNode.y}`}
                          dur={isCoreLink ? '1.8s' : '2.2s'}
                          repeatCount="indefinite"
                        />
                      </circle>
                    </g>
                  );
                });
              })}
            </svg>

            {/* ========================================================================= */}
            {/* LAYER 1 & LAYER 2: INTERACTIVE RADIAL MAP NODES */}
            {/* ========================================================================= */}
            {filteredNodes.map((node) => {
              const isSelected = selectedNode?.id === node.id;

              // Render Center Core Node (Tenant Intelligence Core)
              if (node.isCoreNode) {
                return (
                  <div
                    key={node.id}
                    onClick={() => setSelectedNode(node)}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-30 cursor-pointer group"
                    style={{ left: `${node.x}px`, top: `${node.y}px` }}
                  >
                    {/* Glowing Core Aura */}
                    <div className="w-40 h-40 rounded-full bg-white/10 border-2 border-white/60 shadow-[0_0_60px_rgba(255,255,255,0.4)] backdrop-blur-md flex flex-col items-center justify-center p-3 text-center transition-transform group-hover:scale-105 active:scale-95">
                      <div className="w-10 h-10 rounded-full bg-white text-slate-950 flex items-center justify-center font-black shadow-lg mb-1">
                        <Sparkles className="w-5 h-5 text-blue-600 animate-spin-slow" />
                      </div>
                      <div className="text-xs font-black text-white tracking-tight uppercase leading-tight font-mono">
                        Tenant Intelligence
                      </div>
                      <div className="text-[10px] font-bold text-blue-200">CORE LAYER</div>
                      <div className="mt-1 px-2 py-0.5 rounded-full bg-blue-500/30 text-blue-200 text-[9px] font-mono border border-blue-400/40">
                        122 Signals Polled
                      </div>
                    </div>
                  </div>
                );
              }

              // Render Category Pillar Hub Nodes (Layer 2)
              if (node.isCategoryHub) {
                return (
                  <div
                    key={node.id}
                    onClick={() => {
                      setSelectedNode(node);
                      setSelectedPillarDrawer(node.clusterGroup);
                    }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-20 cursor-pointer group"
                    style={{ left: `${node.x}px`, top: `${node.y}px` }}
                  >
                    <div
                      className={`px-4 py-2.5 rounded-2xl border-2 backdrop-blur-md shadow-2xl flex items-center gap-3 transition-transform group-hover:scale-105 active:scale-95 ${
                        node.status === 'alert'
                          ? 'bg-red-950/80 border-red-500 text-red-200 shadow-[0_0_25px_rgba(239,68,68,0.4)] animate-pulse'
                          : node.status === 'drift'
                          ? 'bg-amber-950/80 border-amber-500 text-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.3)]'
                          : 'bg-slate-900/90 border-slate-700 text-slate-100'
                      }`}
                      style={{
                        borderColor: node.colorHex || undefined,
                      }}
                    >
                      <div
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-bold shadow-md"
                        style={{ backgroundColor: node.colorHex || '#3b82f6' }}
                      >
                        {getDomainIcon(node.category, 'w-4 h-4')}
                      </div>
                      <div>
                        <div className="text-xs font-black tracking-tight flex items-center gap-1.5">
                          <span>{node.label}</span>
                          <span
                            className="text-[9px] font-mono px-1.5 py-0.2 rounded font-bold"
                            style={{ backgroundColor: `${node.colorHex}33`, color: node.colorHex }}
                          >
                            {node.healthScore}%
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                          <span>{node.clusterGroup} Pillar</span>
                          {node.activeAlerts > 0 && (
                            <span className="text-red-400 font-bold">• {node.activeAlerts} Alerts</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              // Render Primary Pillar Sub-Nodes (35 Nodes)
              return (
                <div
                  key={node.id}
                  onClick={() => setSelectedNode(node)}
                  className="absolute -translate-x-1/2 -translate-y-1/2 z-10 cursor-pointer group"
                  style={{ left: `${node.x}px`, top: `${node.y}px` }}
                >
                  <div
                    className={`px-2.5 py-1.5 rounded-xl border text-xs flex items-center gap-2 backdrop-blur-xs shadow-md transition-all group-hover:scale-110 active:scale-95 ${
                      isSelected
                        ? 'ring-2 ring-blue-400 bg-blue-900/80 border-blue-400 text-white z-30 scale-110'
                        : node.status === 'alert'
                        ? 'bg-red-950/70 border-red-500/80 text-red-200'
                        : node.status === 'drift'
                        ? 'bg-amber-950/70 border-amber-500/80 text-amber-200'
                        : 'bg-slate-900/80 border-slate-800 text-slate-200 hover:border-slate-600'
                    }`}
                  >
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: node.colorHex || '#38bdf8' }}
                    />
                    <span className="font-semibold text-[11px] whitespace-nowrap">{node.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. SELECTED NODE DETAIL INSPECTOR PANEL (SLIDE-OVER / BOTTOM SHEET) */}
      {/* ========================================================================= */}
      {selectedNode && (
        <div className="absolute bottom-4 left-4 right-4 lg:left-auto lg:right-4 lg:w-96 bg-slate-900/95 border border-slate-800 rounded-2xl p-4 shadow-2xl backdrop-blur-md z-30 text-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: selectedNode.colorHex || '#3b82f6' }}
              />
              <h3 className="font-extrabold text-white text-sm">{selectedNode.label}</h3>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
            <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
              <div className="text-[9px] text-slate-500 uppercase">Pillar Group</div>
              <div className="font-bold text-slate-200">{selectedNode.clusterGroup}</div>
            </div>
            <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
              <div className="text-[9px] text-slate-500 uppercase">Health Score</div>
              <div className="font-bold text-emerald-400">{selectedNode.healthScore} / 100</div>
            </div>
          </div>

          <div>
            <div className="text-[10px] font-mono text-slate-400 mb-1">Graph API Endpoint</div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-2 font-mono text-[10px] text-blue-300 break-all flex items-center justify-between">
              <span>{selectedNode.endpointPath}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(selectedNode.endpointPath);
                  if (onShowToast) onShowToast('info', 'Endpoint Copied', selectedNode.endpointPath);
                }}
                className="text-slate-400 hover:text-white shrink-0 ml-2"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {selectedNode.drifts.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono text-amber-400 font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Active Drifts & Findings ({selectedNode.drifts.length})</span>
              </div>
              {selectedNode.drifts.map((d) => (
                <div
                  key={d.id}
                  className="bg-amber-950/40 border border-amber-500/30 rounded-xl p-2 text-amber-200 text-[11px]"
                >
                  <div className="font-bold flex items-center justify-between">
                    <span>{d.title}</span>
                    <span className="text-[9px] text-amber-400 font-mono">{d.detectedAt}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pt-2 border-t border-slate-800 flex items-center gap-2">
            <button
              onClick={() => {
                const sampleAction = M365_ACTION_REGISTRY.find(
                  (a) => a.category === selectedNode.category
                ) || M365_ACTION_REGISTRY[0];
                handleOpenWorkflowModal(sampleAction);
              }}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors shadow-md"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Remediate via Graph Action</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= summit map */}
      {/* 4. MODAL: EXPORT MAP ARCHITECTURE JSON */}
      {/* ========================================================================= */}
      {isJsonModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  <FileJson className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-extrabold text-white text-base">
                    M365 Tenant Intelligence Map Architecture (JSON)
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">
                    Structured topology export matching 7 pillars & 35 primary nodes
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsJsonModalOpen(false)}
                className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 flex-1 overflow-y-auto font-mono text-xs bg-slate-950 text-indigo-200">
              <pre className="whitespace-pre-wrap break-words leading-relaxed">
                {JSON.stringify(mapArchitectureJson, null, 2)}
              </pre>
            </div>

            <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-between bg-slate-900">
              <div className="text-xs text-slate-400 font-mono">
                Schema: M365 Radial Map V3.5
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyJson}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-2 transition-colors shadow-md"
                >
                  {copiedJson ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedJson ? 'Copied to Clipboard!' : 'Copy Architecture JSON'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4.5 MODAL / DRAWER: BUSINESS IMPACT RING SEGMENT DETAIL PANEL */}
      {/* ========================================================================= */}
      {selectedImpactSegment && (() => {
        const seg = impactRingSegmentsCalculated.find((s) => s.id === selectedImpactSegment);
        if (!seg) return null;

        return (
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-slate-950/95 border-l border-slate-800 shadow-2xl backdrop-blur-md flex flex-col justify-between p-6 animate-in slide-in-from-right duration-200">
            <div className="space-y-6 overflow-y-auto">
              {/* Header */}
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="p-3 rounded-2xl border flex items-center justify-center text-white shadow-lg"
                    style={{ backgroundColor: `${seg.colorHex}22`, borderColor: seg.colorHex }}
                  >
                    <ShieldAlert className="w-6 h-6" style={{ color: seg.colorHex }} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest">
                        Business Impact Segment
                      </span>
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono uppercase border"
                        style={{
                          backgroundColor: `${seg.colorHex}20`,
                          borderColor: `${seg.colorHex}60`,
                          color: seg.colorHex,
                        }}
                      >
                        {seg.severity}
                      </span>
                    </div>
                    <h2 className="text-2xl font-black text-white tracking-tight">{seg.label} Outcome</h2>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedImpactSegment(null)}
                  className="p-2 text-slate-400 hover:text-white bg-slate-900 border border-slate-800 rounded-xl"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Impact Score Hero Banner */}
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">
                    Calculated Business Impact
                  </span>
                  <span className="text-2xl font-black font-mono" style={{ color: seg.colorHex }}>
                    {seg.impactScore}%
                  </span>
                </div>
                <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden border border-slate-800 p-0.5">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${seg.impactScore}%`, backgroundColor: seg.colorHex }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>Contributing Pillar Health Avg: {seg.weightedPillarScore}%</span>
                  <span>Glow: {seg.glowPx}px</span>
                </div>
              </div>

              {/* Business Consequence Statement */}
              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2">
                <h4 className="text-xs font-extrabold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
                  <Info className="w-4 h-4 text-blue-400" />
                  Real-Time Business Consequence
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed font-sans">{seg.outcomeText}</p>
                <p className="text-[11px] text-slate-400 leading-normal pt-1 border-t border-slate-800/80">
                  {seg.description}
                </p>
              </div>

              {/* Contributing Technical Pillars */}
              <div className="space-y-3">
                <h4 className="text-xs font-extrabold text-slate-300 uppercase tracking-wider font-mono">
                  Contributing Technical Pillars & Weights
                </h4>
                <div className="space-y-2">
                  {seg.contributingPillars.map(({ group, weight }) => {
                    const score = pillarScores[group] ?? 85;
                    const sectorObj = PILLAR_SECTORS.find((s) => s.group === group);
                    const color = sectorObj?.colorHex || '#3b82f6';

                    return (
                      <div
                        key={group}
                        onClick={() => {
                          setSelectedPillarDrawer(group);
                          setSelectedImpactSegment(null);
                        }}
                        className="p-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 flex items-center justify-between cursor-pointer transition-colors group"
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <div>
                            <span className="font-bold text-xs text-white group-hover:text-blue-300 transition-colors">
                              {group} Pillar
                            </span>
                            <div className="text-[10px] text-slate-400 font-mono">
                              Influence Weight: {Math.round(weight * 100)}%
                            </div>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="font-mono font-bold text-xs" style={{ color }}>
                            {score}% Health
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {score < 70 ? 'Drifted' : score < 85 ? 'Warning' : 'Healthy'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Drawer Actions Footer */}
            <div className="pt-4 border-t border-slate-800 space-y-2">
              <button
                onClick={() => setIsImpactRingJsonModalOpen(true)}
                className="w-full bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-colors"
              >
                <FileJson className="w-4 h-4 text-sky-400" />
                <span>View Ring Structured JSON Schema</span>
              </button>
              <button
                onClick={() => setSelectedImpactSegment(null)}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow-md transition-colors"
              >
                Close Segment Details
              </button>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* 4.6 MODAL: BUSINESS IMPACT RING STRUCTURED JSON VIEW */}
      {/* ========================================================================= */}
      {isImpactRingJsonModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="relative w-full max-w-2xl bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
                  <FileJson className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-sm">Business Impact Ring Structured Schema</h3>
                  <p className="text-[10px] text-slate-400 font-mono">Microsoft 365 Tenant Intelligence Map Standard</p>
                </div>
              </div>
              <button
                onClick={() => setIsImpactRingJsonModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-900 border border-slate-800 rounded-2xl p-4 font-mono text-[11px] text-sky-300 leading-relaxed select-all">
              <pre>
                {JSON.stringify(
                  {
                    ringName: "Microsoft 365 Business Impact Ring",
                    purpose: "Dynamic translation layer converting technical pillar condition scores into business outcomes.",
                    designSystem: {
                      style: "Microsoft 365 Fluent Design",
                      baseColorHex: "#C8C8C8",
                      geometry: "Circular concentric band surrounding the 7-pillar zone",
                      rInnerBase: 685,
                      rOuterBase: 765
                    },
                    segmentsCount: 5,
                    segments: impactRingSegmentsCalculated.map((seg) => ({
                      segmentId: seg.id,
                      label: seg.label,
                      angleRangeDeg: [seg.startAngleDeg, seg.endAngleDeg],
                      contributingPillars: seg.contributingPillars,
                      weightedPillarScore: seg.weightedPillarScore,
                      calculatedImpactScore: seg.impactScore,
                      severity: seg.severity,
                      visualState: {
                        colorHex: seg.colorHex,
                        fillOpacity: seg.fillOpacity,
                        strokeOpacity: seg.strokeOpacity,
                        glowPx: seg.glowPx,
                        thicknessPx: seg.rOuter - seg.rInner
                      },
                      businessConsequence: seg.outcomeText
                    }))
                  },
                  null,
                  2
                )}
              </pre>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <span className="text-[10px] text-slate-400 font-mono">5 Segments Evaluated in Real Time</span>
              <button
                onClick={() => setIsImpactRingJsonModalOpen(false)}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-2 rounded-xl text-xs"
              >
                Close JSON Viewer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4.7 MODAL: BUSINESS IMPACT RING INTERACTIVE SIMULATOR */}
      {/* ========================================================================= */}
      {isRingSimulatorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-4xl bg-slate-950 border border-purple-500/30 rounded-3xl p-4 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col overflow-hidden">
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-gradient-to-br from-purple-600/30 to-blue-600/30 border border-purple-500/40 text-amber-300 shadow-md">
                  <Gauge className="w-6 h-6 animate-pulse text-amber-400" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-base sm:text-lg flex items-center gap-2">
                    <span>Business Impact Ring Interactive Simulator</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      Live Signal Testing
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Adjust technical pillar health scores or run quick incident scenarios to observe real-time expansion, color saturation, and business outcomes on the outer ring.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsRingSimulatorOpen(false)}
                className="text-slate-400 hover:text-white p-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Content Body */}
            <div className="flex-1 overflow-y-auto space-y-5 pr-1">

              {/* 1. Quick Scenario Presets */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 font-mono flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span>Quick Incident & Scenario Presets</span>
                  </h4>
                  <span className="text-[10px] text-slate-500 font-mono">Click to test instant impact</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  <button
                    onClick={() => handleApplyScenario('breach')}
                    className="p-2.5 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-500/40 text-left transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 text-red-400 font-bold text-xs mb-1">
                      <ShieldAlert className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                      <span>Security Breach</span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-tight">
                      Security 20% • Risk & Compliance flare red
                    </p>
                  </button>

                  <button
                    onClick={() => handleApplyScenario('waste')}
                    className="p-2.5 rounded-xl bg-amber-950/40 hover:bg-amber-900/60 border border-amber-500/40 text-left transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 text-amber-400 font-bold text-xs mb-1">
                      <DollarSign className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                      <span>E5 License Surge</span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-tight">
                      Licensing 25% • Cost segment expands
                    </p>
                  </button>

                  <button
                    onClick={() => handleApplyScenario('stagnation')}
                    className="p-2.5 rounded-xl bg-blue-950/40 hover:bg-blue-900/60 border border-blue-500/40 text-left transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 text-blue-400 font-bold text-xs mb-1">
                      <Users className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                      <span>Copilot Stagnation</span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-tight">
                      Adoption 30% • Productivity drops
                    </p>
                  </button>

                  <button
                    onClick={() => handleApplyScenario('degraded')}
                    className="p-2.5 rounded-xl bg-orange-950/40 hover:bg-orange-900/60 border border-orange-500/40 text-left transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 text-orange-400 font-bold text-xs mb-1">
                      <HeartPulse className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                      <span>Service Outage</span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-tight">
                      Health 35% • User Experience impacted
                    </p>
                  </button>

                  <button
                    onClick={() => handleApplyScenario('optimal')}
                    className="p-2.5 rounded-xl bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/40 text-left transition-all group cursor-pointer col-span-2 sm:col-span-1"
                  >
                    <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs mb-1">
                      <CheckCircle2 className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                      <span>Restore Optimal</span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-tight">
                      All Pillars 98% • Muted gray baseline
                    </p>
                  </button>
                </div>
              </div>

              {/* 2. Interactive Pillar Sliders */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 font-mono flex items-center gap-1.5">
                    <SlidersHorizontal className="w-4 h-4 text-sky-400" />
                    <span>Technical Pillar Signal Sliders</span>
                  </h4>
                  <span className="text-[10px] text-slate-500 font-mono">Drag sliders to test custom scores</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(
                    [
                      { group: 'Security', color: '#0078D4' },
                      { group: 'Governance', color: '#6B4EFF' },
                      { group: 'Licensing', color: '#009CA6' },
                      { group: 'Adoption', color: '#43A047' },
                      { group: 'Copilot', color: '#00A4EF' },
                      { group: 'Compliance', color: '#5A2D91' },
                      { group: 'Health', color: '#F7630C' },
                    ] as { group: ClusterGroup; color: string }[]
                  ).map(({ group, color }) => {
                    const score = pillarScores[group] ?? 85;
                    return (
                      <div
                        key={group}
                        className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                            <span className="font-bold text-white">{group} Pillar</span>
                          </div>
                          <span
                            className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-slate-900 border border-slate-800"
                            style={{ color: score < 50 ? '#EF4444' : score < 80 ? '#F59E0B' : '#10B981' }}
                          >
                            {score}%
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono text-slate-500">0%</span>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={score}
                            onChange={(e) => handleUpdatePillarScore(group, parseInt(e.target.value))}
                            className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                          />
                          <span className="text-[10px] font-mono text-slate-500">100%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. Live Business Impact Segment Output Monitor */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 font-mono flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-purple-400" />
                    <span>Live Outer Ring Segment State Calculations</span>
                  </h4>
                  <span className="text-[10px] text-slate-400 font-mono">5 Segments Active</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                  {impactRingSegmentsCalculated.map((seg) => (
                    <div
                      key={seg.id}
                      className="p-3 rounded-xl bg-slate-950 border text-xs space-y-2"
                      style={{
                        borderColor: `${seg.colorHex}50`,
                        boxShadow: `0 0 ${seg.glowPx + 4}px ${seg.glowColor}`,
                      }}
                    >
                      <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                        <div className="flex items-center gap-1.5 font-bold text-white">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: seg.colorHex }} />
                          <span>{seg.label}</span>
                        </div>
                        <span
                          className="px-1.5 py-0.5 rounded text-[9px] font-mono font-black uppercase"
                          style={{
                            backgroundColor: `${seg.colorHex}25`,
                            color: seg.colorHex,
                            border: `1px solid ${seg.colorHex}40`,
                          }}
                        >
                          {seg.severity}
                        </span>
                      </div>

                      <div className="space-y-1 font-mono text-[10px]">
                        <div className="flex justify-between text-slate-400">
                          <span>Impact Score:</span>
                          <span className="font-bold text-white">{seg.impactScore}%</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Outer Radius:</span>
                          <span className="font-bold text-slate-200">{seg.rOuter}px (+{seg.thicknessDelta}px)</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Glow Radius:</span>
                          <span className="font-bold text-slate-200">{seg.glowPx}px</span>
                        </div>
                      </div>

                      <p className="text-[10px] text-slate-300 leading-tight pt-1 border-t border-slate-800/80 italic font-sans">
                        "{seg.outcomeText}"
                      </p>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-slate-800 flex items-center justify-between shrink-0">
              <button
                onClick={() => handleApplyScenario('optimal')}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                <span>Reset All to 98%</span>
              </button>

              <button
                onClick={() => setIsRingSimulatorOpen(false)}
                className="px-5 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all cursor-pointer"
              >
                Close Simulator & View Ring on Map
              </button>
            </div>

          </div>
        </div>
      )}
      {workflowModalAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-sm">{workflowModalAction.name}</h3>
                  <p className="text-[10px] text-slate-400 font-mono">{workflowModalAction.apiEndpoint}</p>
                </div>
              </div>
              <button
                onClick={() => setWorkflowModalAction(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">{workflowModalAction.description}</p>

            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-[11px] font-bold text-slate-200 mb-1 font-mono">
                  Ticket ID <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={ticketIdInput}
                  onChange={(e) => setTicketIdInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-200 mb-1 font-mono">
                  Audit Justification <span className="text-red-400">*</span>
                </label>
                <textarea
                  rows={2}
                  value={reasoningInput}
                  onChange={(e) => setReasoningInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <button
                onClick={() => setWorkflowModalAction(null)}
                className="bg-slate-800 text-slate-300 px-4 py-2 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button
                disabled={isExecutingWorkflow || !ticketIdInput}
                onClick={handleConfirmWorkflowExecute}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-md"
              >
                {isExecutingWorkflow ? (
                  <>
                    <RotateCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Executing...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Dispatch Write Action</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. MODAL: COMMAND K GLOBAL SEARCH PALETTE */}
      {/* ========================================================================= */}
      {isCmdKOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/75 backdrop-blur-xs">
          <div className="fixed inset-0" onClick={() => setIsCmdKOpen(false)} />
          <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden z-10 text-xs">
            <div className="p-3 border-b border-slate-800 flex items-center gap-2 bg-slate-950">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                autoFocus
                value={cmdKSearch}
                onChange={(e) => setCmdKSearch(e.target.value)}
                placeholder="Type to search 80+ write actions or nodes (e.g. FIDO2, Copilot, BitLocker)..."
                className="bg-transparent border-none text-white placeholder-slate-500 w-full focus:outline-none text-xs font-medium"
              />
              <button
                onClick={() => setIsCmdKOpen(false)}
                className="text-slate-400 hover:text-white text-[10px] font-mono bg-slate-800 px-1.5 py-0.5 rounded"
              >
                ESC
              </button>
            </div>

            <div className="p-2 max-h-96 overflow-y-auto space-y-1">
              {M365_ACTION_REGISTRY.filter(
                (item) =>
                  item.name.toLowerCase().includes(cmdKSearch.toLowerCase()) ||
                  item.category.toLowerCase().includes(cmdKSearch.toLowerCase()) ||
                  item.description.toLowerCase().includes(cmdKSearch.toLowerCase())
              ).map((action) => (
                <div
                  key={action.id}
                  onClick={() => {
                    handleOpenWorkflowModal(action);
                    setIsCmdKOpen(false);
                  }}
                  className="p-2.5 rounded-xl hover:bg-slate-800 text-slate-200 flex items-center justify-between cursor-pointer group transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-blue-400">
                      {getDomainIcon(action.category, 'w-3.5 h-3.5')}
                    </div>
                    <div>
                      <div className="font-bold text-xs group-hover:text-blue-300 transition-colors">
                        {action.name}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">{action.apiEndpoint}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {renderSafetyBadge(action.safetyLevel)}
                    <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-blue-400" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

