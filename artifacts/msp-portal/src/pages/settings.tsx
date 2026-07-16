import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/dashboard-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";
import { 
  Building2, 
  CreditCard, 
  KeyRound, 
  Globe, 
  Users, 
  Mail, 
  ShieldCheck,
  Lock
} from "lucide-react";

// Sub-page imports
import SettingsOrgProfile from "./settings-org-profile";
import SettingsBilling from "./settings-billing";
import SettingsConnector from "./settings-connector";
import SettingsCustomDomain from "./settings-custom-domain";
import SettingsTeam from "./settings-team";
import SettingsEmailTemplates from "./settings-email-templates";
import SettingsSessions from "./settings-sessions";

// Roles permitted to view settings tabs
const PERMITTED_ROLES = ["MSPAdmin", "PlatformAdmin"];

export default function SettingsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("org");

  const isAuthorized = user && (
    (user.mspRole && PERMITTED_ROLES.includes(user.mspRole)) ||
    user.role === "admin"
  );

  if (!isAuthorized) {
    return (
      <DashboardShell title="Settings" description="Manage your MSP organization and platform preferences">
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6 text-center">
            <Lock className="h-10 w-10 mx-auto text-destructive mb-3" />
            <h3 className="text-lg font-semibold text-foreground mb-1">Access Restricted</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
              Your account role (<code>{user?.role || "Unknown"}</code>) does not have permission to modify settings.
            </p>
          </CardContent>
        </Card>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell 
      title="Organization Settings" 
      description="Configure organization profile, billing card on file, M365 integrations, custom domain, and team access."
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-muted/50 p-1 flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="org" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            <span>Organization</span>
          </TabsTrigger>
          <TabsTrigger value="billing" className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            <span>Billing & Card</span>
          </TabsTrigger>
          <TabsTrigger value="connector" className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            <span>M365 Integration</span>
          </TabsTrigger>
          <TabsTrigger value="domain" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            <span>Custom Domain</span>
          </TabsTrigger>
          <TabsTrigger value="team" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span>Team & Access</span>
          </TabsTrigger>
          <TabsTrigger value="templates" className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            <span>Email Branding</span>
          </TabsTrigger>
          <TabsTrigger value="sessions" className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            <span>Active Sessions</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="org">
          <SettingsOrgProfile />
        </TabsContent>
        <TabsContent value="billing">
          <SettingsBilling />
        </TabsContent>
        <TabsContent value="connector">
          <SettingsConnector />
        </TabsContent>
        <TabsContent value="domain">
          <SettingsCustomDomain />
        </TabsContent>
        <TabsContent value="team">
          <SettingsTeam />
        </TabsContent>
        <TabsContent value="templates">
          <SettingsEmailTemplates />
        </TabsContent>
        <TabsContent value="sessions">
          <SettingsSessions />
        </TabsContent>
      </Tabs>
    </DashboardShell>
  );
}