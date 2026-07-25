import React, { useState, useMemo } from 'react';
import {
  GitCommit,
  GitBranch,
  ShieldCheck,
  KeyRound,
  Smartphone,
  Mail,
  Users2,
  DollarSign,
  Activity,
  Clock,
  Zap,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Search,
  SlidersHorizontal,
  RefreshCw,
  Maximize2,
  Minimize2,
  ChevronRight,
  Play,
  Check,
  Eye,
  X,
  ArrowRight,
  ShieldAlert,
  Layers,
  Building2,
  Lock,
  Flame,
  FileCode,
  ExternalLink,
  ChevronDown,
  Sparkles,
  Info,
  CheckCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tenant } from '../../types';

export interface CanvasScanNode {
  id: string;
  type: 'root_scan' | 'pillar' | 'event' | 'remediation';
  pillarCategory?:
    | 'Identity & Access'
    | 'Security & Threats'
    | 'Conditional Access & Policy'
    | 'Devices & Intune'
    | 'Exchange & Mail Flow'
    | 'Collaboration & Groups'
    | 'Licensing & Cost Engine';
  title: string;
  description: string;
  severity?: 'critical' | 'warning' | 'info' | 'resolved';
  timestamp: string;
  scoreImpact?: number;
  scoreBefore?: number;
  scoreAfter?: number;
  rawGraphDiff?: {
    entity: string;
    endpoint: string;
    beforeState: Record<string, any>;
    afterState: Record<string, any>;
  };
  remediationActionId?: string;
  remediationActionName?: string;
  status: 'active_drift' | 'remediated' | 'ignored' | 'scanning' | 'passed';
  childNodeIds?: string[];
  affectedResource?: string;
}

interface TenantScanTimelineCanvasProps {
  tenants?: Tenant[];
  selectedTenant?: Tenant | null;
  onSelectTenant?: (tenant: Tenant | null) => void;
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
}

// Historical Scans Mock
const HISTORICAL_SCANS = [
  { id: 'SCN-8840', time: '10 mins ago', label: 'Scan #8840 (Current)', driftsCount: 3, scoreDelta: '+5%' },
  { id: 'SCN-8839', time: '15 mins ago', label: 'Scan #8839', driftsCount: 4, scoreDelta: '0%' },
  { id: 'SCN-8838', time: '1 hour ago', label: 'Scan #8838', driftsCount: 6, scoreDelta: '-2%' },
  { id: 'SCN-8837', time: '3 hours ago', label: 'Scan #8837', driftsCount: 2, scoreDelta: '+8%' },
  { id: 'SCN-8836', time: '12 hours ago', label: 'Scan #8836', driftsCount: 5, scoreDelta: '+3%' },
  { id: 'SCN-8835', time: '24 hours ago', label: 'Scan #8835', driftsCount: 7, scoreDelta: '-4%' },
];

