// @ts-nocheck
import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Sparkles,
  Clock,
  DollarSign,
  Activity,
  Code2,
  KeyRound,
  Users,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Copy,
  X,
  Search,
  FileText,
  Zap,
  CheckCircle2,
  Lock,
  Laptop,
  ChevronRight,
  Play,
  Check,
  Building2,
  ShieldCheck,
  TrendingUp,
  Download,
  Terminal,
  Filter,
  SlidersHorizontal,
  HardDrive,
  Mail,
  Shield,
  Layers,
  ArrowUpRight,
  Send,
  RotateCw,
} from 'lucide-react';
import { Tenant, SeverityLevel } from '../types';

interface GraphDriftItem {
  id: string;
  timestamp: string;
  endpoint: string;
  category: 'Identity' | 'Mailbox' | 'Licensing' | 'Security';
  severity: SeverityLevel;
  summary: string;
  details: string;
  graphPayload: object;
  actionTitle: string;
}

interface WorkflowTask {
  id: string;
  title: string;
  category: string;
  target: string;
  status: 'Pending Approval' | 'Running' | 'Completed' | 'Failed';
  startedAt: string;
  initiatedBy: string;
}

interface SingleTenantDashboardProps {
  tenant?: Tenant;
  tenants: Tenant[];
  onSelectTenant: (tenant: Tenant | null) => void;
  onExecuteWorkflow?: (workflowId: string, params: object) => void;
  onShowToast?: (type: 'success' | 'info' | 'warning' | 'error', title: string, desc: string) => void;
}

