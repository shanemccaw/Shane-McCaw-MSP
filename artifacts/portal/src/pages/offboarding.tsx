import { useState } from "react";
import { Link } from "wouter";
import { AlertCircle } from "lucide-react";
import { useOffboardingLive } from "@/components/offboardingLive";

const HAIRLINE = "rgba(255,255,255,.09)";
const CARD_BG = "rgba(255,255,255,.02)";
const GRN = "#34d399";
const RED = "#f87171";

const CONFIRM_PHRASE = "END SERVICES";

const STEPS = [
  "Recurring subscriptions are cancelled with the payment processor. One that fails to cancel is logged and skipped; the rest continue.",
  "Every active or paused service is set to paused. Completed one-off work is left as it is.",
  "Access granted through bundles is withdrawn.",
  "Your organisation is marked inactive — the same status the Overview reads, so it shows there straight away.",
];

const LEDGER = [
  {
    gap: "No cancel-by-service. The action is one call for the whole organisation; there is no per-subscription switch to draw.",
    where: "§5",
  },
  {
    gap: "No undo and no reactivate. Nothing resets an inactive organisation from the portal; the page says coming back is a conversation.",
    where: "§5 · §7",
  },
  {
    gap: "Provider-served customers get the real refusal, worded as the server words it, with the export still offered. The route is direct-business only, by design.",
    where: "§5",
  },
  {
    gap: '"Paused", not "cancelled", is what services land on. The page uses the real terminal status rather than a friendlier word the data never holds.',
    where: "§5 · §7",
  },
  {
    gap: "Nothing is deleted, and the page says so. Records are retained; the export keeps working after services end.",
    where: "§4 · §5",
  },
  { gap: "Export prices are the historical figures recorded at purchase, and are labelled as such.", where: "§6" },
  {
    gap: "The provider's own three-step offboarding (request → export → archive) is their console's flow with its own roles, and is not drawn here.",
    where: "§1–§4",
  },
  {
    gap: "A failed subscription cancellation does not stop the rest. The page states that rather than promising a clean all-or-nothing.",
    where: "§5",
  },
] as const;

/**
 * Offboarding — "Leaving" (Git #4002, part of #1653). Adapted from
 * `Design/portal/design_handoff_full_site/screens/Offboarding.dc.html` per
 * that package's README (recreate, don't ship the HTML as-is).
 *
 * Wired against `docs/offboarding-contract-pack.md` §5/§6:
 *   POST /api/portal/customer/offboard — end services (mspId === 1 only)
 *   GET  /api/portal/customer/export   — export preview + the real download
 *
 * `mspName` (the "served by <name>" copy on a brokered account) is a real
 * field this build added to `GET /api/portal/dashboard` — no route
 * previously exposed a CustomerUser's servicing MSP's display name.
 *
 * NOT wired here, matching the landed design's own "what this page
 * deliberately does not do" ledger below, not an oversight: no per-service
 * cancel, no undo/reactivate control, no MSP-side 3-step offboarding console
 * (msp/offboarding/request|export|archive — that is the provider's own
 * surface, a different Feature).
 */
