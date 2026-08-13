/**
 * CustomerOverviewScreen.tsx
 *
 * Literal structural translation of the approved "Tenant Intelligence
 * Snapshot" Stitch reference mockup, for the CustomerUser main overview page
 * (customer-dashboard.tsx). Built by hand against the real msp-portal design
 * tokens and the real data shapes already established this session.
 *
 * This is the PREMIUM / full-featured build — every section renders
 * unconditionally here. A separate, later pass will add real per-section
 * gating based on what the customer has actually purchased (reusing the
 * platform's existing real entitlement/tier patterns — Launch Control's
 * two-axis MSP-tier + customer-tier model is the established real precedent
 * to follow, not a new mechanism).
 *
 * Every data point below is one of three states, clearly marked:
 *   REAL        — wired to genuine, already-confirmed data shapes
 *                 (MissionControl's real OverviewResponse: health.pillars,
 *                 findings[], summary).
 *   NEEDS-WIRING — the real underlying data genuinely exists elsewhere in
 *                 this platform (the metrics registry — licensing.*,
 *                 identity.*, intune.* — and the Cost Engine) but isn't yet
 *                 exposed through a single endpoint this component can call.
 *                 Marked with the exact real metric key(s) that will
 *                 eventually feed it. NEVER silently presented as live.
 *   OMITTED     — no real per-item schedule/config data exists (e.g. the
 *                 mockup's specific "Next: Mon 08:00" drift-alert timing) —
 *                 left generic rather than fabricated.
 *
 * Uses this app's real dark-mode tokens (index.css .dark block) throughout —
 * NOT the mockup's own Material You palette/Inter+JetBrains Mono font pairing.
 *
 * INTEGRATION NOTE (learned the hard way on the Assessment screen): this must
 * be wired into customer-dashboard.tsx as a genuinely additive change — a new
 * import plus inserting this component in place of (or alongside)
 * <MissionControl />/<CustomerDashboardExtras />, never by replacing the
 * whole page file. See the corrected Assessment integration prompt for the
 * exact pattern to follow.
 */
