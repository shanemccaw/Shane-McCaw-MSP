/**
 * The interpretation field form — shared between authoring a new interpretation
 * (`AuthorInterpretationDrawer`) and editing an existing one
 * (`InterpretationDetailDrawer`'s edit mode), so the ~10 fields
 * `admin-m365-interpretations.ts`'s create/patch schemas share are defined once.
 */
import { border, text } from "@/console/tokens";
import type { AvailableCheck } from "@/api/rbd-api";
import { M365_ACTORS, M365_CHANGE_CLASSES, M365_CONTROLLABILITY } from "@/api/m365-changes-api";
import type { M365Actor, M365ChangeClass, M365Controllability } from "@/api/m365-changes-api";
import { actorLabel, changeClassLabel } from "./format";

export interface FieldsState {
  title: string;
  summary: string;
  changeClass: M365ChangeClass;
  whoActs: M365Actor;
  controllable: M365Controllability;
  controlMethod: string;
  services: string;
  protocols: string;
  skus: string;
  settings: string;
  probeDescription: string;
  monitorCheckKey: string;
  powershell: string;
  graphEndpoint: string;
  notes: string;
}

export const inputStyle: React.CSSProperties = {
  height: 36, padding: "0 11px", borderRadius: 8, border: `1px solid ${border.card}`,
  background: "rgba(2,6,23,.6)", color: "#f1f5f9", fontSize: 13, outline: "none", width: "100%", fontFamily: "inherit",
};

export const textareaStyle: React.CSSProperties = {
  ...inputStyle, height: "auto", minHeight: 70, padding: "9px 11px", lineHeight: 1.6, resize: "vertical",
};

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 10.5, color: text.faint, textWrap: "pretty" }}>{hint}</span>}
    </div>
  );
}

function Chooser<T extends string>({
  options, labels, value, onPick,
}: { options: readonly T[]; labels: (v: T) => string; value: T; onPick: (v: T) => void }) {
  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onPick(o)}
            style={{
              height: 30, padding: "0 11px", borderRadius: 7,
              border: `1px solid ${active ? "rgba(96,165,250,.32)" : border.card}`,
              background: active ? "rgba(37,99,235,.18)" : "transparent",
              color: active ? "#bfdbfe" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            {labels(o)}
          </button>
        );
      })}
    </div>
  );
}

export function InterpretationFields({
  state, onChange, checks,
}: {
  state: FieldsState;
  onChange: <K extends keyof FieldsState>(key: K, value: FieldsState[K]) => void;
  checks: AvailableCheck[];
}) {
  return (
    <>
      <Field label="Title">
        <input value={state.title} onChange={(e) => onChange("title", e.target.value)} placeholder="What Microsoft calls this change" style={inputStyle} />
      </Field>

      <Field label="Summary" hint="Plain-language reframe of what is changing — this is what a customer eventually reads.">
        <textarea value={state.summary} onChange={(e) => onChange("summary", e.target.value)} rows={4} style={textareaStyle} />
      </Field>

      <Field label="Change class">
        <Chooser options={M365_CHANGE_CLASSES} labels={changeClassLabel} value={state.changeClass} onPick={(v) => onChange("changeClass", v)} />
      </Field>

      <Field label="Who acts">
        <Chooser options={M365_ACTORS} labels={actorLabel} value={state.whoActs} onPick={(v) => onChange("whoActs", v)} />
      </Field>

      <Field label="Controllable" hint="Can a customer opt out or otherwise control this?">
        <Chooser
          options={M365_CONTROLLABILITY}
          labels={(v) => (v === "yes" ? "Yes" : v === "no" ? "No" : "Unknown")}
          value={state.controllable}
          onPick={(v) => onChange("controllable", v)}
        />
      </Field>

      {state.controllable === "yes" && (
        <Field label="How to control it">
          <textarea value={state.controlMethod} onChange={(e) => onChange("controlMethod", e.target.value)} rows={2} style={textareaStyle} />
        </Field>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        <Field label="Services" hint="Comma-separated">
          <input value={state.services} onChange={(e) => onChange("services", e.target.value)} placeholder="Exchange Online, Outlook" style={inputStyle} />
        </Field>
        <Field label="Protocols" hint="Comma-separated">
          <input value={state.protocols} onChange={(e) => onChange("protocols", e.target.value)} placeholder="MAPI, REST" style={inputStyle} />
        </Field>
        <Field label="License SKUs" hint="Comma-separated">
          <input value={state.skus} onChange={(e) => onChange("skus", e.target.value)} placeholder="Project Online" style={inputStyle} />
        </Field>
        <Field label="Settings" hint="Comma-separated">
          <input value={state.settings} onChange={(e) => onChange("settings", e.target.value)} placeholder="Shared calendars" style={inputStyle} />
        </Field>
      </div>

      <Field label="Probe — what to count in a tenant" hint="States what a resolution should measure. The resolution layer runs this against each tenant to produce a real number.">
        <textarea value={state.probeDescription} onChange={(e) => onChange("probeDescription", e.target.value)} rows={2} style={textareaStyle} />
      </Field>

      {checks.length > 0 && (
        <Field label="Linked monitor check (optional)" hint="Wires the probe to an existing monitor check's stored data, the same catalog Risk Register links against.">
          <select value={state.monitorCheckKey} onChange={(e) => onChange("monitorCheckKey", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="">Not linked to a monitor check</option>
            {checks.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
      )}

      <Field label="Graph endpoint (optional)">
        <input value={state.graphEndpoint} onChange={(e) => onChange("graphEndpoint", e.target.value)} placeholder="e.g. /reports/getSharePointSiteUsageDetail" style={inputStyle} />
      </Field>

      <Field label="Notes (optional)">
        <textarea value={state.notes} onChange={(e) => onChange("notes", e.target.value)} rows={2} style={textareaStyle} />
      </Field>
    </>
  );
}

export function emptyFields(seed?: Partial<FieldsState>): FieldsState {
  return {
    title: "", summary: "", changeClass: "default_flip", whoActs: "microsoft", controllable: "unknown",
    controlMethod: "", services: "", protocols: "", skus: "", settings: "",
    probeDescription: "", monitorCheckKey: "", powershell: "", graphEndpoint: "", notes: "",
    ...seed,
  };
}

function splitTags(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export function fieldsToTouches(state: FieldsState) {
  return {
    services: splitTags(state.services),
    protocols: splitTags(state.protocols),
    skus: splitTags(state.skus),
    settings: splitTags(state.settings),
  };
}

export function fieldsToProbe(state: FieldsState) {
  return {
    description: state.probeDescription.trim(),
    monitorCheckKey: state.monitorCheckKey || null,
    powershell: state.powershell.trim() || null,
    graphEndpoint: state.graphEndpoint.trim() || null,
  };
}
