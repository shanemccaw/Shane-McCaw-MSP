import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { AlertTriangle, Loader2, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAddStatusReportComment, useStatusReportComments, useStatusReports } from "@/lib/status-reports-api";
import type { WireMspStatusReport } from "@/lib/status-reports-types";
import { cn } from "@/lib/utils";

/**
 * Status Reports (#4038, Feature #3435, phase 4 of 4). Adapted from
 * `Design/portal/design_handoff_billing_roles_and_new_modules/screens/Status Reports.dc.html`
 * per that package's own instruction to recreate the reference using this
 * repo's React + Tailwind + shadcn/ui patterns (not port `support.js`), wired
 * against `docs/portal/status-reports-portal-contract-pack.md` (#3889) and
 * the real `GET/POST /api/portal/status-reports*` routes.
 *
 * **Not the same "status reports" as the card on My Architect** — that reads
 * `status_reports` (admin-authored retainer reports); this page reads
 * `msp_status_reports` (MSP Console-authored, with a real two-sided comment
 * thread). See the contract pack's §0 for the full disambiguation.
 *
 * The list route already returns each report's full content (§2.1's shape),
 * so there is no separate by-id detail fetch — the selected report is read
 * straight out of the list query. `:id` in the route only seeds which report
 * opens by default (e.g. a notification's `/status-reports/{id}` deep link);
 * an id that isn't in this customer's own published list falls back to the
 * first report exactly like no id was given, since the list is already this
 * customer's complete, published-only, authorized set — there is no separate
 * "not found" read to make.
 */

const MAX_COMMENT_LENGTH = 10_000;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

