// @ts-nocheck
import React, { useState } from 'react';
import {
  CreditCard,
  TrendingUp,
  Users,
  ShieldCheck,
  AlertOctagon,
  Activity,
  CheckSquare,
  FileText,
  Database,
  RefreshCw,
  Search,
  Lock,
  Inbox,
  Layers,
  Download,
  AlertTriangle,
  Building2,
  Zap,
  UserPlus,
  Trash2,
  RotateCcw,
  Code2,
  CheckCircle2,
  XCircle,
  X,
  ChevronRight,
  ShieldAlert,
  Clock,
  KeyRound,
  FileSpreadsheet,
  Check,
  SlidersHorizontal,
  Mail,
  UserX,
  Copy,
  ExternalLink,
  Sparkles,
} from 'lucide-react';

interface MspBillingAndAdminConsoleProps {
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
}

type TabType =
  | 'billing'
  | 'users'
  | 'approvals'
  | 'tasks'
  | 'workflows'
  | 'dlq'
  | 'dsar';

export const MspBillingAndAdminConsole: React.FC<MspBillingAndAdminConsoleProps> = ({
  onShowToast,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('billing');
  const [searchQuery, setSearchQuery] = useState('');

  // Tenant Cap State
  const [tenantCount, setTenantCount] = useState(18);
  const maxTenants = 25;

  // Modals & Drawers State
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showEditCardModal, setShowEditCardModal] = useState(false);
  const [showInviteTechModal, setShowInviteTechModal] = useState(false);
  
  // JSON / Audit Drawer State
  const [activeDrawer, setActiveDrawer] = useState<{
    title: string;
    type: 'json' | 'trace' | 'approval';
    data: any;
  } | null>(null);

  // Approval Modal State
  const [approvalToConfirm, setApprovalToConfirm] = useState<any | null>(null);

  // Dynamic DLQ Items State
  const [dlqItems, setDlqItems] = useState([
    {
      id: 'DLQ-9901',
      endpoint: 'GET /v1.0/security/alerts_v2',
      tenant: 'Contoso Corp',
      reason: '429 Rate Limit Exceeded (Graph Throttling)',
      timestamp: '2026-07-23 21:12:04',
      retries: 3,
      payload: { tenantId: 'contoso-01', query: 'security/alerts', error: 'Too Many Requests' },
      stackTrace: 'Error 429: Rate limit exceeded.\n  at GraphClient.execute (node_modules/@microsoft/microsoft-graph-client)\n  at PollWorker.fetchAlerts (/src/services/graphPoll.ts:84)',
    },
    {
      id: 'DLQ-9884',
      endpoint: 'POST /v1.0/deviceManagement/managedDevices/wipe',
      tenant: 'Fabrikam Inc',
      reason: '403 Forbidden - Missing DeviceManagementManagedDevices.PrivilegedOperations.All',
      timestamp: '2026-07-23 20:45:19',
      retries: 5,
      payload: { tenantId: 'fabrikam-02', deviceId: 'DEV-FIN-992', action: 'RemoteWipe' },
      stackTrace: 'Error 403: Insufficient privileges.\n  at GraphClient.post (/src/services/graphClient.ts:102)\n  at IntuneService.wipeDevice (/src/services/intune.ts:44)',
    },
    {
      id: 'DLQ-9750',
      endpoint: 'PATCH /v1.0/identity/conditionalAccess/policies/ca-901',
      tenant: 'Tailwind Traders',
      reason: '504 Gateway Timeout (Entra ID Sync Latency)',
      timestamp: '2026-07-23 19:30:11',
      retries: 2,
      payload: { tenantId: 'tailwind-03', policyId: 'ca-901', state: 'enabled' },
      stackTrace: 'Error 504: Gateway Timeout after 30000ms.\n  at Timeout.<anonymous> (/src/utils/http.ts:19)',
    },
  ]);

  // Dynamic Pending Approvals State
  const [pendingApprovals, setPendingApprovals] = useState([
    {
      id: 'APP-1042',
      tenant: 'Contoso Corp',
      tech: 'Sarah Jenkins (Tier 2 Tech)',
      action: 'Remote Wipe Endpoint DEV-FIN-09',
      safetyTier: 'Gated (High Risk)',
      ticketId: 'INC-98214',
      time: '12 mins ago',
      payload: {
        tenantId: 'contoso-01',
        action: 'deviceManagement/managedDevices/DEV-FIN-09/wipe',
        keepEnrollmentData: false,
        keepUserData: false,
        requestedBy: 's.jenkins@apexms.com',
      },
    },
    {
      id: 'APP-1038',
      tenant: 'Fabrikam Inc',
      tech: 'David Ross (Tier 2 Tech)',
      action: 'Delete Conditional Access Policy "CA009-LegacyBlock"',
      safetyTier: 'Gated (High Risk)',
      ticketId: 'INC-98110',
      time: '45 mins ago',
      payload: {
        tenantId: 'fabrikam-02',
        action: 'identity/conditionalAccess/policies/ca-009/delete',
        policyName: 'CA009-LegacyBlock',
        requestedBy: 'd.ross@apexms.com',
      },
    },
    {
      id: 'APP-1029',
      tenant: 'Tailwind Traders',
      tech: 'Alex Mercer (Global Admin)',
      action: 'Convert Distribution List "all-sales@tailwind.com" to M365 Group',
      safetyTier: 'Gated (Medium Risk)',
      ticketId: 'REQ-44210',
      time: '2 hours ago',
      payload: {
        tenantId: 'tailwind-03',
        action: 'groups/convertDLToM365Group',
        dlAddress: 'all-sales@tailwind.com',
        requestedBy: 'a.mercer@apexms.com',
      },
    },
  ]);

  // Dynamic Operator Tasks State
  const [operatorTasks, setOperatorTasks] = useState([
    {
      id: 'TSK-501',
      title: 'Manually verify Break-Glass 2FA tokens in YubiKey vault',
      tenant: 'Contoso Corp',
      priority: 'High',
      tech: 'Sarah Jenkins',
      dueDate: 'Today, 17:00',
      status: 'In Progress',
    },
    {
      id: 'TSK-498',
      title: 'Audit external forwarding delegates for finance mailboxes',
      tenant: 'Fabrikam Inc',
      priority: 'High',
      tech: 'David Ross',
      dueDate: 'Tomorrow, 12:00',
      status: 'To Do',
    },
    {
      id: 'TSK-482',
      title: 'Reconcile Defender P2 license upgrade gap proposal',
      tenant: 'Tailwind Traders',
      priority: 'Medium',
      tech: 'Alex Mercer',
      dueDate: 'Jul 26, 2026',
      status: 'Done',
    },
  ]);

  // Dynamic Staff List State
  const [staffMembers, setStaffMembers] = useState([
    {
      name: 'Alex Mercer',
      email: 'a.mercer@apexms.com',
      role: 'Global Admin',
      lastActive: 'Just now',
      status: 'Active',
    },
    {
      name: 'Sarah Jenkins',
      email: 's.jenkins@apexms.com',
      role: 'Tier 2 Tech',
      lastActive: '14 mins ago',
      status: 'Active',
    },
    {
      name: 'David Ross',
      email: 'd.ross@apexms.com',
      role: 'Tier 2 Tech',
      lastActive: '1 hour ago',
      status: 'Active',
    },
    {
      name: 'Elena Rostova',
      email: 'e.rostova@apexms.com',
      role: 'Tier 1 Viewer',
      lastActive: '3 hours ago',
      status: 'Active',
    },
  ]);

  // Dynamic DSAR Requests
  const [dsarRequests, setDsarRequests] = useState([
    {
      id: 'DSAR-8821',
      tenant: 'Contoso Corp',
      type: 'Export Telemetry & Audit Logs',
      requestedBy: 'compliance@contoso.com',
      dateSubmitted: '2026-07-22',
      status: 'Processing',
    },
    {
      id: 'DSAR-8790',
      tenant: 'Fabrikam Inc',
      type: 'Purge Historic Sign-In Logs (>90 Days)',
      requestedBy: 'dpo@fabrikam.com',
      dateSubmitted: '2026-07-20',
      status: 'Pending Approval',
    },
    {
      id: 'DSAR-8640',
      tenant: 'Tailwind Traders',
      type: 'Export End-User Identity Mapping',
      requestedBy: 'legal@tailwind.com',
      dateSubmitted: '2026-07-15',
      status: 'Completed',
    },
  ]);

  // Replay DLQ Item Handler
  const handleReplayDlq = (id: string) => {
    onShowToast?.('info', 'Replaying DLQ Payload', `Re-dispatching message ${id} to Microsoft Graph worker...`);
    setTimeout(() => {
      setDlqItems((prev) => prev.filter((item) => item.id !== id));
      onShowToast?.('success', 'DLQ Replay Successful', `Message ${id} reprocessed with 200 OK.`);
    }, 1000);
  };

  // Purge DLQ Item Handler
  const handlePurgeDlq = (id: string) => {
    setDlqItems((prev) => prev.filter((item) => item.id !== id));
    onShowToast?.('warning', 'Message Purged', `DLQ message ${id} removed from queue.`);
  };

  // Approve Pending Action
  const handleConfirmApproval = () => {
    if (!approvalToConfirm) return;
    const item = approvalToConfirm;
    setPendingApprovals((prev) => prev.filter((a) => a.id !== item.id));
    onShowToast?.(
      'success',
      `Approval Granted [${item.ticketId}]`,
      `Executed "${item.action}" for ${item.tenant} via Graph API.`
    );
    setApprovalToConfirm(null);
  };

  // Reject Pending Action
  const handleRejectApproval = (id: string, actionName: string) => {
    setPendingApprovals((prev) => prev.filter((a) => a.id !== id));
    onShowToast?.('warning', 'Action Rejected', `Gated action "${actionName}" was canceled by supervisor.`);
  };

  // Simulate Adding Tenant (Checking Limit)
  const handleAddTenantClick = () => {
    if (tenantCount >= 20) {
      setShowUpgradeModal(true);
    } else {
      setTenantCount((prev) => prev + 1);
      onShowToast?.('success', 'Tenant Monitored', `Added new tenant. Current usage: ${tenantCount + 1}/${maxTenants}.`);
    }
  };

  const capPercentage = Math.round((tenantCount / maxTenants) * 100);
  const isNearLimit = tenantCount >= 20;

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-[#e0e2ea] font-sans overflow-hidden select-none">
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & SUBSCRIPTION STATUS BANNER (FULL WIDTH) */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] p-4 sm:p-5 shrink-0 shadow-md">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          {/* MSP Profile Metadata */}
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 rounded-md bg-[#0078d4]/20 border border-[#0078d4]/40 text-[#a3c9ff]">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold text-[#e0e2ea] tracking-tight">
                  Apex Managed Services
                </h1>
                <span className="px-2 py-0.5 rounded bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40 font-mono text-xs font-semibold">
                  Basic Tier ($499/mo)
                </span>
                <span className="text-xs font-mono text-[#8a919e] bg-[#101419] px-2 py-0.5 rounded border border-[#404752]">
                  ID: ACC-90214-MSP
                </span>
              </div>
              <p className="text-xs text-[#8a919e] mt-1 flex items-center gap-2">
                <span>Primary Admin: <strong className="text-[#e0e2ea]">admin@apexms.com</strong></span>
                <span>•</span>
                <span className="text-[#4ade80] font-medium">Billing Account Active</span>
              </p>
            </div>
          </div>

          {/* Tenant Cap Gauge Progress Bar & Actions */}
          <div className="bg-[#101419] border border-[#404752] rounded-lg p-3.5 sm:p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-4 min-w-[320px] lg:min-w-[420px]">
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#e0e2ea] flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-[#a3c9ff]" />
                  <span>Tenant Capacity Gauge</span>
                </span>
                <span className="font-mono font-bold text-[#e0e2ea]">
                  {tenantCount} / {maxTenants} <span className="text-[#8a919e] font-normal">Tenants ({capPercentage}%)</span>
                </span>
              </div>

              {/* Progress Bar Gauge */}
              <div className="w-full h-2 rounded-full bg-[#272a30] overflow-hidden relative border border-[#404752]">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isNearLimit
                      ? 'bg-amber-500'
                      : 'bg-[#0078d4]'
                  }`}
                  style={{ width: `${capPercentage}%` }}
                />
              </div>

              {/* Limit Warning Logic */}
              {isNearLimit ? (
                <div className="text-[11px] font-semibold text-amber-300 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Approaching 25 Tenant Limit — Tier Upgrade Required for Additional Tenants</span>
                </div>
              ) : (
                <div className="text-[10.5px] text-[#8a919e] flex items-center justify-between">
                  <span>7 seats remaining in Basic Plan</span>
                  <button
                    onClick={handleAddTenantClick}
                    className="text-[#a3c9ff] hover:underline cursor-pointer font-semibold"
                  >
                    + Add Monitored Tenant
                  </button>
                </div>
              )}
            </div>

            {/* Header Quick Action Buttons */}
            <div className="flex sm:flex-col gap-2 shrink-0 justify-center">
              <button
                onClick={() => setShowUpgradeModal(true)}
                className="flex-1 sm:flex-none px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Upgrade Plan</span>
              </button>
              <button
                onClick={() =>
                  onShowToast?.(
                    'info',
                    'Downloading Invoice PDF',
                    'Generating latest billing invoice (INV-2026-07) for Apex Managed Services.'
                  )
                }
                className="flex-1 sm:flex-none px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] rounded text-xs font-semibold border border-[#404752] flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#a3c9ff]" />
                <span>Invoice PDF</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. CORE OPERATIONAL NAVIGATION (7 HORIZONTAL TABS) */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] px-3 sm:px-6 overflow-x-auto shrink-0 scrollbar-none">
        <div className="flex items-center gap-1 sm:gap-2 min-w-max py-2">
          {[
            { id: 'billing', label: 'Plan & Invoices', icon: CreditCard, badge: 'Basic Tier' },
            { id: 'users', label: 'User & Staff RBAC', icon: Users, badge: '8 / 10 Techs' },
            { id: 'approvals', label: 'Pending Approvals', icon: Lock, badge: `${pendingApprovals.length} Gated` },
            { id: 'tasks', label: 'Operator Tasks', icon: CheckSquare, badge: `${operatorTasks.filter(t => t.status !== 'Done').length} Open` },
            { id: 'workflows', label: 'Workflow Runs', icon: RefreshCw, badge: 'Realtime' },
            { id: 'dlq', label: 'Dead Letter Queue', icon: AlertOctagon, badge: `${dlqItems.length} Failed` },
            { id: 'dsar', label: 'Data Rights & DSAR', icon: Database, badge: 'GDPR / CCPA' },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded text-xs font-semibold transition-all border cursor-pointer ${
                  isActive
                    ? 'bg-[#0078d4] text-white border-[#0078d4]'
                    : 'bg-[#272a30] text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#31353b] border-[#404752]'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-[#8a919e]'}`} />
                <span>{tab.label}</span>
                <span
                  className={`text-[9.5px] font-mono px-1.5 py-0.2 rounded ${
                    isActive ? 'bg-white/20 text-white' : 'bg-[#101419] text-[#8a919e]'
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
      {/* 3. TAB CONTENT CONTAINERS */}
      {/* ========================================================================= */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">

        {/* ----------------------------------------------------------------------- */}
        {/* TAB 1: PLAN & INVOICES */}
        {/* ----------------------------------------------------------------------- */}
        {activeTab === 'billing' && (
          <div className="space-y-6">
            {/* Tier Breakdown Card Grid */}
            <div className="space-y-2">
              <h2 className="text-sm font-bold text-[#e0e2ea] flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#a3c9ff]" />
                <span>MSP Portal Tier Subscriptions & Tenant Limits</span>
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Basic Tier (Active) */}
                <div className="p-4 rounded-md bg-[#181c22] border-2 border-[#0078d4] relative space-y-3 shadow-sm">
                  <div className="absolute -top-3 right-4 px-2 py-0.5 rounded bg-[#0078d4] text-white font-mono text-[10px] font-bold uppercase tracking-wider">
                    Active Plan
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#e0e2ea]">Basic Tier</h3>
                    <div className="text-xl font-bold text-[#a3c9ff] font-mono mt-0.5">
                      $499 <span className="text-xs text-[#8a919e] font-normal">/ month</span>
                    </div>
                    <p className="text-xs text-[#8a919e] mt-1">Ideal for growing MSPs managing up to 25 client tenants.</p>
                  </div>
                  <div className="space-y-2 border-t border-[#404752] pt-3 text-xs text-[#e0e2ea]">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#4ade80] shrink-0" />
                      <span>Up to <strong>25 Monitored Tenants</strong></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#4ade80] shrink-0" />
                      <span>5-minute Graph API Sync Intervals</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#4ade80] shrink-0" />
                      <span>10 Technician Staff Seats</span>
                    </div>
                  </div>
                  <button
                    disabled
                    className="w-full py-1.5 bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40 rounded text-xs font-semibold cursor-default"
                  >
                    Current Active Plan
                  </button>
                </div>

                {/* Enhanced Tier */}
                <div className="p-4 rounded-md bg-[#181c22] border border-[#404752] hover:border-[#0078d4] transition-all space-y-3 shadow-sm">
                  <div>
                    <h3 className="text-base font-bold text-[#e0e2ea]">Enhanced Tier</h3>
                    <div className="text-xl font-bold text-purple-300 font-mono mt-0.5">
                      $999 <span className="text-xs text-[#8a919e] font-normal">/ month</span>
                    </div>
                    <p className="text-xs text-[#8a919e] mt-1">For established MSPs requiring expanded scale & Intune write actions.</p>
                  </div>
                  <div className="space-y-2 border-t border-[#404752] pt-3 text-xs text-[#e0e2ea]">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
                      <span>Up to <strong>75 Monitored Tenants</strong></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
                      <span>Advanced PIM & Intune Remote Actions</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
                      <span>25 Technician Staff Seats</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowUpgradeModal(true)}
                    className="w-full py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-semibold transition-all shadow-sm cursor-pointer"
                  >
                    Upgrade to Enhanced
                  </button>
                </div>

                {/* Premium Tier */}
                <div className="p-4 rounded-md bg-[#181c22] border border-[#404752] hover:border-[#0078d4] transition-all space-y-3 shadow-sm">
                  <div>
                    <h3 className="text-base font-bold text-[#e0e2ea]">Premium Enterprise</h3>
                    <div className="text-xl font-bold text-amber-300 font-mono mt-0.5">
                      $1,899 <span className="text-xs text-[#8a919e] font-normal">/ month</span>
                    </div>
                    <p className="text-xs text-[#8a919e] mt-1">Unlimited tenants with dedicated Graph API polling engine & auto-healing.</p>
                  </div>
                  <div className="space-y-2 border-t border-[#404752] pt-3 text-xs text-[#e0e2ea]">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                      <span><strong>Unlimited Client Tenants</strong></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Auto-Healing Drift Remediation Engine</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Unlimited Staff Seats + Dedicated SLA</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowUpgradeModal(true)}
                    className="w-full py-1.5 bg-[#272a30] hover:bg-[#31353b] text-amber-300 border border-[#404752] rounded text-xs font-semibold transition-all shadow-sm cursor-pointer"
                  >
                    Request Enterprise Upgrade
                  </button>
                </div>
              </div>
            </div>

            {/* Payment Method & Billing History Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Payment Method Card */}
              <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between border-b border-[#404752] pb-2.5">
                  <h3 className="font-bold text-[#e0e2ea] text-sm flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-[#a3c9ff]" />
                    <span>Default Payment Method</span>
                  </h3>
                  <button
                    onClick={() => setShowEditCardModal(true)}
                    className="text-xs text-[#a3c9ff] hover:underline font-semibold cursor-pointer"
                  >
                    Edit Card
                  </button>
                </div>

                <div className="p-3.5 rounded bg-[#101419] border border-[#404752] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-[#8a919e]">VISA CORPORATE</span>
                    <span className="px-2 py-0.5 rounded bg-[#166534]/30 text-[#4ade80] text-[10px] font-mono border border-[#166534]">
                      DEFAULT
                    </span>
                  </div>
                  <div className="text-base font-mono text-[#e0e2ea] tracking-wider">
                    •••• •••• •••• 4242
                  </div>
                  <div className="flex items-center justify-between text-xs text-[#8a919e]">
                    <span>Expires: <strong className="text-[#e0e2ea]">08/28</strong></span>
                    <span>Billing ZIP: <strong className="text-[#e0e2ea]">98101</strong></span>
                  </div>
                </div>

                <div className="text-xs text-[#8a919e] space-y-1">
                  <p>Next automatic renewal: <strong className="text-[#e0e2ea]">August 1, 2026</strong> ($499.00)</p>
                  <p className="text-[11px] text-[#8a919e]">Receipts dispatched to admin@apexms.com</p>
                </div>
              </div>

              {/* Billing History Table */}
              <div className="lg:col-span-2 bg-[#181c22] border border-[#404752] rounded-md p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between border-b border-[#404752] pb-2.5">
                  <div>
                    <h3 className="font-bold text-[#e0e2ea] text-sm flex items-center gap-2">
                      <FileText className="w-4 h-4 text-purple-400" />
                      <span>Billing History & Invoices</span>
                    </h3>
                    <p className="text-xs text-[#8a919e]">Download past receipts and tax compliance documentation.</p>
                  </div>
                  <button
                    onClick={() =>
                      onShowToast?.(
                        'info',
                        'Exporting Statements',
                        'Compiled 2026 statement package in CSV.'
                      )
                    }
                    className="px-2.5 py-1 bg-[#272a30] hover:bg-[#31353b] text-xs font-semibold text-[#e0e2ea] rounded border border-[#404752] cursor-pointer"
                  >
                    Export CSV
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#404752] text-[#8a919e] font-mono uppercase text-[10px]">
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Invoice ID</th>
                        <th className="py-2.5 px-3">Amount</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 text-right">Receipt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#404752]/60">
                      {[
                        { date: 'Jul 01, 2026', id: 'INV-2026-07', amount: '$499.00', status: 'Paid' },
                        { date: 'Jun 01, 2026', id: 'INV-2026-06', amount: '$499.00', status: 'Paid' },
                        { date: 'May 01, 2026', id: 'INV-2026-05', amount: '$499.00', status: 'Paid' },
                        { date: 'Apr 01, 2026', id: 'INV-2026-04', amount: '$499.00', status: 'Paid' },
                      ].map((inv, i) => (
                        <tr key={i} className="hover:bg-[#272a30]/50 transition-colors">
                          <td className="py-2.5 px-3 text-[#e0e2ea]">{inv.date}</td>
                          <td className="py-2.5 px-3 font-mono text-[#a3c9ff]">{inv.id}</td>
                          <td className="py-2.5 px-3 font-mono font-bold text-[#e0e2ea]">{inv.amount}</td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded bg-[#166534]/30 text-[#4ade80] border border-[#166534] text-[10px] font-mono">
                              {inv.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              onClick={() =>
                                onShowToast?.(
                                  'success',
                                  `Downloaded ${inv.id}`,
                                  `Invoice PDF saved to local downloads.`
                                )
                              }
                              className="px-2 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] text-[10.5px] rounded border border-[#404752] flex items-center gap-1 ml-auto cursor-pointer"
                            >
                              <Download className="w-3 h-3 text-[#a3c9ff]" />
                              <span>PDF</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------------- */}
        {/* TAB 2: USER & STAFF RBAC */}
        {/* ----------------------------------------------------------------------- */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            {/* Top Summary Banner */}
            <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
              <div className="space-y-1">
                <h3 className="font-bold text-[#e0e2ea] text-sm flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#a3c9ff]" />
                  <span>MSP Technician Staff & Role-Based Access Control (RBAC)</span>
                </h3>
                <p className="text-xs text-[#8a919e]">
                  Manage technician access seats, privilege tiers, and MFA credentials across client tenant consoles.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="px-3 py-1.5 rounded bg-[#101419] border border-[#404752] text-xs font-mono">
                  <span className="text-[#8a919e]">Seats Used: </span>
                  <strong className="text-[#e0e2ea]">8 / 10 Techs</strong>
                </div>
                <button
                  onClick={() => setShowInviteTechModal(true)}
                  className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Invite New Tech</span>
                </button>
              </div>
            </div>

            {/* Staff Table */}
            <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 space-y-3 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#404752] text-[#8a919e] font-mono uppercase text-[10px]">
                      <th className="py-2.5 px-3">Technician & Email</th>
                      <th className="py-2.5 px-3">Assigned Role</th>
                      <th className="py-2.5 px-3">Last Active</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Staff Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/60 font-sans">
                    {staffMembers.map((staff, i) => (
                      <tr key={i} className="hover:bg-[#272a30]/50 transition-colors">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-[#e0e2ea]">{staff.name}</div>
                          <div className="text-[10px] text-[#8a919e] font-mono">{staff.email}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10.5px] font-mono font-semibold ${
                              staff.role === 'Global Admin'
                                ? 'bg-purple-900/40 text-purple-300 border border-purple-700/60'
                                : staff.role === 'Tier 2 Tech'
                                ? 'bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40'
                                : 'bg-[#272a30] text-[#e0e2ea] border border-[#404752]'
                            }`}
                          >
                            {staff.role}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[#8a919e] font-mono text-[11px]">{staff.lastActive}</td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded bg-[#166534]/30 text-[#4ade80] border border-[#166534] text-[10px] font-mono">
                            {staff.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() =>
                                onShowToast?.(
                                  'info',
                                  'Role Editor Triggered',
                                  `Editing permissions for ${staff.name}.`
                                )
                              }
                              className="px-2 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] text-[10.5px] rounded border border-[#404752] cursor-pointer"
                            >
                              Edit Role
                            </button>
                            <button
                              onClick={() =>
                                onShowToast?.(
                                  'success',
                                  '2FA Challenge Reset',
                                  `Sent 2FA reset link to ${staff.email}.`
                                )
                              }
                              className="px-2 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] text-[10.5px] rounded border border-[#404752] cursor-pointer"
                            >
                              Reset 2FA
                            </button>
                            <button
                              onClick={() => {
                                setStaffMembers((prev) => prev.filter((s) => s.email !== staff.email));
                                onShowToast?.('warning', 'Access Revoked', `Revoked staff access for ${staff.name}.`);
                              }}
                              className="px-2 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-300 text-[10.5px] rounded border border-red-800/80 cursor-pointer"
                            >
                              Revoke
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
        {/* TAB 3: PENDING APPROVALS */}
        {/* ----------------------------------------------------------------------- */}
        {activeTab === 'approvals' && (
          <div className="space-y-6">
            <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 space-y-1 shadow-sm">
              <h3 className="font-bold text-[#e0e2ea] text-sm flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400" />
                <span>Gated High-Risk Graph API Actions Awaiting Supervisor Approval</span>
              </h3>
              <p className="text-xs text-[#8a919e]">
                To prevent accidental tenant downtime, write operations like remote wipes or CA policy deletions require secondary sign-off.
              </p>
            </div>

            <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 space-y-3 shadow-sm">
              {pendingApprovals.length === 0 ? (
                <div className="py-12 text-center text-[#8a919e] text-xs space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-[#4ade80] mx-auto" />
                  <p className="font-bold text-[#e0e2ea]">Approval Queue Empty</p>
                  <p>All gated actions across client tenants have been processed.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#404752] text-[#8a919e] font-mono uppercase text-[10px]">
                        <th className="py-2.5 px-3">Target Tenant</th>
                        <th className="py-2.5 px-3">Triggering Tech</th>
                        <th className="py-2.5 px-3">Requested Action</th>
                        <th className="py-2.5 px-3">Ticket ID</th>
                        <th className="py-2.5 px-3">Time</th>
                        <th className="py-2.5 px-3 text-right">Approval Decisions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#404752]/60 font-sans">
                      {pendingApprovals.map((app) => (
                        <tr key={app.id} className="hover:bg-[#272a30]/50 transition-colors">
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-[#e0e2ea]">{app.tenant}</div>
                            <span className="text-[10px] font-mono text-amber-300 bg-amber-950/40 px-1.5 py-0.2 rounded border border-amber-800/60">
                              {app.safetyTier}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-[#e0e2ea]">{app.tech}</td>
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-[#a3c9ff]">{app.action}</div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-purple-300">{app.ticketId}</td>
                          <td className="py-2.5 px-3 text-[#8a919e] font-mono text-[11px]">{app.time}</td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() =>
                                  setActiveDrawer({
                                    title: `Graph Payload: ${app.action}`,
                                    type: 'json',
                                    data: app.payload,
                                  })
                                }
                                className="px-2 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] text-[10.5px] rounded border border-[#404752] flex items-center gap-1 cursor-pointer"
                              >
                                <Code2 className="w-3 h-3 text-[#a3c9ff]" />
                                <span>Payload</span>
                              </button>
                              <button
                                onClick={() => handleRejectApproval(app.id, app.action)}
                                className="px-2 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-300 text-[10.5px] rounded border border-red-800/80 cursor-pointer"
                              >
                                Reject
                              </button>
                              <button
                                onClick={() => setApprovalToConfirm(app)}
                                className="px-2.5 py-1 bg-[#166534] hover:bg-[#15803d] text-white text-[10.5px] font-bold rounded shadow-sm transition-all cursor-pointer"
                              >
                                Approve & Execute
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------------- */}
        {/* TAB 4: OPERATOR TASKS */}
        {/* ----------------------------------------------------------------------- */}
        {activeTab === 'tasks' && (
          <div className="space-y-6">
            <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 space-y-1 shadow-sm">
              <h3 className="font-bold text-[#e0e2ea] text-sm flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-[#a3c9ff]" />
                <span>Technician Remediation Queue & Manual Operations Checklist</span>
              </h3>
              <p className="text-xs text-[#8a919e]">
                Manual tasks generated by Graph compliance drift policies requiring hands-on technician intervention.
              </p>
            </div>

            <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 space-y-3 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#404752] text-[#8a919e] font-mono uppercase text-[10px]">
                      <th className="py-2.5 px-3">Task Title & Tenant</th>
                      <th className="py-2.5 px-3">Priority</th>
                      <th className="py-2.5 px-3">Assigned Tech</th>
                      <th className="py-2.5 px-3">Due Date</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/60 font-sans">
                    {operatorTasks.map((tsk) => (
                      <tr key={tsk.id} className="hover:bg-[#272a30]/50 transition-colors">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-[#e0e2ea]">{tsk.title}</div>
                          <div className="text-[10px] text-[#a3c9ff] font-mono mt-0.5">{tsk.tenant} • ID: {tsk.id}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              tsk.priority === 'High'
                                ? 'bg-red-950/40 text-red-300 border border-red-800/80'
                                : 'bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40'
                            }`}
                          >
                            {tsk.priority}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[#e0e2ea] font-medium">{tsk.tech}</td>
                        <td className="py-2.5 px-3 text-[#8a919e] font-mono text-[11px]">{tsk.dueDate}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              tsk.status === 'Done'
                                ? 'bg-[#166534]/30 text-[#4ade80] border border-[#166534]'
                                : tsk.status === 'In Progress'
                                ? 'bg-amber-950/40 text-amber-300 border border-amber-800/60'
                                : 'bg-[#272a30] text-[#8a919e] border border-[#404752]'
                            }`}
                          >
                            {tsk.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {tsk.status !== 'Done' && (
                              <button
                                onClick={() => {
                                  setOperatorTasks((prev) =>
                                    prev.map((t) => (t.id === tsk.id ? { ...t, status: 'Done' } : t))
                                  );
                                  onShowToast?.('success', 'Task Completed', `Marked "${tsk.title}" as Done.`);
                                }}
                                className="px-2 py-1 bg-[#166534] hover:bg-[#15803d] text-white text-[10.5px] font-semibold rounded transition-all cursor-pointer"
                              >
                                Mark Complete
                              </button>
                            )}
                            <button
                              onClick={() =>
                                onShowToast?.('info', 'Audit Note Added', `Logged technician note for ${tsk.id}.`)
                              }
                              className="px-2 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] text-[10.5px] rounded border border-[#404752] cursor-pointer"
                            >
                              Add Note
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
        {/* TAB 5: WORKFLOW RUNS */}
        {/* ----------------------------------------------------------------------- */}
        {activeTab === 'workflows' && (
          <div className="space-y-6">
            <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 space-y-1 shadow-sm">
              <h3 className="font-bold text-[#e0e2ea] text-sm flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-[#4ade80]" />
                <span>Cross-Tenant Workflow Execution Telemetry & Real-Time Monitoring</span>
              </h3>
              <p className="text-xs text-[#8a919e]">
                Monitor 5-minute background cron jobs, event-driven webhooks, and manual workflow executions.
              </p>
            </div>

            <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 space-y-3 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#404752] text-[#8a919e] font-mono uppercase text-[10px]">
                      <th className="py-2.5 px-3">Workflow Name</th>
                      <th className="py-2.5 px-3">Target Tenant</th>
                      <th className="py-2.5 px-3">Trigger Type</th>
                      <th className="py-2.5 px-3">Duration</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Telemetry Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/60 font-sans">
                    {[
                      {
                        name: 'Graph Security Alert Poller v2',
                        tenant: 'Contoso Corp',
                        trigger: '5m Cron',
                        duration: '420ms',
                        status: 'Success',
                      },
                      {
                        name: 'Intune Compliance Enforcer',
                        tenant: 'Fabrikam Inc',
                        trigger: 'Event Listener',
                        duration: '1,280ms',
                        status: 'Success',
                      },
                      {
                        name: 'Exchange Transport Rule Audit',
                        tenant: 'Tailwind Traders',
                        trigger: 'Manual UI',
                        duration: '890ms',
                        status: 'Failed',
                      },
                      {
                        name: 'Entra ID PIM Auto-Revoke',
                        tenant: 'Contoso Corp',
                        trigger: '15m Cron',
                        duration: '310ms',
                        status: 'Success',
                      },
                    ].map((wf, i) => (
                      <tr key={i} className="hover:bg-[#272a30]/50 transition-colors">
                        <td className="py-2.5 px-3 font-bold text-[#e0e2ea]">{wf.name}</td>
                        <td className="py-2.5 px-3 text-[#a3c9ff] font-mono text-[11px]">{wf.tenant}</td>
                        <td className="py-2.5 px-3 text-[#8a919e] font-mono text-[10.5px]">{wf.trigger}</td>
                        <td className="py-2.5 px-3 text-[#e0e2ea] font-mono text-[11px]">{wf.duration}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              wf.status === 'Success'
                                ? 'bg-[#166534]/30 text-[#4ade80] border border-[#166534]'
                                : 'bg-red-950/40 text-red-300 border border-red-800/80'
                            }`}
                          >
                            {wf.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() =>
                                setActiveDrawer({
                                  title: `Execution Trace: ${wf.name}`,
                                  type: 'trace',
                                  data: {
                                    workflow: wf.name,
                                    tenant: wf.tenant,
                                    steps: [
                                      '1. Initializing Graph OAuth2 bearer token...',
                                      '2. Polling endpoint /v1.0/security/alerts...',
                                      '3. Delta check: 0 new alerts detected.',
                                      '4. Execution complete in ' + wf.duration,
                                    ],
                                  },
                                })
                              }
                              className="px-2 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] text-[10.5px] rounded border border-[#404752] cursor-pointer"
                            >
                              Trace
                            </button>
                            <button
                              onClick={() =>
                                onShowToast?.(
                                  'info',
                                  'Workflow Re-Triggered',
                                  `Dispatched manual execution for ${wf.name}.`
                                )
                              }
                              className="px-2 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] text-[10.5px] rounded border border-[#404752] cursor-pointer"
                            >
                              Re-Run
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
        {/* TAB 6: DEAD LETTER QUEUE (DLQ) */}
        {/* ----------------------------------------------------------------------- */}
        {activeTab === 'dlq' && (
          <div className="space-y-6">
            <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 space-y-1 shadow-sm">
              <h3 className="font-bold text-[#e0e2ea] text-sm flex items-center gap-2">
                <AlertOctagon className="w-4 h-4 text-red-400" />
                <span>Dead Letter Queue (DLQ) — Failed Graph API Calls & Webhook Exceptions</span>
              </h3>
              <p className="text-xs text-[#8a919e]">
                Failed workflow dispatches, rate-limited Graph API queries, or scope exceptions held for manual replay.
              </p>
            </div>

            <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 space-y-3 shadow-sm">
              {dlqItems.length === 0 ? (
                <div className="py-12 text-center text-[#8a919e] text-xs space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-[#4ade80] mx-auto" />
                  <p className="font-bold text-[#e0e2ea]">Dead Letter Queue Clear</p>
                  <p>All Graph API requests and webhooks are executing without errors.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#404752] text-[#8a919e] font-mono uppercase text-[10px]">
                        <th className="py-2.5 px-3">Message ID & Origin</th>
                        <th className="py-2.5 px-3">Target Tenant</th>
                        <th className="py-2.5 px-3">Failure Reason</th>
                        <th className="py-2.5 px-3">Retries</th>
                        <th className="py-2.5 px-3 text-right">DLQ Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#404752]/60 font-sans">
                      {dlqItems.map((dlq) => (
                        <tr key={dlq.id} className="hover:bg-[#272a30]/50 transition-colors">
                          <td className="py-2.5 px-3">
                            <div className="font-mono font-bold text-red-400">{dlq.id}</div>
                            <div className="text-[10px] text-[#8a919e] font-mono">{dlq.endpoint}</div>
                          </td>
                          <td className="py-2.5 px-3 text-[#a3c9ff] font-mono text-[11px]">{dlq.tenant}</td>
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-[#e0e2ea]">{dlq.reason}</div>
                            <div className="text-[10px] text-[#8a919e] font-mono">{dlq.timestamp}</div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-amber-300 text-[11px]">{dlq.retries} / 5</td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() =>
                                  setActiveDrawer({
                                    title: `Stack Trace: ${dlq.id}`,
                                    type: 'trace',
                                    data: {
                                      id: dlq.id,
                                      reason: dlq.reason,
                                      stackTrace: dlq.stackTrace,
                                      payload: dlq.payload,
                                    },
                                  })
                                }
                                className="px-2 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] text-[10.5px] rounded border border-[#404752] cursor-pointer"
                              >
                                Stack Trace
                              </button>
                              <button
                                onClick={() => handlePurgeDlq(dlq.id)}
                                className="px-2 py-1 bg-[#272a30] hover:bg-[#31353b] text-red-300 text-[10.5px] rounded border border-[#404752] cursor-pointer"
                              >
                                Purge
                              </button>
                              <button
                                onClick={() => handleReplayDlq(dlq.id)}
                                className="px-2.5 py-1 bg-[#0078d4] hover:bg-[#0060ab] text-white text-[10.5px] font-bold rounded shadow-sm transition-all cursor-pointer flex items-center gap-1"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Replay</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------------- */}
        {/* TAB 7: DATA RIGHTS & PRIVACY (DSAR) */}
        {/* ----------------------------------------------------------------------- */}
        {activeTab === 'dsar' && (
          <div className="space-y-6">
            <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 space-y-1 shadow-sm">
              <h3 className="font-bold text-[#e0e2ea] text-sm flex items-center gap-2">
                <Database className="w-4 h-4 text-purple-400" />
                <span>Data Subject Access Requests (DSAR) & GDPR / CCPA Compliance Engine</span>
              </h3>
              <p className="text-xs text-[#8a919e]">
                Process tenant data exports, audit log purges, and regulatory compliance certificate requests.
              </p>
            </div>

            <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 space-y-3 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#404752] text-[#8a919e] font-mono uppercase text-[10px]">
                      <th className="py-2.5 px-3">Request ID & Type</th>
                      <th className="py-2.5 px-3">Target Client Tenant</th>
                      <th className="py-2.5 px-3">Requested By</th>
                      <th className="py-2.5 px-3">Date Submitted</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Compliance Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/60 font-sans">
                    {dsarRequests.map((dsar) => (
                      <tr key={dsar.id} className="hover:bg-[#272a30]/50 transition-colors">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-[#e0e2ea]">{dsar.type}</div>
                          <div className="text-[10px] text-purple-300 font-mono">{dsar.id}</div>
                        </td>
                        <td className="py-2.5 px-3 text-[#a3c9ff] font-mono text-[11px]">{dsar.tenant}</td>
                        <td className="py-2.5 px-3 text-[#e0e2ea]">{dsar.requestedBy}</td>
                        <td className="py-2.5 px-3 text-[#8a919e] font-mono text-[11px]">{dsar.dateSubmitted}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              dsar.status === 'Completed'
                                ? 'bg-[#166534]/30 text-[#4ade80] border border-[#166534]'
                                : dsar.status === 'Processing'
                                ? 'bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40'
                                : 'bg-amber-950/40 text-amber-300 border border-amber-800/60'
                            }`}
                          >
                            {dsar.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() =>
                                onShowToast?.(
                                  'success',
                                  'DSAR Export Zip Generated',
                                  `Compiled encrypted archive for ${dsar.tenant}.`
                                )
                              }
                              className="px-2 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] text-[10.5px] rounded border border-[#404752] cursor-pointer"
                            >
                              Generate Zip
                            </button>
                            <button
                              onClick={() =>
                                onShowToast?.(
                                  'info',
                                  'Certificate Downloaded',
                                  `Compliance certificate PDF exported for ${dsar.id}.`
                                )
                              }
                              className="px-2 py-1 bg-[#272a30] hover:bg-[#31353b] text-purple-300 text-[10.5px] rounded border border-[#404752] cursor-pointer"
                            >
                              Certificate
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
      </div>

      {/* ========================================================================= */}
      {/* 4. INTERACTIVE MODALS & DRAWERS */}
      {/* ========================================================================= */}

      {/* Upgrade Plan Modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181c22] border border-[#404752] rounded-md max-w-lg w-full p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-400" />
                <h3 className="font-bold text-[#e0e2ea] text-base">Upgrade Monitored Tenant Capacity</h3>
              </div>
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="text-[#8a919e] hover:text-[#e0e2ea] p-1 rounded hover:bg-[#272a30]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-[#e0e2ea]">
              <p className="bg-amber-950/40 border border-amber-800/60 p-3 rounded text-amber-300 font-medium">
                ⚠️ Your MSP account currently manages <strong>{tenantCount} / {maxTenants}</strong> client tenants on the Basic Tier. Transition to Enhanced Tier to unlock up to 75 tenants.
              </p>

              <div className="p-4 rounded bg-[#101419] border border-[#404752] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#e0e2ea] text-sm">Enhanced Tier Plan</span>
                  <span className="font-mono text-purple-300 font-bold text-sm">$999.00 / month</span>
                </div>
                <ul className="space-y-1.5 text-[11px] text-[#8a919e]">
                  <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#4ade80]" /> Up to 75 Monitored Client Tenants</li>
                  <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#4ade80]" /> Advanced Intune Remote Wipe & Lock Operations</li>
                  <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#4ade80]" /> Priority 2-minute Graph API Sync Engine</li>
                </ul>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#404752] pt-4">
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="px-4 py-2 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] text-xs font-semibold rounded border border-[#404752]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowUpgradeModal(false);
                  onShowToast?.(
                    'success',
                    'Tier Upgrade Confirmed!',
                    'Your account has been upgraded to Enhanced Tier ($999/mo). Capacity expanded to 75 tenants.'
                  );
                }}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded shadow-sm cursor-pointer"
              >
                Confirm Upgrade to $999/mo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Payment Method Modal */}
      {showEditCardModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181c22] border border-[#404752] rounded-md max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-[#a3c9ff]" />
                <h3 className="font-bold text-[#e0e2ea] text-base">Update Payment Card</h3>
              </div>
              <button onClick={() => setShowEditCardModal(false)} className="text-[#8a919e] hover:text-[#e0e2ea]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[#8a919e] font-semibold block mb-1">Card Number</label>
                <input
                  type="text"
                  defaultValue="4242 •••• •••• 4242"
                  className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-2 text-[#e0e2ea] font-mono text-xs outline-none focus:border-[#0078d4]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#8a919e] font-semibold block mb-1">Expiry (MM/YY)</label>
                  <input
                    type="text"
                    defaultValue="08/28"
                    className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-2 text-[#e0e2ea] font-mono text-xs outline-none focus:border-[#0078d4]"
                  />
                </div>
                <div>
                  <label className="text-[#8a919e] font-semibold block mb-1">CVC</label>
                  <input
                    type="text"
                    defaultValue="•••"
                    className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-2 text-[#e0e2ea] font-mono text-xs outline-none focus:border-[#0078d4]"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-[#404752] pt-4">
              <button
                onClick={() => setShowEditCardModal(false)}
                className="px-4 py-2 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] text-xs font-semibold rounded border border-[#404752]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowEditCardModal(false);
                  onShowToast?.('success', 'Payment Method Updated', 'Default card details saved.');
                }}
                className="px-4 py-2 bg-[#0078d4] hover:bg-[#0060ab] text-white text-xs font-bold rounded cursor-pointer"
              >
                Save Payment Method
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Technician Modal */}
      {showInviteTechModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181c22] border border-[#404752] rounded-md max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-[#a3c9ff]" />
                <h3 className="font-bold text-[#e0e2ea] text-base">Invite MSP Staff Technician</h3>
              </div>
              <button onClick={() => setShowInviteTechModal(false)} className="text-[#8a919e] hover:text-[#e0e2ea]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[#8a919e] font-semibold block mb-1">Technician Name</label>
                <input
                  type="text"
                  placeholder="e.g. Jordan Lee"
                  className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-2 text-[#e0e2ea] text-xs outline-none focus:border-[#0078d4]"
                />
              </div>
              <div>
                <label className="text-[#8a919e] font-semibold block mb-1">Email Address</label>
                <input
                  type="email"
                  placeholder="j.lee@apexms.com"
                  className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-2 text-[#e0e2ea] text-xs outline-none focus:border-[#0078d4]"
                />
              </div>
              <div>
                <label className="text-[#8a919e] font-semibold block mb-1">Role Permission Tier</label>
                <select className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-2 text-[#e0e2ea] text-xs outline-none focus:border-[#0078d4]">
                  <option value="Tier 2 Tech">Tier 2 Tech (Remediation & Write Actions)</option>
                  <option value="Tier 1 Viewer">Tier 1 Viewer (Read-Only Portal Access)</option>
                  <option value="Global Admin">Global Admin (Full MSP Control)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-[#404752] pt-4">
              <button
                onClick={() => setShowInviteTechModal(false)}
                className="px-4 py-2 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] text-xs font-semibold rounded border border-[#404752]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowInviteTechModal(false);
                  onShowToast?.('success', 'Invitation Dispatched', 'Sent onboarding invite email.');
                }}
                className="px-4 py-2 bg-[#0078d4] hover:bg-[#0060ab] text-white text-xs font-bold rounded cursor-pointer"
              >
                Send Invite
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gated Action Audit Payload Modal */}
      {approvalToConfirm && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181c22] border border-amber-500/50 rounded-md max-w-xl w-full p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <div className="flex items-center gap-2 text-amber-400">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="font-bold text-[#e0e2ea] text-base">Confirm Gated Write Operation Execution</h3>
              </div>
              <button onClick={() => setApprovalToConfirm(null)} className="text-[#8a919e] hover:text-[#e0e2ea]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-amber-950/40 border border-amber-800/60 p-3 rounded text-amber-200">
                <p className="font-bold">Target Tenant: {approvalToConfirm.tenant}</p>
                <p>Action: {approvalToConfirm.action}</p>
                <p>Ticket Reference: {approvalToConfirm.ticketId}</p>
              </div>

              <div>
                <label className="text-[#8a919e] font-semibold block mb-1 font-mono">Graph API Dispatch Payload</label>
                <pre className="bg-[#101419] p-3 rounded border border-[#404752] font-mono text-[11px] text-[#4ade80] overflow-x-auto max-h-40">
                  {JSON.stringify(approvalToConfirm.payload, null, 2)}
                </pre>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-[#404752] pt-4">
              <button
                onClick={() => setApprovalToConfirm(null)}
                className="px-4 py-2 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] text-xs font-semibold rounded border border-[#404752]"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmApproval}
                className="px-4 py-2 bg-[#166534] hover:bg-[#15803d] text-white text-xs font-bold rounded shadow-sm cursor-pointer"
              >
                Authorize & Execute Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JSON / Trace Slide-Out Drawer */}
      {activeDrawer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end">
          <div className="bg-[#181c22] border-l border-[#404752] w-full max-w-md h-full p-6 flex flex-col space-y-4 shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-[#a3c9ff]" />
                <h3 className="font-bold text-[#e0e2ea] text-sm">{activeDrawer.title}</h3>
              </div>
              <button
                onClick={() => setActiveDrawer(null)}
                className="text-[#8a919e] hover:text-[#e0e2ea] p-1 rounded hover:bg-[#272a30]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto font-mono text-xs">
              <pre className="bg-[#101419] p-4 rounded border border-[#404752] text-[#4ade80] whitespace-pre-wrap leading-relaxed">
                {JSON.stringify(activeDrawer.data, null, 2)}
              </pre>
            </div>

            <div className="shrink-0 border-t border-[#404752] pt-3 flex justify-end">
              <button
                onClick={() => setActiveDrawer(null)}
                className="px-4 py-2 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] text-xs font-semibold rounded border border-[#404752]"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

