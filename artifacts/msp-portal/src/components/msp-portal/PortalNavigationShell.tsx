import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldAlert,
  CheckSquare,
  Clock,
  KeyRound,
  Layers,
  UserMinus,
  MessageSquare,
  GitBranch,
  Kanban,
  Package,
  SlidersHorizontal,
  Activity,
  RotateCcw,
  FileText,
  BookOpen,
  User,
  Settings,
  LogOut,
  Building2,
  Receipt,
  Sparkles,
  Command,
  ChevronDown,
  ChevronRight,
  Search,
  Zap,
  TrendingUp,
  X,
  ShieldCheck,
  AlertTriangle,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Lock,
  ArrowRight,
  Flame,
  Network
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Tenant } from '../types';

// ============================================================================
// NAVIGATION DATA CONTRACTS & CONFIGURATION
// ============================================================================

export interface NavItem {
  title: string;
  href: string;
  icon: string;
  badge?: string | number;
  badgeVariant?: 'default' | 'destructive' | 'warning' | 'success';
}

export interface NavGroup {
  id: string;
  title: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    id: 'operate',
    title: 'OPERATE',
    items: [
      { title: 'Zero Trust & Threat Protection Console', href: '/portal/zero-trust', icon: 'ShieldAlert', badge: 'Zero Trust', badgeVariant: 'destructive' },
      { title: 'Alerts & Remediation', href: '/portal/alerts', icon: 'ShieldAlert', badge: 3, badgeVariant: 'destructive' },
      { title: 'Operator Tasks', href: '/portal/tasks', icon: 'CheckSquare', badge: 8, badgeVariant: 'warning' },
      { title: 'SLA Dashboard', href: '/portal/msp-sla', icon: 'Clock' },
      { title: 'Approvals Gate', href: '/portal/approvals', icon: 'KeyRound', badge: 3, badgeVariant: 'destructive' },
      { title: '7 Pillars Governance', href: '/portal/pillars', icon: 'Layers' },
      { title: 'Support Chat', href: '/portal/support-chat', icon: 'MessageSquare', badge: 2, badgeVariant: 'success' },
    ],
  },
  {
    id: 'grow',
    title: 'GROW & MONETIZE',
    items: [
      { title: 'Onboarding Map', href: '/portal/onboarding-map', icon: 'GitBranch' },
      { title: 'Tenant Heatmap', href: '/portal/heatmap', icon: 'Flame', badge: 'Matrix', badgeVariant: 'warning' },
      { title: 'Topology Map', href: '/portal/map', icon: 'Network', badge: 'Live', badgeVariant: 'success' },
      { title: 'Offer Pipeline', href: '/portal/offer-pipeline', icon: 'Kanban' },
      { title: 'Sales Bundles', href: '/portal/sales-bundles', icon: 'Package' },
      { title: 'Scope Creep Monitor', href: '/portal/scope-creep', icon: 'SlidersHorizontal' },
      { title: 'RBD Liability Acceptance', href: '/portal/rbd', icon: 'ShieldAlert' },
    ],
  },
  {
    id: 'engine',
    title: 'ENGINE & LOGS',
    items: [
      { title: 'Workflow Runs', href: '/portal/workflow-runs', icon: 'Activity' },
      { title: 'Dead Letter Queue (DLQ)', href: '/portal/dlq', icon: 'RotateCcw', badge: 18, badgeVariant: 'warning' },
      { title: 'Change Control Log', href: '/portal/changes', icon: 'FileText' },
      { title: 'SOP & Runbooks', href: '/portal/sop', icon: 'BookOpen' },
    ],
  },
];

export interface QuickActionItem {
  id: string;
  title: string;
  category: 'Security' | 'Automation' | 'Maintenance';
  icon: string;
  description: string;
}

export const QUICK_ACTIONS: QuickActionItem[] = [
  { id: 'revoke_session', title: 'Run Emergency Session Revoke', category: 'Security', icon: 'Lock', description: 'Invalidate all OAuth refresh tokens for suspicious admin identity.' },
  { id: 'sec_scan', title: 'Trigger Global Security Scan', category: 'Security', icon: 'ShieldCheck', description: 'Initiate Graph API delta scan across all 25 client tenants.' },
  { id: 'purge_dlq', title: 'Purge Dead Letter Queue (DLQ)', category: 'Automation', icon: 'RotateCcw', description: 'Re-drive failed Graph webhook listener requests.' },
  { id: 'mfa_baseline', title: 'Enforce MFA Policy Baseline', category: 'Security', icon: 'Zap', description: 'Push strict Conditional Access rules to non-compliant tenants.' },
  { id: 'backup_audit', title: 'Push MSP Audit Log Backup', category: 'Maintenance', icon: 'FileText', description: 'Export 90-day SIEM log snapshots to immutable Cloud Storage.' },
];

