import React, { useState, useMemo } from 'react';
import {
  FileText,
  FolderOpen,
  Search,
  Filter,
  Tag,
  Eye,
  Download,
  Share2,
  Send,
  ExternalLink,
  Cloud,
  Calendar,
  Building2,
  CheckCircle2,
  Lock,
  ShieldCheck,
  Layers,
  MoreVertical,
  RefreshCw,
  SlidersHorizontal,
  Plus,
  Copy,
  Check,
  Sparkles,
  Clock,
  X,
  FileCode,
  Trash2,
  Users,
  Printer,
  FileCheck,
  Globe,
  HardDrive,
  KeyRound,
  Mail,
  Ticket,
  Maximize2,
  ShieldAlert,
  ArrowUpRight,
  TrendingUp,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tenant } from '../../types';

export interface GeneratedDocument {
  id: string;
  title: string;
  version: string;
  fileType: 'pdf' | 'docx' | 'json';
  fileSize: string;
  tenantId: string;
  tenantName: string;
  tenantDomain: string;
  category:
    | 'QBR Reports'
    | 'SOWs & Agreements'
    | 'Executive Health Audits'
    | 'License Optimization'
    | 'Security Compliance (CIS)'
    | 'User Offboarding Logs';
  tags: string[];
  visibility: 'internal' | 'published';
  sharePointSync: boolean;
  lastSyncedAt?: string;
  createdAt: string;
  relativeTime: string;
  author: string;
  shareUrl: string;
  summary: string;
  previewMetrics?: { label: string; value: string; color?: string }[];
}

interface DocumentLibraryConsoleProps {
  tenants?: Tenant[];
  selectedTenant?: Tenant | null;
  onSelectTenant?: (tenant: Tenant | null) => void;
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
}

