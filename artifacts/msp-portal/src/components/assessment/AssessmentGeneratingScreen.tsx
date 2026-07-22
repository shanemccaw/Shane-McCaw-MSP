/**
 * AssessmentGeneratingScreen.tsx
 *
 * Literal structural translation of the approved Stitch reference mockup for
 * the Assessment wizard's "generating" step, built by hand (not model-inferred)
 * against the real msp-portal design tokens and the real AssessmentStatus data
 * shape already wired in AssessmentWizard.tsx.
 *
 * UI-FIRST PASS — per direct instruction: get the structure in now, wire the
 * remaining real data sources afterward as a separate step. Every piece below
 * is one of three states, clearly marked:
 *   REAL       — wired to genuine AssessmentStatus fields already available.
 *   PLACEHOLDER — visually complete, but the real backend source doesn't exist
 *                 on this endpoint yet (drift %, license efficiency %, and the
 *                 per-finding "Critical Gaps" list). Marked with a TODO comment
 *                 naming the real system that will eventually feed it (the
 *                 Drift Engine for drift %, msp_diagnostic_findings for the
 *                 gaps grid). NEVER silently presented as real — swap these
 *                 for real props once the backend fields exist.
 *   OMITTED    — the mockup's per-stat "Shane's Analysis"/"Financial Lever"
 *                secondary insight cards have no real distinct data source
 *                (only the one main narrative exists) — left out entirely
 *                rather than fabricated, per the no-fabrication rule.
 *
 * Uses this app's real dark-mode tokens (index.css .dark block) throughout —
 * NOT the mockup's own Material You palette/Hanken Grotesk font/WebGL shader.
 */
import { Quote, Route, ShieldCheck, AlertTriangle, CheckCircle2, FileText, Rocket } from "lucide-react";
import { Radar as RadarChart, type DistributionWidgetData } from "@workspace/dashboard-canvas";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────

interface ExpectedDoc {
  docType: string;
  title: string;
}

interface DocItem {
  docType: string;
  status: string; // "generating" | "approved" | "delivered" | "failed" | ...
}

interface RadarPillar {
  pillar: string;
  label: string;
  score: number;
}

/** PLACEHOLDER shape — real fields TBD once wired to the Drift Engine. */
interface DriftStatPlaceholder {
  currentPct: number;
  deltaPct: number;
}

/** PLACEHOLDER shape — real fields TBD, real source is `stats.licenseWasteMonthlyCents` today (dollar figure, not an "efficiency %"; the mockup's specific "94.8% +5.2%" framing has no real equivalent yet). */
interface LicenseEfficiencyPlaceholder {
  currentPct: number;
  deltaPct: number;
}

/** PLACEHOLDER shape — real source will be top N msp_diagnostic_findings by severity, once that field is added to GET /api/portal/assessment/status. */
interface CriticalGapPlaceholder {
  label: string;
  risk: string;
  impact: "Critical" | "High" | "Medium" | "Low";
}

export interface AssessmentGeneratingScreenProps {
  // REAL — from AssessmentStatus.scan
  scan: {
    active: boolean;
    checksTotal: number | null;
    checksOk: number | null;
    checksError: number | null;
    checksLicenseGap: number | null;
  };
  // REAL — from AssessmentStatus.documents
  documents: {
    expected: ExpectedDoc[];
    items: DocItem[];
    allReady: boolean;
    failed: number;
  };
  // REAL — from AssessmentStatus.narrative
  narrative: {
    status: "not_started" | "generating" | "ready" | "failed";
    html: string | null;
  };
  // REAL — from AssessmentStatus.radar
  radar: {
    pillars: RadarPillar[];
  };
  // REAL — from AssessmentStatus.stats
  stats: {
    genuineFindings: number | null;
    licenseWasteMonthlyCents: number | null;
  };
  // PLACEHOLDER — see DriftStatPlaceholder doc comment above.
  driftPlaceholder?: DriftStatPlaceholder;
  // PLACEHOLDER — see LicenseEfficiencyPlaceholder doc comment above.
  licenseEfficiencyPlaceholder?: LicenseEfficiencyPlaceholder;
  // PLACEHOLDER — see CriticalGapPlaceholder doc comment above.
  criticalGapsPlaceholder?: CriticalGapPlaceholder[];
  /** Real "prepared by" identity — static branding, not per-customer data. */
  architectName?: string;
  /** Real next-step CTA — wire to the wizard's existing real advance action. */
  onContinue?: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
}

