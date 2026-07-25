// @ts-nocheck
import React, { useState, useMemo } from 'react';
import {
  DollarSign,
  Receipt,
  TrendingUp,
  PieChart,
  Building2,
  Layers,
  Cpu,
  HardDrive,
  Users,
  FileSpreadsheet,
  Download,
  RefreshCw,
  Search,
  Filter,
  SlidersHorizontal,
  Zap,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  Sparkles,
  ChevronRight,
  X,
  Plus,
  Send,
  Sliders,
  Check,
  Info,
  ShieldAlert,
  ArrowDownRight,
  Bot,
  Mail,
  Edit3,
  Trash2,
  ExternalLink,
  HelpCircle,
  CheckSquare,
  BarChart3
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tenant } from '../types';

// ============================================================================
// TYPES & DATA STRUCTURES
// ============================================================================

export type AllocationMode = 'showback' | 'chargeback';

export interface ChargebackCostCenter {
  id: string;
  costCenterCode: string; // e.g. CC-101
  departmentName: string;
  tenantId: string;
  tenantName: string;
  userCount: number;
  licenseCost: number; // M365 Fixed NCE
  meteredUsageCost: number; // Storage + AI + Compute
  totalCost: number;
  momGrowthPercent: number;
  status: 'fully_allocated' | 'partial' | 'unallocated';
  departmentHeadEmail: string;
  departmentHeadName: string;
  aiTokensConsumed: number; // in thousands
  storageGbUsed: number;
  licenseBreakdown: { sku: string; qty: number; unitCost: number }[];
}

export interface MeteredUserUsage {
  id: string;
  upn: string;
  userName: string;
  department: string;
  costCenterCode: string;
  tenantName: string;
  aiTokensThousand: number;
  aiCost: number;
  storageGb: number;
  storageCost: number;
  graphComputeNodes: number;
  computeCost: number;
  totalMeteredCost: number;
  primaryUsageType: 'Copilot Summaries' | 'Power Automate Flow' | 'Graph API Worker' | 'SharePoint Overages' | 'Teams Transcriptions';
}

export interface AllocationRule {
  id: string;
  ruleName: string;
  entraAttribute: string; // e.g., 'user.department'
  operator: 'EQUALS' | 'CONTAINS' | 'STARTS_WITH';
  matchValue: string;
  targetCostCenterCode: string;
  targetDepartmentName: string;
  isActive: boolean;
  matchedUsersCount: number;
}

interface ChargebackConsoleProps {
  tenants?: Tenant[];
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
}

// ============================================================================
// INITIAL MOCK DATA
// ============================================================================

const INITIAL_COST_CENTERS: ChargebackCostCenter[] = [
  {
    id: 'cc-101',
    costCenterCode: 'CC-101',
    departmentName: 'Engineering & Product Architecture',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    userCount: 42,
    licenseCost: 1512.00,
    meteredUsageCost: 340.50,
    totalCost: 1852.50,
    momGrowthPercent: 4.2,
    status: 'fully_allocated',
    departmentHeadEmail: 'alex.wilson@contosobio.com',
    departmentHeadName: 'Alex Wilson (VP Engineering)',
    aiTokensConsumed: 1850,
    storageGbUsed: 1420,
    licenseBreakdown: [
      { sku: 'M365 Business Premium', qty: 32, unitCost: 38.00 },
      { sku: 'M365 E5 Suite', qty: 10, unitCost: 68.00 }
    ]
  },
  {
    id: 'cc-201',
    costCenterCode: 'CC-201',
    departmentName: 'Global Sales & Enterprise Accounts',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    userCount: 68,
    licenseCost: 2584.00,
    meteredUsageCost: 610.20,
    totalCost: 3194.20,
    momGrowthPercent: 8.5,
    status: 'fully_allocated',
    departmentHeadEmail: 'samantha.reed@contosobio.com',
    departmentHeadName: 'Samantha Reed (CRO)',
    aiTokensConsumed: 4200,
    storageGbUsed: 2100,
    licenseBreakdown: [
      { sku: 'M365 Business Premium', qty: 68, unitCost: 38.00 }
    ]
  },
  {
    id: 'cc-301',
    costCenterCode: 'CC-301',
    departmentName: 'Finance, Legal & Corporate Governance',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    userCount: 28,
    licenseCost: 1904.00,
    meteredUsageCost: 185.00,
    totalCost: 2089.00,
    momGrowthPercent: -1.4,
    status: 'fully_allocated',
    departmentHeadEmail: 'david.chen@contosobio.com',
    departmentHeadName: 'David Chen (CFO)',
    aiTokensConsumed: 950,
    storageGbUsed: 980,
    licenseBreakdown: [
      { sku: 'M365 E5 Suite', qty: 28, unitCost: 68.00 }
    ]
  },
  {
    id: 'cc-401',
    costCenterCode: 'CC-401',
    departmentName: 'Operations & Supply Chain Logistics',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    userCount: 55,
    licenseCost: 1210.00,
    meteredUsageCost: 215.80,
    totalCost: 1425.80,
    momGrowthPercent: 2.1,
    status: 'partial',
    departmentHeadEmail: 'marcus.vance@contosobio.com',
    departmentHeadName: 'Marcus Vance (VP Ops)',
    aiTokensConsumed: 1100,
    storageGbUsed: 1650,
    licenseBreakdown: [
      { sku: 'M365 Business Basic', qty: 55, unitCost: 22.00 }
    ]
  },
  {
    id: 'cc-501',
    costCenterCode: 'CC-501',
    departmentName: 'Executive Office & Board',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    userCount: 12,
    licenseCost: 816.00,
    meteredUsageCost: 490.00,
    totalCost: 1306.00,
    momGrowthPercent: 12.0,
    status: 'fully_allocated',
    departmentHeadEmail: 'e.vance@contosobio.com',
    departmentHeadName: 'Eleanor Vance (CEO)',
    aiTokensConsumed: 3800,
    storageGbUsed: 850,
    licenseBreakdown: [
      { sku: 'M365 E5 Suite', qty: 12, unitCost: 68.00 }
    ]
  },
  {
    id: 'cc-999',
    costCenterCode: 'CC-UNMAPPED',
    departmentName: 'Unallocated Overhead & Orphaned Seats',
    tenantId: 't-1',
    tenantName: 'Contoso Pharmaceuticals',
    userCount: 14,
    licenseCost: 1960.00,
    meteredUsageCost: 480.00,
    totalCost: 2440.00,
    momGrowthPercent: 18.2,
    status: 'unallocated',
    departmentHeadEmail: 'it-admin@contosobio.com',
    departmentHeadName: 'Unassigned (IT Overhead)',
    aiTokensConsumed: 450,
    storageGbUsed: 3200,
    licenseBreakdown: [
      { sku: 'Unassigned M365 E5', qty: 8, unitCost: 68.00 },
      { sku: 'Unassigned Business Premium', qty: 6, unitCost: 38.00 }
    ]
  }
];

