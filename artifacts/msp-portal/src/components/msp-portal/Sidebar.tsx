import React from 'react';
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  RefreshCw,
  Zap,
  Settings,
  HelpCircle,
  FileText,
  ShieldAlert,
  Building2,
  Grid,
  Network,
  Flame,
  CreditCard,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  BookOpen,
  X,
  Bell,
  Scale,
  Terminal,
  Target,
  DollarSign,
  Package,
  Kanban,
  Receipt,
  CheckSquare,
  AlertOctagon,
  UserMinus,
  Webhook,
  Sparkles,
  Layers,
  KeyRound,
  Activity,
  BarChart3,
} from 'lucide-react';

export type NavTab =
  | 'Overview'
  | 'Heatmap'
  | 'Map'
  | 'Timeline'
  | 'Tenant Overview'
  | 'MSP Overview'
  | 'Approvals'
  | 'Operator Tasks'
  | 'Zero Trust & Threat Protection Console'
  | 'Workflow Runs'
  | 'DLQ'
  | 'Onboarding Map'
  | 'Offboarding'
  | 'User Management'
  | 'Webhooks'
  | 'Alerts'
  | 'Accounts'
  | 'Message Center'
  | 'Microsoft SLA'
  | 'SLA Dashboard'
  | 'Change Control'
  | 'SOP Runbooks'
  | 'Audit Logs'
  | 'Audit Log'
  | 'Security Pillar'
  | 'Security'
  | 'Governance Pillar'
  | 'Compliance Pillar'
  | 'Adoption Pillar'
  | 'Copilot Readiness Pillar'
  | 'Architecture Pillar'
  | 'Licensing Pillar'
  | 'Risk Decisions'
  | 'Scope Creep'
  | 'Tenant Portal'
  | 'M365 Admin Tools'
  | 'Document Library'
  | 'Billing'
  | 'Chargeback'
  | 'Sales Bundles'
  | 'Offer Pipeline'
  | 'Settings'
  | 'Support'
  | 'Tenants'
  | 'Security & Compliance'
  | 'Health & Sync'
  | 'Automation'
  | 'Logs';

