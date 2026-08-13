// @ts-nocheck
import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  DollarSign,
  AlertTriangle,
  ShieldAlert,
  FileText,
  CheckCircle2,
  XCircle,
  Zap,
  Clock,
  Search,
  Filter,
  SlidersHorizontal,
  RefreshCw,
  ExternalLink,
  Code2,
  Scale,
  Layers,
  Send,
  Ticket,
  Receipt,
  Building2,
  ChevronRight,
  Download,
  Plus,
  X,
  Copy,
  Info,
  Check,
  ArrowRight,
  Sliders,
  Sparkles,
  Lock,
  Users,
  HardDrive,
  ShieldCheck,
  Calculator,
  Briefcase,
  FileSpreadsheet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tenant } from '../types';

export interface ScopeCreepItem {
  id: string; // e.g. 'SCP-1092'
  tenantId: string;
  tenantName: string;
  primaryDomain: string;
  category: 'seat_overage' | 'uncontracted_workload' | 'license_misconfiguration' | 'shared_mailbox_abuse';
  categoryLabel: string;
  title: string;
  description: string;
  contractedQty: number;
  actualQty: number;
  unitPriceUsd: number;
  unbilledMrr: number;
  severity: 'high' | 'medium' | 'low';
  detectedAt: string;
  status: 'active_leak' | 'pending_sow' | 'remediated' | 'exempt';
  graphEndpoint: string;
  impactedEntities: string[]; // List of UPNs or Device Names
  rawGraphPayload: Record<string, any>;
  contractMsaBaseline: Record<string, any>;
}

export interface TenantScopeOverview {
  tenantId: string;
  tenantName: string;
  primaryDomain: string;
  contractedUsers: number;
  actualUsers: number;
  contractedRetainerUsd: number;
  unbilledMrr: number;
  activeLeaksCount: number;
  uncontractedWorkloads: string[];
  status: 'Active Leak' | 'Change Order Pending' | 'In Agreement';
}

interface ScopeCreepConsoleProps {
  tenants?: Tenant[];
  selectedTenant?: Tenant | null;
  onSelectTenant?: (tenant: Tenant | null) => void;
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
  onExecuteWorkflow?: (actionId: string, params: Record<string, any>) => void;
}