export interface PortalNavigationShellProps {
  currentPath?: string;
  onNavigate?: (href: string, title: string) => void;
  selectedTenant?: Tenant | null;
  tenants?: Tenant[];
  onSelectTenant?: (tenant: Tenant | null) => void;
  onQuickAction?: (actionId: string, actionTitle: string) => void;
  children?: React.ReactNode;
}

// Helper: Dynamic Icon Renderer
const renderIcon = (iconName: string, className: string = 'w-4 h-4') => {
  switch (iconName) {
    case 'ShieldAlert': return <ShieldAlert className={className} />;
    case 'CheckSquare': return <CheckSquare className={className} />;
    case 'Clock': return <Clock className={className} />;
    case 'KeyRound': return <KeyRound className={className} />;
    case 'Layers': return <Layers className={className} />;
    case 'UserMinus': return <UserMinus className={className} />;
    case 'MessageSquare': return <MessageSquare className={className} />;
    case 'GitBranch': return <GitBranch className={className} />;
    case 'Flame': return <Flame className={className} />;
    case 'Network': return <Network className={className} />;
    case 'Kanban': return <Kanban className={className} />;
    case 'Package': return <Package className={className} />;
    case 'SlidersHorizontal': return <SlidersHorizontal className={className} />;
    case 'Activity': return <Activity className={className} />;
    case 'RotateCcw': return <RotateCcw className={className} />;
    case 'FileText': return <FileText className={className} />;
    case 'BookOpen': return <BookOpen className={className} />;
    case 'User': return <User className={className} />;
    case 'Settings': return <Settings className={className} />;
    case 'LogOut': return <LogOut className={className} />;
    case 'Building2': return <Building2 className={className} />;
    case 'Receipt': return <Receipt className={className} />;
    case 'Sparkles': return <Sparkles className={className} />;
    case 'Zap': return <Zap className={className} />;
    case 'ShieldCheck': return <ShieldCheck className={className} />;
    case 'Lock': return <Lock className={className} />;
    default: return <Sparkles className={className} />;
  }
};