export default function StatusReportsPage() {
  const { id: idParam } = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const { data: reports, isLoading, isError, refetch, isRefetching } = useStatusReports();

  const [selectedId, setSelectedId] = useState<number | null>(idParam ? Number(idParam) : null);
  const [draft, setDraft] = useState("");

  // A direct `/status-reports/:id` link (e.g. from a notification) whose id
  // isn't in this customer's own published list is the real 404 the detail
  // route (§1.2) would give — a foreign report, a draft, or an unknown id
  // all read identically. The list query already applies the exact same
  // predicate (customerId + published-only) as that route, so checking
  // membership here is equivalent to calling it, with no extra round trip.
  const requestedNotFound = idParam !== null && !!reports && reports.length > 0 && !reports.some((r) => r.id === Number(idParam));

  const selected: WireMspStatusReport | null = useMemo(() => {
    if (!reports || reports.length === 0) return null;
    if (requestedNotFound) return null;
    const byParam = selectedId !== null ? reports.find((r) => r.id === selectedId) : undefined;
    return byParam ?? reports[0];
  }, [reports, selectedId, requestedNotFound]);

  // Reset the draft whenever the open report changes.
  useEffect(() => {
    setDraft("");
  }, [selected?.id]);

  const commentsQuery = useStatusReportComments(selected?.id ?? null);
  const addComment = useAddStatusReportComment();

  const handlePick = (r: WireMspStatusReport) => {
    setSelectedId(r.id);
    addComment.reset();
    if (idParam) navigate("/status-reports", { replace: true });
  };

  const trimmed = draft.trim();
  const canPost = !!selected && trimmed.length >= 1 && trimmed.length <= MAX_COMMENT_LENGTH && !addComment.isPending;

  const handlePost = () => {
    if (!selected || !canPost) return;
    addComment.mutate(
      { reportId: selected.id, body: trimmed },
      {
        onSuccess: () => setDraft(""),
      },
    );
  };

  const failed = isError;
  const isEmpty = !isLoading && !isError && (reports?.length ?? 0) === 0;
  const isLive = !isLoading && !isError && (reports?.length ?? 0) > 0 && !requestedNotFound;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 px-[26px] py-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Status reports</h1>
        <span
          title="Written by your MSP at the end of each reporting period and published to you once final. You can read each report and comment on it; your MSP replies in the same thread. Reports they are still drafting never appear here."
          className="flex size-[17px] cursor-help items-center justify-center rounded-full border border-muted-foreground/35 text-[10px] font-bold text-muted-foreground"
        >
          i
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              failed ? "bg-status-red" : requestedNotFound ? "bg-status-amber" : isLoading ? "bg-muted-foreground" : "bg-status-green",
            )}
          />
          {isLoading
            ? "Reading your status reports"
            : failed
              ? "Read failed · 500"
              : requestedNotFound
                ? "Not found · 404"
                : isEmpty
                  ? "Live · no published reports"
                  : `Live · ${reports!.length} published report${reports!.length === 1 ? "" : "s"} · published only, newest period first`}
        </span>
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

      {failed && (
        <div className="flex gap-2.5 rounded-xl border border-dashed border-status-red/45 bg-status-red/[.06] p-4">
          <AlertTriangle className="mt-0.5 size-4 flex-none text-status-red" />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-foreground">Your status reports could not be read</span>
            <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">
              A failed read, not an empty list. Nothing your MSP has published is lost.
            </span>
            <span className="font-mono text-[10.5px] text-muted-foreground/70">
              500 · &ldquo;Failed to load status reports&rdquo; — the server&apos;s own message
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto w-fit p-0 text-[11.5px]"
              onClick={() => void refetch()}
              disabled={isRefetching}
              data-testid="status-reports-retry"
            >
              {isRefetching && <Loader2 className="size-3 animate-spin" />}
              Try again
            </Button>
          </div>
        </div>
      )}

      {requestedNotFound && (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6">
            <span className="text-[13.5px] font-semibold text-foreground">That report isn&apos;t available to you</span>
            <span className="max-w-[680px] text-xs leading-relaxed text-muted-foreground">
              The link you followed points at a report this page cannot show. A report that does not exist,
              one that belongs to another organisation, and one your MSP has not published yet all get this
              same answer — the server does not say which, and neither does this page.
            </span>
            <span className="font-mono text-[10.5px] text-muted-foreground/70">404 · &ldquo;Not found&rdquo;</span>
            <Button
              variant="link"
              size="sm"
              className="h-auto w-fit p-0 text-xs"
              onClick={() => navigate("/status-reports", { replace: true })}
              data-testid="status-reports-back"
            >
              Back to your reports →
            </Button>
          </CardContent>
        </Card>
      )}

      {isEmpty && (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6">
            <span className="text-[13.5px] font-semibold text-foreground">No published reports yet</span>
            <span className="max-w-[680px] text-xs leading-relaxed text-muted-foreground">
              A successful read with nothing in it. Your MSP has not published a status report for your
              organisation. Reports they are still writing never appear here, so there is nothing to
              preview — the first one arrives when they publish it, and you will be notified.
            </span>
          </CardContent>
        </Card>
      )}

      {isLive && reports && (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,300px)_1fr]">
          <div className="flex min-w-0 flex-col gap-2" data-testid="status-reports-list">
            {reports.map((r) => {
              const active = selected?.id === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => handlePick(r)}
                  data-testid={`status-report-row-${r.id}`}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-xl border px-3.5 py-3 text-left transition-colors",
                    active ? "border-primary/55 bg-primary/[.07]" : "border-border/60 bg-muted/[.02] hover:bg-muted/10",
                  )}
                >
                  <div className="flex flex-wrap items-baseline gap-2.5">
                    <span className="text-[13.5px] font-semibold text-foreground">{r.periodLabel}</span>
                    <span className="ml-auto whitespace-nowrap text-[10.5px] text-muted-foreground">
                      as of {formatDate(r.asOfDate)}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    Published {r.publishedAt ? formatDate(r.publishedAt) : "—"} · {r.authoredByName ?? "Unknown operator"}
                  </span>
                  <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground/90">
                    {r.content.split("\n")[0]}
                  </span>
                </button>
              );
            })}
            <span className="px-1 py-0.5 text-[10.5px] leading-relaxed text-muted-foreground/70">
              Newest period first, by the date each report covers — a report entered late for an earlier
              period sorts by that period, not by when it arrived.
            </span>
          </div>

          {selected && (
            <div className="flex min-w-0 flex-col gap-3">
              <Card data-testid="status-report-detail">
                <CardContent className="flex flex-col gap-3.5 pt-6">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[9px] font-bold tracking-[.09em] text-muted-foreground/70">STATUS REPORT</span>
                    <span className="text-lg font-bold tracking-tight text-foreground">{selected.periodLabel}</span>
                    <div className="flex flex-wrap gap-3.5 text-[11.5px] text-muted-foreground">
                      <span>As of {formatDate(selected.asOfDate)}</span>
                      <span>Published {selected.publishedAt ? formatDate(selected.publishedAt) : "—"}</span>
                      <span className={selected.authoredByName ? undefined : "text-muted-foreground/70"}>
                        {selected.authoredByName ? `Written by ${selected.authoredByName}` : "Author unknown — no name on record"}
                      </span>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap border-t border-border/50 pt-3.5 text-[13px] leading-[1.7] text-foreground/90">
                    {selected.content}
                  </p>
                  <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
                    Shown as your MSP wrote it. Line breaks are kept; nothing is summarised or reformatted.
                    Published reports cannot be edited on their side either.
                  </span>
                </CardContent>
              </Card>

              <Card data-testid="status-report-discussion">
                <CardContent className="flex flex-col gap-3 pt-6">
                  <div className="flex flex-wrap items-baseline gap-2.5">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                      <MessageSquare className="size-3.5" />
                      Discussion
                    </span>
                    {commentsQuery.data && commentsQuery.data.length > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        {commentsQuery.data.length} comment{commentsQuery.data.length === 1 ? "" : "s"} · oldest first
                      </span>
                    )}
                  </div>

                  {commentsQuery.isLoading && (
                    <div className="flex flex-col gap-2">
                      {[0, 1].map((i) => (
                        <div key={i} className="h-12 animate-pulse rounded-xl bg-muted/10" />
                      ))}
                    </div>
                  )}

                  {commentsQuery.isError && (
                    <span className="text-xs leading-relaxed text-status-red">
                      Comments could not be read. Try reopening this report.
                    </span>
                  )}

                  {commentsQuery.data && commentsQuery.data.length === 0 && (
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      No comments yet. Yours would be the first; your MSP sees it and can reply here.
                    </span>
                  )}

                  {commentsQuery.data && commentsQuery.data.length > 0 && (
                    <div className="flex flex-col gap-2.5">
                      {commentsQuery.data.map((m) => {
                        const isMsp = m.authorType === "msp";
                        return (
                          <div
                            key={m.id}
                            className={cn(
                              "flex flex-col gap-1 rounded-xl border p-3",
                              isMsp ? "border-status-blue/20 bg-status-blue/[.04]" : "border-border/60 bg-muted/[.02]",
                            )}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[9.5px] font-bold tracking-[.08em]",
                                  isMsp ? "border-status-blue/40 text-status-blue" : "border-muted-foreground/35 text-muted-foreground",
                                )}
                              >
                                {isMsp ? "YOUR MSP" : "YOUR ORGANISATION"}
                              </Badge>
                              <span className={cn("text-xs font-semibold", m.authorName ? "text-foreground" : "text-muted-foreground")}>
                                {m.authorName ?? (isMsp ? "Unknown operator" : "Unknown")}
                              </span>
                              <span className="ml-auto whitespace-nowrap text-[10.5px] text-muted-foreground">
                                {formatDateTime(m.createdAt)}
                              </span>
                            </div>
                            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/90">{m.body}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex flex-col gap-2 border-t border-border/50 pt-3">
                    <span className="text-[11px] font-semibold text-muted-foreground">Add a comment</span>
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="A question, a correction, a request for next month's report…"
                      className="min-h-[72px] resize-y text-[12.5px]"
                      maxLength={MAX_COMMENT_LENGTH + 500}
                      data-testid="status-report-comment-input"
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className={cn(
                          "text-[10.5px]",
                          trimmed.length > MAX_COMMENT_LENGTH ? "text-status-red" : "text-muted-foreground/70",
                        )}
                      >
                        {draft.length.toLocaleString()} / {MAX_COMMENT_LENGTH.toLocaleString()}
                      </span>
                      <Button
                        size="sm"
                        className="ml-auto"
                        disabled={!canPost}
                        onClick={handlePost}
                        data-testid="status-report-comment-submit"
                      >
                        {addComment.isPending && <Loader2 className="size-3 animate-spin" />}
                        {addComment.isPending ? "Adding…" : "Add comment"}
                      </Button>
                    </div>
                    {addComment.isSuccess && !addComment.isPending && draft === "" && (
                      <span className="text-[11px] leading-relaxed text-status-green">
                        Added. Your comment is recorded and cannot be edited or removed. A notification goes
                        to the operator who wrote this report, best-effort — the comment stands whether or
                        not that message lands.
                      </span>
                    )}
                    {addComment.isError && (
                      <div className="flex gap-2.5 rounded-xl border border-dashed border-status-red/45 bg-status-red/[.06] p-3">
                        <AlertTriangle className="mt-0.5 size-3.5 flex-none text-status-red" />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-semibold text-foreground">&ldquo;Failed to add comment&rdquo;</span>
                          <span className="text-[11px] leading-relaxed text-muted-foreground">
                            The server&apos;s own message. Nothing was recorded and your text is still here —
                            try again.
                          </span>
                        </div>
                      </div>
                    )}
                    <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
                      Comments are permanent: nobody, on either side, can edit or delete one. You always post
                      as yourself.
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