const INITIAL_NODES: CanvasScanNode[] = [
  // ROOT
  {
    id: 'root-scan-8840',
    type: 'root_scan',
    title: 'Graph API Session #SCN-8840',
    description: '122 M365 Endpoints Polled • 100% Execution Complete',
    timestamp: '2026-07-23 22:05:00',
    status: 'scanning',
    childNodeIds: [
      'pillar-identity',
      'pillar-security',
      'pillar-ca',
      'pillar-intune',
      'pillar-exchange',
      'pillar-teams',
      'pillar-licensing',
    ],
  },

  // 7 PILLARS
  {
    id: 'pillar-identity',
    type: 'pillar',
    pillarCategory: 'Identity & Access',
    title: 'Identity & Access',
    description: 'Entra ID Users, PIM Roles & MFA Enforcements',
    timestamp: '2026-07-23 22:05:02',
    scoreImpact: 4,
    scoreBefore: 80,
    scoreAfter: 84,
    status: 'active_drift',
    childNodeIds: ['event-global-admin-add', 'remediation-mfa-alex'],
  },
  {
    id: 'pillar-security',
    type: 'pillar',
    pillarCategory: 'Security & Threats',
    title: 'Security & Threats',
    description: 'Defender XDR Alerts, Risky Users & Incident Graphs',
    timestamp: '2026-07-23 22:05:04',
    scoreImpact: 8,
    scoreBefore: 64,
    scoreAfter: 72,
    status: 'active_drift',
    childNodeIds: ['event-forwarding-rule'],
  },
  {
    id: 'pillar-ca',
    type: 'pillar',
    pillarCategory: 'Conditional Access & Policy',
    title: 'Conditional Access & Policy',
    description: 'Entra CA Policy Baseline & Device Compliance Controls',
    timestamp: '2026-07-23 22:05:06',
    scoreImpact: 0,
    scoreBefore: 90,
    scoreAfter: 90,
    status: 'active_drift',
    childNodeIds: ['event-ca-drift'],
  },
  {
    id: 'pillar-intune',
    type: 'pillar',
    pillarCategory: 'Devices & Intune',
    title: 'Devices & Intune',
    description: 'MDM Enrollment, BitLocker Encryption & Patch Levels',
    timestamp: '2026-07-23 22:05:08',
    scoreImpact: 12,
    scoreBefore: 56,
    scoreAfter: 68,
    status: 'passed',
  },
  {
    id: 'pillar-exchange',
    type: 'pillar',
    pillarCategory: 'Exchange & Mail Flow',
    title: 'Exchange & Mail Flow',
    description: 'Transport Rules, Quarantine & Anti-Phishing Guardrails',
    timestamp: '2026-07-23 22:05:10',
    scoreImpact: 2,
    scoreBefore: 92,
    scoreAfter: 94,
    status: 'passed',
  },
  {
    id: 'pillar-teams',
    type: 'pillar',
    pillarCategory: 'Collaboration & Groups',
    title: 'Collaboration & Groups',
    description: 'SharePoint External Sharing & Guest Access Policies',
    timestamp: '2026-07-23 22:05:12',
    scoreImpact: 0,
    scoreBefore: 81,
    scoreAfter: 81,
    status: 'passed',
  },
  {
    id: 'pillar-licensing',
    type: 'pillar',
    pillarCategory: 'Licensing & Cost Engine',
    title: 'Licensing & Cost Engine',
    description: 'SKU Allocation & Waste Recovery ($540/mo saved)',
    timestamp: '2026-07-23 22:05:14',
    scoreImpact: 5,
    scoreBefore: 83,
    scoreAfter: 88,
    status: 'passed',
  },

  // EVENTS (DRIFTS)
  {
    id: 'event-global-admin-add',
    type: 'event',
    pillarCategory: 'Identity & Access',
    title: 'New User Promoted to Global Admin Role',
    description: 'Privileged role elevated without PIM activation request',
    severity: 'critical',
    timestamp: '22:05:03',
    affectedResource: 'alex.b@contoso.com (UPN: 9814-12)',
    remediationActionId: 'action-revoke-ga',
    remediationActionName: 'Revoke GA & Enforce PIM Step-Up',
    status: 'active_drift',
    scoreImpact: 5,
    rawGraphDiff: {
      entity: 'directoryRoles/companyAdministrator',
      endpoint: '/v1.0/directoryRoles/62e90394-69f5-4237-9190-012177145e10/members/$ref',
      beforeState: {
        roleMembersCount: 3,
        members: ['admin@contoso.com', 'm.vance@msp.com', 'sec-service@contoso.com'],
      },
      afterState: {
        roleMembersCount: 4,
        members: [
          'admin@contoso.com',
          'm.vance@msp.com',
          'sec-service@contoso.com',
          'alex.b@contoso.com (ADDED 2m ago)',
        ],
      },
    },
  },
  {
    id: 'event-ca-drift',
    type: 'event',
    pillarCategory: 'Conditional Access & Policy',
    title: 'Conditional Access Policy State Drift',
    description: 'Policy CA-01-RequireMFA modified from Enforced to Disabled',
    severity: 'critical',
    timestamp: '22:05:07',
    affectedResource: 'Policy GUID: 7e2f9b10-21a4-4e89-9132',
    remediationActionId: 'action-reenable-ca',
    remediationActionName: 'Force-Reenable CA-01 Policy via Graph API',
    status: 'active_drift',
    scoreImpact: 8,
    rawGraphDiff: {
      entity: 'identity/conditionalAccess/policies/7e2f9b10',
      endpoint: '/v1.0/identity/conditionalAccess/policies/7e2f9b10-21a4-4e89-9132',
      beforeState: {
        displayName: 'CA-01-RequireMFA-AllUsers',
        state: 'enabled',
        grantControls: { operator: 'OR', builtInControls: ['mfa'] },
      },
      afterState: {
        displayName: 'CA-01-RequireMFA-AllUsers',
        state: 'disabled',
        grantControls: { operator: 'OR', builtInControls: ['mfa'] },
        modifiedBy: 'unauthorized_app_id_981a',
      },
    },
  },
  {
    id: 'event-forwarding-rule',
    type: 'event',
    pillarCategory: 'Security & Threats',
    title: 'External Inbox Auto-Forwarding Rule Created',
    description: 'Mailbox set to forward all incoming financial emails to external address',
    severity: 'warning',
    timestamp: '22:05:05',
    affectedResource: 'cfo.mailbox@contoso.com',
    remediationActionId: 'action-remove-[#0078d4]',
    remediationActionName: 'Purge Forwarding Rule & Block Recipient Domain',
    status: 'active_drift',
    scoreImpact: 6,
    rawGraphDiff: {
      entity: 'users/cfo.mailbox/mailFolders/inbox/messageRules',
      endpoint: '/v1.0/users/cfo.mailbox@contoso.com/mailFolders/inbox/messageRules/rule_881a',
      beforeState: { rulesCount: 1 },
      afterState: {
        ruleId: 'rule_881a',
        displayName: 'AutoForwardToExternal',
        actions: { forwardTo: [{ emailAddress: { address: 'external-hacker@gmail.com' } }] },
      },
    },
  },

  // REMEDIATIONS (OUTCOMES)
  {
    id: 'remediation-mfa-alex',
    type: 'remediation',
    pillarCategory: 'Identity & Access',
    title: 'Action Completed: Revoked GA & Enforced PIM on Alex B.',
    description: 'Automated workflow executed in 850ms • Security Score +5%',
    timestamp: '22:06:12',
    status: 'remediated',
    scoreImpact: 5,
    scoreBefore: 72,
    scoreAfter: 77,
  },
];

