import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Shield,
  Lock,
  Layers,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Activity,
  Terminal,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Filter,
  Download,
  Copy,
  ChevronUp,
  ChevronDown,
  X,
  Play,
  Pause,
  ArrowUpRight,
  Database,
  Radio,
  Sparkles,
  Server,
  Cloud,
  FileJson,
  Eye,
  Check,
  Zap,
  Globe,
  SlidersHorizontal,
  FileCode,
} from 'lucide-react';
import { audioSynth } from '../utils/audioSynth';

export interface PillarSector {
  id: string;
  name: string;
  color: string;
  angleStart: number; // degrees
  angleEnd: number;   // degrees
  icon: React.ElementType;
}

export interface GraphNodeData {
  id: string;
  pillarId: string;
  title: string;
  subtitle: string;
  endpoint: string;
  healthScore: number; // 0..100
  status: 'healthy' | 'drift' | 'alert';
  latency: number; // ms
  connectedEndpoints: number;
  icon: React.ElementType;
  angle: number;  // degrees from center
  radius: number; // px from center
  policyDrifts: Array<{
    title: string;
    severity: 'High' | 'Medium' | 'Low';
    timestamp: string;
    details: string;
  }>;
  latencyHistory: number[];
  jsonMetadata: Record<string, any>;
}

export interface TelemetryLog {
  id: string;
  timestamp: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  endpoint: string;
  statusCode: 200 | 401 | 429 | 500;
  latency: number;
  statusText: string;
  tenantId: string;
}

export interface TenantOption {
  id: string;
  name: string;
  domain: string;
  healthScore: number;
  activeDrifts: number;
  activeAlerts: number;
}

const MOCK_TENANTS: TenantOption[] = [
  {
    id: 'tenant-contoso',
    name: 'Contoso Electronics (Prod)',
    domain: 'contoso.onmicrosoft.com',
    healthScore: 78,
    activeDrifts: 4,
    activeAlerts: 2,
  },
  {
    id: 'tenant-fabrikam',
    name: 'Fabrikam Global (Dev)',
    domain: 'fabrikam.onmicrosoft.com',
    healthScore: 92,
    activeDrifts: 1,
    activeAlerts: 0,
  },
  {
    id: 'tenant-northwind',
    name: 'Northwind Traders (Staging)',
    domain: 'northwindtraders.onmicrosoft.com',
    healthScore: 61,
    activeDrifts: 7,
    activeAlerts: 5,
  },
];

export const PILLARS: PillarSector[] = [
  { id: 'security', name: 'Security', color: '#0078D4', angleStart: 0, angleEnd: 51.4, icon: Shield },
  { id: 'governance', name: 'Governance', color: '#6B4EFF', angleStart: 51.4, angleEnd: 102.8, icon: Layers },
  { id: 'licensing', name: 'Licensing', color: '#00BCF2', angleStart: 102.8, angleEnd: 154.2, icon: Database },
  { id: 'adoption', name: 'Adoption', color: '#107C41', angleStart: 154.2, angleEnd: 205.6, icon: Globe },
  { id: 'copilot', name: 'Copilot & AI', color: '#FF8C00', angleStart: 205.6, angleEnd: 257, icon: Sparkles },
  { id: 'compliance', name: 'Compliance', color: '#D13438', angleStart: 257, angleEnd: 308.4, icon: Lock },
  { id: 'health', name: 'Tenant Health', color: '#10B981', angleStart: 308.4, angleEnd: 360, icon: Server },
];

