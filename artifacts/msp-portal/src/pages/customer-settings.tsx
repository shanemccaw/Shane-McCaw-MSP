import React, { useState, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { ManageTeamCard } from './components/ManageTeamCard';
import { DownloadDataCard } from './components/DownloadDataCard';
import { SecurityAccessCard } from './components/SecurityAccessCard';
import { NotificationChannelsCard } from './components/NotificationChannelsCard';
import { PrivacyGovernanceCard } from './components/PrivacyGovernanceCard';
import { DangerZoneCard } from './components/DangerZoneCard';
import { InviteMemberModal } from './components/InviteMemberModal';
import { UpgradePlanModal } from './components/UpgradePlanModal';
import { CancelSubscriptionModal, DeleteWorkspaceModal } from './components/DangerModals';
import { PrivacyPolicyModal } from './components/PrivacyPolicyModal';
import { OtherTabViews } from './components/OtherTabViews';
import { ToastContainer, ToastMessage } from './components/Toast';

import { INITIAL_TEAM_MEMBERS, INITIAL_NOTIFICATIONS } from './data/initialData';
import { MainTab, SidebarTab, TeamMember, Role, NotificationSetting } from './types';

export default function App() {
  // Navigation State
  const [activeMainTab, setActiveMainTab] = useState<MainTab>('General Settings');
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>('Team');

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');

  // Team State
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(INITIAL_TEAM_MEMBERS);

  // Notifications State
  const [notifications, setNotifications] = useState<NotificationSetting[]>(INITIAL_NOTIFICATIONS);
  const [hasUnreadBell, setHasUnreadBell] = useState(true);

  // Security State
  const [mfaEnabled, setMfaEnabled] = useState(true);

  // Privacy State
  const [retentionPolicy, setRetentionPolicy] = useState('Standard (7 Years)');

  // Toast System State
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Modal Dialog States
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);

  // Section Refs for Smooth Scrolling
  const teamSectionRef = useRef<HTMLDivElement>(null);
  const securitySectionRef = useRef<HTMLDivElement>(null);
  const notificationSectionRef = useRef<HTMLDivElement>(null);
  const dataBillingSectionRef = useRef<HTMLDivElement>(null);

  // Helper to add toast messages
  const addToast = (type: 'success' | 'error' | 'info', title: string, description?: string) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 6);
    setToasts((prev) => [...prev, { id, type, title, description }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Sidebar navigation handler
  const handleSelectSidebarTab = (tab: SidebarTab) => {
    setActiveSidebarTab(tab);
    setActiveMainTab('General Settings');

    if (tab === 'Team' && teamSectionRef.current) {
      teamSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (tab === 'Security' && securitySectionRef.current) {
      securitySectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (tab === 'Notifications' && notificationSectionRef.current) {
      notificationSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (tab === 'Data & Billing' && dataBillingSectionRef.current) {
      dataBillingSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Team Actions
  const handleInviteMember = (name: string, email: string, role: Role) => {
    const initials = name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);

    const newMember: TeamMember = {
      id: Date.now().toString(),
      name,
      email,
      role,
      lastActive: 'Just now',
      avatarInitials: initials || 'TM',
      avatarBg: 'bg-[#282a2b]',
    };

    setTeamMembers((prev) => [...prev, newMember]);
    addToast('success', 'Invitation Sent', `Sent invitation to ${email} as ${role}.`);
  };

  const handleUpdateRole = (id: string, newRole: Role) => {
    setTeamMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, role: newRole } : m))
    );
    addToast('info', 'Member Role Updated', `Role updated to ${newRole}.`);
  };

  const handleRemoveMember = (id: string) => {
    const target = teamMembers.find((m) => m.id === id);
    setTeamMembers((prev) => prev.filter((m) => m.id !== id));
    addToast('info', 'Member Removed', `Removed ${target?.name || 'user'} from workspace.`);
  };

  // Toggle MFA
  const handleToggleMfa = (enabled: boolean) => {
    setMfaEnabled(enabled);
    addToast(
      'info',
      enabled ? 'MFA Enabled' : 'MFA Disabled',
      enabled
        ? 'Mobile app verification code required upon sign-in.'
        : 'Multi-factor authentication turned off.'
    );
  };

  // Update Password
  const handleUpdatePassword = (success: boolean, msg: string) => {
    if (success) {
      addToast('success', 'Password Updated', msg);
    } else {
      addToast('error', 'Password Reset Failed', msg);
    }
  };

  // Notification Channels Toggle
  const handleToggleNotification = (id: string, enabled: boolean) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, enabled } : n))
    );
    const item = notifications.find((n) => n.id === id);
    addToast(
      'info',
      'Preference Saved',
      `Channel "${item?.title}" set to ${enabled ? 'Active' : 'Disabled'}.`
    );
  };

  // Retention policy change
  const handleChangeRetentionPolicy = (val: string) => {
    setRetentionPolicy(val);
    addToast('success', 'Data Retention Updated', `Policy set to "${val}".`);
  };

  // Export Toast
  const handleExportToast = (format: 'JSON' | 'CSV') => {
    addToast(
      'success',
      `Export ${format} Ready`,
      `Workspace audit logs compiled & downloaded successfully.`
    );
  };

  // Support / Sign Out handlers
  const handleOpenSupport = () => {
    addToast('info', 'Tenant Intelligence Support', 'Support ticket window opened (24/7 priority line).');
  };

  const handleSignOut = () => {
    addToast('info', 'Signed Out', 'You have been safely signed out of Tenant Intelligence.');
  };

  return (
    <div className="min-h-screen bg-[#121414] text-[#e2e2e2] flex font-sans antialiased">
      {/* Left Sidebar Navigation */}
      <Sidebar
        activeTab={activeSidebarTab}
        onSelectTab={handleSelectSidebarTab}
        onOpenUpgrade={() => setIsUpgradeOpen(true)}
        onOpenSupport={handleOpenSupport}
        onSignOut={handleSignOut}
      />

      {/* Main View Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <TopHeader
          activeMainTab={activeMainTab}
          onSelectMainTab={setActiveMainTab}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          unreadNotifications={hasUnreadBell}
          onToggleNotificationPanel={() => {
            setHasUnreadBell(false);
            addToast('info', 'Notifications Read', 'All system notifications marked as read.');
          }}
          onOpenProfileModal={() => {
            addToast('info', 'User Profile', 'Signed in as Sarah Nguyen (ADMIN).');
          }}
        />

        {/* Dynamic View Body */}
        <main className="flex-1 p-6 md:p-8 max-w-[1440px] w-full mx-auto">
          {activeMainTab === 'General Settings' ? (
            <div className="space-y-6">
              {/* Row 1: Manage Team (Left) & Download Data (Right) */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2" ref={teamSectionRef}>
                  <ManageTeamCard
                    members={teamMembers}
                    searchQuery={searchQuery}
                    onOpenInviteModal={() => setIsInviteOpen(true)}
                    onUpdateRole={handleUpdateRole}
                    onRemoveMember={handleRemoveMember}
                  />
                </div>

                <div className="lg:col-span-1" ref={dataBillingSectionRef}>
                  <DownloadDataCard
                    members={teamMembers}
                    onExportToast={handleExportToast}
                  />
                </div>
              </div>

              {/* Row 2: Security & Access (Left) & Notification Channels (Right) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div ref={securitySectionRef}>
                  <SecurityAccessCard
                    mfaEnabled={mfaEnabled}
                    onToggleMfa={handleToggleMfa}
                    onUpdatePassword={handleUpdatePassword}
                  />
                </div>

                <div ref={notificationSectionRef}>
                  <NotificationChannelsCard
                    notifications={notifications}
                    onToggleNotification={handleToggleNotification}
                  />
                </div>
              </div>

              {/* Row 3: Privacy & Data Governance (Full Width) */}
              <div>
                <PrivacyGovernanceCard
                  retentionPolicy={retentionPolicy}
                  onChangeRetentionPolicy={handleChangeRetentionPolicy}
                  onOpenPrivacyModal={() => setIsPrivacyOpen(true)}
                />
              </div>

              {/* Row 4: Danger Zone (Full Width) */}
              <div>
                <DangerZoneCard
                  onOpenCancelModal={() => setIsCancelOpen(true)}
                  onOpenDeleteModal={() => setIsDeleteOpen(true)}
                />
              </div>
            </div>
          ) : (
            <OtherTabViews
              activeTab={activeMainTab}
              onNavigateToSettings={() => setActiveMainTab('General Settings')}
            />
          )}
        </main>
      </div>

      {/* Interactive Modals */}
      <InviteMemberModal
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        onInvite={handleInviteMember}
      />

      <UpgradePlanModal
        isOpen={isUpgradeOpen}
        onClose={() => setIsUpgradeOpen(false)}
        onSelectPlan={(pName) => {
          setIsUpgradeOpen(false);
          addToast('success', 'Plan Selection Updated', `Selected workspace plan: ${pName}.`);
        }}
      />

      <CancelSubscriptionModal
        isOpen={isCancelOpen}
        onClose={() => setIsCancelOpen(false)}
        onConfirm={() => {
          addToast('info', 'Subscription Canceled', 'Your plan will downgrade at the end of the billing cycle.');
        }}
      />

      <DeleteWorkspaceModal
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirmDelete={() => {
          addToast('error', 'Workspace Wiped', 'Workspace data deletion initiated across all server clusters.');
        }}
      />

      <PrivacyPolicyModal
        isOpen={isPrivacyOpen}
        onClose={() => setIsPrivacyOpen(false)}
      />

      {/* Global Toast Container */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}
