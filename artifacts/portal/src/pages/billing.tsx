import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { useBillingLive } from "@/components/billingLive";

const HAIRLINE = "rgba(255,255,255,.09)";
const CARD_BG = "rgba(255,255,255,.02)";
const GRN = "#34d399";
const AMB = "#fbbf24";
const RED = "#f87171";

/**
 * Billing (#2998, part of #1598). Adapted from
 * `Design/portal/design_handoff_full_site/screens/Billing.dc.html` per that
 * package's README ("recreate these designs... using this codebase's
 * existing... patterns, not ship the HTML files as-is").
 *
 * Wired this pass, per `docs/billing-contract-pack.md`: Receipts
 * (`GET /api/portal/invoices`, Git #1237) and "Manage payment in Stripe"
 * (`POST /api/portal/billing/customer-portal`) via `billingLive.ts`.
 *
 * Deliberately NOT wired — matching the landed design's own "what this page
 * deliberately does not do" copy, not an oversight:
 *  - No live plan state. `subscriptionsLive.ts` / `GET /portal/billing/
 *    subscriptions` (Git #1611) is real and built, but the design's own
 *    logic states plainly why it stays off this page: no tenant holds a
 *    monthly monitoring subscription today, so there is nothing real to show
 *    as a current plan. Wiring it in would either render permanently empty
 *    or require inventing plan-state UI the landed design doesn't carry.
 *  - Monitoring-plan tier cards carry no live price — seat-metered, no flat
 *    number exists to wire to (#1594, blocked on #1128). Shown here exactly
 *    as the design's own labeled illustration, not tenant data.
 *  - No interval / tier-switch / add-on toggles — the design's own
 *    hypothetical-repricing calculator, explicitly out of scope.
 *  - No pay-invoice, invoice-detail, or card-details surface on this page.
 */
