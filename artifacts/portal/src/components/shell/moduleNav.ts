import type { ComponentType } from "react";
import {
  LayoutDashboard,
  Megaphone,
  Waypoints,
  AlertTriangle,
  ClipboardList,
  Wrench,
  BookOpen,
  BookOpenCheck,
  Users,
  Scale,
  Layers,
  FileCheck2,
  Compass,
  Gauge,
  FileText,
  Stethoscope,
  ClipboardList,
  type LucideProps,
} from "lucide-react";

/**
 * Sidebar module nav — order and labels are the design's own (README
 * "Sidebar module list"). Every module epic under #1485 exists; almost none
 * have a real page in `artifacts/portal` yet (#1819's own constraint), so
 * each row carries a `builtPath` only once its module has actually shipped a
 * real page. `builtPath: null` routes through the existing honest
 * `/coming-soon?feature=` page (Git #1827) rather than a dead link or a page
 * that pretends to exist.
 *
 * Icons are lucide-react, chosen for semantic fit — the sidebar carries no
 * "hand-tuned, do not derive" constraint the way the pillar identity colours
 * in docs/design-system.md do, so exact icon-path parity with the design
 * reference isn't required here (see the README's own instruction to
 * recreate the reference using this codebase's established patterns, not
 * copy it verbatim).
 */
export interface ModuleNavItem {
  readonly key: string;
  readonly label: string;
  readonly icon: ComponentType<LucideProps>;
  /** Real route once the module has a page. Null = not yet built. */
  readonly builtPath: string | null;
}

export const MODULE_NAV_ITEMS: readonly ModuleNavItem[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, builtPath: "/" },
  // #1569's own body: "Sits above the Pillars in the portal IA, ungrouped,
  // next to Overview and Projects" — Projects has no page yet, so this sits
  // directly after Overview until Projects ships its own row.
  { key: "my-architect", label: "My Architect", icon: Compass, builtPath: "/my-architect" },
  // Sidebar position per the design_handoff_billing_roles_and_new_modules
  // README ("Status reports" after My Architect) — Git #4038, Feature #3435.
  { key: "status-reports", label: "Status reports", icon: ClipboardList, builtPath: "/status-reports" },
  { key: "changes", label: "Microsoft Changes", icon: Megaphone, builtPath: "/microsoft-changes" },
  { key: "change-control", label: "Change Control", icon: Waypoints, builtPath: "/change-control" },
  { key: "scope-sla", label: "Scope and SLA", icon: Gauge, builtPath: "/scope-and-sla" },
  { key: "diagnostics", label: "Diagnostics", icon: Stethoscope, builtPath: "/diagnostics" },
  { key: "risk-register", label: "Risk Register", icon: AlertTriangle, builtPath: "/risk-register" },
  // #4037 (Feature #1935): design's own Shell nav update puts POA&Ms directly
  // after Risk Register — the sibling exit ("we are fixing this" vs. "we
  // accept the consequence").
  { key: "poams", label: "POA&Ms", icon: ClipboardList, builtPath: "/poams" },
  { key: "remediation", label: "Remediation", icon: Wrench, builtPath: "/remediation-tracking" },
  { key: "sops", label: "SOPs", icon: BookOpen, builtPath: "/sops" },
  { key: "runbooks", label: "Runbooks", icon: BookOpenCheck, builtPath: "/runbooks" },
  { key: "raci", label: "Ownership / RACI", icon: Users, builtPath: "/ownership" },
  { key: "policy", label: "Policy Decisions", icon: Scale, builtPath: "/policy-decisions" },
  { key: "config-state", label: "Configuration State", icon: Layers, builtPath: "/config-state" },
  { key: "security-plan", label: "Security Plan", icon: FileCheck2, builtPath: "/security-plan" },
  { key: "docs", label: "Documents", icon: FileText, builtPath: "/documents" },
];

/** `/coming-soon?feature=<label>&group=<group>` for a not-yet-built destination. */
export function comingSoonHref(label: string, group: "module" | "pillar" | "account"): string {
  return `/coming-soon?feature=${encodeURIComponent(label)}&group=${group}`;
}
