import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

type TestimonialKind = "testimonial" | "feedback" | "suggestion";

interface ProjectClosureTestimonial {
  source: "project_closure";
  id: number;
  projectId: number;
  projectTitle: string;
  projectType: string;
  kind: "testimonial";
  body: string | null;
  permissionToPublish: boolean;
  createdAt: string | null;
  clientName: string | null;
  clientEmail: string | null;
}

type CreditStatus = "pending" | "issued" | "awaiting_subscription" | "failed" | "applied";

interface BillingCredit {
  id: number;
  status: CreditStatus;
  discountType: "fixed" | "percentage";
  discountValue: string;
  currency: string;
  failureReason: string | null;
  issuedAt: string | null;
  appliedAt: string | null;
  appliedAmountCents: number | null;
}

interface CustomerTestimonial {
  source: "customer_testimonial";
  id: number;
  customerId: number;
  customerName: string | null;
  kind: TestimonialKind;
  body: string | null;
  permissionToPublish: boolean;
  status: "pending" | "approved" | "rejected";
  reviewedAt: string | null;
  reviewerName: string | null;
  credit: BillingCredit | null;
  createdAt: string | null;
  clientName: string | null;
  clientEmail: string | null;
}

type AdminTestimonialRow = ProjectClosureTestimonial | CustomerTestimonial;

function ProjectTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    retainer: "bg-purple-500/15 text-purple-400",
    project: "bg-primary/100/15 text-blue-400",
    "micro-offer": "bg-teal-500/15 text-teal-400",
  };
  const cls = map[type] ?? "bg-border/50 text-muted-foreground";
  const label = type === "micro-offer" ? "Micro-Offer" : type.charAt(0).toUpperCase() + type.slice(1);
  return <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function SourceBadge({ row }: { row: AdminTestimonialRow }) {
  if (row.source === "project_closure") {
    return (
      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/100/15 text-blue-400">
        Project Closure
      </span>
    );
  }
  const kindLabel = row.kind.charAt(0).toUpperCase() + row.kind.slice(1);
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-400">
      Portal {kindLabel}
    </span>
  );
}

