/**
 * Partner Revenue — MSP-wide (Operations) module page (Git #3820, screen 48).
 * Mounts at `/ops/revenue`
 * (`Design/MSP_Console/design_handoff_msp_console/Partner Revenue.dc.html`,
 * README screen 48, "Partner revenue" in the Operations tree).
 *
 * Wired against the one real route in
 * `artifacts/api-server/src/routes/msp-partner-revenue.ts` via
 * `src/api/msp-partner-revenue-api.ts` — see that file's header and
 * `docs/msp-console/partner-revenue-msp-console-contract-pack.md` for the
 * full wire contract.
 *
 * Load-bearing fact this page is built around, straight from the route's own
 * header and the design's own copy: **the two halves must never be totalled
 * together.**
 *
 *   - "What you pay the platform" — a solid statement panel. Real,
 *     Stripe-verified `wholesaleSpend`. Its own honest-empty state ("No
 *     platform subscription on this MSP") when the caller's MSP has no
 *     `msp_subscriptions` row at all — not a zero, an absence.
 *   - "Resale worksheet" — a dashed, muted panel. The MSP's own self-declared
 *     resale prices on their Sales Bundles. Never charged, collected or
 *     reconciled by this platform — its disclaimer is always present, not
 *     conditional on any flag. `internalCostCentsPerUnit` is platform-computed
 *     (from the bundle's monitoring packages); only `resalePriceCentsPerUnit`
 *     is the MSP's own number — the labels below carry that distinction since
 *     the wire response itself does not (pack §3.1/§8.3).
 *
 * `embedded` suppresses this module's own header (the shell already renders
 * eyebrow/title/note from the tree node — README "Console Shell mount
 * contract"); every real caller today is `ConsoleShell`, which always mounts
 * embedded. `forceEmpty`, if a future caller passes it, forces the honest
 * empty-state branches regardless of the live query result — it never
 * substitutes fabricated numbers, only short-circuits to the same real
 * "no spend" / "no bundles" copy this page already renders when the data
 * itself is empty.
 */
import { border, signal, surface, text } from "@/console/tokens";
import { usePartnerRevenue, type WholesaleSpend, type WorksheetBundle } from "@/api/msp-partner-revenue-api";

function usd(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "not recorded";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_TONE: Record<WholesaleSpend["status"], { tint: string; line: string; fg: string; label: string }> = {
  active: { tint: signal.ok.tint, line: signal.ok.border, fg: signal.ok.strong, label: "active" },
  trialing: { tint: signal.ok.tint, line: signal.ok.border, fg: signal.ok.strong, label: "trialing" },
  past_due: { tint: signal.warning.tint, line: signal.warning.border, fg: signal.warning.strong, label: "past due" },
  unpaid: { tint: signal.critical.tint, line: signal.critical.border, fg: signal.critical.strong, label: "unpaid" },
  canceled: { tint: signal.neutral.tint, line: signal.neutral.border, fg: signal.neutral.strong, label: "canceled" },
};

function Tile({ label, value, note, color }: { label: string; value: string; note: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color, textWrap: "pretty" as const }}>{value}</span>
    </div>
  );
}