export const TenantScanTimelineCanvas: React.FC<TenantScanTimelineCanvasProps> = ({
  tenants = [],
  selectedTenant,
  onSelectTenant,
  onShowToast,
}) => {
  // Active state
  const [nodes, setNodes] = useState<CanvasScanNode[]>(INITIAL_NODES);
  const [selectedScanId, setSelectedScanId] = useState('SCN-8840');
  const [selectedNodeId, setSelectedNodeId] = useState<string>('event-global-admin-add');
  const [timelineIndex, setTimelineIndex] = useState<number>(0); // 0 = latest scan
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [viewMode, setViewMode] = useState<'dag' | 'timeline'>('dag');
  const [expandedPillars, setExpandedPillars] = useState<Record<string, boolean>>({
    'Identity & Access': true,
    'Security & Threats': true,
    'Conditional Access & Policy': true,
  });

  // Drawer inspection state
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [isExecutingWorkflow, setIsExecutingWorkflow] = useState(false);
  const [instantScanRunning, setInstantScanRunning] = useState(false);

  // Active Tenant
  const activeTenant = useMemo(() => {
    return selectedTenant || tenants[0] || { id: 'contoso-01', name: 'Contoso Corporation', primaryDomain: 'contoso.onmicrosoft.com' };
  }, [selectedTenant, tenants]);

  // Active selected node
  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === selectedNodeId) || nodes[0];
  }, [nodes, selectedNodeId]);

  // Pillar nodes list
  const pillarNodes = useMemo(() => {
    return nodes.filter((n) => n.type === 'pillar');
  }, [nodes]);

  // Event / Drift nodes list
  const eventNodes = useMemo(() => {
    return nodes.filter((n) => n.type === 'event');
  }, [nodes]);

  // Remediation nodes
  const remediationNodes = useMemo(() => {
    return nodes.filter((n) => n.type === 'remediation');
  }, [nodes]);

  // Metrics summary
  const summaryMetrics = useMemo(() => {
    const totalDrifts = eventNodes.length;
    const resolvedCount = eventNodes.filter((n) => n.status === 'remediated').length;
    const pendingCount = eventNodes.filter((n) => n.status === 'active_drift').length;
    const cumulativeGain = nodes.reduce((acc, n) => acc + (n.status === 'remediated' ? (n.scoreImpact || 0) : 0), 5);

    return {
      totalDrifts,
      resolvedCount,
      pendingCount,
      cumulativeGain: `+${cumulativeGain}%`,
    };
  }, [nodes, eventNodes]);

  // Toggle Pillar Expansion
  const togglePillarExpand = (pillarName: string) => {
    setExpandedPillars((prev) => ({ ...prev, [pillarName]: !prev[pillarName] }));
  };

  // Trigger Instant Scan Simulation
  const handleTriggerInstantScan = () => {
    setInstantScanRunning(true);
    onShowToast?.('info', 'Triggering Instant Full-Scan', 'Polling 122 Microsoft Graph API endpoints for ' + activeTenant.name + '...');
    setTimeout(() => {
      setInstantScanRunning(false);
      onShowToast?.('success', 'Full-Scan Complete (#SCN-8841)', 'All 7 governance pillars evaluated. 0 new security drifts detected.');
    }, 1800);
  };

  // Mock Workflow Remediation Dispatch
  const handleExecuteWorkflow = (nodeId: string, actionName?: string) => {
    setIsExecutingWorkflow(true);
    onShowToast?.('info', 'Dispatching Workflow Action', `Running async Graph API payload for "${actionName || 'Remediation'}"...`);

    setTimeout(() => {
      setIsExecutingWorkflow(false);

      // Update Node status
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id === nodeId) {
            return { ...n, status: 'remediated' as const };
          }
          return n;
        })
      );

      // Add a outcome remediation node
      const targetNode = nodes.find((n) => n.id === nodeId);
      const newRemediationNode: CanvasScanNode = {
        id: `remediation-auto-${Date.now()}`,
        type: 'remediation',
        pillarCategory: targetNode?.pillarCategory || 'Security & Threats',
        title: `Action Executed: ${actionName || 'Auto-Remediated Policy Drift'}`,
        description: `Executed via Graph API in 420ms • Pillar Score +${targetNode?.scoreImpact || 5}%`,
        timestamp: new Date().toTimeString().substring(0, 8),
        status: 'remediated',
        scoreImpact: targetNode?.scoreImpact || 5,
        scoreBefore: 72,
        scoreAfter: 72 + (targetNode?.scoreImpact || 5),
      };

      setNodes((prev) => [...prev, newRemediationNode]);
      onShowToast?.('success', 'Workflow Execution Succeeded', `Drift resolved on ${targetNode?.affectedResource || activeTenant.name}. Security Score increased by +${targetNode?.scoreImpact || 5}%.`);
    }, 1200);
  };

  const handleIgnoreDrift = (nodeId: string) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, status: 'ignored' as const } : n))
    );
    onShowToast?.('warning', 'Drift Added to Exception List', 'Marked drift as authorized exception for 30 days.');
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-[#e0e2ea] font-sans overflow-hidden select-none">
      
      {/* ========================================================================= */}
      {/* 1. COMMAND HEADER & TIME-TRAVEL SCRUBBER BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] p-4 shrink-0 space-y-3 shadow-sm">
        
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          
          {/* Tenant Picker & Scan Selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded bg-[#101419] border border-[#404752] text-[#a3c9ff]">
                <GitBranch className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-bold text-[#e0e2ea] tracking-tight">
                    Graph API Scan Timeline & Node DAG Canvas
                  </h1>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#0078d4]/10 text-[#a3c9ff] border border-[#0078d4]/30 font-semibold">
                    /portal/timeline
                  </span>
                </div>
                <div className="text-xs text-[#8a919e] flex items-center gap-2">
                  <span>Tenant:</span>
                  <select
                    value={activeTenant.id}
                    onChange={(e) => {
                      const t = tenants.find((x) => x.id === e.target.value) || null;
                      onSelectTenant?.(t);
                    }}
                    className="bg-[#101419] border border-[#404752] text-[#a3c9ff] text-xs font-semibold rounded px-2 py-0.5 outline-none focus:border-[#0078d4] cursor-pointer"
                  >
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.primaryDomain})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Scan session selector */}
            <div className="flex items-center gap-1.5 bg-[#101419] border border-[#404752] rounded px-2.5 py-1 text-xs">
              <Clock className="w-3.5 h-3.5 text-[#a3c9ff]" />
              <span className="text-[#8a919e]">Scan Session:</span>
              <select
                value={selectedScanId}
                onChange={(e) => {
                  setSelectedScanId(e.target.value);
                  onShowToast?.('info', 'Loaded Historical Scan', `Viewing node graph for ${e.target.value}.`);
                }}
                className="bg-transparent text-[#e0e2ea] font-mono font-bold focus:outline-none cursor-pointer"
              >
                {HISTORICAL_SCANS.map((s) => (
                  <option key={s.id} value={s.id} className="bg-[#181c22]">
                    {s.label} ({s.driftsCount} Drifts)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Canvas View Controls & Trigger Button */}
          <div className="flex items-center gap-2 flex-wrap">
            
            {/* Zoom Controls */}
            <div className="flex items-center bg-[#101419] border border-[#404752] rounded p-0.5 text-xs">
              <button
                onClick={() => setZoomLevel(Math.max(60, zoomLevel - 10))}
                className="px-2 py-1 hover:bg-[#272a30] text-[#8a919e] hover:text-[#e0e2ea] rounded cursor-pointer font-mono font-bold"
                title="Zoom Out"
              >
                -
              </button>
              <span className="px-2 text-[11px] font-mono font-bold text-[#a3c9ff]">
                {zoomLevel}%
              </span>
              <button
                onClick={() => setZoomLevel(Math.min(140, zoomLevel + 10))}
                className="px-2 py-1 hover:bg-[#272a30] text-[#8a919e] hover:text-[#e0e2ea] rounded cursor-pointer font-mono font-bold"
                title="Zoom In"
              >
                +
              </button>
              <button
                onClick={() => setZoomLevel(100)}
                className="px-2 py-1 hover:bg-[#272a30] text-[#8a919e] hover:text-[#e0e2ea] rounded cursor-pointer text-[10.5px]"
                title="Reset Zoom"
              >
                Fit
              </button>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center bg-[#101419] border border-[#404752] rounded p-0.5 text-xs">
              <button
                onClick={() => setViewMode('dag')}
                className={cn(
                  'px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-all',
                  viewMode === 'dag'
                    ? 'bg-[#0078d4] text-white'
                    : 'text-[#8a919e] hover:text-[#e0e2ea]'
                )}
              >
                Node Board
              </button>
              <button
                onClick={() => setViewMode('timeline')}
                className={cn(
                  'px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-all',
                  viewMode === 'timeline'
                    ? 'bg-[#0078d4] text-white'
                    : 'text-[#8a919e] hover:text-[#e0e2ea]'
                )}
              >
                Linear Timeline
              </button>
            </div>

            {/* Trigger Scan Button */}
            <button
              onClick={handleTriggerInstantScan}
              disabled={instantScanRunning}
              className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-white ${instantScanRunning ? 'animate-spin' : ''}`} />
              <span>{instantScanRunning ? 'Polling Endpoints...' : 'Trigger Instant Scan'}</span>
            </button>
          </div>

        </div>

        {/* Time-Travel Scrubbing Slider Bar */}
        <div className="bg-[#101419] border border-[#404752] rounded p-2.5 flex items-center gap-3 text-xs">
          <div className="font-semibold text-[#8a919e] shrink-0 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-[#a3c9ff]" />
            <span>Time-Travel Scrubbing (24h):</span>
          </div>

          <div className="flex-1 flex items-center gap-2">
            <input
              type="range"
              min="0"
              max={HISTORICAL_SCANS.length - 1}
              value={timelineIndex}
              onChange={(e) => {
                const idx = parseInt(e.target.value, 10);
                setTimelineIndex(idx);
                setSelectedScanId(HISTORICAL_SCANS[idx].id);
              }}
              className="w-full accent-[#0078d4] cursor-pointer"
            />
            <span className="font-mono text-[#a3c9ff] font-bold text-xs shrink-0 bg-[#181c22] px-2 py-0.5 rounded border border-[#404752]">
              {HISTORICAL_SCANS[timelineIndex].time} ({HISTORICAL_SCANS[timelineIndex].id})
            </span>
          </div>
        </div>

      </div>

      {/* ========================================================================= */}
      {/* 2. MAIN INTERACTIVE NODE CANVAS / TIMELINE AREA */}
      {/* ========================================================================= */}
      <div className="flex-1 flex relative overflow-hidden bg-[#0b0e14]">
        
        {/* CANVAS WORKSPACE (Left/Center) */}
        <div className="flex-1 overflow-auto p-6 scrollbar-thin relative" style={{ zoom: `${zoomLevel}%` }}>
          
          {viewMode === 'dag' ? (
            /* NODE BOARD DAG (Flowchart layout) */
            <div className="min-w-[1000px] space-y-8">
              
              {/* STAGE 1: ROOT SCAN NODE */}
              <div className="flex justify-center">
                <div
                  onClick={() => {
                    setSelectedNodeId(nodes[0].id);
                    setIsDrawerOpen(true);
                  }}
                  className={cn(
                    'bg-[#181c22] border-2 rounded-lg p-4 w-96 shadow-lg transition-all cursor-pointer relative',
                    selectedNodeId === nodes[0].id
                      ? 'border-[#0078d4] ring-2 ring-[#0078d4]/30'
                      : 'border-[#404752] hover:border-[#a3c9ff]'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded bg-[#0078d4]/20 border border-[#0078d4] text-[#a3c9ff]">
                        <Activity className="w-5 h-5 animate-pulse" />
                      </div>
                      <div>
                        <div className="text-[10px] font-mono text-[#8a919e] uppercase font-bold">
                          GRAPH API SCAN ENGINE
                        </div>
                        <div className="font-bold text-sm text-[#e0e2ea]">{nodes[0].title}</div>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-[#166534]/40 text-[#4ade80] border border-[#166534] text-[10px] font-mono font-bold">
                      100% COMPLETE
                    </span>
                  </div>
                  <p className="text-xs text-[#8a919e] mt-2 bg-[#101419] p-2 rounded border border-[#404752]/60">
                    {nodes[0].description}
                  </p>

                  {/* Connected Output Port Indicator */}
                  <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-[#0078d4] border-2 border-[#181c22] flex items-center justify-center text-white shadow-md">
                    <ChevronDown className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>

              {/* Connecting Visual SVG Line */}
              <div className="w-full h-8 flex justify-center">
                <div className="w-0.5 h-full bg-gradient-to-b from-[#0078d4] to-[#404752]" />
              </div>

              {/* STAGE 2: 7 GOVERNANCE PILLAR NODES GRID */}
              <div className="space-y-3">
                <div className="text-center text-xs font-bold text-[#8a919e] uppercase tracking-wider">
                  Governance Pillars Evaluated ({pillarNodes.length} Pillars)
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
                  {pillarNodes.map((pillar) => {
                    const isSelected = selectedNodeId === pillar.id;
                    const isExpanded = expandedPillars[pillar.pillarCategory || ''];
                    const hasDrifts = eventNodes.some((e) => e.pillarCategory === pillar.pillarCategory);

                    return (
                      <div
                        key={pillar.id}
                        onClick={() => {
                          setSelectedNodeId(pillar.id);
                          setIsDrawerOpen(true);
                          if (pillar.pillarCategory) togglePillarExpand(pillar.pillarCategory);
                        }}
                        className={cn(
                          'bg-[#181c22] border rounded-md p-3 transition-all cursor-pointer relative flex flex-col justify-between space-y-2',
                          isSelected
                            ? 'border-[#0078d4] ring-1 ring-[#0078d4]/50 bg-[#0078d4]/10'
                            : hasDrifts
                            ? 'border-amber-500/50 hover:border-amber-400'
                            : 'border-[#404752] hover:border-[#a3c9ff]'
                        )}
                      >
                        <div>
                          <div className="flex items-center justify-between text-[10.5px] text-[#8a919e] font-mono">
                            <span>PILLAR NODE</span>
                            {hasDrifts ? (
                              <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40">
                                Drift
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40">
                                Passed
                              </span>
                            )}
                          </div>
                          <h4 className="font-bold text-xs text-[#e0e2ea] mt-1 line-clamp-1">
                            {pillar.title}
                          </h4>
                        </div>

                        {/* Pillar Gauge */}
                        <div className="bg-[#101419] p-2 rounded border border-[#404752]">
                          <div className="flex items-center justify-between text-[11px] font-mono">
                            <span className="text-[#8a919e]">Score:</span>
                            <span className="font-bold text-[#4ade80]">{pillar.scoreAfter}%</span>
                          </div>
                          <div className="w-full bg-[#272a30] h-1.5 rounded-full mt-1 overflow-hidden">
                            <div
                              className="bg-[#0078d4] h-full rounded-full transition-all"
                              style={{ width: `${pillar.scoreAfter}%` }}
                            />
                          </div>
                        </div>

                        <div className="text-[10px] text-[#8a919e] flex items-center justify-between border-t border-[#404752]/60 pt-1.5">
                          <span>Delta: +{pillar.scoreImpact}%</span>
                          <ChevronDown className={cn('w-3 h-3 transition-transform', isExpanded ? 'rotate-180' : '')} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Connecting Visual Line */}
              <div className="w-full h-8 flex justify-center">
                <div className="w-0.5 h-full bg-gradient-to-b from-[#404752] to-amber-500/60" />
              </div>

              {/* STAGE 3: DETECTED DRIFTS & REMEDIATION OUTCOMES */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Detected Drifts Column */}
                <div className="bg-[#101419] border border-[#404752] rounded-md p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#404752] pb-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      <span className="font-bold text-xs text-[#e0e2ea] uppercase tracking-wider">
                        Detected Graph API Drifts ({eventNodes.length})
                      </span>
                    </div>
                    <span className="text-[10.5px] text-[#8a919e] font-mono">Real-time Telemetry</span>
                  </div>

                  <div className="space-y-2.5">
                    {eventNodes.map((event) => {
                      const isSelected = selectedNodeId === event.id;
                      return (
                        <div
                          key={event.id}
                          onClick={() => {
                            setSelectedNodeId(event.id);
                            setIsDrawerOpen(true);
                          }}
                          className={cn(
                            'p-3 rounded border transition-all cursor-pointer space-y-2',
                            isSelected
                              ? 'bg-[#0078d4]/15 border-[#0078d4] ring-1 ring-[#0078d4]/50'
                              : event.status === 'remediated'
                              ? 'bg-[#181c22] border-emerald-500/40 opacity-70'
                              : 'bg-[#181c22] border-[#404752] hover:border-amber-400'
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  'px-1.5 py-0.2 rounded text-[9.5px] font-mono font-bold uppercase',
                                  event.severity === 'critical'
                                    ? 'bg-red-950/80 text-red-300 border border-red-800'
                                    : 'bg-amber-950/80 text-amber-300 border border-amber-800'
                                )}
                              >
                                {event.severity}
                              </span>
                              <span className="text-[10px] font-mono text-[#a3c9ff] bg-[#101419] px-1.5 py-0.2 rounded border border-[#404752]">
                                {event.pillarCategory}
                              </span>
                            </div>

                            <span className="text-[10px] font-mono text-[#8a919e]">
                              {event.timestamp}
                            </span>
                          </div>

                          <div>
                            <h5 className="font-bold text-xs text-[#e0e2ea]">{event.title}</h5>
                            <p className="text-[11px] text-[#8a919e] mt-0.5">{event.description}</p>
                          </div>

                          <div className="flex items-center justify-between pt-1 border-t border-[#404752]/60 text-[10.5px]">
                            <span className="font-mono text-[#a3c9ff] truncate max-w-[220px]">
                              {event.affectedResource}
                            </span>

                            {event.status === 'remediated' ? (
                              <span className="text-emerald-400 font-bold flex items-center gap-1">
                                <CheckCircle className="w-3 h-3" /> Resolved
                              </span>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleExecuteWorkflow(event.id, event.remediationActionName);
                                }}
                                className="px-2 py-0.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-[10.5px] font-semibold cursor-pointer"
                              >
                                Quick Remediate
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Remediation & Score Increase Outcomes Column */}
                <div className="bg-[#101419] border border-[#404752] rounded-md p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#404752] pb-2">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-[#4ade80]" />
                      <span className="font-bold text-xs text-[#e0e2ea] uppercase tracking-wider">
                        Remediation Outcomes ({remediationNodes.length})
                      </span>
                    </div>
                    <span className="text-[10.5px] text-[#4ade80] font-mono font-bold">
                      Score Delta +14% Total
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {remediationNodes.map((rem) => (
                      <div
                        key={rem.id}
                        onClick={() => {
                          setSelectedNodeId(rem.id);
                          setIsDrawerOpen(true);
                        }}
                        className="bg-[#181c22] border border-emerald-500/40 p-3 rounded space-y-1.5 cursor-pointer hover:border-emerald-400 transition-all"
                      >
                        <div className="flex items-center justify-between text-[10px] font-mono">
                          <span className="text-[#4ade80] font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> VERIFIED WORKFLOW EXECUTION
                          </span>
                          <span className="text-[#8a919e]">{rem.timestamp}</span>
                        </div>

                        <h5 className="font-bold text-xs text-[#e0e2ea]">{rem.title}</h5>
                        <p className="text-[11px] text-[#8a919e]">{rem.description}</p>

                        <div className="flex items-center justify-between bg-[#101419] p-2 rounded border border-[#404752] text-xs font-mono">
                          <span className="text-[#8a919e]">Pillar Score Increase:</span>
                          <span className="text-[#4ade80] font-bold">
                            {rem.scoreBefore}% ➔ {rem.scoreAfter}% (+{rem.scoreImpact}%)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

            </div>
          ) : (
            /* LINEAR TIMELINE VIEW */
            <div className="max-w-4xl mx-auto space-y-4">
              <div className="text-xs font-bold text-[#a3c9ff] uppercase tracking-wider mb-2">
                Linear Graph API Audit Event Stream (Chronological)
              </div>

              <div className="relative border-l-2 border-[#0078d4] pl-6 space-y-6">
                {nodes.map((node, index) => (
                  <div
                    key={node.id}
                    onClick={() => {
                      setSelectedNodeId(node.id);
                      setIsDrawerOpen(true);
                    }}
                    className="relative bg-[#181c22] border border-[#404752] rounded p-4 hover:border-[#a3c9ff] transition-all cursor-pointer space-y-2"
                  >
                    {/* Node Circle Marker */}
                    <div className="absolute -left-[31px] top-4 w-4 h-4 rounded-full bg-[#0078d4] border-2 border-[#0b0e14]" />

                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-[#a3c9ff] font-bold uppercase">{node.type} NODE</span>
                      <span className="text-[#8a919e]">{node.timestamp}</span>
                    </div>

                    <h4 className="font-bold text-sm text-[#e0e2ea]">{node.title}</h4>
                    <p className="text-xs text-[#8a919e]">{node.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* ========================================================================= */}
        {/* 3. NODE INSPECTION & REMEDIATION DRAWER (SLIDE-OUT RIGHT PANEL) */}
        {/* ========================================================================= */}
        {isDrawerOpen && (
          <div className="w-96 bg-[#181c22] border-l border-[#404752] flex flex-col shrink-0 z-20 shadow-xl overflow-y-auto">
            
            {/* Drawer Header */}
            <div className="p-4 bg-[#101419] border-b border-[#404752] flex items-center justify-between">
              <div>
                <div className="text-[10px] font-mono text-[#8a919e] uppercase font-bold">
                  NODE INSPECTION DRAWER
                </div>
                <h3 className="font-bold text-sm text-[#e0e2ea] mt-0.5 line-clamp-1">
                  {selectedNode.title}
                </h3>
              </div>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="p-1 rounded text-[#8a919e] hover:text-white hover:bg-[#272a30] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="p-4 space-y-4 text-xs">
              
              {/* Type & Pillar Meta */}
              <div className="bg-[#101419] border border-[#404752] p-3 rounded space-y-2">
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-[#8a919e]">Node Type:</span>
                  <span className="text-[#a3c9ff] font-bold uppercase">{selectedNode.type}</span>
                </div>
                {selectedNode.pillarCategory && (
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-[#8a919e]">Governance Pillar:</span>
                    <span className="text-[#e0e2ea] font-semibold">{selectedNode.pillarCategory}</span>
                  </div>
                )}
                {selectedNode.affectedResource && (
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-[#8a919e]">Target Entity:</span>
                    <span className="text-[#4ade80] font-semibold truncate max-w-[180px]">
                      {selectedNode.affectedResource}
                    </span>
                  </div>
                )}
              </div>

              {/* Raw Graph API Change Payload (Before vs After Diff) */}
              {selectedNode.rawGraphDiff ? (
                <div className="space-y-2">
                  <div className="font-bold text-[#a3c9ff] uppercase tracking-wider text-[10.5px] flex items-center gap-1">
                    <FileCode className="w-3.5 h-3.5" />
                    <span>Raw Graph API Telemetry Diff</span>
                  </div>

                  <div className="bg-[#101419] border border-[#404752] rounded p-2.5 font-mono text-[10.5px] space-y-2">
                    <div className="text-[#8a919e] truncate">
                      Endpoint: {selectedNode.rawGraphDiff.endpoint}
                    </div>

                    <div className="grid grid-cols-2 gap-2 border-t border-[#404752] pt-2">
                      <div className="space-y-1">
                        <span className="text-red-400 font-bold block">BEFORE STATE</span>
                        <pre className="text-[9.5px] text-[#8a919e] overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(selectedNode.rawGraphDiff.beforeState, null, 2)}
                        </pre>
                      </div>

                      <div className="space-y-1 border-l border-[#404752] pl-2">
                        <span className="text-emerald-400 font-bold block">AFTER STATE</span>
                        <pre className="text-[9.5px] text-[#e0e2ea] overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(selectedNode.rawGraphDiff.afterState, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-[#101419] p-3 rounded border border-[#404752] text-[#8a919e] text-center italic">
                  No structural diff payload available for this root or pillar node.
                </div>
              )}

              {/* Pillar Impact Analysis */}
              <div className="bg-[#101419] border border-[#404752] p-3 rounded space-y-1.5">
                <div className="font-bold text-[#4ade80] flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Pillar Impact & Score Delta</span>
                </div>
                <p className="text-[#8a919e] leading-relaxed">
                  Executing remediation on this node will increase the {selectedNode.pillarCategory || 'Security'} pillar score by{' '}
                  <strong className="text-[#4ade80]">+{selectedNode.scoreImpact || 5}%</strong> and improve overall tenant compliance.
                </p>
              </div>

              {/* Direct 1-Click Remediation Action Bar */}
              {selectedNode.type === 'event' && selectedNode.status !== 'remediated' && (
                <div className="space-y-2 pt-2 border-t border-[#404752]">
                  <button
                    onClick={() => handleExecuteWorkflow(selectedNode.id, selectedNode.remediationActionName)}
                    disabled={isExecutingWorkflow}
                    className="w-full py-2 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Zap className={`w-4 h-4 ${isExecutingWorkflow ? 'animate-spin' : ''}`} />
                    <span>
                      {isExecutingWorkflow ? 'Executing Graph API...' : selectedNode.remediationActionName || 'Execute Workflow Remediation'}
                    </span>
                  </button>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleIgnoreDrift(selectedNode.id)}
                      className="py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded font-semibold text-[11px] cursor-pointer"
                    >
                      Ignore Drift / Exception
                    </button>
                    <button
                      onClick={() =>
                        onShowToast?.('info', 'Incident Exported to PSA', `Ticket created for ${selectedNode.title}.`)
                      }
                      className="py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded font-semibold text-[11px] cursor-pointer"
                    >
                      Export PSA Ticket
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* 4. FOOTER: PILLAR SCORE INCREASE & VALUE DELIVERED FOOTER */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-t border-[#404752] p-3 shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        
        <div className="flex items-center gap-4 flex-wrap text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-[#8a919e]">Total Drifts Discovered:</span>
            <span className="font-mono font-bold text-[#e0e2ea] bg-[#101419] px-2 py-0.5 rounded border border-[#404752]">
              {summaryMetrics.totalDrifts}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[#8a919e]">Auto-Healed via Workflows:</span>
            <span className="font-mono font-bold text-[#4ade80] bg-[#166534]/30 px-2 py-0.5 rounded border border-[#166534]">
              {summaryMetrics.resolvedCount}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[#8a919e]">Pending Tech Actions:</span>
            <span className="font-mono font-bold text-amber-300 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800">
              {summaryMetrics.pendingCount}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[#8a919e]">Cumulative Security Score Increase Today:</span>
          <span className="font-mono font-bold text-sm text-[#4ade80] bg-[#101419] px-2.5 py-0.5 rounded border border-[#404752]">
            {summaryMetrics.cumulativeGain}
          </span>
        </div>

      </div>

    </div>
  );
};
