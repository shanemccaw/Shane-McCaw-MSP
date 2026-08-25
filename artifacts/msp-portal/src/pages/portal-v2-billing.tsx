/**
 * portal-v2-billing.tsx — Billing (Part 12).
 *
 * Ported from the prototype's `isBilling` block (Customer Portal Shell.dc.html
 * 2371-2517) and its render values (15570-15644, 19644-19662), transcribed into
 * billingData.ts / billingModel.ts.
 *
 * ── Premier, never Command (#1128) ──────────────────────────────────────────
 * The third tier card is Premier — the shell's two ladders disagree on the name
 * (and price); #1128 settles the NAME platform-wide. The price shown here (1980)
 * is the card ladder's own number; the discrepancy with the other ladder (2350)
 * is flagged for Shane in billingData.ts / PLATFORM_BUILD.md. Nothing here bills.
 *
 * ── UI-only, but the plan/add-on/interval state is real ─────────────────────
 * The interval toggle, tier switch and add-on toggles are the design's own local
 * state and are wired — flipping them reprices the streams, tiers and receipts
 * exactly as the prototype does. Monitoring-plan pricing itself stays fixture
 * (see billingLive.ts — blocked on the #1128 Premier discrepancy and the real
 * catalog's seat-metered, flat-price-less tiers); the payment buttons there
 * are still inert.
 *
 * ── Receipts + "Manage payment in Stripe" are real (#1237) ──────────────────
 * `useBillingLive` reads the tenant's real invoice history off
 * GET /api/portal/invoices and, once at least one row comes back, the Receipts
 * section renders those instead of BILL_RECEIPTS — each row's "Receipt" button
 * links to the real PDF (GET /api/portal/invoices/:id/download) when one was
 * generated. "Manage payment in Stripe" opens the tenant's real Stripe billing
 * portal session (POST /api/portal/billing/customer-portal). A customer with no
 * invoices yet, or a failed read, keeps the design fixture — `pv2-bill-receipts-
 * source` states which is on screen.
 */

import { useState } from "react";
import { Link } from "wouter";

import { useBillingLive } from "@/components/portal-v2/billingLive";
import { PV2_SOURCE_CLIP } from "@/components/portal-v2/useLivePillarHero";

import { PortalV2Shell, SIDEBAR_WASH } from "@/components/portal-v2/PortalV2Shell";
import {
  BILL_ADDONS_KICKER,
  BILL_ADDONS_NOTE,
  BILL_A_MONTH_PREFIX,
  BILL_BUY_IT,
  BILL_CARD_LINE,
  BILL_DELIVERY_PREFIX,
  BILL_MANAGE_STRIPE,
  BILL_MONITORING_KICKER,
  BILL_MONITORING_NOTE,
  BILL_MONTHLY,
  BILL_NEXT_CHARGE,
  BILL_ONEOFFS,
  BILL_ONEOFF_KICKER,
  BILL_ONEOFF_NOTE,
  BILL_PAUSE,
  BILL_RECEIPTS_KICKER,
  BILL_RECEIPTS_NOTE,
  BILL_RECEIPT_BTN,
  BILL_WHAT_YOU_PAY,
  BILL_YEARLY,
  type BillAddonKey,
} from "@/components/portal-v2/billingData";
import {
  BILL_STATE_SEED,
  type BillState,
  billAddonCards,
  billAddonOn,
  billMonthly,
  billReceipts,
  billSaving,
  billSavingLabel,
  billStreams,
  billTierCards,
  fmt$,
} from "@/components/portal-v2/billingModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>
      {children}
    </span>
  );
}

function SectionHead({ kicker, note }: { kicker: string; note: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <Kicker>{kicker}</Kicker>
      <span style={{ fontSize: "10.5px", color: "#475569" }}>{note}</span>
    </div>
  );
}

