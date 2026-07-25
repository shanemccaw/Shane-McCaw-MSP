/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar, NavTab } from './components/Sidebar';
import { KPICards } from './components/KPICards';
import { TenantTable } from './components/TenantTable';
import { ThreatFeed } from './components/ThreatFeed';
import { RemediationModal } from './components/RemediationModal';
import { TenantDetailDrawer } from './components/TenantDetailDrawer';
import { PendingRemediationsModal } from './components/PendingRemediationsModal';
import { ToastContainer } from './components/ToastContainer';
import { PortalNavigationShell } from './components/PortalNavigationShell';

// Sub Views
import { TenantsView } from './components/views/TenantsView';
import { SecurityComplianceView } from './components/views/SecurityComplianceView';
import { HealthSyncView } from './components/views/HealthSyncView';
import { AutomationView } from './components/views/AutomationView';
import { LogsView } from './components/views/LogsView';
import { TenantPortalView } from './components/views/TenantPortalView';
import { M365AdminToolsView } from './components/views/M365AdminToolsView';
import { SingleTenantDashboard } from './components/views/SingleTenantDashboard';
import { MapView } from './components/views/MapView';
import { TenantHeatmapDashboard } from './components/views/TenantHeatmapDashboard';
import { FullTenantOverviewConsole } from './components/views/FullTenantOverviewConsole';
import { UserManagementConsole } from './components/views/UserManagementConsole';
import { DocumentLibraryConsole } from './components/views/DocumentLibraryConsole';
import { TenantScanTimelineCanvas } from './components/views/TenantScanTimelineCanvas';
import { MspBillingConsole } from './components/views/MspBillingConsole';
import { ChargebackConsole } from './components/views/ChargebackConsole';
import { SalesBundleConsole } from './components/views/SalesBundleConsole';
import { OfferPipelineConsole } from './components/views/OfferPipelineConsole';
import { M365MessageCenterConsole } from './components/views/M365MessageCenterConsole';
import { MicrosoftSlaConsole } from './components/views/MicrosoftSlaConsole';
import { SplitPaneAuditLogConsole } from './components/views/SplitPaneAuditLogConsole';
import { AlertsManagementConsole } from './components/views/AlertsManagementConsole';
import { MspToCustomerSlaConsole } from './components/views/MspToCustomerSlaConsole';
import { ScopeCreepConsole } from './components/views/ScopeCreepConsole';
import { RiskBasedDecisionConsole } from './components/views/RiskBasedDecisionConsole';
import { ChangeManagementConsole } from './components/views/ChangeManagementConsole';
import { StandardOperatingProceduresConsole } from './components/views/StandardOperatingProceduresConsole';
import { OperatorTasksConsole } from './components/views/OperatorTasksConsole';
import { ApprovalsConsole } from './components/views/ApprovalsConsole';
import { WorkflowRunsConsole } from './components/views/WorkflowRunsConsole';
import { DeadLetterQueueConsole } from './components/views/DeadLetterQueueConsole';
import { SupportChatConsole } from './components/views/SupportChatConsole';
import { OffboardingConsole } from './components/views/OffboardingConsole';
import { OnboardingMapConsole } from './components/views/OnboardingMapConsole';
import { WebhooksConsole } from './components/views/WebhooksConsole';
import { SettingsConsole } from './components/views/SettingsConsole';
import { SecurityPillarConsole } from './components/views/SecurityPillarConsole';
import { OwnerExecutiveConsole } from './components/views/OwnerExecutiveConsole';

// Mock Data
import {
  INITIAL_TENANTS,
  INITIAL_THREAT_FEED,
  INITIAL_PENDING_REMEDIATIONS,
  INITIAL_AUDIT_LOGS,
} from './data/mockData';

import {
  Tenant,
  ThreatFeedItem,
  PendingRemediation,
  AuditLogItem,
  ToastMessage,
} from './types';

