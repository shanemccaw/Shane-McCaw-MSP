import { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMyArchitectRetainer } from "@/lib/my-architect-api";
import type {
  RetainerWorkSource,
  StatusReportClientStatus,
  WireRetainerEntry,
} from "@/lib/my-architect-types";
import { cn } from "@/lib/utils";

/**
 * My Architect (#1746, Feature #1569). Adapted from
 * `Design/portal/design_handoff_full_site/screens/My Architect.dc.html` per
 * that package's own instruction to recreate the reference using this
 * codebase's existing React + Tailwind + shadcn/ui patterns (not port
 * `support.js`), and wired per
 * `Design/portal/design_handoff_full_site/docs/my-architect-contract-pack.md`
 * against the real, GET-only `/api/portal/retainer` endpoint.
 *
 * Deliberate divergences from the design mock, all because the mock invents
 * client-side data the real read doesn't provide — see the "what this page
 * deliberately does not do" card at the bottom for the full, honest list:
 *   - The month picker only ever re-filters the Work log list below. The
 *     server computes `bucket` for the CURRENT period only (contract pack
 *     §6.4, "computed once, server-side" — there is no endpoint to recompute
 *     retained/rolled/used for an arbitrary past period), so the bucket card
 *     always shows the current period regardless of which month is selected
 *     for the log.
 *   - No hourly rate, no dollar figure anywhere — `hourlyRateCents` is a
 *     real, live field on `settings` and is dropped on the floor, never read
 *     (contract pack §6.1).
 */

const STATE_STYLE: Record<string, string> = {
  closed: "border-status-green/30 bg-status-green/10 text-status-green",
  in_progress: "border-status-blue/30 bg-status-blue/10 text-status-blue",
  in_review: "border-status-amber/30 bg-status-amber/10 text-status-amber",
  scheduled: "border-muted-foreground/25 bg-muted/20 text-muted-foreground",
};

const SOURCE_LABEL: Record<RetainerWorkSource, string> = {
  change_control: "from change control",
  remediation_tracker: "from remediation",
  unscoped: "logged by your architect",
};

const CLIENT_STATUS_STYLE: Record<StatusReportClientStatus, { label: string; className: string }> = {
  accepted: { label: "Accepted", className: "border-status-green/30 bg-status-green/10 text-status-green" },
  pending: { label: "Awaiting your review", className: "border-status-amber/30 bg-status-amber/10 text-status-amber" },
  has_questions: { label: "You asked a question", className: "border-status-blue/30 bg-status-blue/10 text-status-blue" },
};

