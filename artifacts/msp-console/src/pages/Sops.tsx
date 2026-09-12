/**
 * SOPs (Operations, MSP-wide) — Git #2597.
 *
 * Built against `Design/MSP_Console/design_handoff_msp_console/SOPs.dc.html`
 * (an empty stub — the real spec is the "isSops" branch of the combined
 * `MSP Console.dc.html` logic class, screen 31 per the README's "25-33.
 * MSP-wide pages" table) and the real routes in
 * `artifacts/api-server/src/routes/msp-sops.ts`:
 *
 *   GET   /api/msp/sops              — the authored, versioned procedure library
 *   PATCH /api/msp/sops/:sopId       — edit/version an existing definition (#2597 addition)
 *   POST  /api/msp/sops              — author a new procedure
 *   POST  /api/msp/sops/:sopId/run   — fire a procedure against a customer's tenant
 *   GET   /api/msp/sop-runs          — every run, whatever invoked it (origin tells them apart)
 *
 * Two tabs, exactly as the design's `hasSubTabs`/`subTabs` for `isSops` define:
 * Library and Run history. The module mounts inside the shell's `ScreenSlot`
 * (see `console/ScreenSlot.tsx`'s own header comment) — it owns its own data
 * and its own sub-tab strip; the shell never reads either.
 */
import { useMemo, useState } from "react";
import { useDirectory } from "@/api/console-api";
import {
  useCreateSop, useRunSop, useSopRuns, useSops, useUpdateSop,
  type RunSopInput, type Sop, type SopAutomationType, type SopStep, type UpdateSopInput, type CreateSopInput,
} from "@/api/sops-api";
import { Icon, type IconName } from "@/console/icons";
import { border, shadow, signal, surface, text } from "@/console/tokens";

type Tab = "library" | "runs";

const AUTOMATION_TONE: Record<SopAutomationType, keyof typeof signal> = {
  automated: "ok",
  hybrid: "info",
  manual: "neutral",
};

const RUN_STATUS_TONE: Record<string, keyof typeof signal> = {
  Completed: "ok",
  "In Progress": "info",
  Blocked: "warning",
  Failed: "critical",
};

const ORIGIN_TONE: Record<string, keyof typeof signal> = {
  policy: "notice",
  remediation: "info",
  lifecycle: "ok",
  manual: "neutral",
};

function Tone({ kind, children }: { kind: keyof typeof signal; children: React.ReactNode }) {
  const t = signal[kind] as { text?: string; strong?: string; tint: string; border: string };
  const fg = t.text ?? t.strong ?? text.body;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 999,
      fontSize: 11, fontWeight: 700, letterSpacing: ".02em", background: t.tint, border: `1px solid ${t.border}`, color: fg,
    }}>
      {children}
    </span>
  );
}

function TabStrip({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [{ id: "library", label: "Library" }, { id: "runs", label: "Run history" }];
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {tabs.map((x) => (
        <button
          key={x.id}
          onClick={() => onTab(x.id)}
          style={{
            padding: "6px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            background: tab === x.id ? "rgba(37,99,235,.18)" : "transparent",
            border: `1px solid ${tab === x.id ? "rgba(96,165,250,.3)" : "rgba(148,163,184,.18)"}`,
            color: tab === x.id ? "#bfdbfe" : "#94a3b8",
          }}
        >
          {x.label}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, body, wire }: { icon: IconName; title: string; body: string; wire: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "40px 20px", textAlign: "center" }}>
      <span style={{ width: 44, height: 44, borderRadius: 13, background: "rgba(96,165,250,.1)", border: "1px solid rgba(96,165,250,.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={20} color={signal.info.strong} />
      </span>
      <span style={{ fontSize: 14.5, fontWeight: 700, color: text.title }}>{title}</span>
      {body && <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 440, textWrap: "pretty" }}>{body}</span>}
      <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.faint }}>{wire}</span>
    </div>
  );
}

function LoadingRows() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 16 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ height: 14, borderRadius: 6, background: "rgba(148,163,184,.1)", width: `${70 - i * 12}%` }} />
      ))}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflow: "hidden" }}>
      {children}
    </div>
  );
}