interface SidebarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  unreadLogsCount: number;
  selectedTenantName?: string;
  onCloseMobileSidebar?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  unreadLogsCount,
  selectedTenantName,
  onCloseMobileSidebar,
}) => {
  const navSections: {
    title: string;
    description?: string;
    items: { label: NavTab; icon: React.ReactNode; badgeText?: string }[];
  }[] = [
    {
      title: '1. Home',
      items: [
        { label: 'Overview', icon: <LayoutDashboard className="w-4 h-4 text-[#a3c9ff]" /> },
        { label: 'Heatmap', icon: <Flame className="w-4 h-4 text-amber-400" />, badgeText: 'Matrix' },
        { label: 'Map', icon: <Network className="w-4 h-4 text-cyan-400" />, badgeText: 'Live' },
        { label: 'Timeline', icon: <GitBranch className="w-4 h-4 text-purple-400" />, badgeText: 'Scan DAG' },
        { label: 'Tenant Overview', icon: <Building2 className="w-4 h-4 text-emerald-400" />, badgeText: 'summary' },
      ],
    },
    {
      title: '2. Operations',
      items: [
        { label: 'MSP Overview', icon: <BarChart3 className="w-4 h-4 text-emerald-400" />, badgeText: 'Executive FinOps' },
        { label: 'Approvals', icon: <ShieldCheck className="w-4 h-4 text-purple-400" />, badgeText: 'Dual-Sign' },
        { label: 'Operator Tasks', icon: <CheckSquare className="w-4 h-4 text-[#a3c9ff]" />, badgeText: 'Tasks' },
        { label: 'Workflow Runs', icon: <Zap className="w-4 h-4 text-emerald-400" />, badgeText: 'Traces' },
        { label: 'DLQ', icon: <AlertOctagon className="w-4 h-4 text-red-400 animate-pulse" />, badgeText: 'Recovery' },
        { label: 'Onboarding Map', icon: <GitBranch className="w-4 h-4 text-cyan-400" />, badgeText: 'Pipeline' },
        { label: 'Offboarding', icon: <UserMinus className="w-4 h-4 text-amber-400" />, badgeText: 'Lifecycle' },
        { label: 'Webhooks', icon: <Webhook className="w-4 h-4 text-cyan-400" />, badgeText: 'Events' },
        { label: 'Alerts', icon: <ShieldAlert className="w-4 h-4 text-red-400 animate-pulse" />, badgeText: 'SOC Live' },
        { label: 'Accounts', icon: <Users className="w-4 h-4 text-blue-400" />, badgeText: 'Identity' },
        { label: 'Message Center', icon: <Bell className="w-4 h-4 text-amber-400 animate-pulse" />, badgeText: 'M365' },
        { label: 'Microsoft SLA', icon: <Scale className="w-4 h-4 text-emerald-400" />, badgeText: '99.9%' },
        { label: 'SLA Dashboard', icon: <Target className="w-4 h-4 text-purple-400" />, badgeText: 'MSP SLA' },
        { label: 'Change Control', icon: <GitPullRequest className="w-4 h-4 text-[#a3c9ff]" />, badgeText: 'ITIL v4' },
        { label: 'SOP Runbooks', icon: <BookOpen className="w-4 h-4 text-indigo-400" />, badgeText: 'Runbooks' },
        { label: 'Audit Logs', icon: <Terminal className="w-4 h-4 text-purple-400" />, badgeText: 'Live Stream' },
      ],
    },
    {
      title: '3. Intelligence',
      description: 'This is where your Pillars live.',
      items: [
        { label: 'Security Pillar', icon: <ShieldAlert className="w-4 h-4 text-red-400 animate-pulse" />, badgeText: 'Zero Trust' },
        { label: 'Governance Pillar', icon: <ShieldCheck className="w-4 h-4 text-purple-400" />, badgeText: 'Policies' },
        { label: 'Compliance Pillar', icon: <FileText className="w-4 h-4 text-blue-400" />, badgeText: 'Purview' },
        { label: 'Adoption Pillar', icon: <Activity className="w-4 h-4 text-emerald-400" />, badgeText: 'Usage' },
        { label: 'Copilot Readiness Pillar', icon: <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />, badgeText: 'AI Ready' },
        { label: 'Architecture Pillar', icon: <Layers className="w-4 h-4 text-cyan-400" />, badgeText: 'Topology' },
        { label: 'Licensing Pillar', icon: <KeyRound className="w-4 h-4 text-indigo-400" />, badgeText: 'Optimized' },
        { label: 'Risk Decisions', icon: <Scale className="w-4 h-4 text-amber-400" />, badgeText: 'RBD / RAM' },
        { label: 'Scope Creep', icon: <DollarSign className="w-4 h-4 text-emerald-400" />, badgeText: '+$3.8k MRR' },
      ],
    },
    {
      title: '4. Tenant Management',
      items: [
        { label: 'Tenant Portal', icon: <Users className="w-4 h-4 text-[#a3c9ff]" />, badgeText: selectedTenantName ? selectedTenantName.substring(0, 8) : 'Select' },
        { label: 'M365 Admin Tools', icon: <Grid className="w-4 h-4 text-[#a3c9ff]" /> },
        { label: 'Document Library', icon: <FolderOpen className="w-4 h-4 text-[#a3c9ff]" />, badgeText: 'Docs' },
      ],
    },
    {
      title: '5. Financials',
      items: [
        { label: 'Billing', icon: <CreditCard className="w-4 h-4 text-purple-400" />, badgeText: 'FinTech' },
        { label: 'Chargeback', icon: <Receipt className="w-4 h-4 text-[#a3c9ff]" />, badgeText: 'FinOps' },
      ],
    },
    {
      title: '6. Sales & Growth',
      items: [
        { label: 'Sales Bundles', icon: <Package className="w-4 h-4 text-emerald-400" />, badgeText: 'Packaging' },
        { label: 'Offer Pipeline', icon: <Kanban className="w-4 h-4 text-[#a3c9ff]" />, badgeText: 'Deals' },
      ],
    },
    {
      title: '7. Settings & Support',
      items: [
        { label: 'Settings', icon: <Settings className="w-4 h-4 text-[#a3c9ff]" /> },
        { label: 'Support', icon: <HelpCircle className="w-4 h-4 text-[#a3c9ff]" /> },
      ],
    },
  ];

  const bottomNavItems: { label: NavTab; icon: React.ReactNode; badge?: number }[] = [
    { label: 'Logs', icon: <FileText className="w-4 h-4" />, badge: unreadLogsCount },
  ];

  const handleTabClick = (tab: NavTab) => {
    setActiveTab(tab);
    if (onCloseMobileSidebar) {
      onCloseMobileSidebar();
    }
  };

  return (
    <nav className="bg-[#181c22] border-r border-[#404752] w-64 lg:w-60 h-full flex flex-col py-3 shrink-0 select-none text-[#e0e2ea] justify-between shadow-2xl lg:shadow-none overflow-y-auto">
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {/* Admin profile header */}
        <div className="px-4 mb-3 pb-3 border-b border-[#404752] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#272a30] border border-[#404752] flex items-center justify-center text-[#a3c9ff] shadow-sm shrink-0">
              <ShieldAlert className="w-5 h-5 text-[#0078d4]" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#a3c9ff] tracking-tight">Global Admin</div>
              <div className="text-[11px] text-[#8a919e] font-medium">MSP Operations Lead</div>
            </div>
          </div>

          {onCloseMobileSidebar && (
            <button
              onClick={onCloseMobileSidebar}
              className="lg:hidden p-1.5 text-[#8a919e] hover:text-white rounded hover:bg-[#272a30]"
              title="Close Menu"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Nav Sections with Categories */}
        <div className="px-2 space-y-3 pb-2">
          {navSections.map((section) => (
            <div key={section.title} className="space-y-1">
              <div className="px-2 pt-2 pb-0.5 border-t border-[#2a303c] first:border-t-0">
                <div className="text-[10px] uppercase font-mono font-bold text-[#0078d4] tracking-wider">
                  {section.title}
                </div>
                {section.description && (
                  <div className="text-[10px] text-[#8a919e] font-sans italic mt-0.5">
                    {section.description}
                  </div>
                )}
              </div>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = activeTab === item.label;
                  return (
                    <li key={item.label}>
                      <button
                        onClick={() => handleTabClick(item.label)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-medium transition-all ${
                          isActive
                            ? 'bg-[#3a4a5f] text-white border-r-4 border-[#0078d4] font-semibold'
                            : 'text-[#c0c7d4] hover:bg-[#272a30] hover:text-[#e0e2ea]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={isActive ? 'text-[#a3c9ff]' : 'text-[#8a919e]'}>
                            {item.icon}
                          </span>
                          <span className="truncate">{item.label}</span>
                        </div>
                        {item.badgeText && (
                          <span className="bg-[#0078d4]/30 text-[#a3c9ff] border border-[#0078d4]/50 px-1.5 py-0.2 text-[9px] rounded font-mono font-bold shrink-0 ml-1">
                            {item.badgeText}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Nav items */}
      <div className="px-2 space-y-1 border-t border-[#404752] pt-2 shrink-0">
        {bottomNavItems.map((item) => {
          const isActive = activeTab === item.label;
          return (
            <button
              key={item.label}
              onClick={() => handleTabClick(item.label)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded text-xs font-medium transition-all ${
                isActive
                  ? 'bg-[#3a4a5f] text-white border-r-4 border-[#0078d4] font-semibold'
                  : 'text-[#c0c7d4] hover:bg-[#272a30] hover:text-[#e0e2ea]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={isActive ? 'text-[#a3c9ff]' : 'text-[#8a919e]'}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </div>
              {item.badge && item.badge > 0 ? (
                <span className="bg-[#0078d4] text-white px-1.5 py-0.2 text-[10px] rounded font-bold">
                  {item.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
