// @ts-nocheck
import React, { useState, useMemo } from 'react';
import {
  Clock,
  ShieldAlert,
  DollarSign,
  Activity,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  Download,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Zap,
  ExternalLink,
  Calendar,
  Award,
  Scale,
  Building2,
  X,
  ChevronRight,
  Info,
  Check,
  Flame,
  ArrowUpRight,
  HelpCircle,
  Send,
  Ticket,
  Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tenant } from '../types';

export interface M365SlaWorkload {
  id: string;
  workload: 'Exchange Online' | 'Microsoft Teams' | 'SharePoint Online' | 'Entra ID' | 'Microsoft Defender' | 'Intune';
  iconName: string;
  monthlyUptimePercent: number;
  downtimeMinutes: number;
  status: 'healthy' | 'at_risk' | 'breached';
  slaTarget: number; // e.g. 99.9
  estimatedCreditValue: number;
  totalRequests: number;
  failedRequests: number;
  lastOutageDate?: string;
}

export interface OutageIncident {
  id: string; // e.g., 'EX891230'
  workload: string;
  title: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  failedPollsCount: number;
  httpErrorCode: string;
  slaBreachStatus: 'breached_10' | 'breached_25' | 'breached_50' | 'below_threshold' | 'pending_closure';
  officialAdvisoryText: string;
  graphPollingLogs: Array<{
    timestamp: string;
    endpoint: string;
    statusCode: number;
    latencyMs: number;
    errorMessage: string;
  }>;
  affectedLicenseCount: number;
  estimatedCredit: number;
}

export interface SlaClaim {
  id: string; // e.g., 'CLM-2026-0811'
  tenantId: string;
  tenantName: string;
  incidentId: string;
  workload: string;
  affectedLicenses: number;
  creditTierPercent: number; // 10, 25, or 50
  claimValueUsd: number;
  submissionDate: string;
  status: 'Draft' | 'Submitted' | 'Approved & Credited' | 'Rejected';
  psaTicketRef: string;
  notes: string;
}

interface MicrosoftSlaConsoleProps {
  tenants?: Tenant[];
  selectedTenant?: Tenant | null;
  onSelectTenant?: (tenant: Tenant | null) => void;
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
}

// Initial Mock Workload SLA Matrix
const INITIAL_WORKLOADS: M365SlaWorkload[] = [
  {
    id: 'wk-01',
    workload: 'Exchange Online',
    iconName: 'Mail',
    monthlyUptimePercent: 99.94,
    downtimeMinutes: 26,
    status: 'healthy',
    slaTarget: 99.9,
    estimatedCreditValue: 0,
    totalRequests: 489200,
    failedRequests: 290,
    lastOutageDate: '2026-07-04',
  },
  {
    id: 'wk-02',
    workload: 'Microsoft Teams',
    iconName: 'MessageSquare',
    monthlyUptimePercent: 99.91,
    downtimeMinutes: 38,
    status: 'healthy',
    slaTarget: 99.9,
    estimatedCreditValue: 0,
    totalRequests: 612000,
    failedRequests: 550,
    lastOutageDate: '2026-07-11',
  },
  {
    id: 'wk-03',
    workload: 'SharePoint Online',
    iconName: 'FileText',
    monthlyUptimePercent: 98.75,
    downtimeMinutes: 540,
    status: 'breached',
    slaTarget: 99.9,
    estimatedCreditValue: 684.0,
    totalRequests: 320000,
    failedRequests: 4000,
    lastOutageDate: '2026-07-12',
  },
  {
    id: 'wk-04',
    workload: 'Entra ID',
    iconName: 'Shield',
    monthlyUptimePercent: 99.88,
    downtimeMinutes: 51,
    status: 'at_risk',
    slaTarget: 99.9,
    estimatedCreditValue: 245.0,
    totalRequests: 890000,
    failedRequests: 1068,
    lastOutageDate: '2026-07-18',
  },
  {
    id: 'wk-05',
    workload: 'Microsoft Defender',
    iconName: 'ShieldAlert',
    monthlyUptimePercent: 99.98,
    downtimeMinutes: 8,
    status: 'healthy',
    slaTarget: 99.9,
    estimatedCreditValue: 0,
    totalRequests: 410000,
    failedRequests: 82,
    lastOutageDate: '2026-06-28',
  },
  {
    id: 'wk-06',
    workload: 'Intune',
    iconName: 'Smartphone',
    monthlyUptimePercent: 99.92,
    downtimeMinutes: 34,
    status: 'healthy',
    slaTarget: 99.9,
    estimatedCreditValue: 0,
    totalRequests: 180000,
    failedRequests: 144,
    lastOutageDate: '2026-07-02',
  },
];

