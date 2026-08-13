// @ts-nocheck
import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Check,
  Zap,
  Building2,
  KeyRound,
  Users,
  Laptop,
  Mail,
  Layers,
  DollarSign,
  Crown,
  Shield,
  FolderGit2,
  MessageSquare,
  Globe,
  UserCheck,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  X,
  Activity,
  Clock,
  AlertTriangle,
  Terminal,
  SlidersHorizontal,
  RotateCw,
  Filter,
  Sparkles,
  Info,
  CheckCircle2,
  Code2,
  Send,
  History,
  Sliders,
} from 'lucide-react';
import { Tenant } from '../types';
import {
  M365_ACTION_REGISTRY,
  M365ActionItem,
  M365DomainCategory,
  SafetyLevel,
} from '../m365ActionRegistry';

interface GlobalAdminCommandCenterViewProps {
  tenants: Tenant[];
  selectedTenant?: Tenant | null;
  onSelectTenant: (tenant: Tenant | null) => void;
  onDispatchWorkflow?: (actionId: string, payload: any) => void;
  onShowToast?: (type: 'success' | 'info' | 'warning' | 'error', title: string, desc: string) => void;
}

export const GlobalAdminCommandCenterView: React.FC<GlobalAdminCommandCenterViewProps> = ({
  tenants,
  selectedTenant,
  onSelectTenant,
  onDispatchWorkflow,
  onShowToast,
}) => {
  const activeTenant = selectedTenant || tenants[0] || {
    id: 'contoso-01',
    name: 'Contoso Corporation',
    primaryDomain: 'contosocorp.com',
    tenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47',
  };

  // State Management
  const [selectedCategory, setSelectedCategory] = useState<M365DomainCategory | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [safetyFilter, setSafetyFilter] = useState<'ALL' | SafetyLevel>('ALL');

  // Selected action for right detail panel
  const [selectedAction, setSelectedAction] = useState<M365ActionItem | null>(M365_ACTION_REGISTRY[0]);

  // Modal State for Workflow Execution
  const [workflowModalAction, setWorkflowModalAction] = useState<M365ActionItem | null>(null);
  const [ticketIdInput, setTicketIdInput] = useState('');
  const [reasoningInput, setReasoningInput] = useState('');
  const [targetUPNInput, setTargetUPNInput] = useState(`admin@${activeTenant.primaryDomain || 'contosocorp.com'}`);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionSuccess, setExecutionSuccess] = useState(false);

  // Command K Palette state
  const [isCmdKOpen, setIsCmdKOpen] = useState(false);
  const [cmdKSearch, setCmdKSearch] = useState('');

  // Right Detail Panel Tab
  const [detailTab, setDetailTab] = useState<'Overview' | 'History' | 'Schema'>('Overview');

  // Handle Cmd+K Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCmdKOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Filter actions based on Category, Search Query, and Safety Filter
  const filteredActions = useMemo(() => {
    return M365_ACTION_REGISTRY.filter((item) => {
      const matchesCategory = selectedCategory === 'ALL' || item.category === selectedCategory;
      const matchesSafety = safetyFilter === 'ALL' || item.safetyLevel === safetyFilter;
      const queryLower = searchQuery.toLowerCase();
      const matchesSearch =
        item.name.toLowerCase().includes(queryLower) ||
        item.description.toLowerCase().includes(queryLower) ||
        item.category.toLowerCase().includes(queryLower) ||
        item.apiEndpoint.toLowerCase().includes(queryLower);
      return matchesCategory && matchesSafety && matchesSearch;
    });
  }, [selectedCategory, safetyFilter, searchQuery]);

  // All Domain Categories List
  const domainCategories: M365DomainCategory[] = [
    'App Registrations',
    'Auth & MFA',
    'Conditional Access',
    'Devices & Intune',
    'Exchange & Mailbox',
    'Groups & Distribution',
    'Licensing & Billing',
    'PIM & Privileged Roles',
    'Security & Defender',
    'SharePoint & OneDrive',
    'Teams & Collaboration',
    'Tenant & GDAP',
    'Users & Provisioning',
  ];

  // Domain Icon Resolver
  const getDomainIcon = (cat: M365DomainCategory, className = 'w-4 h-4') => {
    switch (cat) {
      case 'App Registrations':
        return <FolderGit2 className={className} />;
      case 'Auth & MFA':
        return <KeyRound className={className} />;
      case 'Conditional Access':
        return <ShieldCheck className={className} />;
      case 'Devices & Intune':
        return <Laptop className={className} />;
      case 'Exchange & Mailbox':
        return <Mail className={className} />;
      case 'Groups & Distribution':
        return <Users className={className} />;
      case 'Licensing & Billing':
        return <DollarSign className={className} />;
      case 'PIM & Privileged Roles':
        return <Crown className={className} />;
      case 'Security & Defender':
        return <Shield className={className} />;
      case 'SharePoint & OneDrive':
        return <Layers className={className} />;
      case 'Teams & Collaboration':
        return <MessageSquare className={className} />;
      case 'Tenant & GDAP':
        return <Globe className={className} />;
      case 'Users & Provisioning':
        return <UserCheck className={className} />;
      default:
        return <Zap className={className} />;
    }
  };

  // Safety Badge Renderer
  const renderSafetyBadge = (level: SafetyLevel) => {
    if (level === 'safe') {
      return (
        <span className="bg-[#052e16] text-[#4ade80] border border-[#166534] px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 font-mono">
          <ShieldCheck className="w-3 h-3 text-[#4ade80]" />
          Safe
        </span>
      );
    }
    if (level === 'gated') {
      return (
        <span className="bg-[#451a03] text-[#fb923c] border border-[#9a3412] px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 font-mono">
          <Lock className="w-3 h-3 text-[#fb923c]" />
          Gated
        </span>
      );
    }
    return (
      <span className="bg-[#93000a] text-white border border-[#ffb4ab]/50 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 font-mono">
        <ShieldAlert className="w-3 h-3 text-white" />
        Blocked
      </span>
    );
  };

  // Launch Workflow Modal
  const handleOpenWorkflowModal = (action: M365ActionItem) => {
    setWorkflowModalAction(action);
    setTicketIdInput(`INC-${Math.floor(1000 + Math.random() * 9000)}`);
    setReasoningInput(`Requested maintenance and security enforcement on ${activeTenant.name}`);
    setIsExecuting(false);
    setExecutionSuccess(false);
  };

  // Execute Workflow Submission
  const handleConfirmExecute = () => {
    if (!workflowModalAction) return;
    setIsExecuting(true);

    const payload = {
      tenantId: activeTenant.tenantId,
      actionId: workflowModalAction.id,
      actionName: workflowModalAction.name,
      ticketId: ticketIdInput || 'INC-UNKNOWN',
      reasoning: reasoningInput,
      targetUPN: targetUPNInput,
      executedAt: new Date().toISOString(),
    };

    if (onDispatchWorkflow) {
      onDispatchWorkflow(workflowModalAction.id, payload);
    }

    setTimeout(() => {
      setIsExecuting(false);
      setExecutionSuccess(true);

      // Add to history
      workflowModalAction.history.unshift({
        executedBy: 'm.vance@msp.com',
        timestamp: 'Just now',
        ticketId: ticketIdInput || 'INC-9999',
        status: 'Success',
      });

      if (onShowToast) {
        onShowToast(
          'success',
          'Workflow Dispatched',
          `Executed '${workflowModalAction.name}' against ${activeTenant.name}. Ticket: ${ticketIdInput}`
        );
      }

      setTimeout(() => {
        setWorkflowModalAction(null);
        setExecutionSuccess(false);
      }, 1200);
    }, 1000);
  };

  return (
    <div className="flex-1 p-4 space-y-4 overflow-y-auto text-[#e0e2ea] bg-[#0b0e14]">
      {/* Top Header & Context Bar */}
      <div className="bg-[#181c22] border border-[#404752] rounded-lg p-3.5 shadow-md flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0078d4]/20 border border-[#0078d4]/50 flex items-center justify-center text-[#a3c9ff] shadow-inner">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#e0e2ea] tracking-tight flex items-center gap-2">
              <span>Global Admin Command Center</span>
              <span className="text-[10px] bg-[#0078d4]/20 text-[#a3c9ff] border border-[#0078d4]/40 px-2 py-0.5 rounded font-mono font-semibold">
                80+ Write Functions
              </span>
            </h1>
            <p className="text-xs text-[#8a919e] mt-0.5">
              Execute privileged M365 Graph, Exchange, Intune &amp; Defender workflows with gated audit compliance.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Tenant Selector */}
          <div className="flex items-center gap-2 bg-[#101419] border border-[#404752] px-3 py-1.5 rounded-md text-xs">
            <Building2 className="w-3.5 h-3.5 text-[#a3c9ff]" />
            <span className="text-[#8a919e]">Target Tenant:</span>
            <select
              value={activeTenant.id}
              onChange={(e) => {
                const found = tenants.find((t) => t.id === e.target.value);
                if (found) onSelectTenant(found);
              }}
              className="bg-transparent font-bold text-[#e0e2ea] focus:outline-none cursor-pointer"
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#181c22] text-[#e0e2ea]">
                  {t.name} ({t.primaryDomain})
                </option>
              ))}
            </select>
          </div>

          {/* Cmd+K Launcher Button */}
          <button
            onClick={() => setIsCmdKOpen(true)}
            className="bg-[#0078d4] hover:bg-[#0060ab] text-white px-3 py-1.5 rounded text-xs font-semibold transition-colors flex items-center gap-2 shadow-md"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Search 80+ Tools</span>
            <kbd className="bg-black/30 text-white/90 px-1.5 py-0.2 text-[10px] rounded font-mono">⌘K</kbd>
          </button>
        </div>
      </div>

      {/* 1. Command Palette & Instant Filter Bar */}
      <div className="bg-[#101419] border border-[#404752] rounded-lg p-3 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Search Input Bar */}
          <div className="relative flex-1 min-w-[280px]">
            <Search className="w-4 h-4 text-[#8a919e] absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter actions by name, API endpoint, or description (e.g. 'FIDO2', 'BitLocker', 'Purge')..."
              className="w-full bg-[#181c22] border border-[#404752] rounded-md pl-9 pr-3 py-1.5 text-xs text-[#e0e2ea] placeholder-[#8a919e] focus:outline-none focus:border-[#0078d4]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-[#8a919e] hover:text-[#e0e2ea]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Safety Level Filter Pills */}
          <div className="flex items-center gap-1.5 text-xs bg-[#181c22] p-1 rounded-md border border-[#404752]">
            <span className="text-[10px] text-[#8a919e] font-bold px-1.5 uppercase font-mono">Safety:</span>
            {(['ALL', 'safe', 'gated', 'blocked'] as const).map((level) => (
              <button
                key={level}
                onClick={() => setSafetyFilter(level)}
                className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase transition-colors font-mono ${
                  safetyFilter === level
                    ? 'bg-[#0078d4] text-white shadow-xs'
                    : 'text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#272a30]'
                }`}
              >
                {level}
              </button>
            ))}
          </div>

          <div className="text-xs font-mono text-[#8a919e]">
            Showing <strong className="text-[#a3c9ff]">{filteredActions.length}</strong> / {M365_ACTION_REGISTRY.length} Actions
          </div>
        </div>
      </div>

      {/* 2. Main Categorized Layout (Sidebar Navigation + Grid + Right Detail Panel) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Domain Category Sidebar (2.5 Cols) */}
        <div className="lg:col-span-3 bg-[#101419] border border-[#404752] rounded-lg p-2 space-y-1 shadow-sm">
          <div className="px-3 py-2 border-b border-[#404752] flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#8a919e] font-mono">
              Domains ({domainCategories.length})
            </span>
            <button
              onClick={() => setSelectedCategory('ALL')}
              className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded transition-colors ${
                selectedCategory === 'ALL'
                  ? 'bg-[#0078d4] text-white'
                  : 'text-[#8a919e] hover:text-[#e0e2ea] bg-[#181c22]'
              }`}
            >
              All Domains
            </button>
          </div>

          <div className="space-y-0.5 max-h-[640px] overflow-y-auto pr-1">
            {domainCategories.map((cat) => {
              const count = M365_ACTION_REGISTRY.filter((a) => a.category === cat).length;
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`w-full text-left px-2.5 py-2 rounded text-xs font-medium transition-all flex items-center justify-between group ${
                    isSelected
                      ? 'bg-[#0078d4] text-white font-bold shadow-sm'
                      : 'text-[#c0c7d4] hover:bg-[#181c22] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className={isSelected ? 'text-white' : 'text-[#a3c9ff] group-hover:text-white'}>
                      {getDomainIcon(cat, 'w-3.5 h-3.5')}
                    </span>
                    <span className="truncate">{cat}</span>
                  </div>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-bold ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-[#181c22] text-[#8a919e]'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Middle Main Tool Cards Grid (5.5 Cols) */}
        <div className="lg:col-span-6 space-y-3">
          {filteredActions.length === 0 ? (
            <div className="bg-[#101419] border border-[#404752] rounded-lg p-8 text-center space-y-2">
              <Search className="w-8 h-8 text-[#8a919e] mx-auto opacity-50" />
              <h3 className="text-sm font-bold text-[#e0e2ea]">No Matching M365 Actions Found</h3>
              <p className="text-xs text-[#8a919e]">
                Try adjusting your search query or safety level filter to discover more tools.
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSafetyFilter('ALL');
                  setSelectedCategory('ALL');
                }}
                className="mt-2 bg-[#0078d4] hover:bg-[#0060ab] text-white text-xs px-3 py-1.5 rounded font-semibold transition-colors"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredActions.map((action) => {
                const isSelected = selectedAction?.id === action.id;
                return (
                  <div
                    key={action.id}
                    onClick={() => setSelectedAction(action)}
                    className={`bg-[#181c22] border rounded-lg p-3.5 space-y-2.5 transition-all cursor-pointer hover:border-[#0078d4] shadow-sm relative group ${
                      isSelected ? 'border-[#0078d4] ring-1 ring-[#0078d4]/50 bg-[#1e232b]' : 'border-[#404752]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded bg-[#101419] border border-[#404752] text-[#a3c9ff]">
                          {getDomainIcon(action.category, 'w-4 h-4')}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-xs text-[#e0e2ea] group-hover:text-[#a3c9ff] transition-colors">
                              {action.name}
                            </h3>
                          </div>
                          <span className="text-[10px] text-[#8a919e] font-mono bg-[#101419] px-1.5 py-0.2 rounded border border-[#272a30]">
                            {action.category}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {renderSafetyBadge(action.safetyLevel)}
                        <span className="bg-[#272a30] text-[#c0c7d4] text-[10px] px-1.5 py-0.5 rounded font-mono border border-[#404752]">
                          {action.minTier}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-[#8a919e] line-clamp-2">{action.description}</p>

                    <div className="pt-2 border-t border-[#404752]/50 flex items-center justify-between text-xs">
                      <span className="text-[10px] text-[#8a919e] font-mono truncate max-w-[240px]">
                        {action.apiEndpoint}
                      </span>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAction(action);
                          }}
                          className="text-[11px] font-semibold text-[#8a919e] hover:text-[#e0e2ea] px-2 py-1"
                        >
                          Details
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenWorkflowModal(action);
                          }}
                          className="bg-[#0078d4] hover:bg-[#0060ab] text-white px-2.5 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1 shadow-xs"
                        >
                          <Zap className="w-3 h-3" />
                          <span>Run Action</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Tool Detail Panel (3.5 Cols) */}
        <div className="lg:col-span-3 bg-[#101419] border border-[#404752] rounded-lg p-3.5 space-y-3 shadow-sm sticky top-4">
          {selectedAction ? (
            <div className="space-y-3">
              {/* Tool Header */}
              <div className="border-b border-[#404752] pb-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-[#a3c9ff] bg-[#0078d4]/10 border border-[#0078d4]/30 px-2 py-0.5 rounded font-semibold">
                    {selectedAction.category}
                  </span>
                  {renderSafetyBadge(selectedAction.safetyLevel)}
                </div>

                <h2 className="text-sm font-bold text-[#e0e2ea]">{selectedAction.name}</h2>
                <p className="text-xs text-[#8a919e]">{selectedAction.description}</p>
              </div>

              {/* Detail Navigation Tabs */}
              <div className="flex items-center gap-1 border-b border-[#404752] pb-2 text-xs">
                {(['Overview', 'History', 'Schema'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setDetailTab(tab)}
                    className={`px-2.5 py-1 font-semibold rounded transition-colors ${
                      detailTab === tab
                        ? 'bg-[#0078d4] text-white'
                        : 'text-[#8a919e] hover:text-[#e0e2ea] hover:bg-[#181c22]'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Tab 1: Overview */}
              {detailTab === 'Overview' && (
                <div className="space-y-3 text-xs">
                  {/* Minimum License Requirement */}
                  <div className="bg-[#181c22] p-2.5 rounded border border-[#404752] space-y-1">
                    <div className="text-[10px] text-[#8a919e] font-mono uppercase font-bold">
                      Minimum Required License Tier
                    </div>
                    <div className="font-bold text-[#a3c9ff] flex items-center gap-1.5">
                      <Crown className="w-3.5 h-3.5 text-[#fb923c]" />
                      <span>{selectedAction.minTier}</span>
                    </div>
                  </div>

                  {/* API Endpoint & Category */}
                  <div className="bg-[#181c22] p-2.5 rounded border border-[#404752] space-y-1 font-mono">
                    <div className="text-[10px] text-[#8a919e] uppercase font-bold">Graph / Exchange API Path</div>
                    <div className="text-[11px] text-[#4ade80] break-all bg-[#080a0e] p-1.5 rounded border border-[#272a30]">
                      {selectedAction.apiEndpoint}
                    </div>
                  </div>

                  {/* Impact Analysis */}
                  <div className="bg-[#181c22] p-2.5 rounded border border-[#404752] space-y-1">
                    <div className="text-[10px] text-[#fb923c] font-mono uppercase font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-[#fb923c]" />
                      <span>Impact Analysis</span>
                    </div>
                    <p className="text-[11px] text-[#c0c7d4] leading-relaxed">{selectedAction.impactAnalysis}</p>
                  </div>

                  {/* Action Button */}
                  <button
                    onClick={() => handleOpenWorkflowModal(selectedAction)}
                    className="w-full bg-[#0078d4] hover:bg-[#0060ab] text-white py-2 px-3 rounded font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Execute Workflow Action</span>
                  </button>
                </div>
              )}

              {/* Tab 2: History */}
              {detailTab === 'History' && (
                <div className="space-y-2 text-xs">
                  <div className="text-[10px] text-[#8a919e] font-mono uppercase font-bold">
                    Last Executions on {activeTenant.name}
                  </div>

                  {selectedAction.history.length === 0 ? (
                    <div className="bg-[#181c22] p-4 rounded text-center text-[#8a919e] text-xs">
                      No recent executions logged on this tenant.
                    </div>
                  ) : (
                    selectedAction.history.map((h, i) => (
                      <div key={i} className="bg-[#181c22] p-2.5 rounded border border-[#404752] space-y-1 font-mono">
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-[#a3c9ff] font-bold">{h.ticketId}</span>
                          <span className="text-[#4ade80] bg-[#052e16] px-1.5 py-0.2 rounded border border-[#166534]">
                            {h.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#e0e2ea]">{h.executedBy}</div>
                        <div className="text-[10px] text-[#8a919e]">{h.timestamp}</div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab 3: Schema */}
              {detailTab === 'Schema' && (
                <div className="space-y-2 text-xs font-mono">
                  <div className="text-[10px] text-[#8a919e] uppercase font-bold">JSON Payload Blueprint</div>
                  <pre className="bg-[#080a0e] p-3 rounded border border-[#272a30] text-[#a3c9ff] text-[10px] overflow-x-auto">
                    {JSON.stringify(
                      {
                        actionId: selectedAction.id,
                        targetTenantId: activeTenant.tenantId,
                        endpoint: selectedAction.apiEndpoint,
                        parameters: {
                          targetUPN: `admin@${activeTenant.primaryDomain}`,
                          safetyLevel: selectedAction.safetyLevel,
                          requiredTicketId: "INC-XXXX",
                        },
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center p-6 text-[#8a919e] text-xs space-y-2">
              <Info className="w-6 h-6 mx-auto opacity-50" />
              <p>Select any action card from the center grid to inspect technical specifications and audit history.</p>
            </div>
          )}
        </div>
      </div>

      {/* 3. Execution Pattern: Workflow Confirmation Modal */}
      {workflowModalAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="fixed inset-0"
            onClick={() => {
              if (!isExecuting) setWorkflowModalAction(null);
            }}
          />
          <div className="relative w-full max-w-lg bg-[#181c22] border border-[#404752] rounded-lg shadow-2xl overflow-hidden z-10 text-xs space-y-4 p-5">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-[#404752] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded bg-[#101419] border border-[#404752] text-[#0078d4]">
                  <Zap className="w-5 h-5 text-[#a3c9ff]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-[#e0e2ea]">Workflow Confirmation</h2>
                    {renderSafetyBadge(workflowModalAction.safetyLevel)}
                  </div>
                  <p className="text-xs text-[#8a919e] font-mono mt-0.5">{workflowModalAction.name}</p>
                </div>
              </div>

              <button
                disabled={isExecuting}
                onClick={() => setWorkflowModalAction(null)}
                className="text-[#8a919e] hover:text-[#e0e2ea] p-1 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Target Tenant Box */}
            <div className="bg-[#101419] p-3 rounded border border-[#404752] space-y-1">
              <div className="text-[10px] text-[#8a919e] font-mono uppercase font-bold">Target Tenant Context</div>
              <div className="font-bold text-[#a3c9ff] flex items-center justify-between">
                <span>{activeTenant.name}</span>
                <span className="font-mono text-[11px] text-[#8a919e]">{activeTenant.primaryDomain}</span>
              </div>
            </div>

            {/* Impact Analysis Box */}
            <div className="bg-[#451a03]/30 border border-[#9a3412]/60 p-3 rounded space-y-1">
              <div className="text-[10px] text-[#fb923c] font-mono uppercase font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-[#fb923c]" />
                <span>Impact Analysis (Required Review)</span>
              </div>
              <p className="text-xs text-[#ffdad6] leading-relaxed">{workflowModalAction.impactAnalysis}</p>
            </div>

            {/* Required Audit Log Inputs */}
            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-[11px] font-bold text-[#e0e2ea] mb-1 font-mono">
                  ConnectWise / Autotask Ticket ID <span className="text-[#ffb4ab]">*</span>
                </label>
                <input
                  type="text"
                  value={ticketIdInput}
                  onChange={(e) => setTicketIdInput(e.target.value)}
                  placeholder="e.g. INC-8819 or CHG-4012"
                  className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4] font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#e0e2ea] mb-1 font-mono">
                  Technician Reason / Audit Trail Justification <span className="text-[#ffb4ab]">*</span>
                </label>
                <textarea
                  rows={2}
                  value={reasoningInput}
                  onChange={(e) => setReasoningInput(e.target.value)}
                  placeholder="Explain why this privileged write action is being triggered..."
                  className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#e0e2ea] mb-1 font-mono">Target UPN / Scope</label>
                <input
                  type="text"
                  value={targetUPNInput}
                  onChange={(e) => setTargetUPNInput(e.target.value)}
                  className="w-full bg-[#101419] border border-[#404752] rounded px-3 py-1.5 text-xs text-[#e0e2ea] focus:outline-none focus:border-[#0078d4] font-mono"
                />
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="pt-3 border-t border-[#404752] flex items-center justify-between">
              <button
                disabled={isExecuting}
                onClick={() => setWorkflowModalAction(null)}
                className="bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] px-4 py-1.5 rounded font-semibold text-xs border border-[#404752]"
              >
                Cancel
              </button>

              <button
                disabled={isExecuting || !ticketIdInput || !reasoningInput}
                onClick={handleConfirmExecute}
                className={`px-4 py-1.5 rounded font-bold text-xs transition-colors flex items-center gap-1.5 shadow-md ${
                  executionSuccess
                    ? 'bg-[#166534] text-white'
                    : 'bg-[#0078d4] hover:bg-[#0060ab] text-white disabled:opacity-50'
                }`}
              >
                {isExecuting ? (
                  <>
                    <RotateCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Dispatching Workflow...</span>
                  </>
                ) : executionSuccess ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#4ade80]" />
                    <span>Workflow Dispatched!</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Execute Workflow Engine</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Command K Search Dialog Modal */}
      {isCmdKOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/70 backdrop-blur-xs">
          <div className="fixed inset-0" onClick={() => setIsCmdKOpen(false)} />
          <div className="relative w-full max-w-2xl bg-[#181c22] border border-[#404752] rounded-lg shadow-2xl overflow-hidden z-10 text-xs">
            <div className="p-3 border-b border-[#404752] flex items-center gap-2 bg-[#101419]">
              <Search className="w-4 h-4 text-[#8a919e]" />
              <input
                type="text"
                autoFocus
                value={cmdKSearch}
                onChange={(e) => setCmdKSearch(e.target.value)}
                placeholder="Type to search 80+ M365 write functions (e.g. FIDO2, Wipe, BitLocker, Passkey)..."
                className="bg-transparent border-none text-[#e0e2ea] placeholder-[#8a919e] w-full focus:outline-none text-xs font-medium"
              />
              <button
                onClick={() => setIsCmdKOpen(false)}
                className="text-[#8a919e] hover:text-[#e0e2ea] text-[10px] font-mono bg-[#272a30] px-1.5 py-0.5 rounded"
              >
                ESC
              </button>
            </div>

            <div className="p-2 max-h-96 overflow-y-auto space-y-1">
              {M365_ACTION_REGISTRY.filter(
                (item) =>
                  item.name.toLowerCase().includes(cmdKSearch.toLowerCase()) ||
                  item.category.toLowerCase().includes(cmdKSearch.toLowerCase()) ||
                  item.description.toLowerCase().includes(cmdKSearch.toLowerCase())
              ).map((action) => (
                <div
                  key={action.id}
                  onClick={() => {
                    setSelectedAction(action);
                    handleOpenWorkflowModal(action);
                    setIsCmdKOpen(false);
                  }}
                  className="p-2.5 rounded hover:bg-[#272a30] text-[#e0e2ea] flex items-center justify-between cursor-pointer group transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded bg-[#101419] border border-[#404752] text-[#a3c9ff]">
                      {getDomainIcon(action.category, 'w-3.5 h-3.5')}
                    </div>
                    <div>
                      <div className="font-bold text-xs group-hover:text-[#a3c9ff] transition-colors">
                        {action.name}
                      </div>
                      <div className="text-[10px] text-[#8a919e] font-mono">{action.apiEndpoint}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {renderSafetyBadge(action.safetyLevel)}
                    <ChevronRight className="w-4 h-4 text-[#8a919e] group-hover:text-[#a3c9ff]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


