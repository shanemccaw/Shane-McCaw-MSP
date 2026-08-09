/**
 * The full field editor — this screen's own overlay, the same reasoning as
 * `MoneyDialogs.tsx`: `SHELL.md`'s "Known gaps" notes the design's generic
 * modal isn't a shell primitive yet, so a screen that needs one builds it
 * itself rather than waiting.
 *
 * The peek (`index.tsx`'s `peeks.service`) covers four fields worth changing
 * from anywhere without leaving what you were doing — name, price, billing,
 * visibility. Everything else lives here, and it is the REAL per-type editor,
 * not a reinvented one: `PRODUCT_TYPE_CONFIGS` (`@/lib/productTypeConfig.ts`)
 * is the v1 admin panel's single source of truth for what each of the eight
 * product types (credit pack, assessment, project, retainer, monitoring tier,
 * recurring add-on, document product, platform subscription tier) can edit,
 * and `SectionCard`/`FieldRenderer` (`@/components/services/editor/`) are its
 * generic, config-driven renderers — seat-range pairs, engine/feature
 * checkbox pickers, the capabilities map editor, the permissions-array editor,
 * the category-path dropdown. Reusing them directly is possible because
 * adminv2 is mounted inside the SAME app tree as the v1 panel (`App.tsx`
 * wraps both in one `AuthProvider`/`QueryClientProvider`), so `useAuth()` and
 * `useRegistryOptions()` work exactly as they do in `ServiceEditorShell.tsx`.
 * Rebuilding fourteen field-kind widgets here instead would drift from the
 * real ones the first time either side changed.
 *
 * What this does NOT bring over from `ServiceEditorShell.tsx`, deliberately:
 * the workflow-template builder, the associated-documents editor, and the
 * client-assignment panel. Those are real, separate surfaces of their own —
 * PDF generation and Duplicate already live on this screen's contextual tab,
 * and the rest is a gap this screen states rather than fakes.
 *
 * Explicit Save/Cancel, not "applies as you type" like `MoneyDialogs`'
 * `GoalsDialog` — this form spans a dozen fields across several sections, and
 * firing a PUT per keystroke across all of them is not worth it the way it is
 * for two numeric goal fields.
 */

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRegistryOptions } from "@/hooks/useRegistryOptions";
import SectionCard from "@/components/services/editor/SectionCard";
import type { FieldContext, WorkflowTemplateMeta } from "@/components/services/editor/FieldRenderer";
import { detectProductType, PRODUCT_TYPE_CONFIGS, PRODUCT_TYPE_LIST, type ProductTypeKey } from "@/lib/productTypeConfig";
import { LINE, SCRIM, SHADOW, SURFACE, TEXT, Z } from "../../theme";
import { closeEditor, getSnapshot, removeService, updateServiceField } from "./servicesStore";
import type { Service } from "./servicesTypes";

function Backdrop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: SCRIM, zIndex: Z.peekBackdrop, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: "calc(100vw - 40px)",
          maxHeight: "calc(100vh - 40px)",
          borderRadius: 10,
          border: `1px solid ${LINE.strong}`,
          background: SURFACE.overlay,
          boxShadow: SHADOW.overlay,
          zIndex: Z.peek,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Flattens a `Service` into the plain `Record<string, unknown>` `SectionCard`'s `getCoreValue`/`setCoreValue` read and write. */
function serviceToCoreDraft(service: Service): Record<string, unknown> {
  const { extra, typeAttributes: _typeAttributes, ...rest } = service;
  return { ...extra, ...rest };
}

