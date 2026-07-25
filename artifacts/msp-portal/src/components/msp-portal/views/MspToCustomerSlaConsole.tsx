// @ts-nocheck
import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock,
  ShieldCheck,
  Zap,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  TrendingUp,
  BarChart3,
  Users,
  FileText,
  Download,
  RefreshCw,
  Search,
  Filter,
  SlidersHorizontal,
  Sparkles,
  Scale,
  Target,
  Activity,
  Check,
  ChevronRight,
  X,
  Building2,
  Lock,
  Unlock,
  ArrowRight,
  ChevronDown,
  Plus,
  Settings,
  ShieldAlert,
  Flame,
  Award,
  Calendar,
  AlertCircle,
  TrendingDown,
  Info,
  DollarSign,
  PieChart,
  Edit,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tenant } from '../types';
import { AlertResolutionWizardModal, AlertWizardPayload } from '../common/AlertResolutionWizardModal';

export interface TenantMspSla {
  tenantId: string;
  tenantName: string;
  primaryDomain: string;
  slaTier: 'Platinum' | 'Gold' | 'Silver';
  monthlyAttainment: number; // e.g. 99.4
  targetAttainment: number; // e.g. 99.0
  mttdMinutes: number; // e.g. 3.2
  mttrMinutes: number; // e.g. 6.5
  totalIncidents: number;
  autoHealedIncidents: number;
  activeBreaches: number;
  status: 'met' | 'at_risk' | 'breached';
  monthlyRetainerUsd: number;
  pillarBreakdown: {
    identity: number;
    caPolicy: number;
    device: number;
    mailFlow: number;
  };
  breachLogs: Array<{
    id: string;
    date: string;
    title: string;
    cause: string;
    impact: string;
    techAssigned: string;
    resolutionTimeMins: number;
  }>;
}

export interface SlaTrackerIncident {
  id: string;
  tenantId: string;
  tenantName: string;
  title: string;
  detectedAt: string;
  slaDeadline: string;
  remainingSeconds: number; // live countdown
  handler: string;
  severity: 'critical' | 'high' | 'warning';
  isAutoHealable: boolean;
  status: 'active' | 'remediated' | 'breached';
  category: string;
}

