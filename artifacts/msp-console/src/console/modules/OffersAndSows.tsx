/**
 * Offers & SOWs — per-tenant Commercial-group module page (Git #4014,
 * Feature #2568), README screen 66
 * (`Design/MSP_Console/design_handoff_msp_console/SOWs.dc.html`). Mounts at
 * `/tenants/:id/offers-sows`.
 *
 * Supersedes nothing in `Sales.tsx` (Git #2643, MSP-wide `/ops/sales`) —
 * that module already wires offer accept + a per-offer SOW peek. This page
 * is the wider, customer-scoped surface the richer 63–66 contract-pack pass
 * added on top: the whole SOW book for one customer (not just the SOWs tied
 * to one offer), the authenticated sign action (never wired anywhere until
 * now), and the customer-agreement clickwrap read/write pair. See
 * `@/api/offers-and-sows-api` for the full route map and the real
 * asymmetries this screen surfaces rather than hides.
 *
 * Three tabs, faithful to the design's own logic class:
 *   Statements of work   — the real SOW lifecycle for this customer.
 *   Offers to accept     — sales offers this customer can have accepted for them.
 *   Customer agreement   — clickwrap acceptance record for this customer.
 *
 * No fixture module — every row is a real server response or an honest
 * loading/empty/error state. The signature captured by the sign panel is a
 * real base64 PNG drawn on a canvas, not placeholder text — the backend's
 * `signSowSchema` requires real signature data, and this screen supplies it
 * by actually capturing one rather than sending a fabricated string.
 */
import { useMemo, useRef, useState } from "react";
import { Icon } from "@/console/icons";
import { surface, text, signal, action, border } from "@/console/tokens";
import {
  useAcceptOfferForCustomer, useClickwrapStatus, useCustomerOffers, useExpireSow,
  useOpenSowDocument, useRecordClickwrap, useSignSow, useSowDetail, useSowsForCustomer,
  useTriggerSowCharge,
  type MspSow, type MspSowStatus, type SalesOffer, type SalesOfferState,
} from "@/api/offers-and-sows-api";
import type { AcceptOfferResult, MspSowSummary } from "@/api/sales-api";

type Tab = "sows" | "offers" | "clickwrap";
type Tone = { strong: string; text: string; tint: string; border: string };

const GREEN: Tone = signal.ok;
const AMBER: Tone = signal.warning;
const RED: Tone = signal.critical;
const BLUE: Tone = signal.info;
const SLATE: Tone = { strong: signal.neutral.strong, text: text.muted, tint: signal.neutral.tint, border: signal.neutral.border };

const SOW_STATUSES: MspSowStatus[] = ["draft", "sent", "signed", "paid", "failed", "expired"];
const SOW_TONE: Record<MspSowStatus, Tone> = { draft: SLATE, sent: BLUE, signed: AMBER, paid: GREEN, failed: RED, expired: SLATE };
const OFFER_TONE: Record<SalesOfferState, Tone> = { draft: SLATE, sent: BLUE, accepted: GREEN, rejected: RED, expired: SLATE };

function money(cents: number): string {
  if (cents === 0) return "free";
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
}
function cardStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, ...extra };
}
function pill(t: Tone, extra?: React.CSSProperties): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, height: 22, padding: "0 10px", borderRadius: 999,
    background: t.tint, border: `1px solid ${t.border}`, fontSize: 10.5, fontWeight: 600, color: t.text, whiteSpace: "nowrap",
    ...extra,
  };
}
function chipStyle(on: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", height: 26, padding: "0 10px", borderRadius: 999,
    background: on ? action.selectedRowSoft : "rgba(148,163,184,.06)", border: `1px solid ${on ? border.hover : border.soft}`,
    fontSize: 11, fontWeight: 600, color: on ? text.strong : text.muted, cursor: "pointer", fontFamily: "inherit",
  };
}
function primaryBtn(disabled?: boolean, danger?: boolean): React.CSSProperties {
  const bg = danger ? "rgba(248,113,113,.14)" : action.base;
  const fg = danger ? "#fca5a5" : "#fff";
  const lineColor = danger ? signal.critical.border : action.base;
  return {
    display: "inline-flex", alignItems: "center", gap: 7, height: 32, padding: "0 13px", borderRadius: 6,
    border: `1px solid ${disabled ? border.card : lineColor}`, background: disabled ? "transparent" : bg,
    color: disabled ? text.faint : fg, fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap", fontFamily: "inherit",
  };
}
function secondaryBtn(): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: 6,
    border: `1px solid ${border.card}`, background: "rgba(148,163,184,.06)", color: text.secondary,
    fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
  };
}

