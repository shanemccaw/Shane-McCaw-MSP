import React, { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Flame,
  Fingerprint,
  FileLock2,
  Activity,
  TrendingUp,
  Eye,
  RefreshCw,
  Search,
  Lock,
  AlertOctagon,
  Download,
  Terminal,
  CheckCircle2,
  BarChart3,
  Globe,
  Code2,
  X,
  Building2,
  Users2,
  AlertTriangle,
  FileText,
  Copy,
  Check,
  Zap,
  Sliders,
  Filter,
  Layers,
  Sparkles,
  KeyRound,
  Mail,
  HardDrive,
  Trash2,
  ExternalLink,
  Info,
  Clock,
  Radio,
  UserX,
  UserCheck,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Tenant } from '../../types';

interface SecurityComplianceConsoleProps {
  tenants?: Tenant[];
  selectedTenant?: Tenant | null;
  onSelectTenant?: (tenant: Tenant | null) => void;
  onExecuteWorkflow?: (actionId: string, params: Record<string, any>) => void;
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
  onTriggerAction?: (actionTitle: string, tenantName: string) => void;
}

type TabType = 'posture' | 'xdr' | 'identity' | 'purview' | 'audit';

export const SecurityComplianceConsole: React.FC<SecurityComplianceConsoleProps> = ({
  tenants = [],
  selectedTenant,
  onSelectTenant,
  onExecuteWorkflow,
  onShowToast,
  onTriggerAction,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('posture');
  const [isPolling, setIsPolling] = useState(false);

  // Active Tenant Selection
  const activeTenant = selectedTenant || tenants[0] || {
    id: 'contoso-tenant-01',
    name: 'Contoso Corporation',
    primaryDomain: 'contoso.onmicrosoft.com',
    secureScore: 68.0,
    mfaPercentage: 88.5,
    activeAlertsCount: 4,
    licenseTier: 'M365 E5 Enterprise',
  };

  // State for Gated Workflow Confirmation Modal
  const [gatedActionModal, setGatedActionModal] = useState<{
    actionId: string;
    title: string;
    endpoint: string;
    payload: Record<string, any>;
  } | null>(null);

  const [ticketReasonId, setTicketReasonId] = useState('INC-SOC-2026-88');

  // State for Drawer JSON Inspection
  const [activeDrawer, setActiveDrawer] = useState<{
    title: string;
    endpoint: string;
    data: any;
  } | null>(null);

  // Search Filter state
  const [auditQuery, setAuditQuery] = useState('');
  const [auditStatusFilter, setAuditStatusFilter] = useState<'all' | 'Success' | 'Failure'>('all');

  // Trigger Re-poll
  const handlePollEndpoints = () => {
    setIsPolling(true);
    onShowToast?.(
      'info',
      'Graph Re-Poll Dispatched',
      `Polling 122 Microsoft Graph security endpoints for ${activeTenant.name}...`
    );
    setTimeout(() => {
      setIsPolling(false);
      onShowToast?.(
        'success',
        'Telemetry Refreshed',
        `Evaluated latest threat signals from Defender XDR & Entra ID Protection.`
      );
    }, 800);
  };

  // Execute Gated High Risk Action
  const handleConfirmGatedDispatch = () => {
    if (!gatedActionModal) return;
    const { actionId, title, payload } = gatedActionModal;

    if (onExecuteWorkflow) {
      onExecuteWorkflow(actionId, {
        ...payload,
        ticketId: ticketReasonId,
        executedBy: 'soc-admin@apexms.com',
        timestamp: new Date().toISOString(),
      });
    }

    onShowToast?.(
      'success',
      `Workflow Executed: ${title}`,
      `Dispatched to Graph API. Ticket reference: ${ticketReasonId}`
    );

    setGatedActionModal(null);
  };

  // Tab 1: Secure Score Trend Data
  const secureScoreTrend = [
    { month: 'Feb', score: 58, benchmark: 75 },
    { month: 'Mar', score: 61, benchmark: 76 },
    { month: 'Apr', score: 63, benchmark: 77 },
    { month: 'May', score: 65, benchmark: 78 },
    { month: 'Jun', score: 66, benchmark: 78 },
    { month: 'Jul', score: 68, benchmark: 79 },
  ];

  // Tab 1: Category Score Breakdown
  const categoryBreakdown = [
    { category: 'Identity', current: 82, max: 100, color: 'bg-emerald-500' },
    { category: 'Data & Purview', current: 45, max: 100, color: 'bg-red-500' },
    { category: 'Endpoints & Devices', current: 90, max: 100, color: 'bg-emerald-500' },
    { category: 'SaaS Apps & Cloud', current: 60, max: 100, color: 'bg-amber-500' },
  ];

  // Tab 1: Secure Score Control Profiles
  const controlProfiles = [
    {
      id: 'mfa-admin',
      name: 'Require MFA for all administrative roles',
      category: 'Identity',
      maxPoints: 10,
      currentPoints: 10,
      impact: 'High',
      status: 'Implemented',
      endpoint: '/security/secureScoreControlProfiles/RequireMFAForAdmins',
      payload: { controlName: 'RequireMFAForAdmins', points: 10, state: 'enforced' },
    },
    {
      id: 'legacy-auth',
      name: 'Block legacy authentication protocols',
      category: 'Identity',
      maxPoints: 8,
      currentPoints: 8,
      impact: 'High',
      status: 'Implemented',
      endpoint: '/identity/conditionalAccess/policies/ca-block-legacy',
      payload: { policyId: 'ca-block-legacy', state: 'enabled' },
    },
    {
      id: 'dlp-sharepoint',
      name: 'Enable Purview DLP policies for sensitive SharePoint sites',
      category: 'Data',
      maxPoints: 12,
      currentPoints: 0,
      impact: 'Medium',
      status: 'Not Implemented',
      endpoint: '/security/secureScoreControlProfiles/EnablePurviewDLPSharePoint',
      payload: { controlName: 'EnablePurviewDLPSharePoint', targetPoints: 12 },
    },
    {
      id: 'defender-p2',
      name: 'Configure Defender for Identity automated investigation',
      category: 'Identity',
      maxPoints: 7,
      currentPoints: 3,
      impact: 'Medium',
      status: 'Partial',
      endpoint: '/security/secureScoreControlProfiles/ConfigureDefenderAIR',
      payload: { controlName: 'ConfigureDefenderAIR', currentCoverage: '42%' },
    },
  ];

  // Tab 2: Incident Severity Donut Data
  const incidentDonutData = [
    { name: 'Critical', value: 1, color: '#ef4444' },
    { name: 'High', value: 2, color: '#f97316' },
    { name: 'Medium', value: 4, color: '#eab308' },
    { name: 'Low', value: 8, color: '#3b82f6' },
  ];

  // Tab 2: Defender XDR Incident Stream
  const [incidents, setIncidents] = useState([
    {
      id: 'INC-9021',
      title: 'Impossible Travel followed by Privileged Role Elevation',
      severity: 'Critical',
      asset: 'm.vance@contoso.com (Host: WIN-FIN-882)',
      source: 'Defender for Cloud Apps',
      timestamp: '2026-07-23 20:42:10',
      status: 'Active',
      payload: {
        incidentId: 'INC-9021',
        threatType: 'ImpossibleTravel',
        originIp: '185.220.101.4 (Tor exit node)',
        targetUPN: 'm.vance@contoso.com',
      },
    },
    {
      id: 'INC-8994',
      title: 'Potential Ransomware Activity: Mass File Renaming Detected',
      severity: 'High',
      asset: 'Host: ENG-DEV-901',
      source: 'Defender for Endpoint',
      timestamp: '2026-07-23 19:15:00',
      status: 'Active',
      payload: {
        incidentId: 'INC-8994',
        deviceId: 'ENG-DEV-901',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        process: 'vssadmin.exe delete shadows',
      },
    },
    {
      id: 'INC-8850',
      title: 'Suspicious Mail Forwarding Rule Created for CFO Inbox',
      severity: 'Medium',
      asset: 'cfo@contoso.com',
      source: 'Defender for Office 365',
      timestamp: '2026-07-23 16:02:44',
      status: 'Investigating',
      payload: {
        incidentId: 'INC-8850',
        mailbox: 'cfo@contoso.com',
        forwardingAddress: 'exfil-audit-2026@protonmail.com',
      },
    },
  ]);

  // Tab 3: Risky Users List
  const [riskyUsers, setRiskyUsers] = useState([
    {
      upn: 'm.vance@contoso.com',
      riskLevel: 'High',
      riskDetail: 'Impossible travel & Anomalous sign-in',
      riskState: 'At Risk',
      lastUpdated: '12 mins ago',
      payload: {
        upn: 'm.vance@contoso.com',
        riskLevel: 'high',
        detectionTypes: ['anomalousLocation', 'unfamiliarFeatures', 'impossibleTravel'],
      },
    },
    {
      upn: 'j.smith@contoso.com',
      riskLevel: 'High',
      riskDetail: 'Leaked credentials found in Dark Web dump',
      riskState: 'At Risk',
      lastUpdated: '1 hour ago',
      payload: {
        upn: 'j.smith@contoso.com',
        riskLevel: 'high',
        detectionTypes: ['leakedCredentials'],
      },
    },
    {
      upn: 'a.garcia@contoso.com',
      riskLevel: 'Medium',
      riskDetail: 'Anonymous IP sign-in trigger',
      riskState: 'Investigating',
      lastUpdated: '3 hours ago',
      payload: {
        upn: 'a.garcia@contoso.com',
        riskLevel: 'medium',
        detectionTypes: ['anonymousIP'],
      },
    },
  ]);

  // Tab 4: DLP Matches Bar Data
  const dlpMatchesData = [
    { rule: 'Credit Card (PCI-DSS)', matches: 42 },
    { rule: 'US Social Security No.', matches: 28 },
    { rule: 'Passport & Identity', matches: 15 },
    { rule: 'Confidential IP Docs', matches: 34 },
  ];

  // Tab 4: Sensitivity Labels Pie Data
  const sensitivityPieData = [
    { name: 'Confidential', value: 45, color: '#ef4444' },
    { name: 'Internal', value: 35, color: '#3b82f6' },
    { name: 'Public', value: 20, color: '#10b981' },
  ];

  // Tab 4: DLP Violations Stream
  const dlpViolations = [
    {
      policy: 'PCI-DSS Outbound Credit Card Block',
      workload: 'Exchange Online',
      user: 'finance.lead@contoso.com',
      file: 'Q2_Vendor_Payments_Unencrypted.xlsx',
      action: 'Blocked',
      endpoint: '/sites/drive/items/item-01/revokePermissions',
    },
    {
      policy: 'US SSN Exfiltration Prevention',
      workload: 'SharePoint Online',
      user: 'hr.spec@contoso.com',
      file: '2026_Employee_Tax_Forms.zip',
      action: 'Audited',
      endpoint: '/informationProtection/sensitivityLabels',
    },
    {
      policy: 'Source Code Exfiltration Guard',
      workload: 'Teams Chat',
      user: 'dev.intern@contoso.com',
      file: 'aws_prod_credentials.env',
      action: 'Blocked',
      endpoint: '/exchange/transportRules',
    },
  ];

  // Tab 5: Unified Audit Stream Data
  const auditLogs = [
    {
      id: 'LOG-88102',
      timestamp: '2026-07-23 21:28:02',
      upn: 'm.vance@contoso.com',
      activity: 'Add member to role (Global Administrator)',
      ip: '185.220.101.4',
      status: 'Success',
      json: {
        activityDisplayName: 'Add member to role',
        category: 'RoleManagement',
        initiatedBy: { user: { userPrincipalName: 'm.vance@contoso.com' } },
        targetResources: [{ displayName: 'Global Administrator' }],
        result: 'success',
      },
    },
    {
      id: 'LOG-88094',
      timestamp: '2026-07-23 21:24:19',
      upn: 'sec-ops@contoso.com',
      activity: 'Revoke user sign-in sessions',
      ip: '64.233.160.1',
      status: 'Success',
      json: {
        activityDisplayName: 'RevokeSignInSessions',
        category: 'UserManagement',
        initiatedBy: { user: { userPrincipalName: 'sec-ops@contoso.com' } },
        targetResources: [{ displayName: 'j.smith@contoso.com' }],
        result: 'success',
      },
    },
    {
      id: 'LOG-88011',
      timestamp: '2026-07-23 21:10:05',
      upn: 'unknown@external.org',
      activity: 'User login failed (Invalid credentials)',
      ip: '103.152.220.12',
      status: 'Failure',
      json: {
        activityDisplayName: 'UserLoginFailed',
        category: 'Authentication',
        errorCode: 50126,
        failureReason: 'Invalid username or password',
        result: 'failure',
      },
    },
  ];

  // Filtered Audit Logs
  const filteredAuditLogs = auditLogs.filter((log) => {
    const matchesQuery =
      log.upn.toLowerCase().includes(auditQuery.toLowerCase()) ||
      log.activity.toLowerCase().includes(auditQuery.toLowerCase()) ||
      log.ip.includes(auditQuery);

    const matchesStatus =
      auditStatusFilter === 'all' || log.status === auditStatusFilter;

    return matchesQuery && matchesStatus;
  });

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-[#e0e2ea] font-sans overflow-y-auto select-none">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & SOC THREAT STATUS BAR (FULL WIDTH) */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] p-4 sm:p-5 shrink-0 shadow-sm">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          
          {/* Tenant & Global Threat Level Badge */}
          <div className="flex flex-wrap items-center gap-3.5">
            <div className="p-2.5 rounded bg-[#101419] border border-[#ffb4ab]/80 text-[#ffdad6]">
              <ShieldAlert className="w-6 h-6 animate-pulse text-[#ffdad6]" />
            </div>

            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-lg font-bold text-[#e0e2ea] tracking-tight flex items-center gap-2">
                  <span>Security & Compliance Operations Center</span>
                </h1>

                {/* Tenant Selector Dropdown */}
                {tenants.length > 0 && onSelectTenant && (
                  <select
                    value={activeTenant.id}
                    onChange={(e) => {
                      const sel = tenants.find((t) => t.id === e.target.value) || null;
                      onSelectTenant(sel);
                    }}
                    className="bg-[#101419] border border-[#404752] text-xs text-[#a3c9ff] font-semibold rounded px-2.5 py-1 outline-none focus:border-[#0078d4] cursor-pointer"
                  >
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        Tenant: {t.name}
                      </option>
                    ))}
                  </select>
                )}

                {/* Critical Threat Status Badge */}
                <span className="px-2.5 py-0.5 rounded bg-[#93000a]/30 text-[#ffdad6] border border-[#ffb4ab]/60 font-mono text-xs font-semibold flex items-center gap-1.5 animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-[#ffdad6]" />
                  CRITICAL: Active Incidents Detected
                </span>
              </div>

              {/* Service Mapping Indicators */}
              <p className="text-xs text-[#8a919e] mt-1 flex items-center gap-2 flex-wrap">
                <span>Domain: <strong className="text-[#e0e2ea]">{activeTenant.primaryDomain}</strong></span>
                <span>•</span>
                <span className="text-[#4ade80] font-medium">Defender XDR Connected</span>
                <span>•</span>
                <span className="text-purple-300 font-medium">Purview DLP Guardrails Enforced</span>
              </p>
            </div>
          </div>

          {/* Real-Time Telemetry Counters (4 Cards) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 min-w-[320px] lg:min-w-[580px]">
            
            {/* Secure Score */}
            <div className="p-2.5 rounded bg-[#101419] border border-[#404752] space-y-0.5">
              <span className="text-[10px] text-[#8a919e] font-bold uppercase tracking-wider block">
                Secure Score
              </span>
              <div className="text-sm font-bold text-[#a3c9ff] font-mono flex items-center justify-between">
                <span>{activeTenant.secureScore} / 100</span>
                <span className="text-[10px] text-[#8a919e] font-normal">Bench: 79</span>
              </div>
            </div>

            {/* High Risk Users */}
            <div className="p-2.5 rounded bg-[#101419] border border-[#404752] space-y-0.5">
              <span className="text-[10px] text-[#8a919e] font-bold uppercase tracking-wider block">
                High Risk Users
              </span>
              <div className="text-sm font-bold text-amber-300 font-mono flex items-center justify-between">
                <span>{riskyUsers.filter((u) => u.riskLevel === 'High').length} Users</span>
                <Fingerprint className="w-4 h-4 text-amber-300" />
              </div>
            </div>

            {/* Defender Incidents */}
            <div className="p-2.5 rounded bg-[#101419] border border-[#404752] space-y-0.5">
              <span className="text-[10px] text-[#8a919e] font-bold uppercase tracking-wider block">
                Active Incidents
              </span>
              <div className="text-sm font-bold text-red-400 font-mono flex items-center justify-between">
                <span>{incidents.length} Active</span>
                <Flame className="w-4 h-4 text-red-400" />
              </div>
            </div>

            {/* Quarantined Emails */}
            <div className="p-2.5 rounded bg-[#101419] border border-[#404752] space-y-0.5">
              <span className="text-[10px] text-[#8a919e] font-bold uppercase tracking-wider block">
                Quarantined
              </span>
              <div className="text-sm font-bold text-purple-300 font-mono flex items-center justify-between">
                <span>18 Mails</span>
                <FileLock2 className="w-4 h-4 text-purple-300" />
              </div>
            </div>
          </div>

          {/* Global Action Header Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handlePollEndpoints}
              disabled={isPolling}
              className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
              title="Polling 122 Graph Endpoints Every 5m"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#a3c9ff] ${isPolling ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Graph Re-Poll</span>
            </button>

            <button
              onClick={() =>
                onShowToast?.(
                  'success',
                  'Executive PDF Generated',
                  `Security & Compliance posture report saved for ${activeTenant.name}.`
                )
              }
              className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export SOC PDF</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. CORE NAVIGATION (5 SUB-DOMAIN TABS) */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] px-3 sm:px-5 overflow-x-auto shrink-0 scrollbar-none">
        <div className="flex items-center gap-2 min-w-max py-2">
          {[
            { id: 'posture', label: 'Security Posture & Secure Score', icon: BarChart3, badge: 'Score 68' },
            { id: 'xdr', label: 'Defender XDR & Incidents', icon: Flame, badge: `${incidents.length} Critical` },
            { id: 'identity', label: 'Identity Protection & Risky Sign-Ins', icon: Fingerprint, badge: `${riskyUsers.length} Risky Users` },
            { id: 'purview', label: 'Purview Data Governance & DLP', icon: FileLock2, badge: '3 Policies' },
            { id: 'audit', label: 'Unified Audit & Graph Stream', icon: Terminal, badge: 'Live Stream' },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded text-xs font-semibold transition-all border cursor-pointer ${
                  isActive
                    ? 'bg-[#0078d4] text-white border-[#0078d4] shadow-xs'
                    : 'bg-[#101419] text-[#8a919e] hover:text-[#e0e2ea] border-[#404752]'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-[#8a919e]'}`} />
                <span>{tab.label}</span>
                <span
                  className={`text-[9.5px] font-mono px-1.5 py-0.2 rounded ${
                    isActive ? 'bg-white/20 text-white' : 'bg-[#272a30] text-[#8a919e]'
                  }`}
                >
                  {tab.badge}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. SUB-DOMAIN TAB CONTENTS */}
      {/* ========================================================================= */}
      <div className="p-4 sm:p-6 space-y-6">

        {/* ----------------------------------------------------------------------- */}
        {/* TAB 1: SECURITY POSTURE & SECURE SCORE */}
        {/* ----------------------------------------------------------------------- */}
        {activeTab === 'posture' && (
          <div className="space-y-6">
            
            {/* Visuals Grid: Area Chart + Category Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Secure Score Historical Trend */}
              <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="font-extrabold text-white text-sm flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-blue-400" />
                      <span>6-Month Microsoft Secure Score Trajectory</span>
                    </h3>
                    <p className="text-xs text-slate-400">
                      Mapped from <code className="text-blue-300 font-mono">/security/secureScores</code>
                    </p>
                  </div>
                  <span className="px-2.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-xs font-mono font-bold">
                    Score: 68
                  </span>
                </div>

                <div className="h-60 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={secureScoreTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="scoreArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="month" stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 10 }} />
                      <YAxis domain={[40, 100]} stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 10 }} />
                      <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '11px' }} />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Area type="monotone" dataKey="score" name="Tenant Secure Score" stroke="#3b82f6" fill="url(#scoreArea)" strokeWidth={2.5} />
                      <Area type="monotone" dataKey="benchmark" name="Commercial Benchmark" stroke="#94a3b8" strokeDasharray="4 4" fill="none" strokeWidth={1.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Category Score Breakdown */}
              <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl flex flex-col justify-between">
                <div className="border-b border-slate-800 pb-3">
                  <h3 className="font-extrabold text-white text-sm flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-purple-400" />
                    <span>Category Score Breakdown</span>
                  </h3>
                  <p className="text-xs text-slate-400">Security posture distribution across 4 core domains</p>
                </div>

                <div className="space-y-3.5 my-auto">
                  {categoryBreakdown.map((cat, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span className="text-slate-200">{cat.category}</span>
                        <span className="font-mono text-white">{cat.current}%</span>
                      </div>
                      <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden p-0.5 border border-slate-800">
                        <div
                          className={`h-full rounded-full ${cat.color}`}
                          style={{ width: `${cat.current}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-xs text-slate-400 flex items-center justify-between">
                  <span>Weakest Domain: <strong className="text-red-400 font-mono">Data & Purview (45%)</strong></span>
                  <button
                    onClick={() => setActiveTab('purview')}
                    className="text-xs text-blue-400 hover:underline font-bold cursor-pointer"
                  >
                    View DLP Rules →
                  </button>
                </div>
              </div>
            </div>

            {/* Secure Score Control Profiles Table */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="font-extrabold text-white text-sm flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Secure Score Control Profiles (<code className="text-emerald-300 font-mono text-xs">/security/secureScoreControlProfiles</code>)</span>
                  </h3>
                  <p className="text-xs text-slate-400">Targeted security controls to increase overall tenant points.</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-mono uppercase text-[10px]">
                      <th className="py-2.5 px-3">Control Name</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3">Points</th>
                      <th className="py-2.5 px-3">User Impact</th>
                      <th className="py-2.5 px-3">Implementation Status</th>
                      <th className="py-2.5 px-3 text-right">Direct Remediations</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {controlProfiles.map((ctrl) => (
                      <tr key={ctrl.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-3 font-bold text-white max-w-xs">{ctrl.name}</td>
                        <td className="py-3 px-3 font-mono text-blue-300">{ctrl.category}</td>
                        <td className="py-3 px-3 font-mono font-bold text-emerald-400">
                          {ctrl.currentPoints} / {ctrl.maxPoints} pts
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              ctrl.impact === 'High' ? 'bg-amber-500/20 text-amber-300' : 'bg-blue-500/20 text-blue-300'
                            }`}
                          >
                            {ctrl.impact} Impact
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              ctrl.status === 'Implemented'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : ctrl.status === 'Partial'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : 'bg-red-500/20 text-red-300 border border-red-500/30'
                            }`}
                          >
                            {ctrl.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() =>
                                setActiveDrawer({
                                  title: `Control Graph Payload: ${ctrl.name}`,
                                  endpoint: ctrl.endpoint,
                                  data: ctrl.payload,
                                })
                              }
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10.5px] rounded border border-slate-700 flex items-center gap-1 cursor-pointer"
                            >
                              <Code2 className="w-3 h-3 text-blue-400" />
                              <span>JSON</span>
                            </button>

                            {ctrl.status !== 'Implemented' && (
                              <button
                                onClick={() =>
                                  setGatedActionModal({
                                    actionId: 'deploy-secure-control',
                                    title: `Deploy Control: ${ctrl.name}`,
                                    endpoint: ctrl.endpoint,
                                    payload: ctrl.payload,
                                  })
                                }
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10.5px] font-bold rounded shadow-md transition-all cursor-pointer"
                              >
                                Deploy Policy
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------------- */}
        {/* TAB 2: DEFENDER XDR & INCIDENT RESPONSE */}
        {/* ----------------------------------------------------------------------- */}
        {activeTab === 'xdr' && (
          <div className="space-y-6">
            
            {/* Donut Chart & Kill Chain Timeline */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Severity Donut */}
              <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl flex flex-col justify-between">
                <div className="border-b border-slate-800 pb-3">
                  <h3 className="font-extrabold text-white text-sm flex items-center gap-2">
                    <Flame className="w-4 h-4 text-red-400" />
                    <span>Active Incident Severity Breakdown</span>
                  </h3>
                  <p className="text-xs text-slate-400">Categorized by Defender XDR risk severity</p>
                </div>

                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={incidentDonutData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                        {incidentDonutData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '11px' }} />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Kill-Chain Attack Stage Timeline */}
              <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl">
                <div className="border-b border-slate-800 pb-3">
                  <h3 className="font-extrabold text-white text-sm flex items-center gap-2">
                    <Activity className="w-4 h-4 text-amber-400" />
                    <span>Kill-Chain Attack Stage Timeline</span>
                  </h3>
                  <p className="text-xs text-slate-400">Sequential threat propagation stages across tenant hosts</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 py-2">
                  {[
                    { stage: '1. Initial Access', desc: 'Tor Node Login', status: 'Detected', color: 'border-red-500/50 bg-red-950/30 text-red-300' },
                    { stage: '2. Execution', desc: 'vssadmin process', status: 'Blocked', color: 'border-amber-500/50 bg-amber-950/30 text-amber-300' },
                    { stage: '3. Priv Escalation', desc: 'Role Elevation', status: 'Active', color: 'border-red-500/50 bg-red-950/30 text-red-300' },
                    { stage: '4. Exfiltration', desc: 'Mail Forwarding', status: 'Interrupted', color: 'border-blue-500/50 bg-blue-950/30 text-blue-300' },
                  ].map((stg, i) => (
                    <div key={i} className={`p-3 rounded-2xl border space-y-1 ${stg.color}`}>
                      <div className="text-[11px] font-bold">{stg.stage}</div>
                      <div className="text-xs text-white font-mono font-semibold">{stg.desc}</div>
                      <span className="inline-block text-[9.5px] font-mono px-1.5 py-0.2 rounded bg-slate-950">
                        {stg.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Incidents Stream Table */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="font-extrabold text-white text-sm flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-red-400" />
                    <span>Defender XDR Incident Stream (<code className="text-red-300 font-mono text-xs">/security/alerts_v2</code>)</span>
                  </h3>
                  <p className="text-xs text-slate-400">Active alerts requiring immediate incident containment.</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-mono uppercase text-[10px]">
                      <th className="py-2.5 px-3">Alert ID & Incident</th>
                      <th className="py-2.5 px-3">Severity</th>
                      <th className="py-2.5 px-3">Affected Asset</th>
                      <th className="py-2.5 px-3">Detection Source</th>
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3 text-right">Remediation Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {incidents.map((inc) => (
                      <tr key={inc.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-3">
                          <div className="font-bold text-white">{inc.title}</div>
                          <div className="text-[10px] text-blue-300 font-mono mt-0.5">{inc.id}</div>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              inc.severity === 'Critical'
                                ? 'bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            }`}
                          >
                            {inc.severity}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-300 font-mono text-[11px]">{inc.asset}</td>
                        <td className="py-3 px-3 text-purple-300 font-mono text-[11px]">{inc.source}</td>
                        <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">{inc.timestamp}</td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() =>
                                setGatedActionModal({
                                  actionId: 'isolate-device',
                                  title: `Isolate Endpoint for ${inc.id}`,
                                  endpoint: 'POST /deviceManagement/managedDevices/{id}/isolate',
                                  payload: inc.payload,
                                })
                              }
                              className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white text-[10.5px] font-bold rounded shadow-md transition-all cursor-pointer"
                            >
                              Isolate Device
                            </button>
                            <button
                              onClick={() =>
                                setGatedActionModal({
                                  actionId: 'block-file-hash',
                                  title: `Block File Indicator (${inc.id})`,
                                  endpoint: 'POST /security/threatIntelligence/indicators',
                                  payload: inc.payload,
                                })
                              }
                              className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white text-[10.5px] font-bold rounded cursor-pointer"
                            >
                              Block Hash
                            </button>
                            <button
                              onClick={() => {
                                setIncidents((prev) => prev.filter((i) => i.id !== inc.id));
                                onShowToast?.('info', 'Alert Dismissed', `Marked ${inc.id} as False Positive.`);
                              }}
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10.5px] rounded border border-slate-700 cursor-pointer"
                            >
                              Dismiss
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------------- */}
        {/* TAB 3: IDENTITY PROTECTION & RISKY SIGN-INS */}
        {/* ----------------------------------------------------------------------- */}
        {activeTab === 'identity' && (
          <div className="space-y-6">
            
            {/* Heatmap Banner */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-3 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="font-extrabold text-white text-sm flex items-center gap-2">
                    <Fingerprint className="w-4 h-4 text-amber-400" />
                    <span>Entra ID Protection & Anomalous Sign-In Telemetry (<code className="text-amber-300 font-mono text-xs">/identityProtection/riskyUsers</code>)</span>
                  </h3>
                  <p className="text-xs text-slate-400">Map of abnormal login origins & anonymous IP proxy triggers.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="text-[10.5px] text-slate-400 font-bold uppercase">Tor Proxy Trigger</div>
                  <div className="text-base font-bold text-red-400 font-mono">185.220.101.4 (Frankfurt)</div>
                  <div className="text-[10px] text-slate-500">Associated UPN: m.vance@contoso.com</div>
                </div>
                <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="text-[10.5px] text-slate-400 font-bold uppercase">Impossible Travel</div>
                  <div className="text-base font-bold text-amber-400 font-mono">NY -&gt; Moscow (22 mins)</div>
                  <div className="text-[10px] text-slate-500">Velocity delta: 4,200 mph</div>
                </div>
                <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="text-[10.5px] text-slate-400 font-bold uppercase">Leaked Credentials</div>
                  <div className="text-base font-bold text-purple-400 font-mono">2 Accounts in Dump</div>
                  <div className="text-[10px] text-slate-500">Source: DarkWeb Breach DB</div>
                </div>
              </div>
            </div>

            {/* Risky Users Table */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-mono uppercase text-[10px]">
                      <th className="py-2.5 px-3">User UPN</th>
                      <th className="py-2.5 px-3">Risk Level</th>
                      <th className="py-2.5 px-3">Risk Detail</th>
                      <th className="py-2.5 px-3">Last Updated</th>
                      <th className="py-2.5 px-3 text-right">Identity Remediations</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {riskyUsers.map((user, i) => (
                      <tr key={i} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-3 font-bold text-white font-mono">{user.upn}</td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              user.riskLevel === 'High'
                                ? 'bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            }`}
                          >
                            {user.riskLevel} Risk
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-300">{user.riskDetail}</td>
                        <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">{user.lastUpdated}</td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() =>
                                setGatedActionModal({
                                  actionId: 'confirm-user-compromised',
                                  title: `Confirm Compromised: ${user.upn}`,
                                  endpoint: 'POST /identityProtection/riskyUsers/confirmCompromised',
                                  payload: user.payload,
                                })
                              }
                              className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white text-[10.5px] font-bold rounded shadow-md cursor-pointer"
                            >
                              Confirm Compromised
                            </button>
                            <button
                              onClick={() =>
                                onShowToast?.(
                                  'success',
                                  'TAP Method Created',
                                  `Generated Temporary Access Pass for ${user.upn}.`
                                )
                              }
                              className="px-2 py-1 bg-purple-600 hover:bg-purple-500 text-white text-[10.5px] font-bold rounded cursor-pointer"
                            >
                              Generate TAP
                            </button>
                            <button
                              onClick={() => {
                                setRiskyUsers((prev) => prev.filter((u) => u.upn !== user.upn));
                                onShowToast?.('info', 'User Risk Dismissed', `Cleared risk state for ${user.upn}.`);
                              }}
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10.5px] rounded border border-slate-700 cursor-pointer"
                            >
                              Dismiss Risk
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------------- */}
        {/* TAB 4: PURVIEW DATA GOVERNANCE & DLP */}
        {/* ----------------------------------------------------------------------- */}
        {activeTab === 'purview' && (
          <div className="space-y-6">
            
            {/* Visuals Grid: Bar Chart + Pie Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* DLP Matches Bar Chart */}
              <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl">
                <div className="border-b border-slate-800 pb-3">
                  <h3 className="font-extrabold text-white text-sm flex items-center gap-2">
                    <FileLock2 className="w-4 h-4 text-purple-400" />
                    <span>DLP Rule Matches by Sensitive Information Type</span>
                  </h3>
                  <p className="text-xs text-slate-400">Purview compliance telemetry across Exchange, Teams, & SharePoint</p>
                </div>

                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dlpMatchesData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="rule" stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 10 }} />
                      <YAxis stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 10 }} />
                      <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '11px' }} />
                      <Bar dataKey="matches" name="DLP Matches" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Sensitivity Pie Chart */}
              <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl flex flex-col justify-between">
                <div className="border-b border-slate-800 pb-3">
                  <h3 className="font-extrabold text-white text-sm flex items-center gap-2">
                    <Lock className="w-4 h-4 text-blue-400" />
                    <span>Sensitivity Label Distribution</span>
                  </h3>
                  <p className="text-xs text-slate-400">Percentage of classified tenant documents</p>
                </div>

                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={sensitivityPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={4} dataKey="value">
                        {sensitivityPieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '11px' }} />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* DLP Violations Table */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl">
              <div className="border-b border-slate-800 pb-3">
                <h3 className="font-extrabold text-white text-sm flex items-center gap-2">
                  <FileText className="w-4 h-4 text-purple-400" />
                  <span>DLP Violations & External File Sharing Exfiltration Audit</span>
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-mono uppercase text-[10px]">
                      <th className="py-2.5 px-3">Policy Name</th>
                      <th className="py-2.5 px-3">Workload</th>
                      <th className="py-2.5 px-3">Violating User</th>
                      <th className="py-2.5 px-3">File / Asset</th>
                      <th className="py-2.5 px-3">Action Taken</th>
                      <th className="py-2.5 px-3 text-right">DLP Remediations</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {dlpViolations.map((v, i) => (
                      <tr key={i} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-3 font-bold text-white">{v.policy}</td>
                        <td className="py-3 px-3 font-mono text-purple-300">{v.workload}</td>
                        <td className="py-3 px-3 text-slate-300 font-mono text-[11px]">{v.user}</td>
                        <td className="py-3 px-3 text-blue-300 font-mono text-[11px]">{v.file}</td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              v.action === 'Blocked' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {v.action}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            onClick={() =>
                              setGatedActionModal({
                                actionId: 'revoke-external-access',
                                title: `Revoke External Access: ${v.file}`,
                                endpoint: v.endpoint,
                                payload: { user: v.user, file: v.file, workload: v.workload },
                              })
                            }
                            className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white text-[10.5px] font-bold rounded shadow-md cursor-pointer"
                          >
                            Revoke External Access
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------------- */}
        {/* TAB 5: UNIFIED AUDIT & GRAPH EVENT SEARCH */}
        {/* ----------------------------------------------------------------------- */}
        {activeTab === 'audit' && (
          <div className="space-y-6">
            
            {/* Search Filter Bar */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-xl">
              
              <div className="flex-1 relative">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter audit stream by UPN, IP Address, or Activity Name..."
                  value={auditQuery}
                  onChange={(e) => setAuditQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-xs text-white rounded-xl pl-9 pr-4 py-2 outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={auditStatusFilter}
                  onChange={(e) => setAuditStatusFilter(e.target.value as any)}
                  className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-xl px-3 py-2 outline-none focus:border-blue-500 font-mono cursor-pointer"
                >
                  <option value="all">All Outcomes</option>
                  <option value="Success">Success Only</option>
                  <option value="Failure">Failures Only</option>
                </select>

                <button
                  onClick={() =>
                    onShowToast?.(
                      'success',
                      'Automated Alert Created',
                      `New alert rule created for search query: "${auditQuery || 'All Events'}"`
                    )
                  }
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-md transition-all shrink-0 cursor-pointer"
                >
                  Create Alert Rule
                </button>
              </div>
            </div>

            {/* Terminal Log Viewer */}
            <div className="bg-slate-950 border border-slate-800/90 rounded-3xl p-5 space-y-4 shadow-2xl font-mono text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 text-slate-400">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  <span className="font-bold text-white">Unified Audit Log Stream (<code className="text-emerald-300">/auditLogs/directoryAudits</code>)</span>
                </div>
                <span className="text-[10.5px] text-slate-500">{filteredAuditLogs.length} Events Logged</span>
              </div>

              <div className="space-y-2">
                {filteredAuditLogs.map((log) => (
                  <div
                    key={log.id}
                    onClick={() =>
                      setActiveDrawer({
                        title: `Graph Event: ${log.activity}`,
                        endpoint: `/auditLogs/directoryAudits/${log.id}`,
                        data: log.json,
                      })
                    }
                    className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-blue-500/60 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2 group"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-slate-500 text-[11px]">{log.timestamp}</span>
                        <span className="text-blue-300 font-bold">{log.upn}</span>
                        <span className="text-slate-400">IP: {log.ip}</span>
                      </div>
                      <div className="text-white font-semibold group-hover:text-blue-300 transition-colors">
                        {log.activity}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          log.status === 'Success' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                        }`}
                      >
                        {log.status}
                      </span>
                      <Code2 className="w-4 h-4 text-slate-500 group-hover:text-blue-400 transition-colors" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* 4. MODALS & DRAWERS (GATED WORKFLOW CONFIRMATION & GRAPH JSON DRAWER) */}
      {/* ========================================================================= */}

      {/* Gated Action Modal */}
      {gatedActionModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-red-500/50 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl relative">
            <button
              onClick={() => setGatedActionModal(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
              <div className="p-2.5 rounded-xl bg-red-950/80 border border-red-800 text-red-400">
                <ShieldAlert className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-white">Gated / High-Risk Remediation</h3>
                <p className="text-xs text-red-300 font-mono">Secondary supervisor sign-off required</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-slate-300">
                Action: <strong className="text-white">{gatedActionModal.title}</strong>
              </div>
              <div className="text-xs text-slate-400">
                Target Endpoint: <code className="text-blue-300 font-mono">{gatedActionModal.endpoint}</code>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-emerald-400 font-mono text-[11px] max-h-36 overflow-y-auto">
                {JSON.stringify(gatedActionModal.payload, null, 2)}
              </div>
            </div>

            {/* Ticket ID Input */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300">Ticket / Justification Reference ID:</label>
              <input
                type="text"
                value={ticketReasonId}
                onChange={(e) => setTicketReasonId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-xs text-white rounded-xl px-3 py-2 outline-none focus:border-red-500 font-mono"
                placeholder="e.g. INC-SOC-9021"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setGatedActionModal(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmGatedDispatch}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl shadow-lg transition-all cursor-pointer"
              >
                Confirm &amp; Dispatch via Workflow
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JSON Inspection Drawer */}
      {activeDrawer && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-xl w-full p-6 space-y-4 shadow-2xl relative">
            <button
              onClick={() => setActiveDrawer(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Code2 className="w-5 h-5 text-blue-400" />
              <span>{activeDrawer.title}</span>
            </h3>

            <div className="text-xs font-mono text-blue-300">Endpoint: {activeDrawer.endpoint}</div>

            <pre className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-emerald-400 font-mono text-xs overflow-x-auto max-h-80 scrollbar-thin">
              {JSON.stringify(activeDrawer.data, null, 2)}
            </pre>

            <div className="flex justify-end">
              <button
                onClick={() => setActiveDrawer(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
