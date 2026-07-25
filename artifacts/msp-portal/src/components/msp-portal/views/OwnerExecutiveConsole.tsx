// @ts-nocheck
import React, { useState, useMemo } from 'react';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  PieChart,
  BarChart3,
  CreditCard,
  Cpu,
  Receipt,
  ShoppingBag,
  Building2,
  ShieldAlert,
  Clock,
  Users,
  Zap,
  Search,
  Filter,
  SlidersHorizontal,
  RefreshCw,
  Download,
  Sparkles,
  ChevronRight,
  X,
  CheckCircle2,
  AlertOctagon,
  ArrowUpRight,
  FileText,
  Check,
  Plus,
  Database,
  Activity,
  Layers,
  ShieldCheck,
  Lock,
  Calendar,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  Info,
  Server,
  ArrowRight,
  UserCheck,
  Percent,
  Send,
  BookOpen,
  Package,
  Eye,
  HelpCircle,
  Briefcase,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tenant } from '../types';

// ==========================================
// TYPE DEFINITIONS FOR FINOPS ENGINE
// ==========================================

export interface ExecutiveFinancials {
  totalMrr: number;
  netArr: number;
  grossMarginPercent: number;
  aiExpenseMonthly: number;
  billingCogsMonthly: number;
  addOnsRevenueMonthly: number;
  microTransactionsMtd: number;
}

export interface MicroTransaction {
  id: string;
  tenantId: string;
  tenantName: string;
  title: string;
  category: 'onboarding_fee' | 'emergency_ir' | 'migration' | 'custom_script';
  amount: number;
  date: string;
  status: 'billed' | 'pending' | 'paid';
  description?: string;
  assignedTech?: string;
}

export interface TenantProfitability {
  tenantId: string;
  tenantName: string;
  domain: string;
  tier: 'Platinum Enterprise' | 'Gold Managed' | 'Standard Pro';
  seatCount: number;
  grossMrr: number;
  cogs: number;
  aiSpend: number;
  addOnMargin: number;
  microTransYtd: number;
  netMarginPercent: number;
  healthScore: number;
  activeAlerts: number;
  pendingApprovals: number;
  onboardingStage?: string;
}

export interface CrossCustomerOffer {
  id: string;
  code: string;
  title: string;
  tenantId: string;
  tenantName: string;
  domain: string;
  offerType: 'project' | 'document' | 'micro_offer' | 'upgrade';
  category: string;
  description: string;
  customerValueProtection: string; // "How this betters the customer"
  wholesaleCost: number; // What MSP spends wholesale
  retailPrice: number; // What MSP charges retail
  revenueType: 'one_time' | 'mrr';
  status: 'available' | 'proposed' | 'accepted' | 'executing';
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  matchedSopOrTemplate?: string;
  targetSeats?: number;
}

export interface OwnerExecutiveConsoleProps {
  tenants?: Tenant[];
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
  onNavigateTab?: (tab: string) => void;
}

// ==========================================
// INITIAL MOCK DATA
// ==========================================

const INITIAL_FINANCIALS: ExecutiveFinancials = {
  totalMrr: 68450,
  netArr: 821400,
  grossMarginPercent: 62.0,
  aiExpenseMonthly: 1240,
  billingCogsMonthly: 24800,
  addOnsRevenueMonthly: 18750,
  microTransactionsMtd: 7200,
};

const INITIAL_MICRO_TRANSACTIONS: MicroTransaction[] = [
  {
    id: 'MT-2026-001',
    tenantId: 't-contoso',
    tenantName: 'Contoso Pharmaceuticals',
    title: 'Emergency Break-Glass IR Retainer',
    category: 'emergency_ir',
    amount: 2500,
    date: '2026-07-22',
    status: 'paid',
    description: '24/7 Incident Response retainer for compromised Global Admin credentials remediation.',
    assignedTech: 'Marcus Vance (SecOps Lead)',
  },
  {
    id: 'MT-2026-002',
    tenantId: 't-apex',
    tenantName: 'Apex Global Logistics',
    title: 'Ad-hoc Exchange Hybrid Migration Fee',
    category: 'migration',
    amount: 1200,
    date: '2026-07-20',
    status: 'paid',
    description: 'Migration of 45 legacy archive mailboxes to M365 Exchange Online Plan 2.',
    assignedTech: 'Sarah Jenkins (SysAdmin)',
  },
  {
    id: 'MT-2026-003',
    tenantId: 't-pacific',
    tenantName: 'Pacific Rim Freight',
    title: 'Custom 7-Stage Onboarding Setup Fee',
    category: 'onboarding_fee',
    amount: 3500,
    date: '2026-07-18',
    status: 'paid',
    description: 'Intune Autopilot profile provisioning, PIM dual-custody setup, & Graph scanner baseline.',
    assignedTech: 'David Chen (Onboarding Spec)',
  },
  {
    id: 'MT-2026-004',
    tenantId: 't-biohealth',
    tenantName: 'BioHealth Research Labs',
    title: 'PIM & Entra ID Dual-Custody Configuration',
    category: 'custom_script',
    amount: 1800,
    date: '2026-07-15',
    status: 'billed',
    description: 'Setup of Privileged Identity Management time-bound activation with dual-sign approval rules.',
    assignedTech: 'Elena Rostova (Identity Arch)',
  },
  {
    id: 'MT-2026-005',
    tenantId: 't-vanguard',
    tenantName: 'Vanguard Financial Services',
    title: 'Custom PowerShell Graph API Scripting',
    category: 'custom_script',
    amount: 950,
    date: '2026-07-12',
    status: 'paid',
    description: 'Automated DLP policy compliance exporter script tailored for SEC financial audits.',
    assignedTech: 'Alex Rivera (DevOps Engineer)',
  },
  {
    id: 'MT-2026-006',
    tenantId: 't-acme',
    tenantName: 'Acme Corporation',
    title: 'Post-Incident Security Audit & Remediation',
    category: 'emergency_ir',
    amount: 1450,
    date: '2026-07-10',
    status: 'pending',
    description: 'Forensic evaluation of OAuth app consent abuse and Purview Audit Log review.',
    assignedTech: 'Marcus Vance (SecOps Lead)',
  },
];

const INITIAL_TENANT_PROFITABILITY: TenantProfitability[] = [
  {
    tenantId: 't-contoso',
    tenantName: 'Contoso Pharmaceuticals',
    domain: 'contoso.com',
    tier: 'Platinum Enterprise',
    seatCount: 480,
    grossMrr: 16800,
    cogs: 6200,
    aiSpend: 320,
    addOnMargin: 5200,
    microTransYtd: 4300,
    netMarginPercent: 61.2,
    healthScore: 94.5,
    activeAlerts: 1,
    pendingApprovals: 2,
    onboardingStage: 'Completed',
  },
  {
    tenantId: 't-apex',
    tenantName: 'Apex Global Logistics',
    domain: 'apexlogistics.io',
    tier: 'Gold Managed',
    seatCount: 310,
    grossMrr: 11400,
    cogs: 4100,
    aiSpend: 210,
    addOnMargin: 3400,
    microTransYtd: 2400,
    netMarginPercent: 62.2,
    healthScore: 92.0,
    activeAlerts: 2,
    pendingApprovals: 1,
    onboardingStage: 'Completed',
  },
  {
    tenantId: 't-biohealth',
    tenantName: 'BioHealth Research Labs',
    domain: 'biohealthlabs.org',
    tier: 'Platinum Enterprise',
    seatCount: 290,
    grossMrr: 11800,
    cogs: 3900,
    aiSpend: 180,
    addOnMargin: 3800,
    microTransYtd: 3600,
    netMarginPercent: 65.4,
    healthScore: 96.2,
    activeAlerts: 0,
    pendingApprovals: 1,
    onboardingStage: 'Completed',
  },
  {
    tenantId: 't-vanguard',
    tenantName: 'Vanguard Financial Services',
    domain: 'vanguardfin.com',
    tier: 'Platinum Enterprise',
    seatCount: 350,
    grossMrr: 14200,
    cogs: 4800,
    aiSpend: 240,
    addOnMargin: 4100,
    microTransYtd: 2850,
    netMarginPercent: 64.5,
    healthScore: 95.8,
    activeAlerts: 1,
    pendingApprovals: 2,
    onboardingStage: 'Completed',
  },
  {
    tenantId: 't-pacific',
    tenantName: 'Pacific Rim Freight',
    domain: 'pacificrim.co',
    tier: 'Gold Managed',
    seatCount: 220,
    grossMrr: 8100,
    cogs: 3100,
    aiSpend: 160,
    addOnMargin: 1900,
    microTransYtd: 3500,
    netMarginPercent: 59.7,
    healthScore: 88.4,
    activeAlerts: 4,
    pendingApprovals: 0,
    onboardingStage: 'Stage 4: Intune Enrollment',
  },
  {
    tenantId: 't-acme',
    tenantName: 'Acme Corporation',
    domain: 'acme.org',
    tier: 'Standard Pro',
    seatCount: 180,
    grossMrr: 6150,
    cogs: 2700,
    aiSpend: 130,
    addOnMargin: 350,
    microTransYtd: 1450,
    netMarginPercent: 54.0,
    healthScore: 83.1,
    activeAlerts: 6,
    pendingApprovals: 0,
    onboardingStage: 'Completed',
  },
];

