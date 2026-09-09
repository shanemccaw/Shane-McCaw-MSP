import { useMemo, useState } from "react";
import { AlertTriangle, FileCheck2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DriftPanel } from "@/components/security-plan/DriftPanel";
import { ModuleSchedule } from "@/components/security-plan/ModuleSchedule";
import { SignVersionDialog } from "@/components/security-plan/SignVersionDialog";
import {
  useCurrentSecurityPlanVersion,
  useSecurityPlanDrift,
  useSecurityPlanVersions,
} from "@/lib/security-plan-api";
import type { SecurityPlanProseSection } from "@/lib/security-plan-types";
import { cn } from "@/lib/utils";

/**
 * Security Plan (#3027, Feature #1495). Adapted from
 * `Design/portal/design_handoff_full_site/screens/Security Plan.dc.html` per
 * that package's own README ("recreate these designs... using this
 * codebase's existing... patterns") and wired per
 * `docs/portal/security-plan-contract-pack.md` against the real
 * `/api/portal/security-plan*` endpoints.
 *
 * Deliberate divergence from the design reference — see the "what this page
 * deliberately does not do" note at the bottom: the design's "Part II —
 * Control Domains" grouping (Identity / Data / Collaboration / Change /
 * Monitoring) has no backing field anywhere in `SecurityPlanAssembledItem` or
 * the seven source tables `security-plan-assembly.ts` reads — it does not
 * exist in the real data, so it is not built. Every other part of the
 * document (prose, the seven module schedules, drift, version history) is a
 * real, live read.
 */

const PROSE_LABELS: Record<SecurityPlanProseSection, string> = {
  scope: "Scope",
  methodology: "Methodology",
  exclusions: "Exclusions",
  executiveSummary: "Executive summary",
};
const PROSE_ORDER: SecurityPlanProseSection[] = ["scope", "methodology", "exclusions", "executiveSummary"];

type SectionKey =
  | { kind: "prose"; section: SecurityPlanProseSection }
  | { kind: "module"; moduleKey: string }
  | { kind: "drift" }
  | { kind: "history" };

function sectionId(s: SectionKey): string {
  return s.kind === "prose" ? `prose-${s.section}` : s.kind === "module" ? `module-${s.moduleKey}` : s.kind;
}