function TableHead({ cols, labels }: { cols: string; labels: string[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "10px 16px", borderBottom: `1px solid ${border.card}`, background: "rgba(15,23,42,.5)" }}>
      {labels.map((l) => (
        <span key={l} style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", color: text.label }}>{l}</span>
      ))}
    </div>
  );
}

function ErrorNote({ err }: { err: Error }) {
  return (
    <div style={{ padding: 16, fontSize: 12.5, color: signal.critical.text }}>
      Failed to load: {err.message}
    </div>
  );
}

// ── Library ──────────────────────────────────────────────────────────────────

function LibraryTab({ onOpenDefinition, onOpenRun, onNew }: {
  onOpenDefinition: (sop: Sop) => void;
  onOpenRun: (sop: Sop) => void;
  onNew: () => void;
}) {
  const sopsQuery = useSops();
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sopsQuery.data ?? []) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [sopsQuery.data]);

  const rows = useMemo(() => {
    const all = sopsQuery.data ?? [];
    return category ? all.filter((s) => s.category === category) : all;
  }, [sopsQuery.data, category]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button
            onClick={() => setCategory(null)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
              background: category === null ? "rgba(37,99,235,.18)" : "transparent",
              border: `1px solid ${category === null ? "rgba(96,165,250,.32)" : border.soft}`,
              color: category === null ? "#bfdbfe" : text.muted,
            }}
          >
            <Icon name="folder" size={12} /> All categories ({(sopsQuery.data ?? []).length})
          </button>
          {categories.map(([c, n]) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                background: category === c ? "rgba(37,99,235,.18)" : "transparent",
                border: `1px solid ${category === c ? "rgba(96,165,250,.32)" : border.soft}`,
                color: category === c ? "#bfdbfe" : text.muted,
              }}
            >
              <Icon name="layers" size={12} /> {c} ({n})
            </button>
          ))}
        </div>
        <button
          onClick={onNew}
          style={{ display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 8, background: "#2563eb", border: "1px solid #2563eb", color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
        >
          <Icon name="plus" size={14} /> New SOP
        </button>
      </div>

      <Card>
        <TableHead cols=".9fr 2.4fr 1.3fr 1fr .9fr 1fr 1.1fr" labels={["CODE", "TITLE", "CATEGORY", "AUTOMATION", "VERSION", "STEPS", "ESTIMATE"]} />
        {sopsQuery.isLoading && <LoadingRows />}
        {sopsQuery.isError && <ErrorNote err={sopsQuery.error} />}
        {sopsQuery.isSuccess && rows.length === 0 && (
          <EmptyState icon="scroll-text" title="No SOPs authored" body="Nothing in the library yet for this category." wire="GET /api/msp/sops" />
        )}
        {sopsQuery.isSuccess && rows.map((x) => (
          <div
            key={x.id}
            onClick={() => onOpenDefinition(x)}
            style={{ display: "grid", gridTemplateColumns: ".9fr 2.4fr 1.3fr 1fr .9fr 1fr 1.1fr", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${border.faint}`, cursor: "pointer", alignItems: "center" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(148,163,184,.06)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ fontFamily: "Menlo, monospace", fontSize: 12.5, fontWeight: 600, color: "#93c5fd" }}>{x.code}</span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: text.strong }}>{x.title}</span>
              <span style={{ fontSize: 11, color: text.faint }}>{x.versionStatus}</span>
            </span>
            <span style={{ fontSize: 12.5, color: text.secondary }}>{x.category}</span>
            <Tone kind={AUTOMATION_TONE[x.automationType]}>{x.automationType}</Tone>
            <span style={{ fontSize: 12.5, color: text.secondary }}>{x.version}</span>
            <span style={{ fontSize: 12.5, color: text.muted }}>{x.steps.filter((s) => s.type === "automated").length} of {x.steps.length}</span>
            <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 12.5, color: text.muted }}>{x.estimatedMinutes} min</span>
              <button
                onClick={(e) => { e.stopPropagation(); onOpenRun(x); }}
                title="Run against a customer"
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 7, background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.3)", color: "#fca5a5", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
              >
                <Icon name="play" size={11} /> Run
              </button>
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ── Run history ──────────────────────────────────────────────────────────────

function RunsTab({ onOpenRun }: { onOpenRun: (runId: string) => void }) {
  const runsQuery = useSopRuns();
  const rows = runsQuery.data ?? [];
  return (
    <Card>
      <TableHead cols="1.3fr .8fr 1.5fr 1.1fr 1.1fr 1fr 1.1fr" labels={["RUN", "SOP", "CUSTOMER", "ORIGIN", "STATUS", "PROGRESS", "AUTHORIZED BY"]} />
      {runsQuery.isLoading && <LoadingRows />}
      {runsQuery.isError && <ErrorNote err={runsQuery.error} />}
      {runsQuery.isSuccess && rows.length === 0 && (
        <EmptyState
          icon="history"
          title="No SOP runs yet"
          body="Every run is one row regardless of what triggered it — the origin is what tells a policy enactment apart from a hand-started run."
          wire="GET /api/msp/sop-runs"
        />
      )}
      {runsQuery.isSuccess && rows.map((r) => (
        <div
          key={r.id}
          onClick={() => onOpenRun(r.runId)}
          style={{ display: "grid", gridTemplateColumns: "1.3fr .8fr 1.5fr 1.1fr 1.1fr 1fr 1.1fr", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${border.faint}`, cursor: "pointer" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(148,163,184,.06)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontFamily: "Menlo, monospace", fontSize: 12.5, fontWeight: 600, color: "#93c5fd" }}>{r.runId}</span>
            <span style={{ fontSize: 11, color: text.faint }}>{r.startedAt}</span>
          </span>
          <span style={{ fontFamily: "Menlo, monospace", fontSize: 12.5, color: text.secondary }}>{r.sopId}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: text.strong }}>{r.tenantName}</span>
          <Tone kind={ORIGIN_TONE[r.origin] ?? "neutral"}>{r.origin}</Tone>
          <Tone kind={RUN_STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Tone>
          <span style={{ fontSize: 12.5, color: text.secondary }}>{r.passedStepsCount} of {r.totalSteps}</span>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontFamily: "Menlo, monospace", fontSize: 11.5, color: r.wfRunId == null ? text.faint : "#6ee7b7" }}>
              {r.wfRunId == null ? "—" : `wf-${r.wfRunId}`}
            </span>
            <span style={{ fontSize: 10.5, color: text.faint }}>{r.wfRunId == null ? "hand-entered" : `sop v${r.sopVersion || "—"}`}</span>
          </span>
        </div>
      ))}
    </Card>
  );
}