export default function PortalV2BillingPage() {
  const [state, setState] = useState<BillState>(BILL_STATE_SEED);
  const monthly = billMonthly(state);
  const streams = billStreams(state);
  const tiers = billTierCards(state);
  const addons = billAddonCards(state);

  const live = useBillingLive();
  const [portalError, setPortalError] = useState<string | null>(null);
  const [downloadingRef, setDownloadingRef] = useState<string | null>(null);

  const receipts =
    live.dataState === "live"
      ? live.receipts.map((r) => ({ date: r.date, what: r.what, ref: r.ref, amount: r.amount, invoiceId: r.id as number | null }))
      : billReceipts(monthly).map((r) => ({ ...r, invoiceId: null as number | null }));

  const handleManageStripe = () => {
    setPortalError(null);
    void live.openStripePortal().then((message) => setPortalError(message));
  };

  const handleDownloadReceipt = (r: (typeof receipts)[number]) => {
    if (r.invoiceId === null) return;
    setDownloadingRef(r.ref);
    void live.downloadReceipt(r.invoiceId).then((message) => {
      setPortalError(message);
      setDownloadingRef(null);
    });
  };

  const toggleInterval = () => setState((s) => ({ ...s, yearly: !s.yearly }));
  const toggleAddon = (key: BillAddonKey) =>
    setState((s) => ({ ...s, addons: { ...s.addons, [key]: !billAddonOn(s.addons, key) } }));
  const pickTier = (key: BillState["tier"]) =>
    setState((s) => (s.tier === key ? s : { ...s, pick: s.pick === key ? null : key }));
  const confirmTier = (key: BillState["tier"]) => setState((s) => ({ ...s, tier: key, pick: null }));
  const cancelTier = () => setState((s) => ({ ...s, pick: null }));

  const intervalBtn = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px",
    borderRadius: 7,
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "11.5px",
    fontWeight: 700,
    background: active ? "#0078D4" : "transparent",
    color: active ? "#fff" : "#94a3b8",
  });

  return (
    <PortalV2Shell eyebrow="Account" title="Billing">
      <div style={{ minHeight: "100%", background: SIDEBAR_WASH }}>
        <div
          data-testid="pv2-billing"
          style={{ maxWidth: 1160, margin: "0 auto", padding: "26px 28px 60px", display: "flex", flexDirection: "column", gap: 20 }}
        >
          <Link
            href="/portal-v2"
            data-testid="pv2-bill-back"
            style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "11.5px", fontWeight: 600, color: "#64748b", fontFamily: "inherit", textDecoration: "none" }}
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
            Overview
          </Link>

          {/* Header — proto 2378-2393 */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: "9.5px", fontWeight: 800, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>{BILL_WHAT_YOU_PAY}</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                <span data-testid="pv2-bill-monthly" style={{ fontSize: "34px", fontWeight: 800, letterSpacing: "-.03em", color: "#f8fafc", fontFamily: MONO }}>{fmt$(monthly)}</span>
                <span style={{ fontSize: "13px", color: "#64748b" }}>{BILL_A_MONTH_PREFIX} {BILL_NEXT_CHARGE}</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 0, padding: 3, borderRadius: 9, border: "1px solid rgba(148,163,184,.2)", background: "rgba(2,6,23,.4)" }}>
                <button type="button" onClick={toggleInterval} data-testid="pv2-bill-interval-monthly" style={intervalBtn(!state.yearly)}>{BILL_MONTHLY}</button>
                <button type="button" onClick={toggleInterval} data-testid="pv2-bill-interval-yearly" style={intervalBtn(state.yearly)}>{BILL_YEARLY}</button>
              </div>
              <span data-testid="pv2-bill-saving" style={{ fontSize: "11px", color: "#5eead4", fontWeight: 700 }}>{billSavingLabel(state.yearly, billSaving(monthly))}</span>
            </div>
          </div>

          {/* Streams — proto 2395-2403 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
            {streams.map((st) => (
              <div key={st.key} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "13px 15px", borderRadius: 11, border: `1px solid ${st.tone}30`, background: `linear-gradient(160deg,${st.tone}0f,rgba(15,23,42,.45))` }}>
                <span style={{ fontSize: "9.5px", fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: st.tone }}>{st.label}</span>
                <span style={{ fontSize: "21px", fontWeight: 800, letterSpacing: "-.02em", color: "#f8fafc", fontFamily: MONO }}>{st.price}</span>
                <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.4 }}>{st.sub}</span>
              </div>
            ))}
          </div>

          {/* Monitoring plan — proto 2405-2448 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SectionHead kicker={BILL_MONITORING_KICKER} note={BILL_MONITORING_NOTE} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 11, alignItems: "stretch" }}>
              {tiers.map((t) => {
                const badgeTone = t.isNow ? "#34d399" : t.badge === "Upgrade" ? "#93c5fd" : "#94a3b8";
                const badgeBorder = t.isNow ? "rgba(52,211,153,.5)" : t.badge === "Upgrade" ? "rgba(0,120,212,.5)" : "rgba(148,163,184,.3)";
                const badgeBg = t.isNow ? "rgba(52,211,153,.12)" : t.badge === "Upgrade" ? "rgba(0,120,212,.14)" : "transparent";
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => pickTier(t.key)}
                    data-testid={`pv2-bill-tier-${t.key}`}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 9,
                      padding: "16px 17px",
                      borderRadius: 13,
                      cursor: t.isNow ? "default" : "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                      flex: "1 1 240px",
                      minWidth: 230,
                      border: `1px solid ${t.isPick ? "rgba(0,120,212,.85)" : t.isNow ? "rgba(52,211,153,.45)" : "rgba(148,163,184,.18)"}`,
                      background: t.isPick
                        ? "linear-gradient(160deg,rgba(0,120,212,.16),rgba(15,23,42,.6))"
                        : t.isNow
                          ? "linear-gradient(160deg,rgba(52,211,153,.09),rgba(15,23,42,.5))"
                          : "rgba(15,23,42,.4)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 9, width: "100%" }}>
                      <span style={{ fontSize: "14.5px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.01em" }}>{t.name}</span>
                      <span style={{ flex: "0 0 auto", padding: "2px 8px", borderRadius: 5, fontSize: "9px", fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", whiteSpace: "nowrap", border: `1px solid ${badgeBorder}`, background: badgeBg, color: badgeTone }}>{t.badge}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                      <span style={{ fontSize: "24px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.02em", fontFamily: MONO }}>{t.price}</span>
                      <span style={{ fontSize: "11px", color: "#64748b" }}>{t.per}</span>
                    </div>
                    <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.5, textWrap: "pretty" }}>{t.blurb}</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 3 }}>
                      {t.has.map((h) => (
                        <div key={h} style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
                          <span style={{ flex: "0 0 auto", fontSize: "10px", fontWeight: 800, color: "#34d399", lineHeight: 1.5 }}>✓</span>
                          <span style={{ fontSize: "11px", color: "#cbd5e1", lineHeight: 1.5 }}>{h}</span>
                        </div>
                      ))}
                      {t.lacks.map((h) => (
                        <div key={h} style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
                          <span style={{ flex: "0 0 auto", fontSize: "10px", fontWeight: 800, color: "#475569", lineHeight: 1.5 }}>—</span>
                          <span style={{ fontSize: "11px", color: "#475569", lineHeight: 1.5 }}>{h}</span>
                        </div>
                      ))}
                    </div>
                    {t.isPick && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto", paddingTop: 11, borderTop: "1px solid rgba(0,120,212,.3)" }}>
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "#93c5fd" }}>{t.deltaLabel}</span>
                        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                          <span
                            role="button"
                            tabIndex={0}
                            data-testid={`pv2-bill-switch-${t.key}`}
                            onClick={(e) => { e.stopPropagation(); confirmTier(t.key); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); confirmTier(t.key); } }}
                            style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #0078D4", background: "#0078D4", color: "#fff", fontSize: "12px", fontWeight: 800, cursor: "pointer" }}
                          >
                            Switch to {t.name}
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); cancelTier(); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); cancelTier(); } }}
                            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(148,163,184,.22)", color: "#94a3b8", fontSize: "11.5px", fontWeight: 600, cursor: "pointer" }}
                          >
                            Not now
                          </span>
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Add-on modules — proto 2450-2470 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SectionHead kicker={BILL_ADDONS_KICKER} note={BILL_ADDONS_NOTE} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {addons.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => toggleAddon(a.key)}
                  data-testid={`pv2-bill-addon-${a.key}`}
                  aria-pressed={a.on}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 13,
                    padding: "14px 16px",
                    borderRadius: 12,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                    width: "100%",
                    border: `1px solid ${a.on ? "rgba(45,212,191,.4)" : "rgba(148,163,184,.16)"}`,
                    background: a.on ? "linear-gradient(160deg,rgba(45,212,191,.08),rgba(15,23,42,.45))" : "rgba(15,23,42,.35)",
                  }}
                >
                  <span style={{ flex: "0 0 38px", width: 38, height: 22, borderRadius: 12, position: "relative", transition: "background 180ms", background: a.on ? "#2dd4bf" : "rgba(148,163,184,.22)" }}>
                    <span style={{ position: "absolute", top: 3, left: a.on ? 19 : 3, width: 16, height: 16, borderRadius: "50%", background: "#0b1524", transition: "left 180ms" }} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.35 }}>{a.name}</span>
                    <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>{a.blurb}</span>
                  </div>
                  <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                    <span style={{ fontSize: "13px", fontWeight: 800, color: a.on ? "#2dd4bf" : "#94a3b8", fontFamily: MONO }}>{a.price}</span>
                    <span style={{ fontSize: "10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em" }}>{a.stateLabel}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* One-time work — proto 2472-2492 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SectionHead kicker={BILL_ONEOFF_KICKER} note={BILL_ONEOFF_NOTE} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 10 }}>
              {BILL_ONEOFFS.map((o) => (
                <div key={o.key} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "15px 16px", borderRadius: 12, border: "1px solid rgba(251,191,36,.2)", background: "linear-gradient(160deg,rgba(251,191,36,.05),rgba(15,23,42,.45))" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.35 }}>{o.name}</span>
                    <span style={{ flex: "0 0 auto", fontSize: "13px", fontWeight: 800, color: "#fbbf24", fontFamily: MONO }}>{typeof o.price === "number" ? fmt$(o.price) : o.price}</span>
                  </div>
                  <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>{o.blurb}</span>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: "auto", paddingTop: 5 }}>
                    <span style={{ fontSize: "10.5px", color: "#64748b" }}>{BILL_DELIVERY_PREFIX} {o.when}</span>
                    <button type="button" style={{ padding: "7px 13px", borderRadius: 7, border: "1px solid rgba(251,191,36,.45)", background: "rgba(251,191,36,.12)", color: "#fbbf24", fontSize: "11.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{BILL_BUY_IT}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Receipts — proto 2494-2510 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <SectionHead kicker={BILL_RECEIPTS_KICKER} note={BILL_RECEIPTS_NOTE} />
            {/* Hidden live/fixture marker, same convention as `pv2-cmp-source` — proves
                whether the rows below are the tenant's real invoices or the design fixture. */}
            <span data-testid="pv2-bill-receipts-source" style={PV2_SOURCE_CLIP}>
              {live.dataState}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 12, background: "rgba(15,23,42,.4)", overflow: "hidden" }}>
              {receipts.map((r) => (
                <div key={r.ref} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 15px", borderBottom: "1px solid rgba(30,41,59,.8)", flexWrap: "wrap" }}>
                  <span style={{ flex: "0 0 96px", fontSize: "11px", color: "#94a3b8", fontFamily: MONO }}>{r.date}</span>
                  <span style={{ flex: 1, minWidth: 150, fontSize: "12px", color: "#e2e8f0", lineHeight: 1.4 }}>{r.what}</span>
                  <span style={{ flex: "0 0 auto", fontSize: "10px", color: "#475569", fontFamily: MONO }}>{r.ref}</span>
                  <span style={{ flex: "0 0 78px", textAlign: "right", fontSize: "12px", fontWeight: 700, color: "#e2e8f0", fontFamily: MONO }}>{r.amount}</span>
                  <button
                    type="button"
                    data-testid={`pv2-bill-receipt-${r.ref}`}
                    disabled={r.invoiceId === null || downloadingRef === r.ref}
                    onClick={() => handleDownloadReceipt(r)}
                    style={{
                      flex: "0 0 auto",
                      padding: "5px 10px",
                      borderRadius: 6,
                      border: "1px solid rgba(148,163,184,.22)",
                      background: "transparent",
                      color: "#94a3b8",
                      fontSize: "10.5px",
                      fontWeight: 600,
                      cursor: r.invoiceId === null ? "default" : "pointer",
                      opacity: r.invoiceId === null ? 0.5 : 1,
                      fontFamily: "inherit",
                    }}
                  >
                    {downloadingRef === r.ref ? "Downloading…" : BILL_RECEIPT_BTN}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Footer — proto 2512-2516 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleManageStripe}
                disabled={live.openingPortal}
                data-testid="pv2-bill-manage-stripe"
                style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(148,163,184,.24)", background: "transparent", color: "#cbd5e1", fontSize: "11.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
              >
                {live.openingPortal ? "Opening…" : BILL_MANAGE_STRIPE}
              </button>
              <button type="button" style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(148,163,184,.2)", background: "transparent", color: "#94a3b8", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{BILL_PAUSE}</button>
              <span style={{ fontSize: "10.5px", color: "#475569" }}>{BILL_CARD_LINE}</span>
            </div>
            {portalError && (
              <span data-testid="pv2-bill-portal-error" style={{ fontSize: "11px", color: "#f87171" }}>
                {portalError}
              </span>
            )}
          </div>
        </div>
      </div>
    </PortalV2Shell>
  );
}