// 8+ Realistic Scope Creep Items
const INITIAL_SCOPE_ITEMS: ScopeCreepItem[] = [
  {
    id: 'SCP-1092',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    primaryDomain: 'contoso.onmicrosoft.com',
    category: 'seat_overage',
    categoryLabel: 'User Seat Overage',
    title: 'Active M365 User Seats Exceed Contracted MSA Cap',
    description: 'Graph API detected 124 active assigned user accounts. SOW agreement cap is set to 100 users.',
    contractedQty: 100,
    actualQty: 124,
    unitPriceUsd: 15.0,
    unbilledMrr: 360.0,
    severity: 'high',
    detectedAt: '2026-07-23 22:10 UTC',
    status: 'active_leak',
    graphEndpoint: 'GET /v1.0/users?$filter=assignedLicenses/$count ne 0',
    impactedEntities: [
      'dev.lead@contoso.com',
      'contractor.mark@contoso.com',
      'sales.temp01@contoso.com',
      'sales.temp02@contoso.com',
      'finance.auditor@contoso.com',
      '+ 19 additional active user UPNs',
    ],
    contractMsaBaseline: {
      msaId: 'MSA-CONT-2025',
      contractedSeats: 100,
      seatPrice: '$15.00/user/mo',
      workloadsIncluded: ['Exchange Online P1', 'Microsoft Teams', 'SharePoint Online'],
      overageClause: 'Automated true-up at $15/user/month upon exceeding +5 seats for >14 days',
    },
    rawGraphPayload: {
      tenantId: 'contoso-01',
      totalLicensedUsersCount: 124,
      assignedSkuDetails: [
        { skuPartNumber: 'SPE_E3', count: 100 },
        { skuPartNumber: 'O365_BUSINESS_PREMIUM', count: 24 },
      ],
      pollTimestamp: '2026-07-23T22:10:00Z',
    },
  },
  {
    id: 'SCP-1091',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    primaryDomain: 'contoso.onmicrosoft.com',
    category: 'uncontracted_workload',
    categoryLabel: 'Uncontracted Intune MDM',
    title: 'Active Intune Endpoint Management Service Activated',
    description: '18 Windows 11 devices enrolled in Intune MDM policies. Intune management is omitted from standard retainer.',
    contractedQty: 0,
    actualQty: 18,
    unitPriceUsd: 8.0,
    unbilledMrr: 144.0,
    severity: 'medium',
    detectedAt: '2026-07-23 21:45 UTC',
    status: 'active_leak',
    graphEndpoint: 'GET /v1.0/deviceManagement/managedDevices',
    impactedEntities: [
      'DESKTOP-EXEC-01',
      'FIN-LAP-8810',
      'DEV-BOX-9920',
      'SURFACE-PRO-41',
      '+ 14 additional managed endpoints',
    ],
    contractMsaBaseline: {
      msaId: 'MSA-CONT-2025',
      intuneCovered: false,
      note: 'Intune MDM deployment and patch compliance requires Add-On Tier B ($8/device/mo)',
    },
    rawGraphPayload: {
      managedDeviceCount: 18,
      compliancePoliciesActive: 4,
      enrolledTypes: ['windows11', 'iOS'],
    },
  },
  {
    id: 'SCP-1090',
    tenantId: 'fabrikam-02',
    tenantName: 'Fabrikam Inc',
    primaryDomain: 'fabrikam.onmicrosoft.com',
    category: 'uncontracted_workload',
    categoryLabel: 'Defender SOC Guard',
    title: 'Defender for Business P2 Threat Investigation Triggered',
    description: 'Automated investigation & response (AIR) active across 42 endpoints. Client purchased P2 standalone without MSP SOC coverage.',
    contractedQty: 0,
    actualQty: 42,
    unitPriceUsd: 12.0,
    unbilledMrr: 504.0,
    severity: 'high',
    detectedAt: '2026-07-23 20:30 UTC',
    status: 'pending_sow',
    graphEndpoint: 'GET /v1.0/security/incidents',
    impactedEntities: [
      'AIR Investigation #9910',
      'SOC Remediation Ticket #8812',
      '42 Protected Endpoints',
    ],
    contractMsaBaseline: {
      msaId: 'MSA-FABR-2025',
      defenderSocTier: 'None (Basic Anti-Virus Only)',
      p2ResponseCovered: false,
    },
    rawGraphPayload: {
      defenderPlan: 'DefenderForBusinessP2',
      activeAirInvestigations: 3,
      alertAutomatedRemediationsCount: 19,
    },
  },
  {
    id: 'SCP-1089',
    tenantId: 'northwind-03',
    tenantName: 'Northwind Traders',
    primaryDomain: 'northwind.onmicrosoft.com',
    category: 'shared_mailbox_abuse',
    categoryLabel: 'Shared Mailbox Over 50GB',
    title: 'Shared Mailbox Exceeds 50GB Without Exchange Plan 2 License',
    description: 'sales-archive@northwind.com consumed 68.4 GB. Requires paid Exchange Online Plan 2 addon ($8/mo) to remain compliant.',
    contractedQty: 0,
    actualQty: 1,
    unitPriceUsd: 8.0,
    unbilledMrr: 8.0,
    severity: 'low',
    detectedAt: '2026-07-23 19:15 UTC',
    status: 'active_leak',
    graphEndpoint: 'GET /v1.0/users/sales-archive@northwind.com/mailboxSettings',
    impactedEntities: ['sales-archive@northwind.com (68.4 GB / 50 GB)'],
    contractMsaBaseline: {
      msaId: 'MSA-NORT-2024',
      sharedMailboxStorageCap: '50.0 GB',
      policy: 'Shared mailboxes > 50GB require Exchange Plan 2 license add-on.',
    },
    rawGraphPayload: {
      userPrincipalName: 'sales-archive@northwind.com',
      totalQuotaBytes: 53687091200, // 50 GB
      consumedQuotaBytes: 73448407040, // 68.4 GB
      isLicensed: false,
    },
  },
  {
    id: 'SCP-1088',
    tenantId: 'adventure-05',
    tenantName: 'AdventureWorks',
    primaryDomain: 'adventureworks.com',
    category: 'seat_overage',
    categoryLabel: 'User Seat Overage',
    title: 'Contracted 50 Users vs 72 Active Users Managed',
    description: '22 additional active users added by internal client HR without notifying MSP billing.',
    contractedQty: 50,
    actualQty: 72,
    unitPriceUsd: 18.0,
    unbilledMrr: 396.0,
    severity: 'high',
    detectedAt: '2026-07-23 18:00 UTC',
    status: 'active_leak',
    graphEndpoint: 'GET /v1.0/users',
    impactedEntities: [
      'new.hire1@adventureworks.com',
      'new.hire2@adventureworks.com',
      '+ 20 additional new hires',
    ],
    contractMsaBaseline: {
      msaId: 'MSA-ADV-2025',
      contractedSeats: 50,
      seatPrice: '$18.00/user/mo',
    },
    rawGraphPayload: {
      tenantId: 'adventure-05',
      totalLicensedUsersCount: 72,
    },
  },
  {
    id: 'SCP-1087',
    tenantId: 'woodgrove-04',
    tenantName: 'Woodgrove Bank',
    primaryDomain: 'woodgrovebank.com',
    category: 'uncontracted_workload',
    categoryLabel: 'Purview Compliance',
    title: 'Microsoft Purview DLP & Insider Risk Management Policies Active',
    description: 'Complex DLP policies deployed across SharePoint and Exchange without specialized compliance retainer.',
    contractedQty: 0,
    actualQty: 1,
    unitPriceUsd: 750.0,
    unbilledMrr: 750.0,
    severity: 'high',
    detectedAt: '2026-07-23 16:30 UTC',
    status: 'pending_sow',
    graphEndpoint: 'GET /v1.0/security/informationProtection/policy',
    impactedEntities: ['Purview DLP Engine', 'Insider Risk Management Module'],
    contractMsaBaseline: {
      msaId: 'MSA-WOOD-2025',
      complianceModuleIncluded: false,
      flatAddonPrice: '$750.00/mo Purview Guard Suite',
    },
    rawGraphPayload: {
      dlpPoliciesCount: 8,
      insiderRiskAlertsActive: 2,
    },
  },
  {
    id: 'SCP-1086',
    tenantId: 'tailspin-06',
    tenantName: 'Tailspin Toys',
    primaryDomain: 'tailspintoys.com',
    category: 'license_misconfiguration',
    categoryLabel: 'License Misconfiguration',
    title: 'Unbilled Power BI Pro Addon Assigned to 15 Non-Executive Users',
    description: 'Client self-purchased 15 Power BI Pro licenses through direct web-direct portal and expects MSP support.',
    contractedQty: 0,
    actualQty: 15,
    unitPriceUsd: 10.0,
    unbilledMrr: 150.0,
    severity: 'medium',
    detectedAt: '2026-07-23 14:20 UTC',
    status: 'remediated',
    graphEndpoint: 'GET /v1.0/subscribedSkus',
    impactedEntities: ['15 Analytics Users'],
    contractMsaBaseline: {
      msaId: 'MSA-TAIL-2024',
      selfPurchasedAppsSupported: false,
    },
    rawGraphPayload: {
      skuPartNumber: 'POWER_BI_STANDARD',
      count: 15,
    },
  },
  {
    id: 'SCP-1085',
    tenantId: 'alpine-08',
    tenantName: 'Alpine Ski House',
    primaryDomain: 'alpineskihouse.com',
    category: 'seat_overage',
    categoryLabel: 'User Seat Overage',
    title: '12 Unbilled Guest Users Granted Full Teams & SharePoint Write Rights',
    description: 'External guest contractors actively using tenant resources beyond free B2B threshold.',
    contractedQty: 5,
    actualQty: 17,
    unitPriceUsd: 12.0,
    unbilledMrr: 144.0,
    severity: 'medium',
    detectedAt: '2026-07-23 12:10 UTC',
    status: 'exempt',
    graphEndpoint: 'GET /v1.0/users?$filter=userType eq Guest',
    impactedEntities: ['12 External Vendor Guest Accounts'],
    contractMsaBaseline: {
      msaId: 'MSA-ALPI-2025',
      guestCap: 5,
      exemptionNote: 'Temporary exemption approved by MSP Account Manager until Aug 1, 2026',
    },
    rawGraphPayload: {
      totalGuestCount: 17,
      exemptionActive: true,
    },
  },
];