export const PortalNavigationShell: React.FC<PortalNavigationShellProps> = ({
  currentPath = '/portal/alerts',
  onNavigate,
  selectedTenant,
  tenants = [],
  onSelectTenant,
  onQuickAction,
  children,
}) => {
  // Navigation State
  const [activePath, setActivePath] = useState(currentPath);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    operate: true,
    grow: true,
    engine: true,
  });

  // Dropdown & Modal States
  const [isTenantMenuOpen, setIsTenantMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isThreatModalOpen, setIsThreatModalOpen] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [commandCategory, setCommandCategory] = useState<'all' | 'pages' | 'tenants' | 'actions'>('all');

  const tenantMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Sync internal path with prop
  useEffect(() => {
    if (currentPath) setActivePath(currentPath);
  }, [currentPath]);

  // Handle Cmd + K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setIsCommandOpen(false);
        setIsTenantMenuOpen(false);
        setIsUserMenuOpen(false);
        setIsThreatModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (tenantMenuRef.current && !tenantMenuRef.current.contains(e.target as Node)) {
        setIsTenantMenuOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNavClick = (href: string, title: string) => {
    setActivePath(href);
    setIsMobileOpen(false);
    if (onNavigate) {
      onNavigate(href, title);
    }
  };

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  // Badge variant styles
  const getBadgeStyle = (variant?: 'default' | 'destructive' | 'warning' | 'success') => {
    switch (variant) {
      case 'destructive':
        return 'bg-red-500/20 text-red-300 border-red-500/40 font-extrabold';
      case 'warning':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold';
      case 'success':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700 font-medium';
    }
  };

  // Command Palette Items Filter
  const allNavItems = navGroups.flatMap((g) => g.items);
  const filteredNavItems = allNavItems.filter((i) =>
    i.title.toLowerCase().includes(commandQuery.toLowerCase()) || i.href.toLowerCase().includes(commandQuery.toLowerCase())
  );
  const filteredTenants = tenants.filter((t) =>
    t.name.toLowerCase().includes(commandQuery.toLowerCase()) || t.primaryDomain.toLowerCase().includes(commandQuery.toLowerCase())
  );
  const filteredQuickActions = QUICK_ACTIONS.filter((a) =>
    a.title.toLowerCase().includes(commandQuery.toLowerCase()) || a.description.toLowerCase().includes(commandQuery.toLowerCase())
  );

  return (
    <div className="bg-[#090d16] text-slate-100 min-h-screen flex flex-col font-sans antialiased select-none overflow-hidden">
      
      {/* 1. TOP NAVIGATION HEADER BAR */}
      <header className="bg-[#121826]/90 backdrop-blur-md border-b border-[#1f293d] h-12 px-3 sm:px-5 flex items-center justify-between shrink-0 z-40 relative">
        
        {/* Left Branding & Tenant Switcher */}
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <button
            onClick={() => setIsMobileOpen(!isMobileOpen)}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Toggle Menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => handleNavClick('/portal/alerts', 'Alerts & Remediation')}>
            <div className="p-1.5 rounded-xl bg-gradient-to-br from-[#0078D4] to-indigo-600 text-white shadow-md shadow-[#0078D4]/30">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="hidden xs:block">
              <h1 className="text-xs font-bold text-white tracking-tight leading-tight flex items-center gap-1.5">
                <span>Shane McCaw Consulting</span>
                <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-[#0078D4]/20 text-[#38BDF8] border border-[#0078D4]/40">
                  M365 Portal
                </span>
              </h1>
            </div>
          </div>

          {/* Tenant Selector Dropdown */}
          <div className="relative" ref={tenantMenuRef}>
            <button
              onClick={() => setIsTenantMenuOpen(!isTenantMenuOpen)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-[#182235] border border-[#2a3854] hover:border-[#0078D4]/60 text-xs text-slate-200 transition-all cursor-pointer"
            >
              <Building2 className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span className="font-semibold truncate max-w-[110px] sm:max-w-[160px]">
                {selectedTenant ? selectedTenant.name : 'Contoso Corp (25 Tenants)'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>

            {isTenantMenuOpen && (
              <div className="absolute left-0 top-full mt-2 w-72 rounded-2xl bg-[#131927] border border-[#2a3854] shadow-2xl p-2 z-50 text-xs space-y-1 animate-in fade-in zoom-in-95 duration-150">
                <div className="px-2 py-1.5 font-bold uppercase text-[10px] text-slate-400 border-b border-[#23314a]">
                  Active Tenant Context
                </div>
                
                <button
                  onClick={() => {
                    if (onSelectTenant) onSelectTenant(null);
                    setIsTenantMenuOpen(false);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-xl flex items-center justify-between transition-colors cursor-pointer',
                    !selectedTenant ? 'bg-[#0078D4] text-white font-bold' : 'text-slate-300 hover:bg-[#182235]'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-cyan-300" />
                    <span>Global View (All 25 Tenants)</span>
                  </div>
                  {!selectedTenant && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                </button>

                <div className="pt-1 border-t border-[#23314a] space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                  {tenants.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        if (onSelectTenant) onSelectTenant(t);
                        setIsTenantMenuOpen(false);
                      }}
                      className={cn(
                        'w-full text-left px-3 py-2 rounded-xl flex items-center justify-between transition-colors cursor-pointer',
                        selectedTenant?.id === t.id
                          ? 'bg-[#0078D4] text-white font-bold'
                          : 'text-slate-300 hover:bg-[#182235]'
                      )}
                    >
                      <div>
                        <p className="truncate font-semibold">{t.name}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{t.primaryDomain}</p>
                      </div>
                      {selectedTenant?.id === t.id && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center: Command Palette Trigger Input */}
        <div className="hidden md:flex items-center flex-1 max-w-md mx-4">
          <button
            onClick={() => setIsCommandOpen(true)}
            className="w-full px-3.5 py-1.5 rounded-xl bg-[#0d131f] border border-[#23314a] hover:border-[#0078D4]/60 text-slate-400 text-xs flex items-center justify-between transition-all cursor-pointer group shadow-inner"
          >
            <div className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#38BDF8] transition-colors" />
              <span>Search console or press Cmd + K...</span>
            </div>
            <kbd className="px-1.5 py-0.5 rounded bg-[#182235] text-[10px] font-mono text-slate-300 border border-[#2a3854]">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right Status Controls & User Avatar Dropdown */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          
          {/* Threat Status Pill */}
          <div className="relative">
            <button
              onClick={() => setIsThreatModalOpen(!isThreatModalOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/50 text-emerald-300 text-xs font-bold hover:bg-emerald-900/60 transition-colors cursor-pointer"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>DEFCON 4</span>
            </button>

            {isThreatModalOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 rounded-2xl bg-[#131927] border border-[#2a3854] shadow-2xl p-4 z-50 text-xs space-y-2 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-2 border-b border-[#23314a]">
                  <span className="font-bold text-slate-200 uppercase text-[10px]">Global SOC Threat Level</span>
                  <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
                    Low Threat
                  </span>
                </div>
                <p className="text-slate-300 leading-relaxed text-[11px]">
                  All 25 customer tenant environments operating under standard baseline security policies. 3 active MFA warnings currently in mitigation.
                </p>
                <button
                  onClick={() => {
                    setIsThreatModalOpen(false);
                    handleNavClick('/portal/alerts', 'Alerts & Remediation');
                  }}
                  className="w-full py-2 bg-[#0078D4] hover:bg-[#005A9E] text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>View Security Threat Console</span>
                </button>
              </div>
            )}
          </div>

          {/* Pending Approvals Badge */}
          <button
            onClick={() => handleNavClick('/portal/approvals', 'Approvals Gate')}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-950/60 border border-red-500/50 text-red-300 text-xs font-extrabold hover:bg-red-900/60 transition-colors cursor-pointer"
            title="3 Pending Dual-Key Approvals"
          >
            <KeyRound className="w-3.5 h-3.5 text-red-400" />
            <span>3 Pending</span>
          </button>

          {/* User Avatar Dropdown Button */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              className="flex items-center gap-2 p-1 rounded-full bg-[#182235] border border-[#2a3854] hover:border-[#0078D4] transition-all cursor-pointer"
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-[#0078D4] to-cyan-400 text-white font-extrabold text-xs flex items-center justify-center shadow-md">
                SM
              </div>
              <ChevronDown className="w-3 h-3 text-slate-400 pr-1 hidden sm:block" />
            </button>

            {isUserMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 rounded-2xl bg-[#131927] border border-[#2a3854] shadow-2xl p-2 z-50 text-xs space-y-1 animate-in fade-in zoom-in-95 duration-150">
                <div className="p-3 bg-[#182235] rounded-xl border border-[#23314a] mb-2">
                  <p className="font-bold text-white text-sm">Shane McCaw</p>
                  <p className="text-[11px] text-cyan-400 font-mono">Principal Admin (MSP Lead)</p>
                </div>

                <button
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    handleNavClick('/portal/owner-dashboard', 'MSP Owner Executive Console');
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl text-slate-200 hover:bg-[#182235] hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Building2 className="w-4 h-4 text-[#38BDF8]" />
                  <span>MSP Owner Dashboard</span>
                </button>

                <button
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    handleNavClick('/portal/settings', 'Settings Console');
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl text-slate-200 hover:bg-[#182235] hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Settings className="w-4 h-4 text-purple-400" />
                  <span>Global Settings</span>
                </button>

                <button
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    handleNavClick('/portal/security-plan', 'Security Emergency Plan');
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl text-slate-200 hover:bg-[#182235] hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <ShieldAlert className="w-4 h-4 text-red-400" />
                  <span>Security & Emergency Plan</span>
                </button>

                <button
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    handleNavClick('/portal/webhooks', 'Webhooks Console');
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl text-slate-200 hover:bg-[#182235] hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Activity className="w-4 h-4 text-amber-400" />
                  <span>Webhooks & Integration Vault</span>
                </button>

                <button
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    handleNavClick('/portal/chargeback', 'Chargeback Console');
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl text-slate-200 hover:bg-[#182235] hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Receipt className="w-4 h-4 text-emerald-400" />
                  <span>Chargeback & Billing Ledger</span>
                </button>

                <div className="pt-1 border-t border-[#23314a]">
                  <button
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      alert('Signed out of Shane McCaw Consulting MSP Portal session.');
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl text-red-400 hover:bg-red-950/40 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 text-red-400" />
                    <span className="font-bold">Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 2. MAIN BODY WRAPPER: SIDEBAR + CONTENT AREA */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* CATEGORIZED COLLAPSIBLE LEFT SIDEBAR */}
        <aside
          className={cn(
            'bg-[#0d131f] border-r border-[#1f293d] flex flex-col transition-all duration-300 z-30 shrink-0 select-none',
            isSidebarCollapsed ? 'w-16' : 'w-64',
            'hidden lg:flex'
          )}
        >
          {/* Sidebar Header Collapse Switch */}
          <div className="p-3 border-b border-[#1f293d] flex items-center justify-between">
            {!isSidebarCollapsed && (
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 pl-1">
                Navigation Directory
              </span>
            )}
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#182235] transition-colors ml-auto cursor-pointer"
              title={isSidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              {isSidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
          </div>

          {/* Operational Accordion Groups */}
          <div className="flex-1 overflow-y-auto p-2 space-y-4 custom-scrollbar">
            {navGroups.map((group) => {
              const isOpen = openGroups[group.id];
              return (
                <div key={group.id} className="space-y-1">
                  {/* Group Title */}
                  {!isSidebarCollapsed ? (
                    <button
                      onClick={() => toggleGroup(group.id)}
                      className="w-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center justify-between hover:text-slate-200 transition-colors cursor-pointer"
                    >
                      <span>{group.title}</span>
                      <ChevronDown
                        className={cn('w-3 h-3 transition-transform duration-200', !isOpen && '-rotate-90')}
                      />
                    </button>
                  ) : (
                    <div className="h-0.5 bg-[#1f293d] my-2" />
                  )}

                  {/* Group Nav Items */}
                  {(isOpen || isSidebarCollapsed) && (
                    <div className="space-y-0.5">
                      {group.items.map((item) => {
                        const isActive = activePath === item.href;
                        return (
                          <button
                            key={item.href}
                            onClick={() => handleNavClick(item.href, item.title)}
                            title={isSidebarCollapsed ? `${item.title} ${item.badge ? `(${item.badge})` : ''}` : undefined}
                            className={cn(
                              'w-full px-2.5 py-2 rounded-xl text-xs font-semibold flex items-center justify-between transition-all cursor-pointer relative group',
                              isActive
                                ? 'bg-[#0078D4]/20 text-[#38BDF8] border-l-2 border-[#38BDF8] font-bold shadow-sm'
                                : 'text-slate-300 hover:bg-[#182235] hover:text-slate-100'
                            )}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className={cn('shrink-0', isActive ? 'text-[#38BDF8]' : 'text-slate-400 group-hover:text-slate-200')}>
                                {renderIcon(item.icon, 'w-4 h-4')}
                              </div>
                              {!isSidebarCollapsed && (
                                <span className="truncate">{item.title}</span>
                              )}
                            </div>

                            {/* Badge Counter */}
                            {item.badge !== undefined && (
                              <span
                                className={cn(
                                  'text-[10px] px-1.5 py-0.2 rounded-full border shrink-0',
                                  getBadgeStyle(item.badgeVariant),
                                  isSidebarCollapsed && 'absolute -top-1 -right-1 px-1 py-0 text-[9px] shadow-md'
                                )}
                              >
                                {item.badge}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Sidebar Footer Info */}
          {!isSidebarCollapsed && (
            <div className="p-3 border-t border-[#1f293d] bg-[#090d16] text-[11px] text-slate-400 flex items-center justify-between">
              <span className="font-mono">v4.8.2-MSP</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live Engine
              </span>
            </div>
          )}
        </aside>

        {/* MOBILE SIDEBAR OVERLAY */}
        {isMobileOpen && (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm lg:hidden flex">
            <div className="w-72 bg-[#0d131f] h-full border-r border-[#1f293d] p-4 space-y-4 flex flex-col overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-[#1f293d]">
                <span className="font-bold text-white text-sm">MSP Console Menu</span>
                <button
                  onClick={() => setIsMobileOpen(false)}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 flex-1">
                {navGroups.map((group) => (
                  <div key={group.id} className="space-y-1">
                    <p className="text-[10px] font-extrabold uppercase text-slate-400 px-2">{group.title}</p>
                    {group.items.map((item) => (
                      <button
                        key={item.href}
                        onClick={() => handleNavClick(item.href, item.title)}
                        className={cn(
                          'w-full p-2.5 rounded-xl text-xs font-semibold flex items-center justify-between text-left',
                          activePath === item.href ? 'bg-[#0078D4] text-white' : 'text-slate-300 hover:bg-[#182235]'
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          {renderIcon(item.icon, 'w-4 h-4')}
                          <span>{item.title}</span>
                        </div>
                        {item.badge !== undefined && (
                          <span className={cn('text-[10px] px-2 py-0.5 rounded-full border', getBadgeStyle(item.badgeVariant))}>
                            {item.badge}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* PRIMARY VIEWPORT CONTENT SLOT */}
        <main className="flex-1 overflow-y-auto bg-[#090d16] p-4 sm:p-6 custom-scrollbar relative">
          {children}
        </main>
      </div>

      {/* 3. GLOBAL COMMAND PALETTE (CMD + K MODAL) */}
      {isCommandOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-start justify-center pt-16 sm:pt-24 p-3">
          <div className="bg-[#131927] border border-[#2a3854] rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-150">
            
            {/* Search Input Bar */}
            <div className="p-4 border-b border-[#23314a] flex items-center gap-3 bg-[#182235]">
              <Search className="w-5 h-5 text-[#38BDF8] shrink-0" />
              <input
                type="text"
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                placeholder="Type to search pages, client tenants, or execute quick actions..."
                className="w-full bg-transparent text-sm text-white placeholder-slate-400 focus:outline-none"
                autoFocus
              />
              <button
                onClick={() => setIsCommandOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Category Filter Tabs */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[#23314a] bg-[#0d131f] text-xs">
              {(['all', 'pages', 'tenants', 'actions'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCommandCategory(cat)}
                  className={cn(
                    'px-3 py-1 rounded-xl font-semibold capitalize transition-colors cursor-pointer',
                    commandCategory === cat
                      ? 'bg-[#0078D4] text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-[#182235]'
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Results Container */}
            <div className="p-4 max-h-96 overflow-y-auto space-y-4 custom-scrollbar">
              
              {/* Pages / Console Modules */}
              {(commandCategory === 'all' || commandCategory === 'pages') && filteredNavItems.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-2 mb-1">
                    Console Modules & Pages ({filteredNavItems.length})
                  </p>
                  {filteredNavItems.map((item) => (
                    <div
                      key={item.href}
                      onClick={() => {
                        handleNavClick(item.href, item.title);
                        setIsCommandOpen(false);
                      }}
                      className="p-2.5 rounded-xl bg-[#182235]/60 hover:bg-[#0078D4] text-slate-200 hover:text-white flex items-center justify-between cursor-pointer transition-colors text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        {renderIcon(item.icon, 'w-4 h-4')}
                        <span className="font-semibold">{item.title}</span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 hover:text-white">{item.href}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Client Tenants */}
              {(commandCategory === 'all' || commandCategory === 'tenants') && filteredTenants.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-2 mb-1">
                    Managed Client Tenants ({filteredTenants.length})
                  </p>
                  {filteredTenants.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => {
                        if (onSelectTenant) onSelectTenant(t);
                        handleNavClick('/portal/alerts', `Alerts - ${t.name}`);
                        setIsCommandOpen(false);
                      }}
                      className="p-2.5 rounded-xl bg-[#182235]/60 hover:bg-[#0078D4] text-slate-200 hover:text-white flex items-center justify-between cursor-pointer transition-colors text-xs"
                    >
                      <div>
                        <p className="font-bold">{t.name}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{t.primaryDomain}</p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                        {t.secureScore}% Secure Score
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Quick Actions */}
              {(commandCategory === 'all' || commandCategory === 'actions') && filteredQuickActions.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-2 mb-1">
                    1-Click Execution Actions
                  </p>
                  {filteredQuickActions.map((act) => (
                    <div
                      key={act.id}
                      onClick={() => {
                        if (onQuickAction) onQuickAction(act.id, act.title);
                        setIsCommandOpen(false);
                      }}
                      className="p-2.5 rounded-xl bg-purple-950/30 border border-purple-800/40 hover:bg-purple-900/60 text-slate-200 hover:text-white flex items-center justify-between cursor-pointer transition-colors text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <Zap className="w-4 h-4 text-purple-400 shrink-0" />
                        <div>
                          <p className="font-bold text-purple-200">{act.title}</p>
                          <p className="text-[10px] text-slate-300">{act.description}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-900 text-purple-300 border border-purple-700">
                        {act.category}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-[#0d131f] border-t border-[#23314a] text-[10px] text-slate-400 flex items-center justify-between px-4">
              <span>Press <kbd className="px-1 rounded bg-slate-800 border border-slate-700">ESC</kbd> to exit</span>
              <span className="font-mono text-cyan-400">Shane McCaw M365 Command Palette</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
