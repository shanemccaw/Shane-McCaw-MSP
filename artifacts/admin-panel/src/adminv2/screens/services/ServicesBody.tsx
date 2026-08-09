/**
 * Services screen body — the centre content.
 *
 * Nothing open: an overview of the catalog itself (value per category, and
 * the same "no real price" gap the Watch tab flags, so it is visible without
 * having to go looking for it). A service open: a read-only preview card —
 * what a client actually sees, mirroring the design's catalog-card preview
 * (`Admin Shell.dc.html`'s `previewCard`) but built from `effectivePriceCents`
 * and the real deliverables list rather than invented copy.
 *
 * Editing happens in the peek (four fields, from anywhere) or the full editor
 * dialog (`ServiceEditorDialog`, opened from here or the Properties panel) —
 * this body renders the dialog when `editorOpenId` is set, the same way
 * `MoneyBody` renders its own dialogs from `moneyStore`'s flags.
 */

import { useSyncExternalStore } from "react";
import { Copy, FileText, Pencil } from "lucide-react";
import { ACCENT, LINE, SURFACE, TEXT } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import {
  createServiceInteractive,
  duplicateService,
  generatePdf,
  getSnapshot,
  openEditor,
  refreshCatalog,
  serviceById,
  subscribe,
  totalCatalogValueCents,
  unpricedServices,
  type ServicesState,
} from "./servicesStore";
import { effectivePriceCents, hasNoPrice, topCategory, usd, BILLING_LABEL, VISIBILITY_LABEL, type Service } from "./servicesTypes";
import { ServiceEditorDialog } from "./ServiceEditorDialog";

export function ServicesBody() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const open = serviceById(state.openId, state);
  const editing = state.editorOpenId != null ? serviceById(state.editorOpenId, state) : null;

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <Header state={state} />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 20px 30px" }}>
        {open ? <RecordView service={open} saving={state.savingIds.has(open.id)} /> : <Overview state={state} />}
      </div>
      {state.message && <Toast message={state.message} />}
      {editing && <ServiceEditorDialog service={editing} />}
    </div>
  );
}

function Header({ state }: { state: ServicesState }) {
  return (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", padding: "10px 16px", borderBottom: `1px solid ${LINE.base}` , background: SURFACE.chrome }}>
      <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: TEXT.primary }}>Services</span>
      <span style={{ padding: "1px 7px", borderRadius: 9, border: `1px solid ${LINE.strong}`, fontSize: 10.5, color: TEXT.dimmer }}>
        {state.services.length} in the catalog
      </span>
      <div style={{ flex: 1, minWidth: 4 }} />
      <button onClick={() => void createServiceInteractive()} style={buttonStyle(true)}>
        New service
      </button>
      <button onClick={() => void refreshCatalog()} style={buttonStyle(false)}>
        Refresh
      </button>
    </div>
  );
}

function buttonStyle(primary: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 5,
    border: primary ? 0 : `1px solid ${LINE.strong}`,
    background: primary ? "#0f6cbd" : "transparent",
    color: primary ? "#fff" : TEXT.soft,
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: primary ? 600 : 400,
    cursor: "pointer",
  };
}

function Toast({ message }: { message: string }) {
  return (
    <div
      style={{
        flex: "none",
        padding: "8px 16px",
        fontSize: 12,
        color: TEXT.strong,
        background: SURFACE.card,
        borderTop: `1px solid ${LINE.base}`,
      }}
    >
      {message}
    </div>
  );
}

// ── Overview (nothing open) ──────────────────────────────────────────────────

