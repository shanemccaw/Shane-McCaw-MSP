import { useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useDataRightsPrivacyLive } from "@/components/data-rights-privacy/useDataRightsPrivacyLive";

const HAIRLINE = "rgba(255,255,255,.09)";
const CARD_BG = "rgba(255,255,255,.02)";
const GRN = "#34d399";
const RED = "#f87171";

const CONFIRM_PHRASE = "DELETE";

/**
 * Privacy and your data (#4005, part of #1652). Shane's call, 2026-09-14:
 * this gets its own standalone page rather than folding into Account
 * Security (reversing the 2026-09-03 fold-in decision, #1604/#1595, both
 * closed). Recreated from
 * `Design/portal/design_handoff_full_site/screens/Data Rights and Privacy.dc.html`
 * per that package's README, against
 * `docs/data-rights-and-privacy-contract-pack.md` (#2549).
 *
 * Both endpoints wired here (`GET /api/portal/data-export`,
 * `POST /api/portal/deletion-request`) are the exact same ones Account
 * Security's "Your data" section already calls (#2996) — the design's own §5
 * calls this "one deletion path, two doors" and links back to Account
 * Security for closing the login itself rather than restating it.
 *
 * The two static description blocks below ("Your account and its history" /
 * "What monitoring has recorded about your tenant") are literal copy from
 * the design, not data — they describe the fixed shape of the real
 * export/deletion contract, not customer-specific values. (The design also
 * carried an internal "what this page deliberately does not do" disclosure
 * here; removed from the customer-facing render per #4451.)
 */
/**
 * Split out from the page wrapper below so the consolidated Settings page
 * (#1736) can mount it as one tab without re-wiring the fetch logic — same
 * pattern as NotificationPreferencesContent / WebhooksContent.
 */
