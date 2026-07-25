// @ts-nocheck
import React, { useState, useMemo } from 'react';
import {
  ShieldCheck,
  Lock,
  CheckCircle2,
  XCircle,
  Clock,
  UserCheck,
  AlertTriangle,
  KeyRound,
  Zap,
  Search,
  RefreshCw,
  FileText,
  Ticket,
  Code2,
  ArrowRight,
  Sparkles,
  ChevronRight,
  History,
  Building2,
  X,
  Check,
  ShieldAlert,
  Settings,
  User,
  SlidersHorizontal,
  FileCode,
  Layers,
  AlertCircle,
  Info
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tenant } from '../types';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type SafetyTier = 'tier_1_safe' | 'tier_2_gated' | 'tier_3_critical';
export type WorkloadCategory = 'Identity' | 'ConditionalAccess' | 'Intune' | 'Exchange' | 'PIM' | 'Governance';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  notes?: string;
  cryptoHash?: string;
}

export interface ApprovalRequest {
  id: string;
  requestCode: string;
  title: string;
  category: WorkloadCategory;
  safetyTier: SafetyTier;
  tenantId: string;
  tenantName: string;
  requesterUpn: string;
  targetResource: string;
  psaTicketId: string;
  justification: string;
  ttlRemainingSeconds: number; // TTL countdown in seconds
  createdAt: string;
  status: ApprovalStatus;
  actionId: string;
  graphEndpoint: string;
  proposedPayload: Record<string, any>;
  impactAnalysis: string;
  dualCustodyRequired: boolean;
  requiredApproversCount: number;
  currentSignaturesCount: number;
  auditTrail: AuditLogEntry[];
}

interface ApprovalsConsoleProps {
  tenants?: Tenant[];
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
}

// ============================================================================
// INITIAL MOCK APPROVAL DATA
// ============================================================================

