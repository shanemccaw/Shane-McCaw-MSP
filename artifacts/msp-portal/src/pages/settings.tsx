/**
 * Settings page — MSP portal account and platform settings.
 */

import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Bell,
  Building2,
  ChevronRight,
  Cog,
  Globe,
  Lock,
  Palette,
  Shield,
  Users,
} from "lucide-react";

interface SettingsSection {
  icon: React.ElementType;
  title: string;
  description: string;
  badge?: string;
  action?: string;
  roles?: string[];
}

const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    icon: Building2,
    title: "Organisation Profile",
    description: "Update your MSP name, logo, and contact details.",
    action: "Edit",
  },
  {
    icon: Palette,
    title: "White-Label Branding",
    description: "Customise the portal colours and logo shown to your customers.",
    action: "Customise",
  },
  {
    icon: Globe,
    title: "Custom Domain",
    description: "Map a custom domain (e.g. portal.yourmsp.com) to the portal.",
    badge: "Upcoming",
    action: "Configure",
  },
  {
    icon: Users,
    title: "Team Members",
    description: "Invite operators and manage role assignments.",
    action: "Manage",
  },
  {
    icon: Bell,
    title: "Notifications",
    description: "Configure email and push notification preferences.",
    action: "Configure",
  },
  {
    icon: Lock,
    title: "Security & MFA",
    description: "Manage multi-factor authentication and session settings.",
    action: "Configure",
  },
  {
    icon: Shield,
    title: "Audit & Compliance",
    description: "Review audit logs and configure data retention policies.",
    action: "View",
    roles: ["PlatformAdmin", "MSPAdmin"],
  },
  {
    icon: Cog,
    title: "API & Integrations",
    description: "Manage API keys and third-party service integrations.",
    action: "Configure",
    roles: ["PlatformAdmin", "MSPAdmin"],
  },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const mspRole = user?.mspRole;

  function isVisible(section: SettingsSection) {
    if (!section.roles || section.roles.length === 0) return true;
    return section.roles.includes(mspRole ?? "");
  }

  return (
    <AppShell title="Settings">
      <div className="p-6 max-w-3xl space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Settings</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your MSP organisation, branding, team, and security preferences.
          </p>
        </div>

        {/* Account info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Current Session</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Name</dt>
                <dd className="font-medium mt-0.5">{user?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Email</dt>
                <dd className="font-medium mt-0.5 truncate">{user?.email}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Portal Role</dt>
                <dd className="mt-0.5">
                  <Badge variant="outline" className="text-[11px]">
                    {mspRole ?? "—"}
                  </Badge>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Separator />

        {/* Settings sections */}
        <div className="space-y-2">
          {SETTINGS_SECTIONS.filter(isVisible).map((section) => (
            <div
              key={section.title}
              className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card/60 px-4 py-3.5 hover:bg-card transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-muted/60 p-2">
                  <section.icon className="size-4 text-muted-foreground" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{section.title}</p>
                    {section.badge && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                        {section.badge}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{section.description}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-muted-foreground gap-1"
                onClick={() => toast.info(`${section.title} settings coming soon`)}
              >
                {section.action}
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
