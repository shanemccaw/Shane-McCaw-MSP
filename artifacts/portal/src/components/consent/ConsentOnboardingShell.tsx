import { useState, type ReactNode } from "react";

/**
 * Shared chrome for the Consent and Onboarding surface (Feature #1650, Git
 * #3993) — `Design/portal/design_handoff_full_site/screens/Consent and
 * Onboarding.dc.html`. Every scene in that export shares this same top bar
 * (brand + a live state dot/line) and centered card layout; this is that
 * chrome, factored out so consent-success/declined/tenant-conflict/
 * onboarding-link don't each re-draw it.
 */
export function ConsentOnboardingShell({
  stateLine,
  isAlert = false,
  children,
  footer,
}: {
  /** e.g. "Consent callback · portal origin · granted" — the design's {{stateLine}}. */
  stateLine: string;
  /** Red dot instead of green — the design's declined/tenant-conflict tone. */
  isAlert?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="dark flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2.5 px-5 pt-4 sm:px-7">
        <span className="flex size-[26px] flex-none items-center justify-center rounded-[7px] bg-gradient-to-br from-primary to-status-blue text-[10px] font-extrabold tracking-wide text-primary-foreground">
          SM
        </span>
        <span className="text-[13px] font-semibold text-foreground">Shane McCaw Consulting</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={`size-1.5 rounded-full ${isAlert ? "bg-destructive" : "bg-status-green"}`} />
          {stateLine}
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center gap-3.5 px-5 py-9 sm:py-14">
        {children}
        {footer}
      </div>
    </div>
  );
}

export function ConsentCard({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "danger" }) {
  return (
    <div
      className={`flex w-full max-w-[600px] flex-col gap-3.5 rounded-2xl border p-6 pb-6 ${
        tone === "danger" ? "border-destructive/30 bg-destructive/5" : "border-border/60 bg-card/40"
      }`}
    >
      {children}
    </div>
  );
}

/**
 * "What these pages deliberately do not do" — `Consent and Onboarding.dc.html`
 * lines 205-222/325-336. Shared across all 5 consent/onboarding pages
 * (rather than duplicated per page) since the design draws one ledger for
 * the whole scene set, not one per scene. `where` values are the design's
 * own contract-pack section references, kept verbatim — same convention as
 * `data-rights-and-privacy.tsx`'s LEDGER.
 */
const CONSENT_LEDGER: { gap: string; where: string }[] = [
  {
    gap: "These three outcome pages serve the provider-invite and reconsent path only. The website's own funnel consents in a pop-up and never lands here.",
    where: "§1 · §9a",
  },
  {
    gap: "The inline \"finish your order\" step is a fallback, drawn as one. It appears only when Microsoft opened in the same tab and the URL still carries a session.",
    where: "§1a · §9a",
  },
  {
    gap: "The scope list is read from the live manifest, not typed into the page, so it cannot drift from what Microsoft is actually asked for.",
    where: "§1b · §9b",
  },
  {
    gap: "No retry after a decline. Declining consumes the invite exactly as accepting would; only the provider can issue another.",
    where: "§1b",
  },
  {
    gap: "A tenant conflict stops before any write. No payment, no tenant row, no account — the page says so rather than offering a way round.",
    where: "§1c",
  },
  {
    gap: "The consent-first refusal gets its own treatment with a reconnect action, not a generic error banner — it descends from a real incident.",
    where: "§3 · §9c",
  },
  {
    gap: "\"Just registered\" and \"already registered\" look identical on the wire. The page reports what it was told and does not invent a distinction.",
    where: "§3 · §8",
  },
  {
    gap: "No name, email or company is read from the public session lookup. It serves three non-personal fields; the rest stays on this device.",
    where: "§4",
  },
  {
    gap: "The staff interstitial makes no request. Both of its actions are client-side, and \"continue\" targets the current portal entry, not the retired path.",
    where: "§7 · §9d",
  },
  {
    gap: "Minting invitation links, and the list of links already issued, are provider-side controls and are not drawn here.",
    where: "§6 · §6a",
  },
];

export function ConsentLedger() {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex w-full max-w-[600px] flex-col gap-2.5 rounded-[14px] border border-border/50 bg-card/20 px-5 pb-[15px] pt-4">
      <div className="flex items-baseline gap-2.5">
        <span className="text-[13px] font-semibold text-foreground">What these pages deliberately do not do</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? "Collapse" : "Expand"}
        </button>
      </div>
      {open ? (
        <div className="flex flex-col">
          {CONSENT_LEDGER.map((l) => (
            <div key={l.where} className="flex items-start gap-3 border-t border-border/40 py-2">
              <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-foreground/90">{l.gap}</span>
              <span className="flex-none whitespace-nowrap font-mono text-[10.5px] text-muted-foreground">{l.where}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
