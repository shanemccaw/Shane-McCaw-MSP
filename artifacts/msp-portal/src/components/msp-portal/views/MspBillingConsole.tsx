import React, { useState, useMemo } from 'react';
import {
  CreditCard,
  Sparkles,
  TrendingUp,
  Receipt,
  Cpu,
  Zap,
  Download,
  AlertCircle,
  CheckCircle2,
  Building2,
  ShieldCheck,
  Layers,
  DollarSign,
  Calendar,
  ArrowUpRight,
  SlidersHorizontal,
  Plus,
  RefreshCw,
  Check,
  Copy,
  ChevronRight,
  X,
  Percent,
  Shield,
  FileText,
  Sliders,
  Mail,
  Lock,
  ExternalLink,
  ChevronDown,
  Info,
  Users2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tenant } from '../../types';

interface MspBillingConsoleProps {
  tenants?: Tenant[];
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
}

type BillingTab = 'subscription' | 'ai_analytics' | 'invoices' | 'payment_methods';

// Mock Invoice Interface
interface HistoricInvoice {
  invoiceNumber: string;
  billingPeriod: string;
  issueDate: string;
  amount: number;
  paymentMethod: string;
  status: 'Paid' | 'Processing' | 'Past Due';
  taxCertificate: string;
  baseTierCost: number;
  aiTokenCost: number;
  extraTenantsCost: number;
}

// Mock Historic Invoices
const HISTORIC_INVOICES: HistoricInvoice[] = [
  {
    invoiceNumber: 'INV-2026-0701',
    billingPeriod: 'Jun 1, 2026 - Jun 30, 2026',
    issueDate: '2026-07-01',
    amount: 533.20,
    paymentMethod: 'Visa ending in 4242',
    status: 'Paid',
    taxCertificate: 'US-VAT-EXEMPT-881',
    baseTierCost: 499.00,
    aiTokenCost: 34.20,
    extraTenantsCost: 0.00,
  },
  {
    invoiceNumber: 'INV-2026-0601',
    billingPeriod: 'May 1, 2026 - May 31, 2026',
    issueDate: '2026-06-01',
    amount: 521.80,
    paymentMethod: 'Visa ending in 4242',
    status: 'Paid',
    taxCertificate: 'US-VAT-EXEMPT-881',
    baseTierCost: 499.00,
    aiTokenCost: 22.80,
    extraTenantsCost: 0.00,
  },
  {
    invoiceNumber: 'INV-2026-0501',
    billingPeriod: 'Apr 1, 2026 - Apr 30, 2026',
    issueDate: '2026-05-01',
    amount: 499.00,
    paymentMethod: 'Visa ending in 4242',
    status: 'Paid',
    taxCertificate: 'US-VAT-EXEMPT-881',
    baseTierCost: 499.00,
    aiTokenCost: 0.00,
    extraTenantsCost: 0.00,
  },
  {
    invoiceNumber: 'INV-2026-0401',
    billingPeriod: 'Mar 1, 2026 - Mar 31, 2026',
    issueDate: '2026-04-01',
    amount: 499.00,
    paymentMethod: 'Visa ending in 4242',
    status: 'Paid',
    taxCertificate: 'US-VAT-EXEMPT-881',
    baseTierCost: 499.00,
    aiTokenCost: 0.00,
    extraTenantsCost: 0.00,
  },
];

// Mock Tenant AI Usage Data
const TENANT_AI_USAGE = [
  {
    tenantName: 'Contoso Corporation',
    domain: 'contoso.onmicrosoft.com',
    prompts: 412,
    tokensConsumed: '482,100',
    estimatedCost: 12.05,
    primaryUseCase: 'Security Executive Summaries',
  },
  {
    tenantName: 'Fabrikam Inc.',
    domain: 'fabrikam.onmicrosoft.com',
    prompts: 320,
    tokensConsumed: '390,400',
    estimatedCost: 9.76,
    primaryUseCase: 'Script Generation & Refactoring',
  },
  {
    tenantName: 'Northwind Traders',
    domain: 'northwind.onmicrosoft.com',
    prompts: 215,
    tokensConsumed: '240,000',
    estimatedCost: 6.00,
    primaryUseCase: 'Graph API Error Diagnostics',
  },
  {
    tenantName: 'Woodgrove Bank',
    domain: 'woodgrove.onmicrosoft.com',
    prompts: 180,
    tokensConsumed: '195,000',
    estimatedCost: 4.88,
    primaryUseCase: 'Automated QBR Narrative',
  },
  {
    tenantName: 'Tailwind Traders',
    domain: 'tailwind.onmicrosoft.com',
    prompts: 95,
    tokensConsumed: '108,000',
    estimatedCost: 2.70,
    primaryUseCase: 'PIM & MFA Policy Audit',
  },
];

