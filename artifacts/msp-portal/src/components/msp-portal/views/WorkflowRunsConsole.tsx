import React, { useState, useMemo, useEffect } from 'react';
import {
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  RotateCcw,
  Terminal,
  Zap,
  Search,
  Filter,
  SlidersHorizontal,
  RefreshCw,
  Layers,
  GitBranch,
  Activity,
  FileText,
  Sparkles,
  ChevronRight,
  Building2,
  Pause,
  Download,
  X,
  Code2,
  Copy,
  Check,
  Calendar,
  BarChart3,
  Settings,
  ArrowUpRight,
  TrendingUp,
  Cpu,
  Radio,
  Server
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tenant } from '../../types';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type TriggerSource = 'cron' | 'webhook' | 'manual' | 'alert';
export type RunStatus = 'success' | 'failed' | 'running' | 'retried';
export type StepStatus = 'success' | 'failed' | 'skipped' | 'running' | 'pending';

export interface WorkflowStep {
  stepNumber: number;
  name: string;
  status: StepStatus;
  durationMs: number;
  errorDetails?: string;
  logOutput?: string[];
}

export interface WorkflowRun {
  id: string;
  runCode: string;
  workflowName: string;
  category: string;
  tenantId: string;
  tenantName: string;
  triggerSource: TriggerSource;
  status: RunStatus;
  startedAt: string;
  durationMs: number;
  completedSteps: number;
  totalSteps: number;
  targetResource: string;
  errorMessage: string | null;
  steps: WorkflowStep[];
  inputPayload: Record<string, any>;
  outputPayload: Record<string, any>;
  rawLogs: { time: string; level: 'INFO' | 'WARN' | 'ERROR'; msg: string }[];
}

interface WorkflowRunsConsoleProps {
  tenants?: Tenant[];
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
}

// ============================================================================
// INITIAL MOCK WORKFLOW RUNS DATA
// ============================================================================