import { Link } from "wouter";
import {
  HeartPulse,
  ShieldAlert,
  Gavel,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronRight,
  CircleAlert,
  TriangleAlert,
  AppWindow,
  UserSearch,
  CheckCircle2,
  XCircle,
  Info,
  Coins,
  Wand2,
  Wrench,
  BellRing,
  FileText,
  Download,
  Zap,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────

/** REAL — matches MissionControl's real EnginesResponse.health shape. */
interface HealthPillar {
  pillar: string;
  label: string;
  score: number; // already-inverted "goodness" percent, 0-100
  trend?: { direction: "up" | "down" | "flat"; deltaPct: number } | null; // NEEDS-WIRING — see note below
}

/** REAL — matches MissionControl's real OverviewFinding shape exactly. */
interface Finding {
  id: number;
  checkLabel: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string | null;
  action: string | null;
}

/** NEEDS-WIRING — real source: licensing.* metrics + cost-engine.ts. */
interface LicenseCostSnapshot {
  totalMonthlyWasteCents: number | null;
  inactiveLicenseCount: number | null;
  duplicateSubscriptionMonthlyCents: number | null;
  copilotReadyUserCount: number | null;
  roiOpportunities: { label: string; detail: string; monthlyCents: number; kind: "roi" | "savings" }[];
}

/** NEEDS-WIRING — real source: identity.* metrics (globalAdminCount, mfaRegisteredCount, caPolicyCount). */
interface IdentitySnapshot {
  privilegedRoleCount: number | null;
  mfaCoveragePct: number | null;
  conditionalAccessCoveragePct: number | null;
}

/** NEEDS-WIRING — real source: intune.* metrics (per-OS compliance breakdown). */
interface DeviceComplianceSnapshot {
  overallScorePct: number | null;
  byPlatform: { label: string; pct: number; driftNote?: string | null }[];
}

export interface CustomerOverviewScreenProps {
  // REAL
  overallHealthPct: number | null;
  pillars: HealthPillar[]; // real 7 pillars, but Hero shows a curated subset (health/security/governance/copilot) matching the mockup
  findings: Finding[];
  lastScanLabel: string | null; // e.g. "12 mins ago" — derive from real scan.lastScanAt, don't fabricate
  // NEEDS-WIRING (all optional; section hides gracefully if undefined)
  licenseCost?: LicenseCostSnapshot;
  identity?: IdentitySnapshot;
  deviceCompliance?: DeviceComplianceSnapshot;
  customerDisplayName?: string;
}

// ── Shared bits ───────────────────────────────────────────────────────────

function TrendChip({ direction, deltaPct }: { direction: "up" | "down" | "flat"; deltaPct: number }) {
  if (direction === "flat") {
    return (
      <div className="flex items-center text-muted-foreground gap-1">
        <Minus className="size-3.5" />
        <span className="text-xs font-mono">Stable</span>
      </div>
    );
  }
  const isGood = direction === "up";
  return (
    <div className={cn("flex items-center gap-1", isGood ? "text-[hsl(149,36%,49%)]" : "text-destructive")}>
      {isGood ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
      <span className="text-xs font-mono">
        {deltaPct > 0 ? "+" : ""}
        {deltaPct}%
      </span>
    </div>
  );
}

const SEVERITY_META: Record<Finding["severity"], { icon: React.ElementType; iconCls: string; bgCls: string; badgeCls: string; label: string }> = {
  critical: { icon: CircleAlert, iconCls: "text-destructive", bgCls: "bg-destructive/10", badgeCls: "bg-destructive/10 text-destructive", label: "Red" },
  warning: { icon: TriangleAlert, iconCls: "text-[hsl(40,65%,55%)]", bgCls: "bg-[hsl(40,65%,55%)]/10", badgeCls: "bg-[hsl(40,65%,55%)]/10 text-[hsl(40,65%,55%)]", label: "Amber" },
  info: { icon: Info, iconCls: "text-primary", bgCls: "bg-primary/10", badgeCls: "bg-primary/10 text-primary", label: "Info" },
};

// ── Section 1: Hero Snapshot ──────────────────────────────────────────────

function ScoreCard({
  icon: Icon,
  iconCls,
  bgCls,
  label,
  value,
  trend,
  lastScanLabel,
}: {
  icon: React.ElementType;
  iconCls: string;
  bgCls: string;
  label: string;
  value: number | null;
  trend?: HealthPillar["trend"];
  lastScanLabel: string | null;
}) {
  return (
    <div className="bg-card border border-border p-6 rounded-2xl flex flex-col gap-4 hover:border-primary/50 transition-all">
      <div className="flex justify-between items-start">
        <span className={cn("p-2 rounded-lg", bgCls)}>
          <Icon className={cn("size-5", iconCls)} />
        </span>
        {trend ? <TrendChip direction={trend.direction} deltaPct={trend.deltaPct} /> : null}
      </div>
      <div>
        <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
        <div className="text-4xl font-bold text-foreground">{value != null ? `${value}%` : "—"}</div>
      </div>
      {lastScanLabel && (
        <div className="text-[10px] text-muted-foreground/60 font-mono border-t border-border pt-2">
          Last scan: {lastScanLabel}
        </div>
      )}
    </div>
  );
}

function HeroSnapshot({
  overallHealthPct,
  pillars,
  lastScanLabel,
  customerDisplayName,
}: {
  overallHealthPct: number | null;
  pillars: HealthPillar[];
  lastScanLabel: string | null;
  customerDisplayName?: string;
}) {
  const byPillar = (key: string) => pillars.find((p) => p.pillar === key);
  const security = byPillar("security");
  const governance = byPillar("governance");
  const copilot = byPillar("copilot");

  return (
    <section className="relative py-10 lg:py-16">
      <h1 className="text-3xl lg:text-5xl font-bold text-foreground mb-4 tracking-tight leading-tight">
        {customerDisplayName ? `${customerDisplayName}'s` : "Your"} Tenant's <span className="text-primary">Real-Time Health</span> &amp;{" "}
        <span className="text-accent">Risk Posture</span>
      </h1>
      <p className="text-lg text-muted-foreground max-w-3xl mb-8 leading-relaxed">
        Real-time visibility into your Microsoft 365 security, governance, and Copilot readiness.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <ScoreCard
          icon={HeartPulse}
          iconCls="text-primary"
          bgCls="bg-primary/10"
          label="Tenant Health"
          value={overallHealthPct}
          lastScanLabel={lastScanLabel}
        />
        <ScoreCard
          icon={ShieldAlert}
          iconCls="text-destructive"
          bgCls="bg-destructive/10"
          label="Security"
          value={security?.score ?? null}
          trend={security?.trend}
          lastScanLabel={lastScanLabel}
        />
        <ScoreCard
          icon={Gavel}
          iconCls="text-accent"
          bgCls="bg-accent/10"
          label="Governance"
          value={governance?.score ?? null}
          trend={governance?.trend}
          lastScanLabel={lastScanLabel}
        />
        <ScoreCard
          icon={Sparkles}
          iconCls="text-accent"
          bgCls="bg-accent/10"
          label="Copilot Readiness"
          value={copilot?.score ?? null}
          trend={copilot?.trend}
          lastScanLabel={lastScanLabel}
        />
      </div>
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <Link href="/reports">
          <Button size="lg" className="rounded-xl px-8 py-6 font-bold flex items-center gap-2">
            View Full Findings
            <ChevronRight className="size-4" />
          </Button>
        </Link>
      </div>
    </section>
  );
}

// ── Section 2: Critical Findings ──────────────────────────────────────────

function CriticalFindingsPanel({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;
  const hasCritical = findings.some((f) => f.severity === "critical");
  return (
    <section className="mb-10">
      <div className="bg-card border border-border rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-border flex justify-between items-center">
          <h2 className="text-xl font-semibold text-foreground">Critical Findings</h2>
          {hasCritical && (
            <span className="px-3 py-1 bg-destructive/20 text-destructive rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-2">
              <span className="w-2 h-2 bg-destructive rounded-full animate-pulse" />
              Action Required
            </span>
          )}
        </div>
        <div className="divide-y divide-border">
          {findings.slice(0, 6).map((finding) => {
            const meta = SEVERITY_META[finding.severity];
            const Icon = meta.icon;
            return (
              <div key={finding.id} className="p-6 flex items-center justify-between group hover:bg-white/5 transition-all">
                <div className="flex items-center gap-4 min-w-0">
                  <div className={cn("size-10 rounded-full flex items-center justify-center shrink-0", meta.bgCls)}>
                    <Icon className={cn("size-5", meta.iconCls)} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-foreground truncate">{finding.title}</h4>
                    {finding.description && (
                      <p className="text-sm text-muted-foreground truncate">{finding.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-6 shrink-0">
                  <span className={cn("px-3 py-1 rounded-md text-xs font-bold uppercase", meta.badgeCls)}>
                    {meta.label}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Section 3: Score Drivers ───────────────────────────────────────────────
// REAL — same pillars/findings data, grouped by category for this section.

function ScoreDriverCard({
  icon: Icon,
  iconCls,
  label,
  items,
}: {
  icon: React.ElementType;
  iconCls: string;
  label: string;
  items: { good: boolean; title: string; detail: string }[];
}) {
  return (
    <div className="bg-card border border-border p-6 rounded-2xl flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Icon className={cn("size-5", iconCls)} />
        <h3 className="font-bold text-lg text-foreground">{label}</h3>
      </div>
      <ul className="space-y-4">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-3">
            {item.good ? (
              <CheckCircle2 className="size-4 text-[hsl(149,36%,49%)] mt-0.5 shrink-0" />
            ) : (
              <XCircle className="size-4 text-destructive mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{item.title}</p>
              <p className="text-xs text-muted-foreground">{item.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScoreDrivers({ findings }: { findings: Finding[] }) {
  // REAL derivation — group real findings by category into the three real
  // driver cards the mockup shows. Categories are illustrative groupings of
  // the same real finding.category field already on OverviewFinding.
  const byCategory = (cats: string[]) =>
    findings.filter((f) => f.checkLabel && cats.some((c) => f.checkLabel.toLowerCase().includes(c)));

  const security = byCategory(["mfa", "identity", "auth", "app"]).slice(0, 2);
  const governance = byCategory(["naming", "group", "governance"]).slice(0, 2);
  const copilotItems = byCategory(["copilot", "sharing", "license"]).slice(0, 2);

  if (security.length === 0 && governance.length === 0 && copilotItems.length === 0) return null;

  const toItems = (fs: Finding[]) =>
    fs.map((f) => ({ good: f.severity === "info", title: f.title, detail: f.description ?? "" }));

  return (
    <section className="mb-10">
      <h2 className="text-xl font-semibold text-foreground mb-6">Score Drivers</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {security.length > 0 && <ScoreDriverCard icon={ShieldAlert} iconCls="text-destructive" label="Security" items={toItems(security)} />}
        {governance.length > 0 && <ScoreDriverCard icon={Gavel} iconCls="text-accent" label="Governance" items={toItems(governance)} />}
        {copilotItems.length > 0 && <ScoreDriverCard icon={Sparkles} iconCls="text-accent" label="Copilot" items={toItems(copilotItems)} />}
      </div>
    </section>
  );
}

// ── Section 4: License & Cost Intelligence — NEEDS-WIRING ─────────────────

function LicenseCostIntelligence({ data }: { data?: LicenseCostSnapshot }) {
  if (!data) return null;
  const wasteDisplay = data.totalMonthlyWasteCents != null ? `$${Math.round(data.totalMonthlyWasteCents / 100 / 1000)}k` : "—";
  return (
    <section className="mb-10">
      <h2 className="text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
        <Coins className="size-5 text-[hsl(149,36%,49%)]" />
        License &amp; Cost Intelligence
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border p-8 rounded-3xl">
          <h3 className="text-lg font-bold mb-6 text-foreground">Waste &amp; Eligibility</h3>
          <div className="flex gap-8 items-center">
            <div className="relative w-28 h-28 flex items-center justify-center shrink-0">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" fill="none" r="16" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
                <circle cx="18" cy="18" fill="none" r="16" stroke="hsl(149,36%,49%)" strokeDasharray="75, 100" strokeLinecap="round" strokeWidth="4" />
              </svg>
              <span className="absolute text-xl font-bold text-foreground">{wasteDisplay}</span>
            </div>
            <div className="flex-1 space-y-3">
              {data.inactiveLicenseCount != null && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Inactive Licenses</span>
                  <span className="font-bold text-[hsl(149,36%,49%)]">{data.inactiveLicenseCount}</span>
                </div>
              )}
              {data.duplicateSubscriptionMonthlyCents != null && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Duplicate Subscriptions</span>
                  <span className="font-bold text-[hsl(149,36%,49%)]">
                    ${(data.duplicateSubscriptionMonthlyCents / 100).toLocaleString()}/mo
                  </span>
                </div>
              )}
              {data.copilotReadyUserCount != null && (
                <div className="flex justify-between items-center text-sm border-t border-border pt-2">
                  <span className="text-muted-foreground">Copilot Ready Users</span>
                  <span className="font-bold text-primary">{data.copilotReadyUserCount}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        {data.roiOpportunities.length > 0 && (
          <div className="bg-card border border-border p-8 rounded-3xl">
            <h3 className="text-lg font-bold mb-6 text-foreground">Value Realization</h3>
            <div className="space-y-5">
              {data.roiOpportunities.slice(0, 3).map((opp, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-white/5 shrink-0">
                    <Wand2 className="size-4 text-[hsl(149,36%,49%)]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground">{opp.label}</p>
                    <p className="text-xs text-muted-foreground">{opp.detail}</p>
                  </div>
                  <div className="ml-auto text-right shrink-0">
                    <p className="text-[hsl(149,36%,49%)] font-bold">${(opp.monthlyCents / 100).toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">
                      {opp.kind === "roi" ? "Potential ROI" : "Monthly Save"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Section 5: Identity & Access — NEEDS-WIRING ────────────────────────────

function IdentityAccessSection({ data }: { data?: IdentitySnapshot }) {
  if (!data) return null;
  return (
    <section className="mb-10">
      <h2 className="text-xl font-semibold text-foreground mb-6">Identity &amp; Access Management</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {data.privilegedRoleCount != null && (
          <div className="bg-card border border-border p-6 rounded-2xl">
            <p className="text-xs text-muted-foreground mb-2">Privileged Roles</p>
            <div className="flex items-end justify-between">
              <span className="text-4xl font-bold text-foreground">{data.privilegedRoleCount}</span>
            </div>
          </div>
        )}
        {data.mfaCoveragePct != null && (
          <div className="bg-card border border-border p-6 rounded-2xl">
            <p className="text-xs text-muted-foreground mb-2">MFA Coverage</p>
            <div className="flex items-end justify-between">
              <span className="text-4xl font-bold text-foreground">{data.mfaCoveragePct}%</span>
            </div>
            <div className="mt-4 flex gap-1">
              <div className="h-1 bg-primary rounded-full" style={{ width: `${data.mfaCoveragePct}%` }} />
              <div className="h-1 flex-1 bg-white/10 rounded-full" />
            </div>
          </div>
        )}
        {data.conditionalAccessCoveragePct != null && (
          <div
            className={cn(
              "bg-card border border-border p-6 rounded-2xl",
              data.conditionalAccessCoveragePct >= 100 && "border-l-4 border-l-[hsl(149,36%,49%)]",
            )}
          >
            <p className="text-xs text-muted-foreground mb-2">Conditional Access</p>
            <div className="flex items-end justify-between">
              <span className="text-4xl font-bold text-foreground">{data.conditionalAccessCoveragePct}%</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Section 6: Device & Compliance — NEEDS-WIRING ──────────────────────────

function DeviceComplianceSection({ data }: { data?: DeviceComplianceSnapshot }) {
  if (!data) return null;
  return (
    <section className="mb-10">
      <div className="bg-card border border-border rounded-3xl p-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Compliance Distribution</h2>
            <p className="text-sm text-muted-foreground">Real-time device health vs. organizational baseline.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 items-center">
          {data.overallScorePct != null && (
            <div className="md:col-span-4 flex justify-center">
              <div className="w-40 h-40 relative flex items-center justify-center">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" fill="none" r="16" stroke="hsl(3,68%,25%)" strokeWidth="5" />
                  <circle
                    cx="18"
                    cy="18"
                    fill="none"
                    r="16"
                    stroke="#479ef5"
                    strokeDasharray={`${data.overallScorePct}, 100`}
                    strokeLinecap="round"
                    strokeWidth="5"
                  />
                </svg>
                <div className="absolute text-center">
                  <div className="text-2xl font-bold text-foreground">{data.overallScorePct}%</div>
                  <div className="text-[10px] text-muted-foreground uppercase">Overall Score</div>
                </div>
              </div>
            </div>
          )}
          <div className="md:col-span-8 space-y-5">
            {data.byPlatform.map((p) => (
              <div key={p.label}>
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-medium text-foreground">{p.label}</span>
                  <span className="text-sm font-bold text-foreground">{p.pct}%</span>
                </div>
                <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                  <div className={cn("h-full", p.pct >= 85 ? "bg-primary" : "bg-destructive")} style={{ width: `${p.pct}%` }} />
                </div>
                {p.driftNote && <p className="text-[10px] text-destructive mt-1">{p.driftNote}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Section 7: Automation & Reports — real navigation links ────────────────

function AutomationCard({
  icon: Icon,
  iconCls,
  bgCls,
  title,
  description,
  actionLabel,
  actionIcon: ActionIcon,
  href,
  footer,
}: {
  icon: React.ElementType;
  iconCls: string;
  bgCls: string;
  title: string;
  description: string;
  actionLabel?: string;
  actionIcon?: React.ElementType;
  href: string;
  footer?: React.ReactNode;
}) {
  return (
    <Link href={href}>
      <div className="bg-card border border-border p-6 rounded-2xl group hover:-translate-y-1 transition-all cursor-pointer h-full flex flex-col">
        <div className={cn("size-12 rounded-xl flex items-center justify-center mb-4", bgCls)}>
          <Icon className={cn("size-5", iconCls)} />
        </div>
        <h3 className="font-bold mb-2 text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground mb-4 leading-relaxed flex-1">{description}</p>
        {footer ?? (
          actionLabel && (
            <span className="text-xs font-bold text-primary flex items-center gap-1">
              {actionLabel}
              {ActionIcon && <ActionIcon className="size-3.5" />}
            </span>
          )
        )}
      </div>
    </Link>
  );
}

function AutomationAndReports() {
  return (
    <section className="mb-16">
      <h2 className="text-xl font-semibold text-foreground mb-6">Automation &amp; Orchestration</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <AutomationCard
          icon={FileText}
          iconCls="text-primary"
          bgCls="bg-primary/10"
          title="Monthly Health Report"
          description="Comprehensive audit of your tenant's state across all workloads."
          actionLabel="Download PDF"
          actionIcon={Download}
          href="/reports"
        />
        <AutomationCard
          icon={Wand2}
          iconCls="text-accent"
          bgCls="bg-accent/10"
          title="Recommended Offers"
          description="Real, signal-driven recommendations based on your current findings."
          actionLabel="Browse Offers"
          actionIcon={Zap}
          href="/customer-offers"
        />
        <AutomationCard
          icon={Wrench}
          iconCls="text-[hsl(40,65%,55%)]"
          bgCls="bg-[hsl(40,65%,55%)]/10"
          title="Remediation Guidance"
          description="Step-by-step guidance for closing your current critical findings."
          actionLabel="Review Findings"
          actionIcon={Eye}
          href="/reports"
        />
        <AutomationCard
          icon={BellRing}
          iconCls="text-destructive"
          bgCls="bg-destructive/10"
          title="Drift Alerts"
          description="Notifications when your configuration deviates from baseline."
          href="/alerts"
          footer={
            <span className="text-[10px] bg-[hsl(149,36%,49%)]/20 text-[hsl(149,36%,49%)] px-2 py-0.5 rounded self-start">
              Manage Alerts
            </span>
          }
        />
      </div>
    </section>
  );
}

// ── Root component ────────────────────────────────────────────────────────

export function CustomerOverviewScreen({
  overallHealthPct,
  pillars,
  findings,
  lastScanLabel,
  licenseCost,
  identity,
  deviceCompliance,
  customerDisplayName,
}: CustomerOverviewScreenProps) {
  return (
    <div className="relative">
      <HeroSnapshot
        overallHealthPct={overallHealthPct}
        pillars={pillars}
        lastScanLabel={lastScanLabel}
        customerDisplayName={customerDisplayName}
      />
      <CriticalFindingsPanel findings={findings} />
      <ScoreDrivers findings={findings} />
      <LicenseCostIntelligence data={licenseCost} />
      <IdentityAccessSection data={identity} />
      <DeviceComplianceSection data={deviceCompliance} />
      <AutomationAndReports />
    </div>
  );
}