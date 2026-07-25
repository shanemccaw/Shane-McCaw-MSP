import React, { useState, useMemo } from 'react';
import {
  Kanban,
  DollarSign,
  TrendingUp,
  FileText,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Search,
  Filter,
  SlidersHorizontal,
  RefreshCw,
  FileSignature,
  Building2,
  Users,
  ArrowRight,
  Sparkles,
  Plus,
  ChevronRight,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  UserCheck,
  ExternalLink,
  ChevronDown,
  X,
  FileSpreadsheet,
  Download,
  Copy,
  Trash2,
  Edit3,
  BarChart3,
  Eye,
  Check,
  Package,
  Layers
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tenant } from '../../types';

// ============================================================================
// TYPES & DATA STRUCTURES
// ============================================================================

export type StageType = 'discovery' | 'pre_assessment' | 'proposal_sent' | 'closed_won' | 'closed_lost';

export interface OfferDeal {
  id: string;
  dealCode: string;
  prospectName: string;
  primaryDomain: string;
  contactName: string;
  contactEmail: string;
  stage: StageType;
  seatCount: number;
  selectedBundleId: string;
  selectedBundleName: string;
  mrrValue: number;
  preAssessmentScore: number; // 0-100
  identifiedGapsCount: number;
  assignedRep: string;
  probability: number; // 0-100%
  createdAt: string;
  daysInStage: number;
  unassignedLicensesCost: number;
  missingMfaUsersCount: number;
  legacyAuthCount: number;
  onboardedStatus?: 'pending' | 'in_progress' | 'completed';
}

