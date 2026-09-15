import { useMemo, useState } from "react";
import { useParams } from "wouter";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Folder, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad } from "@/components/risk-register/SignaturePad";
import { useProjectDetail, useProjectKanbanEvents, useSignProjectClosure } from "@/lib/projects-api";
import type {
  KanbanColumn,
  ProjectStatus,
  StatusReportClientStatus,
  WireKanbanTask,
  WirePreviewTask,
  WireWorkflowStep,
} from "@/lib/projects-types";
import { cn } from "@/lib/utils";

/**
 * Project detail (#1739, Feature #1570). Adapted from
 * `Design/portal/design_handoff_billing_roles_and_new_modules/screens/Projects.dc.html`
 * per that package's README, wired per `docs/portal/projects-contract-pack.md`
 * against the one real customer route, `GET /api/portal/projects/:id`, plus
 * its `kanban-events` SSE sibling.
 *
 * **By-id page only** — there is no list route (§1a of the pack), so this is
 * reached from a link only (an MSP email, or a future Overview surface), never
 * from an index this app renders. `App.tsx` mounts it at `/projects/:id` with
 * no sidebar entry, matching that.
 *
 * Deliberately honest, not a design gap papered over:
 *   - The coupon line draws the earliest invoice's discount only — the
 *     route's own comment claims a sum, the query returns one row (pack's
 *     §1a finding). Not fixed here; drawing what the API actually returns.
 *   - The closure-requested banner (#4025) is now a real sign-off ceremony —
 *     drawn signature (`SignaturePad`, the same component the RBD document
 *     and SOW share-link ceremonies use), a permission checkbox, and
 *     optional feedback, posted to `POST /api/portal/projects/:id/closure`
 *     (#4058). Honors the route's real 404 (no closure request exists) and
 *     409 (already signed elsewhere) responses rather than assuming success.
 *   - `previewTasks` render in their own "Coming up" strip, never inside
 *     Backlog — they are a read-only template projection, not real tasks.
 */

const STATUS_STYLE: Record<ProjectStatus, string> = {
  active: "border-status-green/30 bg-status-green/10 text-status-green",
  on_hold: "border-status-amber/30 bg-status-amber/10 text-status-amber",
  completed: "border-status-blue/30 bg-status-blue/10 text-status-blue",
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
};

const TYPE_LABEL: Record<string, string> = {
  project: "Project",
  retainer: "Retainer",
  quick_win: "Quick win",
};

const STEP_STYLE: Record<WireWorkflowStep["status"] & string, { label: string; className: string; notesAmber?: boolean }> = {
  pending: { label: "Pending", className: "border-muted-foreground/30 text-muted-foreground" },
  in_progress: { label: "In progress", className: "border-status-blue/40 bg-status-blue/10 text-status-blue" },
  completed: { label: "Completed", className: "border-status-green/40 bg-status-green/10 text-status-green" },
  blocked: { label: "Blocked", className: "border-status-red/40 bg-status-red/10 text-status-red", notesAmber: false },
};

const UPDATE_STYLE: Record<string, string> = {
  update: "border-muted-foreground/30 text-muted-foreground",
  milestone: "border-status-green/40 text-status-green",
  message: "border-status-blue/40 text-status-blue",
  file: "border-status-violet/40 text-status-violet",
};

const REPORT_STATUS_STYLE: Record<StatusReportClientStatus, { label: string; className: string }> = {
  pending: { label: "Awaiting your review", className: "border-status-amber/30 bg-status-amber/10 text-status-amber" },
  has_questions: { label: "You asked questions", className: "border-status-blue/30 bg-status-blue/10 text-status-blue" },
  accepted: { label: "Accepted", className: "border-status-green/30 bg-status-green/10 text-status-green" },
};