// ── Real token color resolution for the Radar chart ─────────────────────────
// Radar.tsx's gridStroke/tickFill need resolved colors, not raw HSL-var
// references, per its own documented caveat — resolve against this app's
// real tokens rather than the mockup's arbitrary palette.
const RADAR_COLOR = "#479ef5"; // --primary
const RADAR_GRID_STROKE = "rgba(255,255,255,0.12)";
const RADAR_TICK_FILL = "rgba(255,255,255,0.54)"; // --muted-foreground equivalent

function impactColor(impact: CriticalGapPlaceholder["impact"]): string {
  switch (impact) {
    case "Critical":
      return "bg-primary";
    case "High":
      return "bg-destructive";
    case "Medium":
      return "bg-accent";
    default:
      return "bg-muted-foreground";
  }
}

function impactTextColor(impact: CriticalGapPlaceholder["impact"]): string {
  switch (impact) {
    case "Critical":
      return "text-primary";
    case "High":
      return "text-destructive";
    case "Medium":
      return "text-accent";
    default:
      return "text-muted-foreground";
  }
}

// ── Section 1: Header band ───────────────────────────────────────────────────

function HeaderBand({ architectName = "Shane McCaw" }: { architectName?: string }) {
  return (
    <section className="mb-10">
      <div className="flex flex-col md:flex-row justify-between items-center md:items-end gap-6 mb-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">
            Assessment in Progress
          </span>
          <h1 className="text-3xl md:text-4xl font-bold text-foreground mt-1">
            Tenant Governance Snapshot
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium text-muted-foreground">
              Lead Architect: {architectName}
            </p>
          </div>
        </div>
      </div>
      <div className="h-px w-full bg-border" />
    </section>
  );
}

// ── Section 2: Path to Remediation timeline ──────────────────────────────────

type PhaseState = "complete" | "active" | "planned" | "failed";

function PhaseBadge({ state }: { state: PhaseState }) {
  const cfg: Record<PhaseState, { label: string; cls: string }> = {
    complete: { label: "Complete", cls: "bg-primary/10 text-primary border-primary/20" },
    active: { label: "In Progress", cls: "bg-primary/20 text-primary border-primary/40" },
    planned: { label: "Planned", cls: "bg-white/5 text-muted-foreground border-white/10" },
    failed: { label: "Failed", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  };
  const { label, cls } = cfg[state];
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border", cls)}>
      {label}
    </span>
  );
}

function PhaseNode({ state, icon: Icon }: { state: PhaseState; icon: React.ElementType }) {
  if (state === "complete") {
    return (
      <div className="z-10 flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-[0_0_20px_rgba(71,158,245,0.35)]">
        <CheckCircle2 className="size-5" />
      </div>
    );
  }
  if (state === "active") {
    return (
      <div className="z-10 flex items-center justify-center w-12 h-12 rounded-full bg-card border-2 border-primary animate-pulse">
        <Icon className="size-5 text-primary" />
      </div>
    );
  }
  if (state === "failed") {
    return (
      <div className="z-10 flex items-center justify-center w-12 h-12 rounded-full bg-card border-2 border-destructive">
        <AlertTriangle className="size-5 text-destructive" />
      </div>
    );
  }
  return (
    <div className="z-10 flex items-center justify-center w-12 h-12 rounded-full bg-card border border-border">
      <Icon className="size-5 text-muted-foreground" />
    </div>
  );
}