interface MspToCustomerSlaConsoleProps {
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

// Mock Data: 8+ Tenant SLA Records
const INITIAL_TENANT_SLAS: TenantMspSla[] = [
  {
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    primaryDomain: 'contoso.onmicrosoft.com',
    slaTier: 'Platinum',
    monthlyAttainment: 99.4,
    targetAttainment: 99.0,
    mttdMinutes: 3.1,
    mttrMinutes: 6.2,
    totalIncidents: 45,
    autoHealedIncidents: 42,
    activeBreaches: 0,
    status: 'met',
    monthlyRetainerUsd: 12500,
    pillarBreakdown: { identity: 99.8, caPolicy: 99.1, device: 98.9, mailFlow: 99.7 },
    breachLogs: [],
  },
  {
    tenantId: 'fabrikam-02',
    tenantName: 'Fabrikam Inc',
    primaryDomain: 'fabrikam.onmicrosoft.com',
    slaTier: 'Platinum',
    monthlyAttainment: 98.8,
    targetAttainment: 99.0,
    mttdMinutes: 3.4,
    mttrMinutes: 11.5,
    totalIncidents: 31,
    autoHealedIncidents: 28,
    activeBreaches: 0,
    status: 'at_risk',
    monthlyRetainerUsd: 8400,
    pillarBreakdown: { identity: 99.0, caPolicy: 98.2, device: 98.5, mailFlow: 99.5 },
    breachLogs: [
      {
        id: 'BRC-1092',
        date: '2026-07-11 14:20 UTC',
        title: 'CA Policy Drift Delayed Approval',
        cause: 'Technician manual confirmation delayed past 15m window during shift handover.',
        impact: 'SLA timer exceeded target by 4 minutes.',
        techAssigned: 'tech.alex@msp.com',
        resolutionTimeMins: 19,
      },
    ],
  },
  {
    tenantId: 'northwind-03',
    tenantName: 'Northwind Traders',
    primaryDomain: 'northwind.onmicrosoft.com',
    slaTier: 'Gold',
    monthlyAttainment: 96.5,
    targetAttainment: 95.0,
    mttdMinutes: 4.2,
    mttrMinutes: 22.0,
    totalIncidents: 60,
    autoHealedIncidents: 54,
    activeBreaches: 0,
    status: 'met',
    monthlyRetainerUsd: 6200,
    pillarBreakdown: { identity: 97.2, caPolicy: 96.1, device: 95.8, mailFlow: 97.0 },
    breachLogs: [],
  },
  {
    tenantId: 'woodgrove-04',
    tenantName: 'Woodgrove Bank',
    primaryDomain: 'woodgrovebank.com',
    slaTier: 'Platinum',
    monthlyAttainment: 99.8,
    targetAttainment: 99.0,
    mttdMinutes: 2.8,
    mttrMinutes: 4.1,
    totalIncidents: 90,
    autoHealedIncidents: 89,
    activeBreaches: 0,
    status: 'met',
    monthlyRetainerUsd: 22000,
    pillarBreakdown: { identity: 100.0, caPolicy: 99.7, device: 99.5, mailFlow: 100.0 },
    breachLogs: [],
  },
  {
    tenantId: 'adventure-05',
    tenantName: 'AdventureWorks',
    primaryDomain: 'adventureworks.com',
    slaTier: 'Gold',
    monthlyAttainment: 93.8,
    targetAttainment: 95.0,
    mttdMinutes: 4.8,
    mttrMinutes: 48.0,
    totalIncidents: 25,
    autoHealedIncidents: 19,
    activeBreaches: 1,
    status: 'breached',
    monthlyRetainerUsd: 5500,
    pillarBreakdown: { identity: 94.0, caPolicy: 92.5, device: 94.1, mailFlow: 94.5 },
    breachLogs: [
      {
        id: 'BRC-1088',
        date: '2026-07-20 09:15 UTC',
        title: 'Exchange Transport Rule Failure',
        cause: 'API credential lock out on legacy service principal during overnight maintenance.',
        impact: 'Remediation clock ran for 1h 12m (SLA target 1h). 5% credit liability incurred.',
        techAssigned: 'tech.sara@msp.com',
        resolutionTimeMins: 72,
      },
    ],
  },
  {
    tenantId: 'tailspin-06',
    tenantName: 'Tailspin Toys',
    primaryDomain: 'tailspintoys.com',
    slaTier: 'Silver',
    monthlyAttainment: 92.5,
    targetAttainment: 90.0,
    mttdMinutes: 5.1,
    mttrMinutes: 112.0,
    totalIncidents: 18,
    autoHealedIncidents: 12,
    activeBreaches: 0,
    status: 'met',
    monthlyRetainerUsd: 3200,
    pillarBreakdown: { identity: 93.0, caPolicy: 91.5, device: 92.0, mailFlow: 93.5 },
    breachLogs: [],
  },
  {
    tenantId: 'trey-07',
    tenantName: 'Trey Research',
    primaryDomain: 'treyresearch.net',
    slaTier: 'Gold',
    monthlyAttainment: 97.8,
    targetAttainment: 95.0,
    mttdMinutes: 3.9,
    mttrMinutes: 19.5,
    totalIncidents: 35,
    autoHealedIncidents: 33,
    activeBreaches: 0,
    status: 'met',
    monthlyRetainerUsd: 7800,
    pillarBreakdown: { identity: 98.2, caPolicy: 97.5, device: 97.1, mailFlow: 98.4 },
    breachLogs: [],
  },
  {
    tenantId: 'alpine-08',
    tenantName: 'Alpine Ski House',
    primaryDomain: 'alpineskihouse.com',
    slaTier: 'Silver',
    monthlyAttainment: 88.2,
    targetAttainment: 90.0,
    mttdMinutes: 6.5,
    mttrMinutes: 195.0,
    totalIncidents: 12,
    autoHealedIncidents: 8,
    activeBreaches: 1,
    status: 'breached',
    monthlyRetainerUsd: 2800,
    pillarBreakdown: { identity: 89.0, caPolicy: 87.0, device: 88.5, mailFlow: 88.1 },
    breachLogs: [
      {
        id: 'BRC-1074',
        date: '2026-07-15 18:00 UTC',
        title: 'Intune Device Encryption Delay',
        cause: 'End user deferred reboot for BitLocker installation for 6 hours.',
        impact: 'Exceeded 4h Silver SLA tier window.',
        techAssigned: 'tech.mike@msp.com',
        resolutionTimeMins: 240,
      },
    ],
  },
];

// Mock Data: Active SLA Countdown Incidents
const INITIAL_INCIDENTS: SlaTrackerIncident[] = [
  {
    id: 'INC-9941',
    tenantId: 'contoso-01',
    tenantName: 'Contoso Corporation',
    title: 'Global Admin MFA Policy Converted to Report-Only',
    category: 'Conditional Access',
    detectedAt: '22:42:01 UTC',
    slaDeadline: '22:57:01 UTC (15m SLA)',
    remainingSeconds: 285, // ~4m 45s remaining
    handler: 'Auto-Heal Engine',
    severity: 'critical',
    isAutoHealable: true,
    status: 'active',
  },
  {
    id: 'INC-9940',
    tenantId: 'fabrikam-02',
    tenantName: 'Fabrikam Inc',
    title: 'External Auto-Forwarding Rule Added to CFO Mailbox',
    category: 'Exchange Online',
    detectedAt: '22:28:15 UTC',
    slaDeadline: '22:43:15 UTC (15m SLA)',
    remainingSeconds: -120, // Breached by 2 minutes
    handler: 'tech.alex@msp.com',
    severity: 'critical',
    isAutoHealable: false,
    status: 'breached',
  },
  {
    id: 'INC-9939',
    tenantId: 'northwind-03',
    tenantName: 'Northwind Traders',
    title: 'High-Risk Impossible Travel Authentication Detected',
    category: 'Identity Guard',
    detectedAt: '22:15:30 UTC',
    slaDeadline: '23:15:30 UTC (1h SLA)',
    remainingSeconds: 1340, // ~22m remaining
    handler: 'Auto-Heal Engine',
    severity: 'high',
    isAutoHealable: true,
    status: 'active',
  },
  {
    id: 'INC-9938',
    tenantId: 'adventure-05',
    tenantName: 'AdventureWorks',
    title: 'Intune Endpoint Compliance Baseline Violation',
    category: 'Intune MDM',
    detectedAt: '21:50:00 UTC',
    slaDeadline: '22:50:00 UTC (1h SLA)',
    remainingSeconds: 180, // 3m remaining
    handler: 'tech.sara@msp.com',
    severity: 'warning',
    isAutoHealable: true,
    status: 'active',
  },
  {
    id: 'INC-9937',
    tenantId: 'woodgrove-04',
    tenantName: 'Woodgrove Bank',
    title: 'Defender Anti-Phishing Aggressive Threshold Drift',
    category: 'Defender Security',
    detectedAt: '21:10:00 UTC',
    slaDeadline: '21:25:00 UTC (15m SLA)',
    remainingSeconds: 0,
    handler: 'Auto-Heal Engine',
    severity: 'warning',
    isAutoHealable: true,
    status: 'remediated',
  },
];

export const MspToCustomerSlaConsole: React.FC<MspToCustomerSlaConsoleProps> = ({
  tenants = [],
  selectedTenant,
  onSelectTenant,
  onShowToast,
  onExecuteWorkflow,
}) => {
  // State
  const [tenantSlas, setTenantSlas] = useState<TenantMspSla[]>(INITIAL_TENANT_SLAS);
  const [incidents, setIncidents] = useState<SlaTrackerIncident[]>(INITIAL_INCIDENTS);
  
  const [activeTab, setActiveTab] = useState<'matrix' | 'tracker' | 'policies'>('matrix');
  const [selectedInspectTenant, setSelectedInspectTenant] = useState<TenantMspSla | null>(null);

  // Sorting from top KPI cards
  const [sortKey, setSortKey] = useState<'attainment' | 'mttd' | 'mttr' | 'autoheal' | null>(null);
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // Wizard Modal state for SLA tenant items
  const [wizardAlert, setWizardAlert] = useState<AlertWizardPayload | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false);

