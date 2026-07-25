import React, { useState, useMemo } from 'react';
import {
  Calendar,
  AlertOctagon,
  Sparkles,
  Clock,
  Filter,
  Search,
  Bell,
  ShieldAlert,
  ExternalLink,
  Tag,
  Layers,
  Send,
  CheckCircle2,
  Bookmark,
  ChevronRight,
  Info,
  XCircle,
  Ticket,
  RefreshCw,
  Building2,
  X,
  FileText,
  Zap,
  Check,
  AlertTriangle,
  Flame,
  CheckCircle,
  HelpCircle,
  ArrowUpRight,
  Download,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tenant } from '../../types';

export interface MessageCenterAnnouncement {
  id: string; // e.g. 'MC893201'
  title: string;
  category: 'planForChange' | 'preventOrFixIssue' | 'stayInformed';
  severity: 'critical' | 'major' | 'normal';
  workload: 'Exchange' | 'Teams' | 'Entra' | 'SharePoint' | 'Intune' | 'Defender' | 'Copilot' | 'Power Platform';
  isDeprecation: boolean;
  actionRequiredBy: string; // e.g. '2026-08-31'
  horizonBucket: 'this_week' | 'next_week' | 'month' | '60_days' | '90_days';
  affectedUserCount: number;
  summary: string;
  details: string;
  impactSummary: string;
  affectedEntities: string[];
  status: 'unread' | 'acknowledged' | 'ticketed';
  publishDate: string;
  msLearnUrl?: string;
}

interface M365MessageCenterConsoleProps {
  tenants?: Tenant[];
  selectedTenant?: Tenant | null;
  onSelectTenant?: (tenant: Tenant | null) => void;
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
}