function Overview({ state }: { state: ServicesState }) {
  if (state.loading && state.services.length === 0) {
    return <div style={{ padding: 20, fontSize: 12.5, color: TEXT.meta }}>Reading the catalog…</div>;
  }
  if (state.error && state.services.length === 0) {
    return <div style={{ padding: 20, fontSize: 12.5, color: ACCENT.danger }}>{state.error}</div>;
  }

  const byCategory = new Map<string, { count: number; valueCents: number }>();
  for (const s of state.services) {
    const cat = topCategory(s);
    const entry = byCategory.get(cat) ?? { count: 0, valueCents: 0 };
    entry.count += 1;
    entry.valueCents += effectivePriceCents(s);
    byCategory.set(cat, entry);
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1].valueCents - a[1].valueCents);
  const unpriced = unpricedServices(state);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          padding: "18px 20px",
          borderRadius: 10,
          background: "linear-gradient(135deg, rgba(127,180,216,.12), rgba(127,180,216,.02))",
          border: "1px solid rgba(127,180,216,.24)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: ACCENT.info }}>
          Catalog value
        </span>
        <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-.03em", color: TEXT.primary }}>
          {usd(totalCatalogValueCents(state))}
        </span>
        <span style={{ fontSize: 11.5, color: TEXT.meta }}>Summed effective price across every product in the catalog.</span>
      </div>

      {unpriced.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: ACCENT.amber }}>
            No real price — public and unbuyable
          </span>
          {unpriced.map((s) => (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => getShellApi()?.openDoc({ kind: "service", id: String(s.id), screenId: "services" })}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 13px", borderRadius: 7, border: `1px solid ${LINE.base}`, background: SURFACE.card, cursor: "pointer" }}
            >
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
              <span style={{ fontSize: 11, color: TEXT.faint }}>{topCategory(s)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: TEXT.caption }}>By category</span>
        {categories.length === 0 && <span style={{ fontSize: 12.5, color: TEXT.meta }}>The catalog is empty.</span>}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {categories.map(([cat, entry]) => (
            <div key={cat} style={{ flex: "1 1 200px", minWidth: 0, padding: "13px 15px", borderRadius: 9, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: TEXT.caption }}>{cat}</span>
              <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em", color: TEXT.primary }}>{usd(entry.valueCents)}</span>
                <span style={{ fontSize: 11.5, color: TEXT.caption }}>{entry.count} product{entry.count === 1 ? "" : "s"}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── One service, open ─────────────────────────────────────────────────────────

function RecordView({ service, saving }: { service: Service; saving: boolean }) {
  const noPrice = hasNoPrice(service);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 520 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <ActionButton icon={Pencil} label="Edit fields" onClick={() => openEditor(service.id)} />
        <ActionButton icon={Copy} label="Duplicate" onClick={() => void duplicateService(service.id)} />
        <ActionButton icon={FileText} label={service.overviewPdfKey ? "Regenerate PDF" : "Generate PDF"} onClick={() => void generatePdf(service.id)} busy={saving} />
      </div>

      <div style={{ padding: "22px 24px", borderRadius: 12, border: `1px solid ${LINE.strong}`, background: SURFACE.card }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: TEXT.dim }}>
          {service.serviceType ?? service.deliveryType ?? "Service"}
        </span>
        <div style={{ marginTop: 9, fontSize: 20, fontWeight: 700, letterSpacing: "-.015em", lineHeight: 1.2, color: TEXT.bright }}>{service.name}</div>
        {service.tagline && <div style={{ marginTop: 9, fontSize: 12.5, lineHeight: 1.55, color: TEXT.dim }}>{service.tagline}</div>}
        <div style={{ marginTop: 17, display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
          <span style={{ fontSize: 25, fontWeight: 800, letterSpacing: "-.02em", color: noPrice ? ACCENT.amber : TEXT.bright }}>{usd(effectivePriceCents(service))}</span>
          <span style={{ fontSize: 12, color: TEXT.caption }}>{BILLING_LABEL[service.billingType]}</span>
        </div>
        {!!service.deliverables?.length && (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 7 }}>
            {service.deliverables.map((d, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, lineHeight: 1.45, color: TEXT.quiet }}>
                <span style={{ color: ACCENT.greenBright }}>✓</span>
                <span>{d}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 17, fontSize: 11, color: TEXT.faint }}>
          {VISIBILITY_LABEL[service.visibility]}
          {noPrice ? " — no real price set, a client cannot check out with this" : ""}
        </div>
      </div>

      <span style={{ fontSize: 11, lineHeight: 1.5, textAlign: "center", color: TEXT.faint }}>
        What a client sees. Nothing here is live until it is public with a real price.
      </span>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  busy,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 13px",
        borderRadius: 6,
        border: `1px solid ${LINE.control}`,
        background: SURFACE.well,
        color: TEXT.body,
        fontFamily: "inherit",
        fontSize: 12,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
      }}
    >
      <Icon size={13} />
      {busy ? "Working…" : label}
    </button>
  );
}
