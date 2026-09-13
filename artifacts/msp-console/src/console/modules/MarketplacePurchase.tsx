/**
 * Marketplace Purchase — per-tenant module page (Git #3819), README screen
 * 47. Mounts at `/tenants/:id/marketplace` (Commercial group, `console/nav.ts`),
 * wiring the real two-route surface in
 * `artifacts/api-server/src/routes/msp-marketplace-purchase.ts` via
 * `@/api/marketplace-purchase-api` — see that file's header for the full
 * wire contract and the honest, verified-current departures from
 * `Marketplace Purchase.dc.html`'s own mock (#3400/#3403 fixed, #3404 still
 * open, #3405 still open but currently inert, no `embedded`/`forceEmpty`
 * props and no card-on-file toggle in the real rebuild).
 *
 * No fixture module, no fabricated row — every value here is a real server
 * response or an honest loading/empty/error state.
 */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/console/icons";
import { surface, text, signal, action, border } from "@/console/tokens";
import {
  MarketplacePurchaseApiError,
  useMarketplaceCatalog,
  useMarketplaceCheckout,
  type CheckoutResult,
  type FulfillmentStatus,
  type MarketplaceCatalogItem,
} from "@/api/marketplace-purchase-api";

type Tone = { strong: string; text: string; tint: string; border: string };

const GREEN: Tone = signal.ok;
const AMBER: Tone = signal.warning;
const RED: Tone = signal.critical;
const BLUE: Tone = signal.info;
const SLATE: Tone = { strong: signal.neutral.strong, text: text.muted, tint: signal.neutral.tint, border: signal.neutral.border };

function money(cents: number | null): string {
  if (cents === null) return "On request";
  if (cents === 0) return "Free";
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2 });
}

function cardStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, ...extra };
}
function pill(t: Tone, extra?: React.CSSProperties): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999,
    background: t.tint, border: `1px solid ${t.border}`, fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: "nowrap",
    ...extra,
  };
}
function primaryBtn(disabled?: boolean, danger?: boolean): React.CSSProperties {
  const bg = danger ? "rgba(248,113,113,.14)" : action.base;
  const fg = danger ? "#fca5a5" : "#fff";
  const lineColor = danger ? signal.critical.border : action.base;
  return {
    display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 14px", borderRadius: 8,
    border: `1px solid ${disabled ? border.card : lineColor}`, background: disabled ? "transparent" : bg,
    color: disabled ? text.faint : fg, fontSize: 12.5, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap",
  };
}

/** Why (if at all) this item can't be bought on the customer's behalf through this route — the three real, airtight 422 gates (§2.1 of the contract pack). */
function blockedReason(item: MarketplaceCatalogItem): { code: string; title: string; body: string } | null {
  if (item.serviceClass === "project") {
    return {
      code: "project",
      title: "This one needs the customer's own signature",
      body: "A project-class item is only bought through the customer's own checkout, where they sign the statement of work. You cannot sign on their behalf, so this route refuses it outright rather than half-completing it.",
    };
  }
  if (item.priceCents === null) {
    return {
      code: "consult",
      title: "No fixed price to charge",
      body: "This is priced on consultation. There is nothing for checkout to bill, so it has to be quoted and sold another way.",
    };
  }
  if (item.perSeat) {
    return {
      code: "seat",
      title: "A per-seat rate, not a total",
      body: "The price on this item is per user, per month. Charging it as a flat total would bill a few dollars for the customer's whole tenant, so this route refuses it rather than guessing a seat count. Purchase it through the seat-aware monitoring checkout flow instead.",
    };
  }
  return null;
}