// Initial Tenant Overviews
const INITIAL_TENANT_OVERVIEWS: TenantScopeOverview[] = [
  {
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    primaryDomain: 'contoso.onmicrosoft.com',
    contractedUsers: 100,
    actualUsers: 124,
    contractedRetainerUsd: 2500,
    unbilledMrr: 504.0,
    activeLeaksCount: 2,
    uncontractedWorkloads: ['Intune MDM (18 Devices)', 'User Seat Overage (+24 Seats)'],
    status: 'Active Leak',
  },
  {
    tenantId: 'fabrikam-02',
    tenantName: 'Fabrikam Inc',
    primaryDomain: 'fabrikam.onmicrosoft.com',
    contractedUsers: 80,
    actualUsers: 80,
    contractedRetainerUsd: 1800,
    unbilledMrr: 504.0,
    activeLeaksCount: 1,
    uncontractedWorkloads: ['Defender P2 Threat AIR (42 Endpoints)'],
    status: 'Change Order Pending',
  },
  {
    tenantId: 'northwind-03',
    tenantName: 'Northwind Traders',
    primaryDomain: 'northwind.onmicrosoft.com',
    contractedUsers: 50,
    actualUsers: 50,
    contractedRetainerUsd: 1200,
    unbilledMrr: 8.0,
    activeLeaksCount: 1,
    uncontractedWorkloads: ['Shared Mailbox Storage Overage (>50GB)'],
    status: 'Active Leak',
  },
  {
    tenantId: 'adventure-05',
    tenantName: 'AdventureWorks',
    primaryDomain: 'adventureworks.com',
    contractedUsers: 50,
    actualUsers: 72,
    contractedRetainerUsd: 1500,
    unbilledMrr: 396.0,
    activeLeaksCount: 1,
    uncontractedWorkloads: ['User Seat Overage (+22 Seats)'],
    status: 'Active Leak',
  },
  {
    tenantId: 'woodgrove-04',
    tenantName: 'Woodgrove Bank',
    primaryDomain: 'woodgrovebank.com',
    contractedUsers: 150,
    actualUsers: 150,
    contractedRetainerUsd: 4500,
    unbilledMrr: 750.0,
    activeLeaksCount: 1,
    uncontractedWorkloads: ['Purview DLP & Insider Risk Guard'],
    status: 'Change Order Pending',
  },
  {
    tenantId: 'tailspin-06',
    tenantName: 'Tailspin Toys',
    primaryDomain: 'tailspintoys.com',
    contractedUsers: 35,
    actualUsers: 35,
    contractedRetainerUsd: 900,
    unbilledMrr: 0.0,
    activeLeaksCount: 0,
    uncontractedWorkloads: [],
    status: 'In Agreement',
  },
  {
    tenantId: 'alpine-08',
    tenantName: 'Alpine Ski House',
    primaryDomain: 'alpineskihouse.com',
    contractedUsers: 25,
    actualUsers: 25,
    contractedRetainerUsd: 650,
    unbilledMrr: 144.0,
    activeLeaksCount: 1,
    uncontractedWorkloads: ['Guest User Overage (+12 Guests)'],
    status: 'Active Leak',
  },
];