export default function SecurityPlanPage() {
  const { data: version, isLoading, isError, refetch, isRefetching } = useCurrentSecurityPlanVersion();
  const neverSealed = !isLoading && !isError && version === null;
  const hasPlan = !isLoading && !isError && version !== null;

  const versionsQuery = useSecurityPlanVersions(hasPlan);
  const driftQuery = useSecurityPlanDrift(hasPlan);

  const [signOpen, setSignOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sections: SectionKey[] = useMemo(() => {
    if (!version) return [];
    const list: SectionKey[] = PROSE_ORDER.map((section) => ({ kind: "prose", section }));
    for (const m of version.content.modules) list.push({ kind: "module", moduleKey: m.key });
    list.push({ kind: "drift" });
    list.push({ kind: "history" });
    return list;
  }, [version]);

  const activeSection = sections.find((s) => sectionId(s) === activeId) ?? sections[0] ?? null;

  return (
    <div className="flex flex-col gap-4 pb-14">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Security plan</h1>
        <span
          title="Assembled from the registers in this portal, versioned and signed at a point in time. Your MSP freezes the current state, writes the scope and methodology around it, and seals it as a version."
          className="flex size-[17px] cursor-help items-center justify-center rounded-full border border-muted-foreground/35 text-[10px] font-bold text-muted-foreground"
        >
          i
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              isError ? "bg-status-red" : isLoading ? "bg-muted-foreground" : "bg-status-green",
            )}
          />
          {isLoading
            ? "Reading your plan"
            : isError
              ? "Could not read your plan"
              : neverSealed
                ? "No version sealed yet"
                : version?.signed
                  ? "Signed"
                  : "Sealed, awaiting your signature"}
        </span>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex animate-pulse flex-col gap-2 rounded-xl border border-border/60 bg-muted/10 p-4">
              <div className="h-2.5 w-2/5 rounded-full bg-muted-foreground/20" />
              <div className="h-2 w-1/2 rounded-full bg-muted-foreground/10" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="flex gap-2.5 rounded-xl border border-dashed border-status-red/45 bg-status-red/[.06] p-4">
          <AlertTriangle className="mt-0.5 size-4 flex-none text-status-red" />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-foreground">Your security plan could not be loaded</span>
            <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">
              This is a failed read, not an absent plan. A signed plan may well exist.
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto w-fit p-0 text-[11.5px]"
              onClick={() => void refetch()}
              disabled={isRefetching}
            >
              {isRefetching && <Loader2 className="size-3 animate-spin" />}
              Try again
            </Button>
          </div>
        </div>
      )}

      {neverSealed && (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-8">
          <span className="text-[10px] font-bold tracking-wider text-muted-foreground">SECURITY PLAN</span>
          <span className="text-lg font-bold text-foreground">No version has been sealed</span>
          <span className="max-w-[640px] text-[13px] leading-relaxed text-muted-foreground">
            A plan is assembled rather than written: your MSP freezes the current contents of the
            registers in this portal, writes the scope and methodology around that state, seals it
            as a version and signs it. No version has been sealed for your tenant.
          </span>
        </div>
      )}

      {hasPlan && version && (
        <>
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-[10px] font-bold tracking-wider text-muted-foreground">
                    SECURITY PLAN · VERSION {version.versionNumber}
                  </span>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-2xl font-extrabold tracking-tight text-foreground">
                      Version {version.versionNumber}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        version.signed
                          ? "border-status-green/30 bg-status-green/10 text-status-green"
                          : "border-status-amber/30 bg-status-amber/10 text-status-amber",
                      )}
                    >
                      {version.signed ? "Signed" : "Sealed, awaiting signature"}
                    </Badge>
                  </div>
                </div>
                {!version.signed && (
                  <Button onClick={() => setSignOpen(true)} data-testid="security-plan-open-sign">
                    <FileCheck2 className="size-3.5" />
                    Review and sign this version
                  </Button>
                )}
              </div>

              <div className="border-l-2 border-status-blue/50 pl-3.5">
                <span className="block text-[10px] font-bold tracking-wider text-muted-foreground">
                  SCOPE OF THIS SIGNATURE
                </span>
                <span className="max-w-[700px] text-[13.5px] leading-relaxed text-foreground">
                  {version.scopeStatement}
                </span>
              </div>

              <div className="flex flex-wrap gap-6 border-t border-border/60 pt-3">
                <Fact label="SEALED" value={new Date(version.createdAt).toLocaleDateString()} />
                <Fact label="SIGNED" value={version.signed && version.signedAt ? new Date(version.signedAt).toLocaleDateString() : "Not signed"} />
                <Fact
                  label="ROWS CARRIED"
                  value={`${version.content.modules.reduce((n, m) => n + m.total, 0)} across ${version.content.modules.length} registers`}
                />
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <nav className="flex flex-col gap-3">
              <NavGroup label="Part I — the plan">
                {PROSE_ORDER.map((section) => (
                  <NavItem
                    key={section}
                    active={activeSection?.kind === "prose" && activeSection.section === section}
                    label={PROSE_LABELS[section]}
                    onClick={() => setActiveId(sectionId({ kind: "prose", section }))}
                  />
                ))}
              </NavGroup>
              <NavGroup label="Part II — schedules">
                {version.content.modules.map((m) => (
                  <NavItem
                    key={m.key}
                    active={activeSection?.kind === "module" && activeSection.moduleKey === m.key}
                    label={m.label}
                    sub={String(m.total)}
                    onClick={() => setActiveId(sectionId({ kind: "module", moduleKey: m.key }))}
                  />
                ))}
              </NavGroup>
              <NavGroup label="Part III — appendices">
                <NavItem
                  active={activeSection?.kind === "drift"}
                  label="Changes since signing"
                  onClick={() => setActiveId(sectionId({ kind: "drift" }))}
                />
                <NavItem
                  active={activeSection?.kind === "history"}
                  label="Version history"
                  sub={versionsQuery.data ? String(versionsQuery.data.length) : undefined}
                  onClick={() => setActiveId(sectionId({ kind: "history" }))}
                />
              </NavGroup>
            </nav>

            <Card className="min-w-0">
              <CardContent className="flex flex-col gap-4 pt-6">
                {activeSection?.kind === "prose" && (
                  <ProsePane
                    label={PROSE_LABELS[activeSection.section]}
                    content={version.content.prose?.[activeSection.section] ?? null}
                  />
                )}
                {activeSection?.kind === "module" &&
                  (() => {
                    const mod = version.content.modules.find((m) => m.key === activeSection.moduleKey);
                    return mod ? <ModuleSchedule module={mod} /> : null;
                  })()}
                {activeSection?.kind === "drift" && (
                  <>
                    <span className="text-[13.5px] font-semibold text-foreground">Changes since signing</span>
                    {driftQuery.isLoading && <span className="text-xs text-muted-foreground">Loading…</span>}
                    {driftQuery.isError && (
                      <span className="text-xs text-status-red">Could not read what has changed since signing.</span>
                    )}
                    {driftQuery.data && <DriftPanel drift={driftQuery.data} />}
                  </>
                )}
                {activeSection?.kind === "history" && (
                  <>
                    <span className="text-[13.5px] font-semibold text-foreground">Version history</span>
                    {versionsQuery.isLoading && <span className="text-xs text-muted-foreground">Loading…</span>}
                    {versionsQuery.isError && (
                      <span className="text-xs text-status-red">Could not read your version history.</span>
                    )}
                    {versionsQuery.data && (
                      <div className="flex flex-col">
                        <div className="flex gap-3 border-b border-border/50 pb-1.5 text-[9px] font-bold tracking-wider text-muted-foreground">
                          <span className="w-20 flex-none">VERSION</span>
                          <span className="w-[140px] flex-none">STATE</span>
                          <span className="min-w-0 flex-1">SIGNED</span>
                          <span className="w-24 flex-none text-right">SEALED</span>
                        </div>
                        {versionsQuery.data.map((v) => (
                          <div key={v.versionUid} className="flex items-center gap-3 border-b border-border/40 py-2 last:border-b-0">
                            <span className="w-20 flex-none text-[12px] font-semibold text-foreground">
                              Version {v.versionNumber}
                            </span>
                            <span className="w-[140px] flex-none">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px]",
                                  v.signed
                                    ? "border-status-green/30 bg-status-green/10 text-status-green"
                                    : v.isCurrent
                                      ? "border-status-amber/30 bg-status-amber/10 text-status-amber"
                                      : "text-muted-foreground",
                                )}
                              >
                                {v.signed ? (v.isCurrent ? "Current, signed" : "Superseded, signed") : v.isCurrent ? "Current, unsigned" : "Superseded"}
                              </Badge>
                            </span>
                            <span className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">
                              {v.signedAt ? new Date(v.signedAt).toLocaleString() : "Not signed"}
                            </span>
                            <span className="w-24 flex-none text-right text-[11px] text-muted-foreground">
                              {new Date(v.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        ))}
                        <span className="pt-3 text-[10.5px] leading-relaxed text-muted-foreground">
                          Each version retains its own copy of everything it covered, so an older
                          version still reads exactly as it did on the day it was signed. Sealing a
                          new version supersedes the last; it never rewrites it.
                        </span>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <SignVersionDialog
            open={signOpen}
            onOpenChange={setSignOpen}
            versionUid={version.versionUid}
            versionLabel={`version ${version.versionNumber}`}
          />
        </>
      )}

      <Card className="bg-muted/5">
        <CardContent className="flex flex-col gap-2.5 pt-6">
          <span className="text-[13px] font-semibold text-foreground">What this page deliberately does not do</span>
          <div className="flex flex-col">
            <div className="flex items-start gap-3 border-t border-border/50 py-2 first:border-t-0">
              <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-foreground">
                No "Control Domains" grouping (Identity / Data / Collaboration / Change /
                Monitoring). The design reference groups rows by a control domain, but no such
                field exists on any assembled row or its seven source tables — inventing that
                grouping would be a display vocabulary mapping onto nothing. Rows are shown per
                the module that actually owns them instead.
              </span>
            </div>
            <div className="flex items-start gap-3 border-t border-border/50 py-2">
              <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-foreground">
                No cross-module "still needs attention" roll-up. The seven source modules use
                genuinely different, unrelated status vocabularies (contract pack §4); deciding
                which of those states count as "unresolved" across all of them would be authored
                business logic, not an extraction.
              </span>
            </div>
            <div className="flex items-start gap-3 border-t border-border/50 py-2">
              <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-foreground">
                No overall score. Nothing here rolls the rows up into a percentage, a grade or a
                pass mark; the registers do not share a scale.
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-bold tracking-wider text-muted-foreground">{label}</span>
      <span className="text-[12.5px] font-semibold text-foreground">{value}</span>
    </div>
  );
}

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-1 pb-1 text-[9px] font-bold tracking-wider text-muted-foreground/70">{label}</span>
      {children}
    </div>
  );
}

