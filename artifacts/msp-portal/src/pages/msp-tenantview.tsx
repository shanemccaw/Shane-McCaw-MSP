import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { TenantHeader } from './components/TenantHeader';
import { ServiceHealthGrid } from './components/ServiceHealthGrid';
import { SecurityPosture } from './components/SecurityPosture';
import { AppRegistrationGovernance } from './components/AppRegistrationGovernance';
import { FooterTelemetry } from './components/FooterTelemetry';
import { MultiTenantView } from './components/MultiTenantView';
import { ComplianceOpsView } from './components/ComplianceOpsView';
import { SecurityDetailView } from './components/SecurityDetailView';
import { UsersDetailView } from './components/UsersDetailView';
import { BillingDetailView } from './components/BillingDetailView';
import { AppModal } from './components/AppModal';

import { mockTenants, mockNotifications } from './data/mockData';
import { TabType, NavSection, Tenant } from './types';

export default function App() {
  const [tenants, setTenants] = useState<Tenant[]>(mockTenants);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('tenant-1');
  const [activeTab, setActiveTab] = useState<TabType>('tenant-intelligence');
  const [activeSection, setActiveSection] = useState<NavSection>('overview');
  const [notifications] = useState(mockNotifications);
  const [searchQuery, setSearchQuery] = useState('');
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

  const handleRefreshSync = () => {
    setTenants((prevTenants) =>
      prevTenants.map((t) => {
        if (t.id === currentTenant.id) {
          return {
            ...t,
            syncStatus: 'Active (Just now)',
          };
        }
        return t;
      })
    );
  };

  return (
    <div className="bg-[#111317] text-[#e2e2e6] min-h-screen blueprint-bg pb-14 selection:bg-[#99cbff]/30 font-sans">
      {/* Navigation Header */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentTenant={currentTenant}
        tenants={tenants}
        onSelectTenant={handleSelectTenant}
        notifications={notifications}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
      />

      {/* Main App Layout */}
      <div className="flex min-h-[calc(100vh-64px)]">
        {/* Sidebar */}
        <Sidebar
          activeSection={activeSection}
          setActiveSection={(sec) => {
            setActiveSection(sec);
            setActiveTab('tenant-intelligence');
          }}
        />

        {/* Main Content Pane */}
        <main className="flex-1 p-4 md:p-8 space-y-6 max-w-[1600px] mx-auto w-full">
          {activeTab === 'multi-tenant' && (
            <MultiTenantView tenants={tenants} onSelectTenant={handleSelectTenant} />
          )}

          {activeTab === 'compliance-ops' && (
            <ComplianceOpsView tenant={currentTenant} />
          )}

          {activeTab === 'tenant-intelligence' && (
            <>
              {activeSection === 'overview' && (
                <>
                  {/* 1. Tenant Header */}
                  <TenantHeader tenant={currentTenant} onRefreshSync={handleRefreshSync} />

                  {/* 2. Service Health Grid */}
                  <ServiceHealthGrid
                    tenant={currentTenant}
                    onSelectService={() => setActiveSection('security')}
                  />

                  {/* 3. Security Posture & 4. App Registration Governance */}
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

              {activeSection === 'security' && (
                <SecurityDetailView tenant={currentTenant} />
              )}

              {activeSection === 'compliance' && (
                <ComplianceOpsView tenant={currentTenant} />
              )}

              {activeSection === 'users' && (
                <UsersDetailView tenant={currentTenant} />
              )}

              {activeSection === 'billing' && (
                <BillingDetailView tenant={currentTenant} />
              )}
            </>
          )}
        </main>
      </div>

      {/* Fixed Footer Telemetry Bar */}
      <FooterTelemetry />

      {/* All 24 App Registrations Modal */}
      <AppModal
        isOpen={isAppModalOpen}
        onClose={() => setIsAppModalOpen(false)}
        apps={currentTenant.appRegistrations}
        onUpdateStatus={handleUpdateAppStatus}
      />
    </div>
  );
}