// Mock Announcements Database (10+ Realistic M365 Lifecycle Items)
const INITIAL_ANNOUNCEMENTS: MessageCenterAnnouncement[] = [
  {
    id: 'MC893201',
    title: 'Retirement of Legacy Authentication Methods in Exchange Online',
    category: 'preventOrFixIssue',
    severity: 'critical',
    workload: 'Exchange',
    isDeprecation: true,
    actionRequiredBy: '2026-08-15',
    horizonBucket: 'this_week',
    affectedUserCount: 14,
    summary: 'Microsoft is permanently turning off Basic Authentication protocol connectors (POP, IMAP, Basic SMTP) across all Exchange Online tenants.',
    details: 'Starting August 15, 2026, Exchange Online will block legacy authentication protocol connection requests. Tenants with active POP3/IMAP4 user mailboxes or legacy SMTP relay service accounts must transition to OAuth 2.0 or Modern Authentication immediately to avoid mail flow interruption.',
    impactSummary: '14 active accounts in this tenant used Basic Auth in the past 30 days (11 service accounts, 3 legacy mail clients).',
    affectedEntities: [
      'svc-scanner@contoso.com (Basic SMTP)',
      'legacy-printer@contoso.com (Basic POP3)',
      'exec-assistant@contoso.com (Legacy Outlook 2013 IMAP)',
      'erp-mailer@contoso.com (Basic SMTP Relay)',
    ],
    status: 'unread',
    publishDate: '2026-07-20',
    msLearnUrl: 'https://learn.microsoft.com/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online',
  },
  {
    id: 'MC891044',
    title: 'Mandatory Admin MFA Enforcement for Microsoft Entra Portal Access',
    category: 'preventOrFixIssue',
    severity: 'critical',
    workload: 'Entra',
    isDeprecation: true,
    actionRequiredBy: '2026-08-22',
    horizonBucket: 'next_week',
    affectedUserCount: 3,
    summary: 'MFA enforcement phase 2 requires Multi-Factor Authentication for all administrative access to Azure Portal and Entra Admin Center.',
    details: 'All accounts assigned directory roles (Global Admin, Security Admin, Exchange Admin) must have registered MFA methods and satisfy Conditional Access MFA policies when signing into admin interfaces. Un-enforced admin logins will be rejected.',
    impactSummary: '3 Global Admin accounts in this tenant currently lack mandatory CA MFA step-up policies.',
    affectedEntities: [
      'alex.b@contoso.com (Global Admin - Missing FIDO2/MFA registration)',
      'm.vance@contoso.com (Exchange Admin - CA Policy Bypass Exemption)',
      'temp-admin@contoso.com (Global Admin - Password Only)',
    ],
    status: 'unread',
    publishDate: '2026-07-18',
    msLearnUrl: 'https://learn.microsoft.com/entra/identity/authentication/concept-mfa-howitworks',
  },
  {
    id: 'MC895112',
    title: 'Microsoft Copilot for Sales & Service - Admin Policy Controls Release',
    category: 'stayInformed',
    severity: 'normal',
    workload: 'Copilot',
    isDeprecation: false,
    actionRequiredBy: '2026-09-01',
    horizonBucket: 'month',
    affectedUserCount: 45,
    summary: 'New centralized admin toggles in Microsoft 365 Admin Center for managing Copilot grounded telemetry sharing.',
    details: 'Administrators can now enforce tenant-wide DLP policies and prevent Copilot agents from indexing specific SharePoint site collections marked as Confidential or Highly Restricted.',
    impactSummary: '45 Copilot for M365 license holders active in this tenant.',
    affectedEntities: [
      'SharePoint Site: /sites/Finance-Restricted',
      'SharePoint Site: /sites/Executive-HR-Salaries',
    ],
    status: 'acknowledged',
    publishDate: '2026-07-22',
    msLearnUrl: 'https://learn.microsoft.com/copilot/microsoft-365/copilot-admin-controls',
  },
  {
    id: 'MC892305',
    title: 'Classic Microsoft Teams Desktop Client End-of-Life & Auto-Upgrade',
    category: 'planForChange',
    severity: 'major',
    workload: 'Teams',
    isDeprecation: true,
    actionRequiredBy: '2026-09-15',
    horizonBucket: '60_days',
    affectedUserCount: 28,
    summary: 'Classic Teams desktop client (v1.x) will block logins and force automatic update to New Teams (v2.x).',
    details: 'Users on outdated Windows 10/11 builds running Classic Teams will receive blocking dialogs directing them to install New Teams. Admins must verify Intune software deployment rules to ensure all endpoint devices have the Webview2 runtime installed.',
    impactSummary: '28 unmanaged Windows 10 endpoints in this tenant are running Classic Teams v1.5.',
    affectedEntities: [
      'Device: FIN-LAP-8810 (Classic Teams v1.5.00)',
      'Device: HR-DESK-0012 (Classic Teams v1.4.98)',
      'Device: OPS-LAP-9941 (WebView2 Runtime Missing)',
    ],
    status: 'unread',
    publishDate: '2026-07-15',
    msLearnUrl: 'https://learn.microsoft.com/microsoftteams/new-teams-deploy-with-intune',
  },
  {
    id: 'MC889912',
    title: 'Deprecation of MSOnline (MSOL) and AzureAD PowerShell Modules',
    category: 'preventOrFixIssue',
    severity: 'critical',
    workload: 'Entra',
    isDeprecation: true,
    actionRequiredBy: '2026-10-31',
    horizonBucket: '90_days',
    affectedUserCount: 5,
    summary: 'Final hard shutdown of AzureAD and MSOnline PowerShell endpoints. All automation scripts must migrate to Microsoft Graph SDK.',
    details: 'Calls using Get-MsolUser, Connect-AzureAD, or Set-MsolUserLicense will fail with HTTP 410 Gone errors. MSP technicians must refactor scheduled automation runbooks to use Microsoft.Graph module commands.',
    impactSummary: '5 automation scripts and Azure Automation Runbooks in this tenant call AzureAD PowerShell modules.',
    affectedEntities: [
      'Azure Runbook: Sync-GuestUsers-Weekly.ps1',
      'Scheduled Script: Auto-License-Assign-Contoso.ps1',
      'Local Script: Offboard-User-Cleanup.ps1',
    ],
    status: 'unread',
    publishDate: '2026-07-10',
    msLearnUrl: 'https://learn.microsoft.com/powershell/azure/active-directory/migration-faq',
  },
  {
    id: 'MC896010',
    title: 'SharePoint Online Unmanaged Device Access Restrictions Update',
    category: 'planForChange',
    severity: 'major',
    workload: 'SharePoint',
    isDeprecation: false,
    actionRequiredBy: '2026-09-20',
    horizonBucket: '60_days',
    affectedUserCount: 110,
    summary: 'Enhanced web-only access policies for unmanaged or non-compliant devices attempting to open SharePoint files.',
    details: 'Tenant administrators can now block downloading, printing, or copy-pasting of confidential files when accessed from personal unmanaged browsers while retaining read-only online viewer permissions.',
    impactSummary: 'No critical impact. Tenant Conditional Access policy CA-04 already restricts unmanaged file downloads.',
    affectedEntities: [
      'Conditional Access Policy: CA-04-BlockUnmanagedDownloads (Active)',
    ],
    status: 'acknowledged',
    publishDate: '2026-07-21',
  },
  {
    id: 'MC894500',
    title: 'Microsoft Defender for Office 365 - Enhanced Automated Attack Simulation',
    category: 'stayInformed',
    severity: 'normal',
    workload: 'Defender',
    isDeprecation: false,
    actionRequiredBy: '2026-09-30',
    horizonBucket: '90_days',
    affectedUserCount: 140,
    summary: 'New QR Code Phishing (Quishing) payloads added to Attack Simulation Training catalog.',
    details: 'Security administrators can target high-risk executive users with automated quishing simulations to test security awareness regarding malicious QR code attachments in Outlook.',
    impactSummary: 'Tenant has Defender for Office 365 Plan 2 enabled.',
    affectedEntities: [
      'Security Group: Exec-Leadership-Team',
      'Security Group: Finance-Department',
    ],
    status: 'unread',
    publishDate: '2026-07-19',
  },
  {
    id: 'MC891230',
    title: 'Intune iOS/iPadOS 17 Minimum System Requirement Elevation',
    category: 'preventOrFixIssue',
    severity: 'major',
    workload: 'Intune',
    isDeprecation: true,
    actionRequiredBy: '2026-08-28',
    horizonBucket: 'month',
    affectedUserCount: 6,
    summary: 'Microsoft Intune company portal will discontinue support for devices running iOS 16 or earlier.',
    details: 'Devices running iOS 16 or earlier will no longer receive App Protection Policies (MAM) or MDM compliance syncs. End users must update their Apple hardware to iOS 17 or higher.',
    impactSummary: '6 enrolled mobile devices in this tenant are currently running iOS 16.4.',
    affectedEntities: [
      'iPhone 11 (User: r.chen@contoso.com, OS: iOS 16.4.1)',
      'iPad Air 3 (User: s.miller@contoso.com, OS: iOS 16.2)',
      'iPhone SE 2 (User: j.taylor@contoso.com, OS: iOS 16.3)',
    ],
    status: 'ticketed',
    publishDate: '2026-07-14',
  },
  {
    id: 'MC890111',
    title: 'Power Platform DLP Policy Default Connector Classification Changes',
    category: 'planForChange',
    severity: 'normal',
    workload: 'Power Platform',
    isDeprecation: false,
    actionRequiredBy: '2026-10-15',
    horizonBucket: '90_days',
    affectedUserCount: 12,
    summary: 'HTTP REST connectors in Power Automate moving to Non-Business data group by default.',
    details: 'Flows utilizing HTTP REST action endpoints without explicit environment DLP policy assignment will fail unless re-classified into the Business group by an environment admin.',
    impactSummary: '3 active Power Automate flows in default environment use HTTP connectors.',
    affectedEntities: [
      'Power Automate Flow: Post-Lead-To-CRM-Webhook',
      'Power Automate Flow: Notify-Slack-On-Alert',
    ],
    status: 'unread',
    publishDate: '2026-07-11',
  },
  {
    id: 'MC897812',
    title: 'Exchange Online Anti-Phishing First-Contact Safety Tip UI Refresh',
    category: 'stayInformed',
    severity: 'normal',
    workload: 'Exchange',
    isDeprecation: false,
    actionRequiredBy: '2026-08-10',
    horizonBucket: 'this_week',
    affectedUserCount: 140,
    summary: 'Updated banner formatting for external email safety alerts in Outlook for Web and Mobile.',
    details: 'Provides cleaner visual callouts when a user receives an email from an external sender for the first time or when domain spoofing is suspected.',
    impactSummary: 'Applies automatically to all 140 Exchange Online mailboxes.',
    affectedEntities: [
      'Exchange Transport Rule: Rule-01-ExternalBanner (Will be superseded)',
    ],
    status: 'acknowledged',
    publishDate: '2026-07-23',
  },
];