// Initial Outage Incidents
const INITIAL_INCIDENTS: OutageIncident[] = [
  {
    id: 'EX891230',
    workload: 'SharePoint Online',
    title: 'Users unable to open files or save modifications in SharePoint Online document libraries',
    startTime: '2026-07-12 14:10 UTC',
    endTime: '2026-07-12 23:10 UTC',
    durationMinutes: 540,
    failedPollsCount: 108,
    httpErrorCode: '503 Service Unavailable / 429 Rate Limit Exceeded',
    slaBreachStatus: 'breached_10',
    affectedLicenseCount: 120,
    estimatedCredit: 684.0,
    officialAdvisoryText:
      'Microsoft Incident EX891230: A localized infrastructure routing failure in North America West datacenters caused elevated HTTP 503 errors on SharePoint REST endpoints for commercial tenant users.',
    graphPollingLogs: [
      {
        timestamp: '2026-07-12 14:15:00 UTC',
        endpoint: 'GET /v1.0/sites/contoso.sharepoint.com/drives',
        statusCode: 503,
        latencyMs: 14200,
        errorMessage: 'Service Unavailable - Graph API connection timeout',
      },
      {
        timestamp: '2026-07-12 14:20:00 UTC',
        endpoint: 'GET /v1.0/me/drive/recent',
        statusCode: 503,
        latencyMs: 15100,
        errorMessage: 'Service Unavailable - Backend cluster overloaded',
      },
      {
        timestamp: '2026-07-12 14:25:00 UTC',
        endpoint: 'POST /v1.0/sites/root/lists',
        statusCode: 429,
        latencyMs: 820,
        errorMessage: 'Too Many Requests - Throttled by M365 infrastructure',
      },
      {
        timestamp: '2026-07-12 14:30:00 UTC',
        endpoint: 'GET /v1.0/sites/contoso.sharepoint.com',
        statusCode: 503,
        latencyMs: 12400,
        errorMessage: 'Service Unavailable - Gateways failing health check',
      },
      {
        timestamp: '2026-07-12 14:35:00 UTC',
        endpoint: 'GET /v1.0/drives',
        statusCode: 503,
        latencyMs: 11900,
        errorMessage: 'Service Unavailable - Connection reset by peer',
      },
    ],
  },
  {
    id: 'MO894102',
    workload: 'Entra ID',
    title: 'Intermittent delays during conditional access token issuance and MFA prompt challenges',
    startTime: '2026-07-18 08:30 UTC',
    endTime: '2026-07-18 09:21 UTC',
    durationMinutes: 51,
    failedPollsCount: 10,
    httpErrorCode: '500 Internal Server Error',
    slaBreachStatus: 'below_threshold',
    affectedLicenseCount: 140,
    estimatedCredit: 0,
    officialAdvisoryText:
      'Microsoft Advisory MO894102: A software update to authentication token broker nodes caused intermittent 500 errors during MFA challenge handshakes for approximately 51 minutes.',
    graphPollingLogs: [
      {
        timestamp: '2026-07-18 08:35:00 UTC',
        endpoint: 'POST /oauth2/v2.0/token',
        statusCode: 500,
        latencyMs: 9400,
        errorMessage: 'Internal Server Error - Token authority timeout',
      },
      {
        timestamp: '2026-07-18 08:40:00 UTC',
        endpoint: 'POST /oauth2/v2.0/token',
        statusCode: 500,
        latencyMs: 8900,
        errorMessage: 'Internal Server Error - Primary DB partition locked',
      },
    ],
  },
  {
    id: 'TM892019',
    workload: 'Microsoft Teams',
    title: 'Users experienced delays loading channel chat history and desktop notification syncing',
    startTime: '2026-07-11 11:00 UTC',
    endTime: '2026-07-11 11:38 UTC',
    durationMinutes: 38,
    failedPollsCount: 7,
    httpErrorCode: '504 Gateway Timeout',
    slaBreachStatus: 'below_threshold',
    affectedLicenseCount: 110,
    estimatedCredit: 0,
    officialAdvisoryText:
      'Microsoft Advisory TM892019: Network latency spike on Teams microservice web sockets caused delayed chat sync for 38 minutes.',
    graphPollingLogs: [
      {
        timestamp: '2026-07-11 11:10:00 UTC',
        endpoint: 'GET /v1.0/me/joinedTeams',
        statusCode: 504,
        latencyMs: 20000,
        errorMessage: 'Gateway Timeout - Backend socket closed unexpectedly',
      },
    ],
  },
];