function SpendPanel({ spend }: { spend: WholesaleSpend | null }) {
  const tone = spend ? STATUS_TONE[spend.status] : null;
  const costMissing = !!spend && spend.monthlyCostCents === null;

  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 18, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200, flex: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.ok.strong }}>VERIFIED WITH THE PAYMENT PROCESSOR</span>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.02em", color: text.title }}>What you pay the platform</span>
        </span>
        {tone && (
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 22, padding: "0 9px", borderRadius: 999, background: tone.tint, border: `1px solid ${tone.line}`, fontSize: 10.5, fontWeight: 600, color: tone.fg }}>
            {tone.label}
          </span>
        )}
      </div>

      {spend ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 13, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 180, flex: 1 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: text.title, textWrap: "pretty" as const }}>{spend.tierName}</span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" as const }}>
                Billed {spend.billingInterval === "month" ? "monthly" : "annually"} · {spend.activeTenantCount} tenants counted at the last snapshot
              </span>
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
              <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.03em", color: costMissing ? signal.warning.strong : text.title, whiteSpace: "nowrap" }}>
                {costMissing ? "Not priced" : usd(spend.monthlyCostCents as number)}
              </span>
              <span style={{ fontSize: 10.5, color: text.muted, whiteSpace: "nowrap" }}>{costMissing ? "no figure recorded" : "per month"}</span>
            </span>
          </div>

          {costMissing && (
            <div style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 10, background: signal.warning.tint, padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: signal.warning.strong }}>No price recorded against what you are subscribed to</span>
              <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" as const }}>
                The service this subscription points at has no monthly or annual price recorded, so the route honestly returns nothing rather than inventing a zero.
              </span>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, borderTop: `1px solid ${border.soft}`, paddingTop: 13 }}>
            <Tile label="PERIOD" value={`${fmtDate(spend.currentPeriodStart)} to ${fmtDate(spend.currentPeriodEnd)}`} note="" color={text.title} />
            <Tile label="ANNUAL EQUIVALENT" value={spend.annualPriceCents === null ? "not recorded" : usd(spend.annualPriceCents)} note="" color={spend.annualPriceCents === null ? text.muted : text.title} />
            <Tile label="TENANTS COUNTED" value={`${spend.activeTenantCount} — a stored snapshot, not a live count`} note="" color={text.title} />
            <Tile label="ACCOUNT STANDING" value={spend.dunningState === null ? "fully operational" : spend.dunningState.replace(/_/g, " ")} note="" color={spend.dunningState === null ? signal.ok.strong : signal.critical.strong} />
          </div>

          {spend.dunningState !== null && (
            <div style={{ border: `1px solid ${signal.critical.border}`, borderRadius: 10, background: signal.critical.tint, padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: signal.critical.strong }}>Your account is in {spend.dunningState.replace(/_/g, " ")}</span>
              <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" as const }}>Nothing on this screen changes that — it is read-only. The plan and payment method live on the billing surface.</span>
            </div>
          )}
        </div>
      ) : (
        <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 10, padding: "22px 18px", display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>No platform subscription on this MSP</span>
          <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" as const, maxWidth: 400 }}>
            This is the live state for this organisation — there is no subscription row at all, which the route reports as an absence rather than a zero. Nothing is owed and nothing is being billed.
          </span>
        </div>
      )}

      <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" as const, borderTop: `1px solid ${border.soft}`, paddingTop: 12 }}>
        One current-state row, or nothing. There is no history, no invoice list and no date range on this route — what you owed last quarter is not answerable here.
      </span>
    </div>
  );
}

function bundleTag(b: WorksheetBundle): { tag: string; tint: string; line: string; color: string; warn: string | null } {
  const never = b.activeAssignmentCount === 0;
  const zeroPriced = b.resalePriceCentsPerUnit === 0;
  if (never) {
    return {
      tag: "nothing to total", tint: signal.neutral.tint, line: signal.neutral.border, color: signal.neutral.strong,
      warn: "This bundle has never been assigned to anyone — and a bundle whose every assignment was revoked would look exactly the same here. The route gives no way to tell those two apart.",
    };
  }
  if (zeroPriced) {
    return {
      tag: "no price set", tint: signal.warning.tint, line: signal.warning.border, color: signal.warning.strong,
      warn: "The resale price on this bundle is zero, so the model shows no margin. That is an honest reading of what is recorded, not a calculation error.",
    };
  }
  return { tag: "in the model", tint: signal.ok.tint, line: signal.ok.border, color: signal.ok.strong, warn: null };
}

function BundleCard({ b }: { b: WorksheetBundle }) {
  const t = bundleTag(b);
  const never = b.activeAssignmentCount === 0;
  return (
    <div style={{ border: `1px solid ${border.soft}`, borderRadius: 12, background: "rgba(15,23,42,.5)", padding: 14, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 170, flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: text.title, textWrap: "pretty" as const }}>{b.name}</span>
          <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" as const }}>
            bundle {b.bundleId.slice(0, 8)} · {never ? "not assigned to anyone" : `${b.activeAssignmentCount} active assignments`} · {usd(b.resalePriceCentsPerUnit)} each
          </span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 22, padding: "0 9px", borderRadius: 999, background: t.tint, border: `1px solid ${t.line}`, fontSize: 10.5, fontWeight: 600, color: t.color }}>{t.tag}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 12 }}>
        <Tile label="WOULD INVOICE" value={usd(b.worksheetMonthlyResaleCents)} note="Your own resale price, times the active assignments." color={never ? text.muted : text.title} />
        <Tile label="COSTS YOU" value={usd(b.worksheetMonthlyCostCents)} note="Computed by the platform from the packages in the bundle, not typed by you." color={never ? text.muted : text.title} />
        <Tile
          label="MARGIN"
          value={usd(b.worksheetMonthlyMarginCents)}
          note=""
          color={never ? text.muted : b.worksheetMonthlyMarginCents > 0 ? signal.ok.strong : signal.warning.strong}
        />
      </div>

      {t.warn && (
        <span style={{ fontSize: 11, color: signal.warning.strong, textWrap: "pretty" as const, borderTop: `1px solid ${border.soft}`, paddingTop: 10 }}>{t.warn}</span>
      )}
    </div>
  );
}