export const M365MessageCenterConsole: React.FC<M365MessageCenterConsoleProps> = ({
  tenants = [],
  selectedTenant,
  onSelectTenant,
  onShowToast,
}) => {
  // State
  const [announcements, setAnnouncements] = useState<MessageCenterAnnouncement[]>(INITIAL_ANNOUNCEMENTS);
  const [selectedHorizon, setSelectedHorizon] = useState<string>('all');
  const [selectedWorkload, setSelectedWorkload] = useState<string>('All Workloads');
  const [activeTab, setActiveTab] = useState<'all' | 'deprecations' | 'new_features' | 'plan_for_change'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState<string>('MC893201');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Proposal Generation State
  const [proposalItem, setProposalItem] = useState<MessageCenterAnnouncement | null>(null);
  const [proposalRate, setProposalRate] = useState<number>(175);
  const [proposalHours, setProposalHours] = useState<number>(18);
  const [proposalDiscount, setProposalDiscount] = useState<number>(0);

  // Handle Open Proposal Modal
  const handleOpenProposalModal = (item: MessageCenterAnnouncement) => {
    let hrs = 12;
    if (item.severity === 'critical') hrs = 24;
    else if (item.severity === 'major') hrs = 16;
    if (item.affectedUserCount > 20) hrs += 8;

    setProposalHours(hrs);
    setProposalItem(item);
  };

  // Active Tenant
  const activeTenant = useMemo(() => {
    return selectedTenant || tenants[0] || { id: 'contoso-01', name: 'Contoso Corporation', primaryDomain: 'contoso.onmicrosoft.com' };
  }, [selectedTenant, tenants]);

  // Selected Announcement Item for Drawer
  const selectedItem = useMemo(() => {
    return announcements.find((a) => a.id === selectedAnnouncementId) || announcements[0];
  }, [announcements, selectedAnnouncementId]);

  // Metrics Rollup
  const metrics = useMemo(() => {
    const criticalDeprecations = announcements.filter((a) => a.isDeprecation && a.severity === 'critical').length;
    const majorUpdates = announcements.filter((a) => a.severity === 'major').length;
    const newFeatures = announcements.filter((a) => a.category === 'stayInformed' && !a.isDeprecation).length;
    const activeIncidents = 1; // Service health advisory mock

    return {
      criticalDeprecations,
      majorUpdates,
      newFeatures,
      activeIncidents,
    };
  }, [announcements]);

  // Filtered Announcements Stream
  const filteredAnnouncements = useMemo(() => {
    return announcements.filter((item) => {
      // Horizon filter
      if (selectedHorizon !== 'all' && item.horizonBucket !== selectedHorizon) {
        return false;
      }

      // Workload filter
      if (selectedWorkload !== 'All Workloads' && item.workload !== selectedWorkload) {
        return false;
      }

      // Classification Tab filter
      if (activeTab === 'deprecations' && !item.isDeprecation) return false;
      if (activeTab === 'new_features' && item.category !== 'stayInformed') return false;
      if (activeTab === 'plan_for_change' && item.category !== 'planForChange') return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesId = item.id.toLowerCase().includes(q);
        const matchesSummary = item.summary.toLowerCase().includes(q);
        const matchesWorkload = item.workload.toLowerCase().includes(q);
        return matchesTitle || matchesId || matchesSummary || matchesWorkload;
      }

      return true;
    });
  }, [announcements, selectedHorizon, selectedWorkload, activeTab, searchQuery]);

  // Handle Sync
  const handleSyncGraphMessages = () => {
    setIsSyncing(true);
    onShowToast?.('info', 'Polling Graph API Announcements', 'Querying /admin/serviceAnnouncement/messages endpoint for ' + activeTenant.name + '...');
    setTimeout(() => {
      setIsSyncing(false);
      onShowToast?.('success', 'Message Center Synced', 'Fetched 10 active service announcements and tenant telemetry impacts.');
    }, 1200);
  };

  // Actions
  const handleAcknowledge = (id: string) => {
    setAnnouncements((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: 'acknowledged' as const } : a))
    );
    onShowToast?.('success', 'Announcement Acknowledged', `Marked ${id} as reviewed by MSP technician.`);
  };

  const handleCreateTicket = (id: string, title: string) => {
    setAnnouncements((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: 'ticketed' as const } : a))
    );
    onShowToast?.('success', 'PSA Ticket Dispatched', `Created Ticket #PSA-9912 for ${id}: "${title}".`);
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-[#e0e2ea] font-sans overflow-hidden select-none">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & TENANT IMPACT RADAR (FULL WIDTH) */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] p-4 lg:p-5 shrink-0 space-y-4 shadow-md">
        
        {/* Top bar: Tenant context & Header controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[#0078d4]/20 border border-[#0078d4] flex items-center justify-center text-[#a3c9ff] shrink-0">
              <Bell className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold text-[#e0e2ea] tracking-tight">
                  M365 Message Center & Change Horizon Console
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40 font-bold">
                  /portal/message-center
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
                <span className="text-[#4ade80] text-[11px] font-mono flex items-center gap-1 ml-2">
                  <CheckCircle2 className="w-3 h-3" /> Graph API Connected
                </span>
              </div>
            </div>
          </div>

          {/* Controls: Search, Sync, PDF Export */}
          <div className="flex items-center gap-2 flex-wrap">
            
            {/* Search Input */}
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e]" />
              <input
                type="text"
                placeholder="Search MC893201, Basic Auth, Teams..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] placeholder-[#8a919e] text-xs rounded pl-8 pr-3 py-1.5 focus:outline-none focus:border-[#0078d4]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a919e] hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Sync Button */}
            <button
              onClick={handleSyncGraphMessages}
              disabled={isSyncing}
              className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Polling Graph...' : 'Sync Graph Messages'}</span>
            </button>

            {/* Export PDF Button */}
            <button
              onClick={() => {
                onShowToast?.('success', 'Report Exported', 'Generated M365 Executive Change Horizon PDF Report.');
              }}
              className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Report PDF</span>
            </button>

          </div>

        </div>

        {/* Change Impact Rollup KPI Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          {/* KPI 1: Critical Deprecations */}
          <div className="bg-[#101419] border border-red-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-red-400 flex items-center gap-1">
                <AlertOctagon className="w-3.5 h-3.5 text-red-400" />
                ACTION REQUIRED / DEPRECATIONS
              </div>
              <div className="text-xl font-bold text-red-200 font-mono">
                {metrics.criticalDeprecations} <span className="text-xs font-normal text-red-400">Critical</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Retiring features within 90 days</div>
            </div>
            <div className="p-2 rounded bg-red-950/40 border border-red-800 text-red-400">
              <Flame className="w-5 h-5 animate-pulse" />
            </div>
          </div>

          {/* KPI 2: Major Updates */}
          <div className="bg-[#101419] border border-amber-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-amber-300 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
                MAJOR LIFE-CYCLE UPDATES
              </div>
              <div className="text-xl font-bold text-amber-100 font-mono">
                {metrics.majorUpdates} <span className="text-xs font-normal text-amber-300">Flagged</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">High-impact tenant behavior changes</div>
            </div>
            <div className="p-2 rounded bg-amber-950/40 border border-amber-800 text-amber-300">
              <Zap className="w-5 h-5" />
            </div>
          </div>

          {/* KPI 3: New Feature Rollouts */}
          <div className="bg-[#101419] border border-[#0078d4]/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-[#a3c9ff] flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                NEW FEATURE ROLLOUTS
              </div>
              <div className="text-xl font-bold text-[#e0e2ea] font-mono">
                {metrics.newFeatures} <span className="text-xs font-normal text-[#a3c9ff]">Roadmap</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Product enhancements & AI additions</div>
            </div>
            <div className="p-2 rounded bg-[#0078d4]/20 border border-[#0078d4] text-[#a3c9ff]">
              <Layers className="w-5 h-5" />
            </div>
          </div>

          {/* KPI 4: Active Service Health Incidents */}
          <div className="bg-[#101419] border border-emerald-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-emerald-400 flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 text-emerald-400" />
                SERVICE HEALTH STATUS
              </div>
              <div className="text-xl font-bold text-emerald-100 font-mono">
                {metrics.activeIncidents} <span className="text-xs font-normal text-emerald-400">Advisory</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">EX891202 - Exchange Online Sync</div>
            </div>
            <div className="p-2 rounded bg-[#166534]/30 border border-[#166534] text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>

        </div>

      </div>

      {/* ========================================================================= */}
      {/* 2. INTERACTIVE CHANGE HORIZON TIMELINE (HORIZONTAL TIME BUCKETS) */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] p-3 shrink-0">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
          <span className="font-semibold text-[#8a919e] text-[11px] uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1 font-mono">
            <Clock className="w-3.5 h-3.5 text-[#a3c9ff]" />
            Change Horizon:
          </span>

          {[
            { id: 'all', label: 'All Horizons', count: announcements.length, color: 'bg-[#272a30] text-[#e0e2ea]' },
            { id: 'this_week', label: '🔴 This Week (Immediate)', count: announcements.filter(a => a.horizonBucket === 'this_week').length, color: 'bg-red-950/60 text-red-300 border-red-800' },
            { id: 'next_week', label: '🟠 Next Week', count: announcements.filter(a => a.horizonBucket === 'next_week').length, color: 'bg-amber-950/60 text-amber-300 border-amber-800' },
            { id: 'month', label: '🟡 End of Month / 30 Days', count: announcements.filter(a => a.horizonBucket === 'month').length, color: 'bg-yellow-950/60 text-yellow-300 border-yellow-800' },
            { id: '60_days', label: '🔵 60 Days Planning', count: announcements.filter(a => a.horizonBucket === '60_days').length, color: 'bg-blue-950/60 text-blue-300 border-blue-800' },
            { id: '90_days', label: '🟣 90 Days & Beyond', count: announcements.filter(a => a.horizonBucket === '90_days').length, color: 'bg-purple-950/60 text-purple-300 border-purple-800' },
          ].map((bucket) => {
            const isSelected = selectedHorizon === bucket.id;
            return (
              <button
                key={bucket.id}
                onClick={() => setSelectedHorizon(bucket.id)}
                className={cn(
                  'px-3 py-1.5 rounded border text-xs font-semibold cursor-pointer transition-all shrink-0 flex items-center gap-1.5',
                  isSelected
                    ? 'bg-[#0078d4] text-white border-[#0078d4] shadow-sm'
                    : 'bg-[#181c22] border-[#404752] text-[#8a919e] hover:text-[#e0e2ea]'
                )}
              >
                <span>{bucket.label}</span>
                <span className="px-1.5 py-0.2 rounded bg-black/40 text-xs font-mono font-bold">
                  {bucket.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. MULTI-AXIS PRODUCT TAG & CATEGORY FILTER BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] p-3 shrink-0 space-y-2.5">
        
        {/* Classification Tabs */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          
          <div className="flex items-center gap-1.5 bg-[#101419] border border-[#404752] rounded p-1 text-xs">
            <button
              onClick={() => setActiveTab('all')}
              className={cn(
                'px-3 py-1 rounded font-bold transition-all cursor-pointer',
                activeTab === 'all' ? 'bg-[#0078d4] text-white' : 'text-[#8a919e] hover:text-[#e0e2ea]'
              )}
            >
              💬 All Announcements ({announcements.length})
            </button>

            <button
              onClick={() => setActiveTab('deprecations')}
              className={cn(
                'px-3 py-1 rounded font-bold transition-all cursor-pointer flex items-center gap-1',
                activeTab === 'deprecations' ? 'bg-red-700 text-white' : 'text-[#8a919e] hover:text-red-300'
              )}
            >
              <Flame className="w-3.5 h-3.5 text-red-400" />
              <span>Deprecations & Retirements</span>
            </button>

            <button
              onClick={() => setActiveTab('new_features')}
              className={cn(
                'px-3 py-1 rounded font-bold transition-all cursor-pointer flex items-center gap-1',
                activeTab === 'new_features' ? 'bg-purple-700 text-white' : 'text-[#8a919e] hover:text-purple-300'
              )}
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-300" />
              <span>New Features</span>
            </button>

            <button
              onClick={() => setActiveTab('plan_for_change')}
              className={cn(
                'px-3 py-1 rounded font-bold transition-all cursor-pointer flex items-center gap-1',
                activeTab === 'plan_for_change' ? 'bg-[#0078d4] text-white' : 'text-[#8a919e] hover:text-[#e0e2ea]'
              )}
            >
              <Calendar className="w-3.5 h-3.5 text-[#a3c9ff]" />
              <span>Plan for Change</span>
            </button>
          </div>

          <div className="text-xs text-[#8a919e] font-mono">
            Showing <strong className="text-[#e0e2ea]">{filteredAnnouncements.length}</strong> items
          </div>

        </div>

        {/* Workload Pill Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <span className="text-[11px] font-mono text-[#8a919e] uppercase shrink-0 mr-1">Workload:</span>
          {[
            'All Workloads',
            'Exchange',
            'Teams',
            'Entra',
            'SharePoint',
            'Intune',
            'Defender',
            'Copilot',
            'Power Platform',
          ].map((w) => (
            <button
              key={w}
              onClick={() => setSelectedWorkload(w)}
              className={cn(
                'px-2.5 py-0.5 rounded-full text-[11px] font-semibold cursor-pointer transition-all shrink-0 border',
                selectedWorkload === w
                  ? 'bg-[#a3c9ff]/20 text-[#a3c9ff] border-[#0078d4]'
                  : 'bg-[#101419] border-[#404752] text-[#8a919e] hover:text-[#e0e2ea]'
              )}
            >
              {w}
            </button>
          ))}
        </div>

      </div>

      {/* ========================================================================= */}
      {/* 4. MAIN ANNOUNCEMENT FEED & IMPACT MATRIX */}
      {/* ========================================================================= */}
      <div className="flex-1 flex overflow-hidden bg-[#0b0e14] relative">
        
        {/* Main List Stream */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-3.5 scrollbar-thin">
          
          {filteredAnnouncements.length === 0 ? (
            <div className="bg-[#181c22] border border-[#404752] rounded-lg p-12 text-center space-y-3">
              <Info className="w-8 h-8 text-[#8a919e] mx-auto" />
              <h3 className="font-bold text-base text-[#e0e2ea]">No Matching Service Announcements</h3>
              <p className="text-xs text-[#8a919e] max-w-md mx-auto">
                No Microsoft service announcements matched your current horizon filter or workload pill selection. Try resetting filters.
              </p>
              <button
                onClick={() => {
                  setSelectedHorizon('all');
                  setSelectedWorkload('All Workloads');
                  setActiveTab('all');
                  setSearchQuery('');
                }}
                className="px-3.5 py-1.5 bg-[#0078d4] text-white rounded text-xs font-semibold cursor-pointer"
              >
                Reset All Filters
              </button>
            </div>
          ) : (
            filteredAnnouncements.map((item) => {
              const isSelected = selectedAnnouncementId === item.id;
              
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    setSelectedAnnouncementId(item.id);
                    setIsDrawerOpen(true);
                  }}
                  className={cn(
                    'bg-[#181c22] border rounded-lg p-4 space-y-3 transition-all cursor-pointer hover:border-[#a3c9ff]',
                    isSelected
                      ? 'border-[#0078d4] ring-1 ring-[#0078d4]/50 bg-[#0078d4]/5'
                      : item.isDeprecation
                      ? 'border-red-900/40'
                      : 'border-[#404752]'
                  )}
                >
                  {/* Row Top Header */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-xs bg-[#101419] px-2 py-0.5 rounded border border-[#404752] text-[#a3c9ff]">
                        {item.id}
                      </span>

                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-[#101419] text-[#e0e2ea] border border-[#404752]">
                        {item.workload}
                      </span>

                      {item.isDeprecation ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-red-950/80 text-red-300 border border-red-800 flex items-center gap-1">
                          <Flame className="w-3 h-3 text-red-400" /> Deprecation / Retirement
                        </span>
                      ) : item.category === 'stayInformed' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-purple-950/80 text-purple-300 border border-purple-800 flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-purple-300" /> New Feature
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40">
                          Plan for Change
                        </span>
                      )}

                      {item.severity === 'critical' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-red-600 text-white animate-pulse">
                          CRITICAL SEVERITY
                        </span>
                      )}
                    </div>

                    <div className="text-xs font-mono text-[#8a919e] flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-[#a3c9ff]" />
                      <span>Action Deadline: <strong>{item.actionRequiredBy}</strong></span>
                    </div>
                  </div>

                  {/* Title & Summary */}
                  <div>
                    <h3 className="font-bold text-sm text-[#e0e2ea] hover:text-[#a3c9ff] transition-colors">
                      {item.title}
                    </h3>
                    <p className="text-xs text-[#8a919e] mt-1 line-clamp-2 leading-relaxed">
                      {item.summary}
                    </p>
                  </div>

                  {/* Tenant Telemetry Impact Banner */}
                  <div className={cn(
                    'p-2.5 rounded border text-xs flex items-center justify-between gap-3 font-mono',
                    item.affectedUserCount > 0
                      ? 'bg-amber-950/30 border-amber-800/60 text-amber-200'
                      : 'bg-[#101419] border-[#404752] text-[#8a919e]'
                  )}>
                    <div className="flex items-center gap-2 truncate">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="truncate">
                        <strong>Tenant Telemetry Impact:</strong> {item.impactSummary}
                      </span>
                    </div>

                    <span className="shrink-0 text-[10.5px] font-bold text-[#a3c9ff] underline">
                      {item.affectedUserCount} Accounts / Assets
                    </span>
                  </div>

                  {/* Quick Action Footer */}
                  <div className="flex items-center justify-between pt-1 border-t border-[#404752]/60 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[#8a919e]">Status:</span>
                      {item.status === 'acknowledged' ? (
                        <span className="text-emerald-400 font-bold flex items-center gap-1 text-[11px]">
                          <CheckCircle className="w-3 h-3" /> Acknowledged by Tech
                        </span>
                      ) : item.status === 'ticketed' ? (
                        <span className="text-[#a3c9ff] font-bold flex items-center gap-1 text-[11px]">
                          <Ticket className="w-3 h-3" /> Ticketed in PSA
                        </span>
                      ) : (
                        <span className="text-amber-300 font-bold text-[11px]">
                          Un-reviewed
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenProposalModal(item);
                        }}
                        className="px-2.5 py-1 bg-purple-950/80 hover:bg-purple-900 text-purple-200 border border-purple-700/80 hover:border-purple-500 rounded text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-sm"
                      >
                        <FileText className="w-3 h-3 text-purple-300" />
                        <span>Generate Proposal</span>
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAcknowledge(item.id);
                        }}
                        className="px-2.5 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded text-[11px] font-semibold cursor-pointer"
                      >
                        Acknowledge
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCreateTicket(item.id, item.title);
                        }}
                        className="px-2.5 py-1 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-[11px] font-semibold cursor-pointer"
                      >
                        Create PSA Ticket
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedAnnouncementId(item.id);
                          setIsDrawerOpen(true);
                        }}
                        className="p-1 text-[#8a919e] hover:text-white cursor-pointer"
                        title="Inspect Full Announcement"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                </div>
              );
            })
          )}

        </div>

        {/* ========================================================================= */}
        {/* 5. SLIDE-OUT ANNOUNCEMENT INSPECTION & ACTION DRAWER */}
        {/* ========================================================================= */}
        {isDrawerOpen && (
          <div className="w-full lg:w-[450px] bg-[#181c22] border-l border-[#404752] flex flex-col shrink-0 z-20 shadow-2xl overflow-y-auto">
            
            {/* Drawer Header */}
            <div className="p-4 bg-[#101419] border-b border-[#404752] flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 font-mono text-[10.5px]">
                  <span className="text-[#a3c9ff] font-bold">{selectedItem.id}</span>
                  <span>•</span>
                  <span className="text-[#8a919e]">{selectedItem.workload}</span>
                </div>
                <h3 className="font-bold text-sm text-[#e0e2ea] mt-0.5 line-clamp-1">
                  {selectedItem.title}
                </h3>
              </div>

              <button
                onClick={() => setIsDrawerOpen(false)}
                className="p-1.5 rounded text-[#8a919e] hover:text-white hover:bg-[#272a30] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Body Content */}
            <div className="p-5 space-y-5 text-xs">
              
              {/* Category & Deadline Card */}
              <div className="bg-[#101419] border border-[#404752] p-3.5 rounded space-y-2">
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-[#8a919e]">Action Deadline:</span>
                  <span className="text-red-400 font-bold">{selectedItem.actionRequiredBy}</span>
                </div>

                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-[#8a919e]">Horizon Bucket:</span>
                  <span className="text-[#a3c9ff] font-bold uppercase">{selectedItem.horizonBucket}</span>
                </div>

                {selectedItem.msLearnUrl && (
                  <div className="pt-1 border-t border-[#404752]/60">
                    <a
                      href={selectedItem.msLearnUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#a3c9ff] hover:underline flex items-center gap-1 font-mono text-[11px]"
                    >
                      <span>Read Official Microsoft Learn Docs</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>

              {/* Deep Dive Summary & Admin Instructions */}
              <div className="space-y-2">
                <h4 className="font-bold text-[#e0e2ea] uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-[#a3c9ff]" />
                  <span>Announcement Overview & Admin Guide</span>
                </h4>
                <p className="text-[#8a919e] leading-relaxed bg-[#101419] p-3 rounded border border-[#404752]">
                  {selectedItem.details}
                </p>
              </div>

              {/* Specific Tenant Impacted Entities List */}
              <div className="space-y-2">
                <h4 className="font-bold text-amber-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                  <span>Impacted Entities inside {activeTenant.name}</span>
                </h4>

                <div className="bg-[#101419] border border-amber-800/60 rounded p-3 space-y-2">
                  <p className="text-[11px] text-[#8a919e]">
                    Graph API telemetry identified the following specific mailboxes, scripts, or devices requiring MSP technician intervention:
                  </p>

                  <div className="space-y-1.5 font-mono text-[11px]">
                    {selectedItem.affectedEntities.map((entity, idx) => (
                      <div key={idx} className="bg-[#181c22] p-2 rounded border border-[#404752] text-amber-200 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        <span className="truncate">{entity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action Control Center */}
              <div className="space-y-2.5 pt-3 border-t border-[#404752]">
                <button
                  onClick={() => handleOpenProposalModal(selectedItem)}
                  className="w-full py-2.5 bg-gradient-to-r from-purple-900 to-[#0078d4] hover:from-purple-800 hover:to-[#0060ab] text-white border border-purple-500/50 rounded font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md"
                >
                  <FileText className="w-4 h-4 text-purple-200" />
                  <span>Generate Client SOW Proposal</span>
                </button>

                <button
                  onClick={() => {
                    onShowToast?.('info', 'Remediation Workflow Triggered', `Dispatching automated PowerShell migration for ${selectedItem.id}...`);
                  }}
                  className="w-full py-2.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md"
                >
                  <Zap className="w-4 h-4 text-amber-300" />
                  <span>Dispatch Automated Remediation Workflow</span>
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleCreateTicket(selectedItem.id, selectedItem.title)}
                    className="py-2 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded font-semibold text-[11px] cursor-pointer"
                  >
                    Export to HaloPSA / CW
                  </button>
                  <button
                    onClick={() => handleAcknowledge(selectedItem.id)}
                    className="py-2 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded font-semibold text-[11px] cursor-pointer"
                  >
                    Mark as Reviewed
                  </button>
                </div>
              </div>

            </div>

          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* PROPOSAL & SOW GENERATION MODAL OVERLAY */}
      {/* ========================================================================= */}
      {proposalItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#181c22] border border-[#0078d4] rounded-xl max-w-2xl w-full p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in-95">
            
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-[#404752] pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-purple-950/80 border border-purple-700 text-purple-300">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2 font-mono text-xs text-[#a3c9ff]">
                    <span>MSP STATEMENT OF WORK PROPOSAL</span>
                    <span>•</span>
                    <span className="font-bold text-purple-300">{proposalItem.id}</span>
                  </div>
                  <h2 className="text-base font-bold text-[#e0e2ea] mt-0.5">
                    {proposalItem.title}
                  </h2>
                  <div className="text-xs text-[#8a919e] mt-0.5">
                    Client: <strong className="text-[#e0e2ea]">{activeTenant.name}</strong> ({activeTenant.primaryDomain})
                  </div>
                </div>
              </div>

              <button
                onClick={() => setProposalItem(null)}
                className="p-1 rounded text-[#8a919e] hover:text-white hover:bg-[#272a30] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scope of Work Summary */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-[#a3c9ff] uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" /> Executive Statement of Work (SOW) Scope
              </label>
              <div className="bg-[#101419] border border-[#404752] p-3.5 rounded text-xs text-[#e0e2ea] leading-relaxed space-y-2">
                <p>
                  <strong>Objective:</strong> Technical remediation and change management for Microsoft 365 announcement <strong>{proposalItem.id}</strong> ({proposalItem.workload}).
                </p>
                <p className="text-[#8a919e]">
                  {proposalItem.details}
                </p>
                <div className="pt-2 border-t border-[#404752]/60 text-amber-200 text-[11px] font-mono">
                  ⚠️ Identified Client Telemetry Impact: {proposalItem.impactSummary} ({proposalItem.affectedUserCount} accounts/assets).
                </div>
              </div>
            </div>

            {/* Pricing & Estimation Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#101419] border border-[#404752] p-3.5 rounded">
              <div>
                <label className="text-[11px] text-[#8a919e] font-mono block">Estimated Work Hours</label>
                <input
                  type="number"
                  value={proposalHours}
                  onChange={(e) => setProposalHours(Math.max(1, Number(e.target.value)))}
                  className="w-full mt-1 bg-[#181c22] border border-[#404752] rounded px-2.5 py-1 text-xs text-[#e0e2ea] font-mono font-bold focus:border-[#0078d4] outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] text-[#8a919e] font-mono block">MSP Hourly Rate ($/hr)</label>
                <input
                  type="number"
                  value={proposalRate}
                  onChange={(e) => setProposalRate(Math.max(0, Number(e.target.value)))}
                  className="w-full mt-1 bg-[#181c22] border border-[#404752] rounded px-2.5 py-1 text-xs text-[#e0e2ea] font-mono font-bold focus:border-[#0078d4] outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] text-[#8a919e] font-mono block">Total SOW Investment</label>
                <div className="text-base font-bold font-mono text-emerald-400 mt-1">
                  ${(proposalHours * proposalRate).toLocaleString()} USD
                </div>
              </div>
            </div>

            {/* Project Deliverable Phases */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-[#a3c9ff] uppercase tracking-wider font-mono">
                Project Milestone Deliverables
              </label>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="p-2 bg-[#101419] border border-[#404752] rounded text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Phase 1: Environment Audit & Telemetry Assessment ({activeTenant.name})</span>
                </div>
                <div className="p-2 bg-[#101419] border border-[#404752] rounded text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Phase 2: Pilot Group Migration, Scripting & Conditional Access Staging</span>
                </div>
                <div className="p-2 bg-[#101419] border border-[#404752] rounded text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Phase 3: Production Rollout, User Communication & Validation Sign-off</span>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-[#404752] gap-2 flex-wrap">
              <button
                onClick={() => setProposalItem(null)}
                className="px-4 py-2 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] rounded text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    onShowToast?.('success', 'Proposal PDF Generated', `Exported Statement of Work PDF for ${activeTenant.name} - ${proposalItem.id}.`);
                  }}
                  className="px-3 py-2 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export SOW PDF</span>
                </button>

                <button
                  onClick={() => {
                    onShowToast?.('success', 'Proposal Dispatched', `Sent proposal SOW ($${(proposalHours * proposalRate).toLocaleString()}) to client primary admin at ${activeTenant.primaryDomain}.`);
                    setProposalItem(null);
                  }}
                  className="px-4 py-2 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Dispatch Proposal to Client</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
