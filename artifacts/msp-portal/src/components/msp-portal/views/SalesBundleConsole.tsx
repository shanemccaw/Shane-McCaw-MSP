import React, { useState, useMemo } from 'react';
import {
  Package,
  DollarSign,
  TrendingUp,
  ShieldCheck,
  Layers,
  Zap,
  CheckCircle2,
  XCircle,
  Plus,
  Edit3,
  Copy,
  Trash2,
  Search,
  Filter,
  SlidersHorizontal,
  RefreshCw,
  FileText,
  Sparkles,
  Percent,
  ChevronRight,
  ArrowRight,
  ExternalLink,
  Download,
  Check,
  Users,
  AlertTriangle,
  Sliders,
  ChevronDown,
  X,
  Building2,
  Tag,
  Info,
  ArrowUpRight,
  PieChart,
  Database,
  Send,
  FileSpreadsheet,
  Shield,
  HelpCircle,
  Clock,
  Briefcase
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tenant } from '../../types';

// ============================================================================
// TYPES & DATA STRUCTURES
// ============================================================================

export interface BundleComponent {
  id: string;
  name: string;
  provider: 'Microsoft NCE' | 'MSP Platform' | 'Third-Party Vendor';
  unitCost: number; // Wholesale unit cost ($/seat/mo)
  retailPrice: number; // Retail list price ($/seat/mo)
  category: 'License' | 'Security' | 'MDM/Intune' | 'SOC/Monitoring' | 'Backup/PIM';
  includedQty?: number;
}

export interface SalesBundle {
  id: string;
  code: string;
  name: string;
  description: string;
  tier: 'silver' | 'gold' | 'platinum' | 'custom';
  wholesaleCostPerSeat: number;
  retailPricePerSeat: number;
  grossMarginPercent: number;
  targetSeatRange: string;
  includedComponents: BundleComponent[];
  activeTenantCount: number;
  status: 'active' | 'draft' | 'archived';
  updatedAt: string;
  featuresList: string[];
  targetAudience: 'Small Business (1-30)' | 'Mid-Market (30-150)' | 'Enterprise (150+)';
}

export interface TenantBundleAdoption {
  tenantId: string;
  tenantName: string;
  primaryDomain: string;
  assignedBundleId: string;
  assignedBundleName: string;
  seatCount: number;
  contractedMrr: number;
  renewalDate: string;
  alignmentStatus: 'Standardized' | 'Custom Agreement' | 'Out of Alignment';
  mfaEnabledPercent: number;
  lastAuditDate: string;
}