const INITIAL_DOCUMENTS: GeneratedDocument[] = [
  {
    id: 'doc-qbr-2026-q2',
    title: 'Contoso Q2 2026 Executive Quarterly Business Review (QBR)',
    version: 'v2.1',
    fileType: 'pdf',
    fileSize: '4.8 MB',
    tenantId: 'contoso-tenant-01',
    tenantName: 'Contoso Corporation',
    tenantDomain: 'contoso.onmicrosoft.com',
    category: 'QBR Reports',
    tags: ['QBR', 'Contoso', 'HighPriority', 'Executive', 'SharePoint-Synced'],
    visibility: 'published',
    sharePointSync: true,
    lastSyncedAt: '12 mins ago',
    createdAt: '2026-07-23 18:30',
    relativeTime: '2 hours ago',
    author: 'm.vance@msp-global.com',
    shareUrl: 'https://portal.msp.com/share/doc_qbr_2026_q2_981a',
    summary:
      'Executive summary of M365 infrastructure performance, security score milestones (+14%), active threat remediations, and 2026 Q3 technology roadmap.',
    previewMetrics: [
      { label: 'Secure Score', value: '84 / 100', color: 'text-[#4ade80]' },
      { label: 'Cost Waste Reclaimed', value: '$3,420 / yr', color: 'text-[#a3c9ff]' },
      { label: 'Threats Defeated', value: '142 Incidents', color: 'text-purple-300' },
    ],
  },
  {
    id: 'doc-cis-benchmark-v8',
    title: 'M365 Tenant CIS Controls v8 Security Compliance Audit',
    version: 'v1.4',
    fileType: 'pdf',
    fileSize: '8.2 MB',
    tenantId: 'contoso-tenant-01',
    tenantName: 'Contoso Corporation',
    tenantDomain: 'contoso.onmicrosoft.com',
    category: 'Security Compliance (CIS)',
    tags: ['CMMC', 'CIS-v8', 'Contoso', 'Security', 'SharePoint-Synced'],
    visibility: 'published',
    sharePointSync: true,
    lastSyncedAt: '35 mins ago',
    createdAt: '2026-07-23 14:15',
    relativeTime: '6 hours ago',
    author: 'sec-ops@msp-global.com',
    shareUrl: 'https://portal.msp.com/share/doc_cis_benchmark_44b1',
    summary:
      'Comprehensive CIS Microsoft 365 Foundations Benchmark evaluation including Conditional Access gaps, Defender P2 policies, and Exchange mail flow rules.',
    previewMetrics: [
      { label: 'CIS Pass Rate', value: '91.4%', color: 'text-[#4ade80]' },
      { label: 'Gaps Found', value: '3 Controls', color: 'text-amber-300' },
      { label: 'MFA Coverage', value: '98.5%', color: 'text-[#a3c9ff]' },
    ],
  },
  {
    id: 'doc-sow-m365-e5-upgrade',
    title: 'Statement of Work: M365 E5 Copilot & Purview Deployment',
    version: 'v1.0',
    fileType: 'pdf',
    fileSize: '2.1 MB',
    tenantId: 'fabrikam-tenant-02',
    tenantName: 'Fabrikam Inc',
    tenantDomain: 'fabrikam.onmicrosoft.com',
    category: 'SOWs & Agreements',
    tags: ['SOW', 'Fabrikam', 'Legal', 'Contract'],
    visibility: 'internal',
    sharePointSync: false,
    createdAt: '2026-07-22 11:00',
    relativeTime: '1 day ago',
    author: 'legal@msp-global.com',
    shareUrl: 'https://portal.msp.com/share/doc_sow_e5_fabrikam_001a',
    summary:
      'Scope of Work detailing baseline data loss prevention rule creation, Sensitivity Label taxonomies, and Microsoft 365 Copilot readiness onboarding.',
    previewMetrics: [
      { label: 'Contract Value', value: '$24,500', color: 'text-[#4ade80]' },
      { label: 'Timeline', value: '6 Weeks', color: 'text-[#a3c9ff]' },
      { label: 'Target Seats', value: '450 Users', color: 'text-purple-300' },
    ],
  },
  {
    id: 'doc-lic-optimization-q2',
    title: 'Enterprise License SKU Optimization & Waste Reduction Report',
    version: 'v1.2',
    fileType: 'pdf',
    fileSize: '3.4 MB',
    tenantId: 'contoso-tenant-01',
    tenantName: 'Contoso Corporation',
    tenantDomain: 'contoso.onmicrosoft.com',
    category: 'License Optimization',
    tags: ['LicenseAudit', 'Contoso', 'CostSavings', 'SharePoint-Synced'],
    visibility: 'published',
    sharePointSync: true,
    lastSyncedAt: '2 hours ago',
    createdAt: '2026-07-21 09:30',
    relativeTime: '2 days ago',
    author: 'billing@msp-global.com',
    shareUrl: 'https://portal.msp.com/share/doc_lic_opt_contoso_98',
    summary:
      'Detailed audit of unassigned M365 E5 seats, inactive user accounts >60 days, and overlapping add-on licenses with actionable downgrade options.',
    previewMetrics: [
      { label: 'Annual Waste', value: '$3,420 / yr', color: 'text-red-400' },
      { label: 'Unused Seats', value: '28 Seats', color: 'text-amber-300' },
      { label: 'Potential Return', value: '$12,800', color: 'text-[#4ade80]' },
    ],
  },
  {
    id: 'doc-offboarding-audit-jdoe',
    title: 'User Offboarding & Data Retention Log: John Doe (UPN: jdoe@northwind.com)',
    version: 'v1.0',
    fileType: 'json',
    fileSize: '420 KB',
    tenantId: 'northwind-tenant-03',
    tenantName: 'Northwind Traders',
    tenantDomain: 'northwind.onmicrosoft.com',
    category: 'User Offboarding Logs',
    tags: ['Offboarding', 'Northwind', 'AuditLog', 'JSON', 'GDPR'],
    visibility: 'internal',
    sharePointSync: true,
    lastSyncedAt: '1 day ago',
    createdAt: '2026-07-20 16:45',
    relativeTime: '3 days ago',
    author: 'automations@msp-global.com',
    shareUrl: 'https://portal.msp.com/share/doc_offboarding_jdoe_json',
    summary:
      'Machine-readable JSON execution transcript for automated user offboarding: MFA revoked, active sessions killed, OneDrive transferred, mailbox converted to shared.',
    previewMetrics: [
      { label: 'Tasks Executed', value: '12 / 12', color: 'text-[#4ade80]' },
      { label: 'Duration', value: '42 seconds', color: 'text-[#a3c9ff]' },
      { label: 'OneDrive Backup', value: '14.2 GB', color: 'text-purple-300' },
    ],
  },
  {
    id: 'doc-health-audit-woodgrove',
    title: 'Woodgrove Bank M365 Infrastructure Executive Health Audit',
    version: 'v3.0',
    fileType: 'pdf',
    fileSize: '6.5 MB',
    tenantId: 'woodgrove-tenant-04',
    tenantName: 'Woodgrove Bank',
    tenantDomain: 'woodgrove.onmicrosoft.com',
    category: 'Executive Health Audits',
    tags: ['Executive', 'Woodgrove', 'HealthAudit', 'HighPriority'],
    visibility: 'published',
    sharePointSync: true,
    lastSyncedAt: '4 hours ago',
    createdAt: '2026-07-19 10:15',
    relativeTime: '4 days ago',
    author: 'a.stone@msp-global.com',
    shareUrl: 'https://portal.msp.com/share/doc_woodgrove_health_q2',
    summary:
      'Multi-pillar tenant review across Exchange Online, Entra ID, Defender XDR, and SharePoint Online governance. Includes compliance scoring for FSI requirements.',
    previewMetrics: [
      { label: 'Health Score', value: '92 / 100', color: 'text-[#4ade80]' },
      { label: 'Uptime SLA', value: '99.99%', color: 'text-[#a3c9ff]' },
      { label: 'Drift Alerts', value: '0 Active', color: 'text-[#4ade80]' },
    ],
  },
  {
    id: 'doc-sow-defender-p2',
    title: 'SOW: Defender XDR & Sentinel Automated SOC Integration',
    version: 'v1.1',
    fileType: 'docx',
    fileSize: '1.8 MB',
    tenantId: 'contoso-tenant-01',
    tenantName: 'Contoso Corporation',
    tenantDomain: 'contoso.onmicrosoft.com',
    category: 'SOWs & Agreements',
    tags: ['SOW', 'Defender', 'Contoso', 'SOC'],
    visibility: 'internal',
    sharePointSync: false,
    createdAt: '2026-07-18 15:00',
    relativeTime: '5 days ago',
    author: 'p.miller@msp-global.com',
    shareUrl: 'https://portal.msp.com/share/doc_sow_defender_contoso',
    summary:
      'Agreement for deploying Defender for Endpoint, Defender for Identity, and connecting Microsoft Sentinel workspace for automated remediation playbooks.',
    previewMetrics: [
      { label: 'Scope', value: '1,200 Endpoints', color: 'text-[#a3c9ff]' },
      { label: 'SLA Response', value: '15 Mins', color: 'text-[#4ade80]' },
    ],
  },
  {
    id: 'doc-qbr-adventureworks',
    title: 'AdventureWorks Q2 Technology Review & Copilot Benchmark',
    version: 'v1.0',
    fileType: 'pdf',
    fileSize: '5.1 MB',
    tenantId: 'adventureworks-tenant-05',
    tenantName: 'AdventureWorks',
    tenantDomain: 'adventureworks.onmicrosoft.com',
    category: 'QBR Reports',
    tags: ['QBR', 'AdventureWorks', 'Copilot', 'SharePoint-Synced'],
    visibility: 'published',
    sharePointSync: true,
    lastSyncedAt: '1 day ago',
    createdAt: '2026-07-17 12:20',
    relativeTime: '6 days ago',
    author: 'm.vance@msp-global.com',
    shareUrl: 'https://portal.msp.com/share/doc_qbr_adventureworks_2026',
    summary:
      'Quarterly client report evaluating M365 active user engagement, Teams phone usage, and Microsoft 365 Copilot prompt adoption trends.',
    previewMetrics: [
      { label: 'Copilot Users', value: '120 Active', color: 'text-purple-300' },
      { label: 'Time Saved', value: '4.2 hrs / wk', color: 'text-[#4ade80]' },
    ],
  },
  {
    id: 'doc-offboarding-audit-msmith',
    title: 'User Offboarding Audit: Mary Smith (UPN: msmith@fabrikam.com)',
    version: 'v1.0',
    fileType: 'pdf',
    fileSize: '1.1 MB',
    tenantId: 'fabrikam-tenant-02',
    tenantName: 'Fabrikam Inc',
    tenantDomain: 'fabrikam.onmicrosoft.com',
    category: 'User Offboarding Logs',
    tags: ['Offboarding', 'Fabrikam', 'AuditLog', 'HR'],
    visibility: 'published',
    sharePointSync: true,
    lastSyncedAt: '2 days ago',
    createdAt: '2026-07-16 09:10',
    relativeTime: '1 week ago',
    author: 'automations@msp-global.com',
    shareUrl: 'https://portal.msp.com/share/doc_offboarding_msmith_pdf',
    summary:
      'Executive signed certificate of user access revocation and mailbox PST archive export per Fabrikam compliance policy.',
    previewMetrics: [
      { label: 'Compliance Status', value: 'Verified', color: 'text-[#4ade80]' },
      { label: 'Mailbox Archive', value: '38.4 GB', color: 'text-[#a3c9ff]' },
    ],
  },
  {
    id: 'doc-cis-benchmark-woodgrove',
    title: 'Woodgrove Bank FSI Regulatory Compliance Matrix (CIS & NIST 800-171)',
    version: 'v2.0',
    fileType: 'pdf',
    fileSize: '9.4 MB',
    tenantId: 'woodgrove-tenant-04',
    tenantName: 'Woodgrove Bank',
    tenantDomain: 'woodgrove.onmicrosoft.com',
    category: 'Security Compliance (CIS)',
    tags: ['NIST', 'CIS-v8', 'Woodgrove', 'Compliance', 'FSI'],
    visibility: 'published',
    sharePointSync: true,
    lastSyncedAt: '3 days ago',
    createdAt: '2026-07-15 14:00',
    relativeTime: '1 week ago',
    author: 'sec-ops@msp-global.com',
    shareUrl: 'https://portal.msp.com/share/doc_woodgrove_fsi_matrix',
    summary:
      'Detailed regulatory mapping between Microsoft Purview DLP controls, Entra ID Conditional Access rules, and NIST 800-171 standards.',
    previewMetrics: [
      { label: 'NIST Score', value: '96.2%', color: 'text-[#4ade80]' },
      { label: 'Audited Rules', value: '184 Items', color: 'text-[#a3c9ff]' },
    ],
  },
];

