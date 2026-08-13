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
} from '../m365ActionRegistry';
import {
  TopologyCenterPiece,
  PILLAR_SECTORS,
  BUSINESS_IMPACT_SEGMENTS,
  computePillarScores,
  computeImpactRingSegments,
  getDomainIcon,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  type ClusterGroup,
  type MapNode,
  type BusinessImpactSegmentConfig,
} from './TopologyCenterPiece';

interface MapViewProps {
  tenants: Tenant[];
  selectedTenant?: Tenant | null;
  onSelectTenant: (tenant: Tenant | null) => void;
  onDispatchWorkflow?: (actionId: string, payload: any) => void;
  onShowToast?: (type: 'success' | 'info' | 'warning' | 'error', title: string, desc: string) => void;
}

// The topology types, the pillar / business-impact ring config, and the arc math now
// live alongside the visualization that owns them, in ./TopologyCenterPiece.
// Re-exported here so MapView's existing public surface is unchanged.
export type { ClusterGroup, MapNode, BusinessImpactSegmentConfig };
export { BUSINESS_IMPACT_SEGMENTS };

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
  // CANVAS_WIDTH / CANVAS_HEIGHT imported from ./TopologyCenterPiece

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
  // (shared with TopologyCenterPiece, which derives the ring from the same nodes)
  const pillarScores = useMemo(() => computePillarScores(nodes), [nodes]);

  // Dynamic Impact Calculations for the 5 Business Impact Ring Segments
  // (shared with TopologyCenterPiece, which derives the ring from the same nodes)
  const impactRingSegmentsCalculated = useMemo(
    () => computeImpactRingSegments(pillarScores),
    [pillarScores]
  );

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

  // getDomainIcon imported from ./TopologyCenterPiece

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
            <TopologyCenterPiece
              nodes={nodes}
              filteredNodes={filteredNodes}
              selectedNode={selectedNode}
              onSelectNode={(node) => {
                setSelectedNode(node);
                if (node.isCategoryHub) {
                  setSelectedPillarDrawer(node.clusterGroup);
                }
              }}
              selectedImpactSegment={selectedImpactSegment}
              onSelectImpactSegment={setSelectedImpactSegment}
            />
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