const INITIAL_APPROVAL_REQUESTS: ApprovalRequest[] = [
  {
    id: 'apr-101',
    requestCode: 'APR-2026-089',
    title: 'Remote Wipe Executive Laptop (Intune Managed Device)',
    category: 'Intune',
    safetyTier: 'tier_3_critical',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    requesterUpn: 'tech.alex@msp.com',
    targetResource: 'Device: APEX-LT-9942 (User: CEO John Doe)',
    psaTicketId: 'HaloPSA #TK-99412',
    justification: 'Device lost at airport lounge. Executive requested urgent wipe per Incident Response SOP-IR-04.',
    ttlRemainingSeconds: 860, // ~14 mins (Expiring soon)
    createdAt: 'Today, 08:12 AM',
    status: 'pending',
    actionId: 'act-intune-remote-wipe',
    graphEndpoint: 'POST /deviceManagement/managedDevices/device-9942/wipe',
    proposedPayload: {
      keepEnrollmentData: false,
      keepUserData: false,
      macOsUnlockCode: 'FORCE-WIPE-098',
      reason: 'Stolen/Lost Executive Hardware Asset'
    },
    impactAnalysis: 'CRITICAL IMPACT: Permanently erases all local OS drives, user documents, and enterprise data on device APEX-LT-9942.',
    dualCustodyRequired: true,
    requiredApproversCount: 2,
    currentSignaturesCount: 1, // Need 1 more (Dual custody)
    auditTrail: [
      { id: 'at-1', timestamp: '08:12 AM', actor: 'tech.alex@msp.com', action: 'Submitted Tier 3 Remote Wipe Request', notes: 'Attached HaloPSA ticket #TK-99412' },
      { id: 'at-2', timestamp: '08:15 AM', actor: 'arch.shane@msp.com', action: 'Primary Signature Signed (MSP Lead Architect)', cryptoHash: '0x8f9a2b...4e11' }
    ]
  },
  {
    id: 'apr-102',
    requestCode: 'APR-2026-092',
    title: 'Disable Break-Glass Conditional Access Emergency Bypass Rule',
    category: 'ConditionalAccess',
    safetyTier: 'tier_3_critical',
    tenantId: 't-2',
    tenantName: 'Vanguard Legal Partners',
    requesterUpn: 'sarah.m@msp.com',
    targetResource: 'CA Policy: CAP-Emergency-MFA-Bypass-v2',
    psaTicketId: 'HaloPSA #TK-99380',
    justification: 'Emergency travel window for Senior Partner completed. Deactivating temporary MFA exclusion.',
    ttlRemainingSeconds: 2400, // 40 mins
    createdAt: 'Today, 08:00 AM',
    status: 'pending',
    actionId: 'act-disable-ca-policy',
    graphEndpoint: 'PATCH /identity/conditionalAccess/policies/ca-pol-88392',
    proposedPayload: {
      state: 'disabled',
      grantControls: {
        operator: 'OR',
        builtInControls: ['mfa']
      },
      modifiedBy: 'ApprovalGateEngine'
    },
    impactAnalysis: 'Re-enables mandatory MFA enforcement across all Vanguard Legal partner accounts immediately.',
    dualCustodyRequired: true,
    requiredApproversCount: 2,
    currentSignaturesCount: 0,
    auditTrail: [
      { id: 'at-102-1', timestamp: '08:00 AM', actor: 'sarah.m@msp.com', action: 'Submitted CA Policy Disabling Approval Request' }
    ]
  },
  {
    id: 'apr-103',
    requestCode: 'APR-2026-085',
    title: 'Elevate Technician to Global Admin via PIM (4-Hour Duration)',
    category: 'PIM',
    safetyTier: 'tier_2_gated',
    tenantId: 't-3',
    tenantName: 'Apex Logistics & Freight',
    requesterUpn: 'tech.david@msp.com',
    targetResource: 'Role: Global Administrator (Privileged Identity Management)',
    psaTicketId: 'ConnectWise #CW-88410',
    justification: 'Required for emergency Exchange Online hybrid mail routing reconfiguration during outage.',
    ttlRemainingSeconds: 3200,
    createdAt: 'Today, 07:30 AM',
    status: 'pending',
    actionId: 'act-pim-activate-role',
    graphEndpoint: 'POST /roleManagement/directory/roleAssignmentScheduleRequests',
    proposedPayload: {
      action: 'selfActivate',
      principalId: 'usr-tech-david-001',
      roleDefinitionId: '62e90394-69f5-4237-9190-012177145e10',
      duration: 'PT4H',
      reason: 'Exchange Hybrid Routing Repair #CW-88410'
    },
    impactAnalysis: 'Grants full Global Admin permissions across Apex Logistics tenant for exactly 240 minutes.',
    dualCustodyRequired: false,
    requiredApproversCount: 1,
    currentSignaturesCount: 0,
    auditTrail: [
      { id: 'at-103-1', timestamp: '07:30 AM', actor: 'tech.david@msp.com', action: 'PIM Elevation Request Created' }
    ]
  },
  {
    id: 'apr-104',
    requestCode: 'APR-2026-078',
    title: 'Hard-Purge Terminated Executive Mailbox & OneDrive Hold',
    category: 'Exchange',
    safetyTier: 'tier_3_critical',
    tenantId: 't-4',
    tenantName: 'BioHealth Innovations',
    requesterUpn: 'compliance.lead@msp.com',
    targetResource: 'User: v.martinez@biohealth.io (Inaccessible Hold)',
    psaTicketId: 'HaloPSA #TK-99120',
    justification: 'Court-ordered GDPR right-to-be-forgotten compliance execution after legal retention period expiry.',
    ttlRemainingSeconds: 5100,
    createdAt: 'Today, 06:45 AM',
    status: 'pending',
    actionId: 'act-hard-delete-user',
    graphEndpoint: 'DELETE /users/v.martinez@biohealth.io',
    proposedPayload: {
      forcePermanentDeletion: true,
      legalHoldBypassCode: 'GDPR-EU-2026-9921'
    },
    impactAnalysis: 'IRREVERSIBLE ACTION: Permanently purges user mailbox, OneDrive archives, and identity records.',
    dualCustodyRequired: true,
    requiredApproversCount: 2,
    currentSignaturesCount: 1,
    auditTrail: [
      { id: 'at-104-1', timestamp: '06:45 AM', actor: 'compliance.lead@msp.com', action: 'Submitted Permanent Purge Request' },
      { id: 'at-104-2', timestamp: '07:15 AM', actor: 'ciso.biohealth@biohealth.io', action: 'Client CISO Dual-Custody Signature Approved', cryptoHash: '0x3c7d1e...99a2' }
    ]
  },
  {
    id: 'apr-105',
    requestCode: 'APR-2026-060',
    title: 'Batch Revoke Refresh Tokens for Compromised Marketing Team',
    category: 'Identity',
    safetyTier: 'tier_2_gated',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    requesterUpn: 'sec.analyst@msp.com',
    targetResource: 'Group: Marketing-Dept-All (14 Users)',
    psaTicketId: 'HaloPSA #TK-99050',
    justification: 'Phishing email clicked by marketing coordinator. Precautionary session revocation across department.',
    ttlRemainingSeconds: 0, // Expired
    createdAt: 'Yesterday, 04:00 PM',
    status: 'expired',
    actionId: 'act-revoke-batch-tokens',
    graphEndpoint: 'POST /users/bulkRevokeSignInSessions',
    proposedPayload: {
      userIds: ['usr-mkt-01', 'usr-mkt-02', 'usr-mkt-03', 'usr-mkt-04'],
      reason: 'Phishing Token Invalidation'
    },
    impactAnalysis: 'Forces 14 marketing employees to re-authenticate with MFA on next web or Outlook access.',
    dualCustodyRequired: false,
    requiredApproversCount: 1,
    currentSignaturesCount: 0,
    auditTrail: [
      { id: 'at-105-1', timestamp: 'Yesterday 04:00 PM', actor: 'sec.analyst@msp.com', action: 'Request Logged' },
      { id: 'at-105-2', timestamp: 'Yesterday 06:00 PM', actor: 'System Gate Engine', action: 'TTL Expired', notes: 'TTL expired without signature. Request marked EXPIRED.' }
    ]
  },
  {
    id: 'apr-106',
    requestCode: 'APR-2026-055',
    title: 'Bulk Convert Inactive User Mailboxes to Shared Mailboxes',
    category: 'Exchange',
    safetyTier: 'tier_2_gated',
    tenantId: 't-5',
    tenantName: 'Meridian Capital Partners',
    requesterUpn: 'tech.alex@msp.com',
    targetResource: '8 Exited Employee Accounts',
    psaTicketId: 'HaloPSA #TK-98990',
    justification: 'Monthly license optimization workflow. Preserve mailbox contents without ongoing license charges.',
    ttlRemainingSeconds: 0,
    createdAt: 'Yesterday, 11:30 AM',
    status: 'approved',
    actionId: 'act-convert-shared-mailbox',
    graphEndpoint: 'POST /admin/exchange/mailboxes/convertType',
    proposedPayload: {
      mailboxIds: ['mbx-01', 'mbx-02', 'mbx-03'],
      targetType: 'Shared',
      removeLicenseAfterConversion: true
    },
    impactAnalysis: 'Saves $176/mo in M365 E3 licensing while maintaining mailbox searchability.',
    dualCustodyRequired: false,
    requiredApproversCount: 1,
    currentSignaturesCount: 1,
    auditTrail: [
      { id: 'at-106-1', timestamp: 'Yesterday 11:30 AM', actor: 'tech.alex@msp.com', action: 'Request Created' },
      { id: 'at-106-2', timestamp: 'Yesterday 12:10 PM', actor: 'arch.shane@msp.com', action: 'Signed & Executed via Graph API', cryptoHash: '0x992a11...bb54' }
    ]
  }
];