export const BASE_GRAPH_NODES: GraphNodeData[] = [
  // 1. Security Pillar
  {
    id: 'node-entra-protection',
    pillarId: 'security',
    title: 'Entra ID Identity Protection',
    subtitle: 'Risk Detection Engine',
    endpoint: '/v1.0/identity/protection/riskDetections',
    healthScore: 68,
    status: 'drift',
    latency: 24,
    connectedEndpoints: 12,
    icon: Shield,
    angle: 15,
    radius: 195,
    policyDrifts: [
      {
        title: 'MFA Registration Policy Bypass',
        severity: 'High',
        timestamp: '2 mins ago',
        details: '14 privileged accounts lack enforced FIDO2/Passkey MFA policies.',
      },
    ],
    latencyHistory: [18, 22, 29, 24, 31, 24],
    jsonMetadata: {
      provider: 'Entra ID Protection',
      riskState: 'atRisk',
      elevatedUsersCount: 14,
      mfaCoveragePercent: 82.4,
    },
  },
  {
    id: 'node-conditional-access',
    pillarId: 'security',
    title: 'Conditional Access Policies',
    subtitle: 'Zero Trust Access Controls',
    endpoint: '/v1.0/identity/conditionalAccess/policies',
    healthScore: 45,
    status: 'alert',
    latency: 38,
    connectedEndpoints: 28,
    icon: Lock,
    angle: 38,
    radius: 310,
    policyDrifts: [
      {
        title: 'Legacy Auth Exclusion Found',
        severity: 'High',
        timestamp: '5 mins ago',
        details: 'Legacy IMAP/POP3 authentication allowed for 3 service principals.',
      },
      {
        title: 'Unenforced Device Compliance',
        severity: 'Medium',
        timestamp: '12 mins ago',
        details: 'Non-compliant BYOD devices accessing SharePoint Online.',
      },
    ],
    latencyHistory: [32, 41, 38, 45, 39, 38],
    jsonMetadata: {
      totalPolicies: 18,
      enabledPolicies: 14,
      reportOnlyPolicies: 4,
      legacyAuthExclusions: 3,
    },
  },

  // 2. Governance Pillar
  {
    id: 'node-sharepoint-sites',
    pillarId: 'governance',
    title: 'SharePoint Site Governance',
    subtitle: 'Oversharing & Link Exposure',
    endpoint: '/v1.0/sites/getAllSites',
    healthScore: 52,
    status: 'alert',
    latency: 42,
    connectedEndpoints: 45,
    icon: Layers,
    angle: 68,
    radius: 205,
    policyDrifts: [
      {
        title: 'Unbounded Anonymous Sharing Links',
        severity: 'High',
        timestamp: '1 min ago',
        details: '1,240 financial and HR documents accessible via public guest links.',
      },
    ],
    latencyHistory: [38, 44, 42, 50, 41, 42],
    jsonMetadata: {
      totalSitesCount: 342,
      externallySharedSites: 89,
      anonymousLinkCount: 1240,
    },
  },
  {
    id: 'node-teams-sprawl',
    pillarId: 'governance',
    title: 'Teams Lifecycle & Sprawl',
    subtitle: 'Orphaned Group Monitor',
    endpoint: '/v1.0/teams/getJoinedTeams',
    healthScore: 84,
    status: 'healthy',
    latency: 19,
    connectedEndpoints: 18,
    icon: Layers,
    angle: 88,
    radius: 305,
    policyDrifts: [],
    latencyHistory: [16, 20, 19, 18, 22, 19],
    jsonMetadata: {
      totalTeamsCount: 156,
      archivedTeams: 24,
      orphanedTeamsWithoutOwners: 2,
    },
  },

  // 3. Licensing Pillar
  {
    id: 'node-subscribed-skus',
    pillarId: 'licensing',
    title: 'Subscribed SKUs & Metering',
    subtitle: 'M365 E5 & Copilot Seats',
    endpoint: '/v1.0/subscribedSkus',
    healthScore: 91,
    status: 'healthy',
    latency: 14,
    connectedEndpoints: 8,
    icon: Database,
    angle: 120,
    radius: 210,
    policyDrifts: [],
    latencyHistory: [12, 15, 14, 16, 13, 14],
    jsonMetadata: {
      e5Purchased: 500,
      e5Assigned: 482,
      copilotLicensesPurchased: 250,
      copilotLicensesAssigned: 210,
    },
  },
  {
    id: 'node-inactive-accounts',
    pillarId: 'licensing',
    title: 'Inactive Account License Pruner',
    subtitle: 'Stale Assigned Licenses',
    endpoint: '/v1.0/users/delta',
    healthScore: 76,
    status: 'drift',
    latency: 22,
    connectedEndpoints: 10,
    icon: Database,
    angle: 142,
    radius: 315,
    policyDrifts: [
      {
        title: '34 Inactive Accounts Holding E5',
        severity: 'Low',
        timestamp: '1 hour ago',
        details: 'Accounts unlogged for >90 days consuming $1,224/mo in unused seats.',
      },
    ],
    latencyHistory: [20, 25, 22, 28, 21, 22],
    jsonMetadata: {
      inactiveUserCount: 34,
      potentialMonthlySavingsUSD: 1224,
    },
  },

  // 4. Adoption Pillar
  {
    id: 'node-workload-analytics',
    pillarId: 'adoption',
    title: 'Workload Usage Analytics',
    subtitle: 'M365 Active User Index',
    endpoint: '/v1.0/reports/getM365AppUserDetail',
    healthScore: 88,
    status: 'healthy',
    latency: 16,
    connectedEndpoints: 15,
    icon: Globe,
    angle: 172,
    radius: 200,
    policyDrifts: [],
    latencyHistory: [15, 17, 16, 18, 15, 16],
    jsonMetadata: {
      activeUsersMonthly: 462,
      teamsDailyActivePct: 92.1,
      exchangeDailyActivePct: 98.4,
    },
  },

  // 5. Copilot & AI Pillar
  {
    id: 'node-copilot-readiness',
    pillarId: 'copilot',
    title: 'Copilot Indexing Readiness',
    subtitle: 'Graph Semantic Search Index',
    endpoint: '/v1.0/copilot/readiness',
    healthScore: 42,
    status: 'alert',
    latency: 35,
    connectedEndpoints: 32,
    icon: Sparkles,
    angle: 220,
    radius: 205,
    policyDrifts: [
      {
        title: 'Unprotected Sensitive Data Ingestion',
        severity: 'High',
        timestamp: 'Just now',
        details: 'Copilot grounding search indexing unclassified SharePoint salary reports.',
      },
    ],
    latencyHistory: [30, 39, 35, 42, 36, 35],
    jsonMetadata: {
      indexedDocumentsCount: 1452000,
      unclassifiedIndexedDocs: 312000,
      groundingRiskIndex: 'High Exposure',
    },
  },
  {
    id: 'node-grounding-exposure',
    pillarId: 'copilot',
    title: 'Semantic Search Exposure Guard',
    subtitle: 'AI Grounding DLP Policy',
    endpoint: '/v1.0/search/query',
    healthScore: 35,
    status: 'alert',
    latency: 48,
    connectedEndpoints: 24,
    icon: Cpu,
    angle: 242,
    radius: 320,
    policyDrifts: [
      {
        title: 'Purview Sensitivity Label Gap',
        severity: 'High',
        timestamp: '3 mins ago',
        details: '65% of executive OneDrive folders lack sensitivity label enforcement.',
      },
    ],
    latencyHistory: [40, 52, 48, 55, 46, 48],
    jsonMetadata: {
      labelledDocumentsPct: 35,
      unlabelledFinancialSpreadsheets: 4200,
      dlpRestrictionStatus: 'Gaps Found',
    },
  },

  // 6. Compliance Pillar
  {
    id: 'node-exchange-dlp',
    pillarId: 'compliance',
    title: 'Exchange DLP Enforcement',
    subtitle: 'PII & Financial Rule Engine',
    endpoint: '/v1.0/security/securityActions',
    healthScore: 62,
    status: 'drift',
    latency: 28,
    connectedEndpoints: 16,
    icon: Lock,
    angle: 275,
    radius: 200,
    policyDrifts: [
      {
        title: 'Outbound Credit Card Rule Exemption',
        severity: 'Medium',
        timestamp: '18 mins ago',
        details: 'Finance distribution group exempt from automatic email encryption.',
      },
    ],
    latencyHistory: [24, 31, 28, 33, 27, 28],
    jsonMetadata: {
      dlpRulesActive: 12,
      exemptUserGroups: 1,
      blockedOutboundPiiCount24h: 142,
    },
  },

  // 7. Tenant Health Pillar
  {
    id: 'node-service-announcements',
    pillarId: 'health',
    title: 'Service Announcement Health API',
    subtitle: 'M365 Incident Telemetry',
    endpoint: '/v1.0/admin/serviceAnnouncement/issues',
    healthScore: 95,
    status: 'healthy',
    latency: 12,
    connectedEndpoints: 6,
    icon: Server,
    angle: 325,
    radius: 215,
    policyDrifts: [],
    latencyHistory: [10, 13, 12, 14, 11, 12],
    jsonMetadata: {
      activeIncidents: 0,
      activeAdvisories: 1,
      overallTenantStatus: 'Healthy',
    },
  },
];

