/**
 * shell-status-widgets.tsx
 *
 * Real status widgets rendered from app-shell.tsx, sourced from
 * ShellStatusProvider (shell-status-context.tsx) — no fabricated data, no
 * new server-side computation. Honest "—" / loading states when the
 * underlying engine hasn't returned data yet.
 */

import { Link } from "wouter";
import { AlertCircle, AlertTriangle, CheckCircle2, ShieldCheck, AlertOctagon, CircleDashed, MoreHorizontal } from "lucide-react";
import { useShellStatus } from "@/lib/shell-status-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type OverallStatus = "on_track" | "attention_needed" | "action_required";

const OVERALL_CONFIG: Record<OverallStatus, { icon: typeof CheckCircle2; className: string }> = {
  on_track: { icon: CheckCircle2, className: "border-status-green/40 bg-status-green/15 text-status-green" },
  attention_needed: { icon: AlertTriangle, className: "border-status-amber/40 bg-status-amber/15 text-status-amber" },
  action_required: { icon: AlertCircle, className: "border-status-red/40 bg-status-red/15 text-status-red" },
};

function StatusPill({
  status,
  label,
  headline,
}: {
  status: OverallStatus | null;
  label: string;
  headline: string | null;
}) {
  if (!status) {
    return (
      <span
        className="hidden lg:inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-1 text-[10px] font-medium text-muted-foreground"
        title={`${label}: loading…`}
      >
        <CircleDashed className="size-3 animate-pulse" />
        {label}
      </span>
    );
  }
  const { icon: Icon, className } = OVERALL_CONFIG[status];
  return (
    <span
      className={`hidden lg:inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${className}`}
      title={headline ?? label}
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}

/** Deliverable 1 — Project Scope, from GET /api/portal/customer/scope-status (Scope Creep Engine).
 * Full "Project Scope" label (not the bare "Scope" this used to show) so the
 * pill is self-explanatory without relying on the hover tooltip — Git #1144. */
export function ProjectScopeIndicator() {
  const { scopeStatus } = useShellStatus();
  return <StatusPill status={scopeStatus?.overall ?? null} label="Project Scope" headline={scopeStatus?.headline ?? null} />;
}

/** Deliverable 2 — Service Status, from GET /api/portal/customer/sla-status (SLA Engine).
 * Full "Service Status" label, same reasoning as ProjectScopeIndicator above — Git #1144. */
export function ServiceStatusIndicator() {
  const { slaStatus } = useShellStatus();
  return <StatusPill status={slaStatus?.overall ?? null} label="Service Status" headline={slaStatus?.headline ?? null} />;
}

function CountSquare({ label, value, title }: { label: string; value: number | null; title: string }) {
  return (
    <div
      className="hidden xl:flex flex-col items-center justify-center rounded-md border border-border bg-muted/30 px-2 py-1 min-w-[2.75rem]"
      title={title}
    >
      <span className="text-sm font-semibold text-foreground leading-none">{value ?? "—"}</span>
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground leading-none mt-0.5">{label}</span>
    </div>
  );
}

/** Deliverable 3 — Compliance count: real mission-control findings filtered to
 * the same compliance keyword set the /compliance page itself uses. */
export function ComplianceCountSquare() {
  const { complianceFindingCount } = useShellStatus();
  return (
    <CountSquare
      label="Compliance"
      value={complianceFindingCount}
      title="Compliance-related findings from your latest scan"
    />
  );
}

/** Deliverable 4 — Open Requests: real SLA Engine runningTimers count. */
export function OpenRequestsCountSquare() {
  const { slaStatus } = useShellStatus();
  return (
    <CountSquare
      label="Requests"
      value={slaStatus?.openRequests ?? null}
      title="Open service requests currently being tracked"
    />
  );
}

/** Mobile/tablet overflow for the four status widgets above — below `lg`
 * (Scope/Service) and `xl` (Compliance/Requests) those render `hidden` and
 * are simply unreachable on a phone. This surfaces the same real values
 * (same useShellStatus() source, no refetch) in a "⋯" dropdown instead. */
export function ShellStatusOverflowMenu() {
  const { scopeStatus, slaStatus, complianceFindingCount } = useShellStatus();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="lg:hidden rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="More status"
          title="More status"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-2">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="flex flex-col gap-1.5 p-1.5">
          <OverflowStatusRow status={scopeStatus?.overall ?? null} label="Project Scope" headline={scopeStatus?.headline ?? null} />
          <OverflowStatusRow status={slaStatus?.overall ?? null} label="Service Status" headline={slaStatus?.headline ?? null} />
          <OverflowCountRow label="Compliance findings" value={complianceFindingCount} />
          <OverflowCountRow label="Open requests" value={slaStatus?.openRequests ?? null} />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OverflowStatusRow({
  status,
  label,
  headline,
}: {
  status: OverallStatus | null;
  label: string;
  headline: string | null;
}) {
  if (!status) {
    return (
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <CircleDashed className="size-3 animate-pulse" />
          loading…
        </span>
      </div>
    );
  }
  const { icon: Icon, className } = OVERALL_CONFIG[status];
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${className}`}>
        <Icon className="size-3" />
        {headline ?? status.replace(/_/g, " ")}
      </span>
    </div>
  );
}

function OverflowCountRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value ?? "—"}</span>
    </div>
  );
}

const BAND_COLOR_VAR: Record<"green" | "amber" | "red", string> = {
  green: "var(--color-status-green)",
  amber: "var(--color-status-amber)",
  red: "var(--color-status-red)",
};
const BAND_TEXT_CLASS: Record<"green" | "amber" | "red", string> = {
  green: "text-status-green",
  amber: "text-status-amber",
  red: "text-status-red",
};
function scoreBand(score: number): "green" | "amber" | "red" {
  if (score >= 70) return "green";
  if (score >= 40) return "amber";
  return "red";
}
const BAND_ICON = { green: ShieldCheck, amber: AlertTriangle, red: AlertOctagon };

/** Deliverable 6 — M365 Health circle, moved into the shell sidebar. Same real
 * score derivation (average of covered pillars) and band thresholds as
 * HeroHealthScore.tsx on /m365-health — a smaller mini version for the
 * sidebar rail, reusing the shared score from ShellStatusProvider so this
 * doesn't refetch the heavy assessment/status payload the page also uses. */
export function SidebarHealthCircle({ collapsed = false }: { collapsed?: boolean }) {
  const { healthScore } = useShellStatus();
  const band = healthScore != null ? scoreBand(healthScore) : null;
  const circumference = 2 * Math.PI * 15;
  const strokeDashoffset =
    healthScore != null ? circumference - (circumference * healthScore) / 100 : circumference;

  if (collapsed) {
    return (
      <div className="flex justify-center py-1" title="M365 Health Score">
        <svg className="w-7 h-7 -rotate-90">
          <circle cx="14" cy="14" r="11" fill="transparent" stroke="hsl(var(--muted))" strokeWidth="3" />
          {healthScore != null && (
            <circle
              cx="14"
              cy="14"
              r="11"
              fill="transparent"
              stroke={band ? BAND_COLOR_VAR[band] : "var(--color-status-blue)"}
              strokeWidth="3"
              strokeDasharray={2 * Math.PI * 11}
              strokeDashoffset={
                2 * Math.PI * 11 - (healthScore != null ? (2 * Math.PI * 11 * healthScore) / 100 : 0)
              }
              strokeLinecap="round"
            />
          )}
        </svg>
      </div>
    );
  }

  const BandIcon = band ? BAND_ICON[band] : CircleDashed;

  return (
    <Link
      href="/m365-health"
      className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-sidebar-accent/40 transition-colors"
      title="M365 Health Score"
    >
      <div className="relative shrink-0">
        <svg className="w-9 h-9 -rotate-90">
          <circle cx="18" cy="18" r="15" fill="transparent" stroke="hsl(var(--muted))" strokeWidth="4" />
          {healthScore != null && (
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="transparent"
              stroke={band ? BAND_COLOR_VAR[band] : "var(--color-status-blue)"}
              strokeWidth="4"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transition-all duration-700 ease-out"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <BandIcon className={`size-3.5 ${band ? BAND_TEXT_CLASS[band] : "text-muted-foreground"}`} />
        </div>
      </div>
      <div className="min-w-0 leading-tight">
        <p className="text-[10px] uppercase tracking-wide text-sidebar-foreground/50">M365 Health</p>
        <p className={`text-sm font-semibold ${band ? BAND_TEXT_CLASS[band] : "text-sidebar-foreground/60"}`}>
          {healthScore ?? "—"}
        </p>
      </div>
    </Link>
  );
}