// Initial Historical Claims
const INITIAL_CLAIMS: SlaClaim[] = [
  {
    id: 'CLM-2026-0811',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    incidentId: 'EX891230',
    workload: 'SharePoint Online',
    affectedLicenses: 120,
    creditTierPercent: 10,
    claimValueUsd: 684.0,
    submissionDate: '2026-07-15',
    status: 'Submitted',
    psaTicketRef: 'PSA-88210',
    notes: 'Submitted via Microsoft Partner Center CSP Portal. Attached Graph API outage proof logs.',
  },
  {
    id: 'CLM-2026-0504',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    incidentId: 'EX810922',
    workload: 'Exchange Online',
    affectedLicenses: 120,
    creditTierPercent: 25,
    claimValueUsd: 1710.0,
    submissionDate: '2026-05-10',
    status: 'Approved & Credited',
    psaTicketRef: 'PSA-77401',
    notes: 'Credited on Microsoft NCE Invoice #INV-2026-06. $1,710.00 passed to client account statement.',
  },
];

export const MicrosoftSlaConsole: React.FC<MicrosoftSlaConsoleProps> = ({
  tenants = [],
  selectedTenant,
  onSelectTenant,
  onShowToast,
}) => {
  // State
  const [workloads, setWorkloads] = useState<M365SlaWorkload[]>(INITIAL_WORKLOADS);
  const [incidents, setIncidents] = useState<OutageIncident[]>(INITIAL_INCIDENTS);
  const [claims, setClaims] = useState<SlaClaim[]>(INITIAL_CLAIMS);

  const [activeTab, setActiveTab] = useState<'matrix' | 'incidents' | 'claims'>('matrix');
  const [selectedIncidentForDrawer, setSelectedIncidentForDrawer] = useState<OutageIncident | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);

  // Claim Form State
  const [claimIncidentId, setClaimIncidentId] = useState<string>('EX891230');
  const [claimAffectedLicenses, setClaimAffectedLicenses] = useState<number>(120);
  const [claimLicenseCost, setClaimLicenseCost] = useState<number>(57); // M365 E5 $57/mo
  const [claimCreditTier, setClaimCreditTier] = useState<number>(10);
  const [claimPsaTicket, setClaimPsaTicket] = useState<string>('PSA-99412');
  const [claimContactEmail, setClaimContactEmail] = useState<string>('admin@msp.com');
  const [claimNotes, setClaimNotes] = useState<string>('SharePoint Online outage EX891230 exceeded 99.9% monthly threshold.');

  // Active Tenant
  const activeTenant = useMemo(() => {
    return (
      selectedTenant ||
      tenants[0] || { id: 'contoso-01', name: 'Contoso Corporation', primaryDomain: 'contoso.onmicrosoft.com' }
    );
  }, [selectedTenant, tenants]);

  // Overall Tenant Monthly Uptime Rate
  const overallUptime = useMemo(() => {
    const totalUptime = workloads.reduce((sum, w) => sum + w.monthlyUptimePercent, 0);
    return Number((totalUptime / workloads.length).toFixed(2));
  }, [workloads]);

  const totalDowntimeMinutes = useMemo(() => {
    return workloads.reduce((sum, w) => sum + w.downtimeMinutes, 0);
  }, [workloads]);

  const totalEligibleCredit = useMemo(() => {
    return incidents
      .filter((i) => i.slaBreachStatus.startsWith('breached'))
      .reduce((sum, i) => sum + i.estimatedCredit, 0);
  }, [incidents]);

  // Handle Run SLA Audit
  const handleRunSlaAudit = () => {
    setIsAuditing(true);
    onShowToast?.('info', 'Running SLA Audit', 'Scanning Microsoft Graph API polling logs and service announcements...');
    setTimeout(() => {
      setIsAuditing(false);
      onShowToast?.('success', 'SLA Audit Complete', 'Calculated 98.75% SharePoint Online uptime. 1 Incident qualifies for 10% credit.');
    }, 1200);
  };

  // Submit Claim
  const handleCreateClaim = (e: React.FormEvent) => {
    e.preventDefault();
    const calculatedValue = (claimAffectedLicenses * claimLicenseCost * (claimCreditTier / 100));

    const newClaim: SlaClaim = {
      id: `CLM-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      tenantId: activeTenant.id,
      tenantName: activeTenant.name,
      incidentId: claimIncidentId,
      workload: incidents.find((i) => i.id === claimIncidentId)?.workload || 'SharePoint Online',
      affectedLicenses: claimAffectedLicenses,
      creditTierPercent: claimCreditTier,
      claimValueUsd: calculatedValue,
      submissionDate: new Date().toISOString().split('T')[0],
      status: 'Submitted',
      psaTicketRef: claimPsaTicket,
      notes: claimNotes,
    };

    setClaims([newClaim, ...claims]);
    onShowToast?.(
      'success',
      'CSP Claim Created & Queued',
      `Generated claim package ${newClaim.id} for $${calculatedValue.toLocaleString()} USD.`
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-[#e0e2ea] font-sans overflow-hidden select-none">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & GLOBAL SLA STATUS BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] p-4 lg:p-5 shrink-0 space-y-4 shadow-md">
        
        {/* Top bar: Tenant context & Header controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[#0078d4]/20 border border-[#0078d4] flex items-center justify-center text-[#a3c9ff] shrink-0">
              <Scale className="w-5 h-5 text-[#a3c9ff]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold text-[#e0e2ea] tracking-tight">
                  Microsoft 365 SLA & Financial Credit Console
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40 font-bold">
                  /portal/sla
                </span>
              </div>

              <div className="text-xs text-[#8a919e] flex items-center gap-2 mt-0.5">
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
                <span className="text-purple-300 text-[11px] font-mono px-1.5 py-0.2 rounded bg-purple-950/60 border border-purple-800 font-bold">
                  CSP Direct / NCE
                </span>
                <span className="text-[#4ade80] text-[11px] font-mono flex items-center gap-1 ml-1">
                  <CheckCircle2 className="w-3 h-3" /> 99.9% Target Policy
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleRunSlaAudit}
              disabled={isAuditing}
              className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isAuditing ? 'animate-spin' : ''}`} />
              <span>{isAuditing ? 'Auditing Telemetry...' : 'Instant SLA Audit'}</span>
            </button>

            <button
              onClick={() => {
                onShowToast?.('success', 'Claim Package Exported', 'Generated Microsoft CSP Claim Evidence ZIP (PDF + JSON Telemetry Logs).');
              }}
              className="px-3 py-1.5 bg-purple-950/80 hover:bg-purple-900 text-purple-200 border border-purple-700 rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSP Claim Package</span>
            </button>
          </div>

        </div>

        {/* SLA Performance Rollup KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          {/* KPI 1: Monthly Uptime Rate */}
          <div className="bg-[#101419] border border-[#404752] p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-[#8a919e] flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-[#a3c9ff]" />
                MONTHLY UPTIME RATE
              </div>
              <div className="text-xl font-bold font-mono text-red-400">
                {overallUptime}% <span className="text-xs font-normal text-[#8a919e]">(99.90% Target)</span>
              </div>
              <div className="text-[10px] text-red-400 font-mono">⚠️ 0.08% Below Guarantee Baseline</div>
            </div>
            <div className="p-2 rounded bg-red-950/40 border border-red-800 text-red-400">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>

          {/* KPI 2: Unplanned Downtime */}
          <div className="bg-[#101419] border border-amber-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-amber-300 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                UNPLANNED DOWNTIME
              </div>
              <div className="text-xl font-bold font-mono text-amber-200">
                {Math.floor(totalDowntimeMinutes / 60)}h {totalDowntimeMinutes % 60}m
              </div>
              <div className="text-[10px] text-[#8a919e]">Accumulated outage this billing cycle</div>
            </div>
            <div className="p-2 rounded bg-amber-950/40 border border-amber-800 text-amber-400">
              <Activity className="w-5 h-5" />
            </div>
          </div>

          {/* KPI 3: Eligible SLA Credits ($) */}
          <div className="bg-[#101419] border border-emerald-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-emerald-400 flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                ELIGIBLE SLA CREDITS
              </div>
              <div className="text-xl font-bold font-mono text-emerald-300">
                ${totalEligibleCredit.toLocaleString()} USD
              </div>
              <div className="text-[10px] text-[#8a919e]">1 Breach Qualifies for 10% Refund</div>
            </div>
            <div className="p-2 rounded bg-emerald-950/40 border border-emerald-800 text-emerald-400">
              <Award className="w-5 h-5" />
            </div>
          </div>

          {/* KPI 4: Claim Window Deadline */}
          <div className="bg-[#101419] border border-purple-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-purple-300 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-purple-400" />
                CLAIM SUBMISSION WINDOW
              </div>
              <div className="text-xl font-bold font-mono text-purple-200">
                14 Days <span className="text-xs font-normal text-purple-400">Remaining</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Partner Center Deadline: Aug 31, 2026</div>
            </div>
            <div className="p-2 rounded bg-purple-950/40 border border-purple-800 text-purple-400">
              <Clock className="w-5 h-5" />
            </div>
          </div>

        </div>

      </div>

      {/* ========================================================================= */}
      {/* 2. SUB-NAVIGATION TABS */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] p-3 shrink-0 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 bg-[#181c22] border border-[#404752] rounded p-1 text-xs overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveTab('matrix')}
            className={cn(
              'px-3.5 py-1.5 rounded font-bold transition-all cursor-pointer flex items-center gap-1.5',
              activeTab === 'matrix' ? 'bg-[#0078d4] text-white' : 'text-[#8a919e] hover:text-[#e0e2ea]'
            )}
          >
            <Activity className="w-3.5 h-3.5 text-[#a3c9ff]" />
            <span>Workload Uptime & SLA Matrix</span>
          </button>

          <button
            onClick={() => setActiveTab('incidents')}
            className={cn(
              'px-3.5 py-1.5 rounded font-bold transition-all cursor-pointer flex items-center gap-1.5',
              activeTab === 'incidents' ? 'bg-red-700 text-white' : 'text-[#8a919e] hover:text-red-300'
            )}
          >
            <ShieldAlert className="w-3.5 h-3.5 text-red-300" />
            <span>Outage Incident & SLA Breach Audit ({incidents.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('claims')}
            className={cn(
              'px-3.5 py-1.5 rounded font-bold transition-all cursor-pointer flex items-center gap-1.5',
              activeTab === 'claims' ? 'bg-purple-700 text-white' : 'text-[#8a919e] hover:text-purple-300'
            )}
          >
            <DollarSign className="w-3.5 h-3.5 text-purple-300" />
            <span>Credit Claim Generator & History ({claims.length})</span>
          </button>
        </div>

        <div className="text-xs text-[#8a919e] font-mono flex items-center gap-2">
          <span>Microsoft Standard SLA: <strong className="text-emerald-400">99.90%</strong></span>
          <span>•</span>
          <span>Claim Eligibility: <strong className="text-amber-300">&lt; 99.9% (10%) / &lt; 99.0% (25%) / &lt; 95.0% (50%)</strong></span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. TAB CONTENT VIEWS */}
      {/* ========================================================================= */}
      <div className="flex-1 overflow-y-auto p-4 lg:p-6 bg-[#0b0e14] relative">
        
        {/* TAB 1: WORKLOAD UPTIME & SLA MATRIX */}
        {activeTab === 'matrix' && (
          <div className="space-y-4">
            
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-[#e0e2ea] uppercase tracking-wider font-mono">
                  Monthly Service Uptime Gauges ({activeTenant.name})
                </h2>
                <p className="text-xs text-[#8a919e]">
                  Continuous 5-minute Graph API polling measurements against Microsoft's 99.9% commercial SLA requirement.
                </p>
              </div>
            </div>

            {/* Service Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {workloads.map((item) => {
                const isBreached = item.status === 'breached';
                const isAtRisk = item.status === 'at_risk';

                return (
                  <div
                    key={item.id}
                    className={cn(
                      'bg-[#181c22] border rounded-lg p-4 space-y-3.5 transition-all shadow-md',
                      isBreached
                        ? 'border-red-600/80 bg-red-950/10'
                        : isAtRisk
                        ? 'border-amber-500/60'
                        : 'border-[#404752]'
                    )}
                  >
                    {/* Card Top Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          'p-2 rounded border',
                          isBreached
                            ? 'bg-red-950 text-red-400 border-red-800'
                            : 'bg-[#101419] text-[#a3c9ff] border-[#404752]'
                        )}>
                          <Activity className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="font-bold text-sm text-[#e0e2ea]">{item.workload}</h3>
                          <div className="text-[10px] font-mono text-[#8a919e]">Target SLA: {item.slaTarget}%</div>
                        </div>
                      </div>

                      {isBreached ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-red-600 text-white animate-pulse">
                          SLA BREACHED
                        </span>
                      ) : isAtRisk ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500">
                          AT RISK
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                          MEETING SLA
                        </span>
                      )}
                    </div>

                    {/* Gauge & Percentage */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-[#8a919e]">Monthly Uptime:</span>
                        <span className={cn('font-bold text-sm', isBreached ? 'text-red-400' : 'text-emerald-400')}>
                          {item.monthlyUptimePercent}%
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full bg-[#101419] h-2.5 rounded-full overflow-hidden border border-[#404752]">
                        <div
                          className={cn(
                            'h-full transition-all duration-500',
                            isBreached ? 'bg-red-500' : isAtRisk ? 'bg-amber-400' : 'bg-emerald-400'
                          )}
                          style={{ width: `${Math.min(100, item.monthlyUptimePercent)}%` }}
                        />
                      </div>
                    </div>

                    {/* Stats Breakdown */}
                    <div className="grid grid-cols-2 gap-2 bg-[#101419] p-2.5 rounded border border-[#404752] text-xs font-mono">
                      <div>
                        <div className="text-[10px] text-[#8a919e]">Downtime</div>
                        <div className="font-bold text-[#e0e2ea]">{item.downtimeMinutes} mins</div>
                      </div>

                      <div>
                        <div className="text-[10px] text-[#8a919e]">Est. Credit Value</div>
                        <div className="font-bold text-emerald-400">
                          ${item.estimatedCreditValue.toLocaleString()}
                        </div>
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="pt-2 border-t border-[#404752]/60 flex items-center justify-between text-xs">
                      <span className="text-[10.5px] text-[#8a919e]">
                        Last Outage: {item.lastOutageDate || 'None'}
                      </span>

                      {isBreached && (
                        <button
                          onClick={() => {
                            setActiveTab('claims');
                            setClaimIncidentId('EX891230');
                          }}
                          className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <DollarSign className="w-3 h-3" />
                          <span>Generate Claim</span>
                        </button>
                      )}
                    </div>

                  </div>
                );
              })}
            </div>

          </div>
        )}

        {/* TAB 2: OUTAGE INCIDENT & SLA BREACH AUDIT */}
        {activeTab === 'incidents' && (
          <div className="space-y-4">
            
            <div>
              <h2 className="text-sm font-bold text-[#e0e2ea] uppercase tracking-wider font-mono">
                Microsoft Outage Event Audit Logs (`/serviceAnnouncement/issues`)
              </h2>
              <p className="text-xs text-[#8a919e]">
                Every service disruption recorded by Microsoft and validated against MSP 5-minute Graph API response telemetry.
              </p>
            </div>

            {/* Incident Table */}
            <div className="bg-[#181c22] border border-[#404752] rounded-lg overflow-x-auto shadow-md">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#101419] border-b border-[#404752] text-[#8a919e] font-mono text-[11px] uppercase">
                    <th className="p-3">Incident ID</th>
                    <th className="p-3">Workload</th>
                    <th className="p-3">Impact Title</th>
                    <th className="p-3">Duration</th>
                    <th className="p-3">Graph API Poll Errors</th>
                    <th className="p-3">SLA Breach Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#404752]">
                  {incidents.map((inc) => (
                    <tr
                      key={inc.id}
                      onClick={() => setSelectedIncidentForDrawer(inc)}
                      className="hover:bg-[#272a30]/50 transition-colors cursor-pointer"
                    >
                      <td className="p-3 font-mono font-bold text-[#a3c9ff]">
                        {inc.id}
                      </td>

                      <td className="p-3 font-mono">
                        <span className="px-2 py-0.5 rounded bg-[#101419] border border-[#404752] text-[#e0e2ea]">
                          {inc.workload}
                        </span>
                      </td>

                      <td className="p-3 font-semibold text-[#e0e2ea] max-w-xs truncate">
                        {inc.title}
                      </td>

                      <td className="p-3 font-mono text-[#8a919e]">
                        {inc.durationMinutes} mins
                        <div className="text-[10px] text-[#8a919e]">{inc.startTime}</div>
                      </td>

                      <td className="p-3 font-mono text-amber-300">
                        {inc.failedPollsCount} Failed Polls
                        <div className="text-[10px] text-[#8a919e]">{inc.httpErrorCode}</div>
                      </td>

                      <td className="p-3">
                        {inc.slaBreachStatus === 'breached_10' ? (
                          <span className="px-2.5 py-1 rounded text-[10.5px] font-mono font-bold bg-red-600 text-white animate-pulse flex items-center gap-1 w-fit">
                            <Flame className="w-3 h-3" /> Eligible for 10% Credit
                          </span>
                        ) : inc.slaBreachStatus === 'breached_25' ? (
                          <span className="px-2.5 py-1 rounded text-[10.5px] font-mono font-bold bg-red-700 text-white animate-pulse flex items-center gap-1 w-fit">
                            <Flame className="w-3 h-3" /> Eligible for 25% Credit
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded text-[10.5px] font-mono font-semibold bg-[#101419] text-[#8a919e] border border-[#404752]">
                            Below Credit Threshold
                          </span>
                        )}
                      </td>

                      <td className="p-3 text-right space-x-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedIncidentForDrawer(inc);
                          }}
                          className="px-2.5 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] rounded text-[11px] font-semibold cursor-pointer border border-[#404752]"
                        >
                          Inspect Telemetry
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        )}

        {/* TAB 3: CREDIT CLAIM GENERATOR & HISTORY */}
        {activeTab === 'claims' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left: Claim Wizard Form */}
            <div className="lg:col-span-5 bg-[#181c22] border border-[#0078d4] rounded-lg p-5 space-y-4 shadow-lg">
              <div className="flex items-center gap-2 border-b border-[#404752] pb-3">
                <div className="p-2 bg-[#0078d4]/20 text-[#a3c9ff] rounded border border-[#0078d4]">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#e0e2ea]">CSP Partner SLA Claim Builder</h3>
                  <div className="text-xs text-[#8a919e]">Pre-calculated financial credit claim generator</div>
                </div>
              </div>

              <form onSubmit={handleCreateClaim} className="space-y-3 text-xs">
                <div>
                  <label className="text-[11px] text-[#8a919e] font-mono block mb-1">Select Outage Incident</label>
                  <select
                    value={claimIncidentId}
                    onChange={(e) => setClaimIncidentId(e.target.value)}
                    className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-1.5 text-[#e0e2ea] font-mono font-semibold outline-none focus:border-[#0078d4]"
                  >
                    {incidents.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.id} - {i.workload} ({i.durationMinutes}m downtime)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-[#8a919e] font-mono block mb-1">Affected Licenses</label>
                    <input
                      type="number"
                      value={claimAffectedLicenses}
                      onChange={(e) => setClaimAffectedLicenses(Number(e.target.value))}
                      className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-1.5 text-[#e0e2ea] font-mono outline-none focus:border-[#0078d4]"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-[#8a919e] font-mono block mb-1">License Rate ($/mo)</label>
                    <input
                      type="number"
                      value={claimLicenseCost}
                      onChange={(e) => setClaimLicenseCost(Number(e.target.value))}
                      className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-1.5 text-[#e0e2ea] font-mono outline-none focus:border-[#0078d4]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-[#8a919e] font-mono block mb-1">SLA Credit Tier %</label>
                  <select
                    value={claimCreditTier}
                    onChange={(e) => setClaimCreditTier(Number(e.target.value))}
                    className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-1.5 text-[#e0e2ea] font-mono outline-none focus:border-[#0078d4]"
                  >
                    <option value={10}>10% Credit Tier (&lt; 99.9% Uptime)</option>
                    <option value={25}>25% Credit Tier (&lt; 99.0% Uptime)</option>
                    <option value={50}>50% Credit Tier (&lt; 95.0% Uptime)</option>
                  </select>
                </div>

                {/* Pre-Calculated Total */}
                <div className="bg-[#101419] border border-emerald-500/50 p-3 rounded text-center space-y-0.5 font-mono">
                  <div className="text-[11px] text-[#8a919e]">Calculated Recoverable Refund</div>
                  <div className="text-xl font-bold text-emerald-400">
                    ${(claimAffectedLicenses * claimLicenseCost * (claimCreditTier / 100)).toLocaleString()} USD
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-[#8a919e] font-mono block mb-1">PSA Ticket Ref</label>
                    <input
                      type="text"
                      value={claimPsaTicket}
                      onChange={(e) => setClaimPsaTicket(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-1.5 text-[#e0e2ea] font-mono outline-none focus:border-[#0078d4]"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-[#8a919e] font-mono block mb-1">Partner Admin Email</label>
                    <input
                      type="email"
                      value={claimContactEmail}
                      onChange={(e) => setClaimContactEmail(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-1.5 text-[#e0e2ea] font-mono outline-none focus:border-[#0078d4]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all shadow-md mt-2"
                >
                  <Send className="w-4 h-4" />
                  <span>Generate Microsoft CSP Claim Package</span>
                </button>
              </form>
            </div>

            {/* Right: Historical Claims Table */}
            <div className="lg:col-span-7 space-y-3">
              <h3 className="font-bold text-sm text-[#e0e2ea] uppercase tracking-wider font-mono">
                Historical CSP Partner SLA Claims
              </h3>

              <div className="bg-[#181c22] border border-[#404752] rounded-lg overflow-x-auto shadow-md">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#101419] border-b border-[#404752] text-[#8a919e] font-mono text-[11px] uppercase">
                      <th className="p-3">Claim ID</th>
                      <th className="p-3">Incident</th>
                      <th className="p-3">Workload</th>
                      <th className="p-3">Value ($)</th>
                      <th className="p-3">Date</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]">
                    {claims.map((clm) => (
                      <tr key={clm.id} className="hover:bg-[#272a30]/50 transition-colors font-mono">
                        <td className="p-3 font-bold text-[#a3c9ff]">{clm.id}</td>
                        <td className="p-3 text-[#e0e2ea]">{clm.incidentId}</td>
                        <td className="p-3 text-[#8a919e]">{clm.workload}</td>
                        <td className="p-3 font-bold text-emerald-400">
                          ${clm.claimValueUsd.toLocaleString()}
                        </td>
                        <td className="p-3 text-[#8a919e]">{clm.submissionDate}</td>
                        <td className="p-3">
                          {clm.status === 'Approved & Credited' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                              Approved & Credited
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40">
                              Submitted to MS
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* 4. OUTAGE TELEMETRY SIDE-DRAWER */}
      {/* ========================================================================= */}
      {selectedIncidentForDrawer && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex justify-end">
          <div className="w-full lg:w-[540px] bg-[#181c22] border-l border-[#404752] flex flex-col h-full shadow-2xl overflow-y-auto animate-in slide-in-from-right">
            
            {/* Drawer Header */}
            <div className="p-4 bg-[#101419] border-b border-[#404752] flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 font-mono text-[10.5px] text-[#a3c9ff]">
                  <span>GRAPH API OUTAGE EVIDENCE DRAWER</span>
                  <span>•</span>
                  <span className="font-bold text-red-400">{selectedIncidentForDrawer.id}</span>
                </div>
                <h3 className="font-bold text-sm text-[#e0e2ea] mt-0.5">
                  {selectedIncidentForDrawer.workload} Disruption
                </h3>
              </div>

              <button
                onClick={() => setSelectedIncidentForDrawer(null)}
                className="p-1.5 rounded text-[#8a919e] hover:text-white hover:bg-[#272a30] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="p-5 space-y-5 text-xs">
              
              {/* Microsoft Official Advisory vs MSP Telemetry */}
              <div className="space-y-2">
                <h4 className="font-bold text-[#e0e2ea] uppercase font-mono text-[11px] flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-[#a3c9ff]" /> Microsoft Official Incident Advisory Text
                </h4>
                <div className="p-3 bg-[#101419] border border-[#404752] rounded text-[#8a919e] leading-relaxed">
                  {selectedIncidentForDrawer.officialAdvisoryText}
                </div>
              </div>

              {/* Polling Error Telemetry Log Stream */}
              <div className="space-y-2">
                <h4 className="font-bold text-amber-300 uppercase font-mono text-[11px] flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-amber-400" /> MSP 5-Minute Graph API Response Telemetry
                </h4>

                <div className="bg-[#101419] border border-amber-800/60 rounded p-3 space-y-2 font-mono text-[11px]">
                  <p className="text-[10.5px] text-[#8a919e]">
                    Captured HTTP 500/503/429 status codes submitted as formal proof to Microsoft CSP Partner Center:
                  </p>

                  <div className="space-y-2">
                    {selectedIncidentForDrawer.graphPollingLogs.map((log, idx) => (
                      <div key={idx} className="bg-[#181c22] border border-[#404752] p-2.5 rounded space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-[#a3c9ff] font-bold">{log.timestamp}</span>
                          <span className="px-1.5 py-0.2 rounded bg-red-950 text-red-300 border border-red-800 font-bold">
                            HTTP {log.statusCode}
                          </span>
                        </div>
                        <div className="text-amber-200 truncate">{log.endpoint}</div>
                        <div className="text-[10px] text-[#8a919e]">{log.errorMessage} ({log.latencyMs}ms)</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-[#404752] flex items-center gap-2">
                <button
                  onClick={() => {
                    setActiveTab('claims');
                    setClaimIncidentId(selectedIncidentForDrawer.id);
                    setSelectedIncidentForDrawer(null);
                  }}
                  className="w-full py-2.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md"
                >
                  <DollarSign className="w-4 h-4" />
                  <span>Build CSP Claim Package for {selectedIncidentForDrawer.id}</span>
                </button>
              </div>

            </div>

          </div>
        </div>
      )}

    </div>
  );
};