  const handleCardSort = (key: 'attainment' | 'mttd' | 'mttr' | 'autoheal') => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'mttd' || key === 'mttr' ? true : false); // Default ascending for time metrics
    }
    setActiveTab('matrix');
  };

  const handleOpenWizardForTenant = (item: TenantMspSla) => {
    setWizardAlert({
      id: `SLA-${item.tenantId}`,
      code: `SLA-${item.slaTier.toUpperCase()}`,
      title: `${item.tenantName} - SLA Performance & Contract Restoration`,
      tenantId: item.tenantId,
      tenantName: item.tenantName,
      category: 'SLA Remediation',
      severity: item.status === 'breached' ? 'critical' : item.status === 'at_risk' ? 'high' : 'medium',
      targetResource: item.primaryDomain,
      description: `Monthly SLA Attainment: ${item.monthlyAttainment}% (Target Goal: ${item.targetAttainment}%). MTTD: ${item.mttdMinutes}m, MTTR: ${item.mttrMinutes}m. Active breaches: ${item.activeBreaches}.`,
      detectedAt: 'Live Telemetry',
      riskNotificationType: 'SLA Attainment Drift',
      matchedSopCode: 'SOP-SLA-01',
      isOutOfScope: item.status === 'breached',
      outOfScopeReason: item.status === 'breached' ? 'SLA breach requires contract remediation or tier upgrade.' : undefined,
      upgradeEstimate: '$250.00 Ad-Hoc SLA Remediation Fee',
      rootCauseAnalysis: `SLA attainment deficit of ${(item.targetAttainment - item.monthlyAttainment).toFixed(1)}% for ${item.tenantName} driven by ${item.activeBreaches} active policy drift events across ${item.primaryDomain}.`,
      graphEndpoint: `/v1.0/tenants/${item.tenantId}/sla/remediate`,
      slaTier: item.slaTier,
      monthlyAttainment: item.monthlyAttainment,
      targetAttainment: item.targetAttainment,
      mttdMinutes: item.mttdMinutes,
      mttrMinutes: item.mttrMinutes,
      activeBreaches: item.activeBreaches,
      autoHealedIncidents: item.autoHealedIncidents,
      status: item.status,
      primaryDomain: item.primaryDomain,
    });
    setIsWizardOpen(true);
  };

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTierFilter, setSelectedTierFilter] = useState<string>('All Tiers');
  const [selectedHealthFilter, setSelectedHealthFilter] = useState<string>('All');
  const [timeHorizonFilter, setTimeHorizonFilter] = useState<string>('This Month');

  // Penalty Calculator State
  const [penaltyCreditPercentage, setPenaltyCreditPercentage] = useState<number>(5);
  const [penaltyThresholdAttainment, setPenaltyThresholdAttainment] = useState<number>(95);

  // Live Timer Ticker for Open SLA Incidents
  useEffect(() => {
    const timer = setInterval(() => {
      setIncidents((prev) =>
        prev.map((inc) => {
          if (inc.status === 'remediated') return inc;

          const nextSec = inc.remainingSeconds - 1;
          let nextStatus = inc.status;

          if (nextSec < 0 && inc.status === 'active') {
            nextStatus = 'breached';
          }

          return { ...inc, remainingSeconds: nextSec, status: nextStatus };
        })
      );
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Overall Global KPI Metrics
  const globalMetrics = useMemo(() => {
    const totalClients = tenantSlas.length;
    const sumAttainment = tenantSlas.reduce((acc, curr) => acc + curr.monthlyAttainment, 0);
    const avgAttainment = (sumAttainment / (totalClients || 1)).toFixed(1);

    const sumMttd = tenantSlas.reduce((acc, curr) => acc + curr.mttdMinutes, 0);
    const avgMttd = (sumMttd / (totalClients || 1)).toFixed(1);

    const sumMttr = tenantSlas.reduce((acc, curr) => acc + curr.mttrMinutes, 0);
    const avgMttr = (sumMttr / (totalClients || 1)).toFixed(1);

    const totalIncs = tenantSlas.reduce((acc, curr) => acc + curr.totalIncidents, 0);
    const totalAutoHealed = tenantSlas.reduce((acc, curr) => acc + curr.autoHealedIncidents, 0);
    const autoHealPct = ((totalAutoHealed / (totalIncs || 1)) * 100).toFixed(1);

    const totalBreaches = tenantSlas.reduce((acc, curr) => acc + curr.activeBreaches, 0);

    // Calculate total potential credit liability
    const breachedClients = tenantSlas.filter((t) => t.monthlyAttainment < penaltyThresholdAttainment);
    const totalRetainerLiability = breachedClients.reduce(
      (acc, curr) => acc + curr.monthlyRetainerUsd * (penaltyCreditPercentage / 100),
      0
    );

    return {
      avgAttainment: Number(avgAttainment),
      avgMttd,
      avgMttr,
      autoHealPct,
      totalBreaches,
      totalRetainerLiability,
    };
  }, [tenantSlas, penaltyCreditPercentage, penaltyThresholdAttainment]);

  // Filtered Tenant SLA Matrix
  const filteredTenantSlas = useMemo(() => {
    const list = tenantSlas.filter((item) => {
      // Tier Filter
      if (selectedTierFilter !== 'All Tiers') {
        const tier = selectedTierFilter.split(' ')[0]; // Platinum, Gold, Silver
        if (item.slaTier !== tier) return false;
      }

      // Health Filter
      if (selectedHealthFilter === 'Met' && item.status !== 'met') return false;
      if (selectedHealthFilter === 'At Risk' && item.status !== 'at_risk') return false;
      if (selectedHealthFilter === 'Breached' && item.status !== 'breached') return false;

      // Search Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.tenantName.toLowerCase().includes(q);
        const matchesDomain = item.primaryDomain.toLowerCase().includes(q);
        const matchesTier = item.slaTier.toLowerCase().includes(q);

        return matchesName || matchesDomain || matchesTier;
      }

      return true;
    });

    if (sortKey) {
      list.sort((a, b) => {
        let valA = 0;
        let valB = 0;
        if (sortKey === 'attainment') {
          valA = a.monthlyAttainment;
          valB = b.monthlyAttainment;
        } else if (sortKey === 'mttd') {
          valA = a.mttdMinutes;
          valB = b.mttdMinutes;
        } else if (sortKey === 'mttr') {
          valA = a.mttrMinutes;
          valB = b.mttrMinutes;
        } else if (sortKey === 'autoheal') {
          valA = a.autoHealedIncidents;
          valB = b.autoHealedIncidents;
        }

        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
      });
    }

    return list;
  }, [tenantSlas, selectedTierFilter, selectedHealthFilter, searchQuery, sortKey, sortAsc]);

  // Filtered Incidents
  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          inc.tenantName.toLowerCase().includes(q) ||
          inc.title.toLowerCase().includes(q) ||
          inc.id.toLowerCase().includes(q) ||
          inc.category.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [incidents, searchQuery]);

  // Format Timer Display
  const formatCountdown = (seconds: number) => {
    if (seconds < 0) {
      const absSec = Math.abs(seconds);
      const m = Math.floor(absSec / 60);
      const s = absSec % 60;
      return `🚨 BREACHED +${m}m ${s < 10 ? '0' : ''}${s}s`;
    }

    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `⏱️ ${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s} Remaining`;
  };

  // Dispatch Auto-Heal for Incident
  const handleResolveIncident = (incident: SlaTrackerIncident) => {
    setIncidents((prev) =>
      prev.map((i) => (i.id === incident.id ? { ...i, status: 'remediated' } : i))
    );

    // Update Tenant SLA stats
    setTenantSlas((prev) =>
      prev.map((t) => {
        if (t.tenantId === incident.tenantId) {
          return {
            ...t,
            autoHealedIncidents: t.autoHealedIncidents + 1,
            totalIncidents: t.totalIncidents + 1,
          };
        }
        return t;
      })
    );

    onExecuteWorkflow?.('sla-auto-heal-remediation', { incidentId: incident.id, tenantId: incident.tenantId });
    onShowToast?.(
      'success',
      'SLA Clock Stopped - Issue Remediated',
      `Auto-Healed "${incident.title}" for ${incident.tenantName}. SLA target maintained.`
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-[#e0e2ea] font-sans overflow-hidden select-none">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & GLOBAL MSP SLA PERFORMANCE BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] p-4 lg:p-5 shrink-0 space-y-4 shadow-md">
        
        {/* Top Header Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[#0078d4]/20 border border-[#0078d4] flex items-center justify-center text-[#a3c9ff] shrink-0 font-mono">
              <Scale className="w-5 h-5 text-[#0078d4]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold text-[#e0e2ea] tracking-tight">
                  MSP-to-Customer SLA Delivery & Compliance Console
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                  /portal/msp-sla
                </span>
              </div>

              <div className="text-xs text-[#8a919e] flex items-center gap-2 mt-0.5">
                <span>Proof of Performance Engine</span>
                <span>•</span>
                <span className="text-[#4ade80] text-[11px] font-mono flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Contractual Guarantee Monitoring Active
                </span>
              </div>
            </div>
          </div>

          {/* Action Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                onShowToast?.(
                  'success',
                  'SLA Telemetry Refreshed',
                  'Re-calculated real-time MTTD, MTTR, and client contractual SLA scores.'
                );
              }}
              className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh SLA Telemetry</span>
            </button>

            <button
              onClick={() => setActiveTab('policies')}
              className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Settings className="w-3.5 h-3.5 text-purple-400" />
              <span>Configure SLA Baselines</span>
            </button>

            <button
              onClick={() => {
                onShowToast?.(
                  'success',
                  'MSP SLA Audit Report PDF Generated',
                  'Exported multi-tenant SLA compliance report for QBR presentations.'
                );
              }}
              className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Generate QBR SLA Audit PDF</span>
            </button>
          </div>

        </div>

        {/* Global MSP SLA KPI Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          <div
            onClick={() => handleCardSort('attainment')}
            className={cn(
              "bg-[#101419] border p-3 rounded-md flex items-center justify-between shadow-sm cursor-pointer transition-all hover:border-emerald-400",
              sortKey === 'attainment' ? "border-emerald-400 ring-1 ring-emerald-400 bg-emerald-950/30" : "border-emerald-500/40 bg-emerald-950/10"
            )}
          >
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-emerald-400 flex items-center gap-1">
                <Target className="w-3.5 h-3.5 text-emerald-400" />
                MSP SLA COMPLIANCE RATE {sortKey === 'attainment' && (sortAsc ? '↑' : '↓')}
              </div>
              <div className="text-xl font-bold font-mono text-emerald-200">
                {globalMetrics.avgAttainment}% <span className="text-xs font-normal text-emerald-400">vs 95.0% Target</span>
              </div>
              <div className="text-[10px] text-[#8a919e] font-mono">Click to sort by Compliance</div>
            </div>
            <div className="p-2 rounded bg-emerald-950 border border-emerald-800 text-emerald-400">
              <Award className="w-5 h-5" />
            </div>
          </div>

          <div
            onClick={() => handleCardSort('mttd')}
            className={cn(
              "bg-[#101419] border p-3 rounded-md flex items-center justify-between shadow-sm cursor-pointer transition-all hover:border-[#0078d4]",
              sortKey === 'mttd' ? "border-[#0078d4] ring-1 ring-[#0078d4] bg-[#0078d4]/20" : "border-[#0078d4]/40"
            )}
          >
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-[#a3c9ff] flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-[#0078d4]" />
                AVG TIME TO DETECT (MTTD) {sortKey === 'mttd' && (sortAsc ? '↑' : '↓')}
              </div>
              <div className="text-xl font-bold font-mono text-[#e0e2ea]">
                {globalMetrics.avgMttd}m <span className="text-xs font-normal text-[#a3c9ff]">&lt; 5m Goal</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Click to sort by MTTD</div>
            </div>
            <div className="p-2 rounded bg-[#0078d4]/20 border border-[#0078d4]/40 text-[#a3c9ff]">
              <Activity className="w-5 h-5" />
            </div>
          </div>

          <div
            onClick={() => handleCardSort('mttr')}
            className={cn(
              "bg-[#101419] border p-3 rounded-md flex items-center justify-between shadow-sm cursor-pointer transition-all hover:border-purple-400",
              sortKey === 'mttr' ? "border-purple-400 ring-1 ring-purple-400 bg-purple-950/40" : "border-purple-500/40"
            )}
          >
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-purple-300 flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-purple-400" />
                AVG TIME TO REMEDIATE (MTTR) {sortKey === 'mttr' && (sortAsc ? '↑' : '↓')}
              </div>
              <div className="text-xl font-bold font-mono text-purple-200">
                {globalMetrics.avgMttr}m <span className="text-xs font-normal text-purple-400">Auto + Manual</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Click to sort by MTTR</div>
            </div>
            <div className="p-2 rounded bg-purple-950/40 border border-purple-800 text-purple-400">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>

          <div
            onClick={() => handleCardSort('autoheal')}
            className={cn(
              "bg-[#101419] border p-3 rounded-md flex items-center justify-between shadow-sm cursor-pointer transition-all hover:border-amber-400",
              sortKey === 'autoheal' ? "border-amber-400 ring-1 ring-amber-400 bg-amber-950/40" : "border-amber-500/40"
            )}
          >
            <div className="space-y-0.5">
              <div className="text-[11px] font-mono font-bold text-amber-300 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                AUTO-HEAL SLA RATIO {sortKey === 'autoheal' && (sortAsc ? '↑' : '↓')}
              </div>
              <div className="text-xl font-bold font-mono text-amber-200">
                {globalMetrics.autoHealPct}% <span className="text-xs font-normal text-amber-400">Instant Fix</span>
              </div>
              <div className="text-[10px] text-[#8a919e]">Click to sort by Auto-Heal Count</div>
            </div>
            <div className="p-2 rounded bg-amber-950/40 border border-amber-800 text-amber-400">
              <ShieldCheck className="w-5 h-5" />
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
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Tenant SLA Matrix ({tenantSlas.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('tracker')}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 relative',
              activeTab === 'tracker'
                ? 'bg-[#0078d4] text-white shadow'
                : 'text-[#8a919e] hover:text-[#e0e2ea]'
            )}
          >
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Live SLA Incident Tracker ({incidents.length})</span>
            {incidents.some((i) => i.status === 'breached') && (
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping absolute -top-0.5 -right-0.5" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('policies')}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
              activeTab === 'policies'
                ? 'bg-[#0078d4] text-white shadow'
                : 'text-[#8a919e] hover:text-[#e0e2ea]'
            )}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>SLA Tiers & Penalty Terms</span>
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e]" />
            <input
              type="text"
              placeholder="Search Client Name, SLA Tier..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#181c22] border border-[#404752] text-[#e0e2ea] placeholder-[#8a919e] text-xs rounded pl-8 pr-3 py-1.5 focus:outline-none focus:border-[#0078d4]"
            />
          </div>

          {/* Tier Filter */}
          <select
            value={selectedTierFilter}
            onChange={(e) => setSelectedTierFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All Tiers">All SLA Tiers</option>
            <option value="Platinum Tier">Platinum (15m MTTR)</option>
            <option value="Gold Tier">Gold (1h MTTR)</option>
            <option value="Silver Tier">Silver (4h MTTR)</option>
          </select>

          {/* Health Filter */}
          <select
            value={selectedHealthFilter}
            onChange={(e) => setSelectedHealthFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer"
          >
            <option value="All">All Health Statuses</option>
            <option value="Met">100% Met 🟢</option>
            <option value="At Risk">At Risk 🟡</option>
            <option value="Breached">Breached 🔴</option>
          </select>

          {/* Time Horizon */}
          <select
            value={timeHorizonFilter}
            onChange={(e) => setTimeHorizonFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] text-[#e0e2ea] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[#0078d4] cursor-pointer font-mono"
          >
            <option value="This Month">This Month (July 2026)</option>
            <option value="Last 30 Days">Last 30 Days</option>
            <option value="This Quarter">This Quarter (Q3)</option>
            <option value="Year to Date">Year to Date (2026)</option>
          </select>
        </div>

      </div>

      {/* ========================================================================= */}
      {/* 3. MAIN TAB CONTENT AREA */}
      {/* ========================================================================= */}
      <div className="flex-1 overflow-hidden relative flex">
        
        {/* TAB 1: TENANT SLA COMPLIANCE MATRIX */}
        {activeTab === 'matrix' && (
          <div className="w-full h-full overflow-y-auto p-4 lg:p-6 space-y-4">
            
            <div className="bg-[#181c22] border border-[#404752] rounded-lg overflow-hidden shadow-xl">
              <div className="p-3 bg-[#101419] border-b border-[#404752] text-xs font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center justify-between">
                <span>Managed Client Contractual SLA Delivery Matrix ({filteredTenantSlas.length})</span>
                <span>Click client row to open 12-month QBR performance audit</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#101419] border-b border-[#404752] text-[#8a919e] font-mono text-[11px] uppercase">
                      <th className="p-3">Customer Tenant</th>
                      <th className="p-3">SLA Plan Tier</th>
                      <th className="p-3">Monthly Attainment</th>
                      <th className="p-3">Avg Detect (MTTD)</th>
                      <th className="p-3">Avg Remediate (MTTR)</th>
                      <th className="p-3">Auto-Healed Ratio</th>
                      <th className="p-3">Active Breaches</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/60 font-mono text-[12px]">
                    {filteredTenantSlas.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-[#8a919e]">
                          No client SLA records match the selected filters.
                        </td>
                      </tr>
                    ) : (
                      filteredTenantSlas.map((item) => {
                        return (
                          <tr
                            key={item.tenantId}
                            onClick={() => handleOpenWizardForTenant(item)}
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

                            {/* SLA Plan Tier */}
                            <td className="p-3 whitespace-nowrap">
                              {item.slaTier === 'Platinum' ? (
                                <span className="px-2.5 py-0.5 rounded text-[10.5px] font-bold bg-purple-950/80 text-purple-300 border border-purple-700 flex items-center gap-1 w-fit">
                                  <Sparkles className="w-3 h-3 text-purple-400" /> Platinum (15m SLA)
                                </span>
                              ) : item.slaTier === 'Gold' ? (
                                <span className="px-2.5 py-0.5 rounded text-[10.5px] font-bold bg-amber-950/80 text-amber-300 border border-amber-700 flex items-center gap-1 w-fit">
                                  <Award className="w-3 h-3 text-amber-400" /> Gold (1h SLA)
                                </span>
                              ) : (
                                <span className="px-2.5 py-0.5 rounded text-[10.5px] font-bold bg-[#272a30] text-[#a3c9ff] border border-[#404752] flex items-center gap-1 w-fit">
                                  <ShieldCheck className="w-3 h-3 text-[#a3c9ff]" /> Silver (4h SLA)
                                </span>
                              )}
                            </td>

                            {/* Monthly Attainment + Progress Bar */}
                            <td className="p-3 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <div className="w-24 bg-[#101419] h-2 rounded-full overflow-hidden border border-[#404752]">
                                  <div
                                    className={cn(
                                      'h-full rounded-full transition-all',
                                      item.monthlyAttainment >= item.targetAttainment
                                        ? 'bg-emerald-500'
                                        : item.monthlyAttainment >= item.targetAttainment - 2
                                        ? 'bg-amber-500'
                                        : 'bg-red-500'
                                    )}
                                    style={{ width: `${Math.min(item.monthlyAttainment, 100)}%` }}
                                  />
                                </div>
                                <span
                                  className={cn(
                                    'font-bold text-xs',
                                    item.monthlyAttainment >= item.targetAttainment
                                      ? 'text-emerald-400'
                                      : 'text-red-400'
                                  )}
                                >
                                  {item.monthlyAttainment}%
                                </span>
                              </div>
                              <div className="text-[10px] text-[#8a919e] font-mono mt-0.5">
                                Target: {item.targetAttainment}%
                              </div>
                            </td>

                            {/* Avg MTTD */}
                            <td className="p-3 text-[#e0e2ea] font-mono">
                              {item.mttdMinutes}m
                            </td>

                            {/* Avg MTTR */}
                            <td className="p-3 text-[#e0e2ea] font-mono">
                              {item.mttrMinutes}m
                            </td>

                            {/* Auto-Healed Ratio */}
                            <td className="p-3">
                              <span className="px-2 py-0.5 bg-emerald-950/60 border border-emerald-800 text-emerald-300 rounded text-[11px] font-mono font-bold">
                                {item.autoHealedIncidents} / {item.totalIncidents} Healed
                              </span>
                            </td>

                            {/* Active Breaches */}
                            <td className="p-3">
                              {item.activeBreaches === 0 ? (
                                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                  0 Breaches 🟢
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-red-950 text-red-300 border border-red-800 animate-pulse">
                                  {item.activeBreaches} Breach Active 🔴
                                </span>
                              )}
                            </td>

                            {/* Actions */}
                            <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => setSelectedInspectTenant(item)}
                                  className="px-2.5 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded text-[11px] font-semibold cursor-pointer"
                                >
                                  Inspect SLA
                                </button>
                                <button
                                  onClick={() => {
                                    onShowToast?.(
                                      'success',
                                      'SLA Certificate Generated',
                                      `Exported official SLA proof certificate PDF for ${item.tenantName}.`
                                    );
                                  }}
                                  className="p-1 text-[#8a919e] hover:text-white"
                                  title="Export SLA Certificate PDF"
                                >
                                  <Download className="w-3.5 h-3.5" />
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

        {/* TAB 2: DRIFT & INCIDENT SLA TRACKER (REAL-TIME COUNTDOWN TIMER) */}
        {activeTab === 'tracker' && (
          <div className="w-full h-full overflow-y-auto p-4 lg:p-6 space-y-4">
            
            <div className="bg-[#181c22] border border-[#404752] rounded-lg overflow-hidden shadow-xl">
              <div className="p-3 bg-[#101419] border-b border-[#404752] text-xs font-mono font-bold text-[#8a919e] uppercase tracking-wider flex items-center justify-between">
                <span>Real-Time Incident & Policy Drift SLA Ticker ({filteredIncidents.length})</span>
                <span className="text-[#4ade80] flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5" /> SLA Clock Ticking (1s Precision)
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#101419] border-b border-[#404752] text-[#8a919e] font-mono text-[11px] uppercase">
                      <th className="p-3">SLA Countdown Ticker</th>
                      <th className="p-3">Customer Tenant</th>
                      <th className="p-3">Incident / Security Drift Title</th>
                      <th className="p-3">Detected At</th>
                      <th className="p-3">Target SLA Window</th>
                      <th className="p-3">Assigned Handler</th>
                      <th className="p-3 text-right">Stop SLA Clock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/60 font-mono text-[12px]">
                    {filteredIncidents.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-[#8a919e]">
                          No active SLA incidents found.
                        </td>
                      </tr>
                    ) : (
                      filteredIncidents.map((inc) => {
                        const isBreached = inc.status === 'breached' || inc.remainingSeconds < 0;

                        return (
                          <tr key={inc.id} className="hover:bg-[#272a30]/60 transition-colors">
                            {/* Live Countdown Timer */}
                            <td className="p-3 whitespace-nowrap">
                              {inc.status === 'remediated' ? (
                                <span className="px-2.5 py-1 bg-emerald-950/80 border border-emerald-700 text-emerald-300 rounded font-bold text-xs flex items-center gap-1 w-fit">
                                  <Check className="w-3.5 h-3.5" /> REMEDIATED IN SLA
                                </span>
                              ) : isBreached ? (
                                <span className="px-2.5 py-1 bg-red-950 border border-red-700 text-red-300 rounded font-bold text-xs flex items-center gap-1 w-fit animate-pulse">
                                  {formatCountdown(inc.remainingSeconds)}
                                </span>
                              ) : inc.remainingSeconds < 300 ? (
                                <span className="px-2.5 py-1 bg-amber-950/80 border border-amber-700 text-amber-300 rounded font-bold text-xs flex items-center gap-1 w-fit">
                                  {formatCountdown(inc.remainingSeconds)}
                                </span>
                              ) : (
                                <span className="px-2.5 py-1 bg-[#0078d4]/20 border border-[#0078d4]/40 text-[#a3c9ff] rounded font-bold text-xs flex items-center gap-1 w-fit">
                                  {formatCountdown(inc.remainingSeconds)}
                                </span>
                              )}
                            </td>

                            {/* Customer Tenant */}
                            <td className="p-3 font-sans">
                              <div className="font-bold text-[#e0e2ea]">{inc.tenantName}</div>
                              <div className="text-[10px] font-mono text-[#8a919e]">{inc.id}</div>
                            </td>

                            {/* Title & Category */}
                            <td className="p-3 font-sans">
                              <div className="font-bold text-[#e0e2ea]">{inc.title}</div>
                              <div className="text-[10px] font-mono text-purple-300">{inc.category}</div>
                            </td>

                            {/* Detected At */}
                            <td className="p-3 text-[#8a919e] whitespace-nowrap">
                              {inc.detectedAt}
                            </td>

                            {/* Target Window */}
                            <td className="p-3 text-[#a3c9ff] whitespace-nowrap font-bold">
                              {inc.slaDeadline}
                            </td>

                            {/* Handler */}
                            <td className="p-3 font-mono text-xs">
                              <span className="px-2 py-0.5 rounded bg-[#101419] border border-[#404752] text-[#e0e2ea]">
                                {inc.handler}
                              </span>
                            </td>

                            {/* Remediation Action Button */}
                            <td className="p-3 text-right whitespace-nowrap">
                              {inc.status === 'remediated' ? (
                                <span className="text-emerald-400 font-bold text-xs flex items-center justify-end gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Clock Stopped
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleResolveIncident(inc)}
                                  className="px-3 py-1 bg-[#0078d4] hover:bg-[#0060ab] text-white font-bold rounded text-xs flex items-center gap-1.5 cursor-pointer ml-auto shadow-sm"
                                >
                                  <Zap className="w-3.5 h-3.5" />
                                  <span>Dispatch Auto-Heal Fix</span>
                                </button>
                              )}
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

        {/* TAB 3: SLA POLICY DEFINITION & TIER BASELINES */}
        {activeTab === 'policies' && (
          <div className="w-full h-full overflow-y-auto p-4 lg:p-6 space-y-6">
            
            {/* SLA Tier Baseline Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              {/* Platinum Tier */}
              <div className="bg-[#181c22] border border-purple-500/50 rounded-lg p-5 space-y-4 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-purple-600 text-white text-[10px] font-mono font-bold px-3 py-0.5 rounded-bl">
                  MISSION CRITICAL
                </div>

                <div className="flex items-center gap-2">
                  <div className="p-2 rounded bg-purple-950 border border-purple-700 text-purple-300">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-bold text-base text-[#e0e2ea]">Platinum SLA Tier</h2>
                    <p className="text-xs text-[#8a919e]">High-security enterprises & banking</p>
                  </div>
                </div>

                <div className="space-y-2 pt-2 text-xs font-mono border-t border-[#404752]">
                  <div className="flex items-center justify-between">
                    <span className="text-[#8a919e]">Detection Guarantee (MTTD):</span>
                    <strong className="text-purple-300">&lt; 5 minutes</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#8a919e]">Critical MTTR Guarantee:</span>
                    <strong className="text-purple-300">&lt; 15 minutes</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#8a919e]">Monthly Target Attainment:</span>
                    <strong className="text-emerald-400">99.0%</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#8a919e]">Auto-Heal Engine:</span>
                    <strong className="text-emerald-400">Mandatory Active</strong>
                  </div>
                </div>

                <button
                  onClick={() => onShowToast?.('info', 'Tier Configured', 'Platinum SLA tier baselines updated.')}
                  className="w-full py-2 bg-purple-950 hover:bg-purple-900 border border-purple-700 text-purple-200 font-bold rounded text-xs cursor-pointer"
                >
                  Edit Platinum Terms
                </button>
              </div>

              {/* Gold Tier */}
              <div className="bg-[#181c22] border border-amber-500/50 rounded-lg p-5 space-y-4 shadow-lg">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded bg-amber-950 border border-amber-700 text-amber-300">
                    <Award className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-bold text-base text-[#e0e2ea]">Gold SLA Tier</h2>
                    <p className="text-xs text-[#8a919e]">Standard business clients & professional services</p>
                  </div>
                </div>

                <div className="space-y-2 pt-2 text-xs font-mono border-t border-[#404752]">
                  <div className="flex items-center justify-between">
                    <span className="text-[#8a919e]">Detection Guarantee (MTTD):</span>
                    <strong className="text-amber-300">&lt; 15 minutes</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#8a919e]">Critical MTTR Guarantee:</span>
                    <strong className="text-amber-300">&lt; 1 hour</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#8a919e]">Monthly Target Attainment:</span>
                    <strong className="text-emerald-400">95.0%</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#8a919e]">Auto-Heal Engine:</span>
                    <strong className="text-[#a3c9ff]">Enabled</strong>
                  </div>
                </div>

                <button
                  onClick={() => onShowToast?.('info', 'Tier Configured', 'Gold SLA tier baselines updated.')}
                  className="w-full py-2 bg-amber-950/80 hover:bg-amber-900 border border-amber-700 text-amber-200 font-bold rounded text-xs cursor-pointer"
                >
                  Edit Gold Terms
                </button>
              </div>

              {/* Silver Tier */}
              <div className="bg-[#181c22] border border-[#404752] rounded-lg p-5 space-y-4 shadow-lg">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded bg-[#101419] border border-[#404752] text-[#a3c9ff]">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-bold text-base text-[#e0e2ea]">Silver SLA Tier</h2>
                    <p className="text-xs text-[#8a919e]">Basic M365 monitoring & support</p>
                  </div>
                </div>

                <div className="space-y-2 pt-2 text-xs font-mono border-t border-[#404752]">
                  <div className="flex items-center justify-between">
                    <span className="text-[#8a919e]">Detection Guarantee (MTTD):</span>
                    <strong className="text-[#a3c9ff]">&lt; 1 hour</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#8a919e]">Critical MTTR Guarantee:</span>
                    <strong className="text-[#a3c9ff]">&lt; 4 hours</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#8a919e]">Monthly Target Attainment:</span>
                    <strong className="text-emerald-400">90.0%</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#8a919e]">Auto-Heal Engine:</span>
                    <strong className="text-[#8a919e]">Manual Confirmation</strong>
                  </div>
                </div>

                <button
                  onClick={() => onShowToast?.('info', 'Tier Configured', 'Silver SLA tier baselines updated.')}
                  className="w-full py-2 bg-[#272a30] hover:bg-[#31353b] border border-[#404752] text-[#e0e2ea] font-bold rounded text-xs cursor-pointer"
                >
                  Edit Silver Terms
                </button>
              </div>

            </div>

            {/* SLA Penalty & Retainer Credit Liability Calculator */}
            <div className="bg-[#181c22] border border-amber-500/40 rounded-lg p-5 space-y-4 shadow-xl">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-amber-400" />
                <h2 className="font-bold text-base text-[#e0e2ea]">
                  Contractual SLA Penalty & Retainer Liability Calculator
                </h2>
              </div>

              <p className="text-xs text-[#8a919e] max-w-2xl">
                Configure Master Services Agreement (MSA) penalty clauses. If an MSP drops below contractual SLA targets for a managed client, the platform calculates financial credit liability automatically.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                
                {/* Inputs */}
                <div className="space-y-4 bg-[#101419] p-4 rounded border border-[#404752]">
                  <div className="space-y-1">
                    <label className="text-xs font-mono text-[#a3c9ff] font-bold">
                      Retainer Credit Penalty (%): {penaltyCreditPercentage}%
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      value={penaltyCreditPercentage}
                      onChange={(e) => setPenaltyCreditPercentage(Number(e.target.value))}
                      className="w-full accent-[#0078d4] cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-mono text-[#a3c9ff] font-bold">
                      Breach Threshold Attainment (%): {penaltyThresholdAttainment}%
                    </label>
                    <input
                      type="range"
                      min="85"
                      max="98"
                      value={penaltyThresholdAttainment}
                      onChange={(e) => setPenaltyThresholdAttainment(Number(e.target.value))}
                      className="w-full accent-[#0078d4] cursor-pointer"
                    />
                  </div>
                </div>

                {/* Liability Output Box */}
                <div className="bg-[#101419] p-4 rounded border border-amber-600/60 flex flex-col justify-between font-mono space-y-3">
                  <div className="space-y-1">
                    <span className="text-[11px] text-amber-300 font-bold uppercase">
                      Calculated MSP Monthly Credit Risk
                    </span>
                    <div className="text-2xl font-bold text-amber-200">
                      ${globalMetrics.totalRetainerLiability.toLocaleString()} USD
                    </div>
                    <div className="text-xs text-[#8a919e]">
                      Liability accrued across clients falling under {penaltyThresholdAttainment}% SLA.
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      onShowToast?.(
                        'info',
                        'SLA Contract Terms Saved',
                        `Applied ${penaltyCreditPercentage}% credit penalty clause rule.`
                      );
                    }}
                    className="py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded text-xs cursor-pointer transition-all"
                  >
                    Save Contractual MSA Terms
                  </button>
                </div>

              </div>
            </div>

          </div>
        )}

        {/* ========================================================================= */}
        {/* INTERACTIVE CLIENT SLA DEEP-DIVE DRAWER (SLIDE-OVER) */}
        {/* ========================================================================= */}
        {selectedInspectTenant && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-end animate-in fade-in">
            <div className="w-full max-w-xl bg-[#181c22] h-full border-l border-[#404752] flex flex-col p-6 space-y-5 overflow-y-auto shadow-2xl">
              
              {/* Drawer Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[#404752]">
                <div>
                  <h2 className="font-bold text-base text-[#e0e2ea] flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-[#0078d4]" />
                    <span>{selectedInspectTenant.tenantName}</span>
                  </h2>
                  <p className="text-xs text-[#8a919e] font-mono mt-0.5">
                    {selectedInspectTenant.primaryDomain} • {selectedInspectTenant.slaTier} Tier
                  </p>
                </div>

                <button
                  onClick={() => setSelectedInspectTenant(null)}
                  className="p-1.5 text-[#8a919e] hover:text-white rounded bg-[#101419] border border-[#404752]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Current Month Attainment Card */}
              <div className="bg-[#101419] border border-[#404752] rounded p-4 space-y-2 font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#8a919e]">Monthly SLA Attainment Rate</span>
                  <span className="text-lg font-bold text-emerald-400">
                    {selectedInspectTenant.monthlyAttainment}%
                  </span>
                </div>

                <div className="w-full bg-[#181c22] h-3 rounded-full overflow-hidden border border-[#404752]">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${selectedInspectTenant.monthlyAttainment}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#8a919e] pt-1">
                  <span>Contractual Target: {selectedInspectTenant.targetAttainment}%</span>
                  <span>Monthly Retainer: ${selectedInspectTenant.monthlyRetainerUsd.toLocaleString()}</span>
                </div>
              </div>

              {/* M365 Pillar SLA Breakdown */}
              <div className="space-y-2">
                <h3 className="text-xs font-mono font-bold text-[#a3c9ff] uppercase">
                  M365 Security Pillar SLA Breakdown
                </h3>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="p-2.5 bg-[#101419] border border-[#404752] rounded space-y-1">
                    <div className="text-[11px] text-[#8a919e]">Identity & MFA SLA</div>
                    <div className="text-base font-bold text-emerald-300">
                      {selectedInspectTenant.pillarBreakdown.identity}%
                    </div>
                  </div>

                  <div className="p-2.5 bg-[#101419] border border-[#404752] rounded space-y-1">
                    <div className="text-[11px] text-[#8a919e]">Conditional Access SLA</div>
                    <div className="text-base font-bold text-emerald-300">
                      {selectedInspectTenant.pillarBreakdown.caPolicy}%
                    </div>
                  </div>

                  <div className="p-2.5 bg-[#101419] border border-[#404752] rounded space-y-1">
                    <div className="text-[11px] text-[#8a919e]">Intune Device SLA</div>
                    <div className="text-base font-bold text-emerald-300">
                      {selectedInspectTenant.pillarBreakdown.device}%
                    </div>
                  </div>

                  <div className="p-2.5 bg-[#101419] border border-[#404752] rounded space-y-1">
                    <div className="text-[11px] text-[#8a919e]">Mail Flow & Exchange SLA</div>
                    <div className="text-base font-bold text-emerald-300">
                      {selectedInspectTenant.pillarBreakdown.mailFlow}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Breach Logs & Audit History */}
              <div className="space-y-2 flex-1">
                <h3 className="text-xs font-mono font-bold text-red-400 uppercase">
                  Historical SLA Breach Logs & RCA ({selectedInspectTenant.breachLogs.length})
                </h3>

                {selectedInspectTenant.breachLogs.length === 0 ? (
                  <div className="p-4 bg-[#101419] border border-[#404752] rounded text-center text-xs text-[#8a919e] font-mono">
                    ✓ Clean record — Zero contractual SLA breaches recorded for this customer.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedInspectTenant.breachLogs.map((log) => (
                      <div key={log.id} className="p-3 bg-[#101419] border border-red-800/60 rounded space-y-1 text-xs">
                        <div className="flex items-center justify-between font-mono">
                          <span className="font-bold text-red-300">{log.title}</span>
                          <span className="text-[10px] text-[#8a919e]">{log.date}</span>
                        </div>
                        <p className="text-[#e0e2ea]">{log.cause}</p>
                        <div className="text-[11px] font-mono text-amber-300 pt-1">
                          Impact: {log.impact}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Drawer Footer Buttons */}
              <div className="pt-3 border-t border-[#404752] flex items-center justify-end gap-2">
                <button
                  onClick={() => setSelectedInspectTenant(null)}
                  className="px-4 py-2 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] rounded text-xs font-bold cursor-pointer"
                >
                  Close Audit
                </button>
                <button
                  onClick={() => {
                    onShowToast?.(
                      'success',
                      'Certificate Downloaded',
                      `Downloaded QBR SLA Certificate for ${selectedInspectTenant.tenantName}.`
                    );
                  }}
                  className="px-4 py-2 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Client SLA Certificate</span>
                </button>
              </div>

            </div>
          </div>
        )}

      </div>

      {/* SLA REMEDIATION WIZARD MODAL */}
      <AlertResolutionWizardModal
        isOpen={isWizardOpen}
        alert={wizardAlert}
        wizardMode="sla_dashboard"
        onClose={() => {
          setIsWizardOpen(false);
          setWizardAlert(null);
        }}
        onIssueSlaCredit={(tenantId, amount) => {
          onShowToast?.('success', 'SLA Credit Note Posted', `Posted $${amount}.00 service credit to ${tenantId} billing ledger.`);
        }}
        onRemediateSuccess={(alertId) => {
          setIsWizardOpen(false);
          setWizardAlert(null);
          onShowToast?.('success', 'SLA Attainment Restored', `Successfully executed SLA auto-heal for ${alertId}. Tenant SLA restored to 99.8%.`);
        }}
        onAcceptRbdSuccess={(alertId) => {
          setIsWizardOpen(false);
          setWizardAlert(null);
          onShowToast?.('warning', 'SLA Contract Waiver Logged', `Logged Risk-Based SLA Exception Waiver for ${alertId}.`);
        }}
        onSendQuoteSuccess={(alertId) => {
          onShowToast?.('success', 'Platinum Upgrade Sent', `Platinum SLA upgrade proposal dispatched to client CISO for ${alertId}.`);
        }}
      />

    </div>
  );
};

