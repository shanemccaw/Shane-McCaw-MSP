/**
 * Executive View (Operations, MSP-wide — Git #2659).
 *
 * Built against `Design/MSP_Console/design_handoff_msp_console/Executive View.dc.html`
 * (README screen 26, "25-33. MSP-wide pages": "Cross-tenant rollup metrics") and
 * the real routes in `artifacts/api-server/src/routes/msp-executive.ts` —
 * `GET /api/msp/executive`, `GET /api/msp/executive/qbr`,
 * `POST /api/msp/executive/qbr/generate` (see `@/api/executive-api`).
 *
 * The prototype shipped this page with its opportunity list toggled to a
 * deliberately "broken" state (`opportunityData: "broken"` default, an honest
 * "Showing nothing, wrongly" panel) documenting the real `sales_offers`
 * customer-id bridge bug (Git #2722). That bug is fixed (commit b1462a8ec,
 * Git #2730 — `sales_offers.customerId` now FKs `tenants.id`, not `users.id`),
 * and `gatherExecutiveBook()` filters directly against the book's own tenant
 * ids with no bridge indirection. This page therefore always reads the fixed
 * path; there is no broken/fixed toggle to reproduce here.
 *
 * The mount point is `ConsoleShell`'s `moduleFor` for `{ kind: "msp", page: "exec" }`
 * — the shell hands over the region and holds none of this page's data.
 */
import { useMemo, useState } from "react";
import { useCurrentQbr, useExecutiveBook, useGenerateQbr, type OpportunityTenant, type RiskTenant } from "@/api/executive-api";
import { Icon, type IconName } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";

type Tone = keyof typeof signal;

function tone(kind: Tone): { strong: string; text: string; tint: string; border: string } {
  const t = signal[kind] as { strong?: string; text?: string; tint: string; border: string };
  return { strong: t.strong ?? text.body, text: t.text ?? t.strong ?? text.body, tint: t.tint, border: t.border };
}

function money(cents: number): string {
  const d = cents / 100;
  if (d >= 1000) return `$${Math.round(d / 1000)}k`;
  return `$${Math.round(d)}`;
}

function goodnessTone(goodness: number): Tone {
  return goodness < 45 ? "critical" : goodness < 60 ? "warning" : "ok";
}

function fitTone(score: number): Tone {
  return score >= 80 ? "ok" : score >= 60 ? "info" : "neutral";
}

// ── Tiles ─────────────────────────────────────────────────────────────────────

interface Tile { label: string; value: string; note: string; icon: IconName; toneKind: Tone }