// ── Drawer chrome ────────────────────────────────────────────────────────────

function Drawer({ eyebrow, title, note, onClose, children, width = 460 }: {
  eyebrow: string; title: string; note?: string; onClose: () => void; children: React.ReactNode; width?: number;
}) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.6)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="smc-scroll"
        style={{ width: `min(${width}px, 92vw)`, height: "100%", background: surface.popover, borderLeft: `1px solid ${border.card}`, boxShadow: shadow.popover, overflowY: "auto", display: "flex", flexDirection: "column" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "16px 18px", borderBottom: `1px solid ${border.card}` }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.faint }}>{eyebrow}</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: text.title }}>{title}</span>
            {note && <span style={{ fontSize: 12, color: text.muted }}>{note}</span>}
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: 0, cursor: "pointer", color: text.muted, padding: 4 }}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", color: text.label }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "rgba(15,23,42,.6)", border: `1px solid ${border.card}`, borderRadius: 8, color: text.body,
  fontSize: 13, padding: "8px 10px", outline: "none",
};

// ── Definition drawer (view / edit / create) ─────────────────────────────────

interface SopFormState {
  sopId: string;
  code: string; title: string; description: string; category: string; version: string;
  automationType: SopAutomationType; estimatedMinutes: number; versionStatus: string;
  complianceTags: string; workloadTags: string;
  steps: SopStep[];
}