const INITIAL_METERED_USERS: MeteredUserUsage[] = [
  {
    id: 'm-1',
    upn: 'samantha.reed@contosobio.com',
    userName: 'Samantha Reed',
    department: 'Global Sales & Enterprise Accounts',
    costCenterCode: 'CC-201',
    tenantName: 'Contoso Pharmaceuticals',
    aiTokensThousand: 1250,
    aiCost: 187.50,
    storageGb: 450,
    storageCost: 45.00,
    graphComputeNodes: 2,
    computeCost: 24.00,
    totalMeteredCost: 256.50,
    primaryUsageType: 'Copilot Summaries'
  },
  {
    id: 'm-2',
    upn: 'e.vance@contosobio.com',
    userName: 'Eleanor Vance',
    department: 'Executive Office & Board',
    costCenterCode: 'CC-501',
    tenantName: 'Contoso Pharmaceuticals',
    aiTokensThousand: 1800,
    aiCost: 270.00,
    storageGb: 320,
    storageCost: 32.00,
    graphComputeNodes: 3,
    computeCost: 36.00,
    totalMeteredCost: 338.00,
    primaryUsageType: 'Copilot Summaries'
  },
  {
    id: 'm-3',
    upn: 'alex.wilson@contosobio.com',
    userName: 'Alex Wilson',
    department: 'Engineering & Product Architecture',
    costCenterCode: 'CC-101',
    tenantName: 'Contoso Pharmaceuticals',
    aiTokensThousand: 920,
    aiCost: 138.00,
    storageGb: 880,
    storageCost: 88.00,
    graphComputeNodes: 4,
    computeCost: 48.00,
    totalMeteredCost: 274.00,
    primaryUsageType: 'Graph API Worker'
  },
  {
    id: 'm-4',
    upn: 'dev-automation-bot@contosobio.com',
    userName: 'DevOps Automation Service Principal',
    department: 'Engineering & Product Architecture',
    costCenterCode: 'CC-101',
    tenantName: 'Contoso Pharmaceuticals',
    aiTokensThousand: 450,
    aiCost: 67.50,
    storageGb: 120,
    storageCost: 12.00,
    graphComputeNodes: 8,
    computeCost: 96.00,
    totalMeteredCost: 175.50,
    primaryUsageType: 'Power Automate Flow'
  },
  {
    id: 'm-5',
    upn: 'david.chen@contosobio.com',
    userName: 'David Chen',
    department: 'Finance, Legal & Corporate Governance',
    costCenterCode: 'CC-301',
    tenantName: 'Contoso Pharmaceuticals',
    aiTokensThousand: 320,
    aiCost: 48.00,
    storageGb: 610,
    storageCost: 61.00,
    graphComputeNodes: 1,
    computeCost: 12.00,
    totalMeteredCost: 121.00,
    primaryUsageType: 'SharePoint Overages'
  },
  {
    id: 'm-6',
    upn: 'orphaned-temp-worker@contosobio.com',
    userName: 'Terminated Contractor Account',
    department: 'Unallocated Overhead & Orphaned Seats',
    costCenterCode: 'CC-UNMAPPED',
    tenantName: 'Contoso Pharmaceuticals',
    aiTokensThousand: 120,
    aiCost: 18.00,
    storageGb: 2400,
    storageCost: 240.00,
    graphComputeNodes: 0,
    computeCost: 0,
    totalMeteredCost: 258.00,
    primaryUsageType: 'SharePoint Overages'
  }
];