const INITIAL_CROSS_CUSTOMER_OFFERS: CrossCustomerOffer[] = [
  // PROJECTS
  {
    id: 'off-001',
    code: 'OFF-PRJ-01',
    title: 'Intune Autopilot & Endpoint Security Baseline Migration',
    tenantId: 't-contoso',
    tenantName: 'Contoso Pharmaceuticals',
    domain: 'contoso.com',
    offerType: 'project',
    category: 'Endpoint & Intune',
    description: 'Full migration of 480 endpoints to Microsoft Intune Autopilot with BitLocker automated escrow & Defender EDR.',
    customerValueProtection: 'Eliminates unmanaged laptop security risks, enforces mandatory zero-trust disk encryption, and cuts onboarding time per employee by 85%.',
    wholesaleCost: 2800,
    retailPrice: 7500,
    revenueType: 'one_time',
    status: 'available',
    riskLevel: 'critical',
    matchedSopOrTemplate: 'SOP-INT-04: Autopilot Gold Baseline',
    targetSeats: 480,
  },
  {
    id: 'off-002',
    code: 'OFF-PRJ-02',
    title: 'Entra ID PIM & Dual-Custody Privileged Role Architecture',
    tenantId: 't-vanguard',
    tenantName: 'Vanguard Financial Services',
    domain: 'vanguardfin.com',
    offerType: 'project',
    category: 'Identity & Access',
    description: 'Implementation of Privileged Identity Management time-bound activation with dual-sign approval rules for all Global Admins.',
    customerValueProtection: 'Prevents rogue admin actions, stops lateral breach progression, and meets SEC 17a-4 financial dual-custody audit compliance.',
    wholesaleCost: 1600,
    retailPrice: 5200,
    revenueType: 'one_time',
    status: 'proposed',
    riskLevel: 'critical',
    matchedSopOrTemplate: 'SOP-IAM-09: Dual-Custody PIM Deployment',
    targetSeats: 350,
  },
  {
    id: 'off-003',
    code: 'OFF-PRJ-03',
    title: 'Purview Data Loss Prevention (DLP) & PHI Safeguard Overhaul',
    tenantId: 't-biohealth',
    tenantName: 'BioHealth Research Labs',
    domain: 'biohealthlabs.org',
    offerType: 'project',
    category: 'Compliance & Data',
    description: 'Automated DLP labeling, USB device blocking, and email exfiltration rules across Teams, SharePoint, and Exchange.',
    customerValueProtection: 'Prevents multi-million dollar HIPAA PHI data leak penalties, blocks unauthorized external file sharing, and secures lab IP.',
    wholesaleCost: 2100,
    retailPrice: 6800,
    revenueType: 'one_time',
    status: 'available',
    riskLevel: 'high',
    matchedSopOrTemplate: 'SOP-DLP-02: Purview HIPAA Sentinel Rules',
    targetSeats: 290,
  },
  {
    id: 'off-004',
    code: 'OFF-PRJ-04',
    title: 'Defender for Cloud Server Infrastructure Hardening',
    tenantId: 't-apex',
    tenantName: 'Apex Global Logistics',
    domain: 'apexlogistics.io',
    offerType: 'project',
    category: 'Infrastructure & Cloud',
    description: 'Deployment of Defender for Cloud across 18 hybrid Windows & Linux server instances with automated vulnerability auto-patching.',
    customerValueProtection: 'Protects critical logistics databases against ransomware, shuts down exposed RDP ports, and secures supply-chain infrastructure.',
    wholesaleCost: 1400,
    retailPrice: 4500,
    revenueType: 'one_time',
    status: 'available',
    riskLevel: 'high',
    matchedSopOrTemplate: 'SOP-SRV-01: Server Sentinel Hardening',
    targetSeats: 310,
  },

  // DOCUMENTS & COMPLIANCE BINDERS
  {
    id: 'off-005',
    code: 'OFF-DOC-01',
    title: 'Executive CISO Board Deck & M365 Drift Benchmark Report',
    tenantId: 't-contoso',
    tenantName: 'Contoso Pharmaceuticals',
    domain: 'contoso.com',
    offerType: 'document',
    category: 'Executive & Board',
    description: 'Board-ready 30-page executive presentation mapping CIS v8 security maturity, tenant drift metrics, and 12-month security roadmap.',
    customerValueProtection: 'Equips executive leadership and board with clear risk scores, proves ROI on IT spend, and justifies cybersecurity budget allocations.',
    wholesaleCost: 350,
    retailPrice: 2800,
    revenueType: 'one_time',
    status: 'available',
    riskLevel: 'medium',
    matchedSopOrTemplate: 'TPL-DOC-01: Board Executive CISO Deck',
  },
  {
    id: 'off-006',
    code: 'OFF-DOC-02',
    title: 'Annual SOC2 / HIPAA Compliance Evidence Audit Binder',
    tenantId: 't-biohealth',
    tenantName: 'BioHealth Research Labs',
    domain: 'biohealthlabs.org',
    offerType: 'document',
    category: 'Compliance & Audit',
    description: 'Comprehensive automated audit binder collecting Graph API audit logs, MFA enforcement proofs, and encryption attestations.',
    customerValueProtection: 'Eliminates 80+ hours of manual compliance prep, satisfies external auditor demands, and guarantees audit readiness.',
    wholesaleCost: 450,
    retailPrice: 3800,
    revenueType: 'one_time',
    status: 'proposed',
    riskLevel: 'medium',
    matchedSopOrTemplate: 'TPL-DOC-03: SOC2 Evidence Collector',
  },
  {
    id: 'off-007',
    code: 'OFF-DOC-03',
    title: 'NIST 800-171 CMMC Readiness Binder & SSP Document Package',
    tenantId: 't-acme',
    tenantName: 'Acme Corporation',
    domain: 'acme.org',
    offerType: 'document',
    category: 'Government & DoD',
    description: 'System Security Plan (SSP) and Plan of Action & Milestones (POAM) tailored for federal contractor compliance.',
    customerValueProtection: 'Qualifies customer to compete for federal defense contracts by satisfying mandatory CMMC Level 2 documentation rules.',
    wholesaleCost: 500,
    retailPrice: 3200,
    revenueType: 'one_time',
    status: 'available',
    riskLevel: 'high',
    matchedSopOrTemplate: 'TPL-DOC-05: CMMC NIST 800-171 Package',
  },
  {
    id: 'off-008',
    code: 'OFF-DOC-04',
    title: 'Executive Cyber Insurance Technical Attestation Package',
    tenantId: 't-vanguard',
    tenantName: 'Vanguard Financial Services',
    domain: 'vanguardfin.com',
    offerType: 'document',
    category: 'Risk & Insurance',
    description: 'Signed technical evidence dossier proving MFA, immutable backups, EDR coverage, and security awareness training status.',
    customerValueProtection: 'Prevents cyber insurance policy denial, lowers annual policy premiums by up to 25%, and satisfies underwriter scrutiny.',
    wholesaleCost: 300,
    retailPrice: 2200,
    revenueType: 'one_time',
    status: 'accepted',
    riskLevel: 'medium',
    matchedSopOrTemplate: 'TPL-DOC-08: Cyber Insurance Proof',
  },

  // MICRO-OFFERS
  {
    id: 'off-009',
    code: 'OFF-MIC-01',
    title: 'Automated Graph API Conditional Access Exemption Remediation',
    tenantId: 't-apex',
    tenantName: 'Apex Global Logistics',
    domain: 'apexlogistics.io',
    offerType: 'micro_offer',
    category: 'Identity & Access',
    description: 'Instant Graph API execution to purge dangerous MFA exclusions and enforce universal MFA across executive logins.',
    customerValueProtection: 'Stops ongoing credential stuffing attacks on un-MFAed executive accounts with zero downtime.',
    wholesaleCost: 50,
    retailPrice: 350,
    revenueType: 'one_time',
    status: 'available',
    riskLevel: 'critical',
    matchedSopOrTemplate: 'SOP-IAM-04: Exemption Purge Auto-Heal',
  },
  {
    id: 'off-010',
    code: 'OFF-MIC-02',
    title: 'Stale Admin OAuth App Consent Access Revocation Sweep',
    tenantId: 't-acme',
    tenantName: 'Acme Corporation',
    domain: 'acme.org',
    offerType: 'micro_offer',
    category: 'App Security',
    description: 'Automated script to identify and revoke high-risk third-party OAuth app grants with unmonitored mailbox or file permissions.',
    customerValueProtection: 'Neutralizes hidden backdoor OAuth persistence vectors without affecting legitimate productivity apps.',
    wholesaleCost: 40,
    retailPrice: 280,
    revenueType: 'one_time',
    status: 'available',
    riskLevel: 'high',
    matchedSopOrTemplate: 'SOP-APP-02: OAuth Revocation Sweep',
  },
  {
    id: 'off-011',
    code: 'OFF-MIC-03',
    title: 'Inactive M365 License Harvest & Reclaim Sweep',
    tenantId: 't-contoso',
    tenantName: 'Contoso Pharmaceuticals',
    domain: 'contoso.com',
    offerType: 'micro_offer',
    category: 'Cost Optimization',
    description: 'Automated audit identifying 24 unassigned or unlogged-in $38/mo E5 licenses to immediately unassign and reclaim.',
    customerValueProtection: 'Instantly saves the customer $10,944/year in wasted license fees with zero operational disruption.',
    wholesaleCost: 60,
    retailPrice: 450,
    revenueType: 'one_time',
    status: 'proposed',
    riskLevel: 'low',
    matchedSopOrTemplate: 'SOP-LIC-01: License Harvest Sweep',
  },
  {
    id: 'off-012',
    code: 'OFF-MIC-04',
    title: 'Legacy Auth Protocol Disablement & CA Policy Patch',
    tenantId: 't-pacific',
    tenantName: 'Pacific Rim Freight',
    domain: 'pacificrim.co',
    offerType: 'micro_offer',
    category: 'Identity & Access',
    description: 'Automated policy block disabling legacy IMAP, POP3, and Basic Auth endpoints across all tenant mailboxes.',
    customerValueProtection: 'Blocks 99% of automated password spray attacks targeting legacy mail protocols.',
    wholesaleCost: 50,
    retailPrice: 350,
    revenueType: 'one_time',
    status: 'available',
    riskLevel: 'high',
    matchedSopOrTemplate: 'SOP-IAM-01: Legacy Auth Block',
  },

  // UPGRADES & RECURRING SUBSCRIPTIONS (MRR)
  {
    id: 'off-013',
    code: 'OFF-UPG-01',
    title: 'M365 Business Basic -> Business Premium Security Bundle Upgrade',
    tenantId: 't-pacific',
    tenantName: 'Pacific Rim Freight',
    domain: 'pacificrim.co',
    offerType: 'upgrade',
    category: 'Licensing & MRR',
    description: 'Step-up upgrade for 220 seats from Business Basic to Business Premium, adding Intune, Defender, and Conditional Access.',
    customerValueProtection: 'Replaces expensive standalone antivirus & MDM tools with an integrated Microsoft security stack while improving posture.',
    wholesaleCost: 850,
    retailPrice: 2400,
    revenueType: 'mrr',
    status: 'available',
    riskLevel: 'medium',
    matchedSopOrTemplate: 'BNDL-PREM-2026: Business Premium Step-up',
    targetSeats: 220,
  },
  {
    id: 'off-014',
    code: 'OFF-UPG-02',
    title: 'Defender for Business Server Add-on Expansion',
    tenantId: 't-apex',
    tenantName: 'Apex Global Logistics',
    domain: 'apexlogistics.io',
    offerType: 'upgrade',
    category: 'Licensing & MRR',
    description: 'Monthly license add-on covering 14 core server OS instances with real-time XDR threat hunting.',
    customerValueProtection: 'Extends 24/7 managed endpoint detection to critical infrastructure servers.',
    wholesaleCost: 420,
    retailPrice: 1100,
    revenueType: 'mrr',
    status: 'proposed',
    riskLevel: 'medium',
    matchedSopOrTemplate: 'BNDL-SRV-XDR: Defender Server Add-on',
    targetSeats: 14,
  },
  {
    id: 'off-015',
    code: 'OFF-UPG-03',
    title: 'Entra ID P2 Step-up for C-Suite & Admin Identity Protection',
    tenantId: 't-contoso',
    tenantName: 'Contoso Pharmaceuticals',
    domain: 'contoso.com',
    offerType: 'upgrade',
    category: 'Licensing & MRR',
    description: 'Step-up upgrade for 45 executive & IT seats to Entra ID Plan 2 for risk-based conditional access & access reviews.',
    customerValueProtection: 'Provides real-time machine learning detection for impossible travel and leaked credentials across high-value accounts.',
    wholesaleCost: 380,
    retailPrice: 980,
    revenueType: 'mrr',
    status: 'available',
    riskLevel: 'high',
    matchedSopOrTemplate: 'BNDL-P2-EXEC: Entra P2 Protection',
    targetSeats: 45,
  },
  {
    id: 'off-016',
    code: 'OFF-UPG-04',
    title: 'Purview Information Protection & Governance Monthly Retainer',
    tenantId: 't-biohealth',
    tenantName: 'BioHealth Research Labs',
    domain: 'biohealthlabs.org',
    offerType: 'upgrade',
    category: 'Licensing & MRR',
    description: 'Monthly managed data governance subscription including continuous sensitivity labeling and automated archiving.',
    customerValueProtection: 'Ensures continuous HIPAA and FDA regulatory compliance for research documents as new files are created.',
    wholesaleCost: 620,
    retailPrice: 1650,
    revenueType: 'mrr',
    status: 'accepted',
    riskLevel: 'medium',
    matchedSopOrTemplate: 'BNDL-PURVIEW-GOV: Managed Compliance',
    targetSeats: 290,
  }
];

// ==========================================
// COMPONENT MAIN DEFINITION
// ==========================================