const BOARD_COLUMNS: Array<{ key: KanbanColumn; label: string; hotOnWaiting?: boolean }> = [
  { key: "backlog", label: "BACKLOG" },
  { key: "in_progress", label: "IN PROGRESS" },
  { key: "waiting_on_customer", label: "WAITING ON YOU", hotOnWaiting: true },
  { key: "review", label: "REVIEW" },
  { key: "completed", label: "COMPLETED" },
];

const LEDGER: Array<{ gap: string; where: string }> = [
  {
    gap: "No list. The only customer read is one project by id; you arrive from a link (your MSP's email, or a future Overview surface). A project index does not exist on the server, so none is drawn here.",
    where: "§1a",
  },
  {
    gap: "Sign-off happens here now: a drawn signature, a permission checkbox, and optional feedback, posted to the real closure route. It only ever updates a closure row an admin already requested — it never creates one, and it refuses a second signature (409).",
    where: "§1c · #4025 · #4058",
  },
  {
    gap: "Progress is your MSP's arithmetic — completed tasks over all tasks, recomputed when they change a card. Preview cards do not count and this page does not recompute it.",
    where: "§1b",
  },
  {
    gap: "Dashed cards are a projection of the template for steps not yet started: read-only, not tasks, gone once the step is seeded.",
    where: "§1a",
  },
  {
    gap: "Phase and priority are free text. No fixed list is drawn for either; whatever your MSP last wrote stands.",
    where: "§1b · §6",
  },
  {
    gap: "The board has five columns including Review. The admin API's own type omits Review but the database allows it, so a card can sit there and this page shows it.",
    where: "§1b · §6",
  },
  {
    gap: "The status reports here are the retainer kind, sent only — the same ones My Architect shows. Accepting or questioning one happens there; this page only raises the flag.",
    where: "§1a",
  },
  {
    gap: "The coupon line shows the earliest invoice's discount only. The code's own comment promises a sum it does not deliver, so no total is claimed.",
    where: "§1a finding",
  },
  {
    gap: "A standalone SOW never becomes a project. Only an accepted project-class offer creates one; a signed standalone SOW is an end state on its own.",
    where: "§3",
  },
  {
    gap: "Live board updates arrive over a token-in-URL event stream; the page patches cards on a kanban change rather than polling.",
    where: "§1a",
  },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatMoney(amount: string | null): string {
  if (amount == null) return "—";
  const n = Number(amount);
  return Number.isNaN(n) ? amount : `$${n.toFixed(2)}`;
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error, refetch, isRefetching } = useProjectDetail(id);
  const errStatus = (error as (Error & { status?: number }) | null)?.status;
  const notFound = isError && errStatus === 404;
  const failed = isError && !notFound;
  const live = !!data && !isError;

  useProjectKanbanEvents(id, live);

  const [ledgerOpen, setLedgerOpen] = useState(true);

  // Closure sign-off ceremony state (#4025) — a drawn signature, an optional
  // permission checkbox, and optional feedback, all local until submitted.
  const signClosure = useSignProjectClosure(id);
  const [closureSignatureData, setClosureSignatureData] = useState<string | null>(null);
  const [closurePermissionGranted, setClosurePermissionGranted] = useState(false);
  const [closureFeedback, setClosureFeedback] = useState("");

  function handleSignClosure() {
    if (!closureSignatureData) {
      toast.error("Draw your signature before signing off.");
      return;
    }
    signClosure.mutate(
      {
        signatureDataUrl: closureSignatureData,
        permissionGranted: closurePermissionGranted,
        feedback: closureFeedback.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Project signed off. Your MSP has been notified.");
        },
        onError: (e) => {
          const status = (e as Error & { status?: number }).status;
          toast.error(
            status === 409
              ? "This closure has already been signed."
              : status === 404
                ? "No closure request exists for this project anymore."
                : e instanceof Error
                  ? e.message
                  : "Signing failed. Please try again.",
          );
        },
      },
    );
  }

  const tasksByColumn = useMemo(() => {
    const map = new Map<KanbanColumn, WireKanbanTask[]>();
    for (const col of BOARD_COLUMNS) map.set(col.key, []);
    for (const t of data?.tasks ?? []) {
      const key = t.column as KanbanColumn;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [data?.tasks]);

  const waitingCount = tasksByColumn.get("waiting_on_customer")?.length ?? 0;
  const stepsById = useMemo(() => new Map((data?.steps ?? []).map((s) => [s.id, s])), [data?.steps]);
  const completedSteps = (data?.steps ?? []).filter((s) => s.status === "completed").length;

  const previewByStep = useMemo(() => {
    const groups = new Map<number, WirePreviewTask[]>();
    for (const p of data?.previewTasks ?? []) {
      if (!groups.has(p.stepId)) groups.set(p.stepId, []);
      groups.get(p.stepId)!.push(p);
    }
    return groups;
  }, [data?.previewTasks]);

  const status = live && data ? (data.project.status as ProjectStatus) : null;

  return (
    <div className="flex flex-col gap-4 pb-14">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Projects</h1>
        <span
          title="A project is the work your MSP runs after you accept a project-class offer: its steps, the task board, files, updates, status reports and the signed contract behind it. Your MSP runs the board; this page reads it and shows what is waiting on you."
          className="flex size-[17px] cursor-help items-center justify-center rounded-full border border-muted-foreground/35 text-[10px] font-bold text-muted-foreground"
        >
          i
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              failed ? "bg-status-red" : notFound ? "bg-status-amber" : isLoading ? "bg-muted-foreground" : "bg-status-green",
            )}
          />
          {isLoading
            ? "Reading this project"
            : failed
              ? "Read failed · 500"
              : notFound
                ? `Not found · 404 · projects/${id}`
                : `Live · projects/${id} · ${data?.tasks.length ?? 0} tasks${waitingCount ? ` · ${waitingCount} waiting on you` : ""}`}
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
            <span className="text-[13px] font-semibold text-foreground">This project could not be read</span>
            <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">
              A failed read, not a missing project. Your MSP's board is unchanged; the server returned its own
              error rather than an empty page.
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto w-fit p-0 text-[11.5px]"
              onClick={() => void refetch()}
              disabled={isRefetching}
              data-testid="project-detail-retry"
            >
              {isRefetching && <Loader2 className="size-3 animate-spin" />}
              Try again
            </Button>
          </div>
        </div>
      )}

      {notFound && (
        <Card data-testid="project-detail-not-found">
          <CardContent className="flex flex-col gap-2 pt-6">
            <span className="text-[13.5px] font-semibold text-foreground">No project at that address</span>
            <span className="max-w-[700px] text-xs leading-relaxed text-muted-foreground">
              A project id nothing matches, and a project that belongs to another organisation, get this same
              answer — the server never confirms which. There is no list to fall back to: the only project read
              a customer has is one project by id, so you arrive here from a link (an email from your MSP, or
              Overview), never from an index.
            </span>
            <span className="max-w-[700px] text-[11px] leading-relaxed text-muted-foreground/70">
              Today this is the answer for every id on the platform. A project is created only when a
              project-class offer is accepted and fulfilled, and none has been yet — the table is empty,
              honestly.
            </span>
            <span className="font-mono text-[10.5px] text-muted-foreground/70">404 · GET /api/portal/projects/:id</span>
          </CardContent>
        </Card>
      )}

      {live && data && status && (
        <>
          <Card data-testid="project-detail-header">
            <CardContent className="flex flex-col gap-3 pt-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-muted-foreground/35 text-muted-foreground">
                  {TYPE_LABEL[data.project.projectType] ?? data.project.projectType}
                </Badge>
                <Badge variant="outline" className={STATUS_STYLE[status] ?? STATUS_STYLE.active}>
                  {STATUS_LABEL[status] ?? data.project.status}
                </Badge>
                <span className="text-[11px] text-muted-foreground">Phase · {data.project.phase ?? "—"}</span>
                <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
                  {formatDate(data.project.startDate)} → {formatDate(data.project.endDate)}
                </span>
              </div>
              <span className="text-lg font-bold leading-tight tracking-tight text-foreground">{data.project.title}</span>
              {data.project.description && (
                <span className="max-w-[720px] text-[12.5px] leading-relaxed text-foreground/90">{data.project.description}</span>
              )}
              <div className="flex flex-col gap-1.5 border-t border-border/50 pt-3">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <span className="text-[9px] font-bold tracking-wider text-muted-foreground">PROGRESS</span>
                  <span className="text-xs font-semibold text-foreground">{data.project.progress}%</span>
                  <span className="text-[10.5px] text-muted-foreground">
                    {data.tasks.filter((t) => t.column === "completed").length} of {data.tasks.length} tasks completed ·
                    your MSP's count, recomputed when a card moves
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted/25">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-status-teal"
                    style={{ width: `${Math.max(0, Math.min(100, data.project.progress))}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 border-t border-border/50 pt-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] font-bold tracking-wider text-muted-foreground">SIGNED CONTRACT</span>
                  {data.contract ? (
                    <>
                      <span className="text-xs leading-relaxed text-foreground/90">
                        Signed {formatDate(data.contract.signedAt)}
                        {data.contract.signerName ? ` by ${data.contract.signerName}` : ""} · {data.contract.serviceName}
                      </span>
                      {(data.contract.sharepointFileUrl || data.contract.pdfFilename) && (
                        <a
                          href={data.contract.sharepointFileUrl ?? undefined}
                          target={data.contract.sharepointFileUrl ? "_blank" : undefined}
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                        >
                          <FileText className="size-3" />
                          {data.contract.pdfFilename ?? "View contract"}
                        </a>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">No signed contract on this project.</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] font-bold tracking-wider text-muted-foreground">PROJECT FILES</span>
                  {data.project.sharepointFolderUrl ? (
                    <>
                      <span className="text-xs text-foreground/90">SharePoint folder created by your MSP</span>
                      <a
                        href={data.project.sharepointFolderUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                      >
                        <Folder className="size-3" />
                        Open the folder
                        <ExternalLink className="size-2.5" />
                      </a>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">No SharePoint folder has been created yet.</span>
                  )}
                </div>
                {data.appliedCoupon && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-bold tracking-wider text-muted-foreground">COUPON</span>
                    <span className="text-xs text-foreground/90">
                      {data.appliedCoupon.couponCode} · {formatMoney(data.appliedCoupon.discountAmount)} off
                    </span>
                    <span className="text-[10.5px] leading-relaxed text-muted-foreground">
                      On the first invoice only — later invoices under the same code are not added up here.
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {data.pendingStatusReport && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-status-amber/35 bg-status-amber/[.06] p-3.5">
              <span className="text-[10px] font-bold tracking-wider text-status-amber">REVIEW THIS</span>
              <span className="min-w-[220px] flex-1 text-xs leading-relaxed text-foreground/90">
                "{data.pendingStatusReport.title}" ({data.pendingStatusReport.period}) was sent on{" "}
                {formatDate(data.pendingStatusReport.sentAt)} and is waiting for your review. It stays flagged
                until you accept it or ask a question.
              </span>
              <a href="/my-architect" className="whitespace-nowrap text-xs font-semibold text-primary hover:underline">
                Review it on My Architect →
              </a>
            </div>
          )}

          {data.closure && !data.closure.signedAt && (
            <Card className="border-primary/35 bg-primary/[.06]" data-testid="project-detail-closure">
              <CardContent className="flex flex-col gap-3 pt-6">
                <span className="text-[13.5px] font-semibold text-foreground">Your MSP has asked you to sign this project off</span>
                <span className="max-w-[720px] text-xs leading-relaxed text-foreground/90">
                  The last step closed on {formatDate(data.closure.requestedAt)} and the project is marked
                  completed. Signing off records your feedback, your permission for the work to be referenced,
                  and your signature against the project.
                </span>
                <div className="flex flex-col gap-3 border-t border-primary/20 pt-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="closure-feedback" className="text-[11px] text-muted-foreground">
                      Feedback for your MSP (optional)
                    </Label>
                    <Textarea
                      id="closure-feedback"
                      value={closureFeedback}
                      onChange={(e) => setClosureFeedback(e.target.value)}
                      placeholder="Anything you'd like your MSP to know about this project"
                      disabled={signClosure.isPending}
                      data-testid="closure-feedback"
                      className="min-h-[72px] bg-background/60"
                    />
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Checkbox
                      id="closure-permission"
                      checked={closurePermissionGranted}
                      onCheckedChange={(v) => setClosurePermissionGranted(v === true)}
                      disabled={signClosure.isPending}
                      data-testid="closure-permission-granted"
                    />
                    <Label htmlFor="closure-permission" className="text-[11.5px] leading-relaxed text-foreground/90">
                      I give permission for this work to be referenced as a case study or reference project.
                    </Label>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-[11px] text-muted-foreground">Your signature</Label>
                    <SignaturePad onChange={setClosureSignatureData} disabled={signClosure.isPending} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="max-w-[480px] text-[10.5px] leading-relaxed text-muted-foreground/70">
                      Signing off is final for this project — it cannot be undone from here.
                    </span>
                    <Button
                      className="ml-auto gap-2 whitespace-nowrap"
                      onClick={handleSignClosure}
                      disabled={signClosure.isPending || !closureSignatureData}
                      data-testid="closure-sign-submit"
                    >
                      {signClosure.isPending && <Loader2 className="size-3.5 animate-spin" />}
                      Sign off on this project
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {data.closure && data.closure.signedAt && (
            <div className="flex flex-col gap-1 rounded-xl border border-status-green/25 bg-status-green/[.06] p-3.5" data-testid="project-detail-closure-signed">
              <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
                <CheckCircle2 className="size-3.5 text-status-green" />
                Signed off {formatDate(data.closure.signedAt)}
              </span>
              <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                {data.closure.permissionGranted
                  ? "You gave permission for this work to be referenced as a case study or reference project."
                  : "You did not give permission for this work to be referenced as a case study or reference project."}
                {data.closure.feedback ? ` Feedback left: "${data.closure.feedback}"` : ""}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card data-testid="project-detail-steps">
              <CardContent className="flex flex-col gap-2.5 pt-6">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <span className="text-[13px] font-semibold text-foreground">Steps</span>
                  <span className="text-[11px] text-muted-foreground">
                    {completedSteps} of {data.steps.length} complete
                  </span>
                </div>
                <div className="flex flex-col">
                  {data.steps.map((s, i) => {
                    const k = STEP_STYLE[s.status as string] ?? STEP_STYLE.pending;
                    return (
                      <div key={s.id} className="flex items-start gap-3 border-t border-border/50 py-2.5 first:border-t-0">
                        <span
                          className={cn(
                            "flex size-[22px] flex-none items-center justify-center rounded-full border text-[10px] font-bold",
                            k.className,
                          )}
                        >
                          {i + 1}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[12.5px] font-semibold text-foreground">{s.title}</span>
                            <Badge variant="outline" className={cn("text-[10px]", k.className)}>
                              {k.label}
                            </Badge>
                          </div>
                          {s.description && <span className="text-[11.5px] leading-relaxed text-muted-foreground">{s.description}</span>}
                          {s.notes && (
                            <span className={cn("text-[11px] leading-relaxed", s.status === "blocked" ? "text-status-red" : "text-muted-foreground")}>
                              {s.notes}
                            </span>
                          )}
                          <span className="text-[10.5px] text-muted-foreground">
                            {s.completedAt ? `Completed ${formatDate(s.completedAt)}` : `Due ${formatDate(s.dueDate)}`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {data.steps.length === 0 && (
                    <span className="border-t border-border/50 pt-3 text-xs text-muted-foreground first:border-t-0">
                      No steps yet.
                    </span>
                  )}
                </div>
                <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
                  Steps come from the work template your MSP chose. Phase names are their own words, not a fixed
                  list.
                </span>
              </CardContent>
            </Card>

            <Card data-testid="project-detail-updates">
              <CardContent className="flex flex-col gap-2.5 pt-6">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <span className="text-[13px] font-semibold text-foreground">Updates</span>
                  <span className="text-[11px] text-muted-foreground">newest first</span>
                </div>
                <div className="flex flex-col">
                  {data.updates.map((u) => (
                    <div key={u.id} className="flex items-start gap-2.5 border-t border-border/50 py-2 first:border-t-0">
                      <Badge variant="outline" className={cn("mt-0.5 flex-none text-[9.5px] tracking-wider", UPDATE_STYLE[u.type] ?? UPDATE_STYLE.update)}>
                        {u.type.toUpperCase()}
                      </Badge>
                      <span className="min-w-0 flex-1 text-xs leading-relaxed text-foreground/90">{u.content}</span>
                      <span className="flex-none whitespace-nowrap text-[10.5px] text-muted-foreground">{formatDate(u.createdAt)}</span>
                    </div>
                  ))}
                  {data.updates.length === 0 && (
                    <span className="border-t border-border/50 pt-3 text-xs text-muted-foreground first:border-t-0">No updates yet.</span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 border-t border-border/50 pt-2.5">
                  <span className="text-[9px] font-bold tracking-wider text-muted-foreground">DOCUMENTS</span>
                  {data.documents.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No documents uploaded yet.</span>
                  ) : (
                    data.documents.map((f) => (
                      <div key={f.id} className="flex items-baseline gap-2.5">
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-primary">{f.name}</span>
                        <span className="flex-none text-[10.5px] text-muted-foreground">{formatDate(f.createdAt)}</span>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card data-testid="project-detail-board">
            <CardContent className="flex flex-col gap-3 pt-6">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="text-[13px] font-semibold text-foreground">Board</span>
                <span className="text-[11px] text-muted-foreground">
                  {waitingCount ? `${waitingCount} card${waitingCount === 1 ? "" : "s"} waiting on you` : "nothing waiting on you"}
                </span>
                <span className="ml-auto flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-status-green" />
                  Live · refreshes when your MSP moves a card
                </span>
              </div>
              <div className="-mx-1 overflow-x-auto overflow-y-hidden px-1 pb-1.5">
                <div className="grid min-w-[790px] grid-cols-5 items-start gap-2.5">
                  {BOARD_COLUMNS.map((col) => {
                    const cards = tasksByColumn.get(col.key) ?? [];
                    const hot = !!col.hotOnWaiting && cards.length > 0;
                    return (
                      <div
                        key={col.key}
                        className={cn(
                          "flex min-h-[120px] flex-col gap-2 rounded-xl border p-2.5",
                          hot ? "border-status-amber/40 bg-status-amber/[.05]" : "border-border/50 bg-muted/[.02]",
                        )}
                      >
                        <div className="flex items-baseline gap-1.5">
                          <span className={cn("text-[10px] font-bold tracking-wider", hot ? "text-status-amber" : "text-muted-foreground")}>
                            {col.label}
                          </span>
                          <span className="ml-auto text-[10.5px] text-muted-foreground">{cards.length}</span>
                        </div>
                        {cards.map((t) => {
                          const step = t.workflowStepId != null ? stepsById.get(t.workflowStepId) : undefined;
                          const meta = [step?.title, t.priority ? `priority ${t.priority}` : null, t.dueDate ? `due ${formatDate(t.dueDate)}` : null]
                            .filter(Boolean)
                            .join(" · ");
                          return (
                            <div key={t.id} className="flex flex-col gap-1 rounded-lg border border-border/60 bg-background/40 p-2.5">
                              <span className="text-xs leading-snug text-foreground">{t.title}</span>
                              {meta && <span className="text-[10.5px] leading-snug text-muted-foreground">{meta}</span>}
                            </div>
                          );
                        })}
                        {cards.length === 0 && <span className="p-0.5 text-[11px] text-muted-foreground/70">Nothing here</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
              {data.previewTasks.length > 0 && (
                <div className="flex flex-col gap-1.5 border-t border-border/50 pt-2.5">
                  <div className="flex flex-wrap items-baseline gap-2.5">
                    <span className="text-[9.5px] font-bold tracking-wider text-muted-foreground">
                      COMING UP · FROM THE TEMPLATE, NOT STARTED
                    </span>
                    <span className="text-[10.5px] text-muted-foreground">
                      {data.previewTasks.length} items across {previewByStep.size} later steps
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {data.previewTasks.map((pv, i) => (
                      <div key={i} className="flex min-w-0 flex-1 basis-[200px] flex-col gap-0.5 rounded-lg border border-dashed border-border/60 p-2.5">
                        <span className="text-[11.5px] leading-snug text-muted-foreground">{pv.title}</span>
                        {pv.groupName && <span className="text-[10px] text-muted-foreground/60">{pv.groupName}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
                Your MSP moves the cards; the board scrolls sideways when the window is narrow. Dashed items are
                a preview of what a later step will seed, read from the template — not tasks yet, and not
                counted in progress. Priority is free text where set.
              </span>
            </CardContent>
          </Card>

          <Card data-testid="project-detail-status-reports">
            <CardContent className="flex flex-col gap-2.5 pt-6">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="text-[13px] font-semibold text-foreground">Status reports on this project</span>
                <span className="text-[11px] text-muted-foreground">sent only · drafts never appear</span>
              </div>
              {data.statusReports.length === 0 ? (
                <span className="text-xs text-muted-foreground">None sent yet.</span>
              ) : (
                <div className="flex flex-col">
                  {data.statusReports.map((r) => {
                    const rs = REPORT_STATUS_STYLE[r.clientStatus as StatusReportClientStatus];
                    return (
                      <div key={r.id} className="flex flex-wrap items-start gap-3 border-t border-border/50 py-2.5 first:border-t-0">
                        <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[12.5px] font-semibold text-foreground">{r.title}</span>
                            {rs && (
                              <Badge variant="outline" className={cn("text-[10px]", rs.className)}>
                                {rs.label}
                              </Badge>
                            )}
                          </div>
                          {r.executiveSummary && <span className="text-[11.5px] leading-relaxed text-muted-foreground">{r.executiveSummary}</span>}
                        </div>
                        <span className="flex-none whitespace-nowrap text-[10.5px] text-muted-foreground">
                          Sent {formatDate(r.sentAt)} · {r.period}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
                These are the same retainer status reports My Architect shows, filtered to this project.
                Accepting one or raising a question happens there.
              </span>
            </CardContent>
          </Card>
        </>
      )}

      <Card className="bg-muted/5">
        <CardContent className="flex flex-col gap-2.5 pt-6">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[13px] font-semibold text-foreground">What this page deliberately does not do</span>
            <Button
              variant="link"
              size="sm"
              className="ml-auto h-auto p-0 text-[11.5px] font-semibold text-muted-foreground"
              onClick={() => setLedgerOpen((o) => !o)}
            >
              {ledgerOpen ? "Collapse" : "Expand"}
            </Button>
          </div>
          {ledgerOpen && (
            <div className="flex flex-col">
              {LEDGER.map((l, i) => (
                <div key={i} className="flex items-start gap-3 border-t border-border/50 py-2 first:border-t-0">
                  <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-foreground">{l.gap}</span>
                  <span className="flex-none whitespace-nowrap font-mono text-[10.5px] text-muted-foreground/70">{l.where}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