function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
      {tiles.map((t) => {
        const c = tone(t.toneKind);
        return (
          <div key={t.label} style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 15, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name={t.icon} size={13} color={c.strong} style={{ flex: "0 0 13px" }} />
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.label }}>{t.label}</span>
            </div>
            <span style={{ fontSize: 27, fontWeight: 800, letterSpacing: "-.02em", color: c.strong }}>{t.value}</span>
            <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{t.note}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Who needs attention ───────────────────────────────────────────────────────

function RiskRow({ r, onOpen }: { r: RiskTenant; onOpen: () => void }) {
  const g = r.goodnessPercent;
  const t = tone(goodnessTone(g));
  const atRisk = g < 60;
  return (
    <div
      onClick={onOpen}
      style={{ border: `1px solid ${atRisk ? signal.critical.border : border.card}`, borderRadius: 11, background: surface.card, padding: "13px 14px", display: "flex", gap: 12, alignItems: "center", minWidth: 0, cursor: "pointer" }}
    >
      <span style={{ width: 40, height: 40, flex: "0 0 40px", borderRadius: 11, background: t.tint, border: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: t.strong }}>
        {g}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: text.strong, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
        <div style={{ height: 4, borderRadius: 999, background: "rgba(148,163,184,.14)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${g}%`, background: t.strong }} />
        </div>
        <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>
          {r.capturedAt ? `Read ${new Date(r.capturedAt).toLocaleString()}` : "No health reading captured yet"}
        </span>
      </div>
      {atRisk && (
        <span style={{ display: "inline-flex", padding: "3px 9px", borderRadius: 999, background: signal.critical.tint, border: `1px solid ${signal.critical.border}`, fontSize: 10.5, fontWeight: 600, color: signal.critical.text, whiteSpace: "nowrap", flex: "0 0 auto" }}>
          at risk
        </span>
      )}
    </div>
  );
}

// ── Where the money is ────────────────────────────────────────────────────────

function OpportunityRow({ o, onOpen }: { o: OpportunityTenant; onOpen: () => void }) {
  const t = tone(fitTone(o.topScore));
  return (
    <div
      onClick={onOpen}
      style={{ border: `1px solid ${border.card}`, borderRadius: 11, background: surface.card, padding: "13px 14px", display: "flex", gap: 12, alignItems: "center", minWidth: 0, cursor: "pointer" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: text.strong, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.name}</span>
        <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>{o.topOfferTitle ?? "—"}</span>
        <span style={{ fontSize: 11, color: text.label }}>{o.openOfferCount} {o.openOfferCount === 1 ? "open offer" : "open offers"} · drafts and sent only</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flex: "0 0 auto" }}>
        <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.01em", color: text.title }}>{money(o.totalValueCents)}</span>
        <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 999, background: t.tint, border: `1px solid ${t.border}`, fontSize: 10.5, fontWeight: 600, color: t.text, whiteSpace: "nowrap" }}>
          {o.topScore}% fit
        </span>
      </div>
    </div>
  );
}

function EmptyPanel({ icon, title, body, toneKind = "info" }: { icon: IconName; title: string; body: string; toneKind?: Tone }) {
  const t = tone(toneKind);
  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 12, background: surface.card, padding: "30px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 9, textAlign: "center" }}>
      <span style={{ width: 36, height: 36, borderRadius: 11, background: t.tint, border: `1px solid ${t.border}`, color: t.strong, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={18} />
      </span>
      <span style={{ fontSize: 14, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>{title}</span>
      <span style={{ fontSize: 12, color: text.muted, maxWidth: 360, textWrap: "pretty" }}>{body}</span>
    </div>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

type DetailSel = { kind: "risk"; row: RiskTenant } | { kind: "opportunity"; row: OpportunityTenant };

function DetailDrawer({ sel, onClose, onGo }: { sel: DetailSel; onClose: () => void; onGo: () => void }) {
  const isRisk = sel.kind === "risk";
  const kindColor = isRisk ? signal.critical.text : signal.ok.text;
  const name = sel.row.name;
  const facts = isRisk
    ? [
      { label: "HEALTH", value: `${sel.row.goodnessPercent}%`, color: sel.row.goodnessPercent < 60 ? signal.critical.text : signal.ok.text },
      { label: "LAST READ", value: sel.row.capturedAt ? new Date(sel.row.capturedAt).toLocaleString() : "never", color: text.muted },
      { label: "BELOW THE LINE", value: sel.row.goodnessPercent < 60 ? "yes" : "no", color: sel.row.goodnessPercent < 60 ? signal.critical.text : signal.ok.text },
    ]
    : [
      { label: "OPEN VALUE", value: money(sel.row.totalValueCents), color: text.title },
      { label: "OFFERS", value: String(sel.row.openOfferCount), color: text.secondary },
      { label: "BEST FIT", value: `${sel.row.topScore}%`, color: signal.ok.text },
      { label: "COUNTED", value: "drafts and sent", color: text.muted },
    ];
  const body = isRisk
    ? "This is the same health figure the customer sees on their own dashboard, and the same line that turns their ring red. Nothing here explains which checks are dragging it down — that is on their own diagnostics."
    : `The highest-value offer of these is "${(sel.row as OpportunityTenant).topOfferTitle ?? "—"}". Only drafts and sent offers count; anything accepted, rejected or expired is left out of the total.`;
  const note = isRisk
    ? "Takes you into the tenant, where the findings behind this figure live."
    : "Takes you into the tenant. The individual offers live on their own screen, not this one.";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(460px,94%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: kindColor }}>{isRisk ? "NEEDS ATTENTION" : "OPPORTUNITY"}</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>{name}</span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 11 }}>
          {facts.map((f) => (
            <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{f.label}</span>
              <span style={{ fontSize: 12.5, color: f.color, textWrap: "pretty" }}>{f.value}</span>
            </div>
          ))}
        </div>
        <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>{body}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
          <button onClick={onGo} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 38, borderRadius: 8, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            <Icon name="arrow-right" size={14} /> Open {name}
          </button>
          <span style={{ fontSize: 11.5, color: text.faint, textWrap: "pretty" }}>{note}</span>
        </div>
      </div>
    </div>
  );
}

// ── Partner QBR card ──────────────────────────────────────────────────────────

const QBR_TONE: Record<string, { toneKind: Tone; icon: IconName; state: string }> = {
  ready: { toneKind: "ok", icon: "file-check", state: "ready" },
  generating: { toneKind: "info", icon: "loader", state: "being written" },
  failed: { toneKind: "critical", icon: "circle-x", state: "did not finish" },
  none: { toneKind: "neutral", icon: "file-clock", state: "not written yet" },
};

function openAsDocument(title: string, html: string) {
  const blob = new Blob([`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:Inter,system-ui,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;color:#0f172a">${html}</body></html>`], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
}

function QbrCard() {
  const qbrQuery = useCurrentQbr();
  const generateMutation = useGenerateQbr();

  const qbr = qbrQuery.data?.qbr ?? null;
  const quarterKey = qbrQuery.data?.quarterKey ?? "";
  const status = qbr?.status ?? "none";
  const t = QBR_TONE[status] ?? QBR_TONE.none;
  const c = tone(t.toneKind);

  const title = qbr?.title || `Partner QBR — ${quarterKey}`;
  const sub =
    status === "ready" ? `Generated ${qbr?.generatedAt ? new Date(qbr.generatedAt).toLocaleString() : "recently"} from the same numbers shown above`
      : status === "generating" ? "Being written now from the numbers above"
        : status === "failed" ? "The last attempt did not come back"
          : "Nothing written for this quarter yet";

  const writing = generateMutation.isPending || status === "generating";

  return (
    <div style={{ border: `1px solid ${status === "failed" ? signal.critical.border : border.card}`, borderRadius: 12, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 13, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
        <span style={{ width: 30, height: 30, flex: "0 0 30px", borderRadius: 9, background: c.tint, border: `1px solid ${c.border}`, color: c.strong, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name={t.icon} size={16} />
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 180, flex: 1 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{title}</span>
          <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{sub}</span>
        </div>
        <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 999, background: c.tint, border: `1px solid ${c.border}`, fontSize: 11, fontWeight: 600, color: c.text, whiteSpace: "nowrap" }}>
          {t.state}
        </span>
      </div>

      {status === "ready" && qbr && (
        <div
          style={{ border: `1px solid ${border.soft}`, borderRadius: 11, background: "rgba(2,6,23,.5)", padding: 16, maxHeight: 420, overflowY: "auto", minWidth: 0, color: text.secondary, fontSize: 12.5, lineHeight: 1.55 }}
          className="smc-scroll smc-qbr-doc"
          // Generated server-side by our own AI pipeline (partner-qbr-generator.ts),
          // grounded exclusively on gatherExecutiveBook() — not user-authored input.
          dangerouslySetInnerHTML={{ __html: qbr.htmlContent }}
        />
      )}

      {status === "failed" && (
        <div style={{ display: "flex", gap: 10, padding: "12px 13px", borderRadius: 10, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint }}>
          <Icon name="circle-x" size={15} color={signal.critical.strong} style={{ flex: "0 0 15px", marginTop: 2 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: signal.critical.text }}>It did not come back</span>
            <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>{qbr?.errorMessage ?? "The model did not return anything usable. Nothing was saved, and the previous quarter's review is untouched."}</span>
          </div>
        </div>
      )}

      {generateMutation.isError && (
        <span style={{ fontSize: 11.5, color: signal.critical.text }}>{generateMutation.error.message}</span>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", paddingTop: 11, borderTop: `1px solid ${border.soft}` }}>
        <button
          onClick={() => generateMutation.mutate({ force: status === "ready" })}
          disabled={writing}
          title={status === "ready" ? "Replaces this quarter's review — there is no earlier copy kept" : ""}
          style={{ display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 13px", borderRadius: 8, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: writing ? "not-allowed" : "pointer", opacity: writing ? 0.6 : 1, whiteSpace: "nowrap" }}
        >
          <Icon name={writing ? "loader" : status === "ready" ? "rotate-ccw" : "sparkles"} size={13} />
          {writing ? "Writing it now" : status === "ready" ? "Write it again" : "Write it"}
        </button>
        <button
          onClick={() => qbr && openAsDocument(title, qbr.htmlContent)}
          disabled={status !== "ready"}
          title={status !== "ready" ? "Nothing to open until it is written" : ""}
          style={{ display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 13px", borderRadius: 8, border: `1px solid ${border.soft}`, background: "transparent", color: status === "ready" ? text.secondary : text.label, fontSize: 12.5, fontWeight: 600, cursor: status === "ready" ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}
        >
          <Icon name={status === "ready" ? "external-link" : "lock"} size={13} /> Open as a document
        </button>
        <span style={{ fontSize: 11.5, color: writing ? "#fcd34d" : text.label, textWrap: "pretty", flex: 1, minWidth: 180 }}>
          {writing
            ? "This takes a minute or two. Nothing tells this screen when it is done — refresh to check."
            : status === "ready"
              ? "One review per quarter. Writing it again overwrites this one, and covers the whole book even if your own access is limited to some of it."
              : "Covers the whole book, not just the customers you are assigned to."}
        </span>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ExecutiveView({ onOpenTenant }: { onOpenTenant: (customerId: number) => void }) {
  const bookQuery = useExecutiveBook();
  const [sel, setSel] = useState<DetailSel | null>(null);

  const book = bookQuery.data;

  const tiles: Tile[] = useMemo(() => {
    if (!book) return [];
    const avg = book.rollup.avgGoodnessPercent;
    const avgToneKind: Tone = avg === null ? "neutral" : avg >= 70 ? "ok" : avg >= 45 ? "warning" : "critical";
    const atRiskToneKind: Tone = book.rollup.atRiskCount === 0 ? "ok" : "critical";
    return [
      { label: "CUSTOMERS", value: String(book.customerCount), note: "Everyone you can see in the book", icon: "building-2", toneKind: "info" },
      { label: "AVERAGE HEALTH", value: avg === null ? "—" : `${avg}%`, note: "Across everyone with a reading — higher is better", icon: "activity", toneKind: avgToneKind },
      { label: "BELOW THE LINE", value: String(book.rollup.atRiskCount), note: book.rollup.atRiskCount === 0 ? "Nobody is under 60%" : "Under 60%, the same line their own dashboard uses", icon: "shield-alert", toneKind: atRiskToneKind },
      { label: "OPEN PIPELINE", value: money(book.rollup.totalOpenOpportunityCents), note: `${book.rollup.openOfferCount} open ${book.rollup.openOfferCount === 1 ? "offer" : "offers"} across the book`, icon: "trending-up", toneKind: "ok" },
    ];
  }, [book]);

  if (bookQuery.isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ height: 60, borderRadius: 12, background: "rgba(148,163,184,.08)" }} />
        ))}
      </div>
    );
  }

  if (bookQuery.isError) {
    return <EmptyPanel icon="circle-x" title="Failed to load the executive view" body={bookQuery.error.message} toneKind="critical" />;
  }

  if (!book) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <Tiles tiles={tiles} />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 14, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: text.label }}>WHO NEEDS ATTENTION</span>
            <span style={{ fontSize: 11.5, color: text.faint }}>Worst five, and only five</span>
          </div>
          {book.topRisks.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {book.topRisks.map((r) => (
                <RiskRow key={r.customerId} r={r} onOpen={() => setSel({ kind: "risk", row: r })} />
              ))}
            </div>
          ) : (
            <EmptyPanel icon="activity" title="No health readings yet" body="Nobody in the book has a health score recorded, so there is nothing to rank." toneKind="neutral" />
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: text.label }}>WHERE THE MONEY IS</span>
            <span style={{ fontSize: 11.5, color: text.faint }}>Top five by value, and only five</span>
          </div>
          {book.topOpportunities.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {book.topOpportunities.map((o) => (
                <OpportunityRow key={o.customerId} o={o} onOpen={() => setSel({ kind: "opportunity", row: o })} />
              ))}
            </div>
          ) : (
            <EmptyPanel icon="handshake" title="No open pipeline" body="Nobody in the book has an open (draft or sent) sales offer right now." toneKind="neutral" />
          )}
        </div>
      </div>

      <QbrCard />

      {sel && (
        <DetailDrawer
          sel={sel}
          onClose={() => setSel(null)}
          onGo={() => { onOpenTenant(sel.row.customerId); setSel(null); }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 2 }}>
        <Icon name="info" size={13} color={text.faint} style={{ flex: "0 0 13px" }} />
        <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
          Both lists are capped at five with no way to ask for more. Health comes from each tenant's most recent health-engine snapshot; open pipeline counts drafts and sent Sales Offer Engine offers only. The review is written from the same numbers shown here.
        </span>
      </div>
    </div>
  );
}