function NavItem({ active, label, sub, onClick }: { active: boolean; label: string; sub?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] transition-colors hover:bg-muted/40",
        active ? "bg-primary/10 font-semibold text-foreground" : "text-muted-foreground",
      )}
    >
      <span className="min-w-0 flex-1">{label}</span>
      {sub !== undefined && <span className="flex-none text-[10px] tabular-nums text-muted-foreground/70">{sub}</span>}
    </button>
  );
}

function ProsePane({
  label,
  content,
}: {
  label: string;
  content: { text: string; editedInThisVersion: boolean } | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[13.5px] font-semibold text-foreground">{label}</span>
        {content && (
          <Badge
            variant="outline"
            className={cn(
              "text-[9px]",
              content.editedInThisVersion ? "border-status-blue/30 bg-status-blue/10 text-status-blue" : "text-muted-foreground",
            )}
          >
            {content.editedInThisVersion ? "Rewritten for this version" : "Carried forward"}
          </Badge>
        )}
      </div>
      {content ? (
        <span className="max-w-[68ch] whitespace-pre-wrap text-[14px] leading-[1.8] text-foreground">
          {content.text}
        </span>
      ) : (
        <span className="text-xs leading-relaxed text-muted-foreground">
          Not authored — this version was sealed before authored prose existed for this plan.
        </span>
      )}
    </div>
  );
}