interface OfferPipelineConsoleProps {
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

const INITIAL_DEALS: OfferDeal[] = [
  {
    id: 'deal-1',
    dealCode: 'DEAL-2026-041',
    prospectName: 'Apex Logistics & Freight',
    primaryDomain: 'apexlogistics.com',
    contactName: 'Marcus Vance',
    contactEmail: 'm.vance@apexlogistics.com',
    stage: 'discovery',
    seatCount: 65,
    selectedBundleId: 'bndl-gold',
    selectedBundleName: 'Gold - Secured Workplace',
    mrrValue: 2470,
    preAssessmentScore: 48,
    identifiedGapsCount: 14,
    assignedRep: 'Shane McCaw',
    probability: 30,
    createdAt: '2026-07-10',
    daysInStage: 4,
    unassignedLicensesCost: 432,
    missingMfaUsersCount: 18,
    legacyAuthCount: 4
  },
  {
    id: 'deal-2',
    dealCode: 'DEAL-2026-042',
    prospectName: 'Vanguard Legal Partners',
    primaryDomain: 'vanguardlegal.net',
    contactName: 'Eleanor Vance',
    contactEmail: 'evance@vanguardlegal.net',
    stage: 'pre_assessment',
    seatCount: 120,
    selectedBundleId: 'bndl-platinum',
    selectedBundleName: 'Platinum - Enterprise SOC & Governance',
    mrrValue: 8160,
    preAssessmentScore: 35,
    identifiedGapsCount: 22,
    assignedRep: 'Shane McCaw',
    probability: 60,
    createdAt: '2026-07-08',
    daysInStage: 2,
    unassignedLicensesCost: 960,
    missingMfaUsersCount: 42,
    legacyAuthCount: 12
  },
  {
    id: 'deal-3',
    dealCode: 'DEAL-2026-043',
    prospectName: 'BioHealth Innovations',
    primaryDomain: 'biohealth.io',
    contactName: 'Dr. Aris Thorne',
    contactEmail: 'athorne@biohealth.io',
    stage: 'proposal_sent',
    seatCount: 45,
    selectedBundleId: 'bndl-gold',
    selectedBundleName: 'Gold - Secured Workplace',
    mrrValue: 1710,
    preAssessmentScore: 58,
    identifiedGapsCount: 9,
    assignedRep: 'Sales Engineering',
    probability: 80,
    createdAt: '2026-07-12',
    daysInStage: 5,
    unassignedLicensesCost: 280,
    missingMfaUsersCount: 12,
    legacyAuthCount: 1
  },
  {
    id: 'deal-4',
    dealCode: 'DEAL-2026-044',
    prospectName: 'Meridian Capital Partners',
    primaryDomain: 'meridiancap.com',
    contactName: 'Julian Sterling',
    contactEmail: 'sterling@meridiancap.com',
    stage: 'proposal_sent',
    seatCount: 180,
    selectedBundleId: 'bndl-platinum',
    selectedBundleName: 'Platinum - Enterprise SOC & Governance',
    mrrValue: 12240,
    preAssessmentScore: 42,
    identifiedGapsCount: 19,
    assignedRep: 'Shane McCaw',
    probability: 85,
    createdAt: '2026-07-05',
    daysInStage: 8,
    unassignedLicensesCost: 1440,
    missingMfaUsersCount: 65,
    legacyAuthCount: 8
  },
  {
    id: 'deal-5',
    dealCode: 'DEAL-2026-045',
    prospectName: 'Nexus Global Manufacturing',
    primaryDomain: 'nexusmfg.org',
    contactName: 'Sarah Jenkins',
    contactEmail: 's.jenkins@nexusmfg.org',
    stage: 'closed_won',
    seatCount: 95,
    selectedBundleId: 'bndl-gold',
    selectedBundleName: 'Gold - Secured Workplace',
    mrrValue: 3610,
    preAssessmentScore: 51,
    identifiedGapsCount: 11,
    assignedRep: 'Sales Engineering',
    probability: 100,
    createdAt: '2026-06-28',
    daysInStage: 1,
    unassignedLicensesCost: 520,
    missingMfaUsersCount: 22,
    legacyAuthCount: 3,
    onboardedStatus: 'pending'
  },
  {
    id: 'deal-6',
    dealCode: 'DEAL-2026-046',
    prospectName: 'Cascade Horizon Retail',
    primaryDomain: 'cascadehorizon.com',
    contactName: 'David Kim',
    contactEmail: 'dkim@cascadehorizon.com',
    stage: 'closed_lost',
    seatCount: 30,
    selectedBundleId: 'bndl-silver',
    selectedBundleName: 'Silver - Essentials M365',
    mrrValue: 660,
    preAssessmentScore: 68,
    identifiedGapsCount: 6,
    assignedRep: 'Shane McCaw',
    probability: 0,
    createdAt: '2026-06-15',
    daysInStage: 14,
    unassignedLicensesCost: 120,
    missingMfaUsersCount: 8,
    legacyAuthCount: 0
  }
];

const STAGE_CONFIGS: { id: StageType; label: string; color: string; bg: string; border: string }[] = [
  { id: 'discovery', label: '1. Lead / Discovery', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  { id: 'pre_assessment', label: '2. Pre-Assessment Scan', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
  { id: 'proposal_sent', label: '3. Proposal Sent', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  { id: 'closed_won', label: '4. Closed Won / Awaiting Onboard', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  { id: 'closed_lost', label: '5. Closed Lost', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' }
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const OfferPipelineConsole: React.FC<OfferPipelineConsoleProps> = ({
  tenants = [],
  onShowToast
}) => {
  // Views
  const [activeView, setActiveView] = useState<'kanban' | 'table' | 'pre_assessment'>('kanban');

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [repFilter, setRepFilter] = useState('ALL');
  const [bundleFilter, setBundleFilter] = useState('ALL');
  const [probabilityFilter, setProbabilityFilter] = useState('ALL');

  // Deals State
  const [deals, setDeals] = useState<OfferDeal[]>(INITIAL_DEALS);
  const [selectedDealId, setSelectedDealId] = useState<string>('deal-2');

  // Drawer / Modal States
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [builderStep, setBuilderStep] = useState<1 | 2 | 3 | 4>(1);
  const [newDealForm, setNewDealForm] = useState<Partial<OfferDeal>>({
    prospectName: '',
    primaryDomain: '',
    contactName: '',
    contactEmail: '',
    seatCount: 50,
    selectedBundleId: 'bndl-gold',
    selectedBundleName: 'Gold - Secured Workplace',
    assignedRep: 'Shane McCaw'
  });

  // Onboarding Modal
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [onboardingDeal, setOnboardingDeal] = useState<OfferDeal | null>(null);
  const [isOnboardingLoading, setIsOnboardingLoading] = useState(false);

  // Pitch Deck PDF Modal State
  const [isPitchPdfOpen, setIsPitchPdfOpen] = useState(false);

  // Toast Helper
  const toast = (type: 'success' | 'info' | 'warning' | 'error', title: string, desc: string) => {
    if (onShowToast) onShowToast(type, title, desc);
  };

  // Selected Deal for Pre-Assessment / Inspector
  const selectedDeal = useMemo(() => {
    return deals.find(d => d.id === selectedDealId) || deals[0];
  }, [deals, selectedDealId]);

  // KPIs
  const pipelineKpis = useMemo(() => {
    const activeDeals = deals.filter(d => d.stage !== 'closed_lost');
    const totalMrr = activeDeals.reduce((sum, d) => sum + d.mrrValue, 0);
    const weightedMrr = activeDeals.reduce((sum, d) => sum + (d.mrrValue * (d.probability / 100)), 0);
    const avgDealSize = activeDeals.length > 0 ? totalMrr / activeDeals.length : 0;
    const preAssessmentScansRun = deals.filter(d => d.stage !== 'discovery').length;

    return {
      totalMrr,
      weightedMrr,
      avgDealSize,
      preAssessmentScansRun,
      activeCount: activeDeals.length
    };
  }, [deals]);

  // Filtered Deals
  const filteredDeals = useMemo(() => {
    return deals.filter(d => {
      const matchesSearch =
        d.prospectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        d.primaryDomain.toLowerCase().includes(searchTerm.toLowerCase()) ||
        d.dealCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        d.contactName.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesRep = repFilter === 'ALL' || d.assignedRep === repFilter;
      const matchesBundle = bundleFilter === 'ALL' || d.selectedBundleId === bundleFilter;

      let matchesProb = true;
      if (probabilityFilter === 'HIGH') matchesProb = d.probability >= 75;
      else if (probabilityFilter === 'MEDIUM') matchesProb = d.probability >= 40 && d.probability < 75;
      else if (probabilityFilter === 'LOW') matchesProb = d.probability < 40;

      return matchesSearch && matchesRep && matchesBundle && matchesProb;
    });
  }, [deals, searchTerm, repFilter, bundleFilter, probabilityFilter]);

  // Move Stage Handler
  const handleMoveStage = (dealId: string, nextStage: StageType) => {
    setDeals(prev => prev.map(d => {
      if (d.id === dealId) {
        let prob = d.probability;
        if (nextStage === 'discovery') prob = 30;
        if (nextStage === 'pre_assessment') prob = 60;
        if (nextStage === 'proposal_sent') prob = 80;
        if (nextStage === 'closed_won') prob = 100;
        if (nextStage === 'closed_lost') prob = 0;

        return {
          ...d,
          stage: nextStage,
          probability: prob,
          daysInStage: 0
        };
      }
      return d;
    }));

    const deal = deals.find(d => d.id === dealId);
    toast('info', 'Stage Shifted', `${deal?.prospectName} moved to stage "${STAGE_CONFIGS.find(s => s.id === nextStage)?.label}".`);
  };

  // Create Deal Handler
  const handleCreateDeal = () => {
    if (!newDealForm.prospectName || !newDealForm.primaryDomain) {
      toast('error', 'Validation Error', 'Company Name and Domain are required.');
      return;
    }

    const bundleName = newDealForm.selectedBundleId === 'bndl-platinum'
      ? 'Platinum - Enterprise SOC & Governance'
      : newDealForm.selectedBundleId === 'bndl-[#0078d4]' || newDealForm.selectedBundleId === 'bndl-silver'
      ? 'Silver - Essentials M365'
      : 'Gold - Secured Workplace';

    const pricePerSeat = newDealForm.selectedBundleId === 'bndl-platinum' ? 68 : newDealForm.selectedBundleId === 'bndl-silver' ? 22 : 38;
    const seatCount = newDealForm.seatCount || 50;
    const mrr = pricePerSeat * seatCount;

    const createdDeal: OfferDeal = {
      id: `deal-${Date.now()}`,
      dealCode: `DEAL-2026-${Math.floor(100 + Math.random() * 900)}`,
      prospectName: newDealForm.prospectName,
      primaryDomain: newDealForm.primaryDomain,
      contactName: newDealForm.contactName || 'Primary Executive',
      contactEmail: newDealForm.contactEmail || `admin@${newDealForm.primaryDomain}`,
      stage: 'discovery',
      seatCount: seatCount,
      selectedBundleId: newDealForm.selectedBundleId || 'bndl-gold',
      selectedBundleName: bundleName,
      mrrValue: mrr,
      preAssessmentScore: 42,
      identifiedGapsCount: 12,
      assignedRep: newDealForm.assignedRep || 'Shane McCaw',
      probability: 30,
      createdAt: new Date().toISOString().split('T')[0],
      daysInStage: 0,
      unassignedLicensesCost: Math.round(seatCount * 6.5),
      missingMfaUsersCount: Math.round(seatCount * 0.3),
      legacyAuthCount: 3
    };

    setDeals(prev => [createdDeal, ...prev]);
    setIsBuilderOpen(false);
    toast('success', 'Offer Deal Created', `Proposal for ${createdDeal.prospectName} generated ($${mrr.toLocaleString()}/mo MRR).`);
  };

  // Trigger Onboarding
  const handleStartOnboarding = (deal: OfferDeal) => {
    setOnboardingDeal(deal);
    setIsOnboardingOpen(true);
  };

  const handleConfirmOnboarding = () => {
    if (!onboardingDeal) return;
    setIsOnboardingLoading(true);

    setTimeout(() => {
      setIsOnboardingLoading(false);
      setIsOnboardingOpen(false);

      setDeals(prev => prev.map(d => {
        if (d.id === onboardingDeal.id) {
          return {
            ...d,
            onboardedStatus: 'completed'
          };
        }
        return d;
      }));

      toast('success', 'Tenant Onboarding Executed', `${onboardingDeal.prospectName} converted to Active Managed Tenant with 5m Graph Polling & ${onboardingDeal.selectedBundleName} baseline.`);
    }, 1800);
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#090d16] text-[#e0e2ea] overflow-hidden font-sans">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & COMMERCIAL PIPELINE KPI BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] p-4 shrink-0 space-y-4">
        
        {/* Title & Primary Action Controls */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-[#0078d4]/20 to-[#a3c9ff]/10 border border-[#0078d4]/40 rounded-lg">
              <Kanban className="w-6 h-6 text-[#a3c9ff]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-[#f0f4f8] tracking-tight">M365 Managed Service Offer Pipeline</h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40">
                  /portal/offer-pipeline
                </span>
              </div>
              <p className="text-xs text-[#8a919e]">
                Commercial proposal tracking, prospect pre-assessment Graph scans, digital sign-off &amp; automated onboarding handoffs.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                setBuilderStep(1);
                setIsBuilderOpen(true);
              }}
              className="flex items-center gap-1.5 bg-[#0078d4] hover:bg-[#006cbd] text-white text-xs font-bold px-3 py-2 rounded transition-all shadow-md active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Deal / Proposal</span>
            </button>

            <button
              onClick={() => {
                toast('info', 'Exporting Pipeline Report', 'Generating PDF/CSV commercial deal overview...');
                setTimeout(() => toast('success', 'Export Complete', 'offer_pipeline_commercial_summary_2026.csv downloaded.'), 800);
              }}
              className="flex items-center gap-1.5 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#e0e2ea] text-xs font-semibold px-3 py-2 rounded transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export Pipeline Report</span>
            </button>
          </div>
        </div>

        {/* 4 KPI Metric Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          {/* KPI 1 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Total Active Pipeline MRR</span>
              <div className="text-xl font-bold font-mono text-emerald-400 flex items-baseline gap-1">
                <span>${pipelineKpis.totalMrr.toLocaleString()}</span>
                <span className="text-xs font-normal text-[#8a919e] font-sans">/ mo</span>
              </div>
            </div>
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-md">
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
          </div>

          {/* KPI 2 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Weighted Pipeline Value</span>
              <div className="text-xl font-bold font-mono text-[#a3c9ff] flex items-baseline gap-1">
                <span>${Math.round(pipelineKpis.weightedMrr).toLocaleString()}</span>
                <span className="text-xs font-normal text-[#8a919e] font-sans">/ mo</span>
              </div>
            </div>
            <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-md">
              <TrendingUp className="w-5 h-5 text-blue-400" />
            </div>
          </div>

          {/* KPI 3 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Average Contract Size</span>
              <div className="text-xl font-bold font-mono text-[#f0f4f8] flex items-baseline gap-1">
                <span>${Math.round(pipelineKpis.avgDealSize).toLocaleString()}</span>
                <span className="text-xs font-normal text-[#8a919e] font-sans">/ mo MRR</span>
              </div>
            </div>
            <div className="p-2 bg-purple-500/10 border border-purple-500/20 rounded-md">
              <BarChart3 className="w-5 h-5 text-purple-400" />
            </div>
          </div>

          {/* KPI 4 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Pre-Assessment Scans</span>
              <div className="text-xl font-bold font-mono text-purple-400 flex items-baseline gap-2">
                <span>{pipelineKpis.preAssessmentScansRun} Scans</span>
                <span className="text-[10px] font-mono font-bold text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                  GRAPH ACTIVE
                </span>
              </div>
            </div>
            <div className="p-2 bg-purple-500/10 border border-purple-500/20 rounded-md">
              <Zap className="w-5 h-5 text-purple-400" />
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
            onClick={() => setActiveView('kanban')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeView === 'kanban'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <Kanban className="w-3.5 h-3.5" />
            <span>Visual Kanban Deal Pipeline</span>
          </button>

          <button
            onClick={() => setActiveView('table')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeView === 'table'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            <span>Proposal Directory Table ({filteredDeals.length})</span>
          </button>

          <button
            onClick={() => setActiveView('pre_assessment')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeView === 'pre_assessment'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <Zap className="w-3.5 h-3.5 text-purple-400" />
            <span>Prospect Pre-Assessment Audit Engine</span>
          </button>
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-2 flex-wrap flex-1 justify-end">
          
          {/* Search Box */}
          <div className="relative min-w-[200px] max-w-[280px] flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e]" />
            <input
              type="text"
              placeholder="Search Company, Rep, Deal ID..."
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

          {/* Lead Owner Filter */}
          <select
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Rep: All Leads</option>
            <option value="Shane McCaw">Shane McCaw</option>
            <option value="Sales Engineering">Sales Engineering</option>
          </select>

          {/* Sales Bundle Filter */}
          <select
            value={bundleFilter}
            onChange={(e) => setBundleFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Bundle: All Packages</option>
            <option value="bndl-silver">Silver - Essentials M365</option>
            <option value="bndl-gold">Gold - Secured Workplace</option>
            <option value="bndl-platinum">Platinum - Enterprise SOC</option>
          </select>

          {/* Deal Probability */}
          <select
            value={probabilityFilter}
            onChange={(e) => setProbabilityFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Probability: All</option>
            <option value="HIGH">High Win (&gt;75% 🟢)</option>
            <option value="MEDIUM">Medium Win (40-75% 🟡)</option>
            <option value="LOW">Low Win (&lt;40% 🔴)</option>
          </select>

          {(searchTerm || repFilter !== 'ALL' || bundleFilter !== 'ALL' || probabilityFilter !== 'ALL') && (
            <button
              onClick={() => {
                setSearchTerm('');
                setRepFilter('ALL');
                setBundleFilter('ALL');
                setProbabilityFilter('ALL');
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
        {/* VIEW 1: VISUAL KANBAN DEAL PIPELINE (5 COLUMNS) */}
        {/* ======================================================================= */}
        {activeView === 'kanban' && (
          <div className="w-full h-full flex gap-3 overflow-x-auto pb-2">
            {STAGE_CONFIGS.map(stage => {
              const stageDeals = filteredDeals.filter(d => d.stage === stage.id);
              const stageMrr = stageDeals.reduce((acc, d) => acc + d.mrrValue, 0);

              return (
                <div
                  key={stage.id}
                  className="flex-1 min-w-[280px] max-w-[340px] bg-[#101419] border border-[#404752] rounded-xl flex flex-col h-full overflow-hidden shrink-0 shadow-lg"
                >
                  {/* Column Header */}
                  <div className={cn("p-3 border-b flex items-center justify-between shrink-0", stage.bg, stage.border)}>
                    <div>
                      <h3 className={cn("text-xs font-bold font-mono uppercase tracking-wider", stage.color)}>
                        {stage.label}
                      </h3>
                      <div className="text-xs font-bold font-mono text-[#f0f4f8] mt-0.5">
                        ${stageMrr.toLocaleString()} <span className="text-[10px] text-[#8a919e] font-sans font-normal">/ mo MRR</span>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-[#181c22] border border-[#404752] text-[#e0e2ea]">
                      {stageDeals.length}
                    </span>
                  </div>

                  {/* Deals Scroll Area */}
                  <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
                    {stageDeals.length === 0 ? (
                      <div className="border border-dashed border-[#404752] rounded-lg p-6 text-center text-xs text-[#8a919e]">
                        No active proposals in this stage.
                      </div>
                    ) : (
                      stageDeals.map(deal => {
                        const isSelected = deal.id === selectedDealId;

                        let scoreColor = 'text-red-400 bg-red-500/10 border-red-500/30';
                        if (deal.preAssessmentScore >= 60) scoreColor = 'text-amber-400 bg-amber-500/10 border-amber-500/30';
                        if (deal.preAssessmentScore >= 80) scoreColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';

                        return (
                          <div
                            key={deal.id}
                            onClick={() => setSelectedDealId(deal.id)}
                            className={cn(
                              "bg-[#181c22] border rounded-lg p-3 space-y-3 transition-all cursor-pointer shadow-md hover:border-[#606a7a] relative group",
                              isSelected ? "border-[#0078d4] ring-1 ring-[#0078d4] bg-[#1a212d]" : "border-[#404752]"
                            )}
                          >
                            {/* Card Header */}
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="text-[10px] font-mono text-[#8a919e] block">{deal.dealCode}</span>
                                <h4 className="text-xs font-bold text-[#f0f4f8] group-hover:text-[#a3c9ff] transition-colors leading-snug">
                                  {deal.prospectName}
                                </h4>
                                <span className="text-[11px] text-[#8a919e] font-mono">{deal.primaryDomain}</span>
                              </div>

                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/30 shrink-0">
                                {deal.seatCount} Seats
                              </span>
                            </div>

                            {/* Bundle Tag & MRR */}
                            <div className="bg-[#101419] border border-[#404752] p-2 rounded flex items-center justify-between text-xs font-mono">
                              <span className="text-[#8a919e] truncate max-w-[140px]" title={deal.selectedBundleName}>
                                {deal.selectedBundleName.split('-')[0]}
                              </span>
                              <span className="font-bold text-emerald-400">${deal.mrrValue.toLocaleString()}/mo</span>
                            </div>

                            {/* Pre-Assessment Score Pill */}
                            <div className="flex items-center justify-between text-[11px]">
                              <span className={cn("px-2 py-0.5 rounded font-mono font-bold border flex items-center gap-1", scoreColor)}>
                                <Zap className="w-3 h-3" />
                                <span>Score: {deal.preAssessmentScore}/100</span>
                              </span>
                              <span className="text-[10px] text-[#8a919e] font-mono">{deal.identifiedGapsCount} Gaps</span>
                            </div>

                            {/* Rep & Stage Action Controls */}
                            <div className="pt-2 border-t border-[#404752]/60 flex items-center justify-between text-[11px]">
                              <div className="flex items-center gap-1 text-[#8a919e]">
                                <Users className="w-3 h-3 text-[#a3c9ff]" />
                                <span className="truncate max-w-[80px]">{deal.assignedRep}</span>
                              </div>

                              <div className="flex items-center gap-1">
                                {deal.stage === 'discovery' && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleMoveStage(deal.id, 'pre_assessment'); }}
                                    className="px-2 py-1 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/40 text-[10px] font-mono font-bold flex items-center gap-1"
                                    title="Run Pre-Assessment Scan"
                                  >
                                    <span>Run Scan</span>
                                    <ChevronRight className="w-3 h-3" />
                                  </button>
                                )}

                                {deal.stage === 'pre_assessment' && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleMoveStage(deal.id, 'proposal_sent'); }}
                                    className="px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/40 text-[10px] font-mono font-bold flex items-center gap-1"
                                    title="Send Formal Proposal"
                                  >
                                    <span>Send Quote</span>
                                    <ChevronRight className="w-3 h-3" />
                                  </button>
                                )}

                                {deal.stage === 'proposal_sent' && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleMoveStage(deal.id, 'closed_won'); }}
                                    className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/40 text-[10px] font-mono font-bold flex items-center gap-1"
                                    title="Mark Contract Signed"
                                  >
                                    <span>Sign Deal</span>
                                    <Check className="w-3 h-3" />
                                  </button>
                                )}

                                {deal.stage === 'closed_won' && deal.onboardedStatus !== 'completed' && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleStartOnboarding(deal); }}
                                    className="px-2 py-1 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40 hover:bg-blue-500/40 text-[10px] font-mono font-bold flex items-center gap-1 animate-pulse"
                                    title="1-Click Onboard Tenant"
                                  >
                                    <span>Onboard</span>
                                    <Sparkles className="w-3 h-3" />
                                  </button>
                                )}

                                {deal.stage === 'closed_won' && deal.onboardedStatus === 'completed' && (
                                  <span className="text-[10px] font-mono font-bold text-emerald-400 flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>Onboarded</span>
                                  </span>
                                )}
                              </div>
                            </div>

                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ======================================================================= */}
        {/* VIEW 2: PROPOSAL DIRECTORY TABLE */}
        {/* ======================================================================= */}
        {activeView === 'table' && (
          <div className="w-full h-full bg-[#101419] border border-[#404752] rounded-xl overflow-hidden flex flex-col shadow-xl">
            <div className="p-3 bg-[#181c22] border-b border-[#404752] flex items-center justify-between text-xs">
              <span className="font-mono font-bold text-[#8a919e] uppercase tracking-wider">
                Active Commercial Deal Queue ({filteredDeals.length} Proposals)
              </span>
              <span className="text-[#8a919e]">High-density deal pipeline records</span>
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs text-[#e0e2ea] border-collapse">
                <thead className="bg-[#141820] text-[#8a919e] font-mono uppercase text-[10px] sticky top-0 border-b border-[#404752]">
                  <tr>
                    <th className="p-3">Deal Code &amp; Prospect</th>
                    <th className="p-3">Assigned Bundle</th>
                    <th className="p-3">Seats</th>
                    <th className="p-3">Contract MRR</th>
                    <th className="p-3">Pre-Assessment</th>
                    <th className="p-3">Pipeline Stage</th>
                    <th className="p-3">Rep</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#404752]/40">
                  {filteredDeals.map(deal => {
                    const isSelected = deal.id === selectedDealId;
                    const stageCfg = STAGE_CONFIGS.find(s => s.id === deal.stage);

                    return (
                      <tr
                        key={deal.id}
                        onClick={() => setSelectedDealId(deal.id)}
                        className={cn(
                          "hover:bg-[#181c22] transition-colors cursor-pointer",
                          isSelected ? "bg-[#181c22]" : ""
                        )}
                      >
                        <td className="p-3">
                          <div className="font-bold text-[#f0f4f8]">{deal.prospectName}</div>
                          <div className="text-[11px] font-mono text-[#8a919e]">{deal.dealCode} &bull; {deal.primaryDomain}</div>
                        </td>

                        <td className="p-3 font-mono text-[#a3c9ff]">
                          {deal.selectedBundleName}
                        </td>

                        <td className="p-3 font-mono font-bold">
                          {deal.seatCount} seats
                        </td>

                        <td className="p-3 font-mono font-bold text-emerald-400">
                          ${deal.mrrValue.toLocaleString()}/mo
                        </td>

                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded font-mono font-bold bg-purple-500/10 text-purple-300 border border-purple-500/30 text-[11px]">
                            {deal.preAssessmentScore}% ({deal.identifiedGapsCount} Gaps)
                          </span>
                        </td>

                        <td className="p-3">
                          <span className={cn("px-2 py-0.5 rounded text-[10px] font-mono font-bold border uppercase", stageCfg?.bg, stageCfg?.color, stageCfg?.border)}>
                            {stageCfg?.label.split('.')[1]}
                          </span>
                        </td>

                        <td className="p-3 text-[#8a919e]">
                          {deal.assignedRep}
                        </td>

                        <td className="p-3 text-right space-x-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDealId(deal.id);
                              setActiveView('pre_assessment');
                            }}
                            className="px-2 py-1 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#a3c9ff] rounded text-[11px] font-mono"
                          >
                            Inspect Audit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ======================================================================= */}
        {/* VIEW 3: PROSPECT PRE-ASSESSMENT AUDIT ENGINE */}
        {/* ======================================================================= */}
        {activeView === 'pre_assessment' && selectedDeal && (
          <div className="w-full h-full max-w-6xl mx-auto space-y-4 overflow-y-auto pr-1">
            
            {/* Top Prospect Identity Banner */}
            <div className="bg-[#101419] border border-[#404752] rounded-xl p-4 flex items-center justify-between flex-wrap gap-4 shadow-xl">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                  <Zap className="w-6 h-6 text-purple-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-[#f0f4f8]">{selectedDeal.prospectName}</h2>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40">
                      {selectedDeal.dealCode}
                    </span>
                  </div>
                  <p className="text-xs text-[#8a919e] font-mono">
                    Domain: {selectedDeal.primaryDomain} &bull; Contact: {selectedDeal.contactName} ({selectedDeal.contactEmail})
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsPitchPdfOpen(true)}
                  className="flex items-center gap-1.5 bg-[#0078d4] hover:bg-[#006cbd] text-white text-xs font-bold px-3 py-2 rounded transition-all shadow-md"
                >
                  <FileText className="w-4 h-4" />
                  <span>Generate Executive Pitch PDF</span>
                </button>
              </div>
            </div>

            {/* Score Comparison & Gap Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              {/* Scorecard Box */}
              <div className="bg-[#101419] border border-[#404752] rounded-xl p-4 space-y-4 shadow-lg">
                <h3 className="text-xs font-bold font-mono text-[#8a919e] uppercase tracking-wider">
                  M365 Pre-Assessment Health Score
                </h3>

                <div className="text-center p-4 bg-[#181c22] border border-[#404752] rounded-lg space-y-1">
                  <div className="text-4xl font-extrabold font-mono text-purple-400">
                    {selectedDeal.preAssessmentScore}<span className="text-lg text-[#8a919e]">/100</span>
                  </div>
                  <p className="text-xs text-red-400 font-semibold">
                    Industry Benchmark: 78/100 (30 Points Gap)
                  </p>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between text-[#8a919e]">
                    <span>Identified Risk Gaps:</span>
                    <span className="font-bold text-red-400 font-mono">{selectedDeal.identifiedGapsCount} Critical Gaps</span>
                  </div>
                  <div className="flex justify-between text-[#8a919e]">
                    <span>Unassigned License Waste:</span>
                    <span className="font-bold text-amber-400 font-mono">${selectedDeal.unassignedLicensesCost}/mo</span>
                  </div>
                  <div className="flex justify-between text-[#8a919e]">
                    <span>Proposed Upgrade Tier:</span>
                    <span className="font-bold text-[#a3c9ff] font-mono">{selectedDeal.selectedBundleName}</span>
                  </div>
                </div>
              </div>

              {/* Specific Surfaced Gaps for Sales Pitch */}
              <div className="md:col-span-2 bg-[#101419] border border-[#404752] rounded-xl p-4 space-y-3 shadow-lg">
                <h3 className="text-xs font-bold font-mono text-[#8a919e] uppercase tracking-wider flex items-center justify-between">
                  <span>Graph API Surfaced Risk Findings ({selectedDeal.identifiedGapsCount})</span>
                  <span className="text-[10px] text-purple-400 font-normal">Real-Time Prospect Audit</span>
                </h3>

                <div className="space-y-2.5">
                  <div className="p-3 bg-[#181c22] border border-red-500/30 rounded-lg flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-[#f0f4f8] flex items-center gap-2">
                        <span>{selectedDeal.missingMfaUsersCount} User Accounts Missing MFA Enforcement</span>
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-red-500/20 text-red-300">HIGH RISK</span>
                      </div>
                      <p className="text-xs text-[#8a919e]">
                        High vulnerability to credential stuffing. Enforcing Conditional Access in {selectedDeal.selectedBundleName} remedies this immediately.
                      </p>
                    </div>
                  </div>

                  <div className="p-3 bg-[#181c22] border border-red-500/30 rounded-lg flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-[#f0f4f8] flex items-center gap-2">
                        <span>{selectedDeal.legacyAuthCount} Active Mailboxes Allowing Legacy Protocols (IMAP/POP)</span>
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-red-500/20 text-red-300">HIGH RISK</span>
                      </div>
                      <p className="text-xs text-[#8a919e]">
                        Legacy auth bypasses MFA prompts. Baseline auto-heal rule will disable legacy transport agents.
                      </p>
                    </div>
                  </div>

                  <div className="p-3 bg-[#181c22] border border-amber-500/30 rounded-lg flex items-start gap-3">
                    <DollarSign className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-[#f0f4f8] flex items-center gap-2">
                        <span>Unassigned / Wasted M365 Licenses ($ {selectedDeal.unassignedLicensesCost}/mo Waste)</span>
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300">COST SPOILAGE</span>
                      </div>
                      <p className="text-xs text-[#8a919e]">
                        Re-allocating unassigned licenses covers over 35% of the proposed MSP Management Retainer.
                      </p>
                    </div>
                  </div>
                </div>

              </div>

            </div>

          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* 4. PROPOSAL BUILDER / CREATION DRAWER */}
      {/* ========================================================================= */}
      {isBuilderOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex justify-end transition-opacity">
          <div className="w-full max-w-xl bg-[#101419] border-l border-[#404752] h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            
            {/* Drawer Header */}
            <div className="p-4 bg-[#181c22] border-b border-[#404752] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSignature className="w-5 h-5 text-[#a3c9ff]" />
                <h2 className="text-sm font-bold text-[#f0f4f8]">Proposal &amp; Commercial Deal Wizard</h2>
              </div>
              <button
                onClick={() => setIsBuilderOpen(false)}
                className="text-[#8a919e] hover:text-[#e0e2ea] p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step Wizard Progress */}
            <div className="px-4 py-2 bg-[#141820] border-b border-[#404752] flex items-center justify-between text-xs font-mono text-[#8a919e]">
              <span className={cn(builderStep === 1 ? "text-[#a3c9ff] font-bold" : "")}>1. Prospect Info</span>
              <ChevronRight className="w-3 h-3" />
              <span className={cn(builderStep === 2 ? "text-[#a3c9ff] font-bold" : "")}>2. Pre-Assessment</span>
              <ChevronRight className="w-3 h-3" />
              <span className={cn(builderStep === 3 ? "text-[#a3c9ff] font-bold" : "")}>3. Select Bundle</span>
              <ChevronRight className="w-3 h-3" />
              <span className={cn(builderStep === 4 ? "text-[#a3c9ff] font-bold" : "")}>4. Review</span>
            </div>

            {/* Step Contents */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              
              {builderStep === 1 && (
                <div className="space-y-4">
                  <h3 className="font-bold text-[#f0f4f8] text-sm">Step 1: Prospect Company &amp; Primary Contact</h3>
                  
                  <div className="space-y-1">
                    <label className="text-[#8a919e] font-mono">Company Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. Apex Logistics Corp"
                      value={newDealForm.prospectName || ''}
                      onChange={(e) => setNewDealForm({ ...newDealForm, prospectName: e.target.value })}
                      className="w-full bg-[#181c22] border border-[#404752] rounded p-2 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[#8a919e] font-mono">Primary M365 Domain *</label>
                    <input
                      type="text"
                      placeholder="e.g. apexlogistics.com"
                      value={newDealForm.primaryDomain || ''}
                      onChange={(e) => setNewDealForm({ ...newDealForm, primaryDomain: e.target.value })}
                      className="w-full bg-[#181c22] border border-[#404752] rounded p-2 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[#8a919e] font-mono">Contact Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Marcus Vance"
                        value={newDealForm.contactName || ''}
                        onChange={(e) => setNewDealForm({ ...newDealForm, contactName: e.target.value })}
                        className="w-full bg-[#181c22] border border-[#404752] rounded p-2 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[#8a919e] font-mono">Contact Email</label>
                      <input
                        type="email"
                        placeholder="e.g. m.vance@apexlogistics.com"
                        value={newDealForm.contactEmail || ''}
                        onChange={(e) => setNewDealForm({ ...newDealForm, contactEmail: e.target.value })}
                        className="w-full bg-[#181c22] border border-[#404752] rounded p-2 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[#8a919e] font-mono">Target M365 Seat Count</label>
                    <input
                      type="number"
                      value={newDealForm.seatCount || 50}
                      onChange={(e) => setNewDealForm({ ...newDealForm, seatCount: parseInt(e.target.value) || 10 })}
                      className="w-full bg-[#181c22] border border-[#404752] rounded p-2 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
                    />
                  </div>
                </div>
              )}

              {builderStep === 2 && (
                <div className="space-y-4">
                  <h3 className="font-bold text-[#f0f4f8] text-sm">Step 2: Pre-Assessment Authorization</h3>
                  <p className="text-[#8a919e]">
                    Authorizing read-only Graph API access allows the platform to generate real risk metrics for your executive pitch deck.
                  </p>

                  <div className="bg-[#181c22] border border-[#404752] rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2 text-[#a3c9ff] font-bold">
                      <Zap className="w-4 h-4 text-purple-400" />
                      <span>Automated Graph Assessment Engine</span>
                    </div>
                    <p className="text-xs text-[#8a919e]">
                      Simulates security score audits, unassigned seat costs, MFA enforcement rates, and legacy authentication mailboxes.
                    </p>
                    <button
                      onClick={() => toast('info', 'Simulating Graph Audit', 'Read-only pre-assessment scan completed successfully.')}
                      className="w-full bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-300 py-2 rounded font-mono font-bold"
                    >
                      Run Pre-Assessment Audit Now
                    </button>
                  </div>
                </div>
              )}

              {builderStep === 3 && (
                <div className="space-y-4">
                  <h3 className="font-bold text-[#f0f4f8] text-sm">Step 3: Select Managed Sales Bundle</h3>

                  <div className="space-y-2">
                    <div
                      onClick={() => setNewDealForm({ ...newDealForm, selectedBundleId: 'bndl-gold', selectedBundleName: 'Gold - Secured Workplace' })}
                      className={cn(
                        "p-3 rounded-lg border cursor-pointer transition-all space-y-1",
                        newDealForm.selectedBundleId === 'bndl-gold' ? "bg-[#181c22] border-[#0078d4] ring-1 ring-[#0078d4]" : "bg-[#101419] border-[#404752]"
                      )}
                    >
                      <div className="flex justify-between font-bold text-[#f0f4f8]">
                        <span>Gold - Secured Workplace</span>
                        <span className="text-emerald-400 font-mono">$38.00 / seat / mo</span>
                      </div>
                      <p className="text-[#8a919e]">M365 Business Premium + Intune MDM Baseline + Auto-Heal Engine</p>
                    </div>

                    <div
                      onClick={() => setNewDealForm({ ...newDealForm, selectedBundleId: 'bndl-platinum', selectedBundleName: 'Platinum - Enterprise SOC & Governance' })}
                      className={cn(
                        "p-3 rounded-lg border cursor-pointer transition-all space-y-1",
                        newDealForm.selectedBundleId === 'bndl-platinum' ? "bg-[#181c22] border-[#0078d4] ring-1 ring-[#0078d4]" : "bg-[#101419] border-[#404752]"
                      )}
                    >
                      <div className="flex justify-between font-bold text-[#f0f4f8]">
                        <span>Platinum - Enterprise SOC &amp; Governance</span>
                        <span className="text-emerald-400 font-mono">$68.00 / seat / mo</span>
                      </div>
                      <p className="text-[#8a919e]">M365 E5 Suite + 24/7 SOC Threat Hunting + Entra PIM Access</p>
                    </div>

                    <div
                      onClick={() => setNewDealForm({ ...newDealForm, selectedBundleId: 'bndl-silver', selectedBundleName: 'Silver - Essentials M365' })}
                      className={cn(
                        "p-3 rounded-lg border cursor-pointer transition-all space-y-1",
                        newDealForm.selectedBundleId === 'bndl-silver' ? "bg-[#181c22] border-[#0078d4] ring-1 ring-[#0078d4]" : "bg-[#101419] border-[#404752]"
                      )}
                    >
                      <div className="flex justify-between font-bold text-[#f0f4f8]">
                        <span>Silver - Essentials M365</span>
                        <span className="text-emerald-400 font-mono">$22.00 / seat / mo</span>
                      </div>
                      <p className="text-[#8a919e]">Exchange Online + Identity Baseline + 5m Graph API Polling</p>
                    </div>
                  </div>
                </div>
              )}

              {builderStep === 4 && (
                <div className="space-y-4">
                  <h3 className="font-bold text-[#f0f4f8] text-sm">Step 4: Review Proposal &amp; Contract Summary</h3>

                  <div className="bg-[#181c22] border border-[#404752] rounded-lg p-4 space-y-2 font-mono">
                    <div className="flex justify-between text-[#8a919e]">
                      <span>Prospect:</span>
                      <span className="text-[#f0f4f8] font-bold">{newDealForm.prospectName}</span>
                    </div>
                    <div className="flex justify-between text-[#8a919e]">
                      <span>Seat Count:</span>
                      <span className="text-[#f0f4f8] font-bold">{newDealForm.seatCount} seats</span>
                    </div>
                    <div className="flex justify-between text-[#8a919e]">
                      <span>Selected Package:</span>
                      <span className="text-[#a3c9ff] font-bold">{newDealForm.selectedBundleName}</span>
                    </div>
                    <div className="pt-2 border-t border-[#404752] flex justify-between text-sm">
                      <span className="text-[#e0e2ea] font-bold">Estimated MRR:</span>
                      <span className="text-emerald-400 font-bold">
                        ${((newDealForm.selectedBundleId === 'bndl-platinum' ? 68 : newDealForm.selectedBundleId === 'bndl-silver' ? 22 : 38) * (newDealForm.seatCount || 50)).toLocaleString()}/mo
                      </span>
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* Drawer Footer Controls */}
            <div className="p-4 bg-[#181c22] border-t border-[#404752] flex items-center justify-between">
              {builderStep > 1 ? (
                <button
                  onClick={() => setBuilderStep((builderStep - 1) as any)}
                  className="px-3 py-1.5 bg-[#101419] border border-[#404752] rounded text-xs font-semibold text-[#e0e2ea]"
                >
                  Back
                </button>
              ) : <div />}

              {builderStep < 4 ? (
                <button
                  onClick={() => setBuilderStep((builderStep + 1) as any)}
                  className="px-4 py-1.5 bg-[#0078d4] hover:bg-[#006cbd] text-white rounded text-xs font-bold"
                >
                  Next Step
                </button>
              ) : (
                <button
                  onClick={handleCreateDeal}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Publish Proposal &amp; Send Sign-Off Link</span>
                </button>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. ONBOARDING HANDOFF MODAL */}
      {/* ========================================================================= */}
      {isOnboardingOpen && onboardingDeal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#101419] border border-[#404752] rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                <Sparkles className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#f0f4f8]">Automated Tenant Onboarding</h3>
                <p className="text-xs text-[#8a919e] font-mono">{onboardingDeal.prospectName} ({onboardingDeal.primaryDomain})</p>
              </div>
            </div>

            <div className="bg-[#181c22] border border-[#404752] rounded-lg p-3 space-y-2 text-xs">
              <div className="flex items-center gap-2 text-emerald-400 font-bold">
                <CheckCircle2 className="w-4 h-4" />
                <span>1-Click Provisioning Workflow</span>
              </div>
              <ul className="space-y-1 text-[#8a919e] pl-6 list-disc">
                <li>Attach 5-minute Graph API Drift Polling node</li>
                <li>Apply {onboardingDeal.selectedBundleName} default governance policy</li>
                <li>Register client in MSP Multi-Tenant Portal (`/portal/`)</li>
              </ul>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsOnboardingOpen(false)}
                className="px-3 py-1.5 bg-[#181c22] border border-[#404752] rounded text-xs text-[#e0e2ea]"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmOnboarding}
                disabled={isOnboardingLoading}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold flex items-center gap-1.5"
              >
                {isOnboardingLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                <span>Confirm Onboarding</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pitch Deck PDF Modal */}
      {isPitchPdfOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#101419] border border-[#404752] rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-[#f0f4f8]">Executive Pitch PDF Generated</h3>
              <button onClick={() => setIsPitchPdfOpen(false)} className="text-[#8a919e]"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-[#8a919e]">
              Executive summary featuring gap findings ({selectedDeal?.identifiedGapsCount} risks) and proposed {selectedDeal?.selectedBundleName} retainer ($ {selectedDeal?.mrrValue}/mo).
            </p>
            <button
              onClick={() => {
                setIsPitchPdfOpen(false);
                toast('success', 'PDF Downloaded', 'executive_pitch_deck_proposal.pdf downloaded.');
              }}
              className="w-full bg-[#0078d4] hover:bg-[#006cbd] text-white py-2 rounded text-xs font-bold flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span>Download Executive PDF</span>
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