export const ScopeCreepConsole: React.FC<ScopeCreepConsoleProps> = ({
  tenants = [],
  selectedTenant,
  onSelectTenant,
  onShowToast,
  onExecuteWorkflow,
}) => {
  // State
  const [scopeItems, setScopeItems] = useState<ScopeCreepItem[]>(INITIAL_SCOPE_ITEMS);
  const [tenantOverviews, setTenantOverviews] = useState<TenantScopeOverview[]>(INITIAL_TENANT_OVERVIEWS);
  
  const [activeTab, setActiveTab] = useState<'matrix' | 'audit' | 'reconcile'>('matrix');
  const [selectedDrawerItem, setSelectedDrawerItem] = useState<ScopeCreepItem | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('All');
  const [selectedSeverityFilter, setSelectedSeverityFilter] = useState<string>('All Severities');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('All Statuses');

  // Change Order Reconcile Builder State
  const [reconcileTenantId, setReconcileTenantId] = useState<string>('contoso-01');
  const [customUserRate, setCustomUserRate] = useState<number>(15.0);
  const [customDeviceRate, setCustomDeviceRate] = useState<number>(8.0);
  const [sowNotes, setSowNotes] = useState<string>(
    'Quarterly Scope True-Up: Adjusted active M365 user seat cap and added Intune MDM endpoint management addon per Graph API audit.'
  );

  // Selected Reconcile Tenant
  const selectedReconcileTenant = useMemo(() => {
    return (
      tenantOverviews.find((t) => t.tenantId === reconcileTenantId) ||
      tenantOverviews[0]
    );
  }, [tenantOverviews, reconcileTenantId]);

  // Reconcile Calculations
  const reconcileCalculations = useMemo(() => {
    const userOverage = Math.max(0, selectedReconcileTenant.actualUsers - selectedReconcileTenant.contractedUsers);
    const userOverageTotal = userOverage * customUserRate;
    
    // Intune / device overage mock
    const deviceCount = selectedReconcileTenant.tenantId === 'contoso-01' ? 18 : 0;
    const deviceOverageTotal = deviceCount * customDeviceRate;

    const baseRetainer = selectedReconcileTenant.contractedRetainerUsd;
    const newProposedRetainer = baseRetainer + userOverageTotal + deviceOverageTotal;

    return {
      userOverage,
      userOverageTotal,
      deviceCount,
      deviceOverageTotal,
      baseRetainer,
      newProposedRetainer,
      mrrIncrease: userOverageTotal + deviceOverageTotal,
    };
  }, [selectedReconcileTenant, customUserRate, customDeviceRate]);

  // Top KPI Metrics
  const metrics = useMemo(() => {
    const totalUnbilledMrr = scopeItems
      .filter((i) => i.status === 'active_leak' || i.status === 'pending_sow')
      .reduce((acc, curr) => acc + curr.unbilledMrr, 0);

    const activeCreepTenantsCount = tenantOverviews.filter((t) => t.unbilledMrr > 0).length;

    const uncontractedWorkloadsCount = scopeItems.filter(
      (i) => i.category === 'uncontracted_workload' && i.status !== 'remediated'
    ).length;

    const pendingChangeOrdersCount = scopeItems.filter((i) => i.status === 'pending_sow').length;

    return {
      totalUnbilledMrr,
      activeCreepTenantsCount,
      uncontractedWorkloadsCount,
      pendingChangeOrdersCount,
    };
  }, [scopeItems, tenantOverviews]);

  // Filtered Scope Items
  const filteredScopeItems = useMemo(() => {
    return scopeItems.filter((item) => {
      // Category Filter
      if (selectedCategoryFilter !== 'All' && item.category !== selectedCategoryFilter) {
        return false;
      }

      // Severity Filter
      if (selectedSeverityFilter !== 'All Severities' && item.severity !== selectedSeverityFilter.toLowerCase()) {
        return false;
      }

      // Status Filter
      if (selectedStatusFilter === 'Active Leak' && item.status !== 'active_leak') return false;
      if (selectedStatusFilter === 'Pending SOW' && item.status !== 'pending_sow') return false;
      if (selectedStatusFilter === 'Remediated' && item.status !== 'remediated') return false;
      if (selectedStatusFilter === 'Exempt' && item.status !== 'exempt') return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.tenantName.toLowerCase().includes(q);
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesId = item.id.toLowerCase().includes(q);
        const matchesEndpoint = item.graphEndpoint.toLowerCase().includes(q);

        return matchesName || matchesTitle || matchesId || matchesEndpoint;
      }

      return true;
    });
  }, [scopeItems, selectedCategoryFilter, selectedSeverityFilter, selectedStatusFilter, searchQuery]);

  // Filtered Tenant Matrix
  const filteredTenantMatrix = useMemo(() => {
    return tenantOverviews.filter((item) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.tenantName.toLowerCase().includes(q) ||
          item.primaryDomain.toLowerCase().includes(q) ||
          item.status.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [tenantOverviews, searchQuery]);

  // Handlers
  const handleIssueChangeOrder = (item: ScopeCreepItem) => {
    setScopeItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: 'pending_sow' } : i))
    );

    onExecuteWorkflow?.('issue-sow-change-order', {
      scopeItemId: item.id,
      tenantId: item.tenantId,
      unbilledMrr: item.unbilledMrr,
    });

    onShowToast?.(
      'success',
      'Change Order SOW Generated',
      `Sent digital SOW for +$${item.unbilledMrr}/mo to ${item.tenantName} admin.`
    );
  };

  const handleEnforceScopeBlock = (item: ScopeCreepItem) => {
    setScopeItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: 'remediated', unbilledMrr: 0 } : i))
    );

    onExecuteWorkflow?.('enforce-contract-scope-block', {
      scopeItemId: item.id,
      tenantId: item.tenantId,
    });

    onShowToast?.(
      'warning',
      'Contract Scope Enforced',
      `Blocked / unassigned uncontracted workload "${item.categoryLabel}" for ${item.tenantName}.`
    );
  };

  const handleApproveExemption = (item: ScopeCreepItem) => {
    setScopeItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: 'exempt' } : i))
    );

    onShowToast?.('info', 'Exemption Approved', `Marked ${item.id} as temporary billing exemption.`);
  };

  const handlePushPsaAgreement = () => {
    onExecuteWorkflow?.('push-psa-agreement-update', {
      tenantId: selectedReconcileTenant.tenantId,
      newProposedRetainer: reconcileCalculations.newProposedRetainer,
    });

    // Update local state
    setTenantOverviews((prev) =>
      prev.map((t) => {
        if (t.tenantId === selectedReconcileTenant.tenantId) {
          return {
            ...t,
            contractedUsers: t.actualUsers,
            contractedRetainerUsd: reconcileCalculations.newProposedRetainer,
            unbilledMrr: 0,
            status: 'In Agreement',
          };
        }
        return t;
      })
    );

    onShowToast?.(
      'success',
      'PSA Agreement Updated (HaloPSA / ConnectWise)',
      `Pushed updated $${reconcileCalculations.newProposedRetainer.toLocaleString()}/mo retainer agreement to PSA engine.`
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-[#e0e2ea] font-sans overflow-hidden select-none">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & UNCAPTURED MRR ROLLUP BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] p-4 lg:p-5 shrink-0 space-y-4 shadow-md">
        
        {/* Top Header Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-emerald-950/80 border border-emerald-600 flex items-center justify-center text-emerald-400 shrink-0 font-mono">
              <DollarSign className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold text-[#e0e2ea] tracking-tight">
                  MSP Scope Creep & Revenue Recovery Console
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                  /portal/scope-creep
                </span>
              </div>

              <div className="text-xs text-[#8a919e] flex items-center gap-2 mt-0.5">
                <span>Contract vs. Graph Telemetry Alignment</span>
                <span>•</span>
                <span className="text-[#4ade80] text-[11px] font-mono flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> 5m Graph Audit Active (Scope Engine Running)
                </span>
              </div>
            </div>
          </div>

          {/* Header Action Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                onShowToast?.(
                  'info',
                  'PSA Sync Initialized',
                  'Batch syncing agreement seat limits with HaloPSA & ConnectWise Manage...'
                );
                setTimeout(() => {
                  onShowToast?.('success', 'PSA Batch Sync Complete', 'All agreement baselines aligned with PSA contracts.');
                }, 1000);
              }}
              className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Batch Sync PSA Agreements</span>
            </button>

            <button
              onClick={() => {
                onShowToast?.(
                  'success',
                  'Executive Audit PDF Generated',
                  'Exported multi-tenant Scope Creep & MRR Leakage Report PDF.'
                );
              }}
              className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Executive Scope PDF</span>
            </button>
          </div>

        </div>

        {/* Financial Impact KPI Rollup Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          <div className="bg-[#101419] border border-emerald-500/50 p-3 rounded-md flex items-center justify-between shadow-sm bg-emerald-950/10">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-emerald-400 flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                UNCAPTURED MRR LEAKAGE
              </div>
              <div className="text-xl font-bold font-mono text-emerald-200">
                +${metrics.totalUnbilledMrr.toLocaleString()}/mo
              </div>
              <div className="text-[10px] text-[#8a919e] font-mono">Unbilled revenue across clients</div>
            </div>
            <div className="p-2 rounded bg-emerald-950 border border-emerald-800 text-emerald-400">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#101419] border border-amber-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-amber-300 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                TENANTS OVER CONTRACT LIMIT
              </div>
              <div className="text-xl font-bold font-mono text-amber-200">
                {metrics.activeCreepTenantsCount} <span className="text-xs font-normal text-amber-400">Tenants</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Active seat or workload overages</div>
            </div>
            <div className="p-2 rounded bg-amber-950/40 border border-amber-800 text-amber-400">
              <Building2 className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#101419] border border-purple-500/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-purple-300 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-purple-400" />
                UNCONTRACTED WORKLOADS
              </div>
              <div className="text-xl font-bold font-mono text-purple-200">
                {metrics.uncontractedWorkloadsCount} <span className="text-xs font-normal text-purple-400">Features</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Intune / Defender / Purview Active</div>
            </div>
            <div className="p-2 rounded bg-purple-950/40 border border-purple-800 text-purple-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#101419] border border-[#0078d4]/40 p-3 rounded-md flex items-center justify-between shadow-sm">
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-[#a3c9ff] flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-[#0078d4]" />
                PENDING CHANGE ORDERS
              </div>
              <div className="text-xl font-bold font-mono text-[#e0e2ea]">
                {metrics.pendingChangeOrdersCount} <span className="text-xs font-normal text-[#a3c9ff]">SOWs</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Awaiting client admin signature</div>
            </div>
            <div className="p-2 rounded bg-[#0078d4]/20 border border-[#0078d4]/40 text-[#a3c9ff]">
              <Receipt className="w-5 h-5" />
            </div>
          </div>

        </div>

      </div>

      {/* ========================================================================= */}
      {/* 2. COMMAND TOOLBAR & SUB-TAB NAVIGATION */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] p-3 shrink-0 flex items-center justify-between gap-3 flex-wrap text-xs">
        
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 bg-[#181c22] p-1 rounded-md border border-[#404752] overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveTab('matrix')}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
              activeTab === 'matrix'
                ? 'bg-[#0078d4] text-white shadow'
                : 'text-[#8a919e] hover:text-[#e0e2ea]'
            )}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Scope Matrix ({tenantOverviews.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 relative',
              activeTab === 'audit'
                ? 'bg-[#0078d4] text-white shadow'
                : 'text-[#8a919e] hover:text-[#e0e2ea]'
            )}
          >
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            <span>Graph Workload Audit ({scopeItems.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('reconcile')}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
              activeTab === 'reconcile'
                ? 'bg-[#0078d4] text-white shadow'
                : 'text-[#8a919e] hover:text-[#e0e2ea]'
            )}
          >
            <Calculator className="w-3.5 h-3.5 text-emerald-400" />
            <span>Change Order Builder & PSA Reconciliation</span>
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e]" />
            <input
              type="text"
              placeholder="Search Tenant Name, Workload, or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#181c22] border border-[#404752] text-[#e0e2ea] placeholder-[#8a919e] text-xs rounded pl-8 pr-3 py-1.5 focus:outline-none focus:border-[#0078d4]"
            />
          </div>

          {/* Category Filter */}
          <select
            value={selectedCategoryFilter}
            onChange={(e) => setSelectedCategoryFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All">All Categories</option>
            <option value="seat_overage">User Seat Overages</option>
            <option value="uncontracted_workload">Uncontracted Intune/Defender</option>
            <option value="shared_mailbox_abuse">Shared Mailbox Abuse</option>
            <option value="license_misconfiguration">License Misconfiguration</option>
          </select>

          {/* Severity Filter */}
          <select
            value={selectedSeverityFilter}
            onChange={(e) => setSelectedSeverityFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All Severities">All Financial Impact</option>
            <option value="High">High Impact (&gt;$300/mo)</option>
            <option value="Medium">Medium Impact ($100-$300/mo)</option>
            <option value="Low">Low Impact (&lt;$100/mo)</option>
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatusFilter}
            onChange={(e) => setSelectedStatusFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All Statuses">All Statuses</option>
            <option value="Active Leak">Active Leak 🔴</option>
            <option value="Pending SOW">Pending SOW 🟡</option>
            <option value="Remediated">Remediated 🟢</option>
            <option value="Exempt">Exempt ⚪</option>
          </select>
        </div>

      </div>

      {/* ========================================================================= */}
      {/* 3. MAIN TAB CONTENT AREA */}
      {/* ========================================================================= */}
      <div className="flex-1 overflow-hidden relative flex">
        
        {/* TAB 1: SCOPE MATRIX (CLIENT-BY-CLIENT DISCREPANCIES) */}
        {activeTab === 'matrix' && (
          <div className="w-full h-full overflow-y-auto p-4 lg:p-6 space-y-4">
            
            <div className="bg-[#181c22] border border-[#404752] rounded-lg overflow-hidden shadow-xl">
              <div className="p-3 bg-[#101419] border-b border-[#404752] text-xs font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center justify-between">
                <span>Managed Client Contract Alignment & Scope Creep Overview ({filteredTenantMatrix.length})</span>
                <span>Click tenant row to open Change Order Builder</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#101419] border-b border-[#404752] text-[#8a919e] font-mono text-[11px] uppercase">
                      <th className="p-3">Tenant Name</th>
                      <th className="p-3">Contracted MSA Baseline</th>
                      <th className="p-3">Actual Graph Telemetry</th>
                      <th className="p-3">Discovered Overage / Workloads</th>
                      <th className="p-3">Unbilled MRR Impact</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/60 font-mono text-[12px]">
                    {filteredTenantMatrix.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-[#8a919e]">
                          No client scope records match the selected filters.
                        </td>
                      </tr>
                    ) : (
                      filteredTenantMatrix.map((item) => {
                        const hasLeak = item.unbilledMrr > 0;

                        return (
                          <tr
                            key={item.tenantId}
                            onClick={() => {
                              setReconcileTenantId(item.tenantId);
                              setActiveTab('reconcile');
                            }}
                            className="hover:bg-[#272a30]/60 cursor-pointer transition-colors"
                          >
                            {/* Tenant Name */}
                            <td className="p-3 font-sans">
                              <div className="font-bold text-[#e0e2ea] flex items-center gap-2">
                                <Building2 className="w-4 h-4 text-[#0078d4]" />
                                <span>{item.tenantName}</span>
                              </div>
                              <div className="text-[11px] font-mono text-[#8a919e] ml-6">
                                {item.primaryDomain}
                              </div>
                            </td>

                            {/* Contracted MSA Baseline */}
                            <td className="p-3 font-mono text-[#e0e2ea]">
                              <div className="font-bold">{item.contractedUsers} Contracted Users</div>
                              <div className="text-[10px] text-[#8a919e]">
                                Retainer: ${item.contractedRetainerUsd.toLocaleString()}/mo
                              </div>
                            </td>

                            {/* Actual Graph Telemetry */}
                            <td className="p-3 font-mono text-[#a3c9ff]">
                              <div className="font-bold">{item.actualUsers} Active Users</div>
                              <div className="text-[10px] text-[#8a919e]">Polled via Graph 5m</div>
                            </td>

                            {/* Discovered Overage / Workloads */}
                            <td className="p-3">
                              {item.uncontractedWorkloads.length === 0 ? (
                                <span className="text-[#8a919e] text-[11px]">No overages detected</span>
                              ) : (
                                <div className="space-y-1">
                                  {item.uncontractedWorkloads.map((w, idx) => (
                                    <span
                                      key={idx}
                                      className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800 mr-1"
                                    >
                                      {w}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>

                            {/* Unbilled MRR Impact */}
                            <td className="p-3 font-bold text-sm">
                              {hasLeak ? (
                                <span className="text-emerald-400 font-mono">
                                  +${item.unbilledMrr.toLocaleString()}/mo
                                </span>
                              ) : (
                                <span className="text-[#8a919e] font-mono">$0.00</span>
                              )}
                            </td>

                            {/* Status */}
                            <td className="p-3">
                              {item.status === 'Active Leak' ? (
                                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-red-950 text-red-300 border border-red-800 animate-pulse">
                                  ACTIVE LEAK 🔴
                                </span>
                              ) : item.status === 'Change Order Pending' ? (
                                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                                  PENDING SOW 🟡
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                  IN AGREEMENT 🟢
                                </span>
                              )}
                            </td>

                            {/* Actions */}
                            <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => {
                                  setReconcileTenantId(item.tenantId);
                                  setActiveTab('reconcile');
                                }}
                                className="px-3 py-1 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-[11px] font-bold cursor-pointer transition-all shadow-sm flex items-center gap-1 ml-auto"
                              >
                                <Calculator className="w-3.5 h-3.5" />
                                <span>Build Change Order</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* TAB 2: UNCONTRACTED WORKLOAD & FEATURE AUDIT (DEEP-DIVE GRAPH FEED) */}
        {activeTab === 'audit' && (
          <div className="w-full h-full overflow-y-auto p-4 lg:p-6 space-y-4">
            
            <div className="bg-[#181c22] border border-[#404752] rounded-lg overflow-hidden shadow-xl">
              <div className="p-3 bg-[#101419] border-b border-[#404752] text-xs font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center justify-between">
                <span>Microsoft Graph API Scope Creep & Feature Detection Feed ({filteredScopeItems.length})</span>
                <span>Click any detection item to view raw Graph telemetry payload</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#101419] border-b border-[#404752] text-[#8a919e] font-mono text-[11px] uppercase">
                      <th className="p-3">Severity</th>
                      <th className="p-3">Customer Tenant</th>
                      <th className="p-3">Discovered Overage / Workload</th>
                      <th className="p-3">Graph Endpoint Trigger</th>
                      <th className="p-3">Variance</th>
                      <th className="p-3">Unbilled MRR</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/60 font-mono text-[12px]">
                    {filteredScopeItems.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-[#8a919e]">
                          No scope audit items found matching criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredScopeItems.map((item) => {
                        return (
                          <tr
                            key={item.id}
                            onClick={() => setSelectedDrawerItem(item)}
                            className="hover:bg-[#272a30]/60 cursor-pointer transition-colors"
                          >
                            {/* Severity */}
                            <td className="p-3 whitespace-nowrap">
                              {item.severity === 'high' ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white animate-pulse">
                                  HIGH LEAK
                                </span>
                              ) : item.severity === 'medium' ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/30 text-amber-300 border border-amber-500/50">
                                  MEDIUM
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/30">
                                  LOW
                                </span>
                              )}
                            </td>

                            {/* Tenant */}
                            <td className="p-3 font-sans">
                              <div className="font-bold text-[#e0e2ea]">{item.tenantName}</div>
                              <div className="text-[10px] font-mono text-[#8a919e]">{item.id}</div>
                            </td>

                            {/* Title & Category */}
                            <td className="p-3 font-sans max-w-[260px]">
                              <div className="font-bold text-[#e0e2ea] truncate">{item.title}</div>
                              <div className="text-[10px] font-mono text-purple-300">{item.categoryLabel}</div>
                            </td>

                            {/* Graph Endpoint */}
                            <td className="p-3 font-mono text-[11px] text-[#a3c9ff] max-w-[200px] truncate">
                              {item.graphEndpoint}
                            </td>

                            {/* Variance */}
                            <td className="p-3 whitespace-nowrap font-mono text-[#e0e2ea]">
                              {item.contractedQty} Contracted ➔ <strong className="text-amber-300">{item.actualQty} Actual</strong>
                            </td>

                            {/* Unbilled MRR */}
                            <td className="p-3 font-mono font-bold text-emerald-400">
                              +${item.unbilledMrr.toFixed(2)}/mo
                            </td>

                            {/* Status */}
                            <td className="p-3">
                              {item.status === 'active_leak' ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 text-red-300 border border-red-800">
                                  ACTIVE LEAK
                                </span>
                              ) : item.status === 'pending_sow' ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                                  SOW SENT
                                </span>
                              ) : item.status === 'remediated' ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                                  REMEDIATED
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#272a30] text-[#8a919e] border border-[#404752]">
                                  EXEMPT
                                </span>
                              )}
                            </td>

                            {/* Actions */}
                            <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1">
                                {item.status === 'active_leak' && (
                                  <>
                                    <button
                                      onClick={() => handleIssueChangeOrder(item)}
                                      className="px-2 py-1 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-[11px] font-bold cursor-pointer"
                                    >
                                      Issue SOW
                                    </button>
                                    <button
                                      onClick={() => handleEnforceScopeBlock(item)}
                                      className="px-2 py-1 bg-[#272a30] hover:bg-[#31353b] text-red-300 border border-red-800 rounded text-[11px] font-semibold cursor-pointer"
                                      title="Block / Disable Uncontracted Workload"
                                    >
                                      Block
                                    </button>
                                  </>
                                )}

                                <button
                                  onClick={() => setSelectedDrawerItem(item)}
                                  className="p-1 text-[#8a919e] hover:text-white"
                                  title="Inspect JSON Telemetry"
                                >
                                  <Code2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* TAB 3: CHANGE ORDER BUILDER & PSA RECONCILIATION */}
        {activeTab === 'reconcile' && (
          <div className="w-full h-full overflow-y-auto p-4 lg:p-6 space-y-6">
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left Column: SOW Adjustment Controls (2 Cols) */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* Select Tenant Card */}
                <div className="bg-[#181c22] border border-[#404752] rounded-lg p-5 space-y-4 shadow-lg">
                  <div className="flex items-center justify-between border-b border-[#404752] pb-3">
                    <div className="flex items-center gap-2">
                      <Receipt className="w-5 h-5 text-[#0078d4]" />
                      <h2 className="font-bold text-sm text-[#e0e2ea]">
                        SOW Change Order & Billing Adjustment Engine
                      </h2>
                    </div>
                    <span className="text-xs font-mono text-emerald-400 font-bold">
                      HaloPSA / ConnectWise Sync Ready
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-sans">
                    <div className="space-y-1.5">
                      <label className="text-[#8a919e] font-mono font-bold uppercase text-[10px]">
                        Target Customer Tenant:
                      </label>
                      <select
                        value={reconcileTenantId}
                        onChange={(e) => setReconcileTenantId(e.target.value)}
                        className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded p-2 text-xs outline-none focus:border-[#0078d4] font-semibold"
                      >
                        {tenantOverviews.map((t) => (
                          <option key={t.tenantId} value={t.tenantId}>
                            {t.tenantName} ({t.primaryDomain})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[#8a919e] font-mono font-bold uppercase text-[10px]">
                        Contracted MSA Base Retainer:
                      </label>
                      <div className="bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded p-2 font-mono font-bold text-sm">
                        ${selectedReconcileTenant.contractedRetainerUsd.toLocaleString()} / month
                      </div>
                    </div>
                  </div>

                  {/* Rate Adjustment Sliders / Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#404752]">
                    <div className="space-y-1.5">
                      <label className="text-[#8a919e] font-mono font-bold uppercase text-[10px]">
                        User Seat Overage Rate ($/user/mo):
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-[#8a919e] font-mono">$</span>
                        <input
                          type="number"
                          value={customUserRate}
                          onChange={(e) => setCustomUserRate(Number(e.target.value))}
                          className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded p-2 text-xs font-mono font-bold outline-none focus:border-[#0078d4]"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[#8a919e] font-mono font-bold uppercase text-[10px]">
                        Managed Device Add-on Rate ($/device/mo):
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-[#8a919e] font-mono">$</span>
                        <input
                          type="number"
                          value={customDeviceRate}
                          onChange={(e) => setCustomDeviceRate(Number(e.target.value))}
                          className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded p-2 text-xs font-mono font-bold outline-none focus:border-[#0078d4]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* SOW Reason Notes */}
                  <div className="space-y-1.5 pt-2">
                    <label className="text-[#8a919e] font-mono font-bold uppercase text-[10px]">
                      Change Order Proposal Justification & Audit Notes:
                    </label>
                    <textarea
                      rows={3}
                      value={sowNotes}
                      onChange={(e) => setSowNotes(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] text-[#e0e2ea] rounded p-2.5 text-xs font-sans outline-none focus:border-[#0078d4]"
                    />
                  </div>
                </div>

                {/* Scope Line Items Breakdown */}
                <div className="bg-[#181c22] border border-[#404752] rounded-lg p-5 space-y-3 shadow-lg font-mono text-xs">
                  <h3 className="font-bold text-[#a3c9ff] uppercase tracking-wider text-[11px] flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-[#0078d4]" />
                    <span>Proposed Change Order Line Item Calculation</span>
                  </h3>

                  <div className="divide-y divide-[#404752] text-[11.5px] pt-1">
                    <div className="py-2 flex items-center justify-between">
                      <span className="text-[#e0e2ea]">Contracted Base Retainer ({selectedReconcileTenant.contractedUsers} Seats)</span>
                      <span className="font-bold text-white">${reconcileCalculations.baseRetainer.toLocaleString()}.00/mo</span>
                    </div>

                    <div className="py-2 flex items-center justify-between text-emerald-300">
                      <span>
                        + User Seat Overage (+{reconcileCalculations.userOverage} Seats @ ${customUserRate}/user)
                      </span>
                      <span className="font-bold">+${reconcileCalculations.userOverageTotal.toFixed(2)}/mo</span>
                    </div>

                    {reconcileCalculations.deviceCount > 0 && (
                      <div className="py-2 flex items-center justify-between text-purple-300">
                        <span>
                          + Intune Endpoint Management Add-on ({reconcileCalculations.deviceCount} Devices @ ${customDeviceRate}/device)
                        </span>
                        <span className="font-bold">+${reconcileCalculations.deviceOverageTotal.toFixed(2)}/mo</span>
                      </div>
                    )}

                    <div className="py-3 flex items-center justify-between text-base font-bold text-emerald-400 bg-emerald-950/20 px-3 rounded mt-2">
                      <span>NEW PROPOSED MONTHLY RETAINER:</span>
                      <span>${reconcileCalculations.newProposedRetainer.toLocaleString()}.00 / month</span>
                    </div>
                  </div>
                </div>

              </div>

              {/* Right Column: SOW Dispatch Actions Card (1 Col) */}
              <div className="space-y-6">
                
                <div className="bg-[#181c22] border border-emerald-500/50 rounded-lg p-5 space-y-4 shadow-xl">
                  <div className="flex items-center gap-2 border-b border-[#404752] pb-3">
                    <Sparkles className="w-5 h-5 text-emerald-400" />
                    <h2 className="font-bold text-sm text-[#e0e2ea]">
                      Dispatch SOW & PSA Reconciliation
                    </h2>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="p-3 bg-[#101419] border border-[#404752] rounded space-y-1 font-mono">
                      <span className="text-[#8a919e] text-[10px] block">MONTHLY REVENUE RECOVERY:</span>
                      <div className="text-xl font-bold text-emerald-400">
                        +${reconcileCalculations.mrrIncrease.toLocaleString()}.00 / mo
                      </div>
                      <span className="text-[10px] text-[#8a919e]">
                        +${(reconcileCalculations.mrrIncrease * 12).toLocaleString()} ARR Contract Value Added
                      </span>
                    </div>

                    <button
                      onClick={handlePushPsaAgreement}
                      className="w-full py-2.5 bg-[#0078d4] hover:bg-[#0060ab] text-white font-bold rounded text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>Push Agreement to HaloPSA / ConnectWise</span>
                    </button>

                    <button
                      onClick={() => {
                        onExecuteWorkflow?.('send-digital-sow-link', {
                          tenantId: selectedReconcileTenant.tenantId,
                          newRetainer: reconcileCalculations.newProposedRetainer,
                        });
                        onShowToast?.(
                          'success',
                          'Digital SOW Link Sent',
                          `E-signature request link emailed to ${selectedReconcileTenant.tenantName} primary admin.`
                        );
                      }}
                      className="w-full py-2.5 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] font-bold rounded text-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
                    >
                      <Send className="w-4 h-4" />
                      <span>Send E-Signature SOW to Client</span>
                    </button>

                    <button
                      onClick={() => {
                        onShowToast?.(
                          'success',
                          'SOW PDF Downloaded',
                          `Generated formal SOW Change Order Proposal PDF for ${selectedReconcileTenant.tenantName}.`
                        );
                      }}
                      className="w-full py-2 bg-[#101419] hover:bg-[#272a30] text-[#e0e2ea] border border-[#404752] font-semibold rounded text-xs flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>Export SOW Proposal PDF</span>
                    </button>
                  </div>
                </div>

              </div>

            </div>

          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* 4. SLIDE-OVER TELEMETRY INSPECTION DRAWER */}
      {/* ========================================================================= */}
      {selectedDrawerItem && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end animate-in fade-in">
          <div className="w-full max-w-2xl bg-[#181c22] border-l border-[#404752] h-full flex flex-col shadow-2xl overflow-hidden font-sans">
            
            {/* Drawer Header */}
            <div className="p-4 bg-[#101419] border-b border-[#404752] flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-mono text-[#a3c9ff]">
                  <span>{selectedDrawerItem.id}</span>
                  <span>•</span>
                  <span>{selectedDrawerItem.categoryLabel}</span>
                </div>
                <h2 className="text-sm font-bold text-[#e0e2ea] mt-0.5">
                  {selectedDrawerItem.title}
                </h2>
              </div>

              <button
                onClick={() => setSelectedDrawerItem(null)}
                className="p-1.5 text-[#8a919e] hover:text-white rounded bg-[#272a30] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="p-5 overflow-y-auto space-y-5 text-xs flex-1">
              
              {/* Summary Card */}
              <div className="bg-[#101419] border border-[#404752] rounded-lg p-3.5 space-y-2">
                <h3 className="font-mono text-[11px] font-bold text-[#a3c9ff] uppercase tracking-wider flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-[#0078d4]" />
                  <span>Discrepancy Analysis & Unbilled MRR Impact</span>
                </h3>
                <p className="text-[#e0e2ea] leading-relaxed">
                  {selectedDrawerItem.description}
                </p>
                <div className="text-emerald-400 font-mono font-bold pt-1">
                  Uncaptured MRR Impact: +${selectedDrawerItem.unbilledMrr.toFixed(2)} / month
                </div>
              </div>

              {/* Impacted Entities List */}
              <div className="bg-[#101419] border border-[#404752] rounded-lg p-3.5 space-y-2">
                <h3 className="font-mono text-[11px] font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-amber-400" />
                  <span>Impacted Entities / Accounts ({selectedDrawerItem.impactedEntities.length})</span>
                </h3>
                <div className="space-y-1 font-mono text-[11px] text-[#e0e2ea]">
                  {selectedDrawerItem.impactedEntities.map((ent, idx) => (
                    <div key={idx} className="p-1.5 bg-[#181c22] rounded border border-[#404752]">
                      {ent}
                    </div>
                  ))}
                </div>
              </div>

              {/* Side-by-Side Comparison: MSA Baseline vs Live Graph Payload */}
              <div className="space-y-2">
                <h3 className="font-mono text-[11px] font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Code2 className="w-3.5 h-3.5 text-purple-400" />
                  <span>Side-by-Side MSA Contract vs. Graph API Telemetry</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-[10.5px]">
                  
                  {/* Contract MSA Baseline */}
                  <div className="bg-[#101419] border border-[#404752] p-3 rounded space-y-1 overflow-x-auto">
                    <span className="text-[#a3c9ff] font-bold block text-[10px]">CONTRACTED MSA SCOPE JSON:</span>
                    <pre className="text-[#8a919e]">
                      {JSON.stringify(selectedDrawerItem.contractMsaBaseline, null, 2)}
                    </pre>
                  </div>

                  {/* Live Graph Payload */}
                  <div className="bg-[#101419] border border-[#404752] p-3 rounded space-y-1 overflow-x-auto">
                    <span className="text-emerald-400 font-bold block text-[10px]">LIVE GRAPH TELEMETRY JSON:</span>
                    <pre className="text-emerald-200">
                      {JSON.stringify(selectedDrawerItem.rawGraphPayload, null, 2)}
                    </pre>
                  </div>

                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center gap-2">
                <button
                  onClick={() => {
                    handleIssueChangeOrder(selectedDrawerItem);
                    setSelectedDrawerItem(null);
                  }}
                  className="flex-1 py-2.5 bg-[#0078d4] hover:bg-[#0060ab] text-white font-bold rounded text-xs cursor-pointer shadow-md"
                >
                  Issue Change Order SOW
                </button>

                <button
                  onClick={() => {
                    handleEnforceScopeBlock(selectedDrawerItem);
                    setSelectedDrawerItem(null);
                  }}
                  className="px-4 py-2.5 bg-[#272a30] hover:bg-[#31353b] text-red-300 border border-red-800 font-semibold rounded text-xs cursor-pointer"
                >
                  Block Workload
                </button>
              </div>

            </div>

          </div>
        </div>
      )}

    </div>
  );
};