export const MspBillingConsole: React.FC<MspBillingConsoleProps> = ({
  tenants = [],
  onShowToast,
}) => {
  // Navigation
  const [activeTab, setActiveTab] = useState<BillingTab>('subscription');

  // Subscription state
  const [isAnnual, setIsAnnual] = useState(false);
  const [monitoredTenantsCount, setMonitoredTenantsCount] = useState(18);
  const maxTenantsLimit = 25;
  const [aiTokenCreditBalance, setAiTokenCreditBalance] = useState(142.50);
  const [aiTokenCount, setAiTokenCount] = useState('1.42M');

  // Spend Limit Controls State
  const [spendLimitEnabled, setSpendLimitEnabled] = useState(true);
  const [monthlySpendLimit, setMonthlySpendLimit] = useState(250);
  const [autoTopUpEnabled, setAutoTopUpEnabled] = useState(true);

  // Billing Notification Toggles
  const [notify80Percent, setNotify80Percent] = useState(true);
  const [notifyLowCredits, setNotifyLowCredits] = useState(true);
  const [notifyMonthlyPdf, setNotifyMonthlyPdf] = useState(true);

  // Modals
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showPlanChangeModal, setShowPlanChangeModal] = useState(false);
  const [selectedPlanForUpgrade, setSelectedPlanForUpgrade] = useState<'Basic' | 'Enhanced' | 'Premium'>('Enhanced');
  const [showItemizedModal, setShowItemizedModal] = useState<HistoricInvoice | null>(null);
  const [showAddCardModal, setShowAddCardModal] = useState(false);

  // Top Up Credits Selection
  const [selectedCreditBundle, setSelectedCreditBundle] = useState<{ price: number; tokens: string }>({
    price: 50,
    tokens: '2.5M Tokens',
  });

  // Calculate pricing based on annual toggle (15% discount)
  const getTierPrice = (monthlyPrice: number) => {
    if (isAnnual) {
      return Math.round(monthlyPrice * 0.85);
    }
    return monthlyPrice;
  };

  // Capacity calculation
  const tenantPercentage = Math.min(100, Math.round((monitoredTenantsCount / maxTenantsLimit) * 100));

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-[#e0e2ea] font-sans overflow-y-auto select-none p-4 lg:p-6 space-y-6">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & SUBSCRIPTION STATUS BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border border-[#404752] rounded-lg p-5 shadow-lg space-y-4">
        
        {/* Top metadata row */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#404752] pb-4">
          
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-lg bg-[#0078d4]/20 border border-[#0078d4] flex items-center justify-center text-[#a3c9ff] shrink-0">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-[#e0e2ea] tracking-tight">Apex Managed Services</h1>
                <span className="px-2 py-0.5 rounded bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40 text-xs font-mono font-bold">
                  Basic Tier ($499/mo)
                </span>
              </div>
              <div className="text-xs text-[#8a919e] flex items-center gap-3 mt-0.5 flex-wrap font-mono">
                <span>Account ID: ACT-98402194</span>
                <span>•</span>
                <span>Tax ID: US-98402194</span>
                <span>•</span>
                <span>Contact: billing@apexmanaged.com</span>
              </div>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={() => setShowPlanChangeModal(true)}
              className="px-3.5 py-2 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
            >
              <CreditCard className="w-4 h-4" />
              <span>Change Subscription Plan</span>
            </button>

            <button
              onClick={() => setActiveTab('payment_methods')}
              className="px-3 py-2 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Lock className="w-4 h-4 text-[#a3c9ff]" />
              <span>Update Payment Method</span>
            </button>

            <button
              onClick={() => {
                onShowToast?.('success', 'Statement Downloaded', 'Current unbilled ledger statement PDF exported.');
              }}
              className="px-3 py-2 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download Statement</span>
            </button>
          </div>

        </div>

        {/* Capacity Gauges Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-1">
          
          {/* Tenant Capacity Gauge Card */}
          <div className="bg-[#101419] border border-[#404752] rounded-md p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8a919e] font-semibold flex items-center gap-1.5">
                <Users2 className="w-4 h-4 text-[#a3c9ff]" />
                Tenant Capacity Gauge
              </span>
              <span className="font-mono font-bold text-[#e0e2ea]">
                {monitoredTenantsCount} / {maxTenantsLimit} Used
              </span>
            </div>

            <div className="w-full bg-[#272a30] h-2 rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  tenantPercentage >= 90
                    ? 'bg-red-500'
                    : tenantPercentage >= 80
                    ? 'bg-amber-400'
                    : 'bg-[#0078d4]'
                )}
                style={{ width: `${tenantPercentage}%` }}
              />
            </div>

            <p className="text-[11px] text-[#8a919e] leading-snug">
              Reaching {maxTenantsLimit} tenants will automatically require an upgrade to Enhanced Tier ($999/mo for up to 75 tenants).
            </p>
          </div>

          {/* AI Credit Balance Widget */}
          <div className="bg-[#101419] border border-[#404752] rounded-md p-3.5 flex items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs text-[#8a919e] font-semibold flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-purple-400 animate-pulse" />
                <span>AI Credit Balance</span>
              </div>
              <div className="text-lg font-bold text-[#e0e2ea] font-mono">
                ${aiTokenCreditBalance.toFixed(2)}{' '}
                <span className="text-xs text-[#a3c9ff] font-normal">({aiTokenCount} Tokens)</span>
              </div>
              <div className="text-[10.5px] text-[#8a919e]">Included in plan + purchased bundles</div>
            </div>

            <button
              onClick={() => setShowTopUpModal(true)}
              className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-bold flex items-center gap-1 cursor-pointer transition-all shrink-0 shadow-sm"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Top Up Credits</span>
            </button>
          </div>

          {/* Unbilled Accrued Charges Preview */}
          <div className="bg-[#101419] border border-[#404752] rounded-md p-3.5 space-y-1">
            <div className="text-xs text-[#8a919e] font-semibold flex items-center gap-1.5">
              <Receipt className="w-4 h-4 text-[#4ade80]" />
              <span>Next Estimated Invoice (Aug 1, 2026)</span>
            </div>
            <div className="text-lg font-bold text-[#4ade80] font-mono">$533.20</div>
            <div className="text-[10.5px] text-[#8a919e] font-mono">
              Base: $499.00 + AI Token Overage: $34.20
            </div>
          </div>

        </div>

      </div>

      {/* ========================================================================= */}
      {/* 2. CORE NAVIGATION (4 SUB-TABS) */}
      {/* ========================================================================= */}
      <div className="flex items-center gap-2 border-b border-[#404752] pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('subscription')}
          className={cn(
            'px-4 py-2 rounded text-xs font-bold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap',
            activeTab === 'subscription'
              ? 'bg-[#0078d4] text-white shadow-sm'
              : 'text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#181c22]'
          )}
        >
          <CreditCard className="w-4 h-4" />
          <span>Subscription & Plan Tiers</span>
        </button>

        <button
          onClick={() => setActiveTab('ai_analytics')}
          className={cn(
            'px-4 py-2 rounded text-xs font-bold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap',
            activeTab === 'ai_analytics'
              ? 'bg-[#0078d4] text-white shadow-sm'
              : 'text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#181c22]'
          )}
        >
          <Sparkles className="w-4 h-4 text-purple-300" />
          <span>AI Billing & Consumption Analytics</span>
        </button>

        <button
          onClick={() => setActiveTab('invoices')}
          className={cn(
            'px-4 py-2 rounded text-xs font-bold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap',
            activeTab === 'invoices'
              ? 'bg-[#0078d4] text-white shadow-sm'
              : 'text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#181c22]'
          )}
        >
          <Receipt className="w-4 h-4" />
          <span>Invoices & Billing Statements</span>
        </button>

        <button
          onClick={() => setActiveTab('payment_methods')}
          className={cn(
            'px-4 py-2 rounded text-xs font-bold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap',
            activeTab === 'payment_methods'
              ? 'bg-[#0078d4] text-white shadow-sm'
              : 'text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#181c22]'
          )}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>Payment Methods & Preferences</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: SUBSCRIPTION & PLAN TIERS */}
      {/* ========================================================================= */}
      {activeTab === 'subscription' && (
        <div className="space-y-6">
          
          {/* Annual / Monthly Toggle Bar */}
          <div className="bg-[#181c22] border border-[#404752] rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-sm text-[#e0e2ea]">Select Billing Cycle</h3>
              <p className="text-xs text-[#8a919e]">Switch to annual commitment and save 15% across all MSP tiers.</p>
            </div>

            <div className="flex items-center gap-3 bg-[#101419] border border-[#404752] rounded p-1">
              <button
                onClick={() => setIsAnnual(false)}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer',
                  !isAnnual ? 'bg-[#0078d4] text-white' : 'text-[#8a919e] hover:text-[#e0e2ea]'
                )}
              >
                Monthly Billing
              </button>
              <button
                onClick={() => setIsAnnual(true)}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
                  isAnnual ? 'bg-[#0078d4] text-white' : 'text-[#8a919e] hover:text-[#e0e2ea]'
                )}
              >
                <span>Annual Commitment</span>
                <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[10px] border border-emerald-500/40 font-mono">
                  Save 15%
                </span>
              </button>
            </div>
          </div>

          {/* Plan Comparison Card Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* BASIC TIER (Current) */}
            <div className="bg-[#181c22] border-2 border-[#0078d4] rounded-lg p-5 flex flex-col justify-between space-y-4 shadow-md relative">
              <span className="absolute -top-3 right-4 px-2.5 py-0.5 rounded bg-[#0078d4] text-white text-[10px] font-mono font-bold uppercase tracking-wider">
                CURRENT PLAN
              </span>

              <div className="space-y-2">
                <h4 className="text-base font-bold text-[#e0e2ea]">Basic Tier</h4>
                <p className="text-xs text-[#8a919e]">Essential multi-tenant monitoring for growing MSPs.</p>

                <div className="pt-2">
                  <span className="text-3xl font-extrabold text-[#e0e2ea] font-mono">
                    ${getTierPrice(499)}
                  </span>
                  <span className="text-xs text-[#8a919e]"> / month</span>
                  {isAnnual && <div className="text-[10px] text-[#4ade80] font-mono">Billed annually ($5,089/yr)</div>}
                </div>

                <div className="border-t border-[#404752] pt-3 space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-[#e0e2ea]">
                    <CheckCircle2 className="w-4 h-4 text-[#4ade80] shrink-0" />
                    <span>Up to <strong>25 Monitored Tenants</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-[#e0e2ea]">
                    <CheckCircle2 className="w-4 h-4 text-[#4ade80] shrink-0" />
                    <span><strong>5-minute</strong> Graph Polling Rate</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#e0e2ea]">
                    <CheckCircle2 className="w-4 h-4 text-[#4ade80] shrink-0" />
                    <span><strong>500,000 Included</strong> AI Tokens / mo</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#e0e2ea]">
                    <CheckCircle2 className="w-4 h-4 text-[#4ade80] shrink-0" />
                    <span>Standard Community Support</span>
                  </div>
                </div>
              </div>

              <button
                disabled
                className="w-full py-2 bg-[#272a30] text-[#8a919e] border border-[#404752] rounded font-bold text-xs cursor-default text-center"
              >
                Active Tier
              </button>
            </div>

            {/* ENHANCED TIER */}
            <div className="bg-[#181c22] border border-[#404752] hover:border-purple-500 rounded-lg p-5 flex flex-col justify-between space-y-4 shadow-md transition-all">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-base font-bold text-[#e0e2ea]">Enhanced Tier</h4>
                  <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 text-[10px] font-mono font-bold">
                    RECOMMENDED
                  </span>
                </div>
                <p className="text-xs text-[#8a919e]">Advanced automation & Intune/PIM bulk remediation.</p>

                <div className="pt-2">
                  <span className="text-3xl font-extrabold text-[#e0e2ea] font-mono">
                    ${getTierPrice(999)}
                  </span>
                  <span className="text-xs text-[#8a919e]"> / month</span>
                  {isAnnual && <div className="text-[10px] text-[#4ade80] font-mono">Billed annually ($10,189/yr)</div>}
                </div>

                <div className="border-t border-[#404752] pt-3 space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-[#e0e2ea]">
                    <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
                    <span>Up to <strong>75 Monitored Tenants</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-[#e0e2ea]">
                    <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
                    <span><strong>1-minute</strong> High-Frequency Polling</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#e0e2ea]">
                    <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
                    <span><strong>2,500,000 Included</strong> AI Tokens / mo</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#e0e2ea]">
                    <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
                    <span>Advanced Intune & PIM Bulk Actions</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#e0e2ea]">
                    <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
                    <span>Priority 24/7 SLA Support</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  setSelectedPlanForUpgrade('Enhanced');
                  setShowPlanChangeModal(true);
                }}
                className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white rounded font-bold text-xs cursor-pointer transition-all text-center shadow-sm"
              >
                Upgrade to Enhanced
              </button>
            </div>

            {/* PREMIUM TIER */}
            <div className="bg-[#181c22] border border-[#404752] hover:border-amber-500 rounded-lg p-5 flex flex-col justify-between space-y-4 shadow-md transition-all">
              <div className="space-y-2">
                <h4 className="text-base font-bold text-[#e0e2ea]">Premium Tier</h4>
                <p className="text-xs text-[#8a919e]">Enterprise scale with Auto-Healing & Dedicated Graph Nodes.</p>

                <div className="pt-2">
                  <span className="text-3xl font-extrabold text-[#e0e2ea] font-mono">
                    ${getTierPrice(1899)}
                  </span>
                  <span className="text-xs text-[#8a919e]"> / month</span>
                  {isAnnual && <div className="text-[10px] text-[#4ade80] font-mono">Billed annually ($19,369/yr)</div>}
                </div>

                <div className="border-t border-[#404752] pt-3 space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-[#e0e2ea]">
                    <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                    <span><strong>Unlimited</strong> Monitored Tenants</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#e0e2ea]">
                    <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                    <span><strong>Real-time</strong> Webhook Sync Engine</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#e0e2ea]">
                    <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                    <span><strong>10,000,000 Included</strong> AI Tokens / mo</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#e0e2ea]">
                    <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Auto-Healing Policy Drift Workflows</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#e0e2ea]">
                    <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Dedicated Graph Runner & TAM</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  setSelectedPlanForUpgrade('Premium');
                  setShowPlanChangeModal(true);
                }}
                className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded font-bold text-xs cursor-pointer transition-all text-center shadow-sm"
              >
                Upgrade to Premium
              </button>
            </div>

          </div>

          {/* Add-On Capacity Cards Section */}
          <div className="bg-[#181c22] border border-[#404752] rounded-lg p-5 space-y-4">
            <h3 className="font-bold text-sm text-[#e0e2ea]">Add-On Modular Capacity Packs</h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              
              <div className="bg-[#101419] border border-[#404752] rounded p-4 flex flex-col justify-between space-y-3">
                <div>
                  <div className="font-bold text-[#e0e2ea]">Extra Tenant Slot Pack</div>
                  <div className="text-[#8a919e] mt-0.5">+10 Additional Monitored Tenant Slots</div>
                  <div className="text-base font-bold text-[#a3c9ff] font-mono mt-2">$150 / month</div>
                </div>
                <button
                  onClick={() => {
                    setMonitoredTenantsCount((prev) => prev + 10);
                    onShowToast?.('success', 'Tenant Slot Pack Purchased', 'Added +10 monitored tenant capacity slots to your account.');
                  }}
                  className="w-full py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded font-bold cursor-pointer transition-all"
                >
                  + Add Pack
                </button>
              </div>

              <div className="bg-[#101419] border border-[#404752] rounded p-4 flex flex-col justify-between space-y-3">
                <div>
                  <div className="font-bold text-[#e0e2ea]">Extra AI Token Bundle</div>
                  <div className="text-[#8a919e] mt-0.5">1,000,000 Additional Tokens</div>
                  <div className="text-base font-bold text-purple-400 font-mono mt-2">$25 / month</div>
                </div>
                <button
                  onClick={() => setShowTopUpModal(true)}
                  className="w-full py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded font-bold cursor-pointer transition-all"
                >
                  Purchase Bundle
                </button>
              </div>

              <div className="bg-[#101419] border border-[#404752] rounded p-4 flex flex-col justify-between space-y-3">
                <div>
                  <div className="font-bold text-[#e0e2ea]">Dedicated Graph Polling Node</div>
                  <div className="text-[#8a919e] mt-0.5">Isolated Azure Proxy Instance with Zero Throttling</div>
                  <div className="text-base font-bold text-[#4ade80] font-mono mt-2">$200 / month</div>
                </div>
                <button
                  onClick={() =>
                    onShowToast?.('info', 'Node Provisioning Requested', 'Your account manager will configure dedicated node routing.')
                  }
                  className="w-full py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded font-bold cursor-pointer transition-all"
                >
                  Request Dedicated Node
                </button>
              </div>

            </div>
          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: AI BILLING & CONSUMPTION ANALYTICS */}
      {/* ========================================================================= */}
      {activeTab === 'ai_analytics' && (
        <div className="space-y-6">
          
          {/* Charts & Spend Limit Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Feature Usage Breakdown Progress Bars */}
            <div className="bg-[#181c22] border border-[#404752] rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#404752] pb-2">
                <h3 className="font-bold text-sm text-[#e0e2ea] flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  AI Feature Usage Distribution
                </h3>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <div className="flex items-center justify-between font-semibold mb-1">
                    <span className="text-[#e0e2ea]">Script Generation & Refactoring</span>
                    <span className="text-purple-300 font-mono">42%</span>
                  </div>
                  <div className="w-full bg-[#101419] h-2 rounded-full overflow-hidden border border-[#404752]">
                    <div className="bg-purple-500 h-full rounded-full" style={{ width: '42%' }} />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between font-semibold mb-1">
                    <span className="text-[#e0e2ea]">Security Executive Summaries</span>
                    <span className="text-purple-300 font-mono">28%</span>
                  </div>
                  <div className="w-full bg-[#101419] h-2 rounded-full overflow-hidden border border-[#404752]">
                    <div className="bg-[#0078d4] h-full rounded-full" style={{ width: '28%' }} />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between font-semibold mb-1">
                    <span className="text-[#e0e2ea]">Graph API Error Diagnostics</span>
                    <span className="text-purple-300 font-mono">18%</span>
                  </div>
                  <div className="w-full bg-[#101419] h-2 rounded-full overflow-hidden border border-[#404752]">
                    <div className="bg-emerald-400 h-full rounded-full" style={{ width: '18%' }} />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between font-semibold mb-1">
                    <span className="text-[#e0e2ea]">Automated QBR Narrative Generation</span>
                    <span className="text-purple-300 font-mono">12%</span>
                  </div>
                  <div className="w-full bg-[#101419] h-2 rounded-full overflow-hidden border border-[#404752]">
                    <div className="bg-amber-400 h-full rounded-full" style={{ width: '12%' }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Token Spend & Hard Limit Controls */}
            <div className="lg:col-span-2 bg-[#181c22] border border-[#404752] rounded-lg p-5 space-y-4">
              <h3 className="font-bold text-sm text-[#e0e2ea]">AI Monthly Token Spend & Guardrail Controls</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Hard Limit Slider */}
                <div className="bg-[#101419] border border-[#404752] p-4 rounded space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-[#e0e2ea]">Hard Stop Spend Limit</span>
                    <input
                      type="checkbox"
                      checked={spendLimitEnabled}
                      onChange={(e) => setSpendLimitEnabled(e.target.checked)}
                      className="accent-[#0078d4] cursor-pointer"
                    />
                  </div>

                  <p className="text-[11px] text-[#8a919e]">
                    Prevents automated agent execution if monthly AI token overage exceeds limit.
                  </p>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between font-mono text-xs font-bold text-[#a3c9ff]">
                      <span>Limit Cap:</span>
                      <span>${monthlySpendLimit}.00 / month</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="1000"
                      step="25"
                      value={monthlySpendLimit}
                      disabled={!spendLimitEnabled}
                      onChange={(e) => setMonthlySpendLimit(parseInt(e.target.value, 10))}
                      className="w-full accent-[#0078d4] cursor-pointer disabled:opacity-40"
                    />
                  </div>
                </div>

                {/* Auto Top-Up Switch */}
                <div className="bg-[#101419] border border-[#404752] p-4 rounded space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-[#e0e2ea]">Auto-Top-Up Credit Rule</span>
                    <input
                      type="checkbox"
                      checked={autoTopUpEnabled}
                      onChange={(e) => setAutoTopUpEnabled(e.target.checked)}
                      className="accent-purple-600 cursor-pointer"
                    />
                  </div>

                  <p className="text-[11px] text-[#8a919e]">
                    Automatically purchase $50 token credit bundle when remaining balance drops below $10.00.
                  </p>

                  <div className="text-[11px] font-mono text-[#4ade80] font-semibold bg-[#166534]/20 p-2 rounded border border-[#166534]">
                    Status: {autoTopUpEnabled ? 'Active (Triggers at $10.00)' : 'Disabled'}
                  </div>
                </div>

              </div>
            </div>

          </div>

          {/* Tenant-Level AI Usage Breakdown Table */}
          <div className="bg-[#181c22] border border-[#404752] rounded-lg p-5 space-y-4">
            <h3 className="font-bold text-sm text-[#e0e2ea]">Tenant-Level AI Consumption Ledger</h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#101419] text-[#8a919e] font-mono border-b border-[#404752]">
                    <th className="p-3">Tenant Name</th>
                    <th className="p-3">Domain</th>
                    <th className="p-3 text-right">Prompts Executed</th>
                    <th className="p-3 text-right">Tokens Consumed</th>
                    <th className="p-3 text-right">Estimated Cost ($)</th>
                    <th className="p-3">Primary Use Case</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#404752]/60">
                  {TENANT_AI_USAGE.map((item, idx) => (
                    <tr key={idx} className="hover:bg-[#101419]/60 transition-colors">
                      <td className="p-3 font-bold text-[#e0e2ea]">{item.tenantName}</td>
                      <td className="p-3 text-[#8a919e] font-mono">{item.domain}</td>
                      <td className="p-3 text-right font-mono text-[#a3c9ff]">{item.prompts}</td>
                      <td className="p-3 text-right font-mono text-purple-300">{item.tokensConsumed}</td>
                      <td className="p-3 text-right font-mono text-[#4ade80] font-bold">
                        ${item.estimatedCost.toFixed(2)}
                      </td>
                      <td className="p-3 text-[#e0e2ea]">{item.primaryUseCase}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: INVOICES & BILLING STATEMENTS */}
      {/* ========================================================================= */}
      {activeTab === 'invoices' && (
        <div className="space-y-6">
          
          {/* Historic Invoices Table */}
          <div className="bg-[#181c22] border border-[#404752] rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <h3 className="font-bold text-sm text-[#e0e2ea]">Historic Paid Statements & PDF Downloads</h3>
              <span className="text-xs text-[#8a919e] font-mono">Tax Exemption Cert: US-VAT-EXEMPT-881</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#101419] text-[#8a919e] font-mono border-b border-[#404752]">
                    <th className="p-3">Invoice Number</th>
                    <th className="p-3">Billing Period</th>
                    <th className="p-3">Issue Date</th>
                    <th className="p-3 text-right">Amount ($)</th>
                    <th className="p-3">Payment Method</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#404752]/60">
                  {HISTORIC_INVOICES.map((inv) => (
                    <tr key={inv.invoiceNumber} className="hover:bg-[#101419]/60 transition-colors">
                      <td className="p-3 font-mono font-bold text-[#a3c9ff]">{inv.invoiceNumber}</td>
                      <td className="p-3 text-[#e0e2ea]">{inv.billingPeriod}</td>
                      <td className="p-3 text-[#8a919e] font-mono">{inv.issueDate}</td>
                      <td className="p-3 text-right font-mono font-bold text-[#e0e2ea]">
                        ${inv.amount.toFixed(2)}
                      </td>
                      <td className="p-3 text-[#8a919e]">{inv.paymentMethod}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded bg-[#166534]/30 text-[#4ade80] border border-[#166534] font-mono font-bold text-[10px]">
                          {inv.status}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => setShowItemizedModal(inv)}
                            className="px-2 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] border border-[#404752] rounded text-[10.5px] font-semibold cursor-pointer"
                          >
                            Itemized View
                          </button>
                          <button
                            onClick={() =>
                              onShowToast?.('success', 'PDF Downloaded', `Invoice ${inv.invoiceNumber}.pdf downloaded.`)
                            }
                            className="p-1 text-[#8a919e] hover:text-[#e0e2ea] cursor-pointer"
                            title="Download PDF"
                          >
                            <Download className="w-4 h-4" />
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

      {/* ========================================================================= */}
      {/* TAB 4: PAYMENT METHODS & PREFERENCES */}
      {/* ========================================================================= */}
      {activeTab === 'payment_methods' && (
        <div className="space-y-6">
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Saved Payment Cards */}
            <div className="bg-[#181c22] border border-[#404752] rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#404752] pb-3">
                <h3 className="font-bold text-sm text-[#e0e2ea]">Saved Payment Cards</h3>
                <button
                  onClick={() => setShowAddCardModal(true)}
                  className="px-2.5 py-1 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Card</span>
                </button>
              </div>

              <div className="space-y-3">
                {/* Primary Card */}
                <div className="bg-[#101419] border border-[#0078d4] p-4 rounded-md flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded bg-[#0078d4]/20 text-[#a3c9ff]">
                      <CreditCard className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#e0e2ea]">Visa ending in 4242</span>
                        <span className="px-1.5 py-0.2 rounded bg-[#0078d4]/30 text-[#a3c9ff] text-[9.5px] font-mono font-bold">
                          DEFAULT
                        </span>
                      </div>
                      <div className="text-xs text-[#8a919e] mt-0.5">Expires 09/2028 • Apex Corporate Account</div>
                    </div>
                  </div>
                </div>

                {/* Backup Card */}
                <div className="bg-[#101419] border border-[#404752] p-4 rounded-md flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded bg-[#272a30] text-[#8a919e]">
                      <Building2 className="w-6 h-6" />
                    </div>
                    <div>
                      <span className="font-bold text-sm text-[#e0e2ea]">ACH Direct Debit ending in 8812</span>
                      <div className="text-xs text-[#8a919e] mt-0.5">JPMorgan Chase Business Account</div>
                    </div>
                  </div>

                  <button
                    onClick={() => onShowToast?.('info', 'Payment Method Set', 'ACH Debit set as primary payment method.')}
                    className="text-xs text-[#a3c9ff] hover:underline cursor-pointer"
                  >
                    Set Primary
                  </button>
                </div>
              </div>
            </div>

            {/* Corporate Billing Preferences & Notifications */}
            <div className="bg-[#181c22] border border-[#404752] rounded-lg p-5 space-y-4">
              <h3 className="font-bold text-sm text-[#e0e2ea]">Billing Email & Notification Preferences</h3>

              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between bg-[#101419] p-3 rounded border border-[#404752]">
                  <div>
                    <div className="font-bold text-[#e0e2ea]">Email when approaching 80% tenant limit</div>
                    <div className="text-[#8a919e]">Alerts global admins to upgrade capacity</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notify80Percent}
                    onChange={(e) => setNotify80Percent(e.target.checked)}
                    className="accent-[#0078d4] cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between bg-[#101419] p-3 rounded border border-[#404752]">
                  <div>
                    <div className="font-bold text-[#e0e2ea]">Email when AI credit balance drops below threshold</div>
                    <div className="text-[#8a919e]">Prevents AI agent interruption</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifyLowCredits}
                    onChange={(e) => setNotifyLowCredits(e.target.checked)}
                    className="accent-[#0078d4] cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between bg-[#101419] p-3 rounded border border-[#404752]">
                  <div>
                    <div className="font-bold text-[#e0e2ea]">Send monthly executive PDF summary to accounting</div>
                    <div className="text-[#8a919e]">Delivered to accounting@apexmanaged.com</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifyMonthlyPdf}
                    onChange={(e) => setNotifyMonthlyPdf(e.target.checked)}
                    className="accent-[#0078d4] cursor-pointer"
                  />
                </div>
              </div>
            </div>

          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: TOP UP AI CREDITS MODAL */}
      {/* ========================================================================= */}
      {showTopUpModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#181c22] border border-[#404752] rounded-lg p-6 w-full max-w-md space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-400" />
                <h3 className="font-bold text-base text-[#e0e2ea]">Top Up AI Token Credits</h3>
              </div>
              <button
                onClick={() => setShowTopUpModal(false)}
                className="p-1 rounded text-[#8a919e] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-[#8a919e]">Select a prepaid token bundle to instantly reload your MSP AI balance:</p>

              <div className="space-y-2">
                {[
                  { price: 25, tokens: '1.0M Tokens' },
                  { price: 50, tokens: '2.5M Tokens' },
                  { price: 100, tokens: '6.0M Tokens' },
                ].map((b) => (
                  <div
                    key={b.price}
                    onClick={() => setSelectedCreditBundle(b)}
                    className={cn(
                      'p-3 rounded border cursor-pointer flex items-center justify-between transition-all',
                      selectedCreditBundle.price === b.price
                        ? 'bg-purple-950/40 border-purple-500 text-white'
                        : 'bg-[#101419] border-[#404752] text-[#8a919e]'
                    )}
                  >
                    <span className="font-bold">{b.tokens}</span>
                    <span className="font-mono text-sm font-extrabold text-[#4ade80]">${b.price}.00</span>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => {
                setAiTokenCreditBalance((prev) => prev + selectedCreditBundle.price);
                setShowTopUpModal(false);
                onShowToast?.('success', 'AI Tokens Reloaded', `Purchased ${selectedCreditBundle.tokens} for $${selectedCreditBundle.price}.00.`);
              }}
              className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded font-bold text-xs cursor-pointer shadow-md transition-all"
            >
              Confirm Purchase (${selectedCreditBundle.price}.00)
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: PRORATED PLAN CHANGE MODAL */}
      {/* ========================================================================= */}
      {showPlanChangeModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#181c22] border border-[#404752] rounded-lg p-6 w-full max-w-lg space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <h3 className="font-bold text-base text-[#e0e2ea]">
                Upgrade Plan to {selectedPlanForUpgrade} Tier
              </h3>
              <button
                onClick={() => setShowPlanChangeModal(false)}
                className="p-1 rounded text-[#8a919e] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs bg-[#101419] border border-[#404752] p-4 rounded">
              <div className="flex items-center justify-between text-[#8a919e]">
                <span>Current Plan (Basic Tier):</span>
                <span>$499.00 / mo</span>
              </div>
              <div className="flex items-center justify-between text-[#e0e2ea] font-bold">
                <span>New Tier ({selectedPlanForUpgrade}):</span>
                <span>
                  ${selectedPlanForUpgrade === 'Enhanced' ? '999.00' : '1,899.00'} / mo
                </span>
              </div>
              <div className="border-t border-[#404752] pt-2 flex items-center justify-between font-mono text-emerald-400 font-bold">
                <span>Prorated Adjustment Today:</span>
                <span>
                  +${selectedPlanForUpgrade === 'Enhanced' ? '250.00' : '700.00'} due now
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowPlanChangeModal(false)}
                className="px-4 py-2 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowPlanChangeModal(false);
                  onShowToast?.('success', 'Plan Upgraded Successfully', `Account updated to ${selectedPlanForUpgrade} Tier.`);
                }}
                className="px-4 py-2 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-bold cursor-pointer"
              >
                Confirm Upgrade
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: ITEMIZED INVOICE MODAL */}
      {/* ========================================================================= */}
      {showItemizedModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#181c22] border border-[#404752] rounded-lg p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <div>
                <h3 className="font-bold text-base text-[#e0e2ea]">
                  Itemized Breakdown ({showItemizedModal.invoiceNumber})
                </h3>
                <p className="text-xs text-[#8a919e]">{showItemizedModal.billingPeriod}</p>
              </div>
              <button
                onClick={() => setShowItemizedModal(null)}
                className="p-1 rounded text-[#8a919e] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs font-mono bg-[#101419] p-4 rounded border border-[#404752]">
              <div className="flex items-center justify-between text-[#e0e2ea]">
                <span>Base Tier Subscription:</span>
                <span>${showItemizedModal.baseTierCost.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-[#e0e2ea]">
                <span>Extra Graph Endpoints Polled:</span>
                <span>$0.00</span>
              </div>
              <div className="flex items-center justify-between text-[#e0e2ea]">
                <span>AI Token Usage Overage:</span>
                <span>${showItemizedModal.aiTokenCost.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-[#e0e2ea]">
                <span>Sales Tax / VAT Exemption:</span>
                <span>$0.00</span>
              </div>
              <div className="border-t border-[#404752] pt-2 flex items-center justify-between font-bold text-base text-[#4ade80]">
                <span>TOTAL PAID:</span>
                <span>${showItemizedModal.amount.toFixed(2)}</span>
              </div>
            </div>

            <button
              onClick={() => setShowItemizedModal(null)}
              className="w-full py-2 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded font-bold text-xs cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: ADD PAYMENT CARD MODAL */}
      {/* ========================================================================= */}
      {showAddCardModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#181c22] border border-[#404752] rounded-lg p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <h3 className="font-bold text-base text-[#e0e2ea]">Add Payment Card</h3>
              <button
                onClick={() => setShowAddCardModal(false)}
                className="p-1 rounded text-[#8a919e] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[#8a919e] mb-1">Card Number</label>
                <input
                  type="text"
                  placeholder="4532 •••• •••• 8810"
                  className="w-full bg-[#101419] border border-[#404752] rounded p-2 text-[#e0e2ea] outline-none font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#8a919e] mb-1">Expiration</label>
                  <input
                    type="text"
                    placeholder="MM/YY"
                    className="w-full bg-[#101419] border border-[#404752] rounded p-2 text-[#e0e2ea] outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[#8a919e] mb-1">CVC / CVC2</label>
                  <input
                    type="text"
                    placeholder="123"
                    className="w-full bg-[#101419] border border-[#404752] rounded p-2 text-[#e0e2ea] outline-none font-mono"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                setShowAddCardModal(false);
                onShowToast?.('success', 'New Payment Method Added', 'Credit card saved as backup payment method.');
              }}
              className="w-full py-2 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded font-bold text-xs cursor-pointer"
            >
              Save Card
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
