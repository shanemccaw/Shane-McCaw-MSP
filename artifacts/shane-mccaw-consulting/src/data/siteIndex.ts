import type { ComponentType } from "react";
import {
  ShieldCheck,
  Lock,
  Scale,
  CircleDollarSign,
  Users,
  Activity,
  Search,
  Monitor,
  Package,
  Clock,
  DollarSign,
  Sparkles,
  LayoutGrid,
} from "lucide-react";

// The real, live destination list this site can be searched over — the same data the 404 page's
// destination grid renders from (Design/404-export's `D` array), reconciled against the real
// routes registered in App.tsx rather than the handoff README's own summary count (which undercounts
// the solutions/deep-dive pages by one — /solutions/governance exists alongside the six others).
// Per the handoff's own note, this is meant to be the basis for the site's real search later, not a
// 404-only fixture — keep it in sync with App.tsx's routes if either drifts.

export interface SiteIndexEntry {
  label: string;
  blurb: string;
  href: string;
  icon: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  color: string;
  // Space-separated synonym list carrying the search terms people actually type
  // (e.g. "mfa", "licence waste", "merger", "cheap") — matched alongside label + blurb.
  keys: string;
}

export function buildSiteIndex(checkCount: number): SiteIndexEntry[] {
  return [
  {
    label: "Free tenant scan",
    blurb: `${checkCount} read-only checks across all six pillars`,
    href: "/scan",
    icon: Search,
    color: "#60a5fa",
    keys: "free scan diagnostic assessment graph audit",
  },
  {
    label: "Governance",
    blurb: "Lifecycle, naming, ownership, sprawl",
    href: "/pillars/governance",
    icon: ShieldCheck,
    color: "#3b82f6",
    keys: "governance lifecycle ownership sprawl naming",
  },
  {
    label: "Security",
    blurb: "Conditional Access, MFA, OAuth apps, guests",
    href: "/pillars/security",
    icon: Lock,
    color: "#8b5cf6",
    keys: "security mfa conditional access identity zero trust oauth guest",
  },
  {
    label: "Compliance",
    blurb: "Labels, DLP, retention, audit evidence",
    href: "/pillars/compliance",
    icon: Scale,
    color: "#e2e8f0",
    keys: "compliance dlp retention labels purview audit evidence",
  },
  {
    label: "Licensing",
    blurb: "Seat waste, SKU fit, renewal position",
    href: "/pillars/licensing",
    icon: CircleDollarSign,
    color: "#14b8a6",
    keys: "licensing licences seats sku cost renewal spend",
  },
  {
    label: "Adoption",
    blurb: "Usage signals, training gaps, rollout health",
    href: "/pillars/adoption",
    icon: Users,
    color: "#f97316",
    keys: "adoption usage training rollout change management",
  },
  {
    label: "Health",
    blurb: "Service incidents, drift, config decay",
    href: "/pillars/health",
    icon: Activity,
    color: "#22c55e",
    keys: "health drift incidents uptime service config",
  },
  {
    label: "Tenant monitoring",
    blurb: "Hourly signals from $180/mo",
    href: "/monitoring",
    icon: Monitor,
    color: "#22d3ee",
    keys: "monitoring alerts hourly signals watch drift engine",
  },
  {
    label: "Quick-Start Packs",
    blurb: "Fixed-price one-off fixes from $149",
    href: "/quick-start",
    icon: Package,
    color: "#a78bfa",
    keys: "quick start packs remediation fixed price cheap one off",
  },
  {
    label: "Architect retainers",
    blurb: "Reserved hours from $900/mo",
    href: "/retainers",
    icon: Clock,
    color: "#fbbf24",
    keys: "retainer advisory hours architect ongoing support",
  },
  {
    label: "Pricing",
    blurb: "Every published number in one place",
    href: "/pricing",
    icon: DollarSign,
    color: "#34d399",
    keys: "pricing price cost quote sow rates",
  },
  {
    label: "Copilot & AI",
    blurb: "Readiness, deployment, governance",
    href: "/solutions/copilot",
    icon: Sparkles,
    color: "#fbbf24",
    keys: "copilot ai readiness agents chatgpt deployment",
  },
  {
    label: "Governance projects",
    blurb: "Teams/Groups lifecycle, naming, admin roles",
    href: "/solutions/governance",
    icon: LayoutGrid,
    color: "#3b82f6",
    keys: "governance cleanup teams groups lifecycle naming admin roles baseline",
  },
  {
    label: "SharePoint",
    blurb: "IA, permissions, oversharing cleanup",
    href: "/solutions/sharepoint",
    icon: LayoutGrid,
    color: "#60a5fa",
    keys: "sharepoint sites permissions oversharing intranet onedrive",
  },
  {
    label: "Teams",
    blurb: "Voice, policies, guest and lifecycle",
    href: "/solutions/teams",
    icon: LayoutGrid,
    color: "#8b5cf6",
    keys: "teams voice phone meetings channels policies",
  },
  {
    label: "Power Platform",
    blurb: "Environments, DLP, maker governance",
    href: "/solutions/power-platform",
    icon: LayoutGrid,
    color: "#22d3ee",
    keys: "power platform apps automate flows dataverse makers",
  },
  {
    label: "Migration",
    blurb: "Tenant-to-tenant, domains, cutover",
    href: "/solutions/migration",
    icon: LayoutGrid,
    color: "#f472b6",
    keys: "migration tenant move merger acquisition cutover domain",
  },
  {
    label: "M365 Health projects",
    blurb: "Config remediation programmes",
    href: "/solutions/m365-health",
    icon: LayoutGrid,
    color: "#22c55e",
    keys: "m365 health projects remediation config",
  },
  {
    label: "Full solutions catalogue",
    blurb: "Every project across all six categories",
    href: "/solutions",
    icon: LayoutGrid,
    color: "#94a3b8",
    keys: "all projects catalogue solutions services list",
  },
  ];
}
