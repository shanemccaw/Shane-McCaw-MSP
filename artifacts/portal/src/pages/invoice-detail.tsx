import { useState } from "react";
import { Link, useParams } from "wouter";
import { AlertCircle, ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { useInvoiceDetailLive } from "@/components/invoiceDetailLive";
import { PageContainer } from "@/components/shell/PageContainer";

const HAIRLINE = "rgba(255,255,255,.09)";
const CARD_BG = "rgba(255,255,255,.02)";
const GRN = "#34d399";
const AMB = "#fbbf24";
const RED = "#f87171";

/**
 * Invoice detail (#4116, follow-on from #4109's versioned re-issue). No
 * `.dc.html` export exists for this page in `Design/portal/` — Shane's own
 * dispatch comment on #4116 asked for it directly (a specific, scoped
 * feature ask with its own functional spec), so this reuses `billing.tsx`'s
 * real visual language (same color tokens, same card shape) rather than
 * inventing a new one, matching the one real customer-facing invoice surface
 * that exists today.
 *
 * Reached at `/billing/invoices/:id` — from a receipt row on the Billing
 * page, or from the real "Your invoice was updated, see what changed"
 * notification #4109's revise route now fires
 * (`routes/msp-invoices.ts` -> `linkPath: /billing/invoices/${revised.id}`).
 *
 * Default view shows this invoice's own current data — for an id reached
 * through normal navigation (the Billing list, which now filters out
 * `status: "superseded"`, or the revision notification, which always links
 * the newly-created row) that IS the latest version, per Shane's decision.
 * "See what changed" expands the real version history
 * (`GET /portal/invoices/:id/versions`): every prior version's own
 * `revisionReason` and a real field-level diff (amount/description/dueDate)
 * against the version it superseded.
 */
export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const invoiceId = id != null ? Number.parseInt(id, 10) : NaN;
  const live = useInvoiceDetailLive(Number.isFinite(invoiceId) ? invoiceId : null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { detail, versions, dataState, error } = live;
  const hasHistory = versions.length > 1;

  const statusStyle = (status: string) => {
    if (status === "paid") return { label: "Paid", ink: GRN, bg: "rgba(52,211,153,.10)", bd: "rgba(52,211,153,.28)" };
    if (status === "superseded") return { label: "Superseded", ink: "#64748b", bg: "rgba(100,116,139,.10)", bd: "rgba(100,116,139,.28)" };
    if (status === "overdue") return { label: "Overdue", ink: RED, bg: "rgba(248,113,113,.10)", bd: "rgba(248,113,113,.28)" };
    return { label: "Pending", ink: AMB, bg: "rgba(251,191,36,.10)", bd: "rgba(251,191,36,.28)" };
  };

  return (
    <PageContainer style={{ color: "#cbd5e1" }} data-testid="invoice-detail-source" data-invoice-detail-source={dataState}>
      <div className="flex items-center gap-3">
        <Link href="/billing" className="flex items-center gap-[6px] text-[12px] font-semibold text-[#64748b] hover:text-[#cbd5e1]" data-testid="invoice-detail-back">
          <ArrowLeft className="size-[14px]" />
          Billing
        </Link>
      </div>

      {dataState === "loading" ? (
        <div className="flex animate-pulse flex-col gap-[9px] rounded-[14px] p-4" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
          <div className="h-[14px] w-[38%] rounded-full" style={{ background: "rgba(255,255,255,.07)" }} />
          <div className="h-[10px] w-[24%] rounded-full" style={{ background: "rgba(255,255,255,.05)" }} />
        </div>
      ) : null}

      {dataState === "not-found" ? (
        <div className="flex gap-[10px] rounded-xl px-4 py-[14px]" style={{ border: "1px dashed rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }}>
          <AlertCircle className="mt-[2px] size-[15px] shrink-0" color={RED} />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-[#f8fafc]">Invoice not found</span>
            <span className="max-w-[620px] text-[12px] leading-[1.55] text-[#94a3b8]">
              This invoice does not exist, or is not on your ledger.
            </span>
          </div>
        </div>
      ) : null}

      {dataState === "error" ? (
        <div className="flex gap-[10px] rounded-xl px-4 py-[14px]" style={{ border: "1px dashed rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }}>
          <AlertCircle className="mt-[2px] size-[15px] shrink-0" color={RED} />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-[#f8fafc]">This invoice could not be read</span>
            <span className="max-w-[620px] text-[12px] leading-[1.55] text-[#94a3b8]">
              {error ?? "The read failed."} This is a failed read, not proof the invoice doesn't exist.
            </span>
            <button type="button" onClick={live.refetch} className="w-fit pt-[2px] text-left text-[11.5px] font-semibold text-[#60a5fa] hover:text-[#93c5fd]" data-testid="invoice-detail-retry">
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {dataState === "live" && detail ? (
        <>
          <div className="rounded-[14px] px-5 pb-[16px] pt-4" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[18px] font-bold text-[#f8fafc]" style={{ letterSpacing: "-.01em" }}>
                {detail.invoiceNumber}
              </span>
              {(() => {
                const s = statusStyle(detail.status);
                return (
                  <span
                    className="rounded-full px-[9px] py-[3px] text-[10.5px] font-semibold"
                    style={{ color: s.ink, background: s.bg, border: `1px solid ${s.bd}` }}
                    data-testid="invoice-detail-status"
                  >
                    {s.label}
                  </span>
                );
              })()}
              {detail.version > 1 ? (
                <span className="text-[11px] text-[#64748b]" data-testid="invoice-detail-version">
                  version {detail.version}
                </span>
              ) : null}
              <span className="ml-auto text-[20px] font-bold text-[#f8fafc]" style={{ fontVariantNumeric: "tabular-nums" }} data-testid="invoice-detail-amount">
                {detail.amountDisplay}
              </span>
            </div>

            {detail.description ? (
              <p className="mt-3 max-w-[620px] text-[12.5px] leading-[1.55] text-[#94a3b8]">{detail.description}</p>
            ) : null}
            {detail.projectTitle ? (
              <p className="mt-1 text-[11.5px] text-[#64748b]">Project: {detail.projectTitle}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t pt-3" style={{ borderColor: "rgba(255,255,255,.06)" }}>
              <div className="flex flex-col gap-[2px]">
                <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>DUE</span>
                <span className="text-[12.5px] text-[#e2e8f0]">
                  {detail.dueDate ? new Date(detail.dueDate).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—"}
                </span>
              </div>
              <div className="flex flex-col gap-[2px]">
                <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>ISSUED</span>
                <span className="text-[12.5px] text-[#e2e8f0]">
                  {detail.createdAt ? new Date(detail.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—"}
                </span>
              </div>
            </div>

            {detail.revisionReason ? (
              <div className="mt-3 rounded-[10px] px-[14px] py-[10px]" style={{ border: "1px dashed rgba(251,191,36,.4)", background: "rgba(251,191,36,.06)" }}>
                <span className="text-[11.5px] leading-[1.5] text-[#e2e8f0]">
                  <strong className="font-semibold text-[#fbbf24]">Revised: </strong>
                  {detail.revisionReason}
                </span>
              </div>
            ) : null}
          </div>

          {hasHistory ? (
            <div className="rounded-[14px] px-5 pb-[14px] pt-[6px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                className="flex w-full items-center gap-2 py-[13px] pb-2 text-left"
                data-testid="invoice-detail-history-toggle"
              >
                <span className="text-[13.5px] font-semibold text-[#f8fafc]">See what changed</span>
                <span className="text-[11px] text-[#64748b]">
                  {versions.length} version{versions.length === 1 ? "" : "s"}
                </span>
                {historyOpen ? (
                  <ChevronUp className="ml-auto size-[15px] text-[#64748b]" />
                ) : (
                  <ChevronDown className="ml-auto size-[15px] text-[#64748b]" />
                )}
              </button>

              {historyOpen ? (
                <div className="flex flex-col" data-testid="invoice-detail-history-list">
                  {[...versions].reverse().map((v) => (
                    <div key={v.id} className="flex flex-col gap-[6px] border-t py-[12px]" style={{ borderColor: "rgba(255,255,255,.06)" }}>
                      <div className="flex flex-wrap items-center gap-[8px]">
                        <span className="text-[12.5px] font-semibold text-[#e2e8f0]">Version {v.version}</span>
                        {v.isCurrent ? (
                          <span className="rounded-full px-[7px] py-[1px] text-[9.5px] font-semibold" style={{ color: GRN, background: "rgba(52,211,153,.10)", border: "1px solid rgba(52,211,153,.28)" }}>
                            Current
                          </span>
                        ) : null}
                        <span className="text-[11px] text-[#64748b]">{v.amount}</span>
                        <span className="ml-auto text-[10.5px] text-[#475569]">
                          {v.createdAt ? new Date(v.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : ""}
                        </span>
                      </div>
                      {v.revisionReason ? (
                        <span className="text-[11.5px] leading-[1.5] text-[#94a3b8]">Reason: {v.revisionReason}</span>
                      ) : null}
                      {v.diff.length > 0 ? (
                        <div className="flex flex-col gap-[3px] pl-[2px]" data-testid={`invoice-detail-diff-${v.id}`}>
                          {v.diff.map((d) => (
                            <span key={d.field} className="text-[11px] leading-[1.5] text-[#94a3b8]">
                              <span className="text-[#64748b]">{d.field}:</span> {d.from} <span className="text-[#475569]">→</span> {d.to}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </PageContainer>
  );
}