function formatDay(val: string) {
  return new Date(val).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatCreditAmount(credit: BillingCredit) {
  const v = parseFloat(credit.discountValue);
  return credit.discountType === "percentage"
    ? `${v}% off`
    : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} off`;
}

const CREDIT_STATUS: Record<CreditStatus, { label: string; cls: string }> = {
  pending: { label: "Credit pending", cls: "bg-border/50 text-muted-foreground" },
  issued: { label: "Credit on next invoice", cls: "bg-emerald-500/15 text-emerald-400" },
  awaiting_subscription: { label: "Credit waiting for a subscription", cls: "bg-amber-500/15 text-amber-400" },
  failed: { label: "Credit failed", cls: "bg-red-500/15 text-red-400" },
  applied: { label: "Credit applied", cls: "bg-emerald-500/15 text-emerald-400" },
};

// Approval decision + next-month credit for a portal testimonial (Git #4032).
function ReviewPanel({ row, onChanged }: { row: CustomerTestimonial; onChanged: () => void }) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [discountType, setDiscountType] = useState<"fixed" | "percentage">("fixed");
  const [discountValue, setDiscountValue] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | "retry" | null>(null);
  const [error, setError] = useState("");

  const post = async (action: "approve" | "reject" | "retry", url: string, body: unknown, successTitle: string) => {
    setError("");
    setBusy(action);
    try {
      const res = await fetchWithAuth(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Request failed (HTTP ${res.status})`);
        return;
      }
      toast({ title: successTitle });
      onChanged();
    } catch {
      setError("Network error — please try again");
    } finally {
      setBusy(null);
    }
  };

  const handleApprove = () => {
    const value = parseFloat(discountValue);
    if (isNaN(value) || value <= 0) { setError("Credit value must be a positive number"); return; }
    if (discountType === "percentage" && value > 100) { setError("Percentage credit cannot exceed 100"); return; }
    void post("approve", `/api/admin/testimonials/${row.id}/approve`, { discountType, discountValue: value }, "Testimonial approved");
  };

  if (row.status !== "pending") {
    const credit = row.credit;
    return (
      <div className="border-t border-border pt-3 space-y-2" data-testid={`testimonial-review-${row.id}`}>
        <p className="text-xs text-muted-foreground">
          <span className={`font-semibold ${row.status === "approved" ? "text-emerald-400" : "text-red-400"}`}>
            {row.status === "approved" ? "Approved" : "Rejected"}
          </span>
          {row.reviewedAt ? ` ${formatDay(row.reviewedAt)}` : ""}
          {row.reviewerName ? ` by ${row.reviewerName}` : ""}
        </p>
        {credit && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-foreground">{formatCreditAmount(credit)}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${CREDIT_STATUS[credit.status].cls}`} data-testid={`testimonial-credit-status-${row.id}`}>
              {CREDIT_STATUS[credit.status].label}
            </span>
            {credit.status === "applied" && credit.appliedAmountCents != null && (
              <span className="text-xs text-muted-foreground">
                ${(credit.appliedAmountCents / 100).toFixed(2)} taken off{credit.appliedAt ? ` on ${formatDay(credit.appliedAt)}` : ""}
              </span>
            )}
            {(credit.status === "failed" || credit.status === "awaiting_subscription") && (
              <button
                onClick={() => void post("retry", `/api/admin/testimonial-credits/${credit.id}/retry`, {}, "Credit retried")}
                disabled={busy !== null}
                data-testid={`testimonial-credit-retry-${row.id}`}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-lg border border-border text-foreground hover:border-primary hover:text-primary disabled:opacity-50 transition-colors"
              >
                {busy === "retry" && <Loader2 className="w-3 h-3 animate-spin" />}
                Retry credit
              </button>
            )}
          </div>
        )}
        {credit?.failureReason && (credit.status === "failed" || credit.status === "awaiting_subscription") && (
          <p className="text-xs text-muted-foreground">{credit.failureReason}</p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  const eligible = row.kind === "testimonial" && row.permissionToPublish;

  return (
    <div className="border-t border-border pt-3 space-y-2" data-testid={`testimonial-review-${row.id}`}>
      {eligible ? (
        <>
          <p className="text-xs text-muted-foreground">Approving grants the customer a one-time credit on their next month of service.</p>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1">
              {(["fixed", "percentage"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setDiscountType(t)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                    discountType === t
                      ? "bg-primary text-white border-primary"
                      : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  {t === "fixed" ? "$ Fixed" : "% Percentage"}
                </button>
              ))}
            </div>
            <input
              type="number"
              min="0"
              max={discountType === "percentage" ? 100 : undefined}
              step="0.01"
              value={discountValue}
              onChange={e => setDiscountValue(e.target.value)}
              placeholder={discountType === "fixed" ? "Amount" : "Percent"}
              data-testid={`testimonial-credit-value-${row.id}`}
              className="w-28 border border-border rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              onClick={handleApprove}
              disabled={busy !== null}
              data-testid={`testimonial-approve-${row.id}`}
              className="flex items-center gap-1.5 bg-primary text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#005A9E] disabled:opacity-50 transition-colors"
            >
              {busy === "approve" && <Loader2 className="w-3 h-3 animate-spin" />}
              Approve
            </button>
            <button
              onClick={() => void post("reject", `/api/admin/testimonials/${row.id}/reject`, {}, "Testimonial rejected")}
              disabled={busy !== null}
              data-testid={`testimonial-reject-${row.id}`}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-red-400 hover:border-red-500/40 disabled:opacity-50 transition-colors"
            >
              {busy === "reject" && <Loader2 className="w-3 h-3 animate-spin" />}
              Reject
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-muted-foreground">
            {row.kind === "testimonial"
              ? "Can't be approved: the customer did not give permission to publish."
              : "Feedback and suggestions are not published, so they can't be approved for a credit."}
          </p>
          <button
            onClick={() => void post("reject", `/api/admin/testimonials/${row.id}/reject`, {}, "Marked as rejected")}
            disabled={busy !== null}
            data-testid={`testimonial-reject-${row.id}`}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-red-400 hover:border-red-500/40 disabled:opacity-50 transition-colors"
          >
            {busy === "reject" && <Loader2 className="w-3 h-3 animate-spin" />}
            Reject
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export default function TestimonialsPage() {
  const { fetchWithAuth } = useAuth();
  const [items, setItems] = useState<AdminTestimonialRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetchWithAuth("/api/admin/testimonials/all")
      .then(r => r.json())
      .then(d => setItems(d as AdminTestimonialRow[]))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  useEffect(() => { load(); }, [load]);

  // (Git #4060) "Published" means it actually went out — for a project_closure
  // that's still permissionToPublish (no review step exists for those), but for
  // a portal customer_testimonial it's the admin's real approval decision
  // (status === "approved"), not the customer's own permissionToPublish intent.
  const isPublished = (i: AdminTestimonialRow) =>
    i.source === "project_closure" ? i.permissionToPublish : i.status === "approved";

  const published = items.filter(i => isPublished(i) && i.body?.trim());
  const pendingReview = items.filter(
    i => !isPublished(i) && i.body?.trim() && i.source === "customer_testimonial" && i.status === "pending",
  );
  const awaitingPermission = items.filter(
    i => !isPublished(i) && i.body?.trim() && !pendingReview.includes(i),
  );
  const signedOff = items.filter(i => !i.body?.trim());

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Testimonials</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Signed project closures and standing portal submissions. Entries with permission granted appear on the public website.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-foreground">No testimonials yet</p>
          <p className="text-xs text-muted-foreground mt-1">Request a closure sign-off from a project's detail page, or wait for a customer to submit one from the portal.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {published.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
                  Published Testimonials ({published.length})
                </h2>
              </div>
              <div className="space-y-4">
                {published.map(item => (
                  <div key={`${item.source}-${item.id}`} className="bg-card border border-border rounded-xl p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-foreground">
                            {item.source === "project_closure" ? item.projectTitle : (item.customerName ?? "Unknown customer")}
                          </p>
                          {item.source === "project_closure" ? (
                            <ProjectTypeBadge type={item.projectType} />
                          ) : (
                            <SourceBadge row={item} />
                          )}
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-400 bg-green-500/10 border border-green-500/20 rounded-full px-2 py-0.5">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                            Published
                          </span>
                        </div>
                        {item.clientName && (
                          <p className="text-xs text-muted-foreground">{item.clientName} {item.clientEmail ? `· ${item.clientEmail}` : ""}</p>
                        )}
                      </div>
                      {item.createdAt && (
                        <p className="text-xs text-muted-foreground flex-shrink-0">
                          {item.source === "project_closure" ? "Signed" : "Submitted"} {formatDay(item.createdAt)}
                        </p>
                      )}
                    </div>
                    {item.body && (
                      <blockquote className="border-l-4 border-primary pl-4 text-sm text-foreground/80 italic leading-relaxed">
                        "{item.body}"
                      </blockquote>
                    )}
                    {item.source === "customer_testimonial" && <ReviewPanel row={item} onChanged={load} />}
                  </div>
                ))}
              </div>
            </section>
          )}

          {pendingReview.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-2 h-2 rounded-full bg-primary" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
                  Pending Review ({pendingReview.length})
                </h2>
              </div>
              <div className="space-y-4">
                {pendingReview.map(item => (
                  <div key={`${item.source}-${item.id}`} className="bg-card border border-border rounded-xl p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-foreground">
                            {item.source === "project_closure" ? item.projectTitle : (item.customerName ?? "Unknown customer")}
                          </p>
                          {item.source === "project_closure" ? (
                            <ProjectTypeBadge type={item.projectType} />
                          ) : (
                            <SourceBadge row={item} />
                          )}
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                            Pending Review
                          </span>
                        </div>
                        {item.clientName && (
                          <p className="text-xs text-muted-foreground">{item.clientName} {item.clientEmail ? `· ${item.clientEmail}` : ""}</p>
                        )}
                      </div>
                      {item.createdAt && (
                        <p className="text-xs text-muted-foreground flex-shrink-0">
                          {item.source === "project_closure" ? "Signed" : "Submitted"} {formatDay(item.createdAt)}
                        </p>
                      )}
                    </div>
                    {item.body && (
                      <blockquote className="border-l-4 border-border pl-4 text-sm text-foreground/80 italic leading-relaxed">
                        "{item.body}"
                      </blockquote>
                    )}
                    {item.source === "customer_testimonial" && <ReviewPanel row={item} onChanged={load} />}
                  </div>
                ))}
              </div>
            </section>
          )}

          {awaitingPermission.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
                  Awaiting Permission ({awaitingPermission.length})
                </h2>
              </div>
              <div className="space-y-4">
                {awaitingPermission.map(item => (
                  <div key={`${item.source}-${item.id}`} className="bg-card border border-border rounded-xl p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-foreground">
                            {item.source === "project_closure" ? item.projectTitle : (item.customerName ?? "Unknown customer")}
                          </p>
                          {item.source === "project_closure" ? (
                            <ProjectTypeBadge type={item.projectType} />
                          ) : (
                            <SourceBadge row={item} />
                          )}
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
                            {item.source === "customer_testimonial" && item.status === "rejected" ? "Rejected" : "No Publish Permission"}
                          </span>
                        </div>
                        {item.clientName && (
                          <p className="text-xs text-muted-foreground">{item.clientName} {item.clientEmail ? `· ${item.clientEmail}` : ""}</p>
                        )}
                      </div>
                      {item.createdAt && (
                        <p className="text-xs text-muted-foreground flex-shrink-0">
                          {item.source === "project_closure" ? "Signed" : "Submitted"} {formatDay(item.createdAt)}
                        </p>
                      )}
                    </div>
                    {item.body && (
                      <blockquote className="border-l-4 border-border pl-4 text-sm text-foreground/80 italic leading-relaxed">
                        "{item.body}"
                      </blockquote>
                    )}
                    {item.source === "customer_testimonial" && <ReviewPanel row={item} onChanged={load} />}
                  </div>
                ))}
              </div>
            </section>
          )}

          {signedOff.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/60" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
                  Signed Off — No Testimonial ({signedOff.length})
                </h2>
              </div>
              <div className="space-y-3">
                {signedOff.map(item => (
                  <div key={`${item.source}-${item.id}`} className="bg-accent border border-border rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground">
                          {item.source === "project_closure" ? item.projectTitle : (item.customerName ?? "Unknown customer")}
                        </p>
                        {item.source === "project_closure" ? (
                          <ProjectTypeBadge type={item.projectType} />
                        ) : (
                          <SourceBadge row={item} />
                        )}
                      </div>
                      {item.clientName && (
                        <p className="text-xs text-muted-foreground">{item.clientName}</p>
                      )}
                    </div>
                    {item.createdAt && (
                      <p className="text-xs text-muted-foreground">
                        {formatDay(item.createdAt)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