type ResultTone = "green" | "amber" | "red" | "blue" | "slate";
const RESULT_TONE: Record<ResultTone, Tone> = { green: GREEN, amber: AMBER, red: RED, blue: BLUE, slate: SLATE };

function ResultCard({ code, tone, text: body }: { code: string; tone: ResultTone; text: string }) {
  const t = RESULT_TONE[tone];
  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 12, background: t.tint, padding: 13, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "Menlo, monospace", color: t.strong }}>{code}</span>
      <span style={{ fontSize: 12, color: text.secondary, lineHeight: 1.55 }}>{body}</span>
    </div>
  );
}

// ── Signature capture — a real canvas the operator draws on, not a fixture ──

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasStroke) setHasStroke(true);
  }
  function end() {
    drawing.current = false;
    const canvas = canvasRef.current;
    onChange(canvas && hasStroke ? canvas.toDataURL("image/png") : null);
  }
  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
    onChange(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <canvas
        ref={canvasRef}
        width={320}
        height={90}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={() => drawing.current && end()}
        style={{ width: "100%", maxWidth: 320, height: 90, borderRadius: 6, border: `1px solid ${border.card}`, background: "#f8fafc", touchAction: "none", cursor: "crosshair" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" onClick={clear} style={secondaryBtn()}>
          <Icon name="circle-x" size={12} /> Clear
        </button>
        <span style={{ fontSize: 10.5, color: text.muted }}>Drawn here, captured as the real signature image the route stores.</span>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function OffersAndSows({ customerId, customerName, mspId }: { customerId: number; customerName: string; mspId: number | null }) {
  const [tab, setTab] = useState<Tab>("sows");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {([
          ["sows", "Statements of work"],
          ["offers", "Offers to accept"],
          ["clickwrap", "Customer agreement"],
        ] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={chipStyle(tab === k)}>{label}</button>
        ))}
      </div>

      {tab === "sows" && <SowsTab mspId={mspId} customerId={customerId} />}
      {tab === "offers" && <OffersTab mspId={mspId} customerId={customerId} />}
      {tab === "clickwrap" && <ClickwrapTab customerId={customerId} customerName={customerName} />}
    </div>
  );
}

// ── Statements of work tab ───────────────────────────────────────────────────

function SowsTab({ mspId, customerId }: { mspId: number | null; customerId: number }) {
  const [filter, setFilter] = useState<MspSowStatus | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [signer, setSigner] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [result, setResult] = useState<{ code: string; tone: ResultTone; text: string } | null>(null);

  const listQuery = useSowsForCustomer(mspId, customerId, filter);
  const rows = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);
  const detailQuery = useSowDetail(openId);
  const sow = detailQuery.data ?? null;

  const signMutation = useSignSow(mspId, customerId);
  const chargeMutation = useTriggerSowCharge(mspId, customerId);
  const expireMutation = useExpireSow(mspId, customerId);
  const openDocMutation = useOpenSowDocument();

  function select(row: MspSowSummary) {
    setOpenId(row.sowId);
    setResult(null);
    setSigner("");
    setSignature(null);
  }

  if (listQuery.isLoading) {
    return <span style={{ fontSize: 11.5, color: text.muted }}>Loading statements of work…</span>;
  }
  if (listQuery.isError) {
    return <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load statements of work for this customer.</span>;
  }

  const canSign = !!sow && (sow.status === "sent" || sow.status === "draft");
  const canCharge = !!sow && (sow.status === "signed" || sow.status === "failed");
  const onPathIdx = sow ? ["draft", "sent", "signed", "paid"].indexOf(sow.status) : -1;

  function sign() {
    if (!sow) return;
    if (!signer.trim()) {
      setResult({ code: "400 · signerName is required", tone: "amber", text: "Name between one and two hundred characters." });
      return;
    }
    if (!signature) {
      setResult({ code: "400 · signature required", tone: "amber", text: "Draw a signature in the pad above before signing — the route requires real signature data, at least ten characters long." });
      return;
    }
    signMutation.mutate(
      { sowId: sow.sowId, signerName: signer.trim(), signatureData: signature },
      {
        onSuccess: (r) => setResult({ code: `200 · status: "${r.status}"`, tone: "green", text: r.message }),
        onError: (err) => setResult({ code: (err as Error & { status?: number }).status ? `${(err as Error & { status?: number }).status} · sign failed` : "sign failed", tone: "red", text: err instanceof Error ? err.message : "The request failed." }),
      },
    );
  }
  function charge() {
    if (!sow) return;
    chargeMutation.mutate(sow.sowId, {
      onSuccess: (r) => {
        if (r.status === "paid") setResult({ code: `200 · { success: true, status: "paid"${r.stripePaymentIntentId ? ", stripePaymentIntentId" : ""} }`, tone: "green", text: "Charged and recorded in the charges ledger; fulfilment unlocked best-effort." });
        else if (r.status === "pending_action") setResult({ code: `200 · { success: false, status: "pending_action" }`, tone: "amber", text: "The payment intent was created unconfirmed — there is no saved card on file, so nothing here will confirm it. The workflow still treats this as a non-error." });
        else setResult({ code: `200 · { success: false, status: "failed" }`, tone: "red", text: r.error ?? "The charge failed." });
      },
      onError: (err) => setResult({ code: "charge failed", tone: "red", text: err instanceof Error ? err.message : "The request failed." }),
    });
  }
  function expire() {
    if (!sow || sow.status === "paid") return;
    expireMutation.mutate(sow.sowId, {
      onSuccess: () => setResult({ code: "200 · expired · { manual: true }", tone: "slate", text: "The field that distinguishes an operator's expiry from the scheduled sweep." }),
      onError: (err) => setResult({ code: "expire failed", tone: "red", text: err instanceof Error ? err.message : "The request failed." }),
    });
  }
  function openDoc() {
    if (!sow) return;
    openDocMutation.mutate(sow.sowId, {
      onError: (err) => setResult({ code: "document failed", tone: "red", text: err instanceof Error ? err.message : "The request failed." }),
    });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
      <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 })}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => setFilter("all")} style={chipStyle(filter === "all")}>All</button>
          {SOW_STATUSES.map((s) => (
            <button key={s} onClick={() => setFilter(s)} style={chipStyle(filter === s)}>{s}</button>
          ))}
        </div>
        {rows.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            {rows.map((r) => {
              const t = SOW_TONE[r.status];
              const isOpen = r.sowId === openId;
              return (
                <button key={r.sowId} onClick={() => select(r)} style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left", border: `1px solid ${isOpen ? border.hover : border.card}`, borderRadius: 10, background: isOpen ? "rgba(96,165,250,.09)" : "rgba(2,6,23,.4)", padding: 12, cursor: "pointer", fontFamily: "inherit", minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", width: "100%" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong, flex: 1, minWidth: 140 }}>{r.title}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "-.02em", color: text.strong, whiteSpace: "nowrap" }}>{money(r.amountCents)}</span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={pill(t)}>{r.status}</span>
                    <span style={{ fontSize: 11, color: text.muted }}>created {fmtDate(r.createdAt)} · {r.status === "expired" ? "expired " : "expires "}{fmtDate(r.expiresAt)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ border: `1px dashed ${border.card}`, borderRadius: 10, padding: 22, display: "flex", flexDirection: "column", gap: 6, alignItems: "center", textAlign: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: text.secondary }}>{filter === "all" ? "No statements of work for this customer" : "Nothing in this state"}</span>
            <span style={{ fontSize: 11.5, color: text.muted }}>{filter === "all" ? "Nothing has yet been turned into a SOW for this customer, standalone or from an offer." : "The status filter is passed straight through — a status with no matching rows is a real empty result, not an error."}</span>
          </div>
        )}
        <span style={{ fontSize: 11, color: text.muted, borderTop: `1px solid ${border.soft}`, paddingTop: 10 }}>
          {listQuery.data?.total ?? 0} in total · the list is a nine-field projection; opening one reads the full row
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {sow ? (
          <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 })}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 170, flex: 1 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: text.title }}>{sow.title}</span>
                <span style={{ fontSize: 11, color: text.muted }}>SOW #{sow.id} · {sow.offerId ? `offer #${sow.offerId} · project` : "standalone · created here"}</span>
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.03em", color: text.title }}>{money(sow.amountCents)}</span>
                <span style={pill(SOW_TONE[sow.status], { height: 22 })}>{sow.status}</span>
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {["draft", "sent", "signed", "paid"].map((k, i) => {
                const done = onPathIdx >= i && onPathIdx > -1;
                const cur = onPathIdx === i;
                const t = cur ? SOW_TONE[k as MspSowStatus] : done ? GREEN : SLATE;
                return <span key={k} style={pill(t, { height: 24 })}>{k}</span>;
              })}
              {onPathIdx === -1 && (
                <span style={{ fontSize: 11, color: SOW_TONE[sow.status].text, flex: 1, minWidth: 140 }}>
                  {sow.status === "failed" ? `Signed, then the charge failed: ${sow.failureReason ?? "unknown reason"}. Retry from here.` : "Expired after thirty days unsigned or unpaid. Nothing brings it back."}
                </span>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
              <Fact label="SHARE LINK" value={sow.shareToken ? `…${sow.shareToken.slice(-10)}` : "none"} note={sow.shareTokenExpiresAt ? `Link valid until ${fmtDate(sow.shareTokenExpiresAt)}. Its own clock, separate from the SOW's own expiry.` : ""} mono />
              <Fact label="SOW EXPIRES" value={fmtDate(sow.expiresAt)} note={sow.status === "signed" ? "Re-stamped to thirty days from signing." : "Thirty days from creation, unless re-stamped by a sign."} />
              <Fact label="AGREEMENT TEXT" value={sow.customerAgreementSnapshotText ? "your template, snapshotted" : "built-in five-clause terms"} note={sow.customerAgreementSnapshotText ? "Copied at creation and never re-read." : "No template was configured for this MSP."} warn={!sow.customerAgreementSnapshotText} />
              <Fact label="LINE ITEMS" value="one — Project Fee" note="Never itemised into phases." />
              <Fact label="SIGNED" value={sow.signerName ? `${sow.signerName} · ${fmtDateTime(sow.signedAt)}` : "not yet"} note={sow.signerName ? `From ${sow.signedIp ?? "unknown IP"}.` : "Either an authenticated session or the public link can sign."} />
              <Fact label="ON PAYMENT" value="fulfilment unlocked" note="Best-effort — a failure there never surfaces here." />
            </div>

            {sow.signerName && (
              <div style={{ border: `1px solid ${AMBER.border}`, borderRadius: 10, background: AMBER.tint, padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: AMBER.strong }}>Signature data comes back to any operator</span>
                <span style={{ fontSize: 11.5, color: text.secondary }}>Opening a SOW returns the entire raw row — signature image and signer IP included — to any operator at the floor role. The public viewer deliberately strips them; this route does not.</span>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: `1px solid ${border.soft}`, paddingTop: 13 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: text.title }}>What can happen to it from here</span>

              {canSign && (
                <div style={{ border: `1px solid ${BLUE.border}`, borderRadius: 10, background: BLUE.tint, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: BLUE.text }}>Sign it in an authenticated session</span>
                  <span style={{ fontSize: 11.5, color: text.secondary }}>Either side can sign — your MSP&apos;s own staff, or the one customer login the SOW is assigned to. A draft is signable; it never has to pass through sent. Signing re-stamps the expiry to thirty days from now and asks for approval before any charge.</span>
                  <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Signer name</span>
                    <input value={signer} onChange={(e) => setSigner(e.target.value)} placeholder="Who is signing" style={{ height: 32, padding: "0 11px", borderRadius: 6, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12.5, fontFamily: "inherit", outline: "none" }} />
                  </label>
                  <SignaturePad onChange={setSignature} />
                  <div>
                    <button onClick={sign} disabled={signMutation.isPending} style={primaryBtn(signMutation.isPending)}>
                      <Icon name="signature" size={13} /> {signMutation.isPending ? "Signing…" : "Sign"}
                    </button>
                  </div>
                </div>
              )}

              {canCharge && (
                <div style={{ border: `1px solid ${GREEN.border}`, borderRadius: 10, background: GREEN.tint, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: GREEN.strong }}>{sow.status === "failed" ? "Retry the charge" : "Charge without waiting for the approval workflow"}</span>
                  <span style={{ fontSize: 11.5, color: text.secondary }}>
                    {sow.amountCents === 0
                      ? "A free project settles here without touching the payment processor: marked paid, fulfilment unlocked."
                      : "Charges the card saved on your platform subscription and records the attempt — the same implementation the approval workflow's own step calls."}
                  </span>
                  <div>
                    <button onClick={charge} disabled={chargeMutation.isPending} style={primaryBtn(chargeMutation.isPending)}>
                      <Icon name="credit-card" size={13} /> {chargeMutation.isPending ? "Charging…" : sow.amountCents === 0 ? "Settle for free" : "Charge the card on file"}
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={openDoc} disabled={openDocMutation.isPending} style={secondaryBtn()}>
                  <Icon name="file-text" size={13} /> {openDocMutation.isPending ? "Opening…" : "Open the document"}
                </button>
                <button onClick={expire} disabled={sow.status === "paid" || expireMutation.isPending} style={{ ...secondaryBtn(), opacity: sow.status === "paid" ? 0.5 : 1, cursor: sow.status === "paid" ? "not-allowed" : "pointer" }}>
                  <Icon name="file-x" size={13} /> Expire it now
                </button>
                <span style={{ fontSize: 11, color: text.muted, flex: 1, minWidth: 160 }}>
                  {sow.status === "paid" ? "A paid SOW is the only one that cannot be expired." : "Blocked only for a paid SOW."}
                </span>
              </div>
            </div>

            {result && <ResultCard {...result} />}
          </div>
        ) : (
          <div style={{ border: `1px dashed ${border.card}`, borderRadius: 14, padding: 26, display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>Pick a statement of work</span>
            <span style={{ fontSize: 11.5, color: text.muted, maxWidth: 320 }}>Draft, sent, signed, paid — with failed and expired off to the side. Every SOW carries two thirty-day clocks that are not the same clock.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value, note, mono, warn }: { label: string; value: string; note: string; mono?: boolean; warn?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: warn ? AMBER.strong : text.strong, fontFamily: mono ? "Menlo, monospace" : "inherit", wordBreak: "break-word" }}>{value}</span>
      {note && <span style={{ fontSize: 10.5, color: text.faint }}>{note}</span>}
    </div>
  );
}

// ── Offers to accept tab ─────────────────────────────────────────────────────

const OFFER_PATHS: Record<string, { eyebrow: string; title: string; text: string; tone: Tone }> = {
  project: { eyebrow: "IF THIS IS A PROJECT", title: "A statement of work is created, already sent", text: "A SOW row is written straight into sent — no draft, no review step — with a fresh share link and two thirty-day clocks. The document is generated inline from the title, description, price and your agreement template as it stands right now.", tone: BLUE },
  other: { eyebrow: "IF THIS IS AN ADD-ON OR SUBSCRIPTION", title: "A checkout session on the customer's side", text: "A one-time payment session is created and the customer completes it in their own portal — this route never bills through the console. A genuine $0 item with free checkout allowed activates immediately with no SOW and no processor call instead.", tone: BLUE },
};

function OffersTab({ mspId, customerId }: { mspId: number | null; customerId: number }) {
  const offersQuery = useCustomerOffers(mspId, customerId);
  const offers = useMemo(() => offersQuery.data?.offers ?? [], [offersQuery.data]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [result, setResult] = useState<{ code: string; tone: ResultTone; text: string } | null>(null);
  const accept = useAcceptOfferForCustomer(mspId, customerId);

  const selected = offers.find((o) => o.id === openId) ?? null;
  const acceptable = !!selected && (selected.state === "sent" || selected.state === "draft");

  if (offersQuery.isLoading) {
    return <span style={{ fontSize: 11.5, color: text.muted }}>Loading offers…</span>;
  }
  if (offersQuery.isError) {
    return <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load offers for this customer.</span>;
  }

  function selectOffer(id: number) {
    setOpenId(id);
    setResult(null);
  }

  function doAccept() {
    if (!selected || !acceptable) return;
    accept.mutate(selected.id, {
      onSuccess: (r: AcceptOfferResult) => {
        if (r.outcome === "sow_created") setResult({ code: `201 · { outcome: "sow_created", sowId: "${r.sowId}" }`, tone: "green", text: r.message });
        else if (r.outcome === "free_activated") setResult({ code: "200 · { outcome: \"free_activated\" }", tone: "green", text: r.message });
        else if (r.outcome === "checkout_required") setResult({ code: `200 · { outcome: "checkout_required" }`, tone: "blue", text: r.checkoutUrl ? `Checkout session created: ${r.checkoutUrl}` : "Checkout session created — no URL was returned." });
        else setResult({ code: `200 · { outcome: "payment_processed" }`, tone: "green", text: r.message });
      },
      onError: (err) => {
        const status = (err as Error & { status?: number }).status;
        setResult({ code: status ? `${status} · accept failed` : "accept failed", tone: "red", text: err instanceof Error ? err.message : "The request failed." });
      },
    });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
      <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 })}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Offers that can be accepted on this customer&apos;s behalf</span>
          <span style={{ fontSize: 11, color: text.muted }}>{offers.length} offers for this customer · sent and draft are both acceptable here</span>
        </div>
        {offers.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            {offers.map((o) => {
              const t = OFFER_TONE[o.state];
              const isOpen = o.id === openId;
              return (
                <button key={o.id} onClick={() => selectOffer(o.id)} style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left", border: `1px solid ${isOpen ? border.hover : border.card}`, borderRadius: 10, background: isOpen ? "rgba(96,165,250,.09)" : "rgba(2,6,23,.4)", padding: 12, cursor: "pointer", fontFamily: "inherit", minWidth: 0, opacity: o.state === "accepted" || o.state === "rejected" ? 0.6 : 1 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", width: "100%" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong, flex: 1, minWidth: 140 }}>{o.title}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "-.02em", color: text.strong, whiteSpace: "nowrap" }}>{o.priceCents == null ? "on request" : money(o.priceCents)}</span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={pill(t)}>{o.state}</span>
                    {o.expiresAt && <span style={{ fontSize: 11, color: text.muted }}>expires {fmtDate(o.expiresAt)}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ border: `1px dashed ${border.card}`, borderRadius: 10, padding: 22, display: "flex", flexDirection: "column", gap: 6, alignItems: "center", textAlign: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: text.secondary }}>Nothing to accept</span>
            <span style={{ fontSize: 11.5, color: text.muted, maxWidth: 380 }}>Offers come from the sales engine and are listed on the MSP-wide Sales surface too. Accepting one here is what turns it into a SOW, a free activation or a checkout.</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {selected ? (
          <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 13, minWidth: 0 })}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: text.title }}>{selected.title}</span>
              <span style={{ fontSize: 11, color: text.muted }}>offer #{selected.id} · {selected.priceCents == null ? "on request" : money(selected.priceCents)} · {selected.state}</span>
            </div>

            {(["project", "other"] as const).map((k) => (
              <div key={k} style={{ border: `1px solid ${OFFER_PATHS[k].tone.border}`, borderRadius: 10, background: OFFER_PATHS[k].tone.tint, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: OFFER_PATHS[k].tone.text }}>{OFFER_PATHS[k].eyebrow}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: text.title }}>{OFFER_PATHS[k].title}</span>
                <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55 }}>{OFFER_PATHS[k].text}</span>
              </div>
            ))}
            <span style={{ fontSize: 10.5, color: text.faint }}>Which branch this offer actually takes is resolved server-side from the linked service&apos;s class at the moment of acceptance — the list route above doesn&apos;t return that class ahead of time.</span>

            <div style={{ border: `1px solid ${RED.border}`, borderRadius: 10, background: RED.tint, padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: RED.strong }}>The offer is marked accepted before any of that runs</span>
              <span style={{ fontSize: 11.5, color: text.secondary }}>Nothing rolls it back. If the checkout session fails to be created, or the SOW insert fails, the offer stays accepted with nothing behind it.</span>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={doAccept} disabled={!acceptable || accept.isPending} style={primaryBtn(!acceptable || accept.isPending)}>
                <Icon name="handshake" size={13} /> {accept.isPending ? "Accepting…" : selected.state === "accepted" ? "Already accepted" : "Accept on the customer's behalf"}
              </button>
              <span style={{ fontSize: 11, color: text.muted, flex: 1, minWidth: 160 }}>
                {acceptable ? "Marks the offer accepted, then runs the branch above." : "Only sent and draft offers can be accepted here."}
              </span>
            </div>

            {result && <ResultCard {...result} />}
          </div>
        ) : (
          <div style={{ border: `1px dashed ${border.card}`, borderRadius: 14, padding: 26, display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>Pick an offer</span>
            <span style={{ fontSize: 11.5, color: text.muted, maxWidth: 320 }}>A project becomes a SOW. An add-on or subscription becomes a checkout, or a free activation.</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Customer agreement clickwrap tab ─────────────────────────────────────────

function ClickwrapTab({ customerId, customerName }: { customerId: number; customerName: string }) {
  const cwQuery = useClickwrapStatus(customerId);
  const record = useRecordClickwrap(customerId);
  const [result, setResult] = useState<{ code: string; tone: ResultTone; text: string } | null>(null);

  if (cwQuery.isLoading) {
    return <span style={{ fontSize: 11.5, color: text.muted }}>Loading the agreement status for {customerName}…</span>;
  }
  if (cwQuery.isError) {
    return <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load the clickwrap status for this customer.</span>;
  }

  const cw = cwQuery.data!;

  function doRecord() {
    record.mutate(undefined, {
      onSuccess: (r) => setResult({ code: "201 · clickwrap row written", tone: "amber", text: `${r.message} Attributed to your own login for ${customerName}, with an agreement-text snapshot, your IP address and user agent.` }),
      onError: (err) => setResult({ code: "record failed", tone: "red", text: err instanceof Error ? err.message : "The request failed." }),
    });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
      <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 })}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Customer agreement acceptance</span>
          <span style={{ fontSize: 11, color: text.muted }}>Only meaningful when this MSP has a customer agreement template configured. Without one, every customer reads as accepted with nothing recorded.</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, borderTop: `1px solid ${border.soft}`, paddingTop: 12 }}>
          <Fact label="REQUIRED" value={cw.required ? "true" : "false"} note="" />
          <Fact label="ACCEPTED" value={cw.accepted ? `true${cw.acceptedAt ? " · " + fmtDateTime(cw.acceptedAt) : ""}` : "false"} note="" warn={!cw.accepted} />
        </div>
        <span style={{ fontSize: 11, color: text.muted }}>
          {cw.required
            ? "Keyed to the calling login, not to a specific customer contact — this reflects your own operator login's acceptance record, not any one customer login's."
            : "No agreement template is configured for this MSP, so the route short-circuits to required: false, accepted: true, and no row is ever read or written for any customer."}
        </span>
        {cw.required && cw.agreementText && (
          <div style={{ border: `1px solid ${border.soft}`, borderRadius: 8, background: "rgba(2,6,23,.5)", padding: 11, fontSize: 11, lineHeight: 1.55, color: text.secondary, fontFamily: "Georgia, serif", maxHeight: 140, overflow: "auto" }}>
            {cw.agreementText}
          </div>
        )}
      </div>

      <div style={{ border: `1px solid ${RED.border}`, borderRadius: 14, background: RED.tint, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: RED.strong }}>RECORD AN ACCEPTANCE · FILED AS A SECURITY BUG (#2725)</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>The write side checks nobody&apos;s ownership</span>
        </div>
        <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55 }}>
          The read route refuses a customer outside your MSP. The write route does not: any signed-in account in the system can post an acceptance against any customer id and it succeeds, writing a permanent record with the agreement text, an IP address and a user agent that reads exactly like a genuine acceptance. This screen keeps the action behind an explicit button and labels what it writes, but the guard has to land on the server.
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={doRecord} disabled={!cw.required || record.isPending} style={primaryBtn(!cw.required || record.isPending, true)}>
            <Icon name="shield-alert" size={13} /> {record.isPending ? "Recording…" : "Record acceptance for " + customerName}
          </button>
          <span style={{ fontSize: 11, color: text.muted, flex: 1, minWidth: 160 }}>
            {cw.required ? "Attributes the acceptance to your own login and snapshots the agreement text as it stands now." : "Disabled — no agreement template is configured for this MSP."}
          </span>
        </div>
        {result && <ResultCard {...result} />}
      </div>
    </div>
  );
}