const INITIAL_ALLOCATION_RULES: AllocationRule[] = [
  {
    id: 'rule-1',
    ruleName: 'Auto-Route Engineering Department',
    entraAttribute: 'user.department',
    operator: 'CONTAINS',
    matchValue: 'Engineering',
    targetCostCenterCode: 'CC-101',
    targetDepartmentName: 'Engineering & Product Architecture',
    isActive: true,
    matchedUsersCount: 42
  },
  {
    id: 'rule-2',
    ruleName: 'Auto-Route Sales & Account Reps',
    entraAttribute: 'user.department',
    operator: 'CONTAINS',
    matchValue: 'Sales',
    targetCostCenterCode: 'CC-201',
    targetDepartmentName: 'Global Sales & Enterprise Accounts',
    isActive: true,
    matchedUsersCount: 68
  },
  {
    id: 'rule-3',
    ruleName: 'Auto-Route Finance & Legal Staff',
    entraAttribute: 'user.department',
    operator: 'CONTAINS',
    matchValue: 'Finance',
    targetCostCenterCode: 'CC-301',
    targetDepartmentName: 'Finance, Legal & Corporate Governance',
    isActive: true,
    matchedUsersCount: 28
  },
  {
    id: 'rule-4',
    ruleName: 'Executive Suite Attribute Match',
    entraAttribute: 'user.jobTitle',
    operator: 'CONTAINS',
    matchValue: 'Chief',
    targetCostCenterCode: 'CC-501',
    targetDepartmentName: 'Executive Office & Board',
    isActive: true,
    matchedUsersCount: 12
  }
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const ChargebackConsole: React.FC<ChargebackConsoleProps> = ({
  tenants = [],
  onShowToast
}) => {
  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<'department' | 'metered' | 'rules'>('department');

  // Allocation Mode: Showback vs Chargeback
  const [allocationMode, setAllocationMode] = useState<AllocationMode>('chargeback');

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [tenantFilter, setTenantFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // State Collections
  const [costCenters, setCostCenters] = useState<ChargebackCostCenter[]>(INITIAL_COST_CENTERS);
  const [meteredUsers, setMeteredUsers] = useState<MeteredUserUsage[]>(INITIAL_METERED_USERS);
  const [allocationRules, setAllocationRules] = useState<AllocationRule[]>(INITIAL_ALLOCATION_RULES);

  // Inspector Drawer State
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

  // Email Dispatch Modal State
  const [isEmailSending, setIsEmailSending] = useState(false);

  // New Rule Modal
  const [isNewRuleOpen, setIsNewRuleOpen] = useState(false);
  const [newRuleForm, setNewRuleForm] = useState<Partial<AllocationRule>>({
    ruleName: 'Auto-Route Operations Department',
    entraAttribute: 'user.department',
    operator: 'CONTAINS',
    matchValue: 'Operations',
    targetCostCenterCode: 'CC-401',
    targetDepartmentName: 'Operations & Supply Chain Logistics',
    isActive: true
  });

  // ERP Sync Modal State
  const [isSyncingErp, setIsSyncingErp] = useState(false);

  // Toast Helper
  const toast = (type: 'success' | 'info' | 'warning' | 'error', title: string, desc: string) => {
    if (onShowToast) onShowToast(type, title, desc);
  };

  // Selected Cost Center for Drawer
  const selectedCostCenter = useMemo(() => {
    return costCenters.find(cc => cc.id === selectedCostCenterId) || null;
  }, [costCenters, selectedCostCenterId]);

  // Financial Rollup KPIs
  const finRollup = useMemo(() => {
    const totalCost = costCenters.reduce((acc, cc) => acc + cc.totalCost, 0);
    const unallocatedCc = costCenters.find(cc => cc.costCenterCode === 'CC-UNMAPPED');
    const unallocatedCost = unallocatedCc ? unallocatedCc.totalCost : 0;
    const allocatedCost = totalCost - unallocatedCost;
    const allocatedPercent = totalCost > 0 ? (allocatedCost / totalCost) * 100 : 0;
    const activeCostCentersCount = costCenters.filter(cc => cc.costCenterCode !== 'CC-UNMAPPED').length;

    return {
      totalCost,
      allocatedCost,
      allocatedPercent,
      unallocatedCost,
      activeCostCentersCount
    };
  }, [costCenters]);

  // Filtered Cost Centers
  const filteredCostCenters = useMemo(() => {
    return costCenters.filter(cc => {
      const matchesSearch =
        cc.departmentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cc.costCenterCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cc.departmentHeadEmail.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesTenant = tenantFilter === 'ALL' || cc.tenantId === tenantFilter;

      let matchesStatus = true;
      if (statusFilter === 'fully_allocated') matchesStatus = cc.status === 'fully_allocated';
      if (statusFilter === 'partial') matchesStatus = cc.status === 'partial';
      if (statusFilter === 'unallocated') matchesStatus = cc.status === 'unallocated';

      return matchesSearch && matchesTenant && matchesStatus;
    });
  }, [costCenters, searchTerm, tenantFilter, statusFilter]);

  // Filtered Metered Users
  const filteredMeteredUsers = useMemo(() => {
    return meteredUsers.filter(u => {
      const matchesSearch =
        u.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.upn.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.department.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.costCenterCode.toLowerCase().includes(searchTerm.toLowerCase());

      return matchesSearch;
    });
  }, [meteredUsers, searchTerm]);

  // Reassign Unallocated Seats
  const handleReassignUnallocated = (targetCcCode: string) => {
    const targetCc = costCenters.find(c => c.costCenterCode === targetCcCode);
    if (!targetCc) return;

    setCostCenters(prev => {
      const unmapped = prev.find(c => c.costCenterCode === 'CC-UNMAPPED');
      if (!unmapped || unmapped.totalCost === 0) return prev;

      const transferAmount = 798.00; // Transfer a batch of orphaned M365 E5s

      return prev.map(c => {
        if (c.costCenterCode === 'CC-UNMAPPED') {
          return {
            ...c,
            totalCost: Math.max(0, c.totalCost - transferAmount),
            licenseCost: Math.max(0, c.licenseCost - transferAmount),
            userCount: Math.max(0, c.userCount - 8)
          };
        }
        if (c.costCenterCode === targetCcCode) {
          return {
            ...c,
            totalCost: c.totalCost + transferAmount,
            licenseCost: c.licenseCost + transferAmount,
            userCount: c.userCount + 8
          };
        }
        return c;
      });
    });

    toast('success', 'Cost Re-Allocated', `Transferred $798.00 in orphaned M365 licenses to ${targetCc.departmentName} (${targetCcCode}).`);
  };

  // Dispatch Email Statement
  const handleDispatchEmailStatement = () => {
    if (!selectedCostCenter) return;
    setIsEmailSending(true);

    setTimeout(() => {
      setIsEmailSending(false);
      toast('success', 'Statement Dispatched', `${allocationMode === 'chargeback' ? 'Binding Chargeback Invoice' : 'Informational Showback Statement'} emailed to ${selectedCostCenter.departmentHeadName} (${selectedCostCenter.departmentHeadEmail}).`);
    }, 1200);
  };

  // Add Allocation Rule
  const handleAddRule = () => {
    if (!newRuleForm.ruleName || !newRuleForm.matchValue) {
      toast('error', 'Validation Error', 'Rule Name and Match Value are required.');
      return;
    }

    const createdRule: AllocationRule = {
      id: `rule-${Date.now()}`,
      ruleName: newRuleForm.ruleName,
      entraAttribute: newRuleForm.entraAttribute || 'user.department',
      operator: (newRuleForm.operator as 'EQUALS' | 'CONTAINS' | 'STARTS_WITH') || 'CONTAINS',
      matchValue: newRuleForm.matchValue,
      targetCostCenterCode: newRuleForm.targetCostCenterCode || 'CC-401',
      targetDepartmentName: newRuleForm.targetDepartmentName || 'Operations & Supply Chain Logistics',
      isActive: true,
      matchedUsersCount: 35
    };

    setAllocationRules(prev => [createdRule, ...prev]);
    setIsNewRuleOpen(false);
    toast('success', 'Auto-Allocation Rule Created', `Rule "${createdRule.ruleName}" active for Entra ID attribute matching.`);
  };

  // ERP Sync
  const handleSyncErp = () => {
    setIsSyncingErp(true);
    setTimeout(() => {
      setIsSyncingErp(false);
      toast('success', 'ERP / PSA Ledger Synced', `Successfully posted ${costCenters.length} department chargeback entries to ConnectWise / HaloPSA Accounting Ledger.`);
    }, 1500);
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#090d16] text-[#e0e2ea] overflow-hidden font-sans">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & FINANCIAL ROLLUP BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] p-4 shrink-0 space-y-4">
        
        {/* Title & Mode Switcher Controls */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-[#0078d4]/20 to-[#a3c9ff]/10 border border-[#0078d4]/40 rounded-lg">
              <Receipt className="w-6 h-6 text-[#a3c9ff]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-[#f0f4f8] tracking-tight">M365 &amp; MSP Internal Cost Chargeback Engine</h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40">
                  /portal/chargeback
                </span>
              </div>
              <p className="text-xs text-[#8a919e]">
                Inter-company cost allocation, Graph API metered usage metering, Entra attribute routing &amp; showback reports.
              </p>
            </div>
          </div>

          {/* Mode Switcher & Primary Controls */}
          <div className="flex items-center gap-3 flex-wrap">
            
            {/* Showback vs Chargeback Toggle */}
            <div className="bg-[#181c22] border border-[#404752] p-1 rounded-lg flex items-center gap-1">
              <button
                onClick={() => {
                  setAllocationMode('showback');
                  toast('info', 'Mode Switched: Showback', 'Informational cost reporting mode active. No direct ledger transfers generated.');
                }}
                className={cn(
                  "px-3 py-1.5 rounded text-xs font-semibold transition-all flex items-center gap-1.5",
                  allocationMode === 'showback'
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold shadow-sm"
                    : "text-[#8a919e] hover:text-[#e0e2ea]"
                )}
              >
                <Info className="w-3.5 h-3.5 text-amber-400" />
                <span>Showback Mode (Informational)</span>
              </button>

              <button
                onClick={() => {
                  setAllocationMode('chargeback');
                  toast('success', 'Mode Switched: Chargeback', 'Binding internal ledger transfer mode active. Direct department line items generated.');
                }}
                className={cn(
                  "px-3 py-1.5 rounded text-xs font-semibold transition-all flex items-center gap-1.5",
                  allocationMode === 'chargeback'
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold shadow-sm"
                    : "text-[#8a919e] hover:text-[#e0e2ea]"
                )}
              >
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                <span>Chargeback Mode (Binding Ledger)</span>
              </button>
            </div>

            <button
              onClick={handleSyncErp}
              disabled={isSyncingErp}
              className="flex items-center gap-1.5 bg-[#0078d4] hover:bg-[#006cbd] text-white text-xs font-bold px-3 py-2 rounded transition-all shadow-md active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isSyncingErp ? "animate-spin" : "")} />
              <span>{isSyncingErp ? 'Syncing...' : 'Sync to ERP / PSA'}</span>
            </button>

            <button
              onClick={() => {
                toast('info', 'Exporting Chargeback Ledger', 'Generating CSV export for cost center breakdown...');
                setTimeout(() => toast('success', 'Export Complete', 'm365_chargeback_ledger_2026.csv downloaded.'), 800);
              }}
              className="flex items-center gap-1.5 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#e0e2ea] text-xs font-semibold px-3 py-2 rounded transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export Ledger CSV</span>
            </button>

          </div>
        </div>

        {/* 4 KPI Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          {/* KPI 1 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Total Monthly Tenant Spend</span>
              <div className="text-xl font-bold font-mono text-[#f0f4f8] flex items-baseline gap-1">
                <span>${finRollup.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                <span className="text-xs font-normal text-[#8a919e] font-sans">/ mo</span>
              </div>
            </div>
            <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-md">
              <DollarSign className="w-5 h-5 text-blue-400" />
            </div>
          </div>

          {/* KPI 2 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Successfully Allocated</span>
              <div className="text-xl font-bold font-mono text-emerald-400 flex items-baseline gap-2">
                <span>${finRollup.allocatedCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                <span className="text-xs font-normal text-emerald-400 font-sans">
                  ({finRollup.allocatedPercent.toFixed(1)}%)
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
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Unallocated Overhead Leakage</span>
              <div className="text-xl font-bold font-mono text-amber-400 flex items-baseline gap-2">
                <span>${finRollup.unallocatedCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                <span className="text-[10px] font-mono font-bold text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                  ATTENTION
                </span>
              </div>
            </div>
            <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-md">
              <AlertCircle className="w-5 h-5 text-amber-400" />
            </div>
          </div>

          {/* KPI 4 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Active Cost Centers</span>
              <div className="text-xl font-bold font-mono text-purple-400 flex items-baseline gap-2">
                <span>{finRollup.activeCostCentersCount} Buckets</span>
                <span className="text-xs font-normal text-[#8a919e] font-sans">Mapped</span>
              </div>
            </div>
            <div className="p-2 bg-purple-500/10 border border-purple-500/20 rounded-md">
              <Building2 className="w-5 h-5 text-purple-400" />
            </div>
          </div>

        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. COMMAND TOOLBAR & MULTI-FILTER BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] px-4 py-2.5 shrink-0 flex items-center justify-between gap-3 flex-wrap text-xs">
        
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 bg-[#181c22] p-1 rounded-md border border-[#404752] overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveTab('department')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeTab === 'department'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Department &amp; Subsidiary Breakdown ({filteredCostCenters.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('metered')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeTab === 'metered'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <Zap className="w-3.5 h-3.5 text-purple-400" />
            <span>Metered Usage &amp; AI Token Allocation</span>
          </button>

          <button
            onClick={() => setActiveTab('rules')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeTab === 'rules'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <Sliders className="w-3.5 h-3.5 text-emerald-400" />
            <span>Allocation Rules &amp; Cost Mapping</span>
          </button>
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-2 flex-wrap flex-1 justify-end">
          
          {/* Search Box */}
          <div className="relative min-w-[200px] max-w-[280px] flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e]" />
            <input
              type="text"
              placeholder="Search Dept, Cost Center, Email..."
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

          {/* Allocation Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Status: All Allocations</option>
            <option value="fully_allocated">Fully Allocated 🟢</option>
            <option value="partial">Partial Allocation 🟡</option>
            <option value="unallocated">Unallocated / Orphaned 🔴</option>
          </select>

          {(searchTerm || statusFilter !== 'ALL') && (
            <button
              onClick={() => {
                setSearchTerm('');
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
      <div className="flex-1 overflow-y-auto bg-[#090d16] p-4">
        
        {/* ======================================================================= */}
        {/* TAB 1: DEPARTMENT & SUBSIDIARY BREAKDOWN */}
        {/* ======================================================================= */}
        {activeTab === 'department' && (
          <div className="space-y-6 max-w-7xl mx-auto">
            
            {/* TOP SECTION: DEPARTMENT ALLOCATION TABLE */}
            <div className="bg-[#101419] border border-[#404752] rounded-xl overflow-hidden shadow-xl">
              <div className="p-3 bg-[#181c22] border-b border-[#404752] flex items-center justify-between text-xs">
                <span className="font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-[#a3c9ff]" />
                  <span>Cost Center Department Allocation Matrix ({filteredCostCenters.length})</span>
                </span>
                <span className="text-[#8a919e] text-[11px]">
                  Mode: <strong className={allocationMode === 'chargeback' ? "text-emerald-400" : "text-amber-400"}>{allocationMode.toUpperCase()}</strong>
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-[#e0e2ea] border-collapse">
                  <thead className="bg-[#141820] text-[#8a919e] font-mono uppercase text-[10px] border-b border-[#404752]">
                    <tr>
                      <th className="p-3">Cost Center &amp; Department</th>
                      <th className="p-3">Assigned Users</th>
                      <th className="p-3">Fixed License NCE</th>
                      <th className="p-3">Metered Consumption</th>
                      <th className="p-3">Total Allocated Spend</th>
                      <th className="p-3">MoM Growth</th>
                      <th className="p-3">Allocation Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/40">
                    {filteredCostCenters.map(cc => {
                      const isUnmapped = cc.costCenterCode === 'CC-UNMAPPED';

                      return (
                        <tr
                          key={cc.id}
                          onClick={() => {
                            setSelectedCostCenterId(cc.id);
                            setIsInspectorOpen(true);
                          }}
                          className={cn(
                            "hover:bg-[#181c22] transition-colors cursor-pointer",
                            isUnmapped ? "bg-amber-500/5 hover:bg-amber-500/10" : ""
                          )}
                        >
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "px-2 py-0.5 rounded text-[10px] font-mono font-bold border",
                                isUnmapped ? "bg-amber-500/20 text-amber-300 border-amber-500/40" : "bg-[#0078d4]/20 text-[#a3c9ff] border-[#0078d4]/40"
                              )}>
                                {cc.costCenterCode}
                              </span>
                              <span className="font-bold text-[#f0f4f8]">{cc.departmentName}</span>
                            </div>
                            <span className="text-[11px] font-mono text-[#8a919e] pl-10 block">{cc.departmentHeadName}</span>
                          </td>

                          <td className="p-3 font-mono font-bold">
                            {cc.userCount} seats
                          </td>

                          <td className="p-3 font-mono text-[#e0e2ea]">
                            ${cc.licenseCost.toFixed(2)}
                          </td>

                          <td className="p-3 font-mono text-purple-400">
                            ${cc.meteredUsageCost.toFixed(2)}
                          </td>

                          <td className="p-3 font-mono font-bold text-emerald-400 text-sm">
                            ${cc.totalCost.toFixed(2)} / mo
                          </td>

                          <td className="p-3 font-mono">
                            <span className={cn(
                              "flex items-center gap-1 font-bold",
                              cc.momGrowthPercent > 10 ? "text-red-400" : cc.momGrowthPercent > 0 ? "text-amber-400" : "text-emerald-400"
                            )}>
                              {cc.momGrowthPercent > 0 ? `+${cc.momGrowthPercent}%` : `${cc.momGrowthPercent}%`}
                            </span>
                          </td>

                          <td className="p-3">
                            {cc.status === 'fully_allocated' && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                FULLY ALLOCATED 🟢
                              </span>
                            )}
                            {cc.status === 'partial' && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                                PARTIAL ALLOCATION 🟡
                              </span>
                            )}
                            {cc.status === 'unallocated' && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-red-500/10 text-red-400 border border-red-500/30">
                                UNALLOCATED LEAK 🔴
                              </span>
                            )}
                          </td>

                          <td className="p-3 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCostCenterId(cc.id);
                                setIsInspectorOpen(true);
                              }}
                              className="px-2.5 py-1 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#a3c9ff] rounded text-[11px] font-mono"
                            >
                              Inspect Cost Center
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* BOTTOM SECTION: VISUAL COST DISTRIBUTION & UNALLOCATED RECOVERY */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Cost Share Donut / Bar Visual Distribution */}
              <div className="bg-[#101419] border border-[#404752] rounded-xl p-4 space-y-4 shadow-lg">
                <h3 className="text-xs font-bold font-mono text-[#8a919e] uppercase tracking-wider flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-[#a3c9ff]" />
                  <span>Cost Share Distribution by Department</span>
                </h3>

                <div className="space-y-3">
                  {costCenters.map(cc => {
                    const percent = finRollup.totalCost > 0 ? (cc.totalCost / finRollup.totalCost) * 100 : 0;
                    let barColor = 'bg-[#0078d4]';
                    if (cc.costCenterCode === 'CC-UNMAPPED') barColor = 'bg-amber-500';
                    if (cc.costCenterCode === 'CC-201') barColor = 'bg-purple-500';

                    return (
                      <div key={cc.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-[#f0f4f8]">{cc.departmentName}</span>
                          <span className="font-mono text-[#8a919e]">
                            ${cc.totalCost.toFixed(2)} ({percent.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="w-full bg-[#181c22] h-2 rounded-full overflow-hidden border border-[#404752]">
                          <div
                            className={cn("h-full transition-all duration-500", barColor)}
                            style={{ width: `${percent}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Unallocated Overhead Recovery Action Card */}
              <div className="bg-[#101419] border border-amber-500/30 rounded-xl p-4 space-y-4 shadow-lg flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-amber-400">
                    <ShieldAlert className="w-5 h-5" />
                    <h3 className="text-xs font-bold font-mono uppercase tracking-wider">
                      Unallocated Overhead Recovery &amp; Re-Assignment
                    </h3>
                  </div>

                  <p className="text-xs text-[#8a919e]">
                    Detected <strong className="text-amber-300">$2,440.00 / mo</strong> in unmapped M365 seats and orphan accounts not attributed to an Entra ID department code.
                  </p>

                  <div className="bg-[#181c22] border border-[#404752] p-3 rounded-lg space-y-2 text-xs">
                    <div className="flex justify-between font-mono">
                      <span className="text-[#8a919e]">Unassigned M365 E5 Licenses:</span>
                      <span className="font-bold text-amber-400">8 Licenses ($544.00/mo)</span>
                    </div>
                    <div className="flex justify-between font-mono">
                      <span className="text-[#8a919e]">Unassigned Business Premium:</span>
                      <span className="font-bold text-amber-400">6 Licenses ($228.00/mo)</span>
                    </div>
                    <div className="flex justify-between font-mono">
                      <span className="text-[#8a919e]">Orphaned Storage Overages:</span>
                      <span className="font-bold text-amber-400">3.2 TB ($1,668.00/mo)</span>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-[#404752] flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] text-[#8a919e] font-mono">1-Click Auto-Reassign to Department:</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReassignUnallocated('CC-101')}
                      className="px-2.5 py-1.5 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-xs font-mono font-semibold text-[#a3c9ff] rounded"
                    >
                      + Reassign to Engineering
                    </button>
                    <button
                      onClick={() => handleReassignUnallocated('CC-201')}
                      className="px-2.5 py-1.5 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-xs font-mono font-semibold text-purple-300 rounded"
                    >
                      + Reassign to Sales
                    </button>
                  </div>
                </div>
              </div>

            </div>

          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 2: METERED USAGE & AI CONSUMPTION ALLOCATION */}
        {/* ======================================================================= */}
        {activeTab === 'metered' && (
          <div className="space-y-4 max-w-7xl mx-auto">
            <div className="bg-[#101419] border border-[#404752] rounded-xl overflow-hidden shadow-xl">
              <div className="p-3 bg-[#181c22] border-b border-[#404752] flex items-center justify-between text-xs">
                <span className="font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center gap-2">
                  <Zap className="w-4 h-4 text-purple-400" />
                  <span>Itemized Metered Usage &amp; AI Copilot Token Allocation</span>
                </span>
                <span className="text-[#8a919e] text-[11px]">Real-Time Graph API Telemetry</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-[#e0e2ea] border-collapse">
                  <thead className="bg-[#141820] text-[#8a919e] font-mono uppercase text-[10px] border-b border-[#404752]">
                    <tr>
                      <th className="p-3">User UPN &amp; Name</th>
                      <th className="p-3">Department &amp; Cost Center</th>
                      <th className="p-3">AI Copilot Tokens</th>
                      <th className="p-3">SharePoint Storage</th>
                      <th className="p-3">Graph Compute Nodes</th>
                      <th className="p-3">Total Metered Charge</th>
                      <th className="p-3">Primary Activity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/40">
                    {filteredMeteredUsers.map(user => (
                      <tr key={user.id} className="hover:bg-[#181c22] transition-colors">
                        <td className="p-3">
                          <div className="font-bold text-[#f0f4f8]">{user.userName}</div>
                          <div className="text-[11px] font-mono text-[#8a919e]">{user.upn}</div>
                        </td>

                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/30 mr-2">
                            {user.costCenterCode}
                          </span>
                          <span className="text-[#8a919e]">{user.department}</span>
                        </td>

                        <td className="p-3 font-mono">
                          <span className="font-bold text-purple-400">{user.aiTokensThousand.toLocaleString()}k Tokens</span>
                          <span className="text-[10px] text-[#8a919e] block">${user.aiCost.toFixed(2)}</span>
                        </td>

                        <td className="p-3 font-mono">
                          <span className="font-bold text-[#e0e2ea]">{user.storageGb} GB</span>
                          <span className="text-[10px] text-[#8a919e] block">${user.storageCost.toFixed(2)}</span>
                        </td>

                        <td className="p-3 font-mono">
                          <span className="font-bold text-blue-400">{user.graphComputeNodes} Nodes</span>
                          <span className="text-[10px] text-[#8a919e] block">${user.computeCost.toFixed(2)}</span>
                        </td>

                        <td className="p-3 font-mono font-bold text-emerald-400 text-sm">
                          ${user.totalMeteredCost.toFixed(2)}
                        </td>

                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#181c22] border border-[#404752] text-[#a3c9ff]">
                            {user.primaryUsageType}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 3: ALLOCATION RULES & COST CENTER MAPPING */}
        {/* ======================================================================= */}
        {activeTab === 'rules' && (
          <div className="space-y-4 max-w-7xl mx-auto">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold font-mono text-[#f0f4f8] uppercase tracking-wider">
                  Entra ID Attribute Auto-Allocation Rules ({allocationRules.length})
                </h2>
                <p className="text-xs text-[#8a919e]">
                  Automatically route M365 user seat costs and metered usage to specific cost centers based on user claims.
                </p>
              </div>

              <button
                onClick={() => setIsNewRuleOpen(true)}
                className="flex items-center gap-1.5 bg-[#0078d4] hover:bg-[#006cbd] text-white text-xs font-bold px-3 py-2 rounded transition-all shadow-md"
              >
                <Plus className="w-4 h-4" />
                <span>Create Auto-Allocation Rule</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {allocationRules.map(rule => (
                <div key={rule.id} className="bg-[#101419] border border-[#404752] rounded-xl p-4 space-y-3 shadow-lg">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-xs font-bold text-[#f0f4f8]">{rule.ruleName}</h3>
                      <span className="text-[11px] font-mono text-[#8a919e]">Target: {rule.targetDepartmentName}</span>
                    </div>

                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      ACTIVE
                    </span>
                  </div>

                  <div className="bg-[#181c22] border border-[#404752] p-2.5 rounded font-mono text-xs text-[#a3c9ff]">
                    IF <strong className="text-white">{rule.entraAttribute}</strong> {rule.operator} &quot;<strong className="text-emerald-400">{rule.matchValue}</strong>&quot; ➔ ROUTE TO <strong className="text-purple-300">{rule.targetCostCenterCode}</strong>
                  </div>

                  <div className="flex items-center justify-between text-xs text-[#8a919e] font-mono pt-2 border-t border-[#404752]">
                    <span>Matched Users: {rule.matchedUsersCount} Users</span>
                    <button
                      onClick={() => {
                        toast('info', 'Batch Re-allocation Executed', `Re-evaluated rule "${rule.ruleName}". Mapped ${rule.matchedUsersCount} users.`);
                      }}
                      className="text-[#a3c9ff] hover:underline"
                    >
                      Run Batch Re-allocation
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* 4. COST CENTER INSPECTOR DRAWER */}
      {/* ========================================================================= */}
      {isInspectorOpen && selectedCostCenter && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex justify-end transition-opacity">
          <div className="w-full max-w-xl bg-[#101419] border-l border-[#404752] h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            
            {/* Header */}
            <div className="p-4 bg-[#181c22] border-b border-[#404752] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-[#a3c9ff]" />
                <div>
                  <h2 className="text-sm font-bold text-[#f0f4f8]">{selectedCostCenter.departmentName}</h2>
                  <span className="text-[11px] font-mono text-[#8a919e]">{selectedCostCenter.costCenterCode} &bull; {selectedCostCenter.departmentHeadName}</span>
                </div>
              </div>

              <button
                onClick={() => setIsInspectorOpen(false)}
                className="text-[#8a919e] hover:text-[#e0e2ea] p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              
              {/* Financial Summary Box */}
              <div className="bg-[#181c22] border border-[#404752] p-4 rounded-xl space-y-3">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs font-mono text-[#8a919e] uppercase">Total Monthly Cost Center Spend</span>
                  <div className="text-2xl font-bold font-mono text-emerald-400">
                    ${selectedCostCenter.totalCost.toFixed(2)} / mo
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-2 border-t border-[#404752]">
                  <div>
                    <span className="text-[#8a919e] block">Fixed License NCE:</span>
                    <strong className="text-[#e0e2ea]">${selectedCostCenter.licenseCost.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span className="text-[#8a919e] block">Metered Usage:</span>
                    <strong className="text-purple-400">${selectedCostCenter.meteredUsageCost.toFixed(2)}</strong>
                  </div>
                </div>
              </div>

              {/* License SKU Breakdown */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold font-mono text-[#8a919e] uppercase">Assigned M365 License Breakdown</h3>
                <div className="bg-[#181c22] border border-[#404752] rounded-lg divide-y divide-[#404752]/40 text-xs">
                  {selectedCostCenter.licenseBreakdown.map((item, idx) => (
                    <div key={idx} className="p-3 flex items-center justify-between font-mono">
                      <div>
                        <div className="font-bold text-[#f0f4f8]">{item.sku}</div>
                        <span className="text-[10px] text-[#8a919e]">{item.qty} Seats @ ${item.unitCost.toFixed(2)}/seat</span>
                      </div>
                      <div className="font-bold text-emerald-400">
                        ${(item.qty * item.unitCost).toFixed(2)}/mo
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Metered Telemetry */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold font-mono text-[#8a919e] uppercase">Graph API Metered Telemetry</h3>
                <div className="bg-[#181c22] border border-[#404752] p-3 rounded-lg space-y-2 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-[#8a919e]">AI Copilot Tokens Consumed:</span>
                    <span className="font-bold text-purple-400">{selectedCostCenter.aiTokensConsumed.toLocaleString()}k Tokens</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8a919e]">SharePoint / Exchange Storage:</span>
                    <span className="font-bold text-[#e0e2ea]">{selectedCostCenter.storageGbUsed} GB</span>
                  </div>
                </div>
              </div>

            </div>

            {/* Footer Dispatch Control */}
            <div className="p-4 bg-[#181c22] border-t border-[#404752] flex items-center justify-between gap-3">
              <div className="text-xs text-[#8a919e]">
                Target: <strong className="text-[#e0e2ea]">{selectedCostCenter.departmentHeadEmail}</strong>
              </div>

              <button
                onClick={handleDispatchEmailStatement}
                disabled={isEmailSending}
                className="flex items-center gap-1.5 bg-[#0078d4] hover:bg-[#006cbd] text-white text-xs font-bold px-4 py-2 rounded transition-all shadow-md disabled:opacity-50"
              >
                <Mail className="w-4 h-4" />
                <span>{isEmailSending ? 'Sending Statement...' : 'Dispatch Statement Email'}</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. NEW RULE MODAL */}
      {/* ========================================================================= */}
      {isNewRuleOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#101419] border border-[#404752] rounded-xl overflow-hidden shadow-2xl space-y-4 p-5">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <h3 className="text-sm font-bold text-[#f0f4f8]">New Auto-Allocation Rule</h3>
              <button onClick={() => setIsNewRuleOpen(false)} className="text-[#8a919e] hover:text-[#e0e2ea]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[#8a919e] font-mono block mb-1">Rule Name</label>
                <input
                  type="text"
                  value={newRuleForm.ruleName}
                  onChange={(e) => setNewRuleForm({ ...newRuleForm, ruleName: e.target.value })}
                  className="w-full bg-[#181c22] border border-[#404752] rounded p-2 text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
                />
              </div>

              <div>
                <label className="text-[#8a919e] font-mono block mb-1">Entra ID Attribute</label>
                <select
                  value={newRuleForm.entraAttribute}
                  onChange={(e) => setNewRuleForm({ ...newRuleForm, entraAttribute: e.target.value })}
                  className="w-full bg-[#181c22] border border-[#404752] rounded p-2 text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
                >
                  <option value="user.department">user.department</option>
                  <option value="user.jobTitle">user.jobTitle</option>
                  <option value="user.companyName">user.companyName</option>
                </select>
              </div>

              <div>
                <label className="text-[#8a919e] font-mono block mb-1">Match Value</label>
                <input
                  type="text"
                  value={newRuleForm.matchValue}
                  onChange={(e) => setNewRuleForm({ ...newRuleForm, matchValue: e.target.value })}
                  className="w-full bg-[#181c22] border border-[#404752] rounded p-2 text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-[#404752] flex justify-end gap-2">
              <button
                onClick={() => setIsNewRuleOpen(false)}
                className="px-3 py-1.5 bg-[#181c22] border border-[#404752] rounded text-xs text-[#e0e2ea]"
              >
                Cancel
              </button>
              <button
                onClick={handleAddRule}
                className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#006cbd] text-white rounded text-xs font-bold"
              >
                Save Rule
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

