import { Link } from "wouter";

import { useEmailAuthSetupLive, type WireEmailAuthStatus } from "@/components/emailAuthSetupLive";

const HAIRLINE = "rgba(255,255,255,.09)";
const CARD_BG = "rgba(255,255,255,.02)";
const RED = "#f87171";

const TONE = {
  ok: { ink: "#34d399", bg: "rgba(52,211,153,.10)", bd: "rgba(52,211,153,.28)", cardBd: HAIRLINE, cardBg: CARD_BG },
  warn: { ink: "#fbbf24", bg: "rgba(251,191,36,.10)", bd: "rgba(251,191,36,.28)", cardBd: "rgba(251,191,36,.3)", cardBg: "rgba(251,191,36,.03)" },
  info: { ink: "#60a5fa", bg: "rgba(96,165,250,.10)", bd: "rgba(96,165,250,.3)", cardBd: "rgba(96,165,250,.28)", cardBg: "rgba(96,165,250,.03)" },
  unknown: { ink: "#94a3b8", bg: "rgba(148,163,184,.08)", bd: "rgba(148,163,184,.22)", cardBd: HAIRLINE, cardBg: CARD_BG },
} as const;

interface ProtocolCard {
  readonly name: string;
  readonly what: string;
  readonly bd: string;
  readonly bg: string;
  readonly pill: string;
  readonly pillInk: string;
  readonly pillBg: string;
  readonly pillBd: string;
  readonly reading: string;
  readonly stepsLabel: string;
  readonly steps: readonly string[];
  readonly record: string | null;
}

function buildProtocol(
  name: string,
  what: string,
  value: boolean | null,
  okReading: string,
  badReading: string,
  unknownReading: string,
  badTone: "warn" | "info",
  steps: readonly string[],
  record: string | null,
): ProtocolCard {
  const tone = value === null ? "unknown" : value ? "ok" : badTone;
  const T = TONE[tone];
  return {
    name,
    what,
    bd: T.cardBd,
    bg: T.cardBg,
    pill: value === null ? "Not checked yet" : value ? "Found" : badTone === "info" ? "Not found at default selectors" : "Not found",
    pillInk: T.ink,
    pillBg: T.bg,
    pillBd: T.bd,
    reading: value === null ? unknownReading : value ? okReading : badReading,
    stepsLabel: value ? "WHAT IS IN PLACE" : "HOW TO SET IT UP",
    steps,
    record: value === false ? record : null,
  };
}

function buildProtocols(status: WireEmailAuthStatus): readonly ProtocolCard[] {
  const domain = status.domain ?? "your domain";
  return [
    buildProtocol(
      "SPF",
      `Lists which servers may send mail as ${domain}. Receivers reject or flag mail from anywhere else.`,
      status.spfConfigured,
      `A v=spf1 TXT record is published on ${domain}.`,
      `No TXT record starting v=spf1 was found on ${domain}.`,
      `Whether a v=spf1 record exists on ${domain} is unknown until a scan records it.`,
      "warn",
      [
        `Sign in to your DNS provider for ${domain}.`,
        "Add a TXT record at the root of the domain with the value below (add any other services that send as you).",
        "Wait for the next scan — the status here is read from it.",
      ],
      "v=spf1 include:spf.protection.outlook.com -all",
    ),
    buildProtocol(
      "DKIM",
      "Signs outgoing mail so receivers can check it was not altered and really came from your tenant.",
      status.dkimConfiguredAtDefaultSelectors,
      "Signing keys were found at Microsoft 365's default selectors, selector1 and selector2.",
      "No key was found at Microsoft 365's default selectors, selector1 and selector2. A tenant using custom or rotated selector names may still have DKIM — this check cannot see that, so it is not a verdict that DKIM is absent.",
      "Whether keys exist at the default selectors is unknown until a scan records it.",
      "info",
      [
        `In the Microsoft Defender portal, open Email authentication settings → DKIM and select ${domain}.`,
        "Publish the two CNAME records it shows (selector1._domainkey and selector2._domainkey) at your DNS provider.",
        "Return and switch signing on. If you already sign with custom selectors, nothing here needs to change.",
      ],
      // No static value shown, by design — Microsoft only mints the real CNAME
      // pair once the customer clicks Enable; there is nothing honest to show
      // ahead of that (contract pack §2, and the archived page's own reasoning).
      null,
    ),
    buildProtocol(
      "DMARC",
      "Tells receivers what to do when SPF or DKIM fails, and where to send reports about it.",
      status.dmarcConfigured,
      `A v=DMARC1 TXT record is published at _dmarc.${domain}.`,
      `No TXT record starting v=DMARC1 was found at _dmarc.${domain}. Without it, receivers decide for themselves what to do with mail that fails the other two checks.`,
      "Whether a _dmarc record exists is unknown until a scan records it.",
      "warn",
      [
        "Get SPF and DKIM in place first — DMARC acts on their results.",
        `Add a TXT record at _dmarc.${domain} with the value below. Start with p=none to observe, then move to quarantine or reject.`,
        "Send the reports to a mailbox someone reads.",
      ],
      `v=DMARC1; p=none; rua=mailto:dmarc-reports@${domain}`,
    ),
  ];
}

function fmtCollectedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

/**
 * Split out from the page wrapper below so the consolidated Settings page
 * (#1736) can mount it as one tab without re-wiring the fetch logic — same
 * pattern as NotificationPreferencesContent / WebhooksContent.
 */
export function EmailAuthSetupContent() {
  const { dataState, status, refetch } = useEmailAuthSetupLive();

  const loading = dataState === "loading";
  const notChecked = dataState === "not-checked";
  const failed = dataState === "read-failed";
  const checked = dataState === "checked" && status !== null;

  const protocols = checked ? buildProtocols(status!) : [];
  const openCount = checked
    ? [status!.spfConfigured, status!.dkimConfiguredAtDefaultSelectors, status!.dmarcConfigured].filter((v) => v === false).length
    : null;

  const stateLine = failed ? "Could not read the status" : notChecked ? "Live — never checked for this tenant" : loading ? "Loading" : "Live — read from the latest scan";
  const stateDot = failed ? RED : notChecked || loading ? "#475569" : "#34d399";
  const stateInk = failed ? RED : "#64748b";

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 px-[26px] py-5" style={{ color: "#cbd5e1" }} data-testid="email-auth-setup-page" data-email-auth-source={dataState}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[20px] font-bold text-[#f8fafc]" style={{ letterSpacing: "-.01em" }}>
          Email authentication
        </span>
        <span
          title="Whether your primary domain publishes the three DNS records that stop your mail being spoofed: SPF, DKIM and DMARC. Read from the most recent scan; this page explains what to publish and never changes DNS for you."
          className="flex size-[17px] items-center justify-center rounded-full text-[10px] font-bold text-[#64748b]"
          style={{ border: "1px solid rgba(148,163,184,.35)" }}
        >
          i
        </span>
        <span className="flex items-center gap-[6px] text-[11px]" style={{ color: stateInk }}>
          <span className="size-[6px] rounded-full" style={{ background: stateDot }} />
          {stateLine}
        </span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-[10px]">
          {[0, 1].map((i) => (
            <div key={i} className="h-[110px] animate-pulse rounded-[14px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }} />
          ))}
        </div>
      ) : null}

      {notChecked ? (
        <div className="flex flex-col gap-2 rounded-[14px] px-[22px] py-5" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
          <span className="text-[13.5px] font-semibold text-[#f8fafc]">Your domain has not been checked yet</span>
          <span className="max-w-[660px] text-[12px] leading-[1.6] text-[#94a3b8]">
            This check runs as part of a scan of your tenant, and no scan has recorded a result for it. Every status below is unknown — not failing — until one
            does. The setup steps still apply and can be done ahead of the first check.
          </span>
        </div>
      ) : null}

      {failed ? (
        <div className="flex gap-[10px] rounded-xl px-4 py-[14px]" style={{ border: "1px dashed rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }}>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-[#f8fafc]">Failed to load email authentication status</span>
            <span className="max-w-[620px] text-[12px] leading-[1.55] text-[#94a3b8]">
              A failed read, not a result. Your records may be perfectly configured — nothing is shown below because nothing could be fetched. The setup steps
              are still correct.
            </span>
            <button type="button" onClick={refetch} className="w-fit pt-[2px] text-left text-[11.5px] font-semibold text-[#60a5fa] hover:text-[#93c5fd]" data-testid="email-auth-setup-retry">
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {checked ? (
        <div className="flex flex-wrap items-center gap-[12px] rounded-[14px] px-5 py-[14px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
          <div className="flex min-w-[200px] flex-1 flex-col gap-[2px]">
            <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
              DOMAIN CHECKED
            </span>
            <span className="text-[15px] font-semibold text-[#f8fafc]" style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
              {status!.domain ?? "—"}
            </span>
          </div>
          <div className="flex flex-none flex-col gap-[2px]">
            <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
              COLLECTED
            </span>
            <span className="text-[12.5px] text-[#e2e8f0]">{status!.collectedAt ? fmtCollectedAt(status!.collectedAt) : "—"}</span>
          </div>
          <div className="flex flex-none flex-col gap-[2px]">
            <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
              OPEN ITEMS
            </span>
            <span className="text-[12.5px]" style={{ color: openCount === 0 ? "#34d399" : "#fbbf24" }}>
              {openCount === 0 ? "None — all three found" : `${openCount} of 3 to set up`}
            </span>
          </div>
        </div>
      ) : null}

      {!loading ? (
        <div className="grid gap-[14px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))" }}>
          {(checked ? protocols : notChecked || failed ? buildProtocols({ checked: false, domain: null, spfConfigured: null, dmarcConfigured: null, dkimConfiguredAtDefaultSelectors: null, collectedAt: null }) : []).map(
            (p) => (
              <div key={p.name} className="flex flex-col gap-[10px] rounded-[14px] px-[18px] pb-4 pt-[15px]" style={{ border: `1px solid ${p.bd}`, background: p.bg }}>
                <div className="flex flex-wrap items-center gap-[9px]">
                  <span className="text-[14px] font-bold text-[#f8fafc]">{p.name}</span>
                  <span className="rounded-full px-[9px] py-[3px] text-[10px] font-semibold" style={{ color: p.pillInk, background: p.pillBg, border: `1px solid ${p.pillBd}` }}>
                    {p.pill}
                  </span>
                </div>
                <span className="text-[11.5px] leading-[1.55] text-[#94a3b8]">{p.what}</span>
                <span className="text-[12px] leading-[1.55] text-[#cbd5e1]">{p.reading}</span>
                <div className="flex flex-col gap-[6px] pt-[10px]" style={{ borderTop: "1px solid rgba(255,255,255,.07)" }}>
                  <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
                    {p.stepsLabel}
                  </span>
                  {p.steps.map((s, i) => (
                    <div key={i} className="flex items-start gap-[9px]">
                      <span className="mt-[1px] w-3 flex-none text-[10.5px] font-bold text-[#64748b]">{i + 1}</span>
                      <span className="text-[11.5px] leading-[1.5] text-[#cbd5e1]">{s}</span>
                    </div>
                  ))}
                </div>
                {p.record ? (
                  <span
                    className="rounded-[6px] px-[10px] py-2 text-[10.5px] leading-[1.55] text-[#94a3b8]"
                    style={{ border: "1px solid rgba(255,255,255,.1)", background: "rgba(2,6,23,.5)", fontFamily: "ui-monospace, Menlo, monospace", wordBreak: "break-all" }}
                  >
                    {p.record}
                  </span>
                ) : null}
              </div>
            ),
          )}
        </div>
      ) : null}

      {!loading ? (
        <div className="flex flex-col gap-[9px] rounded-[14px] px-5 pb-[15px] pt-[15px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
          <span className="text-[13.5px] font-semibold text-[#f8fafc]">After you publish a record</span>
          <span className="max-w-[680px] text-[12px] leading-[1.6] text-[#94a3b8]">
            DNS changes take up to 48 hours to spread. The status here updates when the next scan of your tenant runs — this page does not re-check on demand.
            If a record later changes or a DKIM key disappears, it shows up as configuration drift as well as here.
          </span>
          <div className="flex flex-wrap gap-[14px] pt-[2px]">
            <Link href="/config-state" className="text-[12px] font-semibold text-primary hover:underline">
              Configuration state →
            </Link>
            <Link href="/diagnostics" className="text-[12px] font-semibold text-primary hover:underline">
              Latest scan →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function EmailAuthSetupPage() {
  return <EmailAuthSetupContent />;
}
