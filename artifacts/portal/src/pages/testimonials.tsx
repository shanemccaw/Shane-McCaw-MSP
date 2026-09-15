import { useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, Loader2, MessageSquareText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  TESTIMONIAL_KINDS,
  useSubmitTestimonial,
  useTestimonialHistory,
  type TestimonialKind,
} from "@/lib/testimonials-api";

/**
 * Testimonials (#3894, Feature #3436, part of #1485).
 *
 * STUB UI PENDING DESIGN REVIEW — Shane's 2026-09-15 authorization ("a stub is
 * better than nothing"): no `Design/portal/` export exists yet for this page.
 * Built directly against the real, live wire contract in
 * `docs/portal/testimonials-contract-pack.md` (#3893) instead of waiting on a
 * Design pass — uses this app's existing shadcn/ui "new-york" components and
 * spacing/card conventions rather than inventing a new visual style. Expect
 * this page to be redrawn once a real design lands.
 *
 * Wired to the real, live endpoints — no fixture data:
 *   POST /api/portal/testimonials   — submit
 *   GET  /api/portal/testimonials   — this login's own submission history
 *
 * The form asks for exactly the fields the real `customer_testimonials`
 * schema has — `kind`, `body`, `permissionToPublish`. There is no `rating`
 * column on this table (confirmed against `lib/db/src/schema/index.ts` and
 * the contract pack) — this page does not invent one.
 */

const KIND_LABEL: Record<TestimonialKind, string> = {
  testimonial: "Testimonial",
  feedback: "Feedback",
  suggestion: "Suggestion",
};

const KIND_HINT: Record<TestimonialKind, string> = {
  testimonial: "A quote about your experience working with your provider.",
  feedback: "General feedback on how things are going — not meant for publication.",
  suggestion: "Something you'd like to see changed or added.",
};

const MAX_BODY = 4000;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function TestimonialsContent() {
  const history = useTestimonialHistory();
  const submit = useSubmitTestimonial();

  const [kind, setKind] = useState<TestimonialKind>("testimonial");
  const [body, setBody] = useState("");
  const [permissionToPublish, setPermissionToPublish] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_BODY && !submit.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setJustSubmitted(false);
    submit.mutate(
      { body: trimmed, kind, permissionToPublish },
      {
        onSuccess: () => {
          setBody("");
          setPermissionToPublish(false);
          setJustSubmitted(true);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid="testimonials-page">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Testimonials</h1>
        <Badge variant="outline" data-testid="testimonials-stub-badge">
          Stub UI pending Design review
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Share your feedback</CardTitle>
          <CardDescription>
            Tell your provider how things are going. A testimonial you allow to be published may be used on the
            marketing site — publishing only happens after your provider reviews and approves it, not automatically
            on submission.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Type</Label>
            <div className="flex flex-wrap gap-2" data-testid="testimonials-kind-picker">
              {TESTIMONIAL_KINDS.map((k) => {
                const active = kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors",
                      active
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-transparent text-muted-foreground hover:bg-accent",
                    )}
                    data-testid={`testimonials-kind-${k}`}
                  >
                    {KIND_LABEL[k]}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{KIND_HINT[kind]}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="testimonial-body">Your message</Label>
            <Textarea
              id="testimonial-body"
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
              rows={5}
              placeholder="What would you like to share?"
              data-testid="testimonials-body-input"
            />
            <p className="text-xs text-muted-foreground">
              {trimmed.length}/{MAX_BODY} characters
            </p>
          </div>

          <div className="flex items-start gap-2.5">
            <Checkbox
              id="testimonial-permission"
              checked={permissionToPublish}
              onCheckedChange={(v) => setPermissionToPublish(v === true)}
              data-testid="testimonials-permission-checkbox"
            />
            <Label htmlFor="testimonial-permission" className="cursor-pointer text-xs font-normal leading-relaxed text-muted-foreground">
              I give my provider permission to publish this as a testimonial (e.g. on their marketing site) once
              they review and approve it.
            </Label>
          </div>

          {submit.isError && (
            <p className="text-xs text-destructive" data-testid="testimonials-submit-error">
              {submit.error instanceof Error ? submit.error.message : "We couldn't submit this right now. Please try again shortly."}
            </p>
          )}

          {justSubmitted && !submit.isPending && (
            <div className="flex items-center gap-2 text-xs text-status-green" data-testid="testimonials-submit-success">
              <CheckCircle2 className="size-3.5" />
              Thank you — your submission has been recorded.
            </div>
          )}

          <div>
            <Button onClick={handleSubmit} disabled={!canSubmit} data-testid="testimonials-submit-button">
              {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Submit
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your submissions</CardTitle>
          <CardDescription>What you've sent from this login. Other logins on your account may have their own history.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.isLoading && (
            <div className="flex items-center justify-center py-6" data-testid="testimonials-history-loading">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {history.isError && (
            <p className="text-xs text-destructive" data-testid="testimonials-history-error">
              We couldn't load your submission history right now. Please try again shortly.
            </p>
          )}

          {history.isSuccess && history.data.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center" data-testid="testimonials-history-empty">
              <MessageSquareText className="size-6 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-xs text-muted-foreground">You haven't submitted anything from this login yet.</p>
            </div>
          )}

          {history.isSuccess && history.data.length > 0 && (
            <div className="flex flex-col gap-3" data-testid="testimonials-history-list">
              {history.data.map((t) => (
                <div key={t.id} className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0" data-testid={`testimonials-history-row-${t.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{KIND_LABEL[t.kind]}</Badge>
                    <span className="text-[11px] text-muted-foreground">{formatDate(t.createdAt)}</span>
                    {t.permissionToPublish && (
                      <span className="text-[11px] text-muted-foreground">· publish permitted</span>
                    )}
                  </div>
                  <p className="text-sm text-foreground">{t.body}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardContent className="pt-6">
          <p className="text-xs leading-relaxed text-muted-foreground">
            This page is a real stub, not a placeholder: it submits to and reads from the live backend, but its
            layout hasn't been through Design yet. Once you submit a testimonial with publishing permission, it does
            not go live automatically — your provider reviews it first. <Link href="/" className="font-semibold text-primary hover:underline">Back to Overview</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function TestimonialsPage() {
  return (
    <div className="mx-auto max-w-[720px] py-2 pb-14">
      <TestimonialsContent />
    </div>
  );
}