export const SingleTenantDashboard: React.FC<SingleTenantDashboardProps> = ({
  tenant,
  tenants,
  onSelectTenant,
  onExecuteWorkflow,
  onShowToast,
}) => {
  // Default to provided tenant or first available tenant
  const activeTenant: Tenant = tenant || tenants[0] || {
    id: 'contoso-01',
    name: 'Contoso Corporation',
    code: 'CTC',
    primaryDomain: 'contosocorp.com',
    tenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47',
    licenseUsage: { assigned: 480, total: 555, tier: 'Business Premium' },
    mfaPercentage: 88,
    secureScore: 72,
    maxSecureScore: 100,
    syncStatus: 'Healthy',
    lastSyncTimestamp: '3m ago',
    activeAlertsCount: 4,
    adminCount: 5,
    userCount: 480,
    globalAdminUPNs: ['admin@contosocorp.com', 'm.vance@contosocorp.com', 'service.account@contosocorp.com'],
    conditionalAccessPoliciesCount: 8,
    pimEnabled: true,
    securityDefaults: false,
  };

  // State Management
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedTenantId, setCopiedTenantId] = useState(false);
  const [gdapDaysLeft, setGdapDaysLeft] = useState(18);
  const [isGdapExtending, setIsGdapExtending] = useState(false);
  
  // Drawer state for Graph JSON Payload inspection
  const [selectedGraphPayload, setSelectedGraphPayload] = useState<{
    endpoint: string;
    summary: string;
    json: object;
  } | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);

  // Command K Modal state
  const [isCmdKOpen, setIsCmdKOpen] = useState(false);
  const [cmdKQuery, setCmdKQuery] = useState('');

  // Workflow & Remediation states
  const [runningWorkflowId, setRunningWorkflowId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<'ALL' | 'Pending Approval' | 'Running' | 'Completed'>('ALL');

  // Critical Banner Items State
  const [bannerAlerts, setBannerAlerts] = useState([
    {
      id: 'ca-1',
      title: '3 Global Admin Accounts Lack MFA Enforcement',
      details: 'CA Policy "CA001-Enforce-MFA-Admins" bypassed for UPN: m.vance@' + activeTenant.primaryDomain,
      impact: 'High Identity Compromise Risk',
      actionText: 'Execute MFA Lockdown Workflow',
      workflowId: 'wf-mfa-lockdown',
    },
    {
      id: 'ca-2',
      title: 'Unassigned License Waste Detected ($620/mo MRR)',
      details: '75 Microsoft 365 E5 licenses unassigned for >45 days across tenant subscription.',
      impact: 'Financial Inefficiency',
      actionText: 'Reclaim Inactive Licenses',
      workflowId: 'wf-reclaim-licenses',
    },
    {
      id: 'ca-3',
      title: 'External Forwarding Rule Added to Executive Mailbox',
      details: 'Inbox rule "AutoForwardExternal" added to ceo@' + activeTenant.primaryDomain + ' forwarding to personal Gmail.',
      impact: 'Data Exfiltration Alert',
      actionText: 'Remove Forwarding & Revoke Session',
      workflowId: 'wf-revoke-forwarding',
    },
  ]);

  // Graph API Monitoring & Drift Stream Data
  const graphDriftFeed: GraphDriftItem[] = [
    {
      id: 'gd-101',
      timestamp: '2 mins ago',
      endpoint: '/v1.0/identity/conditionalAccess/policies/ca-policy-004',
      category: 'Identity',
      severity: 'CRITICAL',
      summary: 'Conditional Access Policy Exclusion Drift',
      details: 'Policy "CA004-Require-Compliant-Device" had 4 user accounts added to its exclusion group.',
      actionTitle: 'Enforce Baseline Policy & Lock Exclusion Group',
      graphPayload: {
        "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#identity/conditionalAccess/policies/$entity",
        "id": "ca-policy-004",
        "displayName": "CA004-Require-Compliant-Device",
        "state": "enabled",
        "conditions": {
          "userRiskLevels": ["medium", "high"],
          "users": {
            "includeUsers": ["All"],
            "excludeGroups": ["e8d35f21-998a-4422-b673-[#exclusion-group]"]
          }
        },
        "grantControls": {
          "operator": "OR",
          "builtInControls": ["mfa", "compliantDevice"]
        },
        "lastModifiedDateTime": "2026-07-23T19:58:12Z"
      }
    },
    {
      id: 'gd-102',
      timestamp: '14 mins ago',
      endpoint: '/v1.0/users/ceo@' + activeTenant.primaryDomain + '/mailFolders/inbox/messageRules',
      category: 'Mailbox',
      severity: 'HIGH',
      summary: 'Suspicious External Inbox Rule Creation',
      details: 'Rule created to forward all messages containing "Invoice" or "Wire" to external destination.',
      actionTitle: 'Delete Inbox Rule & Trigger Risk Investigation',
      graphPayload: {
        "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('ceo%40" + activeTenant.primaryDomain + "')/mailFolders('inbox')/messageRules/$entity",
        "id": "AAMkAGI2T...=",
        "displayName": "AutoForward-Invoice",
        "sequence": 1,
        "isEnabled": true,
        "conditions": {
          "bodyContains": ["Invoice", "Wire Transfer", "Banking"]
        },
        "actions": {
          "redirectTo": [
            {
              "emailAddress": {
                "name": "External Auditor",
                "address": "finance-audit-temp@gmail.com"
              }
            }
          ],
          "stopProcessingRules": true
        }
      }
    },
    {
      id: 'gd-103',
      timestamp: '32 mins ago',
      endpoint: '/v1.0/subscribedSkus/0cd6490f-2c98-4888-8bb2-5be20b6e9e0d',
      category: 'Licensing',
      severity: 'MED',
      summary: 'E5 License Allocation Drift',
      details: '12 new E5 seats assigned to non-active guest user accounts.',
      actionTitle: 'Unassign Licenses & Deprovision Guests',
      graphPayload: {
        "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#subscribedSkus/$entity",
        "skuId": "0cd6490f-2c98-4888-8bb2-5be20b6e9e0d",
        "skuPartNumber": "SPE_E5",
        "capabilityStatus": "Enabled",
        "consumedUnits": 555,
        "prepaidUnits": {
          "enabled": 555,
          "suspended": 0,
          "warning": 0
        },
        "unassignedUnitsCount": 75,
        "lastAudited": "2026-07-23T19:30:00Z"
      }
    },
    {
      id: 'gd-104',
      timestamp: '1 hour ago',
      endpoint: '/v1.0/security/alerts_v2/alt-9842104',
      category: 'Security',
      severity: 'HIGH',
      summary: 'Defender XDR Impossible Travel Alert',
      details: 'Sign-in from Lagos, Nigeria detected 8 mins after sign-in from Chicago, Illinois.',
      actionTitle: 'Revoke User Sessions & Reset Password',
      graphPayload: {
        "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#security/alerts_v2/$entity",
        "id": "alt-9842104",
        "providerAlertId": "382109482",
        "title": "Impossible travel activity",
        "status": "inProgress",
        "severity": "high",
        "category": "InitialAccess",
        "evidence": [
          { "ipAddress": "197.210.64.12", "location": { "city": "Lagos", "countryCode": "NG" } },
          { "ipAddress": "12.198.42.101", "location": { "city": "Chicago", "countryCode": "US" } }
        ]
      }
    }
  ];

  // Remediation Tasks Queue State
  const [remediationTasks, setRemediationTasks] = useState<WorkflowTask[]>([
    {
      id: 'task-1',
      title: 'Enforce FIDO2 Hardware Key for Global Admins',
      category: 'Identity',
      target: activeTenant.globalAdminUPNs[0],
      status: 'Pending Approval',
      startedAt: '10 mins ago',
      initiatedBy: 'MSP Automated Policy Engine',
    },
    {
      id: 'task-2',
      title: 'BitLocker Key Backup to Entra ID',
      category: 'Endpoint',
      target: '12 Unencrypted Laptops',
      status: 'Running',
      startedAt: '2 mins ago',
      initiatedBy: 'SecOps Technician',
    },
    {
      id: 'task-3',
      title: 'Purge Stale B2B External Guests (>90 days)',
      category: 'Security',
      target: '18 Guest Accounts',
      status: 'Completed',
      startedAt: '1 hour ago',
      initiatedBy: 'Cron: GuestAuditorJob',
    },
    {
      id: 'task-4',
      title: 'Exchange Legacy Transport Rule Removal',
      category: 'Mailbox',
      target: 'Exchange Transport Layer',
      status: 'Completed',
      startedAt: '3 hours ago',
      initiatedBy: 'm.vance@msp.com',
    },
  ]);

  // Handle Cmd+K Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCmdKOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Copy Tenant ID
  const handleCopyTenantId = () => {
    navigator.clipboard.writeText(activeTenant.tenantId);
    setCopiedTenantId(true);
    setTimeout(() => setCopiedTenantId(false), 2000);
  };

  // Instant Graph Refresh
  const handleTriggerRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      if (onShowToast) {
        onShowToast('success', 'Microsoft Graph Synchronized', `Polled 122 Graph endpoints for ${activeTenant.name}. All signals current.`);
      }
    }, 1200);
  };

  // Request GDAP Extension
  const handleExtendGDAP = () => {
    setIsGdapExtending(true);
    setTimeout(() => {
      setIsGdapExtending(false);
      setGdapDaysLeft(180);
      if (onShowToast) {
        onShowToast('success', 'GDAP Access Extended', `Partner Center GDAP invitation generated for ${activeTenant.name}. Valid for 180 days.`);
      }
    }, 1000);
  };

  // Execute Action / Workflow
  const handleRunWorkflowAction = (workflowId: string, title: string) => {
    setRunningWorkflowId(workflowId);
    if (onExecuteWorkflow) {
      onExecuteWorkflow(workflowId, { tenantId: activeTenant.tenantId });
    }

    setTimeout(() => {
      setRunningWorkflowId(null);
      // Remove from banner if it was a banner item
      setBannerAlerts((prev) => prev.filter((a) => a.workflowId !== workflowId));
      
      // Add to remediation queue as completed
      const newTask: WorkflowTask = {
        id: `task-${Date.now()}`,
        title,
        category: 'Remediation',
        target: activeTenant.name,
        status: 'Completed',
        startedAt: 'Just now',
        initiatedBy: 'Technician Command',
      };
      setRemediationTasks((prev) => [newTask, ...prev]);

      if (onShowToast) {
        onShowToast('success', 'Workflow Executed', `Successfully resolved: ${title}`);
      }
    }, 1200);
  };

  const filteredTasks = remediationTasks.filter((t) => {
    if (taskFilter === 'ALL') return true;
    return t.status === taskFilter;
  });

  return (
    <div className="flex-1 p-4 space-y-4 overflow-y-auto text-[#e0e2ea] bg-[#0b0e14]">
      {/* 1. Tenant Header & Command Toolbar (Full Width) */}
      <div className="bg-[#181c22] border border-[#404752] rounded-lg p-3.5 shadow-md space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Tenant Identity */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-md bg-[#0078d4]/20 border border-[#0078d4]/50 flex items-center justify-center font-bold text-base text-[#a3c9ff] shadow-inner">
              {activeTenant.code}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-[#e0e2ea] tracking-tight flex items-center gap-2">
                  <span>{activeTenant.name}</span>
                  <span className="text-xs bg-[#0078d4]/20 border border-[#0078d4]/40 text-[#a3c9ff] px-2 py-0.5 rounded font-mono font-medium">
                    Managed Client
                  </span>
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-[#8a919e] font-mono mt-0.5">
                <span className="text-[#e0e2ea] font-semibold">{activeTenant.primaryDomain}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  GUID: <span className="text-[#c0c7d4]">{activeTenant.tenantId.substring(0, 18)}...</span>
                  <button
                    onClick={handleCopyTenantId}
                    title="Copy Full Tenant GUID"
                    className="hover:text-[#a3c9ff] text-[#8a919e] transition-colors p-0.5"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  {copiedTenantId && <span className="text-[10px] text-[#4ade80] font-sans font-bold">Copied!</span>}
                </span>
              </div>
            </div>
          </div>

          {/* GDAP & Health Badges + Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* GDAP Status Indicator */}
            <div className="bg-[#101419] border border-[#166534] px-3 py-1.5 rounded-md flex items-center gap-2 shadow-sm">
              <ShieldCheck className="w-4 h-4 text-[#4ade80]" />
              <div className="text-xs font-semibold text-[#4ade80]">
                <span>GDAP Active ({gdapDaysLeft} Days Left)</span>
              </div>
              {gdapDaysLeft <= 30 && (
                <button
                  onClick={handleExtendGDAP}
                  disabled={isGdapExtending}
                  className="ml-1 bg-[#166534] hover:bg-[#15803d] text-white text-[10px] px-2 py-0.5 rounded font-bold transition-colors"
                >
                  {isGdapExtending ? 'Extending...' : 'Extend GDAP'}
                </button>
              )}
            </div>

            {/* M365 Service Health Pill */}
            <div className="bg-[#101419] border border-[#404752] px-3 py-1.5 rounded-md flex items-center gap-2 text-xs shadow-sm">
              <Activity className="w-3.5 h-3.5 text-[#a3c9ff]" />
              <span className="text-[#8a919e]">M365 Status:</span>
              <span className="text-[#4ade80] font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse"></span>
                Exchange &amp; Entra Operational
              </span>
            </div>

            {/* Instant Graph Refresh Button */}
            <button
              onClick={handleTriggerRefresh}
              disabled={isRefreshing}
              className="bg-[#272a30] border border-[#404752] hover:border-[#0078d4] text-[#e0e2ea] px-3 py-1.5 rounded text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm"
              title="Poll 122 Microsoft Graph API endpoints"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#a3c9ff] ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Polling Graph...' : 'Sync Graph'}</span>
            </button>

            {/* Export PDF Button */}
            <button
              onClick={() => {
                if (onShowToast) {
                  onShowToast('success', 'Executive PDF Exported', `Generated executive security & license audit for ${activeTenant.name}`);
                }
              }}
              className="bg-[#272a30] border border-[#404752] hover:bg-[#31353b] text-[#e0e2ea] px-3 py-1.5 rounded text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm"
            >
              <Download className="w-3.5 h-3.5 text-[#a3c9ff]" />
              <span>Export Executive PDF</span>
            </button>

            {/* Cmd+K Search Trigger */}
            <button
              onClick={() => setIsCmdKOpen(true)}
              className="bg-[#0078d4] hover:bg-[#0060ab] text-white px-3 py-1.5 rounded text-xs font-semibold transition-colors flex items-center gap-2 shadow-md"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Action Search</span>
              <kbd className="bg-black/30 text-white/80 px-1.5 py-0.2 text-[10px] rounded font-mono">⌘K</kbd>
            </button>
          </div>
        </div>

        {/* License & Health Summary Sub-line */}
        <div className="pt-2 border-t border-[#404752]/50 flex flex-wrap items-center justify-between text-xs text-[#8a919e]">
          <div className="flex items-center gap-3">
            <span>License Tier: <strong className="text-[#a3c9ff]">{activeTenant.licenseUsage.tier}</strong></span>
            <span>•</span>
            <span>Allocated Seats: <strong className="text-[#e0e2ea]">{activeTenant.licenseUsage.assigned} / {activeTenant.licenseUsage.total}</strong></span>
            <span>•</span>
            <span>Secure Score: <strong className="text-[#4ade80]">{activeTenant.secureScore} / {activeTenant.maxSecureScore}</strong></span>
          </div>

          <div className="font-mono text-[11px]">
            <span>Last Graph Polled: <strong className="text-[#4ade80]">{activeTenant.lastSyncTimestamp}</strong> via 122 Endpoints</span>
          </div>
        </div>
      </div>

      {/* 2. Critical Action & Risk Banner (Top Highlight Section) */}
      {bannerAlerts.length > 0 && (
        <div className="bg-[#101419] border border-[#ffb4ab]/60 rounded-lg p-3.5 shadow-md bg-gradient-to-r from-[#93000a]/20 via-[#101419] to-[#101419] space-y-3">
          <div className="flex items-center justify-between border-b border-[#404752]/60 pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#ffb4ab] animate-pulse" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#ffdad6]">
                Critical Action &amp; Risk Banner (Immediate Technician Intervention Required)
              </h2>
            </div>
            <span className="text-[10px] text-[#ffb4ab] bg-[#93000a] px-2 py-0.5 rounded font-bold">
              {bannerAlerts.length} Actionable Risks
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {bannerAlerts.map((alert) => (
              <div
                key={alert.id}
                className="bg-[#181c22] border border-[#404752] p-3 rounded-md flex flex-col justify-between space-y-2 hover:border-[#ffb4ab] transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-[#ffb4ab] mb-1">
                    <span className="bg-[#93000a] text-white px-1.5 py-0.2 rounded font-bold">CRITICAL</span>
                    <span>{alert.impact}</span>
                  </div>
                  <h3 className="font-bold text-xs text-[#e0e2ea] mb-1">{alert.title}</h3>
                  <p className="text-[11px] text-[#8a919e]">{alert.details}</p>
                </div>

                <button
                  onClick={() => handleRunWorkflowAction(alert.workflowId, alert.title)}
                  disabled={runningWorkflowId === alert.workflowId}
                  className="w-full bg-[#0078d4] hover:bg-[#0060ab] text-white py-1.5 px-2 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-sm mt-2"
                >
                  <Zap className={`w-3.5 h-3.5 ${runningWorkflowId === alert.workflowId ? 'animate-spin' : ''}`} />
                  <span>{runningWorkflowId === alert.workflowId ? 'Executing...' : alert.actionText}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Core Grid Layout (Split View: 65% Telemetry & Governance / 35% Financial & Value Engine) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT COLUMN: 65% Width (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* A. Security & Identity Posture Matrix */}
          <div className="bg-[#101419] border border-[#404752] rounded-lg p-4 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-[#404752] pb-2.5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#0078d4]" />
                <h2 className="text-sm font-bold text-[#e0e2ea]">Security &amp; Identity Posture Matrix</h2>
              </div>
              <span className="text-xs text-[#4ade80] font-semibold bg-[#052e16] border border-[#166534] px-2 py-0.5 rounded">
                +11.2% Above Commercial Avg
              </span>
            </div>

            {/* Microsoft Secure Score vs Commercial Benchmark Widget */}
            <div className="bg-[#181c22] p-3 rounded border border-[#404752]/40 space-y-2">
              <div className="flex justify-between items-baseline text-xs">
                <span className="font-bold text-[#e0e2ea]">Microsoft Secure Score Benchmark</span>
                <span className="font-mono text-[#a3c9ff]">
                  <strong>{activeTenant.secureScore}</strong> / {activeTenant.maxSecureScore} Points (72.0%)
                </span>
              </div>

              <div className="space-y-1.5">
                <div>
                  <div className="flex justify-between text-[10px] text-[#8a919e] mb-0.5">
                    <span>{activeTenant.name} (Current)</span>
                    <span>72%</span>
                  </div>
                  <div className="w-full bg-[#31353b] rounded-full h-2">
                    <div className="bg-[#0078d4] h-2 rounded-full" style={{ width: '72%' }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[10px] text-[#8a919e] mb-0.5">
                    <span>Commercial Industry Average</span>
                    <span>60.8%</span>
                  </div>
                  <div className="w-full bg-[#31353b] rounded-full h-2">
                    <div className="bg-[#fb923c] h-2 rounded-full" style={{ width: '60.8%' }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Entra ID & Endpoint Metrics Grid */}
            <div className="grid grid-cols-3 gap-2.5 text-xs">
              <div className="bg-[#181c22] p-3 rounded border border-[#404752]/40 space-y-1">
                <div className="flex items-center gap-1.5 text-[#8a919e]">
                  <Users className="w-3.5 h-3.5 text-[#0078d4]" />
                  <span className="font-bold text-[10px] uppercase">Identity Risk</span>
                </div>
                <div className="text-base font-bold text-[#e0e2ea]">2 High Risk</div>
                <div className="text-[10px] text-[#fb923c]">5 Risky Sign-ins (24h)</div>
              </div>

              <div className="bg-[#181c22] p-3 rounded border border-[#404752]/40 space-y-1">
                <div className="flex items-center gap-1.5 text-[#8a919e]">
                  <Lock className="w-3.5 h-3.5 text-[#4ade80]" />
                  <span className="font-bold text-[10px] uppercase">CA Policy Coverage</span>
                </div>
                <div className="text-base font-bold text-[#e0e2ea]">{activeTenant.conditionalAccessPoliciesCount} Policies Active</div>
                <div className="text-[10px] text-[#4ade80]">88% User MFA Enforced</div>
              </div>

              <div className="bg-[#181c22] p-3 rounded border border-[#404752]/40 space-y-1">
                <div className="flex items-center gap-1.5 text-[#8a919e]">
                  <Laptop className="w-3.5 h-3.5 text-[#a3c9ff]" />
                  <span className="font-bold text-[10px] uppercase">Endpoint Health</span>
                </div>
                <div className="text-base font-bold text-[#e0e2ea]">96.4% Compliant</div>
                <div className="text-[10px] text-[#4ade80]">310 Devices Enrolled</div>
              </div>
            </div>
          </div>

          {/* B. Graph API Monitoring & Drift Feed */}
          <div className="bg-[#101419] border border-[#404752] rounded-lg p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between border-b border-[#404752] pb-2">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-[#a3c9ff]" />
                <h2 className="text-sm font-bold text-[#e0e2ea]">
                  Microsoft Graph API Monitoring &amp; Policy Drift Feed
                </h2>
              </div>
              <span className="text-[10px] text-[#4ade80] font-mono bg-[#052e16] border border-[#166534] px-2 py-0.5 rounded">
                Polling Every 5 Mins
              </span>
            </div>

            <div className="space-y-2.5">
              {graphDriftFeed.map((item) => (
                <div
                  key={item.id}
                  className="bg-[#181c22] border border-[#404752]/60 p-3 rounded-md space-y-2 hover:border-[#0078d4] transition-colors"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${
                          item.severity === 'CRITICAL'
                            ? 'bg-[#93000a] text-white'
                            : item.severity === 'HIGH'
                            ? 'bg-[#713f12] text-white'
                            : 'bg-[#1e3a8a] text-white'
                        }`}
                      >
                        {item.severity}
                      </span>
                      <span className="text-[10px] font-bold text-[#a3c9ff] bg-[#0078d4]/10 border border-[#0078d4]/30 px-1.5 py-0.2 rounded font-mono">
                        {item.category}
                      </span>
                      <span className="text-[10px] text-[#8a919e] font-mono">{item.timestamp}</span>
                    </div>

                    <button
                      onClick={() =>
                        setSelectedGraphPayload({
                          endpoint: item.endpoint,
                          summary: item.summary,
                          json: item.graphPayload,
                        })
                      }
                      className="text-[11px] font-mono text-[#a3c9ff] hover:text-white bg-[#272a30] hover:bg-[#0078d4] px-2 py-0.5 rounded border border-[#404752] transition-colors flex items-center gap-1"
                    >
                      <Code2 className="w-3 h-3" />
                      <span>Inspect Graph JSON</span>
                    </button>
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-[#e0e2ea]">{item.summary}</h3>
                    <p className="text-[11px] text-[#8a919e] mt-0.5 font-mono text-[10px] text-[#c0c7d4] truncate">
                      {item.endpoint}
                    </p>
                    <p className="text-[11px] text-[#8a919e] mt-1">{item.details}</p>
                  </div>

                  <div className="pt-1.5 border-t border-[#404752]/40 flex justify-end">
                    <button
                      onClick={() => handleRunWorkflowAction(`wf-${item.id}`, item.actionTitle)}
                      className="bg-[#0078d4] hover:bg-[#0060ab] text-white px-2.5 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1 shadow-sm"
                    >
                      <Zap className="w-3 h-3" />
                      <span>{item.actionTitle}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* C. Active Remediation Task Queue */}
          <div className="bg-[#101419] border border-[#404752] rounded-lg p-4 space-y-3 shadow-sm">
            <div className="flex flex-wrap items-center justify-between border-b border-[#404752] pb-2 gap-2">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-[#0078d4]" />
                <h2 className="text-sm font-bold text-[#e0e2ea]">Active Remediation Task Queue</h2>
              </div>

              {/* Task Filter Tabs */}
              <div className="flex items-center gap-1 bg-[#181c22] p-0.5 rounded border border-[#404752]">
                {(['ALL', 'Pending Approval', 'Running', 'Completed'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setTaskFilter(tab)}
                    className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${
                      taskFilter === tab ? 'bg-[#0078d4] text-white' : 'text-[#8a919e] hover:text-[#e0e2ea]'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {filteredTasks.map((task) => (
                <div
                  key={task.id}
                  className="bg-[#181c22] border border-[#404752]/60 p-2.5 rounded flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#e0e2ea]">{task.title}</span>
                      <span className="text-[10px] text-[#a3c9ff] font-mono bg-[#0078d4]/10 border border-[#0078d4]/30 px-1 rounded">
                        {task.category}
                      </span>
                    </div>
                    <div className="text-[10px] text-[#8a919e] font-mono mt-0.5">
                      Target: <span className="text-[#c0c7d4]">{task.target}</span> • By {task.initiatedBy} ({task.startedAt})
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${
                      task.status === 'Completed'
                        ? 'bg-[#052e16] text-[#4ade80] border border-[#166534]'
                        : task.status === 'Running'
                        ? 'bg-[#1e3a8a] text-[#a3c9ff] border border-[#1d4ed8] animate-pulse'
                        : 'bg-[#451a03] text-[#fb923c] border border-[#9a3412]'
                    }`}
                  >
                    {task.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: 35% Width (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* A. Proof of Value Delivered Widget */}
          <div className="bg-[#101419] border border-[#404752] rounded-lg p-4 space-y-3 shadow-sm bg-gradient-to-br from-[#101419] via-[#101419] to-[#166534]/10">
            <div className="flex items-center justify-between border-b border-[#404752] pb-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#4ade80]" />
                <h2 className="text-sm font-bold text-[#e0e2ea]">Proof of Value &amp; MSP Impact</h2>
              </div>
              <span className="text-[10px] bg-[#166534] text-[#4ade80] px-2 py-0.5 rounded font-bold">
                This Month
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-[#181c22] p-2.5 rounded border border-[#404752]/40">
                <div className="text-lg font-bold text-[#4ade80]">18.5 hrs</div>
                <div className="text-[10px] text-[#8a919e] font-medium">Tech Hours Saved</div>
              </div>

              <div className="bg-[#181c22] p-2.5 rounded border border-[#404752]/40">
                <div className="text-lg font-bold text-[#a3c9ff]">42</div>
                <div className="text-[10px] text-[#8a919e] font-medium">Drifts Auto-Healed</div>
              </div>

              <div className="bg-[#181c22] p-2.5 rounded border border-[#404752]/40">
                <div className="text-lg font-bold text-[#4ade80]">0</div>
                <div className="text-[10px] text-[#8a919e] font-medium">Breaches / Leaks</div>
              </div>
            </div>
          </div>

          {/* B. License Optimization & MRR Opportunity Engine */}
          <div className="bg-[#101419] border border-[#0078d4]/50 rounded-lg p-4 space-y-3 shadow-md bg-gradient-to-br from-[#101419] via-[#101419] to-[#0078d4]/10">
            <div className="flex items-center justify-between border-b border-[#404752] pb-2">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-[#4ade80]" />
                <h2 className="text-sm font-bold text-[#e0e2ea]">License Optimization &amp; MRR Engine</h2>
              </div>
              <span className="text-[10px] bg-[#166534] text-[#4ade80] px-2 py-0.5 rounded font-bold">
                +$926/mo MRR Growth
              </span>
            </div>

            {/* Unassigned License Waste */}
            <div className="bg-[#181c22] border border-[#ffb4ab]/30 p-3 rounded space-y-1">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-[#ffb4ab]">Unassigned Seats Waste</span>
                <span className="font-mono text-xs font-bold text-[#ffdad6]">$620 / mo</span>
              </div>
              <p className="text-[11px] text-[#8a919e]">
                75 Microsoft 365 E5 licenses unassigned &gt;45 days. Reclaim or deprovision.
              </p>
            </div>

            {/* Security Add-on Upsell */}
            <div className="bg-[#181c22] border border-[#0078d4]/40 p-3 rounded space-y-1">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-[#a3c9ff]">Defender P2 Upgrade Gap</span>
                <span className="font-mono text-xs font-bold text-[#4ade80]">+$306 / mo</span>
              </div>
              <p className="text-[11px] text-[#8a919e]">
                34 users lack Defender for Endpoint Plan 2. Upgrade from Business Basic.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => {
                  if (onShowToast) {
                    onShowToast('success', 'Proposal PDF Generated', `Sales proposal ready for ${activeTenant.name}`);
                  }
                }}
                className="bg-[#0078d4] hover:bg-[#0060ab] text-white py-1.5 px-2 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1 shadow-sm"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Sales Proposal PDF</span>
              </button>

              <button
                onClick={() => {
                  if (onShowToast) {
                    onShowToast('info', 'Offer Dispatched', `Upgrade offer sent to client administrator.`);
                  }
                }}
                className="bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] py-1.5 px-2 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1 border border-[#404752]"
              >
                <Send className="w-3.5 h-3.5 text-[#a3c9ff]" />
                <span>Send Offer Email</span>
              </button>
            </div>
          </div>

          {/* C. Automated Background Workflows & Cron Status */}
          <div className="bg-[#101419] border border-[#404752] rounded-lg p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between border-b border-[#404752] pb-2">
              <div className="flex items-center gap-2">
                <RotateCw className="w-4 h-4 text-[#0078d4]" />
                <h2 className="text-sm font-bold text-[#e0e2ea]">Automated Background Workflows &amp; Cron</h2>
              </div>
              <span className="text-[10px] text-[#4ade80] font-mono">3 Active Crons</span>
            </div>

            <div className="space-y-2">
              <div className="bg-[#181c22] border border-[#404752]/50 p-2.5 rounded flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-[#e0e2ea]">5-min Graph Drift Monitor</div>
                  <div className="text-[10px] text-[#8a919e] font-mono">Cadence: Every 5 Mins • Last: 2m ago</div>
                </div>
                <span className="text-[10px] bg-[#052e16] text-[#4ade80] px-2 py-0.5 rounded font-mono font-bold border border-[#166534]">
                  Healthy
                </span>
              </div>

              <div className="bg-[#181c22] border border-[#404752]/50 p-2.5 rounded flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-[#e0e2ea]">Nightly License Auditor</div>
                  <div className="text-[10px] text-[#8a919e] font-mono">Cadence: Daily @ 01:00 UTC • Last: 19h ago</div>
                </div>
                <span className="text-[10px] bg-[#052e16] text-[#4ade80] px-2 py-0.5 rounded font-mono font-bold border border-[#166534]">
                  Passed
                </span>
              </div>

              <div className="bg-[#181c22] border border-[#404752]/50 p-2.5 rounded flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-[#e0e2ea]">Stale B2B Guest Cleanup</div>
                  <div className="text-[10px] text-[#8a919e] font-mono">Cadence: Weekly on Sundays • Last: 3 days ago</div>
                </div>
                <span className="text-[10px] bg-[#0078d4]/20 text-[#a3c9ff] px-2 py-0.5 rounded font-mono font-bold border border-[#0078d4]/40">
                  Scheduled
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Raw Graph JSON Payload Inspection Drawer (Slide-out Drawer) */}
      {selectedGraphPayload && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div
            className="fixed inset-0"
            onClick={() => {
              setSelectedGraphPayload(null);
              setCopiedJson(false);
            }}
          />
          <div className="relative w-full max-w-2xl bg-[#101419] border-l border-[#404752] shadow-2xl h-full flex flex-col z-10 text-xs">
            {/* Drawer Header */}
            <div className="p-4 border-b border-[#404752] flex items-center justify-between bg-[#181c22]">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-[#a3c9ff]" />
                <div>
                  <h2 className="font-bold text-sm text-[#e0e2ea]">Microsoft Graph API JSON Response</h2>
                  <p className="text-[10px] text-[#8a919e] font-mono">{selectedGraphPayload.endpoint}</p>
                </div>
              </div>

              <button
                onClick={() => {
                  setSelectedGraphPayload(null);
                  setCopiedJson(false);
                }}
                className="p-1 rounded text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#272a30] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="p-4 flex-1 overflow-y-auto space-y-3 font-mono">
              <div className="bg-[#181c22] p-2.5 rounded border border-[#404752] text-[11px] font-sans text-[#e0e2ea]">
                <strong>Drift Context:</strong> {selectedGraphPayload.summary}
              </div>

              <div className="bg-[#080a0e] border border-[#272a30] p-4 rounded-md overflow-x-auto text-[#a3c9ff] leading-relaxed relative">
                <pre>{JSON.stringify(selectedGraphPayload.json, null, 2)}</pre>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-[#404752] bg-[#181c22] flex items-center justify-between">
              <span className="text-[10px] text-[#8a919e] font-mono">
                Source: Microsoft Graph API v1.0 Production Endpoint
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(selectedGraphPayload.json, null, 2));
                    setCopiedJson(true);
                    setTimeout(() => setCopiedJson(false), 2000);
                  }}
                  className="bg-[#272a30] hover:bg-[#0078d4] text-[#e0e2ea] px-3 py-1.5 rounded font-semibold transition-colors flex items-center gap-1.5 border border-[#404752]"
                >
                  {copiedJson ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#4ade80]" />
                      <span className="text-[#4ade80] font-bold">Payload Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Raw JSON</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => {
                    setSelectedGraphPayload(null);
                    setCopiedJson(false);
                  }}
                  className="bg-[#0078d4] hover:bg-[#0060ab] text-white px-3 py-1.5 rounded font-semibold transition-colors"
                >
                  Close Drawer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Cmd+K Action Search Dialog Modal */}
      {isCmdKOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/60 backdrop-blur-xs">
          <div className="fixed inset-0" onClick={() => setIsCmdKOpen(false)} />
          <div className="relative w-full max-w-lg bg-[#181c22] border border-[#404752] rounded-lg shadow-2xl overflow-hidden z-10 text-xs">
            <div className="p-3 border-b border-[#404752] flex items-center gap-2 bg-[#101419]">
              <Search className="w-4 h-4 text-[#8a919e]" />
              <input
                type="text"
                autoFocus
                value={cmdKQuery}
                onChange={(e) => setCmdKQuery(e.target.value)}
                placeholder="Search technician actions, workflows, or policies (e.g. MFA, Sync, GDAP)..."
                className="bg-transparent border-none text-[#e0e2ea] placeholder-[#8a919e] w-full focus:outline-none text-xs"
              />
              <button
                onClick={() => setIsCmdKOpen(false)}
                className="text-[#8a919e] hover:text-[#e0e2ea] text-[10px] font-mono bg-[#272a30] px-1.5 py-0.5 rounded"
              >
                ESC
              </button>
            </div>

            <div className="p-2 max-h-64 overflow-y-auto space-y-1">
              <div className="px-2 py-1 text-[10px] font-bold text-[#8a919e] uppercase font-mono">
                Suggested Actions for {activeTenant.name}
              </div>

              {[
                { title: 'Trigger Instant Graph API Polling', action: () => handleTriggerRefresh() },
                { title: 'Request 180-Day GDAP Access Extension', action: () => handleExtendGDAP() },
                { title: 'Execute MFA Lockdown Workflow', action: () => handleRunWorkflowAction('wf-mfa-lockdown', 'MFA Lockdown Workflow') },
                { title: 'Reclaim 75 Unassigned E5 Seats', action: () => handleRunWorkflowAction('wf-reclaim-licenses', 'Reclaim Inactive Licenses') },
                { title: 'Generate Executive PDF Security Report', action: () => onShowToast && onShowToast('success', 'PDF Exported', 'Executive PDF ready.') },
              ]
                .filter((item) => item.title.toLowerCase().includes(cmdKQuery.toLowerCase()))
                .map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      item.action();
                      setIsCmdKOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded hover:bg-[#272a30] text-[#e0e2ea] flex items-center justify-between group"
                  >
                    <span>{item.title}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-[#8a919e] group-hover:text-[#a3c9ff]" />
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

