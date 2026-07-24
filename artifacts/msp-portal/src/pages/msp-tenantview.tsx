import React, { useState, useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { ServiceHealthGrid } from '@/components/msp-tenantview/ServiceHealthGrid';
import { SecurityPosture } from '@/components/msp-tenantview/SecurityPosture';
import { AppRegistrationGovernance } from '@/components/msp-tenantview/AppRegistrationGovernance';
import { FooterTelemetry } from '@/components/msp-tenantview/FooterTelemetry';
import { MultiTenantView } from '@/components/msp-tenantview/MultiTenantView';
import { ComplianceOpsView } from '@/components/msp-tenantview/ComplianceOpsView';
import { SecurityDetailView } from '@/components/msp-tenantview/SecurityDetailView';
import { UsersDetailView } from '@/components/msp-tenantview/UsersDetailView';
import { BillingDetailView } from '@/components/msp-tenantview/BillingDetailView';
import { AppModal } from '@/components/msp-tenantview/AppModal';

import { mockTenants } from '@/components/msp-tenantview/mockData';
import { TabType, NavSection, Tenant } from '@/components/msp-tenantview/types';

export default function MspTenantviewPage() {
  const [tenants, setTenants] = useState<Tenant[]>(mockTenants);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('tenant-1');
  const [activeTab, setActiveTab] = useState<TabType>('tenant-intelligence');
  const [activeSection, setActiveSection] = useState<NavSection>('overview');
  const [isAppModalOpen, setIsAppModalOpen] = useState(false);

  const currentTenant = tenants.find((t) => t.id === selectedTenantId) || tenants[0];

  // Mousemove radial glass effect implementation
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const cards = document.querySelectorAll('.glass-panel');
      cards.forEach((card) => {
        const htmlCard = card as HTMLElement;
        const rect = htmlCard.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
          htmlCard.style.background = `radial-gradient(circle at ${x}px ${y}px, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.04) 100%)`;
        } else {
          htmlCard.style.background = `rgba(255, 255, 255, 0.04)`;
        }
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const handleSelectTenant = (tenant: Tenant) => {
    setSelectedTenantId(tenant.id);
    setActiveTab('tenant-intelligence');
  };

  const handleToggleControl = (controlKey: keyof Tenant['securityControls']) => {
    setTenants((prevTenants) =>
      prevTenants.map((t) => {
        if (t.id === currentTenant.id) {
          return {
            ...t,
            securityControls: {
              ...t.securityControls,
              [controlKey]: !t.securityControls[controlKey],
            },
          };
        }
        return t;
      })
    );
  };

  const handleUpdateAppStatus = (appId: string, status: 'Approved' | 'Revoked') => {
    setTenants((prevTenants) =>
      prevTenants.map((t) => {
        if (t.id === currentTenant.id) {
          return {
            ...t,
            appRegistrations: t.appRegistrations.map((app) =>
              app.appId === appId ? { ...app, status } : app
            ),
          };
        }
        return t;
      })
    );
  };

  return (
    <AppShell title="Tenant View">
      <div className="bg-[#111317] text-[#e2e2e6] min-h-screen blueprint-bg pb-14 selection:bg-[#99cbff]/30 font-sans">
        {/* Tab / Section Switcher */}
        <div className="flex flex-wrap items-center gap-2 px-4 md:px-8 pt-4">
          <button
            onClick={() => setActiveTab('tenant-intelligence')}
            className={`px-3 py-1.5 text-[11px] font-mono uppercase rounded-md transition-colors ${
              activeTab === 'tenant-intelligence'
                ? 'bg-[#99cbff]/20 text-[#99cbff] font-bold'
                : 'text-[#bfc7d3] hover:text-[#e2e2e6]'
            }`}
          >
            Tenant Intelligence
          </button>
          <button
            onClick={() => setActiveTab('multi-tenant')}
            className={`px-3 py-1.5 text-[11px] font-mono uppercase rounded-md transition-colors ${
              activeTab === 'multi-tenant'
                ? 'bg-[#99cbff]/20 text-[#99cbff] font-bold'
                : 'text-[#bfc7d3] hover:text-[#e2e2e6]'
            }`}
          >
            Multi-Tenant
          </button>
          <button
            onClick={() => setActiveTab('compliance-ops')}
            className={`px-3 py-1.5 text-[11px] font-mono uppercase rounded-md transition-colors ${
              activeTab === 'compliance-ops'
                ? 'bg-[#99cbff]/20 text-[#99cbff] font-bold'
                : 'text-[#bfc7d3] hover:text-[#e2e2e6]'
            }`}
          >
            Compliance Ops
          </button>

          {activeTab === 'tenant-intelligence' && (
            <div className="flex items-center gap-2 ml-auto">
              {(['overview', 'security', 'compliance', 'users', 'billing'] as NavSection[]).map(
                (section) => (
                  <button
                    key={section}
                    onClick={() => setActiveSection(section)}
                    className={`px-3 py-1.5 text-[11px] font-mono uppercase rounded-md transition-colors ${
                      activeSection === section
                        ? 'bg-[#99cbff]/20 text-[#99cbff] font-bold'
                        : 'text-[#bfc7d3] hover:text-[#e2e2e6]'
                    }`}
                  >
                    {section}
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {/* Main Content Pane */}
        <main className="flex-1 p-4 md:p-8 space-y-6 max-w-[1600px] mx-auto w-full">
          {activeTab === 'multi-tenant' && (
            <MultiTenantView tenants={tenants} onSelectTenant={handleSelectTenant} />
          )}

          {activeTab === 'compliance-ops' && <ComplianceOpsView tenant={currentTenant} />}

          {activeTab === 'tenant-intelligence' && (
            <>
              {activeSection === 'overview' && (
                <>
                  {/* Service Health Grid */}
                  <ServiceHealthGrid
                    tenant={currentTenant}
                    onSelectService={() => setActiveSection('security')}
                  />

                  {/* Security Posture & App Registration Governance */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-4">
                      <SecurityPosture
                        tenant={currentTenant}
                        onOpenSecurityDetail={() => setActiveSection('security')}
                      />
                    </div>
                    <div className="lg:col-span-8">
                      <AppRegistrationGovernance
                        tenant={currentTenant}
                        onToggleControl={handleToggleControl}
                        onViewAllApps={() => setIsAppModalOpen(true)}
                        onUpdateAppStatus={handleUpdateAppStatus}
                      />
                    </div>
                  </div>
                </>
              )}

              {activeSection === 'security' && <SecurityDetailView tenant={currentTenant} />}

              {activeSection === 'compliance' && <ComplianceOpsView tenant={currentTenant} />}

              {activeSection === 'users' && <UsersDetailView tenant={currentTenant} />}

              {activeSection === 'billing' && (
                <BillingDetailView tenant={currentTenant} />
              )}
            </>
          )}
        </main>

        {/* Fixed Footer Telemetry Bar */}
        <FooterTelemetry />

        {/* All App Registrations Modal */}
        <AppModal
          isOpen={isAppModalOpen}
          onClose={() => setIsAppModalOpen(false)}
          apps={currentTenant.appRegistrations}
          onUpdateStatus={handleUpdateAppStatus}
        />
      </div>
    </AppShell>
  );
}
