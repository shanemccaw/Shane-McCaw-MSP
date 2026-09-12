/**
 * Icon resolver. The design references icons by their canonical Lucide
 * kebab-case names (README: "Icon names in the prototype are the canonical
 * Lucide kebab-case names ... so they translate directly"). This maps the exact
 * set the shell uses to `lucide-react` components — explicit named imports so
 * the bundle only carries the icons actually referenced, not the whole set.
 */
import {
  Search, KeyRound, Bell, ChevronDown, ChevronRight, Network, Briefcase,
  Building, Building2, Filter, PanelLeftClose, PanelLeftOpen, Plus, User,
  LifeBuoy, LogOut, Settings, ShieldAlert, GitPullRequest, ListChecks, Radar,
  Stethoscope, Wrench, Gavel, CalendarX, Waypoints, Play, ClipboardCheck, Scale,
  UsersRound, BookOpen, Users, Webhook, Rocket, Receipt, FileText, Files,
  History, Gauge, ChartLine, Activity, Database, Handshake, ScrollText, Plug,
  Info, TriangleAlert, Circle, CornerDownLeft,
  type LucideIcon,
} from "lucide-react";

const REGISTRY: Record<string, LucideIcon> = {
  search: Search,
  "key-round": KeyRound,
  bell: Bell,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  network: Network,
  briefcase: Briefcase,
  building: Building,
  "building-2": Building2,
  filter: Filter,
  "panel-left-close": PanelLeftClose,
  "panel-left-open": PanelLeftOpen,
  plus: Plus,
  user: User,
  "life-buoy": LifeBuoy,
  "log-out": LogOut,
  settings: Settings,
  "shield-alert": ShieldAlert,
  "git-pull-request": GitPullRequest,
  "list-checks": ListChecks,
  radar: Radar,
  stethoscope: Stethoscope,
  wrench: Wrench,
  gavel: Gavel,
  "calendar-x": CalendarX,
  waypoints: Waypoints,
  play: Play,
  "clipboard-check": ClipboardCheck,
  scale: Scale,
  "users-round": UsersRound,
  "book-open": BookOpen,
  users: Users,
  webhook: Webhook,
  rocket: Rocket,
  receipt: Receipt,
  "file-text": FileText,
  files: Files,
  history: History,
  gauge: Gauge,
  "chart-line": ChartLine,
  activity: Activity,
  database: Database,
  handshake: Handshake,
  "scroll-text": ScrollText,
  plug: Plug,
  info: Info,
  "triangle-alert": TriangleAlert,
  "corner-down-left": CornerDownLeft,
};

export type IconName = keyof typeof REGISTRY | (string & {});

export function Icon({
  name,
  size = 16,
  color,
  strokeWidth = 2,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Cmp = REGISTRY[name] ?? Circle;
  return (
    <Cmp
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      className={className}
      style={style}
      aria-hidden
    />
  );
}