interface SalesBundleConsoleProps {
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

const INITIAL_COMPONENTS_LIBRARY: BundleComponent[] = [
  { id: 'cmp-1', name: 'M365 Business Basic Wholesale SKU', provider: 'Microsoft NCE', unitCost: 5.00, retailPrice: 6.00, category: 'License' },
  { id: 'cmp-2', name: 'M365 Business Premium Wholesale SKU', provider: 'Microsoft NCE', unitCost: 18.00, retailPrice: 22.00, category: 'License' },
  { id: 'cmp-3', name: 'M365 E5 Suite & Defender P2', provider: 'Microsoft NCE', unitCost: 38.00, retailPrice: 57.00, category: 'License' },
  { id: 'cmp-4', name: 'Intune MDM & Compliance Baseline', provider: 'MSP Platform', unitCost: 2.50, retailPrice: 6.00, category: 'MDM/Intune' },
  { id: 'cmp-5', name: '24/7 Automated Drift Auto-Heal Engine', provider: 'MSP Platform', unitCost: 1.50, retailPrice: 7.00, category: 'Security' },
  { id: 'cmp-6', name: '24/7 SOC & Defender Threat Hunting', provider: 'Third-Party Vendor', unitCost: 6.00, retailPrice: 15.00, category: 'SOC/Monitoring' },
  { id: 'cmp-7', name: 'Entra ID P2 + PIM Access Control', provider: 'Microsoft NCE', unitCost: 4.00, retailPrice: 8.00, category: 'Backup/PIM' },
  { id: 'cmp-8', name: 'Cloud-to-Cloud M365 Backup & Retention', provider: 'Third-Party Vendor', unitCost: 2.00, retailPrice: 5.00, category: 'Backup/PIM' },
  { id: 'cmp-9', name: '5m Graph API Drift Monitoring Node', provider: 'MSP Platform', unitCost: 1.00, retailPrice: 3.00, category: 'SOC/Monitoring' },
];

const INITIAL_BUNDLES: SalesBundle[] = [
  {
    id: 'bndl-silver',
    code: 'BNDL-SLVR-01',
    name: 'Silver - Essentials M365',
    description: 'Core cloud messaging, exchange online security, identity baseline & 5m Graph API drift monitoring.',
    tier: 'silver',
    wholesaleCostPerSeat: 9.50,
    retailPricePerSeat: 22.00,
    grossMarginPercent: 56.8,
    targetSeatRange: '1 - 30 seats',
    targetAudience: 'Small Business (1-30)',
    activeTenantCount: 6,
    status: 'active',
    updatedAt: '2026-07-20',
    featuresList: [
      'Exchange Online Security & Spam Guard',
      '5m Graph API Policy Drift Monitoring',
      'Basic M365 Identity Security Defaults',
      'Email Encryption & Phishing Guard',
      'Standard 8x5 Helpdesk SLA Support'
    ],
    includedComponents: [
      { id: 'cmp-1', name: 'M365 Business Basic Wholesale SKU', provider: 'Microsoft NCE', unitCost: 5.00, retailPrice: 6.00, category: 'License' },
      { id: 'cmp-4', name: 'Intune MDM & Compliance Baseline', provider: 'MSP Platform', unitCost: 2.50, retailPrice: 6.00, category: 'MDM/Intune' },
      { id: 'cmp-9', name: '5m Graph API Drift Monitoring Node', provider: 'MSP Platform', unitCost: 2.00, retailPrice: 10.00, category: 'SOC/Monitoring' }
    ]
  },
  {
    id: 'bndl-gold',
    code: 'BNDL-GOLD-01',
    name: 'Gold - Secured Workplace',
    description: 'Comprehensive endpoint MDM, Business Premium, Conditional Access enforcement & 24/7 auto-heal.',
    tier: 'gold',
    wholesaleCostPerSeat: 14.50,
    retailPricePerSeat: 38.00,
    grossMarginPercent: 61.8,
    targetSeatRange: '30 - 150 seats',
    targetAudience: 'Mid-Market (30-150)',
    activeTenantCount: 12,
    status: 'active',
    updatedAt: '2026-07-22',
    featuresList: [
      'M365 Business Premium License Included',
      'Intune MDM Baseline & Autopilot Enrollment',
      'Conditional Access Baseline Enforcer',
      '24/7 Graph API Auto-Heal Engine',
      'Defender for Business Managed Endpoint Security'
    ],
    includedComponents: [
      { id: 'cmp-2', name: 'M365 Business Premium Wholesale SKU', provider: 'Microsoft NCE', unitCost: 18.00, retailPrice: 22.00, category: 'License' },
      { id: 'cmp-4', name: 'Intune MDM & Compliance Baseline', provider: 'MSP Platform', unitCost: 2.50, retailPrice: 6.00, category: 'MDM/Intune' },
      { id: 'cmp-5', name: '24/7 Automated Drift Auto-Heal Engine', provider: 'MSP Platform', unitCost: 1.50, retailPrice: 7.00, category: 'Security' },
      { id: 'cmp-9', name: '5m Graph API Drift Monitoring Node', provider: 'MSP Platform', unitCost: 1.00, retailPrice: 3.00, category: 'SOC/Monitoring' }
    ]
  },
  {
    id: 'bndl-platinum',
    code: 'BNDL-PLAT-01',
    name: 'Platinum - Enterprise SOC & Governance',
    description: 'Full M365 E5 suite, 24/7 threat hunting, Entra PIM governance, 15-min SLA & unlimited Graph API nodes.',
    tier: 'platinum',
    wholesaleCostPerSeat: 21.00,
    retailPricePerSeat: 68.00,
    grossMarginPercent: 69.1,
    targetSeatRange: '150+ seats',
    targetAudience: 'Enterprise (150+)',
    activeTenantCount: 5,
    status: 'active',
    updatedAt: '2026-07-24',
    featuresList: [
      'M365 E5 Suite & Defender for Endpoint P2',
      'Entra ID P2 + Privileged Identity Management (PIM)',
      '24/7 Dedicated SOC Threat Hunting & MDR',
      '15-Minute Critical Severity Response Guarantee',
      'Unlimited Graph API Monitoring Nodes'
    ],
    includedComponents: [
      { id: 'cmp-3', name: 'M365 E5 Suite & Defender P2', provider: 'Microsoft NCE', unitCost: 38.00, retailPrice: 57.00, category: 'License' },
      { id: 'cmp-6', name: '24/7 SOC & Defender Threat Hunting', provider: 'Third-Party Vendor', unitCost: 6.00, retailPrice: 15.00, category: 'SOC/Monitoring' },
      { id: 'cmp-7', name: 'Entra ID P2 + PIM Access Control', provider: 'Microsoft NCE', unitCost: 4.00, retailPrice: 8.00, category: 'Backup/PIM' },
      { id: 'cmp-8', name: 'Cloud-to-Cloud M365 Backup & Retention', provider: 'Third-Party Vendor', unitCost: 2.00, retailPrice: 5.00, category: 'Backup/PIM' }
    ]
  },
  {
    id: 'bndl-comanaged',
    code: 'BNDL-COMG-01',
    name: 'Co-Managed MSP Add-On',
    description: 'Dual-admin co-management overlay, shared SOP runbooks, auto-heal pipeline & weekly alignment scorecard.',
    tier: 'custom',
    wholesaleCostPerSeat: 4.20,
    retailPricePerSeat: 18.50,
    grossMarginPercent: 77.3,
    targetSeatRange: '50 - 300 seats',
    targetAudience: 'Mid-Market (30-150)',
    activeTenantCount: 3,
    status: 'active',
    updatedAt: '2026-07-18',
    featuresList: [
      'Dual-Admin Co-Managed Control Overlay',
      'Automated Drift Telemetry Alerts to Internal IT',
      'Shared SOP Runbook Library & Execution Engine',
      'Weekly Multi-Tenant Security Alignment Scorecard'
    ],
    includedComponents: [
      { id: 'cmp-5', name: '24/7 Automated Drift Auto-Heal Engine', provider: 'MSP Platform', unitCost: 1.50, retailPrice: 7.00, category: 'Security' },
      { id: 'cmp-9', name: '5m Graph API Drift Monitoring Node', provider: 'MSP Platform', unitCost: 1.20, retailPrice: 5.00, category: 'SOC/Monitoring' }
    ]
  },
  {
    id: 'bndl-bronze-draft',
    code: 'BNDL-BRNZ-02',
    name: 'Bronze - Cloud Identity Starter (Draft)',
    description: 'Entry-level identity posture package for micro-businesses looking to migrate off on-prem AD.',
    tier: 'silver',
    wholesaleCostPerSeat: 6.80,
    retailPricePerSeat: 14.00,
    grossMarginPercent: 51.4,
    targetSeatRange: '1 - 15 seats',
    targetAudience: 'Small Business (1-30)',
    activeTenantCount: 0,
    status: 'draft',
    updatedAt: '2026-07-23',
    featuresList: [
      'Cloud Identity Provisioning & Entra Sync',
      'MFA Enforcement Baseline',
      'Monthly Security Score Summary'
    ],
    includedComponents: [
      { id: 'cmp-1', name: 'M365 Business Basic Wholesale SKU', provider: 'Microsoft NCE', unitCost: 5.00, retailPrice: 6.00, category: 'License' },
      { id: 'cmp-9', name: '5m Graph API Drift Monitoring Node', provider: 'MSP Platform', unitCost: 1.80, retailPrice: 8.00, category: 'SOC/Monitoring' }
    ]
  }
];

const INITIAL_TENANT_ADOPTIONS: TenantBundleAdoption[] = [
  { tenantId: 't-1', tenantName: 'Contoso Pharmaceuticals', primaryDomain: 'contosobio.com', assignedBundleId: 'bndl-gold', assignedBundleName: 'Gold - Secured Workplace', seatCount: 120, contractedMrr: 4560, renewalDate: '2027-01-15', alignmentStatus: 'Standardized', mfaEnabledPercent: 98, lastAuditDate: '2026-07-22' },
  { tenantId: 't-2', tenantName: 'Fabrikam Technologies', primaryDomain: 'fabrikamcloud.io', assignedBundleId: 'bndl-gold', assignedBundleName: 'Gold - Secured Workplace', seatCount: 85, contractedMrr: 3230, renewalDate: '2026-11-30', alignmentStatus: 'Standardized', mfaEnabledPercent: 100, lastAuditDate: '2026-07-20' },
  { tenantId: 't-3', tenantName: 'Woodgrove National Bank', primaryDomain: 'woodgrovefin.com', assignedBundleId: 'bndl-platinum', assignedBundleName: 'Platinum - Enterprise SOC & Governance', seatCount: 240, contractedMrr: 16320, renewalDate: '2027-04-01', alignmentStatus: 'Standardized', mfaEnabledPercent: 100, lastAuditDate: '2026-07-24' },
  { tenantId: 't-4', tenantName: 'Northwind Logistics', primaryDomain: 'northwindtrade.com', assignedBundleId: 'bndl-silver', assignedBundleName: 'Silver - Essentials M365', seatCount: 28, contractedMrr: 616, renewalDate: '2026-09-15', alignmentStatus: 'Standardized', mfaEnabledPercent: 92, lastAuditDate: '2026-07-19' },
  { tenantId: 't-5', tenantName: 'Alpine Ski House & Resorts', primaryDomain: 'alpineski.com', assignedBundleId: 'bndl-silver', assignedBundleName: 'Silver - Essentials M365', seatCount: 45, contractedMrr: 990, renewalDate: '2026-10-20', alignmentStatus: 'Custom Agreement', mfaEnabledPercent: 88, lastAuditDate: '2026-07-15' },
  { tenantId: 't-6', tenantName: 'Tailwind Traders Corp', primaryDomain: 'tailwindretail.com', assignedBundleId: 'bndl-gold', assignedBundleName: 'Gold - Secured Workplace', seatCount: 110, contractedMrr: 4180, renewalDate: '2027-03-10', alignmentStatus: 'Standardized', mfaEnabledPercent: 96, lastAuditDate: '2026-07-21' },
  { tenantId: 't-7', tenantName: 'AdventureWorks Media', primaryDomain: 'adventuremedia.org', assignedBundleId: 'bndl-comanaged', assignedBundleName: 'Co-Managed MSP Add-On', seatCount: 160, contractedMrr: 2960, renewalDate: '2026-12-01', alignmentStatus: 'Standardized', mfaEnabledPercent: 94, lastAuditDate: '2026-07-18' },
  { tenantId: 't-8', tenantName: 'Apex Health Systems', primaryDomain: 'apexhealth.net', assignedBundleId: 'bndl-platinum', assignedBundleName: 'Platinum - Enterprise SOC & Governance', seatCount: 310, contractedMrr: 21080, renewalDate: '2027-06-30', alignmentStatus: 'Standardized', mfaEnabledPercent: 99, lastAuditDate: '2026-07-23' },
  { tenantId: 't-9', tenantName: 'CyberDyne Industrial', primaryDomain: 'cyberdyne.ai', assignedBundleId: 'bndl-silver', assignedBundleName: 'Silver - Essentials M365', seatCount: 55, contractedMrr: 1210, renewalDate: '2026-08-30', alignmentStatus: 'Out of Alignment', mfaEnabledPercent: 74, lastAuditDate: '2026-07-10' },
  { tenantId: 't-10', tenantName: 'Stark Global Enterprises', primaryDomain: 'starkglobal.io', assignedBundleId: 'bndl-platinum', assignedBundleName: 'Platinum - Enterprise SOC & Governance', seatCount: 420, contractedMrr: 28560, renewalDate: '2027-08-15', alignmentStatus: 'Standardized', mfaEnabledPercent: 100, lastAuditDate: '2026-07-24' }
];

const WHOLESALER_COMPARISON = [
  { distributor: 'Pax8 (NCE Tier 1 Direct)', baseSku: 'M365 Business Premium', wholesalePrice: '$18.00', marginRebate: '14.5% + 3% QBR', automationSync: 'Instant API Push' },
  { distributor: 'Ingram Micro Cloud', baseSku: 'M365 Business Premium', wholesalePrice: '$18.40', marginRebate: '12.0%', automationSync: 'Scheduled Sync' },
  { distributor: 'TD SYNNEX CloudSolv', baseSku: 'M365 Business Premium', wholesalePrice: '$18.25', marginRebate: '13.0%', automationSync: 'Webhook Alert' },
  { distributor: 'Microsoft NCE Direct', baseSku: 'M365 Business Premium', wholesalePrice: '$18.00', marginRebate: '15.0% Direct', automationSync: 'Native Graph API' }
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const SalesBundleConsole: React.FC<SalesBundleConsoleProps> = ({
  tenants = [],
  onShowToast
}) => {
  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<'catalog' | 'margin_engine' | 'tenant_matrix'>('catalog');

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [targetAudienceFilter, setTargetAudienceFilter] = useState<string>('ALL');
  const [marginHealthFilter, setMarginHealthFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Bundles & Tenant Adoptions State
  const [bundles, setBundles] = useState<SalesBundle[]>(INITIAL_BUNDLES);
  const [tenantAdoptions, setTenantAdoptions] = useState<TenantBundleAdoption[]>(INITIAL_TENANT_ADOPTIONS);
  const [selectedBundleId, setSelectedBundleId] = useState<string>('bndl-gold');

  // Modal / Drawer States
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [builderStep, setBuilderStep] = useState<1 | 2 | 3 | 4>(1);
  const [editingBundle, setEditingBundle] = useState<Partial<SalesBundle> | null>(null);

  // PSA Sync Modal State
  const [isPsaSyncOpen, setIsPsaSyncOpen] = useState(false);
  const [psaTarget, setPsaTarget] = useState<'HaloPSA' | 'ConnectWise' | 'Autotask'>('HaloPSA');
  const [isSyncingPsa, setIsSyncingPsa] = useState(false);

  // Proposal Modal State
  const [isProposalOpen, setIsProposalOpen] = useState(false);
  const [proposalBundle, setProposalBundle] = useState<SalesBundle | null>(null);
  const [proposalClientName, setProposalClientName] = useState('Acme Corporation');
  const [proposalSeats, setProposalSeats] = useState(50);

  // Tenant Swap Modal State
  const [isSwapModalOpen, setIsSwapModalOpen] = useState(false);
  const [swapTargetTenant, setSwapTargetTenant] = useState<TenantBundleAdoption | null>(null);
  const [swapNewBundleId, setSwapNewBundleId] = useState<string>('bndl-gold');

  // Margin Engine Financial Simulator State
  const [simSelectedBundleId, setSimSelectedBundleId] = useState<string>('bndl-gold');
  const [simSeats, setSimSeats] = useState<number>(65);
  const [simDiscountPercent, setSimDiscountPercent] = useState<number>(5);
  const [simAddons, setSimAddons] = useState<{ id: string; name: string; cost: number; price: number; enabled: boolean }[]>([
    { id: 'add-1', name: '24/7 Dedicated Threat Hunting SOC', cost: 6.00, price: 12.00, enabled: true },
    { id: 'add-2', name: 'Entra ID P2 + PIM Governance', cost: 4.00, price: 8.00, enabled: false },
    { id: 'add-3', name: 'Cloud Backup & 10yr Archiving', cost: 2.00, price: 5.00, enabled: true },
    { id: 'add-4', name: 'VIP Executive Cyber Protection', cost: 5.00, price: 15.00, enabled: false }
  ]);

  // Toast Helper
  const toast = (type: 'success' | 'info' | 'warning' | 'error', title: string, desc: string) => {
    if (onShowToast) {
      onShowToast(type, title, desc);
    }
  };

  // Selected Bundle computation
  const selectedBundle = useMemo(() => {
    return bundles.find(b => b.id === selectedBundleId) || bundles[0];
  }, [bundles, selectedBundleId]);

  // Catalog KPIs
  const catalogKpis = useMemo(() => {
    const activeBundles = bundles.filter(b => b.status === 'active');
    const totalActiveCount = activeBundles.length;
    
    // Average Retail Price / Seat
    const avgPricePerSeat = activeBundles.length > 0 
      ? activeBundles.reduce((acc, b) => acc + b.retailPricePerSeat, 0) / activeBundles.length 
      : 0;

    // Average Gross Margin %
    const avgGrossMargin = activeBundles.length > 0 
      ? activeBundles.reduce((acc, b) => acc + b.grossMarginPercent, 0) / activeBundles.length 
      : 0;

    // Tenant Standardization Count
    const standardizedCount = tenantAdoptions.filter(t => t.alignmentStatus === 'Standardized').length;
    const totalTenants = tenantAdoptions.length;

    return {
      activeCount: totalActiveCount,
      avgPricePerSeat,
      avgGrossMargin,
      standardizedCount,
      totalTenants
    };
  }, [bundles, tenantAdoptions]);

  // Filtered Bundles
  const filteredBundles = useMemo(() => {
    return bundles.filter(b => {
      // Search
      const matchesSearch = 
        b.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.includedComponents.some(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));

      // Target Audience
      const matchesAudience = targetAudienceFilter === 'ALL' || b.targetAudience === targetAudienceFilter;

      // Margin Health
      let matchesMargin = true;
      if (marginHealthFilter === 'HIGH') matchesMargin = b.grossMarginPercent >= 65;
      else if (marginHealthFilter === 'TARGET') matchesMargin = b.grossMarginPercent >= 50 && b.grossMarginPercent < 65;
      else if (marginHealthFilter === 'LOW') matchesMargin = b.grossMarginPercent < 50;

      // Status
      const matchesStatus = statusFilter === 'ALL' || b.status === statusFilter;

      return matchesSearch && matchesAudience && matchesMargin && matchesStatus;
    });
  }, [bundles, searchTerm, targetAudienceFilter, marginHealthFilter, statusFilter]);

  // Filtered Tenants for Tab 3
  const filteredTenants = useMemo(() => {
    return tenantAdoptions.filter(t => {
      const matchesSearch = 
        t.tenantName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.primaryDomain.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.assignedBundleName.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    });
  }, [tenantAdoptions, searchTerm]);

  // Simulator Computed Values
  const simBundle = useMemo(() => {
    return bundles.find(b => b.id === simSelectedBundleId) || bundles[0];
  }, [bundles, simSelectedBundleId]);

  const simFinances = useMemo(() => {
    if (!simBundle) return { revenue: 0, cogs: 0, profit: 0, marginPercent: 0, acv: 0 };

    const activeAddons = simAddons.filter(a => a.enabled);
    const addonsCost = activeAddons.reduce((acc, a) => acc + a.cost, 0);
    const addonsPrice = activeAddons.reduce((acc, a) => acc + a.price, 0);

    const baseCostSeat = simBundle.wholesaleCostPerSeat + addonsCost;
    const baseRetailSeat = simBundle.retailPricePerSeat + addonsPrice;

    const discountedRetailSeat = baseRetailSeat * (1 - simDiscountPercent / 100);

    const totalMonthlyRevenue = discountedRetailSeat * simSeats;
    const totalMonthlyCogs = baseCostSeat * simSeats;
    const netMonthlyProfit = totalMonthlyRevenue - totalMonthlyCogs;
    const effectiveMarginPercent = totalMonthlyRevenue > 0 ? (netMonthlyProfit / totalMonthlyRevenue) * 100 : 0;
    const acv = totalMonthlyRevenue * 12;

    return {
      discountedRetailSeat,
      totalMonthlyRevenue,
      totalMonthlyCogs,
      netMonthlyProfit,
      effectiveMarginPercent,
      acv
    };
  }, [simBundle, simSeats, simDiscountPercent, simAddons]);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleOpenBuilder = (bundleToEdit?: SalesBundle) => {
    if (bundleToEdit) {
      setEditingBundle({ ...bundleToEdit });
    } else {
      setEditingBundle({
        id: `bndl-${Date.now()}`,
        code: `BNDL-NEW-${Math.floor(100 + Math.random() * 900)}`,
        name: 'Gold - Extended Security Workplace',
        description: 'Targeted M365 bundle with identity governance and automated drift enforcement.',
        tier: 'gold',
        wholesaleCostPerSeat: 16.00,
        retailPricePerSeat: 42.00,
        grossMarginPercent: 61.9,
        targetSeatRange: '20 - 100 seats',
        targetAudience: 'Mid-Market (30-150)',
        activeTenantCount: 0,
        status: 'draft',
        updatedAt: new Date().toISOString().split('T')[0],
        featuresList: [
          'Business Premium M365 Base License',
          'Intune Compliance & Autopilot Baseline',
          'Automated Policy Drift Auto-Heal'
        ],
        includedComponents: [INITIAL_COMPONENTS_LIBRARY[1], INITIAL_COMPONENTS_LIBRARY[3], INITIAL_COMPONENTS_LIBRARY[4]]
      });
    }
    setBuilderStep(1);
    setIsBuilderOpen(true);
  };

  const handleSaveBundle = () => {
    if (!editingBundle || !editingBundle.name) {
      toast('error', 'Validation Error', 'Bundle Name is required.');
      return;
    }

    // Compute Margin
    const wholesale = editingBundle.wholesaleCostPerSeat || 15.00;
    const retail = editingBundle.retailPricePerSeat || 38.00;
    const margin = retail > 0 ? ((retail - wholesale) / retail) * 100 : 0;

    const finalBundle: SalesBundle = {
      id: editingBundle.id || `bndl-${Date.now()}`,
      code: editingBundle.code || 'BNDL-CST-01',
      name: editingBundle.name,
      description: editingBundle.description || 'Custom MSP Sales Bundle Package.',
      tier: editingBundle.tier || 'gold',
      wholesaleCostPerSeat: wholesale,
      retailPricePerSeat: retail,
      grossMarginPercent: parseFloat(margin.toFixed(1)),
      targetSeatRange: editingBundle.targetSeatRange || '10 - 100 seats',
      targetAudience: editingBundle.targetAudience || 'Mid-Market (30-150)',
      activeTenantCount: editingBundle.activeTenantCount || 0,
      status: (editingBundle.status as 'active' | 'draft' | 'archived') || 'active',
      updatedAt: new Date().toISOString().split('T')[0],
      featuresList: editingBundle.featuresList || ['Managed M365 Baseline', 'Graph API Monitoring'],
      includedComponents: editingBundle.includedComponents || [INITIAL_COMPONENTS_LIBRARY[0]]
    };

    setBundles(prev => {
      const exists = prev.some(b => b.id === finalBundle.id);
      if (exists) {
        return prev.map(b => b.id === finalBundle.id ? finalBundle : b);
      }
      return [finalBundle, ...prev];
    });

    setIsBuilderOpen(false);
    toast('success', 'Sales Bundle Saved', `Bundle "${finalBundle.name}" published to catalog with ${finalBundle.grossMarginPercent}% Gross Margin.`);
  };

  const handleDuplicateBundle = (bundle: SalesBundle) => {
    const cloned: SalesBundle = {
      ...bundle,
      id: `bndl-copy-${Date.now()}`,
      code: `${bundle.code}-COPY`,
      name: `${bundle.name} (Copy)`,
      status: 'draft',
      activeTenantCount: 0,
      updatedAt: new Date().toISOString().split('T')[0]
    };

    setBundles(prev => [cloned, ...prev]);
    toast('info', 'Bundle Duplicated', `Created draft copy "${cloned.name}".`);
  };

  const handleTriggerPsaSync = () => {
    setIsSyncingPsa(true);
    setTimeout(() => {
      setIsSyncingPsa(false);
      setIsPsaSyncOpen(false);
      toast('success', `PSA Catalog Synced (${psaTarget})`, `Successfully pushed ${bundles.length} Sales Bundles and pricing tiers to ${psaTarget} Agreement Catalog.`);
    }, 1500);
  };

  const handleExportMatrixCsv = () => {
    toast('info', 'Exporting Sales Matrix', 'Generating CSV export for packaging pricing matrix and tenant adoption records...');
    setTimeout(() => {
      toast('success', 'Export Complete', 'sales_bundle_matrix_export_2026.csv downloaded.');
    }, 800);
  };

  const handleOpenProposalModal = (bundle: SalesBundle) => {
    setProposalBundle(bundle);
    setIsProposalOpen(true);
  };

  const handleSendProposal = () => {
    if (!proposalBundle) return;
    setIsProposalOpen(false);
    toast('success', 'Sales Proposal Generated', `Proposal for ${proposalSeats} seats of "${proposalBundle.name}" pushed to Offer Pipeline for ${proposalClientName}.`);
  };

  const handleConfirmTenantSwap = () => {
    if (!swapTargetTenant) return;
    const newBundle = bundles.find(b => b.id === swapNewBundleId);
    if (!newBundle) return;

    const newMrr = newBundle.retailPricePerSeat * swapTargetTenant.seatCount;

    setTenantAdoptions(prev => prev.map(t => {
      if (t.tenantId === swapTargetTenant.tenantId) {
        return {
          ...t,
          assignedBundleId: newBundle.id,
          assignedBundleName: newBundle.name,
          contractedMrr: newMrr,
          alignmentStatus: 'Standardized',
          lastAuditDate: new Date().toISOString().split('T')[0]
        };
      }
      return t;
    }));

    setIsSwapModalOpen(false);
    toast('success', 'Tenant Bundle Re-Assigned', `${swapTargetTenant.tenantName} updated to "${newBundle.name}". Contracted MRR adjusted to $${newMrr.toLocaleString()}/mo.`);
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#090d16] text-[#e0e2ea] overflow-hidden font-sans">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & PACKAGING PERFORMANCE KPI BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#101419] border-b border-[#404752] p-4 shrink-0 space-y-4">
        
        {/* Title & Primary Action Controls */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-[#0078d4]/20 to-[#a3c9ff]/10 border border-[#0078d4]/40 rounded-lg">
              <Package className="w-6 h-6 text-[#a3c9ff]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-[#f0f4f8] tracking-tight">M365 Managed Service Sales Bundles</h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40">
                  /portal/sales-bundles
                </span>
              </div>
              <p className="text-xs text-[#8a919e]">
                Standardized product tiering, wholesale cost tracking, real-time gross margin calculation &amp; PSA catalog sync.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleOpenBuilder()}
              className="flex items-center gap-1.5 bg-[#0078d4] hover:bg-[#006cbd] text-white text-xs font-bold px-3 py-2 rounded transition-all shadow-md active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Sales Bundle</span>
            </button>

            <button
              onClick={() => setIsPsaSyncOpen(true)}
              className="flex items-center gap-1.5 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#e0e2ea] text-xs font-semibold px-3 py-2 rounded transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#a3c9ff]" />
              <span>Sync Catalog to PSA</span>
            </button>

            <button
              onClick={handleExportMatrixCsv}
              className="flex items-center gap-1.5 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#e0e2ea] text-xs font-semibold px-3 py-2 rounded transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export Matrix CSV</span>
            </button>
          </div>
        </div>

        {/* 4 KPI Metric Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          {/* KPI 1 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Active Sales Bundles</span>
              <div className="text-xl font-bold font-mono text-[#f0f4f8] flex items-baseline gap-2">
                <span>{catalogKpis.activeCount} Bundles</span>
                <span className="text-xs font-normal text-[#8a919e] font-sans">({bundles.length} Total)</span>
              </div>
            </div>
            <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-md">
              <Layers className="w-5 h-5 text-blue-400" />
            </div>
          </div>

          {/* KPI 2 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Avg Catalog MRR / Seat</span>
              <div className="text-xl font-bold font-mono text-emerald-400 flex items-baseline gap-1">
                <span>${catalogKpis.avgPricePerSeat.toFixed(2)}</span>
                <span className="text-xs font-normal text-[#8a919e] font-sans">/ seat / mo</span>
              </div>
            </div>
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-md">
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
          </div>

          {/* KPI 3 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Avg Gross Margin %</span>
              <div className="text-xl font-bold font-mono text-emerald-400 flex items-baseline gap-2">
                <span>{catalogKpis.avgGrossMargin.toFixed(1)}%</span>
                <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                  HEALTHY
                </span>
              </div>
            </div>
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-md">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
            </div>
          </div>

          {/* KPI 4 */}
          <div className="bg-[#181c22]/90 border border-[#404752] p-3 rounded-lg flex items-center justify-between shadow-inner">
            <div className="space-y-0.5">
              <span className="text-[11px] font-mono text-[#8a919e] uppercase font-semibold">Tenant Adoption Rate</span>
              <div className="text-xl font-bold font-mono text-[#a3c9ff] flex items-baseline gap-2">
                <span>{catalogKpis.standardizedCount} / {catalogKpis.totalTenants}</span>
                <span className="text-xs text-emerald-400 font-sans font-medium">
                  ({Math.round((catalogKpis.standardizedCount / catalogKpis.totalTenants) * 100)}% Standardized)
                </span>
              </div>
            </div>
            <div className="p-2 bg-purple-500/10 border border-purple-500/20 rounded-md">
              <ShieldCheck className="w-5 h-5 text-purple-400" />
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
            onClick={() => setActiveTab('catalog')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeTab === 'catalog'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Sales Bundle Catalog ({filteredBundles.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('margin_engine')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeTab === 'margin_engine'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
            <span>Margin &amp; Cost Analysis Engine</span>
          </button>

          <button
            onClick={() => setActiveTab('tenant_matrix')}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded transition-colors font-medium whitespace-nowrap",
              activeTab === 'tenant_matrix'
                ? "bg-[#0078d4] text-white font-bold shadow-sm"
                : "text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
            )}
          >
            <Users className="w-3.5 h-3.5 text-purple-400" />
            <span>Tenant Bundle Adoption Matrix ({tenantAdoptions.length})</span>
          </button>
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-2 flex-wrap flex-1 justify-end">
          
          {/* Search Box */}
          <div className="relative min-w-[200px] max-w-[280px] flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a919e]" />
            <input
              type="text"
              placeholder="Search Bundle, SKU, Code..."
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

          {/* Target Audience Dropdown */}
          <select
            value={targetAudienceFilter}
            onChange={(e) => setTargetAudienceFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Audience: All Tiers</option>
            <option value="Small Business (1-30)">Small Business (1-30)</option>
            <option value="Mid-Market (30-150)">Mid-Market (30-150)</option>
            <option value="Enterprise (150+)">Enterprise (150+)</option>
          </select>

          {/* Margin Health Filter */}
          <select
            value={marginHealthFilter}
            onChange={(e) => setMarginHealthFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Margin: All</option>
            <option value="HIGH">High Margin (&gt;65% 🟢)</option>
            <option value="TARGET">Target Margin (50-65% 🟡)</option>
            <option value="LOW">Low Margin (&lt;50% 🔴)</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#181c22] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
          >
            <option value="ALL">Status: All</option>
            <option value="active">Active / Published</option>
            <option value="draft">Draft / In Review</option>
            <option value="archived">Archived</option>
          </select>

          {(searchTerm || targetAudienceFilter !== 'ALL' || marginHealthFilter !== 'ALL' || statusFilter !== 'ALL') && (
            <button
              onClick={() => {
                setSearchTerm('');
                setTargetAudienceFilter('ALL');
                setMarginHealthFilter('ALL');
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
      {/* 3. MAIN TAB CONTENT AREA */}
      {/* ========================================================================= */}
      <div className="flex-1 overflow-y-auto bg-[#090d16] p-4">
        
        {/* ======================================================================= */}
        {/* TAB 1: SALES BUNDLE CATALOG (CARD GRID & INSPECTOR) */}
        {/* ======================================================================= */}
        {activeTab === 'catalog' && (
          <div className="space-y-6 max-w-7xl mx-auto">
            
            {/* TOP SECTION: TIERED BUNDLE CARD GRID */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold font-mono text-[#f0f4f8] uppercase tracking-wider flex items-center gap-2">
                    <Package className="w-4 h-4 text-[#a3c9ff]" />
                    <span>Tiered Package Catalog ({filteredBundles.length})</span>
                  </h2>
                  <span className="text-xs text-[#8a919e]">Click card to inspect component-level wholesale breakdown below</span>
                </div>
              </div>

              {filteredBundles.length === 0 ? (
                <div className="bg-[#101419] border border-[#404752] rounded-lg p-12 text-center space-y-3">
                  <Package className="w-10 h-10 text-[#8a919e] mx-auto opacity-50" />
                  <p className="text-sm font-semibold text-[#e0e2ea]">No Sales Bundles match your filter criteria.</p>
                  <p className="text-xs text-[#8a919e]">Try clearing search or filters to display catalog items.</p>
                  <button
                    onClick={() => {
                      setSearchTerm('');
                      setTargetAudienceFilter('ALL');
                      setMarginHealthFilter('ALL');
                      setStatusFilter('ALL');
                    }}
                    className="bg-[#181c22] border border-[#404752] text-xs text-[#a3c9ff] px-3 py-1.5 rounded hover:bg-[#202630]"
                  >
                    Clear Filters
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredBundles.map((bundle) => {
                    const isSelected = bundle.id === selectedBundleId;

                    // Margin Color Logic
                    let marginColor = 'text-emerald-400';
                    let marginBg = 'bg-emerald-500/20 border-emerald-500/40';
                    let marginBar = 'bg-emerald-500';
                    if (bundle.grossMarginPercent < 50) {
                      marginColor = 'text-red-400';
                      marginBg = 'bg-red-500/20 border-red-500/40';
                      marginBar = 'bg-red-500';
                    } else if (bundle.grossMarginPercent < 65) {
                      marginColor = 'text-amber-400';
                      marginBg = 'bg-amber-500/20 border-amber-500/40';
                      marginBar = 'bg-amber-500';
                    }

                    // Tier styling
                    let tierBadge = 'bg-[#404752]/40 text-[#e0e2ea] border-[#404752]';
                    if (bundle.tier === 'silver') tierBadge = 'bg-slate-700/50 text-slate-200 border-slate-500';
                    if (bundle.tier === 'gold') tierBadge = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
                    if (bundle.tier === 'platinum') tierBadge = 'bg-purple-500/20 text-purple-300 border-purple-500/40';
                    if (bundle.tier === 'custom') tierBadge = 'bg-blue-500/20 text-blue-300 border-blue-500/40';

                    return (
                      <div
                        key={bundle.id}
                        onClick={() => setSelectedBundleId(bundle.id)}
                        className={cn(
                          "bg-[#101419] border rounded-xl p-4 transition-all cursor-pointer flex flex-col justify-between space-y-4 relative overflow-hidden group shadow-lg hover:shadow-xl",
                          isSelected
                            ? "border-[#0078d4] ring-1 ring-[#0078d4] bg-[#121822]"
                            : "border-[#404752] hover:border-[#606a7a]"
                        )}
                      >
                        {/* Top Ribbon / Header */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={cn("px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border", tierBadge)}>
                                {bundle.tier}
                              </span>
                              <span className="text-[11px] font-mono font-semibold text-[#8a919e]">{bundle.code}</span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {bundle.status === 'active' && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                  ACTIVE
                                </span>
                              )}
                              {bundle.status === 'draft' && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                                  DRAFT
                                </span>
                              )}
                              {bundle.status === 'archived' && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-gray-500/10 text-gray-400 border border-gray-500/30">
                                  ARCHIVED
                                </span>
                              )}
                            </div>
                          </div>

                          <h3 className="text-base font-bold text-[#f0f4f8] group-hover:text-[#a3c9ff] transition-colors">
                            {bundle.name}
                          </h3>
                          <p className="text-xs text-[#8a919e] line-clamp-2 mt-1">
                            {bundle.description}
                          </p>
                        </div>

                        {/* Retail Price & Gross Margin Display */}
                        <div className="bg-[#181c22] border border-[#404752] p-3 rounded-lg space-y-2">
                          <div className="flex items-baseline justify-between">
                            <div>
                              <span className="text-[10px] font-mono text-[#8a919e] uppercase block">Retail List Price</span>
                              <div className="text-lg font-bold font-mono text-[#f0f4f8]">
                                ${bundle.retailPricePerSeat.toFixed(2)}
                                <span className="text-xs font-normal text-[#8a919e] font-sans"> / seat / mo</span>
                              </div>
                            </div>

                            <div className="text-right">
                              <span className="text-[10px] font-mono text-[#8a919e] uppercase block">Wholesale COGS</span>
                              <div className="text-sm font-semibold font-mono text-[#8a919e]">
                                ${bundle.wholesaleCostPerSeat.toFixed(2)}
                              </div>
                            </div>
                          </div>

                          {/* Margin Progress Bar */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[11px] font-mono">
                              <span className="text-[#8a919e]">Gross Margin %</span>
                              <span className={cn("font-bold", marginColor)}>{bundle.grossMarginPercent.toFixed(1)}%</span>
                            </div>
                            <div className="w-full bg-[#090d16] h-1.5 rounded-full overflow-hidden border border-[#404752]">
                              <div
                                className={cn("h-full transition-all duration-500", marginBar)}
                                style={{ width: `${Math.min(100, bundle.grossMarginPercent)}%` }}
                              ></div>
                            </div>
                          </div>
                        </div>

                        {/* Included Features Checklist */}
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-mono font-bold text-[#8a919e] uppercase tracking-wider block">
                            Included Governance &amp; Services ({bundle.featuresList.length})
                          </span>
                          <ul className="space-y-1 text-xs text-[#e0e2ea]">
                            {bundle.featuresList.slice(0, 3).map((feat, idx) => (
                              <li key={idx} className="flex items-start gap-1.5 truncate">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                <span className="truncate">{feat}</span>
                              </li>
                            ))}
                            {bundle.featuresList.length > 3 && (
                              <li className="text-[11px] text-[#a3c9ff] pl-5 font-mono">
                                + {bundle.featuresList.length - 3} additional service lines...
                              </li>
                            )}
                          </ul>
                        </div>

                        {/* Footer & Actions */}
                        <div className="pt-2 border-t border-[#404752] flex items-center justify-between gap-2 text-xs">
                          <span className="text-[11px] font-mono text-[#8a919e] flex items-center gap-1">
                            <Users className="w-3 h-3 text-[#a3c9ff]" />
                            <span>{bundle.activeTenantCount} Active Clients</span>
                          </span>

                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenProposalModal(bundle);
                              }}
                              className="px-2 py-1 rounded bg-[#0078d4]/20 hover:bg-[#0078d4]/30 text-[#a3c9ff] border border-[#0078d4]/40 text-[11px] font-semibold flex items-center gap-1"
                              title="Push to Sales Proposal"
                            >
                              <Send className="w-3 h-3" />
                              <span>Proposal</span>
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicateBundle(bundle);
                              }}
                              className="p-1.5 rounded bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#8a919e] hover:text-[#e0e2ea]"
                              title="Duplicate Bundle"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBuilder(bundle);
                              }}
                              className="p-1.5 rounded bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#8a919e] hover:text-[#e0e2ea]"
                              title="Edit Bundle Settings"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* BOTTOM SECTION: DETAILED COMPONENT & SKU BREAKDOWN TABLE */}
            <div className="bg-[#101419] border border-[#404752] rounded-xl overflow-hidden shadow-xl">
              <div className="p-4 bg-[#181c22] border-b border-[#404752] flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold font-mono text-[#f0f4f8] uppercase tracking-wider flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-[#a3c9ff]" />
                      <span>SKU &amp; Component Cost Breakdown: {selectedBundle.name}</span>
                    </h3>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40">
                      {selectedBundle.code}
                    </span>
                  </div>
                  <p className="text-xs text-[#8a919e] mt-0.5">
                    Component-level wholesale cost vs retail pricing line items inside this sales package.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpenBuilder(selectedBundle)}
                    className="flex items-center gap-1.5 bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#a3c9ff] text-xs font-semibold px-3 py-1.5 rounded"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add/Modify Line Items</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#141820] border-b border-[#404752] text-[#8a919e] font-mono text-[11px] uppercase">
                      <th className="p-3 font-semibold">Component / Service Name</th>
                      <th className="p-3 font-semibold">Category</th>
                      <th className="p-3 font-semibold">Provider / Source</th>
                      <th className="p-3 font-semibold text-right">Wholesale Cost ($/seat)</th>
                      <th className="p-3 font-semibold text-right">Retail List Price ($/seat)</th>
                      <th className="p-3 font-semibold text-right">Line Profit ($/seat)</th>
                      <th className="p-3 font-semibold text-right">Line Margin %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/60 font-mono text-xs">
                    {selectedBundle.includedComponents.map((comp) => {
                      const lineProfit = comp.retailPrice - comp.unitCost;
                      const lineMargin = comp.retailPrice > 0 ? (lineProfit / comp.retailPrice) * 100 : 0;

                      return (
                        <tr key={comp.id} className="hover:bg-[#181c22] transition-colors">
                          <td className="p-3 font-medium text-[#f0f4f8] font-sans">
                            {comp.name}
                          </td>
                          <td className="p-3 text-[#8a919e]">
                            <span className="px-2 py-0.5 rounded bg-[#181c22] border border-[#404752] text-[10px]">
                              {comp.category}
                            </span>
                          </td>
                          <td className="p-3 text-[#a3c9ff]">
                            {comp.provider}
                          </td>
                          <td className="p-3 text-right text-[#e0e2ea]">
                            ${comp.unitCost.toFixed(2)}
                          </td>
                          <td className="p-3 text-right text-emerald-400 font-bold">
                            ${comp.retailPrice.toFixed(2)}
                          </td>
                          <td className="p-3 text-right text-emerald-400 font-semibold">
                            +${lineProfit.toFixed(2)}
                          </td>
                          <td className="p-3 text-right font-bold text-[#f0f4f8]">
                            {lineMargin.toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#181c22] border-t-2 border-[#404752] font-mono font-bold text-xs">
                      <td colSpan={3} className="p-3 text-[#f0f4f8] font-sans uppercase">
                        Total Package Roll-up
                      </td>
                      <td className="p-3 text-right text-[#e0e2ea]">
                        ${selectedBundle.wholesaleCostPerSeat.toFixed(2)}
                      </td>
                      <td className="p-3 text-right text-emerald-400 text-sm font-extrabold">
                        ${selectedBundle.retailPricePerSeat.toFixed(2)}
                      </td>
                      <td className="p-3 text-right text-emerald-400">
                        +${(selectedBundle.retailPricePerSeat - selectedBundle.wholesaleCostPerSeat).toFixed(2)}
                      </td>
                      <td className="p-3 text-right text-emerald-400 font-extrabold text-sm">
                        {selectedBundle.grossMarginPercent.toFixed(1)}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 2: MARGIN & COST ANALYSIS ENGINE */}
        {/* ======================================================================= */}
        {activeTab === 'margin_engine' && (
          <div className="space-y-6 max-w-7xl mx-auto">
            
            {/* TOP BAR: INTERACTIVE FINANCIAL SIMULATOR */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* LEFT COLUMN (1/3): Simulator Inputs & Sliders */}
              <div className="bg-[#101419] border border-[#404752] rounded-xl p-5 space-y-5 shadow-xl">
                <div className="flex items-center gap-2 border-b border-[#404752] pb-3">
                  <SlidersHorizontal className="w-5 h-5 text-emerald-400" />
                  <div>
                    <h3 className="text-sm font-bold text-[#f0f4f8]">Financial Deal Simulator</h3>
                    <p className="text-xs text-[#8a919e]">Test volume seat pricing, discounts &amp; add-on margins.</p>
                  </div>
                </div>

                {/* Base Bundle Selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#a3c9ff] block">Select Base Bundle</label>
                  <select
                    value={simSelectedBundleId}
                    onChange={(e) => setSimSelectedBundleId(e.target.value)}
                    className="w-full bg-[#181c22] border border-[#404752] rounded p-2 text-xs text-[#e0e2ea] font-medium focus:outline-none focus:border-[#0078d4]"
                  >
                    {bundles.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name} (${b.retailPricePerSeat.toFixed(2)}/seat)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Seat Count Slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#e0e2ea]">Target Seats Enrolled</span>
                    <span className="font-mono font-bold text-emerald-400 text-sm bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      {simSeats} Seats
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={500}
                    step={5}
                    value={simSeats}
                    onChange={(e) => setSimSeats(parseInt(e.target.value))}
                    className="w-full accent-[#0078d4] bg-[#181c22] h-2 rounded cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-[#8a919e]">
                    <span>5 Seats</span>
                    <span>250 Seats</span>
                    <span>500 Seats</span>
                  </div>
                </div>

                {/* Discount Percentage Slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#e0e2ea]">Negotiated Deal Discount %</span>
                    <span className="font-mono font-bold text-amber-400 text-sm bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                      {simDiscountPercent}% Off
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={25}
                    step={1}
                    value={simDiscountPercent}
                    onChange={(e) => setSimDiscountPercent(parseInt(e.target.value))}
                    className="w-full accent-amber-500 bg-[#181c22] h-2 rounded cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-[#8a919e]">
                    <span>0% (Full List)</span>
                    <span>12%</span>
                    <span>25% (Max Approved)</span>
                  </div>
                </div>

                {/* Optional Managed Service Add-ons */}
                <div className="space-y-2 pt-2 border-t border-[#404752]">
                  <span className="text-xs font-semibold text-[#a3c9ff] block">Optional Managed Add-Ons</span>
                  <div className="space-y-2">
                    {simAddons.map((addon) => (
                      <label key={addon.id} className="flex items-center justify-between p-2 rounded bg-[#181c22] border border-[#404752] hover:border-[#0078d4] cursor-pointer text-xs">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={addon.enabled}
                            onChange={() => {
                              setSimAddons(prev => prev.map(a => a.id === addon.id ? { ...a, enabled: !a.enabled } : a));
                            }}
                            className="rounded accent-[#0078d4]"
                          />
                          <span className="text-[#e0e2ea] font-medium">{addon.name}</span>
                        </div>
                        <span className="font-mono text-[11px] text-emerald-400">
                          +${addon.price.toFixed(2)}/seat
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

              </div>

              {/* RIGHT COLUMN (2/3): Live Financial Outcome Cards & Charts */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* 4 Financial Output KPI Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  
                  {/* Revenue */}
                  <div className="bg-[#101419] border border-[#404752] p-4 rounded-xl space-y-1 shadow-lg">
                    <span className="text-xs font-mono text-[#8a919e] uppercase font-semibold block">Total Monthly Revenue (MRR)</span>
                    <div className="text-2xl font-bold font-mono text-[#f0f4f8]">
                      ${simFinances.totalMonthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <p className="text-[11px] text-[#8a919e]">
                      Effective Retail: ${simFinances.discountedRetailSeat.toFixed(2)} / seat / mo
                    </p>
                  </div>

                  {/* COGS */}
                  <div className="bg-[#101419] border border-[#404752] p-4 rounded-xl space-y-1 shadow-lg">
                    <span className="text-xs font-mono text-[#8a919e] uppercase font-semibold block">Total Wholesale COGS</span>
                    <div className="text-2xl font-bold font-mono text-[#8a919e]">
                      ${simFinances.totalMonthlyCogs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <p className="text-[11px] text-[#8a919e]">
                      Wholesale Cost per seat: ${(simBundle.wholesaleCostPerSeat + simAddons.filter(a => a.enabled).reduce((acc, a) => acc + a.cost, 0)).toFixed(2)}
                    </p>
                  </div>

                  {/* Monthly Net Profit */}
                  <div className="bg-[#101419] border border-emerald-500/40 p-4 rounded-xl space-y-1 shadow-lg bg-emerald-500/5">
                    <span className="text-xs font-mono text-emerald-400 uppercase font-semibold block">Net Monthly Gross Profit</span>
                    <div className="text-2xl font-bold font-mono text-emerald-400">
                      +${simFinances.netMonthlyProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <p className="text-[11px] text-emerald-300 font-medium">
                      ACV (Annualized Revenue): ${simFinances.acv.toLocaleString(undefined, { minimumFractionDigits: 0 })}/yr
                    </p>
                  </div>

                  {/* Effective Margin % Gauge */}
                  <div className={cn(
                    "border p-4 rounded-xl space-y-1 shadow-lg transition-colors",
                    simFinances.effectiveMarginPercent >= 60 ? "bg-emerald-500/10 border-emerald-500/40" : "bg-amber-500/10 border-amber-500/40"
                  )}>
                    <span className="text-xs font-mono text-[#8a919e] uppercase font-semibold block">Effective Gross Margin %</span>
                    <div className={cn("text-2xl font-bold font-mono", simFinances.effectiveMarginPercent >= 60 ? "text-emerald-400" : "text-amber-400")}>
                      {simFinances.effectiveMarginPercent.toFixed(1)}%
                    </div>
                    <p className="text-[11px] text-[#8a919e]">
                      {simFinances.effectiveMarginPercent >= 60 ? "🟢 Above target 60% gross margin threshold." : "🟡 Below target 60% margin threshold due to discount."}
                    </p>
                  </div>

                </div>

                {/* Wholesaler Distributor Comparison Table */}
                <div className="bg-[#101419] border border-[#404752] rounded-xl overflow-hidden shadow-xl">
                  <div className="p-4 bg-[#181c22] border-b border-[#404752] flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold font-mono text-[#f0f4f8] uppercase tracking-wider flex items-center gap-2">
                        <Database className="w-4 h-4 text-[#a3c9ff]" />
                        <span>Wholesaler &amp; Distributor Margin Comparison</span>
                      </h3>
                      <p className="text-xs text-[#8a919e]">Compare distributor wholesale rates, rebate percentages &amp; Graph API integration options.</p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#141820] border-b border-[#404752] text-[#8a919e] font-mono text-[11px] uppercase">
                          <th className="p-3 font-semibold">Distributor Partner</th>
                          <th className="p-3 font-semibold">Base SKU Rate</th>
                          <th className="p-3 font-semibold text-right">Wholesale Unit Price</th>
                          <th className="p-3 font-semibold text-right">Rebate &amp; MDF Kickback</th>
                          <th className="p-3 font-semibold">Provisioning Sync</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#404752]/60 font-mono text-xs">
                        {WHOLESALER_COMPARISON.map((row, idx) => (
                          <tr key={idx} className="hover:bg-[#181c22] transition-colors">
                            <td className="p-3 font-medium text-[#f0f4f8] font-sans flex items-center gap-2">
                              <Shield className="w-3.5 h-3.5 text-[#0078d4]" />
                              <span>{row.distributor}</span>
                            </td>
                            <td className="p-3 text-[#8a919e] font-sans">{row.baseSku}</td>
                            <td className="p-3 text-right text-[#e0e2ea] font-bold">{row.wholesalePrice}</td>
                            <td className="p-3 text-right text-emerald-400 font-bold">{row.marginRebate}</td>
                            <td className="p-3 text-[#a3c9ff]">
                              <span className="px-2 py-0.5 rounded bg-[#181c22] border border-[#404752] text-[10px]">
                                {row.automationSync}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>

            </div>

          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 3: TENANT BUNDLE ADOPTION MATRIX */}
        {/* ======================================================================= */}
        {activeTab === 'tenant_matrix' && (
          <div className="space-y-4 max-w-7xl mx-auto">
            
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-bold font-mono text-[#f0f4f8] uppercase tracking-wider flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-400" />
                  <span>Tenant Sales Bundle Standardization Matrix ({filteredTenants.length})</span>
                </h2>
                <p className="text-xs text-[#8a919e]">Track which client tenants are on standardized sales packages vs custom agreements.</p>
              </div>
            </div>

            <div className="bg-[#101419] border border-[#404752] rounded-xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#181c22] border-b border-[#404752] text-[#8a919e] font-mono text-[11px] uppercase">
                      <th className="p-3 font-semibold">Client Tenant Name</th>
                      <th className="p-3 font-semibold">Assigned Sales Bundle</th>
                      <th className="p-3 font-semibold text-right">Active Seats</th>
                      <th className="p-3 font-semibold text-right">Contracted MRR ($)</th>
                      <th className="p-3 font-semibold">MFA &amp; Security Score</th>
                      <th className="p-3 font-semibold">Alignment Status</th>
                      <th className="p-3 font-semibold">Renewal Date</th>
                      <th className="p-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404752]/60 font-mono text-xs">
                    {filteredTenants.map((t) => {
                      let statusBadge = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
                      if (t.alignmentStatus === 'Custom Agreement') statusBadge = 'bg-amber-500/10 text-amber-400 border-amber-500/30';
                      if (t.alignmentStatus === 'Out of Alignment') statusBadge = 'bg-red-500/10 text-red-400 border-red-500/30';

                      return (
                        <tr key={t.tenantId} className="hover:bg-[#181c22] transition-colors">
                          <td className="p-3 font-medium text-[#f0f4f8] font-sans">
                            <div className="font-bold">{t.tenantName}</div>
                            <div className="text-[11px] font-mono text-[#8a919e]">{t.primaryDomain}</div>
                          </td>
                          <td className="p-3 font-sans">
                            <span className="font-semibold text-[#a3c9ff]">{t.assignedBundleName}</span>
                          </td>
                          <td className="p-3 text-right text-[#e0e2ea] font-bold">
                            {t.seatCount}
                          </td>
                          <td className="p-3 text-right text-emerald-400 font-bold">
                            ${t.contractedMrr.toLocaleString()}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-[#e0e2ea]">{t.mfaEnabledPercent}% MFA</span>
                              <div className="w-16 bg-[#090d16] h-1.5 rounded-full overflow-hidden border border-[#404752]">
                                <div className="bg-emerald-400 h-full" style={{ width: `${t.mfaEnabledPercent}%` }}></div>
                              </div>
                            </div>
                          </td>
                          <td className="p-3">
                            <span className={cn("px-2 py-0.5 rounded text-[10px] font-mono font-bold border", statusBadge)}>
                              {t.alignmentStatus}
                            </span>
                          </td>
                          <td className="p-3 text-[#8a919e]">
                            {t.renewalDate}
                          </td>
                          <td className="p-3 text-right font-sans">
                            <button
                              onClick={() => {
                                setSwapTargetTenant(t);
                                setSwapNewBundleId(t.assignedBundleId);
                                setIsSwapModalOpen(true);
                              }}
                              className="px-2.5 py-1 rounded bg-[#181c22] hover:bg-[#202630] border border-[#404752] text-[#a3c9ff] hover:text-white text-xs font-medium transition-colors"
                            >
                              Upgrade / Swap
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* 4. MODALS & DRAWERS */}
      {/* ========================================================================= */}

      {/* A. BUNDLE BUILDER DRAWER / MODAL */}
      {isBuilderOpen && editingBundle && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
          <div className="w-full max-w-2xl bg-[#101419] border-l border-[#404752] h-full flex flex-col justify-between shadow-2xl">
            
            {/* Drawer Header */}
            <div className="p-4 bg-[#181c22] border-b border-[#404752] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-[#a3c9ff]" />
                <h2 className="text-base font-bold text-[#f0f4f8]">
                  {editingBundle.id?.startsWith('bndl-copy') ? 'Duplicate Sales Bundle' : editingBundle.name ? `Edit: ${editingBundle.name}` : 'Create New Sales Bundle'}
                </h2>
              </div>
              <button
                onClick={() => setIsBuilderOpen(false)}
                className="p-1 rounded text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#202630]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Stepper Tabs */}
            <div className="bg-[#141820] border-b border-[#404752] px-4 py-2 flex items-center justify-between text-xs font-mono">
              {[
                { step: 1, label: '1. Identity' },
                { step: 2, label: '2. Component SKUs' },
                { step: 3, label: '3. Pricing & Margins' },
                { step: 4, label: '4. Proposal Specs' }
              ].map(st => (
                <button
                  key={st.step}
                  onClick={() => setBuilderStep(st.step as 1|2|3|4)}
                  className={cn(
                    "px-3 py-1 rounded transition-colors font-semibold",
                    builderStep === st.step
                      ? "bg-[#0078d4] text-white"
                      : "text-[#8a919e] hover:text-[#e0e2ea]"
                  )}
                >
                  {st.label}
                </button>
              ))}
            </div>

            {/* Step Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5 text-xs">
              
              {/* STEP 1: IDENTITY */}
              {builderStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="font-semibold text-[#a3c9ff] block mb-1">Bundle Name</label>
                    <input
                      type="text"
                      value={editingBundle.name || ''}
                      onChange={(e) => setEditingBundle({ ...editingBundle, name: e.target.value })}
                      placeholder="e.g., Gold - Secured Workplace"
                      className="w-full bg-[#181c22] border border-[#404752] p-2 rounded text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="font-semibold text-[#a3c9ff] block mb-1">Package Code</label>
                      <input
                        type="text"
                        value={editingBundle.code || ''}
                        onChange={(e) => setEditingBundle({ ...editingBundle, code: e.target.value })}
                        className="w-full bg-[#181c22] border border-[#404752] p-2 rounded text-[#e0e2ea] font-mono"
                      />
                    </div>
                    <div>
                      <label className="font-semibold text-[#a3c9ff] block mb-1">Tier Category</label>
                      <select
                        value={editingBundle.tier || 'gold'}
                        onChange={(e) => setEditingBundle({ ...editingBundle, tier: e.target.value as 'silver' | 'gold' | 'platinum' | 'custom' })}
                        className="w-full bg-[#181c22] border border-[#404752] p-2 rounded text-[#e0e2ea]"
                      >
                        <option value="silver">Silver Tier</option>
                        <option value="gold">Gold Tier</option>
                        <option value="platinum">Platinum Tier</option>
                        <option value="custom">Custom / Add-On</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="font-semibold text-[#a3c9ff] block mb-1">Description</label>
                    <textarea
                      rows={3}
                      value={editingBundle.description || ''}
                      onChange={(e) => setEditingBundle({ ...editingBundle, description: e.target.value })}
                      className="w-full bg-[#181c22] border border-[#404752] p-2 rounded text-[#e0e2ea]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="font-semibold text-[#a3c9ff] block mb-1">Target Seat Range</label>
                      <input
                        type="text"
                        value={editingBundle.targetSeatRange || ''}
                        onChange={(e) => setEditingBundle({ ...editingBundle, targetSeatRange: e.target.value })}
                        placeholder="e.g. 30 - 150 seats"
                        className="w-full bg-[#181c22] border border-[#404752] p-2 rounded text-[#e0e2ea]"
                      />
                    </div>
                    <div>
                      <label className="font-semibold text-[#a3c9ff] block mb-1">Status</label>
                      <select
                        value={editingBundle.status || 'draft'}
                        onChange={(e) => setEditingBundle({ ...editingBundle, status: e.target.value as 'active' | 'draft' | 'archived' })}
                        className="w-full bg-[#181c22] border border-[#404752] p-2 rounded text-[#e0e2ea]"
                      >
                        <option value="active">Active / Published</option>
                        <option value="draft">Draft / Under Review</option>
                        <option value="archived">Archived</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: COMPONENT SKUs */}
              {builderStep === 2 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#a3c9ff]">Select Component SKUs</span>
                    <span className="text-[11px] text-[#8a919e] font-mono">
                      Selected: {editingBundle.includedComponents?.length || 0} Components
                    </span>
                  </div>

                  <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                    {INITIAL_COMPONENTS_LIBRARY.map((libComp) => {
                      const isIncluded = editingBundle.includedComponents?.some(c => c.id === libComp.id);

                      return (
                        <div
                          key={libComp.id}
                          onClick={() => {
                            const current = editingBundle.includedComponents || [];
                            let updated: BundleComponent[];
                            if (isIncluded) {
                              updated = current.filter(c => c.id !== libComp.id);
                            } else {
                              updated = [...current, libComp];
                            }
                            
                            // Re-calculate bundle wholesale
                            const newWholesale = updated.reduce((acc, c) => acc + c.unitCost, 0);

                            setEditingBundle({
                              ...editingBundle,
                              includedComponents: updated,
                              wholesaleCostPerSeat: newWholesale
                            });
                          }}
                          className={cn(
                            "p-3 rounded-lg border cursor-pointer flex items-center justify-between transition-colors",
                            isIncluded
                              ? "bg-[#0078d4]/10 border-[#0078d4]"
                              : "bg-[#181c22] border-[#404752] hover:border-[#606a7a]"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={isIncluded}
                              readOnly
                              className="accent-[#0078d4]"
                            />
                            <div>
                              <div className="font-medium text-[#f0f4f8]">{libComp.name}</div>
                              <div className="text-[11px] text-[#8a919e] font-mono">
                                Provider: {libComp.provider} | Category: {libComp.category}
                              </div>
                            </div>
                          </div>

                          <div className="text-right font-mono">
                            <div className="text-xs text-[#e0e2ea]">${libComp.unitCost.toFixed(2)} cost</div>
                            <div className="text-[11px] text-emerald-400">${libComp.retailPrice.toFixed(2)} list</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* STEP 3: PRICING & MARGIN CALCULATOR */}
              {builderStep === 3 && (
                <div className="space-y-5">
                  <div className="bg-[#181c22] border border-[#404752] p-4 rounded-lg space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="font-semibold text-[#a3c9ff] block mb-1">Wholesale Cost ($/seat/mo)</label>
                        <input
                          type="number"
                          step="0.50"
                          value={editingBundle.wholesaleCostPerSeat || 0}
                          onChange={(e) => setEditingBundle({ ...editingBundle, wholesaleCostPerSeat: parseFloat(e.target.value) || 0 })}
                          className="w-full bg-[#101419] border border-[#404752] p-2 rounded text-[#e0e2ea] font-mono"
                        />
                      </div>

                      <div>
                        <label className="font-semibold text-[#a3c9ff] block mb-1">Retail List Price ($/seat/mo)</label>
                        <input
                          type="number"
                          step="1.00"
                          value={editingBundle.retailPricePerSeat || 0}
                          onChange={(e) => setEditingBundle({ ...editingBundle, retailPricePerSeat: parseFloat(e.target.value) || 0 })}
                          className="w-full bg-[#101419] border border-[#404752] p-2 rounded text-emerald-400 font-bold font-mono text-base"
                        />
                      </div>
                    </div>

                    {/* Dynamic Margin Calculation */}
                    {(() => {
                      const wholesale = editingBundle.wholesaleCostPerSeat || 0;
                      const retail = editingBundle.retailPricePerSeat || 0;
                      const margin = retail > 0 ? ((retail - wholesale) / retail) * 100 : 0;

                      return (
                        <div className="p-3 bg-[#101419] rounded border border-[#404752] space-y-2">
                          <div className="flex items-center justify-between font-mono">
                            <span className="text-[#8a919e]">Computed Gross Margin %</span>
                            <span className={cn("text-lg font-bold", margin >= 50 ? "text-emerald-400" : "text-red-400")}>
                              {margin.toFixed(1)}%
                            </span>
                          </div>
                          {margin < 50 && (
                            <div className="text-[11px] text-red-400 flex items-center gap-1 font-sans">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>Warning: Gross margin is below the MSP target threshold of 50%.</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* STEP 4: PROPOSAL SPECS */}
              {builderStep === 4 && (
                <div className="space-y-4">
                  <span className="font-semibold text-[#a3c9ff] block">Feature Checklist for Sales Proposals</span>
                  <p className="text-xs text-[#8a919e]">These bullet points appear on customer sales proposals &amp; SLAs.</p>
                  
                  <textarea
                    rows={6}
                    value={editingBundle.featuresList?.join('\n') || ''}
                    onChange={(e) => setEditingBundle({
                      ...editingBundle,
                      featuresList: e.target.value.split('\n').filter(line => line.trim() !== '')
                    })}
                    placeholder="Enter each feature on a new line..."
                    className="w-full bg-[#181c22] border border-[#404752] p-3 rounded text-[#e0e2ea] font-sans"
                  />
                </div>
              )}

            </div>

            {/* Drawer Footer Actions */}
            <div className="p-4 bg-[#181c22] border-t border-[#404752] flex items-center justify-between">
              <button
                onClick={() => {
                  if (builderStep > 1) setBuilderStep((builderStep - 1) as 1|2|3|4);
                }}
                disabled={builderStep === 1}
                className="px-3 py-1.5 rounded bg-[#101419] border border-[#404752] text-[#8a919e] disabled:opacity-40 text-xs font-semibold"
              >
                Previous Step
              </button>

              <div className="flex items-center gap-2">
                {builderStep < 4 ? (
                  <button
                    onClick={() => setBuilderStep((builderStep + 1) as 1|2|3|4)}
                    className="px-4 py-1.5 rounded bg-[#0078d4] text-white text-xs font-bold"
                  >
                    Next Step
                  </button>
                ) : (
                  <button
                    onClick={handleSaveBundle}
                    className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                  >
                    Publish Sales Bundle
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* B. PSA SYNC MODAL */}
      {isPsaSyncOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#101419] border border-[#404752] rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-[#a3c9ff]" />
                <h3 className="text-sm font-bold text-[#f0f4f8]">Sync Catalog to PSA</h3>
              </div>
              <button onClick={() => setIsPsaSyncOpen(false)} className="text-[#8a919e] hover:text-[#e0e2ea]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <label className="font-semibold text-[#a3c9ff] block">Target PSA Agreement Engine</label>
              <select
                value={psaTarget}
                onChange={(e) => setPsaTarget(e.target.value as any)}
                className="w-full bg-[#181c22] border border-[#404752] p-2 rounded text-[#e0e2ea]"
              >
                <option value="HaloPSA">HaloPSA Agreement Catalog</option>
                <option value="ConnectWise">ConnectWise Manage Products</option>
                <option value="Autotask">Datto Autotask Services</option>
              </select>

              <p className="text-[#8a919e]">
                Will push {bundles.length} active sales bundle definitions, wholesale costs, and retail price tiers to {psaTarget} REST API.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#404752]">
              <button
                onClick={() => setIsPsaSyncOpen(false)}
                className="px-3 py-1.5 rounded bg-[#181c22] border border-[#404752] text-xs text-[#8a919e]"
              >
                Cancel
              </button>
              <button
                onClick={handleTriggerPsaSync}
                disabled={isSyncingPsa}
                className="px-4 py-1.5 rounded bg-[#0078d4] text-white font-bold text-xs flex items-center gap-1.5"
              >
                {isSyncingPsa ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                <span>{isSyncingPsa ? 'Syncing...' : 'Push to PSA Catalog'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* C. PROPOSAL PUSH MODAL */}
      {isProposalOpen && proposalBundle && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#101419] border border-[#404752] rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <div className="flex items-center gap-2">
                <Send className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-[#f0f4f8]">Push to Offer Pipeline</h3>
              </div>
              <button onClick={() => setIsProposalOpen(false)} className="text-[#8a919e] hover:text-[#e0e2ea]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-[#a3c9ff] block mb-1">Target Client Prospect</label>
                <input
                  type="text"
                  value={proposalClientName}
                  onChange={(e) => setProposalClientName(e.target.value)}
                  className="w-full bg-[#181c22] border border-[#404752] p-2 rounded text-[#e0e2ea]"
                />
              </div>

              <div>
                <label className="font-semibold text-[#a3c9ff] block mb-1">Proposed Seat Count</label>
                <input
                  type="number"
                  value={proposalSeats}
                  onChange={(e) => setProposalSeats(parseInt(e.target.value) || 1)}
                  className="w-full bg-[#181c22] border border-[#404752] p-2 rounded text-[#e0e2ea] font-mono"
                />
              </div>

              <div className="bg-[#181c22] p-3 rounded border border-[#404752] space-y-1 font-mono">
                <div className="flex justify-between text-[#8a919e]">
                  <span>Package Selected:</span>
                  <span className="text-[#a3c9ff]">{proposalBundle.name}</span>
                </div>
                <div className="flex justify-between text-[#8a919e]">
                  <span>Monthly Contract MRR:</span>
                  <span className="text-emerald-400 font-bold">${(proposalBundle.retailPricePerSeat * proposalSeats).toLocaleString()}/mo</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#404752]">
              <button
                onClick={() => setIsProposalOpen(false)}
                className="px-3 py-1.5 rounded bg-[#181c22] border border-[#404752] text-xs text-[#8a919e]"
              >
                Cancel
              </button>
              <button
                onClick={handleSendProposal}
                className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
              >
                Generate Proposal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* D. TENANT BUNDLE SWAP MODAL */}
      {isSwapModalOpen && swapTargetTenant && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#101419] border border-[#404752] rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-400" />
                <h3 className="text-sm font-bold text-[#f0f4f8]">Re-Assign Tenant Sales Bundle</h3>
              </div>
              <button onClick={() => setIsSwapModalOpen(false)} className="text-[#8a919e] hover:text-[#e0e2ea]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-[#181c22] p-3 rounded border border-[#404752]">
                <div className="font-bold text-[#f0f4f8]">{swapTargetTenant.tenantName}</div>
                <div className="text-[11px] text-[#8a919e]">Currently on: {swapTargetTenant.assignedBundleName} ({swapTargetTenant.seatCount} seats)</div>
              </div>

              <div>
                <label className="font-semibold text-[#a3c9ff] block mb-1">New Target Sales Bundle</label>
                <select
                  value={swapNewBundleId}
                  onChange={(e) => setSwapNewBundleId(e.target.value)}
                  className="w-full bg-[#181c22] border border-[#404752] p-2 rounded text-[#e0e2ea]"
                >
                  {bundles.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name} (${b.retailPricePerSeat.toFixed(2)}/seat)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#404752]">
              <button
                onClick={() => setIsSwapModalOpen(false)}
                className="px-3 py-1.5 rounded bg-[#181c22] border border-[#404752] text-xs text-[#8a919e]"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmTenantSwap}
                className="px-4 py-1.5 rounded bg-[#0078d4] text-white font-bold text-xs"
              >
                Confirm Bundle Swap
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default SalesBundleConsole;