export const OwnerExecutiveConsole: React.FC<OwnerExecutiveConsoleProps> = ({
  tenants = [],
  onShowToast,
  onNavigateTab,
}) => {
  // Main Console Tabs
  const [activeTab, setActiveTab] = useState<'financial' | 'operational' | 'portfolio' | 'offer_rollup'>('financial');

  // Cross-Customer Offers State
  const [crossOffers, setCrossOffers] = useState<CrossCustomerOffer[]>(INITIAL_CROSS_CUSTOMER_OFFERS);
  const [offerTypeFilter, setOfferTypeFilter] = useState<'all' | 'project' | 'document' | 'micro_offer' | 'upgrade'>('all');
  const [offerStatusFilter, setOfferStatusFilter] = useState<string>('all');
  const [offerSearch, setOfferSearch] = useState<string>('');
  const [offerLayoutMode, setOfferLayoutMode] = useState<'table' | 'cards'>('table');
  const [selectedInspectOffer, setSelectedInspectOffer] = useState<CrossCustomerOffer | null>(null);

  // Memoized Offer Metrics & Rollups
  const offerMetrics = useMemo(() => {
    const totalRetail = crossOffers.reduce((sum, item) => sum + item.retailPrice, 0);
    const totalWholesale = crossOffers.reduce((sum, item) => sum + item.wholesaleCost, 0);
    const totalMargin = totalRetail - totalWholesale;
    const marginPercent = totalRetail > 0 ? Number(((totalMargin / totalRetail) * 100).toFixed(1)) : 0;

    const availableCount = crossOffers.filter((o) => o.status === 'available').length;
    const proposedCount = crossOffers.filter((o) => o.status === 'proposed').length;
    const acceptedCount = crossOffers.filter((o) => o.status === 'accepted' || o.status === 'executing').length;

    return {
      totalRetail,
      totalWholesale,
      totalMargin,
      marginPercent,
      availableCount,
      proposedCount,
      acceptedCount,
    };
  }, [crossOffers]);

  // Breakdown by Offer Type
  const typeBreakdown = useMemo(() => {
    const getGroup = (type: CrossCustomerOffer['offerType']) => {
      const items = crossOffers.filter((o) => o.offerType === type);
      const retail = items.reduce((s, i) => s + i.retailPrice, 0);
      const wholesale = items.reduce((s, i) => s + i.wholesaleCost, 0);
      return {
        count: items.length,
        retail,
        wholesale,
        margin: retail - wholesale,
      };
    };

    return {
      project: getGroup('project'),
      document: getGroup('document'),
      micro_offer: getGroup('micro_offer'),
      upgrade: getGroup('upgrade'),
    };
  }, [crossOffers]);

  // Customer Opportunity Leaderboard
  const customerLeaderboard = useMemo(() => {
    const map = new Map<
      string,
      {
        tenantId: string;
        tenantName: string;
        domain: string;
        openCount: number;
        totalRetail: number;
        totalWholesale: number;
        totalProfit: number;
      }
    >();

    crossOffers.forEach((offer) => {
      const existing = map.get(offer.tenantId) || {
        tenantId: offer.tenantId,
        tenantName: offer.tenantName,
        domain: offer.domain,
        openCount: 0,
        totalRetail: 0,
        totalWholesale: 0,
        totalProfit: 0,
      };

      existing.openCount += 1;
      existing.totalRetail += offer.retailPrice;
      existing.totalWholesale += offer.wholesaleCost;
      existing.totalProfit += offer.retailPrice - offer.wholesaleCost;

      map.set(offer.tenantId, existing);
    });

    return Array.from(map.values()).sort((a, b) => b.totalProfit - a.totalProfit);
  }, [crossOffers]);

  // Filtered Cross-Customer Offers List
  const filteredOffers = useMemo(() => {
    return crossOffers.filter((item) => {
      const matchesSearch =
        item.title.toLowerCase().includes(offerSearch.toLowerCase()) ||
        item.tenantName.toLowerCase().includes(offerSearch.toLowerCase()) ||
        item.code.toLowerCase().includes(offerSearch.toLowerCase()) ||
        item.customerValueProtection.toLowerCase().includes(offerSearch.toLowerCase()) ||
        item.category.toLowerCase().includes(offerSearch.toLowerCase());

      const matchesType = offerTypeFilter === 'all' || item.offerType === offerTypeFilter;
      const matchesStatus = offerStatusFilter === 'all' || item.status === offerStatusFilter;

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [crossOffers, offerSearch, offerTypeFilter, offerStatusFilter]);

  // Handlers for Offer Proposals & Execution
  const handleProposeOffer = (offerId: string) => {
    setCrossOffers((prev) =>
      prev.map((item) => (item.id === offerId ? { ...item, status: 'proposed' } : item))
    );
    const offer = crossOffers.find((o) => o.id === offerId);
    if (onShowToast && offer) {
      onShowToast(
        'success',
        'Proposal Quote Dispatched',
        `Dispatched formal quote for "${offer.title}" to ${offer.tenantName} (${offer.domain}). Value: $${offer.retailPrice.toLocaleString()}`
      );
    }
  };

  const handleProposeAllForTenant = (tenantId: string, tenantName: string) => {
    let count = 0;
    setCrossOffers((prev) =>
      prev.map((item) => {
        if (item.tenantId === tenantId && item.status === 'available') {
          count++;
          return { ...item, status: 'proposed' };
        }
        return item;
      })
    );
    if (onShowToast) {
      onShowToast(
        'success',
        'Customer Proposal Bundle Dispatched',
        `Generated & sent master proposal bundle containing ${count || 'all'} open offers to ${tenantName}.`
      );
    }
  };

  const handleProposeAllHighMargin = () => {
    setCrossOffers((prev) =>
      prev.map((item) => (item.status === 'available' ? { ...item, status: 'proposed' } : item))
    );
    if (onShowToast) {
      onShowToast(
        'success',
        'Global Offer Quotes Dispatched',
        `Dispatched proposal quotes for all open offers across all customers ($76,250.00 profit potential).`
      );
    }
  };

  const renderOfferTypeBadge = (type: CrossCustomerOffer['offerType']) => {
    switch (type) {
      case 'project':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1 font-mono">
            <Briefcase className="w-3 h-3 text-purple-400" /> Project
          </span>
        );
      case 'document':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center gap-1 font-mono">
            <FileText className="w-3 h-3 text-cyan-400" /> Document / Binder
          </span>
        );
      case 'micro_offer':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1 font-mono">
            <Zap className="w-3 h-3 text-amber-400" /> Micro-Fix
          </span>
        );
      case 'upgrade':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 font-mono">
            <Package className="w-3 h-3 text-emerald-400" /> Upgrade (MRR)
          </span>
        );
    }
  };

  const renderOfferStatusBadge = (status: CrossCustomerOffer['status']) => {
    switch (status) {
      case 'available':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Ready to Propose
          </span>
        );
      case 'proposed':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1">
            <Send className="w-3 h-3" /> Quote Sent
          </span>
        );
      case 'accepted':
      case 'executing':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Executed / Active
          </span>
        );
    }
  };

  // Date Range State
  const [dateRange, setDateRange] = useState<'this_month' | 'qtd' | 'ytd'>('this_month');
  const [isSyncingErp, setIsSyncingErp] = useState(false);

  // Micro-Transaction State
  const [microTransactions, setMicroTransactions] = useState<MicroTransaction[]>(INITIAL_MICRO_TRANSACTIONS);
  const [microSearch, setMicroSearch] = useState('');
  const [microCategoryFilter, setMicroCategoryFilter] = useState<string>('all');
  const [isAddMicroModalOpen, setIsAddMicroModalOpen] = useState(false);

  // New Micro-Transaction Form State
  const [newMicroForm, setNewMicroForm] = useState<{
    tenantName: string;
    title: string;
    category: 'onboarding_fee' | 'emergency_ir' | 'migration' | 'custom_script';
    amount: number;
    description: string;
    assignedTech: string;
  }>({
    tenantName: 'Contoso Pharmaceuticals',
    title: '',
    category: 'emergency_ir',
    amount: 1500,
    description: '',
    assignedTech: 'Marcus Vance (SecOps Lead)',
  });

  // Client Portfolio State
  const [portfolio, setPortfolio] = useState<TenantProfitability[]>(INITIAL_TENANT_PROFITABILITY);
  const [portfolioSearch, setPortfolioSearch] = useState('');
  const [marginFilter, setMarginFilter] = useState<'all' | 'high' | 'mid' | 'low'>('all');
  const [selectedInspectTenant, setSelectedInspectTenant] = useState<TenantProfitability | null>(null);
  const [selectedAdjustTenant, setSelectedAdjustTenant] = useState<TenantProfitability | null>(null);

  // Simulated Adjust Bundle State
  const [bundleAdjustment, setBundleAdjustment] = useState<{
    addIntuneSeats: number;
    addSocSeats: number;
    addPimSeats: number;
    addBackupSeats: number;
  }>({
    addIntuneSeats: 0,
    addSocSeats: 0,
    addPimSeats: 0,
    addBackupSeats: 0,
  });

  // ==========================================
  // CALCULATED FINANCIAL VALUES
  // ==========================================

  const financials = useMemo(() => {
    const base = INITIAL_FINANCIALS;
    const microTotal = microTransactions
      .filter((mt) => mt.status === 'paid' || mt.status === 'billed')
      .reduce((sum, item) => sum + item.amount, 0);

    const totalMrr = base.totalMrr + (dateRange === 'this_month' ? 0 : dateRange === 'qtd' ? 12000 : 38000);
    const netArr = totalMrr * 12;
    const aiExpense = base.aiExpenseMonthly + (dateRange === 'this_month' ? 0 : 350);
    const cogs = base.billingCogsMonthly;
    const addOns = base.addOnsRevenueMonthly;

    const totalRevenue = totalMrr + microTotal;
    const netProfit = totalRevenue - cogs - aiExpense - 4200; // $4,200 platform overhead
    const grossMarginPercent = Number(((netProfit / totalRevenue) * 100).toFixed(1));

    return {
      totalMrr,
      netArr,
      grossMarginPercent,
      aiExpenseMonthly: aiExpense,
      billingCogsMonthly: cogs,
      addOnsRevenueMonthly: addOns,
      microTransactionsMtd: microTotal,
      netProfit,
    };
  }, [dateRange, microTransactions]);

  // Filtered Micro-Transactions
  const filteredMicroTransactions = useMemo(() => {
    return microTransactions.filter((mt) => {
      const matchesSearch =
        mt.tenantName.toLowerCase().includes(microSearch.toLowerCase()) ||
        mt.title.toLowerCase().includes(microSearch.toLowerCase()) ||
        mt.id.toLowerCase().includes(microSearch.toLowerCase());
      const matchesCategory = microCategoryFilter === 'all' || mt.category === microCategoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [microTransactions, microSearch, microCategoryFilter]);

  // Filtered Portfolio
  const filteredPortfolio = useMemo(() => {
    return portfolio.filter((item) => {
      const matchesSearch =
        item.tenantName.toLowerCase().includes(portfolioSearch.toLowerCase()) ||
        item.domain.toLowerCase().includes(portfolioSearch.toLowerCase());

      let matchesMargin = true;
      if (marginFilter === 'high') matchesMargin = item.netMarginPercent >= 60;
      if (marginFilter === 'mid') matchesMargin = item.netMarginPercent >= 50 && item.netMarginPercent < 60;
      if (marginFilter === 'low') matchesMargin = item.netMarginPercent < 50;

      return matchesSearch && matchesMargin;
    });
  }, [portfolio, portfolioSearch, marginFilter]);

  // ==========================================
  // HANDLERS
  // ==========================================

  const handleSyncErp = () => {
    setIsSyncingErp(true);
    setTimeout(() => {
      setIsSyncingErp(false);
      if (onShowToast) {
        onShowToast(
          'success',
          'Ledger Synced with ERP',
          'Successfully posted $75,650.00 revenue & $24,800.00 COGS to QuickBooks Online.'
        );
      }
    }, 1200);
  };

  const handleExportPdf = () => {
    if (onShowToast) {
      onShowToast(
        'info',
        'Generating Executive FinOps Report',
        'Compiling cross-tenant P&L statement, AI token telemetry, and micro-transaction ledger PDF.'
      );
    }
  };

  const handleAddMicroTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMicroForm.title || newMicroForm.amount <= 0) return;

    const newId = `MT-2026-${String(microTransactions.length + 1).padStart(3, '0')}`;
    const newEntry: MicroTransaction = {
      id: newId,
      tenantId: `t-${newMicroForm.tenantName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      tenantName: newMicroForm.tenantName,
      title: newMicroForm.title,
      category: newMicroForm.category,
      amount: Number(newMicroForm.amount),
      date: new Date().toISOString().split('T')[0],
      status: 'billed',
      description: newMicroForm.description || 'Custom MSP Micro-Transaction Line Item',
      assignedTech: newMicroForm.assignedTech,
    };

    setMicroTransactions([newEntry, ...microTransactions]);
    setIsAddMicroModalOpen(false);
    setNewMicroForm({
      tenantName: 'Contoso Pharmaceuticals',
      title: '',
      category: 'emergency_ir',
      amount: 1500,
      description: '',
      assignedTech: 'Marcus Vance (SecOps Lead)',
    });

    if (onShowToast) {
      onShowToast(
        'success',
        'Micro-Transaction Logged',
        `Recorded ${newId}: +$${newEntry.amount.toLocaleString()} for ${newEntry.tenantName}.`
      );
    }
  };

  const handleSaveBundleAdjustment = () => {
    if (!selectedAdjustTenant) return;

    const addedAddOnRevenue =
      bundleAdjustment.addIntuneSeats * 4.0 +
      bundleAdjustment.addSocSeats * 8.0 +
      bundleAdjustment.addPimSeats * 3.5 +
      bundleAdjustment.addBackupSeats * 2.5;

    const updatedPortfolio = portfolio.map((item) => {
      if (item.tenantId === selectedAdjustTenant.tenantId) {
        const newGrossMrr = item.grossMrr + addedAddOnRevenue;
        const newAddOnMargin = item.addOnMargin + addedAddOnRevenue;
        const newNetProfit = newGrossMrr - item.cogs - item.aiSpend;
        const newMarginPercent = Number(((newNetProfit / newGrossMrr) * 100).toFixed(1));

        return {
          ...item,
          grossMrr: newGrossMrr,
          addOnMargin: newAddOnMargin,
          netMarginPercent: newMarginPercent,
        };
      }
      return item;
    });

    setPortfolio(updatedPortfolio);
    if (onShowToast) {
      onShowToast(
        'success',
        'Bundle Recalculated',
        `Updated ${selectedAdjustTenant.tenantName} bundle MRR to +$${addedAddOnRevenue.toFixed(2)}/mo margin.`
      );
    }
    setSelectedAdjustTenant(null);
    setBundleAdjustment({ addIntuneSeats: 0, addSocSeats: 0, addPimSeats: 0, addBackupSeats: 0 });
  };

  // Helper for category badges
  const renderCategoryBadge = (category: MicroTransaction['category']) => {
    switch (category) {
      case 'emergency_ir':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30 flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" /> Emergency IR
          </span>
        );
      case 'onboarding_fee':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center gap-1">
            <Zap className="w-3 h-3" /> Onboarding Setup
          </span>
        );
      case 'migration':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center gap-1">
            <Server className="w-3 h-3" /> Migration
          </span>
        );
      case 'custom_script':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Custom Scripting
          </span>
        );
      default:
        return null;
    }
  };

  // Helper for status badges
  const renderStatusBadge = (status: MicroTransaction['status']) => {
    switch (status) {
      case 'paid':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Paid
          </span>
        );
      case 'billed':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center gap-1">
            <Receipt className="w-3 h-3" /> Billed
          </span>
        );
      case 'pending':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Pending
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 p-4 md:p-6 font-sans space-y-6">
      {/* ========================================== */}
      {/* TOP HEADER & EXECUTIVE FINOPS ROLLUP BAR   */}
      {/* ========================================== */}
      <div className="bg-[#111726] rounded-3xl border border-[#1e293b] p-6 shadow-2xl relative overflow-hidden">
        {/* Ambient Glows */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-[#1e293b]">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-500/15 rounded-2xl border border-emerald-500/30">
                <Building2 className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    MSP Executive Command Center
                  </span>
                  <span className="text-xs text-slate-400 font-medium">
                    /portal/owner-dashboard
                  </span>
                </div>
                <h1 className="text-2xl font-extrabold text-white tracking-tight mt-0.5">
                  MSP Overview & Executive FinOps Rollup
                </h1>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-2 max-w-2xl leading-relaxed">
              Cross-tenant P&L analytics, wholesale Microsoft NCE COGS, LLM token metering compute expenses,
              managed add-ons margins, and itemized micro-transactions ledger.
            </p>
          </div>

          {/* Header Controls & ERP Sync */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Date Range Picker */}
            <div className="bg-[#182234] p-1 rounded-xl border border-[#26354f] flex items-center">
              <button
                onClick={() => setDateRange('this_month')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                  dateRange === 'this_month'
                    ? 'bg-[#0078D4] text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                )}
              >
                This Month
              </button>
              <button
                onClick={() => setDateRange('qtd')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                  dateRange === 'qtd'
                    ? 'bg-[#0078D4] text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                )}
              >
                QTD (Q3)
              </button>
              <button
                onClick={() => setDateRange('ytd')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                  dateRange === 'ytd'
                    ? 'bg-[#0078D4] text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                )}
              >
                YTD 2026
              </button>
            </div>

            {/* Sync Accounting ERP */}
            <button
              onClick={handleSyncErp}
              disabled={isSyncingErp}
              className="px-3.5 py-2 bg-[#182234] hover:bg-[#202e46] text-xs font-bold text-slate-200 rounded-xl border border-[#26354f] flex items-center gap-2 transition-all shadow-md disabled:opacity-50"
            >
              <RefreshCw className={cn('w-4 h-4 text-cyan-400', isSyncingErp && 'animate-spin')} />
              {isSyncingErp ? 'Syncing ERP...' : 'Sync Accounting ERP'}
            </button>

            {/* Export Report PDF */}
            <button
              onClick={handleExportPdf}
              className="px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-xs font-bold text-white rounded-xl shadow-lg flex items-center gap-2 transition-all"
            >
              <Download className="w-4 h-4" />
              Export Executive Report PDF
            </button>
          </div>
        </div>

        {/* TOP KPI REVENUE SUMMARY CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          {/* Card 1: MRR & ARR */}
          <div className="bg-[#182234]/90 p-4 rounded-2xl border border-[#26354f] shadow-lg flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                Contracted Monthly MRR
              </span>
              <div className="p-2 bg-emerald-500/20 rounded-xl border border-emerald-500/30">
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
            </div>
            <div className="mt-2">
              <div className="text-2xl font-black text-white">
                ${financials.totalMrr.toLocaleString()} <span className="text-xs font-normal text-slate-400">/ mo</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs">
                <span className="text-emerald-400 font-bold flex items-center gap-0.5">
                  <TrendingUp className="w-3.5 h-3.5" /> +12.4%
                </span>
                <span className="text-slate-400 text-[11px]">ARR: ${(financials.netArr / 1000).toFixed(1)}k</span>
              </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-[#26354f]/60 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Base Retainers: $42.5k</span>
              <span className="text-emerald-400 font-semibold">Add-Ons: $18.7k</span>
            </div>
          </div>

          {/* Card 2: AI Metered Expenses */}
          <div className="bg-[#182234]/90 p-4 rounded-2xl border border-[#26354f] shadow-lg flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                AI Token Compute Expense
              </span>
              <div className="p-2 bg-amber-500/20 rounded-xl border border-amber-500/30">
                <Cpu className="w-4 h-4 text-amber-400" />
              </div>
            </div>
            <div className="mt-2">
              <div className="text-2xl font-black text-amber-400">
                ${financials.aiExpenseMonthly.toLocaleString()} <span className="text-xs font-normal text-slate-400">/ mo</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs">
                <span className="text-emerald-400 font-bold flex items-center gap-0.5">
                  <TrendingDown className="w-3.5 h-3.5" /> -3.1% opt
                </span>
                <span className="text-slate-400 text-[11px]">14.2M Tokens Processed</span>
              </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-[#26354f]/60 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Azure GPT-4o: $680</span>
              <span className="text-amber-400 font-semibold">Claude: $340</span>
            </div>
          </div>

          {/* Card 3: Wholesale COGS */}
          <div className="bg-[#182234]/90 p-4 rounded-2xl border border-[#26354f] shadow-lg flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                Wholesale Vendor COGS
              </span>
              <div className="p-2 bg-blue-500/20 rounded-xl border border-blue-500/30">
                <Receipt className="w-4 h-4 text-blue-400" />
              </div>
            </div>
            <div className="mt-2">
              <div className="text-2xl font-black text-slate-100">
                ${financials.billingCogsMonthly.toLocaleString()} <span className="text-xs font-normal text-slate-400">/ mo</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs">
                <span className="text-slate-400 text-[11px]">Pax8: $18.2k | TD Synnex: $6.6k</span>
              </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-[#26354f]/60 text-[11px] text-slate-400 flex items-center justify-between">
              <span>M365 NCE Licenses</span>
              <span className="text-cyan-400 font-semibold">1,850 Total Seats</span>
            </div>
          </div>

          {/* Card 4: Net Gross Margin % */}
          <div className="bg-[#182234]/90 p-4 rounded-2xl border border-[#26354f] shadow-lg flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                Net Profitability Margin
              </span>
              <div className="p-2 bg-purple-500/20 rounded-xl border border-purple-500/30">
                <BarChart3 className="w-4 h-4 text-purple-400" />
              </div>
            </div>
            <div className="mt-2">
              <div className="text-2xl font-black text-emerald-400">
                {financials.grossMarginPercent}% <span className="text-xs font-normal text-slate-400">Net Margin</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs">
                <span className="text-emerald-400 font-bold">🟢 Target Exceeded (&gt;60%)</span>
              </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-[#26354f]/60 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Net Profit: ${financials.netProfit.toLocaleString()}</span>
              <span className="text-purple-400 font-semibold">Rule of 40: 74%</span>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================== */}
      {/* NAVIGATION TABS (3 MAIN FINOPS CONSOLES)  */}
      {/* ========================================== */}
      <div className="flex items-center justify-between border-b border-[#1e293b] pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('financial')}
            className={cn(
              'px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border',
              activeTab === 'financial'
                ? 'bg-[#0078D4] text-white border-[#0078D4] shadow-lg shadow-[#0078D4]/20'
                : 'bg-[#111726] text-slate-400 hover:text-white border-[#1e293b]'
            )}
          >
            <BarChart3 className="w-4 h-4" />
            Financial Command &amp; P&amp;L Engine
          </button>

          <button
            onClick={() => setActiveTab('operational')}
            className={cn(
              'px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border',
              activeTab === 'operational'
                ? 'bg-[#0078D4] text-white border-[#0078D4] shadow-lg shadow-[#0078D4]/20'
                : 'bg-[#111726] text-slate-400 hover:text-white border-[#1e293b]'
            )}
          >
            <Activity className="w-4 h-4 text-emerald-400" />
            Cross-Tenant Operational Rollup
          </button>

          <button
            onClick={() => setActiveTab('portfolio')}
            className={cn(
              'px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer',
              activeTab === 'portfolio'
                ? 'bg-[#0078D4] text-white border-[#0078D4] shadow-lg shadow-[#0078D4]/20'
                : 'bg-[#111726] text-slate-400 hover:text-white border-[#1e293b]'
            )}
          >
            <Building2 className="w-4 h-4 text-cyan-400" />
            Client Portfolio &amp; Account Margin Matrix
          </button>

          <button
            onClick={() => setActiveTab('offer_rollup')}
            className={cn(
              'px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer relative',
              activeTab === 'offer_rollup'
                ? 'bg-gradient-to-r from-amber-600 to-emerald-600 text-white border-amber-400 shadow-lg shadow-amber-500/20'
                : 'bg-[#111726] text-slate-400 hover:text-white border-[#1e293b]'
            )}
          >
            <ShoppingBag className="w-4 h-4 text-amber-300" />
            <span>Cross-Customer Offer &amp; Revenue Rollup</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-400/20 text-amber-200 border border-amber-400/30">
              +$76.2k Profit
            </span>
          </button>
        </div>

        <div className="hidden md:flex items-center gap-2 text-xs text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Real-time Telemetry Engine Active</span>
        </div>
      </div>

      {/* ========================================== */}
      {/* TAB 1: FINANCIAL COMMAND & P&L ENGINE      */}
      {/* ========================================== */}
      {activeTab === 'financial' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT PANE (60% WIDTH - 7 COLS ON LG): INCOME & EXPENSE BREAKDOWN GRID */}
          <div className="lg:col-span-7 space-y-6">
            {/* Category 1: Monthly Recurring Revenue (MRR) */}
            <div className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#1e293b]">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-emerald-500/20 rounded-xl border border-emerald-500/30">
                    <DollarSign className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Monthly Recurring Income (MRR)</h3>
                    <p className="text-xs text-slate-400">Base seat retainers + Sales Bundle subscriptions</p>
                  </div>
                </div>
                <span className="text-base font-black text-emerald-400">
                  ${(financials.totalMrr - financials.addOnsRevenueMonthly).toLocaleString()} / mo
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-[#182234] rounded-xl border border-[#26354f]">
                  <p className="text-[10px] uppercase font-bold text-slate-400">M365 Base Seat Retainers</p>
                  <p className="text-sm font-bold text-white mt-1">$42,500.00 / mo</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">1,850 Active Seats @ $22.97 avg</p>
                </div>
                <div className="p-3 bg-[#182234] rounded-xl border border-[#26354f]">
                  <p className="text-[10px] uppercase font-bold text-slate-400">Tier Retainer Bundles</p>
                  <p className="text-sm font-bold text-white mt-1">$25,950.00 / mo</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Enterprise &amp; Gold Retainers</p>
                </div>
              </div>
            </div>

            {/* Category 2: AI Token Expense Metering */}
            <div className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#1e293b]">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-amber-500/20 rounded-xl border border-amber-500/30">
                    <Cpu className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">AI Token Expense Metering Details</h3>
                    <p className="text-xs text-slate-400">Azure OpenAI, Anthropic, &amp; Local Runner compute expenses</p>
                  </div>
                </div>
                <span className="text-base font-black text-amber-400">
                  ${financials.aiExpenseMonthly.toLocaleString()} / mo
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-xs">
                <div className="p-2.5 bg-[#182234] rounded-xl border border-[#26354f]">
                  <p className="text-[10px] font-bold text-slate-400">Azure GPT-4o</p>
                  <p className="text-xs font-bold text-amber-400 mt-0.5">$680.00</p>
                  <p className="text-[10px] text-slate-400">8.2M tokens</p>
                </div>
                <div className="p-2.5 bg-[#182234] rounded-xl border border-[#26354f]">
                  <p className="text-[10px] font-bold text-slate-400">Claude 3.5 Sonnet</p>
                  <p className="text-xs font-bold text-amber-400 mt-0.5">$340.00</p>
                  <p className="text-[10px] text-slate-400">3.8M tokens</p>
                </div>
                <div className="p-2.5 bg-[#182234] rounded-xl border border-[#26354f]">
                  <p className="text-[10px] font-bold text-slate-400">Local DeepSeek-R1</p>
                  <p className="text-xs font-bold text-amber-400 mt-0.5">$120.00</p>
                  <p className="text-[10px] text-slate-400">1.5M tokens</p>
                </div>
                <div className="p-2.5 bg-[#182234] rounded-xl border border-[#26354f]">
                  <p className="text-[10px] font-bold text-slate-400">Copilot Summarizer</p>
                  <p className="text-xs font-bold text-amber-400 mt-0.5">$100.00</p>
                  <p className="text-[10px] text-slate-400">0.7M tokens</p>
                </div>
              </div>
            </div>

            {/* Category 3: Wholesale COGS & Vendor License Expenses */}
            <div className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#1e293b]">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-blue-500/20 rounded-xl border border-blue-500/30">
                    <Receipt className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Wholesale Microsoft NCE License COGS</h3>
                    <p className="text-xs text-slate-400">Distributor costs owed to Pax8 &amp; TD Synnex</p>
                  </div>
                </div>
                <span className="text-base font-black text-slate-100">
                  ${financials.billingCogsMonthly.toLocaleString()} / mo
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-[#182234] rounded-xl border border-[#26354f]">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-200">Pax8 Distributor Invoice</span>
                    <span className="text-cyan-400 font-bold">$18,200.00</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">M365 E5, E3, Business Premium SKUs</p>
                </div>

                <div className="p-3 bg-[#182234] rounded-xl border border-[#26354f]">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-200">TD Synnex CSP Invoice</span>
                    <span className="text-cyan-400 font-bold">$6,600.00</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">Azure Consumption &amp; Defender Plan 2</p>
                </div>
              </div>
            </div>

            {/* Category 4: Add-On Managed Services Margin */}
            <div className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#1e293b]">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-purple-500/20 rounded-xl border border-purple-500/30">
                    <ShoppingBag className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Managed Add-Ons High-Margin Revenue</h3>
                    <p className="text-xs text-slate-400">Intune MDM, 24/7 Defender SOC, PIM, &amp; Cloud Backup</p>
                  </div>
                </div>
                <span className="text-base font-black text-purple-400">
                  +${financials.addOnsRevenueMonthly.toLocaleString()} / mo
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-xs">
                <div className="p-2.5 bg-[#182234] rounded-xl border border-[#26354f]">
                  <p className="text-[10px] font-bold text-slate-400">24/7 SOC Defender</p>
                  <p className="text-xs font-bold text-emerald-400 mt-0.5">$8,800 / mo</p>
                  <p className="text-[10px] text-slate-400">$8.00 margin/seat</p>
                </div>
                <div className="p-2.5 bg-[#182234] rounded-xl border border-[#26354f]">
                  <p className="text-[10px] font-bold text-slate-400">Cloud Backup</p>
                  <p className="text-xs font-bold text-emerald-400 mt-0.5">$4,275 / mo</p>
                  <p className="text-[10px] text-slate-400">$2.50 margin/seat</p>
                </div>
                <div className="p-2.5 bg-[#182234] rounded-xl border border-[#26354f]">
                  <p className="text-[10px] font-bold text-slate-400">Intune MDM</p>
                  <p className="text-xs font-bold text-emerald-400 mt-0.5">$3,400 / mo</p>
                  <p className="text-[10px] text-slate-400">$4.00 margin/seat</p>
                </div>
                <div className="p-2.5 bg-[#182234] rounded-xl border border-[#26354f]">
                  <p className="text-[10px] font-bold text-slate-400">PIM Governance</p>
                  <p className="text-xs font-bold text-emerald-400 mt-0.5">$2,275 / mo</p>
                  <p className="text-[10px] text-slate-400">$3.50 margin/seat</p>
                </div>
              </div>
            </div>

            {/* Category 5: "Micro-Transactions" & One-Time Revenue Ledger */}
            <div className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#1e293b]">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white">"Micro-Transactions" &amp; One-Time Revenue Ledger</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      +${financials.microTransactionsMtd.toLocaleString()} MTD
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Ad-hoc incident retainers, setup fees, migrations, and custom scripting charges
                  </p>
                </div>

                <button
                  onClick={() => setIsAddMicroModalOpen(true)}
                  className="px-3 py-1.5 bg-[#0078D4] hover:bg-[#005a9e] text-xs font-bold text-white rounded-xl shadow-md flex items-center gap-1.5 transition-all self-start sm:self-auto"
                >
                  <Plus className="w-3.5 h-3.5" /> Log Micro-Transaction
                </button>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={microSearch}
                    onChange={(e) => setMicroSearch(e.target.value)}
                    placeholder="Search tenant or line item..."
                    className="w-full bg-[#182234] border border-[#26354f] rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#0078D4]"
                  />
                </div>

                <select
                  value={microCategoryFilter}
                  onChange={(e) => setMicroCategoryFilter(e.target.value)}
                  className="bg-[#182234] border border-[#26354f] rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#0078D4]"
                >
                  <option value="all">All Categories</option>
                  <option value="emergency_ir">Emergency IR</option>
                  <option value="onboarding_fee">Onboarding Setup</option>
                  <option value="migration">Migrations</option>
                  <option value="custom_script">Custom Scripting</option>
                </select>
              </div>

              {/* Micro-Transactions Itemized Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#1e293b] text-slate-400 text-[10px] uppercase font-bold">
                      <th className="py-2 px-2">Line ID / Date</th>
                      <th className="py-2 px-2">Tenant</th>
                      <th className="py-2 px-2">Description / Title</th>
                      <th className="py-2 px-2">Category</th>
                      <th className="py-2 px-2 text-right">Amount</th>
                      <th className="py-2 px-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e293b]/60">
                    {filteredMicroTransactions.map((mt) => (
                      <tr key={mt.id} className="hover:bg-[#182234]/50 transition-colors">
                        <td className="py-2.5 px-2">
                          <p className="font-mono text-cyan-300 font-bold text-[11px]">{mt.id}</p>
                          <p className="text-[10px] text-slate-500">{mt.date}</p>
                        </td>
                        <td className="py-2.5 px-2 font-medium text-slate-200">{mt.tenantName}</td>
                        <td className="py-2.5 px-2 max-w-[200px]">
                          <p className="font-semibold text-slate-100 truncate">{mt.title}</p>
                          <p className="text-[10px] text-slate-400 truncate">{mt.description}</p>
                        </td>
                        <td className="py-2.5 px-2">{renderCategoryBadge(mt.category)}</td>
                        <td className="py-2.5 px-2 text-right font-black text-emerald-400 text-sm">
                          +${mt.amount.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-2 text-center">{renderStatusBadge(mt.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* RIGHT PANE (40% WIDTH - 5 COLS ON LG): P&L DISTRIBUTION DONUT & MARGIN GAUGES */}
          <div className="lg:col-span-5 space-y-6">
            {/* Revenue Mix & Expense Distribution Visualizer */}
            <div className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-[#1e293b]">
                <div className="flex items-center gap-2">
                  <PieChart className="w-5 h-5 text-[#38BDF8]" />
                  <h3 className="text-sm font-bold text-white">Revenue Mix &amp; Margin Ratio</h3>
                </div>
                <span className="text-xs text-emerald-400 font-bold">P&amp;L Health: Optimal</span>
              </div>

              {/* Revenue Composition Stacked Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold text-slate-300">
                  <span>Revenue Breakdown ($75,650 Total)</span>
                  <span className="text-emerald-400">100% Income</span>
                </div>
                <div className="h-4 w-full bg-[#182234] rounded-full overflow-hidden flex">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: '56%' }} title="Base Retainers: 56%" />
                  <div className="h-full bg-purple-500 transition-all" style={{ width: '25%' }} title="Managed Add-Ons: 25%" />
                  <div className="h-full bg-cyan-400 transition-all" style={{ width: '10%' }} title="Micro-Transactions: 10%" />
                  <div className="h-full bg-amber-400 transition-all" style={{ width: '9%' }} title="Custom Engagements: 9%" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="text-slate-300">Base Retainers (56%)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                    <span className="text-slate-300">Managed Add-Ons (25%)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                    <span className="text-slate-300">Micro-Trans (10%)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span className="text-slate-300">Custom Services (9%)</span>
                  </div>
                </div>
              </div>

              {/* Expense Ratio Stacked Bar */}
              <div className="space-y-2 pt-3 border-t border-[#1e293b]">
                <div className="flex justify-between text-xs font-bold text-slate-300">
                  <span>Expenses vs Net Profit ($75,650)</span>
                  <span className="text-purple-400">{financials.grossMarginPercent}% Net Margin</span>
                </div>
                <div className="h-4 w-full bg-[#182234] rounded-full overflow-hidden flex">
                  <div className="h-full bg-blue-500 transition-all" style={{ width: '32.8%' }} title="COGS: 32.8%" />
                  <div className="h-full bg-amber-500 transition-all" style={{ width: '1.6%' }} title="AI Token Compute: 1.6%" />
                  <div className="h-full bg-slate-600 transition-all" style={{ width: '5.5%' }} title="Platform Overhead: 5.5%" />
                  <div className="h-full bg-emerald-400 transition-all" style={{ width: '60.1%' }} title="Net Profit: 60.1%" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    <span className="text-slate-300">Wholesale COGS (32.8%)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    <span className="text-slate-300">AI Compute (1.6%)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                    <span className="text-slate-300">Platform Overhead (5.5%)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                    <span className="text-emerald-400 font-bold">Net Profit (60.1%)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* FinOps Operational Efficiency Gauges */}
            <div className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl space-y-4">
              <h3 className="text-sm font-bold text-white pb-2 border-b border-[#1e293b]">
                Key SaaS FinOps Performance Gauges
              </h3>

              <div className="space-y-3 text-xs">
                {/* Rule of 40 */}
                <div className="p-3 bg-[#182234] rounded-xl border border-[#26354f] space-y-1.5">
                  <div className="flex justify-between items-center font-bold">
                    <span className="text-slate-300">Rule of 40 Benchmark</span>
                    <span className="text-emerald-400">74.4% (Top Tier)</span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-400 w-[74%]" />
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Calculated as 12.4% YoY Growth + 62.0% EBITDA Margin.
                  </p>
                </div>

                {/* ARPU */}
                <div className="p-3 bg-[#182234] rounded-xl border border-[#26354f] space-y-1">
                  <div className="flex justify-between items-center font-bold">
                    <span className="text-slate-300">ARPU (Avg Revenue Per Tenant)</span>
                    <span className="text-cyan-400">$3,422.50 / mo</span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Across 20 active managed customer tenant accounts.
                  </p>
                </div>

                {/* Cost-to-Serve */}
                <div className="p-3 bg-[#182234] rounded-xl border border-[#26354f] space-y-1">
                  <div className="flex justify-between items-center font-bold">
                    <span className="text-slate-300">Cost-to-Serve Per Seat</span>
                    <span className="text-purple-400">$13.40 / seat</span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Total COGS + AI tokens + Platform cost divided by 1,850 seats.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 2: CROSS-TENANT OPERATIONAL ROLLUP     */}
      {/* ========================================== */}
      {activeTab === 'operational' && (
        <div className="space-y-6">
          {/* Operational Rollup 5-Card Pulse Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-[#111726] p-4 rounded-2xl border border-[#1e293b] shadow-lg flex items-center justify-between">
              <div>
                <p className="text-[10px] font-extrabold uppercase text-slate-400">Active Threat Alerts</p>
                <p className="text-2xl font-black text-red-400 mt-1">14</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Critical/High across tenants</p>
              </div>
              <div className="p-2.5 bg-red-500/20 rounded-xl border border-red-500/30">
                <ShieldAlert className="w-5 h-5 text-red-400 animate-pulse" />
              </div>
            </div>

            <div className="bg-[#111726] p-4 rounded-2xl border border-[#1e293b] shadow-lg flex items-center justify-between">
              <div>
                <p className="text-[10px] font-extrabold uppercase text-slate-400">SLA At-Risk Count</p>
                <p className="text-2xl font-black text-amber-400 mt-1">3 Tasks</p>
                <p className="text-[11px] text-slate-400 mt-0.5">&lt; 45 mins to breach</p>
              </div>
              <div className="p-2.5 bg-amber-500/20 rounded-xl border border-amber-500/30">
                <Clock className="w-5 h-5 text-amber-400" />
              </div>
            </div>

            <div className="bg-[#111726] p-4 rounded-2xl border border-[#1e293b] shadow-lg flex items-center justify-between">
              <div>
                <p className="text-[10px] font-extrabold uppercase text-slate-400">Pending Dual-Custody</p>
                <p className="text-2xl font-black text-purple-400 mt-1">6</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Awaiting senior sign-off</p>
              </div>
              <div className="p-2.5 bg-purple-500/20 rounded-xl border border-purple-500/30">
                <Lock className="w-5 h-5 text-purple-400" />
              </div>
            </div>

            <div className="bg-[#111726] p-4 rounded-2xl border border-[#1e293b] shadow-lg flex items-center justify-between">
              <div>
                <p className="text-[10px] font-extrabold uppercase text-slate-400">Active Onboardings</p>
                <p className="text-2xl font-black text-cyan-400 mt-1">4 Tenants</p>
                <p className="text-[11px] text-slate-400 mt-0.5">7-Stage Canvas active</p>
              </div>
              <div className="p-2.5 bg-cyan-500/20 rounded-xl border border-cyan-500/30">
                <Zap className="w-5 h-5 text-cyan-400" />
              </div>
            </div>

            <div className="bg-[#111726] p-4 rounded-2xl border border-[#1e293b] shadow-lg flex items-center justify-between">
              <div>
                <p className="text-[10px] font-extrabold uppercase text-slate-400">7-Pillar Health Score</p>
                <p className="text-2xl font-black text-emerald-400 mt-1">91.8%</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Cross-tenant average</p>
              </div>
              <div className="p-2.5 bg-emerald-500/20 rounded-xl border border-emerald-500/30">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
              </div>
            </div>
          </div>

          {/* Operational Matrix Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* SLA Breach Risk Queue */}
            <div className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#1e293b]">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-amber-400" />
                  <h3 className="text-sm font-bold text-white">SLA At-Risk Queue &amp; Breach Countdown</h3>
                </div>
                <span className="text-xs text-amber-400 font-bold">3 Tasks Approaching Breach</span>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="p-3 bg-[#182234] rounded-xl border border-red-500/30 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-100">Contoso Pharmaceuticals</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400">P1 Incident</span>
                    </div>
                    <p className="text-slate-400 mt-0.5">MFA Bypass anomaly detected on Executive Admin</p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-red-400 font-black text-sm">18m 42s left</span>
                    <p className="text-[10px] text-slate-500">Tech: M. Vance</p>
                  </div>
                </div>

                <div className="p-3 bg-[#182234] rounded-xl border border-amber-500/30 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-100">Pacific Rim Freight</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400">P2 Ticket</span>
                    </div>
                    <p className="text-slate-400 mt-0.5">Intune compliance policy sync failure</p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-amber-400 font-black text-sm">34m 10s left</span>
                    <p className="text-[10px] text-slate-500">Tech: D. Chen</p>
                  </div>
                </div>

                <div className="p-3 bg-[#182234] rounded-xl border border-amber-500/30 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-100">Acme Corporation</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400">P2 Ticket</span>
                    </div>
                    <p className="text-slate-400 mt-0.5">Mail flow rule transport loop remediation</p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-amber-400 font-black text-sm">41m 05s left</span>
                    <p className="text-[10px] text-slate-500">Tech: S. Jenkins</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Pending Dual-Custody Approvals */}
            <div className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#1e293b]">
                <div className="flex items-center gap-2">
                  <Lock className="w-5 h-5 text-purple-400" />
                  <h3 className="text-sm font-bold text-white">Pending Dual-Custody Approvals</h3>
                </div>
                <span className="text-xs text-purple-400 font-bold">6 Requests Awaiting Sign-off</span>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="p-3 bg-[#182234] rounded-xl border border-[#26354f] flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-100">BioHealth Research Labs</p>
                    <p className="text-slate-400 text-[11px] mt-0.5">Elevate User to Global Administrator (PIM 2hr)</p>
                  </div>
                  <button
                    onClick={() => onShowToast?.('success', 'Approval Dispatched', 'Dual-custody sign-off confirmed for BioHealth.')}
                    className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg text-[11px]"
                  >
                    Sign &amp; Approve
                  </button>
                </div>

                <div className="p-3 bg-[#182234] rounded-xl border border-[#26354f] flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-100">Vanguard Financial Services</p>
                    <p className="text-slate-400 text-[11px] mt-0.5">Grant OAuth Full Control Scope to Custom Exporter</p>
                  </div>
                  <button
                    onClick={() => onShowToast?.('success', 'Approval Dispatched', 'Dual-custody sign-off confirmed for Vanguard.')}
                    className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg text-[11px]"
                  >
                    Sign &amp; Approve
                  </button>
                </div>

                <div className="p-3 bg-[#182234] rounded-xl border border-[#26354f] flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-100">Apex Global Logistics</p>
                    <p className="text-slate-400 text-[11px] mt-0.5">Force Revoke All Active Refresh Tokens (Tenant-Wide)</p>
                  </div>
                  <button
                    onClick={() => onShowToast?.('success', 'Approval Dispatched', 'Dual-custody sign-off confirmed for Apex.')}
                    className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg text-[11px]"
                  >
                    Sign &amp; Approve
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 7-Pillar Health Score Breakdown Across Tenants */}
          <div className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-white pb-3 border-b border-[#1e293b]">
              7-Pillar Cross-Tenant Average Health Metrics
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs text-center">
              <div className="p-3 bg-[#182234] rounded-xl border border-red-500/30">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Security</p>
                <p className="text-lg font-black text-red-400 mt-1">94.2%</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Zero Trust</p>
              </div>

              <div className="p-3 bg-[#182234] rounded-xl border border-purple-500/30">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Governance</p>
                <p className="text-lg font-black text-purple-400 mt-1">88.5%</p>
                <p className="text-[10px] text-slate-500 mt-0.5">PIM &amp; CA</p>
              </div>

              <div className="p-3 bg-[#182234] rounded-xl border border-blue-500/30">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Compliance</p>
                <p className="text-lg font-black text-blue-400 mt-1">92.0%</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Purview</p>
              </div>

              <div className="p-3 bg-[#182234] rounded-xl border border-emerald-500/30">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Adoption</p>
                <p className="text-lg font-black text-emerald-400 mt-1">90.1%</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Usage</p>
              </div>

              <div className="p-3 bg-[#182234] rounded-xl border border-amber-500/30">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Copilot AI</p>
                <p className="text-lg font-black text-amber-400 mt-1">86.4%</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Readiness</p>
              </div>

              <div className="p-3 bg-[#182234] rounded-xl border border-cyan-500/30">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Architecture</p>
                <p className="text-lg font-black text-cyan-400 mt-1">93.8%</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Topology</p>
              </div>

              <div className="p-3 bg-[#182234] rounded-xl border border-indigo-500/30">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Licensing</p>
                <p className="text-lg font-black text-indigo-400 mt-1">97.5%</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Optimization</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 3: CLIENT PORTFOLIO & MARGIN MATRIX   */}
      {/* ========================================== */}
      {activeTab === 'portfolio' && (
        <div className="space-y-6">
          <div className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-[#1e293b]">
              <div>
                <h3 className="text-base font-bold text-white">Client Portfolio &amp; Account Margin Matrix</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  High-density per-tenant profitability breakdown, COGS, AI spend, and margin inspection
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-[220px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={portfolioSearch}
                    onChange={(e) => setPortfolioSearch(e.target.value)}
                    placeholder="Search tenant or domain..."
                    className="w-full bg-[#182234] border border-[#26354f] rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#0078D4]"
                  />
                </div>

                <select
                  value={marginFilter}
                  onChange={(e) => setMarginFilter(e.target.value as any)}
                  className="bg-[#182234] border border-[#26354f] rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#0078D4]"
                >
                  <option value="all">All Profit Margins</option>
                  <option value="high">High Margin (&gt;=60%)</option>
                  <option value="mid">Mid Margin (50-60%)</option>
                  <option value="low">Low Margin (&lt;50%)</option>
                </select>
              </div>
            </div>

            {/* High Density Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#1e293b] text-slate-400 text-[10px] uppercase font-bold">
                    <th className="py-2.5 px-3">Tenant Account</th>
                    <th className="py-2.5 px-3">Tier</th>
                    <th className="py-2.5 px-3 text-right">Seats</th>
                    <th className="py-2.5 px-3 text-right">Contracted MRR</th>
                    <th className="py-2.5 px-3 text-right">COGS</th>
                    <th className="py-2.5 px-3 text-right">AI Token Spend</th>
                    <th className="py-2.5 px-3 text-right">Add-On Margin</th>
                    <th className="py-2.5 px-3 text-right">Micro-Trans YTD</th>
                    <th className="py-2.5 px-3 text-center">Net Margin</th>
                    <th className="py-2.5 px-3 text-center">Health</th>
                    <th className="py-2.5 px-3 text-center">Direct Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e293b]/60">
                  {filteredPortfolio.map((item) => (
                    <tr key={item.tenantId} className="hover:bg-[#182234]/50 transition-colors">
                      <td className="py-3 px-3">
                        <p className="font-bold text-slate-100">{item.tenantName}</p>
                        <p className="text-[10px] text-slate-500">{item.domain}</p>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded text-[10px] font-bold border',
                            item.tier === 'Platinum Enterprise'
                              ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                              : item.tier === 'Gold Managed'
                              ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                              : 'bg-slate-500/20 text-slate-300 border-slate-500/30'
                          )}
                        >
                          {item.tier}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-semibold text-slate-200">{item.seatCount}</td>
                      <td className="py-3 px-3 text-right font-black text-emerald-400">
                        ${item.grossMrr.toLocaleString()}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-300">${item.cogs.toLocaleString()}</td>
                      <td className="py-3 px-3 text-right text-amber-400 font-medium">${item.aiSpend}</td>
                      <td className="py-3 px-3 text-right text-purple-400 font-medium">${item.addOnMargin}</td>
                      <td className="py-3 px-3 text-right text-cyan-400 font-medium">${item.microTransYtd}</td>
                      <td className="py-3 px-3 text-center">
                        <span
                          className={cn(
                            'px-2.5 py-1 rounded-full text-xs font-black border',
                            item.netMarginPercent >= 60
                              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                              : item.netMarginPercent >= 50
                              ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                              : 'bg-red-500/20 text-red-400 border-red-500/30'
                          )}
                        >
                          {item.netMarginPercent}%
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center font-bold text-slate-200">
                        {item.healthScore}%
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setSelectedInspectTenant(item)}
                            className="px-2.5 py-1 bg-[#182234] hover:bg-[#202e46] text-cyan-400 border border-[#26354f] rounded-lg text-[11px] font-bold transition-all"
                          >
                            Inspect P&amp;L
                          </button>
                          <button
                            onClick={() => {
                              setSelectedAdjustTenant(item);
                              setBundleAdjustment({ addIntuneSeats: 0, addSocSeats: 0, addPimSeats: 0, addBackupSeats: 0 });
                            }}
                            className="px-2.5 py-1 bg-[#0078D4]/20 hover:bg-[#0078D4]/40 text-[#38BDF8] border border-[#0078D4]/30 rounded-lg text-[11px] font-bold transition-all"
                          >
                            Adjust Bundle
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

      {/* ========================================== */}
      {/* MODAL 1: ADD MICRO-TRANSACTION MODAL       */}
      {/* ========================================== */}
      {isAddMicroModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#111726] border border-[#1e293b] rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#1e293b]">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">Log One-Time Micro-Transaction</h3>
              </div>
              <button
                onClick={() => setIsAddMicroModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddMicroTransaction} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 font-bold mb-1">Select Tenant</label>
                <select
                  value={newMicroForm.tenantName}
                  onChange={(e) => setNewMicroForm({ ...newMicroForm, tenantName: e.target.value })}
                  className="w-full bg-[#182234] border border-[#26354f] rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-[#0078D4]"
                >
                  {portfolio.map((p) => (
                    <option key={p.tenantId} value={p.tenantName}>
                      {p.tenantName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1">Line Item Title / Charge Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Emergency Break-Glass IR Retainer"
                  value={newMicroForm.title}
                  onChange={(e) => setNewMicroForm({ ...newMicroForm, title: e.target.value })}
                  className="w-full bg-[#182234] border border-[#26354f] rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-[#0078D4]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Category</label>
                  <select
                    value={newMicroForm.category}
                    onChange={(e) =>
                      setNewMicroForm({
                        ...newMicroForm,
                        category: e.target.value as MicroTransaction['category'],
                      })
                    }
                    className="w-full bg-[#182234] border border-[#26354f] rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-[#0078D4]"
                  >
                    <option value="emergency_ir">Emergency IR</option>
                    <option value="onboarding_fee">Onboarding Setup</option>
                    <option value="migration">Migration</option>
                    <option value="custom_script">Custom Scripting</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-bold mb-1">Amount ($ USD)</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={newMicroForm.amount}
                    onChange={(e) => setNewMicroForm({ ...newMicroForm, amount: Number(e.target.value) })}
                    className="w-full bg-[#182234] border border-[#26354f] rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-[#0078D4]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1">Assigned Lead / Technician</label>
                <input
                  type="text"
                  value={newMicroForm.assignedTech}
                  onChange={(e) => setNewMicroForm({ ...newMicroForm, assignedTech: e.target.value })}
                  className="w-full bg-[#182234] border border-[#26354f] rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-[#0078D4]"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1">Scope &amp; Description</label>
                <textarea
                  rows={2}
                  value={newMicroForm.description}
                  onChange={(e) => setNewMicroForm({ ...newMicroForm, description: e.target.value })}
                  placeholder="Details regarding work performed..."
                  className="w-full bg-[#182234] border border-[#26354f] rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-[#0078D4]"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddMicroModalOpen(false)}
                  className="px-4 py-2 bg-[#182234] text-slate-300 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg"
                >
                  Record Charge
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL 2: INSPECT TENANT P&L STATEMENT     */}
      {/* ========================================== */}
      {selectedInspectTenant && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#111726] border border-[#1e293b] rounded-3xl p-6 max-w-2xl w-full shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#1e293b]">
              <div>
                <span className="text-[10px] font-bold uppercase text-[#38BDF8]">
                  {selectedInspectTenant.tier} P&amp;L Statement
                </span>
                <h3 className="text-lg font-bold text-white">{selectedInspectTenant.tenantName}</h3>
                <p className="text-xs text-slate-400">{selectedInspectTenant.domain}</p>
              </div>

              <button
                onClick={() => setSelectedInspectTenant(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-[#182234] rounded-xl border border-[#26354f]">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Gross MRR</p>
                <p className="text-base font-extrabold text-emerald-400 mt-0.5">
                  ${selectedInspectTenant.grossMrr.toLocaleString()}
                </p>
              </div>

              <div className="p-3 bg-[#182234] rounded-xl border border-[#26354f]">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Vendor COGS</p>
                <p className="text-base font-extrabold text-slate-200 mt-0.5">
                  ${selectedInspectTenant.cogs.toLocaleString()}
                </p>
              </div>

              <div className="p-3 bg-[#182234] rounded-xl border border-[#26354f]">
                <p className="text-[10px] font-bold text-slate-400 uppercase">AI Token Cost</p>
                <p className="text-base font-extrabold text-amber-400 mt-0.5">
                  ${selectedInspectTenant.aiSpend}
                </p>
              </div>

              <div className="p-3 bg-[#182234] rounded-xl border border-[#26354f]">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Net Margin %</p>
                <p className="text-base font-extrabold text-purple-400 mt-0.5">
                  {selectedInspectTenant.netMarginPercent}%
                </p>
              </div>
            </div>

            {/* Breakdown List */}
            <div className="space-y-2 text-xs">
              <h4 className="font-bold text-slate-300">Revenue &amp; Margin Breakdown</h4>
              <div className="p-3 bg-[#182234] rounded-xl border border-[#26354f] space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">Seat Retainer ({selectedInspectTenant.seatCount} seats):</span>
                  <span className="font-bold text-slate-200">
                    ${(selectedInspectTenant.grossMrr - selectedInspectTenant.addOnMargin).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Managed Add-Ons Revenue:</span>
                  <span className="font-bold text-purple-400">
                    +${selectedInspectTenant.addOnMargin.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Micro-Transactions (YTD):</span>
                  <span className="font-bold text-cyan-400">
                    +${selectedInspectTenant.microTransYtd.toLocaleString()}
                  </span>
                </div>
                <div className="pt-2 border-t border-[#26354f] flex justify-between font-bold text-sm">
                  <span className="text-slate-200">Net Monthly Account Profit:</span>
                  <span className="text-emerald-400">
                    +$
                    {(
                      selectedInspectTenant.grossMrr -
                      selectedInspectTenant.cogs -
                      selectedInspectTenant.aiSpend
                    ).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedInspectTenant(null)}
                className="px-4 py-2 bg-[#0078D4] text-white font-bold rounded-xl text-xs"
              >
                Close P&amp;L Statement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL 3: ADJUST BUNDLE SIMULATION MODAL   */}
      {/* ========================================== */}
      {selectedAdjustTenant && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#111726] border border-[#1e293b] rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#1e293b]">
              <div>
                <span className="text-[10px] font-bold uppercase text-[#38BDF8]">Bundle Simulator</span>
                <h3 className="text-base font-bold text-white">Adjust Bundle: {selectedAdjustTenant.tenantName}</h3>
              </div>
              <button
                onClick={() => setSelectedAdjustTenant(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <p className="text-slate-300">
                Simulate adding managed service add-ons to immediately recalculate contracted MRR &amp; account profitability.
              </p>

              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-[#182234] rounded-xl border border-[#26354f]">
                  <div>
                    <p className="font-bold text-slate-100">24/7 SOC Defender ($8.00 margin/seat)</p>
                    <p className="text-[10px] text-slate-400">24/7 Threat Hunting &amp; Incident Triage</p>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={bundleAdjustment.addSocSeats}
                    onChange={(e) =>
                      setBundleAdjustment({ ...bundleAdjustment, addSocSeats: Number(e.target.value) })
                    }
                    placeholder="0 seats"
                    className="w-20 bg-[#111726] border border-[#26354f] rounded-lg px-2 py-1 text-right text-emerald-400 font-bold focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-[#182234] rounded-xl border border-[#26354f]">
                  <div>
                    <p className="font-bold text-slate-100">Intune MDM ($4.00 margin/seat)</p>
                    <p className="text-[10px] text-slate-400">Device Compliance &amp; Autopilot Policy</p>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={bundleAdjustment.addIntuneSeats}
                    onChange={(e) =>
                      setBundleAdjustment({ ...bundleAdjustment, addIntuneSeats: Number(e.target.value) })
                    }
                    placeholder="0 seats"
                    className="w-20 bg-[#111726] border border-[#26354f] rounded-lg px-2 py-1 text-right text-emerald-400 font-bold focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-[#182234] rounded-xl border border-[#26354f]">
                  <div>
                    <p className="font-bold text-slate-100">PIM Governance ($3.50 margin/seat)</p>
                    <p className="text-[10px] text-slate-400">Privileged Identity Dual-Sign Approvals</p>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={bundleAdjustment.addPimSeats}
                    onChange={(e) =>
                      setBundleAdjustment({ ...bundleAdjustment, addPimSeats: Number(e.target.value) })
                    }
                    placeholder="0 seats"
                    className="w-20 bg-[#111726] border border-[#26354f] rounded-lg px-2 py-1 text-right text-emerald-400 font-bold focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-[#182234] rounded-xl border border-[#26354f]">
                  <div>
                    <p className="font-bold text-slate-100">Cloud Backup ($2.50 margin/seat)</p>
                    <p className="text-[10px] text-slate-400">Immutable Exchange &amp; OneDrive Backups</p>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={bundleAdjustment.addBackupSeats}
                    onChange={(e) =>
                      setBundleAdjustment({ ...bundleAdjustment, addBackupSeats: Number(e.target.value) })
                    }
                    placeholder="0 seats"
                    className="w-20 bg-[#111726] border border-[#26354f] rounded-lg px-2 py-1 text-right text-emerald-400 font-bold focus:outline-none"
                  />
                </div>
              </div>

              {/* Calculated Add-On Margin */}
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-between font-bold">
                <span className="text-emerald-400">Added Monthly Margin:</span>
                <span className="text-emerald-400 text-sm">
                  +$
                  {(
                    bundleAdjustment.addSocSeats * 8 +
                    bundleAdjustment.addIntuneSeats * 4 +
                    bundleAdjustment.addPimSeats * 3.5 +
                    bundleAdjustment.addBackupSeats * 2.5
                  ).toFixed(2)}{' '}
                  / mo
                </span>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  onClick={() => setSelectedAdjustTenant(null)}
                  className="px-4 py-2 bg-[#182234] text-slate-300 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveBundleAdjustment}
                  className="px-4 py-2 bg-[#0078D4] hover:bg-[#005a9e] text-white font-bold rounded-xl shadow-lg"
                >
                  Save &amp; Recalculate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 4: CROSS-CUSTOMER OFFER & REVENUE ROLLUP */}
      {/* ========================================== */}
      {activeTab === 'offer_rollup' && (
        <div className="space-y-6">
          {/* TOP BANNER / MONETIZATION HERO */}
          <div className="bg-[#111726] rounded-2xl border border-amber-500/30 p-6 shadow-2xl relative overflow-hidden bg-gradient-to-r from-[#111726] via-[#161d2d] to-[#111c2e]">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
              <div className="space-y-2">
                <div className="flex items-center gap-2.5">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                    Monetization &amp; Value Engine
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    Cross-Customer Portfolio Rollup
                  </span>
                </div>
                <h2 className="text-xl font-black text-white flex items-center gap-2">
                  <span>How Much Money Can I Make Across My Customers?</span>
                  <span className="text-amber-400 text-sm font-mono font-normal">(${offerMetrics.totalMargin.toLocaleString()} Net Margin)</span>
                </h2>
                <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
                  Aggregated cross-tenant catalog of available security projects, compliance binders, micro-fix runbooks, and license step-ups open for client proposals. Each offer outlines wholesale vendor spend vs retail pricing and details the concrete protection value provided to your customers.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleProposeAllHighMargin}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-lg flex items-center gap-2 transition-all cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>Dispatch Proposals for All Open Offers</span>
                </button>
                <button
                  onClick={handleExportPdf}
                  className="px-4 py-2.5 rounded-xl bg-[#182234] hover:bg-[#1e2d45] text-slate-200 border border-[#26354f] font-bold text-xs flex items-center gap-2 transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4 text-cyan-400" />
                  <span>Export Monetization Deck</span>
                </button>
              </div>
            </div>

            {/* KPI METRICS ROW FOR OFFERS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6 pt-6 border-t border-[#1e293b]">
              <div className="bg-[#0b0f19]/80 p-4 rounded-xl border border-[#1e293b]">
                <div className="text-[10px] font-mono font-bold uppercase text-slate-400">Total Open Retail Potential</div>
                <div className="text-2xl font-black text-white mt-1">${offerMetrics.totalRetail.toLocaleString()}</div>
                <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                  <ShoppingBag className="w-3.5 h-3.5 text-amber-400" />
                  <span>{crossOffers.length} Open Customer Packages</span>
                </div>
              </div>

              <div className="bg-[#0b0f19]/80 p-4 rounded-xl border border-[#1e293b]">
                <div className="text-[10px] font-mono font-bold uppercase text-slate-400">Total Wholesale COGS</div>
                <div className="text-2xl font-black text-slate-300 mt-1">${offerMetrics.totalWholesale.toLocaleString()}</div>
                <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                  <Receipt className="w-3.5 h-3.5 text-blue-400" />
                  <span>Pax8 / TD Synnex Vendor Cost</span>
                </div>
              </div>

              <div className="bg-[#0b0f19]/80 p-4 rounded-xl border border-emerald-500/30">
                <div className="text-[10px] font-mono font-bold uppercase text-emerald-400">Total Net Margin Potential</div>
                <div className="text-2xl font-black text-emerald-400 mt-1">+${offerMetrics.totalMargin.toLocaleString()}</div>
                <div className="text-[11px] text-emerald-300 mt-1 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>{offerMetrics.marginPercent}% Gross Profit Margin</span>
                </div>
              </div>

              <div className="bg-[#0b0f19]/80 p-4 rounded-xl border border-[#1e293b]">
                <div className="text-[10px] font-mono font-bold uppercase text-slate-400">Client Proposal Pipeline</div>
                <div className="text-2xl font-black text-cyan-400 mt-1">
                  {offerMetrics.proposedCount} Dispatched / {offerMetrics.availableCount} Open
                </div>
                <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{offerMetrics.acceptedCount} Executed Deals</span>
                </div>
              </div>
            </div>
          </div>

          {/* 4 CATEGORY BREAKDOWN CARDS */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* PROJECTS */}
            <div
              onClick={() => setOfferTypeFilter(offerTypeFilter === 'project' ? 'all' : 'project')}
              className={cn(
                "p-4 rounded-2xl border transition-all cursor-pointer space-y-3 relative overflow-hidden",
                offerTypeFilter === 'project'
                  ? "bg-purple-950/40 border-purple-500 shadow-lg shadow-purple-500/10"
                  : "bg-[#111726] border-[#1e293b] hover:border-purple-500/50"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    <Briefcase className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">Projects</h3>
                    <span className="text-[10px] text-slate-400">{typeBreakdown.project.count} Available Projects</span>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded border border-purple-500/30">
                  63% Margin
                </span>
              </div>
              <div className="space-y-1">
                <div className="text-xl font-extrabold text-white">${typeBreakdown.project.retail.toLocaleString()} <span className="text-xs font-normal text-slate-400">Retail</span></div>
                <div className="text-xs text-purple-300 font-bold">Wholesale: ${typeBreakdown.project.wholesale.toLocaleString()} | Margin: <span className="text-emerald-400">+${typeBreakdown.project.margin.toLocaleString()}</span></div>
              </div>
              <p className="text-[11px] text-slate-400 leading-normal">
                Autopilot migrations, PIM dual-custody architecture, Purview DLP overhauls, and Defender server hardening.
              </p>
            </div>

            {/* DOCUMENTS */}
            <div
              onClick={() => setOfferTypeFilter(offerTypeFilter === 'document' ? 'all' : 'document')}
              className={cn(
                "p-4 rounded-2xl border transition-all cursor-pointer space-y-3 relative overflow-hidden",
                offerTypeFilter === 'document'
                  ? "bg-cyan-950/40 border-cyan-500 shadow-lg shadow-cyan-500/10"
                  : "bg-[#111726] border-[#1e293b] hover:border-cyan-500/50"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">Documents &amp; Binders</h3>
                    <span className="text-[10px] text-slate-400">{typeBreakdown.document.count} Available Binders</span>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded border border-cyan-500/30">
                  86% Margin
                </span>
              </div>
              <div className="space-y-1">
                <div className="text-xl font-extrabold text-white">${typeBreakdown.document.retail.toLocaleString()} <span className="text-xs font-normal text-slate-400">Retail</span></div>
                <div className="text-xs text-cyan-300 font-bold">Wholesale: ${typeBreakdown.document.wholesale.toLocaleString()} | Margin: <span className="text-emerald-400">+${typeBreakdown.document.margin.toLocaleString()}</span></div>
              </div>
              <p className="text-[11px] text-slate-400 leading-normal">
                Board CISO decks, SOC2/HIPAA audit evidence binders, NIST CMMC SSP packages, and cyber insurance proofs.
              </p>
            </div>

            {/* MICRO-OFFERS */}
            <div
              onClick={() => setOfferTypeFilter(offerTypeFilter === 'micro_offer' ? 'all' : 'micro_offer')}
              className={cn(
                "p-4 rounded-2xl border transition-all cursor-pointer space-y-3 relative overflow-hidden",
                offerTypeFilter === 'micro_offer'
                  ? "bg-amber-950/40 border-amber-500 shadow-lg shadow-amber-500/10"
                  : "bg-[#111726] border-[#1e293b] hover:border-amber-500/50"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">Micro-Offers</h3>
                    <span className="text-[10px] text-slate-400">{typeBreakdown.micro_offer.count} Instant Fixes</span>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded border border-amber-500/30">
                  87% Margin
                </span>
              </div>
              <div className="space-y-1">
                <div className="text-xl font-extrabold text-white">${typeBreakdown.micro_offer.retail.toLocaleString()} <span className="text-xs font-normal text-slate-400">Retail</span></div>
                <div className="text-xs text-amber-300 font-bold">Wholesale: ${typeBreakdown.micro_offer.wholesale.toLocaleString()} | Margin: <span className="text-emerald-400">+${typeBreakdown.micro_offer.margin.toLocaleString()}</span></div>
              </div>
              <p className="text-[11px] text-slate-400 leading-normal">
                Graph API MFA auto-fix, stale app consent revocations, inactive license sweeps, and legacy auth blocks.
              </p>
            </div>

            {/* UPGRADES / MRR */}
            <div
              onClick={() => setOfferTypeFilter(offerTypeFilter === 'upgrade' ? 'all' : 'upgrade')}
              className={cn(
                "p-4 rounded-2xl border transition-all cursor-pointer space-y-3 relative overflow-hidden",
                offerTypeFilter === 'upgrade'
                  ? "bg-emerald-950/40 border-emerald-500 shadow-lg shadow-emerald-500/10"
                  : "bg-[#111726] border-[#1e293b] hover:border-emerald-500/50"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <Package className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">Upgrades (MRR)</h3>
                    <span className="text-[10px] text-slate-400">{typeBreakdown.upgrade.count} License Upgrades</span>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">
                  Monthly MRR
                </span>
              </div>
              <div className="space-y-1">
                <div className="text-xl font-extrabold text-white">${typeBreakdown.upgrade.retail.toLocaleString()} <span className="text-xs font-normal text-slate-400">/ mo Retail</span></div>
                <div className="text-xs text-emerald-300 font-bold">Wholesale: ${typeBreakdown.upgrade.wholesale.toLocaleString()} /mo | Margin: <span className="text-emerald-400">+${typeBreakdown.upgrade.margin.toLocaleString()}/mo MRR</span></div>
              </div>
              <p className="text-[11px] text-slate-400 leading-normal">
                Business Premium step-ups, Defender for Server add-ons, Entra ID P2 C-suite, and Purview retainers.
              </p>
            </div>
          </div>

          {/* CUSTOMER MONETIZATION LEADERBOARD ("MONEY ON THE TABLE BY CUSTOMER") */}
          <div className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#1e293b]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-500/15 rounded-xl border border-amber-500/30">
                  <DollarSign className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Top Customer Revenue Expansion Opportunities</h3>
                  <p className="text-xs text-slate-400">Untapped margin potential ready to propose per account</p>
                </div>
              </div>
              <span className="text-xs text-amber-400 font-mono font-bold bg-amber-950/60 px-3 py-1 rounded-full border border-amber-500/30">
                Sorted by Available Profit
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {customerLeaderboard.map((cust) => (
                <div
                  key={cust.tenantId}
                  className="p-3.5 rounded-xl bg-[#182234] border border-[#26354f] hover:border-amber-500/40 transition-all flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-xs font-extrabold text-white">{cust.tenantName}</h4>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">{cust.domain} ({cust.openCount} Open Offers)</p>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
                      +${cust.totalProfit.toLocaleString()} Net Profit
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-300 font-mono bg-[#0b0f19] p-2 rounded border border-[#202b3c]">
                    <span>Retail: <strong className="text-white">${cust.totalRetail.toLocaleString()}</strong></span>
                    <span>Wholesale: <strong className="text-slate-400">${cust.totalWholesale.toLocaleString()}</strong></span>
                  </div>

                  <button
                    onClick={() => handleProposeAllForTenant(cust.tenantId, cust.tenantName)}
                    className="w-full text-xs font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 p-2 rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Dispatch Proposal Quote to {cust.tenantName.split(' ')[0]}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* MAIN OFFERS EXPLORER TABLE & CARDS */}
          <div className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl space-y-4">
            {/* SEARCH AND FILTERS TOOLBAR */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#1e293b]">
              <div className="flex flex-wrap items-center gap-2">
                {/* Search Bar */}
                <div className="relative min-w-[240px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={offerSearch}
                    onChange={(e) => setOfferSearch(e.target.value)}
                    placeholder="Search offer code, title, customer, value..."
                    className="w-full bg-[#182234] border border-[#26354f] rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#0078D4]"
                  />
                </div>

                {/* Offer Type Dropdown */}
                <div className="flex items-center bg-[#182234] p-1 rounded-xl border border-[#26354f] text-xs">
                  <button
                    onClick={() => setOfferTypeFilter('all')}
                    className={cn(
                      'px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer',
                      offerTypeFilter === 'all' ? 'bg-[#0078D4] text-white' : 'text-slate-400 hover:text-white'
                    )}
                  >
                    All ({crossOffers.length})
                  </button>
                  <button
                    onClick={() => setOfferTypeFilter('project')}
                    className={cn(
                      'px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer',
                      offerTypeFilter === 'project' ? 'bg-[#0078D4] text-white' : 'text-slate-400 hover:text-white'
                    )}
                  >
                    Projects
                  </button>
                  <button
                    onClick={() => setOfferTypeFilter('document')}
                    className={cn(
                      'px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer',
                      offerTypeFilter === 'document' ? 'bg-[#0078D4] text-white' : 'text-slate-400 hover:text-white'
                    )}
                  >
                    Documents
                  </button>
                  <button
                    onClick={() => setOfferTypeFilter('micro_offer')}
                    className={cn(
                      'px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer',
                      offerTypeFilter === 'micro_offer' ? 'bg-[#0078D4] text-white' : 'text-slate-400 hover:text-white'
                    )}
                  >
                    Micro-Fixes
                  </button>
                  <button
                    onClick={() => setOfferTypeFilter('upgrade')}
                    className={cn(
                      'px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer',
                      offerTypeFilter === 'upgrade' ? 'bg-[#0078D4] text-white' : 'text-slate-400 hover:text-white'
                    )}
                  >
                    Upgrades (MRR)
                  </button>
                </div>
              </div>

              {/* Status Filter & View Mode */}
              <div className="flex items-center gap-3">
                <select
                  value={offerStatusFilter}
                  onChange={(e) => setOfferStatusFilter(e.target.value)}
                  className="bg-[#182234] border border-[#26354f] rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
                >
                  <option value="all">All Statuses</option>
                  <option value="available">Available to Propose</option>
                  <option value="proposed">Quote Sent</option>
                  <option value="accepted">Accepted / Executed</option>
                </select>

                <div className="flex items-center bg-[#182234] p-1 rounded-xl border border-[#26354f]">
                  <button
                    onClick={() => setOfferLayoutMode('table')}
                    className={cn(
                      'p-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer',
                      offerLayoutMode === 'table' ? 'bg-[#0078D4] text-white' : 'text-slate-400 hover:text-white'
                    )}
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setOfferLayoutMode('cards')}
                    className={cn(
                      'p-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer',
                      offerLayoutMode === 'cards' ? 'bg-[#0078D4] text-white' : 'text-slate-400 hover:text-white'
                    )}
                  >
                    <Layers className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* OFFERS TABLE OR CARDS DISPLAY */}
            {offerLayoutMode === 'table' ? (
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[900px]">
                  <thead>
                    <tr className="border-b border-[#1e293b] text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                      <th className="py-3 px-3">Offer Code &amp; Title</th>
                      <th className="py-3 px-3">Customer Tenant</th>
                      <th className="py-3 px-3">Customer Value &amp; Protection Provided</th>
                      <th className="py-3 px-3 text-right">Wholesale Spend</th>
                      <th className="py-3 px-3 text-right">Retail Revenue</th>
                      <th className="py-3 px-3 text-right">Net MSP Profit</th>
                      <th className="py-3 px-3 text-center">Status</th>
                      <th className="py-3 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e293b] text-xs">
                    {filteredOffers.map((item) => {
                      const margin = item.retailPrice - item.wholesaleCost;
                      const marginPct = ((margin / item.retailPrice) * 100).toFixed(0);

                      return (
                        <tr key={item.id} className="hover:bg-[#182234]/50 transition-colors">
                          <td className="py-3.5 px-3">
                            <div className="flex items-start gap-2">
                              {renderOfferTypeBadge(item.offerType)}
                              <div>
                                <button
                                  onClick={() => setSelectedInspectOffer(item)}
                                  className="font-bold text-white hover:text-amber-300 text-left transition flex items-center gap-1.5 cursor-pointer"
                                >
                                  <span>{item.title}</span>
                                </button>
                                <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                  {item.code} | Category: <span className="text-cyan-300">{item.category}</span>
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-3.5 px-3">
                            <div className="font-bold text-slate-200">{item.tenantName}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{item.domain}</div>
                          </td>

                          <td className="py-3.5 px-3 max-w-sm">
                            <div className="p-2 rounded-lg bg-emerald-950/20 border border-emerald-500/20 text-[11px] text-emerald-200/90 leading-relaxed">
                              {item.customerValueProtection}
                            </div>
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono text-slate-400">
                            ${item.wholesaleCost.toLocaleString()}
                            {item.revenueType === 'mrr' && '/mo'}
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono font-bold text-white">
                            ${item.retailPrice.toLocaleString()}
                            {item.revenueType === 'mrr' && '/mo'}
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono">
                            <span className="font-bold text-emerald-400">+${margin.toLocaleString()}{item.revenueType === 'mrr' && '/mo'}</span>
                            <span className="block text-[10px] text-emerald-300/80 font-normal">({marginPct}% margin)</span>
                          </td>

                          <td className="py-3.5 px-3 text-center">
                            {renderOfferStatusBadge(item.status)}
                          </td>

                          <td className="py-3.5 px-3 text-right space-x-2">
                            {item.status === 'available' && (
                              <button
                                onClick={() => handleProposeOffer(item.id)}
                                className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold text-xs transition cursor-pointer"
                              >
                                Send Quote
                              </button>
                            )}
                            {item.status === 'proposed' && (
                              <span className="text-[11px] text-cyan-400 font-mono">
                                Quote Sent
                              </span>
                            )}
                            {item.status === 'accepted' && (
                              <span className="text-[11px] text-emerald-400 font-mono">
                                Executed
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              /* CARDS GRID DISPLAY */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredOffers.map((item) => {
                  const margin = item.retailPrice - item.wholesaleCost;
                  const marginPct = ((margin / item.retailPrice) * 100).toFixed(0);

                  return (
                    <div
                      key={item.id}
                      className="p-4 rounded-2xl bg-[#182234] border border-[#26354f] hover:border-amber-500/40 transition-all flex flex-col justify-between space-y-3"
                    >
                      <div className="flex items-start justify-between">
                        {renderOfferTypeBadge(item.offerType)}
                        {renderOfferStatusBadge(item.status)}
                      </div>

                      <div>
                        <span className="text-[10px] font-mono text-cyan-400 uppercase">{item.code} | {item.category}</span>
                        <h4 className="text-sm font-extrabold text-white mt-0.5">{item.title}</h4>
                        <p className="text-xs text-slate-400 mt-1">{item.description}</p>
                      </div>

                      <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-200">
                        <strong className="block text-[10px] text-emerald-400 uppercase font-mono mb-0.5">Customer Value Provided:</strong>
                        {item.customerValueProtection}
                      </div>

                      <div className="p-3 rounded-xl bg-[#0b0f19] border border-[#202b3c] flex items-center justify-between text-xs font-mono">
                        <div>
                          <span className="text-slate-400 text-[10px] block">Wholesale Spend</span>
                          <span className="text-slate-300 font-bold">${item.wholesaleCost.toLocaleString()}{item.revenueType === 'mrr' && '/mo'}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-slate-400 text-[10px] block">Retail Price</span>
                          <span className="text-white font-bold">${item.retailPrice.toLocaleString()}{item.revenueType === 'mrr' && '/mo'}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-emerald-400 text-[10px] block">Net Margin</span>
                          <span className="text-emerald-400 font-extrabold">+${margin.toLocaleString()} ({marginPct}%)</span>
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-between border-t border-[#26354f]">
                        <span className="text-xs text-slate-300 font-bold">{item.tenantName}</span>
                        {item.status === 'available' && (
                          <button
                            onClick={() => handleProposeOffer(item.id)}
                            className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition cursor-pointer flex items-center gap-1"
                          >
                            <Send className="w-3.5 h-3.5" /> Send Quote
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* INSPECT OFFER DETAILS MODAL */}
      {selectedInspectOffer && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111726] border border-[#26354f] rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl relative">
            <button
              onClick={() => setSelectedInspectOffer(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {renderOfferTypeBadge(selectedInspectOffer.offerType)}
                {renderOfferStatusBadge(selectedInspectOffer.status)}
              </div>
              <h3 className="text-lg font-extrabold text-white">{selectedInspectOffer.title}</h3>
              <p className="text-xs text-slate-400 font-mono">
                {selectedInspectOffer.code} | Tenant: <strong className="text-white">{selectedInspectOffer.tenantName}</strong> ({selectedInspectOffer.domain})
              </p>
            </div>

            <div className="p-3 bg-[#182234] rounded-xl border border-[#26354f] space-y-1 text-xs">
              <span className="text-slate-400 text-[10px] font-mono uppercase">Offer Description</span>
              <p className="text-slate-200">{selectedInspectOffer.description}</p>
            </div>

            <div className="p-3 bg-emerald-950/30 border border-emerald-500/30 rounded-xl space-y-1 text-xs">
              <span className="text-emerald-400 text-[10px] font-mono uppercase font-bold">Why This Betters The Customer:</span>
              <p className="text-emerald-200">{selectedInspectOffer.customerValueProtection}</p>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center text-xs font-mono">
              <div className="p-3 bg-[#0b0f19] rounded-xl border border-[#202b3c]">
                <span className="text-slate-400 text-[10px]">Wholesale Cost</span>
                <p className="text-slate-200 font-bold mt-1">${selectedInspectOffer.wholesaleCost.toLocaleString()}</p>
              </div>
              <div className="p-3 bg-[#0b0f19] rounded-xl border border-[#202b3c]">
                <span className="text-slate-400 text-[10px]">Retail Revenue</span>
                <p className="text-white font-bold mt-1">${selectedInspectOffer.retailPrice.toLocaleString()}</p>
              </div>
              <div className="p-3 bg-emerald-950/40 rounded-xl border border-emerald-500/30">
                <span className="text-emerald-400 text-[10px]">MSP Profit</span>
                <p className="text-emerald-400 font-black mt-1">+${(selectedInspectOffer.retailPrice - selectedInspectOffer.wholesaleCost).toLocaleString()}</p>
              </div>
            </div>

            {selectedInspectOffer.matchedSopOrTemplate && (
              <div className="p-2.5 bg-[#182234] rounded-xl text-xs text-slate-300 font-mono flex items-center justify-between">
                <span>Execution Runbook / SOP:</span>
                <span className="text-cyan-300 font-bold">{selectedInspectOffer.matchedSopOrTemplate}</span>
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setSelectedInspectOffer(null)}
                className="px-4 py-2 bg-[#182234] text-slate-300 font-bold rounded-xl text-xs cursor-pointer"
              >
                Close
              </button>
              {selectedInspectOffer.status === 'available' && (
                <button
                  onClick={() => {
                    handleProposeOffer(selectedInspectOffer.id);
                    setSelectedInspectOffer(null);
                  }}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg cursor-pointer flex items-center gap-1.5"
                >
                  <Send className="w-4 h-4" /> Dispatch Quote to {selectedInspectOffer.tenantName.split(' ')[0]}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OwnerExecutiveConsole;