export function DataRightsAndPrivacyContent() {
  const { user } = useAuth();
  const live = useDataRightsPrivacyLive();
  const [armed, setArmed] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  function disarm() {
    setArmed(false);
    setConfirmText("");
    live.resetDeletion();
  }

  const ready = confirmText.trim().toUpperCase() === CONFIRM_PHRASE;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 px-[26px] py-5" style={{ color: "#cbd5e1" }} data-testid="data-rights-and-privacy-page">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[20px] font-bold text-[#f8fafc]" style={{ letterSpacing: "-.01em" }}>
          Privacy and your data
        </span>
        <span
          title="Two rights, two actions: take a copy of everything the platform holds about your organisation, or ask for it to be deleted. Both act on the whole account; neither is selective."
          className="flex size-[17px] items-center justify-center rounded-full text-[10px] font-bold text-[#64748b]"
          style={{ border: "1px solid rgba(148,163,184,.35)" }}
        >
          i
        </span>
        <span className="flex items-center gap-[6px] text-[11px] text-[#64748b]">
          <span className="size-[6px] rounded-full" style={{ background: GRN }} />
          Live · acts on your own account{user?.email ? `, ${user.email}` : ""}
        </span>
      </div>

      {/* Export */}
      <div className="flex flex-col gap-3 rounded-[14px] px-5 pb-4 pt-[15px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13.5px] font-semibold text-[#f8fafc]">Download a copy of your data</span>
          <span className="text-[11px] text-[#64748b]">one JSON file · export format 2</span>
          {live.exportState === "idle" ? (
            <button
              type="button"
              onClick={() => void live.startExport()}
              className="ml-auto shrink-0 whitespace-nowrap rounded-md px-[13px] py-[7px] text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "#0078D4" }}
              data-testid="data-rights-prepare-export"
            >
              Prepare export
            </button>
          ) : null}
          {live.exportState === "loading" ? (
            <span className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-[13px] py-[7px] text-[12px] font-semibold text-[#94a3b8]" style={{ border: "1px solid rgba(255,255,255,.1)" }}>
              <span className="size-[11px] animate-spin rounded-full border-2" style={{ borderColor: "rgba(148,163,184,.3)", borderTopColor: "#94a3b8" }} />
              Preparing export…
            </span>
          ) : null}
          {live.exportState === "done" ? (
            <button
              type="button"
              onClick={live.resetExport}
              className="ml-auto shrink-0 whitespace-nowrap rounded-md px-[13px] py-[7px] text-[12px] font-semibold text-[#cbd5e1] transition-colors hover:bg-white/[.05]"
              style={{ border: "1px solid rgba(255,255,255,.14)" }}
              data-testid="data-rights-prepare-another-export"
            >
              Prepare another
            </button>
          ) : null}
          {live.exportState === "error" ? (
            <button
              type="button"
              onClick={live.resetExport}
              className="ml-auto shrink-0 whitespace-nowrap rounded-md px-[13px] py-[7px] text-[12px] font-semibold text-[#cbd5e1] transition-colors hover:bg-white/[.05]"
              style={{ border: "1px solid rgba(255,255,255,.14)" }}
              data-testid="data-rights-export-try-again"
            >
              Try again
            </button>
          ) : null}
        </div>

        {live.exportState === "done" ? (
          <div className="flex items-start gap-[10px] rounded-xl px-[14px] py-3" style={{ border: "1px solid rgba(52,211,153,.25)", background: "rgba(52,211,153,.06)" }} data-testid="data-rights-export-done">
            <CheckCircle2 className="mt-[2px] size-[15px] shrink-0" color={GRN} />
            <div className="flex flex-col gap-[3px]">
              <span className="text-[12.5px] font-semibold text-[#f8fafc]">Your export downloaded</span>
              <span className="text-[11.5px] text-[#94a3b8]" style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{live.exportFilename}</span>
              <span className="text-[11px] leading-[1.5] text-[#64748b]">
                Each download is recorded on your account's audit trail, and your provider can see that a copy was taken.
              </span>
            </div>
          </div>
        ) : null}
        {live.exportState === "error" ? (
          <div className="flex items-start gap-[10px] rounded-xl px-[14px] py-3" style={{ border: "1px dashed rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }} data-testid="data-rights-export-error">
            <AlertCircle className="mt-[2px] size-[15px] shrink-0" color={RED} />
            <div className="flex flex-col gap-[3px]">
              <span className="text-[12.5px] font-semibold text-[#f8fafc]">Failed to generate data export</span>
              <span className="text-[11px] leading-[1.5] text-[#94a3b8]">{live.exportError}</span>
            </div>
          </div>
        ) : null}

        <span className="max-w-[680px] text-[12px] leading-[1.6] text-[#94a3b8]">
          Everything is gathered at the moment you ask and served as one file — no email, no waiting. It covers every
          login that shares your organisation, because projects, invoices and messages belong to the organisation,
          not to one person's sign-in.
        </span>

        <div className="grid gap-[14px] border-t pt-3" style={{ borderColor: "rgba(255,255,255,.06)", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,280px),1fr))" }}>
          <div className="flex flex-col gap-[7px]">
            <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>YOUR ACCOUNT AND ITS HISTORY</span>
            {LEGACY_BLOCKS.map((b) => (
              <div key={b.name} className="flex items-baseline gap-[10px]">
                <span className="w-[118px] shrink-0 text-[11.5px] text-[#e2e8f0]">{b.name}</span>
                <span className="text-[11px] leading-[1.5] text-[#64748b]">{b.what}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-[7px]">
            <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>WHAT MONITORING HAS RECORDED ABOUT YOUR TENANT</span>
            {SCHEMA_BLOCKS.map((b) => (
              <div key={b.name} className="flex items-baseline gap-[10px]">
                <span className="w-[118px] shrink-0 text-[11.5px] text-[#e2e8f0]">{b.name}</span>
                <span className="text-[11px] leading-[1.5] text-[#64748b]">{b.what}</span>
              </div>
            ))}
            <span className="pt-[2px] text-[10.5px] leading-[1.5] text-[#475569]">
              Large histories are capped at the newest 2,000 rows each; audit activity at the newest 500. An
              organisation with nothing recorded gets empty lists, not placeholders.
            </span>
          </div>
        </div>
      </div>

      {/* Deletion */}
      <div className="flex flex-col gap-3 rounded-[14px] px-5 pb-4 pt-[15px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13.5px] font-semibold text-[#f8fafc]">Ask for your data to be deleted</span>
          <span className="text-[11px] text-[#64748b]">whole account · processed by a person within 30 days</span>
        </div>

        {live.deletionState === "idle" ? (
          <>
            <span className="max-w-[680px] text-[12px] leading-[1.6] text-[#94a3b8]">
              This sends a request to your provider's operator. It does not delete anything itself — erasure is
              carried out by a person, and the request is recorded on your account's audit trail so it cannot go
              missing.
            </span>
            <div className="flex flex-col gap-[6px] border-t pt-3" style={{ borderColor: "rgba(255,255,255,.06)" }}>
              <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>KEPT REGARDLESS · LEGAL RETENTION</span>
              <span className="max-w-[680px] text-[12px] leading-[1.55] text-[#cbd5e1]">
                Signed contracts and invoices are retained for 7 years as required by law. Everything else is in scope.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-[11px] border-t pt-3" style={{ borderColor: "rgba(255,255,255,.06)" }}>
              {!armed ? (
                <>
                  <span className="max-w-[520px] text-[11.5px] leading-[1.55] text-[#94a3b8]">
                    Once submitted there is nothing to look up here later — the page will tell you it was received,
                    and the rest happens by email from a person.
                  </span>
                  <button
                    type="button"
                    onClick={() => setArmed(true)}
                    className="ml-auto shrink-0 whitespace-nowrap rounded-md px-[13px] py-[7px] text-[12px] font-semibold"
                    style={{ color: RED, border: "1px solid rgba(248,113,113,.4)" }}
                    data-testid="data-rights-request-deletion"
                  >
                    Request deletion…
                  </button>
                </>
              ) : (
                <>
                  <div className="flex min-w-[260px] flex-1 flex-col gap-2">
                    <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
                      TYPE {CONFIRM_PHRASE} TO CONFIRM
                    </span>
                    <input
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={CONFIRM_PHRASE}
                      className="max-w-[220px] rounded-md px-[11px] py-2 text-[12.5px] outline-none"
                      style={{ border: "1px solid rgba(248,113,113,.4)", background: "rgba(255,255,255,.02)", color: "#e2e8f0", fontFamily: "ui-monospace, Menlo, monospace" }}
                      data-testid="data-rights-confirm-input"
                    />
                  </div>
                  <div className="ml-auto flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setArmed(false);
                        setConfirmText("");
                      }}
                      className="whitespace-nowrap rounded-md px-[13px] py-[7px] text-[12px] font-semibold text-[#cbd5e1] transition-colors hover:bg-white/[.05]"
                      style={{ border: "1px solid rgba(255,255,255,.14)" }}
                      data-testid="data-rights-cancel-deletion"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!ready}
                      onClick={() => {
                        setArmed(false);
                        void live.submitDeletion();
                      }}
                      className="whitespace-nowrap rounded-md px-[13px] py-[7px] text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ background: RED }}
                      data-testid="data-rights-submit-deletion"
                    >
                      Submit deletion request
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : null}

        {live.deletionState === "loading" ? (
          <span className="flex items-center gap-2 text-[12px] text-[#94a3b8]">
            <span className="size-[11px] animate-spin rounded-full border-2" style={{ borderColor: "rgba(148,163,184,.3)", borderTopColor: "#94a3b8" }} />
            Submitting…
          </span>
        ) : null}

        {live.deletionState === "done" ? (
          <div className="flex items-start gap-[10px] rounded-xl px-[15px] py-[13px]" style={{ border: "1px solid rgba(52,211,153,.25)", background: "rgba(52,211,153,.06)" }} data-testid="data-rights-deletion-done">
            <CheckCircle2 className="mt-[2px] size-[15px] shrink-0" color={GRN} />
            <div className="flex flex-col gap-[5px]">
              <span className="text-[12.5px] font-semibold text-[#f8fafc]">Your deletion request has been received</span>
              <span className="text-[12px] leading-[1.6] text-[#94a3b8]">{live.deletionMessage}</span>
              <span className="text-[11px] leading-[1.5] text-[#64748b]">
                That confirmation comes from the person handling the request, not from this page. This page has no
                status to show later — if you reload, the request is still recorded, but this notice will not come
                back.
              </span>
            </div>
          </div>
        ) : null}

        {live.deletionState === "error" ? (
          <div className="flex flex-1 items-start gap-[10px] rounded-xl px-[14px] py-3" style={{ border: "1px dashed rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }} data-testid="data-rights-deletion-error">
            <AlertCircle className="mt-[2px] size-[15px] shrink-0" color={RED} />
            <div className="flex flex-1 flex-col gap-[5px]">
              <span className="text-[12.5px] font-semibold text-[#f8fafc]">Failed to submit deletion request</span>
              <span className="text-[11px] leading-[1.5] text-[#94a3b8]">{live.deletionError}</span>
              <button
                type="button"
                onClick={disarm}
                className="pt-[2px] text-left text-[11.5px] font-semibold text-[#60a5fa]"
                data-testid="data-rights-deletion-try-again"
              >
                Try again
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Closing your login is different */}
      <div className="flex flex-col gap-[9px] rounded-[14px] px-5 pb-[15px] pt-[15px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
        <span className="text-[13.5px] font-semibold text-[#f8fafc]">Closing your login is a different thing</span>
        <span className="max-w-[680px] text-[12px] leading-[1.6] text-[#94a3b8]">
          Deleting your own sign-in lives under Account Security. It uses the same deletion request behind the
          scenes, so the two never disagree about what is kept — but this page is about your organisation's data,
          and that one is about your access.
        </span>
        <Link href="/account-security" className="text-[12px] font-semibold text-[#60a5fa] hover:underline">
          Go to Account Security →
        </Link>
      </div>

    </div>
  );
}

export default function DataRightsAndPrivacyPage() {
  return <DataRightsAndPrivacyContent />;
}

const LEGACY_BLOCKS = [
  { name: "Profile", what: "name, email, company, phone, when the account was created" },
  { name: "Projects & documents", what: "every project on the organisation and the files attached to them" },
  { name: "Invoices & messages", what: "amounts as billed, status, and the message history with your provider" },
  { name: "Microsoft 365 profile", what: "the profile snapshot held for your organisation, if one exists" },
  { name: "Your own activity", what: "what this login did, newest 500 entries — yours only, not the organisation's" },
  { name: "Quiz results", what: "any diagnostic quiz taken with this email address" },
] as const;

const SCHEMA_BLOCKS = [
  { name: "Diagnostic runs", what: "every scan and its findings — severity, title, recommendation" },
  { name: "Engine scores", what: "score history, daily roll-ups and baseline resets per signal engine" },
  { name: "Signals", what: "when each signal fired and when it resolved" },
  { name: "Documents & SOWs", what: "generated documents, statements of work and who signed them" },
  { name: "Consent & agreements", what: "your Microsoft 365 consent record and clickwrap acceptances" },
  { name: "Organisation activity", what: "the audit trail across the whole organisation, newest 500 entries" },
] as const;
