/**
 * The Properties panel — "what IS this service", read-only, mirroring
 * `EndpointProperties.tsx`'s split between display and editing. The peek
 * (`index.tsx`'s `peeks.service`) covers the four fields worth changing from
 * anywhere (name, price, billing, visibility); this panel is the fuller
 * picture, and its "Edit fields" button is what opens `ServiceEditorDialog`
 * for everything else.
 *
 * `typeAttributes` still shows as a raw JSON dump here — but that is now a
 * read-only glance, not this platform's only way to edit it. `Edit fields`
 * opens `ServiceEditorDialog`, which renders the real per-type editors
 * (`@/components/services/editor/` — seat ranges, engine/feature pickers, the
 * capabilities map, one per product type) via the same config-driven
 * `SectionCard`/`FieldRenderer` the v1 admin panel uses. This panel keeps the
 * raw view because a quick glance at everything typeAttributes holds is still
 * useful without opening the dialog.
 */

import { useSyncExternalStore } from "react";
import { ACCENT, FONT, LINE, TEXT } from "../../theme";
import { getSnapshot, openEditor, serviceById, subscribe } from "./servicesStore";
import {
  BILLING_LABEL,
  effectivePriceCents,
  hasNoPrice,
  topCategory,
  usd,
  VISIBILITY_LABEL,
  type Service,
} from "./servicesTypes";

export function ServiceProperties() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const service = serviceById(state.openId, state);

  if (!service) {
    return (
      <div style={{ padding: "12px 14px", fontSize: 11.5, lineHeight: 1.6, color: TEXT.faint }}>
        Nothing is open. Pick a service on the left and this shows what it is, what it costs, and what a client sees.
      </div>
    );
  }
  return <PropertiesView service={service} />;
}

function PropertiesView({ service }: { service: Service }) {
  const noPrice = hasNoPrice(service);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 14px 20px", overflow: "auto", height: "100%" }}>
      <button
        onClick={() => openEditor(service.id)}
        style={{
          alignSelf: "flex-start",
          padding: "5px 12px",
          borderRadius: 5,
          border: 0,
          background: "#0f6cbd",
          color: "#fff",
          fontFamily: "inherit",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Edit fields
      </button>

      <Section title="What it is">
        <Fact label="Slug" value={service.slug ?? "—"} mono />
        <Fact label="Category" value={topCategory(service)} />
        <Fact label="Type" value={service.serviceType ?? service.deliveryType ?? "—"} />
        {service.tagline && (
          <span style={{ display: "block", marginTop: 4, fontSize: 11.5, lineHeight: 1.6, color: TEXT.groupLabel }}>{service.tagline}</span>
        )}
      </Section>

      <Section title="What it costs">
        <Fact label="Price" value={usd(effectivePriceCents(service))} color={noPrice ? ACCENT.amber : undefined} />
        <Fact label="Billing" value={BILLING_LABEL[service.billingType]} />
        <Fact label="Visibility" value={VISIBILITY_LABEL[service.visibility]} />
        {noPrice && (
          <span style={{ display: "block", marginTop: 4, fontSize: 11, lineHeight: 1.5, color: ACCENT.amber }}>
            Public with no real price — a client can see this and cannot buy it.
          </span>
        )}
      </Section>

      {service.description && (
        <Section title="Description">
          <span style={{ fontSize: 11.5, lineHeight: 1.6, color: TEXT.body, whiteSpace: "pre-wrap" }}>{service.description}</span>
        </Section>
      )}

      <Section title="Deliverables">
        {!service.deliverables?.length ? (
          <span style={{ fontSize: 11.5, color: TEXT.faint }}>None listed.</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {service.deliverables.map((d, i) => (
              <span key={i} style={{ fontSize: 11.5, lineHeight: 1.5, color: TEXT.body }}>
                — {d}
              </span>
            ))}
          </div>
        )}
      </Section>

      <Section title="Classification">
        <Fact label="Class" value={service.serviceClass ?? "—"} />
        <Fact label="Delivery" value={service.deliveryType ?? "—"} />
        <Fact label="Fulfillment" value={service.fulfillmentType ?? "—"} />
        {service.tags?.length ? (
          <div style={{ marginTop: 6, display: "flex", gap: 5, flexWrap: "wrap" }}>
            {service.tags.map((t) => (
              <span key={t} style={{ padding: "2px 8px", borderRadius: 999, border: `1px solid ${LINE.control}`, fontSize: 10.5, color: TEXT.softer }}>
                {t}
              </span>
            ))}
          </div>
        ) : null}
      </Section>

      {service.typeAttributes && Object.keys(service.typeAttributes).length > 0 && (
        <Section title="Per-type settings (raw)">
          <pre
            style={{
              margin: 0,
              padding: "8px 10px",
              borderRadius: 6,
              background: "#191919",
              border: `1px solid ${LINE.subtle}`,
              fontFamily: FONT.mono,
              fontSize: 10.5,
              lineHeight: 1.5,
              color: ACCENT.info,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {JSON.stringify(service.typeAttributes, null, 2)}
          </pre>
        </Section>
      )}

      <Section title="PDF">
        <Fact label="Overview" value={service.overviewPdfKey ? "generated" : "never generated"} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".11em", textTransform: "uppercase", color: TEXT.metaAlt }}>{title}</span>
      {children}
    </div>
  );
}

function Fact({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ flex: "none", minWidth: 72, fontSize: 11, color: TEXT.caption }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontFamily: mono ? FONT.mono : "inherit", fontSize: 11.5, color: color ?? TEXT.strong, wordBreak: "break-all" }}>
        {value}
      </span>
    </div>
  );
}
