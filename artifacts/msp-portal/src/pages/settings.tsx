/**
 * Settings hub — MSP portal account and platform settings.
 * Links to sub-pages for all settings sections.
 */

import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Bell,
  Building2,
  ChevronRight,
  CreditCard,
  Globe,
  Key,
  Lock,
  Mail,
  Shield,
  Users,
  Zap,
} from "lucide-react";
import { Link } from "wouter";

interface SettingsLink {
  icon: React.ElementType;
  title: string;
  description: string;
  href: string;
  badge?: string;
  roles?: string[];
}

const SETTINGS_LINKS: SettingsLink[] = [
  {
    icon: Building2,
    title: "Organisation Profile",
    description: "Update your MSP name, logo, and brand colour.",
    href: "/settings/profile",
  },
  {
    icon: Zap,
    title: "Connector & Exchange Online",
    description: "Choose how the platform connects to customer tenants. Configure Exchange Online credentials.",
    href: "/settings/connector",
    roles: ["MSPAdmin"],
  },
  {
    icon: Key,
    title: "Service Accounts",
    description: "Create and revoke machine-to-machine API keys for automation.",
    href: "/settings/service-accounts",
    roles: ["MSPAdmin"],
  },
  {
    icon: Users,
    title: "Team Members",
    description: "Invite operators and manage role assignments.",
    href: "/settings/team",
    roles: ["MSPAdmin"],
  },
  {
    icon: CreditCard,
    title: "Billing",
    description: "View your subscription status and manage your payment method.",
    href: "/settings/billing",
    roles: ["MSPAdmin"],
  },
  {
    icon: Mail,
    title: "Email Templates",
    description: "Customise the emails sent to your customers with your own branding.",
    href: "/settings/email-templates",
    roles: ["MSPAdmin"],
  },
  {
    icon: Shield,
    title: "Active Sessions",
    description: "Review and revoke active login sessions for your MSP users.",
    href: "/settings/sessions",
    roles: ["MSPAdmin"],
  },
  {
    icon: Globe,
    title: "Custom Domain",
    description: "Map a custom domain (e.g. portal.yourmsp.com) to the portal.",
    href: "/settings/custom-domain",
    roles: ["MSPAdmin"],
  },
  {
    icon: Bell,
    title: "Notifications",
    description: "Configure email and push notification preferences.",
    badge: "Upcoming",
    href: "#",
  },
  {
    icon: Lock,
    title: "Security & MFA",
    description: "Manage multi-factor authentication settings.",
    badge: "Upcoming",
    href: "#",
  },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const mspRole = user?.mspRole;

  function isVisible(section: SettingsLink) {
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
          {SETTINGS_LINKS.filter(isVisible).map((section) => {
            const isUpcoming = section.badge === "Upcoming" || section.href === "#";
            const inner = (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card/60 px-4 py-3.5 hover:bg-card transition-colors">
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
                {!isUpcoming && (
                  <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                )}
              </div>
            );

            if (isUpcoming) {
              return <div key={section.title} className="opacity-60 cursor-not-allowed">{inner}</div>;
            }

            return (
              <Link key={section.title} href={section.href}>
                {inner}
              </Link>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