export default function OffboardingPage() {
  const live = useOffboardingLive();
  const [ledgerOpen, setLedgerOpen] = useState(true);
  const [modal, setModal] = useState<"confirm" | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const { scene } = live;
  const isActive = scene === "active";
  const isBrokered = scene === "brokered";
  const isInactive = scene === "inactive";

  const affectedCount = live.affectedServices.filter((s) => s.affected).length;
  const stateLine = live.loading
    ? "Reading your account"
    : isInactive
      ? "Live — organisation inactive"
      : isBrokered
        ? `Live — served by ${live.mspName ?? "your provider"}`
        : `Live — organisation active${live.previewLoading ? "" : `, ${affectedCount} service${affectedCount === 1 ? "" : "s"}`}`;
  const stateDot = isInactive ? "#475569" : live.loading ? "#475569" : GRN;

  const closeModal = () => {
    setModal(null);
    setConfirmText("");
  };

  const handleConfirmEnd = async () => {
    if (confirmText.trim().toUpperCase() !== CONFIRM_PHRASE) return;
    await live.endServices();
    if (!live.endError) closeModal();
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 px-[26px] py-5" style={{ color: "#cbd5e1" }} data-testid="offboarding-source">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[20px] font-bold text-[#f8fafc]" style={{ letterSpacing: "-.01em" }}>
          Leaving
        </span>
        <span
          title="Take a copy of your organisation's records, then end your services. Ending them is a single, immediate action with no undo from this page."
          className="flex size-[17px] items-center justify-center rounded-full text-[10px] font-bold text-[#64748b]"
          style={{ border: "1px solid rgba(148,163,184,.35)" }}
        >
          i
        </span>
        <span className="flex items-center gap-[6px] text-[11px] text-[#64748b]">
          <span className="size-[6px] rounded-full" style={{ background: stateDot }} />
          {stateLine}
        </span>
      </div>

      {isInactive ? (
        <div
          className="flex flex-col gap-2 rounded-[14px] px-[22px] py-5"
          style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}
          data-testid="offboarding-inactive-banner"
        >
          <span className="text-[13.5px] font-semibold text-[#f8fafc]">Your services have ended</span>
          <span className="max-w-[660px] text-[12px] leading-[1.6] text-[#94a3b8]">
            Your organisation is marked inactive. Recurring subscriptions were cancelled, services were paused and
            bundle access was withdrawn. Your records are kept, and the export below still works — nothing about
            your history was deleted.
          </span>
          <span className="max-w-[660px] text-[11px] leading-[1.55] text-[#475569]">
            Coming back is a conversation with your provider; there is no button here that reactivates an
            organisation.
          </span>
        </div>
      ) : null}

      {/* Export */}
      <div
        className="flex flex-col gap-3 rounded-[14px] px-5 pb-4 pt-[15px]"
        style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13.5px] font-semibold text-[#f8fafc]">Take a copy of your records first</span>
          <span className="text-[11px] text-[#64748b]">one JSON file · every login of your organisation</span>
          {live.exportState === "idle" || live.exportState === "error" ? (
            <button
              type="button"
              onClick={live.startExport}
              className="ml-auto flex-none whitespace-nowrap rounded-md px-[13px] py-[7px] text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "#0078D4" }}
              data-testid="offboarding-download-export"
            >
              Download export
            </button>
          ) : null}
          {live.exportState === "loading" ? (
            <span
              className="ml-auto flex flex-none items-center gap-2 rounded-md px-[13px] py-[7px] text-[12px] font-semibold text-[#94a3b8]"
              style={{ border: "1px solid rgba(255,255,255,.1)" }}
            >
              <span
                className="size-[11px] rounded-full border-2"
                style={{ borderColor: "rgba(148,163,184,.3)", borderTopColor: "#94a3b8", animation: "spin .9s linear infinite" }}
              />
              Preparing…
            </span>
          ) : null}
          {live.exportState === "done" ? (
            <span className="ml-auto flex-none text-[11.5px]" style={{ color: GRN }} data-testid="offboarding-export-done">
              Downloaded · {live.exportFilename}
            </span>
          ) : null}
        </div>

        {live.exportError ? (
          <div
            className="flex items-center gap-[9px] rounded-[10px] px-[14px] py-[10px]"
            style={{ border: "1px dashed rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }}
          >
            <AlertCircle className="size-[14px] shrink-0" color={RED} />
            <span className="text-[12px] text-[#e2e8f0]">{live.exportError}</span>
          </div>
        ) : null}

        {live.previewError ? (
          <div
            className="flex items-center gap-[9px] rounded-[10px] px-[14px] py-[10px]"
            style={{ border: "1px dashed rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }}
          >
            <AlertCircle className="size-[14px] shrink-0" color={RED} />
            <span className="text-[12px] text-[#e2e8f0]">Could not read what the export would contain.</span>
          </div>
        ) : (
          <div
            className="grid gap-3 border-t pt-3"
            style={{ borderColor: "rgba(255,255,255,.06)", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" }}
          >
            {live.exportBlocks.map((b) => (
              <div key={b.label} className="flex flex-col gap-[3px]">
                <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
                  {b.label}
                </span>
                <span className="text-[12.5px] text-[#e2e8f0]">{live.previewLoading ? "…" : b.count}</span>
                <span className="text-[10.5px] leading-[1.45] text-[#64748b]">{b.what}</span>
              </div>
            ))}
          </div>
        )}
        <span className="max-w-[680px] text-[11px] leading-[1.55] text-[#475569]">
          The export is a snapshot of what you bought and what was measured, as recorded at the time. Prices on past
          services are the historical figures, not a live quote. Signed contracts and invoices are also under
          Privacy and your data, which exports more.
        </span>
      </div>

      {/* End services */}
      {isActive ? (
        <div
          className="flex flex-col gap-3 rounded-[14px] px-5 pb-4 pt-[15px]"
          style={{ border: "1px solid rgba(248,113,113,.25)", background: "rgba(248,113,113,.03)" }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[13.5px] font-semibold text-[#f8fafc]">End your services</span>
            <span
              className="rounded-full px-[9px] py-[3px] text-[10px] font-semibold"
              style={{ color: RED, background: "rgba(248,113,113,.10)", border: "1px solid rgba(248,113,113,.3)" }}
            >
              Immediate · no undo here
            </span>
          </div>
          <span className="max-w-[680px] text-[12px] leading-[1.6] text-[#94a3b8]">
            One action, applied to your whole organisation the moment you confirm. Your provider is notified and the
            action is recorded twice — once on your account's audit trail and once on theirs.
          </span>

          <div className="flex flex-col gap-[7px] border-t pt-3" style={{ borderColor: "rgba(255,255,255,.06)" }}>
            <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
              WHAT HAPPENS, IN ORDER
            </span>
            {STEPS.map((t, i) => (
              <div key={i} className="flex items-start gap-[10px]">
                <span className="mt-[2px] w-3 flex-none text-[10.5px] font-bold text-[#64748b]">{i + 1}</span>
                <span className="text-[12px] leading-[1.55] text-[#cbd5e1]">{t}</span>
              </div>
            ))}
          </div>

          {live.affectedServices.length > 0 ? (
            <div className="flex flex-col gap-[6px] border-t pt-3" style={{ borderColor: "rgba(255,255,255,.06)" }}>
              <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
                AFFECTED NOW
              </span>
              {live.affectedServices.map((sv, i) => (
                <div key={i} className="flex items-center gap-[10px]" data-testid="offboarding-affected-service">
                  <span className="flex-1 text-[12px] text-[#e2e8f0]">{sv.name}</span>
                  <span className="text-[10.5px] text-[#94a3b8]">{sv.billing}</span>
                  <span
                    className="rounded-full px-2 py-[2px] text-[10px] font-semibold"
                    style={{ color: sv.ink, background: sv.bg, border: `1px solid ${sv.bd}` }}
                  >
                    {sv.status}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {live.endError ? (
            <div
              className="flex items-center gap-[9px] rounded-[10px] px-[14px] py-[10px]"
              style={{ border: "1px dashed rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }}
            >
              <AlertCircle className="size-[14px] shrink-0" color={RED} />
              <span className="text-[12px] text-[#e2e8f0]">{live.endError}</span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-[11px] border-t pt-3" style={{ borderColor: "rgba(255,255,255,.06)" }}>
            <span className="max-w-[520px] text-[11.5px] leading-[1.55] text-[#94a3b8]">
              Nothing is deleted. Your records, reports and history stay readable, and the export above keeps working
              afterwards.
            </span>
            <button
              type="button"
              onClick={() => setModal("confirm")}
              className="ml-auto flex-none whitespace-nowrap rounded-md px-[14px] py-2 text-[12px] font-semibold"
              style={{ color: RED, border: "1px solid rgba(248,113,113,.4)" }}
              data-testid="offboarding-arm"
            >
              End services…
            </button>
          </div>
        </div>
      ) : null}

      {/* Brokered */}
      {isBrokered ? (
        <div
          className="flex flex-col gap-[10px] rounded-[14px] px-5 pb-4 pt-[15px]"
          style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}
        >
          <span className="text-[13.5px] font-semibold text-[#f8fafc]">Ending your services goes through your provider</span>
          <span className="max-w-[680px] text-[12px] leading-[1.6] text-[#94a3b8]">
            Your organisation is served by{" "}
            <span className="font-semibold text-[#e2e8f0]">{live.mspName ?? "your provider"}</span>, not directly by
            the platform, so the self-service cancellation here is not available to you. The platform refuses it for
            every provider-served customer, by design — your contract and its notice terms are with your provider.
          </span>
          <span className="text-[11px]" style={{ color: RED, fontFamily: "ui-monospace, Menlo, monospace" }}>
            403 · Customer offboarding is only available for Shane McCaw Consulting customers.
          </span>
          <div className="flex flex-wrap items-center gap-[11px] border-t pt-3" style={{ borderColor: "rgba(255,255,255,.06)" }}>
            <span className="max-w-[520px] text-[11.5px] leading-[1.55] text-[#94a3b8]">
              The export above still works for you — take your copy, then contact your provider to end the services.
            </span>
            <Link
              href="/support"
              className="ml-auto flex-none whitespace-nowrap rounded-md px-[14px] py-2 text-[12px] font-semibold text-[#cbd5e1] hover:bg-white/[.05]"
              style={{ border: "1px solid rgba(255,255,255,.14)" }}
              data-testid="offboarding-contact-provider"
            >
              Contact {live.mspName ?? "your provider"}
            </Link>
          </div>
        </div>
      ) : null}

      {/* Ledger */}
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
            data-testid="offboarding-ledger-toggle"
          >
            {ledgerOpen ? "Collapse" : "Expand"}
          </button>
        </div>
        {ledgerOpen ? (
          <div className="flex flex-col">
            {LEDGER.map((l) => (
              <div key={l.where + l.gap} className="flex items-start gap-3 border-t py-2" style={{ borderColor: "rgba(255,255,255,.05)" }}>
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

      {/* Confirm modal */}
      {modal === "confirm" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(2,6,23,.72)" }}
          onClick={closeModal}
          data-testid="offboarding-confirm-modal"
        >
          <div
            className="flex w-[480px] max-w-full flex-col gap-[11px] rounded-2xl px-[22px] pb-[18px] pt-5"
            style={{ background: "#0b1120", border: "1px solid rgba(255,255,255,.12)", boxShadow: "0 24px 64px rgba(0,0,0,.6)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-[14.5px] font-bold text-[#f8fafc]">
              End all services for {live.exportBlocks[0]?.count ?? "your organisation"}?
            </span>
            <span className="text-[12.5px] leading-[1.6] text-[#94a3b8]">
              Recurring subscriptions are cancelled with the payment processor, every active or paused service is set
              to paused, bundle access is withdrawn and your organisation is marked inactive. This happens
              immediately and cannot be reversed from this page.
            </span>
            <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
              TYPE {CONFIRM_PHRASE} TO CONFIRM
            </span>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_PHRASE}
              autoComplete="off"
              className="rounded-md px-[11px] py-2 text-[12.5px] text-[#e2e8f0]"
              style={{ border: "1px solid rgba(248,113,113,.4)", background: "rgba(255,255,255,.02)", fontFamily: "ui-monospace, Menlo, monospace" }}
              data-testid="offboarding-confirm-input"
            />
            <span className="text-[11.5px] leading-[1.55]" style={{ color: "#c2a63d" }}>
              Records are kept. If a subscription cannot be cancelled with the processor, the rest still proceeds and
              the failure is logged for your provider.
            </span>
            <div className="flex items-center gap-[9px] border-t pt-3" style={{ borderColor: "rgba(255,255,255,.08)" }}>
              <button
                type="button"
                onClick={closeModal}
                disabled={live.ending}
                className="ml-auto rounded-md px-[14px] py-2 text-[12px] font-semibold text-[#cbd5e1] hover:bg-white/[.05]"
                style={{ border: "1px solid rgba(255,255,255,.14)" }}
              >
                Keep my services
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmEnd()}
                disabled={live.ending || confirmText.trim().toUpperCase() !== CONFIRM_PHRASE}
                className="rounded-md px-[14px] py-2 text-[12px] font-semibold text-white disabled:opacity-40"
                style={{ background: "#dc2626" }}
                data-testid="offboarding-confirm-go"
              >
                {live.ending ? "Ending…" : "End services now"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