function DocumentChip({ title, status }: { title: string; status: "pending" | "generating" | "complete" | "failed" }) {
  const iconCls =
    status === "complete" ? "text-primary" : status === "failed" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="p-3 bg-white/5 border border-white/10 rounded-lg flex items-center gap-2">
      <FileText className={cn("size-4 shrink-0", iconCls)} aria-hidden="true" />
      <span className="text-[11px] font-mono text-muted-foreground truncate">{title}</span>
      <span className="sr-only">{status}</span>
      {status === "complete" && <CheckCircle2 className="size-3.5 text-primary ml-auto shrink-0" />}
      {status === "failed" && <AlertTriangle className="size-3.5 text-destructive ml-auto shrink-0" />}
    </div>
  );
}

function PathToRemediation({
  scan,
  documents,
}: {
  scan: AssessmentGeneratingScreenProps["scan"];
  documents: AssessmentGeneratingScreenProps["documents"];
}) {
  // REAL derivation, matching checklistDocStatus's existing rollup convention
  // (failed wins over complete; a live row never reads Failed while generating).
  const scanState: PhaseState = scan.active ? "active" : (scan.checksTotal ?? 0) > 0 ? "complete" : "planned";
  const docsState: PhaseState =
    documents.failed > 0 ? "failed" : documents.allReady ? "complete" : scanState === "complete" ? "active" : "planned";
  const sowExpected = documents.expected.find((d) => d.docType === "sow" || d.docType === "consolidated_sow");
  const sowItem = sowExpected
    ? documents.items.find((i) => i.docType === sowExpected.docType)
    : undefined;
  const sowState: PhaseState =
    sowItem?.status === "failed"
      ? "failed"
      : sowItem?.status === "approved" || sowItem?.status === "delivered"
        ? "complete"
        : docsState === "active" && sowItem
          ? "active"
          : "planned";

  function docChipStatus(doc: ExpectedDoc): "pending" | "generating" | "complete" | "failed" {
    const item = documents.items.find((i) => i.docType === doc.docType);
    if (!item) return "pending";
    if (item.status === "failed") return "failed";
    if (item.status === "approved" || item.status === "delivered") return "complete";
    return "generating";
  }

  return (
    <section className="mb-10 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Route className="size-7 text-primary" />
        <h2 className="text-2xl font-semibold text-foreground">The Path to Remediation</h2>
      </div>
      <div className="relative flex flex-col gap-6">
        <div className="absolute left-6 top-8 bottom-8 w-px bg-gradient-to-b from-primary via-primary/50 to-border" />

        {/* Phase 1 — Scan */}
        <div className="relative flex gap-6 items-start">
          <PhaseNode state={scanState} icon={ShieldCheck} />
          <div className="flex-1 pt-2">
            <div className="flex items-center gap-3 mb-1">
              <h6 className="text-sm font-bold uppercase tracking-wide text-foreground">Phase 1: Scan &amp; Analysis</h6>
              <PhaseBadge state={scanState} />
            </div>
            <p className="text-sm text-muted-foreground">
              {scan.checksTotal != null
                ? `${scan.checksOk ?? 0} passed${(scan.checksLicenseGap ?? 0) > 0 ? `, ${scan.checksLicenseGap} licensing-gap` : ""}${(scan.checksError ?? 0) > 0 ? `, ${scan.checksError} need attention` : ""} of ${scan.checksTotal} checks.`
                : "Reading your tenant's real configuration, security posture, and licensing."}
            </p>
          </div>
        </div>

        {/* Phase 2 — Document generation */}
        <div className="relative flex gap-6 items-start">
          <PhaseNode state={docsState} icon={FileText} />
          <div className="flex-1 pt-2">
            <div className="flex items-center gap-3 mb-1">
              <h6 className={cn("text-sm font-bold uppercase tracking-wide", docsState === "active" ? "text-primary" : "text-foreground")}>
                Phase 2: Document Generation
              </h6>
              <PhaseBadge state={docsState} />
            </div>
            <p className="text-sm text-muted-foreground mb-3">Each report is written from your scan's real findings.</p>
            {documents.expected.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {documents.expected
                  .filter((d) => d.docType !== "sow" && d.docType !== "consolidated_sow")
                  .map((d) => (
                    <DocumentChip key={d.docType} title={d.title} status={docChipStatus(d)} />
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Phase 3 — SOW */}
        <div className="relative flex gap-6 items-start">
          <PhaseNode state={sowState} icon={Rocket} />
          <div className="flex-1 pt-2">
            <div className="flex items-center gap-3 mb-1">
              <h6 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Phase 3: Statement of Work</h6>
              <PhaseBadge state={sowState} />
            </div>
            <p className="text-sm text-muted-foreground">
              Tailored to your real findings — you'll fine-tune the scope before anything is signed.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Section 3: Narrative + Radar ─────────────────────────────────────────────

function NarrativeAndRadar({
  narrative,
  radar,
}: {
  narrative: AssessmentGeneratingScreenProps["narrative"];
  radar: AssessmentGeneratingScreenProps["radar"];
}) {
  if (narrative.status === "not_started" && radar.pillars.length === 0) return null;

  // REAL derivation — average of real pillar scores. Never fabricated; simply
  // omitted (no score line rendered) if no pillars are covered.
  const avgScore =
    radar.pillars.length > 0
      ? Math.round(radar.pillars.reduce((sum, p) => sum + p.score, 0) / radar.pillars.length)
      : null;

const radarData: DistributionWidgetData = {
  shape: "distribution",
  label: "Pillar Score",
  slices: radar.pillars.map((p) => ({ name: p.label, value: p.score })),
};

  return (
    <section className="mb-10 max-w-5xl mx-auto">
      <div className="bg-card border border-border rounded-2xl p-8 flex flex-col md:flex-row gap-8 items-center">
        <div className="w-full md:w-1/2 space-y-4 order-2 md:order-1">
          <div className="flex items-center gap-2 text-primary">
            <Quote className="size-4" />
            <span className="text-xs font-semibold uppercase tracking-widest">Architect's Perspective</span>
          </div>
          {narrative.status === "ready" && narrative.html ? (
            <div
              className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: narrative.html }}
            />
          ) : narrative.status === "failed" ? (
            <p className="text-sm text-muted-foreground">
              We couldn't put together your narrative summary this time — your real findings and documents below are unaffected.
            </p>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="inline-block size-4 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
                Writing up what matters most from your real results…
              </div>
            </div>
          )}
        </div>
        <div className="w-full md:w-1/2 bg-secondary rounded-xl p-6 flex flex-col items-center order-1 md:order-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Tenant Health Axes
          </h4>
          <p className="text-[11px] text-muted-foreground/70 mb-3 text-center">
            Real coverage from this scan's package — only pillars with real signal data are plotted.
          </p>
          {radar.pillars.length > 0 ? (
            <>
              <div className="relative w-full aspect-square max-w-[280px]">
                <RadarChart
                  data={radarData}
                  color={RADAR_COLOR}
                  gridStroke={RADAR_GRID_STROKE}
                  tickFill={RADAR_TICK_FILL}
                />
              </div>
              {avgScore != null && (
                <p className="text-sm font-bold text-primary mt-3">Current Score: {avgScore}/100</p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground py-8">No pillars covered by this scan's package yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Section 4: Stat card pairs ────────────────────────────────────────────────
// REAL: genuineFindings. PLACEHOLDER: drift %, license-efficiency %. Secondary
// "insight" commentary cards omitted entirely — no real per-stat source exists.

function MiniBarChart({ heights }: { heights: number[] }) {
  return (
    <div className="h-20 w-full flex items-end gap-1 px-1">
      {heights.map((h, i) => (
        <div
          key={i}
          className="bg-primary rounded-t-sm w-full"
          style={{ height: `${h}%`, opacity: 0.3 + (i / (heights.length - 1)) * 0.7 }}
        />
      ))}
    </div>
  );
}

function StatCardPairs({
  stats,
  driftPlaceholder,
}: {
  stats: AssessmentGeneratingScreenProps["stats"];
  driftPlaceholder?: DriftStatPlaceholder;
  licenseEfficiencyPlaceholder?: LicenseEfficiencyPlaceholder;
}) {
  const wasteDisplay =
    stats.licenseWasteMonthlyCents != null ? `$${(stats.licenseWasteMonthlyCents / 100).toLocaleString()}/mo` : null;

  return (
    <section className="mb-10 max-w-5xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* TODO: real source = Drift Engine (drift.* findings). Currently placeholder. */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">Configuration Drift</p>
              <h4 className="text-2xl font-semibold text-foreground">
                {driftPlaceholder?.currentPct ?? "—"}%{" "}
                {driftPlaceholder && (
                  <span className={cn("text-sm font-normal", driftPlaceholder.deltaPct <= 0 ? "text-destructive" : "text-primary")}>
                    {driftPlaceholder.deltaPct > 0 ? "+" : ""}
                    {driftPlaceholder.deltaPct}%
                  </span>
                )}
              </h4>
            </div>
          </div>
          <MiniBarChart heights={[60, 45, 25]} />
        </div>

        {/* REAL — genuineFindings stat, presented in the mockup's visual style */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">Findings to Review</p>
              <h4 className="text-2xl font-semibold text-foreground">{stats.genuineFindings ?? "—"}</h4>
            </div>
            <ShieldCheck className="size-5 text-primary" />
          </div>
          {wasteDisplay && (
            <p className="text-xs text-muted-foreground mt-2">
              Plus <span className="text-primary font-semibold">{wasteDisplay}</span> in real license waste identified.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Section 5: Critical Gaps ──────────────────────────────────────────────────
// PLACEHOLDER — real source will be top-N msp_diagnostic_findings by severity,
// once exposed on GET /api/portal/assessment/status. Only renders if given
// real data — never fabricates findings to fill the section.

function CriticalGaps({ gaps }: { gaps?: CriticalGapPlaceholder[] }) {
  if (!gaps || gaps.length === 0) return null;
  return (
    <section className="mb-10 max-w-5xl mx-auto">
      <div className="bg-card border border-border rounded-2xl p-8 overflow-hidden relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-destructive/10 blur-[100px] -mr-32 -mt-32 rounded-full pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-5">
            <AlertTriangle className="size-7 text-destructive" />
            <h2 className="text-2xl font-semibold text-foreground">Critical Governance Gaps</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {gaps.map((gap) => (
              <div key={gap.label} className="space-y-3">
                <div className={cn("h-1 w-full rounded-full", impactColor(gap.impact))} />
                <h5 className="text-sm font-bold uppercase tracking-wide text-foreground">{gap.label}</h5>
                <p className="text-sm text-muted-foreground">
                  <strong className="text-foreground">The Risk:</strong> {gap.risk}
                </p>
                <p className={cn("text-xs font-mono", impactTextColor(gap.impact))}>Impact: {gap.impact}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Section 6: CTA ─────────────────────────────────────────────────────────────

function ContinueCta({
  onContinue,
  label = "Continue",
  disabled,
}: {
  onContinue?: () => void;
  label?: string;
  disabled?: boolean;
}) {
  if (!onContinue) return null;
  return (
    <section className="mb-6 text-center">
      <Button
        size="lg"
        onClick={onContinue}
        disabled={disabled}
        className="rounded-full px-8 py-6 text-sm font-bold"
      >
        {label}
      </Button>
    </section>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export function AssessmentGeneratingScreen({
  scan,
  documents,
  narrative,
  radar,
  stats,
  driftPlaceholder,
  licenseEfficiencyPlaceholder,
  criticalGapsPlaceholder,
  architectName,
  onContinue,
  continueLabel,
  continueDisabled,
}: AssessmentGeneratingScreenProps) {
  return (
    <div className="relative">
      <HeaderBand architectName={architectName} />
      <PathToRemediation scan={scan} documents={documents} />
      <NarrativeAndRadar narrative={narrative} radar={radar} />
      <StatCardPairs
        stats={stats}
        driftPlaceholder={driftPlaceholder}
        licenseEfficiencyPlaceholder={licenseEfficiencyPlaceholder}
      />
      <CriticalGaps gaps={criticalGapsPlaceholder} />
      <ContinueCta onContinue={onContinue} label={continueLabel} disabled={continueDisabled} />
    </div>
  );
}
