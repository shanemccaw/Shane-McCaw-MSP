import React, { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { Tenant, IntentFeedItem, ViewMode } from '@/components/msp-tenants/types';
import { INITIAL_TENANTS, INITIAL_INTENT_FEED } from '@/components/msp-tenants/mockTenants';
import { MomentumRibbon } from '@/components/msp-tenants/MomentumRibbon';
import { TenantTable } from '@/components/msp-tenants/TenantTable';
import { TenantGridCardView } from '@/components/msp-tenants/TenantGridCardView';
import { TenantMapView } from '@/components/msp-tenants/TenantMapView';
import { IntentFeed } from '@/components/msp-tenants/IntentFeed';
import { CopilotAdvice } from '@/components/msp-tenants/CopilotAdvice';
import { StatusBar } from '@/components/msp-tenants/StatusBar';

// Modals
import { CommandPalette } from '@/components/msp-tenants/modals/CommandPalette';
import { TriageModal } from '@/components/msp-tenants/modals/TriageModal';
import { TerminalModal } from '@/components/msp-tenants/modals/TerminalModal';
import { NewDeploymentModal } from '@/components/msp-tenants/modals/NewDeploymentModal';
import { RemediationScriptModal } from '@/components/msp-tenants/modals/RemediationScriptModal';
import { OpsManualModal } from '@/components/msp-tenants/modals/OpsManualModal';
import { TenantDetailModal } from '@/components/msp-tenants/modals/TenantDetailModal';

export default function MspTenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>(INITIAL_TENANTS);
  const [feedItems, setFeedItems] = useState<IntentFeedItem[]>(INITIAL_INTENT_FEED);
  const [viewMode, setViewMode] = useState<ViewMode>('list'); // Default table/list view matching the high-density grid in design
  const [searchQuery, setSearchQuery] = useState('');
  const [isFilteringCritical, setIsFilteringCritical] = useState(false);

  // Modals state
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [newDeploymentOpen, setNewDeploymentOpen] = useState(false);
  const [remediationScriptOpen, setRemediationScriptOpen] = useState(false);
  const [opsManualOpen, setOpsManualOpen] = useState(false);
  const [triageTenant, setTriageTenant] = useState<Tenant | null>(null);
  const [terminalTenant, setTerminalTenant] = useState<Tenant | null>(null);
  const [tenantDetail, setTenantDetail] = useState<Tenant | null>(null);

  // Filtered Tenants List
  const filteredTenants = tenants.filter((tenant) => {
    if (isFilteringCritical && tenant.status !== 'critical') {
      return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      tenant.name.toLowerCase().includes(q) ||
      tenant.id.toLowerCase().includes(q) ||
      tenant.primaryDomain.toLowerCase().includes(q)
    );
  });

  // Handlers
  const handleAutoRemediate = (tenantId: string) => {
    setTenants((prev) =>
      prev.map((t) => {
        if (t.id === tenantId) {
          return {
            ...t,
            status: 'healthy',
            secureScore: 88,
            securePtsDelta: 14,
            incidentsCount: 0,
            failedWorkflowsDetails: [],
            automation: {
              text: 'Remediated Baseline Active',
              count: 110,
            },
          };
        }
        return t;
      })
    );

    // Push Auto-fix event log
    const targetTenant = tenants.find((t) => t.id === tenantId);
    const newLog: IntentFeedItem = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
      type: 'AUTO-FIX',
      tenantName: targetTenant?.name || 'Tenant',
      message: `Emergency auto-remediation executed on '${targetTenant?.name}'. Baseline policies restored.`,
    };
    setFeedItems((prev) => [newLog, ...prev]);
  };

  const handleOrchestrateSync = (tenantId: string) => {
    setTenants((prev) =>
      prev.map((t) => {
        if (t.id === tenantId) {
          return {
            ...t,
            automation: {
              text: 'Policy Sync Complete',
              count: 98,
            },
            status: 'healthy',
            secureScore: 82,
          };
        }
        return t;
      })
    );
  };

  const handleDeployTenant = (newTenantData: Partial<Tenant>) => {
    const fullTenant = newTenantData as Tenant;
    setTenants((prev) => [fullTenant, ...prev]);

    const newLog: IntentFeedItem = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
      type: 'SIGNAL',
      tenantName: fullTenant.name,
      message: `New tenant '${fullTenant.name}' deployed with Obsidian Zero-Trust Baseline.`,
    };
    setFeedItems((prev) => [newLog, ...prev]);
  };

  const handleAddLogNote = (note: string) => {
    const newLog: IntentFeedItem = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
      type: 'SIGNAL',
      tenantName: 'MSP Admin',
      message: `Admin Note: ${note}`,
    };
    setFeedItems((prev) => [newLog, ...prev]);
  };

  return (
    <AppShell title="Tenant Orchestration">
      <div className="bg-[#0c0e11] text-[#e2e2e6] font-sans selection:bg-[#99cbff] selection:text-[#003355] min-h-screen">
        {/* Main Content Area */}
        <div className="p-4 md:p-6 pb-20">
          {/* Momentum Ribbon */}
          <MomentumRibbon
            activeTriageCount={tenants.filter((t) => t.status === 'critical').length}
            onFilterCritical={() => setIsFilteringCritical(!isFilteringCritical)}
            isFilteringCritical={isFilteringCritical}
          />

          {/* Header & Controls */}
          <div className="flex flex-wrap items-center justify-between mb-6 gap-4">
            <div>
              <h1 className="font-sans font-semibold text-2xl md:text-[28px] text-[#e2e2e6] tracking-tight">
                Tenant Orchestration
              </h1>
              <p className="text-[#bfc7d3]/50 text-xs font-sans mt-1">
                Real-time observability across {tenants.length} managed environments.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tenants..."
                className="bg-[#1a1c1f] border border-white/10 rounded-lg px-3 py-2 text-xs text-[#e2e2e6] placeholder-[#bfc7d3]/40 focus:outline-none font-sans"
              />

              {/* View Switcher */}
              <div className="flex rounded-lg border border-white/10 p-1 glass-dark">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-3 py-1.5 text-[11px] font-mono uppercase rounded-md transition-colors ${
                    viewMode === 'grid'
                      ? 'bg-[#99cbff]/20 text-[#99cbff] font-bold'
                      : 'text-[#bfc7d3] hover:text-[#e2e2e6]'
                  }`}
                >
                  Grid
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-3 py-1.5 text-[11px] font-mono uppercase rounded-md transition-colors ${
                    viewMode === 'list'
                      ? 'bg-[#99cbff]/20 text-[#99cbff] font-bold'
                      : 'text-[#bfc7d3] hover:text-[#e2e2e6]'
                  }`}
                >
                  List
                </button>
                <button
                  onClick={() => setViewMode('map')}
                  className={`px-3 py-1.5 text-[11px] font-mono uppercase rounded-md transition-colors ${
                    viewMode === 'map'
                      ? 'bg-[#99cbff]/20 text-[#99cbff] font-bold'
                      : 'text-[#bfc7d3] hover:text-[#e2e2e6]'
                  }`}
                >
                  Map
                </button>
              </div>

              {/* New Deployment Button */}
              <button
                onClick={() => setNewDeploymentOpen(true)}
                className="bg-[#99cbff] text-[#003355] font-mono text-[11px] font-bold px-4 md:px-5 py-2.5 rounded-lg uppercase tracking-wider flex items-center gap-2 hover:brightness-110 transition-all shadow-[0_4px_12px_rgba(153,203,255,0.2)]"
              >
                <span className="material-symbols-outlined text-sm">add_box</span>
                New Deployment
              </button>
            </div>
          </div>

          {/* Render Active View */}
          {viewMode === 'list' && (
            <TenantTable
              tenants={filteredTenants}
              onOpenTriage={(t) => setTriageTenant(t)}
              onOpenTerminal={(t) => setTerminalTenant(t)}
              onSelectTenantDetail={(t) => setTenantDetail(t)}
              onOrchestrateSync={handleOrchestrateSync}
            />
          )}

          {viewMode === 'grid' && (
            <TenantGridCardView
              tenants={filteredTenants}
              onOpenTriage={(t) => setTriageTenant(t)}
              onOpenTerminal={(t) => setTerminalTenant(t)}
              onSelectTenantDetail={(t) => setTenantDetail(t)}
            />
          )}

          {viewMode === 'map' && (
            <TenantMapView tenants={filteredTenants} onSelectTenant={(t) => setTenantDetail(t)} />
          )}

          {/* Lower Panels: Intent Feed & Copilot Advice */}
          <div className="mt-6 flex flex-col lg:flex-row gap-6">
            <IntentFeed feedItems={feedItems} onAddLogNote={handleAddLogNote} />
            <CopilotAdvice onGenerateScript={() => setRemediationScriptOpen(true)} />
          </div>
        </div>

        {/* Bottom Status Bar */}
        <StatusBar
          highIncidentsCount={tenants.reduce((acc, t) => acc + t.incidentsCount, 0)}
          alertsCount={feedItems.filter((f) => f.type === 'ALERT').length}
          messagesCount={8}
          activeWorkflowsCount={1248}
        />

        {/* Modals */}
        <CommandPalette
          isOpen={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          tenants={tenants}
          onSelectTenant={(t) => setTenantDetail(t)}
          onOpenNewDeployment={() => setNewDeploymentOpen(true)}
          onOpenOpsManual={() => setOpsManualOpen(true)}
          onGenerateScript={() => setRemediationScriptOpen(true)}
        />

        <TriageModal
          tenant={triageTenant}
          onClose={() => setTriageTenant(null)}
          onAutoRemediate={handleAutoRemediate}
        />

        <TerminalModal tenant={terminalTenant} onClose={() => setTerminalTenant(null)} />

        <NewDeploymentModal
          isOpen={newDeploymentOpen}
          onClose={() => setNewDeploymentOpen(false)}
          onDeployTenant={handleDeployTenant}
        />

        <RemediationScriptModal
          isOpen={remediationScriptOpen}
          onClose={() => setRemediationScriptOpen(false)}
        />

        <OpsManualModal isOpen={opsManualOpen} onClose={() => setOpsManualOpen(false)} />

        <TenantDetailModal
          tenant={tenantDetail}
          onClose={() => setTenantDetail(null)}
          onOpenTerminal={(t) => {
            setTenantDetail(null);
            setTerminalTenant(t);
          }}
          onOpenTriage={(t) => {
            setTenantDetail(null);
            setTriageTenant(t);
          }}
        />
      </div>
    </AppShell>
  );
}