export default function BillingPage() {
  const live = useBillingLive();
  const [ledgerOpen, setLedgerOpen] = useState(true);
  const [askOpen, setAskOpen] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { dataState } = live;
  const isLoading = dataState === "loading";
  const isFixture = dataState === "fixture";
  const isLive = dataState === "live";
  const hasReceipts = isLive && live.receipts.length > 0;
  const noReceipts = isLive && live.receipts.length === 0;

  const stateLine = isLoading
    ? "Reading your billing history"
    : isFixture
      ? "Could not read your billing history"
      : noReceipts
        ? "Live — no invoices on your ledger"
        : `Live — ${live.receipts.length} invoice${live.receipts.length === 1 ? "" : "s"}`;
  const stateDot = isFixture ? RED : isLoading ? "#475569" : GRN;
  const stateInk = isFixture ? RED : "#64748b";

  const handleOpenStripe = () => {
    setPortalError(null);
    void live.openStripePortal().then((err) => {
      if (err) setPortalError(err);
    });
  };

  const handleDownload = (id: number) => {
    setDownloadError(null);
    void live.downloadReceipt(id).then((err) => {
      if (err) setDownloadError(err);
    });
  };

  return (
    <div
      className="flex min-w-0 flex-1 flex-col gap-4 px-[26px] py-5"
      style={{ color: "#cbd5e1" }}
      data-testid="billing-source"
      data-billing-source={dataState}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[20px] font-bold text-[#f8fafc]" style={{ letterSpacing: "-.01em" }}>
          Billing
        </span>
        <span
          title="What you have been charged, and where to change your payment details. This page shows money only — hours live on My Architect."
          className="flex size-[17px] items-center justify-center rounded-full text-[10px] font-bold text-[#64748b]"
          style={{ border: "1px solid rgba(148,163,184,.35)" }}
        >
          i
        </span>
        <span className="flex items-center gap-[6px] text-[11px]" style={{ color: stateInk }}>
          <span className="size-[6px] rounded-full" style={{ background: stateDot }} />
          {stateLine}
        </span>
        <button
          type="button"
          onClick={handleOpenStripe}
          disabled={live.openingPortal}
          className="ml-auto whitespace-nowrap rounded-md px-[14px] py-[8px] text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: "#0078D4" }}
          data-testid="billing-manage-payment"
        >
          {live.openingPortal ? "Opening…" : "Manage payment in Stripe"}
        </button>
      </div>

      {portalError ? (
        <div
          className="flex items-center gap-[9px] rounded-[10px] px-[14px] py-[10px]"
          style={{ border: "1px dashed rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }}
        >
          <AlertCircle className="size-[14px] shrink-0" color={RED} />
          <span className="text-[12px] text-[#e2e8f0]">{portalError}</span>
        </div>
      ) : null}
      {downloadError ? (
        <div
          className="flex items-center gap-[9px] rounded-[10px] px-[14px] py-[10px]"
          style={{ border: "1px dashed rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }}
        >
          <AlertCircle className="size-[14px] shrink-0" color={RED} />
          <span className="text-[12px] text-[#e2e8f0]">{downloadError}</span>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex flex-col gap-[10px]">
          {[
            { w1: "34%", w2: "58%" },
            { w1: "28%", w2: "46%" },
            { w1: "31%", w2: "52%" },
            { w1: "26%", w2: "44%" },
          ].map((s, i) => (
            <div
              key={i}
              className="flex animate-pulse flex-col gap-[9px] rounded-[14px] p-4"
              style={{ border: `1px solid rgba(255,255,255,.07)`, background: "rgba(255,255,255,.02)" }}
            >
              <div className="h-[10px] rounded-full" style={{ width: s.w1, background: "rgba(255,255,255,.07)" }} />
              <div className="h-[9px] rounded-full" style={{ width: s.w2, background: "rgba(255,255,255,.05)" }} />
            </div>
          ))}
        </div>
      ) : null}

      {isFixture ? (
        <div
          className="flex gap-[10px] rounded-xl px-4 py-[14px]"
          style={{ border: "1px dashed rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }}
        >
          <AlertCircle className="mt-[2px] size-[15px] shrink-0" color={RED} />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-[#f8fafc]">Your billing history could not be read</span>
            <span className="max-w-[620px] text-[12px] leading-[1.55] text-[#94a3b8]">
              This is a failed read, not a clean ledger. You may well have invoices — nothing is listed below because
              nothing could be fetched, and we would rather show you that than an empty table you would read as
              "never charged".
            </span>
            <button
              type="button"
              onClick={live.refetch}
              className="w-fit pt-[2px] text-left text-[11.5px] font-semibold text-[#60a5fa] hover:text-[#93c5fd]"
              data-testid="billing-retry"
            >
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {isLive ? (
        <>
          <div className="rounded-[14px] px-5 pb-[14px] pt-[6px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
            <div className="flex flex-wrap items-center gap-3 py-[13px] pb-2">
              <span className="text-[13.5px] font-semibold text-[#f8fafc]">Receipts</span>
              <span className="text-[11px] text-[#64748b]">
                {noReceipts ? "your ledger, read successfully" : "newest first · every invoice on your ledger"}
              </span>
            </div>

            {noReceipts ? (
              <div className="flex flex-col gap-[6px] border-t py-[22px] pb-2" style={{ borderColor: "rgba(255,255,255,.06)" }}>
                <span className="text-[13px] font-semibold text-[#f8fafc]">You have never been invoiced</span>
                <span className="max-w-[620px] text-[12px] leading-[1.6] text-[#94a3b8]">
                  This is a real, successful read of your billing ledger: it holds no invoices for you. An empty
                  ledger and a ledger we could not reach are different answers, and this is the first one.
                </span>
              </div>
            ) : null}

            {hasReceipts ? (
              <>
                <div className="flex items-center gap-3 pb-[5px]">
                  <span className="w-[78px] shrink-0 text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
                    DATE
                  </span>
                  <span className="min-w-0 flex-1 text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
                    WHAT FOR
                  </span>
                  <span className="w-[74px] shrink-0 text-right text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
                    AMOUNT
                  </span>
                  <span className="w-[66px] shrink-0 text-center text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
                    STATUS
                  </span>
                  <span className="w-[70px] shrink-0" />
                </div>
                {live.receipts.map((r) => {
                  const status = r.paid
                    ? { label: "Paid", ink: GRN, bg: "rgba(52,211,153,.10)", bd: "rgba(52,211,153,.28)" }
                    : { label: "Pending", ink: AMB, bg: "rgba(251,191,36,.10)", bd: "rgba(251,191,36,.28)" };
                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 border-t py-[10px]"
                      style={{ borderColor: "rgba(255,255,255,.06)" }}
                      data-testid="billing-receipt-row"
                    >
                      <span className="w-[78px] shrink-0 whitespace-nowrap text-[11.5px] text-[#94a3b8]">{r.date}</span>
                      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                        <span className="text-[12.5px] leading-[1.4] text-[#e2e8f0]">{r.what}</span>
                        <span
                          className="overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] text-[#64748b]"
                          style={{ fontFamily: "ui-monospace, Menlo, monospace" }}
                        >
                          {r.ref}
                        </span>
                      </div>
                      <span
                        className="w-[74px] shrink-0 whitespace-nowrap text-right text-[12.5px] text-[#e2e8f0]"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {r.amount}
                      </span>
                      <span
                        className="w-[66px] shrink-0 rounded-full py-[3px] text-center text-[10px] font-semibold"
                        style={{ color: status.ink, background: status.bg, border: `1px solid ${status.bd}` }}
                      >
                        {status.label}
                      </span>
                      {r.downloadable ? (
                        <button
                          type="button"
                          onClick={() => handleDownload(r.id)}
                          className="w-[70px] shrink-0 whitespace-nowrap rounded-md py-[5px] text-center text-[11px] font-semibold text-[#cbd5e1] hover:bg-white/[.05]"
                          style={{ border: "1px solid rgba(255,255,255,.14)" }}
                          data-testid={`billing-download-${r.id}`}
                        >
                          Receipt
                        </button>
                      ) : (
                        <span
                          title="No PDF was ever generated for this invoice, so there is nothing to download. The charge itself is real."
                          className="w-[70px] shrink-0 cursor-help text-center text-[10.5px] text-[#475569]"
                        >
                          No PDF
                        </span>
                      )}
                    </div>
                  );
                })}
                <span
                  className="mt-[2px] block border-t pt-[10px] text-[10.5px] leading-[1.55] text-[#475569]"
                  style={{ borderColor: "rgba(255,255,255,.06)" }}
                >
                  One invoice with an unusable reference was dropped rather than listed as a row you could not open.
                  Amounts are shown exactly as billed.
                </span>
              </>
            ) : null}
          </div>

          <div
            className="flex flex-col gap-[11px] rounded-[14px] px-5 pb-[15px] pt-[15px]"
            style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}
          >
            <span className="text-[13.5px] font-semibold text-[#f8fafc]">Your payment details</span>
            <span className="max-w-[660px] text-[12px] leading-[1.6] text-[#94a3b8]">
              Cards, billing address and past Stripe invoices are held by Stripe, not by this portal. The button
              above opens your own Stripe billing portal, where changing a card or downloading a Stripe invoice
              takes effect immediately.
            </span>
            <span className="max-w-[660px] text-[11px] leading-[1.55] text-[#475569]">
              A receipt in the list above and a Stripe invoice are not always the same document — the two ledgers do
              not hold identical sets, so a charge may appear in one and not the other.
            </span>
          </div>

          <div
            className="flex flex-col gap-3 rounded-[14px] px-5 pb-[15px] pt-[15px]"
            style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}
          >
            <div className="flex flex-wrap items-baseline gap-[10px]">
              <span className="text-[13.5px] font-semibold text-[#f8fafc]">Monitoring plans</span>
              <span
                className="rounded-full px-[9px] py-[3px] text-[10px] font-semibold"
                style={{ color: "#c2a63d", background: "rgba(194,166,61,.10)", border: "1px solid rgba(194,166,61,.30)" }}
              >
                Illustrative, not your account
              </span>
            </div>
            <span className="max-w-[680px] text-[12px] leading-[1.6] text-[#94a3b8]">
              These three tiers are what monitoring looks like as a shape. They are not read from your account and
              they are not quotes. Monitoring is priced per seat rather than at a flat monthly figure, so no card
              below can honestly show a price — and no tenant currently holds a monthly monitoring subscription for
              this page to read a live plan state from.
            </span>
            <div className="flex flex-wrap gap-[11px]">
              {MONITORING_TIERS.map((t) => (
                <div
                  key={t.name}
                  className="flex flex-1 flex-col gap-2 rounded-xl px-[15px] pb-[13px] pt-[14px]"
                  style={{ minWidth: "min(210px, 100%)", border: `1px solid ${t.bd}`, background: t.bg }}
                >
                  <span className="text-[13px] font-bold text-[#f8fafc]">{t.name}</span>
                  <span className="text-[12px] leading-[1.45] text-[#94a3b8]">{t.price}</span>
                  <div className="flex flex-col gap-[5px] pt-[2px]">
                    {t.lines.map((l) => (
                      <span key={l} className="text-[11.5px] leading-[1.5] text-[#94a3b8]">
                        {l}
                      </span>
                    ))}
                  </div>
                  <span className="mt-auto pt-1 text-[10.5px] leading-[1.5] text-[#475569]">{t.foot}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-[11px] border-t pt-3" style={{ borderColor: "rgba(255,255,255,.07)" }}>
              <span className="max-w-[520px] text-[11.5px] leading-[1.55] text-[#94a3b8]">
                Switching tier, changing to annual billing or adding an option are all conversations with your MSP
                rather than buttons here — a control that repriced a hypothetical would look like it was changing
                what you pay.
              </span>
              <button
                type="button"
                onClick={() => setAskOpen(true)}
                className="ml-auto whitespace-nowrap rounded-md px-[14px] py-[8px] text-[12px] font-semibold text-[#cbd5e1] hover:bg-white/[.04]"
                style={{ border: "1px solid rgba(255,255,255,.14)" }}
                data-testid="billing-ask-monitoring"
              >
                Ask about monitoring
              </button>
            </div>
          </div>
        </>
      ) : null}

      <div
        className="flex flex-col gap-[9px] rounded-[14px] px-5 pb-[15px] pt-4"
        style={{ border: "1px solid rgba(255,255,255,.07)", background: "rgba(255,255,255,.015)" }}
      >
        <div className="flex items-baseline gap-[10px]">
          <span className="text-[13px] font-semibold text-[#f8fafc]">What this page deliberately does not do</span>
          <button
            type="button"
            onClick={() => setLedgerOpen((v) => !v)}
            className="ml-auto text-[11.5px] font-semibold text-[#64748b] hover:text-[#cbd5e1]"
            data-testid="billing-ledger-toggle"
          >
            {ledgerOpen ? "Collapse" : "Expand"}
          </button>
        </div>
        {ledgerOpen ? (
          <div className="flex flex-col">
            {LEDGER.map((l) => (
              <div key={l.where} className="flex items-start gap-3 border-t py-2" style={{ borderColor: "rgba(255,255,255,.05)" }}>
                <span className="min-w-0 flex-1 text-[11.5px] leading-[1.5] text-[#cbd5e1]">{l.gap}</span>
                <span
                  className="shrink-0 whitespace-nowrap text-[10.5px] text-[#475569]"
                  style={{ fontFamily: "ui-monospace, Menlo, monospace" }}
                >
                  {l.where}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {askOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(2,6,23,.72)" }}
          onClick={() => setAskOpen(false)}
        >
          <div
            className="flex w-[470px] max-w-full flex-col gap-[11px] rounded-2xl px-[22px] pb-[18px] pt-5"
            style={{ background: "#0b1120", border: "1px solid rgba(255,255,255,.12)", boxShadow: "0 24px 64px rgba(0,0,0,.6)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-[14.5px] font-bold text-[#f8fafc]">Ask about monitoring</span>
            <span className="text-[12.5px] leading-[1.6] text-[#94a3b8]">
              Monitoring is priced per seat, so a quote depends on your seat count on the day. Your MSP prices it
              against your tenant rather than a card on this page.
            </span>
            <span className="text-[11.5px] leading-[1.55]" style={{ color: "#c2a63d" }}>
              No pricing shown on this page is a quote, and nothing here can start or change a plan.
            </span>
            <div className="flex items-center gap-[9px] border-t pt-3" style={{ borderColor: "rgba(255,255,255,.08)" }}>
              <button
                type="button"
                onClick={() => setAskOpen(false)}
                className="ml-auto rounded-md px-[14px] py-[8px] text-[12px] font-semibold text-white"
                style={{ background: "#0078D4" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const MONITORING_TIERS = [
  {
    name: "Foundation",
    price: "Priced per seat",
    bd: "rgba(255,255,255,.09)",
    bg: "rgba(255,255,255,.015)",
    lines: ["Drift and security signals, hourly", "Monthly written summary", "Business-hours response"],
    foot: "No flat monthly figure exists to show.",
  },
  {
    name: "Growth",
    price: "Priced per seat",
    bd: "rgba(0,120,212,.35)",
    bg: "rgba(0,120,212,.04)",
    lines: ["All six signal engines", "Change control and remediation tracking", "Named architect contact"],
    foot: "No flat monthly figure exists to show.",
  },
  {
    name: "Premier",
    price: "Priced per seat",
    bd: "rgba(255,255,255,.09)",
    bg: "rgba(255,255,255,.015)",
    lines: ["Everything in Growth", "Signed security plan each quarter", "Out-of-hours escalation"],
    foot: "Its monthly rate is unsettled internally, so none is quoted.",
  },
] as const;

const LEDGER = [
  {
    gap: "No prices on the monitoring cards. Monitoring is metered per seat and carries no flat monthly figure, so a number there would be invented.",
    where: "§8.1",
  },
  {
    gap: "No tier switch, no annual toggle, no add-on picker. A control that repriced a hypothetical would read as changing what you pay.",
    where: "§8.2",
  },
  {
    gap: "No live plan state. No tenant holds a monthly monitoring subscription today, so there is nothing real to show as your current plan.",
    where: "§1.6",
  },
  {
    gap: "No pay button on a receipt. Paying an invoice from the portal is built but not surfaced here; the button on each row downloads the PDF.",
    where: "§1.3",
  },
  {
    gap: "No invoice detail page. The endpoint exists and is unused — a receipt opens its PDF rather than a screen.",
    where: "§1.2",
  },
  {
    gap: "No card details on this page. Cards and billing address live with Stripe, reached through the button at the top.",
    where: "§1.6",
  },
  {
    gap: "No fake rows when the read fails. A failed fetch says so; an empty ledger says that instead, and the two never share a state.",
    where: "§5",
  },
  {
    gap: "No retainer rate. Hours and their rate belong to My Architect, and this page shows money only from the invoice ledger.",
    where: "§7",
  },
  {
    gap: "No download where no PDF was stored. A receipt without a file shows why rather than a link that would 404.",
    where: "§1.4",
  },
] as const;