export function ServiceEditorDialog({ service }: { service: Service }) {
  const { fetchWithAuth } = useAuth();
  const { engines: registryEngines, features: registryFeatures } = useRegistryOptions();

  const [productType, setProductType] = useState<ProductTypeKey>(() =>
    detectProductType(service.serviceClass, service.deliveryType, service.billingType, service.fulfillmentType),
  );
  const [core, setCore] = useState<Record<string, unknown>>(() => serviceToCoreDraft(service));
  const [ta, setTa] = useState<Record<string, unknown>>(() => service.typeAttributes ?? {});

  const [fulfillmentTypes, setFulfillmentTypes] = useState<{ key: string; label: string }[]>([]);
  const [tenantSignals, setTenantSignals] = useState<{ key: string; label: string }[]>([]);
  const [monitoringPackages, setMonitoringPackages] = useState<{ key: string; label: string }[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplateMeta[]>([]);

  // Same four lookups `ServiceEditorShell.tsx` warms on mount — real catalogs
  // the pickers below need (fulfillment lifecycle types, tenant signals that
  // can auto-trigger fulfillment, monitoring packages an Assessment can scan,
  // workflow templates a Project can attach). `useRegistryOptions` covers
  // engines/features on its own.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [wr, ftr, tsr, mpr] = await Promise.all([
        fetchWithAuth("/api/admin/workflow-templates"),
        fetchWithAuth("/api/admin/fulfillment-types"),
        fetchWithAuth("/api/admin/engagement-projects/signals"),
        fetchWithAuth("/api/admin/monitoring-packages"),
      ]);
      if (cancelled) return;
      if (wr.ok) setWorkflowTemplates((await wr.json()) as WorkflowTemplateMeta[]);
      if (ftr.ok) {
        const d = (await ftr.json()) as { key: string; label: string }[];
        setFulfillmentTypes(Array.isArray(d) ? d : []);
      }
      if (mpr.ok) {
        const d = (await mpr.json()) as { packages?: { key: string; label: string; status?: string }[] };
        setMonitoringPackages(
          Array.isArray(d.packages) ? d.packages.filter((p) => p.status !== "archived").map((p) => ({ key: p.key, label: p.label })) : [],
        );
      }
      if (tsr.ok) {
        const d = (await tsr.json()) as { key?: string; signalKey?: string; label?: string; name?: string }[];
        setTenantSignals(
          Array.isArray(d)
            ? d.map((s) => ({ key: s.key ?? s.signalKey ?? "", label: s.label ?? s.name ?? s.key ?? s.signalKey ?? "" })).filter((s) => s.key)
            : [],
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  // `services` has no category table — every OTHER service's `categoryPath`
  // is the only source `CategoryPickerDropdown` has to build its tree from.
  const allCategoryPaths = useMemo(() => {
    const seen = new Set<string>();
    for (const s of getSnapshot().services) if (s.categoryPath) seen.add(s.categoryPath);
    return [...seen];
  }, []);

  const ctx: FieldContext = useMemo(
    () => ({
      fulfillmentTypes,
      tenantSignals,
      registryEngines: registryEngines.map((e) => ({ key: e.key, label: e.label })),
      registryFeatures: registryFeatures.map((f) => ({ key: f.key, label: f.label })),
      workflowTemplates,
      allCategoryPaths,
      monitoringPackages,
    }),
    [fulfillmentTypes, tenantSignals, registryEngines, registryFeatures, workflowTemplates, allCategoryPaths, monitoringPackages],
  );

  const getCoreValue = (key: string): unknown => core[key] ?? null;
  const setCoreValue = (key: string, val: unknown): void => setCore((prev) => ({ ...prev, [key]: val }));
  const getTaValue = (key: string): unknown => ta[key] ?? null;
  const setTaValue = (key: string, val: unknown): void => setTa((prev) => ({ ...prev, [key]: val }));

  const typeConfig = PRODUCT_TYPE_CONFIGS[productType];
  const identitySection = typeConfig.sections.find((s) => s.key === "identity")!;
  const catalogSection = typeConfig.sections.find((s) => s.key === "catalog")!;
  const otherSections = typeConfig.sections.filter((s) => s.key !== "identity" && s.key !== "catalog");
  const sectionProps = { ctx, getCoreValue, setCoreValue, getTaValue, setTaValue };

  /**
   * Reclassifying is what `TypePickerDialog` does for a brand-new service in
   * v1; here it doubles as the fix for a service that was created (by this
   * screen's own "New service" prompt, or by anything else) before anyone
   * decided what it actually is — `detectProductType` on a freshly-created
   * row with no classification set falls through to "project", and this is
   * how an operator corrects that.
   */
  function changeProductType(next: ProductTypeKey): void {
    const cfg = PRODUCT_TYPE_CONFIGS[next];
    setProductType(next);
    setCore((prev) => ({
      ...prev,
      serviceClass: cfg.serviceClass,
      deliveryType: cfg.deliveryType,
      billingType: cfg.defaultBillingType,
      fulfillmentType: cfg.fulfillmentType ?? "standard",
      fulfillmentTypeKey: (prev.fulfillmentTypeKey as string | null) || cfg.defaultFulfillmentTypeKey || null,
    }));
  }

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);

  async function save(): Promise<void> {
    if (!String(core.name ?? "").trim()) {
      setError("Give it a name.");
      return;
    }
    setSaving(true);
    setError(null);
    // `core`'s keys are exactly `Service`'s fields — every one of them is a
    // real, typed column `servicesTypes.ts` now carries — so this cast is the
    // config-driven form's values, not a guess. `updateServiceField` merges it
    // into the full current record before sending the PUT; see that
    // function's, and `toUpdatePayload`'s, doc comments for why a partial body
    // is never sent on its own.
    await updateServiceField(service.id, { ...core, typeAttributes: Object.keys(ta).length > 0 ? ta : null } as Partial<Service>);
    setSaving(false);
    closeEditor();
  }

  function deleteIt(): void {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    void removeService(service.id);
    closeEditor();
  }

  return (
    <Backdrop onClose={closeEditor}>
      <div style={{ padding: "16px 18px 0", flex: "none" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: TEXT.bright }}>Edit {service.name}</span>
          <span style={{ padding: "1px 7px", borderRadius: 9, border: `1px solid ${LINE.strong}`, fontSize: 10.5, color: TEXT.dimmer }}>
            {typeConfig.label}
          </span>
        </div>
        <div style={{ marginTop: 4, fontSize: 11.5, color: TEXT.meta }}>{typeConfig.description}</div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>Product type</span>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {PRODUCT_TYPE_LIST.map((cfg) => {
              const on = cfg.key === productType;
              return (
                <button
                  key={cfg.key}
                  onClick={() => changeProductType(cfg.key)}
                  title={cfg.description}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 5,
                    border: `1px solid ${on ? "#0f6cbd" : LINE.control}`,
                    background: on ? "rgba(15,108,189,.22)" : "transparent",
                    color: on ? TEXT.primary : TEXT.dim,
                    fontFamily: "inherit",
                    fontSize: 11.5,
                    cursor: "pointer",
                  }}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Config-driven — identity (shared) → this type's own sections → catalog (shared). Same renderer as the v1 panel. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionCard section={identitySection} {...sectionProps} />
          {otherSections.map((s) => (
            <SectionCard key={s.key} section={s} {...sectionProps} />
          ))}
          <SectionCard section={catalogSection} {...sectionProps} />
        </div>

        {error && <span style={{ fontSize: 11.5, color: "#eda3a3" }}>{error}</span>}
      </div>

      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderTop: `1px solid ${LINE.base}` }}>
        <button
          onClick={deleteIt}
          style={{
            padding: "6px 12px",
            borderRadius: 5,
            border: `1px solid ${deleteArmed ? "#e57a7a" : LINE.strong}`,
            background: deleteArmed ? "rgba(229,122,122,.18)" : "transparent",
            color: deleteArmed ? "#eda3a3" : TEXT.faint,
            fontFamily: "inherit",
            fontSize: 11.5,
            cursor: "pointer",
          }}
        >
          {deleteArmed ? "Delete — press again" : "Delete"}
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={closeEditor}
          style={{ padding: "6px 14px", borderRadius: 5, border: `1px solid ${LINE.strong}`, background: "transparent", color: TEXT.soft, fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}
        >
          Cancel
        </button>
        <button
          onClick={() => void save()}
          disabled={saving}
          style={{
            padding: "6px 14px",
            borderRadius: 5,
            border: 0,
            background: saving ? SURFACE.well : "#0f6cbd",
            color: saving ? TEXT.faint : "#fff",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 700,
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Backdrop>
  );
}
