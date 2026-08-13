/**
 * Consolidated Customer Settings Hub
 *
 * Route: /customer-settings (+ ?tab=team|security|notifications|privacy|cancel)
 * Accessible to: CustomerUser
 *
 * One real, unified settings page consolidating the five previously separate
 * customer account pages into tabbed sections. Every tab renders the REAL
 * content component exported by its original source page — no reimplemented
 * logic, no mock data:
 *
 *   - Team           → CustomerTeamContent        (pages/customer-team.tsx)
 *   - Password & MFA → SecuritySettingsContent    (pages/security.tsx)
 *   - Notifications  → NotificationSettingsContent(pages/customer-notifications.tsx)
 *   - Privacy & Data → PrivacySettingsContent     (pages/customer-privacy.tsx)
 *   - Cancel Services→ CustomerCancelServicesContent (pages/offboarding.tsx)
 *
 * The old customer routes redirect here (see App.tsx) so deep links and
 * bookmarks keep working; ?tab= keeps the active section linkable.
 */

import { useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { AppShell } from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, KeyRound, Lock, Settings, Users, XCircle } from "lucide-react";

import { CustomerTeamContent } from "@/pages/customer-team";
import { SecuritySettingsContent } from "@/pages/security";
import { NotificationSettingsContent } from "@/pages/customer-notifications";
import { PrivacySettingsContent } from "@/pages/customer-privacy";
import { CustomerCancelServicesContent } from "@/pages/offboarding";

const TAB_KEYS = ["team", "security", "notifications", "privacy", "cancel"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TABS: Array<{ key: TabKey; label: string; icon: React.ElementType }> = [
  { key: "team", label: "Manage Team", icon: Users },
  { key: "security", label: "Password & MFA", icon: KeyRound },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "privacy", label: "Privacy & Data", icon: Lock },
  { key: "cancel", label: "Cancel Services", icon: XCircle },
];

export default function CustomerSettingsPage() {
  const search = useSearch();
  const [, navigate] = useLocation();

  const activeTab: TabKey = useMemo(() => {
    const requested = new URLSearchParams(search).get("tab");
    return TAB_KEYS.includes(requested as TabKey) ? (requested as TabKey) : "team";
  }, [search]);

  const handleTabChange = (value: string) => {
    // Keep the active tab in the URL so sections stay linkable/bookmarkable
    // (and so redirects from the old standalone routes land on the right tab).
    navigate(`/customer-settings?tab=${value}`, { replace: true });
  };

  return (
    <AppShell title="Settings">
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
            <Settings className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Team, sign-in security, notifications, your data, and service cancellation — all in one place
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="h-auto flex-wrap justify-start gap-1">
            {TABS.map(({ key, label, icon: Icon }) => (
              <TabsTrigger key={key} value={key} className="gap-1.5 text-xs sm:text-sm">
                <Icon className="size-3.5" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="team" className="mt-6">
            <CustomerTeamContent />
          </TabsContent>
          <TabsContent value="security" className="mt-6">
            <SecuritySettingsContent />
          </TabsContent>
          <TabsContent value="notifications" className="mt-6">
            <NotificationSettingsContent />
          </TabsContent>
          <TabsContent value="privacy" className="mt-6">
            <PrivacySettingsContent />
          </TabsContent>
          <TabsContent value="cancel" className="mt-6">
            <CustomerCancelServicesContent />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