function WorksheetPanel({ worksheet }: { worksheet: { disclaimer: string; bundles: WorksheetBundle[] } }) {
  return (
    <div style={{ border: "1px dashed rgba(148,163,184,.3)", borderRadius: 14, background: "rgba(2,6,23,.35)", padding: 18, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.warning.strong }}>YOUR OWN FIGURES · NOT VERIFIED BY ANYTHING</span>
        <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.02em", color: text.secondary }}>Resale worksheet</span>
      </span>

      <div style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 10, background: signal.warning.tint, padding: 13, display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: signal.warning.strong }}>This is planning, not revenue</span>
        <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55, textWrap: "pretty" as const }}>
          {worksheet.disclaimer}
        </span>
      </div>

      {worksheet.bundles.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 11, minWidth: 0 }}>
          {worksheet.bundles.map((b) => <BundleCard key={b.bundleId} b={b} />)}
        </div>
      ) : (
        <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 10, padding: "22px 18px", display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: text.secondary }}>No active bundles</span>
          <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" as const, maxWidth: 400 }}>
            Only active bundles appear here. A draft you are still putting together, or one you have archived, is invisible on this surface even though it is yours — there is no way to see its numbers through this route.
          </span>
        </div>
      )}

      <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" as const, borderTop: `1px solid ${border.soft}`, paddingTop: 12 }}>
        This screen only reads. Bundles, their prices and who they are assigned to are all edited on the sales bundles surface, and the totals here follow from that.
      </span>
    </div>
  );
}

const NOTES: string[] = [
  "The resale half of this screen is not revenue and is drawn differently on purpose. MSPs invoice their own customers entirely outside this platform, so no figure here has ever been charged, collected or checked against an invoice — they are numbers somebody typed.",
  "The two halves must never be totalled together. One is verified against the payment processor, the other is a planning model, and a single combined figure would be a claim the data cannot support.",
  "A bundle with no assignments and a bundle whose every assignment was revoked are identical on the wire. Nothing distinguishes never-sold from no-longer-sold, so neither can be stated.",
  "The monthly cost is absent rather than zero when the subscribed service carries no price.",
  "The cost side of each bundle is computed by the platform from the packages inside it; only the resale price is the MSP's own number. The response itself does not mark that difference, so the labels here carry it.",
  "Draft and archived bundles never appear, even to the MSP that owns them. There is no parameter to include them, so this surface cannot answer what an unfinished bundle would earn.",
  "There is no history, no invoice list, no date range and no pagination — one current-state row and the full active-bundle set. Any trend or last-quarter question needs a different surface.",
  "The tenant count is a stored snapshot taken at billing time, not a live count, so it can legitimately disagree with the number of tenants visible elsewhere in the console.",
  "This route reads only, never writes, and cannot see another MSP's figures at all — not even for a platform administrator, who gets their own organisation's numbers like anyone else.",
];

export function PartnerRevenue({ embedded = true, forceEmpty = false }: { embedded?: boolean; forceEmpty?: boolean }) {
  const revenueQuery = usePartnerRevenue();

  if (revenueQuery.isLoading) {
    return (
      <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 18 }}>
        <span style={{ fontSize: 12.5, color: text.muted }}>Loading partner revenue…</span>
      </div>
    );
  }

  if (revenueQuery.isError) {
    return (
      <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 18, display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: signal.warning.strong }}>Couldn't load partner revenue</span>
        <span style={{ fontSize: 12, color: text.muted }}>{revenueQuery.error.message}</span>
      </div>
    );
  }

  const data = revenueQuery.data;
  const spend = forceEmpty ? null : (data?.wholesaleSpend ?? null);
  const worksheet = forceEmpty
    ? { disclaimer: data?.pricingWorksheet.disclaimer ?? "", bundles: [] }
    : (data?.pricingWorksheet ?? { disclaimer: "", bundles: [] });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      {!embedded && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.info.strong }}>PARTNER REVENUE</span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 26, padding: "0 10px", borderRadius: 999, background: signal.warning.tint, border: `1px solid ${signal.warning.border}`, fontSize: 11, fontWeight: 600, color: signal.warning.strong }}>
            MSPAdmin or above
          </span>
        </div>
      )}

      <SpendPanel spend={spend} />
      <WorksheetPanel worksheet={worksheet} />

      <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: text.title }}>What this one route does and doesn't give this screen</span>
        {NOTES.map((n, i) => (
          <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", minWidth: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: text.muted, marginTop: 6, flex: "none" }} />
            <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55, textWrap: "pretty" as const, minWidth: 0 }}>{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