const INITIAL_RUNS: WorkflowRun[] = [
  {
    id: 'run-88402',
    runCode: 'RUN-88402',
    workflowName: 'Auto-Heal Conditional Access Drift & Re-enforce Baseline',
    category: 'Conditional Access',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    triggerSource: 'cron',
    status: 'failed',
    startedAt: '14:32:01',
    durationMs: 1420,
    completedSteps: 2,
    totalSteps: 4,
    targetResource: 'CAP-Baseline-MFA-Strict',
    errorMessage: 'Graph API Error 429: Too Many Requests. Rate Limit Exceeded on /identity/conditionalAccess/policies.',
    steps: [
      { stepNumber: 1, name: 'Authorize Graph API Bearer Token', status: 'success', durationMs: 120, logOutput: ['Fetched OAuth 2.0 app token from Azure Key Vault', 'Token validated for tenant Contoso (t-1)'] },
      { stepNumber: 2, name: 'Fetch Live CA Policy State', status: 'success', durationMs: 450, logOutput: ['GET /identity/conditionalAccess/policies', 'Received 18 active policies'] },
      { stepNumber: 3, name: 'Evaluate Policy Drift against MSP Baseline', status: 'failed', durationMs: 850, errorDetails: 'HTTP 429 Rate Limit hit during parallel Graph query', logOutput: ['[WARN] Graph throttle header detected', '[ERROR] HTTP 429: Rate Limit Exceeded'] },
      { stepNumber: 4, name: 'Dispatch Auto-Heal Patch & PSA Ticket', status: 'skipped', durationMs: 0, logOutput: ['Step skipped due to previous failure'] }
    ],
    inputPayload: {
      tenantId: 't-1',
      baselineVersion: 'v2.4.1',
      enforceMode: 'AutoRemediate',
      policIds: ['cap-01', 'cap-02', 'cap-03']
    },
    outputPayload: {
      status: 'TERMINATED_ERR',
      stepsExecuted: 2,
      errorCode: 'GRAPH_429_THROTTLED',
      retryRecommendedAfterSeconds: 60
    },
    rawLogs: [
      { time: '14:32:01.012', level: 'INFO', msg: 'Initiating Cron Workflow RUN-88402 for tenant Contoso Pharmaceuticals' },
      { time: '14:32:01.132', level: 'INFO', msg: 'Step 1 complete: Auth token acquired in 120ms' },
      { time: '14:32:01.582', level: 'INFO', msg: 'Step 2 complete: CA policy tree downloaded (18 policies)' },
      { time: '14:32:02.432', level: 'ERROR', msg: 'Step 3 FAILED: Graph API throttled (HTTP 429). Retry-After: 60s' },
      { time: '14:32:02.435', level: 'WARN', msg: 'Workflow execution aborted. Alert dispatched to NOC queue.' }
    ]
  },
  {
    id: 'run-88403',
    runCode: 'RUN-88403',
    workflowName: 'Revoke Compromised Inbox Auto-Forwarding Rules',
    category: 'Exchange / Mail',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    triggerSource: 'alert',
    status: 'success',
    startedAt: '14:30:15',
    durationMs: 890,
    completedSteps: 3,
    totalSteps: 3,
    targetResource: 'alex.wilson@contosobio.com',
    errorMessage: null,
    steps: [
      { stepNumber: 1, name: 'Verify Defender Alert Payload', status: 'success', durationMs: 110, logOutput: ['Alert ID: ALT-99120 confirmed valid', 'Target user: alex.wilson@contosobio.com'] },
      { stepNumber: 2, name: 'Purge External Inbox Rule via Graph', status: 'success', durationMs: 540, logOutput: ['DELETE /users/alex.wilson.../messageRules/rule-99', 'Rule removed successfully'] },
      { stepNumber: 3, name: 'Force User Session Revocation', status: 'success', durationMs: 240, logOutput: ['POST /users/.../revokeSignInSessions', 'User sessions invalidated'] }
    ],
    inputPayload: {
      alertId: 'ALT-99120',
      userUpn: 'alex.wilson@contosobio.com',
      destinationRuleAddress: 'external-audit-shadow@gmail.com'
    },
    outputPayload: {
      status: 'COMPLETED_SUCCESS',
      ruleDeleted: true,
      sessionsRevoked: true,
      actionTimestamp: '2026-07-24T14:30:15Z'
    },
    rawLogs: [
      { time: '14:30:15.001', level: 'INFO', msg: 'Event Webhook triggered workflow RUN-88403' },
      { time: '14:30:15.111', level: 'INFO', msg: 'Step 1: Alert signature verified' },
      { time: '14:30:15.651', level: 'INFO', msg: 'Step 2: Forwarding rule purged from Inbox' },
      { time: '14:30:15.891', level: 'INFO', msg: 'Step 3: User refresh tokens invalidated across all devices' }
    ]
  },
  {
    id: 'run-88404',
    runCode: 'RUN-88404',
    workflowName: 'Hourly Entra ID Identity Protection Risk Scan',
    category: 'Identity / MFA',
    tenantId: 't-2',
    tenantName: 'Vanguard Legal Partners',
    triggerSource: 'cron',
    status: 'success',
    startedAt: '14:00:00',
    durationMs: 2150,
    completedSteps: 4,
    totalSteps: 4,
    targetResource: 'Vanguard Entra ID Directory (420 Users)',
    errorMessage: null,
    steps: [
      { stepNumber: 1, name: 'Fetch Risky Users List from Entra', status: 'success', durationMs: 620 },
      { stepNumber: 2, name: 'Query Risk Detections Log', status: 'success', durationMs: 710 },
      { stepNumber: 3, name: 'Evaluate Impossible Travel Sign-ins', status: 'success', durationMs: 520 },
      { stepNumber: 4, name: 'Generate Risk Summary Telemetry', status: 'success', durationMs: 300 }
    ],
    inputPayload: {
      tenantId: 't-2',
      riskThreshold: 'MediumOrHigher',
      scanWindowMinutes: 60
    },
    outputPayload: {
      riskyUsersFound: 0,
      impossibleTravelEvents: 0,
      status: 'CLEAN'
    },
    rawLogs: [
      { time: '14:00:00.005', level: 'INFO', msg: 'Scheduled hourly Entra ID Risk Scan started' },
      { time: '14:00:02.155', level: 'INFO', msg: 'Scan finished. 0 risky users flagged.' }
    ]
  },
  {
    id: 'run-88405',
    runCode: 'RUN-88405',
    workflowName: 'Intune Device Non-Compliance Network Isolation',
    category: 'Intune',
    tenantId: 't-3',
    tenantName: 'Apex Logistics & Freight',
    triggerSource: 'webhook',
    status: 'running',
    startedAt: '14:34:10',
    durationMs: 320,
    completedSteps: 1,
    totalSteps: 3,
    targetResource: 'APEX-MBP-042 (MacBook Pro M3)',
    errorMessage: null,
    steps: [
      { stepNumber: 1, name: 'Validate Intune Compliance Webhook Payload', status: 'success', durationMs: 320 },
      { stepNumber: 2, name: 'Issue Intune Network Isolation Command', status: 'running', durationMs: 0 },
      { stepNumber: 3, name: 'Send Security Notification to Asset Owner', status: 'pending', durationMs: 0 }
    ],
    inputPayload: {
      deviceId: 'device-apex-mbp-042',
      complianceState: 'nonCompliant',
      failedReason: 'FileVault Encryption Disabled'
    },
    outputPayload: {},
    rawLogs: [
      { time: '14:34:10.012', level: 'INFO', msg: 'Webhook event received from Intune Compliance Engine' },
      { time: '14:34:10.332', level: 'INFO', msg: 'Step 1 complete. Executing Step 2: Isolating device APEX-MBP-042...' }
    ]
  },
  {
    id: 'run-88406',
    runCode: 'RUN-88406',
    workflowName: 'PIM Role Self-Elevation Approval & Audit Logger',
    category: 'Identity / MFA',
    tenantId: 't-3',
    tenantName: 'Apex Logistics & Freight',
    triggerSource: 'manual',
    status: 'retried',
    startedAt: '13:45:22',
    durationMs: 3400,
    completedSteps: 4,
    totalSteps: 4,
    targetResource: 'Global Admin PIM Elevation (tech.david@msp.com)',
    errorMessage: null,
    steps: [
      { stepNumber: 1, name: 'Verify Approval Signature', status: 'success', durationMs: 220 },
      { stepNumber: 2, name: 'Dispatch PIM Activation API Call', status: 'failed', durationMs: 1800, errorDetails: 'Transient Gateway Timeout (HTTP 504)' },
      { stepNumber: 3, name: 'Auto-Retry PIM Activation', status: 'success', durationMs: 980 },
      { stepNumber: 4, name: 'Log Elevation Record in MSP Audit Trail', status: 'success', durationMs: 400 }
    ],
    inputPayload: {
      requester: 'tech.david@msp.com',
      role: 'Global Administrator',
      durationHours: 4,
      ticketRef: 'CW-88410'
    },
    outputPayload: {
      pimAssignmentId: 'pim-assign-9921',
      expiresAt: '2026-07-24T17:45:22Z',
      status: 'RETIRED_SUCCESS'
    },
    rawLogs: [
      { time: '13:45:22.010', level: 'INFO', msg: 'Manual execution started by tech.david@msp.com' },
      { time: '13:45:24.030', level: 'WARN', msg: 'Step 2 failed with HTTP 504 Gateway Timeout. Invoking automatic retry policy (1/3)' },
      { time: '13:45:25.010', level: 'INFO', msg: 'Step 3 retry succeeded! PIM role assigned.' }
    ]
  },
  {
    id: 'run-88407',
    runCode: 'RUN-88407',
    workflowName: 'Monthly Stale Guest User Account Audit & Disabling',
    category: 'Security / Defender',
    tenantId: 't-4',
    tenantName: 'BioHealth Innovations',
    triggerSource: 'cron',
    status: 'success',
    startedAt: '12:00:00',
    durationMs: 4120,
    completedSteps: 5,
    totalSteps: 5,
    targetResource: 'Tenant Guest Identities (28 Users)',
    errorMessage: null,
    steps: [
      { stepNumber: 1, name: 'Fetch Guest Accounts Inactive > 90 Days', status: 'success', durationMs: 890 },
      { stepNumber: 2, name: 'Cross-Reference Active Sponsor Exceptions', status: 'success', durationMs: 650 },
      { stepNumber: 3, name: 'Disable Non-Responsive Guest Identities', status: 'success', durationMs: 1400 },
      { stepNumber: 4, name: 'Revoke Sharepoint Guest Permissions', status: 'success', durationMs: 820 },
      { stepNumber: 5, name: 'Send Compliance Report to CISO', status: 'success', durationMs: 360 }
    ],
    inputPayload: {
      tenantId: 't-4',
      inactivityDays: 90,
      autoDisable: true
    },
    outputPayload: {
      disabledGuestUsersCount: 22,
      sparedWithExceptionCount: 6,
      status: 'AUDIT_COMPLETE'
    },
    rawLogs: [
      { time: '12:00:00.001', level: 'INFO', msg: 'Cron monthly guest audit run started' },
      { time: '12:00:04.121', level: 'INFO', msg: '22 inactive guest accounts disabled successfully.' }
    ]
  },
  {
    id: 'run-88408',
    runCode: 'RUN-88408',
    workflowName: 'NCE License Optimization & Seat Reclamation Sync',
    category: 'Governance',
    tenantId: 't-5',
    tenantName: 'Meridian Capital Partners',
    triggerSource: 'cron',
    status: 'success',
    startedAt: '11:15:00',
    durationMs: 1650,
    completedSteps: 3,
    totalSteps: 3,
    targetResource: 'Meridian Subscriptions (M365 E3)',
    errorMessage: null,
    steps: [
      { stepNumber: 1, name: 'Calculate Unassigned License Buffer', status: 'success', durationMs: 410 },
      { stepNumber: 2, name: 'Query Partner Center NCE Renewal Window', status: 'success', durationMs: 820 },
      { stepNumber: 3, name: 'Update MSP Billing Ledger', status: 'success', durationMs: 420 }
    ],
    inputPayload: {
      tenantId: 't-5',
      skuName: 'SPE_E3'
    },
    outputPayload: {
      unassignedLicensesCount: 12,
      potentialMonthlySavingsUsd: 432
    },
    rawLogs: [
      { time: '11:15:00.002', level: 'INFO', msg: 'License optimization run completed.' }
    ]
  },
  {
    id: 'run-88409',
    runCode: 'RUN-88409',
    workflowName: 'Emergency Tenant Global Admin Security Lockout Purge',
    category: 'Security / Defender',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    triggerSource: 'alert',
    status: 'failed',
    startedAt: '10:12:00',
    durationMs: 980,
    completedSteps: 1,
    totalSteps: 3,
    targetResource: 'Global Admin: admin-temp@contosobio.com',
    errorMessage: 'Graph API Error 401: Unauthorized. Invalid credentials or expired client secret.',
    steps: [
      { stepNumber: 1, name: 'Parse Alert Payload', status: 'success', durationMs: 180 },
      { stepNumber: 2, name: 'Connect Graph Client App Credentials', status: 'failed', durationMs: 800, errorDetails: 'Client secret expired for AppId: 0029a-9912' },
      { stepNumber: 3, name: 'Isolate Admin Account', status: 'skipped', durationMs: 0 }
    ],
    inputPayload: {
      targetAdmin: 'admin-temp@contosobio.com',
      alertSource: 'Defender Identity'
    },
    outputPayload: {
      status: 'AUTH_FAILED',
      errorCode: 'AADSTS7000215'
    },
    rawLogs: [
      { time: '10:12:00.010', level: 'INFO', msg: 'Alert remediation workflow initiated' },
      { time: '10:12:00.990', level: 'ERROR', msg: 'Graph auth failure: AADSTS7000215: Invalid client secret provided.' }
    ]
  }
];