function fulfillmentStatusFact(status: FulfillmentStatus | undefined): { state: string; label: string; color: string } {
  if (status === "emitted") return { state: "fired", label: "Fulfilment fired for this item", color: GREEN.strong };
  if (status === "duplicate") return { state: "skipped", label: "Fulfilment had already run for this offer — not fired again", color: BLUE.strong };
  if (status === "unknown_type") return { state: "nothing", label: "Fulfilment matched no known type, so nothing was provisioned (#3404)", color: RED.strong };
  return { state: "n/a", label: "This item carries no fulfilment type at all — nothing to provision", color: text.muted };
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function MarketplacePurchase({ customerId, customerName }: { customerId: number; customerName: string }) {
  const catalogQuery = useMarketplaceCatalog(customerId);
  const checkout = useMarketplaceCheckout(customerId);
  const items = useMemo(() => catalogQuery.data?.services ?? [], [catalogQuery.data]);

  const [openId, setOpenId] = useState<number | null>(null);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [errorResult, setErrorResult] = useState<{ status: number; message: string } | null>(null);

  // Default to the first buyable item once the catalog loads.
  useEffect(() => {
    if (openId === null && items.length > 0) {
      const firstBuyable = items.find((i) => !blockedReason(i)) ?? items[0];
      setOpenId(firstBuyable.id);
    }
  }, [items, openId]);

  const selected = items.find((i) => i.id === openId) ?? null;
  const reason = selected ? blockedReason(selected) : null;
  const buyable = !!selected && !reason;
  const free = !!selected && selected.priceCents === 0;

  function selectItem(id: number) {
    setOpenId(id);
    setResult(null);
    setErrorResult(null);
  }

  function buy() {
    if (!selected) return;
    setResult(null);
    setErrorResult(null);
    checkout.mutate(selected.id, {
      onSuccess: (r) => setResult(r),
      onError: (err) => {
        if (err instanceof MarketplacePurchaseApiError) {
          setErrorResult({ status: err.status, message: err.message });
        } else {
          setErrorResult({ status: 0, message: err instanceof Error ? err.message : "The request failed." });
        }
      },
    });
  }

  if (catalogQuery.isLoading) {
    return <span style={{ fontSize: 11.5, color: text.muted }}>Loading the catalog for {customerName}…</span>;
  }
  if (catalogQuery.isError) {
    return <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load the marketplace catalog for this customer.</span>;
  }
  if (items.length === 0) {
    return (
      <div style={cardStyle({ padding: "44px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" })}>
        <Icon name="handshake" size={22} color={BLUE.strong} />
        <span style={{ fontSize: 15, fontWeight: 700, color: text.title }}>No catalog items to buy for this customer</span>
        <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 440 }}>
          The public catalog has no rows in the categories this route can sell right now.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
        {/* ── Catalog list ─────────────────────────────────────────────── */}
        <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 })}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Catalog for this customer</span>
            <span style={{ fontSize: 11, color: text.muted }}>
              The full customer-facing catalog, never narrowed by what {customerName}&apos;s own plan tier would let them browse — you are acting on their behalf, not as them.
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
            {items.map((i) => {
              const r = blockedReason(i);
              const itemFree = i.priceCents === 0;
              const fulfilRisk = !r && i.fulfillmentTypeKey != null && !i.fulfillmentKnown;
              const t = r ? SLATE : itemFree ? BLUE : GREEN;
              const isOpen = i.id === openId;
              return (
                <button
                  key={i.id}
                  onClick={() => selectItem(i.id)}
                  style={{
                    display: "flex", flexDirection: "column", gap: 7, textAlign: "left",
                    border: `1px solid ${isOpen ? border.hover : border.card}`, borderRadius: 10,
                    background: isOpen ? "rgba(96,165,250,.09)" : "rgba(2,6,23,.4)", padding: 12,
                    cursor: "pointer", fontFamily: "inherit", minWidth: 0,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "flex-start", gap: 9, flexWrap: "wrap", width: "100%" }}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 150, flex: 1 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong }}>{i.name}</span>
                      <span style={{ fontSize: 11, color: text.muted }}>
                        {(i.serviceType ?? "service").replace(/_/g, " ")} · class {i.serviceClass}
                      </span>
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end", flex: "none" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: "-.02em", color: text.strong, whiteSpace: "nowrap" }}>{money(i.priceCents)}</span>
                      <span style={{ fontSize: 10, color: text.muted, whiteSpace: "nowrap" }}>{i.perSeat ? "per user, per month" : i.billingType === "recurring_monthly" ? "per month" : "one-off"}</span>
                    </span>
                  </span>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span style={pill(t)}>{r ? (r.code === "project" ? "needs their signature" : r.code === "consult" ? "no fixed price" : "per seat — refused") : itemFree ? "free activation" : "can be bought here"}</span>
                    {fulfilRisk && <span style={pill(AMBER)}>provisions nothing (#3404)</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Detail / buy panel ───────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {selected && (
            <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 13, minWidth: 0 })}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 160, flex: 1 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: text.title }}>{selected.name}</span>
                  <span style={{ fontSize: 11, color: text.muted }}>
                    Item {selected.id} · {(selected.serviceType ?? "service").replace(/_/g, " ")} · billed {selected.perSeat ? "per user, per month" : selected.billingType === "recurring_monthly" ? "per month" : "one-off"}
                  </span>
                </span>
                <span style={pill(reason ? SLATE : free ? BLUE : GREEN)}>{reason ? "cannot be bought here" : free ? "free" : "buyable"}</span>
              </div>

              {reason && (
                <div style={{ border: `1px solid ${AMBER.border}`, borderRadius: 10, background: AMBER.tint, padding: 13, display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: AMBER.strong }}>{reason.title}</span>
                  <span style={{ fontSize: 11.5, color: text.secondary }}>{reason.body}</span>
                </div>
              )}

              {buyable && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
                    <div style={{ border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>CUSTOMER PRICE</span>
                      <span style={{ fontSize: 17, fontWeight: 800, color: text.title }}>{money(selected.priceCents)}</span>
                      <span style={{ fontSize: 10.5, color: text.muted }}>What the catalog lists for {customerName}.</span>
                    </div>
                    <div style={{ border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>CHARGED TO</span>
                      <span style={{ fontSize: 17, fontWeight: 800, color: text.title }}>{free ? "Nothing" : "MSP card"}</span>
                      <span style={{ fontSize: 10.5, color: text.muted }}>{free ? "No payment is attempted." : "The MSP's own saved card on file, never the customer's."}</span>
                    </div>
                    <div style={{ border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>YOUR COST</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: text.secondary }}>{free ? "Free" : "Computed at charge time"}</span>
                      <span style={{ fontSize: 10.5, color: text.muted }}>
                        {free ? "Nothing is charged." : "Server-side, from this item's own recorded cost, or 70% of retail when none is set. Shown for real once the charge succeeds."}
                      </span>
                    </div>
                  </div>

                  {selected.fulfillmentTypeKey != null && !selected.fulfillmentKnown && (
                    <div style={{ border: `1px solid ${AMBER.border}`, borderRadius: 10, background: AMBER.tint, padding: 13, display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: AMBER.strong }}>Nothing will be provisioned</span>
                      <span style={{ fontSize: 11.5, color: text.secondary }}>
                        This item&apos;s fulfilment type (&quot;{selected.fulfillmentTypeKey}&quot;) matches no real, active fulfilment type the platform knows how to act on, so the provisioning step will do nothing. The response will still report success and the charge will still go through — this is a real, still-open gap (#3404), not something this screen can work around client-side. The work would have to be started by hand.
                      </span>
                    </div>
                  )}

                  <div style={{ border: `1px solid ${border.card}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 13, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: text.title }}>Before you send this</span>
                    <span style={{ fontSize: 11.5, color: text.secondary }}>
                      {free
                        ? "Activating writes an accepted offer and an audit entry immediately. No payment is attempted, so there is no charge to fail."
                        : "Sending charges the MSP's card first. The purchase is only recorded as an accepted offer — and only pushed to the customer's own screens — after that charge actually succeeds. A declined card or a misconfigured payment method fails before anything is written, so there is nothing left behind to correct."}
                    </span>
                    <button onClick={buy} disabled={checkout.isPending} style={primaryBtn(checkout.isPending)}>
                      <Icon name={free ? "circle-check-big" : "credit-card"} size={13} />
                      {checkout.isPending ? "Sending…" : free ? "Activate for this customer" : `Charge ${money(selected.priceCents)} and buy`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {result && <OutcomeCard result={result} />}
          {errorResult && <ErrorOutcomeCard status={errorResult.status} message={errorResult.message} />}

          <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 })}>
            <span style={{ fontSize: 12, fontWeight: 700, color: text.title }}>What this screen does and doesn&apos;t give you</span>
            {NOTES.map((n, idx) => (
              <div key={idx} style={{ display: "flex", gap: 9, alignItems: "flex-start", minWidth: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: n.dot, marginTop: 6, flex: "none" }} />
                <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55, minWidth: 0 }}>{n.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Outcome panels ────────────────────────────────────────────────────────────

function OutcomeCard({ result }: { result: CheckoutResult }) {
  const isFree = result.outcome === "free_activated";
  const facts: { state: string; label: string; color: string }[] = [];

  if (isFree) {
    facts.push({ state: "written", label: "An accepted offer on the customer's record", color: GREEN.strong });
    facts.push({ state: "written", label: "An audit entry naming you as the staff member who did it", color: GREEN.strong });
    facts.push({ state: "none", label: "No charge, as expected", color: text.muted });
    facts.push(fulfillmentStatusFact(result.fulfillmentStatus));
  } else if (result.offerId === null) {
    // The rare charge-succeeded-but-offer-row-failed reconciliation branch.
    facts.push({ state: "charged", label: "A real charge went through on the MSP's card", color: AMBER.strong });
    facts.push({ state: "missing", label: "The accepted offer failed to record — needs manual reconciliation", color: RED.strong });
  } else {
    facts.push({ state: "written", label: "An accepted offer on the customer's record", color: GREEN.strong });
    if (result.wholesaleCostCents != null && result.retailPriceCents != null) {
      facts.push({
        state: "charged",
        label: `${money(result.wholesaleCostCents)} to the MSP's saved card, against ${money(result.retailPriceCents)} listed to the customer`,
        color: GREEN.strong,
      });
    }
    if (result.subscriptionId) {
      facts.push({ state: "written", label: "A recurring Stripe Subscription recorded for this customer", color: GREEN.strong });
    }
    facts.push(fulfillmentStatusFact(result.fulfillmentStatus));
  }

  const tone = result.offerId === null ? AMBER : GREEN;
  const code = isFree ? "201 · free_activated" : `201 · payment_processed`;

  return (
    <div style={{ border: `1px solid ${tone.border}`, borderRadius: 14, background: tone.tint, padding: 16, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, fontFamily: "Menlo, monospace", color: tone.strong }}>{code}</span>
      <span style={{ fontSize: 12, color: text.secondary, lineHeight: 1.6 }}>{result.message}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, borderTop: `1px solid ${border.soft}`, paddingTop: 11 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>WHAT NOW EXISTS</span>
        {facts.map((f, idx) => (
          <div key={idx} style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: f.color, minWidth: 74 }}>{f.state}</span>
            <span style={{ fontSize: 11.5, color: text.secondary, flex: 1, minWidth: 150 }}>{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorOutcomeCard({ status, message }: { status: number; message: string }) {
  return (
    <div style={{ border: `1px solid ${RED.border}`, borderRadius: 14, background: RED.tint, padding: 16, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, fontFamily: "Menlo, monospace", color: RED.strong }}>{status || "—"} · request failed</span>
      <span style={{ fontSize: 12, color: text.secondary, lineHeight: 1.6 }}>{message}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, borderTop: `1px solid ${border.soft}`, paddingTop: 11 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>WHAT NOW EXISTS</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: text.muted, minWidth: 74 }}>none</span>
          <span style={{ fontSize: 11.5, color: text.secondary, flex: 1, minWidth: 150 }}>
            No accepted offer was written and no charge was collected — the fix for #3400 means this failure happens before anything is recorded. Fix the underlying issue (e.g. the card on file) and try again.
          </span>
        </div>
      </div>
    </div>
  );
}

const NOTES: { dot: string; text: string }[] = [
  {
    dot: GREEN.strong,
    text: "The accepted-before-charged bug (#3400) is fixed: nothing is written or pushed to the customer until a free item is activated or a paid charge actually succeeds.",
  },
  {
    dot: GREEN.strong,
    text: "The billed-once-instead-of-recurring bug (#3403) is fixed: every live retainer item now opens a real, recurring Stripe Subscription instead of a one-time charge.",
  },
  {
    dot: AMBER.strong,
    text: "Still real and still open (#3404): an item whose fulfilment type matches nothing the platform knows about charges the card and accepts the offer while provisioning nothing. This screen flags it per item, above, from the real fulfilment_types table — it does not invent a workaround.",
  },
  {
    dot: AMBER.strong,
    text: "Still open (#3405), but inert on every real item today: the free path doesn't check the per-item flag that can forbid free activation. No live $0 item has that flag set.",
  },
  {
    dot: BLUE.strong,
    text: "The catalog shown is deliberately the customer's full catalog, not narrowed to what their own plan tier would let them browse, because you are acting on their behalf.",
  },
  {
    dot: text.muted,
    text: "Neither route accepts an MSP identifier from you — the owning MSP is always derived from the customer you're buying for, and your own staff scoping applies on every call.",
  },
];