function toForm(sop: Sop | null): SopFormState {
  if (!sop) {
    return {
      sopId: "", code: "", title: "", description: "", category: "", version: "v1.0",
      automationType: "manual", estimatedMinutes: 15, versionStatus: "Draft",
      complianceTags: "", workloadTags: "", steps: [],
    };
  }
  return {
    sopId: sop.sopId, code: sop.code, title: sop.title, description: sop.description, category: sop.category,
    version: sop.version, automationType: sop.automationType, estimatedMinutes: sop.estimatedMinutes,
    versionStatus: sop.versionStatus, complianceTags: sop.complianceTags.join(", "), workloadTags: sop.workloadTags.join(", "),
    steps: sop.steps,
  };
}

function splitTags(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function DefinitionDrawer({ sop, onClose, onRun }: { sop: Sop | null; onClose: () => void; onRun: (sop: Sop) => void }) {
  const isCreate = sop === null;
  const [editing, setEditing] = useState(isCreate);
  const [form, setForm] = useState<SopFormState>(() => toForm(sop));
  const createMutation = useCreateSop();
  const updateMutation = useUpdateSop();
  const busy = createMutation.isPending || updateMutation.isPending;
  const saveError = createMutation.error ?? updateMutation.error;

  const patchField = <K extends keyof SopFormState>(k: K, v: SopFormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const setStep = (i: number, patch: Partial<SopStep>) =>
    setForm((f) => ({ ...f, steps: f.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  const addStep = () =>
    setForm((f) => ({ ...f, steps: [...f.steps, { stepNumber: f.steps.length + 1, title: "", description: "", type: "manual" }] }));
  const removeStep = (i: number) =>
    setForm((f) => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, stepNumber: idx + 1 })) }));

  const save = () => {
    const payload: CreateSopInput = {
      sopId: form.sopId, code: form.code, title: form.title, description: form.description, category: form.category,
      version: form.version, automationType: form.automationType, estimatedMinutes: form.estimatedMinutes,
      complianceTags: splitTags(form.complianceTags), workloadTags: splitTags(form.workloadTags),
      steps: form.steps, versionStatus: form.versionStatus,
    };
    if (isCreate) {
      createMutation.mutate(payload, { onSuccess: () => onClose() });
    } else {
      const patch: UpdateSopInput = { ...payload };
      delete (patch as Partial<CreateSopInput>).sopId;
      updateMutation.mutate({ sopId: form.sopId, patch }, { onSuccess: () => setEditing(false) });
    }
  };

  return (
    <Drawer
      eyebrow={isCreate ? "POST /api/msp/sops" : editing ? "PATCH /api/msp/sops/:sopId" : "GET /api/msp/sops"}
      title={isCreate ? "New SOP" : form.title || form.code}
      note={isCreate ? "Author a new procedure for this MSP's library." : `${form.category} · ${form.versionStatus}`}
      onClose={onClose}
      width={560}
    >
      {editing ? (
        <>
          {isCreate && (
            <Field label="Procedure id (sopId)">
              <input style={inputStyle} value={form.sopId} onChange={(e) => patchField("sopId", e.target.value)} placeholder="sop-guest-cleanup" />
            </Field>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Code"><input style={inputStyle} value={form.code} onChange={(e) => patchField("code", e.target.value)} placeholder="IAM-05" /></Field>
            <Field label="Category"><input style={inputStyle} value={form.category} onChange={(e) => patchField("category", e.target.value)} placeholder="Identity" /></Field>
          </div>
          <Field label="Title"><input style={inputStyle} value={form.title} onChange={(e) => patchField("title", e.target.value)} /></Field>
          <Field label="Description"><textarea style={{ ...inputStyle, minHeight: 64, resize: "vertical" }} value={form.description} onChange={(e) => patchField("description", e.target.value)} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Field label="Version"><input style={inputStyle} value={form.version} onChange={(e) => patchField("version", e.target.value)} /></Field>
            <Field label="Version status"><input style={inputStyle} value={form.versionStatus} onChange={(e) => patchField("versionStatus", e.target.value)} placeholder="Published / Active" /></Field>
            <Field label="Estimate (min)"><input type="number" min={0} style={inputStyle} value={form.estimatedMinutes} onChange={(e) => patchField("estimatedMinutes", Number(e.target.value) || 0)} /></Field>
          </div>
          <Field label="Automation">
            <select style={inputStyle} value={form.automationType} onChange={(e) => patchField("automationType", e.target.value as SopAutomationType)}>
              <option value="manual">manual</option>
              <option value="hybrid">hybrid</option>
              <option value="automated">automated</option>
            </select>
          </Field>
          <Field label="Workload tags (comma-separated — service/workload attachment)">
            <input style={inputStyle} value={form.workloadTags} onChange={(e) => patchField("workloadTags", e.target.value)} placeholder="Exchange, Entra ID, Teams" />
          </Field>
          <Field label="Compliance tags (comma-separated)">
            <input style={inputStyle} value={form.complianceTags} onChange={(e) => patchField("complianceTags", e.target.value)} placeholder="NIST-800-53, CIS" />
          </Field>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", color: text.label }}>STEPS</span>
              <button onClick={addStep} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: signal.info.text, background: "transparent", border: 0, cursor: "pointer" }}>
                <Icon name="plus" size={12} /> Add step
              </button>
            </div>
            {form.steps.map((s, i) => (
              <div key={i} style={{ border: `1px solid ${border.faint}`, borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: text.faint, fontFamily: "Menlo, monospace" }}>#{s.stepNumber}</span>
                  <input style={{ ...inputStyle, flex: 1 }} value={s.title} onChange={(e) => setStep(i, { title: e.target.value })} placeholder="Step title" />
                  <select style={{ ...inputStyle, width: 110 }} value={s.type} onChange={(e) => setStep(i, { type: e.target.value as SopStep["type"] })}>
                    <option value="manual">manual</option>
                    <option value="automated">automated</option>
                  </select>
                  <button onClick={() => removeStep(i)} style={{ background: "transparent", border: 0, cursor: "pointer", color: signal.critical.text }}>
                    <Icon name="x" size={14} />
                  </button>
                </div>
                <input style={inputStyle} value={s.description} onChange={(e) => setStep(i, { description: e.target.value })} placeholder="Step description" />
                {s.type === "automated" && (
                  <input style={inputStyle} value={s.graphEndpoint ?? ""} onChange={(e) => setStep(i, { graphEndpoint: e.target.value })} placeholder="Graph endpoint (e.g. GET /users/{id})" />
                )}
              </div>
            ))}
            {form.steps.length === 0 && <span style={{ fontSize: 12, color: text.faint }}>No steps yet — a procedure with no automatable step cannot be run.</span>}
          </div>

          {saveError && <span style={{ fontSize: 12, color: signal.critical.text }}>{saveError.message}</span>}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              onClick={save}
              disabled={busy || !form.sopId || !form.code || !form.title || !form.category}
              style={{ height: 34, padding: "0 14px", borderRadius: 8, background: "#2563eb", border: "1px solid #2563eb", color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1 }}
            >
              {busy ? "Saving…" : isCreate ? "Create SOP" : "Save changes"}
            </button>
            {!isCreate && (
              <button onClick={() => { setForm(toForm(sop)); setEditing(false); }} style={{ height: 34, padding: "0 14px", borderRadius: 8, background: "transparent", border: `1px solid ${border.card}`, color: text.muted, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
            )}
          </div>
        </>
      ) : sop ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Tone kind={AUTOMATION_TONE[sop.automationType]}>{sop.automationType}</Tone>
            <Tone kind="neutral">{sop.version}</Tone>
            {sop.workloadTags.map((w) => <Tone key={w} kind="info">{w}</Tone>)}
            {sop.complianceTags.map((c) => <Tone key={c} kind="notice">{c}</Tone>)}
          </div>
          <p style={{ fontSize: 13, color: text.secondary, lineHeight: 1.5 }}>{sop.description}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
            <span style={{ color: text.faint }}>Last updated</span>
            <span style={{ color: text.secondary }}>{sop.lastUpdatedAt} · {sop.lastUpdatedBy}</span>
            <span style={{ color: text.faint }}>Estimate</span>
            <span style={{ color: text.secondary }}>{sop.estimatedMinutes} min</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", color: text.label }}>STEPS ({sop.steps.filter((s) => s.type === "automated").length} of {sop.steps.length} automated)</span>
            {sop.steps.map((s) => (
              <div key={s.stepNumber} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 0", borderTop: `1px solid ${border.faint}` }}>
                <Icon name={s.type === "automated" ? "circle-check" : "circle-x"} size={14} color={s.type === "automated" ? signal.ok.strong : text.faint} />
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong }}>{s.stepNumber}. {s.title}</span>
                  <span style={{ fontSize: 12, color: text.muted }}>{s.description}</span>
                  {s.graphEndpoint && <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.faint }}>{s.graphEndpoint}</span>}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={() => setEditing(true)} style={{ display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", borderRadius: 8, background: "transparent", border: `1px solid ${border.card}`, color: text.body, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              <Icon name="copy" size={13} /> Edit / bump version
            </button>
            <button onClick={() => onRun(sop)} style={{ display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", borderRadius: 8, background: "rgba(248,113,113,.12)", border: "1px solid rgba(248,113,113,.32)", color: "#fca5a5", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              <Icon name="play" size={13} /> Run against a customer
            </button>
          </div>
        </>
      ) : null}
    </Drawer>
  );
}

// ── Run drawer ────────────────────────────────────────────────────────────────

function RunDrawer({ sop, onClose }: { sop: Sop; onClose: () => void }) {
  const directory = useDirectory();
  const runMutation = useRunSop();
  const [customerId, setCustomerId] = useState<number | "">("");
  const [targetEntity, setTargetEntity] = useState("");
  const [changeRequestId, setChangeRequestId] = useState("");

  const notRunnable = sop.automationType === "manual" || sop.steps.every((s) => s.type !== "automated");

  const submit = () => {
    if (customerId === "") return;
    const input: RunSopInput = { sopId: sop.sopId, customerId, targetEntity: targetEntity || undefined };
    if (changeRequestId.trim()) input.changeRequestId = Number(changeRequestId);
    runMutation.mutate(input, { onSuccess: () => onClose() });
  };

  return (
    <Drawer eyebrow="POST /api/msp/sops/:sopId/run" title={`Run ${sop.code}`} note={sop.title} onClose={onClose}>
      <div style={{ background: "rgba(248,113,113,.08)", border: "1px solid rgba(248,113,113,.28)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#fca5a5" }}>This fires real work against a customer's tenant</span>
        <span style={{ fontSize: 12, color: text.muted }}>
          {notRunnable
            ? "This procedure has no automatable step, so the run request is refused outright."
            : "Automated steps execute through the workflow engine. Manual steps stay open and must be closed by hand afterwards."}
        </span>
      </div>

      <Field label="Customer (required — must belong to your MSP)">
        <select style={inputStyle} value={customerId} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : "")} disabled={directory.isLoading}>
          <option value="">Select a customer…</option>
          {(directory.data?.customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Target entity / variables (optional)">
        <input style={inputStyle} value={targetEntity} onChange={(e) => setTargetEntity(e.target.value)} placeholder="user@customer.com" />
      </Field>
      <Field label="Authorizing change request id (optional — required unless the tenant is testbed or a standing policy applies)">
        <input style={inputStyle} value={changeRequestId} onChange={(e) => setChangeRequestId(e.target.value)} placeholder="e.g. 118" />
      </Field>

      {runMutation.isError && <span style={{ fontSize: 12, color: signal.critical.text }}>{runMutation.error.message}</span>}

      <button
        onClick={submit}
        disabled={notRunnable || customerId === "" || runMutation.isPending}
        style={{
          height: 36, borderRadius: 8, background: notRunnable ? "rgba(148,163,184,.15)" : "#dc2626", border: "1px solid " + (notRunnable ? border.card : "#dc2626"),
          color: notRunnable ? text.faint : "#fff", fontSize: 12.5, fontWeight: 700, cursor: notRunnable ? "not-allowed" : "pointer",
        }}
      >
        {runMutation.isPending ? "Starting…" : notRunnable ? "Not runnable" : "Run against a customer"}
      </button>
    </Drawer>
  );
}

// ── Run detail (record review) ───────────────────────────────────────────────

function RunDetailDrawer({ runId, onClose }: { runId: string; onClose: () => void }) {
  const runsQuery = useSopRuns();
  const run = (runsQuery.data ?? []).find((r) => r.runId === runId) ?? null;
  if (!run) {
    return (
      <Drawer eyebrow="GET /api/msp/sop-runs" title={runId} onClose={onClose}>
        <span style={{ fontSize: 12.5, color: text.muted }}>This run no longer appears in the list.</span>
      </Drawer>
    );
  }
  return (
    <Drawer eyebrow="GET /api/msp/sop-runs" title={run.runId} note={`${run.sopTitle || run.sopId} · ${run.tenantName}`} onClose={onClose}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Tone kind={ORIGIN_TONE[run.origin] ?? "neutral"}>{run.origin}</Tone>
        <Tone kind={RUN_STATUS_TONE[run.status] ?? "neutral"}>{run.status}</Tone>
        <Tone kind="neutral">sop v{run.sopVersion || "—"}</Tone>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
        <span style={{ color: text.faint }}>Operator</span><span style={{ color: text.secondary }}>{run.operator}</span>
        <span style={{ color: text.faint }}>Target entity</span><span style={{ color: text.secondary }}>{run.targetEntity || "—"}</span>
        <span style={{ color: text.faint }}>Started</span><span style={{ color: text.secondary }}>{run.startedAt}</span>
        <span style={{ color: text.faint }}>Completed</span><span style={{ color: text.secondary }}>{run.completedAt ?? "—"}</span>
        <span style={{ color: text.faint }}>Progress</span><span style={{ color: text.secondary }}>{run.passedStepsCount} of {run.totalSteps}</span>
        <span style={{ color: text.faint }}>PSA ticket</span><span style={{ color: text.secondary }}>{run.psaTicketId || "—"}</span>
        <span style={{ color: text.faint }}>Workflow run</span>
        <span style={{ color: run.wfRunId == null ? text.faint : "#6ee7b7", fontFamily: "Menlo, monospace" }}>{run.wfRunId == null ? "— (hand-entered)" : `wf-${run.wfRunId}`}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", color: text.label }}>LOGS</span>
        {run.logs.length === 0
          ? <span style={{ fontSize: 12, color: text.faint }}>No log lines recorded on this run.</span>
          : run.logs.map((l, i) => <span key={i} style={{ fontFamily: "Menlo, monospace", fontSize: 11.5, color: text.secondary }}>{l}</span>)}
      </div>
    </Drawer>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SopsPage() {
  const [tab, setTab] = useState<Tab>("library");
  const [definitionSop, setDefinitionSop] = useState<Sop | null | "new">(null);
  const [runSop, setRunSop] = useState<Sop | null>(null);
  const [runDetailId, setRunDetailId] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <TabStrip tab={tab} onTab={setTab} />
      {tab === "library" ? (
        <LibraryTab
          onOpenDefinition={(s) => setDefinitionSop(s)}
          onOpenRun={(s) => setRunSop(s)}
          onNew={() => setDefinitionSop("new")}
        />
      ) : (
        <RunsTab onOpenRun={(id) => setRunDetailId(id)} />
      )}

      {definitionSop !== null && (
        <DefinitionDrawer
          sop={definitionSop === "new" ? null : definitionSop}
          onClose={() => setDefinitionSop(null)}
          onRun={(s) => { setDefinitionSop(null); setRunSop(s); }}
        />
      )}
      {runSop && <RunDrawer sop={runSop} onClose={() => setRunSop(null)} />}
      {runDetailId && <RunDetailDrawer runId={runDetailId} onClose={() => setRunDetailId(null)} />}
    </div>
  );
}