// Registered Workflow Catalog (View 3)
const REGISTERED_WORKFLOWS = [
  { id: 'wf-01', name: 'Auto-Heal Conditional Access Drift', cron: '*/5 * * * *', scheduleText: 'Every 5 Minutes', category: 'Conditional Access', autoRemediate: true, activeRunsToday: 288 },
  { id: 'wf-02', name: 'Entra ID Risky Sign-in Monitoring', cron: '0 * * * *', scheduleText: 'Hourly at :00', category: 'Identity / MFA', autoRemediate: false, activeRunsToday: 24 },
  { id: 'wf-03', name: 'Stale Guest Account 90-Day Purge', cron: '0 0 1 * *', scheduleText: '1st of Every Month', category: 'Security / Defender', autoRemediate: false, activeRunsToday: 1 },
  { id: 'wf-04', name: 'Exchange Inbox Forwarding Rule Guard', cron: 'Webhook Event', scheduleText: 'Real-Time Event Webhook', category: 'Exchange / Mail', autoRemediate: true, activeRunsToday: 14 },
  { id: 'wf-05', name: 'Intune Compliance Isolation Runner', cron: 'Webhook Event', scheduleText: 'Real-Time Event Webhook', category: 'Intune', autoRemediate: true, activeRunsToday: 9 },
  { id: 'wf-06', name: 'NCE License Reclamation Billing Sync', cron: '0 6 * * *', scheduleText: 'Daily at 06:00 AM UTC', category: 'Governance', autoRemediate: false, activeRunsToday: 1 }
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const WorkflowRunsConsole: React.FC<WorkflowRunsConsoleProps> = ({
  tenants = [],
  onShowToast
}) => {
  // Navigation View Sub-Tabs
  const [activeView, setActiveView] = useState<'runs' | 'analytics' | 'registry'>('runs');

  // Live Auto-Refresh Stream Toggle
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [queuePaused, setQueuePaused] = useState(false);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [tenantFilter, setTenantFilter] = useState('ALL');
  const [triggerFilter, setTriggerFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  // Workflow Runs Collection State
  const [runs, setRuns] = useState<WorkflowRun[]>(INITIAL_RUNS);
  const [selectedRunId, setSelectedRunId] = useState<string>('run-88402');

  // Inspector Sub-Tab state (JSON view vs Logs)
  const [inspectorTab, setInspectorTab] = useState<'dag' | 'payload' | 'terminal'>('dag');
  const [payloadTab, setPayloadTab] = useState<'input' | 'output'>('input');

  // Action State
  const [isReplaying, setIsReplaying] = useState(false);

  // Toast Helper
  const toast = (type: 'success' | 'info' | 'warning' | 'error', title: string, desc: string) => {
    if (onShowToast) onShowToast(type, title, desc);
  };

  // Currently Selected Run
  const selectedRun = useMemo(() => {
    return runs.find(r => r.id === selectedRunId) || runs[0];
  }, [runs, selectedRunId]);

  // Telemetry KPIs
  const kpis = useMemo(() => {
    const totalRunsToday = 14892;
    const successCount = runs.filter(r => r.status === 'success' || r.status === 'retried').length;
    const failedCount = runs.filter(r => r.status === 'failed').length;
    const runningCount = runs.filter(r => r.status === 'running').length;
    const avgLatencyMs = Math.round(runs.reduce((acc, r) => acc + r.durationMs, 0) / (runs.length || 1));

    return {
      totalRunsToday,
      successRate: '99.4%',
      avgLatency: `${(avgLatencyMs / 1000).toFixed(1)}s`,
      failedCount,
      runningCount
    };
  }, [runs]);

  // Filtered Runs
  const filteredRuns = useMemo(() => {
    return runs.filter(r => {
      const matchesSearch =
        r.workflowName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.runCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.tenantName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.targetResource.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.errorMessage && r.errorMessage.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesTenant = tenantFilter === 'ALL' || r.tenantId === tenantFilter;
      const matchesTrigger = triggerFilter === 'ALL' || r.triggerSource === triggerFilter;
      const matchesStatus = statusFilter === 'ALL' || r.status === statusFilter;
      const matchesCategory = categoryFilter === 'ALL' || r.category === categoryFilter;

      return matchesSearch && matchesTenant && matchesTrigger && matchesStatus && matchesCategory;
    });
  }, [runs, searchTerm, tenantFilter, triggerFilter, statusFilter, categoryFilter]);

  // Replay Workflow Run Execution
  const handleReplayRun = (runId: string) => {
    setIsReplaying(true);

    toast('info', 'Replay Initiated', `Re-executing workflow ${runId} from point of failure...`);

    setTimeout(() => {
      setIsReplaying(false);

      setRuns(prev => prev.map(r => {
        if (r.id === runId) {
          const replayedSteps: WorkflowStep[] = r.steps.map(s => ({
            ...s,
            status: 'success',
            durationMs: s.durationMs || 350
          }));

          return {
            ...r,
            status: 'retried',
            completedSteps: r.totalSteps,
            errorMessage: null,
            steps: replayedSteps,
            rawLogs: [
              ...r.rawLogs,
              { time: 'Just now', level: 'INFO', msg: 'Replay requested by operator. Step 3 re-executed successfully with exponential backoff.' },
              { time: 'Just now', level: 'INFO', msg: 'Workflow execution completed with status RETRIED_SUCCESS.' }
            ]
          };
        }
        return r;
      }));

      toast('success', 'Workflow Replayed', `Run ${runId} re-executed successfully. All steps passed.`);
    }, 1400);
  };

  // Copy to Clipboard
  const handleCopyGuid = (text: string) => {
    navigator.clipboard.writeText(text);
    toast('info', 'Copied to Clipboard', `Copied GUID: ${text}`);
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#090d16] text-[#e0e2ea] overflow-hidden font-sans">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & EXECUTION TELEMETRY BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] p-4 shrink-0 space-y-4">
        
        {/* Title & Live Controls */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-emerald-500/20 to-[#0078d4]/10 border border-emerald-500/40 rounded-lg">
              <Activity className="w-6 h-6 text-emerald-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-[#f0f4f8] tracking-tight">Workflow Execution &amp; Telemetry Console</h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  /portal/workflow-runs
                </span>
              </div>
              <p className="text-xs text-[#8a919e]">
                Real-time DAG traces, millisecond latency metrics, Graph API rate-limit debugging &amp; automated replay engine.
              </p>
            </div>
          </div>

          {/* Header Action Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            
            {/* Live Auto-Refresh Radar Toggle */}
            <button
              onClick={() => {
                setAutoRefreshEnabled(!autoRefreshEnabled);
                toast('info', 'Stream Updated', autoRefreshEnabled ? 'Live auto-refresh paused.' : 'Live 3s telemetry stream enabled.');
              }}
              className={cn(
                "px-3 py-2 rounded text-xs font-mono font-bold transition-all flex items-center gap-2 border",
                autoRefreshEnabled
                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/40 shadow-sm"
                  : "bg-[#181c22] text-[#8a919e] border-[#404752]"
              )}
            >
              <Radio className={cn("w-3.5 h-3.5", autoRefreshEnabled ? "text-emerald-400 animate-spin" : "")} />
              <span>{autoRefreshEnabled ? 'LIVE LOG STREAM: ON (3s)' : 'STREAM PAUSED'}</span>
            </button>

            {/* Pause Workflow Queue */}
            <button
              onClick={() => {
                setQueuePaused(!queuePaused);
                toast(queuePaused ? 'success' : 'warning', 'Queue State', queuePaused ? 'Resumed workflow execution queue.' : 'Workflow execution queue paused.');
              }}
              className={cn(
                "px-3 py-2 rounded text-xs font-semibold transition-all flex items-center gap-1.5 border",
                queuePaused
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold"
                  : "bg-[#181c22] text-[#8a919e] hover:text-[#e0e2ea] border-[#404752]"
              )}
            >
              <Pause className="w-3.5 h-3.5" />
              <span>{queuePaused ? 'Queue Paused (Click Resume)' : 'Pause Queue'}</span>
            </button>

            {/* Export Logs */}
            <button
              onClick={() => {
                toast('success', 'Export Complete', 'Exported 14,892 workflow run logs to CSV/JSON format.');
              }}
              className="p-2 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#e0e2ea] rounded transition-colors"
              title="Export Execution Log CSV/JSON"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 4 Engine Telemetry Metric Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          {/* KPI 1 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Total Runs Today</span>
              <div className="text-xl font-bold font-mono text-emerald-400 flex items-baseline gap-1">
                <span>{kpis.totalRunsToday.toLocaleString()} Runs</span>
                <span className="text-xs font-sans text-[#8a919e]">24h Volume</span>
              </div>
            </div>
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-md">
              <Zap className="w-5 h-5 text-emerald-400" />
            </div>
          </div>

          {/* KPI 2 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Engine Success Rate</span>
              <div className="text-xl font-bold font-mono text-emerald-400 flex items-baseline gap-2">
                <span>{kpis.successRate}</span>
                <span className="text-[10px] font-mono font-bold text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/30">
                  HEALTHY
                </span>
              </div>
            </div>
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-md">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </div>
          </div>

          {/* KPI 3 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Avg Execution Duration</span>
              <div className="text-xl font-bold font-mono text-[#a3c9ff] flex items-baseline gap-2">
                <span>{kpis.avgLatency}</span>
                <span className="text-xs font-sans text-[#8a919e]">Target &lt; 2.5s</span>
              </div>
            </div>
            <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-md">
              <Clock className="w-5 h-5 text-blue-400" />
            </div>
          </div>

          {/* KPI 4 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Failed / Needs Attention</span>
              <div className="text-xl font-bold font-mono text-red-400 flex items-baseline gap-2">
                <span>{kpis.failedCount} Failed</span>
                <span className="text-[10px] font-mono font-bold text-red-300 bg-red-500/20 px-1.5 py-0.5 rounded border border-red-500/30">
                  RETRY READY
                </span>
              </div>
            </div>
            <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-md">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
          </div>

        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. COMMAND TOOLBAR & MULTI-FILTER BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] px-4 py-2.5 shrink-0 flex items-center justify-between gap-3 flex-wrap text-xs">
        
        {/* Navigation View Sub-Tabs */}
        <div className="flex items-center gap-1.5 bg-[#181c22] p-1 rounded-md border border-[#404752] overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveView('runs')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeView === 'runs'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Workflow Runs Directory ({filteredRuns.length})</span>
          </button>

          <button
            onClick={() => setActiveView('analytics')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeView === 'analytics'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Engine Latency &amp; Rate Limits</span>
          </button>

          <button
            onClick={() => setActiveView('registry')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeView === 'registry'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <Settings className="w-3.5 h-3.5 text-purple-400" />
            <span>Cron &amp; Handler Registry</span>
          </button>
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-2 flex-wrap flex-1 justify-end">
          
          {/* Search Box */}
          <div className="relative min-w-[200px] max-w-[260px] flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e]" />
            <input
              type="text"
              placeholder="Search Run ID, Runbook, Tenant, Error..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#181c22] border border-[#404752] rounded pl-8 pr-7 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a919e] hover:text-[#e0e2ea]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Trigger Source Filter */}
          <select
            value={triggerFilter}
            onChange={(e) => setTriggerFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Trigger: All</option>
            <option value="cron">Cron Poll (5m)</option>
            <option value="webhook">Event / Webhook</option>
            <option value="manual">Manual Tech Trigger</option>
            <option value="alert">Alert Remediation</option>
          </select>

          {/* Execution Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Status: All States</option>
            <option value="success">Success 🟢</option>
            <option value="failed">Failed 🔴</option>
            <option value="running">Running / Active 🔵</option>
            <option value="retried">Retried 🟡</option>
          </select>

          {/* Workload Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Category: All</option>
            <option value="Conditional Access">Conditional Access</option>
            <option value="Identity / MFA">Identity / MFA</option>
            <option value="Intune">Intune</option>
            <option value="Exchange / Mail">Exchange / Mail</option>
            <option value="Security / Defender">Security / Defender</option>
            <option value="Governance">Governance</option>
          </select>

          {(searchTerm || triggerFilter !== 'ALL' || statusFilter !== 'ALL' || categoryFilter !== 'ALL') && (
            <button
              onClick={() => {
                setSearchTerm('');
                setTriggerFilter('ALL');
                setStatusFilter('ALL');
                setCategoryFilter('ALL');
              }}
              className="text-[#8a919e] hover:text-red-400 px-2 py-1 flex items-center gap-1 font-mono text-[11px]"
            >
              <X className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}

        </div>

      </div>

      {/* ========================================================================= */}
      {/* 3. MAIN CONTENT VIEW */}
      {/* ========================================================================= */}
      <div className="flex-1 overflow-hidden bg-[#090d16] p-4">
        
        {/* ======================================================================= */}
        {/* VIEW 1: SPLIT-PANE WORKFLOW DIRECTORY (60% QUEUE | 40% STEP INSPECTOR) */}
        {/* ======================================================================= */}
        {activeView === 'runs' && (
          <div className="w-full h-full flex gap-4 overflow-hidden">
            
            {/* LEFT PANE (60% WIDTH): MASTER WORKFLOW RUN TABLE */}
            <div className="w-full lg:w-[60%] bg-[#101419] border border-[#404752] rounded-xl overflow-hidden flex flex-col shadow-xl">
              
              <div className="p-3 bg-[#181c22] border-b border-[#404752] flex items-center justify-between text-xs shrink-0">
                <span className="font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-[#a3c9ff]" />
                  <span>Execution Stream ({filteredRuns.length} Runs)</span>
                </span>
                <span className="text-[#8a919e] text-[11px]">Real-time DAG Execution Engine</span>
              </div>

              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left text-xs text-[#e0e2ea] border-collapse">
                  <thead className="bg-[#141820] text-[#8a919e] font-mono uppercase text-[10px] sticky top-0 border-b border-[#404752] z-10">
                    <tr>
                      <th className="p-3">Status</th>
                      <th className="p-3">Run Code &amp; Workflow Title</th>
                      <th className="p-3">Tenant Name</th>
                      <th className="p-3">Trigger Source</th>
                      <th className="p-3">Time &amp; Duration</th>
                      <th className="p-3">Steps</th>
                      <th className="p-3 text-right">Quick Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/40">
                    {filteredRuns.map(run => {
                      const isSelected = run.id === selectedRunId;

                      let statusBadge = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
                      if (run.status === 'failed') statusBadge = 'bg-red-500/20 text-red-400 border-red-500/50 animate-pulse';
                      if (run.status === 'running') statusBadge = 'bg-blue-500/20 text-blue-300 border-blue-500/40 animate-pulse';
                      if (run.status === 'retried') statusBadge = 'bg-amber-500/10 text-amber-300 border-amber-500/30';

                      return (
                        <tr
                          key={run.id}
                          onClick={() => setSelectedRunId(run.id)}
                          className={cn(
                            "hover:bg-[#181c22] transition-colors cursor-pointer",
                            isSelected ? "bg-[#1a212d]" : ""
                          )}
                        >
                          <td className="p-3">
                            <span className={cn("px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase border", statusBadge)}>
                              {run.status.toUpperCase()}
                            </span>
                          </td>

                          <td className="p-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[11px] text-[#8a919e]">{run.runCode}</span>
                              <span className="text-[#404752]">&bull;</span>
                              <span className="text-[11px] text-[#a3c9ff] font-mono">{run.category}</span>
                            </div>
                            <div className="font-bold text-[#f0f4f8] line-clamp-1 mt-0.5">{run.workflowName}</div>
                          </td>

                          <td className="p-3">
                            <div className="font-semibold text-[#f0f4f8] flex items-center gap-1">
                              <Building2 className="w-3 h-3 text-[#a3c9ff]" />
                              <span>{run.tenantName}</span>
                            </div>
                          </td>

                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#181c22] border border-[#404752] text-[#e0e2ea]">
                              {run.triggerSource.toUpperCase()}
                            </span>
                          </td>

                          <td className="p-3 font-mono text-[11px]">
                            <div className="text-[#f0f4f8]">{run.startedAt}</div>
                            <div className="text-[10px] text-[#8a919e]">{(run.durationMs / 1000).toFixed(2)}s</div>
                          </td>

                          <td className="p-3 font-mono text-[11px]">
                            <span className={cn(
                              "font-bold",
                              run.completedSteps === run.totalSteps ? "text-emerald-400" : "text-red-400"
                            )}>
                              {run.completedSteps}/{run.totalSteps}
                            </span>
                          </td>

                          <td className="p-3 text-right">
                            {run.status === 'failed' ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleReplayRun(run.id); }}
                                className="px-2.5 py-1 bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white rounded text-[11px] font-mono font-bold flex items-center gap-1 ml-auto shadow-sm"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Replay</span>
                              </button>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); setSelectedRunId(run.id); }}
                                className="px-2.5 py-1 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#a3c9ff] rounded text-[11px] font-mono"
                              >
                                Inspect
                              </button>
                            )}
                          </td>

                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RIGHT PANE (40% WIDTH): STEP-LEVEL TRACE & TERMINAL INSPECTOR */}
            {selectedRun && (
              <div className="hidden lg:flex flex-col w-[40%] bg-[#101419] border border-[#404752] rounded-xl overflow-hidden shadow-2xl">
                
                {/* Inspector Header */}
                <div className="p-3.5 bg-[#181c22] border-b border-[#404752] flex items-center justify-between shrink-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/30">
                        {selectedRun.runCode}
                      </span>
                      <span className="text-xs font-mono text-[#8a919e]">{selectedRun.startedAt} ({(selectedRun.durationMs / 1000).toFixed(2)}s)</span>
                    </div>
                    <h3 className="text-xs font-bold text-[#f0f4f8] mt-1 leading-snug">
                      {selectedRun.workflowName}
                    </h3>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleCopyGuid(selectedRun.id)}
                      className="p-1.5 bg-[#101419] hover:bg-[#202630] border border-[#404752] text-[#8a919e] hover:text-[#e0e2ea] rounded"
                      title="Copy Run GUID"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleReplayRun(selectedRun.id)}
                      disabled={isReplaying}
                      className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#006cbd] text-white rounded text-xs font-bold font-mono flex items-center gap-1 shadow-sm disabled:opacity-50"
                    >
                      <RotateCcw className={cn("w-3.5 h-3.5", isReplaying ? "animate-spin" : "")} />
                      <span>{isReplaying ? 'Replaying...' : 'Replay Run'}</span>
                    </button>
                  </div>
                </div>

                {/* Sub-Navigation Tabs inside Inspector */}
                <div className="bg-[#141820] border-b border-[#404752] px-3 py-1 flex items-center gap-2 text-xs font-mono shrink-0">
                  <button
                    onClick={() => setInspectorTab('dag')}
                    className={cn(
                      "px-2.5 py-1 rounded transition-colors flex items-center gap-1.5",
                      inspectorTab === 'dag' ? "bg-[#0078d4] text-white font-bold" : "text-[#8a919e] hover:text-[#e0e2ea]"
                    )}
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                    <span>DAG Steps ({selectedRun.steps.length})</span>
                  </button>

                  <button
                    onClick={() => setInspectorTab('payload')}
                    className={cn(
                      "px-2.5 py-1 rounded transition-colors flex items-center gap-1.5",
                      inspectorTab === 'payload' ? "bg-[#0078d4] text-white font-bold" : "text-[#8a919e] hover:text-[#e0e2ea]"
                    )}
                  >
                    <Code2 className="w-3.5 h-3.5 text-purple-400" />
                    <span>JSON Payload</span>
                  </button>

                  <button
                    onClick={() => setInspectorTab('terminal')}
                    className={cn(
                      "px-2.5 py-1 rounded transition-colors flex items-center gap-1.5",
                      inspectorTab === 'terminal' ? "bg-[#0078d4] text-white font-bold" : "text-[#8a919e] hover:text-[#e0e2ea]"
                    )}
                  >
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Raw Terminal Log</span>
                  </button>
                </div>

                {/* Inspector Content View */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                  
                  {/* TAB 1: DAG STEP TRACE */}
                  {inspectorTab === 'dag' && (
                    <div className="space-y-3">
                      
                      {/* Target Summary */}
                      <div className="bg-[#181c22] border border-[#404752] rounded-lg p-3 space-y-1.5">
                        <div className="flex justify-between text-[11px] font-mono text-[#8a919e]">
                          <span>Target Tenant: <strong className="text-[#f0f4f8]">{selectedRun.tenantName}</strong></span>
                          <span className="text-[#a3c9ff]">{selectedRun.category}</span>
                        </div>
                        <div className="text-xs text-[#e0e2ea] font-mono font-semibold">
                          Target Entity: {selectedRun.targetResource}
                        </div>
                      </div>

                      {/* Error Alert Box if Failed */}
                      {selectedRun.errorMessage && (
                        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-300 space-y-1">
                          <div className="font-mono font-bold text-red-400 flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                            <span>Execution Step Failure Detected:</span>
                          </div>
                          <p className="font-mono text-[11px] leading-relaxed bg-[#090d16] p-2 rounded border border-red-500/20 text-red-200">
                            {selectedRun.errorMessage}
                          </p>
                        </div>
                      )}

                      {/* Step Execution DAG Timeline */}
                      <div className="space-y-2">
                        <h4 className="font-mono text-xs font-bold text-[#f0f4f8] uppercase tracking-wider flex items-center gap-1.5">
                          <Layers className="w-4 h-4 text-[#a3c9ff]" />
                          <span>Step-by-Step DAG Pipeline Traces</span>
                        </h4>

                        <div className="space-y-2 relative before:absolute before:left-3.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-[#404752]">
                          {selectedRun.steps.map(step => {
                            let stepBadge = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
                            let stepIcon = <CheckCircle2 className="w-4 h-4 text-emerald-400" />;

                            if (step.status === 'failed') {
                              stepBadge = 'bg-red-500/20 text-red-300 border-red-500/40';
                              stepIcon = <XCircle className="w-4 h-4 text-red-400" />;
                            } else if (step.status === 'running') {
                              stepBadge = 'bg-blue-500/20 text-blue-300 border-blue-500/40';
                              stepIcon = <Clock className="w-4 h-4 text-blue-400 animate-spin" />;
                            } else if (step.status === 'skipped') {
                              stepBadge = 'bg-amber-500/10 text-amber-300 border-amber-500/30';
                              stepIcon = <AlertTriangle className="w-4 h-4 text-amber-400" />;
                            }

                            return (
                              <div key={step.stepNumber} className="relative pl-8">
                                <div className="absolute left-1.5 top-2.5 z-10 bg-[#101419] p-0.5 rounded-full">
                                  {stepIcon}
                                </div>

                                <div className="p-2.5 bg-[#181c22] border border-[#404752] rounded-lg space-y-1">
                                  <div className="flex items-center justify-between text-[11px] font-mono">
                                    <span className="font-bold text-[#f0f4f8]">
                                      Step {step.stepNumber}: {step.name}
                                    </span>
                                    <span className="text-[#8a919e]">{step.durationMs}ms</span>
                                  </div>

                                  {step.errorDetails && (
                                    <div className="text-[10px] font-mono text-red-400 font-semibold bg-[#090d16] p-1.5 rounded border border-red-500/20">
                                      Err: {step.errorDetails}
                                    </div>
                                  )}

                                  {step.logOutput && step.logOutput.length > 0 && (
                                    <div className="space-y-0.5 pt-1">
                                      {step.logOutput.map((l, idx) => (
                                        <div key={idx} className="text-[10px] font-mono text-[#8a919e] flex items-center gap-1">
                                          <ChevronRight className="w-3 h-3 text-[#404752]" />
                                          <span>{l}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                    </div>
                  )}

                  {/* TAB 2: JSON PAYLOAD VIEWER */}
                  {inspectorTab === 'payload' && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 bg-[#181c22] p-1 rounded border border-[#404752] font-mono text-xs">
                        <button
                          onClick={() => setPayloadTab('input')}
                          className={cn(
                            "flex-1 py-1 rounded transition-colors text-center font-bold",
                            payloadTab === 'input' ? "bg-[#0078d4] text-white" : "text-[#8a919e]"
                          )}
                        >
                          Input Context JSON
                        </button>
                        <button
                          onClick={() => setPayloadTab('output')}
                          className={cn(
                            "flex-1 py-1 rounded transition-colors text-center font-bold",
                            payloadTab === 'output' ? "bg-[#0078d4] text-white" : "text-[#8a919e]"
                          )}
                        >
                          Output Result JSON
                        </button>
                      </div>

                      <div className="bg-[#090d16] border border-[#404752] rounded p-3 font-mono text-[11px] text-emerald-400 overflow-x-auto">
                        <pre>
                          {JSON.stringify(payloadTab === 'input' ? selectedRun.inputPayload : selectedRun.outputPayload, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* TAB 3: RAW TERMINAL LOG OUTPUT */}
                  {inspectorTab === 'terminal' && (
                    <div className="bg-[#090d16] border border-[#404752] rounded-lg p-3 font-mono text-[11px] space-y-1.5 min-h-[260px] shadow-inner">
                      <div className="text-[10px] text-[#8a919e] border-b border-[#404752] pb-1.5 flex justify-between">
                        <span>Terminal Output Console -- Node.js Worker #04</span>
                        <span>LOG_LEVEL: VERBOSE</span>
                      </div>
                      <div className="space-y-1 pt-1">
                        {selectedRun.rawLogs.map((log, idx) => {
                          let color = 'text-[#e0e2ea]';
                          if (log.level === 'WARN') color = 'text-amber-300';
                          if (log.level === 'ERROR') color = 'text-red-400 font-bold';

                          return (
                            <div key={idx} className={cn("leading-relaxed flex items-start gap-2", color)}>
                              <span className="text-[#8a919e] shrink-0 text-[10px]">{log.time}</span>
                              <span className="font-bold text-[10px]">[{log.level}]</span>
                              <span>{log.msg}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                </div>

              </div>
            )}

          </div>
        )}

        {/* ======================================================================= */}
        {/* VIEW 2: ENGINE LATENCY & THROUGHPUT METRICS */}
        {/* ======================================================================= */}
        {activeView === 'analytics' && (
          <div className="w-full h-full bg-[#101419] border border-[#404752] rounded-xl p-6 overflow-y-auto space-y-6">
            <div className="flex items-center justify-between border-b border-[#404752] pb-4">
              <div>
                <h2 className="text-base font-bold text-[#f0f4f8] flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-emerald-400" />
                  <span>Workflow Engine Latency, Throughput &amp; Rate Limit Analytics</span>
                </h2>
                <p className="text-xs text-[#8a919e]">
                  Graph API throttling windows, worker concurrency bounds &amp; average execution latency trends across tenants.
                </p>
              </div>
              <span className="px-3 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-mono font-bold">
                Cluster Health: 99.4%
              </span>
            </div>

            {/* Performance Visual Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-2">
                <span className="text-xs font-mono text-[#8a919e] uppercase">Active Worker Threads</span>
                <div className="text-2xl font-bold font-mono text-[#a3c9ff]">16 / 32 Parallel</div>
                <div className="w-full bg-[#090d16] h-2 rounded-full overflow-hidden border border-[#404752]">
                  <div className="bg-[#0078d4] h-full w-[50%]" />
                </div>
              </div>

              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-2">
                <span className="text-xs font-mono text-[#8a919e] uppercase">Graph API Throttling Events (24h)</span>
                <div className="text-2xl font-bold font-mono text-amber-400">14 Throttle Breaches</div>
                <p className="text-[11px] text-[#8a919e]">Auto-remediated via exponential backoff queues.</p>
              </div>

              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-2">
                <span className="text-xs font-mono text-[#8a919e] uppercase">Median Execution Duration</span>
                <div className="text-2xl font-bold font-mono text-emerald-400">1,420 ms</div>
                <p className="text-[11px] text-[#8a919e]">P99 Latency: 3,850 ms</p>
              </div>
            </div>

            {/* Mock Latency Distribution Bar Chart Representation */}
            <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-3">
              <h3 className="text-xs font-mono font-bold text-[#f0f4f8] uppercase">Hourly Workflow Run Volume &amp; Latency Distribution</h3>
              <div className="h-48 flex items-end justify-between gap-2 pt-6 px-2 border-b border-[#404752]">
                {[65, 80, 45, 90, 100, 75, 85, 95, 110, 120, 85, 90].map((h, idx) => (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-1 group">
                    <div
                      style={{ height: `${h}%` }}
                      className="w-full bg-gradient-to-t from-[#0078d4] to-emerald-400 rounded-t transition-all group-hover:brightness-125"
                    />
                    <span className="text-[9px] font-mono text-[#8a919e]">{idx * 2}:00</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ======================================================================= */}
        {/* VIEW 3: REGISTERED WORKFLOWS & CRON SCHEDULE REGISTRY */}
        {/* ======================================================================= */}
        {activeView === 'registry' && (
          <div className="w-full h-full bg-[#101419] border border-[#404752] rounded-xl p-6 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between border-b border-[#404752] pb-4">
              <div>
                <h2 className="text-base font-bold text-[#f0f4f8] flex items-center gap-2">
                  <Settings className="w-5 h-5 text-purple-400" />
                  <span>Registered Cron Jobs, Webhook Handlers &amp; Workflow Registry</span>
                </h2>
                <p className="text-xs text-[#8a919e]">
                  Active background schedules, event triggers, and automated auto-remediation policies.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {REGISTERED_WORKFLOWS.map(wf => (
                <div key={wf.id} className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-[#a3c9ff]">{wf.id}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      {wf.category}
                    </span>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-[#f0f4f8]">{wf.name}</h4>
                    <p className="text-xs font-mono text-[#8a919e] mt-0.5">Schedule: {wf.scheduleText} ({wf.cron})</p>
                  </div>

                  <div className="flex items-center justify-between text-xs font-mono pt-2 border-t border-[#404752]">
                    <span className="text-[#8a919e]">Active Runs Today: <strong className="text-[#f0f4f8]">{wf.activeRunsToday}</strong></span>
                    <span className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-bold",
                      wf.autoRemediate ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "bg-gray-500/10 text-gray-400 border border-gray-500/30"
                    )}>
                      {wf.autoRemediate ? 'Auto-Remediate ON' : 'Manual Approval'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

    </div>
  );
};
