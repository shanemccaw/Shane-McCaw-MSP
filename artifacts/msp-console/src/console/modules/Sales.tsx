/**
 * Sales — MSP-wide (Operations) module page (Git #2643, Feature #2568).
 * Mounts at `/ops/sales` (`Design/MSP_Console/design_handoff_msp_console/Sales.dc.html`,
 * README screen 29). Four tabs, faithful to the design's own logic class:
 *
 *   Offers        — generated sales offers and their real lifecycle.
 *   Bundles       — MSP-branded wrappers around platform monitoring packages.
 *   Packages      — the real monitoring-package catalogue bundles draw from.
 *   Who has what  — every customer's real bundle assignments, across bundles.
 *
 * Wired against artifacts/api-server/src/routes/msp-sales-offers.ts,
 * msp-sow.ts and msp-sales-bundles.ts via src/api/sales-api.ts — see that
 * file's header for the full route map and the real state-machine notes.
 *
 * The one deliberate divergence from the design mock: `Sales.dc.html` lets an
 * operator flip an offer straight to "accepted" from the drawer and warns
 * that doing so "delivers nothing" — true of the mock's fake state-only
 * transition. The real backend has no such transition (PATCH .../state 422s
 * on "accepted"); accepting for real always calls
 * `POST /api/msp/offers/:offerId/accept`, which creates a signable SOW, opens
 * a real Stripe Checkout Session, or activates a genuine $0 item. This module
 * surfaces that action's real, still-open financial-correctness risk
 * (#3400/#3405/#3650) instead of the mock's "delivers nothing" language.
 *
 * No fixture module — every row is a real server response or an honest
 * loading/empty/error state.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { surface, text, signal, action, border } from "@/console/tokens";
import { useDirectory, type DirectoryCustomer } from "@/api/console-api";
import {
  useAcceptOffer, useAllBundleAssignments, useAssignBundle, useBundleAssignments,
  useCreateBundle, useDeleteBundle, useDeleteOffer, useExpireStaleOffers, useExpireSow,
  useGenerateOffers, useOpenSowDocument, useRevokeAssignment, useSalesBundleDetail,
  useSalesBundles, useSalesMonitoringPackages, useSalesOfferEvents, useSalesOffers,
  useSowDetail, useSowsByOffer, useTriggerSowCharge, useUpdateBundle, useUpdateOffer,
  useUpdateOfferState,
  type AcceptOfferResult, type MonitoringPackageFull, type MspSalesBundle,
  type MspSalesBundleAssignment, type MspSalesBundleStatus, type SalesOffer,
  type SalesOfferState,
} from "@/api/sales-api";

type Tab = "offers" | "bundles" | "packages" | "assignments";

const TONE: Record<string, { strong: string; text: string; tint: string; border: string }> = {
  green: signal.ok,
  amber: signal.warning,
  red: signal.critical,
  blue: signal.info,
  violet: { strong: signal.notice.strong, text: "#ddd6fe", tint: signal.notice.tint, border: signal.notice.border },
  slate: { strong: signal.neutral.strong, text: text.muted, tint: signal.neutral.tint, border: signal.neutral.border },
};

const OFFER_STATE_TONE: Record<SalesOfferState, keyof typeof TONE> = {
  draft: "slate", sent: "blue", accepted: "green", rejected: "red", expired: "amber",
};
const BUNDLE_STATUS_TONE: Record<MspSalesBundleStatus, keyof typeof TONE> = {
  draft: "slate", active: "green", archived: "amber",
};
const ASSIGN_STATUS_TONE: Record<string, keyof typeof TONE> = {
  active: "green", suspended: "amber", revoked: "slate",
};

function money(cents: number): string {
  if (cents === 0) return "$0";
  const d = cents / 100;
  if (d >= 1000) return "$" + (d / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return "$" + Math.round(d);
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function cardStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, ...extra };
}
function pill(t: { strong: string; text: string; tint: string; border: string }, extra?: React.CSSProperties): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999,
    background: t.tint, border: `1px solid ${t.border}`, fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: "nowrap",
    ...extra,
  };
}
function emptyState(icon: string, tone: keyof typeof TONE, title: string, body: string) {
  const t = TONE[tone];
  return (
    <div style={cardStyle({ padding: "44px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" })}>
      <span style={{ width: 42, height: 42, borderRadius: 13, background: t.tint, border: `1px solid ${t.border}`, padding: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={20} color={t.strong} />
      </span>
      <span style={{ fontSize: 15, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>{title}</span>
      <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 440, textWrap: "pretty" }}>{body}</span>
    </div>
  );
}
function primaryBtn(disabled?: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 13px", borderRadius: 8,
    border: `1px solid ${disabled ? border.card : action.base}`, background: disabled ? "transparent" : action.base,
    color: disabled ? text.faint : "#fff", fontSize: 12.5, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap",
  };
}
function ghostBtn(): React.CSSProperties {
  return {
    height: 34, padding: "0 13px", borderRadius: 8, border: `1px solid ${border.card}`,
    background: "transparent", color: text.secondary, fontSize: 12.5, cursor: "pointer",
  };
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function Sales({ mspId, isAdmin }: { mspId: number | null; isAdmin: boolean }) {
  const [tab, setTab] = useState<Tab>("offers");
  const [offerFilter, setOfferFilter] = useState<SalesOfferState | "all">("all");
  const [bundleFilter, setBundleFilter] = useState<MspSalesBundleStatus | "all">("all");
  const [assignFilter, setAssignFilter] = useState<"active" | "revoked" | "all">("active");
  const [selectedOfferId, setSelectedOfferId] = useState<number | null>(null);
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingBundle, setEditingBundle] = useState<MspSalesBundle | null>(null);

  const directory = useDirectory();
  const customers = useMemo(() => directory.data?.customers ?? [], [directory.data]);
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const offersQuery = useSalesOffers(mspId, offerFilter);
  const offers = offersQuery.data?.offers ?? [];
  const bundlesQuery = useSalesBundles("all");
  const bundlesAll = bundlesQuery.data?.bundles ?? [];
  const bundles = bundleFilter === "all" ? bundlesAll : bundlesAll.filter((b) => b.status === bundleFilter);
  const packagesQuery = useSalesMonitoringPackages();
  const packages = packagesQuery.data?.packages ?? [];
  const packageByKey = useMemo(() => new Map(packages.map((p) => [p.key, p])), [packages]);

  const expireStale = useExpireStaleOffers(mspId);

  const selectedOffer = offers.find((o) => o.id === selectedOfferId) ?? null;

  const tabDefs: { id: Tab; label: string; count: string }[] = [
    { id: "offers", label: "Offers", count: String(offers.length) },
    { id: "bundles", label: "Bundles", count: String(bundlesAll.length) },
    { id: "packages", label: "Packages", count: String(packages.length) },
    { id: "assignments", label: "Who has what", count: "" },
  ];

  if (mspId == null) {
    return emptyState(
      "shield-alert", "amber", "This session can't open Sales",
      "Every route behind this screen resolves scope from your session's own MSP claim, and this session carries none — the same 403 the README calls out for a scope-less PlatformAdmin session.",
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {tabDefs.map((t) => {
          const activeTab = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 7,
                border: `1px solid ${activeTab ? "rgba(96,165,250,.3)" : border.card}`,
                background: activeTab ? "rgba(37,99,235,.18)" : "transparent",
                color: activeTab ? "#bfdbfe" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {t.label}
              {t.count && <span style={{ fontSize: 10.5, fontFamily: "Menlo, monospace", color: activeTab ? signal.info.strong : text.faint }}>{t.count}</span>}
            </button>
          );
        })}
      </div>

      {tab === "offers" && (
        <OffersTab
          offers={offers} loading={offersQuery.isLoading} error={offersQuery.isError}
          filter={offerFilter} onFilter={setOfferFilter}
          customerById={customerById}
          onOpen={setSelectedOfferId}
          onOpenGenerate={() => setGenerateOpen(true)}
          onExpireStale={() => expireStale.mutate(undefined, {
            onSuccess: (r) => toast.success(r.expired > 0 ? `${r.expired} stale offer${r.expired === 1 ? "" : "s"} closed` : "No overdue offers to close"),
            onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to close stale offers"),
          })}
          expiring={expireStale.isPending}
        />
      )}

      {tab === "bundles" && (
        <BundlesTab
          bundles={bundles} allCount={bundlesAll.length} loading={bundlesQuery.isLoading} error={bundlesQuery.isError}
          filter={bundleFilter} onFilter={setBundleFilter}
          packageByKey={packageByKey}
          isAdmin={isAdmin}
          onOpen={setSelectedBundleId}
          onBuild={() => { setEditingBundle(null); setBuilderOpen(true); }}
        />
      )}

      {tab === "packages" && (
        packagesQuery.isLoading ? <span style={{ fontSize: 11.5, color: text.muted }}>Loading packages…</span> :
        packagesQuery.isError ? <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load the monitoring package catalogue.</span> :
        <PackagesTab packages={packages} />
      )}

      {tab === "assignments" && (
        <AssignmentsTab bundles={bundlesAll} bundlesLoading={bundlesQuery.isLoading} filter={assignFilter} onFilter={setAssignFilter} isAdmin={isAdmin} />
      )}

      {selectedOffer && (
        <OfferDrawer
          key={selectedOffer.id}
          offer={selectedOffer}
          customer={selectedOffer.customerId != null ? customerById.get(selectedOffer.customerId) ?? null : null}
          mspId={mspId}
          onClose={() => setSelectedOfferId(null)}
        />
      )}

      {generateOpen && (
        <GenerateDrawer mspId={mspId} customers={customers} onClose={() => setGenerateOpen(false)} />
      )}

      {selectedBundleId && (
        <BundleDrawer
          key={selectedBundleId}
          bundleId={selectedBundleId}
          isAdmin={isAdmin}
          customers={customers}
          onClose={() => setSelectedBundleId(null)}
          onEdit={(b) => { setSelectedBundleId(null); setEditingBundle(b); setBuilderOpen(true); }}
        />
      )}

      {builderOpen && (
        <BuilderDrawer
          key={editingBundle?.bundleId ?? "new"}
          packages={packages}
          editing={editingBundle}
          onClose={() => { setBuilderOpen(false); setEditingBundle(null); }}
        />
      )}
    </div>
  );
}

// ── Offers tab ────────────────────────────────────────────────────────────────

const OFFER_FILTERS: (SalesOfferState | "all")[] = ["all", "draft", "sent", "accepted", "rejected", "expired"];

function OffersTab({
  offers, loading, error, filter, onFilter, customerById, onOpen, onOpenGenerate, onExpireStale, expiring,
}: {
  offers: SalesOffer[]; loading: boolean; error: boolean;
  filter: SalesOfferState | "all"; onFilter: (f: SalesOfferState | "all") => void;
  customerById: Map<number, DirectoryCustomer>;
  onOpen: (id: number) => void;
  onOpenGenerate: () => void;
  onExpireStale: () => void;
  expiring: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        {OFFER_FILTERS.map((f) => {
          const activeF = filter === f;
          return (
            <button
              key={f}
              onClick={() => onFilter(f)}
              style={{
                height: 28, padding: "0 10px", borderRadius: 7,
                border: `1px solid ${activeF ? "rgba(96,165,250,.3)" : border.card}`,
                background: activeF ? "rgba(37,99,235,.18)" : "transparent",
                color: activeF ? "#bfdbfe" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {f === "all" ? "All offers" : f}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button onClick={onOpenGenerate} style={{ ...primaryBtn(), height: 28, padding: "0 11px" }}>
          <Icon name="sparkles" size={12} />
          Find offers for a customer
        </button>
        <button
          onClick={onExpireStale}
          disabled={expiring}
          title="Closes every sent offer whose date has passed. Nothing does this on a schedule."
          style={{ ...ghostBtn(), height: 28, padding: "0 11px", display: "flex", alignItems: "center", gap: 7, cursor: expiring ? "wait" : "pointer" }}
        >
          <Icon name="calendar-x" size={12} />
          {expiring ? "Closing…" : "Close stale offers"}
        </button>
      </div>

      {loading ? <span style={{ fontSize: 11.5, color: text.muted }}>Loading offers…</span> :
       error ? <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load sales offers.</span> :
       offers.length === 0 ? emptyState(
          "sparkles", "blue",
          filter === "all" ? "Nothing to sell them yet" : "None in that state",
          filter === "all"
            ? "The engine reads a customer's live signals and matches them against the product catalogue. Nothing has been run for anyone in the book yet."
            : "Offers move through draft, sent, and then one of accepted, rejected or expired. This filter will fill as they do.",
        ) :
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {offers.map((o) => {
            const t = TONE[OFFER_STATE_TONE[o.state]];
            const sc = TONE[o.score >= 85 ? "green" : o.score >= 70 ? "blue" : "slate"];
            const customer = o.customerId != null ? customerById.get(o.customerId) : null;
            const expiry = o.state === "sent" && o.expiresAt ? `expires ${fmtDate(o.expiresAt)}`
              : o.state === "expired" && o.closedAt ? `expired ${fmtDate(o.closedAt)}`
              : "no clock";
            return (
              <div
                key={o.id}
                onClick={() => onOpen(o.id)}
                style={{
                  ...cardStyle({ padding: 14, display: "flex", gap: 12, alignItems: "center", cursor: "pointer" }),
                  borderColor: o.state === "sent" ? "rgba(96,165,250,.24)" : border.card,
                }}
              >
                <span style={{ width: 42, height: 42, flex: "0 0 42px", borderRadius: 12, background: sc.tint, border: `1px solid ${sc.border}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: 800, lineHeight: 1, color: sc.strong }}>{o.score}</span>
                  <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: ".08em", color: text.label }}>FIT</span>
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{o.title}</span>
                    <span style={pill(t)}>{o.state}</span>
                  </div>
                  <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{o.rationale ?? "—"}</span>
                  <span style={{ fontSize: 11, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {(customer?.name ?? (o.customerId ? `customer ${o.customerId}` : "no customer"))} · found {fmtDate(o.createdAt)}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flex: "0 0 auto" }}>
                  <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.01em", color: text.title }}>{money(o.adjustedPriceCents)}</span>
                  <span style={{ fontSize: 11, color: o.state === "sent" ? signal.warning.text : text.label, whiteSpace: "nowrap" }}>{expiry}</span>
                </div>
              </div>
            );
          })}
        </div>}
    </div>
  );
}

function OfferDrawer({
  offer, customer, mspId, onClose,
}: { offer: SalesOffer; customer: DirectoryCustomer | null; mspId: number; onClose: () => void }) {
  const eventsQuery = useSalesOfferEvents(offer.id);
  const events = eventsQuery.data?.events ?? [];
  const sowsQuery = useSowsByOffer(offer.state === "accepted" ? offer.id : null);
  const linkedSow = sowsQuery.data?.items[0] ?? null;

  const [sowViewId, setSowViewId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(offer.title);
  const [rationaleDraft, setRationaleDraft] = useState(offer.rationale ?? "");
  const [acceptResult, setAcceptResult] = useState<AcceptOfferResult | null>(null);

  const updateState = useUpdateOfferState(mspId);
  const updateOffer = useUpdateOffer(mspId);
  const deleteOffer = useDeleteOffer(mspId);
  const acceptOffer = useAcceptOffer(mspId);

  const t = TONE[OFFER_STATE_TONE[offer.state]];

  const facts: { label: string; value: string; color: string }[] = [
    { label: "PRICE", value: money(offer.adjustedPriceCents), color: text.title },
    { label: "FIT", value: `${offer.score} of 100`, color: offer.score >= 85 ? signal.ok.text : text.secondary },
    { label: "FOUND", value: fmtDate(offer.createdAt), color: text.muted },
    { label: "EXPIRES", value: offer.expiresAt ? fmtDate(offer.expiresAt) : "no clock yet", color: offer.expiresAt ? signal.warning.text : text.label },
    { label: "PRICED FROM", value: "the product catalogue", color: text.muted },
  ];

  return (
    <Overlay onClose={onClose}>
      <DrawerHeader eyebrow={offer.state.toUpperCase()} eyebrowColor={t.strong} title={offer.title} subtitle={customer?.name ?? (offer.customerId ? `customer ${offer.customerId}` : "no customer")} onClose={onClose} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 11 }}>
        {facts.map((f) => (
          <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{f.label}</span>
            <span style={{ fontSize: 12.5, color: f.color, textWrap: "pretty" }}>{f.value}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>WHY IT FIRED</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {offer.firedSignalKeys.length === 0
            ? <span style={{ fontSize: 11.5, color: text.faint }}>No signal keys recorded on this offer.</span>
            : offer.firedSignalKeys.map((s) => (
              <span key={s} style={pill(TONE.violet)}>{s}</span>
            ))}
        </div>
        {offer.rationale && <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{offer.rationale}</span>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>WHAT HAPPENED TO IT</span>
        {eventsQuery.isLoading ? <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span> :
         events.length === 0 ? <span style={{ fontSize: 11.5, color: text.faint }}>No lifecycle events recorded yet.</span> :
         events.map((e) => (
          <div key={e.id} style={{ display: "flex", gap: 9, alignItems: "baseline", minWidth: 0 }}>
            <Icon name={eventIcon(e.eventName)} size={12} color={eventColor(e.eventName)} style={{ flex: "0 0 12px", marginTop: 3 }} />
            <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty", flex: 1 }}>{eventText(e.eventName, e.payload)}</span>
            <span style={{ fontSize: 10.5, color: text.faint, whiteSpace: "nowrap" }}>{fmtDateTime(e.createdAt)}</span>
          </div>
        ))}
      </div>

      {offer.state === "sent" && !acceptResult && (
        <div style={{ display: "flex", gap: 10, padding: "12px 13px", borderRadius: 10, border: `1px solid ${signal.warning.border}`, background: signal.warning.tint }}>
          <Icon name="triangle-alert" size={15} color={signal.warning.strong} style={{ flex: "0 0 15px", marginTop: 2 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>Accept does real work — and it's final</span>
            <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>
              This calls the real accept endpoint: it creates a signable SOW, opens a Stripe checkout, or activates a genuine free item, depending on the service. There is no way back out of accepted. Known open risk on this path: a failed paid checkout can leave the offer stuck accepted with no charge collected (#3400), a free item ignores its own free-checkout setting (#3405), and the add-on/subscription checkout has no webhook consumer yet (#3650).
            </span>
          </div>
        </div>
      )}

      {acceptResult && <AcceptResultPanel result={acceptResult} onViewSow={(sowId) => setSowViewId(sowId)} />}

      {offer.state === "accepted" && linkedSow && !acceptResult && (
        <button onClick={() => setSowViewId(linkedSow.sowId)} style={{ ...ghostBtn(), display: "flex", alignItems: "center", gap: 7, alignSelf: "flex-start" }}>
          <Icon name="file-text" size={13} />
          View the SOW this created
        </button>
      )}

      {editing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 13, borderRadius: 10, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.4)" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: text.faint }}>EDIT WORDING (DRAFT ONLY)</span>
          <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} placeholder="Title"
            style={{ height: 32, padding: "0 10px", borderRadius: 7, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12.5, outline: "none" }} />
          <textarea value={rationaleDraft} onChange={(e) => setRationaleDraft(e.target.value)} placeholder="Rationale" rows={3}
            style={{ padding: 10, borderRadius: 7, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12.5, outline: "none", resize: "vertical" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => updateOffer.mutate({ id: offer.id, title: titleDraft, rationale: rationaleDraft }, {
                onSuccess: () => { setEditing(false); toast.success("Offer updated"); },
                onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update offer"),
              })}
              disabled={updateOffer.isPending || titleDraft.trim().length === 0}
              style={primaryBtn(updateOffer.isPending || titleDraft.trim().length === 0)}
            >
              {updateOffer.isPending ? "Saving…" : "Save"}
            </button>
            <button onClick={() => { setEditing(false); setTitleDraft(offer.title); setRationaleDraft(offer.rationale ?? ""); }} style={ghostBtn()}>Cancel</button>
          </div>
        </div>
      )}

      {rejecting && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 13, borderRadius: 10, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.4)" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: text.faint }}>REASON (OPTIONAL)</span>
          <textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} rows={2}
            style={{ padding: 10, borderRadius: 7, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12.5, outline: "none", resize: "vertical" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => updateState.mutate({ id: offer.id, newState: "rejected", rejectionReason: rejectionReason.trim() || undefined }, {
                onSuccess: () => { setRejecting(false); toast.success("Offer marked rejected"); },
                onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to reject offer"),
              })}
              disabled={updateState.isPending}
              style={primaryBtn(updateState.isPending)}
            >
              {updateState.isPending ? "Rejecting…" : "Confirm rejection"}
            </button>
            <button onClick={() => setRejecting(false)} style={ghostBtn()}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {offer.state === "draft" && (
            <>
              <button
                onClick={() => updateState.mutate({ id: offer.id, newState: "sent" }, {
                  onSuccess: () => toast.success("Offer sent"),
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to send offer"),
                })}
                disabled={updateState.isPending}
                style={primaryBtn(updateState.isPending)}
              >
                <Icon name="send" size={13} />
                {updateState.isPending ? "Sending…" : "Send it"}
              </button>
              <button onClick={() => setEditing((v) => !v)} style={{ ...ghostBtn(), display: "flex", alignItems: "center", gap: 7 }}>
                <Icon name="file-pen" size={13} />
                Edit the wording
              </button>
              <button
                onClick={() => deleteOffer.mutate(offer.id, {
                  onSuccess: () => { toast.success("Draft deleted"); onClose(); },
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete offer"),
                })}
                disabled={deleteOffer.isPending}
                style={{ ...ghostBtn(), display: "flex", alignItems: "center", gap: 7, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint, color: signal.critical.text }}
              >
                <Icon name="trash-2" size={13} />
                Delete
              </button>
            </>
          )}
          {offer.state === "sent" && !acceptResult && (
            <>
              <button onClick={() => setRejecting((v) => !v)} style={{ ...ghostBtn(), display: "flex", alignItems: "center", gap: 7 }}>
                <Icon name="circle-x" size={13} />
                Mark rejected
              </button>
              <button
                onClick={() => acceptOffer.mutate(offer.id, {
                  onSuccess: (result) => {
                    setAcceptResult(result);
                    if (result.outcome === "sow_created") setSowViewId(result.sowId);
                  },
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to accept offer"),
                })}
                disabled={acceptOffer.isPending}
                style={{ ...primaryBtn(acceptOffer.isPending), border: `1px solid ${signal.critical.border}`, background: acceptOffer.isPending ? "transparent" : signal.critical.tint, color: acceptOffer.isPending ? text.faint : signal.critical.text }}
              >
                <Icon name="triangle-alert" size={13} />
                {acceptOffer.isPending ? "Accepting…" : "Accept (real, final)"}
              </button>
            </>
          )}
          {(offer.state === "accepted" || offer.state === "rejected" || offer.state === "expired") && (
            <span style={{ ...ghostBtn(), display: "flex", alignItems: "center", gap: 7, cursor: "not-allowed", opacity: 0.6 }}>
              <Icon name="lock" size={13} />
              Closed
            </span>
          )}
        </div>
        <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
          {offer.state === "draft" ? "A draft can be edited or deleted. Once sent, neither is possible again."
            : offer.state === "sent" ? "Sending again is not a thing — the offer moves forward only."
            : offer.rejectionReason ? `Closed. Reason on file: "${offer.rejectionReason}"`
            : "This offer is at the end of its life. Raise a new one instead."}
        </span>
      </div>

      {sowViewId && <SowDrawer sowId={sowViewId} onClose={() => setSowViewId(null)} />}
    </Overlay>
  );
}

function eventIcon(eventName: string): string {
  if (eventName.includes("sent")) return "send";
  if (eventName.includes("accepted")) return "circle-check-big";
  if (eventName.includes("rejected")) return "circle-x";
  if (eventName.includes("expired")) return "calendar-x";
  if (eventName.includes("generated") || eventName.includes("scored")) return "sparkles";
  return "clock";
}
function eventColor(eventName: string): string {
  if (eventName.includes("accepted")) return signal.ok.strong;
  if (eventName.includes("rejected")) return signal.critical.strong;
  if (eventName.includes("expired")) return signal.warning.strong;
  if (eventName.includes("generated") || eventName.includes("scored")) return signal.notice.strong;
  return signal.info.strong;
}
function eventText(eventName: string, payload: Record<string, unknown>): string {
  const reason = typeof payload["rejectionReason"] === "string" ? payload["rejectionReason"] : null;
  const label = eventName.replace(/^offer\./, "").replace(/_/g, " ");
  return reason ? `${label} — "${reason}"` : label;
}

function AcceptResultPanel({ result, onViewSow }: { result: AcceptOfferResult; onViewSow: (sowId: string) => void }) {
  const tone = result.outcome === "sow_created" || result.outcome === "free_activated" || result.outcome === "payment_processed" ? TONE.green : TONE.blue;
  return (
    <div style={{ border: `1px solid ${tone.border}`, borderRadius: 11, background: tone.tint, padding: 14, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Icon name="circle-check-big" size={18} color={tone.strong} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>
          {result.outcome === "sow_created" ? "SOW created" : result.outcome === "checkout_required" ? "Checkout session created" : result.outcome === "free_activated" ? "Free item activated" : "Payment processed"}
        </span>
      </div>
      <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{result.outcome === "checkout_required" ? "A Stripe Checkout Session was created for this offer." : result.message}</span>
      {result.outcome === "sow_created" && (
        <button onClick={() => onViewSow(result.sowId)} style={{ ...ghostBtn(), alignSelf: "flex-start" }}>View the SOW</button>
      )}
      {result.outcome === "checkout_required" && result.checkoutUrl && (
        <a href={result.checkoutUrl} target="_blank" rel="noopener noreferrer" style={{ ...ghostBtn(), alignSelf: "flex-start", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 7 }}>
          <Icon name="external-link" size={12} />
          Open the checkout page
        </a>
      )}
    </div>
  );
}

// ── Generate drawer ("Find offers for a customer") ───────────────────────────

function GenerateDrawer({ mspId, customers, onClose }: { mspId: number; customers: DirectoryCustomer[]; onClose: () => void }) {
  const [pickedId, setPickedId] = useState<number | null>(null);
  const generate = useGenerateOffers(mspId);

  return (
    <Overlay onClose={onClose} width={460}>
      <DrawerHeader eyebrow="FIND OFFERS" eyebrowColor={signal.info.text} title="What should we be selling them?" onClose={onClose} />

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>Which customer</span>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {customers.length === 0
            ? <span style={{ fontSize: 11.5, color: text.faint }}>No customers in the book yet.</span>
            : customers.map((c) => {
              const isPicked = pickedId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setPickedId(c.id)}
                  style={{
                    height: 30, padding: "0 11px", borderRadius: 7,
                    border: `1px solid ${isPicked ? "rgba(96,165,250,.32)" : border.card}`,
                    background: isPicked ? "rgba(37,99,235,.18)" : "transparent",
                    color: isPicked ? "#bfdbfe" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  {c.name}
                </button>
              );
            })}
        </div>
        <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>Their live signals are read against the product catalogue. Prices come from the catalogue, never from anything typed here.</span>
      </div>

      {generate.data && (
        <div style={{
          border: `1px solid ${generate.data.insertedOfferIds.length > 0 ? signal.ok.border : border.card}`, borderRadius: 11,
          background: generate.data.insertedOfferIds.length > 0 ? signal.ok.tint : "rgba(148,163,184,.06)",
          padding: 14, display: "flex", flexDirection: "column", gap: 10, minWidth: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name={generate.data.insertedOfferIds.length > 0 ? "circle-check-big" : "circle-minus"} size={22} color={generate.data.insertedOfferIds.length > 0 ? signal.ok.strong : text.muted} />
            <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong }}>
                {generate.data.insertedOfferIds.length > 0 ? `${generate.data.insertedOfferIds.length} new offer${generate.data.insertedOfferIds.length === 1 ? "" : "s"} raised` : "Ran, nothing new"}
              </span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
                {generate.data.insertedOfferIds.length > 0
                  ? "They arrive as drafts and nobody sees them until you send them from the Offers tab."
                  : "The same signals produced the same matches as last time (or none matched), so nothing was raised again. Running this repeatedly never duplicates an offer."}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
            <span style={{ fontSize: 12, color: text.secondary, flex: 1 }}>Candidates considered</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: text.title }}>{generate.data.candidateCount}</span>
          </div>
          {generate.data.firedSignals.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {generate.data.firedSignals.map((s) => <span key={s} style={pill(TONE.violet)}>{s}</span>)}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
        <button
          onClick={() => pickedId != null && generate.mutate(pickedId, {
            onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to generate offers"),
          })}
          disabled={pickedId == null || generate.isPending}
          title={pickedId == null ? "Pick a customer first" : ""}
          style={{ ...primaryBtn(pickedId == null || generate.isPending), flex: 1, height: 38 }}
        >
          {generate.isPending ? "Running…" : generate.data ? "Run it again" : "Run it"}
        </button>
        <button onClick={onClose} style={{ ...ghostBtn(), height: 38 }}>Close</button>
      </div>
    </Overlay>
  );
}

// ── Bundles tab ───────────────────────────────────────────────────────────────

const BUNDLE_FILTERS: { id: MspSalesBundleStatus | "all"; label: string }[] = [
  { id: "all", label: "All bundles" }, { id: "draft", label: "Drafts" }, { id: "active", label: "Live" }, { id: "archived", label: "Archived" },
];

function BundlesTab({
  bundles, allCount, loading, error, filter, onFilter, packageByKey, isAdmin, onOpen, onBuild,
}: {
  bundles: MspSalesBundle[]; allCount: number; loading: boolean; error: boolean;
  filter: MspSalesBundleStatus | "all"; onFilter: (f: MspSalesBundleStatus | "all") => void;
  packageByKey: Map<string, MonitoringPackageFull>;
  isAdmin: boolean; onOpen: (bundleId: string) => void; onBuild: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        {BUNDLE_FILTERS.map((f) => {
          const activeF = filter === f.id;
          return (
            <button key={f.id} onClick={() => onFilter(f.id)} style={{
              height: 28, padding: "0 10px", borderRadius: 7,
              border: `1px solid ${activeF ? "rgba(96,165,250,.3)" : border.card}`,
              background: activeF ? "rgba(37,99,235,.18)" : "transparent",
              color: activeF ? "#bfdbfe" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
            }}>{f.label}</button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button
          onClick={isAdmin ? onBuild : undefined}
          title={isAdmin ? "" : "Only an MSP admin can build or change a bundle — pricing decisions are not an operator's to make"}
          disabled={!isAdmin}
          style={{ ...primaryBtn(!isAdmin), height: 28, padding: "0 11px" }}
        >
          <Icon name="layers" size={12} />
          Build a bundle
        </button>
      </div>

      {loading ? <span style={{ fontSize: 11.5, color: text.muted }}>Loading bundles…</span> :
       error ? <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load sales bundles.</span> :
       bundles.length === 0 ? emptyState(
          "layers", "blue", allCount === 0 ? "No bundles yet" : "None in that state",
          "A bundle is your own branded wrapper around the platform's monitoring packages, with your own price on it.",
        ) :
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {bundles.map((b) => {
            const t = TONE[BUNDLE_STATUS_TONE[b.status]];
            const known = b.monitoringPackageKeys.filter((k) => packageByKey.has(k));
            const orphaned = b.monitoringPackageKeys.length > 0 && known.length === 0;
            return (
              <div key={b.bundleId} onClick={() => onOpen(b.bundleId)} style={cardStyle({
                padding: 14, display: "flex", flexDirection: "column", gap: 11, minWidth: 0, cursor: "pointer",
                borderColor: orphaned ? signal.warning.border : border.card,
              })}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 9, background: t.tint, border: `1px solid ${t.border}`, color: t.strong, padding: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name="layers" size={14} />
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: text.strong, textWrap: "pretty", minWidth: 0 }}>{b.name}</span>
                  <span style={pill(t)}>{b.status === "active" ? "live" : b.status}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.01em", color: text.title, whiteSpace: "nowrap" }}>
                    {b.resalePriceCents === 0 ? "no price set" : `${money(b.resalePriceCents)}/mo`}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {b.monitoringPackageKeys.slice(0, 5).map((k) => {
                    const ok = packageByKey.has(k);
                    const ct = TONE[ok ? "blue" : "red"];
                    return <span key={k} style={{ ...pill(ct), fontFamily: "Menlo, monospace" }}>{k}</span>;
                  })}
                  {b.monitoringPackageKeys.length > 5 && <span style={pill(TONE.slate)}>+{b.monitoringPackageKeys.length - 5} more</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11.5, color: text.muted, whiteSpace: "nowrap" }}>{money(b.internalCostCents)} cost to you</span>
                  <span style={{ fontSize: 11.5, color: text.label, whiteSpace: "nowrap" }}>{b.trialDays ? `${b.trialDays} day trial` : "no trial"}</span>
                </div>
                {orphaned && (
                  <div style={{ display: "flex", gap: 9, padding: "10px 12px", borderRadius: 9, border: `1px solid ${signal.warning.border}`, background: signal.warning.tint }}>
                    <Icon name="triangle-alert" size={14} color={signal.warning.strong} style={{ flex: "0 0 14px", marginTop: 2 }} />
                    <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>Every package this bundle names is missing from the catalogue, so it is selling nothing. It reads as an empty bundle rather than a broken one.</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>}
    </div>
  );
}

function BundleDrawer({
  bundleId, isAdmin, customers, onClose, onEdit,
}: { bundleId: string; isAdmin: boolean; customers: DirectoryCustomer[]; onClose: () => void; onEdit: (b: MspSalesBundle) => void }) {
  const detail = useSalesBundleDetail(bundleId);
  const assignments = useBundleAssignments(bundleId);
  const updateBundle = useUpdateBundle();
  const deleteBundle = useDeleteBundle();
  const assignBundle = useAssignBundle();
  const revoke = useRevokeAssignment();
  const [pickCustomerId, setPickCustomerId] = useState<number | null>(null);

  if (detail.isLoading) return <Overlay onClose={onClose}><span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span></Overlay>;
  if (detail.isError || !detail.data) return <Overlay onClose={onClose}><span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load this bundle.</span></Overlay>;

  const { bundle, packages: bvPackages, activeAssignmentCount } = detail.data;
  const t = TONE[BUNDLE_STATUS_TONE[bundle.status]];
  const activeAssignments = (assignments.data?.assignments ?? []).filter((a) => a.status === "active");
  const assignedCustomerIds = new Set(activeAssignments.map((a) => a.customerId));
  const availableCustomers = customers.filter((c) => !assignedCustomerIds.has(c.id));

  return (
    <Overlay onClose={onClose}>
      <DrawerHeader
        eyebrow={bundle.status === "active" ? "LIVE BUNDLE" : bundle.status.toUpperCase()}
        eyebrowColor={t.strong} title={bundle.name}
        subtitle={`Built ${fmtDate(bundle.createdAt)} · ${bundle.monitoringPackageKeys.length} package${bundle.monitoringPackageKeys.length === 1 ? "" : "s"} named`}
        onClose={onClose}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 11 }}>
        {[
          { label: "YOUR PRICE", value: bundle.resalePriceCents === 0 ? "not set" : `${money(bundle.resalePriceCents)}/mo`, color: bundle.resalePriceCents === 0 ? text.label : text.title },
          { label: "COSTS YOU", value: money(bundle.internalCostCents), color: text.muted },
          { label: "ON IT NOW", value: String(activeAssignmentCount), color: activeAssignmentCount > 0 ? signal.ok.text : text.muted },
          { label: "TRIAL", value: bundle.trialDays ? `${bundle.trialDays} days` : "none", color: text.muted },
        ].map((f) => (
          <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{f.label}</span>
            <span style={{ fontSize: 12.5, color: f.color, textWrap: "pretty" }}>{f.value}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>WHAT IS IN IT</span>
        {bvPackages.length > 0 ? bvPackages.map((p) => (
          <div key={p.key} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 9, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.4)", minWidth: 0 }}>
            <Icon name="package" size={14} color={signal.info.strong} style={{ flex: "0 0 14px" }} />
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 12.5, color: text.body, textWrap: "pretty" }}>{p.label}</span>
              <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.key}</span>
            </span>
            <span style={{ fontSize: 11.5, color: text.muted, whiteSpace: "nowrap" }}>{money(p.platformCostCents)}</span>
          </div>
        )) : (
          <>
            <div style={{ display: "flex", gap: 10, padding: "12px 13px", borderRadius: 10, border: `1px solid ${signal.warning.border}`, background: signal.warning.tint }}>
              <Icon name="triangle-alert" size={15} color={signal.warning.strong} style={{ flex: "0 0 15px", marginTop: 2 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>None of these packages exist</span>
                <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>This bundle names {bundle.monitoringPackageKeys.length} package{bundle.monitoringPackageKeys.length === 1 ? "" : "s"} and the catalogue has none of them.</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {bundle.monitoringPackageKeys.map((k) => <span key={k} style={{ ...pill(TONE.red), fontFamily: "Menlo, monospace" }}>{k}</span>)}
            </div>
          </>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>WHO IS ON IT</span>
        {assignments.isLoading ? <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span> :
         activeAssignments.length === 0 ? <span style={{ fontSize: 11.5, color: text.faint }}>Nobody is on this bundle.</span> :
         activeAssignments.map((a) => (
          <div key={a.assignmentId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 9, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.4)" }}>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 12.5, color: text.strong }}>{a.customerName ?? `customer ${a.customerId}`}</span>
              <span style={{ fontSize: 11, color: text.label }}>{a.customerDomain ?? "—"}</span>
            </span>
            {isAdmin && (
              <button
                onClick={() => revoke.mutate({ bundleId: bundle.bundleId, assignmentId: a.assignmentId }, {
                  onSuccess: () => toast.success("Taken off the bundle"),
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to revoke assignment"),
                })}
                disabled={revoke.isPending}
                style={{ ...ghostBtn(), height: 28, padding: "0 10px", fontSize: 11.5, border: `1px solid ${signal.critical.border}`, color: signal.critical.text }}
              >
                Take off
              </button>
            )}
          </div>
        ))}

        {isAdmin && bundle.status === "active" && (
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", paddingTop: 4 }}>
            <select
              value={pickCustomerId ?? ""}
              onChange={(e) => setPickCustomerId(e.target.value ? Number(e.target.value) : null)}
              style={{ height: 30, borderRadius: 7, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: text.body, fontSize: 12, padding: "0 8px", flex: 1, minWidth: 160 }}
            >
              <option value="">Put a customer on it…</option>
              {availableCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button
              onClick={() => pickCustomerId != null && assignBundle.mutate({ bundleId: bundle.bundleId, customerId: pickCustomerId }, {
                onSuccess: () => { toast.success("Customer put on the bundle"); setPickCustomerId(null); },
                onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to assign bundle"),
              })}
              disabled={pickCustomerId == null || assignBundle.isPending}
              style={primaryBtn(pickCustomerId == null || assignBundle.isPending)}
            >
              {assignBundle.isPending ? "Assigning…" : "Assign"}
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isAdmin ? (
            <span style={{ ...ghostBtn(), display: "flex", alignItems: "center", gap: 7, cursor: "not-allowed", opacity: 0.6 }}>
              <Icon name="lock" size={13} />
              Admin only
            </span>
          ) : bundle.status === "draft" ? (
            <>
              <button
                onClick={() => updateBundle.mutate({ bundleId: bundle.bundleId, status: "active" }, {
                  onSuccess: () => toast.success("Bundle is live"),
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to make it live"),
                })}
                disabled={updateBundle.isPending}
                style={primaryBtn(updateBundle.isPending)}
              >
                <Icon name="circle-check-big" size={13} />
                Make it live
              </button>
              <button onClick={() => onEdit(bundle)} style={{ ...ghostBtn(), display: "flex", alignItems: "center", gap: 7 }}>
                <Icon name="file-pen" size={13} />
                Edit
              </button>
              <button
                onClick={() => deleteBundle.mutate(bundle.bundleId, {
                  onSuccess: () => { toast.success("Bundle deleted"); onClose(); },
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete bundle"),
                })}
                disabled={deleteBundle.isPending}
                style={{ ...ghostBtn(), display: "flex", alignItems: "center", gap: 7, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint, color: signal.critical.text }}
              >
                <Icon name="trash-2" size={13} />
                Delete
              </button>
            </>
          ) : (
            <>
              <button onClick={() => onEdit(bundle)} style={{ ...ghostBtn(), display: "flex", alignItems: "center", gap: 7 }}>
                <Icon name="file-pen" size={13} />
                Edit
              </button>
              {activeAssignmentCount > 0 ? (
                <span style={{ ...ghostBtn(), display: "flex", alignItems: "center", gap: 7, cursor: "not-allowed", opacity: 0.6 }} title="Somebody is on this bundle — take them off first">
                  <Icon name="lock" size={13} />
                  Delete
                </span>
              ) : (
                <button
                  onClick={() => deleteBundle.mutate(bundle.bundleId, {
                    onSuccess: () => { toast.success("Bundle deleted"); onClose(); },
                    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete bundle"),
                  })}
                  disabled={deleteBundle.isPending}
                  style={{ ...ghostBtn(), display: "flex", alignItems: "center", gap: 7, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint, color: signal.critical.text }}
                >
                  <Icon name="trash-2" size={13} />
                  Delete
                </button>
              )}
            </>
          )}
        </div>
        <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
          {activeAssignmentCount > 0 ? "A bundle somebody is on cannot be deleted. Take every customer off it first."
            : "Putting a customer on a bundle turns each of its packages on for them separately, so a bundle of mixed packages starts them at their own rhythms."}
        </span>
      </div>
    </Overlay>
  );
}

function BuilderDrawer({ packages, editing, onClose }: { packages: MonitoringPackageFull[]; editing: MspSalesBundle | null; onClose: () => void }) {
  const [name, setName] = useState(editing?.name ?? "");
  const [price, setPrice] = useState(editing ? String(editing.resalePriceCents / 100) : "");
  const [picked, setPicked] = useState<string[]>(editing?.monitoringPackageKeys.filter((k) => packages.some((p) => p.key === k)) ?? []);
  const create = useCreateBundle();
  const update = useUpdateBundle();
  const saving = create.isPending || update.isPending;

  const pickedCost = picked.reduce((sum, k) => sum + (packages.find((p) => p.key === k)?.platformCostCents ?? 0), 0);
  const priceNum = parseInt(price, 10) || 0;
  const canSave = name.trim().length > 0 && picked.length > 0 && !saving;

  const submit = () => {
    if (editing) {
      update.mutate(
        { bundleId: editing.bundleId, name: name.trim(), monitoringPackageKeys: picked, resalePriceCents: priceNum * 100 },
        { onSuccess: () => { toast.success("Bundle updated"); onClose(); }, onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update bundle") },
      );
    } else {
      create.mutate(
        { name: name.trim(), monitoringPackageKeys: picked, resalePriceCents: priceNum * 100, status: "draft" },
        { onSuccess: () => { toast.success("Bundle saved as a draft"); onClose(); }, onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to create bundle") },
      );
    }
  };

  return (
    <Overlay onClose={onClose}>
      <DrawerHeader eyebrow="BUILD A BUNDLE" eyebrowColor={signal.info.text} title="Your own wrapper, your own price" onClose={onClose} />

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>Bundle name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Northwind Essential Care"
          style={{ height: 36, padding: "0 11px", borderRadius: 8, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 13, outline: "none" }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>What goes in it</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: text.label, whiteSpace: "nowrap" }}>{picked.length === 0 ? "nothing picked" : `${picked.length} picked`}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 260, overflowY: "auto" }}>
          {packages.map((p) => {
            const on = picked.includes(p.key);
            return (
              <button
                key={p.key}
                onClick={() => setPicked((prev) => (on ? prev.filter((k) => k !== p.key) : prev.concat(p.key)))}
                title={p.requiredPlanFeature ? `Needs the "${p.requiredPlanFeature}" plan feature — the server enforces this on save` : ""}
                style={{
                  display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 9,
                  border: `1px solid ${on ? "rgba(96,165,250,.34)" : border.card}`, background: on ? "rgba(37,99,235,.14)" : "rgba(2,6,23,.4)",
                  cursor: "pointer", textAlign: "left", minWidth: 0,
                }}
              >
                <Icon name={on ? "square-check-big" : "square"} size={14} color={on ? signal.info.strong : text.faint} />
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 12.5, color: text.body, textWrap: "pretty" }}>{p.label}{p.requiredPlanFeature ? ` · needs ${p.requiredPlanFeature}` : ""}</span>
                  <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.key}</span>
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: text.muted, whiteSpace: "nowrap" }}>{money(p.platformCostCents)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>Your price, per month</span>
        <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 1200"
          style={{ height: 36, padding: "0 11px", borderRadius: 8, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 13, outline: "none" }} />
      </div>

      <div style={{ border: `1px solid ${signal.info.border}`, borderRadius: 11, background: "rgba(37,99,235,.07)", padding: 14, display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.info.text }}>WHAT IT COSTS YOU</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em", color: text.title }}>{money(pickedCost)}</span>
          <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty", flex: 1, minWidth: 120 }}>
            {picked.length === 0 ? "Pick a package and this fills in. It is worked out here from the real catalogue, never from anything you type." : "Real platform cost, summed from the packages you picked."}
          </span>
        </div>
        {priceNum > 0 && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
            <span style={{ fontSize: 11.5, color: text.secondary, flex: 1 }}>Your margin</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: signal.ok.text, whiteSpace: "nowrap" }}>{money(priceNum * 100 - pickedCost)} per month</span>
          </div>
        )}
      </div>

      {picked.length > 1 && (
        <div style={{ display: "flex", gap: 10, padding: "12px 13px", borderRadius: 10, border: `1px solid ${signal.warning.border}`, background: signal.warning.tint }}>
          <Icon name="lock" size={15} color={signal.warning.strong} style={{ flex: "0 0 15px", marginTop: 2 }} />
          <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>Combining more than one package requires the "custom_bundle_composition" plan feature. The server checks this on save — one package on its own is always allowed.</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
        <button onClick={submit} disabled={!canSave} style={{ ...primaryBtn(!canSave), flex: 1, height: 38 }}>
          {saving ? "Saving…" : editing ? "Save changes" : "Save as a draft"}
        </button>
        <button onClick={onClose} style={{ ...ghostBtn(), height: 38 }}>Cancel</button>
      </div>
    </Overlay>
  );
}

// ── Packages tab ──────────────────────────────────────────────────────────────

function PackagesTab({ packages }: { packages: MonitoringPackageFull[] }) {
  if (packages.length === 0) return emptyState("package", "blue", "No packages in the catalogue", "The platform hasn't published any monitoring packages yet.");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={cardStyle({ overflowX: "auto" })}>
        <div style={{ minWidth: 940 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.8fr 2fr 1.6fr 1fr 1.1fr", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.sidebar}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
            <span>KEY</span><span>PACKAGE</span><span>ENGINES</span><span style={{ textAlign: "right" }}>YOUR COST</span><span>PLAN GATE</span>
          </div>
          {packages.map((p) => {
            const t = TONE[p.requiredPlanFeature ? "amber" : "green"];
            return (
              <div key={p.key} style={{ display: "grid", gridTemplateColumns: "1.8fr 2fr 1.6fr 1fr 1.1fr", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${border.faint}` }}>
                <span style={{ fontFamily: "Menlo, monospace", fontSize: 11.5, color: text.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.key}</span>
                <span style={{ fontSize: 12.5, color: text.body, textWrap: "pretty" }}>{p.label}</span>
                <span style={{ fontSize: 11.5, color: text.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.engines.length > 0 ? p.engines.join(", ") : "none — dashboard only"}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: p.platformCostCents === 0 ? text.muted : text.title, textAlign: "right", whiteSpace: "nowrap" }}>{money(p.platformCostCents)}</span>
                <span style={pill(t, { justifySelf: "start" })}>
                  <Icon name={p.requiredPlanFeature ? "lock" : "check"} size={11} />
                  {p.requiredPlanFeature ? `needs ${p.requiredPlanFeature}` : "on your plan"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>Only active packages are listed — a platform draft never appears here. Cost is the platform's real per-tenant charge to your MSP; a bundle's resale price on top of it is yours to set.</span>
    </div>
  );
}

// ── Assignments tab ("Who has what") ─────────────────────────────────────────

function AssignmentsTab({
  bundles, bundlesLoading, filter, onFilter, isAdmin,
}: { bundles: MspSalesBundle[]; bundlesLoading: boolean; filter: "active" | "revoked" | "all"; onFilter: (f: "active" | "revoked" | "all") => void; isAdmin: boolean }) {
  const { isLoading, isError, assignments } = useAllBundleAssignments(bundles);
  const revoke = useRevokeAssignment();
  const filtered = filter === "all" ? assignments : assignments.filter((a) => a.status === filter);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        {([{ id: "active", label: "Live" }, { id: "revoked", label: "Taken off" }, { id: "all", label: "All" }] as const).map((f) => {
          const activeF = filter === f.id;
          return (
            <button key={f.id} onClick={() => onFilter(f.id)} style={{
              height: 28, padding: "0 10px", borderRadius: 7,
              border: `1px solid ${activeF ? "rgba(96,165,250,.3)" : border.card}`,
              background: activeF ? "rgba(37,99,235,.18)" : "transparent",
              color: activeF ? "#bfdbfe" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
            }}>{f.label}</button>
          );
        })}
      </div>

      {bundlesLoading || isLoading ? <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span> :
       isError ? <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load bundle assignments.</span> :
       filtered.length === 0 ? emptyState(
          "user-plus", "blue", "Nobody is on a bundle yet",
          "A bundle has to be live before anyone can be put on it, and a bundle with somebody on it cannot be deleted until they are taken off.",
        ) :
        <div style={cardStyle({ overflowX: "auto" })}>
          <div style={{ minWidth: 940 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1.7fr 1fr 1.2fr 1.3fr 1fr", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.sidebar}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
              <span>CUSTOMER</span><span>BUNDLE</span><span>STATE</span><span>TRIAL</span><span>ASSIGNED</span><span></span>
            </div>
            {filtered.map((a) => {
              const t = TONE[ASSIGN_STATUS_TONE[a.status] ?? "slate"];
              const live = a.status === "active";
              return (
                <div key={a.assignmentId} style={{ display: "grid", gridTemplateColumns: "1.7fr 1.7fr 1fr 1.2fr 1.3fr 1fr", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${border.faint}` }}>
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.customerName ?? `customer ${a.customerId}`}</span>
                    <span style={{ fontSize: 11, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.customerDomain ?? "—"}</span>
                  </span>
                  <span style={{ fontSize: 12, color: text.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(a as MspSalesBundleAssignment & { bundleName?: string }).bundleName ?? a.bundleId}</span>
                  <span style={pill(t, { justifySelf: "start" })}>{a.status === "revoked" ? "taken off" : a.status}</span>
                  <span style={{ fontSize: 12, color: a.trialExpiresAt ? signal.warning.text : text.label, whiteSpace: "nowrap" }}>{a.trialExpiresAt ? `ends ${fmtDate(a.trialExpiresAt)}` : "—"}</span>
                  <span style={{ fontSize: 12, color: text.muted, whiteSpace: "nowrap" }}>{fmtDate(a.assignedAt)}</span>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      onClick={() => live && isAdmin && revoke.mutate({ bundleId: a.bundleId, assignmentId: a.assignmentId }, {
                        onSuccess: () => toast.success("Taken off the bundle"),
                        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to revoke assignment"),
                      })}
                      disabled={!live || !isAdmin || revoke.isPending}
                      title={!isAdmin ? "Only an MSP admin can take a customer off a bundle" : !live ? "Already taken off" : "Stops every package in this bundle for them"}
                      style={{ height: 28, padding: "0 10px", borderRadius: 7, border: `1px solid ${live && isAdmin ? signal.critical.border : border.card}`, background: live && isAdmin ? signal.critical.tint : "transparent", color: live && isAdmin ? signal.critical.text : text.faint, fontSize: 11.5, fontWeight: 600, cursor: live && isAdmin ? "pointer" : "not-allowed", opacity: live && isAdmin ? 1 : 0.6, whiteSpace: "nowrap" }}
                    >
                      {live ? "Take off" : "Off"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>}
    </div>
  );
}

// ── SOW view drawer (the operator-side half of the sign flow) ───────────────

function SowDrawer({ sowId, onClose }: { sowId: string; onClose: () => void }) {
  const sow = useSowDetail(sowId);
  const charge = useTriggerSowCharge();
  const expire = useExpireSow();
  const openDoc = useOpenSowDocument();
  const [copied, setCopied] = useState(false);

  if (sow.isLoading) return <Overlay onClose={onClose} z={95}><span style={{ fontSize: 11.5, color: text.muted }}>Loading the SOW…</span></Overlay>;
  if (sow.isError || !sow.data) return <Overlay onClose={onClose} z={95}><span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load this SOW.</span></Overlay>;

  const s = sow.data;
  const STATUS_TONE: Record<string, keyof typeof TONE> = { draft: "slate", sent: "blue", signed: "green", paid: "green", failed: "red", expired: "amber" };
  const t = TONE[STATUS_TONE[s.status] ?? "slate"];
  const shareUrl = s.shareToken ? `${window.location.origin}/sow/${s.shareToken}` : null;

  return (
    <Overlay onClose={onClose} z={95}>
      <DrawerHeader eyebrow={s.status.toUpperCase()} eyebrowColor={t.strong} title={s.title} subtitle={`${money(s.amountCents)} · created ${fmtDate(s.createdAt)}`} onClose={onClose} />

      {shareUrl && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>CUSTOMER SHARE LINK</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ flex: 1, fontFamily: "Menlo, monospace", fontSize: 11, color: text.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", padding: "8px 10px", borderRadius: 7, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.4)" }}>{shareUrl}</span>
            <button
              onClick={() => { void navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              style={{ ...ghostBtn(), height: 32, padding: "0 10px", display: "flex", alignItems: "center", gap: 6 }}
            >
              <Icon name="copy" size={12} />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>No page in this platform renders this link yet for the customer to open (a real, separate gap — filed as a finding, not fixed by this module).</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 11 }}>
        {[
          { label: "SIGNER", value: s.signerName ?? "not signed yet", color: s.signerName ? text.title : text.faint },
          { label: "SIGNED", value: s.signedAt ? fmtDateTime(s.signedAt) : "—", color: text.muted },
          { label: "EXPIRES", value: s.expiresAt ? fmtDate(s.expiresAt) : "—", color: text.muted },
          { label: "CHARGE", value: s.chargeConfirmedAt ? "confirmed" : s.chargeAttemptedAt ? "attempted, unconfirmed" : "not attempted", color: s.chargeConfirmedAt ? signal.ok.text : text.muted },
          // Git #2009 — signing this SOW kicks off real project creation
          // (fulfillAcceptedProjectOffer); this is the operator's visible
          // confirmation that the signed contract became a real engagement,
          // not just a signed/paid document.
          {
            label: "PROJECT",
            value: s.projectId != null ? `Project #${s.projectId} created` : s.signedAt ? "creating…" : "not created yet",
            color: s.projectId != null ? signal.ok.text : text.faint,
          },
        ].map((f) => (
          <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{f.label}</span>
            <span style={{ fontSize: 12.5, color: f.color, textWrap: "pretty" }}>{f.value}</span>
          </div>
        ))}
      </div>

      {s.failureReason && (
        <div style={{ display: "flex", gap: 10, padding: "12px 13px", borderRadius: 10, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint }}>
          <Icon name="triangle-alert" size={15} color={signal.critical.strong} style={{ flex: "0 0 15px", marginTop: 2 }} />
          <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>Last charge attempt failed: {s.failureReason}</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {s.documentHtml && (
            <button onClick={() => openDoc.mutate(sowId, { onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to open document") })} style={{ ...ghostBtn(), display: "flex", alignItems: "center", gap: 7 }}>
              <Icon name="file-text" size={13} />
              Open the document
            </button>
          )}
          {(s.status === "signed" || s.status === "failed") && (
            <button
              onClick={() => charge.mutate(sowId, {
                onSuccess: (r) => toast.success(r.message),
                onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to trigger charge"),
              })}
              disabled={charge.isPending}
              style={primaryBtn(charge.isPending)}
            >
              <Icon name="receipt" size={13} />
              {charge.isPending ? "Charging…" : "Trigger charge"}
            </button>
          )}
          {s.status !== "paid" && s.status !== "expired" && (
            <button
              onClick={() => expire.mutate(sowId, {
                onSuccess: () => toast.success("SOW expired"),
                onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to expire SOW"),
              })}
              disabled={expire.isPending}
              style={{ ...ghostBtn(), display: "flex", alignItems: "center", gap: 7 }}
            >
              <Icon name="calendar-x" size={13} />
              Expire
            </button>
          )}
        </div>
        <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
          Signing itself happens on the customer's side, via the share link above — an operator cannot sign on a customer's behalf.
        </span>
      </div>
    </Overlay>
  );
}

// ── Shared drawer shell ───────────────────────────────────────────────────────

function Overlay({ children, onClose, width = 520, z = 90 }: { children: React.ReactNode; onClose: () => void; width?: number; z?: number }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: z, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: `min(${width}px,95%)`, height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

function DrawerHeader({ eyebrow, eyebrowColor, title, subtitle, onClose }: { eyebrow: string; eyebrowColor: string; title: string; subtitle?: string; onClose: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: eyebrowColor }}>{eyebrow}</span>
        <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>{title}</span>
        {subtitle && <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>{subtitle}</span>}
      </div>
      <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "none", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