// ============================================================================
// MAIN APPROVALS CONSOLE COMPONENT
// ============================================================================

export const ApprovalsConsole: React.FC<ApprovalsConsoleProps> = ({
  tenants = [],
  onShowToast
}) => {
  // Navigation View Sub-Tabs
  const [activeView, setActiveView] = useState<'queue' | 'history' | 'matrix'>('queue');

  // Filter Modes
  const [myApprovalsOnly, setMyApprovalsOnly] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [tenantFilter, setTenantFilter] = useState('ALL');
  const [safetyTierFilter, setSafetyTierFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Requests Data State
  const [requests, setRequests] = useState<ApprovalRequest[]>(INITIAL_APPROVAL_REQUESTS);
  const [selectedRequestId, setSelectedRequestId] = useState<string>('apr-101');

  // Digital Sign-Off Form State
  const [approverNotes, setApproverNotes] = useState('');
  const [confirmCheck, setConfirmCheck] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showDigitalSignatureModal, setShowDigitalSignatureModal] = useState(false);

  // Toast Helper
  const toast = (type: 'success' | 'info' | 'warning' | 'error', title: string, desc: string) => {
    if (onShowToast) onShowToast(type, title, desc);
  };

  // Currently Selected Request
  const selectedRequest = useMemo(() => {
    return requests.find(r => r.id === selectedRequestId) || requests[0];
  }, [requests, selectedRequestId]);

  // Governance KPI Totals
  const kpis = useMemo(() => {
    const pendingCount = requests.filter(r => r.status === 'pending').length;
    const criticalDualCustodyCount = requests.filter(r => r.safetyTier === 'tier_3_critical' && r.status === 'pending').length;
    const expiringSoonCount = requests.filter(r => r.status === 'pending' && r.ttlRemainingSeconds > 0 && r.ttlRemainingSeconds <= 900).length; // <15m
    const approvedTodayCount = requests.filter(r => r.status === 'approved').length;

    return {
      pendingCount,
      criticalDualCustodyCount,
      expiringSoonCount,
      approvedTodayCount
    };
  }, [requests]);

  // Filtered Requests
  const filteredRequests = useMemo(() => {
    return requests.filter(r => {
      // Filter My Approvals Mode
      if (myApprovalsOnly && r.status !== 'pending') return false;

      const matchesSearch =
        r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.requestCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.tenantName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.requesterUpn.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.targetResource.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.psaTicketId.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesTenant = tenantFilter === 'ALL' || r.tenantId === tenantFilter;
      const matchesTier = safetyTierFilter === 'ALL' || r.safetyTier === safetyTierFilter;
      const matchesCategory = categoryFilter === 'ALL' || r.category === categoryFilter;
      const matchesStatus = statusFilter === 'ALL' || r.status === statusFilter;

      return matchesSearch && matchesTenant && matchesTier && matchesCategory && matchesStatus;
    });
  }, [requests, myApprovalsOnly, searchTerm, tenantFilter, safetyTierFilter, categoryFilter, statusFilter]);

  // Digitally Sign and Execute Request
  const handleApproveRequest = () => {
    if (!selectedRequest) return;

    if (!confirmCheck) {
      toast('error', 'Confirmation Required', 'Please check the box confirming ticket authorization.');
      return;
    }

    setIsSigning(true);

    setTimeout(() => {
      setIsSigning(false);

      const generatedHash = `0x${Math.random().toString(16).substring(2, 10)}${Math.random().toString(16).substring(2, 10)}`;

      setRequests(prev => prev.map(r => {
        if (r.id === selectedRequest.id) {
          const newSignCount = r.currentSignaturesCount + 1;
          const isFullyApproved = newSignCount >= r.requiredApproversCount;

          return {
            ...r,
            currentSignaturesCount: newSignCount,
            status: isFullyApproved ? 'approved' : 'pending',
            auditTrail: [
              ...r.auditTrail,
              {
                id: `at-${Date.now()}`,
                timestamp: 'Just now',
                actor: 'Shane McCaw (Lead Architect)',
                action: isFullyApproved ? 'Final Dual-Custody Signature Signed & Graph API Executed' : `Signature ${newSignCount}/${r.requiredApproversCount} Signed`,
                notes: approverNotes || 'Digitally signed via Governance Portal.',
                cryptoHash: generatedHash
              }
            ]
          };
        }
        return r;
      }));

      setApproverNotes('');
      setConfirmCheck(false);
      setShowDigitalSignatureModal(false);

      if (selectedRequest.dualCustodyRequired && selectedRequest.currentSignaturesCount + 1 < selectedRequest.requiredApproversCount) {
        toast('info', 'Signature Recorded', `Signature 1 of ${selectedRequest.requiredApproversCount} logged. Awaiting second client CISO dual-custody sign-off.`);
      } else {
        toast('success', 'Request Approved & Executed', `Digital signature verified (${generatedHash}). Graph API action dispatched for ${selectedRequest.tenantName}.`);
      }
    }, 1200);
  };

  // Reject Request
  const handleRejectRequest = () => {
    if (!selectedRequest) return;

    if (!rejectReason.trim()) {
      toast('error', 'Rejection Reason Required', 'A rejection justification response is required to reject this request.');
      return;
    }

    setRequests(prev => prev.map(r => {
      if (r.id === selectedRequest.id) {
        return {
          ...r,
          status: 'rejected',
          auditTrail: [
            ...r.auditTrail,
            {
              id: `at-${Date.now()}`,
              timestamp: 'Just now',
              actor: 'Shane McCaw (Lead Architect)',
              action: 'Request REJECTED by Approver',
              notes: rejectReason.trim()
            }
          ]
        };
      }
      return r;
    }));

    setShowRejectModal(false);
    setRejectReason('');
    toast('warning', 'Request Rejected', `Approval request ${selectedRequest.requestCode} was marked rejected.`);
  };

  // Format TTL Timer Display
  const formatTtlClock = (seconds: number) => {
    if (seconds <= 0) {
      return { text: 'EXPIRED (TTL 0m)', isExpired: true };
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return {
      text: `⏱️ ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')} TTL`,
      isExpired: false
    };
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#090d16] text-[#e0e2ea] overflow-hidden font-sans">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & GOVERNANCE KPI TELEMETRY BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] p-4 shrink-0 space-y-4">
        
        {/* Title & Mode Control Options */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-[#0078d4]/20 to-purple-500/10 border border-[#0078d4]/40 rounded-lg">
              <ShieldCheck className="w-6 h-6 text-[#a3c9ff]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-[#f0f4f8] tracking-tight">Gated Approval &amp; Dual-Custody Console</h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40">
                  /portal/approvals
                </span>
              </div>
              <p className="text-xs text-[#8a919e]">
                Multi-signature authorization, cryptographic audit trails &amp; safety-gated Graph API write dispatches across managed tenants.
              </p>
            </div>
          </div>

          {/* Header Action Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            
            {/* Toggle Mode: Pending My Approval */}
            <button
              onClick={() => {
                setMyApprovalsOnly(!myApprovalsOnly);
                toast('info', 'Filter Mode Updated', myApprovalsOnly ? 'Showing all tenant request history.' : 'Filtering to open pending requests only.');
              }}
              className={cn(
                "px-3 py-2 rounded text-xs font-semibold transition-all flex items-center gap-1.5 border",
                myApprovalsOnly
                  ? "bg-[#0078d4] text-white border-[#0078d4] font-bold shadow-md"
                  : "bg-[#181c22] text-[#8a919e] hover:text-[#e0e2ea] border-[#404752]"
              )}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>{myApprovalsOnly ? 'Pending My Approval (Active)' : 'Filter: Pending My Sign-Off'}</span>
            </button>

            <button
              onClick={() => setActiveView('matrix')}
              className="flex items-center gap-1.5 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#e0e2ea] text-xs font-semibold px-3 py-2 rounded transition-all"
            >
              <Settings className="w-3.5 h-3.5 text-purple-400" />
              <span>Safety Tier Matrix</span>
            </button>

            <button
              onClick={() => {
                toast('info', 'Refreshing Stream', 'Checking for new dual-custody requests & TTL expirations...');
              }}
              className="p-2 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#e0e2ea] rounded transition-colors"
              title="Refresh Stream"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 4 Governance KPI Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          {/* KPI 1 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Pending Approvals</span>
              <div className="text-xl font-bold font-mono text-blue-400 flex items-baseline gap-1">
                <span>{kpis.pendingCount} Open</span>
                <span className="text-xs font-sans text-[#8a919e]">Requests</span>
              </div>
            </div>
            <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-md">
              <Clock className="w-5 h-5 text-blue-400" />
            </div>
          </div>

          {/* KPI 2 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Tier 3 Critical (Dual Custody)</span>
              <div className="text-xl font-bold font-mono text-red-400 flex items-baseline gap-2">
                <span>{kpis.criticalDualCustodyCount} Critical</span>
                <span className="text-[10px] font-mono font-bold text-red-300 bg-red-500/20 px-1.5 py-0.5 rounded border border-red-500/30">
                  DUAL-SIGN
                </span>
              </div>
            </div>
            <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-md">
              <Lock className="w-5 h-5 text-red-400" />
            </div>
          </div>

          {/* KPI 3 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">TTL Expiring Soon (&lt;15m)</span>
              <div className="text-xl font-bold font-mono text-amber-400 flex items-baseline gap-2">
                <span>{kpis.expiringSoonCount} Expiring</span>
                <span className="text-[10px] font-mono font-bold text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/30">
                  URGENT
                </span>
              </div>
            </div>
            <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-md">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
          </div>

          {/* KPI 4 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Approved &amp; Dispatched Today</span>
              <div className="text-xl font-bold font-mono text-emerald-400 flex items-baseline gap-2">
                <span>{kpis.approvedTodayCount} Executed</span>
                <span className="text-xs font-sans text-emerald-400">100% Signed</span>
              </div>
            </div>
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-md">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
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
            onClick={() => setActiveView('queue')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeView === 'queue'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Approval Queue ({filteredRequests.length})</span>
          </button>

          <button
            onClick={() => setActiveView('history')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeView === 'history'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <History className="w-3.5 h-3.5 text-purple-400" />
            <span>Audit Trail &amp; Sign-Off History</span>
          </button>

          <button
            onClick={() => setActiveView('matrix')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeView === 'matrix'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <Settings className="w-3.5 h-3.5 text-emerald-400" />
            <span>Safety Tier Policies</span>
          </button>
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-2 flex-wrap flex-1 justify-end">
          
          {/* Search Box */}
          <div className="relative min-w-[200px] max-w-[260px] flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e]" />
            <input
              type="text"
              placeholder="Search Request, Tenant, Requester..."
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

          {/* Safety Tier Filter */}
          <select
            value={safetyTierFilter}
            onChange={(e) => setSafetyTierFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Safety Tier: All</option>
            <option value="tier_3_critical">Tier 3 (Critical Dual-Custody) 🔴</option>
            <option value="tier_2_gated">Tier 2 (Gated Sign-Off) 🟡</option>
            <option value="tier_1_safe">Tier 1 (Safe Auto-Approve) 🟢</option>
          </select>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Category: All</option>
            <option value="Intune">Intune &amp; Devices</option>
            <option value="ConditionalAccess">Conditional Access</option>
            <option value="PIM">PIM &amp; Admin Roles</option>
            <option value="Exchange">Exchange &amp; Mail</option>
            <option value="Identity">Identity &amp; Accounts</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Status: All</option>
            <option value="pending">Pending Approval 🔵</option>
            <option value="approved">Approved &amp; Executed 🟢</option>
            <option value="rejected">Rejected 🔴</option>
            <option value="expired">Expired ⚪</option>
          </select>

          {(searchTerm || safetyTierFilter !== 'ALL' || categoryFilter !== 'ALL' || statusFilter !== 'ALL') && (
            <button
              onClick={() => {
                setSearchTerm('');
                setSafetyTierFilter('ALL');
                setCategoryFilter('ALL');
                setStatusFilter('ALL');
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
        {/* VIEW 1: SPLIT-PANE PENDING APPROVAL QUEUE (60% QUEUE | 40% DOCUMENT INSPECTOR) */}
        {/* ======================================================================= */}
        {activeView === 'queue' && (
          <div className="w-full h-full flex gap-4 overflow-hidden">
            
            {/* LEFT PANE (60% WIDTH): MASTER APPROVAL REQUEST TABLE */}
            <div className="w-full lg:w-[60%] bg-[#101419] border border-[#404752] rounded-xl overflow-hidden flex flex-col shadow-xl">
              
              <div className="p-3 bg-[#181c22] border-b border-[#404752] flex items-center justify-between text-xs shrink-0">
                <span className="font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#a3c9ff]" />
                  <span>Pending Authorization Queue ({filteredRequests.length} Work Items)</span>
                </span>
                <span className="text-[#8a919e] text-[11px]">TTL Countdown Engine Active</span>
              </div>

              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left text-xs text-[#e0e2ea] border-collapse">
                  <thead className="bg-[#141820] text-[#8a919e] font-mono uppercase text-[10px] sticky top-0 border-b border-[#404752] z-10">
                    <tr>
                      <th className="p-3">Safety Tier</th>
                      <th className="p-3">Request Code &amp; Action Title</th>
                      <th className="p-3">Tenant Name</th>
                      <th className="p-3">TTL Remaining</th>
                      <th className="p-3">Signatures</th>
                      <th className="p-3 text-right">Review Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/40">
                    {filteredRequests.map(req => {
                      const isSelected = req.id === selectedRequestId;
                      const ttl = formatTtlClock(req.ttlRemainingSeconds);

                      let tierBadge = 'bg-blue-500/10 text-blue-400 border-blue-500/30';
                      if (req.safetyTier === 'tier_2_gated') tierBadge = 'bg-amber-500/10 text-amber-400 border-amber-500/30';
                      if (req.safetyTier === 'tier_3_critical') tierBadge = 'bg-red-500/20 text-red-400 border-red-500/50 animate-pulse';

                      return (
                        <tr
                          key={req.id}
                          onClick={() => setSelectedRequestId(req.id)}
                          className={cn(
                            "hover:bg-[#181c22] transition-colors cursor-pointer",
                            isSelected ? "bg-[#1a212d]" : "",
                            req.status === 'expired' ? "opacity-50" : ""
                          )}
                        >
                          <td className="p-3">
                            <span className={cn("px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase border", tierBadge)}>
                              {req.safetyTier === 'tier_3_critical' ? 'TIER 3 CRITICAL' : req.safetyTier === 'tier_2_gated' ? 'TIER 2 GATED' : 'TIER 1 SAFE'}
                            </span>
                          </td>

                          <td className="p-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[11px] text-[#8a919e]">{req.requestCode}</span>
                              <span className="text-[#404752]">&bull;</span>
                              <span className="text-[11px] text-[#a3c9ff] font-mono">{req.category}</span>
                            </div>
                            <div className="font-bold text-[#f0f4f8] line-clamp-1 mt-0.5">{req.title}</div>
                          </td>

                          <td className="p-3">
                            <div className="font-semibold text-[#f0f4f8] flex items-center gap-1">
                              <Building2 className="w-3 h-3 text-[#a3c9ff]" />
                              <span>{req.tenantName}</span>
                            </div>
                            <div className="text-[10px] text-[#8a919e] font-mono">By: {req.requesterUpn}</div>
                          </td>

                          <td className="p-3 font-mono">
                            <span className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 w-fit",
                              ttl.isExpired ? "bg-gray-500/20 text-gray-400 border border-gray-500/30" : "bg-[#181c22] border border-[#404752] text-amber-300"
                            )}>
                              <span>{ttl.text}</span>
                            </span>
                          </td>

                          <td className="p-3 font-mono text-[11px]">
                            <span className={cn(
                              "px-2 py-0.5 rounded font-bold border",
                              req.currentSignaturesCount >= req.requiredApproversCount
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                : "bg-amber-500/10 text-amber-300 border-amber-500/30"
                            )}>
                              {req.currentSignaturesCount} / {req.requiredApproversCount} Signatures
                            </span>
                          </td>

                          <td className="p-3 text-right">
                            {req.status === 'approved' ? (
                              <span className="text-[10px] font-mono font-bold text-emerald-400 flex items-center justify-end gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Executed</span>
                              </span>
                            ) : req.status === 'rejected' ? (
                              <span className="text-[10px] font-mono font-bold text-red-400 flex items-center justify-end gap-1">
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Rejected</span>
                              </span>
                            ) : req.status === 'expired' ? (
                              <span className="text-[10px] font-mono font-bold text-gray-400">
                                Expired
                              </span>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); setSelectedRequestId(req.id); }}
                                className="px-2.5 py-1 bg-[#0078d4] hover:bg-[#006cbd] text-white rounded text-[11px] font-mono font-bold shadow-sm"
                              >
                                Review Sign
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

            {/* RIGHT PANE (40% WIDTH): APPROVAL DOCUMENT & PAYLOAD INSPECTOR */}
            {selectedRequest && (
              <div className="hidden lg:flex flex-col w-[40%] bg-[#101419] border border-[#404752] rounded-xl overflow-hidden shadow-2xl">
                
                {/* Inspector Header */}
                <div className="p-3.5 bg-[#181c22] border-b border-[#404752] flex items-center justify-between shrink-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/30">
                        {selectedRequest.requestCode}
                      </span>
                      <span className="text-xs font-mono text-[#8a919e]">{selectedRequest.psaTicketId}</span>
                    </div>
                    <h3 className="text-xs font-bold text-[#f0f4f8] mt-1 leading-snug">
                      {selectedRequest.title}
                    </h3>
                  </div>

                  <span className={cn(
                    "px-2 py-1 rounded text-[10px] font-mono font-bold uppercase border",
                    selectedRequest.safetyTier === 'tier_3_critical' ? "bg-red-500/20 text-red-300 border-red-500/40" : "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  )}>
                    {selectedRequest.safetyTier === 'tier_3_critical' ? 'Tier 3 Dual-Custody' : 'Tier 2 Gated'}
                  </span>
                </div>

                {/* Inspector Scroll Workspace */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                  
                  {/* SECTION A: ACTION CONTEXT & IMPACT ANALYSIS */}
                  <div className="bg-[#181c22] border border-[#404752] rounded-lg p-3 space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] font-mono text-[#8a919e]">
                      <span>Target Tenant: <strong className="text-[#f0f4f8]">{selectedRequest.tenantName}</strong></span>
                      <span className="text-[#a3c9ff] font-bold">Category: {selectedRequest.category}</span>
                    </div>

                    <div className="bg-[#101419] p-2.5 rounded border border-[#404752] space-y-1">
                      <div className="text-[11px] font-bold text-[#f0f4f8]">
                        Target Entity: <span className="text-[#a3c9ff] font-mono">{selectedRequest.targetResource}</span>
                      </div>
                      <div className="text-[11px] text-[#8a919e]">
                        Requested By: <span className="text-white font-mono">{selectedRequest.requesterUpn}</span> ({selectedRequest.createdAt})
                      </div>
                      <p className="text-xs text-[#e0e2ea] pt-1 leading-relaxed">
                        <strong>Justification:</strong> {selectedRequest.justification}
                      </p>
                    </div>

                    {/* Impact Box */}
                    <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded text-[11px] text-red-300 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                      <div>
                        <strong className="block font-mono text-red-200">System Security Impact:</strong>
                        <span>{selectedRequest.impactAnalysis}</span>
                      </div>
                    </div>
                  </div>

                  {/* SECTION B: PROPOSED GRAPH API PAYLOAD (JSON DIFF) */}
                  <div className="bg-[#181c22] border border-[#404752] rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="font-bold text-[#f0f4f8] uppercase tracking-wider flex items-center gap-1.5">
                        <Code2 className="w-4 h-4 text-purple-400" />
                        <span>Proposed Graph API Payload JSON</span>
                      </span>
                      <span className="text-[10px] text-emerald-400 font-mono">POST / Graph API</span>
                    </div>

                    <div className="bg-[#090d16] border border-[#404752] rounded p-2.5 space-y-2">
                      <code className="block text-[10px] font-mono text-[#a3c9ff] font-bold">
                        {selectedRequest.graphEndpoint}
                      </code>
                      <pre className="text-[10px] font-mono text-emerald-400 overflow-x-auto p-2 bg-[#101419] rounded border border-[#404752]">
                        {JSON.stringify(selectedRequest.proposedPayload, null, 2)}
                      </pre>
                    </div>
                  </div>

                  {/* SECTION C: AUTHORIZATION SIGN-OFF BOX */}
                  {selectedRequest.status === 'pending' ? (
                    <div className="bg-[#181c22] border border-[#0078d4]/40 rounded-lg p-3.5 space-y-3">
                      <h4 className="font-mono text-xs font-bold text-[#f0f4f8] uppercase tracking-wider flex items-center gap-1.5">
                        <KeyRound className="w-4 h-4 text-[#a3c9ff]" />
                        <span>Digital Signature Authorization</span>
                      </h4>

                      <div className="space-y-1.5">
                        <label className="text-[11px] text-[#8a919e] font-mono">Approver Governance Notes:</label>
                        <textarea
                          rows={2}
                          placeholder="Log reason for approval or change control confirmation..."
                          value={approverNotes}
                          onChange={(e) => setApproverNotes(e.target.value)}
                          className="w-full bg-[#101419] border border-[#404752] rounded p-2 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
                        />
                      </div>

                      <label className="flex items-start gap-2 cursor-pointer p-2 bg-[#101419] border border-[#404752] rounded hover:border-[#606a7a]">
                        <input
                          type="checkbox"
                          checked={confirmCheck}
                          onChange={(e) => setConfirmCheck(e.target.checked)}
                          className="mt-0.5 accent-[#0078d4]"
                        />
                        <span className="text-[11px] text-[#e0e2ea] leading-tight">
                          I confirm I have verified this action against client ticket <strong className="text-[#a3c9ff]">{selectedRequest.psaTicketId}</strong> and authorize immediate execution.
                        </span>
                      </label>

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => {
                            if (!confirmCheck) {
                              toast('error', 'Confirmation Required', 'Please check the authorization checkbox first.');
                              return;
                            }
                            setShowDigitalSignatureModal(true);
                          }}
                          disabled={isSigning || !confirmCheck}
                          className="flex-1 py-2 bg-gradient-to-r from-[#0078d4] to-purple-600 hover:from-[#006cbd] hover:to-purple-500 text-white font-mono font-bold text-xs rounded transition-all flex items-center justify-center gap-1.5 shadow-lg disabled:opacity-50"
                        >
                          <Lock className={cn("w-3.5 h-3.5", isSigning ? "animate-spin" : "")} />
                          <span>{isSigning ? 'Signing & Dispatching...' : '🔒 Digitally Sign & Execute'}</span>
                        </button>

                        <button
                          onClick={() => setShowRejectModal(true)}
                          className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-mono text-xs font-bold rounded"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-[#181c22] border border-[#404752] rounded-lg p-3 space-y-2">
                      <div className="font-mono text-xs font-bold text-[#f0f4f8] flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        <span>Sign-Off Execution Status: {selectedRequest.status.toUpperCase()}</span>
                      </div>
                      <div className="space-y-1">
                        {selectedRequest.auditTrail.map(at => (
                          <div key={at.id} className="p-2 bg-[#101419] border border-[#404752] rounded text-[11px]">
                            <div className="flex justify-between font-mono text-[#8a919e]">
                              <span className="text-[#a3c9ff] font-bold">{at.actor}</span>
                              <span>{at.timestamp}</span>
                            </div>
                            <p className="text-[#e0e2ea] font-semibold mt-0.5">{at.action}</p>
                            {at.cryptoHash && (
                              <div className="text-[10px] font-mono text-purple-300 mt-0.5">Hash: {at.cryptoHash}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>

              </div>
            )}

          </div>
        )}

        {/* ======================================================================= */}
        {/* VIEW 2: APPROVAL AUDIT TRAIL & LOG HISTORY */}
        {/* ======================================================================= */}
        {activeView === 'history' && (
          <div className="w-full h-full bg-[#101419] border border-[#404752] rounded-xl overflow-hidden flex flex-col shadow-xl">
            <div className="p-4 bg-[#181c22] border-b border-[#404752] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-purple-400" />
                <h2 className="text-sm font-bold text-[#f0f4f8]">Immutable Governance Audit Log &amp; Cryptographic Ledger</h2>
              </div>
              <span className="text-xs font-mono text-[#8a919e]">Signed Workflows &amp; Dispatched Graph Requests</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {requests.map(r => (
                <div key={r.id} className="bg-[#181c22] border border-[#404752] rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[#a3c9ff]">{r.requestCode}</span>
                      <span className="text-[#f0f4f8] font-bold">{r.title}</span>
                      <span className="text-[#8a919e]">({r.tenantName})</span>
                    </div>
                    <span className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border",
                      r.status === 'approved' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                      r.status === 'rejected' ? "bg-red-500/10 text-red-400 border-red-500/30" : "bg-gray-500/10 text-gray-400 border-gray-500/30"
                    )}>
                      {r.status}
                    </span>
                  </div>

                  <div className="bg-[#101419] p-2.5 rounded border border-[#404752] space-y-1.5 text-xs">
                    <div className="font-mono text-[11px] text-purple-300">Target Endpoint: {r.graphEndpoint}</div>
                    <div className="space-y-1">
                      {r.auditTrail.map(at => (
                        <div key={at.id} className="flex items-start justify-between text-[11px] pt-1 border-t border-[#404752]/40">
                          <div>
                            <span className="font-mono font-bold text-[#e0e2ea]">{at.actor}: </span>
                            <span className="text-[#8a919e]">{at.action}</span>
                            {at.notes && <p className="text-[10px] text-[#8a919e] italic">{at.notes}</p>}
                          </div>
                          <span className="font-mono text-[10px] text-[#8a919e]">{at.timestamp}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ======================================================================= */}
        {/* VIEW 3: SAFETY TIER RULES & AUTHORIZATION MATRIX */}
        {/* ======================================================================= */}
        {activeView === 'matrix' && (
          <div className="w-full h-full bg-[#101419] border border-[#404752] rounded-xl overflow-hidden flex flex-col shadow-xl p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <div>
                <h2 className="text-sm font-bold text-[#f0f4f8] flex items-center gap-2">
                  <Settings className="w-4 h-4 text-emerald-400" />
                  <span>Tenant Safety Tier Policies &amp; Approval Matrix</span>
                </h2>
                <p className="text-xs text-[#8a919e] mt-0.5">
                  Configure required authorization sign-offs based on operational risk tiers.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 overflow-y-auto">
              {/* Tier 1 */}
              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    TIER 1 - SAFE
                  </span>
                  <span className="text-xs text-emerald-400 font-bold">Auto-Approved</span>
                </div>
                <h3 className="text-xs font-bold text-[#f0f4f8]">Standard Low-Risk Read &amp; Basic Ops</h3>
                <p className="text-xs text-[#8a919e]">
                  User profile updates, license view, telemetry refreshes, and standard report generation.
                </p>
                <ul className="text-xs text-[#e0e2ea] space-y-1 font-mono text-[11px] list-disc list-inside">
                  <li>No PSA Ticket Required</li>
                  <li>Instant Execution</li>
                  <li>0 Signatures Required</li>
                </ul>
              </div>

              {/* Tier 2 */}
              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
                    TIER 2 - GATED
                  </span>
                  <span className="text-xs text-amber-300 font-bold">Single Sign-Off</span>
                </div>
                <h3 className="text-xs font-bold text-[#f0f4f8]">Medium-Risk Operational Changes</h3>
                <p className="text-xs text-[#8a919e]">
                  MFA resets, inbox forwarding rule removal, mailbox conversions, and session token revocations.
                </p>
                <ul className="text-xs text-[#e0e2ea] space-y-1 font-mono text-[11px] list-disc list-inside">
                  <li>Mandatory PSA Ticket Reference</li>
                  <li>L2/L3 Tech Signature Required</li>
                  <li>1-Hour TTL Window</li>
                </ul>
              </div>

              {/* Tier 3 */}
              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40">
                    TIER 3 - CRITICAL
                  </span>
                  <span className="text-xs text-red-400 font-bold">Dual-Custody Sign</span>
                </div>
                <h3 className="text-xs font-bold text-[#f0f4f8]">High-Risk / Destructive Actions</h3>
                <p className="text-xs text-[#8a919e]">
                  Remote Intune device wipes, Conditional Access policy disabling, hard user purges, and Global Admin PIM elevations.
                </p>
                <ul className="text-xs text-[#e0e2ea] space-y-1 font-mono text-[11px] list-disc list-inside">
                  <li>Dual-Custody Sign-off (MSP + Client CISO)</li>
                  <li>Cryptographic Audit Logging</li>
                  <li>15-Minute Expiration TTL</li>
                </ul>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* REJECT MODAL */}
      {/* ========================================================================= */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#101419] border border-[#404752] rounded-xl max-w-md w-full p-4 space-y-4 shadow-2xl text-xs">
            <div className="flex items-center justify-between border-b border-[#404752] pb-2">
              <h3 className="font-bold text-[#f0f4f8] text-sm flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-400" />
                <span>Reject Approval Request</span>
              </h3>
              <button onClick={() => setShowRejectModal(false)} className="text-[#8a919e] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[#8a919e]">
              Please state the reason for rejecting <strong className="text-white">{selectedRequest?.requestCode}</strong>:
            </p>

            <textarea
              rows={3}
              placeholder="e.g. Missing required Change Control authorization from client..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full bg-[#181c22] border border-[#404752] rounded p-2 text-xs text-[#e0e2ea] focus:outline-none focus:border-red-500"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowRejectModal(false)}
                className="px-3 py-1.5 bg-[#181c22] border border-[#404752] text-[#8a919e] hover:text-white rounded font-mono"
              >
                Cancel
              </button>
              <button
                onClick={handleRejectRequest}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white font-mono font-bold rounded"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIGITAL SIGNATURE EXECUTION DIALOG */}
      {showDigitalSignatureModal && selectedRequest && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-[#101419] border border-[#0078d4]/60 rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl text-xs">
            
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded bg-purple-950/60 border border-purple-600 text-purple-300">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-[#f0f4f8] text-sm font-mono">
                    Cryptographic Digital Signature Verification
                  </h3>
                  <p className="text-[11px] text-[#8a919e]">Confirm execution for {selectedRequest.requestCode}</p>
                </div>
              </div>
              <button
                onClick={() => setShowDigitalSignatureModal(false)}
                className="text-[#8a919e] hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Signature Payload Box */}
            <div className="bg-[#181c22] border border-[#404752] rounded-lg p-3.5 space-y-2.5 font-mono">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#8a919e]">Signer Authority:</span>
                <span className="font-bold text-[#a3c9ff]">Shane McCaw (Lead Architect)</span>
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#8a919e]">Execution Timestamp:</span>
                <span className="font-bold text-emerald-400">{new Date().toUTCString()}</span>
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#8a919e]">Digital Signature Fingerprint:</span>
                <span className="font-mono text-[10px] text-purple-300 bg-purple-950/80 px-2 py-0.5 rounded border border-purple-800">
                  SHA256:0x8F9A-2B7C-4D3E-1A0B
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#8a919e]">PSA Ticket Link:</span>
                <span className="font-bold text-[#e0e2ea]">{selectedRequest.psaTicketId}</span>
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#8a919e]">Target Tenant:</span>
                <span className="font-bold text-[#e0e2ea]">{selectedRequest.tenantName}</span>
              </div>

              {approverNotes && (
                <div className="pt-2 border-t border-[#404752]/60 text-[11px]">
                  <span className="text-[#8a919e] block">Signer Governance Note:</span>
                  <p className="text-[#a3c9ff] italic mt-0.5">"{approverNotes}"</p>
                </div>
              )}
            </div>

            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-[11px] text-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                By clicking <strong>Execute Request</strong>, this cryptographic signature will be recorded in the immutable audit ledger and the Graph API action will run immediately.
              </span>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowDigitalSignatureModal(false)}
                disabled={isSigning}
                className="px-4 py-2 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#e0e2ea] rounded text-xs font-mono font-bold cursor-pointer"
              >
                Cancel
              </button>

              <button
                onClick={handleApproveRequest}
                disabled={isSigning}
                className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded text-xs font-mono font-bold flex items-center gap-2 shadow-lg cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className={cn("w-4 h-4", isSigning ? "animate-spin" : "")} />
                <span>{isSigning ? 'Dispatching...' : 'Execute Request'}</span>
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

