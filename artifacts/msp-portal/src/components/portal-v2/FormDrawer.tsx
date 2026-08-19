/**
 * FormDrawer.tsx — the ONE form primitive for the Customer Portal.
 *
 * The design handoff is explicit: "Forms live in the right drawer, never inline.
 * One `openForm({ kicker, title, intro, submitLabel, fields[], doneNote })`
 * primitive drives every form in the portal." Every form — purchase, regenerate,
 * share, extend a hold, add a recipient, author an SOP — is this component with
 * a different spec object. Nothing else opens a form.
 *
 * ── Why the styles are inline and literal ───────────────────────────────────
 * The handoff README states the prototype's inline style values ARE the spec
 * ("they are the spec — there is no stylesheet"). Every number below is copied
 * verbatim from `Customer Portal Shell.dc.html` lines 5832-5906 rather than
 * approximated with house component defaults, which differ: shadcn's Sheet has
 * its own padding scale and radii, and using them would quietly redesign the
 * drawer. Where the two conflict, the design's numbers win.
 *
 * The drawer is a plain fixed-position element rather than `ui/sheet.tsx` for
 * the same reason: Sheet imposes its own width, padding, close-button placement
 * and animation, and the spec pins all four (`min(560px,94vw)`, `16px 20px`
 * header, a 26px square close button, overlay z-124 / panel z-125).
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";

/* ── Spec types ───────────────────────────────────────────────────────────── */

export type FormFieldKind = "text" | "select" | "textarea";

export interface FormFieldSpec {
  id: string;
  label: string;
  kind?: FormFieldKind;
  /** Full-row rather than sharing the auto-fit grid. */
  wide?: boolean;
  /** Defaults to true, per the handoff. */
  required?: boolean;
  value?: string;
  placeholder?: string;
  hint?: string;
  inputType?: string;
  options?: { value: string; label: string }[];
}

export interface FormSpec {
  kicker: string;
  title: string;
  intro?: string;
  submitLabel?: string;
  fields: FormFieldSpec[];
  doneNote: string;
  /** Optional headline on the done state. */
  doneTitle?: string;
  /** Rows shown on the done state — what was filed. */
  doneRows?: { label: string; value: string }[];
  /** The monospace "what this writes" note, when the form writes to the tenant. */
  graphNote?: string;
  onSubmit?: (values: Record<string, string>) => void;
}

/* ── Exact style values from the prototype (lines 5832-5906) ──────────────── */

const OVERLAY: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 124,
  background: "rgba(2,6,23,.55)",
  backdropFilter: "blur(2px)",
};

const PANEL: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  zIndex: 125,
  width: "min(560px,94vw)",
  display: "flex",
  flexDirection: "column",
  borderLeft: "1px solid rgba(0,120,212,.35)",
  background: "#0b1524",
  boxShadow: "-24px 0 60px rgba(2,6,23,.6)",
};

const HEADER: React.CSSProperties = {
  flex: "0 0 auto",
  padding: "16px 20px",
  borderBottom: "1px solid rgba(30,41,59,.9)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
};

const KICKER: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".16em",
  textTransform: "uppercase",
  color: "#60a5fa",
};

const TITLE: React.CSSProperties = {
  fontSize: "15px",
  fontWeight: 800,
  color: "#f8fafc",
  letterSpacing: "-.01em",
  lineHeight: 1.35,
  textWrap: "pretty",
};

const CLOSE_BTN: React.CSSProperties = {
  flex: "0 0 auto",
  width: 26,
  height: 26,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 6,
  border: "1px solid rgba(148,163,184,.22)",
  background: "transparent",
  color: "#94a3b8",
  fontSize: "14px",
  lineHeight: 1,
  cursor: "pointer",
  fontFamily: "inherit",
};

const BODY: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: "16px 20px 20px",
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const INTRO: React.CSSProperties = {
  fontSize: "12px",
  color: "#94a3b8",
  lineHeight: 1.6,
  textWrap: "pretty",
};

