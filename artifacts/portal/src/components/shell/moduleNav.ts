import type { ComponentType } from "react";
import {
  LayoutDashboard,
  Megaphone,
  Waypoints,
  AlertTriangle,
  Wrench,
  BookOpen,
  BookOpenCheck,
  Users,
  Scale,
  Layers,
  FileCheck2,
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
  { key: "changes", label: "Microsoft Changes", icon: Megaphone, builtPath: null },
  { key: "change-control", label: "Change Control", icon: Waypoints, builtPath: null },
  { key: "risk-register", label: "Risk Register", icon: AlertTriangle, builtPath: null },
  { key: "remediation", label: "Remediation", icon: Wrench, builtPath: null },
  { key: "sops", label: "SOPs", icon: BookOpen, builtPath: null },
  { key: "runbooks", label: "Runbooks", icon: BookOpenCheck, builtPath: null },
  { key: "raci", label: "Ownership / RACI", icon: Users, builtPath: null },
  { key: "policy", label: "Policy Decisions", icon: Scale, builtPath: null },
  { key: "config-state", label: "Configuration State", icon: Layers, builtPath: null },
  { key: "security-plan", label: "Security Plan", icon: FileCheck2, builtPath: null },
];

/** `/coming-soon?feature=<label>&group=module` for a not-yet-built module row. */
export function comingSoonHref(label: string, group: "module" | "pillar"): string {
  return `/coming-soon?feature=${encodeURIComponent(label)}&group=${group}`;
}