function formatPeriodLabel(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function MyArchitectPage() {
  const { data, isLoading, isError, error, refetch, isRefetching } = useMyArchitectRetainer();
  const errStatus = (error as (Error & { status?: number }) | null)?.status;
  const noScope = isError && errStatus === 400;
  const failed = isError && !noScope;
  const blocked = noScope || failed;

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const activeMonth = selectedMonth ?? data?.months[0] ?? data?.bucket.period ?? null;

  const filteredEntries = useMemo<WireRetainerEntry[]>(() => {
    if (!data) return [];
    if (!activeMonth) return data.entries;
    return data.entries.filter((e) => e.periodMonth === activeMonth);
  }, [data, activeMonth]);

  return (
    <div className="flex flex-col gap-4 pb-14">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">My Architect</h1>
        <span
          title="Your retained architect's hours: what is allotted this month, what has been used, and the work log behind those hours. Hours only — money lives on Billing."
          className="flex size-[17px] cursor-help items-center justify-center rounded-full border border-muted-foreground/35 text-[10px] font-bold text-muted-foreground"
        >
          i
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              blocked
                ? "bg-status-red"
                : isLoading
                  ? "bg-muted-foreground"
                  : data?.configured
                    ? data.bucket.isOverMonth
                      ? "bg-status-amber"
                      : "bg-status-green"
                    : "bg-muted-foreground",
            )}
          />
          {isLoading
            ? "Reading your retainer"
            : noScope
              ? "No customer scope on this session"
              : failed
                ? "Could not read your retainer"
                : data?.configured
                  ? data.bucket.isOverMonth
                    ? "Live — retainer active, over this period"
                    : "Live — retainer active"
                  : "Live — no retainer on your account"}
        </span>
        {data?.configured && data.settings?.architectName && (
          <span className="ml-auto text-xs text-muted-foreground">{data.settings.architectName}</span>
        )}
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex animate-pulse flex-col gap-2 rounded-xl border border-border/60 bg-muted/10 p-4">
              <div className="h-2.5 w-2/5 rounded-full bg-muted-foreground/20" />
              <div className="h-2 w-1/2 rounded-full bg-muted-foreground/10" />
            </div>
          ))}
        </div>
      )}

      {noScope && (
        <div className="flex gap-2.5 rounded-xl border border-dashed border-status-red/45 bg-status-red/[.06] p-4">
          <AlertTriangle className="mt-0.5 size-4 flex-none text-status-red" />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-foreground">No customer scope on this session</span>
            <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">
              A retainer is read per organisation, and this sign-in carries none. Nothing was read on
              anyone's behalf.
            </span>
          </div>
        </div>
      )}

      {failed && (
        <div className="flex gap-2.5 rounded-xl border border-dashed border-status-red/45 bg-status-red/[.06] p-4">
          <AlertTriangle className="mt-0.5 size-4 flex-none text-status-red" />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-foreground">Failed to load your retainer</span>
            <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">
              A failed read. Your hours and log are unchanged; nothing is shown below because nothing
              could be fetched.
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto w-fit p-0 text-[11.5px]"
              onClick={() => void refetch()}
              disabled={isRefetching}
              data-testid="my-architect-retry"
            >
              {isRefetching && <Loader2 className="size-3 animate-spin" />}
              Try again
            </Button>
          </div>
        </div>
      )}

      {data && !data.configured && (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6">
            <span className="text-[13.5px] font-semibold text-foreground">
              {data.settings ? "Your retainer is paused" : "You do not have an architect retainer"}
            </span>
            <span className="max-w-[660px] text-xs leading-relaxed text-muted-foreground">
              {data.settings
                ? "A retainer exists on your account but is not active, so it is shown as not configured — the same answer the platform gives. Your work log from active months stays on record; this page will pick it up again when the retainer is switched back on by your provider."
                : "This is a real read of your account: no retainer has been set up. Retained architect hours are arranged with your provider; nothing on this page can start one."}
            </span>
            <span className="max-w-[660px] text-[11px] leading-relaxed text-muted-foreground/70">
              The month figures below are the platform default with nothing used — a real default, not
              your allotment. Status reports your architect has sent still show, since they do not
              depend on a retainer.
            </span>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <Card className={data.bucket.isOverMonth ? "border-status-amber/30" : undefined} data-testid="my-architect-bucket">
            <CardContent className="flex flex-col gap-3 pt-6">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[13.5px] font-semibold text-foreground">
                  {formatPeriodLabel(data.bucket.period)}
                </span>
                {data.bucket.isOverMonth && (
                  <Badge variant="outline" className="border-status-amber/28 bg-status-amber/10 text-status-amber text-[10px]">
                    {data.bucket.overHours}h over this period
                  </Badge>
                )}
                {data.months.length > 0 && (
                  <div className="ml-auto flex flex-wrap gap-1.5">
                    {data.months.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setSelectedMonth(m)}
                        data-testid={`my-architect-month-${m}`}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[10.5px] font-semibold transition-colors",
                          m === activeMonth
                            ? "border-foreground/20 bg-muted/40 text-foreground"
                            : "border-border/60 text-muted-foreground hover:bg-muted/20",
                        )}
                      >
                        {formatPeriodLabel(m)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                <Figure label="RETAINED" value={data.bucket.retainedHours} note="this period's allotment" />
                <Figure
                  label="ROLLED IN"
                  value={data.bucket.rolledHours}
                  note={data.bucket.rolledHours ? "unused from last period, once" : "nothing carried from last period"}
                  muted={!data.bucket.rolledHours}
                />
                <Figure
                  label="USED"
                  value={data.bucket.usedHours}
                  note="logged so far, uncapped"
                  amber={data.bucket.isOverMonth}
                />
                <Figure
                  label="REMAINING"
                  value={data.bucket.remainingHours}
                  note={
                    data.bucket.remainingHours === 0
                      ? data.bucket.isOverMonth
                        ? "allotment exceeded"
                        : "allotment used exactly"
                      : `of ${data.bucket.retainedHours + data.bucket.rolledHours}h available`
                  }
                  green={data.bucket.remainingHours > 0}
                />
                <Figure
                  label="OVER"
                  value={data.bucket.overHours}
                  note={data.bucket.isOverMonth ? "a normal, stated state" : "none"}
                  amber={data.bucket.isOverMonth}
                  muted={!data.bucket.isOverMonth}
                />
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted/25">
                <div
                  className={cn("h-full", data.bucket.isOverMonth ? "bg-status-amber" : "bg-primary")}
                  style={{
                    width: `${Math.min(100, data.bucket.retainedHours + data.bucket.rolledHours > 0 ? (data.bucket.usedHours / (data.bucket.retainedHours + data.bucket.rolledHours)) * 100 : 0)}%`,
                  }}
                />
              </div>
              <span className="max-w-[680px] text-[11px] leading-relaxed text-muted-foreground">
                {data.bucket.isOverMonth
                  ? '"Over" is keyed off the over figure itself, not off remaining hitting zero — a period that lands exactly on its allotment also reads 0h remaining, and is not over.'
                  : "Figures are computed once, server-side, from the log. The page does not re-add them."}
              </span>
            </CardContent>
          </Card>

          <Card data-testid="my-architect-worklog">
            <CardContent className="flex flex-col gap-1 pt-6">
              <div className="flex flex-wrap items-center gap-2.5 pb-2">
                <span className="text-[13.5px] font-semibold text-foreground">Work log</span>
                <span className="text-[11px] text-muted-foreground">
                  {filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"}
                  {activeMonth ? ` · ${formatPeriodLabel(activeMonth)}` : ""} · newest first
                </span>
              </div>
              {filteredEntries.length === 0 ? (
                <span className="border-t border-border/50 pt-3 text-xs leading-relaxed text-muted-foreground">
                  No entries for this period yet. The hours above are a real zero, not a placeholder.
                </span>
              ) : (
                filteredEntries.map((e) => (
                  <div key={e.id} className="flex items-start gap-3 border-t border-border/50 py-2.5 first:border-t-0">
                    <span className="mt-0.5 w-1 flex-none self-stretch rounded-full" style={{ background: e.pillarColor }} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12.5px] text-foreground">{e.item}</span>
                        <Badge variant="outline" className={cn("text-[10px]", STATE_STYLE[e.stateStored] ?? STATE_STYLE.scheduled)}>
                          {e.state}
                        </Badge>
                      </div>
                      {e.outcome && <span className="text-[11.5px] leading-relaxed text-muted-foreground">{e.outcome}</span>}
                      <span className="text-[10.5px] text-muted-foreground/70">
                        {[e.week, e.pillar, e.finding, SOURCE_LABEL[e.source as RetainerWorkSource]].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <span className={cn("flex-none text-[13px] font-semibold tabular-nums", e.minutes === 0 ? "text-muted-foreground" : "text-foreground")}>
                      {e.hours}h
                    </span>
                  </div>
                ))
              )}
              <span className="border-t border-border/50 pt-2.5 text-[10.5px] leading-relaxed text-muted-foreground/70">
                Entries marked "from change control" or "from remediation" were logged automatically
                when that record closed; their hours are set by your architect afterwards, so a fresh
                one can honestly read 0h. Nothing on this page adds or edits an entry.
              </span>
            </CardContent>
          </Card>
        </>
      )}

      {data && !blocked && (
        <>
          <Card data-testid="my-architect-status-reports">
            <CardContent className="flex flex-col gap-1 pt-6">
              <div className="flex flex-wrap items-center gap-2.5 pb-2">
                <span className="text-[13.5px] font-semibold text-foreground">Status reports</span>
                <span className="text-[11px] text-muted-foreground">
                  {data.statusReports.length > 0 ? `${data.statusReports.length} sent · drafts not shown` : "none sent"}
                </span>
              </div>
              {data.statusReports.length === 0 ? (
                <span className="border-t border-border/50 pt-3 text-xs leading-relaxed text-muted-foreground">
                  No status report has been sent to your organisation yet. Drafts your architect is
                  still writing are not shown.
                </span>
              ) : (
                data.statusReports.map((r) => {
                  const cs = CLIENT_STATUS_STYLE[r.clientStatus as StatusReportClientStatus];
                  return (
                    <div key={r.id} className="flex flex-col gap-2 border-t border-border/50 py-3 first:border-t-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12.5px] font-semibold text-foreground">{r.title}</span>
                        <Badge variant="outline" className="border-border/60 text-[10px] text-muted-foreground">
                          {r.period}
                        </Badge>
                        {cs && (
                          <Badge variant="outline" className={cn("text-[10px]", cs.className)}>
                            {cs.label}
                          </Badge>
                        )}
                        <span className="ml-auto text-[10.5px] text-muted-foreground">sent {formatDate(r.sentAt)}</span>
                      </div>
                      {r.executiveSummary && (
                        <span className="max-w-[720px] text-[12px] leading-relaxed text-foreground/90">{r.executiveSummary}</span>
                      )}
                      {r.completedActivities.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] font-bold tracking-wider text-muted-foreground">COMPLETED</span>
                          {r.completedActivities.map((a, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <span className="mt-1.5 size-1 flex-none rounded-full bg-primary" />
                              <span className="text-[11.5px] leading-relaxed text-foreground/90">
                                <span className="font-semibold text-foreground">{a.title}</span> — {a.description}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {r.replyThread.length > 0 && (
                        <div className="flex flex-col gap-1.5 border-l-2 border-status-blue/35 pl-3">
                          <span className="text-[9px] font-bold tracking-wider text-muted-foreground">YOUR QUESTION AND THE REPLY</span>
                          {r.replyThread.map((t, i) => (
                            <span key={i} className="text-[11.5px] leading-relaxed text-foreground/90">
                              <span className={cn("font-semibold", t.sender === "client" ? "text-foreground" : "text-status-blue")}>
                                {t.sender === "client" ? "You" : data.settings?.architectName ?? "Your architect"}
                              </span>{" "}
                              · {t.content}
                            </span>
                          ))}
                          <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
                            Questions are taken by your architect directly for now — this thread is
                            read here, not written here.
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card className="bg-muted/5">
            <CardContent className="flex flex-col gap-2 pt-6">
              <span className="text-[13.5px] font-semibold text-foreground">How the retainer works</span>
              <span className="max-w-[680px] text-xs leading-relaxed text-muted-foreground">
                Each period starts with your retained hours. Hours you did not use last period roll into
                this one — once; they are not carried a second time. Work is logged against the period
                it happened in, at half-hour granularity. Going over the allotment is allowed and is
                shown plainly rather than hidden; it is settled with your architect, not on this page.
              </span>
            </CardContent>
          </Card>
        </>
      )}

      <Card className="bg-muted/5">
        <CardContent className="flex flex-col gap-2.5 pt-6">
          <span className="text-[13px] font-semibold text-foreground">What this page deliberately does not do</span>
          <div className="flex flex-col">
            {[
              "No money. An hourly rate is served on this read and is dropped on the floor: no rate, no dollar total, no derived cost, anywhere on the page. Billing is Billing's.",
              "No writing. Hours are not logged, entries are not edited, the allotment is not changed here — every write is your provider's, in AdminV2.",
              "No reply box under a status report. The thread is served read-only; a customer reply endpoint does not exist yet, so the page says who to ask instead of drawing a field that posts nowhere.",
              "No documents section. Nothing on this read references a document, and the page does not pretend one rides along.",
              '"How the retainer works" is fixed prose, not a served field — decided policy: static copy, no backend table.',
              "The month picker only re-filters the work log below. The bucket figures above are always the current period's — the server computes that arithmetic once and does not recompute it for a past period.",
            ].map((gap, i) => (
              <div key={i} className="flex items-start gap-3 border-t border-border/50 py-2 first:border-t-0">
                <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-foreground">{gap}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Figure({
  label,
  value,
  note,
  amber,
  green,
  muted,
}: {
  label: string;
  value: number;
  note: string;
  amber?: boolean;
  green?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border/50 bg-muted/5 px-3 py-2.5">
      <span className="text-[9px] font-bold tracking-wider text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-xl font-bold tabular-nums tracking-tight",
          amber ? "text-status-amber" : green ? "text-status-green" : muted ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {value}h
      </span>
      <span className="text-[10.5px] leading-tight text-muted-foreground">{note}</span>
    </div>
  );
}