export interface HolographicRadarViewProps {
  tenantName?: string;
  readinessScore?: number;
  riskLevel?: 'Low' | 'Medium' | 'High' | 'Critical';
  highlightNodeId?: string;
  onSelectNode?: (node: any) => void;
  isTensionMode?: boolean;
  isClosingMode?: boolean;
}

export const HolographicRadarView: React.FC<HolographicRadarViewProps> = ({
  tenantName = 'Contoso Electronics (Prod)',
  readinessScore = 78,
  riskLevel = 'Medium',
  highlightNodeId,
  onSelectNode,
}) => {
  // Viewport Pan / Zoom State
  const [scale, setScale] = useState<number>(0.62);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Tenant State
  const [selectedTenant, setSelectedTenant] = useState<TenantOption>(MOCK_TENANTS[0]);
  const [nodes, setNodes] = useState<GraphNodeData[]>(BASE_GRAPH_NODES);

  // Filters State
  const [selectedPillarFilter, setSelectedPillarFilter] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Node Inspection Drawer State
  const [activeInspectorNode, setActiveInspectorNode] = useState<GraphNodeData | null>(null);
  const [isTestRunning, setIsTestRunning] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ code: number; text: string; latency: number } | null>(null);
  const [remediationModalNode, setRemediationModalNode] = useState<GraphNodeData | null>(null);
  const [isJsonExpanded, setIsJsonExpanded] = useState<boolean>(false);

  // Live Telemetry Console Dock State
  const [isConsoleOpen, setIsConsoleOpen] = useState<boolean>(true);
  const [telemetryLogs, setTelemetryLogs] = useState<TelemetryLog[]>([]);
  const [isConsolePaused, setIsConsolePaused] = useState<boolean>(false);
  const [isConsoleAutoScroll, setIsConsoleAutoScroll] = useState<boolean>(true);
  const [consoleSearch, setConsoleSearch] = useState<string>('');
  const [consoleStatusFilter, setConsoleStatusFilter] = useState<string>('all');
  const [consoleMethodFilter, setConsoleMethodFilter] = useState<string>('all');
  const consoleBottomRef = useRef<HTMLDivElement>(null);

  // Initial Telemetry Seed & Continuous Background Logger
  useEffect(() => {
    const initialLogs: TelemetryLog[] = [
      {
        id: 'log-1',
        timestamp: new Date().toLocaleTimeString(),
        method: 'GET',
        endpoint: '/v1.0/identity/conditionalAccess/policies',
        statusCode: 200,
        latency: 38,
        statusText: 'OK',
        tenantId: selectedTenant.id,
      },
      {
        id: 'log-2',
        timestamp: new Date().toLocaleTimeString(),
        method: 'GET',
        endpoint: '/v1.0/sites/getAllSites',
        statusCode: 200,
        latency: 42,
        statusText: 'OK',
        tenantId: selectedTenant.id,
      },
      {
        id: 'log-3',
        timestamp: new Date().toLocaleTimeString(),
        method: 'POST',
        endpoint: '/v1.0/security/alerts_v2/query',
        statusCode: 429,
        latency: 18,
        statusText: 'Too Many Requests (Throttled)',
        tenantId: selectedTenant.id,
      },
      {
        id: 'log-4',
        timestamp: new Date().toLocaleTimeString(),
        method: 'GET',
        endpoint: '/v1.0/copilot/readiness',
        statusCode: 200,
        latency: 35,
        statusText: 'OK',
        tenantId: selectedTenant.id,
      },
    ];
    setTelemetryLogs(initialLogs);
  }, []);

  // Live streaming log simulation
  useEffect(() => {
    if (isConsolePaused) return;

    const interval = setInterval(() => {
      const sampleEndpoints = nodes.map((n) => ({ endpoint: n.endpoint, node: n }));
      const randomNodeObj = sampleEndpoints[Math.floor(Math.random() * sampleEndpoints.length)];
      const methods: ('GET' | 'POST' | 'PATCH' | 'DELETE')[] = ['GET', 'GET', 'GET', 'POST', 'PATCH'];
      const statusCodes: (200 | 401 | 429 | 500)[] = [200, 200, 200, 200, 429, 200, 500];

      const method = methods[Math.floor(Math.random() * methods.length)];
      const statusCode = statusCodes[Math.floor(Math.random() * statusCodes.length)];
      const latency = Math.floor(12 + Math.random() * 45);

      let statusText = 'OK';
      if (statusCode === 429) statusText = 'Rate Limit Throttled (429)';
      else if (statusCode === 500) statusText = 'Internal Service Error';
      else if (statusCode === 401) statusText = 'Unauthorized Token Expiry';

      const newLog: TelemetryLog = {
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
        timestamp: new Date().toLocaleTimeString(),
        method,
        endpoint: randomNodeObj.endpoint,
        statusCode,
        latency,
        statusText,
        tenantId: selectedTenant.id,
      };

      setTelemetryLogs((prev) => [...prev.slice(-99), newLog]);
    }, 2800);

    return () => clearInterval(interval);
  }, [isConsolePaused, nodes, selectedTenant]);

  // Auto-scroll telemetry log console
  useEffect(() => {
    if (isConsoleAutoScroll && isConsoleOpen) {
      consoleBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [telemetryLogs, isConsoleAutoScroll, isConsoleOpen]);

  // Pan & Zoom Mouse Event Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 || e.button === 1) { // Left click or middle click
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    setScale((prev) => Math.min(2.5, Math.max(0.4, prev * zoomFactor)));
  };

  const resetViewport = () => {
    setScale(0.62);
    setPan({ x: 0, y: 0 });
  };

  const zoomToFit = () => {
    setScale(0.58);
    setPan({ x: 0, y: 0 });
  };

  // Switch Tenant Logic
  const handleTenantChange = (tenant: TenantOption) => {
    audioSynth.playHoverTick();
    setSelectedTenant(tenant);

    // Adjust node health scores based on selected tenant
    setNodes((prev) =>
      prev.map((node) => {
        if (tenant.id === 'tenant-fabrikam') {
          return { ...node, healthScore: Math.min(100, node.healthScore + 20), status: 'healthy', policyDrifts: [] };
        } else if (tenant.id === 'tenant-northwind') {
          return {
            ...node,
            healthScore: Math.max(25, node.healthScore - 22),
            status: node.healthScore < 60 ? 'alert' : 'drift',
          };
        }
        return BASE_GRAPH_NODES.find((b) => b.id === node.id) || node;
      })
    );
  };

  // Run Graph Diagnostic Ping Simulator
  const handleRunGraphTest = (node: GraphNodeData) => {
    audioSynth.playHoverTick();
    setIsTestRunning(true);
    setTestResult(null);

    setTimeout(() => {
      setIsTestRunning(false);
      const rand = Math.random();
      let code: 200 | 429 | 500 = 200;
      let text = '200 OK — Graph API Endpoint Responding Healthy';
      if (rand > 0.8) {
        code = 429;
        text = '429 Too Many Requests — Throttled by Graph Gateway';
      } else if (rand > 0.92) {
        code = 500;
        text = '500 Internal Server Error — Policy Evaluation Failed';
      }

      setTestResult({
        code,
        text,
        latency: Math.floor(14 + Math.random() * 32),
      });

      // Append test to live log dock
      setTelemetryLogs((prev) => [
        ...prev,
        {
          id: `log-test-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          method: 'GET',
          endpoint: node.endpoint,
          statusCode: code,
          latency: Math.floor(14 + Math.random() * 32),
          statusText: text,
          tenantId: selectedTenant.id,
        },
      ]);
    }, 1200);
  };

  // Execute Remediation Action
  const handleApplyRemediation = (node: GraphNodeData) => {
    audioSynth.playAlertPulse();

    // Mark node as healthy
    setNodes((prev) =>
      prev.map((n) =>
        n.id === node.id
          ? {
              ...n,
              healthScore: 98,
              status: 'healthy',
              policyDrifts: [],
            }
          : n
      )
    );

    if (activeInspectorNode?.id === node.id) {
      setActiveInspectorNode((prev) =>
        prev
          ? {
              ...prev,
              healthScore: 98,
              status: 'healthy',
              policyDrifts: [],
            }
          : null
      );
    }

    setRemediationModalNode(null);
  };

  // Export Topology Schema JSON
  const handleExportJson = () => {
    audioSynth.playHoverTick();
    const schema = {
      tenant: selectedTenant,
      exportedAt: new Date().toISOString(),
      pillars: PILLARS,
      nodes,
      telemetrySample: telemetryLogs.slice(-20),
    };

    const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `M365_Topology_${selectedTenant.id}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filter Nodes based on Search, Pillar & Status
  const filteredNodes = useMemo(() => {
    return nodes.filter((n) => {
      const matchesSearch =
        searchQuery === '' ||
        n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.endpoint.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.subtitle.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesPillar = selectedPillarFilter === 'all' || n.pillarId === selectedPillarFilter;
      const matchesStatus = selectedStatusFilter === 'all' || n.status === selectedStatusFilter;

      return matchesSearch && matchesPillar && matchesStatus;
    });
  }, [nodes, searchQuery, selectedPillarFilter, selectedStatusFilter]);

  // Filter Telemetry Logs
  const filteredLogs = useMemo(() => {
    return telemetryLogs.filter((log) => {
      const matchesSearch =
        consoleSearch === '' ||
        log.endpoint.toLowerCase().includes(consoleSearch.toLowerCase()) ||
        log.statusText.toLowerCase().includes(consoleSearch.toLowerCase());

      const matchesStatus =
        consoleStatusFilter === 'all' || log.statusCode.toString() === consoleStatusFilter;

      const matchesMethod = consoleMethodFilter === 'all' || log.method === consoleMethodFilter;

      return matchesSearch && matchesStatus && matchesMethod;
    });
  }, [telemetryLogs, consoleSearch, consoleStatusFilter, consoleMethodFilter]);

  return (
    <div
      className={`relative w-full h-full min-h-[520px] bg-slate-950 text-slate-100 flex flex-col overflow-hidden font-sans select-none ${
        isFullscreen ? 'fixed inset-0 z-50 p-4 bg-slate-950' : ''
      }`}
    >
      {/* =========================================================================
          2. MAIN CANVAS AREA: Interactive Radial Pillar Canvas & Zoom Viewport
      ========================================================================= */}
      <div
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className="relative flex-1 w-full h-full overflow-hidden cursor-grab active:cursor-grabbing bg-slate-950"
      >
        {/* Architectural Dot Grid Background */}
        <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-60 pointer-events-none" />

        {/* Viewport Control Floating Buttons */}
        <div className="absolute top-3 left-3 z-20 flex flex-col gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800 backdrop-blur-md shadow-xl">
          <button
            onClick={() => setScale((prev) => Math.min(2.5, prev * 1.15))}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-cyan-300 transition-all cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => setScale((prev) => Math.max(0.4, prev * 0.85))}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-cyan-300 transition-all cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={resetViewport}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-cyan-300 transition-all cursor-pointer text-[10px] font-mono font-bold"
            title="Reset Viewport"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            onClick={zoomToFit}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-cyan-300 transition-all cursor-pointer"
            title="Zoom to Fit Canvas"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Floating Pillar Legend Bar */}
        <div className="absolute top-3 right-3 z-20 hidden lg:flex items-center gap-2 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-800 backdrop-blur-md text-[11px]">
          {PILLARS.map((p) => (
            <div
              key={p.id}
              onClick={() => setSelectedPillarFilter(selectedPillarFilter === p.id ? 'all' : p.id)}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md cursor-pointer transition-all ${
                selectedPillarFilter === p.id
                  ? 'bg-slate-800 text-white font-semibold ring-1 ring-cyan-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
              <span>{p.name}</span>
            </div>
          ))}
        </div>

        {/* TRANSFORMED CANVAS ENGINE SURFACE */}
        <div
          className="absolute inset-0 flex items-center justify-center transform-gpu transition-transform duration-75"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: 'center center',
          }}
        >
          <div className="relative w-[850px] h-[850px] flex items-center justify-center">
            {/* -----------------------------------------------------------------
                RADIAL PILLAR SECTORS / ANNULAR RINGS (7 Colors)
            ----------------------------------------------------------------- */}
            <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none">
              <defs>
                {PILLARS.map((p) => (
                  <radialGradient key={`grad-${p.id}`} id={`pillar-grad-${p.id}`} cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor={p.color} stopOpacity="0.12" />
                    <stop offset="70%" stopColor={p.color} stopOpacity="0.04" />
                    <stop offset="100%" stopColor={p.color} stopOpacity="0.0" />
                  </radialGradient>
                ))}
                <filter id="glow-light" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Concentric Holographic Radar Distance Rings */}
              <circle cx="425" cy="425" r="100" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" fill="none" opacity="0.4" />
              <circle cx="425" cy="425" r="210" stroke="#334155" strokeWidth="1" strokeDasharray="4 4" fill="none" opacity="0.5" />
              <circle cx="425" cy="425" r="320" stroke="#334155" strokeWidth="1" strokeDasharray="5 5" fill="none" opacity="0.6" />

              {/* 7 Sector Background Arcs & Radial Divider Spokes */}
              {PILLARS.map((p) => {
                const startRad = ((p.angleStart - 90) * Math.PI) / 180;
                const endRad = ((p.angleEnd - 90) * Math.PI) / 180;

                const x1 = 425 + 380 * Math.cos(startRad);
                const y1 = 425 + 380 * Math.sin(startRad);
                const x2 = 425 + 380 * Math.cos(endRad);
                const y2 = 425 + 380 * Math.sin(endRad);

                // Pie slice path
                const pathData = `M 425 425 L ${x1} ${y1} A 380 380 0 0 1 ${x2} ${y2} Z`;

                const isFilteredOut = selectedPillarFilter !== 'all' && selectedPillarFilter !== p.id;

                return (
                  <g key={`sector-${p.id}`} opacity={isFilteredOut ? 0.15 : 0.85}>
                    {/* Sector Background Fill */}
                    <path d={pathData} fill={`url(#pillar-grad-${p.id})`} />

                    {/* Radial Divider Spoke Line */}
                    <line x1="425" y1="425" x2={x1} y2={y1} stroke={p.color} strokeWidth="1" opacity="0.3" strokeDasharray="2 2" />
                  </g>
                );
              })}

              {/* Rotating Holographic Radar Sweep Beam */}
              <g className="animate-spin-radar" style={{ transformOrigin: '425px 425px' }}>
                <line x1="425" y1="425" x2="425" y2="45" stroke="#06b6d4" strokeWidth="1.5" opacity="0.8" filter="url(#glow-light)" />
                <path d="M 425 425 L 425 45 A 380 380 0 0 1 580 110 Z" fill="url(#pillar-grad-security)" opacity="0.25" />
              </g>

              {/* -----------------------------------------------------------------
                  ANIMATED CUBIC BÉZIER DATA CONNECTION LINKS
              ----------------------------------------------------------------- */}
              {filteredNodes.map((node) => {
                const angleRad = ((node.angle - 90) * Math.PI) / 180;
                const targetX = 425 + node.radius * Math.cos(angleRad);
                const targetY = 425 + node.radius * Math.sin(angleRad);

                // Curve control point
                const ctrlX = 425 + (node.radius * 0.5) * Math.cos(angleRad + 0.15);
                const ctrlY = 425 + (node.radius * 0.5) * Math.sin(angleRad + 0.15);

                const pillar = PILLARS.find((p) => p.id === node.pillarId);
                const strokeColor = node.status === 'alert' ? '#EF4444' : node.status === 'drift' ? '#F59E0B' : pillar?.color || '#10B981';

                return (
                  <g key={`link-${node.id}`}>
                    {/* Cubic Bézier Line */}
                    <path
                      d={`M 425 425 Q ${ctrlX} ${ctrlY} ${targetX} ${targetY}`}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={node.status === 'alert' ? 2 : 1.2}
                      opacity={node.status === 'alert' ? 0.8 : 0.45}
                      strokeDasharray={node.status === 'drift' ? '4 4' : 'none'}
                    />

                    {/* Pulse Dot Travelling along Bézier Line */}
                    <circle r={node.status === 'alert' ? 3.5 : 2.5} fill={strokeColor} filter="url(#glow-light)">
                      <animateMotion
                        path={`M 425 425 Q ${ctrlX} ${ctrlY} ${targetX} ${targetY}`}
                        dur={`${2.5 + (node.latency / 20)}s`}
                        repeatCount="indefinite"
                      />
                    </circle>
                  </g>
                );
              })}
            </svg>

            {/* -----------------------------------------------------------------
                CENTRAL TENANT CORE HUB
            ----------------------------------------------------------------- */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center justify-center">
              <motion.div
                animate={{ scale: [1, 1.04, 1] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                className="relative w-36 h-36 rounded-full bg-slate-900/95 border-2 border-cyan-400/80 p-3 shadow-[0_0_40px_rgba(6,182,212,0.35)] backdrop-blur-xl flex flex-col items-center justify-center text-center group cursor-pointer"
                onClick={() => {
                  audioSynth.playHoverTick();
                  resetViewport();
                }}
              >
                <div className="absolute -inset-2 rounded-full border border-cyan-500/30 animate-ping opacity-25 pointer-events-none" />
                <Server className="w-7 h-7 text-cyan-400 mb-1" />
                <span className="text-[11px] font-bold text-white tracking-tight leading-tight line-clamp-1">
                  {selectedTenant.name.split(' ')[0]}
                </span>
                <span className="text-[9px] font-mono text-cyan-300/80 uppercase tracking-widest mt-0.5">
                  M365 Core Hub
                </span>
                <div className="mt-1 flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-500/40 text-[9px] font-mono font-bold text-cyan-200">
                  <Activity className="w-2.5 h-2.5 text-emerald-400 animate-pulse" />
                  <span>{selectedTenant.healthScore}% OK</span>
                </div>
              </motion.div>
            </div>

            {/* -----------------------------------------------------------------
                GRAPH SATELLITE NODES
            ----------------------------------------------------------------- */}
            {filteredNodes.map((node) => {
              const angleRad = ((node.angle - 90) * Math.PI) / 180;
              const nodeX = 425 + node.radius * Math.cos(angleRad);
              const nodeY = 425 + node.radius * Math.sin(angleRad);

              const NodeIcon = node.icon;
              const pillar = PILLARS.find((p) => p.id === node.pillarId);

              const isSelected = activeInspectorNode?.id === node.id;
              const isHighlightFromParent = highlightNodeId === node.id;

              const isAlert = node.status === 'alert';
              const isDrift = node.status === 'drift';

              return (
                <motion.div
                  key={node.id}
                  style={{ left: `${nodeX}px`, top: `${nodeY}px` }}
                  onClick={() => {
                    audioSynth.playHoverTick();
                    setActiveInspectorNode(node);
                    onSelectNode?.(node);
                  }}
                  whileHover={{ scale: 1.12, zIndex: 30 }}
                  whileTap={{ scale: 0.95 }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 z-15 cursor-pointer w-40 p-2.5 rounded-2xl backdrop-blur-xl border transition-all duration-300 shadow-xl group ${
                    isSelected || isHighlightFromParent
                      ? 'ring-2 ring-cyan-400 bg-slate-900/95 border-cyan-300 shadow-[0_0_25px_rgba(6,182,212,0.4)] z-30'
                      : isAlert
                      ? 'bg-slate-900/90 border-rose-500/80 text-rose-100 shadow-[0_0_20px_rgba(239,68,68,0.3)]'
                      : isDrift
                      ? 'bg-slate-900/90 border-amber-500/80 text-amber-100 shadow-[0_0_20px_rgba(245,158,11,0.25)]'
                      : 'bg-slate-900/85 border-slate-700/80 hover:border-slate-500 text-slate-200'
                  }`}
                >
                  {/* Alert Beacon Pulse */}
                  {(isAlert || isDrift) && (
                    <span
                      className={`absolute -top-1 -right-1 w-3 h-3 rounded-full animate-ping ${
                        isAlert ? 'bg-rose-500' : 'bg-amber-500'
                      }`}
                    />
                  )}

                  {/* Header: Icon & Health Circular Score */}
                  <div className="flex items-center justify-between mb-1.5">
                    <div
                      className="p-1.5 rounded-lg border flex items-center justify-center"
                      style={{
                        borderColor: pillar?.color || '#0078D4',
                        backgroundColor: `${pillar?.color || '#0078D4'}22`,
                      }}
                    >
                      <NodeIcon className="w-3.5 h-3.5" style={{ color: pillar?.color || '#0078D4' }} />
                    </div>

                    <div className="flex items-center gap-1 font-mono text-[10px] font-bold">
                      <span className="text-slate-400">{node.latency}ms</span>
                      <span
                        className={`px-1.5 py-0.2 rounded-md ${
                          isAlert
                            ? 'bg-rose-950 text-rose-300 border border-rose-700/50'
                            : isDrift
                            ? 'bg-amber-950 text-amber-300 border border-amber-700/50'
                            : 'bg-emerald-950 text-emerald-300 border border-emerald-700/50'
                        }`}
                      >
                        {node.healthScore}%
                      </span>
                    </div>
                  </div>

                  {/* Title & Subtitle */}
                  <h4 className="text-[11px] font-bold text-slate-100 leading-snug line-clamp-1 group-hover:text-cyan-300 transition-colors">
                    {node.title}
                  </h4>
                  <p className="text-[9px] text-slate-400 line-clamp-1 mb-1">{node.subtitle}</p>

                  {/* Graph Endpoint Monospace Badge */}
                  <div className="flex items-center gap-1 text-[8.5px] font-mono text-slate-400 bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-800/80 truncate">
                    <FileCode className="w-2.5 h-2.5 text-cyan-400 shrink-0" />
                    <span className="truncate">{node.endpoint}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      {/* =========================================================================
          3. SLIDE-OVER NODE INSPECTOR DRAWER
      ========================================================================= */}
      <AnimatePresence>
        {activeInspectorNode && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
            className="absolute top-0 right-0 bottom-0 w-full sm:w-96 z-40 bg-slate-900/95 border-l border-slate-800 backdrop-blur-2xl shadow-2xl p-4 flex flex-col justify-between overflow-y-auto"
          >
            <div>
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-cyan-950/80 border border-cyan-500/40 text-cyan-300">
                    {React.createElement(activeInspectorNode.icon, { className: 'w-5 h-5' })}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white leading-tight">{activeInspectorNode.title}</h3>
                    <p className="text-xs text-slate-400">{activeInspectorNode.subtitle}</p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveInspectorNode(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Endpoint Path & Health Meter */}
              <div className="space-y-3">
                <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 text-xs font-mono">
                  <span className="text-slate-500 text-[10px] block mb-0.5">M365 GRAPH ENDPOINT</span>
                  <span className="text-cyan-300 font-bold break-all">{activeInspectorNode.endpoint}</span>
                </div>

                {/* Health & Status Breakdown */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 flex flex-col items-center justify-center">
                    <span className="text-[10px] text-slate-400 mb-1">HEALTH INDEX</span>
                    <span
                      className={`text-xl font-bold font-mono ${
                        activeInspectorNode.healthScore > 80
                          ? 'text-emerald-400'
                          : activeInspectorNode.healthScore > 60
                          ? 'text-amber-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {activeInspectorNode.healthScore}%
                    </span>
                  </div>

                  <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 flex flex-col items-center justify-center">
                    <span className="text-[10px] text-slate-400 mb-1">STATUS STATE</span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-xs font-bold uppercase font-mono ${
                        activeInspectorNode.status === 'healthy'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50'
                          : activeInspectorNode.status === 'drift'
                          ? 'bg-amber-950 text-amber-300 border border-amber-700/50'
                          : 'bg-rose-950 text-rose-300 border border-rose-700/50'
                      }`}
                    >
                      {activeInspectorNode.status}
                    </span>
                  </div>
                </div>

                {/* Policy Drift List */}
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold text-slate-300 flex items-center justify-between">
                    <span>Active Policy Drifts ({activeInspectorNode.policyDrifts.length})</span>
                    <span className="text-[10px] text-slate-500 font-mono">Detected via Purview</span>
                  </h4>

                  {activeInspectorNode.policyDrifts.length === 0 ? (
                    <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                      <span>Zero policy violations or configuration drift detected.</span>
                    </div>
                  ) : (
                    activeInspectorNode.policyDrifts.map((d, i) => (
                      <div
                        key={i}
                        className="p-2.5 rounded-xl bg-rose-950/30 border border-rose-500/40 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-rose-200">{d.title}</span>
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-rose-900 text-rose-200 uppercase">
                            {d.severity}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-300 leading-snug">{d.details}</p>
                        <p className="text-[9.5px] text-slate-500 font-mono">{d.timestamp}</p>
                      </div>
                    ))
                  )}
                </div>

                {/* Latency History Sparkline */}
                <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-mono">Latency History (ms)</span>
                    <span className="text-cyan-400 font-bold font-mono">{activeInspectorNode.latency} ms avg</span>
                  </div>
                  <div className="h-10 flex items-end gap-1.5 pt-2">
                    {activeInspectorNode.latencyHistory.map((val, idx) => (
                      <div
                        key={idx}
                        className="flex-1 bg-cyan-500/40 hover:bg-cyan-400 rounded-t transition-all"
                        style={{ height: `${(val / 60) * 100}%` }}
                        title={`${val} ms`}
                      />
                    ))}
                  </div>
                </div>

                {/* Graph API Diagnostics Simulator */}
                <div className="space-y-2">
                  <button
                    onClick={() => handleRunGraphTest(activeInspectorNode)}
                    disabled={isTestRunning}
                    className="w-full py-2 rounded-xl bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isTestRunning ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                        <span>Ping M365 Graph Gateway...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Run Live M365 Graph Diagnostic Test</span>
                      </>
                    )}
                  </button>

                  {testResult && (
                    <div
                      className={`p-2.5 rounded-xl border text-xs font-mono space-y-1 ${
                        testResult.code === 200
                          ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                          : testResult.code === 429
                          ? 'bg-amber-950/50 border-amber-500/40 text-amber-200'
                          : 'bg-rose-950/50 border-rose-500/40 text-rose-200'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold">
                        <span>HTTP Response: {testResult.code}</span>
                        <span>{testResult.latency}ms</span>
                      </div>
                      <p className="text-[11px] leading-tight">{testResult.text}</p>
                    </div>
                  )}
                </div>

                {/* Remediation Dispatcher Button */}
                <button
                  onClick={() => setRemediationModalNode(activeInspectorNode)}
                  className="w-full py-2 rounded-xl bg-slate-800 hover:bg-rose-950 border border-slate-700 hover:border-rose-500 text-slate-200 hover:text-rose-200 text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Shield className="w-3.5 h-3.5 text-rose-400" />
                  <span>Dispatch One-Click Remediation</span>
                </button>

                {/* Raw Telemetry JSON Viewer */}
                <div className="border border-slate-800 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setIsJsonExpanded(!isJsonExpanded)}
                    className="w-full px-3 py-2 bg-slate-950 text-slate-400 hover:text-slate-200 text-xs font-mono font-bold flex items-center justify-between cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <FileJson className="w-3.5 h-3.5 text-cyan-400" /> Raw Node Metadata JSON
                    </span>
                    {isJsonExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  {isJsonExpanded && (
                    <pre className="p-3 bg-slate-950/90 text-[10px] font-mono text-cyan-300/90 overflow-x-auto max-h-40 border-t border-slate-800/80">
                      {JSON.stringify(activeInspectorNode.jsonMetadata, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =========================================================================
          4. SAFETY CONFIRMATION REMEDIATION MODAL
      ========================================================================= */}
      <AnimatePresence>
        {remediationModalNode && (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl"
            >
              <div className="flex items-center gap-3 text-rose-400 border-b border-slate-800 pb-3">
                <Shield className="w-6 h-6 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-white">Confirm Policy Remediation</h3>
                  <p className="text-xs text-slate-400">{remediationModalNode.title}</p>
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs space-y-2 text-slate-300">
                <p>You are about to dispatch automated remediation to M365 Graph Gateway:</p>
                <ul className="list-disc pl-4 space-y-1 text-slate-400">
                  <li>Enforce baseline security & sensitivity label rules</li>
                  <li>Revoke anonymous guest links or uncompliant tokens</li>
                  <li>Re-evaluate node health index to 100%</li>
                </ul>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setRemediationModalNode(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleApplyRemediation(remediationModalNode)}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-lg shadow-rose-950 cursor-pointer flex items-center gap-1.5"
                >
                  <Zap className="w-3.5 h-3.5" /> Enforce Remediation Now
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* =========================================================================
          5. BOTTOM LIVE TELEMETRY LOG & TERMINAL DOCK
      ========================================================================= */}
      <div className="z-30 w-full bg-slate-900/95 border-t border-slate-800 backdrop-blur-md transition-all duration-300">
        {/* Dock Header Toggle Bar */}
        <div
          onClick={() => setIsConsoleOpen(!isConsoleOpen)}
          className="px-4 py-1.5 flex items-center justify-between text-xs font-mono font-bold text-slate-300 hover:text-cyan-300 cursor-pointer select-none border-b border-slate-800/50 bg-slate-950/60"
        >
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-cyan-400" />
            <span>M365 Graph API Live Telemetry Stream</span>
            <span className="px-2 py-0.2 rounded-full bg-cyan-950 border border-cyan-500/40 text-[10px] text-cyan-300">
              {telemetryLogs.length} Events
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-slate-500 hidden sm:inline">Click to {isConsoleOpen ? 'Collapse' : 'Expand'}</span>
            {isConsoleOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </div>
        </div>

        {/* Collapsible Terminal Body */}
        {isConsoleOpen && (
          <div className="p-2 space-y-2">
            {/* Terminal Controls Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 flex-1 max-w-lg">
                <input
                  type="text"
                  placeholder="Filter logs by endpoint..."
                  value={consoleSearch}
                  onChange={(e) => setConsoleSearch(e.target.value)}
                  className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 flex-1"
                />

                <select
                  value={consoleStatusFilter}
                  onChange={(e) => setConsoleStatusFilter(e.target.value)}
                  className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none cursor-pointer"
                >
                  <option value="all">All HTTP Codes</option>
                  <option value="200">200 OK</option>
                  <option value="429">429 Throttle</option>
                  <option value="500">500 Error</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsConsolePaused(!isConsolePaused)}
                  className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-all flex items-center gap-1 cursor-pointer ${
                    isConsolePaused
                      ? 'bg-amber-950 border-amber-500/50 text-amber-300'
                      : 'bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                >
                  {isConsolePaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                  <span>{isConsolePaused ? 'Resume' : 'Pause'}</span>
                </button>

                <button
                  onClick={() => setTelemetryLogs([])}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium transition-all cursor-pointer"
                >
                  Clear Console
                </button>
              </div>
            </div>

            {/* Scrollable Telemetry Rows */}
            <div className="h-28 overflow-y-auto bg-slate-950 p-2 rounded-xl border border-slate-800/80 font-mono text-[10.5px] space-y-1">
              {filteredLogs.length === 0 ? (
                <div className="text-slate-600 text-center py-6 italic">No streaming telemetry events match filter.</div>
              ) : (
                filteredLogs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between gap-2 hover:bg-slate-900/60 p-0.5 rounded">
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-slate-500">{log.timestamp}</span>
                      <span
                        className={`px-1 rounded text-[9.5px] font-bold ${
                          log.method === 'GET'
                            ? 'bg-blue-950 text-blue-300'
                            : log.method === 'POST'
                            ? 'bg-emerald-950 text-emerald-300'
                            : 'bg-purple-950 text-purple-300'
                        }`}
                      >
                        {log.method}
                      </span>
                      <span className="text-cyan-300 truncate">{log.endpoint}</span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span
                        className={`font-bold ${
                          log.statusCode === 200
                            ? 'text-emerald-400'
                            : log.statusCode === 429
                            ? 'text-amber-400'
                            : 'text-rose-400'
                        }`}
                      >
                        {log.statusCode}
                      </span>
                      <span className="text-slate-400">{log.latency}ms</span>
                    </div>
                  </div>
                ))
              )}
              <div ref={consoleBottomRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