export default function App() {
  // Main State
  const [tenants, setTenants] = useState<Tenant[]>(INITIAL_TENANTS);
  const [threatItems, setThreatItems] = useState<ThreatFeedItem[]>(INITIAL_THREAT_FEED);
  const [pendingRemediations, setPendingRemediations] = useState<PendingRemediation[]>(
    INITIAL_PENDING_REMEDIATIONS
  );
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>(INITIAL_AUDIT_LOGS);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Navigation & Scope State
  const [activeTab, setActiveTab] = useState<NavTab>('Overview');
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);

  // Filter States
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [tableSearchQuery, setTableSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [licenseFilter, setLicenseFilter] = useState('All Tiers');

  // Modal & Drawer States
  const [remediationModalConfig, setRemediationModalConfig] = useState<{
    item: ThreatFeedItem | null;
    tenant: Tenant | null;
    customTitle?: string;
  } | null>(null);

  const [detailDrawerTenant, setDetailDrawerTenant] = useState<Tenant | null>(null);
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);

  // Helper: Add Toast
  const addToast = (type: 'success' | 'info' | 'warning' | 'error', title: string, description: string) => {
    const newToast: ToastMessage = {
      id: `toast-${Date.now()}-${Math.random()}`,
      type,
      title,
      description,
      timestamp: new Date().toLocaleTimeString(),
    };
    setToasts((prev) => [newToast, ...prev]);

    // Auto dismiss after 5 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== newToast.id));
    }, 5000);
  };

  const handleDismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // KPI Calculations
  const totalTenantsCount = 142; // Fixed MSP total scope
  const averageSecureScore =
    tenants.reduce((acc, curr) => acc + curr.secureScore, 0) / tenants.length;
  const activeCriticalAlerts = tenants.reduce((acc, curr) => acc + curr.activeAlertsCount, 0);

  // Action Handlers
  const handleEnforceMFA = (tenant: Tenant) => {
    setRemediationModalConfig({
      item: null,
      tenant,
      customTitle: `Enforce MFA & Security Defaults for ${tenant.name}`,
    });
  };

  const handleRevokeSessions = (tenant: Tenant) => {
    setRemediationModalConfig({
      item: null,
      tenant,
      customTitle: `Revoke All OAuth Refresh Tokens for ${tenant.name}`,
    });
  };

  const handleResetPasswords = (tenant: Tenant) => {
    setRemediationModalConfig({
      item: null,
      tenant,
      customTitle: `Force Admin Password Reset & Re-auth for ${tenant.name}`,
    });
  };

  const handleRunInstantSync = (tenant: Tenant) => {
    // Immediate UI state update to 'Syncing'
    setTenants((prev) =>
      prev.map((t) => (t.id === tenant.id ? { ...t, syncStatus: 'Syncing' } : t))
    );

    addToast(
      'info',
      'Microsoft Graph Delta Sync Triggered',
      `Connecting to Azure AD Connect API endpoint for ${tenant.name}...`
    );

    // Simulate completion
    setTimeout(() => {
      setTenants((prev) =>
        prev.map((t) =>
          t.id === tenant.id
            ? { ...t, syncStatus: 'Healthy', lastSyncTimestamp: 'Just now' }
            : t
        )
      );

      const newLog: AuditLogItem = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        tenantName: tenant.name,
        initiatedBy: 'Global Admin (MSP Portal)',
        action: 'Graph Delta Sync Triggered',
        status: 'SUCCESS',
        details: 'Identity sync cycle completed with zero directory drift errors.',
      };
      setAuditLogs((prev) => [newLog, ...prev]);

      addToast(
        'success',
        'Directory Sync Completed',
        `${tenant.name} is now fully synchronized with Entra ID.`
      );
    }, 1800);
  };

  // Remediation Confirmation
  const handleConfirmRemediation = (actionTitle: string) => {
    const config = remediationModalConfig;
    const targetTenant = config?.tenant || (config?.item ? tenants.find(t => t.name === config.item?.tenantName) : null);
    const tenantName = targetTenant?.name || config?.item?.tenantName || 'Selected Tenant';

    // Update Tenant Health metrics
    if (targetTenant) {
      setTenants((prev) =>
        prev.map((t) =>
          t.id === targetTenant.id
            ? {
                ...t,
                mfaPercentage: Math.min(100, t.mfaPercentage + 25),
                secureScore: Math.min(95, parseFloat((t.secureScore + 5.2).toFixed(1))),
                activeAlertsCount: Math.max(0, t.activeAlertsCount - 1),
                syncStatus: 'Healthy',
              }
            : t
        )
      );
    }

    // Mark threat feed item resolved if applicable
    if (config?.item) {
      setThreatItems((prev) =>
        prev.map((item) =>
          item.id === config.item!.id ? { ...item, status: 'RESOLVED' } : item
        )
      );
    }

    // Record Audit Log
    const newLog: AuditLogItem = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      tenantName,
      initiatedBy: 'Global Admin (m.vance@msp.com)',
      action: actionTitle,
      status: 'SUCCESS',
      details: 'Graph API remediation payload executed cleanly via MSP GDAP delegation.',
    };
    setAuditLogs((prev) => [newLog, ...prev]);

    // Toast
    addToast(
      'success',
      'Remediation Applied via Graph API',
      `Successfully executed "${actionTitle}" for ${tenantName}.`
    );
  };

  // Handle single pending remediation execution
  const handleExecutePendingRemediation = (item: PendingRemediation) => {
    setPendingRemediations((prev) => prev.filter((p) => p.id !== item.id));

    // Update target tenant score
    setTenants((prev) =>
      prev.map((t) =>
        t.name === item.tenantName
          ? {
              ...t,
              mfaPercentage: Math.min(100, t.mfaPercentage + 15),
              secureScore: Math.min(95, parseFloat((t.secureScore + 4.0).toFixed(1))),
              activeAlertsCount: Math.max(0, t.activeAlertsCount - 1),
            }
          : t
      )
    );

    const newLog: AuditLogItem = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      tenantName: item.tenantName,
      initiatedBy: 'Global Admin (Remediation Queue)',
      action: `Resolved: ${item.title}`,
      status: 'SUCCESS',
      details: item.suggestedAction,
    };
    setAuditLogs((prev) => [newLog, ...prev]);

    addToast(
      'success',
      'Fix Applied',
      `Resolved pending action "${item.title}" for ${item.tenantName}.`
    );
  };

  // Bulk Apply All Remediations
  const handleExecuteAllPendingRemediations = () => {
    const count = pendingRemediations.length;
    setPendingRemediations([]);

    // Boost scores across affected tenants
    setTenants((prev) =>
      prev.map((t) => ({
        ...t,
        mfaPercentage: 98,
        secureScore: Math.min(92, Math.max(t.secureScore, 85.0)),
        activeAlertsCount: 0,
        syncStatus: 'Healthy',
      }))
    );

    addToast(
      'success',
      'Bulk Remediation Completed',
      `Successfully resolved all ${count} pending security recommendations across managed tenants.`
    );
    setIsPendingModalOpen(false);
  };

  // Route-to-Tab Mappings for PortalNavigationShell
  const HREF_TO_TAB: Record<string, NavTab> = {
    '/portal/alerts': 'Alerts',
    '/portal/tasks': 'Operator Tasks',
    '/portal/msp-sla': 'SLA Dashboard',
    '/portal/approvals': 'Approvals',
    '/portal/pillars': 'Security Pillar',
    '/portal/offboarding': 'User Management',
    '/portal/support-chat': 'Support',
    '/portal/onboarding-map': 'Onboarding Map',
    '/portal/heatmap': 'Heatmap',
    '/portal/map': 'Map',
    '/portal/offer-pipeline': 'Offer Pipeline',
    '/portal/sales-bundles': 'Sales Bundles',
    '/portal/scope-creep': 'Scope Creep',
    '/portal/rbd': 'Risk Decisions',
    '/portal/workflow-runs': 'Workflow Runs',
    '/portal/dlq': 'DLQ',
    '/portal/changes': 'Change Control',
    '/portal/sop': 'SOP Runbooks',
    '/portal/owner-dashboard': 'MSP Overview',
    '/portal/settings': 'Settings',
    '/portal/security-plan': 'Security',
    '/portal/webhooks': 'Webhooks',
    '/portal/chargeback': 'Chargeback',
  };

  const TAB_TO_HREF: Record<string, string> = {
    'Alerts': '/portal/alerts',
    'Operator Tasks': '/portal/tasks',
    'SLA Dashboard': '/portal/msp-sla',
    'Approvals': '/portal/approvals',
    'Security Pillar': '/portal/pillars',
    '7 Pillars Governance': '/portal/pillars',
    'Offboarding': '/portal/offboarding',
    'Support': '/portal/support-chat',
    'Onboarding Map': '/portal/onboarding-map',
    'Heatmap': '/portal/heatmap',
    'Map': '/portal/map',
    'Offer Pipeline': '/portal/offer-pipeline',
    'Sales Bundles': '/portal/sales-bundles',
    'Scope Creep': '/portal/scope-creep',
    'Risk Decisions': '/portal/rbd',
    'Workflow Runs': '/portal/workflow-runs',
    'DLQ': '/portal/dlq',
    'Change Control': '/portal/changes',
    'SOP Runbooks': '/portal/sop',
    'MSP Overview': '/portal/owner-dashboard',
    'Settings': '/portal/settings',
    'Security': '/portal/security-plan',
    'Webhooks': '/portal/webhooks',
    'Chargeback': '/portal/chargeback',
  };

  // Filter tenants by search in navbar
  const searchFilteredTenants = tenants.filter((t) => {
    if (!globalSearchQuery.trim()) return true;
    const q = globalSearchQuery.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.primaryDomain.toLowerCase().includes(q) ||
      t.globalAdminUPNs.some((u) => u.toLowerCase().includes(q))
    );
  });

  const currentHref = TAB_TO_HREF[activeTab] || '/portal/alerts';

  const handlePortalNavigate = (href: string, title: string) => {
    const targetTab = HREF_TO_TAB[href];
    if (targetTab) {
      setActiveTab(targetTab);
      addToast('info', `Navigated to ${title}`, `Switched active console context to ${href}`);
    }
  };

  const handlePortalQuickAction = (actionId: string, actionTitle: string) => {
    addToast('success', `Quick Action Triggered: ${actionTitle}`, `Dispatched ${actionId} Graph API workflow execution payload across MSP tenants.`);
  };

  return (
    <PortalNavigationShell
      currentPath={currentHref}
      onNavigate={handlePortalNavigate}
      selectedTenant={selectedTenant}
      tenants={tenants}
      onSelectTenant={(t) => {
        setSelectedTenant(t);
        if (t) {
          setActiveTab('Tenant Portal');
          addToast('info', 'Tenant Portal Activated', `Opening inline tenant interface for ${t.name}.`);
        } else {
          addToast('info', 'Global Scope', 'Active dashboard context set to All Managed Tenants.');
        }
      }}
      onQuickAction={handlePortalQuickAction}
    >
      {/* View router contents */}
          {activeTab === 'Overview' && (
            <div className="flex-1 flex flex-col p-3.5 gap-3 overflow-y-auto">
              {/* KPI Header Cards */}
              <KPICards
                totalTenants={totalTenantsCount}
                averageSecureScore={averageSecureScore}
                activeCriticalAlerts={activeCriticalAlerts}
                pendingRemediationsCount={pendingRemediations.length}
                onOpenPendingRemediations={() => setIsPendingModalOpen(true)}
                onFilterCriticalAlerts={() => setStatusFilter('Critical')}
              />

              {/* Tenant Health Summary Data Table */}
              <TenantTable
                tenants={searchFilteredTenants}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                licenseFilter={licenseFilter}
                setLicenseFilter={setLicenseFilter}
                tableSearchQuery={tableSearchQuery}
                setTableSearchQuery={setTableSearchQuery}
                onEnforceMFA={handleEnforceMFA}
                onRevokeSessions={handleRevokeSessions}
                onResetPasswords={handleResetPasswords}
                onRunInstantSync={handleRunInstantSync}
                onSelectTenantDetail={(t) => setDetailDrawerTenant(t)}
              />

              {/* Bottom Threat & Drift Feed */}
              <ThreatFeed
                threatItems={threatItems}
                onTriggerRemediation={(item) =>
                  setRemediationModalConfig({ item, tenant: null })
                }
                onViewAllLogs={() => setActiveTab('Logs')}
              />
            </div>
          )}

          {activeTab === 'MSP Overview' && (
            <OwnerExecutiveConsole
              tenants={tenants}
              onShowToast={addToast}
              onNavigateTab={(tab) => setActiveTab(tab as NavTab)}
            />
          )}

          {activeTab === 'Approvals' && (
            <ApprovalsConsole
              tenants={tenants}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Operator Tasks' && (
            <OperatorTasksConsole
              tenants={tenants}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Workflow Runs' && (
            <WorkflowRunsConsole
              tenants={tenants}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'DLQ' && (
            <DeadLetterQueueConsole
              tenants={tenants}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Offboarding' && (
            <OffboardingConsole
              tenants={tenants}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Webhooks' && (
            <WebhooksConsole
              tenants={tenants}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Map' && (
            <MapView
              tenants={tenants}
              selectedTenant={selectedTenant}
              onSelectTenant={setSelectedTenant}
              onDispatchWorkflow={(actionId, payload) => {
                addToast('success', 'Workflow Dispatched', `Executed action ${actionId} across Graph endpoints.`);
              }}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Heatmap' && (
            <TenantHeatmapDashboard
              onShowToast={addToast}
              onOpenRemediationModal={(actionTitle, tenantName) => {
                const target = tenants.find((t) => t.name === tenantName) || null;
                setRemediationModalConfig({
                  item: null,
                  tenant: target,
                  customTitle: `${actionTitle} for ${tenantName}`,
                });
              }}
            />
          )}

          {activeTab === 'Tenant Overview' && (
            <FullTenantOverviewConsole
              tenant={selectedTenant || tenants[0]}
              tenants={tenants}
              onSelectTenant={(t) => {
                setSelectedTenant(t);
                if (t) {
                  addToast('info', 'Switched Tenant Overview', `Viewing ${t.name} 7-Pillar console.`);
                }
              }}
              onExecuteWorkflow={(actionId, params) => {
                addToast(
                  'success',
                  `Workflow Dispatched: ${actionId}`,
                  `Action routed to Graph API workflow engine.`
                );
              }}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Tenants' && (
            <TenantsView
              tenants={searchFilteredTenants}
              onSelectTenant={(t) => {
                setSelectedTenant(t);
                setActiveTab('Tenant Portal');
              }}
              onEnforceMFA={handleEnforceMFA}
              onRevokeSessions={handleRevokeSessions}
              onRunSync={handleRunInstantSync}
            />
          )}

          {activeTab === 'Tenant Portal' && (
            <SingleTenantDashboard
              tenant={selectedTenant || tenants[0]}
              tenants={tenants}
              onSelectTenant={(t) => {
                setSelectedTenant(t);
                if (t) {
                  addToast('info', 'Switched Tenant', `Viewing ${t.name} telemetry portal.`);
                } else {
                  setActiveTab('Overview');
                  addToast('info', 'Global Console', 'Returned to global MSP dashboard.');
                }
              }}
              onExecuteWorkflow={(workflowId, params) => {
                const target = selectedTenant || tenants[0];
                setRemediationModalConfig({
                  item: null,
                  tenant: target,
                  customTitle: `Execute Workflow ${workflowId}`,
                });
              }}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Accounts' && (
            <UserManagementConsole
              tenants={tenants}
              selectedTenant={selectedTenant}
              onSelectTenant={setSelectedTenant}
              onExecuteWorkflow={(workflowId, params) => {
                const target = selectedTenant || tenants[0];
                setRemediationModalConfig({
                  item: null,
                  tenant: target,
                  customTitle: `Graph API Workflow Execution: ${workflowId}`,
                });
              }}
              onShowToast={addToast}
              onTriggerAction={(actionTitle, tenantName) => {
                const target = tenants.find((t) => t.name === tenantName) || selectedTenant || tenants[0];
                setRemediationModalConfig({
                  item: null,
                  tenant: target,
                  customTitle: actionTitle,
                });
              }}
            />
          )}

          {activeTab === 'Alerts' && (
            <AlertsManagementConsole
              tenants={tenants}
              selectedTenant={selectedTenant}
              onSelectTenant={setSelectedTenant}
              onShowToast={addToast}
              onExecuteWorkflow={(actionId, params) => {
                addToast(
                  'info',
                  'Workflow Engine Dispatched',
                  `Triggered action ${actionId} with parameters: ${JSON.stringify(params)}`
                );
              }}
            />
          )}

          {activeTab === 'Message Center' && (
            <M365MessageCenterConsole
              tenants={tenants}
              selectedTenant={selectedTenant}
              onSelectTenant={setSelectedTenant}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Microsoft SLA' && (
            <MicrosoftSlaConsole
              tenants={tenants}
              selectedTenant={selectedTenant}
              onSelectTenant={setSelectedTenant}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'SLA Dashboard' && (
            <MspToCustomerSlaConsole
              tenants={tenants}
              selectedTenant={selectedTenant}
              onSelectTenant={setSelectedTenant}
              onShowToast={addToast}
              onExecuteWorkflow={(actionId, params) => {
                addToast(
                  'info',
                  'SLA Auto-Heal Dispatched',
                  `Action ${actionId} executed for tenant params: ${JSON.stringify(params)}`
                );
              }}
            />
          )}

          {activeTab === 'Scope Creep' && (
            <ScopeCreepConsole
              tenants={tenants}
              selectedTenant={selectedTenant}
              onSelectTenant={setSelectedTenant}
              onShowToast={addToast}
              onExecuteWorkflow={(actionId, params) => {
                addToast(
                  'info',
                  'Scope Creep Workflow Dispatched',
                  `Action ${actionId} executed with params: ${JSON.stringify(params)}`
                );
              }}
            />
          )}

          {activeTab === 'Risk Decisions' && (
            <RiskBasedDecisionConsole
              tenants={tenants}
              selectedTenant={selectedTenant}
              onSelectTenant={setSelectedTenant}
              onShowToast={addToast}
              onExecuteWorkflow={(actionId, params) => {
                addToast(
                  'info',
                  'Risk Decision Workflow Dispatched',
                  `Action ${actionId} executed with params: ${JSON.stringify(params)}`
                );
              }}
            />
          )}

          {activeTab === 'Change Control' && (
            <ChangeManagementConsole
              tenants={tenants}
              selectedTenant={selectedTenant}
              onSelectTenant={setSelectedTenant}
              onShowToast={addToast}
              onExecuteWorkflow={(actionId, params) => {
                addToast(
                  'info',
                  'Change Control Workflow Dispatched',
                  `Action ${actionId} executed with params: ${JSON.stringify(params)}`
                );
              }}
            />
          )}

          {(activeTab === 'SOP Runbooks' || activeTab === 'SOP') && (
            <StandardOperatingProceduresConsole
              tenants={tenants}
              selectedTenant={selectedTenant}
              onSelectTenant={setSelectedTenant}
              onShowToast={addToast}
              onExecuteWorkflow={(actionId, params) => {
                addToast(
                  'info',
                  'SOP Workflow Dispatched',
                  `Action ${actionId} executed with params: ${JSON.stringify(params)}`
                );
              }}
            />
          )}

          {(activeTab === 'Audit Log' || activeTab === 'Audit Logs' || activeTab === 'Logs') && (
            <SplitPaneAuditLogConsole
              tenants={tenants}
              selectedTenant={selectedTenant}
              onSelectTenant={setSelectedTenant}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'M365 Admin Tools' && (
            <M365AdminToolsView
              tenants={tenants}
              selectedTenant={selectedTenant}
              onSelectTenant={setSelectedTenant}
              onTriggerAction={(actionTitle, tenantName) => {
                const target = tenants.find((t) => t.name === tenantName) || selectedTenant || tenants[0];
                setRemediationModalConfig({
                  item: null,
                  tenant: target,
                  customTitle: actionTitle,
                });
              }}
            />
          )}

          {(activeTab === 'Security' || activeTab === 'Security Pillar') && (
            <SecurityPillarConsole
              tenants={tenants}
              onShowToast={addToast}
              onExecuteWorkflow={(actionId, params) => {
                addToast(
                  'info',
                  'Security Pillar Remediation Executed',
                  `Action ${actionId} initiated via GDAP Graph API.`
                );
              }}
            />
          )}

          {(activeTab === 'Governance Pillar' ||
            activeTab === 'Compliance Pillar' ||
            activeTab === 'Adoption Pillar' ||
            activeTab === 'Copilot Readiness Pillar' ||
            activeTab === 'Architecture Pillar' ||
            activeTab === 'Licensing Pillar') && (
            <FullTenantOverviewConsole
              tenant={selectedTenant || tenants[0]}
              tenants={tenants}
              initialPillar={activeTab}
              onSelectTenant={(t) => {
                setSelectedTenant(t);
                if (t) {
                  addToast('info', 'Switched Tenant Overview', `Viewing ${t.name} ${activeTab} console.`);
                }
              }}
              onExecuteWorkflow={(actionId, params) => {
                addToast(
                  'success',
                  `Workflow Dispatched: ${actionId}`,
                  `Action routed to Graph API workflow engine.`
                );
              }}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Security & Compliance' && (
            <SecurityComplianceView
              tenants={tenants}
              selectedTenant={selectedTenant}
              onSelectTenant={setSelectedTenant}
              onExecuteWorkflow={(workflowId, params) => {
                const target = selectedTenant || tenants[0];
                setRemediationModalConfig({
                  item: null,
                  tenant: target,
                  customTitle: `Workflow Execution: ${workflowId}`,
                });
              }}
              onShowToast={addToast}
              onTriggerAction={(title, tenantName) => {
                const target = tenants.find((t) => t.name === tenantName) || null;
                setRemediationModalConfig({
                  item: null,
                  tenant: target,
                  customTitle: `${title} for ${tenantName}`,
                });
              }}
            />
          )}

          {activeTab === 'Timeline' && (
            <TenantScanTimelineCanvas
              tenants={tenants}
              selectedTenant={selectedTenant}
              onSelectTenant={setSelectedTenant}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Billing' && (
            <MspBillingConsole
              tenants={tenants}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Chargeback' && (
            <ChargebackConsole
              tenants={tenants}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Sales Bundles' && (
            <SalesBundleConsole
              tenants={tenants}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Offer Pipeline' && (
            <OfferPipelineConsole
              tenants={tenants}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Onboarding Map' && (
            <OnboardingMapConsole
              tenants={tenants}
              selectedTenantId={selectedTenant?.id}
              onShowToast={addToast}
              onExecuteOnboardingStep={(tenantId, stepId) => {
                addToast(
                  'success',
                  'Onboarding Step Dispatched',
                  `Dispatched execution for step ${stepId} on tenant ${tenantId}.`
                );
              }}
            />
          )}

          {activeTab === 'Document Library' && (
            <DocumentLibraryConsole
              tenants={tenants}
              selectedTenant={selectedTenant}
              onSelectTenant={setSelectedTenant}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Health & Sync' && (
            <HealthSyncView
              tenants={tenants}
              onRunSync={handleRunInstantSync}
              onSyncAll={() => {
                tenants.forEach((t) => handleRunInstantSync(t));
              }}
            />
          )}

          {activeTab === 'Automation' && (
            <AutomationView
              onRunWorkflow={(title) => {
                addToast('success', 'Workflow Executed', `Playbook "${title}" triggered successfully across Graph API endpoints.`);
              }}
            />
          )}

          {activeTab === 'Settings' && (
            <SettingsConsole
              tenants={tenants}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Support' && (
            <SupportChatConsole
              tenants={tenants}
              onShowToast={addToast}
            />
          )}

          {activeTab === 'Logs' && <LogsView logs={auditLogs} />}

          {/* Popups, Modals, Drawers & Toast Notifications */}
          {remediationModalConfig && (
            <RemediationModal
              item={remediationModalConfig.item}
              tenant={remediationModalConfig.tenant}
              customActionTitle={remediationModalConfig.customTitle}
              onClose={() => setRemediationModalConfig(null)}
              onConfirmRemediation={handleConfirmRemediation}
            />
          )}

          {detailDrawerTenant && (
            <TenantDetailDrawer
              tenant={detailDrawerTenant}
              onClose={() => setDetailDrawerTenant(null)}
              onEnforceMFA={handleEnforceMFA}
              onRevokeSessions={handleRevokeSessions}
              onRunInstantSync={handleRunInstantSync}
            />
          )}

          {isPendingModalOpen && (
            <PendingRemediationsModal
              remediations={pendingRemediations}
              onClose={() => setIsPendingModalOpen(false)}
              onExecuteRemediation={handleExecutePendingRemediation}
              onExecuteAll={handleExecuteAllPendingRemediations}
            />
          )}

          <ToastContainer toasts={toasts} onDismiss={handleDismissToast} />
    </PortalNavigationShell>
  );
}