export const DocumentLibraryConsole: React.FC<DocumentLibraryConsoleProps> = ({
  tenants = [],
  selectedTenant,
  onSelectTenant,
  onShowToast,
}) => {
  // Main State
  const [documents, setDocuments] = useState<GeneratedDocument[]>(INITIAL_DOCUMENTS);
  const [selectedDocId, setSelectedDocId] = useState<string>(INITIAL_DOCUMENTS[0].id);

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [tenantFilter, setTenantFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All Types');
  const [visibilityFilter, setVisibilityFilter] = useState('All');
  const [dateRangeFilter, setDateRangeFilter] = useState('All Time');
  const [activeTags, setActiveTags] = useState<string[]>([]);

  // Delivery & Delivery Sub-Tab State
  const [deliveryTab, setDeliveryTab] = useState<'share' | 'sharepoint' | 'psa'>('share');

  // Share Link Settings State
  const [passwordProtected, setPasswordProtected] = useState(true);
  const [sharePassword, setSharePassword] = useState('M365-MspDoc-2026!');
  const [shareExpiration, setShareExpiration] = useState('2026-08-30');
  const [accessLimit, setAccessLimit] = useState(50);
  const [copiedLink, setCopiedLink] = useState(false);

  // PSA & Dispatch Form State
  const [recipientUpn, setRecipientUpn] = useState('client.admin@contoso.com');
  const [psaTicketRef, setPsaTicketRef] = useState('CW-982104');
  const [customNote, setCustomNote] = useState(
    'Hello, attached is your updated M365 Governance & Security Compliance deliverable.'
  );

  // Modals State
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isFullscreenPreviewOpen, setIsFullscreenPreviewOpen] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  // New Document Form State
  const [newDocTenantId, setNewDocTenantId] = useState('contoso-tenant-01');
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocCategory, setNewDocCategory] = useState<GeneratedDocument['category']>('QBR Reports');
  const [newDocType, setNewDocType] = useState<'pdf' | 'docx' | 'json'>('pdf');
  const [newDocVisibility, setNewDocVisibility] = useState<'internal' | 'published'>('published');
  const [newDocAutoSync, setNewDocAutoSync] = useState(true);

  // Active Selected Document
  const selectedDoc = useMemo(() => {
    return documents.find((d) => d.id === selectedDocId) || documents[0];
  }, [documents, selectedDocId]);

  // Available Tags in dataset
  const allAvailableTags = useMemo(() => {
    const set = new Set<string>();
    documents.forEach((d) => d.tags.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [documents]);

  // Filtered Documents Calculation
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = doc.title.toLowerCase().includes(q);
        const matchesTenant = doc.tenantName.toLowerCase().includes(q) || doc.tenantDomain.toLowerCase().includes(q);
        const matchesAuthor = doc.author.toLowerCase().includes(q);
        const matchesTags = doc.tags.some((t) => t.toLowerCase().includes(q));
        if (!matchesTitle && !matchesTenant && !matchesAuthor && !matchesTags) return false;
      }

      // 2. Tenant Filter
      if (tenantFilter !== 'All') {
        if (doc.tenantId !== tenantFilter && doc.tenantName !== tenantFilter) return false;
      }

      // 3. Category Filter
      if (categoryFilter !== 'All Types' && doc.category !== categoryFilter) return false;

      // 4. Visibility Filter
      if (visibilityFilter === 'Internal Only' && doc.visibility !== 'internal') return false;
      if (visibilityFilter === 'Published to Client Portal' && doc.visibility !== 'published') return false;

      // 5. Active Tags
      if (activeTags.length > 0) {
        const hasAllTags = activeTags.every((t) => doc.tags.includes(t));
        if (!hasAllTags) return false;
      }

      return true;
    });
  }, [documents, searchQuery, tenantFilter, categoryFilter, visibilityFilter, activeTags]);

  // Metrics Calculations
  const metrics = useMemo(() => {
    const total = documents.length;
    const published = documents.filter((d) => d.visibility === 'published').length;
    const synced = documents.filter((d) => d.sharePointSync).length;
    const syncRate = total > 0 ? ((synced / total) * 100).toFixed(1) : '100';

    return {
      totalDocs: '1,284 Docs',
      publishedDocs: `${published} / ${total} Public`,
      sharePointSyncRate: `${syncRate}% Synced`,
      storageUsage: '14.2 GB / 100 GB',
    };
  }, [documents]);

  // Action Handlers
  const handleToggleTag = (tag: string) => {
    if (activeTags.includes(tag)) {
      setActiveTags(activeTags.filter((t) => t !== tag));
    } else {
      setActiveTags([...activeTags, tag]);
    }
  };

  const handleCopyShareLink = () => {
    if (selectedDoc) {
      navigator.clipboard.writeText(selectedDoc.shareUrl);
      setCopiedLink(true);
      onShowToast?.('success', 'Share Link Copied', 'Tokenized secure URL copied to clipboard.');
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  const handleForceSharePointSync = (doc: GeneratedDocument) => {
    setDocuments((prev) =>
      prev.map((d) =>
        d.id === doc.id
          ? { ...d, sharePointSync: true, lastSyncedAt: 'Just now' }
          : d
      )
    );
    onShowToast?.(
      'success',
      'SharePoint Graph API Sync Complete',
      `Pushed ${doc.title} to tenant's SharePoint site (/sites/MSP-Governance).`
    );
  };

  const handleBatchSharePointSync = () => {
    setIsSyncingAll(true);
    setTimeout(() => {
      setDocuments((prev) =>
        prev.map((d) => ({ ...d, sharePointSync: true, lastSyncedAt: 'Just now' }))
      );
      setIsSyncingAll(false);
      onShowToast?.(
        'success',
        'Batch Sync Completed',
        `All ${documents.length} deliverables synced to customer SharePoint libraries.`
      );
    }, 1200);
  };

  const handleExportCSV = () => {
    onShowToast?.(
      'info',
      'Exporting Library Index',
      'Generating CSV metadata manifest for 1,284 generated documents...'
    );
  };

  const handleSendViaPsa = (e: React.FormEvent) => {
    e.preventDefault();
    onShowToast?.(
      'success',
      'Document Dispatched to Client Contact',
      `Delivered "${selectedDoc?.title}" to ${recipientUpn} (Ticket Ref: ${psaTicketRef}).`
    );
  };

  const handleCreateNewDocument = (e: React.FormEvent) => {
    e.preventDefault();
    const t = tenants.find((tenant) => tenant.id === newDocTenantId) || {
      id: 'contoso-tenant-01',
      name: 'Contoso Corporation',
      primaryDomain: 'contoso.onmicrosoft.com',
    };

    const docName = newDocTitle.trim() || `${t.name} ${newDocCategory} Deliverable`;

    const newDoc: GeneratedDocument = {
      id: `doc-gen-${Date.now()}`,
      title: docName,
      version: 'v1.0',
      fileType: newDocType,
      fileSize: newDocType === 'json' ? '320 KB' : '3.6 MB',
      tenantId: t.id,
      tenantName: t.name,
      tenantDomain: (t as any).primaryDomain || `${t.name.toLowerCase().replace(/\s+/g, '')}.onmicrosoft.com`,
      category: newDocCategory,
      tags: [newDocCategory.split(' ')[0], t.name.split(' ')[0], 'Generated', 'GraphAPI'],
      visibility: newDocVisibility,
      sharePointSync: newDocAutoSync,
      lastSyncedAt: newDocAutoSync ? 'Just now' : undefined,
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      relativeTime: 'Just now',
      author: 'admin@msp-global.com',
      shareUrl: `https://portal.msp.com/share/doc_gen_${Math.floor(Math.random() * 89999 + 10000)}`,
      summary: `Automated ${newDocCategory} generated via Microsoft Graph API integration for ${t.name}. Includes executive analysis, compliance score cards, and actionable remediation tasks.`,
      previewMetrics: [
        { label: 'Status', value: 'Generated', color: 'text-[#4ade80]' },
        { label: 'Format', value: newDocType.toUpperCase(), color: 'text-[#a3c9ff]' },
        { label: 'SharePoint', value: newDocAutoSync ? 'Synced' : 'Pending', color: newDocAutoSync ? 'text-[#4ade80]' : 'text-amber-300' },
      ],
    };

    setDocuments([newDoc, ...documents]);
    setSelectedDocId(newDoc.id);
    setIsGenerateModalOpen(false);
    setNewDocTitle('');
    onShowToast?.('success', 'Document Generated Successfully', `Created "${docName}" for ${t.name}.`);
  };

  const handleDeleteDocument = (docId: string, title: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
    if (selectedDocId === docId) {
      const remaining = documents.filter((d) => d.id !== docId);
      if (remaining.length > 0) setSelectedDocId(remaining[0].id);
    }
    onShowToast?.('info', 'Document Removed', `Deleted "${title}" from MSP Document Library.`);
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-[#e0e2ea] font-sans overflow-y-auto select-none">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & LIBRARY METRICS BAR (FULL WIDTH) */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] p-4 sm:p-5 shrink-0 shadow-sm">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          
          {/* Title & Scope */}
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded bg-[#101419] border border-[#404752] text-[#a3c9ff]">
              <FolderOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-[#e0e2ea] tracking-tight">
                  Multi-Tenant Document Library & Deliverables
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#0078d4]/10 text-[#a3c9ff] border border-[#0078d4]/30 font-semibold">
                  /portal/documents
                </span>
              </div>
              <p className="text-xs text-[#8a919e] mt-0.5">
                Centralized MSP repository for QBR reports, CIS compliance audits, SOWs, and automated offboarding transcripts.
              </p>
            </div>
          </div>

          {/* Library Overview Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 xl:w-auto">
            {/* Metric 1 */}
            <div className="bg-[#101419] border border-[#404752] px-3 py-2 rounded text-xs space-y-0.5">
              <div className="text-[10.5px] font-semibold text-[#8a919e] uppercase tracking-wider flex items-center gap-1">
                <FileText className="w-3 h-3 text-[#a3c9ff]" />
                <span>Generated</span>
              </div>
              <div className="text-sm font-bold text-[#e0e2ea] font-mono">{metrics.totalDocs}</div>
            </div>

            {/* Metric 2 */}
            <div className="bg-[#101419] border border-[#404752] px-3 py-2 rounded text-xs space-y-0.5">
              <div className="text-[10.5px] font-semibold text-[#8a919e] uppercase tracking-wider flex items-center gap-1">
                <Globe className="w-3 h-3 text-[#4ade80]" />
                <span>Client Published</span>
              </div>
              <div className="text-sm font-bold text-[#4ade80] font-mono">{metrics.publishedDocs}</div>
            </div>

            {/* Metric 3 */}
            <div className="bg-[#101419] border border-[#404752] px-3 py-2 rounded text-xs space-y-0.5">
              <div className="text-[10.5px] font-semibold text-[#8a919e] uppercase tracking-wider flex items-center gap-1">
                <Cloud className="w-3 h-3 text-[#a3c9ff]" />
                <span>SharePoint Sync</span>
              </div>
              <div className="text-sm font-bold text-[#a3c9ff] font-mono">{metrics.sharePointSyncRate}</div>
            </div>

            {/* Metric 4 */}
            <div className="bg-[#101419] border border-[#404752] px-3 py-2 rounded text-xs space-y-0.5">
              <div className="text-[10.5px] font-semibold text-[#8a919e] uppercase tracking-wider flex items-center gap-1">
                <HardDrive className="w-3 h-3 text-purple-300" />
                <span>Storage Used</span>
              </div>
              <div className="text-sm font-bold text-purple-300 font-mono">{metrics.storageUsage}</div>
            </div>
          </div>

          {/* Header Action Controls */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <button
              onClick={() => setIsGenerateModalOpen(true)}
              className="px-3 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
            >
              <Plus className="w-4 h-4 text-white" />
              <span>Generate New Document</span>
            </button>

            <button
              onClick={handleBatchSharePointSync}
              disabled={isSyncingAll}
              className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#a3c9ff] ${isSyncingAll ? 'animate-spin' : ''}`} />
              <span>{isSyncingAll ? 'Syncing...' : 'Batch SharePoint Sync'}</span>
            </button>

            <button
              onClick={handleExportCSV}
              className="px-2.5 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
              title="Export Library Index CSV"
            >
              <Download className="w-3.5 h-3.5 text-[#8a919e]" />
              <span className="hidden sm:inline">Export Index</span>
            </button>
          </div>

        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-4">

        {/* ========================================================================= */}
        {/* 2. SEARCH, FILTER & TAGGING TOOLBAR (STICKY ROW) */}
        {/* ========================================================================= */}
        <div className="bg-[#181c22] border border-[#404752] rounded-md p-3 space-y-2.5 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
            
            {/* Search Bar (5 Cols) */}
            <div className="md:col-span-5 relative">
              <Search className="w-4 h-4 text-[#8a919e] absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Search document title, target tenant, file name, UPN, or tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#101419] border border-[#404752] rounded pl-8 pr-8 py-1.5 text-xs text-[#e0e2ea] placeholder-[#8a919e] focus:outline-none focus:border-[#0078d4]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-[#8a919e] hover:text-[#e0e2ea]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Tenant Picker Filter (3 Cols) */}
            <div className="md:col-span-3">
              <select
                value={tenantFilter}
                onChange={(e) => setTenantFilter(e.target.value)}
                className="w-full bg-[#101419] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4] cursor-pointer"
              >
                <option value="All">All Managed Tenants</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.primaryDomain})
                  </option>
                ))}
              </select>
            </div>

            {/* Category / Type Filter (2 Cols) */}
            <div className="md:col-span-2">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full bg-[#101419] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4] cursor-pointer"
              >
                <option value="All Types">All Document Types</option>
                <option value="QBR Reports">QBR Reports</option>
                <option value="SOWs & Agreements">SOWs & Agreements</option>
                <option value="Executive Health Audits">Executive Health Audits</option>
                <option value="License Optimization">License Optimization</option>
                <option value="Security Compliance (CIS)">Security Compliance (CIS)</option>
                <option value="User Offboarding Logs">User Offboarding Logs</option>
              </select>
            </div>

            {/* Visibility Tier (2 Cols) */}
            <div className="md:col-span-2">
              <select
                value={visibilityFilter}
                onChange={(e) => setVisibilityFilter(e.target.value)}
                className="w-full bg-[#101419] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4] cursor-pointer"
              >
                <option value="All">All Visibilities</option>
                <option value="Published to Client Portal">🟢 Client Published</option>
                <option value="Internal Only">🔒 Internal Only</option>
              </select>
            </div>

          </div>

          {/* Active Tags Ribbon */}
          <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-[#404752]/60 text-xs">
            <span className="text-[#8a919e] font-semibold text-[11px] flex items-center gap-1 mr-1">
              <Tag className="w-3 h-3 text-[#a3c9ff]" />
              <span>Tag Filters:</span>
            </span>

            {allAvailableTags.map((tag) => {
              const isSelected = activeTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => handleToggleTag(tag)}
                  className={cn(
                    'px-2 py-0.5 rounded text-[10.5px] font-mono transition-all cursor-pointer flex items-center gap-1',
                    isSelected
                      ? 'bg-[#0078d4] text-white border border-[#0078d4]'
                      : 'bg-[#101419] text-[#8a919e] hover:text-[#e0e2ea] border border-[#404752]'
                  )}
                >
                  <span>#{tag}</span>
                  {isSelected && <X className="w-3 h-3 text-white" />}
                </button>
              );
            })}

            {activeTags.length > 0 && (
              <button
                onClick={() => setActiveTags([])}
                className="text-[10.5px] text-[#a3c9ff] hover:underline cursor-pointer ml-auto font-semibold"
              >
                Clear all tags ({activeTags.length})
              </button>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 3. MAIN CONTENT SPLIT-PANE INTERFACE (60% LIST VIEW | 40% LIVE PREVIEW) */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">

          {/* LEFT PANE (60% / 7 COLS): Sortable Document Directory Table */}
          <div className="lg:col-span-7 bg-[#181c22] border border-[#404752] rounded-md shadow-sm overflow-hidden flex flex-col">
            
            {/* Table Header Controls */}
            <div className="p-3 bg-[#101419] border-b border-[#404752] flex items-center justify-between text-xs">
              <div className="font-bold text-[#e0e2ea] flex items-center gap-2">
                <span>Document Directory</span>
                <span className="px-2 py-0.5 rounded bg-[#272a30] text-[#a3c9ff] font-mono text-[10.5px]">
                  {filteredDocuments.length} matching
                </span>
              </div>
              <span className="text-[11px] text-[#8a919e]">Click row to inspect preview</span>
            </div>

            {/* Scrollable Table Container */}
            <div className="overflow-x-auto max-h-[720px] scrollbar-thin">
              <table className="w-full text-left text-xs text-[#e0e2ea] border-collapse">
                <thead className="bg-[#101419] text-[#8a919e] uppercase font-semibold text-[10.5px] tracking-wider sticky top-0 z-10 border-b border-[#404752]">
                  <tr>
                    <th className="py-2.5 px-3">Type & Title</th>
                    <th className="py-2.5 px-3">Target Tenant</th>
                    <th className="py-2.5 px-3 hidden sm:table-cell">Category</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 hidden md:table-cell">Created</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#404752]">
                  {filteredDocuments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-[#8a919e]">
                        <FileText className="w-8 h-8 text-[#404752] mx-auto mb-2" />
                        <p className="font-semibold text-xs">No documents match the current filters.</p>
                        <button
                          onClick={() => {
                            setSearchQuery('');
                            setTenantFilter('All');
                            setCategoryFilter('All Types');
                            setVisibilityFilter('All');
                            setActiveTags([]);
                          }}
                          className="mt-2 text-xs text-[#0078d4] hover:underline font-semibold cursor-pointer"
                        >
                          Reset all filters
                        </button>
                      </td>
                    </tr>
                  ) : (
                    filteredDocuments.map((doc) => {
                      const isSelected = doc.id === selectedDoc.id;
                      return (
                        <tr
                          key={doc.id}
                          onClick={() => setSelectedDocId(doc.id)}
                          className={cn(
                            'transition-colors cursor-pointer group',
                            isSelected
                              ? 'bg-[#0078d4]/15 border-l-2 border-l-[#0078d4]'
                              : 'hover:bg-[#272a30]/50'
                          )}
                        >
                          {/* Title & File Type Badge */}
                          <td className="py-2.5 px-3">
                            <div className="flex items-start gap-2">
                              <span
                                className={cn(
                                  'px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase shrink-0 mt-0.5',
                                  doc.fileType === 'pdf'
                                    ? 'bg-red-950/60 text-red-300 border border-red-800/80'
                                    : doc.fileType === 'docx'
                                    ? 'bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40'
                                    : 'bg-emerald-950/60 text-[#4ade80] border border-[#166534]'
                                )}
                              >
                                {doc.fileType}
                              </span>
                              <div className="min-w-0">
                                <div
                                  className={cn(
                                    'font-semibold line-clamp-1 text-xs',
                                    isSelected ? 'text-[#a3c9ff]' : 'text-[#e0e2ea] group-hover:text-[#a3c9ff]'
                                  )}
                                >
                                  {doc.title}
                                </div>
                                <div className="text-[10px] font-mono text-[#8a919e] flex items-center gap-2 mt-0.5">
                                  <span>{doc.version}</span>
                                  <span>•</span>
                                  <span>{doc.fileSize}</span>
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Target Tenant */}
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-xs text-[#e0e2ea] truncate max-w-[130px]">
                              {doc.tenantName}
                            </div>
                            <div className="text-[10px] text-[#8a919e] font-mono truncate max-w-[130px]">
                              {doc.tenantDomain}
                            </div>
                          </td>

                          {/* Category & Tags */}
                          <td className="py-2.5 px-3 hidden sm:table-cell">
                            <span className="px-2 py-0.5 rounded bg-[#101419] border border-[#404752] text-[10.5px] text-[#a3c9ff] font-semibold block w-max">
                              {doc.category}
                            </span>
                          </td>

                          {/* Visibility & Sync Status */}
                          <td className="py-2.5 px-3">
                            <div className="flex flex-col gap-1 items-start">
                              {doc.visibility === 'published' ? (
                                <span className="px-1.5 py-0.5 rounded bg-[#166534]/30 text-[#4ade80] border border-[#166534] text-[9.5px] font-semibold flex items-center gap-1">
                                  <Globe className="w-2.5 h-2.5" /> Published
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded bg-[#272a30] text-[#8a919e] border border-[#404752] text-[9.5px] font-semibold flex items-center gap-1">
                                  <Lock className="w-2.5 h-2.5" /> Internal
                                </span>
                              )}

                              {doc.sharePointSync && (
                                <span className="text-[9.5px] text-[#a3c9ff] font-mono flex items-center gap-0.5">
                                  <Cloud className="w-2.5 h-2.5 text-[#0078d4]" /> Synced
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Generated Date */}
                          <td className="py-2.5 px-3 hidden md:table-cell">
                            <div className="text-xs text-[#e0e2ea]">{doc.relativeTime}</div>
                            <div className="text-[10px] text-[#8a919e] font-mono">{doc.createdAt.split(' ')[0]}</div>
                          </td>

                          {/* Row Actions */}
                          <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => setSelectedDocId(doc.id)}
                                className="p-1 rounded bg-[#272a30] hover:bg-[#31353b] text-[#a3c9ff] cursor-pointer"
                                title="Inspect Preview"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleForceSharePointSync(doc)}
                                className="p-1 rounded bg-[#272a30] hover:bg-[#31353b] text-[#4ade80] cursor-pointer"
                                title="Sync to SharePoint"
                              >
                                <Cloud className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteDocument(doc.id, doc.title)}
                                className="p-1 rounded bg-[#272a30] hover:bg-[#93000a]/30 text-red-400 cursor-pointer"
                                title="Delete document"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
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

            {/* Footer Summary */}
            <div className="p-2.5 bg-[#101419] border-t border-[#404752] text-[11px] text-[#8a919e] flex items-center justify-between">
              <span>Showing {filteredDocuments.length} of {documents.length} documents</span>
              <span className="font-mono text-[#a3c9ff]">Managed Scope: All GDAP Tenants</span>
            </div>
          </div>

          {/* RIGHT PANE (40% / 5 COLS): Interactive Document Preview & Delivery Hub */}
          <div className="lg:col-span-5 space-y-4">

            {/* PREVIEW CONTAINER CARD */}
            <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 shadow-sm space-y-3">
              
              {/* Header Controls */}
              <div className="flex items-start justify-between gap-2 border-b border-[#404752] pb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40 font-mono text-[10px] uppercase font-bold">
                      {selectedDoc.fileType}
                    </span>
                    <span className="text-[10px] font-mono text-[#8a919e] bg-[#101419] px-1.5 py-0.5 rounded border border-[#404752]">
                      {selectedDoc.version}
                    </span>
                    <span className="text-[10px] font-mono text-[#8a919e]">
                      {selectedDoc.fileSize}
                    </span>
                  </div>
                  <h3 className="font-bold text-sm text-[#e0e2ea] mt-1 line-clamp-2">
                    {selectedDoc.title}
                  </h3>
                  <div className="text-[11px] text-[#8a919e] flex items-center gap-1.5 mt-0.5">
                    <Building2 className="w-3 h-3 text-[#a3c9ff]" />
                    <span className="font-semibold text-[#a3c9ff]">{selectedDoc.tenantName}</span>
                    <span>•</span>
                    <span>Authored by {selectedDoc.author.split('@')[0]}</span>
                  </div>
                </div>

                {/* Direct Header Buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setIsFullscreenPreviewOpen(true)}
                    className="p-1.5 rounded bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] cursor-pointer"
                    title="Fullscreen Mode"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-[#a3c9ff]" />
                  </button>
                  <button
                    onClick={() =>
                      onShowToast?.('success', 'Downloading File', `Saved ${selectedDoc.title} to local disk.`)
                    }
                    className="p-1.5 rounded bg-[#0078d4] hover:bg-[#0060ab] text-white cursor-pointer"
                    title="Download File"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Simulated PDF / Document Rendering Window */}
              <div className="bg-[#101419] border border-[#404752] rounded p-4 space-y-3.5 text-xs text-[#e0e2ea] relative overflow-hidden">
                
                {/* Executive Report Header */}
                <div className="bg-[#181c22] border border-[#404752] p-3 rounded flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-mono text-[#8a919e] uppercase tracking-wider font-bold">
                      MSP EXECUTIVE DELIVERABLE
                    </div>
                    <div className="text-xs font-bold text-[#e0e2ea] mt-0.5">{selectedDoc.tenantName}</div>
                  </div>
                  <div className="text-right">
                    <span className="px-2 py-0.5 rounded bg-[#166534]/30 text-[#4ade80] border border-[#166534] text-[10px] font-mono font-bold">
                      VERIFIED GRAPH API
                    </span>
                    <div className="text-[10px] text-[#8a919e] font-mono mt-0.5">{selectedDoc.createdAt}</div>
                  </div>
                </div>

                {/* Preview Key Metrics Grid */}
                {selectedDoc.previewMetrics && (
                  <div className="grid grid-cols-3 gap-2">
                    {selectedDoc.previewMetrics.map((m, idx) => (
                      <div key={idx} className="bg-[#181c22] border border-[#404752] p-2 rounded text-center">
                        <div className="text-[10px] text-[#8a919e] font-semibold uppercase">{m.label}</div>
                        <div className={cn('text-xs font-bold font-mono mt-0.5', m.color || 'text-[#e0e2ea]')}>
                          {m.value}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Document Body Executive Summary */}
                <div className="space-y-2 pt-1">
                  <div className="text-[11px] font-bold text-[#a3c9ff] uppercase tracking-wider flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5" />
                    <span>Executive Summary & Deliverable Abstract</span>
                  </div>
                  <p className="text-xs text-[#8a919e] leading-relaxed bg-[#181c22]/60 p-2.5 rounded border border-[#404752]/60">
                    {selectedDoc.summary}
                  </p>
                </div>

                {/* Simulated Content Table Preview */}
                <div className="space-y-1.5">
                  <div className="text-[10.5px] font-bold text-[#8a919e] uppercase tracking-wider">
                    Evaluated Control Categories
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] bg-[#181c22] px-2.5 py-1 rounded border border-[#404752]">
                      <span className="font-semibold text-[#e0e2ea]">Identity & Conditional Access</span>
                      <span className="text-[#4ade80] font-mono font-bold">Compliant</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] bg-[#181c22] px-2.5 py-1 rounded border border-[#404752]">
                      <span className="font-semibold text-[#e0e2ea]">Exchange & Defender Mail Guard</span>
                      <span className="text-[#4ade80] font-mono font-bold">Compliant</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] bg-[#181c22] px-2.5 py-1 rounded border border-[#404752]">
                      <span className="font-semibold text-[#e0e2ea]">Purview DLP & Sensitivity Taxonomies</span>
                      <span className="text-amber-300 font-mono font-bold">1 Alert</span>
                    </div>
                  </div>
                </div>

                {/* Document Tag Badges */}
                <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-[#404752]">
                  {selectedDoc.tags.map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded bg-[#181c22] border border-[#404752] text-[10px] font-mono text-[#a3c9ff]"
                    >
                      #{t}
                    </span>
                  ))}
                </div>

              </div>

            </div>

            {/* MULTI-TENANT DELIVERY & SHARING PANEL (TABS UNDER PREVIEW) */}
            <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 shadow-sm space-y-3">
              
              {/* Delivery Hub Tab Buttons */}
              <div className="flex items-center gap-1 bg-[#101419] p-1 rounded border border-[#404752] text-xs font-semibold">
                <button
                  onClick={() => setDeliveryTab('share')}
                  className={cn(
                    'flex-1 py-1.5 rounded transition-all cursor-pointer flex items-center justify-center gap-1.5',
                    deliveryTab === 'share'
                      ? 'bg-[#0078d4] text-white shadow-xs'
                      : 'text-[#8a919e] hover:text-[#e0e2ea]'
                  )}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Share Link</span>
                </button>

                <button
                  onClick={() => setDeliveryTab('sharepoint')}
                  className={cn(
                    'flex-1 py-1.5 rounded transition-all cursor-pointer flex items-center justify-center gap-1.5',
                    deliveryTab === 'sharepoint'
                      ? 'bg-[#0078d4] text-white shadow-xs'
                      : 'text-[#8a919e] hover:text-[#e0e2ea]'
                  )}
                >
                  <Cloud className="w-3.5 h-3.5" />
                  <span>SharePoint</span>
                </button>

                <button
                  onClick={() => setDeliveryTab('psa')}
                  className={cn(
                    'flex-1 py-1.5 rounded transition-all cursor-pointer flex items-center justify-center gap-1.5',
                    deliveryTab === 'psa'
                      ? 'bg-[#0078d4] text-white shadow-xs'
                      : 'text-[#8a919e] hover:text-[#e0e2ea]'
                  )}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>PSA & Mail</span>
                </button>
              </div>

              {/* SUB-TAB A: 🌐 Share Link Generator */}
              {deliveryTab === 'share' && (
                <div className="space-y-3 text-xs pt-1">
                  <div>
                    <label className="text-[11px] font-bold text-[#8a919e] uppercase tracking-wider block mb-1">
                      Tokenized Client Portal URL
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={selectedDoc.shareUrl}
                        className="flex-1 bg-[#101419] border border-[#404752] rounded px-2.5 py-1.5 font-mono text-[#a3c9ff] focus:outline-none"
                      />
                      <button
                        onClick={handleCopyShareLink}
                        className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        {copiedLink ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-[#4ade80]" />
                            <span className="text-[#4ade80]">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-[#a3c9ff]" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Protection Controls */}
                  <div className="bg-[#101419] border border-[#404752] p-3 rounded space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <KeyRound className="w-4 h-4 text-amber-300" />
                        <span className="font-semibold text-[#e0e2ea]">Password Protection</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={passwordProtected}
                        onChange={(e) => setPasswordProtected(e.target.checked)}
                        className="w-4 h-4 accent-[#0078d4] cursor-pointer"
                      />
                    </div>

                    {passwordProtected && (
                      <div className="pt-1">
                        <label className="text-[10.5px] text-[#8a919e] block mb-1">Passcode Token</label>
                        <input
                          type="text"
                          value={sharePassword}
                          onChange={(e) => setSharePassword(e.target.value)}
                          className="w-full bg-[#181c22] border border-[#404752] rounded px-2 py-1 text-xs font-mono text-amber-300 focus:outline-none"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="text-[10.5px] text-[#8a919e] block mb-1">Expiration Date</label>
                        <input
                          type="date"
                          value={shareExpiration}
                          onChange={(e) => setShareExpiration(e.target.value)}
                          className="w-full bg-[#181c22] border border-[#404752] rounded px-2 py-1 text-xs text-[#e0e2ea] focus:outline-none cursor-pointer"
                        />
                      </div>
                      <div>
                        <label className="text-[10.5px] text-[#8a919e] block mb-1">Max Download Count</label>
                        <input
                          type="number"
                          value={accessLimit}
                          onChange={(e) => setAccessLimit(Number(e.target.value))}
                          className="w-full bg-[#181c22] border border-[#404752] rounded px-2 py-1 text-xs text-[#e0e2ea] focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SUB-TAB B: ☁️ M365 SharePoint Direct Sync */}
              {deliveryTab === 'sharepoint' && (
                <div className="space-y-3 text-xs pt-1">
                  <div className="bg-[#101419] border border-[#404752] p-3 rounded space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#e0e2ea] flex items-center gap-1.5">
                        <Cloud className="w-4 h-4 text-[#0078d4]" />
                        <span>Target SharePoint Library</span>
                      </span>
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded text-[10px] font-mono font-bold',
                          selectedDoc.sharePointSync
                            ? 'bg-[#166534]/30 text-[#4ade80] border border-[#166534]'
                            : 'bg-amber-950/40 text-amber-300 border border-amber-800/60'
                        )}
                      >
                        {selectedDoc.sharePointSync ? '99.2% Synced' : 'Sync Required'}
                      </span>
                    </div>

                    <p className="text-[11px] text-[#8a919e] font-mono break-all bg-[#181c22] p-2 rounded border border-[#404752]">
                      https://{selectedDoc.tenantDomain}/sites/MSP-Governance/Shared Documents/{selectedDoc.category}
                    </p>

                    <div className="text-[11px] text-[#8a919e] flex items-center justify-between pt-1">
                      <span>Status: {selectedDoc.lastSyncedAt ? `Last synced ${selectedDoc.lastSyncedAt} via Graph API` : 'Not synced'}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleForceSharePointSync(selectedDoc)}
                    className="w-full py-2 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Force Direct Graph API Re-Sync</span>
                  </button>
                </div>
              )}

              {/* SUB-TAB C: 🎫 PSA & Email Delivery */}
              {deliveryTab === 'psa' && (
                <form onSubmit={handleSendViaPsa} className="space-y-2.5 text-xs pt-1">
                  <div>
                    <label className="text-[10.5px] text-[#8a919e] font-semibold block mb-1">Recipient Contact UPN</label>
                    <input
                      type="email"
                      required
                      value={recipientUpn}
                      onChange={(e) => setRecipientUpn(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10.5px] text-[#8a919e] font-semibold block mb-1">PSA Ticket Ref</label>
                      <input
                        type="text"
                        required
                        value={psaTicketRef}
                        onChange={(e) => setPsaTicketRef(e.target.value)}
                        className="w-full bg-[#101419] border border-[#404752] rounded px-2.5 py-1.5 text-xs font-mono text-[#a3c9ff] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10.5px] text-[#8a919e] font-semibold block mb-1">Target Tenant</label>
                      <input
                        type="text"
                        readOnly
                        value={selectedDoc.tenantName}
                        className="w-full bg-[#101419] border border-[#404752] rounded px-2.5 py-1.5 text-xs text-[#8a919e]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10.5px] text-[#8a919e] font-semibold block mb-1">Custom Delivery Note</label>
                    <textarea
                      rows={2}
                      value={customNote}
                      onChange={(e) => setCustomNote(e.target.value)}
                      className="w-full bg-[#101419] border border-[#404752] rounded p-2 text-xs text-[#e0e2ea] focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Dispatch via Mailer / ConnectWise PSA</span>
                  </button>
                </form>
              )}

            </div>

          </div>

        </div>

      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: GENERATE NEW DOCUMENT WORKFLOW MODAL */}
      {/* ========================================================================= */}
      {isGenerateModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#181c22] border border-[#404752] rounded-md max-w-lg w-full p-5 space-y-4 shadow-2xl relative">
            <button
              onClick={() => setIsGenerateModalOpen(false)}
              className="absolute top-4 right-4 text-[#8a919e] hover:text-[#e0e2ea] p-1 rounded bg-[#272a30] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2">
              <div className="p-2 rounded bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#e0e2ea]">Generate New MSP Document Deliverable</h3>
                <p className="text-xs text-[#8a919e]">Compiles Graph API telemetry into executive PDF, DOCX, or JSON.</p>
              </div>
            </div>

            <form onSubmit={handleCreateNewDocument} className="space-y-3 text-xs">
              <div>
                <label className="text-[11px] font-bold text-[#8a919e] block mb-1">Target Managed Tenant</label>
                <select
                  value={newDocTenantId}
                  onChange={(e) => setNewDocTenantId(e.target.value)}
                  className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-2 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
                >
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.primaryDomain})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-[#8a919e] block mb-1">Document Category / Scope</label>
                <select
                  value={newDocCategory}
                  onChange={(e) => setNewDocCategory(e.target.value as GeneratedDocument['category'])}
                  className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-2 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
                >
                  <option value="QBR Reports">QBR Reports</option>
                  <option value="Executive Health Audits">Executive Health Audits</option>
                  <option value="Security Compliance (CIS)">Security Compliance (CIS)</option>
                  <option value="License Optimization">License Optimization</option>
                  <option value="SOWs & Agreements">SOWs & Agreements</option>
                  <option value="User Offboarding Logs">User Offboarding Logs</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-[#8a919e] block mb-1">Custom Deliverable Title (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Contoso Q3 Security Posture Audit"
                  value={newDocTitle}
                  onChange={(e) => setNewDocTitle(e.target.value)}
                  className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-2 text-xs text-[#e0e2ea] placeholder-[#8a919e] focus:outline-none focus:border-[#0078d4]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-[#8a919e] block mb-1">File Format</label>
                  <select
                    value={newDocType}
                    onChange={(e) => setNewDocType(e.target.value as 'pdf' | 'docx' | 'json')}
                    className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-2 text-xs text-[#e0e2ea] focus:outline-none"
                  >
                    <option value="pdf">PDF Executive Document</option>
                    <option value="docx">Word (.docx) Agreement</option>
                    <option value="json">JSON Audit Log Stream</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-[#8a919e] block mb-1">Visibility Scope</label>
                  <select
                    value={newDocVisibility}
                    onChange={(e) => setNewDocVisibility(e.target.value as 'internal' | 'published')}
                    className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-2 text-xs text-[#e0e2ea] focus:outline-none"
                  >
                    <option value="published">🟢 Published to Client Portal</option>
                    <option value="internal">🔒 Internal MSP Only</option>
                  </select>
                </div>
              </div>

              <div className="bg-[#101419] border border-[#404752] p-3 rounded flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[#e0e2ea]">Auto-sync to Tenant SharePoint</div>
                  <div className="text-[11px] text-[#8a919e]">Pushes output to target tenant library immediately</div>
                </div>
                <input
                  type="checkbox"
                  checked={newDocAutoSync}
                  onChange={(e) => setNewDocAutoSync(e.target.checked)}
                  className="w-4 h-4 accent-[#0078d4] cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsGenerateModalOpen(false)}
                  className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] rounded text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Generate Document</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: FULLSCREEN DOCUMENT PREVIEW & PRINT MODAL */}
      {/* ========================================================================= */}
      {isFullscreenPreviewOpen && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex flex-col p-4 sm:p-8">
          <div className="bg-[#181c22] border border-[#404752] rounded-md flex-1 flex flex-col overflow-hidden max-w-5xl mx-auto w-full shadow-2xl">
            
            {/* Modal Top Bar */}
            <div className="p-4 bg-[#101419] border-b border-[#404752] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40 font-mono text-xs uppercase font-bold">
                  {selectedDoc.fileType}
                </span>
                <h3 className="font-bold text-sm text-[#e0e2ea]">{selectedDoc.title}</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print PDF</span>
                </button>
                <button
                  onClick={() => setIsFullscreenPreviewOpen(false)}
                  className="p-1.5 rounded bg-[#272a30] hover:bg-[#31353b] text-[#8a919e] hover:text-[#e0e2ea] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable Document Content Area */}
            <div className="p-6 sm:p-10 overflow-y-auto flex-1 space-y-6 bg-[#0b0e14] text-[#e0e2ea]">
              
              {/* Document Letterhead */}
              <div className="border-b border-[#404752] pb-6 flex flex-col sm:flex-row justify-between gap-4">
                <div>
                  <div className="text-xs font-mono font-bold text-[#0078d4] uppercase tracking-widest">
                    GLOBAL MSP GOVERNANCE PLATFORM
                  </div>
                  <h1 className="text-2xl font-black text-white mt-1">{selectedDoc.title}</h1>
                  <div className="text-xs text-[#8a919e] mt-2 flex items-center gap-3">
                    <span>Tenant: <strong className="text-[#a3c9ff]">{selectedDoc.tenantName}</strong></span>
                    <span>•</span>
                    <span>Primary Domain: <strong className="text-[#e0e2ea]">{selectedDoc.tenantDomain}</strong></span>
                    <span>•</span>
                    <span>Version: <strong className="text-purple-300">{selectedDoc.version}</strong></span>
                  </div>
                </div>

                <div className="p-3 bg-[#101419] border border-[#404752] rounded text-right shrink-0">
                  <div className="text-[10px] text-[#8a919e] font-mono uppercase">AUTHENTICATION HASH</div>
                  <div className="text-xs font-mono text-[#4ade80] font-bold mt-0.5">sha256-8f0a21d982a...</div>
                  <div className="text-[10px] text-[#8a919e] mt-1">Generated: {selectedDoc.createdAt}</div>
                </div>
              </div>

              {/* Metrics Summary Grid */}
              {selectedDoc.previewMetrics && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {selectedDoc.previewMetrics.map((m, idx) => (
                    <div key={idx} className="bg-[#181c22] border border-[#404752] p-4 rounded text-center">
                      <div className="text-xs text-[#8a919e] font-semibold uppercase tracking-wider">{m.label}</div>
                      <div className={cn('text-2xl font-bold font-mono mt-1', m.color || 'text-[#e0e2ea]')}>
                        {m.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Document Text Abstract */}
              <div className="space-y-3 bg-[#181c22] border border-[#404752] p-5 rounded">
                <h3 className="text-sm font-bold text-[#a3c9ff] uppercase tracking-wider">
                  1. Executive Overview & Scope
                </h3>
                <p className="text-xs text-[#e0e2ea] leading-relaxed">
                  {selectedDoc.summary}
                </p>
                <p className="text-xs text-[#8a919e] leading-relaxed">
                  This deliverable is automatically synced with the Microsoft Graph REST API endpoints for Exchange Online, Entra ID, Microsoft Defender XDR, and Microsoft Purview Information Protection.
                </p>
              </div>

              {/* Governance Control Matrix */}
              <div className="space-y-3 bg-[#181c22] border border-[#404752] p-5 rounded">
                <h3 className="text-sm font-bold text-[#a3c9ff] uppercase tracking-wider">
                  2. Detailed Compliance Controls Status
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="p-3 bg-[#101419] border border-[#404752] rounded flex justify-between items-center">
                    <div>
                      <div className="font-bold text-[#e0e2ea]">Identity & Conditional Access Defaults</div>
                      <div className="text-[#8a919e]">MFA enforced for 100% of admin accounts and legacy auth disabled</div>
                    </div>
                    <span className="px-2 py-1 rounded bg-[#166534]/30 text-[#4ade80] border border-[#166534] font-mono font-bold">
                      PASSED (100%)
                    </span>
                  </div>

                  <div className="p-3 bg-[#101419] border border-[#404752] rounded flex justify-between items-center">
                    <div>
                      <div className="font-bold text-[#e0e2ea]">Defender for Office 365 Safe Attachments</div>
                      <div className="text-[#8a919e]">Dynamic delivery and zero-hour auto purge (ZAP) active</div>
                    </div>
                    <span className="px-2 py-1 rounded bg-[#166534]/30 text-[#4ade80] border border-[#166534] font-mono font-bold">
                      PASSED (100%)
                    </span>
                  </div>

                  <div className="p-3 bg-[#101419] border border-[#404752] rounded flex justify-between items-center">
                    <div>
                      <div className="font-bold text-[#e0e2ea]">Purview Sensitive Data Exfiltration Prevention</div>
                      <div className="text-[#8a919e]">Credit Card and Social Security Number DLP rules active</div>
                    </div>
                    <span className="px-2 py-1 rounded bg-[#166534]/30 text-[#4ade80] border border-[#166534] font-mono font-bold">
                      PASSED (100%)
                    </span>
                  </div>
                </div>
              </div>

            </div>

          </div>
        </div>
      )}

    </div>
  );
};