const FIELD_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
  gap: 12,
};

const FIELD_LABEL: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".09em",
  textTransform: "uppercase",
  color: "#64748b",
};

const FIELD_HINT: React.CSSProperties = {
  fontSize: "10.5px",
  color: "#475569",
  lineHeight: 1.5,
};

/** The prototype builds these per field as `f.inputCss` / `f.areaCss`. */
const INPUT_CSS: React.CSSProperties = {
  padding: "8px 11px",
  borderRadius: 7,
  border: "1px solid rgba(30,41,59,.9)",
  background: "#0b1a2e",
  color: "#e2e8f0",
  fontSize: "12.5px",
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
};

const AREA_CSS: React.CSSProperties = {
  ...INPUT_CSS,
  minHeight: 78,
  resize: "vertical",
  lineHeight: 1.55,
};

const GRAPH_NOTE_BOX: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  padding: "11px 13px",
  borderRadius: 9,
  border: "1px solid rgba(148,163,184,.16)",
  background: "rgba(148,163,184,.05)",
};

const FOOTER: React.CSSProperties = {
  flex: "0 0 auto",
  padding: "13px 20px",
  borderTop: "1px solid rgba(30,41,59,.9)",
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const SUBMIT_CSS: React.CSSProperties = {
  padding: "9px 15px",
  borderRadius: 7,
  fontSize: "12.5px",
  fontWeight: 700,
  border: "1px solid #0078D4",
  background: "#0078D4",
  color: "#fff",
  cursor: "pointer",
  fontFamily: "inherit",
};

const CANCEL_CSS: React.CSSProperties = {
  padding: "9px 15px",
  borderRadius: 7,
  fontSize: "12.5px",
  fontWeight: 600,
  border: "1px solid rgba(148,163,184,.22)",
  background: "transparent",
  color: "#94a3b8",
  cursor: "pointer",
  fontFamily: "inherit",
};

/* ── The component ────────────────────────────────────────────────────────── */

export function FormDrawer({ spec, onClose }: { spec: FormSpec; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(spec.fields.map((f) => [f.id, f.value ?? ""])),
  );
  const [done, setDone] = useState(false);

  const setVal = useCallback((id: string, v: string) => {
    setValues((prev) => ({ ...prev, [id]: v }));
  }, []);

  const submit = useCallback(() => {
    spec.onSubmit?.(values);
    setDone(true);
  }, [spec, values]);

  return (
    <>
      <div style={OVERLAY} onClick={onClose} data-testid="pv2-form-overlay" />
      <div style={PANEL} role="dialog" aria-label={spec.title} data-testid="pv2-form-drawer">
        <div style={HEADER}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span style={KICKER}>{spec.kicker}</span>
            <span style={TITLE} data-testid="pv2-form-title">
              {spec.title}
            </span>
          </div>
          <button style={CLOSE_BTN} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {!done ? (
          <div style={BODY}>
            {spec.intro && <span style={INTRO}>{spec.intro}</span>}

            <div style={FIELD_GRID}>
              {spec.fields.map((f) => {
                const kind = f.kind ?? "text";
                return (
                  <div
                    key={f.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 5,
                      minWidth: 0,
                      // `f.fullCss` in the prototype — a wide field spans the row.
                      ...(f.wide ? { gridColumn: "1 / -1" } : null),
                    }}
                  >
                    <span style={FIELD_LABEL}>{f.label}</span>

                    {kind === "text" && (
                      <input
                        type={f.inputType ?? "text"}
                        value={values[f.id] ?? ""}
                        placeholder={f.placeholder}
                        onChange={(e) => setVal(f.id, e.target.value)}
                        style={INPUT_CSS}
                        data-testid={`pv2-form-field-${f.id}`}
                      />
                    )}

                    {kind === "textarea" && (
                      <textarea
                        value={values[f.id] ?? ""}
                        placeholder={f.placeholder}
                        onChange={(e) => setVal(f.id, e.target.value)}
                        style={AREA_CSS}
                        data-testid={`pv2-form-field-${f.id}`}
                      />
                    )}

                    {kind === "select" && (
                      <select
                        value={values[f.id] ?? ""}
                        onChange={(e) => setVal(f.id, e.target.value)}
                        style={{ ...INPUT_CSS, cursor: "pointer" }}
                        data-testid={`pv2-form-field-${f.id}`}
                      >
                        {(f.options ?? []).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}

                    {f.hint && <span style={FIELD_HINT}>{f.hint}</span>}
                  </div>
                );
              })}
            </div>

            {spec.graphNote && (
              <div style={GRAPH_NOTE_BOX}>
                <span
                  style={{
                    fontSize: "9px",
                    fontWeight: 700,
                    letterSpacing: ".1em",
                    textTransform: "uppercase",
                    color: "#475569",
                  }}
                >
                  What this writes
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    color: "#94a3b8",
                    lineHeight: 1.55,
                    fontFamily: "'SF Mono',Menlo,Consolas,monospace",
                    wordBreak: "break-word",
                  }}
                >
                  {spec.graphNote}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div
            style={{ ...BODY, gap: 12 }}
            data-testid="pv2-form-done"
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "12px 14px",
                borderRadius: 9,
                border: "1px solid rgba(52,211,153,.4)",
                background: "rgba(52,211,153,.08)",
              }}
            >
              <span style={{ fontSize: "12.5px", fontWeight: 800, color: "#34d399" }}>
                {spec.doneTitle ?? "Filed"}
              </span>
              <span
                style={{
                  fontSize: "11.5px",
                  color: "#94a3b8",
                  lineHeight: 1.55,
                  textWrap: "pretty",
                }}
              >
                {spec.doneNote}
              </span>
            </div>

            {spec.doneRows && spec.doneRows.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0,
                  border: "1px solid rgba(30,41,59,.9)",
                  borderRadius: 9,
                  overflow: "hidden",
                }}
              >
                {spec.doneRows.map((r) => (
                  <div
                    key={r.label}
                    style={{
                      display: "flex",
                      gap: 12,
                      padding: "9px 13px",
                      borderBottom: "1px solid rgba(30,41,59,.7)",
                    }}
                  >
                    <span
                      style={{
                        flex: "0 0 40%",
                        fontSize: "10.5px",
                        fontWeight: 700,
                        letterSpacing: ".05em",
                        textTransform: "uppercase",
                        color: "#64748b",
                      }}
                    >
                      {r.label}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: "11.5px",
                        color: "#e2e8f0",
                        lineHeight: 1.5,
                        wordBreak: "break-word",
                      }}
                    >
                      {r.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={FOOTER}>
          {!done && (
            <button style={SUBMIT_CSS} onClick={submit} data-testid="pv2-form-submit">
              {spec.submitLabel ?? "Save"}
            </button>
          )}
          <button style={CANCEL_CSS} onClick={onClose} data-testid="pv2-form-close">
            Close
          </button>
          {!done && (
            <span style={{ fontSize: "10.5px", color: "#475569" }}>
              Nothing leaves the portal until you save.
            </span>
          )}
        </div>
      </div>
    </>
  );
}

/* ── The openForm host ────────────────────────────────────────────────────── */

/**
 * Holds the single active form. The prototype keeps exactly one `formPanel` on
 * state — the portal never shows two forms at once — so this mirrors that rather
 * than allowing a stack.
 */
export function useFormDrawer() {
  const [spec, setSpec] = useState<FormSpec | null>(null);

  const openForm = useCallback((next: FormSpec) => setSpec(next), []);
  const closeForm = useCallback(() => setSpec(null), []);

  const element: ReactNode = useMemo(
    () => (spec ? <FormDrawer spec={spec} onClose={closeForm} /> : null),
    [spec, closeForm],
  );

  return { openForm, closeForm, formElement: element, formOpen: spec !== null };
}
